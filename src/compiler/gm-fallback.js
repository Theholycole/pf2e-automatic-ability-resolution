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
    /\b(?:is|are|must be|isn't|is not) (?:already )?(?:fully )?(?:in|within|on|under|inside|atop|immersed in|submerged in|standing on|standing in) (?:the )?(?:water|a swamp|swamp|natural (?:surroundings|terrain)|forest terrain|[\w-]+ terrain|darkness|dim light|bright light|an area of (?:bright|dim) light|a cloud of|its lair|their lair|the deck of|a ship|a vehicle|a body of water|sand|sandy|snow|ice|mud|dirt|soft|unworked stone|stone|the air|a crowd|the same space as a [\w' -]+?corpse)/i,
    /\bmust be outdoors\b|\bunderwater\b|\bwithin \d+ feet of (?:its|their|his|her) hoard\b|\bwithin reach of any kind of stone\b|\bcasting a shadow\b|\bwithin (?:\d+ feet|a mile|1 mile) of (?:a|its|their) [\w' -]*(?:water|lair|tree|stone|statue|altar|shrine|hoard)\b|\bin the shadow of\b/i,
    /\bis (?:in|using) (?:its|their|his|her) [\w' -]+? (?:form|shape|mode)\b|\bis in (?:its|their) (?:swarm|ectoplasmic|true|natural|normal|humanoid|hybrid|animal|bipedal|quadrupedal) (?:form|stance)\b/i,
    /\bis (?:attached|mounted|riding|burrowed|Wheels Up|piloting|driving)\b|\bmust be mounted\b|\bis controlling (?:a body|a corpse)\b|\bis in torpor\b|\bis riding\b/i,
    // (Batch 209: a daily story it has spun, a fresh corpse it killed beside it.)
    /\bhas Weaved a Narrative\b|\bis adjacent to the corpse of a creature\b/i,
    // (Batch 211.) Something it holds or carries that isn't a weapon it Strikes with, or its breath held.
    /\b(?:is|isn't|is not) (?:holding|playing)\b|\bholds an? [\w' -]+ (?:they|it|he|she) (?:collected|took|stole)\b|\bis wielding (?:a|an|the|his|her|its|their) (?:broom|[\w' -]*?(?:chosen with|familiar))\b|\bisn't wielding [A-Z]|\bholding (?:its|their) breath\b|\bbeing wielded or carried\b/,
    // A named mode, form, stance or state of its own, or another creature it's joined to.
    /\b(?:is|isn't|is not)(?: already| currently)? in (?:its |their |his |her |a |an )?[\w-]+ (?:state|form|shape|posture|stance|mode)\b|\bis in (?:its |their |his |her )?[A-Z][\w'-]*(?: [A-Z][\w'-]*)*\b|\bis using [A-Z][\w' -]+? in\b|\bis in a phalanx\b|\bis (?:awakened|dormant)\b/,
    /\bis (?:Reared Back|Withdrawn into|Bonded with|manifested using|disguised as|transformed into|discorporated|not discorporated|merged with|possessing)\b|\bcurrently transformed into\b|\bhas (?:its|their|his|her) [A-Z][\w' -]+ (?:open|closed)\b|\bis benefiting from (?:its|their|his|her) [A-Z]|\bhas an? [\w-]+ trait from\b|\bhas used [A-Z][\w' -]+ (?:to|within)\b|\b(?:has|hasn't) Pressurized\b|\bisn't currently Pressurized\b|\b(?:isn't|is not|doesn't|does not) (?:already |currently )?(?:Inhabit(?:ing)?|wearing a skin|have a frozen shell|have a shield raised)\b|\bInhabits an object\b|\bneck is not currently extended\b|\bOnly the [\w-]+ half\b|\band its partner\b|\b(?:without|doesn't have) a rider\b|\badjacent to its ward\b|\bhas a charge\b|\bunfulfilled contract\b/,
    // Something it stores, or keeps out in the world, that the simulator doesn't count.
    /\bhas (?:no stored|a stored|a charged|a soul gem|at least one herbal|their spirit blades|its spirit blades|a central weapon|fresh blood)\b|\bhas at least one [\w' -]+? (?:attached|active|manifested)\b|\bhas at least one duplicate\b|\bA soul has been trapped\b|\bsoul feathers?\b|\bhas stolen at least\b|\b(?:fewer|more) than \d+ weapons sheathed\b|\bsteeped weapon\b|\bhas at least [\w-]+ (?:gallons?|doses?|charges?) in (?:its|their)\b|\b(?:sac|reservoir|bladder|tank) is (?:full|empty)\b|\bhas Grabbed Debris\b|\bhas an empty [\w' -]+ in each hand\b|\bhas a hex bullet loaded\b|\bhas a creature impaled\b/,
    // Where it is: the land, water, light, height or things around it.
    /\b(?:is|are) (?:in|within|standing in|swimming in|standing on) (?:an? |the |its |their )?(?:[\w-]+ )?(?:desert|region|cold water|nest|natural environment|urban environment|forested terrain|forest|treetop|tree limb|tree|space of liquid|lava|magma|ground)\b|\ban area of (?:magical )?darkness\b|\bhanging (?:from|upside down|at least)\b|\bflying at least \d+ feet above\b|\bon board a ship\b|\badjacent to (?:a broken ship|nautical debris|metal of at least|a Small or larger fire|a vertical rope|an area containing|a book)\b|\badjacent to or pushing\b|\bis touching another tree\b|\bat least \d+ Bulk of loose\b|\bobject or building\b|\bA corpse is in\b|\bis within (?:their|its|his|her) (?:domain|sanctuary)\b|\bis on the [A-Z]\w+ Plane\b|\bin contact with (?:both )?water\b/,
    /\bis adjacent to the corpse of (?:a|an) [\w ]*creature\b|\bis adjacent to (?:a dead creature|a creature that died within)\b/,
    // What it senses (speech, a spell's words, hiding creatures) that the simulator doesn't track, or a vehicle it drives.
    /\bhas spoken\b|\bheard the incantation\b|\bsaw an? [\w-]+ cast\b|\bcommunicating empathically\b|\b(?:is|are) [Hh]iding\b|\b(?:Hidden|Undetected)\b|\bundetected by\b|\bunnoticed by\b|\bhasn't detected\b|\bisn't observed by\b|\busing its (?:lifesense|tremorsense|scent)\b|\btaking a Drive action\b|\bare piloting\b/,
    /\bhas (?:a|one|at least one) (?:free )?hand(?: free)?\b|\bhas (?:a|one|at least one) hand free\b|\bhas (?:both|two) hands free\b|\bInitiative has not (?:yet )?been rolled\b|\bcan hear (?:the|it|him|her|them)\b|\bhas (?:a|an|at least one) [\w' -]+? spell remaining\b|\bprotected by the ancestors\b|\bhas (?:detected|sensed)\b|\bis attuned to\b|\b(?:aura|shell|barrier|cloud) is (?:active|frozen|raised|up)\b|\bhasn't been killed\b|\bis within its bonded location\b/i
];

// States in a trigger (batch 216).
// (Batch 226: its liege, its passengers, its chosen egg, a lower-ranking cultist beside it; a state of its own — Retracted, transformed by an ability, an
// ability active.)
// (Batch 228, Battlezoo: a pose it holds by an ability, its chosen victim, an area its ability made, an ability active or one it's in the middle of, a
// count of its arms, a creature attached to it, being out of water, a broken keepsake, a light in its space.)
const TRIGGER_UNSEEN = /\bwhile (?:it's |it is |they're |they are |he's |she's )?(?:underwater|Feigning Death|Hiding in water|hiding in water|Retracted)\b|\bis using [A-Z][\w' -]+?(?:,| and\b)|\bliege\b|\bpassengers?\b|\bchosen [\w ]*egg\b|\blower-ranking cultist\b|\bis transformed (?:using|with|by) [A-Z]|\bhas [A-Z][\w' -]+? active\b/;
// (Batch 240, Battlezoo: one of its own named creations doing it, a creature that refused its offer, one of its prey, a larger battle, an emotion effect
// on it.)
const TRIGGER_UNSEEN_DRAGONS = /\bone of (?:the [\w' -]+?['’]s|its|their) (?!Strikes\b)[A-Z][\w' -]+?s\b|\brefused (?:the [\w' -]+?['’]s|its|their) offer\b|\bone of (?:its|their) prey\b|\bunder the effect of a beneficial\b/;
const TRIGGER_UNSEEN_MORE = /\bwhile (?:the [\w' -]+?|it|they) (?:is|are) [^.;]*?\busing [A-Z]|\bits victim\b|\bthe area of (?:the [\w' -]+?['’]s|its|their) [A-Z]|\bwhile (?:its|their|his|her) [A-Z][\w' -]+? is active\b|\bwhile [A-Z][a-z]+ing\b|\bhas (?:fewer|more) than \w+ (?:arms|heads|limbs|tentacles|legs)\b|\battached creature\b|\bcreature attached to\b|\bremoved from (?:the )?water\b|\bgains the broken condition\b|\blight source\b|\bsuccessfully Hides from\b/;
// A requirement or an effect behind such a state too (batch 226): cover an animal ally gives it, a burrow hole nearby.
// (Batch 228: a teleport to darkness far away as it drops — where it goes, the GM's.)
// (Batch 238: a persona change; its aura moved to another place; an energy picked for its runes; a rider on its next action; a blessing of its own
// some allies carry.)
const EFFECT_UNSEEN = /\bhas cover from an? [\w-]+ ally\b|\bto a burrow hole\b|\bteleports to an area of darkness\b|\bChanges Characters\b|\baura instead emanates from\b|\bchooses between [a-z, ]+,? or [a-z]+ damage\b(?:[^.]*\.){1,3}[^.]*\bgains? immunity to that damage type\b|(?:^(?:Frequency [^.]*? Effect )?|\.\s+)If the next action (?:the [\w' -]+?|it|they) uses? is\b|\bbenefited from (?:the [\w' -]+?['’]s|its|their) [\w' -]+? in the last (?:hour|minute|round)\b|\bdoubles? (?:its|their) resistance from\b|\b(?:it's|it is|is) affected by (?:the [\w' -]+?['’]s|its|their) [\w' -]+? aura\b|\bpart of (?:a )?larger warfare\b|\bperceives magical auras\b|\brolls a d20\. The result is\b|\brolls a d20 and keeps the result\b/;
// A social or exploration skill check that sets it off (batch 216).
const SKILL_TRIGGER = /\b(?:fails|critically fails|succeeds at|critically succeeds at) (?:a|an) (?:(?:Crafting|Deception|Diplomacy|Medicine|Performance|Society|Survival|Thievery|[A-Z][\w-]* Lore)(?: or (?:Crafting|Deception|Diplomacy|Medicine|Performance|Society|Survival|Thievery|Intimidation))? check|(?:Charisma-based )?skill check|check to (?:Balance|Climb|Swim)(?: or (?:Balance|Climb|Swim))?)\b|\battempts? an? (?:Deception, Diplomacy, or (?:an )?Intimidation|Diplomacy|Deception) check against\b/i;

// Combat in its words: a check, damage, a Strike, a save, a condition, movement, a reaction, an area, a casting.
const COMBAT = /\bCasts? (?:a|the) Spell\b|\bcasts\b|@Check|@Damage|\bStrikes?\b|\bsaves?\b|saving throw|\b(?:damage|AC|attack rolls?|bonus|penalty|Grabbed|Prone|Frightened|Stunned|Slowed|Clumsy|Enfeebled|Sickened|Off-Guard|Immobilized|Restrained|Blinded|Dazzled|Deafened|Fascinated|Confused|Controlled|Paralyzed|Unconscious|Hit Points|HP|resistance|weakness|immun\w*|difficult terrain|cover|Concealed|Hidden|Invisible|Hide|Steps?|Strides?|Fly|Flies|Swims?|Burrows?|Climbs?|Leaps?|Shove|Trip|Grapple|Disarm|Demoralize|Feint|reactions?|initiative|counteract\w*|attacks?|Escape|Engulf\w*|Swallow\w*|Grab|aura|emanation|burst|cone|line)\b/i;
// Out of combat in its words.
const OUT_OF_COMBAT = /\b(?:out of combat|outside of combat|not in combat|in exploration mode|during exploration|downtime)\b|\b\d+ miles?\b|\b(?:within|across|up to) (?:a|1|one) mile\b|\bfor (?:\d+|one|two|several) (?:hours?|days?|weeks?|months?|years?)\b|\b(?:learns?|knows?|communicates?|telepathically|speaks? with|understands?|Recall Knowledge|Gather Information|Make an Impression|Request|Coerce|Thievery|Crafting|unattended|weather|ritual|merchant|purchase|sells?|buys?|gold pieces|reveals? (?:a|the) (?:location|secret|answer))\b/i;

export function gmFallback(item, options = {}) {
    // (Batch 248, a passive that takes a full minute to do — moving through a wall over a minute: out of combat.)
    if (item?.type === "action" && item.system?.actionType?.value === "passive") {
        const said = htmlToPlainText(String(item.system?.description?.value ?? "")).replace(/\s+/g, " ");
        return /\b(?:In a process that )?takes (?:an entire|a full|1|one|10|ten) minutes?\b/i.test(said) && !/@Damage|@Check|\bStrikes?\b|\b(?:bonus|penalty|cover|targeted)\b/i.test(said) ? { builtin: "no-effect", gm: "out-of-combat" } : null;
    }
    if (item?.type !== "action" || !["action", "reaction", "free"].includes(item.system?.actionType?.value)) return null;
    const text = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
    const requirement = /\bRequirements? (.+?)(?= (?:Effect|Trigger|Frequency) |$)/.exec(text)?.[1] ?? null;
    if (requirement && UNSEEN.some((pattern) => pattern.test(requirement))) return { builtin: "no-effect", gm: "state" };
    // (Batch 216: a trigger behind such a state too — "while they're underwater", "while Feigning Death", "is using Perfect Camouflage, and …"; one set off
    // by a social or exploration skill check, the GM's as out of combat.)
    const trigger = /\bTrigger ([^.]+?)(?=\.| (?:Effect|Requirements?|Frequency) |$)/.exec(text)?.[1] ?? null;
    if (trigger && (UNSEEN.some((pattern) => pattern.test(trigger)) || TRIGGER_UNSEEN.test(trigger) || TRIGGER_UNSEEN_MORE.test(trigger) || TRIGGER_UNSEEN_DRAGONS.test(trigger))) return { builtin: "no-effect", gm: "state" };
    if (trigger && SKILL_TRIGGER.test(trigger)) return { builtin: "no-effect", gm: "out-of-combat" };
    if (EFFECT_UNSEEN.test(text)) return { builtin: "no-effect", gm: "state" };
    // (Batch 232: Counterspell's kin in an action too — its whole effect an attempt to counteract a spell or magical effect (dispelling it, taking control
    // of it), with no damage, save or Strike of its own: the GM's, as Counterspell is (the user's choice of 2026-10-11), read as batch 86's.)
    // (A reaction's trigger about a spell, an effect or magic, as Counterspell's is — not a creature dropping, batch 86's line.)
    const magicTrigger = !trigger || /\b(?:spells?|effects?|magic\w*|Casts?|casting|traits?)\b/i.test(trigger);
    if (magicTrigger && /\b(?:attempts? (?:a |to )?counteract|counteract check|attempts? to (?:dispel|unravel))\b/i.test(text) && !/\b(?:Unconscious|dying)\b|@Damage|\bdamage\b(?! type)|\bStrikes?\b|@Check\[(?:type:)?(?:fortitude|reflex|will)\b|\b(?:bonus|penalty|rerolls?|Concealed|Hidden|Invisible|Sickened|Frightened|Stunned|Slowed|Quickened|Clumsy|Enfeebled|Drained|Stupefied|Prone|Grabbed|Immobilized|Paralyzed|Fatigued)\b|\bcan be dispelled\b|\banyone else\b/i.test(text)) return { builtin: "no-effect" };
    // (Batch 228, Battlezoo: a sound illusion with no damage or save, at most a Perception check to see through it — narrative.)
    if (/\bcreates an auditory illusion\b/i.test(text) && !/@Damage|\bsave\b|@Check\[(?!(?:type:)?perception\b)/i.test(text)) return { builtin: "no-effect", gm: "out-of-combat" };
    // (Batch 243: a requirement about a spell aimed at it last round (Reflexive Understanding) — a state the simulator doesn't keep; a boon offered for a
    // directive until the creature's next daily preparations (Inspire Envoy), another creature's thoughts read (Thought Whispers) — out of combat.)
    if (requirement && /\bwas targeted by a spell\b[^.]*?\bin the last round\b/i.test(requirement)) return { builtin: "no-effect", gm: "state" };
    if (/\boffers? (?:their|its|his|her) [\w' -]+? blessing in exchange for\b[^.]*\bdirective\b/i.test(text) || /\bseek (?:others['’]|other creatures['’]) thoughts\b[^.]*\bwith mind reading\b/i.test(text)) return { builtin: "no-effect", gm: "out-of-combat" };
    // (Batch 196, Ink Cloud: "This cloud has no effect outside of water." — where it is, which the simulator can't see.)
    if (/\b(?:has|have) no effect (?:outside(?: of)?|out of) (?:the )?water\b|\bonly (?:works|functions) underwater\b/i.test(text)) return { builtin: "no-effect", gm: "state" };
    const traits = item.system?.traits?.value ?? [];
    if (traits.includes("exploration") || traits.includes("downtime") || (!COMBAT.test(text) && OUT_OF_COMBAT.test(text))) return { builtin: "no-effect", gm: "out-of-combat" };
    if (isAdventurePack(sourcePack(options.actor ?? item.actor ?? item.parent, options))) return { builtin: "no-effect", gm: "adventure" };
    return null;
}
