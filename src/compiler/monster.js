// Monster abilities (NPC "action" items) as plans for the resolution core.
//
// - Glossary abilities (Grab, Knockdown, Push, Constrict, Frightful Presence,
//   Ferocity, Rend): PF2e gives only their parameters; their mechanics are
//   PF2e's standard wording, written once here. Grab, Knockdown and Push are
//   the basic actions Grapple, Trip and Shove without the multiple attack
//   penalty, after a Strike that lists them.
// - Inline-save abilities (breath weapons and other one-offs): the numbers are
//   in @Check, @Damage and @Template, with recharge from [[/gmr 1d4 #Recharge]].
// - Skill-check abilities written like basic actions ("Athletics check against
//   the target's Reflex DC"): compiled as basic actions are.

import { gmFallback } from "./gm-fallback.js";
import { gmDecided } from "./gm-decided.js";
import { htmlToPlainText } from "../../../pf2e-resolution-core/src/text/plain-text.js";
import { OTHER_WAY, STAGE_CONDITIONS, degreeSections, immunityDetails, inlineTags, modernInline, readCheck, readConditions, readDamage, readDuration, readImmunity, readLinger, readPush, readRange, readRecharge, readTemplate, readableText, sentencesOf, unconditional, conditionalDamage, noteUnread } from "./inline.js";
import { compileSkillAction, readPenalties, readSkillCheck } from "./checks.js";
import { chargeSentences, compileBuiltin, countWord, moveThenStrike, readRage, readRegrowth, readSelfGuard, readShell, readStrikeBuff } from "./builtins.js";
import { compileAffliction, readAffliction } from "./afflictions.js";
import { readActiveAfter, readAuraTiming } from "./auras.js";
import { castSpell } from "./casts.js";

const none = () => ({ damage: { mode: "none", multiplier: 0, sourceComponentIds: [] }, effects: [] });
const shared = (multiplier, ids) => ({ damage: { mode: "shared", multiplier, sourceComponentIds: ids }, effects: [] });
const basicRows = (ids) => ({ criticalSuccess: shared(0, []), success: shared(0.5, ids), failure: shared(1, ids), criticalFailure: shared(2, ids) });
const condition = (slug, value = null, duration = null) => ({ kind: "condition", slug, value, duration });

// The glossary key an item uses, as PF2e's slug ("improved-grab").
export function glossarySlug(item) {
    const localized = /@Localize\[PF2E\.NPC\.Abilities\.Glossary\.([A-Za-z]+)\]/.exec(item?.system?.description?.value ?? "")?.[1];
    if (localized) return localized.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
    const own = item?.system?.slug ?? null;
    if (own) return own;
    // The glossary's text written out, with no slug (2026-10-10): "Requirements The monster's last action was a success with a
    // Strike that lists Grab in its damage entry …" → "grab".
    // (Batch 36: a distance in the name, "Improved Push 15ft".)
    const named = String(item?.name ?? "").trim().toLowerCase().replace(/\s+/g, "-").replace(/^((?:improved-)?(?:push|pull))-\d+-?(?:ft|feet|foot)$/, "$1");
    if (["grab", "improved-grab", "knockdown", "improved-knockdown", "push", "improved-push", "pull", "improved-pull"].includes(named) && /last action was a success with a Strike that lists/i.test(item?.system?.description?.value ?? "")) return named;
    // Reactive Strike under either name ("Attack of Opportunity (Tail Only)"), its trigger written out.
    const reactive = /^(attack-of-opportunity|reactive-strike)\b/.exec(named)?.[1];
    if (reactive && /uses a manipulate action or a move action, makes a ranged attack, or leaves a square during a move action/i.test(htmlToPlainText(item?.system?.description?.value ?? ""))) return reactive;
    return own;
}

// Rules PF2e's own engine or the simulator already play: no plan needed.
export const BUILT_IN = new Set(["attack-of-opportunity", "reactive-strike", "shield-block", "throw-rock", "ferocity", "rend"]);
// Abilities that change nothing in a fight's numbers (Change Shape keeps the creature's Speed, attacks and damage; Form
// Up only rearranges a troop's squares; Catch Rock guards against thrown rocks, which no party throws).
const NO_EFFECT = new Set(["change-shape", "form-up", "catch-rock"]);

function base(item, { time, traits = item?.system?.traits?.value ?? [] } = {}) {
    return {
        modelVersion: 13,
        source: { name: item?.name, slug: glossarySlug(item), uuid: item?.uuid ?? null, type: item?.type ?? "action" },
        rank: 1,
        traits: [...traits],
        activation: { time: time ?? activationTime(item), traits: [...traits] },
        automation: { level: "automatic" }
    };
}

function activationTime(item) {
    const type = item?.system?.actionType?.value;
    if (type === "reaction" || type === "free" || type === "passive") return type;
    return String(item?.system?.actions?.value ?? 1);
}

function damageComponents(html) {
    return inlineTags(html, "Damage").filter((raw) => !/\bhealing\b/i.test(raw)).map((raw, index) => ({ id: String(index), formula: readDamage(raw), type: null, category: null }));
}

// A rider: Grapple, Trip or Shove after a Strike that lists it, without the
// multiple attack penalty; "improved" ones are free actions.
function rider(item, slug, basicActions) {
    const action = { grab: "grapple", "improved-grab": "grapple", knockdown: "trip", "improved-knockdown": "trip", push: "shove", "improved-push": "shove", pull: "reposition", "improved-pull": "reposition" }[slug];
    const plan = basicActions?.[action];
    if (!plan) return null;
    // Improved by its slug, or by its name when the slug is the plain one's ("Improved Pull 15 Feet", slug "pull").
    const improved = slug.startsWith("improved-") || /^Improved\b/i.test(item?.name ?? "");
    const attackEffect = slug.replace(/^improved-/, "");
    const rider = structuredClone(plan);
    rider.source = { name: item?.name ?? slug, slug, uuid: item?.uuid ?? null, type: "action" };
    rider.activation = { time: improved ? "free" : "1", traits: plan.traits };
    rider.trigger = { event: "strike", on: ["success", "criticalSuccess"], attackEffect, cost: improved ? "free" : "action", map: false };
    // "If Push lists a distance": the distance on a success (and a critical success pushes no less).
    // (In the name, "Push 15 feet", or the text.)
    const distance = /\b(\d+) ?(?:feet|foot|ft)\b/i.exec(`${item?.name ?? ""} ${htmlToPlainText(item?.system?.description?.value ?? "")}`)?.[1];
    // Pull: a Reposition that moves the creature closer to the monster, 5 feet on a success (or the listed distance) and
    // 10 on a critical success (no less than the listed one).
    if (attackEffect === "pull") {
        const outcomes = rider.resolution.outcomes;
        const pull = (feet) => ({ kind: "pull", distance: feet, upTo: true, optional: false, direction: "toward" });
        outcomes.success.forcedMovement = pull(Number(distance) || 5);
        outcomes.criticalSuccess.forcedMovement = pull(Math.max(10, Number(distance) || 0));
        delete outcomes.success.manualInstructions;
        delete outcomes.criticalSuccess.manualInstructions;
    }
    if (attackEffect === "push" && distance && rider.resolution.outcomes.success.forcedMovement) {
        rider.resolution.outcomes.success.forcedMovement.distance = Number(distance);
        const critical = rider.resolution.outcomes.criticalSuccess.forcedMovement;
        if (critical && critical.distance < Number(distance)) critical.distance = Number(distance);
    }
    return rider;
}

// Constrict: the listed damage to every creature it grabs, basic Fortitude
// save. Greater Constrict: a creature that fails also falls unconscious.
function constrict(item, { greater = false } = {}) {
    const html = item.system?.description?.value ?? "";
    const raw = inlineTags(html, "Check")[0];
    const check = raw ? readCheck(raw) : null;
    const components = damageComponents(html);
    if (!check?.dc || !components.length) return null;
    // (2026-10-13, a Battlezoo tyrant's: a condition added on a failure and a worse one instead on a critical failure — those on the failures; another
    // ability of its own added to the damage ("plus …"), a note.)
    const plain = htmlToPlainText(html.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ");
    const riders = /\bOn a failure, the creature is also ([^,;]+?)(?:, and|;) on a critical failure, (?:it is|they['’]re|it['’]s) ([^,.]+?) instead\./i.exec(plain);
    const plus = /\]\]? plus ([A-Z][\w' -]+?),/.exec(htmlToPlainText(html))?.[1] ?? /\bplus ([A-Z][\w' -]+?), @Check/.exec(html)?.[1];
    const plan = {
        ...base(item),
        targeting: { target: "creatures it has grabbed or restrained", range: "touch", area: null, grabbed: true },
        trigger: { event: "use" },
        resolution: { kind: "save", check: { roll: "save", statistic: "fortitude", basic: true, against: { dc: "fixed", value: check.dc } }, sharedDamage: { rollOnce: true, components }, outcomes: greaterRows(basicRows(components.map((component) => component.id)), greater) },
        ...(plus ? { notes: [`Plus its ${plus}.`] } : {})
    };
    if (riders) {
        const failure = readConditions(riders[1], { plain: STAGE_CONDITIONS });
        const worse = readConditions(riders[2], { plain: STAGE_CONDITIONS });
        if (failure.length && worse.length) {
            plan.resolution.outcomes.failure.effects = [...(plan.resolution.outcomes.failure.effects ?? []), ...failure];
            plan.resolution.outcomes.criticalFailure.effects = [...(plan.resolution.outcomes.criticalFailure.effects ?? []).filter((effect) => !worse.some((entry) => entry.slug === effect.slug)), ...worse];
        }
    }
    return plan;
}

// Wrap in Coils (2026-10-10, batch 30): "The python moves the creature into its coils, freeing its jaws to make attacks, then uses
// Constrict against the creature" (Prisoner Transfer: "… and then Constricts the creature it moved"): its own (Greater) Constrict
// on the creature it holds, as this action. Its other words (the coils' room) are the GM's notes.
function wrapInCoils(item, actor) {
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ");
    const uses = /\b(?:moves|transfers) the (?:grabbed )?creature (?:into|to) (?:its|their|his|her) (?:coils|manacles)\b[^.]*?,? (?:and )?then (?:uses (Greater )?Constrict against|Constricts) the creature\b/i.exec(plain);
    if (!uses || item.system?.actionType?.value !== "action") return null;
    const owner = actor ?? item.actor ?? item.parent;
    const own = [...(owner?.items ?? [])].find((entry) => entry?.type === "action" && /^(?:greater-)?constrict$/.test(glossarySlug(modernItem(entry)) ?? ""));
    const greater = own ? glossarySlug(modernItem(own)) === "greater-constrict" : false;
    const plan = own ? constrict(modernItem(own), { greater }) : null;
    if (!plan) return null;
    const notes = plain.replace(/^.*?(?:Requirements? .+? )?Effect /i, "").split(/(?<=\.)\s+/).filter((sentence) => !/\bConstrict/i.test(sentence) && sentence.trim());
    return { ...plan, ...base(item), targeting: plan.targeting, trigger: plan.trigger, resolution: plan.resolution, ...(notes.length ? { notes } : {}) };
}

function greaterRows(outcomes, greater) {
    if (!greater) return outcomes;
    for (const degree of ["failure", "criticalFailure"]) outcomes[degree].effects = [condition("unconscious")];
    return outcomes;
}

// Frightful Presence: an aura; a creature saves once (Will), then is immune for a minute.
function frightfulPresence(item) {
    const html = item.system?.description?.value ?? "";
    const raw = inlineTags(html, "Check")[0];
    const check = raw ? readCheck(raw) : null;
    const radius = Number(/(\d+) feet/.exec(htmlToPlainText(html))?.[1]) || 30;
    if (!check?.dc) return null;
    return {
        ...base(item, { time: "passive" }),
        targeting: { target: "creatures that enter the aura", range: null, area: { type: "emanation", value: radius } },
        // PF2e's glossary text: "A creature that first enters the area …"
        trigger: { event: "aura", when: ["enter"], immunity: immunityDetails("Regardless of the result of the saving throw, the creature is temporarily immune to this monster's Frightful Presence for 1 minute.") },
        resolution: {
            kind: "save",
            check: { roll: "save", statistic: "will", basic: false, against: { dc: "fixed", value: check.dc } },
            sharedDamage: null,
            outcomes: { criticalSuccess: none(), success: { ...none(), effects: [condition("frightened", 1)] }, failure: { ...none(), effects: [condition("frightened", 2)] }, criticalFailure: { ...none(), effects: [condition("frightened", 4)] } }
        }
    };
}

// Stench: an aura; a creature saves once (Fortitude): sickened 1, or on a
// critical failure sickened 1 and slowed 1 (as long as it's sickened).
function stench(item) {
    const html = item.system?.description?.value ?? "";
    const raw = inlineTags(html, "Check")[0];
    const check = raw ? readCheck(raw) : null;
    const aura = (item.system?.rules ?? []).find((rule) => rule?.key === "Aura");
    const radius = Number(aura?.radius) || Number(/(\d+) feet/.exec(htmlToPlainText(html))?.[1]) || 30;
    if (!check?.dc) return null;
    return {
        ...base(item, { time: "passive" }),
        targeting: { target: "creatures that enter the aura", range: null, area: { type: "emanation", value: radius } },
        // PF2e's glossary text: "A creature entering the aura or starting its turn in the area …"
        trigger: { event: "aura", when: ["enter", "start-turn"], immunity: immunityDetails("A creature that succeeds at its save or recovers from being sickened is temporarily immune to all stench auras for 1 minute.") },
        resolution: {
            kind: "save",
            check: { roll: "save", statistic: "fortitude", basic: false, against: { dc: "fixed", value: check.dc } },
            sharedDamage: null,
            // "slowed 1 as long as it's sickened": a duration tied to the other condition.
            outcomes: { criticalSuccess: none(), success: none(), failure: { ...none(), effects: [condition("sickened", 1)] }, criticalFailure: { ...none(), effects: [condition("sickened", 1), condition("slowed", 1, { mode: "while", condition: "sickened" })] } }
        }
    };
}

const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
const sizeOf = (text) => SIZES.find((size) => new RegExp(`^${size}\\b`, "i").test(text.trim())) ?? null;

// Swallow Whole: an Athletics check against the Reflex DC of a creature it
// holds. On a success, the creature is swallowed: it takes the listed damage
// now and at the end of each of its turns, until it Escapes, cuts itself free
// (Rupture) or the monster dies.
function swallowWhole(item) {
    const html = item.system?.description?.value ?? "";
    const plain = htmlToPlainText(html);
    const formula = damageComponents(html)[0]?.formula;
    const rupture = Number(/Rupture (\d+)/i.exec(plain)?.[1]) || null;
    if (!formula) return null;
    const swallowed = () => ({ damage: { mode: "formulas", formulas: [{ formula }], rollScope: "outcome" }, effects: [{ kind: "swallow", damage: formula, rupture, size: sizeOf(plain) }] });
    return {
        ...base(item),
        targeting: { target: "a creature it has grabbed or restrained", range: "touch", area: null, grabbed: true, size: sizeOf(plain) },
        trigger: { event: "use" },
        resolution: {
            kind: "check",
            check: { roll: "skill", statistic: "athletics", against: { dc: "target", statistic: "reflex" } },
            sharedDamage: null,
            outcomes: { criticalSuccess: swallowed(), success: swallowed(), failure: none(), criticalFailure: none() }
        }
    };
}

// Engulf: Strides up to double its Speed through creatures of its size or
// smaller; each attempts a Reflex save, and on a failure is engulfed: as
// Swallow Whole, with the listed Escape DC and Rupture.
//   @Check[reflex|dc:22|…], @Damage[(4d6)[acid]] damage, [[/act escape dc=22]], Rupture 15
function engulf(item, actor) {
    const html = item.system?.description?.value ?? "";
    const raw = inlineTags(html, "Check")[0];
    const check = raw ? readCheck(raw) : null;
    const formula = damageComponents(html)[0]?.formula ?? null;
    const escapeDC = Number(/\[\[\/act escape dc=(\d+)\]\]/i.exec(html)?.[1]) || null;
    const rupture = Number(/Rupture (\d+)/i.exec(htmlToPlainText(html))?.[1]) || null;
    // "…save, no damage, Escape DC 35, Rupture 28" (a water elemental vessel): engulfed, with no damage each turn.
    if (!check?.dc || (!formula && !/\bno damage\b/i.test(htmlToPlainText(html)))) return null;
    const sizes = { tiny: "tiny", sm: "small", med: "medium", lg: "large", huge: "huge", grg: "gargantuan" };
    const size = sizes[(actor ?? item.actor ?? item.parent)?.system?.traits?.size?.value] ?? "medium";
    const engulfed = () => ({ damage: formula ? { mode: "formulas", formulas: [{ formula }], rollScope: "outcome" } : none().damage, effects: [{ kind: "swallow", damage: formula, rupture, size, escapeDC }] });
    return {
        ...base(item),
        targeting: { target: "creatures whose space it moves through", range: null, area: null, trample: { size, strides: 2 } },
        trigger: { event: "use" },
        resolution: { kind: "save", check: { roll: "save", statistic: "reflex", basic: false, against: { dc: "fixed", value: check.dc } }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: none(), failure: engulfed(), criticalFailure: engulfed() } }
    };
}

// The damage rolls of the creature's Strike with this name, as damage components.
function strikeComponents(item, name, actor) {
    const items = [...(actor?.items ?? item?.actor?.items ?? item?.parent?.items ?? [])];
    const wanted = name.trim().toLowerCase();
    // The name, its start, or its last word ("blade" for a Dulled Blade).
    const strike = items.find((entry) => entry.type === "melee" && entry.name.toLowerCase() === wanted) ?? items.find((entry) => entry.type === "melee" && entry.name.toLowerCase().startsWith(wanted))
        ?? (wanted ? items.find((entry) => entry.type === "melee" && entry.name.toLowerCase().endsWith(` ${wanted}`)) : null);
    if (!strike) return [];
    return Object.values(strike.system?.damageRolls ?? {}).filter((roll) => roll?.damage).map((roll, index) => ({ id: String(index), formula: `(${roll.damage})[${roll.damageType ?? "untyped"}]`, type: null, category: roll.category ?? null }));
}

// Trample: Strides up to double its Speed through creatures of the listed
// size or smaller; each takes the listed Strike's damage (basic Reflex).
// Inexorable March (2026-10-12, batch 242): a Stride up to its Speed that shoves back each creature in its way, where a creature may stand
// against it with a Fortitude save — unhurt on a critical success, else taking its fist's damage → Trample's targeting over one Stride, any
// size: a success bars the way with the fist's damage, a critical success unhurt; a failure is pushed back along its path (a note). null
// otherwise.
function inexorableMarch(item, actor) {
    if (item.system?.actionType?.value !== "action") return null;
    // (Older bestiaries put the save and the critical success first, "@Check[fortitude|dc:34] On a critical success, …", then the Stride.)
    const html = String(item.system?.description?.value ?? "");
    const plain = htmlToPlainText(html.replace(/@Check\[[^\]]*\](?:\{[^}]*\})?/g, "")).replace(/\s+/g, " ").trim();
    const dc = Number(/@Check\[(?:type:)?fortitude\|dc:(\d+)/i.exec(html)?.[1]);
    const stride = /(?:^|\.\s)(?:The )?[^.]+? Strides up to (?:its|their) Speed, pushing back each creature whose space it moves into and damaging them if they try to stop its movement\. A creature can attempt to bar the way by succeeding at an? (?:Fortitude )?save\./i.test(plain);
    const fist = /(?:^|\.\s)On a critical success, the resisting creature takes no damage; otherwise,? it(?: is|['’]s) damaged as if hit by (?:the [\w' -]+?['’]s|its|their) ([\w' -]+?)\./i.exec(plain);
    if (!dc || !stride || !fist) return null;
    const match = [null, dc, fist[1]];
    const components = strikeComponents(item, match[2], actor);
    if (!components.length) return null;
    const hurt = { damage: { mode: "shared", multiplier: 1, sourceComponentIds: components.map((component) => component.id) }, effects: [] };
    return {
        ...base(item),
        targeting: { target: "creatures whose space it moves through", range: null, area: null, trample: { size: "gargantuan", strides: 1 } },
        trigger: { event: "use" },
        resolution: { kind: "save", check: { roll: "save", statistic: "fortitude", basic: false, against: { dc: "fixed", value: Number(match[1]) } }, sharedDamage: { rollOnce: true, components }, outcomes: { criticalSuccess: none(), success: hurt, failure: none(), criticalFailure: none() } },
        notes: ["A creature that succeeds bars its way (its movement stops there); one that fails is pushed back ahead of it."]
    };
}

// A push for every creature in its own aura (2026-10-12, batch 242, Hurricane Blast): "The jaathoom moves all creatures without the air trait in
// their turbulent skies aura 20 feet directly away, clockwise, or counterclockwise. A creature avoids being moved if it succeeds at a … Fortitude
// save.", the djinni's "… all creatures in its whirlwind pushes back 20 feet, or forces all creatures in the aura to move 20 feet clockwise or
// counterclockwise. Each creature must attempt a … save. On a success, it avoids being moved, and on a critical failure it falls Prone in addition
// to being moved. Creatures with the air trait are immune." → a Fortitude save in that aura's emanation (its Aura rule's radius): a failure pushed
// that far away, a critical failure Prone too where it says so; around it instead and the immune trait, notes. null otherwise.
function auraPush(item, actor) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const dc = Number(/@Check\[(?:type:)?fortitude\|dc:(\d+)/i.exec(html)?.[1]);
    if (!dc) return null;
    const plain = htmlToPlainText(html.replace(/@Check\[[^\]]*\](?:\{[^}]*\})?/g, "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim().replace(/^Frequency [^.]+?\.? Effect /i, "");
    const moves = /^(?:The )?[^.]+? moves all creatures without the (\w+) trait in (?:its|their) ([\w' -]+?) aura (\d+) feet directly away, clockwise, or counterclockwise\. A creature avoids being moved if it succeeds at an? save\.$/i.exec(plain);
    const blows = moves ? null : /^(?:The )?[^.]+? all creatures in its ([\w' -]+?) pushes back (\d+) feet, or forces all creatures in the aura to move \d+ feet clockwise or counterclockwise\. Each creature must attempt an? save\. On a success, it avoids being moved, and on a critical failure it falls Prone in addition to being moved\. Creatures with the (\w+) trait are immune\.$/i.exec(plain);
    if (!moves && !blows) return null;
    const [auraName, distance, trait] = moves ? [moves[2], moves[3], moves[1]] : [blows[1], blows[2], blows[3]];
    const aura = [...(actor?.items ?? [])].find((entry) => String(entry.name ?? "").toLowerCase() === auraName.toLowerCase());
    const radius = Number((aura?.system?.rules ?? []).find((rule) => rule.key === "Aura")?.radius) || Number(/^\s*(?:<p>)?\s*(\d+) feet\b/i.exec(aura?.system?.description?.value ?? "")?.[1]) || 0;
    if (!radius) return null;
    const push = { kind: "push", distance: Number(distance), upTo: false, optional: false, direction: "away" };
    const failed = { ...none(), forcedMovement: push };
    const critical = blows ? { ...none(), effects: [{ kind: "condition", slug: "prone", value: null, duration: null }], forcedMovement: push } : failed;
    return {
        ...base(item),
        targeting: { target: null, range: null, area: { type: "emanation", value: radius } },
        trigger: { event: "use" },
        resolution: { kind: "save", check: { roll: "save", statistic: "fortitude", basic: false, against: { dc: "fixed", value: dc } }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: none(), failure: failed, criticalFailure: critical } },
        notes: [`Or ${distance} feet around it, clockwise or counterclockwise, instead of away (the GM's choice).`, `Creatures with the ${trait.toLowerCase()} trait aren't moved.`]
    };
}

// A flight that throws creatures into the air (2026-10-12, batch 243, Typhoon Fling): "Flies up to half its Fly speed. All creatures the dragon
// passes within 10 feet of must attempt a … Fortitude save or be blown 120 feet up in the air and then fall, taking fall damage as appropriate.
// Creatures already airborne add their current height to the distance fallen." → Trample's targeting over one move, any size: a failed save
// takes half the height as bludgeoning damage and lands Prone; a height already in the air, a note. null otherwise.
function blownAloft(item) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const dc = Number(/@Check\[(?:type:)?fortitude\|dc:(\d+)/i.exec(html)?.[1]);
    if (!dc) return null;
    const plain = htmlToPlainText(html.replace(/@Check\[[^\]]*\](?:\{[^}]*\})?/g, "")).replace(/\s+/g, " ").trim().replace(/^Frequency [^.]+?\.? Effect /i, "");
    const match = /^(?:The )?[^.]+? Flies up to half (?:its|their) Fly speed\. All creatures (?:the [\w' -]+?|it|they) pass(?:es)? within (\d+) feet of must attempt an? save or be blown (\d+) feet up in the air and then fall, taking fall damage as appropriate\. Creatures already airborne add their current height to the distance fallen\.$/i.exec(plain);
    if (!match) return null;
    const fall = Math.floor(Number(match[2]) / 2);
    const thrown = { damage: { mode: "formulas", formulas: [{ formula: `${fall}[bludgeoning]` }], rollScope: "target" }, effects: [{ kind: "condition", slug: "prone", value: null, duration: null }] };
    return {
        ...base(item),
        targeting: { target: "creatures whose space it moves through", range: null, area: null, trample: { size: "gargantuan", strides: 1 } },
        trigger: { event: "use" },
        resolution: { kind: "save", check: { roll: "save", statistic: "fortitude", basic: false, against: { dc: "fixed", value: dc } }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: none(), failure: thrown, criticalFailure: structuredClone(thrown) } },
        notes: [`Creatures within ${match[1]} feet of its path; it Flies up to half its fly Speed.`, `A creature that fails falls ${match[2]} feet (plus any height it was already at: more damage, the GM's).`]
    };
}

function trample(item, actor) {
    const html = item.system?.description?.value ?? "";
    const raw = inlineTags(html, "Check")[0];
    const check = raw ? readCheck(raw) : null;
    const first = htmlToPlainText(html.split(/<hr\s*\/?>/i)[0]);
    let [sizeText, strikeName] = first.split(/[,;]/).map((part) => part.trim());
    // The damage itself in place of a Strike's name ("Large or smaller, @Damage[(2d6+2)[bludgeoning]], …").
    let second = html.split(/<hr\s*\/?>/i)[0].replace(/<[^>]+>/g, "").split(/[,;]\s*(?![^[]*\])/)[1] ?? "";
    // The listing after other text ("Requirements … Effect As Trample, except … Huge or smaller, body, @Check…"), or
    // written out ("creatures of size Small or smaller …, the damage of the headbutt Strike").
    if (!sizeOf(sizeText ?? "")) {
        const flat = html.split(/@Localize\[/i)[0].replace(/<[^>]+>/g, " ");
        const listing = /\b((?:tiny|small|medium|large|huge|gargantuan) or smaller)\s*[,;]\s*(@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?|[^,;@]*)/i.exec(flat);
        const size = listing?.[1] ?? /\b((?:tiny|small|medium|large|huge|gargantuan) or smaller)\b/i.exec(flat)?.[1];
        sizeText = size ?? sizeText;
        second = listing?.[2] ?? "";
        strikeName = listing ? htmlToPlainText(listing[2]).trim() : /\bdamage of (?:the|its) ([\w' -]+?) Strike\b/i.exec(htmlToPlainText(flat))?.[1] ?? null;
    }
    const listed = /^\s*@Damage\[/.test(second) ? damageComponents(second) : [];
    // "hoof (3d6+6 damage; Prone creatures take 4d6+6 damage)": the Strike named before the brackets.
    const named = listed.length ? listed : strikeName ? strikeComponents(item, strikeName.replace(/\s*\(.*$/, ""), actor) : [];
    // No such Strike (a troop has none): the first damage written beside the name.
    const components = named.length ? named : damageComponents(second).slice(0, 1);
    if (!check?.dc || !components.length) return null;
    return {
        ...base(item),
        targeting: { target: "creatures whose space it moves through", range: null, area: null, trample: { size: sizeOf(sizeText ?? "") ?? "medium", strides: 2 } },
        trigger: { event: "use" },
        // "…; creatures that fail the save are also knocked Prone" (the glossary's own text is a @Localize, not read).
        resolution: { kind: "save", check: { roll: "save", statistic: "reflex", basic: true, against: { dc: "fixed", value: check.dc } }, sharedDamage: { rollOnce: true, components }, outcomes: withRiders(basicRows(components.map((component) => component.id)), html.split(/<hr\s*\/?>|@Localize\[/i)[0], components) }
    };
}

// A basic save's rows with what a failure or critical failure adds (2026-10-10): "A creature that fails its save is
// also Stupefied 1", "Creatures that critically fail also take 5 persistent acid damage", "also knocked Prone". Not
// when they're one of several effects to choose from ("chooses one of the following additional effects").
function withRiders(outcomes, html, components) {
    const riders = /\bchooses? one of the following\b|\bone of the following (?:additional )?effects\b/i.test(htmlToPlainText(html)) ? null : saveOrOutcomes(html, [], { riders: true });
    if (riders) for (const degree of ["success", "failure", "criticalFailure"]) {
        const rider = riders[degree];
        const row = outcomes[degree];
        row.effects = rider.effects;
        if (rider.forcedMovement) row.forcedMovement = rider.forcedMovement;
        // Not the save's own damage again ("must succeed at a basic Reflex save or take 6d6 sonic damage").
        const extra = rider.damage?.mode === "formulas" ? rider.damage.formulas.filter((entry) => !components.some((component) => component.formula === entry.formula)) : [];
        if (extra.length) row.damage = { mode: "mixed", shared: row.damage, formulas: extra, rollScope: "outcome" };
    }
    return outcomes;
}

// Drink Blood and its kin (vampires, strigoi): "This requires an @Check[athletics|defense:fortitude] check against the
// victim's Fortitude DC if the victim is grabbed …. The victim is Drained 2 and the vampire regains 16 HP". A success
// drains the victim; the monster's healing (none when the victim was already drained) and the automatic cases are the
// GM's, said on the card.
function drinkBlood(item) {
    const html = item.system?.description?.value ?? "";
    const plain = htmlToPlainText(html.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1"));
    // (Batch 31: Drain Qi's "drains the victim's life energy", Drain Thoughts' "consumes its memories", Slurp Blood's "slurping its
    // blood", besides Drink Blood's "sinks its fangs".)
    if (!/\b(?:sinks? (?:its|their|his|her) fangs|drinks? (?:its|the|their) blood|drink its blood|Drink (?:Blood|Essence)|drains the (?:victim|creature)'s life energy|consumes its memories|slurping its blood)\b/i.test(`${item.name} ${plain}`)) return null;
    const check = readSkillCheck(html) ?? (/\ban Athletics check against the (?:victim|target|creature)'s Fortitude DC\b/i.test(plain) ? { roll: "skill", statistic: "athletics", against: { dc: "target", statistic: "fortitude" } } : null);
    // The victim's condition ("is Drained 1", "is Stupefied 1 (Stupefied 2 if Taviah's Athletics check is a critical success)") and
    // damage ("The victim takes 1d6+1 piercing damage").
    const struck = /\b(?:victim|creature|target) (?:is|becomes) (Drained|Stupefied|Enfeebled|Clumsy) (\d+)(?: \((?:\w+) (\d+) if [^)]*?critical success\))?/i.exec(plain);
    const formulas = inlineTags(html, "Damage").map(readDamage);
    const damage = formulas.filter((formula) => !/healing/i.test(formula));
    // When no check is needed: "…and is automatic for any of the other conditions", "If the victim is grabbed, this is automatic".
    const automatic = /\bif the (?:victim|creature) is grabbed,? this is automatic\b/i.test(plain) ? "No check is needed against a grabbed victim: count it as a success."
        : /\bautomatic for any of the other conditions\b/i.test(plain) ? "No check is needed against a paralyzed, restrained, unconscious or willing victim: count it as a success." : null;
    if (!check || check.statistic !== "athletics" || (!struck && !damage.length) || damage.length > 1) return null;
    // Its healing: "regains 15 Hit Points", "regains 12 HP, gaining any excess as temporary HP".
    const healing = formulas.find((formula) => /healing/i.test(formula));
    const amount = healing ? healing.replace(/\[healing(?:,[a-z]+)?\]/i, "").replace(/^\((.*)\)$/, "$1") : /\bregains (\d+) (?:HP|Hit Points)\b/i.exec(plain)?.[1] ?? null;
    const excess = /\bgaining any excess(?: HP)? as temporary (?:HP|Hit Points)\b/i.test(plain);
    // "Drinking Blood from a creature that's already drained doesn't restore any Hit Points": the GM's, as a reminder.
    const already = /\balready (?:drained|stupefied)\b/i.test(plain);
    const slug = struck?.[1].toLowerCase();
    const heal = amount && !already ? [{ kind: "heal", ...(/^\d+$/.test(amount) ? { amount: Number(amount) } : { formula: amount }), ...(excess ? { excessAsTemp: true } : {}), recipient: "self" }] : [];
    const row = (value) => ({
        damage: damage.length ? { mode: "formulas", formulas: [{ formula: damage[0] }], rollScope: "outcome" } : none().damage,
        effects: [...(slug ? [condition(slug, value)] : []), ...heal]
    });
    return {
        ...base(item),
        targeting: { target: "the victim", range: "touch", area: null },
        trigger: { event: "use" },
        resolution: {
            kind: "check",
            check,
            sharedDamage: null,
            outcomes: { criticalSuccess: row(Number(struck?.[3] ?? struck?.[2])), success: row(Number(struck?.[2])), failure: none(), criticalFailure: none() },
            reminders: [
                ...(amount && already ? [`{source} regains ${amount} Hit Points${excess ? " (any excess as temporary Hit Points)" : ""}, unless {target} was already ${slug}; then {target}'s ${slug} value goes up by 1 instead.`] : []),
                ...(automatic ? [automatic] : [])
            ]
        }
    };
}

// Blood Drain (2026-10-10, batch 31): "Requirements The manananggal has a creature Grabbed Effect The manananggal drives their tongue
// into the grabbed creature to drink its blood. This deals 4d6 damage, and the manananggal gains temporary Hit Points equal to the
// damage dealt. A creature whose blood is drained by a manananggal is Drained 1 until it receives healing (of any kind or amount)."
// Damage with no roll on the creature it holds, Drained until healed, temporary Hit Points equal to the damage (or its healing,
// "regains 8 Hit Points, gaining any excess as temporary Hit Points"). Temporary Hit Points only for some creatures ("If the
// creature is a demon, fey, or sorcerer, …") are the GM's.
function bloodDrain(item) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const plain = htmlToPlainText(html.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    // (Batch 34, Passionate Kiss: "The succubus engages a creature they have Grabbed or Restrained … to drain its vital essence".)
    const effect = plain.replace(/^.*?\bEffect\s+/i, "");
    if (!/^Requirements? (?:The|A|An) [^.]*?\bhas a creature Grabbed\b/i.test(plain) && !/\ba creature (?:it|they|he|she) (?:has|have) Grabbed\b/i.test(effect)) return null;
    const sentences = effect.split(/(?<=\.)\s+/);
    const formulas = inlineTags(html, "Damage").map(readDamage);
    const damage = formulas.filter((formula) => !/healing/i.test(formula));
    // (Batch 229, Battlezoo: roots drinking from the creature it holds.)
    if (damage.length !== 1 || !/\bdrains? (?:blood|blood or ichor|vitality)\b|\bdrink its blood\b|\bdrain its vital essence\b|\blaps? up the blood\b|\bslurps? (?:up )?(?:the )?blood\b/i.test(effect)) return null;
    const untilHealed = /\bis Drained (\d+) until it receives(?: any kind or amount of)? healing\b/i.exec(effect);
    const drained = untilHealed ?? /\bmakes the creature Drained (\d+) or increases its drained (?:value|condition) by 1\b/i.exec(effect);
    let temp = false;
    const reminders = [];
    let heal = null;
    for (const sentence of sentences) {
        // ("… Drained 1 or increases its drained value by 1, to a maximum of 4": the increase the GM's.)
        if (/\bmakes the creature Drained \d+ or increases its drained (?:value|condition) by 1\b/i.test(sentence)) {
            reminders.push("If {target} was already drained, its drained value goes up by 1 instead (to a maximum of 4).");
            continue;
        }
        // (A save after it, "… or be affected by a Suggestion to submit …": the GM's.)
        if (/^The target must succeed at an? @Check\[[^\]]*\] save or be affected by [^.]+\.$/i.test(sentence)) {
            reminders.push(sentence.replace(/@Check\[(\w+)\|dc:(\d+)[^\]]*\]/i, (_all, statistic, dc) => `DC ${dc} ${statistic[0].toUpperCase()}${statistic.slice(1)}`).replace(/^The target/, "{target}"));
            continue;
        }
        if (/@Damage\[[^\]]*(?:untyped|piercing|bludgeoning|slashing|void|bleed)/i.test(sentence) && /\b(?:deals?|dealing|takes)\b/i.test(sentence)) {
            if (/\bgains? temporary Hit Points equal to the damage dealt\b/i.test(sentence)) temp = true;
            if (/\bregains Hit Points equal to the damage dealt\b/i.test(sentence)) heal = { kind: "heal", fromDamage: true, recipient: "self" };
            const regains = /\bregains @Damage\[([^\]]*\[healing\])\]/i.exec(sentence);
            if (regains) heal = { kind: "heal", amount: Number(readDamage(regains[1]).replace(/\[healing\]/i, "")) || null, excessAsTemp: /\bgaining any excess\b/i.test(sentence), recipient: "self" };
            continue;
        }
        if (/^If the creature (?:is|has) [^.]+?, (?:the [\w' -]+?|it) gains temporary Hit Points equal to the damage dealt\.$/i.test(sentence)) {
            reminders.push(sentence.replace(/^If the creature/i, "If {target}").replace(/, (?:the [\w' -]+?|it) gains/i, ", {source} gains"));
            continue;
        }
        if (/\bis Drained \d+ until it receives\b/i.test(sentence)) continue;
        if (/^(?:The|A|An) [\w' -]+? (?:drains|drives|sinks|engages|laps? up|slurps?) [^.@]+\.$/i.test(sentence)) continue;
        return null;
    }
    if (heal && !heal.fromDamage && !Number.isFinite(heal.amount)) return null;
    const effects = [...(drained ? [condition("drained", Number(drained[1]))] : []), ...(temp ? [{ kind: "temp-hp", fromDamage: true, recipient: "self" }] : []), ...(heal ? [heal] : [])];
    const success = { damage: { mode: "formulas", formulas: [{ formula: damage[0] }], rollScope: "outcome" }, effects };
    return {
        ...base(item),
        targeting: { target: "the creature it holds", range: "touch", area: null, grabbed: true },
        trigger: { event: "use" },
        resolution: {
            kind: "check",
            check: { roll: "automatic", statistic: "automatic" },
            sharedDamage: null,
            outcomes: { criticalSuccess: none(), success, failure: none(), criticalFailure: none() },
            reminders: [...(untilHealed ? [`{target}'s drained lasts until it receives healing of any kind or amount.`] : []), ...reminders]
        }
    };
}

// Buck (the glossary's): the triggering rider must succeed at a Reflex save against the listed DC or fall off and
// land Prone; on a critical failure it also takes 1d6 bludgeoning damage (and the fall's, the GM's).
function buck(item) {
    const raw = inlineTags(item.system?.description?.value ?? "", "Check")[0];
    const check = raw ? readCheck(raw) : null;
    if (!check?.dc) return null;
    return {
        ...base(item),
        targeting: { target: "the triggering rider", range: "touch", area: null },
        trigger: { event: "use" },
        resolution: {
            kind: "save",
            check: { roll: "save", statistic: "reflex", basic: false, against: { dc: "fixed", value: check.dc } },
            sharedDamage: null,
            outcomes: { criticalSuccess: none(), success: none(), failure: { ...none(), effects: [condition("prone")] }, criticalFailure: { damage: { mode: "formulas", formulas: [{ formula: "1d6[bludgeoning]" }], rollScope: "outcome" }, effects: [condition("prone")] } }
        }
    };
}

// Outcomes written as prose rather than sections:
// - "… must succeed at a @Check[will|dc:28] save or become Stupefied 2 (Stupefied 4 on a critical failure)."
// - "dealing @Damage[6d6[mental]] damage in a @Template[cone|distance:20] (@Check[will|dc:25] save).
//   A creature that fails its save is Slowed 1 for 1 round (or Slowed 2 on a critical failure)."
// - "… must succeed at a @Check[reflex|dc:17] save or take @Damage[1d4[acid]] damage … (on a critical failure, the creature also falls Prone)."
// Damage dealt before the save (a breath) is halved on a success, as a basic save. null when the text isn't one of these.
// A save's results said in sentences after it (html from the check on).
//   "…save, becoming Frightened 2 on a failure. On a critical failure, it's also Fleeing…"
//   "…save. On a failure, the creature is Frightened 2; on a critical failure, it's Frightened 4."
//   "…save. If it fails, it's Slowed 1 for 1 minute, and if it critically fails, it is instead Paralyzed…"
//   "…save. On a success, the creature gains the Frightened 1 condition; on a failure, …"
// → { failure: html | null, critical: { text, adds } | null, success: html | null }. A degree named inside
// brackets ("Frightened 2 (Frightened 3 on a critical failure)") is left to the failure's own reading.
const SUBJECT = String.raw`(?:it(?:'s| is)|it becomes|they are|they become|the (?:creature|target) (?:is|becomes)|a creature (?:is|becomes)|creatures are)`;
// Who a result sentence is about: "A creature that fails", "Targets who critically fail their saving throw".
const WHO = String.raw`(?:(?:A|Each|Any) (?:creature|target|foe|enemy)|(?:Creatures|Targets|Foes|Enemies|Those)|(?:and )?one)`;
const FAIL_LEAD = new RegExp(String.raw`(?:On a (?:failure|failed save|failed or critically failed save)|If (?:it|they|the (?:creature|target)) fails?(?: (?:its|the|this|their) (?:save|saving throw))?|${WHO} (?:that|who) fails?(?: (?:its|the|this|their) (?:saves?|saving throws?))?)\s*,?\s*`, "i");
const CRIT_LEAD = new RegExp(String.raw`(?:On a critical failure|On a critically failed save|If (?:it|they|the (?:creature|target)) critically fails?(?: (?:its|the|this|their) (?:save|saving throw))?|${WHO} (?:that|who) critically fails?(?: (?:its|the|this|their) (?:saves?|saving throws?))?)\s*,?\s*`, "i");
const SUCCESS_LEAD = /(?:On a (?:success|successful save)|If (?:it|they|the (?:creature|target)) succeeds?(?: at (?:its|the|this|their) (?:save|saving throw))?)\s*,?\s*/i;
function proseOutcomes(html, { criticalOnly = false } = {}) {
    const text = String(html).replace(/<\/?(?:p|hr|strong|em)[^>]*>/gi, " ").replace(/\s+/g, " ");
    // Brackets masked, so a degree named inside them isn't taken for a clause of its own.
    const masked = text.replace(/\([^()]*\)/g, (group) => `(${"_".repeat(group.length - 2)})`);
    // A lead that ends its sentence ("…2d6 bleed, or 4d6 bleed on a critical failure.") closes a clause rather than opening one.
    const find = (lead) => {
        for (const match of masked.matchAll(new RegExp(lead.source, "gi"))) {
            if (!/^(?:[.;)]|$)/.test(masked.slice(match.index + match[0].length))) return { at: match.index, from: match.index + match[0].length };
        }
        return null;
    };
    const crit = find(CRIT_LEAD);
    const succ = find(SUCCESS_LEAD);
    // A clause runs to the end of its sentence or the next degree's lead.
    const clause = (from) => {
        // A semicolon ends it only before another degree's lead ("…; on a critical failure, …"), which cuts it below.
        // …or before a condition of its own ("…; if the Strike was an unarmed attack, …"), which is the GM's.
        let end = masked.slice(from).search(/(?<=\.)\s|;\s*(?=(?:if|unless)\b)/i);
        end = end < 0 ? text.length : from + end;
        for (const other of [crit, succ]) if (other && other.at >= from && other.at < end) end = other.at;
        return text.slice(from, end).replace(/[\s,;.]*(?:and|or)?[\s,;.]*$/i, "");
    };
    // "A creature is Dazzled for 1 round on a success, Blinded for 1 round on a failure, and blinded for 1 minute on
    // a critical failure": each degree's own.
    const listed = new RegExp(`${SUBJECT}\\s+(.+?) on a success, (.+?) on a failure,? and (.+?) on a critical failure\\b`, "i").exec(text);
    if (listed) return { failure: `becomes ${listed[2]}`, critical: { text: listed[3], adds: false }, success: `becomes ${listed[1]}` };
    let failure = null;
    const becoming = /(?:saving throw|save),? becoming (.+?) on a failure\b/i.exec(text);
    if (becoming) failure = becoming[1];
    else {
        const lead = find(FAIL_LEAD);
        if (lead) failure = clause(lead.from).replace(new RegExp(`^${SUBJECT}\\s+`, "i"), "becomes ");
    }
    // Only a critical failure's rider ("Creatures that critically fail also take 5 persistent acid damage"), when asked.
    if (!failure && !(criticalOnly && crit)) return { failure: null, critical: null, success: null };
    // Left to the GM: a result about someone else ("the evangelist is Concealed from the creature"), or
    // results that differ by creature type ("Humanoids that fail… Animals are…").
    if (/^the (?!creature|target|victim)[\w' -]+? (?:is|becomes|gains)\b/i.test(htmlToPlainText(failure ?? clause(crit.from)).trim())) return { failure: null, critical: null, success: null };
    if (/\b(?:Humanoids|Animals|Undead|Constructs|Plants|Fey|Beasts|Dragons|Fiends|Celestials|Elementals)\b (?:that|who|are|is)\b/.test(htmlToPlainText(text))) return { failure: null, critical: null, success: null };
    // …or results that hang on the target's state ("if the creature was already Doomed, on a failed save, …").
    if (/\bif (?:the creature|it|the target|they) (?:was|is|were|are) already\b|\bwhile already\b/i.test(htmlToPlainText(text))) return { failure: null, critical: null, success: null };
    let critical = null;
    if (crit) {
        const raw = clause(crit.from);
        const adds = new RegExp(`^(?:${SUBJECT}\\s+|(?:is|are|becomes?)\\s+)?also\\b`, "i").test(raw);
        critical = { text: raw.replace(new RegExp(`^${SUBJECT}\\s+`, "i"), "").replace(/^(?:is|are|becomes?)\s+(?=also\b|instead\b)/i, "").replace(/^(?:also|instead)\s+/i, ""), adds };
    }
    const success = succ ? clause(succ.from) : null;
    return { failure, critical, success };
}

// Words that say the save is for someone the ability affects, not the monster saving for itself
// ("The golem attempts a Fortitude save", "Whenever a desa-desa takes electricity damage, it must attempt…").
const TARGET_WORDS = /\b(?:creatures?|targets?|enem(?:y|ies)|foes?|victims?|each|all|any|anyone|those|characters?|PCs?|riders?|attackers?|triggering|ally|allies|living|someone)\b/i;

// "X unless it succeeds at a @Check[…] save (Y on a critical failure)" → "becomes X (Y on a critical failure)", or null.
// (Batch 196, Gales of Laughter: "…, Deafening it for 1 round and causing @Damage[10d4[persistent,mental]] damage unless it succeeds on a … save." →
// "becomes Deafened for 1 round and takes @Damage[…] damage".)
const ING_CONDITIONS = { blinding: "Blinded", deafening: "Deafened", dazzling: "Dazzled", frightening: "Frightened", sickening: "Sickened", stunning: "Stunned", slowing: "Slowed" };
function unlessClause(sentence) {
    const ing = /(?:@UUID\[[^\]]*\]\{)?\b(Blinding|Deafening|Dazzling)\}? it( for \d+ rounds?)? and causing (@Damage\[(?:[^[\]]|\[[^\]]*\])*\]) damage unless (?:it|they|the (?:creature|target)) succeeds? (?:at|on) an? @Check\[[^\]]*\](?:\{[^}]*\})? (?:saving throw|save)\.?\s*$/i.exec(sentence);
    if (ing) return `becomes ${ING_CONDITIONS[ing[1].toLowerCase()]}${ing[2] ?? ""} and takes ${ing[3]} damage`;
    const match = /\b(becomes?|is|are|falls?|takes?) (.+?) unless (?:it|they|the (?:creature|target)) succeeds? (?:at|on) an? @Check\[[^\]]*\](?:\{[^}]*\})? (?:saving throw|save)(.*)$/i.exec(sentence);
    // ("takes 1d6 piercing damage unless it succeeds at a … save": the damage, 2026-10-10.)
    return match ? `${/^takes?$/i.test(match[1]) ? "takes" : "becomes"} ${match[2]}${/^\s*\(/.test(match[3]) ? ` ${match[3].trim()}` : ""}` : null;
}

function saveOrOutcomes(html, components, { afterHit = false, riders = false, triggered = false, names = [] } = {}) {
    // (Line breaks inside a paragraph read as spaces.)
    const sentences = String(html).replace(/<\/?p[^>]*>/gi, " ").replace(/\s+/g, " ").split(/(?<=\.)\s+(?=[A-Z@<])/);
    const index = sentences.findIndex((sentence) => /@Check\[(?:type:)?(?:fortitude|reflex|will)/i.test(sentence));
    if (index < 0) return null;
    // (A reaction set off by a hit, its own or a foe's, reads from its Effect on: the hit is its trigger's; batch 69.)
    const upTo = htmlToPlainText(sentences.slice(0, index + 1).join(" ")).replace(triggered ? /^[\s\S]*?\bEffect\b/ : /^(?!)/, "");
    // A save that follows a Strike's hit ("On a hit, …", "struck by this attack") or a death ("When the dancer dies"): not an action of its own.
    // (Batch 97: "The creature that dealt the triggering Strike must succeed at …" names the trigger's Strike, not one of its own.)
    if (!afterHit && !riders && /\bStrike\b|\bOn a (?:hit|success)\b|\bstruck by\b|\bhits\b/i.test(upTo.replace(/\b(?:dealt|made) the triggering Strike\b/gi, ""))) return null;
    if (/\bWhen (?:a creature (?:slays|kills)|(?:the|this|a|an) [\w' -]+? (?:dies|is (?:killed|destroyed|slain))|killed)\b/i.test(upTo)) return null;
    // Damage before the save counts only in the save's own sentence ("dealing 6d6 damage in a cone (Will save)").
    const checkAt = sentences[index].search(/@Check\[/i);
    if (components.length && !/@Damage\[/i.test(sentences[index].slice(0, checkAt))) components = [];
    // "must succeed at a … save or be …" (since 2026-10-10 also "must succeed a … saving throw or fall Prone").
    // (Batch 76: "… must succeed at a … save to avoid becoming Sickened 1 (Sickened 2 on a critical failure)", "… save to resist becoming
    // Slowed 1", "… save to avoid being knocked Prone": what it avoids is the failure's.)
    const legacy = /succeed at an? @Check\[[^\]]*\] (?:saving throw|save) or (.+)$/i.exec(sentences[index])?.[1] ?? /^(?:A|Each) creature that fails (?:its|the|this) save (.+)$/i.exec(sentences[index + 1] ?? "")?.[1] ?? /^On a failed save, (.+)$/i.exec(sentences[index + 1] ?? "")?.[1]
        ?? /(?:succeed at|attempt) an? @Check\[[^\]]*\](?:\{[^}]*\})? (?:saving throw|save) to (?:avoid|resist) (?:becoming|being) (.+)$/i.exec(sentences[index])?.[1]
        // (Batch 81: "If the target fails a … save, it gains Clumsy 1 and Stupefied 1", "…, they are Dazzled until …".)
        ?? /^If (?:the|that) (?:target|creature|foe) fails (?:an?|its|the) @Check\[[^\]]*\](?:\{[^}]*\})? (?:save|saving throw), (?:it|they|he|she) (?:gains?|becomes?|is|are) (.+)$/i.exec(sentences[index].replace(/^\s*(?:<[^>]+>\s*)+/, ""))?.[1] ?? null;
    // (Batch 96: "must succeed on a … save or become Stupefied 1", "must make a successful … save or become Frightened 1".)
    let failure = legacy ?? /(?:(?:succeed(?: at| on)?|attempt) an?|make a successful) @Check\[[^\]]*\](?:\{[^}]*\})? (?:saving throw|save) or (.+)$/i.exec(sentences[index])?.[1]
        // "becomes Frightened 1 unless they succeed at a @Check[will|dc:28] save (Frightened 2 on a critical failure)":
        // the brackets after the save are the failure's too.
        ?? unlessClause(sentences[index])
        ?? null;
    // "…unless it succeeds at a save": a success leaves it untouched, damage included.
    const negates = failure !== null && unlessClause(sentences[index]) === failure;
    // "…save or @Check[acrobatics|dc:15] check. On a failure, …": a choice of check; the results come after.
    // "…save or @Check[acrobatics|dc:20] check or fall Prone": the result after the choice.
    if (failure) {
        const choice = /^(?:an? )?(?:@Check\[[^\]]*\](?:\{[^}]*\})?|[A-Z][a-z]+) check\b(?:\s+or\s+(.+))?/.exec(failure.trim());
        if (choice) failure = choice[1] ?? null;
    }
    // "On a failed save, the creature falls Prone; on a critical failure, it is Immobilized": the critical failure's own.
    let legacyCritical = null;
    const critAt = failure ? failure.search(/[;,]\s*(?:and )?(?:on a critical failure|on a critically failed save|if (?:it|they|the (?:creature|target)) critically fails?)\b/i) : -1;
    if (critAt > 0) {
        const raw = failure.slice(critAt).replace(/^[;,]\s*(?:and )?/, "").replace(CRIT_LEAD, "");
        legacyCritical = { text: raw.replace(new RegExp(`^${SUBJECT}\\s+`, "i"), "").replace(/^(?:also|instead)\s+/i, ""), adds: new RegExp(`^(?:${SUBJECT}\\s+)?also\\b`, "i").test(raw) };
        failure = failure.slice(0, critAt);
    }
    // The results said after the save (2026-10-10): "…save, becoming Frightened 2 on a failure", or the next
    // sentences' "On a failure, …", "If it fails, …", "A creature who fails …", "…; on a critical failure, it's …".
    let proseCritical = null;
    let proseSuccess = null;
    const after = [sentences[index].slice(sentences[index].search(/@Check\[/i)), ...sentences.slice(index + 1, index + 3)].join(" ");
    if (!failure) {
        const prose = proseOutcomes(after, { criticalOnly: riders });
        failure = prose.failure;
        proseCritical = prose.critical;
        proseSuccess = prose.success;
    } else if (!legacyCritical) {
        // "…save or be Deafened for 1 round. On a critical failure, a creature is also Off-Guard for 1 round."
        const next = sentences.slice(index + 1, index + 3).join(" ");
        if (CRIT_LEAD.test(next)) proseCritical = proseOutcomes(next, { criticalOnly: true }).critical;
    }
    // A basic save's riders may be a critical failure's alone.
    if (!failure && !(riders && proseCritical)) return null;
    failure ??= "";
    // The newer readings only for a save someone else makes (not "The golem attempts a Fortitude save"); a basic
    // save's riders are its targets' already.
    const lead = `${sentences[index - 1] ?? ""} ${sentences[index].slice(0, sentences[index].search(/@Check\[/i))}`;
    // …or the save follows an area or damage of the ability's own ("exhales … in a @Template[cone] dealing @Damage[…] damage (@Check…").
    if (!legacy && !riders && !TARGET_WORDS.test(htmlToPlainText(lead)) && !/@Template\[|@Damage\[/.test(sentences[index].slice(0, sentences[index].search(/@Check\[/i)))) return null;
    // "(Stupefied 4 on a critical failure)" replaces; "(on a critical failure, the creature also falls Prone)" adds.
    let critical = null;
    let criticalAdds = false;
    // A sentence of its own that adds to the critical failure ("Creatures that critically fail also take …") on top of
    // the failure's own "(or Blinded on a critical failure)".
    let extraCritical = null;
    proseCritical ??= legacyCritical;
    // Tags inside the brackets ("(@Damage[(6d6+18)[piercing]] damage on a critical failure)") are read whole; what
    // follows a semicolon in them ("…on a critical failure; creatures in the hall gain +2 …)") isn't the critical's.
    const TAGGED = String.raw`(?:@(?:UUID|Damage)\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?|[^();@])`;
    // (Batch 69: also "(Enfeebled 2 if it critically fails)".)
    const replaced = new RegExp(String.raw`\((?:or )?(${TAGGED}+?) (?:on (?:a )?critical failure|if (?:it|they|the (?:creature|target)) critically fails?)(?:[;,][^()]*)?\)`, "i").exec(failure) ?? /,? or ((?:@(?:UUID|Damage)\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?|[^;.()@])+?) on (?:a )?critical failure\b/i.exec(failure);
    const added = new RegExp(String.raw`\(on (?:a )?critical failure,? (${TAGGED}+?)\)`, "i").exec(failure);
    const bracket = added ? { text: added[1], adds: true } : replaced ? { text: replaced[1], adds: false } : null;
    if (added) failure = failure.replace(added[0], "");
    else if (replaced) failure = failure.replace(replaced[0], "");
    const chosen = proseCritical && bracket && proseCritical.adds ? bracket : proseCritical ?? bracket;
    if (chosen) {
        critical = chosen.text;
        criticalAdds = chosen.adds;
        if (chosen === bracket && proseCritical) extraCritical = proseCritical.text;
    }
    // "(plus Slowed 1 as long as it's sickened on a critical failure)": in addition, not instead.
    if (critical && !criticalAdds && /^\s*(?:plus|and also|also)\b/i.test(htmlToPlainText(critical))) {
        criticalAdds = true;
        critical = critical.replace(/^\s*(?:plus|and also|also)\s+/i, "");
    }
    const read = (text) => readConditions(text, { plain: STAGE_CONDITIONS }).map((effect) => ({ ...effect, recipient: undefined })).map(({ recipient, ...effect }) => effect);
    const failEffects = read(failure);
    // "be automatically Shoved back 5 feet and knocked Prone"
    const SHOVE = /\b(?:push(?:es|ed)?|shoved?)(?: back| away)?(?: from (?:the |its |their )?[\w' -]+?)? (?:up to )?(\d+) feet/i;
    const shovedText = htmlToPlainText(failure.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1"));
    const shovedMatch = SHOVE.exec(shovedText);
    // Not a push the GM steers ("moved 20 feet in a direction of the dragon's choice", "toward the wall").
    const shoved = shovedMatch && !OTHER_WAY.test(shovedText.slice(shovedMatch.index + shovedMatch[0].length)) ? shovedMatch : null;
    // Not the monster's own healing ("Opkherab regains 3 Hit Points").
    const failDamage = inlineTags(failure, "Damage").filter((raw) => !/healing/i.test(raw)).map((raw) => ({ formula: readDamage(raw) }));
    const before = components.length && !failDamage.length;
    // "takes 1d6 void damage and must succeed at a … save or become Enfeebled 2": the damage comes whatever the save, which
    // decides only the rest (2026-10-10).
    const regardless = before && /\bdamage,? and (?:then )?must (?:succeed at|attempt) an?\s*$/i.test(sentences[index].slice(0, checkAt));
    // A critical failure's own damage: in addition when it says "also", otherwise in place of the failure's.
    const critDamage = critical ? inlineTags(critical, "Damage").filter((raw) => !/healing/i.test(raw)).map((raw) => ({ formula: readDamage(raw) })) : [];
    const extraDamage = extraCritical ? inlineTags(extraCritical, "Damage").filter((raw) => !/healing/i.test(raw)).map((raw) => ({ formula: readDamage(raw) })) : [];
    const critFormulas = [...(criticalAdds ? [...failDamage, ...critDamage] : critDamage.length ? critDamage : failDamage), ...extraDamage];
    // "…save or be pulled 10 feet toward the doblagub" (toward the monster); "…save or instantly die", "If it fails, it dies".
    const pulled = readPush(failure, names);
    const pull = pulled?.kind === "pull" ? pulled : null;
    const dies = /^\s*(?:(?:it|they|the (?:creature|target)) )?(?:instantly |immediately )?(?:die|dies|be (?:instantly )?(?:killed|slain))\b/i.test(htmlToPlainText(failure));
    // "…save or take a –1 status penalty to attack rolls until the end of its next turn".
    // (Batch 127: after its subject too, "On a failure, a creature takes a –10-foot circumstance penalty to its Speed for 1 minute".)
    const penalties = /^\s*(?:(?:an?|the|that|each) (?:creature|target) )?(?:take|takes|be|suffer)\b/i.test(htmlToPlainText(failure)) ? readPenalties(failure) : [];
    if (!failEffects.length && !failDamage.length && !before && !shoved && !pull && !dies && !penalties.length && !(riders && (critDamage.length || extraDamage.length || (critical && (read(critical).length || /\bpush|\bshove/i.test(critical)))))) return null;
    const row = (effects, damage, multiplier) => ({
        damage: before ? { mode: "shared", multiplier, sourceComponentIds: components.map((component) => component.id) } : damage.length ? { mode: "formulas", formulas: damage, rollScope: "outcome" } : { mode: "none", multiplier: 0, sourceComponentIds: [] },
        effects
    });
    // A critical failure's condition with no duration of its own lasts as long as the failure's.
    const lasting = failEffects.find((effect) => effect.duration)?.duration ?? null;
    // Not a fixed time for frightened, which fades by its own rule ("As failure, but Frightened 3" after
    // "…Fascinated until the end of its next turn"); "as long as it remains in the aura" still carries over.
    // (Batch 76: not one "permanently", "(or Blinded permanently on a critical failure)".)
    const forGood = Boolean(critical) && /\bpermanently\b/i.test(htmlToPlainText(String(critical)));
    const timed = (effects) => effects.map((effect) => (effect.duration || !lasting || forGood || effect.slug === "prone" || (["frightened", "sickened"].includes(effect.slug) && lasting.mode === "fixed") || (effect.slug === "stunned" && Number.isFinite(effect.value)) ? effect : { ...effect, duration: lasting }));
    // "(1 minute on a critical failure)", "(2d4 rounds on a critical failure)", "on a critical failure, the duration is
    // 1 minute": the failure's conditions, for longer.
    const time = critical && !criticalAdds ? htmlToPlainText(critical).trim().replace(/^(?:the duration is|for)\s+/i, "") : null;
    const longer = time && /^(?:\d+|\d+d\d+|\[\[[^\]]*\]\](?:\{[^}]*\})?) (?:round|minute|hour)s?$|^\[\[[^\]]*\]\]\{[^}]*\}$/i.test(time) ? readDuration(`for ${time}`) : null;
    // A critical failure naming only conditions the failure has ("Frightened 2 (Frightened 4 on a critical failure)
    // and Stunned 1", "…instead Doomed 2") swaps those and keeps the rest; one naming others replaces them all.
    const critRead = critical && !criticalAdds ? read(critical) : [];
    const swaps = critRead.length > 0 && critRead.every((effect) => failEffects.some((other) => other.slug === effect.slug));
    const swapped = () => failEffects.map((effect) => {
        const instead = critRead.find((other) => other.slug === effect.slug);
        // "…it's permanently blinded": no end.
        if (instead && /\bpermanent(?:ly)?\b/i.test(critical)) return { ...effect, ...instead, value: instead.value ?? effect.value, duration: null };
        return instead ? timed([{ ...effect, ...instead, value: instead.value ?? effect.value, duration: instead.duration ?? effect.duration }])[0] : effect;
    });
    const critEffects = [...(longer
        ? failEffects.map((effect) => (effect.slug === "prone" ? effect : { ...effect, duration: longer }))
        : critical ? (criticalAdds ? [...failEffects, ...read(critical)] : critRead.length ? (swaps ? swapped() : timed(critRead)) : failEffects) : failEffects), ...(extraCritical ? read(extraCritical) : [])];
    // "On a success, the creature gains the Frightened 1 condition" (2026-10-10).
    const successEffects = proseSuccess ? read(proseSuccess) : [];
    // "pushed 15 feet (30 feet on a critical failure)": farther on a critical failure.
    // …or a push the critical failure names itself ("Creatures that critically fail are pushed 10 feet away").
    const farther = critical && !criticalAdds ? /^(?:up to )?(\d+) feet$/i.exec(htmlToPlainText(critical).trim()) : null;
    const critShoved = critical && !farther ? SHOVE.exec(htmlToPlainText(critical.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1"))) : null;
    const pushed = (outcome, distance = shoved?.[1]) => (distance ? { ...outcome, forcedMovement: { kind: "push", distance: Number(distance), upTo: false, optional: false, direction: "away" } } : outcome);
    // A pull toward the monster: farther on a critical failure when its bracket says so ("(15 feet on a critical failure)").
    const pulling = (outcome, critical = false) => (pull && !outcome.forcedMovement ? { ...outcome, forcedMovement: { ...pull, distance: Number((critical && farther?.[1]) || pull.distance) } } : outcome);
    // (Batch 127: "on a critical failure, … and the penalty to Speed lasts for 1 minute" — the critical failure's penalty for that long.)
    const penaltyLasts = critical ? /\bthe penalty(?: to [\w ]+?)? lasts for ((?:\d+|one|ten) (?:round|minute|hour)s?)\b/i.exec(htmlToPlainText(critical)) : null;
    // (Batch 254, Hurtful Critique: "(–2 on a critical failure)" — the penalty's value on a critical failure.)
    const critValue = critical && penalties.length ? /^\s*[–-](\d+)\s*$/.exec(htmlToPlainText(critical))?.[1] : null;
    const critPenalties = (penaltyLasts ? penalties.map((penalty) => ({ ...penalty, duration: readDuration(`for ${penaltyLasts[1]}`) })) : penalties).map((penalty) => (critValue ? { ...penalty, value: -Number(critValue) } : penalty));
    const ending = (outcome, criticalRow = false) => ({ ...(dies ? { ...outcome, terminal: { kind: "death" } } : outcome), ...(penalties.length ? { modifiers: structuredClone(criticalRow ? critPenalties : penalties) } : {}) });
    return {
        criticalSuccess: row([], [], regardless ? 1 : 0),
        success: before && !negates ? row(successEffects, [], regardless ? 1 : 0.5) : row(successEffects, [], 0),
        failure: ending(pulling(pushed(row(failEffects, failDamage, 1)))),
        criticalFailure: ending(pulling(pushed(row(critEffects, critFormulas, regardless ? 1 : 2), pull ? critShoved?.[1] ?? shoved?.[1] : farther?.[1] ?? critShoved?.[1] ?? shoved?.[1]), true), true)
    };
}

// An activity that makes one Strike (after a Stride or two, perhaps) with
// something more on a hit, sentence by sentence; null when a sentence isn't one of these:
//   "The jailer makes a melee Strike. If it hits and deals damage, the target is Frightened 1, or Frightened 2 on a critical hit."
//   "The arboreal warden Strides and then makes a shield bash Strike. If the attack hits, the target is pushed 10 feet."
//   "… makes a weapon Strike. If the Strike hits, the target must succeed at a @Check[fortitude|dc:19] save or become Blinded …"
//   "The rhinoceros Strides twice, then makes a horn Strike. As long as … moved at least 20 feet, … A Medium or smaller creature struck by this attack must succeed at …"
// "1d12 electricity", "3d6 precision" (plain dice with a type) → "1d12[electricity]"; null for anything else.
function plainDice(text) {
    const match = /^(\d+d\d+(?:\s*[+-]\s*\d+)?)(?: ([a-z]+))?$/i.exec(String(text ?? "").trim());
    return match ? `${match[1].replace(/\s+/g, "")}[${(match[2] ?? "untyped").toLowerCase()}]` : null;
}

export const strikeActivityReject = { last: null };

// A hit's results in one sentence, part by part (2026-10-10, batch 27): "If this Strike hits, it deals an additional 2d8 damage,
// and the target is knocked Prone", "On a successful attack, the target takes 5d6 persistent acid damage, and is Sickened 3 …",
// "On a hit, the target takes an additional 2d4 electricity damage and is pushed back 5 feet", "If this Strike hits, it deals an
// additional 2d6 mental damage, and the target must succeed at a … save or become Confused for 1 round". Extra dice with no type
// are the Strike's own ("…[strike]", its damage type when it hits). false when a part isn't one of these.
const HIT_LEAD = /^(?:(?:If|When) (?:it|he|she|they|the (?:Strike|attack|strike)|this (?:Strike|attack)|the [\w' -]+?|[A-Z][\w'-]+) (?:hits?|succeeds?)(?: and deals? damage)?|On a (?:hit|success|successful (?:attack|Strike))(?: or critical hit)?), /i;
const HIT_ACTOR = "(?:it|he|she|they|the [\\w' -]+?|[A-Z][\\w'-]+)";
const HIT_STRUCK = "(?:the (?:target|creature|foe)(?: struck)?|that creature)";
const DICE_COUNT = { a: 1, an: 1, one: 1, two: 2, three: 3 };

// "2d8" (the Strike's type), "1d6 bleed", "1d4 persistent bleed", "1d8 precision", "@Damage[2d6[mental]]"; null otherwise.
function hitDamage(text) {
    const tags = inlineTags(text, "Damage");
    if (tags.length) return tags.length === 1 && /^@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?$/.test(text.trim()) ? readDamage(tags[0]) : null;
    const match = /^(\d+d\d+(?:\s*[+-]\s*\d+)?)(?: (persistent )?([a-z]+))?$/i.exec(text.trim()) ?? /^(\d+) (persistent )([a-z]+)$/i.exec(text.trim());
    if (!match) return null;
    const dice = match[1].replace(/\s+/g, "");
    if (match[2]) return `${dice}[persistent,${match[3].toLowerCase()}]`;
    // (Batch 82: "1d6 extra damage": no type of its own.)
    return `${dice}[${(match[3] && !/^(?:extra|additional)$/i.test(match[3]) ? match[3] : "strike").toLowerCase()}]`;
}

// A save after a hit ("the target must succeed at a @Check[fortitude|dc:23] save or become Clumsy 2 for 1 minute"): its plan.
function hitSave(item, text) {
    const sentence = text.replace(/\bsucceed on an? @Check/i, "succeed at a @Check").replace(/\s*\(this has the [\w -]+ trait\)/i, "");
    const raw = inlineTags(sentence, "Check")[0];
    const check = raw ? readCheck(raw) : null;
    const outcomes = check?.save && check.dc ? saveOrOutcomes(sentence, [], { afterHit: true }) : null;
    if (!outcomes) return null;
    return {
        ...base(item, { time: "free" }),
        targeting: { target: "the creature the Strike hits", range: "touch", area: null },
        trigger: { event: "strike-activity" },
        resolution: { kind: "save", check: { roll: "save", statistic: check.statistic, basic: false, against: { dc: "fixed", value: check.dc } }, sharedDamage: null, outcomes }
    };
}

// An opening sentence's extras, taken out so the opening readings see a plain Strike (batch 27): "makes a melee Strike with its
// gaff" (the gaff Strike), "It make a", ", making a Strike", "with a -2 circumstance penalty to the attack roll", ", and they gain
// a +1 circumstance bonus to the attack roll", ", dealing an extra 2d6 bleed on a hit (4d6 bleed on a critical hit)".
function openingParts(text) {
    let attack = 0;
    let damage = null;
    let damageBonus = 0;
    // (Batch 37: "making one tail Strike", "attempts a ranged Strike with her longbow", "makes a fist strike gaining a +4 status bonus
    // to the damage roll".)
    let plain = text
        .replace(/^It make an? /, "It makes a ")
        .replace(/, making (?:an?|one) ((?:[\w' -]+? )?Strike)\b/i, " and makes a $1")
        // (Batch 127: "attempts a Strike with a falchion", "makes a ranged Strike with the dagger with the range increment to 30 feet".)
        .replace(/ with the range increment (?:to|of) \d+ feet(?=\.$)/i, "")
        // (Not "a Strike with a voidglass weapon": a kind of weapon, its best Strike as before.)
        .replace(/\b(makes|attempts) an? (?:melee |ranged )?Strike with (its|his|her|their|an?|the) ([a-z][\w' -]*?)(?=[.,]| against\b)/i, (whole, verb, owner, name) => (/^an?$/i.test(owner) && /\bweapon$/i.test(name) ? whole : `${verb} a ${name} Strike`))
        .replace(/\b((?:[\w' -]+? )?)strike gaining an? \+(\d+) (?:status|circumstance) bonus to the damage roll(?=\.$)/, (_all, name, value) => {
            damageBonus += Number(value);
            return `${name}Strike`;
        });
    plain = plain.replace(/ with an? [-\u2013\u2212](\d+) circumstance penalty to (?:its |the )?attack roll/i, (_all, value) => {
        attack -= Number(value);
        return "";
    });
    // (Batch 112: Sentry's Aim's "a ranged weapon Strike with a +1 circumstance bonus" (to its attack roll); Empowered Blast's "a melee or
    // ranged elemental blast Strike with a +4 status bonus to damage"; Handspring Kick's "Steps, then makes a melee Strike at a –1 penalty"
    // — the Step the GM's.)
    plain = plain
        .replace(/\bmakes an? (?:ranged weapon|melee weapon|melee or ranged) ([\w' -]+? )?Strike\b/i, (_all, name) => `makes a ${name ?? ""}Strike`.replace(/a Strike$/, "a Strike"))
        .replace(/(Strike) with an? \+(\d+) circumstance bonus(?=\.$)/i, (_all, word, value) => {
            attack += Number(value);
            return word;
        })
        .replace(/(Strike) with an? \+(\d+) status bonus to damage(?=\.$)/i, (_all, word, value) => {
            damageBonus += Number(value);
            return word;
        })
        .replace(/^(?:The )?([^.]+?) Steps, then makes (an? [\w' -]*?Strike) at an? [-\u2013\u2212](\d+) penalty(?=\.$)/i, (_all, who, strike, value) => {
            attack -= Number(value);
            return `${who} makes ${strike}`;
        });
    plain = plain.replace(/, and (?:it|they|he|she) gains? an? \+(\d+) circumstance bonus to (?:the|its|their|his|her) attack roll(?=\.$)/i, (_all, value) => {
        attack += Number(value);
        return "";
    });
    // (Batch 172, Hopping Strike: "makes one spring Strike at any point during that movement, dealing an additional @Damage[1d6[bludgeoning]] damage"
    // — on a hit, though it doesn't say.)
    plain = plain.replace(/, dealing an? (?:extra|additional) (@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?)(?: damage)?(?: on a hit(?: \([^()]*? on a critical hit\))?)?(?=\.$)/i, (_all, tag) => {
        damage = hitDamage(tag);
        return "";
    });
    return { plain, attack, damage, damageBonus };
}

function hitResults(text, activity, item, conditions) {
    const lead = HIT_LEAD.exec(text);
    if (!lead) return false;
    // (Batch 35: "[[/act demoralize]]" as "Demoralize"; "can automatically Shove the target, with the same benefits as the Shove
    // action (including the critical success effect …)": pushed 5 feet, 10 on a critical hit.)
    let autoShove = false;
    let rest = text.slice(lead[0].length).replace(/\.$/, "")
        .replace(/\[\[\/act ([\w-]+)[^\]]*\]\](?:\{([^}]*)\})?/g, (_all, slug, label) => label ?? slug.replace(/(^|-)(\w)/g, (_m, dash, letter) => `${dash ? " " : ""}${letter.toUpperCase()}`))
        .replace(/,? (?:and )?(?:the [\w' -]+?|it|he|she|they) can automatically Shove the target,? with the same benefits as the Shove action \(including the critical success effect,? if (?:the|its) Strike was a critical (?:hit|success)\)/i, () => {
            autoShove = true;
            return "";
        });
    // The save, with all after it (its own results).
    const saveAt = rest.search(new RegExp(`(?:^|,? and )${HIT_STRUCK} must (?:also )?succeed(?: at| on)? an? @Check\\[`, "i"));
    const head = saveAt < 0 ? rest : rest.slice(0, saveAt);
    if (/\b(?:critical|if|unless|instead|no damage|either|or)\b/i.test(head)) return false;
    const found = { conditions: [], damage: [], push: autoShove ? 5 : null, dice: 0, save: null, follow: null };
    const parts = head ? head.split(/,? and (?=(?:the (?:target|creature)|that creature|is|becomes|takes|knocks|deals|it|he|she|they|the [\w' -]+? (?:makes|attempts|can))\b)/i) : [];
    for (const raw of parts) {
        const part = raw.trim().replace(new RegExp(`^${HIT_STRUCK} `, "i"), "").replace(/^also /i, "");
        let match;
        if ((match = new RegExp(`^(?:${HIT_ACTOR} )?(?:also )?deals? (an?|one|two|three) (?:additional|extra) (?:weapon )?(?:die|dice) of (?:weapon )?damage(?: and (.+?) damage)?$`, "i").exec(part))) {
            found.dice += DICE_COUNT[match[1].toLowerCase()];
            const extra = match[2] ? hitDamage(match[2]) : null;
            if (match[2] && !extra) return false;
            if (extra) found.damage.push(extra);
        } else if ((match = new RegExp(`^(?:${HIT_ACTOR} )?(?:also )?(?:deals?|does|takes?) (?:an? )?(?:additional |extra )?(.+?)(?: damage)?(?: of the same (?:damage )?type)?$`, "i").exec(part)) && hitDamage(match[1])) found.damage.push(hitDamage(match[1]));
        // (Two at once, batch 36: "takes an additional 1d4 slashing damage and 1 persistent bleed damage".)
        else if ((match = new RegExp(`^(?:${HIT_ACTOR} )?(?:also )?(?:deals?|takes?) (?:an? )?(?:additional |extra )?(\\d+d\\d+ [a-z]+) damage and (\\d+(?:d\\d+)? (?:persistent )?[a-z]+) damage$`, "i").exec(part)) && hitDamage(match[1]) && hitDamage(match[2])) found.damage.push(hitDamage(match[1]), hitDamage(match[2]));
        else if ((match = /^(?:is )?pushed (?:back )?(\d+) feet(?: away)?$/i.exec(part))) found.push = Number(match[1]);
        // A skill action after the hit (batch 35): "it attempts to Demoralize the target", "the grave spinosaurus makes an Athletics
        // check to Trip the target", "the vigilante can then Shove the target", "can attempt to Trip the target, without
        // increasing its multiple attack penalty" (made up).
        else if ((match = new RegExp(`^(?:${HIT_ACTOR} )?(?:also )?(?:can (?:then |also )?)?(?:attempts? to |attempt an? \\w+ check to |makes? an? \\w+ check to |can attempt to )?(Demoralize|Trip|Shove|Grapple|Disarm|Reposition) (?:the (?:target|creature)(?: (?:it|they|he|she) hit)?|it)(?:,? without increasing [^.]+)?$`, "i").exec(part)) && !found.follow) found.follow = match[1].toLowerCase();
        else if (new RegExp(`^(?:${HIT_ACTOR} )?deals damage as (?:normal|usual)$`, "i").test(part)) continue;
        else if (/^(?:is )?knocked Prone$/i.test(part) || new RegExp(`^(?:${HIT_ACTOR} )?(?:also )?knocks? (?:the (?:creature|target)|it|them) Prone$`, "i").test(part)) found.conditions.push({ slug: "prone", value: null, duration: null });
        else if ((match = /^(?:is|becomes) (.+)$/i.exec(part)) && !/@Check\[|\bpush|\bGrab/i.test(match[1])) {
            // ("until the start of the guard's next turn": its own turn.)
            const read = conditions(match[1].replace(/\bof the [\w' -]+?['’]s (next )?turn\b/gi, "of its $1turn"));
            // A duration not read ("until the persistent damage ends"): not this reading.
            if (!read.length || (/\b(?:until|for)\b/i.test(match[1]) && read.some((entry) => !entry.duration))) return false;
            found.conditions.push(...read);
        } else return false;
    }
    if (saveAt >= 0) {
        if (activity.onHit.save) return false;
        found.save = hitSave(item, rest.slice(saveAt).replace(/^,? and /i, "").replace(/^\w/, (letter) => letter.toUpperCase()) + ".");
        if (!found.save) return false;
    }
    if (!parts.length && !found.save) return false;
    activity.onHit.conditions.push(...found.conditions);
    activity.onHit.damage.push(...found.damage);
    if (found.push) activity.onHit.push = found.push;
    if (autoShove) activity.onHit.criticalPush = 10;
    if (found.follow) activity.onHit.follow = found.follow;
    if (found.dice) activity.extraWeaponDice = (activity.extraWeaponDice ?? 0) + found.dice;
    if (found.save) activity.onHit.save = found.save;
    return true;
}

// (Batch 153: a Strike the text names that the sheet calls otherwise — Kannitri's "ghostly hand Strike" is its Ghostly Fist, the Gardener's its
// Spectral Hand: the one Strike on the sheet that shares a word with it; the name as written when the sheet has it, or no creature is given.)
function sheetStrikeName(actor, name) {
    const melee = [...(actor?.items ?? [])].filter((item) => item?.type === "melee").map((item) => String(item.name ?? "").toLowerCase());
    if (!name || name === "ranged" || !melee.length) return name;
    if (melee.some((strike) => strike === name || strike.startsWith(name) || name.startsWith(strike) || strike.includes(name))) return name;
    const words = name.split(/\s+/);
    const sharing = [...new Set(melee.filter((strike) => strike.split(/\s+/).some((word) => words.includes(word))))];
    return sharing.length === 1 ? sharing[0] : name;
}

function strikeActivity(item, actor, { after = null } = {}) {
    const reject = (text) => {
        strikeActivityReject.last = text;
        return null;
    };
    // (Sudden Charge's "Strides twice. If it ends its movement within melee reach …, it makes a melee Strike against that enemy.",
    // as one sentence.)
    // (A "Trigger" in an action that only says what it needs, batch 44: "Trigger The ruffian has one hand free, …", as a requirement.)
    const html = chargeSentences(item.system?.description?.value ?? "").replace(/<strong>\s*Trigger\s*<\/strong>(?=\s*(?:The )?[^<.]+? has (?:a|one) (?:free )?hand(?: free)?\b)/gi, "<strong>Requirements</strong>").replace(/<p>\s*<strong>\s*(?:Requirements?|Frequency)\s*<\/strong>[\s\S]*?<\/p>\s*(?:<hr\s*\/?>)?/gi, (block) => (/Frequency/i.test(block) && /once per (?:day|hour|minute|10 minutes)/i.test(block) ? "<p>[once]</p>" : /Frequency/i.test(block) && /once per (?:round|turn)/i.test(block) ? "<p>[once a turn]</p>" : /Requirements?/i.test(block) ? `<p>[requires ${htmlToPlainText(block).replace(/^Requirements?\s*/i, "")}]</p>` : "")).replace(/<strong>\s*Effect\s*<\/strong>/gi, "");
    // (Batch 128, Immobilizing Thrust: "If the Strike hits, the target must attempt a … save. On a failure, the creature is Immobilized until the
    // kobold egg guardian moves, …" — one save sentence, its "until" the GM's.)
    const sentences = html.replace(/<\/?p[^>]*>|<hr\s*\/?>/gi, " ")
        .replace(/(If (?:the Strike|it|the attack) hits, the target must) attempt (an? @Check\[(?:fortitude|reflex|will)[^\]]*\](?:\{[^}]*\})?) save\. On a failure, the creature is (?:@UUID\[[^\]]*\]\{(\w+)\}|(\w+)) until ([^.]+)\./i, (_all, lead, check, linked, plain, until) => `${lead} succeed at ${check} save or be ${linked ?? plain}. The creature stays ${linked ?? plain} until ${until}.`)
        // (Batch 130, Hammerhead: "makes a bone crest Strike; on a hit, the mjolgat deals an extra die of damage. This counts as two attacks when
        // calculating the mjolgat's multiple attack penalty" — its own sentence, and the last one's period.)
        .replace(/(Strike); on a hit, (?:the [\w' -]+?|it|he|she|they) deals an extra die of damage\./i, "$1. If it hits, it deals an extra die of weapon damage.")
        // (Batch 156: Battering Blow's "The Firebrand bastion Strikes an adjacent creature, then Shoves the same creature." — its Strike, then PF2e's
        // Shove at that creature, hit or miss; Ramming Charge's "Strides up to two times, then makes a horn Strike with Improved Knockdown" — a Trip
        // after a hit.)
        .replace(/\b((?:The )?[\w' -]+?|He|She|It|They) Strikes an adjacent creature, then (?:@UUID\[[^\]]*\]\{(Shoves|Trips|Grapples|Disarms|Demoralizes)\}|(Shoves|Trips|Grapples|Disarms|Demoralizes)) the same creature\./i, (_all, who, linked, plain) => `${who} makes a melee Strike. [after-strike ${(linked ?? plain).toLowerCase().replace(/s$/, "")}]`)
        .replace(/\bStrides up to two times, then makes an? ([\w' -]+?) Strike with (?:@UUID\[[^\]]*\]\{Improved Knockdown\}|Improved Knockdown)\./i, "Strides twice and makes a $1 Strike. If it hits, it can attempt to Trip the target.")
        // (Batch 159, Massive Strike: "makes a melee Strike and, if the attack hits, it can push the creature back 10 feet (20 feet on a critical hit). The
        // target must succeed at a Fortitude save or be knocked Prone by this attack." — the push, then the save, on a hit.)
        .replace(/\bmakes a melee Strike and, if the attack hits, it can push the creature back (\d+) feet \((\d+) feet on a critical hit\)\. The target must succeed at a (@Check\[[^\]]*\]) save or be knocked (@UUID\[[^\]]*\]\{Prone\}|Prone) by this attack\./i, "makes a melee Strike. If it hits, the target is pushed $1 feet. On a critical hit, the target is pushed back $2 feet. If it hits, the target must succeed at a $3 save or be knocked $4.")
        // (Batch 151, Rolling Charge: "Strides twice, and can then make a Strike with its jaws. This jaws Strike gains Knockdown." — a Trip after a hit.)
        .replace(/\b(Strides twice), and can then make a Strike with (?:its|their|his|her) ([\w' -]+?)\. This \2 Strike gains (?:@UUID\[[^\]]*\]\{Knockdown\}|Knockdown)\./i, "$1 and makes a $2 Strike. If it hits, it can attempt to Trip the target.")
        // (Batch 147: Residual Force's "makes a tentacle Strike that has a reach of 20 feet and deals 2d4 additional force damage", Addling Strike's
        // "This Strike gains the occult trait and deals an additional 1d4 mental damage.")
        .replace(/\bmakes an? ([\w' -]+?) Strike that has a reach of (\d+) feet and deals (\d+d\d+) additional (\w+) damage\./i, "makes a $1 Strike with its reach increased to $2 feet. If it hits, it deals an additional $3 $4 damage.")
        .replace(/\bThis Strike gains the (\w+) trait and deals an additional (\d+d\d+) (\w+) damage\./i, "If it hits, it deals an additional $2 $3 damage.")
        // (Batch 140, Punishing Strike: "He Strikes; if he hits, he increases the number of damage dice by one and adds Push to the effect.")
        .replace(/\b(He|She|It|They) Strikes?; if (?:he|she|it|they) hits?, (?:he|she|it|they) increases? the number of damage dice by one and adds? (?:@UUID\[[^\]]*\]\{Push\}|Push) to the effect\./i, "$1 makes a Strike. If it hits, it deals an extra die of weapon damage. If it hits, the target is pushed 5 feet.")
        .replace(/(multiple attack penalty)(\s*(?:<\/p>)?\s*)$/i, "$1.$2")
        // (Batch 184, Halyard Swing: "swings from a nearby rope, moving up to twice its Speed and ignoring any terrain or lack of surface beneath it. It
        // can make a tentacle Strike at any point during this movement." — two Strides and the Strike; its requirement, a ship's deck, the GM's.)
        .replace(/\b((?:The )?[\w' -]+?) swings from a nearby rope, moving up to twice (?:its|their|his|her) Speed and ignoring any terrain or lack of surface beneath (?:it|them|him|her)\. (?:It|They|He|She) can make an? ([\w' -]+?) Strike at any point during this movement\./i, "$1 Strides twice and makes a $2 Strike. [rope swing]")
        // (Batch 185, Boarding Action: "swings on a rope or Strides, moving up to double their Speed. If the rigger boarded or disembarked a boat during
        // this movement, they can make a melee Strike at the end of their movement that deals one extra damage die on a hit." — two Strides and the
        // Strike with its extra die, only after boarding or leaving a boat, the GM's.)
        .replace(/\b((?:The )?[\w' -]+?) swings on a rope or Strides, moving up to double (?:its|their|his|her) Speed\. If (?:the [\w' -]+?|it|they|he|she) boarded or disembarked a boat during this movement, (?:it|they|he|she) can make a melee Strike at the end of (?:its|their|his|her) movement that deals one extra damage die on a hit\./i, "$1 Strides twice and makes a melee Strike that deals one additional weapon damage die. [boat boarding]")
        // (Batch 210, a Battlezoo dragon's teleporting charge: a teleport next to a creature it can see within some distance, then its named Strike — read
        // as a move and the Strike, the teleport a note.)
        .replace(/\b(It|They|(?:The )?[\w' -]+?) (?:teleports to an empty space adjacent to|blinks next to) a creature (?:it|they) can see within (\d+) feet, then makes an? ([\w' -]+?) Strike against (?:the creature|it)\./i, (_all, who, feet, name) => `${who} Strides and makes a ${name} Strike. [teleport ${feet}]`)
        // (Batch 207, Parry Dance: "makes a melee Strike, then Steps, positioning their blade defensively." — the Strike; the Step a note.)
        .replace(/\b(makes an? (?:melee )?Strike), then Steps, positioning (?:its|their) [\w' -]+? defensively\./i, "$1. [then steps]")
        // (Batch 206, Goring Charge: "Strides twice and makes an antlers Strike after either Stride." — two Strides and the Strike, after either a note.)
        .replace(/\b((?:The )?[\w' -]+?) Strides twice and makes an? ([\w' -]+?) Strike after either Stride\./i, "$1 Strides twice and makes a $2 Strike. [after either stride]")
        // (Batch 204: Water Sprint's "Strides up to three times in a straight line across smooth water. They can make a single Strike against a creature at
        // the end of this movement." — only on smooth water, the GM's; Hurl Weapon's "makes a hurled weapon Strike without using their hands.")
        .replace(/\b((?:The )?[\w' -]+?) Strides up to three times in a straight line across smooth water\. (?:It|They) can make a single Strike against a creature at the end of this movement\./i, "$1 Strides three times and makes a Strike. [smooth water]")
        .replace(/\b(makes an? [\w' -]+? Strike) without using (?:its|their) hands\./i, "$1.")
        // (Batch 203, Gouging Lunge: "makes a thumb spike Strike at an adjacent foe and then Strides up to 15 feet, dragging its thumb spike across the foe to
        // gouge out a brutal wound. If this Strike hits, it deals an extra 1d8 slashing damage and the following Stride does not trigger reactions from the
        // creature struck." — the Strike with its extra damage on a hit; the Stride after a note.)
        .replace(/\b(makes an? [\w' -]+? Strike) at an adjacent foe and then Strides up to (\d+) feet, [^.]+\. If this Strike hits, it deals an extra (\d+d\d+) (\w+) damage and the following Stride does not trigger reactions from the creature struck\./i, (_all, made, feet, dice, type) => `${made}. On a hit, the target takes @Damage[${dice}[${type.toLowerCase()}]] damage. [then strides ${feet}]`)
        // (Batch 202, Fencing Brawl: "attempts a rapier Strike followed by a Disarm or Grapple attempt against the same enemy. These count as one attack for
        // the kingpin's multiple attack penalty, and the penalty doesn't increase until after both attacks." — the Strike, then the Grapple (the
        // simulator's pick; the Disarm instead a note).)
        .replace(/\b((?:The )?[\w' -]+?) attempts an? ([\w' -]+?) Strike followed by an? (?:\[\[\/act disarm[^\]]*\]\](?:\{[^}]*\})?|Disarm) or (?:\[\[\/act grapple[^\]]*\]\](?:\{[^}]*\})?|Grapple) attempt against the same enemy\. These count as one attack for (?:the [\w' -]+?['’]s|its|their) multiple attack penalty, and the penalty doesn't increase until after both attacks\./i, "$1 makes a $2 Strike. [after-strike grapple] [or disarm, one attack]")
        // (Batch 201, Daredevil Strike: "Strides up to their Speed, makes a melee Strike, then Steps." — the Stride and the Strike; the Step a note.)
        .replace(/\b((?:The )?[\w' -]+?) Strides up to (?:its|their|his|her) Speed, makes an? ([\w' -]+?) Strike, then Steps\./i, "$1 Strides and makes a $2 Strike. [then steps]")
        // (Batch 200, Swinging Strike: "swings on a rope or trapeze, moving up to double their Speed. At any point during the swing, they can make a melee
        // Strike." — two Strides and the Strike, only where there's a rope or trapeze (the GM's); Flying Attack: "makes a Leap, High Jump, or Long Jump. At
        // any point during the jump, if they're adjacent to an enemy, they can Strike that enemy with a fist or nunchaku Strike, even in midair. …" — a
        // move and the Strike, the fall after notes.)
        .replace(/\b((?:The )?[\w' -]+?) swings on a rope or trapeze, moving up to double (?:its|their|his|her) Speed\. At any point during the swing, (?:it|they|he|she) can make an? ([\w' -]+?) Strike\./i, "$1 Strides twice and makes a $2 Strike. [rope or trapeze]")
        .replace(/\b((?:The )?[\w' -]+?) makes a (?:@UUID\[[^\]]*\]\{)?Leap\}?, (?:@UUID\[[^\]]*\]\{)?High Jump\}?, or (?:@UUID\[[^\]]*\]\{)?Long Jump\}?\. At any point during the jump, if (?:it's|they're|he's|she's) adjacent to an enemy, (?:it|they|he|she) can Strike that enemy with an? [\w' -]+?(?: or [\w' -]+?)? Strike, even in midair\. (?:The [\w' -]+?|It|They|He|She) falls? to the ground after the Strike\. If the distance (?:it|they|he|she) falls? is no more than the height of (?:its|their|his|her) jump, (?:it|they|he|she) lands? upright and takes? no damage\./i, "$1 Strides and makes a Strike. [leap strike]")
        // (Batch 221, Leaping Grab: "The mantis Leaps up to 40 feet vertically and 20 feet horizontally. At any point during the jump, it can make a leg Strike. If
        // it hits, it automatically Grabs the target, bringing the creature along until the end of the jump." — a Leap and the Strike, Grabbed on a hit;
        // Strafing Chomp: "Swims up to half its swim Speed, makes a jaws Strike, and then Swims up to half its Speed further." — a move and the Strike, the
        // move after a note.)
        .replace(/\b((?:The )?[\w' -]+?) Leaps up to (\d+) feet vertically and (\d+) feet horizontally\. At any point during the jump, (?:it|they|he|she) can make an? ([\w' -]+?) Strike\. If (?:it|they|he|she) hits, (?:it|they|he|she) automatically (?:@UUID\[[^\]]*\]\{)?Grabs\}? the target, bringing the creature along until the end of the jump\./i, "$1 Strides and makes a $4 Strike. If it hits, the target is Grabbed. [leap $2 $3]")
        .replace(/\b((?:The )?[\w' -]+?) (Swims|Strides|Flies) up to half (?:its|their|his|her) (?:swim |fly )?Speed, makes an? ([\w' -]+?) Strike, and then (?:Swims|Strides|Flies) up to half (?:its|their|his|her) (?:swim |fly )?Speed further\./i, "$1 $2 and makes a $3 Strike. [half before and after]")
        // (Batch 222, a Battlezoo thief's stomp: Immobilized and Off-Guard on a hit until its next turn starts — or until the target is no longer beside it, a
        // note.)
        .replace(/\bIf (?:the Strike|it) hits, (?:(?:the [\w' -]+?|it) stomps on the target['’]s shadow\. The target is|it pins the target['’]s shadow, leaving it) (?:(?:@\w+\[[^\]]*\]\{)?Immobilized\}? and (?:@\w+\[[^\]]*\]\{)?Off-Guard\}?|Off-Guard and Immobilized) until the start of (?:the [\w' -]+?['’]s|its) next turn,? or until (?:they are|it's|it is) no longer (?:adjacent to|beside) (?:the [\w' -]+?|it)(?:, whichever comes first)?\./i, "If it hits, the target is Immobilized and Off-Guard until the start of its next turn. [while adjacent]")
        // (Batch 224, Impaling Barb: "makes a barb Strike, then Strides up to half its Speed without triggering reactions. If the Strike hits, the hamatula
        // impales the target with one of its barbs and snaps the barb free as it moves away from the target. This deals an additional 2d8 piercing damage to
        // the target and pins it to an adjacent surface, rendering it Immobilized (Escape DC 29)." — the extra damage and Immobilized on a hit; the move after
        // and the Escape DC notes.)
        .replace(/\b((?:The )?[\w' -]+?) makes an? ([\w' -]+?) Strike, then Strides up to half (?:its|their) Speed without triggering reactions\. If the Strike hits, (?:the [\w' -]+?|it) impales the target with one of (?:its|their) [\w' -]+? and snaps the [\w' -]+? free as (?:it|they) moves? away from the target\. This deals an additional (\d+d\d+) (\w+) damage to the target and pins it to an adjacent surface, rendering it (?:@\w+\[[^\]]*\]\{)?Immobilized\}? \((?:\[\[\/act escape dc=(\d+)\]\](?:\{[^}]*\})?|Escape DC (\d+))\)\./i, (_all, who, name, dice, type, dc, plain) => `${who} makes a ${name} Strike. The Strike deals an additional @Damage[${dice}[${type.toLowerCase()}]] damage. If it hits, the target is Immobilized. [barb escape ${dc ?? plain}]`)
        // (Batch 174, the diabolic messenger's Hidden Blade: "draws a weapon and then Strikes with it The target of the Strike is …" — its stop missing.)
        .replace(/\b(Strikes with it) (?=The target of the Strike is\b)/, "$1. ")
        .split(/(?<=[.\]])\s+(?=[A-Z@<[])/).map((sentence) => sentence.trim()).filter(Boolean);
    const activity = { builtin: "strike-activity", actions: Number(item.system?.actions?.value) || 1, strides: 0, strike: null, attackBonus: 0, damageBonus: 0, offGuard: false, requires: null, oncePerFight: false, onHit: { conditions: [], critical: null, push: null, damage: [], save: null, size: null } };
    let opened = false;
    let flavorSkipped = false;
    // "If it hits", "If the Strike hits and deals damage", "If they hit and deal damage", "If Alak hits".
    // (Batch 97: "If the Strike deals damage, …" too.)
    const hit = "^(?:If|When) (?:it|he|she|they|the (?:Strike|attack|strike)|this (?:Strike|attack)|the [\\w' -]+?|[A-Z][\\w'-]+) (?:hits?(?: and deals? damage)?|deals? damage), ";
    const conditions = (text) => readConditions(text, { plain: STAGE_CONDITIONS }).map((effect) => ({ slug: effect.slug, value: effect.value, duration: effect.duration }));
    for (const sentence of sentences) {
        // Linked names as words ("@UUID[…]{Grabbed}" → "Grabbed"); @Check and @Damage are read from the sentence itself.
        // (Batch 44, Snagging Strike: "… until the start of the ruffian's next turn or until it leaves the ruffian's reach, whichever comes
        // first": its time; leaving the reach is the GM's.)
        const text = htmlToPlainText(sentence.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim()
            .replace(/ or until (?:it|the target|the creature) (?:leaves (?:the [\w' -]+?'s|its|their|his|her) reach|is no longer within the reach of (?:the [\w' -]+?'s|its|their|his|her) hand), whichever comes first(?=\.$)/i, "")
            // (Batch 60, Savage Jaws: "makes a single Strike with its jaws" as "makes a jaws Strike".)
            .replace(/\bmakes a single Strike with (?:its|his|her|their) ([\w' -]+?)(?=\.$)/i, "makes a $1 Strike")
            // (Batch 173: Hunting Throw's "makes a ranged strike with their trident within 60 feet without ranged penalties", "If the strike hits, it has
            // enough force to knock the target Prone. If the strike was a critical success, the target is also Immobilized by the trident."; Guerrilla
            // Tactics' "makes a ranged Strike with their hatchet and then draws their battle axe"; Bounce Cruuk's "… against a target within 30 feet.
            // Once the Strike is complete, the cruuk ricochets back into …'s hand. If their hands are full when the cruuk returns, it falls to the
            // ground in their space."; Deadly Aim's "He gains a +6 circumstance bonus to damage on that Strike.")
            .replace(/\b(makes an? ranged )strike( with (?:its|their|his|her) [\w' -]+?) within (\d+) feet without (?:ranged|range) penalties(?=\.$)/i, (_all, made, weapon, feet) => {
                (activity.notes ??= []).push(`Within ${feet} feet, without range penalties.`);
                return `${made}Strike${weapon}`;
            })
            .replace(/^If the strike hits, it has enough force to knock the target Prone(?=\.$)/i, "If it hits, the target is knocked Prone")
            .replace(/^If the strike was a critical success, the target is also Immobilized(?: by the [\w' -]+?)?(?=\.$)/i, "On a critical hit, the target is Prone and Immobilized")
            .replace(/\b(makes an? ranged Strike with (?:its|their|his|her) [\w' -]+?) and then draws (?:its|their|his|her) ([\w' -]+?)(?=\.$)/i, (_all, made, weapon) => {
                (activity.notes ??= []).push(`Then it draws its ${weapon} (an Interact).`);
                return made;
            })
            .replace(/\b(makes an? ranged Strike with (?:its|their|his|her) [\w' -]+?) against a target within \d+ feet(?=\.$)/i, "$1")
            .replace(/^Once the Strike is complete, the ([\w' -]+?) ricochets back into [^.]+?['’]s? hand\.$/i, (_all, weapon) => {
                (activity.notes ??= []).push(`The ${weapon} comes back to its hand after the Strike (or falls in its space if its hands are full).`);
                return "[told]";
            })
            .replace(/^If (?:their|its|his|her) hands are full when the [\w' -]+? returns, it falls to the ground in (?:their|its|his|her) space\.$/i, "[told]")
            // (Batch 258, Tangle-Topple: "If it hits, the target is tangled in ragged scrap. It's Immobilized, can't leave the ground, and falls to the
            // ground if it's flying. This ends if the creature Escapes or the metal is Forced Open." — Immobilized on a hit; the rest, notes.)
            .replace(/^If it hits, the target is tangled in [^.]+\.$/i, "[told]")
            .replace(/^It['’]s Immobilized, can['’]t leave the ground, and falls to the ground if it['’]s flying\.$/i, () => {
                (activity.notes ??= []).push("The creature hit can't leave the ground, and falls if it's flying.");
                return "If it hits, the target is Immobilized.";
            })
            .replace(/^This ends if the creature (?:\[\[\/act escape[^\]]*\]\]\{)?Escapes\}? or the [\w' -]+? is (?:\[\[\/act force-open[^\]]*\]\]\{)?Forced Open\}?\.$/i, () => {
                (activity.notes ??= []).push("It ends when the creature Escapes, or the hold is Forced Open.");
                return "[told]";
            })
            // (Batch 258, Resonating Kick: "If the target is an aberration or is capable of casting spells from the arcane tradition, this attack deals an
            // additional 2d12 force damage." — the damage against that trait; the casters, the GM's.)
            .replace(/^If the target is an? (\w+)(?: or (is capable of casting spells from the \w+ tradition|[^,.]+?))?, this attack deals an additional (\d+d\d+) (\w+) damage\.$/i, (_all, trait, other, dice, type) => {
                activity.onHit.vsTraits = [...(activity.onHit.vsTraits ?? []), { traits: [trait.toLowerCase()], damage: [`${dice}[${type.toLowerCase()}]`] }];
                if (other) (activity.notes ??= []).push(`The ${dice} ${type.toLowerCase()} damage also against a creature that ${other.replace(/^is /, "is ")} (the GM's).`);
                return "[told]";
            })
            .replace(/^(?:He|She|It|They) gains? a \+(\d+) circumstance bonus to damage on that Strike\.$/i, (_all, value) => {
                activity.damageBonus += Number(value);
                return "[told]";
            })
            // (Batch 174, Heavy Swing: "Strikes with their greatsword, dealing 4d12+22 slashing damage plus 1d6 persistent bleed." — its damage, and the
            // bleed on a hit.)
            .replace(/^((?:The )?[^.]+?) Strikes with (?:its|their|his|her) ([\w' -]+?), dealing (\d+d\d+(?:\s*\+\s*\d+)?) (\w+) damage plus (\d+d\d+) persistent (\w+)(?: damage)?(?=\.$)/i, (_all, who, weapon, dice, type, persistent, kind) => {
                activity.damage = `(${dice.replace(/\s+/g, "")})[${type.toLowerCase()}]`;
                activity.onHit.damage.push(`${persistent}[persistent,${kind.toLowerCase()}]`);
                return `${who} makes a ${weapon} Strike`;
            })
            // (Batch 187: Swift Blow's "Interacts to draw a melee weapon without triggering reactions and makes a Strike with that weapon.", "The target is
            // Off-Guard against this Strike.", "The weapon master deals an extra @Damage[2d8[bleed]] with the Strike."; Attack from Above's "On a hit, the Strike
            // deals an additional 1d6 slashing damage and the asanbosam immediately Grabs the target and pulls it to a space adjacent to the asanbosam.")
            .replace(/^((?:The )?[^.]+?) Interacts to draw a melee weapon without triggering reactions and makes a Strike with that weapon(?=\.$)/i, (_all, who) => {
                (activity.notes ??= []).push("It draws the weapon first (an Interact that triggers no reactions).");
                return `${who} makes a melee Strike`;
            })
            .replace(/^The target is Off-Guard against this Strike\.$/i, () => {
                activity.offGuard = true;
                return "[told]";
            })
            .replace(/^(?:The [\w' -]+?|It|They|He|She) deals an extra (@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?) (?:damage )?with the Strike\.$/i, (_all, tag) => `If it hits, it deals an additional ${tag} damage.`)
            .replace(/^On a hit, the Strike deals an additional (@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?) damage and (?:the [\w' -]+?|it) immediately Grabs the target and pulls it to a space adjacent to (?:the [\w' -]+?|it|itself)\.$/i, (_all, tag) => {
                activity.onHit.conditions.push({ slug: "grabbed", value: null, duration: null });
                (activity.notes ??= []).push("On a hit, it pulls the target to a space beside it.");
                return `If it hits, it deals an additional ${tag} damage.`;
            })
            // (Batch 190: Towering Bite's "… making a jaws Strike with a reach of 60 feet. If the Strike hits, its target is Grabbed and pulled to an empty
            // space adjacent to the plated python. The python can attack through any material it can burrow through, …"; Masterful Engagement's "It Steps
            // and Strikes, in any order.")
            // (Batch 191: Lunging Strike's "with an extended reach of 20 feet"; Shadow Chain's "Shadows extend the giant's chain as they make a spiked chain
            // Strike, increasing their reach to 60 feet for that Strike." and its teleport on a failed save, a note; Lunging Strike's Capturing Grab after.)
            .replace(/^Shadows extend (?:the [\w' -]+?['’]s|its|their) [\w' -]+? as (?:they|it) makes? an? ([\w' -]+?) Strike, increasing (?:their|its) reach to (\d+) feet for that Strike\.$/i, (_all, weapon, feet) => {
                (activity.notes ??= []).push(`Its reach is ${feet} feet for this Strike.`);
                return `It makes a ${weapon} Strike.`;
            })
            .replace(/^If this hits, the target must succeed at an? (@Check\[[^\]]*\]) save or be teleported to an empty space within (?:the [\w' -]+?['’]s|its|their) normal reach\.$/i, (_all, check) => {
                (activity.notes ??= []).push(`On a hit, a ${/dc:(\d+)/.exec(check)?.[1] ? `DC ${/dc:(\d+)/.exec(check)[1]} ` : ""}${/^@Check\[(\w+)/.exec(check)[1].replace(/^\w/, (letter) => letter.toUpperCase())} save or the target is teleported to a space within its normal reach.`);
                return "[told]";
            })
            .replace(/^If it hits, (?:the [\w' -]+?|it) can use ([A-Z][\w' -]+?) after the Strike even if the creature is out of reach\.$/i, (_all, other) => {
                (activity.notes ??= []).push(`If it hits, it can use ${other} after it, even out of reach.`);
                return "[told]";
            })
            .replace(/\b((?:makes|attempts|making) an? [\w' -]+? Strike) with an? (?:extended )?reach of (\d+) feet(?=\.$)/i, (_all, made, feet) => {
                (activity.notes ??= []).push(`Its reach is ${feet} feet for this Strike.`);
                return made;
            })
            .replace(/^If the Strike hits, its target is Grabbed and pulled to an empty space adjacent to (?:the [\w' -]+?|it)\.$/i, () => {
                (activity.notes ??= []).push("On a hit, it pulls the target to a space beside it.");
                return "If it hits, the target is Grabbed.";
            })
            .replace(/^(?:The [\w' -]+?|It) can attack through any material it can burrow through[^.]*\.$/i, (sentence) => {
                (activity.notes ??= []).push(sentence);
                return "[told]";
            })
            .replace(/^((?:The )?[^.]+?|It|They) Steps and Strikes, in any order(?=\.$)/i, (_all, who) => {
                (activity.notes ??= []).push("It Steps before or after its Strike.");
                return `${who} makes a Strike`;
            })
            // (Batch 192: Dimensional Ambush's "casts Translocate, then makes a melee Strike that deals three extra dice of damage."; Extend Mandibles'
            // "… with a reach of 10 feet, but the mandibles lose the agile trait for this Strike."; Exemplar of Violence's "After the Strike, allies who can
            // see the graveknight can use a reaction to Step or Stride, … One ally of the graveknight's choice can instead use a reaction to Strike.")
            .replace(/^((?:The )?[^.]+?) casts Translocate, then makes a melee Strike that deals (one|two|three) extra dice of damage\.$/i, (_all, who, count) => {
                (activity.notes ??= []).push("It casts Translocate first (teleporting next to its target).");
                return `${who} makes a melee Strike that deals ${count.toLowerCase()} additional weapon damage dice.`;
            })
            .replace(/\b((?:makes|attempts|making) an? [\w' -]+? Strike) with a reach of (\d+) feet, but the [\w' -]+? lose the agile trait for this Strike(?=\.$)/i, (_all, made, feet) => {
                (activity.notes ??= []).push(`Its reach is ${feet} feet for this Strike, without the agile trait.`);
                return made;
            })
            .replace(/^After the Strike, allies who can see (?:the [\w' -]+?|it) can use a reaction to Step or Stride, but they must end this movement in a space adjacent to an enemy\.$/i, () => {
                (activity.notes ??= []).push("After the Strike, hit or miss, its allies who see it can Step or Stride next to an enemy as a reaction, or one ally it picks can Strike instead.");
                return "[told]";
            })
            .replace(/^One ally of (?:the [\w' -]+?['’]s|its) choice can instead use a reaction to Strike\.$/i, () => {
                activity.onHit.allyStrike = true;
                return "[told]";
            })
            .replace(/^((?:The )?[^.]+?) attempts a Strike as (?:its|their) armor flashes with [^.]+\.$/i, "$1 makes a Strike.")
            // (Batch 198: Toxic Bite's "If it hits, it injects additional poison, causing its venom to gain the virulent trait."; Tooth Grind's "makes a
            // bludgeoning jaws Strike against the creature he's grabbing. On a hit, the creature also takes … damage and becomes Wounded 1, or increases its
            // wounded value by 1 if already wounded. On a critical hit, the creature instead becomes wounded 2, or … If a creature dies from Tooth Grind,
            // Grendel regains 40 HP; this is a healing effect."; Gnaw Metal's armor sentences; Isolating Lash's "makes a melee Strike trailing a wave of
            // shadowy illusions", its extra die and its Will save on the hit, the save's results the GM's.)
            // (Batch 210: a sentence giving the Strike extra damage of some dice and type — on a hit; a penalty to the target's save against another of its abilities, a
            // note.)
            .replace(/^The Strike deals an additional (\d+d\d+) (\w+) damage\.$/i, (_all, dice, type) => `On a hit, the target takes @Damage[${dice}[${type.toLowerCase()}]] damage.`)
            .replace(/^Additionally, the creature takes a [-\u2013\u2212](\d+) circumstance penalty on (?:its|their) save against ([A-Z][\w' -]+?)\.$/i, (_all, penalty, name) => {
                (activity.notes ??= []).push(`The creature also takes a –${penalty} circumstance penalty to its save against ${name}.`);
                return "[told]";
            })
            // (Batch 207: Parry Dance's "They gain a +2 circumstance bonus to AC until the end of their next turn." — on itself after the Strike; Devour
            // Flesh's "On a success, the ghul successfully devours some of the flesh and regains 3d6 Hit Points. The grabbed creature becomes Drained 1 (or
            // Drained 2 if the jaws Strike was a critical success). The violent consumption requires the ghul to release the creature as it feasts. …")
            .replace(/^(?:They|It|He|She) gains? an? \+(\d) circumstance bonus to AC until the end of (?:its|their|his|her) next turn\.$/i, (_all, value) => {
                (activity.selfAfter ??= []).push({ ac: Number(value), type: "circumstance" });
                return "[told]";
            })
            .replace(/^(?:The [\w' -]+?|It) attempts to eat a portion of the grabbed creature['’]s flesh\.$/i, "[told]")
            // (Its "Hit Points." comes as a sentence of its own after the tag, which the selfHeal sentence below takes.)
            .replace(/^On a success, (?:the [\w' -]+?|it) successfully devours some of the flesh and regains @Damage\[(\d+d\d+)\[healing\]\](?:\{[^}]*\})?(?: (?:Hit Points|HP))?\.?$/i, (_all, dice) => {
                activity.onHit.selfHeal = dice;
                return "[told]";
            })
            .replace(/^The grabbed creature becomes (?:@UUID\[[^\]]*\]\{)?Drained (\d)\}? \(or (?:@UUID\[[^\]]*\]\{)?Drained (\d)\}? if the [\w' -]+? Strike was a critical success\)\.$/i, (_all, hit, critical) => {
                activity.onHit.critical = [{ slug: "drained", value: Number(critical), duration: null }];
                return `On a hit, the target is Drained ${hit}.`;
            })
            .replace(/^The violent consumption requires (?:the [\w' -]+?|it) to release the creature as (?:it|they) feasts?\.$|^An? [\w' -]+? can regain Hit Points from consuming the flesh of a given creature only once per hour; [^.]+\.$/i, (said) => {
                (activity.notes ??= []).push(said);
                return "[told]";
            })
            // (Batch 206: Goring Charge's "If the Strike hits, the blooming guardian deals an extra 2d12 bludgeoning damage, and the target takes a –2
            // circumstance penalty to its next Fortitude save against blossom siphon."; Scorpion Sting's "Strikes an Off-Guard creature with its stinger. The
            // attack injects venom deeply, dealing an additional 4d8 poison damage and giving the target a –2 circumstance penalty to their initial save
            // against the poison." — the extra damage on a hit; the penalty to the save a note.)
            .replace(/^If the Strike hits, (?:the [\w' -]+?|it|they) deals an extra (\d+d\d+) (\w+) damage, and the target takes a [-\u2013\u2212](\d+) circumstance penalty to its next (\w+) save against ([\w' -]+?)\.$/i, (_all, dice, type, penalty, save, against) => {
                (activity.notes ??= []).push(`On a hit, the target also takes a –${penalty} circumstance penalty to its next ${save} save against ${against}.`);
                return `On a hit, the target takes @Damage[${dice}[${type.toLowerCase()}]] damage.`;
            })
            .replace(/^((?:The )?[^.]+?) Strikes an Off-Guard creature with (?:its|their) ([\w' -]+?)\.$/i, (_all, who, name) => {
                (activity.notes ??= []).push("Only at an Off-Guard creature.");
                activity.requires = "off-guard";
                return `${who} makes a ${name} Strike.`;
            })
            .replace(/^The attack injects venom deeply, dealing an additional (\d+d\d+) (\w+) damage and giving the target a [-\u2013\u2212](\d+) circumstance penalty to (?:its|their) initial save against the poison\.$/i, (_all, dice, type, penalty) => {
                (activity.notes ??= []).push(`On a hit, the target takes a –${penalty} circumstance penalty to its first save against the poison.`);
                return `On a hit, the target takes @Damage[${dice}[${type.toLowerCase()}]] damage.`;
            })
            // (Batch 204, the narwhal's Impaling Charge: "If it moved at least 20 feet from its starting position, the narwhal deals an extra 1d10 damage on this
            // Strike. A target damaged by Impaling Charge is Grabbed until the start of the narwhal's next turn unless it Escapes before then (DC 20). The
            // narwhal can't Grapple to extend the duration of this grab.")
            .replace(/^If it moved at least (\d+) feet from its starting position, (?:the [\w' -]+?|it) deals an extra (\d+d\d+) damage on this Strike\.$/i, (_all, feet, dice) => {
                (activity.notes ??= []).push(`The extra ${dice} damage only if it moved at least ${feet} feet.`);
                return `On a hit, the target takes @Damage[${dice}] damage.`;
            })
            .replace(/^A target damaged by [A-Z][\w' -]+? is Grabbed until the start of (?:the [\w' -]+?['’]s|its) next turn unless it Escapes before then \(DC (\d+)\)\.$/i, (_all, dc) => {
                (activity.notes ??= []).push(`The Grab lasts until the start of its next turn (Escape DC ${dc}); it can't Grapple to keep it.`);
                return "On a hit, the target is Grabbed until the start of its next turn.";
            })
            .replace(/^(?:The [\w' -]+?|It) can't Grapple to extend the duration of this grab\.$/i, "[told]")
            // (Batch 202, Musketeer's Advance: "If the Strike hits, the target is Off-Guard to melee attacks by the musketeer until the end of the musketeer's
            // next turn. Regardless of whether the Strike hit, the musketeer then Interacts to swap their flintlock musket for their rapier and Strides toward
            // the creature they attacked.")
            .replace(/^If the Strike hits, the target is Off-Guard to melee attacks by (?:the [\w' -]+?|it|them) until the end of (?:the [\w' -]+?['’]s|its|their) next turn\.$/i, () => {
                (activity.notes ??= []).push("On a hit, the target is Off-Guard to its melee attacks until the end of its next turn.");
                return "[told]";
            })
            .replace(/^Regardless of whether the Strike hit, (?:the [\w' -]+?|it|they) then Interacts to swap (?:its|their) [\w' -]+? for (?:its|their) [\w' -]+? and Strides toward the creature (?:it|they) attacked\.$/i, (said) => {
                (activity.notes ??= []).push(said.replace(/^Regardless of whether the Strike hit, (?:the [\w' -]+?|it|they) then/i, "Hit or miss, it then"));
                return "[told]";
            })
            // (Batch 201: Disrupt Qi's "attempts an unarmed Strike against a living creature. On a hit, the creature takes 3d6 persistent void damage and is
            // Enfeebled 2 until the persistent damage ends."; Head Shot's "The target is Dazzled until the end of the lucky courser's next turn on a successful
            // Strike (or Blinded on a critical hit)."; Will Not Falter's allies' bonus on a hit, its PF2e effect; Wrangling Whip's "can either knock the target
            // Prone or pull it up to 5 feet. If the creature ends this movement adjacent to the wrangler's mount, …" — Prone, the pull and the mount notes.)
            .replace(/\b((?:makes|attempts) an? [\w' -]+? Strike) against a living creature(?=\.$)/i, (_all, made) => {
                (activity.notes ??= []).push("Only at a living creature.");
                return made;
            })
            .replace(/^On a hit, the creature takes (\d+d\d+) persistent (\w+) damage and is (Enfeebled|Clumsy|Drained|Stupefied|Sickened) (\d) until the persistent damage ends\.$/i, (_all, dice, type, condition, value) => {
                (activity.notes ??= []).push(`${condition} ${value} lasts until the persistent damage ends.`);
                return `On a hit, the target takes @Damage[${dice}[persistent,${type.toLowerCase()}]] damage and is ${condition} ${value}.`;
            })
            .replace(/^The target is (Dazzled|Blinded|Deafened|Frightened \d) until the end of (?:the [\w' -]+?['’]s|its|their) next turn on a successful Strike \(or (Dazzled|Blinded|Deafened|Frightened \d) on a critical hit\)\.$/i, (_all, hit, critical) => {
                const [slug, value] = critical.toLowerCase().split(" ");
                activity.onHit.critical = [{ slug, value: value ? Number(value) : null, duration: { mode: "fixed", value: 1, unit: "rounds", expiry: "turn-end", anchor: "source-turn" } }];
                return `On a hit, the target is ${hit} until the end of its next turn.`;
            })
            .replace(/^If the Strike hits an enemy, all allies within (?:its|their) champion's aura gain a \+2 status bonus to attack rolls and saving throws against fear until the start of (?:the [\w' -]+?['’]s|its|their) next turn\.$/i, (said) => {
                (activity.notes ??= []).push(said.replace(/^If the Strike hits an enemy, /, "On a hit, ").replace(/the start of the [\w' -]+?['’]s next turn/i, "the start of its next turn"));
                return "[told]";
            })
            .replace(/^On a hit, (?:the [\w' -]+?|it|they) can either knock the target Prone or pull it up to (\d+) feet\.$/i, (_all, feet) => {
                (activity.notes ??= []).push(`It can pull the target up to ${feet} feet instead of knocking it Prone.`);
                return "On a hit, the target is knocked Prone.";
            })
            .replace(/^If the creature ends this movement adjacent to (?:the [\w' -]+?['’]s|its|their) mount, the mount can make a melee unarmed Strike against the creature as a free action\.$/i, (said) => {
                (activity.notes ??= []).push("If the pull leaves it beside its mount, the mount can make a free melee unarmed Strike at it.");
                return "[told]";
            })
            // (Batch 200: Reshape the Battle's "If it hits a creature of the master's size or smaller, the master can automatically Reposition it to any
            // space within the bo staff's reach."; Reel In's "If the Strike hits, the guard can haul on the attached line, moving the target up to 30 feet in
            // a straight line toward the iruxi." — notes.)
            .replace(/^If it hits a creature of (?:the [\w' -]+?['’]s|its|their) size or smaller, (?:the [\w' -]+?|it|they) can automatically Reposition it to any space within (?:the [\w' -]+?['’]s|its|their) reach\.$/i, () => {
                (activity.notes ??= []).push("On a hit at a creature its size or smaller, it can move that creature to any space within its reach.");
                return "[told]";
            })
            .replace(/^If the Strike hits, (?:the [\w' -]+?|it|they) can haul on the attached line, moving the target up to (\d+) feet in a straight line toward (?:the [\w' -]+?|it|them)\.$/i, (_all, feet) => {
                (activity.notes ??= []).push(`On a hit, it can pull the target up to ${feet} feet straight toward itself.`);
                return "[told]";
            })
            .replace(/^If it hits, it injects additional poison, causing its venom to gain the virulent trait\.$/i, () => {
                (activity.notes ??= []).push("On a hit, its venom gains the virulent trait.");
                return "[told]";
            })
            .replace(/\b(makes an?) (bludgeoning|piercing|slashing) ([\w' -]+? Strike) against the creature (?:he's|she's|it's|they're|it is) grabbing(?=\.$)/i, (_all, made, type, strike) => {
                (activity.notes ??= []).push(`Its ${strike} deals ${type.toLowerCase()} damage.`);
                return `${made} ${strike} against the grabbed creature`;
            })
            .replace(/^On a critical hit, the creature instead becomes wounded (\d)(?=, or increases its wounded value by \d if already wounded\.$)/i, "On a critical hit, the creature is Wounded $1 instead")
            .replace(/, or increases its wounded value by (\d) if already wounded(?=\.$)/i, (_all, value) => {
                (activity.notes ??= []).push(`A creature already wounded has its wounded value increased by ${value} instead.`);
                return "";
            })
            // (The heal's "HP; this is a healing effect." comes as a sentence of its own after its tag.)
            .replace(/^(?:HP|Hit Points); this is a healing effect\.$/i, (all) => (activity.notes?.some((note) => /\(a healing effect\)\.$/.test(note)) ? "[told]" : all))
            .replace(/^If a creature dies from [A-Z][\w' -]+?, (?:the [\w' -]+?|[A-Z][\w'-]+) regains (@Damage\[(?:[^[\]]|\[[^\]]*\])*\])(?: (?:HP|Hit Points); this is a healing effect)?\.?$/i, (_all, heal) => {
                (activity.notes ??= []).push(`If the creature dies from it, it regains ${heal.replace(/@Damage\[\(?([^\[\]()]+)\)?(?:\[[^\]]*\])?\]/, "$1")} Hit Points (a healing effect).`);
                return "[told]";
            })
            .replace(/^In addition, if the target is wearing armor with Hardness \d+ or lower, the armor becomes Broken\.$|^If this Strike breaks a creature's armor or damages a creature that is unarmored or wearing broken armor, the target also takes @Damage\[[^\]]*\]\]?\.$|^This Strike doesn't further damage armor that's already broken\.$/i, (said) => {
                (activity.notes ??= []).push(htmlToPlainText(said.replace(/@Damage\[\(?([^\[\]()]+)\)?\[([a-z,]+)\]\]/g, "$1 $2 damage")));
                return "[told]";
            })
            .replace(/^((?:The )?[^.]+?) makes a melee Strike trailing a wave of shadowy illusions\.$/i, "$1 makes a melee Strike.")
            .replace(/^If the Strike is successful, (?:the [\w' -]+?|it|they) increases the number of damage dice by one, and the target must attempt a (@Check\[[^\]]*\]) save\.$/i, (_all, check) => {
                activity.extraWeaponDice = (activity.extraWeaponDice ?? 0) + 1;
                const save = (/\b(fortitude|reflex|will)\b/i.exec(check)?.[1] ?? "").replace(/^\w/, (letter) => letter.toUpperCase());
                (activity.notes ??= []).push(`On a hit, the target also attempts a ${save} save (DC ${/dc:(\d+)/i.exec(check)?.[1] ?? "?"}); its results are the GM's.`.replace("  ", " "));
                return "[told]";
            })
            .replace(/^(?:On )?a failure, the target becomes Invisible, inaudible, and otherwise imperceptible to its allies for \d+ rounds, and it likewise can't see, hear, or otherwise perceive those allies\.$|^(?:Regardless )?of the outcome, the creature is temporarily immune to [A-Z][\w' -]+? for 24 hours\.$/i, (said) => {
                (activity.notes ??= []).push(said.replace(/^a failure/i, "On a failure").replace(/^of the outcome/i, "Whatever the outcome"));
                return "[told]";
            })
            // (Batch 173, Hunter's Aim: "makes a ranged weapon Strike against her hunted prey" — only at its prey; Dmiri's "When Dmiri focuses on aiming,
            // her attack becomes particularly accurate. Make a ranged weapon Strike against her hunted prey.")
            .replace(/^When [^,.]+? focuses on aiming, (?:her|his|its|their) attack becomes particularly accurate\.$/i, "[told]")
            .replace(/^((?:The )?[^.]+? makes|Make) a ranged weapon Strike against (?:its|their|his|her) hunted prey(?=\.$)/i, (_all, who) => {
                (activity.notes ??= []).push("Only at its hunted prey.");
                return `${who === "Make" ? "It makes" : who} a ranged Strike`;
            })
            // (Batch 81, Tangle Prey: "draws a bola and Strikes a target within 20 feet" as a bola Strike; "immediately rolls an Athletics check
            // against the target's Fortitude DC to Trip them" as a Trip.)
            .replace(/\bdraws an? ([\w' -]+?) and Strikes an? (?:target|creature|foe)(?: within \d+ feet)?(?=\.$)/i, "makes a $1 Strike")
            .replace(/\bimmediately rolls an? (?:@Check\[athletics[^\]]*\](?:\{[^}]*\})?|Athletics) check against the target's Fortitude DC to Trip (?:them|it|the target)(?=\.$)/i, "attempts to Trip the target")
            // (Batch 95: Concussive Shot's "against a creature within the weapon's first range increment"; Terrifying Strike's "attempts a weapon
            // Strike against a target, shouting threats and curses" — what it tells.)
            .replace(/\b(makes an? [\w' -]+? Strike) against a creature within the weapon's first range increment(?=\.$)/i, "$1")
            .replace(/\b((?:attempts|makes) an? (?:weapon |melee )?Strike) against a target, [a-z]+ing (?:(?!\d|@|\bdamage\b|\bbonus\b|\bpenalty\b)[^.])+(?=\.$)/i, "$1")
            // (Batch 108: Carve Projectile's "makes a rock ranged Strike that gains the deadly d10 trait" — its rock Strike, deadly d10; Wedge's
            // "attempts a stone tool Strike while wedging the blow further with another tool" — what it tells; "On a successful hit, the target
            // also falls Prone"; "Enfeebled 2 for 1 hour or until the creature is fully healed" — the healing the GM's.)
            .replace(/\b(makes an? [\w' -]+?) ranged Strike that gains the deadly (d\d+) trait(?=\.$)/i, (_all, made, die) => {
                activity.deadly = Number(die.slice(1));
                return `${made} Strike`;
            })
            .replace(/\b((?:attempts|makes) an? [\w' -]+? Strike) while [a-z]+ing (?:(?!\d|@|\bdamage\b|\bbonus\b|\bpenalty\b)[^.])+(?=\.$)/i, "$1")
            .replace(/^On a successful hit, the target also /i, "If it hits, the target ")
            // (Batch 109: Twist the Hook's "makes a melee Strike with its gaff"; Flay's "makes a blade Strike against an animal or humanoid" —
            // only at those, targetTraits; "On a success, … slices a long strip of flesh from the target; if the skitterstitch dealt damage, it
            // deals an additional 1d6 persistent bleed damage"; Twist the Hook's "If it hits, it twists and yanks the gaff to create an awful
            // wound, dealing 3d6 persistent bleed damage to the creature" — the damage on a hit.)
            .replace(/\bmakes an? (melee|ranged) Strike with one hand(?=\.$)/i, "makes a $1 Strike")
            // (Batch 111: "makes a jaws Strike against the grabbed creature" (or "the grabbed or restrained creature", "the grabbed target") —
            // at the creature it holds; "against an adjacent creature", "against the adjacent target", "against a target within reach", "at
            // the target", "against a target" — what any melee Strike is; "that deals one additional weapon damage die", "that deals two
            // additional weapon dice of damage" — more of its own dice; "and deals an additional 2d8 piercing damage on a hit".)
            .replace(/\b((?:makes|attempts) an? [\w' -]+? Strike) against the grabbed(?: or restrained)? (?:creature|target)(?= with an? \+\d+ circumstance bonus|\.$)/i, (_all, made) => {
                activity.requires = "grabbed";
                return made;
            })
            .replace(/\b((?:makes|attempts) an? [\w' -]+? Strike) (?:against (?:an? adjacent (?:creature|target|enemy|foe)|the adjacent (?:creature|target)|an? (?:target|creature|foe) within (?:its |their |his |her )?reach|an? target)|at the target)(?=\.$)/i, "$1")
            .replace(/\b((?:makes|attempts) an? [\w' -]+? Strike) that deals (one|two|three) additional weapon (?:damage )?(?:die|dice)(?: of damage)?(?=\.$)/i, (_all, made, count) => {
                activity.extraWeaponDice = (activity.extraWeaponDice ?? 0) + ({ one: 1, two: 2, three: 3 }[count.toLowerCase()]);
                return made;
            })
            // (Batch 245, Volcanic Hammer: "… makes a warhammer Strike that deals one extra weapon die of damage and @Damage[2d6[persistent,fire]] damage." —
            // its own die more, and that damage on a hit.)
            .replace(/\b((?:makes|attempts) an? [\w' -]+? Strike) that deals (one|two|three) extra weapon (?:damage )?(?:die|dice)(?: of damage)? and (@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?) damage(?=\.$)/i, (_all, made, count, damage) => {
                activity.extraWeaponDice = (activity.extraWeaponDice ?? 0) + ({ one: 1, two: 2, three: 3 }[count.toLowerCase()]);
                activity.onHit.damage.push(readDamage(inlineTags(damage, "Damage")[0]));
                return made;
            })
            .replace(/\b((?:makes|attempts) an? [\w' -]+? Strike) and deals an additional (@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?|\d+d\d+ \w+) damage on a hit(?=\.$)/i, (_all, made, damage) => {
                const tags = inlineTags(damage, "Damage");
                const formula = tags.length ? readDamage(tags[0]) : plainDice(damage.replace(/ (\w+)$/, "[$1]"));
                if (formula) activity.onHit.damage.push(formula);
                return made;
            })
            .replace(/\bmakes an? (?:melee|ranged) Strike with (?:its|his|her|their) ([\w' -]+?)(?=\.$)/i, (all, weapon) => (/^(?:one|other|free) hand$/i.test(weapon) ? "makes a melee Strike" : `makes a ${weapon} Strike`))
            // (Batch 110: Combat Grab's "If the Strike hits, they grab the target using their free hand." as a Grab on a hit; "The creature
            // remains Grabbed until the end of the guard's next turn or until it Escapes, whichever comes first." — the Grab's own time.)
            .replace(/^If (?:the|this) Strike hits, (?:they|it|he|she|the [\w' -]+?) grabs? the target using (?:their|its|his|her) (?:free|other) hand(?=\.$)/i, "If it hits, the target is Grabbed")
            .replace(/^If it hits, (?:they|it|he|she) grabs? the target using (?:their|its|his|her) (?:free|other) hand(?=\.$)/i, "If it hits, the target is Grabbed")
            .replace(/^The creature remains Grabbed until the end of (?:the [\w' -]+?['’]s|its|their|his|her) next turn or until it Escapes, whichever comes first(?=\.$)/i, "[grab time]")
            // (Twist the Hook's other telling: "… to knock the target Prone and create an awful wound, dealing 2d6 persistent bleed damage to the
            // creature" — Prone and the bleed on a hit.)
            .replace(/^If it hits, (?:it|he|she|they) [a-z]+s(?: and [a-z]+s)? the [\w' -]+? to knock the target Prone and [^,]+?, dealing (?:@Damage\[\(?(\d+d\d+)\)?\[(persistent,)?(\w+)\]\]|(\d+d\d+) (persistent )?(\w+)) damage to the (?:creature|target)(?=\.$)/i, (_all, tagDice, tagPersistent, tagType, dice, persistent, type) => {
                activity.onHit.conditions.push({ slug: "prone", value: null, duration: null });
                return `If it hits, it deals an additional ${tagDice ?? dice} ${tagPersistent || persistent ? "persistent " : ""}${tagType ?? type} damage`;
            })
            .replace(/\b(makes an? [\w' -]+? Strike) against an? (animal|humanoid|beast|undead|construct|fey|fiend|dragon|plant)(?: or (animal|humanoid|beast|undead|construct|fey|fiend|dragon|plant))?(?=\.$)/i, (_all, made, one, two) => {
                activity.targetTraits = [one, two].filter(Boolean).map((trait) => trait.toLowerCase());
                return made;
            })
            .replace(/^On a (?:success|hit), [^;.]+; if (?:it|the [\w' -]+?) dealt damage, (?:it|they) deals? an additional (.+?) damage(?=\.$)/i, "If it hits, it deals an additional $1 damage")
            .replace(/^If it hits, (?:it|he|she|they) [a-z]+s(?: and [a-z]+s)? (?:[^,.])+, dealing (\d+d\d+) (persistent )?(\w+) damage to the (?:creature|target)(?=\.$)/i, (_all, dice, persistent, type) => `If it hits, it deals an additional ${dice} ${persistent ?? ""}${type} damage`)
            .replace(/ or until the creature is fully healed(?=\.$)/i, "")
            // (Batch 83, Portal Strike: "makes a claw Strike against a creature within 120 feet" — the distance the GM's.)
            // (Batch 156, Reach Beyond: the distance a note for the GM.)
            .replace(/\b(makes an? [\w' -]+? Strike) against an? (?:creature|foe|enemy|target) within (\d+) feet(?=\.$)/i, (_all, made, feet) => {
                (activity.notes ??= []).push(`Its reach is ${feet} feet for this Strike.`);
                return made;
            })
            // (Batch 112, Demolishing Swing: "makes a maul Strike against a creature"; "If it hits, the creature is pushed 10 feet"; "If the target
            // is wearing metal armor, its armor also takes the damage, which bypasses 5 of the armor's Hardness." — the armor the GM's; Sentry's
            // Aim's "The Strike ignores the Concealed condition, lesser cover, and standard cover, …" — the GM's too.)
            .replace(/\b(makes an? [\w' -]+? Strike) against an? (?:creature|foe|enemy)(?=\.$)/i, "$1")
            .replace(/^If it hits, the creature is pushed (\d+) feet(?=\.$)/i, "If it hits, the target is pushed $1 feet")
            .replace(/^If the target is wearing metal armor, its armor also takes the damage, which bypasses \d+ of the armor's Hardness\.$/i, "[gm]")
            .replace(/^The Strike ignores the Concealed condition, lesser cover, and standard cover, and reduces greater cover to standard cover\.$/i, "[gm]")
            // (Batch 127: Clobber's "On a hit, if the target is Off-Guard, the target must succeed at …" — its save only against an off-guard
            // target; Go for the Eyes' critical hit making the save one degree worse and Throw Shadow Blade's dagger losing its magic, the GM's;
            // Grievous Cut's "If he hits, the blade cuts deep …. In addition to the normal damage caused by the attack, the creature struck takes
            // … and becomes Wounded 1 (or increases …)"; "(double damage on a critical success)", as any rider's damage.)
            .replace(/^On a hit, if the target is Off-Guard, (?=the target must succeed)/i, () => {
                activity.onHit.saveIf = "off-guard";
                return "On a hit, ";
            })
            .replace(/^If the Strike was a critical hit, the target's save result is one degree of success worse\.$|^The [\w' -]+? loses its [\w' -]+? magic as soon as the attack is resolved\.$/i, "[gm]")
            .replace(/^If (?:it|he|she|they) hits, the (?:blade|weapon|claw|jaws|bite) (?:cuts|bites|tears) deep and creates a grievous wound\.$/i, "[told]")
            .replace(/^In addition to the normal damage caused by the attack, the creature struck takes (@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?) damage and becomes Wounded (\d)(?: \(or increases the value of an existing wounded condition by 1, to a maximum of Wounded 4\))?\.$/i, "If it hits, the creature struck takes $1 damage and becomes Wounded $2.")
            .replace(/ \(double damage on a critical (?:success|hit)\)/i, "")
            // (Batch 128: Immobilizing Thrust's "until" (above); Tickle Bite's "If successful, after taking the normal damage from the Strike, the
            // target must succeed at … or become Slowed 1 for 1 minute as it becomes overcome with fits of laughter"; Nerve Strike's "Strikes with
            // their fist. If they hit, the target is Paralyzed until the end of the agent's next turn (@Check[…] negates).")
            .replace(/^The creature stays \w+ until [^.]+\.$/i, "[gm]")
            // (Batch 128: "the damaged creature is Frightened 1"; Tackle's "If the jaws Strike hits and the target is Medium or smaller, the target is
            // knocked Prone", Gnaw Metal's "… is knocked Prone if it is Medium or smaller" — the rider's size; "On a hit, it deals an extra 1d6
            // precision damage on a hit"; Big Thwunk's "On a successful hit, the target is pushed back 5 feet, with the effects of a successful
            // Shove"; Burrowed Ambush's automatic Grab, and its Stride after (hit or not), the GM's.)
            .replace(/^(If (?:it|he|she|they) hits?(?: and deals? damage)?), the damaged creature is /i, "$1, the target is ")
            .replace(/^If the (?:[\w' -]+? Strike|attack|Strike) hits and the target is (Tiny|Small|Medium|Large|Huge) or smaller, the target is knocked Prone(?=\.$)/i, (_all, size) => {
                activity.onHit.size = size.toLowerCase();
                return "If it hits, the target is knocked Prone";
            })
            .replace(/^If the (?:attack|Strike) hits, the target is knocked Prone if it is (Tiny|Small|Medium|Large|Huge) or smaller(?=\.$)/i, (_all, size) => {
                activity.onHit.size = size.toLowerCase();
                return "If it hits, the target is knocked Prone";
            })
            .replace(/^On a hit, (?:it|he|she|they) deals an (extra|additional) (.+?) damage on a hit(?=\.$)/i, "If it hits, it deals an $1 $2 damage")
            .replace(/^On a successful hit, the target is pushed back (\d+) feet, with the effects of a successful Shove(?=\.$)/i, "If it hits, the target is pushed $1 feet")
            // (Batch 172, Horn Toss: "If the Strike hits, the target is flung 20 feet in a direction of the aoyin's choice." — a push, its way the
            // GM's.)
            .replace(/^If (?:the Strike|it) hits, the target is flung (\d+) feet in a direction of (?:the [\w' -]+?['’]s|its|their|his|her) choice(?=\.$)/i, (_all, feet) => {
                (activity.notes ??= []).push(`The target is flung ${feet} feet in a direction of its choice.`);
                return `If it hits, the target is pushed ${feet} feet`;
            })
            .replace(/^On a hit, (?:the [\w' -]+?|it|they) automatically Grabs the (?:creature|target)(?=\.$)/i, "If it hits, the target is Grabbed")
            // (Batch 153: Shared Feast's "If it hits, an ally of their choice can spend a reaction to make a jaws Strike against the same target.",
            // Bonded Strike's "If this attack hits, the bonded mortal can spend their reaction to Strike the same target." — an ally's Strike after a
            // hit.)
            .replace(/^If (?:it|this attack|the Strike|the attack) hits, (?:an ally of (?:its|their|his|her) choice can spend a reaction to make an? ([\w' -]+?) Strike against the same target|the bonded mortal can spend (?:its|their|his|her) reaction to Strike the same target)\.$/i, (_all, name) => {
                activity.onHit.allyStrike = true;
                (activity.notes ??= []).push(name ? `If it hits, an ally can spend its reaction to make a ${name.toLowerCase()} Strike (or a similar one) against the same target.` : "If it hits, its bonded mortal can spend its reaction to Strike the same target.");
                return "[told]";
            })
            .replace(/^Allies with [^.]+? can use those instead of [\w' -]+\.$/i, (all) => (activity.onHit.allyStrike ? "[told]" : all))
            // (Batch 153: Draining Touch's "makes a ghostly hand Strike but deals no damage on a hit. Instead, the target is Drained 1 for 1 day and
            // Ulthadar regains 4 Hit Points."; Pinning Shot's "If the attack hits, it deals no damage and instead pins the target to an adjacent
            // surface. The target is Immobilized and must spend an Interact action to attempt a DC 10 Athletics check to pull the dart free; …" —
            // no damage, its results; the healing on itself.)
            .replace(/^((?:The )?[^.]+? makes an? [\w' -]+? Strike) but deals no damage on a hit(?=\.$)/i, (_all, made) => {
                activity.noDamage = true;
                return made;
            })
            // (Batch 222, a Battlezoo shade's smear: a Strike with no damage, a condition on a hit instead.)
            .replace(/^((?:The )?[^.]+? makes an? [\w' -]+? Strike) that (?:deals|does) no damage(?=\.$)/i, (_all, made) => {
                activity.noDamage = true;
                return made;
            })
            // (Batch 263, Bloody Handprint: "The excorion plants a magical handprint on the target, marking them as chosen for death. The excorion makes
            // a fist Strike against an adjacent creature; this doesn't count toward the excorion's multiple attack penalty. On a hit, the attack does no
            // damage, but the creature becomes observed to every excorion within 60 feet, … This effect lasts until the handprint is washed off, …" —
            // a Strike with no damage outside its multiple attack penalty; the mark, notes.)
            .replace(/^(?:The )?[^.]+? plants a magical [\w' -]+? on the target, marking (?:them|it) as [^.]+\.$/i, "[told]")
            .replace(/^((?:The )?[^.]+? makes an? [\w' -]+? Strike) against an adjacent creature; this (?:doesn't|does not) count toward (?:the [\w' -]+?['’]s|its|their) multiple attack penalty(?=\.$)/i, (_all, made) => {
                activity.noMap = true;
                return made;
            })
            .replace(/^On a hit, the attack does no damage, but (the creature becomes [^.]+)\.$/i, (_all, rest) => {
                activity.noDamage = true;
                (activity.notes ??= []).push(`It deals no damage: on a hit, ${rest}.`);
                return "[told]";
            })
            .replace(/^This effect lasts until the [\w' -]+? is washed off\b[^.]*\.$/i, (all) => {
                (activity.notes ??= []).push(all);
                return "[told]";
            })
            .replace(/^Instead, on a hit, the target is /i, (all) => (activity.noDamage ? "On a hit, the target is " : all))
            .replace(/^Instead, the target (?:is|becomes) (?:@UUID\[[^\]]*\]\{Drained (\d)\}|Drained (\d))(?: for 1 day)?,? and (?:the [\w' -]+?|[A-Z][\w'-]+|it|he|she|they) regains? @Damage\[(\d+|\(max\(1,floor\(@actor\.level\/2\)\)\))\[healing\]\](?:\{[^}]*\})?(?: (?:Hit Points|HP))?\.?$/i, (all, linked, plain, heal) => {
                const value = linked ?? plain;
                const level = Number(actor?.system?.details?.level?.value);
                const amount = /^\d+$/.test(heal) ? Number(heal) : Number.isFinite(level) ? Math.max(1, Math.floor(level / 2)) : null;
                if (!activity.noDamage || !amount) return all;
                activity.onHit.conditions.push({ slug: "drained", value: Number(value), duration: { mode: "fixed", value: 1, unit: "days" } });
                activity.onHit.selfHeal = amount;
                (activity.notes ??= []).push(`It deals no damage: on a hit, the target is Drained ${value} for 1 day and it regains ${amount} HP.`);
                return "[told]";
            })
            // ("… regains @Damage[4[healing]] Hit Points." split after its tag.)
            .replace(/^(?:Hit Points|HP)\.$/, (all) => (activity.onHit.selfHeal ? "[told]" : all))
            .replace(/^If the attack hits, it deals no damage and instead pins the target to an adjacent surface\.$/i, () => {
                activity.noDamage = true;
                return "[told]";
            })
            .replace(/^The target is Immobilized and must spend an Interact action to attempt an? (?:@Check\[athletics\|dc:(\d+)[^\]]*\]|DC (\d+) Athletics) check to pull the ([\w' -]+?) free; it can(?:'t|not) move from its space until it succeeds\.$/i, (all, dc, plainDc, what) => {
                if (!activity.noDamage) return all;
                activity.onHit.conditions.push({ slug: "immobilized", value: null, duration: null });
                (activity.notes ??= []).push(`It deals no damage: on a hit, the target is pinned — Immobilized (and Off-Guard) until it spends an Interact action on a DC ${dc ?? plainDc} Athletics check to pull the ${what} free (two successes after a critical hit); remove them then.`);
                return "[told]";
            })
            .replace(/^If [^.]+? Strike was a critical hit, the target must succeed at two separate Athletics checks to pull the [\w' -]+? free\.$/i, (all) => (activity.noDamage ? "[told]" : all))
            .replace(/^The target is Off-Guard while it remains immobilized in this way\.$/i, (all) => {
                if (!activity.noDamage) return all;
                activity.onHit.conditions.push({ slug: "off-guard", value: null, duration: null });
                return "[told]";
            })
            // (Batch 156: Unfair Aim's "lines up a shot and then attempts a ranged Strike against a hunted prey. On this strike, he treats the target
            // as if they were Off-Guard."; Aimed Shot's "makes a single mammoth bow Strike against his prey; he gains a +2 circumstance bonus to the
            // attack roll and ignores his prey's Concealed condition"; Sniping Shot's "makes a Strike with their longrifle, gaining a +2
            // circumstance bonus to this Strike's attack roll and ignoring the target's concealment" — the prey and concealment notes.)
            .replace(/^((?:The )?[^.]+?) lines up a shot and then attempts a ranged Strike against a hunted prey\.$/i, (_all, who) => {
                (activity.notes ??= []).push("Only at its hunted prey.");
                return `${who} makes a ranged Strike.`;
            })
            .replace(/^On this strike, (?:he|she|it|they) treats? the target as if (?:they|it) (?:were|was) Off-Guard\.$/i, () => {
                activity.offGuard = true;
                return "[told]";
            })
            .replace(/^((?:The )?[^.]+?) makes a single ([\w' -]+?) Strike against (?:its|their|his|her) prey; (?:he|she|it|they) gains? a \+(\d+) circumstance bonus to the attack roll and ignores (?:its|their|his|her) prey's Concealed condition\.$/i, (_all, who, name, value) => {
                (activity.notes ??= []).push("Only at its prey; it ignores the prey's Concealed condition.");
                return `${who} makes a ${name} Strike with a +${value} circumstance bonus to its attack roll.`;
            })
            .replace(/^((?:The )?[^.]+?) makes a Strike with (?:its|their|his|her) ([\w' -]+?), gaining a \+(\d+) circumstance bonus to this Strike's attack roll and ignoring the target's concealment\.$/i, (_all, who, name, value) => {
                (activity.notes ??= []).push("It ignores the target's concealment.");
                return `${who} makes a ${name} Strike with a +${value} circumstance bonus to its attack roll.`;
            })
            // (Batch 156: Furious Power Attack's "This counts as one attack when calculating her multiple attack penalty. If the Strike hits, she deals
            // an extra die of weapon damage."; To the Hilt's "makes a melee jambiya Strike and buries the blade deep, dealing an extra 3d6 persistent
            // bleed damage on a hit (6d6 on a critical hit)"; Flog Mercilessly's "Strikes with her scourge. On a hit, she rolls damage three times.")
            .replace(/^This counts as one attack when calculating (?:its|their|his|her) multiple attack penalty\.$/i, "[told]")
            .replace(/^If the Strike hits, (?:he|she|it|they) deals? an extra die of weapon damage\.$/i, "If it hits, it deals an extra die of weapon damage.")
            .replace(/^((?:The )?[^.]+?) makes a melee ([\w' -]+?) Strike and [^,.]+, dealing an extra (@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?) damage on a hit \((\d+d\d+) on a critical hit\)\.$/i, (all, who, name, tag, critical) => {
                const formula = /^@Damage\[((?:[^[\]]|\[[^\]]*\])*)\]/.exec(tag)[1];
                const dice = /^\(?(\d+)d(\d+)/.exec(formula);
                const crit = /^(\d+)d(\d+)$/.exec(critical);
                if (!dice || !crit || Number(crit[1]) !== 2 * Number(dice[1]) || crit[2] !== dice[2]) return all;
                activity.onHit.damage.push(readDamage(formula));
                return `${who} makes a ${name} Strike.`;
            })
            .replace(/^((?:The )?[^.]+?) Strikes with (?:its|their|his|her) ([A-Za-z' ]+?)\.$/i, (all, who, name) => (activity.strike || /\b(?:Strike|at|with|against)\b/i.test(name) ? all : `${who} makes a ${name.trim()} Strike.`))
            .replace(/^On a hit, (?:he|she|it|they) rolls? damage three times\.$/i, () => {
                activity.damageTimes = 3;
                (activity.notes ??= []).push("On a hit, roll its damage three times and add them up (one total against resistances and weaknesses).");
                return "[told]";
            })
            .replace(/^This damage is combined \([^)]*\)\.$/i, (all) => (activity.damageTimes ? "[told]" : all))
            // (Batch 156: Sweep Aside's "If he hits a creature of his size or smaller, he can move it 5 feet in any direction, or 10 feet on a critical
            // hit." — a push, its direction the GM's; Shattering Scrape's broken armor and Sporewarp's far origin, the GM's.)
            .replace(/^If (?:he|she|it|they) hits a creature of (?:his|her|its|their) size or smaller, (?:he|she|it|they) can move it (\d+) feet in any direction, or (\d+) feet on a critical hit\.$/i, (_all, feet, crit) => {
                activity.onHit.push = Number(feet);
                activity.onHit.criticalPush = Number(crit);
                const size = { tiny: "tiny", sm: "small", med: "medium", lg: "large", huge: "huge", grg: "gargantuan" }[actor?.system?.traits?.size?.value];
                if (size) activity.onHit.size = size;
                (activity.notes ??= []).push(`On a hit it moves a creature its size or smaller ${feet} feet in any direction (${crit} on a critical hit).`);
                return "[told]";
            })
            .replace(/^((?:The )?[^.]+? makes an? [\w' -]+? Strike) against a creature wearing stone or metal armor\.$/i, "$1.")
            .replace(/^If the Strike hits and the armor's Hardness is \d+ or lower, that armor is broken\.$/i, "[gm]")
            .replace(/^((?:The )?[^.]+?) attempts an? ([\w' -]+?) Strike but treats [^.]+? as the point of origin of that [\w' -]+? Strike\.$/i, (all, who, name) => {
                (activity.notes ??= []).push(all.replace(/^(?:The )?[^.]+? attempts an? [\w' -]+? Strike but /i, "It "));
                return `${who} makes a ${name} Strike.`;
            })
            // (Batch 152, Disorienting Shot: "He must then Stride." — the GM's.)
            .replace(/^Whether or not (?:it|they|he|she) hits?, (?:the [\w' -]+?|it|they) then Strides\.$|^(?:It|They|He|She|The [\w' -]+?) must then Stride\.$|^If (?:it|they) (?:has|have) a creature grabbed, the creature moves with (?:the [\w' -]+?|it|them)\.$/i, "[gm]")
            // (Batch 140: what it does to itself — Defensive Slam's "Strikes once and gains a +2 circumstance bonus to AC until the start of their
            // next turn", Punishing Strike's "… in a reckless attack that makes him Off-Guard until the start of his next turn", "The skelm is
            // Off-Guard until the start of his next turn" → selfAfter, a note live.)
            .replace(/^((?:The )?[^.]+?) Strikes once and gains a \+(\d) circumstance bonus to AC until the start of (?:its|their|his|her) next turn(?=\.$)/i, (_all, who, value) => {
                (activity.selfAfter ??= []).push({ ac: Number(value), type: "circumstance" });
                (activity.notes ??= []).push(`After the Strike, it gains a +${value} circumstance bonus to AC until the start of its next turn.`);
                return `${who} makes a Strike`;
            })
            // (Defensive Slam's "Effect: Defensive Slam": PF2e's effect for that bonus.)
            .replace(/^Effect: [\w' -]+$/, (link) => (activity.selfAfter?.some((entry) => entry.ac) ? "[told]" : link))
            .replace(/^(?:The )?[^.]+? (?:is Off-Guard|in a reckless attack that makes (?:him|her|it|them) Off-Guard) until the start of (?:its|their|his|her) next turn\.$/i, () => {
                (activity.selfAfter ??= []).push({ slug: "off-guard", until: "own-turn-start" });
                (activity.notes ??= []).push("It's Off-Guard until the start of its next turn.");
                return "[told]";
            })
            // (Batch 148, two Battlezoo dragons' long-limbed attacks: a Strike whose reach grows by some feet (a younger one's figure in brackets),
            // or one at a creature some way off, then on a hit a Grapple or a Trip (with a bonus) — the reach, the bonus, a first-sight
            // Off-Guard, the pull afterwards and the penalty's timing for the GM, notes.)
            .replace(/^(?:They|It|He|She|The [\w' -]+?) makes? an? ([\w' -]+?) Strike with reach increased by (\d+) feet(?: \([^)]*\))?(?=\.$)/i, (_all, name, feet) => {
                (activity.notes ??= []).push(`Its reach is ${feet} feet longer for this Strike.`);
                return `It makes a ${name} Strike`;
            })
            .replace(/^((?:The )?[\w' -]+?) makes? an? ([\w' -]+?) Strike against a creature within (\d+) feet; on a success, (?:they|it|he|she) can also (?:attempt|try) to (Trip|Shove|Grapple|Disarm) (?:the target|it) with a \+(\d) circumstance bonus(?=\.$)/i, (_all, who, name, feet, act, bonus) => {
                (activity.notes ??= []).push(`Its reach is ${feet} feet for this Strike.`, `+${bonus} circumstance bonus to the ${act}.`);
                activity.onHit.follow = act.toLowerCase();
                return `${who} makes a ${name} Strike`;
            })
            .replace(/^On a successful hit, (?:the [\w' -]+?|it|they) can immediately attempt an Athletics check to (Grapple|Trip|Shove) the target(; apply the multiple attack penalty for both the Strike and the \1 only after resolving the \1 attempt)?(?=\.$)/i, (_all, act, later) => {
                if (later) (activity.notes ??= []).push(`The Strike and the ${act} both take the multiple attack penalty from before them.`);
                return `If it hits, it can attempt to ${act} the target`;
            })
            .replace(/^The target is Off-Guard if (?:they|it) (?:haven't|hasn't) seen an? [\w' -]+?['’]s [\w' -]+? before\.$|^On a successful (?:Grapple|Trip|Shove), (?:the [\w' -]+?|it|they) can choose to pull the Grabbed creature adjacent to (?:them|it)\.$/i, "[gm]")
            .replace(/^Apply (?:the )?multiple attack penalty normally to both checks\.$|^(?:The )?[\w' -]+?['’]s [\w' -]+? extends? out to a great distance to [^.]+\.$/i, "[told]")
            // (Batch 147, Brutish Shove: "makes a single Strike with a two-handed melee weapon. If he hits a target that is their size or smaller,
            // that creature is Off-Guard until the end of the brute's turn, and he can automatically Shove it with the same benefits as the Shove
            // action (including the critical success effect, if the Strike was a critical hit)." — 5 feet, 10 on a critical hit, the size and its
            // failure effect the GM's; Improved Knockdown: "They attempt a single melee Strike. If this Strike hits, they also apply the critical
            // success effect of a Trip." — Prone and 1d6 bludgeoning, the bigger die with a two-handed weapon the GM's.)
            .replace(/^((?:The )?[^.]+?) makes a single Strike with a two-handed melee weapon(?=\.$)/i, (_all, who) => {
                (activity.notes ??= []).push("With a two-handed melee weapon.");
                return `${who} makes a melee Strike`;
            })
            .replace(/^If (?:he|she|it|they|the [\w' -]+?|[A-Z][\w'-]+) hits a target that is (?:their|its|his|her) size or smaller, that creature is Off-Guard until the end of (the [\w' -]+?['’]s) turn, and (?:he|she|it|they|the [\w' -]+?|[A-Z][\w'-]+) can automatically Shove(?:: Athletics)? it with the same benefits as the Shove action \(including the critical success effect, if the Strike was a critical hit\)(?=\.$)/i, (_all, whose) => {
                activity.onHit.push = 5;
                activity.onHit.criticalPush = 10;
                (activity.notes ??= []).push("Only a creature its size or smaller.");
                return `If it hits, the target is Off-Guard until the end of ${whose} turn`;
            })
            .replace(/^If (?:he|she|it|they|the [\w' -]+?|[A-Z][\w'-]+) moves to follow the target, that movement (?:doesn't|does not) trigger reactions\.$|^Failure The target becomes off-guard until the end of [^.]+?['’]s current turn\.$|^If (?:they|he|she|it) used a two- ?handed melee weapon \(such as a maul\) for the Strike, [^.]+\.$/i, "[gm]")
            .replace(/^This Strike has the following failure effect\.$|^An? [\w' -]+? can dash (?:their|its|his|her) foe to the ground with a single blow\.$/i, "[told]")
            // (Batch 151, Shatter Defenses: "makes a melee Strike against the frightened creature. If they hit and deal damage, the target becomes
            // Off-Guard as long as it's frightened. If the target is already off-guard, …" — at a frightened creature (its requirement), Off-Guard
            // for a round, how long it lasts and the rest the GM's.)
            .replace(/^((?:The )?[\w' -]+?) makes a melee Strike against the frightened creature(?=\.$)/i, "$1 makes a melee Strike")
            .replace(/^If (?:they|it|he|she) hit and deal damage, the target becomes Off-Guard as long as it's frightened(?=\.$)/i, () => {
                (activity.notes ??= []).push("The Off-Guard lasts as long as the target is frightened.");
                return "If it hits and deals damage, the target is Off-Guard for 1 round";
            })
            .replace(/^If the target is already off-guard, it can(?:'t|not) reduce its frightened value below 1 until the start of [^.]+?['’]s next turn\.$/i, "[gm]")
            // (Batch 150, Break Legs!: "As long as this clumsy condition lasts, the creature also takes a –5-foot penalty to its Speeds and has weakness
            // 5 to the legbreaker's Strikes. Effect: Break Legs!" — PF2e's effect has them: notes.)
            .replace(/^As long as this clumsy condition lasts, [^.]+\.$|^Effect: [\w' -]+!?$/i, "[gm]")
            .replace(/^(?:They|He|She|It) attempts? a single melee Strike(?=\.$)/i, "It makes a melee Strike")
            .replace(/^If this Strike hits, (?:they|he|she|it) also appl(?:y|ies) the critical success effect of a Trip(?=\.$)/i, "If it hits, the target is knocked Prone and takes @Damage[1d6[bludgeoning]] damage")
            // (Batch 142, Create Boulder: "… molds a boulder from primal earth and throws it as a rock Strike. A creature hit by the Strike must
            // succeed at a … save or be knocked Prone.")
            .replace(/^((?:The )?[^.]+?) (?:[a-z]+s [^.]*? and )?throws it as an? ([\w' -]+?) Strike(?=\.$)/i, "$1 makes a $2 Strike")
            .replace(/^A creature hit by the Strike must succeed at /i, "If it hits, the target must succeed at ")
            // (Batch 139: Skewer's "Strikes with its rapier, and gains a +1 circumstance bonus to the attack roll" and "A creature damaged by the
            // attack takes 1d6 bleed"; Big Swing's "The target is Pushed up to 10 feet on a hit or up to 20 feet on a critical hit" and its
            // collision (the GM's).)
            .replace(/^((?:The )?[^.]+?) Strikes with (?:its|their|his|her) ([\w' -]+?), and gains a \+(\d) circumstance bonus to the attack roll(?=\.$)/i, "$1 makes a $2 Strike with a +$3 circumstance bonus to the attack roll")
            .replace(/^A creature damaged by the (?:attack|Strike) takes /i, "If it hits and deals damage, the target takes ")
            .replace(/^The target is Pushed up to (\d+) feet on a hit or up to (\d+) feet on a critical hit(?=\.$)/i, (_all, feet, critical) => {
                activity.onHit.criticalPush = Number(critical);
                return `If it hits, the target is pushed ${feet} feet`;
            })
            .replace(/^If the target collides with a solid object(?: or lands on the ground)?, it takes bludgeoning damage as though it had fallen the distance it moved\.$/i, "[gm]")
            // (Gnaw Metal's armor made Broken; Big Thwunk's following the foe: the GM's.)
            // (Batch 219: Tactical Gnaw's "On a successful attack, if the target is wearing armor with Hardness 10 or lower, the armor becomes Broken.";
            // Chain Shot's reeling in, its ship pulling the creature along; Drain Nutrients' "On a success, Somnalu drains the creature's life through its
            // skin." and its temporary Hit Points from what the creature loses — the GM's.)
            .replace(/^(?:In addition|On a successful attack), if the target is wearing armor with Hardness \d+ or lower, the armor becomes Broken\.$|^If the target is Off-Guard, then the [\w' -]+? can follow the foe\.$/i, "[gm]")
            // (Batch 221, Thundering Iron: each creature in an emanation around the target taking the extra damage too and pushed — the GM's.)
            .replace(/^Each creature in an? @Template\[(?:type:)?emanation\|distance:\d+\](?:\{[^}]*\})? around the target, other than (?:the [\w' -]+?|it), takes? this damage as well and (?:is|are) pushed \d+ feet away from the target\.$/i, "[gm]")
            .replace(/^(?:The )?[\w' -]+? can use Interact actions to reel in a grabbed creature \d+ feet per action spent, and when (?:the [\w' -]+?|it) moves, it pulls the grabbed creature along with it\.$|^On a success, (?:the [\w' -]+?|[A-Z][\w'-]+|it) drains the creature['’]s life through its skin\.$|^(?:The [\w' -]+?|[A-Z][\w'-]+|It) gains temporary Hit Points equal to the amount of Hit Points the creature loses from this Strike\.$/i, "[gm]")
            // (Batch 219, Drain Nutrients: "Somnalu targets a creature with a claw Strike." — its claw Strike; Chain Shot: "A creature hit by this Strike is
            // Grabbed by the chain ([[/act escape dc=41]])." — Grabbed on a hit, its Escape DC a note.)
            .replace(/^(?:The )?([^.]+?) targets a creature with an? ([\w' -]+?) Strike(?=\.$)/i, "$1 makes a $2 Strike")
            .replace(/^A creature hit by this Strike is Grabbed(?: by the [\w' -]+?)? \((?:\[\[\/act escape dc=(\d+)\]\](?:\{[^}]*\})?|Escape DC (\d+))\)(?=\.$)/i, (_all, dc, plain) => {
                (activity.notes ??= []).push(`Escape DC ${dc ?? plain}.`);
                return "If it hits, the target is Grabbed";
            })
            .replace(/^If successful, after taking the normal damage from the Strike, (the target must succeed at .+? save or become [^.]+?)(?: as it becomes [a-z][^.@]*)?(?=\.$)/i, "If it hits, $1")
            .replace(/^(?:The )?([^.]+?) Strikes with (?:its|their|his|her) (?![^.]* at an? [-\u2013\u2212]?\d)([\w' -]+?)(?=\.$)/i, "$1 makes a $2 Strike")
            .replace(/^If (?:it|he|she|they) hits?, the target is (\w+)( until [^(.]+?)? \((@Check\[(?:fortitude|reflex|will)[^\]]*\](?:\{[^}]*\})?) negates\)(?=\.$)/i, "If it hits, the target must succeed at a $3 save or be $1$2")
            // (Batch 130: Point Blank's "… against an adjacent enemy; unlike most ranged Strikes, this Strike doesn't provoke reactions" and "If
            // successful, the attack deals an additional 4d8 precision damage"; Disembowel's "that creature becomes Drained 1 (or increases its drained
            // value by 1, to a maximum of 4)"; Felling Blow's "…, increasing his reach by 5 feet for that Strike" and Attack from Above's "… with its
            // reach increased to 15 feet" (notes); Deadly Aim's "at a –2 penalty" and "deals 4 additional damage with this Strike".)
            .replace(/\b(makes an? [\w' -]+? Strike) against an adjacent (?:enemy|creature|foe); unlike most ranged Strikes, this Strike (?:doesn't|does not) provoke reactions(?=\.$)/i, (_all, made) => {
                (activity.notes ??= []).push("This ranged Strike at an adjacent creature doesn't provoke reactions.");
                return made;
            })
            .replace(/^If successful, the attack deals an (additional|extra) (.+?) damage(?=\.$)/i, "If it hits, it deals an $1 $2 damage")
            // (Batch 250, Implacable Curse: "If it hits, it deals an additional 2d8 spirit damage, and the target must attempt a save against either
            // Mumbletongue or Stumblefoot (the bodach's choice)." — the damage; the curse's save a note. Igniting Assault: "If it hits, it can
            // immediately cast one of its available fire shield innate spells as a free action." — a note.)
            .replace(/^If it hits, it deals an additional (\d+d\d+ \w+) damage, and the target must attempt a save against either ([A-Z][\w' -]+?) or ([A-Z][\w' -]+?) \((?:the [\w' -]+?['’]s|its) choice\)(?=\.$)/i, (_all, damage, first, second) => {
                (activity.notes ??= []).push(`On a hit the target also saves against ${first} or ${second}, its pick (the GM's).`);
                return `If it hits, it deals an additional ${damage} damage`;
            })
            .replace(/^If it hits, (?:it|they) can immediately cast one of (?:its|their) available ([\w' -]+?) innate spells as a free action\.$/i, (_all, spell) => {
                (activity.notes ??= []).push(`If it hits, it can cast its ${spell} innate spell as a free action.`);
                return "[told]";
            })
            // (Batch 245, Swinging Spear: "On a hit, the murajau twists their spear to move the target to any space adjacent to the murajau and deals an
            // additional 2d6 bludgeoning damage as the target smashes into …" — the damage; the move a note.)
            .replace(/^On a hit, (?:the [\w' -]+?|it|they) twists? (?:their|its) [\w' -]+? to move the target to any space adjacent to (?:the [\w' -]+?|it|them) and deals? an additional (@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?) damage as the target smashes into [^.]+(?=\.$)/i, (_all, damage) => {
                (activity.notes ??= []).push("On a hit it moves the target to any space beside it.");
                return `If it hits, it deals an additional ${damage} damage`;
            })
            .replace(/^If the Strike hits, that creature becomes Drained (\d)(?: \(or increases its drained value by \1, to a maximum of 4\))?(?=\.$)/i, "If it hits, the target is Drained $1")
            .replace(/\b(makes a Strike with (?:its|his|her|their) [\w' -]+?), increasing (?:its|his|her|their) reach by (\d+) feet for that Strike(?=\.$)/i, (_all, made, feet) => {
                (activity.notes ??= []).push(`Its reach is ${feet} feet longer for this Strike.`);
                return made;
            })
            .replace(/\b(makes an? [\w' -]+? Strike) with its reach increased to (\d+) feet(?=\.$)/i, (_all, made, feet) => {
                (activity.notes ??= []).push(`Its reach is ${feet} feet for this Strike.`);
                return made;
            })
            .replace(/\b(makes an? [\w' -]+? Strike) to (?:rip|tear|bite|slash|strike) (?:at |into )?[a-z][^.@\d]*(?=\.$)/i, "$1")
            // (Not Handspring Kick's "Steps, then makes … at a –1 penalty": the opening reads that.)
            .replace(/\b(makes an? (?:ranged |melee )?(?:[\w' -]+? )?Strike)(?: against (?:its|their|his|her) target)? at an? [-\u2013\u2212](\d+) penalty(?=\.$)/i, (whole, made, value, _at, sentence) => {
                if (/\bSteps, then makes\b/i.test(sentence)) return whole;
                activity.attackBonus -= Number(value);
                return made;
            })
            // (Batch 136, Burrowing Pounce: "The dragon Burrows, then Leaps out of the ground, landing at a point within 25 feet." — its move, then
            // "… makes a melee Strike against a creature within reach when they land" and "If the Strike is a critical hit, the target is knocked Prone".)
            .replace(/^(?:The )?[^.]+? Burrows, then Leaps out of the ground, landing at a point within (\d+) feet\.$/i, (_all, feet) => {
                activity.strides = Math.max(activity.strides, 1);
                (activity.notes ??= []).push(`It Burrows, then Leaps out of the ground up to ${feet} feet away first: move its token.`);
                return "[told]";
            })
            .replace(/\b(makes an? (?:melee )?(?:[\w' -]+? )?Strike) against a creature within reach when (?:they|it|he|she) lands?(?=\.$)/i, "$1")
            .replace(/^If the Strike is a critical hit, the target is knocked Prone(?=\.$)/i, "On a critical hit, the target is knocked Prone")
            // (Batch 131, Insightful Swing: "On this Strike, he gains a +2 circumstance bonus to the attack roll and ignores any concealment the target
            // has" — the bonus, the concealment the GM's.)
            .replace(/^On this Strike, (?:it|he|she|they|[A-Z][\w'-]+) gains? a \+(\d+) circumstance bonus to the attack roll(?: and ignores? (?:any concealment the target has|(?:the|its|their|his|her) prey's Concealed condition))?\.$/i, (whole, value) => {
                activity.attackBonus += Number(value);
                if (/concealment|Concealed/i.test(whole)) (activity.notes ??= []).push("This Strike ignores the target's concealment.");
                return "[told]";
            })
            .replace(/^(?:The )?[\w' -]+? deals (\d+) additional damage with this Strike\.$/i, (_all, value) => {
                activity.damageBonus += Number(value);
                return "[told]";
            })
            .replace(/^On a hit, (?:it|he|she|they) inflicts? an additional (@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?) damage(?=\.$)/i, "If it hits, it deals an additional $1 damage")
            // (Batch 82, Berserk Slam: "Strikes with its fist at a -1 circumstance penalty" as a fist Strike with that penalty.)
            .replace(/\bStrikes with (?:its|their|his|her) ([\w' -]+?) at an? ([-\u2013\u2212]\d+) circumstance penalty(?=\.$)/i, "makes a $1 Strike with a $2 circumstance penalty to its attack roll")
            // (Stunning Strike's "makes a weapon Strike against the foe": the foe its requirement hit.)
            .replace(/\b(makes an? (?:weapon |melee )?Strike) against the foe(?=\.$)/i, "$1")
            // (Batch 80, Pierce Armor: the armor it breaks is the GM's.)
            .replace(/; if the (?:creature|target) is wearing armor with hardness \d+ or lower, the armor is [Bb]roken(?=\.$)/, "")
            // (Batch 80, Terrifying Smite: "against an enemy that has one of the rekhep's allies within its reach": an ally beside it.)
            .replace(/ against an? (?:enemy|foe|creature) that has one of (?:its|their|his|her|the [\w' -]+?['’]s) allies within its reach(?=\.$)/i, () => {
                activity.requires = "ally-adjacent";
                return "";
            })
            // (Batch 47, Power Attack: "makes a melee Strike that counts as two attacks when calculating their multiple attack penalty".)
            .replace(/ that counts as (two|three) attacks when calculating (?:its|their|his|her|the) multiple attack penalty(?=\.$)/i, (_all, number) => {
                activity.countsAs = { two: 2, three: 3 }[number.toLowerCase()];
                return "";
            });
        let match;
        const lead = opened ? null : openingParts(text);
        const head = lead?.plain ?? text;
        // (What the opening sentence adds: its bonus or penalty, its extra damage on a hit.)
        const opening = () => {
            opened = true;
            activity.attackBonus += lead?.attack ?? 0;
            activity.damageBonus += lead?.damageBonus ?? 0;
            if (lead?.damage) activity.onHit.damage.push(lead.damage);
        };
        if (/^\[grab time\]\.?$/.test(text) || text === "[told]") continue;
        // (Batch 185, Boarding Action's boat: only then, the GM's.)
        if (text === "[boat boarding]") {
            activity.requires = "requirement";
            (activity.notes ??= []).push("The Strike only if it boarded or left a boat during this movement (it can swing on a rope instead of Striding).");
            continue;
        }
        if ((match = /^\[teleport (\d+)\]$/.exec(text))) {
            (activity.notes ??= []).push(`It teleports next to a creature it can see within ${match[1]} feet first.`);
            continue;
        }
        if (text === "[after either stride]") {
            (activity.notes ??= []).push("The Strike after either Stride.");
            continue;
        }
        if (text === "[smooth water]") {
            activity.requires = "requirement";
            (activity.notes ??= []).push("Only across smooth water, in a straight line; the Strike at the end.");
            continue;
        }
        if ((match = /^\[then strides (\d+)\]$/.exec(text))) {
            (activity.notes ??= []).push(`Then it Strides up to ${match[1]} feet; on a hit, that Stride triggers no reactions from the creature it struck.`);
            continue;
        }
        if (text === "[or disarm, one attack]") {
            (activity.notes ??= []).push("It can Disarm instead of Grappling; the Strike and the maneuver count as one attack for its multiple attack penalty.");
            continue;
        }
        if (text === "[then steps]") {
            (activity.notes ??= []).push("Then it Steps.");
            continue;
        }
        // (Batch 200: Swinging Strike's rope or trapeze, which the GM checks; Flying Attack's jump.)
        if (text === "[rope or trapeze]") {
            activity.requires = "requirement";
            (activity.notes ??= []).push("Only with a rope or trapeze to swing on; the Strike at any point along the swing.");
            continue;
        }
        // (Batch 221: Leaping Grab's jump; Strafing Chomp's move after.)
        if ((match = /^\[leap (\d+) (\d+)\]$/.exec(text))) {
            (activity.notes ??= []).push(`It Leaps up to ${match[1]} feet up and ${match[2]} feet across, Striking at any point in the jump; a creature it Grabs comes along to the end of the jump.`);
            continue;
        }
        if ((match = /^\[barb escape (\d+)\]$/.exec(text))) {
            (activity.notes ??= []).push(`After the Strike it Strides up to half its Speed, triggering no reactions. Escape DC ${match[1]}.`);
            continue;
        }
        if (text === "[while adjacent]") {
            (activity.notes ??= []).push("It ends early once the target is no longer beside it.");
            continue;
        }
        if (text === "[half before and after]") {
            (activity.notes ??= []).push("It moves up to half its Speed before the Strike and half after.");
            continue;
        }
        if (text === "[leap strike]") {
            (activity.notes ??= []).push("It Leaps, High Jumps or Long Jumps, Striking an adjacent enemy at any point in the air; it lands upright if it falls no further than it jumped.");
            continue;
        }
        // (Batch 184, Halyard Swing's rope.)
        if (text === "[rope swing]") {
            (activity.notes ??= []).push("It swings on a rope, ignoring any terrain beneath it; the Strike at any point along the way.");
            continue;
        }
        if ((match = /^\[after-strike (shove|trip|grapple|disarm|demoralize)\]$/.exec(text))) {
            activity.afterStrike = match[1];
            (activity.notes ??= []).push(`After the Strike, hit or miss, it attempts to ${match[1].replace(/^\w/, (letter) => letter.toUpperCase())} the same creature.`);
            continue;
        }
        // (Batch 112: what the GM handles, kept as a note.)
        if (text === "[gm]") {
            (activity.notes ??= []).push(htmlToPlainText(sentence.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim());
            continue;
        }
        // (Batch 110: Combat Grab's Grab on a hit.)
        if (/^If it hits, the target is Grabbed\.$/i.test(text)) {
            activity.onHit.conditions.push({ slug: "grabbed", value: null, duration: null });
            continue;
        }
        if (text === "[once]") activity.oncePerFight = true;
        else if (text === "[once a turn]") activity.oncePerTurn = true;
        else if ((match = /^\[requires (.+)\]$/.exec(text))) {
            // A free hand: not while it holds a creature (the grab uses the hand). Held weapons aren't tracked.
            if (/(?:has|must have) (?:a creature|an enemy|a foe) Grabbed|is grabbing a creature/i.test(match[1])) activity.requires = "grabbed";
            // (Batch 44, Snagging Strike: "has one hand free, and its target is within reach of that hand".)
            else if (/has (?:a|one) (?:free )?hand(?: free)?|has both hands free/i.test(match[1])) activity.requires = "free-hand";
            // (Batch 45, Impaling Charge: "doesn't have a creature impaled on their horn": not while it holds one.)
            else if (/(?:doesn't|does not) have a creature impaled on (?:its|their|his|her) horn/i.test(match[1])) activity.requires = "free-hand";
            // (Batch 81, Stunning Strike: "hit a foe earlier this turn with a weapon Strike": at a foe it hit this turn.)
            else if (/^(?:The )?[^,]*? hit an? (?:foe|creature|enemy|target) earlier this turn(?: with an? (?:weapon |melee )?Strike)?$/i.test(match[1])) activity.requires = "hit-earlier";
            // (Batch 151, Shatter Defenses: "A Frightened creature is within melee reach of the Black Whale guard" — at a frightened creature.)
            else if (/^An? Frightened creature is within (?:melee )?reach of [^.]+?\.?$/i.test(match[1])) activity.requires = "frightened";
            // (Batch 147: Residual Force's "The venedaemon's most recent action was to cast a spell", Addling Strike's "… to Cast a Spell" — straight
            // after a spell.)
            else if (/most recent action (?:this turn )?was to (?:cast|Cast) an? (?:non-cantrip )?spell\.?$/i.test(match[1])) {
                activity.requires = "after-cast";
                if (/non-cantrip/i.test(match[1])) activity.nonCantrip = true;
            }
            // (Batch 82, Berserk Slam: "The flesh golem is berserk": only then; the simulator doesn't play a golem's berserk state.)
            else if (/^(?:The )?[^,]*? is berserk\.?$/i.test(match[1])) activity.requires = "berserk";
            // (Batch 109, Startled Charge: "It's the first round of combat".)
            else if (/^It['’]s the first round of (?:combat|an encounter)\.?$/i.test(match[1])) activity.requires = "first-round";
            // (Batch 173, Deadly Aim: "Gaetane hasn't attempted a Strike during his turn yet" — its first attack this turn.)
            else if (/^(?:The )?[^,]*? has(?:n't| not) (?:attempted a Strike during (?:its|his|her|their) turn yet|attacked yet this turn)\.?$/i.test(match[1])) activity.requires = "first-attack";
            // (Batch 109: another requirement — "The dragon is burrowed", "is enraged", "is on the deck of a ship", "has expensive bolts": a state
            // the module doesn't play. Live, the GM uses it when it's met; the simulator doesn't plan it.)
            else if (!/is wielding|is holding/i.test(match[1])) {
                if (/@|\d+d\d+|\bdamage\b/i.test(match[1])) return reject(text);
                activity.requires = "requirement";
            }
        } else if (!opened && (match = /^(?:The )?[^.]+? (?:(Strides?(?: twice| or Steps?)?),? (?:and |then |and then )*)?(?:makes?|attempts?) an? (?:([\w' -]+?) )?Strike(?: (?:against|at) an? (?:creature|foe|enemy) (?:it has |it's |it is |that is |that's )?(?:Grabbed|grabbing|Restrained)[^.,]*?| (?:against|at) an? Prone (?:creature|foe|enemy))?(?: with an? \+(\d+) circumstance bonus to (damage|(?:its |the )?attack roll)(?: against the (?:grabbed|restrained) (?:creature|target))?)?(?: with an? [\w' -]+? weapon(?: or unarmed attack)?|, [a-z][^.\d]*| while keeping one hand free)?\.$/i.exec(head)) && !/\b(?:damage|feet|bonus|penalty|reach|each|two|three|Strikes)\b/i.test(head.slice(head.search(/Strike\b/) + 6).replace(/with an? \+\d+ circumstance bonus to (?:damage|(?:its |the )?attack roll)/i, ""))) {
            // A move written into the subject ("The worm Burrows at least 10 feet and then attempts a jaws Strike"): read as a move.
            const moving = !match[1] && /\b(?:Flies|Swims|Climbs|Burrows|Leaps|Steps|Strides)\b/.test(head.slice(0, head.search(/\b(?:makes|attempts)\b/i)));
            const moved = moving ? moveThenStrike(head.replace(/(?:,| and)? (?:with|against) [^,.]*$/i, ".")) : null;
            if (moving && !moved) return reject(text);
            opening();
            activity.strides = moved ? moved.strides : match[1] ? (/twice/i.test(match[1]) ? 2 : 1) : 0;
            activity.strike = match[2] && !/^(?:melee|weapon|unarmed)$/i.test(match[2]) ? match[2].toLowerCase() : null;
            if (match[3]) activity[/damage/i.test(match[4]) ? "damageBonus" : "attackBonus"] = Number(match[3]);
            if (/Grabbed|grabbing|Restrained/i.test(head)) activity.requires = "grabbed";
            else if (/\bProne (?:creature|foe|enemy)\b/i.test(head)) activity.requires = "prone";
        } else if (!opened && (match = /^(?:The )?[^.]+? (?:draws a weapon|Interacts to (?:draw|reload) (?:its|his|her|their|the) ([\w' -]+?)|uses an Interact action to pick up an improvised weapon within reach),? (?:and )?(?:then )?Strikes with it\.?$/i.exec(head))) {
            // A weapon drawn (or reloaded, or picked up) as part of it, then a Strike with it (batch 59): Hidden Blade's "The spy draws a
            // weapon and then Strikes with it", Reloading Trick's "Interacts to reload the repeating hand crossbow and Strikes with it",
            // Improvised Surprise's "uses an Interact action to pick up an improvised weapon within reach and then Strikes with it".
            opening();
            activity.strike = match[1] && !/^(?:weapon|improvised weapon)$/i.test(match[1]) ? match[1].toLowerCase() : null;
        } else if (!opened && (match = /^(?:The )?[^.]+? (?:(Strides(?: twice| or Steps)?),? (?:and |then )+)?Strikes(?: with (?:its|his|her|their|that) ([\w' -]+?))?\.$/i.exec(head)) && !/\b(?:damage|feet|bonus|penalty|reach|each|two|three)\b/i.test(head)) {
            // "Viro Strikes with his longsword.", "The skirmisher Strides or Steps, then Strikes."
            opening();
            activity.strides = match[1] ? (/twice/i.test(match[1]) ? 2 : 1) : 0;
            activity.strike = match[2] && !/^(?:melee|weapon|that weapon)$/i.test(match[2]) ? match[2].toLowerCase() : null;
        } else if (!opened && (match = moveThenStrike(head))) {
            // Other ways to move first (2026-10-10): "Flies up to double its fly Speed and then makes a talon Strike",
            // "Uri Strides and makes a scimitar Strike at any point during the Stride", "Strides twice and makes a horn
            // Strike against a foe within its reach at the end of the movement".
            opening();
            activity.strides = match.strides;
            activity.strike = match.strike;
        } else if (!opened && !flavorSkipped && !/\b(?:Strikes?|save|damage|check|DC|bonus|penalty|feet|Hit Points|@\w+\[)\b/i.test(sentence) && /^(?:The )?[A-Z][\w' -]*? [a-z]+s\b/.test(text.replace(/^With an? [a-z]+, the /, "The "))) {
            // A first sentence that only describes it ("The goblin shark dashes forward and extends its jaws"; batch 153, "With a touch, the ghost
            // attempts to drain a living creature's life force").
            flavorSkipped = true;
            continue;
        } else if (!opened) return reject(text);
        // (Batch 26: "The target is Off-Guard against this Strike", "… to this attack".)
        // (Batch 59: "The target of the Strike is Off-Guard against the attack".)
        else if (/^The (?:target(?: of the Strike)?|creature) is Off-Guard (?:to|against) (?:the|this) (?:Strike|attack)\.$/i.test(text)) activity.offGuard = true;
        // (Batch 59, Improvised Surprise: "The drunken brawler has a +2 circumstance bonus to this attack.")
        else if ((match = /^(?:The )?[^.,]+? (?:has|gains) a \+(\d+) circumstance bonus to (?:this|the) (?:attack|Strike)(?: roll)?\.$/i.exec(text)) && !/^(?:If|When|While|Unless)\b/i.test(text)) activity.attackBonus += Number(match[1]);
        // (Impaling Charge, batch 45: "On a hit, the target becomes impaled on the dragon's horn. The creature is Grabbed while on the horn
        // (and can attempt to Escape as normal). The dragon doesn't need to use additional actions to keep the impaled creature grabbed.
        // If the dragon moves, they bring the grabbed creature along with them.": Grabbed, until it Escapes.)
        // (Batch 219, Cuetzmonquali's Impaling Charge: "impaled on one of Cuetzmonquali's horns. The creature becomes Grabbed. … the creature remains grabbed as
        // long as it's impaled. The grabbed creature can attempt to Escape as normal, but the DC to do so is 40 … If Cuetzmonquali critically hit the creature
        // to impale it, that creature is Restrained for 1 round, in addition to being grabbed and impaled as per a success." — its Escape DC a note.)
        else if (/^On a hit, the target becomes impaled on (?:one of )?(?:the [\w' -]+?'s|[A-Z][\w'-]+'s|its|their|his|her) horns?\.$/i.test(text)) continue;
        else if (/^The creature is Grabbed while on the horn(?: \(and can (?:attempt to )?Escape as normal\))?\.$|^The creature becomes Grabbed\.$/i.test(text)) activity.onHit.conditions.push({ slug: "grabbed", value: null, duration: null });
        else if (/^(?:The [\w' -]+?|[A-Z][\w'-]+|It|They|He|She) (?:doesn't|does not) need to use additional actions to keep the (?:(?:impaled|grabbed) )?creature grabbed(?:; the creature remains grabbed as long as it['’]s impaled)?\.$|^If (?:the [\w' -]+?|[A-Z][\w'-]+|it|they|he|she) moves?, (?:it|they|he|she) brings? the grabbed creature along with (?:it|them|him|her)\.$/i.test(text) && activity.onHit.conditions.some((entry) => entry.slug === "grabbed")) continue;
        else if ((match = /^The grabbed creature can attempt to Escape as normal, but the DC to do so is (\d+), rather than [^.]+\.$/i.exec(text)) && activity.onHit.conditions.some((entry) => entry.slug === "grabbed")) (activity.notes ??= []).push(`Escape DC ${match[1]}.`);
        else if (/^If (?:the [\w' -]+?|[A-Z][\w'-]+|it) critically hit the creature to impale it, that creature is Restrained for 1 round, in addition to being grabbed and impaled as per a success\.$/i.test(text) && activity.onHit.conditions.some((entry) => entry.slug === "grabbed")) activity.onHit.critical = [...activity.onHit.conditions.filter((entry) => entry.slug !== "grabbed"), { slug: "grabbed", value: null, duration: null }, { slug: "restrained", value: null, duration: { value: 1, unit: "rounds" } }];
        else if (hitResults(text, activity, item, conditions)) continue;
        // "The extra damage and frightened value are doubled on a critical hit." (the damage is, as any.)
        else if ((match = /^The (?:extra|additional) damage and (\w+) value are doubled on a critical hit\.$/i.exec(text)) && activity.onHit.conditions.some((entry) => entry.slug === match[1].toLowerCase() && Number.isFinite(entry.value))) activity.onHit.critical = activity.onHit.conditions.map((entry) => (entry.slug === match[1].toLowerCase() && Number.isFinite(entry.value) ? { ...entry, value: entry.value * 2 } : entry));
        // "This Strike deals an additional 3d6 precision damage." (only a hit deals it). (Batch 37: "1d6 persistent bleed".)
        else if ((match = /^(?:This|The) Strike deals an? (?:additional|extra) (.+?) damage\.$/i.exec(text)) && (inlineTags(sentence, "Damage").length === 1 || plainDice(match[1]) || hitDamage(match[1]))) activity.onHit.damage.push(inlineTags(sentence, "Damage").length ? readDamage(inlineTags(sentence, "Damage")[0]) : plainDice(match[1]) ?? hitDamage(match[1]));
        // (Batch 37: "This Strike gains the fatal d12 trait", "… the deadly d4 trait for this attack"; "The Strike deals half damage".)
        else if ((match = /^(?:This|The) (?:[\w' -]+? )?(?:Strike|strike) gains the (fatal|deadly) d(\d+) trait(?: for this attack)?\.$/i.exec(text))) activity[match[1].toLowerCase()] = Number(match[2]);
        else if (/^The Strike deals half damage\.$/i.test(text)) activity.halfDamage = true;
        // (Batch 80, Pierce Armor: "If this Strike breaks a creature's armor or damages a creature who is unarmored or wearing broken armor, the
        // creature also takes 2d6 bleed." — with the armor broken on a hit, any hit; "This Strike doesn't further damage armor that's already
        // broken.")
        else if (/^If this Strike breaks a creature's armor or damages a creature who is unarmored or wearing broken armor, the creature also takes @D(?: damage)?\.$/i.test(text.replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?|\b\d+d\d+ bleed\b/g, "@D")) && inlineTags(sentence, "Damage").length === 1) activity.onHit.damage.push(readDamage(inlineTags(sentence, "Damage")[0]));
        else if (/^This Strike (?:doesn't|does not) further damage armor that's already broken\.$/i.test(text)) continue;
        // "This Strike ignores their multiple attack penalty and doesn't count toward that penalty."
        else if (/^This Strike (?:ignores|doesn't use) (?:its|their|his|her|the) multiple attack penalty(?:,)? and (?:doesn't|does not) count toward (?:that|the|its|their) penalty\.$/i.test(text)) activity.noMap = true;
        // "This counts as two attacks for his multiple attack penalty."
        // (Batch 192, Dimensional Ambush: "This Strike counts as two attacks when calculating the katpaskir's multiple attack penalty.")
        // (Batch 203, Gouging Lunge: "This thumb spike Strike counts as two attacks …".)
        else if ((match = /^This (?:(?:[\w' -]+? )?Strike )?counts as (two|three) attacks (?:when calculating|for) (?:its|his|her|their|the(?: [\w' -]+?'s)?) multiple attack penalty\.$/i.exec(text))) activity.countsAs = { two: 2, three: 3 }[match[1].toLowerCase()];
        // (Batch 60, Savage Jaws: "If the attack hits, it deals @Damage[(4d12+16)[piercing]] damage (versatile S)." — its damage in place
        // of the Strike's; Bully's Bludgeon: "This attack is nonlethal.")
        else if (new RegExp(`${hit}(?:it|he|she|they) deals? @Damage\\[[^\\]]*(?:\\[[^\\]]*\\])?[^\\]]*\\] damage(?: \\(versatile [BPS]\\))?\\.$`, "i").test(htmlToPlainText(sentence).replace(/\s+/g, " ").trim()) && inlineTags(sentence, "Damage").length === 1) activity.damage = readDamage(inlineTags(sentence, "Damage")[0]);
        else if (/^(?:This|The) (?:attack|Strike) is nonlethal\.$/i.test(text)) activity.nonlethal = true;
        // "If this Strike hits, he deals an extra die of weapon damage."
        // (Batch 47: "deals an extra a die of weapon damage", as printed.)
        else if (new RegExp(`${hit}(?:it|he|she|they|[A-Z][\\w'-]+) deals? an? (?:additional|extra) (?:an? )?(?:weapon )?die of (?:weapon )?(?:\\w+ )?damage\\.$`, "i").test(text)) activity.extraWeaponDice = (activity.extraWeaponDice ?? 0) + 1;
        else if (/remains? hidden until after|^During the Stride/i.test(text)) continue;
        // (A follow-up's penalty, batch 35: "This check counts toward the grave spinosaurus's multiple attack penalty, but …", "Both
        // attacks count toward their multiple attack penalty …", "This Shove uses the same multiple attack penalty as the Strike …".)
        else if (activity.onHit.follow && /^(?:This (?:check|Shove|Trip|Grapple|Disarm|Demoralize) (?:counts toward|uses the same|doesn't count toward)|Both attacks count toward) [^.]*multiple attack penalty\b/i.test(text)) continue;
        // (A shove's following move, an object it's pushed into, a miss's retreat and Hide: the GM's, batch 35.)
        else if ((activity.onHit.follow === "shove" || activity.onHit.criticalPush) && /^(?:If (?:the [\w' -]+?|it|he|she|they) moves? to follow the target\b|In addition, if the target has to stop moving because it would hit an object\b)/i.test(text)) continue;
        else if (/^If the Strike misses, (?:the [\w' -]+?|it|he|she|they) can Step\b[^.]*\.$|^(?:The [\w' -]+?|It|He|She|They) can (?:\[\[\/act hide\]\]|Hide) if\b[^.]*\.$/i.test(text)) continue;
        // "After this Strike, the harmona can Fly up to half their fly Speed." (a move after: the GM's, nothing for the simulation.)
        else if (/^After (?:this|the) Strike, (?:it|he|she|they|the [\w' -]+?) can (?:Fly|Stride|Step|Swim|Burrow|Climb)\b[^.@]*\.$/i.test(text)) continue;
        // (Batch 90, Feathered Charge: "If the feathered bear doesn't end their movement on solid ground, they fall as soon as the Strike is
        // completed." — the fall the GM's.)
        else if (/^If (?:the [\w' -]+?|it|they|he|she) (?:doesn't|does not) end (?:its|their|his|her) movement on solid ground, (?:it|they|he|she) falls? as soon as the Strike is completed\.$/i.test(text)) continue;
        // "On a critical hit, the target is pushed back 10 feet."
        else if ((match = /^On a critical hit, the (?:target|creature) is pushed (?:back )?(\d+) feet\.?$/i.exec(text))) activity.onHit.criticalPush = Number(match[1]);
        // (Batch 83, Stomp: "If the boot Strike hits a Prone creature, it deals an extra 2d6 bleed damage": only on a creature already Prone.)
        else if (/^If the [\w' -]+? Strike hits a Prone (?:creature|target|foe|enemy), it deals an (?:extra|additional) @Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?(?: damage)?\.?$/i.test(text.trim()) && inlineTags(text, "Damage").length === 1) activity.onHit.proneDamage = [readDamage(inlineTags(text, "Damage")[0])];
        // Death Roll: "If it hits, it also knocks the creature Prone. If it fails, it releases the creature."
        else if (new RegExp(`${hit}(?:it|he|she|they|[A-Z][\\w'-]+) (?:also )?knocks? the (?:creature|target) Prone\\.$`, "i").test(text)) activity.onHit.conditions.push({ slug: "prone", value: null, duration: null });
        else if (/^If (?:it|the Strike|this Strike) (?:fails|misses), (?:it|the [\w' -]+?) releases the (?:creature|target)\.$/i.test(text)) continue;
        // (Batch 108: Carve Projectile's "the target also falls Prone"; Wedge's "the target takes an additional 3d10 damage of the same type as the
        // Strike and is Enfeebled 2 for 1 hour", "This counts as two attacks for the terra carver's multiple attack penalty.")
        else if (new RegExp(`${hit}the (?:target|creature) (?:also )?falls Prone\\.$`, "i").test(text)) activity.onHit.conditions.push({ slug: "prone", value: null, duration: null });
        else if ((match = new RegExp(`${hit}the target takes an (?:additional|extra) (\\d+d\\d+) damage of the same type as the Strike and is (.+?)\\.$`, "i").exec(text)) && conditions(match[2]).length) {
            activity.onHit.damage.push(`${match[1]}[strike]`);
            activity.onHit.conditions.push(...conditions(match[2]));
        } else if ((match = /^This counts as (two|three) attacks for (?:the [\w' -]+?['’]s|its|their|his|her) multiple attack penalty\.$/i.exec(text))) activity.countsAs = { two: 2, three: 3 }[match[1].toLowerCase()];
        // (Batch 25: "he gains … to his attack roll", "to the attack roll", "from its starting position".)
        // (Batch 85: any distance, Rampaging Charge's "If it moved at least 10 feet, …"; extra damage on a hit, Powerful Charge's "If the
        // unicorn moved at least 20 feet, it deals an additional 2d6 damage on a hit" — as the charge's own.)
        else if ((match = /^(?:If|As long as) (?:it|they|he|she|the [\w' -]+?|[A-Z][\w'-]+) moved at least \d+ feet(?: (?:away )?from (?:its|their|his|her) starting position)?, (?:it gains|they gain|he gains|she gains) a \+(\d+) circumstance bonus to (?:its|their|his|her|this|the) attack roll\.$/i.exec(text))) activity.attackBonus += Number(match[1]);
        else if ((match = /^(?:If|As long as) (?:it|they|he|she|the [\w' -]+?|[A-Z][\w'-]+) moved at least \d+ feet(?: (?:away )?from (?:its|their|his|her) starting position)?, (?:it|they|he|she) deals? an (?:additional|extra) (.+?) damage on a hit\.$/i.exec(text)) && hitDamage(match[1])) activity.onHit.damage.push(hitDamage(match[1]));
        else if (/^(?:If|As long as) (?:it|they|he|she|the [\w' -]+?|[A-Z][\w'-]+) moved at least 20 feet(?: (?:away )?from (?:its|their|his|her) starting position)?, the Strike's damage (?:is increased to|increases to) /i.test(text)) activity.damage = inlineTags(sentence, "Damage").map(readDamage)[0] ?? /(?:to) (\d+d\d+(?:\s*[+-]\s*\d+)?)/i.exec(text)?.[1] ?? null;
        else if ((match = new RegExp(`${hit}(?:the [\\w ]+? )?(?:automatically )?push(?:es)? the target (\\d+) feet\\.$`, "i").exec(text)) || (match = new RegExp(`${hit}the target is pushed (\\d+) feet\\.$`, "i").exec(text))) activity.onHit.push = Number(match[1]);
        else if ((match = new RegExp(`${hit}(?:it|he|she|they|[A-Z][\\w'-]+) deals? an? (?:additional|extra) (.+?) damage\\.$`, "i").exec(text)) && (inlineTags(sentence, "Damage").length === 1 || plainDice(match[1]))) activity.onHit.damage.push(inlineTags(sentence, "Damage").length ? readDamage(inlineTags(sentence, "Damage")[0]) : plainDice(match[1]));
        else if ((match = new RegExp(`${hit}(?:the target|that creature|the creature|the foe) is (.+?)\\.$`, "i").exec(text)) || (match = /^On a hit, (?:the target|the creature) is (.+?)\.$/i.exec(text))) {
            // "Frightened 1, or Frightened 2 on a critical hit", "Frightened 1 (Frightened 2 on a critical hit)". Not with a save of
            // its own ("Paralyzed … (DC 19 Fortitude negates)").
            // (Nor one on a condition: "… Slowed 1 for 1 round if the Strike dealt bludgeoning damage", batch 27.)
            if (/@Check\[|\b(?:if|unless)\b/i.test(match[1])) return reject(text);
            const bracketed = /^(.+?) \(([^()]+) on a critical hit\)$/i.exec(match[1]);
            const [plain, critical] = bracketed ? [bracketed[1], `${bracketed[2]} on a critical hit`] : match[1].split(/, or (?=[^,]+ on a critical hit$)/i);
            if (/push|Grab/i.test(plain) && !conditions(sentence).length) return reject(text);
            activity.onHit.conditions.push(...conditions(plain));
            if (critical) activity.onHit.critical = conditions(critical.replace(/ on a critical hit$/i, ""));
            if (!activity.onHit.conditions.length) return reject(text);
        } else if ((match = /^On a critical hit, the (?:target|creature) is (.+?)(?: instead)?\.?$/i.exec(text) ?? /^If (?:the [\w' -]+?|it|they|he|she) critically hits with (?:this|the) Strike, the (?:creature hit|target|creature) is (.+?)\.$/i.exec(text)) && conditions(match[1]).length) activity.onHit.critical = conditions(match[1]);
        else if (new RegExp(`${hit}the target must (?:also )?succeed at`, "i").test(text) || /^On a (?:hit|success), the (?:target|foe) must also succeed at/i.test(text) || /^On a success, the creature must (?:also )?succeed at/i.test(text) || (/^The creature must succeed at/i.test(text) && activity.notes?.some((note) => /\bdrains the creature['’]s life\b/i.test(note))) || (match = /^A (Tiny|Small|Medium|Large|Huge) or smaller creature (?:struck|hit|damaged) by this attack must succeed at/i.exec(text))) {
            const raw = inlineTags(sentence, "Check")[0];
            const check = raw ? readCheck(raw) : null;
            const outcomes = check?.save && check.dc ? saveOrOutcomes(sentence, [], { afterHit: true }) : null;
            if (!outcomes) return reject(text);
            if (match?.[1]) activity.onHit.size = match[1].toLowerCase();
            activity.onHit.save = {
                ...base(item, { time: "free" }),
                targeting: { target: "the creature the Strike hits", range: "touch", area: null },
                trigger: { event: "strike-activity" },
                resolution: { kind: "save", check: { roll: "save", statistic: check.statistic, basic: false, against: { dc: "fixed", value: check.dc } }, sharedDamage: null, outcomes }
            };
            // (Batch 219, Drain Nutrients: "… save or become Drained 2 (Drained 1 on a success, no effect on a critical success)" — the success's own.)
            const onSuccess = /\(([A-Z][a-z]+ \d) on a success, no effect on a critical success\)/.exec(text);
            if (onSuccess && conditions(onSuccess[1]).length && !outcomes.success?.effects?.length) outcomes.success = { ...outcomes.success, effects: conditions(onSuccess[1]).map((entry) => ({ kind: "condition", ...entry })) };
        } else if (activity.onHit.save && (match = /^On a critical failure, the (?:foe|target|creature) is (.+?)(?: instead)?\.$/i.exec(text)) && conditions(match[1]).length) {
            // (Batch 81, Stunning Strike: "On a critical failure, the foe is Stunned 2 instead." after its save: that save's.)
            const outcomes = activity.onHit.save.resolution.outcomes;
            outcomes.criticalFailure = { ...outcomes.criticalFailure, effects: conditions(match[1]).map((entry) => ({ kind: "condition", ...entry })) };
        } else return reject(text);
    }
    const rider = activity.onHit;
    // (Batch 112: "a ranged weapon Strike" — any of its ranged Strikes, as "a ranged Strike"; "a melee weapon Strike" — any melee one.)
    if (/^ranged weapon$/i.test(activity.strike ?? "")) activity.strike = "ranged";
    if (/^melee weapon$/i.test(activity.strike ?? "")) activity.strike = null;
    activity.strike = sheetStrikeName(actor, activity.strike);
    // (A follow-up's Strike, batch 36: the Strike itself is what it adds, "makes another greatclub Strike against the same target".)
    if (after && opened) return { ...activity, after };
    const bare = !activity.selfAfter?.length && !rider.conditions.length && !rider.critical && !rider.push && !rider.criticalPush && !rider.follow && !rider.damage.length && !rider.proneDamage?.length && !rider.vsTraits?.length && !rider.save && !activity.offGuard && !activity.attackBonus && !activity.damageBonus && !activity.damage && !activity.extraWeaponDice && !activity.noMap && !activity.fatal && !activity.deadly && !activity.halfDamage && !rider.allyStrike && !activity.noDamage && !activity.afterStrike && !activity.damageTimes;
    // (Batch 90, Feathered Charge: every sentence read, and only a Stride and a Strike for as many actions — terrain it ignores, a fall the
    // GM's: nothing more than its Strike.)
    if (opened && bare && activity.strides && !activity.requires && activity.actions >= activity.strides + 1) return { builtin: "no-effect", strikeOnly: true };
    // (Batch 156: a Strike whose only extra is the GM's — Shattering Scrape's broken armor — still posts its note.)
    if (!opened || (bare && !activity.notes?.length)) return null;
    // (Batch 184: not one behind a requirement the GM checks, Halyard Swing's ship deck — its card and notes, never planned by the simulator.)
    // (Batch 221, Strafing Chomp: one action for a move and a half-damage Strike — its own trade, kept.)
    if (activity.strides && !activity.attackBonus && !activity.halfDamage && activity.actions < activity.strides + 1 && !rider.save && !rider.conditions.length && !rider.damage.length && !rider.proneDamage?.length && !rider.follow && !(activity.requires === "requirement" && activity.notes?.length)) return null;
    return activity;
}

// Breath weapons and other abilities with an inline save.
// Unlinked condition names a result section is read for: not "controlled" ("a body directly controlled by the whale").
const SECTION_CONDITIONS = STAGE_CONDITIONS.filter((slug) => slug !== "controlled");

// One row's damage and another's together: formulas joined, shared damage with formulas as "mixed".
function addDamage(first, second) {
    if (!first || first.mode === "none") return second;
    if (first.mode === "formulas" && second.mode === "formulas") return { ...first, formulas: [...first.formulas, ...second.formulas] };
    if (first.mode === "shared" && second.mode === "formulas") return { mode: "mixed", shared: first, formulas: second.formulas, rollScope: "outcome" };
    return second;
}

// The @Damage tags of a text, each masked as "\u0000n\u0000", so brackets around them can be read.
function maskDamage(text) {
    const tags = inlineTags(text, "Damage");
    let masked = String(text);
    tags.forEach((raw, index) => {
        masked = masked.replace(`@Damage[${raw}]`, `\u0000${index}\u0000`);
    });
    return { masked, tags };
}

// Damage in brackets beside damage outside them is an alternative ("12d10 slashing (14d10 in its other form)"): left out.
function withoutAlternatives(html) {
    const { masked, tags } = maskDamage(html);
    if (!/\u0000\d+\u0000/.test(masked.replace(/\([^()]*\)/g, ""))) return html;
    return masked.replace(/\([^()]*\)/g, (group) => (/\u0000\d+\u0000/.test(group) && !/@Check\[/.test(group) ? "" : group)).replace(/\u0000(\d+)\u0000/g, (_match, index) => `@Damage[${tags[Number(index)]}]`);
}

// A basic save's own damage (2026-10-10): the @Damage before the check in the save's sentence, or after it
// when there's none before, or else in the sentence before ("…deals 3d8 void damage. It must attempt a basic
// Fortitude save"). Not healing, not an alternative in brackets ("8d6 (10d6 while it's charged)
// damage"), not a rider after the save ("A creature that fails also takes 1d4 persistent acid", the riders'), not a
// trigger's or requirement's ("Trigger An effect deals at least 8 electricity or 4 fire damage; Effect …"). null when the
// damage is one of several ("12d12 acid, 12d12 cold or 12d12 electricity"); [] when there's none to find.
function basicSaveDamage(html) {
    const blocks = String(html).split(/<strong>\s*Effect\s*<\/strong>/i);
    const effect = blocks.findLast((block) => /@Check\[(?:type:)?(?:fortitude|reflex|will)\b/i.test(block)) ?? blocks[blocks.length - 1];
    const sentences = effect.replace(/<\/?p[^>]*>|<hr\s*\/?>/gi, " ").split(/(?<=\.)\s+(?=[A-Z@<])/);
    const index = sentences.findIndex((sentence) => /@Check\[(?:type:)?(?:fortitude|reflex|will)\b/i.test(sentence));
    if (index < 0) return [];
    const own = (text) => {
        const { masked, tags } = maskDamage(text);
        // Damage in brackets beside damage outside them: an alternative ("8d6 (10d6 with … active)").
        const outside = masked.replace(/\([^()]*\)/g, "");
        const kept = /\u0000\d+\u0000/.test(outside) ? masked.replace(/\([^()]*\)/g, (group) => (/\u0000\d+\u0000/.test(group) && !/@Check\[/.test(group) ? "" : group)) : masked;
        const found = [...kept.matchAll(/\u0000(\d+)\u0000/g)];
        // Only in brackets, more than one ("the damage increases by 1d8 (2d8 with 2 actions, 3d8 with 3)"): alternatives.
        if (found.length > 1 && !/\u0000\d+\u0000/.test(outside)) return null;
        // Alternatives: "or" between two of them.
        for (let at = 1; at < found.length; at++) if (/\bor\b/i.test(kept.slice(found[at - 1].index, found[at].index).replace(/\u0000\d+\u0000/g, ""))) return null;
        return found.map((match) => tags[Number(match[1])]).filter((raw) => !/\bhealing\b/i.test(raw));
    };
    const sentence = sentences[index];
    const at = sentence.search(/@Check\[/i);
    // Damage that scales with something ("1d6 slashing damage per creature it has swallowed"): not one amount.
    if (/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?(?: damage)? per\b/i.test(sentence)) return null;
    // A type left to a choice ("The damage type depends on the color of the aeon star").
    if (/\bdamage type depends on\b|\btype of damage (?:depends on|is chosen)\b/i.test(htmlToPlainText(html))) return null;
    let tags = own(sentence.slice(0, at));
    if (tags && !tags.length) tags = own(sentence.slice(at).split(/\b(?:on a (?:critical )?failure|if (?:it|they|the (?:creature|target)) (?:critically )?fails?|(?:a|each|any) creature (?:that|who)|creatures (?:that|who))\b/i)[0]);
    if (tags && !tags.length && index > 0) tags = own(sentences[index - 1]);
    return tags ? tags.map((raw, id) => ({ id: String(id), formula: readDamage(raw), type: null, category: null })) : null;
}

// A reaction or free action with a trigger and an effect (batch 69; batch 78: whether or not its trigger reads — one that doesn't is the GM's
// to use, as its card).
function readsTrigger(item) {
    if (!["reaction", "free"].includes(item.system?.actionType?.value)) return false;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1"));
    const text = /\bTrigger\s+(.+?)\s*(?:\bEffect\b|\bRequirements?\b|\bFrequency\b|$)/s.exec(plain)?.[1];
    return Boolean(text && /\bEffect\b/.test(plain));
}

// (Batch 142, Roar: "… must succeed at a … save or become Frightened 2 (Frightened 3 on a critical failure, Frightened 1 on a success, or
// unaffected on a critical success)." — each degree's own, written out as PF2e's sections at the end; null when it isn't said so.)
function degreeListHtml(html) {
    const part = String.raw`(?:@UUID\[[^\]]*\]\{[^}]*\}|[^,().<])+?`;
    const match = new RegExp(String.raw`(must) succeed at (?:a|an) (@Check\[[^\]]*\](?:\{[^}]*\})?) save or become (${part}) \((${part}) on a critical failure, (${part}) on a success, or unaffected on a critical success\)\.`, "i").exec(String(html));
    if (!match) return null;
    const [whole, must, check, failure, critical, success] = match;
    const sections = [["Critical Success", "unaffected"], ["Success", success], ["Failure", failure], ["Critical Failure", critical]].map(([label, result]) => `<p><strong>${label}</strong> The creature is ${result.trim()}.</p>`).join("");
    // ("Other creatures within 100 feet" with no template: that emanation.)
    return `${String(html).replace(whole, `${must} attempt a ${check} save.`).replace(/\b(Other creatures within) (\d+) feet(?= must\b)/i, "$1 @Template[emanation|distance:$2]{$2 feet}")}${sections}`;
}

const AROUND = /\b(?:each|all|every) (?:other )?(?:living )?(?:enemy )?(creatures?|foes?|enem(?:y|ies))(?: of (?:the [\w' -]+?['’]s|its|their) choice| (?:that|who) can (?:see|hear) (?:it|them|the [\w' -]+?))? within (\d+) feet\b(?! of (?:the (?:target|triggering|struck|chosen|creature|point|corner|ally|enemy|foe|space|square)|that|those|a|an|any|each|one|its target|their target)\b)/i;
function inlineSave(item, actor = null, { afterHit = false } = {}) {
    // (Batch 142: degrees listed in brackets, as sections.)
    const listed = degreeListHtml(item.system?.description?.value ?? "");
    if (listed) return inlineSave(withDescription(item, listed), actor, { afterHit });
    // (Batch 254, Hurtful Critique: "… for 1 minute or until it makes a successful Strike against the sharpshooter" — the minute; ending early on a hit
    // against the monster, and the immunity that follows (its own sentence), notes.)
    const until = / or until it makes a successful Strike against (?:the [\w' -]+?|it|them)(?=\.)/i.exec(item.system?.description?.value ?? "");
    if (until) {
        const html = String(item.system.description.value).replace(until[0], "").replace(/<p>\s*A creature that critically succeeds or who Strikes (?:the [\w' -]+?|it) after failing is immune to (?:that [\w' -]+?['’]s|its) [A-Z][\w' -]+? for 1 hour\.\s*<\/p>/i, "");
        const plan = inlineSave(withDescription(item, html), actor, { afterHit });
        return plan?.resolution ? { ...plan, notes: [...(plan.notes ?? []), "It ends early once the creature hits the monster with a Strike; a creature that critically succeeds, or hits it after failing, is immune for 1 hour."] } : null;
    }
    // (Batch 142, Eye Beams: "2d6 cold or 2d6 fire damage" — one roll, its type the monster's pick: PF2e's caster choice, a GM button live, the
    // simulator's best.)
    // (Batch 229: a formula in brackets, "(1d6+3)[piercing] or (1d6+3)[slashing]".)
    const typed = /(@Damage\[(\(?\d+d\d+(?:\s*[+-]\s*\d+)?\)?)\[(\w+)\](?:\|[^\]]*)?\](?:\{[^}]*\})?) or @Damage\[\2\[(\w+)\](?:\|[^\]]*)?\](?:\{[^}]*\})?/.exec(item.system?.description?.value ?? "");
    // (Only one such pair, for a basic save's damage; results by degree with their own pairs (Agonizing Overload, Boomstrike) read as before.)
    const pairs = String(item.system?.description?.value ?? "").match(/@Damage\[[^\]]*\[\w+\][^\]]*\](?:\{[^}]*\})? or @Damage\[/g) ?? [];
    if (typed && typed[3] !== typed[4] && pairs.length === 1) {
        const plan = inlineSave(withDescription(item, String(item.system.description.value).replace(typed[0], typed[1])), actor, { afterHit });
        if (plan?.resolution?.kind === "save" && plan.resolution.check?.basic && plan.resolution.sharedDamage?.components?.length) return { ...plan, resolution: { ...plan.resolution, casterChoice: { kind: "damage-type", label: "Damage type", values: [typed[3].toLowerCase(), typed[4].toLowerCase()] } } };
    }
    const html = item.system?.description?.value ?? "";
    const checks = inlineTags(html, "Check").map(readCheck).filter((check) => check.save && check.dc);
    if (!checks.length) return null;
    const check = checks[0];
    // Two ways to use it, each with its own save ("The wyrm breathes in one of two ways"): the GM's.
    if (new Set(checks.map((each) => each.statistic)).size > 1 && (MODES.test(htmlToPlainText(html)) || /\bin one of the following ways\b/i.test(htmlToPlainText(html)))) return null;
    // One of several modes picked by the monster's state ("its attack depends on its current form").
    if (/\bdepending on (?:its|their|the [\w' -]+?'s) (?:[\w-]+ )?(?:attunement|form|stance|mode|aspect)\b/i.test(htmlToPlainText(html))) return null;
    // Damage by the number of actions spent ("The damage depends on the number of actions"): not one plan.
    if (/\b(?:depends? on|depending on) the number of actions\b|\bfor each additional action\b/i.test(htmlToPlainText(html))) return null;
    // An effect picked from a roll on a list ("Roll on the alchemical chambers list to determine which one shatters"): the GM's.
    if (/\broll on (?:the|a|an|its) [^.]*?\b(?:list|table)\b|\broll [^.]*? to determine which\b/i.test(htmlToPlainText(html))) return null;
    // A save its terrain sets off later ("The first time each round a creature takes piercing damage from these splintered bones, it
    // must succeed at …"; batch 121): not on use.
    if (/\bThe first time each round an? (?:creature|enemy) takes [^.]*? damage from (?:these|this|the)\b[^.]*?, (?:it|they) must (?:succeed at|attempt)\b/i.test(htmlToPlainText(html))) return null;
    let components = damageComponents(withoutAlternatives(html.split(/<strong>\s*(?:Critical Success|Success|Failure|Critical Failure)\s*<\/strong>/i)[0]));
    const sections = degreeSections(html);
    const basicDamage = check.basic && components.length ? basicSaveDamage(html) : [];
    let outcomes;
    if (basicDamage?.length) {
        components = basicDamage;
        outcomes = withRiders(basicRows(components.map((component) => component.id)), html, components);
    } else if (basicDamage === null && !Object.keys(sections).length) return null;
    else if (Object.keys(sections).length) {
        outcomes = {};
        for (const degree of ["criticalSuccess", "success", "failure", "criticalFailure"]) {
            const section = sections[degree];
            const row = none();
            if (section) {
                // Damage only in some case ("If the creature would collide with the wall, they take 1d10+5"): the GM's.
                // Effects picked from a list ("one of the following effects, as chosen by the performer"): the GM's.
                const always = section.split(/\bone of the following\b/i)[0];
                // Not the row's own, told to the GM: damage with a save of its own ("takes 2d10+9 piercing damage (basic
                // Fortitude save)", "inflicting 2d6 fire damage to them (basic Reflex save)"), and splash on the creatures around it.
                const sentences = sentencesOf(unconditional(always));
                const ownSave = (sentence) => /@Check\[/.test(sentence);
                const splash = (raw) => /\[splash\]/i.test(raw);
                const formulas = sentences.filter((sentence) => !ownSave(sentence)).flatMap((sentence) => inlineTags(sentence, "Damage")).filter((raw) => !splash(raw)).map((raw) => ({ formula: readDamage(raw) }));
                const byHand = [
                    ...conditionalDamage(always),
                    ...sentences.filter((sentence) => ownSave(sentence) && inlineTags(sentence, "Damage").length).map(readableText),
                    ...sentences.filter((sentence) => !ownSave(sentence)).flatMap((sentence) => [...sentence.matchAll(/@Damage\[((?:[^\[\]]|\[(?:[^\[\]]|\[[^\]]*\])*\])*)\](?:\{[^}]*\})?/g)].filter((match) => splash(match[1])).map((match) => `Splash: ${readableText(match[0])} damage to each creature within 5 feet of {target}.`))
                ];
                if (byHand.length) row.manualInstructions = byHand.map((text) => (text.includes("{target}") ? text : `{target}: ${text}`));
                if (formulas.length) row.damage = { mode: "formulas", formulas, rollScope: "outcome" };
                // "takes half damage" / "full damage" / "double damage" against the ability's own damage.
                const plain = htmlToPlainText(section);
                const multiplier = /double damage/i.test(plain) ? 2 : /full damage/i.test(plain) ? 1 : /half damage/i.test(plain) ? 0.5 : null;
                // With its own damage too ("takes full damage, is knocked prone, and takes 2d6 persistent bleed"): both.
                if (multiplier !== null && components.length) {
                    const shared = { mode: "shared", multiplier, sourceComponentIds: components.map((component) => component.id) };
                    row.damage = formulas.length ? { mode: "mixed", shared, formulas, rollScope: "outcome" } : shared;
                }
                // Conditions named without links count too ("Failure The creature is slowed 1 for 1d4 rounds").
                row.effects = readConditions(section, { plain: SECTION_CONDITIONS });
                const push = readPush(section, ownNames(actor ?? item.actor ?? item.parent));
                if (push) row.forcedMovement = push;
            }
            outcomes[degree] = row;
        }
        // "As failure, but the effect persists for 3 rounds after leaving the aura": the failure's row,
        // with what the row names itself in place of the same conditions ("As failure, but frightened 3").
        for (const [degree, like] of [["criticalFailure", "failure"], ["criticalSuccess", "success"]]) {
            const text = sections[degree] ? htmlToPlainText(sections[degree]).trim() : "";
            if (!new RegExp(`^As ${like}\\b`, "i").test(text)) continue;
            const copy = structuredClone(outcomes[like]);
            const linger = readLinger(text);
            if (linger) for (const effect of copy.effects) if (effect.duration?.mode === "in-aura") effect.duration = { ...effect.duration, after: linger };
            // "As failure, but the duration is 1 minute", "…, but the effect lasts 10 minutes": the copied conditions, for that long.
            const lasts = /\b(?:the duration is|(?:the )?(?:effect|condition)s? lasts?|lasting)\s+(?:for\s+)?((?:\d+|one|two|three|ten)\s+(?:round|minute|hour)s?\b|\[\[[^\]]*\]\](?:\{[^}]*\})?|\d+d\d+\s+(?:round|minute)s?\b)/i.exec(text);
            const longer = lasts ? readDuration(`for ${lasts[1]}`) : null;
            if (longer) for (const effect of copy.effects) if (effect.kind === "condition" && effect.slug !== "prone" && effect.duration?.mode !== "while") effect.duration = longer;
            const own = outcomes[degree];
            // "As failure, plus 1d4 persistent fire damage": the failure's damage and this; otherwise this in its place.
            const plus = new RegExp(`^As ${like},? (?:plus|and)\\b`, "i").test(text);
            const damage = own.damage?.mode === "none" ? copy.damage : plus ? addDamage(copy.damage, own.damage) : own.damage;
            // "As failure, except the creature is pushed 70 feet away": its own push in place of the failure's.
            outcomes[degree] = { ...copy, damage, effects: [...copy.effects.filter((effect) => !own.effects.some((other) => other.slug === effect.slug)), ...own.effects], ...(own.forcedMovement ? { forcedMovement: own.forcedMovement } : {}) };
        }
    } else {
        outcomes = saveOrOutcomes(html, components, { names: ownNames(actor ?? item.actor ?? item.parent), afterHit, triggered: readsTrigger(item) });
        if (!outcomes) return null;
        // (Batch 69: what a held creature suffers and how it gets free, "While immobilized, the victim takes 3d8 persistent bleed
        // damage …", "The creature is immobilized until … the target succeeds at a DC 38 check to Escape": the GM's, on the failures.)
        const held = sentencesOf(String(html).replace(/\[\[\/act ([\w-]+)[^\]]*\]\](?:\{([^}]*)\})?/g, (_all, slug, label) => label ?? slug.replace(/^\w/, (letter) => letter.toUpperCase()))).filter((sentence) => /^(?:While (?:immobilized|grabbed|restrained),|The (?:creature|target|victim) is (?:immobilized|grabbed|restrained) until\b)/i.test(htmlToPlainText(sentence.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).trim()));
        if (held.length) for (const degree of ["failure", "criticalFailure"]) if (outcomes[degree]?.effects?.some((effect) => ["immobilized", "grabbed", "restrained"].includes(effect.slug))) outcomes[degree].manualInstructions = [...(outcomes[degree].manualInstructions ?? []), ...held.map((sentence) => `{target}: ${readableText(sentence)}`)];
    }
    const plain = htmlToPlainText(html);
    const passive = item.system?.actionType?.value === "passive";
    // "It recovers after it has been out of the aura for 1 minute": its conditions last while inside, and that long after.
    const recovers = /\brecovers after (?:it has been|being) out of the (?:aura|area|emanation)\b/i.test(plain) ? readLinger(plain) : null;
    if (recovers) for (const row of Object.values(outcomes)) for (const effect of row.effects ?? []) if (effect.kind === "condition" && !effect.duration) effect.duration = { mode: "in-aura", after: recovers };
    // A real aura (the trait, or PF2e's Aura rule); other passives (Death Throes, Defensive Quills) act on their own triggers.
    const aura = passive && ((item.system?.traits?.value ?? []).includes("aura") || (item.system?.rules ?? []).some((rule) => rule?.key === "Aura"));
    // When it dies ("When the skeleton is destroyed, its bones … explode. Adjacent creatures take 2d6 slashing damage", 2026-10-10):
    // on its death, around it. Its area: the template, "adjacent creatures" (5 feet), or "each creature within 30 feet".
    const dies = passive && !aura && DIES.test(plain);
    // An aura with no template: "30 feet." at the start of its text.
    const template = inlineTags(html, "Template").map(readTemplate).find(Boolean) ?? (passive && /^(\d+) feet/i.test(plain) ? { type: "emanation", value: Number(/^(\d+) feet/i.exec(plain)[1]) } : null)
        ?? (dies ? (/\badjacent creatures?\b|\beach (?:creature|enemy) adjacent\b|\bcreatures? adjacent to (?:it|the [\w' -]+)\b/i.test(plain) ? { type: "emanation", value: 5 } : /\bwithin (\d+) feet\b/i.exec(plain) ? { type: "emanation", value: Number(/\bwithin (\d+) feet\b/i.exec(plain)[1]) } : null) : null);
    // (Batch 229: "each creature within 30 feet", "all enemies within 10 feet", "each foe within 5 feet" with no template — an emanation around it, foes
    // only when it says foes or enemies; not "within 10 feet of the target", around something else.)
    const around = !template && !aura ? AROUND.exec(plain) : null;
    const area = template ?? (around ? { type: "emanation", value: Number(around[2]), ...(/^(?:foe|enem)/i.test(around[1]) ? { foes: true } : {}) } : null);
    const range = around ? null : readRange(plain);
    const recharge = readRecharge(html);
    const immunity = readImmunity(html, [item.name, (actor ?? item.actor ?? item.parent)?.name]);
    // Only creatures it's holding ("each creature it has grabbed").
    const grabbed = /\b(?:creatures?|targets?) (?:it(?:'s| is| has)?|the monster(?:'s| is| has)?) (?:grabbed|grabbing|restrained|restraining)|\b(?:grabbed|restrained) by (?:it|the monster)\b/i.test(plain);
    return {
        ...base(item),
        targeting: { target: area ? null : "1 creature", range: range ? `${range} feet` : area ? null : "touch", area, ...(grabbed ? { grabbed: true } : {}) },
        trigger: { event: aura ? "aura" : dies ? "death" : passive ? "passive" : "use", ...(aura ? readAuraTiming(plain) : {}), ...(aura && readActiveAfter(plain) ? { activeAfter: readActiveAfter(plain) } : {}), ...(recharge ? { recharge: { formula: recharge, unit: "rounds" } } : {}), ...(immunity ? { immunity } : {}) },
        resolution: { kind: "save", check: { roll: "save", statistic: check.statistic, basic: check.basic, against: { dc: "fixed", value: check.dc } }, sharedDamage: components.length ? { rollOnce: true, components } : null, outcomes }
    };
}

// "When the grodair dies, its body explodes …", "When a sodden sentinel is reduced to 0 Hit Points, it explodes", "When the
// skeleton is destroyed …": a passive that acts as it dies.
// (Also, batch 19: "When killed, the star archon explodes …", "When destroyed, a flaming skull explodes …", the clause opening a
// later sentence ("The snapdrake's death reveals one last surprise. When it dies, it explodes …"), "Each time … and when
// they're reduced to 0 Hit Points".)
const DIES = /^(?:When|Whenever|As|Upon|If|Each time)\b[^.]*?\b(?:dies|is (?:killed|destroyed|slain)|(?:is|are|they're|it's) reduced to 0 (?:Hit Points|HP)|reaches 0 (?:Hit Points|HP))\b|^(?:When|Upon being) (?:killed|destroyed|slain)\b|(?<=[.!?]\s)When (?:it|they) (?:dies|die|is destroyed|are destroyed|is killed|are killed)\b/i;

// No roll at all (2026-10-10): "The statue grinds a creature it has Grabbed … The target takes 3d8 fire and 1d8 persistent fire
// damage.", "Each enemy within the aura takes 1d8 slashing damage.", "The creature takes 3d6 piercing damage and is Drained 1." →
// a check of roll "automatic": its success row for every creature it names (the card's Apply; the simulator's certain result).
// Its later sentences, for the GM. Not: any check or basic action in it, damage to itself, a choice, "if"/"unless"/"instead" in
// the result, damage by some count ("per creature"), healing.
const AUTO_SUBJECT = /^(?:The|That|This) (?:target|creature|grabbed creature|restrained creature|swallowed creature|engulfed creature|triggering creature|victim|foe|enemy|attacker)\b|^(?:Each|Every|All) (?:other )?(?:living )?(?:creatures?|enem(?:y|ies)|foes?)\b|^(?:A|An|Any) (?:(?:Tiny|Small|Medium|Large|Huge) or smaller )?(?:living )?(?:creature|target|foe|enemy) (?:hit|struck|damaged) by\b/i;
function automaticEffect(item, actor = null, { rider = false } = {}) {
    // (A passive its Strikes list, as their rider: "A creature hit by the frog's tongue becomes Grabbed".)
    if (!["action", "reaction", "free", ...(rider ? ["passive"] : [])].includes(item.system?.actionType?.value)) return null;
    const html = String(item.system?.description?.value ?? "");
    // (Batch 231, Pharyngeal Jaws: a bonus "to the DC for the creature to [[/act escape]]" — not an action of its own; a rider's Escape DC as before.)
    const escapeOnly = !/\[\[\/act (?!escape\b)/i.test(html) && (rider || /\b(?:bonus|penalty) to [^.]*?\bDC for the creature to \[\[\/act escape\b/i.test(html));
    if (/@Check\[|\bhealing\b|\bregains?\b|\bone of the following\b/i.test(html) || (/\[\[\/act /i.test(html) && !escapeOnly)) return null;
    const effect = html.split(/<strong>\s*Effect\s*<\/strong>/i).at(-1).replace(/<strong>\s*(?:Frequency|Requirements?|Trigger|Cost)\s*<\/strong>[^]*?(?=<strong>|$)/gi, "");
    const words = htmlToPlainText(effect);
    // A save, check or Strike in it (one without an inline check: "must attempt a Reflex save"), a choice, or a next action's.
    if (/\b(?:saves?|saving throw|checks?)\b|\bchooses?\b|\bchoice\b|\bnext action\b/i.test(words)) return null;
    // (A Strike it makes is a Strike activity's; a rider's text names the Strike that brings it.)
    if (!rider && /\b(?:makes?|attempts?|attempting|making) (?:a|an|one|two|three)\b[^.]*\bStrikes?\b|\bStrikes? (?:the|a|an|it|them|with)\b/i.test(words)) return null;
    const level = Number((actor ?? item.actor ?? item.parent)?.system?.details?.level?.value);
    const sentences = sentencesOf(effect);
    const components = [];
    const effects = [];
    const notes = [];
    let first = -1;
    for (const [index, sentence] of sentences.entries()) {
        const plain = htmlToPlainText(sentence.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g, "@D")).replace(/\s+/g, " ").trim();
        // "The target takes …", "Each enemy within 30 feet takes …"; "<it> deals … damage to the target"; "The creature is Drained 1".
        const takes = AUTO_SUBJECT.test(plain) && /\btakes? @D(?: damage)?\b/i.test(plain);
        // (Also "… sucks blood from that target, dealing 2d4 damage".)
        // (Batch 65: "The lizard's jaws deal 1d6 piercing damage and 1d6 acid damage to the triggering creature".)
        // (Batch 69: "dealing an additional 1d8 sonic damage to the creature struck".)
        const deals = /\b(?:deal(?:s|ing)?|dealing an (?:additional|extra)) @D(?: damage)? to (?:the (?:target|creature|grabbed creature|restrained creature|victim|triggering creature)|each (?:creature|enemy|foe)|all (?:creatures|enemies|foes))\b/i.test(plain) || (/\b(?:that|the) (?:target|creature|foe|victim)\b[^.]*?\bdealing @D(?: damage)?\b/i.test(plain) && !/\bdealing @D(?: damage)? to\b/i.test(plain))
            // (Batch 225, Shell Shock: "… inflicting 7d6 electricity damage to the creature attacking it".)
            || /\binflicting @D(?: damage)? to the creature attacking (?:it|them|him|her)\b/i.test(plain);
        const conditions = readConditions(sentence).filter((entry) => entry.recipient !== "self");
        const is = (AUTO_SUBJECT.test(plain) || deals) && conditions.length > 0;
        // (What it only tells: "This is in addition to the normal sonic damage from the antler Strike".)
        if (first >= 0 && /^This is in addition to the (?:normal |regular |usual )?(?:\w+ )?damage (?:from|of|dealt by) (?:the|its) [\w' -]+?(?: Strike)?\.$/i.test(plain)) continue;
        if (!takes && !deals && !is) {
            // Damage it doesn't read ("deals 3d6 spirit or 3d6 void damage to the triggering enemy"): not one reading.
            // (Not a condition's damage, "If the attack misses, … takes …", nor a threshold, "a Strike that deals at least @D damage".)
            if (/@D/.test(plain) && !/^(?:If|When|Whenever|Unless)\b/i.test(plain) && /\b(?:deals?|dealing|takes?|taking)\b(?! at least)[^.]*?@D/i.test(plain.replace(/\bthat deals at least @D[^.,]*/gi, "")) && inlineTags(sentence, "Damage").some((raw) => !/\bhealing\b/i.test(raw))) return null;
            // (Not its recharge, which the module keeps.)
            if (first >= 0 && plain && !/^\(?DC \d+/.test(plain) && !/\bcan(?:'t|not) use [^.]+? again for\b/i.test(plain)) notes.push(readableText(sentence.replace(/\[\[\/(?:r|gmr|br|roll) [^\]]*\]\]\{([^}]*)\}/g, "$1")));
            continue;
        }
        if (/^(?:If|When|Whenever|Unless|Until|While|Once|After)\b/i.test(plain) || /\b(?:if|unless|whenever|instead|must|still)\b/i.test(plain)) return null;
        // Only some of them ("Each creature that fails its save …", "Every foe within 60 feet taking persistent fire damage …").
        const subject = AUTO_SUBJECT.test(plain) ? (/^(.*?)\b(?:takes?|is|are|becomes?|gains?|falls?)\b/i.exec(plain)?.[1] ?? "").replace(/^(?:The|That|This|Each|Every|All)\s+/i, "") : "";
        if (/\b(?:that|who|whose|taking|suffering|affected|already|wearing|holding|carrying|with)\b|\bin the water\b/i.test(subject.replace(/^(?:creature|target) (?:it|that it) has (?:Grabbed|Restrained)\b/i, ""))) return null;
        // Damage by some count, or one of several ("1d6 damage per creature", "@D or @D"); results by a degree ("Frightened 1,
        // or Frightened 2 on a critical hit"): not one result for everyone.
        if (/@D(?: damage)? per\b|@D[^.]*?\bor @D/i.test(plain) || /\bcritical(?:ly)? (?:hit|success|failure|fails?|succeeds?)\b|\bon a critical\b/i.test(plain)) return null;
        // Off-guard to some attackers only, or seen and unseen ("Concealed"): the GM's.
        if (/\boff-guard (?:against|to)\b/i.test(plain) || conditions.some((entry) => ["concealed", "hidden", "undetected", "invisible", "observed", "unnoticed"].includes(entry.slug))) return null;
        if (first < 0) first = index;
        for (const raw of inlineTags(sentence, "Damage")) {
            if (/\bhealing\b/i.test(raw)) continue;
            // "(@actor.level)[persistent,poison]": the creature's level.
            let formula = readDamage(raw);
            if (/@actor\.level/.test(formula)) {
                if (!Number.isFinite(level)) return null;
                formula = formula.replace(/@actor\.level/g, String(level));
            }
            if (/@/.test(formula)) return null;
            components.push({ id: String(components.length), formula, type: null, category: null });
        }
        effects.push(...conditions);
        // More in the same sentence ("…, and its resistances to physical damage are reduced by 5"): the sentence for the GM.
        if (/\b(?:resistances?|weakness|penalty|bonus|can't|cannot|Speeds?|exposed|immune)\b/i.test(plain)) notes.push(readableText(sentence.replace(/\[\[\/(?:r|gmr|br|roll) [^\]]*\]\]\{([^}]*)\}/g, "$1").replace(/\[\[\/act ([\w-]+)[^\]]*\]\](?:\{([^}]*)\})?/g, (_all, slug, label) => label ?? slug[0].toUpperCase() + slug.slice(1))));
    }
    if (!components.length && !effects.length) return null;
    const plain = htmlToPlainText(html);
    const template = inlineTags(html, "Template").map(readTemplate).find(Boolean) ?? null;
    // "Each enemy within 30 feet", "each creature within the aura": around it.
    const around = template ? null : /\b(?:Each|Every|All) (?:other )?(?:living )?(?:creatures?|enem(?:y|ies)|foes?) within (\d+) feet\b/i.exec(plain);
    const area = template ?? (around ? { type: "emanation", value: Number(around[1]) } : null);
    const range = readRange(plain);
    const grabbed = /\b(?:grabbed|restrained|swallowed|engulfed) creature\b|\bcreature (?:it|that it) has Grabbed\b|\bhas (?:a|the) creature (?:Grabbed|Restrained)\b/i.test(plain);
    const success = {
        damage: components.length ? { mode: "shared", multiplier: 1, sourceComponentIds: components.map((component) => component.id) } : { mode: "none", multiplier: 0, sourceComponentIds: [] },
        effects: [...new Map(effects.map((entry) => [entry.slug, entry])).values()].map((entry) => condition(entry.slug, entry.value ?? null, entry.duration ?? null)),
        ...(notes.length ? { manualInstructions: notes.map((note) => `{target}: ${note}`) } : {})
    };
    // "A Medium or smaller creature hit by …": the size, for the GM.
    const size = /\b(?:A|An|Any) ((?:Tiny|Small|Medium|Large|Huge) or smaller) (?:living )?(?:creature|target|foe|enemy) (?:hit|struck|damaged) by\b/i.exec(plain)?.[1];
    if (size) success.manualInstructions = [`{target}: only a ${size.toLowerCase()} creature.`, ...(success.manualInstructions ?? [])];
    const recharge = readRecharge(html);
    return {
        ...base(item),
        targeting: { target: area ? null : "1 creature", range: range ? `${range} feet` : area ? null : "touch", area, ...(grabbed ? { grabbed: true } : {}) },
        trigger: { event: "use", ...(recharge ? { recharge: { formula: recharge, unit: "rounds" } } : {}) },
        resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: components.length ? { rollOnce: true, components } : null, outcomes: { criticalSuccess: none(), success, failure: none(), criticalFailure: none() } }
    };
}

// The item as the readers see it: one written in older inline syntax (other publishers' monsters)
// with its text in PF2e's current form; PF2e's own items unchanged.
// A hydra's heads (2026-10-11, batch 43): "A hydra ordinarily has five heads." (Head Regrowth), "Alkoasha has ten heads." → 5, 10;
// null when no ability of the creature says.
export function headCount(actor) {
    for (const other of actor?.items ?? []) {
        const match = /\b(?:ordinarily |typically |usually )?has (\w+) heads\b/i.exec(htmlToPlainText(other.system?.description?.value ?? ""));
        if (match && countWord(match[1]) > 1) return countWord(match[1]);
    }
    // (Batch 231, the jotund troll: "gigantic, nine-headed horrors" in its notes.)
    const headed = /\b(\w+)-headed\b/i.exec(htmlToPlainText(actor?.system?.details?.publicNotes ?? ""));
    return headed && countWord(headed[1]) > 1 ? countWord(headed[1]) : null;
}

// Storm of Jaws (batch 43): "makes a number of Strikes up to its number of heads" with the creature's heads, "makes up to 5 Strikes".
// (Batch 203, Ravenous Jaws: "makes a number of jaws Strikes up to their number of heads" — its name kept, the count in words.)
const HEAD_WORDS = { 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten" };
function withHeads(item, actor) {
    const html = item.system?.description?.value;
    // (Batch 261, Flurry of Limbs: "… up to its number of functioning limbs" — as many as its other abilities say it has, "ordinarily has three severed
    // limbs", in words for the multi-Strike reader.)
    const limbs = /\bup to (?:its|their) number of functioning limbs\b/i;
    if (typeof html === "string" && limbs.test(html)) {
        const owner = actor ?? item.actor ?? item.parent;
        const said = (owner?.items?.contents ?? owner?.items ?? []).map((other) => htmlToPlainText(String(other.system?.description?.value ?? ""))).map((text) => /\bordinarily has (two|three|four|five|six) (?:severed )?limbs\b/i.exec(text)?.[1]).find(Boolean);
        return said ? withDescription(item, html.replace(limbs, (all) => `${all} (${said.toLowerCase()})`)) : item;
    }
    const words = /\ba number of ((?:[\w' -]+? )?)Strikes up to (?:its|their|his|her) number of heads\b/gi;
    if (typeof html !== "string" || !words.test(html)) return item;
    const heads = headCount(actor ?? item.actor ?? item.parent);
    return heads ? withDescription(item, html.replace(words, (_all, name) => `up to ${name ? HEAD_WORDS[heads] ?? heads : heads} ${name}Strikes`)) : item;
}

// Focused Assault (batch 43): one Strike for all its heads, leaves or weapons. "The hydra Strikes with its fangs. On a successful
// attack, the hydra deals damage from its fangs Strike to the target, plus an additional 1d6 damage for every head it has beyond the
// first. On a failure (but not a critical failure), the hydra deals the damage from one fangs Strike to the target creature. This
// Strike counts as a number of attacks equal to the number of heads the hydra has toward the hydra's multiple attack penalty." → a
// Strike activity: that many more dice on a hit (of the Strike's type unless it names one), the Strike's damage on a failure
// (failureDamage), counted as that many attacks. How many: the text's ("all four of its leaves", "both its two leaves", "four
// stalks", "typically 5d8 slashing damage") or the creature's heads. null otherwise.
function focusedAssault(item, actor) {
    const text = readableText(item.system?.description?.value ?? "");
    // (Batch 224, Focused Slam: "… makes a fist Strike. On a successful attack, they deal fist damage to the target plus an additional 3d8 damage, and they
    // meet the requirements to Rend the target this turn, even if they didn't hit on two consecutive Strikes. Even on a failed attack, … deals the damage
    // from one fist Strike … This ability counts as four attacks toward an angazhani's multiple attack penalty. After using this ability, the angazhani is
    // Off-Guard until the beginning of their next turn." — the extra dice on a hit, the Strike's damage on a failure, that many attacks, Off-Guard after;
    // Rend a note.)
    const slam = /\bOn a successful attack, (?:it|they|he|she) deals? [\w' -]+? damage to the target plus an additional (\d+d\d+) damage, and (?:it|they|he|she) meets? the requirements to Rend the target this turn, even if (?:it|they|he|she) didn't hit on two consecutive Strikes\./i.exec(text);
    if (slam) {
        let strike = null;
        let failure = false;
        let counted = null;
        let offGuard = false;
        for (const [index, sentence] of text.split(/(?<=\.)\s+(?=[A-Z])/).entries()) {
            let match;
            if (sentence.includes(slam[0].trim())) continue;
            if ((match = /^(?:The )?[^.]+? makes (?:a|an|one) ([\w' -]+?) Strike\.$/i.exec(sentence))) {
                strike = match[1].toLowerCase();
                continue;
            }
            if (/^Even on a failed attack,? (?:the [\w' -]+?|it|they|he|she) deals? the damage from one [\w' -]+? Strike to the target, though (?:it|they|he|she) still miss(?:es)? completely on a critical failure\.$/i.test(sentence)) {
                failure = true;
                continue;
            }
            if ((match = /^This (?:ability|Strike) counts as (two|three|four|five|six) attacks toward [^.]*multiple attack penalty\.$/i.exec(sentence))) {
                counted = countWord(match[1]);
                continue;
            }
            if (/^After using this ability, (?:the [\w' -]+?|it|they) (?:is|are) Off-Guard until the (?:beginning|start) of (?:its|their) next turn\.$/i.test(sentence)) {
                offGuard = true;
                continue;
            }
            if (index === 0 && !/\d|@|\b(?:damage|Strikes?|save|bonus|penalty)\b/i.test(sentence)) continue;
            return null;
        }
        if (!strike || !failure || !counted) return null;
        return { builtin: "strike-activity", actions: Number(item.system?.actions?.value) || 2, strides: 0, strike, attackBonus: 0, damageBonus: 0, offGuard: false, requires: null, oncePerFight: false, countsAs: counted, failureDamage: true, onHit: { conditions: [], critical: null, push: null, damage: [`${slam[1]}[strike]`], save: null, size: null }, ...(offGuard ? { selfAfter: [{ slug: "off-guard", until: "own-turn-start" }] } : {}), notes: ["On a hit it can Rend the target this turn, as if it had hit with two Strikes in a row.", ...(offGuard ? ["It's Off-Guard until the start of its next turn."] : [])] };
    }
    const extra = /\bplus an additional (\d+)d(\d+) (?:([a-z]+) )?damage for every (\w+)(?: (?:it|they|he|she) (?:has|wields?))? beyond the first(?: \(typically (\d+)d\d+ [a-z ]*?damage\))?\./i.exec(text);
    if (!extra) return null;
    const things = String.raw`(?:heads|leaves|stalks|longswords|weapons|arms|tentacles)`;
    const number = String.raw`(two|three|four|five|six|seven|eight)`;
    const stated = new RegExp(String.raw`\b(?:all|both) (?:${number} of )?(?:its|their|his|her) (?:${number} )?${things}\b|\bwith ${number} ${things}\b`, "i").exec(text);
    const count = extra[5] ? Number(extra[5]) / Number(extra[1]) + 1 : stated?.slice(1).find(Boolean) ? countWord(stated.slice(1).find(Boolean)) : /^head$/i.test(extra[4]) ? headCount(actor ?? item.actor ?? item.parent) : null;
    if (!count || count < 2) return null;
    let strike;
    let failure = false;
    let counted = false;
    for (const sentence of text.split(/(?<=\.)\s+(?=[A-Z])/)) {
        let match;
        if (sentence === extra[0] || sentence.includes(extra[0])) {
            if (!/^On a (?:success|successful attack), /i.test(sentence)) return null;
            continue;
        }
        if ((match = /^(?:The )?[^.]+? attacks a single target with [^.,]+?(?:, (?:overwhelming (?:its|their|his|her|the) (?:foe|target) with multiple attacks and leaving almost nowhere to dodge|making one ([\w' -]+?) Strike))?\.$/i.exec(sentence))) {
            if (match[1]) strike = match[1].toLowerCase();
            continue;
        }
        if ((match = /^(?:The )?[^.]+? (?:Strikes with (?:its|their|his|her) ([\w' -]+?)(?: or (?:its|their|his|her) [\w' -]+?)?|makes (?:a|an|one) ([\w' -]+?) Strike)\.$/i.exec(sentence))) {
            strike = (match[1] ?? match[2]).toLowerCase();
            continue;
        }
        if (/^(?:Even on a failed attack|On a failure(?: \(but not a critical failure\))?),? (?:the [\w' -]+?|it|they|he|she) deals? the damage (?:from|of) one [\w' -]+?(?: Strike)?(?: to the target(?: creature)?)?(?:, (?:though (?:it|they|he|she) still miss(?:es)? completely on a critical failure|but (?:it|they) can't use Improved Grab))?\.$/i.test(sentence)) {
            failure = true;
            continue;
        }
        if (/^(?:It|They|He|She) deals? no damage on a critical failure\.$/i.test(sentence)) continue;
        if (/^This (?:Strike )?counts (?:as a number of attacks equal to the number of \w+ [^.]*? toward [^.]*multiple attack penalty|toward [^.]*multiple attack penalty as a number of attacks equal to the number of \w+ [^.]*?)\.$/i.test(sentence)) {
            counted = true;
            continue;
        }
        return null;
    }
    if (!strike || !failure || !counted) return null;
    const dice = Number(extra[1]) * (count - 1);
    return {
        builtin: "strike-activity",
        actions: Number(item.system?.actions?.value) || 2,
        strides: 0,
        strike: /^(?:melee|weapon)$/i.test(strike) ? null : strike,
        attackBonus: 0,
        damageBonus: 0,
        offGuard: false,
        requires: null,
        oncePerFight: false,
        countsAs: count,
        failureDamage: true,
        onHit: { conditions: [], critical: null, push: null, damage: [`${dice}d${extra[2]}[${extra[3] ? extra[3].toLowerCase() : "strike"}]`], save: null, size: null }
    };
}

function modernItem(item) {
    const html = item.system?.description?.value;
    if (typeof html !== "string") return item;
    const modern = modernInline(html);
    if (modern === html) return item;
    const description = { ...item.system.description, value: modern };
    const system = new Proxy(item.system, { get: (target, key) => (key === "description" ? description : Reflect.get(target, key)) });
    return new Proxy(item, { get: (target, key) => (key === "system" ? system : Reflect.get(target, key)) });
}

// An ability used in one of several ways, each listed as "<li><strong>Name</strong> (traits) …</li>" ("Mengkare breathes in
// one of two ways": Flame, Weakening Gas; Powerful Utterance; Halo Pulse) → { builtin: "modes", actions, modes: [{ name,
// plan }] }: each way compiled on its own with what comes before the list (the area, the recharge); a way that compiles
// to nothing has plan null (the GM's). null when the text isn't one of these, or no way compiles.
// (Batch 101: "breathes a blast of energy from one of its three heads", "has one of the effects below", "chooses one of the four options listed
// below".)
const MODES = /\bin one of (?:two|three|four) ways\b|\bone of (?:two|three|four) effects\b|\bone of the following (?:ways|modes|forms)\b|\bchooses? one effect\b|\bfrom one of (?:its|their) (?:two|three|four|five) heads\b|\bone of the (?:effects|(?:two|three|four) options)(?: listed)? below\b/i;
function compileModes(item, options) {
    let html = item.system?.description?.value ?? "";
    if (!MODES.test(htmlToPlainText(html))) return null;
    // (Batch 162, a construct's Breath Weapon: its ways as "<p>- Flame (arcane, evocation, fire) A blast of flame …</p>" paragraphs in place of
    // a list — read as one.)
    const dashed = [...html.matchAll(/<p>\s*-\s+([A-Z][\w' -]+?) (\([^)]*\)) ([\s\S]*?)<\/p>/g)];
    if (html.search(/<ul\b/i) < 0 && dashed.length >= 2) {
        dashed.forEach((found, index) => {
            html = html.replace(found[0], `${index === 0 ? "<ul>" : ""}<li><strong>${found[1]}</strong> ${found[2]} ${found[3]}</li>${index === dashed.length - 1 ? "</ul>" : ""}`);
        });
        item = withDescription(item, html);
    }
    // (Batch 180, Veksciralenix's Breath Weapon: its ways as "<p><strong>Storm</strong> …</p><hr /><p><strong>Time Displacement</strong> …</p>"
    // paragraphs one after another, the last way's degrees of success after them — read as a list.)
    const LABELS = /^(?:Critical Success|Success|Failure|Critical Failure|Trigger|Effect|Frequency|Requirements?|Cost|Special|Activate|Prerequisites?)$/i;
    const ways = [...html.matchAll(/<p>\s*<strong>([^<]+)<\/strong>([\s\S]*?)<\/p>/g)].filter((found) => !LABELS.test(found[1].trim()));
    const runs = ways.length >= 2 && ways.slice(1).every((found, index) => /^\s*(?:<hr\s*\/?>\s*)*$/.test(html.slice(ways[index].index + ways[index][0].length, found.index)));
    if (html.search(/<ul\b/i) < 0 && runs) {
        const last = ways.at(-1);
        html = `${html.slice(0, ways[0].index)}<ul>${ways.map((found) => `<li><strong>${found[1]}</strong>${found[2]}</li>`).join("")}</ul>${html.slice(last.index + last[0].length)}`;
        item = withDescription(item, html);
    }
    const start = html.search(/<ul\b/i);
    const end = html.search(/<\/ul>/i);
    if (start < 0 || end < start) return null;
    // (Batch 101: its recharge sentence, "The mukradi can't Breathe Energy again for 1d4 rounds.", after each way's own words, so the
    // save and the way's damage stay together.)
    // (Only when the save is there, before the list.)
    const waits = [];
    const opening = html.slice(0, start).replace(new RegExp(MODES.source, "gi"), "");
    const preamble = /@Check\[/i.test(opening) ? opening.replace(/(^|<p>|\.\s+)((?:The |It |They )?[^.<>]*?\bcan(?:'|’)?t (?:use )?[^.<>]*? again for [^.<>]*\.)/gi, (all, before, sentence) => {
        waits.push(`<p>${sentence}</p>`);
        return before;
    }) : opening;
    // Results written after the list belong to its last way (a duel dragon's Demoralizing Cry).
    const after = html.slice(end + "</ul>".length);
    // (Batch 249, Halo Pulse: "… on creatures in their inspiring presence aura" — that aura's emanation, from its Aura rule; "pushed until it's no longer
    // in the aura" — pushed that far.)
    const auraName = /\bcreatures in (?:their|its) ([\w' -]+?) aura\b/i.exec(htmlToPlainText(preamble))?.[1];
    const aura = auraName ? [...(options.actor?.items ?? [])].find((entry) => String(entry.name ?? "").toLowerCase() === auraName.toLowerCase()) : null;
    const auraRadius = Number((aura?.system?.rules ?? []).find((rule) => rule.key === "Aura")?.radius) || null;
    const auraTemplate = auraRadius ? `@Template[emanation|distance:${auraRadius}]` : null;
    const parts = html.slice(start, end).split(/<li\b[^>]*>/i).slice(1).map((part) => part.replace(/<\/li>\s*$/i, ""));
    if (parts.length < 2) return null;
    const modes = parts.map((part, index) => {
        const name = /^\s*(?:<p>)?\s*<strong>([^<]+)<\/strong>/i.exec(part)?.[1]?.trim();
        if (!name) return null;
        // (Batch 101: its traits kept when its words start with the area, "(fire) @Template[cone|distance:60] of fire dealing …", so they
        // read on from the save before them.)
        const bare = part.replace(/^\s*(?:<p>)?\s*<strong>[^<]+<\/strong>\s*/i, "");
        const body = /^\([^)]*\)\s*@Template\[/i.test(bare) ? bare : bare.replace(/^(?:\([^)]*\))?\s*;?\s*/i, "");
        const wayBody = auraTemplate ? body.replace(/^Each creature\b/i, `Each creature in a ${auraTemplate}`).replace(/\bbe pushed until it['’]s no longer in the aura\b/i, `be pushed ${auraRadius} feet away`) : body;
        const description = { ...(item.system?.description ?? {}), value: `${preamble}<p>${wayBody}</p>${waits.join("")}${index === parts.length - 1 ? after : ""}` };
        const system = new Proxy(item.system, { get: (target, key) => (key === "description" ? description : key === "slug" ? null : Reflect.get(target, key)) });
        const way = new Proxy(item, { get: (target, key) => (key === "system" ? system : key === "name" ? `${item.name} (${name})` : Reflect.get(target, key)) });
        let plan = null;
        try {
            plan = compileMonsterAbility(way, options);
        } catch {
            plan = null;
        }
        // (Batch 162, Weakening Gas: "…; the effect lasts 1 minute." — its conditions' time.)
        const lasts = /\bthe effect lasts (\d+) minutes?\b/i.exec(htmlToPlainText(body))?.[1];
        if (lasts && plan?.resolution?.outcomes) for (const row of Object.values(plan.resolution.outcomes)) for (const effect of row.effects ?? []) if (effect.kind === "condition" && !effect.duration) effect.duration = { mode: "fixed", value: Number(lasts), unit: "minutes" };
        // (Batch 179, the mocking dragon's Hilarious Exhalation: a way that has a spell's effect — Laughing Fit, Grease — as that spell's cast.)
        return { name, plan: plan?.resolution || plan?.builtin === "cast-spell" ? plan : null };
    });
    if (modes.some((mode) => !mode) || !modes.some((mode) => mode.plan)) return null;
    return { builtin: "modes", actions: Number(item.system?.actions?.value) || 1, modes };
}

// Wicked Bite (2026-10-11, batch 51; the user's choice: a GM button for each way, the simulator the better one): "Requirements The
// urdefhan damaged a creature with a jaws Strike on their last action Effect … The target must succeed at a @Check[fortitude|dc:22] save
// or be affected by drain blood or drain vitality (the urdefhan's choice). If the jaws Strike was a critical hit, the creature is
// affected by both effects, using the same save result for both. • Drain Blood … On a failed save, the creature is Drained 1 and the
// urdefhan regains 5 HP (or, on a critical failure, it's Drained 2 and the urdefhan regains 10 HP). • Drain Vitality … The creature
// becomes Enfeebled 1 for 1 hour on a failed save (or Enfeebled 2 for 1 hour on a critical failure)." → modes, each a Fortitude save
// after that Strike (batch 36's follow-up), its regained Hit Points and the critical hit's both ways as reminders. null otherwise.
function wickedBite(item) {
    const html = String(item.system?.description?.value ?? "");
    const plain = htmlToPlainText(html.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    if (!/\bDrain Blood\b/.test(plain) || !/\bDrain Vitality\b/.test(plain)) return null;
    const need = /\bRequirements? (.+?) Effect\b/.exec(plain)?.[1];
    const last = need ? followUpNeed(need) : null;
    const dc = Number(/@Check\[fortitude\|dc:(\d+)/i.exec(html)?.[1]);
    if (!last || !dc) return null;
    const WHO = String.raw`(?:the [\w' -]+?|[A-Z][\w'-]+)`;
    const HP = String.raw`(?:@Damage\[)?(\d+)(?:\[healing\]\])? HP`;
    const blood = new RegExp(String.raw`\bDrain Blood\b[^.]*\.\s*On a failed save, the creature is Drained (\d) and ${WHO} regains ${HP} \((?:or, )?on a critical failure, it's Drained (\d) and ${WHO} regains ${HP}\)\.`, "i").exec(plain);
    const vitality = /\bDrain Vitality\b[^.]*\.\s*The creature becomes Enfeebled (\d) for 1 hour on a failed save \(or Enfeebled (\d) for 1 hour on a critical failure\)\./i.exec(plain);
    if (!blood || !vitality) return null;
    const hour = readDuration("for 1 hour");
    const condition = (slug, value, duration = null) => ({ kind: "condition", slug, value: Number(value), duration });
    const both = "If the Strike was a critical hit, {target} is affected by both ways, with the same save result.";
    const save = (failure, critical, reminders) => ({
        ...base(item),
        targeting: { target: "the creature the Strike hits", range: "touch", area: null },
        trigger: { event: "use", followUp: last },
        resolution: { kind: "save", check: { roll: "save", statistic: "fortitude", basic: false, against: { dc: "fixed", value: dc } }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: none(), failure: { damage: none().damage, effects: failure }, criticalFailure: { damage: none().damage, effects: critical } }, reminders }
    });
    return {
        builtin: "modes",
        actions: Number(item.system?.actions?.value) || 1,
        modes: [
            { name: "Drain Blood", plan: save([condition("drained", blood[1])], [condition("drained", blood[3])], [`On a failed save, {source} regains ${blood[2]} HP (${blood[4]} on a critical failure).`, both]) },
            { name: "Drain Vitality", plan: save([condition("enfeebled", vitality[1], hour)], [condition("enfeebled", vitality[2], hour)], [both]) }
        ]
    };
}

// A save whose damage "depends on the number of actions" (a troop's coordinated attacks), each count's damage after its
// action glyph ("<span class="action-glyph">2</span> @Damage[(3d6+10)[bludgeoning]] damage") or its number
// ("2 @Damage[…]"): the basic save with the lowest count's damage, and resolution.native.byActions[n] with each
// count's (the core's planWithActions; live play asks how many actions, the simulator picks). null otherwise.
function actionCountSave(item, actor) {
    const html = item.system?.description?.value ?? "";
    // (Batch 241: also "The damage and additional effects depend on the number of actions".)
    // (Batch 244, Striking Koa: "… for their choice of bludgeoning, piercing, or slashing damage depending on the number of actions" — untyped damage
    // of the first, its type the monster's pick: PF2e's caster choice, as batch 142's.)
    const phrase = /\b(?:depends? on|depending on) the number of actions\b/i.exec(html);
    if (!phrase) return null;
    const check = inlineTags(html, "Check").map(readCheck).find((entry) => entry.save && entry.dc);
    if (!check?.basic) return null;
    // From the phrase on: a count, then its damage, up to the next count.
    const choice = /\bfor (?:their|its) choice of (\w+), (\w+),? or (\w+) damage\b/i.exec(htmlToPlainText(html));
    const picks = choice ? choice.slice(1, 4).map((type) => type.toLowerCase()) : null;
    const { masked, tags } = maskDamage(html.slice(phrase.index));
    // (Batch 234, Battlezoo: the count in a "pf2-icon" span.)
    const markers = [...masked.matchAll(/<span class="(?:action-glyph|pf2-icon)">([123])<\/span>|(?<![\w\u0000])([123])(?=\s*\u0000)/g)];
    const variants = {};
    const extras = {};
    markers.forEach((marker, index) => {
        const segment = masked.slice(marker.index + marker[0].length, markers[index + 1]?.index ?? masked.length);
        const found = [...segment.matchAll(/\u0000(\d+)\u0000/g)].map((match) => tags[Number(match[1])]).filter((raw) => !/\bhealing\b/i.test(raw));
        if (found.length) variants[marker[1] ?? marker[2]] = found.map((raw, id) => ({ id: String(id), formula: picks ? readDamage(raw).replace(/\[untyped\]$/, `[${picks[0]}]`) : readDamage(raw), type: null, category: null }));
        const extra = countConditions(segment.replace(/\u0000\d+\u0000/g, ""));
        if (extra) extras[marker[1] ?? marker[2]] = extra;
    });
    const counts = Object.keys(variants).map(Number).sort((a, b) => a - b);
    // Every count with the same parts, so the rows' damage ids stay the same.
    if (counts.length < 2 || counts.some((count) => variants[count].length !== variants[counts[0]].length)) return null;
    const components = variants[counts[0]];
    const before = html.slice(0, phrase.index);
    const plain = htmlToPlainText(before);
    // No template: "each enemy within 10 feet", "each adjacent enemy" around the troop.
    // (Batch 234, Battlezoo: the enemies in or beside its squares.)
    const around = /\beach (?:adjacent )?enem(?:y|ies) within (\d+) feet\b/i.exec(plain)?.[1] ?? (/\beach adjacent enem(?:y|ies)\b/i.test(plain) ? "5" : null)
        ?? /\b(?:each|all) enem(?:y|ies) in (?:(?:its|their) squares|the squares (?:it|they) occup(?:y|ies)) (?:and|or) within (\d+) feet\b/i.exec(plain)?.[1] ?? null;
    // (Batch 234: its enemies only, as it says — area.foes.)
    // (Batch 244: "each enemy in a @Template[…]", "against enemies within @Template[…]" — its enemies only too.)
    const drawn = inlineTags(before, "Template").map(readTemplate).find(Boolean);
    const enemiesOnly = /\benem(?:y|ies)\s+(?:in|within)\s+(?:an?\s+)?@Template\[/i.test(before);
    const template = (drawn && enemiesOnly ? { ...drawn, foes: true } : drawn) ?? (around ? { type: "emanation", value: Number(around), foes: true } : undefined);
    const range = readRange(plain);
    const recharge = readRecharge(html);
    const outcomes = withRiders(basicRows(components.map((component) => component.id)), before, components);
    // (Batch 241: each count's own conditions, its rows — the core's byActions[n].rows; "The DC to Escape … is 26" a
    // note on the rows that grab or restrain.)
    const escape = Number(/\[\[\/act escape dc=(\d+)\]\]/i.exec(html)?.[1] ?? /\bDC to Escape\b[^.]*? is (\d+)\b/i.exec(htmlToPlainText(html))?.[1]) || null;
    const rowsFor = (count) => {
        const extra = extras[count];
        if (!extra) return outcomes;
        const rows = structuredClone(outcomes);
        for (const degree of ["failure", "criticalFailure"]) {
            rows[degree].effects = [...(rows[degree].effects ?? []), ...extra[degree]];
            if (escape && extra[degree].some((effect) => ["grabbed", "restrained"].includes(effect.slug))) rows[degree].manualInstructions = [`The DC to Escape is ${escape}.`];
        }
        return rows;
    };
    return {
        ...base(item, { time: String(counts[0]) }),
        targeting: { target: template ? null : "each enemy in reach", range: range && !around ? `${range} feet` : template ? null : "touch", area: template ?? null },
        trigger: { event: "use", ...(recharge ? { recharge: { formula: recharge, unit: "rounds" } } : {}) },
        resolution: {
            kind: "save",
            check: { roll: "save", statistic: check.statistic, basic: true, against: { dc: "fixed", value: check.dc } },
            sharedDamage: { rollOnce: true, components },
            outcomes: rowsFor(counts[0]),
            ...(picks ? { casterChoice: { kind: "damage-type", label: "Damage type", values: picks } } : {}),
            native: { byActions: Object.fromEntries(counts.map((count) => [count, { sharedDamage: { components: variants[count] }, ...(extras[count] ? { rows: rowsFor(count) } : {}) }])) }
        }
    };
}

// The conditions one action count adds after its damage (batch 241): "(plus Grabbed for 1 round on a critical
// failure)", "(plus grabbed for 1 round on a failure or Restrained for 1 round on a critical failure)", "plus Grabbed"
// (a failed save's and worse). { failure, criticalFailure } effects, or null.
function countConditions(segment) {
    const plus = /\bplus\s+([\s\S]+?)\)?\s*$/i.exec(htmlToPlainText(segment).trim())?.[1]?.replace(/[.)]+$/, "").trim();
    if (!plus) return null;
    const read = (text) => readConditions(text, { plain: STAGE_CONDITIONS }).map(({ recipient, ...effect }) => effect);
    const both = /^(.+?) on a failure,? or (.+?) on a critical failure$/i.exec(plus);
    const critOnly = both ? null : /^(.+?) on a critical failure$/i.exec(plus);
    const failure = both ? read(both[1]) : critOnly ? [] : /\bon a\b/i.test(plus) ? null : read(plus);
    const criticalFailure = both ? read(both[2]) : critOnly ? read(critOnly[1]) : failure;
    if (!failure || !criticalFailure?.length) return null;
    return { failure, criticalFailure };
}

// What the text may call the monster ("toward the kun"): its name, its token's, without "(Young)", and its last word
// ("Elite Kun", "PFTEST SIM Kun").
function ownNames(actor) {
    const names = [actor?.name, actor?.prototypeToken?.name].filter(Boolean);
    const plain = names.map((name) => name.replace(/\s*\([^)]*\)\s*/g, " ").trim());
    const last = plain.map((name) => name.split(/\s+/).at(-1)).filter((word) => word && word.length >= 3);
    return [...new Set([...names, ...plain, ...last])];
}

// The item with other text, as the readers see it.
function withDescription(item, html) {
    const description = { ...(item.system?.description ?? {}), value: html };
    const system = new Proxy(item.system, { get: (target, key) => (key === "description" ? description : Reflect.get(target, key)) });
    return new Proxy(item, { get: (target, key) => (key === "system" ? system : Reflect.get(target, key)) });
}

// A save whose results expose the creature to an affliction written after them (Vamollaroth's Spew Pollution: "takes full
// damage and is exposed to a level 18 variant of brain worm", then "Brain Worm", its save and stages): the save read from
// the text before the affliction, and on the results that expose, a note for the GM to roll the affliction's own save
// (this save's result isn't the affliction's, so it isn't handed to Pseudo Afflictions). null otherwise.
function exposureSave(item, actor) {
    const html = item.system?.description?.value ?? "";
    const stage = html.search(/<strong>\s*Stage\s+1\s*<\/strong>/i);
    const cut = stage < 0 ? -1 : html.lastIndexOf("<hr", stage);
    if (cut < 0 || !/<strong>\s*(?:Critical Success|Success|Failure|Critical Failure)\s*<\/strong>/i.test(html.slice(0, cut))) return null;
    const block = html.slice(cut);
    const plan = inlineSave(withDescription(item, html.slice(0, cut)), actor);
    const name = /^<hr[^>]*>\s*<p>\s*<strong>([^<]+)<\/strong>\s*<\/p>/i.exec(block)?.[1]?.trim();
    const affliction = readAffliction(withDescription(item, block));
    if (!plan?.resolution?.outcomes || !affliction) return null;
    if (name) affliction.name = name;
    const sections = degreeSections(html.slice(0, cut));
    let exposes = false;
    for (const [degree, row] of Object.entries(plan.resolution.outcomes)) {
        const text = htmlToPlainText(sections[degree] ?? "");
        const like = /^As (failure|success)\b/i.exec(text)?.[1]?.toLowerCase();
        if (/\bexposed to\b/i.test(text) || (like && /\bexposed to\b/i.test(htmlToPlainText(sections[like] ?? "")))) {
            const save = affliction.statistic[0].toUpperCase() + affliction.statistic.slice(1);
            row.manualInstructions = [`{target} is exposed to ${affliction.name}: a DC ${affliction.dc} ${save} save against it (its stages are in the ability's text).`];
            exposes = true;
        }
    }
    return exposes ? plan : null;
}

// An ability whose one result is a PF2e effect item, linked in its text ("Effect: Battle Cry") or its own self effect
// (PF2e's "Use" button), with nothing else to resolve: no check, damage, Strike, spell, choice, trigger or movement. A
// plan of the core's effect family, { kind: "effect", applications: [{ kind: "native-spell-effect", uuid, label,
// recipients }] }. Who gets it is read from the sentence that grants it ("… gains a +2 circumstance bonus to AC"):
// - its self effect, or a sentence about the monster itself ("The swordkeeper raises …, gaining …"): the monster;
// - many allies ("herself and all allies within 60 feet", "each ally within a 5-foot emanation"): its allies, in that
//   emanation when one is given, else the GM's targets;
// - one other creature ("an adjacent ally", "an enemy within 30 feet", "the construct gains"): the GM's target.
// null otherwise.
const EFFECT_LINK = /@UUID\[(Compendium\.[\w-]+\.(?:bestiary-effects|[\w-]*effects?)\.Item\.[A-Za-z0-9]{16})\](?:\{([^}]*)\})?/gi;
const GRANTS = /\b(?:gains?|gaining|takes? an?|taking an?|grants?|granting|gives?|giving|becomes?|has|have)\b[^.]*?\b(?:bonus|penalty|resistance|weakness|temporary Hit Points|fast healing|regeneration|immun\w*|cover|Quickened|concealed|reach|Speeds?)\b/i;
const OTHERS = /\b(?:all(?:y|ies)|allied|bodyguards?|minions?|companions?|host|rider|target|targets|creatures?|characters?|enem(?:y|ies)|foes?|constructs?|infantry)\b/i;
const MANY_ALLIES = /\b(?:all|each|every|its|their|his|her|other|up to \w+|any number of)\b[^.]{0,30}?\b(?:all(?:y|ies)|allied)\b|\ballies\b/i;
function effectAbility(item) {
    const type = item.system?.actionType?.value;
    // (Batch 82: a reaction whose trigger reads, Brutal Rally's "Trigger The gang leader rolls a critical hit against a creature Effect All
    // allies that can see the gang leader gain …": the effect, set off by that; its Trigger section set aside.)
    const raw = item.system?.description?.value ?? "";
    const triggerText = type === "reaction" ? /<strong>\s*Trigger\s*<\/strong>([\s\S]*?)(?=<hr|<\/p>\s*<p>\s*<strong>\s*Effect|<strong>\s*Effect)/i.exec(raw)?.[1] : null;
    const triggered = triggerText ? readReactionTrigger(htmlToPlainText(triggerText).trim()) : null;
    // (Batch 258, Stoke the Fervent: "This lasts for 2d4 rounds." — PF2e's effect keeps its own time; "Affected allies must use at least one of their
    // actions to Strike each round, …" — a note.)
    const told = [];
    const html = (triggered ? raw.replace(/<p[^>]*>\s*<strong>\s*Trigger\s*<\/strong>[\s\S]*?<\/p>\s*(?:<hr\s*\/?>)?/i, "").replace(/<strong>\s*Effect\s*<\/strong>/i, "") : raw)
        .replace(/\s*This lasts for \[\[\/(?:b|gm)?r (\d+d\d+)[^\]]*\]\](?:\{[^}]*\})?\./i, (_all, dice) => {
            told.push(`It lasts ${dice} rounds: roll it and set the effect's time.`);
            return "";
        })
        .replace(/\s*Affected (?:allies|creatures) must use at least one of their actions to Strike each round[^.]*\./i, (all) => {
            told.push(htmlToPlainText(all).trim());
            return "";
        })
        // (Batch 267, Compel Courage: "Non-velstracs who accept this compelled courage find bleeding wounds opening …. They take 1 bleed damage and can't
        // attempt a flat check to end this damage as long as they're compelled." — a note.)
        .replace(/\s*(Non-[\w-]+) who accept [^.]+\.\s*They take @Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})? damage and can't attempt a flat check to end this damage as long as they're [\w-]+\./i, (all, who) => {
            const amount = /@Damage\[\(?(\d+)\)?\[(\w+)\]\]/.exec(all);
            told.push(`${who} who accept it take ${amount ? `${amount[1]} ${amount[2]}` : "bleed"} damage, and can't end it with a flat check while it lasts.`);
            return "";
        });
    if (!(["action", "free"].includes(type) || triggered) || /<strong>\s*Trigger\s*<\/strong>/i.test(html)) return null;
    if (inlineTags(html, "Check").length || inlineTags(html, "Damage").length || /\[\[\//.test(html)) return null;
    const links = [...html.matchAll(EFFECT_LINK)];
    const own = item.system?.selfEffect?.uuid ?? null;
    const uuids = [...new Set([...(own ? [own] : []), ...links.map((match) => match[1])])];
    if (uuids.length !== 1) return null;
    const label = links.find((match) => match[1] === uuids[0])?.[2] ?? item.name;
    // The text without the effect's own link, an area kept as words ("within a 20-foot emanation").
    const text = html.replace(EFFECT_LINK, "").replace(/(?:\ban?\s+)?@Template\[(?:type:)?(\w+)\|distance:(\d+)[^\]]*\](?:\{[^}]*\})?/gi, "a $2-foot $1").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1");
    // (Batch 230, Activate Defenses: "… to defend the soldier or an adjacent creature of the soldier's choice" — itself or a creature beside it, the GM's
    // target.)
    // (Batch 259, Inspiring Display: "Requirements The cavern mage's previous action was to Cast a Spell Effect … to inspire another kobold within 30
    // feet. That kobold gains …" — straight after a spell, requires "after-cast"; that kobold one ally.)
    let afterCast = null;
    const plain = htmlToPlainText(text).replace(/\bEffect:\s*$/i, "").trim().replace(/\b(?:the [\w' -]+?|itself|themself) or an adjacent (creature|ally) of (?:its|their|the [\w' -]+?['’]s) choice\b/i, "itself or an adjacent $1")
        .replace(/^Requirements? (?:The )?[\w' -]+?['’]s? (?:previous|most recent) action (?:this turn )?was to Cast an? (non-cantrip )?Spell\.?\s+Effect /i, (_all, nonCantrip) => {
            afterCast = { requires: "after-cast", ...(nonCantrip ? { nonCantrip: true } : {}) };
            return "";
        })
        .replace(/\b(?:uses (?:its|their|his|her) [\w' -]+? to inspire )another ([a-z]+) within (\d+) feet\. That \1 gains\b/i, "inspires another $1 ally within $2 feet. That ally gains");
    if (afterCast && /^Requirements?\b/i.test(plain)) return null;
    // Something else to do: a Strike, a check, a spell, a choice, movement, terrain, an area everyone's in.
    // (Batch 120: not the effect's own bonuses, "a +2 status bonus to attack rolls, Perception checks, saving throws, and skill checks" —
    // what it gives isn't what it does.)
    const doing = plain.replace(/\b(?:bonus|penalty) to [^.]*/gi, "");
    if (/\bStrikes?\b|\bchecks?\b|\bDemoralize\b|\bone of the following\b|\b(?:its|the [\w' -]+?'s) choice\b|\bchooses?\b|\bcasts?\b|\bspells?\b|\bsummons?\b|\bteleports?\b|\b(?:Strides?|Steps?|Flies|Burrows?|Swims?|Leaps?)\b|\bterrain\b|\ball creatures in the area\b|\bsaving throw against\b/i.test(doing)) return null;
    let recipients = "self";
    let targeting = { target: null, range: null, area: null };
    if (!own) {
        // The sentence that grants it, and who it's about: what's given to ("grants an adjacent ally a +2 …", "gives
        // themself and all orc allies …"), or the last clause before the verb ("When the swarm gets into formation, it gains").
        // (Batch 239, Battlezoo: a curse of misfortune on the creature that hit it — its attacks rolled twice, the worse kept — its effect on that
        // creature.)
        const misfortune = triggered ? plain.split(/(?<=[.!?])\s+(?=[A-Z])/).find((part) => /^(?:(?:Until|For) [^,]+, )?the (?:triggering creature|attacker) rolls? [^.]*\btwice and (?:uses|takes) the (?:worse|lower) result\.$/i.test(part)) : null;
        if (misfortune) return { ...base(item), targeting: { target: "the attacker", range: "touch", area: null }, trigger: triggered, resolution: { kind: "effect", applications: [{ kind: "native-spell-effect", uuid: uuids[0], label, recipients: "target" }] } };
        const sentence = plain.split(/(?<=[.!?])\s+(?=[A-Z])/).find((part) => GRANTS.test(part));
        if (!sentence) return null;
        const match = GRANTS.exec(sentence);
        const verb = match[0].split(/\s/)[0];
        const clauses = sentence.slice(0, match.index).split(",");
        // A pronoun after a clause that names the creature ("As long as the creature bears the sigil, it takes …").
        const pronoun = /^\s*(?:it|they|he|she)\s*$/i.test(clauses.at(-1)) && OTHERS.test(clauses.slice(0, -1).join(","));
        const about = /^(?:grants?|granting|gives?|giving)$/i.test(verb) ? sentence.slice(match.index + verb.length) : pronoun ? clauses.join(",") : clauses.at(-1);
        // The allies' area, from that sentence or said of them ("all allies within 60 feet", "within a 30-foot emanation").
        const area = /\ba (\d+)-foot (?:emanation|radius|aura)\b/i.exec(sentence)?.[1] ?? /\bwithin (\d+) feet\b/i.exec(sentence)?.[1]
            ?? /\b(?:all(?:y|ies)|allied [\w-]+)\b[^.]*?\bwithin (?:a )?(\d+)(?:-foot\b| feet\b)/i.exec(plain)?.[1];
        const within = Number(area) || null;
        // One creature's range, from anywhere in the text ("an enemy within 30 feet. The target takes …").
        const near = Number(/\bwithin (\d+) feet\b/i.exec(plain)?.[1]) || null;
        const range = near ? `${near} feet` : /\badjacent\b|\btouch(?:es)?\b/i.test(plain) ? "touch" : null;
        // Its own kind around it ("Each caligni within 30 feet", "All vescavor swarms within …") are its allies.
        const kind = /^\s*(?:Each|All|Every) (?!creatures?\b|enem|foes?\b|targets?\b|living\b)[\w' -]+?\s+(?:within|in a \d+-foot)\b/i.test(about);
        const allies = /\ball(?:y|ies)\b|\ballied\b/i.test(about);
        if (kind || (allies && MANY_ALLIES.test(about) && !/\bone of\b/i.test(about))) {
            recipients = "allies-in-area";
            targeting = within ? { target: null, range: null, area: { type: "emanation", value: within } } : { target: "up to 6 creatures", range: null, area: null };
        } else if (allies || OTHERS.test(about)) {
            recipients = allies ? "allies-in-area" : "target";
            targeting = { target: "1 creature", range, area: null };
        }
    }
    return {
        ...base(item),
        targeting,
        trigger: triggered ?? { event: "use" },
        resolution: { kind: "effect", applications: [{ kind: "native-spell-effect", uuid: uuids[0], label, recipients, ...(own ? { selfEffect: true } : {}) }] },
        ...(afterCast ?? {}),
        ...(told.length ? { notes: told } : {})
    };
}

// A follow-up to a Strike that hit (2026-10-10): "Requirements The skull fairy's last action was a successful fist Strike
// … Effect … The creature must succeed at a … save or be Stunned 1", "…damaged a creature with a jaws Strike on its
// last action". The Effect compiled as an ability of its own (a save, a check, an effect) on the creature the
// Strike hit, used as before (the card comes when the GM uses it), with trigger.followUp { strike, melee, on } for the
// simulator, which uses it only straight after such a hit: strike is the Strike's name ("claw"; null for any), on the
// degrees ("a critical hit": criticalSuccess only). null otherwise.
// (Batch 194, Vex: PF2e's Dirty Trick, as its feat has it — a Thievery check against the Reflex DC: Clumsy 1 on a success, Prone itself on a critical
// failure.)
const DIRTY_TRICK = "<p>Attempt a @Check[thievery|defense:reflex] check against the target's Reflex DC.</p><hr /><p><strong>Critical Success</strong> The target is @UUID[Compendium.pf2e.conditionitems.Item.i3OJZU2nk64Df3xm]{Clumsy 1} until they use an Interact action to end the impediment</p><p><strong>Success</strong> As critical success, but the condition ends automatically after 1 round.</p><p><strong>Critical Failure</strong> You fall @UUID[Compendium.pf2e.conditionitems.Item.j91X7x0XSomq8d60]{Prone} as your attempt backfires.</p>";

function followUp(item, actor, basicActions = {}) {
    // (Batch 150, Gnash with no labels: "When the severed head succeeds at its jaws Strike, it can use this action immediately after to make a
    // second jaws Strike at the same target as it …" — written as its requirement and its Strike.)
    const html = String(item.system?.description?.value ?? "").replace(/<p>\s*When (?:the )?([\w' -]+?) succeeds at (?:its|their) ([\w' -]+?) Strike, (?:it|they) can use this action immediately after to make a second \2 Strike at the same target(?: as [^.<]+)?\.\s*/i, (_all, who, name) => `<p><strong>Requirements</strong> The ${who}'s last action was a successful ${name} Strike</p><p><strong>Effect</strong> The ${who} makes a ${name} Strike against the same target. `);
    const block = /<strong>\s*Requirements?\s*<\/strong>([\s\S]*?)(?=<\/p>|<hr|<strong>\s*Effect\s*<\/strong>)/i.exec(html);
    if (!block) return null;
    const need = htmlToPlainText(block[1].replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const last = followUpNeed(need);
    if (!last) return null;
    const { strike: name, melee, on } = last;
    // The Effect, as an ability of its own.
    // ("must succeed on a … save" as "at a", batch 36.)
    let effect = html.slice(block.index + block[0].length).replace(/^\s*<\/p>\s*(?:<hr\s*\/?>)?\s*/i, "").replace(/<strong>\s*Effect\s*<\/strong>/i, "").replace(/\bsucceed on an? (@Check\[)/gi, "succeed at a $1");
    // (Batch 194, Vex: "The mocking dragon attempts a Dirty Trick against the target of their tail Strike. This attempt neither applies nor counts
    // toward the creature's multiple attack penalty." — PF2e's Dirty Trick at the creature it hit, outside its multiple attack penalty.)
    const trick = /^(?:The )?[^.]+? attempts a Dirty Trick against the target of (?:its|their|his|her) [\w' -]+? Strike\. This attempt neither applies nor counts toward (?:the [\w' -]+?['’]s|its|their) multiple attack penalty\.$/i.test(htmlToPlainText(effect.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim());
    if (trick) effect = DIRTY_TRICK;
    // (Batch 263, Fish Fork: "… The target of the Strike becomes Grabbed (Escape DC 18) and takes 1d4 bleed damage, and the wereshark attempts a jaws
    // Strike against it. The wereshark can't use their trident while they have a creature grabbed with it, …" — Grabbed and the bleed on the creature it
    // hit; the jaws Strike after and the trident, notes.)
    const forked = /^(?:[^.@]+\. )?The target of the Strike becomes Grabbed \((?:Escape DC (\d+)|\[\[\/act escape dc=(\d+)\]\](?:\{[^}]*\})?)\) and takes (@Damage\[(?:[^[\]]|\[[^\]]*\])*\]) damage, and (?:the [\w' -]+?|it) attempts an? ([\w' -]+?) Strike against it\.((?: [^.]+\.)*)$/i.exec(htmlToPlainText(effect.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim());
    if (forked) {
        const effects = [{ kind: "condition", slug: "grabbed", value: null, duration: null }];
        const success = { damage: { mode: "formulas", formulas: [{ formula: readDamage(inlineTags(forked[3], "Damage")[0]) }], rollScope: "outcome" }, effects };
        return {
            ...base(item),
            targeting: { target: "the creature the Strike hits", range: "touch", area: null },
            trigger: { event: "use", followUp: { strike: name, melee, on, ...(last.listing ? { listing: last.listing } : {}) } },
            resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success, failure: none(), criticalFailure: none() } },
            notes: [`It's Grabbed (Escape DC ${forked[1] ?? forked[2]}).`, `Then it makes a ${forked[4].toLowerCase()} Strike against the creature.`, ...(forked[5].trim() ? [forked[5].trim()] : [])]
        };
    }
    // (Batch 259, Devour Wealth: "The pixiu swallows up to [[/r 2d12]] gold pieces on the target's person and gains temporary Hit Points equal to the
    // amount devoured. These temporary Hit Points last for 1 minute." — that roll as temporary Hit Points on itself; the gold, a note.)
    const wealth = /^(?:The )?[^.]+? swallows up to \[\[\/(?:b|gm)?r (\d+d\d+)[^\]]*\]\](?:\{[^}]*\})? gold pieces on the target['’]s person and gains temporary Hit Points equal to the amount devoured\. These temporary Hit Points last for (\d+|one) minutes?\.$/i.exec(htmlToPlainText(effect).replace(/\s+/g, " ").trim());
    if (wealth) {
        const minutes = Number(wealth[2]) || 1;
        const effects = [{ kind: "temp-hp", formula: wealth[1], recipient: "self", duration: { mode: "fixed", value: minutes, unit: "minutes", expiry: null, anchor: "effect-start" } }];
        return {
            ...base(item),
            targeting: { target: "the creature the Strike hits", range: "touch", area: null },
            trigger: { event: "use", followUp: { strike: name, melee, on, ...(last.listing ? { listing: last.listing } : {}) } },
            resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: { damage: none().damage, effects }, failure: none(), criticalFailure: none() } },
            notes: [`It swallows that many gold pieces the creature carries: no more than it has, and its temporary Hit Points no more than that.`]
        };
    }
    // (One of several ways, "choosing one of the three following options": the GM's.)
    if (/\bchoos(?:es|ing) one of\b|\bone of the (?:\w+ )?following (?:options|effects)\b/i.test(htmlToPlainText(effect))) return null;
    // A Strike it makes (batch 36): "the zombie horse makes a second jaws Strike as it … On a success, the target takes an
    // additional 1d4 persistent bleed damage", "makes another greatclub Strike against the same target, using the previous Strike's
    // multiple attack penalty", "Strikes the same target, who is Off-Guard against this attack", "Strides up to 10 feet and
    // Strikes": a Strike activity, after such a Strike.
    const strikeText = followUpStrikeText(effect);
    if (strikeText) {
        let activity = null;
        try {
            activity = strikeActivity(withDescription(item, strikeText.html), actor, { after: last });
        } catch {
            activity = null;
        }
        return activity ? { ...activity, ...(strikeText.previousMap ? { previousMap: true } : {}) } : null;
    }
    // (Batch 36: a first sentence that only tells what it does, "The test wisp clings to the creature it hit with its Strike." (made
    // up), left out when the readings that follow find nothing with it.)
    const [first, ...others] = sentencesOf(effect);
    const told = others.length && !/@|\d|\b(?:save|check|damage|Hit Points|HP|bonus|penalty|Strikes? (?:against|at)|makes?|attempts?)\b/i.test(htmlToPlainText(first ?? "")) && !readConditions(first ?? "", { plain: STAGE_CONDITIONS }).length ? others.join(" ") : null;
    const own = withDescription(item, effect);
    // (The first reading with results: batch 36's after the others, each in turn.)
    let plan = null;
    // (Batch 120: an effect for its allies — Keep Up With Me!'s "one ally within 30 feet … gains" — isn't the struck creature's.)
    const atStruck = () => {
        const plan = effectAbility(own);
        return plan?.resolution?.applications?.every((application) => ["target", "self"].includes(application.recipients)) ? plan : null;
    };
    // (Batch 138, Rattling Spear: a basic maneuver in its own words, at each foe around it — variedManeuver's.)
    for (const read of [() => inlineSave(own, actor), () => compileSkillAction(own, { actor }), atStruck, () => automaticEffect(own, actor), () => followUpResults(own, effect), () => followUpSkill(own, effect, basicActions), () => variedManeuver(own, basicActions)]) {
        try {
            plan = read();
        } catch {
            plan = null;
        }
        if (plan?.resolution) break;
    }
    if (!plan?.resolution && told) {
        const shorter = withDescription(item, told);
        try {
            plan = inlineSave(shorter, actor) ?? automaticEffect(shorter, actor);
        } catch {
            plan = null;
        }
    }
    if (!plan?.resolution) return null;
    if (plan.resolution.outcomes) noteUnread(plan.resolution.outcomes, effect);
    const free = item.system?.actionType?.value === "free";
    return {
        ...plan,
        targeting: plan.targeting?.area ? plan.targeting : { target: "the creature the Strike hits", range: "touch", area: null },
        // (Batch 194: a free action's, Improved Vex — free, at once after the Strike.)
        ...(free ? { activation: { ...(plan.activation ?? {}), time: "free" } } : {}),
        trigger: { ...(plan.trigger ?? {}), event: "use", ...(trick ? { map: false } : {}), ...(free ? { cost: "free" } : {}), followUp: { strike: name, melee, on, ...(last.listing ? { listing: last.listing } : {}), ...(last.twice ? { twice: true } : {}) } },
        ...(last.twice ? { notes: [...(plan.notes ?? []), `Only after two ${name ?? ""} Strikes in a row that hit the same creature this round.`.replace(/  +/g, " ")] } : {})
    };
}

// A follow-up's Strike in a Strike activity's words (batch 36): { html, previousMap } or null when it makes no Strike. "makes a
// second jaws Strike as it …" → "makes a jaws Strike."; "against the same target" left out (the creature it just struck); ",
// using the previous Strike's multiple attack penalty" → previousMap; "Strikes the same target, who is Off-Guard against this
// attack." → "Strikes. The target is Off-Guard against this Strike."; "Strides up to 10 feet and Strikes." → "… and makes a
// Strike."; "deals 1d6 additional precision damage" → "deals an additional 1d6 precision damage".
function followUpStrikeText(html) {
    const plain = htmlToPlainText(String(html));
    if (!/\b(?:makes (?:a second|another|an?) (?:[\w' -]+? )?Strike|Strikes the same (?:target|creature)|and Strikes\.)/i.test(plain)) return null;
    let previousMap = false;
    const text = String(html)
        .replace(/^(\s*(?:<p>)?\s*)the\b/, "$1The")
        .replace(/\bmakes (?:a second|another) ((?:[\w' -]+? )?Strike)\b/gi, "makes a $1")
        .replace(/(\bStrike) (?:as|while) (?:it|he|she|they) [^.]*\./g, "$1.")
        .replace(/ against the same (?:target|creature)(?: that (?:it|he|she|they) just hit)?\b/gi, "")
        .replace(/, using the previous Strike's multiple attack penalty\./gi, () => {
            previousMap = true;
            return ".";
        })
        .replace(/\bStrikes the same (?:target|creature), who is (@UUID\[[^\]]*\]\{Off-Guard\}|Off-Guard) (?:against|to) this attack\./gi, "Strikes. The target is Off-Guard against this Strike.")
        .replace(/\b(Strides [^.]*?) and Strikes\./g, "$1 and makes a Strike.")
        .replace(/\bdeals (\d+d\d+) additional (\w+) damage\b/gi, "deals an additional $1 $2 damage");
    return { html: text, previousMap };
}

// Poison Weapon (2026-10-11, batch 41; the user's choice: its poison on the next Strike that hits): "Requirements The assassin is wielding
// a piercing or slashing weapon and has a free hand Effect The assassin applies a poison to the weapon." → { builtin: "poison-weapon",
// actions, poison: { name, uuid, plan } (the injury poison it carries, its affliction compiled; the highest-level one), doses }. null
// when it carries none that reads.
// Its own venom on its weapon (batch 55, Envenom Weapon): the ability with that name and stages, as Poison Weapon's poison, with no doses
// to count (own: true).
function ownVenom(item, actor, name) {
    const owner = actor ?? item.actor ?? item.parent;
    const source = (owner?.items?.contents ?? owner?.items ?? []).find((other) => other !== item && String(other.name ?? "").toLowerCase() === name.toLowerCase() && /<strong>\s*Stage\s+1\s*<\/strong>/i.test(other.system?.description?.value ?? ""));
    if (!source) return null;
    let plan = null;
    try {
        plan = compileAffliction(source, base(source));
    } catch {
        plan = null;
    }
    return plan?.resolution ? { builtin: "poison-weapon", actions: Number(item.system?.actions?.value) || 1, poison: { name: source.name, uuid: source.uuid ?? null, plan }, doses: 99, own: true } : null;
}

// A creature exposed to the monster's own affliction (2026-10-12, batches 114-115) — the affliction with that name among its abilities (its
// save and stages), at the creatures the text names:
// - a poison gas over an area: "The iron golem exhales poisonous gas in a @Template[burst|distance:10] centered on the corner of one of the
//   iron golem's squares. The gas persists for 1 round (until the start of the warden's next turn). Any creature in the area (or that later
//   enters the area) is exposed to the iron golem's poison. The golem can't use its Breath Weapon again for 1d4 rounds." (the gas that
//   lingers a note);
// - an area: "Each living creature within a @Template[emanation|distance:10] is exposed to void's embrace." (after a sentence that tells it);
// - one creature: "The giant wasp lays eggs in an adjacent creature that is Paralyzed or Unconscious, exposing it to the wasp larva
//   disease." (only at such a creature: requiresFoe), "The virulak locks its gaze on a single creature within 30 feet. The target is exposed
//   to the virulak's undead virulence."
// - a reaction (batch 116): "Trigger An adjacent creature Strikes Reginald with a melee weapon or unarmed attack and deals damage Effect The
//   creature is exposed to Reginald's poison ink." (the attacker), "… takes piercing or slashing damage Effect … ejects its venom onto an
//   adjacent creature. That creature is exposed to skrik nettle venom." (a creature beside it), "… Effect All creatures within 10 feet of
//   the mold patch are exposed to phantom mold spores." (an emanation).
function exposureReaction(item, actor) {
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const split = /^Trigger (.+?)[;.]? Effect (.+)$/.exec(plain);
    const trigger = split ? readReactionTrigger(split[1].trim()) : null;
    if (!trigger) return null;
    const effect = split[2].trim();
    // (Batch 227, Battlezoo: its blood splashed onto the attacker, exposing it; the creatures around it exposed, a save against the poison named after.)
    // (Batch 259, Spit Boiling Blood: "… spits blood at the creature. It must immediately attempt a Fortitude save against boiling blood.")
    const attacker = /^The (?:triggering )?creature is exposed to ([^.]+?)\.$/i.exec(effect) ?? /^(?:The )?[^.]+? (?:onto|over|on) the triggering creature, exposing (?:them|it|him|her) to ([^.]+?)\.$/i.exec(effect)
        ?? /^(?:The )?[^.]+? (?:spits|sprays|splashes) [^.]+? at the (?:triggering )?creature\. It must immediately attempt an? (?:Fortitude|Reflex|Will) save against ([^.]+?)\.$/i.exec(effect);
    const beside = /^(?:The )?[^.]+? onto an adjacent creature\. That creature is exposed to ([^.]+?)\.$/i.exec(effect);
    const around = /^(?:(?:The )?[^.]+?\. )?(?:All|Each|Every) creatures? within (\d+) feet of (?:the [\w' -]+?|it|them) (?:is|are) exposed to ([^.]+?)(?:,? and must (?:attempt|roll) an? (?:Fortitude|Reflex|Will) save against (?:the|that) (?:poison|disease|affliction))?\.$/i.exec(effect);
    // (Batch 270, Battlezoo: a save first, the attacker afflicted with its poison on a failure — that save, the poison's own after.)
    const saveFirst = trigger.event === "hit-by" ? /^(?:[^.]+\. )?The (?:triggering creature|attacker) must succeed at an? @Check\[[^\]]*\](?:\{[^}]*\})? save or be (?:afflicted with|exposed to) ([^.]+?)\.$/i.exec(effect) : null;
    const firstCheck = saveFirst ? inlineTags(String(item.system?.description?.value ?? ""), "Check").map(readCheck).find((check) => check?.save && check.dc) : null;
    if (saveFirst && firstCheck) {
        const named = saveFirst[1].toLowerCase().replace(/^the /, "");
        const affliction = ownAffliction(item, actor, named) ?? ownAffliction(item, actor, named.replace(/^[\w' -]+?['’]s /, ""));
        if (!affliction?.resolution?.afflictionHandoff) return null;
        const follow = { ...none(), followUps: [{ kind: "save", check: affliction.resolution.check, outcomes: affliction.resolution.outcomes, afflictionHandoff: affliction.resolution.afflictionHandoff }] };
        return { ...base(item), targeting: { target: "the attacker", range: "touch", area: null }, trigger: { ...trigger, reaction: true }, resolution: { kind: "save", check: { roll: "save", statistic: firstCheck.statistic, basic: false, against: { dc: "fixed", value: firstCheck.dc } }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: none(), failure: follow, criticalFailure: structuredClone(follow) } } };
    }
    const phrase = (attacker?.[1] ?? beside?.[1] ?? around?.[2])?.toLowerCase().replace(/^the /, "").replace(/^[\w' -]+?['’]s /, "");
    if (!phrase || (attacker && trigger.event !== "hit-by")) return null;
    const poison = ownAffliction(item, actor, phrase);
    if (!poison) return null;
    return {
        ...poison,
        source: base(item).source,
        activation: { time: "reaction", traits: poison.activation?.traits ?? [] },
        targeting: attacker ? { target: "the attacker", range: "touch", area: null } : beside ? { target: "1 creature", range: "touch", area: null } : { target: null, range: null, area: { type: "emanation", value: Number(around[1]) } },
        trigger: { ...trigger, reaction: true }
    };
}

// A reaction that uses another of its abilities (2026-10-12, batch 118): "Trigger The grauladon takes damage from an adjacent creature. Effect
// The grauladon uses Noxious Breath, including the triggering creature in the area." (Reactive Breath), "Trigger The troll warleader takes
// electricity or fire damage Effect The warleader uses their Primordial Roar and, if they're aware of the damage's source, can Stride toward
// it. If the warleader has persistent fire damage, they attempt a DC 15 flat check to remove it." (Furious Roar), "… uses Spice Mix against
// the attacker." (Dash of Spice) → that ability's plan (its save, area and results) with this reaction's trigger, as the module reads it,
// and name; what it adds in words (a Stride toward the source, the flat check), notes for the GM.
function reactionUsesAbility(item, actor, options) {
    if (!["reaction", "free"].includes(item.system?.actionType?.value)) return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@Check\[flat\|dc:(\d+)[^\]]*\](?:\{[^}]*\})?/gi, "DC $1 flat check")).replace(/\s+/g, " ").trim();
    const split = /^Trigger (.+?)[;.]? Effect (.+)$/.exec(plain);
    const trigger = split ? readReactionTrigger(split[1].trim()) : null;
    if (!trigger) return null;
    let said = split[2].trim().split(/(?<=\.)\s+(?=[A-Z])/);
    // (Batch 259, Defensive Scream: a sentence that only tells it first, "… lets out an ear-piercing shriek, …. It uses Screaming Force." — set aside.)
    if (said.length > 1 && !/@|\d|\b(?:uses|damage|save|Strike)\b/i.test(said[0]) && /^(?:(?:The )?[\w' -]+?|It|They) uses (?:its |their |his |her )?[A-Z]/.test(said[1] ?? "")) said = said.slice(1).map((sentence, index) => (index === 0 ? sentence.replace(/^(?:It|They) uses /, "The creature uses ") : sentence));
    // (Batch 227: a name with small words in it, "Stomp on Shadow".)
    const uses = /^(?:The )?[\w' -]+? uses (?:its |their |his |her )?([A-Z][\w'-]*(?: (?:(?:of|on|the|in|to|from|at|with|and|a) )*[A-Z][\w'-]*)*)(, including the triggering creature in the area| against the (?:attacker|triggering creature)| and, if (?:it's|they're|he's|she's) aware of the damage's source, can Stride toward it)?\.$/.exec(said[0] ?? "");
    if (!uses) return null;
    const notes = [];
    if (uses[2] && /Stride toward/i.test(uses[2])) notes.push("If it's aware of the damage's source, it can Stride toward it.");
    if (uses[2] && /including the triggering creature/i.test(uses[2])) notes.push("Its area includes the triggering creature.");
    for (const sentence of said.slice(1)) {
        // (Batch 227, Battlezoo: outside its multiple attack penalty; where the effect starts from, and its end after, notes.)
        if (/^This (?:Strike|attack|attempt) (?:neither applies nor counts toward|doesn't take or add to) (?:the [\w' -]+?['’]s|its|their) multiple attack penalty\.$/i.test(sentence)) continue;
        if (/^The (?:point of origin|origin point) for this effect is (?:the [\w' -]+?['’]s|its|their) [\w' -]+?\.$|^(?:The [\w' -]+?|It|They) (?:is|are) then destroyed\.$/i.test(sentence)) {
            notes.push(sentence.replace(/^The (?:point of origin|origin point) for this effect is (?:the [\w' -]+?['’]s|its|their) /i, "Its area starts from its ").replace(/^(?:The [\w' -]+?|It|They) (?:is|are) then destroyed\.$/i, "Then it's destroyed."));
            continue;
        }
        if (/^If (?:the [\w' -]+?|it|they) (?:has|have) persistent \w+ damage, (?:it|they|he|she) attempts? (?:a|an) DC 15 flat check to remove it\.$/i.test(sentence)) notes.push(sentence.replace(/^If (?:the [\w' -]+?|it|they) (?:has|have) persistent/i, "If it has persistent").replace(/(?:they|he|she) attempts?/i, "it attempts"));
        else return null;
    }
    const owner = actor ?? item.actor ?? item.parent;
    const other = (owner?.items?.contents ?? owner?.items ?? []).find((entry) => entry !== item && String(entry.name ?? "").toLowerCase() === uses[1].toLowerCase());
    if (!other) return null;
    let plan = null;
    try {
        plan = compileMonsterAbility(other, { ...options, actor: owner });
    } catch {
        plan = null;
    }
    // (Batch 227, Battlezoo: a Strike activity of one Strike whose hit only gives conditions, used at a creature moving beside it — a reaction Strike
    // with those conditions on a hit.)
    const hit = plan?.builtin === "strike-activity" ? plan.onHit : null;
    if (hit && trigger.event === "provoke" && !plan.strides && !plan.requires && !plan.attackBonus && !plan.damageBonus && hit.conditions?.length && !hit.damage?.length && !hit.push && !hit.save && !hit.size && !notes.length) {
        const words = (entry) => `${entry.slug.replace(/(^|-)(\w)/g, (_all, dash, letter) => (dash ? "-" : "") + letter.toUpperCase())}${Number.isFinite(entry.value) ? ` ${entry.value}` : ""}`;
        const until = hit.conditions.every((entry) => entry.duration?.expiry === "turn-start" && entry.duration?.value === 1) ? " until the start of its next turn" : "";
        const kinds = { leave: "move", enter: "approach" };
        return { builtin: "reaction-strike", triggers: [...new Set(trigger.triggers.map((kind) => kinds[kind] ?? kind))], strike: plan.strike, penalty: 0, disrupts: false, onHit: { conditions: structuredClone(hit.conditions), critical: structuredClone(hit.critical ?? []) },
            ...(typeof trigger.within === "number" ? { within: trigger.within } : {}), note: [`On a hit, the creature is ${hit.conditions.map(words).join(" and ")}${until}.`, ...(plan.notes ?? [])].join(" ") };
    }
    if (!plan?.resolution) return null;
    return {
        ...plan,
        source: base(item).source,
        activation: { time: item.system?.actionType?.value === "free" ? "free" : "reaction", traits: plan.activation?.traits ?? [] },
        targeting: /against the (?:attacker|triggering creature)/i.test(uses[2] ?? "") && !plan.targeting?.area ? { target: "the attacker", range: "touch", area: null } : plan.targeting,
        trigger: { ...trigger, reaction: true, ...(item.system?.actionType?.value === "free" ? { free: true } : {}) },
        ...(notes.length || plan.notes?.length ? { notes: [...(plan.notes ?? []), ...notes] } : {})
    };
}

// An action that uses another of its abilities twice (2026-10-12, batch 119, Double Breath): "The tarn linnorm uses Corrosive Breath twice.
// A creature attempts only one save and can take damage only once. The linnorm can't use Corrosive Breath or Double Breath again for 2d4
// rounds." → that ability's plan with this action's cost, name and recharge; its second area a note for the GM (a creature in both saves
// once).
function actionUsesTwice(item, actor, options) {
    if (item.system?.actionType?.value !== "action") return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/\[\[\/(?:r|gmr|br|roll) [^\]]*\]\](?:\{([^}]*)\})?/g, "$1")).replace(/\s+/g, " ").trim();
    // (Batch 190, Bathygenic Barrage: "Frequency once per day Effect The dragon uses Pressurized Pool three times. None of the bursts can overlap." —
    // that ability's plan, its other areas a note; its frequency PF2e's.)
    const thrice = /^(?:Frequency once per (?:day|hour|minute|10 minutes)\.? Effect )?(?:The )?[\w' -]+? uses ([A-Z][\w'-]*(?: [A-Z][\w'-]*)*) (twice|three times|four times)\. None of the (?:bursts|areas|clouds|pools|emanations) can overlap\.$/i.exec(plain);
    if (thrice) {
        const owner = actor ?? item.actor ?? item.parent;
        const other = (owner?.items?.contents ?? owner?.items ?? []).find((entry) => entry !== item && String(entry.name ?? "").toLowerCase() === thrice[1].toLowerCase());
        let plan = null;
        try {
            plan = other ? compileMonsterAbility(other, { ...options, actor: owner }) : null;
        } catch {
            plan = null;
        }
        // (Batch 256: that ability's zone, made that many times.)
        if (plan?.builtin === "zone") return { ...plan, actions: Number(item.system?.actions?.value) || 1, times: { twice: 2, "three times": 3, "four times": 4 }[thrice[2].toLowerCase()], trigger: { event: "use" }, zone: { ...plan.zone, notes: [...(plan.zone.notes ?? []), "None of its areas can overlap."] } };
        if (!plan?.resolution || !plan.targeting?.area) return null;
        return { ...plan, source: base(item).source, activation: { time: String(Number(item.system?.actions?.value) || 1), traits: plan.activation?.traits ?? [] }, trigger: { event: "use" }, notes: [...(plan.notes ?? []), `${thrice[1]} ${thrice[2].toLowerCase()}: that many areas, none overlapping.`] };
    }
    // (Batch 194, Pushing Pulse: "The barrage dragon performs a 2-action Force Pulse. Each creature who fails its save is pushed 15 feet away from
    // the dragon (30 feet on a critical failure)." — that ability's plan with this action's cost and a push on a failure; its pulses for more
    // actions a note.)
    const pushes = /^(?:The )?[\w' -]+? performs a (\d)-action ([A-Z][\w'-]*(?: [A-Z][\w'-]*)*)\. Each creature (?:who|that) fails its save is pushed (\d+) feet away from (?:the [\w' -]+?|it|them) \((\d+) feet on a critical failure\)\.$/i.exec(plain);
    if (pushes) {
        const owner = actor ?? item.actor ?? item.parent;
        const other = (owner?.items?.contents ?? owner?.items ?? []).find((entry) => entry !== item && String(entry.name ?? "").toLowerCase() === pushes[2].toLowerCase());
        let plan = null;
        try {
            plan = other ? compileMonsterAbility(other, { ...options, actor: owner }) : null;
        } catch {
            plan = null;
        }
        const outcomes = plan?.resolution?.kind === "save" ? plan.resolution.outcomes : null;
        if (!outcomes?.failure || !outcomes.criticalFailure || !plan.targeting?.area) return null;
        const push = (distance) => ({ kind: "push", distance: Number(distance), upTo: false, optional: false, direction: "away" });
        const more = Number(pushes[1]) > 1 && /\bFor each action spent\b/i.test(htmlToPlainText(String(other.system?.description?.value ?? "")));
        return {
            ...plan,
            source: base(item).source,
            activation: { time: String(Number(item.system?.actions?.value) || Number(pushes[1])), traits: plan.activation?.traits ?? [] },
            trigger: { event: "use" },
            resolution: { ...plan.resolution, outcomes: { ...outcomes, failure: { ...outcomes.failure, forcedMovement: push(pushes[3]) }, criticalFailure: { ...outcomes.criticalFailure, forcedMovement: push(pushes[4]) } } },
            ...(more || plan.notes?.length ? { notes: [...(plan.notes ?? []), ...(more ? [`${pushes[2]} with ${pushes[1]} actions: as ${pushes[2]} says for that many actions (its further pulses), the GM's.`] : [])] } : {})
        };
    }
    const match = /^(?:The )?[\w' -]+? uses ([A-Z][\w'-]*(?: [A-Z][\w'-]*)*) twice\. A creature attempts only one save and can take damage only once\.(?: (?:The )?[\w' -]+? can(?:'t|not) use [\w' -]+? or [\w' -]+? again for (\d+d\d+|\d+) rounds\.)?$/.exec(plain);
    if (!match) return null;
    const owner = actor ?? item.actor ?? item.parent;
    const other = (owner?.items?.contents ?? owner?.items ?? []).find((entry) => entry !== item && String(entry.name ?? "").toLowerCase() === match[1].toLowerCase());
    if (!other) return null;
    let plan = null;
    try {
        plan = compileMonsterAbility(other, { ...options, actor: owner });
    } catch {
        plan = null;
    }
    if (!plan?.resolution || !plan.targeting?.area) return null;
    return {
        ...plan,
        source: base(item).source,
        activation: { time: String(Number(item.system?.actions?.value) || 1), traits: plan.activation?.traits ?? [] },
        trigger: { event: "use", ...(match[2] ? { recharge: { formula: match[2], unit: "rounds" } } : {}) },
        notes: [...(plan.notes ?? []), `${match[1]} twice: two areas; a creature in both attempts only one save and takes the damage only once.`, `Its recharge also stops ${match[1]}.`]
    };
}

// An action that brings another of its abilities to everyone in an area (2026-10-12, batch 154, Exhale Miasma): "The green hag exhales a miasma of
// green vapors. Each living creature in a 15-foot cone is affected by her enfeebling humors (attempting a save as normal). She can't use Exhale
// Miasma again for 1d4 rounds." → that ability's save and results, in that area, with this action's cost and recharge; "living" a note.
function areaUsesAbility(item, actor, options) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const template = /@Template\[(?:type:)?(burst|cone|emanation|line)\|distance:(\d+)[^\]]*\]/i.exec(html);
    if (!template) return null;
    const plain = htmlToPlainText(html.replace(/@Template\[[^\]]*\](?:\{[^}]*\})?/g, "@T").replace(/\[\[\/(?:r|gmr|br|roll) [^\]]*\]\](?:\{([^}]*)\})?/g, "$1")).replace(/\s+/g, " ").trim();
    const match = /^(?:[^.@]+\. )?Each (living )?creature in an? @T is affected by (?:the [\w' -]+?['’]s|its|their|his|her) ([a-z][\w' -]+?) \(attempt?ing a save as normal\)\.(?: (?:The )?[^.]+? can(?:'t|not) use [\w' -]+? again for (\d+d\d+|\d+) rounds\.?)?$/i.exec(plain);
    if (!match) return null;
    const owner = actor ?? item.actor ?? item.parent;
    const other = (owner?.items?.contents ?? owner?.items ?? []).find((entry) => entry !== item && String(entry.name ?? "").toLowerCase() === match[2].toLowerCase());
    if (!other) return null;
    let plan = null;
    try {
        plan = compileMonsterAbility(other, { ...options, actor: owner });
    } catch {
        plan = null;
    }
    if (plan?.resolution?.kind !== "save") return null;
    return {
        ...plan,
        source: base(item).source,
        activation: { time: String(Number(item.system?.actions?.value) || 1), traits: plan.activation?.traits ?? [] },
        targeting: { target: null, range: null, area: { type: template[1].toLowerCase(), value: Number(template[2]) } },
        trigger: { event: "use", ...(match[3] ? { recharge: { formula: match[3], unit: "rounds" } } : {}) },
        ...(match[1] || plan.notes?.length ? { notes: [...(plan.notes ?? []), ...(match[1] ? ["Only living creatures in the area."] : [])] } : {})
    };
}

// An action that uses another of its abilities on the move (2026-10-12, batch 157, Screeching Advance): "The owlbear makes a Bloodcurdling Screech and
// Strides twice. All creatures within 80 feet of the owlbear at any point during this movement are subjected to the effects of Bloodcurdling
// Screech." → that ability's plan with this action's cost; the move a note (the simulator plays the screech).
function moveUsesAbility(item, actor, options) {
    if (item.system?.actionType?.value !== "action") return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@Template\[[^\]]*\](?:\{([^}]*)\})?/g, (_all, label) => label ?? "the area")).replace(/\s+/g, " ").trim();
    const match = /^(?:The )?[\w' -]+? makes an? ([A-Z][\w'-]*(?: [A-Z][\w'-]*)*) and Strides (twice|once)\. All creatures within [^.]+? at any point during this movement are subjected to the effects of \1\.$/.exec(plain);
    if (!match) return null;
    const owner = actor ?? item.actor ?? item.parent;
    const other = (owner?.items?.contents ?? owner?.items ?? []).find((entry) => entry !== item && String(entry.name ?? "").toLowerCase() === match[1].toLowerCase());
    if (!other) return null;
    let plan = null;
    try {
        plan = compileMonsterAbility(other, { ...options, actor: owner });
    } catch {
        plan = null;
    }
    if (!plan?.resolution) return null;
    return {
        ...plan,
        source: base(item).source,
        activation: { time: String(Number(item.system?.actions?.value) || 1), traits: plan.activation?.traits ?? [] },
        notes: [...(plan.notes ?? []), `It Strides ${match[2]}: every creature within the area at any point of the move is affected (target them all).`]
    };
}

// A touch that brings another of its abilities with a harder save (2026-10-12, batch 160, Betraying Touch): "The green hag touches a creature that
// doesn't realize the hag is an enemy. The betrayed creature is affected by the hag's enfeebling humors and takes a -4 circumstance penalty to
// their saving throw against that effect.", "… is affected by soporific strike with a –4 circumstance penalty to their saving throw." (its
// Soporific Touch) → that ability's save at a creature it touches, the DC 4 higher; only at a creature that doesn't know it's a foe (requires,
// the GM's live, not played by the simulator).
function betrayingTouch(item, actor, options) {
    if (item.system?.actionType?.value !== "action") return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "")).replace(/\s+/g, " ").trim();
    const match = /^(?:The )?[\w' -]+? touches a creature that (?:doesn't|does not) realize (?:the [\w' -]+?|it|she|he|they) (?:is|are) an enemy\. The betrayed creature is affected by (?:the [\w' -]+?['’]s |its |her |his |their )?([a-z][\w' -]+?)(?: and takes an? [–-](\d) circumstance penalty to (?:their|its) saving throw against that effect| with an? [–-](\d) circumstance penalty to (?:their|its) saving throw)\.$/i.exec(plain);
    if (!match) return null;
    const owner = actor ?? item.actor ?? item.parent;
    const items = (owner?.items?.contents ?? owner?.items ?? []).filter((entry) => entry !== item && entry.type === "action");
    const wanted = match[1].toLowerCase();
    // (Its name, or its first word with another — "soporific strike" for its Soporific Touch.)
    const other = items.find((entry) => String(entry.name ?? "").toLowerCase() === wanted) ?? items.find((entry) => String(entry.name ?? "").toLowerCase().split(/\s+/)[0] === wanted.split(/\s+/)[0]);
    if (!other) return null;
    let plan = null;
    try {
        plan = compileMonsterAbility(other, { ...options, actor: owner });
    } catch {
        plan = null;
    }
    const penalty = Number(match[2] ?? match[3]);
    if (plan?.resolution?.kind !== "save" || plan.resolution.check?.against?.dc !== "fixed" || !Number.isFinite(plan.resolution.check.against.value)) return null;
    return {
        ...plan,
        source: base(item).source,
        activation: { time: String(Number(item.system?.actions?.value) || 1), traits: plan.activation?.traits ?? [] },
        targeting: { target: "1 creature", range: "touch", area: null },
        trigger: { event: "use" },
        requires: "requirement",
        resolution: { ...plan.resolution, check: { ...plan.resolution.check, against: { ...plan.resolution.check.against, value: plan.resolution.check.against.value + penalty } } },
        notes: [...(plan.notes ?? []), `Only at a creature that doesn't realize it's an enemy; its save takes a –${penalty} penalty (the DC here is ${penalty} higher).`]
    };
}

// Fling (2026-10-12, batch 160): "Requirements A creature is Grabbed in the tyrannosaurus's jaws Effect The tyrannosaurus flings the creature into the
// air up to 10 feet up from its mouth and 20 feet away. The creature falls 25 feet (…) and takes falling damage accordingly. If the flung creature
// lands on another creature, the creature it lands on takes the same amount of bludgeoning damage. …", the mantis's "flings a Grabbed creature into
// the air, up to 30 feet overhead and up to 30 feet away … (the creature takes damage from the fall as normal)" → on the creature it holds: let go,
// half the fall as bludgeoning damage, Prone; the one it lands on, a note.
function fling(item) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const plain = htmlToPlainText(html.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    // (Batch 259, Deadly Throw: "throws the creature into the air, 100 feet high and 50 feet away".)
    if (!/\b(?:flings|throws) (?:the creature|an? (?:Grabbed )?creature) into the air\b/i.test(plain)) return null;
    const fall = Number(/\bfalls (\d+) feet\b/i.exec(plain)?.[1] ?? /\bup to (\d+) feet overhead\b/i.exec(plain)?.[1] ?? /\binto the air, (\d+) feet high\b/i.exec(plain)?.[1]);
    if (!fall) return null;
    const tagged = /@Damage\[(\d+)\[bludgeoning\][^\]]*\]/i.exec(html)?.[1];
    const amount = Number(tagged ?? Math.floor(fall / 2));
    const save = inlineTags(html, "Check").map(readCheck).find((check) => check?.save && check.dc);
    const success = { damage: { mode: "formulas", formulas: [{ formula: `${amount}[bludgeoning]` }], rollScope: "outcome" }, effects: [{ kind: "end-condition", slugs: ["grabbed", "restrained"] }, { kind: "condition", slug: "prone", value: null, duration: null }] };
    return {
        ...base(item),
        targeting: { target: "the creature it holds", range: "touch", area: null, grabbed: true },
        trigger: { event: "use" },
        resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success, failure: none(), criticalFailure: none() } },
        notes: [`It falls ${fall} feet and lands Prone, no longer held.`, ...(/\blands on another creature\b/i.test(plain) ? [`A creature it lands on takes the same bludgeoning damage${save ? ` (DC ${save.dc} basic Reflex save)` : ""}.`] : [])]
    };
}

// Damage to the creature it holds (2026-10-12, batch 242): Shred Soul's "Requirements The eseneth has an incorporeal creature Grabbed or Restrained
// Effect The eseneth deals … force damage to the required creature.", Embrace of Iron's "Requirements A creature is Grabbed or Restrained by the iron
// hag's claw Effect The hag's nails tear into their captured victim, dealing … damage (the nails are cold iron). Then the hag can attempt to
// Reposition the creature. If the creature is adjacent to the hag, they can then attempt a jaws Strike against it." → that damage on the creature
// it holds, no roll; the Reposition and the Strike after, notes; an incorporeal creature only, a requirement. null otherwise.
function heldDamage(item) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const tags = inlineTags(html, "Damage");
    if (tags.length !== 1) return null;
    const plain = htmlToPlainText(html.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g, "@D")).replace(/\s+/g, " ").trim().replace(/^Frequency once per (?:round|turn)\.? (?=Requirements?\b)/i, "");
    const need = /^Requirements? (?:(?:The )?[^.]+? has an? (incorporeal )?creature Grabbed(?: or Restrained)?|An? creature is Grabbed(?: or Restrained)? by (?:the [\w' -]+?['’]s|its) [\w' -]+?)\.? Effect (.+)$/i.exec(plain);
    if (!need) return null;
    const sentences = need[2].split(/(?<=\.)\s+(?=[A-Z])/);
    if (!/^(?:(?:The )?[^.]+? deals @D damage to the (?:required|grabbed|held|captured) creature|(?:The )?[^.]+? tears? into (?:their|its) captured victim, dealing @D damage(?: \(the [\w' -]+? (?:are|is) cold iron\))?)\.$/i.test(sentences[0] ?? "")) return null;
    const notes = need[1] ? ["Only an incorporeal creature it holds."] : [];
    for (const sentence of sentences.slice(1)) {
        const strike = /^If the creature is adjacent to (?:the [\w' -]+?|it), (?:they|it) can then attempt an? ([\w' -]+?) Strike against it\.$/i.exec(sentence);
        if (/^Then (?:the [\w' -]+?|it) can attempt to Reposition the creature\.$/i.test(sentence)) notes.push("Then it can Reposition the creature.");
        else if (strike) notes.push(`If the creature is beside it then, it can make a ${strike[1]} Strike against it.`);
        else return null;
    }
    const formula = readDamage(tags[0]);
    return {
        ...base(item),
        targeting: { target: "the creature it holds", range: "touch", area: null, grabbed: true },
        trigger: { event: "use" },
        resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: { damage: { mode: "formulas", formulas: [{ formula }], rollScope: "outcome" }, effects: [] }, failure: none(), criticalFailure: none() } },
        ...(need[1] ? { requires: "requirement" } : {}),
        ...(notes.length ? { notes } : {})
    };
}

// A rune detonated on the creature that hurt it (2026-10-12, batch 177, Retributive Rune): "Trigger A creature within 15 feet damages the rune
// dragon Effect With a burst of runic magic, the rune dragon uses their detonating rune ability on the triggering creature and immediately causes
// the rune to detonate if it didn't automatically do so." (or "creates a detonating rune on …") → its Detonating Rune's damage at the attacker, its
// type the dragon's current Shifting Rune's (the GM's); the archdragon's extra reaction for it a note.
function retributiveRune(item, actor) {
    if (item.system?.actionType?.value !== "reaction") return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const split = /^Trigger (.+?)[;.]? Effect (.+)$/.exec(plain);
    const trigger = split ? readReactionTrigger(split[1].trim()) : null;
    if (!trigger) return null;
    const said = split[2].trim().split(/(?<=\.)\s+(?=[A-Z])/);
    if (!/^With a burst of runic magic, (?:the [\w' -]+?|it) (?:uses (?:their|its) detonating rune ability on|creates a detonating rune on) the triggering creature and immediately causes (?:the rune|it) to detonate if it didn't automatically do so\.$/i.test(said[0] ?? "")) return null;
    const extra = said.slice(1);
    if (extra.length > 1 || (extra.length && !/^(?:The [\w' -]+?|It) gains an additional reaction at the beginning of each of (?:their|its) turns that (?:they|it) can use only for (?:a )?[\w' -]+?\.$/i.test(extra[0]))) return null;
    const owner = actor ?? item.actor ?? item.parent;
    const rune = (owner?.items?.contents ?? owner?.items ?? []).find((entry) => entry !== item && /^detonating rune$/i.test(String(entry.name ?? "")));
    const formula = rune ? inlineTags(String(rune.system?.description?.value ?? ""), "Damage").map(readDamage).find(Boolean) : null;
    if (!formula) return null;
    const success = { damage: { mode: "formulas", formulas: [{ formula }], rollScope: "outcome" }, effects: [] };
    return {
        ...base(item, { time: "reaction" }),
        targeting: { target: "the attacker", range: "touch", area: null },
        trigger: { ...trigger, reaction: true },
        resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success, failure: none(), criticalFailure: none() } },
        notes: ["Its damage type is that of the dragon's current Shifting Rune (the GM's).", ...(extra.length ? ["It gains an extra reaction at the start of each of its turns, only for this."] : [])]
    };
}

// Healing itself or an ally it touches (2026-10-12, batch 161, Dero Medicine): "Requirements The dero is wearing a cytillesh toolkit and has a hand
// free Effect The dero excises damaged flesh and crudely stitches wounds shut, healing themself or an ally in reach for 2d8 Hit Points. For 1 hour,
// the target has slashing weakness 2 and is immune to Dero Medicine." → that healing on itself or an ally in its reach; the hour after, a note
// (with PF2e's linked effect for it).
function healTouch(item) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const tags = inlineTags(html, "Damage");
    if (tags.length !== 1 || !/\bhealing\b/i.test(tags[0])) return null;
    const plain = htmlToPlainText(html.replace(/@Damage\[[^\]]*\]\]?(?:\{[^}]*\})?/g, "\u0000").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const match = /^(?:Requirements? (?:The )?[\w' -]+? is wearing [^.]+? and has a hand free\.? Effect )?(?:The )?[\w' -]+? [^.,]+?, healing (?:themself|itself|himself|herself|themselves) or an ally in reach for \u0000(?: Hit Points)?\.( For 1 hour, the target has ([a-z]+) weakness (\d+) and is immune to ([A-Z][\w' -]+?)\.)?(?: Effect: [\w' ()-]+)?$/.exec(plain);
    if (!match) return null;
    const formula = readDamage(tags[0]).replace(/\[healing\]/i, "").replace(/^\((.*)\)$/, "$1");
    return {
        ...base(item),
        targeting: { target: "itself or an ally in its reach", range: "touch", area: null },
        trigger: { event: "use" },
        resolution: { kind: "healing", native: { healing: { components: [{ id: "0", formula, kinds: ["healing"] }], recipients: "any" } } },
        ...(match[1] ? { notes: [`For 1 hour the creature healed has weakness ${match[3]} to ${match[2]} and can't benefit from ${match[4]} again (PF2e's effect for it is linked in the ability).`] } : {})
    };
}

// Another of its multi-Strike abilities during a flight (2026-10-12, batch 252, a Battlezoo dragon's fly-by): a flight with that ability's attacks made
// along the way, each at a different creature → that ability's multi-Strike (compiled from its own item), with one move first and each at its own
// target. null otherwise.
function flightFrenzy(item, actor, options = {}) {
    if (item.system?.actionType?.value !== "action") return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "")).replace(/\s+/g, " ").trim();
    const match = /^(?:The )?[^.]+? Flies, performing an? ([A-Z][\w' -]+?) with attacks made at any point during the flight\. Each attack must be against a different creature\.$/i.exec(plain)
        ?? /^(?:The )?[^.]+? Flies and uses (?:its|their) ([A-Z][\w' -]+?) along the way, each attack at a different creature\.$/i.exec(plain);
    const owner = actor ?? item.actor ?? item.parent;
    const other = match ? [...(owner?.items ?? [])].find((entry) => entry !== item && entry.type === "action" && String(entry.name ?? "").toLowerCase() === match[1].toLowerCase()) : null;
    if (!other) return null;
    let plan = null;
    try {
        plan = compileMonsterAbility(other, { ...options, actor: owner });
    } catch {
        plan = null;
    }
    if (plan?.builtin !== "multi-strike") return null;
    return { ...plan, actions: Number(item.system?.actions?.value) || plan.actions, strides: 1, each: true, max: plan.strikes.length, sameTarget: false, notes: [...(plan.notes ?? []), `It Flies, making its ${match[1]} attacks at any point along the way, each at a different creature.`] };
}

// A save to keep its action (2026-10-12, batch 254, Objection!): "Trigger A creature within 30 feet takes an action with the linguistic trait Effect The
// triggering creature must succeed a … Will saving throw or their action is disrupted." → the save at that creature; on a failure its action is
// disrupted (a note for the GM). null otherwise.
function disruptingSave(item) {
    if (item.system?.actionType?.value !== "reaction") return null;
    const html = String(item.system?.description?.value ?? "");
    const plain = htmlToPlainText(html.replace(/@Check\[[^\]]*\](?:\{[^}]*\})?/g, "@C").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const split = /^Trigger (.+?)[;.]? Effect (.+)$/.exec(plain.replace(/@Template\[(?:type:)?emanation\|distance:(\d+)[^\]]*\](?:\{[^}]*\})?/g, "$1 feet"));
    // (Batch 265, Elegy of the Faithless: "A divine spell is cast within 30 feet of the abandoned zealot" — a spell cast near it, of that tradition.)
    const castNear = split ? /^An? (arcane|divine|occult|primal)? ?spell is cast within (\d+) feet of (?:the [\w' -]+?|it)\.?$/i.exec(split[1].trim()) : null;
    // (Batch 269, a Battlezoo inventor's jinx: a creature near it doing something with the manipulate trait, worded as an action "with the … trait".)
    const trigger = castNear ? { event: "provoke", reaction: true, triggers: ["cast"], within: Number(castNear[2]), ...(castNear[1] ? { tradition: castNear[1].toLowerCase() } : {}) } : split ? readReactionTrigger(split[1].trim().replace(/^(A creature within \d+ feet) of (?:the [\w' -]+?|it) (?:performs|takes) an action with the (\w+) trait$/i, "$1 uses a $2 action")) : null;
    const check = inlineTags(html, "Check").map(readCheck).find((entry) => entry?.save && entry.dc);
    if (!["provoke", "targeted-by"].includes(trigger?.event) || !check) return null;
    const said = split[2].trim().replace(/\.?$/, ".");
    // (Batch 263: anything aimed at it — "The attacker must attempt a … save; on a failure, it decides its action is too much work and the triggering
    // action is lost. On a critical failure, the creature is also …, becoming Stunned until the start of its next turn"; a hostile spell — "The
    // caster must attempt a … save; on a failure, it promptly shuts its mouth …" — its spell lost.)
    const kept = /^The triggering creature must succeed (?:at |on )?an? @C (?:saving throw|save) or (?:their|its) action is disrupted\.$/i.test(said);
    const lostAction = /^(?:[^@]+?[.!?]["”]? )?The (?:attacker|caster|triggering creature) must attempt an? @C (?:saving throw|save); on a failure, (?:[^.]*? and )?the triggering action is lost\.(?: On a critical failure, the creature is also [^.,]+?, becoming (Stunned|Fascinated|Dazed) until the start of its next turn\.)?$/i.exec(said);
    // (Elegy of the Faithless: "… forcing the spellcaster to attempt a … save, or a higher … if the caster is a member of the zealot's former faith. On a
    // failure, the elegy disrupts the spell." — its higher DC, a note.)
    const elegy = castNear && /^(?:The )?[^@]+?, forcing the spellcaster to attempt an? @C save(, or a higher @C if [^.]+)?\. On a failure, the [\w' -]+? disrupts the spell\.$/i.exec(said);
    const silenced = trigger.spells && /^(?:[^@]+?[.!?]["”]? )?The caster must attempt an? @C (?:saving throw|save); on a failure, it (?:promptly )?shuts its mouth\b[^.]*\.$/i.test(said);
    // (Batch 269, the same jinx: a save, and on a failure the action is disrupted and the creature hurts itself for a set amount, its type fitting what it
    // was doing — that damage, the type the GM's.)
    const hurtsItself = /^(?:The )?[^@.]+?\. The creature must attempt an? @C save\. On a failure, the action is disrupted and [^.@]*?taking (@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?) damage[^.]*\.$/i.exec(said);
    if (!kept && !lostAction && !silenced && !elegy && !hurtsItself) return null;
    const selfHurt = hurtsItself ? readDamage(inlineTags(hurtsItself[1], "Damage")[0]) : null;
    const lost = { ...none(), ...(selfHurt ? { damage: { mode: "formulas", formulas: [{ formula: selfHurt }] } } : {}), manualInstructions: [silenced ? "{target}'s spell is lost: it shuts its mouth." : "{target}'s triggering action is disrupted."] };
    const worst = structuredClone(lost);
    if (lostAction?.[1]) worst.effects.push({ kind: "condition", slug: lostAction[1].toLowerCase(), value: null, duration: { mode: "fixed", value: 1, unit: "rounds", expiry: "turn-start", anchor: "effect-start" } });
    return {
        ...base(item),
        targeting: { target: "the triggering creature", range: typeof trigger.within === "number" ? `${trigger.within} feet` : null, area: null },
        trigger: { ...trigger, reaction: true },
        resolution: { kind: "save", check: { roll: "save", statistic: check.statistic, basic: false, against: { dc: "fixed", value: check.dc } }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: none(), failure: lost, criticalFailure: worst } },
        ...(trigger.verbal ? { notes: ["Only a spell with a verbal component (the GM's)."] } : {}),
        ...(selfHurt ? { notes: ["The damage's type fits the item or action (the GM's)."] } : {}),
        ...(elegy ? { notes: [...(trigger.tradition ? [`Only a ${trigger.tradition} spell.`] : []), ...(elegy[1] ? [`The DC is ${inlineTags(html, "Check").map(readCheck)[1]?.dc ?? "higher"} if ${/if ([^.]+)$/.exec(elegy[1])?.[1] ?? "it says so"}.`] : [])] } : {})
    };
}

// A pull to it, then a Strike (2026-10-12, batch 250, Hungry Winds): one creature in range saves or is drawn in beside the harpy, which then bites it;
// one drawn off the ground that can't fly falls → the save, a failure pulled up to that distance toward it; the Strike after and the fall, notes.
// null otherwise.
function pullThenStrike(item, actor) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const plain = htmlToPlainText(html.replace(/@Check\[[^\]]*\](?:\{[^}]*\})?/g, "@C")).replace(/\s+/g, " ").trim();
    const match = /^(?:[^.@]+\. )?A target within (\d+) feet must succeed at an? @C save or be pulled adjacent to (?:the [\w' -]+?|it)(?:, where (?:they|it) makes? an? ([\w' -]+?) Strike against the target\.|\. (?:The [\w' -]+?|It) then makes an? ([\w' -]+?) [Ss]trike against the target\.)( If the target (?:was|is) pulled (?:off the ground|into the air) and (?:can't|cannot) fly, it (?:then )?falls as normal\.)?$/i.exec(plain);
    const check = inlineTags(html, "Check").map(readCheck).find((entry) => entry?.save && entry.dc);
    if (!match || !check) return null;
    const pulled = { ...none(), forcedMovement: { kind: "pull", distance: Number(match[1]), upTo: true, optional: false, direction: "toward" } };
    return {
        ...base(item),
        targeting: { target: "1 creature", range: `${match[1]} feet`, area: null },
        trigger: { event: "use" },
        resolution: { kind: "save", check: { roll: "save", statistic: check.statistic, basic: false, against: { dc: "fixed", value: check.dc } }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: none(), failure: pulled, criticalFailure: structuredClone(pulled) } },
        notes: [`On a failure, once the creature is beside it, it makes a ${(match[2] ?? match[3]).toLowerCase()} Strike against it.`, ...(match[4] ? ["A creature pulled off the ground that can't fly falls."] : [])]
    };
}

// Healing for every creature in an area (2026-10-12, batch 249, Halo Pulse's Restoration): "Each creature in a @Template[emanation|distance:20]
// recovers 5d8 Hit Points." → the healing family's plan in that area, any creature. null otherwise.
function areaHealing(item) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const tags = inlineTags(html, "Damage");
    const template = inlineTags(html, "Template").map(readTemplate).find(Boolean);
    const plain = htmlToPlainText(html.replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g, "@D").replace(/@Template\[[^\]]*\](?:\{[^}]*\})?/g, "@T")).replace(/\s+/g, " ").trim();
    // (Batch 260, Healing Pulse: "… This restores 5d8 Hit Points to the turtle and each living ally within 10 feet, including creatures normally
    // immune to electricity. The turtle can't use Healing Pulse again for 1 minute and is temporarily immune to the Healing Pulse of any lightning
    // turtle for 1 minute." — itself and its allies around it; once a minute.)
    const allies = tags.length === 1 && /\bhealing\b/i.test(tags[0]) ? /^(?:(?:The )?[^.@]+\. )?(?:This|It|They) (?:restores|heals) @D (?:Hit Points|HP) to (?:the [\w' -]+?|itself|themself) and each (living )?ally within (\d+) feet(?:, including [^.]+)?\.(?: (?:The )?[^.]+? can(?:'t|not) use [^.]+? again for (1|one) minutes?(?: and is temporarily immune to [^.]+? for 1 minute)?\.)?$/i.exec(plain) : null;
    if (allies) {
        const formula = readDamage(tags[0]).replace(/\[healing\]/i, "").replace(/^\((.*)\)$/, "$1");
        return { ...base(item), targeting: { target: null, range: null, area: { type: "emanation", value: Number(allies[2]) } }, trigger: { event: "use", ...(allies[3] ? { recharge: { formula: "10", unit: "rounds" } } : {}) }, resolution: { kind: "healing", native: { healing: { components: [{ id: "0", formula, kinds: ["healing"] }], recipients: "willing" } } }, ...(allies[1] ? { notes: ["Only living allies."] } : {}) };
    }
    if (tags.length !== 1 || !/\bhealing\b/i.test(tags[0]) || !template) return null;
    if (!/(?:^|\.\s)Each creature in an? @T (?:recovers|regains) @D(?: Hit Points| HP)?\.$/i.test(plain.replace(/(?:\s*(?:The )?[^.]+? can(?:'t|not) use [^.]+? again for [^.]+\.)+$/i, ""))) return null;
    const formula = readDamage(tags[0]).replace(/\[healing\]/i, "").replace(/^\((.*)\)$/, "$1");
    return { ...base(item), targeting: { target: null, range: null, area: template }, trigger: { event: "use" }, resolution: { kind: "healing", native: { healing: { components: [{ id: "0", formula, kinds: ["healing"] }], recipients: "any" } } } };
}

// The affliction with that name among its abilities (its "Stage 1"), compiled; null when it has none.
function ownAffliction(item, actor, phrase) {
    const owner = actor ?? item.actor ?? item.parent;
    const source = (owner?.items?.contents ?? owner?.items ?? []).find((other) => {
        if (other === item || !/<strong>\s*Stage\s+1\s*<\/strong>/i.test(other.system?.description?.value ?? "")) return false;
        const name = String(other.name ?? "").toLowerCase();
        return name === phrase || phrase.includes(name) || name.endsWith(` ${phrase}`);
    });
    if (!source) return null;
    try {
        const plan = compileAffliction(source, base(source));
        return plan?.resolution ? plan : null;
    } catch {
        return null;
    }
}

// A bite at a creature it holds as that creature tries to get free (2026-10-12, batch 225): "Trigger A creature Grabbed by the giant monitor
// lizard's jaws fails a check to Escape. Effect The giant monitor lizard's jaws deal 1d6 piercing damage and the triggering creature is exposed
// to monitor lizard venom." (its own affliction's save, the damage on every result), "Trigger A creature Grabbed or Restrained by the
// allosaurus's jaws succeeds at an Escape check Effect As the enemy wriggles away, the allosaurus clamps down with its jagged teeth, dealing 2d6
// slashing damage." → the damage on that creature, with the trigger "escape-failed" or "escaped".
function escapeBite(item, actor) {
    if (item.system?.actionType?.value !== "reaction") return null;
    const html = String(item.system?.description?.value ?? "");
    const tags = inlineTags(html, "Damage");
    const plain = htmlToPlainText(html.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g, "@D")).replace(/\s+/g, " ").trim();
    const split = /^Trigger (.+?)[;.]? Effect (.+)$/.exec(plain);
    const trigger = split ? readReactionTrigger(split[1].trim()) : null;
    if (!["escape-failed", "escaped"].includes(trigger?.event) || tags.length !== 1 || /\bhealing\b/i.test(tags[0])) return null;
    const bite = /^(?:As the (?:enemy|creature|foe) (?:wriggles|squirms|pulls) (?:away|free), )?(?:The )?[^.]+? (?:deals?|dealing) @D damage(?: to (?:the triggering creature|it|them))?(?: and the triggering creature is exposed to ([^.]+?))?\.$/i.exec(split[2].trim());
    if (!bite) return null;
    const rewritten = withDescription(item, `<p><strong>Trigger</strong> ${split[1].trim()}</p><hr /><p><strong>Effect</strong> It deals @Damage[${tags[0]}] damage to the triggering creature.</p>`);
    if (!bite[1]) {
        const plan = automaticEffect(rewritten, actor);
        return plan ? reactionTrigger(rewritten, plan, actor) : null;
    }
    const poison = ownAffliction(item, actor, bite[1].toLowerCase().replace(/^the /, "").replace(/^[\w' -]+?['’]s /, ""));
    if (!poison?.resolution?.outcomes) return null;
    const formula = readDamage(tags[0]);
    if (!formula || /@/.test(formula)) return null;
    for (const row of Object.values(poison.resolution.outcomes)) row.damage = { mode: "formulas", formulas: [{ formula }], rollScope: "target" };
    return {
        ...poison,
        source: base(item).source,
        activation: { time: "reaction", traits: poison.activation?.traits ?? [] },
        targeting: { target: "the attacker", range: "touch", area: null },
        trigger: { ...trigger, reaction: true },
        notes: [...(poison.notes ?? []), `It deals ${formula.replace(/\[(\w+)\]/g, " $1").replace(/[()]/g, "")} damage whatever the save.`]
    };
}

// Cling (2026-10-12, batch 244): "Trigger A creature leaves the swarm's space Effect The swarm takes 1d6 untyped damage as ticks cling to the creature
// and continue biting, dealing 3d6 persistent piercing damage. High winds or immersion in water reduces the DC of the flat check to end this persistent
// damage to 5. Any area damage dealt to the creature destroys these clinging ants." → the persistent damage on the creature leaving its space, as it
// leaves; the swarm's own damage and what ends the bleeding early, notes. null otherwise.
function clingBite(item, actor) {
    if (item.system?.actionType?.value !== "reaction") return null;
    const html = String(item.system?.description?.value ?? "");
    const tags = inlineTags(html, "Damage");
    const plain = htmlToPlainText(html.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g, "@D")).replace(/\s+/g, " ").trim();
    const split = /^Trigger (.+?)[;.]? Effect (.+)$/.exec(plain);
    const trigger = split ? readReactionTrigger(split[1].trim()) : null;
    if (trigger?.event !== "provoke" || trigger.within !== 0 || tags.length !== 2) return null;
    const sentences = split[2].trim().split(/(?<=\.)\s+(?=[A-Z])/);
    if (!/^(?:The )?[\w' -]+? takes @D damage as (?:the )?[\w' -]+? cling to the creature and continue biting, dealing @D(?: damage)?\.$/i.test(sentences[0] ?? "")) return null;
    const notes = [`The swarm takes ${readDamage(tags[0]).replace(/\[(\w+)\]/g, " $1").replace(/[()]/g, "")} damage itself.`];
    for (const sentence of sentences.slice(1)) {
        // (The tick swarm's: "Immersion in water reduces … to 5, and any area damage dealt to the creature destroys these clinging ticks.")
        const lower = /^(High winds or )?immersion in water reduces the DC of the flat check to end this persistent damage to (\d+)(, and any area damage dealt to the creature destroys these clinging [\w' -]+?)?\.$/i.exec(sentence);
        if (lower) notes.push(`${lower[1] ? "High winds or water lower" : "Water lowers"} the flat check to end it to DC ${lower[2]}.`, ...(lower[3] ? ["Area damage on the creature ends it."] : []));
        else if (/^Any area damage dealt to the creature destroys these clinging [\w' -]+?\.$/i.test(sentence)) notes.push("Area damage on the creature ends it.");
        else return null;
    }
    // (Bleed is persistent: "3d6[bleed]" as "3d6[persistent,bleed]".)
    const rewritten = withDescription(item, `<p><strong>Trigger</strong> ${split[1].trim()}</p><hr /><p><strong>Effect</strong> It deals @Damage[${tags[1].replace(/\[bleed\]/i, "[persistent,bleed]")}] damage to the triggering creature.</p>`);
    const plan = automaticEffect(rewritten, actor);
    const triggered = plan ? reactionTrigger(rewritten, plan, actor) : null;
    return triggered ? { ...triggered, notes: [...(triggered.notes ?? []), ...notes] } : null;
}

// A grab on the creature that missed it (2026-10-12, batch 246, Robe Tangle): "Trigger An adjacent creature misses the Iroran mummy with a melee Strike
// Effect The mummy swaps positions with the attacker, and the attacker becomes Grabbed by the mummy's animated sash. The Escape DC is 29, the Force
// Open DC is 27, and a creature can sever the sash by hitting AC 27 and dealing at least 20 slashing damage. The mummy can't use this reaction again
// until they've Interacted to reclaim the sash." → Grabbed on the attacker; the swap, the DCs and the sash, notes. null otherwise.
function grabOnMiss(item, actor) {
    if (item.system?.actionType?.value !== "reaction") return null;
    const html = String(item.system?.description?.value ?? "");
    const plain = htmlToPlainText(html.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const split = /^Trigger (.+?)[;.]? Effect (.+)$/.exec(plain);
    const trigger = split ? readReactionTrigger(split[1].trim()) : null;
    if (trigger?.event !== "hit-by" || !trigger.missed) return null;
    const sentences = split[2].trim().split(/(?<=\.)\s+(?=[A-Z])/);
    if (!/^(?:The )?[^.]+? swaps positions with the attacker, and the attacker becomes Grabbed by (?:the [\w' -]+?['’]s|its|their) [\w' -]+?\.$/i.test(sentences[0] ?? "")) return null;
    const notes = ["It swaps places with the attacker first."];
    for (const sentence of sentences.slice(1)) {
        const dcs = /^The Escape DC is (\d+), the Force Open DC is (\d+), and a creature can sever the ([\w' -]+?) by hitting AC (\d+) and dealing at least (\d+) slashing damage\.$/i.exec(sentence);
        if (dcs) notes.push(`Escape DC ${dcs[1]}, Force Open DC ${dcs[2]}; a hit against AC ${dcs[4]} dealing ${dcs[5]} or more slashing damage cuts the ${dcs[3]}.`);
        else if (/^(?:The )?[^.]+? can(?:'t|not) use this reaction again until (?:it|they)(?:['’]ve| have) Interacted to reclaim the [\w' -]+?\.$/i.test(sentence)) notes.push("It can't use this again until it Interacts to take it back.");
        else return null;
    }
    const rewritten = withDescription(item, `<p><strong>Trigger</strong> ${split[1].trim()}</p><hr /><p><strong>Effect</strong> The attacker becomes @UUID[Compendium.pf2e.conditionitems.Item.kWc1fhmv9LBiTuei]{Grabbed}.</p>`);
    const plan = automaticEffect(rewritten, actor);
    const triggered = plan ? reactionTrigger(rewritten, plan, actor) : null;
    return triggered ? { ...triggered, notes: [...(triggered.notes ?? []), ...notes] } : null;
}

// A save whose failures apply its linked effects (2026-10-12, batch 247, a Battlezoo dragon's flaw-naming curse): a Will save at one creature, a
// weakness of the monster's chosen type on a failure (a longer one on a critical failure), each its own linked effect, then a day's immunity →
// the save, the failure's effect and the critical failure's ("(Critical Failure)"), PF2e's effect items (their choice asked as they're applied).
// null otherwise.
function linkedEffectSave(item, actor) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const links = [...html.matchAll(/@UUID\[(Compendium\.[\w-]+\.(?:bestiary-effects|[\w-]*effects?)\.Item\.[A-Za-z0-9]{16})\]\{([^}]*)\}/g)];
    const checks = inlineTags(html, "Check").map(readCheck).filter((check) => check?.save && check.dc);
    if (links.length !== 2 || checks.length !== 1 || inlineTags(html, "Damage").length) return null;
    const plain = htmlToPlainText(html.replace(/@Check\[[^\]]*\](?:\{[^}]*\})?/g, "@C").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const range = /\ba creature within (\d+) feet\b/i.exec(plain)?.[1];
    if (!range || !/\bThe target must succeed at an? @C save or gain weakness (\d+) to the chosen damage type for 1 minute \(1 day on a critical failure\)\.|\bA failed @C save gives the target weakness (\d+) to that damage type for 1 minute, or for 1 day on a critical failure\./i.test(plain)) return null;
    const critical = links.find((link) => /\(Critical Failure\)/i.test(link[2]));
    const normal = links.find((link) => link !== critical);
    if (!critical || !normal) return null;
    const row = (link) => ({ ...none(), nativeEffects: [{ uuid: link[1], label: link[2].replace(/^Effect:\s*/i, "") }] });
    const immunity = readImmunity(html, [item.name]);
    return {
        ...base(item),
        targeting: { target: "1 creature", range: `${range} feet`, area: null },
        trigger: { event: "use", ...(immunity ? { immunity } : {}) },
        resolution: { kind: "save", check: { roll: "save", statistic: checks[0].statistic, basic: false, against: { dc: "fixed", value: checks[0].dc } }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: none(), failure: row(normal), criticalFailure: row(critical) } },
        notes: ["It picks the damage type; the effect asks as it's applied."]
    };
}

// Concealment wrapped around itself or another (2026-10-12, batch 247, a Battlezoo dragon's rainbow nimbus): a glowing haze on itself or on a creature
// some feet away that hides it for a minute, a reaction it grants, and a day's immunity after → Concealed on the GM's target (itself by default) for
// 1 minute; the light and the target's reaction, notes. null otherwise.
function concealOther(item) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const plain = htmlToPlainText(html.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const around = /^(?:The )?[^.]+? surrounds (?:itself|themselves|themself), or a creature within (\d+) feet, in [^.]+?\. The target becomes Concealed for 1 minute\. They can't use this concealment to Hide or Sneak, as normal for concealment that makes their position obvious\. A creature protected by [^.]+? can use the ([A-Z][\w' -]+?) reaction\. Whether the creature uses this reaction or the effect ends naturally, the creature becomes temporarily immune to [^.]+? for 1 day\.$/i.exec(plain)
        ?? /^(?:The )?[^.]+? cloaks (?:itself|themselves|themself) or another creature up to (\d+) feet away in [^.]+?, which is Concealed for 1 minute(?: and then immune to [^.]+? for 1 day)?\.(?: While it lasts, that creature can use ([A-Z][\w' -]+?)\.)?$/i.exec(plain);
    if (!around) return null;
    const immunity = readImmunity(html, [item.name]);
    const hidden = { damage: none().damage, effects: [{ kind: "condition", slug: "concealed", value: null, duration: readDuration("for 1 minute") }] };
    return {
        ...base(item),
        targeting: { target: `itself or a creature within ${around[1]} feet`, range: `${around[1]} feet`, area: null },
        trigger: { event: "use", ...(immunity ? { immunity } : {}) },
        resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: hidden, failure: none(), criticalFailure: none() } },
        notes: ["It sheds light; the creature can't Hide or Sneak with this concealment.", ...(around[2] ? [`The creature can use ${around[2]} while it lasts.`] : [])]
    };
}

// A line it fires only while its breath recharges (2026-10-12, batch 247, a Battlezoo harvest dragon's seed shot): a requirement that its Breath Weapon is
// recharging, its own healing first, then a basic Reflex save in a line, its breath held back longer → the save (its damage, its area), requires
// "breath-recharging"; the healing and the longer wait, notes. null otherwise.
function breathPauseSave(item, actor) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const plain = htmlToPlainText(html).replace(/\s+/g, " ").trim();
    if (!/^Requirements? (?:The )?[^.]+?['’]s? Breath Weapon is on its \d+d\d+ round recharge and (?:the [\w' -]+?|it) can(?:'t|not) use (?:their|its) Breath Weapon\.? Effect |^Requirements? (?:Its|Their) Breath Weapon is still recharging\.? Effect /i.test(plain)) return null;
    const tags = inlineTags(html, "Damage");
    const heal = tags.find((raw) => /\[healing\]/i.test(raw));
    const hurt = tags.filter((raw) => !/\[healing\]/i.test(raw));
    const template = /@Template\[[^\]]*\]/.exec(html)?.[0];
    const check = inlineTags(html, "Check").map(readCheck).find((entry) => entry?.save && entry.dc);
    if (!heal || hurt.length !== 1 || !template || !check || !/\bcan(?:'t|not) use (?:their|its) Breath Weapon for an additional\b|\bIts Breath Weapon recharges that many rounds later\b/i.test(plain)) return null;
    const plan = inlineSave(withDescription(item, `<p>The creature deals @Damage[${hurt[0]}] damage to creatures in a ${template} (@Check[${check.statistic}|dc:${check.dc}|basic] save).</p>`), actor);
    if (!plan?.resolution?.sharedDamage) return null;
    return { ...plan, requires: "breath-recharging", notes: [...(plan.notes ?? []), `It regains ${readDamage(heal).replace(/\[healing\]/i, "").replace(/^\((.*)\)$/, "$1")} Hit Points first.`, "Its Breath Weapon then waits longer to recharge (the GM rolls the extra rounds)."] };
}

function areaExposure(item, actor) {
    if (item.system?.actionType?.value === "reaction") return exposureReaction(item, actor);
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const template = /@Template\[(?:type:)?(burst|cone|emanation|line)\|distance:(\d+)[^\]]*\]/i.exec(html);
    let plain = htmlToPlainText(html.replace(/@Template\[[^\]]*\](?:\{[^}]*\})?/g, "@T").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\[\[\/(?:r|gmr|br|roll) [^\]]*\]\](?:\{([^}]*)\})?/g, "$1")).replace(/\s+/g, " ").trim()
        .replace(/^Frequency once per (?:round|turn|hour|day) Effect /i, "");
    // (Batch 260: "Creatures within a @T must save against the vaspercham's hallucinatory brine." as exposed; "… releasing a spray of pus in a @T or
    // targeting an individual creature within 30 feet. A creature targeted or in the area is exposed to …" — the area, the one creature instead a
    // note; "… but gains a +2 circumstance bonus to its initial saving throw against the poison." — that first save's DC 2 lower.)
    const extra = [];
    let easier = 0;
    plain = plain.replace(/^((?:[^.@]+\. )?)Creatures within an? @T must (?:attempt a save|save) against ([^.]+?)\.$/i, "$1Each creature within a @T is exposed to $2.")
        // (Batch 263, Yellow Mold: "The triggering creature and all creatures within 10 feet are exposed to yellow mold spores.")
        .replace(/^The triggering creature and all creatures within (?:an? )?@T are exposed to ([^.]+?)\.$/i, "All creatures within a @T are exposed to $1.")
        // (Batch 266, Venomous Spray: "… begins to weep, spraying its venom-filled tears at all creatures within 30 feet. The creatures are immediately
        // exposed to lacridaemon venom. Other lacridaemons are immune to this venom." — the immunity, a note.)
        .replace(/^(?:The )?[^.@]+?, (?:spraying|spewing|showering) [^.@]+? at all creatures within (?:an? )?@T\. The creatures are (?:immediately )?exposed to ([^.]+?)\.( Other [\w' -]+? are immune to this (?:venom|poison|disease)\.)?$/i, (_all, what, immune) => {
            if (immune) extra.push(immune.trim());
            return `All creatures within a @T are exposed to ${what}.`;
        })
        .replace(/^(?:The )?[^.@]+? in an? @T or targeting an individual creature within (\d+) feet\. A creature targeted or in the area is exposed to ([^.]+?)\.$/i, (_all, range, what) => {
            extra.push(`Or, instead of the area, one creature within ${range} feet.`);
            return `Each creature within a @T is exposed to ${what}.`;
        })
        // (Robes of Welcome: "If any creature is cursed by the wraith's void's embrace, the wraith can't impose void's embrace on another creature.")
        .replace(/ If any creature is cursed by (?:the [\w' -]+?['’]s|its|their) ([^,]+?), (?:the [\w' -]+?|it|they) can(?:'t|not) impose \1 on another creature\.$/i, () => {
            extra.push("Not while another creature is cursed by it: one at a time.");
            return "";
        })
        .replace(/ but gains an? \+(\d+) circumstance bonus to (?:its|their) initial saving throw against the (?:poison|disease|affliction)\.$/i, (_all, bonus) => {
            easier = Number(bonus);
            extra.push(`Each creature's first save against it has a +${bonus} circumstance bonus (its DC here is ${bonus} lower).`);
            return ".";
        });
    const wait = String.raw`(?: (?:The )?[^.]+? can(?:'t|not) (?:use )?(?:its |their )?[\w' -]+? again for (\d+d\d+|\d+) rounds?\.)?`;
    const gas = new RegExp(String.raw`^(?:The )?[^.]+? (?:exhales|emits|breathes out|sprays) (?:a cloud of )?(?:poisonous|toxic|noxious) gas in an? @T(?: centered on (?:the corner of )?one of (?:the [\w' -]+?['’]s|its|their) squares)?\. The gas persists (?:for 1 round|until the start of (?:the [\w' -]+?['’]s|its|their) next turn)\. Any creature in the area \(or that later enters the area\) is exposed to ([^.]+?)\.${wait}$`, "i").exec(plain);
    const area = gas ? null : new RegExp(String.raw`^(?:[^.@]+\. )?(?:Each|Every|All)(?: living)? creatures? (?:with)?in an? @T (?:is|are) exposed to ([^.]+?)\.${wait}$`, "i").exec(plain);
    // (Batch 230, Scratch: "The goblin dog vigorously scratches itself, exposing all adjacent creatures to goblin pox." — the creatures beside it.)
    const beside = gas || area ? null : /^(?:The )?[^.]+?, exposing all adjacent creatures to ([^.]+?)\.$/i.exec(plain)
        // (Batch 245, Wing Flurry: "…, exposing all creatures within a @Template[burst|distance:10] to crying cicada poison." — around itself.)
        ?? (template ? /^(?:The )?[^.]+?, exposing all creatures within an? @T to ([^.]+?)\.$/i.exec(plain) : null);
    if (beside) {
        const poison = ownAffliction(item, actor, beside[1].toLowerCase().replace(/^the /, "").replace(/^[\w' -]+?['’]s /, ""));
        const radius = /\bwithin an? @T\b/i.test(plain) ? Number(template[2]) : 5;
        return poison ? { ...poison, source: base(item).source, activation: { time: String(Number(item.system?.actions?.value) || 1), traits: poison.activation?.traits ?? [] }, targeting: { target: null, range: null, area: { type: "emanation", value: radius } }, trigger: { event: "use" } } : null;
    }
    const oneFirst = gas || area ? null : /^(?:The )?[^.]+? (?:an adjacent|a) (?:living )?creature(?: (?:that(?:'s| is)|who is) ([^,]+?))?, exposing (?:it|them) to ([^.]+?)\.$/i.exec(plain);
    const one = gas || area ? null : oneFirst
        ?? /^(?:The )?[^.]+? (?:on|at) a single creature within (\d+) feet\. The target is exposed to ([^.]+?)\.$/i.exec(plain)
        // (Batch 260, Kiss of Rime: "A shard of magic ice embeds itself within the flesh of a creature within 30 feet. The creature must save against the
        // curse of the frozen heart.")
        ?? /^(?:An? |The )?[^.]+? (?:of|on|at|into) a creature within (\d+) feet\. The (?:creature|target) must save against ([^.]+?)\.$/i.exec(plain);
    if (!gas && !area && !one) return null;
    if ((gas || area) && !template) return null;
    const phrase = (gas?.[1] ?? area?.[1] ?? one[2]).toLowerCase().replace(/^the /, "").replace(/^[\w' -]+?['’]s /, "");
    const owner = actor ?? item.actor ?? item.parent;
    const source = (owner?.items?.contents ?? owner?.items ?? []).find((other) => {
        if (other === item || !/<strong>\s*Stage\s+1\s*<\/strong>/i.test(other.system?.description?.value ?? "")) return false;
        const name = String(other.name ?? "").toLowerCase();
        return name === phrase || phrase.includes(name) || name.endsWith(` ${phrase}`);
    });
    // (Batch 260, Mindwarping Tide: its own save by that name, not an affliction — "Hallucinatory Brine", a save on a Strike's hit: that save at each
    // creature in the area.)
    if (!source && area) {
        const named = (owner?.items?.contents ?? owner?.items ?? []).find((other) => other !== item && String(other.name ?? "").toLowerCase() === phrase);
        let plan = null;
        try {
            plan = named ? compileMonsterAbility(named, { actor: owner }) : null;
        } catch {
            plan = null;
        }
        if (plan?.resolution?.kind !== "save" || plan.resolution.sharedDamage) return null;
        return { ...plan, source: base(item).source, activation: { time: String(Number(item.system?.actions?.value) || 1), traits: plan.activation?.traits ?? [] }, targeting: { target: null, range: null, area: { type: template[1].toLowerCase(), value: Number(template[2]) } }, trigger: { event: "use" }, ...(extra.length ? { notes: [...(plan.notes ?? []), ...extra] } : {}) };
    }
    if (!source) return null;
    let poison = null;
    try {
        poison = compileAffliction(source, base(source));
    } catch {
        poison = null;
    }
    if (!poison?.resolution) return null;
    const recharge = gas?.[2] ?? area?.[2] ?? null;
    // (Only at a creature in that state: "that is Paralyzed or Unconscious", "that's asleep, Paralyzed, or Unconscious".)
    const states = oneFirst?.[1] ? oneFirst[1].toLowerCase().split(/,? or |, /).map((state) => state.trim()).filter(Boolean) : [];
    const foe = states.length ? { within: 5, conditions: [...new Set(states.map((state) => (state === "unconscious" || state === "asleep" ? "dying" : state)).filter((state) => ["paralyzed", "dying", "restrained", "grabbed", "prone"].includes(state)))] } : null;
    if (states.length && !foe.conditions.length) return null;
    return {
        ...poison,
        source: base(item).source,
        activation: { time: String(Number(item.system?.actions?.value) || 1), traits: poison.activation?.traits ?? [] },
        targeting: gas || area ? { target: null, range: null, area: { type: template[1].toLowerCase(), value: Number(template[2]) } } : { target: "1 creature", range: one[1] && /^\d+$/.test(one[1]) ? Number(one[1]) : "touch", area: null },
        trigger: { event: "use", ...(recharge ? { recharge: { formula: recharge, unit: "rounds" } } : {}) },
        ...(foe ? { requiresFoe: foe } : {}),
        ...(easier && poison.resolution?.check?.against?.dc === "fixed" ? { resolution: { ...poison.resolution, check: { ...poison.resolution.check, against: { ...poison.resolution.check.against, value: poison.resolution.check.against.value - easier } } } } : {}),
        ...(gas || extra.length ? { notes: [...(poison.notes ?? []), ...(gas ? ["The gas lingers: a creature that enters the area then is exposed too."] : []), ...extra] } : {})
    };
}

function poisonWeapon(item, actor) {
    if (item.system?.actionType?.value !== "action") return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    // (Batch 266, the vishkanya's Envenom: "Frequency once per day Effect Using either saliva or blood, the vishkanya applies vishkanyan venom to one
    // weapon they're holding. To use their blood, they must be injured, or they can deal themself 1 slashing damage as part of the action." — its
    // frequency PF2e's; the blood, a note.)
    const blood = [];
    const said = plain.replace(/^Requirements? (?:The )?[^.]+? is (?:wielding|holding) a piercing or slashing weapon(?: and has a free hand)?\.? Effect /i, "").replace(/^Frequency [^.]+?\.? Effect /i, "")
        .replace(/\s+To use (?:its|their) blood, [^.]+\.$/i, (sentence) => {
            blood.push(sentence.trim().replace(/@Damage\[\(?([^\[\]()]+?)\)?\[(\w+)\]\](?:\{[^}]*\})?/g, "$1 $2"));
            return "";
        });
    const [first, ...rest] = said.split(/(?<=\.)\s+(?=[A-Z])/);
    // ("applies a poison to the weapon", "applies one of their black adder venom poisons to their wielded weapon", "draws a poison and
    // applies it to a weapon", "Interacts to draw an injury poison and applies the poison to the required weapon".)
    // (Batch 55, Envenom Weapon: "The seugathi applies their seugathi venom to one weapon they wield", "applies their innate seugathi venom
    // to their longsword": its own venom, the ability by that name.)
    // (Batch 229, Battlezoo: "secretes its <name> poison onto its weapon", "…, the <creature> applies a dose of <affliction> to their weapon".)
    const venom = /^(?:The )?[^.]+? applies (?:its|their|his|her) (?:innate )?([\w' -]+? venom) to (?:one weapon (?:it|they|he|she) wields?|(?:its|their|his|her) [\w' -]+?)\.$/i.exec(first ?? "")
        ?? /^(?:The )?[^.]+? (?:secretes|smears) (?:its|their) ([\w' -]+? (?:poison|venom)) onto (?:its|their) (?:weapons?|blade)\.$/i.exec(first ?? "")
        ?? /^(?:[^,.]+, )?(?:the )?[^.]+? applies a dose of ([\w' -]+?) to (?:its|their|his|her) (?:weapons?|blade)\.$/i.exec(first ?? "")
        ?? /^(?:[^,.]+, )?(?:the )?[^.]+? applies ([\w' -]+? venom) to one weapon (?:it|they|he|she)(?:['’]re| are|['’]s| is) holding\.$/i.exec(first ?? "");
    if (venom && !rest.length) {
        const own = ownVenom(item, actor, venom[1]);
        return own && blood.length ? { ...own, notes: blood } : own;
    }
    if (!/^(?:The )?[^.]+? (?:appl(?:y|ies|ied) (?:a |the |one of [^.]*? )?poisons? to|draws a poison and applies it to|Interacts to draw an injury poison and applies the poison to) (?:the|a|its|their|his|her) (?:piercing or slashing |required |wielded )?(?:weapon|dagger)(?: of (?:its|their|his|her) choice)?\.$/i.test(first ?? "")) return null;
    // (Its other words: the next hit that deals damage, drawing it with a free hand, a critical failure wasting it.)
    if (rest.some((sentence) => !/^If (?:(?:its|their|his|her) next attack with that weapon(?: before the end of (?:its|their|his|her) next turn)? hits and deals damage, (?:the target is afflicted with the poison|it applies the effects? of the poison)|(?:it|they|he|she) has a free hand, (?:it|they|he|she) can Interact to draw a poison as part of the action|(?:it|they|he|she) critically fails? the attack roll, the poison is wasted)\.$/i.test(sentence))) return null;
    const owner = actor ?? item.actor ?? item.parent;
    const carried = (owner?.items?.contents ?? owner?.items ?? []).filter((other) => other.type === "consumable" && (other.system?.traits?.value ?? []).includes("poison") && /<strong>\s*Stage\s+1\s*<\/strong>/i.test(other.system?.description?.value ?? ""));
    const injury = carried.filter((other) => (other.system?.traits?.value ?? []).includes("injury"));
    const best = [...(injury.length ? injury : carried)].sort((a, b) => (Number(b.system?.level?.value) || 0) - (Number(a.system?.level?.value) || 0))[0];
    if (!best) return null;
    let plan = null;
    try {
        plan = compileAffliction(best, base(best));
    } catch {
        plan = null;
    }
    if (!plan?.resolution) return null;
    return { builtin: "poison-weapon", actions: Number(item.system?.actions?.value) || 1, poison: { name: best.name, uuid: best.uuid ?? null, plan }, doses: Number(best.system?.quantity) || 1 };
}

// Focus Gaze (2026-10-10, batch 39): "The medusa fixes their glare at a creature they can see within 30 feet. The target must
// immediately attempt a … save against the medusa's petrifying gaze. If the creature was already Slowed …, a failed save causes it to
// be Petrified permanently. After attempting its save, the creature is then temporarily immune …": the gaze it names (its own
// ability, compiled) as a save for that one creature now; the rest of the text for the GM. null when the creature has no such
// ability, or it reads as no save.
function focusGaze(item, actor, basicActions) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const plain = htmlToPlainText(html.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    // (Batch 263: "The sacristans stare at a creature …", plural.)
    if (!/\b(?:stares?|fixes (?:its|their|his|her) (?:glare|gaze|[\w' -]+? eyes)|glares|focuses (?:its|their|his|her) (?:[\w-]+ )?gaze) (?:at|on|upon) (?:a|one) (?:single )?(?:creature|target)\b/i.test(plain)) return null;
    const named = /\bmust (?:immediately )?attempt an? (?:@Check\[[^\]]*\](?:\{[^}]*\})?|Fortitude|Reflex|Will) save against (?:the [\w' -]+?['’]s |[A-Z][\w'-]+(?: [A-Z][\w'-]+)?['’]s )?(?:the )?([\w' -]+?)(?: aura)?\./i.exec(plain);
    const owner = actor ?? item.actor ?? item.parent;
    const wanted = named?.[1]?.trim().toLowerCase();
    const source = wanted ? (owner?.items?.contents ?? owner?.items ?? []).find((other) => other !== item && other.type === "action" && String(other.name).toLowerCase() === wanted) : null;
    if (!source) return null;
    let gaze = null;
    try {
        gaze = compileMonsterAbility(source, { basicActions, actor: owner });
    } catch {
        gaze = null;
    }
    const range = Number(/\bwithin (\d+) feet\b/i.exec(plain)?.[1]) || 30;
    // (Batch 266, Consume Death: the gaze an aura, with its save's DC; the results written here, by degree — this text with that save in it.)
    const auraCheck = !gaze?.resolution && /<strong>\s*(?:Critical )?(?:Success|Failure)\s*<\/strong>/i.test(html) ? inlineTags(String(source.system?.description?.value ?? ""), "Check").map(readCheck).find((check) => check?.save && check.dc) : null;
    if (auraCheck) {
        const said = new RegExp(`attempt an? (?:Fortitude|Reflex|Will) save against ${named[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`, "i");
        if (!said.test(html)) return null;
        let own = null;
        try {
            own = compileMonsterAbility({ ...item, system: { ...item.system, description: { value: html.replace(said, `attempt a @Check[${auraCheck.statistic}|dc:${auraCheck.dc}] save.`) } } }, { basicActions, actor: owner, trailing: true });
        } catch {
            own = null;
        }
        if (!own?.resolution || own.resolution.check?.roll !== "save") return null;
        // (Its failure's later sentences, notes — the drain that grows, its temporary Hit Points; "As failure, but … increases the amount of drain
        // by 2": that much on a critical failure.)
        const degree = (label) => htmlToPlainText((new RegExp(`<strong>\\s*${label}\\s*<\\/strong>([\\s\\S]*?)(?:<\\/p>|$)`, "i").exec(html)?.[1] ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
        const later = degree("Failure").split(/(?<=\.)\s+(?=[A-Z])/).slice(1);
        const worse = /^As failure, but the creature increases the (?:amount|value) of (?:drain|the drained condition) by (\d+)\.$/i.exec(degree("Critical Failure"));
        if (worse) for (const effect of own.resolution.outcomes?.criticalFailure?.effects ?? []) if (effect.kind === "condition" && effect.slug === "drained") effect.value = Number(worse[1]);
        return { ...own, ...base(item), targeting: { target: "1 creature", range: `${range} feet`, area: null }, trigger: { event: "use" }, ...(later.length ? { notes: [...(own.notes ?? []), ...later.map((sentence) => readableText(sentence))] } : {}) };
    }
    if (!gaze?.resolution || gaze.resolution.check?.roll !== "save") return null;
    // (Its other sentences, past the save: the GM's.)
    const after = plain.slice(plain.indexOf(named[0]) + named[0].length).trim();
    const reminders = after ? after.split(/(?<=\.)\s+(?=[A-Z])/).map((sentence) => readableText(sentence)) : [];
    return {
        ...gaze,
        ...base(item),
        targeting: { target: "1 creature", range: `${range} feet`, area: null },
        trigger: { event: "use" },
        resolution: { ...gaze.resolution, ...(reminders.length ? { reminders: [...(gaze.resolution.reminders ?? []), ...reminders] } : {}) }
    };
}

// What a follow-up needs of the action before it (batch 36): { strike, melee, on } (on: the Strike's degrees), or null. "The
// skull fairy's last action was a successful fist Strike", "… previous action this turn was …", "a success with a jaws Strike",
// "a critical hit with a melee Strike", "a melee Strike that critically succeeded", "a fang Strike that hit the target", "a jaws
// Strike that dealt damage to its target", "a club Strike that missed", "a hit against an adjacent creature with its tendril
// Strike"; "X damaged a creature with a jaws Strike on its last action", "hit a creature with a drill Strike with his previous
// action", "made a successful Strike against a living creature with its touch on its previous action" (made-up names). Not with
// more it needs (", and the target is adjacent to a wall", "or a Draconic Frenzy …", a size, the weapon's damage type).
// (Batch 230: "its most recent action this turn".)
const LAST_ACTION = String.raw`(?:last|previous|most recent) (?:action|attack)(?: this turn)?`;
const STRUCK_ONE = String.raw`(?:the|a|an|its|their|his|her) (?:living )?(?:target|creature|opponent|foe|enemy)(?: creature)?`;
const HIT_DEGREES = ["success", "criticalSuccess"];
export function followUpNeed(need) {
    const name = (melee, raw) => ({ melee: /^melee$/i.test(melee ?? ""), strike: raw && !/^(?:melee|ranged|weapon|unarmed)$/i.test(raw.trim()) ? raw.trim().toLowerCase() : null });
    // ("…, and the target is adjacent to …", "or a Draconic Frenzy that included …": more it needs. Another way to qualify, "a
    // successful bite Strike or Test Lunge" (made up), leaves the Strike's.)
    const text = need.replace(/[.;]\s*$/, "").trim().replace(/( Strike) or (?!an?\b)[A-Z][\w' -]*$/, "$1")
        // (Batch 64: "a successful Strike with a melee unarmed attack or a Draconic Frenzy that included one": the single Strike's.)
        .replace(/ or a Draconic Frenzy that included a successful Strike with a melee unarmed attack$/i, "")
        .replace(/\ba successful Strike with a melee unarmed attack$/i, "a successful melee Strike");
    if (/,|\bor (?:a|an)\b|\b(?:of size|larger|smaller|Tiny|Small|Medium|Large|Huge|Gargantuan|weapon that)\b/i.test(text)) return null;
    // (Batch 260, Mind-Rending Sting: "The thulgant hits the same enemy with two consecutive sting Strikes in the same round" — after its second hit in a
    // row on that creature: twice.)
    const twice = /^(?:The |the )?[^,]*? hits the same (?:enemy|creature|target|foe) with two consecutive (?:(melee|ranged) )?([\w' -]+?) Strikes in the same (?:round|turn)$/i.exec(text);
    if (twice) return { ...name(twice[1], twice[2]), on: HIT_DEGREES, twice: true };
    let match = new RegExp(String.raw`^(?:The |the )?[^,]*? ${LAST_ACTION} was (.+)$`, "i").exec(text);
    if (match) {
        const rest = match[1];
        // "a success with a Strike that has Disarm in its damage entry": a Strike listing it.
        if ((match = /^a success with a Strike that (?:has|lists) ([A-Z][a-z]+) in its damage entry$/.exec(rest))) return { strike: null, melee: false, on: HIT_DEGREES, listing: match[1].toLowerCase() };
        // (What the creature hit has or is, "against a creature with teeth", "… that is standing in water" (made up): the GM's.)
        const tail = String.raw`(?: (?:against|to) ${STRUCK_ONE}(?: within \d+ feet| (?:with|that|who) [^,]+?)?)?(?: that (?:dealt damage|damaged)(?: (?:to )?${STRUCK_ONE})?)?`;
        if ((match = new RegExp(String.raw`^an? (successful|success with an?|critical hit with an?|critical success (?:on|with) an?) (?:(melee|ranged) )?(?:([\w' -]+?) )??Strike(?: with (?:its|their|his|her) ([\w' -]+?))?${tail}$`, "i").exec(rest))) return { ...name(match[2], match[3] ?? match[4]), on: /critical/i.test(match[1]) ? ["criticalSuccess"] : HIT_DEGREES };
        if ((match = new RegExp(String.raw`^an? (?:(melee|ranged) )?(?:([\w' -]+?) )??Strike that (hit|dealt damage|damaged|critically succeeded|missed|failed or critically failed)(?: (?:to )?${STRUCK_ONE})?$`, "i").exec(rest))) return { ...name(match[1], match[2]), on: /critically succeeded/i.test(match[3]) ? ["criticalSuccess"] : /missed|failed/i.test(match[3]) ? ["failure", "criticalFailure"] : HIT_DEGREES };
        if ((match = new RegExp(String.raw`^a hit against an? (?:adjacent )?(?:creature|target|foe|enemy) with (?:its|their|his|her) (?:(melee) )?(?:([\w' -]+?) )??Strike$`, "i").exec(rest))) return { ...name(match[1], match[2]), on: HIT_DEGREES };
        return null;
    }
    match = new RegExp(String.raw`^(?:The |the )?[^,]*? (hit|damaged|struck|critically hit|made a successful Strike against) an? (?:living )?(?:creature|target|foe|enemy)(?: it is duplicating)? with (?:an?|its|their|his|her) (?:(melee) )?(?:([\w' -]+?) )??(?:Strike )?(?:on|in|during|with) (?:its|their|his|her) ${LAST_ACTION}$`, "i").exec(text)
        // (Batch 251, Calcifying Cloud: "The kadamel hit with a stone axe Strike during its most recent action" — no creature named.)
        ?? new RegExp(String.raw`^(?:The |the )?[^,]*? (hit|critically hit) with (?:an?|its|their|his|her) (?:(melee) )?(?:([\w' -]+?) )??Strike (?:on|in|during) (?:its|their|his|her) ${LAST_ACTION}$`, "i").exec(text);
    return match ? { ...name(match[2], match[3]), on: /critically/i.test(match[1]) ? ["criticalSuccess"] : HIT_DEGREES } : null;
}

// A follow-up's results with no roll of their own (batch 36), sentence by sentence: damage to the creature hit ("automatically
// deals an additional 2d8 bludgeoning damage to the creature it just bit", "…, inflicting 1d6 bleed to the target", "…, dealing an
// additional 1d6+5 slashing damage", "the Strike's target takes 2d6 persistent bleed damage", "This deals 2d4 bleed damage"), its
// conditions ("making the creature Enfeebled 2 (or Enfeebled 3 on a critical hit)", "The victim becomes Drained 1", "Grabs it"),
// a push or a pull ("pushes his foe back 5 feet, with the effects of a successful Shove", "pulls the creature 5 feet closer"), a
// Disarm's critical success, the monster's own healing ("the flea regains 5 HP"). (Made-up wordings.) → a plan of roll
// "automatic" (its success row), or one by the Strike's degree when a critical hit gives more. A first sentence with none of
// these describes it; later ones go to the GM. null when a sentence has a check, a choice, a Strike or damage it doesn't read.
const FOLLOW_STRUCK = String.raw`(?:the (?:creature|target|victim|foe|enemy)(?: (?:it|they|he|she) (?:just )?(?:bit|hit|struck|has struck))?|the creature struck|its (?:target|victim|foe)|that creature|the Strike's target|his foe|her foe|their foe)`;
export function followUpResults(item, html) {
    const components = [];
    const effects = [];
    const reminders = [];
    let critical = null;
    let movement = null;
    let read = false;
    for (const [index, sentence] of sentencesOf(html).entries()) {
        // ("[[/r 1d6[persistent,bleed]]]" as "@Damage[1d6[persistent,bleed]]".)
        const text = sentence.replace(/\[\[\/r ((?:[^[\]]|\[[^\]]*\])+?)(?: #[^\]]*)?\]\](?:\{[^}]*\})?/g, "@Damage[$1]");
        const plain = htmlToPlainText(text.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g, "@D")).replace(/\s+/g, " ").trim();
        if (!plain || /^Effect:/i.test(plain)) continue;
        // (A check, a Strike it makes: not this reading. "the Strike's target" is the creature hit. An Escape's DC, "([[/act escape
        // dc=42]])", goes with the grab.)
        // (Batch 230, Poison Tooth: after its results, how to take out what it left in the wound — "Removing the tooth safely requires a successful
        // Medicine check …" — the GM's.)
        if (read && /(?:^|\.\s+)Removing (?:the|a|an) [\w' -]+? (?:safely )?requires a successful (?:@Check\[(?:type:)?medicine\b|DC \d+ Medicine\b)/i.test(plain) && !/@D/.test(plain)) {
            reminders.push(readableText(sentence.replace(/@Check\[(?:type:)?(\w+)\|dc:(\d+)[^\]]*\](?:\{[^}]*\})?/i, (_all, skill, dc) => `DC ${dc} ${skill[0].toUpperCase()}${skill.slice(1)}`)));
            continue;
        }
        if (/@Check\[|\[\[\/act (?!escape\b)|\b(?:makes?|attempts?|making) (?:a|an|another|one|two|a second)\b[^.]*\bStrikes?\b|\bStrikes (?:the|a|an|it)\b|\b(?:save|saving throw|check)\b/i.test(plain)) return null;
        const choice = /\b(?:chooses?|choice|choosing|either)\b/i.test(plain);
        const tags = inlineTags(text, "Damage");
        const hurt = tags.filter((raw) => !/\bhealing\b/i.test(raw));
        const healing = tags.filter((raw) => /\bhealing\b/i.test(raw));
        let found = false;
        if (hurt.length) {
            const dealt = new RegExp(String.raw`\b(?:automatically )?(?:deals?|dealing|inflicting|inflicts?) (?:an? (?:additional|extra) )?@D(?: damage)?(?: (?:to|on) ${FOLLOW_STRUCK})?(?=[,.;]|$| and\b)`, "i").test(plain)
                || new RegExp(String.raw`(?:^|; )${FOLLOW_STRUCK} takes @D(?: damage)?\b`, "i").test(plain) || /^This deals @D(?: damage)?\b/i.test(plain);
            if (hurt.length !== 1 || !dealt || choice || /\b(?:if|unless|instead)\b|@D[^.]*?\bor @D/i.test(plain)) return null;
            components.push(readDamage(hurt[0]));
            found = true;
        }
        // Its own healing: "the flea regains 5 HP", "The void zombie regains 4 Hit Points".
        if (healing.length) {
            if (healing.length !== 1 || !/\b(?:regains?|recovers?) @D (?:Hit Points|HP)\b/i.test(plain) || choice || /\b(?:if|unless|instead)\b/i.test(plain)) return null;
            const amount = readDamage(healing[0]).replace(/\[healing(?:,[a-z]+)?\]/i, "").replace(/^\((.*)\)$/, "$1");
            effects.push({ kind: "heal", ...(/^\d+$/.test(amount) ? { amount: Number(amount) } : { formula: amount }), recipient: "self" });
            found = true;
        }
        // A push or a pull ("with the effects of a successful Shove": pushed back; its following move is the GM's).
        const moved = readPush(plain.replace(/\bpush(es)? (?:his|her|its|their|the) (?:foe|enemy|target|creature) back\b/i, "push$1 the target back"));
        if (moved && /\b(?:push|pull|knock)/i.test(plain) && !choice) {
            if (movement) return null;
            movement = moved;
            found = true;
        }
        // "Disarms the creature they hit, as a critical success on a Disarm attempt", "knocks a held or carried weapon to the ground".
        if (/\bDisarms (?:the (?:creature|target)|it)(?: (?:they|it|he|she) hit)?,? as (?:a )?critical success on a Disarm (?:attempt|check)\b|\bknocks? an? (?:held or carried |held )?weapon (?:to the ground|out of (?:its|their|the target's) (?:hands?|grasp))\b/i.test(plain) && !choice) {
            effects.push({ kind: "disarm", what: "drop" });
            found = true;
        }
        // Its conditions on the creature hit; "(or Enfeebled 3 on a critical hit)": a critical hit's.
        const bracket = /\s*\((?:or )?((?:[A-Z][a-z]+ \d+(?:,? (?:and|or) )?)+) on a critical hit\)/.exec(plain);
        const named = readConditions(text.replace(/\s*\((?:or )?(?:@UUID\[[^\]]*\]\{)?[A-Z][a-z]+ \d+\}? on a critical hit\)/g, ""), { plain: STAGE_CONDITIONS }).filter((entry) => entry.recipient !== "self" && STAGE_CONDITIONS.includes(entry.slug));
        const grabs = /\bGrabs (?:it|them|the (?:creature|target|victim))\b/i.test(plain) && !named.some((entry) => entry.slug === "grabbed") ? [condition("grabbed")] : [];
        // (Named again later, "This is cumulative with other enfeebled conditions …", "The encumbered condition … disappears
        // after 10 minutes": the GM's.)
        const again = read && [...named, ...grabs].every((entry) => effects.some((other) => other.slug === entry.slug));
        if ((named.length || grabs.length) && !again && !choice) {
            // ("… is Drained 1 until it receives healing of any kind or amount": until healed, the GM's.)
            const untilHealed = /\buntil (?:it|they|the creature|the target) receives? (?:healing|any (?:kind or amount of )?healing)\b/i.test(plain);
            if (/\b(?:if|unless|instead)\b/i.test(plain.replace(/\((?:or )?[^()]* on a critical hit\)/, "")) && !untilHealed) return null;
            const conditions = named.map((entry) => condition(entry.slug, entry.value ?? null, untilHealed ? null : entry.duration ?? null));
            effects.push(...conditions, ...grabs);
            if (untilHealed) reminders.push(`{target}'s ${named.map((entry) => entry.slug).join(" and ")} lasts until it receives healing of any kind or amount.`);
            if (bracket) critical = readConditions(bracket[1], { plain: STAGE_CONDITIONS }).map((entry) => condition(entry.slug, entry.value ?? null, entry.duration ?? null));
            found = true;
        }
        if (found) {
            read = true;
            // More in it than its results ("… and its resistances are 5 lower for 1 round …" (made up)): the sentence for the GM.
            if (/\b(?:resistances?|weakness|penalty|bonus|can't|cannot|Speeds?|immune|as long as)\b/i.test(plain)) reminders.push(readableText(sentence));
            continue;
        }
        // (Before its results: what it does, in words. "He can follow the foe as normal for a successful shove": the GM's.)
        if (!read && index === 0 && !/@D|\b(?:damage|bonus|penalty|Hit Points|HP)\b/i.test(plain)) continue;
        if (/\bcan follow the (?:foe|target|creature) as normal\b|\bInteracts? to (?:return|retrieve)\b/i.test(plain)) continue;
        if (!read) return null;
        reminders.push(readableText(sentence));
    }
    if (!read || (!components.length && !effects.length && !movement)) return null;
    const row = (conditions) => ({
        damage: components.length ? { mode: "formulas", formulas: components.map((formula) => ({ formula })), rollScope: "outcome" } : none().damage,
        effects: conditions,
        ...(movement ? { forcedMovement: { ...movement } } : {})
    });
    // A critical hit's conditions in place of the hit's of the same name.
    const criticalRow = critical ? row([...effects.filter((entry) => !critical.some((other) => other.slug === entry.slug)), ...critical]) : null;
    return {
        ...base(item),
        targeting: { target: "the creature the Strike hits", range: "touch", area: null },
        trigger: { event: "use" },
        resolution: {
            kind: "check",
            check: criticalRow ? { roll: "skill", statistic: "strike", against: { dc: "target", statistic: "ac" } } : { roll: "automatic", statistic: "automatic" },
            sharedDamage: null,
            outcomes: { criticalSuccess: criticalRow ?? none(), success: row(effects), failure: none(), criticalFailure: none() },
            ...(reminders.length ? { reminders } : {})
        }
    };
}

// A skill action after the hit (batch 36): "The larabay attempts to Disarm the creature they hit", "… attempts to Reposition the
// creature they hit using their halberd's reach"; with
// "They gain a +4 status bonus to the Athletics check" (its bonus, on the plan's check) and "This attempt neither applies nor
// counts toward the …'s multiple attack penalty". PF2e's basic action, as the creature's. null otherwise.
const FOLLOW_SKILLS = ["disarm", "reposition", "shove", "trip", "grapple", "demoralize"];
export function followUpSkill(item, html, basicActions) {
    const sentences = sentencesOf(String(html).replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\[\[\/act ([\w-]+)[^\]]*\]\](?:\{([^}]*)\})?/g, (_all, slug, label) => label ?? slug.replace(/^\w/, (letter) => letter.toUpperCase()))).map((sentence) => htmlToPlainText(sentence).replace(/\s+/g, " ").trim()).filter(Boolean);
    let slug = null;
    let bonus = null;
    let noMap = false;
    const reminders = [];
    for (const sentence of sentences) {
        let match;
        // (Batch 69: "makes an Intimidate check to Demoralize the target creature", "attempts an Athletics check to Grapple the target",
        // "… the creature with a mere look".)
        if (!slug && (match = /^(?:The )?[\w' -]+? (?:[a-z]+s [^.,]*? and )?(?:attempts to|(?:makes|attempts) an? (?:Intimidat(?:e|ion)|Athletics) check to) (Disarm|Reposition|Shove|Trip|Grapple|Demoralize) (?:the (?:target creature|creature|target|foe)(?: (?:they|it|he|she) hit)?(?: using (?:their|its|his|her) [\w' -]+?'s reach)?|it|an object the creature (?:they|it|he|she) hit is holding|the target of (?:their|its|his|her) (?:[\w' -]+? )?Strike(?: or Disarm)?|the creature (?:they|it|he|she) struck(?: or disarmed)?)(?: with a (?:sudden|mere) [a-z]+)?(?:,? even if (?:the [\w' -]+?|it|they) (?:doesn't|does not) have a free hand)?(, using (?:their|its|his|her) spell attack modifier instead of Athletics|, with (?:their|its|his|her) spell attack modifier as the bonus)?\.$/i.exec(sentence))) {
            slug = match[1].toLowerCase();
            // (Batch 252, a Battlezoo ghost's Shove: its spell attack modifier in place of Athletics — a note for the GM's roll.)
            if (match[2]) reminders.push("It uses its spell attack modifier for this check instead of Athletics.");
        }
        else if (slug && (match = /^(?:They|It|He|She) gains? a \+(\d+) (status|circumstance) bonus (?:on|to) the (?:Athletics|Intimidation) check\.$/i.exec(sentence))) bonus = { value: Number(match[1]), type: match[2].toLowerCase() };
        else if (slug && /^This attempt (?:neither applies nor counts toward|doesn't (?:apply|count toward)|does not (?:apply|count toward)) (?:the [\w' -]+?'s|its|their|his|her) multiple attack penalty\.$/i.test(sentence)) noMap = true;
        // (What follows the move, "If the target ends its movement adjacent to an obstacle …": the GM's.)
        else if (slug && /^If the target ends its movement\b/i.test(sentence)) reminders.push(readableText(sentence).replace(/\bthe target\b/gi, "{target}"));
        // (Batch 69: a Demoralize after a hit that downed its target, "If the target creature was reduced to 0 Hit Points by the
        // triggering Strike, … can instead Demoralize all opponents within 30 feet …", and "… doesn't take a penalty to these
        // Intimidation checks for not speaking a target's language": the GM's.)
        else if (slug === "demoralize" && (/^If the target(?: creature)? was reduced to 0 Hit Points by the triggering Strike, [^.]*? can instead (?:attempt to )?Demoralize all (?:opponents|enemies|foes) within \d+ feet\b[^.]*\.$/i.test(sentence) || /^(?:The )?[\w' -]+? (?:doesn't|does not) take a penalty to (?:these|this|the) Intimidation checks? for not speaking (?:a|the) target's language\.$/i.test(sentence))) reminders.push(readableText(sentence));
        else return null;
    }
    const basic = slug && FOLLOW_SKILLS.includes(slug) ? basicActions[slug] : null;
    if (!basic?.resolution) return null;
    const plan = structuredClone(basic);
    if (bonus) plan.resolution.check = { ...plan.resolution.check, bonus };
    if (reminders.length) plan.resolution.reminders = [...(plan.resolution.reminders ?? []), ...reminders];
    // (Its attack trait, for the multiple attack penalty, unless it "neither applies nor counts toward" it.)
    const traits = [...new Set([...(noMap ? [] : plan.traits ?? []), ...(item.system?.traits?.value ?? [])])].filter((trait) => !noMap || trait !== "attack");
    return { ...plan, ...base(item, { traits }), targeting: { ...plan.targeting, target: "the creature the Strike hits" }, trigger: { event: "use" } };
}

// A skill action as its reaction to a provoking creature (2026-10-11, batch 55, Reactive Tail): "Trigger A creature within reach of the
// dragon's tail uses a manipulate action or a move action, makes a ranged attack, or leaves a square during a move action it's using Effect
// The dragon attempts an Athletics check to Trip the triggering creature. This check doesn't count toward the dragon's multiple attack
// penalty, and its multiple attack penalty doesn't apply to this check." → PF2e's Trip (or Shove, Grapple) at the provoking creature.
function provokedSkill(item, basicActions, actor = null) {
    if (item.system?.actionType?.value !== "reaction") return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\[\[\/act ([\w-]+)[^\]]*\]\](?:\{([^}]*)\})?/g, (_all, slug, label) => label ?? slug.replace(/^\w/, (letter) => letter.toUpperCase()))).replace(/\s+/g, " ").trim();
    const parts = /^(?:Requirements? .+? )?Trigger (.+?)\.? (?:Requirements? .+? )?Effect (.+)$/.exec(plain);
    const trigger = parts ? readReactionTrigger(parts[1]) : null;
    if (trigger?.event !== "provoke") return null;
    // (Batch 68, more wordings: "attempts to Trip the triggering creature", "uses its tail to attempt to Trip …", "makes an Athletics check
    // to Grapple the triggering creature", "… to Trip the creature"; "This attempt neither applies nor counts toward its multiple attack
    // penalty", "On a success, the triggering movement is disrupted (and the creature is Tripped as normal)" — a Trip that lands stops a
    // move anyway; a first sentence that only tells it.)
    const told = parts[2].split(/(?<=\.)\s+(?=[A-Z])/);
    // (Batch 137: Tail Whip's "On a success, the creature also takes damage as if the shemhazian had hit with a tail Strike, and if the
    // creature was flying, it falls 30 feet." — that Strike's damage on its successes, the fall the GM's; Territorial Retaliation's
    // "Regardless of the result, the space … become difficult terrain for 1 round." — the GM's.)
    const reminders = [];
    let struck = null;
    const kept = told.filter((sentence) => {
        const hit = /^On a success, the creature also takes damage as if (?:the [\w' -]+?|it|they|he|she) had hit with an? ([\w' -]+?) Strike(?:, and (if the creature was flying, it falls \d+ feet))?\.$/i.exec(sentence);
        if (hit) {
            struck = hit[1];
            if (hit[2]) reminders.push(hit[2][0].toUpperCase() + hit[2].slice(1) + ".");
            return false;
        }
        if (/^Regardless of the result, [^.]*? becomes? difficult terrain for \d+ rounds?\.$/i.test(sentence)) {
            reminders.push(sentence);
            return false;
        }
        return true;
    });
    // (Kneecapper: "lashes out at the triggering creature's knees and tries to knock them Prone. The nuglub makes an Acrobatics check
    // against the creature's Reflex DC. On a success, the target falls and lands prone." — PF2e's Trip rolled with Acrobatics, Prone on
    // its successes and nothing else.)
    const kneecap = kept.length === 3 && /^(?:The )?[^.]+? (?:makes|attempts) an? (?:@Check\[acrobatics[^\]]*\](?:\{[^}]*\})?|Acrobatics) check against the creature's Reflex DC\.$/i.test(kept[1]) && /^On a success, the target falls and lands prone\.$/i.test(kept[2]) && !/\b(?:check|damage|save)\b/i.test(kept[0]);
    if (kneecap && basicActions.trip?.resolution) {
        const plan = structuredClone(basicActions.trip);
        const rows = plan.resolution.outcomes;
        plan.resolution.check = { ...plan.resolution.check, statistic: "acrobatics" };
        rows.criticalSuccess = structuredClone(rows.success);
        rows.criticalFailure = structuredClone(rows.failure);
        return { ...plan, ...base(item, { traits: (plan.traits ?? []).filter((trait) => trait !== "attack") }), targeting: { ...plan.targeting, target: "the attacker" }, trigger };
    }
    const effect = (kept.length > 1 && !/\b(?:Trip|Shove|Grapple|Strike)\b/.test(kept[0]) && !/\b(?:check|damage|save)\b/i.test(kept[0]) ? kept.slice(1) : kept)
        .filter((sentence) => !/^(?:This (?:check|attempt) (?:neither applies nor counts toward|doesn't count toward|does not count toward|doesn't take or add to) (?:the [\w' -]+?'s|its|their|his|her) multiple attack penalty\.|On a success, the triggering (?:action|movement) is disrupted(?: and the creature is Tripped as normal)?\.)$/i.test(sentence)).join(" ");
    const match = /^(?:The )?[^.]+? attempts an Athletics check to (Trip|Shove|Grapple) the triggering creature\.(?: This check (?:doesn't|does not) count toward (?:the [\w' -]+?'s|its|their) multiple attack penalty, and (?:its|their) multiple attack penalty (?:doesn't|does not) apply to this check\.)?$/i.exec(effect)
        ?? /^(?:The )?[^.]+? (?:attempts|makes) an Athletics check to (Trip|Shove|Grapple) the (?:triggering creature|target|creature)\.$|^(?:The )?[^.]+? (?:attempts to|uses (?:its|their|his|her) [\w' -]+? to attempt to|extends an? [\w' -]+? and attempts to) (Trip|Grapple) the (?:triggering )?creature\.$/i.exec(effect)
        // (Batch 227, Battlezoo: "…, attempting to Trip the creature.")
        ?? /^(?:The )?[^.]+?, attempting to (Trip|Shove|Grapple) the (?:triggering )?creature\.$/i.exec(effect);
    if (match && !match[1]) match[1] = match[2];
    const basic = match ? basicActions[match[1].toLowerCase()] : null;
    if (!basic?.resolution) return null;
    const plan = structuredClone(basic);
    if (struck) {
        const components = strikeComponents(item, struck, actor);
        if (!components.length) return null;
        const rows = plan.resolution.outcomes;
        for (const degree of ["success", "criticalSuccess"]) {
            const formulas = components.map(({ formula }) => ({ formula }));
            rows[degree].damage = rows[degree].damage?.mode === "formulas" ? { ...rows[degree].damage, formulas: [...rows[degree].damage.formulas, ...formulas] } : { mode: "formulas", formulas, rollScope: "target" };
        }
    }
    if (reminders.length) plan.resolution.reminders = [...(plan.resolution.reminders ?? []), ...reminders.map((reminder) => readableText(reminder))];
    return { ...plan, ...base(item, { traits: (plan.traits ?? []).filter((trait) => trait !== "attack") }), targeting: { ...plan.targeting, target: "the attacker" }, trigger };
}

// A basic maneuver with another skill (2026-10-11, batch 82): Embrace's "The succubus attempts to Grapple a creature using their
// Diplomacy bonus instead of Athletics. If the creature is willing, the succubus automatically succeeds." → PF2e's Grapple (its
// results and DC) rolled with that skill; a willing creature the GM's. null otherwise.
function otherSkillManeuver(item, basicActions = {}) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "").replace(/\[\[\/act (\w+)[^\]]*\]\](?:\{([^}]*)\})?/g, (_all, slug, label) => label ?? slug.replace(/^\w/, (letter) => letter.toUpperCase()));
    const plain = htmlToPlainText(html.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    // (Batch 92, Cutting Remarks: "The courtesan levies insults or backhanded compliments, attempting to Demoralize a creature using their
    // Performance modifier instead of Intimidation.")
    const match = /^(?:The )?[^.]+?,? (?:attempts|attempting) to (Grapple|Trip|Shove|Disarm|Reposition|Demoralize) an? (?:creature|foe|enemy|target) using (?:its|their|his|her) (Acrobatics|Athletics|Deception|Diplomacy|Intimidation|Performance|Stealth|Thievery) (?:bonus|modifier) instead of (?:Athletics|Intimidation)\.(?: If the (?:creature|target) is willing, (?:the )?[\w' -]+? (?:automatically succeeds|\w+ it automatically)\.)?$/i.exec(plain);
    const basic = match ? basicActions[match[1].toLowerCase()] : null;
    if (!basic?.resolution?.check) return null;
    const plan = structuredClone(basic);
    plan.resolution.check = { ...plan.resolution.check, statistic: match[2].toLowerCase() };
    return { ...plan, ...base(item, { traits: [...new Set([...(item.system?.traits?.value ?? []), ...(plan.traits ?? [])])] }) };
}

// A basic maneuver, then a Strike at the same creature (2026-10-12, batch 146): Noble's Ruse's "The noble Feints. On a success, the noble
// Strikes the target.", Feinting Strike's "Feints, then Strikes the target of his Feint", Slippery Fighter's "moves up to his Speed, attempts
// to Feint a creature within his reach, then makes a melee Strike against that creature", Distracting Trick's "… to Feint, then makes a beak
// Strike against the same target. If the Feint succeeds, the Strike deals an additional 1d6 precision damage.", Bully's "Shoves a creature,
// and Strides after it into the nearest adjacent square if successful. It then makes a tentacle Strike against the creature, using the same
// multiple attack penalty.", Sacrificial Takedown's "attempts an Athletics check to Trip a creature. If she succeeds, she then makes a melee
// Strike against the target, granting her weapon the fatal d10 trait …", Terrorizing Swing's "attempts to Demoralize a foe within its melee
// reach, then makes a melee Strike against that foe. If the creature is Frightened and takes damage, it takes an additional 2d10 damage and is
// knocked Prone. This counts as two attacks …" → PF2e's maneuver with `then: { strike, onSuccess?, sameMap?, follow?, successDamage?, fatal?,
// ifFrightened? }` (the simulator's Strike after it; a note on the card live), approach when it moves first.
function maneuverThenStrike(item, actor, basicActions = {}) {
    if (item.system?.actionType?.value !== "action") return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/\[\[\/act (\w+)[^\]]*\]\](?:\{([^}]*)\})?/g, (_all, slug, label) => label ?? slug.replace(/^\w/, (letter) => letter.toUpperCase())).replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim()
        .replace(/^Frequency once per (?:round|turn) (?:Requirements? (?:The )?[^.]+? is within melee reach of an enemy\.? )?Effect /i, "")
        .replace(/^Requirements? (?:The )?[^.]+? is wielding cards or dice\.? Effect /i, "");
    const who = String.raw`(?:The )?[\w' -]+?`;
    const pronoun = String.raw`(?:he|she|it|they|the [\w' -]+?)`;
    let match;
    let slug = null;
    let then = null;
    let approach = null;
    const notes = [];
    if ((match = new RegExp(String.raw`^${who} (Feints|Demoralizes)\. On a success, ${pronoun} Strikes the target\.$`, "i").exec(plain))) {
        slug = match[1].toLowerCase().replace(/s$/, "").replace(/^demoralize$/, "demoralize");
        then = { strike: null, onSuccess: true };
    } else if ((match = new RegExp(String.raw`^${who} Feints, then Strikes the target of (?:his|her|its|their) Feint\.$`, "i").exec(plain))) {
        slug = "feint";
        then = { strike: null };
    } else if ((match = new RegExp(String.raw`^${who} moves up to (?:his|her|its|their) Speed, attempts to Feint a creature within (?:his|her|its|their) reach, then makes a melee Strike against that creature\.$`, "i").exec(plain))) {
        slug = "feint";
        then = { strike: null };
        approach = { strides: 1 };
        notes.push("It moves up to its Speed first: move its token.");
    } else if ((match = new RegExp(String.raw`^${who} performs [^.]+? to Feint, then makes an? ([\w' -]+?) Strike against the same target\. If the Feint succeeds, the Strike deals an additional (\d+d\d+) precision damage\.$`, "i").exec(plain))) {
        slug = "feint";
        then = { strike: match[1].toLowerCase(), successDamage: `${match[2]}[precision]` };
        notes.push(`If the Feint succeeds, the Strike deals ${match[2]} more precision damage.`);
    } else if ((match = new RegExp(String.raw`^${who} Shoves a creature, and Strides after it into the nearest adjacent square if successful\. It then makes an? ([\w' -]+?) Strike against the creature, using the same multiple attack penalty\.$`, "i").exec(plain))) {
        slug = "shove";
        then = { strike: match[1].toLowerCase(), sameMap: true, follow: true };
        notes.push("On a success it Strides after the creature: move its token.");
    } else if ((match = new RegExp(String.raw`^${who} attempts an Athletics check to Trip a creature\. If (?:he|she|it|they) succeeds?, (?:he|she|it|they) then makes a melee Strike against the target, granting (?:his|her|its|their) weapon the fatal (d\d+) trait until the end of (?:his|her|its|their) turn\. Both attacks count toward (?:his|her|its|their) multiple attack penalty, but the penalty (?:doesn't|does not) increase until after (?:he|she|it|they) makes? both (?:of them|attacks)\.$`, "i").exec(plain))) {
        slug = "trip";
        then = { strike: null, onSuccess: true, sameMap: true, fatal: Number(match[1].slice(1)) };
        notes.push(`The Strike after it has fatal ${match[1]}.`);
    } else if ((match = new RegExp(String.raw`^${who} Feints, Steps, and Strikes in any order\.$`, "i").exec(plain))) {
        // (Batch 156, Darting Feint: "The exiled revolutionary Feints, Steps, and Strikes in any order." — its Feint, then the Strike; the Step the GM's.)
        slug = "feint";
        then = { strike: null };
        notes.push("It also Steps, before, between or after them.");
    } else if ((match = new RegExp(String.raw`^${who} attempts to Demoralize a foe within (?:its|his|her|their) melee reach, then makes a melee Strike against that foe\. If the creature is Frightened and takes damage, it takes an additional (\d+d\d+) damage and is knocked Prone\. This counts as two attacks toward (?:the [\w' -]+?['’]s|its|his|her|their) multiple attack penalty\.$`, "i").exec(plain))) {
        slug = "demoralize";
        then = { strike: null, sameMap: true, ifFrightened: { damage: match[1], prone: true } };
        notes.push(`If the creature is Frightened and the Strike damages it, it takes ${match[1]} more damage and is knocked Prone.`);
    }
    if (!slug || !then) return null;
    const basic = basicActions[slug];
    if (!basic?.resolution?.check) return null;
    const plan = structuredClone(basic);
    const strikeNote = `Then it ${then.strike ? `makes a ${then.strike} Strike` : "Strikes"} at the same creature${then.onSuccess ? " if this succeeds" : ""}${then.sameMap ? ", at the same multiple attack penalty" : ""}.`;
    return { ...plan, ...base(item, { traits: [...new Set([...(item.system?.traits?.value ?? []), ...(plan.traits ?? [])])] }), targeting: { ...plan.targeting, target: "1 creature", range: "touch" }, then, ...(approach ? { approach } : {}), notes: [strikeNote, ...notes] };
}

// A basic maneuver in its own words (2026-10-12, batch 125): "The casino bouncer attempts to Demoralize a creature with a mere glance. The
// casino bouncer doesn't take a penalty to their Intimidation check if the target doesn't speak the same language.", "… as it attempts to
// Demoralize a creature. It gains a +2 circumstance bonus to this Intimidation check, and the attempt is not penalized if the target can't
// understand the thylacine.", "attempts an Intimidation check to Demoralize each enemy within 30 feet, without suffering penalties for not
// sharing a language. Regardless of the result, each creature is temporarily immune to Fancy Bladework for 1 minute.", "… Demoralize all
// non-allied creatures within 60 feet. He doesn't take a penalty against targets who don't understand his language." → PF2e's own action
// with that bonus, at one creature or each foe in that emanation, its immunity; a first sentence that only tells it. null for anything else
// (a critical success of its own, damage, another action after it).
function variedManeuver(item, basicActions = {}) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "").replace(/\[\[\/act (\w+)[^\]]*\]\](?:\{([^}]*)\})?/g, (_all, slug, label) => label ?? slug.replace(/^\w/, (letter) => letter.toUpperCase()));
    // (Batch 126: an emanation's template as its distance, "each creature within @Template[emanation|distance:30]{30 feet}".)
    // (Batch 245, Unseating Sweep: a cone, "all creatures within a @Template[cone|distance:15]" — "a 15-foot cone"; "making a single … check against all
    // targets' Reflex DCs" — one roll, as the card's.)
    const plain = htmlToPlainText(html.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/(?:an? )?@Template\[[^\]]*?(?:emanation|burst)[^\]]*?distance:(\d+)[^\]]*\](?:\{[^}]*\})?/g, "$1 feet").replace(/(?:an? )?@Template\[[^\]]*?cone[^\]]*?distance:(\d+)[^\]]*\](?:\{[^}]*\})?/g, "a $1-foot cone")).replace(/\s+/g, " ").trim()
        .replace(/, making a single @Check\[[^\]]*\](?:\{[^}]*\})? check against all targets['’] (?:Reflex|Fortitude|Will) DCs(?=\.$)/i, "");
    // (Deadly Display's "Requirements Ordulf is wielding a melee weapon": always so; any other requirement or a frequency isn't read.)
    // (Batch 141: Strangle's "Requirements The dero must have two free hands or be wielding a spiked chain" — what it holds; "… to Grapple with a +2
    // circumstance bonus." and Condemn's "The grand inquisitor Demoralizes." — at a creature; Stampeding Shove's "…, gaining a +2 circumstance
    // bonus to their Athletics check if the target is Prone" — a note.)
    const extra = [];
    let fixed = null;
    let statistic = null;
    // (Batch 241, Drag: "Requirements The experienced hound is adjacent to a Prone creature" — at that creature only, a requirement.)
    const proneOnly = /^Requirements? (?:The )?[^.]+? (?:is|are) adjacent to a Prone creature\.? Effect /i.test(plain);
    // (Batch 241, Down to Our Level: "Frequency once per round Effect …" — its frequency PF2e's; "all creatures in or adjacent to their space" — an
    // emanation of 5 feet.)
    // (Batch 243, Repel Boarders!: "… chooses a single direction and smashes into its enemies to push them in that direction. The troop attempts one
    // Athletics check to Shove and compares the result to the Fortitude DC of all enemies that are adjacent to the troop and in the chosen direction."
    // — a Shove at each enemy beside it, the direction's the GM's; its Stride after, a note.)
    let direction = false;
    const told = plain.replace(/^Frequency once per (?:round|turn) Effect /i, "")
        .replace(/^((?:The )?[^.]+?) chooses a single direction and smashes into its enemies to push them in that direction\. The troop attempts one Athletics check to Shove and compares the result to the Fortitude DC of all enemies that are adjacent to the troop and in the chosen direction\./i, (_all, who) => {
            direction = true;
            return `${who} attempts an Athletics check to Shove each enemy within 5 feet.`;
        }).replace(/^Requirements? (?:The )?[^.]+? (?:is|are) wielding an? (?:melee )?weapon\.? Effect /i, "").replace(/^Requirements? (?:The )?[^.]+? (?:is|are) adjacent to a Prone creature\.? Effect /i, "").replace(/^Requirements? (?:The )?[^.]+? must have two free hands or be wielding an? [\w' -]+?\.? Effect /i, "")
        .replace(/\b(to Grapple) with a \+(\d) circumstance bonus\./i, "$1 a creature, with a +$2 circumstance bonus.")
        // (Batch 156: Telekinetic Interference's "The haunt attempts to Trip a living creature within 60 feet with a bonus of +8." — that modifier
        // of its own; living creatures only, a note.)
        .replace(/\b(attempts to (?:Trip|Shove|Grapple|Disarm|Reposition)) a living creature within (\d+) feet with a bonus of (?:\[\[\/r 1d20\+(\d+)[^\]]*\]\](?:\{[^}]*\})?|\+(\d+))\./i, (_all, act, feet, rolled, plainBonus) => {
            fixed = Number(rolled ?? plainBonus);
            extra.push("Only a living creature.");
            return `${act} a creature within ${feet} feet.`;
        })
        // (Batch 156: Pirate's Feint's "If the target becomes Off-Guard to the buccaneer's melee attacks, it becomes off-guard to the buccaneer's
        // ranged attacks as well." — a note; Grab Attention's "attempts to Grapple a creature using Deception instead of Athletics. If the creature is
        // willing, she grapples it automatically." — Deception for the check, the willing creature a note.)
        .replace(/(?<=\.) If the target becomes Off-Guard to (?:the [\w' -]+?['’]s|its|their|his|her) melee attacks, it becomes off-guard to (?:the [\w' -]+?['’]s|its|their|his|her) ranged attacks as well\.$/i, () => {
            extra.push("A target off-guard to its melee attacks is off-guard to its ranged attacks too.");
            return "";
        })
        .replace(/\b(attempts to (?:Grapple|Trip|Shove|Disarm|Reposition) a creature) using (Deception|Intimidation|Acrobatics|Performance) instead of Athletics\.(?: If the creature is willing, (?:he|she|it|they) grapples? it automatically\.)?/i, (_all, act, skill) => {
            statistic = skill.toLowerCase();
            extra.push(`It rolls ${skill} for the check.`, ...(/willing/.test(_all) ? ["A willing creature is grabbed without a check."] : []));
            return `${act}.`;
        })
        // (Batch 200, Fence's Feint: "The fence Feints, then can Step. If the feint succeeds, the target is Off-Guard against the fence's melee attacks until
        // the end of the fence's next turn (or to all melee attacks on a critical success)." — the Feint; the Step and its longer Off-Guard notes.)
        .replace(/^((?:The )?[^.]+?) Feints, then can Step\. If the feint succeeds, the target is Off-Guard against (?:the [\w' -]+?['’]s|its|their|his|her) melee attacks until the end of (?:the [\w' -]+?['’]s|its|their|his|her) next turn \(or to all melee attacks on a critical success\)\.$/i, (_all, who) => {
            extra.push("Then it can Step.", "On a success the target is Off-Guard to its melee attacks until the end of its next turn (to all melee attacks on a critical success).");
            return `${who} Feints a creature.`;
        })
        // (Batch 156: Looming Threat's "The master xun Steps or Feints, then Demoralizes." — the Step or Feint before it the GM's.)
        .replace(/^((?:The )?[^.]+?) Steps or Feints, then Demoralizes\.(?=\s|$)/i, (_all, who) => {
            extra.push("It first Steps or Feints.");
            return `${who} Demoralizes a creature.`;
        })
        .replace(/^((?:The )?[^.]+? (?:Demoralizes|Feints))\.(?=\s|$)/i, "$1 a creature.")
        .replace(/, gaining a \+(\d) circumstance bonus to (?:its|their|his|her) Athletics check if the target is Prone\./i, (_all, value) => {
            extra.push(`+${value} circumstance bonus to the check if the target is Prone.`);
            return ".";
        })
        // (Batch 222: a Demoralize with Deception — Mocking Cry's "… mocks a creature within 30 feet. They attempt a Deception check to Demoralize the
        // creature.", a Battlezoo mimic's in other words; a cone of those who hear it, its language penalty waived (the cone a note); one check for all;
        // a Battlezoo creature's Feint at range, its longer Off-Guard a note.)
        .replace(/^((?:The )?[^.]+?) mimics a voice and mocks a creature within (\d+) feet\. (?:They|It) attempts? a Deception check to Demoralize the creature\./i, (_all, who, feet) => {
            statistic = "deception";
            extra.push("It rolls Deception for the check.");
            return `${who} attempts to Demoralize a creature within ${feet} feet.`;
        })
        .replace(/\b(?:They|It|He|She) Demoralizes? a creature, (?:using Deception instead of Intimidation(?: to do so)?|rolling Deception rather than Intimidation)\./i, () => {
            statistic = "deception";
            extra.push("It rolls Deception for the check.");
            return "It Demoralizes a creature.";
        })
        .replace(/\battempts to Demoralize (?:all creatures|everyone) in a (\d+)[ -]foot cone who can hear (?:the howl|it|them), (?:without taking any penalties|with no penalty) for not sharing a language\./i, (_all, feet) => {
            extra.push(`Only those in a ${feet}-foot cone who can hear it; no penalty for not sharing a language.`);
            return `attempts to Demoralize each creature within ${feet} feet.`;
        })
        .replace(/\b(?:makes|rolls) (?:a single|one) Intimidation check to Demoralize\b/i, "makes an Intimidation check to Demoralize")
        .replace(/\bto Demoralize everyone within (\d+) feet\b/i, "to Demoralize all creatures within $1 feet")
        .replace(/^((?:The )?[^.]+?) (?:makes a Feint against|Feints) a creature within (\d+) feet\. On a success,? the (?:creature|target) is Off-Guard (?:against|to) all attacks until the end of (?:the [\w' -]+?['’]s|its|their) next turn\./i, (_all, who, feet) => {
            extra.push("On a success, it's Off-Guard to every attack until its next turn ends.");
            return `${who} Feints a creature within ${feet} feet.`;
        })
        // (Batch 144, Right This Way: "Frequency once per round Effect …", "… to Reposition a Large or smaller creature within reach" — the size a note.)
        .replace(/^Frequency once per (?:round|turn) Effect /i, "")
        .replace(/\b(Reposition|Shove|Trip|Grapple|Disarm) an? (Small|Medium|Large|Huge) or smaller creature within reach\b/i, (_all, act, size) => {
            extra.push(`Only a ${size} or smaller creature.`);
            return `${act} a creature`;
        }).split(/(?<=\.)\s+(?=[A-Z])/);
    const sentences = told.length > 1 && !/^(?:Requirements?|Frequency|Trigger|Cost)\b/.test(told[0]) && !/\d|@|\b(?:Demoraliz\w*|Disarm\w*|Trip\w*|Shove\w*|Grappl\w*|checks?|damage|save|bonus|penalty)\b/i.test(told[0]) ? told.slice(1) : told;
    // (Batch 144: Reposition too.)
    // (Batch 156: Feint too, Pirate's Feint's.)
    const action = String.raw`(Demoralize|Disarm|Trip|Shove|Grapple|Reposition|Feint)`;
    // (Batch 126: "all living creatures within 60 feet that can hear the durnolith", "all enemies within 30 feet", "… and applies the result to
    // every opponent within 30 feet".)
    // (Batch 126: "all living creatures within 60 feet that can hear the minotaur but not see them" — those it can't see, a note; "up to 4 creatures".)
    const whom = String.raw`(an? (?:creature|foe|enemy|target)(?: within (\d+) feet)?|the nearest creature|the prone creature|all creatures in or adjacent to (?:its|their|his|her) space|all creatures (?:within|in) a \d+-foot cone|(?:each|all|every) (?:enem(?:y|ies)|foes?|(?:living )?creatures?|opponents?) (?:within|in) (\d+) feet(?: (?:that|who) can hear (?:the [\w' -]+?|it|them|him|her)( but not (?:clearly )?see (?:it|them|him|her)(?: \([^)]*\))?)?)?|all non-allied creatures within (\d+) feet|up to (\d|two|three|four) creatures)`;
    // (Shove and Run: "… and then Strides with a +20-foot circumstance bonus to Speed" — the Stride the GM's, a note.)
    // (Batch 126: "attempt to" (a troop's), "makes an Intimidation check to Demoralize", "He Demoralizes all enemies within 30 feet, rolling once and
    // comparing the result to each target's Will DC", "…; these Demoralize attempts don't take any penalty for not sharing a language".)
    // (Its subject only: not "Strides and then either Interacts to reload her gun or makes …", a choice after a move.)
    // (Batch 138: not a requirement or a frequency read as its subject; Rattling Spear's "(compare the check result to the targets' Will DCs
    // individually)".)
    const first = new RegExp(String.raw`^(?:The )?(?:(?!\b(?:either|then|Strides?|Steps?|Interacts?|Raises?|Feints?|Requirements?|Effect|Frequency|Trigger)\b)[^.])+?(?:,? as (?:it|they|he|she))? (?:(?:attempts?|attempting) (?:to ${action}|(?:an?|a single) (?:Intimidation|Athletics) checks? to ${action}|Intimidate checks to ${action})|makes an? (?:Intimidation|Athletics) check to ${action}|(Demoralize|Disarm|Trip|Shove|Grapple|Reposition|Feint)s) (?:and applies the result to )?${whom}(?: with a mere glance)?(?:,? (?:rolling once and )?comparing the result(?: of a single (?:Intimidation|Athletics) check)? to each target's (?:Will|Fortitude|Reflex) DC|; these Demoralize attempts (?:don't|do not) take any penalty for not sharing a language| \(compare (?:the|the [\w' -]+?['’]s) (?:Intimidation |Athletics )?check result to the targets' (?:Will|Fortitude|Reflex) DCs individually\))?(?:,? with a \+(\d) circumstance bonus(?: to the (?:roll|check))?)?(?:, without suffering penalties for not sharing a language)?( and then Strides(?: with a \+\d+-foot circumstance bonus to (?:(?:its|their|his|her) )?Speed)?)?\.$`, "i").exec(sentences[0] ?? "");
    if (!first) return null;
    const slug = (first[1] ?? first[2] ?? first[3] ?? first[4] ?? first[5]).toLowerCase();
    const basic = basicActions[slug];
    if (!basic?.resolution?.check) return null;
    let bonus = Number(first[12]) || 0;
    let immune = false;
    const added = [];
    const damaged = [];
    for (const sentence of sentences.slice(1)) {
        // (Batch 126: a bonus in some case, a penalty more on those frightened — the GM's, notes; PF2e's effect link.)
        if (/^If the targets [^.]+?, (?:the [\w' -]+?|it|they|he|she) gains? a \+\d circumstance bonus to this check\.$|^Creatures that become frightened as a result also take an? [–-]\d circumstance penalty to [^.]+\.$/i.test(sentence)) {
            extra.push(sentence);
            continue;
        }
        if (/^Effect: [\w' -]+$/.test(sentence)) continue;
        if (/^Each target is temporarily immune for (?:1|one|10|ten) minutes?\.$/i.test(sentence)) {
            immune = true;
            continue;
        }
        if (/^(?:The [\w' -]+?|[A-Z][\w'-]+|It|They|He|She) (?:doesn't|does not|don't|do not) take a penalty (?:to (?:its|their|his|her) Intimidation check )?(?:if the target doesn't (?:speak the same language|understand (?:its|their|his|her) language)|against targets who don't understand (?:its|their|his|her) language)\.$/i.test(sentence)) continue;
        const gains = /^(?:It|They|He|She) gains? a \+(\d) circumstance bonus to this (?:Intimidation |Athletics )?check(?:, and the attempt is not penalized if the target can't understand [^.]+)?\.$/i.exec(sentence);
        if (gains) {
            bonus += Number(gains[1]);
            continue;
        }
        // (Batch 222: "Regardless of whether the check succeeds, the target creature is temporarily immune to … for 1 hour", "The creatures are then
        // temporarily immune for 1 day".)
        if (/^Regardless of the result, each creature is temporarily immune to [\w' -]+? for (?:1|one) minute\.$|^These creatures are then immune to [\w' -]+? for (?:1|one) minute\.$|^Each creature is then temporarily immune for (?:1|one) minute\.$|^Regardless of whether the check succeeds, the target creature is temporarily immune to [^.]+? for (?:1|one) (?:hour|minute|day)\.$|^The creatures are then temporarily immune for (?:1|one) (?:hour|minute|day)\.$|^Each creature is then temporarily immune for (?:1|one) (?:hour|day)\.$/i.test(sentence)) {
            immune = true;
            continue;
        }
        // (Batch 126: no penalty for an unshared language, however it's said; Demoralize's own immunity said again; one roll for all.)
        if (/^They roll one Athletics check and compare the result to the (?:Reflex|Fortitude) DC of each target\.$/i.test(sentence)) continue;
        if (direction && /^The direction can be straight or diagonal, and the GM determines which enemies can be affected\.$/i.test(sentence)) continue;
        if (direction && /^If at least one enemy was moved, the troop can Stride to follow as described in Shove; the troop can move any number of its segments when it does, and this Stride (?:doesn't|does not) trigger reactions\.$/i.test(sentence)) {
            extra.push("If it moved at least one enemy, it can Stride after them (no reactions), moving any of its segments.");
            continue;
        }
        if (/^These checks take no penalty for not sharing a language\.$|^This Intimidation check (?:doesn't|does not) take the [–-]4 circumstance penalty for [^.]+? not speaking a language\.$|^As usual for Demoralize, affected (?:enemies|creatures) are then temporarily immune for 10 minutes\.$|^Roll once and apply the results? to all (?:creatures|targets)\.$/i.test(sentence)) continue;
        // (Batch 141: Condemn's "On a success, the target is Stunned with a value equal to its Frightened condition." — Stunned 1, or 2 on a critical
        // success (Demoralize's Frightened); Stampeding Shove's "If the Shove succeeds, the target takes 2d10 bludgeoning damage (double damage on a
        // critical success)."; Strangle's "On a success, the target also takes 1d6+6 bludgeoning damage and can't speak (…) as long as they're
        // Grabbed or Restrained." — the speech a note.)
        // (Right This Way: "On a success, the target is also Clumsy 1 (Clumsy 2 on a critical success) as …", "The target can remove this condition
        // by taking an Interact action." — a note.)
        const worse = /^On a success, the target is also (Clumsy|Enfeebled|Stupefied|Frightened|Sickened) (\d) \(\1 (\d) on a critical success\)(?: as [^.]+)?\.$/i.exec(sentence);
        if (worse) {
            added.push(["success", { kind: "condition", slug: worse[1].toLowerCase(), value: Number(worse[2]), duration: null }], ["criticalSuccess", { kind: "condition", slug: worse[1].toLowerCase(), value: Number(worse[3]), duration: null }]);
            continue;
        }
        // (Batch 222: Sow Despair's counteracting of good emotion effects on a critical success — the GM's.)
        if (/^In addition to the usual effects of Demoralize, on a critical success, (?:the [\w' -]+?|it) counteracts any beneficial emotion effects affecting the target\.$/i.test(sentence)) {
            extra.push(sentence);
            continue;
        }
        if (/^The target can remove this condition by taking an Interact action\.$/i.test(sentence)) {
            extra.push(sentence);
            continue;
        }
        // (Batch 241, Drag: a Step away after, the grabbed creature moved along with it — the GM's.)
        if (slug === "grapple" && /^(?:The [\w' -]+?|It|They|He|She) can then Step away from the target; if the target is Grabbed by (?:the [\w' -]+?|it|them|him|her), it is moved into (?:the [\w' -]+?['’]s|its|their|his|her) previous square and remains grabbed\.$/i.test(sentence)) {
            extra.push("Then it can Step away; a creature it Grabbed moves into the square it left, still grabbed.");
            continue;
        }
        if (slug === "demoralize" && /^On a success, the target is Stunned with a value equal to its Frightened condition\.$/i.test(sentence)) {
            added.push(["success", { kind: "condition", slug: "stunned", value: 1, duration: null }], ["criticalSuccess", { kind: "condition", slug: "stunned", value: 2, duration: null }]);
            continue;
        }
        const hurt = /^(?:If the (?:Shove|Grapple|Trip) succeeds|On a success), the target (?:also )?takes (@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?) damage(?: \((double damage) on a critical success\)| and (can't speak \(including to Cast a Spell\) as long as (?:they're|it's|it is|they are) Grabbed or Restrained))?\.$/i.exec(sentence);
        if (hurt) {
            const formula = readDamage(/^@Damage\[((?:[^[\]]|\[[^\]]*\])*)\]/.exec(hurt[1])[1]);
            damaged.push(["success", formula], ["criticalSuccess", hurt[2] ? `2*${formula}` : formula]);
            if (hurt[3]) extra.push(`On a success, the target also ${hurt[3]}.`);
            continue;
        }
        return null;
    }
    const plan = structuredClone(basic);
    for (const [degree, effect] of added) plan.resolution.outcomes[degree].effects = [...plan.resolution.outcomes[degree].effects, effect];
    for (const [degree, formula] of damaged) {
        const row = plan.resolution.outcomes[degree];
        row.damage = row.damage?.mode === "formulas" ? { ...row.damage, formulas: [...row.damage.formulas, { formula }] } : { mode: "formulas", formulas: [{ formula }], rollScope: "target" };
    }
    if (bonus) plan.resolution.check = { ...plan.resolution.check, bonus: { value: (Number(plan.resolution.check.bonus?.value) || 0) + bonus, type: "circumstance" } };
    if (fixed !== null) plan.resolution.check = { ...plan.resolution.check, modifier: fixed };
    if (statistic) plan.resolution.check = { ...plan.resolution.check, statistic };
    const radius = Number(first[8] ?? first[10]) || (/^all creatures in or adjacent to /i.test(first[6] ?? "") ? 5 : 0);
    const reach = Number(first[7]) || null;
    const many = first[11] ? { one: 1, two: 2, three: 3, four: 4 }[String(first[11]).toLowerCase()] ?? Number(first[11]) : null;
    // (Batch 243: "each enemy", "all foes", "every opponent", "non-allied creatures" — its foes only, area.foes.)
    const foes = /\b(?:enem(?:y|ies)|foes?|opponents?|non-allied)\b/i.test(first[6] ?? "");
    const cone = Number(/\b(\d+)-foot cone\b/.exec(first[6] ?? "")?.[1]) || 0;
    const targeting = cone ? { ...plan.targeting, target: null, range: null, area: { type: "cone", value: cone } } : radius ? { ...plan.targeting, target: null, range: null, area: { type: "emanation", value: radius, ...(foes ? { foes: true } : {}) } } : many ? { ...plan.targeting, target: `up to ${many} creatures` } : reach ? { ...plan.targeting, range: `${reach} feet` } : plan.targeting;
    const immunity = immune ? readImmunity(html, [item.name]) : null;
    const notes = [...(proneOnly ? ["Only at a Prone creature beside it."] : []), ...(direction ? ["Only the enemies beside it in one direction it chooses, straight or diagonal (the GM's)."] : []), ...(first[9] ? ["Only creatures that can hear it but not see it."] : []), ...extra, ...(first[13] ? [`Then it${first[13].replace(/^ and then/, "")}.`] : [])];
    return { ...plan, ...base(item, { traits: [...new Set([...(item.system?.traits?.value ?? []), ...(plan.traits ?? [])])] }), targeting, ...(immunity ? { trigger: { ...(plan.trigger ?? { event: "use" }), immunity } } : {}), ...(notes.length ? { notes } : {}), ...(proneOnly ? { requires: "requirement" } : {}) };
}

// Random effect tables (2026-10-12, batch 255; the user's choice of 2026-10-12: rolled and played, not picked). A die picks the way:
// - Draxie Dust: a roll for the effect, a save in its area to avoid it, and a numbered list of effects — each way the save, its failure the
//   row's effects;
// - Inflict Warpwave: a warpwave on one creature in range, a save to resist — PF2e's warpwave table (1d8, 1d4 rounds);
// - Generate Bomb: a bomb made, then its Strike, and a table of rows (damage, or a save) — the bomb's hit, its row rolled (randomOnHit);
// - a Battlezoo golem's d20 table of wonders ("<strong>2–3:</strong> …" paragraphs), a Battlezoo curse picked at random.
// → { builtin: "modes", actions, random: { formula, times }, modes: [{ name, plan, faces }] }, or a Strike activity with randomOnHit. null
// otherwise.
const WARPWAVES = [
    "Clumsy 2 (Clumsy 3 on a critical failure)", "Confused and gains 4d6 temporary Hit Points", "Dazzled (permanent on a critical failure)",
    "Enfeebled 2 (Enfeebled 3 on a critical failure)", "Immobilized by filaments of energy", "Quickened (Stride, Strike, or Step only)", "Slowed 1",
    "Stupefied 2 (Stupefied 3 on a critical failure)"
];
// One row's results on a failed save (and its critical failure's): its conditions, damage and temporary Hit Points; what else it says, a note.
function tableRow(text, { duration = null } = {}) {
    const plain = htmlToPlainText(String(text).replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const crit = /\(([^()]*?) on a critical failure\)/i.exec(plain);
    const fail = crit ? plain.replace(crit[0], "").trim() : plain;
    const conditions = (said) => readConditions(said, { plain: [...STAGE_CONDITIONS, "quickened"] }).map(({ recipient, ...effect }) => ({ ...effect, ...(duration && !effect.duration && !["prone"].includes(effect.slug) ? { duration } : {}) }));
    const temp = /\bgains? (\d+d\d+(?: ?\+ ?\d+)?) temporary Hit Points\b/i.exec(plain);
    const failEffects = [...conditions(fail), ...(temp ? [{ kind: "temp-hp", formula: temp[1].replace(/\s+/g, ""), duration: null }] : [])];
    const critEffects = !crit ? failEffects : /^permanent$/i.test(crit[1].trim()) ? failEffects.map((effect) => ({ ...effect, duration: null })) : conditions(crit[1]);
    const damage = inlineTags(String(text), "Damage").filter((raw) => !/healing/i.test(raw)).map((raw) => ({ formula: readDamage(raw) }));
    // A Sleep spell's effects: asleep (unconscious) for 1 minute, 1 hour on a critical failure; damage wakes it.
    if (/\beffects of (?:a|the) Sleep spell\b/i.test(plain)) {
        const asleep = (lasts) => [{ kind: "condition", slug: "unconscious", duration: readDuration(lasts) }];
        const slept = (effects) => ({ damage: none().damage, effects, manualInstructions: ["Asleep: it wakes up if it takes damage."] });
        return { failure: slept(asleep("for 1 minute")), criticalFailure: slept(asleep("for 1 hour")), read: true };
    }
    // What isn't read (a row with nothing read, or a restriction in brackets) is a note.
    const note = (!failEffects.length && !damage.length) || /\([^()]*\)/.test(fail) ? plain : null;
    const row = (effects) => ({ damage: damage.length ? { mode: "formulas", formulas: damage, rollScope: "target" } : none().damage, effects, ...(note ? { manualInstructions: [note] } : {}) });
    return { failure: row(failEffects), criticalFailure: row(critEffects), read: failEffects.length > 0 || damage.length > 0 };
}
function randomTable(item, actor, options = {}) {
    if (!["action", "free", "reaction"].includes(item.system?.actionType?.value)) return null;
    const html = String(item.system?.description?.value ?? "");
    const plain = htmlToPlainText(html.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const actions = Number(item.system?.actions?.value) || 1;
    const recharge = readRecharge(html);
    // ("Frequency once per round": usable again next round, as a 1-round recharge.)
    const perRound = item.system?.frequency?.per === "round" || /\bFrequency\b[^.;]*\bonce per round\b/i.test(plain);
    const trigger = { event: "use", ...(recharge ? { recharge: { formula: recharge, unit: "rounds" } } : perRound ? { recharge: { formula: "1", unit: "rounds" } } : {}) };
    const saveOf = (check, targeting, row, name) => ({ ...base(item), targeting, trigger, resolution: { kind: "save", check: { roll: "save", statistic: check.statistic, basic: false, against: { dc: "fixed", value: check.dc } }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: none(), failure: row.failure, criticalFailure: row.criticalFailure } }, source: { ...base(item).source, name: `${item.name} (${name})` } });
    const short = (text) => {
        const said = htmlToPlainText(readableText(String(text).replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1"))).replace(/\s+/g, " ").trim();
        return said.length > 60 ? `${said.slice(0, 57).replace(/\s+\S*$/, "")}…` : said;
    };
    // Draxie Dust: a numbered list after the roll for the effect, the save in the opening.
    const lead = /\bRoll (?:a )?\[\[\/(?:r|gmr|br) \{?(\d+)d(\d+)\}?[^\]]*\]\](?:\{[^}]*\})? to determine the effect\b/i.exec(html);
    const items = [...html.matchAll(/<li>([\s\S]*?)<\/li>/gi)].map((match) => match[1]);
    if (lead && Number(lead[1]) === 1 && items.length === Number(lead[2])) {
        const opening = html.slice(0, html.search(/<ol\b|<ul\b/i));
        const check = inlineTags(opening, "Check").map(readCheck).find((entry) => entry?.save && entry.dc);
        const template = inlineTags(opening, "Template").map(readTemplate).find(Boolean);
        if (!check || !template || !/\bmust succeed at an? @Check\[[^\]]*\](?:\{[^}]*\})? save or be affected\b/i.test(opening)) return null;
        const targeting = { target: null, range: null, area: template };
        const modes = items.map((text, index) => ({ name: `${index + 1}: ${short(text)}`, faces: [index + 1], plan: saveOf(check, targeting, tableRow(text), String(index + 1)) }));
        return { builtin: "modes", actions, random: { formula: `1d${lead[2]}`, times: 1 }, modes };
    }
    // (Batch 263, Roll the Bones: "… designates an adjacent living creature to roll the bones. … The creature rolls 2d6, adding them together to determine
    // the effect." then rows "7 or 11 (healing, vitality) The target regains 15 HP.", "2, 3, or 12 (void) The target takes 30 void damage. …", "Any
    // Other Roll (void) The target takes 15 void damage." — the dice's total picks the row: its healing or damage on that creature, its other words notes.)
    const summed = /\brolls \[\[\/(?:r|gmr|br) (\d+)d(\d+)[^\]]*\]\](?:\{[^}]*\})?, adding them together to determine the effect\b/i.exec(html);
    if (summed && items.length >= 2 && /\b(?:designates|chooses) an adjacent (?:living )?creature\b/i.test(plain)) {
        const [count, die] = [Number(summed[1]), Number(summed[2])];
        const totals = Array.from({ length: count * die - count + 1 }, (_value, index) => index + count);
        const taken = new Set();
        const rows = items.map((text) => {
            const head = /^\s*<strong>([^<]+)<\/strong>\s*(?:\([^)]*\)\s*)?/i.exec(text);
            const faces = !head ? null : /^Any Other Roll$/i.test(head[1].trim()) ? "rest" : head[1].split(/,\s*(?:or\s+)?|\s+or\s+/).map(Number).filter(Number.isFinite);
            return { faces, text: head ? text.slice(head[0].length) : text };
        });
        if (rows.some((row) => !row.faces || (row.faces !== "rest" && !row.faces.length))) return null;
        rows.filter((row) => row.faces !== "rest").forEach((row) => row.faces.forEach((face) => taken.add(face)));
        const targeting = { target: "1 creature", range: "touch", area: null };
        const modes = [];
        for (const row of rows) {
            const faces = row.faces === "rest" ? totals.filter((face) => !taken.has(face)) : row.faces;
            const [first, ...others] = sentencesOf(row.text);
            const tags = inlineTags(first ?? "", "Damage");
            const said = htmlToPlainText(String(first ?? "").replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g, "@D")).replace(/\s+/g, " ").trim();
            if (tags.length !== 1) return null;
            const notes = others.map((sentence) => readableText(htmlToPlainText(sentence.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim())).filter(Boolean);
            let plan = null;
            if (/^The target regains @D (?:HP|Hit Points)\.$/i.test(said) && /\bhealing\b/i.test(tags[0])) {
                const formula = readDamage(tags[0]).replace(/\[[^\]]*healing[^\]]*\]$/i, "").replace(/^\((.*)\)$/, "$1");
                plan = { ...base(item), targeting, trigger, resolution: { kind: "healing", native: { healing: { components: [{ id: "0", formula, kinds: ["healing"] }], recipients: "any" } } } };
            } else if (/^The target takes @D damage\.$/i.test(said)) {
                const success = { damage: { mode: "formulas", formulas: [{ formula: readDamage(tags[0]) }], rollScope: "outcome" }, effects: [] };
                plan = { ...base(item), targeting, trigger, resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success, failure: none(), criticalFailure: none() } } };
            } else return null;
            modes.push({ name: `${faces.join(", ")}: ${short(row.text)}`, faces, plan: notes.length ? { ...plan, notes } : plan });
        }
        return { builtin: "modes", actions, random: { formula: `${count}d${die}`, times: 1 }, modes };
    }
    // Inflict Warpwave: PF2e's warpwave table on a failed save.
    const warp = /\binflicts a warpwave on a creature within (\d+) feet \(@Check\[(?:type:)?(fortitude|reflex|will)\|dc:(\d+)[^\]]*\](?:\{[^}]*\})? save to resist\)\.$/i.exec(htmlToPlainText(html).replace(/\s+/g, " ").trim());
    if (warp) {
        const check = { statistic: warp[2].toLowerCase(), dc: Number(warp[3]) };
        const targeting = { target: "1 creature", range: `${warp[1]} feet`, area: null };
        const lasts = readDuration("for 1d4 rounds");
        const modes = WARPWAVES.map((text, index) => ({ name: `${index + 1}: ${short(text)}`, faces: [index + 1], plan: saveOf(check, targeting, tableRow(text, { duration: lasts }), String(index + 1)) }));
        return { builtin: "modes", actions, random: { formula: "1d8", times: 1 }, modes, notes: ["A new warpwave ends any earlier one on that creature."] };
    }
    // Generate Bomb: a table of bombs, then its bomb Strike — on a hit the row's damage (its splash, not doubled), its effect or its save.
    const table = /<table\b[\s\S]*?<\/table>/i.exec(html)?.[0] ?? null;
    const named = /\bthen makes an? ([\w' -]+?) Strike\b/i.exec(plain);
    const tableDie = table ? /\[\[\/(?:r|gmr|br) \{?1d(\d+)\}?[^\]]*\]\]/i.exec(table) : null;
    if (table && named && tableDie) {
        const parts = (raw) => {
            const out = [];
            let depth = 0;
            let start = 0;
            for (let index = 0; index < raw.length; index++) {
                if ("([".includes(raw[index])) depth++;
                else if (")]".includes(raw[index])) depth--;
                else if (raw[index] === "," && depth === 0) {
                    out.push(raw.slice(start, index).trim());
                    start = index + 1;
                }
            }
            return [...out, raw.slice(start).trim()].filter(Boolean);
        };
        const bomb = (cell, face) => {
            const said = htmlToPlainText(cell.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim().replace(/\btargets next\b/gi, "target's next");
            const label = /^([^:@]{1,40}):/.exec(said)?.[1]?.trim() ?? `Bomb ${face}`;
            const check = inlineTags(cell, "Check").map(readCheck).find((entry) => entry?.save && entry.dc);
            const tag = inlineTags(cell, "Damage")[0];
            const damage = tag ? parts(readDamage(tag)) : [];
            const splash = damage.map((part) => /^\((\d+)\[splash\]\)\[(\w+)\]$/i.exec(part)).filter(Boolean).map((match) => `${match[1]}[${match[2]}]`);
            const native = [...cell.matchAll(/@UUID\[([^\]]+)\]\{(Effect: [^}]+)\}/g)].map((match) => ({ uuid: match[1], label: match[2].replace(/^Effect:\s*/i, "") }));
            const save = check ? saveOf(check, { target: "1 creature", range: null, area: null }, tableRow(cell.slice(cell.search(/@Check/))), label) : null;
            const lasts = /\buntil (?:the )?(start|end) of (?:the )?target's next turn\b/i.exec(said);
            const conditions = check ? [] : readConditions(said.replace(/\bEffect: [^,.;]+/g, ""), { plain: STAGE_CONDITIONS }).map(({ recipient, kind, ...entry }) => ({ ...entry, duration: entry.duration ?? (lasts ? readDuration(`until the ${lasts[1].toLowerCase()} of the target's next turn`) : null) }));
            const onHit = { conditions, critical: null, push: null, damage: damage.filter((part) => !/\[splash\]/i.test(part)), ...(splash.length ? { splash } : {}), ...(native.length ? { nativeEffects: native } : {}), save, size: null };
            const notes = [...(splash.length ? [`Splash: ${splash.join(" + ").replace(/\[(\w+)\]/g, " $1")} damage on each creature within 5 feet of the target, and on the target on a miss (not a critical miss).`] : []), ...(check ? ["Its sickness reaches the creatures in the splash too, at +2 to their saves."] : []), ...(native.length ? [] : /\bstatus penalty to Speeds\b/i.test(said) ? [said] : [])];
            return { name: label, onHit, notes };
        };
        const rows = [...table.matchAll(/<tr>\s*<td>\s*(\d+)(?:\s*[–-]\s*(\d+))?\s*<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/gi)].map((match) => {
            const from = Number(match[1]);
            const to = Number(match[2] ?? match[1]);
            return { faces: Array.from({ length: to - from + 1 }, (unused, index) => from + index), ...bomb(match[3], from) };
        });
        const covered = rows.flatMap((row) => row.faces);
        if (!rows.length || covered.length !== Number(tableDie[1]) || !rows.every((row) => row.onHit.damage.length || row.onHit.save || row.onHit.conditions.length)) return null;
        const strike = named[1].toLowerCase();
        return { builtin: "strike-activity", actions, strides: 0, strike, attackBonus: 0, damageBonus: 0, offGuard: false, requires: null, oncePerFight: false, onHit: rows[0].onHit, randomOnHit: { formula: `1d${tableDie[1]}`, rows } };
    }
    const automatic = (effects, notes, targeting) => ({ ...base(item), targeting, trigger, resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: { ...none(), effects, ...(notes.length ? { manualInstructions: notes } : {}) }, failure: none(), criticalFailure: none() } } });
    const range = Number(/\b(?:a|one) (?:target|creature) within (\d+) feet\b/i.exec(plain)?.[1]) || null;
    const one = { target: "1 creature", range: range ? `${range} feet` : null, area: null };
    // An attack of its own at a fixed bonus whose damage type a die picks (a list of types after the roll, one face perhaps dealing nothing) —
    // each type a way, its attack against AC, double damage on a critical hit.
    const typed = /\bRoll (?:a )?\[\[\/(?:r|gmr|br) \{?1d(\d+)\}?[^\]]*\]\](?:\{[^}]*\})? to (?:randomly )?(?:determine|pick|choose) (?:the )?(?:type of )?damage(?: type)?\b/i.exec(html);
    const bonus = /\b(?:makes an? (?:ranged |melee )?(?:Strike|attack) (?:roll )?with an?|attacks at) \[\[\/(?:r|gmr|br) \{?1d20 ?\+ ?(\d+)\}?[^\]]*\]\](?:\{[^}]*\})?/i.exec(html);
    if (typed && bonus && items.length === Number(typed[1])) {
        const statistic = String(item.name ?? "attack").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const reach = Number(/\bwithin (\d+) feet\b/i.exec(plain)?.[1]) || null;
        const check = { roll: "skill", statistic, against: { dc: "target", statistic: "ac" }, modifier: Number(bonus[1]) };
        const modes = items.map((text, index) => {
            const tag = inlineTags(text, "Damage")[0];
            const formula = tag ? readDamage(tag) : null;
            const hit = (double) => ({ damage: { mode: "formulas", formulas: [{ formula: double ? `2*${formula}` : formula }], rollScope: "target" }, effects: [] });
            const plan = formula ? { ...base(item), targeting: { target: "1 creature", range: reach ? `${reach} feet` : null, area: null }, trigger, resolution: { kind: "check", check, sharedDamage: null, outcomes: { criticalSuccess: hit(true), success: hit(false), failure: none(), criticalFailure: none() } }, source: { ...base(item).source, name: `${item.name} (${index + 1})` } } : null;
            return { name: `${index + 1}: ${formula ? /\[(\w+)\]\s*$/.exec(formula)?.[1] ?? short(text) : short(text)}`, faces: [index + 1], plan };
        });
        if (!modes.some((mode) => mode.plan)) return null;
        return { builtin: "modes", actions, random: { formula: `1d${typed[1]}`, times: 1 }, modes };
    }
    // A save whose failure brings one of a list of curses, picked at random (two on a critical failure): each curse a way.
    const cursed = /\b(?:On a failure, the target is (?:cursed by|afflicted (?:by|with)|subjected to)|If it fails, it suffers) one of the following(?: effects| curses)? \((?:randomly selected|chosen at random|determined at random|at random)\); (?:on a critical failure|if it critically fails), two (?:curses|of them|effects) apply(?: instead)?\b/i.test(plain);
    if (cursed && items.length >= 2) {
        const check = inlineTags(html.slice(0, html.search(/<ul\b|<ol\b/i)), "Check").map(readCheck).find((entry) => entry?.save && entry.dc);
        if (!check) return null;
        const modes = items.map((text, index) => {
            const name = htmlToPlainText(/<strong>([\s\S]*?)<\/strong>/i.exec(text)?.[1] ?? `Curse ${index + 1}`).trim();
            const body = text.replace(/^\s*<strong>[\s\S]*?<\/strong>\s*:?\s*/i, "");
            const said = htmlToPlainText(body.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
            const raised = /^(?:Increase the target's (\w+) (?:condition )?value by (\d+)|Its (\w+) value goes up by (\d+))\.?$/i.exec(said)?.filter(Boolean);
            const row = raised && STAGE_CONDITIONS.includes(raised[1].toLowerCase())
                ? { failure: { ...none(), effects: [{ kind: "condition", slug: raised[1].toLowerCase(), value: Number(raised[2]), duration: null, stack: { by: Number(raised[2]) } }] } }
                : { failure: { ...none(), manualInstructions: [`${name}: ${said}`] } };
            const second = "And a second curse: roll again for another one.";
            const plan = saveOf(check, one, { failure: row.failure, criticalFailure: { ...row.failure, manualInstructions: [...(row.failure.manualInstructions ?? []), second] } }, name);
            return { name: `${index + 1}: ${name}`, faces: [index + 1], plan };
        });
        return { builtin: "modes", actions, random: { formula: `1d${items.length}`, times: 1 }, modes };
    }
    // A d20 table in paragraphs ("<strong>2–3:</strong> …"), each row its own: another two rolls, a save, a spell it casts, a condition on
    // the target or on itself, damage in an area, or a note.
    const d20 = /\bRoll (?:a )?\[\[\/(?:r|gmr|br) \{?1d(\d+)\}?[^\]]*\]\](?:\{[^}]*\})? on the (?:following )?table\b/i.exec(html);
    const paragraphs = [...html.matchAll(/<p>\s*<strong>\s*(\d+)(?:\s*[–-]\s*(\d+))?:?\s*<\/strong>:?\s*([\s\S]*?)<\/p>/gi)];
    if (d20 && paragraphs.length >= 2) {
        const anyDc = Number(/\bAny DC (?:required )?is (\d+)\b/i.exec(plain)?.[1] ?? /\bThe DC (?:for these effects |for any save )?is (\d+)\b/i.exec(plain)?.[1]) || null;
        const way = (cell, name) => {
            const said = htmlToPlainText(cell.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
            if (/^Roll twice\b/i.test(said)) return { again: 2, plan: null, notes: [said] };
            if (/@UUID\[Compendium\.pf2e\.spells-srd\./.test(cell)) {
                const cast = castSpell({ ...item, system: { ...item.system, actionType: { value: "action" }, description: { value: `<p>${cell}</p>` } } }, actor);
                if (cast) return { plan: { ...cast, dc: cast.dc ?? anyDc } };
            }
            const check = inlineTags(cell, "Check").map(readCheck).find((entry) => entry?.save) ?? null;
            const template = inlineTags(cell, "Template").map(readTemplate).find(Boolean);
            const tag = inlineTags(cell, "Damage")[0];
            if (check && tag && template && check.basic) {
                const hurt = (multiplier) => ({ damage: { mode: "shared", multiplier, sourceComponentIds: multiplier ? ["0"] : [] }, effects: [] });
                return { plan: { ...base(item), targeting: { target: null, range: null, area: template }, trigger, resolution: { kind: "save", check: { roll: "save", statistic: check.statistic, basic: true, against: { dc: "fixed", value: check.dc ?? anyDc } }, sharedDamage: { rollOnce: true, components: [{ id: "0", formula: readDamage(tag), type: null, category: null }] }, outcomes: { criticalSuccess: hurt(0), success: hurt(0.5), failure: hurt(1), criticalFailure: hurt(2) } }, source: { ...base(item).source, name: `${item.name} (${name})` } } };
            }
            // (A time said in another sentence than the condition's: the condition's.)
            const lasts = /\bfor (\d+) (rounds?|minutes?)\b/i.exec(said);
            const conditions = readConditions(said, { plain: [...STAGE_CONDITIONS, "quickened"] }).map(({ recipient, ...effect }) => ({ ...effect, duration: effect.duration ?? (lasts ? readDuration(lasts[0]) : null) }));
            const rest = said.split(/(?<=\.)\s+/).slice(1).join(" ");
            if (check && /\bmust succeed at an? @?[\w ]*save or\b|\bsave or (?:their|its|be)\b/i.test(said) && conditions.length) {
                const row = { ...none(), effects: conditions, manualInstructions: [said] };
                return { plan: saveOf({ statistic: check.statistic, dc: check.dc ?? anyDc }, one, { failure: row, criticalFailure: row }, name) };
            }
            // On itself when the row's subject is the creature (its name's last word, or "it"), otherwise on the target.
            const subject = /^(?:The )?([\w' -]+?) (?:is|are|becomes?|gains?)\b/i.exec(said)?.[1]?.toLowerCase() ?? "";
            const own = String(actor?.name ?? item.name).toLowerCase().split(/[^a-z']+/).filter((word) => word.length > 2);
            if (!check && conditions.length && (subject === "it" || own.includes(subject.split(" ").at(-1))) && !/\btarget\b/i.test(subject)) return { plan: automatic(conditions.map((effect) => ({ ...effect, recipient: "self" })), rest ? [rest] : [], { target: "self", range: null, area: null }) };
            if (conditions.length && /\bthe target(?:'s)?\b/i.test(said)) return { plan: automatic(conditions, [said], one) };
            return { plan: null, notes: [said] };
        };
        const modes = paragraphs.map((match) => {
            const from = Number(match[1]);
            const to = Number(match[2] ?? match[1]);
            const label = from === to ? `${from}` : `${from}–${to}`;
            const read = way(match[3], `${label}`);
            return { name: `${label}: ${short(match[3])}`, faces: Array.from({ length: to - from + 1 }, (unused, index) => from + index), plan: read.plan, ...(read.again ? { again: read.again } : {}), ...(read.notes?.length ? { notes: read.notes } : {}) };
        });
        if (modes.flatMap((mode) => mode.faces).length !== Number(d20[1]) || !modes.some((mode) => mode.plan)) return null;
        return { builtin: "modes", actions, random: { formula: `1d${d20[1]}`, times: 1 }, modes };
    }
    // Strikes picked by a die, rolled more than once ("roll 1d6 twice": a face does nothing, or makes the Strike it names).
    const twice = /\bRoll (?:a )?\[\[\/(?:r|gmr|br) \{?1d(\d+)\}?[^\]]*\]\](?:\{[^}]*\})? (twice|three times)\b/i.exec(html);
    if (twice) {
        const faces = {};
        for (const match of plain.matchAll(/\b(?:for )?(?:each|a) roll of (\d+)(?:,? (?:or|and) (\d+))?(?:,| means) (?:the [\w' -]+?|it|they) makes? an? ([\w' -]+?) Strike\b/gi)) for (const face of [match[1], match[2]].filter(Boolean)) faces[face] = match[3].toLowerCase();
        if (!Object.keys(faces).length) return null;
        return { builtin: "random-strikes", actions, formula: `1d${twice[1]}`, times: twice[2].toLowerCase() === "twice" ? 2 : 3, faces, ...(/\bonce per round\b/i.test(plain) ? { oncePerTurn: true } : {}) };
    }
    return null;
}

// Zones (2026-10-12, batch 256; the user's call of 2026-10-12: zones automated, not the GM's): an area an ability leaves for a while — a
// cloud that conceals those in it, difficult or hazardous terrain, a save or damage on entering it or at a turn's start or end, a penalty
// or PF2e's own effect while inside. Each sentence is read, or kept as a note; with nothing read but the area, null.
// → { builtin: "zone", actions, trigger, zone: { area, centre: "self" | "placed", range, lasts, untilReused, concealed, terrain: [{ movement,
//   difficulty }], others, hazard: { formulas }, saves: [{ when: ["initial" | "enter" | "start" | "end"], plan, note? }], damage: [{ when,
//   formulas }], effect: { uuid, label, allies? }, modifiers, notes } }.
const ZONE_EFFECT = /@UUID\[(Compendium\.pf2e\.[\w-]*effects\.Item\.[A-Za-z0-9]{16})\]\{(Effect: [^}]+)\}/;
function zoneLasts(text) {
    const said = String(text).replace(/\b(?:her|his|their|them|its own)( next turn)\b/gi, "its$1").replace(/\buntil (?:the [\w' -]+?['’]s|its) next turn\b/gi, "until the start of its next turn").replace(/\b(?:until|unless) (?:it is |it's )?dispersed[^,.;]*|\bor until (?:it is |it's )?dispersed[^,.;]*/gi, "");
    if (!/\b(?:for|until)\b/i.test(said)) return null;
    return readDuration(said);
}
// Who difficult terrain is for: [{ movement, difficulty }] and whether the creature itself is spared ("for creatures other than grodairs").
function zoneTerrain(text) {
    const entries = [];
    let others = false;
    for (const match of String(text).matchAll(/\b(greater )?difficult terrain(?: for ([^,.;]+?))?(?=,|\.|;| but\b| until\b| unless\b| and (?=hazardous|greater|difficult)|$)/gi)) {
        // (Who it's for, after it or in its clause before: "creatures flying toward the jabberwock are moving through greater difficult terrain".)
        const before = String(text).slice(Math.max(0, String(text).lastIndexOf(",", match.index) + 1), match.index).toLowerCase();
        const who = `${match[2] ?? ""} ${/\b(?:fly|flying|swim|swimming|climbing)\b/.test(before) ? before : ""}`.toLowerCase();
        if (/\bother\b/.test(who)) others = true;
        const movement = [...(/\bfly(?:ing)?\b/.test(who) ? ["fly"] : []), ...(/\bswim(?:ming)?\b/.test(who) ? ["swim"] : []), ...(/\bon the ground\b/.test(who) ? ["walk"] : []), ...(/\bclimb(?:ing)?\b/.test(who) ? ["climb"] : [])];
        entries.push({ movement: movement.length ? movement : ["walk"], difficulty: match[1] ? 3 : 2 });
    }
    return { entries, others };
}
function readZone(item, actor = null) {
    const type = item.system?.actionType?.value;
    if (!["action", "free", "reaction"].includes(type)) return null;
    const html = String(item.system?.description?.value ?? "");
    const plain = htmlToPlainText(html.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const triggerText = /\bTrigger\s+(.+?)\s*(?:\bEffect\b|\bRequirements?\b|\bFrequency\b|$)/s.exec(plain)?.[1] ?? null;
    if (type === "reaction" && !triggerText) return null;
    if (/\bRequirements?\b/.test(plain)) return null;
    // (One whose effects depend on where it happens, Quake's: the GM's.)
    if (/\bdepend(?:s|ing) on (?:the surrounding|where|the environment|its surroundings)\b/i.test(plain)) return null;
    const read = triggerText ? readReactionTrigger(triggerText) : null;
    const body = html.replace(/<strong>\s*(?:Frequency|Requirements?|Trigger|Cost)\s*<\/strong>[\s\S]*?(?=<strong>|<hr|<\/p>)/gi, "").replace(/<strong>\s*Effect\s*<\/strong>/gi, "");
    // (Its sentences, split after a roll or a link too: "… @Template[emanation|distance:5]. The leshy takes …".)
    const sentences = body.split(/(?<=[.!?])(?:<\/?(?:p|li|ul|ol|br|hr)\b[^>]*>|\s)+(?=(?:<[^>]+>)*[A-Z@(])/).map((sentence) => ({ html: sentence, said: htmlToPlainText(sentence.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim() })).filter((sentence) => sentence.said);
    const zone = { area: null, centre: "self", range: null, lasts: null, untilReused: false, concealed: false, terrain: [], others: false, hazard: null, saves: [], damage: [], effect: null, modifiers: [], notes: [] };
    const recharge = readRecharge(html);
    // (What it says before its area: "… create a cloud of smoke within 120 feet. This cloud is a 20-foot burst …".)
    let lead = "";
    const link = ZONE_EFFECT.exec(html);
    let inside = false;
    let allies = false;
    // A save's results after it ("On a failure, …", "A creature can attempt to Escape …"), for that save.
    let open = null;
    const saveOn = (when, check, rest, said) => {
        const sub = `<p>The target must succeed at a ${check} save${rest ? ` or ${rest}` : ""}.</p>`;
        open = { when, check, sub, said, follow: [] };
        zone.saves.push(open);
    };
    for (const { html: sentence, said: line } of sentences) {
        let said = line;
        if (/^Effect: /i.test(said)) continue;
        if (ZONE_EFFECT.test(sentence) && /^Effect: [^.]+\.?$/i.test(said)) continue;
        // (Batch 262: a square given by its sides in feet, with how far away it may be — a square the GM places, that far away at most.)
        const square = zone.area ? null : /\bin an? (\d+)[-\u2011]foot by \1[-\u2011]foot area(?: within (\d+) feet of (?:it|them|itself|themselves|him|her))?\b/i.exec(said);
        const template = inlineTags(sentence, "Template").map(readTemplate).find(Boolean) ?? (square ? { type: "square", value: Number(square[1]) } : null);
        // The area it makes: where, how long, and terrain it says there.
        if (template && !zone.area) {
            said = `${lead} ${said}`.trim();
            if (!["burst", "emanation", "cone", "line", "square"].includes(template.type) || /@Damage\[|@Check\[/.test(sentence)) return null;
            if (template.type === "square") {
                zone.centre = "placed";
                zone.range = Number(square[2]) || null;
            }
            // (Not what the creatures there get at once, an ally's bonus or extra damage for a round: War Cry's, Sic 'Em!'s.)
            if (/^(?:Each|All|Any|Every)\b/i.test(said) || /\b(?:gains?|deals?) (?:an? )?(?:additional|[+–-]\d)/i.test(said)) return null;
            zone.area = { type: template.type, value: template.value };
            const placed = /\bwithin (\d+) feet\b(?! of (?:it|them|itself|themselves|him|her)\b)/i.exec(said.replace(/@Template\[[^\]]*\](?:\{[^}]*\})?/g, "").replace(/\bwithin an? @Template/gi, "")) ?? /\b(\d+) feet away\b/i.exec(said);
            const centred = /\bcentered on (?:a corner of )?(?:them|themselves|themself|itself|himself|herself|him|her|it|its own|their own|(?:its|their|his|her) (?:own )?(?:space|square)|the [\w' -]+?)\b/i.exec(said);
            if (template.type === "burst" && placed && !(centred && !/\btarget\b/i.test(centred[0]))) {
                zone.centre = "placed";
                zone.range = Number(placed[1]);
            }
            // ("centered anywhere on the island": where the GM puts it.)
            if (template.type === "burst" && /\bcentered anywhere\b/i.test(said)) zone.centre = "placed";
            zone.lasts = zoneLasts(said.replace(/@Template\[[^\]]*\](?:\{[^}]*\})?/g, "")) ?? zone.lasts;
            const terrain = zoneTerrain(said);
            zone.terrain.push(...terrain.entries);
            zone.others ||= terrain.others;
            if (/\bhazardous terrain\b/i.test(said)) zone.hazard = { formulas: [] };
            if (/\bdispersed by a strong wind\b/i.test(said)) zone.notes.push("A strong wind disperses it.");
            // ("…; creatures within the soot are Concealed, and …": in the same sentence.)
            if (/\bcreatures (?:with)?in(?:side)? (?:the|this|that) [\w' -]+? (?:are|become) Concealed\b/i.test(said)) zone.concealed = true;
            continue;
        }
        if (!zone.area) {
            // (Before the area: what the creature does first, "The dragon turtle summons a mighty storm …", the GM's flavour.)
            if (/@(?:Check|Damage)\[/.test(sentence)) return null;
            lead = `${lead} ${said}`.trim();
            continue;
        }
        // Its results after a save ("On a failure, …"), kept with that save.
        if (open && /^(?:On a (?:critical )?(?:failure|success)|A creature can attempt to Escape|If (?:it|the creature) (?:fails|critically fails)|(?:Critical )?(?:Success|Failure)\b)/i.test(said)) {
            open.follow.push(sentence);
            continue;
        }
        // (A save's results by degree, after other words: that save's.)
        if (!open && zone.saves.at(-1)?.follow && /^(?:Critical )?(?:Success|Failure)\b/.test(said)) {
            zone.saves.at(-1).follow.push(sentence);
            continue;
        }
        open = null;
        // (Its recharge, read with the area's trigger.)
        if (recharge && /\bcan(?:'|’)?t (?:use )?(?:its |their |this )?[\w' -]+? (?:again )?for\b/i.test(said)) continue;
        // (Cinder Dispersal: back in its form at the start of its turn — the cloud ends then.)
        if (/^At the start of its turn, the [\w' -]+? returns to its normal form\b/i.test(said)) {
            zone.lasts = readDuration("until the start of its next turn");
            zone.notes.push(said);
            continue;
        }
        if (/^A creature must attempt a new save each round it remains (?:with)?in the (?:area|cloud|emanation)\.$/i.test(said) && zone.saves.length) {
            zone.saves.at(-1).when = [...new Set([...zone.saves.at(-1).when, "start"])];
            continue;
        }
        const lasts = /^(?:The|This|These|Its) [\w' -]+?\b[^.]*?\b(?:lasts?|remains?(?: in place)?|persists?|continues?) (?:for|until)\b/i.test(said);
        if (lasts) {
            zone.lasts = zoneLasts(said) ?? zone.lasts;
            if (/\bdispersed\b[^.]*\bstrong wind\b|\bstrong wind\b[^.]*\bdispers/i.test(said)) zone.notes.push("A strong wind disperses it.");
            if (/\buntil (?:the [\w' -]+?|it|they|he|she) uses? this (?:ability|action) again\b/i.test(said)) zone.untilReused = true;
            continue;
        }
        // (Batch 262: a trap that vanishes on its own after a minute, which its maker may Dismiss sooner — that long; the Dismiss a note.)
        const fades = /^This [\w' -]+? (?:naturally )?disappears after (\d+|one) minutes?(, though (?:the [\w' -]+?|it|they) can Dismiss it before the duration expires)?\.$/i.exec(said);
        if (fades) {
            zone.lasts = readDuration(`for ${fades[1]} minute${fades[1] === "1" || /^one$/i.test(fades[1]) ? "" : "s"}`) ?? zone.lasts;
            if (fades[2]) zone.notes.push("It can Dismiss it sooner.");
            continue;
        }
        // "… can use this action again to dismiss …", "… can end the storm by taking this action again."
        if (/\b(?:can|may) (?:use this (?:action|ability) again to (?:dismiss|end)|end (?:the|this) [\w ]+? by (?:taking|using) this (?:action|ability) again)\b/i.test(said)) {
            zone.untilReused = true;
            continue;
        }
        if (/\bConcealed\b/.test(said) && /^(?:(?:All|Any|Each) (?:other )?creatures?|Anything|Creatures) (?:with)?in(?:side)? (?:the|this|that) /i.test(said)) {
            zone.concealed = true;
            // (", and any creature ending its turn there takes 2d6 fire damage": damage at its turn's end.)
            const ending = /, and (?:any|each) creature ending its turn there takes @Damage\[/i.test(said);
            if (ending) zone.damage.push({ when: "end", formulas: inlineTags(sentence, "Damage").map(readDamage) });
            continue;
        }
        if (/\bdifficult terrain\b/i.test(said) && !/@Check\[/.test(said)) {
            const terrain = zoneTerrain(said);
            if (terrain.entries.length && !/\bcan ignore\b|\bignores?\b/i.test(said)) {
                zone.terrain.push(...terrain.entries);
                zone.others ||= terrain.others;
                if (/\bhazardous terrain\b/i.test(said)) zone.hazard ??= { formulas: [] };
                if (/\bunless they (?:also )?have a swim Speed\b/i.test(said)) zone.notes.push("A creature with a swim Speed ignores it.");
                if (/\bwith an Interact action\b/i.test(said)) zone.notes.push("An Interact action clears a square of it.");
                continue;
            }
        }
        if (/\bhazardous terrain\b/i.test(said) && !/@(?:Damage|Check)\[/.test(said)) {
            zone.hazard ??= { formulas: [] };
            zone.others ||= /\bfor other creatures\b/i.test(said);
            continue;
        }
        const hazard = /\btakes @Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})? damage (?:each time it moves into one of these squares|for (?:every|each) square (?:of (?:that|the) area )?it moves into|for every 5 feet of movement)\.$/i.test(said);
        if (hazard) {
            zone.hazard = { formulas: inlineTags(sentence, "Damage").map(readDamage) };
            continue;
        }
        const ending = /^(?:A|Any|Each) creature (?:with)?in the [\w' -]+? at the end of its turn takes @Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?(?: damage)?\.(?: Effect: [^.]+\.?)?$/i.test(said);
        if (ending) {
            zone.damage.push({ when: "end", formulas: inlineTags(sentence, "Damage").map(readDamage) });
            continue;
        }
        const check = /(@Check\[[^\]]*\])(?:\{[^}]*\})?/.exec(said);
        // A save on whoever enters, starts or ends a turn in it, or is there as it's made.
        const subject = check ? said.slice(0, said.indexOf(check[0])) : "";
        if (check && /\bmust (?:attempt|succeed at|succeed on) an? $/i.test(subject)) {
            // (Batch 262: a save to get clear "or take" the damage, then when the damage counts after a semicolon — the damage; when it counts, a
            // note.)
            let rest = said.slice(said.indexOf(check[0]) + check[0].length).replace(/^\s*(?:saving throw|save)\b\s*/i, "").replace(/^to [^,;@]+? or\s+/i, "").replace(/^or\s+/i, "").replace(/\.$/, "");
            rest = rest.replace(/; (a creature takes the damage only once [^.]+)$/i, (_all, once) => {
                zone.notes.push(`${once[0].toUpperCase()}${once.slice(1)}.`);
                return "";
            });
            // ("The first time each round a creature takes piercing damage from these bones, it must …": as it moves in.)
            // (Batch 262: whoever is in the area as the ability is used, or comes in afterwards: as it's made, and on entering.)
            const when = [...(/\bwithin the area when (?:the [\w' -]+?|it|they) uses\b/i.test(subject) ? ["initial"] : []), ...(/\benters?\b|\bwho enter\b|^The first time each round an? creature takes [\w ]+? damage from (?:these|this|the)\b/i.test(subject) ? ["enter"] : []), ...(/\b(?:starts?|begins?) (?:its|their) turns?\b/i.test(subject) ? ["start"] : []), ...(/\bends? (?:its|their) turns?\b/i.test(subject) ? ["end"] : [])];
            const there = /^(?:Each|Every|All|Any) creatures? (?:with)?in (?:the|this|that) /i.test(subject) || /^Creatures (?:with)?in (?:the|this|that) /i.test(subject);
            // (Sandstorm: "Creatures within the emanation take a –4 circumstance penalty to Perception checks and must succeed at …".)
            const penalty = /^Creatures (?:with)?in (?:the|this|that) [\w' -]+? (take an? [–-]\d+ \w+ penalty to [^.]+?) and must /i.exec(subject);
            if (penalty) {
                inside = true;
                if (!link) zone.modifiers.push(...readPenalties(penalty[1].replace(/\bPerception checks\b/i, "Perception").replace(/^take/i, "takes")));
            }
            if (!when.length && !there) {
                open = null;
                zone.notes.push(said);
                continue;
            }
            saveOn(when.length ? when : penalty ? ["initial", "enter"] : ["initial"], check[1], rest, said);
            continue;
        }
        // Exposure on being there or entering ("Each creature that's in the cloud or enters it is exposed to purple pox."): a note for the GM.
        if (/^Each creature (?:that's|that is|who's) in the [\w' -]+? or enters it is exposed to\b/i.test(said)) {
            zone.saves.push({ when: ["initial", "enter"], plan: null, note: said });
            continue;
        }
        const exposed = /^(?:A|Any|Each) creature (?:that|who) (ends|starts|begins) its turn in the [\w' -]+? is exposed to\b/i.exec(said);
        if (exposed) {
            zone.saves.push({ when: [/^ends$/i.test(exposed[1]) ? "end" : "start"], plan: null, note: said });
            continue;
        }
        // What those inside take while there: a penalty, a weakness (PF2e's own effect when it gives one).
        if (/^(?:While in the area|Creatures (?:with)?in the (?:area|emanation|aura|cloud|storm))\b/i.test(said)) {
            inside = true;
            if (!link) {
                const read = readPenalties(said.replace(/\bPerception checks\b/i, "Perception").replace(/\btake\b/i, "takes"));
                if (read.length) zone.modifiers.push(...read);
                else zone.notes.push(said);
            }
            continue;
        }
        // Its allies inside (Cleansing Earth): PF2e's effect on them; ignoring its terrain, a note.
        if (/^Additionally, all allies in the [\w' -]+? gain\b/i.test(said) && link) {
            allies = true;
            if (/\bcan ignore the difficult terrain\b/i.test(said)) zone.notes.push("Its allies ignore the difficult terrain.");
            continue;
        }
        zone.notes.push(readableText(said));
    }
    if (!zone.area) return null;
    // Each save: its results read as a save would be, else noted.
    for (const save of zone.saves) {
        if (save.plan === null && save.note) continue;
        const sub = `${save.sub}${save.follow.map((sentence) => `<p>${sentence}</p>`).join("")}`;
        const plan = inlineSave(withDescription(item, sub), actor);
        const targeting = { target: "1 creature", range: null, area: null };
        save.plan = plan?.resolution?.kind === "save" ? { ...plan, targeting, trigger: { event: "zone" } } : { ...base(item), targeting, trigger: { event: "zone" }, resolution: { kind: "save", check: { roll: "save", statistic: readCheck(save.check.slice(7, -1))?.statistic ?? "fortitude", basic: false, against: { dc: "fixed", value: readCheck(save.check.slice(7, -1))?.dc ?? null } }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: none(), failure: { ...none(), manualInstructions: [htmlToPlainText(save.said)] }, criticalFailure: { ...none(), manualInstructions: [htmlToPlainText(save.said)] } } } };
        if (!Number.isFinite(save.plan.resolution.check?.against?.value)) return null;
        delete save.check;
        delete save.sub;
        delete save.said;
        delete save.follow;
    }
    // PF2e's own effect: on whoever fails a save whose failure reads nothing else; else on those inside (its allies only when it says so).
    // (Two of them, a failure's and a critical failure's: the save's own, not the zone's.)
    if (link && (html.match(new RegExp(ZONE_EFFECT.source, "g")) ?? []).length === 1) {
        const effect = { uuid: link[1], label: link[2].replace(/^Effect:\s*/i, "") };
        const bare = !inside && !allies ? zone.saves.find((save) => save.plan?.resolution && !save.plan.resolution.outcomes.failure.effects.length && !(save.plan.resolution.outcomes.failure.modifiers ?? []).length) : null;
        if (bare) for (const degree of ["failure", "criticalFailure"]) bare.plan.resolution.outcomes[degree] = { ...bare.plan.resolution.outcomes[degree], nativeEffects: [{ ...effect }], manualInstructions: undefined };
        else zone.effect = { ...effect, ...(allies ? { allies: true } : {}) };
    }
    if (zone.hazard && !zone.hazard.formulas.length) zone.hazard = null;
    if (!zone.concealed && !zone.terrain.length && !zone.hazard && !zone.saves.length && !zone.damage.length && !zone.effect && !zone.modifiers.length) return null;
    // (Something that lasts: a time, an end by its maker, cover or terrain, what entering or a turn there brings, what those inside have — not
    // a one-off area with PF2e's effect, Fog of Chance's.)
    const lasting = zone.lasts || zone.untilReused || zone.concealed || zone.terrain.length || zone.hazard || zone.damage.length || zone.saves.some((save) => save.when.some((when) => when !== "initial")) || inside || allies;
    if (!lasting) return null;
    const trigger = read ? { ...read, reaction: true, ...(type === "free" ? { free: true } : {}) } : triggerText ? { event: "unread" } : null;
    return { builtin: "zone", actions: Number(item.system?.actions?.value) || (type === "action" ? 1 : 0), ...(trigger || recharge ? { trigger: { ...(trigger ?? { event: "use" }), ...(recharge ? { recharge: { formula: recharge, unit: "rounds" } } : {}) } } : {}), zone: { ...zone, notes: [...new Set(zone.notes)] } };
}

// Saves in words the other readers don't take (2026-10-12, batch 257). null otherwise:
// - "You are now Stunned for 1 round unless you succeeded on a … save." (Dead Gaze) → the condition for that time on a failure;
// - "… must attempt a … save or their dying condition increases by 1 and the X regains 2d8 Hit Points" (Soul Feeding), "If the target is
//   dying, it must attempt a … save; on a failure, its dying value increases by 2 (3 on a critical failure)." (Eat Soul, Steal Soul) → the
//   dying value raised on the creature beside it, the Hit Points on itself; a dead target, a note;
// - "All creatures in a cone must succeed at a … save or be pulled adjacent to the X." (Vacuum Mouth) → a pull as far as its area;
//   "pulls all creatures … in a cone … towards its mouth. A successful … save halves the distance, or avoids the pull on a critical
//   success." (Enormous Inhalation) → the pull, half on a success;
// - "The target can avoid becoming marked with a successful … save." and PF2e's effect (Mark Target) → the effect on a failure.
function phrasedSave(item, actor) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const checks = inlineTags(html, "Check").map(readCheck).filter((check) => check?.save && check.dc);
    if (checks.length !== 1) return null;
    const check = checks[0];
    const plain = htmlToPlainText(html.replace(/@Check\[[^\]]*\](?:\{[^}]*\})?/g, "@C").replace(/@Template\[[^\]]*\](?:\{[^}]*\})?/g, "@T").replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g, "@D").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const owner = actor ?? item.actor ?? item.parent;
    const saveOf = (targeting, failure, criticalFailure, extra = {}) => ({ ...base(item), targeting, trigger: { event: "use" }, resolution: { kind: "save", check: { roll: "save", statistic: check.statistic, basic: false, against: { dc: "fixed", value: check.dc } }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: extra.success ?? none(), failure, criticalFailure } }, ...(extra.notes?.length ? { notes: extra.notes } : {}), ...(extra.requires ? { requires: extra.requires } : {}) });
    const gaze = /(?:^|\. )(?:You are|The target is) now ([A-Z][a-z-]+)(?: (\d))? for (\d+ (?:rounds?|minutes?)) unless (?:you|it) succeeded on an? @C save\.$/.exec(plain);
    if (gaze && STAGE_CONDITIONS.includes(gaze[1].toLowerCase())) {
        const row = { ...none(), effects: [{ kind: "condition", slug: gaze[1].toLowerCase(), value: gaze[2] ? Number(gaze[2]) : null, duration: readDuration(`for ${gaze[3]}`) }] };
        return saveOf({ target: "1 creature", range: "30 feet", area: null }, row, row);
    }
    // The dying value raised (and Hit Points it gains).
    const dying = /\b(?:their|its) dying (?:condition|value) increases by (\d)(?: \((\d) on a critical failure\))?(?: and (?:the [\w' -]+?|it) regains @D Hit Points)?\./i.exec(plain);
    if (dying && /\bdying creature\b|\bIf the target is dying\b/i.test(plain)) {
        const heal = inlineTags(html, "Damage").map(readDamage).find((formula) => /healing/i.test(formula));
        const raise = (by) => ({ kind: "condition", slug: "dying", value: by, duration: null, stack: { by } });
        const healed = heal ? [{ kind: "heal", formula: heal.replace(/\[healing\]/i, ""), recipient: "self" }] : [];
        const dead = /\bIf the target is dead\b[^.]*\.(?:[^.]*\.)*/i.exec(plain)?.[0];
        // (Only at a dying creature beside it: a requirement the GM sees.)
        return saveOf({ target: "1 creature", range: "touch", area: null }, { ...none(), effects: [raise(Number(dying[1])), ...healed] }, { ...none(), effects: [raise(Number(dying[2] ?? dying[1])), ...healed] }, { requires: "requirement", notes: ["Only at a dying creature beside it.", ...(dead ? ["A dead creature gets no save: its soul is the GM's."] : [])] });
    }
    const template = inlineTags(html, "Template").map(readTemplate).find(Boolean);
    const name = String(owner?.name ?? item.name).toLowerCase().split(/[^a-z']+/).filter((word) => word.length > 2);
    const toward = (rest) => new RegExp(`\\b(?:the (?:[\\w' -]*?)?(?:${name.join("|") || "creature"})|it|its mouth|it's mouth)\\b`, "i").test(rest);
    const pulled = /^(?:[^.]+\. )*?All creatures in an? @T must succeed at an? @C save or be pulled adjacent to ([^.]+)\.((?: [^.]+\.)*)$/i.exec(plain);
    if (pulled && template && toward(pulled[1])) {
        const row = { ...none(), forcedMovement: { kind: "pull", distance: Number(template.value), upTo: true, optional: false, direction: "toward" } };
        return saveOf({ target: null, range: null, area: template }, row, row, { notes: pulled[2].trim() ? pulled[2].trim().split(/(?<=\.)\s+/) : [] });
    }
    const inhale = /\bpulls all creatures(?: and objects)? in an? @T(?: (\d+) feet)? towards? ([^.]+)\. A successful @C save halves the distance, or avoids the pull on a critical success\.((?: [^.]+\.)*)$/i.exec(plain);
    if (inhale && template && toward(inhale[2])) {
        const pull = (distance) => ({ ...none(), forcedMovement: { kind: "pull", distance, upTo: false, optional: false, direction: "toward" } });
        return saveOf({ target: null, range: null, area: template }, pull(Number(template.value)), pull(Number(template.value)), { success: pull(Math.floor(Number(template.value) / 2)), notes: inhale[3].trim() ? inhale[3].trim().split(/(?<=\.)\s+/) : [] });
    }
    const link = ZONE_EFFECT.exec(html);
    const marked = /\bThe target can avoid becoming (\w+) with a successful @C save\./i.exec(plain);
    if (marked && link) {
        const range = Number(/\ba target within (\d+) feet\b/i.exec(plain)?.[1]) || 30;
        const row = { ...none(), nativeEffects: [{ uuid: link[1], label: link[2].replace(/^Effect:\s*/i, "") }] };
        const notes = plain.split(/(?<=\.)\s+/).filter((sentence) => /\b(?:Sustain|Dismiss|fades away)\b/i.test(sentence));
        return saveOf({ target: "1 creature", range: `${range} feet`, area: null }, row, row, { notes });
    }
    return null;
}

// A move through creatures with a Strike's damage on each (2026-10-12, batch 257): "The augur Flies or Strides, whirling as they move. The augur
// deals the damage of their blade Strike to each creature whose space they enter (basic Reflex save)." "… Swimming twice in a straight line and
// moving through the spaces of Huge or smaller creatures. … deals the damage of their jaws Strike to each creature whose space they enter … Any
// creature that critically fails is automatically Swallowed Whole." "… Strides up to double its Speed in a straight line. … Any creature the
// striding fire was adjacent to at any point during this Stride must attempt a basic Reflex save. If it critically fails, it's knocked Prone."
// → Trample's targeting (its moves; the size it says, else any), the Strike's damage on a basic save; Prone on a critical failure; the rest notes.
function passThrough(item, actor) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const checks = inlineTags(html, "Check").map(readCheck).filter((check) => check?.save && check.dc);
    if (checks.length !== 1 || !checks[0].basic || checks[0].statistic !== "reflex") return null;
    const plain = htmlToPlainText(html.replace(/@Check\[[^\]]*\](?:\{[^}]*\})?/g, "@C").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\[\[\/(?:r|gmr|br) [^\]]*\]\](?:\{([^}]*)\})?/g, "$1")).replace(/\s+/g, " ").trim();
    const sentences = plain.split(/(?<=\.)\s+(?=[A-Z])/);
    const moves = /\b(?:Flies or Strides|Strides or Flies|Strides up to double (?:its|their) Speed|(?:Swimming|Striding|Flying) twice|Strides twice|Flies twice)\b/i.exec(plain);
    const hits = /\bdeals the damage of (?:its|their|his|her) ([\w' -]+?) Strike to each creature whose space (?:it|they|he|she) enters? \((?:@C(?: save)?|basic Reflex save)\)\.?/i.exec(plain);
    const beside = /\bAny creature (?:the [\w' -]+?|it) was adjacent to at any point during this (?:Stride|movement|move) must attempt an? @C(?: save)?\./i.exec(plain);
    if (!moves || (!hits && !beside)) return null;
    const twice = /\btwice\b|\bdouble\b/i.test(moves[0]);
    const size = sizeOf(/\b((?:tiny|small|medium|large|huge|gargantuan) or smaller)\b/i.exec(plain)?.[1] ?? "") ?? "gargantuan";
    const components = hits ? strikeComponents(item, hits[1], actor) : [];
    if (hits && !components.length) return null;
    const rows = components.length ? basicRows(components.map((component) => component.id)) : { criticalSuccess: none(), success: none(), failure: none(), criticalFailure: none() };
    if (/\bIf it critically fails, it's knocked Prone\b|\bcritically fails? (?:is|are) knocked Prone\b/i.test(plain)) rows.criticalFailure = { ...rows.criticalFailure, effects: [...(rows.criticalFailure.effects ?? []), { kind: "condition", slug: "prone", value: null, duration: null }] };
    const read = (sentence) => moves && sentence.includes(moves[0]) || (hits && sentence.includes(hits[0].slice(0, 30))) || (beside && sentence.includes(beside[0].slice(0, 30))) || /\bknocked Prone\b/i.test(sentence) || /\bcan(?:'|’)?t use [\w' -]+? (?:again )?for\b/i.test(sentence);
    const notes = sentences.filter((sentence) => !read(sentence) && !/^The [\w' -]+? (?:stretches|barrels|whirls)\b/i.test(sentence));
    // (Also "can't use Burning Rush for 1d4 rounds", without "again".)
    const recharge = readRecharge(html) ?? /\bcan(?:'|’)?t use [\w' -]+? for \[\[\/(?:gm|b)?r (\d+d\d+)/i.exec(html)?.[1] ?? null;
    return {
        ...base(item),
        targeting: { target: beside ? "creatures it passes beside" : "creatures whose space it moves through", range: null, area: null, trample: { size, strides: twice ? 2 : 1 } },
        trigger: { event: "use", ...(recharge ? { recharge: { formula: recharge, unit: "rounds" } } : {}) },
        resolution: { kind: "save", check: { roll: "save", statistic: "reflex", basic: true, against: { dc: "fixed", value: checks[0].dc } }, sharedDamage: components.length ? { rollOnce: true, components } : null, outcomes: rows },
        ...(notes.length ? { notes } : {})
    };
}

// A follow-up that moves the creature hit and knocks it down (2026-10-12, batch 257, Pitch Bale): "Requirements The farmer's last action was a
// successful pitchfork Strike Effect The farmer moves the creature they hit with their pitchfork up to 5 feet, and the target falls Prone. The
// target can attempt a … save to avoid falling prone and avoids being moved altogether on a critical success." → on that creature: moved and
// Prone on a failure, moved on a success, nothing on a critical success. null otherwise.
function moveAndDrop(item) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const checks = inlineTags(html, "Check").map(readCheck).filter((check) => check?.save && check.dc);
    if (checks.length !== 1) return null;
    const plain = htmlToPlainText(html.replace(/@Check\[[^\]]*\](?:\{[^}]*\})?/g, "@C").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const match = /^Requirements (.+?) Effect (?:The )?[\w' -]+? moves the creature (?:it|they|he|she) hit with (?:its|their|his|her) [\w' -]+? up to (\d+) feet, and the target falls Prone\. The target can attempt an? @C save to avoid falling prone and avoids being moved altogether on a critical success\.$/i.exec(plain);
    const last = match ? followUpNeed(match[1]) : null;
    if (!match || !last) return null;
    const move = { kind: "push", distance: Number(match[2]), upTo: true, optional: true, direction: "any" };
    return {
        ...base(item),
        targeting: { target: "the creature the Strike hit", range: "touch", area: null },
        trigger: { event: "use", followUp: last },
        resolution: { kind: "save", check: { roll: "save", statistic: checks[0].statistic, basic: false, against: { dc: "fixed", value: checks[0].dc } }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: { ...none(), forcedMovement: { ...move } }, failure: { ...none(), effects: [{ kind: "condition", slug: "prone", value: null, duration: null }], forcedMovement: { ...move } }, criticalFailure: { ...none(), effects: [{ kind: "condition", slug: "prone", value: null, duration: null }], forcedMovement: { ...move } } } },
        notes: [`It moves the creature up to ${match[2]} feet in any direction.`]
    };
}

// A save to dodge an exposure (2026-10-12, batch 257): "… spit a sticky glob of their venom to a range of 50 feet that explodes in a 10-foot
// burst. Those in the burst must succeed at a … Reflex save or be exposed to jungle drake venom." → that save in the area; a failure brings the
// creature's own affliction's save after it (a follow-up, with the affliction handed on). null otherwise.
function exposedOnFail(item, actor) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const checks = inlineTags(html, "Check").map(readCheck).filter((check) => check?.save && check.dc);
    const template = inlineTags(html, "Template").map(readTemplate).find(Boolean);
    if (checks.length !== 1 || inlineTags(html, "Damage").length) return null;
    // (Batch 263, Sun's Heat: "… Flies up to its fly Speed. All creatures directly below the spaces it moves through must succeed at a … save or be exposed
    // to sun's touch poison. …" — the creatures under its flight, the GM's targets.)
    if (!template) {
        const flatPlain = htmlToPlainText(html.replace(/@Check\[[^\]]*\](?:\{[^}]*\})?/g, "@C")).replace(/\s+/g, " ").trim();
        const under = /^(?:The )?[\w' -]+? Flies (?:up to its fly Speed|twice)\. All creatures directly below the spaces it moves through must succeed at an? @C save or be exposed to ([^.]+)\.((?: [^.]+\.)*)$/i.exec(flatPlain);
        const named = under ? under[1].toLowerCase().replace(/^the /, "") : "";
        const affliction = under ? ownAffliction(item, actor, named) ?? ownAffliction(item, actor, named.replace(/^[\w' -]+?['’]s /, "")) : null;
        if (!affliction?.resolution?.afflictionHandoff) return null;
        const follow = { ...none(), followUps: [{ kind: "save", check: affliction.resolution.check, outcomes: affliction.resolution.outcomes, afflictionHandoff: affliction.resolution.afflictionHandoff }] };
        return { ...base(item), targeting: { target: "the creatures below its flight", range: null, area: null }, trigger: { event: "use" }, resolution: { kind: "save", check: { roll: "save", statistic: checks[0].statistic, basic: false, against: { dc: "fixed", value: checks[0].dc } }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: none(), failure: follow, criticalFailure: structuredClone(follow) } }, notes: ["It Flies first; the creatures under its path save.", ...(under[2].trim() ? [under[2].trim()] : [])] };
    }
    const plain = htmlToPlainText(html.replace(/@Check\[[^\]]*\](?:\{[^}]*\})?/g, "@C").replace(/@Template\[[^\]]*\](?:\{[^}]*\})?/g, "@T").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\[\[\/(?:r|gmr|br) [^\]]*\]\](?:\{([^}]*)\})?/g, "$1")).replace(/\s+/g, " ").trim();
    const sentences = plain.split(/(?<=\.)\s+(?=[A-Z])/);
    const save = sentences.findIndex((sentence) => /^(?:Those in the|Creatures caught in the|Each creature in the|All creatures in the) (?:burst|area|cone|blast|line|emanation|spray|cloud) must succeed at an? @C save or be exposed to [^.]+\.$/i.test(sentence));
    if (save < 0 || !sentences.slice(0, save).some((sentence) => sentence.includes("@T"))) return null;
    const phrase = /exposed to ([^.]+)\.$/i.exec(sentences[save])[1].toLowerCase().replace(/^the /, "").replace(/^[\w' -]+?['’]s /, "");
    const affliction = ownAffliction(item, actor, phrase);
    if (!affliction?.resolution?.afflictionHandoff) return null;
    const recharge = readRecharge(html);
    const range = Number(/\bto a range of (\d+) feet\b|\bwithin (\d+) feet\b/i.exec(plain)?.slice(1).find(Boolean)) || null;
    const follow = { ...none(), followUps: [{ kind: "save", check: affliction.resolution.check, outcomes: affliction.resolution.outcomes, afflictionHandoff: affliction.resolution.afflictionHandoff }] };
    const notes = sentences.filter((sentence, index) => index !== save && !sentence.includes("@T") && !/\bcan(?:'|’)?t use [\w' -]+? (?:again )?for\b/i.test(sentence));
    return {
        ...base(item),
        targeting: { target: null, range: range && template.type === "burst" ? `${range} feet` : null, area: template },
        trigger: { event: "use", ...(recharge ? { recharge: { formula: recharge, unit: "rounds" } } : {}) },
        resolution: { kind: "save", check: { roll: "save", statistic: checks[0].statistic, basic: false, against: { dc: "fixed", value: checks[0].dc } }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: none(), failure: follow, criticalFailure: structuredClone(follow) } },
        ...(notes.length ? { notes } : {})
    };
}

// Its allies around it quickened (2026-10-12, batch 258, Frenzy Pheromone): "… unleashes a pheromone that causes all other ankhravs within a
// 100-foot emanation to become Quickened until the start of the hive mother's next turn, and they can use the extra action only for Burrow,
// Stride, or Strike actions." → Quickened on its allies in that emanation for that time; its own kind only and the extra action's limits,
// notes; its recharge. null otherwise.
function alliesQuickened(item) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const template = inlineTags(html, "Template").map(readTemplate).find(Boolean);
    if (template?.type !== "emanation" || inlineTags(html, "Check").length || inlineTags(html, "Damage").length) return null;
    const plain = htmlToPlainText(html.replace(/@Template\[[^\]]*\](?:\{[^}]*\})?/g, "@T").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\[\[\/(?:r|gmr|br) [^\]]*\]\](?:\{([^}]*)\})?/g, "$1")).replace(/\s+/g, " ").trim();
    const match = /^(?:The )?[^.]+? (?:unleashes|releases|emits|lets out) [^.]+? that causes all other ([\w' -]+?) within an? @T to become Quickened (until the (?:start|end) of (?:the [\w' -]+?['’]s|its|their) next turn), and they can use the extra action only for ([^.]+?) actions\.(?: (?:The )?[^.]+? can(?:'t|not) [^.]+? again for \d+d\d+ rounds\.)?$/i.exec(plain);
    if (!match) return null;
    const recharge = readRecharge(html);
    const quick = { ...none(), effects: [{ kind: "condition", slug: "quickened", value: null, duration: readDuration(match[2].replace(/\bof (?:the [\w' -]+?['’]s|their) next turn/i, "of its next turn")) }] };
    return {
        ...base(item),
        targeting: { target: null, range: null, area: { type: "emanation", value: Number(template.value) }, allies: true },
        trigger: { event: "use", ...(recharge ? { recharge: { formula: recharge, unit: "rounds" } } : {}) },
        resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: quick, failure: none(), criticalFailure: none() } },
        notes: [`Only its own kind (${match[1]}), not itself.`, `The extra action only for ${match[3]} actions.`]
    };
}

// What it does to a creature it holds (2026-10-12, batch 259). null otherwise:
// - "Requirements A creature is Grabbed or Restrained in the nasurgeth's jaws Effect The nasurgeth breaks a tooth off in the target, who takes
//   3d10 bleed and is no longer grabbed or restrained. If the target is adjacent to a surface, … Immobilized (Escape DC 45)." → that damage, the
//   hold ended; the pin a note;
// - "… tosses the creature into the air and distends their jaw to catch it in their mouth. The target is grabbed in the aigamuxa's jaws, and the
//   aigamuxa attempts to Swallow it Whole. If the aigamuxa fails the Athletics check, the target … falls 30 feet …" → its own Swallow Whole;
// - "The chuul transfers the grabbed creature from its claws to its tentacles, or vice versa. The creature is exposed to the chuul's draining
//   venom when transferred into the tentacles and at the start of each of the chuul's turns …" → its own venom on that creature.
function heldCreature(item, actor, options = {}) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const plain = htmlToPlainText(html.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g, "@D").replace(/\[\[\/act escape dc=(\d+)\]\](?:\{[^}]*\})?/g, "Escape DC $1")).replace(/\s+/g, " ").trim();
    // (Batch 261, Abduct: "The sky fisher reels in a target Grabbed by its tentacles, pulling them into an adjacent space, and then attempts to Swallow
    // them Whole (Large, @Damage[(3d8+12)[acid]], Rupture 25). The sky fisher can only use Swallow Whole when using Abduct." — the Swallow Whole it
    // lists, PF2e's glossary ability with those numbers, on the creature it holds.)
    const abduct = /^(?:The )?[^.]+? (?:reels|pulls|drags) in a (?:target|creature) Grabbed by (?:its|their) [\w' -]+?, pulling (?:them|it) into an adjacent space, and then attempts to Swallow (?:them|it) Whole \((Tiny|Small|Medium|Large|Huge|Gargantuan), @D, Rupture (\d+)\)\.(?: (?:The )?[^.]+? can only use Swallow Whole when using [^.]+\.)?$/i.exec(plain);
    if (abduct) {
        const damage = inlineTags(html, "Damage")[0];
        if (!damage) return null;
        let plan = null;
        try {
            plan = compileMonsterAbility({ type: "action", name: "Swallow Whole", system: { slug: "swallow-whole", actionType: { value: "action" }, actions: { value: 1 }, traits: { value: [] }, description: { value: `<p>${abduct[1]}, [[/r ${damage}]] damage, Rupture ${abduct[2]}</p><hr /><p>@Localize[PF2E.NPC.Abilities.Glossary.SwallowWhole]</p>` } } }, { ...options, actor: actor ?? item.actor ?? item.parent });
        } catch {
            plan = null;
        }
        if (!plan?.resolution) return null;
        return { ...plan, source: base(item).source, activation: { time: String(Number(item.system?.actions?.value) || 1), traits: [...new Set([...(item.system?.traits?.value ?? []), ...(plan.activation?.traits ?? [])])] }, targeting: { ...(plan.targeting ?? {}), grabbed: true }, notes: [...(plan.notes ?? []), "It first pulls the creature into a space beside it."] };
    }
    const held = /^Requirements? (?:(?:A|An) (?:(?:Small|Medium|Large|Tiny) or smaller )?creature is Grabbed(?: or Restrained)? in (?:the [\w' -]+?['’]s|its|their) ([\w' -]+?)|(?:The )?[\w' -]+? has an? (?:(?:Small|Medium|Large|Tiny) or smaller )?creature Grabbed(?: or Restrained)?)\.? Effect (.+)$/i.exec(plain);
    if (!held) return null;
    const effect = held[2];
    const grabbed = { target: "the creature it holds", range: "touch", area: null, grabbed: true };
    const owner = actor ?? item.actor ?? item.parent;
    const barb = /^(?:The )?[^.]+? breaks [^.]+? in the target, who takes @D and is no longer grabbed or restrained\.((?: [^.]+\.)*)$/i.exec(effect);
    if (barb) {
        const formulas = inlineTags(html, "Damage").map(readDamage).map((formula) => ({ formula }));
        const success = { damage: { mode: "formulas", formulas, rollScope: "outcome" }, effects: [{ kind: "end-condition", slugs: ["grabbed", "restrained"] }] };
        return { ...base(item), targeting: grabbed, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success, failure: none(), criticalFailure: none() } }, ...(barb[1].trim() ? { notes: barb[1].trim().split(/(?<=\.)\s+/) } : {}) };
    }
    if (/\battempts to Swallow (?:it|the creature|the target) Whole\b/i.test(effect)) {
        const swallow = [...(owner?.items ?? [])].find((entry) => entry?.type === "action" && /^Swallow Whole$/i.test(entry.name ?? ""));
        let plan = null;
        try {
            plan = swallow ? compileMonsterAbility(swallow, { ...options, actor: owner }) : null;
        } catch {
            plan = null;
        }
        if (!plan?.resolution) return null;
        const notes = effect.split(/(?<=\.)\s+(?=[A-Z])/).filter((sentence) => !/\battempts to Swallow\b/i.test(sentence) && !/^(?:The )?[^.]+? tosses the creature into the air\b/i.test(sentence));
        return { ...plan, source: base(item).source, activation: { time: String(Number(item.system?.actions?.value) || 1), traits: plan.activation?.traits ?? [] }, notes: [...(plan.notes ?? []), ...notes] };
    }
    const venom = /^(?:The )?[^.]+? transfers the grabbed creature from (?:its|their) ([\w' -]+?) to (?:its|their) ([\w' -]+?), or vice versa\. (?:The|A) creature is exposed to (?:the [\w' -]+?['’]s|its|their) ([\w' -]+?) when transferred into the \2(?: and [^.]+)?\.$/i.exec(effect);
    if (venom) {
        const poison = ownAffliction(item, actor, venom[3].toLowerCase());
        if (!poison) return null;
        return { ...poison, source: base(item).source, activation: { time: String(Number(item.system?.actions?.value) || 1), traits: poison.activation?.traits ?? [] }, targeting: grabbed, trigger: { event: "use" }, notes: [`Only when it moves the creature into its ${venom[2]}; it's exposed again at the start of each of its turns while it stays there.`] };
    }
    return null;
}

// Its Breath Weapon in another shape (2026-10-12, batch 262, Battlezoo): while enraged it uses its Breath Weapon with a line and a burst at its end
// in place of the usual area, with persistent damage added on a critical failure and a longer recharge. → that Breath Weapon's plan with the line as
// its area (the burst a note), the extra damage on a critical failure, its own recharge shared with the Breath Weapon (sharesRecharge), requires
// "raging". null otherwise.
function reshapedBreath(item, actor, options = {}) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const templates = inlineTags(html, "Template").map(readTemplate).filter(Boolean);
    const extra = inlineTags(html, "Damage").map(readDamage);
    const plain = htmlToPlainText(html.replace(/@Template\[[^\]]*\](?:\{[^}]*\})?/g, "@T").replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g, "@D").replace(/\[\[\/(?:b|gm)?r (\d+d\d+)[^\]]*\]\](?:\{([^}]*)\})?/g, (_all, dice, label) => label ?? dice)).replace(/\s+/g, " ").trim();
    const match = /^(?:Frequency [^.]+?\s+)?Requirements? (?:The )?[\w' -]+? is (?:enraged|raging) and can use (?:its|their) Breath Weapon\.?\s+Effect (?:(?:The )?[^.@\d]+\. )?(?:The )?[\w' -]+? uses (?:its|their) Breath Weapon(?:, but the area is| with its area changed to) an? @T(?: and an? @T (centered on the end of the line|where the line ends))?\. On a critical failure, (?:creatures? takes? @D damage, in addition to the normal effects|an? creature also takes @D damage)\. (?:The )?[\w' -]+? can(?:'t|not) use (?:its|their) Breath Weapon again for (\d+d\d+) rounds?(?:, instead of the usual \d+d\d+ rounds?)?\.$/i.exec(plain);
    if (!match || !templates.length || extra.length !== 1) return null;
    const owner = actor ?? item.actor ?? item.parent;
    const breath = [...(owner?.items?.contents ?? owner?.items ?? [])].find((other) => other !== item && /^Breath Weapon$/i.test(other?.name ?? ""));
    let plan = null;
    try {
        plan = breath ? compileMonsterAbility(breath, { ...options, actor: owner }) : null;
    } catch {
        plan = null;
    }
    if (plan?.resolution?.kind !== "save" || !plan.resolution.outcomes?.criticalFailure) return null;
    const outcomes = structuredClone(plan.resolution.outcomes);
    const worst = outcomes.criticalFailure.damage ?? none().damage;
    const added = [{ formula: extra[0] }];
    outcomes.criticalFailure.damage = worst.mode === "shared" ? { mode: "mixed", shared: worst, formulas: added, rollScope: "outcome" } : worst.mode === "formulas" || worst.mode === "mixed" ? { ...worst, formulas: [...(worst.formulas ?? []), ...added] } : { mode: "formulas", formulas: added, rollScope: "outcome" };
    const second = match[1] && templates[1] ? [`Its area also takes in a ${templates[1].value}-foot ${templates[1].type} where the line ends.`] : [];
    return {
        ...plan,
        source: base(item).source,
        activation: { time: String(Number(item.system?.actions?.value) || 2), traits: [...new Set([...(item.system?.traits?.value ?? []), ...(plan.activation?.traits ?? [])])] },
        targeting: { target: null, range: null, area: { type: templates[0].type, value: templates[0].value } },
        trigger: { event: "use", recharge: { formula: match[2], unit: "rounds" } },
        resolution: { ...plan.resolution, outcomes },
        requires: "raging",
        sharesRecharge: breath.name,
        notes: ["Only while it's enraged.", ...(plan.notes ?? []).filter((note) => !/\bagain for\b/i.test(note)), ...second, `It uses its ${breath.name}: that recharges too.`]
    };
}

// A save whose failure is PF2e's linked effect (2026-10-12, batch 263, Bad Deal): a few creatures in range each save, and a failure gives the effect
// the ability links (here a misfortune on its next roll) → the save at those creatures, the effect on a failure (and a critical failure). Only one
// save, one linked effect, no damage, no critical failure of its own. null otherwise.
function saveThenEffect(item) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const links = [...html.matchAll(/@UUID\[(Compendium\.[\w-]+\.(?:bestiary-effects|[\w-]*effects?)\.Item\.[A-Za-z0-9]{16})\]\{([^}]*)\}/g)];
    const checks = inlineTags(html, "Check").map(readCheck).filter((check) => check?.save && check.dc);
    if (links.length !== 1 || checks.length !== 1 || inlineTags(html, "Damage").length || inlineTags(html, "Template").length) return null;
    const plain = htmlToPlainText(html.replace(/@Check\[[^\]]*\](?:\{[^}]*\})?/g, "@C").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim().replace(/\s*Effect: [^.]+$/i, "");
    if (/\bcritical(?:ly)? fail/i.test(plain)) return null;
    const many = /\b(?:chooses|targets) up to (two|three|four|five|six|\d+) (?:creatures|enemies|foes) within (\d+) feet\. Each target must attempt an? @C save\. On a failure, [^.]+\.$/i.exec(plain);
    const one = many ? null : /\b(?:chooses|targets) (?:a|one) (?:creature|enemy|foe) within (\d+) feet\. The (?:target|creature) must attempt an? @C save\. On a failure, [^.]+\.$/i.exec(plain);
    if (!many && !one) return null;
    const count = many ? (/^\d+$/.test(many[1]) ? Number(many[1]) : { two: 2, three: 3, four: 4, five: 5, six: 6 }[many[1].toLowerCase()]) : 1;
    const row = { ...none(), nativeEffects: [{ uuid: links[0][1], label: links[0][2].replace(/^Effect:\s*/i, "") }] };
    return {
        ...base(item),
        targeting: { target: count > 1 ? `up to ${count} creatures` : "1 creature", range: `${many ? many[2] : one[1]} feet`, area: null },
        trigger: { event: "use" },
        resolution: { kind: "save", check: { roll: "save", statistic: checks[0].statistic, basic: false, against: { dc: "fixed", value: checks[0].dc } }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: none(), failure: row, criticalFailure: structuredClone(row) } }
    };
}

// Strikes in one-off words (2026-10-12, batch 263). null otherwise:
// - "Chea launches herself at a foe. She makes a Leap or attempts a High Jump or Long Jump. At the end of the jump, if she's adjacent to a foe, she can
//   immediately Strike that foe with an unarmed attack, even if the foe is in midair. She falls to the ground after the Strike. …" (Flying Kick) → a
//   charge with one jump; how it lands, a note;
// - "Requirements The weredigo is adjacent to two creatures that … Effect The weredigo makes two fork Strikes and two knife Strikes against one of the
//   adjacent creatures. These attacks don't count toward the weredigo's multiple attack penalty." (Reduce Options) → those Strikes at one creature
//   with no multiple attack penalty, its requirement the GM's.
function oneOffStrikes(item, actor = null) {
    if (item.system?.actionType?.value !== "action") return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const actions = Number(item.system?.actions?.value) || 1;
    const kick = /^(?:[^.]+\. )?(?:She|He|It|They|The [\w' -]+?|[A-Z][\w'-]+) makes a Leap or attempts a High Jump or Long Jump\. At the end of the jump, if (?:she's|he's|it's|they're) adjacent to a foe, (?:she|he|it|they) can immediately Strike that foe with an unarmed attack, even if the foe is in midair\.((?: [^.]+\.)*)$/i.exec(plain);
    if (kick) return { builtin: "charge", actions, strides: 1, strike: null, notes: ["It Leaps, High Jumps or Long Jumps instead of Striding, then makes an unarmed Strike (even at a foe in midair).", ...(kick[1].trim() ? kick[1].trim().split(/(?<=\.)\s+/) : [])] };
    // (Teleporting Clothesline: "Requirements … has a creature Grabbed or Restrained Effect The grappling spirit pushes the creature 15 feet in a straight
    // line. The spirit immediately teleports 20 feet to intercept. They make a ghostly hand Strike against the creature. On a hit, the creature is knocked
    // Prone, and on a critical hit, it also takes an additional 2d6 bludgeoning damage as it's driven to the ground." — that Strike at the creature it
    // holds, Prone on a hit and the extra damage on a critical hit; the push and the teleport first, notes.)
    const clothesline = /^Requirements? (?:The )?[\w' -]+? has a creature Grabbed or Restrained\.? Effect (?:The )?[\w' -]+? pushes the creature (\d+) feet in a straight line\. (?:The )?[\w' -]+? immediately teleports (\d+) feet to intercept\. (?:They|It|He|She) makes? an? ([\w' -]+?) Strike against the creature\. On a hit, the creature is knocked Prone, and on a critical hit, it also takes an additional @Damage\[(\d+d\d+)\[(\w+)\]\] damage as it's driven to the ground\.$/i.exec(plain);
    if (clothesline) return { builtin: "strike-activity", actions, strides: 0, strike: clothesline[3].toLowerCase(), attackBonus: 0, damageBonus: 0, offGuard: false, requires: "grabbed", oncePerFight: false, onHit: { conditions: [{ slug: "prone", value: null, duration: null }], critical: null, push: null, damage: [], save: null, size: null }, notes: [`First it pushes the creature ${clothesline[1]} feet in a straight line, then teleports up to ${clothesline[2]} feet to meet it.`, `On a critical hit, the creature also takes ${clothesline[4]} ${clothesline[5].toLowerCase()} damage.`] };
    // (Crimson Vengeance: "Requirements … wielding a ranged weapon with reload 0. Effect … makes two Strikes with the required weapon against a target that
    // has attacked … or one of their allies within the last round (the multiple attack penalty applies normally). If both hit the creature, combine their
    // damage …" — two Strikes with its ranged weapon at that creature; who may be the target and the combined damage, notes.)
    const owner = actor ?? item.actor ?? item.parent;
    const vengeance = /^(?:Frequency [^.]+? )?Requirements? (?:The )?[\w' -]+? is wielding a ranged weapon with reload 0\.? Effect (?:The )?[\w' -]+? makes two Strikes with the required weapon against a target that has attacked (?:the [\w' -]+?|it) or one of (?:its|their) allies within the last round \(the multiple attack penalty applies normally\)\. If both hit the creature, combine their damage for the purpose of resistances and weaknesses\.$/i.test(plain);
    if (vengeance) return { builtin: "multi-strike", actions, strikes: ["ranged", "ranged"], sameTarget: true, notes: ["Only at a creature that attacked it or an ally since its last turn; its ranged weapon (reload 0).", "If both hit, their damage is combined against resistances and weaknesses."] };
    // (Defensive Assault: "… makes two Strikes, each with a different weapon, and they use the remaining weapons for protection. The demon gains a circumstance
    // bonus to AC for 1 round equal to the number of weapons not used for attacks. …" — the two Strikes; the AC by its weapons left, a note.)
    if (/^(?:The )?[\w' -]+? makes two Strikes, each with a different weapon, and (?:they|it) uses? the remaining weapons for protection\. The [\w' -]+? gains a circumstance bonus to AC for 1 round equal to the number of weapons not used for attacks\./i.test(plain)) {
        const weapons = [...(owner?.items?.contents ?? owner?.items ?? [])].filter((entry) => entry?.type === "melee" && !(entry.system?.traits?.value ?? []).some((trait) => /^range/.test(trait))).map((entry) => String(entry.name).toLowerCase());
        const pair = [...new Set(weapons)].slice(0, 2);
        if (pair.length === 2) return { builtin: "multi-strike", actions, strikes: pair, sameTarget: false, notes: ["Each Strike with a different weapon; it gains a +1 circumstance bonus to AC for 1 round for each weapon it doesn't attack with (less for each it uses later)."] };
    }
    const both = /^Requirements? ([^.]+?)\.? Effect (?:The )?[\w' -]+? makes (two|three) ([\w' -]+?) Strikes and (two|three) ([\w' -]+?) Strikes against one of the adjacent creatures\. These attacks (?:don't|do not) count toward (?:the [\w' -]+?['’]s|its|their) multiple attack penalty\.$/i.exec(plain);
    if (both) {
        const times = (word) => (word.toLowerCase() === "three" ? 3 : 2);
        return { builtin: "multi-strike", actions, strikes: [...Array(times(both[2])).fill(both[3].toLowerCase()), ...Array(times(both[4])).fill(both[5].toLowerCase())], sameTarget: true, noMap: true, requires: "requirement", notes: [`Only when ${both[1][0].toLowerCase()}${both[1].slice(1)}.`] };
    }
    return null;
}

// A save or a lasting curse (2026-10-12, batch 263, Pharaoh's Ward): "Each living creature within 60 feet must succeed at a … Will save or be subjected to
// the pharaoh's curse. A cursed creature takes a -2 status penalty to Fortitude saves, and any natural or magical healing it receives is halved. The
// curse remains until removed by Cleanse Affliction or similar magic." → the save in that emanation; a failure, the penalty with no end of its own; the
// halved healing and how it ends, notes. null otherwise.
function cursedSave(item) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const checks = inlineTags(html, "Check").map(readCheck).filter((check) => check?.save && check.dc);
    if (checks.length !== 1 || inlineTags(html, "Damage").length) return null;
    const plain = htmlToPlainText(html.replace(/@Check\[[^\]]*\](?:\{[^}]*\})?/g, "@C").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const match = /^(?:[^@]+?\. )?Each (living )?creature within (\d+) feet must succeed at an? @C save or be subjected to (?:the [\w' -]+?['’]s|its) curse\. A cursed creature (takes an? [–-]\d+ (?:status|circumstance) penalty to [^,.]+?)(?:, and ([^.]+))?\.((?: [^.]+\.)*)$/i.exec(plain);
    const modifiers = match ? readPenalties(match[3]).map((modifier) => ({ ...modifier, duration: null })) : [];
    if (!match || !modifiers.length) return null;
    const cursed = { ...none(), modifiers };
    return {
        ...base(item),
        targeting: { target: null, range: null, area: { type: "emanation", value: Number(match[2]) } },
        trigger: { event: "use" },
        resolution: { kind: "save", check: { roll: "save", statistic: checks[0].statistic, basic: false, against: { dc: "fixed", value: checks[0].dc } }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: none(), failure: cursed, criticalFailure: structuredClone(cursed) } },
        notes: [...(match[1] ? ["Only living creatures."] : []), ...(match[4] ? [`A cursed creature: ${match[4]}.`] : []), ...(match[5].trim() ? [match[5].trim()] : [])]
    };
}

// Terrain and moves in one-off words (2026-10-12, batch 263). null otherwise:
// - "The hardhead mole leaves a burrow hole in its square or an adjacent square. The square becomes difficult terrain but can be flattened back into normal
//   terrain with an Interact action." (Shovel Earth) → a one-square zone of difficult terrain the GM places beside it, until flattened;
// - "The ecorche over-stresses its leg muscles for a massive jump. It loses 20 HP and Leaps up to 120 feet in any direction. If its next action is a
//   Strike or Flaying Flurry, it doesn't fall until after that action." (Muscular Leap) → the Hit Points it loses, on itself; the Leap, a note.
function oneOffGround(item) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const plain = htmlToPlainText(html.replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g, "@D")).replace(/\s+/g, " ").trim();
    const actions = Number(item.system?.actions?.value) || 1;
    if (/^(?:The )?[\w' -]+? leaves a [\w' -]+? in its square or an adjacent square\. The square becomes difficult terrain but can be flattened back into normal terrain with an Interact action\.$/i.test(plain)) {
        return { builtin: "zone", actions, trigger: { event: "use" }, zone: { area: { type: "square", value: 5 }, centre: "placed", range: 5, lasts: null, untilReused: false, concealed: false, terrain: [{ movement: ["walk"], difficulty: 2 }], others: false, hazard: null, saves: [], damage: [], effect: null, modifiers: [], notes: ["In its own square or one beside it.", "An Interact action flattens it back to normal terrain."] } };
    }
    const leap = /^(?:[^@]+?\. )?(?:It|They) loses? @D (?:HP|Hit Points) and Leaps up to (\d+) feet in any direction\.((?: [^.]+\.)*)$/i.exec(plain);
    const lost = leap ? inlineTags(html, "Damage").map(readDamage) : [];
    if (leap && lost.length === 1) {
        const success = { damage: { mode: "formulas", formulas: [{ formula: lost[0] }], rollScope: "outcome" }, effects: [] };
        return { ...base(item), targeting: { target: "self", range: null, area: null }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success, failure: none(), criticalFailure: none() } }, notes: [`It Leaps up to ${leap[1]} feet in any direction.`, ...(leap[2].trim() ? [leap[2].trim()] : [])] };
    }
    return null;
}

// More one-offs (2026-10-12, batch 263, third chunk). null otherwise:
// - Venomous Flight: "Flies twice, dripping venom … It chooses a creature it flew directly above during the flight, which is exposed to manticore venom. …"
//   → its own venom on that creature (the GM's target); the flight, a note;
// - Forage for Gems: "… Burrows up to its Speed. It must end its movement back on the surface. During its burrow, it happens upon 1d4 cheap gems …" → a
//   move, nothing for the fight;
// - Into the Earth: the creature it holds saves or is dragged under as it Burrows, escaping on a success and needing to hold its breath on a failure →
//   the save at the creature it holds: free on a success; dragged under on a failure, a note;
// - Static Field: "… releasing it in a 30-foot emanation that deals 3d12 electricity damage to all non-plant creatures (… save) and grants plant creatures
//   5 temporary Hit Points that last for 1 minute. …" → the basic save in that area; the plants' Hit Points and the rest, notes;
// - Great Wave: "… floods a mile burst. Any creature in the area must succeed at a … Reflex save or be moved up to 60 feet in a direction of the Great Flood's
//   choice. The area remains flooded …" → the save at every creature around it, a failure pushed that far; the flood, a note.
function moreOneOffs(item, actor) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const plain = htmlToPlainText(html.replace(/@Check\[[^\]]*\](?:\{[^}]*\})?/g, "@C").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\[\[\/(?:r|gmr|br) [^\]]*\]\](?:\{([^}]*)\})?/g, "$1")).replace(/\s+/g, " ").trim();
    const checks = inlineTags(html, "Check").map(readCheck).filter((check) => check?.save && check.dc);
    const flight = /^(?:The )?[\w' -]+? Flies twice, [^.]+\. It chooses a creature it flew directly above during the flight, which is exposed to ([^.]+)\.((?: [^.]+\.)*)$/i.exec(plain);
    if (flight) {
        const poison = ownAffliction(item, actor, flight[1].toLowerCase().replace(/^the /, "").replace(/^[\w' -]+?['’]s /, ""));
        if (!poison) return null;
        return { ...poison, source: base(item).source, activation: { time: String(Number(item.system?.actions?.value) || 1), traits: poison.activation?.traits ?? [] }, targeting: { target: "1 creature it flew over", range: null, area: null }, trigger: { event: "use" }, notes: ["It Flies twice first, over the creature.", ...(flight[2].trim() ? [flight[2].trim()] : [])] };
    }
    if (/^(?:[^.]+\. )?(?:The )?[\w' -]+? Burrows up to its Speed\. It must end its movement back on the surface\. During its burrow, it happens upon [^.]+\.$/i.test(plain)) return { builtin: "no-effect" };
    const dragged = /^Requirements? (?:The )?[\w' -]+? has an? (?:(?:Small|Medium|Large) or smaller )?creature Grabbed\.? Effect (?:[^@]+?\. )?The grabbed creature must succeed at an? @C save or be dragged beneath the ground as (?:the [\w' -]+?|it) Burrows up to its Speed\. If the target succeeds at its save, it Escapes and (?:the [\w' -]+?|it) continues burrowing as normal; if it fails, (the grabbed creature must hold its breath or begin suffocating under the dirt)\.$/i.exec(plain);
    if (dragged && checks.length === 1) {
        const free = { ...none(), effects: [{ kind: "end-condition", slugs: ["grabbed", "restrained"] }] };
        const under = { ...none(), manualInstructions: ["{target} is dragged under the ground as it Burrows: it must hold its breath or begin suffocating."] };
        return { ...base(item), targeting: { target: "the creature it holds", range: "touch", area: null, grabbed: true }, trigger: { event: "use" }, resolution: { kind: "save", check: { roll: "save", statistic: checks[0].statistic, basic: false, against: { dc: "fixed", value: checks[0].dc } }, sharedDamage: null, outcomes: { criticalSuccess: free, success: structuredClone(free), failure: under, criticalFailure: structuredClone(under) } }, notes: ["Either way it Burrows up to its Speed."] };
    }
    const field = /^(?:The )?[^@]+? (?:in|releasing it in) an? (@Template\[[^\]]*\]) that deals (@Damage\[(?:[^[\]]|\[[^\]]*\])*\]) damage to (?:all non-|every creature but )(\w+) creatures \((@Check\[[^\]]*\])(?:\{[^}]*\})? save\) and grants \3 creatures (\d+) temporary Hit Points that last for 1 minute\.((?: [^.@]+\.)*)/i.exec(htmlToPlainText(html.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim());
    if (field) {
        let plan = null;
        try {
            plan = inlineSave(withDescription(item, `<p>A blast in ${field[1]} deals ${field[2]} damage (${field[4].replace(/\]$/, "|basic]")} save).</p>`), actor);
        } catch {
            plan = null;
        }
        if (!plan?.resolution) return null;
        const recharge = readRecharge(html);
        return { ...plan, trigger: { ...(plan.trigger ?? {}), ...(recharge ? { recharge: { formula: recharge, unit: "rounds" } } : {}) }, notes: [`Not ${field[3].toLowerCase()} creatures: they gain ${field[5]} temporary Hit Points for 1 minute instead.`, ...field[6].trim().split(/(?<=\.)\s+/).filter((sentence) => sentence && !/\bcan(?:'|’)?t use\b/i.test(sentence))] };
    }
    const wave = /^(?:Frequency [^.]+? Effect )?(?:The )?[^.]+? floods a mile burst\. Any creature in the area must succeed at an? @C save or be moved up to (\d+) feet in a direction of (?:the [\w' -]+?['’]s|its) choice\.((?: [^.]+\.)*)$/i.exec(plain);
    if (wave && checks.length === 1) {
        const pushed = { ...none(), forcedMovement: { kind: "push", distance: Number(wave[1]), upTo: true, optional: false, direction: "choice" } };
        return { ...base(item), targeting: { target: null, range: null, area: { type: "emanation", value: 5280 } }, trigger: { event: "use" }, resolution: { kind: "save", check: { roll: "save", statistic: checks[0].statistic, basic: false, against: { dc: "fixed", value: checks[0].dc } }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: none(), failure: pushed, criticalFailure: structuredClone(pushed) } }, notes: ["A mile around it: every creature on the map.", ...(wave[2].trim() ? [wave[2].trim()] : [])] };
    }
    return null;
}

// Fourth chunk's one-offs (2026-10-12, batch 263). null otherwise:
// - Rear Back: "… stays Reared Back until it uses a single action to return to its normal stance. While … Reared Back, it is Clumsy 1 but can use its
//   Pinion and Yank abilities." → Clumsy 1 on itself until it ends it; the abilities it opens, a note;
// - Disharmonic Door: "… disappears, then bursts as a cacophonous sound from the throat of a creature within 240 feet. … appears within reach of the
//   creature and makes a melee Strike against it. The Strike deals an additional 2d12 sonic damage." → a teleport within that distance and the Strike
//   with that damage;
// - Paragon's Guard: "While … in this stance and wielding a shield, their shield is always raised." → its shield's AC bonus as a stance;
// - Zinba Restoration: "… bites a creature within reach and delivers a restorative healing remedy … takes 1 piercing damage, but then gains fast healing 5
//   for 1 minute. In addition, the restorative attempts a counteract check …" → the damage and PF2e's linked effect on that creature; the counteract,
//   a note.
function fourthOneOffs(item, actor) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const plain = htmlToPlainText(html.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g, "@D").replace(/\[\[\/(?:r|gmr|br) [^\]]*\]\](?:\{([^}]*)\})?/g, "$1")).replace(/\s+/g, " ").trim();
    const actions = Number(item.system?.actions?.value) || 1;
    const reared = /^(?:[^.]+\. )?(?:The )?[\w' -]+? stays ([A-Z][\w' -]+?) until it uses a single action to return to its normal stance\. While (?:the )?[\w' -]+? is \1, it is (Clumsy|Enfeebled|Off-Guard) ?(\d)?(?: but can use (?:its|their) ([^.]+?) abilities)?\.$/i.exec(plain);
    if (reared) {
        const success = { damage: none().damage, effects: [{ kind: "condition", slug: reared[2].toLowerCase(), value: reared[3] ? Number(reared[3]) : null, duration: null }] };
        return { ...base(item), targeting: { target: "self", range: null, area: null }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success, failure: none(), criticalFailure: none() } }, notes: [`It keeps the condition while ${reared[1]}: one action ends it (remove the condition then).`, ...(reared[4] ? [`Meanwhile it can use ${reared[4]}.`] : [])] };
    }
    const door = /^(?:The )?[^.]+? disappears, then bursts as [^.]+? from the throat of a creature within (\d+) feet\. (?:The )?[^.]+? appears within reach of the creature and makes a melee Strike against it\. The Strike deals an additional @D damage\.$/i.exec(plain);
    const doorDamage = door ? inlineTags(html, "Damage").map(readDamage) : [];
    if (door && doorDamage.length === 1) return { builtin: "strike-activity", actions, strides: 0, strike: null, attackBonus: 0, damageBonus: 0, offGuard: false, requires: null, oncePerFight: false, onHit: { conditions: [], critical: null, push: null, damage: [...doorDamage], save: null, size: null }, notes: [`It teleports beside a creature within ${door[1]} feet first.`] };
    if (/^While (?:the )?[\w' -]+? is in this stance and wielding a shield, (?:its|their|his|her) shield is always raised\.$/i.test(plain)) {
        const owner = actor ?? item.actor ?? item.parent;
        const shield = [...(owner?.items?.contents ?? owner?.items ?? [])].find((entry) => entry?.type === "shield");
        const value = Number(shield?.system?.acBonus) || 2;
        return { builtin: "self-effect", actions, model: { name: item.name, rounds: null, modifiers: [{ on: "ac", type: "circumstance", value }], tempHp: 0 }, damage: [], strike: null, melee: false, stance: true, duration: { value: -1, unit: "unlimited", expiry: null }, notes: ["Only while it wields a shield: its shield counts as raised."] };
    }
    const remedy = /^(?:The )?[\w' -]+? bites a creature within reach and delivers a restorative healing remedy instead of its venom\. The creature takes @D damage, but then gains fast healing (\d+) for 1 minute\.((?: [^.]+\.)*)/i.exec(plain);
    const link = remedy ? /@UUID\[(Compendium\.[\w-]+\.(?:bestiary-effects|[\w-]*effects?)\.Item\.[A-Za-z0-9]{16})\]\{([^}]*)\}/.exec(html) : null;
    const remedyDamage = remedy ? inlineTags(html, "Damage").map(readDamage) : [];
    if (remedy && link && remedyDamage.length === 1) {
        const success = { damage: { mode: "formulas", formulas: [{ formula: remedyDamage[0] }], rollScope: "outcome" }, effects: [], nativeEffects: [{ uuid: link[1], label: link[2].replace(/^Effect:\s*/i, "") }] };
        return { ...base(item), targeting: { target: "1 creature", range: "touch", area: null }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success, failure: none(), criticalFailure: none() } }, notes: remedy[2].trim().replace(/\s*Effect: [^.]+$/i, "").split(/(?<=\.)\s+/).filter(Boolean) };
    }
    return null;
}

// Fifth chunk's one-offs (2026-10-12, batch 265). null otherwise:
// - Pull the Strands: "The roper pulls every creature Grabbed by its strands toward itself. The roper rolls a single Athletics check and compares the result
//   to each Immobilized creature's Fortitude DC. The roper pulls each creature it succeeds against up to 25 feet closer and each creature it critically
//   succeeds against up to 50 feet closer." → that check at the creatures it holds, a pull by its degree;
// - Touch of Charity: "… touch another creature to take on that creature's wounds, transferring up to 30 of the horned archon's HP to the touched
//   creature …" (and the qarna's "touches a willing living creature … transfers up to 30 of their own HP to the touched creature") → that healing on the
//   creature; the Hit Points it loses, a note;
// - Piercing Shot: "… chooses two targets in a direct line, one of which must be giving lesser cover to the other, then makes a single ranged Strike with
//   its longbow against both targets. …" → a Strike at each (one roll, a note);
// - Implant: "Requirements … adjacent to a Unconscious, willing, or Paralyzed creature Effect The xill implants xill eggs in the creature's flesh." → its
//   own affliction on that creature, the requirement the GM's;
// - Blade of Justice: "… makes a greatsword Strike against a target it detects as evil. If the target is evil, the Strike deals three extra weapon damage
//   dice and deals 1d6 persistent spirit damage to the target. …" → the Strike with that persistent damage against an unholy (evil) creature; the extra
//   dice and the conversion, notes;
// - Rampant Growth: "Requirements A creature the tendriculos has Swallowed Whole has taken damage … Effect The tendriculos regains 3d8 Hit Points and
//   recovers from the Fatigued and Slowed conditions. It reduces any Enfeebled value it has by 2." → that healing and those conditions ended on itself.
function fifthOneOffs(item, actor) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const plain = htmlToPlainText(html.replace(/@Check\[[^\]]*\](?:\{[^}]*\})?/g, "@C").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g, "@D")).replace(/\s+/g, " ").trim();
    const actions = Number(item.system?.actions?.value) || 1;
    const owner = actor ?? item.actor ?? item.parent;
    const strands = /^(?:The )?[\w' -]+? pulls every creature Grabbed by its [\w' -]+? toward itself\. (?:The )?[\w' -]+? rolls a single @C check and compares the result to each (?:Immobilized|Grabbed) creature['’]s Fortitude DC\. (?:The )?[\w' -]+? pulls each creature it succeeds against up to (\d+) feet closer and each creature it critically succeeds against up to (\d+) feet closer\.$/i.exec(plain);
    if (strands) {
        const pull = (feet) => ({ ...none(), forcedMovement: { kind: "pull", distance: Number(feet), upTo: true, optional: false, direction: "toward" } });
        return { ...base(item), targeting: { target: "every creature it holds", range: null, area: null, grabbed: true }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "skill", statistic: "athletics", against: { dc: "target", statistic: "fortitude" } }, sharedDamage: null, outcomes: { criticalSuccess: pull(strands[2]), success: pull(strands[1]), failure: none(), criticalFailure: none() } }, notes: ["One Athletics roll against each creature's Fortitude DC."] };
    }
    const charity = /^(?:An? |The )?[\w' -]+? (?:can )?touch(?:es)? (?:another|a willing living) creature to take on that creature['’]s wounds[.,] (?:The [\w' -]+? )?(?:transferring|transfers) up to (\d+) of (?:the [\w' -]+?['’]s|its|their) (?:own )?HP to the touched creature\.((?: [^.]+\.)*)(?: \([^)]*\))?$/i.exec(plain);
    if (charity) return { ...base(item), targeting: { target: "1 creature", range: "touch", area: null }, trigger: { event: "use" }, resolution: { kind: "healing", native: { healing: { components: [{ id: "0", formula: charity[1], kinds: ["healing"] }], recipients: "any" } } }, notes: [`It loses as many Hit Points as it gives (up to ${charity[1]}, no more than it has).`] };
    const pierce = /^(?:The )?[^.]+?\. (?:The )?[\w' -]+? chooses two targets in a direct line, one of which must be giving lesser cover to the other, then makes a single ranged Strike with its ([\w' -]+?) against both targets\.((?: [^.]+\.)*)$/i.exec(plain);
    if (pierce) return { builtin: "multi-strike", actions, strikes: [pierce[1].toLowerCase(), pierce[1].toLowerCase()], each: true, max: 2, sameMap: true, notes: ["One roll for both: two creatures in a line, the nearer giving the farther lesser cover (ignored)."] };
    const implant = /^Requirements? (?:The )?[\w' -]+? is adjacent to an? (?:Unconscious|Paralyzed|willing)(?:, (?:Unconscious|Paralyzed|willing))*,? or (?:Unconscious|Paralyzed|willing) creature\.? Effect (?:The )?[\w' -]+? implants ([\w' -]+?) in the creature['’]s flesh\.$/i.exec(plain);
    if (implant) {
        const eggs = ownAffliction(item, actor, implant[1].toLowerCase());
        if (!eggs) return null;
        return { ...eggs, source: base(item).source, activation: { time: String(actions), traits: eggs.activation?.traits ?? [] }, targeting: { target: "1 creature", range: "touch", area: null }, trigger: { event: "use" }, requires: "requirement", notes: ["Only at an Unconscious, Paralyzed or willing creature beside it."] };
    }
    const justice = /^(?:The )?[\w' -]+? makes an? ([\w' -]+?) Strike against a target it detects as evil\. If the target is evil, the Strike deals three extra weapon damage dice and deals @D damage to the target\.((?: [^.]+\.)*)$/i.exec(plain);
    const justiceDamage = justice ? inlineTags(html, "Damage").map(readDamage) : [];
    if (justice && justiceDamage.length === 1) return { builtin: "strike-activity", actions, strides: 0, strike: justice[1].toLowerCase(), attackBonus: 0, damageBonus: 0, offGuard: false, requires: null, oncePerFight: false, onHit: { conditions: [], critical: null, push: null, damage: [], save: null, size: null, vsTraits: [{ traits: ["unholy", "evil"], damage: justiceDamage }] }, notes: ["Against an evil (unholy) target it also deals three extra weapon damage dice.", ...(justice[2].trim() ? [justice[2].trim()] : [])] };
    // (Batch 267, the praskith's: "regains 3d8 Hit Points", its dice as words.)
    const growth = /^Requirements? [^.]+?\.? Effect (?:The )?[\w' -]+? regains (@D|\d+d\d+(?:\+\d+)?) Hit Points and recovers from the (\w+) and (\w+) conditions\. It reduces any (\w+) value it has by (\d+)\.$/i.exec(plain)?.slice(1);
    const growthHeal = growth?.[0] === "@D" ? inlineTags(html, "Damage").map(readDamage) : growth ? [growth[0]] : [];
    if (growth && growthHeal.length === 1) {
        const formula = growthHeal[0].replace(/\[[^\]]*healing[^\]]*\]$/i, "").replace(/^\((.*)\)$/, "$1");
        const success = { damage: none().damage, effects: [{ kind: "heal", formula }, { kind: "end-condition", slugs: [growth[1].toLowerCase(), growth[2].toLowerCase()] }] };
        return { ...base(item), targeting: { target: "self", range: null, area: null }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success, failure: none(), criticalFailure: none() } }, requires: "requirement", notes: [`Its ${growth[3]} value goes down by ${growth[4]}.`, "Only after a creature it swallowed took damage since its last turn, as its first action."] };
    }
    return null;
}

// Sixth chunk's one-offs (2026-10-12, batch 265). null otherwise:
// - Powerful Dive: "… Flies up to their fly Speed and must both move forward at least 20 feet and descend at least 10 feet. If they end the movement within
//   melee reach of at least one enemy their size or smaller, they can make a claw Strike against that enemy. If the claw hits, as a free action, the wyvern
//   can either automatically Grab the target or knock it Prone." → a flying charge with that Strike; its limits and the Grab or Prone, notes;
// - Coil: "… uses an action to coil itself. While Coiled, the reach of its fangs is 10 feet and it has the Reactive Strike reaction. After the giant viper
//   Strikes with its fangs, it becomes uncoiled." → Reactive Strike on itself until it Strikes with them; the reach, a note;
// - Bound in Death: "… splatters some of its substance on a willing undead creature within its reach. The target regains 5 HP and its melee Strikes get
//   the benefits of tomb curse until the end of its next turn." → that healing on an undead creature; the curse on its Strikes, a note;
// - a condition with "(… negates)" after it (Tempt: "… becoming Fascinated (Will DC 20 negates). This fascination ends …") → the save, the condition on
//   a failure; the rest, notes;
// - Flip: "… The triggering creature is pushed into an adjoining room, takes 1d8 bludgeoning damage, and lands Prone. A creature who succeeds at a DC 19
//   Reflex save takes no damage and rolls out of the way of the trap, …" → the save, the damage and Prone on a failure; the push and the dodge, notes;
// - Downpour: "… Creatures in the pool become Clumsy 1, and they can't decrease their clumsy condition so long as they remain in the pool. The trap then
//   rolls initiative." → that condition on them, for no set time; the rest, notes;
// - Punishing Momentum: "Requirements The wyvern Grabbed a creature this turn using Powerful Dive Effect The wyvern can Fly at half Speed while holding
//   the creature …, dropping it at the end of their movement. Alternatively, the wyvern can Strike the creature with their stinger with a +2
//   circumstance bonus." → that Strike at its bonus, its requirement the GM's; the flight with it, a note.
function sixthOneOffs(item, actor) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const plain = htmlToPlainText(html.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g, "@D").replace(/@Check\[[^\]]*\](?:\{[^}]*\})?/g, "@C")).replace(/\s+/g, " ").trim();
    const actions = Number(item.system?.actions?.value) || 1;
    const dive = /^(?:The )?[\w' -]+? Flies up to (?:its|their) fly Speed and must both move forward at least (\d+) feet and descend at least (\d+) feet\. If (?:it|they) ends? the movement within melee reach of at least one enemy (?:its|their) size or smaller, (?:it|they) can make an? ([\w' -]+?) Strike against that enemy\. If the \3 hits, as a free action, (?:the [\w' -]+?|it|they) can either automatically Grab the target or knock it Prone\.$/i.exec(plain);
    if (dive) return { builtin: "charge", actions, strides: 1, strike: dive[3].toLowerCase(), notes: [`It Flies, at least ${dive[1]} feet forward and ${dive[2]} feet down; only at an enemy its size or smaller.`, `On a hit, as a free action it can Grab the target or knock it Prone.`] };
    const coil = /^(?:The )?[\w' -]+? uses an action to coil itself\. While Coiled, the reach of its ([\w' -]+?) is (\d+) feet and it has the Reactive Strike reaction\. After (?:the [\w' -]+?|it) Strikes with its \1, it becomes uncoiled\.$/i.exec(plain);
    if (coil) return { builtin: "grant-aoo", actions, self: true, reaction: "Reactive Strike", untilText: `until it Strikes with its ${coil[1].toLowerCase()}`, notes: [`Coiled: its ${coil[1]} reach ${coil[2]} feet.`] };
    const bound = /^(?:The )?[\w' -]+? splatters [^.]+? on a willing undead creature within its reach\. The target regains @D HP and (its melee Strikes get the benefits of [^.]+)\.$/i.exec(plain);
    const boundHeal = bound ? inlineTags(html, "Damage").map(readDamage) : [];
    if (bound && boundHeal.length === 1) {
        const formula = boundHeal[0].replace(/\[[^\]]*healing[^\]]*\]$/i, "").replace(/^\((.*)\)$/, "$1");
        return { ...base(item), targeting: { target: "1 creature", range: "touch", area: null }, trigger: { event: "use" }, resolution: { kind: "healing", native: { healing: { components: [{ id: "0", formula, kinds: ["healing"] }], recipients: "undead" } } }, notes: ["Only a willing undead creature.", `Also ${bound[1]}.`] };
    }
    const flip = /^(?:[^.@]+\. )*(?:The triggering creature|It) is pushed ([^,@]+), takes @D damage, and lands Prone\. A creature (?:who|that) succeeds at an? @C save takes no damage and ([^.@]+)\.$/i.exec(plain);
    const flipDamage = flip ? inlineTags(html, "Damage").map(readDamage) : [];
    const flipCheck = flip ? inlineTags(html, "Check").map(readCheck).find((check) => check?.save && check.dc) : null;
    if (flip && flipDamage.length === 1 && flipCheck) {
        const row = { damage: { mode: "formulas", formulas: [{ formula: flipDamage[0] }] }, effects: [{ kind: "condition", slug: "prone", value: null, duration: null }] };
        return { ...base(item), targeting: { target: "the triggering creature", range: null, area: null }, trigger: { event: "use" }, resolution: { kind: "save", check: { roll: "save", statistic: flipCheck.statistic, basic: false, against: { dc: "fixed", value: flipCheck.dc } }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: none(), failure: row, criticalFailure: structuredClone(row) } }, notes: [`On a failure it's pushed ${flip[1].trim()}.`, `On a success it ${flip[2].trim()}.`] };
    }
    const pool = /^(?:[^.@]+\. )?Creatures in the ([\w' -]+?) become (Clumsy|Enfeebled|Sickened|Stupefied|Drained|Off-Guard|Slowed) ?(\d)?(?:, and (they can't decrease their [\w-]+ condition so long as they remain in the \1))?\.((?: [^.@]+\.)*)$/i.exec(plain);
    if (pool) {
        const row = { ...none(), effects: [{ kind: "condition", slug: pool[2].toLowerCase(), value: pool[3] ? Number(pool[3]) : null, duration: null }] };
        return { ...base(item), targeting: { target: `the creatures in the ${pool[1]}`, range: null, area: null }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: row, failure: none(), criticalFailure: none() } }, notes: [...(pool[4] ? [`${pool[4][0].toUpperCase()}${pool[4].slice(1)}.`] : []), ...(pool[5].trim() ? [pool[5].trim()] : [])] };
    }
    const momentum = /^Requirements? (?:The )?[\w' -]+? Grabbed a creature this turn using ([\w' -]+?)\.? Effect (?:The )?[\w' -]+? can Fly at half Speed while holding the creature in (?:its|their) [\w' -]+?, carrying that creature along with (?:it|them) and dropping it at the end of (?:its|their) movement\. Alternatively, (?:the [\w' -]+?|it|they) can Strike the creature with (?:its|their) ([\w' -]+?) with a \+(\d) circumstance bonus\.$/i.exec(plain);
    if (momentum) return { builtin: "strike-activity", actions, strides: 0, strike: momentum[2].toLowerCase(), attackBonus: Number(momentum[3]), damageBonus: 0, offGuard: false, requires: "requirement", oncePerFight: false, onHit: { conditions: [], critical: null, push: null, damage: [], save: null, size: null }, notes: [`Only at a creature it Grabbed with ${momentum[1]} this turn.`, "Or instead it Flies at half Speed carrying the creature, and drops it at the end of the move."] };
    const negates = /^(?:The )?(?:triggering )?(?:creature|target)[^.]*?, becoming (\w+)(?: (\d))? \(@C negates\)\.((?: [^.]+\.)*)$/i.exec(plain);
    const negateCheck = negates ? inlineTags(html, "Check").map(readCheck).find((check) => check?.save && check.dc) : null;
    if (negates && negateCheck && STAGE_CONDITIONS.includes(negates[1].toLowerCase())) {
        const row = { ...none(), effects: [{ kind: "condition", slug: negates[1].toLowerCase(), value: negates[2] ? Number(negates[2]) : null, duration: null }] };
        return { ...base(item), targeting: { target: "the triggering creature", range: null, area: null }, trigger: { event: "use" }, resolution: { kind: "save", check: { roll: "save", statistic: negateCheck.statistic, basic: false, against: { dc: "fixed", value: negateCheck.dc } }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: none(), failure: row, criticalFailure: structuredClone(row) } }, ...(negates[3].trim() ? { notes: [negates[3].trim()] } : {}) };
    }
    return null;
}

// Seventh chunk's one-offs (2026-10-12, batch 266). null otherwise:
// - Roll: "… rolls up into an armored sphere. While Rolling, an aolaz has AC 44, Fort +37, Ref +29, Will +33, and Speed 100 feet, but it can't use its
//   trunk Strikes or its Ultrasonic Blast. …" → a stance with those numbers over its own; its Speed and what it can't use, notes;
// - Encage in Tentacles: "Requirements The gylou has a Medium or smaller creature Grabbed or Restrained Effect … This has the same effects as Swallow
//   Whole (Medium, 2d12+12 bludgeoning, Rupture 30), except …" → the creature it holds swallowed, with no check; the exceptions, notes;
// - Envelop: "Requirements The giant amoeba begins its turn with a target its size or smaller Grabbed Effect … This thereafter has the same effect as if
//   the amoeba had Engulfed the creature (DC 17, 1d6 acid damage, Escape DC 17, Rupture 3)." → the creature it holds engulfed, with no check;
// - Bonds of Iron: "… a cage … around one creature within 30 feet, attempting an Athletics check to Grapple against the target's Fortitude DC; if …,
//   the iron hag gains a +2 circumstance bonus to this check. On a success, the creature is Grabbed by the magical fingernails (or Restrained on a
//   critical success). …" → that check at range, Grabbed or Restrained; the rest, notes;
// - Collect Brain: "… extracts the brain of a creature within its reach that has been dead for no more than 1 minute. It can then use an Interact action
//   to secure the brain … and heal 20 Hit Points." → that healing on itself, its requirement the GM's;
// - Collaborative Chomp: "… makes a claw Strike and Grabs a single target. If both are successful, the other head can use their reaction to make a jaws
//   Strike against that creature." → the Strike, Grabbed on a hit; the other head's Strike, a note;
// - Adaptive Strike: "The naunet chooses adamantine, cold iron, or silver; its melee Strikes count as that type for 1 minute or until it uses Adaptive
//   Strike again. Effect: Adaptive Strike" → PF2e's linked effect on itself, which asks for the choice;
// - Flatten: "The shikigami flattens to the width of a sheet of paper. While Flattened, they can float on the wind, gaining a 20-foot fly Speed, and …;
//   however, they become Clumsy 2. The shikigami can Dismiss this effect." → that condition on itself for no set time; the rest, notes.
function seventhOneOffs(item, actor) {
    const html = String(item.system?.description?.value ?? "");
    if (["action", "free"].includes(item.system?.actionType?.value)) {
        const links = [...html.matchAll(EFFECT_LINK)];
        const said = htmlToPlainText(html.replace(EFFECT_LINK, "")).replace(/\s+/g, " ").trim();
        if (links.length === 1 && /^(?:The )?[\w' -]+? chooses [a-z ,]+?; (?:its|their) (?:melee )?Strikes count as that (?:type|material) for \d+ minutes? or until (?:it|they) uses? [\w' -]+? again\.$/i.test(said)) {
            return { ...base(item), targeting: { target: null, range: null, area: null }, trigger: { event: "use" }, resolution: { kind: "effect", applications: [{ kind: "native-spell-effect", uuid: links[0][1], label: links[0][2] ?? item.name, recipients: "self" }] } };
        }
        // (Batch 268, Bosun's Command: "The bosun orders an ally to attack or to get in position. Until the end of the ally's next turn, they gain the
        // bosun's choice of a +2 status bonus to attack rolls or a +10-foot status bonus to their Speeds. Effect: Bosun's Command" — PF2e's effect on the
        // ally, which asks for the choice.)
        const ordered = links.length === 1 ? /^(?:Frequency [^.]+?\.? Effect )?(?:The )?[\w' -]+? orders an ally to [^.]+\. Until the end of the ally['’]s next turn, they gain (?:the [\w' -]+?['’]s|its) choice of ([^.]+)\.$/i.exec(said) : null;
        if (ordered) return { ...base(item), targeting: { target: "1 creature", range: null, area: null }, trigger: { event: "use" }, resolution: { kind: "effect", applications: [{ kind: "native-spell-effect", uuid: links[0][1], label: links[0][2] ?? item.name, recipients: "target" }] }, notes: ["Only an ally.", `PF2e's effect asks which: ${ordered[1]}.`] };
        const flat = /^(?:The )?[\w' -]+? flattens to [^.]+\. While ([A-Z]\w+), (?:they|it) can ([^;]+); however, (?:they|it) becomes? (Clumsy|Enfeebled|Off-Guard|Stupefied) ?(\d)?\. (?:The )?[\w' -]+? can Dismiss this effect\.$/i.exec(htmlToPlainText(html.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim());
        if (flat) {
            const success = { damage: none().damage, effects: [{ kind: "condition", slug: flat[3].toLowerCase(), value: flat[4] ? Number(flat[4]) : null, duration: null }] };
            return { ...base(item), targeting: { target: "self", range: null, area: null }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success, failure: none(), criticalFailure: none() } }, notes: [`While ${flat[1]}, it can ${flat[2].trim()}.`, `It keeps the condition until it Dismisses this (remove it then).`] };
        }
    }
    if (item.system?.actionType?.value !== "action") return null;
    const plain = htmlToPlainText(html.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g, "@D").replace(/@Check\[[^\]]*\](?:\{[^}]*\})?/g, "@C").replace(/\[\[\/act (\w[\w-]*)(?: dc=(\d+))?\]\](?:\{([^}]*)\})?/g, (_, act, dc, label) => `${label ?? act.replace(/-/g, " ").replace(/^\w/, (letter) => letter.toUpperCase())}${dc ? ` DC ${dc}` : ""}`)).replace(/\s+/g, " ").trim();
    const actions = Number(item.system?.actions?.value) || 1;
    const owner = actor ?? item.actor ?? item.parent;
    const rolled = /^(?:The )?[\w' -]+? (?:tucks [^.]+? and )?rolls up into an? [\w' -]+?\. While ([A-Z]\w+), (?:an? |the )?[\w' -]+? has AC (\d+), Fort \+(\d+), Ref \+(\d+), Will \+(\d+), and Speed (\d+) feet, but (?:it|they) can(?:'t|not) use ([^.]+)\.((?: [^.]+\.)*)$/i.exec(plain);
    if (rolled) {
        const now = { ac: Number(owner?.system?.attributes?.ac?.value), fortitude: Number(owner?.system?.saves?.fortitude?.value), reflex: Number(owner?.system?.saves?.reflex?.value), will: Number(owner?.system?.saves?.will?.value) };
        const wanted = { ac: Number(rolled[2]), fortitude: Number(rolled[3]), reflex: Number(rolled[4]), will: Number(rolled[5]) };
        if (Object.values(now).some((value) => !Number.isFinite(value))) return null;
        const modifiers = Object.keys(wanted).filter((key) => wanted[key] !== now[key]).map((key) => ({ on: key, type: "untyped", value: wanted[key] - now[key] }));
        return { builtin: "self-effect", actions, model: { name: item.name, rounds: null, modifiers, tempHp: 0 }, damage: [], strike: null, melee: false, stance: true, duration: { value: -1, unit: "unlimited", expiry: null }, notes: [`While ${rolled[1]}, its Speed is ${rolled[6]} feet and it can't use ${rolled[7]}.`, ...(rolled[8].trim() ? [rolled[8].trim()] : [])] };
    }
    const encage = /^Requirements? (?:The )?[\w' -]+? has an? (?:(Tiny|Small|Medium|Large|Huge) or smaller )?creature Grabbed(?: or Restrained)?\.? Effect (?:The )?[\w' -]+? (?:transfers|pulls|draws|drags) the grabbed creature into [^.]+\. This has the same effects as Swallow Whole \((Tiny|Small|Medium|Large|Huge|Gargantuan), @D, Rupture (\d+)\)(?:, except ([^.]+))?\.((?: [^.]+\.)*)$/i.exec(plain);
    const encageDamage = encage ? inlineTags(html, "Damage").map(readDamage) : [];
    if (encage && encageDamage.length === 1) {
        const size = encage[2].toLowerCase();
        const swallowed = () => ({ damage: { mode: "formulas", formulas: [{ formula: encageDamage[0] }], rollScope: "outcome" }, effects: [{ kind: "swallow", damage: encageDamage[0], rupture: Number(encage[3]), size }] });
        return { ...base(item), targeting: { target: "a creature it has grabbed or restrained", range: "touch", area: null, grabbed: true, size }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: swallowed(), failure: none(), criticalFailure: none() } }, notes: [...(encage[4] ? [`As Swallow Whole, except ${encage[4]}.`] : []), ...(encage[5].trim() ? [encage[5].trim()] : [])] };
    }
    // (Batch 268, the veiled current's: "… begins their turn with a target of their size …", "(DC 26, 1d8+8 bludgeoning, …)" — its damage as words; "As
    // engulfing a creature is a hostile action, …" — a note.)
    const enveloped = /^Requirements? (?:The )?[\w' -]+? begins (?:its|their) turn with a (?:target|creature) (?:of )?(?:its|their) size or smaller Grabbed\.? Effect (?:The )?[\w' -]+? maintains the Grab and [^.]+\. This thereafter has the same effect as if (?:the [\w' -]+?|it) had Engulfed the creature \(DC \d+, (?:@D damage|(\d+d\d+(?:[+-]\d+)?) (\w+)), Escape DC (\d+), Rupture (\d+)\)\.((?: [^.]+\.)*)$/i.exec(plain);
    const envelop = enveloped ? { dice: enveloped[1], type: enveloped[2], escapeDC: Number(enveloped[3]), rupture: Number(enveloped[4]), rest: enveloped[5].trim() } : null;
    const envelopDamage = !envelop ? [] : envelop.dice ? [`${/[+-]/.test(envelop.dice) ? `(${envelop.dice})` : envelop.dice}[${envelop.type.toLowerCase()}]`] : inlineTags(html, "Damage").map(readDamage);
    if (envelop && envelopDamage.length === 1) {
        const sizes = { tiny: "tiny", sm: "small", med: "medium", lg: "large", huge: "huge", grg: "gargantuan" };
        const size = sizes[owner?.system?.traits?.size?.value] ?? "medium";
        const engulfed = { damage: { mode: "formulas", formulas: [{ formula: envelopDamage[0] }], rollScope: "outcome" }, effects: [{ kind: "swallow", damage: envelopDamage[0], rupture: envelop.rupture, size, escapeDC: envelop.escapeDC }] };
        return { ...base(item), targeting: { target: "a creature it has grabbed or restrained", range: "touch", area: null, grabbed: true, size }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: engulfed, failure: none(), criticalFailure: none() } }, requires: "requirement", notes: ["Only a creature it held at the start of its turn.", ...(envelop.rest ? [envelop.rest] : [])] };
    }
    const bonds = /^(?:Frequency [^.]+?\.? Effect )?(?:The )?[\w' -]+? causes [^.;]+? around one creature within (\d+) feet, attempting an Athletics check to Grapple against the target['’]s Fortitude DC; (if [^.]+)\. On a success, the creature is Grabbed by [^.(]+? \(or Restrained on a critical success\)\.((?: [^.]+\.)*)$/i.exec(plain);
    if (bonds) {
        const held = (slug) => ({ ...none(), effects: [{ kind: "condition", slug, value: null, duration: null }] });
        return { ...base(item), targeting: { target: "1 creature", range: `${bonds[1]} feet`, area: null }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "skill", statistic: "athletics", against: { dc: "target", statistic: "fortitude" } }, sharedDamage: null, outcomes: { criticalSuccess: held("restrained"), success: held("grabbed"), failure: none(), criticalFailure: none() } }, notes: [`${bonds[2][0].toUpperCase()}${bonds[2].slice(1)}.`, ...(bonds[3].trim() ? [bonds[3].trim()] : [])] };
    }
    const chomp = /^(?:The )?[\w' -]+? makes an? ([\w' -]+?) Strike and Grabs a single target\. If both are successful, the other head can use (?:its|their) reaction to make an? ([\w' -]+?) Strike against that creature\.$/i.exec(plain);
    if (chomp) return { builtin: "strike-activity", actions, strides: 0, strike: chomp[1].toLowerCase(), attackBonus: 0, damageBonus: 0, offGuard: false, requires: null, oncePerFight: false, onHit: { conditions: [{ slug: "grabbed", value: null, duration: null }], critical: null, push: null, damage: [], save: null, size: null }, notes: [`If it hits and Grabs, its other head can use its reaction to make a ${chomp[2].toLowerCase()} Strike against the creature.`] };
    const brain = /^(?:The )?[\w' -]+? extracts the [\w' -]+? of a creature within its reach that has been dead for no more than (\d+) minutes?\. It can then use an Interact action to [^.]+? and heal @D Hit Points\.$/i.exec(plain);
    const brainHeal = brain ? inlineTags(html, "Damage").map(readDamage) : [];
    if (brain && brainHeal.length === 1) {
        const formula = brainHeal[0].replace(/\[[^\]]*healing[^\]]*\]$/i, "").replace(/^\((.*)\)$/, "$1");
        const success = { damage: none().damage, effects: [{ kind: "heal", formula }] };
        return { ...base(item), targeting: { target: "self", range: null, area: null }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success, failure: none(), criticalFailure: none() } }, requires: "requirement", notes: [`Only from a creature in its reach dead no more than ${brain[1]} minute${brain[1] === "1" ? "" : "s"}; the healing after an Interact action.`] };
    }
    return null;
}

// Eighth chunk's one-offs (2026-10-12, batch 267). null otherwise:
// - Drag Below: "… attempts an Athletics check against a Grabbed foe's Fortitude DC. If the elasmosaurus succeeds, the foe is forcibly moved 5 feet
//   toward the elasmosaurus's body. If the elasmosaurus critically succeeds, the foe is moved 10 feet …" → that check at the creature it holds, a pull
//   by its degree;
// - Tricky Throw: "… make a dart Strike at one enemy within 40 feet. If the Strike is unsuccessful, the tanuki falls Prone. If the Strike is successful,
//   … appears in a space adjacent to the enemy and makes a kama Strike against said enemy, who's Off-Guard to the attack." → the dart Strike; the fall
//   and the second Strike, notes;
// - Titanic Grasp: "The titan makes a fist Strike against a creature affected by their impossible stature, even if it's outside of the titan's normal
//   reach. On a hit, the titan automatically Grabs the creature and, if out of their reach, pulls it within reach." → the Strike, Grabbed on a hit;
//   the reach and the pull, notes;
// - a price it pays until it Dismisses it (Extend Arms: "… giving them both a reach of 20 feet with all melee attacks. However, the dynamo becomes
//   Enfeebled 1 and can't use the Interact action. The dynamo can Dismiss this ability."; Extend Legs) → that condition on itself, for no set time;
//   what it gains and can't do, notes;
// - Wild Leadership: "… inspires a willing animal. The animal becomes Quickened for 1 round. It can use this additional action only to Climb, …" →
//   that condition on the creature; who and what for, notes;
// - Rapid Barrage: "… make three fist Strikes against one target. If more than one Strike hits, combine damage …. Regardless of whether any Strikes hit,
//   the target must succeed at a DC 32 Fortitude save or be Clumsy 1 until the end of their next turn and Stunned 1 (Clumsy 2 and Stunned 2 on a
//   critical failure)." → the three Strikes at one target; the save after, a note;
// - Dig In: "… While Dug In, the carved beast can't Stride nor use its roots Strike; however, this also negates the effects of top-heavy, grants the
//   beast a +2 status bonus to its AC and Fortitude saves, and increases the damage of its statue Strike by 1d8. …" → a stance with those bonuses and
//   that die on that Strike; what it can't do and when it ends, notes;
// - Scent of Blood: "Requirements A creature within the eidolon's scent range is taking bleed damage Effect The eidolon flies into a frenzy, gaining 10
//   temporary HP for 1 minute and a +4 status bonus to damage rolls with its unarmed attacks, but becomes Off-Guard. … The frenzy lasts for 1 minute,
//   after which the eidolon is Fatigued for 1 minute." → those Hit Points and the damage bonus for a minute; Off-Guard and the fatigue after, notes.
function eighthOneOffs(item, actor) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const plain = htmlToPlainText(html.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g, "@D").replace(/@Check\[[^\]]*\](?:\{[^}]*\})?/g, "@C")).replace(/\s+/g, " ").trim();
    const actions = Number(item.system?.actions?.value) || 1;
    const drag = /^(?:The )?[\w' -]+? attempts an Athletics check against a Grabbed (?:foe|creature|target)['’]s Fortitude DC\. If (?:the [\w' -]+?|it) succeeds, the (?:foe|creature|target) is (?:forcibly )?moved (\d+) feet toward (?:the [\w' -]+?['’]s|its) body\. If (?:the [\w' -]+?|it) critically succeeds, the (?:foe|creature|target) is (?:forcibly )?moved (\d+) feet toward (?:the [\w' -]+?['’]s|its) body\.$/i.exec(plain);
    if (drag) {
        const pull = (feet) => ({ ...none(), forcedMovement: { kind: "pull", distance: Number(feet), upTo: false, optional: false, direction: "toward" } });
        return { ...base(item), targeting: { target: "the creature it holds", range: "touch", area: null, grabbed: true }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "skill", statistic: "athletics", against: { dc: "target", statistic: "fortitude" } }, sharedDamage: null, outcomes: { criticalSuccess: pull(drag[2]), success: pull(drag[1]), failure: none(), criticalFailure: none() } } };
    }
    const throwIn = /^(?:[^.]+\. )?(?:They|It|The [\w' -]+?) makes? an? ([\w' -]+?) Strike at one enemy within (\d+) feet\. If the Strike is unsuccessful, (?:the [\w' -]+?|it|they) falls? Prone\. If the Strike is successful, [^.]+\. (?:The [\w' -]+?|It|They) disappears? from the space (?:it|they) threw from, appears? in a space adjacent to the enemy and makes? an? ([\w' -]+?) Strike against said enemy, who['’]s Off-Guard to the attack\.$/i.exec(plain);
    if (throwIn) return { builtin: "strike-activity", actions, strides: 0, strike: throwIn[1].toLowerCase(), attackBonus: 0, damageBonus: 0, offGuard: false, requires: null, oncePerFight: false, onHit: { conditions: [], critical: null, push: null, damage: [], save: null, size: null }, notes: [`Only at an enemy within ${throwIn[2]} feet.`, "If it misses, it falls Prone.", `If it hits, it appears beside the enemy and makes a ${throwIn[3].toLowerCase()} Strike against it; the enemy is Off-Guard to that Strike.`] };
    const inspired = /^(?:[^.]+?, )?(?:the [\w' -]+?|it) inspires a willing ([\w-]+)\. The \1 becomes (Quickened) for 1 round\. (It can use this additional action only to [^.]+)\.$/i.exec(plain);
    if (inspired) {
        const effects = readConditions(html, { plain: STAGE_CONDITIONS }).filter((effect) => effect.slug === "quickened");
        if (effects.length === 1) return { ...base(item), targeting: { target: "1 creature", range: null, area: null }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: { ...none(), effects }, failure: none(), criticalFailure: none() } }, notes: [`Only a willing ${inspired[1].toLowerCase()}.`, `${inspired[3]}.`] };
    }
    const barrage = /^(?:[^.]+\. )?(?:They|It|The [\w' -]+?) makes? three ([\w' -]+?) Strikes against one target\. If more than one Strike hits, combine damage for the purpose of resistances and weaknesses\. (Regardless of whether any Strikes hit, the target must succeed at an? @C save or be [^.]+)\.$/i.exec(plain);
    if (barrage) {
        const check = inlineTags(html, "Check").map(readCheck).find((entry) => entry?.save && entry.dc);
        if (check) return { builtin: "multi-strike", actions, strikes: [barrage[1].toLowerCase(), barrage[1].toLowerCase(), barrage[1].toLowerCase()], sameTarget: true, notes: ["Their damage combined against resistances and weaknesses when more than one hits.", `${barrage[2].replace("@C save", `DC ${check.dc} ${check.statistic[0].toUpperCase()}${check.statistic.slice(1)} save`)}.`] };
    }
    const dug = /^(?:The )?[\w' -]+? (?:digs|sinks|drives|plants) [^.]+\. While ([A-Z][\w ]+?), (?:the [\w' -]+?|it) can(?:'t|not) ([^;]+); however, this also ([^,]+), grants (?:the [\w' -]+?|it) a \+(\d+) status bonus to its AC and (Fortitude|Reflex|Will) saves, and increases the damage of its ([\w' -]+?) Strike by (?:\[\[\/r )?(\d+d\d+)(?:\]\])?\.((?: [^.]+\.)*)$/i.exec(plain);
    if (dug) {
        const value = Number(dug[4]);
        return { builtin: "self-effect", actions, model: { name: item.name, rounds: null, modifiers: [{ on: "ac", type: "status", value }, { on: dug[5].toLowerCase(), type: "status", value }], tempHp: 0 }, damage: [dug[7]], strike: dug[6].toLowerCase(), melee: false, stance: true, duration: { value: -1, unit: "unlimited", expiry: null }, notes: [`While ${dug[1]}, it can't ${dug[2].trim()}; this also ${dug[3].trim()}.`, ...(dug[8].trim() ? [dug[8].trim()] : [])] };
    }
    const frenzy = /^Requirements? ([^.]+?)\.? Effect (?:The )?[\w' -]+? flies into a frenzy, gaining (\d+) temporary HP for 1 minute and a \+(\d+) status bonus to damage rolls with its ([\w' -]+?), but becomes Off-Guard\.((?: [^.]+\.)*?) The frenzy lasts for 1 minute, after which (?:the [\w' -]+?|it) is Fatigued for 1 minute\.$/i.exec(plain);
    if (frenzy) return { builtin: "self-effect", actions, model: { name: item.name, rounds: 10, modifiers: [{ on: "damage", type: "status", value: Number(frenzy[3]) }], tempHp: Number(frenzy[2]) }, damage: [], strike: null, melee: false, duration: { value: 1, unit: "minutes", expiry: null }, requires: "requirement", notes: [`Only when ${frenzy[1].replace(/^A /, "a ")}.`, `The damage bonus is for its ${frenzy[4]} only.`, "It's Off-Guard during the frenzy (apply it).", ...(frenzy[5].trim() ? [frenzy[5].trim()] : []), "It's Fatigued for 1 minute after."] };
    const price = /^((?:[^.]+\. )+)However, (?:the [\w' -]+?|it|they) becomes? (Clumsy|Enfeebled|Stupefied|Sickened|Off-Guard) ?(\d)?(?: and ([^.]+))?\. (?:The [\w' -]+?|It|They) can Dismiss this (?:ability|effect)\.$/i.exec(plain);
    if (price && !/@[DC]\b/.test(price[1])) {
        const success = { damage: none().damage, effects: [{ kind: "condition", slug: price[2].toLowerCase(), value: price[3] ? Number(price[3]) : null, duration: null }] };
        const gains = price[1].trim().split(/(?<=\.)\s+(?=[A-Z])/);
        return { ...base(item), targeting: { target: "self", range: null, area: null }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success, failure: none(), criticalFailure: none() } }, notes: [...gains, ...(price[4] ? [`Meanwhile it ${price[4]}.`] : []), "It keeps the condition until it Dismisses this (remove it then)."] };
    }
    const grasp = /^(?:The )?[\w' -]+? makes an? ([\w' -]+?) Strike against a creature affected by (?:its|their) ([\w' -]+?), even if it['’]s outside of (?:the [\w' -]+?['’]s|its|their) normal reach\. On a hit, (?:the [\w' -]+?|it|they) automatically Grabs? the creature and, if out of (?:its|their) reach, pulls it within reach\.$/i.exec(plain);
    if (grasp) return { builtin: "strike-activity", actions, strides: 0, strike: grasp[1].toLowerCase(), attackBonus: 0, damageBonus: 0, offGuard: false, requires: null, oncePerFight: false, onHit: { conditions: [{ slug: "grabbed", value: null, duration: null }], critical: null, push: null, damage: [], save: null, size: null }, notes: [`Any creature affected by its ${grasp[2]}, even beyond its reach; on a hit it pulls the creature within reach.`] };
    return null;
}

// A reaction that makes the creature save against one of its own abilities (2026-10-12, batch 267, Withering Opportunity): "Trigger The meladaemon is
// attacked by an adjacent creature and the attack misses Effect The meladaemon swipes at the triggering creature, which must immediately attempt a save
// against the meladaemon's withering touch." → that ability's save and results at the attacker, on a missed melee attack. null otherwise.
function ownAbilitySave(item, actor, basicActions) {
    if (item.system?.actionType?.value !== "reaction") return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const match = /^Trigger (?:The )?[\w' -]+? is attacked by an adjacent creature and the attack misses\.? Effect (?:The )?[\w' -]+? swipes at the triggering creature, which must (?:immediately )?attempt a save against (?:the [\w' -]+?['’]s|its) ([\w' -]+?)\.$/i.exec(plain);
    if (!match) return null;
    const owner = actor ?? item.actor ?? item.parent;
    const source = (owner?.items?.contents ?? owner?.items ?? []).find((other) => other !== item && other.type === "action" && String(other.name).toLowerCase() === match[1].toLowerCase());
    if (!source) return null;
    let plan = null;
    try {
        plan = compileMonsterAbility(source, { basicActions, actor: owner });
    } catch {
        plan = null;
    }
    if (plan?.resolution?.check?.roll !== "save") return null;
    return { ...plan, ...base(item), targeting: { target: "the attacker", range: "touch", area: null }, trigger: { event: "hit-by", reaction: true, missed: true, melee: true }, notes: ["Only an adjacent attacker."] };
}

// Battlezoo one-offs (2026-10-12, batch 269), described in our own words. null otherwise:
// - a spat glob of persistent fire in a small burst at range, a save negating it, with what it does to cold as notes;
// - two Strikes at one target, the second rolled twice if the first missed (a note);
// - a creature already burning from its abilities trapped in rock: set damage and PF2e's linked effect, its requirement and Escape as notes;
// - Quickened for 1 round once a minute, the extra action's limits and the Slowed after as notes;
// - poison brought up onto its blade, then a Strike with extra poison damage;
// - a Stride, a Long Jump and a kick, the bigger damage after a long jump a note;
// - two Strikes at one target, their damage combined, one Strike's damage even if both miss (a note);
// - ice armor after a cold spell: +4 AC for a minute, the fire weakness gone and the melting as notes;
// - a Grapple at range by telekinesis, the lift and the fall as notes;
// - (batch 270) temporary Hit Points and Quickened for 1 round for it and its allies in an emanation, the extra action's limits a note;
// - (batch 270) a bite rolled twice, the better kept, that ignores circumstance penalties and concealment — the Strike, the rest as notes;
// - (batch 270) its Swallow Whole with the numbers given in brackets, as the glossary's ability; nonlethal and the rest as notes;
// - (batch 270) several Strikes at a penalty against the creature it holds, the penalty held until after them;
// - (batch 270) three thrown Strikes at one to three creatures, the penalty held, what the shards do after as notes;
// - (batch 270) a gaze: a save or Dazzled for a minute (Blinded if it already was, a note);
// - (batch 271) two Strides and a Strike that dazzles instead of hurting; a Stride, a Leap and a kick that pushes; a spit Strike whose hit means a save
//   or Confused for a minute; two fist Strikes at one creature, the second with extra force damage (a note);
// - (batch 271) a peck at the eyes: persistent bleed and Dazzled until the bleeding stops, Blinded in one case a note; two blade Strikes at one target
//   while its construct armor holds, their damage combined (notes);
// - (batch 271) one big Strike and two smaller ones, the penalty held when all go to different creatures; one check against each creature it holds,
//   damage and a pull on a success, double and further on a critical success;
// - (batch 271) a big heal on itself once a day, with treats thrown to its allies as a note.
function bzOneOffs(item, actor) {
    const type = item.system?.actionType?.value;
    if (!["action", "free"].includes(type)) return null;
    const html = String(item.system?.description?.value ?? "");
    // (A link with no label, a spell's: "a linked spell"; "[[/act escape dc=36]]{Escapes}": its label.)
    const plain = htmlToPlainText(html.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@UUID\[[^\]]*\](?!\{)/g, "a linked spell").replace(/a linked spell(?: or a linked spell)+/g, "one of its listed spells").replace(/\[\[\/act [^\]]*\]\]\{([^}]*)\}/g, "$1").replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g, "@D").replace(/@Check\[[^\]]*\](?:\{[^}]*\})?/g, "@C").replace(/@Template\[[^\]]*\](?:\{[^}]*\})?/g, "@T")).replace(/\s+/g, " ").trim();
    const actions = Number(item.system?.actions?.value) || 1;
    const glob = type === "action" ? /^(?:The )?[\w' -]+? (?:spits|hurls|flings|lobs) [^.]+?, dealing @D damage in an? @T within (\d+) feet \(@C save negates\)\.((?: [^.]+\.)*)/i.exec(plain) : null;
    const globDamage = glob ? inlineTags(html, "Damage").map(readDamage) : [];
    const globCheck = glob ? inlineTags(html, "Check").map(readCheck).find((check) => check?.save && check.dc) : null;
    const globArea = glob ? /@Template\[(?:type:)?(burst|cone|emanation|line)\|distance:(\d+)/i.exec(html) : null;
    if (glob && globDamage.length === 1 && globCheck && globArea) {
        const burned = { damage: { mode: "formulas", formulas: [{ formula: globDamage[0] }] }, effects: [] };
        return { ...base(item), targeting: { target: null, range: `${glob[1]} feet`, area: { type: globArea[1].toLowerCase(), value: Number(globArea[2]) } }, trigger: { event: "use" }, resolution: { kind: "save", check: { roll: "save", statistic: globCheck.statistic, basic: false, against: { dc: "fixed", value: globCheck.dc } }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: none(), failure: burned, criticalFailure: structuredClone(burned) } }, notes: glob[2].trim().split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean) };
    }
    const twin = type === "action" ? /^(?:The )?[\w' -]+? makes two ([\w' -]+?) Strikes against (?:the same|one) target\. (?:If|When) the first (?:Strike|attack) misses[^.]*?, [^.]*?\btwice\b[^.]*?\b(?:better|higher)\b[^.]*\.(?: This is a fortune effect\.)?$/i.exec(plain) : null;
    if (twin) return { builtin: "multi-strike", actions, strikes: [twin[1].toLowerCase(), twin[1].toLowerCase()], sameTarget: true, notes: ["If the first misses, the second attack is rolled twice and the better kept (fortune)."] };
    const links = [...html.matchAll(EFFECT_LINK)];
    const prison = type === "action" && links.length === 1 ? /^(?:[^.]+\. )?(?:The )?[\w' -]+? chooses a creature within (\d+) feet (?:who|that) (?:is taking|takes|suffers) persistent (\w+) damage (?:from|by) [^.]+\. The creature takes @D damage, [^.]+? until it Escapes\. [^.]*?\bpersistent \2 damage\b[^.]*\bends\.(?: Effect: [\w' -]+)?$/i.exec(plain) : null;
    const prisonDamage = prison ? inlineTags(html, "Damage").map(readDamage) : [];
    if (prison && prisonDamage.length === 1) {
        const escape = /\[\[\/act escape dc=(\d+)\]\]/i.exec(html)?.[1];
        const success = { damage: { mode: "formulas", formulas: [{ formula: prisonDamage[0] }] }, effects: [], nativeEffects: [{ uuid: links[0][1], label: (links[0][2] ?? item.name).replace(/^Effect:\s*/i, "") }] };
        return { ...base(item), targeting: { target: "1 creature", range: `${prison[1]} feet`, area: null }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success, failure: none(), criticalFailure: none() } }, requires: "requirement", notes: [`Only a creature taking persistent ${prison[2]} damage from its abilities; that persistent damage ends (remove it).`, ...(escape ? [`The effect lasts until it Escapes (DC ${escape}).`] : [])] };
    }
    const spit = type === "action" ? /^(?:[^.]+?, )?(?:the [\w' -]+?|it) Interacts to [^.]+\. (?:The [\w' -]+?|It|They) then Strikes with (?:its|their) ([\w' -]+?); (?:the Strike|it) deals an? (?:additional|extra) (\d+d\d+) (\w+) damage\.$/i.exec(plain) : null;
    if (spit) return { builtin: "strike-activity", actions, strides: 0, strike: spit[1].toLowerCase(), attackBonus: 0, damageBonus: 0, offGuard: false, requires: null, oncePerFight: false, onHit: { conditions: [], critical: null, push: null, damage: [`${spit[2]}[${spit[3].toLowerCase()}]`], save: null, size: null } };
    const kick = type === "action" ? /^(?:The )?[\w' -]+? Strides, (?:makes|attempts) a Long Jump, (?:and )?then makes an? ([\w' -]+?) Strike\. If [^.]*?Long Jump of at least (\d+) feet[^.]*?, the [Ss]trike['’]s damage (?:increases to|becomes) ([\dd+]+)\.$/i.exec(plain) : null;
    if (kick) return { builtin: "strike-activity", actions, strides: 1, strike: kick[1].toLowerCase(), attackBonus: 0, damageBonus: 0, offGuard: false, requires: null, oncePerFight: false, onHit: { conditions: [], critical: null, push: null, damage: [], save: null, size: null }, notes: [`A Long Jump between the Stride and the Strike; one of at least ${kick[2]} feet makes the Strike's damage ${kick[3]}.`] };
    const dual = type === "action" ? /^(?:The )?[\w' -]+? makes two ([\w' -]+?) Strikes against the same target, one with each of (?:its|their) [\w' -]+?\. (?:The [\w' -]+?|It|They) combines? the damage of [^.]+\. Both [^.]*?multiple attack penalty, but [^.]*?\bafter both\b[^.]*\. (If (?:the [\w' -]+?|it|they) miss(?:es)? (?:with )?both\b[^.]*\.)$/i.exec(plain) : null;
    if (dual) return { builtin: "multi-strike", actions, strikes: [dual[1].toLowerCase(), dual[1].toLowerCase()], sameTarget: true, sameMap: true, notes: ["The hits' damage combined against resistances and weaknesses.", "If both miss, one Strike's damage still applies (none if both critically fail)."] };
    const armor = type === "action" ? /^Requirements? [^.]*?last action was (?:a spell|to cast a spell) with the (\w+) trait\.? Effect [^.]+?, which lasts (?:for )?(\d+) minutes?\. While [^.]*?, (?:the [\w' -]+?|it|they) gains? a \+(\d+) circumstance bonus to AC,? (?:and|but) loses? (?:its|their) weakness to (\w+)\. [^.]*\b\4 damage\b[^.]*\.$/i.exec(plain) : null;
    if (armor) return { builtin: "self-effect", actions, model: { name: item.name, rounds: 10 * Number(armor[2]), modifiers: [{ on: "ac", type: "circumstance", value: Number(armor[3]) }], tempHp: 0 }, damage: [], strike: null, melee: false, duration: { value: Number(armor[2]), unit: "minutes", expiry: null }, requires: "after-cast", notes: [`Only right after a spell with the ${armor[1]} trait.`, `Meanwhile it loses its weakness to ${armor[4]}; ${armor[4]} damage melts the armor (remove the effect).`] };
    const lift = type === "action" ? /^(?:The )?[\w' -]+? attempts an Athletics check to Grapple a creature (?:it|they) can see within (\d+) feet\. ((?:[^.]+\. )*?)On a success, (?:in addition to the normal effects of Grapple|besides [^,]+), ([^.]+)\.((?: [^.]+\.)*)$/i.exec(plain) : null;
    if (lift) {
        const held = (slug) => ({ ...none(), effects: [{ kind: "condition", slug, value: null, duration: null }] });
        return { ...base(item), targeting: { target: "1 creature", range: `${lift[1]} feet`, area: null }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "skill", statistic: "athletics", against: { dc: "target", statistic: "fortitude" } }, sharedDamage: null, outcomes: { criticalSuccess: held("restrained"), success: held("grabbed"), failure: none(), criticalFailure: none() } }, notes: [...lift[2].trim().split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean), `On a success, also ${lift[3]}.`, ...lift[4].trim().split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean)] };
    }
    const tempo = type === "action" ? /^(?:[^.]+\. )?(?:The [\w' -]+?|It) and all (?:of )?(?:its|their) allies within an? @T gain (\d+) temporary Hit Points and (?:are|become) Quickened for 1 round; ((?:they|it) can use (?:this|the) extra action (?:for )?only [^.]+|(?:this|that|the) extra action (?:may|can) only be used [^.]+)\.((?: [^.]+\.)*)$/i.exec(plain) : null;
    const tempoArea = tempo ? inlineTags(html, "Template").map(readTemplate).find(Boolean) : null;
    if (tempo && tempoArea?.type === "emanation") {
        const lifted = { ...none(), effects: [{ kind: "temp-hp", formula: tempo[1] }, { kind: "condition", slug: "quickened", value: null, duration: { mode: "fixed", value: 1, unit: "rounds", expiry: "turn-start", anchor: "effect-start" } }] };
        return { ...base(item), targeting: { target: null, range: null, area: { type: "emanation", value: Number(tempoArea.value) }, allies: true }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: lifted, failure: none(), criticalFailure: none() } }, notes: ["Itself too.", `${tempo[2][0].toUpperCase()}${tempo[2].slice(1)}.`, ...tempo[3].trim().split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean)] };
    }
    const twice = type === "action" ? /^(?:Frequency [^.]+?\.? Effect )?(?:[^.]+\. )?(?:The [\w' -]+?|It) makes an? ([\w' -]+?) Strike, rolling (?:the attack|it) twice and (?:using|keeping) the (?:better|higher)(?: result)?\. (The attack ignores [^.]+)\.$/i.exec(plain) : null;
    if (twice) {
        const wait = /Frequency Once every \[\[\/(?:gm|b)?r (\d+d\d+)[^\]]*\]\]/i.exec(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "))?.[1];
        return { builtin: "strike-activity", actions, strides: 0, strike: twice[1].toLowerCase(), attackBonus: 0, damageBonus: 0, offGuard: false, requires: null, oncePerFight: false, onHit: { conditions: [], critical: null, push: null, damage: [], save: null, size: null }, notes: ["Roll the attack twice and keep the better (fortune).", `${twice[2]}.`, ...(wait ? [`Not again for ${wait} rounds (roll it).`] : [])] };
    }
    // (Its damage a roll, "[[/r …]]{2d6+6 nonlethal bludgeoning}", which reaches here as an @Damage tag.)
    const gulpPlain = htmlToPlainText(html.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\[\[\/r (?:[^[\]]|\[[^\]]*\])+\]\](?:\{([^}]*)\})?/g, (_all, label) => label ?? "@D").replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g, "@D")).replace(/\s+/g, " ").trim();
    const gulp = type === "action" ? /^(?:The )?[\w' -]+? uses Swallow Whole on an? (Tiny|Small|Medium|Large|Huge) or smaller creature (?:it has Grabbed|it holds) (?:in|with) its [\w' -]+? \(([^,)]+), Rupture (\d+)\)\.((?: [^.]+\.)*)$/i.exec(gulpPlain) : null;
    const gulpDamage = gulp ? /\[\[\/r ((?:[^[\]]|\[[^\]]*\])+)\]\]/.exec(html)?.[1] ?? inlineTags(html, "Damage").map(readDamage)[0] : null;
    if (gulp && gulpDamage) {
        let swallowed = null;
        try {
            swallowed = compileMonsterAbility({ type: "action", name: "Swallow Whole", system: { slug: "swallow-whole", actionType: { value: "action" }, actions: { value: 1 }, traits: { value: [] }, description: { value: `<p>${gulp[1]}, [[/r ${gulpDamage}]] damage, Rupture ${gulp[3]}</p>` } } }, { actor });
        } catch {
            swallowed = null;
        }
        if (swallowed?.resolution) return { ...swallowed, source: base(item).source, activation: { time: String(actions), traits: [...(item.system?.traits?.value ?? [])] }, notes: [...(/\bnonlethal\b/i.test(gulp[2]) ? ["Its damage is nonlethal."] : []), ...gulp[4].trim().split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean)] };
    }
    const COUNT = { two: 2, three: 3, four: 4 };
    const maul = type === "action" ? /^(?:The )?[\w' -]+? makes (two|three|four) ([\w' -]+?) Strikes, each (?:with|at) an? [-–−](\d+) penalty, against a creature it (?:has Grabbed|holds)\. [^.]*multiple attack penalty[^.]*\b(?:doesn't|does not) (?:increase|rise) until after\b[^.]*\.$/i.exec(plain) : null;
    if (maul) return { builtin: "multi-strike", actions, strikes: Array(COUNT[maul[1].toLowerCase()]).fill(maul[2].toLowerCase()), sameTarget: true, sameMap: true, penalty: Number(maul[3]), notes: ["Only at a creature it has Grabbed."] };
    const shards = type === "action" ? /^(?:The )?[\w' -]+? (?:flings|hurls|throws|fires) [^.]+?, making (two|three|four) ([\w' -]+?) Strikes against one to \1 creatures within (\d+) feet\. (?:Its|Their|The) multiple attack penalty (?:doesn't|does not) increase until after all \1 attacks\.((?: [^.]+\.)*)$/i.exec(plain) : null;
    if (shards) return { builtin: "multi-strike", actions, strikes: Array(COUNT[shards[1].toLowerCase()]).fill(shards[2].toLowerCase()), sameMap: true, notes: [`Each at one of up to ${shards[1]} creatures within ${shards[3]} feet.`, ...shards[4].trim().split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean)] };
    const gazed = type === "action" ? /^(?:The )?[^.]+? (?:fix|fixes|turn|turns) (?:their|its) (?:gaze|stare|eyes) (?:on|to) a creature within (\d+) feet\. That creature must attempt an? @C (?:saving throw|save)\. On a (?:failed save|failure), the creature (?:becomes|is) Dazzled for (\d+) (minute|round)s?; if (?:the creature|it) (?:was|is) already dazzled, (?:it is|it's|it becomes) Blinded for \2 \3s? instead\.((?: [^.]+\.)*)$/i.exec(plain.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")) : null;
    const gazeCheck = gazed ? inlineTags(html, "Check").map(readCheck).find((check) => check?.save && check.dc) : null;
    if (gazed && gazeCheck) {
        const row = { ...none(), effects: [{ kind: "condition", slug: "dazzled", value: null, duration: { mode: "fixed", value: Number(gazed[2]), unit: `${gazed[3].toLowerCase()}s`, expiry: null, anchor: "effect-start" } }] };
        return { ...base(item), targeting: { target: "1 creature", range: `${gazed[1]} feet`, area: null }, trigger: { event: "use" }, resolution: { kind: "save", check: { roll: "save", statistic: gazeCheck.statistic, basic: false, against: { dc: "fixed", value: gazeCheck.dc } }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: none(), failure: row, criticalFailure: structuredClone(row) } }, notes: [`If it was already Dazzled, it's Blinded for ${gazed[2]} ${gazed[3].toLowerCase()}${gazed[2] === "1" ? "" : "s"} instead (the GM's).`, ...gazed[4].trim().split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean)] };
    }
    const strikeOf = (strike, strides, onHit, notes) => ({ builtin: "strike-activity", actions, strides, strike, attackBonus: 0, damageBonus: 0, offGuard: false, requires: null, oncePerFight: false, onHit: { conditions: [], critical: null, push: null, damage: [], save: null, size: null, ...onHit }, ...(notes.length ? { notes } : {}) });
    const cascade = type === "action" ? /^(?:[^.]+\. )?(?:The )?[\w' -]+? Strides (twice|three times),? (?:and|then) makes an? (?:melee )?([\w' -]+?) Strike (?:against|at) an adjacent (?:creature|foe) (?:at the end of (?:its|the) (?:movement|move)|afterward)\. On a hit, (?:the Strike|it) deals no damage, (?:but|and) the (?:creature|target) is (Dazzled|Off-Guard|Frightened 1|Clumsy 1) until the (?:beginning|start) of (?:the [\w' -]+?['’]s|its) next turn\.$/i.exec(plain.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")) : null;
    if (cascade) {
        const [slug, value] = cascade[3].toLowerCase().split(" ");
        return strikeOf(cascade[2].toLowerCase(), cascade[1].toLowerCase() === "twice" ? 2 : 3, { conditions: [{ slug, value: value ? Number(value) : null, duration: { mode: "fixed", value: 1, unit: "rounds", expiry: "turn-start", anchor: "source-turn" } }] }, ["A hit only applies the condition: undo the Strike's damage."]);
    }
    const hop = type === "action" ? /^(?:The )?[\w' -]+? Strides,? (?:and )?then Leaps\. (?:If|When) it lands (?:adjacent to|next to|beside) a creature,? it can make an? ([\w' -]+?) Strike against (?:that creature|it)\. (?:If the Strike is successful|On a hit),? the (?:creature|target) is pushed (\d+) feet \((\d+) feet on a critical (?:success|hit)\)\.$/i.exec(plain) : null;
    if (hop) return strikeOf(hop[1].toLowerCase(), 1, { push: Number(hop[2]) }, [`A Leap after the Stride; on a critical hit the push is ${hop[3]} feet.`]);
    const confusing = type === "action" ? /^(?:Frequency [^.]+?\.? Effect )?(?:[^.]+\. )?(?:The [\w' -]+?|It) makes an? ([\w' -]+?) Strike\. On a hit, the target must succeed (?:at )?an? @C save or be Confused for (\d+) (minute|round)s?\.( It can attempt a new saving throw at the end of each of its turns to end the confusion\.)?$/i.exec(plain.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")) : null;
    const confuseCheck = confusing ? inlineTags(html, "Check").map(readCheck).find((check) => check?.save && check.dc) : null;
    if (confusing && confuseCheck) {
        const row = { ...none(), effects: [{ kind: "condition", slug: "confused", value: null, duration: { mode: "fixed", value: Number(confusing[2]), unit: `${confusing[3].toLowerCase()}s`, expiry: null, anchor: "effect-start" } }] };
        const save = { ...base(item, { time: "free" }), targeting: { target: "the creature the Strike hits", range: "touch", area: null }, trigger: { event: "strike-activity" }, resolution: { kind: "save", check: { roll: "save", statistic: confuseCheck.statistic, basic: false, against: { dc: "fixed", value: confuseCheck.dc } }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: none(), failure: row, criticalFailure: structuredClone(row) } } };
        return strikeOf(confusing[1].toLowerCase(), 0, { save }, confusing[4] ? ["It attempts a new save at the end of each of its turns to end the confusion."] : []);
    }
    const peck = type === "action" ? /^(?:[^.]+\. )?(?:The [\w' -]+?|It) makes an? ([\w' -]+?) Strike (?:against|at) an? (?:Tiny|Small|Medium|Large|Huge)(?: or smaller)? creature with eyes\. (?:If the Strike hits|On a hit), the (?:creature|target) takes @D damage and is Dazzled until (?:it removes the bleed damage|the bleeding (?:stops|ends))\.((?: [^.]+\.)*)$/i.exec(plain.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")) : null;
    const peckDamage = peck ? inlineTags(html, "Damage").map(readDamage) : [];
    if (peck && peckDamage.length === 1) return strikeOf(peck[1].toLowerCase(), 0, { damage: [peckDamage[0]], conditions: [{ slug: "dazzled", value: null, duration: null }] }, ["Only a creature with eyes.", "Dazzled until the bleeding stops (remove it then).", ...peck[2].trim().split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean)]);
    const slices = type === "action" ? /^Requirements? [^.]+?construct armor (?:isn't broken|is not broken|is intact)\.? Effect [^.]+\. (?:It|The [\w' -]+?) (?:makes|attempts) two Strikes, one (?:with|using) each of its ([\w' -]+?)s, each (?:using|at) its current multiple attack penalty\. Both (?:Strikes|attacks) must (?:have|target) the same (?:target|creature)\.((?: [^.]+\.)*)$/i.exec(plain) : null;
    if (slices) return { builtin: "multi-strike", actions, strikes: [slices[1].toLowerCase(), slices[1].toLowerCase()], sameTarget: true, sameMap: true, countsAs: 2, notes: ["Only while its construct armor isn't broken.", "If both hit, their damage is combined (precision once) against resistances and weaknesses."] };
    const assault = type === "action" ? /^(?:The )?[\w' -]+? makes an? ([\w' -]+?) Strike(?: and then|, then|, followed by) two (?:more )?Strikes with either its ([\w' -]+?) or its ([\w' -]+?)\. If [^.]*?\bdifferent creatures, [^.]*?\buntil after all the Strikes\b[^.]*\.(?: Otherwise, [^.]+\.)?$/i.exec(plain) : null;
    if (assault) return { builtin: "multi-strike", actions, strikes: [assault[1].toLowerCase(), assault[2].toLowerCase(), assault[2].toLowerCase()], each: true, sameMap: true, notes: [`The last two with its ${assault[2].toLowerCase()} or its ${assault[3].toLowerCase()}.`, "The penalty is held only when every Strike is at a different creature; otherwise it rises as normal."] };
    const squeeze = /^(?:Frequency [^.]+?\.? Effect )?(?:The )?[\w' -]+? (?:arms )?(?:squeeze and pull on|squeezes|crushes) all creatures (?:Grabbed by it|it holds), (?:rolling|with) a single Athletics check (?:and comparing the result )?against each (?:grabbed )?creature['’]s Fortitude DC\. On a success, (?:the [\w' -]+?|it) deals @D damage and (?:pulls|drags) (?:the creature|it) (\d+) feet [^(]*\((\d+) feet(?:,| and) (?:double|twice the) damage on (?:a )?critical success\)\.$/i.exec(plain.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\[\[\/r (?:[^[\]]|\[[^\]]*\])+\]\](?:\{[^}]*\})?/g, "@D"));
    const squeezeDamage = squeeze ? (/\[\[\/r ((?:[^[\]]|\[[^\]]*\])+)\]\]/.exec(html)?.[1] ?? inlineTags(html, "Damage").map(readDamage)[0]) : null;
    if (type === "action" && squeeze && squeezeDamage) {
        const pull = (feet, formula) => ({ damage: { mode: "formulas", formulas: [{ formula }] }, effects: [], forcedMovement: { kind: "pull", distance: Number(feet), upTo: false, optional: false, direction: "toward" } });
        return { ...base(item), targeting: { target: "every creature it holds", range: null, area: null, grabbed: true }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "skill", statistic: "athletics", against: { dc: "target", statistic: "fortitude" } }, sharedDamage: null, outcomes: { criticalSuccess: pull(squeeze[2], `2*${squeezeDamage}`), success: pull(squeeze[1], squeezeDamage), failure: none(), criticalFailure: none() } }, notes: ["One roll compared against each creature's Fortitude DC."] };
    }
    const harvest = type === "action" ? /^(?:Frequency [^.]+?\.? Effect )?(?:[^.]+\. )?(?:The [\w' -]+?|It) (?:immediately )?heals @D Hit Points (?:while|and) ((?:firing off|tosses|throws|sends) [^.]+? to up to (\w+) allies within (\d+) feet)\.((?: [^.]+\.)*)$/i.exec(plain) : null;
    const harvestHeal = harvest ? inlineTags(html, "Damage").map(readDamage) : [];
    if (harvest && harvestHeal.length >= 1) {
        const formula = harvestHeal[0].replace(/\[[^\]]*healing[^\]]*\]$/i, "").replace(/^\((.*)\)$/, "$1");
        return { ...base(item), targeting: { target: "self", range: null, area: null }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: { damage: none().damage, effects: [{ kind: "heal", formula }] }, failure: none(), criticalFailure: none() } }, notes: [`Also up to ${harvest[2]} allies within ${harvest[3]} feet each get a treat that heals ${harvestHeal[1] ? harvestHeal[1].replace(/\[[^\]]*healing[^\]]*\]$/i, "").replace(/^\((.*)\)$/, "$1") : "them"} when eaten (the GM's).`] };
    }
    const flank = type === "action" ? /^(?:The )?[\w' -]+? makes two ([\w' -]+?) Strikes (?:against|at) (?:a creature|one creature|a foe) within [^.]+?\. (?:Whether or not|Hit or miss on) the first (?:attack|Strike)(?: hits)?, the second (?:attack|Strike) deals (\d+d\d+) (?:additional|extra) (\w+) damage\.(?: [^.]*multiple attack penalty[^.]*\.)?$/i.exec(plain) : null;
    if (flank) return { builtin: "multi-strike", actions, strikes: [flank[1].toLowerCase(), flank[1].toLowerCase()], sameTarget: true, notes: [`The second Strike deals ${flank[2]} more ${flank[3].toLowerCase()} damage, hit or miss on the first.`] };
    const chorus = /^(?:Frequency [^.]+?\.? Effect )?(?:The )?[\w' -]+? becomes Quickened for 1 round\. ((?:This|Its) (?:additional|extra) action [^.]+)\. (?:The [\w' -]+?|It|They) (?:is|are) (?:then )?Slowed (\d) (?:on|during) (?:its|their) next turn\.$/i.exec(plain);
    if (chorus) {
        const success = { damage: none().damage, effects: [{ kind: "condition", slug: "quickened", value: null, duration: { mode: "fixed", value: 1, unit: "rounds", expiry: "turn-start", anchor: "effect-start" } }] };
        return { ...base(item), targeting: { target: "self", range: null, area: null }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success, failure: none(), criticalFailure: none() } }, notes: [`${chorus[1]}.`, `It's Slowed ${chorus[2]} on its next turn (apply it then).`] };
    }
    return null;
}

// Battlezoo reactions and follow-ups (2026-10-12, batch 270), described in our own words. null otherwise:
// - a save for the creature that set it off, a condition on a failure, how it ends a note;
// - after its Strike hits, a save or the creature is moved to its other side (Prone too on a critical failure);
// - (batch 271) a creature striding near it: a save, or its squares are hard going and it may end up held (the GM's, notes on the failure);
// - (batch 271) its own failed save made a success, or 0 Hit Points made 1, then Sickened 1 (a note).
function bzReactions(item, actor) {
    const type = item.system?.actionType?.value;
    if (!["reaction", "free"].includes(type)) return null;
    const html = String(item.system?.description?.value ?? "");
    const plain = htmlToPlainText(html.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@Check\[[^\]]*\](?:\{[^}]*\})?/g, "@C")).replace(/\s+/g, " ").trim();
    const split = /^(?:Frequency [^.]+? )?Trigger (.+?)[;.]? Effect (.+)$/.exec(plain);
    if (!split) return null;
    // (A failed save made a success with a price; no check of its own.)
    const party = type === "free" ? /^(?:The )?[\w' -]+? fails or critically fails a sav(?:ing throw|e) or (?:is reduced|drops) to 0 Hit Points(?: Requirements? (?:The )?[\w' -]+? (?:isn't|is not) (Sickened))?$/i.exec(split[1].trim()) : null;
    const partied = party ? /\bIf (?:they|it) would (?:have been reduced|drop) to 0 Hit Points, (?:they|it) (?:remains?|stays?) at 1 Hit Point\. If (?:they|it) failed or critically failed a sav(?:ing throw|e), (?:they|it) gets? a (?:regular )?success instead\. (?:Either way|In both cases), (?:they|it) becomes? Sickened (\d)\.$/i.exec(split[2].trim()) : null;
    if (partied) return { builtin: "save-boost", toSuccess: true, free: true, notes: [`It becomes Sickened ${partied[1]} (apply it).`, "Also when it would drop to 0 Hit Points: it stays at 1 instead (the GM's).", ...(party[1] ? ["Not while it's Sickened."] : [])] };
    const check = inlineTags(html, "Check").map(readCheck).find((entry) => entry?.save && entry.dc);
    if (!check) return null;
    const save = { kind: "save", check: { roll: "save", statistic: check.statistic, basic: false, against: { dc: "fixed", value: check.dc } }, sharedDamage: null };
    const trigger = type === "reaction" ? readReactionTrigger(split[1].trim()) : null;
    const tangled = trigger ? /^The triggering creature must attempt an? @C (?:saving throw|save)\. On a failure, [^.]+\. The creature is (Grabbed|Restrained|Immobilized) and ([^.]+)\.$/i.exec(split[2].trim()) : null;
    if (tangled) {
        const row = { ...none(), effects: [{ kind: "condition", slug: tangled[1].toLowerCase(), value: null, duration: null }] };
        return { ...base(item), targeting: { target: "the triggering creature", range: null, area: null }, trigger: { ...trigger, reaction: true }, resolution: { ...save, outcomes: { criticalSuccess: none(), success: none(), failure: row, criticalFailure: structuredClone(row) } }, notes: [`It ${tangled[2]}.`] };
    }
    const weeds = trigger?.event === "provoke" && trigger.triggers?.includes("move") ? /^(?:[^.]+\. )*The triggering creature treats (?:all|every) squares? as difficult terrain until (?:the end of its turn|its turn ends) unless it (?:succeeds at|makes) an? @C save(?: to avoid [^.]+)?\. On a failure, ((?:if|when) [^.]+?\bGrabbed\b[^.]*)\.$/i.exec(split[2].trim()) : null;
    if (weeds) {
        const hindered = { ...none(), manualInstructions: ["{target} treats every square as difficult terrain until the end of its turn."] };
        return { ...base(item), targeting: { target: "the triggering creature", range: trigger.within ? `${trigger.within} feet` : null, area: null }, trigger: { ...trigger, reaction: true }, resolution: { ...save, outcomes: { criticalSuccess: none(), success: none(), failure: hindered, criticalFailure: structuredClone(hindered) } }, notes: [`On a failure, ${weeds[1]}.`] };
    }
    const after = type === "free" ? /^(?:The )?[\w' -]+?['’]s last action was a successful ([\w' -]+?) Strike against an? (Tiny|Small|Medium|Large|Huge)(?: or smaller)? creature$/i.exec(split[1].trim()) : null;
    const flipped = after ? /^(?:The )?[^.]+?\. The creature must succeed at an? @C save or (?:it is repositioned|it's moved) to an? (?:empty|open|free) space on (?:the [\w' -]+?['’]s|its) (?:opposite|other|far) side \(on a critical failure, (?:the creature|it) also falls Prone\)\.((?: [^.]+\.)*)$/i.exec(split[2].trim()) : null;
    if (flipped) {
        const moved = { ...none(), manualInstructions: ["Move {target} across to a free square behind it, as far from it as before."] };
        const worse = { ...structuredClone(moved), effects: [{ kind: "condition", slug: "prone", value: null, duration: null }] };
        return { ...base(item), targeting: { target: "the creature the Strike hits", range: "touch", area: null }, trigger: { event: "use", followUp: { strike: after[1].toLowerCase(), melee: false, on: ["success", "criticalSuccess"] } }, resolution: { ...save, outcomes: { criticalSuccess: none(), success: none(), failure: moved, criticalFailure: worse } }, notes: [`Only a ${after[2]} or smaller creature.`, ...flipped[1].trim().split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean)] };
    }
    return null;
}

// The long tail after the user's choices of 2026-10-13, part 1 (batch 273). null otherwise:
// - a troop's Grapple against every creature of a size around it, then a flight carrying them off (notes);
// - a reaction to dropping a creature with its own ability: that ability again;
// - a status bonus to damage by actions spent (the least of it, the rest notes);
// - Strides with Steal attempts along the way: Thievery against each one's Perception DC, the item the GM's;
// - one maneuver of its choice against each enemy around it: a way for each (the GM picks);
// - its Strikes counting as a precious material of its choice for a minute;
// - a free Grapple at a creature that failed its save against one of its abilities; a troop's Grapple at those that failed against its last action;
// - burning hoofprints along its Stride: a line the GM places, damage on entering or starting a turn there;
// - smoke from a quick bomb: concealment in a burst the GM places for a minute;
// - a soul taken from a dying creature on a failed save (the GM's to track);
// - Stupefied for a creature that failed a save against its spell, the Focus Point a note;
// - a hazard's mud, door, frozen time or animated objects: their saves, the rest notes, or only joining the fight.
function chunk273(item, actor, basicActions) {
    const type = item.system?.actionType?.value;
    const html = String(item.system?.description?.value ?? "");
    const owner = actor ?? item.actor ?? item.parent;
    const plain = htmlToPlainText(html.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\[\[\/act ([\w-]+)[^\]]*\]\](?:\{([^}]*)\})?/g, (_all, slug, label) => label ?? slug.replace(/-/g, " ").replace(/^\w/, (letter) => letter.toUpperCase())).replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g, "@D").replace(/@Check\[[^\]]*\](?:\{[^}]*\})?/g, "@C").replace(/@Template\[[^\]]*\](?:\{[^}]*\})?/g, "@T")).replace(/\s+/g, " ").trim();
    const actions = Number(item.system?.actions?.value) || 1;
    const check = inlineTags(html, "Check").map(readCheck).find((entry) => entry?.save && entry.dc);
    const template = inlineTags(html, "Template").map(readTemplate).find(Boolean);
    const held = (slug) => ({ ...none(), effects: [{ kind: "condition", slug, value: null, duration: null }] });
    const grapple = (targeting, trigger, notes) => ({ ...base(item), targeting, trigger, resolution: { kind: "check", check: { roll: "skill", statistic: "athletics", against: { dc: "target", statistic: "fortitude" } }, sharedDamage: null, outcomes: { criticalSuccess: held("restrained"), success: held("grabbed"), failure: none(), criticalFailure: none() } }, ...(notes.length ? { notes } : {}) });
    const saveOf = (entry) => ({ kind: "save", check: { roll: "save", statistic: entry.statistic, basic: false, against: { dc: "fixed", value: entry.dc } }, sharedDamage: null });
    const split = /^(?:Frequency [^.]+?\.? )?Trigger (.+?)[;.]?(?: Requirements? [^.]+?\.?)? Effect (.+)$/.exec(plain);
    const hazard = owner?.type === "hazard";
    if (type === "action") {
        const carried = /^(?:The )?[\w' -]+? attempts? an Athletics checks? to Grapple, comparing the result to the Fortitude DC of a number of (Tiny|Small|Medium|Large|Huge) or smaller creatures in an? @T equal to [^,]+, then (Flies up to \d+ feet, [^.]+)\.$/i.exec(plain);
        if (carried && template) return grapple({ target: null, range: null, area: { type: template.type, value: Number(template.value) } }, { event: "use" }, [`Up to as many ${carried[1]} or smaller creatures as it has segments.`, `Then it ${carried[2].replace(/^Flies/, "Flies")}.`]);
        const steal = /^(?:[^.]+\. )?(?:The )?[\w' -]+? Strides up to (twice|three times) (?:their|its) Speed\. During this movement, [^.]*?\battempt to Steal an item from a creature (?:they are|it is) adjacent to;[^.]*\.$/i.exec(plain);
        if (steal) return { ...base(item), targeting: { target: "1 creature", range: "touch", area: null }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "skill", statistic: "thievery", against: { dc: "target", statistic: "perception" } }, sharedDamage: null, outcomes: { criticalSuccess: { ...none(), manualInstructions: ["{target} loses an item it isn't holding (the GM picks it)."] }, success: { ...none(), manualInstructions: ["{target} loses an item it isn't holding (the GM picks it)."] }, failure: none(), criticalFailure: none() } }, notes: [`It Strides up to ${steal[1]} its Speed; a Steal at each creature it passes beside, as many as it has segments (or unattended objects picked up).`] };
        const maneuvers = /^(?:[^.]+\. )?(?:The )?[\w' -]+? choose (Disarm, Grapple, Reposition, or (?:Reposition|Trip)) and attempt an Athletics check to perform that action, comparing the result to the appropriate DC [^.]*? of each enemy within an? @T\.((?: [^.]+\.)*)$/i.exec(plain);
        if (maneuvers) return { builtin: "modes", actions, modes: ["disarm", "grapple", "reposition", "trip"].map((action) => ({ name: action.replace(/^\w/, (letter) => letter.toUpperCase()), plan: { builtin: "skill-sweep", actions, action } })) };
        const mandibles = /^Requirements? [^.]+?\.? Effect If used after [A-Z][\w' -]+?, (?:the [\w' -]+?|it) can attempt an Athletics check to Grapple, comparing the result to the Fortitude DC of each creature who failed its saving throw, up to as many creatures as (?:the [\w' -]+?|it) has remaining segments\. ((?:The [\w' -]+?|It) can instead [^.]+)\.$/i.exec(plain);
        if (mandibles) return { ...grapple({ target: "the creatures that failed its last save", range: null, area: null }, { event: "use" }, ["Only creatures that failed their save against its last action, up to as many as it has segments.", `${mandibles[1].replace(/^The [\w' -]+? can/, "Or it can")}.`]), requires: "requirement" };
        // (An attack of its own at a fixed modifier — a kobold thrown at a creature: the attack against AC, the kobold's share a note.)
        const tossed = /^Requirements? ([^.]+?)\.? Effect [^.]+? at another creature within (\d+) feet\. This ranged Strike has a \+(\d+) attack modifier and deals (\d+d\d+(?:\+\d+)?) (\w+) damage\.((?: [^.]+\.)*)$/i.exec(plain);
        if (tossed) {
            const formula = `${/\+/.test(tossed[4]) ? `(${tossed[4]})` : tossed[4]}[${tossed[5].toLowerCase()}]`;
            const hit = (double) => ({ damage: { mode: "formulas", formulas: [{ formula: double ? `2*${formula}` : formula }], rollScope: "target" }, effects: [] });
            return { ...base(item), targeting: { target: "1 creature", range: `${tossed[2]} feet`, area: null }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "skill", statistic: String(item.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), against: { dc: "target", statistic: "ac" }, modifier: Number(tossed[3]) }, sharedDamage: null, outcomes: { criticalSuccess: hit(true), success: hit(false), failure: none(), criticalFailure: none() } }, requires: "requirement", notes: [`Only when ${tossed[1].replace(/^A /, "a ")}.`, ...tossed[6].trim().split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean)] };
        }
        const hooves = /^(?:The )?[\w' -]+? Strides, leaving [^.]+? in each square (?:they|it) enters?\. The [\w' -]+? continue to burn for (\d+) minutes?\. Any creature on the ground that begins its turn in, or enters a square with, [^.]+? takes @D damage\.$/i.exec(plain);
        const hoofDamage = hooves ? inlineTags(html, "Damage").map(readDamage) : [];
        if (hooves && hoofDamage.length === 1) {
            const speed = Number(owner?.system?.attributes?.speed?.value) || 25;
            return { builtin: "zone", actions, zone: { area: { type: "line", value: speed }, centre: "placed", range: null, lasts: { mode: "fixed", value: Number(hooves[1]), unit: "minutes", expiry: "turn-start", anchor: "effect-start" }, untilReused: false, concealed: false, terrain: [], others: false, hazard: null, saves: [], damage: [{ when: "enter", formulas: [hoofDamage[0]] }, { when: "start", formulas: [hoofDamage[0]] }], effect: null, modifiers: [], notes: ["The GM lays the line along its Stride.", "Only creatures on the ground."] } };
        }
    }
    if (type === "free") {
        const soak = split ? /^(?:The )?[\w' -]+? gains a status bonus to damage rolls for (\d+) minutes?\. The bonus is \+(\d+) if (?:they|it) spends? one action on ([A-Z][\w' -]+?), (\+\d+ if (?:they|it) spends? two actions, or \+\d+ if (?:they|it) spends? (?:3|three) actions)\.((?: [^.]+\.)*)$/i.exec(split[2].trim()) : null;
        if (soak) return { builtin: "self-effect", actions: 0, model: { name: item.name, rounds: 10 * Number(soak[1]), modifiers: [{ on: "damage", type: "status", value: Number(soak[2]) }], tempHp: 0 }, damage: [], strike: null, melee: false, duration: { value: Number(soak[1]), unit: "minutes", expiry: null }, notes: [`The bonus is the one-action ${soak[3]}'s; ${soak[4]} (raise it).`, ...soak[5].trim().split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean)] };
        const material = /^(?:Frequency [^.]+?\.? Effect )?(?:The )?[\w' -]+? chooses ((?:adamantine|cold iron|silver)(?:, (?:adamantine|cold iron|silver))*,? or (?:adamantine|cold iron|silver)); the damage dealt by its [^.]+? is treated as that material for (\d+) minutes? or until it uses [\w' -]+? again\.$/i.exec(plain);
        if (material) return { builtin: "self-effect", actions: 0, model: { name: item.name, rounds: 10 * Number(material[2]), modifiers: [], tempHp: 0, materials: material[1].split(/,\s*(?:or\s+)?|\s+or\s+/).map((word) => word.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean) }, damage: [], strike: null, melee: true, duration: { value: Number(material[2]), unit: "minutes", expiry: null } };
        const bomb = /^Cost [^.]+? Effect (?:The )?[\w' -]+? mixes up [^.]+\. It remains potent only until the end of (?:his|her|its|their) next turn\. When (?:he|she|it|they) throws? this bomb, in addition to its normal effects, it creates a cloud of smoke in a (\d+)-foot radius burst\. Creatures in that area have the Concealed condition, and other creatures are concealed to them\. This smoke lasts for (\d+) minutes? or until dissipated by a strong wind\.$/i.exec(plain);
        if (bomb) return { builtin: "zone", actions: 0, zone: { area: { type: "burst", value: Number(bomb[1]) }, centre: "placed", range: null, lasts: { mode: "fixed", value: Number(bomb[2]), unit: "minutes", expiry: "turn-start", anchor: "effect-start" }, untilReused: false, concealed: true, terrain: [], others: false, hazard: null, saves: [], damage: [], effect: null, modifiers: [], notes: ["Where its bomb lands: the bomb itself (a lesser acid flask or alchemist's fire) is the GM's to throw.", "A strong wind disperses it."] } };
    }
    // (Stances to choose from: "They assume one of the following stances. Bone Corpse When … Cloudless Void The jiang-shi gains a +1 circumstance bonus to
    // AC and their claw Strikes gain the reach trait. Sundered Veins Creatures struck by the jiang-shi's claw Strikes take 1d10 persistent bleed damage.
    // On a critical hit, they are also Enfeebled 1." — a way for each, a stance for what plays, the GM's for the rest; one that uses it as a turn
    // begins, the same.)
    const stancesOf = (said) => {
        const list = /\b(?:assume|enter|adopt)s? one of the following stances\. (.+)$/i.exec(said)?.[1];
        if (!list) return null;
        const names = [...list.matchAll(/(?:^|\. )([A-Z][a-z]+(?: [A-Z][a-z]+)+) (?=[A-Z])/g)].map((match) => match[1]);
        if (names.length < 2) return null;
        return names.map((name, index) => {
            const start = list.indexOf(name) + name.length + 1;
            const end = index + 1 < names.length ? list.indexOf(` ${names[index + 1]} `, start) : list.length;
            const body = list.slice(start, end).trim().replace(/\.?$/, ".");
            const sentences = body.split(/(?<=\.)\s+(?=[A-Z])/);
            const ac = /\bgains? an? \+(\d+) (circumstance|status) bonus to AC\b/i.exec(body);
            const bleed = /^Creatures struck by (?:the [\w' -]+?['’]s|its) ([\w' -]+?) Strikes take (\d+d\d+) persistent (\w+) damage\.$/i.exec(sentences[0]);
            const plan = ac ? { builtin: "self-effect", actions: 1, model: { name, rounds: null, modifiers: [{ on: "ac", type: ac[2].toLowerCase(), value: Number(ac[1]) }], tempHp: 0 }, damage: [], strike: null, melee: false, stance: true, duration: { value: -1, unit: "unlimited", expiry: null }, notes: [body.replace(/^[^.]*?\bgains? an? \+\d+ (?:circumstance|status) bonus to AC\b(?: and )?/i, "Also ").replace(/^Also \.$/, "")].filter((note) => note && note !== "Also .") }
                : bleed ? { builtin: "self-effect", actions: 1, model: { name, rounds: null, modifiers: [], tempHp: 0 }, damage: [`${bleed[2]}[persistent,${bleed[3].toLowerCase()}]`], strike: bleed[1].toLowerCase(), melee: true, stance: true, duration: { value: -1, unit: "unlimited", expiry: null }, ...(sentences.length > 1 ? { notes: sentences.slice(1) } : {}) }
                    : null;
            return { name, plan, ...(plan ? {} : { notes: [body] }) };
        });
    };
    // (Checks written out in words for the notes: "a DC 5 flat check".)
    const worded = (raw) => htmlToPlainText(raw.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@Check\[(?:type:)?(\w+)\|dc:(\d+)[^\]]*\](?:\{[^}]*\})?/g, "DC $2 $1 check").replace(/\ba DC (\d+) flat check\b/g, "a DC $1 flat check")).replace(/\s+/g, " ").trim();
    const stances = type === "action" ? stancesOf(worded(html)) : null;
    if (stances?.some((way) => way.plan)) return { builtin: "modes", actions, modes: stances };
    const usesStance = split && /^(?:The )?[\w' -]+? rolls initiative or (?:their|its) turn begins$/i.test(split[1].trim()) ? /\buses ([A-Z][\w' -]+?)\.$/.exec(split[2].trim()) : null;
    const stanceItem = usesStance ? (owner?.items?.contents ?? owner?.items ?? []).find((entry) => entry?.type === "action" && entry.name === usesStance[1]) : null;
    if (stanceItem) {
        const ways = stancesOf(worded(String(stanceItem.system?.description?.value ?? "")));
        if (ways?.some((way) => way.plan)) return { builtin: "modes", actions: 0, modes: ways, notes: ["As it rolls initiative or its turn begins: a free use of its stances."] };
    }
    if (split && ["reaction", "free"].includes(type)) {
        const trigger = readReactionTrigger(split[1].trim());
        const effect = split[2].trim();
        const dropped = /^(?:The )?[\w' -]+? drops a creature to 0 Hit Points with ([A-Z][\w' -]+?)$/i.exec(split[1].trim());
        const again = dropped ? new RegExp(String.raw`^(?:The )?[\w' -]+? performs an additional one-action ${dropped[1]}, ignoring [^.]+\.( This does not deal damage to the triggering creature\.)?$`, "i").exec(effect) : null;
        const own = again ? (owner?.items?.contents ?? owner?.items ?? []).find((entry) => entry?.type === "action" && entry.name === dropped[1]) : null;
        if (own) {
            let plan = null;
            try {
                plan = compileMonsterAbility(own, { basicActions, actor: owner });
            } catch {
                plan = null;
            }
            if (plan?.resolution) return { ...plan, ...base(item), targeting: plan.targeting, resolution: plan.resolution, trigger: { event: "downs", reaction: true }, notes: [...(plan.notes ?? []), ...(again[1] ? ["Not at the creature it dropped."] : [])] };
        }
        if (trigger?.event === "foe-failed-save") {
            const grab = /^(?:The )?[\w' -]+? attempts an Athletics check to Grapple the triggering creature\.((?: [^.]+\.)*)$/i.exec(effect);
            if (grab) return { ...grapple({ target: "the triggering creature", range: null, area: null }, { ...trigger, ...(type === "free" ? { free: true } : {}) }, grab[1].trim().split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean)), activation: { time: type, traits: item.system?.traits?.value ?? [] } };
            const siphon = /^(?:[^.]+\. )?The triggering creature is (Stupefied|Clumsy|Enfeebled|Drained|Sickened|Frightened) (\d) for (\d+) rounds?, and (?:the [\w' -]+?|it) (regains \d+ Focus Points?)\.$/i.exec(effect);
            if (siphon) return { ...base(item), activation: { time: type, traits: item.system?.traits?.value ?? [] }, targeting: { target: "the triggering creature", range: null, area: null }, trigger, resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: { ...none(), effects: [{ kind: "condition", slug: siphon[1].toLowerCase(), value: Number(siphon[2]), duration: { mode: "fixed", value: Number(siphon[3]), unit: "rounds", expiry: "turn-start", anchor: "effect-start" } }] }, failure: none(), criticalFailure: none() } }, notes: [`It ${siphon[4]}.`] };
        }
        const soul = check && /^(?:The )?[\w' -]+? attempts to collect the triggering creature['’]s soul\. The triggering creature must succeed at an? @C save or its soul becomes trapped [^.]+\.((?: [^.]+\.)*)$/i.exec(effect);
        if (soul) return { ...base(item), activation: { time: type, traits: item.system?.traits?.value ?? [] }, targeting: { target: "the triggering creature", range: null, area: null }, trigger: { event: "use" }, resolution: { ...saveOf(check), outcomes: { criticalSuccess: none(), success: none(), failure: { ...none(), manualInstructions: ["{target}'s soul is trapped: it can't be brought back while it stays there."] }, criticalFailure: { ...none(), manualInstructions: ["{target}'s soul is trapped: it can't be brought back while it stays there."] } } }, notes: ["Only a dying creature in its aura that dies or whose dying value rises."] };
        if (hazard) {
            const mud = check && /^(?:[^.]+\. )?The area becomes difficult terrain for (\d+) (hours?|minutes?)\. All creatures in or moving through the area must succeed at an? @C save, or they become (Immobilized|Restrained|Grabbed) until they can Escape(?: DC (\d+))?\.$/i.exec(effect);
            if (mud) return { ...base(item), activation: { time: type, traits: item.system?.traits?.value ?? [] }, targeting: { target: "the creatures in the area", range: null, area: null }, trigger: { event: "hazard" }, resolution: { ...saveOf(check), outcomes: { criticalSuccess: none(), success: none(), failure: held(mud[3].toLowerCase()), criticalFailure: held(mud[3].toLowerCase()) } }, notes: [`The area is difficult terrain for ${mud[1]} ${mud[2]}.`, ...(mud[4] ? [`Escape DC ${mud[4]}.`] : [])] };
            const door = check && /^(?:[^.]+\. )?The [\w' -]+? pushes anyone in its space into an adjacent space in [^.]+\. A creature that would be pushed and succeeds at an? @C save selects which side of the door they end up on\.$/i.exec(effect);
            if (door) return { ...base(item), activation: { time: type, traits: item.system?.traits?.value ?? [] }, targeting: { target: "the creatures in the doorway", range: null, area: null }, trigger: { event: "hazard" }, resolution: { ...saveOf(check), outcomes: { criticalSuccess: { ...none(), manualInstructions: ["{target} picks which side of the door it ends up on."] }, success: { ...none(), manualInstructions: ["{target} picks which side of the door it ends up on."] }, failure: { ...none(), manualInstructions: ["Push {target} into the next room: the door shuts and locks."] }, criticalFailure: { ...none(), manualInstructions: ["Push {target} into the next room: the door shuts and locks."] } } } };
            const frozen = check && /^The triggering creature and all creatures within (\d+) feet are trapped in [^(]+\(@C negates\)\. ([^.]+\.)((?: [^.]+\.)*)$/i.exec(effect);
            if (frozen) return { ...base(item), activation: { time: type, traits: item.system?.traits?.value ?? [] }, targeting: { target: null, range: null, area: { type: "emanation", value: Number(frozen[1]) } }, trigger: { event: "hazard" }, resolution: { ...saveOf(check), outcomes: { criticalSuccess: none(), success: none(), failure: { ...none(), effects: [{ kind: "condition", slug: "paralyzed", value: null, duration: null }], manualInstructions: ["{target} is trapped in time: it can't act except to Recall Knowledge (shown as Paralyzed)."] }, criticalFailure: { ...none(), effects: [{ kind: "condition", slug: "paralyzed", value: null, duration: null }], manualInstructions: ["{target} is trapped in time: it can't act except to Recall Knowledge (shown as Paralyzed)."] } } }, notes: effect.slice(effect.indexOf(frozen[2]) + frozen[2].length).trim().split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean).slice(0, 3) };
            // (Spirits throwing creatures off a cliff: a check at its own modifier against Fortitude DC; the fall's damage and Prone; its other rules, notes.)
            const thrown = /^Each [\w' -]+? attempts to throw a creature within (\d+) feet of [^.]+? by attempting a check with a \+(\d+) modifier against the target['’]s (Fortitude|Reflex|Will) DC\. If the haunt succeeds, the target is thrown over the edge of the cliff, where it then falls (\d+) feet to the ground\.((?: [^.]+\.)*)$/i.exec(effect.replace(/@C/g, "a save"));
            if (thrown) {
                const fall = { damage: { mode: "formulas", formulas: [{ formula: `${Math.floor(Number(thrown[4]) / 2)}[bludgeoning]` }], rollScope: "target" }, effects: [{ kind: "condition", slug: "prone", value: null, duration: null }], manualInstructions: ["{target} is thrown off the cliff and falls to the ground below."] };
                return { ...base(item), activation: { time: type, traits: item.system?.traits?.value ?? [] }, targeting: { target: "1 creature", range: `${thrown[1]} feet`, area: null }, trigger: { event: "hazard" }, resolution: { kind: "check", check: { roll: "skill", statistic: "throw", against: { dc: "target", statistic: thrown[3].toLowerCase() }, modifier: Number(thrown[2]) }, sharedDamage: null, outcomes: { criticalSuccess: fall, success: structuredClone(fall), failure: none(), criticalFailure: none() } }, notes: ["One creature for each spirit.", ...thrown[5].trim().split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean)] };
            }
            const swarm = /^Each [\w' -]+? constructs a cloud of objects in the room \([^)]*\) and the trap rolls initiative\.((?: [^.]+\.)*)$/i.exec(effect);
            if (swarm) return { builtin: "no-effect", notes: ["Its decorations' attacks are its routine's: the creatures in the room as it triggers are its targets."] };
        }
    }
    return null;
}

// Group D, more (2026-10-13, batch 274; the user's call: build the rest). null otherwise:
// - an AC bonus to the allies beside it ("…, granting a +1 circumstance bonus to AC adjacent allies. … until the start of its next turn, but only
//   grants the bonus while allies remain adjacent.") or on its passengers ("…, enveloping all passengers and giving each passenger a +2 circumstance
//   bonus to AC until the beginning of …'s next turn.") → that bonus on them;
// - a pit it opens ("… create a 10-foot-square, 50-foot-deep pit in earthen material or stone within 60 feet.") → a square zone the GM places,
//   the fall's damage on the creatures there as it opens;
// - resistance against metal ("… gaining resistance 2 to damage from metal weapons and metal effects until the beginning of its next turn.") → on
//   itself;
// - an element of its choice ("… attunes itself to one of five elements … (yellow for earth, red for fire, …). It gains that trait and a +2 status
//   bonus to saving throws against effects with that trait until the beginning of its next turn.") → a way for each, the bonus against that trait;
// - lights put out, a burning Strike after ("… extinguishes light sources in a 10-foot emanation. … If the lamp blighter successfully extinguishes any
//   light, their next successful claw or shortbow Strike deals 1d6 persistent fire damage.") → that damage on its next Strike, the lights a note;
// - a Strike that eats magic ("The silt frog makes a jaws Strike. If the Strike hits and deals damage, the frog attempts to ingest the highest spell …,
//   using the result of its Strike as a counteract check. …") → the Strike, the counteracting and healing notes;
// - an ally taken inside ("… absorbs a willing construct within its reach. That construct doesn't exist separately until …") → a note Effect on it;
// - three of its own abilities at once ("The ancient dragon uses Word of Advice, Word of Caution, and Word of Heroism, though any given ally can only
//   be the target of a single Word.") → each of them in turn, a way each;
// - a single Disarm against the creatures its last Strike damaged ("… attempts a single Athletics check to Disarm, comparing the result to the Reflex
//   DC of each creature that was damaged by the required Scurvy Strike. If the result is a critical failure, the crew gets a failure instead.");
// - a Grapple that swallows ("… attempts to Grapple a creature within reach. On a success, the creature is pulled into the Monster's body. … Slowed 1
//   while it envelops a creature, and this otherwise has the effects of Swallow Whole (the Melfesh Monster's size or smaller, 1d10 bludgeoning and
//   1d12 poison, Rupture 15).") → Grapple's check, swallowed on a success;
// - an imitation by Deception against a listener's Will DC (Sound Mimicry) → that check, the listener fooled on a success;
// - a trail of runes ("… Strides, leaving behind a collection of runes wherever it steps. The dragon chooses to leave behind either detonating runes or
//   entangling runes. … These runes automatically activate when a creature other than the rune dragon enters the space or ends its turn in the
//   space.") → a way for each kind: a line the GM places, its own rune's save (or its words) on entering or ending a turn there;
// - a trill for the next of its kind to cast (Arcane Harmony) → a note Effect on its allies around it, the two benefits;
// - water that helps its allies and drowns its foes (Sink or Swim: for a minute, an ally's success to Swim within 60 feet is a critical success, an
//   enemy's failure there a critical failure) → a zone around it for the minute, PF2e's degree adjustments on each side's Swim checks, the
//   turbulent water a note;
// - a hazard's trembling ground ("The floors of the building and the streets within 30 feet of the building become difficult terrain; creatures on
//   this difficult terrain take a -2 circumstance penalty to attack rolls, AC, and skill checks. The hazard rolls initiative.") → a zone around it,
//   the terrain and penalties;
// - winds as it flies (Tempest Downdrafts: "… fills with lightning-pierced winds until the beginning of the warden's next turn. Creatures must succeed
//   at a … save to take any move action within the winds; …. Creatures who critically fail are blown 30 feet away from the warden, knocked Prone, and
//   take 4d6 electricity damage.") → a zone around it for the round, the save on each move within it;
// - an illusion of a peaceful place (Idyllic Panorama: "This is identical to a 5th-rank Mirage depicting …, except the area is a 200-foot burst. While
//   within the area …, the warden … can cast Mislead and 2nd-rank Silence at will.") → a zone the GM places, the illusion and spells notes;
// - a reaction whose trigger the module can't see, used by the GM as it happens (its trigger on the card): its own ability on the creatures beside it
//   ("Each creature adjacent to the prismhydra is exposed to its chromatic explosion." → that ability's basic save, the damage type the monster's
//   pick); a condition on itself ("It gains the Petrified condition for 1d4 rounds. …", "The carriage is Quickened for 1 round."); its own Constrict
//   on the creature in its jaws ("The holdfast Constricts the creature in its jaws."); a spell sent elsewhere ("… redirects the triggering spell to
//   a new target other than its caster. …"); a table rolled for the caster ("The caster of the triggering spell undergoes a Wellspring Surge.");
// - a creature that targets it, its ability turned aside on a failed Will save ("The triggering creature must attempt a … save. If it fails, the
//   warden redirects the ability to target a different creature in range …; this has no effect if there are no other eligible targets. The
//   triggering creature is then temporarily immune for 24 hours unless it critically failed.") → that save, the redirect the GM's on a failure;
// - a Stride or Swim toward a creature that made a sound (Auditory Hunter) → its card on that creature, the move in words.
function chunk274(item, actor, basicActions) {
    const type = item.system?.actionType?.value;
    const html = String(item.system?.description?.value ?? "");
    const owner = actor ?? item.actor ?? item.parent;
    const ownItems = owner?.items?.contents ?? owner?.items ?? [];
    const ownName = String(owner?.name ?? "").toLowerCase();
    const plain = htmlToPlainText(html.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\[\[\/(?:r|gmr|br) [^\]]*\]\]\{([^}]*)\}/g, "$1").replace(/\[\[\/act ([\w-]+)[^\]]*\]\](?:\{([^}]*)\})?/g, (_all, slug, label) => label ?? slug.replace(/-/g, " ").replace(/^\w/, (letter) => letter.toUpperCase()))).replace(/\s+/g, " ").trim();
    // (Its tags as placeholders: "@T" a template, "@C" a check, "@D" damage.)
    const tagged = plain.replace(/([^.])$/, "$1.").replace(/@Template\[[^\]]*\](?:\{[^}]*\})?/g, "@T").replace(/@Check\[[^\]]*\](?:\{[^}]*\})?/g, "@C").replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g, "@D");
    const actions = Number(item.system?.actions?.value) || 1;
    const check = inlineTags(html, "Check").map(readCheck).find((entry) => entry?.save && entry.dc);
    const template = inlineTags(html, "Template").map(readTemplate).find(Boolean);
    const split = /^(?:Frequency [^.]+?\.? )?Trigger (.+?)[;.]?(?: Requirements? [^.]+?\.?)? Effects? (.+)$/.exec(tagged);
    const sentences = (text) => String(text ?? "").trim().split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean);
    const self = (subject) => !subject || /^(?:it|they)$/i.test(subject) || ownName.includes(subject.toLowerCase().replace(/^the /, "").replace(/^(?:great wyrm|ancient|adult|young|elder) /, ""));
    const auto = (targeting, success, extra = {}) => ({ ...base(item), targeting, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success, failure: none(), criticalFailure: none() } }, ...extra });
    const saveOf = (entry) => ({ kind: "save", check: { roll: "save", statistic: entry.statistic, basic: false, against: { dc: "fixed", value: entry.dc } }, sharedDamage: null });
    const own = (name) => ownItems.find((entry) => entry?.type === "action" && entry !== item && String(entry.name).toLowerCase() === String(name).toLowerCase()) ?? null;
    const compileOwn = (entry) => {
        if (!entry) return null;
        try {
            return compileMonsterAbility(entry, { basicActions, actor: owner });
        } catch {
            return null;
        }
    };
    const zoneOf = (fields) => ({ area: null, centre: "self", range: null, lasts: null, untilReused: false, concealed: false, terrain: [], others: false, hazard: null, saves: [], damage: [], effect: null, modifiers: [], notes: [], ...fields });
    const SIZE_WORDS = { tiny: "tiny", sm: "small", med: "medium", lg: "large", huge: "huge", grg: "gargantuan" };
    // (A reaction the GM uses as its trigger happens: its trigger said first on the card.)
    const pressed = (plan) => plan && {
        ...plan,
        ...(plan.resolution ? { activation: { ...(plan.activation ?? {}), time: type } } : {}),
        trigger: { ...(plan.trigger?.recharge ? { recharge: plan.trigger.recharge } : {}), event: "use", reaction: true, ...(type === "free" ? { free: true } : {}) },
        notes: [`Its trigger, the GM's call: ${split[1].trim().replace(/\.?$/, ".")}`, ...(plan.notes ?? [])]
    };

    if (type === "action") {
        const posture = /^[^.]+?, granting an? \+(\d+) (circumstance|status) bonus to AC (?:to )?adjacent allies\.((?: [^.]+\.)*)$/i.exec(tagged);
        const passengers = /^[^.]+?, enveloping all passengers and giving each passenger an? \+(\d+) (circumstance|status) bonus to AC (until the (?:start|beginning) of [^.]+? next turn)\.$/i.exec(tagged);
        const guard = posture ?? passengers;
        if (guard) {
            const rest = posture ? sentences(posture[3]) : [];
            const until = posture ? /\buntil the (?:start|beginning) of (?:its|their|the [\w' -]+?['’]s) next turn\b/i.exec(posture[3])?.[0] : passengers[3];
            const duration = until ? readDuration(until) : null;
            const adjacent = /\bonly grants the bonus while allies remain adjacent\b/i.test(posture?.[3] ?? "");
            if (!posture || rest.every((sentence) => /\buntil the (?:start|beginning) of (?:its|their) next turn\b/i.test(sentence))) {
                return auto(posture ? { target: null, range: null, area: { type: "emanation", value: 5 }, allies: true } : { target: "allies", range: null, area: null, allies: true }, { ...none(), modifiers: [{ selector: "ac", value: Number(guard[1]), type: guard[2].toLowerCase(), ...(duration ? { duration } : {}) }] }, { notes: posture ? ["Not itself.", ...(adjacent ? ["Only while they stay beside it."] : [])] : ["Only its passengers."] });
            }
        }
        const pit = /^(?:[^.]+\. )?(?:The [\w' -]+?|It|They) creates? an? (\d+)-foot-square, (\d+)-foot-deep pit in [^.]+? within (\d+) feet\.$/i.exec(tagged);
        if (pit) {
            const fall = Math.floor(Number(pit[2]) / 2);
            return { builtin: "zone", actions, zone: zoneOf({ area: { type: "square", value: Number(pit[1]) }, centre: "placed", range: Number(pit[3]), damage: [{ when: "initial", formulas: [`${fall}[bludgeoning]`] }], notes: [`A pit ${pit[2]} feet deep: a creature there as it opens falls (${fall} bludgeoning, landing prone), unless it Grabs an Edge.`] }) };
        }
        const repel = /^[^.]+? gaining resistance (\d+) to damage from (\w+) weapons and \2 effects until the (?:beginning|start) of (?:its|their) next turn\.$/i.exec(tagged);
        if (repel) return { builtin: "self-effect", actions, model: { name: item.name, rounds: 1, modifiers: [], tempHp: 0, resistances: [{ type: repel[2].toLowerCase(), value: Number(repel[1]) }] }, damage: [], strike: null, melee: false, duration: { value: 1, unit: "rounds", expiry: "turn-start" } };
        const colours = /^(?:Frequency [^.]+?\.? Effect )?(?:The [\w' -]+?|It) attunes (?:itself|themselves) to one of (?:five|four|three|two|several) elements, [^(]*\(([^)]+)\)\. (?:It|They) gains? that trait and an? \+(\d+) (circumstance|status) bonus to saving throws against effects with that trait until the (?:beginning|start) of (?:its|their) next turn\.((?: [^.]+\.)*)$/i.exec(tagged);
        const elements = colours ? [...colours[1].matchAll(/\b(\w+) for (\w+)\b/g)].map((match) => ({ colour: match[1], element: match[2].toLowerCase() })) : [];
        // (Live, 2026-10-13: PF2e already holds the choice as the ability's toggle, its +2s waiting on "color-shift:fire" — its own ways then.)
        const toggled = colours && elements.length > 1 ? ownToggle(item) : null;
        if (toggled && elements.every(({ element }) => toggled.modes.some((mode) => mode.plan?.suboption === element))) return { ...toggled, notes: [...(toggled.notes ?? []), ...sentences(colours[4])] };
        if (colours && elements.length > 1) {
            return {
                builtin: "modes",
                actions,
                modes: elements.map(({ colour, element }) => {
                    const name = `${element[0].toUpperCase()}${element.slice(1)}`;
                    return { name, plan: { builtin: "self-effect", actions, model: { name: `${item.name} (${name})`, rounds: 1, modifiers: [{ on: "saving-throw", type: colours[3].toLowerCase(), value: Number(colours[2]), vsTrait: element }], tempHp: 0 }, damage: [], strike: null, melee: false, duration: { value: 1, unit: "rounds", expiry: "turn-start" }, notes: [`It has the ${element} trait (${colour}).`, ...sentences(colours[4])] } };
                })
            };
        }
        const snuff = /^(?:The [\w' -]+?|It|They) extinguish(?:es)? light sources in an? @T\. (.+?) If (?:the [\w' -]+?|it|they) successfully extinguish(?:es)? any light, (?:their|its) next successful ([\w' -]+?) Strike deals @D damage\.$/i.exec(tagged);
        const burn = snuff ? inlineTags(html, "Damage").map(readDamage) : [];
        if (snuff && burn.length === 1 && template) {
            const strikes = snuff[2].split(/\s+or\s+/);
            return { builtin: "self-effect", actions, model: { name: item.name, rounds: null, modifiers: [], tempHp: 0 }, damage: [burn[0]], strike: strikes.length === 1 ? strikes[0].toLowerCase() : null, melee: false, duration: { value: -1, unit: "unlimited", expiry: null }, nextStrike: true, notes: [`Only once it has put out a light within a ${template.value}-foot ${template.type}: ${snuff[1].replace(/\[\[\/r [^\]]*\]\]/g, "").replace(/\s+/g, " ").trim()}`, ...(strikes.length > 1 ? [`Its next ${snuff[2]} Strike that hits.`] : ["Its next Strike that hits."])] };
        }
        const ingest = /^(?:[^.]+\. )?(?:The [\w' -]+?|It) makes an? ([\w' -]+?) Strike\. (If the Strike hits and deals damage, (?:the [\w' -]+?|it) attempts to [^.]+?, using the result of its Strike as a counteract check\.)((?: [^.]+\.)*)$/i.exec(tagged);
        if (ingest) {
            const rest = sentences(ingest[3]).filter((sentence) => !/\bcan(?:'t|not) use [A-Z][\w' -]+? again for\b/i.test(sentence)).map((sentence) => sentence.replace(/@D/g, "10 Hit Points"));
            const heal = inlineTags(html, "Damage").map(readDamage).find((formula) => /healing/i.test(formula));
            return { builtin: "strike-activity", actions, strides: 0, strike: ingest[1].toLowerCase(), attackBonus: 0, damageBonus: 0, offGuard: false, requires: null, oncePerFight: false, onHit: { conditions: [], critical: null, push: null, damage: [], save: null, size: null }, notes: [ingest[2], ...rest.map((sentence) => (heal ? sentence.replace(/10 Hit Points/, `${heal.replace(/\[healing\]/, "")} Hit Points`) : sentence))] };
        }
        const rescue = /^(?:The [\w' -]+?|It) absorbs a willing ([\w' -]+?) within (?:its|their) reach\. (That [\w' -]+? doesn't exist separately until [^.]+\.)$/i.exec(tagged);
        if (rescue) return auto({ target: "1 ally", range: "touch", area: null, allies: true }, { ...none(), noteEffects: [{ label: `Inside the ${String(owner?.name ?? "creature").toLowerCase()}`, text: rescue[2], duration: null }] }, { notes: [`A willing ${rescue[1]} only.`] });
        const words = /^(?:Frequency [^.]+?\.? Effect )?(?:The [\w' -]+?|It) uses ([A-Z][\w' -]+?), ([A-Z][\w' -]+?),? and ([A-Z][\w' -]+?)(?:, though ([^.]+))?\.$/.exec(tagged);
        const wordPlans = words ? [words[1], words[2], words[3]].map((name) => ({ name, plan: compileOwn(own(name)) })) : [];
        if (words && wordPlans.every((way) => way.plan && way.plan.builtin !== "no-effect" && (way.plan.resolution || way.plan.builtin))) return { builtin: "modes", actions, all: true, modes: wordPlans, notes: [words[4] ? `${words[4][0].toUpperCase()}${words[4].slice(1)}.` : "Each in turn."] };
        const twist = basicActions?.disarm ? /^Requirements? (.+?)\.? Effect (?:[^.]+\. )?(?:The [\w' -]+?|It) attempts a single Athletics check to Disarm, comparing the result to the Reflex DC of each creature (?:that was|who was) damaged by the required ([A-Z][\w' -]+?)\. If the result is a critical failure, (?:the [\w' -]+?|it|they) gets? a failure instead\.$/i.exec(tagged) : null;
        if (twist) {
            const disarm = basicActions.disarm;
            return { ...disarm, ...base(item), targeting: { target: `the creatures its ${twist[2]} damaged`, range: null, area: null }, trigger: { event: "use" }, resolution: { ...disarm.resolution, outcomes: { ...disarm.resolution.outcomes, criticalFailure: disarm.resolution.outcomes.failure } }, requires: twist[1], notes: [`One check against each creature its ${twist[2]} damaged.`] };
        }
        const envelop = /^(?:The [\w' -]+?|It) attempts to Grapple a creature within (?:its )?reach\. On a success, the creature is pulled into [^.]+\. (?:The [\w' -]+?|It) is Slowed (\d) while it envelops a creature, and this otherwise has the effects of Swallow Whole \((?:the [\w' -]+?['’]s|its) size or smaller, @D, Rupture (\d+)\)\.$/i.exec(tagged);
        const engulfed = envelop ? inlineTags(html, "Damage").map(readDamage) : [];
        if (envelop && engulfed.length === 1) {
            const size = SIZE_WORDS[owner?.system?.traits?.size?.value] ?? null;
            const swallowed = () => ({ damage: { mode: "formulas", formulas: [{ formula: engulfed[0] }], rollScope: "outcome" }, effects: [{ kind: "swallow", damage: engulfed[0], rupture: Number(envelop[2]), size }] });
            return { ...base(item), targeting: { target: "1 creature", range: "touch", area: null, ...(size ? { size } : {}) }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "skill", statistic: "athletics", against: { dc: "target", statistic: "fortitude" } }, sharedDamage: null, outcomes: { criticalSuccess: swallowed(), success: swallowed(), failure: none(), criticalFailure: none() } }, notes: [`It's Slowed ${envelop[1]} while it holds a creature inside it.`] };
        }
        const mimicry = /^(?:The [\w' -]+?|It) can perfectly imitate [^.]+? by attempting an? @C check against a listener['’]s Will DC\.((?: [^.]+\.)*)$/i.exec(tagged);
        if (mimicry && /@Check\[deception\|against:will\]/i.test(html)) {
            const fooled = { ...none(), manualInstructions: ["{target} takes the imitation for the real thing."] };
            return { ...base(item), targeting: { target: "1 creature", range: null, area: null }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "skill", statistic: "deception", against: { dc: "target", statistic: "will" } }, sharedDamage: null, outcomes: { criticalSuccess: fooled, success: fooled, failure: none(), criticalFailure: none() } }, notes: sentences(mimicry[1]) };
        }
        const trail = /^(?:The [\w' -]+?|It) Strides, leaving behind [^.]+\. (?:The [\w' -]+?|It) chooses to leave behind either ([a-z]+) runes or ([a-z]+) runes\. Every space that (?:the [\w' -]+?|it) moves through(?:, [^.]+?)? gains a rune\. These runes automatically activate when a creature other than (?:the [\w' -]+?|it) enters the space or ends its turn in the space\.((?: [^.]+\.)*)$/i.exec(tagged);
        if (trail) {
            const speed = Number(owner?.system?.attributes?.speed?.value) || 25;
            const ways = [trail[1], trail[2]].map((kind) => {
                const rune = own(`${kind} Rune`);
                if (!rune) return null;
                const plan = compileOwn(rune);
                const words = htmlToPlainText(String(rune.system?.description?.value ?? "").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@Damage\[(\d+d\d+)\[[^\]]*\]\](?:\{[^}]*\})?/g, "$1")).replace(/\s+/g, " ").trim();
                const save = plan?.resolution?.kind === "save" ? { when: ["enter", "end"], plan: { ...plan, targeting: { target: "1 creature", range: null, area: null }, trigger: { event: "zone" } } } : { when: ["enter", "end"], note: words };
                return { name: `${kind[0].toUpperCase()}${kind.slice(1)} runes`, plan: { builtin: "zone", actions, zone: zoneOf({ area: { type: "line", value: speed }, centre: "placed", saves: [save], notes: ["Along the path of its Stride: each space it moved through.", ...sentences(trail[3])] }) } };
            });
            if (ways.every(Boolean)) return { builtin: "modes", actions, modes: ways };
        }
        const harmony = /^(?:Effect )?(?:[^.]+\. )?The next ([\w' -]+?) to Cast a Spell within (\d+) feet of the first [\w' -]+? that used ([A-Z][\w' -]+?) chooses one of the following two benefits, after which (?:the )?[A-Z][\w' -]+? ends\. ([^.]+\.) ([^.]+\.)$/i.exec(tagged);
        if (harmony) {
            const text = `When it next Casts a Spell, it chooses one: ${harmony[4].replace(/\.$/, "")}; or ${harmony[5][0].toLowerCase()}${harmony[5].slice(1)} Then this ends.`;
            return auto({ target: null, range: null, area: { type: "emanation", value: Number(harmony[2]) }, allies: true }, { ...none(), noteEffects: [{ label: harmony[3], text, duration: null }] }, { notes: [`Itself and other ${harmony[1]}s only; the first of them to cast uses it.`] });
        }
        const swim = /^Frequency [^.]+?\.? Effect (?:[^.]+\. )?For (\d+) minutes?, if an ally within (\d+) feet rolls a success on an Athletics check to Swim, (?:they|it) gets? a critical success instead, and if any enemy within \2 feet rolls a failure on an Athletics check to Swim, (?:it|they) gets? a critical failure instead\.((?: [^.]+\.)*)$/i.exec(tagged);
        if (swim) {
            const lasts = { mode: "fixed", value: Number(swim[1]), unit: "minutes", expiry: "turn-start", anchor: "effect-start" };
            const adjustments = [{ allies: true, selector: "athletics", predicate: ["action:swim"], adjustment: { success: "one-degree-better" } }, { allies: false, selector: "athletics", predicate: ["action:swim"], adjustment: { failure: "one-degree-worse" } }];
            const water = inlineTags(html, "Check").map(readCheck).find((entry) => entry?.dc);
            return { builtin: "zone", actions, zone: zoneOf({ area: { type: "emanation", value: Number(swim[2]) }, lasts, adjustments, notes: sentences(swim[3]).map((sentence) => sentence.replace(/\ban? @C check\b/g, water ? `a DC ${water.dc} ${water.statistic[0].toUpperCase()}${water.statistic.slice(1)} check` : "a check")) }) };
        }
        const panorama = /^Frequency [^.]+?\.? Effect (?:The [\w' -]+?|It) creates an area of [^.]+\. This is identical to an? (\d+(?:st|nd|rd|th))-rank ([A-Z][\w' -]+?) depicting ([^,]+?), except the area is an? @T\. (While within the area of [^.]+\.)$/i.exec(tagged);
        if (panorama && template?.type === "burst") return { builtin: "zone", actions, zone: zoneOf({ area: { type: "burst", value: Number(template.value) }, centre: "placed", notes: [`An illusion as a ${panorama[1]}-rank ${panorama[2]}: ${panorama[3]}.`, panorama[4]] }) };
    }

    if (owner?.type === "hazard" && split && ["reaction", "free"].includes(type)) {
        const tremble = /^(?:[^.]+\. )?The floors of the [\w' -]+? and the streets within (\d+) feet of the [\w' -]+? become difficult terrain; creatures on this difficult terrain take an? [-–](\d+) (circumstance|status) penalty to attack rolls, AC, and skill checks\.((?: [^.]+\.)*)$/i.exec(split[2].trim());
        if (tremble) {
            const value = -Number(tremble[2]);
            const kind = tremble[3].toLowerCase();
            return { builtin: "zone", actions: 0, trigger: { event: "hazard" }, zone: zoneOf({ area: { type: "emanation", value: Number(tremble[1]) }, terrain: [{ movement: ["walk"], difficulty: 2 }], modifiers: ["attack-roll", "ac", "skill-check"].map((selector) => ({ selector, value, type: kind })), notes: ["Its own floors too.", ...sentences(tremble[4])] }) };
        }
    }

    if (split && ["reaction", "free"].includes(type)) {
        const effect = split[2].trim();
        const trigger = readReactionTrigger(split[1].trim());
        const winds = type === "free" && check && template?.type === "emanation" ? /^(?:[^.]+\. )?An? @T, centered on (?:the [\w' -]+?|it), fills with [^.]+? until the (?:beginning|start) of (?:the [\w' -]+?['’]s|its) next turn\. Creatures must succeed at an? @C save to take any move action within the [\w' -]+?; ([^.]+)\. Creatures who critically fail are blown (\d+) feet away from (?:the [\w' -]+?|it), knocked Prone, and take @D damage\.$/i.exec(effect) : null;
        const gust = winds ? inlineTags(html, "Damage").map(readDamage) : [];
        if (winds && gust.length === 1) {
            const lose = { ...none(), manualInstructions: ["{target} can't take that move action: undo the move."] };
            const plan = { ...base(item, { time: "1" }), targeting: { target: "1 creature", range: null, area: null }, trigger: { event: "zone" }, resolution: { ...saveOf(check), outcomes: { criticalSuccess: none(), success: none(), failure: lose, criticalFailure: { damage: { mode: "formulas", formulas: [{ formula: gust[0] }], rollScope: "target" }, effects: [{ kind: "condition", slug: "prone", value: null, duration: null }], forcedMovement: { kind: "push", distance: Number(winds[2]), upTo: false, optional: false, direction: "away" }, manualInstructions: ["{target} can't take that move action."] } } }, notes: [`${winds[1][0].toUpperCase()}${winds[1].slice(1)}.`] };
            return { builtin: "zone", actions: 0, trigger: { event: "use", reaction: true, free: true }, zone: zoneOf({ area: { type: "emanation", value: Number(template.value) }, lasts: { mode: "fixed", value: 1, unit: "rounds", expiry: "turn-start", anchor: "effect-start" }, saves: [{ when: ["move"], plan }], notes: [`Its trigger, the GM's call: ${split[1].trim().replace(/\.?$/, ".")}`, `A save for each move action a creature takes within it; ${winds[1]}.`] }) };
        }
        const trickery = trigger?.event === "targeted-by" && check ? /^The triggering creature must attempt an? @C save\. If it fails, (?:the [\w' -]+?|it) redirects the ability to target a different creature in range[^;.]*; this has no effect if there are no other eligible targets\. (The triggering creature is then temporarily immune for [^.]+\.)$/i.exec(effect) : null;
        if (trickery) {
            const turned = { ...none(), manualInstructions: ["{target}'s ability goes to another creature in range of the monster's choice (none there: no effect)."] };
            return { ...base(item), targeting: { target: "the triggering creature", range: null, area: null }, trigger: { ...trigger, reaction: true }, resolution: { ...saveOf(check), outcomes: { criticalSuccess: none(), success: none(), failure: turned, criticalFailure: turned } }, notes: [trickery[1]] };
        }
        const hunter = trigger?.event === "provoke" ? /^(?:The [\w' -]+?|It) (Strides|Swims|Flies|Climbs|Burrows)(?: or (Strides|Swims|Flies|Climbs|Burrows))? (?:toward|towards) the (?:triggering )?creature\.$/i.exec(effect) : null;
        if (hunter) return { ...auto({ target: "the triggering creature", range: null, area: null }, { ...none(), manualInstructions: [`It ${hunter[1]}${hunter[2] ? ` or ${hunter[2]}` : ""} toward {target}.`] }), activation: { time: type, traits: item.system?.traits?.value ?? [] }, trigger };
        if (trigger) return null;
        const exposed = /^(?:[^.]+\. )?Each creature adjacent to (?:the [\w' -]+?|it) is exposed to (?:its|their) ([a-z][\w' -]+?)\.$/i.exec(effect);
        const source = exposed ? ownItems.find((entry) => String(entry?.name ?? "").toLowerCase() === exposed[1].toLowerCase()) : null;
        if (source) {
            const words = String(source.system?.description?.value ?? "");
            const save = inlineTags(words, "Check").map(readCheck).find((entry) => entry?.save && entry.dc && entry.basic);
            const kinds = [...words.matchAll(/@Damage\[(\d+d\d+)\[(\w+)\]\]/g)];
            if (save && kinds.length && new Set(kinds.map((kind) => kind[1])).size === 1) {
                const plan = inlineSave(withDescription(item, `<p>Each creature in a @Template[emanation|distance:5] takes @Damage[${kinds[0][1]}[${kinds[0][2]}]] damage (@Check[${save.statistic}|dc:${save.dc}|basic] save).</p>`), owner);
                if (plan?.resolution) return pressed({ ...plan, resolution: { ...plan.resolution, ...(kinds.length > 1 ? { casterChoice: { kind: "damage-type", label: "Damage type", values: kinds.map((kind) => kind[2].toLowerCase()) } } : {}) }, notes: [...(plan.notes ?? []), `Its damage type as ${source.name} says.`] });
            }
        }
        const condition = /^(?:([^.]+)\. )?(?:(The [\w' -]+?|It) gains the (\w+) condition|(The [\w' -]+?|It) (?:is|becomes) (\w+)) for (\d+d\d+|\d+) rounds?\.((?: [^.]+\.)*)$/i.exec(effect);
        const slug = condition ? (condition[3] ?? condition[5]).toLowerCase() : null;
        if (condition && self(condition[2] ?? condition[4]) && ["petrified", "quickened", "concealed", "invisible"].includes(slug)) {
            const duration = readDuration(`for ${condition[6]} rounds`);
            return pressed(auto({ target: "self", range: null, area: null }, { ...none(), effects: [{ kind: "condition", slug, value: null, duration }] }, { notes: sentences(condition[7]) }));
        }
        const squeeze = /^(?:The [\w' -]+?|It) Constricts the creature(?: in (?:its|their) [\w' -]+?)?\.$/i.exec(effect);
        const constrict = squeeze ? compileOwn(own("Constrict")) : null;
        if (constrict?.resolution) return pressed({ ...constrict, ...base(item), targeting: { ...(constrict.targeting ?? {}), target: "the creature it holds" } });
        const redirect = /^(?:The [\w' -]+?|It) redirects the triggering spell to a new target other than its caster\.((?: [^.]+\.)*)$/i.exec(effect);
        if (redirect) return pressed(auto({ target: "self", range: null, area: null }, { ...none(), manualInstructions: ["Send the triggering spell to a new target of its choice, not its caster.", ...sentences(redirect[1])] }));
        const surge = /^The caster of the triggering spell undergoes an? @UUID\[(Compendium\.pf2e\.rollable-tables\.RollTable\.\w+)\]\{([^}]+)\}\./.exec(htmlToPlainText(html.slice(Math.max(0, html.search(/<strong>\s*Effect\s*<\/strong>/i))).replace(/^<strong>\s*Effect\s*<\/strong>\s*/i, "")).replace(/\s+/g, " ").trim());
        if (surge) return pressed({ builtin: "roll-table", actions: 0, table: { uuid: surge[1], name: surge[2] }, target: "the caster", notes: sentences(effect).slice(1) });
    }
    return null;
}

// Group D, more (2026-10-13, batch 275; the user's call: build the rest). null otherwise:
// - a trench as it burrows ("… Burrows three times. It digs a trench along its path, … The trench is hazardous terrain, and any creature that moves
//   into it takes 4d6 persistent acid damage. While Burrowing, if … would move through a space occupied by another creature, that creature must
//   attempt a … save to avoid falling into the trench and taking the acid damage. The acid remains for 1 minute.") → a line zone the GM places, its
//   burrow Speed three times over: the damage on moving in, the save on those in its path;
// - skin shorn from a held or helpless creature (Share the Skin: an Athletics check against Fortitude DC if it's grabbed, automatic otherwise; Clumsy 1
//   for 1 minute on it, 10 temporary Hit Points for 1 minute on itself);
// - 1 HP instead of 0, once, and a scramble (Shuddering Skitter) → Ferocity's kin without wounded, the rest a note;
// - a save or a spell's effects ("A target creature within 30 feet must succeed at a … save or gain the effects of Cursed Metamorphosis …") → the spell
//   cast at that DC;
// - a gaze that suffers a spell ("When a ghaele fixes its gaze upon a non-good creature, the creature suffers the effects of Divine Decree (… save).")
//   → the spell cast at that DC;
// - foresight against one creature ("The creature attempts a … save. On a failed save, Kuworsys … gaining a +2 circumstance bonus to attack rolls
//   and AC against the target creature for 1 minute.") → on a failure, those bonuses on itself against that creature only (PF2e's mark);
// - a single Grapple against each creature it holds or its last Strike damaged (Coordinated Subdual);
// - an icy prison (Curse of the Saumen Kar: "… must attempt a … save. A creature that fails becomes trapped inside the prison. If it succeeds, the
//   creature is pushed outside the prison into a space of its choice. …") → Immobilized on a failure, the prison's numbers a note;
// - any common spell of a rank or lower (Endless Spellscales) → a cast card where the GM names the spell;
// - a kite's line handed to an ally (Attach Line) → a note Effect on it;
// - a spell and a grab at once (Crew's Call: "This is a Wails of the Damned spell in a 100-foot emanation …. In addition, any creature within 5 feet
//   of the ship is automatically Grabbed by the crew.") → each in turn;
// - a "naughty" mark (Punish the Naughty) → Hunt Prey's kin, its benefits a note;
// - a healing arrival (Ancestral Response: "… appears … within 30 feet of the triggering creature and heals 8d8 Hit Points on all allies that can see
//   him within 60 feet. Allies healed this way gain a +2 circumstance bonus on saving throws for 1 minute. …") → that healing and PF2e's effect on
//   its allies around it, the GM's to use as it's called;
// - fortune or misfortune in a cone (Fog of Chance) → two ways: PF2e's effect on each creature there, or a Will save and the effect on a failure;
// - its own ability with more on a failed save (Pain Points: "The novitiates use a 1-action Flurry of Vengeance. Each creature that fails its Reflex
//   save is also Clumsy 1 for 1 round …") → that ability, Clumsy 1 on a failure;
// - a Disarm and a spell after a hit (Raking Sand) → each in turn;
// - off-guard turned around (Outsmart: "… isn't treated as off-guard to the attack, and the triggering creature is off-guard to the next attack made
//   before the end of …'s next turn.") → off-guard on the attacker to its next attack, the rest a note;
// - reactions the GM uses as they happen, their effect in words: a teleport's destination chosen (Redirect), vitality damage passed to an undead ally
//   (Vitality Transfer), a flat check to end persistent damage (Vigorous Shake), counteracting what hinders its blade (Free Blade).
function chunk275(item, actor, basicActions) {
    const type = item.system?.actionType?.value;
    const html = String(item.system?.description?.value ?? "");
    const owner = actor ?? item.actor ?? item.parent;
    const ownItems = owner?.items?.contents ?? owner?.items ?? [];
    const plain = htmlToPlainText(html.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\[\[\/(?:r|gmr|br) [^\]]*\]\]\{([^}]*)\}/g, "$1").replace(/\[\[\/act ([\w-]+)[^\]]*\]\](?:\{([^}]*)\})?/g, (_all, slug, label) => label ?? slug.replace(/-/g, " ").replace(/^\w/, (letter) => letter.toUpperCase()))).replace(/\s+/g, " ").trim();
    const tagged = plain.replace(/([^.])$/, "$1.").replace(/@Template\[[^\]]*\](?:\{[^}]*\})?/g, "@T").replace(/@Check\[[^\]]*\](?:\{[^}]*\})?/g, "@C").replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g, "@D");
    const actions = Number(item.system?.actions?.value) || 1;
    const check = inlineTags(html, "Check").map(readCheck).find((entry) => entry?.save && entry.dc);
    const template = inlineTags(html, "Template").map(readTemplate).find(Boolean);
    const damage = inlineTags(html, "Damage").map(readDamage);
    const split = /^(?:Frequency [^.]+?\.? )?Trigger (.+?)[;.]?(?: Requirements? [^.]+?\.?)? Effects? (.+)$/.exec(tagged);
    const sentences = (text) => String(text ?? "").trim().split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean);
    const auto = (targeting, success, extra = {}) => ({ ...base(item), targeting, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success, failure: none(), criticalFailure: none() } }, ...extra });
    const saveOf = (entry) => ({ kind: "save", check: { roll: "save", statistic: entry.statistic, basic: false, against: { dc: "fixed", value: entry.dc } }, sharedDamage: null });
    const own = (name) => ownItems.find((entry) => entry?.type === "action" && entry !== item && String(entry.name).toLowerCase() === String(name).toLowerCase()) ?? null;
    const compileOwn = (entry) => {
        if (!entry) return null;
        try {
            return compileMonsterAbility(entry, { basicActions, actor: owner });
        } catch {
            return null;
        }
    };
    const pressed = (plan) => plan && { ...plan, ...(plan.resolution ? { activation: { ...(plan.activation ?? {}), time: type } } : {}), trigger: { event: "use", reaction: true, ...(type === "free" ? { free: true } : {}) }, notes: [`Its trigger, the GM's call: ${split[1].trim().replace(/\.?$/, ".")}`, ...(plan.notes ?? [])] };
    const minute = { mode: "fixed", value: 1, unit: "minutes", expiry: "turn-start", anchor: "effect-start" };
    const spellOf = (raw) => /@UUID\[(Compendium\.pf2e\.spells-srd\.Item\.\w{16})\]\{([^}]+)\}/.exec(raw);
    const cast = (link, dc, notes) => ({ builtin: "cast-spell", source: { name: item.name, uuid: item.uuid ?? null, slug: item.system?.slug ?? null }, spell: { uuid: link[1], name: link[2] }, rank: null, dc, attack: null, tradition: null, self: false, notes });

    if (type === "action") {
        const trench = damage.length === 1 && check ? /^(?:The )?[\w' -]+? Burrows (twice|three times|four times)\. (?:It|They) digs? a trench along (?:its|their) path, [^.]+\. The trench is hazardous terrain, and any creature that moves into it takes @D damage\. While Burrowing, if [\w' -]+? would move through a space occupied by another creature, that creature must attempt an? @C save to avoid falling into the trench and taking the acid damage\. The acid remains for (\d+) minutes?\.$/i.exec(tagged) : null;
        const burrow = Number((owner?.system?.attributes?.speed?.otherSpeeds ?? []).find((entry) => entry?.type === "burrow")?.value) || null;
        if (trench && burrow) {
            const times = { twice: 2, "three times": 3, "four times": 4 }[trench[1].toLowerCase()];
            const fall = { ...base(item), targeting: { target: "1 creature", range: null, area: null }, trigger: { event: "zone" }, resolution: { ...saveOf(check), outcomes: { criticalSuccess: none(), success: none(), failure: { damage: { mode: "formulas", formulas: [{ formula: damage[0] }], rollScope: "target" }, effects: [] }, criticalFailure: { damage: { mode: "formulas", formulas: [{ formula: damage[0] }], rollScope: "target" }, effects: [] } } } };
            return { builtin: "zone", actions, zone: { area: { type: "line", value: burrow * times }, centre: "placed", range: null, lasts: { mode: "fixed", value: Number(trench[2]), unit: "minutes", expiry: "turn-start", anchor: "effect-start" }, untilReused: false, concealed: false, terrain: [], others: true, hazard: { formulas: [damage[0]] }, saves: [{ when: ["initial"], plan: fall }], damage: [], effect: null, modifiers: [], notes: ["Along its path as it burrows; the creatures it passes under save or fall in."] } };
        }
        const skin = /^Requirements? (.+?)\.? Effect [^.]+\. This requires an? @C check against the victim['’]s Fortitude DC if the victim is grabbed and is automatic for any of the other conditions\. The massive pain causes the victim to become Clumsy (\d) for 1 minute, and (?:the [\w' -]+?|it) drapes itself in [^,]+, granting it (\d+) temporary Hit Points for 1 minute\.$/i.exec(tagged);
        if (skin && /@Check\[athletics\|defense:fortitude\]/i.test(html)) {
            const shorn = { ...none(), effects: [{ kind: "condition", slug: "clumsy", value: Number(skin[2]), duration: minute }, { kind: "temp-hp", formula: skin[3], recipient: "self", duration: minute }] };
            return { ...base(item), targeting: { target: "1 creature", range: "touch", area: null }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "skill", statistic: "athletics", against: { dc: "target", statistic: "fortitude" } }, sharedDamage: null, outcomes: { criticalSuccess: shorn, success: shorn, failure: none(), criticalFailure: none() } }, requires: skin[1], notes: ["No check against a creature paralyzed, restrained, unconscious or willing: treat it as a success."] };
        }
        const pig = check ? /^(?:Frequency [^.]+?\.? Effect )?An? (?:target )?creature within (\d+) feet must succeed at an? @C save or gain the effects of ([A-Z][\w' -]+?)(, [^.]+)?\.((?: [^.]+\.)*)$/i.exec(tagged) : null;
        const pigSpell = pig ? spellOf(html) : null;
        if (pigSpell) return { ...cast(pigSpell, check.dc, [`Only on a failed save (DC ${check.dc} ${check.statistic[0].toUpperCase()}${check.statistic.slice(1)}): the spell's effects as a failure.`, ...(pig[3] ? [`${pig[2]}${pig[3]}.`] : []), ...sentences(pig[4])]) };
        const gaze = /^<p>When (?:an?|the) ([\w' -]+?) fixes its gaze upon (an? [^,]+?), the creature suffers the effects of /i.exec(html.trim());
        if (gaze) {
            const plan = castSpell(withDescription(item, html.trim().replace(gaze[0], `<p>The ${gaze[1]} fixes its gaze upon ${gaze[2]}, which suffers the effects of `)), owner);
            if (plan) return { ...plan, notes: [`Only ${gaze[2]}.`, ...(plan.notes ?? [])] };
        }
        const gauge = check ? /^[^.]+\. The creature attempts an? @C save\. On a failed save, (?:the [\w' -]+?|it|[A-Z][\w'-]+) [^,]+, gaining an? \+(\d+) (circumstance|status) bonus to attack rolls and AC against the target creature for (\d+) minutes?\.$/i.exec(tagged) : null;
        if (gauge) {
            const duration = { ...minute, value: Number(gauge[3]) };
            const read = { ...none(), modifiers: ["attack", "ac"].map((selector) => ({ selector, value: Number(gauge[1]), type: gauge[2].toLowerCase(), recipient: "self", against: "target", duration })) };
            return { ...base(item), targeting: { target: "1 creature", range: null, area: null }, trigger: { event: "use" }, resolution: { ...saveOf(check), outcomes: { criticalSuccess: none(), success: none(), failure: read, criticalFailure: read } } };
        }
        const subdual = basicActions?.grapple ? /^Requirements? (.+?)\.? Effect (?:The [\w' -]+?|It) attempts? a single Athletics check to Grapple, comparing the result to the Fortitude DC of each creature that (?:they|it) currently ha(?:ve|s) Grabbed or Restrained or was damaged by the required ([A-Z][\w' -]+?)\. It can target up to a maximum number of creatures equal to double the troop['’]s current number of segments\.$/i.exec(tagged) : null;
        if (subdual) {
            const grapple = basicActions.grapple;
            return { ...grapple, ...base(item), targeting: { target: `the creatures it holds or its ${subdual[2]} damaged`, range: null, area: null }, trigger: { event: "use" }, requires: subdual[1], notes: ["One check against each of them, up to twice its segments (eight when whole)."] };
        }
        const prison = check ? /^(?:Frequency [^.]+?\.? Effect )?[^.]+? create an icy prison around an? (?:(Tiny|Small|Medium|Large|Huge|Gargantuan) or smaller )?creature (?:he|she|it|they) can see within (\d+) feet\. [^.]+\. The target, and any creatures sharing its space, must attempt an? @C save\. A creature that fails becomes trapped inside the prison\. If it succeeds, the creature is pushed outside the prison into a space of its choice\.((?: [^.]+\.)*)$/i.exec(tagged) : null;
        if (prison) {
            const trapped = { ...none(), effects: [{ kind: "condition", slug: "immobilized", value: null, duration: null }], manualInstructions: ["{target} is trapped in the prison until it's destroyed."] };
            const outside = { ...none(), manualInstructions: ["{target} is pushed out of the prison to a space of its choice."] };
            return { ...base(item), targeting: { target: "1 creature", range: `${prison[2]} feet`, area: null, ...(prison[1] ? { size: prison[1].toLowerCase() } : {}) }, trigger: { event: "use" }, resolution: { ...saveOf(check), outcomes: { criticalSuccess: outside, success: outside, failure: trapped, criticalFailure: trapped } }, notes: ["Creatures sharing its space save too.", ...sentences(prison[3])] };
        }
        const scales = /^(?:1 to 3 )?(?:The [\w' -]+?|It) expends a spell [^,]+, casting a (common|uncommon) spell of (\d+)(?:st|nd|rd|th) rank or lower from any tradition, using the spell['’]s typical number of actions and (?:their|its) spell DC\.$/i.exec(tagged);
        if (scales) return { builtin: "cast-spell", source: { name: item.name, uuid: item.uuid ?? null, slug: item.system?.slug ?? null }, spell: null, pick: { maxRank: Number(scales[2]), rarity: scales[1].toLowerCase() }, rank: null, dc: null, attack: null, tradition: null, self: false, notes: [`Any ${scales[1].toLowerCase()} spell of rank ${scales[2]} or lower, from any tradition: the GM names it.`] };
        const kite = /^(?:The [\w' -]+?|It) gives its line to an adjacent ally with a free hand\. ((?:[^.]+\.)(?: [^.]+\.)*)$/i.exec(tagged);
        if (kite) return auto({ target: "1 ally", range: "touch", area: null, allies: true }, { ...none(), noteEffects: [{ label: `Holding the ${String(owner?.name ?? "kite").toLowerCase()}'s line`, text: kite[1], duration: null }] });
        const naughty = /^Requirements? (.+?)\.? (?:Effect )?(?:The [\w' -]+?|It|[A-Z][\w'-]+) designates a single target (?:he|she|it|they) can see as ["“]([\w' -]+)["”]\.? ((?:[^.]+\.)(?: [^.]+\.)*)$/i.exec(tagged);
        if (naughty) return { builtin: "hunt-prey", edge: null, mark: true, notes: sentences(naughty[3]).map((sentence) => sentence.replace(/\bthe [\w' -]+? target\b/gi, "its mark")), requires: naughty[1] };
        const fog = check && template?.type === "cone" ? /^[^.]+\. (?:The [\w' -]+?|It) chooses fortune or misfortune when using this ability, which gains the corresponding trait\. If (?:the [\w' -]+?|it) chooses fortune, all creatures in the mist [^;]+; the first time in the next round each affected creature attempts an attack roll or skill check, they roll twice and use the better result\. If (?:the [\w' -]+?|it) chooses misfortune, each creature in the mist must attempt an? @C save\. On a failure, the first time in the next round that creature attempts an attack roll or skill check, it must roll twice and use the worse result\./i.exec(tagged) : null;
        const fogEffect = fog ? /@UUID\[(Compendium\.pf2e\.bestiary-effects\.Item\.\w+)\]\{(?:Effect: )?([^}]+)\}/.exec(html) : null;
        if (fogEffect) {
            const area = { target: null, range: null, area: { type: "cone", value: Number(template.value) } };
            const lucky = { ...none(), nativeEffects: [{ uuid: fogEffect[1], label: fogEffect[2] }] };
            const fortune = auto(area, lucky, { notes: ["PF2e's effect asks which: fortune."] });
            const misfortune = { ...base(item), targeting: area, trigger: { event: "use" }, resolution: { ...saveOf(check), outcomes: { criticalSuccess: none(), success: none(), failure: lucky, criticalFailure: lucky } }, notes: ["PF2e's effect asks which: misfortune."] };
            return { builtin: "modes", actions, modes: [{ name: "Fortune", plan: fortune }, { name: "Misfortune", plan: misfortune }] };
        }
        const pain = /^(?:Frequency [^.]+?\.? Effect )?(?:[^.]+\. )?(?:The [\w' -]+?|It) uses? an? (\d)-action ([A-Z][\w' -]+?)\. Each creature that fails its (Fortitude|Reflex|Will) save is also (\w+) (\d) for (\d+) rounds?(?: [^.]+)?\.$/i.exec(tagged);
        const painPlan = pain ? compileOwn(own(pain[2])) : null;
        if (painPlan?.resolution?.kind === "save") {
            const rider = { kind: "condition", slug: pain[4].toLowerCase(), value: Number(pain[5]), duration: { mode: "fixed", value: Number(pain[6]), unit: "rounds", expiry: "turn-start", anchor: "effect-start" } };
            const outcomes = Object.fromEntries(Object.entries(painPlan.resolution.outcomes).map(([degree, row]) => [degree, ["failure", "criticalFailure"].includes(degree) ? { ...row, effects: [...(row.effects ?? []), { ...rider }] } : row]));
            return { ...painPlan, ...base(item), resolution: { ...painPlan.resolution, outcomes }, notes: [...(painPlan.notes ?? []), `Its ${pain[1]}-action ${pain[2]}.`] };
        }
        const raking = basicActions?.disarm ? /^Requirements? (.+?)\.? Effect (?:The [\w' -]+?|It) attempts to Disarm (one [^.]+?) from the [\w' -]+? creature and casts its innate ([A-Z][\w' -]+?) on the target creature\.$/i.exec(tagged) : null;
        const tether = raking ? spellOf(html) : null;
        if (tether) return { builtin: "modes", actions, all: true, requires: raking[1], modes: [{ name: "Disarm", plan: { ...basicActions.disarm, ...base(item), targeting: { target: "1 creature", range: "touch", area: null }, trigger: { event: "use" }, notes: [`Only ${raking[2]}.`] } }, { name: tether[2], plan: cast(tether, null, ["Its innate spell, on the same creature."]) }], notes: ["Both, on the creature it hit or holds."] };
    }

    if (split && ["reaction", "free"].includes(type)) {
        const effect = split[2].trim();
        const response = /^(?:[^.]+? )?(?:instantaneously )?appears in an unoccupied space within (\d+) feet of the triggering creature and heals @D Hit Points on all allies that can see (?:him|her|it|them) within (\d+) feet\. (Allies healed this way gain an? \+\d+ [^.]+\.)((?: [^.]+\.)*)$/i.exec(effect);
        const responseEffect = response ? /@UUID\[(Compendium\.pf2e\.bestiary-effects\.Item\.\w+)\]\{(?:Effect: )?([^}]+)\}/.exec(html) : null;
        const healing = damage.find((formula) => /healing/i.test(formula));
        if (response && healing) {
            const healed = { ...none(), effects: [{ kind: "heal", formula: healing.replace(/\[healing\]$/, "") }], ...(responseEffect ? { nativeEffects: [{ uuid: responseEffect[1], label: responseEffect[2] }] } : {}) };
            return pressed(auto({ target: null, range: null, area: { type: "emanation", value: Number(response[2]) }, allies: true }, healed, { notes: [`It appears within ${response[1]} feet of the creature that called.`, "Only allies that can see it.", ...sentences(response[4]).filter((sentence) => !/^@UUID/.test(sentence))] }));
        }
        const scramble = /^(?:[^.]+\. )?(?:The [\w' -]+?|It) is reduced to 1 HP(?: instead)?, (.+)$/i.exec(effect);
        if (scramble && readReactionTrigger(split[1].trim())?.event === "death") return { builtin: "ferocity", hp: 1, wounded: false, ...(/^Frequency once per (?:day|hour|10 minutes)\b/i.test(tagged) ? { uses: 1 } : {}), note: `It ${scramble[1].replace(/\.$/, "")}.` };
        const outsmart = /^(?:[^.]+\. )?(?:The [\w' -]+?|It) isn['’]t treated as off-guard to the attack, and the triggering creature is off-guard to the next attack made before the end of (?:the [\w' -]+?['’]s|its) next turn\.$/i.exec(effect);
        const trigger = readReactionTrigger(split[1].trim());
        if (outsmart) {
            const turned = { ...none(), effects: [{ kind: "condition", slug: "off-guard", value: null, duration: { mode: "fixed", value: 1, unit: "rounds", expiry: "turn-end", anchor: "source-turn" }, scope: { against: "actor", attacks: "any", uses: 1 } }], manualInstructions: ["It isn't off-guard to {target}'s attack."] };
            const offGuard = /\bwhile (?:the [\w' -]+?|it) is Off-Guard\b/i.test(split[1]);
            return { ...auto({ target: "the triggering creature", range: null, area: null }, turned), activation: { time: type, traits: item.system?.traits?.value ?? [] }, trigger: trigger && trigger.event !== "use" ? trigger : { event: "attacked", reaction: true, melee: false }, ...(offGuard ? { requires: "It is off-guard" } : {}) };
        }
        const manual = [
            [/^(?:The [\w' -]+?|It) determines the destination of the spell or effect\.((?: [^.]+\.)*)$/i, (match) => ["Choose where {target}'s teleport ends.", ...sentences(match[1])], "the triggering creature"],
            [/^(?:The [\w' -]+?|It) transfers all vitality damage from the effect to a single undead creature of (?:their|its) choice within (\d+) feet that (?:they|it) controls? or that['’]s Friendly or Helpful to (?:them|it)\.$/i, (match) => [`It takes none of that vitality damage: an undead ally within ${match[1]} feet takes it instead.`], "self"],
            [/^(?:[^.]+\. )?(?:The [\w' -]+?|It) immediately attempts an? @C check to end the persistent damage that triggered this reaction\. If (?:the [\w' -]+?|it) succeeds at this check, (?:it|they) can immediately use ([A-Z][\w' -]+?) as part of this reaction\.$/i, (match) => {
                const flat = inlineTags(html, "Check").map(readCheck).find((entry) => entry?.statistic === "flat" && entry.dc);
                return [`Roll a DC ${flat?.dc ?? 15} flat check: on a success, that persistent damage ends and it can use ${match[1]} at once.`];
            }, "self"],
            [/^(?:[^.]+\. )?(?:The [\w' -]+?|It) attempts to counteract each effect that prevents it from making an? ([\w' -]+?) Strike, gives it a penalty to its \1 Strike, or prevents it from acting\.((?: [^.]+\.)*)$/i, (match) => [`Counteract each effect that stops it acting or hinders its ${match[1]} Strikes.`, ...sentences(match[2])], "self"]
        ];
        for (const [pattern, lines, target] of manual) {
            const match = pattern.exec(effect);
            if (match) return pressed(auto({ target, range: null, area: null }, { ...none(), manualInstructions: lines(match) }));
        }
    }
    return null;
}

// Group D, more (2026-10-13, batch 276; the user's call: build the rest). null otherwise:
// - one of several listed effects, each with its own save ("… has one of the effects below. A creature that succeeds at a Will save is unaffected. …"
//   then "Fear (fear, incapacitation) … Each creature within a 30-foot emanation becomes Frightened 1 (or, on a critical failure, Frightened 2 and Fleeing
//   …)", "Nausea …", "Stupor … a single creature within 30 feet …") → a way for each: its save, its conditions on a failure (more on a critical one);
// - a PF2e toggle the ability switches ("… extends or retracts six thin, sticky tendrils …", its RollOption) → two ways, on and off;
// - a rage PF2e holds as the ability's toggle ("… enters a state of pure rage that lasts either for 1 minute …", its AC and damage waiting on it) → an
//   effect on itself that turns the toggle on for that time, the rest notes;
// - mud where it lies ("… causes stone and earth under its body to grow soft and muddy, remaining so for 1 minute after the mouther moves off …") → a
//   zone at its space for the minute, difficult terrain for the others;
// - moving every creature it holds ("… attempts to move all creatures that it has Grabbed into other spaces within the reach of its tentacles, rolling
//   a single Athletics check …. On a failure, the creature remains in place, and on a critical failure, the creature is no longer grabbed.");
// - a Disarm at its Strike's modifier ("… attempts to Disarm a metal item a creature is holding using its antenna (with the same modifier as an antenna
//   Strike). On a success, the item is subject to the rust monster's rust ability …") → Disarm at that modifier, the rest notes;
// - a whirlwind form (its PF2e effect on itself) and what it does to creatures it moves through (damage, a Reflex save or held in it) → each in turn;
// - a cage that grapples from afar ("… at a range of up to 30 feet, attempting an Athletics check to Grapple against the target's Fortitude DC …, a
//   successful attempt lasts until the creature Escapes …") → Grapple at that range, Escape DC a note;
// - several of its own spells at once ("… casts up to three spells chosen from its at-will innate spells and its emotional focus spells.") → three
//   cast cards in turn, each a spell the GM names;
// - an emotion ended on a creature that failed its save against its spells (Spiral of Despair) → the GM's on that creature;
// - praise for an ally ("… attempts to counteract one emotion effect on the ally (with a counteract modifier of +24), and the archon and the ally both
//   gain a +1 status bonus to attack rolls and saving throws for 1 round.") → the bonuses on both, the counteracting a note;
// - a spell attack that rusts an item (Rusting Grasp) → the attack at its modifier, the item's damage the GM's;
// - counteracting a spell with a skill check (Menace to Magic) → its card at the caster, the check the GM's;
// - its own ability at one creature, one degree worse (Blinding Beams: "… fires its Holy Beam at only the creature it hit twice. The creature's save
//   result is one degree of success worse …") → that ability's save, each result moved down;
// - hidden in dim light after a move (Shadow Blend) → Hidden on itself, its conditions notes;
// - a held creature pulled into an attack's path (Yank: "… attempts an Athletics check, including its bonus to Grapple. If it succeeds against the
//   grabbed or restrained creature's Fortitude DC, the choker redirects the attack to that creature …") → that check, the redirect the GM's;
// - a dancing weapon after a hit (Animate Weapon) → a note Effect on itself for the minute;
// - resistance lost to a curse (Lightning-Struck Curse) → its Will save, a note Effect on a failure;
// - venom made worse (Enhance Venom: "The creature takes an additional 2d8 poison damage even if it succeeds at its save.") → that damage;
// - merging into an ally (Amalgam) → healing on it, its toggle and the rest the GM's;
// - a summoning cast (Ritual Gate: "… casts summon fey with only a verbal component …") → the spell's cast card;
// - reactions the GM uses as they happen: an electrical boost to another lizard (Amplify Voltage), a copied auditory bonus (Hostile Duet), a
//   swallowed creature in a pod (Pod Prison), a wormhole where a creature teleported from (Dimensional Wormhole, a zone), a grabbed creature
//   carried on the wind (Ride the Wind: its Will save), a grab on a creature moving near it (Grasping Tendrils).
function chunk276(item, actor, basicActions) {
    const type = item.system?.actionType?.value;
    const html = String(item.system?.description?.value ?? "");
    const owner = actor ?? item.actor ?? item.parent;
    const ownItems = owner?.items?.contents ?? owner?.items ?? [];
    const plain = htmlToPlainText(html.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\[\[\/(?:r|gmr|br) [^\]]*\]\]\{([^}]*)\}/g, "$1").replace(/\[\[\/(?:r|gmr|br) \{?([^\]#}]+?)\}?(?: ?#[^\]]*)?\]\](?!\{)/g, "$1").replace(/\[\[\/act ([\w-]+)[^\]]*\]\](?:\{([^}]*)\})?/g, (_all, slug, label) => label ?? slug.replace(/-/g, " ").replace(/^\w/, (letter) => letter.toUpperCase()))).replace(/\s+/g, " ").trim();
    const tagged = plain.replace(/([^.])$/, "$1.").replace(/@Template\[[^\]]*\](?:\{[^}]*\})?/g, "@T").replace(/@Check\[[^\]]*\](?:\{[^}]*\})?/g, "@C").replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g, "@D");
    const actions = Number(item.system?.actions?.value) || 1;
    const check = inlineTags(html, "Check").map(readCheck).find((entry) => entry?.save && entry.dc);
    const damage = inlineTags(html, "Damage").map(readDamage);
    const split = /^(?:Frequency [^.]+?\.? )?Trigger (.+?)[;.]?(?: Requirements? [^.]+?\.?)? Effects? (.+)$/.exec(tagged);
    // (Its placeholders written out again where they fall in the text: "a @C save" → "a DC 32 Reflex save", "@D" → its dice.)
    const allChecks = inlineTags(html, "Check").map(readCheck);
    const wordedAt = (fragment) => {
        const text = String(fragment ?? "");
        const at = tagged.indexOf(text);
        if (at < 0 || !/@[CD]\b/.test(text)) return text;
        let check = (tagged.slice(0, at).match(/@C\b/g) ?? []).length;
        let roll = (tagged.slice(0, at).match(/@D\b/g) ?? []).length;
        return text.replace(/@C\b/g, () => {
            const entry = allChecks[check++];
            return entry?.dc ? `DC ${entry.dc} ${entry.statistic[0].toUpperCase()}${entry.statistic.slice(1)}` : "a";
        }).replace(/@D\b/g, () => String(damage[roll++] ?? "its").replace(/\[(\w+)\]/g, " $1").replace(/,/g, " plus "));
    };
    const sentences = (text) => wordedAt(String(text ?? "").trim()).split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean);
    const auto = (targeting, success, extra = {}) => ({ ...base(item), targeting, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success, failure: none(), criticalFailure: none() } }, ...extra });
    const saveOf = (entry) => ({ kind: "save", check: { roll: "save", statistic: entry.statistic, basic: false, against: { dc: "fixed", value: entry.dc } }, sharedDamage: null });
    const own = (name) => ownItems.find((entry) => entry?.type === "action" && entry !== item && String(entry.name).toLowerCase() === String(name).toLowerCase()) ?? null;
    const compileOwn = (entry) => {
        if (!entry) return null;
        try {
            return compileMonsterAbility(entry, { basicActions, actor: owner });
        } catch {
            return null;
        }
    };
    const pressed = (plan) => plan && { ...plan, ...(plan.resolution ? { activation: { ...(plan.activation ?? {}), time: type } } : {}), trigger: { event: "use", reaction: true, ...(type === "free" ? { free: true } : {}) }, notes: [`Its trigger, the GM's call: ${split[1].trim().replace(/\.?$/, ".")}`, ...(plan.notes ?? [])] };
    const toggles = (item.system?.rules ?? []).filter((rule) => rule?.key === "RollOption" && rule.toggleable && rule.option && !rule.suboptions?.length);
    const round = { mode: "fixed", value: 1, unit: "rounds", expiry: "turn-start", anchor: "effect-start" };
    const held = (slug) => ({ ...none(), effects: [{ kind: "condition", slug, value: null, duration: null }] });

    if (type === "action") {
        // (Ways listed as items, each with its check: "<li><strong>Fear</strong> (fear, incapacitation) @Check[…] Each creature within a … becomes …".)
        const lead = /^(?:<p>)?([^<]*?\bhas one of the effects below\.[^<]*)(?:<\/p>)?\s*<ul>([\s\S]*)<\/ul>\s*$/i.exec(html.trim());
        if (lead) {
            const ways = [...lead[2].matchAll(/<li>\s*<strong>([^<]+)<\/strong>\s*(?:\([^)]*\)\s*)?(@Check\[[^\]]*\])\s*([\s\S]*?)<\/li>/gi)].map(([, name, raw, words]) => {
                const entry = readCheck(raw.slice(7, -1));
                const area = inlineTags(words, "Template").map(readTemplate).find(Boolean);
                const single = /\btargets a single creature within (\d+) feet\b/i.exec(htmlToPlainText(words));
                const worse = /\s*\(or, on a critical failure, ([\s\S]+?)\)(?=\.\s*$)/i.exec(words);
                const main = readConditions(words.replace(worse?.[0] ?? "", "").replace(/@Template\[[^\]]*\](?:\{[^}]*\})?/g, "area"));
                const critical = worse ? readConditions(`${worse[1]}.`) : main;
                if (!entry?.dc || !entry.save || !main.length || (!area && !single)) return null;
                return { name: name.trim(), plan: { ...base(item), targeting: area ? { target: null, range: null, area: { type: area.type, value: Number(area.value) } } : { target: "1 creature", range: `${single[1]} feet`, area: null }, trigger: { event: "use", immunity: readImmunity(lead[1]) }, resolution: { ...saveOf(entry), outcomes: { criticalSuccess: none(), success: none(), failure: { ...none(), effects: main }, criticalFailure: { ...none(), effects: critical } } } } };
            });
            if (ways.length > 1 && ways.every(Boolean)) return { builtin: "modes", actions, modes: ways, notes: sentences(htmlToPlainText(lead[1])).filter((sentence) => !/\bsucceeds at an? \w+ save is unaffected\b/i.test(sentence)) };
        }
        const strands = toggles.length === 1 ? /^(?:The [\w' -]+?|It) extends or retracts ([^.]+?)\.((?: [^.]+\.)*)$/i.exec(tagged) : null;
        if (strands) return { builtin: "modes", actions, modes: [{ name: "Extend", plan: { builtin: "roll-option", option: toggles[0].option, value: true, label: "extended" } }, { name: "Retract", plan: { builtin: "roll-option", option: toggles[0].option, value: false, label: "retracted" } }], notes: sentences(strands[2]) };
        const rage = toggles.length === 1 ? /^(?:The [\w' -]+?|It) enters a state of [^.]*?rage that lasts either for (\d+) minutes?, [^.]+\.((?: [^.]+\.)*)$/i.exec(tagged) : null;
        if (rage) return { builtin: "self-effect", actions, model: { name: item.name, rounds: 10 * Number(rage[1]), modifiers: [], tempHp: 0, toggle: true }, damage: [], strike: null, melee: false, duration: { value: Number(rage[1]), unit: "minutes", expiry: null }, notes: sentences(rage[2]).filter((sentence) => !/\b(?:has AC \d+|Strike deals \d+d\d+)/.test(sentence)) };
        const mud = /^(?:The [\w' -]+?|It) causes stone and earth under its body to grow soft and muddy, remaining so for (\d+) minutes? after (?:the [\w' -]+?|it) moves off the location\. ((?:[^.]+\.)(?: [^.]+\.)*)$/i.exec(tagged);
        if (mud) return { builtin: "zone", actions, zone: { area: { type: "burst", value: 5 }, centre: "self", range: null, lasts: { mode: "fixed", value: Number(mud[1]), unit: "minutes", expiry: "turn-start", anchor: "effect-start" }, untilReused: false, concealed: false, terrain: [{ movement: ["walk"], difficulty: 2 }], others: true, hazard: null, saves: [], damage: [], effect: null, modifiers: [], notes: ["Where it lies; use it again as it moves on (each place stays a minute after it leaves)."] } };
        const shift = /^(?:The [\w' -]+?|It) attempts to move all creatures that it has Grabbed into other spaces within (?:the )?reach of its ([\w' -]+?), rolling a single @C check and comparing the result against each creature['’]s Fortitude DC\. On a failure, the creature remains in place, and on a critical failure, the creature is no longer grabbed\.$/i.exec(tagged);
        if (shift && /@Check\[athletics\]/i.test(html)) {
            const moved = { ...none(), manualInstructions: [`Move {target} to another space within the reach of its ${shift[1]}.`] };
            return { ...base(item), targeting: { target: "the creatures it holds", range: null, area: null, grabbed: true }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "skill", statistic: "athletics", against: { dc: "target", statistic: "fortitude" } }, sharedDamage: null, outcomes: { criticalSuccess: moved, success: moved, failure: none(), criticalFailure: { ...none(), effects: [{ kind: "end-condition", slugs: ["grabbed"] }] } } }, notes: ["One check against each creature it holds."] };
        }
        const antenna = basicActions?.disarm ? /^(?:The [\w' -]+?|It) attempts to Disarm (an? [^.]+?) using its ([\w' -]+?) \(with the same modifier as an? \2 Strike\)\.((?: [^.]+\.)*)$/i.exec(tagged) : null;
        const antennaStrike = antenna ? ownItems.find((entry) => entry?.type === "melee" && String(entry.name).toLowerCase() === antenna[2].toLowerCase()) : null;
        if (antennaStrike && Number.isFinite(Number(antennaStrike.system?.bonus?.value))) {
            const disarm = basicActions.disarm;
            return { ...disarm, ...base(item), targeting: { target: "1 creature", range: "touch", area: null }, trigger: { event: "use" }, resolution: { ...disarm.resolution, check: { ...disarm.resolution.check, modifier: Number(antennaStrike.system.bonus.value) } }, notes: [`Only ${antenna[1]}.`, ...sentences(antenna[3])] };
        }
        const formLink = /@UUID\[(Compendium\.pf2e\.bestiary-effects\.Item\.\w+)\]\{(?:Effect: )?([^}]+)\}/.exec(html);
        const vortex = formLink && check && damage.length === 1 ? /^(?:The [\w' -]+?|It) transforms itself into [^.]+\. It stays in this form for (\d+) rounds? or until it Dismisses the effect\. ((?:[^.]+\.)(?: [^.]+\.)*?) Instead, any creature (?:the [\w' -]+?|it) moves through takes @D damage\. A creature can take this damage only once per round\. An? (Tiny|Small|Medium|Large|Huge) or smaller creature must also succeed at an? @C save or be picked up and held suspended within the vortex\.((?: [^.]+\.)*)$/i.exec(tagged) : null;
        if (vortex) {
            const hit = { damage: { mode: "formulas", formulas: [{ formula: damage[0] }], rollScope: "target" }, effects: [] };
            const lifted = { ...hit, effects: [{ kind: "condition", slug: "grabbed", value: null, duration: null }], manualInstructions: ["{target} is held in the vortex and moves with it."] };
            const form = auto({ target: "self", range: null, area: null }, { ...none(), nativeEffects: [{ uuid: formLink[1], label: formLink[2] }] }, { notes: sentences(vortex[2]) });
            const through = { ...base(item), targeting: { target: "each creature it moves through", range: null, area: null }, trigger: { event: "use" }, resolution: { ...saveOf(check), outcomes: { criticalSuccess: hit, success: hit, failure: lifted, criticalFailure: lifted } }, notes: [`Each creature once per round; the save only for a ${vortex[3]} or smaller one.`, ...sentences(vortex[4])] };
            return { builtin: "modes", actions, all: true, modes: [{ name: "Form", plan: form }, { name: "Moving through", plan: through }], notes: [`The form lasts ${vortex[1]} rounds; each creature it moves through, the second way.`] };
        }
        const cage = /^(?:Once per day, )?(?:an? |the )?[\w' -]+? can cause a cage [^.]+? at a range of up to (\d+) feet, attempting an Athletics check to Grapple against the target['’]s Fortitude DC; (if the target has a weakness to [\w ]+, (?:the [\w' -]+?|it|she|he) gains an? \+\d+ circumstance bonus to this check)\. Unlike a normal Grapple, [^.]+?, and a successful attempt lasts until the creature Escapes, [^.]+\.((?: [^.]+\.)*)$/i.exec(tagged);
        if (cage) {
            const escape = /\[\[\/act escape dc=(\d+)\]\]/i.exec(html)?.[1];
            return { ...base(item), targeting: { target: "1 creature", range: `${cage[1]} feet`, area: null }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "skill", statistic: "athletics", against: { dc: "target", statistic: "fortitude" } }, sharedDamage: null, outcomes: { criticalSuccess: held("grabbed"), success: held("grabbed"), failure: none(), criticalFailure: none() } }, notes: [`${cage[2][0].toUpperCase()}${cage[2].slice(1)} (its toggle on the sheet).`, ...(escape ? [`Escape DC ${escape}.`] : []), ...sentences(cage[3])] };
        }
        const frenzy = /^(?:The [\w' -]+?|It) casts up to (two|three|four) spells chosen from ([^.]+)\.$/i.exec(tagged);
        if (frenzy) {
            const count = { two: 2, three: 3, four: 4 }[frenzy[1].toLowerCase()];
            const way = (index) => ({ name: `Spell ${index + 1}`, plan: { builtin: "cast-spell", source: { name: item.name, uuid: item.uuid ?? null, slug: item.system?.slug ?? null }, spell: null, pick: { own: true }, rank: null, dc: null, attack: null, tradition: null, self: false, notes: [`One of ${frenzy[2]}: the GM names it.`] } });
            return { builtin: "modes", actions, all: true, modes: Array.from({ length: count }, (_unused, index) => way(index)), notes: [`Up to ${frenzy[1]} spells, from ${frenzy[2]}.`] };
        }
        const praise = /^[^.]+\. (?:The [\w' -]+?|It) attempts to counteract one (\w+) effect on the ally \(with a counteract modifier of \+(\d+)\), and the [\w' -]+? and the ally both gain an? \+(\d+) (status|circumstance) bonus to attack rolls and saving throws for (\d+) rounds?\.$/i.exec(tagged);
        if (praise) {
            const duration = { ...round, value: Number(praise[5]) };
            const boosts = (recipient) => ["attack", "saving-throw"].map((selector) => ({ selector, value: Number(praise[3]), type: praise[4].toLowerCase(), duration, ...(recipient ? { recipient } : {}) }));
            return auto({ target: "1 ally", range: null, area: null, allies: true }, { ...none(), modifiers: [...boosts(null), ...boosts("self")], manualInstructions: [`Counteract one ${praise[1]} effect on {target} (counteract +${praise[2]}).`] });
        }
        const rust = /^(?:Frequency [^.]+?\.? Effect )?(?:The [\w' -]+?|It) makes an? \+(\d+) spell attack against a creature or unattended object\. If (?:they|it) succeeds?, (?:the [\w' -]+?|it) deals (\d+d\d+) damage \(doubled on a critical hit\) to a metal item the target is wearing or holding, ignoring its Hardness\.((?: [^.]+\.)*)$/i.exec(tagged);
        if (rust) {
            const hit = (dice) => ({ ...none(), manualInstructions: [`A metal item {target} wears or holds takes ${dice} damage, ignoring its Hardness.`] });
            return { ...base(item), targeting: { target: "1 creature", range: null, area: null }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "skill", statistic: "spell-attack", modifier: Number(rust[1]), against: { dc: "target", statistic: "ac" } }, sharedDamage: null, outcomes: { criticalSuccess: hit(`2×${rust[2]}`), success: hit(rust[2]), failure: none(), criticalFailure: none() } }, notes: sentences(rust[3]) };
        }
        const blend = /^(?:The [\w' -]+?|It) Strides up to twice (?:their|its) speed\. If (?:the [\w' -]+?|it) ends (?:their|its) movement in an area of dim light, (?:they|it) becomes? Hidden (as long as [^.]+)\.$/i.exec(tagged);
        if (blend) return auto({ target: "self", range: null, area: null }, held("hidden"), { notes: ["After its two Strides: only if it ended them in dim light.", `${blend[1][0].toUpperCase()}${blend[1].slice(1)}.`] });
        const merge = damage.length === 2 ? /^An? [\w' -]+? can combine itself with an adjacent and willing [\w' -]+? that is not currently affected by ([A-Z][\w' -]+?)\. The [\w' -]+? using \1 physically merges with the target, restoring @D Hit Points to the target\. ((?:[^.]+\.)(?: [^.]+\.)*)$/i.exec(tagged) : null;
        if (merge) return auto({ target: "1 ally", range: "touch", area: null, allies: true }, { ...none(), effects: [{ kind: "heal", formula: damage[0].replace(/\[healing\]$/, "") }], manualInstructions: [`Turn on {target}'s ${merge[1]} toggle while this is sustained; when it ends, {target} takes ${damage[1].replace(/\[untyped\]$/, "")} damage.`] }, { notes: sentences(merge[2].replace(/@D/g, "the damage")) });
        const gate = /^Requirements? (.+?)\.? Effect (?:The [\w' -]+?|It) casts summon fey with only a verbal component, [^.]+\.((?: [^.]+\.)*)$/i.exec(tagged);
        const fey = gate ? /@UUID\[(Compendium\.pf2e\.spells-srd\.Item\.\w{16})\]\{([^}]+)\}/.exec(html) : null;
        if (fey) return { builtin: "cast-spell", source: { name: item.name, uuid: item.uuid ?? null, slug: item.system?.slug ?? null }, spell: { uuid: fey[1], name: fey[2] }, rank: null, dc: null, attack: null, tradition: null, self: false, requires: gate[1], notes: ["Only a verbal component.", ...sentences(gate[2])] };
    }

    if (split && ["reaction", "free"].includes(type)) {
        const effect = split[2].trim();
        const trigger = readReactionTrigger(split[1].trim());
        const tendrils = /^(?:The [\w' -]+?|It) uses Grab on the triggering creature\.((?: [^.]+\.)*)$/i.exec(effect);
        const near = /^An? creature within (\d+) feet of (?:the [\w' -]+?|it) moves or attacks (?:the [\w' -]+?|it)$/i.exec(split[1].trim());
        if (tendrils && near) return { ...auto({ target: "the triggering creature", range: null, area: null }, held("grabbed")), activation: { time: type, traits: item.system?.traits?.value ?? [] }, trigger: { event: "provoke", reaction: true, triggers: ["move"], within: Number(near[1]), ...(type === "free" ? { free: true } : {}) }, notes: ["Also when the creature attacks it (the GM's).", ...sentences(tendrils[1])] };
        const spiral = /^(?:[^.]+\. )?(?:The [\w' -]+?|It) can immediately end a single (\w+) effect from which the triggering creature is benefiting\.$/i.exec(effect);
        if (spiral && /\bfails a saving throw to resist one of (?:the [\w' -]+?['’]s|its) [^.]*spells\b/i.test(split[1])) return { ...auto({ target: "the triggering creature", range: null, area: null }, { ...none(), manualInstructions: [`End one ${spiral[1]} effect that benefits {target}.`] }), activation: { time: type, traits: item.system?.traits?.value ?? [] }, trigger: { event: "foe-failed-save", reaction: true, spell: true, ...(type === "free" ? { free: true } : {}) } };
        const menace = /^(?:The [\w' -]+?|It) attempts an? @C check to counteract the triggering spell\.$/i.exec(effect);
        const menaceSkill = menace ? /@Check\[(\w+)\]/.exec(html)?.[1] : null;
        if (menaceSkill && trigger?.event === "provoke") return { ...auto({ target: "the triggering creature", range: null, area: null }, { ...none(), manualInstructions: [`Roll its ${menaceSkill[0].toUpperCase()}${menaceSkill.slice(1)} to counteract {target}'s spell (its counteract rank half its level, rounded up).`] }), activation: { time: type, traits: item.system?.traits?.value ?? [] }, trigger };
        const beams = /^(?:The [\w' -]+?|It) fires its ([A-Z][\w' -]+?) at only the creature it hit twice\. The creature['’]s save result is one degree of success worse than the result it rolled\.$/i.exec(effect);
        const beam = beams ? compileOwn(own(beams[1])) : null;
        if (beam?.resolution?.kind === "save") {
            const rows = beam.resolution.outcomes;
            return pressed({ ...beam, ...base(item), targeting: { target: "the creature it hit twice", range: null, area: null }, resolution: { ...beam.resolution, outcomes: { criticalSuccess: rows.success, success: rows.failure, failure: rows.criticalFailure, criticalFailure: rows.criticalFailure } }, notes: [`Its ${beams[1]}, its result one degree worse.`] });
        }
        const yank = /^(?:The [\w' -]+?|It) tries to pull a creature it has Grabbed or Restrained into the path of the attack\. (?:The [\w' -]+?|It) attempts an Athletics check, including its bonus to Grapple\. If it succeeds against the grabbed or restrained creature['’]s Fortitude DC, (?:the [\w' -]+?|it) redirects the attack to that creature, [^.]+\.((?: [^.]+\.)*)$/i.exec(effect);
        // (The GM's to use: its card is for the creature it holds, not the attacker.)
        if (yank) return pressed({ ...base(item), targeting: { target: "the creature it holds", range: null, area: null, grabbed: true }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "skill", statistic: "athletics", against: { dc: "target", statistic: "fortitude" } }, sharedDamage: null, outcomes: { criticalSuccess: { ...none(), manualInstructions: ["The attack goes to {target}: compare its roll with {target}'s AC."] }, success: { ...none(), manualInstructions: ["The attack goes to {target}: compare its roll with {target}'s AC."] }, failure: none(), criticalFailure: none() } }, notes: sentences(yank[1]) });
        const dancing = /^(?:The [\w' -]+?|It)['’]s? weapon leaps into the air and moves with (?:the [\w' -]+?|it) as if held with both hands\. The weapon gains the effects of the dancing weapon rune for (\d+) minutes?\.$/i.exec(effect);
        if (dancing) return pressed(auto({ target: "self", range: null, area: null }, { ...none(), noteEffects: [{ label: "Dancing weapon", text: "Its weapon fights on its own, as the dancing rune says.", duration: { mode: "fixed", value: Number(dancing[1]), unit: "minutes", expiry: "turn-start", anchor: "effect-start" } }] }));
        const curse = check ? /^(?:[^.]+\. )?The target must succeed at an? @C save or lose any (\w+) resistance it has until this curse is lifted\.$/i.exec(effect) : null;
        if (curse) {
            const lost = { ...none(), noteEffects: [{ label: `No ${curse[1]} resistance`, text: `It has lost its ${curse[1]} resistance until the curse is lifted.`, duration: null }] };
            return pressed({ ...base(item), targeting: { target: "the triggering creature", range: null, area: null }, trigger: { event: "use" }, resolution: { ...saveOf(check), outcomes: { criticalSuccess: none(), success: none(), failure: lost, criticalFailure: lost } } });
        }
        const venom = damage.length === 1 ? /^The creature takes an additional @D damage even if it succeeds at its save\.$/i.exec(effect) : null;
        if (venom) return pressed(auto({ target: "the triggering creature", range: null, area: null }, { damage: { mode: "formulas", formulas: [{ formula: damage[0] }], rollScope: "target" }, effects: [] }));
        const wind = check ? /^(?:The [\w' -]+?|It) attempts to turn the grabbed creature into wind and carry it along as part of the action\. If the target succeeds at an? @C save, it prevents itself from being transformed; ([^.]+)\.((?: [^.]+\.)*)$/i.exec(effect) : null;
        if (wind) {
            const carried = { ...none(), manualInstructions: ["{target} becomes wind and travels with it.", ...sentences(wind[2])] };
            return pressed({ ...base(item), targeting: { target: "the creature it holds", range: null, area: null, grabbed: true }, trigger: { event: "use" }, resolution: { ...saveOf(check), outcomes: { criticalSuccess: { ...none(), manualInstructions: [`${wind[1][0].toUpperCase()}${wind[1].slice(1)}.`] }, success: { ...none(), manualInstructions: [`${wind[1][0].toUpperCase()}${wind[1].slice(1)}.`] }, failure: carried, criticalFailure: carried } } });
        }
        const wormhole = /^(?:The [\w' -]+?|It) creates an extradimensional wormhole at the triggering creature['’]s initial location that persists for up to (\d+) minutes?\. ((?:[^.]+\.)(?: [^.]+\.)*)$/i.exec(effect);
        if (wormhole) return pressed({ builtin: "zone", actions: 0, zone: { area: { type: "square", value: 5 }, centre: "placed", range: null, lasts: { mode: "fixed", value: Number(wormhole[1]), unit: "minutes", expiry: "turn-start", anchor: "effect-start" }, untilReused: false, concealed: false, terrain: [], others: false, hazard: null, saves: [], damage: [], effect: null, modifiers: [], notes: ["Where the creature stood before it teleported.", ...sentences(wormhole[2])] } });
        const manual = [
            /^(?:The [\w' -]+?|It) lends some of its electrical power to the nearby lizard\. (This either [^.]+\.)$/i,
            /^(?:The [\w' -]+?|It) recreates the auditory effect, (gaining the bonuses for itself and its allies as long as the original effect persists)\.$/i,
            /^The swallowed creature is wrapped in a tight cocoon and extruded from (?:the [\w' -]+?['’]s|its) body into an adjacent square\. ((?:[^.]+\.)(?: [^.]+\.)*)$/i
        ];
        for (const pattern of manual) {
            const match = pattern.exec(effect);
            if (match) return pressed(auto({ target: "the triggering creature", range: null, area: null }, { ...none(), manualInstructions: sentences(effect) }));
        }
    }
    return null;
}

// Group D, more (2026-10-13, batch 277; the user's call: build the rest). null otherwise:
// - one of two anthems, wider and stronger, PF2e's effect for each linked (Telepathic Ballad) → a way each: its effect on its allies around it;
// - healing by how many foes suffer near it (Feed on Sorrow: 10 HP per enemy within 30 feet with one of the listed conditions, at most 40) → a
//   way for each count, the GM's pick;
// - a link to a creature, PF2e's effect for it (Bond in Light) → that effect on the creature, the rest notes;
// - a feast on a helpless creature (Invigorating Feast: its jaws Strike's damage, a basic save; temporary Hit Points and Speed on itself after);
// - stepping onto its disk (Hop On) → its own move, nothing to resolve;
// - casting one of its own spells (Autonomous Spell, Sudden Destruction) → a cast card for the spell the GM names;
// - a corpse or a dying creature thrown as a rock (Hurl Corpse) → its rock Strike, the rest notes;
// - a save or its own curse (Devour Life: "… must succeed at a … save or be afflicted with the baykok's wasting curse. …") → that save, the curse's own
//   after a failure, temporary Hit Points on itself;
// - a save or buried (Landslide) → its save, the burying the GM's;
// - a Demoralize, then a Stride and one Athletics action at the same foe (Vie for Victory) → in turn: Demoralize, then one maneuver of the GM's pick;
// - a plant grown or shrunk (Resize Plant) → Enlarge or Shrink, at its DC;
// - a "naughty" mark with PF2e's toggle (Krampus) → Hunt Prey's kin, the toggle switched on;
// - a +2 to its own skill check and a glow (Nanite Surge) → the bonus and PF2e's glow effect on itself, the GM's to use as it rolls;
// - a stored d20 (Luck Osmosis) → a note Effect on itself, the GM's to use;
// - an anchoring tail (Anchor) → a way each: on itself or on its rider, a note Effect;
// - a dying creature's soul held (Suspend Soul) → its Will save, a note Effect for 10 minutes on a failure; used as it downs one (Instant Suspension);
// - eating its own tail (Devour Tail) → PF2e's toggle on itself while it lasts;
// - good or bad luck after a failed save (Manipulate Luck) → two ways, PF2e's effect for each on a failure;
// - swapping or moving destabilized creatures (Transpose) → each target's Will save, the teleport the GM's on a failure;
// - moving after a hit (Displace), a cocoon's life for its Weaver (Give of Oneself), a ledge's pull (Leap into the Unknown: its save or the fall), a room
//   of illusions (Disorient: a Perception check, difficult terrain and Sickened), a doorway that turns creatures back (Confounding Misdirection) →
//   their cards, the GM's to use as they happen;
// - a creature's soul fed on as it dies beside it (Soul Feast) → healing on itself, the GM's to use.
function chunk277(item, actor, basicActions) {
    const type = item.system?.actionType?.value;
    const html = String(item.system?.description?.value ?? "");
    const owner = actor ?? item.actor ?? item.parent;
    const ownItems = owner?.items?.contents ?? owner?.items ?? [];
    const plain = htmlToPlainText(html.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\[\[\/(?:r|gmr|br) [^\]]*\]\]\{([^}]*)\}/g, "$1").replace(/\[\[\/(?:r|gmr|br) \{?([^\]#}]+?)\}?(?: ?#[^\]]*)?\]\](?!\{)/g, "$1").replace(/\[\[\/act ([\w-]+)[^\]]*\]\](?:\{([^}]*)\})?/g, (_all, slug, label) => label ?? slug.replace(/-/g, " ").replace(/^\w/, (letter) => letter.toUpperCase()))).replace(/\s+/g, " ").trim();
    const tagged = plain.replace(/([^.])$/, "$1.").replace(/@Template\[[^\]]*\](?:\{[^}]*\})?/g, "@T").replace(/@Check\[[^\]]*\](?:\{[^}]*\})?/g, "@C").replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g, "@D");
    const actions = Number(item.system?.actions?.value) || 1;
    const check = inlineTags(html, "Check").map(readCheck).find((entry) => entry?.save && entry.dc);
    const template = inlineTags(html, "Template").map(readTemplate).find(Boolean);
    const damage = inlineTags(html, "Damage").map(readDamage);
    const split = /^(?:Frequency [^.]+?\.? )?Trigger (.+?)[;.]?(?: Requirements? [^.]+?\.?)? Effects? (.+)$/i.exec(tagged);
    const required = /^(?:Frequency [^.]+?\.? )?Requirements? (.+?)\.? Effects? /i.exec(tagged)?.[1] ?? null;
    const allChecks = inlineTags(html, "Check").map(readCheck);
    const wordedAt = (fragment) => {
        const text = String(fragment ?? "");
        const at = tagged.indexOf(text);
        if (at < 0 || !/@[CD]\b/.test(text)) return text;
        let count = (tagged.slice(0, at).match(/@C\b/g) ?? []).length;
        let roll = (tagged.slice(0, at).match(/@D\b/g) ?? []).length;
        return text.replace(/@C\b/g, () => {
            const entry = allChecks[count++];
            return entry?.dc ? `DC ${entry.dc} ${entry.statistic[0].toUpperCase()}${entry.statistic.slice(1)}` : "a";
        }).replace(/@D\b/g, () => String(damage[roll++] ?? "its").replace(/\[(\w+)\]/g, " $1").replace(/,/g, " plus "));
    };
    const sentences = (text) => wordedAt(String(text ?? "").trim()).split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean);
    const auto = (targeting, success, extra = {}) => ({ ...base(item), targeting, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success, failure: none(), criticalFailure: none() } }, ...extra });
    const saveOf = (entry) => ({ kind: "save", check: { roll: "save", statistic: entry.statistic, basic: false, against: { dc: "fixed", value: entry.dc } }, sharedDamage: null });
    const pressed = (plan) => plan && { ...plan, ...(plan.resolution ? { activation: { ...(plan.activation ?? {}), time: type } } : {}), trigger: { event: "use", reaction: true, ...(type === "free" ? { free: true } : {}) }, notes: [`Its trigger, the GM's call: ${split[1].trim().replace(/\.?$/, ".")}`, ...(plan.notes ?? [])] };
    const effectLinks = [...html.matchAll(/@UUID\[(Compendium\.pf2e\.bestiary-effects\.Item\.\w+)\]\{(?:Effect: )?([^}]+)\}/g)].map((match) => ({ uuid: match[1], label: match[2] }));
    const spellLinks = [...html.matchAll(/@UUID\[(Compendium\.pf2e\.spells-srd\.Item\.\w{16})\]\{([^}]+)\}/g)].map((match) => ({ uuid: match[1], name: match[2] }));
    const toggles = (item.system?.rules ?? []).filter((rule) => rule?.key === "RollOption" && rule.toggleable && rule.option && !rule.suboptions?.length);
    const castPlan = (spell, extra = {}) => ({ builtin: "cast-spell", source: { name: item.name, uuid: item.uuid ?? null, slug: item.system?.slug ?? null }, spell: spell ? { uuid: spell.uuid, name: spell.name } : null, rank: null, dc: null, attack: null, tradition: null, self: false, ...extra });
    const minutes = (value) => ({ mode: "fixed", value: Number(value), unit: "minutes", expiry: "turn-start", anchor: "effect-start" });
    const capital = (text) => `${text[0].toUpperCase()}${text.slice(1)}`;

    // (A disk it rides, Hop On: its own move, nothing to resolve; a free action.)
        if (/^(?:Frequency [^.]+?\.? )?Requirements? [^.]+? adjacent to an? ([\w' -]+?) (?:they|it) created\.? Effect (?:The [\w' -]+?|It) Steps into the [\w' -]+? space and rides atop the [\w' -]+?\. (?:They|It) can also use this action to dismount from (?:their|its) [\w' -]+?\.$/i.test(tagged)) return { builtin: "no-effect" };
    // (Landslide: a free action with a requirement, no trigger.)
    const landslide = check && required ? /^(?:Frequency [^.]+?\.? )?Requirements? [^.]+?\.? Effect (?:The [\w' -]+?|It) closes a fissure it made, choosing one creature that fell in\. That creature must succeed at an? @C save or be buried as in an avalanche\.$/i.exec(tagged) : null;
    if (landslide) {
        const buried = { ...none(), manualInstructions: ["{target} is buried, as in an avalanche."] };
        return { ...base(item), targeting: { target: "1 creature", range: null, area: null }, trigger: { event: "use" }, requires: required, resolution: { ...saveOf(check), outcomes: { criticalSuccess: none(), success: none(), failure: buried, criticalFailure: buried } }, notes: ["A creature that fell into its fissure."] };
    }
    if (type === "action") {
        const anthem = spellLinks.length === 2 && effectLinks.length === 2 && template?.type === "emanation" ? /^(?:The [\w' -]+?|It) casts ([A-Z][\w' -]+?) or ([A-Z][\w' -]+?)\. It increases the area to an? @T and increases the status bonuses the cantrip provides to \+(\d+)\./i.exec(tagged) : null;
        if (anthem) return { builtin: "modes", actions, modes: spellLinks.map((spell, index) => ({ name: spell.name, plan: auto({ target: null, range: null, area: { type: "emanation", value: Number(template.value) }, allies: true }, { ...none(), nativeEffects: [effectLinks[index]] }, { notes: ["Itself too."] }) })) };
        const sorrow = /^(?:Frequency [^.]+?\.? Effect )?(?:[^.]+\. )?(?:The [\w' -]+?|It) regains (\d+|@D) Hit Points for each enemy within @T(?: feet)? that has one of the following conditions, to a maximum of (\d+) Hit Points: ([^.]+)\.$/i.exec(tagged);
        if (sorrow) {
            const each = Number(sorrow[1] === "@D" ? String(damage[0] ?? "").replace(/\[healing\]$/, "") : sorrow[1]);
            const most = Math.floor(Number(sorrow[2]) / each);
            if (Number.isFinite(each) && each > 0 && most > 0) return { builtin: "modes", actions, modes: Array.from({ length: most }, (_unused, index) => ({ name: `${index + 1}${index + 1 === most ? " or more" : ""}`, plan: auto({ target: "self", range: null, area: null }, { ...none(), effects: [{ kind: "heal", formula: String(each * (index + 1)) }] }) })), notes: [`The count: enemies within ${template?.value ?? 30} feet that are ${sorrow[3].replace(/,? and /, ", or ")}.`] };
        }
        const bond = effectLinks.length === 1 ? /^(?:The [\w' -]+?|It) magically links to one living creature within ([^.]+?)\. ((?:[^.]+\.)(?: [^.]+\.)*)$/i.exec(tagged) : null;
        if (bond) return auto({ target: "1 creature", range: null, area: null }, { ...none(), nativeEffects: [effectLinks[0]] }, { notes: [`A living creature within ${bond[1]}.`, ...sentences(bond[2]).filter((sentence) => !/^Effect:/.test(sentence))] });
        const feast = check?.basic ? /^Requirements? (.+?)\.? Effect (?:The [\w' -]+?|It) feasts upon the creature, dealing (?:their|its) ([\w' -]+?) Strike damage \(@C save\); a corpse automatically critically fails with no save\. If the target takes damage, (?:the [\w' -]+?|it) gains (\d+) temporary Hit Points and an? \+(\d+)-foot circumstance bonus to (?:their|its) Speeds for (\d+) minutes?\.$/i.exec(tagged) : null;
        const jaws = feast ? ownItems.find((entry) => entry?.type === "melee" && String(entry.name).toLowerCase() === feast[2].toLowerCase()) : null;
        const bite = jaws ? Object.values(jaws.system?.damageRolls ?? {})[0] : null;
        if (bite?.damage) {
            const formula = `${/[+-]/.test(bite.damage) ? `(${bite.damage})` : bite.damage}[${bite.damageType ?? "piercing"}]`;
            const plan = inlineSave(withDescription(item, `<p>The creature takes @Damage[${formula}] damage (@Check[${check.statistic}|dc:${check.dc}|basic] save).</p>`), owner);
            if (plan?.resolution) {
                const fed = (row) => (row?.damage?.multiplier ? { ...row, effects: [...(row.effects ?? []), { kind: "temp-hp", formula: feast[3], recipient: "self", duration: minutes(feast[5]) }], manualInstructions: [`It gains a +${feast[4]}-foot circumstance bonus to its Speeds for ${feast[5]} minute${feast[5] === "1" ? "" : "s"}.`] } : row);
                const rows = plan.resolution.outcomes;
                return { ...plan, ...base(item), targeting: { target: "1 creature", range: "touch", area: null }, requires: feast[1], resolution: { ...plan.resolution, outcomes: Object.fromEntries(Object.entries(rows).map(([degree, row]) => [degree, fed(row)])) }, notes: ["A corpse critically fails, with no save."] };
            }
        }
        const sudden = /^Requirements? (.+?)\.? Effect (?:The [\w' -]+?|It) casts one of its spontaneous spells, using up the spell slot normally\. ((?:[^.]+\.)(?: [^.]+\.)*)$/i.exec(tagged);
        if (sudden) return castPlan(null, { pick: { own: true }, requires: sudden[1], notes: ["One of its spontaneous spells: the GM names it.", ...sentences(sudden[2]).filter((sentence) => !/\bcan(?:'t|not) use this ability again for\b/i.test(sentence))] });
        const corpse = /^(?:The [\w' -]+?|It) picks up a dead or dying creature within reach and flings it at a foe\. (?:The [\w' -]+?|It) makes an? ([\w' -]+?) Strike, using the body instead of an? \1\. ((?:[^.]+\.)(?: [^.]+\.)*)$/i.exec(tagged);
        if (corpse) return { builtin: "strike-activity", actions, strides: 0, strike: corpse[1].toLowerCase(), attackBonus: 0, damageBonus: 0, offGuard: false, requires: null, oncePerFight: false, onHit: { conditions: [], critical: null, push: null, damage: [], save: null, size: null }, notes: sentences(corpse[2].replace(/@T/g, "10-foot burst")) };
        const wasting = check ? /^Requirements? (.+?)\.? Effect (?:[^.]+\. )?The target must succeed at an? @C save or be afflicted with (?:the [\w' -]+?['’]s|its) ([\w' -]+?)\. If the target fails and wasn't already affected by the \2, (?:the [\w' -]+?|it) gains (\d+) temporary Hit Points that last for (\d+) hours?\.$/i.exec(tagged) : null;
        const curse = wasting ? ownAffliction(item, owner, wasting[2].toLowerCase()) : null;
        if (wasting) {
            const hours = { mode: "fixed", value: Number(wasting[4]), unit: "hours", expiry: "turn-start", anchor: "effect-start" };
            const afflicted = { ...none(), effects: [{ kind: "temp-hp", formula: wasting[3], recipient: "self", duration: hours }], ...(curse?.resolution?.afflictionHandoff ? { followUps: [{ kind: "save", check: curse.resolution.check, outcomes: curse.resolution.outcomes, afflictionHandoff: curse.resolution.afflictionHandoff }] } : { manualInstructions: [`{target} is afflicted with its ${wasting[2]}.`] }) };
            return { ...base(item), targeting: { target: "1 creature", range: "touch", area: null }, trigger: { event: "use" }, requires: wasting[1], resolution: { ...saveOf(check), outcomes: { criticalSuccess: none(), success: none(), failure: afflicted, criticalFailure: afflicted } }, notes: ["The temporary Hit Points only if it wasn't already afflicted."] };
        }
        const vie = basicActions?.demoralize ? /^[^.]+\. (?:They|It) choose one target (?:they|it) can see and reach with a single Stride action\. (?:They|It) attempts? to Demoralize that target, ignoring the typical limitations on distance and with no penalty for not sharing a language with the target\. (?:They|It) then Strides? and attempts? one Athletics attack action \(such as ([^)]+)\) against the target\.$/i.exec(tagged) : null;
        if (vie) {
            const athletics = ["grapple", "disarm", "shove", "trip"].filter((slug) => basicActions[slug]);
            return { builtin: "modes", actions, all: true, modes: [{ name: "Demoralize", plan: { ...basicActions.demoralize, notes: ["No limit on distance, no penalty for language."] } }, ...athletics.map((slug) => ({ name: capital(slug), group: "athletics", plan: basicActions[slug] }))], notes: ["Demoralize first, then a Stride and one Athletics action at the same foe."] };
        }
        const resize = check && spellLinks.length === 2 ? /^(?:Frequency [^.]+?\.? )?Requirements? (.+?)\.? Effect The plant grows or shrinks by one size, remaining that size for the next (\d+) minutes\. If used on a plant creature, this effect has the effects of ([A-Z][\w' -]+?) or ([A-Z][\w' -]+?) \([^)]*choice\)\.((?: [^.]+\.)*)$/i.exec(tagged) : null;
        if (resize) return { builtin: "modes", actions, modes: spellLinks.map((spell) => ({ name: spell.name, plan: castPlan(spell, { dc: check.dc, notes: [`A plant creature: as ${spell.name}; a plain plant grows or shrinks one size for ${resize[2]} minutes.`] }) })), requires: resize[1] };
        const naughty = /^(?:Requirements? (.+?)\.? (?:Effect )?)?(?:The [\w' -]+?|It|[A-Z][\w'-]+) designates a single target (?:he|she|it|they) can see as ["“]([\w' -]+?)\.?["”]\.? ((?:[^.]+\.)(?: [^.]+\.)*)$/i.exec(tagged);
        if (naughty && toggles.length === 1) return { builtin: "hunt-prey", edge: null, mark: true, toggle: toggles[0].option, notes: sentences(naughty[3]).map((sentence) => sentence.replace(/\bthe [\w' -]+? target\b/gi, "its mark")), ...(naughty[1] ? { requires: naughty[1] } : {}) };
        const anchor = /^(?:The [\w' -]+?|It) wraps its tail around either a stationary object or its rider\. ((?:[^.]+\.)(?: [^.]+\.)*)$/i.exec(tagged);
        if (anchor) {
            const rest = sentences(anchor[1]);
            const way = (target, label) => auto(target === "self" ? { target: "self", range: null, area: null } : { target: "1 ally", range: "touch", area: null, allies: true }, { ...none(), noteEffects: [{ label, text: rest.join(" "), duration: null }] });
            return { builtin: "modes", actions, modes: [{ name: "Object", plan: way("self", "Anchored") }, { name: "Rider", plan: way("rider", "Anchored rider") }] };
        }
        const suspend = check ? /^(?:The [\w' -]+?|It) suspends the life processes of a dying creature within (\d+) feet of it\. The creature can't decrease or increase its HP or dying value for (\d+) minutes\. The creature can attempt an? @C save to avoid this effect\. ((?:[^.]+\.)(?: [^.]+\.)*)$/i.exec(tagged) : null;
        if (suspend) {
            const held = { ...none(), noteEffects: [{ label: "Soul suspended", text: `Its Hit Points and dying value can't change. ${sentences(suspend[3]).join(" ")}`, duration: minutes(suspend[2]) }] };
            return { ...base(item), targeting: { target: "1 creature", range: `${suspend[1]} feet`, area: null }, trigger: { event: "use" }, resolution: { ...saveOf(check), outcomes: { criticalSuccess: none(), success: none(), failure: held, criticalFailure: held } }, notes: ["Only a dying creature."] };
        }
        const tail = toggles.length === 1 ? /^[^.]+\. (?:The [\w' -]+?|It) places its maw around the end of its tail and begins devouring its own body\. ((?:[^.]+\.)(?: [^.]+\.)*)$/i.exec(tagged) : null;
        if (tail) return { builtin: "self-effect", actions, model: { name: item.name, rounds: null, modifiers: [], tempHp: 0, toggle: true }, damage: [], strike: null, melee: false, stance: true, duration: { value: -1, unit: "unlimited", expiry: null }, notes: ["While it keeps eating its tail (remove the Effect when it stops)."] };
        const luck = check && effectLinks.length === 2 ? /^(?:Frequency [^.]+?\.? Effect )?(?:The [\w' -]+?|It) touches another creature to manipulate the creature['’]s luck\. The creature must attempt an? @C save\. On a failure, (?:the [\w' -]+?|it) chooses good luck or bad luck\./i.exec(tagged) : null;
        if (luck) return { builtin: "modes", actions, modes: effectLinks.map((effect) => ({ name: effect.label.replace(/^[^(]*\(([^)]+)\)$/, "$1 luck"), plan: { ...base(item), targeting: { target: "1 creature", range: "touch", area: null }, trigger: { event: "use" }, resolution: { ...saveOf(check), outcomes: { criticalSuccess: none(), success: none(), failure: { ...none(), nativeEffects: [effect] }, criticalFailure: { ...none(), nativeEffects: [effect] } } }, notes: ["A willing creature can choose to fail."] } })) };
        const transpose = check ? /^(?:The [\w' -]+?|It) (?:chooses|teleports) up to two destabilized creatures (?:they can see )?within (\d+) feet[^.]*?\. (?:[^.]+\. )*?An unwilling creature can attempt an? @C save\. If either target succeeds at this saving throw, both are unaffected\.$/i.exec(tagged) : null;
        if (transpose) {
            const moved = { ...none(), manualInstructions: ["Swap {target} with the other creature, or move it to an unoccupied space within range."] };
            return { ...base(item), targeting: { target: "up to 2 creatures", range: `${transpose[1]} feet`, area: null }, trigger: { event: "use" }, resolution: { ...saveOf(check), outcomes: { criticalSuccess: none(), success: none(), failure: moved, criticalFailure: moved } }, notes: ["Only destabilized creatures it can see; two swapped must be the same size (it can be one of them).", "If either succeeds, neither moves."] };
        }
    }

    if (split && ["reaction", "free"].includes(type)) {
        // (Without PF2e's effect label at the end: "… for 1 round. Effect: Nanite Surge (Glow)".)
        const effect = split[2].trim().replace(/\s*Effect: [^.]+\.?$/, "");
        const trigger = readReactionTrigger(split[1].trim());
        const soul = damage.length === 1 ? /^(?:The [\w' -]+?|It) consumes a portion of the creature['’]s soul, regaining @D Hit Points\.$/i.exec(effect) : null;
        if (soul) return pressed(auto({ target: "self", range: null, area: null }, { ...none(), effects: [{ kind: "heal", formula: damage[0].replace(/\[healing\]$/, "") }] }));
        const haunting = spellLinks.length >= 2 ? /^(?:The [\w' -]+?|It) casts ([A-Z][\w' -]+?) or ([A-Z][\w' -]+?), with the sound originating from the target or area of the spell\.$/i.exec(effect) : null;
        if (haunting) {
            const named = [haunting[1], haunting[2]].map((name) => spellLinks.find((spell) => spell.name === name)).filter(Boolean);
            if (named.length === 2) return { builtin: "modes", actions: 0, modes: named.map((spell) => ({ name: spell.name, plan: castPlan(spell, { notes: ["The sound comes from the target or area of the spell that set it off."] }) })), notes: [`Its trigger, the GM's call: ${split[1].trim().replace(/\.?$/, ".")}`] };
        }
        const autonomous = /^(?:[^.]+\. )?(?:They|It|The [\w' -]+?) casts? one of (?:their|its) (\d+)(?:st|nd|rd|th)-rank or lower (\w+) spontaneous spells that normally takes 2 actions or fewer to cast\.$/i.exec(effect);
        if (autonomous) return pressed(castPlan(null, { pick: { own: true }, notes: [`One of its ${autonomous[2]} spontaneous spells of rank ${autonomous[1]} or lower that takes 2 actions or fewer: the GM names it.`] }));
        const surge = effectLinks.length === 1 ? /^(?:[^.]+\. )?(?:They|It) gains? an? \+(\d+) (status|circumstance) bonus to the triggering skill check\. In addition, (?:their|its) [^,]+, creating an? (\d+)-foot emanation with dim light for (\d+) rounds?\.$/i.exec(effect) : null;
        if (surge) return pressed(auto({ target: "self", range: null, area: null }, { ...none(), modifiers: [{ selector: "skill-check", value: Number(surge[1]), type: surge[2].toLowerCase(), duration: { mode: "fixed", value: 0, unit: "rounds", expiry: "turn-end", anchor: "effect-start" } }], nativeEffects: [effectLinks[0]] }, { notes: ["The bonus only for the triggering check."] }));
        const osmosis = /^(?:The [\w' -]+?|It) stores the higher of the two numbers rolled and uses that number in place of (?:their|its) next d20 roll; this is a fortune effect\. ((?:[^.]+\.)(?: [^.]+\.)*)$/i.exec(effect);
        if (osmosis) return pressed(auto({ target: "self", range: null, area: null }, { ...none(), noteEffects: [{ label: "Stored d20", text: `Its next d20 roll uses the stored number (the higher of the two the creature rolled); a fortune effect. ${osmosis[1]}`, duration: null }] }));
        const instant = /^(?:The [\w' -]+?|It) uses ([A-Z][\w' -]+?), targeting the creature\.$/i.exec(effect);
        const instantPlan = instant ? compileMonsterAbility(ownItems.find((entry) => entry?.type === "action" && entry.name === instant[1]) ?? { type: "none" }, { basicActions, actor: owner }) : null;
        if (instantPlan?.resolution) return { ...instantPlan, ...base(item), targeting: { ...instantPlan.targeting, target: "the triggering creature" }, trigger: trigger?.event === "downs" ? trigger : { event: "use", reaction: true }, notes: [...(trigger?.event === "downs" ? [] : [`Its trigger, the GM's call: ${split[1].trim().replace(/\.?$/, ".")}`]), ...(instantPlan.notes ?? [])] };
        const displace = /^(?:The [\w' -]+?|It) (?:Repositions|Relocates)(?: (?:itself|themself))? or Transposes (?:itself|themself) with another creature\. ((?:[^.]+\.)(?: [^.]+\.)*)$/i.exec(effect);
        if (displace) return pressed(auto({ target: "self", range: null, area: null }, { ...none(), manualInstructions: ["It moves itself, or swaps places with another creature (its Transpose).", ...sentences(displace[1])] }));
        const give = damage.length === 2 ? /^(?:[^.]+\. )?It loses @D Hit Points, restoring @D Hit Points to the ([\w' -]+?)\. ((?:[^.]+\.)(?: [^.]+\.)*)$/i.exec(effect) : null;
        if (give) return pressed(auto({ target: `the ${give[1]}`, range: null, area: null, allies: true }, { ...none(), effects: [{ kind: "heal", formula: damage[1].replace(/\[healing\]$/, "") }], manualInstructions: [`It loses ${damage[0].replace(/\[\w+\]$/, "")} Hit Points.`] }, { notes: sentences(give[2]) }));
        const owner_hazard = owner?.type === "hazard";
        if (owner_hazard) {
            const ledge = check && damage.length >= 1 ? /^(?:[^.]+\. )?The creature must succeed at an? @C save or @C check to Balance or else drop off the ledge\. ((?:[^.]+\.)(?: [^.]+\.)*)$/i.exec(effect) : null;
            if (ledge) {
                const fall = { damage: { mode: "formulas", formulas: [{ formula: damage[0] }], rollScope: "target" }, effects: [{ kind: "condition", slug: "prone", value: null, duration: null }], manualInstructions: ["{target} falls off the ledge and lands back where it fell from."] };
                const balance = allChecks.find((entry) => entry?.statistic === "acrobatics");
                return { ...base(item), targeting: { target: "the triggering creature", range: null, area: null }, trigger: { event: "hazard" }, resolution: { ...saveOf(check), outcomes: { criticalSuccess: none(), success: none(), failure: fall, criticalFailure: fall } }, notes: [`Or a DC ${balance?.dc ?? "?"} Acrobatics check to Balance instead of the save.`, ...sentences(ledge[1]).filter((sentence) => !/@D|falling damage/i.test(sentence))] };
            }
            const room = /<strong>\s*Critical Success\s*<\/strong>/i.test(html) ? /^Illusions cause [^.]+ for (\d+) minutes?\. Each creature in the room while it['’]s distorting must attempt an? @C check\./i.exec(effect) : null;
            const perception = room ? allChecks.find((entry) => entry?.statistic === "perception" && entry.dc) : null;
            if (perception) {
                const sections = degreeSections(html);
                const terrain = "{target} treats the room as difficult terrain.";
                const rowOf = (degree) => {
                    const said = htmlToPlainText(String(sections[degree] ?? ""));
                    const effects = readConditions(String(sections[degree] ?? ""));
                    return { ...none(), effects, manualInstructions: [...(/difficult terrain/i.test(said) ? [terrain] : []), ...(/\bdisbelieves\b/i.test(said) && degree !== "criticalSuccess" ? ["It disbelieves, but still sees the illusions."] : [])] };
                };
                return { ...base(item), targeting: { target: "the creatures in the room", range: null, area: null }, trigger: { event: "hazard" }, resolution: { kind: "save", check: { roll: "save", statistic: "perception", basic: false, against: { dc: "fixed", value: perception.dc } }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: rowOf("success"), failure: rowOf("failure"), criticalFailure: rowOf("criticalFailure") } }, notes: [`The room shifts for ${room[1]} minute${room[1] === "1" ? "" : "s"}.`] };
            }
            const portal = check ? /^The creature is Confused by the illusions and directed back [^.]+\.((?: [^.]+\.)*?) A creature who succeeds at an? @C save resists this illusion [^.]+\.$/i.exec(effect) : null;
            if (portal) {
                const turned = { ...none(), manualInstructions: ["{target} is confused by the illusions and ends up back where it tried to leave (it doesn't notice)."] };
                return { ...base(item), targeting: { target: "the triggering creature", range: null, area: null }, trigger: { event: "hazard" }, resolution: { ...saveOf(check), outcomes: { criticalSuccess: none(), success: none(), failure: turned, criticalFailure: turned } } };
            }
        }
    }
    return null;
}

// A spell and a grab at once (2026-10-13, batch 275, Crew's Call: "This is a Wails of the Damned spell in a 100-foot emanation …. In addition, any
// creature within 5 feet of the ship is automatically Grabbed by the crew.") → each in turn: the spell's cast card, Grabbed on the creatures beside
// it. Read before the spell alone. null otherwise.
function castAndGrab(item, actor) {
    if (item.system?.actionType?.value !== "action") return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const grabbed = /\bIn addition, any creature within (\d+) feet of (?:the [\w' -]+?|it) is automatically Grabbed by [^.]+\./i;
    const within = grabbed.exec(plain);
    const called = within ? castSpell(item, actor) : null;
    if (!called) return null;
    const grab = { ...base(item), targeting: { target: null, range: null, area: { type: "emanation", value: Number(within[1]) } }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: { ...none(), effects: [{ kind: "condition", slug: "grabbed", value: null, duration: null }] }, failure: none(), criticalFailure: none() } }, notes: [`Every creature within ${within[1]} feet.`] };
    return { builtin: "modes", actions: Number(item.system?.actions?.value) || 1, all: true, modes: [{ name: called.spell.name ?? "The spell", plan: { ...called, notes: (called.notes ?? []).filter((note) => !grabbed.test(note)) } }, { name: "Grabbed", plan: grab }], notes: ["Both: the spell, and the creatures beside it Grabbed."] };
}

// A choice PF2e already holds as the ability's own toggle (2026-10-13, batch 274): a RollOption with suboptions on the item (Ablative Adaptation's
// material, Shifting Runes' energy) → a way for each, setting the toggle; a reaction's trigger the GM's call. Last of all: only when nothing else
// reads it. (Batch 275: two toggles or more, Choose Weakness's damage and resistance — a group each, every group in turn, one way from each.)
// null otherwise.
function ownToggle(item) {
    const type = item.system?.actionType?.value;
    if (!["action", "reaction", "free"].includes(type)) return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const actions = Number(item.system?.actions?.value) || 1;
    const split = /^(?:Frequency [^.]+?\.? )?Trigger (.+?)[;.]?(?: Requirements? [^.]+?\.?)? Effects? (.+)$/.exec(plain);
    // (Not an activity whose toggle is only a part: a maneuver it attempts, a check, a teleport or a Stride, a reroll, a weapon it conjures, a Strike
    // with more to it. A plain Strike after the choice is the creature's, from its sheet: a note.)
    const raw = String(item.system?.description?.value ?? "");
    if (/\battempts? to (?:\[\[\/act (?:disarm|grapple|shove|trip|reposition|feint|demoralize)\b|@UUID\[[^\]]*actionspf2e[^\]]*\]\{(?:Disarm|Grapple|Shove|Trip|Reposition|Feint|Demoralize)\})|@Check\[|\bteleports?\b|\bStrides?\b|\brerolls?\b|\bappears?\b|\bpulls out\b|\bwith the following additional effects\b|\bincreasing (?:its|their|his|her) reach\b/i.test(raw)) return null;
    const strikes = /\bmakes? an? [\w' -]*?Strike\b/i.test(plain);
    // (A "none" suboption, the toggle's resting state, isn't a way.)
    const toggles = (item.system?.rules ?? []).filter((rule) => rule?.key === "RollOption" && rule.toggleable && rule.option && Array.isArray(rule.suboptions) && rule.suboptions.every((entry) => typeof entry?.value === "string" && entry.value))
        .map((rule) => ({ ...rule, suboptions: rule.suboptions.filter((entry) => entry.value !== "none") })).filter((rule) => rule.suboptions.length > 1);
    if (!toggles.length) return null;
    const words = (value) => value.split("-").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
    const group = (toggle) => words(toggle.option.replace(new RegExp(`^${String(item.system?.slug ?? item.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-?`), "") || toggle.option);
    const modes = toggles.flatMap((toggle) => toggle.suboptions.map((entry) => ({ name: toggles.length > 1 ? `${group(toggle)}: ${words(entry.value)}` : words(entry.value), ...(toggles.length > 1 ? { group: toggle.option } : {}), plan: { builtin: "roll-option", option: toggle.option, suboption: entry.value, label: words(entry.value) } })));
    const notes = [...(split ? [`Its trigger, the GM's call: ${split[1].trim().replace(/\.?$/, ".")}`] : []), ...(toggles.length > 1 ? ["One from each group."] : []), ...(strikes ? ["Then its Strike, from its sheet: PF2e adds what the choice gives."] : [])];
    return { builtin: "modes", actions: ["reaction", "free"].includes(type) ? 0 : actions, ...(toggles.length > 1 ? { all: true } : {}), modes, ...(notes.length ? { notes } : {}) };
}

// Troop one-offs (2026-10-12, batch 263). null otherwise:
// - "The troop chooses a number of creatures equal to the number of its remaining segments within 60 feet. Each target must attempt a … save." (Bad
//   Deal) → read as up to four creatures (a troop's segments when whole), fewer as it loses segments a note;
// - "This volley is either a 15-foot burst within 200 feet that deals 4d8 piercing damage or a 10-foot burst within 100 feet that deals 6d8 piercing
//   damage. Either effect has a … basic save." (Rain of Arrows) → two ways, each its basic save.
function troopAbility(item, actor, options = {}) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const counted = /\b(?:chooses|targets) a number of (creatures|enemies|foes) equal to (?:the number of )?(?:its|their) remaining segments\b/i;
    if (counted.test(html)) {
        let plan = null;
        try {
            plan = compileMonsterAbility(withDescription(item, html.replace(counted, (_all, who) => `chooses up to four ${who}`)), options);
        } catch {
            plan = null;
        }
        if (!plan?.resolution) return null;
        return { ...plan, notes: [...(plan.notes ?? []), "As many creatures as it has segments left (four when whole)."] };
    }
    const plain = htmlToPlainText(html).replace(/\s+/g, " ").trim();
    const either = /^(?:[^@]+?\. )?(?:This|The) [\w' -]+? is either (an? @Template\[[^\]]*\](?: within \d+ feet)?) that deals (@Damage\[(?:[^[\]]|\[[^\]]*\])*\]) damage or (an? @Template\[[^\]]*\](?: within \d+ feet)?) that deals (@Damage\[(?:[^[\]]|\[[^\]]*\])*\]) damage\. Either effect has an? (@Check\[[^\]]*\]) save\.((?: [^.]+\.)*)$/i.exec(plain);
    if (!either) return null;
    const way = (area, damage, name) => {
        let plan = null;
        try {
            plan = inlineSave(withDescription(item, `<p>The volley deals ${damage} damage in ${area} (${either[5]} save).</p>`), actor);
        } catch {
            plan = null;
        }
        return plan?.resolution ? { name, plan } : null;
    };
    const ways = [way(either[1], either[2], "Wider"), way(either[3], either[4], "Closer")];
    if (ways.some((entry) => !entry)) return null;
    return { builtin: "modes", actions: Number(item.system?.actions?.value) || 1, modes: ways, ...(either[6].trim() ? { notes: [either[6].trim().replace(/@Template\[[^\]]*\](?:\{([^}]*)\})?/g, (_all, label) => label ?? "area")] } : {}) };
}

// A creature it holds, more (2026-10-12, batch 263). null otherwise:
// - "The giant ant army swarms over a Large or larger creature that it has Grabbed, pinning the creature in place and causing it to become Restrained
//   until the start of the giant ant army's next turn or until it Escapes. A creature that begins its turn restrained by the army is … automatically
//   taking 2d6 piercing damage and suffering the effects of giant ant venom." (Overwhelm) → Restrained until its next turn on the creature it holds;
//   the stings each turn, a note;
// - "Requirements The demom has a creature Grabbed. Effect The demom embraces the creature …, restoring 10 Hit Points to the creature." (There, There)
//   → that healing on the creature it holds.
function heldMore(item) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const plain = htmlToPlainText(html.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g, "@D")).replace(/\s+/g, " ").trim();
    const held = { target: "the creature it holds", range: "touch", area: null, grabbed: true };
    const pinned = /^(?:The )?[^.]+? swarms over an? ((?:Tiny|Small|Medium|Large|Huge) or (?:larger|smaller)) creature that it has Grabbed, pinning the creature in place and causing it to become Restrained until the start of (?:the [\w' -]+?['’]s|its) next turn or until it Escapes\.((?: [^.]+\.)*)$/i.exec(plain);
    if (pinned) {
        const success = { damage: none().damage, effects: [{ kind: "condition", slug: "restrained", value: null, duration: { mode: "fixed", value: 1, unit: "rounds", expiry: "turn-start", anchor: "effect-start" } }] };
        const rest = pinned[2].trim().replace(/@D/g, () => readableText(`@Damage[${inlineTags(html, "Damage")[0] ?? ""}]`));
        return { ...base(item), targeting: held, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success, failure: none(), criticalFailure: none() } }, notes: [`Only a ${pinned[1].toLowerCase()} creature.`, ...(rest ? [rest] : [])] };
    }
    // (Submission Lock: "… attempts an Athletics check to Grapple a creature they have grabbed or restrained, also adding 4d10+12 void damage, depending
    // on the result. Critical Success The creature takes double damage. If it's already enfeebled, it falls Unconscious. If not, it is Enfeebled 2 until
    // the end of its next turn and Enfeebled 1 for 1 minute. Success The creature takes full damage and is enfeebled 1 until the end of its next turn."
    // — PF2e's Grapple with that damage and those conditions; Unconscious for one already enfeebled, and the minute after, notes.)
    const lock = /^Requirements? (?:The )?[\w' -]+? has a creature Grabbed or Restrained\.? Effect (?:[^@]+?\. )?(?:The )?[\w' -]+? attempts an Athletics check to Grapple a creature (?:they|it) (?:have|has) grabbed or restrained, also adding @D damage, depending on the result\. Critical Success The creature takes double damage\. If it's already enfeebled, it falls Unconscious\. If not, it is Enfeebled (\d) until the end of its next turn and Enfeebled (\d) for 1 minute\. Success The creature takes full damage and is enfeebled (\d) until the end of its next turn\.$/i.exec(plain);
    const lockDamage = lock ? inlineTags(html, "Damage").map(readDamage) : [];
    if (lock && lockDamage.length === 1) {
        const untilNext = readDuration("until the end of its next turn");
        const shared = (multiplier) => ({ mode: "shared", multiplier, sourceComponentIds: ["0"] });
        const outcomes = {
            criticalSuccess: { damage: shared(2), effects: [{ kind: "condition", slug: "restrained", value: null, duration: null }, { kind: "condition", slug: "enfeebled", value: Number(lock[1]), duration: untilNext }] },
            success: { damage: shared(1), effects: [{ kind: "condition", slug: "grabbed", value: null, duration: null }, { kind: "condition", slug: "enfeebled", value: Number(lock[3]), duration: untilNext }] },
            failure: { ...none(), effects: [{ kind: "end-condition", slugs: ["grabbed", "restrained"] }] },
            criticalFailure: { ...none(), effects: [{ kind: "end-condition", slugs: ["grabbed", "restrained"] }] }
        };
        return { ...base(item), targeting: held, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "skill", statistic: "athletics", against: { dc: "target", statistic: "fortitude" } }, sharedDamage: { rollOnce: true, components: [{ id: "0", formula: lockDamage[0] }] }, outcomes }, notes: [`On a critical success, a creature already enfeebled falls Unconscious instead; otherwise it's also Enfeebled ${lock[2]} for 1 minute after.`, "On a critical failure, the creature can grab it or knock it Prone (PF2e's Grapple)."] };
    }
    const soothed = /^Requirements? (?:The )?[\w' -]+? has a creature Grabbed\.? Effect (?:The )?[^.]+?, restoring @D Hit Points to the creature\.$/i.test(plain);
    const tags = inlineTags(html, "Damage");
    if (soothed && tags.length === 1 && /\bhealing\b/i.test(tags[0])) {
        const formula = readDamage(tags[0]).replace(/\[healing\]/i, "").replace(/^\((.*)\)$/, "$1");
        return { ...base(item), targeting: held, trigger: { event: "use" }, resolution: { kind: "healing", native: { healing: { components: [{ id: "0", formula, kinds: ["healing"] }], recipients: "any" } } } };
    }
    return null;
}

// A retreat when hurt (2026-10-12, batch 259, Detach): "Requirements The mammoth land star falls below half its total Hit Points Effect The
// mammoth land star severs one of its own limbs as a distraction, then Strides three times. This movement doesn't trigger reactions." → a move
// that triggers no reactions; when it may, a note. null otherwise.
function hurtRetreat(item) {
    if (item.system?.actionType?.value !== "action") return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const match = /^Requirements? (?:The )?[\w' -]+? (?:falls|is) below half (?:its|their) (?:total |maximum )?Hit Points Effect (?:The )?[^.]+?, then Strides (twice|three times)\. This movement (?:doesn't|does not) trigger reactions\.$/i.exec(plain);
    if (match) return { builtin: "safe-move", actions: Number(item.system?.actions?.value) || 1, notes: ["Only once it's below half its Hit Points."] };
    // (Batch 260, Plane-Hopper Dash: "Frequency once per day Effect The jotunborn sage moves with swiftness between planar boundaries to shorten their
    // journey. The sage Strides; this movement doesn't trigger reactions. Once the Stride is complete, the sage gains a +5-status bonus to their Speed
    // until the start of their next turn." — a move that triggers no reactions; the Speed after it, a note.)
    const dash = /^(?:Frequency [^.]+? Effect )?(?:(?:The )?[^.]+?\. )?(?:The )?[\w' -]+? Strides; this movement (?:doesn't|does not) trigger reactions\. Once the Stride is complete, (?:the [\w' -]+?|it|they) gains? an? \+(\d+)[- ]status bonus to (?:its|their) Speed until the start of (?:its|their) next turn\.$/i.exec(plain);
    if (dash) return { builtin: "safe-move", actions: Number(item.system?.actions?.value) || 1, notes: [`Then a +${dash[1]} status bonus to its Speed until the start of its next turn.`] };
    // (Batch 263, Group Scamper: "The kobolds Stride up to their Speed plus 5 feet and gain a +2 circumstance bonus to AC against reactions triggered by
    // this movement. If they end this movement with at least 1 segment adjacent to any enemy, the squad is Off-Guard until the beginning of its next
    // turn." — a move reactions hardly touch; the Off-Guard after, a note.)
    const scamper = /^(?:Frequency [^.]+? Effect )?(?:The )?[\w' -]+? Strides? up to (?:its|their) Speed(?: plus 5 feet)? and gains? a \+2 circumstance bonus to AC against reactions triggered by this movement\. If (?:they|it) ends? this movement with at least 1 segment adjacent to any enemy, the [\w' -]+? is Off-Guard until the (?:beginning|start) of its next turn\.$/i.test(plain);
    return scamper ? { builtin: "safe-move", actions: Number(item.system?.actions?.value) || 1, notes: ["If it ends this move with a segment beside an enemy, it's Off-Guard until the start of its next turn."] } : null;
}

// A condition with no roll on a creature beside it until it clears it (2026-10-12, batch 260, Spice Mix): "The head chef throws a mixture of
// irritating spices into an adjacent creature's eyes, causing the creature to be Dazzled until it Interacts to clear its vision." → that condition
// with no end of its own; the Interact a note. null otherwise.
function eyesCondition(item) {
    if (item.system?.actionType?.value !== "action") return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const match = /^(?:The )?[^.]+? (?:throws|flings|blows|sprays|tosses) [^.]+? into an adjacent creature['’]s eyes, causing (?:the creature|it) to be (Dazzled|Blinded) until it Interacts to (?:clear|wipe) its (?:vision|eyes)\.$/i.exec(plain);
    if (!match) return null;
    const success = { damage: none().damage, effects: [{ kind: "condition", slug: match[1].toLowerCase(), value: null, duration: null }] };
    return {
        ...base(item),
        targeting: { target: "1 creature", range: "touch", area: null },
        trigger: { event: "use" },
        resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success, failure: none(), criticalFailure: none() } },
        notes: [`It lasts until the creature uses an Interact action to clear its eyes.`]
    };
}

// Damage to a creature that's down (2026-10-12, batch 260, Kiss of Death): "The catrina gives a long, passionate kiss to an Unconscious or willing
// creature, dealing @Damage[3d6[void]] damage. Any creature damaged by the same catrina's Kiss of Death for 3 consecutive rounds becomes unconscious
// and is dying 1." → that damage with no roll on a creature beside it; who it may be, a requirement the simulator doesn't plan; the rest a note.
// null otherwise.
function downedDamage(item) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const plain = htmlToPlainText(html.replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g, "@D").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const match = /^(?:The )?[^.]+? (?:gives|delivers) [^.]+? to an Unconscious or willing creature, dealing @D damage\.((?: [^.@]+\.)*)$/i.exec(plain);
    const formulas = inlineTags(html, "Damage").map(readDamage);
    if (!match || formulas.length !== 1) return null;
    const success = { damage: { mode: "formulas", formulas: formulas.map((formula) => ({ formula })), rollScope: "outcome" }, effects: [] };
    return {
        ...base(item),
        targeting: { target: "1 creature", range: "touch", area: null },
        trigger: { event: "use" },
        resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success, failure: none(), criticalFailure: none() } },
        requires: "requirement",
        notes: ["Only at an Unconscious or willing creature.", ...(match[1].trim() ? match[1].trim().split(/(?<=\.)\s+/) : [])]
    };
}

// A zone of its own used on a trigger, once or more (Master of Clouds: "Trigger The dragon rolls initiative Effect … The dragon uses Dragonmist
// twice."): that zone's plan, with the trigger and how many (times). Words before it with no rolls in them are flavour. null otherwise.
function zoneOnTrigger(item, actor, options) {
    const type = item.system?.actionType?.value;
    if (!["reaction", "free"].includes(type)) return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const split = /^Trigger (.+?)[;.]? Effect (.+)$/.exec(plain);
    const trigger = split ? readReactionTrigger(split[1].trim()) : null;
    if (!trigger) return null;
    const said = split[2].trim().split(/(?<=\.)\s+(?=[A-Z])/);
    const uses = /^(?:The )?[\w' -]+? uses (?:its |their |his |her )?([A-Z][\w'-]*(?: [A-Z][\w'-]*)*)(?: (twice|three times|four times|five times))?\.$/.exec(said.at(-1) ?? "");
    if (!uses || said.slice(0, -1).some((sentence) => /@|\[\[/.test(sentence))) return null;
    const owner = actor ?? item.actor ?? item.parent;
    const other = (owner?.items?.contents ?? owner?.items ?? []).find((entry) => entry !== item && String(entry.name ?? "").toLowerCase() === uses[1].toLowerCase());
    if (!other) return null;
    let plan = null;
    try {
        plan = compileMonsterAbility(other, { ...options, actor: owner });
    } catch {
        plan = null;
    }
    if (plan?.builtin !== "zone") return null;
    const times = { twice: 2, "three times": 3, "four times": 4, "five times": 5 }[uses[2] ?? ""] ?? 1;
    return { ...plan, actions: 0, trigger: { ...trigger, reaction: true, ...(type === "free" ? { free: true } : {}) }, ...(times > 1 ? { times } : {}) };
}

// One of two spells (2026-10-12, batch 249, Change Size): "This works as a 4th-rank Enlarge or Shrink spell but can target an unwilling creature
// (… Fortitude save negates)." → { builtin: "modes" }: each spell's cast at that rank (castSpell), an unwilling target's save a note. null otherwise.
function eitherSpell(item, actor) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const match = /\bThis works as an? (\d+)(?:st|nd|rd|th)-rank (@UUID\[[^\]]+\]\{[^}]+\}) or (@UUID\[[^\]]+\]\{[^}]+\}) spell but can target an unwilling creature \(@Check\[(?:type:)?(fortitude|reflex|will)\|dc:(\d+)[^\]]*\](?:\{[^}]*\})? save negates\)\./i.exec(html);
    if (!match) return null;
    const [, rank, first, second, statistic, dc] = match;
    const way = (link) => {
        const plan = castSpell(withDescription(item, `<p>This works as a ${rank}th-rank ${link} spell.</p>`), actor);
        if (plan?.builtin !== "cast-spell") return null;
        const name = /\{([^}]+)\}$/.exec(link)[1];
        return { name, plan: { ...plan, dc: Number(dc), notes: [...(plan.notes ?? []), `It can target an unwilling creature: a DC ${dc} ${statistic[0].toUpperCase()}${statistic.slice(1)} save negates.`] } };
    };
    const modes = [way(first), way(second)];
    return modes.every(Boolean) ? { builtin: "modes", actions: Number(item.system?.actions?.value) || 1, modes } : null;
}

// A Stride, then one of two maneuvers at many (2026-10-12, batch 241, Thunder of Hooves): "Strides. At the end of their movement, the cavalry
// can either attempt an Athletics check to Trip each adjacent enemy or an Intimidation check to Demoralize each enemy within 30 feet. Roll only
// once and compare …" → { builtin: "modes" }: each way PF2e's maneuver at the foes in that emanation (variedManeuver), the Stride a note.
// null otherwise.
function strideThenEither(item, basicActions = {}) {
    if (item.system?.actionType?.value !== "action") return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/\[\[\/act (\w+)[^\]]*\]\](?:\{([^}]*)\})?/g, (_all, slug, label) => label ?? slug.replace(/^\w/, (letter) => letter.toUpperCase()))).replace(/\s+/g, " ").trim();
    const WAY = String.raw`an? (Athletics|Intimidation) check to (Trip|Shove|Demoralize|Grapple) (each adjacent enemy|each enemy within \d+ feet)`;
    const either = new RegExp(String.raw`^(?:Frequency once per (?:round|turn) Effect )?((?:The )?[\w' -]+?) Strides\. At the end of (?:its|their|his|her) movement, (?:the [\w' -]+?|it|they|he|she) can either attempt ${WAY} or ${WAY}\. Roll only once and compare the result to each enemy['’]s (?:Reflex|Fortitude|Will) DC \(for \w+\) or (?:Reflex|Fortitude|Will) DC \(for \w+\)\.$`, "i").exec(plain);
    if (!either) return null;
    const way = (skill, act, whom) => {
        const within = /\bwithin (\d+) feet\b/i.exec(whom)?.[1] ?? "5";
        const plan = variedManeuver(withDescription(item, `<p>${either[1]} attempts an ${skill} check to ${act} each enemy within ${within} feet.</p>`), basicActions);
        if (!plan?.targeting?.area) return null;
        plan.targeting.area = { ...plan.targeting.area, foes: true };
        return { name: act, plan: { ...plan, notes: ["It Strides first; one roll for every enemy.", ...(plan.notes ?? [])] } };
    };
    const modes = [way(either[2], either[3], either[4]), way(either[5], either[6], either[7])];
    if (modes.some((mode) => !mode)) return null;
    return { builtin: "modes", actions: Number(item.system?.actions?.value) || 1, modes };
}

// A move and then a basic maneuver (2026-10-12, batch 134): "The gurgist Strides twice and then attempts to Grapple a creature. On a success, the
// target is also knocked Prone.", Bushwhack's "Strides up to 10 feet and attempts to Grapple a creature they're Undetected by. If they succeed,
// they also deal fist damage to that creature.", Startling Grasp's "… the creature is Frightened 1, or Frightened 2 if the bugbear critically
// succeeds …", Mosh's "Leaps to a square adjacent to a creature, then Shoves that creature. If Gulzash rolls a success on the Shove, he gets a
// critical success instead.", Sliding Earth's "Strides up to twice its normal Speed in a straight line, then attempts to Trip a creature in its
// reach. If a creature falls Prone from this Trip, it takes 1d4 … for every 10 feet …" (that damage the GM's) → PF2e's maneuver with what its
// successes add, approach: { strides } (the move first), a note for the move; at an unseen creature only: a requirement.
function maneuverAfterMove(item, actor, basicActions = {}) {
    if (item.system?.actionType?.value !== "action") return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/\[\[\/act (\w+)[^\]]*\]\](?:\{([^}]*)\})?/g, (_all, slug, label) => label ?? slug.replace(/^\w/, (letter) => letter.toUpperCase())).replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim().replace(/(Grapple|Trip|Shove): Athletics\b/g, "$1");
    // (Batch 135: Advancing Flourish's "Strides twice. If they end their movement within melee reach of an enemy, they can Feint."; Deceptive
    // Reposition's "Strides up to half their Speed and attempts a Feint, in either order"; Aggressive Rush's "moves up to half its Speed. This
    // movement doesn't trigger reactions. At the end of the movement, it attempts an Intimidation check to Demoralize a target within 5 feet of
    // it."; Stop in the Name of the Law!'s "Strides twice and then Demoralizes".)
    const extra = [];
    let raised = false;
    const told = plain
        .replace(/^((?:The )?[\w' -]+? Strides twice)\. If (?:they|he|she|it) ends? (?:their|his|her|its) movement within melee reach of an enemy, (?:they|he|she|it) can (Feint|Demoralize)\./i, "$1 and then attempts to $2 a creature.")
        .replace(/^((?:The )?[\w' -]+? Strides up to half (?:its|their|his|her) Speed) and attempts a (Feint), in either order\./i, (_all, moves, act) => {
            extra.push("It can Feint first and Stride after.");
            return `${moves} and then attempts to ${act} a creature.`;
        })
        .replace(/^((?:The )?[\w' -]+?) moves up to half (its|their|his|her) Speed\. This movement (?:doesn't|does not) trigger reactions\. At the end of the movement, (?:it|they|he|she) attempts an Intimidation check to Demoralize a target within 5 feet of (?:it|them|him|her)\./i, (_all, who, owner) => {
            extra.push("This movement doesn't trigger reactions.");
            return `${who} Strides up to half ${owner} Speed and then attempts to Demoralize a creature.`;
        })
        .replace(/^((?:The )?[\w' -]+? Strides twice) and then Demoralizes\./i, "$1 and then attempts to Demoralize a creature.")
        // (Batch 151, Sudden Rush: "Frequency once per round Effect The blue-scarf heavy strides up to 10 feet and attempts an Athletics check to
        // Grapple a creature.")
        .replace(/^Frequency once per (?:round|turn) Effect /i, "")
        .replace(/^((?:The )?[\w' -]+?) strides up to (\d+) feet and attempts an Athletics check to (Grapple|Trip|Shove) a creature\./, "$1 Strides up to $2 feet and attempts to $3 a creature.")
        // (Batch 141: Into the Fray's "Strides then Demoralizes an adjacent Medium or smaller creature" — one Stride, the size a note; Shielded
        // Advance's "Requirements … has their shield raised Effect … presses forward, using their shield to push back foes. The captain Strides
        // and Shoves, in either order." — the raised shield the GM's.)
        .replace(/^((?:The )?[\w' -]+?) Strides then (Demoralizes|Trips|Shoves) an adjacent (Small|Medium|Large) or smaller creature\./i, (_all, who, act, size) => {
            extra.push(`Only at a ${size} or smaller creature.`);
            return `${who} Strides once and then attempts to ${act.replace(/s$/, "")} a creature.`;
        })
        .replace(/^Requirements? (?:The )?[\w' -]+? has (?:its|their|his|her) shield raised Effect (?:[^.]+\. )?((?:The )?[\w' -]+?) Strides and Shoves, in either order\./i, (_all, who) => {
            extra.push("Only with its shield raised; it can Shove first and Stride after.");
            raised = true;
            return `${who} Strides once and then attempts to Shove a creature.`;
        });
    const sentences = told.split(/(?<=\.)\s+(?=[A-Z])/);
    const first = /^(?:The )?[\w' -]+? (Strides twice|Strides once|Strides up to (?:10|15|20) feet|Strides up to (?:twice|half) (?:its|their|his|her) (?:normal )?Speed(?: in a straight line)?|Leaps to a square adjacent to a creature),? (?:and )?(?:then )?(?:attempts to (Grapple|Trip|Shove|Feint|Demoralize) a creature(?: in its reach)?( that can't see them and doesn't know where they are| (?:they're|she's|he's|it's) [Uu]ndetected by)?|(Shoves) that creature)\.$/i.exec(sentences[0] ?? "");
    if (!first) return null;
    const slug = (first[2] ?? first[4]).toLowerCase().replace(/^shoves$/, "shove");
    const basic = basicActions[slug];
    if (!basic?.resolution?.outcomes) return null;
    const plan = structuredClone(basic);
    const rows = plan.resolution.outcomes;
    const strides = /twice/i.test(first[1]) ? 2 : 1;
    // (How far, when less than a Stride: "up to 10 feet"; "up to half its Speed".)
    const short = /up to (\d+) feet/i.exec(first[1])?.[1] ? { feet: Number(/up to (\d+) feet/i.exec(first[1])[1]) } : /\bhalf\b/i.test(first[1]) ? { half: true } : {};
    const notes = [`It ${/^Leaps/i.test(first[1]) ? "Leaps beside the creature" : `${first[1].replace(/^Strides/i, "Strides")}`} first: move its token.`, ...extra];
    for (const sentence of sentences.slice(1)) {
        if (/^On a success, the target is also knocked Prone\.$/i.test(sentence)) {
            for (const degree of ["success", "criticalSuccess"]) rows[degree].effects = [...rows[degree].effects, { kind: "condition", slug: "prone", value: null, duration: null }];
            continue;
        }
        if (/^If (?:the [\w' -]+?|they|she|he|it) succeeds?, (?:they|she|he|it) also deals? (?:damage from (?:their|its|his|her) )?fist(?: Strike)? damage to that creature\.$/i.test(sentence)) {
            const fist = (actor?.items ?? []).find?.((entry) => entry.type === "melee" && /^fist$/i.test(entry.name));
            const roll = fist ? Object.values(fist.system?.damageRolls ?? {})[0] : null;
            if (!roll?.damage) return null;
            const formula = { formula: `(${roll.damage})[${roll.damageType ?? "bludgeoning"}]` };
            for (const degree of ["success", "criticalSuccess"]) rows[degree].damage = rows[degree].damage?.mode === "formulas" ? { ...rows[degree].damage, formulas: [...rows[degree].damage.formulas, formula] } : { mode: "formulas", formulas: [formula], rollScope: "target" };
            continue;
        }
        const scared = /^If (?:they|she|he|it) succeeds?, the creature is Frightened (\d), or Frightened (\d) if (?:the [\w' -]+?|they|she|he|it) critically succeeds at (?:their|its|his|her) Athletics check to (?:Grapple|Trip|Shove)\.$/i.exec(sentence);
        if (scared) {
            rows.success.effects = [...rows.success.effects, { kind: "condition", slug: "frightened", value: Number(scared[1]), duration: null }];
            rows.criticalSuccess.effects = [...rows.criticalSuccess.effects, { kind: "condition", slug: "frightened", value: Number(scared[2]), duration: null }];
            continue;
        }
        if (/^If (?:the [\w' -]+?|[A-Z][\w'-]+) rolls a success on the Shove, (?:he|she|it|they) gets? a critical success instead\.$/i.test(sentence)) {
            rows.success = structuredClone(rows.criticalSuccess);
            continue;
        }
        // (Aggressive Rush: no language penalty — the module has none; Stop in the Name of the Law!: Slowed as much as it's Frightened, while it is.)
        if (/^This Intimidation check (?:doesn't|does not) take the [-\u2013]4 circumstance penalty for [^.]+? not speaking a language\.$/i.test(sentence)) continue;
        // (Into the Fray: "When it does, Demoralize loses the auditory trait and gains the visual trait, and it doesn't take a penalty for the veteran
        // war horse not speaking a language." — the GM's.)
        if (slug === "demoralize" && /^When it does, Demoralize loses the auditory trait and gains the visual trait, and it (?:doesn't|does not) take a penalty for [^.]+? not speaking a language\.$/i.test(sentence)) {
            notes.push("Demoralize is visual here, not auditory, with no penalty for language.");
            continue;
        }
        // (Shielded Advance: "The multiple attack penalty doesn't apply to this Shove, though the Shove does count toward the captain's multiple attack
        // penalty.")
        if (slug === "shove" && /^The multiple attack penalty (?:doesn't|does not) apply to this Shove, though the Shove does count toward [^.]+? multiple attack penalty\.$/i.test(sentence)) {
            notes.push("The Shove ignores its multiple attack penalty, but counts toward it.");
            continue;
        }
        if (slug === "demoralize" && /^On a success, the target is Slowed with a value equal to its Frightened value until it is no longer frightened\.$/i.test(sentence)) {
            for (const degree of ["success", "criticalSuccess"]) {
                const fear = rows[degree].effects.find((effect) => effect.slug === "frightened");
                if (fear) rows[degree].effects = [...rows[degree].effects, { kind: "condition", slug: "slowed", value: fear.value, duration: null }];
            }
            notes.push("The Slowed lasts until it's no longer frightened.");
            continue;
        }
        if (/^If a creature falls Prone from this Trip, it takes @?[^.]*? damage for every 10 feet the [\w' -]+? moved\.$/i.test(sentence)) {
            notes.push(readableText(sentence));
            continue;
        }
        return null;
    }
    const unseen = Boolean(first[3]);
    if (unseen) notes.push("Only at a creature it's undetected by.");
    return { ...plan, ...base(item, { traits: [...new Set([...(item.system?.traits?.value ?? []), ...(plan.traits ?? [])])] }), targeting: { ...plan.targeting, target: "1 creature", range: "touch" }, approach: { strides, ...short }, notes, ...(unseen || raised ? { requires: "requirement" } : {}) };
}

// A Grapple as a reaction to damage of a type (2026-10-12, batch 132, Electric Reflexes): "Trigger The golem takes electricity damage and a
// creature is adjacent to it" (or "would be affected by an effect with the electricity trait and a creature is in its reach") "Effect The golem
// lashes out and tries to grab a nearby creature. The golem attempts an Athletics check to Grapple an adjacent creature. The creature also takes
// 3d6 electricity damage on a success, or 6d6 electricity damage on a critical success." → PF2e's Grapple with that damage on its successes,
// set off by that damage, at a creature beside it.
function damagedManeuver(item, basicActions = {}) {
    if (item.system?.actionType?.value !== "reaction") return null;
    const html = String(item.system?.description?.value ?? "").replace(/\[\[\/act (\w+)[^\]]*\]\](?:\{([^}]*)\})?/g, (_all, slug, label) => label ?? slug.replace(/^\w/, (letter) => letter.toUpperCase()));
    const plain = htmlToPlainText(html.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const parts = /^Trigger (.+?)\.? Effect (.+)$/.exec(plain);
    const type = parts ? /^(?:The )?[\w' -]+? (?:takes (\w+) damage|would be affected by an effect with the (\w+) trait) and a creature is (?:adjacent to it|in its reach)$/i.exec(parts[1].trim()) : null;
    if (!type) return null;
    const sentences = parts[2].split(/(?<=\.)\s+(?=[A-Z])/);
    if (sentences.length && /^(?:The )?[\w' -]+? lashes out and tries to grab a nearby creature\.$/i.test(sentences[0])) sentences.shift();
    if (!/^(?:The )?[\w' -]+? attempts an Athletics check to Grapple (?:an adjacent creature|a creature within reach)\.$/i.test(sentences[0] ?? "")) return null;
    const damage = /^The creature also takes (@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?) damage on a success, or (@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?) damage on a critical success\.$/i.exec(sentences[1] ?? "");
    if (!damage || sentences.length > 2 || !basicActions.grapple?.resolution) return null;
    const plan = structuredClone(basicActions.grapple);
    const formula = (tag) => ({ formula: readDamage(inlineTags(tag, "Damage")[0]) });
    const add = (row, entry) => ({ ...row, damage: row.damage?.mode === "formulas" ? { ...row.damage, formulas: [...row.damage.formulas, entry] } : { mode: "formulas", formulas: [entry], rollScope: "target" } });
    plan.resolution.outcomes.success = add(plan.resolution.outcomes.success, formula(damage[1]));
    plan.resolution.outcomes.criticalSuccess = add(plan.resolution.outcomes.criticalSuccess, formula(damage[2]));
    const damageType = (type[1] ?? type[2]).toLowerCase();
    return { ...plan, ...base(item, { traits: [...new Set([...(item.system?.traits?.value ?? []), ...(plan.traits ?? [])])] }), targeting: { ...plan.targeting, target: "an adjacent creature", range: "touch" }, trigger: { event: "damaged", reaction: true, damageTypes: [damageType] } };
}

// A Strike at a creature that moves (or acts) in its reach, Reactive Strike's kin in its own words (2026-10-11, batch 68): "Trigger A
// creature within reach of Racharak's tail uses a move action or leaves a square during a move action it's using. Effect Racharak makes a
// tail Strike at the creature with a -2 penalty. If it hits, she disrupts the creature's action.", Gripping Tentacle's "… against the
// target. If the attack is a critical hit and the trigger was a move action, the grick disrupts that action.", Twisting Tail's "Strikes
// the target with its stinger", Lash Out's "… against the attacker", Snap Shot's "This Strike doesn't contribute to his multiple attack
// penalty, …" → { builtin: "reaction-strike", triggers (the provoke trigger's: move, ranged, manipulate, concentrate; "leave" a move,
// "enter" an approach), strike, penalty, disrupts (true on a hit, "critical" on a critical hit) }. A first sentence that only tells it.
function provokedStrike(item) {
    if (item.system?.actionType?.value !== "reaction") return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const parts = /^(?:Requirements? .+? )?Trigger (.+?)\.? (?:Requirements? .+? )?Effect (.+)$/.exec(plain);
    const trigger = parts ? readReactionTrigger(parts[1]) : null;
    if (trigger?.event !== "provoke") return null;
    // (Batch 227, Battlezoo: on a hit the action is lost unless the creature passes a save — disruptSave.)
    let disruptSave = null;
    const effect = parts[2].replace(/; on a hit, (?:the target loses the triggering action|the triggering action is lost) unless (?:it|they) (?:succeeds? at|pass(?:es)?) an? (?:@Check\[(?:type:)?(fortitude|reflex|will)\|dc:(\d+)[^\]]*\](?:\{[^}]*\})?|DC (\d+) (Fortitude|Reflex|Will)) sav(?:e|ing throw)\./i, (_all, save, dc, dc2, save2) => {
        disruptSave = { statistic: (save ?? save2).toLowerCase(), dc: Number(dc ?? dc2) };
        return ".";
    });
    const told = effect.split(/(?<=\.)\s+(?=[A-Z])/);
    // (Its capitalised words: "strikes out when the foe tries to flee" only tells it.)
    const sentences = told.length > 1 && !/\b(?:Strikes?|Trip|Grapple)\b/.test(told[0]) && !/\b(?:check|damage|save|disrupt\w*)\b/i.test(told[0]) ? told.slice(1) : told;
    const who = String.raw`(?:the (?:triggering )?creature|the target|the attacker|it|that creature)`;
    const first = sentences[0] ?? "";
    const struck = new RegExp(String.raw`^(?:The )?[^.]+? (?:makes?|attempts?) an? ([\w' -]+?) Strike (?:at|against) ${who}(?: with an? [–-](\d+) penalty)?\.$`, "i").exec(first)
        ?? new RegExp(String.raw`^(?:The )?[^.]+? Strikes ${who} with (?:its|their|his|her) ([\w' -]+?)\.$`, "i").exec(first)
        ?? (new RegExp(String.raw`^(?:The )?[^.]+? Strikes ${who}\.$`, "i").test(first) ? [first, "melee"] : null)
        // (Batch 242, Lurking Death: "… teleports to a square adjacent to the triggering creature and makes a melee Strike against it." — teleport.)
        ?? (new RegExp(String.raw`^(?:The )?[^.]+? teleports to a square adjacent to ${who} and makes a melee Strike against (?:it|them)\.$`, "i").test(first) ? [first, "melee"] : null);
    if (!struck) return null;
    const teleport = /\bteleports to a square adjacent to\b/i.test(first);
    let disrupts = false;
    for (const sentence of sentences.slice(1)) {
        if (/^If (?:it|the Strike|the attack|this attack|the Strike) hits, (?:she|he|it|they|the [\w' -]+?|[A-Z][\w'-]+) disrupts (?:the (?:creature's|triggering) action|that action|the action)\.$|^On a success the target's action is interrupted;/i.test(sentence)) disrupts = true;
        else if (/^If (?:the attack|this attack|the Strike|it) is a critical hit(?: and the trigger was a move action)?, (?:she|he|it|they|the [\w' -]+?|[A-Z][\w'-]+) disrupts? (?:that|the triggering|the) action\.$/i.test(sentence)) disrupts ||= "critical";
        else if (/^This Strike (?:doesn't|does not) contribute to (?:his|her|its|their) multiple attack penalty, and (?:his|her|its|their) multiple attack penalty (?:doesn't|does not) apply to this Strike\.$/i.test(sentence)) continue;
        // (Batch 227, Battlezoo: a hit disrupts it; a critical hit does; the Strike outside its multiple attack penalty.)
        else if (/^On a hit, (?:they|it|he|she|the [\w' -]+?) disrupts? the (?:triggering )?action\.$/i.test(sentence)) disrupts = true;
        else if (/^If the attack is a critical hit, the (?:triggering )?action is disrupted\.$/i.test(sentence)) disrupts ||= "critical";
        else if (/^This (?:Strike|attack|attempt) (?:neither applies nor counts toward|doesn't take or add to) (?:the [\w' -]+?['’]s|its|their) multiple attack penalty\.$/i.test(sentence)) continue;
        // (Batch 225: Disruptive Screech's "This disrupts a triggering concentrate action if the Strike is a critical hit.", Clinch Victory's "On a
        // critical success, this Strike also disrupts the triggering action.")
        else if (/^This disrupts (?:a|the) triggering (?:concentrate )?action if the Strike is a critical hit\.$|^On a critical (?:success|hit), this Strike also disrupts the triggering action\.$/i.test(sentence)) disrupts ||= "critical";
        // (Root In Place's "If the creature was Flying when its action was disrupted, it falls.": the GM's.)
        else if (/^If the creature was Flying when its action was disrupted, it falls\.$/i.test(sentence)) continue;
        else return null;
    }
    const kinds = { leave: "move", enter: "approach" };
    const triggers = [...new Set((trigger.triggers ?? []).map((kind) => kinds[kind] ?? kind))];
    if (!triggers.length) return null;
    // (A distance in feet, Snap Shot's "within 30 feet": live play's, for a ranged Strike.)
    if (teleport && typeof trigger.within !== "number") return null;
    return { builtin: "reaction-strike", triggers, strike: struck[1].toLowerCase(), penalty: Number(struck[2] ?? 0), disrupts: disruptSave ? true : disrupts, ...(disruptSave ? { disruptSave } : {}), ...(typeof trigger.within === "number" ? { within: trigger.within } : {}), ...(teleport ? { teleport: true, note: "It teleports beside the creature first." } : {}) };
}

// You're Next (2026-10-11, batch 52): "Trigger The prisoner reduces a creature to 0 hit points. Effect The prisoner attempts an
// Intimidation check with a +2 circumstance bonus to Demoralize a single creature it can see and that can see them." (also "attempts to
// Demoralize a single creature he can see. He gains a +2 circumstance bonus to this check", "… a creature within 60 feet, with a +2
// circumstance bonus") → PF2e's Demoralize with that bonus, set off by downing a creature (a free action's: free). null otherwise.
function downsDemoralize(item, basicActions) {
    const type = item.system?.actionType?.value;
    if (!["reaction", "free"].includes(type) || !basicActions.demoralize?.resolution) return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\[\[\/act ([\w-]+)[^\]]*\]\](?:\{([^}]*)\})?/g, (_all, slug, label) => label ?? slug.replace(/^\w/, (letter) => letter.toUpperCase()))).replace(/\s+/g, " ").trim();
    // (Batch 178, Battle Cry: "Frequency once per day Trigger Ordulf rolls initiative Effect Ordulf attempts to Demoralize an observed foe." — once a
    // fight, as the fight starts.)
    const parts = /^Trigger (.+?)\.? Effect (.+)$/.exec(plain.replace(/^Frequency once per (?:day|hour|10 minutes|minute)\.? (?=Trigger )/i, ""));
    const trigger = parts ? readReactionTrigger(parts[1]) : null;
    if (trigger?.event === "foe-mishap") {
        // (Batch 57, Jeer at Failure: "Effect The mocking dragon laughs dismissively at the foe, attempting an Intimidation check to
        // Demoralize the creature. They do not take a penalty if the creature doesn't understand their language." → PF2e's Demoralize
        // at the triggering creature.)
        // (Batch 252, a Battlezoo jester dragon's jeer: a Demoralize at the creature that critically missed it, and on a success its fear can't drop
        // below 1 until it hits the dragon or loses track of it — a note.)
        const jeer = /^(?:[^.]+\. )?(?:The )?[^.]+? attempts to Demoralize the triggering creature\. On a success, the triggering creature['’]s frightened condition can['’]t decrease to less than 1 at the end of its turn until it either successfully Strikes (?:the [\w' -]+?|it) or until it doesn['’]t observe or sense (?:the [\w' -]+?|it) for at least 1 round\.$|^(?:The )?[^.]+? tries to Demoralize the creature that missed, whose fear then stays at 1 or more until it lands a Strike on (?:it|the [\w' -]+?)\.$/i.test(parts[2]);
        if (!jeer && !/^(?:The )?[^.]+? laughs dismissively at the foe, attempting an Intimidation check to Demoralize the creature\.(?: (?:It|They|He|She) (?:does|do) not take a penalty if the creature doesn't understand (?:its|their|his|her) language\.)?$/i.test(parts[2])) return null;
        const plan = structuredClone(basicActions.demoralize);
        return { ...plan, ...base(item, { traits: plan.traits }), targeting: { ...plan.targeting, target: "the attacker" }, trigger: { ...trigger, ...(type === "free" ? { free: true } : {}) }, ...(jeer ? { notes: ["On a success, its Frightened can't drop below 1 at the end of its turn until it hits the dragon or loses track of it for a round."] } : {}) };
    }
    // (Batch 72: as the fight starts or its turn begins, "The brass dragon roars out a mighty challenge and attempts to Demoralize a creature it
    // can see", "The director general attempts to Demoralize a creature within 60 feet that they can see and that can see the director
    // general" — at a creature of the GM's, the simulator's nearest foe.)
    if (!["downs", "initiative", "own-turn-start"].includes(trigger?.event)) return null;
    // (A first sentence that only tells it: "After downing the foe, Krosovahn menacingly reminds another foe that he's coming after them next.")
    const effect = parts[2].replace(/^After downing the foe, [^.]+\.\s*/i, "");
    const WHOM = String.raw`(?:a single creature|a creature|one creature|a creature within \d+ feet|an observed (?:foe|enemy|creature))(?: (?:that )?(?:it|he|she|they|xe) can see)?(?: and that can see (?:it|him|her|them|xir|the [\w' -]+?))?`;
    const match = new RegExp(String.raw`^(?:The )?[^.]+? attempts? (?:an Intimidation check (?:with a \+(\d+) circumstance bonus )?to Demoralize ${WHOM}(?:,? with a \+(\d+) circumstance bonus)?|to Demoralize ${WHOM}(?:,? with a \+(\d+) circumstance bonus)?)\.(?: (?:It|He|She|They|Xe) gains? a \+(\d+) circumstance bonus to this check\.)?$`, "i").exec(effect);
    if (!match) return null;
    const bonus = Number(match.slice(1).find(Boolean)) || 0;
    const plan = structuredClone(basicActions.demoralize);
    if (bonus) plan.resolution.check = { ...plan.resolution.check, bonus: { value: bonus, type: "circumstance" } };
    return { ...plan, ...base(item, { traits: plan.traits }), targeting: plan.targeting, trigger: { ...trigger, ...(type === "free" ? { free: true } : {}) } };
}

// A condition whose value grows with each later failure (2026-10-11, batch 74): "If the target fails additional saves against this
// ability, the condition value increases by 1 (or 2 if it critically fails) (to a maximum of stupefied 4)" (Lamia's Caress, Fate Drain,
// Caress Soul's "by 1 if failed, or 2 if critically failed"), "Each time a target fails an additional save against this ability, the
// condition value increases by 1 (to a maximum of Clumsy 4)", "On each subsequent failure, the drained condition value increases by 1 (or
// by 2 on a critical failure), to a maximum of drained 4", "If the creature is already drained, its drained value increases by 1 (to a
// maximum of drained 4)", "If it's already stupefied, its stupefied value increases by 1 instead". → { slug?, by, critical?, max? }, or
// null. Not one that grows two conditions, nor drinking blood's (its healing changes too).
const STACKED_CONDITION = "(clumsy|drained|enfeebled|frightened|sickened|slowed|stupefied|doomed|stunned)";
export function readStack(html) {
    const plain = htmlToPlainText(String(html ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ");
    for (const sentence of plain.split(/(?<=[.)])\s+(?=[A-Z])/)) {
        const said = sentence.trim();
        const max = Number(/\bto a maximum of (?:[a-z]+ )?(\d+)\b/i.exec(said)?.[1]) || null;
        let match = /^(?:If the (?:target|creature) fails (?:additional|further) saves|Each time a target fails an additional save) against this (?:ability|effect), the condition value increases by (\d+)(?: if failed,? or (\d+) if critically failed| \(or (\d+) if it critically fails\)| \(increases by (\d+) on a critical failure)?(?!\d)/i.exec(said);
        if (match) return { slug: null, by: Number(match[1]), ...(match[2] ?? match[3] ?? match[4] ? { critical: Number(match[2] ?? match[3] ?? match[4]) } : {}), ...(max ? { max } : {}) };
        match = new RegExp(String.raw`^On (?:each subsequent failure|a failed save), the ${STACKED_CONDITION} condition value increases by (\d+)(?: \(or by (\d+) on a critical failure\))?`, "i").exec(said);
        if (match) return { slug: match[1].toLowerCase(), by: Number(match[2]), ...(match[3] ? { critical: Number(match[3]) } : {}), ...(max ? { max } : {}) };
        match = new RegExp(String.raw`^If (?:(?:the (?:creature|target)|it) (?:is|was)|it['’]s) already ${STACKED_CONDITION}(?: by [^,]+?)?(?: before attempting the save)?, (?:(?:its|the) \1 (?:condition )?value increases by (\d+)(?: instead)?|it instead increases (?:the condition's|its \1) value by (\d+)|the (?:condition value|value of the condition) increases by (\d+)|this increases its \1 value instead|a failed save increases the value of the \1 condition by (\d+))\b`, "i").exec(said);
        // ("… this increases its drained value instead": by the value it gives.)
        if (match && !/\b(?:or|and) (?:doomed|stunned|drained|stupefied)\b/i.test(said.split(",")[0])) return { slug: match[1].toLowerCase(), by: Number(match[2] ?? match[3] ?? match[4] ?? match[5]) || null, ...(max ? { max } : {}) };
    }
    return null;
}
// Its rows' condition marked: { …, stack: { by, max? } } on the failure's and the critical failure's (by the critical's own value).
function stackConditions(outcomes, html) {
    const rule = /\b(?:increases? (?:by|the value|its|the condition|both|either)|value increases)\b/i.test(htmlToPlainText(String(html))) ? readStack(html) : null;
    if (!rule) return;
    for (const degree of ["failure", "criticalFailure"]) {
        const valued = (outcomes[degree]?.effects ?? []).filter((effect) => effect.kind === "condition" && Number.isFinite(effect.value));
        const hit = rule.slug ? valued.filter((effect) => effect.slug === rule.slug) : valued.length === 1 ? valued : [];
        for (const effect of hit) effect.stack = { by: (degree === "criticalFailure" ? rule.critical ?? rule.by : rule.by) ?? effect.value, ...(rule.max ? { max: rule.max } : {}) };
    }
}

// A worse condition for a creature that already has the first (2026-10-11, batch 75): "If the creature was already Slowed by petrifying gaze
// before attempting its save, a failed save causes it to be Petrified permanently", "If the creature is already slowed, it becomes
// Petrified as it is turned into crystal …", "If a creature is already slowed when it fails its save, it becomes Paralyzed for 1 round",
// "When a creature already slowed by Briar's Hold fails its Fortitude save, it becomes Petrified for 1 minute but …" → { raw (the
// sentence, as written), if, slug, duration }, or null.
export function readEscalation(html) {
    // (Its own split, on the description as written, so the sentence can be taken out of it as it is.)
    // (Across a paragraph's end too: "… permanently.</p> <p>A creature petrified …"; the sentence without its closing tag.)
    for (const piece of String(html ?? "").split(/(?<=\.(?:<\/p>)?)(?:\s|&nbsp;)+(?=(?:<p>)?[A-Z@])/)) {
        const raw = piece.replace(/<\/p>$/, "");
        const plain = htmlToPlainText(raw.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
        const match = /^(?:If|When) (?:the |a )?(?:creature|target)(?: (?:was|is) already| already (?:was|is)) (slowed)\b(?: by [^,]+?)?(?: before attempting (?:its|the) save| when it fails (?:its|the) save)?, (?:a failed save causes (?:it|the creature|the target) to (?:be|become)|it becomes) (Petrified|Paralyzed)\b( permanently| for (?:\d+|one) (?:rounds?|minutes?))?(?: as [^.]+| but [^.]+)?\.$/i.exec(plain)
            ?? /^When a creature already (slowed) by [^,]+? fails (?:its|the) (?:\w+ )?save, it becomes (Petrified|Paralyzed)\b( permanently| for (?:\d+|one) (?:rounds?|minutes?))?(?: but [^.]+)?\.$/i.exec(plain);
        if (!match) continue;
        const lasting = (match[3] ?? "").trim();
        return { raw, if: match[1].toLowerCase(), slug: match[2].toLowerCase(), duration: /^for /i.test(lasting) ? readDuration(lasting.replace(/\bone\b/i, "1")) : null };
    }
    return null;
}
// The failures' condition that matches (Slowed 1): { …, escalate: { if, slug, value: null, duration } }.
function escalateConditions(outcomes, escalation) {
    for (const degree of ["failure", "criticalFailure"]) {
        for (const effect of outcomes[degree]?.effects ?? []) {
            if (effect.kind === "condition" && effect.slug === escalation.if) effect.escalate = { if: escalation.if, slug: escalation.slug, value: null, duration: escalation.duration ?? null };
        }
    }
}

// Shoo! (2026-10-11, batch 73): "Trigger An enemy within 15 feet damages the dragon Effect The dragon teleports the creature up to 45 feet
// away. The destination must be on the ground and in a space with no hazards." → no roll: the creature moved that far away (the
// simulator's push and live play's, the teleport's own rules a note for the GM). null otherwise.
function teleportFoe(item) {
    if (!["reaction", "free"].includes(item.system?.actionType?.value)) return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const effect = /\bEffect (.+)$/.exec(plain)?.[1] ?? "";
    const match = /^(?:The )?[^.]+? teleports the (?:triggering )?(?:creature|enemy|foe) up to (\d+) feet away\.(?: (The destination must be [^.]+\.))?$/i.exec(effect);
    if (!match) return null;
    const distance = Number(match[1]);
    const note = `{target} is teleported up to ${distance} feet away rather than pushed: move the token through anything in the way${match[2] ? `; ${match[2].replace(/^The destination must be /i, "the destination must be ").replace(/\.$/, "")}` : ""}.`;
    return {
        ...base(item),
        targeting: { target: "1 creature", range: "touch", area: null },
        trigger: { event: "use" },
        resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: { ...none(), forcedMovement: { kind: "push", distance, upTo: true, optional: false, direction: "away" }, manualInstructions: [note] }, failure: none(), criticalFailure: none() } }
    };
}

// Breath of Loss (2026-10-11, batch 58): "dealing @Damage[14d6[mental]] damage in a @Template[cone|distance:40] (@Check[will|dc:34] save).
// A creature that critically fails its save is also consumed with the memory of the moment and is Stunned 1." — a save against damage
// its words don't mark basic, but whose critical failure is "also" worse: a basic save, as PF2e's area damage is. Only that wording
// (one damage, one save in brackets right after its area, no degrees of its own): the item with "basic" added to the check, or null.
function unmarkedBasic(item) {
    const html = String(item.system?.description?.value ?? "");
    if (inlineTags(html, "Damage").length !== 1 || inlineTags(html, "Check").length !== 1 || /\bbasic\b/i.test(html)) return null;
    if (/<strong>\s*(?:Critical Success|Success|Failure|Critical Failure)\s*<\/strong>/i.test(html)) return null;
    const plain = htmlToPlainText(html).replace(/\s+/g, " ");
    if (!/@Damage\[(?:[^[\]]|\[[^\]]*\])*\] damage in an? @Template\[[^\]]*\] \(@Check\[(?:type:)?(?:fortitude|reflex|will)\|[^\]]*\] save\)\./i.test(plain)) return null;
    if (!/\bA creature that critically fails its save is also\b/i.test(plain)) return null;
    return withDescription(item, html.replace(/\(@Check\[([^\]]*)\]/, "(@Check[$1|basic]"));
}

// An area save in other words (2026-10-12, batch 159), rewritten as the save reading takes it: Stomp's "…, causing all creatures within 10 feet to
// fall Prone (Reflex save negates)", Gravechoke's "… that targets all living creatures within a 30-foot emanation. Creatures in this area that
// fail a Fortitude save become Sickened 1 (Sickened 2 on a critical failure)." → "… must succeed at a … save or …". null when neither.
function rewordedSave(item, actor = null) {
    const html = String(item.system?.description?.value ?? "");
    const notes = [];
    const reworded = html
        // (Batch 160, Unveil Secret: "delves into the mind of a creature within 60 feet, learning something they'd find embarrassing or shameful
        // unless they succeed at a Will save. The target becomes Frightened 1 and cannot reduce their frightened condition for 1 minute … As a
        // reaction …, the dragon can reveal their secret …" — the save and the Frightened; the rest notes.)
        .replace(/^<p>((?:The )?[\w' -]+?) delves into the mind of a creature within (\d+) feet(?: to scour for secrets)?, learning something (?:they'd|the creature would) find embarrassing or shameful unless they succeed(?: at)? a (@Check\[[^\]]*\]) save\. The target becomes (@UUID\[[^\]]*\]\{Frightened \d\}|Frightened \d) and (?:cannot|can't) reduce their frightened condition for 1 minute or until [^.]+\.(?: As a reaction when the affected creature attempts a check, [^.]+?, requiring them to roll twice and take the lower result; this is a misfortune effect\.)?<\/p>/i, (all, who, feet, check, frightened) => {
            notes.push("It can't reduce that Frightened for 1 minute (or until the secret is revealed).");
            if (/misfortune/.test(all)) notes.push("Later, as a reaction when that creature attempts a check, it can reveal the secret: the creature rolls the check twice and takes the lower result.");
            return `<p>${who} delves into the mind of a creature within ${feet} feet. The creature must succeed at a ${check} save or become ${frightened}.</p>`;
        })
        .replace(/, causing all creatures within (@Template\[[^\]]*\](?:\{[^}]*\})?) to fall (@UUID\[[^\]]*\]\{Prone\}|Prone) \((@Check\[[^\]]*\]) save negates\)\./i, ". All creatures within $1 must succeed at a $3 save or be knocked $2.")
        .replace(/ that targets all (living )?creatures within (an? @Template\[[^\]]*\](?:\{[^}]*\})?)\. Creatures in this area that fail an? (@Check\[[^\]]*\]) save become ([^.]+)\./i, (_all, living, area, check, result) => `. Each ${living ?? ""}creature within ${area} must succeed at a ${check} save or become ${result}.`);
    if (reworded === html) return null;
    const plan = inlineSave(withDescription(item, reworded), actor);
    return plan && notes.length ? { ...plan, notes: [...(plan.notes ?? []), ...notes] } : plan;
}

// A check of its own compared with every creature sharing its space (2026-10-12, batch 165, Grasping Bites): "The cobbleswarm attempts an @Check[athletics]
// check and compares the result to the Fortitude DC of all creatures in its space." with its results by degree → PF2e's inline form of that
// check ("@Check[athletics|against:fortitude]"), read as a skill action, at every creature sharing its space.
function skillAgainstAll(item, actor) {
    const html = String(item.system?.description?.value ?? "");
    const match = /@Check\[(acrobatics|athletics|deception|intimidation|stealth|thievery)\]( check)? and compares the result to the (Fortitude|Reflex|Will) DC of (?:all creatures|each creature) in its space\.( This counts as two attacks for (?:the [\w' -]+?['’]s|its) multiple attack penalty\.)?/i.exec(html);
    if (!match) return null;
    const plan = compileSkillAction(withDescription(item, html.replace(match[0], `@Check[${match[1]}|against:${match[3].toLowerCase()}]${match[2] ?? ""} against every creature sharing its space.`)), { actor });
    if (!plan?.resolution) return null;
    return { ...plan, targeting: { target: "every creature sharing its space", range: "touch", area: null }, notes: [...(plan.notes ?? []), "One check, compared with every creature sharing its space.", ...(match[4] ? ["It counts as two attacks for its multiple attack penalty."] : [])] };
}

// Scattershot (2026-10-11, batch 56): "The dragon exhales a cloud of small balls of pure energy that deal @Damage[(11d4+11)[force]] damage in
// a @Template[type:cone|distance:60] with no save. The dragon can't use Scattershot again for 1d4 rounds." → that damage on everyone in
// the area, no roll; its recharge. null otherwise.
function noSaveArea(item) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const plain = htmlToPlainText(html.replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g, "@D").replace(/@Template\[[^\]]*\](?:\{[^}]*\})?/g, "@T").replace(/\[\[\/(?:r|gmr|br) [^\]]*\]\](?:\{([^}]*)\})?/g, "$1")).replace(/\s+/g, " ").trim();
    if (!/^(?:The )?[^.@]+? that deals? @D damage in an? @T with no save\.(?: (?:The )?[^.]+? can't use [^.]+? again for [^.]+\.)?$/i.test(plain)) return null;
    const damage = inlineTags(html, "Damage");
    const template = inlineTags(html, "Template").map(readTemplate).find(Boolean);
    if (damage.length !== 1 || !template) return null;
    const recharge = readRecharge(html);
    const hit = { damage: { mode: "formulas", formulas: [{ formula: readDamage(damage[0]) }], rollScope: "outcome" }, effects: [] };
    return {
        ...base(item),
        targeting: { target: null, range: null, area: template },
        trigger: { event: "use", ...(recharge ? { recharge: { formula: recharge, unit: "rounds" } } : {}) },
        resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: hit, failure: none(), criticalFailure: none() } }
    };
}

// Stoke the Flames (2026-10-11, batch 52): "The dragon intensifies nearby fires. Every foe within 60 feet that is taking persistent fire
// damage takes @Damage[5d6[fire]] damage." → that damage on each foe within that distance taking persistent fire damage
// (targeting.foes, targeting.taking: "fire"); live play: the GM's targets, with that as a reminder. null otherwise.
function stokeFlames(item) {
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const plain = htmlToPlainText(html).replace(/\s+/g, " ").trim();
    // (Batch 250: "Every foe within 60 feet taking persistent fire damage …" too, the ravener's.)
    const match = /^(?:(?:The )?[^.@]+? intensifies nearby fires\. )?Every foe within (\d+) feet (?:that is )?taking persistent (\w+) damage takes @Damage\[([^\]]+\])\] damage\.$/i.exec(plain);
    const tags = inlineTags(html, "Damage");
    if (!match || tags.length !== 1) return null;
    const hit = { damage: { mode: "formulas", formulas: [{ formula: readDamage(tags[0]) }], rollScope: "outcome" }, effects: [] };
    return {
        ...base(item),
        targeting: { target: null, range: null, area: { type: "emanation", value: Number(match[1]) }, foes: true, taking: match[2].toLowerCase() },
        trigger: { event: "use" },
        resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: hit, failure: none(), criticalFailure: none() }, reminders: [`Only foes taking persistent ${match[2].toLowerCase()} damage.`] }
    };
}

// A trap's fall (2026-10-11, batch 50; the user's choice: its card where the text allows): "Trigger A creature walks onto the trapdoor.
// Effect The triggering creature falls in and takes falling damage (typically @Damage[10[bludgeoning]] damage) as well as
// @Damage[2d6[piercing]] damage from falling on to the knives. That creature can use the Grab an Edge reaction to avoid falling." → the
// damage on the creature that set it off, Grab an Edge as a reminder; with its DC given ("(@Check[reflex|dc:22] save)", "[[/act
// grab-an-edge dc=16]]", "the DC to Climb the walls or Grab an Edge is 14"), a Reflex save whose success catches the edge. Only falls:
// not with a Strike, a condition, a Speed penalty or anything else the text adds. null otherwise.
function trapFall(item) {
    if (!["reaction", "free"].includes(item.system?.actionType?.value)) return null;
    const html = String(item.system?.description?.value ?? "");
    if (!/\bGrab (?:an|the) Edge\b|grab-an-edge/i.test(html)) return null;
    const effect = /<strong>\s*Effect\s*<\/strong>([\s\S]*)$/i.exec(html)?.[1] ?? html;
    const plain = htmlToPlainText(effect.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const damages = [];
    const reminders = [];
    let edge = false;
    let dc = null;
    for (const sentence of plain.split(/(?<=\.)\s+(?=[A-Z])/)) {
        const tags = inlineTags(sentence, "Damage");
        if (/\bGrab (?:an|the) Edge\b|grab-an-edge|\bgrab hold of the edge\b/i.test(sentence) && !tags.length) {
            edge = true;
            dc ??= Number(/@Check\[reflex\|dc:(\d+)/i.exec(sentence)?.[1] ?? /grab-an-edge dc=(\d+)/i.exec(sentence)?.[1] ?? /\bGrab an Edge is (\d+)\b/i.exec(sentence)?.[1]) || null;
            continue;
        }
        if (tags.length && /\b(?:falls?|falling|fall|plummets?|lands?)\b/i.test(sentence) && !/\b(?:Strikes?|blind\w*|entangle\w*|Speed|drown\w*|persistent|Grabbed|Prone|Restrained|Stunned|summons?|save)\b|@Check/i.test(sentence)) {
            damages.push(...tags.map((tag) => readDamage(tag)));
            continue;
        }
        if (/^The (?:trapdoor|trap door) then slams shut, and the hazard rolls initiative\.$|^The trap then rolls initiative\.$/i.test(sentence)) {
            reminders.push(sentence);
            continue;
        }
        // (Batch 263, Long Fall: words with no number around the fall — "The creature fractures the thin crust of earth and falls through.", "Some of
        // these rifts eventually lead to the Darklands." — reminders.)
        if (!tags.length && !/\d|@/.test(sentence) && !/\b(?:save|Strikes?|Prone|Grabbed|Restrained|Immobilized|Stunned|persistent|summons?)\b/i.test(sentence)) {
            reminders.push(sentence);
            continue;
        }
        return null;
    }
    if (!edge || !damages.length) return null;
    const formulas = damages.flatMap((formula) => String(formula).split(/,(?![^[]*\])/)).map((formula) => ({ formula: formula.trim() })).filter((entry) => entry.formula);
    const fall = { damage: { mode: "formulas", formulas, rollScope: "outcome" }, effects: [] };
    const resolution = dc
        ? { kind: "save", check: { roll: "save", statistic: "reflex", basic: false, against: { dc: "fixed", value: dc } }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: none(), failure: fall, criticalFailure: fall }, reminders: ["A success catches the edge: no fall.", ...reminders] }
        : { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success: fall, failure: none(), criticalFailure: none() }, reminders: ["{target} can use Grab an Edge (a Reflex save) to avoid falling and the damage.", ...reminders] };
    return { ...base(item), targeting: { target: "the triggering creature", range: null, area: null }, trigger: { event: "use" }, resolution };
}

// A trap's slab, door, tree or wall that drops (2026-10-11, batch 95; the user's choice: hazards' cards where the text allows): "Effect The
// door falls, closing off the hallway. The stone slab deals 3d8 bludgeoning damage to anyone beneath or adjacent to the slab when it drops and
// pushes them out of its space in a random direction. A creature that succeeds at a @Check[reflex|dc:17] save takes no damage and rolls out
// of the way in a random direction. On a critical success, …" → its damage with that save (a success: none, or half and none on a critical
// success); where they're pushed and roll, the GM's. Not with a condition, a curse or anything else. null otherwise.
function trapDrop(item) {
    if (!["reaction", "free"].includes(item.system?.actionType?.value) || (item.actor ?? item.parent)?.type === "npc") return null;
    const html = String(item.system?.description?.value ?? "");
    const effect = /<strong>\s*Effect\s*<\/strong>([\s\S]*)$/i.exec(html)?.[1];
    if (!effect) return null;
    const plain = htmlToPlainText(effect.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    let damage = [];
    let save = null;
    let half = false;
    for (const sentence of plain.split(/(?<=\.)\s+(?=[A-Z])/)) {
        const tags = inlineTags(sentence, "Damage");
        const check = /^A creature that succeeds at an? @Check\[reflex\|dc:(\d+)[^\]]*\](?:\{[^}]*\})? save takes (no|half) damage\b[^.]*\.$/i.exec(sentence);
        if (check && !save) {
            save = Number(check[1]);
            half = /half/i.test(check[2]);
            continue;
        }
        if (tags.length && !damage.length && /\b(?:deals?|dealing)\b/i.test(sentence) && !/@Check|\b(?:Prone|Grabbed|Restrained|Immobilized|Stunned|cursed?|persistent|Strikes?|save)\b/i.test(sentence)) {
            damage = tags.map((tag) => readDamage(tag));
            continue;
        }
        if (/^On a critical success, (?:(?:they|it|the creature) takes? no damage and )?(?:(?:they|it|the creature) )?(?:(?:can|may) )?chooses? the direction\b[^.]*\.$/i.test(sentence)) continue;
        // (What the GM needs after it: lifting the slab, what triggers it, the slab's own numbers.)
        if (/^Lifting the (?:fallen|closed) [\w ]+? requires a successful @Check\[athletics[^\]]*\](?:\{[^}]*\})? check\.$|^Hitting the floor panels triggers the trap\.$|^The [\w ]+? uses the same AC and saves as the trap, but it has Hardness \d+,? (?:and )?(?:HP )?\d+(?: HP)? \(BT \d+\)\.$/i.test(sentence)) continue;
        if (/^The (?:haunt|trap|hazard) (?:then )?rolls initiative\.$/i.test(sentence) || !/\d|@|\b(?:damage|save|Prone|Grabbed|Restrained|Immobilized|Stunned|Frightened|Sickened|curse\w*|Strikes?|penalty|bonus)\b/i.test(sentence)) continue;
        return null;
    }
    if (!damage.length || !save) return null;
    // (Its damage rolled once for all, as a basic save's: whole on a failure, half on a success that says so.)
    const components = damage.flatMap((formula) => String(formula).split(/,(?![^[]*\])/)).map((formula) => formula.trim()).filter(Boolean).map((formula, index) => ({ id: String(index), formula, type: null, category: null }));
    const share = (multiplier) => ({ damage: { mode: "shared", multiplier, sourceComponentIds: components.map((component) => component.id) }, effects: [] });
    return {
        ...base(item),
        targeting: { target: "the creatures it drops on", range: null, area: null },
        trigger: { event: "use" },
        resolution: { kind: "save", check: { roll: "save", statistic: "reflex", basic: false, against: { dc: "fixed", value: save } }, sharedDamage: { rollOnce: true, components }, outcomes: { criticalSuccess: none(), success: half ? share(0.5) : none(), failure: share(1), criticalFailure: share(1) }, reminders: ["Where the creatures are pushed or roll is the GM's."] }
    };
}

// A skill action set off by its own critical hit (2026-10-11, batch 44, Unnerving Prowess): "Trigger Dura critically succeeds at a
// Strike or Disarm with her Aldori dueling sword. Effect Dura attempts to Demoralize the target of her Strike or Disarm. This
// Demoralize attempt does not have the auditory trait, nor does Dura take a penalty …" → the basic action's plan (followUpSkill),
// its trigger the Strike it names at that degree (a free action's: free). null otherwise.
function ownStrikeSkill(item, basicActions) {
    const type = item.system?.actionType?.value;
    if (!["reaction", "free"].includes(type)) return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const parts = /^Trigger (.+?)\.? Effect (.+)$/.exec(plain);
    const trigger = parts ? readReactionTrigger(parts[1]) : null;
    if (trigger?.event !== "own-strike") return null;
    // (What doesn't change the check: its auditory trait, the language.)
    const sentences = parts[2].replace(/; this (Demoralize|Trip|Shove|Disarm|Grapple) attempt\b/i, ". This $1 attempt").split(/(?<=\.)\s+(?=[A-Z])/);
    const silent = (sentence) => /^This Demoralize attempt (?:does not|doesn't) have the auditory trait\b[^.]*\.$/i.test(sentence);
    const plan = followUpSkill(item, sentences.filter((sentence) => !silent(sentence)).join(" "), basicActions);
    if (!plan) return null;
    const quiet = sentences.some(silent) ? (traits) => (traits ?? []).filter((trait) => trait !== "auditory") : (traits) => traits;
    return { ...plan, traits: quiet(plan.traits), activation: { ...plan.activation, traits: quiet(plan.activation?.traits) }, trigger: { ...trigger, ...(type === "free" ? { free: true } : {}) } };
}

// The one PF2e effect an ability links, on the rows that apply nothing else: a save's failure and critical failure, a
// check's success and critical success (2026-10-10). Not when it links more than one, or none.
function linkedEffect(plan, html) {
    const links = [...new Map([...String(html).matchAll(EFFECT_LINK)].map((match) => [match[1], match[2] ?? null])).entries()];
    // (Batch 257, Goblin Song: one effect in each degree's section — that row's, where it reads nothing else.)
    if (links.length > 1) {
        const sections = degreeSections(html);
        for (const [degree, section] of Object.entries(sections)) {
            const own = [...String(section ?? "").matchAll(EFFECT_LINK)];
            const row = plan.resolution.outcomes?.[degree];
            if (own.length !== 1 || !row || (row.damage?.mode ?? "none") !== "none" || row.effects?.length || row.forcedMovement || row.modifiers?.length || row.nativeEffects?.length) continue;
            row.nativeEffects = [{ uuid: own[0][1], label: (own[0][2] ?? "").replace(/^Effect:\s*/i, "") || null }];
        }
        return;
    }
    if (links.length !== 1) return;
    const [uuid, label] = links[0];
    const save = plan.resolution.kind === "save";
    const rows = save ? ["failure", "criticalFailure"] : ["success", "criticalSuccess"];
    const outcomes = plan.resolution.outcomes;
    // (Not where it read a penalty: the text's own, which may differ by degree, as Bon Mot's.)
    const bare = (row) => row && (row.damage?.mode ?? "none") === "none" && !row.effects?.length && !row.forcedMovement && !row.modifiers?.length && !row.terminal && !row.nativeEffects?.length;
    if (!rows.every((degree) => bare(outcomes[degree]))) return;
    // A check's success may be the user's own gain ("the raw nerve … gains a +2 circumstance bonus to AC", "the
    // fleshwarper's melee Strikes deal …"): its subject says whose.
    let self = false;
    if (!save) {
        const plain = htmlToPlainText(String(html).replace(EFFECT_LINK, "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1"));
        const said = /\b(?:On a success|If (?:it|he|she|they|the [\w' -]+?) succeeds?|If successful),? ([^.]+)/i.exec(plain)?.[1] ?? htmlToPlainText(degreeSections(html).success ?? "");
        const subject = said.split(/\b(?:gains?|takes?|deals?|can|is|are|becomes?|has|have|must|grants?|gives?)\b/i)[0];
        self = !OTHERS.test(subject) && subject.trim().length > 0;
    }
    for (const degree of rows) outcomes[degree].nativeEffects = [{ uuid, label: (label ?? "").replace(/^Effect:\s*/i, "") || null, ...(self ? { recipient: { actor: "source" } } : {}) }];
}

// PF2e's DC by level (−1 to 25), and the "hard" adjustment (+2).
const LEVEL_DC = [13, 14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40, 42, 44, 46, 48, 50];
const levelDC = (actor, hard = false) => {
    const level = Number(actor?.system?.details?.level?.value);
    return Number.isFinite(level) ? LEVEL_DC[Math.max(0, Math.min(LEVEL_DC.length - 1, level + 1))] + (hard ? 2 : 0) : null;
};

// A save with no DC in the data (2026-10-13, the user's choice: the creature's level DC, hard): a check whose DC is empty ("dc:|") — the number hidden
// in a broken attribute when it's there ("data-pf2-dc=…"); "must attempt a Reflex save." or "with a basic Fortitude save" with no check at all; a troop's
// breath with no save, a basic Reflex save at its level DC. The source with those filled in, or the source.
function fillMissingDCs(source, actor) {
    const html = String(source?.system?.description?.value ?? "");
    // (Not a glossary entry with no numbers at all, its damage 0: the GM's.)
    if (!html || /@Damage\[\(0\)\[/.test(html)) return source;
    const hard = levelDC(actor, true);
    let filled = html.replace(/@Check\[([^\]]*)\]/g, (all, inner) => {
        if (!/\bdc:(?=\||$)/.test(inner)) return all;
        const hidden = /data-pf2-dc="(\d+)/.exec(inner)?.[1];
        const dc = hidden ?? hard;
        return dc ? `@Check[${inner.replace(/\|?traits:[^|]*?" data-pf2-dc="\d+/, "").replace(/\bdc:(?=\||$)/, `dc:${dc}`)}]` : all;
    });
    if (hard && !/@Check\[/.test(filled)) {
        filled = filled.replace(/\bmust attempt an? (Fortitude|Reflex|Will) save\./g, (_all, save) => `must attempt a @Check[${save.toLowerCase()}|dc:${hard}] save.`)
            .replace(/,? with a basic (Fortitude|Reflex|Will) save\./g, (_all, save) => ` (@Check[${save.toLowerCase()}|dc:${hard}|basic] save).`)
            // (Batch 274, Reap Memory: "… can attempt a Will save to resist.")
            .replace(/\bcan attempt an? (Fortitude|Reflex|Will) save to resist\./g, (_all, save) => `can attempt a @Check[${save.toLowerCase()}|dc:${hard}] save to resist.`);
    }
    const troop = (actor?.system?.traits?.value ?? []).includes("troop");
    const plain = levelDC(actor);
    if (troop && plain && !/@Check\[/.test(filled) && /\bbreath weapon\b/i.test(filled) && /@Template\[/.test(filled)) {
        filled = filled.replace(/(This explosion deals @Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})? damage) \(([^)]*)\);/, (_all, deals, kinds) => `${deals} (@Check[reflex|dc:${plain}|basic] save; ${kinds});`);
    }
    return filled === html ? source : withDescription(source, filled);
}

// A plan for an NPC ability, { builtin } for rules the simulator plays itself,
// or null. basicActions: the compiled basic actions ({ grapple, trip, shove, … }), for riders.
// actor: the creature, when the item has none (pack data), for Trample's Strike.
export function compileMonsterAbility(source, options = {}) {
    if (!source || (source.type !== "action" && source.type !== "feat")) return null;
    // (2026-10-13: the user's own choices come first — an ability they kept the GM's stays so, whatever a later reading makes of it.)
    const decided = source.type === "action" ? gmDecided((options.actor ?? source.actor ?? source.parent)?.name, source.name) : null;
    if (decided) return { builtin: "no-effect", gm: decided };
    source = fillMissingDCs(source, options.actor ?? source.actor ?? source.parent);
    const html = String(modernItem(source).system?.description?.value ?? "");
    // (Batch 75: "If the creature was already Slowed …, a failed save causes it to be Petrified permanently" — read on its own, set aside
    // for the other readings, and put back on the failures' condition after them.)
    const escalation = readEscalation(html);
    const read = compileAbilityText(escalation ? withDescription(modernItem(source), html.replace(escalation.raw, "")) : source, options);
    // A condition that grows with each later failure (batch 74), a worse one for a creature that already has it (batch 75).
    if (read?.resolution?.outcomes) {
        stackConditions(read.resolution.outcomes, html);
        if (escalation) escalateConditions(read.resolution.outcomes, escalation);
    }
    // (2026-10-12, the user's choice: what no reading plays, behind a state the simulator can't see, out of combat, or a one-off adventure
    // creature's — the GM's.)
    // (Batch 194, Improved Vex: a free action's follow-up to a Strike, when no other reading has it.)
    const free = !read && modernItem(source).system?.actionType?.value === "free" ? followUp(modernItem(source), options.actor ?? null, options.basicActions ?? {}) : null;
    return read ?? free ?? (options.trailing ? null : hazardEffect(modernItem(source), options) ?? reactionByEffect(modernItem(source), options) ?? trailingNotes(modernItem(source), options)) ?? (options.trailing ? null : ownToggle(modernItem(source))) ?? gmFallback(modernItem(source), options);
}

// A reaction whose trigger reads but no reading plays as a whole (2026-10-13, batch 273): its Effect compiled as an action, with that trigger — on the
// triggering creature when the Effect is about it. Not one whose Effect reads as nothing. null otherwise.
function reactionByEffect(item, options) {
    const type = item.system?.actionType?.value;
    if (!["reaction", "free"].includes(type)) return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    // (Not one with a requirement — a state the GM sees, a rider mounted on it; nor one whose trigger's "The …" is another creature, "The rider is
    // targeted with an attack".)
    const split = /^(?:Frequency [^.]+?\.? )?Trigger (.+?)[;.]? Effect (.+)$/.exec(plain);
    if (!split || /\bRequirements?\b/.test(split[1])) return null;
    const subject = /^The ([\w' -]+?) (?:is|was|takes|becomes|would|fails|rolls|hits|reduces|drops|gets|uses|attempts|critically)\b/i.exec(split[1].trim())?.[1]?.toLowerCase();
    const owner = options.actor ?? item.actor ?? item.parent;
    if (subject && !String(owner?.name ?? "").toLowerCase().includes(subject.replace(/^(?:great wyrm|ancient|adult|young|elder) /, ""))) return null;
    const trigger = readReactionTrigger(split[1].trim());
    if (!trigger || trigger.event === "use") return null;
    const html = String(item.system?.description?.value ?? "");
    const at = html.search(/<strong>\s*Effect\s*<\/strong>/i);
    if (at < 0) return null;
    const effect = `<p>${html.slice(at).replace(/^<strong>\s*Effect\s*<\/strong>\s*/i, "")}`;
    const asAction = { type: item.type, name: item.name, system: { ...item.system, actionType: { value: "action" }, actions: { value: 1 }, description: { value: effect } } };
    let plan = null;
    try {
        plan = compileMonsterAbility(asAction, { ...options, trailing: true });
    } catch {
        plan = null;
    }
    if (!plan || plan.builtin === "no-effect" || (!plan.resolution && !plan.builtin)) return null;
    const onTrigger = /\bthe triggering (?:creature|enemy|foe|attacker)\b|\bthe (?:attacker|creature that [^.]+)\b/i.test(split[2]);
    const free = type === "free";
    return { ...plan, ...(plan.resolution ? { activation: { ...(plan.activation ?? {}), time: type }, ...(onTrigger && !["self"].includes(plan.targeting?.target) ? { targeting: { ...(plan.targeting ?? {}), target: "the triggering creature" } } : {}) } : {}), trigger: { ...trigger, ...(plan.trigger?.recharge ? { recharge: plan.trigger.recharge } : {}), reaction: true, ...(free ? { free: true } : {}) } };
}

// A hazard's reaction by its Effect alone (2026-10-12, batch 263): live, a hazard's reactions fire from its linked Regions (the GM's Fire card), so its
// trigger needn't read — "The seal on the tomb is broken from the outside", "A creature moves into the mold's space or damages the mold". Its Effect is
// compiled as an action, and the plan's trigger is { event: "hazard" }. null when the Effect reads as nothing.
function hazardEffect(item, options) {
    const owner = options.actor ?? item.actor ?? item.parent;
    if (owner?.type !== "hazard" || !["reaction", "free"].includes(item.system?.actionType?.value)) return null;
    const html = String(item.system?.description?.value ?? "");
    const at = html.search(/<strong>\s*Effect\s*<\/strong>/i);
    if (at < 0) return null;
    const effect = `<p>${html.slice(at).replace(/^<strong>\s*Effect\s*<\/strong>\s*/i, "")}`;
    const asAction = { type: item.type, name: item.name, system: { ...item.system, actionType: { value: "action" }, actions: { value: 1 }, description: { value: effect } } };
    let plan = null;
    try {
        plan = compileMonsterAbility(asAction, { ...options, trailing: true });
    } catch {
        plan = null;
    }
    if (!plan || (plan.builtin === "no-effect") || (!plan.resolution && !plan.builtin)) return null;
    return { ...plan, ...(plan.resolution ? { activation: { ...(plan.activation ?? {}), time: item.system.actionType.value } } : {}), trigger: { ...(plan.trigger ?? {}), event: "hazard" } };
}

// What its first sentences do, the rest the GM's (2026-10-12, batch 263, the user's call to automate what can be): when no reading takes the whole
// text, the longest opening that reads as a card (a save, a check, a Strike's card), with the sentences after it as notes — only sentences with no
// rolls, damage, checks, areas or linked conditions in them, none that starts a degree's results ("On a failure", "Critical Success", "If it
// fails"), and none that gives a bonus, penalty, resistance, weakness, immunity or Hit Points. Chain Capture's pull "to the distance it chooses" and
// its chain's damage next turn, for instance. null otherwise.
const KEEP_OUT = /@(?:Check|Damage|Template|UUID|Compendium)\[|\[\[\/|\b(?:bonus|penalty|resistance|weakness|immun\w*|Hit Points|HP|temporary)\b/i;
const DEGREE_START = /^(?:On an? (?:critical )?(?:success|failure|hit|miss)|(?:Critical )?(?:Success|Failure)\b|If (?:it|the target|the creature|they) (?:fails|succeeds|critically)|If (?:the [\w' -]+?|it|they) rolls? an? (?:critical )?(?:success|failure|hit))/i;
function trailingNotes(item, options) {
    if (!["action", "reaction", "free"].includes(item.system?.actionType?.value)) return null;
    const html = String(item.system?.description?.value ?? "");
    const sentences = html.split(/(?<=[.!?])(?:<\/?(?:p|li|ul|ol|br|hr)\b[^>]*>|\s)+(?=(?:<[^>]+>)*[A-Z@(])/).filter((part) => htmlToPlainText(part).trim());
    if (sentences.length < 2) return null;
    for (let keep = sentences.length - 1; keep >= 1; keep--) {
        const dropped = sentences.slice(keep);
        const words = dropped.map((part) => htmlToPlainText(part).replace(/\s+/g, " ").trim());
        // (A degree's sentence only with no number in it: "On a success, … can also pull the target … to the distance it chooses.")
        if (words.some((word, index) => KEEP_OUT.test(dropped[index]) || KEEP_OUT.test(word) || (DEGREE_START.test(word) && /\d/.test(word)))) return null;
        let plan = null;
        try {
            plan = compileMonsterAbility(withDescription(item, sentences.slice(0, keep).join(" ").replace(/(<p[^>]*>)(?![\s\S]*<\/p>)/, "$1") + (/<p\b/i.test(sentences.slice(0, keep).join(" ")) && !/<\/p>\s*$/i.test(sentences.slice(0, keep).join(" ")) ? "</p>" : "")), { ...options, trailing: true });
        } catch {
            plan = null;
        }
        if (plan?.resolution && playsSomething(plan)) return { ...plan, notes: [...(plan.notes ?? []), ...words] };
    }
    return null;
}
// (A card that does something: damage, a condition or other effect, PF2e's effect, healing.)
function playsSomething(plan) {
    const resolution = plan.resolution;
    if (resolution.kind === "effect") return Boolean(resolution.applications?.length);
    if (resolution.kind === "healing") return true;
    if (resolution.sharedDamage?.components?.length) return true;
    return Object.values(resolution.outcomes ?? {}).some((row) => (row?.damage && row.damage.mode !== "none") || row?.effects?.length || row?.nativeEffects?.length || row?.forcedMovement || row?.affliction || row?.modifiers?.length);
}

function compileAbilityText(source, { basicActions = {}, actor = null } = {}) {
    const item = modernItem(source);
    const slug = glossarySlug(item);
    if (BUILT_IN.has(slug)) {
        const strike = slug === "rend" ? htmlToPlainText(item.system?.description?.value ?? "").split(/\n/)[0].trim() : null;
        return { builtin: slug, ...(strike ? { strike } : {}) };
    }
    if (NO_EFFECT.has(slug)) return { builtin: "no-effect" };
    // Aquatic Ambush (the glossary's; batch 38): from hiding in the water, a move and a Strike at a creature off-guard to it; once a
    // fight, as it starts hidden.
    if (slug === "aquatic-ambush") return { builtin: "charge", actions: Number(item.system?.actions?.value) || 1, strides: 1, strike: null, offGuard: true, oncePerFight: true };
    // Power Attack (the glossary's, batch 131: "Frequency once per round. The monster makes a melee Strike. This counts as two attacks when
    // calculating the monster's multiple attack penalty. If this Strike hits, the monster deals an extra die of weapon damage.").
    if (slug === "power-attack" && /@Localize\[PF2E\.NPC\.Abilities\.Glossary\.PowerAttack\]/.test(item.system?.description?.value ?? "")) {
        return { builtin: "strike-activity", actions: Number(item.system?.actions?.value) || 2, strides: 0, strike: null, attackBonus: 0, damageBonus: 0, offGuard: false, requires: null, oncePerFight: false, oncePerTurn: true, countsAs: 2, extraWeaponDice: 1, onHit: { conditions: [], critical: null, push: null, damage: [], save: null, size: null } };
    }
    if (["grab", "improved-grab", "knockdown", "improved-knockdown", "push", "improved-push", "pull", "improved-pull"].includes(slug)) return rider(item, slug, basicActions);
    // Retributive Strike (the glossary's): as a champion's, the ally's resistance is 2 + the monster's level.
    if (slug === "retributive-strike") {
        const level = Number((actor ?? item.actor ?? item.parent)?.system?.details?.level?.value);
        return { builtin: "retributive-strike", resistance: Number.isFinite(level) ? 2 + level : null };
    }
    if (slug === "constrict" || slug === "greater-constrict") return constrict(item, { greater: slug === "greater-constrict" });
    const coils = wrapInCoils(item, actor);
    if (coils) return coils;
    if (slug === "frightful-presence") return frightfulPresence(item);
    if (slug === "stench") return stench(item);
    if (slug === "swallow-whole") return swallowWhole(item);
    if (slug === "trample") return trample(item, actor);
    const march = inexorableMarch(item, actor) ?? auraPush(item, actor) ?? blownAloft(item);
    if (march) return march;
    if (slug === "buck") return buck(item);
    if (/drink-blood|drink-essence/.test(slug ?? "") || /^Drink (?:Blood|Essence)$/i.test(item.name ?? "")) {
        const plan = drinkBlood(item);
        if (plan) return plan;
    }
    // (Batch 31: Drain Qi, Drain Thoughts, Slurp Blood by their words, with one condition on the victim; Blood Drain.)
    if (item.system?.actionType?.value === "action") {
        const named = new Set([...htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/^[\s\S]*?\bEffect\b/, "").matchAll(/(?<!already )\b(Drained|Stupefied|Enfeebled|Clumsy|Frightened|Sickened|Slowed|Stunned|Paralyzed|Fatigued|Confused)\b/g)].map((match) => match[1].toLowerCase()));
        const plan = (named.size <= 1 ? drinkBlood(item) : null) ?? bloodDrain(item);
        if (plan) return plan;
    }
    if (slug === "engulf") return engulf(item, actor);
    // Used in one of several ways (two breath weapons): a plan for each.
    const modes = wickedBite(item) ?? compileModes(item, { basicActions, actor }) ?? strideThenEither(item, basicActions) ?? eitherSpell(item, actor) ?? randomTable(item, actor, { basicActions });
    if (modes) return modes;
    // Damage by the number of actions spent (a troop's attacks): one plan, the damage for each count.
    const byActions = actionCountSave(item, actor);
    if (byActions) return byActions;
    const exposure = exposureSave(item, actor);
    if (exposure) return exposure;
    // A follow-up to a Strike that hit ("Requirements … last action was a successful claw Strike").
    const after = item.system?.actionType?.value === "action" ? followUp(item, actor, basicActions) : null;
    if (after) return after;
    // Poisons, diseases and curses with stages, delivered by the Strikes that list them.
    if (/<strong>\s*Stage\s+1\s*<\/strong>/i.test(item.system?.description?.value ?? "")) return compileAffliction(item, base(item));
    const plan = compileBuiltin(withHeads(item, actor), slug) ?? (item.system?.actionType?.value === "action" ? focusedAssault(item, actor) ?? strikeActivity(item, actor) : null) ?? ownStrikeSkill(item, basicActions) ?? otherSkillManeuver(item, basicActions) ?? maneuverThenStrike(item, actor, basicActions) ?? variedManeuver(item, basicActions) ?? damagedManeuver(item, basicActions) ?? maneuverAfterMove(item, actor, basicActions) ?? provokedSkill(item, basicActions, actor) ?? provokedStrike(item) ?? downsDemoralize(item, basicActions) ?? trapFall(item) ?? trapDrop(item) ?? stokeFlames(item) ?? teleportFoe(item) ?? noSaveArea(item) ?? rewordedSave(item, actor) ?? inlineSave(unmarkedBasic(item) ?? item, actor) ?? skillAgainstAll(item, actor) ?? compileSkillAction(item, { actor }) ?? effectAbility(item) ?? automaticEffect(item, actor);
    // (Batch 154, Exit Stage: once per mask it carries, each use breaking one — the masks on its sheet; with no creature given, the GM counts.)
    if (plan?.builtin === "ferocity" && plan.perMask) {
        delete plan.perMask;
        const masks = [...(actor?.items ?? [])].filter((entry) => entry?.type === "equipment" && /\bmask\b/i.test(entry.name ?? "")).length;
        if (masks > 0) plan.uses = masks;
    }
    // A save or check whose result is a PF2e effect it links ("…save or take a –1 status penalty to attack rolls …
    // Effect: Downcast"): that effect, on the rows that apply nothing else (a failure, or a check's success).
    if (plan?.resolution?.outcomes) linkedEffect(plan, item.system?.description?.value ?? "");
    // Results it can't apply ("The target can't use reactions for 1 round"): their text on the card, for the GM.
    if (plan?.resolution?.outcomes) noteUnread(plan.resolution.outcomes, item.system?.description?.value ?? "");
    // Nothing else read, and it casts a spell or has its effects: the spell, cast through PF2e.
    if (!plan?.builtin && !plan?.resolution) return castAndGrab(item, actor) ?? castSpell(item, actor) ?? riderReading(item, actor) ?? deathReading(item, actor) ?? hitByReading(item, actor) ?? grabTurnReading(item, actor) ?? selfHeal(item) ?? downsHeal(item) ?? selfCondition(item) ?? readRage(item, actor) ?? readStrikeBuff(item) ?? readSelfGuard(item) ?? readShell(item, actor) ?? readRegrowth(item) ?? focusGaze(item, actor, basicActions) ?? poisonWeapon(item, actor) ?? areaExposure(item, actor) ?? escapeBite(item, actor) ?? clingBite(item, actor) ?? grabOnMiss(item, actor) ?? linkedEffectSave(item, actor) ?? concealOther(item) ?? breathPauseSave(item, actor) ?? reactionUsesAbility(item, actor, { basicActions }) ?? actionUsesTwice(item, actor, { basicActions }) ?? areaUsesAbility(item, actor, { basicActions }) ?? moveUsesAbility(item, actor, { basicActions }) ?? betrayingTouch(item, actor, { basicActions }) ?? fling(item) ?? heldDamage(item) ?? healTouch(item) ?? areaHealing(item) ?? pullThenStrike(item, actor) ?? flightFrenzy(item, actor, { basicActions }) ?? disruptingSave(item) ?? retributiveRune(item, actor) ?? phrasedSave(item, actor) ?? passThrough(item, actor) ?? moveAndDrop(item) ?? exposedOnFail(item, actor) ?? alliesQuickened(item) ?? heldCreature(item, actor, { basicActions }) ?? reshapedBreath(item, actor, { basicActions }) ?? hurtRetreat(item) ?? downedDamage(item) ?? eyesCondition(item) ?? troopAbility(item, actor, { basicActions, actor }) ?? heldMore(item) ?? saveThenEffect(item) ?? oneOffStrikes(item, actor) ?? cursedSave(item) ?? oneOffGround(item) ?? moreOneOffs(item, actor) ?? fourthOneOffs(item, actor) ?? fifthOneOffs(item, actor) ?? sixthOneOffs(item, actor) ?? seventhOneOffs(item, actor) ?? eighthOneOffs(item, actor) ?? ownAbilitySave(item, actor, basicActions) ?? bzOneOffs(item, actor) ?? bzReactions(item, actor) ?? chunk273(item, actor, basicActions) ?? chunk274(item, actor, basicActions) ?? chunk275(item, actor, basicActions) ?? chunk276(item, actor, basicActions) ?? chunk277(item, actor, basicActions) ?? zoneOnTrigger(item, actor, { basicActions }) ?? readZone(item, actor) ?? plan;
    // (Batch 256: an area save that lasts — saves again each round, or on entering it, or at a turn there: its zone, the first save in it.)
    if (plan?.resolution?.kind === "save" && plan.targeting?.area && (plan.trigger?.event ?? "use") === "use" && ZONE_LASTING.test(htmlToPlainText(item.system?.description?.value ?? ""))) {
        const zone = readZone(item, actor);
        const lasting = zone?.zone?.saves?.find((save) => save.plan && save.when.some((when) => when !== "initial"));
        // (The save as the area save read it — its results by degree, its damage — on each creature when the zone says; its recharge kept.)
        if (lasting) {
            const single = { ...plan, targeting: { target: "1 creature", range: null, area: null }, trigger: { event: "zone" } };
            const saves = zone.zone.saves.map((save) => (save === lasting ? { ...save, plan: single } : save));
            return { ...zone, ...(plan.trigger?.recharge ? { trigger: { ...(zone.trigger ?? { event: "use" }), recharge: plan.trigger.recharge } } : {}), zone: { ...zone.zone, saves } };
        }
    }
    return listedRider(item, actor, plan) ?? hitBy(item, plan) ?? targetedBy(item, plan) ?? ownStrikePassive(item, plan) ?? damagedPassive(item, plan) ?? grabTurn(item, plan) ?? reactionTrigger(item, plan, actor) ?? plan;
}
const ZONE_LASTING = /\b(?:new save each round|(?:starts?|begins?|ends?) (?:its|their) turns? (?:with)?in|who enters?|or enters?|persists? for|lasts? for|remains? (?:in place )?for)\b/i;

// A reaction whose trigger is a hit, a critical hit or damage on the monster, or its death (2026-10-10, batch 16): "The
// dragon is critically hit with a melee weapon or unarmed attack", "A creature within the thoqqua's reach hits the thoqqua
// with a melee Strike", "An adjacent creature deals piercing or slashing damage to the dragon", "The bul-gae takes damage",
// "The hunter wight is reduced to 0 Hit Points". Its trigger:
//   { event: "hit-by", reaction: true, melee, unarmed?, critical?, damageTypes?, within? }: an attack that hits it (melee
//     false: any attack; within: the attacker that close);
//   { event: "damaged", reaction: true, damageTypes? }: damage on it from anything;
//   { event: "death", reaction: true }.
// Its results go on the attacker when it names the attacker ("the triggering creature", "the creature who dealt the
// triggering damage"), or on its area; otherwise on the GM's targets. Not read: any other trigger, one with a condition of its
// own ("while", "if", an ally, a size, a spell, a ranged attack), a number of points of damage.
// (Case-sensitive: a name is capitalized.)
const SELF = String.raw`(?:[Tt]he [\w' -]+?|it|him|her|them|[A-Z][\w'-]+(?: [A-Z][\w'-]+){0,2})`;
const DAMAGE_WORDS = /\b(bludgeoning|piercing|slashing|physical|fire|cold|acid|electricity|sonic|poison|mental|force|vitality|void|spirit|bleed)\b/gi;
const ATTACKER = /\b(?:attacker|assailant|tormentor|triggering|creature (?:who|that) (?:dealt|made|hit|damaged|attacked)|that creature)\b/i;

// The conditions a monster's hit may need on its target (batch 69: "hits a Slowed creature", "hits an off-guard creature").
const OWN_HIT_CONDITIONS = "Slowed|[Oo]ff-[Gg]uard|Prone|Frightened|Grabbed|Restrained|Immobilized|Paralyzed|Stunned|Blinded|Dazzled|Sickened|Fatigued|Enfeebled|Clumsy|Drained|Stupefied|Fascinated|Confused";

export function readReactionTrigger(text) {
    // Batch 22: Reactive Strike's triggers, with results of its own (on the whole text: its ", or …" are its triggers).
    const provoked = provokeTrigger(String(text ?? "").trim().replace(/[.;]\s*$/, ""));
    if (provoked) return provoked;
    // (Batch 225, Shell Shock: "A lightning turtle is hit by …" — the monster, by its kind.)
    const trigger = String(text ?? "").trim().replace(/[.;]\s*$/, "").replace(/, or\b.*$/i, "")
        .replace(/^An? ([a-z][\w' -]+?) (?=is (?:hit|critically hit) by\b)/, (all, kind) => (/\b(?:creature|enemy|foe|ally|allies|target|object)\b/.test(kind) ? all : `The ${kind} `));
    const types = (words) => {
        const found = [...String(words ?? "").matchAll(DAMAGE_WORDS)].map((match) => match[1].toLowerCase());
        return found.length ? [...new Set(found)] : null;
    };
    const refused = (words) => /\b(?:ranged|spells?|while|if|unless|ally|allies|first time|aura|metal|wooden|silver|cold iron|Tiny|Small|Medium|Large|Huge|Gargantuan|at least|points?|or more)\b|\d+ (?:or more )?(?:Hit Points|damage)/i.test(words);
    const hit = ({ critical, how, adjacent = false, within = "" }) => {
        // (Not one of several triggers: "A creature damages the door, fails to Force Open the door, or …".)
        if (refused(how) || how.includes(",") || refused(within.replace(/\bwithin \d+ feet\b/i, ""))) return null;
        const melee = adjacent || /\b(?:melee|unarmed|reach)\b/i.test(`${how} ${within}`);
        // (Batch 225, Shell Shock's "a melee or an unarmed attack": any melee attack.)
        const unarmed = /\bunarmed\b/i.test(how) && !/\bmelee or (?:an )?unarmed\b/i.test(how) && !/\bmelee (?:weapon|attack|Strike)s?\b|\bweapons?\b/i.test(how.replace(/\bmelee unarmed\b/gi, "unarmed").replace(/\bunarmed melee\b/gi, "unarmed"));
        const distance = Number(/\bwithin (\d+) feet\b/i.exec(within)?.[1]) || null;
        // ("… that deals slashing or piercing damage", "with a piercing or slashing Strike".)
        const damageTypes = types(/\bdamage\b|\b(?:bludgeoning|piercing|slashing)(?: or \w+)? (?:Strike|attack|weapon)/i.test(how) ? how : "");
        return { event: "hit-by", reaction: true, melee, ...(unarmed ? { unarmed: true } : {}), ...(critical ? { critical: true } : {}), ...(damageTypes ? { damageTypes } : {}), ...(distance ? { within: distance } : {}) };
    };
    if (new RegExp(String.raw`^${SELF} (?:is reduced to 0 (?:Hit Points|HP)|dies|is (?:killed|destroyed|slain))$`).test(trigger)) return { event: "death", reaction: true };
    // Downing a creature itself (batch 52, You're Next): "The prisoner reduces a creature to 0 hit points".
    if (new RegExp(String.raw`^${SELF} reduces (?:a creature|an enemy|a foe) to 0 (?:HP|[Hh]it [Pp]oints)$`).test(trigger)) return { event: "downs", reaction: true };
    // A creature it holds failing to Escape (batch 65): "A creature Grabbed by the corrosive lizard's jaws fails a check to Escape", "A
    // creature Grabbed or Restrained by the wyvern critically fails a skill check to Escape".
    const escaping = new RegExp(String.raw`^An? creature (?:Grabbed|grabbed)(?: or Restrained)? by ${SELF}(?:['’]s [\w' -]+?)? (critically fails|fails) an? (?:skill )?check to Escape$`).exec(trigger);
    if (escaping) return { event: "escape-failed", reaction: true, ...(/^critically/i.test(escaping[1]) ? { critical: true } : {}) };
    // (Batch 225, Serrated Teeth: "A creature Grabbed or Restrained by the allosaurus's jaws succeeds at an Escape check" — one it held getting free.)
    if (new RegExp(String.raw`^An? creature (?:Grabbed|grabbed)(?: or Restrained)? by ${SELF}(?:['’]s [\w' -]+?)? succeeds at an? (?:Escape check|(?:skill )?check to Escape)$`).test(trigger)) return { event: "escaped", reaction: true };
    // (Batch 246, Robe Tangle: "An adjacent creature misses the Iroran mummy with a melee Strike" — a miss on it: hit-by with missed.)
    const missing = new RegExp(String.raw`^An? (adjacent )?(?:creature|enemy|foe) (critically )?misses ${SELF} with an? (melee )?(?:Strike|attack)$`).exec(trigger);
    if (missing) return { event: "hit-by", reaction: true, missed: true, melee: Boolean(missing[1] || missing[3]), ...(missing[2] ? { critical: true } : {}), ...(missing[1] ? { within: 5 } : {}) };
    // A foe's mishap near it (batch 57, Jeer at Failure): "A foe within 90 feet becomes Prone or critically fails on a Strike".
    const mishap = /^An? (?:foe|enemy) within (\d+) feet becomes Prone or critically fails on a Strike$/i.exec(trigger);
    if (mishap) return { event: "foe-mishap", reaction: true, within: Number(mishap[1]) };
    // (Batch 252, a Battlezoo jester dragon's jeer: a foe's critical miss on the monster itself — onSelf.)
    if (new RegExp(String.raw`^An? (?:foe|enemy) critically fails a Strike against ${SELF}$|^An? (?:foe|enemy) rolls a critical failure on a Strike at ${SELF}$`).test(trigger)) return { event: "foe-mishap", reaction: true, within: 120, onSelf: true };
    // (Batch 273: a foe's failed save against its own ability by name ("… fails or critically fails their Reflex save against the dezullon thicket's
    // Thrashing Vines"), against a spell it cast, or a foe near it failing a save against an effect of some trait (an emotion effect).)
    const failedOwn = new RegExp(String.raw`^An? (?:creature|foe|enemy) fails(?: or critically fails)? (?:a|their|its) (?:(Fortitude|Reflex|Will) )?(?:save|saving throw) against ${SELF}['’]s ([A-Z][\w' -]+?)$`).exec(trigger);
    if (failedOwn) return { event: "foe-failed-save", reaction: true, ability: failedOwn[2], ...(failedOwn[1] ? { save: failedOwn[1].toLowerCase() } : {}) };
    if (new RegExp(String.raw`^An? (?:creature|foe|enemy) fails a (?:save|saving throw) against a spell cast by ${SELF}$`).test(trigger)) return { event: "foe-failed-save", reaction: true, spell: true };
    const failedTrait = new RegExp(String.raw`^An? (?:creature|foe|enemy) within (\d+) feet(?: of ${SELF})? fails a (?:save|saving throw) against an? (\w+) effect$`).exec(trigger);
    if (failedTrait) return { event: "foe-failed-save", reaction: true, traits: [failedTrait[2].toLowerCase()], within: Number(failedTrait[1]), anyone: true };
    // (Batch 270, Battlezoo: an adjacent creature's critically failed melee attack roll against it.)
    if (new RegExp(String.raw`^An adjacent (?:creature|foe|enemy) critically (?:fails|misses) (?:a|with a) melee (?:attack roll|attack|Strike) against ${SELF}$`).test(trigger)) return { event: "foe-mishap", reaction: true, within: 5, onSelf: true };
    // A creature near it losing a condition (batch 46, Consume Fear): "A creature within 60 feet loses the Frightened condition".
    const lost = /^(?:An?|Any) creature within (\d+) feet loses the (\w+) condition$/i.exec(trigger);
    if (lost) return { event: "condition-lost", reaction: true, condition: lost[2].toLowerCase(), within: Number(lost[1]) };
    // (Batch 276, Menace to Magic: "A creature within 60 feet Casts a Spell" — a spell cast near it.)
    const casting = new RegExp(String.raw`^An? (?:creature|foe|enemy) within (\d+) feet(?: of ${SELF})? casts a spell$`, "i").exec(trigger);
    if (casting) return { event: "provoke", reaction: true, triggers: ["cast"], within: Number(casting[1]) };
    // "A creature attempts to target the hundun with a mental effect", "… with a mental effect or spell" (batch 17).
    const targeted = targetedWith(trigger);
    if (targeted) return { ...targeted, reaction: true };
    // Batch 18. Its own Strike: "The tyrannosaurus critically hits a Large or smaller foe with its foot", "Raskus critically
    // hits with a beak Strike", "Ingnovim damages a creature with a syringe Strike" (not on only some creatures: "a holy
    // creature", "an off-guard creature").
    // (Batch 44, Unnerving Prowess: "Dura critically succeeds at a Strike or Disarm with her Aldori dueling sword", its Strike's.)
    // (Batch 69: on a creature with a condition, "The stone golem hits a Slowed creature" — { condition }; "with a Strike", "with a melee
    // Strike", "with an unarmed Strike" — any Strike, or its kind of weapon; "… on its turn" — { ownTurn }.)
    const turn = / on (?:its|his|her|their) (?:own )?turn$/i.test(trigger);
    // (Batch 82, Brutal Rally: "The gang leader rolls a critical hit against a creature".)
    let own = new RegExp(String.raw`^${SELF} (critically hits|critically succeeds at an attack roll against|rolls a critical hit against|critically succeeds at a Strike(?: or Disarm)?|hits|damages|deals damage to)(?: (?:an?|the) (?:((?:Tiny|Small|Medium|Large|Huge) or smaller) )?(?:(${OWN_HIT_CONDITIONS}) )?(?:creature|foe|enemy|target))?(?: with (?:its|his|her|their|an?) ([\w' -]+?)(?: Strike)?)?(?: and deals damage)?$`).exec(trigger.replace(/ on (?:its|his|her|their) (?:own )?turn$/i, ""));
    if (own) {
        const critical = /^critically|critical hit/i.test(own[1]);
        const named = own[4] ? own[4].toLowerCase() : null;
        const kind = named && /^(?:strike|attack|weapon|weapon strike)$/.test(named) ? "any" : named && /^melee(?: weapon)?(?: strike| attack)?$/.test(named) ? "melee" : named && /^(?:melee )?unarmed(?: strike| attack)?$/.test(named) ? "unarmed" : null;
        return { event: "own-strike", reaction: true, on: critical ? ["criticalSuccess"] : ["success", "criticalSuccess"], strike: kind ? null : named, ...(kind && kind !== "any" ? { weapon: kind } : {}), ...(own[2] ? { maxSize: own[2].split(" ")[0].toLowerCase() } : {}), ...(own[3] ? { condition: own[3].toLowerCase() } : {}), ...(turn ? { ownTurn: true } : {}) };
    }
    // Attacked, before the roll: "A hostile creature targets the jinxer with a melee Strike", "A creature Chafkhem can see makes a
    // melee Strike against Chafkhem", "Adma is targeted with a Strike by a creature within 30 feet".
    own = new RegExp(String.raw`^(?:An?|Any) (?:adjacent |hostile )?(?:creature|foe|enemy)(?: within (\d+) feet)?(?: (?:that )?${SELF} can see)? (?:targets ${SELF} with an? (melee |ranged )?(?:Strike|attack)|makes an? (melee |ranged )?(?:Strike|attack) against ${SELF})$`).exec(trigger)
        ?? new RegExp(String.raw`^${SELF} is targeted (?:with|by) an? (melee or ranged |melee |ranged )?(?:Strike|attack)(?: by (?:a creature|an enemy) within (\d+) feet)?$`).exec(trigger);
    if (own) {
        const words = own.slice(1).join(" ");
        const within = Number(/\b(\d+)\b/.exec(own.slice(1).filter((part) => /^\d+$/.test(part ?? "")).join(" "))?.[1]) || null;
        // (Batch 78: "with a melee or ranged Strike": any.)
        if (/\branged\b/.test(words) && !/\bmelee or ranged\b/.test(words)) return null;
        return { event: "attacked", reaction: true, melee: (/\bmelee\b/.test(words) && !/\bmelee or ranged\b/.test(words)) || /^An? adjacent/.test(trigger), ...(within ? { within } : {}) };
    }
    // A creature starting its turn near it: "A creature within 30 feet that the basilisk can see starts its turn", "A living
    // creature within 30 feet that the bodak can perceive with its Lifesense starts its turn".
    own = new RegExp(String.raw`^(?:An?|Any) (living )?creature within (\d+) feet(?: (?:that )?${SELF} can (?:see|perceive)[^,]*?)? (?:starts|begins) (?:its|their) turn$`).exec(trigger);
    if (own) return { event: "turn-start", reaction: true, within: Number(own[2]), ...(own[1] ? { living: true } : {}) };
    // "The egarhowl rolls initiative" (not "… while in water").
    // (Batch 259: "The cave squirrel rolls initiative or has taken damage before initiative" — as it rolls initiative, the damage before a note.)
    if (new RegExp(String.raw`^${SELF} (?:rolls (?:for )?initiative|is about to roll initiative)(?: or has taken damage before initiative)?$`).test(trigger)) return { event: "initiative", reaction: true };
    // (Batch 139, Daunting Charisma: "The razzle dazzler rolls initiative using Deception or Performance" — only with those, a note live.)
    const using = new RegExp(String.raw`^${SELF} rolls (?:for )?initiative using (Acrobatics|Athletics|Deception|Diplomacy|Intimidation|Performance|Stealth|Survival|Perception)(?: or (Acrobatics|Athletics|Deception|Diplomacy|Intimidation|Performance|Stealth|Survival|Perception))?$`).exec(trigger);
    if (using) return { event: "initiative", reaction: true, skills: [using[1], using[2]].filter(Boolean).map((skill) => skill.toLowerCase()) };
    // (Batch 72: "The director general's turn begins", "The fetch starts its turn" — its own turn starting.)
    if (new RegExp(String.raw`^${SELF}['’]s? turn begins$|^${SELF} (?:starts|begins) (?:its|their|his|her) turn$`).test(trigger)) return { event: "own-turn-start", reaction: true };
    let match = new RegExp(String.raw`^${SELF} (?:is (critically )?hit|takes a (critical) hit)\b(.*)$`).exec(trigger);
    if (match) {
        // (Batch 29: "is hit by an attack or spell attack from an enemy within 30 feet", a made-up example: a hit, from that far.)
        const how = match[3].replace(/\bby an? (Strike|attack) or (?:a )?spell attack\b/i, "by a $1");
        const from = /\s*from (?:a|an) (?:creature|foe|enemy)(?: (?:that|who))?(?: [\w' -]+? can see)? (within \d+ feet)$/i.exec(how);
        return hit({ critical: Boolean(match[1] || match[2]), how: from ? how.slice(0, from.index) : how, within: from ? from[1] : "" });
    }
    // "A Strike deals fire damage to the elemental" (batch 29; a made-up example).
    match = new RegExp(String.raw`^An? (?:attack|Strike) deals ((?:\w+ )?)damage to ${SELF}$`).exec(trigger);
    if (match) return hit({ critical: false, how: `${match[1]}damage` });
    match = new RegExp(String.raw`^(?:An?|Any) (adjacent )?(?:creature|foe|enemy)((?: (?:within|in) [^,]+?)?) (?:successfully )?(critically hits|hits|damages|deals ([\w ,]+?) damage to|[Ss]trikes) ${SELF}\b(.*)$`).exec(trigger);
    if (match) {
        const found = hit({ critical: /^critically/i.test(match[3]), how: `${match[4] ? `${match[4]} damage ` : ""}${match[5]}`, adjacent: Boolean(match[1]), within: match[2] ?? "" });
        // ("Damages it" is a hit that deals damage.)
        return found;
    }
    // (Batch 78: "A creature lands a critical hit with a melee Strike against the vitalia"; a melee Strike that "succeeds" against it, a hit.)
    match = new RegExp(String.raw`^(?:An?|Any) (?:creature|foe|enemy) (?:lands|scores) a critical hit with an? (melee )?Strike against ${SELF}$`).exec(trigger);
    if (match) return hit({ critical: true, how: match[1] ? " with a melee Strike" : "" });
    match = new RegExp(String.raw`^(?:An?|Any) (?:creature|foe|enemy) succeeds at an? (melee )?Strike against ${SELF}$`).exec(trigger);
    if (match) return hit({ critical: false, how: match[1] ? " with a melee Strike" : "" });
    // "A creature scores a critical hit on the firehoof minotaur" (batch 18).
    match = new RegExp(String.raw`^(?:An?|Any) (?:creature|foe|enemy) scores a critical hit (?:on|against) ${SELF}\b(.*)$`).exec(trigger);
    if (match) return hit({ critical: true, how: match[1] });
    // (Batch 29: "The spark troll would take sonic damage", "is dealt fire or cold damage" (made up), "The woodblessed is damaged
    // by a creature within their reach".)
    match = new RegExp(String.raw`^${SELF} (?:is damaged|(?:takes|would take|is dealt) (?:any )?([\w ,]*?)\s*damage)\b(.*)$`).exec(trigger);
    if (match) {
        if (refused(match[1] ?? "") || /\d/.test(match[1] ?? "")) return null;
        const rest = match[2].trim();
        if (/^from (?:a|an) (?:melee |physical )?(?:Strike|attack|weapon)/i.test(rest)) return hit({ critical: false, how: `${match[1] ?? ""} damage ${rest}` });
        if (/^by (?:a|an) (?:creature|foe|enemy) within (?:its|their|his|her) reach$/i.test(rest)) return hit({ critical: false, how: `${match[1] ?? ""} damage`, within: " within reach" });
        if (rest && !/^from any source$/i.test(rest)) return null;
        const damageTypes = types(match[1]);
        return { event: "damaged", reaction: true, ...(damageTypes ? { damageTypes } : {}) };
    }
    return null;
}

// A condition the monster gives itself or its allies (2026-10-10, batch 26): "The will-o'-wisp extinguishes its glow, becoming
// Invisible", "Urok … becomes Concealed", "The peng is Concealed until the end of their next turn", "Racharak is Quickened
// until the end of her turn, and can use the extra action to Stride or Strike" (a free action as its turn begins: trigger
// "own-turn-start"), "All allies who hear or see him are Quickened for 1 round and can use this extra action to …". A
// condition with no roll ("automatic") on itself, or on its allies (in its emanation, or the GM's targets). Quickened,
// Invisible, Concealed or Hidden only. Its other sentences (words only) are notes; its requirements, plan.requires.
const SELF_SLUGS = new Set(["quickened", "invisible", "concealed", "hidden"]);
function selfCondition(item) {
    const type = item.system?.actionType?.value;
    if (!["action", "free", "reaction"].includes(type)) return null;
    const html = String(item.system?.description?.value ?? "");
    if (/@(?:Check|Damage)\[/.test(html)) return null;
    const plain = htmlToPlainText(html.replace(/@(?:UUID|Compendium)\[[^\]]*conditionitems[^\]]*\]\{([^}]*)\}/g, "\u0001$1\u0002").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\[\[\/(?:r|gmr|br) [^\]]*\]\](?:\{([^}]*)\})?/g, "$1")).replace(/\s+/g, " ").trim();
    // A free action as its own turn begins (Shrieking Frenzy, Sudden Surge); other triggers stay the GM's.
    // (Batch 205, Quicken: "Trigger The clay golem's turn begins. It can't trigger this free action on the first turn of combat." — not on its first
    // turn, a note.)
    const rawTrigger = /\bTrigger (.+?) (?:Frequency|Requirements?|Effect)\b/.exec(plain)?.[1] ?? null;
    const notFirst = /\s*It can't trigger this free action on the first turn of combat\.$/i.test(rawTrigger ?? "");
    const trigger = rawTrigger?.replace(/\s*It can't trigger this free action on the first turn of combat\.$/i, "") ?? null;
    const ownTurn = trigger && type === "free" && /^(?:The [\w' -]+?|[A-Z][\w'-]+(?: [A-Z][\w'-]+)?)'s? turn begins\.?$/.test(trigger) ? true : null;
    // (Batch 30: a reaction's trigger the module reads, for temporary Hit Points on itself: "The forest dragon is targeted with a
    // water spell or effect".)
    // (The condition marks out of it: "loses the Frightened condition", batch 46.)
    const reacting = trigger && !ownTurn && type !== "action" ? readReactionTrigger(trigger.replace(/[\u0001\u0002]/g, "")) : null;
    if (trigger && !ownTurn && !reacting) return null;
    const requires = /\bRequirements? (.+?) Effect\b/.exec(plain)?.[1] ?? null;
    const effect = plain.includes("Effect ") ? plain.slice(plain.indexOf("Effect ") + 7) : plain;
    // (Batch 261, Sugar Rush: "For the next 1d4+1 rounds, the melixie is Quickened, and can use the additional action only to Stride or Fly." in the
    // usual order.)
    // (Batch 265, Fade from View: "… becomes Invisible until it uses an attack, manipulate, or move action." — for no set time; when it ends, a note.)
    const untilActs = /\b((?:becomes?|is) \u0001\w+\u0002) until (?:it|they) uses? an attack, manipulate, or move action\./i.test(effect);
    const sentences = effect.replace(/\b((?:becomes?|is) \u0001\w+\u0002) until (?:it|they) uses? an attack, manipulate, or move action\./i, "$1.").replace(/\bFor the next ((?:\d+|\d+d\d+(?:\+\d+)?) rounds), ((?:the [\w' -]+?|it|they)) is (\u0001\w+\u0002), and can use the additional action only to\b/gi, (_all, time, who, slug) => `${who[0].toUpperCase()}${who.slice(1)} is ${slug} for ${time}, and can use the extra action only to`).split(/(?<=\.)\s+/);
    // (The monster itself: not "The animal", "The target", "The creature".)
    const SUBJECT = String.raw`(?:The (?!(?:animal|target|creature|ally|allies|enemy|foe|mount)\b)[\w' -]+?|It|They|He|She|[A-Z][\w'-]+(?: [A-Z][\w'-]+)?)`;
    const DURATION = String.raw`(?: (?:until the (?:end|start|beginning) of (?:its|their|his|her|that ally's|each ally's) (?:next )?turn|this turn|for (?:\d+|one|1d4|1d4\+1|1d6) (?:round|minute)s?(?: \([^)]*\))?))?`;
    // (Batch 223: "… and can use the extra action each round only to Strike".)
    const EXTRA = String.raw`(?:,? (?:and|but) (?:it |they |he |she )?can use (?:this|the|its|their|his|her) extra action(?: each (?:round|turn))? (?:only )?(?:for|to) [^.]+)?`;
    const self = new RegExp(String.raw`^${SUBJECT}(?: [^,.]*?,)? (?:becomes?|becoming|is|are|gains? the) \u0001(\w+)\u0002(?: condition)?(${DURATION})${EXTRA}(?:,[^.]*)?\.$`);
    const going = new RegExp(String.raw`^${SUBJECT} [^,.]+?, becoming \u0001(\w+)\u0002(${DURATION})\.$`);
    // (Batch 26: "Each ally who hears and understands this command", "Allies within 120 feet who hear and understand his order",
    // "All allies within the dragon's heartening aura", "Each other zombie within 10 feet of the dirge piper".)
    // (Batch 89, Bellowing Command: "Each ogre ally who hears and understands this command becomes Quickened …": its own kind.)
    const allies = new RegExp(String.raw`^(?:All |Each )?(?:other )?(?:of (?:its|their|his|her) )?(?:[a-z]+ )?(?:allies|ally|zombies?|undead)(?: within (\d+) feet(?: of [^,.]+?)?| within [^,.]+? aura)?(?: who (?:can )?(?:hears?|sees?)(?: (?:or|and) (?:hears?|sees?|understands?))? [^,.]*?)? (?:become|becomes|are|is) \u0001(\w+)\u0002(${DURATION})${EXTRA}\.$`);
    // Temporary Hit Points on itself (batch 30): "The forest dragon gains 40 temporary Hit Points that last for 1 minute", "gaining 6d8
    // temporary Hit Points that last for 1 minute", "… gains 3 temporary Hit Points that last until the end of her next turn".
    const TEMP_LAST = String.raw`(?:,? (?:that|which) lasts? (?:for )?((?:\d+|one) (?:round|minute|hour)s?|until the (?:end|start|beginning) of (?:its|their|his|her) (?:next )?turn)| for ((?:\d+|one) (?:round|minute)s?))?`;
    const temp = new RegExp(String.raw`^(?:${SUBJECT}(?: [^,.]*?,)? (?:gains?|gaining)|${SUBJECT} [^,.]+?, gaining) (\d+|\d+d\d+(?:\s*\+\s*\d+)?) temporary (?:Hit Points|HP)${TEMP_LAST}\.$`);
    let found = null;
    let at = -1;
    for (const [index, sentence] of sentences.entries()) {
        const gained = temp.exec(sentence);
        if (gained) {
            found = { temp: gained[1].replace(/\s+/g, ""), duration: gained[2] ?? gained[3] ?? "" };
            at = index;
            break;
        }
        const match = self.exec(sentence) ?? going.exec(sentence);
        const group = match ? null : allies.exec(sentence);
        if (!match && !group) continue;
        found = match ? { slug: match[1].toLowerCase(), duration: match[2] } : { slug: group[2].toLowerCase(), duration: group[3], allies: true, within: Number(group[1]) || null };
        at = index;
        break;
    }
    if (!found || (!found.temp && !SELF_SLUGS.has(found.slug))) return null;
    // Its other sentences: words only.
    const notes = [...(notFirst ? ["Not on its first turn of the combat."] : []), ...(untilActs ? ["It lasts until it uses an attack, manipulate or move action."] : [])];
    let recharge = null;
    for (const [index, sentence] of sentences.entries()) {
        if (index === at || /^Frequency\b/.test(sentence)) continue;
        // (Batch 207, Sudden Surge: "The withered can't use Sudden Surge for 1d4 rounds." — its recharge.)
        const again = /^(?:The [\w' -]+?|It|They) can(?:'t|not) use [A-Z][\w' -]+? (?:again )?for (\d+d\d+) rounds\.$/i.exec(sentence);
        if (again) {
            recharge = again[1];
            continue;
        }
        if (/@|\b(?:damage|save|DC)\b|\d+d\d+/.test(sentence)) return null;
        notes.push(sentence.replace(/[\u0001\u0002]/g, ""));
    }
    // ("until the end of her turn" as "… its turn", which the duration reader knows.)
    const said = found.duration?.trim().replace(/\b(?:their|his|her)\b|\b(?:that|each) ally's\b/g, "its") ?? "";
    const spanned = /^(\d+|one) (round|minute|hour)s?$/i.exec(said);
    const duration = spanned ? { mode: "fixed", value: spanned[1] === "one" ? 1 : Number(spanned[1]), unit: `${spanned[2].toLowerCase()}s`, expiry: null, anchor: "effect-start" } : said ? (/this turn/.test(said) ? readDuration("until the end of its turn") : readDuration(said)) : null;
    if (said && !duration) return null;
    const effects = found.temp ? [{ kind: "temp-hp", ...(/^\d+$/.test(found.temp) ? { amount: Number(found.temp) } : { formula: found.temp }), duration: duration ?? null }] : [{ kind: "condition", slug: found.slug, value: null, duration: duration ?? null }];
    const success = { damage: none().damage, effects };
    return {
        ...base(item),
        targeting: found.allies ? { target: found.within ? null : "allies", range: null, area: found.within ? { type: "emanation", value: found.within } : null, allies: true } : { target: "self", range: null, area: null },
        trigger: reacting ? { ...reacting, reaction: true, ...(type === "free" ? { free: true } : {}) } : { event: ownTurn ? "own-turn-start" : "use", ...(ownTurn ? { reaction: true, free: true } : {}), ...(recharge ? { recharge: { formula: recharge, unit: "rounds" } } : {}) },
        resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none(), success, failure: none(), criticalFailure: none() } },
        ...(requires ? { requires } : {}),
        ...(notes.length ? { notes } : {})
    };
}

// The monster healing itself (2026-10-10, batch 24): "Frequency once per round Effect The imp regains 1d6 Hit Points", "The
// quasit restores 1d6 HP to itself", "The canopy elder grows a mesh of vines …, repairing the damage and restoring 40 HP to
// itself. The canopy elder can't use Vine Splint again for 1d4 rounds." A plan of the core's healing family on itself:
// { resolution: { kind: "healing", native: { healing: { components, recipients: "any" } } }, targeting: { target: "self" },
// requires? } (requires: its requirements, which the simulator can't check). Its other sentences are notes for the GM when
// they're only words; not one that also heals or harms others, or heals only sometimes ("If …", "for each enemy …").
const HEALS_ITSELF = /^(?:(?:The |An? )?[\w' -]+?|It|They|He|She)(?:,? [^,.]*?,)? (?:regains?|restores?|heals?)\s+\u0000(?: (?:Hit Points|HP))?(?: to (?:itself|himself|herself|themselves|themself))?(?:,? (?:gaining|with) any excess (?:healing )?as temporary (?:Hit Points|HP)[^.]*)?\.$|,? (?:restoring|regaining) \u0000 (?:Hit Points|HP)(?: to (?:itself|himself|herself|themselves|themself))?(?: in the process)?\.$/;
// Hit Points back as it downs a creature (2026-10-12, batch 140, Absorb Sin): "Trigger The atrixyl reduces a creature it can smell with its
// true sin scent to 0 Hit Points Effect The atrixyl regains 6d6 Hit Points." → the self-heal, set off by downing a creature; which creature
// counts, a note for the GM.
function downsHeal(item) {
    if (!["free", "reaction"].includes(item.system?.actionType?.value)) return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    // (Batch 205, Lifedrinker: "Trigger The balor kills a living creature that is at least 15th level. Effect The balor drinks the triggering creature's
    // life force and regains 10d8+80 Hit Points." — a living creature of that level, a note.)
    const parts = /^Trigger (?:The )?[\w' -]+? (?:reduces a creature (it can smell with its true sin scent )?to 0 (?:HP|Hit Points)|kills a (living )?creature(?: that is at least (\d+)(?:st|nd|rd|th) level)?)\.? Effect (.+)$/i.exec(plain);
    if (!parts) return null;
    const effect = parts[4].replace(/^(?:The )?[\w' -]+? drinks the triggering creature['’]s life force and (regains?)/i, "It $1");
    const heal = selfHeal(withDescription({ ...item, system: { ...item.system, actionType: { value: "action" } } }, `<p>${effect}</p>`));
    if (!heal) return null;
    const note = parts[1] ? "Only a creature it can smell with its true sin scent." : parts[2] || parts[3] ? `Only a ${parts[2] ? "living " : ""}creature it kills${parts[3] ? ` at level ${parts[3]} or above` : ""} counts.` : null;
    return { ...heal, ...base(item), trigger: { event: "downs", reaction: true, ...(item.system?.actionType?.value === "free" ? { free: true } : {}), ...(note ? { note } : {}) } };
}

function selfHeal(item) {
    if (!["action", "free"].includes(item.system?.actionType?.value) || /<strong>\s*Trigger\s*<\/strong>/i.test(item.system?.description?.value ?? "")) return null;
    const html = String(item.system?.description?.value ?? "");
    const tags = inlineTags(html, "Damage");
    // (Batch 192, Draw Bugs: "They regain @Damage[10] HP." — a number of Hit Points with no type.)
    if (tags.length !== 1 || !(/\bhealing\b/i.test(tags[0]) || (/^\d+(?:d\d+)?(?:[+-]\d+)?$/.test(tags[0]) && /\bregains? @Damage\[[^\]]*\] (?:HP|Hit Points)\b/i.test(html)))) return null;
    const plain = htmlToPlainText(html.replace(/@Damage\[[^\]]*\]\]?(?:\{[^}]*\})?/g, "\u0000").replace(/\[\[\/(?:r|gmr|br) [^\]]*\]\](?:\{([^}]*)\})?/g, "$1").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    // (Requirements with no "Effect" label: "Requirements The ravenile's regeneration is currently active The ravenile regains …".)
    // (The labels are capitalised, so a "fear effect" in the requirement doesn't end it — batch 56.)
    const requires = /^(?:Frequency [^.]*?\s+)?Requirements? (.+?)\s+Effect\s/.exec(plain)?.[1] ?? (/\bRequirements?\b/.test(plain) ? (/\bRequirements? (.+?)\s+(?:The |It |They )/.exec(plain)?.[1] ?? "its requirements") : null);
    const effect = plain.replace(/^(?:Frequency .+?\s+)?(?:Requirements? .+?\s+)?Effect\s+/, "").replace(/^Frequency .+?\s+Effect\s+/i, "").replace(/^(?:Frequency [^.]*?\s+)?Requirements? .+?\s+(?=(?:The |It |They ))/, "");
    // (Batch 56, Feed on Fear: "The will-o'wisp feeds on the creature's terror. It regains 2d4 Hit Points, and if it has Gone Dark, its glow
    // reignites." — the first sentence only tells it, the glow is the GM's.)
    // (Batch 213, Mend Soul: "restores 25 HP to itself or an incorporeal creature it has Grabbed" — itself, the creature it holds a note.)
    let orHeld = null;
    // (Batch 234, Battlezoo: healing with an item bonus to some saves after it — the healing; the bonus a note.)
    let gaining = null;
    // (Batch 230, Shed Armor: "They immediately heal 60 Hit Points in a surge of regeneration as they grow …" — the healing; what grows, words.)
    const sentences = effect
        .replace(/,? (?:healing|restoring) \u0000( (?:Hit Points|HP))? and (?:gaining|granting itself) ([^.]+)\./i, (_all, unit, rest) => {
            gaining = `It also gains ${rest}.`;
            return `. It regains \u0000${unit ?? ""}.`;
        })
        .replace(/\s*Effect: [A-Z][\w' -]+$/, "").replace(/,? and (?:if (?:it has|they've|they have) Gone Dark, (?:its|their) glow reignites|its Glow reignites if it had been extinguished)\./i, ". If it has Gone Dark, its glow reignites.").replace(/^They regains\b/, "They regain")
        .replace(/\b(It|They|He|She) immediately (heals?|regains?) \u0000( (?:Hit Points|HP))? in a surge of [^.]+\./, "$1 $2 \u0000$3.")
        .replace(/ (HP|Hit Points) to itself or (an? [\w' -]+? creature) it has Grabbed\./i, (_all, unit, whom) => {
            orHeld = `Or it heals ${whom.toLowerCase()} it has Grabbed instead.`;
            return ` ${unit} to itself.`;
        }).split(/(?<=\.)\s+/)
        .filter((sentence) => !/^(?:The )?[^.]+? feeds on the creature's (?:terror|fear)\.$/i.test(sentence));
    const at = sentences.findIndex((sentence) => /\u0000/.test(sentence));
    // (A wait on another of its abilities is that one's, kept as a note: Voidglutton's "It cannot use Consume Light again for 1d4 rounds".)
    const other = /\bcan(?:'t|not) use ([A-Z][\w' -]+?) again\b/.exec(effect)?.[1];
    const elsewhere = Boolean(other) && other.toLowerCase() !== String(item.name ?? "").toLowerCase();
    if (at < 0 || !HEALS_ITSELF.test(sentences[at]) || /\b(?:to (?:the|an?|each|all|its|their) (?!itself)|allies|ally|each|every|for each|creature|target)\b/i.test(sentences[at].replace(/to (?:itself|himself|herself|themselves|themself)/, ""))) return null;
    // Its other sentences: words only (no roll, no condition), and no condition of their own.
    const notes = [];
    for (const [index, sentence] of sentences.entries()) {
        if (index === at || (!elsewhere && /^(?:It|They|He|She|The [\w' -]+?) can(?:'t|not) use [^.]+ again for \d+d\d+ rounds\.$/i.test(sentence))) continue;
        if (/^If it has Gone Dark, its glow reignites\.$/i.test(sentence)) {
            notes.push(sentence);
            continue;
        }
        // (Batch 154, Change Characters: its masks and what comes with them — the GM's.)
        if ((/\bmasks?\b/i.test(sentence) && !/@|\u0000|\d/.test(sentence)) || /^When [^.]+? Changes Characters, (?:it|they|he|she) gains? access to the listed abilities\.$/i.test(sentence)) {
            notes.push(sentence);
            continue;
        }
        // (Batch 192, Draw Bugs: "… draws more arthropods from the environment around them to reconstitute some of their damaged body." — what it tells;
        // "At the GM's discretion, the swarm strider doesn't recover HP in areas where there aren't enough arthropods …" — the GM's.)
        if (/\bto reconstitute (?:some of )?(?:its|their) damaged body\.$/i.test(sentence) && !/@|\u0000|\d/.test(sentence)) continue;
        if (/^At the GM's discretion, /i.test(sentence) && !/@|\u0000|\d/.test(sentence)) {
            notes.push(sentence);
            continue;
        }
        if (/@|\u0000|\b(?:If|When|Whenever|Unless|While|Until)\b/.test(sentence) || /\b(?:damage|save|Strike|Grabbed|Frightened|Stunned|Slowed|Quickened|bonus|penalty|ally|allies|each|creatures?)\b/i.test(sentence)) return null;
        notes.push(sentence);
    }
    if (orHeld) notes.push(orHeld);
    if (gaining) notes.push(gaining);
    const formula = readDamage(tags[0]).replace(/\[healing\]/i, "").replace(/^\((.*)\)$/, "$1");
    const recharge = elsewhere ? null : readRecharge(html);
    // (Feed on Fear's requirement, for the simulator: "An enemy is under a fear effect or Dying within 15 feet of the will-o'-wisp".)
    const foe = /^An enemy (?:within (\d+) feet )?is (?:under|being affected by|affected by) a fear effect or (?:has the Frightened or )?Dying(?: condition)?,?(?: and is)?(?: within (\d+) feet\b)?/i.exec(requires ?? "");
    return {
        ...base(item),
        ...(foe && (foe[1] ?? foe[2]) ? { requiresFoe: { conditions: ["frightened", "dying"], within: Number(foe[1] ?? foe[2]) } } : {}),
        targeting: { target: "self", range: null, area: null },
        trigger: { event: "use", ...(recharge ? { recharge: { formula: recharge, unit: "rounds" } } : {}) },
        resolution: { kind: "healing", native: { healing: { components: [{ id: "0", formula, kinds: ["healing"] }], recipients: "any" } } },
        ...(requires ? { requires } : {}),
        // (Batch 230, Shed Armor: "this ability can't be used again until 1 hour has passed" — once a fight.)
        ...(/\bcan(?:'t|not) be used again until (?:1|an?|one) (?:hour|day)\b/i.test(effect) ? { oncePerFight: true } : {}),
        ...(notes.length ? { notes } : {})
    };
}

// A passive on a creature it holds, as a turn starts or ends (2026-10-10, batch 20): "A creature that starts its turn grabbed by
// the baatamidar must attempt a Will save …", "When a creature ends its turn Swallowed Whole by the animated wine vessel, it must
// …", "At the end of its turn, all creatures it has grabbed take damage …" (a made-up example). Its trigger:
// { event: "grab-turn", at: "start" | "end", whose: "held" (the held creature's turn) | "own" (the monster's), hold: "grabbed"
// (grabbed or restrained) | "swallowed", living? }; on the held creature.
const GRAB_TURN = /^(?:(?:A|Any|Each) (non-[\w-]+ )?(living )?creature (?:that|who) (starts|begins|ends) (?:its|their) turn (?:while )?(grabbed|restrained|swallowed whole)(?: or (?:grabbed|restrained))? by (?:the |an? )?[\w' -]+?|When an? (living )?creature (ends|starts|begins) its turn (swallowed whole|grabbed|restrained) by (?:the |an? )?[\w' -]+?|At the (start|end) of (?:the |its |their )?[\w' -]*?turn, (?:all |each )?(?:creatures?|targets?) (grabbed|restrained) by (?:the |an? |it)?[\w' -]*?)(,? (?:it |they )?)(?=(?:must|takes?|is|are|becomes?|experiences|gains?)\b)/i;
function grabTurnClause(item) {
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1"));
    for (const sentence of plain.split(/(?<=[.!?])\s+/)) {
        const match = GRAB_TURN.exec(sentence);
        if (!match) continue;
        const at = /^(?:start|starts|begin|begins)$/i.test(match[3] ?? match[6] ?? match[8]) ? "start" : "end";
        const hold = /swallowed/i.test(match[4] ?? match[7] ?? match[9] ?? "") ? "swallowed" : "grabbed";
        return { trigger: { event: "grab-turn", at, whose: match[8] ? "own" : "held", hold, ...(match[2] || match[5] || match[1] ? { living: true } : {}) }, clause: match[0] };
    }
    return null;
}

function grabTurn(item, plan) {
    if (item.system?.actionType?.value !== "passive" || plan?.trigger?.event !== "passive" || !plan.resolution) return null;
    const read = grabTurnClause(item);
    return read ? { ...plan, targeting: { target: "the held creature", range: "touch", area: null }, trigger: { ...plan.trigger, ...read.trigger } } : null;
}

// One not read yet ("A creature that starts its turn Grabbed by the doprillu takes 2d6 fire damage"): the held creature as its
// subject, then its save or its results.
function grabTurnReading(item, actor) {
    if (item.system?.actionType?.value !== "passive") return null;
    const read = grabTurnClause(item);
    if (!read) return null;
    const html = String(item.system?.description?.value ?? "").replace(/@UUID\[Compendium\.pf2e\.conditionitems\.[^\]]*\]\{((?:Grabbed|Restrained|grabbed|restrained))\}/g, "$1");
    const lead = read.clause.split(/\s+/).slice(0, 4).join("\\s+");
    const rewritten = html.replace(new RegExp(`${lead}[^.<]*?(?:,\\s*(?:it |they )?|\\s+)(?=(?:must|takes?|is|are|becomes?|experiences|gains?)\\b)`, "i"), "The target ").replace(/The target take\b/, "The target takes").replace(/The target are\b/, "The target is");
    if (rewritten === html) return null;
    let plan = null;
    try {
        plan = inlineSave(withDescription(item, rewritten), actor, { afterHit: true }) ?? automaticEffect(withDescription(item, rewritten), actor, { rider: true });
    } catch {
        plan = null;
    }
    return plan?.resolution ? { ...plan, targeting: { target: "the held creature", range: "touch", area: null }, trigger: { ...plan.trigger, ...read.trigger } } : null;
}

// A passive that answers damage on the monster (2026-10-10, batch 19): "When the penanggalan takes slashing damage, their wound
// spews bile on adjacent creatures, dealing 2d10 poison damage (basic Fortitude)", "Whenever the festrog takes piercing or
// slashing damage, creatures adjacent to the festrog take …", "Each time an adjacent creature deals slashing or piercing damage
// to the brimorak, the attacker is sprayed …", "If the arboreal snag takes damage from a piercing attack, …". As batch 16's
// reactions read them: { event: "damaged", damageTypes } or { event: "hit-by", melee, damageTypes }, with no reaction. Not the
// first time each round only, nor damage "from a source other than itself".
function damagedPassive(item, plan) {
    if (item.system?.actionType?.value !== "passive" || plan?.trigger?.event !== "passive" || !plan.resolution) return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1"));
    const sentences = plain.split(/(?<=[.!?])\s+/);
    const at = sentences.findIndex((sentence) => /^(?:When(?:ever)?|If|Each time|Any time) /.test(sentence));
    if (at < 0) return null;
    const lead = /^(?:When(?:ever)?|If|Each time|Any time) (.+?), (?!or\b)/.exec(sentences[at])?.[1];
    if (!lead || /\b(?:first time|other than|while|unless)\b/i.test(lead)) return null;
    // "an adjacent creature deals slashing or piercing damage to the brimorak": its words as a reaction's trigger reads them.
    // ("a husk takes fire damage": the monster itself, as "the husk".)
    const words = lead.replace(/^an? (?!(?:adjacent )?(?:creature|enemy|foe|target)\b)(?=[\w' -]+? (?:takes|is damaged)\b)/i, "the ")
        .replace(/^(an? (?:adjacent )?creature) deals ([\w ,]+?) damage to (.+)$/i, (whole, who, types, self) => `${who} deals ${types} damage to ${self}`)
        .replace(/ takes damage from an? ([a-z]+) attack$/i, " takes $1 damage from an attack")
        .replace(/ or triggers one of [^,]+$/i, "");
    const trigger = readReactionTrigger(words.charAt(0).toUpperCase() + words.slice(1));
    if (!trigger || !["damaged", "hit-by"].includes(trigger.event)) return null;
    const { reaction, ...own } = trigger;
    const effect = sentences.slice(at).join(" ").slice(lead.length);
    const first = /\b(?:the|a|an|any|each|all|every|adjacent|random) (?:[\w-]+ )?creatures?\b/i.exec(effect)?.[0] ?? "";
    const onAttacker = trigger.event === "hit-by" && !plan.targeting?.area && (ATTACKER.test(effect) || /^the creature$/i.test(first) || /^,?\s*(?:it|they) must\b/i.test(effect.trim()));
    const around = !plan.targeting?.area && !onAttacker ? (/\b(?:on|to|all|each) adjacent creatures\b|\bcreatures? adjacent to\b|^(?:all |each )?adjacent creatures\b/i.test(effect) ? 5 : Number(/(?:\b(?:any|each|every|all) (?:[\w-]+ )?creatures?|(?:^|[.!?]\s+)Creatures) within (\d+) feet\b/i.exec(effect)?.[1]) || null) : null;
    const targeting = onAttacker ? { target: "the attacker", range: "touch", area: null } : around ? { target: null, range: null, area: { type: "emanation", value: around } } : plan.targeting?.area ? plan.targeting : null;
    if (!targeting) return null;
    return { ...plan, targeting, trigger: { ...plan.trigger, ...own } };
}

// A passive its own Strike sets off, on the creature it hit (2026-10-10, batch 19): "When the gunmarshal makes a critical hit with
// a firearm, the target must succeed at a … save or be Stunned 1" (critical specializations), "When the kurobozu scores a
// critical hit with an unarmed attack, …", "When the tough deals damage on a critical hit, …", "When a target takes damage from
// one of the dragon's melee Strikes, it must …". { event: "own-strike", on, weapon?: "firearm" | "unarmed" | "brawling" | "melee",
// strike?: a Strike's name }. Not another creature's hit ("When a creature scores a critical hit against the tolokand").
function ownStrikePassive(item, plan) {
    if (item.system?.actionType?.value !== "passive" || plan?.trigger?.event !== "passive" || !plan.resolution) return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1"));
    const lead = plain.split(/(?<=[.!?])\s+/).map((sentence) => /^(When(?:ever)?|If) (.+?), /.exec(sentence)).find(Boolean);
    if (!lead) return null;
    const clause = lead[2];
    let match = /^(?!(?:a|an|any) (?:creature|enemy|foe)\b)(?:the )?[\w' -]+? (?:makes|scores|gets|rolls|lands) a critical hit(?: with (?:a |an |its |his |her |their )?([\w' -]+?))?$/i.exec(clause)
        ?? /^(?!(?:a|an|any) (?:creature|enemy|foe)\b)(?:the )?[\w' -]+? deals damage (?:on|with) a critical hit(?: with (?:a |an |its |his |her |their )?([\w' -]+?))?$/i.exec(clause);
    let on = ["criticalSuccess"];
    if (!match) {
        match = /^a (?:target|creature) takes damage from (?:one of )?(?:the )?[\w' -]+?'s? ((?:melee )?(?:[\w' -]+ )?Strikes?)$/i.exec(clause);
        on = ["success", "criticalSuccess"];
    }
    if (!match) return null;
    const how = String(match[1] ?? "").toLowerCase();
    const weapon = /\bfirearm/.test(how) ? "firearm" : /\bunarmed\b/.test(how) ? "unarmed" : /\bbrawling\b/.test(how) ? "brawling" : /^melee strikes?$/.test(how) ? "melee" : null;
    const strike = !weapon && how ? (/^([\w' -]+?) strikes?$/.exec(how)?.[1] ?? null) : null;
    if (how && !weapon && !strike) return null;
    return { ...plan, targeting: { target: "the creature the Strike hits", range: "touch", area: null }, trigger: { ...plan.trigger, event: "own-strike", on, ...(weapon ? { weapon } : {}), ...(strike ? { strike } : {}) } };
}

// A reaction to a creature acting near it, as Reactive Strike's triggers go, with results of its own (2026-10-10, batch 22): "A
// creature within the razorbones' reach uses a manipulate action or a move action or leaves a square during a move action it's
// using", "An enemy within 5 feet of the arboreal copse uses …, makes a ranged attack, or …", "A creature within 30 feet
// Strides", "A creature the brine dragon observes within 30 feet uses a concentrate action", "A creature enters the
// thunderbird's reach or uses a move action within their reach", "A creature moves adjacent to the pakalchi".
// { event: "provoke", reaction: true, triggers: ["move", "leave", "enter", "manipulate", "ranged", "concentrate"], within: feet |
// "reach" }. Not one in a place ("in area A7", "in the bridge's area", an aura it leaves).
function provokeTrigger(text) {
    // (Batch 68: a closing aside in brackets, "(move actions using only a fly Speed don't trigger this)", left out.)
    let trigger = String(text).replace(/\s*\([^)]*\)$/, "").replace(/\s+it(?:'|’)s using$/, "").replace(/\.$/, "").replace(/\bmanipulate or move action\b/g, "manipulate-or-move action")
        // (Batch 242, Lurking Death: "uses an action that has the concentrate, manipulate, or move trait" — each its own.)
        .replace(/\buses? an action (with|that has) the (concentrate|manipulate|move), (concentrate|manipulate|move),? or (concentrate|manipulate|move) trait\b/g, "uses an action $1 the $2 trait, uses an action $1 the $3 trait, uses an action $1 the $4 trait");
    // (Batch 137, Kneecapper: "A Medium creature within the nuglub's reach …" — only a creature of that size.)
    const sized = /^An? (Tiny|Small|Medium|Large|Huge|Gargantuan) creature\b/.exec(trigger);
    if (sized) trigger = trigger.replace(sized[0], "A creature");
    // (Batch 68: "in the grick's reach", "within a clockwork sentry's reach", "within reach of Racharak's tail".)
    const subject = new RegExp(String.raw`^(?:An?|Any) (adjacent )?(?:creature|enemy|foe)(?: (?:that )?${SELF} (?:observes|can see))?(?: (?:within|in) (?:(\d+) feet|a @Template\[[^\]]*?distance:(\d+)[^\]]*\](?:\{[^}]*\})?|(?:${SELF}|an? [\w' -]+?)'s? reach|reach|(${SELF}))(?: of ${SELF}(?:['’]s [\w' -]+?)?)?| (adjacent) to ${SELF})?(?: (?:that )?${SELF} (?:observes|can see))? ((?:uses?|makes?|leaves?|Strides|enters|moves|attempts|tries|takes)\b.*)$`).exec(trigger);
    if (!subject) return null;
    const rest = subject[6];
    const triggers = new Set();
    // (Within the swarm, "adjacent": 5 feet.)
    let within = subject[1] || subject[5] || subject[4] ? 5 : Number(subject[2] ?? subject[3]) || (/ within [^ ]+? reach| within reach/.test(trigger.slice(0, trigger.length - rest.length)) ? "reach" : null);
    for (const part of rest.split(/,? or |, /).map((piece) => piece.trim()).filter(Boolean)) {
        if (/^uses? (?:a |an )?manipulate-or-move action$/i.test(part)) triggers.add("manipulate").add("move");
        else if (new RegExp(String.raw`^leaves? a (?:square|space) within ${SELF}'s? reach$`).test(part)) {
            triggers.add("leave");
            within ??= "reach";
        }
        else if (/^(?:uses? )?(?:a |an )?(manipulate|move|concentrate) action$/i.test(part)) triggers.add(/manipulate/i.test(part) ? "manipulate" : /concentrate/i.test(part) ? "concentrate" : "move");
        else if (/^(?:uses? )?an action (?:with|that has) the (manipulate|move|concentrate) trait$/i.test(part)) triggers.add(/manipulate/.test(part) ? "manipulate" : /concentrate/.test(part) ? "concentrate" : "move");
        // (Batch 68: "uses an action with the move trait to leave a square", "uses a move action to leave a square adjacent to the
        // ragewight", "leaves a space within the constable's reach during its move".)
        else if (/^uses? an action with the move trait to leave a (?:square|space)$/i.test(part)) triggers.add("move");
        else if (new RegExp(String.raw`^uses? a move action to leave a (?:square|space) adjacent to ${SELF}$`).test(part)) {
            triggers.add("move");
            within = 5;
        } else if (new RegExp(String.raw`^leaves? a (?:square|space) within ${SELF}'s? reach during (?:its|their|his|her) move(?: action)?$`).test(part)) {
            triggers.add("leave");
            within ??= "reach";
        }
        else if (/^makes? a ranged attack$/i.test(part)) triggers.add("ranged");
        // (Batch 225: "uses an auditory action", Auditory Swipe's and Disruptive Screech's; "uses an action that would restore Hit Points", Clinch
        // Victory's — a healing action.)
        else if (/^uses? an? auditory action$/i.test(part)) triggers.add("auditory");
        // (Batch 227, Battlezoo: Standing up in its reach; an attempt at a move action beside it, or at one that leaves a square near it — moves.)
        else if (/^uses? the Stand action$/i.test(part)) triggers.add("stand");
        else if (/^(?:attempts|tries) to use a move action$/i.test(part)) triggers.add("move");
        else if (new RegExp(String.raw`^(?:attempts|tries) to uses? an action with the move trait to (?:exit|leave) a (?:square|space) within (\d+) feet of ${SELF}$`).test(part)) {
            triggers.add("leave");
            within = Number(/within (\d+) feet/.exec(part)[1]);
        }
        else if (/^uses? an action that would restore Hit Points$/i.test(part)) triggers.add("healing");
        // (Batch 254, Objection!: "takes an action with the linguistic trait".)
        else if (/^(?:takes|uses) an action (?:with|that has) the (linguistic|auditory) trait$/i.test(part)) triggers.add(/linguistic/i.test(part) ? "linguistic" : "auditory");
        else if (/^leaves? (?:a|an adjacent) (?:square|space)(?: in the area)?(?: during (?:a|its|their) move action)?$/i.test(part)) triggers.add("leave");
        else if (/^Strides$/.test(part)) triggers.add("move");
        // (Batch 244, Cling: "A creature leaves the swarm's space" — one in its space leaving it.)
        else if (new RegExp(String.raw`^leaves ${SELF}['’]s? space$`).test(part)) {
            triggers.add("leave");
            within = 0;
        }
        else if (new RegExp(String.raw`^enters ${SELF}'s? reach$`).test(part)) {
            triggers.add("enter");
            within ??= "reach";
        } else if (/^uses? a move action within (?:their|its|his|her) reach$/i.test(part)) {
            triggers.add("move");
            within ??= "reach";
        } else if (new RegExp(String.raw`^moves adjacent to ${SELF}$`).test(part)) {
            triggers.add("enter");
            within = 5;
        } else return null;
    }
    if (!triggers.size) return null;
    // "A creature leaves a space within Kas Xi Rai's reach".
    return { event: "provoke", reaction: true, triggers: [...triggers], within: within ?? "reach", ...(sized ? { sizes: [sized[1].toLowerCase()] } : {}) };
}

// "targets the hound with a mental effect" (2026-10-10, batch 17): { event: "targeted-by", traits, spells? } (spells: any spell
// too, "with a mental effect or spell"); null for anything else ("a divination spell that has the mental trait").
const TRAIT_WORDS = new Set(["mental", "auditory", "linguistic", "emotion", "fear", "visual", "sonic", "olfactory", "water", "earth", "air", "fire", "cold", "electricity", "acid", "plant", "wood", "metal", "vitality", "void"]);
function targetedWith(text) {
    const said = String(text).trim().replace(/[.;,]\s*$/, "");
    // (Batch 30: "The forest dragon is targeted with a water spell or effect": its trait's spells and effects.)
    const passive = new RegExp(String.raw`^${SELF} is targeted (?:with|by) an? (\w+(?: or \w+)?) (?:spell or effect|effect or spell|spell|effect)$`).exec(said);
    if (passive) {
        const traits = passive[1].split(" or ");
        return traits.every((trait) => TRAIT_WORDS.has(trait)) ? { event: "targeted-by", traits } : null;
    }
    // (Batch 263: "A creature targets the blarghest with a hostile action" — anything aimed at it; "… with a hostile spell that has a verbal
    // component" — a spell aimed at it, the verbal component the GM's.)
    const hostile = new RegExp(String.raw`^(?:A|An|Any) (?:creature|foe|enemy) targets ${SELF} with a hostile (action|spell)( that has a verbal component)?$`, "i").exec(said);
    if (hostile) return { event: "targeted-by", traits: [], ...(hostile[1].toLowerCase() === "spell" ? { spells: true, ...(hostile[2] ? { verbal: true } : {}) } : { any: true }) };
    // (Batch 274, Wild Trickery: "An enemy within 60 feet targets the warden with an attack, spell, or other ability" — anything aimed at it; its
    // ", or …" already cut.)
    const anything = new RegExp(String.raw`^(?:A|An|Any) (?:creature|foe|enemy)(?: within (\d+) feet)? targets ${SELF} with an attack, spell(?:,? or other ability)?$`, "i").exec(said);
    if (anything) return { event: "targeted-by", traits: [], any: true, ...(anything[1] ? { within: Number(anything[1]) } : {}) };
    const match = new RegExp(String.raw`^(?:(?:Whenever|When|If|Each time) )?(?:A|An|Any|a|an|any) (?:creature|foe|enemy) (?:attempts to target|targets) ${SELF} with an? ((?:magical )?\w+(?: or \w+)?) effect( or spell)?$`).exec(said);
    if (!match) return null;
    const traits = match[1].replace(/^magical /, "").split(" or ");
    if (!traits.every((trait) => TRAIT_WORDS.has(trait))) return null;
    return { event: "targeted-by", traits, ...(match[2] ? { spells: true } : {}) };
}

// A passive that answers a mental effect aimed at it ("Whenever a creature targets the hound with a mental effect, that
// creature takes 8d6 mental damage (basic Will save)", Otherworldly Mind; batch 17): on the creature that targeted it.
function targetedBy(item, plan) {
    if (item.system?.actionType?.value !== "passive" || plan?.trigger?.event !== "passive" || !plan.resolution) return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1"));
    const clause = plain.split(/(?<=[.!?])\s+/).map((sentence) => /^(.+?),? (?:that creature|the creature|it|they) (?:takes?|must|is|becomes?)\b/.exec(sentence)?.[1]).find((lead) => lead && targetedWith(lead));
    if (!clause) return null;
    return { ...plan, targeting: { target: "the attacker", range: "touch", area: null }, trigger: { ...plan.trigger, ...targetedWith(clause) } };
}

function reactionTrigger(item, plan, actor = null) {
    // (A free action with a trigger too: Chilling Cry's "Trigger Losko rolls initiative"; its trigger.free.)
    const type = item.system?.actionType?.value;
    if (!["reaction", "free"].includes(type) || !plan?.resolution || plan.builtin || (plan.trigger?.event ?? "use") !== "use") return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1"));
    const text = /\bTrigger\s+(.+?)\s*(?:\bEffect\b|\bRequirements?\b|\bFrequency\b|$)/s.exec(plain)?.[1];
    const read = text ? readReactionTrigger(text) : null;
    if (!read) return null;
    const trigger = type === "free" ? { ...read, reaction: true, free: true } : read;
    const effect = plain.split(/\bEffect\b/).slice(1).join(" ");
    // (Batch 72: its own turn starting — not with a requirement, nor a hazard's, whose card its hazard flow posts.)
    if (trigger.event === "own-turn-start" && (/\bRequirements?\b/.test(plain) || (actor ?? item.actor ?? item.parent)?.type === "hazard")) return null;
    // (Batch 69: not a save that only a critical hit brings, after a choice on any hit — "On a critical hit, the target must also
    // attempt a … save", Critical Debilitating Strike: the GM's, as before.)
    if (trigger.event === "own-strike" && trigger.on.includes("success") && /\bOn a critical hit\b/i.test(effect)) return null;
    // Not a lasting area it leaves ("… creating an aura of difficult terrain …; a creature who starts their turn in the area takes …").
    if (trigger.event !== "turn-start" && /\b(?:starts?|begins?|ends?) (?:its|their|his|her) turn\b/i.test(effect)) return null;
    // Its targets: the attacker when it names it, or when "the creature" is the first it names ("The dragon's blood sprays on
    // the creature"); the creatures around it ("sprays its acidic blood on adjacent creatures", "Any creature within 10 feet of
    // the speaker"); otherwise the GM's.
    const first = /\b(?:the|a|an|any|each|all|every|adjacent|random) (?:[\w-]+ )?creatures?\b/i.exec(effect)?.[0] ?? "";
    // (The creature that set it off when it targets one creature: the one attacking it, starting its turn near it.)
    // (Not "chooses a different creature … and attempts to swap places with that creature".)
    const other = /\b(?:a different|another) creature\b/i.test(effect);
    const single = !other && ["attacked", "turn-start", "provoke"].includes(trigger.event) && plan.targeting?.target === "1 creature";
    const onAttacker = !other && !["death", "own-strike", "initiative", "own-turn-start"].includes(trigger.event) && !plan.targeting?.area && (single || ATTACKER.test(effect) || /^the creature$/i.test(first));
    const around = !plan.targeting?.area && !onAttacker && trigger.event !== "own-strike" ? (/^(?:all |each )?adjacent creatures\b/i.test(first) || /\b(?:on|to|all|each) adjacent creatures\b/i.test(effect) ? 5 : Number(/(?:\b(?:any|each|every|all) (?:[\w-]+ )?creatures?|(?:^|[.!?]\s+)Creatures) within (\d+) feet\b/i.exec(effect)?.[1]) || null) : null;
    // Its own Strike's: on the creature it hit, or around it ("a blast of lightning in a 10-foot burst centered on the target").
    const struck = trigger.event === "own-strike" ? (plan.targeting?.area ? { ...plan.targeting, area: { ...plan.targeting.area, around: "target" } } : { target: "the creature the Strike hits", range: "touch", area: null }) : null;
    const targeting = struck ?? (onAttacker ? { target: "the attacker", range: "touch", area: null } : around ? { target: null, range: null, area: { type: "emanation", value: around } } : null);
    return { ...plan, ...(targeting ? { targeting } : {}), trigger: { ...plan.trigger, ...trigger } };
}

// A passive that answers a hit on the monster (2026-10-10): "A creature that hits a pukwudgie with an unarmed Strike or a
// non-reach melee Strike takes 3d8 piercing damage (basic Reflex)", "A creature that touches the caustic monitor takes …",
// "Any creature that successfully attacks the dragon with a melee unarmed attack must make a … save". Its trigger: a melee
// hit on it ({ event: "hit-by", unarmed: true } when only an unarmed attack, or a touch, sets it off), on the attacker.
const HIT_BY = /^(?:(?:A|Any|Each) (?:adjacent |living )?(?:creature|foe|enemy)(?: (?:that|who))?|Anyone who|(?:When|Whenever|If) (?:a|an|any) (?:adjacent )?creature) (?:successfully )?(?:hits|touches|Strikes|strikes|attacks|grapples)\b([^.]*?)(?=,? (?:takes?|must|is|becomes?|gains?)\b|, (?:that creature|the creature|it|they)\b)/i;
function hitByTrigger(item) {
    // (Its sentence that says so, after any that only describe it: "The sparking zombie … crackles with electricity. A creature
    // that hits the zombie with an unarmed Strike takes 5 electricity damage.")
    const sentences = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).trim().split(/(?<=\.)\s+(?=[A-Z])/);
    const match = sentences.map((sentence) => HIT_BY.exec(sentence)).find(Boolean);
    if (!match) return null;
    const how = match[0];
    // Only some creatures or weapons ("with a metal weapon", "while it's on fire"), the weapon's own damage, exposure to an
    // affliction, a ranged attack or a spell, or the monster's body after it dies ("touches Agyra's body within 1 hour of her
    // death"): not read here.
    if (/\b(?:metal|wooden|while|first time|slowed|frightened|ranged|thrown|spells?|body|corpse|remains|death|dead)\b/i.test(how)) return null;
    const unarmed = /\bunarmed\b|\btouches\b|\bgrapples\b/i.test(how) && !/\bmelee (?:attack|Strike|weapon)\b|\bnon-reach\b|\bweapon\b/i.test(how.replace(/\bmelee unarmed\b/i, "unarmed"));
    return { event: "hit-by", melee: true, ...(unarmed ? { unarmed: true } : {}) };
}

// A passive already read with its save ("takes 3d8 piercing damage (basic Reflex save)"): set off by the hit on it.
function hitBy(item, plan) {
    if (item.system?.actionType?.value !== "passive" || plan?.trigger?.event !== "passive" || !plan.resolution) return null;
    const trigger = hitByTrigger(item);
    if (!trigger) return null;
    return { ...plan, targeting: { target: "the attacker", range: "touch", area: null }, trigger: { ...plan.trigger, ...trigger } };
}

// One not read yet: the attacker as its subject ("The target takes 5 electricity damage"), then its save or its results.
function hitByReading(item, actor) {
    if (item.system?.actionType?.value !== "passive" || !hitByTrigger(item)) return null;
    // (Actions named in it as words: "including @UUID[…]{Grappling} it".)
    const html = String(item.system?.description?.value ?? "").replace(/@UUID\[Compendium\.pf2e\.actionspf2e\.[^\]]*\]\{([^}]*)\}/g, "$1");
    const rewritten = html.replace(/((?:^|<p>|(?<=\.)\s+)\s*)((?:(?:A|Any|Each) (?:adjacent |living )?(?:creature|foe|enemy)(?: (?:that|who))?|Anyone who) (?:successfully )?(?:hits|touches|Strikes|strikes|attacks|grapples)\b[^.<]*?)(,? )?(?=(?:takes?|must|is|becomes?|gains?)\b)/i, (whole, lead) => `${lead}The target `)
        .replace(/((?:^|<p>|(?<=\.)\s+)\s*)(?:When|Whenever|If) (?:a|an|any) (?:adjacent )?creature (?:successfully )?(?:hits|touches|Strikes|strikes|attacks|grapples)\b[^.<]*?, (?:that creature|the creature|it|they) /i, (whole, lead) => `${lead}The target `);
    if (rewritten === html) return null;
    const own = withDescription(item, rewritten);
    let plan = null;
    try {
        plan = inlineSave(own, actor, { afterHit: true }) ?? automaticEffect(own, actor, { rider: true });
    } catch {
        plan = null;
    }
    return plan?.resolution ? hitBy(item, { ...plan, trigger: { ...plan.trigger, event: "passive" } }) : null;
}

// A passive that acts as the monster dies, with no roll ("When the flaming skull dies, it explodes, dealing 2d6 fire damage to
// each creature within 10 feet"; 2026-10-10): its "When … dies," clause dropped, its results on the creatures around it.
function deathReading(item, actor) {
    if (item.system?.actionType?.value !== "passive") return null;
    const html = String(item.system?.description?.value ?? "");
    const plain = htmlToPlainText(html);
    if (!DIES.test(plain)) return null;
    const trimmed = html.replace(/^(\s*(?:<p>)?\s*)(?:When|Whenever|As|Upon|If)\b[^.<]*?\b(?:dies|is (?:killed|destroyed|slain|reduced to 0 (?:Hit Points|HP))|reaches 0 (?:Hit Points|HP))\b[^,.<]*, (?:(?:it|they|he|she|its body) [^,.<]*?, )?([a-z])/i, (whole, lead, letter) => `${lead}${letter.toUpperCase()}`);
    if (trimmed === html) return null;
    let plan = null;
    try {
        plan = automaticEffect(withDescription(item, trimmed), actor, { rider: true });
    } catch {
        plan = null;
    }
    if (!plan) return deathHeal(item);
    const area = plan.targeting?.area ?? (/\badjacent creatures?\b|\beach (?:creature|enemy) adjacent\b/i.test(plain) ? { type: "emanation", value: 5 } : /\bwithin (\d+) feet\b/i.exec(plain) ? { type: "emanation", value: Number(/\bwithin (\d+) feet\b/i.exec(plain)[1]) } : null);
    return { ...plan, targeting: { target: null, range: null, area }, trigger: { ...plan.trigger, event: "death" } };
}

// Verdant Burst (2026-10-10, batch 28): "When a leshy dies, a burst of primal energy explodes from its body, restoring 2d8 Hit
// Points to each plant creature in a 30-foot emanation. This area is filled with …, becoming difficult terrain. …" → a death plan
// of the core's healing family on the creatures of that kind in the area (targeting.traits: { all, any }: "each undead fungi or
// plant creature" is { all: ["undead"], any: ["fungus", "plant"] }). Its other sentences are the GM's notes.
const DEATH_HEAL = /^(.*?\b(?:dies|is (?:killed|destroyed|slain))\b[^.]*?\brestor(?:ing|es) )\u0000(?: (?:Hit Points|HP))? to each (undead )?((?:plant|fungi|fungus)(?: or (?:plant|fungi|fungus))?) creature (?:in|within) an? (\d+)-foot emanation(?: and [^.]+)?\.$/i;
function deathHeal(item) {
    const html = String(item.system?.description?.value ?? "");
    const tags = inlineTags(html, "Damage");
    if (!tags.length || !/\bhealing\b/i.test(tags[0])) return null;
    const plain = htmlToPlainText(html.replace(/@Template\[(?:type:)?emanation\|distance:(\d+)\](?:\{[^}]*\})?/gi, "$1-foot emanation").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    let at = 0;
    const masked = plain.replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g, () => (at++ === 0 ? "\u0000" : `${readDamage(tags[at - 1]).replace(/\[([a-z]+)\]$/i, " $1")}`));
    const [first, ...rest] = masked.split(/(?<=\.)\s+/);
    const match = DEATH_HEAL.exec(first);
    if (!match || rest.some((sentence) => /\u0000|@Check\[/.test(sentence))) return null;
    const kinds = match[3].toLowerCase().split(/ or /).map((kind) => (kind === "plant" ? "plant" : "fungus"));
    const formula = readDamage(tags[0]).replace(/\[healing(?:,(?:vitality|void))?\]$/i, "").replace(/^\((.*)\)$/, "$1");
    return {
        ...base(item),
        targeting: { target: null, range: null, area: { type: "emanation", value: Number(match[4]) }, traits: { ...(match[2] ? { all: ["undead"] } : {}), any: kinds } },
        trigger: { event: "death" },
        resolution: { kind: "healing", native: { healing: { components: [{ id: "0", formula, kinds: ["healing"] }], recipients: "any" } } },
        ...(rest.length ? { notes: rest } : {})
    };
}

// A passive its Strikes list, read as what their hit brings (2026-10-10): its trigger clause dropped ("When the devourer damages
// a living creature with its claw Strike, the devourer gains 10 temporary Hit Points and the creature must succeed at a …
// save or become Drained 1"), the Strike it names allowed, then its save or its results with no roll.
function riderReading(item, actor) {
    if (item.system?.actionType?.value !== "passive") return null;
    const html = String(item.system?.description?.value ?? "");
    // Not on a miss too ("regardless of whether or not it hit"), nor on only some hits ("If the gecko hits a Small or smaller
    // creature …, and the target is made of metal", "against a creature that's taking persistent bleed damage").
    if (/\bregardless of whether\b/i.test(htmlToPlainText(html))) return null;
    // (A hit or damage it deals, as a verb: not "If the creature is already taking persistent fire damage, …".)
    const CLAUSE = /(^|<p>|(?<=[.!?])\s+)(?:If|When(?:ever)?) (?:the |a |an )?[^,.<]{0,80}?\b(?:hits?|damages|critically hits?|strikes?)\b[^,.<]{0,80}?, ([a-z])/gi;
    if ([...html.matchAll(CLAUSE)].some((match) => /\b(?:that's|that is|that has|that qualifies|that deals|who|which|whose|already|taking|while|holy|unholy|good|evil|made of|wearing|metal|smaller|larger|Tiny|Small|Medium|Large|Huge|and the)\b/i.test(match[0].replace(/^\W*(?:<p>)?\s*(?:If|When(?:ever)?)\b/i, "")))) return null;
    // (Batch 28: "A creature hit by the voidworm's tail Strike is …", "Any creature damaged by the wraith's claw Strike must …":
    // the creature hit as the subject.)
    // ("critically hit by" only when the whole passive is a critical hit's: Slimy Guts' second sentence isn't the hit's.)
    const SUBJECT = new RegExp(`(^|<p>|(?<=[.!?])\\s+)(?:(?:A|Any|Each) (?:living )?creature|(?:All )?Creatures) (?:that (?:is|are) |who (?:is|are) )?${criticalOnly(item) ? "(?:critically )?" : ""}(?:hit|damaged|struck)(?: and damaged)? by (?:the |a |an )?[\\w' -]+?['’]s? [\\w -]+? (?:Strike|attack)s?\\s+(is|are|becomes?|must|takes?)\\b`, "gi");
    const trimmed = html.replace(CLAUSE, (whole, lead, letter) => `${lead}${letter.toUpperCase()}`).replace(SUBJECT, (whole, lead, verb) => `${lead}The target ${{ are: "is", become: "becomes", take: "takes" }[verb.toLowerCase()] ?? verb}`);
    // (Batch 34: a critical hit's alternative, "Enfeebled 1 (or Enfeebled 2 on a critical hit)", "Dazzled (or Blinded on a critical
    // hit)", "Dazzled for 2 rounds, or for 4 rounds on a critical hit" (made up): the hit's words and the critical hit's, each read.)
    const variants = criticalVariants(trimmed);
    const own = withDescription(item, trimmed);
    let plan = null;
    try {
        const both = variants ? byStrikeDegree(automaticEffect(withDescription(item, variants.hit), actor, { rider: true }), automaticEffect(withDescription(item, variants.critical), actor, { rider: true })) : null;
        plan = both ?? inlineSave(own, actor, { afterHit: true }) ?? automaticEffect(own, actor, { rider: true });
    } catch {
        plan = null;
    }
    return listedRider(item, actor, plan);
}

// The hit's and the critical hit's words of a rider with a critical hit's alternative (batch 34), or null.
const CONDITION_WORD = String.raw`(?:@UUID\[[^\]]*\]\{[^}]*\}|[A-Z][a-z]+(?: \d+)?)`;
function criticalVariants(html) {
    const text = String(html);
    const bracket = new RegExp(String.raw`(${CONDITION_WORD})(\s+for [^(.]+?)?\s*\((?:or )?(${CONDITION_WORD}) on a critical hit\)`).exec(text);
    if (bracket) return { hit: text.replace(bracket[0], `${bracket[1]}${bracket[2] ?? ""}`), critical: text.replace(bracket[0], `${bracket[3]}${bracket[2] ?? ""}`) };
    const longer = /( for )(\d+ (?:round|minute)s?), or for (\d+ (?:round|minute)s?) on a critical hit/.exec(text);
    if (longer) return { hit: text.replace(longer[0], `${longer[1]}${longer[2]}`), critical: text.replace(longer[0], `${longer[1]}${longer[3]}`) };
    return null;
}

// A rider read twice (batch 34): the hit's results on a success, the critical hit's on a critical success, by the Strike's own
// degree (the check is the Strike: its degree recorded on the card, passed in the simulator). Only for results with no roll.
function byStrikeDegree(hit, critical) {
    if (hit?.resolution?.check?.roll !== "automatic" || critical?.resolution?.check?.roll !== "automatic") return null;
    const outcomes = hit.resolution.outcomes;
    return { ...hit, resolution: { ...hit.resolution, check: { roll: "skill", statistic: "strike", against: { dc: "target", statistic: "ac" } }, outcomes: { ...outcomes, criticalSuccess: structuredClone(critical.resolution.outcomes.success) } } };
}

// A passive its Strikes list ("Claw … plus Paralysis"; 2026-10-10): a rider of those Strikes on a hit, whose save or results
// are the creature's the Strike hits. Before, such passives ("Any living creature hit by a ghoul's attack must succeed at a
// Fortitude save or become Paralyzed") stayed passive, and no hit brought them. null when no Strike lists it.
function listedRider(item, actor, plan) {
    // (An action or free action its Strikes list, "Jaws … plus Drink Blood": after a hit, at its own cost; not a follow-up,
    // which already waits for the hit.)
    const type = item.system?.actionType?.value;
    if (!["passive", "action", "free"].includes(type) || !["passive", "use"].includes(plan?.trigger?.event) || !plan?.resolution || plan.trigger?.followUp) return null;
    const owner = actor ?? item.actor ?? item.parent;
    const slug = item.system?.slug || String(item.name ?? "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const listed = [...(owner?.items ?? [])].some((entry) => entry?.type === "melee" && (entry.system?.attackEffects?.value ?? []).includes(slug));
    // (Batch 28: a passive that names its Strike, "A creature hit by the clockwork assassin's rapier hand Strike is Off-Guard …",
    // when the Strike doesn't list it: a rider of the Strikes it names.)
    const named = listed || type !== "passive" ? [] : namedStrikes(item, owner);
    if (!listed && !named.length) return null;
    return {
        ...plan,
        activation: { ...(plan.activation ?? {}), time: type === "action" ? plan.activation?.time ?? "1" : "free" },
        // (An area of its own around the creature hit stays.)
        targeting: plan.targeting?.area ? plan.targeting : { target: "the creature the Strike hits", range: "touch", area: null },
        // ("A creature that is critically hit by a hyaenodon must succeed …": a critical hit only.)
        trigger: { ...plan.trigger, event: "strike", on: criticalOnly(item) ? ["criticalSuccess"] : ["success", "criticalSuccess"], ...(named.length ? { strikes: named } : { attackEffect: slug }), cost: type === "action" ? "action" : "free", map: false }
    };
}

// The creature's Strikes a passive names ("hit by the voidworm's tail Strike", "hit by a xulgath leader's jaws or claw Strike",
// "When the gourd leshy damages a creature with a fist or seed Strike"): their names, lowercase, when the creature has them.
function namedStrikes(item, owner) {
    const words = htmlToPlainText(item.system?.description?.value ?? "");
    const match = /\b(?:hit|damaged|struck)(?: and damaged)? by (?:the |a |an )?[\w' -]+?['’]s? ([\w -]+?) (?:Strike|attack)\b/i.exec(words) ?? /\b(?:hits?|damages?|critically hits?) (?:a|an|the) (?:living )?(?:creature|target|foe) with (?:its|their|his|her|a|an) ([\w -]+?) (?:Strike|attack)\b/i.exec(words);
    if (!match || /^ or (?:a|an|any) /i.test(words.slice(match.index + match[0].length))) return [];
    const names = match[1].toLowerCase().split(/\s*(?:,|\bor\b|\band\b)\s*/).filter(Boolean);
    const strikes = [...(owner?.items ?? [])].filter((entry) => entry?.type === "melee").map((entry) => String(entry.name ?? "").toLowerCase());
    return names.length && names.every((name) => strikes.includes(name)) ? names : [];
}

// The rider's trigger is a critical hit ("critically hit by", "scores a critical hit"), with no plain hit beside it.
function criticalOnly(item) {
    const words = htmlToPlainText(item.system?.description?.value ?? "");
    const critical = /\bcritically hit(?:s)? (?:by|with|a|an|the)\b|\bcritically succeeds? (?:at|on|with) (?:a|an|its|the)\b|\b(?:scores?|lands?|gets?|deals?) a critical hit\b|\bon a critical hit\b/i;
    const plain = /\bhit by\b|\bhits? (?:a|an|the) (?:creature|target|foe)\b|\bdamages? (?:a|an|the) (?:creature|target)\b/i;
    return critical.test(words) && !plain.test(words.replace(/critically hit(?:s)? (?:by|with|a|an|the)\b/gi, ""));
}
