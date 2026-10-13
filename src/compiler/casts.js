// Abilities that cast a spell or have its effects (2026-10-10): "The onryo … casts a 5th-rank Geas on the creature it hit
// (DC 30)", "This has the same effect as the Possession spell (DC 23), except …", "The vampire can cast Dominate at will as a
// divine innate spell". The plan is the spell itself, cast through PF2e at the ability's rank and DC, so the spell module
// resolves it as it does any cast:
//   { builtin: "cast-spell", spell: { uuid, name }, rank, dc, attack, tradition, self, notes }
// rank null: half the creature's level rounded up, and not below the spell's own rank (as a monster's focus spells and
// cantrips). dc null: the creature's spell DC. attack: a counteract modifier the text gives ("counteract modifier +32").
// self: on itself only, whatever the spell's targets ("gains the effects of Blur").
// notes: what the ability changes or adds ("except the duration is 24 hours", "The vampire loses fast healing while …"), for
// the GM.
// Not read: a choice of spells or of actions ("Strides, Leaps or casts Translocate"), a spell its trigger or requirement
// names ("Trigger The wendigo casts Migration"), a rule on its own casting ("When the acolyte casts Harm …", "Casting a
// Shatter spell on the golem …"), or a passive ability.

import { htmlToPlainText } from "../../../pf2e-resolution-core/src/text/plain-text.js";
import { inlineTags, readCheck, readableText, sentencesOf } from "./inline.js";

