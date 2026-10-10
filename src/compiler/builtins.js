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
    let body = text.trim();
    let oncePerTurn = false;
    const frequency = /^Frequency (.+?) Effect /i.exec(body);
    if (frequency) {
        if (!/^once per (?:turn|round)$/i.test(frequency[1].trim())) return null;
        oncePerTurn = true;
        body = body.slice(frequency[0].length);
    }
    if (/^(?:Requirements?|Trigger|Prerequisites?)\b/i.test(body)) return null;
    const sentences = body.replace(/,? which (?:it|they) can make in any order\./i, ".").split(/(?<=\.)\s+(?=[A-Z])/);
    const first = sentences.shift() ?? "";
    let sameMap = false;
    let sameTarget = false;
    let grab = false;
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
        if (/\bcombine(?:s|d)? (?:their|the) damage\b|\bdamage is combined\b/i.test(sentence) && !/\b(?:save|must|condition|additional|extra|takes?|Grabbed|Prone|Stunned)\b/i.test(sentence.replace(/\bapply (?:resistances|weaknesses)[^.]*/i, ""))) continue;
        if (/^Each (?:Strike|attack) must target a different creature\.$/i.test(sentence)) continue;
        if (/^Both (?:Strikes|attacks) must (?:have|target) the same (?:target|creature)\.$/i.test(sentence)) {
            sameTarget = true;
            continue;
        }
        // "If either Strike hits, the dragon can attempt to Grab the target with that limb as a free action." (and how many it can
        // hold): Grab after a hit.
        if (/^If (?:either|any|both|one) (?:of the )?(?:Strikes?|attacks?) hits?, (?:it|they|he|she|the [\w' -]+?) can (?:attempt to )?Grab the (?:target|creature)(?: with (?:that|the) [\w ]+?)? as a free action\.$/i.test(sentence)) {
            grab = true;
            continue;
        }
        if (grab && /^(?:It|They|He|She|The [\w' -]+?) can have up to (?:two|three|four|\w+) creatures Grabbed\b/i.test(sentence)) continue;
        return null;
    }
    // (A Strike at each of several creatures: all with its first Strike.)
    if (each && new Set(strikes).size > 1) return null;
    return { strikes, sameMap, sameTarget, oncePerTurn, ...(each ? { each: true, max: strikes.length } : {}), ...(grab ? { grab: true } : {}) };
}

// One attack roll against several foes' AC (Swipe, Wide Swing; 2026-10-10): "The veteran makes a melee Strike and compares the
// attack roll result to the AC of up to two foes, each of whom must be within their melee reach and adjacent to each other. Roll
// damage only once and apply it to each creature hit. A Swipe counts as two attacks for the veteran's multiple attack penalty."
// → { strike, max }, or null.
export function readSwipe(text) {
    const sentences = text.trim().split(/(?<=\.)\s+(?=[A-Z])/);
    const match = /^(?:The )?[^.]+? makes an? (?:([\w' -]+?) )??Strike and compares the attack roll(?: result)? to the (?:AC|Armor Class) of up to (two|three) (?:foes|enemies|creatures|targets)(?:, each of whom must be within (?:its|their|his|her|the Strike's) (?:melee )?reach(?: and adjacent to each other)?)?\.$/i.exec(sentences.shift() ?? "");
    if (!match) return null;
    for (const sentence of sentences) {
        if (/^Roll (?:the )?damage only once(?:,)? and apply it to each creature (?:hit|it hits)\.$/i.test(sentence)) continue;
        if (/^(?:An? |The )?[\w' -]+? counts as (?:two|three) attacks (?:for|when calculating) [^.]*multiple attack penalty\.$/i.test(sentence)) continue;
        return null;
    }
    const strike = match[1] && !/^(?:melee|weapon|unarmed)$/i.test(match[1]) ? match[1].replace(/^(?:melee|ranged)\s+|\s+(?:melee|ranged)$/gi, "").toLowerCase() : null;
    return { strike, max: NUMBERS[match[2].toLowerCase()] };
}

// "The guard Strides twice. If it ends its movement within melee reach of at least one enemy, it makes a melee Strike against
// that enemy." (Sudden Charge; 2026-10-10) → "The guard Strides twice and makes a melee Strike." for the charge readers.
export function chargeSentences(text) {
    return String(text).replace(/\b(Strides twice|Strides up to (?:double|twice) (?:its|their|his|her) Speed|Flies twice|Flies up to (?:double|twice) (?:its|their|his|her) (?:fly )?Speed)\.\s+If (?:it|they|he|she|the [\w' -]+?) ends? (?:its|their|his|her) movement within (?:melee )?reach of (?:at least one|an?|any) (?:enemy|foe|creature|target), (?:it|they|he|she|the [\w' -]+?) (?:can )?makes? an? ((?:[\w' -]+? )?)Strike against (?:that|the) (?:enemy|foe|creature|target)\./gi, (_whole, move, strike) => `${move.replace(/up to (?:double|twice) (?:its|their|his|her) (?:fly )?Speed/i, "twice")} and makes a ${strike}Strike.`);
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
export function moveThenStrike(text) {
    const match = new RegExp(String.raw`^(?:The )?[^.]+? (${MOVES}(?: or ${MOVES})?)((?: (?:twice|three times|at least \d+ feet|up to (?:twice|three times|double|half|its|their|his|her|\d+ feet)[^,.]*?))?)(?: in a straight line)?(?:,? (?:while flying|descending at least \d+ feet))?,? (?:and |then |and then )+(?:makes|attempts) (?:a|an|one) (?:([\w' -]+?) )??Strike((?: (?:at any point during (?:that|the|its|this) (?:movement|Stride|move|flight|Fly)|at the end of (?:that|its|the|this) (?:movement|Stride|move)|against (?:a|an|one) (?:foe|enemy|creature|target) (?:within (?:its|their|his|her) reach|adjacent to it)|against an adjacent (?:creature|foe|enemy)))*)\.$`, "i").exec(text);
    if (!match) return null;
    const how = match[2].trim();
    const strides = /three times/i.test(how) ? 3 : /twice|double/i.test(how) ? 2 : 1;
    const name = match[3] && !/^(?:melee|weapon|unarmed|melee weapon)$/i.test(match[3].trim()) ? match[3].trim().replace(/^(?:melee|ranged)\s+/i, "").toLowerCase() : null;
    return { strides, strike: name };
}

// "The smilodon Strides and makes a Strike at the end of that movement." (the
// hidden note after it changes nothing in the simulation) → { strides, strike }.
// A charge's bonus for moving 20 feet comes along: "it gains a +2 circumstance
// bonus to its attack roll" → attackBonus; "the Strike's damage is increased
// to 3d10+20" → damage. Any other sentence: null.
export function readCharge(text) {
    const sentences = chargeSentences(text).trim().split(/(?<=\.)\s+/);
    // A first sentence that only describes it ("The goblin shark dashes forward and extends its jaws").
    if (sentences.length > 1 && !/\b(?:Strikes?|save|damage|check|DC|bonus|penalty|feet|Hit Points|@\w+\[)\b/i.test(sentences[0]) && /^The [\w' -]+? [a-z]+s\b/.test(sentences[0]) && moveThenStrike(sentences[1] ?? "")) sentences.shift();
    const match = /^The [^.]+? Strides( twice)? and (?:then )?makes an? (?:([\w' -]+?) )?Strike(?: at the end of that movement)?\.$/i.exec(sentences[0] ?? "");
    // Other moves and wordings (2026-10-10): "Flies up to double its fly Speed and then makes a talon Strike".
    const other = match ? null : moveThenStrike(sentences[0] ?? "");
    if (!match && !other) return null;
    const charge = other ?? { strides: match[1] ? 2 : 1, strike: match[2] && !/^(?:melee|weapon|unarmed|melee weapon)$/i.test(match[2].trim()) ? match[2].toLowerCase() : null };
    const moved = "^(?:If|As long as) (?:it|they|the [\\w' -]+?) moved at least 20 feet(?: away from (?:its|their) starting position)?, ";
    for (const sentence of sentences.slice(1)) {
        if (/remains? hidden until after/i.test(sentence)) continue;
        const bonus = new RegExp(`${moved}(?:it gains|they gain) a \\+(\\d+) circumstance bonus to (?:its|their|this) attack roll\\.$`, "i").exec(sentence);
        const damage = new RegExp(`${moved}the Strike's damage (?:is increased to|increases to) (.+?)(?: damage)?\\.$`, "i").exec(sentence);
        if (bonus) charge.attackBonus = Number(bonus[1]);
        else if (damage) charge.damage = damage[1].trim();
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
    const [trigger, effect] = [/Trigger (.+?)(?= Effect |$)/i.exec(text)?.[1] ?? "", /Effect (.+)$/i.exec(text)?.[1] ?? ""];
    if (!trigger || !effect) return trigger ? acDodge(text, trigger, effect) : null;
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
    if (/\bRequirements? (?![^.]*?\bnot encumbered\b)/i.test(text)) return null;
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
    if (!bonus || !SELF_ATTACKED.test(trigger)) return null;
    // (Shielding Wing protects "itself or the bonded companion": its own part is read.)
    if (/\b(?:ally|allies|rider|liege|object|spells?|splash|area|bow|until)\b/i.test(`${trigger} ${effect.slice(0, bonus.index + 120)}`) || (!shared && /\bcompanion\b/i.test(effect.slice(0, bonus.index + 120)))) return null;
    const melee = /\bmelee\b|\badjacent\b/i.test(trigger);
    const ranged = /\branged\b/i.test(trigger);
    // Its sentence and any more: a note when it says more than the bonus against the attack.
    // (Not the PF2e effect it links: "… Effect: Shielding Wing".)
    const plain = effect.trim().replace(/\s*\bEffect: [^.]+$/, "");
    const only = /^[^.]*?\+\d+ circumstance bonus to (?:its |their |his |her )?(?:AC|Armor Class)(?: against (?:the|that) triggering (?:attack|Strike))?\.?$/i.test(plain);
    return { builtin: "ac-reaction", value: Number(bonus[1]), when: "targeted", ...(melee !== ranged ? { against: melee ? "melee" : "ranged" } : {}), ...(only ? {} : { notes: [plain] }) };
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

// The builtin for an item, or null.
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
    const text = htmlToPlainText(item?.system?.description?.value ?? "").replace(/\s+/g, " ").trim();
    if (type === "passive") {
        const momentum = slug === "draconic-momentum" || /critical hit with a Strike/i.test(text) ? readMomentum(text) : null;
        if (momentum) return { builtin: "momentum", ...momentum };
        return readPermanent(text);
    }
    // Reactions, and free actions with a trigger (Cushioned Blow).
    if (type === "reaction" || (type === "free" && /\bTrigger\b/.test(text))) return readReaction(item, text);
    if (type !== "action") return null;
    const actions = Number(item.system?.actions?.value) || 1;
    const multi = readMultiStrikes(text);
    if (multi) return { builtin: "multi-strike", actions, strikes: multi.strikes, ...(multi.sameMap ? { sameMap: true } : {}), ...(multi.sameTarget ? { sameTarget: true } : {}), ...(multi.oncePerTurn ? { oncePerTurn: true } : {}), ...(multi.each ? { each: true, max: multi.max } : {}), ...(multi.grab ? { grab: true } : {}) };
    const sweep = readSweep(text);
    if (sweep) return { builtin: "multi-strike", actions, strikes: [sweep.strike], each: true, ...(sweep.sameMap ? { sameMap: true } : {}) };
    // One roll against up to two foes (Swipe): a Strike at each, at the same penalty, counted as that many attacks.
    const swipe = readSwipe(text);
    if (swipe) return { builtin: "multi-strike", actions, strikes: [swipe.strike], each: true, max: swipe.max, sameMap: true };
    const charge = readCharge(text);
    if (charge && actions === charge.strides) return { builtin: "charge", actions, ...charge };
    return null;
}
