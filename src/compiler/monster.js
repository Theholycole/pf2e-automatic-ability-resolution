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
import { STAGE_CONDITIONS, degreeSections, inlineTags, readCheck, readConditions, readDamage, readImmunity, readPush, readRange, readRecharge, readTemplate } from "./inline.js";
import { compileSkillAction } from "./checks.js";
import { compileBuiltin } from "./builtins.js";
import { compileAffliction } from "./afflictions.js";

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
    return inlineTags(html, "Damage").map((raw, index) => ({ id: String(index), formula: readDamage(raw), type: null, category: null }));
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
    // "If Push lists a distance": the distance on a success.
    const distance = /\b(\d+) (?:feet|foot)\b/.exec(htmlToPlainText(item?.system?.description?.value ?? ""))?.[1];
    if (attackEffect === "push" && distance && rider.resolution.outcomes.success.forcedMovement) rider.resolution.outcomes.success.forcedMovement.distance = Number(distance);
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
        trigger: { event: "aura", when: "enter", immunity: { scope: "target", duration: "1 minute" } },
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
        trigger: { event: "aura", when: "enter", immunity: { scope: "target", duration: "1 minute" } },
        resolution: {
            kind: "save",
            check: { roll: "save", statistic: "fortitude", basic: false, against: { dc: "fixed", value: check.dc } },
            sharedDamage: null,
            outcomes: { criticalSuccess: none(), success: none(), failure: { ...none(), effects: [condition("sickened", 1)] }, criticalFailure: { ...none(), effects: [condition("sickened", 1), condition("slowed", 1)] } }
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
function saveOrOutcomes(html, components) {
    const sentences = String(html).replace(/<\/?p[^>]*>/gi, " ").split(/(?<=\.)\s+(?=[A-Z@<])/);
    const index = sentences.findIndex((sentence) => /@Check\[(?:fortitude|reflex|will)/i.test(sentence));
    if (index < 0) return null;
    const upTo = htmlToPlainText(sentences.slice(0, index + 1).join(" "));
    // A save that follows a Strike's hit ("On a hit, …", "struck by this attack") or a death ("When the dancer dies"): not an action of its own.
    if (/\bStrike\b|\bOn a (?:hit|success)\b|\bstruck by\b|\bhits\b/i.test(upTo)) return null;
    if (/\bWhen (?:a creature (?:slays|kills)|(?:the|this|a|an) [\w' -]+? (?:dies|is (?:killed|destroyed|slain))|killed)\b/i.test(upTo)) return null;
    // Damage before the save counts only in the save's own sentence ("dealing 6d6 damage in a cone (Will save)").
    const checkAt = sentences[index].search(/@Check\[/i);
    if (components.length && !/@Damage\[/i.test(sentences[index].slice(0, checkAt))) components = [];
    let failure = /succeed at an? @Check\[[^\]]*\] (?:saving throw|save) or (.+)$/i.exec(sentences[index])?.[1] ?? null;
    if (!failure) failure = /^(?:A|Each) creature that fails (?:its|the|this) save (.+)$/i.exec(sentences[index + 1] ?? "")?.[1] ?? /^On a failed save, (.+)$/i.exec(sentences[index + 1] ?? "")?.[1] ?? null;
    if (!failure) return null;
    // "(Stupefied 4 on a critical failure)" replaces; "(on a critical failure, the creature also falls Prone)" adds.
    let critical = null;
    let criticalAdds = false;
    const replaced = /\((?:or )?([^()]+?) on a critical failure\)/i.exec(failure);
    const added = /\(on a critical failure,? ([^()]+?)\)/i.exec(failure);
    if (added) {
        critical = added[1];
        criticalAdds = true;
        failure = failure.replace(added[0], "");
    } else if (replaced) {
        critical = replaced[1];
        failure = failure.replace(replaced[0], "");
    }
    const read = (text) => readConditions(text, { plain: STAGE_CONDITIONS }).map((effect) => ({ ...effect, recipient: undefined })).map(({ recipient, ...effect }) => effect);
    const failEffects = read(failure);
    const failDamage = inlineTags(failure, "Damage").map((raw) => ({ formula: readDamage(raw) }));
    const before = components.length && !failDamage.length;
    if (!failEffects.length && !failDamage.length && !before) return null;
    const row = (effects, damage, multiplier) => ({
        damage: before ? { mode: "shared", multiplier, sourceComponentIds: components.map((component) => component.id) } : damage.length ? { mode: "formulas", formulas: damage, rollScope: "outcome" } : { mode: "none", multiplier: 0, sourceComponentIds: [] },
        effects
    });
    // A critical failure's condition with no duration of its own lasts as long as the failure's.
    const lasting = failEffects.find((effect) => effect.duration)?.duration ?? null;
    const timed = (effects) => effects.map((effect) => (effect.duration || !lasting || effect.slug === "prone" ? effect : { ...effect, duration: lasting }));
    // "(1 minute on a critical failure)": the failure's conditions, for longer.
    const longer = critical && !criticalAdds ? /^(\d+) (round|minute|hour)s?$/i.exec(htmlToPlainText(critical).trim()) : null;
    const critEffects = longer
        ? failEffects.map((effect) => ({ ...effect, duration: { mode: "fixed", value: Number(longer[1]), unit: `${longer[2].toLowerCase()}s`, expiry: "turn-start", anchor: "effect-start" } }))
        : critical ? (criticalAdds ? [...failEffects, ...read(critical)] : read(critical).length ? timed(read(critical)) : failEffects) : failEffects;
    return {
        criticalSuccess: row([], [], 0),
        success: before ? row([], [], 0.5) : row([], [], 0),
        failure: row(failEffects, failDamage, 1),
        criticalFailure: row(critEffects, failDamage, 2)
    };
}

// Breath weapons and other abilities with an inline save.
function inlineSave(item) {
    const html = item.system?.description?.value ?? "";
    const checks = inlineTags(html, "Check").map(readCheck).filter((check) => check.save && check.dc);
    if (!checks.length) return null;
    const check = checks[0];
    const components = damageComponents(html.split(/<strong>\s*(?:Critical Success|Success|Failure|Critical Failure)\s*<\/strong>/i)[0]);
    const sections = degreeSections(html);
    let outcomes;
    if (check.basic && components.length) outcomes = basicRows(components.map((component) => component.id));
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
                row.effects = readConditions(section);
                const push = readPush(section);
                if (push) row.forcedMovement = push;
            }
            outcomes[degree] = row;
        }
    } else {
        outcomes = saveOrOutcomes(html, components);
        if (!outcomes) return null;
    }
    const plain = htmlToPlainText(html);
    const passive = item.system?.actionType?.value === "passive";
    // An aura with no template: "30 feet." at the start of its text.
    const template = inlineTags(html, "Template").map(readTemplate).find(Boolean) ?? (passive && /^(\d+) feet/i.test(plain) ? { type: "emanation", value: Number(/^(\d+) feet/i.exec(plain)[1]) } : null);
    const range = readRange(plain);
    const recharge = readRecharge(html);
    // Only creatures it's holding ("each creature it has grabbed").
    const grabbed = /\b(?:creatures?|targets?) (?:it(?:'s| is| has)?|the monster(?:'s| is| has)?) (?:grabbed|grabbing|restrained|restraining)|\b(?:grabbed|restrained) by (?:it|the monster)\b/i.test(plain);
    return {
        ...base(item),
        targeting: { target: template ? null : "1 creature", range: range ? `${range} feet` : template ? null : "touch", area: template, ...(grabbed ? { grabbed: true } : {}) },
        trigger: { event: passive ? "aura" : "use", ...(recharge ? { recharge: { formula: recharge, unit: "rounds" } } : {}), ...(readImmunity(html) ? { immunity: readImmunity(html) } : {}) },
        resolution: { kind: "save", check: { roll: "save", statistic: check.statistic, basic: check.basic, against: { dc: "fixed", value: check.dc } }, sharedDamage: components.length ? { rollOnce: true, components } : null, outcomes }
    };
}

// A plan for an NPC ability, { builtin } for rules the simulator plays itself,
// or null. basicActions: the compiled basic actions ({ grapple, trip, shove, … }), for riders.
// actor: the creature, when the item has none (pack data), for Trample's Strike.
export function compileMonsterAbility(item, { basicActions = {}, actor = null } = {}) {
    if (!item || (item.type !== "action" && item.type !== "feat")) return null;
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
    // Poisons, diseases and curses with stages, delivered by the Strikes that list them.
    if (/<strong>\s*Stage\s+1\s*<\/strong>/i.test(item.system?.description?.value ?? "")) return compileAffliction(item, base(item));
    return compileBuiltin(item, slug) ?? inlineSave(item) ?? compileSkillAction(item);
}