const SPELL_LINK = /@UUID\[Compendium\.pf2e\.spells-srd\.Item\.([A-Za-z0-9]{16})\](?:\{([^}]*)\})?/g;
const ONE_LINK = new RegExp(SPELL_LINK.source);
const ORDINAL = String.raw`\d+(?:st|nd|rd|th)[- ](?:rank|level)`;
const LEAD = String.raw`(?:(?:a|an|the|its|his|her|their)\s+)?(?:(?:DC \d+|innate|heightened|${ORDINAL}|\d-action),?\s+)*`;
// The words that make the sentence a casting of the spell (\u0001 stands for the link).
const CASTS = [
    new RegExp(String.raw`\bcasts?\s+${LEAD}\u0001`, "i"),
    new RegExp(String.raw`\b(?:has|have|having|with|gains?|gaining) the (?:same )?effects? of\s+${LEAD}\u0001`, "i"),
    // (Batch 179, the mocking dragon's Slippery Puddle: "This creates a 15-foot burst with the area effect of Grease".)
    new RegExp(String.raw`\bwith the area effects? of\s+${LEAD}\u0001`, "i"),
    // (Batch 188, a leshy's Change Shape: "The leshy transforms into a Small plant. This ability otherwise uses the effects of One with Plants.")
    new RegExp(String.raw`\b(?:otherwise )?uses the effects? of\s+${LEAD}\u0001`, "i"),
    // (Batch 204, a banshee's Wail: "The banshee unleashes a soul-chilling Wails of the Damned (… save, … damage)".)
    // (Batch 274: "The trap releases an arcane wail of the banshee (DC 40) …".)
    new RegExp(String.raw`\b(?:unleashes|releases) (?:an? )?(?:[\w-]+ )?\u0001`, "i"),
    new RegExp(String.raw`\bsame effects? as\s+${LEAD}\u0001`, "i"),
    new RegExp(String.raw`\bas\s+(?:the|an?)\s+(?:${ORDINAL}\s+)?\u0001 spell\b`, "i"),
    new RegExp(String.raw`\bas per\s+\u0001`, "i"),
    // (2026-10-10, batch 23) "is subjected to a 5th-rank Phantasmal Killer spell", "is subjected to the effects of Divine Decree",
    // "takes the effects of the Charm spell", "suffers the result of a 4th-rank Charm spell", "affects all enemies it can see within
    // 60 feet with Calm", "affecting them with Wave of Despair (7th level, …)", "targeting the creature with Phantasmal Killer",
    // "be affected by a Suggestion", "is targeted by Cursed Metamorphosis".
    new RegExp(String.raw`\bsubjected to (?:the effects? of )?${LEAD}\u0001`, "i"),
    new RegExp(String.raw`\b(?:takes?|suffers?) the (?:effects?|results?) of\s+${LEAD}\u0001`, "i"),
    new RegExp(String.raw`\b(?:affects?|affecting|targets?|targeting) [^\u0001.]{1,60}? with\s+${LEAD}\u0001`, "i"),
    new RegExp(String.raw`\b(?:is |are |be )affected by\s+${LEAD}\u0001`, "i"),
    new RegExp(String.raw`\b(?:is|are) targeted by\s+${LEAD}\u0001`, "i")
];
const RULE_ON_CASTING = /^\(?(?:When|Whenever|If|Unless|Until|Once|After|Before|While|Casting)\b/;
// A casting inside a condition ("… the gylou can bring the creature with them when they cast Translocate").
const CONDITIONAL = /\b(?:when|whenever|if|after|before|while|until|unless)\s+(?:[\w']+\s+){0,3}$/i;
const CHANGES = /,?\s*(?:\bexcept\b|\bbut\b|\bwith the following changes?\b|\binstead of\b)/i;
// The rest of the sentence that says no more than the spell does: its target, its tradition, "at will".
const PLAIN_TAIL = /^[\s,.;]*(?:(?:spell|at will|as an? (?:\w+ )?(?:innate )?(?:\w+ )?spell|on (?:the|a|an|its|his|her|their|one|each)\b[^,;.]*?|on (?:itself|himself|herself|themselves|themself|him|her|it|them|you)|that affects only [\w ]+|heightened to (?:a |the )?\d+(?:st|nd|rd|th) (?:rank|level)|DC \d+(?: basic)? (?:Fortitude|Reflex|Will)(?: save)?)[\s,.;]*)*$/i;
const SAVE_CHECK = /@Check\[(?:type:)?(?:fortitude|reflex|will)\b/i;

// Inline rolls as their labels: "[[/gmr 1d4 #Recharge]]{1d4 rounds}" → "1d4 rounds".
// (Batch 204: one with no label as its formula, "[[/gmr 1d4 #Recharge Wail]] rounds" → "1d4 rounds".)
const rolls = (html) => String(html).replace(/\[\[\/(?:r|gmr|br|roll|gmroll) [^\]]*\]\]\{([^}]*)\}/g, "$1").replace(/\[\[\/(?:r|gmr|br|roll|gmroll) \{?([^\]#}]+?)\}?(?: #[^\]]*)?\]\](?!\{)/g, "$1");
const ordinal = (text) => Number(/(\d+)(?:st|nd|rd|th)/.exec(text)?.[1]);

// Spells some abilities name without a link (2026-10-13, batch 274): their PF2e ids, the old names too ("wail of the banshee" is Wails of the Damned).
const NAMED_SPELLS = [
    [/\bwails? of the (?:banshee|damned)\b/i, "FEsuyf203wTNE2et", "Wails of the Damned"],
    [/\bcursed metamorphosis\b/i, "dN8QBNuTiaBHCKUe", "Cursed Metamorphosis"],
    [/\bprismatic spray\b/i, "d6o52BnjViNz7Gub", "Prismatic Spray"],
    [/\bdivine decree\b/i, "sX2o0HH4RjJDAZ8C", "Divine Decree"],
    [/\brevealing light\b/i, "0qaqksrGGDj74HXE", "Revealing Light"]
];
const linkNamed = (html) => {
    if (SPELL_LINK.test(html)) return html;
    for (const [pattern, id, name] of NAMED_SPELLS) if (pattern.test(html)) return html.replace(pattern, `@UUID[Compendium.pf2e.spells-srd.Item.${id}]{${name}}`);
    return html;
};

export function castSpell(item, actor = null) {
    if (!["action", "reaction", "free"].includes(item.system?.actionType?.value)) return null;
    SPELL_LINK.lastIndex = 0;
    const html = linkNamed(String(item.system?.description?.value ?? ""));
    SPELL_LINK.lastIndex = 0;
    // The spell named in a trigger or a requirement: the ability answers a casting, it isn't one.
    const lead = html.split(/<strong>\s*Effect\s*<\/strong>/i);
    if (lead.length > 1 && /@UUID\[Compendium\.pf2e\.spells-srd\./.test(lead.slice(0, -1).join(" "))) return null;
    const effect = lead.at(-1);
    const ids = [...new Set([...effect.matchAll(SPELL_LINK)].map((match) => match[1]))];
    if (ids.length !== 1) return null;
    // A choice of effects, or the ability's own results ("one of the following special effects of his choice").
    if (/\bone of the following\b|\bof (?:his|her|its|their) choice\b|<strong>\s*(?:Critical )?(?:Success|Failure)\s*<\/strong>/i.test(effect)) return null;
    // A reaction to a spell that sends it back or counters it ("The spell is reflected back upon the caster, with the effect of Spell
    // Turning"): not a casting of its own.
    if (/\btriggering spell\b|\breflect(?:s|ed)?\b/i.test(effect)) return null;
    // (Its sentences, also one in brackets: "(If the barrier has been destroyed, the statue instead … to cast Wall of Force.)".)
    const sentences = sentencesOf(effect.replace(/<strong>\s*(?:Frequency|Requirements?|Trigger|Cost)\s*<\/strong>[^]*?(?=<strong>|$)/gi, "")).flatMap((sentence) => sentence.split(/(?<=[.!?])\s+(?=\()/));
    const index = sentences.findIndex((sentence) => ONE_LINK.test(sentence));
    if (index < 0) return null;
    // A save before it decides whether the spell happens ("… must succeed at a DC 33 Will save or be transported …"); a check or
    // damage before it that the spell wouldn't bring (batch 23: "… must succeed at an Acrobatics check or take 1d4+7 piercing
    // damage … Additionally, a creature damaged by it is affected by Command").
    if (sentences.slice(0, index).some((sentence) => SAVE_CHECK.test(sentence) || /@(?:Check|Damage)\[/.test(sentence))) return null;
    const sentence = sentences[index];
    const label = ONE_LINK.exec(sentence)?.[2] ?? null;
    // The sentence as words, the link a mark (its other inline parts as words).
    const marked = readableText(rolls(sentence).replace(SPELL_LINK, "\u0001"));
    if (RULE_ON_CASTING.test(marked)) return null;
    const cast = CASTS.map((pattern) => pattern.exec(marked)).find(Boolean);
    if (!cast || CONDITIONAL.test(marked.slice(0, cast.index))) return null;
    // "can cast" is a casting only at will ("The vampire can cast Dominate at will"), not a permission ("can cast Dominate through
    // this sensory link").
    if (/\bcan\s+$/i.test(marked.slice(0, cast.index)) && !/\u0001[^.]*\bat will\b/i.test(marked)) return null;
    // What follows the spell, up to what the ability changes ("except …").
    const after = marked.slice(marked.indexOf("\u0001") + 1).replace(/\([^()]*\)/g, "");
    const change = after.search(CHANGES);
    const tail = (change >= 0 ? after.slice(0, change) : after).trim();
    // A choice ("Strides …, Leaps … or casts Translocate", "casts X or Y"), a Strike or an attack with it ("casts Translocate, then
    // makes a melee Strike"), or a roll's result used for it ("It also uses this result to attempt to counteract …").
    const own = `${marked.slice(0, marked.indexOf("\u0001"))} ${tail}`;
    if (/\bor\s+(?:\w+\s+){0,4}\u0001/i.test(marked) || /\b(?:strikes?|disarm|grapple|trip|shove)\b/i.test(own) || /\b(?:this|that|the same) result\b/i.test(own)) return null;
    // Its rank: "a 5th-rank Geas", "heightened to 6th rank", "(9th rank, counteract +31)", "Possession (8th level)".
    const ranked = new RegExp(String.raw`\bheightened to (?:a |the )?\d+(?:st|nd|rd|th)\b|\b${ORDINAL}\b|\(\s*\d+(?:st|nd|rd|th) (?:rank|level)`, "i").exec(marked);
    const rank = ranked ? ordinal(ranked[0]) : null;
    // Its DC: a check in the sentence or after it, or "DC 42" / "a spell DC of 22" in words, or "The save DC for this ability is 22".
    const rest = sentences.slice(index);
    const checks = inlineTags(rest.join(" "), "Check").map(readCheck).filter((check) => check.dc && check.statistic !== "flat");
    const words = (text) => htmlToPlainText(text.replace(/@Check\[[^\]]*\](?:\{[^}]*\})?/g, ""));
    const worded = /\bDC (?:of )?(\d+)\b/i.exec(words(sentence)) ?? rest.slice(1).map((other) => /\bDC (?:for this ability |of this ability )?is (\d+)\b/i.exec(words(other))).find(Boolean);
    const dc = checks[0]?.dc ? Number(checks[0].dc) : worded ? Number(worded[1]) : null;
    // A counteract modifier or a spell attack: "counteract modifier +32", "+31 counteract modifier", "a +32 bonus to its counteract
    // check", "with a +21 spell attack roll".
    const counter = /\bcounteract(?: modifier)?(?: of)? \+(\d+)|\+(\d+) (?:counteract modifier|bonus to its counteract check|spell attack)/i.exec(marked);
    const attack = counter ? Number(counter[1] ?? counter[2]) : null;
    // On itself: "gains the effects of Blur", "casts Unfettered Movement on himself", "turns into a cloud of vapor, as the Vapor
    // Form spell".
    // (Also "The eloko is affected by a 4th-rank Enlarge spell": the monster itself, not "each creature" or "the target".)
    const affectedItself = /^(?:The |An? )?(?![\w' -]*\b(?:creatures?|targets?|each|all|every|enem(?:y|ies)|foes?|area)\b)[\w' -]+? (?:is|are) affected by\b/i.test(marked);
    const self = /^gain/i.test(cast[0]) || affectedItself || /^\W*on (?:itself|himself|herself|themselves|themself|you)\b/i.test(tail) || /\b(?:turns?|transforms?) into\b[^\u0001]*\u0001/i.test(marked);
    const tradition = /\b(arcane|divine|occult|primal) (?:innate )?spell\b/i.exec(marked)?.[1]?.toLowerCase() ?? /\binnate (arcane|divine|occult|primal) spell\b/i.exec(marked)?.[1]?.toLowerCase() ?? null;
    // What the ability changes or adds: its sentence, when it says more than the spell does ("… except the duration is 24
    // hours", "… and is exposed to abyssal plague"), and its other sentences.
    const notes = [];
    // (Batch 179: an area before the casting, "The dragon breaths a cloud of mood-altering gas in a 30-foot cone.", "This creates a 15-foot burst
    // with the area effect of Grease" — where it lands, for the GM.)
    for (const other of sentences.slice(0, index)) if (/@Template\[/.test(other)) notes.push(readableText(rolls(other)).replace(/^(?:The )?[^.]+? can(?:'|’)?t use [^.]+? again for [^.]+?\.\s*/i, ""));
    if (/@Template\[/.test(sentence) && PLAIN_TAIL.test(tail) && change < 0) notes.push(marked.replace(/\u0001/g, label ?? "the spell"));
    if (change >= 0 || !PLAIN_TAIL.test(tail)) notes.push(marked.replace(/\u0001/g, label ?? "the spell"));
    // (Not its recharge, which the module keeps: "The titan can't use Send Beyond for 1d4 rounds".)
    for (const other of sentences.slice(index + 1)) {
        const text = readableText(rolls(other));
        if (text && !/^\(?DC \d+[^)]*\)?\.?$/.test(text) && !/\bcan(?:'t|not) (?:use )?[^.]+? (?:again )?for \d+d\d+(?:\s*[+-]\s*\d+)? rounds\.?$/i.test(text)) notes.push(text);
    }
    return {
        builtin: "cast-spell",
        source: { name: item.name, uuid: item.uuid ?? null, slug: item.system?.slug ?? null },
        spell: { uuid: `Compendium.pf2e.spells-srd.Item.${ids[0]}`, name: label },
        rank: Number.isFinite(rank) && rank >= 1 && rank <= 10 ? rank : null,
        dc,
        attack,
        tradition,
        self,
        notes
    };
}
