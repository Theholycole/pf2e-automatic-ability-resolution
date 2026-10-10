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
import { OTHER_WAY, STAGE_CONDITIONS, degreeSections, immunityDetails, inlineTags, modernInline, readCheck, readConditions, readDamage, readDuration, readImmunity, readLinger, readPush, readRange, readRecharge, readTemplate } from "./inline.js";
import { compileSkillAction } from "./checks.js";
import { compileBuiltin } from "./builtins.js";
import { compileAffliction } from "./afflictions.js";
import { readActiveAfter, readAuraTiming } from "./auras.js";

const none = () => ({ damage: { mode: "none", multiplier: 0, sourceComponentIds: [] }, effects: [] });
const shared = (multiplier, ids) => ({ damage: { mode: "shared", multiplier, sourceComponentIds: ids }, effects: [] });
const basicRows = (ids) => ({ criticalSuccess: shared(0, []), success: shared(0.5, ids), failure: shared(1, ids), criticalFailure: shared(2, ids) });
const condition = (slug, value = null, duration = null) => ({ kind: "condition", slug, value, duration });

// The glossary key an item uses, as PF2e's slug ("improved-grab").
export function glossarySlug(item) {
    const localized = /@Localize\[PF2E\.NPC\.Abilities\.Glossary\.([A-Za-z]+)\]/.exec(item?.system?.description?.value ?? "")?.[1];
    if (localized) return localized.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
    return item?.system?.slug ?? null;
}

