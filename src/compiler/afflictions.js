// Creature afflictions (poisons, diseases, curses) with stages, as a monster's
// Strike delivers them ("Fangs … plus serpentfolk venom"):
//
//   <p><strong>Saving Throw</strong> @Check[fortitude|dc:16]</p>
//   <p><strong>Maximum Duration</strong> 6 rounds</p>
//   <p><strong>Stage 1</strong> @Damage[1d4[poison]] damage and @UUID[…]{Enfeebled 1} (1 round)</p>
//   <p><strong>Stage 2</strong> 2d4 poison damage and enfeebled 1 (1 round)</p>
//
// The plan is a save: a failure afflicts the creature at stage 1, a critical
// failure at stage 2. resolution.afflictionHandoff carries the stages read
// into numbers (damage, conditions, duration), for the core's "affliction"
// change; the runtime plays the progression.

import { htmlToPlainText } from "../../../pf2e-resolution-core/src/text/plain-text.js";
import { STAGE_CONDITIONS, inlineTags, readCheck, readConditions, readDamage } from "./inline.js";

const none = () => ({ damage: { mode: "none", multiplier: 0, sourceComponentIds: [] }, effects: [] });
const UNITS = { round: "rounds", minute: "minutes", hour: "hours", day: "days", week: "weeks" };

// "6 rounds", "1 day", "[[/gmr 1d4 #hours]]{1d4 hours}" → { value, unit } (dice at their average, rounded down).
export function readSpan(text) {
    const plain = String(text ?? "").replace(/\[\[[^\]]*\]\]\{([^}]*)\}/g, "$1").trim();
    const match = /^(?:(\d+)|(\d+)d(\d+))\s+(round|minute|hour|day|week)s?\b/i.exec(plain);
    if (!match) return null;
    const value = match[1] ? Number(match[1]) : Math.floor(Number(match[2]) * (Number(match[3]) + 1) / 2);
    return { value, unit: UNITS[match[4].toLowerCase()] };
}

// One stage's text → { stage, damage: ["1d4[poison]"], conditions: [{ slug, value }], duration, effects?: [{ uuid, label }], death? }.
function readStage(stage, html) {
    const plain = htmlToPlainText(html);
    // The last stage of many: "dead", "the creature dies and becomes a wraith".
    if (/^(?:dead\b|(?:the (?:creature|victim|target) )?dies\b)/i.test(plain)) return { stage, damage: [], conditions: [], duration: null, death: true, text: plain };
    const damage = inlineTags(html, "Damage").map(readDamage).filter(Boolean);
    // Plain "2d10 poison damage" when the stage has no @Damage.
    if (!damage.length) for (const match of plain.matchAll(/\b(\d+d\d+(?:\s*[+-]\s*\d+)?)\s+([a-z]+)\s+damage\b/gi)) damage.push(`(${match[1].replace(/\s+/g, "")})[${match[2].toLowerCase()}]`);
    // "(1 round)": the last parenthesis; (2026-10-20, Grit's stage 6) "(remaining duration)": as long as the affliction lasts — { unit: "remaining" }.
    const spans = [...plain.matchAll(/\(([^()]*)\)/g)].map((match) => (/^\s*remaining duration\s*$/i.test(match[1]) ? { value: null, unit: "remaining" } : readSpan(match[1]))).filter(Boolean);
    const conditions = readConditions(html.replace(/\([^()]*\)\s*$/, ""), { plain: STAGE_CONDITIONS }).map((effect) => ({ slug: effect.slug, value: effect.value }));
    // (2026-10-20: PF2e's own Effect for the stage, "Effect: Grit (Stage 1)": on the creature while the stage lasts — the simulator's.)
    const effects = [...String(html).matchAll(/@UUID\[(Compendium\.[\w-]+\.[\w-]*effects\.Item\.[A-Za-z0-9]{16})\](?:\{([^}]*)\})?/gi)].map((match) => ({ uuid: match[1], label: (match[2] ?? "").replace(/^Effect:\s*/i, "") || null }));
    return { stage, damage, conditions, duration: spans.at(-1) ?? null, ...(effects.length ? { effects } : {}), text: plain };
}

// The affliction block of an item, or null when it has no stages.
// (2026-10-27, from the item module's Unending Itch: "Stages 1–5 1d6 poison damage (1 round)" — a range of stages alike, each written out.)
const STAGE_RANGE = /<p>\s*<strong>\s*Stages\s+(\d+)\s*[–-]\s*(\d+)\s*<\/strong>([\s\S]*?)<\/p>/i;
export function expandStageRange(html) {
    const found = STAGE_RANGE.exec(String(html ?? ""));
    if (!found) return String(html ?? "");
    const [first, last] = [Number(found[1]), Number(found[2])];
    if (!(last > first) || last - first > 10) return String(html);
    return String(html).replace(STAGE_RANGE, Array.from({ length: last - first + 1 }, (_, index) => `<p><strong>Stage ${first + index}</strong>${found[3]}</p>`).join(""));
}

