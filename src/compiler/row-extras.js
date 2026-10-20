// What a save's result row says beyond its damage and conditions (2026-10-20, asked by the item module: rows it had left to the GM —
// snares, activated ammunition, oils, talismans — and monster abilities say the same), read per degree section:
//   - a penalty or bonus: "takes a –5-foot status penalty to its Speed for 1 minute", "taking a -2 circumstance penalty to ranged attack
//     rolls and a –10-foot circumstance penalty to its fly Speed", "a -1 status penalty to Stealth checks", "a –1 status penalty to attack
//     rolls against creatures other than you until the end of its next turn" (against: "others"), "gains a +2 circumstance bonus to Escape";
//   - an early end: "… or until it Escapes (DC 27)", "Both effects end early if it Escapes (DC 26)" → escape { dc } on what it ends (the DC
//     the text's, else the effect's own, its save DC — PF2e's Escape: "against the DC of the effect"); "or until it uses an Interact action
//     to remove the glitter" → until (its Effect says so: the GM's to end);
//   - a floor: "can't reduce its frightened value below 1 until it spends an action, which has the concentrate trait, …" → conditionFloor;
//   - a lowered condition: "reduces its slowed condition by 1" → { kind: "condition", slug, value: 0, stack: { by: -1 } };
//   - misfortune: "must roll twice and take the worse result on the next check it attempts" → a note Effect with PF2e's RollTwice;
//   - invisibility negated: "The target's invisibility is negated for 2 rounds" → a note Effect granting Concealed while it's Invisible
//     (PF2e's GrantItem, its predicate tested again as the creature changes); "Hidden, rather than undetected, … whenever it would
//     otherwise have been undetected" the same with Hidden.
// Pure.

import { htmlToPlainText } from "../../../pf2e-resolution-core/src/text/plain-text.js";
import { readDuration } from "./inline.js";

// PF2e's conditions, for the GrantItem of a note Effect.
const CONDITION_UUIDS = { concealed: "Compendium.pf2e.conditionitems.Item.DmAIPqOBomZ7H95W", hidden: "Compendium.pf2e.conditionitems.Item.iU0fEDdBp3rXpTMC" };
const SKILLS = ["acrobatics", "arcana", "athletics", "crafting", "deception", "diplomacy", "intimidation", "medicine", "nature", "occultism", "performance", "religion", "society", "stealth", "survival", "thievery"];
const FLOOR_SLUGS = ["clumsy", "drained", "enfeebled", "frightened", "sickened", "stupefied"];
const LOWERED_SLUGS = ["clumsy", "drained", "enfeebled", "frightened", "sickened", "slowed", "stupefied", "doomed", "stunned"];
const NUMBERS = { one: 1, a: 1, an: 1, two: 2, three: 3, ten: 10 };

// A section in words: links as their labels, "[[/act escape dc=18]]{Escapes}" as "Escapes (DC 18)".
export function rowWords(html) {
    return htmlToPlainText(String(html ?? "")
        .replace(/\[\[\/act escape\b[^\]]*?\bdc=(\d+)[^\]]*\]\](?:\{([^}]*)\})?/gi, (_all, dc, label) => `${label ?? "Escape"} (DC ${dc})`)
        .replace(/\[\[\/act ([\w-]+)[^\]]*\]\](?:\{([^}]*)\})?/gi, (_all, slug, label) => label ?? slug)
        .replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")
        .replace(/@Check\[[^\]]*\](?:\{([^}]*)\})?/g, (_all, label) => label ?? "save")
        .replace(/@Damage\[(?:[^[\]]|\[[^\]]*\])*\](?:\{([^}]*)\})?/g, (_all, label) => label ?? "damage")).replace(/\s+/g, " ").trim();
}
const sentences = (words) => words.split(/(?<=[.!?])\s+(?=[A-Z])/).map((sentence) => sentence.trim()).filter(Boolean);
const CONDITIONAL = /^\s*(?:If|When|Whenever|While|Unless|Each time)\b/i;