// Rules PF2e's own engine or the simulator already play: no plan needed.
export const BUILT_IN = new Set(["attack-of-opportunity", "reactive-strike", "shield-block", "throw-rock", "ferocity", "rend"]);
// Abilities that change nothing in a fight's numbers (Change Shape keeps the creature's Speed, attacks and damage).
const NO_EFFECT = new Set(["change-shape"]);

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
    const action = { grab: "grapple", "improved-grab": "grapple", knockdown: "trip", "improved-knockdown": "trip", push: "shove", "improved-push": "shove" }[slug];
    const plan = basicActions?.[action];
    if (!plan) return null;
    const improved = slug.startsWith("improved-");
    const attackEffect = slug.replace(/^improved-/, "");
    const rider = structuredClone(plan);
    rider.source = { name: item?.name ?? slug, slug, uuid: item?.uuid ?? null, type: "action" };
    rider.activation = { time: improved ? "free" : "1", traits: plan.traits };
    rider.trigger = { event: "strike", on: ["success", "criticalSuccess"], attackEffect, cost: improved ? "free" : "action", map: false };
    // "If Push lists a distance": the distance on a success (and a critical success pushes no less).
    // (In the name, "Push 15 feet", or the text.)
    const distance = /\b(\d+) (?:feet|foot)\b/.exec(`${item?.name ?? ""} ${htmlToPlainText(item?.system?.description?.value ?? "")}`)?.[1];
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
    const formula = damageComponents(html)[0]?.formula;
    const escapeDC = Number(/\[\[\/act escape dc=(\d+)\]\]/i.exec(html)?.[1]) || null;
    const rupture = Number(/Rupture (\d+)/i.exec(htmlToPlainText(html))?.[1]) || null;
    if (!check?.dc || !formula) return null;
    const sizes = { tiny: "tiny", sm: "small", med: "medium", lg: "large", huge: "huge", grg: "gargantuan" };
    const size = sizes[(actor ?? item.actor ?? item.parent)?.system?.traits?.size?.value] ?? "medium";
    const engulfed = () => ({ damage: { mode: "formulas", formulas: [{ formula }], rollScope: "outcome" }, effects: [{ kind: "swallow", damage: formula, rupture, size, escapeDC }] });
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
    const strike = items.find((entry) => entry.type === "melee" && entry.name.toLowerCase() === wanted) ?? items.find((entry) => entry.type === "melee" && entry.name.toLowerCase().startsWith(wanted));
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
    const [sizeText, strikeName] = first.split(",").map((part) => part.trim());
    const components = strikeName ? strikeComponents(item, strikeName, actor) : [];
    if (!check?.dc || !components.length) return null;
    return {
        ...base(item),
        targeting: { target: "creatures whose space it moves through", range: null, area: null, trample: { size: sizeOf(sizeText ?? "") ?? "medium", strides: 2 } },
        trigger: { event: "use" },
        resolution: { kind: "save", check: { roll: "save", statistic: "reflex", basic: true, against: { dc: "fixed", value: check.dc } }, sharedDamage: { rollOnce: true, components }, outcomes: basicRows(components.map((component) => component.id)) }
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
        let end = masked.slice(from).search(/(?<=[.;])\s|;/);
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

function saveOrOutcomes(html, components, { afterHit = false, riders = false } = {}) {
    const sentences = String(html).replace(/<\/?p[^>]*>/gi, " ").split(/(?<=\.)\s+(?=[A-Z@<])/);
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
    let failure = legacy ?? /succeed(?: at)? an? @Check\[[^\]]*\](?:\{[^}]*\})? (?:saving throw|save) or (.+)$/i.exec(sentences[index])?.[1] ?? null;
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
    if (!legacy && !riders && !TARGET_WORDS.test(htmlToPlainText(`${sentences[index - 1] ?? ""} ${sentences[index].slice(0, sentences[index].search(/@Check\[/i))}`))) return null;
    // "(Stupefied 4 on a critical failure)" replaces; "(on a critical failure, the creature also falls Prone)" adds.
    let critical = null;
    let criticalAdds = false;
    // A sentence of its own that adds to the critical failure ("Creatures that critically fail also take …") on top of
    // the failure's own "(or Blinded on a critical failure)".
    let extraCritical = null;
    proseCritical ??= legacyCritical;
    const replaced = /\((?:or )?([^()]+?) on (?:a )?critical failure\)/i.exec(failure) ?? /,? or ((?:@(?:UUID|Damage)\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?|[^;.()@])+?) on (?:a )?critical failure\b/i.exec(failure);
    const added = /\(on (?:a )?critical failure,? ([^()]+?)\)/i.exec(failure);
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
    if (!failEffects.length && !failDamage.length && !before && !shoved && !(riders && (critDamage.length || extraDamage.length || (critical && (read(critical).length || /\bpush|\bshove/i.test(critical)))))) return null;
    const row = (effects, damage, multiplier) => ({
        damage: before ? { mode: "shared", multiplier, sourceComponentIds: components.map((component) => component.id) } : damage.length ? { mode: "formulas", formulas: damage, rollScope: "outcome" } : { mode: "none", multiplier: 0, sourceComponentIds: [] },
        effects
    });
    // A critical failure's condition with no duration of its own lasts as long as the failure's.
    const lasting = failEffects.find((effect) => effect.duration)?.duration ?? null;
    // Not a fixed time for frightened, which fades by its own rule ("As failure, but Frightened 3" after
    // "…Fascinated until the end of its next turn"); "as long as it remains in the aura" still carries over.
    const timed = (effects) => effects.map((effect) => (effect.duration || !lasting || effect.slug === "prone" || (effect.slug === "frightened" && lasting.mode === "fixed") ? effect : { ...effect, duration: lasting }));
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
        return instead ? timed([{ ...effect, ...instead, value: instead.value ?? effect.value, duration: instead.duration ?? effect.duration }])[0] : effect;
    });
    const critEffects = [...(longer
        ? failEffects.map((effect) => (effect.slug === "prone" ? effect : { ...effect, duration: longer }))
        : critical ? (criticalAdds ? [...failEffects, ...read(critical)] : critRead.length ? (swaps ? swapped() : timed(critRead)) : failEffects) : failEffects), ...(extraCritical ? read(extraCritical) : [])];
    // "On a success, the creature gains the Frightened 1 condition" (2026-10-10).
    const successEffects = proseSuccess ? read(proseSuccess) : [];
    // "pushed 15 feet (30 feet on a critical failure)": farther on a critical failure.
    // …or a push the critical failure names itself ("Creatures that critically fail are pushed 10 feet away").
    const farther = critical && !criticalAdds ? /^(\d+) feet$/i.exec(htmlToPlainText(critical).trim()) : null;
    const critShoved = critical && !farther ? SHOVE.exec(htmlToPlainText(critical.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1"))) : null;
    const pushed = (outcome, distance = shoved?.[1]) => (distance ? { ...outcome, forcedMovement: { kind: "push", distance: Number(distance), upTo: false, optional: false, direction: "away" } } : outcome);
    return {
        criticalSuccess: row([], [], 0),
        success: before ? row(successEffects, [], 0.5) : row(successEffects, [], 0),
        failure: pushed(row(failEffects, failDamage, 1)),
        criticalFailure: pushed(row(critEffects, critFormulas, 2), farther?.[1] ?? critShoved?.[1] ?? shoved?.[1])
    };
}

// An activity that makes one Strike (after a Stride or two, perhaps) with
// something more on a hit, sentence by sentence; null when a sentence isn't one of these:
//   "The jailer makes a melee Strike. If it hits and deals damage, the target is Frightened 1, or Frightened 2 on a critical hit."
//   "The arboreal warden Strides and then makes a shield bash Strike. If the attack hits, the target is pushed 10 feet."
//   "… makes a weapon Strike. If the Strike hits, the target must succeed at a @Check[fortitude|dc:19] save or become Blinded …"
//   "The rhinoceros Strides twice, then makes a horn Strike. As long as … moved at least 20 feet, … A Medium or smaller creature struck by this attack must succeed at …"
export const strikeActivityReject = { last: null };

function strikeActivity(item, actor) {
    const reject = (text) => {
        strikeActivityReject.last = text;
        return null;
    };
    const html = (item.system?.description?.value ?? "").replace(/<p>\s*<strong>\s*(?:Requirements|Frequency)\s*<\/strong>[\s\S]*?<\/p>\s*(?:<hr\s*\/?>)?/gi, (block) => (/Frequency/i.test(block) && /once per (?:day|hour|minute|10 minutes)/i.test(block) ? "<p>[once]</p>" : /Requirements/i.test(block) ? `<p>[requires ${htmlToPlainText(block).replace(/^Requirements\s*/i, "")}]</p>` : "")).replace(/<strong>\s*Effect\s*<\/strong>/gi, "");
    const sentences = html.replace(/<\/?p[^>]*>|<hr\s*\/?>/gi, " ").split(/(?<=[.\]])\s+(?=[A-Z@<[])/).map((sentence) => sentence.trim()).filter(Boolean);
    const activity = { builtin: "strike-activity", actions: Number(item.system?.actions?.value) || 1, strides: 0, strike: null, attackBonus: 0, damageBonus: 0, offGuard: false, requires: null, oncePerFight: false, onHit: { conditions: [], critical: null, push: null, damage: [], save: null, size: null } };
    let opened = false;
    const hit = "^(?:If|When) (?:it|the (?:Strike|attack|strike)|this (?:Strike|attack)) hits(?: and deals damage)?, ";
    const conditions = (text) => readConditions(text, { plain: STAGE_CONDITIONS }).map((effect) => ({ slug: effect.slug, value: effect.value, duration: effect.duration }));
    for (const sentence of sentences) {
        // Linked names as words ("@UUID[…]{Grabbed}" → "Grabbed"); @Check and @Damage are read from the sentence itself.
        const text = htmlToPlainText(sentence.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
        let match;
        if (text === "[once]") activity.oncePerFight = true;
        else if ((match = /^\[requires (.+)\]$/.exec(text))) {
            // A free hand: not while it holds a creature (the grab uses the hand). Held weapons aren't tracked.
            if (/(?:has|must have) (?:a creature|an enemy|a foe) Grabbed|is grabbing a creature/i.test(match[1])) activity.requires = "grabbed";
            else if (/has a (?:free )?hand(?: free)?/i.test(match[1])) activity.requires = "free-hand";
            else if (!/is wielding|is holding/i.test(match[1])) return reject(text);
        } else if (!opened && (match = /^The [^.]+? (?:(Strides(?: twice)?),? (?:and |then |and then )*)?(?:makes|attempts) an? (?:([\w' -]+?) )?Strike(?: (?:against|at) an? (?:creature|foe|enemy) (?:it has |it's |it is |that is |that's )?(?:Grabbed|grabbing|Restrained)[^.,]*?| (?:against|at) an? Prone (?:creature|foe|enemy))?(?: with an? \+(\d+) circumstance bonus to (damage|(?:its |the )?attack roll))?(?: with an? [\w' -]+? weapon(?: or unarmed attack)?|, [a-z][^.\d]*)?\.$/i.exec(text)) && !/\b(?:damage|feet|bonus|penalty|reach|each|two|three|Strikes)\b/i.test(text.slice(text.search(/Strike\b/) + 6).replace(/with an? \+\d+ circumstance bonus to (?:damage|(?:its |the )?attack roll)/i, ""))) {
            opened = true;
            activity.strides = match[1] ? (/twice/i.test(match[1]) ? 2 : 1) : 0;
            activity.strike = match[2] && !/^(?:melee|weapon)$/i.test(match[2]) ? match[2].toLowerCase() : null;
            if (match[3]) activity[/damage/i.test(match[4]) ? "damageBonus" : "attackBonus"] = Number(match[3]);
            if (/Grabbed|grabbing|Restrained/i.test(text)) activity.requires = "grabbed";
            else if (/\bProne (?:creature|foe|enemy)\b/i.test(text)) activity.requires = "prone";
        } else if (!opened) return reject(text);
        else if (/^The target is Off-Guard to the Strike\.$/i.test(text)) activity.offGuard = true;
        else if (/remains? hidden until after|^During the Stride/i.test(text)) continue;
        else if ((match = /^(?:If|As long as) (?:it|they|the [\w' -]+?) moved at least 20 feet(?: away from (?:its|their) starting position)?, (?:it gains|they gain) a \+(\d+) circumstance bonus to (?:its|their|this) attack roll\.$/i.exec(text))) activity.attackBonus += Number(match[1]);
        else if (/^(?:If|As long as) (?:it|they|the [\w' -]+?) moved at least 20 feet(?: away from (?:its|their) starting position)?, the Strike's damage (?:is increased to|increases to) /i.test(text)) activity.damage = inlineTags(sentence, "Damage").map(readDamage)[0] ?? /(?:to) (\d+d\d+(?:\s*[+-]\s*\d+)?)/i.exec(text)?.[1] ?? null;
        else if ((match = new RegExp(`${hit}(?:the [\\w ]+? )?(?:automatically )?push(?:es)? the target (\\d+) feet\\.$`, "i").exec(text)) || (match = new RegExp(`${hit}the target is pushed (\\d+) feet\\.$`, "i").exec(text))) activity.onHit.push = Number(match[1]);
        else if ((match = new RegExp(`${hit}it deals an? (?:additional|extra) `, "i").exec(text)) && inlineTags(sentence, "Damage").length === 1 && /damage\.$/i.test(text)) activity.onHit.damage.push(readDamage(inlineTags(sentence, "Damage")[0]));
        else if ((match = new RegExp(`${hit}(?:the target|that creature|the creature|the foe) is (.+?)\\.$`, "i").exec(text)) || (match = /^On a hit, (?:the target|the creature) is (.+?)\.$/i.exec(text))) {
            const [plain, critical] = match[1].split(/, or (?=[^,]+ on a critical hit$)/i);
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
    if (!opened || (!rider.conditions.length && !rider.critical && !rider.push && !rider.damage.length && !rider.save && !activity.offGuard && !activity.damageBonus)) return null;
    if (activity.strides && !activity.attackBonus && activity.actions < activity.strides + 1 && !rider.save && !rider.conditions.length) return null;
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

function inlineSave(item, actor = null) {
    const html = item.system?.description?.value ?? "";
    const checks = inlineTags(html, "Check").map(readCheck).filter((check) => check.save && check.dc);
    if (!checks.length) return null;
    const check = checks[0];
    // Two ways to use it, each with its own save ("The wyrm breathes in one of two ways"): the GM's.
    if (new Set(checks.map((each) => each.statistic)).size > 1 && /\bin one of (?:two|three|four|the following) ways\b|\bone of the following (?:ways|modes|forms)\b|\bchooses? one effect\b/i.test(htmlToPlainText(html))) return null;
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
        outcomes = basicRows(components.map((component) => component.id));
        // What a failure or critical failure adds (2026-10-10): "A creature that fails its save is also Stupefied 1",
        // "Creatures that critically fail also take 5 persistent acid damage", "also knocked Prone".
        // Not when they're one of several effects to choose from ("chooses one of the following additional effects").
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
    } else if (basicDamage === null && !Object.keys(sections).length) return null;
    else if (Object.keys(sections).length) {
        outcomes = {};
        for (const degree of ["criticalSuccess", "success", "failure", "criticalFailure"]) {
            const section = sections[degree];
            const row = none();
            if (section) {
                const formulas = inlineTags(section, "Damage").map((raw) => ({ formula: readDamage(raw) }));
                if (formulas.length) row.damage = { mode: "formulas", formulas, rollScope: "outcome" };
                // "takes half damage" / "full damage" / "double damage" against the ability's own damage.
                const plain = htmlToPlainText(section);
                const multiplier = /double damage/i.test(plain) ? 2 : /full damage/i.test(plain) ? 1 : /half damage/i.test(plain) ? 0.5 : null;
                if (multiplier !== null && components.length) row.damage = { mode: "shared", multiplier, sourceComponentIds: components.map((component) => component.id) };
                // Conditions named without links count too ("Failure The creature is slowed 1 for 1d4 rounds").
                row.effects = readConditions(section, { plain: SECTION_CONDITIONS });
                const push = readPush(section);
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
            outcomes[degree] = { ...copy, damage, effects: [...copy.effects.filter((effect) => !own.effects.some((other) => other.slug === effect.slug)), ...own.effects] };
        }
    } else {
        outcomes = saveOrOutcomes(html, components);
        if (!outcomes) return null;
    }
    const plain = htmlToPlainText(html);
    const passive = item.system?.actionType?.value === "passive";
    // "It recovers after it has been out of the aura for 1 minute": its conditions last while inside, and that long after.
    const recovers = /\brecovers after (?:it has been|being) out of the (?:aura|area|emanation)\b/i.test(plain) ? readLinger(plain) : null;
    if (recovers) for (const row of Object.values(outcomes)) for (const effect of row.effects ?? []) if (effect.kind === "condition" && !effect.duration) effect.duration = { mode: "in-aura", after: recovers };
    // A real aura (the trait, or PF2e's Aura rule); other passives (Death Throes, Defensive Quills) act on their own triggers.
    const aura = passive && ((item.system?.traits?.value ?? []).includes("aura") || (item.system?.rules ?? []).some((rule) => rule?.key === "Aura"));
    // An aura with no template: "30 feet." at the start of its text.
    const template = inlineTags(html, "Template").map(readTemplate).find(Boolean) ?? (passive && /^(\d+) feet/i.test(plain) ? { type: "emanation", value: Number(/^(\d+) feet/i.exec(plain)[1]) } : null);
    const range = readRange(plain);
    const recharge = readRecharge(html);
    const immunity = readImmunity(html, [item.name, (actor ?? item.actor ?? item.parent)?.name]);
    // Only creatures it's holding ("each creature it has grabbed").
    const grabbed = /\b(?:creatures?|targets?) (?:it(?:'s| is| has)?|the monster(?:'s| is| has)?) (?:grabbed|grabbing|restrained|restraining)|\b(?:grabbed|restrained) by (?:it|the monster)\b/i.test(plain);
    return {
        ...base(item),
        targeting: { target: template ? null : "1 creature", range: range ? `${range} feet` : template ? null : "touch", area: template, ...(grabbed ? { grabbed: true } : {}) },
        trigger: { event: aura ? "aura" : passive ? "passive" : "use", ...(aura ? readAuraTiming(plain) : {}), ...(aura && readActiveAfter(plain) ? { activeAfter: readActiveAfter(plain) } : {}), ...(recharge ? { recharge: { formula: recharge, unit: "rounds" } } : {}), ...(immunity ? { immunity } : {}) },
        resolution: { kind: "save", check: { roll: "save", statistic: check.statistic, basic: check.basic, against: { dc: "fixed", value: check.dc } }, sharedDamage: components.length ? { rollOnce: true, components } : null, outcomes }
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

// A plan for an NPC ability, { builtin } for rules the simulator plays itself,
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
    if (["grab", "improved-grab", "knockdown", "improved-knockdown", "push", "improved-push"].includes(slug)) return rider(item, slug, basicActions);
    if (slug === "constrict" || slug === "greater-constrict") return constrict(item, { greater: slug === "greater-constrict" });
    if (slug === "frightful-presence") return frightfulPresence(item);
    if (slug === "stench") return stench(item);
    if (slug === "swallow-whole") return swallowWhole(item);
    if (slug === "trample") return trample(item, actor);
    if (slug === "engulf") return engulf(item, actor);
    // Poisons, diseases and curses with stages, delivered by the Strikes that list them.
    if (/<strong>\s*Stage\s+1\s*<\/strong>/i.test(item.system?.description?.value ?? "")) return compileAffliction(item, base(item));
    return compileBuiltin(item, slug) ?? (item.system?.actionType?.value === "action" ? strikeActivity(item, actor) : null) ?? inlineSave(item, actor) ?? compileSkillAction(item);
}
