// A character's Strike feats (2026-10-30, docs/pc-feats.md): "Make a melee Strike. If it hits, the target is Frightened 1", "Stride twice,
// then Strike", "This counts as two attacks …", "you gain a +1 circumstance bonus to your attack roll". The monster readings take only an
// activity they read whole; a feat's own wordings vary too much for that, so this reads what it can into the strike-activity builtin the
// live cards and the simulator already play, and gives the rest to the GM as notes. The player uses the feat, then rolls the Strike from
// the sheet; its hit gets the card (scripts/live.js, pendingActivities).

import { htmlToPlainText } from "../../../pf2e-resolution-core/src/text/plain-text.js";
import { degreeSections, inlineTags, readCheck, readConditions, readDamage, readPush } from "./inline.js";
import { RULE_WORDS } from "./pc-voice.js";

// PF2e's conditions, for the ones a hit gives (a word like "immobilizing" isn't one).
const CONDITIONS = new Set(["blinded", "broken", "clumsy", "concealed", "confused", "controlled", "dazzled", "deafened", "doomed", "drained", "dying", "encumbered", "enfeebled", "fascinated", "fatigued", "fleeing", "frightened", "grabbed", "hidden", "immobilized", "invisible", "observed", "off-guard", "paralyzed", "persistent-damage", "petrified", "prone", "quickened", "restrained", "sickened", "slowed", "stunned", "stupefied", "unconscious", "undetected", "unnoticed", "wounded"]);
// The user makes the Strike: "Make a melee Strike", "make two dagger Strikes", "Stride, then Strike", "Strike an adjacent creature", "You Strike".
const USER_STRIKES = /\b(?:[Mm]ake|makes) (?:a|an|one|two|three|up to (?:two|three)|a single|another) (?:[\w'-]+ ){0,4}Strikes?\b|\b(?:then|and|you|You) Strike\b|(?:^|[.:]\s+)Strike\b|\bStrike (?:with your|an?|the|one|each|your)\b/;
const NUMBERS = { once: 1, one: 1, a: 1, an: 1, twice: 2, two: 2, three: 3, "three times": 3 };
const HIT = /^(?:If (?:the|your|this|that|either|the first) (?:Strike|attack)(?: is successful| succeeds| hits)|If (?:it|you) (?:hits?|successfully hits?|succeed)|On a hit|On a successful Strike|If it's a hit)(?: and (?:deals?|damages?)[^,]*)?,?\s*/i;
const CRITICAL = /^(?:If (?:the Strike|the attack|it|you) (?:is a critical hit|critically hits|critically succeeds?|critically hit)|On a critical hit|If you critically hit|If you critically succeed)\b,?\s*/i;

const sentencesOf = (html) => String(html ?? "").split(/(?<=[.!?])\s+(?=[A-Z@<[])|;\s+(?=(?:if|on a)\b)/i).map((sentence) => sentence.trim()).filter(Boolean);
const plainOf = (html) => htmlToPlainText(String(html ?? "").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@UUID\[[^\]]*?\.([^.\]]+)\]/g, "$1").replace(/@Damage\[((?:[^[\]]|\[[^\]]*\])*)\](?:\{([^}]*)\})?/g, (_all, raw, label) => label ?? readDamage(raw))).replace(/\s+/g, " ").trim();

// The description's body: the Requirements, Frequency, Trigger and Effect headings set apart, the flavour before the first rule kept out.
function partsOf(html) {
    const blocks = {};
    const body = String(html ?? "").replace(/<p>\s*<strong>\s*(Requirements?|Frequency|Trigger|Cost|Access)\s*<\/strong>([\s\S]*?)<\/p>\s*(?:<hr\s*\/?>)?/gi, (_all, heading, text) => {
        blocks[heading.toLowerCase().replace(/s$/, "")] = plainOf(text);
        return "";
    }).replace(/<strong>\s*Effect\s*<\/strong>/gi, "");
    return { blocks, body };
}

