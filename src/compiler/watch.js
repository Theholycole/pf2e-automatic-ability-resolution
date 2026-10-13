// Triggers the module can watch, read for reactions that only had a reminder (2026-10-13, batch 300; the user's call: "work on item 2" — reactions
// on the reminder card whose trigger is an event the module already sees). A reaction or triggered free action whose plan plays but whose trigger
// wasn't read gets one here, and live play offers it when that happens instead of listing it each turn:
//   - its own Strike hitting ("The rhevanna hits a creature with a weapon Strike") → { event: "own-strike", on, strike?, weapon? };
//   - being hit ("A creature hits the guardian flock with an attack roll", "The amalgamite is hit by a Strike", a ranged one only) → "hit-by";
//   - an attack aimed at it from a distance ("A creature at least 10 feet away from the dragon targets them with an attack") → "targeted-by";
//   - a foe failing a save against its own spell or effect ("… fails a Will save against a spell or effect created by the neothelid") →
//     "foe-failed-save";
//   - rolling initiative ("The dragon rolls initiative") → "initiative";
//   - a creature dying near it ("A living creature within 30 feet of the ravener dies", "A creature adjacent to the lifeleecher dies") →
//     "nearby-death".
// Pure: (item, plan) → the plan with its trigger, or the plan as it was.

import { htmlToPlainText } from "../../../pf2e-resolution-core/src/text/plain-text.js";
import { REACTION_KINDS } from "../live/reactions.js";

const SELF = String.raw`(?:[Tt]he [\w' -]+?|[A-Z][\w'-]+(?: [A-Z][\w'-]+)?|it|them|him|her)`;
const SOMEONE = String.raw`(?:A|An|Any) (?:creature|enemy|foe|opponent)`;

// The trigger's words in an ability's text, or null.
export function triggerText(html) {
    const plain = htmlToPlainText(String(html ?? "").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    return /^(?:Frequency [^.]+?\.? )?(?:Requirements? .+?[;.]? )?Trigger (.+?)[;.]?(?: Requirements? .+?)? Effect\b/.exec(plain)?.[1]?.trim() ?? null;
}

// A trigger the module watches for these words, or null.
export function watchTrigger(text) {
    const words = String(text ?? "").trim().replace(/[.;]$/, "");
    let match = new RegExp(String.raw`^${SELF} hits (?:a|an) (?:creature|target|enemy|foe)(?:, object, or spell effect)? with (?:a|an) (?:(weapon|melee|unarmed) )?(?:([a-z][\w' -]*?) )?Strike$`).exec(words);
    if (match) return { event: "own-strike", reaction: true, on: ["success", "criticalSuccess"], ...(match[2] ? { strike: match[2].toLowerCase() } : {}), ...(["melee", "unarmed"].includes(match[1]) ? { weapon: match[1] } : {}) };
    if (new RegExp(String.raw`^${SOMEONE} hits ${SELF} with an attack roll$|^${SELF} is hit by (?:a Strike|an attack)$`).test(words)) return { event: "hit-by", reaction: true, melee: false };
    if (new RegExp(String.raw`^${SOMEONE} hits ${SELF} with a ranged Strike or a ranged spell attack roll$`).test(words)) return { event: "hit-by", reaction: true, melee: false, ranged: true };
    match = new RegExp(String.raw`^${SOMEONE} at least (\d+) feet away from ${SELF} targets ${SELF} with an attack$`).exec(words);
    if (match) return { event: "targeted-by", reaction: true, any: true, attack: true, from: Number(match[1]) };
    match = new RegExp(String.raw`^(?:A|An) creature fails an? (Will|Fortitude|Reflex) save against a spell or effect created by ${SELF}$`).exec(words);
    if (match) return { event: "foe-failed-save", reaction: true, save: match[1].toLowerCase() };
    match = new RegExp(String.raw`^(?:A|An) creature within (\d+) feet of ${SELF} fails a saving throw against one of (?:his|her|its|their) spells$`).exec(words);
    if (match) return { event: "foe-failed-save", reaction: true, spell: true, within: Number(match[1]) };
    if (new RegExp(String.raw`^${SELF} rolls initiative$`).test(words)) return { event: "initiative", reaction: true };
    match = new RegExp(String.raw`^(?:A|An) (living )?creature (?:within (\d+) feet(?: of ${SELF})?|adjacent to ${SELF}) (?:dies|is reduced to 0 Hit Points)$`).exec(words);
    if (match) return { event: "nearby-death", reaction: true, within: Number(match[2]) || 5, ...(match[1] ? { living: true } : {}), ...(/ dies$/.test(words) ? { dies: true } : {}) };
    return null;
}

// The plan with the trigger read for it: a reaction's or a triggered free action's that plays (not the GM's, not one with a trigger already, not
// one the reaction kinds play their own way).
export function withWatchedTrigger(item, plan) {
    const type = item?.system?.actionType?.value;
    if (!plan || !["reaction", "free"].includes(type) || plan.builtin === "no-effect" || REACTION_KINDS.has(plan.builtin) || (!plan.builtin && !plan.resolution)) return plan;
    if (plan.trigger && plan.trigger.event && plan.trigger.event !== "use") return plan;
    const trigger = watchTrigger(triggerText(item.system?.description?.value));
    if (!trigger) return plan;
    // (The note that its trigger was the GM's call goes: the module watches it now.)
    const notes = (plan.notes ?? []).filter((note) => !/^Its trigger, the GM's call: /.test(String(note)));
    return { ...plan, trigger: { ...trigger, ...(type === "free" ? { free: true } : {}) }, ...(plan.notes ? { notes } : {}) };
}
