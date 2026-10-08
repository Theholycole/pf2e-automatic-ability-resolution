// Skill actions against a target's DC, compiled from PF2e's own text
// (the actions pack's Demoralize, Trip, Grapple, Shove, Feint, and monster
// abilities written the same way): "Attempt an [[/act trip]]{Athletics}
// check against the target's Reflex DC", then outcome sections.

import { htmlToPlainText } from "../../../pf2e-resolution-core/src/text/plain-text.js";
import { degreeSections, inlineTags, readConditions, readDamage, readImmunity, readPush } from "./inline.js";

const SKILLS = ["acrobatics", "arcana", "athletics", "crafting", "deception", "diplomacy", "intimidation", "medicine", "nature", "occultism", "performance", "religion", "society", "stealth", "survival", "thievery", "perception"];
const DEFENSES = { fortitude: "fortitude", reflex: "reflex", will: "will", perception: "perception", ac: "ac" };

// "{Athletics} check against the target's Reflex DC" → { statistic, against }.
export function readSkillCheck(html) {
    const plain = htmlToPlainText(String(html ?? "").replace(/\[\[\/act [^\]]*\]\]\{([^}]+)\}/g, "$1"));
    const match = /\b(Acrobatics|Arcana|Athletics|Crafting|Deception|Diplomacy|Intimidation|Medicine|Nature|Occultism|Performance|Religion|Society|Stealth|Survival|Thievery|Perception) check against (?:that |the |your |its )?(?:target's|creature's|its) (Fortitude|Reflex|Will|Perception) DC/i.exec(plain);
    if (!match) return null;
    const statistic = match[1].toLowerCase();
    return SKILLS.includes(statistic) ? { roll: statistic === "perception" ? "perception" : "skill", statistic, against: { dc: "target", statistic: DEFENSES[match[2].toLowerCase()] } } : null;
}

function outcomeRow(html, { selfByDefault = false } = {}) {
    const row = { damage: { mode: "none", multiplier: 0, sourceComponentIds: [] }, effects: [] };
    if (!html) return row;
    const formulas = inlineTags(html, "Damage").map((raw) => ({ formula: readDamage(raw) }));
    if (formulas.length) row.damage = { mode: "formulas", formulas, rollScope: "target" };
    let effects = readConditions(html);
    if (selfByDefault) effects = effects.map((effect) => ({ ...effect, recipient: "self" }));
    row.effects = effects;
    const push = readPush(html);
    if (push) row.forcedMovement = push;
    return row;
}

// A plan for a skill action, or null when its text isn't a check against a DC.
export function compileSkillAction(item, { rank = 1 } = {}) {
    const html = item?.system?.description?.value ?? "";
    const check = readSkillCheck(html);
    if (!check) return null;
    const sections = degreeSections(html);
    if (!Object.keys(sections).length) return null;
    const traits = [...(item.system?.traits?.value ?? [])];
    return {
        modelVersion: 13,
        source: { name: item.name, slug: item.system?.slug ?? null, uuid: item.uuid ?? null, type: item.type },
        rank,
        traits,
        activation: { time: String(item.system?.actions?.value ?? 1), traits },
        targeting: { target: "1 creature", range: /within 30 feet/i.test(htmlToPlainText(html)) ? "30 feet" : traits.includes("attack") ? "touch" : "30 feet", area: null },
        trigger: { event: "use", immunity: readImmunity(html) },
        resolution: {
            kind: "check",
            check,
            sharedDamage: null,
            outcomes: {
                criticalSuccess: outcomeRow(sections.criticalSuccess),
                success: outcomeRow(sections.success),
                failure: outcomeRow(sections.failure),
                criticalFailure: outcomeRow(sections.criticalFailure)
            }
        },
        automation: { level: "automatic" }
    };
}

// Escape: PF2e's text asks for the DC "of the effect"; the simulation and the
// card use the grabber's Athletics DC, with the best of the creature's unarmed
// attack, Acrobatics and Athletics.
export function compileEscape(item) {
    const end = { kind: "end-condition", slugs: ["grabbed", "restrained", "immobilized"], recipient: "self" };
    const none = { damage: { mode: "none", multiplier: 0, sourceComponentIds: [] }, effects: [] };
    return {
        modelVersion: 13,
        source: { name: item?.name ?? "Escape", slug: "escape", uuid: item?.uuid ?? null, type: item?.type ?? "action" },
        rank: 1,
        traits: ["attack"],
        activation: { time: "1", traits: ["attack"] },
        targeting: { target: "the creature grabbing you", range: "touch", area: null },
        trigger: { event: "use" },
        resolution: {
            kind: "check",
            check: { roll: "skill", statistic: ["unarmed", "acrobatics", "athletics"], against: { dc: "target", statistic: "athletics" } },
            sharedDamage: null,
            outcomes: { criticalSuccess: { ...none, effects: [end] }, success: { ...none, effects: [end] }, failure: none, criticalFailure: none }
        },
        automation: { level: "automatic" }
    };
}

// --- Skill actions whose results need more than conditions --------------------

const nextTurnEnd = { mode: "fixed", value: 1, unit: "rounds", expiry: "turn-end", anchor: "source-turn" };
const thisTurnEnd = { mode: "fixed", value: 0, unit: "rounds", expiry: "turn-end", anchor: "source-turn" };