// "Make two Strikes", "Strike twice", "make a Strike against each enemy": how many Strikes.
function strikeCount(plain) {
    const many = /\bmake (two|three|2|3) (?:[\w'-]+ ){0,3}Strikes\b|\bStrike (twice|three times)\b|\bmake up to (two|three) Strikes\b/i.exec(plain);
    if (many) return NUMBERS[(many[1] ?? many[2] ?? many[3]).toLowerCase()] ?? Number(many[1] ?? many[2] ?? many[3]) ?? 1;
    return 1;
}

// "Stride twice", "Stride up to your Speed, then …", "Stride and then make a melee Strike": the Strides first.
function stridesOf(plain) {
    const before = plain.split(/\bStrikes?\b/)[0];
    const counted = /\bStride (twice|three times)\b/i.exec(before);
    if (counted) return NUMBERS[counted[1].toLowerCase()];
    return /\bStride\b/.test(before) ? 1 : 0;
}

// A hit's results from one sentence: damage tags, conditions, a push; a save the creature hit attempts, with the degree sections it has.
function hitResults(sentence, html, item, compileSave) {
    const out = { conditions: [], damage: [], push: null, save: null, read: false };
    const conditions = readConditions(sentence).filter((effect) => effect.recipient !== "self" && CONDITIONS.has(effect.slug));
    if (conditions.length) {
        out.conditions = conditions.map(({ slug, value, duration }) => ({ slug, value: value ?? null, duration: duration ?? null }));
        out.read = true;
    }
    const damage = inlineTags(sentence, "Damage").map(readDamage).filter((formula) => !/@/.test(formula));
    // Written out ("you deal an additional 10d10 precision damage", "takes 4d6 extra precision damage", "1d6 persistent bleed damage").
    if (!damage.length) {
        const words = plainOf(sentence);
        const written = /\b(?:an? )?(?:additional|extra) (\d+d\d+|\d+) (persistent )?([a-z]+) damage\b/i.exec(words) ?? /\b(\d+d\d+|\d+) (?:additional |extra )?(persistent )?([a-z]+) damage\b/i.exec(words);
        if (written && !/\bper\b|\bfor each\b|\bequal to\b/i.test(words)) damage.push(`${written[1]}[${written[2] ? "persistent," : ""}${written[3].toLowerCase()}]`);
    }
    if (damage.length) {
        out.damage = damage;
        out.read = true;
    }
    const push = readPush(sentence);
    if (push?.kind === "push") {
        out.push = push.distance;
        out.read = true;
    }
    const check = inlineTags(sentence, "Check").map(readCheck).find((entry) => entry.save && entry.dc);
    if (check && compileSave) {
        // The save as an ability of its own: the sentence and the degree sections that follow it.
        const at = html.search(/<p>\s*<strong>\s*Critical Success\s*<\/strong>/i);
        const text = `<p>${sentence.replace(HIT, "")}</p>${at >= 0 && Object.keys(degreeSections(html)).length ? html.slice(at) : ""}`;
        const plan = compileSave(text);
        if (plan?.resolution?.kind === "save") {
            out.save = plan;
            out.read = true;
        }
    }
    return out;
}

// item: the feat (its text with the character's numbers in, src/compiler/pc-dcs.js). compileSave(html): a save plan from a piece of its text.
export function characterStrike(item, { compileSave = null } = {}) {
    const html = String(item?.system?.description?.value ?? "");
    if (!/\bStrikes?\b/.test(html)) return null;
    const { blocks, body } = partsOf(html);
    const sentences = sentencesOf(body.replace(/<\/?p[^>]*>|<hr\s*\/?>/gi, " ").replace(/<strong>\s*(Critical Success|Success|Failure|Critical Failure)\s*<\/strong>[\s\S]*$/i, ""));
    const plain = plainOf(body);
    // Not a feat that only changes Strikes for a while, or one about another creature's Strike (a reaction's trigger, an ally's): those
    // aren't the user's Strike activity.
    if (!USER_STRIKES.test(plain) || /\b(?:an ally|your ally|allies|your companion|your eidolon|your familiar|your mount)\b[^.]*\bStrikes?\b/i.test(plain.split(/\.\s/)[0])) return null;
    const plan = {
        builtin: "strike-activity",
        actions: Number(item.system?.actions?.value) || 1,
        strides: stridesOf(plain),
        strike: /\branged Strike|\bStrike with a (?:bow|crossbow|firearm|ranged weapon)\b/i.test(plain) ? "ranged" : null,
        anyStrike: !/\b(?:melee|ranged) (?:unarmed )?Strike/i.test(plain),
        melee: /\bmelee (?:unarmed )?Strike/i.test(plain),
        attackBonus: 0,
        damageBonus: 0,
        offGuard: false,
        requires: blocks.requirement ?? null,
        oncePerFight: false,
        onHit: { conditions: [], critical: null, push: null, damage: [], save: null, size: null },
        source: { name: item.name, type: item.type },
        notes: []
    };
    if (plan.strike === "ranged") plan.anyStrike = false;
    const count = strikeCount(plain);
    if (count > 1) {
        plan.strikes = Array.from({ length: count }, () => plan.strike);
        plan.notes.push(`${count} Strikes; each hit gets its card.`);
    }
    const counts = /\bcounts? as (two|three) attacks\b/i.exec(plain);
    if (counts) plan.countsAs = NUMBERS[counts[1].toLowerCase()];
    const bonus = /\b(?:gain|gains|get|with) an? \+(\d+) (?:circumstance|status) bonus to (?:your|its|the|this) (?:attack roll|Strike)/i.exec(plain) ?? /\+(\d+) circumstance bonus to (?:the )?attack roll/i.exec(plain);
    if (bonus) plan.attackBonus = Number(bonus[1]);
    const penalty = /\b(?:take|takes|with) an? [–-](\d+) (?:circumstance )?penalty (?:to|on) (?:your|its|the|this|each) (?:attack roll|Strike)/i.exec(plain);
    if (penalty) plan.attackBonus = -Number(penalty[1]);
    let read = Boolean(counts || bonus || penalty || count > 1 || plan.strides);
    const unread = [];
    for (const sentence of sentences) {
        const words = plainOf(sentence);
        if (CRITICAL.test(words)) {
            const results = hitResults(sentence.replace(CRITICAL, ""), html, item, compileSave);
            if (results.read) {
                plan.onHit.critical = results.conditions.length ? results.conditions : plan.onHit.critical;
                if (results.damage.length) plan.onHit.criticalDamage = [...(plan.onHit.criticalDamage ?? []), ...results.damage];
                if (results.push) plan.onHit.criticalPush = results.push;
                read = true;
                continue;
            }
        } else if (HIT.test(words)) {
            const results = hitResults(sentence, html, item, compileSave);
            if (results.read) {
                plan.onHit.conditions.push(...results.conditions);
                plan.onHit.damage.push(...results.damage);
                if (results.push) plan.onHit.push = results.push;
                if (results.save) plan.onHit.save = results.save;
                // "(10 feet on a critical hit)": the critical push in the same sentence.
                const criticalPush = /\((\d+) feet on a critical hit\)/i.exec(words);
                if (criticalPush) plan.onHit.criticalPush = Number(criticalPush[1]);
                read = true;
                continue;
            }
        } else if (/\b(?:Make|make|Strike|Stride|Step|This counts as|counts as two|counts as three)\b/.test(words) && !/@(?:Damage|Check)\[/.test(sentence) && !readConditions(sentence).length) {
            // The activity's own steps, read above (its Strides, Strikes, bonus, penalty).
            if (/\b(?:Make|make) (?:a|an|two|three|up to)\b|\bStride\b|\bStrike\b|counts as/.test(words)) continue;
        }
        // (The bonus, penalty and attack count, read above.)
        if (/\bcircumstance bonus to (?:your|its|the|this) attack roll|\bcounts? as (?:two|three) attacks|\bpenalty (?:to|on) (?:your|its|the|this|each) (?:attack roll|Strike)/i.test(words)) continue;
        if (words) unread.push(words);
    }
    if (!read) return null;
    // What isn't read: the GM's, on the card.
    // (Not the flavour: a sentence with no game word in it.)
    plan.notes.push(...unread.filter((words) => RULE_WORDS.test(words) && (!/^(?:You|It) (?:make|makes) (?:a|an) /i.test(words) || /\b(?:if|unless|instead|only)\b/i.test(words))));
    if (plan.requires) plan.notes.unshift(`Requires: ${plan.requires}`);
    if (blocks.frequency) plan.notes.unshift(`Frequency: ${blocks.frequency}`);
    return plan;
}
