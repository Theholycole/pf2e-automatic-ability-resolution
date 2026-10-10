// Skill actions against a target's DC, compiled from PF2e's own text
// (the actions pack's Demoralize, Trip, Grapple, Shove, Feint, and monster
// abilities written the same way): "Attempt an [[/act trip]]{Athletics}
// check against the target's Reflex DC", then outcome sections.

import { htmlToPlainText } from "../../../pf2e-resolution-core/src/text/plain-text.js";
import { STAGE_CONDITIONS, degreeSections, inlineTags, noteUnread, readableText, readConditions, readDamage, readDuration, readImmunity, readPush, readTemplate } from "./inline.js";

const SKILLS = ["acrobatics", "arcana", "athletics", "crafting", "deception", "diplomacy", "intimidation", "medicine", "nature", "occultism", "performance", "religion", "society", "stealth", "survival", "thievery", "perception"];
const DEFENSES = { fortitude: "fortitude", reflex: "reflex", will: "will", perception: "perception", ac: "ac" };

// "{Athletics} check against the target's Reflex DC" → { statistic, against }.
export function readSkillCheck(html) {
    const plain = htmlToPlainText(String(html ?? "").replace(/\[\[\/act [^\]]*\]\]\{([^}]+)\}/g, "$1"));
    const match = /\b(Acrobatics|Arcana|Athletics|Crafting|Deception|Diplomacy|Intimidation|Medicine|Nature|Occultism|Performance|Religion|Society|Stealth|Survival|Thievery|Perception) check against (?:that |the |your |its )?(?:target's|creature's|its) (Fortitude|Reflex|Will|Perception) DC/i.exec(plain);
    if (match) {
        const statistic = match[1].toLowerCase();
        return SKILLS.includes(statistic) ? { roll: statistic === "perception" ? "perception" : "skill", statistic, against: { dc: "target", statistic: DEFENSES[match[2].toLowerCase()] } } : null;
    }
    // PF2e's inline check, as the PC feats write it: "@Check[diplomacy|against:will]", "@Check[thievery|defense:reflex]".
    for (const raw of inlineTags(html, "Check")) {
        const statistic = raw.split("|")[0].trim().toLowerCase();
        const defense = /\|(?:against|defense):(fortitude|reflex|will|perception)\b/i.exec(raw)?.[1]?.toLowerCase();
        if (defense && SKILLS.includes(statistic)) return { roll: statistic === "perception" ? "perception" : "skill", statistic, against: { dc: "target", statistic: DEFENSES[defense] } };
    }
    return null;
}

// "takes a –3 status penalty to Perception and Will saves for 1 minute" →
// [{ selector, value, type, duration }] (PF2e's FlatModifier terms).
const PENALTY_TARGETS = [
    [/^perception$/i, ["perception"]], [/^(?:ac|armor class)$/i, ["ac"]], [/^attack rolls?$/i, ["attack-roll"]],
    [/^(?:saves|saving throws)$/i, ["saving-throw"]], [/^fortitude(?: saves?)?$/i, ["fortitude"]], [/^reflex(?: saves?)?$/i, ["reflex"]],
    [/^will(?: saves?)?$/i, ["will"]], [/^skill checks$/i, ["skill-check"]], [/^damage rolls?$/i, ["damage"]], [/^checks$/i, ["check"]]
];
export function readPenalties(text) {
    const match = /\btakes? an? [–-](\d+) (status|circumstance|item)? ?penalty to ([^.]+?)(?=(?: for \d+ \w+| until\b|\.|$))/i.exec(htmlToPlainText(String(text ?? "")));
    if (!match) return [];
    // "Perception and Will saves" → the saves word belongs to the last of them.
    const names = match[3].replace(/,? and /g, ", ").split(/,\s*/).map((name) => name.trim()).filter(Boolean);
    const selectors = [];
    for (const name of names) {
        const entry = PENALTY_TARGETS.find(([pattern]) => pattern.test(name));
        if (!entry) return [];
        selectors.push(...entry[1]);
    }
    const duration = readDuration(htmlToPlainText(String(text ?? "")));
    return selectors.map((selector) => ({ selector, value: -Number(match[1]), type: match[2]?.toLowerCase() ?? "untyped", duration }));
}