// Disarm: on a critical success the item falls (its Strikes can't be made
// until it's picked up); on a success the grip weakens (-2 circumstance to
// attacks with it until the holder changes grip). PF2e's text, from the actions pack.
export function compileDisarm(item) {
    const plan = compileSkillAction(item);
    if (!plan) return null;
    const outcomes = plan.resolution.outcomes;
    outcomes.criticalSuccess.effects = [{ kind: "disarm", what: "drop" }];
    outcomes.success.effects = [{ kind: "disarm", what: "weaken", penalty: 2 }];
    return plan;
}

// Feint: off-guard against the actor's melee attacks only (scope). Critical
// success: until the end of the actor's next turn; success: its next melee
// attack this turn; critical failure: the actor is off-guard to the target's melee attacks.
export function compileFeint(item) {
    const plan = compileSkillAction(item);
    if (!plan) return null;
    const outcomes = plan.resolution.outcomes;
    outcomes.criticalSuccess.effects = [{ kind: "condition", slug: "off-guard", value: null, duration: nextTurnEnd, scope: { against: "actor", attacks: "melee" } }];
    outcomes.success.effects = [{ kind: "condition", slug: "off-guard", value: null, duration: thisTurnEnd, scope: { against: "actor", attacks: "melee", uses: 1 } }];
    outcomes.criticalFailure.effects = [{ kind: "condition", slug: "off-guard", value: null, duration: nextTurnEnd, recipient: "self", scope: { against: "target", attacks: "melee" } }];
    // "You are within melee reach of the target."
    plan.targeting = { ...plan.targeting, range: "touch" };
    return plan;
}

// Reposition: the user picks where the creature goes (within reach, not into
// or through obstacles), so the card says how far and who moves whom.
export function compileReposition(item) {
    const plan = compileSkillAction(item);
    if (!plan) return null;
    const outcomes = plan.resolution.outcomes;
    const move = (feet) => `Move {target} up to ${feet} feet, staying within {source}'s reach and not into or through obstacles (by hand).`;
    outcomes.criticalSuccess.manualInstructions = [move(10)];
    outcomes.success.manualInstructions = [move(5)];
    outcomes.criticalFailure.manualInstructions = ["{target} may move {source} up to 5 feet, as though it had Repositioned {source} (by hand)."];
    return plan;
}

// Create a Diversion: one Deception check against each watcher's Perception DC.
// On a success the actor is hidden to it, so its next Strike against that
// creature this turn finds it off-guard. The +4 to later attempts is played as one try per creature.
export function compileDiversion(item) {
    const none = () => ({ damage: { mode: "none", multiplier: 0, sourceComponentIds: [] }, effects: [] });
    const diverted = () => ({ ...none(), effects: [{ kind: "condition", slug: "off-guard", value: null, duration: thisTurnEnd, scope: { against: "actor", attacks: "any", uses: 1 } }] });
    return {
        modelVersion: 13,
        source: { name: item?.name ?? "Create a Diversion", slug: "create-a-diversion", uuid: item?.uuid ?? null, type: item?.type ?? "action" },
        rank: 1,
        traits: [...(item?.system?.traits?.value ?? ["mental"])],
        activation: { time: "1", traits: [...(item?.system?.traits?.value ?? ["mental"])] },
        // The watchers it tries to divert: the creature's foes around it.
        targeting: { target: "up to 6 creatures whose attention you divert", range: "30 feet", area: null },
        trigger: { event: "use", immunity: { scope: "target", raw: "creatures you attempt to divert gain a +4 circumstance bonus to their Perception DCs against your attempts to Create a Diversion for 1 minute" } },
        resolution: {
            kind: "check",
            check: { roll: "skill", statistic: "deception", against: { dc: "target", statistic: "perception" } },
            sharedDamage: null,
            outcomes: { criticalSuccess: diverted(), success: diverted(), failure: none(), criticalFailure: none() }
        },
        automation: { level: "automatic" }
    };
}

// Administer First Aid, to stabilize: Medicine against 5 + the dying
// creature's recovery DC (15 + its dying value). Success: it loses dying but
// stays unconscious; critical failure: dying +1. (Stopping bleeding comes later.)
export function compileFirstAid(item) {
    const none = () => ({ damage: { mode: "none", multiplier: 0, sourceComponentIds: [] }, effects: [] });
    const stable = () => ({ ...none(), effects: [{ kind: "end-condition", slugs: ["dying"], stabilize: true }] });
    return {
        modelVersion: 13,
        source: { name: item?.name ?? "Administer First Aid", slug: "administer-first-aid", uuid: item?.uuid ?? null, type: item?.type ?? "action" },
        rank: 1,
        traits: ["manipulate"],
        activation: { time: "2", traits: ["manipulate"] },
        targeting: { target: "1 adjacent dying creature", range: "touch", area: null, dying: true },
        trigger: { event: "use", requirements: "a healer's toolkit" },
        resolution: {
            kind: "check",
            check: { roll: "skill", statistic: "medicine", against: { dc: "target", statistic: "stabilize" } },
            sharedDamage: null,
            outcomes: { criticalSuccess: stable(), success: stable(), failure: none(), criticalFailure: { ...none(), effects: [{ kind: "condition", slug: "dying", value: 1, duration: null }] } }
        },
        automation: { level: "automatic" }
    };
}
