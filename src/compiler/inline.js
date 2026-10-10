// Readers for PF2e's inline description syntax, as abilities use it:
//   @Check[reflex|dc:33|basic|options:area-effect]
//   @Damage[11d8[bludgeoning]|options:area-damage]   @Damage[(3d6+21)[bludgeoning]]
//   @Template[cone|distance:40]
//   [[/gmr 1d4 #Recharge Avalanche Breath]]{1d4 rounds}
//   @UUID[Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL]{Frightened 2}
// and the outcome sections (Critical Success, Success, Failure, Critical Failure).

import { htmlToPlainText } from "../../../pf2e-resolution-core/src/text/plain-text.js";

const SAVES = new Set(["fortitude", "reflex", "will"]);

// The parameter string of each @Tag[...] (brackets inside are balanced).
export function inlineTags(html, tag) {
    const text = String(html ?? "");
    const found = [];
    const opening = `@${tag}[`;
    let at = text.indexOf(opening);
    while (at >= 0) {
        let depth = 0;
        let end = -1;
        for (let index = at + opening.length - 1; index < text.length; index++) {
            if (text[index] === "[") depth++;
            else if (text[index] === "]" && --depth === 0) {
                end = index;
                break;
            }
        }
        if (end < 0) break;
        found.push(text.slice(at + opening.length, end));
        at = text.indexOf(opening, end);
    }
    return found;
}

// Older inline syntax that other publishers' monsters still use (the Battlezoo
// bestiaries, 2026-10-10), rewritten in PF2e's current form. PF2e's own text has
// none of it, so that passes through unchanged.
//   [[/r (2d8 + 13)[piercing]]] → @Damage[(2d8 + 13)[piercing]] (a roll with a damage type;
//     a label such as {4d6 fire damage} becomes " damage")
//   @Compendium[pf2e.conditionitems.TkIyaNPgTZFBCCuh]{Dazzled} → @UUID[Compendium.pf2e.conditionitems.Item.TkIyaNPgTZFBCCuh]{Dazzled}
//     (by name too: @Compendium[pf2e.conditionitems.Sickened]{Sickened 1})
//   "basic @Check[type:reflex|dc:40] save" → the check marked basic
//   @UUID[Compendium.pf2e.conditionitems.dfCMdR4wnpbYNTix] (no document type) → the same with .Item.
//   @UUID[Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg] (no label) → the same with {Off-Guard}
//   @Check[type:will|dc:31]{basic Will} (basic only in its label) → @Check[type:will|dc:31|basic]{basic Will}
// PF2e's condition items by ID (pf2e.conditionitems), for links written with no label.
const CONDITION_IDS = {"XgEqL1kFApUbl5Z2": "blinded", "6dNUvdb1dhToNDj3": "broken", "i3OJZU2nk64Df3xm": "clumsy", "DmAIPqOBomZ7H95W": "concealed", "yblD8fOR1J8rDwEQ": "confused", "9qGBRpbX9NEwtAAr": "controlled", "zXZjC8HLaRoLR17U": "cursebound", "TkIyaNPgTZFBCCuh": "dazzled", "9PR9y0bi4JPKnHPR": "deafened", "3uh1r86TzbQvosxv": "doomed", "4D2KBtexWXa6oUMR": "drained", "yZRUzMqrMmfLu0V1": "dying", "D5mg6Tc7Jzrj6ro7": "encumbered", "MIRkyAjyBeXivMa7": "enfeebled", "AdPVz7rbaVSRxHFg": "fascinated", "HL2l2VRSaQHu9lUw": "fatigued", "sDPxOjQ9kx2RZE8D": "fleeing", "TBSHQspnbcqxsmjL": "frightened", "kWc1fhmv9LBiTuei": "grabbed", "iU0fEDdBp3rXpTMC": "hidden", "eIcWbB5o3pP6OIMe": "immobilized", "zJxUflt9np0q4yML": "invisible", "1wQY3JYyhMYeeV2G": "observed", "AJh5ex99aV6VTggg": "off-guard", "6uEgoh53GbXuHpTF": "paralyzed", "lDVqvLKA6eF3Df60": "persistent-damage", "dTwPJuKgBQCMxixg": "petrified", "j91X7x0XSomq8d60": "prone", "nlCjDvLMf2EkV2dl": "quickened", "VcDeM8A5oI6VqhbM": "restrained", "fesd1n5eVhpCSS18": "sickened", "xYTAsEpcJE1Ccni3": "slowed", "dfCMdR4wnpbYNTix": "stunned", "e1XGnhKNSQIm5IXg": "stupefied", "fBnFDH2MTzgFijKf": "unconscious", "VRSef5y1LmL2Hkjf": "undetected", "9evPzg9E6muFcoSk": "unnoticed", "Yl48xTdMh3aeQYL2": "wounded"};
const conditionLabel = (key) => (CONDITION_IDS[key] ?? key).split("-").map((word) => word[0].toUpperCase() + word.slice(1)).join("-");

