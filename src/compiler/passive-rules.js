// Passives PF2e's own rules hold, read for the simulator (2026-10-13, batch 301; the user's call: "the crash, traps and then passives").
// Evasion and its kin (AdjustDegreeOfSuccess on a save), All-Around Vision and Deny Advantage (PF2e's flanking overrides), Surprise
// Attack and Dread Striker (PF2e's off-guard EphemeralEffect), Construct Armor (its toggle and AC penalty); and from their words,
// Bravery's lower frightened, Mobility and Extra Reaction. Live, PF2e plays the rules itself; the plan is the simulator's.
//   → { builtin: "passive-rules", saveDegrees?, flanking?, offGuardTo?, constructArmor?, lessFrightened?, mobility?, reactions?, notes? }
// null when it holds a rule read nowhere here (its damage dice, a GM's toggle), so no ability is taken as played that isn't.

import { htmlToPlainText } from "../../../pf2e-resolution-core/src/text/plain-text.js";

const OFF_GUARD = "Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg";
const SAVES = { fortitude: ["fortitude"], reflex: ["reflex"], will: ["will"], "saving-throw": ["fortitude", "reflex", "will"] };
const DEGREES = new Set(["criticalFailure", "failure", "success", "criticalSuccess", "all"]);
const STEPS = new Set(["one-degree-better", "one-degree-worse", "two-degrees-better", "two-degrees-worse", "to-critical-failure", "to-failure", "to-success", "to-critical-success"]);
const NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };

// A predicate the simulation can test against a spell or ability's roll options: its traits ("fear", "item:trait:light"), its slug, magical.
// (Not an origin's traits, what it inflicts, a toggle: never true there, so not read.)
function testable(term) {
    if (typeof term === "string") return /^[a-z]+$/.test(term) || /^item:(?:trait|slug):[a-z-]+$/.test(term) || term === "item:magical";
    if (Array.isArray(term)) return term.every(testable);
    if (term?.or) return term.or.some(testable);
    if (term?.and) return term.and.every(testable);
    if (term?.not !== undefined) return testable(term.not);
    return false;
}

function saveDegree(rule) {
    if (rule?.key !== "AdjustDegreeOfSuccess" || !SAVES[rule.selector] || (rule.type && rule.type !== "save")) return null;
    const adjustment = Object.fromEntries(Object.entries(rule.adjustment ?? {}).filter(([degree, step]) => DEGREES.has(degree) && STEPS.has(step)));
    if (!Object.keys(adjustment).length || (rule.predicate?.length && !testable(rule.predicate))) return null;
    return { saves: SAVES[rule.selector], adjustment, ...(rule.predicate?.length ? { predicate: rule.predicate } : {}) };
}

// "Off-guard to it" (EphemeralEffect): when, in what the simulation can see — the first round before the target acts, the
// initiative it rolled with, the target's conditions (any of them), the traits it lacks.
const STAT = /^self:participant:initiative:stat:(\w+)$/;
const CONDITION = /^target:condition:([\w-]+(?::[\w-]+)?)$/;
function offGuardWhen(predicate) {
    const when = {};
    for (const term of predicate ?? []) {
        if (term === "encounter:round:1") when.round = 1;
        else if (term?.lt?.[0] === "self:participant:initiative:rank" && term.lt[1] === "target:participant:initiative:rank") when.notActed = true;
        else if (typeof term === "string" && STAT.test(term)) when.initiative = [STAT.exec(term)[1]];
        else if (term?.or?.every((entry) => STAT.test(entry))) when.initiative = term.or.map((entry) => STAT.exec(entry)[1]);
        else if (typeof term === "string" && CONDITION.test(term)) (when.conditions ??= []).push([CONDITION.exec(term)[1]]);
        else if (term?.or?.every((entry) => CONDITION.test(entry))) (when.conditions ??= []).push(term.or.map((entry) => CONDITION.exec(entry)[1]));
        else if (typeof term?.not === "string" && /^target:trait:[a-z-]+$/.test(term.not)) (when.notTraits ??= []).push(term.not.split(":").pop());
        else return null;
    }
    // (Its first round only with a creature that hasn't acted; a condition alone, any time.)
    if (when.round && !when.notActed) return null;
    return Object.keys(when).length ? when : null;
}

