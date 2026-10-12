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
import { inlineTags, readDamage, readableText } from "./inline.js";

const NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
// "four", "4" → 4; 0 when it isn't a number (batch 43: "up to six claw Strikes", "up to 12 jaws Strikes").
export const countWord = (word) => NUMBERS[String(word ?? "").toLowerCase()] ?? (Number(word) || 0);
const COUNT = String.raw`(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)`;

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
const BOTH_CONDITIONS = "Prone|Grabbed|Slowed|Stunned|Off-Guard|Frightened|Sickened|Enfeebled|Clumsy|Dazzled|Blinded|Deafened|Immobilized|Restrained";
export function readMultiStrikes(text) {
    // "Frequency once per turn Effect The bruiser makes …": once a turn; a longer frequency or a requirement: not read.
    // (Links as their labels, batch 23: "can attempt to @UUID[…]{Grab} the target" read as "Grab".)
    let body = String(text).replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").trim()
        // (Batch 175, Hunter's Wound: "Prerequisites" for its requirement.)
        .replace(/(^|Frequency once per (?:turn|round) )Prerequisites? (?=(?:The )?[^.]+? is wielding\b)/i, "$1Requirements ");
    let oncePerTurn = false;
    // (Batch 130, Twin Butchery: "Frequency once per round; Requirement the hill giant butcher is wielding …" — its semicolon.)
    body = body.replace(/^(Frequency once per (?:turn|round));\s*(Requirements?) (?:the|The) /i, "$1 $2 The ");
    // (Batch 130, Haphazard Hack: "Requirements Rekarek is adjacent to two or more enemies Effect" — what its Strikes need anyway.)
    body = body.replace(/^Requirements? (?:The )?[^.]+? is adjacent to two or more enemies\.? Effect /i, "");
    // (Batch 42: what it wields, "Requirements The test slayer is wielding two melee weapons, each in a different hand Effect".)
    body = body.replace(/(^|Frequency once per (?:turn|round) )Requirements? (?:The |You )?[^.]+? (?:is wielding|are wielding|wields) two melee weapons, each in a different hand\.? Effect /i, (_all, before) => (before ? `${before}Effect ` : ""));
    // (Batch 129, Double Stab: "Requirements Ralso is wielding two piercing weapons Frequency once per round Effect …" — what it wields, then its
    // frequency.)
    body = body.replace(/^Requirements? (?:The )?[^.]+? (?:is|are) wielding two [\w' -]+? weapons\.? (?=Frequency )/i, "");
    // (Batch 200, Power Through: "Requirements The warmonger is wielding two melee weapons and isn't Fatigued Effect The warmonger attempts up to three
    // melee Strikes against different creatures. … The warmonger overexerts themself with the attacks, becoming fatigued. The warmonger can attempt a
    // … save to recover from this fatigued condition at the start of each of their turns." — not while Fatigued; Fatigued after, until it saves.)
    let notFatigued = false;
    let fatiguedAfter = null;
    body = body.replace(/^Requirements? (?:The )?[^.]+? (?:is|are) wielding two melee weapons and (?:isn't|is not|aren't|are not) Fatigued\.? Effect /i, () => {
        notFatigued = true;
        return "";
    }).replace(/ against different creatures\.(?= These count toward)/i, ", each against a different target.")
        .replace(/\bThese count toward (?:the [\w' -]+?['’]s|its|their) multiple attack penalty normally, but the penalty doesn't increase until after all the attacks\./i, "These attacks count toward its multiple attack penalty, but the penalty doesn't increase until after all the attacks.")
        .replace(/ (?:The [\w' -]+?|It|They) overexerts? (?:themself|itself|themselves) with the attacks, becoming fatigued\.(?: (?:The [\w' -]+?|It|They) can attempt an? (@Check\[[^\]]*\]) save to recover from this fatigued condition at the start of each of (?:its|their) turns\.)?$/i, (_all, check) => {
            fatiguedAfter = check ? `It becomes Fatigued; at the start of each of its turns it attempts a DC ${/dc:(\d+)/i.exec(check)?.[1] ?? "?"} Fortitude save to recover.` : "It becomes Fatigued.";
            return "";
        });
    // (Batch 91: Paired Strike's "Requirements The maftet is wielding two scimitars Effect …"; the "diferent" of some texts.)
    body = body.replace(/^Requirements? (?:The |You )?[^.]+? (?:is|are) wielding two [\w' -]+?s\.? Effect /i, "").replace(/\bdiferent\b/g, "different");
    // (Batch 109, Captive Rake: "Requirements A creature is grabbed in the glabrezu's pincer. Effect The glabrezu pulls the grabbed creature up to
    // 5 feet closer, then makes two claw Strikes against it. Those Strikes count as one attack …" — at the creature it holds.)
    let held = false;
    body = body.replace(/^Requirements? An? creature is grabbed in (?:the [\w' -]+?['’]s|its|their) [\w' -]+?\.? Effect (?:The [\w' -]+?|It|They) pulls the grabbed creature up to \d+ feet closer, then makes ([^.]+?) against it\./i, (_all, strikes) => {
        held = true;
        return `The creature makes ${strikes} against the same target.`;
    }).replace(/(?<=\. )Those Strikes count as one attack when determining (?:an? [\w' -]+?['’]s|its|their) multiple attack penalty, and the penalty doesn't increase until after both Strikes\.$/i, "This counts as one attack for its multiple attack penalty, and the penalty doesn't increase until after both attacks.");
    // (Batch 138, Spirit Shot: "Frequency once per round Requirements … Effect …" — the requirement read below.)
    body = body.replace(/^(Frequency once per (?:turn|round)) (?=Requirements? )/i, "$1 Effect ")
        // (Batch 150, a tanuki's flurry: "Frequency once per round. The tanuki makes two strikes." — no Effect label.)
        .replace(/^(Frequency once per (?:turn|round))\.\s+(?!Effect\b)/i, "$1 Effect ");
    const frequency = /^Frequency (.+?) Effect /i.exec(body);
    // (Batch 153, Heads Will Roll!: "Frequency once per minute" — once a fight.)
    let oncePerFight = false;
    if (frequency) {
        if (/^once per (?:minute|10 minutes|hour|day)$/i.test(frequency[1].trim())) oncePerFight = true;
        else if (!/^once per (?:turn|round)$/i.test(frequency[1].trim())) return null;
        else oncePerTurn = true;
        body = body.slice(frequency[0].length);
    }
    // (Batch 153, Double Shot: "Requirements The urdefhan hunter is wielding a ranged weapon with reload 0 Effect … makes two Strikes with the
    // required weapon at a single target" — its best ranged Strikes.)
    let rangedRequired = false;
    // (Batch 190, Dead Shot: its "two loaded firearms" after its frequency.)
    body = body.replace(/^Requirements? (?:The |You )?[^.]+? (?:is|are) wielding two [\w' -]+?s\.? Effect /i, "");
    body = body.replace(/^Requirements? (?:The )?[^.]+? is wielding a ranged weapon(?: with (?:a )?reload (?:of )?0)?\.? Effect /i, () => {
        rangedRequired = true;
        return "";
    });
    // (Batch 113: a requirement that names its own state — Drunken Flailing's "The drunkard is raging" — the GM's live, not planned by the
    // simulator: requires "requirement".)
    let stated = false;
    // (Batch 155: "is raging", "is enraged" — while its rage lasts, which the simulator knows: requires "raging".)
    let raging = false;
    // (Batch 153, Tail Thrash: "The soulrider is attached to a creature's soul" — the same.)
    body = body.replace(/^Requirements? (?:The )?[\w' -]+? is (raging|enraged|berserk|in [\w' -]+? stance|affected by [A-Z][\w' -]+?|attached to a creature's soul)\.? Effect /i, (_all, state) => {
        stated = true;
        raging = /^(?:raging|enraged)$/i.test(state);
        return "";
    })
        // (Batch 138: Sanguine Mauling's "The vrykolakas ancient's last action was to Drink Blood", Spirit Shot's "The duskwalker has designated
        // a creature as their prey using Spirit Hunter" — the same: the GM's live, not planned.)
        .replace(/^Requirements? (?:The )?[\w' -]+?(?:['’]s last action was (?:to )?[A-Z][\w' -]+?| has designated a creature as (?:its|their|his|her) prey using [A-Z][\w' -]+?)\.? Effect /i, () => {
            stated = true;
            return "";
        });
    if (/^(?:Requirements?|Trigger|Prerequisites?)\b/i.test(body)) return null;
    // (Batch 113, Dancing Dagger: "can Step, attempt a melee dagger Strike, and attempt a ranged dagger Strike, taking the actions in any
    // order" — its two Strikes, the Step the GM's.)
    body = body.replace(/^((?:The )?[^.]+?) can Step, attempt an? (?:melee|ranged) ([\w' -]+?) Strike, and attempt an? (?:melee|ranged) ([\w' -]+?) Strike, taking the actions in any order\./i, "$1 makes a $2 Strike and a $3 Strike.");
    // (Batch 113, Bloody Flurry: "Strikes, Steps, then Strikes again" — two Strikes, the Step between the GM's.)
    body = body.replace(/^((?:The )?[^.]+?) Strikes, Steps, then Strikes again\./i, "$1 makes two Strikes.");
    // (Batch 174: Ferocious Bites' "makes three Strikes with its jaws attack. Each Strike must be against a different opponent within its reach.";
    // the pirate skeleton's Focused Assault, "makes two Strikes with its claw against one foe"; Branch Whip's ", increasing its reach to 20 feet for
    // these Strikes"; Broad Swipe's "makes two Strikes with its greataxe against two adjacent foes, both of whom are within its reach" and "(or a -8
    // multiple attack penalty for its horns)".)
    body = body.replace(/^((?:The )?[^.]+?) makes (two|three|four) Strikes with (?:its|their|his|her) ([\w' -]+?) attack\. Each Strike must be against a different (?:opponent|creature|target|foe|enemy)(?: within (?:its|their|his|her) reach)?\./i, "$1 makes $2 $3 Strikes, each against a different target.")
        .replace(/^((?:The )?[^.]+?) makes (two|three) Strikes with (?:its|their|his|her) ([\w' -]+?) against (one foe|the same (?:creature|target|foe))\./i, "$1 makes $2 $3 Strikes against $4.")
        .replace(/^((?:The )?[^.]+?) makes two Strikes with (?:its|their|his|her) ([\w' -]+?) against two adjacent foes, both of whom are within (?:its|their|his|her) reach\./i, "$1 makes two $2 Strikes, each against a different target.")
        .replace(/ \(or an? [-–−]\d+ multiple attack penalty for (?:its|their|his|her) [\w' -]+?\)(?=\.)/i, "")
        .replace(/, increasing (?:its|their|his|her) reach to (\d+) feet for these Strikes\./i, ". Its reach increases to $1 feet for these Strikes.");
    // (Batch 186: Graceful Double Slice's "makes two Strikes, one with each kukri, using her current multiple attack penalty"; Thrashing Retreat's
    // "makes two paddle Strikes, each of which must be against separate targets, and each of which takes the normal multiple attack penalty. It then Swims
    // up to its swim Speed. This Swim does not trigger reactions based on movement." — the Swim after a note.)
    let swimAfter = false;
    body = body.replace(/^((?:[^.]+\. )?(?:The )?[^.]+?) makes two Strikes, one with each ([\w' -]+?), using (?:its|their|his|her) current multiple attack penalty\./i, "$1 makes two $2 Strikes against the same target.")
        .replace(/\bmakes two ([\w' -]+?) Strikes, each of which must be against separate targets, and each of which takes the normal multiple attack penalty\. (?:It|They|He|She) then Swims up to (?:its|their|his|her) swim Speed\. This Swim (?:does not|doesn't) trigger reactions based on movement\./i, (_all, name) => {
            swimAfter = true;
            return `makes two ${name} Strikes, each against a different target.`;
        });
    // (Batch 190: Aerial Attack's "Flies and Strikes twice with their wings at any points during their movement"; Quickening Jolt's "…, Striding and making
    // two Strikes against different targets during the movement"; Spring Forward's "jumps up to 30 feet and makes two fist Strikes against different
    // targets"; a blog creature's "Strides and then makes two X Strikes at a single target"; Dead Shot's "makes two ranged Strikes, one with each of the
    // firearms, each using …'s current multiple attack penalty" — a move first where there is one.)
    let strideFirst = false;
    // (Batch 197: Unstoppable Charge's "Strides twice in a straight line. It can make up to two claw Strikes during this movement and one jaws Strike at
    // the end of its movement. It can't Strike the same creature more than once."; Claw Storm's "Strides up to its Speed, during which it can walk on air
    // …. It can make up to four claw Strikes at any point during this movement, each against a different target within reach, and it deals an extra …
    // damage with each Strike. …" (its other sentences notes); Flurry of Strands' "makes a strand Strike with each of its strands (except those that are
    // Immobilizing creatures). Each attack must be against a different target." (six strands); Ravenous Embrace's arm Strikes, then a beak Strike at
    // one it Grabbed — the beak a note.)
    let movesFirst = 0;
    const earlyNotes = [];
    body = body.replace(/^((?:The )?[^.]+?) Strides twice in a straight line\. (?:It|They) can make up to (two|three) ([\w' -]+?) Strikes during this movement and one ([\w' -]+?) Strike at the end of (?:its|their) movement\. (?:It|They) can(?:'t|not) Strike the same creature more than once\./i, (_all, who, count, one, last) => {
        movesFirst = 2;
        earlyNotes.push(`It Strides twice in a straight line, the ${one} Strikes during the movement and the ${last} Strike at its end.`);
        return `${who} makes ${count.toLowerCase()} ${one} Strikes and a ${last} Strike, each against a different target.`;
    })
        .replace(/^((?:The )?[^.]+?) Strides up to (?:its|their) Speed, during which (?:it|they) can walk on air as if it were solid ground, ascending or descending at up to a 45-degree angle\. (?:It|They) can make up to (two|three|four) ([\w' -]+?) Strikes at any point during this movement, each against a different target within reach, and (?:it|they) deals? an extra (@Damage\[(?:[^[\]]|\[[^\]]*\])*\]) damage with each Strike\./i, (_all, who, count, name, damage) => {
            movesFirst = 1;
            earlyNotes.push("It Strides up to its Speed, walking on air, making the Strikes at any point along the way.");
            return `${who} makes ${count.toLowerCase()} ${name} Strikes, each against a different target. These attacks deal an extra ${damage} damage.`;
        })
        .replace(/\b(These attacks count toward (?:the [\w' -]+?['’]s|its|their) multiple attack penalty, but the multiple attack penalty doesn't increase until after (?:the [\w' -]+?|it|they) makes? all of (?:its|their) attacks\.)((?: If (?:the [\w' -]+?|it|they) moves? half (?:its|their) Speed or less during an? [A-Z][\w' -]+?, that movement doesn't trigger reactions\.)?(?: (?:The [\w' -]+?|It|They) can(?:'t|not) use [A-Z][\w' -]+? if (?:it|they) (?:has|have) a creature wrapped in (?:its|their) coils\.)?(?: At the end of [A-Z][\w' -]+?, (?:it|they) drifts? downward [^.]+\.)?(?: If (?:it|they) descends? further than \d+ feet, [^.]+\.)?)$/i, (_all, _same, rest) => {
            earlyNotes.push(...rest.trim().split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean));
            return "These attacks count toward its multiple attack penalty, but the penalty doesn't increase until after all the attacks.";
        })
        .replace(/^((?:The )?[^.]+?) makes an? ([\w' -]+?) Strike with each of (?:its|their) \2s \(except those that are Immobilizing creatures\)\. Each attack must be against a different target\./i, (_all, who, name) => {
            earlyNotes.push(`Not with a ${name} that is Immobilizing a creature.`);
            return `${who} makes six ${name} Strikes, each against a different target.`;
        })
        .replace(/^((?:The )?[^.]+?) makes up to (two|three|four) ([\w' -]+?) Strikes, each with a different \3 and against a different target\. (?:The [\w' -]+?|It|They) then makes an? ([\w' -]+?) Strike against one creature that (?:it|they) Grabbed during [A-Z][\w' -]+?\. Each \3 Strike counts separately for (?:the [\w' -]+?['’]s|its|their) multiple attack penalty, but the penalty doesn't increase until (?:the [\w' -]+?|it|they) (?:has|have) made all of (?:its|their) \3 Strikes; the \4 Strike uses the multiple attack penalty as normal\./i, (_all, who, count, limb, beak) => {
            earlyNotes.push(`Then a ${beak} Strike at one creature it Grabbed with them, at its multiple attack penalty as normal.`);
            return `${who} makes ${count.toLowerCase()} ${limb} Strikes, each against a different target. These attacks count toward its multiple attack penalty, but the penalty doesn't increase until after all the attacks.`;
        });
    // (Batch 201, Full Bore: "makes an arquebus Strike against two creatures that are adjacent to each other. The attack ignores any lesser cover one
    // target provides the other. Roll damage once, and apply it to each creature the sniper hits." — its Strike at each, the damage once a note.)
    body = body.replace(/^((?:The )?[^.]+?) makes an? ([\w' -]+?) Strike against two creatures that are adjacent to each other\. The attack ignores any lesser cover one target provides the other\. Roll damage once, and apply it to each creature (?:the [\w' -]+?|it|they) hits\./i, (_all, who, name) => {
        earlyNotes.push("The two creatures must be adjacent to each other; it ignores lesser cover between them and rolls damage once for both.");
        return `${who} makes two ${name} Strikes, each against a different target.`;
    });
    // (Batch 203: Sixfold Flurry's "makes up to two longsword Strikes and up to four fist Strikes. Each Strike must be against a different target. These
    // attacks count toward the calikang's multiple attack penalty, which doesn't increase until after all the attacks are complete. For 1 round, …"
    // (its AC for Strikes not taken a note); Unleash Weapon's "releases their morningstar … makes up to two morningstar Strikes, each against a different
    // target within 20 feet. … The morningstar then returns …".)
    body = body.replace(/^((?:The )?[^.]+?) makes up to (two|three) ([\w' -]+?) Strikes and up to (two|three|four) ([\w' -]+?) Strikes\. Each Strike must be against a different target\. These attacks count toward (?:the [\w' -]+?['’]s|its|their) multiple attack penalty, which doesn't increase until after all the attacks are complete\.( For 1 round, [^.]+\.)?(?:\s*Effect: [\w' -]+$)?/i, (_all, who, first, one, second, other, rest) => {
        if (rest) earlyNotes.push(rest.trim());
        // (Each Strike named in a list, the reading's own way of mixing more than two.)
        const counts = { two: 2, three: 3, four: 4 };
        const list = [...Array(counts[first.toLowerCase()]).fill(`a ${one} Strike`), ...Array(counts[second.toLowerCase()]).fill(`a ${other} Strike`)];
        return `${who} makes ${list.slice(0, -1).join(", ")}, and ${list.at(-1)}, each against a different target. These attacks count toward its multiple attack penalty, but the penalty doesn't increase until after all the attacks.`;
    })
        .replace(/^((?:The )?[^.]+?) releases (?:its|their|his|her) ([\w' -]+?) and commands [^.]+\. The weapon flies off and (?:the [\w' -]+?|it|they) makes up to (two|three) \2 Strikes, each against a different target within (\d+) feet\. These attacks count against (?:the [\w' -]+?['’]s|its|their) multiple attack penalty, but the multiple attack penalty doesn't increase until after all the attacks\.((?: [^.]+\.)*)$/i, (_all, who, weapon, count, feet, rest) => {
            earlyNotes.push(`Its ${weapon} flies off: each Strike at a different creature within ${feet} feet.`, ...rest.trim().split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean));
            return `${who} makes ${count.toLowerCase()} ${weapon} Strikes, each against a different target. These attacks count toward its multiple attack penalty, but the penalty doesn't increase until after all the attacks.`;
        });
    // (Batch 204, Leaping Charge: "attempts a High Jump or Long Jump. If it's adjacent to an enemy at the apex of its High Jump or at the end of its Long
    // Jump, it can make a claw Strike against the enemy at that moment. If the bulette jumps at least 5 feet vertically or at least 20 feet horizontally,
    // it can attempt two claw Strikes instead of one. The bulette's multiple attack penalty doesn't increase until it has made all the claw Strikes …" —
    // a jump, then two claw Strikes at that enemy.)
    body = body.replace(/^((?:The )?[^.]+?) attempts a High Jump or Long Jump\. If (?:it's|they're) adjacent to an enemy at the apex of (?:its|their) High Jump or at the end of (?:its|their) Long Jump, (?:it|they) can make an? ([\w' -]+?) Strike against the enemy at that moment\. If (?:the [\w' -]+?|it|they) jumps? at least (\d+) feet vertically or at least (\d+) feet horizontally, (?:it|they) can attempt two \2 Strikes instead of one\. (?:The [\w' -]+?['’]s|Its|Their) multiple attack penalty doesn't increase until (?:it|they) (?:has|have) made all the \2 Strikes that are part of (?:its|their) [A-Z][\w' -]+?\./i, (_all, who, name, up, across) => {
        movesFirst = 1;
        earlyNotes.push(`It High Jumps or Long Jumps; two ${name} Strikes only if it jumps at least ${up} feet up or ${across} feet across (else one).`);
        return `${who} makes two ${name} Strikes against the same target. These attacks count toward its multiple attack penalty, but the penalty doesn't increase until after all the attacks.`;
    });
    // (Batch 207, Leap into the Fray: "Leaps up to 20 feet horizontally and up to 10 feet vertically and then makes one claw Strike, one jaws Strike, and
    // one tail Strike in any order. If … spends 1 Mythic Point as part of this action, …" — a jump and the three Strikes; the Mythic Point a note.)
    body = body.replace(/^((?:The )?[^.]+?) Leaps up to (\d+) feet horizontally and up to (\d+) feet vertically and then makes one ([\w' -]+?) Strike, one ([\w' -]+?) Strike, and one ([\w' -]+?) Strike in any order\.((?: [^.]+\.)*)$/i, (_all, who, across, up, one, two, three, rest) => {
        movesFirst = 1;
        earlyNotes.push(`It Leaps up to ${across} feet across and ${up} feet up first.`, ...rest.trim().split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean));
        return `${who} makes a ${one} Strike, a ${two} Strike, and a ${three} Strike.`;
    });
    // (Batch 206: Paired Spikes' "flings two spikes from their tail, targeting up to two creatures within 20 feet of each other. They make a separate
    // ranged Strike against each creature, which counts as a single Strike for the barded manticore's multiple attack penalty, and the penalty doesn't
    // increase until they've made both Strikes. …" (its one-creature way a note); Razor-Edged Flight's "glides violently forward, Flying twice. It makes a
    // wing Strike at any point during the movement against up to two different targets; if either of these attacks is a critical hit, the target also
    // takes 2d6 persistent bleed damage.")
    body = body.replace(/^((?:The )?[^.]+?) flings two spikes from (?:its|their) tail, targeting up to two creatures within (\d+) feet of each other\. (?:It|They) makes? a separate ranged Strike against each creature, which counts as a single Strike for (?:the [\w' -]+?['’]s|its|their) multiple attack penalty, and the penalty doesn't increase until (?:it's|they've) made both Strikes\.((?: [^.]+\.)*)(?:\s*Effect: [\w' -]+)?$/i, (_all, who, feet, rest) => {
        earlyNotes.push(`The two creatures within ${feet} feet of each other.`, ...rest.trim().split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean));
        return `${who} makes two spike Strikes, each against a different target. This counts as one attack when calculating its multiple attack penalty.`;
    })
        .replace(/^((?:The )?[^.]+?) glides violently forward, Flying twice\. (?:It|They) makes? an? ([\w' -]+?) Strike at any point during the movement against up to two different targets; if either of these attacks is a critical hit, the target also takes (\d+d\d+) persistent (\w+) damage\./i, (_all, who, name, dice, type) => {
            movesFirst = 2;
            earlyNotes.push("It Flies twice, making the Strikes at any point along the way.");
            return `${who} makes two ${name} Strikes, each against a different target. On a critical hit, the target takes @Damage[${dice}[persistent,${type.toLowerCase()}]] damage.`;
        });
    // (Batch 204: Skittering Assault's "Strides three times. Once per Stride, it can attempt a leg Strike against a creature in its reach at any point
    // during the Stride; it must make each attack against a different creature, but it doesn't apply its multiple attack penalty until after making all
    // its Strikes. If any of the Strikes result in a critical failure, Skittering Assault ends."; Spike Volley's two spikes at two creatures within 20 feet
    // of each other, counted as one Strike — its other way, both at one creature to pin it, a note.)
    body = body.replace(/^((?:The )?[^.]+?) Strides (two|three) times\. Once per Stride, (?:it|they) can attempt an? ([\w' -]+?) Strike against a creature in (?:its|their) reach at any point during the Stride; (?:it|they) must make each attack against a different creature, but (?:it|they) (?:doesn't|don't) apply (?:its|their) multiple attack penalty until after making all (?:its|their) Strikes\.( If any of the Strikes result in a critical failure, [A-Z][\w' -]+? ends\.)?/i, (_all, who, count, name, ends) => {
        movesFirst = count.toLowerCase() === "three" ? 3 : 2;
        earlyNotes.push(`It Strides ${count.toLowerCase()} times, with one Strike during each Stride${ends ? "; a critical failure ends it" : ""}.`);
        return `${who} makes ${count.toLowerCase()} ${name} Strikes, each against a different target. These attacks count toward its multiple attack penalty, but the penalty doesn't increase until after all the attacks.`;
    })
        .replace(/^((?:The )?[^.]+?) flings up to two spikes from (?:its|their) tail, targeting either two different creatures or a single creature\. If (?:the [\w' -]+?|it|they) targets two different creatures, these creatures must be within (\d+) feet of one another, and (?:the [\w' -]+?|it|they) makes a separate Strike against each; this counts as only one Strike for (?:the [\w' -]+?['’]s|its|their) multiple attack penalty, and the penalty doesn't increase until after both attacks\.((?: [^.]+\.)*)$/i, (_all, who, feet, rest) => {
            earlyNotes.push(`The two creatures within ${feet} feet of each other.`, ...rest.replace(/\[\[\/act [^\]]*\]\]\{([^}]*)\}/g, "$1").trim().split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean));
            return `${who} makes two spike Strikes, each against a different target. This counts as one attack when calculating its multiple attack penalty.`;
        });
    let chain = false;
    // (Batch 224, Prudent Asterism: "It makes a starknife Strike against a target within 60 feet. If the Strike hits, it can make another Strike at a
    // different target within 60 feet of the first target, and so on, until it misses with a Strike or runs out of targets … The star archon can attack a
    // given target only once per use of this ability. These attacks don't apply any range increment penalty, and the star archon resolves all the attacks
    // before increasing the multiple attack penalty." — up to six Strikes at different creatures, the next only after a hit (chain), one penalty.)
    body = body.replace(/^(?:[^.]+\. )?(?:It|The [\w' -]+?) makes an? ([\w' -]+?) Strike against a target within (\d+) feet\. If the Strike hits, (?:it|they) can make another Strike at a different target within \2 feet of the first target, and so on, until (?:it|they) miss(?:es)? with a Strike or runs? out of targets (?:it|they) (?:hasn't|haven't) attacked within range of the most recent target\. (?:The [\w' -]+?|It|They) can attack a given target only once per use of this ability\. These attacks don't apply any range increment penalty, and (?:the [\w' -]+?|it|they) resolves? all the attacks before increasing the multiple attack penalty\.$/i, (_all, name, feet) => {
        chain = true;
        earlyNotes.push(`Each Strike at a creature within ${feet} feet of the last one, with no range penalty; the next only after a hit.`);
        return `It makes up to six ${name} Strikes, each against a different target. These attacks count toward its multiple attack penalty, but the penalty doesn't increase until after all the attacks.`;
    });
    // (Batch 220, Cleanse the Forest: "The aso berang Strides adjacent to an enemy and attempts a melee Strike. If successful, the aso berang can Stride and
    // attempt to Strike a different enemy. If this second attack is successful, they can Stride and attempt to Strike a third enemy." — three Strikes at
    // different enemies, the next only after a hit (chain), a Stride before each.)
    body = body.replace(/^(?:[^.]+\. )?((?:The )?[^.]+?) Strides adjacent to an enemy and attempts a melee Strike\. If successful, (?:the [\w' -]+?|it|they) can Stride and attempt to Strike a different enemy\. If this second attack is successful, (?:the [\w' -]+?|it|they) can Stride and attempt to Strike a third enemy\.( Once (?:it|they) fails? a Strike \(or upon succeeding at (?:its|their) third Strike\), (?:the [\w' -]+?|it|they) Strides back to the space where (?:it|they) began\.)?$/i, (_all, who, back) => {
        chain = true;
        movesFirst = 1;
        earlyNotes.push("It Strides before each Strike, each at a different enemy; the next only after a hit.");
        if (back) earlyNotes.push("Afterward it Strides back to where it began.");
        return `${who} makes three melee Strikes, each against a different target.`;
    });
    // (Batch 212, Battlezoo: a Stride up to its Speed, then up to so many Strikes on the way, in a sentence of their own; so many Strikes "times"
    // with one weapon, each at its own creature.)
    // (Batch 243, Unstoppable Onslaught: "… transforms into pure energy and surges across the battlefield. They Fly up to their Speed, and during this
    // movement they have resistance 30 to all damage (except spirit damage). At any point during this movement, the dragon can make up to two claw
    // Strikes; each of these Strikes deals an additional 3d8+3 force damage." — a flight first, its resistance a note, the extra damage on each.)
    body = body.replace(/^((?:The )?[^.]+?) transforms into [^.]+? and surges across the battlefield\. (?:They|It) Fl(?:y|ies) up to (?:their|its) Speed, and during this movement (?:they|it) (?:have|has) resistance (\d+) to all damage \(except (\w+) damage\)\. At any point during this movement, (?:the [\w' -]+?|it|they) can make up to (two|three) ([\w' -]+?) Strikes; each of these Strikes deals an additional (\d+d\d+(?:\+\d+)?) (\w+) damage\./i, (_all, who, value, except, count, name, dice, type) => {
        movesFirst = 1;
        earlyNotes.push(`It Flies up to its Speed, with resistance ${value} to all damage except ${except} while it moves; the Strikes at any point along the way.`);
        // (Its dice and its flat part as two, as live play's rules and the simulator read them.)
        const [, roll, flat] = /^(\d+d\d+)(?:\+(\d+))?$/.exec(dice);
        return `${who} makes up to ${count.toLowerCase()} ${name} Strikes. These attacks deal an additional @Damage[${roll}[${type.toLowerCase()}],${flat ?? 0}[${type.toLowerCase()}]] damage.`;
    });
    // (Batch 243, Illusory Ambush: "… Strides up to twice its Speed. If it ends its movement within its melee reach of at least one enemy to which it's
    // undetected, it can attempt two claw Strikes against that enemy. … remains undetected to the creature it's attacking until after resolving both of
    // the claw attacks." — two Strides, then two Strikes at that enemy; only at an enemy it's undetected by, a requirement.)
    let undetectedOnly = false;
    body = body.replace(/^(?:[^.]+\. )?((?:The )?[^.]+?) Strides up to twice (?:its|their) Speed\. If (?:it|they) ends? (?:its|their) movement within (?:its|their) melee reach of at least one enemy to which (?:it|they)(?:'s|’s| is| are) undetected, (?:it|they) can attempt two ([\w' -]+?) Strikes against that enemy\./i, (_all, who, name) => {
        movesFirst = 2;
        undetectedOnly = true;
        earlyNotes.push("It Strides twice first; only at an enemy it's undetected by, which stays so until both Strikes are done.");
        return `${who} makes two ${name} Strikes against the same target.`;
    })
        .replace(/ (?:The [\w' -]+?|[A-Z][\w'-]+(?: [A-Z][\w'-]+)*|It|They) remains? undetected to the creature (?:it['’]s|they['’]re) attacking until after resolving both of the [\w' -]+? attacks\./i, "");
    // (Batch 241, Rocketing Strafe: "Flies and makes two melee Strikes at any point during that movement. Each Strike must target a different
    // creature." — a flight first; the one ranged Strike it may make instead a note; "Any Strike made as part of … deals an additional 2d6 damage"
    // — the Strike's own damage type.)
    body = body.replace(/^((?:The )?[^.]+?) Flies and makes two (melee |ranged )?Strikes at any point during (?:that|its|their|the) movement\. Each Strike must target a different creature\./i, (_all, who, kind) => {
        movesFirst = 1;
        earlyNotes.push("It Flies, making the Strikes at any point along the way.");
        return `${who} makes two ${kind ?? ""}Strikes, each against a different target.`;
    })
        .replace(/ (?:The [\w' -]+?|It|They|He|She) can forgo the (melee|ranged) Strikes to instead make one ([\w' -]+?) Strike at any point during that movement and Interact to select the next loaded chamber of (?:their|its|his|her) \2; (?:they|it|he|she) can do these in either order\./i, (_all, kind, other) => {
            earlyNotes.push(`Or, instead of the ${kind} Strikes, one ${other} Strike (and an Interact to ready its next chamber).`);
            return "";
        })
        .replace(/ Any Strike made as part of an? [A-Z][\w' -]+? deals an additional (\d+d\d+) damage and takes the normal multiple attack penalty\./i, (_all, dice) => ` These attacks deal an additional @Damage[${dice}[untyped]] damage.`);
    body = body.replace(/^((?:The )?[^.]+?) Strides up to (?:its|their|his|her) Speed\. (?:It|They|He|She) can make up to (two|three|four) ([\w' -]+?) Strikes at any point during (?:its|their|his|her|the|that) movement\./i, (_all, who, number, name) => {
        movesFirst = 1;
        earlyNotes.push("It Strides up to its Speed, making the Strikes at any point along the way.");
        return `${who} makes up to ${number.toLowerCase()} ${name} Strikes.`;
    })
        .replace(/\b(It|They|He|She|The [\w' -]+?) Strikes (two|three|four) times with (?:its|their|his|her) ([\w' -]+?), each against a different (target|creature)\./i, "$1 makes $2 $3 Strikes, each against a different $4.");
    body = body.replace(/^((?:The )?[^.]+?) Flies and Strikes twice with (?:its|their|his|her) ([\w' -]+?) at any points? during (?:its|their|his|her) movement\./i, (_all, who, weapon) => `${who} Strides once and makes two ${weapon.replace(/s$/i, "")} Strikes at any point along its movement.`)
        .replace(/^(?:The )?([^.,]+?) [^.,]+?, Striding and making two Strikes against different targets during the movement\./i, (_all, who) => {
            strideFirst = true;
            return `The ${who} makes two Strikes, each against a different target.`;
        })
        .replace(/^((?:The )?[^.]+?) jumps up to \d+ feet and makes two ([\w' -]+?) Strikes against different targets\./i, (_all, who, weapon) => {
            strideFirst = true;
            return `${who} makes two ${weapon} Strikes, each against a different target.`;
        })
        .replace(/^((?:The )?[^.]+?) Strides and then makes two ([\w' -]+?) Strikes at a single target\./i, (_all, who, weapon) => {
            strideFirst = true;
            return `${who} makes two ${weapon} Strikes against the same target.`;
        })
        .replace(/\bmakes two ranged Strikes, one with each of the [\w' -]+?, each using (?:the [\w' -]+?['’]s|its|their|his|her) current multiple attack penalty\./i, "makes two ranged Strikes, ignoring the multiple attack penalty until after both Strikes.")
        // (Dead Shot's last sentence, its stop missing.)
        .replace(/(multiple attack penalty)\s*$/i, "$1.");
    // (Batch 175: Dancing Blade's "makes a Strike against a creature, then Strides. This Stride doesn't trigger reactions. If the guard ends this Stride
    // in a different space adjacent to the same creature, they make another Strike against it. If both Strikes succeed, …" — two Strikes at it, the
    // Stride between the GM's; Hunter's Wound's "Prerequisites … with a reload of 0 … two ranged Strikes against their prey".)
    let strideBetween = false;
    let preyOnly = false;
    body = body.replace(/\b(makes two (?:ranged |melee )?Strikes) against (?:its|their|his|her) prey\./i, (_all, made) => {
        preyOnly = true;
        return `${made} against the same target.`;
    });
    body = body.replace(/^((?:The )?[^.]+?) makes a Strike against a creature, then Strides\. This Stride (?:doesn't|does not) trigger reactions\. If (?:the [\w' -]+?|it|they|he|she|[A-Z][\w'-]+) ends this Stride in a differen(?:t|ce) space adjacent to the same creature, (?:it|they|he|she) makes? another Strike against it\./i, (_all, who) => {
        strideBetween = true;
        return `${who} makes two Strikes against the same creature.`;
    })
        .replace(/\bIf both Strikes succeed, the creature is\b/i, "If both Strikes hit, the target is");
    const sentences = body.replace(/,? which (?:it|they) can make in any order\./i, ".").split(/(?<=\.)\s+(?=[A-Z])/);
    // (Batch 42: a first sentence that only tells what it does, "The test slayer swiftly attacks their prey with both weapons,
    // potentially combining their damage into a single devastating attack.")
    if (sentences.length > 1 && !/^(?:Frequency|Requirements?|Trigger|Prerequisites?)\b/i.test(sentences[0]) && !/\bStrikes?\b|\d|@|\b(?:save|DC|damage|bonus|penalty|Grab|Grabbed|Prone|Stunned|Frightened|condition)\b/i.test(sentences[0].replace(/, potentially combining their damage into a single devastating attack\.$/i, ".")) && /\bStrikes?\b/.test(sentences[1])) sentences.shift();
    let first = sentences.shift() ?? "";
    let sameMap = false;
    let sameTarget = false;
    let grab = false;
    let countsAs = null;
    // (Batch 30: the first sentence's extras, taken out: "at a -2 penalty" (each Strike's), "at any point during that movement"
    // (Flying Strafe), "within the shortbow's first range increment", "; no more than two can be against the same target",
    // "against a creature it has Grabbed" (a requirement), "attempts", no final period.)
    let penalty = 0;
    const notes = [];
    notes.push(...earlyNotes);
    if (fatiguedAfter) notes.push(fatiguedAfter);
    if (strideBetween) notes.push("Between the Strikes it Strides (no reactions) to another space beside the creature; the second Strike only if it gets there.");
    if (preyOnly) notes.push("Only at its prey.");
    if (swimAfter) notes.push("Then it Swims up to its swim Speed; that Swim triggers no reactions.");
    let requires = held ? "grabbed" : raging ? "raging" : stated || undetectedOnly ? "requirement" : notFatigued ? "not-fatigued" : null;
    // (Batch 152: Haunting Assault's "…, then Demoralizes that creature" — its basic action at the creature after the Strikes.)
    let then = null;
    let strides = movesFirst || (strideFirst ? 1 : 0);
    if (held) sameTarget = true;
    first = first.trim().replace(/([^.])$/, "$1.")
        // (Batch 152, Fan of Daggers: "…, each against a separate target; he ignores the multiple attack penalty until after making all three
        // Strikes".)
        .replace(/, each against a separate (target|creature|foe|enemy)\b/i, ", each against a different $1")
        // (Batch 175, Fast Sweep: "makes two bill Strikes against two adjacent targets, with a +1 circumstance bonus to its attack rolls".)
        .replace(/ against two adjacent (?:targets|foes|creatures), with an? \+(\d+) circumstance bonus to (?:its|their|his|her) attack rolls(?=\.$)/i, (_all, value) => {
            penalty -= Number(value);
            notes.push(`A +${value} circumstance bonus to the attack rolls.`);
            return ", each against a different target";
        })
        .replace(/; (?:it|they|he|she) ignores? the multiple attack penalty until after making all (?:two|three|four) Strikes(?=\.$)/i, () => {
            sameMap = true;
            return "";
        })
        .replace(/, then Demoralizes that (?:creature|target)(?=\.$)/i, () => {
            then = "demoralize";
            return "";
        })
        // (Batch 157, Storm Strikes Twice: "… make a ranged thunderbolt Strike against a creature within their first range increment, teleport to
        // the creature's location as a gust of wind, then grasp the thrown thunderbolt and make a melee thunderbolt Strike against a creature within
        // reach" — a ranged Strike and a melee one, the teleport between a note.)
        .replace(/^((?:The )?[^.]+?) makes? a ranged ([\w' -]+?) Strike against a creature within (?:its|their|his|her) first range increment, teleports? to the creature's location as a gust of wind, then grasps? the thrown \2 and makes? a melee \2 Strike against a creature within reach(?=\.$)/i, (_all, who, name) => {
            notes.push("It teleports to the first target's location between the two Strikes.");
            return `${who} makes a ${name} Strike and a ${name} Strike`;
        })
        // (Batch 156: Circling the Kingdom's "Strides twice and makes two quarterstaff Strikes at any point along its movement" — the moves first;
        // Spear Dance's "…, each with a range of 10 feet" — a note; What Lurks Beneath's "attacks with their tentacles six times".)
        .replace(/^((?:The )?[^.]+?) Strides (twice|once) and makes (two|three) ([\w' -]+?) Strikes at any point (?:along|during) (?:its|their|his|her) movement(?=\.$)/i, (_all, who, times, number, name) => {
            strides = /twice/i.test(times) ? 2 : 1;
            notes.push(`It Strides ${times.toLowerCase()}, making the Strikes at any point along the way.`);
            return `${who} makes ${number} ${name} Strikes`;
        })
        // (Batch 212, Battlezoo: a Stride (up to its Speed) with two Strikes somewhere along it, in one sentence; the penalty as normal in brackets,
        // then a Step — the Step a note.)
        .replace(/^((?:The )?[^.]+?) Strides(?: up to (?:its|their|his|her) Speed)? and (?:can )?makes? (up to )?(two|three) ([\w' -]+?) Strikes,?(?: each)? at any points? during (?:that|its|their|his|her|the) (?:movement|Stride)(?=\.$)/i, (_all, who, upTo, number, name) => {
            strides = 1;
            notes.push("It Strides, making the Strikes at any point along the way.");
            return `${who} makes ${upTo ?? ""}${number.toLowerCase()} ${name} Strikes`;
        })
        .replace(/ \(applying (?:its|their|his|her) multiple attack penalty (?:normally|as normal)\)/i, "")
        .replace(/, then Steps(?=\.$)/i, () => {
            notes.push("Then it Steps.");
            return "";
        })
        .replace(/, each with a range of (\d+) feet(?=\.$)/i, (_all, feet) => {
            notes.push(`Each Strike has a range of ${feet} feet.`);
            return "";
        })
        .replace(/^((?:The )?[^.]+?) attacks with (?:its|their|his|her) ([\w' -]+?)s (two|three|four|five|six) times(?=\.$)/i, "$1 makes $3 $2 Strikes")
        // (Batch 153: Heads Will Roll!'s "The dragon Flies twice; at any point during this movement, the dragon makes up to two chin blade Strikes,
        // …" — two moves first; Combat Current's "makes a Strike with its cutlass or hand crossbow, then Flies up to half their Speed and makes a
        // Strike with the other attack" — one of each, the flight a note; Tail Thrash's "makes a tail Strike against the creature whose soul it's
        // attached to, then one against another creature adjacent to the original target"; Double Shot's "with the required weapon at a single
        // target"; Graytusk's "can make two ranged Strikes …, each at a -2 penalty, Graytusk's multiple attack penalty increases only after both
        // attacks are made"; Taljjae's "fires two shots, making two Strikes, each against a separate target and with a -2 penalty".)
        .replace(/^((?:The )?[^.;]+?) Flies twice; at any point during this movement, (?:the [\w' -]+?|it|they|he|she) makes (?=up to (?:two|three) )/i, (_all, who) => {
            strides = 2;
            notes.push("It Flies twice, making the Strikes at any point during the flight.");
            return `${who} makes `;
        })
        .replace(/^((?:The )?[^.]+?) makes a Strike with (?:its|their|his|her) ([\w' -]+?) or ([\w' -]+?), then Flies up to half (?:its|their|his|her) Speed and makes a Strike with the other attack(?=\.$)/i, (_all, who, one, other) => {
            notes.push("It Flies up to half its Speed between the two Strikes.");
            return `${who} makes a ${one} Strike and a ${other} Strike`;
        })
        .replace(/\bmakes an? ([\w' -]+?) Strike against the creature whose soul (?:it's|it is) attached to, then one against another creature adjacent to the original target(?=\.$)/i, "makes two $1 Strikes, each against a different creature")
        .replace(/\bmakes two Strikes with the required weapon at a single target(?=\.$)/i, () => (rangedRequired ? "makes two ranged Strikes against a single target" : "makes two Strikes against a single target"))
        .replace(/^((?:The )?[^.]+?) can make (two|three) /i, "$1 makes $2 ")
        .replace(/^((?:The )?[^.]+?) fires (?:two|three) shots, making (two|three) Strikes/i, "$1 makes $2 ranged Strikes")
        .replace(/ and with an? [-\u2013\u2212](\d+) penalty(?=\.$)/i, (_all, value) => {
            penalty = Number(value);
            return "";
        })
        .replace(/\b(attempts|attempt)\b(?= (?:up to )?(?:a|an|one|two|three|four) )/i, "makes")
        .replace(/,? (?:each )?at an? [-\u2013\u2212](\d+) penalty(?: to (?:its|their|the) attack rolls?)?/i, (_all, value) => {
            penalty = Number(value);
            return "";
        })
        .replace(/, (?:the [\w' -]+?|[A-Z][\w'-]+)['’]s multiple attack penalty increases only after both attacks are made(?=\.$)/i, () => {
            sameMap = true;
            return "";
        })
        .replace(/ at any point during (?:that|its|their|the) movement/i, "")
        // (Batch 124, Furious Frenzy: "… and one Strike with his jaws, horns, or tail, in any order" — its first named; Twin-Talon Swipe's
        // "…, targeting either the same foe or two adjacent targets" — its choice.)
        .replace(/ and one Strike with (?:its|their|his|her) ([\w' -]+?)(?:, [\w' -]+?)*,? or [\w' -]+?(?=,? in any order\.$|\.$)/i, " and one $1 Strike")
        .replace(/, targeting either the same (?:foe|creature|target) or two adjacent (?:foes|creatures|targets)(?=\.$)/i, "")
        .replace(/, in (?:any|either) order(?=\.$)/i, "")
        // (Batch 131: Two-Weapon Flurry's "They Strike twice, once with each weapon"; Double Slice's "Make two Strikes, one with each of his two melee
        // weapons" — its best melee Strikes.)
        .replace(/^((?:The )?[^.]+?|They|It|He|She) Strikes? twice, once with each weapon(?=\.$)/i, "$1 makes two Strikes")
        .replace(/^(?:(?:The )?[^.]+? makes?|Make) two Strikes, one with each (?:of (?:its|their|his|her) two (?:melee )?weapons|melee weapon)(?=,|\.$)/i, "It makes one Strike with each of its two melee weapons")
        // (Batch 129, Frenzied Attack: "… against one or two different creatures (splitting up the attacks any way he wishes)" — its choice; Telekinetic
        // Reach: "makes a Strike with each of its jaws, claw, and tail" — one with each.)
        .replace(/ against one or two different creatures(?: \(splitting up the attacks any way (?:he|she|it|they) wishes?\))?(?=\.$)/i, "")
        // (Batch 245, Lightning Punch: "… makes a fist Strike, then makes a lightning Strike against a different creature within 120 feet of the fist
        // Strike's target" — two Strikes at different creatures, the distance a note.)
        .replace(/^((?:The )?[^.]+?) makes an? ([\w' -]+?) Strike, then makes an? ([\w' -]+?) Strike against a different creature within (\d+) feet of the \2 Strike['’]s target(?=\.$)/i, (_all, who, first, second, feet) => {
            notes.push(`The ${second} Strike at a creature within ${feet} feet of the ${first} Strike's target.`);
            return `${who} makes a ${first} Strike and a ${second} Strike, each against a different target`;
        })
        .replace(/^Both Strikes count toward (?:the [\w' -]+?['’]s|its|their) multiple attack penalty, but it (?:doesn't|does not) increase until after both attacks are made(?=\.$)/i, () => {
            sameMap = true;
            return "";
        })
        // (Batch 245, Follow-Up Combo: "… makes a rapier Strike, followed by two fist Strikes, all against the same target".)
        .replace(/^((?:The )?[^.]+?) makes? an? ([\w' -]+?) Strike, followed by two ([\w' -]+?) Strikes, all against the same target(?=\.$)/i, "$1 makes one $2 Strike and two $3 Strikes against a single target")
        .replace(/\bmakes a Strike with each of (?:its|their|his|her) ([\w' -]+?), ([\w' -]+?),? and ([\w' -]+?)(?=\.$)/i, "makes a $1 Strike, a $2 Strike, and a $3 Strike")
        // (Batch 129: Hammering Flurry's "…, ignoring the multiple attack penalty until after all three attacks are completed"; Twin Chop's "…, each
        // of which must target a different foe within reach".)
        .replace(/, ignoring the multiple attack penalty until after (?:all (?:two|three|four|five) attacks|both attacks) (?:are|have been) (?:completed|made|resolved)(?=\.$)/i, () => {
            sameMap = true;
            return "";
        })
        .replace(/, each of which must target a different (?:foe|creature|enemy|target)(?: within (?:its |their )?reach)?(?=\.$)/i, ", each against a different creature")
        // (Haphazard Hack: "…, two of which must be against different enemies" — its choice of targets.)
        .replace(/, two of which must be against different (?:enemies|foes|creatures)(?=\.$)/i, "")
        // (Batch 124, Twisting Reach: "…, ignoring the target's cover" — the GM's, a note.)
        .replace(/,? ignoring the target's cover(?=\.$)/i, () => {
            notes.push("The Strikes ignore the target's cover.");
            return "";
        })
        // (Batch 60: Writhing Arms' "up to four arm Strikes with different arms", the kraken's "two Strikes with two different arms or
        // tentacles, each limb targeting a different creature".)
        .replace(/ with (?:two |three |four )?different (?:arms|limbs|tentacles|heads)(?: or (?:arms|limbs|tentacles|heads))?(?=,)/i, "")
        .replace(/, each limb targeting /i, ", each targeting ")
        // (Batch 42: "two fist Strikes, applying her multiple attack penalty as normal", "two Strikes, each of which must be an unarmed
        // Strike or temple bell Strike", "two unarmed Strikes, or one unarmed Strike and a dueling pistol Strike": its best melee
        // Strikes; "thrashes wildly with its wings, making wing Strikes against up to three adjacent foes".)
        .replace(/, applying (?:its|their|his|her|the [\w' -]+?['’]s) multiple attack penalty (?:as normal|normally)(?=\.$)/i, "")
        // (Batch 80: "They make two hoof Strikes against the same target", "… two claw Strikes at the same target, each using her current
        // multiple attack penalty".)
        .replace(/^(They|You) make (?=(?:up to )?(?:a|an|one|two|three|four|five|six) )/, "$1 makes ")
        // (Batch 81: "…, each using a different limb"; Wing Snap's "…, then falls if it's flying" (the fall the GM's).)
        .replace(/, each using a different (?:limb|arm|head|tentacle)(?=\.$)/i, "")
        .replace(/, then falls if (?:it's|it is|they're|they are) flying(?=\.$)/i, "")
        .replace(/ at the same (target|creature)(?=[,.])/i, " against the same $1")
        // (Batch 139, Circling Attack: "Flies up to half its Speed, makes two wing Strikes, then Flies up to half its Speed again to return to its
        // original location" — the flight the GM's, a note.)
        .replace(/^((?:The )?[^.]+?) Flies up to half (?:its|their|his|her) Speed, makes (two|three) ([\w' -]+?) Strikes, then Flies up to half (?:its|their|his|her) Speed again to return to (?:its|their|his|her) original location(?=\.$)/i, (_all, who, number, name) => {
            notes.push("It Flies up to half its Speed before the Strikes and again after them, back to where it started; that second flight triggers no reactions.");
            return `${who} makes ${number} ${name} Strikes`;
        })
        // (Batch 138, Spirit Shot: "… two ranged Strikes against their prey" — one creature.)
        .replace(/ against (?:its|their|his|her) (?:designated |hunted )?prey(?=\.$)/i, " against the same target")
        // (Batch 90: Two-Headed Strike's "makes a Strike with each set of jaws, each against a different creature", Bloody Dance's "makes a
        // Strike with up to four arms, each against a different target and using a claw or scimitar as appropriate", Axe Swipe's "makes two
        // Strikes with their greataxe against two adjacent enemies, both of whom are within their reach".)
        .replace(/\bmakes a Strike with each set of jaws, each against a different creature(?=\.$)/i, "makes two jaws Strikes, each against a different creature")
        // (Batch 91: Twin Bites' "makes a fangs Strike with each of its heads, each against a different target"; Paired Strike's "makes two
        // Strikes against the same target, one with each of their scimitars".)
        .replace(/\bmakes an? ([\w' -]+?) Strike with each of (?:its|their|his|her) heads, each against a different (?:target|creature)(?=\.$)/i, "makes two $1 Strikes, each against a different creature")
        .replace(/\bmakes two Strikes against the same target, one with each of (?:its|their|his|her) ([\w' -]+?)s(?=\.$)/i, "makes two $1 Strikes against the same target")
        .replace(/\bmakes a Strike with up to (two|three|four) arms, each against a different target and using an? [\w' -]+? or [\w' -]+? as appropriate(?=\.$)/i, "makes up to $1 Strikes, each against a different target")
        .replace(/\bmakes two Strikes with (?:its|their|his|her) ([\w' -]+?) against two adjacent enemies, both of whom are within (?:its|their|his|her) reach(?=\.$)/i, "makes two $1 Strikes, each against a different creature")
        // (Batch 87, Dual Disarm: "makes two Strikes, one with their rapier and one with their main-gauche (in either order)".)
        .replace(/\bmakes two Strikes, one with (?:its|their|his|her) ([\w' -]+?) and one with (?:its|their|his|her) ([\w' -]+?)(?: \(in either order\))?(?=\.$)/i, "makes a $1 Strike and a $2 Strike")
        .replace(/, each using (?:its|their|his|her|the [\w' -]+?['’]s) current multiple attack penalty(?=\.$)/i, "")
        // (Batch 92, Vine Forest: "…, each against a different target; this counts as one attack for their multiple attack penalty, increasing
        // only after all the attacks are made".)
        .replace(/; this counts as one attack for (?:its|their|his|her) multiple attack penalty, increasing only after all the attacks are made(?=\.$)/i, () => {
            sameMap = true;
            countsAs = 1;
            return "";
        })
        // (Batch 91, Twin Shot: "makes two Strikes with her bow using her current multiple attack penalty" — both at it.)
        .replace(/ using (?:its|their|his|her) current multiple attack penalty(?=\.$)/i, () => {
            sameMap = true;
            return "";
        })
        .replace(/, each of which must be an? [\w' -]+? Strike or (?:an? )?[\w' -]+? Strike(?=\.$)/i, "")
        .replace(/(Strikes), or one [\w' -]+? Strike and an? [\w' -]+? Strike(?=\.$)/i, "$1")
        .replace(/, making ([\w' -]+? Strikes against )/i, " and makes $1")
        // (Batch 212, a Battlezoo flurry: so many Strikes at no more than that many creatures — at whichever it likes.)
        .replace(/(\bmakes|, making) (two|three|four) ([\w' -]+?) Strikes (?:against|at) up to \2 creatures within (?:(?:its|their|his|her) )?(?:reach|range)(?=\.$)/i, (_all, verb, number, name) => `${verb.startsWith(",") ? " and makes" : "makes"} ${number} ${name} Strikes`)
        // (Batch 90, the minotaur's Axe Swipe: "… making greataxe Strikes against any two foes who are adjacent to each other and within the
        // minotaur's reach".)
        .replace(/\bmakes ([\w' -]+?) Strikes against any two foes who are adjacent to each other and within (?:the [\w' -]+?['’]s|its|their|his|her) reach(?=\.$)/i, "makes two $1 Strikes, each against a different creature")
        .replace(/ (?:within|in) (?:the|its|their|his|her) [\w' -]+?(?:'s)? first range increment/i, "")
        .replace(/; no more than (?:two|one) can be against the same target/i, "")
        // (Batch 90, Dual Stab: "against an Immobilized or Off-Guard target" — only at one.)
        .replace(/ against an? Immobilized or Off-Guard target(?=\.$)/i, () => {
            requires = "off-guard";
            sameTarget = true;
            return "";
        })
        .replace(/ against (?:a|the) creature (?:it|they|he|she) (?:has|have) Grabbed(?: or Restrained)?/i, () => {
            requires = "grabbed";
            sameTarget = true;
            return "";
        });
    const after = [];
    // (Batch 200, Power Through: Fatigued after, until it saves — for the fight, in the simulator.)
    if (fatiguedAfter) after.push({ slug: "fatigued", value: null, until: "save" });
    const strikes = [];
    const count = countWord;
    // "scimitar or fangs": the first; "melee", "unarmed", "ranged" or none: the best (null).
    const named = (name) => {
        const plain = String(name ?? "").trim().replace(/\s+or\s+.*$/i, "");
        // (Batch 153: "two ranged Strikes" — its best ranged Strike.)
        if (/^ranged(?: (?:strikes|attacks))?$/i.test(plain)) return "ranged";
        if (!plain || /^(?:melee|unarmed|weapon|melee weapon)(?: (?:strikes|attacks))?$/i.test(plain)) return null;
        // "ranged oathbow", "melee echoblade": the Strike's own name.
        return plain.replace(/^(?:melee|ranged)\s+/i, "").toLowerCase();
    };
    // Who they're against: "against the same target", "all targeting the same creature", "each against a different creature".
    const WHO = String.raw`(?:,? (?:each |all |both )?(?:against|targeting) (?:a|an|one|the|two|different|single) (?:single |same |different |adjacent )?(?:creature|target|foe|enemy|enemies|targets|creatures)s?(?: (?:within|in) (?:(?:its|their|his|her) )?reach)?)?`;
    let match;
    // Against different creatures ("up to four tentacle Strikes, each against a different target", "tail Strikes against two
    // different creatures within reach"): a Strike at each of that many enemies in its Melee (2026-10-10).
    let each = false;
    if ((match = new RegExp(String.raw`^(?:The )?[^.]+? makes (?:up to )?(${COUNT}) (?:([\w' -]+?) )??Strikes?(?: and (a|an|one|two|three) ([\w' -]+?) Strikes?)?(?: with (?:its|their|his|her) ([\w' -]+?))?(?: in (?:any|either) order)?(${WHO})(?:,? one (?:Strike )?(?:with each of (?:its|their|his|her) [\w' -]+|per weapon))?\.$`, "i").exec(first))) {
        // (Batch 129: "melee Strikes with her dagger" — the dagger.)
        const first = match[2] && !/^(?:melee|ranged)$/i.test(match[2]) ? match[2] : match[5] && !/\b(?:at|against)\b/i.test(match[5]) ? match[5] : match[2];
        for (const [number, name] of [[match[1], first], [match[3], match[4]]]) for (let index = 0; index < count(number ?? 0); index++) strikes.push(named(name));
        // (Batch 150, Dig In: "two pick Strikes against a creature within reach" — one creature.)
        if (/single|same|one (?:creature|target|foe|enemy)|against an? (?:creature|target|foe|enemy)\b/i.test(match[6] ?? "")) sameTarget = true;
        if (/different|two (?:creatures|targets|foes|enemies)/i.test(match[6] ?? "")) each = true;
    } else if ((match = /^(?:The )?[^.]+? makes ((?:(?:a|an|one|two|three|four) [\w' -]+? Strikes?, )+(?:and )?(?:a|an|one|two|three|four) [\w' -]+? Strikes?)(?: in any order)?(, each against a different (?:target|creature|foe|enemy))?\.$/i.exec(first.replace(/\b(Strikes?, (?:and )?)(?!(?:a|an|one|two|three|four|and) )(?=(?:(?!(?:the|ignoring|until|after|both|all|multiple|attack|penalty|each|then)\b)[\w'-]+ ){1,3}Strikes?\b)/gi, "$1a ")))) {
        // (Batch 139, Team Attack: "makes a ghostly longsword Strike, ghostly dagger Strike, and ghostly longbow Strike" — one of each.)
        // (Batch 129, Destructive Frenzy: "makes a jaws Strike, two claw Strikes, two horn Strikes, and one tail Strike in any order"; Telekinetic
        // Reach's one with each, as above.)
        // (Batch 139, Whirling Frenzy: "…, and two claw Strikes, each against a different target".)
        if (match[2]) each = true;
        for (const part of match[1].split(/,\s*(?:and\s+)?/)) {
            const piece = /^(a|an|one|two|three|four) ([\w' -]+?) Strikes?$/i.exec(part.trim());
            if (!piece) return null;
            for (let index = 0; index < count(piece[1]); index++) strikes.push(named(piece[2]));
        }
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
    } else if ((match = /^(?:The )?[^.]+? makes a Strike with (?:its|their|his|her) ([\w' -]+?), ([\w' -]+?),? and ([\w' -]+?) and targeting a different creature\.$/i.exec(first))) {
        // (Three-Headed Strike, batch 43: "makes a Strike with its dragon jaws, lion jaws, and goat horns, each at a -2 penalty and
        // targeting a different creature": a different Strike at each.)
        strikes.push(named(match[1]), named(match[2]), named(match[3]));
        each = true;
    } else if ((match = /^(?:The )?[^.]+? makes a Strike with each of (?:its|their|his|her) heads and targeting a different creature\.$/i.exec(first)) && (match = /\ball (two|three|four|five) attacks\b/i.exec(body))) {
        // ("… with each of its heads …, until after it has made all three attacks": that many, its best melee Strike each.)
        for (let index = 0; index < count(match[1]); index++) strikes.push(null);
        each = true;
    } else if ((match = /^(?:The )?[^.]+? makes? one Strike with each of (?:its|their|his|her) (?!two |three )[\w' -]+?, both against the same (?:target|creature)\.$/i.exec(first))) {
        // (Twin Feint, batch 43: "He makes one Strike with each of his short swords, both against the same target": its best melee
        // Strike twice.)
        strikes.push(null, null);
        sameTarget = true;
    } else if ((match = /^(?:The )?[^.]+? Strikes once with (?:its|their|his|her) ([\w' -]+?) and once with (?:its|their|his|her) ([\w' -]+?), each targeting a different creature\.$/i.exec(first))) {
        // (Thrash, batch 47: "The remorhaz Strikes once with its jaws and once with its tail, each targeting a different creature.")
        strikes.push(named(match[1]), named(match[2]));
        each = true;
    } else if ((match = /^(?:(?:The )?[^.]+? makes?|Make) two Strikes against (?:(?:its|their|his|her|your) (?:hunted prey|menaced prey|target)|a creature|[^.]+?'s hunted prey), one with each of the required weapons\.$/i.exec(first))) {
        // (Twin Takedown, batch 42: "They make two Strikes against their hunted prey, one with each of the required weapons": its best
        // melee Strikes, at one creature.)
        strikes.push(null, null);
        sameTarget = true;
    } else if ((match = /^(?:The )?[^.]+? makes (two) Strikes(?: against the same target)?, one with (?:its|their|his|her) ([\w' -]+?) and (?:one|the other) with (?:its|their|his|her) ([\w' -]+?)(?:, both against the same (?:target|creature))?\.$/i.exec(first))) {
        strikes.push(named(match[2]), named(match[3]));
        if (/same target/i.test(first)) sameTarget = true;
    } else if ((match = /^(?:The )?[^.]+? makes (two|three|four) ([\w' -]+?) Strikes, ignoring the multiple attack penalty until after (?:both|all|the (?:second|last)) (?:Strikes|attacks|Strike|attack)\.$/i.exec(first)) || (match = /^(?:The )?[^.]+? makes (one|a) ([\w' -]+?) Strike and (?:one|a) ([\w' -]+?) Strike, ignoring the multiple attack penalty until after (?:both|the second) (?:Strikes|Strike)\.$/i.exec(first))) {
        if (match[3]) strikes.push(named(match[2]), named(match[3]));
        else for (let index = 0; index < count(match[1]); index++) strikes.push(named(match[2]));
        sameMap = true;
    } else return null;
    if (strikes.length < 2) return null;
    // What may follow: the order, the attack penalty, damage combined against resistances, who it's against.
    let secondOffGuard = null;
    let bothHit = null;
    let noGrab = false;
    // (Batch 152: what each Strike's critical hit brings, Fan of Daggers' "On a critical hit, the target takes 2d10 bleed damage and is Blinded for
    // 1 round"; extra damage on each, Hellfire Flurry's "These attacks deal an extra 1d4 fire damage".)
    let critical = null;
    const extraDamage = [];
    // (Batch 243: a tag of several parts, "@Damage[3d8[force],3[force]]", as each part.)
    const damageTags = (said) => [...said.matchAll(/@Damage\[((?:[^[\]]|\[[^\]]*\])*)\](?:\{[^}]*\})?/g)].flatMap((tag) => tag[1].split("|")[0].split(/,(?![^[]*\])/));
    for (let sentence of sentences) {
        const extra = /^(?:These|The|Both) (?:attacks|Strikes) deal an? (?:extra|additional) (@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?) damage\.$/i.exec(sentence);
        if (extra && !extraDamage.length) {
            extraDamage.push(...damageTags(extra[1]));
            continue;
        }
        const crit = /^On a critical hit, the (?:target|creature) (?:also )?(?:takes |is dealt )?(.+?)\.$/i.exec(sentence.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1"));
        if (crit && !critical) {
            const damage = damageTags(crit[1]);
            const rest = crit[1].replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?(?: damage)?/g, "").trim();
            const conditions = [...rest.matchAll(new RegExp(String.raw`\b(${BOTH_CONDITIONS})(?: (\d+))?(?: for (\d+) rounds?)?\b`, "gi"))].map((found) => ({ slug: found[1].toLowerCase(), value: found[2] ? Number(found[2]) : null, rounds: found[3] ? Number(found[3]) : null }));
            const left = rest.replace(new RegExp(String.raw`\b(?:${BOTH_CONDITIONS})(?: \d+)?(?: for \d+ rounds?)?\b`, "gi"), "").replace(/\b(?:and|also|knocked|is|becomes)\b|[,\s]/gi, "");
            if ((conditions.length || damage.length) && !left) {
                critical = { conditions, damage };
                continue;
            }
        }
        if (/^(?:It|They|He|She) can make (?:these|the|them|those)(?: (?:Strikes|attacks))?(?: in any order)?\.$/i.test(sentence)) continue;
        // (Batch 150, Dig In: "The rhino warrior rolls only one attack roll for both Strikes, then compares the result against the creature's AC.")
        if (/^(?:The [\w' -]+?|It|They|He|She) rolls only one attack roll for both Strikes, then compares the result against the creature's AC\.$/i.test(sentence)) {
            notes.push("One attack roll for both Strikes.");
            continue;
        }
        // (Batch 212, Battlezoo: each Strike at its own creature with the penalty held until all are made, in one sentence; the activity ending on a
        // critical miss, a note; the Strikes counted as one attack.)
        if (/^(?:It|They) must make each attack against a different creature, but (?:it|they) (?:doesn't|don't|does not|do not) apply (?:its|their) multiple attack penalty until after making (?:both|all(?: (?:its|their|two|three|four))?) Strikes\.$/i.test(sentence) && !sameTarget) {
            each = true;
            sameMap = true;
            continue;
        }
        if (/^If (?:either|any) (?:of the )?Strikes? (?:is|are|results? in) a critical (?:miss|failure), [A-Z][\w' -]+? ends\.$/i.test(sentence)) {
            notes.push("A critical miss ends it.");
            continue;
        }
        if (/^(?:These|They|These Strikes|These attacks) counts? as only one attack for [^.]*multiple attack penalty\.$/i.test(sentence)) {
            sameMap = true;
            countsAs = 1;
            continue;
        }
        // (Batch 139, Team Attack: "Each must target a different creature.")
        if (/^Each must target a different (?:creature|target|foe|enemy)\.$/i.test(sentence) && !sameTarget) {
            each = true;
            continue;
        }
        if (/^The second half of this movement (?:doesn't|does not) trigger reactions\.$/i.test(sentence) && notes.some((note) => /second flight triggers no reactions/.test(note))) continue;
        // (Batch 138, Tentacle Stab: "These Strikes deal piercing damage instead of bludgeoning, and the quoppopak can't Grab with them." —
        // for the GM; no Grab after them.)
        if ((match = /^These Strikes deal (\w+) damage instead of (\w+)(, and (?:the [\w' -]+?|it|they|he|she) can(?:'t|not) Grab with them)?\.$/i.exec(sentence))) {
            notes.push(`These Strikes deal ${match[1].toLowerCase()} damage instead of ${match[2].toLowerCase()}.`);
            if (match[3]) {
                noGrab = true;
                notes.push("It can't Grab with them: skip a Grab card after them.");
            }
            continue;
        }
        // (Twin Feint, batch 43: "The target is automatically Off-Guard against the second attack.")
        if (/^The target is automatically Off-Guard against the second attack\.$/i.test(sentence) && strikes.length === 2) {
            secondOffGuard = true;
            continue;
        }
        // (Batch 124, Double Strike: "If his first attack hits, the target is Off-Guard to the second attack.")
        if (/^If (?:its|his|her|their) first (?:attack|Strike) hits, the target is Off-Guard (?:to|against) the second (?:attack|Strike)\.$/i.test(sentence) && strikes.length === 2) {
            secondOffGuard = "hit";
            continue;
        }
        // (Three-Headed Strike: "These Strikes count as only one attack for the chimera's multiple attack penalty, and the penalty
        // doesn't increase until after it has made all three attacks", "… count as two attacks …".)
        if ((match = /^These Strikes count as (only one attack|one attack|two attacks|three attacks) for [^.]*multiple attack penalty, and the penalty (?:doesn't|does not) increase until (?:after )?(?:(?:it|he|she|they) (?:has|have) made all (?:two|three|four|five) attacks|both attacks)\.?$/i.exec(sentence))) {
            sameMap = true;
            countsAs = /one/i.test(match[1]) ? 1 : count(match[1].split(" ")[0]);
            continue;
        }
        // (Batch 124: "… but do not increase the penalty until it has made both attacks", "… but she doesn't increase her penalty until after she has
        // made both attacks", "Each attack uses Talmandor's current multiple attack penalty".)
        if (/\bmultiple attack penalty\b[^.]*\b(?:(?:doesn't|does not|do not|don't) increase (?:the|its|their|his|her) penalty until)\b|^Each attack uses (?:the [\w' -]+?['’]s|[A-Z][\w'-]+['’]s|its|their|his|her) current multiple attack penalty\.$/i.test(sentence) && !/-\d+|–\d+/.test(sentence)) {
            sameMap = true;
            continue;
        }
        if (/\bmultiple attack penalty\b[^.]*\b(?:doesn't|does not) increase until\b|\bmultiple attack penalty increases only after\b|\bpenalty applies to each attack,? but increases only after\b|\bpenalty (?:doesn't|does not) increase(?: the)? until\b|\bpenalty increases only after\b|\buses? the same multiple attack penalty as the first\b|\beach using the [\w' -]+?'s current multiple attack penalty\b/i.test(sentence) && !/-\d+|–\d+/.test(sentence)) {
            sameMap = true;
            continue;
        }
        // (Batch 139, Mangling Rend: "If both hit, the attack deals an additional 2d6 bludgeoning damage, the target is Off-Guard, and the target
        // takes a –20-foot status penalty to all Speeds until the end of its next turn." — the Speeds the GM's (PF2e's linked effect has them).)
        if ((match = /^If both (?:Strikes |attacks )?hit, the attack deals an additional (@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?) damage, the target is Off-Guard, and the target takes an? [-\u2013\u2212](\d+)-foot status penalty to all Speeds until the end of its next turn\.$/i.exec(sentence))) {
            bothHit = { conditions: [{ slug: "off-guard", value: null, rounds: 1 }], damage: [/^@Damage\[((?:[^[\]]|\[[^\]]*\])*)\]/.exec(match[1])[1].split("|")[0]] };
            notes.push(`If both hit, the target also takes a –${match[2]}-foot status penalty to all its Speeds until the end of its next turn.`);
            continue;
        }
        if (/^Effect: [\w' -]+$/.test(sentence) && bothHit) continue;
        // (Batch 139, Rapid Rake: "Each attack counts toward the aurumvorax's multiple attack penalty, and the multiple attack penalty increases with
        // each attack.")
        if (/^Each attack counts toward (?:the [\w' -]+?['’]s|its|their|his|her) multiple attack penalty, and the (?:multiple attack )?penalty increases with each attack\.$/i.test(sentence)) continue;
        // (Batch 153, Combat Current: "If they moved through an enemy when they Flew, that enemy is Off-Guard against the second Strike.")
        if (/^If (?:it|they|he|she) moved through an enemy when (?:it|they|he|she) Flew, that enemy is Off-Guard against the second Strike\.$/i.test(sentence) && notes.some((note) => /between the two Strikes/.test(note))) {
            notes.push("An enemy it flew through is Off-Guard against the second Strike.");
            continue;
        }
        if (/\bmultiple attack penalty\b[^.]*\b(?:as normal|normally)\b|\bcount(?:s)? toward (?:its|their|his|her|the [\w' -]+?'s) multiple attack penalty(?: as normal)?\.$|^Apply the multiple attack penalty to these Strikes normally\.$/i.test(sentence)) continue;
        // (Batch 130, Haphazard Hack: "These attacks count toward her multiple attack penalty, but only after all three Strikes have been made.")
        if (/^These attacks count toward (?:its|their|his|her) multiple attack penalty, but only after all (?:two|three|four) Strikes have been made\.$/i.test(sentence)) {
            sameMap = true;
            continue;
        }
        // (… and "After taking this activity, Rekarek is Off-Guard until the beginning of her next turn.")
        if (/^After taking this activity, (?:the [\w' -]+?|[A-Z][\w'-]+|it|they|he|she) (?:is|are) Off-Guard until the (?:beginning|start) of (?:its|their|his|her) next turn\.$/i.test(sentence)) {
            after.push({ slug: "off-guard", value: null, until: "own-turn-start" });
            continue;
        }
        // Damage combined against resistances, and nothing more ("…, and the creature must succeed at a save" isn't).
        if (/\bcombine(?:s|d)? (?:their|the|both Strikes'|both attacks') damages?\b|\bdamage is combined\b/i.test(sentence) && !/\b(?:save|must|condition|additional|extra|takes?|Grabbed|Prone|Stunned)\b/i.test(sentence.replace(/\bapply (?:resistances|weaknesses)[^.]*/i, ""))) continue;
        // (Batch 80: what both hits bring — "If they both hit, the target becomes Slowed 1 for 1 round", "If both attacks hit, the target is
        // also knocked Prone", "If both hit, the creature takes 2d10 bleed …", "If both attacks hit, the target is also dealt 1d8 persistent
        // bleed damage" → bothHit { conditions, damage }; on the creature both Strikes hit.)
        // (Batch 113, Bloody Flurry: "If the kholo outrider hits the same enemy with both Strikes, that enemy takes an additional … damage.")
        sentence = sentence.replace(/^If (?:the [\w' -]+?|it|they) hits? the same (?:enemy|creature|target) with both (?:Strikes|attacks), that (?:enemy|creature|target) /i, "If both Strikes hit the same target, the target ")
            // (Batch 130, Twin Butchery: "In addition, if both Strikes hit, the menaced prey is Off-Guard until …".)
            .replace(/^In addition, if both (Strikes|attacks) hit, the (?:menaced |hunted )?prey is /i, "If both $1 hit, the target is ")
            // (Batch 124, Scorching Maul: "A creature hit by both claw Strikes also takes 1d4 persistent fire damage.")
            .replace(/^An? (?:creature|target|enemy) hit by both (?:[\w' -]+? )?(?:Strikes|attacks) (?:also )?takes /i, "If both Strikes hit the same target, the target takes ")
            // (Batch 138, Sanguine Mauling: "If it hits with both claws, the target takes 1d6 bleed.")
            .replace(/^If (?:the [\w' -]+?|it|they|he|she) hits? (?:the same (?:creature|target) )?with both [\w' -]+?, the (?:target|creature) /i, "If both Strikes hit the same target, the target ");
        // (Batch 198, Gory Rend: "If both hit, the creature takes @Damage[2d10[bleed]] and is exposed to piscovenom." — its affliction too, by name.)
        // (Batch 213, Frightening Flurry: "The target becomes Frightened with a condition value equal to the number of Strikes that hit it, to a maximum of
        // frightened 3 if all three Strikes hit." — the value its hits.)
        if (/^The target becomes Frightened with a condition value equal to the number of Strikes that hit it(?:, to a maximum of frightened \d if all (?:two|three|four) Strikes hit)?\.$/i.test(sentence) && sameTarget) {
            bothHit = { conditions: [{ slug: "frightened", value: null, rounds: null }], damage: [], atLeast: 1, perHit: true };
            continue;
        }
        // (Batch 212, a Battlezoo creature's bites: a condition for a creature at least two of the three hit, not only when all hit.)
        let atLeast = null;
        sentence = sentence.replace(/^If two or more (?:attacks|Strikes) hits? the same (target|creature), (?:it|that (?:target|creature)) (becomes|is|takes) /i, (_all, who, verb) => {
            atLeast = 2;
            return `If both Strikes hit the same ${who}, the ${who} ${verb} `;
        });
        let exposed = null;
        if (/^If (?:they )?both (?:Strikes |attacks )?hit\b/i.test(sentence)) sentence = sentence.replace(/,? and is exposed to ([a-z][\w' -]+?)(?=\.$)/i, (_all, name) => {
            exposed = name.trim();
            return "";
        });
        const both = /^If (?:they )?both (?:Strikes |attacks )?hit(?: the same (?:creature|target))?(?: and deal damage)?, (?:the (?:target|creature) (?:becomes|is (?:also )?(?:knocked )?)|the (?:target|creature) (?:also )?(?:takes|is (?:also )?dealt) )(.+?)\.$/i.exec(sentence.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1"));
        if (both) {
            // (Batch 124, Barbed Limbs: "… is Grabbed until the end of the mantis's next turn" — for a round.)
            // (Batch 175, Guardbreaker: "until the start of Rayhnne's next turn" — its name.)
            const untilNext = /\buntil the (?:end|start|beginning) of (?:the [\w' -]+?['’]s|(?:[A-Z][\w'-]+ )*[A-Z][\w'-]+['’]s|its|their|his|her) next turn\b/.test(both[1].replace(/\bUntil\b/, "until"));
            const said = both[1].replace(/-stuck between the doors\b/i, "").replace(/\s*\buntil the (?:end|start|beginning) of (?:the [\w' -]+?['’]s|(?:[A-Z][\w'-]+ )*[A-Z][\w'-]+['’]s|its|their|his|her) next turn\b/, untilNext ? " for 1 round" : "");
            const damage = [...said.matchAll(/@Damage\[((?:[^[\]]|\[[^\]]*\])*)\](?:\{[^}]*\})?/g)].map((tag) => tag[1].split("|")[0]);
            const rest = said.replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?(?: damage)?/g, "").trim();
            const conditions = [...rest.matchAll(new RegExp(String.raw`\b(${BOTH_CONDITIONS})(?: (\d+))?(?: for (\d+) rounds?)?\b`, "gi"))].map((found) => ({ slug: found[1].toLowerCase().replace(/^knocked /, ""), value: found[2] ? Number(found[2]) : null, rounds: found[3] ? Number(found[3]) : null }));
            // (Nothing else in it: not an exposure to a poison, a Disarm, temporary Hit Points.)
            const left = rest.replace(new RegExp(String.raw`\b(?:${BOTH_CONDITIONS})(?: \d+)?(?: for \d+ rounds?)?\b`, "gi"), "").replace(/\b(?:and|also|knocked|is|the target|becomes|dealt|takes|an additional|an extra)\b|[,\s]/gi, "");
            if ((conditions.length || damage.length) && !left) {
                bothHit = { conditions, damage, ...(exposed ? { affliction: exposed.toLowerCase() } : {}), ...(atLeast ? { atLeast } : {}) };
                continue;
            }
        }
        // (Batch 87, Dual Disarm: "If both Strikes hit, the ship captain can attempt to Disarm the target." → a basic action at it.)
        const bothFollow = /^If both (?:Strikes|attacks) hit, (?:the [\w' -]+?|it|they|he|she) can attempt to (Disarm|Trip|Shove|Grapple|Reposition|Demoralize) the (?:target|creature)\.$/i.exec(sentence.replace(/\[\[\/act (\w+)[^\]]*\]\](?:\{[^}]*\})?/g, (_all, slug) => slug.replace(/^\w/, (letter) => letter.toUpperCase())));
        if (bothFollow) {
            bothHit = { conditions: [], damage: [], follow: bothFollow[1].toLowerCase() };
            continue;
        }
        // (Batch 90: Whirling Death's "No single creature can be targeted by more than one blade Strike during one use of this ability.";
        // Axe Swipe's "The second attack uses the same multiple attack penalty as the first, but attacks they make after this take a –10
        // multiple attack penalty."; Bloody Dance's "… can use Grab following this activity, separately attempting to Grapple each creature hit
        // by a claw."; Fervent Frenzy's off-guard against them while frightened by its other ability (the GM's) and "becomes Clumsy 1 until the
        // start of their next turn".)
        // (Batch 91: Extend Limbs' "… reach increases to 20 feet for these Strikes" — the GM's; Paired Strike's "This counts as one attack when
        // calculating the maftet's multiple attack penalty".)
        if (/^(?:The [\w' -]+?['’]s|Its|Their|His|Her) reach increases to \d+ feet for these Strikes\.$|^These Strikes have a reach of \d+ feet\.$/i.test(sentence)) continue;
        // (Batch 174, the pirate skeleton's Focused Assault: "… doesn't use this ability if there is more than one creature within its reach that it
        // can see." — the GM's.)
        if (/^(?:The [\w' -]+?|It|They|He|She) (?:doesn't|does not) use this ability if there is more than one creature within (?:its|their|his|her) reach that (?:it|they|he|she) can see\.$/i.test(sentence)) {
            notes.push("Only while it can see no more than one creature in its reach.");
            continue;
        }
        // (Batch 201, Full Bore: "… when determining …".)
        if ((match = /^This counts as (one|two) attacks? when (?:calculating|determining) [^.]*multiple attack penalty\.$/i.exec(sentence))) {
            sameMap = true;
            countsAs = /one/i.test(match[1]) ? 1 : 2;
            continue;
        }
        if (/^No single creature can be targeted by more than one [\w' -]+? Strike during one use of this ability\.$/i.test(sentence)) {
            each = true;
            continue;
        }
        if (/^The second attack uses the same multiple attack penalty as the first, but attacks (?:it|they|he|she) makes? after this take a [-\u2013\u2212]10 multiple attack penalty\.$/i.test(sentence)) {
            sameMap = true;
            countsAs = 2;
            continue;
        }
        // (Batch 190: Spring Forward's Knockdown after them; Dead Shot's "Both Strikes must have the same target, who must be within the first range
        // increment of both weapons."; a blog creature's "must be able to move at least half its Speed to …".)
        if (/^(?:The [\w' -]+?|It|They|He|She) can use Knockdown following this activity, attempting to Trip each creature struck\.$/i.test(sentence)) {
            notes.push("After them, it can attempt to Trip each creature it hit (Knockdown).");
            continue;
        }
        // (Dead Shot's "The pale stranger adds any precision damage only once, to the attack of their choice." — the GM's.)
        if (/^(?:The [\w' -]+?|It|They) adds? any precision damage only once, to the attack of (?:its|their) choice\.$/i.test(sentence)) {
            notes.push("Its precision damage only once, on one of the Strikes.");
            continue;
        }
        if (/^Both Strikes must have the same target, who must be within the first range increment of both weapons\.$/i.test(sentence)) {
            sameTarget = true;
            notes.push("Its target must be within both weapons' first range increment.");
            continue;
        }
        if (/^(?:The [\w' -]+?|It|They) must be able to move at least half (?:its|their) Speed to [\w' -]+?\.$/i.test(sentence)) {
            notes.push(sentence);
            continue;
        }
        if (/^(?:The [\w' -]+?|It|They|He|She) can use Grab following this activity, separately attempting to Grapple each creature hit by an? [\w' -]+\.$/i.test(sentence)) {
            grab = true;
            continue;
        }
        if (/^If the target creature is currently frightened by an? [\w' -]+?['’]s [\w' -]+? ability, it's Off-Guard against these attacks\.$/i.test(sentence)) continue;
        if ((match = /^(?:The [\w' -]+?|It|They|He|She) becomes? (\w+) (\d+) until the (?:beginning|start) of (?:its|their|his|her) next turn\.$/i.exec(sentence))) {
            after.push({ slug: match[1].toLowerCase(), value: Number(match[2]), until: "own-turn-start" });
            continue;
        }
        // (Batch 124, Twisting Reach: "The myrucarx can't Grab as its next action after Twisting Reach." — the GM's, a note.)
        if (/^(?:The [\w' -]+?|It|They|He|She) can(?:'t|not) (?:Grab|Strike|use [\w' -]+?) as (?:its|their|his|her) next action after [\w' -]+\.$/i.test(sentence)) {
            notes.push(sentence);
            continue;
        }
        // (Wing Snap: "It can't Fly until the end of its turn.")
        if (/^(?:It|They) can(?:'t|not) Fly until the end of (?:its|their) turn\.$/i.test(sentence)) continue;
        // (Batch 129, Bomb Barrage: "These Strikes can be made against the same creature or different creatures, as long as all targets are within
        // 40 feet of each other." — its choice.)
        if (/^These Strikes can be made against the same creature or different creatures(?:, as long as all targets are within \d+ feet of each other)?\.$/i.test(sentence)) continue;
        // (Batch 131, Double Slice's other words: precision damage once; the second Strike's –2 without agile, the GM's.)
        if (/^(?:Add any precision damage only once(?:, to the attack of your choice)?|Precision damage is added only once)\.$/i.test(sentence)) continue;
        if (/^If the second Strike is made with a weapon that (?:doesn't|does not) have the agile trait, it takes a [-\u2013\u2212]2 penalty\.$/i.test(sentence)) {
            notes.push("The second Strike takes a –2 penalty if its weapon isn't agile.");
            continue;
        }
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
        // (Batch 124, Battle Dance: "It can replace any of these Strikes with Demoralize or Step." — the GM's, a note.)
        if (/^(?:It|They|He|She|The [\w' -]+?) can replace any of these Strikes with [^.]+\.$/i.test(sentence)) {
            notes.push(sentence.replace(/\[\[\/act (\w+)[^\]]*\]\](?:\{([^}]*)\})?/g, (_all, slug, label) => label ?? slug.replace(/^./, (letter) => letter.toUpperCase())));
            continue;
        }
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
        // (Batch 60, Double Attack: "If the zelekhut subsequently uses the Knockdown action, it affects all creatures it hit with Double
        // Attack.", the kraken's "… uses the Grab action, it Grabs any number of creatures it hit …" — the GM's.)
        if (/^If (?:the [\w' -]+?|it|they|[A-Z][\w'-]*) subsequently uses? the (?:Knockdown|Grab|Improved Grab) action, (?:it|they) (?:affects all|(?:can )?Grabs? any number of) creatures (?:it|they) hit with [\w' -]+\.$/i.test(sentence)) continue;
        return null;
    }
    // (A Strike at each of several creatures: in turn, a different one at each when it names several, batch 43.)
    return { strikes, sameMap, sameTarget: sameTarget || Boolean(bothHit), oncePerTurn, ...(chain ? { chain: true } : {}), ...(bothHit ? { bothHit } : {}), ...(secondOffGuard ? { secondOffGuard } : {}), ...(countsAs !== null ? { countsAs } : {}), ...(each ? { each: true, max: strikes.length } : {}), ...(grab ? { grab: true } : {}), ...(penalty ? { penalty } : {}), ...(requires ? { requires } : {}), ...(after.length ? { after } : {}), ...(notes.length ? { notes } : {}), ...(noGrab ? { noGrab } : {}), ...(critical ? { critical } : {}), ...(extraDamage.length ? { extraDamage } : {}), ...(then ? { then } : {}), ...(strides ? { strides } : {}), ...(oncePerFight ? { oncePerFight } : {}) };
}

// One attack roll against several foes' AC (Swipe, Wide Swing; 2026-10-10): "The veteran makes a melee Strike and compares the
// attack roll result to the AC of up to two foes, each of whom must be within their melee reach and adjacent to each other. Roll
// damage only once and apply it to each creature hit. A Swipe counts as two attacks for the veteran's multiple attack penalty."
// → { strike, max }, or null.
// (Batch 174: Axe Swipe's "makes a melee Strike with a +1 circumstance bonus to the attack roll and compares the roll to the AC of up to two foes
// that are in reach and adjacent to each other. The champion rolls damage only once …"; Double Chomp's "makes a jaws Strike targeting two creatures
// adjacent to each other. Roll the attack and damage once, and apply it to each creature separately."; Ricochet's "Frequency once per round …,
// each of whom must be within 60 feet of Vewslog" → { …, bonus, oncePerTurn, notes }.)
export function readSwipe(text) {
    let bonus = 0;
    let oncePerTurn = false;
    const notes = [];
    const sentences = text.trim()
        .replace(/^Frequency once per (?:turn|round)\.? Effect /i, () => {
            oncePerTurn = true;
            return "";
        })
        .replace(/\b(makes an? (?:[\w' -]+? )?Strike) with an? \+(\d+) circumstance bonus to the attack roll and compares the roll to\b/i, (_all, made, value) => {
            bonus = Number(value);
            return `${made} and compares the attack roll result to`;
        })
        .replace(/\b(of up to two (?:foes|creatures)) that are in reach and adjacent to each other\./i, "$1, each of whom must be within its reach and adjacent to each other.")
        .replace(/\b(makes an? [\w' -]+? Strike) targeting two creatures adjacent to each other\./i, "$1 and compares the attack roll result to the AC of up to two creatures, each of whom must be within its reach and adjacent to each other.")
        .replace(/\b(of up to two (?:foes|creatures)), each of whom must be within (\d+) feet of (?:the [\w' -]+?|it|him|her|them|[A-Z][\w'-]+)\./i, (_all, lead, feet) => {
            notes.push(`Each within ${feet} feet of it.`);
            return `${lead}.`;
        })
        .split(/(?<=\.)\s+(?=[A-Z])/);
    // (Batch 42: a first sentence that only tells what it does, "The test draugr lashes out at every foe it can reach.")
    if (sentences.length > 1 && !/\bStrikes?\b|\d|@/.test(sentences[0]) && /\bcompares the attack roll\b/i.test(sentences[1])) sentences.shift();
    // (Batch 38, Wide Swing: "makes a single greataxe Strike and compares the attack roll result to the ACs of up to two foes within
    // its reach"; batch 42: "within the guard captain's melee reach and adjacent to the other".)
    // (Batch 129, Whirlwind Kick: "makes a single Strike and compares the result to the AC of all creatures within its reach, dealing damage to
    // each creature hit" — every creature in its reach.)
    const all = /^(?:The )?[^.]+? makes (?:a single |an? )(?:([\w' -]+?) )??Strike and compares the (?:attack roll )?result to the (?:AC|ACs|Armor Class) of all (?:creatures|foes|enemies) within (?:its|their|his|her) reach(?:, dealing damage to each creature hit)?\.$/i.exec(sentences[0] ?? "");
    if (all && sentences.length === 1) return { strike: all[1] && !/^(?:melee|weapon|unarmed)$/i.test(all[1]) ? all[1].toLowerCase() : null, max: 8 };
    const match = /^(?:The )?[^.]+? makes (?:a single |an? )(?:([\w' -]+?) )??Strike and compares the attack roll(?: result)? to the (?:AC|ACs|Armor Class) of up to (two|three) (?:foes|enemies|creatures|targets)(?:, each of whom must be within (?:(?:its|their|his|her) [\w' -]+?['’]s|its|their|his|her|the Strike's|the [\w' -]+?'s) (?:melee )?reach(?: and adjacent to (?:each other|the other|at least one other target))?| within (?:its|their|his|her) reach)?\.$/i.exec(sentences.shift() ?? "");
    if (!match) return null;
    let countsAs = null;
    for (const sentence of sentences) {
        // (Batch 221, Tail Sweep: three foes, counted as two attacks.)
        const counted = /^(?:(?:An?|The|This) )?(?:[\w' -]+? )?counts as (two|three) attacks (?:for|when calculating|toward) [^.]*multiple attack penalty\b/i.exec(sentence);
        if (counted) countsAs = NUMBERS[counted[1].toLowerCase()];
        if (/^(?:Roll|(?:The [\w' -]+?|It|They|He|She) rolls?) (?:the )?damage (?:only )?once(?:,)? and appl(?:y|ies) it to each creature (?:hit|(?:it|they|he|she|the [\w' -]+?) hits?)\.$|^Roll the attack and damage once, and apply it to each creature separately\.$/i.test(sentence)) continue;
        if (/^(?:(?:An?|The|This) )?(?:[\w' -]+? )?counts as (?:two|three) attacks (?:for|when calculating|toward) [^.]*multiple attack penalty(?:, (?:but|though) the penalty (?:does not|doesn't) increase until after (?:both|all) attacks are resolved)?\.$/i.test(sentence)) continue;
        // (Batch 221, Tail Sweep: "It rolls damage only once and applies it to each creature hit.")
        if (/^(?:It|They) rolls? damage only once and applies it to each creature hit\.$/i.test(sentence)) continue;
        // (The sweep trait's +1 on the second: the simulation's numbers leave it out.)
        if (/^The (?:modifier of a weapon with a sweep trait|sweep bonus of (?:the [\w' -]+?'s|its|their|his|her) [\w' -]+?) applies to (?:all|these|both) attacks\.$/i.test(sentence)) continue;
        return null;
    }
    const strike = match[1] && !/^(?:melee|weapon|unarmed)$/i.test(match[1]) ? match[1].replace(/^(?:melee|ranged)\s+|\s+(?:melee|ranged)$/gi, "").toLowerCase() : null;
    return { strike, max: NUMBERS[match[2].toLowerCase()], ...(bonus ? { bonus } : {}), ...(oncePerTurn ? { oncePerTurn: true } : {}), ...(countsAs && countsAs !== NUMBERS[match[2].toLowerCase()] ? { countsAs } : {}), ...(notes.length ? { notes } : {}) };
}

// "The guard Strides twice. If it ends its movement within melee reach of at least one enemy, it makes a melee Strike against
// that enemy." (Sudden Charge; 2026-10-10) → "The guard Strides twice and makes a melee Strike." for the charge readers.
export function chargeSentences(text) {
    // (Batch 42: "They Stride or Swim twice; if they end their movement …, they can make a melee Strike against it.")
    // (Batch 70: "Strides twice If they end …" with its full stop missing, "If they end their flight at a lower elevation than they started and
    // within melee reach of at least one enemy, they can make a melee Strike against that enemy, gaining a +1 circumstance bonus to the
    // Strike" — the bonus as its attack roll's.)
    // (Batch 85, Clobbering Charge: "Strides up to its Speed. If it ends its movement within melee reach of a target, it can make a skull Strike
    // against that target." — one Stride.)
    // (Batch 172, Tackle: "Strides up to twice its Speed in a straight line. If it ends this movement in reach of a creature, it makes a fist
    // Strike against that creature.")
    return String(text).replace(/\b(Strides? twice|Strides? or Swims? twice|Strides up to (?:double|twice) (?:its|their|his|her) Speed|Strides up to (?:its|their|his|her) Speed|Flies twice|Flies up to (?:double|twice) (?:its|their|his|her) (?:fly )?Speed)(?: in a straight line)?(?:[.;]\s+|\s+)[Ii]f (?:it|they|he|she|the [\w' -]+?|[A-Z][\w'-]+) ends? (?:its|their|his|her|this) (?:movement|flight) (?:at a lower elevation than (?:it|they|he|she) started and )?(?:within (?:a )?(?:melee )?(?:reach|range) of (?:at least one|an?|any|one) (?:enemy|foe|creature|target)|in reach of an? (?:enemy|foe|creature)|with (?:an?|at least one) (?:enemy|foe|creature) within (?:its|their|his|her) reach), (?:it|they|he|she|the [\w' -]+?|[A-Z][\w'-]+) (?:can )?makes? an? ((?:[\w' -]+? )?)Strike against (?:that (?:enemy|foe|creature|target)|the (?:enemy|foe|creature|target)|it)(?:, gaining a \+(\d+) circumstance bonus to the Strike)?\./gi, (_whole, move, strike, bonus) => `${move.replace(/up to (?:double|twice) (?:its|their|his|her) (?:fly )?Speed/i, "twice").replace(/^Strides up to (?:its|their|his|her) Speed$/i, "Strides")} and makes a ${strike}Strike${bonus ? ` with a +${bonus} circumstance bonus to its attack roll` : ""}.`);
}

// A Strike at every creature in reach (2026-10-10): "The shambler makes a vine Strike against each creature within reach.
// Its multiple attack penalty increases only after all the attacks." → { strike, sameMap }, or null.
export function readSweep(text) {
    // (Batch 90, Sweeping Axes: "Requirements The troll warleader is wielding two battle axes Effect … and the bonus from sweep applies to each
    // attack" — what it wields; sweep's bonus left out.)
    // (Batch 102: another requirement, "The golem is uncontrollable", "is holding six spirit blades": a state the module doesn't play, the
    // GM's — requires "requirement".)
    // (Batch 140, Hateful Tide: "Requirements The sea devil baron is in a blood frenzy" — the same; "… unleashes a whirlwind of attacks against
    // its foes, making a single melee Strike with its claws or jaws against each opponent within reach" — its best melee Strike at each.)
    // (Batch 155: "is enraged" — while its rage lasts: requires "raging"; a Battlezoo rage dragon's rush that ends in a Strike at everyone it can
    // reach — one Stride first; its Draconic Momentum left out, a note.)
    const stated = /^Requirements? (?:The )?[\w' -]+? is (?:uncontrollable|holding [\w' -]+?|in a (?:blood )?frenzy|enraged|raging)\.? Effect /i;
    const required = !/^Requirements? (?:The )?[^.]+? is wielding [^.]+? Effect /i.test(text.trim()) && stated.test(text.trim());
    const raging = required && /^Requirements? (?:The )?[\w' -]+? is (?:enraged|raging)\.? Effect /i.test(text.trim());
    let strides = 0;
    let noMomentum = false;
    const notes = [];
    const sentences = text.trim().replace(/^Requirements? (?:The )?[^.]+? is wielding [^.]+? Effect /i, "").replace(stated, "").replace(/ and the bonus from sweep applies to each attack(?=\.)/i, "")
        .replace(/^((?:The )?[^.]+?) Strides(?:, Climbs,? or Swims)? up to (?:its|their|his|her) Speed(?: in a straight line)? and then makes? an? ([\w' -]+?) Strike (?:at all creatures within reach at the end of (?:its|their|his|her) movement|against every creature in (?:its|their|his|her) reach once (?:it|they|he|she) stops?)\./i, (_all, who, name) => {
            strides = 1;
            notes.push("It moves up to its Speed in a straight line first (Stride, Climb or Swim).");
            return `${who} makes a ${name} Strike against all creatures within reach.`;
        })
        .replace(/(?<=\. )The multiple attack penalties for these attacks (?:don't|do not) apply until after resolving the attacks(, and (?:the [\w' -]+?|it|they) can(?:'t|not) benefit from draconic momentum from these attacks)?\./i, (_all, momentum) => {
            if (momentum) {
                noMomentum = true;
                notes.push("These Strikes don't recharge its Breath Weapon through Draconic Momentum.");
            }
            return "Its multiple attack penalty doesn't increase until after all the attacks.";
        })
        .replace(/(?<=\. )(?:These Strikes|They) (?:don't|do not) set off (?:its|their) Draconic Momentum\./i, () => {
            noMomentum = true;
            notes.push("These Strikes don't recharge its Breath Weapon through Draconic Momentum.");
            return "";
        })
        .replace(/^((?:The )?[^.]+?) unleashes [^,.]+, making (a single (?:melee )?Strike) with (?:its|their|his|her) [\w' -]+?(?: or [\w' -]+?)? against each opponent within reach\./i, "$1 makes $2 against each enemy within reach.")
        // (Batch 212, Battlezoo: "attacks" for Strikes at all in its reach; a Fly that Strikes any creatures beside its path; a straight-line charge
        // that Strikes each foe it passes — the move first, a note.)
        .replace(/^((?:The )?[^.]+?) makes ([\w' -]+?) attacks against (all creatures|each creature|each enemy|all enemies) within (?:its|their|his|her) reach\./i, "$1 makes a $2 Strike against $3 within reach.")
        .replace(/^((?:The )?[^.]+?) Flies, making ([\w' -]+?) Strikes (?:against|at) any number of creatures (?:that are adjacent to|beside) (?:its|their|his|her) path\./i, (_all, who, name) => {
            strides = 1;
            notes.push("It Flies, Striking any creatures beside its path.");
            return `${who} makes a ${name} Strike against each creature within reach.`;
        })
        .replace(/^((?:The )?[^.]+?) Strides up to twice (?:its|their|his|her) Speed in a straight line (?:and can make|and makes) a Strike against each (foe|enemy|creature) (?:within (?:its|their|his|her) reach throughout the movement|it passes within reach)\./i, (_all, who, whom) => {
            strides = 2;
            notes.push(`It Strides up to twice its Speed in a straight line, Striking each ${whom.toLowerCase()} it passes within reach.`);
            return `${who} makes a Strike against each ${whom.toLowerCase()} within reach.`;
        })
        // (So many Strikes, never twice at one creature; one Strike at up to so many different creatures; so many Strikes, each at its own target.)
        .replace(/^((?:The )?[^.]+?) makes (up to )?(two|three|four|five|six) ([\w' -]+?) Strikes, (?:attacking a given creature no more than once|never the same creature twice|each (?:of which must be )?aimed at a (?:different|separate) target)\./i, "$1 makes $2$3 $4 Strikes, each against a different target.")
        .replace(/^((?:The )?[^.]+?) makes an? ([\w' -]+?) Strike against up to (two|three|four|five|six) different creatures\./i, "$1 makes up to $3 $2 Strikes, each against a different target.")
        // (Batch 231, Battlezoo: a sweep of everything in its reach with each roll at a penalty — its penalty; a push or a grab it may add to each
        // creature it hits, a note.)
        .replace(/\b(Strike against all creatures within (?:its |their )?reach), (?:taking a [-\u2013\u2212](\d+) penalty on the attack rolls|with a [-\u2013\u2212](\d+) penalty to each attack roll)\./i, (_all, strike, minus, minus2) => `${strike}. Each attack takes a -${minus ?? minus2} circumstance penalty.`)
        .replace(/(?<=\.\s{1,3})Additionally, (?:it|they|he|she) can use (Improved Push|Improved Knockdown|Knockdown|Push|Improved Grab|Grab) on (?:every|each) (?:target|creature) (?:it|they|he|she) hits?\./i, (_all, rider) => {
            notes.push(`It can use ${rider} on each creature it hits.`);
            return "";
        })
        // (Batch 156, Slagblade Storm: "Temperbrand Strikes all creatures within her reach with a slagblade Strike.")
        .replace(/^((?:The )?[^.]+?) Strikes all creatures within (?:its|their|his|her) reach with an? ([\w' -]+?) Strike\./i, "$1 makes a $2 Strike against all creatures within reach.")
        // (Batch 150, Whirlwind Strike: "Ordulf Strikes each enemy within his reach.")
        .replace(/^((?:The )?[^.]+?) Strikes each (enemy|creature|foe) within (?:its|their|his|her) reach\./i, "$1 makes a Strike against each $2 within reach.")
        // (Batch 200, Staff Swipe: "They attempt a bo staff Strike against each enemy in a @Template[type:cone|distance:15]." — each enemy in that cone.)
        // (Batch 213: Gaze Upon's "every creature in a @Template[type:cone|distance:120]", Spearing Tail's "each creature in a @Template[line|distance:20],
        // rolling the attack roll once and applying the result to each target" — one roll, a note.)
        // (Batch 221, Flaming Stroke: "makes a greatsword Strike with a –2 circumstance penalty against each creature in a @Template[line|distance:15]. They
        // make one attack roll only and compare the result to each creature's AC. This Strike deals an additional 1d6 fire damage and counts as one attack
        // for the fire giant's multiple attack penalty" — its penalty, one roll (a note), the extra damage, one attack.)
        .replace(/\b(attempts?|makes?) an? ([\w' -]+?) Strike(?: with an? [-\u2013\u2212](\d+) circumstance penalty)? against (?:each|every) (?:enemy|creature) in an? @Template\[(?:type:)?(cone|emanation|burst|line)\|distance:(\d+)\](?:\{[^}]*\})?(, rolling the attack roll once and applying the result to each target)?\./i, (_all, made, name, minus, shape, feet, once) => {
            notes.push(`Each enemy in a ${feet}-foot ${shape.toLowerCase()}.`);
            if (once) notes.push("One attack roll for all of them.");
            return `${made} a ${name} Strike against each enemy within reach.${minus ? ` Each attack takes a -${minus} circumstance penalty.` : ""}`;
        })
        .replace(/(?<=\. )(?:They|It) makes? one attack roll only and compares? the result to each creature['’]s AC\./i, () => {
            notes.push("One attack roll for all of them.");
            return "";
        })
        // (Batch 224, Furious Fusillade: "fires one arrow at any number of creatures in a @Template[cone|distance:30]. Each attack is rolled separately." — a
        // ranged Strike at each in the cone.)
        .replace(/\bfires one arrow at any number of creatures in an? @Template\[(?:type:)?(cone|line|emanation|burst)\|distance:(\d+)\](?:\{[^}]*\})?\./i, (_all, shape, feet) => {
            notes.push(`Each creature in a ${feet}-foot ${shape.toLowerCase()}, each attack rolled separately.`);
            return "makes a ranged Strike against each creature within reach.";
        })
        .replace(/(?<=\.\s{1,3})Each attack is rolled separately\./i, "")
        .replace(/(?<=\.\s{1,3})This Strike deals an additional (@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?|\d+d\d+ [a-z]+) damage and counts as one attack for (?:the [\w' -]+?['’]s|its|their) multiple attack penalty\.?$/i, (_all, more) => `Any creature hit takes ${/^@/.test(more) ? more : `@Damage[${more.replace(/^(\d+d\d+) ([a-z]+)$/i, "$1[$2]")}]`}. This counts as one attack for its multiple attack penalty.`).split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean);
    // (Batch 102: "makes three jaws Strikes, each against a different target", "makes up to six longsword Strikes, each against a different
    // target" → that many, each at a different creature in its reach.)
    const COUNTS = { two: 2, three: 3, four: 4, five: 5, six: 6 };
    const counted = /^(?:The )?[^.]+? makes (?:up to )?(two|three|four|five|six|\d) ([\w' -]+?) Strikes, each against a dif+erent target\.$/i.exec(sentences[0] ?? "");
    // (Batch 47, Thrash: "attempts individual Strikes against each creature in its reach", "Strikes once against each creature in its reach".)
    // (Batch 83, Whirlwind of Hooks: "… against every creature within its reach", after a first sentence that only tells it.)
    // (Batch 102: "… against every creature in its reach, whether that creature is an ally or not" — Rampage, behind its requirement; "… a
    // single pseudopod Strike against each target within range it hasn't already Grabbed" — not at those it holds.)
    // (Batch 129: "They make a melee Strike against each enemy within reach", "against all creatures within his reach".)
    const SWEEP = /^(?:The )?[^.]+? (?:(?:makes?|attempts?) (?:a|an|one) (?:([\w' -]+?) )??(?:Strike|attack) (?:once )?|attempts individual Strikes |Strikes once )against (?:(?:each|every) (?:creature|enemy|foe|target)|all (?:creatures|enemies|foes|targets))(?: (?:within|in) (?:(?:its|their|his|her|the [\w' -]+?'s) )?(?:melee )?(?:reach|range))?( it (?:hasn't already Grabbed|doesn't already have Grabbed))?(, whether that creature is an ally or not)?\.$/i;
    if (!counted && sentences.length > 1 && !SWEEP.test(sentences[0]) && SWEEP.test(sentences[1]) && !/\b(?:damage|bonus|penalty|save|check|DC|Strikes?)\b|\d/i.test(sentences[0])) sentences.shift();
    const match = counted ? null : SWEEP.exec(sentences[0] ?? "");
    sentences.shift();
    if (!match && !counted) return null;
    if (match?.[3] && !required) return null;
    let sameMap = false;
    let penalty = 0;
    let countsAs = null;
    const extraDamage = [];
    const missDamage = [];
    const tag = (said) => /^@Damage\[((?:[^[\]]|\[[^\]]*\])*)\]/.exec(said)?.[1].split("|")[0] ?? null;
    for (const sentence of sentences) {
        // (Batch 213, Spearing Tail: "Any creature hit takes @Damage[4d6[bleed]] (@Damage[(2*4d6)[bleed]] on a critical hit)." — on each hit, doubled on a
        // critical as Strike damage is; bleed persistent, as PF2e's is.)
        const hitTakes = /^Any creature hit takes (@Damage\[(?:[^[\]]|\[[^\]]*\])*\])(?:\{[^}]*\})?(?: \(@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})? on a critical hit\))?\.$/i.exec(sentence);
        if (hitTakes && tag(hitTakes[1])) {
            extraDamage.push(tag(hitTakes[1]).replace(/\[bleed\]$/i, "[persistent,bleed]"));
            continue;
        }
        // (Hundred-Handed Whirlwind: "Even on a failed attack (but not a critical failure), the titan deals @Damage[24[force]] damage to the target.")
        const failed = /^Even on a failed attack \(but not a critical failure\), (?:the [\w' -]+?|it|they|he|she) deals? (@Damage\[(?:[^[\]]|\[[^\]]*\])*\])(?:\{[^}]*\})? damage to the target\.$/i.exec(sentence);
        if (failed && tag(failed[1])) {
            missDamage.push(tag(failed[1]));
            continue;
        }
        // (Spearing Tail: "This counts as two attacks for the dragon's multiple attack penalty." — all at the same penalty, then up by two.)
        const counted2 = /^This counts as (one|two|three|four) attacks? (?:for|toward) [^.]*multiple attack penalty(?:, but the penalty (?:doesn't|does not) increase until [^.]*)?\.$/i.exec(sentence);
        if (counted2) {
            sameMap = true;
            countsAs = { one: 1, ...COUNTS }[counted2[1].toLowerCase()];
            continue;
        }
        // (Batch 221: the penalty on each attack, from Flaming Stroke's reading.)
        const minus = /^Each attack takes an? -(\d+) circumstance penalty\.$/.exec(sentence);
        if (minus) {
            penalty = Number(minus[1]);
            continue;
        }
        // (Which Strikes: "It can attempt up to one jaws Strike and any number of leg Strikes", "It can make one of these Strikes with
        // each of its maws, one with its tail lash, and the rest with its legs": its best one played.)
        if (/^(?:It|They) can (?:attempt|make) up to one [\w' -]+? Strike(?:, up to one [\w' -]+? Strike)*,? and any number of [\w' -]+? Strikes\.$|^(?:It|They) can make one of these Strikes with each of (?:its|their) [\w' -]+?, one with (?:its|their) [\w' -]+?, and the rest with (?:its|their) [\w' -]+?\.$|^(?:It|They|The [\w' -]+?) can Strike up to once with each [\w' -]+?, once with (?:its|their) [\w' -]+?, and any number of times with (?:its|their) [\w' -]+?\.$/i.test(sentence)) continue;
        // ("Each attack takes a –2 circumstance penalty and counts toward the mukradi's multiple attack penalty, but the multiple attack
        // penalty doesn't increase until after all the attacks are made.")
        const taken = /^Each attack takes an? [-\u2013\u2212](\d+) circumstance penalty and counts toward [^.]*multiple attack penalty, but the multiple attack penalty (?:doesn't|does not) increase until after all the attacks (?:are|have been) made\.$/i.exec(sentence);
        if (taken) {
            penalty = Number(taken[1]);
            sameMap = true;
            continue;
        }
        // (Batch 129: "… but don't increase the amalgam's penalty until it has made all its attacks", "… they don't increase their penalty until …".)
        // (Batch 212, Battlezoo: the penalty not "suffered" until after, "only increases after", held back with the creature as the subject, or held
        // until the activity, named, is done.)
        if (/\b(?:multiple attack )?penalty\b[^.]*\b(?:doesn't|does not|don't|do not) increase(?: (?:the [\w' -]+?['’]s|its|their|his|her) penalty)? until\b|\b(?:multiple attack )?penalty increases only after\b|\b(?:doesn't|does not) suffer the penalty until\b|\bpenalty only increases after\b|\b(?:doesn't|does not|don't|do not) (?:increase|raise) (?:its|their|his|her|the [\w' -]+?['’]s) multiple attack penalty until\b|\bmultiple attack penalty, but only (?:after|once) (?:the )?[A-Z][\w' -]+? (?:is complete|ends)\b/i.test(sentence)) {
            sameMap = true;
            continue;
        }
        if (/^(?:Each attack|These attacks) counts? toward [^.]*multiple attack penalty(?: as normal)?\.$|^(?:Its|Their) multiple attack penalty applies (?:to these Strikes normally|as normal)\.$|^(?:Its|Their) penalty rises as normal\.$/i.test(sentence)) continue;
        // (Batch 89, Scimitar Storm: "The first enemy they damage is subject to Matriarch's Caress." — its other ability, the GM's.)
        if (/^The first (?:enemy|creature) (?:it|they|he|she) damages? is subject to [A-Z][\w' -]+\.$/.test(sentence)) continue;
        // "It can Strike up to once with its jaws and any number of times with its body": its Strikes, the best one played.
        if (/^(?:It|They) can Strike up to once with (?:its|their) [\w' -]+(?:, up to once with (?:its|their) [\w' -]+)*,? and any number of times with (?:its|their) [\w' -]+\.$/i.test(sentence)) continue;
        const countedUntil = /^This counts as (two|three|four|\w+) attacks (?:for|toward) [^.]*multiple attack penalty, but the penalty (?:doesn't|does not) increase until [^.]*\.$/i.exec(sentence);
        if (countedUntil) {
            sameMap = true;
            // (Batch 213: how many it counts as, for the penalty after.)
            if (COUNTS[countedUntil[1].toLowerCase()]) countsAs = COUNTS[countedUntil[1].toLowerCase()];
            continue;
        }
        if (/^Make only one attack roll, and roll damage once for all targets\.$/i.test(sentence)) {
            sameMap = true;
            continue;
        }
        return null;
    }
    // (Batch 83: "a single claw Strike": the claw's.)
    const said = counted ? counted[2] : match[1];
    // (Batch 224: "a ranged Strike" — its best ranged one.)
    const name = said && /^ranged$/i.test(said.trim()) ? "ranged" : said && !/^(?:(?:single )?(?:melee|melee weapon|weapon|unarmed)|single)$/i.test(said.trim()) ? said.trim().replace(/^(?:single\s+)?(?:melee|ranged)?\s*/i, "").toLowerCase() : null;
    const max = counted ? COUNTS[counted[1].toLowerCase()] ?? Number(counted[1]) : null;
    return { strike: name, sameMap, ...(penalty ? { penalty } : {}), ...(max ? { max } : {}), ...(countsAs ? { countsAs } : {}), ...(extraDamage.length ? { extraDamage } : {}), ...(missDamage.length ? { missDamage } : {}), ...(match?.[2] ? { notGrabbed: true } : {}), ...(required ? { requires: raging ? "raging" : "requirement" } : {}), ...(strides ? { strides } : {}), ...(noMomentum ? { noMomentum } : {}), ...(notes.length ? { notes } : {}) };
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
    const bare = new RegExp(String.raw`^(?:The )?[^.]+? (${MOVES}(?: or (?:${MOVES}|Steps?))?)( twice| up to two times)?(?:, then| and(?: then)?) Strikes(?: with (?:its|their|his|her) ([\w' -]+?))?(?: at any point during (?:its|their|his|her|the|this) movement)?\.$`, "i").exec(text);
    if (bare) return { strides: bare[2] ? 2 : 1, strike: bare[3] ? bare[3].toLowerCase() : null };
    const match = new RegExp(String.raw`^(?:The )?[^.]+? (${MOVES}(?: or ${MOVES})?)((?: (?:twice|three times|up to two times|at least \d+ feet|\d+ feet|up to (?:twice|three times|double|half|its|their|his|her|\d+ feet)[^,.]*?))?)(?: in a straight line)?(?:,? (?:while flying|descending at least \d+ feet))?,? (?:and |then |and then )+(?:makes|attempts) (?:a|an|one) (?:single )?(?:([\w' -]+?) )??Strike((?: (?:at any (?:point|time) (?:during (?:that|the|its|this) (?:movement|Stride|move|flight|Fly)|along the way|along (?:its|the) movement)|at the end of (?:that|its|the|this) (?:movement|Stride|move)|(?:after|at the end of) either Stride|against (?:a|an|one) (?:foe|enemy|creature|target)(?: (?:within (?:its|their|his|her) reach|adjacent to it))?|against any (?:foe|enemy|creature) along (?:its|their|his|her) path|against an adjacent (?:creature|foe|enemy)|with (?:a|an extended) reach of \d+ feet))*)\.$`, "i").exec(text);
    if (!match) return null;
    const how = match[2].trim();
    const strides = /three times/i.test(how) ? 3 : /twice|double|two times/i.test(how) ? 2 : 1;
    const name = match[3] && !/^(?:melee|weapon|unarmed|melee weapon)$/i.test(match[3].trim()) ? match[3].trim().replace(/^(?:melee|ranged)\s+/i, "").toLowerCase() : null;
    return { strides, strike: name };
}

// What only tells a charge (batch 70): concealed as it moves ("During this movement, wisps of ethereal smoke trail from its body, making it
// Concealed."), "The pale horse can move through creatures.", "Grace can Fly instead of Stride if she has a fly speed (…)", "It can
// substitute a Swim action in place of any Stride.", "If they damage a living creature with this Strike, the temporary Hit Points they
// receive from Glutton's Feast is increased to 2d4." (its other ability's).
const CHARGE_TELLS = /^During (?:this|the) movement, [^.]*?\bmaking (?:it|them|him|her) Concealed\.$|^(?:The [\w' -]+?|It|They|He|She) can move through creatures\.$|^(?:The [\w' -]+?|It|They|He|She|[A-Z][\w'-]+(?: [A-Z][\w'-]+)*) can Fly instead of Stride if (?:it|they|he|she) (?:has|have) a fly [Ss]peed(?: \([^)]*\))?\.$|^(?:It|They|He|She) can substitute a Swim action in place of any Stride\.$|^If (?:it|they|he|she) damages? a living creature with this Strike, the temporary Hit Points (?:it|they|he|she) receives? from Glutton's Feast (?:is|are) increased to \d+d\d+\.$/i;

// "The smilodon Strides and makes a Strike at the end of that movement." (the
// hidden note after it changes nothing in the simulation) → { strides, strike }.
// A charge's bonus for moving 20 feet comes along: "it gains a +2 circumstance
// bonus to its attack roll" → attackBonus; "the Strike's damage is increased
// to 3d10+20" → damage. Any other sentence: null.
export function readCharge(text) {
    // (Batch 55, Breach: "The megalodon Swims up to its swim Speed, then Leaps vertically out of the water up to 25 feet high, making a
    // Strike against a creature at any point during the jump (this lets it attack …). After the Strike, the megalodon splashes back down
    // into the water.": two moves and a Strike; "It can use Improved Grab on this Strike and follow it up with Fast Swallow" (its own).)
    if (/^(?:The )?[^.]+? Swims up to (?:its|their) swim Speed, then Leaps? vertically out of the water up to \d+ (?:feet high|feet in the air|feet), making a Strike against a creature (?:at any point during the jump|at the apex of the jump) \([^)]*\)\. After the Strike, (?:the [\w' -]+?|it) splashes back down(?: into the water)?\.(?: It can use Improved Grab on this Strike and follow it up with Fast Swallow\.)?$/i.test(String(text).trim())) return { strides: 2, strike: null };
    // (Batch 44, Leaping Charge: "The velociraptor Strides up to 10 feet, ignoring difficult terrain as it leaps over obstacles. It then
    // makes a Strike with its talons, gaining a +1 circumstance bonus to its attack roll.", "… Leaps up to 20 feet. It then makes a
    // mandibles Strike, gaining …": a move and a Strike, with that bonus.)
    const leap = /^(?:The )?[^.]+? (?:Strides|Leaps) up to \d+ feet(?:, ignoring difficult terrain as (?:it|they|he|she) leaps over obstacles)?\. (?:It|They|He|She) then makes (?:an? ([\w' -]+?) Strike|a Strike with (?:its|their|his|her) ([\w' -]+?)), gaining a \+(\d+) circumstance bonus to (?:its|their|his|her) attack roll\.$/i.exec(String(text).trim());
    if (leap) return { strides: 1, strike: (leap[1] ?? leap[2]).toLowerCase(), attackBonus: Number(leap[3]) };
    // (Batch 63: a move of up to half its Speed that triggers no reactions, with a Strike at a foe in reach at any point of it, the foe
    // off-guard, perhaps after a sentence that only tells it → safe, offGuard.)
    if (/^(?:[^.]+\. )?(?:The )?[^.]+? (?:Strides|Flies|Swims) up to (?:half )?(?:its|their|his|her) Speed; this movement (?:doesn't|does not) trigger reactions\. At any point during this movement, (?:it|they|he|she) can Strike an? (?:foe|creature|enemy) within reach; the (?:foe|creature|enemy|target) is Off-Guard against that attack\.$/i.test(String(text).replace(/’/g, "'").trim())) return { strides: 1, strike: null, offGuard: true, safe: true };
    // (Batch 108, Aquatic Dash: "The merfolk warrior swims and attacks in one of two patterns. They either Swim twice and Strike at the end of
    // their movement, or Swim once and Strike at any point during their movement." — the GM's choice live; two moves and a Strike played.)
    if (/^(?:The )?[^.]+? swims and attacks in one of two patterns\. (?:They|It|He|She) either Swims? twice and Strikes? at the end of (?:their|its|his|her) movement, or Swims? once and Strikes? at any point during (?:their|its|his|her) movement\.$/i.test(String(text).trim())) return { strides: 2, strike: null };
    // (Not only in the first round: "Requirements It's the first round of combat Effect The elk Strides twice …".)
    if (/^Requirements?\b[^.]*?\bfirst round of (?:combat|an encounter)\b/i.test(String(text).trim())) return null;
    // (Batch 70, Feral Leap: "The rabbit jumps with a maximum height and distance each equal to half its Speed. This movement doesn't
    // trigger reactions. At any point, the rabbit attempts a jaws Strike." → a move that triggers no reactions, and its Strike.)
    const jump = /^(?:The )?[^.]+? jumps with a maximum height and distance each equal to half (?:its|their|his|her) Speed\. This movement (?:doesn't|does not) trigger reactions\. At any point, (?:the [\w' -]+?|it|they|he|she) attempts an? ([\w' -]+?) Strike\.$/i.exec(String(text).replace(/’/g, "'").trim());
    if (jump) return { strides: 1, strike: jump[1].toLowerCase(), safe: true };
    // (Batch 87, Slip Between: "The stalker teleports into an occupied space it can see within 50 feet and makes a melee Strike." → a move
    // that triggers no reactions, as far as that many Strides go (25 feet each), and its Strike.)
    const blink = /^(?:The )?[^.]+? teleports (?:in)?to (?:an? )?(?:occupied |unoccupied |open )?(?:space|square)(?: adjacent to an? (?:creature|enemy|foe))?(?: (?:it|they|he|she) can see)? within (\d+) feet(?: of (?:its|their|his|her)self)?,? and (?:then )?makes an? (?:melee )?(?:([\w' -]+?) )?Strike\.$/i.exec(String(text).replace(/’/g, "'").trim());
    if (blink) return { strides: Math.max(1, Math.ceil(Number(blink[1]) / 25)), strike: blink[2] && !/^melee$/i.test(blink[2]) ? blink[2].toLowerCase() : null, safe: true };
    // ("Frequency once per turn Effect The knight Strides twice. …": its Effect, batch 38.)
    // (Batch 70: what only tells the move — "…, ignoring difficult terrain caused by rubble", "…, during which it attempts a High Jump or a
    // Long Jump" — and "Strides twice, Leaps twice, or Strides once and Leaps once. It then makes a jaws Strike at the end of the movement".)
    // (Batch 73: "Requirements The namorrodor has nothing in its hands Effect …" — its natural attacks need no hands.)
    // (Batch 151, Sidle-Stab!-Scamper: "Ogthup takes a Stride action, and at any point during her move can take a Strike action.")
    if (/^(?:The )?[\w' -]+? takes a Stride action, and at any point during (?:her|his|its|their) move can take a Strike action\.$/i.test(String(text).trim())) return { strides: 1, strike: null };
    // (Batch 145, Implacable Advance: "…; they can ignore difficult terrain during these Strides if they advance toward their murderer. If they
    // Strike and Grab their murderer this turn, they can Constrict as a free action immediately after the Grab." — the GM's.)
    text = String(text).replace(/(Strike); (?:they|it|he|she) can ignore difficult terrain during these Strides if (?:they|it|he|she) advances? toward (?:their|its|his|her) murderer\./i, "$1.").replace(/\s*If (?:they|it|he|she) Strikes? and Grabs? (?:their|its|his|her) murderer this turn, (?:they|it|he|she) can Constrict as a free action immediately after the Grab\.$/i, "");
    // (Batch 152: Determined Charge's "Strides, ignoring non-magical difficult terrain and uneven ground. If the shobhad ends their movement …" —
    // one Stride; the hurlilu's Dive Bomb, "Strides using its fly Speed and makes a Strike at the end of that movement".)
    const told = chargeSentences(String(text).replace(/^Requirements? (?:The )?[^.]+? has nothing in (?:its|their|his|her) hands Effect /i, "").replace(/^(?:Frequency once per (?:turn|round) )?Effect /, "").replace(/’/g, "'").replace(/\[\[\/(?:r|gmr|br|roll) [^\]]*\]\]\{([^}]*)\}/g, "$1")
        .replace(/\b(Strides), ignoring (?:non-magical )?difficult terrain(?: and uneven ground)?(?=\. If )/i, "$1 up to its Speed")
        .replace(/\bStrides using (?:its|their|his|her) (?:fly|swim|climb) Speed and makes\b/i, "Strides and makes")
        // (Batch 172, Ibis Dive: "Flies up to double its fly Speed in a straight line, descends at least 10 feet, and then makes a talon Strike.")
        .replace(/\b(Flies up to (?:double|twice) (?:its|their|his|her) fly Speed) in a straight line, descends at least \d+ feet, and then makes\b/i, "$1 and then makes"))
        .replace(/\b((?:Strides|Flies|Swims)(?: or (?:Strides|Flies|Swims))? (?:twice|up to (?:double|twice) (?:its|their|his|her) Speed)),? (?:ignoring (?:any )?difficult terrain(?: caused by [^.;]+?)?|during which (?:it|they|he|she) attempts a High Jump or a Long Jump)(?=[.;])/i, "$1")
        .replace(/\bStrides twice, Leaps twice, or Strides once and Leaps once\. (?:It|They|He|She) then makes an? ([\w' -]+?) Strike at the end of the movement\./i, "Strides twice and makes a $1 Strike.");
    const sentences = told.trim().split(/(?<=\.)\s+/);
    // (Batch 70: a move, then its Strike in a sentence of its own — "The mist bear Strides twice. During this movement, … The mist bear then
    // Strikes.", "… Strides up to twice its Speed. At any point during its movement, the morlock can make a melee Strike against an enemy
    // in its reach." — read as one; what's between only tells it.)
    const bareMove = /^((?:The )?[^.]+? (?:Strides|Flies|Swims)(?: or (?:Strides|Flies|Swims))?) (?:twice|up to (?:double|twice) (?:its|their|his|her) Speed)\.$/i.exec(sentences[0] ?? "");
    const strikeAt = bareMove ? sentences.findIndex((sentence, index) => index > 0 && /^(?:(?:The [\w' -]+?|It|They|He|She) then Strikes|At any point during (?:its|their|his|her|this|the) movement, (?:the [\w' -]+?|it|they|he|she) can make a melee Strike against an enemy in (?:its|their|his|her) reach)\.$/i.test(sentence)) : -1;
    if (strikeAt > 0 && sentences.slice(1, strikeAt).every((sentence) => CHARGE_TELLS.test(sentence))) {
        sentences.splice(0, strikeAt + 1, `${bareMove[1]} twice and makes a Strike.`);
    }
    // A first sentence that only describes it ("The goblin shark dashes forward and extends its jaws").
    // (Batch 42: "With a quick sprint, the test warrior dashes up to their foe and swings.", "… with jets of energy from its feet, …".)
    if (sentences.length > 1 && !/\b(?:Strikes?|save|damage|check|DC|bonus|penalty|\d+ feet|Hit Points|@\w+\[)\b/i.test(sentences[0]) && /^(?:[A-Z][^,.]*, (?=the ))?[Tt]he [\w' -]+? [a-z]+s\b/.test(sentences[0]) && moveThenStrike(sentences[1] ?? "")) sentences.shift();
    // (Batch 60, Ram Charge: "Strides twice in a straight line and then makes a horn Strike with a +1 circumstance bonus to its attack roll".)
    let plainBonus = 0;
    sentences[0] = (sentences[0] ?? "").replace(/ with a \+(\d+) circumstance bonus to (?:its|their|his|her) attack roll(?=\.$)/i, (_all, value) => {
        plainBonus = Number(value);
        return "";
    });
    const match = /^The [^.]+? Strides( twice)? and (?:then )?makes an? (?:([\w' -]+?) )?Strike(?: at the end of that movement)?\.$/i.exec(sentences[0] ?? "");
    // Other moves and wordings (2026-10-10): "Flies up to double its fly Speed and then makes a talon Strike".
    const other = match ? null : moveThenStrike(sentences[0] ?? "");
    if (!match && !other) return null;
    const charge = other ?? { strides: match[1] ? 2 : 1, strike: match[2] && !/^(?:melee|weapon|unarmed|melee weapon)$/i.test(match[2].trim()) ? match[2].toLowerCase() : null };
    if (plainBonus) charge.attackBonus = plainBonus;
    // (Batch 70: any name, "the ōmukade".)
    // (Batch 172, Lurching Charge: "If it moves at least 20 feet from where it started, it gets a +2 circumstance bonus on the attack roll.")
    const moved = "^(?:If|As long as) (?:it|they|he|she|the [^,.]+?|[A-Z][\\w'-]+) (?:moved|moves) at least 20 feet(?: (?:away )?from (?:its|their|his|her) starting position| from where (?:it|they|he|she) started)?, ";
    for (const sentence of sentences.slice(1)) {
        // (Batch 70: what only tells it — concealed as it moves, moving through creatures, flying or swimming in place of a Stride, another
        // ability's temporary Hit Points.)
        if (CHARGE_TELLS.test(sentence)) continue;
        // (Batch 70: "The target is Off-Guard to this attack if the bear moved at least 20 feet"; "… against this Strike unless it has seen a
        // Rearward Rush before" — the first time it's used on that creature; a circumstance bonus to its damage roll once it has moved 20 feet;
        // "The morlock then can't use Leap Attack for 1 round". Extra damage on a hit is the Strike activity's, whose card applies it.)
        if (/^The target is Off-Guard (?:to|against) this (?:attack|Strike) if (?:it|they|he|she|the [^,.]+?) moved at least 20 feet\.$/i.test(sentence)) {
            charge.offGuard = true;
            continue;
        }
        if (/^The target is Off-Guard (?:to|against) this (?:attack|Strike) unless it has seen an? [\w' -]+? before\.$/i.test(sentence)) {
            charge.offGuard = "first";
            continue;
        }
        const harder = new RegExp(`${moved}(?:it gains|they gain|he gains|she gains) a \\+(\\d+) circumstance bonus to (?:its|their|his|her) damage rolls?\\.$`, "i").exec(sentence);
        if (harder) {
            charge.damageBonus = Number(harder[1]);
            continue;
        }
        const wait = /^(?:The [\w' -]+?|It|They|He|She) then can(?:'t|not) use [\w' -]+? (?:again )?for (\d+|\d+d\d+) rounds?\.$/i.exec(sentence);
        if (wait) {
            charge.recharge = wait[1];
            continue;
        }
        // (Nothing for the simulation: "During the Stride, it gains a +10-foot circumstance bonus to its Speed.")
        // (Batch 172, a leopard's Pounce: "If the leopard successfully used Hide before this action, the target has the Off-Guard condition against this
        // Strike." — its Hide the GM's.)
        if (/^If (?:the [\w' -]+?|it|they|he|she) successfully used (?:\[\[\/act hide\]\]|Hide) before this action, the target (?:has the Off-Guard condition|is Off-Guard) (?:against|to) this Strike\.$/i.test(sentence)) continue;
        if (/remains? hidden until after/i.test(sentence) || /^During (?:the|this|that) (?:Stride|movement), (?:it|they|he|she|the [\w' -]+?) gains? a \+\d+-foot circumstance bonus to (?:its|their|his|her) Speed\.$/i.test(sentence)) continue;
        // (Batch 60, Propulsive Launch: "If it's in the air and not attached to a creature after the Strike, it falls.")
        if (/^If (?:it|they)'s in the air and not attached to a creature after the Strike, (?:it|they) falls?\.$/i.test(sentence.replace(/’/g, "'"))) continue;
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
        // (Batch 242, Titanic Charge: "If the Strike hits, the titan can cast Earthquake centered on the target as a free action." — the GM's, a note.)
        const cast = /^If the Strike hits, (?:the [\w' -]+?|it|they) can cast ([A-Z][\w' -]+?) centered on the target as a free action\.$/i.exec(sentence);
        if (cast) {
            (charge.notes ??= []).push(`If the Strike hits, it can cast ${cast[1]} centered on the target as a free action.`);
            continue;
        }
        const bonus = new RegExp(`${moved}(?:it gains|they gain|he gains|she gains|it gets|they get|he gets|she gets) a \\+(\\d+) circumstance bonus (?:to|on) (?:its|their|his|her|this|the) attack roll\\.$`, "i").exec(sentence);
        const damage = new RegExp(`${moved}the Strike's damage (?:is increased to|increases to) (.+?)(?: damage)?\\.$`, "i").exec(sentence);
        if (bonus) charge.attackBonus = Number(bonus[1]);
        // (An inline roll as its formula: "@Damage[(3d10+10)[piercing]]" → "(3d10+10)[piercing]".)
        else if (damage) charge.damage = damage[1].trim().replace(/^@Damage\[(.*)\]$/, "$1");
        else return null;
    }
    return charge;
}

// Resistance against the damage that sets it off (2026-10-11, batch 71): "Trigger The dragon takes fire damage Effect … They gain fire
// resistance 20, including against the triggering effect, until the end of their next turn." (Liquefy), "Trigger The poppet would take
// piercing damage Effect …, gaining resistance 5 against the triggering piercing damage", "Trigger The granitescale is about to take
// piercing or slashing damage Effect … gains resistance 15 to the damage, but their AC is reduced by 2 for 1 day", "Trigger An enemy is
// about to damage the cavern seer with bludgeoning damage or with a spell that has the earth trait" → { builtin: "resist-damage", value,
// on (the damage types that set it off, or null for any), types (those it resists, or null for all the triggering damage), attack? (an
// attack's damage only), foe? (an enemy's), lasts? (rounds: until the end of its next turn), acPenalty? (for a day), uses? (a day) }.
// Not for an ally, nor with a requirement, a move, a Strike or more damage of its own.
const DAMAGE_WORDS = "acid|bludgeoning|cold|electricity|fire|force|mental|piercing|poison|slashing|sonic|spirit|void|vitality|physical";
function damageTypesIn(phrase) {
    const words = String(phrase ?? "").toLowerCase().replace(/\b(?:or|and)\b|,/g, " ").trim().split(/\s+/).filter(Boolean);
    return words.length && words.every((word) => new RegExp(`^(?:${DAMAGE_WORDS})$`).test(word)) ? words : null;
}
function readResistDamage(text, trigger, effect) {
    if (/\bRequirements?\b/.test(text)) return null;
    // (Batch 193, Divert Essence: "Trigger A creature within 90 feet Casts a Spell that targets the dragon Effect The sage dragon steals energy from
    // the spell to protect itself, gaining resistance to damage from spells equal to the triggering spell's rank until the beginning of their next
    // turn." → resistance to spells, the spell's rank, until its next turn starts: { value: "rank", spell, types: ["spells"], lasts, until }.)
    if (/^An? (?:creature|enemy|foe)(?: within \d+ feet)? Casts a Spell that targets (?:the [\w' -]+?|it|them)$/i.test(trigger.trim().replace(/\.$/, ""))) {
        const gains = /^(?:The )?[^.]+?, gaining resistance to damage from spells equal to the triggering spell['’]s rank until the (?:beginning|start) of (?:its|their) next turn\.$/i.test(effect.trim().replace(/\s*Effect: [\w' -]+$/, ""));
        return gains ? { builtin: "resist-damage", value: "rank", spell: true, on: null, types: ["spells"], lasts: 1, until: "turn-start" } : null;
    }
    // (Batch 237, Sharp Riposte: "Trigger An adjacent creature targets the paaridar with a melee attack Effect The paaridar blocks the attack with their
    // claws. The paaridar gains resistance 5 to physical damage from the attack, and if the attack hits, the attacker takes 1d8+4 slashing damage." —
    // resistance to that melee attack's physical damage, and that damage back at the attacker: retort.)
    if (/^An adjacent creature targets (?:the [\w' -]+?|it|them) with a melee attack$/i.test(trigger.trim().replace(/\.$/, ""))) {
        const said = effect.trim().replace(/\s*Effect: [\w' -]+$/, "").split(/(?<=\.)\s+(?=[A-Z])/);
        const told = said.length === 2 && !/\d|@|\b(?:damage|resistance|bonus|penalty)\b/i.test(said[0]);
        const riposte = /^(?:The )?[^.]+? gains? resistance (\d+) to physical damage from the attack, and if the attack hits, the attacker takes @Damage\[((?:[^[\]]|\[[^\]]*\])*)\](?:\{[^}]*\})? damage\.$/i.exec(said.at(-1) ?? "");
        if ((said.length === 1 || told) && riposte) return { builtin: "resist-damage", value: Number(riposte[1]), on: ["physical"], types: ["physical"], attack: true, foe: true, melee: true, retort: riposte[2], note: `If the attack hits, the attacker takes ${riposte[2].replace(/^\((.*)\)\[(\w+)\]$/, "$1 $2").replace(/\[(\w+)\]$/, " $1")} damage.` };
    }
    const said = trigger.trim().replace(/\.$/, "").replace(/,? or with a spell that has the [\w ,]+? traits?$/i, "");
    const self = String.raw`(?!An? |Any |One )(?:The )?[^.]+?`;
    let on = null;
    let attack = false;
    let foe = false;
    // (Batch 213, Shadow Siphon: "would take damage from a spell or magical effect" — a spell's, in the simulator.)
    let magical = false;
    let match = new RegExp(String.raw`^${self} (?:takes|would take|is about to take) ([a-z, ]*?)\s*damage(?: from (an attack|a Strike|a physical attack|a creature|an enemy|a hostile source|a Strike or spell effect|a spell or magical effect))?$`).exec(said);
    if (match) {
        magical = /magical/.test(match[2] ?? "");
        on = match[1].trim() ? damageTypesIn(match[1]) : null;
        if (match[1].trim() && !on) return null;
        attack = /attack|Strike$/.test(match[2] ?? "") && !/spell/.test(match[2] ?? "");
        if (/physical/.test(match[2] ?? "")) on = ["physical"];
        foe = /creature|enemy|hostile/.test(match[2] ?? "");
    } else if ((match = new RegExp(String.raw`^${self} is (?:hit|damaged) (?:by|with) an? (?:melee |ranged )?(?:Strike|attack)(?: that deals| dealing) ([a-z, ]+?) damage$`).exec(said))
        // (Batch 150, Clot: "The blood ooze is damaged by a piercing or slashing attack".)
        || (match = new RegExp(String.raw`^${self} is damaged by an? ([a-z, ]+?) attack$`).exec(said))) {
        on = damageTypesIn(match[1]);
        if (!on) return null;
        attack = true;
    } else if ((match = /^An? (?:enemy|foe|creature)(?: within \d+ feet)? (?:is about to damage|would deal ([a-z, ]+? )?damage to|damages) (?:the [\w' -]+?|[A-Z][\w'-]+(?: [A-Z][\w'-]+)*)(?: with ([a-z, ]+?)(?: damage)?)?$/.exec(said))) {
        const phrase = match[1] ?? match[2] ?? "";
        on = phrase.trim() ? damageTypesIn(phrase) : null;
        if (phrase.trim() && !on) return null;
        foe = true;
    } else if ((match = new RegExp(String.raw`^${self} (?:is targeted by a Strike or spell that could deal|is the target of an attack or a spell able to deal) ([a-z]+) or physical damage(?: to (?:it|them|him|her))?$`).exec(said)) && damageTypesIn(match[1])) {
        // (Batch 149, a Battlezoo dragon's turn to water: an attack or a spell of one energy or physical damage aimed at it — read as that
        // damage on it; "against the triggering effect, … resistance N to <that energy> and to all physical damage".)
        on = [...damageTypesIn(match[1]), "physical"];
        const both = new RegExp(String.raw`^(?:Against the triggering effect, )?(?:they|it|he|she) gains? resistance (\d+) to ${match[1]} and(?: to)? all physical damage(?: against (?:it|the triggering effect))?\.$`, "i");
        const parts = effect.trim().replace(/\s*Effect: [\w' -]+$/, "").split(/(?<=\.)\s+(?=[A-Z])/);
        const last = both.exec(parts.at(-1) ?? "");
        const told = (sentence) => !/\d|\b(?:damage|resistance|Strikes?|Steps?|Strides?|teleports?|Fl(?:y|ies)|attack rolls?|saves?|checks?|penalty|bonus)\b/i.test(sentence);
        if (last && parts.slice(0, -1).every(told)) return { builtin: "resist-damage", value: Number(last[1]), on, types: [match[1].toLowerCase(), "physical"] };
        return null;
    } else return null;
    // Its effect: the resistance, perhaps after a sentence that only tells it; an AC that drops for a day ("cannot be reduced below 16").
    const T = DAMAGE_WORDS;
    // (Batch 152, Overcharge: "… and becomes Quickened for [[/gmr 1d4 #Quickened Duration]]{1d4 rounds}" — the roll as its label.)
    // (Batch 213, Shadow Siphon: "The interlocutor takes half the triggering damage instead." — half of it.)
    if (/^(?:The )?[^.]+? takes half the triggering damage instead\.$/i.test(effect.trim().replace(/\s*Effect: [\w' -]+$/, ""))) return { builtin: "resist-damage", value: "half", on, types: null, ...(magical ? { magical: true } : {}), ...(attack ? { attack: true } : {}), ...(foe ? { foe: true } : {}) };
    // (Batch 213, Runic Resistance: "…, granting them resistance 5 to one damage type dealt by the triggering attack. This resistance applies against the
    // triggering effect and lasts for 1 minute or until the maftet uses this ability again, whichever comes first. If the triggering effect deals multiple
    // damage types, the maftet chooses which type to resist." — the triggering damage's type, for a minute: types ["triggering"].)
    let triggering = false;
    let minute = false;
    // (Batch 217, a Battlezoo thief's dream: resistance to all damage but one type against what set it off, and a short teleport — the type left out a
    // note.)
    let except = null;
    let replaces = false;
    const sentences = effect.trim().replace(/\s*Effect: [\w' -]+$/, "").replace(/\[\[\/(?:r|gmr|br|roll) [^\]]*\]\]\{([^}]*)\}/g, "$1")
        .replace(/\bresistance (\d+) (?:all|to all damage) \(except ([a-z]+)\)/i, (_all, value, kind) => {
            except = kind.toLowerCase();
            return `resistance ${value}`;
        })
        .replace(/, granting (?:them|it|him|her|themself|itself) resistance (\d+) to one damage type dealt by the triggering (?:attack|effect)\./i, (_all, value) => {
            triggering = true;
            return `, gaining resistance ${value} against the triggering damage.`;
        })
        .replace(/\s*This resistance applies against the triggering effect and lasts for 1 minute or until (?:the [\w' -]+?|it|they) uses? this ability again, whichever comes first\./i, () => {
            minute = true;
            return "";
        })
        .replace(/\s*If the triggering effect deals multiple damage types, (?:the [\w' -]+?|it|they) chooses? which type to resist\./i, (all) => (triggering ? "" : all))
        // (Batch 228, Battlezoo: resistance to the triggering damage type for a minute, a new use replacing the last, never against cold iron — a note.)
        .replace(/^(?:The )?[^.]+?\. For the next minute, (?:the [\w' -]+?|it|they) (?:has|have) resistance (\d+) (?:against|to) the triggering damage type(?: \([^)]*\))?\. (?:If (?:it|they) uses? this ability again, (?:it|they) loses? (?:its|their) previous resistance from [A-Z][\w' -]+? and replaces? it with the new (?:one|resistance)|A new use swaps out the old resistance)\. (?:This resistance never applies to damage from cold iron weapons\b[^.]*|Cold iron weapons get through it)\.$/i, (_all, value) => {
            triggering = true;
            minute = true;
            except = "cold iron weapons'";
            replaces = true;
            return `It gains resistance ${value} against the triggering damage.`;
        })
        .split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean);
    const resist = new RegExp(String.raw`^(?:The )?[^.]*?\b(?:gains?|gaining) (?:(${T}) )?resistance (\d+)(?: to (?:all )?(${T})(?: damage)?)?(?: (?:against|to) the (?:triggering|incoming) (?:(${T}) )?(?:damage|attack|effect)| against (${T}) damage from the triggering attack| to the damage)?(?:,? including against the triggering effect)?(?:,? until the end of (?:its|their|his|her) next turn)?(?:,? but (?:its|their|his|her) AC is (?:reduced|lowered) by (\d+) for (?:1 day|24 hours)(?:, when [^.]+)?)?( and teleports (?:to an adjacent (?:space|square)|up to \d+ feet in any direction)| and (?:Flies|Strides|Steps) away from the attacker)?(?: and becomes Quickened for (\d+d\d+|\d+) rounds?)?\.?$`, "i");
    // (Batch 150, Clot: "… forms a clot around the wound, reducing the damage taken by 5 (to a minimum of 0)." — resistance 5 to it.)
    const clot = /^(?:The )?[^.]*?, reducing the damage taken by (\d+) \(to a minimum of 0\)\.$/i.exec(sentences.at(-1) ?? "");
    if (clot && sentences.length === 1) return { builtin: "resist-damage", value: Number(clot[1]), on, types: null, ...(attack ? { attack: true } : {}) };
    const at = sentences.findIndex((sentence) => resist.test(sentence));
    if (at < 0) return null;
    // (Batch 155: a sentence about its body turning soft to dodge the blow only tells it.)
    const told = (sentence) => !/\d|\b(?:damage|resistance|Strikes?|Steps?|Strides?|teleports?|Fl(?:y|ies)|attack rolls?|saves?|checks?|penalty|bonus)\b/i.test(sentence.replace(/\bto avoid damage\b/i, ""));
    if (!sentences.slice(0, at).every(told)) return null;
    // (Batch 155, a Battlezoo dragon's turn to protoplasm: after its resistance, an attack roll at the attacker with its own modifier; a hit deals
    // the damage it resisted back, of that type (and some of its own type when the attack carried it, up to 10) — lashBack { bonus }, the rest a
    // note.)
    let lashBack = null;
    const after = sentences.slice(at + 1);
    const lash = /^In addition, (?:the [\w' -]+?|it|they) (?:makes? an attack roll against|attacks) the triggering (?:enemy|creature|foe) with a \+(\d+) modifier\.$/i.exec(after[0] ?? "");
    if (lash && /^On a (?:success|hit), (?:the [\w' -]+?|it|they) deals? an amount of damage of the same type equal to the amount of physical damage (?:it|they) resisted that way\.$|^On a hit, the attacker takes the resisted damage back\.$/i.test(after[1] ?? "") && after.slice(2).every((sentence) => /^Additionally, if the attack would have dealt damage of (?:the [\w' -]+?['’]s|its|their) associated type\b[^.]*\bto a maximum of (\d+) damage\.$/i.test(sentence))) {
        lashBack = { bonus: Number(lash[1]) };
        after.length = 0;
    }
    if (!after.every((sentence) => /^(?:The [\w' -]+?['’]s|Its|Their) AC can(?:not|'t) be reduced below \d+ in this way\.$|^This movement (?:does not|doesn't) trigger reactions\.$/i.test(sentence))) return null;
    const read = resist.exec(sentences[at]);
    const named = read[1] ?? read[3] ?? read[4] ?? read[5] ?? null;
    const frequency = /\bFrequency (once|twice) per day\b/i.exec(text)?.[1];
    return {
        builtin: "resist-damage",
        value: Number(read[2]),
        on,
        types: triggering ? ["triggering"] : named ? [named.toLowerCase()] : null,
        ...(minute ? { lasts: 10 } : {}),
        ...(except ? { note: `Not against ${except} damage.${replaces ? " A new use replaces the last one." : ""}` } : {}),
        ...(attack ? { attack: true } : {}),
        ...(foe ? { foe: true } : {}),
        ...(/until the end of (?:its|their|his|her) next turn/i.test(read[0]) && !minute ? { lasts: 1 } : {}),
        ...(read[6] ? { acPenalty: Number(read[6]) } : {}),
        // (Batch 136, Gnomish Shift: "… and teleports to an adjacent space" — the GM's move.)
        ...(read[7] ? { shift: true } : {}),
        // (Batch 152, Overcharge: Quickened for 1d4 rounds after it.)
        ...(read[8] ? { quickened: read[8] } : {}),
        ...(lashBack ? { lashBack, note: `Then it attacks the attacker (+${lashBack.bonus}): on a hit, that creature takes as much damage, of the same type, as it resisted (plus up to 10 of its own damage type if the attack carried that type).` } : {}),
        ...(frequency ? { uses: frequency.toLowerCase() === "twice" ? 2 : 1 } : {})
    };
}

// "The dragon recharges their Poison Breath whenever they score a critical hit with a Strike." → ["Poison Breath"].
export function readMomentum(text) {
    if (!/critical hit/i.test(text) || !/recharges?/i.test(text)) return null;
    const named = /recharges? (?:their |its )?([A-Z][\w' -]+?)(?: whenever|\.|$)/.exec(text)?.[1];
    return { recharges: named ? [named.trim()] : [] };
}

// Moving off as a creature comes beside it or attacks it (2026-10-11, batch 98): "Trigger A creature misses the necrohusk with a melee
// Strike Effect The necrohusk Steps.", "… takes damage from a Strike Effect … Steps away from the source of the Strike.", an attack on it
// with a melee weapon (once the attack is done, a Step or a Stride away), "A creature ends its movement adjacent to Kolo Effect Kolo
// Steps.", "A creature enters the harmona's space or an adjacent square Effect The harmona Flies 10 feet away from the triggering
// creature.", "… Strides up to 10 feet (or his Speed, if that Speed is less than 10 feet). He must end his movement in a location that isn't
// within 5 feet of a foe. This movement doesn't trigger reactions." (and the viper's older "If a creature ends its movement adjacent to the
// viper …, the viper can use its reaction to Stride, Climb, or Swim up to 10 feet.") → { builtin: "withdraw", on: "missed" | "damaged" |
// "attacked" | "hit" | "approach", melee, enters, foe (conditions the creature must have), move ("Step" | "Stride" | "Fly"), feet, safe }.
// Not one that drops what it holds, changes its form or does more.
export function readWithdraw(text) {
    const body = String(text).trim();
    const subject = "(?:the [\\w' -]+?|it|[A-Z][\\w'-]+(?: [A-Z][\\w'-]+)*)";
    const legacy = new RegExp(`^If an? (?:creature|enemy|foe) ends its movement adjacent to ${subject}(?: or within ${subject}['’]s space)?, ${subject} can use (?:its|their|his|her) reaction to (Step|Stride)(?:, Climb,? or Swim| or (?:Climb|Swim))?(?: up to (\\d+) feet)?\\.((?: [^.]+\\.)*)$`, "i").exec(body);
    // (Batch 243: a frequency first, PF2e's own — "Frequency once per minute Trigger …".)
    const split = /^(?:Frequency once per (?:round|turn|minute|10 minutes|hour|day)\.? )?Trigger (.+?)[.;]? Effect (.+)$/.exec(body);
    if (!legacy && !split) return null;
    let on = null;
    let melee = false;
    let enters = false;
    let foe = null;
    let source = null;
    if (legacy) on = "approach";
    else {
        const trigger = split[1].trim();
        if (new RegExp(`^An? (?:creature|enemy|foe) misses ${subject} with a melee Strike$`, "i").test(trigger)) [on, melee] = ["missed", true];
        else if (/^(?:The )?[\w' -]+? takes damage from an? (?:melee )?Strike$/i.test(trigger)) [on, melee] = ["damaged", /\bmelee Strike$/i.test(trigger)];
        // (Batch 136, Crumble: "The living landslide takes damage from a hostile source while atop rock or earth" — any foe's damage, where it
        // is the GM's, a note.)
        else if (/^(?:The )?[\w' -]+? takes damage from a hostile source(?: while [^.]+)?$/i.test(trigger)) [on, source] = ["damaged", { hostile: true, ...(/ while ([^.]+)$/i.exec(trigger) ? { while: / while ([^.]+)$/i.exec(trigger)[1] } : {}) }];
        else if (/^(?:The )?[\w' -]+? is attacked with a melee weapon$/i.test(trigger)) [on, melee] = ["attacked", true];
        // (Batch 214, Tactical Retreat: "The tanuki takes damage" — any damage.)
        else if (/^(?:The )?[\w' -]+? takes damage$/i.test(trigger)) on = "damaged";
        // (Batch 243, Putrid Evanescence: "Desert's Howl is damaged by another creature".)
        else if (/^(?:The )?[\w' -]+? is damaged by another creature$/i.test(trigger)) on = "damaged";
        // (Batch 217, Battlezoo: damage dealt to it; a foe's Strike that hits it; an attempt to target it or catch it in an area (as it's attacked); a foe
        // ending its turn with it in reach (as a foe beside it).)
        else if (/^An? creature (?:successfully )?deals damage to (?:the )?[\w' -]+?$/i.test(trigger)) on = "damaged";
        else if (/^An? (?:foe|enemy|creature) hits (?:the )?[\w' -]+? with a Strike$/i.test(trigger)) on = "hit";
        else if (new RegExp(`^An? creature attempts to target ${subject}, or attempts to include ${subject} in an area of effect$`, "i").test(trigger)) on = "attacked";
        // (Batch 218, a Battlezoo taunt: a Strike aimed at it.)
        else if (/^(?:The )?[\w' -]+? is targeted by a Strike$/i.test(trigger)) on = "attacked";
        // (Batch 225, Scurry: "A creature the lomori sprout can observe attacks the sprout" — once the attack is done.)
        else if (new RegExp(`^An? (?:creature|enemy|foe) ${subject} can (?:observe|see) attacks ${subject}$`, "i").test(trigger)) on = "attacked";
        else if (new RegExp(`^An? (?:foe|enemy) ends (?:their|its) turn,? (?:and ${subject} is|with ${subject}) within that (?:foe|enemy)['’]s reach$`, "i").test(trigger)) on = "approach";
        else if (/^(?:The )?[\w' -]+? is hit (?:with|by) a melee (?:attack|Strike)$/i.test(trigger)) [on, melee] = ["hit", true];
        else if (new RegExp(`^An? (?:creature|enemy|foe) ends its move(?:ment)? (?:in a space )?adjacent to ${subject}(?: or within ${subject}['’]s space)?$`, "i").test(trigger)) on = "approach";
        else if (new RegExp(`^An? (?:creature|enemy|foe) (?:enters ${subject}['’]s space or an adjacent square|moves into an adjacent space|moves adjacent to ${subject})$`, "i").test(trigger)) [on, enters] = ["approach", true];
        // (Batch 191, Skittering Reposition: "A creature that starts its move outside the gogiteth's reach moves into its reach.")
        else if (new RegExp(`^An? (?:creature|enemy|foe) that starts its move outside ${subject}['’]s reach moves into (?:its|their) reach$`, "i").test(trigger)) [on, enters] = ["approach", true];
        else if (new RegExp(`^A dazzled or blinded creature, or a creature with light blindness, ends its move(?:ment)? adjacent to ${subject}$`, "i").test(trigger)) [on, foe] = ["approach", ["dazzled", "blinded"]];
    }
    if (!on) return null;
    const sentences = legacy ? (legacy[3] ?? "").trim().split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean) : split[2].trim().split(/(?<=\.)\s+(?=[A-Z])/);
    let move;
    let feet = null;
    let dropsHeld = false;
    // (Batch 214, Tactical Retreat: "The tanuki runs to a better tactical position. The tanuki gains the Fleeing condition until the beginning of their
    // next turn and Strides." — the Stride; Fleeing until its turn a note.)
    let fleeing = false;
    const later = [];
    if (!legacy && sentences.length === 2 && /^(?:The )?[\w' -]+? runs to a better tactical position\.$/i.test(sentences[0]) && /^(?:The )?[\w' -]+? gains the Fleeing condition until the (?:beginning|start) of (?:its|their) next turn and Strides\.$/i.test(sentences[1])) {
        sentences.splice(0, 2, "It Strides.");
        fleeing = true;
    }
    if (legacy) [move, feet] = [legacy[1].toLowerCase() === "step" ? "Step" : "Stride", legacy[2] ? Number(legacy[2]) : null];
    else {
        // ("… takes a step after the effects of the triggering attack are resolved.")
        if (/^(?:The )?[\w' -]+? takes a step after the effects of the triggering attack are resolved\.$/i.test(sentences[0] ?? "")) sentences[0] = "It Steps.";
        // (Batch 225, Scurry: "After the attack resolves, the lomori sprout can Stride up to their speed.")
        if (/^After the attack resolves, (?:the [\w' -]+?|it|they) can Stride up to (?:its|their) [Ss]peed\.$/i.test(sentences[0] ?? "")) sentences[0] = "It Strides.";
        // (Batch 191, Skittering Reposition: "The gogiteth moves 10 feet." — a Stride that far.)
        if (/^(?:The )?[\w' -]+? moves \d+ feet\.$/i.test(sentences[0] ?? "")) sentences[0] = sentences[0].replace(/^.*moves (\d+) feet\.$/i, "It Strides up to $1 feet.");
        // (Batch 206, Panicked Withdrawal: "The marp drops any items held in their hands, then Climbs or Strides up to 15 feet." — the move; what it drops
        // a note.)
        if (/^(?:The )?[\w' -]+? drops any items held in (?:its|their) hands, then Climbs or Strides up to \d+ feet\.$/i.test(sentences[0] ?? "")) {
            sentences[0] = sentences[0].replace(/^.*then (Climbs or Strides up to \d+ feet)\.$/i, "It $1.");
            dropsHeld = true;
        }
        // (Batch 217, Battlezoo: a first sentence that only tells it (an escape, a puff of smoke); a flight or swim of half its Speed (a flight); a move
        // away with no reactions, Concealed for the attacker's turn (a note); a Leap of some feet or half its Speed (a Stride); another way to move or the
        // trigger's choice after, notes.)
        if (sentences.length > 1 && /^(?:The )?[\w' -]+? (?:attempts to escape|panics|disappears in a puff of [\w' -]+?)\.$/i.test(sentences[0])) sentences.shift();
        if (/^(?:They|It|The [\w' -]+?) (?:Fly or Swim|Flies or Swims), up to half (?:their|its) Speed\.$/i.test(sentences[0] ?? "")) sentences[0] = "It Flies.";
        const smoke = /^(?:The )?[\w' -]+? moves (?:up to )?(\d+) feet away (?:without triggering reactions|with no reactions),? (?:and )?(?:is|becomes) Concealed until the end of (?:the triggering creature|the attacker|that creature)['’]s turn(?: by the smoke)?\.$/i.exec(sentences[0] ?? "");
        if (smoke) sentences.splice(0, 1, `It Strides up to ${smoke[1]} feet.`, "This movement doesn't trigger reactions.");
        const leaps = /^(?:The )?[\w' -]+? Leaps (?:up to )?(\d+ feet|half (?:its|their) Speed)(?: away from (?:the triggering|that) (?:foe|creature))?\.$/i.exec(sentences[0] ?? "");
        if (leaps) sentences[0] = /^\d/.test(leaps[1]) ? `It Strides up to ${parseInt(leaps[1], 10)} feet.` : "It Strides.";
        // (Batch 218: a taunt, then a Stride of half its Speed once the Strike resolves; its allies' Strides as they hear it, a note.)
        if (/^(?:The )?[\w' -]+? (?:goads|taunts) (?:its|their) attacker(?:, then Strides up to half (?:its|their) Speed after the Strike resolves| and Strides half (?:its|their) Speed once the Strike resolves)\.$/i.test(sentences[0] ?? "")) sentences[0] = "It Strides.";
        if (smoke) later.push("It's Concealed until the attacker's turn ends.");
        for (let index = sentences.length - 1; index > 0; index--) {
            if (/^(?:They|It) can instead use [A-Z][\w' -]+? if [^.]+\.$|^The triggering creature can select another action if [^.]+\.$|^Any ally who hears this taunt can use a reaction to Stride up to half (?:its|their) [Ss]peed\.$/i.test(sentences[index])) later.push(...sentences.splice(index, 1));
        }
        // (Batch 136, Crumble: "… crumbles into the ground, Burrowing down 10 feet." — a Burrow.)
        if (/^(?:The )?[\w' -]+? crumbles into the ground, Burrowing down \d+ feet\.$/i.test(sentences[0] ?? "")) sentences[0] = sentences[0].replace(/^.*Burrowing down (\d+) feet\.$/i, "It Burrows $1 feet.");
        // (Batch 133, Slip: "… teleports to a clear space adjacent to another creature she can see within 30 feet" — away, triggering no reactions.)
        const slip = /^(?:The )?[\w' -]+? teleports to a clear space adjacent to another creature (?:it|she|he|they) can see within (\d+) feet\.$/i.exec(sentences[0] ?? "");
        if (slip && sentences.length === 1) return { builtin: "withdraw", on, ...(enters ? { enters } : {}), move: "Teleport", feet: Number(slip[1]), safe: true };
        // (Batch 243, Putrid Evanescence: "… bursts into a cloud of putrid smoke, ash, and nightmares, becoming Invisible and teleporting up to 100 feet
        // away to an unoccupied space it can see. It remains invisible until the end of its next turn or until it uses a hostile action, whichever comes
        // first." — a teleport away; its invisibility a note.)
        const burst = /^(?:The )?[\w' -]+? bursts into a cloud of [^.]+?, becoming Invisible and teleporting up to (\d+) feet away to an unoccupied space (?:it|they) can see\.$/i.exec(sentences[0] ?? "");
        if (burst && sentences.length === 2 && /^(?:It|They) remains? invisible until the end of (?:its|their) next turn or until (?:it|they) uses? a hostile action, whichever comes first\.$/i.test(sentences[1])) return { builtin: "withdraw", on, move: "Teleport", feet: Number(burst[1]), safe: true, notes: ["It's Invisible until the end of its next turn or until it uses a hostile action."] };
        const first = /^(?:After resolving the attack, )?(?:The )?[\w' -]+? (?:quickly takes advantage of the attacker['’]s error and )?(Steps(?: or Strides)?|Strides(?:,? (?:Climbs|Swims),? or (?:Climbs|Swims)| or (?:Climbs|Swims))?|Climbs or Strides|Flies|Burrows)(?: (?:up to )?(\d+) feet)?(?: \((?:or (?:up to )?(?:the relevant|its|his|her|their) Speed)[^)]*\))?(?: away(?: from (?:the source of the Strike|the triggering creature))?)?\.$/i.exec(sentences.shift() ?? "");
        if (!first) return null;
        move = /^Steps/i.test(first[1]) ? "Step" : /^Flies/i.test(first[1]) ? "Fly" : /^Burrows/i.test(first[1]) ? "Burrow" : "Stride";
        feet = first[2] ? Number(first[2]) : null;
    }
    let safe = move === "Step";
    let recharge = null;
    for (const sentence of sentences) {
        // (Batch 225, Scurry: "… doesn't trigger reactions from the triggering creature" — played as no reactions at all.)
        if (/^This (?:movement |Burrowing )?(?:doesn't|does not) trigger reactions(?: based on movement| from the triggering creature)?\.$/i.test(sentence)) safe = true;
        // (Crumble: "The living landslide can't Crumble again for 1d4 rounds.")
        else if (/^(?:The [\w' -]+?|It|They) can(?:'t|not) [\w' -]+? again for (?:\[\[\/\w+ (\d+d\d+)[^\]]*\]\](?:\{[^}]*\})?|(\d+d\d+) rounds)\.$/i.test(sentence)) recharge = /(\d+d\d+)/.exec(sentence)[1];
        else if (!/^(?:It|He|She|They) must end (?:its|his|her|their|this) movement in a (?:location|space) that (?:isn't|is not) (?:within 5 feet of|adjacent to) (?:a foe|an enemy)\.$|^(?:It|He|She|They) can(?:'t|not) end (?:the|its|this) movement (?:adjacent|next) to another (?:foe|enemy)\.$/i.test(sentence)) return null;
    }
    return { builtin: "withdraw", on, ...(melee ? { melee } : {}), ...(enters ? { enters } : {}), ...(foe ? { foe } : {}), ...(source ?? {}), move, ...(feet ? { feet } : {}), safe, ...(recharge ? { recharge } : {}), ...(dropsHeld || fleeing || later.length ? { notes: [...(dropsHeld ? ["It drops whatever it holds first."] : []), ...(fleeing ? ["It's Fleeing until the start of its next turn."] : []), ...later] } : {}) };
}

// Following a foe that moves away (2026-10-11, batch 99): "Trigger An enemy within reach of the guard attempts to move away Effect The guard
// Strides up to their Speed, following the enemy and keeping the enemy in reach throughout its movement until the enemy stops moving or the
// guard moves their full Speed." (No Escape, Reactive Pursuit; "A foe within Horba's reach …", "An adjacent foe moves away.", "… keeps pace
// with the triggering foe." first, "Climbs or Strides", a flight; the hunted prey's only; a Strike at the creature after, when it ends the
// move within reach of it) → { builtin: "follow", move ("Stride" | "Fly"), prey, strike }.
export function readFollow(text) {
    const split = /^Trigger (.+?)\.? Effects? (.+)$/.exec(String(text).trim());
    if (!split) return null;
    const subject = "(?:the [\\w' -]+?|it|[A-Z][\\w'-]+(?: [A-Z][\\w'-]+)*)";
    const pronoun = "(?:it|them|him|her)";
    const trigger = split[1].trim();
    const prey = new RegExp(`^${subject}['’]s hunted prey is within (?:its|their|his|her) reach and attempts to move away from ${pronoun}$`, "i").test(trigger);
    const near = new RegExp(`^An? (?:adjacent (?:enemy|foe|creature)|(?:enemy|foe|creature) within (?:(?:the )?reach(?: of ${subject})?|${subject}['’]s reach)) (?:attempts to move|moves) away(?: from (?:${subject}|${pronoun}))?$`, "i").test(trigger);
    // (Batch 217, a Battlezoo swarm: a creature leaving its space, and a Stride after it that keeps it in the swarm's space — a follow.)
    if (new RegExp(`^An? creature leaves ${subject}['’]s space$`, "i").test(trigger) && new RegExp(`^(?:${subject} tries to chase after the triggering creature\\. )?${subject} Strides up to (?:its|their) Speed, (?:following the creature and keeping it within ${subject}['’]s space|staying on the creature) throughout its movement(?: until it stops moving or until ${subject} has moved (?:its|their) full Speed, whichever comes first)?\\.$`, "i").test(split[2].trim())) return { builtin: "follow", move: "Stride" };
    // (Batch 242, Primal Hunt: "A creature within the barghest's reach takes a move or teleportation action", "After the triggering action, the
    // barghest can teleport up to 60 feet to a space adjacent to that creature." — a teleport after it.)
    const hunt = new RegExp(`^An? creature within (?:${subject}['’]s reach|(?:the )?reach(?: of ${subject})?) takes a move or teleportation action$`, "i").test(trigger) ? new RegExp(`^After the triggering action, ${subject} can teleport up to (\\d+) feet to a space adjacent to that creature\\.$`, "i").exec(split[2].trim()) : null;
    if (hunt) return { builtin: "follow", move: "Teleport", within: Number(hunt[1]) };
    if (!prey && !near) return null;
    // (Batch 208, Deadly Pursuit: "The cursed king Strides up to its Speed, keeping the creature within reach until the creature stops or the cursed king has
    // moved its full Speed. If the creature is still within reach, the cursed king makes a jaws Strike against it." — the follow, its Strike after.)
    const pursuit = new RegExp(`^${subject} Strides up to (?:its|their|his|her) Speed, keeping the creature within reach until the creature stops or ${subject} has moved (?:its|their|his|her) full Speed\\. If the creature is still within reach, ${subject} makes an? ([\\w' -]+?) Strike against it\\.$`, "i").exec(split[2].trim());
    if (pursuit) return { builtin: "follow", move: "Stride", ...(prey ? { prey } : {}), strike: true };
    const sentences = split[2].trim().split(/(?<=\.)\s+(?=[A-Z])/);
    if (new RegExp(`^${subject} keeps pace with the (?:triggering|retreating) (?:foe|enemy|creature)\\.$`, "i").test(sentences[0] ?? "")) sentences.shift();
    const main = new RegExp(`^${subject} (?:can )?(Strides?(?: or (?:Climbs?|Fl(?:ies|y)))?|Climbs or Strides|Flies) up to (?:its|their|his|her) (?:fly )?[Ss]peed, following (?:the (?:triggering creature|enemy|foe|retreating foe)|that foe|(?:its|their|his|her) hunted prey) and keeping (?:it|the enemy|the foe) in reach(?: throughout (?:its|this) movement)?(?: until (?:it|the enemy|the foe) stops moving or ${subject} (?:has moved|moves) (?:its|their|his|her) full (?:fly )?Speed)?\\.$`, "i").exec(sentences.shift() ?? "");
    if (!main) return null;
    let strike = false;
    for (const sentence of sentences) {
        if (new RegExp(`^If ${subject} ends (?:its|their|his|her) (?:movement|move) (?:in|within) reach of (?:the triggering creature|that creature|the foe),? (?:it|they|he|she) can (?:make a Strike|Strike it)\\.$`, "i").test(sentence)) strike = true;
        else return null;
    }
    return { builtin: "follow", move: /^Flies$/i.test(main[1]) ? "Fly" : "Stride", ...(prey ? { prey } : {}), ...(strike ? { strike } : {}) };
}

// A critical hit on it recharging its breath, used at once (2026-10-11, batch 100): "Trigger The greater hell hound is critically hit by any
// Strike Effect The greater hell hound's Hellfire Breath recharges. They can immediately use it as part of this reaction." (Hellish
// Revenge), "Trigger A creature scores a critical hit on the mukradi Effect The mukradi's Breathe Energy recharges. It can use Breathe
// Energy immediately as part of this reaction. It can't use this reaction again until it recharges Breathe Energy naturally." (Spitting
// Rage) → { builtin: "crit-recharge", recharges, untilNatural }.
export function readCritRecharge(text) {
    const split = /^Trigger (.+?)\.? Effect (.+)$/.exec(String(text).trim());
    if (!split) return null;
    if (!/^(?:(?:The )?[\w' -]+? is critically hit by (?:any Strike|an? (?:Strike|attack)(?: or spell attack)?)|An? creature scores a critical hit on (?:the )?[\w' -]+?)$/i.test(split[1].trim())) return null;
    const sentences = split[2].trim().split(/(?<=\.)\s+(?=[A-Z])/);
    const named = /^(?:The )?[\w' -]+?['’]s? ([A-Z][\w'-]+(?: [A-Z][\w'-]+)*) recharges\.$/.exec(sentences.shift() ?? "");
    if (!named) return null;
    const name = named[1];
    const use = new RegExp(`^(?:They|It|He|She) can (?:immediately use it|use (?:its |their )?${name} immediately) as part of this reaction\\.$`);
    if (!use.test(sentences.shift() ?? "")) return null;
    const natural = new RegExp(`^(?:It|They|He|She) can't use this reaction again until (?:it|they|he|she) recharges? (?:its |their )?${name} naturally\\.$`);
    let untilNatural = false;
    for (const sentence of sentences) {
        if (natural.test(sentence)) untilNatural = true;
        else return null;
    }
    return { builtin: "crit-recharge", recharges: name, ...(untilNatural ? { untilNatural } : {}) };
}

// Its own hit made a critical one (2026-10-11, batch 100): "Frequency once per day, and recharges when the great cyclops uses Ferocity.
// Trigger The great cyclops succeeds at an attack roll. Effect The attack becomes a critical success." (Flash of Brutality) →
// { builtin: "crit-upgrade", perDay, ferocityRecharges }.
export function readCritUpgrade(text) {
    const match = /^Frequency once per day(, and recharges when (?:the )?[\w' -]+? uses Ferocity)?\.? Trigger (?:The )?[\w' -]+? succeeds at an attack roll\.? Effect The attack becomes a critical success\.$/i.exec(String(text).trim());
    return match ? { builtin: "crit-upgrade", perDay: 1, ...(match[1] ? { ferocityRecharges: true } : {}), free: true } : null;
}

// More reaction Strikes and maneuvers (2026-10-11, batch 105), each in its own words:
// - Clawed Feet: "Trigger The gargoyle is Flying, and a creature moves into an adjacent square below it. Effect The gargoyle makes a claw
//   Strike against the triggering creature." → triggers ["approach"], while "flying" (or "swimming"; the GM checks it).
// - Quick Capture: "Trigger A creature hits or touches the flytrap. Effect The flytrap makes a leaf Strike against the triggering creature.
//   If it hits, the creature is Grabbed in that leaf." → ["hit"], grab.
// - Reflexive Grab: "Trigger A creature leaves a square within the gylou's reach using a move action or attempts a melee Strike against the
//   gylou Effect The gylou lashes out with a tentacle, attempting to Grapple the triggering creature. …" → ["leave", "attacked"], skill
//   "grapple", melee, release (the attacker may let go of its weapon to make the Grapple fail).
// - Clutching Armor: "Trigger A creature attempts to move away from the graveknight Effect The graveknight's armor animates and attempts to
//   Grab the triggering creature. It makes an Athletics check to Grapple using the graveknight's Athletics modifier – 2. …" → ["leave"],
//   skill "grapple", penalty 2.
// - Wrappings Lash: "Trigger A creature within reach of the morrigna's web wrappings uses an action to Strike or attempt a skill check Effect
//   The morrigna makes a web wrappings Strike against the triggering creature. If the strike is a critical hit, the triggering action is
//   disrupted." → ["strike", "skill"], disrupts "critical".
// - Retaliating Strike: "Trigger The carnivorous blob takes damage from any source Effect The blob makes a pseudopod Strike against an
//   adjacent target. If an adjacent creature dealt the triggering damage, that creature is the target …" → ["damaged-by"] (the attacker
//   when it's beside it, else another beside it).
// - Deadly Cleave: "Trigger The redcap reduces a creature to 0 Hit Points with a halberd Strike Effect The redcap makes another halberd
//   Strike against a different creature, using the same multiple attack penalty as the halberd Strike that triggered this reaction. …" →
//   ["downs"], sameMap.
function readMoreReactionStrikes(trigger, effect) {
    const it = String.raw`(?:the [\w' -]+?|it|them|him|her|[A-Z][\w'-]+(?: [A-Z][\w'-]+)*)`;
    const sentences = effect.split(/(?<=\.)\s+(?=[A-Z])/);
    const back = (sentence) => /^(?:The )?[^.]+? makes an? ([\w' -]+?) Strike against the triggering creature\.$/i.exec(sentence ?? "");
    // (The kapoacinth's "is Swimming": while: "swimming".)
    const above = new RegExp(String.raw`^${it} is (Flying|Swimming), and a creature moves into an adjacent square below ${it}$`, "i").exec(trigger);
    if (above) {
        const struck = sentences.length === 1 ? back(sentences[0]) : null;
        if (struck) return { builtin: "reaction-strike", triggers: ["approach"], strike: struck[1].toLowerCase(), penalty: 0, disrupts: false, while: above[1].toLowerCase() };
    }
    if (new RegExp(String.raw`^A creature hits or touches ${it}$`, "i").test(trigger)) {
        const struck = back(sentences[0]);
        if (struck && sentences.length === 2 && /^If it hits, the creature is Grabbed(?: in that [\w' -]+?)?\.$/i.test(sentences[1])) return { builtin: "reaction-strike", triggers: ["hit"], strike: struck[1].toLowerCase(), penalty: 0, disrupts: false, grab: true };
    }
    if (new RegExp(String.raw`^A creature leaves a square within (?:the [\w' -]+?['’]s|its|their) reach using a move action or attempts a melee Strike against ${it}$`, "i").test(trigger)
        && /^(?:The )?[^.]+? (?:lashes out with [^,.]+, )?attempting to Grapple the triggering creature\.$/i.test(sentences[0] ?? "")
        && sentences.slice(1).every((sentence) => /^If the triggering Strike was with a melee weapon, the attacking creature can Release the weapon to cause [^.]+? to automatically fail the Athletics check\.$/i.test(sentence))) {
        return { builtin: "reaction-strike", triggers: ["leave", "attacked"], strike: null, skill: "grapple", penalty: 0, disrupts: false, melee: true, ...(sentences.length > 1 ? { release: true } : {}) };
    }
    if (new RegExp(String.raw`^A creature attempts to move away from ${it}$`, "i").test(trigger) && /^(?:The )?[^.]+? attempts? to Grab the triggering creature\.$/i.test(sentences[0] ?? "")) {
        const check = /^(?:It|They) makes? an Athletics check to Grapple using (?:the [\w' -]+?['’]s|its|their) Athletics modifier(?: [-–−] ?(\d+))?\.$/i.exec(sentences[1] ?? "");
        const rest = sentences.slice(2).every((sentence) => /^The [\w' -]+? can continue to Grapple the creature normally\.$|^Since the [\w' -]+? is grappling the creature, [^.]+? doesn't need a free hand to do so\.$/i.test(sentence));
        if (check && rest) return { builtin: "reaction-strike", triggers: ["leave"], strike: null, skill: "grapple", penalty: Number(check[1]) || 0, disrupts: false };
    }
    if (new RegExp(String.raw`^A creature within reach of (?:the [\w' -]+?['’]s|its|their) [\w' -]+? uses an action to Strike or attempt a skill check$`, "i").test(trigger)) {
        const struck = back(sentences[0]);
        if (struck && sentences.length <= 2 && (sentences.length === 1 || /^If the strike is a critical hit, the triggering action is disrupted\.$/i.test(sentences[1]))) return { builtin: "reaction-strike", triggers: ["strike", "skill"], strike: struck[1].toLowerCase(), penalty: 0, disrupts: sentences.length === 2 ? "critical" : false };
    }
    if (new RegExp(String.raw`^${it} takes damage from any source$`, "i").test(trigger)) {
        const struck = /^(?:The )?[^.]+? makes an? ([\w' -]+?) Strike against an adjacent (?:target|creature)\.$/i.exec(sentences[0] ?? "");
        if (struck && sentences.length === 2 && /^If an adjacent creature dealt the triggering damage, that creature is the target of this [\w' -]+?\.$/i.test(sentences[1])) return { builtin: "reaction-strike", triggers: ["damaged-by"], strike: struck[1].toLowerCase(), penalty: 0, disrupts: false };
    }
    const downed = new RegExp(String.raw`^${it} reduces a creature to 0 Hit Points with an? ([\w' -]+?) Strike$`, "i").exec(trigger);
    if (downed) {
        const name = downed[1].toLowerCase();
        const again = new RegExp(String.raw`^(?:The )?[^.]+? makes another ${name} Strike against a different creature, using the same multiple attack penalty as the ${name} Strike that triggered this reaction\.$`, "i").test(sentences[0] ?? "");
        if (again && sentences.slice(1).every((sentence) => /^This counts toward (?:its|their|his|her) multiple attack penalty(?: as normal)?\.$/i.test(sentence))) return { builtin: "reaction-strike", triggers: ["downs"], strike: name, penalty: 0, disrupts: false, sameMap: true };
    }
    // (Batch 122.) Strikes back in other words: an ally's melee hit on a creature in its reach ("… is hit by an ally's melee attack", "… is
    // hit by a melee attack by one of the hold sergeant's allies") → "ally-hit"; a melee Strike at it from within N feet → "attacked", melee;
    // a melee critical hit on it → "critical-hit"; damage of a type from beside it ("An adjacent creature deals the gibbering mouther
    // slashing damage") → "damaged-adjacent", damageTypes; a hit on it by an adjacent creature's attack of some damage types, or by a melee
    // attack within N feet → "hit"; its melee damage ("A creature damages Satinder Morne with a melee Strike") → "damaged-adjacent"; a spell
    // cast in its tail's reach → "cast"; a creature it held escaping → "escaped"; a creature ending a move in its reach → "approach".
    const reachOf = String.raw`(?:the [\w' -]+?['’]s|[A-Z][\w'-]+(?: [A-Z][\w'-]+)*['’]s|its|their|his|her)`;
    const types = (words) => words.split(/,\s*(?:or\s+)?|\s+or\s+/).map((word) => word.trim().toLowerCase()).filter(Boolean);
    const kinds = [
        [new RegExp(String.raw`^A creature within ${reachOf} (?:melee )?reach is hit by (?:an ally's melee attack|a melee attack by one of ${reachOf} allies)$`, "i"), () => ({ triggers: ["ally-hit"] })],
        [new RegExp(String.raw`^A creature within (\d+) feet (?:makes|attempts) a melee Strike against ${it}$`, "i"), () => ({ triggers: ["attacked"], melee: true })],
        [new RegExp(String.raw`^A creature critically hits ${it} with a melee unarmed Strike or a non-reach melee Strike$`, "i"), () => ({ triggers: ["critical-hit"] })],
        [new RegExp(String.raw`^An adjacent creature deals ${it} (bludgeoning|piercing|slashing|acid|cold|electricity|fire|sonic) damage$`, "i"), (match) => ({ triggers: ["damaged-adjacent"], damageTypes: [match[1].toLowerCase()] })],
        [new RegExp(String.raw`^An adjacent creature hits ${it} with an attack that deals ((?:bludgeoning|piercing|slashing)(?:,? (?:or )?(?:bludgeoning|piercing|slashing))*) damage$`, "i"), (match) => ({ triggers: ["hit"], damageTypes: types(match[1]) })],
        [new RegExp(String.raw`^${it} is hit by a melee weapon or melee unarmed attack by a creature within \d+ feet;?$`, "i"), () => ({ triggers: ["hit"] })],
        [new RegExp(String.raw`^A creature damages ${it} with a melee Strike$`, "i"), () => ({ triggers: ["damaged-adjacent"] })],
        [new RegExp(String.raw`^A creature within reach of ${reachOf} [\w' -]+? Casts a Spell$`, "i"), () => ({ triggers: ["cast"] })],
        // (Batch 154: Watch over Evil's "A creature within 30 feet of the aso berang Casts a Spell"; Mutually Assured's "A creature within 10 feet
        // deals damage to the Ashen Man"; Tail Sweep's "A creature moves from beyond the reach of the benthic reaver's tail to within the reach of
        // the benthic reaver's tail".)
        [new RegExp(String.raw`^A creature within \d+ feet of ${it} Casts a Spell$`, "i"), () => ({ triggers: ["cast"] })],
        [new RegExp(String.raw`^A creature within (?:5|10) feet (?:deals damage to|damages) ${it}$`, "i"), () => ({ triggers: ["damaged-adjacent"] })],
        [new RegExp(String.raw`^A creature moves from beyond the reach of ${reachOf} ([\w' -]+?) to within the reach of ${reachOf} \1$`, "i"), () => ({ triggers: ["approach"] })],
        [new RegExp(String.raw`^A creature ${it} had Grabbed or Restrained successfully Escapes$`, "i"), () => ({ triggers: ["escaped"] })],
        // (Batch 137, Punish Flight: "A creature attempts to Escape from the hatred siktempora" — as it tries, whatever the result.)
        [new RegExp(String.raw`^A creature attempts to Escape from ${it}$`, "i"), () => ({ triggers: ["escape"] })],
        [new RegExp(String.raw`^A creature ends a move action within reach of ${reachOf} [\w' -]+? Strike$`, "i"), () => ({ triggers: ["approach"] })]
    ];
    // (Batch 151, Toss: "A creature ends its movement within reach of the bison's horn Strike Effect The bison attempts to Shove the triggering
    // creature with its horns. The bison can't Stride after the triggering creature on a success or critical success." — PF2e's Shove at a
    // creature coming into its reach.)
    const tossed = /^A creature ends its movement within reach of (?:the [\w' -]+?['’]s|its|their) ([\w' -]+?) Strike$/i.exec(trigger.replace(/;$/, ""));
    if (tossed && /^(?:The )?[^.]+? attempts to (Shove|Trip|Grapple) the triggering creature(?: with (?:its|their|his|her) [\w' -]+?)?\.(?: (?:The )?[^.]+? can(?:'t|not) Stride after the triggering creature on a success or critical success\.)?$/i.test(sentences.join(" "))) {
        const act = /attempts to (Shove|Trip|Grapple)/i.exec(sentences[0])[1].toLowerCase();
        return { builtin: "reaction-strike", triggers: ["approach"], strike: null, skill: act, penalty: 0, disrupts: false, ...(/can(?:'t|not) Stride after/i.test(sentences.join(" ")) ? { note: "It can't Stride after the creature." } : {}) };
    }
    // (Batch 137, Sweeping Hook: "The ogre boss successfully Trips a creature using an ogre hook" — its Strike at the creature it tripped,
    // the weapon a note for the GM.)
    const tripped = new RegExp(String.raw`^${it} successfully Trips a creature(?: using (?:an? |its |their |his |her )?([\w' -]+?))?$`, "i").exec(trigger.replace(/;$/, ""));
    if (tripped) {
        const answer = strikeBack(sentences.map((sentence) => sentence.replace(/ against the creature (?:they|it|he|she) tripped\.$/i, " against the creature.")));
        if (answer) return { builtin: "reaction-strike", triggers: ["tripped"], ...answer, ...(tripped[1] ? { using: tripped[1].toLowerCase() } : {}) };
    }
    for (const [pattern, read] of kinds) {
        const match = pattern.exec(trigger.replace(/;$/, ""));
        const answer = match ? strikeBack(sentences) : null;
        if (answer) return { builtin: "reaction-strike", ...read(match), ...answer };
    }
    return null;
}

// A reaction's Strike back and what it says of it (batch 122): "makes a claw Strike against the triggering creature", "shifts their position
// and makes a quill Strike against the attacking creature", "makes a tail Strike at the creature with a –2 penalty"; a flavour sentence
// before it; after it, no multiple attack penalty (the reaction isn't on its turn), "If the Strike hits, Athervox disrupts the creature's
// action", "She suffers a -2 penalty on the attack roll but gains a +2 bonus on the damage roll if the Strike hits". null for anything else.
function strikeBack(sentences) {
    // (Batch 154, Tail Sweep: "… makes a tail Strike against the triggering creature and can use Improved Knockdown if the attack hits, even if it
    // isn't the benthic reaver's turn." — its Knockdown the GM's, a note.)
    let knockdown = false;
    sentences = sentences.map((sentence) => sentence.replace(/(Strike against the triggering creature) and can use Improved Knockdown if the attack hits, even if it isn't [^.]+?['’]s turn\.$/i, (_all, made) => {
        knockdown = true;
        return `${made}.`;
    }));
    const at = sentences.findIndex((sentence) => /\bStrike (?:against|at) the (?:triggering|attacking) creature\b|\bStrike (?:against|at) the creature\b/i.test(sentence));
    if (at < 0 || sentences.slice(0, at).some((sentence) => /\d|@|\b(?:damage|save|check|bonus|penalty|Strikes?|Grab\w*|Prone|Hit Points|condition|Step\w*|Stride\w*)\b/i.test(sentence))) return null;
    const struck = /^(?:The )?(?:[^.]+? (?:shifts (?:its|their|his|her) position and )?makes|It makes) an? (?:([\w' -]+?) )?Strike (?:against|at) the (?:triggering |attacking )?creature(?: with an? [–-](\d+) penalty)?\.$/i.exec(sentences[at]);
    if (!struck) return null;
    const answer = { strike: !struck[1] || /^melee$/i.test(struck[1]) ? null : struck[1].toLowerCase(), penalty: Number(struck[2]) || 0, disrupts: false, ...(knockdown ? { knockdown: true } : {}) };
    for (const sentence of sentences.slice(at + 1)) {
        if (/^This Strike (?:doesn't|does not|neither applies nor) counts? toward (?:the [\w' -]+?['’]s|its|their|his|her) multiple attack penalty(?:,? and (?:the [\w' -]+?['’]s|its|their|his|her) multiple attack penalty (?:doesn't|does not) apply to this Strike)?\.$/i.test(sentence)) continue;
        if (/^If the Strike hits, (?:the [\w' -]+?|[A-Z][\w'-]+|it|they) disrupts? the (?:creature's|triggering) action\.$/i.test(sentence)) {
            answer.disrupts = true;
            continue;
        }
        // (Batch 154, Watch over Evil: "If the Strike hits a creature with the tanggal trait or is a critical hit, the triggering action is disrupted.")
        const traitOrCrit = /^If the Strike hits a creature with the ([a-z]+) trait or is a critical hit, the triggering action is disrupted\.$/i.exec(sentence);
        if (traitOrCrit) {
            answer.disrupts = "critical";
            answer.note = `A hit on a creature with the ${traitOrCrit[1].toLowerCase()} trait disrupts its action too.`;
            continue;
        }
        // (Batch 154, Tail Sweep: "If the benthic reaver knocks the target Prone, it disrupts the triggering move action.")
        if (/^If (?:the [\w' -]+?|it|they) knocks? the target Prone, (?:it|they) disrupts? the triggering move action\.$/i.test(sentence) && answer.knockdown) {
            answer.note = "If it hits, it can use Improved Knockdown even on another creature's turn; knocking the target Prone disrupts its move.";
            continue;
        }
        // (Batch 137, Punish Flight: "This Strike doesn't have Improved Grab.")
        if (/^This Strike (?:doesn't|does not) have Improved Grab\.$/i.test(sentence)) {
            answer.noGrab = true;
            continue;
        }
        const both = /^(?:It|They|He|She) suffers? an? [-–](\d+) penalty on the attack roll but gains? an? \+(\d+) bonus on the damage roll if the Strike hits\.$/i.exec(sentence);
        if (!both) return null;
        answer.penalty = Number(both[1]);
        answer.damageBonus = Number(both[2]);
    }
    if (answer.knockdown) {
        delete answer.knockdown;
        answer.note ??= "If it hits, it can use Improved Knockdown even on another creature's turn.";
    }
    return answer;
}

// A reaction that takes an ally's damage, or keeps an ally from dropping (2026-10-11, batch 106):
// - Human Shield: "Trigger The toady's boss takes damage from an attack, and the toady is adjacent to them Effect The toady takes the damage
//   instead, along with any secondary effects of attack. This damage can't be reduced in any way." → { builtin: "intercept", ward: "boss",
//   share: 1, unreduced }.
// - Mortal Shield: "Trigger The thrall's master would take damage from a Strike or spell attack and is in an adjacent square Effect … taking
//   half the damage of the attack (before applying any weaknesses or resistances). The thrall's master takes the remaining damage, …" →
//   { intercept, ward: "master", share: 0.5 }.
// - Interposition: "Trigger A ward within the guloval's reach would take damage from a Strike, and the guloval is within the attacker's
//   reach Effect … taking the triggering attack's damage. The ward takes no damage." → { intercept, ward: "ward", share: 1, strikes };
//   "Trigger An ally within 15 feet of the guard would take damage Effect The guard Strides. … switches places with the ally, taking all
//   damage and associated effects instead of the ally." → { intercept, ward: "ally", share: 1, within: 15, swap }.
// - You Don't Have My Permission to Die!: "Trigger An allied creature within 30 feet would be reduced to 0 Hit Points Effect … The creature
//   avoids being knocked out and remains at 1 HP. The creature is then temporarily immune for 24 hours." → { builtin: "rescue", within,
//   hp: 1, oncePerTarget }.
// - Soul Anchor: "A creature within 60 feet would drop to 0 Hit Points Effect … The creature remains at 1 Hit Point, becomes Doomed 2, and
//   gains fast healing equal to the dragon's level for 1 minute. The creature becomes temporarily immune …" → { rescue, within, hp: 1,
//   doomed, fastHealing: "level", oncePerTarget }.
// - Recall the Fallen: "Frequency once per day Trigger An allied creature within 60 feet who isn't a construct or undead is reduced to 0 Hit
//   Points and their Dying value is 2 or less Effect The valkyrie restores 5d10 Hit Points to the target." → { rescue, within, heal, living,
//   perDay }.
export function readGuardian(text) {
    const body = String(text).trim().replace(/@Damage\[\(?([^\]\[]+?)\)?\[healing\]\](?:\{[^}]*\})?/g, "$1").replace(/\s*Effect: [^.]+$/i, "");
    const split = /^(?:Frequency (once per day) )?(?:Trigger )?(.+?)[.;]? Effect (.+)$/.exec(body);
    if (!split) return null;
    const [, perDay, trigger, effect] = split;
    const said = effect.trim().split(/(?<=\.)\s+(?=[A-Z])/);
    const who = String.raw`(?:the [\w' -]+?|[A-Z][\w'-]+(?: [A-Z][\w'-]+)*)`;
    const boss = new RegExp(String.raw`^${who}['’]s (boss|master|liege) takes damage from an attack, and ${who} is adjacent to (?:them|it|him|her)$`, "i").exec(trigger);
    if (boss && said.length === 2 && /^(?:The )?[^.]+? takes the damage instead, along with any secondary effects of (?:the )?attack\.$/i.test(said[0]) && /^This damage can't be reduced in any way\.$/i.test(said[1])) return { builtin: "intercept", ward: boss[1].toLowerCase(), share: 1, unreduced: true };
    const master = new RegExp(String.raw`^${who}['’]s (master|boss) would take damage from a Strike or spell attack and is in an adjacent square$`, "i").exec(trigger)
        ?? new RegExp(String.raw`^(?:[^.]+\. )?If ${who} is adjacent to ${who} when ${who} would take damage from a Strike or spell attack$`, "i").exec(trigger);
    if (master && /\btaking half the damage of the attack \(before applying any weaknesses or resistances\)\./i.test(effect) && /\btakes the remaining damage, applying any weaknesses or resistances as normal\.$/i.test(effect)) return { builtin: "intercept", ward: "master", share: 0.5, attacks: true };
    if (new RegExp(String.raw`^A ward within (?:the [\w' -]+?['’]s|its|their) reach would take damage from a Strike, and ${who} is within the attacker's reach$`, "i").test(trigger)
        && said.length === 2 && /^(?:The )?[^.]+? blocks the attack with (?:their|its|his|her) own body, taking the triggering attack's damage\.$/i.test(said[0]) && /^The ward takes no damage\.$/i.test(said[1])) return { builtin: "intercept", ward: "ward", share: 1, strikes: true };
    // (Batch 228, Battlezoo: an ally's Strike damage taken in its place, when the Strike could have been aimed at it — the whole of it; a critical hit on a
    // creature beside it shared half and half, both taking the hit's effects but not the critical hit's — critical.)
    if (new RegExp(String.raw`^(?:One of ${who}['’]s allies|An ally of ${who}) is hit by a Strike that could (?:also )?have targeted ${who}$|^An ally of ${who} is struck by a Strike that ${who} was also in range of$`, "i").test(trigger)
        && said.length === 1 && /^(?:The )?[^.]+? takes the effects of the (?:successful|triggering) Strike instead\.$|^(?:The )?[^.]+? suffers that Strike's results in (?:its|their) place\.$/i.test(said[0])) return { builtin: "intercept", ward: "ally", share: 1, strikes: true };
    if (new RegExp(String.raw`^A creature (?:rolls a critical hit to Strike|critically hits) a creature adjacent to ${who}$`, "i").test(trigger)) {
        const shared = said.filter((sentence) => !/^(?:The )?[^.]+? (?:boldly )?intercepts the attack\.$/i.test(sentence));
        const halves = /^(?:Damage dealt by the triggering Strike is divided evenly between|The triggering Strike's damage is split evenly between) (?:the [\w' -]+?|it) and the struck creature\.$/i.test(shared[0] ?? "");
        const effects = shared.slice(1).every((sentence) => /^(?:The [\w' -]+?|It) and the struck creature are both affected by any effects that the triggering Strike would normally apply on a hit, but neither defender takes any effects that apply on only a critical hit\.$|^Both take the Strike's hit effects, and neither takes its critical-hit-only ones\.$/i.test(sentence));
        if (halves && effects) return { builtin: "intercept", ward: "ally", share: 0.5, strikes: true, critical: true, note: "Only a critical hit. Both take the Strike's effects on a hit, and neither takes those only a critical hit brings." };
    }
    const near = new RegExp(String.raw`^An ally within (\d+) feet of ${who} would take damage$`, "i").exec(trigger);
    if (near && /^(?:The )?[^.]+? Strides\. This movement does not trigger reactions, and [^.]+? must end the Stride in a space adjacent to the ally\. (?:The )?[^.]+? then switches places with the ally, taking all damage and associated effects instead of the ally\.$/i.test(effect.trim())) return { builtin: "intercept", ward: "ally", share: 1, within: Number(near[1]), swap: true };
    const dropping = /^An allied creature within (\d+) feet would be reduced to 0 Hit Points$|^A creature within (\d+) feet would drop to 0 Hit Points$/i.exec(trigger);
    if (dropping) {
        const stays = said.findIndex((sentence) => /\b(?:avoids being knocked out and )?remains at 1 (?:HP|Hit Point)\b/i.test(sentence));
        if (stays < 0) return null;
        const doomed = /\bbecomes Doomed (\d+)\b/i.exec(said[stays])?.[1];
        const healing = /\bgains fast healing equal to (?:the [\w' -]+?['’]s|its|their) level for 1 minute\b/i.test(said[stays]);
        const rest = said.every((sentence, index) => index === stays || /\btemporarily immune\b/i.test(sentence) || (index === 0 && !/\d/.test(sentence)));
        if (!rest) return null;
        return { builtin: "rescue", within: Number(dropping[1] ?? dropping[2]), hp: 1, ...(doomed ? { doomed: Number(doomed) } : {}), ...(healing ? { fastHealing: "level" } : {}), oncePerTarget: true, ...(dropping[2] ? { anyone: true } : {}) };
    }
    // (Batch 195, Reawaken!: "Trigger A living creature the resurrection dragon can see dies Effect … The willing creature is returned to life with
    // half of their total Hit Points. A creature can be resurrected by this ability only once." → back at half its Hit Points, a creature once;
    // any it can see.)
    if (new RegExp(String.raw`^A living creature ${who} can see dies$`, "i").test(trigger)) {
        // (The young dragons': "The willing creature is returned to life with the Dying 1 condition at the start of its next turn."; the adults':
        // "… returned to life stabilized at 0 HP.")
        const back = said.findIndex((sentence) => /^The (?:willing )?creature is returned to life (?:with half (?:of )?(?:their|its) total Hit Points|with the Dying (\d) condition at the start of (?:its|their) next turn|stabilized at 0 (?:HP|Hit Points))\.$/i.test(sentence));
        const rest = said.every((sentence, index) => index === back || /^A creature can be resurrected by this ability only once\.$/i.test(sentence) || (index === 0 && !/\d/.test(sentence)));
        if (back < 0 || !rest) return null;
        const dying = Number(/\bDying (\d)\b/i.exec(said[back])?.[1]) || null;
        const stable = /\bstabilized at 0\b/i.test(said[back]);
        return { builtin: "rescue", within: null, sees: true, ...(dying ? { hp: 0, dying } : stable ? { hp: 0, stable: true } : { hp: "half" }), living: true, oncePerTarget: true, onDeath: true };
    }
    const fallen = /^An allied creature within (\d+) feet who isn't a construct or undead is reduced to 0 Hit Points and their dying value is 2 or less$/i.exec(trigger);
    const restores = fallen ? /^(?:The )?[^.]+? restores (\d+d\d+(?:\s*\+\s*\d+)?) Hit Points to the target\.$/i.exec(effect.trim()) : null;
    if (restores) return { builtin: "rescue", within: Number(fallen[1]), heal: restores[1].replace(/\s+/g, ""), living: true, ...(perDay ? { perDay: 1 } : {}) };
    return null;
}

// An ally's save helped (2026-10-11, batch 107):
// - a reroll keeping the better: "Trigger An ally within 60 feet fails a saving throw against an emotion or mental effect Effect The ally
//   rerolls the saving throw, taking the better of the two results." (Hold Fast), "Trigger An ally within 10 feet of the dancer rolls a
//   saving throw against a mental or illusion effect Effect The target ally can roll the save twice and take the better result."
//   (Distracting Frolic), "Frequency once per hour Trigger The lucky courser or an ally within 10 feet fails a Reflex save, Acrobatics
//   check, or Athletics check Effect The triggering creature rerolls the save or check and uses the better result." (Guide to Fortune) →
//   { builtin: "save-reroll", ally, self, within, save, against, uses };
// - a bonus as it comes: "Trigger An allied animal within 30 feet attempts a saving throw Effect … granting the allied animal a +1
//   circumstance bonus to the save." (Stay Strong!), "Trigger An ally of the yamah's attempts a saving throw against an effect that has the
//   mental trait Effect The ally gains a +4 status bonus to the saving throw. If the ally rolls a success, they get a critical success
//   instead." (Free Mind) → { builtin: "save-bonus-reaction", ally, within, value, kind, against, animal, upgrade }.
export function readAllySave(text) {
    // (Batch 208, Good Fortune: "Trigger The pixiu, or an ally within 30 feet, is about to attempt a saving throw but hasn't rolled yet Frequency once per
    // hour Effect That creature rolls the triggering saving throw twice and takes the better result." — its fortune, played as a reroll of a failed save
    // (the same chances), once a fight.)
    const fortune = /^Trigger (?:The )?[^,.]+?, or an ally within (\d+) feet, is about to attempt a saving throw but hasn't rolled yet\.? Frequency once per (?:hour|day|10 minutes) Effect That creature rolls the triggering saving throw twice and takes the better result\.$/i.exec(String(text).trim());
    if (fortune) return { builtin: "save-reroll", ally: true, self: true, within: Number(fortune[1]), save: null, uses: 1, note: "Two rolls for the save, made before it; the better one counts." };
    // (Batch 220, Second Chance: "Frequency once per round Trigger A creature within 60 feet (including the time dragon) fails a saving throw or skill check
    // Effect The target rerolls the check, but must use the second result. The target is then temporarily immune to Second Chance for 24 hours." — an ally's
    // or its own failed save rerolled, the new result kept, once a round; a skill check and the immunity notes.)
    const second = /^Frequency once per round Trigger A creature within (\d+) feet \(including (?:the [\w' -]+?|itself)\) fails a saving throw or skill check\.? Effect The target rerolls the check, but must use the second result\.(?: The target is then temporarily immune to [A-Z][\w' -]+? for 24 hours\.)?$/i.exec(String(text).trim());
    if (second) return { builtin: "save-reroll", ally: true, self: true, within: Number(second[1]), save: null, keep: "new", perRound: true, free: true, note: "The new result counts. Also a failed skill check (the GM's); each creature once a day." };
    const body = String(text).trim().replace(/\s*Effect: [^.]+$/i, "").replace(/\befect\b/g, "effect");
    const split = /^(?:Frequency (once per (?:hour|day|minute)) )?Trigger (.+?)\.? Effect (.+)$/.exec(body);
    if (!split) return null;
    const [, frequency, trigger, effect] = split;
    const against = (words) => (words ? words.toLowerCase().split(/\s*(?:,|\bor\b)\s*/).filter(Boolean) : null);
    // (Batch 217, a Battlezoo chimling's luck: an ally's failed save of any kind; a first sentence that only tells it.)
    const reroll = /^An ally within (\d+) feet(?: of (?:the [\w' -]+?|[A-Z][\w'-]+))? (fails|rolls|fails or critically fails) a saving throw(?: against an? ((?:\w+)(?: or \w+)?) effect)?$/i.exec(trigger)
        ?? /^(?:The [\w' -]+?|[A-Z][\w'-]+) or an ally within (\d+) feet (fails) a (Reflex|Fortitude|Will) save, [^.]*?check$/i.exec(trigger);
    if (reroll) {
        const self = /^(?:The [\w' -]+?|[A-Z][\w'-]+) or an ally/i.test(trigger);
        const said = effect.trim().split(/(?<=\.)\s+(?=[A-Z])/);
        const told = said.length === 2 && !/\d|@|\b(?:saves?|saving throws?|checks?|rolls?|results?|bonus|penalty)\b/i.test(said[0]) ? said[1] : effect.trim();
        const keeps = /^(?:The (?:target )?ally|The triggering creature) (?:can roll the save twice and take the better result|rerolls the (?:saving throw|save)(?: or check)?,? (?:taking the better of the two results|and uses the better result))\.$/i.test(told);
        if (!keeps) return null;
        return { builtin: "save-reroll", ally: true, ...(self ? { self: true } : {}), within: Number(reroll[1]), ...(self ? { save: reroll[3].toLowerCase() } : { against: against(reroll[3]) }), ...(frequency ? { uses: 1 } : {}) };
    }
    const animal = /^An allied animal within (\d+) feet attempts a saving throw$/i.exec(trigger);
    if (animal) {
        const gains = /^(?:The )?[^.]+? granting the allied animal an? \+(\d+) (circumstance|status) bonus to the save\.$/i.exec(effect.trim());
        return gains ? { builtin: "save-bonus-reaction", ally: true, within: Number(animal[1]), value: Number(gains[1]), kind: gains[2].toLowerCase(), animal: true } : null;
    }
    const mind = /^An ally of (?:the [\w' -]+?['’]s?|[A-Z][\w'-]+['’]s?) attempts a saving throw against an effect that has the (\w+) trait$/i.exec(trigger);
    if (mind) {
        const said = effect.trim().replace(/^The ally['’]s gains\b/i, "The ally gains").split(/(?<=\.)\s+(?=[A-Z])/);
        const gains = /^The ally gains an? \+(\d+) (circumstance|status) bonus to the saving throw\.$/i.exec(said[0] ?? "");
        const upgrade = said.length === 2 && /^If the ally rolls a success, (?:they|it) gets? a critical success instead\.$/i.test(said[1]);
        if (gains && (said.length === 1 || upgrade)) return { builtin: "save-bonus-reaction", ally: true, value: Number(gains[1]), kind: gains[2].toLowerCase(), against: mind[1].toLowerCase(), ...(upgrade ? { upgrade: true } : {}) };
    }
    return null;
}

// (Batch 168, Drowning Drone: "Trigger The boggard swampseer or one of its allies within 60 feet attempts a saving throw against an auditory
// or sonic effect. Effect The swampseer releases a croak that drowns out other sound. It rolls a @Check[performance] check. It and boggard
// allies in the area can use the higher result of the swampseer's Performance check or their saves to resolve the effects against the auditory
// or sonic effect."; Cautionary Tale's "… attempts a Will save … makes a Performance check. Lasheeli and any allies can use the better result of
// her check or their saving throw."; Focusing Drone's, its own Will save only → { builtin: "save-skill", skill, save, against, ally, within,
// allyTrait }: one skill check, its result for each of those saves against that effect where it's higher.)
export function readSaveSkill(text) {
    const body = String(text).trim().replace(/@Check\[(\w+)[^\]]*\](?:\{[^}]*\})?/g, (_all, slug) => slug[0].toUpperCase() + slug.slice(1));
    const split = /^Trigger (.+?)\.? Effect (.+)$/.exec(body);
    if (!split) return null;
    const trigger = /^(?:The )?[\w' -]+?(?: or (?:one of (?:its|their|his|her) allies|an ally) within (\d+) feet)? attempts an? (?:(Fortitude|Reflex|Will) )?(?:saving throw|save)(?: against an? (\w+(?: or \w+)*) effect)?$/i.exec(split[1]);
    if (!trigger) return null;
    const said = split[2].trim().split(/(?<=\.)\s+(?=[A-Z])/);
    const skillAt = said.findIndex((sentence) => /\b(?:rolls?|makes?) an? (Acrobatics|Athletics|Deception|Diplomacy|Intimidation|Performance|Religion|Occultism|Survival) check\.$/i.test(sentence));
    if (skillAt < 0) return null;
    const skill = /\b(?:rolls?|makes?) an? (\w+) check\.$/i.exec(said[skillAt])[1].toLowerCase();
    const uses = said.slice(skillAt + 1);
    const higher = uses.length === 1 ? new RegExp(String.raw`^(?:(?:The )?[\w' -]+?|It|They|She|He)(?: and (?:(\w+) allies in the area|any allies))? can use the (?:higher|better) result (?:of|between) (?:[\w' -]+?['’]s?|its|their|her|his) (?:${skill} )?check (?:or|and) (?:their|its|her|his) (?:saves?|saving throws?|(?:Fortitude|Reflex|Will) saving throw)(?: to resolve the effects? against (?:the|that) [^.]+)?\.$`, "i").exec(uses[0]) : null;
    if (!higher) return null;
    // (The rest: its flavour — "releases a croak that drowns out other sound" — nothing to play.)
    if (said.slice(0, skillAt).some((sentence) => /\d|@|\b(?:damage|bonus|penalty|condition)\b/i.test(sentence))) return null;
    const ally = Boolean(trigger[1]);
    if (ally !== /\band (?:\w+ allies in the area|any allies)\b/i.test(uses[0])) return null;
    return { builtin: "save-skill", skill, ...(trigger[2] ? { save: trigger[2].toLowerCase() } : {}), ...(trigger[3] ? { against: trigger[3].toLowerCase().split(/\s+or\s+/) } : {}), ...(ally ? { ally: true, within: Number(trigger[1]) } : {}), ...(higher[1] ? { allyTrait: higher[1].toLowerCase() } : {}) };
}

// (Batch 170, Guide's Warning: "Trigger The guide is about to roll a Perception or Survival check to determine their initiative Effect The guide
// visually or audibly warns allies, granting them a +1 circumstance bonus to their initiative rolls. This bonus increases to +2 if the guide was
// Scouting. Depending on how the guide warns allies, this action has the auditory or visual trait."; Warning Hoot's "granting each ally …",
// Scout's Warning's "Any ally who is able to hear … gains a +1 circumstance bonus to their initiative roll." → { builtin: "initiative-warning",
// value, skills, notes }: its allies' initiative that much higher.)
// (Vare's in other words: "When Vare is about to roll …, she can alert her allies as a free action. Vare visually or audibly warns allies, …".)
export function readInitiativeWarning(text, item = null) {
    const body = String(text).trim().replace(/\s*(?:@UUID\[[^\]]*\]\{)?Effect: [^.}]+\}?$/i, "")
        .replace(/^When ([^,]+? is about to roll [^,]+?), (?:it|they|he|she) can alert (?:its|their|his|her) allies as a free action\. /i, (_all, when) => `Trigger ${when} Effect `);
    const free = item?.system?.actionType?.value === "free" || /^When [^,]+?, (?:it|they|he|she) can alert [^.]+? as a free action\./i.test(String(text).trim());
    const split = /^Trigger (.+?)[.;]? Effect (.+)$/.exec(body);
    // (Batch 178, Warning Ears: "Trigger The lucky courser rolls initiative using Perception or Survival Effect Their expressive ears twitch in alarm,
    // granting allies within 10 feet a +2 circumstance bonus to initiative rolls.")
    const trigger = split ? /^(?:The )?[\w'" -]+? is about to roll (?:an? )?(Perception(?: or Survival)?)(?: check)? (?:to determine (?:(?:its|their|his|her) )?initiative|for initiative)$/i.exec(split[1])
        ?? /^(?:The )?[\w'" -]+? rolls initiative using (Perception(?: or Survival)?)$/i.exec(split[1]) : null;
    if (!trigger) return null;
    let value = null;
    let within = null;
    const notes = [];
    for (const sentence of split[2].trim().split(/(?<=\.)\s+(?=[A-Z])/)) {
        const bonus = /^(?:(?:The )?[\w' -]+? [^.]*?\bwarns? (?:its |their )?allies(?: of imminent danger)?, granting (?:them|each ally)|Any ally who is able to (?:hear|see) [^.]*?\) gains) an? \+(\d+) circumstance bonus to (?:their|its) initiative rolls?\.$/i.exec(sentence)
            ?? /^(?:Their|Its|His|Her) [^.]*?, granting allies within (\d+) feet an? \+(\d+) circumstance bonus to (?:their )?initiative rolls\.$/i.exec(sentence);
        if (bonus && value === null && bonus[2]) {
            value = Number(bonus[2]);
            within = Number(bonus[1]);
        } else if (bonus && value === null) value = Number(bonus[1]);
        else if (/^This bonus increases to \+(\d+) if (?:the [\w' -]+?|it|they) (?:was|were) Scouting\.$/i.test(sentence)) notes.push(`${sentence.replace(/^This bonus/, "The bonus").replace(/\.$/, "")} (the GM's).`);
        else if (!/^(?:Depending on how [^.]+?, this action has the auditory or visual trait|This ability gains the auditory trait if [^.]+?, and the visual trait if [^.]+?)\.$/i.test(sentence) && !(value === null && !/\d|@/.test(sentence) && /\bwarns\b/i.test(sentence))) return null;
    }
    if (!value) return null;
    return { builtin: "initiative-warning", value, skills: trigger[1].toLowerCase().split(/\s+or\s+/), ...(within ? { within } : {}), ...(free ? { free: true } : {}), ...(notes.length ? { notes } : {}) };
}

// (Batch 171, Sidestep: "Trigger The attack roll for a Strike targeting the assassin fails or critically fails Effect … If there's another
// creature adjacent to the assassin and within reach of the triggering attack, the assassin redirects the attack to that adjacent creature. The
// attacker then rerolls the Strike's attack roll against the new target."; Glide Aside's "dodges and redirects the attack to a creature adjacent
// to him …"; Deflective Dodge's "can choose to either Step or redirect the attack …" → { builtin: "redirect-attack", step }.)
// A healing near it made small (2026-10-12, batch 195, Siphon Life): "Trigger A creature within 60 feet uses a healing effect that restores Hit
// Points Effect … The triggering effect rolls the minimum amount on any dice rolls to restore Hit Points, and any flat values for restoring Hit
// Points (such as the additional Hit Points for a two-action Heal spell), are cut in half. The dragon then gains 4d8 temporary Hit Points that
// last for 1 round." → { builtin: "heal-siphon", within, tempHp, tempRounds }.
// (Batch 220, Parasitic Healing: "Trigger A creature within 60 feet regains Hit Points Effect Taljjae takes what should belong to another. The triggering
// creature regains only half the number of Hit Points, and Taljjae regains the full amount." → { heal-siphon, within, share: 0.5, selfHeal: "full" }.)
export function readHealSiphon(text) {
    // (Batch 209, a Battlezoo dragon's: a vitality healing aimed at a creature near it that it can see — the creature gets half, the dragon the other
    // half as temporary Hit Points for a minute → { within, share: 0.5, tempRounds: 10 }.)
    const halved = /^Trigger an? creature (?:the [\w' -]+?|it) can see within (\d+) feet is targeted by (?:a spell or effect with the vitality trait(?:, and the spell would recover that creature['’]s Hit Point damage| that heals Hit Point damage)|a healing spell with the vitality trait)\.? Effect [^.]+\. (?:The triggering spell or effect heals half the amount of Hit Points to the triggering creature, and the (?:[\w' -]+?) receives the other half in temporary Hit Points, losing any remaining temporary Hit Points after 1 minute\.(?: This reaction doesn't affect the amount of healing to any other creatures, if any\.)?|That creature regains only half, and (?:the [\w' -]+?|it) gains the rest as temporary Hit Points for 1 minute\.)$/i.exec(String(text).trim());
    if (halved) return { builtin: "heal-siphon", within: Number(halved[1]), share: 0.5, tempRounds: 10 };
    const parasitic = /^Trigger An? creature within (\d+) feet regains Hit Points\.? Effect (?:[^.]+\. )?The triggering creature regains only half the number of Hit Points, and (?:the [\w' -]+?|[A-Z][\w'-]+(?: [A-Z][\w'-]+)*|it) regains the full amount\.$/i.exec(String(text).trim());
    if (parasitic) return { builtin: "heal-siphon", within: Number(parasitic[1]), share: 0.5, selfHeal: "full" };
    const split = /^Trigger An? creature within (\d+) feet uses a healing effect that restores Hit Points\.? Effect (.+)$/i.exec(String(text).trim().replace(/\s*Effect: [^.]+$/i, ""));
    if (!split) return null;
    const said = split[2].trim().split(/(?<=\.)\s+(?=[A-Z])/);
    const least = said.findIndex((sentence) => /^The triggering effect (?:rolls|results in) the minimum amount on any dice rolls to restore Hit Points, and any flat values for restoring Hit Points(?: \([^)]*\))?,? are cut in half\.$/i.test(sentence));
    if (least < 0) return null;
    const temp = /^(?:The )?[^.]+? then gains (\d+d\d+|\d+) temporary Hit Points that last for (\d+) rounds?\.$/i.exec(said[least + 1] ?? "");
    if (said.length !== least + 1 + (temp ? 1 : 0) || said.slice(0, least).some((sentence) => /\d|@/.test(sentence))) return null;
    return { builtin: "heal-siphon", within: Number(split[1]), ...(temp ? { tempHp: temp[1], tempRounds: Number(temp[2]) } : {}) };
}

// A Stride and a Strike as it rolls initiative (2026-10-12, batch 199, Uncanny Pounce): "Trigger The love siktempora rolls Dimension of Time Lore
// for initiative Effect The love siktempora Strides once and makes a claw Strike, in either order." → a Strike activity with initiative: true (a
// free action; the skill it names a note).
export function readInitiativeStrike(text) {
    const split = /^Trigger (?:The )?[^.]+? rolls (?:([A-Z][\w' -]+? Lore|Stealth|Perception|Deception|Athletics|Acrobatics|Survival) )?(?:for )?initiative\.? Effect (?:The )?[^.]+? Strides once and makes an? ([\w' -]+?) Strike, in either order\.$/i.exec(String(text).trim().replace(/\s*Effect: [^.]+$/i, ""));
    if (!split) return null;
    const strike = split[2].toLowerCase();
    return { builtin: "strike-activity", actions: 0, strides: 1, strike, attackBonus: 0, damageBonus: 0, offGuard: false, requires: null, oncePerFight: false, onHit: { conditions: [], critical: null, push: null, damage: [], save: null, size: null }, initiative: true, notes: [`As it rolls initiative${split[1] ? ` with ${split[1]}` : ""}: it Strides once and makes its ${strike} Strike, in either order.`] };
}

export function readRedirect(text) {
    const split = /^Trigger (.+?)\.? Effect (.+)$/.exec(String(text).trim());
    // (Batch 191, Hop-Dodge: "Trigger The cauthooj is the target of a melee Strike and is adjacent to another enemy that is also within the reach of the
    // melee Strike. Effect The cauthooj nimbly hops aside, redirecting the triggering Strike against the adjacent enemy. The cauthooj Strides up to half
    // its Speed, and this movement does not trigger reactions." → as it's targeted, the Strike sent at that enemy; the Stride a note.)
    if (split && /^(?:The )?[\w' -]+? is the target of a melee Strike and is adjacent to another enemy that is also within the reach of the melee Strike$/i.test(split[1])) {
        const said = split[2].trim().split(/(?<=\.)\s+(?=[A-Z])/);
        if (/^(?:The )?[\w' -]+? [^.]*?redirecting the triggering Strike against the adjacent enemy\.$/i.test(said[0] ?? "") && said.slice(1).every((sentence) => /^(?:The [\w' -]+?|It) Strides up to half (?:its|their) Speed, and this movement (?:does not|doesn't) trigger reactions\.$/i.test(sentence))) {
            return { builtin: "redirect-attack", when: "targeted", melee: true, ...(said.length > 1 ? { note: "Then it Strides up to half its Speed; that movement triggers no reactions." } : {}) };
        }
    }
    if (!split || !/^(?:The attack roll for a Strike targeting|A Strike targeting|An attack roll to Strike) [\w' -]+? fails or critically fails$/i.test(split[1])) return null;
    const said = split[2].trim().split(/(?<=\.)\s+(?=[A-Z])/);
    if (!/^The attacker (?:then )?rerolls the Strike['’]s attack roll against the new target\.$/i.test(said.at(-1) ?? "")) return null;
    const redirect = said.slice(0, -1);
    const step = redirect.length === 1 && /\bcan choose to either Step or redirect the attack to a creature\b/i.test(redirect[0]);
    const sends = (sentence) => /^(?:(?:The )?[\w' -]+? (?:can choose to either Step or redirect|(?:dodges and )?redirects) the attack to a creature(?: of (?:his|her|its|their) choice)? (?:that is )?adjacent to (?:him|her|it|them) and within (?:the )?reach of the triggering (?:attack|Strike)|If there['’]s another creature adjacent to (?:the [\w' -]+?|it|him|her|them) and within reach of the triggering attack, (?:the [\w' -]+?|it|he|she|they) redirects? the attack to that adjacent creature)\.$/i.test(sentence);
    if (!redirect.length || !sends(redirect.at(-1)) || redirect.slice(0, -1).some((sentence) => /\d|@|\b(?:damage|bonus|penalty|Strikes?)\b/i.test(sentence))) return null;
    return { builtin: "redirect-attack", ...(step ? { step: true } : {}) };
}

// (Batch 181: a creature in its aura that fails a save against some kinds of effect rerolls it, the new result kept and a critical failure on it a
// failure — a Battlezoo dragon's purifying reaction; its distance the aura's (the actor's Aura rule, 30 feet when there's none to read) →
// { builtin: "save-reroll", ally, within, against, keep: "new", floor: "failure" }.)
export function readAuraReroll(text, item = null) {
    const split = /^Trigger (.+?)\.? Effect (.+)$/.exec(String(text).trim().replace(/\s*Effect: [^.]+$/i, ""));
    const trigger = split ? /^An? creature within (?:the [\w' -]+?['’]s|its) ([\w' -]+? aura) fails a (?:saving throw|save) against (.+)$/i.exec(split[1]) : null;
    if (!trigger) return null;
    const against = [...new Set(trigger[2].split(/\s*,\s*(?:or\s+)?|\s+or\s+/).map((part) => /^(?:an? )?(\w+)(?: effect)?$/i.exec(part.trim())?.[1]?.toLowerCase()))];
    if (!against.length || against.some((trait) => !trait)) return null;
    const said = split[2].trim().split(/(?<=\.)\s+(?=[A-Z])/);
    const at = said.findIndex((sentence) => /^The triggering creature rerolls the (?:failed )?(?:saving throw|save) and (?:uses|takes) the (?:new|second) result\.$/i.test(sentence));
    if (at < 0 || said.slice(0, at).some((sentence) => /\d|@|\b(?:damage|bonus|penalty|save|saving throw)\b/i.test(sentence))) return null;
    const rest = said.slice(at + 1);
    const floor = rest.length === 1 && /^If (?:they|it|he|she) rolls? a critical failure on the second save, (?:they|it|he|she) gets? a failure instead\.$|^If the second (?:roll|save) is a critical failure, it(?:'s| is) a failure instead\.$/i.test(rest[0]);
    if (rest.length && !floor) return null;
    const owner = item?.actor ?? item?.parent ?? null;
    const name = trigger[1].toLowerCase().replace(/ aura$/, "");
    const aura = (owner?.items?.contents ?? owner?.items ?? []).find((entry) => new RegExp(`\\b${name}\\b`, "i").test(String(entry.name ?? "").replace(/purifying/i, "purification")) && /aura/i.test(String(entry.name ?? "")));
    const radius = Number((aura?.system?.rules ?? []).find((rule) => rule.key === "Aura")?.radius) || 30;
    return { builtin: "save-reroll", ally: true, within: radius, against, keep: "new", ...(floor ? { floor: "failure" } : {}) };
}

// A reaction the simulator plays, or null.
//   Trigger … targets the wererat with an attack … Effect … +2 circumstance bonus to AC against the triggering attack.
//   Trigger The dragon is targeted by an attack; Effect … The attacker rolls the triggering attack twice and uses the worse result.
//   Trigger … uses a move action or leaves a square during a move action … Effect The dragon makes a tail Strike at the creature with a –2 penalty. If the Strike hits, the dragon disrupts the creature's action.
//   Trigger The reefclaw is reduced to 0 Hit Points. Effect The reefclaw makes a claw Strike before dying.
export function readReaction(item, text) {
    // (Linked names as words: "@UUID[…]{Concealment}" → "Concealment".)
    text = text.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1");
    // (Batch 157, Shadow Veil: "If the shadow priest is targeted by a melee attack, they can use their reaction to gain a +2 circumstance bonus to AC
    // against the triggering attack." — its trigger and effect written out.)
    text = text.trim().replace(/^If ((?:the )?[^,.]+?) is targeted by (a melee attack|an attack|a ranged attack), (?:it|they|he|she) can use (?:its|their|his|her) reaction to gain (an? \+\d+ circumstance bonus to AC against the triggering attack)\.$/i, (_all, who, what, bonus) => `Trigger ${who[0].toUpperCase()}${who.slice(1)} is targeted by ${what} Effect ${who[0].toUpperCase()}${who.slice(1)} gains ${bonus}.`);
    // (Batch 156: Coiled Strike's "As Reactive Strike, but the goblin snake can use this reaction only if it's Coiled.", Aquatic Opportunity's "As
    // Attack of Opportunity, but both the bunyip and the triggering creature must be in water." — Reactive Strike behind a state the GM checks.)
    const kin = /^As (?:Reactive Strike|Attack of Opportunity), but (.+?)\.?$/i.exec(text.trim());
    if (kin && /\b(?:only (?:if|while|when)|must be)\b/i.test(kin[1])) return { builtin: "reactive-strike", requires: "requirement", note: `${kin[1][0].toUpperCase()}${kin[1].slice(1)}.` };
    // (Batch 241, Spellbreaking Reactive Strike: "…, but if it was triggered by a creature casting an arcane spell, the target must succeed at a DC 11
    // flat check or the spell is disrupted. If the Strike was a critical hit, the spell is disrupted automatically." — Reactive Strike, the spell's
    // disruption a note.)
    const breaking = kin ? /^if it was triggered by a creature casting an? (arcane|divine|occult|primal) spell, the target must succeed at a (?:@Check\[(?:type:)?flat\|dc:(\d+)[^\]]*\](?:\{[^}]*\})?|DC (\d+) flat check) or the spell is disrupted\. If the Strike was a critical hit, the spell is disrupted automatically$/i.exec(kin[1]) : null;
    if (breaking) return { builtin: "reactive-strike", note: `Against a creature casting an ${breaking[1].toLowerCase()} spell: a hit disrupts the spell unless it succeeds at a DC ${breaking[2] ?? breaking[3]} flat check; a critical hit always does.` };
    // Undying Myth (batch 41): "Cost all the creature's Mythic Points Trigger The creature would die and has at least 1 Mythic Point Effect
    // The creature remains standing and conscious, and recovers 50% of its maximum Hit Points."
    const undying = /\bTrigger (?:The )?[^.]+? would die and has at least 1 Mythic Point\.? Effect (?:The )?[^.]+? remains (?:standing and )?conscious, and recovers (\d+)% of (?:its|their|his|her) maximum Hit Points\.?$/i.exec(text.trim());
    if (undying && /^Cost all (?:of )?[^.]*?Mythic Points\b/i.test(text.trim())) return { builtin: "mythic", kind: "undying", fraction: Number(undying[1]) / 100 };
    const undyingHp = /\bTrigger (?:The )?[^.]+? would die and has at least 1 Mythic Point\.? Effect (?:The )?[^.]+? remains (?:standing and )?conscious,? and recovers (\d+) Hit Points\.?$/i.exec(text.trim().replace(/@Damage\[(\d+)\[healing\]\](?:\{[^}]*\})?/g, "$1"));
    if (undyingHp && /^Cost all (?:of )?[^.]*?Mythic Points\b/i.test(text.trim())) return { builtin: "mythic", kind: "undying", amount: Number(undyingHp[1]) };
    // (Counterspell, Read the Cards: the GM's, the user's choice of 2026-10-11.)
    if (readGmSpellcasting(text)) return { builtin: "no-effect" };
    const withdraw = readWithdraw(text) ?? readFollow(text) ?? readCritRecharge(text) ?? readCritUpgrade(text) ?? readGuardian(text) ?? readAllySave(text) ?? readAuraReroll(text, item) ?? readSaveSkill(text) ?? readInitiativeWarning(text, item) ?? readRedirect(text) ?? readHealSiphon(text) ?? readInitiativeStrike(text);
    if (withdraw) return withdraw;
    // (Batch 40, with no labels: "If a goblin ally ends a move action adjacent to the goblin warrior, the warrior can use their reaction
    // to Step"; "When a creature within the reach of the warg's bite attacks one of its allies, the warg can spend its reaction to make a
    // jaws Strike against that creature".)
    if (/^If an? (?:[\w' -]+ )?ally ends a move action adjacent to [^,]+, (?:the [\w' -]+?|it|they|he|she) can use (?:its|their|his|her) reaction to Step\.$/i.test(text.trim())) return { builtin: "no-effect" };
    // (Batch 150, Death Frenzy with no labels: "When the reefclaw is reduced to 0 hit points it can spend this reaction to make a claw Strike before
    // dying.")
    const frenzy = /^When (?:the )?[\w' -]+? is reduced to 0 hit points,? (?:it|they|he|she) can spend this reaction to make an? ([\w' -]+?) Strike before dying\.$/i.exec(text.trim());
    if (frenzy) return { builtin: "death-strike", strike: frenzy[1].toLowerCase() };
    // (Batch 177, the Menace Under Otari wight's Final Spite: "When the wight is reduced to 0 Hit Points, they can use their reaction to make a Strike
    // before being destroyed. They don't gain any Hit Points from corrupting spite on this Strike." — its best Strike; no Hit Points it would gain.)
    if (/^When (?:the )?[\w' -]+? is reduced to 0 Hit Points, (?:it|they|he|she) can use (?:its|their|his|her) reaction to make a Strike before being destroyed\.(?: (?:It|They|He|She) (?:doesn't|don't|does not|do not) gain any Hit Points from [\w' -]+? on this Strike\.)?$/i.test(text.trim())) return { builtin: "death-strike", strike: null };
    const bite = /^When a creature within (?:the )?reach of (?:the [\w' -]+?['’]s|its|their) ([\w' -]+?) attacks one of (?:its|their|the [\w' -]+?['’]s) allies, (?:the [\w' -]+?|it|they) can spend (?:its|their) reaction to make an? ([\w' -]+?) Strike against that creature\.$/i.exec(text.trim());
    if (bite) return { builtin: "reaction-strike", triggers: ["ally-attacked"], strike: bite[2].toLowerCase(), penalty: 0, disrupts: false };
    // (Batch 105, Clawed Feet in older words: "If the gargoyle is flying and a creature moves into an adjacent square below them, the gargoyle
    // can use their reaction to make a claw Strike against that creature.")
    const below = /^If (?:the )?[\w' -]+? is flying and a creature moves into an adjacent square below (?:it|them|him|her), (?:the )?[\w' -]+? can use (?:its|their|his|her) reaction to make an? ([\w' -]+?) Strike against that creature\.$/i.exec(text.trim());
    if (below) return { builtin: "reaction-strike", triggers: ["approach"], strike: below[1].toLowerCase(), penalty: 0, disrupts: false, while: "flying" };
    // (Batch 145: a riposte's trigger with no "Effect" label, "Trigger A creature within your reach critically fails to Strike you. A clever parry …".)
    text = text.replace(/^Trigger (A creature within your reach critically fails (?:a melee Strike against|to Strike) you)\.\s+(?!Effect\b)/i, "Trigger $1 Effect ");
    // (Batch 149: the labels as written, capitalised — "An attack or effect would …" in a trigger isn't its Effect.)
    const [trigger, effect] = [/Trigger (.+?)(?= Effect |$)/.exec(text)?.[1] ?? "", /\bEffect (.+)$/.exec(text)?.[1] ?? ""];
    if (!trigger || !effect) return trigger ? acDodge(text, trigger, effect) : null;
    if (readPlaneShift(text)) return { builtin: "no-effect" };
    // (Batch 177: creatures that come as it falls — Final Spite's "blows a battered war horn before being destroyed. The unnerving blast summons
    // reinforcements, raising 1d4 corpses … as Wights.", the cobbled bruiser's "A Cobbleswarm spawns in the space …" — the GM's, as summons are
    // (the user's choice of 2026-10-11).)
    // (Batch 228, Battlezoo: a fallen ally raised as an undead creature — a summon too.)
    if (/\bsummons reinforcements, raising [^.]*? corpses\b/i.test(effect) || /^An? (?:Weakened )?[A-Z][\w'-]+ spawns in the space (?:the [\w' -]+?|it) previously occupied\b/.test(effect.trim()) || /\b(?:rises|stands up) as an? (?:[\w-]+-sized )?[A-Z][\w' -]+?,/.test(effect)) return { builtin: "no-effect" };
    // (Batch 86: Counterspell's kin — a spell or effect that sets it off, and an attempt to counteract it: "Trigger The nullifier is the target
    // of a spell Effect The nullifier attempts to counteract the triggering spell …", "Trigger A creature within 30 feet casts a divine spell
    // … attempts to counteract the triggering spell …". The GM's, as Counterspell is (the user's choice of 2026-10-11).)
    // (Batch 87: a bonus to its own save as it comes — Occult Ward's "Trigger Padli attempts a saving throw against a spell cast by a creature
    // he can see Effect Padli gains a +2 circumstance bonus to the triggering save.", "is about to make a saving throw against a spell or
    // magical effect", "is about to attempt a saving throw", "is targeted by a spell that allows a saving throw", "An opponent casts a spell
    // that targets the manticore and requires a saving throw"; what a critical success brings besides, the GM's.)
    const ownSaveSplit = /^Trigger (.+?)\.? Effect (.+)$/.exec(String(text).trim());
    // (Batch 218, a Battlezoo creature's bravado: a mental effect with a save aimed at it — a bonus against mental effects only.)
    const saveTrigger = ownSaveSplit ? /^(?:(?:The )?[^.]+? (?:attempts|is about to (?:make|attempt)) a saving throw(?: against (a spell(?: cast by a creature (?:it|he|she|they) can see)?|a spell or magical effect))?|(?:The )?[^.]+? is targeted by a (spell|mental effect) that allows a saving throw|(?:The )?[^.]+? is targeted by a mental effect that requires a (?:save|saving throw)|An opponent casts a spell that targets (?:the [\w' -]+?|it|[A-Z][\w'-]+) and requires a saving throw)$/i.exec(ownSaveSplit[1].trim().replace(/;$/, "")) : null;
    if (saveTrigger) {
        const said = ownSaveSplit[2].trim().split(/(?<=\.)\s+(?=[A-Z])/);
        const gains = /^(?:The )?[^.]+? (?:touches [^,.]+? and )?(?:gains|gaining|granting (?:itself|themself|themselves)) an? \+(\d+) circumstance bonus to the (?:triggering )?(?:save|saving throw)\.$/i.exec(said[0] ?? "");
        if (gains && said.slice(1).every((sentence) => /^If (?:it|they|he|she|the [\w' -]+?) critically succeeds? (?:at|on) the (?:save|saving throw)\b/i.test(sentence) || !/\d|@|\b(?:damage|bonus|penalty|condition)\b/i.test(sentence))) {
            const against = /\bspell or magical effect\b/i.test(ownSaveSplit[1]) ? "magical" : /\bspell\b/i.test(ownSaveSplit[1]) ? "spell" : /\bmental effect\b/i.test(ownSaveSplit[1]) ? "mental" : null;
            return { builtin: "save-bonus-reaction", value: Number(gains[1]), ...(against ? { against } : {}) };
        }
    }
    // (Batch 214, Scatter: "Trigger The skittering slayer is targeted by a splash attack or would attempt a Reflex save against an area effect Effect
    // The skittering slayer scatters in place, gaining a +2 circumstance bonus to AC and Reflex saves against the triggering effect." — its Reflex
    // save against an area; the AC against a splash attack a note.)
    if (ownSaveSplit && /^(?:The )?[^.]+? is targeted by a splash attack or would attempt a Reflex save against an area effect$/i.test(ownSaveSplit[1].trim())) {
        const scatter = /^(?:The )?[^.]+?, gaining an? \+(\d+) circumstance bonus to AC and Reflex saves against the triggering effect\.$/i.exec(ownSaveSplit[2].trim().replace(/\s*Effect: [\w' -]+$/, ""));
        if (scatter) return { builtin: "save-bonus-reaction", value: Number(scatter[1]), kind: "reflex", area: true, notes: [`Or +${scatter[1]} to its AC against a splash attack aimed at it.`] };
    }
    // (Batch 216, Spell Dodge: "Trigger The mage killer is targeted by a spell Effect The mage killer gains a +2 circumstance bonus to AC and saving
    // throws against the triggering spell." — its save against a spell; the AC against a spell attack a note.)
    if (ownSaveSplit && /^(?:The )?[^.]+? is targeted by a spell$/i.test(ownSaveSplit[1].trim())) {
        const dodge = /^(?:The )?[^.]+? gains an? \+(\d+) circumstance bonus to AC and saving throws against the triggering spell\.$/i.exec(ownSaveSplit[2].trim().replace(/\s*Effect: [\w' -]+$/, ""));
        if (dodge) return { builtin: "save-bonus-reaction", value: Number(dodge[1]), against: "spell", notes: [`Or +${dodge[1]} to its AC against the spell's attack.`] };
    }
    // (Its own split, case-sensitive: "Trigger The dragon is targeted by a mental effect they're aware of Effect …".)
    const countering = /Trigger (.+?)(?: Requirements? .+?)? Effect (.+)$/.exec(text);
    if (countering && /\b(?:Casts? (?:a |an |the )?(?:[\w-]+ )?Spell|spells?|effects?|casting)\b/i.test(countering[1]) && /\b(?:attempts? to (?:counteract|unravel|unmake)|makes a counteract check|to counter the triggering creature's casting)\b/i.test(countering[2])) return { builtin: "no-effect" };
    // (Batch 72: one that only brings another into the fight — "The rocks of the area begin to crumble. The hazard rolls for initiative.",
    // "The augdunars roll initiative." — or Sustains a Spell as its turn begins: the GM's.)
    const joining = effect.trim().split(/(?<=\.)\s+(?=[A-Z])/);
    const quiet = (sentence) => !/\d|@|\b(?:damage|save|Strikes?|attacks?|check|penalty|bonus|condition|Hit Points|HP|casts?|uses?|makes?|Strides?|Steps?|moves?|teleports?|creates?|summons?|spawns?|expos\w*|Grabbed|Restrained|Immobilized|Prone|Escape|difficult terrain|pulls?|push\w*)\b|\bat the (?:target|triggering creature)\b/i.test(sentence);
    if (joining.every(quiet) && /^(?:The [\w' -]+?|It|They|[A-Z][\w'-]+)(?: [a-z][\w' -]*? and)? (?:then )?rolls? (?:for )?initiative\.$/i.test(joining.at(-1))) return { builtin: "no-effect" };
    // (Batch 85: any quiet wording of it — "Spectral faces appear, and the haunt rolls initiative.", "The hazard rolls initiative as the
    // flood surges forth.", "The blade begins to float in the air, then rolls initiative."; a creature that emerges to defend it, the GM's
    // as summons are. Not one whose routine it performs at once.)
    if (joining.every(quiet) && joining.some((sentence) => /\brolls? (?:for )?initiative\b/i.test(sentence)) && !/\broutine\b|\[\[\/|\b(?:Demoralize|Trip|Shove|Grapple|Disarm|Reposition|Feint|Seek|Hide|Sneak|targets?|shoots?|fires?|sinks?|random)\b/i.test(effect)) return { builtin: "no-effect" };
    if (joining.every(quiet) && /\b(?:Sustains a Spell|gains the effects of the Sustain a Spell action)\b/.test(effect) && /\bturn begins\b/i.test(trigger)) return { builtin: "no-effect" };
    // (Batch 85: a form shift as the fight starts, the GM's (the user's choice of 2026-10-11) — Quick Change's "… uses Change Shape to
    // enter her hybrid form", True Appearance's "… ends Change Shape".)
    const shifts = (sentence) => /^(?:The )?[^.]+? (?:uses Change Shape to (?:enter|take|assume) (?:its|their|his|her) [\w' -]+? form|ends Change Shape)\.$/i.test(sentence);
    if (/\b(?:rolls?|roll) (?:for )?initiative\b/i.test(trigger) && joining.some(shifts) && joining.every((sentence) => quiet(sentence) || shifts(sentence))) return { builtin: "no-effect" };
    // Biting Snakes (batch 55): "Trigger A creature ends its turn adjacent to the medusa. Effect The medusa makes a snake fangs Strike against
    // the creature." → a reaction Strike as a creature ends its turn beside it.
    const ending = /^An? creature ends its turn adjacent to (?:the [\w' -]+?|[A-Z][\w'-]+|it)\.?$/i.test(trigger.trim()) ? /^(?:The )?[^.]+? makes an? ([\w' -]+?) Strike against the (?:triggering )?creature\.$/i.exec(effect.trim()) : null;
    if (ending) return { builtin: "reaction-strike", triggers: ["turn-end-adjacent"], strike: ending[1].toLowerCase(), penalty: 0, disrupts: false };
    // (Batch 245, Whirling Hands: "Trigger A creature starts its turn in the capritellix's melee reach Effect The capritellix makes a metal hand Strike
    // against the creature." — a Strike as a creature starts its turn beside it; a free action's, not its reaction.)
    const starting = /^An? creature starts its turn in (?:the [\w' -]+?['’]s|its) (?:melee )?reach\.?$/i.test(trigger.trim()) ? /^(?:The )?[^.]+? makes an? ([\w' -]+?) Strike against the (?:triggering )?creature\.$/i.exec(effect.trim()) : null;
    if (starting) return { builtin: "reaction-strike", triggers: ["turn-start-adjacent"], strike: starting[1].toLowerCase(), penalty: 0, disrupts: false, ...(item?.system?.actionType?.value === "free" ? { free: true } : {}) };
    // Wing Thrash (batch 54): "Trigger An adjacent enemy damages the giant bat Effect The bat makes one or two wing Strikes—one against the
    // triggering creature and one against another adjacent creature." → a reaction Strike at it as it's damaged (and a second at another).
    const thrash = /^An? adjacent enemy damages (?:the [\w' -]+?|it|him|her|them)\.?$/i.test(trigger.trim()) ? /^(?:The )?[^.]+? makes one or two ([\w' -]+?) Strikes(?:\s*[-\u2013\u2014]\s*one against the triggering creature and one against another adjacent creature|, each against a different adjacent creature)\.$/i.exec(effect.trim()) : null;
    if (thrash) return { builtin: "reaction-strike", triggers: ["damaged-adjacent"], strike: thrash[1].toLowerCase(), penalty: 0, disrupts: false, second: true };
    // Batch 67: kept standing at 0 HP in its own words, Ferocity's kin — Orc Ferocity's "Evora avoids being knocked out and remains at 1
    // Hit Point, and her Wounded condition increases by 1" (once a day), Mythic Ferocity's "… remains at half its maximum HP, but its
    // wounded value increases by 1" or "… regains 4d10 Hit Points …" (a Mythic Point), Indomitable Beast's "… remains at 1 HP, then can
    // make a stinger Strike against a creature in its reach", Never Fall's "He remains standing with 25 Hit Points" (the first time a
    // day) → { builtin: "ferocity", hp (1, "half", a number or a formula), wounded, uses?, strike?, mythic?, free? }.
    // (Batch 149, a Battlezoo dragon's will to stay up as it would drop to 0: it keeps 1 Hit Point and uses another ability of its own — that
    // one the GM's.)
    const downed = /^(?:The )?[^.]+? (?:would be reduced to 0 (?:Hit Points|HP)(?: but not immediately killed)?|is reduced to 0 (?:Hit Points|HP))\.?$|^(?:The )?[^.]+?['’]s Hit Points are reduced to 0 for the first time that day\.?$|^An attack or (?:an(?:other)? )?effect would (?:reduce|bring) (?:the [\w' -]+?|it|them) (?:down )?to 0 (?:Hit Points|HP)\.?$/i.test(trigger.trim().replace(/\s*Requirements? (?:The )?[^.]+? is not Wounded 3\.?$/i, ""));
    if (downed) {
        const said = effect.trim().replace(/@Damage\[(\d+)\[healing\]\](?:\{[^}]*\})?/gi, "$1").replace(/@Damage\[\(?([\dd+ ]+?)\)?\[healing\]\](?:\{[^}]*\})?/gi, "$1").replace(/\s*When it is Wounded 3, it can no longer use this ability\.$/i, "");
        const told = said.split(/(?<=\.)\s+(?=[A-Z])/);
        const body = told.length > 1 && !/\d|\b(?:Hit Points?|HP|knocked out|wounded|Strike)\b/i.test(told[0]) ? told.slice(1).join(" ") : said;
        const stays = /^(?:The )?[^.]+? avoids being knocked out and (?:remains at (1|half its maximum) (?:Hit Points?|HP)|regains (\d+d\d+(?:\s*[+-]\s*\d+)?|\d+) Hit Points)(?:,? (?:and|but) (?:her|his|its|their) (?:Wounded condition|wounded value) increases by 1|, then can make an? ([\w' -]+?) Strike against a creature in (?:its|their|his|her) reach)?\.$/i.exec(body)
            ?? /^(?:They|He|She|It|The [\w' -]+?) remains? standing with (\d+) Hit Points\.$/i.exec(body)
            ?? /^(?:They|He|She|It|The [\w' -]+?) (?:remains? at (1) Hit Point and stays standing|stays? on (?:its|their) feet with (1) Hit Point)\.(?: (?:They|He|She|It|The [\w' -]+?) then (?:immediately )?uses (?:the )?[A-Z][\w' -]+? ability\.)?$/i.exec(body);
        // (Batch 154, Exit Stage: "Taljjae retains 1 Hit Point and teleports to an empty space within 30 feet. One of its masks remains behind and is
        // broken." — the teleport and the mask the GM's.)
        const exit = stays ? null : /^(?:They|He|She|It|The [\w' -]+?|[A-Z][\w'-]+) retains? 1 Hit Point and teleports to an empty space within (\d+) feet\.( One of (?:its|their|his|her) masks remains behind and is broken\.)?$/i.exec(body);
        if (exit) return { builtin: "ferocity", hp: 1, wounded: false, note: `It then teleports to an empty space within ${exit[1]} feet: move its token.${exit[2] ? " One of its masks stays behind, broken." : ""}`, ...(exit[2] ? { perMask: true } : {}), ...(item?.system?.actionType?.value === "free" ? { free: true } : {}) };
        if (stays) {
            const wounded = /\bwounded\b/i.test(body);
            const hp = /^half/i.test(stays[1] ?? "") ? "half" : stays[2] ?? Number(stays[1]);
            const once = /\bFrequency once per day\b|\bfor the first time that day\b/i.test(`${text} ${trigger}`);
            return { builtin: "ferocity", hp: /^\d+$/.test(String(hp)) ? Number(hp) : hp, wounded, ...(once ? { uses: 1 } : {}), ...(stays[3] ? { strike: stays[3].toLowerCase() } : {}), ...(/\bCost 1 Mythic Point\b/i.test(text) ? { mythic: true } : {}), ...(item?.system?.actionType?.value === "free" ? { free: true } : {}) };
        }
    }
    // Batch 66: +AC for an ally as an attack comes at it — Hammer Block's "Trigger An ally within the bramble champion's reach is targeted
    // by an attack, and the bramble champion can see the attacker Effect … giving the ally a +2 circumstance bonus to AC against the
    // triggering attack.", Stygian Guardian's "A creature or object within the sarglagon's reach is targeted by an attack … giving the
    // creature or object Standard Cover against the attack (+2 circumstance bonus to AC)", Wind Shell's "An ally within 60 feet is
    // targeted by a physical ranged attack … a +4 status bonus to AC against physical ranged attacks", Reactive Defense's "A creature
    // within reach attacks the garrholdion's ally … It then makes a melee Strike against the triggering creature." → { builtin:
    // "ally-ac-reaction", value, within ("reach" or feet), ranged?, strike? }.
    // (Batch 182: a Battlezoo dragon line's shield for itself or an ally within some feet as either is attacked — Raise a Shield with its own shield's
    // bonus (2 when there's none to read), its ally's until the start of its next turn → ally-ac-reaction with self.)
    const shielded = /^A creature attacks (?:the [\w' -]+?|it) or (?:the [\w' -]+?['’]s|its) ally within (\d+) feet of (?:the [\w' -]+?|it)\.?$/i.exec(trigger.trim());
    if (shielded && /\bRaise a Shield action\b/i.test(effect) && /\bally (?:gains|gets|keeps) (?:the|that) (?:circumstance )?bonus(?: to AC)? until the (?:beginning|start) of (?:the [\w' -]+?['’]s|its) next turn\.$/i.test(effect.trim())) {
        const shield = (item?.actor?.itemTypes?.shield ?? [])[0];
        const value = Number(shield?.system?.acBonus) || 2;
        return { builtin: "ally-ac-reaction", value, type: "circumstance", within: Number(shielded[1]), self: true, note: `It raises its shield: +${value} circumstance bonus to AC against the attack, or for the ally until the start of its next turn.` };
    }
    // (Batch 218, a Battlezoo creature's aura shield: "A creature within the X's <name> aura" — any creature in its aura, its size from the aura's own text,
    // else 30 feet.)
    const auraGuard = /^A creature within (?:the [\w' -]+?['’]s|its) ([\w' -]+?) aura is (?:targeted by|the target of) an attack\.?$/i.exec(trigger.trim());
    if (auraGuard) {
        const shield = /\+(\d+) (circumstance|status) bonus to AC against the triggering attack\b/i.exec(effect);
        const aura = (item?.actor?.items?.contents ?? item?.actor?.items ?? []).find?.((other) => String(other.name ?? "").toLowerCase().includes(auraGuard[1].toLowerCase()) && /emanation\|distance:(\d+)/i.test(String(other.system?.description?.value ?? "")));
        const feet = Number(/emanation\|distance:(\d+)/i.exec(String(aura?.system?.description?.value ?? ""))?.[1]) || 30;
        if (shield && !/\b(?:save|damage|Grab|Prone|condition)\b/i.test(effect)) return { builtin: "ally-ac-reaction", value: Number(shield[1]), type: shield[2].toLowerCase(), within: feet, ...(/\bteleport\b/i.test(effect) ? { note: "On a miss, the creature can teleport to any open space in the aura." } : {}) };
    }
    const guardedBy = /^(?:A creature or object|An? (?:[\w' -]+ )?ally) within (?:(?:the [\w' -]+?['’]s|[A-Z][\w'-]+['’]s|its|their) reach|(\d+) feet(?: of (?:the [\w' -]+?|it|them))?) is targeted (?:by|with) (?:an? )?(?:(physical ranged|ranged or melee|melee or ranged|ranged|melee) )?attack(?: or offensive troop ability)?(?: (?:by|from) an attacker (?:she|he|it|they|the [\w' -]+?) can see)?(?:, and (?:the [\w' -]+?|it|they) can see the attacker)?\.?$/i.exec(trigger.trim())
        ?? /^An adjacent (?:[\w' -]+ )?ally is targeted by an? (?:melee or ranged|ranged or melee) attack from an attacker (?:the [\w' -]+?|it|they|she|he) can see\.?$/i.exec(trigger.trim())
        ?? /^A creature within reach attacks (?:the [\w' -]+?['’]s|its|their) ally\.?$/i.exec(trigger.trim());
    // (A troop's "giving the target standard cover against the attack": +2 circumstance.)
    const guardValue = guardedBy ? /\+(\d+) (circumstance|status) bonus to (?:its |their )?AC\b/i.exec(effect) ?? (/\bstandard cover against the attack\b/i.test(effect) ? [null, "2", "circumstance"] : null) : null;
    if (guardedBy && guardValue && !/\b(?:save|damage|Grab|Prone|condition)\b/i.test(effect)) {
        const within = /^An adjacent/i.test(trigger.trim()) ? 5 : guardedBy[1] ? Number(guardedBy[1]) : "reach";
        const strikesBack = /\b(?:It|They|The [\w' -]+?) then makes? a melee Strike against the triggering creature\./i.test(effect);
        return { builtin: "ally-ac-reaction", value: Number(guardValue[1]), type: guardValue[2].toLowerCase(), within, ...(/physical ranged|^ranged$/i.test(guardedBy[2] ?? "") ? { ranged: true } : {}), ...(strikesBack ? { strike: "melee" } : {}) };
    }
    // Counterattack (batch 66): "Trigger The shae is targeted by an attack from an adjacent creature that misses due to the shae being
    // Concealed Requirements The shae is aware of the attack Effect The shae makes a Strike against the attacker." → triggers
    // ["concealed-miss"], its best melee Strike.
    if (/^(?:The )?[^.]+? is targeted by an attack from an adjacent creature that misses due to (?:the [\w' -]+?|her|him|it|them|[A-Z][\w'-]+) being Concealed(?: Requirements? (?:The )?[^.]+? is aware of the attack)?\.?$/i.test(trigger.trim()) && /^(?:The )?[^.]+? makes a Strike against the attacker\.$/i.test(effect.trim())) {
        return { builtin: "reaction-strike", triggers: ["concealed-miss"], strike: "melee", penalty: 0, disrupts: false };
    }
    // Batch 65: a Strike at a creature it holds that fails to Escape, Savage's "Trigger A creature Grabbed by the wyvern critically fails a
    // skill check to Escape Effect The wyvern makes a stinger Strike against the triggering creature." → triggers ["escape-failed"] or
    // ["escape-critical-failure"].
    const held = /^An? creature (?:Grabbed|grabbed)(?: or Restrained)? by (?:the [\w' -]+?|[A-Z][\w'-]+(?: [A-Z][\w'-]+)?)(?:['’]s [\w' -]+?)? (critically fails|fails) an? (?:skill )?check to Escape\.?$/.exec(trigger.trim());
    const heldStrike = held ? /^(?:The )?[^.]+? makes an? ([\w' -]+?) Strike against the (?:triggering )?creature\.$/i.exec(effect.trim()) : null;
    if (heldStrike) return { builtin: "reaction-strike", triggers: [/^critically/i.test(held[1]) ? "escape-critical-failure" : "escape-failed"], strike: heldStrike[1].toLowerCase(), penalty: 0, disrupts: false };
    // Batch 61: a Strike as it takes damage of some types — the trolls' Furious Flailing, "Trigger The forest troll takes electricity or
    // fire damage Effect The troll makes a claw Strike against a random creature within its reach. If the troll has persistent fire
    // damage, they attempt a DC 15 flat check to remove it." (Furious Carve's "hatchet or claw", Furious Spit's "within their first range
    // increment"); the wood golem's Splinter, "takes physical damage … The golem makes a splinter Strike against an adjacent creature
    // without triggering reactions." → triggers ["damaged-by"], damageTypes, random (a random creature) or the attacker first,
    // persistentFire (its extra flat check).
    const hurtBy = /^(?:The )?[^.]+? takes (electricity|fire|cold|sonic|acid|physical|force|mental|void|vitality)(?: or (electricity|fire|cold|sonic|acid|physical|force|mental|void|vitality))? damage\.?$/i.exec(trigger.trim());
    if (hurtBy) {
        const said = effect.trim().replace(/@Check\[(?:type:)?flat\|dc:(\d+)[^\]]*\]/gi, "a DC $1 flat check").replace(/a a DC/i, "a DC");
        const lashes = /^(?:(?:A|An|The) [^.]+? (?:lances|bursts?) (?:out )?(?:from [^.]+? )?at (?:the [\w' -]+?'s|its|their) attacker\. )?(?:The )?[^.]+? makes an? ([\w' -]+?) Strike against (a random creature within (?:(?:its|their) )?(?:reach|first range increment)|an adjacent creature without triggering reactions)\.( If (?:the [\w' -]+?|it|they) (?:has|have|is taking|are taking) persistent fire damage, (?:it|they|he|she) attempts? (?:a|an) DC 15 flat check to remove it\.)?$/i.exec(said);
        if (lashes) return { builtin: "reaction-strike", triggers: ["damaged-by"], damageTypes: [hurtBy[1], hurtBy[2]].filter(Boolean).map((type) => type.toLowerCase()), strike: lashes[1].replace(/\s+or\s+.*$/i, "").toLowerCase(), penalty: 0, disrupts: false, ...(/random/i.test(lashes[2]) ? { random: true } : {}), ...(lashes[3] ? { persistentFire: true } : {}) };
        // (Batch 117, Furious Throw: "The troll uses Throw Rock targeting a random enemy within their first range increment. If the cavern troll
        // has persistent acid damage, they attempt a DC 15 flat check to remove it." — its rock Strike at a random enemy, the flat check
        // against that persistent damage.)
        const thrown = /^(?:The )?[^.]+? uses Throw ([A-Z][\w'-]+) targeting a random (?:enemy|creature) within (?:its|their) first range increment\.( If (?:the [\w' -]+?|it|they) (?:has|have) persistent (\w+) damage, (?:it|they|he|she) attempts? (?:a|an) DC 15 flat check to remove it\.)?$/i.exec(said);
        if (thrown) return { builtin: "reaction-strike", triggers: ["damaged-by"], damageTypes: [hurtBy[1], hurtBy[2]].filter(Boolean).map((type) => type.toLowerCase()), strike: thrown[1].toLowerCase(), penalty: 0, disrupts: false, random: true, ranged: true, ...(thrown[3] ? { persistentType: thrown[3].toLowerCase() } : {}) };
    }
    // Batch 57: a Strike back at a creature that Strikes it in its reach (Cutting Rebuke's "A creature within reach of the dragon's chin
    // blade that the dragon can see makes a Strike against the dragon", Bite Back's "The skull is attacked by a creature within their
    // reach", "makes a melee Strike against or touches the witchfire"), that critically fails a Strike against it ("A creature within
    // the great wolf's reach critically fails a Strike against it", "critically misses the wereant with a melee Strike"), that damages it
    // from beside it (Squealed Outrage, one Strike), or that targets it with an attack or a spell, at any range (Superconductor's "The
    // dragon attempts a storm bolt Strike against the attacker, regardless of range") → triggers "attacked", "critical-miss",
    // "damaged-adjacent", "targeted".
    const its = String.raw`(?:the [\w' -]+?|it|him|her|them|[A-Z][\w'-]+)`;
    const reachOf = String.raw`(?:the [\w' -]+?['’]s|its|their|his|her) reach`;
    const answered = [
        [new RegExp(String.raw`^(?:The )?[^.]+? is attacked by a creature within ${reachOf}$`, "i"), "attacked"],
        [new RegExp(String.raw`^A creature within (?:the )?reach of (?:the [\w' -]+?['’]s|its|their) [\w' -]+?(?: that ${its} can see)? makes a Strike against ${its}$`, "i"), "attacked"],
        [new RegExp(String.raw`^A creature makes a melee Strike against or touches ${its}$`, "i"), "attacked"],
        [new RegExp(String.raw`^A creature (?:within ${reachOf} |adjacent to ${its} )?critically (?:fails an? (?:melee )?Strike against|misses) ${its}(?: with a melee Strike)?$`, "i"), "critical-miss"],
        // (Batch 63: a creature in its reach failing or critically failing an attack roll against it.)
        [new RegExp(String.raw`^A creature (?:within ${reachOf} )?fails or critically fails an attack roll against ${its}$`, "i"), "missed"],
        [new RegExp(String.raw`^(?:The )?[^.]+? is damaged by an adjacent creature$`, "i"), "damaged-adjacent"],
        [new RegExp(String.raw`^(?:The )?[^.]+? is targeted by an attack or spell$`, "i"), "targeted"],
        // (Batch 94, Opportune Backstab: "A creature within Fayati's reach is hit by a melee Strike from one of her allies".)
        [new RegExp(String.raw`^A creature within (?:(?:the [\w' -]+?['’]s|[A-Z][\w'-]+(?: [A-Z][\w'-]+)*['’]s|its|their|his|her) )?(?:melee )?reach is hit by a melee (?:attack|Strike) from one of (?:its|their|his|her|the [\w' -]+?['’]s) allies$`, "i"), "ally-hit"]
    ].find(([pattern]) => pattern.test(trigger.trim().replace(/\.$/, "")))?.[1];
    // (Batch 144, Opportune Riposte: "A foe within your reach critically fails a Strike against you … You either make a melee Strike against the
    // triggering foe or attempt to Disarm it of the weapon it used for the Strike." — the Strike; the Disarm instead a note.)
    if (/^An? (?:foe|enemy) within (?:your|(?:the )?[\w' -]+?['’]s) reach critically fails (?:on )?a Strike against (?:you|him|her|them|it)$/i.test(trigger.trim().replace(/\.$/, ""))
        && /^(?:You take advantage of an opening from your enemy's fumbled attack\. )?(?:You|(?:The )?[\w' -]+?) either makes? a melee Strike against the triggering (?:foe|enemy) or attempts? to Disarm (?:it|them|him|her) of the weapon (?:(?:it|they|he|she) )?used for the Strike\.(?: If (?:he|she|they|it) succeeds, (?:he|she|they|it) gains panache\.)?$/i.test(effect.trim())) {
        return { builtin: "reaction-strike", triggers: ["critical-miss"], strike: null, penalty: 0, disrupts: false, note: "Or it can Disarm the attacker of that weapon instead." };
    }
    // (Batch 150, Dueling Riposte: "A creature critically fails a Strike against Vorens Effect Vorens makes a melee Strike against or attempts to
    // Disarm the triggering creature.")
    if (/^A creature critically fails a Strike against (?:the [\w' -]+?|[A-Z][\w'-]+)$/i.test(trigger.trim().replace(/\.$/, "")) && /^(?:The )?[\w' -]+? makes a melee Strike against or attempts to (?:\[\[\/act disarm\]\]|Disarm) the triggering creature\.$/i.test(effect.trim())) {
        return { builtin: "reaction-strike", triggers: ["critical-miss"], strike: null, penalty: 0, disrupts: false, note: "Or it can Disarm the attacker instead." };
    }
    // (Batch 145: Twin Riposte's "Trigger A creature within Ilora's reach critically fails a melee Strike against her Requirements Ilora is
    // benefiting from Twin Parry Effect Ilora attempts a melee Strike or uses a Disarm action against the triggering opponent." — its stance the
    // GM's (requires); "A creature within your reach critically fails to Strike you … Make a melee Strike or Disarm action against the triggering
    // opponent.")
    // (Batch 152, Ledorick's Dueling Riposte: "Requirements Ledorick is using Dueling Parry Trigger A creature within Ledorick's reach critically
    // fails a Strike against him Effect Ledorick makes a melee Strike against the triggering creature or attempts to Disarm the triggering
    // creature.")
    const riposte = /^A creature within (?:your|(?:the )?[\w' -]+?['’]s) reach critically fails (?:a (?:melee )?Strike against (?:you|him|her|them|it)|to Strike (?:you|him|her|them|it))$/i.test(trigger.trim().replace(/\s*Requirements? .*$/i, "").replace(/\.$/, ""));
    const parried = /\bRequirements? (?:The )?[\w' -]+? is (?:benefiting from|using) ([A-Z][\w' -]+?)\.? (?:Effect|Trigger)\b/i.exec(text)?.[1] ?? null;
    if (riposte && /^(?:A clever parry with one weapon leaves your opponent open to an attack with the other weapon\. )?(?:(?:The )?[\w' -]+? attempts a melee Strike or uses a Disarm action|Make a melee Strike or Disarm action) against the triggering opponent\.$|^(?:The )?[\w' -]+? makes a melee Strike against the triggering creature or attempts to (?:\[\[\/act disarm\]\]|Disarm) the triggering creature\.$/i.test(effect.trim())) {
        return { builtin: "reaction-strike", triggers: ["critical-miss"], strike: null, penalty: 0, disrupts: false, note: `${parried ? `Only while it benefits from ${parried}. ` : ""}Or it can Disarm the attacker instead.`, ...(parried ? { requires: "requirement" } : {}) };
    }
    // (Batch 103: Retaliatory Strike — "Trigger A creature within reach of the frost drake's tail successfully damages the frost drake with a
    // Strike Effect The frost drake attempts to Strike with their tail. If the Strike hits, it deals an additional 1d6 damage." → its tail
    // Strike back, extraDamage on a hit.)
    if (new RegExp(String.raw`^A creature within (?:the )?reach of ${its}['’]s? [\w' -]+? successfully damages ${its} with a Strike$`, "i").test(trigger.trim().replace(/\.$/, ""))) {
        const back = /^(?:The )?[^.]+? attempts to Strike with (?:its|their|his|her) ([\w' -]+?)\.(?: If the Strike hits, it deals an additional (\d+d\d+) damage\.)?$/i.exec(effect.trim());
        if (back) return { builtin: "reaction-strike", triggers: ["damaged-adjacent"], strike: back[1].toLowerCase(), penalty: 0, disrupts: false, ...(back[2] ? { extraDamage: back[2] } : {}) };
    }
    // (Batch 103: Avenging Claws — "Trigger A creature within 10 feet damages the feathered bear's ally with a melee attack Effect The
    // feathered bear immediately Steps toward the triggering attacker and makes a claws Strike." → triggers ["ally-damaged"], within, step.)
    const guarded = new RegExp(String.raw`^A creature within (\d+) feet damages ${its}['’]s? ally with a melee (?:attack|Strike)$`, "i").exec(trigger.trim().replace(/\.$/, ""));
    const avenging = guarded ? /^(?:The )?[^.]+? (?:immediately )?Steps toward the triggering (?:attacker|creature) and makes an? ([\w' -]+?) Strike(?: against it)?\.$/i.exec(effect.trim()) : null;
    if (avenging) return { builtin: "reaction-strike", triggers: ["ally-damaged"], strike: avenging[1].toLowerCase(), penalty: 0, disrupts: false, within: Number(guarded[1]), step: true };
    // (Batch 103: Vengeful Throw — "Trigger The marauder takes damage from a creature 20 feet or further away Effect The marauder makes a
    // ranged spear Strike against the triggering creature. This attack doesn't take a range increment penalty if the target is within the
    // second range increment." → triggers ["damaged-far"], from (its least distance), a ranged Strike.)
    const far = /^(?:The )?[^.]+? takes damage from a creature (\d+) feet or (?:further|farther) away$/i.exec(trigger.trim().replace(/\.$/, ""));
    const thrown = far ? /^(?:The )?[^.]+? makes a ranged ([\w' -]+?) Strike against the triggering creature\.(?: This attack doesn't take a range increment penalty if the target is within the second range increment\.)?$/i.exec(effect.trim()) : null;
    if (thrown) return { builtin: "reaction-strike", triggers: ["damaged-far"], strike: thrown[1].toLowerCase(), penalty: 0, disrupts: false, from: Number(far[1]), ranged: true };
    // (Batch 104: Bodyguard's Reprisal — "Trigger A creature attacks the subject of bodyguard's defense Effect The bodyguard makes a Strike
    // against the triggering creature." → triggers ["ally-attacked"], its charge only (the GM's: a note), its best melee Strike.)
    if (/^A creature attacks the subject of (?:the )?[\w' -]+?['’]s? defense$/i.test(trigger.trim().replace(/\.$/, "")) && /^(?:The )?[^.]+? makes a Strike against the triggering creature\.$/i.test(effect.trim())) return { builtin: "reaction-strike", triggers: ["ally-attacked"], strike: null, penalty: 0, disrupts: false, ward: true };
    // (Batch 209, a Battlezoo dragon's guard of whoever it's sworn to protect: as a creature within its distance Strikes that one, its own unarmed melee
    // Strike at the attacker, or +2 AC for the one it guards instead — the Strike (the simulator's pick), the AC a note.)
    const contract = /^A creature within (\d+) feet Strikes a creature (?:the [\w' -]+?|it) (?:has made a contract|is sworn) to protect$/i.exec(trigger.trim().replace(/\.$/, ""));
    // (Batch 216, Warding Strike: "Trigger One of the warden's enemies within 100 feet attacks one of the warden's allies or a person the warden is sworn to
    // protect Effect The warden Strikes the triggering enemy. If the Strike hits, the enemy's attack is deflected, reducing its damage by 8, or by 16 if the
    // warden's Strike was a critical hit." — its Strike at the attacker; the damage it takes off a note.)
    const warding = /^One of (?:the [\w' -]+?['’]s|its) enemies within (\d+) feet attacks one of (?:the [\w' -]+?['’]s|its) allies or a (?:person|creature) (?:the [\w' -]+?|it) is sworn to protect$/i.exec(trigger.trim().replace(/\.$/, ""));
    const deflects = warding ? /^(?:The )?[^.]+? Strikes the triggering enemy\. If the Strike hits, the enemy['’]s attack is deflected, reducing its damage by (\d+), or by (\d+) if (?:the [\w' -]+?['’]s|its) Strike was a critical hit\.$/i.exec(effect.trim()) : null;
    if (deflects) return { builtin: "reaction-strike", triggers: ["ally-attacked"], strike: null, penalty: 0, disrupts: false, note: `At an enemy within ${warding[1]} feet attacking one of its allies; if its Strike hits, that attack deals ${deflects[1]} less damage (${deflects[2]} on a critical hit).` };
    if (contract && /^(?:The )?[^.]+? (?:can choose to either make a melee Strike with an unarmed attack that can reach the triggering attacker, or interpose to protect the contractee, granting a \+2 circumstance (?:bonus )?to AC against the triggering Strike|either makes an unarmed melee Strike at the attacker or gives that creature a \+2 circumstance bonus to AC against the Strike)\.$/i.test(effect.trim())) return { builtin: "reaction-strike", triggers: ["ally-attacked"], strike: null, penalty: 0, disrupts: false, ward: true, melee: true, note: `Only for one it's sworn to protect, at an attacker within ${contract[1]} feet; or, instead, +2 circumstance bonus to that one's AC against the Strike.` };
    // (Batch 207: Repartee Riposte's "Trigger A creature within the cadaverous rake's reach critically fails at a melee Strike against the rake Effect …
    // attempts a Strike against the creature, firing back a witty retort. If this Strike succeeds, the creature is Frightened 1, or Frightened 2 on a
    // critical success." — the Strike, Frightened on a hit; Divine Guardian's "Trigger An ally within the hollow serpent's reach is attacked Effect … The
    // triggering attack targets the hollow serpent instead of the original target." — the ally's attack taken on itself.)
    const repartee = /^A creature within (?:the [\w' -]+?['’]s|its) reach critically fails at a melee Strike against (?:the [\w' -]+?|it|them)$/i.test(trigger.trim().replace(/\.$/, "")) ? /^(?:The )?[^.]+? attempts a Strike against the creature, [^.]+\. If this Strike succeeds, the creature is (Frightened|Sickened|Clumsy|Enfeebled|Stupefied) (\d), or \1 (\d) on a critical success\.$/i.exec(effect.trim()) : null;
    if (repartee) return { builtin: "reaction-strike", triggers: ["critical-miss"], strike: null, penalty: 0, disrupts: false, onHit: { conditions: [{ slug: repartee[1].toLowerCase(), value: Number(repartee[2]) }], critical: [{ slug: repartee[1].toLowerCase(), value: Number(repartee[3]) }] }, note: `On a hit, the creature is ${repartee[1]} ${repartee[2]} (${repartee[1]} ${repartee[3]} on a critical hit).` };
    if (/^An ally within (?:the [\w' -]+?['’]s|its) reach is attacked$/i.test(trigger.trim().replace(/\.$/, "")) && /^(?:The )?[^.]+? interposes [^.]+ between the ally and attacker\. The triggering attack targets (?:the [\w' -]+?|it) instead of the original target\.$/i.test(effect.trim())) return { builtin: "intercept", ward: "ally", share: 1, attacks: true, note: "The attack is aimed at it instead: against its AC, not the ally's." };
    // (Batch 204, Retaliate: "Trigger A creature within the tattoo guardian's reach attacks the guardian's ward Effect The tattoo guardian makes an ink
    // blade Strike against the triggering creature." — its named Strike, its ward played as any ally.)
    const warded = /^A creature within (?:the [\w' -]+?['’]s|its) reach attacks (?:the [\w' -]+?['’]s|its) ward$/i.test(trigger.trim().replace(/\.$/, "")) ? /^(?:The )?[^.]+? makes an? ([\w' -]+?) Strike against the triggering creature\.$/i.exec(effect.trim()) : null;
    if (warded) return { builtin: "reaction-strike", triggers: ["ally-attacked"], strike: warded[1].toLowerCase(), penalty: 0, disrupts: false, ward: true, note: "Only for its ward, at an attacker within its reach." };
    // (Batch 104: Shoot First — "Trigger An attacker the duelist can see targets them with a Strike or spell Requirements The duelist is
    // holding a loaded firearm Effect The duelist makes a firearm Strike against the triggering creature. On a critical hit, they disrupt the
    // triggering action." → triggers ["targeted"], a firearm Strike, disrupts on a critical hit.)
    if (/^An? (?:attacker|creature|foe|enemy) (?:the [\w' -]+? )?(?:can see )?targets (?:them|it|him|her|the [\w' -]+?) with a Strike or spell$/i.test(trigger.trim().replace(/\s*Requirements? .*$/i, "").replace(/\.$/, "")) && /\bRequirements? (?:The )?[^.]+? is holding a loaded firearm\b/i.test(text)) {
        const shot = /^(?:The )?[^.]+? makes a firearm Strike against the triggering creature\.(?: On a critical hit, (?:it|they|he|she) disrupts? the triggering action\.)?$/i.exec(effect.trim());
        if (shot) return { builtin: "reaction-strike", triggers: ["targeted"], strike: "firearm", penalty: 0, disrupts: /critical hit/i.test(effect) ? "critical" : false };
    }
    // (Batch 104: Spell Interception — "Trigger A creature within 10 feet of the mage killer Casts a Spell Effect The mage killer makes a melee
    // Strike or thrown dagger Strike against the triggering creature. If it hits, the spell is disrupted." → triggers ["cast"], its best melee
    // Strike, the spell disrupted on a hit.)
    if (/^A creature within (?:10 feet of|(?:the [\w' -]+?['’]s|its) reach of) (?:the [\w' -]+?|it) Casts a Spell$/i.test(trigger.trim().replace(/\.$/, "")) && /^(?:The )?[^.]+? makes a melee Strike(?: or thrown [\w' -]+? Strike)? against the triggering creature\. If it hits, the spell is disrupted\.$/i.test(effect.trim())) return { builtin: "reaction-strike", triggers: ["cast"], strike: null, penalty: 0, disrupts: true };
    // (Batch 104: Knowing Glance — "Trigger The enigmatic conspiracist is targeted by a melee Strike or touch spell Effect With an uncanny
    // look, the enigmatic conspiracist [[/act demoralize]]{Demoralizes} the creature that targeted them. Demoralize loses the auditory trait
    // and gains the visual trait, and … doesn't take a penalty if the creature doesn't understand their language. If the Intimidation check
    // critically succeeds, … disrupts the triggering action." → its Demoralize at the attacker.)
    // (Batch 150, Warning Growl: "A creature targets the warhound with a melee Strike … Demoralizes the triggering creature and does not take a
    // penalty for not speaking a language. The results of this check occur before resolving the triggering Strike.")
    if (/^(?:The )?[^.]+? is targeted by a melee Strike(?: or touch spell)?$|^A creature targets (?:the [\w' -]+?|it|them) with a melee Strike$/i.test(trigger.trim().replace(/\.$/, ""))) {
        const said = effect.trim().replace(/\[\[\/act ([\w-]+)[^\]]*\]\](?:\{([^}]*)\})?/g, (_all, slug, label) => label ?? slug)
            .replace(/^((?:The )?[\w' -]+? Demoralizes the) triggering creature and does not take a penalty for not speaking a language\. The results of this check occur before resolving the triggering Strike\.$/i, "$1 creature that targeted it.")
            .split(/(?<=\.)\s+(?=[A-Z])/);
        const glance = /^(?:With [^,]+, )?(?:the [\w' -]+?|it|they) Demoralizes the creature that targeted (?:it|them|him|her)\.$/i.test(said[0] ?? "");
        const rest = said.slice(1).every((sentence) => /^Demoralize loses the auditory trait and gains the visual trait\b[^.]*\.$|^If the Intimidation check critically succeeds, [^.]*disrupts? the triggering action\.$/i.test(sentence));
        if (glance && rest) return { builtin: "reaction-strike", triggers: ["attacked"], strike: null, skill: "demoralize", penalty: 0, disrupts: false, melee: true };
    }
    // (Batch 236, Swift Claw: "Trigger The athach hits a creature with two fist Strikes Effect The athach makes a claw Strike with no multiple attack penalty
    // against the creature it hit with its fist Strikes. This claw attack does not increase the athach's multiple attack penalty." — its claw at that
    // creature after the second fist hit this turn, outside its multiple attack penalty: triggers ["two-hits"], after (the Strike that hit).)
    const pair = /^(?:The )?[^.]+? hits a creature with two ([\w' -]+?) Strikes$/i.exec(trigger.trim().replace(/\.$/, ""));
    const swift = pair ? /^(?:The )?[^.]+? makes an? ([\w' -]+?) Strike with no multiple attack penalty against the creature (?:it|they) hit with (?:its|their) [\w' -]+? Strikes\.(?: This [\w' -]+? attack does not increase (?:the [\w' -]+?['’]s|its|their) multiple attack penalty\.)?$/i.exec(effect.trim()) : null;
    if (swift) return { builtin: "reaction-strike", triggers: ["two-hits"], strike: swift[1].toLowerCase(), after: pair[1].toLowerCase(), penalty: 0, disrupts: false };
    // (Batch 228, Battlezoo: a Strike at it in its reach answered with its own Strike first, its AC lower against the triggering Strike — selfAcPenalty; a
    // later use only after another of its abilities, a note.)
    if (/^A creature within (?:the [\w' -]+?['’]s|its) reach makes a Strike against (?:it|them|the [\w' -]+?),?$|^A creature (?:within|in) (?:the [\w' -]+?['’]s|its) reach Strikes at (?:it|them)$/i.test(trigger.trim().replace(/\.$/, ""))) {
        const lunge = /^(?:The )?[^.]+? (?:takes a [–-](\d+) circumstance penalty to (?:its|their) AC against the triggering Strike and then|lowers (?:its|their) guard by (\d+) for that Strike, then) makes an? ([\w' -]+?) Strike against the (?:attacking|triggering) creature\.( (?:The )?[^.]+? can(?:'t|not) use [A-Z][\w' -]+? again until (?:it|they) uses? ([A-Z][\w' -]+?)\.)?$/i.exec(effect.trim());
        if (lunge) lunge.splice(1, 2, lunge[1] ?? lunge[2]);
        if (lunge) return { builtin: "reaction-strike", triggers: ["attacked"], strike: lunge[2].toLowerCase(), penalty: 0, disrupts: false, melee: true, selfAcPenalty: Number(lunge[1]), note: `Its AC is ${lunge[1]} lower against the triggering Strike.${lunge[4] ? ` Not again until it uses ${lunge[4]}.` : ""}` };
    }
    // (Batch 228, Battlezoo: another of its kind hitting a foe in its reach with a named Strike, its own Strike of that name at the same foe — kin,
    // allyStrike; one answer to a Strike, and its Strike sets off no other.)
    const duo = /^Another ([\w' -]+?) (?:succeeds on|hits with) an? ([\w' -]+?) Strike against an enemy within this \1['’]s reach$/i.exec(trigger.trim().replace(/\.$/, ""))
        ?? /^Another ([\w' -]+?)['’]s ([\w' -]+?) Strike hits a (?:foe|enemy) in this \1['’]s reach$/i.exec(trigger.trim().replace(/\.$/, ""));
    const duoStrike = duo ? new RegExp(String.raw`^(?:The )?[^.]+? makes an? ${duo[2]} Strike against the same (?:enemy|foe|creature)\.( Only one [^.]+ can use [A-Z][\w' -]+? from a single triggering [\w' -]+? Strike, and the [\w' -]+? Strike made with [A-Z][\w' -]+? can(?:'t|not) trigger any additional [^.]+ reactions\.)?$`, "i").exec(effect.trim()) : null;
    if (duoStrike) return { builtin: "reaction-strike", triggers: ["ally-hit"], strike: duo[2].toLowerCase(), penalty: 0, disrupts: false, kin: true, allyStrike: duo[2].toLowerCase(), note: `Only after another ${duo[1]}'s ${duo[2]} Strike hits. One answer to that Strike, and this Strike sets off no other.` };
    // (Batch 227, Battlezoo: a ranged attack at it answered with a Demoralize at the attacker; that Demoralize's immunity neither stops it nor follows
    // from it, a note — rangedAttack: only a ranged attack.)
    if (/^(?:The )?[^.]+? is the target of a ranged attack$/i.test(trigger.trim().replace(/\.$/, ""))) {
        const said = effect.trim().replace(/\[\[\/act ([\w-]+)[^\]]*\]\](?:\{([^}]*)\})?/g, (_all, slug, label) => label ?? slug).split(/(?<=\.)\s+(?=[A-Z])/);
        const scare = /^(?:The )?[^.]+? (?:attempts to Demoralize|Demoralizes) the (?:attacking|triggering) creature\.$/i.test(said[0] ?? "");
        const immune = said.slice(1).every((sentence) => /^This ignores any temporary immunity [^.]+ and (?:doesn't|does not) make (?:them|it) temporarily immune to Demoralize\.$|^Immunity to (?:its|this) Demoralize neither stops it nor follows from it\.$/i.test(sentence));
        if (scare && immune) return { builtin: "reaction-strike", triggers: ["attacked"], strike: null, skill: "demoralize", penalty: 0, disrupts: false, rangedAttack: true, ...(said.length > 1 ? { note: "Temporary immunity to its Demoralize neither stops this nor follows from it." } : {}) };
    }
    const more = readMoreReactionStrikes(trigger.trim().replace(/\.$/, ""), effect.trim());
    if (more) return more;
    // (Superconductor's first sentence only tells it; batch 63's first sentences too.)
    const told = effect.trim().split(/(?<=\.)\s+(?=[A-Z])/);
    const lastOnly = answered === "targeted" || (told.length > 1 && told.slice(0, -1).every((sentence) => !/\d|@|\b(?:damage|save|check|bonus|penalty|Strikes?|Grab\w*|Prone|Hit Points|condition)\b/i.test(sentence)));
    // (Batch 63: the Strike rolled twice, the better kept, a fortune effect → fortune.)
    const backAt = answered ? /^(?:The )?[^.]+? (?:makes|attempts) an? ([\w' -]+?) Strike (?:at|against) (?:the (?:triggering )?creature|that creature|the attacker)(, regardless of range)?(, rolling the attack roll twice and taking the better result; this is a fortune effect)?\.$/i.exec(lastOnly ? told.at(-1) : effect.trim()) : null;
    if (backAt && (answered === "targeted") === Boolean(backAt[2])) return { builtin: "reaction-strike", triggers: [answered], strike: backAt[1].toLowerCase(), penalty: 0, disrupts: false, ...(backAt[3] ? { fortune: true } : {}) };
    // (Batch 94: a Strike with no weapon named — "makes a Strike against the triggering creature", "attempts a Strike against …", "Strikes the
    // triggering creature": its best melee Strike, B90's.)
    if (answered === "ally-hit" && /^(?:The )?[^.]+? (?:(?:makes|attempts) a Strike against|Strikes) the triggering creature\.$/i.test(effect.trim())) return { builtin: "reaction-strike", triggers: [answered], strike: null, penalty: 0, disrupts: false };
    // (Batch 88: a basic maneuver back in place of the Strike — Ripping Disarm's "Trigger A creature rolls a critical failure on a melee
    // weapon Strike against the Tree that Weeps Effect … attempts to Disarm the creature.", Bully's Push's "… misses the thug with a melee
    // Strike … attempts to Shove the triggering creature at a -2 penalty", Absorb Weapon's "A creature hits the omox with a melee weapon",
    // Unholy Rebuke's "takes damage from a melee attack … attempts to Demoralize the triggering creature", Snagging Catch's "is attacked by
    // a melee weapon … attempts to Disarm the triggering weapon, gaining a +1 circumstance bonus" → { builtin: "reaction-strike", triggers,
    // skill, penalty }. Sentences after it with no numbers of their own (a weapon kept, the creature not Strided after) are the GM's.)
    const skillTrigger = answered ?? [
        [new RegExp(String.raw`^A creature (?:hits ${its} with a melee (?:weapon|Strike|attack)|(?:within ${reachOf} )?hits ${its} with a melee (?:weapon )?Strike)$|^(?:The )?[^.]+? is hit by a melee attack$`, "i"), "hit"],
        [new RegExp(String.raw`^A creature (?:rolls a critical failure on a (?:melee )?(?:weapon )?Strike against|critically fails an? (?:melee )?(?:weapon )?Strike against) ${its}$`, "i"), "critical-miss"],
        [new RegExp(String.raw`^(?:A creature|An adjacent enemy|A creature within ${reachOf}) misses ${its} with (?:an? )?melee (?:weapon )?(?:Strike|attack)$|^A creature makes a melee (?:weapon )?Strike against ${its} and misses$`, "i"), "missed"],
        [new RegExp(String.raw`^(?:The )?[^.]+? is attacked by a melee weapon$`, "i"), "attacked"],
        [new RegExp(String.raw`^(?:The )?[^.]+? takes damage from (?:a melee attack|an adjacent creature)$`, "i"), "damaged-adjacent"]
    ].find(([pattern]) => pattern.test(trigger.trim().replace(/\.$/, "")))?.[1];
    // (Batch 156, Snagging Catch: "Requirements The disciple has their crimson cloak raised" — a state the GM checks: requires, a note.)
    const skillRequired = /\bRequirements? (.+?)\.? (?=Trigger\b|Effect\b)/.exec(text)?.[1] ?? null;
    if (skillTrigger && (!/\bRequirements?\b/.test(text) || (skillRequired && !/\d|@/.test(skillRequired)))) {
        const plain = effect.trim().replace(/\[\[\/act ([\w-]+)[^\]]*\]\](?:\{([^}]*)\})?/g, (_all, slug, label) => label ?? slug.replace(/^\w/, (letter) => letter.toUpperCase()));
        const said = plain.split(/(?<=\.)\s+(?=[A-Z])/);
        const at = said.findIndex((sentence) => /\battempts? (?:an Athletics check )?to (?:Disarm|Shove|Trip|Grapple|Demoralize)\b/.test(sentence));
        const move = at >= 0 ? /^(?:After the attack's result is resolved, )?(?:The )?(?:(?!\bStrikes?\b)[^.])+? (?:promises [^.]+? and )?(?:attempts? (?:an Athletics check )?to) (Disarm|Shove|Trip|Grapple|Demoralize) (?:the (?:triggering (?:creature|weapon)|creature(?: that (?:hit|damaged) it)?|attacker(?: of the triggering weapon)?|weapon used in the triggering Strike)|them|it)(?: (?:at|with) an? [-\u2013\u2212](\d+) (?:circumstance )?penalty)?(?:, gaining an? \+(\d+) circumstance bonus)?\.$/i.exec(said[at]) : null;
        const rest = said.filter((_sentence, index) => index !== at);
        const CONDITIONS_SAID = /\b(?:Prone|Grabbed|Restrained|Immobilized|Frightened|Off-Guard|Stunned|Slowed|Sickened|Clumsy|Enfeebled|Dazzled|Blinded|Deafened|Fleeing|Confused|Paralyzed)\b/i;
        const quietRest = rest.every((sentence) => !/\d|@|\b(?:damage|save|Strikes?|bonus|penalty|Hit Points)\b/i.test(sentence) && !CONDITIONS_SAID.test(sentence));
        if (move && quietRest) {
            const once = rest.some((sentence) => /\bis destroyed after this action\b/i.test(sentence));
            return { builtin: "reaction-strike", triggers: [skillTrigger], strike: null, skill: move[1].toLowerCase(), penalty: Number(move[2]) || 0, ...(move[3] ? { bonus: Number(move[3]) } : {}), disrupts: false, ...(once ? { uses: 1 } : {}), ...(skillRequired ? { requires: "requirement", note: `Only when: ${skillRequired.replace(/^The /, "the ")}.` } : {}) };
        }
    }
    // Telekinetic Defense, Wing Rebuff (batch 54): "Trigger A creature approaches within 10 feet of the poltergeist", "A creature moves from
    // beyond the reach of the roc's wing to within the reach of the roc's wing", "A creature moves into the reach of the frost roc's wing";
    // "Effect The poltergeist makes a telekinetic object Strike against the triggering creature." (and "If the roc Pushes the creature, it
    // disrupts the triggering move action.") → a reaction Strike as a creature comes near.
    // (Batch 218, a Battlezoo booth's snapping jaws: a creature moving into its space, a first sentence that only tells it.)
    const near = /^An? creature (?:approaches within (\d+) feet of (?:the [\w' -]+?|it)|moves (?:from beyond the reach of (?:the [\w' -]+?'s|its) [\w' -]+? to within the reach of (?:the [\w' -]+?'s|its) [\w' -]+?|into the reach of (?:the [\w' -]+?'s|its) [\w' -]+?|into (?:the [\w' -]+?['’]s|its) space))\.?;?$/i.exec(trigger.trim());
    const answer = near ? /^(?:(?:The )?[^.]+?\. )?(?:The |It )?[^.]*?makes an? ([\w' -]+?) Strike against the triggering creature\.( If (?:the [\w' -]+?|it) Pushes the creature, it disrupts the triggering move action\.)?$/i.exec(effect.trim()) : null;
    if (answer) return { builtin: "reaction-strike", triggers: ["approach"], strike: answer[1].toLowerCase(), penalty: 0, disrupts: Boolean(answer[2]), ...(near[1] ? { within: Number(near[1]) } : {}) };
    // A failed save made better (batch 53): Golden Luck, "Trigger The gold dragon fails a saving throw Effect The dragon improves its result
    // by one degree of success, turning a failure into a success or a critical failure into a normal failure. The dragon can't use this
    // ability again for 1d4 rounds." (its own); Word of Wisdom, "Trigger An ally within 60 feet fails a saving throw Effect The ally
    // improves its result by one degree …" (an ally's); Cat's Luck, "Trigger … fails or critically fails a Reflex saving throw Effect …
    // rerolls the saving throw and takes the better result" (once a day).
    const improves = String.raw`improves (?:its|his|her|their) result by one degree of success, turning a failure into a success or a critical failure into a normal failure\.`;
    const again = String.raw`(?: (?:The )?[^.]+? can't use this ability again for (?:\[\[\/gmr (\d+d\d+)[^\]]*\]\](?:\{[^}]*\})?|(\d+d\d+) rounds)\.)?`;
    const ally = /^An? ally within (\d+) feet fails a saving throw\.?$/i.exec(trigger.trim());
    const helped = ally ? new RegExp(String.raw`^The ally ${improves}${again}$`, "i").exec(effect.trim()) : null;
    if (helped) return { builtin: "save-boost", ally: true, within: Number(ally[1]), ...(helped[1] ?? helped[2] ? { recharge: helped[1] ?? helped[2] } : {}) };
    // (Batch 226, Light of Diligence: "Trigger A willing ally within 15 feet critically fails at a check Effect The ally gets a failure instead and becomes
    // immune to Light of Diligence for 1 minute." — an ally's critically failed save made a failure, each ally once a fight; another check the GM's.)
    const willing = /^An? (?:willing )?ally within (\d+) feet critically fails (?:at )?a check\.?$/i.exec(trigger.trim());
    if (willing && /^The ally gets a failure instead and becomes immune to [A-Z][\w' -]+? for 1 minute\.$/.test(effect.trim())) {
        return { builtin: "save-boost", ally: true, within: Number(willing[1]), criticalOnly: true, perAlly: true, notes: ["Also a critically failed attack roll or skill check (the GM's). Each ally only once a minute."] };
    }
    const own = !ally && /^(?:The )?[^.]+? fails a saving throw\.?$/i.test(trigger.trim()) ? new RegExp(String.raw`^(?:The )?[^.]+? ${improves}${again}$`, "i").exec(effect.trim()) : null;
    if (own) return { builtin: "save-boost", ...(own[1] ?? own[2] ? { recharge: own[1] ?? own[2] } : {}) };
    // Batch 65, more wordings of its own failed save: "fails a save" (any save), "… a skill check or a saving throw" (the save's part),
    // "… a check" (a save among them), "critically fails a saving throw"; its effect a reroll keeping the better ("rerolls the save and
    // uses the better result") or the new one ("rerolls the triggering check, but she must use the new result, even if it's worse"), one
    // degree better ("The result of the saving throw is improved one degree. … can't Fortune's Friend for 1d4 rounds.", "treats a
    // critical failure as a failure, or a failure as a success"), or only a critical failure made a failure ("The critical failure becomes
    // a normal failure"). A frequency of once a day, a minute or an hour: one use a fight. A first sentence that only tells it is left out.
    // (Batch 169, Flash of Insight: "Frequency once per day Trigger The cyclops is about to roll a d20. Effect The cyclops peers into an occluded
    // spectrum of possible futures. It gets a success (but not a critical success) on the roll instead of rolling." → its failed save made a
    // success, once a day (save-boost toSuccess); any other d20 roll, the GM's.)
    if (/^(?:The )?[^.]+? is about to roll a d20\.?$/i.test(trigger.trim().replace(/\s*Frequency once per (?:day|minute|hour)\.?$/i, ""))) {
        const said = effect.trim().split(/(?<=\.)\s+(?=[A-Z])/);
        const flavour = said.slice(0, -1).every((sentence) => !/\d|@|\b(?:saves?|saving throws?|checks?|rolls?|results?|failure|success|damage|bonus|penalty)\b/i.test(sentence));
        if (said.length <= 2 && flavour && /^(?:The )?[\w' -]+? gets? a success \(but not a critical success\) (?:on the roll instead of rolling|instead of rolling|without rolling)\.$/i.test(said.at(-1))) {
            return { builtin: "save-boost", toSuccess: true, ...(/\bFrequency once per (?:day|minute|hour)\b/i.test(text) ? { uses: 1 } : {}), ...(item?.system?.actionType?.value === "free" ? { free: true } : {}), notes: ["Or a success on another d20 roll it's about to make, instead of rolling (the GM's)."] };
        }
    }
    const ownSave = /^(?:The )?[^.]+? (critically fails|fails or critically fails|fails) (?:a save|a saving throw|a skill check or a saving throw|a check)\.?$/i.exec(trigger.trim().replace(/\s*Frequency once per (?:day|minute|hour)\.?$/i, ""));
    if (ownSave && !/^An? (?:ally|creature|foe|enemy)\b/i.test(trigger.trim())) {
        const rolled = effect.trim().replace(/\[\[\/\w+ ([^\]#]+?)(?: #[^\]]*)?\]\](?:\{([^}]*)\})?/g, (_all, roll, label) => label ?? roll);
        const said = rolled.split(/(?<=\.)\s+(?=[A-Z])/);
        const plain = said.length > 1 && !/\d|\b(?:save|saving throw|check|reroll\w*|result|failure|success)\b/i.test(said[0]) ? said.slice(1).join(" ") : rolled;
        const once = /\bFrequency once per (?:day|minute|hour)\b/i.test(text) ? { uses: 1 } : {};
        const free = item?.system?.actionType?.value === "free" ? { free: true } : {};
        const wait = /\bcan(?:'t|not) (?:use )?[\w' -]+? (?:again )?for (\d+d\d+) rounds\.$/i.exec(plain)?.[1];
        if (/^(?:The )?[^.]+? rerolls (?:the|that|its) (?:saving throw|save|triggering check)(?: and (?:takes|uses) the better result)\.$/i.test(plain) && ownSave[1].toLowerCase() !== "critically fails") return { builtin: "save-reroll", save: null, ...once, ...free };
        // (Batch 226, Prescient Revision: "… rerolls the triggering check and takes the better result. For 1d4 rounds, it loses the effects of Kiss of the
        // Speakers and can't use Reshape Reality." — what it gives up after, a note.)
        const cost = /^((?:The )?[^.]+? rerolls (?:the|that|its) (?:saving throw|save|triggering check) and (?:takes|uses) the better result\.) (For (?:\d+d\d+|\d+) rounds, (?:it|they) loses? the effects of [A-Z][\w' -]+? and can(?:'t|not) use [A-Z][\w' -]+?\.)$/.exec(plain);
        if (cost && ownSave[1].toLowerCase() !== "critically fails") return { builtin: "save-reroll", save: null, ...once, ...free, notes: [cost[2]] };
        // (Batch 84, Reroll: "Cost 1 Mythic Point Trigger The ancient one fails a check Effect The ancient one rerolls the check." — a plain
        // reroll keeps the new result; its cost a Mythic Point.)
        const mythic = /\bCost 1 Mythic Point\b/i.test(text) ? { mythic: true } : {};
        if (/^(?:The )?[^.]+? rerolls (?:the|that|its) (?:saving throw|save|triggering check|check)(?:,? but (?:it|they|he|she) must use the new result, even if it's worse|,? and must (?:use|take) the new result)?\.$/i.test(plain)) return { builtin: "save-reroll", save: null, keep: "new", ...once, ...free, ...mythic };
        if (/^The result of the saving throw is improved (?:by )?one degree\.(?: (?:The )?[^.]+? can(?:'t|not) [\w' -]+? for \d+d\d+ rounds\.)?$|^(?:The )?[^.]+? treats a critical failure as a failure,? or a failure as a success\.$/i.test(plain)) return { builtin: "save-boost", ...(wait ? { recharge: wait } : {}), ...once, ...free };
        if (ownSave[1].toLowerCase() === "critically fails" && /^The critical failure becomes a (?:normal )?failure\.$/i.test(plain)) return { builtin: "save-boost", criticalOnly: true, ...free };
    }
    // (Batch 133, Gardener's Resolve: "Trigger The worm prophet rolls a failure (but not a critical failure) on a Will save against an effect with the
    // mental or fear trait Requirements … features are obscured by a mask or hood Effect The worm prophet takes 3d8 mental damage, and the saving
    // throw is a success." → its failed save (only a failure, that save, those traits) made a success, the damage on itself; the mask the GM's.)
    const resolve = /\bTrigger (?:The )?[^.]+? rolls a failure \(but not a critical failure\) on an? (Fortitude|Reflex|Will) save against an effect with the (\w+)(?: or (\w+))? trait(?: Requirements? (?:The )?[^.]+? features are obscured by a mask or hood)? Effect (?:The )?[^.]+? takes (@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?) damage, and the saving throw is a success\.$/i.exec(String(text).trim());
    if (resolve) return { builtin: "save-boost", failureOnly: true, save: resolve[1].toLowerCase(), against: [resolve[2], resolve[3]].filter(Boolean).map((trait) => trait.toLowerCase()), selfDamage: readDamage(inlineTags(resolve[4], "Damage")[0]), ...(/\bmask or hood\b/i.test(text) ? { notes: ["Only while its features are obscured by a mask or hood."] } : {}) };
    // (Batch 217: a Battlezoo owl's foresight against spells — two rolls for its save against a spell, the higher kept: played as a reroll of a failed
    // save against a spell; a Battlezoo drake's hardened scales — its failed save of one kind a degree better, once a minute (once a fight), its AC and
    // Speed for a few rounds a note.)
    if (/^(?:The )?[^.]+? (?:would make|is about to make) a saving throw against a spell(?: effect)?\.?$/i.test(trigger.trim()) && /^(?:The )?[^.]+? rolls twice and uses the higher result\.$/i.test(effect.trim())) return { builtin: "save-reroll", save: null, against: "spell" };
    const hardens = /^(?:The )?[^.]+? fails an? (Fortitude|Reflex|Will) save\.?$/i.exec(trigger.trim().replace(/;$/, ""));
    const improved = hardens ? /^(?:The )?[^.]+? improves (?:the result of its save|its save) by (?:one|a) degree(?:, turning a failure into a success or a critical failure into a failure)?\.((?: [^.]+\.)*)$/i.exec(effect.trim().replace(/\[\[\/\w+ ([^\]#]+?)(?: #[^\]]*)?\]\](?:\{([^}]*)\})?/g, (_all, roll, label) => label ?? roll).replace(/\s*@(?:Compendium|UUID)\[[^\]]*\](?:\{[^}]*\})?\s*$/, "").replace(/\s*Effect: [\w' -]+$/, "")) : null;
    if (improved && (!improved[1].trim() || /^For the next \d+d\d+ rounds, [^.]+\.$/i.test(improved[1].trim()))) return { builtin: "save-boost", save: hardens[1].toLowerCase(), ...(/\bFrequency once per (?:minute|hour|day)\b/i.test(text) ? { uses: 1 } : {}), ...(improved[1].trim() ? { notes: [improved[1].trim()] } : {}) };
    const luck = /^(?:The )?[^.]+? fails or critically fails an? (Fortitude|Reflex|Will) saving throw\.?(?: Frequency once per day\.?)?$/i.exec(trigger.trim());
    if (luck && /^(?:(?:The )?[^.]+? rerolls (?:the|that) (?:saving throw|save) and takes the better result|Reroll that saving throw and take the better result)\.$/i.test(effect.trim())) return { builtin: "save-reroll", save: luck[1].toLowerCase() };
    // A trap that summons a creature (batch 50; the user's choice: the GM's): "Effect The trap summons a Cockatrice. The cockatrice rolls
    // initiative and remains for 2d6 rounds; …".
    if (/^(?:The|This) trap summons\b[^.]*\.\s+(?:The [\w' -]+?|It) rolls initiative and remains for\b/i.test(effect.trim())) return { builtin: "no-effect" };
    // (Batch 89: "This trap summons a specific level -1 creature, determined when the trap is created. The squares above … summon … The
    // creature rolls initiative and remains for …".)
    if (/^(?:The|This) trap summons\b/i.test(effect.trim()) && /\brolls initiative and remains for\b/i.test(effect)) return { builtin: "no-effect" };
    // Shake It Off, Slough Skin (batch 49; the user's choice): "Trigger The purple worm would be affected by a condition or adverse effect
    // (such as Cursed Metamorphosis) Effect The purple worm negates the triggering condition or effect. Effects from artifacts, deities, or
    // a similarly powerful source can't be avoided in this way." → { builtin: "negate-condition" }; Dogged Persistence's "would be affected
    // by the Immobilized, Paralyzed, Slowed, or Stunned conditions, or by an effect that would give it a penalty to its Speeds, …" →
    // those conditions only.
    // (Its labels by their capital: "adverse effect (such as …)" isn't the Effect.)
    // (Batch 226, Fearless Rush: "Trigger The karkadann becomes Frightened Effect The karkadann reduces their frightened value by 1 (to a minimum of 0). The
    // karkadann then Strides toward an enemy." — the condition 1 lower as it lands, then a Stride toward a foe: { conditions, reduceBy, stride }.)
    if (/^(?:The )?[^.]+? becomes Frightened\.?$/.test(trigger.trim()) && /^(?:The )?[^.]+? reduces (?:its|their) frightened value by 1 \(to a minimum of 0\)\. (?:The )?[^.]+? then Strides toward an enemy\.$/i.test(effect.trim())) {
        return { builtin: "negate-condition", conditions: ["frightened"], reduceBy: 1, stride: "toward" };
    }
    const labeled = /\bTrigger (.+?) Effect (?=[A-Z])(.+)$/.exec(text);
    const negates = labeled ? /^(?:The )?[^.]+? would be affected by (?:a condition or adverse effect(?: \([^)]*\))?|the ([\w, ]+?) conditions?(?:, or by an effect that would give it a penalty to its Speeds)?(?:, from a source of \d+(?:st|nd|rd|th) level or less)?)\.?$/i.exec(labeled[1].trim()) : null;
    if (negates && /^(?:The )?[^.]+? negates the triggering condition or effect(?: by [^.]+)?\.(?: Effects from artifacts, deities, or a similarly powerful source can't be avoided in this way\.)?$/i.test(labeled[2].trim())) {
        const conditions = negates[1] ? negates[1].split(/,\s*(?:or\s+)?|\s+or\s+/).map((word) => word.trim().toLowerCase()).filter(Boolean) : null;
        return { builtin: "negate-condition", ...(conditions ? { conditions } : {}) };
    }
    // (Batch 216: Dramatic Death's ruse ("falls Prone and dramatically announces their death. They appear to have died. …" — the GM's, as Feign Death);
    // Live to Tell the Tale's "instead falls Unconscious for 1d4 hours or until they regain 1 Hit Point" (out of the fight as at 0 HP); The Jig Is Up's
    // Stride after a failed Deception or Performance; Zealous Rush's Stride after a spell on itself — moves.)
    if (/^(?:The )?[^.]+? takes any damage\.?$/i.test(trigger.trim()) && /^(?:The )?[^.]+? falls Prone and dramatically announces (?:its|their|his|her) death\. (?:It|They|He|She) appears? to have died\./i.test(effect.trim())) return { builtin: "no-effect" };
    if (/^(?:The )?[^.]+? would gain the Dying condition\.?$/i.test(trigger.trim()) && /^(?:The )?[^.]+? instead falls Unconscious for [^.]*?(?:hours?|minutes?)[^.]*? or until (?:it|they|he|she) regains? 1 Hit Point\.$/i.test(effect.trim().replace(/\[\[\/\w+ [^\]]*\]\]\{([^}]*)\}/g, "$1"))) return { builtin: "no-effect" };
    if (/^(?:The )?[^.]+? critically fails a (?:Deception|Performance|Diplomacy)(?: or (?:Deception|Performance|Diplomacy))? check\.?$/i.test(trigger.trim()) && /^(?:The )?[^.]+? Strides\.$/i.test(effect.trim())) return { builtin: "no-effect" };
    if (/^(?:The )?[^.]+? casts a spell that takes 1 or more actions and affects only (?:it|them|him|her|itself|themself)\.?$/i.test(trigger.trim()) && /^(?:The )?[^.]+? Strides up to \d+ feet, or up to (?:its|their|his|her) full Speed if the triggering spell took 2 actions or more to cast\.$/i.test(effect.trim())) return { builtin: "no-effect" };
    // (Batch 218, Battlezoo: a flight toward a spell's caster as it's targeted — a move; damage from a physical attack cut by some, a Step and cold back
    // at an adjacent attacker — resistance to that attack's physical damage, the rest notes.)
    if (/^(?:The )?[^.]+? is targeted by a spell\.?$/i.test(trigger.trim()) && /^(?:The )?[^.]+? Flies \d+ feet toward the caster\.$/i.test(effect.trim())) return { builtin: "no-effect" };
    const clone = /^(?:The )?[^.]+? takes damage from a physical attack\.?$/i.test(trigger.trim()) ? /^The damage is reduced by (\d+) and (?:the [\w' -]+?|it) can immediately Step\.(?: (?:If the attack was a melee Strike made from an adjacent square, the attacker|An adjacent melee attacker) takes (@Damage\[(?:[^[\]]|\[[^\]]*\])*\])(?:\{[^}]*\})? damage\.)?$/i.exec(effect.trim()) : null;
    if (clone) return { builtin: "resist-damage", value: Number(clone[1]), on: ["physical"], types: null, attack: true, note: `Then it can Step.${clone[2] ? ` An adjacent attacker's melee Strike: that attacker takes ${/^@Damage\[\(?([^\[\]()]+)\)?(?:\[(\w+)\])?\]/.exec(clone[2])?.slice(1).filter(Boolean).join(" ")} damage.` : ""}` };
    // (Batch 214, Rally: "Trigger The thrall ends their turn more than 30 feet away from their master Effect The thrall Strides up to their Speed toward
    // their master." — a move back to its master, which the simulator doesn't place.)
    if (/^(?:The )?[^.]+? ends (?:its|their) turn more than \d+ feet away from (?:its|their) master\.?$/i.test(trigger.trim()) && /^(?:The )?[^.]+? Strides up to (?:its|their) Speed toward (?:its|their) master\.$/i.test(effect.trim())) return { builtin: "no-effect" };
    // Spurred by Death (batch 47): "Trigger An ally within 30 feet reduces a creature to 0 HP Effect The burnbearer Steps or Strides.": a
    // move, nothing for the fight's numbers.
    if (/^An? ally within \d+ feet reduces a creature to 0 (?:HP|Hit Points)\.?$/i.test(trigger.trim()) && /^(?:The )?[^.]+? Steps or Strides\.$/i.test(effect.trim())) return { builtin: "no-effect" };
    // Feign Death (batch 44; the GM's, as other ruses): "Trigger The opossum is reduced below 15 HP Effect The opossum collapses. It is
    // Off-Guard and can use actions that require only its mind, but any other action ends the ruse. A successful … check to Seek or …
    // to Recall Knowledge is required to determine that the animal is not, in fact, dead."
    if (/^(?:The )?[^.]+? is reduced below \d+ (?:HP|Hit Points)\.?$/i.test(trigger.trim()) && /^(?:The )?[^.]+? collapses\. (?:It|They|He|She) (?:is|are) Off-Guard and can use actions that require only (?:its|their|his|her) mind, but any other action ends the ruse\./i.test(effect.trim())) return { builtin: "no-effect" };
    // Mist Escape (batch 40): at 0 Hit Points it goes to its coffin as mist: out of the fight, as the simulation already has it.
    if (/^(?:The )?[^.]+? is reduced to 0 (?:HP|Hit Points)\.?$/i.test(trigger.trim()) && /^(?:The )?[^.]+? uses Turn to Mist\. [^.]*\bcoffin\b/i.test(effect.trim())) return { builtin: "no-effect" };
    // (Batch 196, Dying Wish: "The dragon wishes to survive by any means necessary. The dragon is instead reduced to 1 Hit Point and teleports up to 10
    // miles away." — out of the fight as well, at 1 HP.)
    if (/^(?:The )?[^.]+? is reduced to 0 (?:HP|Hit Points)\.?$/i.test(trigger.trim()) && /^(?:[^.]+\. )?(?:The )?[^.]+? is instead reduced to 1 (?:HP|Hit Point) and teleports up to \d+ miles away\.$/i.test(effect.trim().replace(/\s*Effect: [^.]+$/i, ""))) return { builtin: "no-effect" };
    const ac = (item?.system?.rules ?? []).find((rule) => rule?.key === "FlatModifier" && [].concat(rule.selector).includes("ac") && Number.isFinite(Number(rule.value)));
    // (Batch 122: "a +2 circumstance bonus to their Armor Class against the triggering attack" too.)
    if (ac && /\b(?:AC|Armor Class) against the triggering attack\b/i.test(effect) && /\b(?:targets?|targeted|is hit|critically hit)\b/i.test(trigger)) {
        // (Batch 157, Shadow Veil: "targeted by a melee attack" — melee only.)
        const melee = /\bmelee\b/i.test(trigger);
        const ranged = /\branged\b/i.test(trigger);
        // (Batch 158, Leap Away: a move with it — a note for the GM.)
        const moves = /\b(?:Leaps|Steps|Strides)\b/.test(effect) ? [effect.trim().replace(/\s*\bEffect: [^.]+$/, "")] : [];
        return { builtin: "ac-reaction", value: Number(ac.value), when: /\bis hit\b|\bcritically hit\b/i.test(trigger) ? "hit" : "targeted", ...(melee !== ranged ? { against: melee ? "melee" : "ranged" } : {}), ...(moves.length ? { notes: moves } : {}) };
    }
    // Distracting Whisper (batch 58): "Trigger The dragon is targeted with an attack Effect A mysterious voice whispers something
    // disconcerting in the triggering creature's ear, inflicting a –2 circumstance penalty to the triggering attack." → as +2 AC against it.
    const whisper = /^(?:The )?[^.]+? is targeted (?:with|by) an attack\.?$/i.test(trigger.trim()) ? /\binflicting an? [–-](\d+) circumstance penalty to the triggering attack\.(?:\s*Effect: [\w' -]+)?$/i.exec(effect.trim()) : null;
    if (whisper) return { builtin: "ac-reaction", value: Number(whisper[1]), when: "targeted" };
    const dodge = acDodge(text, trigger, effect);
    if (dodge) return dodge;
    if (/\btargeted by an attack\b/i.test(trigger) && /rolls the triggering attack twice and uses the worse result/i.test(effect)) return { builtin: "attack-misfortune" };
    // (Batch 217, a Battlezoo owl's foresight: as it's the target of an attack, the attacker rolls twice and keeps the lower.)
    if (/^(?:The )?[^.]+? is the target of an attack\.?$/i.test(trigger.trim()) && /^The attacking creature must roll twice and use the lower result\.$|^The attacker rolls twice and takes the lower result\.$/i.test(effect.trim())) return { builtin: "attack-misfortune" };
    // (Batch 193, Ray Displacement: "Trigger The dragon is targeted with a ranged spell attack Effect The dragon creates a field of distorted space
    // between themself and the caster. The creature targeting the barrage dragon must roll the spell attack twice and take the worse result." —
    // only a ranged spell attack's.)
    if (/^(?:The )?[^.]+? is targeted (?:with|by) a ranged spell attack\.?$/i.test(trigger.trim())) {
        const said = effect.trim().replace(/\s*Effect: [\w' -]+$/, "").split(/(?<=\.)\s+(?=[A-Z])/);
        const twice = /^The (?:creature|caster) targeting (?:the [\w' -]+?|it|them) must roll the spell attack twice and take the worse result\.$/i.test(said.at(-1) ?? "");
        if (twice && said.slice(0, -1).every((sentence) => !/\d|@|\b(?:damage|bonus|penalty|Strikes?|saves?)\b/i.test(sentence))) return { builtin: "attack-misfortune", spell: true, ranged: true };
    }
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
    // (Batch 143: Glimpse of Redemption's "The foe must choose one: The ally is unharmed by the triggering damage, or the ally gains resistance 10
    // against the triggering damage, and the enemy is Enfeebled 2 until the end of its next turn" and Liberating Step's "Trigger An enemy damages,
    // grabs, or restrains the champion's ally, and both are in the champion's aura … the ally gains resistance 10 to all damage against the
    // triggering damage" — PF2e's redeemer's and liberator's reactions: { builtin: "champion-reaction", slug, resistance }.)
    const glimpse = /\bunharmed by the triggering damage\b/i.test(effect) && /\bEnfeebled 2 until the end of its next turn\b/i.test(effect) ? /\bgains resistance (\d+)(?: to all damage)? (?:against|to) the triggering damage\b/i.exec(effect) : null;
    if (glimpse && /^An? (?:enemy|foe) damages (?:the [\w' -]+?['’]s|one of (?:the [\w' -]+?['’]s|[A-Z][\w'-]+['’]s)|[A-Z][\w'-]+['’]s) all(?:y|ies)\b/i.test(trigger.trim())) return { builtin: "champion-reaction", slug: "glimpse-of-redemption", resistance: Number(glimpse[1]) };
    const liberating = /^An? (?:enemy|foe) damages, grabs, or restrains (?:the [\w' -]+?['’]s|[A-Z][\w'-]+['’]s) ally, and both are in (?:the [\w' -]+?['’]s|its|their|his|her) aura\.?$/i.test(trigger.trim()) ? /\bally gains resistance (\d+) to all damage against the triggering damage\b/i.exec(effect) : null;
    if (liberating) return { builtin: "champion-reaction", slug: "liberating-step", resistance: Number(liberating[1]) };
    // (Batch 143: the champion's own reactions to a foe near it damaging it — Iron Command's "kneels, dropping Prone … or the enemy refuses and
    // takes 5d6 mental damage", Selfish Shield's "gains resistance 5 against the triggering damage", Destructive Vengeance's "increases the
    // amount of damage they take by 2d6 and deals 2d6 spirit damage to the triggering enemy" — their extra damage on later Strikes a note.)
    // (Batch 150, Infernal Command: "An enemy within 30 feet of Kizrech damages them or their mount".)
    const hurtNear = /^(?:An? (?:enemy|foe) (?:within (?:15|30) feet(?: of (?:the [\w' -]+?|[A-Z][\w'-]+(?: [A-Z][\w'-]+)?))?|in (?:the [\w' -]+?['’]s|this creature's champion's|its|their|his|her) (?:champion's )?aura) (?:damages|injures) (?:the [\w' -]+?|[A-Z][\w'-]+(?: [A-Z][\w'-]+)?|you|them|it|him|her)(?: or (?:its|their|his|her) mount)?|(?:The )?[\w' -]+? (?:takes damage from|is injured by) an? (?:enemy|foe) within 15 feet)\.?$/i.test(trigger.trim());
    if (hurtNear) {
        const later = /\bStrikes? against the triggering (?:creature|enemy) deals? (?:an additional )?(\d+) (?:extra )?(?:(spirit|void) )?damage\b|\bdeals? (?:an additional )?(\d+) (?:extra )?(?:damage of the chosen type|(spirit|void) damage) with (?:their|its|his|her) Strikes against the triggering (?:creature|enemy)\b/i.exec(effect);
        const lasting = /\b(?:also )?takes @Damage\[(\d+)\[persistent,(spirit|void)\]\]/i.exec(effect);
        const notes = [
            later ? `Its Strikes against that creature deal ${later[1] ?? later[3]} more ${later[2] ?? later[4] ?? "spirit or void"} damage until the end of its next turn.` : null,
            lasting ? `The enemy also takes ${lasting[1]} persistent ${lasting[2].toLowerCase()} damage.` : null,
            /\beach other enemy within 15 feet\b/i.test(effect) ? "Each other enemy within 15 feet chooses too (less damage if it refuses)." : null
        ].filter(Boolean);
        const note = notes.length ? notes.join(" ") : null;
        if (/\bkneel/i.test(effect)) {
            const dice = Math.max(0, ...[...effect.matchAll(/@Damage\[(\d+)d6\[mental\]/gi)].map((found) => Number(found[1])));
            if (dice) return { builtin: "champion-reaction", slug: "iron-command", self: true, resistance: 0, dice, ...(note ? { note } : {}) };
        }
        const selfish = /^(?:This creature|The [\w' -]+?|It|They) gains? resistance (\d+) against the triggering damage, regardless of damage type\./i.exec(effect.trim());
        if (selfish) return { builtin: "champion-reaction", slug: "selfish-shield", self: true, resistance: Number(selfish[1]), ...(note ? { note } : {}) };
        const vengeance = /\bincreases the amount of damage (?:they|she|he|it) takes? by (?:@Damage\[(\d+d\d+)(?:\[untyped\])?\]|\[\[\/r (\d+d\d+)\]\])[^.]*? deals? (?:(\d+d\d+) (?:damage )?to the triggering enemy, choosing )?@Damage\[(\d+d\d+)\[(spirit|void)\]\]/i.exec(effect);
        if (vengeance) return { builtin: "champion-reaction", slug: "destructive-vengeance", self: true, resistance: 0, selfDamage: vengeance[1] ?? vengeance[2], damage: `${vengeance[4]}[${vengeance[5].toLowerCase()}]`, ...(note ? { note } : {}) };
    }
    const champion = /\bally gains resistance (\d+) to all damage against the triggering damage\b/i.exec(effect);
    if (champion && /^An? (?:enemy|foe) damages (?:the [\w' -]+?['’]s|one of [\w' -]+?['’]s|[A-Z][\w'-]+['’]s) ally\b/i.test(trigger) && /\b(?:makes? a (?:melee )?Strike against (?:it|them|the (?:enemy|foe))|can make a Strike against the (?:enemy|foe))\b/i.test(effect) && !/\b(?:grabs|restrains|chooses?)\b/i.test(`${trigger} ${effect}`)) {
        return { builtin: "retributive-strike", resistance: Number(champion[1]) };
    }
    const resisting = readResistDamage(text, trigger, effect);
    if (resisting) return resisting;
    // Harder to escape (2026-10-11, batch 81): "Trigger A creature Grabbed or Restrained by the zinba attempts to Escape Effect The DC of the
    // Escape check is increased by 2", "… The triggering creature takes a –2 circumstance penalty to the check to Escape." → { builtin:
    // "escape-guard", value }.
    if (/^An? creature (?:Grabbed|grabbed)(?: or Restrained)? by (?:the [\w' -]+?|[A-Z][\w'-]+(?: [A-Z][\w'-]+)*)(?:['’]s [\w' -]+?)? attempts to Escape\.?$/i.test(trigger.trim())) {
        const harder = /^The DC of the Escape check is increased by (\d+)\.?$/i.exec(effect.trim()) ?? /^The triggering creature takes an? [-\u2013\u2212](\d+) circumstance penalty to the check to Escape\.?$/i.exec(effect.trim());
        if (harder) return { builtin: "escape-guard", value: Number(harder[1]) };
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
    // The attacker's choice (batch 58, Unbidden Thoughts): "Trigger The dragon is critically hit with a weapon or unarmed attack Effect The
    // attacker's mind fills with visions of their worst fears …, and they must choose one of the following results: either the triggering
    // attack becomes a normal success, or the critical hit is unaffected but the triggering creature becomes Frightened 2."
    const choice = /\bis critically hit\b/i.test(trigger) && !/\bRequirements?\b/i.test(text) ? /\bmust choose one of the following results: either the triggering attack becomes a normal (?:success|hit), or the critical hit is unaffected but the triggering creature becomes (Frightened|Sickened|Enfeebled|Clumsy|Stupefied) (\d+)\.$/i.exec(effect.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").trim()) : null;
    if (choice) return { builtin: "crit-downgrade", dc: null, or: { slug: choice[1].toLowerCase(), value: Number(choice[2]) } };
    // Concealment against the triggering attack (2026-10-10): "gains concealment against the triggering attack" (a DC 5 flat check
    // for the attacker), "The attacker must succeed at a DC 11 flat check … as if the drake were Hidden" (DC 11), "must attempt a
    // DC 11 flat check; on a failure, the attack passes harmlessly through". Ranged attacks only when the trigger says so.
    if (/\b(?:is targeted (?:with|by) (?:an?|a ranged) (?:attack|Strike|ranged Strike)|attacks the|targets the [^.]+? with an attack|is targeted by a Strike|is hit (?:with|by) (?:a|an) (?:Strike|attack))\b/i.test(trigger)) {
        const named = flat ? Number(flat) : null;
        const hidden = /\bas if (?:it|they|he|she|the [\w' -]+?) (?:were|was) Hidden\b/i.test(effect);
        const concealed = /\b(?:gains?|gaining|grants?)\b[^.]*\b(?:concealment|Concealed)\b[^.]*\bagainst (?:the|that|this) triggering (?:attack|Strike)\b/i.test(effect);
        // (Batch 218, a Battlezoo creature's vanishing: Invisible before the Strike resolves, until its next turn ends, then a Step — Hidden to the attacker
        // (DC 11); the rest notes.)
        const invisible = /^(?:The )?[^.]+? (?:becomes Invisible until the end of (?:its|it's|their) next turn|turns Invisible until its next turn ends) and Steps (\d+) feet\. The invisibility (?:occurs before resolving the Strike|comes before the Strike resolves)\b/i.exec(effect.trim());
        if (invisible) return { builtin: "conceal-reaction", dc: 11, ranged: false, when: "targeted", note: `It stays Invisible until the end of its next turn (or until it takes a hostile action) and Steps ${invisible[1]} feet after the Strike.` };
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
    // (Batch 145, Pack Ambush: "Trigger Another dromornis within 10 feet Strides. Effect The dromornis Strides up to half its Speed." — the same.)
    if (/^Another [\w' -]+? within \d+ feet Strides\.?$/i.test(trigger.trim()) && /^(?:The )?[^.]+? Strides up to half (?:its|their|his|her) Speed\.$/i.test(effect.trim())) return { builtin: "no-effect" };
    // (Batch 206, Stone Bolt: "Trigger The stony goat loses the Petrified condition Effect The stony goat's first instinct is to escape. It Strides with a
    // +20 circumstance bonus to its Speed." — a move.)
    if (/^(?:The )?[^.]+? loses the Petrified condition\.?$/i.test(trigger.trim()) && /^(?:[^.]+\. )?(?:It|They|The [\w' -]+?) Strides with a \+\d+ circumstance bonus to (?:its|their) Speed\.$/i.test(effect.trim())) return { builtin: "no-effect" };
    // (Batch 205: Reposition's "Trigger The devil hits a creature with a glaive Strike. Effect The devil moves the creature 5 feet in any direction. The
    // destination square must be within reach of the devil's glaive. This movement doesn't trigger reactions."; Limb Extension's "Trigger The yellow musk
    // thrall is reduced to 4 HP or fewer Effect … The thrall's melee reach increases by 5 feet." — where creatures stand, and its reach.)
    if (/^(?:The )?[^.]+? hits a creature with an? [\w' -]+? Strike\.?$/i.test(trigger.trim()) && /^(?:The )?[^.]+? moves the creature 5 feet in any direction\. The destination square must be within reach of (?:the [\w' -]+?['’]s|its|their) [\w' -]+?\. This movement doesn't trigger reactions\.$/i.test(effect.trim())) return { builtin: "no-effect" };
    if (/^(?:The )?[^.]+? is reduced to \d+ (?:HP|Hit Points) or fewer\.?$/i.test(trigger.trim()) && /^(?:[^.]+\. )?(?:The )?[^.]+?['’]s melee reach increases by \d+ feet\.$/i.test(effect.trim())) return { builtin: "no-effect" };
    // (Batch 203, Scuttle Away: "Trigger The ostovite's bone chariot is destroyed Effect The ostovite within Steps or Strides." — only a move.)
    if (/^(?:The )?[^.]+?['’]s [\w' -]+? is destroyed\.?$/i.test(trigger.trim()) && /^(?:The )?[^.]+? (?:Steps or Strides|Strides or Steps)\.$/i.test(effect.trim())) return { builtin: "no-effect" };
    // (A Step when an ally moves next to it, Goblin Scuttle, batch 38: nothing for the fight's numbers.)
    if (/^An? (?:[\w' -]+ )?ally ends a move action adjacent to [^.]+\.?$/.test(trigger.trim()) && /^(?:The )?[^.]+? Steps\.$/.test(effect.trim())) return { builtin: "no-effect" };
    // Fast Swallow (2026-10-10, batch 38): "Trigger The worm Grabs a creature (with its maw); Effect The worm uses Swallow Whole."
    if (/^(?:The )?[^.]+? Grabs a creature(?: (?:with|in) (?:its|their|his|her) [\w' -]+?)?;?\.?$/i.test(trigger.trim()) && /^(?:The )?[^.]+? uses Swallow Whole\.?$/i.test(effect.trim())) return { builtin: "fast-swallow" };
    // (Batch 197, Deadly Mandibles: "Trigger The giant mantis Grabs a creature with its leg. Effect The mantis pulls the creature adjacent to it, then makes
    // a mandibles Strike against the creature." — its Strike at the creature it grabbed, once the action ends; the pull a note.)
    const grabbing = /^(?:The )?[^.]+? Grabs a creature(?: (?:with|in) (?:its|their|his|her) [\w' -]+?)?;?\.?$/i.test(trigger.trim()) ? /^(?:The )?[^.]+? pulls the creature adjacent to (?:it|them), then makes an? ([\w' -]+?) Strike against the creature\.$/i.exec(effect.trim()) : null;
    if (grabbing) return { builtin: "reaction-strike", triggers: ["grabs"], strike: grabbing[1].toLowerCase(), penalty: 0, disrupts: false, note: "It pulls the creature adjacent to it first." };
    // (Batch 64: "attempts to move away from it during a move action it's using", and "targets it with a ranged attack" too → "ranged";
    // a Trip it may add on a critical hit, a note for live play.)
    // (Batch 137, Tail Trip: "A creature carrying a metal item attempts to move out of a square within reach of the rust monster's tail" —
    // leaving its reach, the metal item a note for the GM.)
    const leaving = /^A creature(?: (carrying a metal item))? attempts to move out of a square within reach of (?:the [\w' -]+?['’]s|its|their) [\w' -]+?\.?$/i.exec(trigger.trim());
    const moving = leaving || /\buses a move action\b|\bleaves a square during a move action\b|\battempts to move away from [^.]+? during a move action\b/i.test(trigger);
    // (Batch 208, Viper Tail: "The nue whips around and attempts a tail Strike against the triggering creature. This Strike doesn't count toward the nue's
    // multiple attack penalty, …" — the Strike, set off by leaving a square near it; the flanking it would cause a note.)
    const struck = /^The [^.]+? (?:makes|whips around and attempts) an? ([\w' -]+?) Strike (?:at|against) the (?:triggering )?creature(?: with an? [–-](\d+) penalty)?\./i.exec(effect);
    if (leaving && struck && !/\.\s+\S/.test(effect.trim())) return { builtin: "reaction-strike", triggers: ["leave"], strike: struck[1].toLowerCase(), penalty: Number(struck[2] ?? 0), disrupts: false, ...(leaving[1] ? { only: `a creature ${leaving[1]}` } : {}) };
    if (moving && !leaving && struck) return { builtin: "reaction-strike", triggers: ["move", ...(/\bwith a ranged attack\b/i.test(trigger) ? ["ranged"] : [])], strike: struck[1].toLowerCase(), penalty: Number(struck[2] ?? 0), disrupts: /\bIf the Strike hits, [^.]*disrupts\b/i.test(effect), ...(/\bOn a critical (?:success|hit), [^.]*? can also attempt an Athletics check to Trip the triggering creature\./i.test(effect) ? { criticalTrip: true } : {}) };
    // (Batch 73, Final Blow: "Berleth is reduced to 0 HP", "Berleth makes a final shovel Strike before dying.")
    if (/^(?:The )?[^.]+? is reduced to 0 (?:Hit Points|HP)\.?$/i.test(trigger.trim())) {
        // (Batch 61, Death Slam: "Before it's knocked out, the argorth makes a tail Strike against a random creature within reach.")
        const last = /^(?:The )?[^.]+? makes an? (?:final |last )?(?:([\w' -]+?) )?Strike before (?:dying|being destroyed)\./i.exec(effect) ?? /^Before (?:it|they)['’](?:s| are) knocked out, the [^.]+? makes an? (?:([\w' -]+?) )?Strike against a random creature within (?:(?:its|their) )?reach\.$/i.exec(effect.trim());
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
        // (Batch 158, Leap Away: "Trigger Nixbrix is targeted with a ranged attack Nixbrix Leaps up to …" — no full stop after its trigger.)
        text = text.trim().replace(/^(Trigger (?:The )?[\w' -]+? is targeted (?:with|by) an? (?:ranged |melee )?attack) (?=(?:The )?[A-Z][\w'-]*(?: [\w'-]+)*? (?:Leaps|Steps|Strides)\b)/, "$1. ");
        const parts = /^Trigger (.+?)\.\s+(?:Requirements? [^.]+\.\s+)?(.+)$/.exec(text.trim());
        if (!parts) return null;
        [trigger, effect] = [parts[1], parts[2]];
    }
    // (Batch 140, Ghost Dodge: "is targeted by a Strike or spell" — the Strike's part; against a spell and its resistances, notes.)
    const spellToo = /^(?:The )?[\w' -]+? is targeted by a Strike or spell$/i.test(trigger.trim());
    if (spellToo) trigger = trigger.replace(/ or spell$/i, "");
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
    // (Batch 158, Leap Away: a move in the same sentence is more than the bonus — a note.)
    const only = /^[^.]*?\+\d+ circumstance bonus to (?:its |their |his |her )?(?:AC|Armor Class)(?: against (?:the|that) triggering (?:attack|Strike))?\.?$/i.test(plain) && !/\b(?:Leaps|Steps|Strides|Flies)\b/.test(plain);
    const notes = [...(only ? [] : [plain]), ...(spellToo ? ["A spell aimed at it sets it off too."] : [])];
    return { builtin: "ac-reaction", value: Number(bonus[1]), when: hit ? "hit" : "targeted", ...(melee !== ranged ? { against: melee ? "melee" : "ranged" } : {}), ...(notes.length ? { notes } : {}) };
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
// (Batch 33: a trigger it plays: "The sea devil deals bleed damage to a living creature" (deals-bleed), its Hit Points at or below a
// number as it takes damage, "The Tiger Lord suffers damage that reduces its Hit Points to 100 or less" (hp-at-most), "Hymmir damages
// a living creature with his jaws Strike" (own-hit).)
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
    // (Batch 220, Blood Fury: "Trigger The charau-ka butcher deals bleed damage to a creature. Effect The charau-ka licks blood from its weapon, becoming
    // furious. It regains 5 HP and gains a +1 status bonus to attack rolls until the end of its turn." — as it deals bleed, its healing and the bonus.)
    const fury = /^Trigger (?:The )?[\w' -]+? deals bleed damage to a creature\.? Effect (?:[^.]+\. )?(?:It|They|The [\w' -]+?) regains (\d+) (?:HP|Hit Points) and gains an? \+(\d+) (status|circumstance) bonus to attack rolls until the end of (?:its|their) turn\.$/i.exec(htmlToPlainText(String(item?.system?.description?.value ?? "")).replace(/@Damage\[(\d+)\[healing\]\](?:\{[^}]*\})?/g, "$1").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\s*Effect: [\w' -]+$/, "").replace(/\s+/g, " ").trim());
    if (fury && type === "reaction") return { builtin: "self-effect", actions: 0, model: { name: item.name, rounds: 0, modifiers: [{ on: "attack", type: fury[3].toLowerCase(), value: Number(fury[2]) }], tempHp: 0 }, heal: Number(fury[1]), trigger: { kind: "deals-bleed", reaction: true } };
    // (Batch 244, Enraged Growth: "Trigger The spriggan warlord takes damage Effect … grows to size Large, along with their equipment …. The … reach
    // increases by 5 feet. They regain 15 Hit Points and gain a +2 status bonus to melee attack and damage rolls. This effect continues until the end
    // of the … next turn, but on any turn in which … deals damage … and is not Fatigued, the effect extends …. When Enraged Growth ends, the … is
    // fatigued for 1 hour." — as it takes damage: its healing, the bonus to attack and damage until the end of its next turn; its growth and reach,
    // the extension and the fatigue after, notes.)
    const growth = /^Trigger (?:The )?[\w' -]+? takes damage\.? Effect (?:The )?[\w' -]+? grows to (?:size )?Large(?: size)?, along with (?:their|its) equipment \(which returns to natural size if removed\)\. (?:The [\w' -]+?['’]s|Their|Its) reach increases by (\d+) feet\. (?:They|It) regains? (\d+) (?:Hit Points|HP) and gains? an? \+(\d+) status bonus to melee attacks? and damage rolls\. This effect continues until the end of (?:the [\w' -]+?['’]s|its|their) next turn, but on any turn in which (?:the [\w' -]+?|it|they) deals? damage to another creature and (?:is|are) not Fatigued, the effect extends until the end of the following turn\. When [A-Z][\w' -]+? ends, (?:the [\w' -]+?|it|they) (?:is|are) fatigued for 1 hour\.$/i.exec(htmlToPlainText(String(item?.system?.description?.value ?? "")).replace(/@Damage\[(\d+)\[healing\]\](?:\{[^}]*\})?/g, "$1").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\s+/g, " ").trim());
    if (growth && type === "reaction") return { builtin: "self-effect", actions: 0, model: { name: item.name, rounds: 2, modifiers: [{ on: "attack", type: "status", value: Number(growth[3]) }, { on: "damage", type: "status", value: Number(growth[3]) }], tempHp: 0 }, heal: Number(growth[2]), duration: { value: 1, unit: "rounds", expiry: "turn-end" }, trigger: { kind: "damaged", reaction: true }, notes: [`It grows to Large, its reach ${growth[1]} feet longer; the bonus is to melee attacks and damage.`, "It lasts another turn after each turn it deals damage while not Fatigued; when it ends, it's Fatigued for 1 hour."] };
    // (Batch 79: a sentence that only says whom it attacks while raging, first and after — its allies among them — set aside: the GM's.)
    const text = htmlToPlainText(String(item?.system?.description?.value ?? "")).replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\[\[\/(?:r|br|gmr) \{?([^\]}#]+?)\}?(?: #[^\]]*)?\]\](?:\{([^}]*)\})?/g, (_all, roll, label) => label ?? roll).replace(/\s+/g, " ")
        .replace(/(?<=\.\s)(?:It|They|He|She) attacks? [^.]*?\bfirst\b[^.]*?\b(?:afterward|after that|then)\b[^.]*\.\s*/g, "");
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
    // (Batch 147: a free action too, Primal Weapon's after a spell.)
    // (Batch 153: Divine Weapon's "Trigger The Chelaxian cleric finishes Casting a Spell using one of their divine spell slots", a free action or a
    // reaction — straight after a spell.)
    const finished = /\bfinishes Casting a Spell\b/i.test(htmlToPlainText(String(item?.system?.description?.value ?? "")));
    if (!["action", "free"].includes(item?.system?.actionType?.value) && !(item?.system?.actionType?.value === "reaction" && finished)) return null;
    // (Batch 233, Charge Chain: a free action once a round, too.)
    if (item.system.actionType.value === "free" && !finished && !/\bmost recent action (?:this turn )?was to (?:cast|Cast) an? (?:non-cantrip )?spell\b/i.test(String(item.system?.description?.value ?? "")) && !/<strong>\s*Frequency\s*<\/strong>\s*once per (?:round|turn)\b/i.test(String(item.system?.description?.value ?? ""))) return null;
    const html = String(item?.system?.description?.value ?? "");
    const formulas = [];
    // ("@Damage[2d8[sonic]]" and "[[/r 1d4[slashing]]]" as numbered marks; links as their labels.)
    const marked = html
        .replace(/@Damage\[((?:[^[\]]|\[[^\]]*\])*)\](?:\{[^}]*\})?/g, (_all, raw) => `\u0001${formulas.push(String(raw).split("|")[0]) - 1}\u0001`)
        .replace(/\[\[\/r ((?:[^[\]]|\[[^\]]*\])+?)(?: #[^\]]*)?\]\](?:\{[^}]*\})?/g, (_all, raw) => `\u0001${formulas.push(raw.trim()) - 1}\u0001`)
        .replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1");
    // (Batch 63: three or more of its Strikes named in a list that each gain a property rune's effects and extra damage until its next
    // turn: read as its melee Strikes, the rune a note.)
    const text = htmlToPlainText(marked).replace(/\s+/g, " ").trim()
        .replace(/\bUntil the beginning of /g, "Until the start of ")
        // (Batch 147, Primal Weapon: "…, the priestess deals an extra 1d6 slashing damage with her melee Strikes.")
        .replace(/, (?:the [\w' -]+?|it|they|he|she) deals? an? (extra|additional) (\u0001\d+\u0001) damage with (?:its|their|his|her) (melee |ranged )?Strikes\./i, ", its $3Strikes deal an $1 $2 damage.")
        // (Batch 153, Divine Weapon: "…, the Chelaxian cleric's Strikes gain the unholy trait and deal an additional 1d4 spirit damage; this damage
        // increases to 2d4 against creatures with the holy trait." — the trait after, the rest a note; Sister Maeri's "…, Sister Maeri's sawtooth
        // saber deals an additional 1d4 spirit damage" — that weapon's Strikes.)
        .replace(/(['’]s|\bits|\btheir) Strikes gain the ([a-z]+) trait and deal an (additional|extra) ([^;.]+?) damage; (this damage increases to [^.]+)\./, "$1 Strikes deal an $3 $4 damage and gain the $2 trait, and $5.")
        .replace(/(, (?:the [\w' -]+?|[A-Z][\w'-]+(?: [A-Z][\w'-]+)?)['’]s) ([a-z][\w -]+?) deals an (additional|extra) /, (all, owner, weapon, more) => (/\bStrikes?\b/i.test(weapon) ? all : `${owner} ${weapon} Strikes deal an ${more} `))
        // (Batch 219, Digestive Secretions: "Somnalu secretes acid for 1 round. Whenever it makes a melee Strike, it deals an additional 2d8 acid splash
        // damage." — its melee Strikes until its next turn starts.)
        .replace(/^(?:The )?[^.]+? for 1 round\. Whenever (?:it|they|he|she) makes? an? (melee |ranged )?Strike, (?:it|they|he|she) deals? an (additional|extra) (\u0001\d+\u0001)(?: damage)?\./, "Until the start of its next turn, its $1Strikes deal an $2 $3 damage.")
        // (Batch 155: a Battlezoo rage dragon's extra fire on its natural attacks for as long as its fury lasts — its melee Strikes while it rages.)
        .replace(/\bAll of (the [\w' -]+?['’]s) melee unarmed attacks deal an (additional|extra) ((?:\u0001\d+\u0001|\d+d\d+ [a-z]+)) damage until (?:the [\w' -]+?['’]s|its|their) rage ends\./, "Until its rage ends, $1 melee Strikes deal an $2 $3 damage.")
        // (Batch 166, Trick Attack: "The next attack with that weapon this turn deals an additional 2d6 precision damage." — its next Strike only.)
        .replace(/\bThe next attack with that weapon(?: this turn)? deals an (?:extra|additional) (\d+d\d+) precision damage\./, "Until the end of its turn, its Strikes deal an additional $1 precision damage. Next Strike only.")
        // (Batch 241, Imbue Righteousness: "Until the start of their next turn, their Strikes with that weapon gain the holy trait and deal an additional
        // 1d6 spirit damage to unholy creatures." — its Strikes, the damage only against those creatures: vsTrait.)
        .replace(/\b(Until the (?:start|end) of (?:its|their|his|her) (?:next )?turn), (?:its|their|his|her) Strikes with that weapon gain the ([a-z]+) trait and deal an (additional|extra) (\d+d\d+ [a-z]+) damage to (holy|unholy) creatures\./, "$1, its Strikes deal an $3 $4 damage and gain the $2 trait. Only against $5 creatures.")
        // (Batch 200, Local Poison: "Until the end of their turn, Strikes with their dagger deal an additional 2 persistent poison damage.")
        .replace(/\b(Until the (?:start|end) of (?:its|their|his|her) (?:next )?turn), Strikes with (?:its|their|his|her) ([\w' -]+?) deal an (additional|extra) /, "$1, their $2 Strikes deal an $3 ")
        // (Batch 233, Charge Chain: "… chooses to make their next Strike with the chain this turn either deal an additional 4d6 void damage or have 120-foot
        // reach." — the damage, its next Strike; the reach instead, a note.)
        .replace(/(^|\.\s)(?:The [\w' -]+?|It|They) chooses? to make (?:its|their) next Strike with (?:the|its|their) ([\w' -]+?) this turn either deal an additional (\u0001\d+\u0001) damage or have (\d+)-foot reach\./i, "$1Until the end of its turn, its $2 Strikes deal an additional $3 damage. Next Strike only. Or, instead of the damage, that Strike can have $4-foot reach.")
        // (Batch 233, Bespell Strikes: "Until the end of the turn, the weapon or unarmed attack deals an extra 2d6 force damage and gains the arcane trait if it
        // didn't have it already." — its Strikes this turn.)
        .replace(/\bUntil the end of the turn, the weapon or unarmed attack deals an extra (\d+d\d+ [a-z]+) damage and gains the [a-z]+ trait if it didn't have it already\./i, "Until the end of its turn, its Strikes deal an extra $1 damage.")
        // (Batch 152, Demon-Touched Weapon: "Until the end of her next turn, Shenga deals 1d6 bleed damage with her melee Strikes.")
        .replace(/\b(Until the (?:start|end) of (?:its|their|his|her) next turn), (?:the [\w' -]+?|[A-Z][\w'-]+|it|they|he|she) deals? (\d+d\d+(?:\s*[+-]\s*\d+)? [a-z]+) damage with (?:its|their|his|her) (melee |ranged )?Strikes\./, "$1, its $3Strikes deal an additional $2 damage.")
        .replace(/\beach of ((?:the [\w' -]+?|[A-Z][\w'-]+)['’]s|its|their) (?:[\w' -]+?, ){2,}(?:and )?[\w' -]+? Strikes gains the effects of (an? [\w' -]+? property rune) and deals an additional ([^.]+)\./i, (_all, owner, rune, rest) => `${owner} melee Strikes deal an additional ${rest}. The Strikes gain the effects of ${rune}.`);
    // (Batch 147, Primal Weapon: "Frequency once per turn Requirements the false priestess' most recent action was to cast a non-cantrip spell
    // Effect …" — straight after a spell: requires "after-cast".)
    const castFirst = /\bRequirements? (?:the |The )?[\w' -]+?['’]s? most recent action (?:this turn )?was to (?:cast an?|Cast an?) (non-cantrip )?spell\.? (?=Effect\b)/i.exec(text)
        ?? /\bTrigger (?:the |The )?[\w' -]+? finishes Casting a Spell(?: using one of (?:its|their|his|her) (?:arcane|divine|occult|primal) spell slots)?()\.? (?=Effect\b)/.exec(text);
    // (Batch 155: "Requirements The dragon is enraged" — while its rage lasts: requires "raging".)
    const enraged = /\bRequirements? (?:the |The )?[\w' -]+? is (?:enraged|raging)\.? (?=Effect\b)/.exec(text);
    const unrequired = (castFirst ? text.replace(castFirst[0], "") : text).replace(enraged?.[0] ?? "\u0002", "");
    if (/^(?:Trigger|Requirements?)\b|\b(?:Trigger|Requirements?) [A-Z]/.test(unrequired)) return null;
    const body = unrequired.replace(/^Frequency [^.]*?(?=\s+Effect\b)\s+Effect\s+/, "").replace(/^Effect\s+/, "");
    const sentences = body.split(/(?<=\.)\s+(?=[A-Z])/).map((sentence) => sentence.trim()).filter(Boolean);
    const lead = String.raw`(Until the (start|end) of ${BUFF_OWNER.replace("(?:all )?", "")}(next )?turn|For the next minute|For (\d+|one) minutes?|While in this stance|While in (?:its|their|his|her) [\w' -]+? form|Until its rage ends)`;
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
            // (Batch 219: splash damage, "(2d8[splash])[acid]" — the acid; where it splashes a note.)
            if (/^\((\d+d\d+)\[splash\]\)\[[a-z]+\]$/i.test(formula ?? "")) return formula.replace(/^\((\d+d\d+)\[splash\]\)\[([a-z]+)\]$/i, "$1[$2]");
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
    if (/rage ends$/i.test(leadText)) [duration, rounds] = [{ value: -1, unit: "unlimited", expiry: null }, null];
    else if (/^Until/i.test(leadText)) {
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
        if (sentence === "Next Strike only." || /^Only against (?:holy|unholy) creatures\.$/.test(sentence)) continue;
        if (at < index && !/\u0001|\d|\b(?:damage|bonus|penalty|save|check|Hit Points|HP|Strikes?|resistance|weakness|immun\w*)\b/i.test(sentence)) continue;
        if (/^Effect: /.test(sentence)) continue;
        notes.push(readableText(sentence.replace(/\u0001(\d+)\u0001/g, (_all, mark) => `@Damage[${formulas[Number(mark)]}]`)));
    }
    const other = rest.replace(/^ on a successful attack, or [^.,]+? on a critical (?:hit|success)/i, "").replace(/^,? and gains? the [a-z]+ trait/i, "").replace(/^, and /, "").trim();
    if (other) notes.unshift(other[0].toUpperCase() + other.slice(1) + ".");
    if (sentences.includes("Next Strike only.")) notes.unshift("Only its next attack with that weapon (this turn): remove the effect after it.");
    const name = found[6] && !/^(?:weapon|unarmed)$/i.test(found[6]) ? found[6].toLowerCase() : null;
    const vsTrait = sentences.map((sentence) => /^Only against (holy|unholy) creatures\.$/.exec(sentence)?.[1]).find(Boolean) ?? null;
    return {
        builtin: "self-effect",
        actions: item.system?.actionType?.value === "reaction" ? 0 : Number(item.system?.actions?.value) || (item.system?.actionType?.value === "free" ? 0 : 1),
        model: { name: item.name, rounds, modifiers: [], tempHp: 0 },
        damage,
        strike: name,
        melee: /^melee$/i.test(found[5] ?? ""),
        duration,
        ...(stance ? { stance: true } : {}),
        ...(castFirst ? { requires: "after-cast", ...(castFirst[1] ? { nonCantrip: true } : {}) } : enraged ? { requires: "raging" } : {}),
        ...(sentences.includes("Next Strike only.") ? { nextStrike: true } : {}),
        ...(vsTrait ? { vsTrait } : {}),
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
        // (Batch 170, Vare's Guide's Warning, a passive with no labels: "When Vare is about to roll … to determine her initiative, she can alert
        // her allies as a free action. …".)
        return readSteady(text) ?? readGolemAntimagic(text) ?? readPermanent(text) ?? readNaturallyInvisible(text) ?? readInitiativeWarning(text, item);
    }
    // Reactions, and free actions with a trigger (Cushioned Blow).
    if (type === "reaction" || (type === "free" && /\bTrigger\b/.test(text))) return readReaction(item, text);
    // (Free actions with no trigger, batch 41: Quickened Casting, Drain Bonded Item.)
    if (type === "free") {
        const quickened = readQuickenedCasting(text);
        if (quickened) return quickened;
        // (Batch 156, Shifting Scuttle: "Frequency once per turn Effect The scarecophagus Steps up to 10 feet." — a free Step.)
        if (/^(?:Frequency once per (?:turn|round) Effect )?(?:The )?[^.]+? Steps,? (?:moving )?up to \d+ feet\.$/i.test(text.trim())) return { builtin: "safe-move", actions: 0, ...(/\bFrequency once per (?:turn|round)\b/i.test(text) ? { oncePerTurn: true } : {}) };
        // (Batch 55: a free action with nothing for the fight's numbers, Reel In's pull.)
        return readGmSpellcasting(text) || readNoCombatEffect(text) ? { builtin: "no-effect" } : null;
    }
    if (type !== "action") return null;
    const actions = Number(item.system?.actions?.value) || 1;
    // (Batch 82, Pike and Strike: "makes a melee Strike with their naval pike. If this Strike hits, the bosun can either move the target
    // 5 feet within the pike's reach or make a fist Strike against the target without increasing their multiple attack penalty until
    // after the fist Strike." → the two Strikes, the second only after a hit, at the same penalty; the move instead the GM's choice.)
    const pike = /^(?:The )?[\w' -]+? (?:makes an? (?:melee )?Strike with (?:its|their|his|her) ([\w' -]+?)|Strikes with (?:its|their|his|her) ([\w' -]+?))\. If this Strike hits, (?:the )?[\w' -]+? can either (move the target 5 feet within the [\w' -]+?['’]s reach) or make an? ([\w' -]+?) Strike against the target without increasing (?:its|their|his|her) multiple attack penalty until after the (?:[\w' -]+? )?Strike\.$/i.exec(text.trim());
    if (pike) return { builtin: "multi-strike", actions, strikes: [(pike[1] ?? pike[2]).toLowerCase(), pike[4].toLowerCase()], sameTarget: true, sameMap: true, ifFirstHits: true, instead: pike[3] };
    // (Batch 202, Juggling Bounce: "The juggler Strikes with a thrown weapon they're juggling. If the Strike hits, the weapon bounces to a different creature
    // in the weapon's first range increment. The juggler repeats the Strike, which uses the same multiple attack penalty and doesn't increase their
    // multiple attack penalty." — a second Strike at another creature only after a hit, at the same penalty.)
    if (/^(?:The )?[\w' -]+? Strikes with a thrown weapon (?:it's|they're|he's|she's) juggling\. If the Strike hits, the weapon bounces to a different creature in the weapon's first range increment\. (?:The [\w' -]+?|It|They) repeats? the Strike, which uses the same multiple attack penalty and doesn't increase (?:its|their) multiple attack penalty\.$/i.test(text)) {
        return { builtin: "multi-strike", actions, strikes: [null, null], each: true, max: 2, sameMap: true, countsAs: 1, ifFirstHits: true, notes: ["With a thrown weapon it's juggling; the second Strike at a different creature in the first range increment, only after a hit."] };
    }
    // (Batch 84, Chase Prey: "rushes forward on all fours, Striding and then making two claw Strikes"; Frumious Charge: "Strides, ignoring
    // difficult terrain, then makes two claw Strikes at the end of its movement" → a Stride, then the Strikes at one creature.)
    // (Batch 129, Hatchet Onslaught: "Requirements Each of Kargstaad's four hands wields a hatchet. Effect Kargstaad Strides up to half his speed, then
    // makes four hatchet Strikes, applying his multiple attack penalty as normal.")
    const rush = /^(?:The )?[\w' -]+? (?:[a-z]+ forward[^,.]*, Striding and then making|Strides(?: up to (?:half )?(?:its|their|his|her) [sS]peed)?(?:, ignoring difficult terrain)?,? (?:and )?then makes) (two|three|four) ([\w' -]+?) Strikes(?: at the end of (?:its|their|his|her) movement)?(?:, applying (?:its|their|his|her) multiple attack penalty as normal)?\.$/i.exec(text.trim().replace(/^Requirements? Each of [\w' -]+?['’]s (?:two|three|four|six) (?:hands|arms) wields an? [\w' -]+?\.? Effect /i, ""));
    if (rush) return { builtin: "multi-strike", actions, strikes: Array({ two: 2, three: 3, four: 4 }[rush[1].toLowerCase()]).fill(rush[2].toLowerCase()), sameTarget: true, strides: 1 };
    // (Batch 190, Lightning Blade: "… The giant makes a greatsword Strike with a -2 circumstance penalty against each creature within its reach. It makes only
    // one attack roll and compares the result against each creature's AC. This Strike deals an additional 3d12 electricity damage and counts as two attacks
    // for the giant's multiple attack penalty." → its Strike at each creature in reach, the penalty and the extra damage, one roll a note.)
    const blade = /^(?:[^.]+\. )?(?:The )?[\w' -]+? makes an? ([\w' -]+?) Strike with an? [-\u2013\u2212](\d+) circumstance penalty against each creature within (?:its|their|his|her) reach\. (?:It|They|He|She) makes only one attack roll and compares the result against each creature's AC\. This Strike deals an additional @Damage\[((?:[^[\]]|\[[^\]]*\])*)\](?:\{[^}]*\})? damage and counts as two attacks for (?:the [\w' -]+?['’]s|its|their|his|her) multiple attack penalty\.$/i.exec(text.trim());
    if (blade) return { builtin: "multi-strike", actions, strikes: [blade[1].toLowerCase()], each: true, max: 8, sameMap: true, countsAs: 2, penalty: Number(blade[2]), extraDamage: [blade[3].split("|")[0]], notes: ["One attack roll against each creature's AC."] };
    // (Batch 185, Blinking Barrage: "… The dragon teleports up to 60 feet to a space adjacent to a creature and makes a claw Strike against that creature. The
    // dragon can do this up to four times (or any number of times), teleporting to a different creature each time. Each attack counts toward their multiple
    // attack penalty, but the penalty does not increase until all attacks are made." → its claw Strike at different creatures at one penalty, the
    // teleports a note.)
    const blinking = /^(?:[^.]+\. )?(?:The )?[\w' -]+? teleports up to (\d+) feet to a space adjacent to a creature and makes an? ([\w' -]+?) Strike against that creature\. (?:The )?[\w' -]+? can do this (?:up to (two|three|four|five|six) times|any number of times), teleporting to a different creature each time\. Each attack counts toward (?:its|their|his|her) multiple attack penalty, but the penalty (?:does not|doesn't) increase until all attacks (?:are|have been) made\.( (?:The )?[\w' -]+? (?:cannot|can't|can not) take actions with the teleportation trait again until the end of (?:its|their|his|her) next turn\.)?$/i.exec(text.trim());
    if (blinking) return { builtin: "multi-strike", actions, strikes: [blinking[2].toLowerCase()], each: true, max: blinking[3] ? { two: 2, three: 3, four: 4, five: 5, six: 6 }[blinking[3].toLowerCase()] : 8, sameMap: true, notes: [`It teleports up to ${blinking[1]} feet next to each creature before its Strike.`, ...(blinking[4] ? ["No teleportation actions again until the end of its next turn."] : [])] };
    // (Batch 172, Lurching Skewer: "Strides, then makes two spear Strikes, one with each of the two spears they wield. Both Strikes must have the
    // same target. Apply the guhdggi's multiple attack penalty to each Strike normally.")
    const skewer = /^(?:The )?[\w' -]+? Strides, then makes two ([\w' -]+?) Strikes, one with each of the two [\w' -]+? (?:they|it|he|she) wields?\. Both Strikes must have the same target\. Apply (?:the [\w' -]+?['’]s|its|their|his|her) multiple attack penalty to each Strike normally\.$/i.exec(text.trim());
    if (skewer) return { builtin: "multi-strike", actions, strikes: [skewer[1].toLowerCase(), skewer[1].toLowerCase()], sameTarget: true, strides: 1 };
    // (Batch 85: a Stride with Strikes at different creatures along the way — Mauling Rush's "Strides up to its Speed. It can make up to
    // four claw Strikes at any point during this movement, each against a different target. These attacks count toward …, but the multiple
    // attack penalty doesn't increase until after …", Whirling Slashes' "… His multiple attack penalty applies as usual."; a movement that
    // doesn't trigger reactions the GM's. Scimitar Blitz: "Strides up to their Speed, Striking once with each of their scimitars at any
    // point during the movement".)
    const along = text.trim().split(/(?<=\.)\s+(?=[A-Z])/);
    const stride = along.length > 1 && /^(?:The )?[\w' -]+? Strides up to (?:its|their|his|her) Speed\.$/i.test(along[0]) ? /^(?:It|They|He|She|The [\w' -]+?) can make up to (two|three|four|five) ([\w' -]+?) Strikes(?: at any points? during this (?:movement|Stride))?, each against a different (?:target|creature)(?: within reach)?(?:, at any points? during this (?:movement|Stride))?\.$/i.exec(along[1]) : null;
    if (stride && along.slice(2).every((sentence) => /^These attacks count toward [^.]*multiple attack penalty, but the multiple attack penalty (?:doesn't|does not) increase until after [^.]*attacks\.$|^(?:His|Her|Its|Their) multiple attack penalty applies as usual\.$|^If (?:it|they|he|she) moves? half (?:its|their|his|her) speed or less during [^,.]+, that movement (?:doesn't|does not) trigger reactions\.$/i.test(sentence))) {
        return { builtin: "multi-strike", actions, strikes: [stride[2].toLowerCase()], each: true, max: { two: 2, three: 3, four: 4, five: 5 }[stride[1].toLowerCase()], strides: 1, ...(along.slice(2).some((sentence) => /doesn't increase until|does not increase until/i.test(sentence)) ? { sameMap: true } : {}) };
    }
    // (Batch 92, Vicious Strafe: "The tylosaurus Swims up to its Speed. It can make one jaws Strike and one tail Strike at any points during its
    // movement, each attacking a different target.")
    const strafe = along.length === 2 && /^(?:The )?[\w' -]+? (?:Strides|Swims|Flies) up to (?:its|their|his|her) (?:swim |fly )?Speed\.$/i.test(along[0]) ? /^(?:It|They|He|She) can make one ([\w' -]+?) Strike and one ([\w' -]+?) Strike at any points? during (?:its|their|his|her|this) movement, each attacking a different target\.$/i.exec(along[1]) : null;
    if (strafe) return { builtin: "multi-strike", actions, strikes: [strafe[1].toLowerCase(), strafe[2].toLowerCase()], each: true, max: 2, strides: 1 };
    // (Batch 89, Flying Fists: "The akhana Flies and makes up to four fist Strikes against different targets at any points during this
    // movement. The attacks count toward its multiple attack penalty normally, but the penalty does not increase until after Flying Fists is
    // complete.")
    const fists = along.length === 2 ? /^(?:The )?[\w' -]+? (?:Strides|Flies) and makes up to (two|three|four|five) ([\w' -]+?) Strikes against different targets at any points? during this movement\.$/i.exec(along[0]) : null;
    if (fists && /^The attacks count toward [^.]*multiple attack penalty normally, but the penalty (?:doesn't|does not) increase until after [^.]+ is complete\.$/i.test(along[1])) return { builtin: "multi-strike", actions, strikes: [fists[2].toLowerCase()], each: true, max: { two: 2, three: 3, four: 4, five: 5 }[fists[1].toLowerCase()], strides: 1, sameMap: true };
    // (Batch 91, Dual Pounce: "Strides and makes two claw Strikes against the same creature at the end of that movement. Each attack counts
    // against …'s multiple attack penalty, but the penalty doesn't increase until after … both attacks. If both attacks hit, combine their
    // damage for the purpose of resistances and weaknesses." → a Stride, then the Strikes at one creature.)
    const pounce = along.length >= 1 ? /^(?:The )?[\w' -]+? Strides and makes two ([\w' -]+?) Strikes against the same creature at the end of that movement\.$/i.exec(along[0]) : null;
    if (pounce && along.slice(1).every((sentence) => /^Each attack counts against [^.]*multiple attack penalty, but the penalty (?:doesn't|does not) increase until after [^.]+\.$|^If both attacks hit, combine their damage for the purpose of resistances and weaknesses\.$/i.test(sentence))) {
        return { builtin: "multi-strike", actions, strikes: [pounce[1].toLowerCase(), pounce[1].toLowerCase()], sameTarget: true, strides: 1, ...(along.length > 1 ? { sameMap: true } : {}) };
    }
    // (Batch 89, Double Bite: "Strides and then makes a jaws Strike with each of their heads, each against a different target. Both attacks
    // count toward …, but the multiple attack penalty doesn't increase until after …" → two jaws Strikes at different creatures after a Stride.)
    const heads = along.length === 2 ? /^(?:The )?[\w' -]+? Strides and then makes an? ([\w' -]+?) Strike with each of (?:its|their|his|her) heads, each against a different target\.$/i.exec(along[0]) : null;
    if (heads && /^Both attacks count toward [^.]*multiple attack penalty, but the multiple attack penalty (?:doesn't|does not) increase until after [^.]+\.$/i.test(along[1])) return { builtin: "multi-strike", actions, strikes: [heads[1].toLowerCase()], each: true, max: 2, strides: 1, sameMap: true };
    // (Batch 186, Ravage: "makes two talon Strikes against a Paralyzed, Restrained, or Unconscious creature, using the same attack modifier as its highest
    // attack modifier. These Strikes gain the death trait. If Ravage kills the target, the intellect devourer may use Body Thief against it as a free
    // action." → both at its full bonus, only at a helpless creature (requires "helpless"); the rest notes.)
    const ravage = /^(?:The )?[\w' -]+? makes two ([\w' -]+?) Strikes against a Paralyzed, Restrained, or Unconscious creature, using the same attack modifier as (?:its|their|his|her) highest attack modifier\.(.*)$/i.exec(text.trim());
    const ravaged = ravage ? ravage[2].trim().split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean) : null;
    if (ravaged && ravaged.every((sentence) => /^These Strikes gain the death trait\.$|^If [\w' -]+? kills the target, (?:the [\w' -]+?|it) may use [A-Z][\w' -]+? against it as a free action\.$/i.test(sentence))) {
        return { builtin: "multi-strike", actions, strikes: [ravage[1].toLowerCase(), ravage[1].toLowerCase()], sameTarget: true, noMap: true, requires: "helpless", notes: ["Only at a Paralyzed, Restrained or Unconscious creature.", ...ravaged] };
    }
    // (Batch 89, Claw Rake: "makes two claw Strikes at the same target, using the same attack bonus as their highest melee attack. If both attacks
    // deal damage, the target takes extra damage equal to one claw Strike." → both at its full bonus; both hits, a claw's damage more.)
    const rake = along.length >= 2 ? /^(?:The )?[\w' -]+? (?:rears back on (?:its|their|his|her) hind legs and )?makes two ([\w' -]+?) Strikes at the same target, using the same attack bonus as (?:its|their|his|her) highest melee attack\.$/i.exec(along.at(-2)) : null;
    if (rake && along.length === 2 && new RegExp(String.raw`^If both attacks deal damage, the target takes extra damage equal to one ${rake[1]} Strike\.$`, "i").test(along[1])) return { builtin: "multi-strike", actions, strikes: [rake[1].toLowerCase(), rake[1].toLowerCase()], sameTarget: true, noMap: true, bothHit: { conditions: [], damage: [], strikeDamage: rake[1].toLowerCase() } };
    // (Batch 145, Dual-Weapon Blitz: "Requirements Pr'rall is wielding two one-handed melee weapons, each in a different hand Effect Pr'rall attacks
    // as he dashes among foes. He Strides up to his Speed. At any point during this movement, he can Strike once with each of the two required
    // weapons. These Strikes can be against the same or different targets, as he sees fit." → its best two melee Strikes after a Stride.)
    if (/^(?:Requirements? [^.]+? is wielding two one-handed melee weapons, each in a different hand\.? Effect )?(?:[^.]+? attacks as (?:he|she|it|they) dash(?:es)? among foes\. )?(?:The [\w' -]+?|He|She|It|They) Strides up to (?:its|their|his|her) Speed\. At any point during this movement, (?:he|she|it|they) can Strike once with each of the two required weapons\.(?: These Strikes can be against the same or different targets, as (?:he|she|it|they) sees? fit\.)?$/i.test(text.trim())) return { builtin: "multi-strike", actions, strikes: [null, null], strides: 1 };
    const blitz = /^(?:The )?[\w' -]+? Strides up to (?:its|their|his|her) Speed, Striking once with each of (?:its|their|his|her) ([\w' -]+?)s at any point during the movement\.$/i.exec(text.trim());
    if (blitz) return { builtin: "multi-strike", actions, strikes: [blitz[1].toLowerCase(), blitz[1].toLowerCase()], sameTarget: true, strides: 1 };
    // (Batch 83, Eviscerate: "Requirements The rivka has not attacked yet this turn Effect … It makes four Strikes: the first at its highest
    // attack bonus, the next two with a -4 penalty to their attack rolls, and the last one with a -8 penalty. This ability counts as four
    // Strikes for the purpose of its multiple attack penalty." → four Strikes at those penalties, before any other attack this turn.)
    const eviscerate = /^Requirements? (?:The )?[\w' -]+? has not attacked yet this turn Effect (?:[^.]+\. )?(?:It|They|The [\w' -]+?) makes four Strikes: the first at (?:its|their) highest attack bonus, the next two with an? [-\u2013\u2212](\d+) penalty to their attack rolls, and the last one with an? [-\u2013\u2212](\d+) penalty\. This ability counts as four Strikes for the purpose of (?:its|their) multiple attack penalty\.$/i.exec(text.trim());
    if (eviscerate) return { builtin: "multi-strike", actions, strikes: [null, null, null, null], sameTarget: true, sameMap: true, penalties: [0, Number(eviscerate[1]), Number(eviscerate[1]), Number(eviscerate[2])], countsAs: 4, requires: "first-attack" };
    // (Batch 163, Telekinetic Storm: "… either spreading them out among multiple foes or directing them at one target. When this effect is spread
    // out among multiple foes, the poltergeist makes a telekinetic object Strike at a -2 penalty against each creature within 30 feet. These count
    // as one attack … When this effect has only one target, … the damage increases to 6d12. It deals 2d12 damage on a failure, …" — the spread
    // played (a Strike at each, one attack), the single target the GM's other choice, a note.)
    const storm = /^(?:The )?[\w' -]+? [^.]+?, either spreading them out among multiple foes or directing them at one target\. When this effect is spread out among multiple foes, (?:the [\w' -]+?|it) makes an? ([\w' -]+?) Strike at an? [-\u2013\u2212](\d+) penalty against each creature within (?:@Template\[[^\]]*\]\{(\d+) feet\}|(\d+) feet)\. These count as one attack for [^.]*multiple attack penalty, and the penalty (?:doesn't|does not) increase until after all the attacks\. When this effect has only one target, (?:the [\w' -]+?|it) makes an? \1 Strike against the target, and the damage increases to (\d+d\d+(?:\s*\+\s*\d+)?)\. It deals (?:@Damage\[(\d+d\d+)\[\w+\][^\]]*\](?:\{[^}]*\})?|(\d+d\d+)) damage on a failure, and no damage on a critical failure\.$/i.exec(text.trim());
    if (storm) return { builtin: "multi-strike", actions, strikes: [storm[1].toLowerCase()], each: true, max: 8, sameMap: true, countsAs: 1, penalty: Number(storm[2]), notes: [`A Strike at each creature within ${storm[3] ?? storm[4]} feet (allies too), –${storm[2]} each, counted as one attack.`, `Or one Strike at a single target: its damage is ${storm[5]}, and ${storm[6] ?? storm[7]} on a failure.`] };
    // (Batch 183, Word of Advice: "Frequency once per round Effect The dragon is a skilled mentor, and commands its students like a general. An ally within
    // 60 feet of the dragon can Stride once and Strike once, in any order. If it hits, the Strike deals an additional 2d6 fire damage." with its
    // effect linked → { builtin: "ally-advance", within, extraDamage, uuid, oncePerTurn } — the ally's Stride and Strike, the effect's damage on it.)
    const advising = String(item.system?.description?.value ?? "");
    const advance = /An ally within (\d+) feet of (?:the [\w' -]+?|it) can Stride once and Strike once, in any order\. If it hits, the Strike deals an additional @?(?:Damage\[)?(\d+d\d+)(?:\[(\w+)\]\])? ?(\w+)? damage\./i.exec(advising.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
    if (advance && /^(?:<p>)?\s*(?:<strong>Frequency<\/strong> once per (?:round|turn)\s*(?:<\/p>)?\s*(?:<hr \/>)?\s*(?:<p>)?\s*<strong>Effect<\/strong>)?/i.test(advising)) {
        const type = (advance[3] ?? advance[4] ?? "").toLowerCase();
        const uuid = /@UUID\[(Compendium\.[^\]]+)\]\{Effect: [^}]+\}/.exec(advising)?.[1] ?? null;
        return { builtin: "ally-advance", actions, within: Number(advance[1]), extraDamage: [`${advance[2]}${type ? `[${type}]` : ""}`], ...(uuid ? { uuid } : {}), ...(/\bFrequency<\/strong> once per (?:round|turn)\b/i.test(advising) ? { oncePerTurn: true } : {}) };
    }
    // (Batch 202, Kingpin's Command: "The crime kingpin shouts a command to an ally of their choice. That ally can spend a reaction to Stride and Strike. The
    // ally becomes immune to Kingpin's Command for 24 hours." — the ally's reaction, each ally once.)
    if (/^(?:The )?[\w' -]+? shouts a command to an ally of (?:its|their|his|her) choice\. That ally can spend a reaction to Stride and Strike\. The ally becomes immune to [A-Z][\w' -]+? for 24 hours\.$/i.test(text)) return { builtin: "ally-advance", actions, within: 60, extraDamage: [], reaction: true, oncePerAlly: true };
    // (Batch 215: an ally's reaction Strike on its command, no Stride — Interest is Due!'s "The loan shark commands an ally within 30 feet to attack a
    // creature who owes the loan shark money. The ally can use a reaction to Strike the debtor, dealing an additional 1d6 mental damage." (the debt a
    // note), Tactical Command's "directs an ally. The ally can immediately use their reaction to Strike or to Stride without triggering reactions." (its
    // Strike; the +2 for a foe it knows a note), Timely Trick's animal ally ("Step, Stride, or Strike"), Stab it!'s lower-level goblin beside the target
    // (its extra damage die after, a note).)
    const said = text.trim().replace(/^Frequency once per (?:round|turn) Effect /i, "").replace(/\s*Effect: [\w' !-]+$/, "");
    const turnOnce = /^Frequency once per (?:round|turn)\b/i.test(text.trim());
    const debt = /^(?:The )?[\w' -]+? commands an ally within (\d+) feet to attack a creature who owes (?:the [\w' -]+?|it|them) money\. The ally can use a reaction to Strike the debtor, dealing an additional (\d+d\d+) (\w+) damage\.$/i.exec(said);
    if (debt) return { builtin: "ally-advance", actions, within: Number(debt[1]), extraDamage: [`${debt[2]}[${debt[3].toLowerCase()}]`], reaction: true, noStride: true, ...(turnOnce ? { oncePerTurn: true } : {}), notes: ["Only at a creature that owes it money."] };
    const directs = /^(?:The )?[\w' -]+? directs an ally\. The ally can immediately use (?:their|its) reaction to Strike or to Stride without triggering reactions\.( The ally gains a \+(\d+) status bonus to (?:their|its) Strike if [^.]+\.)?$/i.exec(said);
    if (directs) return { builtin: "ally-advance", actions, within: 60, extraDamage: [], reaction: true, noStride: true, ...(turnOnce ? { oncePerTurn: true } : {}), notes: ["Or the ally Strides (no reactions) instead.", ...(directs[1] ? [`+${directs[2]} to that Strike against a creature (or its group) it has dealt with before.`] : [])] };
    const animal = /^(?:The )?[\w' -]+? commands an animal ally within (\d+) feet to perform a specific action; the target can spend its reaction to immediately Step, Stride, or Strike\.$/i.exec(said);
    if (animal) return { builtin: "ally-advance", actions, within: Number(animal[1]), extraDamage: [], reaction: true, noStride: true, trait: "animal", notes: ["Or the animal Steps or Strides instead."] };
    const goblins = /^(?:The )?[\w' -]+? picks a target (?:it|they|he|she) can see within (\d+) feet and orders any allied ([a-z]+)s to attack\. A single \2 with a lower level than (?:the [\w' -]+?|it) that is adjacent to the target can immediately use (?:their|its) reaction to Strike the target\.( In addition, [^.]+\.)?$/i.exec(said);
    if (goblins) return { builtin: "ally-advance", actions, within: Number(goblins[1]), extraDamage: [], reaction: true, noStride: true, trait: goblins[2].toLowerCase(), lowerLevel: true, ...(goblins[3] ? { notes: [goblins[3].trim()] } : {}) };
    // (Batch 215, Advise Swarm: "Each ratfolk from the same warren in a 15-foot emanation can spend a reaction to Step, Stride, or Take Cover." — their
    // moves, nothing for the fight's numbers.)
    if (/^(?:The )?[\w' -]+? issues orders to move\. Each [\w' -]+? in an? @Template\[(?:type:)?emanation\|distance:\d+\](?:\{[^}]*\})? can spend a reaction to Step, Stride, or Take Cover\.$/i.test(said)) return { builtin: "no-effect" };
    // (Batch 167, Tactical Direction: "Each wight ally in a 30-foot emanation gains the Attack of Opportunity reaction until the end of their next
    // turn." → { builtin: "grant-aoo", within, trait, uuid } — PF2e's own ability granted to those allies for that time.)
    const directed = /^Each ([a-z]+ )?ally in an? @Template\[(?:type:)?emanation\|distance:(\d+)\](?:\{[^}]*\})? gains the (@UUID\[([^\]]+)\]\{Attack of Opportunity\}|Attack of Opportunity) reaction until the end of their next turn\.$/i.exec(String(item.system?.description?.value ?? "").replace(/<[^>]+>/g, "").trim());
    if (directed) return { builtin: "grant-aoo", actions, within: Number(directed[2]), ...(directed[1] ? { trait: directed[1].trim().toLowerCase() } : {}), ...(directed[4] ? { uuid: directed[4] } : {}) };
    // (Batch 176, Call to Arms: "Each caligni within a 30-foot emanation of the vanguard gains the Reactive Strike reaction until the end of the
    // vanguard's next turn. Once a caligni has used this Reactive Strike, that caligni is temporarily immune to the same vanguard's Call to Arms for 10
    // minutes." → until its own next turn ends (until: "source"), and once a fight for each ally that uses it.)
    const called = /^Each ([a-z]+) within (?:an? )?@Template\[(?:type:)?emanation\|distance:(\d+)\](?:\{[^}]*\})? of (?:the [\w' -]+?|it) gains the (?:@UUID\[([^\]]+)\]\{Reactive Strike\}|Reactive Strike) reaction until the end of (?:the [\w' -]+?['’]s|its) next turn\. Once an? \1 has used this Reactive Strike, that \1 is temporarily immune to the same [\w' -]+?['’]s [\w' -]+? for 10 minutes\.$/i.exec(String(item.system?.description?.value ?? "").replace(/<[^>]+>/g, "").trim());
    if (called) return { builtin: "grant-aoo", actions, within: Number(called[2]), trait: called[1].toLowerCase(), ...(called[3] ? { uuid: called[3] } : {}), reaction: "Reactive Strike", until: "source", usedOnce: true };
    // (Batch 156, Strafing Strike: "makes a jaws Strike against a creature within range. The mirror wolf can then Stride and make a second jaws
    // Strike against the same creature." — two at one creature; the Stride between the GM's.)
    const strafing = /^(?:The )?[^.]+? makes an? ([\w' -]+?) Strike against a creature within range\. (?:The [\w' -]+?|It|They|He|She) can then Stride and make a second \1 Strike against the same creature\.$/i.exec(text.trim());
    if (strafing) return { builtin: "multi-strike", actions, strikes: [strafing[1].toLowerCase(), strafing[1].toLowerCase()], sameTarget: true, notes: ["It can Stride between the two Strikes."] };
    const multi = readMultiStrikes(text);
    // (Batch 152, Hellfire Flurry: the flourish trait — one flourish a turn.)
    const flourish = (item.system?.traits?.value ?? []).includes("flourish");
    if (multi) return { builtin: "multi-strike", actions, strikes: multi.strikes, ...(flourish ? { flourish: true } : {}), ...(multi.sameMap ? { sameMap: true } : {}), ...(multi.sameTarget ? { sameTarget: true } : {}), ...(multi.oncePerTurn ? { oncePerTurn: true } : {}), ...(multi.each ? { each: true, max: multi.max } : {}), ...(multi.grab ? { grab: true } : {}), ...(multi.penalty ? { penalty: multi.penalty } : {}), ...(multi.requires ? { requires: multi.requires } : {}), ...(multi.after ? { after: multi.after } : {}), ...(multi.bothHit ? { bothHit: multi.bothHit } : {}), ...(multi.secondOffGuard ? { secondOffGuard: multi.secondOffGuard } : {}), ...(multi.countsAs !== undefined ? { countsAs: multi.countsAs } : {}), ...(multi.notes ? { notes: multi.notes } : {}), ...(multi.noGrab ? { noGrab: true } : {}), ...(multi.critical ? { critical: multi.critical } : {}), ...(multi.extraDamage ? { extraDamage: multi.extraDamage } : {}), ...(multi.then ? { then: multi.then } : {}), ...(multi.strides ? { strides: multi.strides } : {}), ...(multi.oncePerFight ? { oncePerFight: true } : {}), ...(multi.chain ? { chain: true } : {}) };
    const sweep = readSweep(text);
    if (sweep) return { builtin: "multi-strike", actions, strikes: [sweep.strike], each: true, ...(sweep.max ? { max: sweep.max } : {}), ...(sweep.sameMap ? { sameMap: true } : {}), ...(sweep.countsAs ? { countsAs: sweep.countsAs } : {}), ...(sweep.extraDamage ? { extraDamage: sweep.extraDamage } : {}), ...(sweep.missDamage ? { missDamage: sweep.missDamage } : {}), ...(sweep.penalty ? { penalty: sweep.penalty } : {}), ...(sweep.notGrabbed ? { notGrabbed: true } : {}), ...(sweep.requires ? { requires: sweep.requires } : {}), ...(sweep.strides ? { strides: sweep.strides } : {}), ...(sweep.noMomentum ? { noMomentum: true } : {}), ...(sweep.notes ? { notes: sweep.notes } : {}) };
    // One roll against up to two foes (Swipe): a Strike at each, at the same penalty, counted as that many attacks.
    const swipe = readSwipe(text);
    if (swipe) return { builtin: "multi-strike", actions, strikes: [swipe.strike], each: true, max: swipe.max, sameMap: true, ...(swipe.countsAs ? { countsAs: swipe.countsAs } : {}), ...(swipe.bonus ? { penalty: -swipe.bonus } : {}), ...(swipe.oncePerTurn ? { oncePerTurn: true } : {}), ...(swipe.bonus || swipe.notes ? { notes: [...(swipe.bonus ? [`A +${swipe.bonus} circumstance bonus to the attack roll.`] : []), ...(swipe.notes ?? [])] } : {}) };
    const charge = readCharge(text);
    // (Its moves and Strike in its actions, or more: Swoop's 2 actions for one Fly and a Strike, batch 25.)
    // (Batch 93: or fewer, as its text says — the knight's once-a-turn 1-action Sudden Charge, Eagle Dive's 1-action dive.)
    if (charge && actions >= 1 && actions <= 3) return { builtin: "charge", actions, ...charge, ...(/\bFrequency once per (?:turn|round)\b/i.test(text) && !charge.oncePerTurn ? { oncePerTurn: true } : {}) };
    if (readStrikeOnly(text)) return { builtin: "no-effect", strikeOnly: true };
    const sweepSkill = readSkillSweep(text);
    if (sweepSkill) return { builtin: "skill-sweep", actions, ...sweepSkill };
    if (readSafeMove(text) || readRetreat(text)) return { builtin: "safe-move", actions };
    // (Batch 60, Elf Step: "The elementalist Steps twice.")
    if (/^(?:The )?[^.]+? Steps twice\.$/i.test(text.trim())) return { builtin: "safe-move", actions };
    // (Batch 222, a Battlezoo manifestation's step through time: gone from its space and back in a free one nearby, no reactions — a safe move.)
    if (/^(?:Frequency once per (?:turn|round);? Effect )?(?:The )?[^.]+?, (?:disappearing from its current space and reappearing|vanishing and reappearing) in an? (?:free|open|unoccupied) space within \d+ feet\. This movement (?:does not|doesn't) trigger reactions\.$/i.test(text.trim())) return { builtin: "safe-move", actions };
    // (Batch 156: Hasty Reposition's "Frequency once per round Effect The wereant sentinel Steps, moving up to 15 feet.", Shifting Scuttle's free
    // "Steps up to 10 feet".)
    if (/^(?:Frequency once per (?:turn|round) Effect )?(?:The )?[^.]+? Steps,? (?:moving )?up to \d+ feet\.$/i.test(text.trim())) return { builtin: "safe-move", actions: item.system?.actionType?.value === "free" ? 0 : actions, ...(/\bFrequency once per (?:turn|round)\b/i.test(text) ? { oncePerTurn: true } : {}) };
    const teleport = readTeleport(text);
    if (teleport) return { builtin: "safe-move", actions, ...(teleport.recharge ? { recharge: teleport.recharge } : {}) };
    // (Batch 48, Disperse as a move: "Strides or Flies. This movement doesn't trigger reactions. During the movement, … It then coalesces
    // back into its normal form.")
    if (/^(?:The )?[^.]+? Strides or Flies\. This movement (?:doesn't|does not) trigger reactions\. During the movement, [^.]+\. (?:It|They) then coalesces? back into (?:its|their) normal form\.$/i.test(text.trim())) return { builtin: "safe-move", actions };
    // (Batch 47, Phase Jump: "Frequency once per round Effect The dragon teleports up to 120 feet. If they are airborne, they maintain
    // their momentum, …": a move that triggers no reactions.)
    if (/^(?:Frequency once per (?:turn|round) Effect )?(?:The )?[^.]+? teleports up to \d+ feet\.(?: If (?:it|they|he|she) (?:is|are) airborne, (?:it|they|he|she) maintains? (?:its|their|his|her) momentum[^.]*\.)?$/i.test(text.trim())) return { builtin: "safe-move", actions };
    // (Batch 41: the user's choices, 2026-10-11.)
    const mythic = readMythic(text);
    if (mythic) return { ...mythic, actions };
    const quickened = readQuickenedCasting(text);
    if (quickened) return quickened;
    if (readSpellstrike(item, text)) return { builtin: "spellstrike", actions };
    // (Batch 73: PF2e's Raise a Shield copied onto the sheet under its own name — "Raise a Shield (Wing Only)": the basic action, which the
    // simulator plays for a creature with a shield and PF2e plays live.)
    if (!item.system?.slug && /^Raise a Shield\b/i.test(item.name ?? "") && /\bposition your shield to protect yourself\b/i.test(text)) return { builtin: "no-effect" };
    // (Batch 73: two Strides for two actions, as two Stride actions are — a Speed bonus for them, ignoring difficult terrain, the terrain
    // it leaves: the GM's. "The horse Strides twice, with its Speed increased by 10 feet.", "The manta ray Swims twice. It has a +10-foot
    // circumstance bonus to its Speed during these actions.", "The pegasus uses 2 move actions, each of which can be either Stride or Fly.")
    if (actions === 2 && (/^(?:The )?(?:(?!\band\b|\bRaises?\b|\buses?\b)[^.])+? (?:Strides|Swims|Flies) twice(?:,? with (?:its|their|his|her) Speed increased by \d+ feet)?\.(?: (?:It|They|He|She) (?:has|have|gains?) an? \+\d+-foot circumstance bonus to (?:its|their|his|her) Speeds? during (?:these|this|the) (?:Strides|actions|Swims)(?:, ignoring difficult terrain caused by [^.]+)?\.?)?(?: Difficult terrain doesn't slow (?:its|his|her|their) movement\. Any space [^.]+? enters becomes normal terrain rather than difficult terrain(?: \([^)]*\))? until the start of (?:its|his|her|their) next turn\.)?$/i.test(text.trim())
        || /^(?:The )?[^.]+? uses 2 move actions, each of which can be either Stride or Fly\. (?:It|They) gains? an? \+\d+-foot circumstance bonus to (?:its|their) Speeds during an? [\w' -]+?\.$/i.test(text.trim()))) return { builtin: "no-effect" };
    // (Batch 73: one action for two moves without a daily count — "Frequency once per round Effect The rift chameleon Strides twice. During this
    // movement, it flits …, gaining resistance 5 to physical damage." (once a round), "The tenome Strides twice, Steps twice, or Steps and
    // Strides (in either order). It cannot use Burst of Speed again for 1d4 rounds." (its recharge): Speed Surge's kin.)
    if (actions === 1) {
        const dash = /^Frequency once per round Effect (?:The )?[^.]+? Strides twice\. During this movement, [^.]+?, gaining resistance \d+ to physical damage\.$/i.test(text.trim());
        const burst = /^(?:The )?[^.]+? Strides twice, Steps twice, or Steps and Strides \(in either order\)\. (?:It|They|He|She) can(?:not|'t) use [\w' -]+? again for (\d+d\d+|\d+) rounds?\.$/i.exec(text.trim().replace(/\[\[\/(?:r|gmr|br|roll) [^\]]*\]\]\{([^}]*)\}/g, "$1"));
        if (dash) return { builtin: "speed-surge", actions, uses: null, oncePerRound: true };
        if (burst) return { builtin: "speed-surge", actions, uses: null, recharge: burst[1] };
    }
    // Speed Surge (batch 41; the user's choice: a one-action double move, three a fight): "Frequency three times per day Effect The drake
    // Strides or Flies twice", "… moves up to twice its Speed. It can do this three times per day."
    const moves = String.raw`(?:Strides|Flies|Swims|Burrows|Climbs|moves)(?: or (?:Strides|Flies|Swims|Burrows|Climbs))?`;
    const surge = new RegExp(String.raw`^(?:Frequency (\w+) times per day[;.]? Effect )?(?:The )?[^.]+? ${moves} (?:twice|up to twice (?:its|their|his|her) Speed)\.?(?: (?:It|They|He|She) can do this (\w+) times per day\.)?$`, "i").exec(text.trim());
    if (surge && (surge[1] || surge[2])) return { builtin: "speed-surge", actions, uses: Number(surge[1] ?? surge[2]) || { two: 2, three: 3 }[(surge[1] ?? surge[2]).toLowerCase()] || 3 };
    if (readGmSpellcasting(text)) return { builtin: "no-effect" };
    const prey = readHuntPrey(text);
    if (prey) return prey;
    if (readNoCombatEffect(text) || readPlaneShift(text) || readFormShift(item, text)) return { builtin: "no-effect" };
    // (Batch 123: a move told otherwise, when nothing above read it — "Strides up to half its Speed. This movement doesn't provoke
    // reactions.", a Step and a Stride, "moves up to 140 feet in a straight line through the water.")
    const plainMove = readPlainMove(text);
    if (plainMove) return { builtin: plainMove, actions };
    return null;
}

// Resistance on itself for a while (2026-10-12, batch 196) → { builtin: "self-effect", actions, model: { name, rounds, modifiers: [], tempHp,
// resistances: [{ type, value, exceptions }], endsWithTempHp? }, duration, stance?, endsOnMove?, notes? }:
// - "… encases themself in an shell of protective coral, gaining 80 temporary Hit Points and resistance 15 to piercing and slashing damage until
//   the temporary Hit Points are depleted. The effect lasts for 1 minute, until destroyed, or until the dragon Dismisses the effect." (Reef Armor);
// - "The joseung saja is incorporeal until the end of their next turn. While they're incorporeal, they have resistance 10 to all damage (except
//   force, void, and ghost touch weapons)." (Shifting Form);
// - "They gain resistance 5 to all damage (except mental and spirit) until they next take a move action." (Harden Chitin);
// - "While Osseous Defense is active, the jitterbone … gains resistance 5 to piercing damage and slashing damage. …" (until it ends it);
// - "It stays in this form for 3 rounds or until it Dismisses the effect. While in this form, the uthul gains resistance 10 to physical damage
//   and can move through other creatures." (Whirlwind Form).
const RESIST_TYPES = "acid|bludgeoning|cold|electricity|fire|force|mental|piercing|poison|slashing|sonic|spirit|void|vitality|physical|precision";
function resistanceTypes(phrase) {
    const words = String(phrase).toLowerCase().replace(/\bdamage\b/g, " ").replace(/\b(?:and|or)\b|,/g, " ").trim().split(/\s+/).filter(Boolean);
    return words.length && words.every((word) => new RegExp(`^(?:${RESIST_TYPES})$`).test(word)) ? words : null;
}
function resistanceExceptions(phrase) {
    const words = String(phrase).toLowerCase().replace(/\bweapons?\b/g, " ").split(/\s*(?:,|\band\b|\bor\b)\s*/).map((word) => word.trim().replace(/\s+/g, "-")).filter(Boolean);
    return words.every((word) => new RegExp(`^(?:${RESIST_TYPES}|ghost-touch|non-magical)$`).test(word)) ? words : null;
}
function readSelfResistance(item, body) {
    // (Osseous Defense's Strikes listed after it, "Melee bone spike +14 (finesse), Damage …": PF2e's own, on its sheet.)
    const said = body.trim().replace(/\s*Effect: [^.]+$/i, "").replace(/\s+(?:Melee|Ranged)\b[^.]*?\+\d+ \([^)]*\),? Damage\b[\s\S]*$/, "").split(/(?<=\.)\s+(?=[A-Z])/);
    const plan = (resistances, extra) => ({ builtin: "self-effect", actions: Number(item.system?.actions?.value) || 1, model: { name: item.name, rounds: extra.rounds, modifiers: [], tempHp: extra.tempHp ?? 0, resistances, ...(extra.endsWithTempHp ? { endsWithTempHp: true } : {}) }, duration: extra.duration, ...(extra.stance ? { stance: true } : {}), ...(extra.endsOnMove ? { endsOnMove: true } : {}), ...(extra.notes?.length ? { notes: extra.notes } : {}) });
    const told = (sentence) => !/\d|\b(?:damage|bonus|penalty|save|check|Strikes?|Hit Points|resistance|weakness)\b/i.test(sentence);
    // Reef Armor.
    let match = /^(?:The )?[^.]+?, gaining (\d+) temporary Hit Points and resistance (\d+) to ([a-z, ]+?) damage until the temporary Hit Points are depleted\.$/i.exec(said[0] ?? "");
    if (match && said.length === 2 && resistanceTypes(match[3])) {
        const minutes = /^The effect lasts for (\d+|1|one) minutes?, until destroyed, or until (?:the [\w' -]+?|it|they) Dismiss(?:es)? the effect\.$/i.exec(said[1])?.[1];
        if (!minutes) return null;
        const count = Number(minutes) || 1;
        return plan(resistanceTypes(match[3]).map((type) => ({ type, value: Number(match[2]), exceptions: [] })), { rounds: 10 * count, tempHp: Number(match[1]), endsWithTempHp: true, duration: { value: count, unit: "minutes", expiry: null }, notes: ["It ends when the temporary Hit Points are gone."] });
    }
    // Shifting Form.
    match = /^(?:The )?[^.]+? is incorporeal until the (end|start) of (?:its|their|his|her) next turn\.$/i.exec(said[0] ?? "");
    const ghostly = match ? /^While (?:it's|they're|it is|they are) incorporeal, (?:it has|they have) resistance (\d+) to all damage \(except ([^)]+)\)\.$/i.exec(said[1] ?? "") : null;
    if (ghostly && said.length === 2 && resistanceExceptions(ghostly[2])) {
        const end = /end/i.test(match[1]);
        return plan([{ type: "all-damage", value: Number(ghostly[1]), exceptions: resistanceExceptions(ghostly[2]) }], { rounds: end ? 2 : 1, duration: { value: 1, unit: "rounds", expiry: end ? "turn-end" : "turn-start" }, notes: ["It's incorporeal for that time."] });
    }
    // (Batch 208, Defensive Coil: "The grootslang coils its body. It gains 20 resistance against physical attacks until the start of its next turn.")
    const coil = /^(?:It|They|The [\w' -]+?) gains? (\d+) resistance against physical attacks until the start of (?:its|their) next turn\.$/i.exec(said.at(-1) ?? "");
    if (coil && said.length <= 2 && said.slice(0, -1).every(told)) return plan([{ type: "physical", value: Number(coil[1]), exceptions: [] }], { rounds: 1, duration: { value: 1, unit: "rounds", expiry: "turn-start" }, notes: ["Against attacks only."] });
    // Harden Chitin.
    const last = said.at(-1) ?? "";
    match = /^(?:The [\w' -]+?|It|They|He|She) gains? resistance (\d+) to all damage \(except ([^)]+)\) until (?:it|they|he|she) next takes? a move action\.$/i.exec(last);
    if (match && said.slice(0, -1).every(told) && resistanceExceptions(match[2])) {
        return plan([{ type: "all-damage", value: Number(match[1]), exceptions: resistanceExceptions(match[2]) }], { rounds: null, stance: true, endsOnMove: true, duration: { value: -1, unit: "unlimited", expiry: null }, notes: ["It ends when it next takes a move action."] });
    }
    // Osseous Defense.
    const active = said.findIndex((sentence) => /^While [\w' -]+? is active, (?:the [\w' -]+?|it|they) (?:can make [^.]+? Strikes and )?gains? resistance (\d+) to ([a-z, ]+?(?: damage and [a-z]+)?) damage\.$/i.test(sentence));
    if (active >= 0) {
        const found = /gains? resistance (\d+) to ([a-z, ]+?(?: damage and [a-z]+)?) damage\.$/i.exec(said[active]);
        const types = resistanceTypes(found[2]);
        const ends = said.slice(active + 1).every((sentence) => /^(?:The [\w' -]+?|It|They) loses [A-Z][\w' -]+? while (?:its|their) [\w' -]+? is active\.$|^(?:The [\w' -]+?|It|They) can end [\w' -]+? as a single action\b[^.]*\.$/i.test(sentence));
        if (types && ends && said.slice(0, active).every(told)) {
            const notes = [/can make ([^.]+?) Strikes/i.exec(said[active])?.[1] ? `While it lasts it can make ${/can make ([^.]+?) Strikes/i.exec(said[active])[1]} Strikes.` : null, ...said.slice(active + 1)].filter(Boolean);
            return plan(types.map((type) => ({ type, value: Number(found[1]), exceptions: [] })), { rounds: null, stance: true, duration: { value: -1, unit: "unlimited", expiry: null }, notes });
        }
    }
    // Whirlwind Form.
    const form = said.findIndex((sentence) => /^(?:It|They|The [\w' -]+?) stays? in this form for (\d+) rounds or until (?:it|they) Dismiss(?:es)? the effect\.$/i.test(sentence));
    const gains = form >= 0 ? /^While in this form, (?:the [\w' -]+?|it|they) gains? resistance (\d+) to ([a-z, ]+?) damage(?: and (can move through other creatures))?\.$/i.exec(said[form + 1] ?? "") : null;
    if (gains && said.length === form + 2 && said.slice(0, form).every((sentence) => !/\d+ (?:damage|bonus|penalty)|@/i.test(sentence)) && resistanceTypes(gains[2])) {
        const rounds = Number(/for (\d+) rounds/i.exec(said[form])[1]);
        return plan(resistanceTypes(gains[2]).map((type) => ({ type, value: Number(gains[1]), exceptions: [] })), { rounds, duration: { value: rounds, unit: "rounds", expiry: "turn-start" }, notes: gains[3] ? ["It can move through other creatures."] : [] });
    }
    return null;
}

// Pulling into its shell (2026-10-12, batch 230): "The hermit crab curls fully into its shell to protect itself. This gives it a +4 circumstance bonus to
// AC, removes its weakness to bludgeoning damage, and grants it resistance 5 to piercing and slashing damage. The only actions the hermit crab can use
// while in this state are Protective Pinch and Interact to come out of its shell." (Retract), "The snapping turtle retracts its limbs and head into its
// shell and ends its turn. This increases its AC to 18, but it can't act except to reemerge, which it can do as a single action." (Shell Defense, its AC
// set: the difference from its own), "The giant pangolin falls Prone and rolls up into a ball. While rolled up, the only actions the giant pangolin can
// perform are Emit Musk and Stand, and it also becomes Blinded and gains resistance 10 to physical damage. An adjacent creature that hits a rolled-up
// giant pangolin with a melee Strike takes 1d6 slashing damage. These effects end once the giant pangolin Stands." (Roll Up) → a self-effect stance with
// its AC and resistances, the rest notes; shell: the simulator doesn't play a creature shut in (it would only wait).
export function readShell(item, actor = null) {
    if (item?.system?.actionType?.value !== "action") return null;
    const text = htmlToPlainText(String(item?.system?.description?.value ?? "").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@Damage\[\(?([^\[\]()]+?)\)?\[(\w+)\]\](?:\{[^}]*\})?/g, "$1 $2")).replace(/\s+/g, " ").trim();
    const said = text.split(/(?<=\.)\s+(?=[A-Z])/);
    if (!/\b(?:into (?:its|their) shell|rolls up into a ball)\b/i.test(said[0] ?? "")) return null;
    const modifiers = [];
    const resistances = [];
    const notes = [];
    if (/\bends (?:its|their) turn\b|\b(?:its|their) turn ends\b/i.test(said[0])) notes.push("Its turn ends.");
    if (/\bfalls Prone\b/i.test(said[0])) notes.push("It falls Prone.");
    for (const sentence of said.slice(1)) {
        let match = /^This gives (?:it|them) a \+(\d+) circumstance bonus to AC, removes (?:its|their) weakness to (\w+) damage, and grants (?:it|them) resistance (\d+) to ([a-z ,]+?) damage\.$/i.exec(sentence);
        if (match && resistanceTypes(match[4])) {
            modifiers.push({ on: "ac", type: "circumstance", value: Number(match[1]) });
            resistances.push(...resistanceTypes(match[4]).map((type) => ({ type, value: Number(match[3]), exceptions: [] })));
            notes.push(`Its weakness to ${match[2]} is gone meanwhile.`);
            continue;
        }
        match = /^This increases (?:its|their) AC to (\d+), but (?:it|they) can(?:'t|not) act except to reemerge, which (?:it|they) can do as a single action\.$/i.exec(sentence);
        if (match) {
            const ac = Number(actor?.system?.attributes?.ac?.value);
            if (Number.isFinite(ac) && Number(match[1]) > ac) modifiers.push({ on: "ac", type: "untyped", value: Number(match[1]) - ac });
            else notes.push(`Its AC is ${match[1]}.`);
            notes.push("It can't act except to come out, a single action.");
            continue;
        }
        // (Batch 234, Battlezoo: a bonus to AC with its AC named after, and to its saves against areas — a note; only a few actions while in its shell; no
        // bonus while Prone in it.)
        match = /^(?:It|They) gains? an? \+(\d+) circumstance bonus to AC, (?:increasing|raising) (?:its|their) AC to \d+, (as well as to [^.]+|and the same bonus to [^.]+)\.$/i.exec(sentence);
        if (match) {
            modifiers.push({ on: "ac", type: "circumstance", value: Number(match[1]) });
            notes.push(`The bonus applies ${match[2].replace(/^as well as /i, "").replace(/^and the same bonus /i, "")} too.`);
            continue;
        }
        if ((match = /^However, while in (?:its|their) shell, (?:it|they) can(?:'t|not) act except to ([^.]+)\.$|^Until (?:it|they) comes? out, (?:it|they) can only ([^.]+)\.$/i.exec(sentence))) {
            notes.push(`Meanwhile it can only ${(match[1] ?? match[2]).replace(/\bre- emerge\b/, "re-emerge")}.`);
            continue;
        }
        if (/^If (?:the [\w' -]+?|it|they) (?:is|are) (?:@UUID\[[^\]]*\]\{Prone\}|Prone) while in (?:its|their) shell, (?:it|they) (?:doesn't|don't) gain the circumstance bonus to AC\b[^.]*\.$/i.test(sentence)) {
            notes.push(sentence.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1"));
            continue;
        }
        match = /^While rolled up, the only actions (?:the [\w' -]+?|it|they) can perform are ([^.]+?), and (?:it|they) also becomes? Blinded and gains? resistance (\d+) to ([a-z ,]+?) damage\.$/i.exec(sentence);
        if (match && resistanceTypes(match[3])) {
            resistances.push(...resistanceTypes(match[3]).map((type) => ({ type, value: Number(match[2]), exceptions: [] })));
            notes.push(`It's Blinded, and it can only use ${match[1]}.`);
            continue;
        }
        if ((match = /^The only actions (?:the [\w' -]+?|it|they) can use while in this state are ([^.]+)\.$/i.exec(sentence))) {
            notes.push(`Meanwhile it can only use ${match[1]}.`);
            continue;
        }
        if ((match = /^An adjacent creature that hits an? [\w' -]+? with a melee Strike takes (\d+d\d+) (\w+) damage\.$/i.exec(sentence))) {
            notes.push(`An adjacent creature that hits it with a melee Strike takes ${match[1]} ${match[2]} damage.`);
            continue;
        }
        if (/^These effects end once (?:the [\w' -]+?|it|they) Stands?\.$/i.test(sentence)) {
            notes.push("It ends when it Stands.");
            continue;
        }
        return null;
    }
    if (!modifiers.length && !resistances.length) return null;
    return { builtin: "self-effect", actions: Number(item.system?.actions?.value) || 1, model: { name: item.name, rounds: null, modifiers, tempHp: 0, resistances }, duration: { value: -1, unit: "unlimited", expiry: null }, stance: true, shell: true, notes };
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
    // (Batch 223: a module's own effect, a Battlezoo one, isn't read by that — this reading stays.)
    if (/\bTrigger\b/.test(text) || /@UUID\[Compendium\.pf2e\.[\w-]*effects?\.Item\./i.test(item?.system?.description?.value ?? "")) return null;
    // (Batch 158, Mountain Stance: "Requirements Evora is unarmored and touching the ground Effect Evora enters the stance of an implacable mountain
    // until she is knocked out or the encounter ends. She gains a +4 status bonus to AC and a +2 circumstance bonus to any defenses against being
    // Shoved or Tripped. Her Speed is reduced by 5 feet." — a stance for the fight; the rest notes.)
    const mountain = /^(?:Requirements? (?:The )?[\w' -]+? is unarmored(?: and touching the ground)?\.? Effect )?(?:The )?[\w' -]+? enters the stance of [^.]+? until (?:she|he|it|they) (?:is|are) knocked out or the encounter ends\. (?:She|He|It|They) gains? an? \+(\d) (status|circumstance) bonus to AC(?: and an? \+(\d) circumstance bonus to any defenses against being Shoved or Tripped)?\.(?: (?:Her|His|Its|Their) Speed is reduced by (\d+) feet\.)?$/i.exec(text);
    if (mountain) return { builtin: "self-effect", actions: Number(item.system?.actions?.value) || 1, model: { name: item.name, rounds: null, modifiers: [{ on: "ac", type: mountain[2].toLowerCase(), value: Number(mountain[1]) }], tempHp: 0 }, stance: true, duration: { value: -1, unit: "unlimited", expiry: null }, notes: [...(mountain[3] ? [`+${mountain[3]} circumstance bonus to its defenses against Shove and Trip.`] : []), ...(mountain[4] ? [`Its Speed is ${mountain[4]} feet lower.`] : [])] };
    const required = /^Requirements? (.+?) Effect /.exec(text)?.[1] ?? "";
    // (Batch 158, Mountain Stronghold: "Requirements Evora is in Mountain Stance" — only while that stance of its own is on it.)
    const inStance = /^(?:The )?[\w' -]+? is in ([A-Z][\w' -]+? Stance)\.?$/.exec(required.trim())?.[1] ?? null;
    if (required && !inStance && !/^(?:The )?[\w' -]+? (?:is wielding [^.]+|has (?:a|an|one|two|his|her|its|their) [^.]*?(?:weapon|shield|hand)[^.]*)$/i.test(required.trim())) return null;
    const body = text.replace(/^Requirements? .+? Effect /, "").replace(/^Frequency [^.]*? Effect /, "")
        // (Batch 138, Defender of the Seas: "The triton Interacts to raise their trident, gaining a +1 circumstance bonus to AC until …".)
        .replace(/^((?:The )?[\w' -]+?) Interacts to [^,.]+, gaining (?=an? \+\d+ (?:circumstance|status) bonus to AC\b)/, "$1 gains ");
    // (Batch 223, Battlezoo self-buffs: a bonus to one save and some temporary Hit Points for a minute, with penalties to others (once a day; the
    // Perception and initiative penalties a note); a bonus to its attack and extra precision damage on its next named Strike this turn; a small AC bonus
    // for a round with poison for those who end their turns beside it (a note).)
    const STAT = { "fortitude saves": "fortitude", "reflex saves": "reflex", "will saves": "will", "ac": "ac", "attack rolls": "attack", "damage rolls": "damage" };
    const mutation = /^(?:Frequency once per (?:day|hour) Effect )?(?:The )?[^.]+? gains an? \+(\d+) (item|status|circumstance) bonus to (Fortitude saves|Reflex saves|Will saves|AC) and (\d+) temporary Hit Points, but (?:suffers|takes) an? [-–−](\d+) penalty to ((?:[\w ]+?, )*[\w ]+?,? and [\w ]+?) for (\d+|one) minutes?\.$/i.exec(body.trim());
    if (mutation) {
        const penalties = mutation[6].split(/,\s*(?:and\s+)?|\s+and\s+/).map((part) => part.trim().toLowerCase()).filter(Boolean);
        const read = penalties.filter((part) => STAT[part]).map((part) => ({ on: STAT[part], type: "untyped", value: -Number(mutation[5]) }));
        const told = penalties.filter((part) => !STAT[part]);
        return { builtin: "self-effect", actions: Number(item.system?.actions?.value) || 1, model: { name: item.name, rounds: 10 * (Number(mutation[7]) || 1), modifiers: [{ on: STAT[mutation[3].toLowerCase()], type: mutation[2].toLowerCase(), value: Number(mutation[1]) }, ...read], tempHp: Number(mutation[4]) }, ...(/\bFrequency once per (?:day|hour)\b/i.test(text) ? { uses: 1 } : {}), ...(told.length ? { notes: [`Also –${mutation[5]} to its ${told.join(" and ")}.`] } : {}) };
    }
    const aimed = /^(?:[^.]+\. )?(?:The )?[^.]+? gains an? \+(\d+) circumstance bonus to (?:its attack roll on (?:the|its) next|the attack roll of its next) ([\w' -]+?) Strike (?:against the creature made before the end of its turn|at that creature this turn)\. (?:If the Strike hits,? it|On a hit, that Strike) deals an additional (\d+d\d+) (precision|[a-z]+) damage\.$/i.exec(body.trim());
    if (aimed) return { builtin: "self-effect", actions: Number(item.system?.actions?.value) || 1, model: { name: item.name, rounds: 0, modifiers: [{ on: "attack", type: "circumstance", value: Number(aimed[1]) }], tempHp: 0 }, damage: [`${aimed[3]}[${aimed[4].toLowerCase()}]`], strike: aimed[2].toLowerCase(), melee: false, duration: { value: 0, unit: "rounds", expiry: "turn-end" }, nextStrike: true, notes: ["Only its next Strike this turn, at that creature."] };
    const spores = /^(?:[^.]+\. )?For 1 round, (?:the [\w' -]+?|it) gains an? \+(\d+) circumstance bonus to AC,? and (?:any|each) creature that ends its turn within (\d+) feet of (?:the [\w' -]+?|it) takes (\d+d\d+) (\w+) damage\.$/i.exec(body.trim().replace(/\s*Effect: [\w' -]+$/, "").replace(/\[\[\/(?:r|gmr|br) (\d+d\d+)\[(\w+)\]\]\](?:\{[^}]*\})?/g, "$1 $2").replace(/@Damage\[(\d+d\d+)\[(\w+)\]\](?:\{[^}]*\})?/g, "$1 $2"));
    if (spores) return { builtin: "self-effect", actions: Number(item.system?.actions?.value) || 1, model: { name: item.name, rounds: 1, modifiers: [{ on: "ac", type: "circumstance", value: Number(spores[1]) }], tempHp: 0 }, notes: [`For that round, a creature that ends its turn within ${spores[2]} feet of it takes ${spores[3]} ${spores[4].toLowerCase()} damage.`] };
    // (Batch 224, Raise Shields: "The troop raises steel shields, with the effects of Raise a Shield." — +2 AC until its next turn.)
    if (/^(?:The )?[^.]+? raises? (?:steel |its |their )?shields, with the effects of Raise a Shield\.$/i.test(body.trim())) return { builtin: "self-effect", actions: Number(item.system?.actions?.value) || 1, model: { name: item.name, rounds: 1, modifiers: [{ on: "ac", type: "circumstance", value: 2 }], tempHp: 0 } };
    // (Batch 221, Shielded Charge: "The dwarf warrior Raises a Shield and Strides twice." — its shield's bonus until its next turn (2 when there's none to
    // read), the Strides a note.)
    if (/^(?:The )?[^.]+? Raises a Shield and Strides twice\.$/i.test(body.trim())) {
        const shield = (item?.actor?.itemTypes?.shield ?? [])[0];
        const value = Number(shield?.system?.acBonus) || 2;
        return { builtin: "self-effect", actions: Number(item.system?.actions?.value) || 2, model: { name: item.name, rounds: 1, modifiers: [{ on: "ac", type: "circumstance", value }], tempHp: 0 }, notes: ["It Strides twice as well."] };
    }
    // (Batch 138: a guard that lasts until it moves — Cower's "It gains a +4 circumstance bonus to AC but takes a –2 penalty to attack rolls.
    // This lasts until the pusk moves from its current space, falls Unconscious, or ends the effect as a free action."; Entrench's "… locks
    // itself in place, becoming voluntarily Immobilized. While Entrenched, the archon can't be forcibly moved or tripped, and it gains a +2
    // circumstance bonus to AC and Reflex saves. Entrench ends automatically as soon as the bastion archon uses another move action." — a
    // stance that ends when it moves, what it can't be the GM's.)
    const held = readHeldGuard(item, body);
    if (held) return held;
    // (Batch 144, Raise Shields: "The arboreal wardens of the copse raise their shields in tandem, gaining a +2 circumstance bonus to AC and Reflex
    // saves." — Raise a Shield's, until the start of its next turn.)
    // (Batch 158, Spinning Shield: "Rayhnne spins her flails rapidly in all directions, giving her a +2 circumstance bonus to her AC and Reflex saves
    // until the start of her next turn. If she uses Reactive Strike while this ability is active, she adds 1d10 to her damage." — the Reactive
    // Strike's extra die a note.)
    const spinning = /^(?:The )?[^.,]+? [^.,]+?, giving (?:her|him|it|them|itself|herself|himself|themselves) an? \+(\d) circumstance bonus to (?:her|his|its|their) AC and Reflex saves until the start of (?:her|his|its|their) next turn\.(?: If (?:she|he|it|they) uses Reactive Strike while this ability is active, (?:she|he|it|they) adds? (\d+d\d+) to (?:her|his|its|their) damage\.)?$/i.exec(body.trim());
    if (spinning) return { builtin: "self-effect", actions: Number(item.system?.actions?.value) || 1, model: { name: item.name, rounds: 1, modifiers: [{ on: "ac", type: "circumstance", value: Number(spinning[1]) }, { on: "reflex", type: "circumstance", value: Number(spinning[1]) }], tempHp: 0 }, duration: { value: 1, unit: "rounds", expiry: "turn-start" }, ...(spinning[2] ? { notes: [`While it lasts, its Reactive Strike deals ${spinning[2]} more damage.`] } : {}) };
    // (Batch 201, Shields Up!: "The phalanx formation raises their shields to protect one another. The formation gains a +2 circumstance bonus to AC and
    // Reflex until the start of their next turn. This bonus increases to +3 against physical ranged attacks." — the higher bonus a note.)
    const phalanx = /^(?:The )?[^.]+? raises? (?:their|its) shields? to protect one another\. (?:The [\w' -]+?|It|They) gains? an? \+(\d) circumstance bonus to AC and Reflex until the start of (?:its|their) next turn\. This bonus increases to \+(\d) against physical ranged attacks\.$/i.exec(body.trim());
    if (phalanx) return { builtin: "self-effect", actions: Number(item.system?.actions?.value) || 1, model: { name: item.name, rounds: 1, modifiers: [{ on: "ac", type: "circumstance", value: Number(phalanx[1]) }, { on: "reflex", type: "circumstance", value: Number(phalanx[1]) }], tempHp: 0 }, duration: { value: 1, unit: "rounds", expiry: "turn-start" }, notes: [`+${phalanx[2]} instead against physical ranged attacks.`] };
    const shields = /^(?:The )?[^.]+? raises? (?:their|its) shields?(?: in tandem)?, gaining an? \+(\d) circumstance bonus to AC and Reflex saves\.$/i.exec(body.trim());
    if (shields) return { builtin: "self-effect", actions: Number(item.system?.actions?.value) || 1, model: { name: item.name, rounds: 1, modifiers: [{ on: "ac", type: "circumstance", value: Number(shields[1]) }, { on: "reflex", type: "circumstance", value: Number(shields[1]) }], tempHp: 0 }, duration: { value: 1, unit: "rounds", expiry: "turn-start" } };
    const resisting = readSelfResistance(item, body);
    if (resisting) return resisting;
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
    // (More than its AC in the other sentences, a Strike or a move: not this reading. Batch 63: a sentence that only bars one of its own
    // Strikes while it flies, a note.)
    if (notes.some((note) => /\b(?:Strikes?|Strides?|Steps?|Flies|Swims)\b/.test(note) && !/^(?:They|It|He|She) can(?:'t|not) use (?:their|its|his|her) [\w' -]+? Strikes? while in flight for the same duration\.$/i.test(note))) return null;
    return {
        builtin: "self-effect",
        actions: Number(item.system?.actions?.value) || 1,
        model: { name: item.name, rounds, modifiers: [{ on: "ac", type: found[3].toLowerCase(), value: Number(found[2]) }], tempHp: 0 },
        duration: { value: 1, unit: "rounds", expiry: rounds === 2 ? "turn-end" : "turn-start" },
        ...(inStance ? { requiresEffect: inStance, notes: [`Only while it is in ${inStance}.`, ...notes] } : notes.length ? { notes } : {})
    };
}

function readHeldGuard(item, body) {
    const sentences = body.split(/(?<=\.)\s+(?=[A-Z])/);
    const subject = String.raw`(?:The [\w' -]+?|It|They|He|She|[A-Z][\w'-]+(?: [A-Z][\w'-]+)?)`;
    const notes = [];
    let modifiers = null;
    let ends = false;
    for (const [index, sentence] of sentences.entries()) {
        let match;
        if (!modifiers && (match = new RegExp(String.raw`^(?:While [A-Z][\w' -]+?, )?${subject} (?:can't be forcibly moved or tripped, and (?:it|they|he|she) )?gains? an? \+(\d+) (circumstance|status) bonus to (?:its |their )?AC( and Reflex saves)?(?: but takes an? [-\u2013\u2212](\d+) penalty to (?:its |their )?attack rolls)?\.$`, "i").exec(sentence))) {
            const type = match[2].toLowerCase();
            modifiers = [{ on: "ac", type, value: Number(match[1]) }, ...(match[3] ? [{ on: "reflex", type, value: Number(match[1]) }] : []), ...(match[4] ? [{ on: "attack", type: "untyped", value: -Number(match[4]) }] : [])];
            if (/can't be forcibly moved or tripped/i.test(sentence)) notes.push("It can't be forcibly moved or tripped while it lasts.");
            continue;
        }
        if (new RegExp(String.raw`^This lasts until ${subject} moves from (?:its|their|his|her) current space(?:, falls Unconscious)?,? (?:or )?ends the effect as a free action\.$`, "i").test(sentence) || new RegExp(String.raw`^[A-Z][\w' -]+? ends automatically as soon as ${subject} uses another move action\.$`, "i").test(sentence)) {
            ends = true;
            continue;
        }
        // (Batch 219, Defensive Curl: "The ugvashi can't move while in its Defensive Curl, but it can unfurl as an action." — it lasts until it moves;
        // "Any creatures who make unarmed attacks against the ugvashi while it's in its Defensive Curl are exposed to its serrated plates, …" — a note.)
        if (new RegExp(String.raw`^${subject} can(?:'t|not) move while in (?:its|their) [A-Z][\w' -]+?, but (?:it|they) can unfurl as an action\.$`, "i").test(sentence)) {
            ends = true;
            notes.push("It can't move while it lasts; unfurling (an action) ends it.");
            continue;
        }
        // (Batch 222, a Battlezoo armadillo's curl: it lasts until an action of its own ends it; its Speed and the
        // limbs it can't use, a note.)
        if (new RegExp(String.raw`^(?:It|They|${subject}) can unfurl as a single action(?: with the manipulate trait)?, ending the effects of [A-Z][\w' -]+?\.$|^(?:It|They) can uncurl as an action, ending it\.$`, "i").test(sentence)) {
            ends = true;
            continue;
        }
        if (new RegExp(String.raw`^(?:The [\w' -]+?['’]s|Its|Their) [Ss]peed is reduced to \d+ feet, and (?:it|they) can(?:'t|not) use (?:its|their) [\w' -]+? or take other actions that require (?:it|them) to use (?:its|their) limbs while in (?:its|their) [A-Z][\w' -]+?\.$|^(?:Its|Their) Speed drops to \d+ feet while (?:it is|it's|they are) curled\.$`, "i").test(sentence)) {
            notes.push(sentence);
            continue;
        }
        if (new RegExp(String.raw`^Any creatures? who makes? unarmed attacks against ${subject} while (?:it's|it is|they're) in (?:its|their) [A-Z][\w' -]+? (?:are|is) exposed to [^.]+\.$`, "i").test(sentence)) {
            notes.push(sentence);
            continue;
        }
        // (A first sentence that only tells it: "… locks itself in place, becoming voluntarily Immobilized" (the GM's, a note), "… makes
        // itself as small as possible …".)
        if (index === 0 && !/\d|\b(?:damage|bonus|penalty|save|check|Strikes?)\b/i.test(sentence)) {
            if (/\bvoluntarily Immobilized\b/i.test(sentence)) notes.push("It's voluntarily Immobilized: moving ends it.");
            continue;
        }
        return null;
    }
    if (!modifiers || !ends) return null;
    return {
        builtin: "self-effect",
        actions: Number(item.system?.actions?.value) || 1,
        model: { name: item.name, rounds: 10, modifiers, tempHp: 0 },
        stance: true,
        endsOnMove: true,
        duration: { value: -1, unit: "unlimited", expiry: null },
        notes: ["It ends when it moves.", ...notes]
    };
}

// Hunt Prey in a monster's own words (2026-10-10, batch 39): "The hunter designates a single creature they can see and hear, or one
// they're Tracking, as their prey. … The first time the hunter hits the designated prey in a round, they deal an additional 1d8
// precision damage. …" → { builtin: "hunt-prey", edge: "precision", dice, die }; with only the bonuses to Seek and Track and the
// range increment (no damage), nothing for the fight's numbers. null when it isn't Hunt Prey.
function readHuntPrey(text) {
    // (Batch 164, Mark for Death: "Requirements Siora can see the target she intends to mark Effect Siora designates a single target as her mark. She
    // gains a +2 circumstance bonus to Perception checks to Seek her target, and her spectral hand Strikes against her target gain the deadly d8
    // weapon trait." — deadly on those Strikes against the mark.)
    // (The Gray Gardener assassin's: "… designates a single creature they can see and hear as their mark. This effect lasts until … The assassin
    // gains a +2 circumstance bonus to Perception checks to Seek the mark and on Deception checks to Feint against the mark. The assassin's melee and
    // ranged Strikes gain the deadly d8 weapon traits when attacking the mark." — all its Strikes.)
    const marking = String(text).trim().replace(/^Requirements? [^.]+? can (?:see|observe) the (?:target|creature) (?:she|he|it|they) intends? to mark\.? Effect /i, "");
    if (/^(?:The )?[\w' -]+? designates a single (?:target|creature)(?: (?:she|he|it|they) can see(?: and hear)?)? as (?:her|his|its|their) mark\./i.test(marking)) {
        const sentences = marking.split(/(?<=\.)\s+(?=[A-Z])/).slice(1);
        const deadly = sentences.map((sentence) => /^(?:(?:She|He|It|They) gains? a \+\d circumstance bonus to Perception checks to Seek (?:her|his|its|their) target, and )?(?:(?:her|his|its|their)|(?:The )?[\w' -]+?['’]s) ([\w' -]+?) Strikes (?:against (?:her|his|its|their) target )?gain the deadly d(\d+) weapon traits?(?: when attacking the mark)?\.$/i.exec(sentence)).find(Boolean);
        const told = (sentence) => /\bcircumstance bonus to Perception checks to Seek\b|^This (?:effect )?lasts until\b/i.test(sentence) && !/\bdeadly\b/i.test(sentence);
        if (deadly && sentences.every((sentence) => told(sentence) || /\bdeadly d\d+\b/i.test(sentence))) {
            const strike = /^melee and ranged$/i.test(deadly[1]) ? null : deadly[1].toLowerCase();
            return { builtin: "hunt-prey", edge: "deadly", strike, die: Number(deadly[2]), notes: ["+2 circumstance bonus to Perception checks to Seek its mark (and to Feint against it, when it says so)."] };
        }
    }
    // (The executioner's: "marks a single creature they can see for death. The first time each round the executioner Strikes that creature, the
    // Strike deals an extra 1d12 precision damage. The creature remains marked for death until …" — Hunt Prey's precision edge.)
    const death = /^(?:The )?[\w' -]+? marks a single creature (?:it|they|he|she) can see for death\. The first time each round (?:the [\w' -]+?|it|they|he|she) Strikes that creature, the Strike deals (?:an extra (\d+)d(\d+)|(\d+)d(\d+) additional) precision damage\.(?: The creature remains marked for death until [^.]+\.)?$/i.exec(String(text).trim());
    if (death) return { builtin: "hunt-prey", edge: "precision", dice: Number(death[1] ?? death[3]), die: Number(death[2] ?? death[4]) };
    // (Batch 153, Lawbringer: "The shieldmarshal marks a foe for judgment, granting the shieldmarshal a +10-foot circumstance bonus to Speed whenever
    // it Strides toward that creature. The shieldmarshal's Strikes against that creature deal an additional 2d8 precision damage." — every hit.)
    const marked = /^(?:The )?[^.]+? marks a foe for judgment, granting (?:the [\w' -]+?|it|them|him|her) a \+(\d+)-foot circumstance bonus to Speed whenever (?:it|they|he|she) Strides? toward that creature\. (?:The [\w' -]+?['’]s|Its|Their|His|Her) Strikes against that creature deal an additional (\d+)d(\d+) precision damage\.$/i.exec(String(text).trim());
    if (marked) return { builtin: "hunt-prey", edge: "precision", dice: Number(marked[2]), die: Number(marked[3]), every: true, notes: [`It has a +${marked[1]}-foot circumstance bonus to Speed whenever it Strides toward that creature.`] };
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
    // (Batch 47: no "Effect" label, "Cost 1 Mythic Point The mythic lich regains one spell.")
    const said = String(text).trim().replace(/^Cost 1 Mythic Point (?!Effect )/i, "Cost 1 Mythic Point Effect ");
    if (!/^Cost 1 Mythic Point Effect /i.test(said)) return null;
    if (/^Cost 1 Mythic Point Effect (?:The )?[^.]+? (?:ends|removes) (?:any )?one condition (?:currently )?affecting (?:it|itself|them|themselves|themself|him|himself|her|herself)\.$/i.test(said)) return { builtin: "mythic", kind: "remove-condition" };
    const recharge = /^Cost 1 Mythic Point Effect (?:The )?[^.]+? regains (?:an expended|a previously cast|one) spell(?: slot)?( or can use Quickened Casting again)?\.$/i.exec(said)
        // ("gains an additional use of any of their innate spells", "… an additional casting of any of his innate primal spells that he
        // has already cast", batch 47.)
        ?? /^Cost 1 Mythic Point Effect (?:The )?[^.]+? gains an additional (?:use|casting) of any of (?:its|their|his|her) innate (?:\w+ )?spells(?: that (?:it|they|he|she) (?:has|have) already cast)?\.$/i.exec(said);
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
        && /\band gains? a \+2 circumstance bonus to AC against reactions triggered by this movement\.(?: (?:It|They|He|She|The [\w' -]+?) must end this movement in a space that's not adjacent to any enemy\.)?$/i.test(said)
        // (Batch 201, Beat a Retreat: "The beggar Strides three times and gains a +2 circumstance bonus to AC during those actions.")
        || /^(?:The )?[^.]+? Strides (?:twice|three times) and gains? a \+2 circumstance bonus to AC during those actions\.$/i.test(said);
}

// A move that doesn't trigger reactions (2026-10-10, batch 38): "The cultist jumps up to half its Speed. This movement doesn't
// trigger reactions." (Swift Leap), "… moves up to 60 feet in a straight line through the water without triggering reactions"
// (Jet), "Strides up to his Speed and does not trigger reactions during this movement". Only the move: not with a Strike, a check
// or a condition on where it goes ("but must begin and end in dim light"). true or false.
function readSafeMove(text) {
    // (Batch 145, Shadow Step: "…, but the svartalfar killer must begin and end in an area of dim light or darkness" — the GM's.)
    const sentences = String(text).replace(/’/g, "'").trim().replace(/, but (?:the [\w' -]+?|it|they|he|she) must begin and end in an area of dim light or darkness(?=\.)/i, "").split(/(?<=[.;])\s+(?=[A-Z])/);
    if (sentences.length === 3 && !/\b(?:damage|bonus|penalty|save|check|DC|Hit Points|HP|Strike)\b|\d/.test(sentences[0])) sentences.shift();
    const said = sentences.join(" ");
    if (/\b(?:Strikes?|checks?|saves?|damage|but|if|unless|Grab|Prone|Interacts?)\b|@/i.test(said) || /\b(?:Requirements?|Trigger)\b/.test(said)) return false;
    // (Batch 59: Scuttle's "crawls on all fours, moving up to half its Speed".)
    const move = String.raw`(?:jumps|moves|moving|Strides|Flies|Flying|Swims|Leaps|Climbs|Burrows)`;
    return new RegExp(String.raw`^(?:The |An? )?[^.;]+? ${move} (?:up to|once|twice)?[^.;]*?(?:\. This movement (?:doesn't|does not) trigger reactions\.|; this movement (?:doesn't|does not) trigger reactions\.| without triggering (?:any )?reactions\.| and (?:doesn't|does not) trigger reactions during this movement\.)$`, "i").test(said);
}

// A move and nothing else (2026-10-12, batch 123): its sentences only movement ("Strides up to half its Speed", "Strides or Climbs twice, with
// its Speeds increased by 10 feet for this movement", "Strides and then Steps, or Steps and then Strides, ignoring difficult terrain during
// this movement", "moves up to twice their swim Speed downward"), passing through creatures' spaces, more actions for a longer move, and
// at most one sentence before that only tells it. "safe-move" when the movement triggers no reactions, "no-effect" otherwise (a move of
// the creature's own, nothing for the fight's numbers); null for anything else.
function readPlainMove(text) {
    // (Batch 136, Sprint: "Frequency once per minute Effect The terror bird Strides three times in a straight line" — its frequency the GM's, no
    // final period.)
    // (Batch 145: Trudge's "The zombie desecrator moves mindlessly forward without fear of pain." — it only tells it.)
    const sentences = String(text).replace(/’/g, "'").trim().replace(/^Frequency once per (?:minute|10 minutes|hour|day) Effect /i, "").replace(/^(?:The )?[\w' -]+? moves mindlessly forward without fear of pain\.\s+/i, "").replace(/([^.])$/, "$1.").split(/(?<=\.)\s+(?=[A-Z])/);
    if (sentences.length > 1 && !/\d|@|\b(?:damage|bonus|penalty|save|check|DC|Hit Points|HP|Strikes?|Requirements?|Trigger|Frequency|moves?|jumps?)\b/i.test(sentences[0]) && !/\b(?:Strides?|Steps?|Fl(?:y|ies)|Swims?|Climbs?|Burrows?|Leaps?)\b/.test(sentences[0])) sentences.shift();
    const verb = String.raw`(?:Strides|Steps|Flies|Swims|Climbs|Burrows|Leaps|moves|jumps)`;
    const far = String.raw`(?: (?:up to )?(?:\d+ feet|(?:half |twice |double |three times |four times |five times )?(?:its|their|his|her) (?:\w+ )?Speed|once|twice|three times))?`;
    // (Batch 144, Slither: "Strides, Climbs, or Swims up to half its Speed, pulling any creatures it has grabbed with it.")
    const how = String.raw`(?: (?:in a straight line|through the water|downward|in any direction(?:, including vertically|, even straight up)?))*(?:,? (?:ignoring (?:any )?difficult terrain(?: during (?:this|its|their|his|her) movement)?|with (?:its|their|his|her) Speeds? increased by \d+ feet(?: for this movement)?|pulling any creatures (?:it|they|he|she) (?:has|have) [Gg]rabbed with (?:it|them|him|her)))?(?: and fitting through tight spaces as though (?:it|they|he|she) were a Tiny creature)?`;
    const move = new RegExp(String.raw`^(?:The |An? )?(?:(?!\b(?:and|then|uses?|Interacts?|Raises?|Hides?|Feints?)\b)[^.;])+? ${verb}(?:, ${verb})*(?:(?:,? or|,? and then| then) ${verb})*(?:,? or Steps and then Strides|,? or Strides and then Steps)?${far}${how}\.$`, "i");
    // (Batch 145, Shadow Step: "…, but the svartalfar killer must begin and end in an area of dim light or darkness" — the GM's.)
    const safe = /^(?:This|The|Its|Their) movement (?:doesn't|does not) (?:trigger|provoke) (?:any )?reactions(?: based on movement)?(?:, but (?:the [\w' -]+?|it|they|he|she) must begin and end in an area of dim light or darkness)?\.$/i;
    const through = /^(?:It|They|He|She) can (?:pass|move) through (?:other )?creatures' spaces during this movement(?:, though (?:it|they|he|she) must end (?:its|their|his|her) movement in an unoccupied space)?\.$/i;
    const longer = /^(?:It|They|He|She) can increase the number of actions for this activity to \d in order to (?:Stride|move) up to [^.]+? instead\.$|^At the end of its movement, the [\w' -]+? takes @Damage\[\d+d\d+\[bludgeoning\]\] damage for each square of difficult terrain it entered while [A-Z][\w' -]+?\.$|^(?:It|They|He|She) can(?:'t|not) use any actions other than [A-Z][\w' -]+? until (?:it|they|he|she) occupies an area large enough for (?:its|their|his|her) normal form\.$/i;
    if (!sentences.length || !move.test(sentences[0])) return null;
    const rest = sentences.slice(1);
    if (!rest.every((sentence) => safe.test(sentence) || through.test(sentence) || longer.test(sentence))) return null;
    return rest.some((sentence) => safe.test(sentence)) ? "safe-move" : "no-effect";
}

// A teleport of its own to a space nearby (2026-10-11, batch 59): Jaunt's "The poracha teleports up to 40 feet to a location it can see.
// It can't use Jaunt again for 1d4 rounds.", Personal Portal's "Frequency once per round Effect The kerulkagon teleports to an unoccupied
// space it can see within 30 feet.", Shadow Flitter's "… to a square they can see within 30 feet that isn't in an area of bright light",
// Monitor Escape's first sentence that only tells it. A move that triggers no reactions: { recharge } (its formula or null), or null.
function readTeleport(text) {
    // (Not one with a requirement: Shadow Jump's "Requirement The bright walker's Light Aura is suppressed".)
    if (/\b(?:Requirements?|Trigger)\b/.test(String(text))) return null;
    const rolls = String(text).replace(/\[\[\/(?:r|br|gmr) \{?([^\]}#]+?)\}?(?: #[^\]]*)?\]\](?:\{([^}]*)\})?/g, (_all, roll, label) => label ?? roll);
    // (Batch 157, Dimensional Slide: "Frequency twice per day Effect Il'setsya steps through a transient hole in space, instantly teleporting to a
    // space within 60 feet that she can see." — the GM counts its uses.)
    const sentences = rolls.replace(/’/g, "'").trim().replace(/^Frequency (?:once per (?:round|turn)|(?:once|twice) per day) Effect /i, "")
        .replace(/^((?:The )?[^.,]+?) steps through [^,.]+, instantly teleporting to /i, "$1 instantly teleports to ").split(/(?<=\.)\s+(?=[A-Z])/);
    const where = String.raw`(?:up to \d+ feet )?(?:in)?to an? (?:unoccupied |empty |clear )?(?:space|square|location)(?: (?:it|they|he|she) can see)?(?: within \d+ feet)?(?: that (?:it|they|he|she) can see)?(?: that (?:isn't|is not) in an area of bright light)?`;
    const teleports = new RegExp(String.raw`^(?:The |An? )?[^.]+? (?:instantly )?teleports (?:itself |themselves |themself )?${where}\.$`, "i");
    const wait = /^(?:It|They|He|She|The [\w' -]+?) can(?:'t|not) use (?:[\w' -]+? )?again for (\d+d\d+) rounds\.$/i;
    let at = sentences.findIndex((sentence) => teleports.test(sentence));
    if (at < 0 || at > 1 || (at === 1 && /\d|@|\b(?:damage|Strike|save|check|bonus|penalty|Requirements?|Trigger|Frequency)\b/i.test(sentences[0]))) return null;
    const rest = sentences.slice(at + 1);
    if (rest.length > 1 || (rest.length && !wait.test(rest[0]))) return null;
    return { recharge: rest.length ? wait.exec(rest[0])[1] : null };
}

// Plane and form shifts (2026-10-11, batch 48; the user's choice: the GM's): Skip Between and Walk the Ethereal Line (the Ethereal
// Plane), Swarm Shape, Shadow Form, Reef Meld, Bramble Jump's teleport through undergrowth, Disperse's reaction to damage
// ("disperses. Until the end of the current turn, it can't be attacked or targeted, …"). true or false.
function readPlaneShift(text) {
    const said = String(text).replace(/’/g, "'").trim();
    return /\bmoves? (?:itself )?(?:from the Universe to the Ethereal Plane|between the Ethereal Plane and the Material Plane)\b/i.test(said)
        || /\bcan move itself between the Ethereal Plane and the Material Plane\b/i.test(said)
        || /\bwalks? the thin line between the Ethereal(?: Plane)? and (?:the )?Universe\b/i.test(said)
        || /\b(?:collapses|disperses) into a shapeless swarm\b[^]*\bcoalesce\b/i.test(said)
        || /\breverts to pure shadow\b/i.test(said)
        || /\bmerges with the reef and vanishes\b/i.test(said)
        || /\binstantly teleports? to a (?:different )?square of (?:the forest's )?undergrowth within \d+ feet\b/i.test(said)
        || /^Trigger (?:The )?[^.;]+? takes damage from a hostile action[.;]? Effect (?:The )?[^.]+? disperses\. Until the end of the current turn, (?:it|they) can't be attacked or targeted\b/i.test(said);
}

// A form shift of its own (2026-10-11, batch 62; the user's choice for plane and form shifts: the GM's): a polymorph action that changes
// only its own shape — Change Shape's "can take on the appearance of any Small or Medium humanoid", Mimic Object, Impersonate Shape,
// Sand Form's "becomes an animated pile of sand" — with no save, damage, healing or attack of its own (not Change Size's on another
// creature, nor Fortune's Favor's save, nor one with a linked spell's effects). true or false.
function readFormShift(item, text) {
    if (!(item?.system?.traits?.value ?? []).includes("polymorph") || !["action", "free"].includes(item?.system?.actionType?.value)) return false;
    // (Not one that casts a spell's effects, Rushed Transformation's humanoid form: that's batch 37's spell, cast through PF2e.)
    if (/Compendium\.pf2e\.spells-srd\.|@Compendium\[pf2e\.spells-srd\./i.test(String(item?.system?.description?.value ?? ""))) return false;
    const said = String(text).replace(/’/g, "'");
    if (/@(?:Check|Damage)\[|\[\[\/(?!act\b)|\b(?:saving throws?|save|saves|Hit Points|temporary|heal\w*|restor\w*|regains?)\b|\bStrikes? (?:against|at)\b|\b(?:a|another|the) (?:target|willing|unwilling) creature\b|\bchanges a creature's\b|\bcombine itself\b|\bsplit into\b|\bnext spell\b/i.test(said)) return false;
    return /\b(?:appearance|shape|form|transform(?:s|ed)?|changes into|reshapes?|assumes?|unfolds|refolds|contorts|becomes (?:an? )?(?:animated|amorphous|fully)|body becomes|sprout)\b/i.test(said);
}

// No change to a fight's numbers, in its own words (2026-10-10, batch 38): a disguise that "doesn't change its Speed or its attack
// and damage modifiers with its Strikes" (Change Shape and its kin), capsizing a vessel, a Step when an ally moves next to it, two
// Strides with a bonus to its Speed (Gallop). true or false.
function readNoCombatEffect(text) {
    const said = String(text).replace(/’/g, "'").trim();
    // (Batch 213: only its reach or a Speed for a while — Coil's "increasing its reach with its fangs from 5 to 10 feet. After the goblin snake Strikes
    // with its fangs, it becomes uncoiled.", Pull Arm, Extend Vines, Mobile Morph's "they gain a climb, fly, or swim Speed of 40 feet", Jump Jets — the
    // simulation's Melee already reaches; not with a reaction, a bonus, damage or a condition.)
    // (Batch 224: Extend Limb's "granting themself a reach of 20 feet …", Extend Neck's "increasing the reach of their jaws Strike from 10 feet to 20 feet",
    // Reassemble's "increasing its reach to 25 feet and reducing its Speed to 15 feet".)
    if ((/\b(?:increasing|increases?|gaining|gains?) (?:its|their|his|her) reach\b[^.]*\bfrom \d+ to \d+ feet\b|\bgaining \d+-foot reach\b|\bhas an? \d+-foot reach\b|\bgranting (?:itself|themself|themselves) a reach of \d+ feet\b|\bincreasing the reach of (?:its|their) [\w' -]+? Strike from \d+ feet to \d+ feet\b|\bincreasing (?:its|their) reach to \d+ feet\b|\bgains? an? (?:(?:climb|fly|swim|burrow),? (?:or )?)+[Ss]peed of \d+ feet\b/i.test(said))
        && !/@|\b(?:damage|saves?|DC|bonus|penalty|Off-Guard|Reactive Strike|reactions?|Strikes? (?:against|at)|makes? an? [\w' -]+? Strike|Grabbed|Prone|Frightened|Stunned|Immobilized|Restrained|Clumsy|Enfeebled|Slowed|Quickened|Hidden|Invisible|Concealed)\b/i.test(said)) return true;
    // (Batch 55: gliding; moving a creature it holds closer; a troop's Change Formation; a Stride in dim light; befouling water; adamantine
    // claws against objects.)
    if (((/\bglides?\b/i.test(said) && /\bthrough the air\b/i.test(said)) || /\bhover \d+ foot in the air and Strides twice\b/i.test(said)) && !/\b(?:Strikes?|saves?|DC)\b|@|\bdamage\b(?! from falls)/i.test(said)) return true;
    if (/^Requirements? (?:The )?[^.]+? has a creature Grabbed in its [\w' -]+?\.? Effect (?:The )?[^.]+? moves the creature up to \d+ feet closer to it\.$|^(?:The )?[^.]+? pulls all creatures it has Grabbed \d+ feet closer to itself\.$/i.test(said)) return true;
    // (Batch 239, Battlezoo: concentrate actions allowed while it rages, for this turn; a snare it makes (a hazard of its own, as summons are the GM's).)
    if (/^Requirements? (?:The )?[^.]+? is (?:enraged|raging)\.? Effect (?:[^.]+\. )?Until the end of (?:its|their) turn, (?:the [\w' -]+?|it|they) can use (?:any )?actions with the concentrate trait,? (?:despite being (?:enraged|raging)|while (?:enraged|raging))\.$/i.test(said)) return true;
    if (/^(?:Frequency [^.]*? Effect )?(?:The )?[^.]+? (?:creates|sets) an? snare of (?:its|their) level or lower\b/i.test(said) && !/@|\b(?:damage|Strikes?|saves?)\b/i.test(said)) return true;
    // (Batch 233: Re-Arm's "forms a new stone axe or stone shield in a free hand", Hidden Pockets' Interact to draw an item from its pockets — items in hand,
    // nothing for the fight's numbers.)
    if (/^(?:The )?[^.]+? forms a new [\w' -]+?(?: or [\w' -]+?)? in a free hand\.?$/i.test(said)) return true;
    if (/^(?:Frequency once per round Effect )?(?:The )?[^.]+? Interacts to draw an item of (?:light|negligible) Bulk concealed in one of (?:its|their|his|her) [\w' -]+?\./i.test(said) && !/@|\b(?:damage|Strikes?|saves?|DC)\b/i.test(said)) return true;
    // (Batch 230, Flight Commander of Dis: "… granting themself and evil allies with fly Speeds a +20-foot status bonus to their fly Speeds for 1 round." — a
    // Speed only.)
    if (/^(?:The )?[^.]+?, granting (?:itself|themself|themselves|herself|himself)(?: and (?:[\w-]+ )?allies(?: with fly Speeds)?)? an? \+\d+-foot (?:status|circumstance) bonus to (?:its|their) (?:fly |land |swim |climb )?Speeds? for \d+ rounds?\.$/i.test(said)) return true;
    // (Batch 224, Grab and Go: a Stride or Climb taking an unattended item on the way — a move.)
    if (/^(?:The )?[^.]+? Strides or Climbs up to (?:its|their) Speed\. At any point during this movement, (?:it|they) can Interact to take a single unattended item of light Bulk or less [^.]+\.(?: Alternatively, if not in combat, [^.]+\.)?$/i.test(said)) return true;
    // (Batch 221: Deep Plunge's dive, Wriggling Rush's Stride and Swim, Swim Together's swim beside an animal, Mask Stench's suppressed aura, Quick Stow's
    // pouch — moves and nothing for the fight's numbers.)
    if (/^(?:The )?[^.]+? dives straight down into the water, moving up to twice its swim Speed in a straight vertical line\.(?: It can use this ability while grabbing a creature\.)?$/i.test(said)) return true;
    if (/^Frequency once per round;? Effect (?:The )?[^.]+? takes a Stride action and a Swim action, in either order\.(?: (?:They|It) ignores? difficult terrain from [^.]+ during this movement\.)?$/i.test(said)) return true;
    if (/^Requirements? (?:The )?[^.]+? is adjacent to an animal ally Effect (?:The )?[^.]+? and the animal both Swim, ending their movement adjacent to one another\.$/i.test(said)) return true;
    if (/^(?:The )?[^.]+? masks (?:its|their) stench with curated herbs, suppressing (?:its|their) stench aura\. (?:The [\w' -]+?|It|They) can resume (?:its|their) stench aura as a free action\.$/i.test(said)) return true;
    if (/^Frequency once per round Effect (?:The )?[^.]+? stores one held item of light or negligible Bulk in (?:its|their) cheek pouches\.$/i.test(said)) return true;
    // (Batch 219: Drag Under's "The shui gui Swims at half Speed, along with any creature it has Grabbed." — a move; Pacify's "The unit's Whirling Onslaught
    // gains the nonlethal trait until the end of their next turn." — nothing for the fight's numbers.)
    if (/^(?:The )?[^.]+? Swims at half Speed, along with any creature (?:it|they) (?:has|have) Grabbed\.$/i.test(said)) return true;
    if (/^(?:The )?[^.]+?['’]s [A-Z][\w' -]+? gains the nonlethal trait until the end of (?:its|their) next turn\.$/i.test(said)) return true;
    // (Batch 208, Determined Trudge: "The augdunar Strides at a –5 foot circumstance penalty to its Speed, ignoring difficult terrain." — a move.)
    if (/^(?:The )?[^.]+? Strides at a [-\u2013\u2212]\d+ foot circumstance penalty to (?:its|their) Speed, ignoring difficult terrain\.$/i.test(said)) return true;
    // (Batch 206, Phantom Step: "Frequency once per round Effect The ghost ape moves quickly, passing through the Ethereal Plane. They teleport up to a
    // distance equal to twice their Speed within their line of sight." — a move.)
    if (/^(?:Frequency once per (?:round|turn) Effect )?(?:The )?[^.]+? moves quickly, passing through the Ethereal Plane\. (?:It|They) teleports? up to a distance equal to twice (?:its|their) Speed within (?:its|their) line of sight\.$/i.test(said)) return true;
    // (Batch 203: Surge of Speed's "Strides three times, but it's Off-Guard until the start of its next turn."; Take Prisoner's "Interacts to pick up a Medium or
    // smaller Unconscious creature within its reach, then Strides."; Scuttle Away's "Trigger The ostovite's bone chariot is destroyed Effect The ostovite
    // within Steps or Strides." — moves.)
    if (/^(?:The )?[^.]+? Strides (?:twice|three times), but (?:it's|it is|they're|they are) Off-Guard until the start of (?:its|their) next turn\.$/i.test(said)) return true;
    if (/^(?:The )?[^.]+? Interacts to pick up an? (?:[A-Z][a-z]+ or smaller )?Unconscious creature within (?:its|their) reach, then Strides\.$/i.test(said)) return true;
    // (Batch 201, Chasm Crossing: "The mountaineer Strides twice and Leaps up to 20 feet horizontally." — a move.)
    if (/^(?:The )?[^.]+? Strides twice and Leaps up to \d+ feet (?:horizontally|vertically)\.$/i.test(said)) return true;
    // (Batch 200, Scurry: "The toady Strides, then can Hide. They can attempt to Hide from creatures without cover or being Concealed, but at a –2
    // circumstance penalty."; Stealthy Pad: "Frequency once per round Effect The leaping thief Steps, then Hides or Sneaks, ignoring difficult terrain for
    // this movement." — a move and its hiding, which the simulator doesn't play.)
    const hiding = said.replace(/\[\[\/act (hide|sneak)[^\]]*\]\](?:\{([^}]*)\})?/gi, (_all, slug, label) => label ?? slug.replace(/^\w/, (letter) => letter.toUpperCase()));
    if (/^(?:The )?[^.]+? Strides, then can Hide\. (?:It|They|He|She) can attempt to Hide from creatures without cover or being Concealed, but at a [-\u2013\u2212]\d circumstance penalty\.$/i.test(hiding)) return true;
    if (/^(?:Frequency once per (?:round|turn) Effect )?(?:The )?[^.]+? Steps, then Hides or Sneaks, ignoring difficult terrain for this movement\.$/i.test(hiding)) return true;
    // (Batch 60, Undulate: "Strides or Steps. During this movement, it can pass through spaces as narrow as 5 feet without Squeezing.")
    if (/^(?:The )?[^.]+? (?:Strides(?: up to (?:its|his|her|their) Speed)?(?: or Steps)?|Swims|Climbs|Burrows)\. During this movement, (?:it|they|he|she) can pass through spaces as narrow as \d+ feet without Squeezing\.$/i.test(said)) return true;
    if (/^(?:Frequency once per round Effect )?(?:The )?[^.]+? uses Change Formation\.(?: An? [^.]+? typically knows the [\w ]+ formations\.)?$/i.test(said)) return true;
    if (/^Requirements? (?:The )?[^.]+? is in dim light Effect (?:The )?[^.]+? Strides\. (?:He|She|It|They) (?:has|have) a \+10-foot status bonus to (?:his|her|its|their) Speed during this Stride\. The DC from shadow blending increases to [^.]+ during this Stride, and (?:the [\w' -]+?|he|she|it|they) remains? Concealed by dim light until the end of the movement, even if (?:he|she|it|they) leaves? dim light during the Stride\.$/i.test(said)) return true;
    if (/\bpermanently befouls \d+ cubic feet of liquid\b/i.test(said)) return true;
    // (Batch 192, Aquatic Drag: "Requirements The platecarpus has a creature Grabbed Effect The platecarpus Swims up to half its Speed, carrying the
    // grabbed creature with it." — a move, the creature it holds along.)
    // (Batch 196, a giant ant's: "has a Large or smaller creature Grabbed …, carrying the grabbed creature with it. It is Encumbered if the grabbed
    // creature is Medium or larger.")
    if (/^Requirements? (?:The )?[^.]+? has an? (?:[A-Z][a-z]+ or smaller )?creature Grabbed\.? Effect (?:The )?[^.]+? (?:Swims|Strides|Flies|Burrows) up to (?:half|(?:its|their) full) (?:its |their )?Speed, carrying the grabbed creature with (?:it|them)\.(?: (?:It is|They are) Encumbered if the grabbed creature is [A-Z][a-z]+ or larger\.)?$/i.test(said)) return true;
    // (Batch 196, Haul Away: "Requirements The giant ant army has at least one creature Restrained Effect The army Strides up to its Speed, carrying any
    // restrained creatures with it. If the creature is Gargantuan, the giant ant army is Encumbered.")
    if (/^Requirements? (?:The )?[^.]+? has at least one creature Restrained\.? Effect (?:The )?[^.]+? (?:Swims|Strides|Flies|Burrows) up to (?:its|their) Speed, carrying any restrained creatures with (?:it|them)\.(?: If the creature is Gargantuan, (?:the )?[^.]+? is Encumbered\.)?$/i.test(said)) return true;
    // (Batch 191: allies' Steps only — Bark Orders' "Any allies who hear and understand this order can use a reaction to Step.", Encircling Command's
    // "Each caligni skulker within 30 feet of the skulker can Step. Each skulker can benefit from Encircling Command only once per round." — no change
    // to a fight's numbers.)
    if (/^(?:[^.]+\. )?Any allies who hear and understand this order can use a reaction to Step\.$/i.test(said)) return true;
    if (/^Each [\w' -]+? within (?:@Template\[[^\]]*\]\{)?\d+ feet\}? of (?:the [\w' -]+?|it) can Step\. Each [\w' -]+? can benefit from [\w' -]+? only once per round\.$/i.test(said)) return true;
    // (Batch 93: allies that may only take a Step or a Stride toward it, after a sentence that only tells it.)
    if (/^(?:Frequency once per (?:round|turn) Effect )?(?:[^.]+\. )?Each ally (?:in|within) \d+ feet [^.]*?can immediately (?:use a )?Step or Stride(?: action)?; (?:this|the) (?:movement|move) must (?:move|bring) them closer to [^.]+\.$/i.test(said)) return true;
    // (Batch 92: Fancy Footwork's "Steps and Strides in any order"; Coiled Leap's "Leaps up to 10 feet vertically or 30 feet horizontally".)
    if (/^(?:The )?[^.]+? (?:Steps and Strides in any order|Leaps up to \d+ feet vertically or \d+ feet horizontally)\.$/i.test(said)) return true;
    // (Batch 92, Unnatural Leap: "jumps up to their Speed horizontally, or half that vertically" — a move.)
    if (/^(?:The )?[^.]+? jumps up to (?:its|their|his|her) Speed horizontally, or half that vertically\.$/i.test(said)) return true;
    // (Batch 91, On All Fours: "Requirements The festrog has nothing in their hands Effect The festrog Strides with a +10-foot circumstance
    // bonus to their Speed." — a Stride.)
    if (/^(?:Requirements? (?:The )?[^.]+? has nothing in (?:its|their|his|her) hands Effect )?(?:The )?[^.]+? Strides with a \+\d+-foot circumstance bonus to (?:its|their|his|her) Speed\.$/i.test(said)) return true;
    // (Batch 89, Summon Steed: "The dullahan summons a war horse with elite adjustments … This steed remains until it is slain, the dullahan
    // Dismisses this effect, or …" — a creature summoned, the GM's as summons are (the user's choice of 2026-10-11).)
    if (/^(?:The )?[^.]+? summons an? [^.]+?\. This (?:steed|creature|mount|servant) remains until it is slain, [^.]+\.$/i.test(said)) return true;
    if (/^(?:Frequency one per hour Effect |Frequency once per hour Effect )?(?:The )?[^.]+? infuses (?:their|its) body with adamantine\. For the next minute, (?:their|its) melee Strikes are treated as adamantine and ignore half the Hardness of any object hit\.$/i.test(said)) return true;
    // (Batch 45: capsizing a vessel with its check, "must succeed at a @Check[athletics|dc:35] check … or the pilot's Sailing Lore DC,
    // whichever is higher"; Drench, "puts out all fires in a @Template[emanation|distance:5]. … attempts to counteract magical fires".)
    if (/^(?:The )?[^.]+? (?:tries|attempts) to capsize an (?:adjacent )?(?:aquatic )?vessel\b/i.test(said) && /\bthe pilot's Sailing Lore DC, whichever is higher\.$/i.test(said)) return true;
    if (/\bputs? out all (?:non-magical )?fires\b/i.test(said) && !/\b(?:damage|saves?|Strikes?|Hit Points|conditions?|Grabbed|Prone)\b/i.test(said)) return true;
    // (Batch 42: a statue or a corpse until it acts — "Until the next time it acts, the gargoyle appears to be a statue. It has an
    // automatic result of 32 on Deception checks and DCs to pass as a statue." — not with more for it, such as fast healing while it
    // stays still; a web line it descends on; a move and a reload, which the simulation does with its own Interact.)
    // (A requirement first that only says where it is or which of its forms it's in, then the disguise.)
    const sentences = said.replace(/^Requirements? (?:The )?[^.@]*? is in (?:an? |its |their )?[\w' -]+? Effect (?=Until\b)/i, "").split(/(?<=\.)\s+(?=[A-Z])/);
    // (Batch 83: any such object — "appears to be a door", "resembles an ordinary scarecrow", "appears as a sprawling mass of bones", "Until
    // it next acts", "an automatic result of 41 (44 in forests or swamps) on Deception and Stealth checks and DCs to pass as …". Not one
    // that also turns its aura off, gives it fast healing, Engulfs or Strikes.)
    // (Batch 212: the automatic result in the disguise's own sentence — until it next acts, while flattened, while prone; a sentence before it
    // saying how it settles or flattens; a Bulk of coins or goods it can hide among after.)
    const until = "Until (?:the next time (?:it|they|he|she|the [\\w' -]+?) (?:acts?|uses? an action)|(?:it|they|he|she|the [\\w' -]+?) (?:next )?acts?)";
    const automatic = /\b(?:has|have|gets?) an automatic result of \d+(?: \([^)]*\))? on (?:(?:their|its) )?(?:Deception|@Check\[deception\])(?: and Stealth)? checks and DCs to (?:convincingly )?(?:pass as|appear as|appear to be) [^.]+\.$/i;
    const quiet = (sentence) => !/@|\d|\b(?:fast healing|regeneration|damage|Hit Points|HP|bonus|penalty|Strikes?|saves?|DC|conditions?|aura|Engulf\w*|Grabbed)\b/i.test(sentence.replace(/\b\d+ Bulk\b/g, "Bulk"));
    const disguise = sentences.findIndex((sentence) => new RegExp(`^${until}, (?:the )?[^.]+? (?:appears? to be|appears? as|resembles?) [^.]+\\.$`, "i").test(sentence)
        || (automatic.test(sentence) && new RegExp(`^(?:${until}|While [\\w-]+|As long as (?:it|they) (?:remains?|stays?|is) [\\w-]+), (?:the )?[^.,]+? (?:has|have|gets?) an automatic result\\b`, "i").test(sentence))
        // (Batch 234, Battlezoo: "It has an automatic result of … until it acts again." — the time after it.)
        || (automatic.test(sentence) && /^(?:It|They|The [\w' -]+?) (?:has|have|gets?) an automatic result\b[^.]*\buntil (?:it|they) (?:acts? again|next acts?)\.$/i.test(sentence)));
    if (disguise >= 0) {
        return sentences.every((sentence, index) => index === disguise
            || automatic.test(sentence)
            || /^A creature must succeed at a @Check\[perception[^\]]*\] check to figure out that the statue is really a creature\.$/i.test(sentence)
            || (index < disguise && (/, falls Prone, and lies completely still\.$/i.test(sentence) || /^(?:The )?[^.]+? drops (?:@\w+\[[^\]]*\]\{Prone\}|Prone) and (?:goes limp|lies still)\.$/i.test(sentence) || quiet(sentence)))
            || (index > disguise && quiet(sentence)));
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

// A basic action at each creature in its reach (2026-10-11, batch 45, Knocking Sweep): "The ki adept swings their weapon with a
// sweeping spin. They attempt separate Athletics checks to Trip any number of creatures within their reach. Each attempt counts toward
// the ki adept's multiple attack penalty, but the multiple attack penalty doesn't increase until after they make all the attacks." →
// { action: "trip", sameMap, oncePerTurn? }, or null.
function readSkillSweep(text) {
    let said = String(text).replace(/\[\[\/act ([\w-]+)[^\]]*\]\](?:\{([^}]*)\})?/g, (_all, slug, label) => label ?? slug.replace(/^\w/, (letter) => letter.toUpperCase())).trim();
    let oncePerTurn = false;
    said = said.replace(/^Frequency once per (?:turn|round) Effect /i, () => {
        oncePerTurn = true;
        return "";
    });
    const sentences = said.split(/(?<=\.)\s+(?=[A-Z])/);
    if (sentences.length > 1 && !/\b(?:Strikes?|checks?|damage|save|DC|\d)\b/i.test(sentences[0])) sentences.shift();
    // (Batch 125: "attempts an Athletics check to Disarm against each enemy within their melee reach", "attempts to Grab all adjacent creatures".)
    const opening = sentences.shift() ?? "";
    const match = /^(?:The [\w' -]+?|[A-Z][\w'-]+|They|It|He|She) attempts? separate Athletics checks? to (Trip|Shove|Disarm|Grapple) any number of creatures within (?:their|its|his|her) reach\.$/i.exec(opening)
        ?? /^(?:The [\w' -]+?|[A-Z][\w'-]+|They|It|He|She) attempts? an Athletics check to (Trip|Shove|Disarm|Grapple) against each (?:enemy|foe|creature) within (?:(?:their|its|his|her) )?(?:melee )?reach\.$/i.exec(opening)
        ?? /^(?:The [\w' -]+?|[A-Z][\w'-]+|They|It|He|She) attempts? to (Grab|Trip|Shove) all adjacent creatures\.$/i.exec(opening);
    if (!match) return null;
    let sameMap = false;
    for (const sentence of sentences) {
        if (/^Each attempt counts toward [^.]*multiple attack penalty, but the (?:multiple attack )?penalty (?:doesn't|does not) increase until (?:after )?(?:they|it|he|she) (?:makes?|ha(?:ve|s) made) all the (?:attacks|attempts)\.$/i.test(sentence)) sameMap = true;
        else return null;
    }
    return { action: match[1].toLowerCase().replace(/^grab$/, "grapple"), ...(sameMap ? { sameMap } : {}), ...(oncePerTurn ? { oncePerTurn } : {}) };
}

// Only a Strike, with what comes with it the simulation doesn't play (2026-10-10, batch 37): "Calmont draws his weapon and attacks
// with the same motion. He Interacts to draw a weapon, then Strikes with that weapon." (Quick Draw), "… draws an alchemical bomb with
// an Interact action and throws it as a ranged Strike", "… reloads its sling and makes a sling Strike" (made up), "… makes a boomerang
// Strike, after which the boomerang returns to its hand", "makes a Strike with his fist and increases his reach by 5 feet for this
// Strike". Live play: the Strike from the sheet; nothing more to apply. true or false.
function readStrikeOnly(text) {
    // (Batch 204, Hurl Weapon: "The purrodaemon causes a weapon that has steeped in their flesh (see Steep Weapon) to telekinetically launch from their
    // flesh. The purrodaemon makes a hurled weapon Strike without using their hands." — its Strike.)
    if (/^(?:The )?[^.]+? causes a weapon [^.]+? to telekinetically launch from (?:its|their) flesh\. (?:The )?[^.]+? makes a hurled weapon Strike without using (?:its|their) hands\.$/i.test(String(text).trim())) return true;
    // (Batch 222, a Battlezoo crown's thrown junk: an object it picks up, thrown as its ranged Strike.)
    if (/^(?:The )?[^.]+? (?:picks up an object within reach|grabs a loose object nearby)(?: \([^)]*\))? and (?:throws it, making|hurls it as) a ranged [\w' -]+? Strike\.$/i.test(String(text).trim())) return true;
    // (Batch 151, Shadow Swipe: "makes a melee Strike. If the attack hits, the enforcer Strides. If the enforcer ends this movement in dim light or
    // darkness, they can attempt to Hide." — the move and the Hide the GM's.)
    if (/^(?:Effect )?(?:The )?[\w' -]+? makes a melee Strike\. If the attack hits, (?:the [\w' -]+?|it|they|he|she) Strides\. If (?:the [\w' -]+?|it|they|he|she) ends this movement in dim light or darkness, (?:it|they|he|she) can attempt to Hide(?:: Stealth)?\.$/i.test(String(text).trim())) return true;
    // (Batch 47: no final period, "Iloise can use Interact to draw a bomb, then Strike with it"; Lunge's other choices, "They can choose to
    // Trip their opponent instead of making a Strike", "If the weapon has the disarm, shove, or trip trait, the guard can use the
    // corresponding action instead of a Strike": the GM's.)
    // (Batch 83: a requirement that it hold the weapon, Reloading Trick's "Requirements Quara is holding an unloaded repeating hand
    // crossbow Effect …"; armor a hit damages or breaks, the GM's: Armor-Rending Bite, Rending Mandibles.)
    const sentences = String(text).trim().replace(/^Frequency once per (?:turn|round) Effect /i, "").replace(/^Requirements? (?:The )?[^.]*? is (?:holding|wielding) [^.]+? Effect /i, "").replace(/([^.])$/, "$1.").split(/(?<=\.)\s+(?=[A-Z])/)
        .filter((sentence, index) => index === 0 || !/^(?:If (?:that|the|this) Strike hits and the (?:creature|target) is wearing armor with Hardness \d+ or lower, the armor is broken|This Strike doesn't further damage armor that's already broken)\.$/i.test(sentence))
        .filter((sentence, index) => index === 0 || !/^If it hits, in addition to dealing damage, (?:the [\w' -]+?|it) Strides up to \d+ feet, dragging the (?:enemy|creature|target) along\.$/i.test(sentence))
        // (Batch 144, Trident of Dis: "If there is an unholy ally between the vordine and their target, that creature's energy causes the Strike to
        // deal an additional 1d6 spirit damage." — the GM's.)
        .filter((sentence, index) => index === 0 || !/^If there is an unholy ally between [^.]+? causes the Strike to deal an additional \d+d\d+ spirit damage\.$/i.test(sentence))
        // (Batch 136, Sudden Retreat: "It gains a +2 circumstance bonus to AC against reactions triggered by this movement." — the GM's.)
        .filter((sentence, index) => index === 0 || !/^(?:It|They|He|She) gains? a \+\d circumstance bonus to AC against reactions triggered by this movement\.$/i.test(sentence))
        .filter((sentence, index) => index === 0 || !/^(?:(?:The [\w' -]+?|They|It|He|She) can (?:choose to )?(?:Trip|Disarm|Shove)(?: or (?:Trip|Disarm|Shove))?(?: (?:their|its|his|her) opponent)? instead of (?:making )?a Strike|If the weapon has the [\w, ]+ trait, (?:the [\w' -]+?|it|they|he|she) can use the corresponding action instead of a Strike)\.$/i.test(sentence));
    // (A first sentence that only tells what it does; batch 42: "The hunter's feet and weapons move in tandem.")
    if (sentences.length === 2 && !/\b(?:damage|bonus|penalty|save|check|DC|Hit Points|HP|Grab|Prone)\b|\d/.test(sentences[0])) sentences.shift();
    if (sentences.length !== 1) return false;
    const [sentence] = sentences;
    const who = String.raw`^(?:The |An? )?[^.]+?`;
    // (Batch 47: "can use Interact to draw a bomb and then Strike with it", "Interacts to take out their machete or shortbow, then Strikes
    // with the weapon", "then Strikes with the weapon they just drew".)
    const draw = new RegExp(String.raw`${who} (?:(?:can )?(?:use )?Interacts? to (?:draw|take out|reload)|draws?) (?:a|an|his|her|its|their|your|the) [^,.]+?(?: using the Interact action| with an Interact action)?,? (?:and |then |and then )+(?:Strikes? with (?:it|that weapon|the weapon(?: (?:they|he|she|it) just drew)?)|throws it as a ranged Strike|makes? an? (?:[\w' -]+? )?Strike with it)(?:,? or [^.]+)?\.$`, "i");
    const reload = new RegExp(String.raw`${who} reloads (?:its|his|her|their) [\w' -]+? and makes an? (?:[\w' -]+? )?Strike\.$`, "i");
    const returning = new RegExp(String.raw`${who} makes an? (?:[\w' -]+? )?Strike, after which the [\w' -]+? returns to (?:its|his|her|their|the [\w' -]+?'s) hand\.$`, "i");
    // (Batch 47, Lunge: "makes a Strike with a melee weapon, increasing the reach of the Strike by 5 feet", "… with their rotcarver
    // scythe, increasing their reach by 5 feet for that Strike", "extending their reach by 5 feet for that Strike".)
    const reach = new RegExp(String.raw`${who} (?:makes an? [\w' -]+? Strike, increasing (?:his|her|its|their) reach to \d+ feet for that Strike|makes a Strike with (?:his|her|its|their) [\w' -]+? and increases (?:his|her|its|their) reach by \d+ feet for this Strike|(?:lunges [^,.]+, making|makes) an? (?:[\w' -]+? )?Strike with an? (?:extended )?reach of \d+ feet|makes a Strike with (?:a melee weapon|(?:his|her|its|their|the) [\w' -]+?), (?:increasing|extending) (?:the reach of the Strike|(?:his|her|its|their) reach) by \d+ feet(?: for (?:that|this|the) Strike)?)\.$`, "i");
    // (Batch 42, Skirmish Strike: "The hunter can Step and then Strike, or Strike and then Step.")
    // (Batch 90, Darting Strike: "Strides up to 10 feet and then makes a Strike, or makes a Strike and then Strides up to 10 feet".)
    const skirmish = new RegExp(String.raw`${who} (?:(?:can )?(?:either )?Steps? and then Strikes?,? or Strikes? and then Steps?|Strides up to \d+ feet and then makes a Strike, or makes a Strike and then Strides up to \d+ feet)\.$`, "i");
    // (Batch 80, Drag: "makes a jaws Strike against a Prone enemy. If it hits, in addition to dealing damage, the hyaenodon Strides up to 10
    // feet, dragging the enemy along." — the drag the GM's.)
    const prone = new RegExp(String.raw`${who} makes an? (?:[\w' -]+? )?Strike against an? Prone (?:enemy|creature|foe)\.$`, "i");
    // (Batch 87, Reloading Strike: "makes a melee Strike against an opponent within reach and Interacts to reload a firearm in their other hand".)
    const reloading = new RegExp(String.raw`${who} makes an? (?:melee )?Strike against an opponent within reach and Interacts to reload an? [\w' -]+? in (?:its|their|his|her) other hand\.$`, "i");
    // (Batch 83: "makes a mandibles Strike; if the Strike hits, the target's armor takes the damage and …", "makes a mandibles Strike
    // against a creature it has Grabbed" with its armor sentences above: the armor the GM's.)
    const armor = new RegExp(String.raw`${who} makes an? (?:[\w' -]+? )?Strike(?:; if the Strike hits, the target's armor takes the damage[^.]*| against a creature it has Grabbed)\.$`, "i");
    // (Batch 136, Sudden Retreat: "makes a tail Strike, then Swims with a +10-foot circumstance bonus to its swim Speed" — the move the GM's.)
    // (Not after a move of its own: Daredevil Strike's "Strides up to their Speed, makes a melee Strike, then Steps".)
    // (Batch 150, Weapon Adept: "can Swap between his glaive and composite shortbow, then Strike with the weapon he switched to".)
    const swap = new RegExp(String.raw`${who} can Swap between (?:his|her|its|their) [\w' -]+? and [\w' -]+?, then Strike with the weapon (?:he|she|it|they) switched to\.$`, "i");
    const away = new RegExp(String.raw`^(?:The |An? )?(?:(?!\b(?:Strides|Steps|Flies|Swims|Climbs|Leaps)\b)[^.])+? makes an? (?:[\w' -]+? )?Strike, then (?:Swims|Strides|Steps|Flies|Climbs)(?: with an? \+\d+-foot circumstance bonus to (?:its|their|his|her) (?:swim |fly )?Speed)?\.$`, "i");
    return [draw, reload, returning, reach, skirmish, prone, reloading, away, swap].some((pattern) => pattern.test(sentence)) || (armor.test(sentence) && /\barmor\b/i.test(text));
}