const LEGACY = /\[\[\/r(?:oll)? |@Compendium\[|\bbasic @Check\[(?![^\]]*\bbasic\b)|@UUID\[Compendium\.[\w-]+\.[\w-]+\.[A-Za-z0-9]{16}\]|@Check\[(?![^\]]*\bbasic\b)[^\]]*\]\{[^}]*\bbasic\b|@UUID\[Compendium\.pf2e\.conditionitems\.Item\.[^\]]+\](?!\{)/i;
const ACTOR_PACK = /(?:^|-)(?:bestiary(?:-\d)?|actors|monster-core(?:-\d)?|npc-gallery|npc-core)$/;
const documentType = (pack) => (ACTOR_PACK.test(pack) && !/glossary|effects/.test(pack) ? "Actor" : "Item");

export function modernInline(html) {
    const text = String(html ?? "");
    if (!LEGACY.test(text)) return text;
    const link = (_match, pack, collection, id) => `@UUID[Compendium.${pack}.${collection}.${documentType(collection)}.${id}]`;
    return text
        .replace(/@Compendium\[([\w-]+)\.([\w-]+)\.([^\]]+)\]/g, link)
        .replace(/\bbasic (@Check\[(?![^\]]*\bbasic\b)[^\]]*)\]/gi, "basic $1|basic]")
        .replace(/@UUID\[Compendium\.([\w-]+)\.([\w-]+)\.([A-Za-z0-9]{16})\]/g, link)
        // A condition link with no label: its condition's name ("@UUID[…Item.AJh5ex99aV6VTggg] for 1 round" is off-guard).
        .replace(/@UUID\[Compendium\.pf2e\.conditionitems\.Item\.([^\]]+)\](?!\{)/g, (match, key) => `${match}{${conditionLabel(key)}}`)
        .replace(/@Check\[((?![^\]]*\bbasic\b)[^\]]*)\](\{[^}]*\bbasic\b[^}]*\})/gi, "@Check[$1|basic]$2")
        .replace(/\[\[\/r(?:oll)? ((?:[^[\]]|\[[^[\]]*\])+?)\]\](?:\{([^}]*)\})?/g, (match, roll, label) => {
            const formula = roll.trim().replace(/^\{([\s\S]*)\}$/, "$1").trim();
            // No type, but labelled as damage ("[[/r {1d8 + 8}]]{1d8 + 8 damage}"): untyped damage.
            if (!formula.includes("#") && /^[\dd\s+\-*()]+$/i.test(formula) && /\dd\d/i.test(formula) && label && /\bdamage\s*$/i.test(label)) return `@Damage[(${formula.replace(/\s+/g, "")})[untyped]] damage`;
            if (formula.includes("#") || !/[\d)}]\s*\[[a-z]+(?:,\s*[a-z]+)*\]/i.test(formula)) return match;
            return `@Damage[${formula}]${label && /\bdamage\s*$/i.test(label) ? " damage" : ""}`;
        });
}

// Splits "a|b:c|d" at top-level bars.
function parameters(raw) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index <= raw.length; index++) {
        const character = raw[index];
        if (character === "[" || character === "(") depth++;
        else if (character === "]" || character === ")") depth--;
        if ((character === "|" && depth === 0) || index === raw.length) {
            parts.push(raw.slice(start, index).trim());
            start = index + 1;
        }
    }
    return parts;
}

// @Check[...] → { statistic, dc, basic, defense, options }.
export function readCheck(raw) {
    const [first, ...rest] = parameters(raw);
    const check = { statistic: (first.includes(":") ? first.split(":")[1] : first).toLowerCase(), dc: null, basic: false, defense: null, options: [] };
    if (first.startsWith("type:")) check.statistic = first.slice(5).toLowerCase();
    for (const part of rest) {
        if (part === "basic" || part === "basic:true") check.basic = true;
        else if (part.startsWith("dc:")) check.dc = Number(part.slice(3)) || null;
        else if (part.startsWith("defense:")) check.defense = part.slice(8).toLowerCase();
        else if (part.startsWith("options:")) check.options = part.slice(8).split(",");
        else if (part.startsWith("traits:")) check.traits = part.slice(7).split(",");
    }
    check.save = SAVES.has(check.statistic);
    return check;
}

// @Damage[...] → the formula (pools and flavor kept), for the core's dice reader.
export function readDamage(raw) {
    return parameters(raw)[0];
}

// @Template[cone|distance:40] → { type, value }.
export function readTemplate(raw) {
    const parts = parameters(raw);
    let type = null;
    let value = null;
    for (const part of parts) {
        if (part.startsWith("type:")) type = part.slice(5);
        else if (part.startsWith("distance:")) value = Number(part.slice(9));
        else if (!part.includes(":")) type = part;
    }
    return type && value ? { type, value } : null;
}