// "… or until it Escapes (DC 27)", "Both effects end early if it Escapes (DC 26)", "until it Escapes against a DC of 18".
const ESCAPES = /\b(?:or )?until (?:it|they|the (?:creature|target|foe)) (?:successfully )?Escapes?(?:(?: from (?:the|its) [\w' -]+?)? \(DC (\d+)\)| against a DC of (\d+))?|\b(?:both |these |the |its )?effects? ends? early if (?:it|they|the (?:creature|target|foe)) Escapes?(?: \(DC (\d+)\))?/i;
export function escapeIn(text, dc = null) {
    const match = ESCAPES.exec(String(text ?? ""));
    if (!match) return null;
    const own = Number(match[1] ?? match[2] ?? match[3]);
    const value = Number.isFinite(own) && own > 0 ? own : Number(dc);
    return Number.isFinite(value) && value > 0 ? { dc: value } : null;
}
const everything = (sentence) => /\b(?:both|these|all) (?:effects|of (?:these|them))\b[^.]*\bend early\b|\beffects? ends? early\b/i.test(sentence);

// "or until it uses an Interact action to remove the glitter" → "it uses an Interact action to remove the glitter".
// (Also another's doing, "or until the korred uses Hair Snare again"; not an Escape, nor a turn's end.)
const LIFTED = /\bor until (?!(?:it|they|the (?:creature|target|foe)) (?:successfully )?Escapes?\b|the (?:end|start|beginning) of\b)((?:it|they|the [\w' -]+?)(?: or an ally)? (?:uses|spends|is|are|dies|leaves|moves) [^.]+?)(?=\.|$)/i;
export const liftedIn = (text) => LIFTED.exec(String(text ?? ""))?.[1]?.replace(/^(?:they|the (?:creature|target|foe))(?= (?:uses|spends))/i, "it") ?? null;

// A time in words, "its next turn" the creature's own (the row is about it).
export const rowTime = (html) => timeIn(rowWords(html));
function timeIn(text) {
    const said = String(text ?? "").replace(ESCAPES, "").replace(LIFTED, "");
    const time = readDuration(said);
    if (!time || time.mode !== "fixed") return null;
    return /\b(?:until|before) the (?:end|start|beginning) of its next turn\b/i.test(said) ? { ...time, anchor: "target-turn" } : time;
}

// What a penalty is to → [{ selector, predicate?, against? }], or [] when one name isn't known.
function selectorsOf(target) {
    // ("to its Speeds from the roots": its Speeds.)
    const said = target.trim().replace(/^(?:its|their|the (?:creature|target|foe)'s) /i, "").replace(/\s+from (?:the|its|their) [\w' -]+$/i, "");
    if (/^(?:checks to )?Escape\b/i.test(said)) return [{ selector: "check", predicate: ["action:escape"] }];
    const speed = /^(?:(land|fly|swim|climb|burrow) )?Speed(s)?$/i.exec(said) ?? /^all (?:of )?(?:its |their )?(Speed)(s)$/i.exec(said);
    if (speed) return [{ selector: speed[1] && !/^speed$/i.test(speed[1]) ? `${speed[1].toLowerCase()}-speed` : speed[2] ? "all-speeds" : "land-speed" }];
    const attack = /^(?:(ranged|melee) )?attack rolls?( against (?:creatures|targets) other than (?:you|the [\w' -]+?))?$/i.exec(said);
    if (attack) return [{ selector: attack[1] ? `${attack[1].toLowerCase()}-attack-roll` : "attack-roll", ...(attack[2] ? { against: "others" } : {}) }];
    const names = said.replace(/,? and /g, ", ").split(/,\s*/).map((name) => name.trim()).filter(Boolean);
    const found = [];
    for (const name of names) {
        const one = /^(?:AC|Armor Class)$/i.test(name) ? "ac"
            : /^(?:saves|saving throws)$/i.test(name) ? "saving-throw"
            : /^(Fortitude|Reflex|Will)(?: saves?| saving throws?)?$/i.exec(name)?.[1]?.toLowerCase()
            ?? (/^Perception(?: checks?)?$/i.test(name) ? "perception"
            : /^skill checks$/i.test(name) ? "skill-check"
            : /^(?:all )?checks$/i.test(name) ? "check"
            : /^damage rolls?$/i.test(name) ? "damage"
            : SKILLS.find((skill) => new RegExp(`^${skill}(?: checks?)?$`, "i").test(name)) ?? null);
        if (!one) return [];
        found.push({ selector: one });
    }
    return found;
}

// "takes a –5-foot status penalty to its Speed …" (each such clause of a sentence) → modifiers. Its target runs to its time, its end or the next
// clause ("… to ranged attack rolls and a –10-foot … to its fly Speed"); a list ("attack rolls, saving throws, and skill checks") is read whole
// or not at all.
const CLAUSE = /(?:\ban? |(?<=\b(?:takes?|taking|gains?|gaining) ))([+–‐-])?(\d+)([-‐ ]foot)? (?:(status|circumstance|item) )?(penalty|bonus) to (.+?)(?=,? (?:for|until|and an? [+–‐-]?\d+|or until|while|as long as)\b|[.;]|$)/gi;
// Who takes it: the row's creature ("The creature takes …", "it takes", "…, taking"), not another ("and the skaveling gains a +5-foot …", "you gain").
const VERB = /\b(?:takes?|taking|gains?|gaining|has|suffers?)\b/gi;
const TAKER = /^(?:(?:the|that|this|each) (?:creature|target|foe|enemy|victim|undead|opponent|animal)s?|it|they)?$/i;
function takerOf(segment) {
    const verbs = [...segment.matchAll(VERB)];
    if (!verbs.length) return null;
    const head = segment.slice(0, verbs.at(-1).index);
    const cut = Math.max(...[...head.matchAll(/,|;|\band\b|\bbut\b|\bthen\b/gi)].map((match) => match.index + match[0].length), 0);
    return head.slice(cut).replace(/\b(?:also|then|instead)\b/gi, "").trim();
}
// (How many of the section's penalties and bonuses it read, of those it names with a number: rowExtras's missed.)
const NAMED = /[+–‐-]?\d+(?:[-‐ ]foot)? (?:(?:status|circumstance|item) )?(?:penalty|bonus)\b/gi;
export function readRowModifiers(html, { dc = null, escape = null, counts = null } = {}) {
    const modifiers = [];
    let read = 0;
    const words = sentences(rowWords(html));
    // ("Both effects end early if it Escapes (DC 26)": the row's.)
    const all = words.some(everything) ? escapeIn(words.find(everything), dc) : null;
    for (const sentence of words) {
        if (CONDITIONAL.test(sentence)) continue;
        const clauses = [...sentence.matchAll(CLAUSE)];
        for (const [index, clause] of clauses.entries()) {
            // The row's creature's own, taken or gained (a clause with no verb of its own, "and a –10-foot …", the one before's).
            const segment = sentence.slice(index ? clauses[index - 1].index + clauses[index - 1][0].length : 0, clause.index);
            const taker = takerOf(segment);
            if (taker === null ? index === 0 : !TAKER.test(taker)) continue;
            const selectors = selectorsOf(clause[6]);
            if (!selectors.length) continue;
            const after = sentence.slice(clause.index + clause[0].length, clauses[index + 1]?.index ?? sentence.length);
            const duration = timeIn(after) ?? timeIn(sentence);
            const ends = escapeIn(sentence, dc) ?? all ?? escape;
            const until = liftedIn(sentence);
            // (Without a time, an Escape or a way to end it, the GM's: it isn't known how long it lasts.)
            if (!duration && !ends && !until) continue;
            const value = (clause[5].toLowerCase() === "penalty" ? -1 : 1) * Number(clause[2]);
            for (const entry of selectors) modifiers.push({ ...entry, value, type: clause[4]?.toLowerCase() ?? "untyped", duration, ...(ends ? { escape: ends } : {}), ...(until ? { until } : {}) });
            read += 1;
        }
    }
    if (counts) Object.assign(counts, { read, named: [...words.join(" ").matchAll(NAMED)].length });
    return modifiers;
}

// "As success, but …" (2026-10-20, for a failure or critical failure — Hobbling Snare's, Gleaming Cuirass's, Bolbalos's "As success, and the creature
// is Sickened 1"): whether the row copies the success's penalties — all it says besides is read (a new value or time for the penalty, damage,
// conditions, a floor for the penalty's time). like: the copied row, which has penalties.
const KNOWN_PARTS = [
    /^In addition$/i,
    /^the (?:status |circumstance |item )?penalty is [–-]\d+(?: feet)?$/i,
    /^the penalty lasts (?:for )?(?:\d+|one|an?|ten) (?:round|minute|hour)s?$/i,
    /^(?:the (?:target|creature|foe) )?takes? [\w ]*?damage(?: damage)?$/i,
    /^the (?:target|creature|foe) is (?:also )?[A-Z][a-z-]+(?: \d+)?(?: by the [\w' -]+)?(?: and can't reduce its \w+ value below \d+ for the duration of the penalty)?$/i,
    /^an? [–-]\d+(?: (?:status|circumstance|item))? penalty$/i
];
// The new value an "As success, but …" row gives the penalty: "the penalty is -10 feet", "but a –2 penalty".
export const variantValue = (html) => /\b(?:the (?:status |circumstance |item )?penalty is |but an? )[–-](\d+)\b/i.exec(rowWords(html))?.[1] ?? null;
export function penaltyVariant(html, like) {
    if (!(like?.modifiers ?? []).length) return false;
    // (Up to an item's next activation, when the section runs on into it: Captivating Rosebud's.)
    const words = rowWords(html).split(/\s+Activate\b/)[0].replace(/^As (?:critical )?(?:success|failure),?\s*(?:but|and|plus|except)?\s*/i, "");
    return sentences(words).every((sentence) => sentence.replace(/\.$/, "").split(/,\s*(?:and\s+)?|\s+and\s+(?=the (?:target|creature|foe) is\b)/).map((part) => part.trim()).filter(Boolean).every((part) => KNOWN_PARTS.some((pattern) => pattern.test(part))));
}

// "can't reduce its frightened value below 1 …" → the core's conditionFloor, or null. penaltyTime: the row's penalty's time, for "for the
// duration of the penalty".
export function readRowFloor(html, { penaltyTime = null } = {}) {
    const said = rowWords(html);
    const match = /\bcan't reduce its (\w+) (?:value|condition) below (\d+) (until it spends an action, which has the concentrate trait|for (\d+|one|an?) (rounds?|minutes?|hours?)|while the persistent (\w+) damage lasts|for the duration of the penalty|until the end of its next turn)/i.exec(said)
        ?? /\bits (\w+) value can't be reduced below (\d+) (until the end of its next turn|for (\d+|one|an?) (rounds?|minutes?|hours?))/i.exec(said);
    if (!match || !FLOOR_SLUGS.includes(match[1].toLowerCase())) return null;
    const floor = { slug: match[1].toLowerCase(), value: Number(match[2]) };
    const how = match[3].toLowerCase();
    if (match[4]) return { ...floor, lifetime: "fixed", duration: { value: NUMBERS[match[4].toLowerCase()] ?? Number(match[4]), unit: `${match[5].toLowerCase().replace(/s$/, "")}s` } };
    if (match[6]) return { ...floor, lifetime: "while-persistent", persistentDamage: match[6].toLowerCase() };
    if (/concentrate/.test(how)) return { ...floor, lifetime: "until-lifted", liftedBy: "it spends a concentrate action" };
    if (/its next turn/.test(how)) return { ...floor, lifetime: "fixed", duration: { value: 1, unit: "rounds", expiry: "turn-end", anchor: "target-turn" } };
    const time = penaltyTime ?? timeIn(/\bthe penalty lasts (for [^.,]+)/i.exec(said)?.[1] ?? "");
    return time?.mode === "fixed" && Number.isInteger(time.value) ? { ...floor, lifetime: "fixed", duration: { value: time.value, unit: time.unit, ...(time.expiry ? { expiry: time.expiry } : {}), ...(time.anchor === "target-turn" ? { anchor: "target-turn" } : {}) } } : null;
}

// "The target reduces its slowed condition by 1." → that condition 1 lower (none when it has none).
export function readLowering(html) {
    const match = /\b(?:the (?:target|creature)|it|they) reduces? (?:its|their) (\w+) (?:condition(?: value)?|value) by (\d+)\b/i.exec(rowWords(html));
    if (!match || !LOWERED_SLUGS.includes(match[1].toLowerCase())) return null;
    return { kind: "condition", slug: match[1].toLowerCase(), value: 0, duration: null, stack: { by: -Number(match[2]) } };
}

// "must roll twice and take the worse result on the next check it attempts" / "on all checks until the end of its next turn" → a note
// Effect with PF2e's RollTwice (keep lower), removed after its roll when it's for one roll.
const ROLLS = { check: "check", checks: "check", "attack roll": "attack-roll", "attack rolls": "attack-roll", "saving throw": "saving-throw", "saving throws": "saving-throw", save: "saving-throw", saves: "saving-throw", "skill check": "skill-check", "skill checks": "skill-check" };
export function readMisfortune(html) {
    const said = rowWords(html);
    const match = /\b(?:must )?rolls? twice and (?:takes?|uses?) the (?:worse|lower|lowest) result (?:on|for) (?:(?:the|its) next (check|attack roll|saving throw|save|skill check)(?: it (?:attempts|makes|rolls))?|(?:all|every) (checks?|attack rolls?|saving throws?|saves?|skill checks?)(?: it (?:attempts|makes|rolls))? (until the end of its next turn|for (\d+|one|an?) rounds?))/i.exec(said);
    if (!match) return null;
    const once = Boolean(match[1]);
    const selector = ROLLS[(match[1] ?? match[2]).toLowerCase()];
    const duration = once ? null : /next turn/i.test(match[3]) ? { mode: "fixed", value: 1, unit: "rounds", expiry: "turn-end", anchor: "target-turn" } : { mode: "fixed", value: NUMBERS[match[4].toLowerCase()] ?? Number(match[4]), unit: "rounds", expiry: "turn-start", anchor: "effect-start" };
    const what = once ? `its next ${match[1].toLowerCase()}` : `${match[2].toLowerCase().replace(/(?<!s)$/, "s")} ${match[3].toLowerCase()}`;
    return { label: "Misfortune", text: `It rolls twice and takes the worse result on ${what}.`, duration, rules: [{ key: "RollTwice", selector, keep: "lower", ...(once ? { removeAfterRoll: true } : {}) }], ...(once ? { once: true } : {}) };
}

// "The target's invisibility is negated for 2 rounds" (Concealed instead of Invisible), "If the creature was Invisible, the glitter outlines it
// for 1 round, making it Concealed rather than Undetected", "the creature is Hidden, rather than undetected, … whenever it would otherwise have
// been undetected" (for the time given, else the row's) → note Effects granting that condition while it's Invisible. [] when none.
export function readNegatedInvisibility(html, { time = null } = {}) {
    const notes = [];
    for (const sentence of sentences(rowWords(html))) {
        const negated = /\b(?:its|their|the (?:target|creature|foe)'s) invisibility is negated (for (?:\d+|one|an?|ten) (?:rounds?|minutes?|hours?))/i.exec(sentence);
        const outlined = /^If the (?:creature|target) (?:was|is) Invisible, [^.]*?\b(for (?:\d+|one|an?) (?:rounds?|minutes?)),? making it Concealed rather than Undetected\b/i.exec(sentence);
        const hidden = /\b(?:is|becomes) Hidden,? rather than undetected,? to [^.]*\bwhenever it would otherwise (?:have been|be) undetected\b/i.exec(sentence);
        const slug = hidden ? "hidden" : negated || outlined ? "concealed" : null;
        if (!slug) continue;
        const duration = timeIn(negated?.[1] ?? outlined?.[1] ?? "") ?? time;
        if (!duration) continue;
        const text = slug === "hidden" ? "Hidden, not Undetected, while it's Invisible." : "Its invisibility is negated: it's Concealed, not Invisible.";
        notes.push({ label: slug === "hidden" ? "Revealed (Hidden)" : "Invisibility negated", text, duration, rules: [{ key: "GrantItem", uuid: CONDITION_UUIDS[slug], predicate: ["self:condition:invisible"], reevaluateOnUpdate: true, allowDuplicate: false }], reveals: slug });
    }
    return notes;
}

// All of a row's extras, for inlineSave: { modifiers, conditionFloor, effects (a lowering), noteEffects, escape (the conditions' early end,
// by slug) } — only the parts read.
export function rowExtras(html, { dc = null, escape = null, time = null } = {}) {
    const extras = {};
    const counts = {};
    const modifiers = readRowModifiers(html, { dc, escape, counts });
    if (modifiers.length) extras.modifiers = modifiers;
    // (A penalty or bonus it names but didn't read, in words it doesn't take: a section's own PF2e Effect is then the fuller.)
    if (counts.named > counts.read) extras.missed = true;
    const floor = readRowFloor(html, { penaltyTime: modifiers.find((modifier) => modifier.duration?.mode === "fixed")?.duration ?? null });
    if (floor) extras.conditionFloor = floor;
    const lowering = readLowering(html);
    if (lowering) extras.effects = [lowering];
    const notes = [readMisfortune(html), ...readNegatedInvisibility(html, { time })].filter(Boolean);
    if (notes.length) extras.noteEffects = notes;
    // The conditions an Escape ends: each named in a sentence that says so, or all of the row's ("Both effects end early …").
    const words = sentences(rowWords(html));
    const ends = {};
    const all = words.some(everything) ? escapeIn(words.find(everything), dc) : null;
    for (const sentence of words) {
        const said = escapeIn(sentence, dc);
        const own = said ?? all ?? escape;
        if (!own) continue;
        // (What the sentence names before its "until it Escapes", back to a time of its own — "Restrained for 2 rounds or until it Escapes, then
        // Clumsy 1" ends the restrained only, "Clumsy 2 until the end of the squad's next turn and is Immobilized until it Escapes" the
        // immobilized; what follows a leading "Until it Escapes, the target is Drained 1 …".)
        const at = said ? sentence.search(ESCAPES) : -1;
        const leading = at === 0;
        const before = said && !leading ? sentence.slice(0, at).replace(/\bfor (?:\d+|one|an?|ten) (?:round|minute|hour)s?,?(?: or)?\s*$/i, "") : "";
        const times = [...before.matchAll(/\b(?:for (?:\d+|one|an?|ten) (?:round|minute|hour)s?|until the (?:end|start|beginning) of [^,.]*?turn)\b/gi)];
        const scope = !said ? sentence : leading ? sentence : before.slice(times.length ? times.at(-1).index + times.at(-1)[0].length : 0);
        for (const match of scope.matchAll(/\b(immobilized|grabbed|restrained|slowed|clumsy|enfeebled|off-guard|prone|dazzled|blinded|deafened|stunned|frightened|sickened|stupefied|drained)\b/gi)) {
            const slug = match[1].toLowerCase();
            // (Stunned, frightened and sickened end by their own rules; prone has no time.)
            if (!["stunned", "frightened", "sickened", "prone"].includes(slug)) ends[slug] = own;
        }
    }
    // ("A creature can end the slowed condition early by Escaping (DC 40) the confining slag": that condition's.)
    for (const sentence of words) {
        const early = /\bcan end (?:the|its) (\w+) condition early by Escaping(?: \(DC (\d+)\))?/i.exec(sentence);
        if (early && Number(early[2] ?? dc) > 0) ends[early[1].toLowerCase()] = { dc: Number(early[2] ?? dc) };
    }
    if (Object.keys(ends).length) extras.escape = ends;
    return extras;
}

// The row with its extras: penalties beside its own, the floor, a lowering, the note Effects (a condition a note reveals — "Hidden, rather than
// undetected" — not outright), and the early end on the conditions it ends. The row, changed in place.
export function withExtras(row, extras) {
    if (extras.modifiers) row.modifiers = [...(row.modifiers ?? []), ...extras.modifiers];
    if (extras.conditionFloor && !row.conditionFloor) row.conditionFloor = extras.conditionFloor;
    row.effects ??= [];
    for (const effect of extras.effects ?? []) if (!row.effects.some((other) => other.slug === effect.slug)) row.effects.push(effect);
    if (extras.noteEffects) {
        row.noteEffects = [...(row.noteEffects ?? []), ...extras.noteEffects];
        const revealed = new Set(extras.noteEffects.map((note) => note.reveals).filter(Boolean));
        row.effects = row.effects.filter((effect) => !(effect.kind === "condition" && revealed.has(effect.slug)));
    }
    if (extras.escape) row.effects = row.effects.map((effect) => (effect.kind === "condition" && extras.escape[effect.slug] && !effect.stack ? { ...effect, duration: effect.duration ? { ...effect.duration, escape: extras.escape[effect.slug] } : { mode: "until-escape", escape: extras.escape[effect.slug] } } : effect));
    return row;
}
