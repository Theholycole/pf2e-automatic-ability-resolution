// The GM's (the user's choice of 2026-10-12): an action, reaction or free action that no reading plays is compiled as
// { builtin: "no-effect", gm } when it is
// - "state": behind a requirement the simulator can't see — where it stands ("is in water", "is in a swamp", "on the deck of a ship",
//   "within 60 feet of their hoard"), a form or mode it's in, being attached or mounted, a free hand, before initiative is rolled;
// - "out-of-combat": an effect with no combat numbers that is narrative or out of combat — miles away, hours or days long, information,
//   social skills, items and weather;
// - "adventure": a one-off adventure creature's or hazard's (an adventure, Adventure Path, Society or one-shot bestiary of PF2e's, not a
//   rulebook's).
// Only after every reading has failed, so it never takes the place of one that plays.

import { htmlToPlainText } from "../../../pf2e-resolution-core/src/text/plain-text.js";

// PF2e's rulebook bestiaries (and its rulebook hazards and vehicles): not one-off adventures.
export const CORE_PACKS = new Set([
    "pathfinder-monster-core", "pathfinder-monster-core-2", "pathfinder-npc-core", "pathfinder-bestiary", "pathfinder-bestiary-2", "pathfinder-bestiary-3",
    "lost-omens-bestiary", "howl-of-the-wild-bestiary", "rage-of-elements-bestiary", "book-of-the-dead-bestiary", "war-of-immortals-bestiary",
    "battlecry-bestiary", "blog-bestiary", "pathfinder-dark-archive", "npc-gallery", "hazards", "vehicles", "iconics", "paizo-pregens"
]);

// The PF2e pack a creature comes from: the tool's own word for it (pack data), else its compendium source ("Compendium.pf2e.<pack>.Actor.…").
export function sourcePack(actor, { pack = null } = {}) {
    if (pack) return pack;
    const source = actor?._stats?.compendiumSource ?? actor?.flags?.core?.sourceId ?? actor?.sourceId ?? null;
    return /^Compendium\.pf2e\.([\w-]+)\.Actor\./.exec(String(source ?? ""))?.[1] ?? /^pf2e\.([\w-]+)$/.exec(String(actor?.pack ?? ""))?.[1] ?? null;
}

export const isAdventurePack = (pack) => Boolean(pack) && !CORE_PACKS.has(pack);

// States the simulator can't see, in a requirement.
const UNSEEN = [
    /\b(?:is|are|must be|isn't|is not) (?:fully )?(?:in|within|on|under|inside|atop|immersed in|submerged in|standing on|standing in) (?:the )?(?:water|a swamp|swamp|natural (?:surroundings|terrain)|forest terrain|[\w-]+ terrain|darkness|dim light|bright light|an area of (?:bright|dim) light|a cloud of|its lair|their lair|the deck of|a ship|a vehicle|a body of water|sand|sandy|snow|ice|mud|dirt|soft|unworked stone|stone|the air|a crowd|the same space as a [\w' -]+?corpse)/i,
    /\bmust be outdoors\b|\bunderwater\b|\bwithin \d+ feet of (?:its|their|his|her) hoard\b|\bwithin reach of any kind of stone\b|\bcasting a shadow\b|\bwithin (?:\d+ feet|a mile|1 mile) of (?:a|its|their) [\w' -]*(?:water|lair|tree|stone|statue|altar|shrine|hoard)\b|\bin the shadow of\b/i,
    /\bis (?:in|using) (?:its|their|his|her) [\w' -]+? (?:form|shape|mode)\b|\bis in (?:its|their) (?:swarm|ectoplasmic|true|natural|normal|humanoid|hybrid|animal|bipedal|quadrupedal) (?:form|stance)\b/i,
    /\bis (?:attached|mounted|riding|burrowed|Wheels Up|piloting|driving)\b|\bmust be mounted\b|\bis controlling (?:a body|a corpse)\b|\bis in torpor\b|\bis riding\b/i,
    /\bhas (?:a|one|at least one) (?:free )?hand(?: free)?\b|\bhas (?:a|one|at least one) hand free\b|\bhas (?:both|two) hands free\b|\bInitiative has not (?:yet )?been rolled\b|\bcan hear (?:the|it|him|her|them)\b|\bhas at least one [\w' -]+? spell remaining\b|\bprotected by the ancestors\b|\bhas (?:detected|sensed)\b|\bis attuned to\b|\b(?:aura|shell|barrier) is (?:active|frozen|raised|up)\b|\bhasn't been killed\b|\bis within its bonded location\b/i
];

// Combat in its words: a check, damage, a Strike, a save, a condition, movement, a reaction, an area, a casting.
const COMBAT = /\bCasts? (?:a|the) Spell\b|\bcasts\b|@Check|@Damage|\bStrikes?\b|\bsaves?\b|saving throw|\b(?:damage|AC|attack rolls?|bonus|penalty|Grabbed|Prone|Frightened|Stunned|Slowed|Clumsy|Enfeebled|Sickened|Off-Guard|Immobilized|Restrained|Blinded|Dazzled|Deafened|Fascinated|Confused|Controlled|Paralyzed|Unconscious|Hit Points|HP|resistance|weakness|immun\w*|difficult terrain|cover|Concealed|Hidden|Invisible|Hide|Steps?|Strides?|Fly|Flies|Swims?|Burrows?|Climbs?|Leaps?|Shove|Trip|Grapple|Disarm|Demoralize|Feint|reactions?|initiative|counteract\w*|attacks?|Escape|Engulf\w*|Swallow\w*|Grab|aura|emanation|burst|cone|line)\b/i;
// Out of combat in its words.
const OUT_OF_COMBAT = /\b(?:out of combat|outside of combat|not in combat|in exploration mode|during exploration|downtime)\b|\b\d+ miles?\b|\b(?:within|across|up to) (?:a|1|one) mile\b|\bfor (?:\d+|one|two|several) (?:hours?|days?|weeks?|months?|years?)\b|\b(?:learns?|knows?|communicates?|telepathically|speaks? with|understands?|Recall Knowledge|Gather Information|Make an Impression|Request|Coerce|Thievery|Crafting|unattended|weather|ritual|merchant|purchase|sells?|buys?|gold pieces|reveals? (?:a|the) (?:location|secret|answer))\b/i;

export function gmFallback(item, options = {}) {
    if (item?.type !== "action" || !["action", "reaction", "free"].includes(item.system?.actionType?.value)) return null;
    const text = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const requirement = /\bRequirements? (.+?)(?= (?:Effect|Trigger|Frequency) |$)/.exec(text)?.[1] ?? null;
    if (requirement && UNSEEN.some((pattern) => pattern.test(requirement))) return { builtin: "no-effect", gm: "state" };
    // (Batch 196, Ink Cloud: "This cloud has no effect outside of water." — where it is, which the simulator can't see.)
    if (/\b(?:has|have) no effect (?:outside(?: of)?|out of) (?:the )?water\b|\bonly (?:works|functions) underwater\b/i.test(text)) return { builtin: "no-effect", gm: "state" };
    const traits = item.system?.traits?.value ?? [];
    if (traits.includes("exploration") || traits.includes("downtime") || (!COMBAT.test(text) && OUT_OF_COMBAT.test(text))) return { builtin: "no-effect", gm: "out-of-combat" };
    if (isAdventurePack(sourcePack(options.actor ?? item.actor ?? item.parent, options))) return { builtin: "no-effect", gm: "adventure" };
    return null;
}