// "[[/gmr 1d4 #Recharge X]]" or "can't use X again for 1d4 rounds" → "1d4".
export function readRecharge(html) {
    const text = String(html ?? "");
    const roll = /\[\[\/(?:gm)?r(?:oll)? (\d+d\d+(?:\s*[+-]\s*\d+)?)[^\]]*#\s*Recharge/i.exec(text);
    if (roll) return roll[1].replace(/\s+/g, "");
    const plain = /can'?t use [^.]*? again for (\d+d\d+|\d+) rounds?/i.exec(htmlToPlainText(text));
    if (plain) return plain[1];
    // Other publishers' wording: "can't Spew Smog again for [[/br 1d4 #rounds]]{1d4 rounds}", "can't use its
    // Breath Weapon again for [[/r 1d4 #rounds]]".
    const rolled = /can(?:'?t|not) (?:use )?[^.]*? again for \[\[\/(?:gm|b|bl)?r(?:oll)? (\d+d\d+(?:\s*[+-]\s*\d+)?)[^\]]*\]\](?:\{[^}]*\})?/i.exec(text) ?? /can(?:'?t|not) [^.]*? again for (\d+d\d+|\d+) rounds?/i.exec(htmlToPlainText(text));
    return rolled ? rolled[1].replace(/\s+/g, "") : null;
}

// "within 100 feet" / "up to 60 feet" / "range 30 feet" → 100.
export function readRange(text) {
    const match = /\b(?:within|up to|range(?: of)?|out to)\s+(\d+)\s*(?:feet|foot|ft)/i.exec(String(text ?? ""));
    return match ? Number(match[1]) : null;
}

const CONDITION_LINK = /@UUID\[Compendium\.pf2e\.conditionitems\.Item\.[^\]]+\]\{([A-Za-z-]+(?: [A-Za-z-]+)?)(?: (\d+))?\}/g;
// Conditions PF2e's text names without a link.
const PLAIN_CONDITIONS = ["restrained", "grabbed", "prone", "off-guard", "frightened", "immobilized", "encumbered"];

// "until the end of your next turn" and the like → a duration, or null.
// How long a condition outlasts leaving an aura: "persists for 3 rounds after
// leaving the aura", "recovers after it has been out of the aura for 1 minute" → { value, unit }.
export function readLinger(text) {
    const match = /\b(?:persists?|lasts?) for (\d+|an?|one) (round|minute|hour)s? after (?:it leaves|leaving)\b|\bout of the (?:aura|area|emanation) for (\d+|an?|one) (round|minute|hour)s?\b|\bfor (\d+|an?|one) (round|minute|hour)s? thereafter\b/i.exec(String(text ?? ""));
    if (!match) return null;
    const [count, unit] = match[1] ? [match[1], match[2]] : match[3] ? [match[3], match[4]] : [match[5], match[6]];
    return { value: /^\d+$/.test(count) ? Number(count) : 1, unit: `${unit.toLowerCase()}s` };
}

