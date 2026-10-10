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

import { htmlToPlainText } from "../../../pf2e-resolution-core/src/text/plain-text.js";
import { OTHER_WAY, STAGE_CONDITIONS, degreeSections, immunityDetails, inlineTags, modernInline, readCheck, readConditions, readDamage, readDuration, readImmunity, readLinger, readPush, readRange, readRecharge, readTemplate, readableText, sentencesOf, unconditional, conditionalDamage, noteUnread } from "./inline.js";
import { compileSkillAction, readPenalties, readSkillCheck } from "./checks.js";
import { chargeSentences, compileBuiltin, moveThenStrike } from "./builtins.js";
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
    const named = String(item?.name ?? "").trim().toLowerCase().replace(/\s+/g, "-");
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
    return {
        ...base(item),
        targeting: { target: "creatures it has grabbed or restrained", range: "touch", area: null, grabbed: true },
        trigger: { event: "use" },
        resolution: { kind: "save", check: { roll: "save", statistic: "fortitude", basic: true, against: { dc: "fixed", value: check.dc } }, sharedDamage: { rollOnce: true, components }, outcomes: greaterRows(basicRows(components.map((component) => component.id)), greater) }
    };
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
    if (!/\b(?:sinks? (?:its|their|his|her) fangs|drinks? (?:its|the) blood|Drink (?:Blood|Essence))\b/i.test(`${item.name} ${plain}`)) return null;
    const check = readSkillCheck(html);
    const drained = /\b(?:victim|creature|target) (?:is|becomes) Drained (\d+)\b/i.exec(plain);
    // When no check is needed: "…and is automatic for any of the other conditions", "If the victim is grabbed, this is automatic".
    const automatic = /\bif the (?:victim|creature) is grabbed,? this is automatic\b/i.test(plain) ? "No check is needed against a grabbed victim: count it as a success."
        : /\bautomatic for any of the other conditions\b/i.test(plain) ? "No check is needed against a paralyzed, restrained, unconscious or willing victim: count it as a success." : null;
    if (!check || check.statistic !== "athletics" || !drained) return null;
    const healing = inlineTags(html, "Damage").map(readDamage).find((formula) => /healing/i.test(formula));
    const amount = healing ? healing.replace(/\[healing\]/i, "").replace(/^\((.*)\)$/, "$1") : null;
    const drain = { ...none(), effects: [condition("drained", Number(drained[1]))] };
    return {
        ...base(item),
        targeting: { target: "the victim", range: "touch", area: null },
        trigger: { event: "use" },
        resolution: {
            kind: "check",
            check,
            sharedDamage: null,
            outcomes: { criticalSuccess: drain, success: structuredClone(drain), failure: none(), criticalFailure: none() },
            reminders: [
                ...(amount ? [`{source} regains ${amount} Hit Points (any excess as temporary Hit Points), unless {target} was already drained; then {target}'s drained value goes up by 1 instead.`] : []),
                ...(automatic ? [automatic] : [])
            ]
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
function unlessClause(sentence) {
    const match = /\b(?:becomes?|is|are|falls?) (.+?) unless (?:it|they|the (?:creature|target)) succeeds? (?:at|on) an? @Check\[[^\]]*\](?:\{[^}]*\})? (?:saving throw|save)(.*)$/i.exec(sentence);
    return match ? `becomes ${match[1]}${/^\s*\(/.test(match[2]) ? ` ${match[2].trim()}` : ""}` : null;
}

