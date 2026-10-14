// A requirement the simulator can check (2026-10-13, batch 303; the user's call: "work through your recommendations in order", item 1:
// requirements the simulator could check but didn't): the Requirements sentence read into needs — every one must hold.
//   { corpse: { traits? } }      a creature died in the fight ("adjacent to the corpse of a creature that died within the last hour")
//   { grabbing: { trait? } }     it holds a creature Grabbed or Restrained (Suck Blood, Envelop, Shred Soul's incorporeal one)
//   { swallowing: true|false }   a creature is (isn't) in its stomach or engulfed
//   { hpAtLeast: N }, { hpBelow: N }, { hpBelowHalf: true }, { regeneration: true }, { notFatigued: true }, { self: ["prone"] }, { shieldRaised: true }
//   { enemyAdjacent: true }, { allyAdjacent: true }, { freeHand: true }, { allyTrait: { trait, within } }
//   { afterCast: { nonCantrip } }, { afterStrike: { on, melee? } } — its last action
//   { foe: { conditions?, persistent?, within } } — a foe nearby in that state (a dying one beside it, one bleeding in its aura)
//   { target: { conditions, within } } — the creature it acts on is in that state (adjacent to a Prone creature)
//   { any: [needs …] } — one of them
// null when any part isn't one of these (a creature that doesn't know it's an enemy, a body it inhabits, its segments).

import { htmlToPlainText } from "../../../pf2e-resolution-core/src/text/plain-text.js";

const SUBJECT = String.raw`(?:(?:The|An?) [\w'’ -]+?|It|They|He|She|[A-Z][\w'’-]+(?: [A-Z][\w'’-]+)?)`;
const CONDITION_WORDS = { prone: "prone", paralyzed: "paralyzed", restrained: "restrained", unconscious: "unconscious", grabbed: "grabbed", dying: "dying", frightened: "frightened" };

