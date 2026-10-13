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
const NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

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
        // (Batch 306, Gang Up: a foe within reach of it and one of its allies is off-guard to it, as if flanked.)
        if (rule?.key === "ActiveEffectLike" && !rule.predicate?.length && rule.path === "system.attributes.flanking.canGangUp" && rule.value === true) {
            plan.flanking = { ...plan.flanking, gangUp: true };
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
        const reactions = readReactions(text, actor);
        if (reactions) plan.reactions = reactions;
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

// How many heads (tentacles, limbs) its stat block gives it: "A hellfire hydra has five heads", "the orochi's eight heads", "begins combat
// with two tentacles". null when no text numbers them.
function partsOf(actor, part) {
    for (const item of actor?.items ?? []) {
        const text = String(item.system?.description?.value ?? "").replace(/<[^>]+>/g, " ");
        const found = new RegExp(`\\b(?:has|ordinarily has|begins combat with|['’]s) (\\w+) ${part}s\\b`, "i").exec(text);
        const count = found ? NUMBERS[found[1].toLowerCase()] ?? Number(found[1]) : NaN;
        if (Number.isFinite(count) && count > 0) return count;
    }
    return null;
}

// Extra reactions in its words (2026-10-13, batch 301; batch 302, the user's call: "expand reactions and track monsters with multiple
// reactions"):
//   "The dragon gains 2 reactions at the start of its turn each round", "Tarrasque gains 3 reactions each round" → { perRound };
//   "an additional reaction each turn, but can use this extra reaction only for Divert Strike", "2 extra reactions … only to make Reactive
//   Strikes", "two additional reactions he can use only to perform a Shield Block", "only to make a Reactive Strike or to Shield Block",
//   "an extra reaction per round for each of its heads beyond the first, which it can use only to make Reactive Strikes" (its heads
//   counted from its stat block) → { extra, only }.
// "One reaction per trigger", "a different head for each reaction" are what a reaction is anyway. null when its limit isn't read (still-
// working limbs, a guardian's feats), or when the reactions only come with a state (a rage, a frenzy, a mythic point).
export function readReactions(text, actor = null) {
    const plain = String(text ?? "")
        .replace(/(?:,\s*(?:though|but|and)\s+|(?<=^|\.\s*))[^.,]*\b(?:one|1) (?:reaction|Reactive Strike|Attack of Opportunity)s? (?:per trigger|(?:on|for) the same triggering action)\b[^.,]*(?:,[^.]*)?\.?/gi, "")
        .replace(/[^.]*\b(?:a )?different head for each reaction\b[^.]*\.?/gi, "")
        .replace(/[^.]*\bloses? one of (?:its|their|his|her) heads\b[^.]*\.?/gi, "")
        .replace(/[^.]*\bon only (?:its|their|his|her) first turn each round\b[^.]*\.?/gi, "");
    const grant = /[^.]*\b(?:gains?|gets?|has|receives?|gives? (?:him|her|it|them))\b[^.]*\breactions?\b[^.]*/i.exec(plain)?.[0] ?? "";
    if (!grant || /\b(?:while|during|if|until|for the next|spend)\b/i.test(grant)) return null;
    const count = /\b(?:gains?|gets?|has) (\w+) reactions (?:at the start of (?:(?:its|their|his|her) turn|each of (?:its|their|his|her) turns)|(?:each|per|every) (?:round|turn))\b/i.exec(plain);
    const extra = /\b(?:gains?|gets?|has|receives?|gives? (?:him|her|it|them)) (an?|one|two|three|four|five|\d+) (?:additional|extra) reactions?\b/i.exec(plain);
    const perPart = /\b(?:gains?|has) an? (?:additional|extra) reaction (?:per|each) (?:round|turn) for each of (?:its|their|his|her) (?:(\w+) )?(head|tentacle|limb)s?\b(?:[^.,]*?(beyond the first))?|\bFor each (head|tentacle|limb) (?:it|he|she|they) ha(?:s|ve)\b[^.]*\bgains? an? (?:additional|extra) reaction/i.exec(plain);
    // (A champion's: "only for your champion's reaction", whichever it is.)
    const only = /\bonly (?:be used |use (?:it |this (?:extra |additional )?reaction |these reactions |them )?)?(?:for|to) (?:make |perform |attempt |use )?(?:an? |the )?([A-Z][\w' -]*?)(?=\.|,|\s+(?:with|against|when)\b|$)/.exec(plain)
        ?? (/\bonly for (?:your|its|their|his|her) champion['’]s reaction\b/i.test(plain) ? [null, "champion's reaction"] : null);
    if (/\bonly\b/i.test(plain) && !only) return null;
    const total = count ? NUMBERS[count[1].toLowerCase()] ?? Number(count[1]) : 0;
    let more = extra ? NUMBERS[extra[1].toLowerCase()] ?? Number(extra[1]) : 0;
    if (perPart) {
        const part = (perPart[2] ?? perPart[4]).toLowerCase();
        const parts = perPart[1] ? NUMBERS[perPart[1].toLowerCase()] ?? Number(perPart[1]) : partsOf(actor, part);
        if (!Number.isFinite(parts) || !parts) return null;
        more = perPart[3] ? parts - 1 : parts;
    }
    if (only && (more || total > 1)) return { extra: more || total - 1, only: only[1].replace(/\s+or\s+to\s+/g, " or ").trim() };
    if (total > 1) return { perRound: total };
    if (more > 0) return { perRound: 1 + more };
    return null;
}