// Off-guard only to the user ("Off-Guard against the aerialist's Strikes", "Off-Guard to Delaraius until …",
// "Off-Guard against Ruby's next melee Strike"): its scope, as Feint's; null when it's to everyone.
function offGuardScope(text) {
    const plain = htmlToPlainText(String(text ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1"));
    const against = /\boff-guard (?:against|to) (?:the |its |their |his |her )?[\w -]+?'s (next )?(melee )?(?:Strikes?|attacks?)\b/i.exec(plain);
    if (against) return { against: "actor", attacks: against[2] ? "melee" : "any", ...(against[1] ? { uses: 1 } : {}) };
    return /\boff-guard to (?!all\b|every\b|any\b)[A-Z][\w'-]*(?: [A-Z][\w'-]*)*\b(?=\s*(?:until|for|\.|,|$))/.test(plain) ? { against: "actor", attacks: "any" } : null;
}

function outcomeRow(html, { selfByDefault = false, names = [], plain = null } = {}) {
    const row = { damage: { mode: "none", multiplier: 0, sourceComponentIds: [] }, effects: [] };
    if (!html) return row;
    const formulas = inlineTags(html, "Damage").map((raw) => ({ formula: readDamage(raw) }));
    if (formulas.length) row.damage = { mode: "formulas", formulas, rollScope: "target" };
    let effects = plain ? readConditions(html, { plain }) : readConditions(html);
    if (selfByDefault) effects = effects.map((effect) => ({ ...effect, recipient: "self" }));
    const scope = offGuardScope(html);
    if (scope) effects = effects.map((effect) => (effect.slug === "off-guard" && !effect.scope ? { ...effect, scope } : effect));
    row.effects = effects;
    const push = readPush(html, names);
    if (push) row.forcedMovement = push;
    const modifiers = readPenalties(html);
    if (modifiers.length) row.modifiers = modifiers;
    return row;
}

// "As critical success, but the penalty is –2" (a row like another, with a new
// penalty) and "You take the same penalty an enemy would take had you
// succeeded" (the success's penalty on the actor).
function likeRows(outcomes, sections) {
    for (const [degree, like] of [["success", "criticalSuccess"], ["failure", "success"], ["criticalFailure", "failure"]]) {
        const text = sections[degree] ? htmlToPlainText(sections[degree]).trim() : "";
        const as = new RegExp(`^As (?:a )?${like === "criticalSuccess" ? "critical success" : like}\\b`, "i").test(text);
        if (!as) continue;
        const copy = structuredClone(outcomes[like]);
        const value = /\bthe penalty is [–-](\d+)/i.exec(text)?.[1];
        if (value) for (const modifier of copy.modifiers ?? []) modifier.value = -Number(value);
        const own = outcomes[degree];
        outcomes[degree] = { ...copy, effects: [...copy.effects.filter((effect) => !own.effects.some((other) => other.slug === effect.slug)), ...own.effects] };
    }
    const fumble = sections.criticalFailure ? htmlToPlainText(sections.criticalFailure) : "";
    if (/\bYou take the same penalty\b/i.test(fumble)) {
        const penalty = outcomes.success.modifiers ?? outcomes.criticalSuccess.modifiers ?? [];
        if (penalty.length) outcomes.criticalFailure.modifiers = penalty.map((modifier) => ({ ...modifier, recipient: "self" }));
    }
    return outcomes;
}

// A check's results said in sentences after it (2026-10-10), the user's degrees: "On a success, the target is Confused
// until the end of their next turn", "If he succeeds, …; if he critically succeeds, …", "Each creature the thief
// succeeds against is Fascinated", "… Clumsy 1 (Clumsy 2 on a critical success)". → { sections, criticalBracket } or
// null; a bracket's "on a critical success" is the critical success's own, apart.
const WHO_CHECKS = String.raw`(?:it|he|she|they|the [\w' -]+?)`;
const CHECK_LEADS = {
    criticalSuccess: new RegExp(String.raw`(?:On a critical success|With a critical success|If ${WHO_CHECKS} critically succeeds?(?: (?:at|on) (?:the|this|its|their|his|her) check)?)\s*,?\s*`, "i"),
    success: new RegExp(String.raw`(?:On a (?:success|hit)|With a success|If ${WHO_CHECKS} (?<!critically )succeeds?(?: (?:at|on) (?:the|this|its|their|his|her) check)?|Each creature (?:the|it|he|she|they) [\w' -]*?succeeds? against)\s*,?\s*`, "i"),
    criticalFailure: new RegExp(String.raw`(?:On a critical failure|If ${WHO_CHECKS} critically fails?(?: (?:at|on) (?:the|this|its|their|his|her) check)?)\s*,?\s*`, "i"),
    failure: new RegExp(String.raw`(?:On a failure|If ${WHO_CHECKS} (?<!critically )fails?(?: (?:at|on) (?:the|this|its|their|his|her) check)?)\s*,?\s*`, "i")
};
function proseChecks(html) {
    const start = String(html).search(/@Check\[|\bcheck against\b/i);
    if (start < 0) return null;
    const text = String(html).slice(start).replace(/<\/?(?:p|hr|strong|em|br)[^>]*>/gi, " ").replace(/\s+/g, " ");
    // Brackets masked, so a degree named inside them isn't taken for a clause of its own.
    const masked = text.replace(/\([^()]*\)/g, (group) => `(${"_".repeat(group.length - 2)})`);
    const found = {};
    for (const [degree, lead] of Object.entries(CHECK_LEADS)) {
        for (const match of masked.matchAll(new RegExp(lead.source, "gi"))) {
            // A lead that ends its sentence ("… closer on a success (60 feet on a critical success).") closes a clause.
            if (/^(?:[.;)]|$|\s*\(_*\)\s*(?:[.;]|$))/.test(masked.slice(match.index + match[0].length))) continue;
            found[degree] = { at: match.index, from: match.index + match[0].length };
            break;
        }
    }
    // "…, pulling it up to 30 feet closer on a success (60 feet on a critical success)": the clause before the lead.
    const trailing = !found.success ? /(?:^|[,.;]\s*)([^,.;]+?)\s+on a success\s*(?:\(([^()]*?)\s+on a critical success\))?\s*(?:[.;]|$)/i.exec(text) : null;
    if (trailing) return { sections: { success: trailing[1] }, criticalBracket: trailing[2] ?? null };
    if (!found.success && !found.criticalSuccess) return null;
    // A clause runs to the end of its sentence or the next degree's lead.
    const clause = (from) => {
        let end = masked.slice(from).search(/(?<=\.)\s|;\s*(?=(?:if|unless)\b(?! (?:it|he|she|they|the [\w' -]+?) (?:critically )?(?:succeeds?|fails?)\b))/i);
        end = end < 0 ? text.length : from + end;
        for (const other of Object.values(found)) if (other.at >= from && other.at < end) end = other.at;
        return text.slice(from, end).replace(/[\s,;.]*(?:and|or)?[\s,;.]*$/i, "");
    };
    const sections = Object.fromEntries(Object.entries(found).map(([degree, entry]) => [degree, clause(entry.from)]));
    const bracket = /\(([^()]*?)\s+on a critical success\)/i.exec(sections.success ?? "");
    if (bracket) sections.success = sections.success.replace(bracket[0], "");
    return { sections, criticalBracket: bracket?.[1] ?? null };
}

// A critical success like the success, with what its bracket names instead ("Clumsy 2", "60 feet", "2d6 damage").
function bracketRow(row, bracket) {
    const copy = structuredClone(row);
    if (!bracket) return copy;
    for (const match of htmlToPlainText(bracket).matchAll(/\b([A-Za-z-]+) (\d+)\b/g)) {
        const effect = copy.effects.find((entry) => entry.slug === match[1].toLowerCase());
        if (effect) effect.value = Number(match[2]);
    }
    const feet = /\b(\d+) (?:feet|foot)\b/i.exec(htmlToPlainText(bracket))?.[1];
    if (feet && copy.forcedMovement) copy.forcedMovement.distance = Number(feet);
    const formulas = inlineTags(bracket, "Damage").map((raw) => ({ formula: readDamage(raw) }));
    if (formulas.length) copy.damage = { mode: "formulas", formulas, rollScope: "target" };
    // "(doubled on a critical success)".
    if (/\bdoubled?\b/i.test(htmlToPlainText(bracket))) copy.damage = doubled(copy.damage);
    return copy;
}

// A row's own damage, doubled ("2*(2d8+8)[bludgeoning]").
function doubled(damage) {
    return damage?.mode === "formulas" ? { ...damage, formulas: damage.formulas.map((entry) => ({ formula: `2*${entry.formula}` })) } : damage;
}

// A plan for a skill action, or null when its text isn't a check against a DC.
export function compileSkillAction(item, { rank = 1, actor = null } = {}) {
    const html = item?.system?.description?.value ?? "";
    const check = readSkillCheck(html);
    if (!check) return null;
    let sections = degreeSections(html);
    // No result sections: the results said after the check (an action's, not a passive's rider).
    // (Not a choice of what to try: "attempts to either pull the target closer or Disarm it".)
    const prose = Object.keys(sections).length || item.system?.actionType?.value === "passive" || /\b(?:attempts? to|can|may) either\b/i.test(htmlToPlainText(html)) ? null : proseChecks(html);
    if (!Object.keys(sections).length && !prose) return null;
    if (prose) sections = prose.sections;
    const traits = [...(item.system?.traits?.value ?? [])];
    const plain = htmlToPlainText(html);
    // What the text may call the monster, for a pull toward it ("moved 5 feet toward the elasmosaurus's body").
    const owner = actor ?? item.actor ?? item.parent;
    const names = [owner?.name, owner?.prototypeToken?.name].filter(Boolean).flatMap((name) => [name, name.replace(/\s*\([^)]*\)\s*/g, " ").trim().split(/\s+/).at(-1)]);
    // Prose names conditions without links too ("the target is Stupefied 1 for 1 minute").
    const plainNames = prose ? STAGE_CONDITIONS.filter((slug) => slug !== "controlled") : null;
    const row = (text) => outcomeRow(text, { names, plain: plainNames });
    // In prose, the user's own failure falls on itself unless it names someone else ("On a critical failure, it is Confused").
    const ownFailure = (text) => (prose && text && !/\b(?:target|creature|foe|enemy|victim|ally|allies|opponent)s?\b/i.test(htmlToPlainText(text)) ? outcomeRow(text, { names, selfByDefault: true, plain: plainNames }) : row(text));
    const outcomes = likeRows({
        criticalSuccess: row(sections.criticalSuccess),
        success: row(sections.success),
        failure: ownFailure(sections.failure),
        criticalFailure: ownFailure(sections.criticalFailure)
    }, sections);
    if (prose) {
        const empty = (entry) => entry.damage.mode === "none" && !entry.effects.length && !entry.forcedMovement && !entry.modifiers?.length;
        // Prose that names only a success: a critical success is that too, with its bracket's own.
        if (!sections.criticalSuccess) outcomes.criticalSuccess = bracketRow(outcomes.success, prose.criticalBracket);
        else {
            // "On a critical success, the creature also falls Prone", "…, the damage is doubled": the success's and more.
            const critical = htmlToPlainText(sections.criticalSuccess);
            const twice = /\bdamage (?:is )?doubled\b|\bdoubles? the damage\b|\bdouble damage\b/i.test(critical);
            if (twice || /\balso\b/i.test(critical.slice(0, 60))) {
                const own = outcomes.criticalSuccess;
                const base = structuredClone(outcomes.success);
                outcomes.criticalSuccess = {
                    ...base,
                    damage: own.damage.mode !== "none" ? own.damage : twice ? doubled(base.damage) : base.damage,
                    effects: [...base.effects.filter((effect) => !own.effects.some((other) => other.slug === effect.slug)), ...own.effects],
                    ...(own.forcedMovement ?? base.forcedMovement ? { forcedMovement: own.forcedMovement ?? base.forcedMovement } : {})
                };
            // A critical success that applies nothing of its own ("the foe is completely buried"): at least the
            // success, and its text for the GM.
            } else if (empty(outcomes.criticalSuccess) && !empty(outcomes.success)) {
                outcomes.criticalSuccess = { ...structuredClone(outcomes.success), manualInstructions: [`{target} (critical success, the rest by hand): ${readableText(sections.criticalSuccess)}`] };
            }
        }
        // Results it can't apply: their text, for the GM.
        noteUnread(outcomes, Object.entries({ criticalSuccess: "Critical Success", success: "Success", failure: "Failure", criticalFailure: "Critical Failure" }).filter(([degree]) => sections[degree]).map(([degree, label]) => `<p><strong>${label}</strong> ${sections[degree]}</p>`).join(""));
    }
    // An area of its own ("in a @Template[emanation|distance:5], … comparing the result to each target's Reflex DC";
    // "against the Will DCs of all enemies within 30 feet"), or its range.
    const many = /\b(?:all|each|any number of) (?:enemies|foes|creatures|targets)\b[^.]*?\bwithin (\d+) feet\b/i.exec(plain)?.[1];
    const area = prose ? inlineTags(html, "Template").map(readTemplate).find(Boolean) ?? (many ? { type: "emanation", value: Number(many) } : null) : null;
    const within = /\bwithin (\d+) feet\b/i.exec(plain)?.[1];
    return {
        modelVersion: 13,
        source: { name: item.name, slug: item.system?.slug ?? null, uuid: item.uuid ?? null, type: item.type },
        rank,
        traits,
        activation: { time: String(item.system?.actions?.value ?? 1), traits },
        targeting: { target: area ? null : "1 creature", range: area ? null : prose && within ? `${within} feet` : /within 30 feet/i.test(plain) ? "30 feet" : traits.includes("attack") ? "touch" : "30 feet", area },
        trigger: { event: "use", immunity: readImmunity(html) },
        resolution: { kind: "check", check, sharedDamage: null, outcomes },
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