function saveOrOutcomes(html, components, { afterHit = false, riders = false, names = [] } = {}) {
    // (Line breaks inside a paragraph read as spaces.)
    const sentences = String(html).replace(/<\/?p[^>]*>/gi, " ").replace(/\s+/g, " ").split(/(?<=\.)\s+(?=[A-Z@<])/);
    const index = sentences.findIndex((sentence) => /@Check\[(?:type:)?(?:fortitude|reflex|will)/i.test(sentence));
    if (index < 0) return null;
    const upTo = htmlToPlainText(sentences.slice(0, index + 1).join(" "));
    // A save that follows a Strike's hit ("On a hit, …", "struck by this attack") or a death ("When the dancer dies"): not an action of its own.
    if (!afterHit && !riders && /\bStrike\b|\bOn a (?:hit|success)\b|\bstruck by\b|\bhits\b/i.test(upTo)) return null;
    if (/\bWhen (?:a creature (?:slays|kills)|(?:the|this|a|an) [\w' -]+? (?:dies|is (?:killed|destroyed|slain))|killed)\b/i.test(upTo)) return null;
    // Damage before the save counts only in the save's own sentence ("dealing 6d6 damage in a cone (Will save)").
    const checkAt = sentences[index].search(/@Check\[/i);
    if (components.length && !/@Damage\[/i.test(sentences[index].slice(0, checkAt))) components = [];
    // "must succeed at a … save or be …" (since 2026-10-10 also "must succeed a … saving throw or fall Prone").
    const legacy = /succeed at an? @Check\[[^\]]*\] (?:saving throw|save) or (.+)$/i.exec(sentences[index])?.[1] ?? /^(?:A|Each) creature that fails (?:its|the|this) save (.+)$/i.exec(sentences[index + 1] ?? "")?.[1] ?? /^On a failed save, (.+)$/i.exec(sentences[index + 1] ?? "")?.[1] ?? null;
    let failure = legacy ?? /(?:succeed(?: at)?|attempt) an? @Check\[[^\]]*\](?:\{[^}]*\})? (?:saving throw|save) or (.+)$/i.exec(sentences[index])?.[1]
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
    const replaced = new RegExp(String.raw`\((?:or )?(${TAGGED}+?) on (?:a )?critical failure(?:;[^()]*)?\)`, "i").exec(failure) ?? /,? or ((?:@(?:UUID|Damage)\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?|[^;.()@])+?) on (?:a )?critical failure\b/i.exec(failure);
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
    // A critical failure's own damage: in addition when it says "also", otherwise in place of the failure's.
    const critDamage = critical ? inlineTags(critical, "Damage").filter((raw) => !/healing/i.test(raw)).map((raw) => ({ formula: readDamage(raw) })) : [];
    const extraDamage = extraCritical ? inlineTags(extraCritical, "Damage").filter((raw) => !/healing/i.test(raw)).map((raw) => ({ formula: readDamage(raw) })) : [];
    const critFormulas = [...(criticalAdds ? [...failDamage, ...critDamage] : critDamage.length ? critDamage : failDamage), ...extraDamage];
    // "…save or be pulled 10 feet toward the doblagub" (toward the monster); "…save or instantly die", "If it fails, it dies".
    const pulled = readPush(failure, names);
    const pull = pulled?.kind === "pull" ? pulled : null;
    const dies = /^\s*(?:(?:it|they|the (?:creature|target)) )?(?:instantly |immediately )?(?:die|dies|be (?:instantly )?(?:killed|slain))\b/i.test(htmlToPlainText(failure));
    // "…save or take a –1 status penalty to attack rolls until the end of its next turn".
    const penalties = /^\s*(?:take|takes|be|suffer)\b/i.test(htmlToPlainText(failure)) ? readPenalties(failure) : [];
    if (!failEffects.length && !failDamage.length && !before && !shoved && !pull && !dies && !penalties.length && !(riders && (critDamage.length || extraDamage.length || (critical && (read(critical).length || /\bpush|\bshove/i.test(critical)))))) return null;
    const row = (effects, damage, multiplier) => ({
        damage: before ? { mode: "shared", multiplier, sourceComponentIds: components.map((component) => component.id) } : damage.length ? { mode: "formulas", formulas: damage, rollScope: "outcome" } : { mode: "none", multiplier: 0, sourceComponentIds: [] },
        effects
    });
    // A critical failure's condition with no duration of its own lasts as long as the failure's.
    const lasting = failEffects.find((effect) => effect.duration)?.duration ?? null;
    // Not a fixed time for frightened, which fades by its own rule ("As failure, but Frightened 3" after
    // "…Fascinated until the end of its next turn"); "as long as it remains in the aura" still carries over.
    const timed = (effects) => effects.map((effect) => (effect.duration || !lasting || effect.slug === "prone" || (["frightened", "sickened"].includes(effect.slug) && lasting.mode === "fixed") || (effect.slug === "stunned" && Number.isFinite(effect.value)) ? effect : { ...effect, duration: lasting }));
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
    const ending = (outcome) => ({ ...(dies ? { ...outcome, terminal: { kind: "death" } } : outcome), ...(penalties.length ? { modifiers: structuredClone(penalties) } : {}) });
    return {
        criticalSuccess: row([], [], 0),
        success: before && !negates ? row(successEffects, [], 0.5) : row(successEffects, [], 0),
        failure: ending(pulling(pushed(row(failEffects, failDamage, 1)))),
        criticalFailure: ending(pulling(pushed(row(critEffects, critFormulas, 2), pull ? critShoved?.[1] ?? shoved?.[1] : farther?.[1] ?? critShoved?.[1] ?? shoved?.[1]), true))
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

function strikeActivity(item, actor) {
    const reject = (text) => {
        strikeActivityReject.last = text;
        return null;
    };
    // (Sudden Charge's "Strides twice. If it ends its movement within melee reach …, it makes a melee Strike against that enemy.",
    // as one sentence.)
    const html = chargeSentences(item.system?.description?.value ?? "").replace(/<p>\s*<strong>\s*(?:Requirements|Frequency)\s*<\/strong>[\s\S]*?<\/p>\s*(?:<hr\s*\/?>)?/gi, (block) => (/Frequency/i.test(block) && /once per (?:day|hour|minute|10 minutes)/i.test(block) ? "<p>[once]</p>" : /Frequency/i.test(block) && /once per (?:round|turn)/i.test(block) ? "<p>[once a turn]</p>" : /Requirements/i.test(block) ? `<p>[requires ${htmlToPlainText(block).replace(/^Requirements\s*/i, "")}]</p>` : "")).replace(/<strong>\s*Effect\s*<\/strong>/gi, "");
    const sentences = html.replace(/<\/?p[^>]*>|<hr\s*\/?>/gi, " ").split(/(?<=[.\]])\s+(?=[A-Z@<[])/).map((sentence) => sentence.trim()).filter(Boolean);
    const activity = { builtin: "strike-activity", actions: Number(item.system?.actions?.value) || 1, strides: 0, strike: null, attackBonus: 0, damageBonus: 0, offGuard: false, requires: null, oncePerFight: false, onHit: { conditions: [], critical: null, push: null, damage: [], save: null, size: null } };
    let opened = false;
    let flavorSkipped = false;
    // "If it hits", "If the Strike hits and deals damage", "If they hit and deal damage", "If Alak hits".
    const hit = "^(?:If|When) (?:it|he|she|they|the (?:Strike|attack|strike)|this (?:Strike|attack)|the [\\w' -]+?|[A-Z][\\w'-]+) hits?(?: and deals? damage)?, ";
    const conditions = (text) => readConditions(text, { plain: STAGE_CONDITIONS }).map((effect) => ({ slug: effect.slug, value: effect.value, duration: effect.duration }));
    for (const sentence of sentences) {
        // Linked names as words ("@UUID[…]{Grabbed}" → "Grabbed"); @Check and @Damage are read from the sentence itself.
        const text = htmlToPlainText(sentence.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
        let match;
        if (text === "[once]") activity.oncePerFight = true;
        else if (text === "[once a turn]") activity.oncePerTurn = true;
        else if ((match = /^\[requires (.+)\]$/.exec(text))) {
            // A free hand: not while it holds a creature (the grab uses the hand). Held weapons aren't tracked.
            if (/(?:has|must have) (?:a creature|an enemy|a foe) Grabbed|is grabbing a creature/i.test(match[1])) activity.requires = "grabbed";
            else if (/has a (?:free )?hand(?: free)?/i.test(match[1])) activity.requires = "free-hand";
            else if (!/is wielding|is holding/i.test(match[1])) return reject(text);
        } else if (!opened && (match = /^(?:The )?[^.]+? (?:(Strides(?: twice| or Steps)?),? (?:and |then |and then )*)?(?:makes|attempts) an? (?:([\w' -]+?) )?Strike(?: (?:against|at) an? (?:creature|foe|enemy) (?:it has |it's |it is |that is |that's )?(?:Grabbed|grabbing|Restrained)[^.,]*?| (?:against|at) an? Prone (?:creature|foe|enemy))?(?: with an? \+(\d+) circumstance bonus to (damage|(?:its |the )?attack roll)(?: against the (?:grabbed|restrained) (?:creature|target))?)?(?: with an? [\w' -]+? weapon(?: or unarmed attack)?|, [a-z][^.\d]*)?\.$/i.exec(text)) && !/\b(?:damage|feet|bonus|penalty|reach|each|two|three|Strikes)\b/i.test(text.slice(text.search(/Strike\b/) + 6).replace(/with an? \+\d+ circumstance bonus to (?:damage|(?:its |the )?attack roll)/i, ""))) {
            // A move written into the subject ("The worm Burrows at least 10 feet and then attempts a jaws Strike"): read as a move.
            const moving = !match[1] && /\b(?:Flies|Swims|Climbs|Burrows|Leaps|Steps|Strides)\b/.test(text.slice(0, text.search(/\b(?:makes|attempts)\b/i)));
            const moved = moving ? moveThenStrike(text.replace(/(?:,| and)? (?:with|against) [^,.]*$/i, ".")) : null;
            if (moving && !moved) return reject(text);
            opened = true;
            activity.strides = moved ? moved.strides : match[1] ? (/twice/i.test(match[1]) ? 2 : 1) : 0;
            activity.strike = match[2] && !/^(?:melee|weapon|unarmed)$/i.test(match[2]) ? match[2].toLowerCase() : null;
            if (match[3]) activity[/damage/i.test(match[4]) ? "damageBonus" : "attackBonus"] = Number(match[3]);
            if (/Grabbed|grabbing|Restrained/i.test(text)) activity.requires = "grabbed";
            else if (/\bProne (?:creature|foe|enemy)\b/i.test(text)) activity.requires = "prone";
        } else if (!opened && (match = /^(?:The )?[^.]+? (?:(Strides(?: twice| or Steps)?),? (?:and |then )+)?Strikes(?: with (?:its|his|her|their|that) ([\w' -]+?))?\.$/i.exec(text)) && !/\b(?:damage|feet|bonus|penalty|reach|each|two|three)\b/i.test(text)) {
            // "Viro Strikes with his longsword.", "The skirmisher Strides or Steps, then Strikes."
            opened = true;
            activity.strides = match[1] ? (/twice/i.test(match[1]) ? 2 : 1) : 0;
            activity.strike = match[2] && !/^(?:melee|weapon|that weapon)$/i.test(match[2]) ? match[2].toLowerCase() : null;
        } else if (!opened && (match = moveThenStrike(text))) {
            // Other ways to move first (2026-10-10): "Flies up to double its fly Speed and then makes a talon Strike",
            // "Uri Strides and makes a scimitar Strike at any point during the Stride", "Strides twice and makes a horn
            // Strike against a foe within its reach at the end of the movement".
            opened = true;
            activity.strides = match.strides;
            activity.strike = match.strike;
        } else if (!opened && !flavorSkipped && !/\b(?:Strikes?|save|damage|check|DC|bonus|penalty|feet|Hit Points|@\w+\[)\b/i.test(sentence) && /^(?:The )?[A-Z][\w' -]*? [a-z]+s\b/.test(text)) {
            // A first sentence that only describes it ("The goblin shark dashes forward and extends its jaws").
            flavorSkipped = true;
            continue;
        } else if (!opened) return reject(text);
        else if (/^The target is Off-Guard to the Strike\.$/i.test(text)) activity.offGuard = true;
        // "This Strike deals an additional 3d6 precision damage." (only a hit deals it).
        else if ((match = /^(?:This|The) Strike deals an? (?:additional|extra) (.+?) damage\.$/i.exec(text)) && (inlineTags(sentence, "Damage").length === 1 || plainDice(match[1]))) activity.onHit.damage.push(inlineTags(sentence, "Damage").length ? readDamage(inlineTags(sentence, "Damage")[0]) : plainDice(match[1]));
        // "This Strike ignores their multiple attack penalty and doesn't count toward that penalty."
        else if (/^This Strike (?:ignores|doesn't use) (?:its|their|his|her|the) multiple attack penalty(?:,)? and (?:doesn't|does not) count toward (?:that|the|its|their) penalty\.$/i.test(text)) activity.noMap = true;
        // "This counts as two attacks for his multiple attack penalty."
        else if ((match = /^This counts as (two|three) attacks (?:when calculating|for) (?:its|his|her|their|the [\w' -]+?'s) multiple attack penalty\.$/i.exec(text))) activity.countsAs = { two: 2, three: 3 }[match[1].toLowerCase()];
        // "If this Strike hits, he deals an extra die of weapon damage."
        else if (new RegExp(`${hit}(?:it|he|she|they|[A-Z][\\w'-]+) deals? an? (?:additional|extra) (?:weapon )?die of (?:weapon )?(?:\\w+ )?damage\\.$`, "i").test(text)) activity.extraWeaponDice = (activity.extraWeaponDice ?? 0) + 1;
        else if (/remains? hidden until after|^During the Stride/i.test(text)) continue;
        // Death Roll: "If it hits, it also knocks the creature Prone. If it fails, it releases the creature."
        else if (new RegExp(`${hit}(?:it|he|she|they|[A-Z][\\w'-]+) (?:also )?knocks? the (?:creature|target) Prone\\.$`, "i").test(text)) activity.onHit.conditions.push({ slug: "prone", value: null, duration: null });
        else if (/^If (?:it|the Strike|this Strike) (?:fails|misses), (?:it|the [\w' -]+?) releases the (?:creature|target)\.$/i.test(text)) continue;
        else if ((match = /^(?:If|As long as) (?:it|they|the [\w' -]+?) moved at least 20 feet(?: away from (?:its|their) starting position)?, (?:it gains|they gain) a \+(\d+) circumstance bonus to (?:its|their|this) attack roll\.$/i.exec(text))) activity.attackBonus += Number(match[1]);
        else if (/^(?:If|As long as) (?:it|they|the [\w' -]+?) moved at least 20 feet(?: away from (?:its|their) starting position)?, the Strike's damage (?:is increased to|increases to) /i.test(text)) activity.damage = inlineTags(sentence, "Damage").map(readDamage)[0] ?? /(?:to) (\d+d\d+(?:\s*[+-]\s*\d+)?)/i.exec(text)?.[1] ?? null;
        else if ((match = new RegExp(`${hit}(?:the [\\w ]+? )?(?:automatically )?push(?:es)? the target (\\d+) feet\\.$`, "i").exec(text)) || (match = new RegExp(`${hit}the target is pushed (\\d+) feet\\.$`, "i").exec(text))) activity.onHit.push = Number(match[1]);
        else if ((match = new RegExp(`${hit}(?:it|he|she|they|[A-Z][\\w'-]+) deals? an? (?:additional|extra) (.+?) damage\\.$`, "i").exec(text)) && (inlineTags(sentence, "Damage").length === 1 || plainDice(match[1]))) activity.onHit.damage.push(inlineTags(sentence, "Damage").length ? readDamage(inlineTags(sentence, "Damage")[0]) : plainDice(match[1]));
        else if ((match = new RegExp(`${hit}(?:the target|that creature|the creature|the foe) is (.+?)\\.$`, "i").exec(text)) || (match = /^On a hit, (?:the target|the creature) is (.+?)\.$/i.exec(text))) {
            // "Frightened 1, or Frightened 2 on a critical hit", "Frightened 1 (Frightened 2 on a critical hit)". Not with a save of
            // its own ("Paralyzed … (DC 19 Fortitude negates)").
            if (/@Check\[/i.test(match[1])) return reject(text);
            const bracketed = /^(.+?) \(([^()]+) on a critical hit\)$/i.exec(match[1]);
            const [plain, critical] = bracketed ? [bracketed[1], `${bracketed[2]} on a critical hit`] : match[1].split(/, or (?=[^,]+ on a critical hit$)/i);
            if (/push|Grab/i.test(plain) && !conditions(sentence).length) return reject(text);
            activity.onHit.conditions.push(...conditions(plain));
            if (critical) activity.onHit.critical = conditions(critical.replace(/ on a critical hit$/i, ""));
            if (!activity.onHit.conditions.length) return reject(text);
        } else if ((match = /^On a critical hit, the (?:target|creature) is (.+?)(?: instead)?\.$/i.exec(text))) activity.onHit.critical = conditions(match[1]);
        else if (new RegExp(`${hit}the target must (?:also )?succeed at`, "i").test(text) || /^On a (?:hit|success), the (?:target|foe) must also succeed at/i.test(text) || (match = /^A (Tiny|Small|Medium|Large|Huge) or smaller creature struck by this attack must succeed at/i.exec(text))) {
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
        } else return reject(text);
    }
    const rider = activity.onHit;
    if (!opened || (!rider.conditions.length && !rider.critical && !rider.push && !rider.damage.length && !rider.save && !activity.offGuard && !activity.damageBonus && !activity.extraWeaponDice && !activity.noMap)) return null;
    if (activity.strides && !activity.attackBonus && activity.actions < activity.strides + 1 && !rider.save && !rider.conditions.length && !rider.damage.length) return null;
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

function inlineSave(item, actor = null, { afterHit = false } = {}) {
    const html = item.system?.description?.value ?? "";
    const checks = inlineTags(html, "Check").map(readCheck).filter((check) => check.save && check.dc);
    if (!checks.length) return null;
    const check = checks[0];
    // Two ways to use it, each with its own save ("The wyrm breathes in one of two ways"): the GM's.
    if (new Set(checks.map((each) => each.statistic)).size > 1 && (MODES.test(htmlToPlainText(html)) || /\bin one of the following ways\b/i.test(htmlToPlainText(html)))) return null;
    // One of several modes picked by the monster's state ("its attack depends on its current form").
    if (/\bdepending on (?:its|their|the [\w' -]+?'s) (?:[\w-]+ )?(?:attunement|form|stance|mode|aspect)\b/i.test(htmlToPlainText(html))) return null;
    // Damage by the number of actions spent ("The damage depends on the number of actions"): not one plan.
    if (/\bdepends on the number of actions\b|\bfor each additional action\b/i.test(htmlToPlainText(html))) return null;
    // An effect picked from a roll on a list ("Roll on the alchemical chambers list to determine which one shatters"): the GM's.
    if (/\broll on (?:the|a|an|its) [^.]*?\b(?:list|table)\b|\broll [^.]*? to determine which\b/i.test(htmlToPlainText(html))) return null;
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
        outcomes = saveOrOutcomes(html, components, { names: ownNames(actor ?? item.actor ?? item.parent), afterHit });
        if (!outcomes) return null;
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
    const range = readRange(plain);
    const recharge = readRecharge(html);
    const immunity = readImmunity(html, [item.name, (actor ?? item.actor ?? item.parent)?.name]);
    // Only creatures it's holding ("each creature it has grabbed").
    const grabbed = /\b(?:creatures?|targets?) (?:it(?:'s| is| has)?|the monster(?:'s| is| has)?) (?:grabbed|grabbing|restrained|restraining)|\b(?:grabbed|restrained) by (?:it|the monster)\b/i.test(plain);
    return {
        ...base(item),
        targeting: { target: template ? null : "1 creature", range: range ? `${range} feet` : template ? null : "touch", area: template, ...(grabbed ? { grabbed: true } : {}) },
        trigger: { event: aura ? "aura" : dies ? "death" : passive ? "passive" : "use", ...(aura ? readAuraTiming(plain) : {}), ...(aura && readActiveAfter(plain) ? { activeAfter: readActiveAfter(plain) } : {}), ...(recharge ? { recharge: { formula: recharge, unit: "rounds" } } : {}), ...(immunity ? { immunity } : {}) },
        resolution: { kind: "save", check: { roll: "save", statistic: check.statistic, basic: check.basic, against: { dc: "fixed", value: check.dc } }, sharedDamage: components.length ? { rollOnce: true, components } : null, outcomes }
    };
}

// "When the grodair dies, its body explodes …", "When a sodden sentinel is reduced to 0 Hit Points, it explodes", "When the
// skeleton is destroyed …": a passive that acts as it dies.
const DIES = /^(?:When|Whenever|As|Upon|If)\b[^.]*?\b(?:dies|is (?:killed|destroyed|slain|reduced to 0 (?:Hit Points|HP))|reaches 0 (?:Hit Points|HP))\b/i;

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
    if (/@Check\[|\bhealing\b|\bregains?\b|\bone of the following\b/i.test(html) || (/\[\[\/act /i.test(html) && !(rider && !/\[\[\/act (?!escape)/i.test(html)))) return null;
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
        const deals = /\bdeal(?:s|ing)? @D(?: damage)? to (?:the (?:target|creature|grabbed creature|restrained creature|victim)|each (?:creature|enemy|foe)|all (?:creatures|enemies|foes))\b/i.test(plain) || (/\b(?:that|the) (?:target|creature|foe|victim)\b[^.]*?\bdealing @D(?: damage)?\b/i.test(plain) && !/\bdealing @D(?: damage)? to\b/i.test(plain));
        const conditions = readConditions(sentence).filter((entry) => entry.recipient !== "self");
        const is = (AUTO_SUBJECT.test(plain) || deals) && conditions.length > 0;
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
        if (/\b(?:resistances?|weakness|penalty|bonus|can't|cannot|Speeds?|exposed|immune)\b/i.test(plain)) notes.push(readableText(sentence.replace(/\[\[\/(?:r|gmr|br|roll) [^\]]*\]\]\{([^}]*)\}/g, "$1")));
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
const MODES = /\bin one of (?:two|three|four) ways\b|\bone of (?:two|three|four) effects\b|\bone of the following (?:ways|modes|forms)\b|\bchooses? one effect\b/i;
function compileModes(item, options) {
    const html = item.system?.description?.value ?? "";
    if (!MODES.test(htmlToPlainText(html))) return null;
    const start = html.search(/<ul\b/i);
    const end = html.search(/<\/ul>/i);
    if (start < 0 || end < start) return null;
    const preamble = html.slice(0, start).replace(new RegExp(MODES.source, "gi"), "");
    // Results written after the list belong to its last way (a duel dragon's Demoralizing Cry).
    const after = html.slice(end + "</ul>".length);
    const parts = html.slice(start, end).split(/<li\b[^>]*>/i).slice(1).map((part) => part.replace(/<\/li>\s*$/i, ""));
    if (parts.length < 2) return null;
    const modes = parts.map((part, index) => {
        const name = /^\s*(?:<p>)?\s*<strong>([^<]+)<\/strong>/i.exec(part)?.[1]?.trim();
        if (!name) return null;
        const body = part.replace(/^\s*(?:<p>)?\s*<strong>[^<]+<\/strong>\s*(?:\([^)]*\))?\s*;?\s*/i, "");
        const description = { ...(item.system?.description ?? {}), value: `${preamble}<p>${body}</p>${index === parts.length - 1 ? after : ""}` };
        const system = new Proxy(item.system, { get: (target, key) => (key === "description" ? description : key === "slug" ? null : Reflect.get(target, key)) });
        const way = new Proxy(item, { get: (target, key) => (key === "system" ? system : key === "name" ? `${item.name} (${name})` : Reflect.get(target, key)) });
        let plan = null;
        try {
            plan = compileMonsterAbility(way, options);
        } catch {
            plan = null;
        }
        return { name, plan: plan?.resolution ? plan : null };
    });
    if (modes.some((mode) => !mode) || !modes.some((mode) => mode.plan)) return null;
    return { builtin: "modes", actions: Number(item.system?.actions?.value) || 1, modes };
}

// A save whose damage "depends on the number of actions" (a troop's coordinated attacks), each count's damage after its
// action glyph ("<span class="action-glyph">2</span> @Damage[(3d6+10)[bludgeoning]] damage") or its number
// ("2 @Damage[…]"): the basic save with the lowest count's damage, and resolution.native.byActions[n] with each
// count's (the core's planWithActions; live play asks how many actions, the simulator picks). null otherwise.
function actionCountSave(item, actor) {
    const html = item.system?.description?.value ?? "";
    const phrase = /\bdepends on the number of actions\b/i.exec(html);
    if (!phrase) return null;
    const check = inlineTags(html, "Check").map(readCheck).find((entry) => entry.save && entry.dc);
    if (!check?.basic) return null;
    // From the phrase on: a count, then its damage, up to the next count.
    const { masked, tags } = maskDamage(html.slice(phrase.index));
    const markers = [...masked.matchAll(/<span class="action-glyph">([123])<\/span>|(?<![\w\u0000])([123])(?=\s*\u0000)/g)];
    const variants = {};
    markers.forEach((marker, index) => {
        const segment = masked.slice(marker.index + marker[0].length, markers[index + 1]?.index ?? masked.length);
        const found = [...segment.matchAll(/\u0000(\d+)\u0000/g)].map((match) => tags[Number(match[1])]).filter((raw) => !/\bhealing\b/i.test(raw));
        if (found.length) variants[marker[1] ?? marker[2]] = found.map((raw, id) => ({ id: String(id), formula: readDamage(raw), type: null, category: null }));
    });
    const counts = Object.keys(variants).map(Number).sort((a, b) => a - b);
    // Every count with the same parts, so the rows' damage ids stay the same.
    if (counts.length < 2 || counts.some((count) => variants[count].length !== variants[counts[0]].length)) return null;
    const components = variants[counts[0]];
    const before = html.slice(0, phrase.index);
    const plain = htmlToPlainText(before);
    // No template: "each enemy within 10 feet", "each adjacent enemy" around the troop.
    const around = /\beach (?:adjacent )?enem(?:y|ies) within (\d+) feet\b/i.exec(plain)?.[1] ?? (/\beach adjacent enem(?:y|ies)\b/i.test(plain) ? "5" : null);
    const template = inlineTags(before, "Template").map(readTemplate).find(Boolean) ?? (around ? { type: "emanation", value: Number(around) } : undefined);
    const range = readRange(plain);
    const recharge = readRecharge(html);
    return {
        ...base(item, { time: String(counts[0]) }),
        targeting: { target: template ? null : "each enemy in reach", range: range && !around ? `${range} feet` : template ? null : "touch", area: template ?? null },
        trigger: { event: "use", ...(recharge ? { recharge: { formula: recharge, unit: "rounds" } } : {}) },
        resolution: {
            kind: "save",
            check: { roll: "save", statistic: check.statistic, basic: true, against: { dc: "fixed", value: check.dc } },
            sharedDamage: { rollOnce: true, components },
            outcomes: withRiders(basicRows(components.map((component) => component.id)), before, components),
            native: { byActions: Object.fromEntries(counts.map((count) => [count, { sharedDamage: { components: variants[count] } }])) }
        }
    };
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
    const html = item.system?.description?.value ?? "";
    const type = item.system?.actionType?.value;
    if (!["action", "free"].includes(type) || /<strong>\s*Trigger\s*<\/strong>/i.test(html)) return null;
    if (inlineTags(html, "Check").length || inlineTags(html, "Damage").length || /\[\[\//.test(html)) return null;
    const links = [...html.matchAll(EFFECT_LINK)];
    const own = item.system?.selfEffect?.uuid ?? null;
    const uuids = [...new Set([...(own ? [own] : []), ...links.map((match) => match[1])])];
    if (uuids.length !== 1) return null;
    const label = links.find((match) => match[1] === uuids[0])?.[2] ?? item.name;
    // The text without the effect's own link, an area kept as words ("within a 20-foot emanation").
    const text = html.replace(EFFECT_LINK, "").replace(/(?:\ban?\s+)?@Template\[(?:type:)?(\w+)\|distance:(\d+)[^\]]*\](?:\{[^}]*\})?/gi, "a $2-foot $1").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1");
    const plain = htmlToPlainText(text).replace(/\bEffect:\s*$/i, "").trim();
    // Something else to do: a Strike, a check, a spell, a choice, movement, terrain, an area everyone's in.
    if (/\bStrikes?\b|\bchecks?\b|\bDemoralize\b|\bone of the following\b|\b(?:its|the [\w' -]+?'s) choice\b|\bchooses?\b|\bcasts?\b|\bspells?\b|\bsummons?\b|\bteleports?\b|\b(?:Strides?|Steps?|Flies|Burrows?|Swims?|Leaps?)\b|\bterrain\b|\ball creatures in the area\b|\bsaving throw against\b/i.test(plain)) return null;
    let recipients = "self";
    let targeting = { target: null, range: null, area: null };
    if (!own) {
        // The sentence that grants it, and who it's about: what's given to ("grants an adjacent ally a +2 …", "gives
        // themself and all orc allies …"), or the last clause before the verb ("When the swarm gets into formation, it gains").
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
        trigger: { event: "use" },
        resolution: { kind: "effect", applications: [{ kind: "native-spell-effect", uuid: uuids[0], label, recipients, ...(own ? { selfEffect: true } : {}) }] }
    };
}

// A follow-up to a Strike that hit (2026-10-10): "Requirements The skull fairy's last action was a successful fist Strike
// … Effect … The creature must succeed at a … save or be Stunned 1", "…damaged a creature with a jaws Strike on its
// last action". The Effect compiled as an ability of its own (a save, a check, an effect) on the creature the
// Strike hit, used as before (the card comes when the GM uses it), with trigger.followUp { strike, melee, on } for the
// simulator, which uses it only straight after such a hit: strike is the Strike's name ("claw"; null for any), on the
// degrees ("a critical hit": criticalSuccess only). null otherwise.
function followUp(item, actor) {
    const html = item.system?.description?.value ?? "";
    const block = /<strong>\s*Requirements?\s*<\/strong>([\s\S]*?)(?=<\/p>|<hr|<strong>\s*Effect\s*<\/strong>)/i.exec(html);
    if (!block) return null;
    const need = htmlToPlainText(block[1].replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const last = /\blast action was an? (successful|critical hit with an?|critical) (?:([\w' -]+?) )??Strike\b(.*)$/i.exec(need)
        ?? /\b(hit|damaged|struck|critically hit) an? (?:[\w-]+ )?(?:creature|target|foe|enemy) with (?:an?|its|their|his|her) (?:([\w' -]+?) )??Strike (?:on|during) (?:its|their|his|her) last action\b(.*)$/i.exec(need);
    if (!last) return null;
    // Only the Strike's own conditions: not "or a Draconic Frenzy that included …", "against a Medium or larger creature".
    if (/\bor (?:a|an)\b|\bagainst an? (?:Tiny|Small|Medium|Large|Huge|Gargantuan)\b/i.test(last[3] ?? "")) return null;
    const critical = /critical/i.test(last[1]);
    const name = last[2] && !/^(?:melee|ranged|weapon|unarmed)$/i.test(last[2].trim()) ? last[2].trim().toLowerCase() : null;
    const melee = /\bmelee\b/i.test(last[2] ?? "");
    // The Effect, as an ability of its own.
    const effect = html.slice(block.index + block[0].length).replace(/^\s*<\/p>\s*(?:<hr\s*\/?>)?\s*/i, "").replace(/<strong>\s*Effect\s*<\/strong>/i, "");
    const own = withDescription(item, effect);
    let plan = null;
    try {
        plan = inlineSave(own, actor) ?? compileSkillAction(own, { actor }) ?? effectAbility(own) ?? automaticEffect(own, actor);
    } catch {
        plan = null;
    }
    if (!plan?.resolution) return null;
    if (plan.resolution.outcomes) noteUnread(plan.resolution.outcomes, effect);
    return {
        ...plan,
        targeting: plan.targeting?.area ? plan.targeting : { target: "the creature the Strike hits", range: "touch", area: null },
        trigger: { ...(plan.trigger ?? {}), event: "use", followUp: { strike: name, melee, on: critical ? ["criticalSuccess"] : ["success", "criticalSuccess"] } }
    };
}

// The one PF2e effect an ability links, on the rows that apply nothing else: a save's failure and critical failure, a
// check's success and critical success (2026-10-10). Not when it links more than one, or none.
function linkedEffect(plan, html) {
    const links = [...new Map([...String(html).matchAll(EFFECT_LINK)].map((match) => [match[1], match[2] ?? null])).entries()];
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

// A plan for an NPC ability, { builtin } for rules the simulator plays itself,// A plan for an NPC ability, { builtin } for rules the simulator plays itself,
// or null. basicActions: the compiled basic actions ({ grapple, trip, shove, … }), for riders.
// actor: the creature, when the item has none (pack data), for Trample's Strike.
export function compileMonsterAbility(source, { basicActions = {}, actor = null } = {}) {
    if (!source || (source.type !== "action" && source.type !== "feat")) return null;
    const item = modernItem(source);
    const slug = glossarySlug(item);
    if (BUILT_IN.has(slug)) {
        const strike = slug === "rend" ? htmlToPlainText(item.system?.description?.value ?? "").split(/\n/)[0].trim() : null;
        return { builtin: slug, ...(strike ? { strike } : {}) };
    }
    if (NO_EFFECT.has(slug)) return { builtin: "no-effect" };
    if (["grab", "improved-grab", "knockdown", "improved-knockdown", "push", "improved-push", "pull", "improved-pull"].includes(slug)) return rider(item, slug, basicActions);
    // Retributive Strike (the glossary's): as a champion's, the ally's resistance is 2 + the monster's level.
    if (slug === "retributive-strike") {
        const level = Number((actor ?? item.actor ?? item.parent)?.system?.details?.level?.value);
        return { builtin: "retributive-strike", resistance: Number.isFinite(level) ? 2 + level : null };
    }
    if (slug === "constrict" || slug === "greater-constrict") return constrict(item, { greater: slug === "greater-constrict" });
    if (slug === "frightful-presence") return frightfulPresence(item);
    if (slug === "stench") return stench(item);
    if (slug === "swallow-whole") return swallowWhole(item);
    if (slug === "trample") return trample(item, actor);
    if (slug === "buck") return buck(item);
    if (/drink-blood|drink-essence/.test(slug ?? "") || /^Drink (?:Blood|Essence)$/i.test(item.name ?? "")) {
        const plan = drinkBlood(item);
        if (plan) return plan;
    }
    if (slug === "engulf") return engulf(item, actor);
    // Used in one of several ways (two breath weapons): a plan for each.
    const modes = compileModes(item, { basicActions, actor });
    if (modes) return modes;
    // Damage by the number of actions spent (a troop's attacks): one plan, the damage for each count.
    const byActions = actionCountSave(item, actor);
    if (byActions) return byActions;
    const exposure = exposureSave(item, actor);
    if (exposure) return exposure;
    // A follow-up to a Strike that hit ("Requirements … last action was a successful claw Strike").
    const after = item.system?.actionType?.value === "action" ? followUp(item, actor) : null;
    if (after) return after;
    // Poisons, diseases and curses with stages, delivered by the Strikes that list them.
    if (/<strong>\s*Stage\s+1\s*<\/strong>/i.test(item.system?.description?.value ?? "")) return compileAffliction(item, base(item));
    const plan = compileBuiltin(item, slug) ?? (item.system?.actionType?.value === "action" ? strikeActivity(item, actor) : null) ?? inlineSave(item, actor) ?? compileSkillAction(item, { actor }) ?? effectAbility(item) ?? automaticEffect(item, actor);
    // A save or check whose result is a PF2e effect it links ("…save or take a –1 status penalty to attack rolls …
    // Effect: Downcast"): that effect, on the rows that apply nothing else (a failure, or a check's success).
    if (plan?.resolution?.outcomes) linkedEffect(plan, item.system?.description?.value ?? "");
    // Results it can't apply ("The target can't use reactions for 1 round"): their text on the card, for the GM.
    if (plan?.resolution?.outcomes) noteUnread(plan.resolution.outcomes, item.system?.description?.value ?? "");
    // Nothing else read, and it casts a spell or has its effects: the spell, cast through PF2e.
    if (!plan?.builtin && !plan?.resolution) return castSpell(item, actor) ?? riderReading(item, actor) ?? deathReading(item, actor) ?? plan;
    return listedRider(item, actor, plan) ?? plan;
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
    if (!plan) return null;
    const area = plan.targeting?.area ?? (/\badjacent creatures?\b|\beach (?:creature|enemy) adjacent\b/i.test(plain) ? { type: "emanation", value: 5 } : /\bwithin (\d+) feet\b/i.exec(plain) ? { type: "emanation", value: Number(/\bwithin (\d+) feet\b/i.exec(plain)[1]) } : null);
    return { ...plan, targeting: { target: null, range: null, area }, trigger: { ...plan.trigger, event: "death" } };
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
    if ([...html.matchAll(CLAUSE)].some((match) => /\b(?:that's|that is|that has|who|which|whose|already|taking|while|holy|unholy|good|evil|made of|wearing|metal|smaller|larger|Tiny|Small|Medium|Large|Huge|and the)\b/i.test(match[0].replace(/^\W*(?:<p>)?\s*(?:If|When(?:ever)?)\b/i, "")))) return null;
    const trimmed = html.replace(CLAUSE, (whole, lead, letter) => `${lead}${letter.toUpperCase()}`);
    const own = withDescription(item, trimmed);
    let plan = null;
    try {
        plan = inlineSave(own, actor, { afterHit: true }) ?? automaticEffect(own, actor, { rider: true });
    } catch {
        plan = null;
    }
    return listedRider(item, actor, plan);
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
    if (!listed) return null;
    return {
        ...plan,
        activation: { ...(plan.activation ?? {}), time: type === "action" ? plan.activation?.time ?? "1" : "free" },
        // (An area of its own around the creature hit stays.)
        targeting: plan.targeting?.area ? plan.targeting : { target: "the creature the Strike hits", range: "touch", area: null },
        // ("A creature that is critically hit by a hyaenodon must succeed …": a critical hit only.)
        trigger: { ...plan.trigger, event: "strike", on: criticalOnly(item) ? ["criticalSuccess"] : ["success", "criticalSuccess"], attackEffect: slug, cost: type === "action" ? "action" : "free", map: false }
    };
}

// The rider's trigger is a critical hit ("critically hit by", "scores a critical hit"), with no plain hit beside it.
function criticalOnly(item) {
    const words = htmlToPlainText(item.system?.description?.value ?? "");
    const critical = /\bcritically hit(?:s)? (?:by|with|a|an|the)\b|\bcritically succeeds? (?:at|on|with) (?:a|an|its|the)\b|\b(?:scores?|lands?|gets?|deals?) a critical hit\b|\bon a critical hit\b/i;
    const plain = /\bhit by\b|\bhits? (?:a|an|the) (?:creature|target|foe)\b|\bdamages? (?:a|an|the) (?:creature|target)\b/i;
    return critical.test(words) && !plain.test(words.replace(/critically hit(?:s)? (?:by|with|a|an|the)\b/gi, ""));
}