// One clause → a need, or null.
function readClause(clause) {
    const trimmed = clause.trim().replace(/\.$/, "");
    if (!trimmed) return null;
    // ("…, or it has a creature Engulfed": a clause as its own sentence.)
    const c = trimmed[0].toUpperCase() + trimmed.slice(1);
    let m;
    if ((m = new RegExp(String.raw`^${SUBJECT} is adjacent to the corpse of (?:an? )?(?:(\w+)(?: or (\w+))? )?creature that died within the (?:last|past) (?:hour|1 hour|minute|1 minute)$`, "i").exec(c))) {
        const traits = [m[1], m[2]].filter((word) => word && !/^(?:a|an|the|any)$/i.test(word)).map((word) => word.toLowerCase());
        return { corpse: traits.length ? { traits } : {} };
    }
    if ((m = new RegExp(String.raw`^${SUBJECT} (?:has|begins (?:its|their|his|her) turn with) (?:a|an|one|at least one) (?:(\w+) )?(?:creature|target)(?: (?:of )?(?:its|their|his|her) size or smaller)? (?:Grabbed|grabbed)(?: or Restrained)?$`).exec(c)))
        return { grabbing: m[1] && !/^(?:a|an)$/i.test(m[1]) ? { trait: m[1].toLowerCase() } : {} };
    if (/^A creature is Grabbed or Restrained by [\w'’ -]+$/.test(c)) return { grabbing: {} };
    if (/^An? deceased creature that died in the (?:last|past) hour$/i.test(c)) return { corpse: {} };
    // (Rampant Growth: "A creature the tendriculos has Swallowed Whole has taken damage since the end of the tendriculos's last turn".)
    if (/^A creature [\w'’ -]+? has Swallowed Whole has taken damage since the end of [\w'’ -]+ last turn$/.test(c)) return { swallowing: true };
    if (new RegExp(String.raw`^${SUBJECT} (?:hasn't|has not) used any other actions this turn$`).test(c)) return { firstAction: true };
    if (new RegExp(String.raw`^A creature is swallowed by [\w' -]+$|^${SUBJECT} has a creature (?:Engulfed|Swallowed(?: Whole)?)$`).test(c)) return { swallowing: true };
    if (new RegExp(String.raw`^${SUBJECT} (?:doesn't|does not) have a creature (?:engulfed|swallowed)$`, "i").test(c)) return { swallowing: false };
    if ((m = new RegExp(String.raw`^${SUBJECT} has at least (\d+) Hit Points$`).exec(c))) return { hpAtLeast: Number(m[1]) };
    if ((m = new RegExp(String.raw`^${SUBJECT} has fewer than (\d+) Hit Points$`).exec(c))) return { hpBelow: Number(m[1]) };
    if (new RegExp(String.raw`^${SUBJECT}['’]s? regeneration is (?:not currently deactivated|currently active)$`).test(c)) return { regeneration: true };
    if (new RegExp(String.raw`^${SUBJECT} (?:isn't|is not|aren't|are not) [Ff]atigued(?: or (?:[Ee]xhausted|raging))?$`).test(c)) return { notFatigued: true };
    // (Batch 309: hit-point thresholds in other words — "has 30 Hit Points or fewer", "has 40 or more Hit Points", "falls below half
    // its total Hit Points", "is at less than its maximum Hit Points".)
    if ((m = new RegExp(String.raw`^${SUBJECT} has (?:been reduced to )?(\d+) (?:Hit Points or fewer|or fewer Hit Points(?: remaining)?)$`).exec(c))) return { hpBelow: Number(m[1]) + 1 };
    if ((m = new RegExp(String.raw`^${SUBJECT} has (\d+) (?:Hit Points or more|or more Hit Points(?: remaining)?)$`).exec(c))) return { hpAtLeast: Number(m[1]) };
    if (new RegExp(String.raw`^${SUBJECT} (?:is|falls|has fallen) below half (?:its|their|his|her) (?:total |maximum )?Hit Points$`).test(c)) return { hpBelowHalf: true };
    if (new RegExp(String.raw`^${SUBJECT} (?:is at|has) less than (?:its|their|his|her) maximum Hit Points$`).test(c)) return { hurt: true };
    if ((m = new RegExp(String.raw`^${SUBJECT} is (Prone|Off-Guard)$`).exec(c))) return { self: [m[1].toLowerCase() === "off-guard" ? "offGuard" : "prone"] };
    if (new RegExp(String.raw`^${SUBJECT} has (?:its|their|his|her) shield raised$`).test(c)) return { shieldRaised: true };
    if (new RegExp(String.raw`^${SUBJECT} is adjacent to (?:a|at least one) (?:foe|enemy)$`).test(c)) return { enemyAdjacent: true };
    if (new RegExp(String.raw`^${SUBJECT} is adjacent to a willing ally$`).test(c)) return { allyAdjacent: true };
    if (new RegExp(String.raw`^${SUBJECT} has a hand free$`).test(c)) return { freeHand: true };
    if ((m = /^An? ([a-z]+) is within (\d+) feet of [\w' -]+$/.exec(c))) return { allyTrait: { trait: m[1].toLowerCase(), within: Number(m[2]) } };
    if (new RegExp(String.raw`^${SUBJECT}['’]s? (?:last|most recent|previous) action was to cast a non-cantrip spell$`).test(c)) return { afterCast: { nonCantrip: true } };
    if (new RegExp(String.raw`^${SUBJECT}['’]s? (?:last|previous) action was a (?:successful Strike(?: against the target)?|Strike that hit)$`).test(c)) return { afterStrike: { on: ["success", "criticalSuccess"] } };
    // Its last action a successful Strike with a named weapon, a critical one, or a hit on something bigger than itself; with the target's
    // size where the text bounds it (a largest or smallest size): that Strike, and that size.
    if ((m = new RegExp(String.raw`^${SUBJECT}['’]s? (?:last|previous) action was (?:a (successful|critical success on an?) ([\w' -]+?) Strike|to hit (?:a target|an? creature) (larger than (?:itself|themselves|himself|herself)) with (?:its|their|his|her) ([\w' -]+?))(?: against (?:a |an )?(?:(target larger than (?:itself|themselves|himself|herself))|creature of size (\w+) or (smaller|larger)|(\w+) or (smaller|larger) creature))?$`).exec(c))) {
        const size = m[3] || m[5] ? { larger: true } : m[6] ? { [m[7] === "smaller" ? "max" : "min"]: m[6].toLowerCase() } : m[8] ? { [m[9] === "smaller" ? "max" : "min"]: m[8].toLowerCase() } : null;
        return { afterStrike: { strike: (m[2] ?? m[4]).toLowerCase(), on: /critical/.test(m[1] ?? "") ? ["criticalSuccess"] : ["success", "criticalSuccess"], ...(size ? { size } : {}) } };
    }
    if (new RegExp(String.raw`^${SUBJECT} has one or more creatures Grabbed$`).test(c)) return { grabbing: {} };
    // (Batch 309: more of the same in other words — "has a Medium or smaller creature Grabbed", "has a creature Grabbed with its talons", "A
    // creature is Grabbed in the tyrannosaurus's jaws"; "damaged a creature with a jaws Strike on its last action", "hit a living creature
    // with a shadow hand Strike on its previous action", "hit with a jaws Strike on its most recent action this turn"; "has taken damage";
    // "is not Fatigued or already in a frenzy".)
    if (new RegExp(String.raw`^${SUBJECT} has an? (?:(?:Tiny|Small|Medium|Large|Huge) or smaller )?creature (?:Grabbed|grabbed)(?: (?:with|in) (?:its|their|his|her|one or both(?: of (?:its|their|his|her))?) [\w' -]+)?$`).test(c)) return { grabbing: {} };
    if (new RegExp(String.raw`^${SUBJECT} has Grabbed (?:a|an|one or more) creatures?$`).test(c)) return { grabbing: {} };
    // (A named Strike as its last action, hit or not: "the previous action was a tendril Strike against the target".)
    if ((m = new RegExp(String.raw`^${SUBJECT}['’]s? (?:last|previous|most recent) action was (?:a|an) (successful )?([\w' -]+?) Strike against (?:the target(?: creature)?|an? (?:creature|target))$`).exec(c)))
        return { afterStrike: { strike: m[2].toLowerCase(), on: m[1] ? ["success", "criticalSuccess"] : ["criticalFailure", "failure", "success", "criticalSuccess"] } };
    if (/^A creature is (?:Grabbed|grabbed) (?:in|by) [\w'’ -]+$/.test(c)) return { grabbing: {} };
    if ((m = new RegExp(String.raw`^${SUBJECT} (?:damaged|hit) (?:a|an) (?:living )?(?:creature|target) with (?:a|an|its|their) ([\w' -]+?) Strike (?:on|with) (?:its|their|his|her) (?:last|previous|most recent) action(?: this turn)?$`).exec(c)))
        return { afterStrike: { strike: m[1].toLowerCase(), on: ["success", "criticalSuccess"] } };
    if ((m = new RegExp(String.raw`^${SUBJECT} hit with (?:a|an|its|their) ([\w' -]+?) Strike on (?:its|their|his|her) (?:last|previous|most recent) action(?: this turn)?$`).exec(c)))
        return { afterStrike: { strike: m[1].toLowerCase(), on: ["success", "criticalSuccess"] } };
    if (new RegExp(String.raw`^${SUBJECT} has taken damage$`).test(c)) return { hurt: true };
    if (new RegExp(String.raw`^${SUBJECT} (?:is|isn't|is not) (?:neither |not )?Fatigued (?:or|nor) (?:already )?in a frenzy$`).test(c)) return { notFatigued: true };
    if (new RegExp(String.raw`^${SUBJECT} (?:hasn't|has not) acted yet this turn$`).test(c)) return { firstAction: true };
    if (new RegExp(String.raw`^${SUBJECT} (?:doesn't|does not) contain a creature inside (?:it|them|him|her)$`).test(c)) return { swallowing: false };
    if (new RegExp(String.raw`^${SUBJECT} is not at full Hit Points$|^${SUBJECT} isn't at full Hit Points$`).test(c)) return { hurt: true };
    if (new RegExp(String.raw`^${SUBJECT} hit with a melee Strike with (?:its|their|his|her) last action$`).test(c)) return { afterStrike: { on: ["success", "criticalSuccess"], melee: true } };
    if (new RegExp(String.raw`^${SUBJECT}['’]s? last action was a critical success$`).test(c)) return { afterStrike: { on: ["criticalSuccess"] } };
    if ((m = /^A creature within [\w' -]+? aura is taking persistent (\w+) damage$/.exec(c))) return { foe: { persistent: m[1].toLowerCase(), within: 30 } };
    if (new RegExp(String.raw`^${SUBJECT} is adjacent to a [Dd]ying creature$`).test(c)) return { foe: { conditions: ["dying"], within: 5 } };
    if ((m = new RegExp(String.raw`^${SUBJECT} is adjacent to an? (Prone|Paralyzed|Restrained|Unconscious|Grabbed)((?:,? (?:or )?(?:Prone|Paralyzed|Restrained|Unconscious|Grabbed|willing))*),? (?:or )?(?:willing )?(?:living )?(?:creature|humanoid)$`).exec(c))) {
        const conditions = [m[1], ...(m[2].match(/Prone|Paralyzed|Restrained|Unconscious|Grabbed/g) ?? [])].map((word) => CONDITION_WORDS[word.toLowerCase()]);
        return { target: { conditions: [...new Set(conditions)], within: 5 } };
    }
    if ((m = /^An? (Grabbed|Paralyzed|Restrained|Unconscious)((?:,? (?:or )?(?:Grabbed|Paralyzed|Restrained|Unconscious|willing))*) creature is within [\w' -]+? reach$/.exec(c))) {
        const conditions = [m[1], ...(m[2].match(/Grabbed|Paralyzed|Restrained|Unconscious/g) ?? [])].map((word) => CONDITION_WORDS[word.toLowerCase()]);
        return { target: { conditions: [...new Set(conditions)], within: 10 } };
    }
    return null;
}

// The Requirements sentence → [needs] (each holds), or null.
// The Requirements sentence's words, or null.
export function requirementText(item) {
    const text = htmlToPlainText(String(item?.system?.description?.value ?? "").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ");
    // (One with no "Effect" after it runs on into the effect: its first sentence.)
    return /\bRequirements?\s+(.+?)(?=\s+(?:Trigger|Effects?|Frequency|Cost)\b|$)/.exec(text)?.[1]?.trim().split(/(?<=[a-z\d])\.\s+(?=[A-Z])/)[0].replace(/[;.]$/, "") ?? null;
}

export function readNeeds(item) {
    const text = htmlToPlainText(String(item?.system?.description?.value ?? "").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ");
    const full = /\bRequirements?\s+(.+?)(?=\s+(?:Trigger|Effects?|Frequency|Cost)\b|$)/.exec(text)?.[1]?.trim().replace(/[;.]$/, "");
    if (!full) return null;
    // (One with no "Effect" after it runs on into the effect: "… regeneration is currently active The ravenile regains 20 HP." — its first
    // sentence.)
    return needsOf(full) ?? needsOf(full.split(/\s(?=The [a-z])/).slice(0, 1).join("").trim());
}

function needsOf(said) {
    // "… adjacent to at least one enemy, and the kobold has fewer than 12 Hit Points": both. "… or it has a creature Engulfed": either.
    // (Not inside a list of conditions: "a Paralyzed, Restrained, or Unconscious creature".)
    const NEXT = String.raw`(?=(?:[Tt]he |[Aa]n? |[Ii]t |[Tt]hey |[Hh]e |[Ss]he )|[A-Z][\w'’-]+(?: [A-Z][\w'’-]+)? (?:is|has|hit|hasn't|isn't)\b)`;
    const all = said.split(new RegExp(String.raw`,? and ${NEXT}`));
    const needs = [];
    for (const part of all) {
        const either = part.split(new RegExp(String.raw`,? or ${NEXT}`));
        const read = either.map(readClause);
        if (read.some((need) => !need)) return null;
        needs.push(read.length > 1 ? { any: read } : read[0]);
    }
    return needs.length ? needs : null;
}
