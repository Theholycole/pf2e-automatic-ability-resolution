// Monster abilities the simulator plays as rules of its own ({ builtin }),
// not as plans: they change Strikes, saves or a creature's turn rather than
// resolving a check against a target.
//
// - strike-extra: extra Strike damage under a condition (Sneak Attack against
//   an off-guard target, Pack Attack, dice against the living or the undead),
//   from the item's DamageDice rules
// - save-bonus: bonuses to saves against magic, a tradition or a trait, from FlatModifier rules
// - regeneration and fast-healing, from the FastHealing rule
// - multi-strike: "makes two Fangs Strikes and one Tail Strike" (Draconic Frenzy)
// - charge: "Strides and makes a Strike at the end of that movement" (Pounce)
// - momentum: recharges a breath weapon on a critical hit (Draconic Momentum)
// - reactions: ac-reaction (Nimble Dodge, Retract Body), attack-misfortune
//   (Challenge Fate), reaction-strike on a move (Twisting Tail), death-strike (Death Frenzy)

import { htmlToPlainText } from "../../../pf2e-resolution-core/src/text/plain-text.js";
import { readableText } from "./inline.js";

const NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4 };

// DamageDice predicates the simulator can judge, as the condition it checks.
const EXTRA_WHEN = new Map([
    ["target:condition:off-guard", "off-guard"],
    ["pack-attack", "pack"],
    ["target:mode:living", "living"],
    ["target:mode:undead", "undead"],
    ["target:condition:frightened", "frightened"]
]);

function strikeExtras(item) {
    const extras = [];
    for (const rule of item?.system?.rules ?? []) {
        if (rule?.key !== "DamageDice" || !/(^|,)strike-damage$/.test(String(rule.selector ?? ""))) continue;
        const predicate = rule.predicate ?? [];
        if (predicate.length !== 1 || typeof predicate[0] !== "string" || !EXTRA_WHEN.has(predicate[0])) continue;
        const dice = Number(rule.diceNumber);
        const die = Number(String(rule.dieSize ?? "").replace(/^d/, ""));
        if (!Number.isFinite(dice) || dice <= 0 || !Number.isFinite(die) || die <= 0) continue;
        extras.push({ when: EXTRA_WHEN.get(predicate[0]), dice, die, precision: rule.category === "precision", type: rule.damageType ?? null });
    }
    return extras;
}

// FlatModifier rules on saves with a predicate the simulator can test against
// the source of an effect (its traits, tradition and whether it's magical).
function saveBonuses(item) {
    const bonuses = [];
    for (const rule of item?.system?.rules ?? []) {
        if (rule?.key !== "FlatModifier") continue;
        const selectors = [].concat(rule.selector ?? []);
        const saves = selectors.flatMap((selector) => (selector === "saving-throw" ? ["fortitude", "reflex", "will"] : ["fortitude", "reflex", "will"].includes(selector) ? [selector] : []));
        const value = Number(rule.value);
        if (!saves.length || !Number.isFinite(value) || !rule.predicate?.length) continue;
        bonuses.push({ saves: [...new Set(saves)], value, type: rule.type ?? "untyped", predicate: rule.predicate });
    }
    return bonuses;
}

// "The frost drake makes two Fangs Strikes and one Tail Strike in any order." → ["fangs", "fangs", "tail"].
// Also "…and one horn Strike. They can make these Strikes in any order." and "…, which they can make in any order."
export function readMultiStrike(text) {
    return readMultiStrikes(text)?.strikes ?? null;
}

