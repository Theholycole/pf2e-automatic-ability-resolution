// Creature abilities the simulator plays from their rules or their words (2026-10-13, batch 306; the user's call: "build everything you
// brought up", tier 2). A passive no other reading has → { builtin: "creature-rules", …what it read }:
//   critRider: { conditions, push } — a critical hit's rider on all its Strikes (Brutal Beating);
//   swiftness: true — its movement triggers no reactions;
//   inexorable: { recover, speedPenalties, difficultTerrain } — conditions it recovers from at the end of its turn, and what slows it;
//   strikeTypes: [type] — a damage type its Strikes can deal instead, its choice (Phantom Touch);
//   hpRules: [{ below | atLeast, resistances, speed }] — resistances and Speed by its share of Hit Points (Abandon Armor);
//   protean: { value, recover } — resistance to the acid, electricity or sonic damage it last took, and senses it regrows;
//   critSpec: true — its weapons' critical specialization effects (Weapon Master);
//   troop: { thresholds: [{ hp, segments }] } — Troop Defenses;
//   split: { types, minHp, critical } — two of it, each with half its Hit Points, when damage of a type hits it (Split);
//   attach: { offGuard, both, acBonus, strike } — attached to a larger creature it hits (Attach);
//   berserk: { atMost, dc } — berserk below its Hit Points (a flesh golem's Berserk);
//   elemental: [{ on, traits, types, spell, metal, wood, effect }] — an elemental dragon's Countered by and Fed by.
// Live: unchanged. PF2e's own rules and the GM play them.

import { htmlToPlainText } from "../../../pf2e-resolution-core/src/text/plain-text.js";

const CONDITION_UUIDS = { nlCjDvLMf2EkV2dl: "quickened" };
const plain = (item) => htmlToPlainText(String(item?.system?.description?.value ?? "").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@Check\[flat\|dc:(\d+)[^\]]*\](?:\{[^}]*\})?(?: check)?/g, "DC $1 flat check").replace(/@Localize\[[^\]]*\]/g, "")).replace(/\s+/g, " ").trim();
const SUBJECT = String.raw`(?:the |a |an )?[\w' -]+?`;
const NUMBER = { one: 1, two: 2, three: 3, four: 4 };

// "When the ruffian deals damage on a critical hit, the target is Frightened 1, and the ruffian can push the target up to 10 feet" (or
// "knock the target up to 10 feet away").
function critRider(text) {
    const match = new RegExp(String.raw`\bWhen ${SUBJECT} deals damage (?:with a Strike )?on a critical hit, the target is (Frightened|Sickened|Clumsy|Enfeebled|Stupefied|Off-Guard|Prone|Dazzled)(?: (\d+))?(?:,? and ${SUBJECT} can (?:knock|push) the target (?:up to )?(\d+) feet(?: away)?)?`, "i").exec(text);
    if (!match) return null;
    return { critRider: { conditions: [{ slug: match[1].toLowerCase(), value: match[2] ? Number(match[2]) : null }], ...(match[3] ? { push: Number(match[3]) } : {}) } };
}