function offGuard(rule) {
    if (rule?.key !== "EphemeralEffect" || rule.uuid !== OFF_GUARD) return null;
    const selectors = rule.selectors ?? [];
    const strikes = selectors.includes("strike-attack-roll") ? "all" : selectors.includes("melee-strike-attack-roll") ? "melee" : selectors.includes("ranged-strike-attack-roll") ? "ranged" : null;
    const when = offGuardWhen(rule.predicate);
    if (!strikes || !when) return null;
    return { when, strikes, ...(selectors.includes("spell-attack-roll") ? { spells: true } : {}) };
}

// Construct Armor: "Once it's reduced to less than half its Hit Points, or immediately upon being damaged by a critical hit, its construct
// armor breaks and its Armor Class is reduced" — PF2e's toggle for the critical hit and its AC penalty below a share of its Hit Points.
function brokenWhen(predicate) {
    const any = predicate?.length === 1 ? predicate[0]?.or : null;
    const below = any?.find((term) => term?.lt?.[0] === "hp-percent")?.lt?.[1];
    return any?.includes("construct-armor") && Number.isFinite(Number(below)) ? Number(below) : null;
}

// Its Hardness only while the armor holds: [{ nor: ["construct-armor", { lt: ["hp-percent", 50] }] }], or not toggled and at 50% or more.
function intactWhen(predicate) {
    const none = predicate?.length === 1 ? predicate[0]?.nor : null;
    if (none?.includes("construct-armor")) return Number(none.find((term) => term?.lt?.[0] === "hp-percent" || term?.lte?.[0] === "hp-percent") ? 50 : NaN);
    if (predicate?.length === 2 && predicate[0]?.not === "construct-armor" && predicate[1]?.gte?.[0] === "hp-percent") return Number(predicate[1].gte[1]);
    return null;
}