// The same, with what the sentences after it say (2026-10-10): { strikes, sameMap, sameTarget } or null.
//   "The Iroran skeleton makes two claw Strikes. If both hit the same creature, the damage is combined …. The multiple
//   attack penalty applies to the Strikes as normal."
//   "The dragon makes one claw Strike and one tail Strike in either order."
//   "The captain makes two Strikes, one with their rapier and one with their dagger."
//   "The deghuun makes three tentacle Strikes, each against a different creature within reach."
//   "… makes three claw Strikes against a single creature within reach. His multiple attack penalty doesn't increase
//   until after he makes all three Strikes."
// A Strike with no name ("two unarmed Strikes", "two Strikes") is null: the creature's best melee Strike.
export function readMultiStrikes(text) {
    // "Frequency once per turn Effect The bruiser makes …": once a turn; a longer frequency or a requirement: not read.
    // (Links as their labels, batch 23: "can attempt to @UUID[…]{Grab} the target" read as "Grab".)
    let body = String(text).replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").trim();
    let oncePerTurn = false;
    // (Batch 42: what it wields, "Requirements The test slayer is wielding two melee weapons, each in a different hand Effect".)
    body = body.replace(/(^|Frequency once per (?:turn|round) )Requirements? (?:The |You )?[^.]+? (?:is wielding|are wielding|wields) two melee weapons, each in a different hand\.? Effect /i, (_all, before) => (before ? `${before}Effect ` : ""));
    const frequency = /^Frequency (.+?) Effect /i.exec(body);
    if (frequency) {
        if (!/^once per (?:turn|round)$/i.test(frequency[1].trim())) return null;
        oncePerTurn = true;
        body = body.slice(frequency[0].length);
    }
    if (/^(?:Requirements?|Trigger|Prerequisites?)\b/i.test(body)) return null;
    const sentences = body.replace(/,? which (?:it|they) can make in any order\./i, ".").split(/(?<=\.)\s+(?=[A-Z])/);
    // (Batch 42: a first sentence that only tells what it does, "The test slayer swiftly attacks their prey with both weapons,
    // potentially combining their damage into a single devastating attack.")
    if (sentences.length > 1 && !/^(?:Frequency|Requirements?|Trigger|Prerequisites?)\b/i.test(sentences[0]) && !/\bStrikes?\b|\d|@|\b(?:save|DC|damage|bonus|penalty|Grab|Grabbed|Prone|Stunned|Frightened|condition)\b/i.test(sentences[0].replace(/, potentially combining their damage into a single devastating attack\.$/i, ".")) && /\bStrikes\b/.test(sentences[1])) sentences.shift();
    let first = sentences.shift() ?? "";
    let sameMap = false;
    let sameTarget = false;
    let grab = false;
    // (Batch 30: the first sentence's extras, taken out: "at a -2 penalty" (each Strike's), "at any point during that movement"
    // (Flying Strafe), "within the shortbow's first range increment", "; no more than two can be against the same target",
    // "against a creature it has Grabbed" (a requirement), "attempts", no final period.)
    let penalty = 0;
    let requires = null;
    first = first.trim().replace(/([^.])$/, "$1.")
        .replace(/\b(attempts|attempt)\b(?= (?:up to )?(?:a|an|one|two|three|four) )/i, "makes")
        .replace(/,? (?:each )?at an? [-\u2013\u2212](\d+) penalty(?: to (?:its|their|the) attack rolls?)?/i, (_all, value) => {
            penalty = Number(value);
            return "";
        })
        .replace(/ at any point during (?:that|its|their|the) movement/i, "")
        // (Batch 42: "two fist Strikes, applying her multiple attack penalty as normal", "two Strikes, each of which must be an unarmed
        // Strike or temple bell Strike", "two unarmed Strikes, or one unarmed Strike and a dueling pistol Strike": its best melee
        // Strikes; "thrashes wildly with its wings, making wing Strikes against up to three adjacent foes".)
        .replace(/, applying (?:its|their|his|her) multiple attack penalty as normal(?=\.$)/i, "")
        .replace(/, each of which must be an? [\w' -]+? Strike or (?:an? )?[\w' -]+? Strike(?=\.$)/i, "")
        .replace(/(Strikes), or one [\w' -]+? Strike and an? [\w' -]+? Strike(?=\.$)/i, "$1")
        .replace(/, making ([\w' -]+? Strikes against )/i, " and makes $1")
        .replace(/ (?:within|in) (?:the|its|their|his|her) [\w' -]+?(?:'s)? first range increment/i, "")
        .replace(/; no more than (?:two|one) can be against the same target/i, "")
        .replace(/ against (?:a|the) creature (?:it|they|he|she) (?:has|have) Grabbed(?: or Restrained)?/i, () => {
            requires = "grabbed";
            sameTarget = true;
            return "";
        });
    const after = [];
    const strikes = [];
    const count = (word) => NUMBERS[String(word).toLowerCase()] ?? 0;
    // "scimitar or fangs": the first; "melee", "unarmed", "ranged" or none: the best (null).
    const named = (name) => {
        const plain = String(name ?? "").trim().replace(/\s+or\s+.*$/i, "");
        if (!plain || /^(?:melee|unarmed|ranged|weapon|melee weapon)(?: (?:strikes|attacks))?$/i.test(plain)) return null;
        // "ranged oathbow", "melee echoblade": the Strike's own name.
        return plain.replace(/^(?:melee|ranged)\s+/i, "").toLowerCase();
    };
    // Who they're against: "against the same target", "all targeting the same creature", "each against a different creature".
    const WHO = String.raw`(?:,? (?:each |all |both )?(?:against|targeting) (?:a|an|one|the|two|different|single) (?:single |same |different |adjacent )?(?:creature|target|foe|enemy|enemies|targets|creatures)s?(?: (?:within|in) (?:(?:its|their|his|her) )?reach)?)?`;
    let match;
    // Against different creatures ("up to four tentacle Strikes, each against a different target", "tail Strikes against two
    // different creatures within reach"): a Strike at each of that many enemies in its Melee (2026-10-10).
    let each = false;
    if ((match = new RegExp(String.raw`^(?:The )?[^.]+? makes (?:up to )?(a|an|one|two|three|four) (?:([\w' -]+?) )??Strikes?(?: and (a|an|one|two|three) ([\w' -]+?) Strikes?)?(?: with (?:its|their|his|her) ([\w' -]+?))?(?: in (?:any|either) order)?(${WHO})(?:,? one (?:Strike )?(?:with each of (?:its|their|his|her) [\w' -]+|per weapon))?\.$`, "i").exec(first))) {
        for (const [number, name] of [[match[1], match[2] ?? match[5]], [match[3], match[4]]]) for (let index = 0; index < count(number ?? 0); index++) strikes.push(named(name));
        if (/single|same|one (?:creature|target|foe|enemy)/i.test(match[6] ?? "")) sameTarget = true;
        if (/different|two (?:creatures|targets|foes|enemies)/i.test(match[6] ?? "")) each = true;
    } else if ((match = /^(?:The )?[^.]+? makes (?:(two|three|four) )?(?:([\w' -]+?) )??Strikes(?: with (?:its|their|his|her) ([\w' -]+?))? against (two|three|four|up to two|up to three) (?:different |adjacent )?(?:creatures|foes|enemies|targets)(?:,? (?:both|all|each) of (?:whom|which) (?:are|is|must be) (?:within|in) (?:(?:its|their|his|her) )?reach| (?:within|in) (?:(?:its|their|his|her) )?reach)?\.$/i.exec(first))) {
        // "The emperor bird makes tail Strikes against two different creatures within reach", "makes two Strikes with its claw
        // against two adjacent foes, both of whom are within its reach".
        const number = count(match[1] ?? match[4].replace(/^up to /i, ""));
        for (let index = 0; index < number; index++) strikes.push(named(match[2] ?? match[3]));
        each = true;
    } else if ((match = /^(?:The )?[^.]+? makes? one Strike with each of (?:its|their|his|her) (two|three) (?:melee )?weapons(?:, (?:both|all) against the same (?:target|creature))?\.$/i.exec(first))) {
        // "They make one Strike with each of their two melee weapons, both against the same target": its best melee Strikes.
        for (let index = 0; index < count(match[1]); index++) strikes.push(null);
        if (/same (?:target|creature)/i.test(first)) sameTarget = true;
    } else if ((match = /^(?:(?:The )?[^.]+? makes?|Make) two Strikes against (?:(?:its|their|his|her|your) (?:hunted prey|target)|a creature|[^.]+?'s hunted prey), one with each of the required weapons\.$/i.exec(first))) {
        // (Twin Takedown, batch 42: "They make two Strikes against their hunted prey, one with each of the required weapons": its best
        // melee Strikes, at one creature.)
        strikes.push(null, null);
        sameTarget = true;
    } else if ((match = /^(?:The )?[^.]+? makes (two) Strikes(?: against the same target)?, one with (?:its|their|his|her) ([\w' -]+?) and (?:one|the other) with (?:its|their|his|her) ([\w' -]+?)\.$/i.exec(first))) {
        strikes.push(named(match[2]), named(match[3]));
        if (/same target/i.test(first)) sameTarget = true;
    } else if ((match = /^(?:The )?[^.]+? makes (two|three|four) ([\w' -]+?) Strikes, ignoring the multiple attack penalty until after (?:both|all|the (?:second|last)) (?:Strikes|attacks|Strike|attack)\.$/i.exec(first)) || (match = /^(?:The )?[^.]+? makes (one|a) ([\w' -]+?) Strike and (?:one|a) ([\w' -]+?) Strike, ignoring the multiple attack penalty until after (?:both|the second) (?:Strikes|Strike)\.$/i.exec(first))) {
        if (match[3]) strikes.push(named(match[2]), named(match[3]));
        else for (let index = 0; index < count(match[1]); index++) strikes.push(named(match[2]));
        sameMap = true;
    } else return null;
    if (strikes.length < 2) return null;
    // What may follow: the order, the attack penalty, damage combined against resistances, who it's against.
    for (const sentence of sentences) {
        if (/^(?:It|They|He|She) can make (?:these|the|them|those)(?: (?:Strikes|attacks))?(?: in any order)?\.$/i.test(sentence)) continue;
        if (/\bmultiple attack penalty\b[^.]*\b(?:doesn't|does not) increase until\b|\bmultiple attack penalty increases only after\b|\bpenalty (?:doesn't|does not) increase until\b|\bpenalty increases only after\b|\buses? the same multiple attack penalty as the first\b|\beach using the [\w' -]+?'s current multiple attack penalty\b/i.test(sentence) && !/-\d+|–\d+/.test(sentence)) {
            sameMap = true;
            continue;
        }
        if (/\bmultiple attack penalty\b[^.]*\b(?:as normal|normally)\b|\bcount(?:s)? toward (?:its|their|his|her|the [\w' -]+?'s) multiple attack penalty(?: as normal)?\.$|^Apply the multiple attack penalty to these Strikes normally\.$/i.test(sentence)) continue;
        // Damage combined against resistances, and nothing more ("…, and the creature must succeed at a save" isn't).
        if (/\bcombine(?:s|d)? (?:their|the) damages?\b|\bdamage is combined\b/i.test(sentence) && !/\b(?:save|must|condition|additional|extra|takes?|Grabbed|Prone|Stunned)\b/i.test(sentence.replace(/\bapply (?:resistances|weaknesses)[^.]*/i, ""))) continue;
        if (/^Each (?:Strike|attack) must target a different creature\.$/i.test(sentence)) {
            each = true;
            continue;
        }
        // (Batch 30: Flurry of Blows' "As it has the flourish trait, … only once per turn", its substitutions (a note), "The attacks
        // take the normal multiple attack penalty", "The multiple attack penalty applies to each attack, but increases only after
        // …", "Both Strikes use the ranger's current multiple attack penalty, but each strike takes a –2 penalty", Frenzied
        // Slashes' "The pusk gains the Clumsy 2 condition until the beginning of its next turn".)
        if (/\bonly once per (?:turn|round)\.$/i.test(sentence)) {
            oncePerTurn = true;
            continue;
        }
        if (/\bcan substitute any number of the attacks with\b/i.test(sentence)) continue;
        if (/^(?:Each attack takes|The attacks take|Both attacks take) the normal multiple attack penalty\.$/i.test(sentence)) continue;
        if (/\bmultiple attack penalty applies to each attack, but increases only after\b/i.test(sentence)) {
            sameMap = true;
            continue;
        }
        if ((match = /^Both Strikes uses? (?:the [\w' -]+?'s|its|their|his|her) current multiple attack penalty, but each strike takes an? [-\u2013\u2212](\d+) penalty\.$/i.exec(sentence))) {
            sameMap = true;
            penalty = Number(match[1]);
            continue;
        }
        if ((match = /^(?:The [\w' -]+?|It|They|He|She) gains? the (\w+) (\d+) condition until the (?:beginning|start) of (?:its|their|his|her) next turn\.$/i.exec(sentence))) {
            after.push({ slug: match[1].toLowerCase(), value: Number(match[2]), until: "own-turn-start" });
            continue;
        }
        if (/^Both (?:Strikes|attacks) must (?:have|target) the same (?:target|creature)\.$/i.test(sentence)) {
            sameTarget = true;
            continue;
        }
        // "If either Strike hits, the dragon can attempt to Grab the target with that limb as a free action." (and how many it can
        // hold): Grab after a hit.
        if (/^If (?:either|any|both|one) (?:of the )?(?:Strikes?|attacks?) hits?, (?:it|they|he|she|the [\w' -]+?) (?:can (?:attempt to )?Grab the (?:target|creature)(?: with (?:that|the) [\w ]+?)? as a free action|automatically Grabs the (?:target|creature))\.$/i.test(sentence)) {
            grab = true;
            continue;
        }
        if (grab && /^(?:It|They|He|She|The [\w' -]+?) can have up to (?:two|three|four|\w+) creatures Grabbed\b/i.test(sentence)) continue;
        return null;
    }
    // (A Strike at each of several creatures: all with its first Strike.)
    if (each && new Set(strikes).size > 1) return null;
    return { strikes, sameMap, sameTarget, oncePerTurn, ...(each ? { each: true, max: strikes.length } : {}), ...(grab ? { grab: true } : {}), ...(penalty ? { penalty } : {}), ...(requires ? { requires } : {}), ...(after.length ? { after } : {}) };
}

// One attack roll against several foes' AC (Swipe, Wide Swing; 2026-10-10): "The veteran makes a melee Strike and compares the
// attack roll result to the AC of up to two foes, each of whom must be within their melee reach and adjacent to each other. Roll
// damage only once and apply it to each creature hit. A Swipe counts as two attacks for the veteran's multiple attack penalty."
// → { strike, max }, or null.
export function readSwipe(text) {
    const sentences = text.trim().split(/(?<=\.)\s+(?=[A-Z])/);
    // (Batch 42: a first sentence that only tells what it does, "The test draugr lashes out at every foe it can reach.")
    if (sentences.length > 1 && !/\bStrikes?\b|\d|@/.test(sentences[0]) && /\bcompares the attack roll\b/i.test(sentences[1])) sentences.shift();
    // (Batch 38, Wide Swing: "makes a single greataxe Strike and compares the attack roll result to the ACs of up to two foes within
    // its reach"; batch 42: "within the guard captain's melee reach and adjacent to the other".)
    const match = /^(?:The )?[^.]+? makes (?:a single |an? )(?:([\w' -]+?) )??Strike and compares the attack roll(?: result)? to the (?:AC|ACs|Armor Class) of up to (two|three) (?:foes|enemies|creatures|targets)(?:, each of whom must be within (?:its|their|his|her|the Strike's|the [\w' -]+?'s) (?:melee )?reach(?: and adjacent to (?:each other|the other))?| within (?:its|their|his|her) reach)?\.$/i.exec(sentences.shift() ?? "");
    if (!match) return null;
    for (const sentence of sentences) {
        if (/^(?:Roll|(?:It|They|He|She) rolls?) (?:the )?damage (?:only )?once(?:,)? and appl(?:y|ies) it to each creature (?:hit|(?:it|they|he|she|the [\w' -]+?) hits?)\.$/i.test(sentence)) continue;
        if (/^(?:(?:An?|The|This) )?(?:[\w' -]+? )?counts as (?:two|three) attacks (?:for|when calculating|toward) [^.]*multiple attack penalty(?:, (?:but|though) the penalty (?:does not|doesn't) increase until after (?:both|all) attacks are resolved)?\.$/i.test(sentence)) continue;
        // (The sweep trait's +1 on the second: the simulation's numbers leave it out.)
        if (/^The (?:modifier of a weapon with a sweep trait|sweep bonus of (?:the [\w' -]+?'s|its|their|his|her) [\w' -]+?) applies to (?:all|these|both) attacks\.$/i.test(sentence)) continue;
        return null;
    }
    const strike = match[1] && !/^(?:melee|weapon|unarmed)$/i.test(match[1]) ? match[1].replace(/^(?:melee|ranged)\s+|\s+(?:melee|ranged)$/gi, "").toLowerCase() : null;
    return { strike, max: NUMBERS[match[2].toLowerCase()] };
}

// "The guard Strides twice. If it ends its movement within melee reach of at least one enemy, it makes a melee Strike against
// that enemy." (Sudden Charge; 2026-10-10) → "The guard Strides twice and makes a melee Strike." for the charge readers.
export function chargeSentences(text) {
    // (Batch 42: "They Stride or Swim twice; if they end their movement …, they can make a melee Strike against it.")
    return String(text).replace(/\b(Strides? twice|Strides? or Swims? twice|Strides up to (?:double|twice) (?:its|their|his|her) Speed|Flies twice|Flies up to (?:double|twice) (?:its|their|his|her) (?:fly )?Speed)[.;]\s+[Ii]f (?:it|they|he|she|the [\w' -]+?) ends? (?:its|their|his|her) movement (?:within (?:a )?(?:melee )?(?:reach|range) of (?:at least one|an?|any|one) (?:enemy|foe|creature|target)|with (?:an?|at least one) (?:enemy|foe|creature) within (?:its|their|his|her) reach), (?:it|they|he|she|the [\w' -]+?) (?:can )?makes? an? ((?:[\w' -]+? )?)Strike against (?:that (?:enemy|foe|creature|target)|the (?:enemy|foe|creature|target)|it)\./gi, (_whole, move, strike) => `${move.replace(/up to (?:double|twice) (?:its|their|his|her) (?:fly )?Speed/i, "twice")} and makes a ${strike}Strike.`);
}

// A Strike at every creature in reach (2026-10-10): "The shambler makes a vine Strike against each creature within reach.
// Its multiple attack penalty increases only after all the attacks." → { strike, sameMap }, or null.
export function readSweep(text) {
    const sentences = text.trim().split(/(?<=\.)\s+(?=[A-Z])/);
    const match = /^(?:The )?[^.]+? (?:makes|attempts) (?:a|an|one) (?:([\w' -]+?) )??Strike (?:once )?against each (?:creature|enemy|foe)(?: (?:within|in) (?:(?:its|their|his|her|the [\w' -]+?'s) )?(?:melee )?reach)?\.$/i.exec(sentences.shift() ?? "");
    if (!match) return null;
    let sameMap = false;
    for (const sentence of sentences) {
        if (/\b(?:multiple attack )?penalty\b[^.]*\b(?:doesn't|does not) increase until\b|\b(?:multiple attack )?penalty increases only after\b/i.test(sentence)) {
            sameMap = true;
            continue;
        }
        if (/^(?:Each attack|These attacks) counts? toward [^.]*multiple attack penalty(?: as normal)?\.$/i.test(sentence)) continue;
        // "It can Strike up to once with its jaws and any number of times with its body": its Strikes, the best one played.
        if (/^(?:It|They) can Strike up to once with (?:its|their) [\w' -]+(?:, up to once with (?:its|their) [\w' -]+)*,? and any number of times with (?:its|their) [\w' -]+\.$/i.test(sentence)) continue;
        if (/^This counts as (?:two|three|four|\w+) attacks for [^.]*multiple attack penalty, but the penalty (?:doesn't|does not) increase until [^.]*\.$/i.test(sentence)) {
            sameMap = true;
            continue;
        }
        if (/^Make only one attack roll, and roll damage once for all targets\.$/i.test(sentence)) {
            sameMap = true;
            continue;
        }
        return null;
    }
    const name = match[1] && !/^(?:melee|melee weapon|weapon|unarmed)$/i.test(match[1].trim()) ? match[1].trim().replace(/^(?:melee|ranged)\s+/i, "").toLowerCase() : null;
    return { strike: name, sameMap };
}

// "X Flies up to double its fly Speed and then makes a talon Strike." and other moves before one Strike (2026-10-10):
// { strides, strike } (how many Strides it counts as, the Strike's name or null), or null. The move: Strides, Flies,
// Swims, Climbs, Burrows or Leaps (or one of two), once, twice, "up to three times", "up to double its Speed", "up to
// 10 feet"; the Strike "at any point during that movement", "at the end of its movement", "against a foe within its
// reach", "against an adjacent creature at the end of its movement".
const MOVES = String.raw`(?:Strides?|Flies|Fly|Swims?|Climbs?|Burrows?|Leaps?)`;
export function moveThenStrike(said) {
    // (Batch 37: "The ray Swims, making one tail Strike at any point along the way.")
    const text = String(said).replace(/, making (?:an?|one) ((?:[\w' -]+? )?Strike)\b/i, " and makes a $1");
    // ("Grandfather Mantis Strides, then Strikes.", "… Strides twice, then Strikes with their horn.", batch 25.)
    // (Batch 37: "Strides or Steps, then Strikes with his hand crossbow", "Burrows and then Strikes", "Strides twice and Strikes with its bayonet".)
    const bare = new RegExp(String.raw`^(?:The )?[^.]+? (${MOVES}(?: or (?:${MOVES}|Steps?))?)( twice| up to two times)?(?:, then| and(?: then)?) Strikes(?: with (?:its|their|his|her) ([\w' -]+?))?\.$`, "i").exec(text);
    if (bare) return { strides: bare[2] ? 2 : 1, strike: bare[3] ? bare[3].toLowerCase() : null };
    const match = new RegExp(String.raw`^(?:The )?[^.]+? (${MOVES}(?: or ${MOVES})?)((?: (?:twice|three times|up to two times|at least \d+ feet|up to (?:twice|three times|double|half|its|their|his|her|\d+ feet)[^,.]*?))?)(?: in a straight line)?(?:,? (?:while flying|descending at least \d+ feet))?,? (?:and |then |and then )+(?:makes|attempts) (?:a|an|one) (?:([\w' -]+?) )??Strike((?: (?:at any point (?:during (?:that|the|its|this) (?:movement|Stride|move|flight|Fly)|along the way)|at the end of (?:that|its|the|this) (?:movement|Stride|move)|against (?:a|an|one) (?:foe|enemy|creature|target) (?:within (?:its|their|his|her) reach|adjacent to it)|against an adjacent (?:creature|foe|enemy)|with (?:a|an extended) reach of \d+ feet))*)\.$`, "i").exec(text);
    if (!match) return null;
    const how = match[2].trim();
    const strides = /three times/i.test(how) ? 3 : /twice|double|two times/i.test(how) ? 2 : 1;
    const name = match[3] && !/^(?:melee|weapon|unarmed|melee weapon)$/i.test(match[3].trim()) ? match[3].trim().replace(/^(?:melee|ranged)\s+/i, "").toLowerCase() : null;
    return { strides, strike: name };
}

// "The smilodon Strides and makes a Strike at the end of that movement." (the
// hidden note after it changes nothing in the simulation) → { strides, strike }.
// A charge's bonus for moving 20 feet comes along: "it gains a +2 circumstance
// bonus to its attack roll" → attackBonus; "the Strike's damage is increased
// to 3d10+20" → damage. Any other sentence: null.
export function readCharge(text) {
    // ("Frequency once per turn Effect The knight Strides twice. …": its Effect, batch 38.)
    const sentences = chargeSentences(String(text).replace(/^Frequency once per (?:turn|round) Effect /, "")).trim().split(/(?<=\.)\s+/);
    // A first sentence that only describes it ("The goblin shark dashes forward and extends its jaws").
    // (Batch 42: "With a quick sprint, the test warrior dashes up to their foe and swings.", "… with jets of energy from its feet, …".)
    if (sentences.length > 1 && !/\b(?:Strikes?|save|damage|check|DC|bonus|penalty|\d+ feet|Hit Points|@\w+\[)\b/i.test(sentences[0]) && /^(?:[A-Z][^,.]*, (?=the ))?[Tt]he [\w' -]+? [a-z]+s\b/.test(sentences[0]) && moveThenStrike(sentences[1] ?? "")) sentences.shift();
    const match = /^The [^.]+? Strides( twice)? and (?:then )?makes an? (?:([\w' -]+?) )?Strike(?: at the end of that movement)?\.$/i.exec(sentences[0] ?? "");
    // Other moves and wordings (2026-10-10): "Flies up to double its fly Speed and then makes a talon Strike".
    const other = match ? null : moveThenStrike(sentences[0] ?? "");
    if (!match && !other) return null;
    const charge = other ?? { strides: match[1] ? 2 : 1, strike: match[2] && !/^(?:melee|weapon|unarmed|melee weapon)$/i.test(match[2].trim()) ? match[2].toLowerCase() : null };
    const moved = "^(?:If|As long as) (?:it|they|he|she|the [\\w' -]+?|[A-Z][\\w'-]+) moved at least 20 feet(?: (?:away )?from (?:its|their|his|her) starting position)?, ";
    for (const sentence of sentences.slice(1)) {
        // (Nothing for the simulation: "During the Stride, it gains a +10-foot circumstance bonus to its Speed.")
        if (/remains? hidden until after/i.test(sentence) || /^During (?:the|this|that) (?:Stride|movement), (?:it|they|he|she|the [\w' -]+?) gains? a \+\d+-foot circumstance bonus to (?:its|their|his|her) Speed\.$/i.test(sentence)) continue;
        // (Batch 37: "This Strike gains the fatal d12 trait", "The Strike deals half damage".)
        const trait = /^(?:This|The) (?:[\w' -]+? )?(?:Strike|strike) gains the (fatal|deadly) d(\d+) trait(?: for this attack)?\.$/i.exec(sentence);
        if (trait) {
            charge[trait[1].toLowerCase()] = Number(trait[2]);
            continue;
        }
        if (/^The (?:Strike|strike) deals half damage\.$/.test(sentence)) {
            charge.halfDamage = true;
            continue;
        }
        const bonus = new RegExp(`${moved}(?:it gains|they gain|he gains|she gains) a \\+(\\d+) circumstance bonus to (?:its|their|his|her|this|the) attack roll\\.$`, "i").exec(sentence);
        const damage = new RegExp(`${moved}the Strike's damage (?:is increased to|increases to) (.+?)(?: damage)?\\.$`, "i").exec(sentence);
        if (bonus) charge.attackBonus = Number(bonus[1]);
        // (An inline roll as its formula: "@Damage[(3d10+10)[piercing]]" → "(3d10+10)[piercing]".)
        else if (damage) charge.damage = damage[1].trim().replace(/^@Damage\[(.*)\]$/, "$1");
        else return null;
    }
    return charge;
}

// "The dragon recharges their Poison Breath whenever they score a critical hit with a Strike." → ["Poison Breath"].
export function readMomentum(text) {
    if (!/critical hit/i.test(text) || !/recharges?/i.test(text)) return null;
    const named = /recharges? (?:their |its )?([A-Z][\w' -]+?)(?: whenever|\.|$)/.exec(text)?.[1];
    return { recharges: named ? [named.trim()] : [] };
}

// A reaction the simulator plays, or null.
//   Trigger … targets the wererat with an attack … Effect … +2 circumstance bonus to AC against the triggering attack.
//   Trigger The dragon is targeted by an attack; Effect … The attacker rolls the triggering attack twice and uses the worse result.
//   Trigger … uses a move action or leaves a square during a move action … Effect The dragon makes a tail Strike at the creature with a –2 penalty. If the Strike hits, the dragon disrupts the creature's action.
//   Trigger The reefclaw is reduced to 0 Hit Points. Effect The reefclaw makes a claw Strike before dying.
export function readReaction(item, text) {
    // (Linked names as words: "@UUID[…]{Concealment}" → "Concealment".)
    text = text.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1");
    // Undying Myth (batch 41): "Cost all the creature's Mythic Points Trigger The creature would die and has at least 1 Mythic Point Effect
    // The creature remains standing and conscious, and recovers 50% of its maximum Hit Points."
    const undying = /\bTrigger (?:The )?[^.]+? would die and has at least 1 Mythic Point\.? Effect (?:The )?[^.]+? remains (?:standing and )?conscious, and recovers (\d+)% of (?:its|their|his|her) maximum Hit Points\.?$/i.exec(text.trim());
    if (undying && /^Cost all (?:of )?[^.]*?Mythic Points\b/i.test(text.trim())) return { builtin: "mythic", kind: "undying", fraction: Number(undying[1]) / 100 };
    const undyingHp = /\bTrigger (?:The )?[^.]+? would die and has at least 1 Mythic Point\.? Effect (?:The )?[^.]+? remains (?:standing and )?conscious,? and recovers (\d+) Hit Points\.?$/i.exec(text.trim().replace(/@Damage\[(\d+)\[healing\]\](?:\{[^}]*\})?/g, "$1"));
    if (undyingHp && /^Cost all (?:of )?[^.]*?Mythic Points\b/i.test(text.trim())) return { builtin: "mythic", kind: "undying", amount: Number(undyingHp[1]) };
    // (Counterspell, Read the Cards: the GM's, the user's choice of 2026-10-11.)
    if (readGmSpellcasting(text)) return { builtin: "no-effect" };
    // (Batch 40, with no labels: "If a goblin ally ends a move action adjacent to the goblin warrior, the warrior can use their reaction
    // to Step"; "When a creature within the reach of the warg's bite attacks one of its allies, the warg can spend its reaction to make a
    // jaws Strike against that creature".)
    if (/^If an? (?:[\w' -]+ )?ally ends a move action adjacent to [^,]+, (?:the [\w' -]+?|it|they|he|she) can use (?:its|their|his|her) reaction to Step\.$/i.test(text.trim())) return { builtin: "no-effect" };
    const bite = /^When a creature within (?:the )?reach of (?:the [\w' -]+?['’]s|its|their) ([\w' -]+?) attacks one of (?:its|their|the [\w' -]+?['’]s) allies, (?:the [\w' -]+?|it|they) can spend (?:its|their) reaction to make an? ([\w' -]+?) Strike against that creature\.$/i.exec(text.trim());
    if (bite) return { builtin: "reaction-strike", triggers: ["ally-attacked"], strike: bite[2].toLowerCase(), penalty: 0, disrupts: false };
    const [trigger, effect] = [/Trigger (.+?)(?= Effect |$)/i.exec(text)?.[1] ?? "", /Effect (.+)$/i.exec(text)?.[1] ?? ""];
    if (!trigger || !effect) return trigger ? acDodge(text, trigger, effect) : null;
    // Mist Escape (batch 40): at 0 Hit Points it goes to its coffin as mist: out of the fight, as the simulation already has it.
    if (/^(?:The )?[^.]+? is reduced to 0 (?:HP|Hit Points)\.?$/i.test(trigger.trim()) && /^(?:The )?[^.]+? uses Turn to Mist\. [^.]*\bcoffin\b/i.test(effect.trim())) return { builtin: "no-effect" };
    const ac = (item?.system?.rules ?? []).find((rule) => rule?.key === "FlatModifier" && [].concat(rule.selector).includes("ac") && Number.isFinite(Number(rule.value)));
    if (ac && /\bAC against the triggering attack\b/i.test(effect) && /\b(?:targets?|targeted|is hit|critically hit)\b/i.test(trigger)) {
        return { builtin: "ac-reaction", value: Number(ac.value), when: /\bis hit\b|\bcritically hit\b/i.test(trigger) ? "hit" : "targeted" };
    }
    const dodge = acDodge(text, trigger, effect);
    if (dodge) return dodge;
    if (/\btargeted by an attack\b/i.test(trigger) && /rolls the triggering attack twice and uses the worse result/i.test(effect)) return { builtin: "attack-misfortune" };
    // Resilient Form, Cushioned Blow, Extraneous Flesh: when it's critically hit, a flat check makes it a normal hit.
    //   Trigger The dragon is critically hit with a weapon or unarmed attack; Effect … attempts a @Check[flat|dc:14].
    //   On a success, the triggering attack becomes a normal hit.
    const flat = /@Check\[(?:type:)?flat\|dc:(\d+)/i.exec(effect)?.[1] ?? /\bDC (\d+) flat check\b/i.exec(effect)?.[1];
    if (flat && /\bcritically hits?\b|\bcritical hit\b/i.test(trigger) && /On a success, (?:the (?:triggering )?attack becomes a normal hit|it doesn't take any extra damage from the critical hit)|If (?:it|he|she|they|the [\w' -]+?) succeeds? at a (?:@Check\[[^\]]*\]|DC \d+ flat check)(?: check)?, the (?:triggering )?attack becomes a normal hit/i.test(effect)) {
        const frequency = item?.system?.frequency;
        return { builtin: "crit-downgrade", dc: Number(flat), ...(item?.system?.actionType?.value === "free" ? { uses: Number(frequency?.max) || 1 } : {}) };
    }
    // A champion's reaction in its own words (2026-10-10, batch 29): "Trigger An enemy damages the archon's ally and both are within
    // 15 feet of the archon; Effect The ally gains resistance 15 to all damage against the triggering damage and the archon can make
    // a Strike against the enemy" (Archon's Protection, Retributive Strikes in full): the glossary Retributive Strike's, with its
    // resistance.
    const champion = /\bally gains resistance (\d+) to all damage against the triggering damage\b/i.exec(effect);
    if (champion && /^An? (?:enemy|foe) damages (?:the [\w' -]+?['’]s|one of [\w' -]+?['’]s|[A-Z][\w'-]+['’]s) ally\b/i.test(trigger) && /\b(?:makes? a (?:melee )?Strike against (?:it|them|the (?:enemy|foe))|can make a Strike against the (?:enemy|foe))\b/i.test(effect) && !/\b(?:grabs|restrains|chooses?)\b/i.test(`${trigger} ${effect}`)) {
        return { builtin: "retributive-strike", resistance: Number(champion[1]) };
    }
    // A critical hit on it answered with resistance against that attack (2026-10-10, batch 29): "Trigger The dragon is critically hit
    // by an attack; Effect … gaining resistance 20 to all damage against the triggering attack" (Wished Away, Withhold Death).
    const resist = /\b(?:gains?|gaining) resistance (\d+) to all damage against the triggering attack\b/i.exec(effect);
    if (resist && /\bis critically hit by an? (?:attack|Strike)\b/i.test(trigger) && !/\bRequirements?\b/i.test(text)) return { builtin: "crit-resistance", value: Number(resist[1]) };
    // A critical hit made a normal hit with no check (2026-10-10, batch 29): Collapse's "the attack deals damage for a hit, rather
    // than a critical hit" or "… deals only normal damage", Twist Fate's "The triggering attack becomes a hit instead", Half-Ear's
    // Luck's "The critical hit becomes a normal hit". Collapse's "until it does, it is Immobilized and Off-Guard" (re-forming as
    // an action) is what it's left with: collapse. Not one with a requirement, nor one the attacker chooses.
    if (!flat && /\b(?:is critically hit|takes a critical hit|critically hits (?:the|it|him|her|them)\b|scores a critical hit on)\b/i.test(trigger) && /\b(?:deals (?:damage for a hit,? rather than a critical hit|only normal damage)|(?:triggering attack|critical hit) (?:becomes|is) a (?:normal )?hit(?: instead)?)\b/i.test(effect) && !/\bRequirements?\b/i.test(text) && !/\bchoose\b/i.test(effect)) {
        const frequency = item?.system?.frequency;
        const collapse = /\bImmobilized\b[^.]*\bOff-Guard\b|\bOff-Guard\b[^.]*\bImmobilized\b/i.test(effect) && /\bre-?form\w*\b[^.]*\baction\b/i.test(effect);
        return { builtin: "crit-downgrade", dc: null, ...(item?.system?.actionType?.value === "free" ? { uses: Number(frequency?.max) || 1 } : {}), ...(collapse ? { collapse: true } : {}) };
    }
    // Concealment against the triggering attack (2026-10-10): "gains concealment against the triggering attack" (a DC 5 flat check
    // for the attacker), "The attacker must succeed at a DC 11 flat check … as if the drake were Hidden" (DC 11), "must attempt a
    // DC 11 flat check; on a failure, the attack passes harmlessly through". Ranged attacks only when the trigger says so.
    if (/\b(?:is targeted (?:with|by) (?:an?|a ranged) (?:attack|Strike|ranged Strike)|attacks the|targets the [^.]+? with an attack|is targeted by a Strike|is hit (?:with|by) (?:a|an) (?:Strike|attack))\b/i.test(trigger)) {
        const named = flat ? Number(flat) : null;
        const hidden = /\bas if (?:it|they|he|she|the [\w' -]+?) (?:were|was) Hidden\b/i.test(effect);
        const concealed = /\b(?:gains?|gaining|grants?)\b[^.]*\b(?:concealment|Concealed)\b[^.]*\bagainst (?:the|that|this) triggering (?:attack|Strike)\b/i.test(effect);
        const misses = named && /\b(?:in order to affect|to affect|or the attack misses|on a failure, the attack (?:misses|passes)|fails? to hit)\b/i.test(effect);
        const dc = hidden ? 11 : concealed ? 5 : misses ? named : null;
        if (dc) return { builtin: "conceal-reaction", dc, ranged: /\branged\b/i.test(trigger) && !/\bmelee\b/i.test(trigger), when: /\bis hit\b/i.test(trigger) ? "hit" : "targeted" };
    }
    // Tail Lash, Avenging Bite, Violent Retort (2026-10-10, batch 38): a Strike at a creature that Strikes or attempts a skill check in
    // its reach (a hit: "the creature takes a –2 circumstance penalty to the triggering roll"), that attacks one of its allies, or that
    // critically hits it → triggers "strike" and "skill", "ally-attacked", "critical-hit".
    const owner = String.raw`(?:the [\w' -]+?['’]s|an? [\w' -]+?['’]s|[A-Z][\w'-]+(?: (?:the |of )?[A-Z][\w'-]+)?['’]s|its|their)`;
    const lash = new RegExp(String.raw`^A creature within reach of ${owner} ([\w' -]+?)(?: Strike)? (?:makes a Strike or attempts a skill check(?: as part of an attack action)?|(?:takes|uses) an action to Strike or attempt a skill check)\.?$`, "i").exec(trigger.trim());
    const avenge = new RegExp(String.raw`^A creature within (?:the )?reach of ${owner} ([\w' -]+?)(?: Strike)? attacks one of ${owner} allies\.?$`, "i").exec(trigger.trim());
    const retort = new RegExp(String.raw`^A creature within ${owner} reach critically hits (?:the [\w' -]+?|it|him|her|them)\.?$`, "i").exec(trigger.trim());
    if (lash || avenge || retort) {
        const said = effect.replace(/\s*Effect: [\w' -]+$/, "").trim();
        const back = /^(?:The )?[^.]+? (?:Strikes with (?:its|their|his|her) ([\w' -]+?) at the triggering creature|attempts to Strike the triggering creature with (?:its|their|his|her) ([\w' -]+?)|makes an? ([\w' -]+?)(?: or [\w' -]+?)? Strike (?:at|against) the (?:triggering )?creature)(?: (?:with|at) an? [–-](\d+) penalty)?(?:, after applying all the effects of the critical hit to (?:the [\w' -]+?|it|itself|themselves))?\.(?: If (?:the Strike|it|he|she|they) hits?, the (?:creature|target) takes an? [–-](\d+) circumstance penalty to the triggering roll\.)?$/i.exec(said);
        const name = back ? (back[1] ?? back[2] ?? back[3]).toLowerCase() : null;
        if (back && (!back[5] || lash)) return { builtin: "reaction-strike", triggers: lash ? ["strike", "skill"] : avenge ? ["ally-attacked"] : ["critical-hit"], strike: name, penalty: Number(back[4] ?? 0), disrupts: false, ...(back[5] ? { hinders: Number(back[5]) } : {}) };
    }
    // (A Step when an ally moves next to it, Goblin Scuttle, batch 38: nothing for the fight's numbers.)
    if (/^An? (?:[\w' -]+ )?ally ends a move action adjacent to [^.]+\.?$/.test(trigger.trim()) && /^(?:The )?[^.]+? Steps\.$/.test(effect.trim())) return { builtin: "no-effect" };
    // Fast Swallow (2026-10-10, batch 38): "Trigger The worm Grabs a creature (with its maw); Effect The worm uses Swallow Whole."
    if (/^(?:The )?[^.]+? Grabs a creature(?: (?:with|in) (?:its|their|his|her) [\w' -]+?)?;?\.?$/i.test(trigger.trim()) && /^(?:The )?[^.]+? uses Swallow Whole\.?$/i.test(effect.trim())) return { builtin: "fast-swallow" };
    const moving = /\buses a move action\b|\bleaves a square during a move action\b/i.test(trigger);
    const struck = /^The [^.]+? makes an? ([\w' -]+?) Strike (?:at|against) the (?:triggering )?creature(?: with an? [–-](\d+) penalty)?\./i.exec(effect);
    if (moving && struck) return { builtin: "reaction-strike", triggers: ["move"], strike: struck[1].toLowerCase(), penalty: Number(struck[2] ?? 0), disrupts: /\bIf the Strike hits, [^.]*disrupts\b/i.test(effect) };
    if (/^The [^.]+? is reduced to 0 Hit Points\.?$/i.test(trigger.trim())) {
        const last = /^The [^.]+? makes an? (?:([\w' -]+?) )?Strike before (?:dying|being destroyed)\./i.exec(effect);
        if (last) return { builtin: "death-strike", strike: last[1] ? last[1].toLowerCase() : null };
    }
    return null;
}

// A circumstance bonus to its own AC against the attack, in other wordings (2026-10-10, batch 17): the value from the text
// when the item has no rule ("Jellico gains a +2 circumstance bonus to AC against the triggering Strike"), with no "Effect"
// label ("Trigger Pin is targeted with a melee or ranged attack by an attacker he can see. Pin gains …"), or with more after
// it ("…, gaining a +2 circumstance bonus to AC, then Strides up to half their Speed after the Strike resolves"), which is a
// note for the GM. against: "melee" or "ranged" when only those attacks set it off. Not: one that protects another creature
// (an ally, a rider, a liege), one against a spell, a splash or an area, one that lasts ("until the start of its next turn").
const SELF = String.raw`(?:the [\w' -]+?|it|him|her|them|you|[A-Z][\w'-]+(?: [A-Z][\w'-]+)?)`;
const KIND = String.raw`(?:physical )?(?:melee |ranged |melee or ranged |melee or a ranged )?`;
const SELF_ATTACKED = new RegExp(String.raw`\b(?:targets? ${SELF} with an? ${KIND}(?:attack|Strike)|(?:is|are) targeted (?:with|by) an? ${KIND}(?:attack|Strike)|is the target of an? ${KIND}(?:attack|Strike)|(?:makes|attempts) an? ${KIND}(?:attack(?: roll)?|Strike) (?:against|targeting) ${SELF}|attempts to Strike ${SELF})\b`);
function acDodge(text, trigger, effect) {
    // No "Effect" label: the trigger's first sentence, then the rest (after any requirements).
    // (Not with a requirement the simulator can't check; "is not encumbered" it can.)
    if (/\bRequirements? (?![^.]*?\b(?:not encumbered|(?:can't|cannot) use this reaction while Encumbered)\b)/i.test(text)) return null;
    if (!/ Effect /.test(text)) {
        const parts = /^Trigger (.+?)\.\s+(?:Requirements? [^.]+\.\s+)?(.+)$/.exec(text.trim());
        if (!parts) return null;
        [trigger, effect] = [parts[1], parts[2]];
    }
    // "The oath dragon or a bonded companion within 15 feet is targeted": its own part.
    const own = trigger.replace(/ or (?:a|an|one of its) [\w' -]+? within \d+ feet(?= (?:is|are) targeted)/i, "");
    const shared = own !== trigger;
    trigger = own;
    const bonus = /(?:gains?|gaining|giving (?:it|itself)|providing) a \+(\d+) circumstance bonus to (?:its |their |his |her )?(?:AC|Armor Class)\b/i.exec(effect);
    // (Nimble Dodge's older wording, batch 29: "is hit or critically hit by an attack made by a creature it can see".)
    const hit = /\bis hit or critically hit by an? (?:attack|Strike)\b/i.test(trigger);
    if (!bonus || !(SELF_ATTACKED.test(trigger) || hit)) return null;
    // (Shielding Wing protects "itself or the bonded companion": its own part is read.)
    if (/\b(?:ally|allies|rider|liege|object|spells?|splash|area|bow|until)\b/i.test(`${trigger} ${effect.slice(0, bonus.index + 120)}`) || (!shared && /\bcompanion\b/i.test(effect.slice(0, bonus.index + 120)))) return null;
    const melee = /\bmelee\b|\badjacent\b/i.test(trigger);
    const ranged = /\branged\b/i.test(trigger);
    // Its sentence and any more: a note when it says more than the bonus against the attack.
    // (Not the PF2e effect it links: "… Effect: Shielding Wing".)
    const plain = effect.trim().replace(/\s*\bEffect: [^.]+$/, "");
    const only = /^[^.]*?\+\d+ circumstance bonus to (?:its |their |his |her )?(?:AC|Armor Class)(?: against (?:the|that) triggering (?:attack|Strike))?\.?$/i.test(plain);
    return { builtin: "ac-reaction", value: Number(bonus[1]), when: hit ? "hit" : "targeted", ...(melee !== ranged ? { against: melee ? "melee" : "ranged" } : {}), ...(only ? {} : { notes: [plain] }) };
}

// A condition the monster always has (2026-10-10, batch 21): "The zombie is permanently Slowed 1 and can't use reactions" (Slow),
// "Inizra is permanently Quickened. She can use her extra action only to Strike." (Weapon Supremacy), "The irnakurse is
// permanently Frightened 2, …". { builtin: "permanent-condition", conditions: [{ slug, value }], noReactions?, quickenedFor? }.
// Not one with a condition of its own ("while", "if", "unless", "when"), nor more than these sentences say.
const PERMANENT_SLUGS = new Set(["slowed", "quickened", "frightened", "clumsy", "enfeebled", "drained", "stupefied", "blinded", "deafened"]);
export function readPermanent(text) {
    const sentences = String(text).replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1").trim().split(/(?<=\.)\s+/);
    const match = /^(?:The |An? )?[\w' -]+? (?:is|are) permanently ([A-Za-z]+)(?: (\d+))?(?: and (can't|cannot) use reactions)?(,[^.]*)?\.?$/.exec(sentences[0] ?? "");
    // (", and it can use the extra action only to Step or Stride": the extra action's limit, read as the next sentence's.)
    if (match?.[4] && /\bextra action\b/.test(match[4])) sentences.splice(1, 0, `It can use its extra action ${/\bStrike\b/.test(match[4]) ? "only to Strike" : "only to move"}.`);
    if (!match || /\b(?:while|if|unless|when|until)\b/i.test(sentences.join(" "))) return null;
    const slug = match[1].toLowerCase();
    if (!PERMANENT_SLUGS.has(slug)) return null;
    // "She can use her extra action only to Strike", "It can use this extra action to Stride or Strike" (as a Strike's; not
    // one only to move or to work a siege weapon). The rest isn't read.
    const rest = sentences.slice(1);
    const strikeOnly = rest.length === 1 && /^(?:She|He|It|They) can use (?:her|his|its|their|this) extra action (?:only )?to (?:Stride or )?Strike\.?$/.test(rest[0]);
    if (rest.length && !strikeOnly) return null;
    return { builtin: "permanent-condition", conditions: [{ slug, value: match[2] ? Number(match[2]) : (slug === "slowed" ? 1 : null) }], ...(match[3] ? { noReactions: true } : {}), ...(strikeOnly ? { quickenedFor: "strike" } : {}) };
}

// Naturally invisible (2026-10-10, batch 28): "A poltergeist is naturally Invisible. It becomes visible only when it uses
// Frighten.", "The phade is Invisible at all times, though when it takes a hostile action of any kind, it is Hidden instead …":
// invisible from the start of the fight, as a condition it always has. Not one only somewhere ("while within sight of their bound
// home", "outside of their bottle", "Unless it has fed recently").
function readNaturallyInvisible(text) {
    const plain = String(text).replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1").trim();
    const first = plain.split(/(?<=\.)\s+/)[0] ?? "";
    if (!/^(?:The |An? )?[\w' -]+? is (?:naturally Invisible|Invisible at all times)(?:\.$| and only becomes visible\b|, though\b| though\b)/i.test(first)) return null;
    if (/\b(?:while|unless|outside|within sight|if)\b/i.test(first.replace(/\bthough when\b.*$/i, ""))) return null;
    return { builtin: "permanent-condition", conditions: [{ slug: "invisible", value: null }] };
}

// The builtin for an item, or null.
// Steady Spellcasting (2026-10-10, batch 28): "If another creature's reaction would disrupt the cleric's spellcasting action,
// the cleric attempts a DC 15 flat check. On a success, the action isn't disrupted." → { builtin: "steady-spellcasting", dc }.
function readSteady(text) {
    if (!/\b(?:reaction )?(?:would )?disrupts? [^.]*?\bspell(?:casting)?\b/i.test(text) || !/\bisn't disrupted\b|\bavoiding the disruption\b/i.test(text)) return null;
    const dc = /@Check\[(?:type:)?flat\|dc:(\d+)/i.exec(text)?.[1] ?? /\bDC (\d+) flat check\b/i.exec(text)?.[1];
    return dc ? { builtin: "steady-spellcasting", dc: Number(dc) } : null;
}

// Golem Antimagic (2026-10-10, batch 28): "Harmed by sonic (6d6, 2d6 from areas or persistent damage); healed by fire (area 2d6
// HP); slowed by cold" → { builtin: "golem-antimagic", harmed: { by, damage, area }, healed: { by, area }, slowed: { by } } (by:
// the damage types, traits or spell names it lists, lowercase; damage: untyped, area: from areas or persistent damage). A golem is
// immune to others' magic; magic of these kinds harms, heals or slows it instead (PF2e's glossary).
export function readGolemAntimagic(text) {
    // (Inline rolls and @Damage as their formulas: "[[/r {8d10}]]", "@Damage[(6d10+4)[untyped]]".)
    const plain = String(text)
        .replace(/@Damage\[((?:[^[\]]|\[[^\]]*\])*)\](?:\{[^}]*\})?/g, (_all, raw) => ` ${String(raw).split("|")[0].replace(/\[[a-z,]+\]$/i, "").replace(/^\((.*)\)$/, "$1")} `)
        .replace(/\[\[\/(?:r|br|gmr) \{?([^\]}#]+?)\}?(?: #[^\]]*)?\]\](?:\{[^}]*\})?/g, " $1 ")
        .replace(/\s+/g, " ");
    if (!/\bharmed by\b/i.test(plain) || !/\b(?:healed|slowed) by\b/i.test(plain) && !/\bGolem ?Antimagic\b/i.test(plain)) return null;
    const kinds = (list) => list.trim().replace(/\.$/, "").split(/\s*(?:,|\band\b|\bor\b)\s*/i).map((kind) => kind.trim().toLowerCase()).filter(Boolean);
    const dice = (part) => part.match(/\(?\d+d\d+(?:\s*[+-]\s*\d+)?\)?|\b\d+\b(?= (?:HP|Hit Points|damage))/gi)?.map((formula) => formula.replace(/\s+/g, "").replace(/^\((.*)\)$/, "$1")) ?? [];
    const harmed = /\bharmed by ([^(;]+?) \(([^)]*)\)/i.exec(plain);
    if (!harmed) return null;
    const [first, second] = dice(harmed[2]);
    const areaOnly = second === undefined && /from areas/i.test(harmed[2]);
    const healed = /\bhealed by ([^(;]+?) \(([^)]*)\)/i.exec(plain);
    const slowed = /\bslowed by ([^;.@]+?)(?=\s*(?:@Localize|A golem\b|;|\.|$))/i.exec(plain);
    return {
        builtin: "golem-antimagic",
        harmed: { by: kinds(harmed[1]), damage: areaOnly ? null : first ?? null, area: areaOnly ? first : second ?? null },
        healed: healed ? { by: kinds(healed[1]), area: dice(healed[2])[0] ?? null } : null,
        slowed: slowed ? { by: kinds(slowed[1]) } : null
    };
}

// A rage or frenzy on itself (2026-10-10, batch 32), for the simulator: "Akiros flies into a rage. He gains 6 temporary Hit Points,
// deals 2 additional damage with melee Strikes, takes a -1 penalty to AC, and can't use other actions with the concentrate trait.
// This effect lasts for 1 minute, …" → { builtin: "self-effect", actions, model: { name, rounds, modifiers, tempHp }, extraDice?,
// noConcentrate? }. Temporary Hit Points "equal to its level plus its Constitution modifier" from the creature. Not one with a
// trigger, nor one that also confuses it or names a weakness. PF2e's linked effect (Effect: Rage) stays live play's.
// (Batch 33: a trigger it plays: "The sea devil deals bleed damage to a living creature" (deals-bleed), "The young rage dragon is
// 200 Hit Points or below and takes damage", "The Tiger Lord suffers damage that reduces its Hit Points to 100 or less"
// (hp-at-most), "Hymmir damages a living creature with his jaws Strike" (own-hit).)
const RAGE_SELF = String.raw`(?:[Tt]he [\w' -]+?|[A-Z][\w'-]+(?: [A-Z][\w'-]+)?)`;
function rageTrigger(trigger) {
    const said = String(trigger).trim().replace(/\.$/, "");
    let match;
    if (new RegExp(String.raw`^${RAGE_SELF} deals bleed damage to a living creature$`).test(said)) return { kind: "deals-bleed" };
    if ((match = new RegExp(String.raw`^${RAGE_SELF} is (\d+) Hit Points or below and takes damage$`).exec(said)) || (match = new RegExp(String.raw`^${RAGE_SELF} suffers damage that reduces its Hit Points to (\d+) or less$`).exec(said))) return { kind: "hp-at-most", value: Number(match[1]) };
    if ((match = new RegExp(String.raw`^${RAGE_SELF} damages a living creature with (?:its|his|her|their) ([\w' -]+?) Strike$`).exec(said))) return { kind: "own-hit", strike: match[1].toLowerCase() };
    return null;
}

export function readRage(item, actor = null) {
    const type = item?.system?.actionType?.value;
    if (!["action", "free", "reaction"].includes(type)) return null;
    const text = htmlToPlainText(String(item?.system?.description?.value ?? "")).replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\[\[\/(?:r|br|gmr) \{?([^\]}#]+?)\}?(?: #[^\]]*)?\]\](?:\{([^}]*)\})?/g, (_all, roll, label) => label ?? roll).replace(/\s+/g, " ");
    const triggerText = /\bTrigger (.+?) (?:Effect|Requirements?|Frequency)\b/.exec(text)?.[1] ?? null;
    const trigger = triggerText ? rageTrigger(triggerText) : null;
    if (!/\b(?:rage|raging|frenzy|frenzied|enraged)\b/i.test(`${item.name} ${text}`) || (/\bTrigger\b/.test(text) && !trigger) || (type === "reaction" && !trigger) || /\b(?:Confused|weakness|each ally|allies|all [\w ]+ within)\b/i.test(text)) return null;
    // (A requirement the simulator can't check: not read; "isn't Fatigued or raging" it can.)
    const requires = /\bRequirements? (.+?) (?:Effect|Trigger|You tap|The [\w' -]+? (?:taps|flies|begins))\b/i.exec(text)?.[1] ?? "";
    // ("has taken damage", Fanatical Frenzy's: when it's hurt.)
    const hurt = /\bhas taken damage and\b/i.test(requires);
    const rest = requires.trim().replace(/\bhas taken damage and /i, "");
    if (requires && (!/^(?:The |A |An )?[\w' -]+? (?:is drunk,? and )?(?:isn't|is not|aren't|are not|is neither) (?:already )?(?:Fatigued|fatigued)(?:,? (?:or|nor) (?:already )?(?:raging|in a (?:rage|frenzy)))?\.?$/.test(rest) || /\b(?:has|have|taking|takes|within|adjacent)\b/i.test(rest))) return null;
    let tempHp = Number(/\b(?:gains?|gaining|gain) (\d+) temporary (?:Hit Points|HP)\b/i.exec(text)?.[1]) || 0;
    if (!tempHp && /\btemporary Hit Points equal to (?:its|it's|their|his|her|your) level plus (?:its|their|his|her|your|it's) Constitution modifier\b/i.test(text)) {
        const level = Number(actor?.system?.details?.level?.value);
        const con = Number(actor?.system?.abilities?.con?.mod);
        if (Number.isFinite(level) && Number.isFinite(con)) tempHp = level + con;
    }
    const flat = /\b(?:deals?|deal) (?:an? )?(?:additional )?(\d+) (?:additional |extra )?damage (?:with|on) (?:(?:its|their|his|her) )?(?:melee |fist |weapon |unarmed )?(?:Strikes|attacks|weapons)\b|\bStrikes deal (\d+) additional damage\b|\+(\d+) status bonus to (?:its |their )?damage rolls\b/i.exec(text);
    const dice = /\bdeals? an additional (\d+d\d+) (\w+) damage with (?:(?:its|their|his|her) )?(?:melee |weapon )?Strikes\b/i.exec(text) ?? /\bmelee Strikes deal an additional (\d+) (\w+) damage\b/i.exec(text);
    const ac = /\b(?:takes?|has|have|suffers?) an? [-\u2013\u2212](\d+) (?:status |circumstance )?penalty to (?:its |their |his |her )?AC\b/i.exec(text);
    const attack = /\+(\d+) (status|circumstance) bonus (?:to|on) (?:its |their )?attack rolls\b/i.exec(text);
    if (!tempHp && !flat && !dice) return null;
    const minutes = /\b(?:lasts?|lasting) (?:for )?(\d+|one) minutes?\b|\bfor (\d+|one) minutes?\b/i.exec(text);
    const rounds = minutes ? 10 * (Number(minutes[1] ?? minutes[2]) || 1) : 10;
    const modifiers = [
        ...(flat ? [{ on: "damage", type: flat[3] ? "status" : "untyped", value: Number(flat[1] ?? flat[2] ?? flat[3]) }] : []),
        ...(attack ? [{ on: "attack", type: attack[2].toLowerCase(), value: Number(attack[1]) }] : []),
        ...(ac ? [{ on: "ac", type: /status/i.test(ac[0]) ? "status" : "untyped", value: -Number(ac[1]) }] : [])
    ];
    const extraDice = dice ? (/d/.test(dice[1]) ? `${dice[1]}[${dice[2].toLowerCase()}]` : `${dice[1]}[${dice[2].toLowerCase()}]`) : null;
    return {
        builtin: "self-effect",
        actions: trigger ? 0 : Number(item.system?.actions?.value) || (type === "free" ? 0 : 1),
        model: { name: item.name, rounds, modifiers, tempHp },
        ...(extraDice ? { extraDice } : {}),
        ...(hurt ? { whenHurt: true } : {}),
        ...(trigger ? { trigger: { ...trigger, ...(type === "reaction" ? { reaction: true } : {}) } } : {}),
        ...(/\bconcentrate\b/i.test(text) ? { noConcentrate: true } : {})
    };
}

// More damage on its own Strikes for a while (2026-10-10, batch 37): "Until the start of her next turn, her fangs Strikes deal an
// additional 2d8 sonic damage", "For the next minute, its melee Strikes deal an additional 1d6 fire damage", "While in this stance,
// all the hunter's Strikes deal an additional 2d8 precision damage", "Until the end of its turn, the warhound's jaws Strike deals an
// additional 2 points of acid damage", "… Strikes deal an additional die of damage" (made-up and PF2e wordings). → { builtin:
// "self-effect", actions, model: { name, rounds, modifiers, tempHp }, damage: [formulas], strike (its name, or null for all),
// melee, duration { value, unit, expiry } (live play's), stance?, notes? }. The damage formulas: "2d8[sonic]", "1d10[persistent,
// bleed]", "2[acid]", "1d6[precision]", "die" (one more of the Strike's own dice). A first sentence that only tells what it does
// is left out; other sentences go to the GM as notes. Not with a trigger or a requirement, nor damage only against some creatures.
const BUFF_OWNER = String.raw`(?:all )?(?:its|their|his|her|(?:the [\w' -]+?|[A-Z][\w'-]+(?: [A-Z][\w'-]+)?)(?:'s|’s|')) `;
const BUFF_PART = String.raw`(?:\u0001(\d+)\u0001|(\d+d\d+(?:\s*[+-]\s*\d+)?) (persistent |precision )?((?!damage\b)[a-z]+)?|(\d+) (?:points? of )?(persistent |precision )?((?!damage\b)[a-z]+)?|(die) of damage)`;
export function readStrikeBuff(item) {
    if (item?.system?.actionType?.value !== "action") return null;
    const html = String(item?.system?.description?.value ?? "");
    const formulas = [];
    // ("@Damage[2d8[sonic]]" and "[[/r 1d4[slashing]]]" as numbered marks; links as their labels.)
    const marked = html
        .replace(/@Damage\[((?:[^[\]]|\[[^\]]*\])*)\](?:\{[^}]*\})?/g, (_all, raw) => `\u0001${formulas.push(String(raw).split("|")[0]) - 1}\u0001`)
        .replace(/\[\[\/r ((?:[^[\]]|\[[^\]]*\])+?)(?: #[^\]]*)?\]\](?:\{[^}]*\})?/g, (_all, raw) => `\u0001${formulas.push(raw.trim()) - 1}\u0001`)
        .replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1");
    const text = htmlToPlainText(marked).replace(/\s+/g, " ").trim();
    if (/^(?:Trigger|Requirements?)\b|\b(?:Trigger|Requirements?) [A-Z]/.test(text)) return null;
    const body = text.replace(/^Frequency [^.]*?(?=\s+Effect\b)\s+Effect\s+/, "").replace(/^Effect\s+/, "");
    const sentences = body.split(/(?<=\.)\s+(?=[A-Z])/).map((sentence) => sentence.trim()).filter(Boolean);
    const lead = String.raw`(Until the (start|end) of ${BUFF_OWNER.replace("(?:all )?", "")}(next )?turn|For the next minute|For (\d+|one) minutes?|While in this stance|While in (?:its|their|his|her) [\w' -]+? form)`;
    const key = new RegExp(String.raw`^(?:${lead},? )?${BUFF_OWNER}(?:(melee|ranged) )?(?:([\w' -]+?) )??Strikes? deals? an? (?:additional|extra) ${BUFF_PART}(?: damage)?(?:,? (?:and|plus) (?:an? (?:additional|extra) )?${BUFF_PART}(?: damage)?)?((?: on a successful attack, or [^.]+? on a critical (?:hit|success))?(?:,? and gains? the [a-z]+ trait)?(?:, and [^.]+)?)\.$`, "i");
    let found = null;
    let index = -1;
    for (const [at, sentence] of sentences.entries()) {
        const match = key.exec(sentence);
        if (match) {
            found = match;
            index = at;
            break;
        }
    }
    if (!found) return null;
    const [, , edge, next, minutes] = found;
    const leadText = found[1] ?? "";
    // Its parts, "2d8[sonic]", "2[acid]", "die".
    const part = (offset) => {
        const [mark, dice, diceKind, diceType, flat, flatKind, flatType, die] = found.slice(offset, offset + 8);
        if (mark !== undefined) {
            const formula = formulas[Number(mark)];
            return /\[[a-z,]+\]$/i.test(formula ?? "") ? formula.replace(/^\((.*)\)(\[[^\]]+\])$/, "$1$2") : null;
        }
        // ("2d8 precision damage": precision; "2d6 damage": untyped.)
        const typed = (kind, type) => (type ? `${kind ? `${kind.trim()},` : ""}${type.toLowerCase()}` : kind ? kind.trim() : "untyped");
        if (dice) return `${dice.replace(/\s+/g, "")}[${typed(diceKind, diceType)}]`;
        if (flat) return `${flat}[${typed(flatKind, flatType)}]`;
        return die ? "die" : null;
    };
    // (The groups: 1–4 the time, 5 melee or ranged, 6 the Strike's name, 7–14 and 15–22 the two parts, 23 the rest.)
    const said = (offset) => found.slice(offset, offset + 8).some((group) => group !== undefined);
    const damage = [part(7), part(15)].filter(Boolean);
    if (!damage.length || (said(15) && damage.length < 2)) return null;
    const rest = found[23] ?? "";
    // The time: when the lead names none, a sentence before it does ("transforms into a being of pure light for 1 minute").
    let duration;
    let rounds;
    let stance = false;
    if (/^Until/i.test(leadText)) {
        if (/start/i.test(edge)) [duration, rounds] = [{ value: 1, unit: "rounds", expiry: "turn-start" }, 1];
        else if (next) [duration, rounds] = [{ value: 1, unit: "rounds", expiry: "turn-end" }, 2];
        else [duration, rounds] = [{ value: 0, unit: "rounds", expiry: "turn-end" }, 0];
    } else if (/^For/i.test(leadText)) {
        const count = /next minute/i.test(leadText) ? 1 : Number(minutes) || 1;
        [duration, rounds] = [{ value: count, unit: "minutes", expiry: null }, 10 * count];
    } else if (/stance/i.test(leadText)) {
        [duration, rounds, stance] = [{ value: -1, unit: "unlimited", expiry: null }, null, true];
    } else {
        const said = sentences.slice(0, index).join(" ");
        const count = /\bfor (\d+|one) minutes?\b/i.exec(said)?.[1];
        if (!leadText || !count) return null;
        [duration, rounds] = [{ value: Number(count) || 1, unit: "minutes", expiry: null }, 10 * (Number(count) || 1)];
    }
    // Its other sentences: the first one only telling what it does is left out; the rest, and the key sentence's other part, the GM's.
    const notes = [];
    for (const [at, sentence] of sentences.entries()) {
        if (at === index) continue;
        if (at < index && !/\u0001|\d|\b(?:damage|bonus|penalty|save|check|Hit Points|HP|Strikes?|resistance|weakness|immun\w*)\b/i.test(sentence)) continue;
        if (/^Effect: /.test(sentence)) continue;
        notes.push(readableText(sentence.replace(/\u0001(\d+)\u0001/g, (_all, mark) => `@Damage[${formulas[Number(mark)]}]`)));
    }
    const other = rest.replace(/^ on a successful attack, or [^.,]+? on a critical (?:hit|success)/i, "").replace(/^,? and gains? the [a-z]+ trait/i, "").replace(/^, and /, "").trim();
    if (other) notes.unshift(other[0].toUpperCase() + other.slice(1) + ".");
    const name = found[6] && !/^(?:weapon|unarmed)$/i.test(found[6]) ? found[6].toLowerCase() : null;
    return {
        builtin: "self-effect",
        actions: Number(item.system?.actions?.value) || 1,
        model: { name: item.name, rounds, modifiers: [], tempHp: 0 },
        damage,
        strike: name,
        melee: /^melee$/i.test(found[5] ?? ""),
        duration,
        ...(stance ? { stance: true } : {}),
        ...(notes.length ? { notes } : {})
    };
}

export function compileBuiltin(item, slug) {
    const rules = item?.system?.rules ?? [];
    const fastHealing = rules.find((rule) => rule?.key === "FastHealing");
    if (fastHealing && !fastHealing.predicate?.length && Number.isFinite(Number(fastHealing.value))) {
        if (fastHealing.type === "regeneration") return { builtin: "regeneration", value: Number(fastHealing.value), deactivatedBy: [...(fastHealing.deactivatedBy ?? [])] };
        return { builtin: "fast-healing", value: Number(fastHealing.value) };
    }
    const type = item?.system?.actionType?.value;
    if (type === "passive") {
        const extras = strikeExtras(item);
        if (extras.length) return { builtin: "strike-extra", extras };
        const bonuses = saveBonuses(item);
        if (bonuses.length) return { builtin: "save-bonus", bonuses };
    }
    // (Links as their labels for every reading here, batch 23: "@UUID[…]{Grab}" as "Grab".)
    const text = htmlToPlainText(item?.system?.description?.value ?? "").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\s+/g, " ").trim();
    if (type === "passive") {
        const momentum = slug === "draconic-momentum" || /critical hit with a Strike/i.test(text) ? readMomentum(text) : null;
        if (momentum) return { builtin: "momentum", ...momentum };
        return readSteady(text) ?? readGolemAntimagic(text) ?? readPermanent(text) ?? readNaturallyInvisible(text);
    }
    // Reactions, and free actions with a trigger (Cushioned Blow).
    if (type === "reaction" || (type === "free" && /\bTrigger\b/.test(text))) return readReaction(item, text);
    // (Free actions with no trigger, batch 41: Quickened Casting, Drain Bonded Item.)
    if (type === "free") {
        const quickened = readQuickenedCasting(text);
        if (quickened) return quickened;
        return readGmSpellcasting(text) ? { builtin: "no-effect" } : null;
    }
    if (type !== "action") return null;
    const actions = Number(item.system?.actions?.value) || 1;
    const multi = readMultiStrikes(text);
    if (multi) return { builtin: "multi-strike", actions, strikes: multi.strikes, ...(multi.sameMap ? { sameMap: true } : {}), ...(multi.sameTarget ? { sameTarget: true } : {}), ...(multi.oncePerTurn ? { oncePerTurn: true } : {}), ...(multi.each ? { each: true, max: multi.max } : {}), ...(multi.grab ? { grab: true } : {}), ...(multi.penalty ? { penalty: multi.penalty } : {}), ...(multi.requires ? { requires: multi.requires } : {}), ...(multi.after ? { after: multi.after } : {}) };
    const sweep = readSweep(text);
    if (sweep) return { builtin: "multi-strike", actions, strikes: [sweep.strike], each: true, ...(sweep.sameMap ? { sameMap: true } : {}) };
    // One roll against up to two foes (Swipe): a Strike at each, at the same penalty, counted as that many attacks.
    const swipe = readSwipe(text);
    if (swipe) return { builtin: "multi-strike", actions, strikes: [swipe.strike], each: true, max: swipe.max, sameMap: true };
    const charge = readCharge(text);
    // (Its moves and Strike in its actions, or more: Swoop's 2 actions for one Fly and a Strike, batch 25.)
    if (charge && actions >= charge.strides && actions <= 3) return { builtin: "charge", actions, ...charge };
    if (readStrikeOnly(text)) return { builtin: "no-effect", strikeOnly: true };
    if (readSafeMove(text) || readRetreat(text)) return { builtin: "safe-move", actions };
    // (Batch 41: the user's choices, 2026-10-11.)
    const mythic = readMythic(text);
    if (mythic) return { ...mythic, actions };
    const quickened = readQuickenedCasting(text);
    if (quickened) return quickened;
    if (readSpellstrike(item, text)) return { builtin: "spellstrike", actions };
    // Speed Surge (batch 41; the user's choice: a one-action double move, three a fight): "Frequency three times per day Effect The drake
    // Strides or Flies twice", "… moves up to twice its Speed. It can do this three times per day."
    const moves = String.raw`(?:Strides|Flies|Swims|Burrows|Climbs|moves)(?: or (?:Strides|Flies|Swims|Burrows|Climbs))?`;
    const surge = new RegExp(String.raw`^(?:Frequency (\w+) times per day[;.]? Effect )?(?:The )?[^.]+? ${moves} (?:twice|up to twice (?:its|their|his|her) Speed)\.?(?: (?:It|They|He|She) can do this (\w+) times per day\.)?$`, "i").exec(text.trim());
    if (surge && (surge[1] || surge[2])) return { builtin: "speed-surge", actions, uses: Number(surge[1] ?? surge[2]) || { two: 2, three: 3 }[(surge[1] ?? surge[2]).toLowerCase()] || 3 };
    if (readGmSpellcasting(text)) return { builtin: "no-effect" };
    const prey = readHuntPrey(text);
    if (prey) return prey;
    if (readNoCombatEffect(text)) return { builtin: "no-effect" };
    return null;
}

// A bonus to its own AC for a while (2026-10-10, batch 39): "He gains a +2 circumstance bonus to AC until the start of his next turn"
// (Dueling Parry), "They gain a +1 circumstance bonus to AC until the start of their next turn" (Hydraulic Deflection), "Until the start
// of its next turn, it gains a +2 circumstance bonus to AC, and when an adjacent creature touches it … takes 2d6 persistent fire
// damage …" (Armor of Flames: the rest for the GM), "… or a +2 circumstance bonus if either weapon has the parry trait" (the GM's).
// → { builtin: "self-effect", actions, model: { name, rounds, modifiers: [{ on: "ac", type, value }], tempHp: 0 }, duration, notes? }.
// Not with a trigger, nor a requirement other than what it holds ("is wielding", "has his other hand free").
export function readSelfGuard(item) {
    if (item?.system?.actionType?.value !== "action") return null;
    const text = htmlToPlainText(item?.system?.description?.value ?? "").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\s+/g, " ").trim();
    // (Not one that links PF2e's own effect, which its effect reading uses.)
    if (/\bTrigger\b/.test(text) || /@UUID\[Compendium\.[\w-]+\.[\w-]*effects?\.Item\./i.test(item?.system?.description?.value ?? "")) return null;
    const required = /^Requirements? (.+?) Effect /.exec(text)?.[1] ?? "";
    if (required && !/^(?:The )?[\w' -]+? (?:is wielding [^.]+|has (?:a|an|one|two|his|her|its|their) [^.]*?(?:weapon|shield|hand)[^.]*)$/i.test(required.trim())) return null;
    const body = text.replace(/^Requirements? .+? Effect /, "").replace(/^Frequency [^.]*? Effect /, "");
    const sentences = body.split(/(?<=\.)\s+(?=[A-Z])/);
    const until = String.raw`until the (start|beginning|end) of (?:its|their|his|her|the [\w' -]+?['’]s|[A-Z][\w'-]+['’]s) next turn`;
    const gains = new RegExp(String.raw`^(?:(?:Until the (start|beginning|end) of (?:its|their|his|her|the [\w' -]+?['’]s|[A-Z][\w'-]+['’]s) next turn), )?(?:The [\w' -]+?|It|They|He|She|[A-Z][\w'-]+(?: [A-Z][\w'-]+)?) gains? an? \+(\d+) (circumstance|status) bonus to (?:its |their |his |her )?AC(?: ${until})?((?:, or an? \+\d+ circumstance bonus if [^.,]+)?(?:,? (?:as long as|but loses this bonus if) [^.]+)?(?:, and [^.]+)?)\.$`, "i");
    let found = null;
    let at = -1;
    for (const [index, sentence] of sentences.entries()) {
        const match = /\b(?:Strikes?|Steps?|Strides?)\b/.test(sentence) ? null : gains.exec(sentence);
        if (match) {
            found = match;
            at = index;
            break;
        }
    }
    if (!found) return null;
    const edge = found[1] ?? found[4];
    if (!edge) return null;
    const rounds = /end/i.test(edge) ? 2 : 1;
    const notes = [];
    for (const [index, sentence] of sentences.entries()) {
        if (index === at) continue;
        // (A first sentence that only tells what it does.)
        if (index < at && !/\d|\b(?:damage|bonus|penalty|save|check|Strike|Hit Points)\b/i.test(sentence)) continue;
        if (/^Effect: /.test(sentence)) continue;
        notes.push(sentence);
    }
    const rest = (found[5] ?? "").replace(/^, (?:and |or )?/, "").trim();
    if (rest) notes.unshift(rest[0].toUpperCase() + rest.slice(1) + ".");
    // (More than its AC in the other sentences, a Strike or a move: not this reading.)
    if (notes.some((note) => /\b(?:Strikes?|Strides?|Steps?|Flies|Swims)\b/.test(note))) return null;
    return {
        builtin: "self-effect",
        actions: Number(item.system?.actions?.value) || 1,
        model: { name: item.name, rounds, modifiers: [{ on: "ac", type: found[3].toLowerCase(), value: Number(found[2]) }], tempHp: 0 },
        duration: { value: 1, unit: "rounds", expiry: rounds === 2 ? "turn-end" : "turn-start" },
        ...(notes.length ? { notes } : {})
    };
}

// Hunt Prey in a monster's own words (2026-10-10, batch 39): "The hunter designates a single creature they can see and hear, or one
// they're Tracking, as their prey. … The first time the hunter hits the designated prey in a round, they deal an additional 1d8
// precision damage. …" → { builtin: "hunt-prey", edge: "precision", dice, die }; with only the bonuses to Seek and Track and the
// range increment (no damage), nothing for the fight's numbers. null when it isn't Hunt Prey.
function readHuntPrey(text) {
    // (Batch 42: "designates one or two targets he can see or hear as his prey", "designates a single creature he can see or hear, and
    // gains a +2 circumstance bonus to Perception checks to Seek and Track that prey".)
    if (!/\bdesignates? (?:a single|one|one or two) (?:creature|targets?)\b[^.]*\bas (?:its|their|his|her|your) prey\b|\bdesignates? as (?:its|their|his|her) prey (?:a single|one) creature\b|\bdesignates? a single creature (?:it|they|he|she) can see or hear, and gains a \+2 circumstance bonus to Perception checks to Seek and Track that prey\b/i.test(text)) return null;
    const edge = /\bThe first time (?:the [\w' -]+?|an? [\w' -]+?|[A-Z][\w'-]+|it|they|he|she) hits? (?:the|its|their|his|her) (?:(?:designated|hunted) )?prey in a round, (?:it|they|he|she|the [\w' -]+?) (?:deals?|inflicts?) (?:an additional (\d+)d(\d+)|(\d+)d(\d+) additional) precision damage\./i.exec(text)
        // (The same edge with "each round" before the hit and "with a Strike" after it; "she deals 1d8 precision damage to her prey the
        // first time she hits her prey each round".)
        ?? /\bThe first time each round that (?:the [\w' -]+?|[A-Z][\w'-]+|it|they|he|she) hits? (?:its|their|his|her) prey with a Strike, (?:it|they|he|she) deals? an additional (\d+)d(\d+) precision damage\./i.exec(text)
        ?? /\b(?:it|they|he|she) deals? (\d+)d(\d+) precision damage to (?:its|their|his|her) prey the first time (?:it|they|he|she) hits? (?:its|their|his|her) prey each round\./i.exec(text);
    if (edge) return { builtin: "hunt-prey", edge: "precision", dice: Number(edge[1] ?? edge[3]), die: Number(edge[2] ?? edge[4]) };
    // (Its other words: the Seek and Track bonuses, the range increment, how long it lasts, a new prey in place of the old.)
    const rest = text.split(/(?<=\.)\s+(?=[A-Z])/).filter((sentence) => !/\bdesignates?\b|\bcircumstance bonus to (?:Perception|Survival)\b|\bsecond range increment\b|\b(?:These effects|This effect|The effects?) lasts? until\b|\bcan (?:have only|only have) one (?:creature|prey)(?: so)? designated\b|\bmust be able to see(?:,| or) (?:or )?hear\b|\bloses the designation\b|\bdesignation lasts\b/i.test(sentence));
    return rest.length ? null : { builtin: "no-effect" };
}

// Mythic abilities (2026-10-11, batch 41; the user's choice: three Mythic Points a fight in the simulator, a note for the GM in live
// play): "Cost 1 Mythic Point Effect The creature ends one condition affecting it." (remove-condition), "Cost 1 Mythic Point Effect The
// risen runelord regains an expended spell slot or can use Quickened Casting again." (recharge). null otherwise.
function readMythic(text) {
    const said = String(text).trim();
    if (!/^Cost 1 Mythic Point Effect /i.test(said)) return null;
    if (/^Cost 1 Mythic Point Effect (?:The )?[^.]+? (?:ends|removes) (?:any )?one condition (?:currently )?affecting (?:it|itself|them|themselves|themself|him|himself|her|herself)\.$/i.test(said)) return { builtin: "mythic", kind: "remove-condition" };
    const recharge = /^Cost 1 Mythic Point Effect (?:The )?[^.]+? regains (?:an expended|a previously cast) spell(?: slot)?( or can use Quickened Casting again)?\.$/i.exec(said);
    if (recharge) return { builtin: "mythic", kind: "recharge", ...(recharge[1] ? { quickened: true } : {}) };
    // ("gains one additional use of a spell or ability that is normally only available a limited number of times", "… of Breathe Energy".)
    return /^Cost 1 Mythic Point Effect (?:The )?[^.]+? gains one additional use of\b/i.test(said) ? { builtin: "mythic", kind: "recharge", abilities: true } : null;
}

// Quickened Casting (2026-10-11, batch 41): "Frequency once per day Effect If the risen runelord's next action is to cast a cantrip or
// spell that's 4th-rank or lower, reduce the number of actions to cast it by 1 (minimum 1 action)." → { builtin: "quickened-casting",
// maxRank } (null: any rank). The tradition it names ("a sorcerer spell", "an occult spell") is the GM's.
function readQuickenedCasting(text) {
    const said = String(text).trim();
    // (Not with a requirement the simulation can't check: "is possessing a host using Mind Worm".)
    if (/\bRequirements?\b/.test(said) && !/\bRequirements? (?:The )?[^.]+? hasn't used Quickened Casting since\b/i.test(said)) return null;
    if (!/^(?:Frequency [^.;]+?[.;]?\s*(?:Requirements? [^.]+? )?(?:Effect )?)?(?:If|When) (?:the [\w' -]+?['’]s|[A-Z][\w'-]+(?: [A-Z][\w'-]+)?['’]s|its|their|his|her) next action is to cast [^.]*?\breduces? the number of actions to cast it by 1 \(minimum 1 action\)\.$|^(?:Frequency [^.;]+?[.;]?\s*(?:Effect )?)?When (?:the [\w' -]+?|[A-Z][\w'-]+(?: [A-Z][\w'-]+)?) casts a spell [^.]*?\breduce the number of actions to cast it by 1 \(minimum 1 action\)\.$/i.test(said)) return null;
    const rank = /\b(\d+)(?:st|nd|rd|th)(?:-| )(?:or lower )?(?:rank|level)\b/i.exec(said)?.[1];
    return { builtin: "quickened-casting", maxRank: rank ? Number(rank) : null };
}

// A monster's Spellstrike (2026-10-11, batch 41): "… Casts a Spell that takes 1 or 2 actions to cast and requires a spell attack roll
// … makes a melee Strike …", "channels a spell … into a claw or greatsword Strike": a magus's Spellstrike (the simulator's C20).
function readSpellstrike(item, text) {
    return (/^Spellstrike$/i.test(String(item?.name ?? "").trim()) || /\bchannels a spell\b/i.test(text)) && (/\bspell attack roll\b/i.test(text) || /\bchannels a spell into\b/i.test(text)) && /\bStrike\b/.test(text);
}

// Spellcasting the simulation doesn't play, and the harrowkin's initiative tricks (2026-10-11, batch 41; the user's choice: the GM's):
// Drain Bonded Item ("cast one prepared spell … already cast … without spending a spell slot"), Reach Spell ("increase that spell's
// range by 30 feet"), Counterspell ("expends a prepared spell to counter the triggering creature's casting of that same spell"), Shuffle
// the Deck (rerolled initiative), Read the Cards (a suit's effects as it rolls initiative).
function readGmSpellcasting(text) {
    const said = String(text).trim();
    return /\bcast one prepared spell (?:that )?(?:they|he|she|it) (?:had )?(?:already )?(?:previously )?(?:prepared today and already )?cast\b[^.]*\bwithout spending a spell slot\b/i.test(said)
        || /\bcan cast one prepared spell (?:she|he|they|it) has already cast\b/i.test(said)
        || /\bcast one (?:prepared )?spell (?:you|they|he|she|it) prepared today and already cast\b/i.test(said)
        || /\bregains the ability to cast one spell (?:she|he|they|it) has already cast\b/i.test(said)
        || /\bexpends (?:one of (?:its|their|his|her) spell slots|a prepared spell),? (?:to counter|losing the spell slot)\b/i.test(said)
        || /\bIf the next action (?:[\w' -]+? |you )?(?:takes|uses|use) is to Cast a Spell that has a range, increase that spell's range by 30 feet\b/i.test(said)
        || /\bexpends a prepared spell to counter the triggering creature's casting of (?:that|the) same spell\b/i.test(said)
        || /\ball creatures currently in initiative reroll their initiative\b/i.test(said)
        || /^Trigger (?:The )?[^.]+? is about to roll initiative Effect (?:The )?[^.]+? attempts to rewrite destiny\b/i.test(said);
}

// A retreat with a bonus to its AC against the reactions it triggers (2026-10-11, batch 41; the user's choice: a move that doesn't
// trigger reactions): "Requirements The kobold warrior is adjacent to at least one enemy. Effect The kobold warrior Strides up to its
// Speed plus 5 feet and gains a +2 circumstance bonus to AC against reactions triggered by this movement. It must end this movement in a
// space that's not adjacent to any enemy." (Hurried Retreat, Scamper; also "If the kobold is adjacent to at least one enemy, …").
function readRetreat(text) {
    const said = String(text).replace(/’/g, "'").trim().replace(/^Requirements? (?:The )?[^.]+? is adjacent to at least one enemy\.? Effect /i, "").replace(/^If (?:the )?[^,]+? is adjacent to at least one enemy, /i, "");
    return /^(?:The )?[^.]+? Strides up to (?:its|their|his|her) (?:s|S)peed(?: plus 5 feet)?|^(?:The )?[^.]+? Strides up to \d+ feet/i.test(said)
        && /\band gains? a \+2 circumstance bonus to AC against reactions triggered by this movement\.(?: (?:It|They|He|She|The [\w' -]+?) must end this movement in a space that's not adjacent to any enemy\.)?$/i.test(said);
}

// A move that doesn't trigger reactions (2026-10-10, batch 38): "The cultist jumps up to half its Speed. This movement doesn't
// trigger reactions." (Swift Leap), "… moves up to 60 feet in a straight line through the water without triggering reactions"
// (Jet), "Strides up to his Speed and does not trigger reactions during this movement". Only the move: not with a Strike, a check
// or a condition on where it goes ("but must begin and end in dim light"). true or false.
function readSafeMove(text) {
    const sentences = String(text).replace(/’/g, "'").trim().split(/(?<=[.;])\s+(?=[A-Z])/);
    if (sentences.length === 3 && !/\b(?:damage|bonus|penalty|save|check|DC|Hit Points|HP|Strike)\b|\d/.test(sentences[0])) sentences.shift();
    const said = sentences.join(" ");
    if (/\b(?:Strikes?|checks?|saves?|damage|but|if|unless|Grab|Prone|Interacts?)\b|@/i.test(said) || /\b(?:Requirements?|Trigger)\b/.test(said)) return false;
    const move = String.raw`(?:jumps|moves|Strides|Flies|Flying|Swims|Leaps|Climbs|Burrows)`;
    return new RegExp(String.raw`^(?:The |An? )?[^.;]+? ${move} (?:up to|once|twice)?[^.;]*?(?:\. This movement (?:doesn't|does not) trigger reactions\.|; this movement (?:doesn't|does not) trigger reactions\.| without triggering reactions\.| and (?:doesn't|does not) trigger reactions during this movement\.)$`, "i").test(said);
}

// No change to a fight's numbers, in its own words (2026-10-10, batch 38): a disguise that "doesn't change its Speed or its attack
// and damage modifiers with its Strikes" (Change Shape and its kin), capsizing a vessel, a Step when an ally moves next to it, two
// Strides with a bonus to its Speed (Gallop). true or false.
function readNoCombatEffect(text) {
    const said = String(text).replace(/’/g, "'").trim();
    // (Batch 42: a statue or a corpse until it acts — "Until the next time it acts, the gargoyle appears to be a statue. It has an
    // automatic result of 32 on Deception checks and DCs to pass as a statue." — not with more for it, such as fast healing while it
    // stays still; a web line it descends on; a move and a reload, which the simulation does with its own Interact.)
    const sentences = said.split(/(?<=\.)\s+(?=[A-Z])/);
    const disguise = sentences.findIndex((sentence) => /^Until the next time (?:it|they|he|she) (?:acts?|uses? an action), (?:the )?[^.]+? appears to be (?:a statue|an ordinary corpse)\.$/i.test(sentence));
    if (disguise >= 0) {
        return sentences.every((sentence, index) => index === disguise
            || /\bhas an automatic result of \d+ on Deception checks and DCs to pass as (?:a statue|an ordinary corpse)\.$|\bhave an automatic result of \d+ on Deception checks and DCs to pass as (?:a statue|an ordinary corpse)\.$/i.test(sentence)
            || /^A creature must succeed at a @Check\[perception[^\]]*\] check to figure out that the statue is really a creature\.$/i.test(sentence)
            || (index < disguise && /, falls Prone, and lies completely still\.$/i.test(sentence))
            || (index > disguise && !/@|\d|\b(?:fast healing|regeneration|damage|Hit Points|HP|bonus|penalty|Strikes?|saves?|DC|conditions?)\b/i.test(sentence)));
    }
    if (/^(?:The )?[^.]+? moves straight down up to \d+ feet, suspended by a web line\. (?:It|They) can hang from the web or drop off\. The distance (?:it|they) Descends? on a Web (?:doesn't|does not) count (?:when calculating|for) falling damage\./i.test(said)) return true;
    if (/^(?:The )?[^.]+? Strides?, Steps,? or Sneaks,? (?:and )?then Interacts to reload(?: (?:its|his|her|their) [\w' -]+)?\.?$/i.test(said)) return true;
    if (/@|\bTrigger\b(?! A [\w' -]+ ally ends a move action adjacent to)/.test(said) && !/^Trigger A [\w' -]+ ally ends a move action adjacent to [^.]+\.? Effect (?:The )?[^.]+? Steps\.$/.test(said)) return false;
    if (/^Trigger A [\w' -]+ ally ends a move action adjacent to [^.]+\.? Effect (?:The )?[^.]+? Steps\.$/.test(said)) return true;
    // (A disguise: its numbers stay as they are.)
    if (/\b(?:take|takes|taking) (?:on )?the (?:specific )?appearance of\b/i.test(said) && /\b(?:doesn't|does not) change (?:its|their|his|her) (?:Speed or (?:its|their|his|her) )?attack and damage (?:bonuses|modifiers) with (?:its|their|his|her) Strikes\b/i.test(said) && !/\b(?:increases?|decreases?|gains?|loses?)\b/i.test(said)) return true;
    if (/^(?:The )?[^.]+? tries to capsize an adjacent (?:aquatic )?vessel\b/i.test(said)) return true;
    // (A weapon of its own that appears in its hand, batch 40: the simulation has its Strikes ready.)
    if (/^Requirements (?:The )?[^.]+? (?:isn't|is not) holding (?:a|an|its|their|his|her) [\w' -]+? Effect (?:The )?[^.]+? causes (?:its|their|his|her) [^.]*?(?:polearm|weapon|blade|sword)[^.]* to appear in one of (?:its|their|his|her) hands\b/i.test(said)) return true;
    return /^(?:The )?[^.]+? Strides twice\. (?:It|They|He|She) (?:has|have) a \+\d+-foot circumstance bonus to (?:its|their|his|her) Speed during these Strides\.$/i.test(said);
}

// Only a Strike, with what comes with it the simulation doesn't play (2026-10-10, batch 37): "Calmont draws his weapon and attacks
// with the same motion. He Interacts to draw a weapon, then Strikes with that weapon." (Quick Draw), "… draws an alchemical bomb with
// an Interact action and throws it as a ranged Strike", "… reloads its sling and makes a sling Strike" (made up), "… makes a boomerang
// Strike, after which the boomerang returns to its hand", "makes a Strike with his fist and increases his reach by 5 feet for this
// Strike". Live play: the Strike from the sheet; nothing more to apply. true or false.
function readStrikeOnly(text) {
    const sentences = String(text).trim().replace(/^Frequency once per (?:turn|round) Effect /i, "").split(/(?<=\.)\s+(?=[A-Z])/);
    // (A first sentence that only tells what it does; batch 42: "The hunter's feet and weapons move in tandem.")
    if (sentences.length === 2 && !/\b(?:damage|bonus|penalty|save|check|DC|Hit Points|HP|Grab|Prone)\b|\d/.test(sentences[0])) sentences.shift();
    if (sentences.length !== 1) return false;
    const [sentence] = sentences;
    const who = String.raw`^(?:The |An? )?[^.]+?`;
    const draw = new RegExp(String.raw`${who} (?:Interacts? to draw|draws?) (?:a|an|his|her|its|their) [^,.]+?(?: using the Interact action| with an Interact action)?,? (?:and |then |and then )+(?:Strikes with (?:it|that weapon|the weapon)|throws it as a ranged Strike|makes an? (?:[\w' -]+? )?Strike with it)(?:,? or [^.]+)?\.$`, "i");
    const reload = new RegExp(String.raw`${who} reloads (?:its|his|her|their) [\w' -]+? and makes an? (?:[\w' -]+? )?Strike\.$`, "i");
    const returning = new RegExp(String.raw`${who} makes an? (?:[\w' -]+? )?Strike, after which the [\w' -]+? returns to (?:its|his|her|their|the [\w' -]+?'s) hand\.$`, "i");
    const reach = new RegExp(String.raw`${who} (?:makes a Strike with (?:his|her|its|their) [\w' -]+? and increases (?:his|her|its|their) reach by \d+ feet for this Strike|(?:lunges [^,.]+, making|makes) an? (?:[\w' -]+? )?Strike with an? (?:extended )?reach of \d+ feet)\.$`, "i");
    // (Batch 42, Skirmish Strike: "The hunter can Step and then Strike, or Strike and then Step.")
    const skirmish = new RegExp(String.raw`${who} (?:can )?(?:either )?Steps? and then Strikes?,? or Strikes? and then Steps?\.$`, "i");
    return [draw, reload, returning, reach, skirmish].some((pattern) => pattern.test(sentence));
}