// "The sniper's movement doesn't trigger reactions."
function swiftness(text) {
    return /^(?:The |An? )?[\w' -]+?(?:'s|’s) movement (?:doesn't|does not) trigger reactions\.?$/i.test(text) ? { swiftness: true } : null;
}

// "…recovers from the Slowed and Stunned conditions at the end of its turn. It's also immune to penalties to its Speeds, and it ignores
// difficult terrain and greater difficult terrain."
function inexorable(text) {
    const match = /\brecovers from the (Slowed|Stunned|Paralyzed|Immobilized)(?:,? (?:and|or) (Slowed|Stunned|Paralyzed|Immobilized))? conditions? at the end of (?:its|their|his|her) turn\b/i.exec(text);
    if (!match) return null;
    return { inexorable: { recover: [match[1], match[2]].filter(Boolean).map((slug) => slug.toLowerCase()), speedPenalties: !/\bimmune to penalties to (?:its|their) Speeds?\b/i.test(text), difficultTerrain: !/\bignores difficult terrain\b/i.test(text) } };
}

// A toggle that turns its Strikes' damage type into another, each time its choice ("can choose to deal spirit damage instead": Phantom
// Touch); not a state that changes it (a bond).
function strikeTypes(rules, text) {
    if (!/\bcan choose to deal \w+ damage instead\b/i.test(text)) return null;
    const toggles = new Set(rules.filter((rule) => rule?.key === "RollOption" && rule.toggleable && rule.option).map((rule) => rule.option));
    const types = rules.filter((rule) => rule?.key === "DamageAlteration" && rule.property === "damage-type" && rule.mode === "override" && [].concat(rule.selectors ?? rule.selector ?? []).includes("strike-damage") && (rule.predicate ?? []).length === 1 && toggles.has(rule.predicate[0]) && typeof rule.value === "string").map((rule) => rule.value);
    return types.length ? { strikeTypes: [...new Set(types)] } : null;
}

// Resistances and Speed by its share of Hit Points: [{ lt: ["hp-percent", 50] }] and [{ gte: ["hp-percent", 50] }].
function hpShare(predicate) {
    const terms = Array.isArray(predicate) ? predicate : [];
    if (terms.length !== 1) return null;
    const [term] = terms;
    if (term?.lt?.[0] === "hp-percent" && Number.isFinite(Number(term.lt[1]))) return { below: Number(term.lt[1]) };
    if (term?.gte?.[0] === "hp-percent" && Number.isFinite(Number(term.gte[1]))) return { atLeast: Number(term.gte[1]) };
    return null;
}
function hpRules(rules) {
    const found = new Map();
    for (const rule of rules) {
        const share = hpShare(rule?.predicate);
        if (!share) continue;
        const key = JSON.stringify(share);
        const entry = found.get(key) ?? { ...share, resistances: [], speed: 0 };
        if (rule.key === "Resistance" && Number.isFinite(Number(rule.value))) for (const type of [].concat(rule.type)) entry.resistances.push({ type, value: Number(rule.value), exceptions: [...(rule.exceptions ?? [])] });
        else if (rule.key === "FlatModifier" && /speed/.test([].concat(rule.selector).join()) && Number.isFinite(Number(rule.value))) entry.speed += Number(rule.value);
        else return null;
        found.set(key, entry);
    }
    return found.size ? { hpRules: [...found.values()] } : null;
}

// Protean Anatomy: PF2e's flag for its resistance; blinded or deafened, it recovers at the end of its next turn.
function protean(rules, text) {
    const rule = rules.find((entry) => entry?.key === "ActiveEffectLike" && entry.path === "flags.system.proteanResistance" && Number.isFinite(Number(entry.value)));
    if (!rule) return null;
    const recover = /\bIf (?:Blinded|Deafened)(?: or (?:Blinded|Deafened))?, [^.]*\brecovers at the end of (?:its|their|his|her) next turn\b/i.test(text) ? ["blinded", "deafened"] : [];
    return { protean: { value: Number(rule.value), recover }, ...(/\bimmune to polymorph effects\b/i.test(text) ? { immunities: ["polymorph"] } : {}) };
}

// Troop Defenses: "HP 180 (4 segments); Thresholds 120 (3 segments), 60 (2 segments)"; PF2e's glossary alone, the glossary's own
// thresholds (two thirds and one third of its Hit Points: null here).
function troop(item, text) {
    const match = /\bThresholds? (\d+) \((\d|one|two|three|four) segments?\),? (\d+) \((\d|one|two|three|four) segments?\)/i.exec(text);
    if (!match) return !text && /@Localize\[PF2E\.NPC\.Abilities\.Glossary\.TroopDefenses\]/.test(String(item?.system?.description?.value ?? "")) ? { troop: { thresholds: null } } : null;
    const count = (word) => Number(word) || NUMBER[word.toLowerCase()];
    return { troop: { thresholds: [{ hp: Number(match[1]), segments: count(match[2]) }, { hp: Number(match[3]), segments: count(match[4]) }] } };
}

// Split: "When the black pudding is hit by an attack that would deal slashing or piercing damage and has 10 or more HP, it splits into
// two identical puddings, each with half the original's HP"; "Whenever a string slime would take slashing damage (if it weren't immune)
// and has at least 10 HP"; a critical hit's only (the carnivorous crystal's).
const TYPES = String.raw`(?:bludgeoning|piercing|slashing|electricity|sonic|fire|cold|acid)`;
function split(text) {
    if (!/\bsplits? into two identical\b/i.test(text) || /\bexplodes\b/i.test(text)) return null;
    const types = new RegExp(String.raw`\b(?:would (?:deal|take)|deals) (${TYPES}(?:,? (?:or )?${TYPES})*) damage\b`, "i").exec(text)?.[1];
    const minHp = /\b(?:has|had) (?:at least )?(\d+)(?: or more)? (?:HP|Hit Points)\b/i.exec(text)?.[1];
    if (!types || !minHp) return null;
    return { split: { types: types.toLowerCase().split(/,? (?:or )?|, /).filter(Boolean), minHp: Number(minHp), ...(/\btakes a critical hit\b/i.test(text) ? { critical: true } : {}) } };
}

// Attach: "When a bloodseeker hits a target larger than itself, its barbed legs attach it to that creature. … The bloodseeker is
// Off-Guard while attached." (not Off-Guard and +2 AC, the pickled punk; both Off-Guard, the bee borer); "Each turn while attached, the
// pickled punk automatically deals the damage from its jaws Strike".
function attach(rules, text) {
    if (!new RegExp(String.raw`\bWhen ${SUBJECT} (?:hits|Strikes) a (?:target|creature) larger than itself\b[^.]*\battach`, "i").test(text)) return null;
    const ac = rules.find((rule) => rule?.key === "FlatModifier" && [].concat(rule.selector).join() === "ac" && Number(rule.value) > 0);
    const strike = /\bautomatically deals the damage from (?:its|their) ([\w -]+?) Strike\b/i.exec(text)?.[1];
    return {
        attach: {
            offGuard: /\bis Off-Guard while attached\b|\bare both Off-Guard\b/i.test(text) && !/\bis not Off-Guard\b/i.test(text),
            ...(/\bare both Off-Guard\b/i.test(text) ? { both: true } : {}),
            ...(ac ? { acBonus: Number(ac.value) } : {}),
            ...(strike ? { strike: strike.toLowerCase() } : {})
        }
    };
}

// Berserk: "If it has 40 or fewer HP at the start of its turn, the golem must succeed at a DC 5 flat check or go berserk. A berserk golem
// wildly attacks the nearest living creature".
function berserk(text) {
    const match = /\bIf (?:it|they|he|she|the [\w' -]+?) ha(?:s|ve) (\d+) or fewer (?:HP|Hit Points) at the start of (?:its|their|his|her) turn, (?:it|they|he|she|the [\w' -]+?) must succeed at a DC (\d+) flat check or go berserk\b/i.exec(text);
    if (!match || !/\bwildly attacks the nearest (?:living )?creature\b/i.test(text)) return null;
    return { berserk: { atMost: Number(match[1]), dc: Number(match[2]), ...(/\bloses (?:its|their) immunity to mental effects while berserk\b/i.test(text) ? { losesMental: true } : {}) } };
}

// An elemental dragon's Countered by and Fed by.
function elemental(item, text) {
    const name = String(item?.name ?? "");
    const fedOrCountered = /^(?:Countered|Fed) by (\w+)$/i.exec(name);
    if (!fedOrCountered) return null;
    const untilNext = { until: "end-of-next-turn" };
    // "If the sky dragon takes fire damage, … Until the end of their next turn, they take a –1 circumstance penalty to attack rolls and AC,
    // and their jaws Strikes don't deal electricity damage."
    let match = new RegExp(String.raw`^If ${SUBJECT} takes (\w+) damage,[^.]*\.(?: [^.]*\.)*? Until the end of (?:their|its) next turn, (?:they|it) takes? a [–-](\d) circumstance penalty to attack rolls( and AC)?, and (?:their|its) jaws Strikes don't deal (\w+) damage\b`, "i").exec(text)
        ?? new RegExp(String.raw`^If ${SUBJECT} takes damage from a spell with the (\w+)(?: or (\w+))? trait,[^.]*\.(?: [^.]*\.)*? Until the end of (?:their|its) next turn, (?:they|it) takes? a [–-](\d) circumstance penalty to attack rolls( and AC)?, and (?:their|its) jaws Strikes don't deal (\w+) damage\b`, "i").exec(text);
    if (match && match.length === 5) return { elemental: [{ on: "damage", types: [match[1].toLowerCase()], effect: { ...untilNext, modifiers: [{ on: "attack", type: "circumstance", value: -Number(match[2]) }, ...(match[3] ? [{ on: "ac", type: "circumstance", value: -Number(match[2]) }] : [])], jawsLose: match[4].toLowerCase() } }] };
    if (match) return { elemental: [{ on: "damage", spell: true, traits: [match[1], match[2]].filter(Boolean).map((trait) => trait.toLowerCase()), effect: { ...untilNext, modifiers: [{ on: "attack", type: "circumstance", value: -Number(match[3]) }, ...(match[4] ? [{ on: "ac", type: "circumstance", value: -Number(match[3]) }] : [])], jawsLose: match[5].toLowerCase() } }] };
    // "If the sea dragon is targeted by a spell with the earth trait, Liquefy ends and they can't use it until the end of their next turn."
    match = new RegExp(String.raw`^If ${SUBJECT} is targeted by a spell with the (\w+) trait, ([\w' -]+?) ends and (?:they|it) can't use it until the end of (?:their|its) next turn\.?$`, "i").exec(text);
    if (match) return { elemental: [{ on: "targeted", spell: true, traits: [match[1].toLowerCase()], effect: { ...untilNext, disable: match[2] } }] };
    // "When a sea dragon is damaged by a spell or unarmed Strike of a creature with the metal trait, or a metallic weapon, … grant them a +1
    // item bonus to AC until the start of their next turn."
    match = new RegExp(String.raw`^When ${SUBJECT} is damaged by a spell or unarmed Strike of a creature with the metal trait, or a metallic weapon,[^.]*\+(\d) item bonus to AC until the start of (?:their|its) next turn\b`, "i").exec(text);
    if (match) return { elemental: [{ on: "damage", metal: true, effect: { until: "start-of-next-turn", modifiers: [{ on: "ac", type: "item", value: Number(match[1]) }] } }] };
    // "When a sky dragon is targeted by an earth spell or effect, … For 1 minute, the dragon is Concealed while flying."
    match = new RegExp(String.raw`^When ${SUBJECT} is targeted by an? (\w+) spell or effect,[^.]*\. For 1 minute, ${SUBJECT} is Concealed\b`, "i").exec(text);
    if (match) return { elemental: [{ on: "targeted", traits: [match[1].toLowerCase()], effect: { rounds: 10, conditions: [{ slug: "concealed", value: null }] } }] };
    // "When an underworld dragon is struck by a weapon made primarily of wood or affected by a spell with the plant or wood trait, … Their
    // Exploding Red Breath recharges, and the fire damage from the dragon's jaws deals an additional die of damage until the end of the
    // dragon's next turn."
    match = new RegExp(String.raw`^When ${SUBJECT} is struck by a weapon made primarily of wood or affected by a spell with the (\w+) or (\w+) trait,[^.]*\. (?:Their|Its) ([\w' -]+?) recharges, and the (\w+) damage from ${SUBJECT}(?:'s|’s) jaws deals an additional die of damage until the end of ${SUBJECT}(?:'s|’s) next turn\b`, "i").exec(text);
    if (match) return { elemental: [{ on: "damage", wood: true, spell: true, traits: [match[1].toLowerCase(), match[2].toLowerCase()], effect: { ...untilNext, recharge: match[3], jawsDie: match[4].toLowerCase() } }] };
    return null;
}

// A condition its rules grant it for good (Relentless: permanently Quickened) — quickened only when its extra action can Strike, not one
// only to move or to work a siege weapon.
function granted(rules, text) {
    const only = /\bextra action (?:can be used )?only to ([^.]+)/i.exec(text)?.[1];
    if (only && !/\bStrike\b/.test(only)) return null;
    const slugs = rules.filter((rule) => rule?.key === "GrantItem" && !rule.predicate?.length).map((rule) => CONDITION_UUIDS[/conditionitems\.Item\.(\w+)$/.exec(String(rule.uuid ?? ""))?.[1]]).filter(Boolean);
    return slugs.length ? { permanent: slugs.map((slug) => ({ slug, value: null })) } : null;
}

export function creatureRules(item) {
    if (item?.system?.actionType?.value !== "passive") return null;
    const rules = item.system?.rules ?? [];
    const text = plain(item);
    // (Countered by Metal: woodland passage and Vanishing Tracks lost — nothing a fight's bands have.)
    if (/^Countered by \w+$/i.test(item.name ?? "") && new RegExp(String.raw`^If ${SUBJECT} takes damage from a metal item or effect with the metal trait, (?:they|it) loses? woodland passage\b`, "i").test(text)) return { builtin: "no-effect" };
    const read = Object.assign({},
        critRider(text), swiftness(text), inexorable(text), strikeTypes(rules, text), hpRules(rules), protean(rules, text), troop(item, text), split(text),
        attach(rules, text), berserk(text), elemental(item, text), granted(rules, text),
        rules.some((rule) => rule?.key === "CriticalSpecialization" && !rule.alternate && !rule.predicate?.length) ? { critSpec: true } : null);
    return Object.keys(read).length ? { builtin: "creature-rules", ...read } : null;
}
