// Creatures an ability summons (2026-10-13, batch 297; the user's call: "Automate the summoning of creatures but leave spawn rules or adventure
// premade sets up to the GM to determine if the summon can work"). Read before every other reading, which had kept them the GM's: a
// { builtin: "conjure" } plan as batch 295's (src/compiler/monster.js chunk295), live made by scripts/conjure.js. Its creatures:
//   { name, count, size, stats, from, adjust?, traits?, initiative?, look? }
//     stats: { ac, hp, saves: { fortitude, reflex, will }, speeds, maker: { ac, saves, hp } } (maker: its maker's own, plus or times these);
//     from: { uuid } (the creature the text links), { name } (found by name in the compendiums), { self: true } (another of the maker), null;
//     adjust: "elite" or "weak"; traits: added to its own; initiative: "roll" (it rolls initiative), "maker" (its maker's), none (a minion);
//     look: "target" (it looks like the GM's target).
// And on the plan: options ([{ label, creatures }], the GM's pick on a card), pick (a creature from the compendiums, the GM's: { any, all,
// level | maxLevel | rank, when }), needs (what must be there, for the GM to see to), max, lasts, endsWithMaker, vanishAtZero, makerDamage,
// oldest (the oldest go past max, not the farthest), trigger. A rune trap of an adventure's: the GM's ("adventure"); null otherwise.

import { htmlToPlainText } from "../../../pf2e-resolution-core/src/text/plain-text.js";
import { isAdventurePack, sourcePack } from "./gm-fallback.js";

// The summon trait's table: the highest level a summon spell of each rank brings (Player Core).
export const SUMMON_LEVELS = { 1: -1, 2: 1, 3: 2, 4: 3, 5: 5, 6: 7, 7: 9, 8: 11, 9: 13, 10: 15 };

// Marvelous Mount's Speeds by its rank (Player Core): 40 feet, 60 from 4th, a fly Speed of 60 from 5th, 80 and 80 from 6th.
export function mountSpeeds(rank) {
    if (rank >= 6) return { land: 80, fly: 80 };
    if (rank >= 5) return { land: 60, fly: 60 };
    if (rank >= 4) return { land: 60 };
    return { land: 40 };
}

// The summon spells' PF2e ids, for an ability that names one without a link.
const SUMMON_SPELLS = { fiend: "29ytKctjg7qSW2ff", fey: "hs7h8f4Z1ZNdUt3s", animal: "4YnON9JHYqtLzccu" };

const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const count = (word) => (/^\d+$/.test(String(word)) ? Number(word) : NUMBERS[String(word ?? "").toLowerCase()] ?? null);
const ORDINAL = String.raw`(\d+)(?:st|nd|rd|th)`;
const lasting = (value, unit = "minutes") => ({ mode: "fixed", value, unit, expiry: "turn-start", anchor: "effect-start" });
const SUMMONED = ["summoned", "minion"];

// The text as read: links by their labels, inline rolls by their words, an area by its size ("200-foot emanation").
function plainOf(html) {
    return htmlToPlainText(String(html ?? "")
        .replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")
        .replace(/\[\[[^\]]*\]\]\{([^}]*)\}/g, "$1")
        .replace(/@Damage\[\(?(\d+)\)?\[(\w+)\]\](?:\{[^}]*\})?/g, "$1 $2")
        .replace(/@Template\[(?:type:)?(\w+)\|distance:(\d+)[^\]]*\](?:\{[^}]*\})?/g, "$2-foot $1"))
        .replace(/\s+/g, " ").trim();
}

// The creature a label links ("Wights", "Skeletal Champions": its singular too), as { uuid }; else { name } to find it by.
function creatureOf(html, label) {
    const want = String(label ?? "").trim().toLowerCase();
    const singular = (word) => word.replace(/ies$/, "y").replace(/(?<=[^s])s$/, "");
    for (const match of String(html ?? "").matchAll(/@UUID\[(Compendium\.[\w-]+\.[\w-]+\.Actor\.[A-Za-z0-9]{16})\]\{([^}]*)\}/g)) {
        const linked = match[2].trim().toLowerCase();
        if (linked === want || singular(linked) === singular(want)) return { uuid: match[1] };
    }
    return { name: singular(String(label ?? "").trim()).replace(/\b[a-z]/g, (letter) => letter.toUpperCase()) };
}
const titled = (words) => String(words).trim().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());