export function readDuration(text) {
    const plain = String(text ?? "");
    // "while it remains in the area", "for as long as they remain within the aura": until it leaves.
    if (/\b(?:while|as long as) (?:it|they|the creature|the target) (?:remains?|stays?|is) (?:in|within|inside) (?:the|this|its|their) (?:aura|area|emanation)|\buntil (?:it|they)(?:'s|'re| is| are) no longer in (?:the|this|its|their) (?:aura|area|emanation)/i.test(plain)) {
        const after = readLinger(plain);
        return { mode: "in-aura", ...(after ? { after } : {}) };
    }
    // "Fleeing for as long as it's frightened", "as long as they remain frightened": while that condition lasts.
    // "for 1d4 rounds or as long as it's frightened, whichever comes first": the time (a fight's worth of the other).
    const lasting = /\bwhichever comes first\b/i.test(plain) && /\bfor (?:\d|one\b|an?\b|\[\[)/i.test(plain) ? null : /\b(?:for )?as long as (?:it|they|the creature|the target)(?:'s|'re| is| are| remains?| stays?) (frightened|sickened|grabbed|restrained)\b/i.exec(plain);
    if (lasting) return { mode: "while", condition: lasting[1].toLowerCase() };
    // "Fleeing during their next turn": until the end of that turn, as "until the end of its next turn".
    if (/until the end of (?:your|its|their|the monster's|the creature's|the target's|the [\w' -]+?'s) next turn|\bduring (?:its|their|the creature's|the target's) next turn\b/i.test(plain)) return { mode: "fixed", value: 1, unit: "rounds", expiry: "turn-end", anchor: "source-turn" };
    if (/until the (?:start|beginning) of (?:your|its|their|the monster's|the creature's|the target's) next turn/i.test(plain)) return { mode: "fixed", value: 1, unit: "rounds", expiry: "turn-start", anchor: "source-turn" };
    // "for [[/br 1d4 #rounds]]{1d4 rounds}", "for 1d4 rounds": rolled when it's applied (valueRoll); the
    // average, rounded down, where nothing rolls (the simulator). Not a recharge ("can't use it again for 1d4 rounds").
    // The unit is the roll's label, its flavor or the word after it ("[[/r 1d4 #hours]] hours" is hours, not rounds);
    // the first stated time counts ("Confused for 1 round and … for 1d4 hours").
    const rolled = /\bfor (?:\[\[\/(?:gm|b|bl)?r(?:oll)? (\d+)d(\d+)((?:\s*[+-]\s*\d+)?)\b([^\]]*)\]\](?:\{([^}]*)\})?( (?:round|minute|hour|day)s?\b)?|(\d+)d(\d+)((?:\s*[+-]\s*\d+)?) (round|minute|hour|day)s?\b)/i.exec(plain);
    const fixed = /\bfor (\d+|one|two|three|four|five|six|ten) (round|minute|hour)s?\b/i.exec(plain);
    if (rolled && !/\bagain for\s*$/i.test(plain.slice(0, rolled.index + 4)) && !(fixed && fixed.index < rolled.index)) {
        const [count, sides, plus] = rolled[1] ? [rolled[1], rolled[2], rolled[3]] : [rolled[7], rolled[8], rolled[9]];
        const unit = (rolled[1] ? /\b(round|minute|hour|day)s?\b/i.exec(`${rolled[5] ?? ""} ${rolled[4] ?? ""} ${rolled[6] ?? ""}`)?.[1] : rolled[10])?.toLowerCase();
        const bonus = Number(String(plus ?? "").replace(/\s+/g, "")) || 0;
        if (unit) return { mode: "fixed", value: Math.floor((Number(count) * (Number(sides) + 1)) / 2) + bonus, valueRoll: `${count}d${sides}${bonus ? (bonus > 0 ? `+${bonus}` : bonus) : ""}`, unit: `${unit}s`, expiry: "turn-start", anchor: "effect-start" };
    }
    if (/(?:before|until) the end of (?:your|its) (?:current )?turn/i.test(plain)) return { mode: "fixed", value: 0, unit: "rounds", expiry: "turn-end", anchor: "source-turn" };
    const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ten: 10 };
    if (fixed) return { mode: "fixed", value: Number(fixed[1]) || NUMBER_WORDS[fixed[1].toLowerCase()], unit: `${fixed[2].toLowerCase()}s`, expiry: "turn-start", anchor: "effect-start" };
    // "Immobilized until it's no longer frightened", when no time is stated ("for 1d4 rounds (or until it's no longer
    // frightened, whichever comes first)" keeps its rounds).
    const until = /\buntil (?:it|they|the creature|the target)(?:'s|'re| is| are) no longer (frightened|sickened|grabbed|restrained)\b/i.exec(plain);
    if (until) return { mode: "while", condition: until[1].toLowerCase() };
    return null;
}

// Who a sentence gives its condition to: the actor when it's about "you"
// ("You lose your balance, fall, and land prone"; "force you to fall"; "You're
// off-guard"), otherwise the target.
function recipientOf(sentence) {
    if (/\b(?:the|your) target (?:falls|lands|is|becomes|takes)\b/i.test(sentence)) return "target";
    return /\b(?:you|you're|you are)\b[^.]*\b(?:fall|land|balance|off-guard|prone|become)\b/i.test(sentence) ? "self" : "target";
}

// A sentence whose stated time is frightened's own (see readConditions).
const FRIGHTENED_TIMED = /\bfrightened(?: \d+)? (?:for|until)\b|\b(?:can't|cannot|can not) reduce\b[^.]*\bfrightened\b|\bfrightened (?:condition|value) (?:can't|cannot) be reduced\b/i;

// Sentences that end or lift a condition rather than impose it.
// ("those conditions on the target end", "it breaks free"; not "until the end of your next turn".)
const LIFTS = /\b(?:conditions?\b[^.]*\bend\b|(?:it|that|this|the effect|the condition) ends\b|break(?:s)? free|released|fail to|(?<!until (?:it|they|the creature|the target)(?:'s|'re| is| are) )no longer|already had|\bconditions?\b[^.]*?\b(?:is|are) removed\b|\bremoves? (?:the|its|their|any) [\w-]+ conditions?\b|(?<!(?:n't|not|cannot) )reduces? (?:its|the|their) [\w-]+ (?:condition|value)\b)/i;

// Conditions named in words in an affliction's stages ("2d4 poison damage and enfeebled 1").
export const STAGE_CONDITIONS = [...PLAIN_CONDITIONS, "enfeebled", "clumsy", "drained", "stupefied", "sickened", "slowed", "stunned", "fatigued", "dazzled", "blinded", "deafened", "confused", "paralyzed", "unconscious", "doomed", "fleeing", "fascinated", "controlled", "wounded", "petrified"];

// The time written straight after a condition's name, up to the next condition named ("Off-Guard for 1 round and
// Deafened for 1 minute": off-guard's 1 round, deafened's 1 minute), or null.
function ownDuration(sentence, slug, slugs) {
    const words = htmlToPlainText(String(sentence).replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1"));
    const at = new RegExp(`\\b${slug}\\b(?: \\d+)?`, "i").exec(words);
    if (!at) return null;
    const rest = words.slice(at.index + at[0].length);
    if (!/^\s*(?:for|until)\b/i.test(rest)) return null;
    let end = rest.length;
    for (const other of slugs) {
        if (other === slug) continue;
        const next = new RegExp(`\\b${other}\\b`, "i").exec(rest);
        if (next && next.index < end) end = next.index;
    }
    return readDuration(rest.slice(0, end));
}

// Of the conditions named before a phrase in a sentence, the one named last (null when none is).
function lastBefore(sentence, slugs, phrase) {
    const words = htmlToPlainText(String(sentence).replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1"));
    const at = words.search(phrase);
    if (at < 0) return null;
    let best = null;
    for (const slug of slugs) {
        const mentions = [...words.slice(0, at).matchAll(new RegExp(`\\b${slug}\\b`, "gi"))];
        const last = mentions.at(-1)?.index ?? -1;
        if (last >= 0 && (!best || last > best.at)) best = { slug, at: last };
    }
    return best?.slug ?? null;
}

// Every mention of a condition in a sentence follows a negation ("is not Confused", "doesn't fall Prone";
// not "Frightened 1 and can't reduce its frightened value").
function onlyNegated(sentence, slug) {
    const words = htmlToPlainText(String(sentence).replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1"));
    const mentions = [...words.matchAll(new RegExp(`\\b${slug}\\b`, "gi"))];
    // …or only as what ends it ("for 1 minute or until being rendered Unconscious").
    return mentions.length > 0 && mentions.every((mention) => /(?:\bnot|n't|\bnever|\bwithout|\bno longer)\s+(?:[\w-]+\s+){0,2}$|\buntil\s+(?:being |it is |it's |they are )?(?:rendered |knocked |made |no longer )?$/i.test(words.slice(0, mention.index)));
}

// Conditions named as alternatives in a sentence ("Enfeebled 1, Clumsy 1, or Stupefied 1"): two or more
// different ones joined by "or". Not one condition at two values ("Stunned 1, or Stunned 3 on a critical failure").
const CHOICE_NAMES = [...new Set([...STAGE_CONDITIONS, "concealed", "hidden", "invisible", "undetected", "quickened", "dying"])].join("|");
// Each may carry its own time ("Clumsy 2 for 1 minute, Enfeebled 2 for 1 minute, or Drained 1").
const CHOICE_ITEM = `(?:${CHOICE_NAMES})(?: \\d+)?(?: for (?:\\d+|an?|one) (?:round|minute|hour|day)s?)?`;
const CHOICE = new RegExp(`\\b${CHOICE_ITEM}(?:, ${CHOICE_ITEM})*,? or ${CHOICE_ITEM}\\b`, "gi");
function choiceSlugs(sentence) {
    const words = htmlToPlainText(String(sentence).replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1"));
    const slugs = new Set();
    for (const match of words.matchAll(CHOICE)) {
        // "Clumsy 1, or Clumsy 2 and Enfeebled 1 on a critical failure": the critical failure's own, not a choice.
        if (/^\s*(?:\w+ \d+ )?(?:and \w+(?: \d+)? )?(?:on a critical|instead\b|if\b)/i.test(words.slice(match.index + match[0].length))) continue;
        const named = new Set([...match[0].matchAll(new RegExp(`\\b(${CHOICE_NAMES})\\b`, "gi"))].map((name) => name[1].toLowerCase()));
        if (named.size >= 2) for (const slug of named) slugs.add(slug);
    }
    return slugs;
}

// Conditions a passage imposes: [{ kind: "condition", slug, value, duration, recipient? }],
// linked or named in words, sentence by sentence. plain: the condition words to look for unlinked.
// A sentence that only applies in some case ("If the creature would collide with the wall, they take 1d10+5 damage"),
// other than a Strike's hit ("If the Strike hits, …").
const IF_ONLY = /^\s*If\b(?! (?:it|the (?:Strike|attack|strike)|this (?:Strike|attack)) (?:critically )?hits\b)/i;
// Sentences, also those ended by a list item or paragraph ("…then stop.</li><li><strong>Discordant Blast</strong>").
const SENTENCES = /(?<=[.!?])\s+(?=[A-Z@<])/;
export const sentencesOf = (html) => String(html ?? "").replace(/(?<=[.!?])((?:<\/?(?:p|li|ul|ol|br)\b[^>]*>)+)/gi, "$1 ").split(SENTENCES);
// The html without its "If…" sentences: what always happens.
export function unconditional(html) {
    return sentencesOf(html).filter((sentence) => !IF_ONLY.test(htmlToPlainText(sentence))).join(" ");
}

// Its "If…" sentences that deal damage, as text for the GM ("If the creature would collide with the wall, they take
// 1d10+5 bludgeoning damage.").
export function conditionalDamage(html) {
    return sentencesOf(html).filter((sentence) => IF_ONLY.test(htmlToPlainText(sentence)) && /@Damage\[/.test(sentence)).map(readableText);
}

// Inline syntax as words: "@Damage[(2d10+5)[bludgeoning]]" → "2d10+5 bludgeoning", "@Check[reflex|dc:29|basic]" →
// "DC 29 basic Reflex", "@UUID[…]{Stunned 1}" → "Stunned 1".
export function readableText(html) {
    let text = String(html ?? "");
    for (const raw of inlineTags(text, "Damage")) {
        // Its parts, split at the "+" and "," outside brackets: "1d6[fire],(2d6+3)[cold]".
        const parts = [];
        let depth = 0;
        let start = 0;
        const formula = parameters(raw)[0];
        for (let index = 0; index <= formula.length; index++) {
            const character = formula[index];
            if (character === "[" || character === "(") depth++;
            else if (character === "]" || character === ")") depth--;
            if (index === formula.length || (depth === 0 && (character === "+" || character === ","))) {
                parts.push(formula.slice(start, index).trim());
                start = index + 1;
            }
        }
        const words = parts.filter(Boolean).map((part) => {
            const match = /^\(?(.+?)\)?\[([\w,-]+)\]$/.exec(part);
            return match ? `${match[1]} ${match[2].replaceAll(",", " ")}` : part;
        });
        // Its label when it has one ("@Damage[(5[splash])[acid]]{5 acid splash}").
        text = text.replace(new RegExp(`@Damage\\[${raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\](?:\\{([^}]*)\\})?`), (whole, label) => label ?? words.join(" plus "));
    }
    for (const raw of inlineTags(text, "Check")) {
        const check = readCheck(raw);
        const name = check.statistic ? check.statistic[0].toUpperCase() + check.statistic.slice(1) : "";
        text = text.replace(`@Check[${raw}]`, [check.dc ? `DC ${check.dc}` : null, check.basic ? "basic" : null, name].filter(Boolean).join(" "));
    }
    return htmlToPlainText(text.replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@Template\[([^\]]*)\](?:\{([^}]*)\})?/g, (whole, raw, label) => label ?? (readTemplate(raw) ? `${readTemplate(raw).value}-foot ${readTemplate(raw).type}` : ""))).replace(/\s+/g, " ").trim();
}

export function readConditions(html, { plain: plainConditions = PLAIN_CONDITIONS } = {}) {
    const effects = [];
    const sentences = String(html ?? "").split(/(?<=[.!?])\s+(?=[A-Z@<])/);
    for (const whole of sentences) {
        // "…and takes one of the following additional effects, chosen by the GM: …": those are the GM's.
        const sentence = whole.split(/\bone of the following\b/i)[0];
        const plain = htmlToPlainText(sentence);
        if (LIFTS.test(plain)) continue;
        // Only some creatures ("Animals are also paralyzed", "Undead creatures are…"): left out.
        if (/^\s*(?:[A-Z][a-z]+s|[A-Z][a-z]+ creatures|Creatures (?:with|that|of)\b[^.]*?)\s+(?:are|become|is)\b/.test(plain)) continue;
        // Only if it already has a condition ("If the creature is already encumbered, it is immobilized"), or another
        // state or a later save ("If the target was Dying, it remains Unconscious", "If it's still unconscious after
        // 1 minute", "If it fails, it's Controlled on that turn" inside a result): the GM's.
        if (/\bif (?:the creature|it|the target|they)(?:'s|'re| is| are| was| were) already\b|\bwhile already\b/i.test(plain)) continue;
        if (IF_ONLY.test(plain)) continue;
        // Some other set of creatures, or a later state ("A creature unable to act due to the slowed condition … is
        // Petrified permanently", "A creature that is already slowed is instead stunned").
        if (/^\s*(?:A|Any|Each) creature (?:that|who|unable|reduced|whose)\b(?! (?:fails|critically fails|is hit|is struck|takes damage))/i.test(plain)) continue;
        const duration = readDuration(plain);
        const self = recipientOf(plain) === "self";
        const found = new Map();
        // "Doomed 1 for as long as it is sickened": the phrase names the duration, not a condition of its own.
        const scan = duration?.mode === "while" ? sentence.replace(/\b(?:(?:for )?as long as (?:it|they|the creature|the target)(?:'s|'re| is| are| remains?| stays?)|until (?:it|they|the creature|the target)(?:'s|'re| is| are) no longer) (?:@UUID\[[^\]]*\]\{[^}]*\}|[a-z]+)/i, "") : sentence;
        for (const match of scan.matchAll(CONDITION_LINK)) {
            const slug = match[1].toLowerCase().replace(/\s+/g, "-");
            if (!found.has(slug)) found.set(slug, match[2] ? Number(match[2]) : null);
        }
        const unlinked = htmlToPlainText(scan.replace(CONDITION_LINK, ""));
        for (const slug of plainConditions) {
            if (found.has(slug)) continue;
            const named = new RegExp(`\\b${slug}(?: (\\d+))?\\b`, "i").exec(unlinked);
            if (named) found.set(slug, named[1] ? Number(named[1]) : null);
        }
        // A choice ("Enfeebled 1, Clumsy 1, or Stupefied 1, depending on …", "grabbed or restrained"): the GM's.
        for (const slug of choiceSlugs(scan)) found.delete(slug);
        // Named only as what doesn't happen ("is not Confused", "They do not fall prone").
        for (const slug of [...found.keys()]) if (onlyNegated(scan, slug)) found.delete(slug);
        // "Doomed 1, Frightened 4, and Fleeing for as long as they remain frightened": the time is the last one's
        // before the phrase (fleeing), not the others'.
        const whileOf = duration?.mode === "while" ? lastBefore(sentence, [...found.keys()], /\b(?:for )?as long as\b|\buntil (?:it|they|the creature|the target)(?:'s|'re| is| are) no longer\b/i) : null;
        for (const [slug, value] of found) {
            // Once each: a later sentence naming it again ("…falls Unconscious. … while unconscious") adds nothing.
            if (effects.some((effect) => effect.slug === slug)) continue;
            // Prone has no duration, nor a condition tied to itself. Frightened fades by its own rule: a stated
            // time is its own only straight after it ("Frightened 2 for 1 minute") or when it can't be reduced;
            // otherwise the time is the other condition's ("Confused for 1 round and Frightened 2",
            // "Frightened 2 and slowed 1 for 1 minute", "Frightened 1 … and is then temporarily immune for 1 minute").
            // A time written right after the condition is its own ("Off-Guard for 1 round and Deafened for 1 minute").
            const mine = ownDuration(sentence, slug, [...found.keys()]);
            const time = mine ?? duration;
            // Stunned with a value counts itself down; it takes no timer.
            const own = ["prone"].includes(slug) || (slug === "stunned" && Number.isFinite(value)) || (!mine && duration?.mode === "while" && (duration.condition === slug || (whileOf && whileOf !== slug))) || (time?.mode === "while" && time.condition === slug) || (slug === "frightened" && time?.mode === "fixed" && !FRIGHTENED_TIMED.test(plain.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")))
                // Sickened ends by retching: a time is its own only straight after it, or when it can't be reduced.
                || (slug === "sickened" && time?.mode === "fixed" && !mine && !/\b(?:can't|cannot|can not) (?:reduce|recover)\b/i.test(plain));
            effects.push({ kind: "condition", slug, value, duration: own ? null : time, ...(self ? { recipient: "self" } : {}) });
        }
    }
    return effects;
}

// "temporarily immune … for 10 minutes" → { scope: "target", raw }, or null.
// names: the ability's and the creature's, which an "immune to …" sentence must name to be about this ability.
export function readImmunity(html, names = []) {
    // Each result heading and each line its own sentence ("…save\nCritical Success The creature is unaffected and immune…").
    const plain = htmlToPlainText(String(html ?? "").replace(/<strong>\s*(Critical Success|Success|Failure|Critical Failure)\s*<\/strong>/gi, "\n$1")).replace(/\s*\n+\s*/g, ". ").replace(/\.\s*\./g, ".");
    const temporarily = /[^.]*\btemporarily immune\b[^.]*\./i.exec(plain);
    if (temporarily) return immunityDetails(temporarily[0].trim());
    // "is then immune to the hantu denai's Terrifying Cry for 1 minute", "immune to this ability for 24 hours";
    // not "immune to all thatchlings' distracting giggle" (another ability) or "to the sight of that creature".
    for (const match of plain.matchAll(/[^.]*\bimmune to ([^.]*?)\bfor (?:\d+|an?|one) (?:round|minute|hour|day)s?\b[^.]*\./gi)) {
        const what = match[1].toLowerCase();
        // "All of the creature's equipment is immune to Wasting Gaze": not the creature.
        if (/\b(?:equipment|items?|objects?|gear)\b[^.]*\bimmune\b/i.test(match[0])) continue;
        const own = /^(?:this|the|that|its) (?:ability|effect|effects|aura|trap|hazard)\b|^its effects\b|^the effects of\b/.test(what)
            || names.filter(Boolean).some((name) => what.includes(name.replace(/\s*\([^)]*\)\s*$/, "").toLowerCase()));
        if (own) return immunityDetails(match[0].trim());
    }
    return null;
}

const UNITS = { round: "rounds", minute: "minutes", hour: "hours", day: "days" };
const ALL_DEGREES = ["criticalSuccess", "success", "failure", "criticalFailure"];

// What a "temporarily immune" sentence grants: how long, to whom (this
// creature's ability, or "to all" of its kind), and after which results.
//   "Regardless of the result …, temporarily immune to this monster's Frightful Presence for 1 minute."
//   "A creature that succeeds at its save … is temporarily immune to all stench auras for 1 minute."
//   "Critical Success The creature is unaffected and is temporarily immune for 24 hours."
export function immunityDetails(raw) {
    const time = /\bfor (\d+|an?|one) (round|minute|hour|day)s?\b/i.exec(raw);
    const value = time ? (/^\d+$/.test(time[1]) ? Number(time[1]) : 1) : 1;
    const unit = time ? UNITS[time[2].toLowerCase()] : "minutes";
    const degrees = /^Critical Success\b|\bcritically succeeds?\b/i.test(raw) ? ["criticalSuccess"]
        : /\bregardless\b|\bsucceeds? or fails?\b|\bfails? or succeeds?\b/i.test(raw) ? ALL_DEGREES
        : /\bsucceed(?:s|ed)?\b|\bsuccessful(?:ly)?\b|^Success\b/i.test(raw) ? ["criticalSuccess", "success"]
        : ALL_DEGREES;
    return { scope: "target", raw, duration: { value, unit }, degrees: [...degrees], against: /\bimmune to all\b/i.test(raw) ? "all" : "source" };
}

// A push's direction when it isn't away from the monster ("… 10 feet in a random direction").
export const OTHER_WAY = /^\s*(?:back\s+|away\s+)?(?:in (?:a|any) (?:random )?direction|in a direction of|toward|towards|along|into the (?:air|empty air)|up\b|down\b)/i;

// "push your target up to 10 feet away" → { kind: "push", distance: 10 }; "The creature takes full damage and is pulled
// 30 feet toward the kun" → { kind: "pull", distance: 30 }, only toward the monster (names: its names, for "toward the <name>").
export function readPush(text, names = []) {
    const plain = htmlToPlainText(text);
    const own = names.filter(Boolean).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const toward = `(?:closer|nearer)(?! to (?!(?:it|them|the monster|${own || "\\0"})\\b))|(?:closer to |toward |towards )(?:it|them|the monster|itself|(?:the )?(?:[\\w'-]+ ){0,2}(?:${own || "\\0"}))\\b`;
    const pull = new RegExp(`\\bpull(?:s|ed)? (?:the (?:target|creature) |it |them )?(?:up to )?(\\d+) (?:feet|foot) (?:${toward})`, "i").exec(plain);
    if (pull) return { kind: "pull", distance: Number(pull[1]), upTo: /up to/i.test(pull[0]), optional: false, direction: "toward" };
    const match = /\bpush(?:es|ed)? (?:your |the )?(?:target|creature|it)?\s*(?:back |up to |away )?(\d+) (?:feet|foot)/i.exec(plain);
    // Only away from the monster, which is how the push is played; "in a random direction", "toward the wall", "along
    // the line" are the GM's to move.
    if (match && OTHER_WAY.test(plain.slice(match.index + match[0].length))) return null;
    return match ? { kind: "push", distance: Number(match[1]), upTo: /up to/i.test(match[0]), optional: false, direction: "away" } : null;
}

const DEGREE_LABELS = [["criticalSuccess", "Critical Success"], ["success", "Success"], ["failure", "Failure"], ["criticalFailure", "Critical Failure"]];

// The outcome sections of a description: { criticalSuccess: html, … } (missing ones absent).
export function degreeSections(html) {
    const text = String(html ?? "");
    const marks = [];
    const heading = /<strong>\s*(Critical Success|Success|Failure|Critical Failure)\s*<\/strong>/gi;
    for (const match of text.matchAll(heading)) marks.push({ label: match[1].toLowerCase(), start: match.index, end: match.index + match[0].length });
    const sections = {};
    marks.forEach((mark, index) => {
        const key = DEGREE_LABELS.find(([, label]) => label.toLowerCase() === mark.label)?.[0];
        if (key) sections[key] = text.slice(mark.end, marks[index + 1]?.start ?? text.length).replace(/<\/?(?:p|hr)[^>]*>/gi, " ").trim();
    });
    return sections;
}

// Results with nothing to say ("The creature is unaffected.", "Unaffected, and temporarily immune for 24 hours.").
const NOTHING = /^(?:[\w' -]+? (?:(?:is|are) )?)?(?:unaffected|(?:is|are)n't affected|(?:is|are) not affected)(?: by [^.,]*)?(?:,? and (?:is |becomes |are )?(?:temporarily )?immune\b[^.]*)?\.?$|^No (?:further |additional |other )?effects?\.?$|^(?:The [\w' -]+?|It|They) takes? no damage\.?$/i;
// A result row that applies nothing (no damage, conditions, push or modifiers) though its text says something ("It can't
// use reactions for 1 round", "The creature takes a –5-foot status penalty to its Speeds for one round"): its text, for the
// GM to apply by hand, in place of any notes it had ("If this brings it to the ground, it takes 10d6": the whole result).
// "As failure, except …" brings the failure's text too. The outcomes are changed in place.
// A row that applies something, but whose text has more it can't ("is fascinated for 1 minute, can't use reactions while fascinated"):
// rules of these kinds left once what it applies is taken out.
const MORE = /\bcan(?:'t|not) (?:use|take|move|speak|cast|fly|attack|see|hear|act|reduce|end|recover|regain|benefit|Stride|Step)\b|\b(?:status|circumstance|item) (?:penalty|bonus)\b|\bpenalty to\b|\bweakness\b|\bresistance\b|\bmust (?:spend|use|move|Stride|Step)\b|\bteleport|\bdies\b(?! out)|\bslain\b|\bdestroyed\b|\btransforms?\b|\bcursed\b|\bwastes?\b|\bloses? (?:its|their|\d+|an?|the)\b/i;
function hasMore(text, row) {
    let rest = text;
    for (const effect of row.effects ?? []) if (effect.slug) rest = rest.replace(new RegExp(`\\b${effect.slug.replace(/-/g, "[- ]")}\\b(?: \\d+)?`, "gi"), "");
    // Penalties it applies as modifiers, and immunity (the trigger's) are read.
    if (row.modifiers?.length) rest = rest.replace(/\b(?:status|circumstance|item) (?:penalty|bonus)\b|\bpenalty to\b/gi, "");
    return MORE.test(rest);
}

export function noteUnread(outcomes, html) {
    const sections = degreeSections(html);
    for (const [degree, label] of DEGREE_LABELS) {
        const row = outcomes?.[degree];
        const section = sections[degree];
        if (!row || !section) continue;
        const applies = (row.damage?.mode ?? "none") !== "none" || row.effects?.length || row.forcedMovement || row.modifiers?.length || row.affliction || row.noteEffects?.length || row.nativeEffects?.length || row.terminal;
        const text = readableText(section);
        if (!text || NOTHING.test(text)) continue;
        // A row that applies something: its text too when more is left for the GM, after the notes it has.
        if (applies) {
            if (hasMore(text, row)) row.manualInstructions = [...(row.manualInstructions ?? []), `{target} (${label.toLowerCase()}, the rest by hand): ${text}`];
            continue;
        }
        const like = /^As (critical success|success|failure|critical failure)\b/i.exec(text)?.[1]?.toLowerCase();
        const other = like ? DEGREE_LABELS.find(([, name]) => name.toLowerCase() === like)?.[0] : null;
        const base = other && sections[other] ? readableText(sections[other]) : null;
        row.manualInstructions = [`{target} (${label.toLowerCase()}): ${text}${base ? ` (${like}: ${base})` : ""}`];
    }
    return outcomes;
}
