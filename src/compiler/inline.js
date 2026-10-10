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
//   @Check[type:will|dc:31]{basic Will} (basic only in its label) → @Check[type:will|dc:31|basic]{basic Will}
const LEGACY = /\[\[\/r(?:oll)? |@Compendium\[|\bbasic @Check\[(?![^\]]*\bbasic\b)|@UUID\[Compendium\.[\w-]+\.[\w-]+\.[A-Za-z0-9]{16}\]|@Check\[(?![^\]]*\bbasic\b)[^\]]*\]\{[^}]*\bbasic\b/i;
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
        .replace(/@Check\[((?![^\]]*\bbasic\b)[^\]]*)\](\{[^}]*\bbasic\b[^}]*\})/gi, "@Check[$1|basic]$2")
        .replace(/\[\[\/r(?:oll)? ((?:[^[\]]|\[[^[\]]*\])+?)\]\](?:\{([^}]*)\})?/g, (match, roll, label) => {
            const formula = roll.trim().replace(/^\{([\s\S]*)\}$/, "$1").trim();
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
    const lasting = /\b(?:for )?as long as (?:it|they|the creature|the target)(?:'s|'re| is| are| remains?| stays?) (frightened|sickened|grabbed|restrained)\b/i.exec(plain);
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
        if (/^\s*If\b(?! (?:it|the (?:Strike|attack|strike)|this (?:Strike|attack)) (?:critically )?hits\b)/i.test(plain)) continue;
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
        for (const [slug, value] of found) {
            // Once each: a later sentence naming it again ("…falls Unconscious. … while unconscious") adds nothing.
            if (effects.some((effect) => effect.slug === slug)) continue;
            // Prone has no duration, nor a condition tied to itself. Frightened fades by its own rule: a stated
            // time is its own only straight after it ("Frightened 2 for 1 minute") or when it can't be reduced;
            // otherwise the time is the other condition's ("Confused for 1 round and Frightened 2",
            // "Frightened 2 and slowed 1 for 1 minute", "Frightened 1 … and is then temporarily immune for 1 minute").
            const own = ["prone"].includes(slug) || (duration?.mode === "while" && duration.condition === slug) || (slug === "frightened" && duration?.mode === "fixed" && !FRIGHTENED_TIMED.test(plain.replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")));
            effects.push({ kind: "condition", slug, value, duration: own ? null : duration, ...(self ? { recipient: "self" } : {}) });
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

// "push your target up to 10 feet away" → { kind: "push", distance: 10 }.
export function readPush(text) {
    const plain = htmlToPlainText(text);
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
