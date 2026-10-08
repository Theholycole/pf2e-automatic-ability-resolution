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
        if (part === "basic") check.basic = true;
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
    return plain ? plain[1] : null;
}

// "within 100 feet" / "up to 60 feet" / "range 30 feet" → 100.
export function readRange(text) {
    const match = /\b(?:within|up to|range(?: of)?|out to)\s+(\d+)\s*(?:feet|foot|ft)/i.exec(String(text ?? ""));
    return match ? Number(match[1]) : null;
}

const CONDITION_LINK = /@UUID\[Compendium\.pf2e\.conditionitems\.Item\.[A-Za-z0-9]+\]\{([A-Za-z-]+(?: [A-Za-z-]+)?)(?: (\d+))?\}/g;
// Conditions PF2e's text names without a link.
const PLAIN_CONDITIONS = ["restrained", "grabbed", "prone", "off-guard", "frightened", "immobilized"];

// "until the end of your next turn" and the like → a duration, or null.
export function readDuration(text) {
    const plain = String(text ?? "");
    if (/until the end of (?:your|its|the monster's|the creature's) next turn/i.test(plain)) return { mode: "fixed", value: 1, unit: "rounds", expiry: "turn-end", anchor: "source-turn" };
    if (/until the (?:start|beginning) of (?:your|its|the monster's) next turn/i.test(plain)) return { mode: "fixed", value: 1, unit: "rounds", expiry: "turn-start", anchor: "source-turn" };
    if (/(?:before|until) the end of (?:your|its) (?:current )?turn/i.test(plain)) return { mode: "fixed", value: 0, unit: "rounds", expiry: "turn-end", anchor: "source-turn" };
    const fixed = /\bfor (\d+) (round|minute|hour)s?\b/i.exec(plain);
    if (fixed) return { mode: "fixed", value: Number(fixed[1]), unit: `${fixed[2].toLowerCase()}s`, expiry: "turn-start", anchor: "effect-start" };
    return null;
}

// Who a sentence gives its condition to: the actor when it's about "you"
// ("You lose your balance, fall, and land prone"; "force you to fall"; "You're
// off-guard"), otherwise the target.
function recipientOf(sentence) {
    if (/\b(?:the|your) target (?:falls|lands|is|becomes|takes)\b/i.test(sentence)) return "target";
    return /\b(?:you|you're|you are)\b[^.]*\b(?:fall|land|balance|off-guard|prone|become)\b/i.test(sentence) ? "self" : "target";
}

// Sentences that end or lift a condition rather than impose it.
// ("those conditions on the target end", "it breaks free"; not "until the end of your next turn".)
const LIFTS = /\b(?:conditions?\b[^.]*\bend\b|(?:it|that|this|the effect|the condition) ends\b|break(?:s)? free|released|fail to|no longer|already had)/i;

// Conditions named in words in an affliction's stages ("2d4 poison damage and enfeebled 1").
export const STAGE_CONDITIONS = [...PLAIN_CONDITIONS, "enfeebled", "clumsy", "drained", "stupefied", "sickened", "slowed", "stunned", "fatigued", "dazzled", "blinded", "deafened", "confused", "paralyzed", "unconscious", "doomed", "fleeing", "fascinated", "controlled", "wounded", "petrified"];

// Conditions a passage imposes: [{ kind: "condition", slug, value, duration, recipient? }],
// linked or named in words, sentence by sentence. plain: the condition words to look for unlinked.
export function readConditions(html, { plain: plainConditions = PLAIN_CONDITIONS } = {}) {
    const effects = [];
    const sentences = String(html ?? "").split(/(?<=[.!?])\s+(?=[A-Z@<])/);
    for (const sentence of sentences) {
        const plain = htmlToPlainText(sentence);
        if (LIFTS.test(plain)) continue;
        // Only some creatures ("Animals are also paralyzed", "Undead creatures are…"): left out.
        if (/^\s*(?:[A-Z][a-z]+s|[A-Z][a-z]+ creatures|Creatures (?:with|that|of)\b[^.]*?)\s+(?:are|become|is)\b/.test(plain)) continue;
        const duration = readDuration(plain);
        const self = recipientOf(plain) === "self";
        const found = new Map();
        for (const match of sentence.matchAll(CONDITION_LINK)) {
            const slug = match[1].toLowerCase().replace(/\s+/g, "-");
            found.set(slug, match[2] ? Number(match[2]) : null);
        }
        const unlinked = htmlToPlainText(sentence.replace(CONDITION_LINK, ""));
        for (const slug of plainConditions) {
            if (found.has(slug)) continue;
            const named = new RegExp(`\\b${slug}(?: (\\d+))?\\b`, "i").exec(unlinked);
            if (named) found.set(slug, named[1] ? Number(named[1]) : null);
        }
        for (const [slug, value] of found) {
            // Frightened and the like fade by their own rules; a stated duration still applies.
            effects.push({ kind: "condition", slug, value, duration: ["prone"].includes(slug) ? null : duration, ...(self ? { recipient: "self" } : {}) });
        }
    }
    return effects;
}

// "temporarily immune … for 10 minutes" → { scope: "target", raw }, or null.
export function readImmunity(html) {
    const plain = htmlToPlainText(html);
    const match = /[^.]*\btemporarily immune\b[^.]*\./i.exec(plain);
    return match ? immunityDetails(match[0].trim()) : null;
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
        : /\bregardless\b/i.test(raw) ? ALL_DEGREES
        : /\bsucceeds?\b|\bsuccessful(?:ly)?\b|^Success\b/i.test(raw) ? ["criticalSuccess", "success"]
        : ALL_DEGREES;
    return { scope: "target", raw, duration: { value, unit }, degrees: [...degrees], against: /\bimmune to all\b/i.test(raw) ? "all" : "source" };
}

// "push your target up to 10 feet away" → { kind: "push", distance: 10 }.
export function readPush(text) {
    const match = /\bpush(?:es)? (?:your |the )?(?:target|creature|it)?\s*(?:back |up to |away )?(\d+) (?:feet|foot)/i.exec(htmlToPlainText(text));
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
