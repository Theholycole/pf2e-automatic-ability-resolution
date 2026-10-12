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
import { chargeSentences, compileBuiltin, countWord, moveThenStrike, readRage, readSelfGuard, readStrikeBuff } from "./builtins.js";
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
    return {
        ...base(item),
        targeting: { target: "creatures it has grabbed or restrained", range: "touch", area: null, grabbed: true },
        trigger: { event: "use" },
        resolution: { kind: "save", check: { roll: "save", statistic: "fortitude", basic: true, against: { dc: "fixed", value: check.dc } }, sharedDamage: { rollOnce: true, components }, outcomes: greaterRows(basicRows(components.map((component) => component.id)), greater) }
    };
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
    if (damage.length !== 1 || !/\bdrains? (?:blood|blood or ichor|vitality)\b|\bdrink its blood\b|\bdrain its vital essence\b/i.test(effect)) return null;
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
        if (/^(?:The|A|An) [\w' -]+? (?:drains|drives|sinks|engages) [^.@]+\.$/i.test(sentence)) continue;
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
function unlessClause(sentence) {
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
    const critPenalties = penaltyLasts ? penalties.map((penalty) => ({ ...penalty, duration: readDuration(`for ${penaltyLasts[1]}`) })) : penalties;
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
            .replace(/\b((?:makes|attempts) an? [\w' -]+? Strike) that deals (one|two) additional weapon (?:damage )?(?:die|dice)(?: of damage)?(?=\.$)/i, (_all, made, count) => {
                activity.extraWeaponDice = (activity.extraWeaponDice ?? 0) + (count.toLowerCase() === "two" ? 2 : 1);
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
            .replace(/^In addition, if the target is wearing armor with Hardness \d+ or lower, the armor becomes Broken\.$|^If the target is Off-Guard, then the [\w' -]+? can follow the foe\.$/i, "[gm]")
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
        else if (/^On a hit, the target becomes impaled on (?:the [\w' -]+?'s|[A-Z][\w'-]+'s|its|their|his|her) horn\.$/i.test(text)) continue;
        else if (/^The creature is Grabbed while on the horn(?: \(and can (?:attempt to )?Escape as normal\))?\.$/i.test(text)) activity.onHit.conditions.push({ slug: "grabbed", value: null, duration: null });
        else if (/^(?:The [\w' -]+?|[A-Z][\w'-]+|It|They|He|She) (?:doesn't|does not) need to use additional actions to keep the (?:impaled|grabbed) creature grabbed\.$|^If (?:the [\w' -]+?|[A-Z][\w'-]+|it|they|he|she) moves?, (?:it|they|he|she) brings? the grabbed creature along with (?:it|them|him|her)\.$/i.test(text) && activity.onHit.conditions.some((entry) => entry.slug === "grabbed")) continue;
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
        else if ((match = /^This counts as (two|three) attacks (?:when calculating|for) (?:its|his|her|their|the(?: [\w' -]+?'s)?) multiple attack penalty\.$/i.exec(text))) activity.countsAs = { two: 2, three: 3 }[match[1].toLowerCase()];
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
        else if (new RegExp(`${hit}the target must (?:also )?succeed at`, "i").test(text) || /^On a (?:hit|success), the (?:target|foe) must also succeed at/i.test(text) || /^On a success, the creature must (?:also )?succeed at/i.test(text) || (match = /^A (Tiny|Small|Medium|Large|Huge) or smaller creature (?:struck|hit|damaged) by this attack must succeed at/i.exec(text))) {
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
    const bare = !activity.selfAfter?.length && !rider.conditions.length && !rider.critical && !rider.push && !rider.criticalPush && !rider.follow && !rider.damage.length && !rider.proneDamage?.length && !rider.save && !activity.offGuard && !activity.attackBonus && !activity.damageBonus && !activity.damage && !activity.extraWeaponDice && !activity.noMap && !activity.fatal && !activity.deadly && !activity.halfDamage && !rider.allyStrike && !activity.noDamage && !activity.afterStrike && !activity.damageTimes;
    // (Batch 90, Feathered Charge: every sentence read, and only a Stride and a Strike for as many actions — terrain it ignores, a fall the
    // GM's: nothing more than its Strike.)
    if (opened && bare && activity.strides && !activity.requires && activity.actions >= activity.strides + 1) return { builtin: "no-effect", strikeOnly: true };
    // (Batch 156: a Strike whose only extra is the GM's — Shattering Scrape's broken armor — still posts its note.)
    if (!opened || (bare && !activity.notes?.length)) return null;
    if (activity.strides && !activity.attackBonus && activity.actions < activity.strides + 1 && !rider.save && !rider.conditions.length && !rider.damage.length && !rider.proneDamage?.length && !rider.follow) return null;
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

function inlineSave(item, actor = null, { afterHit = false } = {}) {
    // (Batch 142: degrees listed in brackets, as sections.)
    const listed = degreeListHtml(item.system?.description?.value ?? "");
    if (listed) return inlineSave(withDescription(item, listed), actor, { afterHit });
    // (Batch 142, Eye Beams: "2d6 cold or 2d6 fire damage" — one roll, its type the monster's pick: PF2e's caster choice, a GM button live, the
    // simulator's best.)
    const typed = /(@Damage\[(\d+d\d+(?:[+-]\d+)?)\[(\w+)\](?:\|[^\]]*)?\](?:\{[^}]*\})?) or @Damage\[\2\[(\w+)\](?:\|[^\]]*)?\](?:\{[^}]*\})?/.exec(item.system?.description?.value ?? "");
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
    if (/\bdepends on the number of actions\b|\bfor each additional action\b/i.test(htmlToPlainText(html))) return null;
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
        // (Batch 65: "The lizard's jaws deal 1d6 piercing damage and 1d6 acid damage to the triggering creature".)
        // (Batch 69: "dealing an additional 1d8 sonic damage to the creature struck".)
        const deals = /\b(?:deal(?:s|ing)?|dealing an (?:additional|extra)) @D(?: damage)? to (?:the (?:target|creature|grabbed creature|restrained creature|victim|triggering creature)|each (?:creature|enemy|foe)|all (?:creatures|enemies|foes))\b/i.test(plain) || (/\b(?:that|the) (?:target|creature|foe|victim)\b[^.]*?\bdealing @D(?: damage)?\b/i.test(plain) && !/\bdealing @D(?: damage)? to\b/i.test(plain));
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
// A hydra's heads (2026-10-11, batch 43): "A hydra ordinarily has five heads." (Head Regrowth), "Alkoasha has ten heads." → 5, 10;
// null when no ability of the creature says.
export function headCount(actor) {
    for (const other of actor?.items ?? []) {
        const match = /\b(?:ordinarily |typically |usually )?has (\w+) heads\b/i.exec(htmlToPlainText(other.system?.description?.value ?? ""));
        if (match && countWord(match[1]) > 1) return countWord(match[1]);
    }
    return null;
}

// Storm of Jaws (batch 43): "makes a number of Strikes up to its number of heads" with the creature's heads, "makes up to 5 Strikes".
function withHeads(item, actor) {
    const html = item.system?.description?.value;
    const words = /\ba number of Strikes up to (?:its|their|his|her) number of heads\b/gi;
    if (typeof html !== "string" || !words.test(html)) return item;
    const heads = headCount(actor ?? item.actor ?? item.parent);
    return heads ? withDescription(item, html.replace(words, `up to ${heads} Strikes`)) : item;
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
    const parts = html.slice(start, end).split(/<li\b[^>]*>/i).slice(1).map((part) => part.replace(/<\/li>\s*$/i, ""));
    if (parts.length < 2) return null;
    const modes = parts.map((part, index) => {
        const name = /^\s*(?:<p>)?\s*<strong>([^<]+)<\/strong>/i.exec(part)?.[1]?.trim();
        if (!name) return null;
        // (Batch 101: its traits kept when its words start with the area, "(fire) @Template[cone|distance:60] of fire dealing …", so they
        // read on from the save before them.)
        const bare = part.replace(/^\s*(?:<p>)?\s*<strong>[^<]+<\/strong>\s*/i, "");
        const body = /^\([^)]*\)\s*@Template\[/i.test(bare) ? bare : bare.replace(/^(?:\([^)]*\))?\s*;?\s*/i, "");
        const description = { ...(item.system?.description ?? {}), value: `${preamble}<p>${body}</p>${waits.join("")}${index === parts.length - 1 ? after : ""}` };
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
        return { name, plan: plan?.resolution ? plan : null };
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
    const type = item.system?.actionType?.value;
    // (Batch 82: a reaction whose trigger reads, Brutal Rally's "Trigger The gang leader rolls a critical hit against a creature Effect All
    // allies that can see the gang leader gain …": the effect, set off by that; its Trigger section set aside.)
    const raw = item.system?.description?.value ?? "";
    const triggerText = type === "reaction" ? /<strong>\s*Trigger\s*<\/strong>([\s\S]*?)(?=<hr|<\/p>\s*<p>\s*<strong>\s*Effect|<strong>\s*Effect)/i.exec(raw)?.[1] : null;
    const triggered = triggerText ? readReactionTrigger(htmlToPlainText(triggerText).trim()) : null;
    const html = triggered ? raw.replace(/<p[^>]*>\s*<strong>\s*Trigger\s*<\/strong>[\s\S]*?<\/p>\s*(?:<hr\s*\/?>)?/i, "").replace(/<strong>\s*Effect\s*<\/strong>/i, "") : raw;
    if (!(["action", "free"].includes(type) || triggered) || /<strong>\s*Trigger\s*<\/strong>/i.test(html)) return null;
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
    // (Batch 120: not the effect's own bonuses, "a +2 status bonus to attack rolls, Perception checks, saving throws, and skill checks" —
    // what it gives isn't what it does.)
    const doing = plain.replace(/\b(?:bonus|penalty) to [^.]*/gi, "");
    if (/\bStrikes?\b|\bchecks?\b|\bDemoralize\b|\bone of the following\b|\b(?:its|the [\w' -]+?'s) choice\b|\bchooses?\b|\bcasts?\b|\bspells?\b|\bsummons?\b|\bteleports?\b|\b(?:Strides?|Steps?|Flies|Burrows?|Swims?|Leaps?)\b|\bterrain\b|\ball creatures in the area\b|\bsaving throw against\b/i.test(doing)) return null;
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
        trigger: triggered ?? { event: "use" },
        resolution: { kind: "effect", applications: [{ kind: "native-spell-effect", uuid: uuids[0], label, recipients, ...(own ? { selfEffect: true } : {}) }] }
    };
}

// A follow-up to a Strike that hit (2026-10-10): "Requirements The skull fairy's last action was a successful fist Strike
// … Effect … The creature must succeed at a … save or be Stunned 1", "…damaged a creature with a jaws Strike on its
// last action". The Effect compiled as an ability of its own (a save, a check, an effect) on the creature the
// Strike hit, used as before (the card comes when the GM uses it), with trigger.followUp { strike, melee, on } for the
// simulator, which uses it only straight after such a hit: strike is the Strike's name ("claw"; null for any), on the
// degrees ("a critical hit": criticalSuccess only). null otherwise.
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
    const effect = html.slice(block.index + block[0].length).replace(/^\s*<\/p>\s*(?:<hr\s*\/?>)?\s*/i, "").replace(/<strong>\s*Effect\s*<\/strong>/i, "").replace(/\bsucceed on an? (@Check\[)/gi, "succeed at a $1");
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
    return {
        ...plan,
        targeting: plan.targeting?.area ? plan.targeting : { target: "the creature the Strike hits", range: "touch", area: null },
        trigger: { ...(plan.trigger ?? {}), event: "use", followUp: { strike: name, melee, on, ...(last.listing ? { listing: last.listing } : {}) } }
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
    const attacker = /^The (?:triggering )?creature is exposed to ([^.]+?)\.$/i.exec(effect);
    const beside = /^(?:The )?[^.]+? onto an adjacent creature\. That creature is exposed to ([^.]+?)\.$/i.exec(effect);
    const around = /^(?:All|Each|Every) creatures? within (\d+) feet of (?:the [\w' -]+?|it|them) (?:is|are) exposed to ([^.]+?)\.$/i.exec(effect);
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
    const said = split[2].trim().split(/(?<=\.)\s+(?=[A-Z])/);
    const uses = /^(?:The )?[\w' -]+? uses (?:its |their |his |her )?([A-Z][\w'-]*(?: [A-Z][\w'-]*)*)(, including the triggering creature in the area| against the (?:attacker|triggering creature)| and, if (?:it's|they're|he's|she's) aware of the damage's source, can Stride toward it)?\.$/.exec(said[0] ?? "");
    if (!uses) return null;
    const notes = [];
    if (uses[2] && /Stride toward/i.test(uses[2])) notes.push("If it's aware of the damage's source, it can Stride toward it.");
    if (uses[2] && /including the triggering creature/i.test(uses[2])) notes.push("Its area includes the triggering creature.");
    for (const sentence of said.slice(1)) {
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
    if (!/\bflings (?:the creature|an? (?:Grabbed )?creature) into the air\b/i.test(plain)) return null;
    const fall = Number(/\bfalls (\d+) feet\b/i.exec(plain)?.[1] ?? /\bup to (\d+) feet overhead\b/i.exec(plain)?.[1]);
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

function areaExposure(item, actor) {
    if (item.system?.actionType?.value === "reaction") return exposureReaction(item, actor);
    if (item.system?.actionType?.value !== "action") return null;
    const html = String(item.system?.description?.value ?? "");
    const template = /@Template\[(?:type:)?(burst|cone|emanation|line)\|distance:(\d+)[^\]]*\]/i.exec(html);
    const plain = htmlToPlainText(html.replace(/@Template\[[^\]]*\](?:\{[^}]*\})?/g, "@T").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\[\[\/(?:r|gmr|br|roll) [^\]]*\]\](?:\{([^}]*)\})?/g, "$1")).replace(/\s+/g, " ").trim()
        .replace(/^Frequency once per (?:round|turn) Effect /i, "");
    const wait = String.raw`(?: (?:The )?[^.]+? can(?:'t|not) (?:use )?(?:its |their )?[\w' -]+? again for (\d+d\d+|\d+) rounds?\.)?`;
    const gas = new RegExp(String.raw`^(?:The )?[^.]+? (?:exhales|emits|breathes out|sprays) (?:a cloud of )?(?:poisonous|toxic|noxious) gas in an? @T(?: centered on (?:the corner of )?one of (?:the [\w' -]+?['’]s|its|their) squares)?\. The gas persists (?:for 1 round|until the start of (?:the [\w' -]+?['’]s|its|their) next turn)\. Any creature in the area \(or that later enters the area\) is exposed to ([^.]+?)\.${wait}$`, "i").exec(plain);
    const area = gas ? null : new RegExp(String.raw`^(?:[^.@]+\. )?(?:Each|Every|All)(?: living)? creatures? within an? @T (?:is|are) exposed to ([^.]+?)\.${wait}$`, "i").exec(plain);
    const one = gas || area ? null : /^(?:The )?[^.]+? (?:an adjacent|a) (?:living )?creature(?: (?:that(?:'s| is)|who is) ([^,]+?))?, exposing (?:it|them) to ([^.]+?)\.$/i.exec(plain)
        ?? /^(?:The )?[^.]+? (?:on|at) a single creature within (\d+) feet\. The target is exposed to ([^.]+?)\.$/i.exec(plain);
    if (!gas && !area && !one) return null;
    if ((gas || area) && !template) return null;
    const phrase = (gas?.[1] ?? area?.[1] ?? one[2]).toLowerCase().replace(/^the /, "").replace(/^[\w' -]+?['’]s /, "");
    const owner = actor ?? item.actor ?? item.parent;
    const source = (owner?.items?.contents ?? owner?.items ?? []).find((other) => {
        if (other === item || !/<strong>\s*Stage\s+1\s*<\/strong>/i.test(other.system?.description?.value ?? "")) return false;
        const name = String(other.name ?? "").toLowerCase();
        return name === phrase || phrase.includes(name) || name.endsWith(` ${phrase}`);
    });
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
    const states = one && /^(?:The )?[^.]+? (?:an adjacent|a)/i.test(plain) && one[1] ? one[1].toLowerCase().split(/,? or |, /).map((state) => state.trim()).filter(Boolean) : [];
    const foe = states.length ? { within: 5, conditions: [...new Set(states.map((state) => (state === "unconscious" || state === "asleep" ? "dying" : state)).filter((state) => ["paralyzed", "dying", "restrained", "grabbed", "prone"].includes(state)))] } : null;
    if (states.length && !foe.conditions.length) return null;
    return {
        ...poison,
        source: base(item).source,
        activation: { time: String(Number(item.system?.actions?.value) || 1), traits: poison.activation?.traits ?? [] },
        targeting: gas || area ? { target: null, range: null, area: { type: template[1].toLowerCase(), value: Number(template[2]) } } : { target: "1 creature", range: one[1] && /^\d+$/.test(one[1]) ? Number(one[1]) : "touch", area: null },
        trigger: { event: "use", ...(recharge ? { recharge: { formula: recharge, unit: "rounds" } } : {}) },
        ...(foe ? { requiresFoe: foe } : {}),
        ...(gas ? { notes: [...(poison.notes ?? []), "The gas lingers: a creature that enters the area then is exposed too."] } : {})
    };
}

function poisonWeapon(item, actor) {
    if (item.system?.actionType?.value !== "action") return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const said = plain.replace(/^Requirements? (?:The )?[^.]+? is (?:wielding|holding) a piercing or slashing weapon(?: and has a free hand)?\.? Effect /i, "");
    const [first, ...rest] = said.split(/(?<=\.)\s+(?=[A-Z])/);
    // ("applies a poison to the weapon", "applies one of their black adder venom poisons to their wielded weapon", "draws a poison and
    // applies it to a weapon", "Interacts to draw an injury poison and applies the poison to the required weapon".)
    // (Batch 55, Envenom Weapon: "The seugathi applies their seugathi venom to one weapon they wield", "applies their innate seugathi venom
    // to their longsword": its own venom, the ability by that name.)
    const venom = /^(?:The )?[^.]+? applies (?:its|their|his|her) (?:innate )?([\w' -]+? venom) to (?:one weapon (?:it|they|he|she) wields?|(?:its|their|his|her) [\w' -]+?)\.$/i.exec(first ?? "");
    if (venom && !rest.length) return ownVenom(item, actor, venom[1]);
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
    if (!/\b(?:stares|fixes (?:its|their|his|her) (?:glare|gaze|[\w' -]+? eyes)|glares|focuses (?:its|their|his|her) gaze) (?:at|on) (?:a|one) (?:single )?creature\b/i.test(plain)) return null;
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
    if (!gaze?.resolution || gaze.resolution.check?.roll !== "save") return null;
    const range = Number(/\bwithin (\d+) feet\b/i.exec(plain)?.[1]) || 30;
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
const LAST_ACTION = String.raw`(?:last|previous) (?:action|attack)(?: this turn)?`;
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
    match = new RegExp(String.raw`^(?:The |the )?[^,]*? (hit|damaged|struck|critically hit|made a successful Strike against) an? (?:living )?(?:creature|target|foe|enemy)(?: it is duplicating)? with (?:an?|its|their|his|her) (?:(melee) )?(?:([\w' -]+?) )??(?:Strike )?(?:on|in|during|with) (?:its|their|his|her) ${LAST_ACTION}$`, "i").exec(text);
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
        if (!slug && (match = /^(?:The )?[\w' -]+? (?:[a-z]+s [^.,]*? and )?(?:attempts to|(?:makes|attempts) an? (?:Intimidat(?:e|ion)|Athletics) check to) (Disarm|Reposition|Shove|Trip|Grapple|Demoralize) (?:the (?:target creature|creature|target|foe)(?: (?:they|it|he|she) hit)?(?: using (?:their|its|his|her) [\w' -]+?'s reach)?|it|an object the creature (?:they|it|he|she) hit is holding|the target of (?:their|its|his|her) (?:[\w' -]+? )?Strike(?: or Disarm)?|the creature (?:they|it|he|she) struck(?: or disarmed)?)(?: with a (?:sudden|mere) [a-z]+)?(?:,? even if (?:the [\w' -]+?|it|they) (?:doesn't|does not) have a free hand)?\.$/i.exec(sentence))) slug = match[1].toLowerCase();
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
        .filter((sentence) => !/^(?:This (?:check|attempt) (?:neither applies nor counts|doesn't count|does not count) toward (?:the [\w' -]+?'s|its|their|his|her) multiple attack penalty\.|On a success, the triggering (?:action|movement) is disrupted(?: and the creature is Tripped as normal)?\.)$/i.test(sentence)).join(" ");
    const match = /^(?:The )?[^.]+? attempts an Athletics check to (Trip|Shove|Grapple) the triggering creature\.(?: This check (?:doesn't|does not) count toward (?:the [\w' -]+?'s|its|their) multiple attack penalty, and (?:its|their) multiple attack penalty (?:doesn't|does not) apply to this check\.)?$/i.exec(effect)
        ?? /^(?:The )?[^.]+? (?:attempts|makes) an Athletics check to (Trip|Shove|Grapple) the (?:triggering creature|target|creature)\.$|^(?:The )?[^.]+? (?:attempts to|uses (?:its|their|his|her) [\w' -]+? to attempt to|extends an? [\w' -]+? and attempts to) (Trip|Grapple) the (?:triggering )?creature\.$/i.exec(effect);
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
    const plain = htmlToPlainText(html.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/(?:an? )?@Template\[[^\]]*?(?:emanation|burst)[^\]]*?distance:(\d+)[^\]]*\](?:\{[^}]*\})?/g, "$1 feet")).replace(/\s+/g, " ").trim();
    // (Deadly Display's "Requirements Ordulf is wielding a melee weapon": always so; any other requirement or a frequency isn't read.)
    // (Batch 141: Strangle's "Requirements The dero must have two free hands or be wielding a spiked chain" — what it holds; "… to Grapple with a +2
    // circumstance bonus." and Condemn's "The grand inquisitor Demoralizes." — at a creature; Stampeding Shove's "…, gaining a +2 circumstance
    // bonus to their Athletics check if the target is Prone" — a note.)
    const extra = [];
    let fixed = null;
    let statistic = null;
    const told = plain.replace(/^Requirements? (?:The )?[^.]+? (?:is|are) wielding an? (?:melee )?weapon\.? Effect /i, "").replace(/^Requirements? (?:The )?[^.]+? must have two free hands or be wielding an? [\w' -]+?\.? Effect /i, "")
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
    const whom = String.raw`(an? (?:creature|foe|enemy|target)(?: within (\d+) feet)?|the nearest creature|(?:each|all|every) (?:enem(?:y|ies)|foes?|(?:living )?creatures?|opponents?) (?:within|in) (\d+) feet(?: (?:that|who) can hear (?:the [\w' -]+?|it|them|him|her)( but not (?:clearly )?see (?:it|them|him|her)(?: \([^)]*\))?)?)?|all non-allied creatures within (\d+) feet|up to (\d|two|three|four) creatures)`;
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
        if (/^Regardless of the result, each creature is temporarily immune to [\w' -]+? for (?:1|one) minute\.$|^These creatures are then immune to [\w' -]+? for (?:1|one) minute\.$|^Each creature is then temporarily immune for (?:1|one) minute\.$/i.test(sentence)) {
            immune = true;
            continue;
        }
        // (Batch 126: no penalty for an unshared language, however it's said; Demoralize's own immunity said again; one roll for all.)
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
        if (/^The target can remove this condition by taking an Interact action\.$/i.test(sentence)) {
            extra.push(sentence);
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
    const radius = Number(first[8] ?? first[10]) || 0;
    const reach = Number(first[7]) || null;
    const many = first[11] ? { one: 1, two: 2, three: 3, four: 4 }[String(first[11]).toLowerCase()] ?? Number(first[11]) : null;
    const targeting = radius ? { ...plan.targeting, target: null, range: null, area: { type: "emanation", value: radius } } : many ? { ...plan.targeting, target: `up to ${many} creatures` } : reach ? { ...plan.targeting, range: `${reach} feet` } : plan.targeting;
    const immunity = immune ? readImmunity(html, [item.name]) : null;
    const notes = [...(first[9] ? ["Only creatures that can hear it but not see it."] : []), ...extra, ...(first[13] ? [`Then it${first[13].replace(/^ and then/, "")}.`] : [])];
    return { ...plan, ...base(item, { traits: [...new Set([...(item.system?.traits?.value ?? []), ...(plan.traits ?? [])])] }), targeting, ...(immunity ? { trigger: { ...(plan.trigger ?? { event: "use" }), immunity } } : {}), ...(notes.length ? { notes } : {}) };
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
    const told = parts[2].split(/(?<=\.)\s+(?=[A-Z])/);
    // (Its capitalised words: "strikes out when the foe tries to flee" only tells it.)
    const sentences = told.length > 1 && !/\b(?:Strikes?|Trip|Grapple)\b/.test(told[0]) && !/\b(?:check|damage|save|disrupt\w*)\b/i.test(told[0]) ? told.slice(1) : told;
    const who = String.raw`(?:the (?:triggering )?creature|the target|the attacker|it|that creature)`;
    const first = sentences[0] ?? "";
    const struck = new RegExp(String.raw`^(?:The )?[^.]+? (?:makes|attempts) an? ([\w' -]+?) Strike (?:at|against) ${who}(?: with an? [–-](\d+) penalty)?\.$`, "i").exec(first)
        ?? new RegExp(String.raw`^(?:The )?[^.]+? Strikes ${who} with (?:its|their|his|her) ([\w' -]+?)\.$`, "i").exec(first)
        ?? (new RegExp(String.raw`^(?:The )?[^.]+? Strikes ${who}\.$`, "i").test(first) ? [first, "melee"] : null);
    if (!struck) return null;
    let disrupts = false;
    for (const sentence of sentences.slice(1)) {
        if (/^If (?:it|the Strike|the attack|this attack|the Strike) hits, (?:she|he|it|they|the [\w' -]+?|[A-Z][\w'-]+) disrupts (?:the (?:creature's|triggering) action|that action|the action)\.$|^On a success the target's action is interrupted;/i.test(sentence)) disrupts = true;
        else if (/^If (?:the attack|this attack|the Strike|it) is a critical hit(?: and the trigger was a move action)?, (?:she|he|it|they|the [\w' -]+?|[A-Z][\w'-]+) disrupts? (?:that|the triggering|the) action\.$/i.test(sentence)) disrupts ||= "critical";
        else if (/^This Strike (?:doesn't|does not) contribute to (?:his|her|its|their) multiple attack penalty, and (?:his|her|its|their) multiple attack penalty (?:doesn't|does not) apply to this Strike\.$/i.test(sentence)) continue;
        // (Root In Place's "If the creature was Flying when its action was disrupted, it falls.": the GM's.)
        else if (/^If the creature was Flying when its action was disrupted, it falls\.$/i.test(sentence)) continue;
        else return null;
    }
    const kinds = { leave: "move", enter: "approach" };
    const triggers = [...new Set((trigger.triggers ?? []).map((kind) => kinds[kind] ?? kind))];
    if (!triggers.length) return null;
    // (A distance in feet, Snap Shot's "within 30 feet": live play's, for a ranged Strike.)
    return { builtin: "reaction-strike", triggers, strike: struck[1].toLowerCase(), penalty: Number(struck[2] ?? 0), disrupts, ...(typeof trigger.within === "number" ? { within: trigger.within } : {}) };
}

// You're Next (2026-10-11, batch 52): "Trigger The prisoner reduces a creature to 0 hit points. Effect The prisoner attempts an
// Intimidation check with a +2 circumstance bonus to Demoralize a single creature it can see and that can see them." (also "attempts to
// Demoralize a single creature he can see. He gains a +2 circumstance bonus to this check", "… a creature within 60 feet, with a +2
// circumstance bonus") → PF2e's Demoralize with that bonus, set off by downing a creature (a free action's: free). null otherwise.
function downsDemoralize(item, basicActions) {
    const type = item.system?.actionType?.value;
    if (!["reaction", "free"].includes(type) || !basicActions.demoralize?.resolution) return null;
    const plain = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\[\[\/act ([\w-]+)[^\]]*\]\](?:\{([^}]*)\})?/g, (_all, slug, label) => label ?? slug.replace(/^\w/, (letter) => letter.toUpperCase()))).replace(/\s+/g, " ").trim();
    const parts = /^Trigger (.+?)\.? Effect (.+)$/.exec(plain);
    const trigger = parts ? readReactionTrigger(parts[1]) : null;
    if (trigger?.event === "foe-mishap") {
        // (Batch 57, Jeer at Failure: "Effect The mocking dragon laughs dismissively at the foe, attempting an Intimidation check to
        // Demoralize the creature. They do not take a penalty if the creature doesn't understand their language." → PF2e's Demoralize
        // at the triggering creature.)
        if (!/^(?:The )?[^.]+? laughs dismissively at the foe, attempting an Intimidation check to Demoralize the creature\.(?: (?:It|They|He|She) (?:does|do) not take a penalty if the creature doesn't understand (?:its|their|his|her) language\.)?$/i.test(parts[2])) return null;
        const plan = structuredClone(basicActions.demoralize);
        return { ...plan, ...base(item, { traits: plan.traits }), targeting: { ...plan.targeting, target: "the attacker" }, trigger: { ...trigger, ...(type === "free" ? { free: true } : {}) } };
    }
    // (Batch 72: as the fight starts or its turn begins, "The brass dragon roars out a mighty challenge and attempts to Demoralize a creature it
    // can see", "The director general attempts to Demoralize a creature within 60 feet that they can see and that can see the director
    // general" — at a creature of the GM's, the simulator's nearest foe.)
    if (!["downs", "initiative", "own-turn-start"].includes(trigger?.event)) return null;
    // (A first sentence that only tells it: "After downing the foe, Krosovahn menacingly reminds another foe that he's coming after them next.")
    const effect = parts[2].replace(/^After downing the foe, [^.]+\.\s*/i, "");
    const WHOM = String.raw`(?:a single creature|a creature|one creature|a creature within \d+ feet)(?: (?:that )?(?:it|he|she|they|xe) can see)?(?: and that can see (?:it|him|her|them|xir|the [\w' -]+?))?`;
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
    const match = /^(?:(?:The )?[^.@]+? intensifies nearby fires\. )?Every foe within (\d+) feet that is taking persistent (\w+) damage takes @Damage\[([^\]]+\])\] damage\.$/i.exec(plain);
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
export function compileMonsterAbility(source, options = {}) {
    if (!source || (source.type !== "action" && source.type !== "feat")) return null;
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
    return read;
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
    const modes = wickedBite(item) ?? compileModes(item, { basicActions, actor });
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
    if (!plan?.builtin && !plan?.resolution) return castSpell(item, actor) ?? riderReading(item, actor) ?? deathReading(item, actor) ?? hitByReading(item, actor) ?? grabTurnReading(item, actor) ?? selfHeal(item) ?? downsHeal(item) ?? selfCondition(item) ?? readRage(item, actor) ?? readStrikeBuff(item) ?? readSelfGuard(item) ?? focusGaze(item, actor, basicActions) ?? poisonWeapon(item, actor) ?? areaExposure(item, actor) ?? reactionUsesAbility(item, actor, { basicActions }) ?? actionUsesTwice(item, actor, { basicActions }) ?? areaUsesAbility(item, actor, { basicActions }) ?? moveUsesAbility(item, actor, { basicActions }) ?? betrayingTouch(item, actor, { basicActions }) ?? fling(item) ?? healTouch(item) ?? retributiveRune(item, actor) ?? plan;
    return listedRider(item, actor, plan) ?? hitBy(item, plan) ?? targetedBy(item, plan) ?? ownStrikePassive(item, plan) ?? damagedPassive(item, plan) ?? grabTurn(item, plan) ?? reactionTrigger(item, plan, actor) ?? plan;
}

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
    const trigger = String(text ?? "").trim().replace(/[.;]\s*$/, "").replace(/, or\b.*$/i, "");
    const types = (words) => {
        const found = [...String(words ?? "").matchAll(DAMAGE_WORDS)].map((match) => match[1].toLowerCase());
        return found.length ? [...new Set(found)] : null;
    };
    const refused = (words) => /\b(?:ranged|spells?|while|if|unless|ally|allies|first time|aura|metal|wooden|silver|cold iron|Tiny|Small|Medium|Large|Huge|Gargantuan|at least|points?|or more)\b|\d+ (?:or more )?(?:Hit Points|damage)/i.test(words);
    const hit = ({ critical, how, adjacent = false, within = "" }) => {
        // (Not one of several triggers: "A creature damages the door, fails to Force Open the door, or …".)
        if (refused(how) || how.includes(",") || refused(within.replace(/\bwithin \d+ feet\b/i, ""))) return null;
        const melee = adjacent || /\b(?:melee|unarmed|reach)\b/i.test(`${how} ${within}`);
        const unarmed = /\bunarmed\b/i.test(how) && !/\bmelee (?:weapon|attack|Strike)s?\b|\bweapons?\b/i.test(how.replace(/\bmelee unarmed\b/gi, "unarmed").replace(/\bunarmed melee\b/gi, "unarmed"));
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
    // A foe's mishap near it (batch 57, Jeer at Failure): "A foe within 90 feet becomes Prone or critically fails on a Strike".
    const mishap = /^An? (?:foe|enemy) within (\d+) feet becomes Prone or critically fails on a Strike$/i.exec(trigger);
    if (mishap) return { event: "foe-mishap", reaction: true, within: Number(mishap[1]) };
    // A creature near it losing a condition (batch 46, Consume Fear): "A creature within 60 feet loses the Frightened condition".
    const lost = /^(?:An?|Any) creature within (\d+) feet loses the (\w+) condition$/i.exec(trigger);
    if (lost) return { event: "condition-lost", reaction: true, condition: lost[2].toLowerCase(), within: Number(lost[1]) };
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
    if (new RegExp(String.raw`^${SELF} rolls (?:for )?initiative$`).test(trigger)) return { event: "initiative", reaction: true };
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
    const trigger = /\bTrigger (.+?) (?:Frequency|Requirements?|Effect)\b/.exec(plain)?.[1] ?? null;
    const ownTurn = trigger && type === "free" && /^(?:The [\w' -]+?|[A-Z][\w'-]+(?: [A-Z][\w'-]+)?)'s? turn begins\.?$/.test(trigger) ? true : null;
    // (Batch 30: a reaction's trigger the module reads, for temporary Hit Points on itself: "The forest dragon is targeted with a
    // water spell or effect".)
    // (The condition marks out of it: "loses the Frightened condition", batch 46.)
    const reacting = trigger && !ownTurn && type !== "action" ? readReactionTrigger(trigger.replace(/[\u0001\u0002]/g, "")) : null;
    if (trigger && !ownTurn && !reacting) return null;
    const requires = /\bRequirements? (.+?) Effect\b/.exec(plain)?.[1] ?? null;
    const effect = plain.includes("Effect ") ? plain.slice(plain.indexOf("Effect ") + 7) : plain;
    const sentences = effect.split(/(?<=\.)\s+/);
    // (The monster itself: not "The animal", "The target", "The creature".)
    const SUBJECT = String.raw`(?:The (?!(?:animal|target|creature|ally|allies|enemy|foe|mount)\b)[\w' -]+?|It|They|He|She|[A-Z][\w'-]+(?: [A-Z][\w'-]+)?)`;
    const DURATION = String.raw`(?: (?:until the (?:end|start|beginning) of (?:its|their|his|her|that ally's|each ally's) (?:next )?turn|this turn|for (?:\d+|one|1d4|1d4\+1|1d6) (?:round|minute)s?(?: \([^)]*\))?))?`;
    const EXTRA = String.raw`(?:,? (?:and|but) (?:it |they |he |she )?can use (?:this|the|its|their|his|her) extra action (?:only )?(?:for|to) [^.]+)?`;
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
    const notes = [];
    for (const [index, sentence] of sentences.entries()) {
        if (index === at || /^Frequency\b/.test(sentence)) continue;
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
        trigger: reacting ? { ...reacting, reaction: true, ...(type === "free" ? { free: true } : {}) } : { event: ownTurn ? "own-turn-start" : "use", ...(ownTurn ? { reaction: true, free: true } : {}) },
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
    const parts = /^Trigger (?:The )?[\w' -]+? reduces a creature (it can smell with its true sin scent )?to 0 (?:HP|Hit Points)\.? Effect (.+)$/i.exec(plain);
    if (!parts) return null;
    const heal = selfHeal(withDescription({ ...item, system: { ...item.system, actionType: { value: "action" } } }, `<p>${parts[2]}</p>`));
    if (!heal) return null;
    return { ...heal, ...base(item), trigger: { event: "downs", reaction: true, ...(item.system?.actionType?.value === "free" ? { free: true } : {}), ...(parts[1] ? { note: "Only a creature it can smell with its true sin scent." } : {}) } };
}

function selfHeal(item) {
    if (!["action", "free"].includes(item.system?.actionType?.value) || /<strong>\s*Trigger\s*<\/strong>/i.test(item.system?.description?.value ?? "")) return null;
    const html = String(item.system?.description?.value ?? "");
    const tags = inlineTags(html, "Damage");
    if (tags.length !== 1 || !/\bhealing\b/i.test(tags[0])) return null;
    const plain = htmlToPlainText(html.replace(/@Damage\[[^\]]*\]\]?(?:\{[^}]*\})?/g, "\u0000").replace(/\[\[\/(?:r|gmr|br) [^\]]*\]\](?:\{([^}]*)\})?/g, "$1").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    // (Requirements with no "Effect" label: "Requirements The ravenile's regeneration is currently active The ravenile regains …".)
    // (The labels are capitalised, so a "fear effect" in the requirement doesn't end it — batch 56.)
    const requires = /^(?:Frequency [^.]*?\s+)?Requirements? (.+?)\s+Effect\s/.exec(plain)?.[1] ?? (/\bRequirements?\b/.test(plain) ? (/\bRequirements? (.+?)\s+(?:The |It |They )/.exec(plain)?.[1] ?? "its requirements") : null);
    const effect = plain.replace(/^(?:Frequency .+?\s+)?(?:Requirements? .+?\s+)?Effect\s+/, "").replace(/^Frequency .+?\s+Effect\s+/i, "").replace(/^(?:Frequency [^.]*?\s+)?Requirements? .+?\s+(?=(?:The |It |They ))/, "");
    // (Batch 56, Feed on Fear: "The will-o'wisp feeds on the creature's terror. It regains 2d4 Hit Points, and if it has Gone Dark, its glow
    // reignites." — the first sentence only tells it, the glow is the GM's.)
    const sentences = effect.replace(/,? and (?:if (?:it has|they've|they have) Gone Dark, (?:its|their) glow reignites|its Glow reignites if it had been extinguished)\./i, ". If it has Gone Dark, its glow reignites.").replace(/^They regains\b/, "They regain").split(/(?<=\.)\s+/)
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
        if (/@|\u0000|\b(?:If|When|Whenever|Unless|While|Until)\b/.test(sentence) || /\b(?:damage|save|Strike|Grabbed|Frightened|Stunned|Slowed|Quickened|bonus|penalty|ally|allies|each|creatures?)\b/i.test(sentence)) return null;
        notes.push(sentence);
    }
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
    let trigger = String(text).replace(/\s*\([^)]*\)$/, "").replace(/\s+it(?:'|’)s using$/, "").replace(/\.$/, "").replace(/\bmanipulate or move action\b/g, "manipulate-or-move action");
    // (Batch 137, Kneecapper: "A Medium creature within the nuglub's reach …" — only a creature of that size.)
    const sized = /^An? (Tiny|Small|Medium|Large|Huge|Gargantuan) creature\b/.exec(trigger);
    if (sized) trigger = trigger.replace(sized[0], "A creature");
    // (Batch 68: "in the grick's reach", "within a clockwork sentry's reach", "within reach of Racharak's tail".)
    const subject = new RegExp(String.raw`^(?:An?|Any) (adjacent )?(?:creature|enemy|foe)(?: (?:that )?${SELF} (?:observes|can see))?(?: (?:within|in) (?:(\d+) feet|a @Template\[[^\]]*?distance:(\d+)[^\]]*\](?:\{[^}]*\})?|(?:${SELF}|an? [\w' -]+?)'s? reach|reach|(${SELF}))(?: of ${SELF}(?:['’]s [\w' -]+?)?)?| (adjacent) to ${SELF})?(?: (?:that )?${SELF} (?:observes|can see))? ((?:uses?|makes?|leaves?|Strides|enters|moves)\b.*)$`).exec(trigger);
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
        else if (/^leaves? (?:a|an adjacent) (?:square|space)(?: in the area)?(?: during (?:a|its|their) move action)?$/i.test(part)) triggers.add("leave");
        else if (/^Strides$/.test(part)) triggers.add("move");
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