export function readAffliction(item) {
    const html = expandStageRange(item?.system?.description?.value ?? "");
    let stageMarks = [...html.matchAll(/<strong>\s*Stage\s+(\d+)\s*<\/strong>/gi)];
    // A second block (the coatls' venom "against unholy" creatures): the first one only.
    const again = stageMarks.findIndex((mark, index) => index > 0 && mark[1] === "1");
    if (again > 0) stageMarks = stageMarks.slice(0, again);
    if (!stageMarks.length) return null;
    // (2026-10-20: its own PF2e Effect in the paragraph after it, "<p>@UUID[…]{Effect: Grit (Stage 1)}</p>", Blaze's "Effect: Blaze" before its
    // stage 2: the stage's too; after the last stage only one named for a stage, not the whole affliction's, "Effect: Bogwid Fever".)
    const stages = stageMarks.map((mark, index) => {
        const segment = html.slice(mark.index + mark[0].length, stageMarks[index + 1]?.index ?? html.length);
        const own = segment.replace(/<\/p>[\s\S]*$/i, "");
        const last = index === stageMarks.length - 1;
        const linked = [...segment.slice(own.length).matchAll(/<p>\s*(@UUID\[Compendium\.[\w-]+\.[\w-]*effects\.Item\.[A-Za-z0-9]{16}\]\{([^}]*)\})\s*<\/p>/gi)].filter((match) => !last || /\bStage \d+\b/i.test(match[2])).map((match) => match[1]).join(" ");
        return readStage(Number(mark[1]), linked ? `${own} ${linked}` : own);
    });
    if (stages.some((stage, index) => stage.stage !== index + 1)) return null;
    for (const [index, stage] of stages.entries()) {
        // "as stage 2": that stage's effects (and duration).
        const as = /^as stage (\d+)\b/i.exec(stage.text);
        const earlier = as ? stages[Number(as[1]) - 1] : null;
        if (earlier && Number(as[1]) <= index) Object.assign(stage, { damage: [...earlier.damage, ...stage.damage.filter((formula) => !earlier.damage.includes(formula))], conditions: stage.conditions.length ? stage.conditions : [...earlier.conditions], duration: stage.duration ?? earlier.duration, ...(!stage.effects && earlier.effects ? { effects: [...earlier.effects] } : {}) });
        // A stage with no duration of its own: the previous stage's.
        if (!stage.duration && !stage.death && index > 0) stage.duration = stages[index - 1].duration;
    }
    // (Batch 265, Xill Eggs: a cure's Medicine check before it — the one under "Saving Throw".)
    const savingAt = html.search(/<strong>\s*Saving Throw\s*<\/strong>/i);
    const raw = (savingAt >= 0 ? inlineTags(html.slice(savingAt), "Check")[0] : null) ?? inlineTags(html, "Check")[0];
    const check = raw ? readCheck(raw) : null;
    if (!check?.save || !check.dc) return null;
    const plain = htmlToPlainText(html);
    // (2026-10-27, from the item module's Taster's Folly: a field stops at the next one — "Onset 10 minutes Maximum Duration 6 minutes" on one
    // line —, and the first that reads as a time is the field, not the word in a sentence before it, "The onset period begins only if…".)
    const span = (label) => {
        for (const found of plain.matchAll(new RegExp(`\\b${label}\\s+(.+?)\\s*(?=\\n|\\b(?:Saving Throw|Onset|Maximum Duration|Stages? \\d)\\b|$)`, "gi"))) {
            const read = readSpan(found[1]);
            if (read) return read;
        }
        return null;
    };
    return {
        name: item.name,
        slug: item.system?.slug ?? null,
        traits: [...(item.system?.traits?.value ?? [])],
        statistic: check.statistic,
        dc: check.dc,
        maximumDuration: span("Maximum Duration"),
        onset: span("Onset"),
        stages
    };
}

// The plan: a save when a Strike that lists the affliction hits.
export function compileAffliction(item, base) {
    const affliction = readAffliction(item);
    if (!affliction) return null;
    const stage = (value) => ({ ...none(), affliction: { name: affliction.name, stage: Math.min(value, affliction.stages.length) } });
    return {
        ...base,
        activation: { time: "free", traits: [...affliction.traits] },
        targeting: { target: "the creature the Strike hits", range: "touch", area: null },
        trigger: { event: "strike", on: ["success", "criticalSuccess"], attackEffect: affliction.slug, cost: "free", map: false },
        resolution: {
            kind: "save",
            check: { roll: "save", statistic: affliction.statistic, basic: false, against: { dc: "fixed", value: affliction.dc } },
            sharedDamage: null,
            outcomes: { criticalSuccess: none(), success: none(), failure: stage(1), criticalFailure: stage(2) },
            afflictionHandoff: affliction
        }
    };
}