// Its own numbers in the text ("HP 58; AC 27, Fort +17, Ref +15, Will +14", "AC 34, Fort +23, Ref +20, Will +20, and 85 Hit Points").
function statLine(plain) {
    const defences = /\bAC (\d+), Fort \+(\d+), Ref \+(\d+), Will \+(\d+)/.exec(plain);
    const hp = /\bHP (\d+)\b/.exec(plain) ?? /\band (\d+) Hit Points\b/.exec(plain);
    if (!defences || !hp) return null;
    return { ac: Number(defences[1]), hp: Number(hp[1]), saves: { fortitude: Number(defences[2]), reflex: Number(defences[3]), will: Number(defences[4]) } };
}

export function readSummon(item, options = {}) {
    const type = item?.system?.actionType?.value;
    if (!["action", "reaction", "free"].includes(type)) return null;
    const html = String(item.system?.description?.value ?? "");
    const plain = plainOf(html);
    const actor = options.actor ?? item.actor ?? item.parent ?? null;
    const actions = type === "action" ? Number(item.system?.actions?.value) || 1 : 0;
    const level = Number(actor?.system?.details?.level?.value);
    const SELF = String.raw`(?:[Tt]he [\w' -]+?|[A-Z][\w'-]+(?: [A-Z][\w'-]+)?|[Ii]t)`;

    // A reaction that uses its summoning ability (batch 297: "It uses MORE! CENTAURS! as a reaction"): that ability's summon, as it dies when that's
    // its trigger.
    let match = /^Trigger (.+?) Effect .*?\b(?:It|[Tt]he [\w' -]+?) uses ([A-Z][^.]+?) as a reaction\b/.exec(plain);
    const used = match && type === "reaction" ? [...(actor?.items ?? [])].find((other) => other?.type === "action" && other.name === match[2] && other.system?.actionType?.value === "action") : null;
    const borrowed = used ? readSummon(used, options) : null;
    if (borrowed?.builtin === "conjure") {
        const dies = new RegExp(String.raw`^${SELF} is reduced to 0 Hit Points$`).test(match[1].trim());
        return { ...borrowed, actions: 0, ...(dies ? { trigger: { event: "death", reaction: true } } : {}), notes: [...(borrowed.notes ?? []), `As ${match[2]}, as a reaction.`] };
    }

    // Its own summon spell, unlinked (batch 297, Mirrored Summons: "Effect The katpaskir casts summon fiend, regaining the daily ability to do so if
    // needed"): the spell's cast card at its own innate spell's rank; a limit in that spell's name ("Demons only") a note.
    match = /\bEffect (?:The [\w' -]+?|It) casts summon (fiend|fey|animal|undead|elemental|celestial|monitor|construct|entity|dragon|giant)\b([^.]*)\./i.exec(plain);
    // (Not one that links the spell outside its trigger, Ritual Gate's requirement: the spell reading has it, the requirement too.)
    const linkedHere = /@UUID\[[^\]]*\]\{Summon [^}]*\}/i.test(html.replace(/<strong>Trigger<\/strong>[\s\S]*?(?=<hr\b|<strong>Effect<\/strong>)/i, ""));
    if (match && SUMMON_SPELLS[match[1].toLowerCase()] && !linkedHere) {
        const name = `Summon ${titled(match[1].toLowerCase())}`;
        const own = [...(actor?.items ?? [])].find((other) => other?.type === "spell" && String(other.name).toLowerCase().startsWith(name.toLowerCase()));
        const rank = Number(own?.system?.location?.heightenedLevel ?? own?.system?.level?.value) || null;
        const limit = /\(([^)]*?only)[^)]*\)/i.exec(String(own?.name ?? ""))?.[1] ?? null;
        const sustained = /\bautomatically sustained as long as the triggering [\w ]+? is sustained, for up to (\d+) minutes?\b/.exec(plain);
        return { builtin: "cast-spell", source: { name: item.name, uuid: null, slug: null }, spell: { uuid: `Compendium.pf2e.spells-srd.Item.${SUMMON_SPELLS[match[1].toLowerCase()]}`, name }, rank, dc: null, attack: null, tradition: null, self: false, notes: [...(limit ? [`${limit[0].toUpperCase()}${limit.slice(1)}, as its own spell says.`] : []), ...(match[2].trim() ? [`${match[2].trim().replace(/^,\s*/, "").replace(/^\w/, (letter) => letter.toUpperCase())}.`] : []), ...(sustained ? [`Sustained for it while the summon that set it off is, up to ${sustained[1]} minute${sustained[1] === "1" ? "" : "s"}.`] : [])] };
    }

    // A rune trap ("This trap summons a specific 1st-level creature, determined when the trap is created. The creature rolls initiative and
    // remains for 2d6 rounds"): the creature it names, or the GM's pick as the trap is placed; an adventure's runes stay the GM's.
    if (/^Trigger .+? Effect (?:The|This) trap summons\b/.test(plain)) {
        if (isAdventurePack(sourcePack(actor, options))) return { builtin: "no-effect", gm: "adventure" };
        const rune = new RegExp(String.raw`Effect (?:The|This) trap summons (?:an? ([A-Z][\w' -]+?)|a specific (?:level (-?\d+)|${ORDINAL}-level) creature, determined when the trap is created)\. (?:The|This) [\w' -]+? rolls initiative and remains for (\d+d\d+|\d+) (rounds?|minutes?)\b`).exec(plain);
        if (!rune) return null;
        const unit = /^minute/.test(rune[5]) ? "minutes" : "rounds";
        const lasts = /d/.test(rune[4]) ? { ...lasting(null, unit), formula: rune[4] } : lasting(Number(rune[4]), unit);
        const creature = { name: rune[1] ? titled(rune[1]) : "Summoned creature", count: 1, size: null, stats: null, from: rune[1] ? creatureOf(html, rune[1]) : null, traits: ["summoned"], initiative: "roll" };
        return { builtin: "conjure", actions, creatures: [creature], ...(rune[1] ? {} : { pick: { level: Number(rune[2] ?? rune[3]), when: "placed" } }), lasts, vanishAtZero: true, notes: ["It has 3 actions a round and can use reactions.", "It also goes if the trap is disabled first (Dismiss)."] };
    }

    // Summon Steed: "The dullahan summons a war horse with elite adjustments and the fiend and unholy traits. This steed remains until it is
    // slain, the dullahan Dismisses this effect, or the dullahan Summons a Steed again."
    match = new RegExp(String.raw`^${SELF} summons an? ([A-Za-z][\w' -]+?)( with elite adjustments)?(?: and the (\w+)(?: and (\w+))? traits?)?\. This steed remains until it is slain, .+? Dismisses (?:it|this effect), or .+? (?:summons another steed|Summons a Steed again)\.$`).exec(plain);
    if (match) {
        const traits = [match[3], match[4]].filter(Boolean).map((trait) => trait.toLowerCase());
        return { builtin: "conjure", actions, creatures: [{ name: titled(match[1]), count: 1, size: null, stats: null, from: creatureOf(html, match[1]), ...(match[2] ? { adjust: "elite" } : {}), traits: [...traits, ...SUMMONED] }], max: 1, lasts: null, vanishAtZero: true, notes: ["It stays until slain or dismissed; summoning another sends the first away."] };
    }

    // Phantom Mount: "The graveknight summons a supernatural mount as per Marvelous Mount, heightened to a level equal to half the graveknight's
    // level. … the steed's AC and saving throw bonuses are all 4 lower than the graveknight's, and the steed has one-third the graveknight's Hit
    // Points", its numbers given first; Marvelous Mount's Speeds at that rank.
    if (/\bsummons a supernatural mount,? as (?:per )?Marvelous Mount\b/.test(plain)) {
        const rank = Number(new RegExp(String.raw`\b${ORDINAL} rank\b|\(${ORDINAL} level\)|\(rank (\d+)\)`).exec(plain)?.slice(1).find(Boolean)) || (/\bhalf (?:the|its|his|her) [\w' ]*?level\b/.test(plain) && Number.isFinite(level) ? Math.max(1, Math.floor(level / 2)) : null);
        const given = statLine(plain);
        const named = /^[A-Z][\w'-]+(?: [A-Z][\w'-]+)?['’]s mount is an? ([\w -]+?) \([^)]*\) named ([A-Z][\w'-]+)\./.exec(plain);
        const stats = given ? { ...given, speeds: mountSpeeds(rank ?? 2) } : { maker: { ac: -4, saves: -4, hp: 1 / 3 }, speeds: mountSpeeds(rank ?? 2) };
        return { builtin: "conjure", actions, creatures: [{ name: named ? named[2] : item.name, count: 1, size: "large", stats, from: null, traits: SUMMONED }], max: 1, lasts: null, vanishAtZero: true, notes: [`Marvelous Mount at rank ${rank ?? "its own"}${named ? `: a ${named[1]}` : ""}; its rider's minion.`, "If the steed is destroyed, it can't do this again for an hour."] };
    }

    // Final Spite's horn: "The unnerving blast summons reinforcements, raising 1d4 corpses in a 200-foot emanation as Wights."
    match = new RegExp(String.raw`^Trigger ${SELF} is reduced to 0 Hit Points\.? Effect .*?\bsummons reinforcements, raising (\d+d\d+|\d+) corpses in an? (\d+)-foot emanation as ([A-Z][\w' -]+?)\.$`).exec(plain);
    if (match) {
        return { builtin: "conjure", actions: 0, trigger: { event: "death", reaction: true }, creatures: [{ name: titled(match[3]).replace(/s$/, ""), count: /d/.test(match[1]) ? { formula: match[1] } : Number(match[1]), size: null, stats: null, from: creatureOf(html, match[3]), initiative: "roll" }], needs: `corpses within ${match[2]} feet (as many as there are, up to the roll)`, lasts: null, notes: ["Move each one onto a corpse it raised."] };
    }

    // A creature from its remains as it falls: "A Weakened Cobbleswarm spawns in the space the cobbled bruiser previously occupied, or the
    // nearest adjacent space".
    match = new RegExp(String.raw`^Trigger ${SELF} is reduced to 0 Hit Points\.? Effect An? ([A-Z][\w' -]+?) spawns in the space (?:the [\w' -]+?|it) previously occupied\b`).exec(plain);
    if (match) {
        return { builtin: "conjure", actions: 0, trigger: { event: "death", reaction: true }, creatures: [{ name: titled(match[1]), count: 1, size: null, stats: null, from: creatureOf(html, match[1]), initiative: "maker" }], at: "maker", lasts: null, notes: [] };
    }

    // Undead, Arise!: "summons two Medium undead entities in different empty squares up to 30 feet away. These undead entities can take the
    // form of zombies, skeletons, or ghosts … Each entity has 1 Hit Point and the same AC and saves as the necromancer. They can't take
    // actions of their own and deteriorate if the necromancer is reduced to 0 Hit Points. The necromancer can have up to four undead entities"
    match = /\bsummons (\w+) (Tiny|Small|Medium|Large) undead entities in different empty squares up to (\d+) feet away\. These undead entities can take the form of ([a-z]+), ([a-z]+), or ([a-z]+), chosen by .+?\. .*?Each entity has (\d+) Hit Points? and the same AC and saves as .+?\. They can't take actions of their own and deteriorate if .+? is reduced to 0 Hit Points\. .+? can have up to (\w+) undead entities at any given time\./.exec(plain);
    if (match && count(match[1]) && count(match[8])) {
        const entity = (form) => ({ label: titled(form), creatures: [{ name: `Undead Entity (${titled(form).replace(/s$/, "")})`, count: count(match[1]), size: match[2].toLowerCase(), stats: { hp: Number(match[7]), maker: { ac: 0, saves: 0 } }, from: null, traits: ["undead"] }] });
        return { builtin: "conjure", actions, creatures: [], options: [match[4], match[5], match[6]].map(entity), max: count(match[8]), oldest: true, endsWithMaker: true, vanishAtZero: true, lasts: null, notes: ["They block movement and can be attacked, but take no actions; the oldest go past the limit."] };
    }

    // Raise Serpent: "animates corpses of snakes, serpentfolk, or similar serpentine creatures within a 30-foot emanation. … can raise one Large
    // creature as a Skeletal Giant or up to three Medium creatures as Skeletal Champions … These skeletons have the minion trait … Any skeletal
    // minions that still remain after 10 minutes crumble to dust."
    match = /\banimates corpses of (.+?) within an? (\d+)-foot emanation\. .*?\bcan raise one Large creature as an? ([A-Z][\w' -]+?) or up to (\w+) Medium creatures as ([A-Z][\w' -]+?)[;.].*?\bremain after (\d+) minutes crumble\b/.exec(plain);
    if (match && count(match[4])) {
        const big = { label: `1 ${match[3]}`, creatures: [{ name: titled(match[3]), count: 1, size: null, stats: null, from: creatureOf(html, match[3]), traits: ["minion"] }] };
        const small = Array.from({ length: count(match[4]) }, (_unused, index) => ({ label: `${index + 1} ${index ? match[5] : match[5].replace(/s$/, "")}`, creatures: [{ name: titled(match[5]).replace(/s$/, ""), count: index + 1, size: null, stats: null, from: creatureOf(html, match[5]), traits: ["minion"] }] }));
        return { builtin: "conjure", actions, creatures: [], options: [big, ...small], needs: `corpses of ${match[1]} within ${match[2]} feet`, lasts: lasting(Number(match[6])), notes: ["Once a day. One command to all of them is a single action (concentrate). Move each onto a corpse it raised."] };
    }

    // Spider Minions: "The morrigna summons a Giant Tarantula or Spider Swarm. These spiders have the summoned trait and remain for 10 minutes or
    // until reduced to 0 Hit Points".
    match = new RegExp(String.raw`^${SELF} summons an? ([A-Z][\w' -]+?) or (?:an? )?([A-Z][\w' -]+?)\. These \w+ have the summoned trait and remain for (\d+) minutes or until reduced to 0 Hit Points\b`).exec(plain);
    if (match) {
        const one = (name) => ({ label: titled(name), creatures: [{ name: titled(name), count: 1, size: null, stats: null, from: creatureOf(html, name), traits: SUMMONED }] });
        return { builtin: "conjure", actions, creatures: [], options: [one(match[1]), one(match[2])], lasts: lasting(Number(match[3])), vanishAtZero: true, notes: ["It directs them without Sustaining, and can have any number of them; it sees through their eyes."] };
    }

    // Summon Aquatic Ally: "casting a 2nd-rank Summon Animal spell. The triton can summon only an aquatic creature … This creature remains until
    // it is slain, the triton Dismisses it, or the triton summons another ally."
    match = new RegExp(String.raw`\bcasting an? ${ORDINAL}-rank Summon (Animal|Fey|Plant or Fungus|Undead|Elemental|Fiend|Celestial|Monitor|Construct|Entity|Dragon|Giant) spell\. .+? can summon only an? ([a-z]+) creature\b.*?This creature remains until it is slain, .+? Dismisses it, or .+? summons another (?:ally|creature)\.`).exec(plain);
    if (match && SUMMON_LEVELS[Number(match[1])] !== undefined) {
        return { builtin: "conjure", actions, creatures: [{ name: "Summoned creature", count: 1, size: null, stats: null, from: null, traits: SUMMONED }], pick: { any: match[2].toLowerCase().split(" or "), all: [match[3]], maxLevel: SUMMON_LEVELS[Number(match[1])] }, max: 1, lasts: null, vanishAtZero: true, notes: [`Summon ${match[2]} at rank ${match[1]}, ${match[3]} creatures only. It stays until slain or dismissed; another sends the first away.`] };
    }

    // A summon heightened by the damage it took (batch 297, the matrona's fey): a reaction to that much damage at once that casts a summon spell
    // a rank higher for each further step of damage, up to a top rank; its creatures last a while and only so many at once, the oldest going.
    match = new RegExp(String.raw`^Trigger ${SELF} takes (\d+) or more damage from a single attack or effect;? Effect .*?\bcasts an? ${ORDINAL}-level Summon (Fey|Animal|Undead|Elemental|Fiend|Celestial) spell\. For every additional (\d+) damage .+? heightened by 1 spell level, up to ${ORDINAL} level\. .*?\blasts for (\d+) minutes? or until it is banished\b.*?\bmore than (\w+) summoned \w+ simultaneously\b`).exec(plain);
    if (match && count(match[7])) {
        return { builtin: "conjure", actions: 0, trigger: { event: "damaged", reaction: true, min: Number(match[1]) }, creatures: [{ name: "Summoned creature", count: 1, size: null, stats: null, from: null, traits: SUMMONED }], pick: { any: [match[3].toLowerCase()], rank: { base: Number(match[2]), from: "damage", over: Number(match[1]), per: Number(match[4]), max: Number(match[5]) } }, max: count(match[7]), oldest: true, lasts: lasting(Number(match[6])), vanishAtZero: true, notes: ["No Sustaining; each has two actions. The oldest goes past the limit."] };
    }

    // Phantasms (batch 297, the fragmentor's): one beside it (two on a critical failure), Medium, shaped like the creature that failed its save,
    // acting just before or after it; they only fly, at its AC and saves, last a minute, and only so many at once.
    match = /\bcreates a (\w+) \(two \w+ if the triggering creature critically failed\) in an unoccupied square within (\d+) feet\. \w+ are (Tiny|Small|Medium|Large)\b.*?\bresemble the form of the triggering creature\b.*?\btaking their turns either immediately before or after\b.*?\bhave a fly speed of (\d+) feet, and their saving throw modifiers and AC are equal to\b.*?\bafter (\d+) minutes? passes\b.*?\bat most (\w+) \w+ at a time\b/.exec(plain);
    if (match && count(match[6])) {
        const phantasm = (many) => ({ label: many === 1 ? `1 ${match[1]}` : `${many} ${match[1]}s (a critical failure)`, creatures: [{ name: titled(match[1]), count: many, size: match[3].toLowerCase(), stats: { hp: 1, speeds: { fly: Number(match[4]) }, maker: { ac: 0, saves: 0 } }, from: null, look: "target", initiative: "maker" }] });
        return { builtin: "conjure", actions: 0, creatures: [], options: [phantasm(1), phantasm(2)], max: count(match[6]), lasts: lasting(Number(match[5])), endsWithMaker: true, vanishAtZero: true, notes: ["Target the creature it copies. Two actions a turn, only to Fly; they flank and block. One goes when hit or when it fails a save, or more than 100 feet away."] };
    }

    // Statues of its victims (batch 297, the rictus mask's): two Medium objects beside it with their own AC and Hit Points and its saves; using it
    // again turns the old ones to dust.
    match = /\bcreates (\w+) (Tiny|Small|Medium|Large) statues within (\d+) feet\. .*?\bobjects with object immunities, (\d+) Hit Points, and (\d+) AC; for all other defensive statistics, they use\b.*?\bpreviously created turn to dust\b/.exec(plain);
    if (match && count(match[1])) {
        return { builtin: "conjure", actions, creatures: [{ name: "Statue", count: count(match[1]), size: match[2].toLowerCase(), stats: { ac: Number(match[5]), hp: Number(match[4]), maker: { saves: 0 } }, from: null }], max: count(match[1]), lasts: null, vanishAtZero: true, notes: ["Objects, with object immunities; each looks like a creature it has damaged. Using it again turns the old ones to dust."] };
    }

    // Another of itself (batch 297): "It causes another nonsequitaur to spontaneously come into being in an unoccupied space within 60 feet."
    match = /\bcauses another ([\w' -]+?) to spontaneously come into being in an unoccupied space within (\d+) feet\b/.exec(plain);
    if (match) {
        return { builtin: "conjure", actions, creatures: [{ name: titled(match[1]), count: 1, size: null, stats: null, from: { self: true }, initiative: "roll" }], lasts: null, notes: [`Anywhere within ${match[2]} feet; the new one can do it too.`] };
    }

    // A guardian with another creature's statistics (batch 297, the toyblox's): PF2e's creature by name, sustained for up to a minute; when it
    // falls, its maker takes the damage the text gives.
    match = new RegExp(String.raw`\bconjures an? ([a-z][\w' -]+?), which uses the statistics of (?:an? )?([a-z][\w' -]+?)\. It can Sustain the [\w' -]+? for up to (\d+) minutes?\.(?:.*?\bIf the [\w' -]+? is reduced to 0 Hit Points, ${SELF} takes (\d+)(?: \w+)? damage\b)?`).exec(plain);
    if (match) {
        return { builtin: "conjure", actions, creatures: [{ name: titled(match[1]), count: 1, size: null, stats: null, from: creatureOf(html, match[2]), traits: SUMMONED }], max: 1, lasts: lasting(Number(match[3])), vanishAtZero: true, ...(match[4] ? { makerDamage: Number(match[4]) } : {}), notes: ["Sustained, up to the time."] };
    }

    // A named creature sustained (batch 297, the xenarian's): one by name, on its side, sustained for up to a minute.
    match = /\bsummons an? ([a-z][\w' -]+?) to fight on (?:their|its|his|her) side\b.*?\bSustain the summon for up to (\d+) minutes?\b/.exec(plain);
    if (match) {
        return { builtin: "conjure", actions, creatures: [{ name: titled(match[1]), count: 1, size: null, stats: null, from: creatureOf(html, match[1]), traits: SUMMONED }], lasts: lasting(Number(match[2])), vanishAtZero: true, notes: ["Sustained, up to the time."] };
    }

    // Splinter Sycophant: "Trigger The adachros takes 25 or more bludgeoning, piercing, or slashing damage Effect … animates into an Ioton with
    // the minion trait under the adachros's control. The ioton sycophant can't move more than 120 feet from the adachros and crumbles after 1
    // minute."
    match = new RegExp(String.raw`^Trigger ${SELF} takes (\d+) or more ([a-z, ]+?) damage\.? Effect .*?\banimates into an? ([A-Z][\w' -]+?) with the minion trait under .+?['’]s? control\. .*?can't move more than (\d+) feet from .+? and crumbles after (\d+) minutes?\.`).exec(plain);
    if (match) {
        const damageTypes = [...match[2].matchAll(/\b(bludgeoning|piercing|slashing|fire|cold|acid|electricity|sonic|force|mental|poison|vitality|void|spirit)\b/g)].map((entry) => entry[1]);
        const praise = /@UUID\[(Compendium\.[\w-]+\.[\w-]+\.Item\.[A-Za-z0-9]{16})\]\{(Effect: [^}]+)\}/.exec(html);
        return { builtin: "conjure", actions: 0, trigger: { event: "damaged", reaction: true, min: Number(match[1]), ...(damageTypes.length ? { damageTypes } : {}) }, creatures: [{ name: titled(match[3]), count: 1, size: null, stats: null, from: creatureOf(html, match[3]), traits: ["minion"] }], lasts: lasting(Number(match[5])), vanishAtZero: true, notes: [`It stays within ${match[4]} feet of its maker.`, ...(praise ? [`Given no other command, it praises its maker: ${praise[2]} on it, and the temporary Hit Points rolled.`] : [])] };
    }

    // Awaken Tree: "causes a tree within 180 feet to uproot itself and fight as a minion using the statistics for an Awakened Tree. … can
    // control up to two awakened trees at a time"; a dead one's, with the husk trait.
    match = /\bcauses an? (dead )?tree within (\d+) feet to uproot itself and fight as a minion using the statistics for an? ([A-Z][\w' -]+?)(?: with the (\w+) trait)?\. .*?\bcan control up to (\w+) [\w ]+? at a time\b/.exec(plain);
    if (match && count(match[5])) {
        return { builtin: "conjure", actions, creatures: [{ name: titled(match[3]), count: 1, size: null, stats: null, from: creatureOf(html, match[3]), traits: ["minion", ...(match[4] ? [match[4].toLowerCase()] : [])] }], needs: `a ${match[1] ?? ""}tree within ${match[2]} feet`, max: count(match[5]), lasts: null, notes: ["Move it onto the tree it awakened. One command to all of them is a single action (concentrate, auditory)."] };
    }
    return null;
}
