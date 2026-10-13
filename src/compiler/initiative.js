// The skills an ability says its creature rolls for its own initiative (2026-10-13, batch 302; the user's call: "use different initiative
// skills such as deception if they have a passive mentioning it and the skill is higher than their normal perception initiative"):
// "if the gang leader rolls Deception or Stealth for initiative", "can roll Intimidation for initiative", "rolls initiative using Deception
// or Performance", "Survival in place of Perception to roll initiative", "Warfare Lore for initiative" → ["deception", "stealth"],
// ["warfare-lore"] …. Not Perception (the usual roll), and not other creatures' rolls ("all enemies rolling Stealth for initiative").
// For the simulator, which rolls the best of them when it beats Perception.

import { htmlToPlainText } from "../../../pf2e-resolution-core/src/text/plain-text.js";

const SKILLS = ["Perception", "Acrobatics", "Arcana", "Athletics", "Crafting", "Deception", "Diplomacy", "Intimidation", "Medicine", "Nature", "Occultism", "Performance", "Religion", "Society", "Stealth", "Survival", "Thievery"];
// (A Lore by its name: "Warfare Lore", "Dimension of Time Lore".)
const SKILL = `(?:${SKILLS.join("|")}|[A-Z][a-z]+(?: (?:of|the|[A-Z][a-z]+))* Lore)`;
const LIST = `${SKILL}(?:(?:,\\s*|,?\\s+or\\s+)${SKILL})*`;
const MENTIONS = [
    new RegExp(`\\b(${LIST})(?: checks?)? (?:for|to (?:roll|determine)) (?:its |their |his |her |your )?[Ii]nitiative\\b`, "g"),
    new RegExp(`\\b(${LIST}) when (?:rolling|determining) (?:its |their |his |her |your )?[Ii]nitiative\\b`, "g"),
    new RegExp(`\\b(${LIST}) in place of (?:Perception|other skills) (?:to roll|when determining|for) (?:its |their |his |her |your )?[Ii]nitiative\\b`, "gi"),
    new RegExp(`\\b[Ii]nitiative (?:using|with) (${LIST})\\b`, "g")
];
const slugOf = (name) => name.toLowerCase().replace(/\s+/g, "-");

export function initiativeSkills(item) {
    const text = htmlToPlainText(String(item?.system?.description?.value ?? "").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ");
    const found = new Set();
    for (const pattern of MENTIONS) {
        for (const match of text.matchAll(pattern)) {
            // (Another creature's roll: "all enemies rolling Stealth for initiative".)
            if (/\b(?:enem(?:y|ies)|creatures?|allies|ally|foes?) (?:roll(?:ing|s)?|using) $/i.test(text.slice(Math.max(0, match.index - 40), match.index))) continue;
            for (const name of match[1].split(/,?\s+or\s+|,\s*/)) if (name && !/^Perception$/i.test(name)) found.add(slugOf(name.trim()));
        }
    }
    return [...found];
}
