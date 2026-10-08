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