export function passiveRules(item, actor = null) {
    if (item?.system?.actionType?.value !== "passive") return null;
    const rules = item.system?.rules ?? [];
    const plan = {};
    for (const rule of rules) {
        const degree = saveDegree(rule);
        if (degree) {
            (plan.saveDegrees ??= []).push(degree);
            continue;
        }
        const guard = offGuard(rule);
        if (guard) {
            (plan.offGuardTo ??= []).push(guard);
            continue;
        }
        if (rule?.key === "ActiveEffectLike" && rule.mode === "override" && !rule.predicate?.length && rule.path === "system.attributes.flanking.flankable" && rule.value === false) {
            plan.flanking = { ...plan.flanking, flankable: false };
            continue;
        }
        if (rule?.key === "ActiveEffectLike" && rule.mode === "override" && !rule.predicate?.length && rule.path === "system.attributes.flanking.offGuardable") {
            const value = rule.value === "@actor.level" ? "level" : Number(rule.value);
            if (value !== "level" && !Number.isFinite(value)) return null;
            plan.flanking = { ...plan.flanking, offGuardable: value };
            continue;
        }
        if (rule?.key === "FlatModifier" && [].concat(rule.selector).join() === "ac" && brokenWhen(rule.predicate) !== null && Number(rule.value) < 0) {
            plan.constructArmor = { ...plan.constructArmor, ac: Number(rule.value), below: brokenWhen(rule.predicate) };
            continue;
        }
        if (rule?.key === "ActiveEffectLike" && rule.path === "system.attributes.hardness.value" && brokenWhen(rule.predicate) !== null) {
            plan.constructArmor = { ...plan.constructArmor, losesHardness: true };
            continue;
        }
        // (The kimchi jar's: Hardness 2 while it holds.)
        if (rule?.key === "ActiveEffectLike" && rule.path === "system.attributes.hardness.value" && Number.isFinite(intactWhen(rule.predicate)) && Number(rule.value) > 0) {
            plan.constructArmor = { ...plan.constructArmor, hardness: Number(rule.value), losesHardness: true };
            continue;
        }
        // (A broken armor's faster Speed: the fight's bands have no use for it.)
        if (rule?.key === "FlatModifier" && /speed$/.test([].concat(rule.selector).join()) && brokenWhen(rule.predicate) !== null) continue;
        // (Its notes for PF2e's chat, the toggles these read, and its immunities, resistances and weaknesses, which the creature's own
        // numbers carry: nothing more to play.)
        if (["Note", "RollOption", "Immunity", "Resistance", "Weakness"].includes(rule?.key)) continue;
        return null;
    }
    if (plan.constructArmor && !plan.constructArmor.ac) return null;
    if (plan.constructArmor) {
        const hardness = Number(actor?.system?.attributes?.hardness?.value) || Number(/\bHardness (\d+)\b/.exec(item.name ?? "")?.[1]) || null;
        plan.constructArmor = { hardness, losesHardness: false, ...plan.constructArmor };
    }
    const html = String(item.system?.description?.value ?? "");
    const text = htmlToPlainText(html.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    // (Bravery: "any time they gain the Frightened condition, reduce its value by 1".)
    const lower = /\bgains? the Frightened condition, (?:(?:they|it|he|she) )?reduces? its value by (\d+)/i.exec(text);
    if (lower) plan.lessFrightened = Number(lower[1]);
    if (!Object.keys(plan).length && !rules.some((rule) => rule?.key !== "Note")) {
        // Mobility: "When the burglar Strides half their speed or less, that movement does not trigger reactions." — a Climb, Fly or Swim
        // too when it says so.
        if (/\bStrides?\b[^.]*\bhalf (?:its|their|his|her|your) [sS]peed or less\b[^.]*\b(?:does not|doesn't|do not|don't) trigger reactions\b|\b(?:does not|doesn't) trigger reactions(?: from movement)? when (?:it|they|he|she|you) Strides?(?: to move)? half (?:its|their|his|her|your) [sS]peed or less\b/i.test(text)) {
            plan.mobility = { moves: ["stride", ...["climb", "fly", "swim"].filter((move) => new RegExp(`\\b${move === "fly" ? "Fl(?:y|ying|ies)" : move[0].toUpperCase() + move.slice(1) + "(?:s|ing)?"}\\b`).test(text))] };
        }
        // Extra Reaction: "The dragon gains 2 reactions at the start of its turn each round." — that many a round; "an additional reaction
        // each turn, but can use this extra reaction only for Divert Strike", "2 extra reactions each round that it can use only to make
        // Reactive Strikes" — more, for that only. (Not one whose limit isn't read: a head each, nine heads.)
        const count = /\b(?:gains?|gets?) (\w+) reactions at the start of (?:(?:its|their|his|her) turn|each of (?:its|their|his|her) turns)\b/i.exec(text);
        const extra = /\b(?:gains?|has|gives (?:him|her|it|them)) (an?|one|two|three|\d) (?:additional|extra) reactions? (?:each|per) (?:turn|round)\b|\bturns, [\w' -]+? gains? an (?:additional|extra) reaction\b|\bhas an (?:additional|extra) reaction (?:they|it|he|she) can use only\b/i.exec(text);
        const only = /\bonly (?:use (?:it |this reaction )?)?(?:for|to) (?:make )?([A-Z][\w' -]*?)(?=\.|,|\s+with\b|$)/.exec(text);
        const limited = /\bonly\b|\bfor each of\b|\bdifferent head\b|\bloses one of\b/i.test(text);
        const total = count ? NUMBERS[count[1].toLowerCase()] ?? Number(count[1]) : 0;
        const more = extra ? (NUMBERS[String(extra[1] ?? "a").toLowerCase()] ?? (Number(extra[1]) || 1)) : 0;
        if (total > 1 && !limited) plan.reactions = { perRound: total };
        else if (more && !/\bfor each of\b|\bdifferent head\b|\bloses one of\b/i.test(text) && (!limited || only)) plan.reactions = only ? { extra: more, only: only[1].trim() } : { perRound: 1 + more };
        // All-Around Vision by PF2e's glossary alone: can't be flanked.
        if (/@Localize\[PF2E\.NPC\.Abilities\.Glossary\.AllAroundVision\]/.test(html)) plan.flanking = { flankable: false };
        // Surprise Attack in words alone: "On the first round of combat, if it rolls Deception or Stealth for initiative, creatures that
        // haven't acted yet are Off-Guard to it."
        const surprise = /^(?:On|In) the first round of combat, (?:if (?:the )?[\w' -]+? roll(?:s|ed) (Deception|Stealth|Performance)(?: or (Deception|Stealth|Performance))? for initiative, )?(?:any )?creatures (?:that|who) haven't (?:yet )?acted(?: yet)? are Off-Guard to\b/i.exec(text);
        if (surprise) plan.offGuardTo = [{ when: { round: 1, notActed: true, ...(surprise[1] ? { initiative: [surprise[1], surprise[2]].filter(Boolean).map((stat) => stat.toLowerCase()) } : {}) }, strikes: "all", spells: true }];
    }
    if (!Object.keys(plan).length) return null;
    return { builtin: "passive-rules", ...plan };
}
