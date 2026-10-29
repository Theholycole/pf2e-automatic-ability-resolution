// An affliction Pseudo Afflictions has no Effect for (2026-10-29, the item module's Horn of Rust: its own tetanus, not the ferrugon's): its
// Effect built from the hand-off's stages (src/compiler/afflictions.js readAffliction), in Pseudo Afflictions' own flag format, so it runs
// it from there as one of its own — the stage's conditions and Effects on, its damage rolled to the GM, a save at the end of the stage.
//   flags["pseudo-afflictions"] = { save: { type, value }, onset, startStage?, stages: { "1": { duration, conditions?, effects?, damage?,
//   note? }, … } }
// With an onset, stage "1" is the onset and the stages follow one on; a critical failure (the hand-off's stage 2) starts one further, as
// Pseudo Afflictions' own: its startStage with an onset, else its badge. Its last stage a death: no end, "Character is dead". Pure.

const AFFLICTIONS = "pseudo-afflictions";
// (Pseudo Afflictions counts rounds, minutes, hours and days; a week is 7 days.)
const UNITS = { rounds: ["rounds", 1], minutes: ["minutes", 1], hours: ["hours", 1], days: ["days", 1], weeks: ["days", 7] };
const UNLIMITED = { expiry: "turn-end", sustained: false, unit: "unlimited", value: -1 };

// { value, unit } → its duration, or no end (none, or "remaining duration").
function spanOf(span) {
    const [unit, times] = UNITS[span?.unit] ?? [];
    const value = Number(span?.value);
    return unit && value > 0 ? { expiry: "turn-end", sustained: false, unit, value: value * times } : { ...UNLIMITED };
}

const escapeText = (text) => String(text ?? "").replace(/[&<>"]/g, (mark) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[mark]);

// One stage of the hand-off → Pseudo Afflictions' stage. isCondition: the slugs PF2e has a condition for (it makes them itself).
function stageOf(stage, isCondition) {
    if (stage.death) return { duration: { ...UNLIMITED }, note: "Character is dead" };
    const conditions = (stage.conditions ?? []).filter((entry) => entry?.slug && isCondition(entry.slug)).map((entry) => ({ slug: entry.slug, ...(Number(entry.value) > 1 ? { value: Number(entry.value) } : {}), linked: true }));
    const damage = (stage.damage ?? []).filter(Boolean);
    const effects = (stage.effects ?? []).map((entry) => entry?.uuid).filter(Boolean);
    return {
        duration: spanOf(stage.duration),
        ...(conditions.length ? { conditions } : {}),
        ...(effects.length ? { effects } : {}),
        ...(damage.length ? { damage: { formula: damage.length === 1 ? damage[0] : `{${damage.join(",")}}` } } : {})
    };
}

// The hand-off (name, slug, traits, level, statistic, dc, onset, maximumDuration, stages, stage) → the Effect's source, or null when it has
// no stages. Options: { name, dc, level, img, effectTraits (the traits an Effect takes), isCondition, moduleId }.
export function pseudoAfflictionSource(data, { name = data?.name, dc = data?.dc, level = data?.level, img = null, effectTraits = null, isCondition = () => true, moduleId = null } = {}) {
    const stages = (data?.stages ?? []).filter(Boolean);
    if (!stages.length || !name || !(Number(dc) > 0)) return null;
    const onset = Number(data.onset?.value) > 0 && UNITS[data.onset?.unit] ? data.onset : null;
    const ours = stages.map((stage) => stageOf(stage, isCondition));
    const list = onset ? [{ duration: spanOf(onset) }, ...ours] : ours;
    const start = Math.min(Math.max(1, Number(data.stage) || 1), stages.length);
    const flag = { save: { type: data.statistic ?? "fortitude", value: Number(dc) }, onset: Boolean(onset), stages: Object.fromEntries(list.map((stage, index) => [String(index + 1), stage])) };
    if (onset && start > 1) flag.startStage = start + 1;
    const labels = [...(onset ? ["Onset"] : []), ...stages.map((_, index) => `Stage ${index + 1}`)];
    const traits = [...new Set(data.traits ?? [])].filter((trait) => !effectTraits || effectTraits.includes(trait));
    const slug = String(data.slug ?? name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const lines = [
        ...(onset ? [`<p><strong>Onset</strong> ${onset.value} ${onset.unit}</p>`] : []),
        ...(data.maximumDuration?.value ? [`<p><strong>Maximum Duration</strong> ${data.maximumDuration.value} ${data.maximumDuration.unit}</p>`] : []),
        ...stages.map((stage, index) => `<p><strong>Stage ${index + 1}</strong> ${escapeText(stage.text ?? "")}</p>`)
    ];
    return {
        name: `Affliction Effect: ${name}`,
        type: "effect",
        img: img ?? "icons/skills/wounds/blood-cells-disease-green.webp",
        system: {
            slug: `effect-${slug}`,
            level: { value: Number(level) > 0 ? Number(level) : 1 },
            traits: { rarity: "common", value: traits },
            badge: { type: "counter", value: onset ? 1 : start, labels },
            duration: data.maximumDuration?.value ? spanOf(data.maximumDuration) : { ...UNLIMITED },
            description: { value: lines.join("") },
            tokenIcon: { show: true },
            rules: []
        },
        flags: { [AFFLICTIONS]: flag, ...(moduleId ? { [moduleId]: { affliction: { slug, name } } } : {}) }
    };
}

// A creature exposed again to the affliction its built Effect holds (Pseudo Afflictions' own way): a poison a stage further, two on a
// critical failure, no further than its last; a disease or a curse the same. → its new badge value, or null for no change.
export function exposedAgain(effect, degree) {
    const traits = effect?.system?.traits?.value ?? [];
    if (!traits.includes("poison")) return null;
    const value = Number(effect.system?.badge?.value) || 1;
    const max = Number(effect.system?.badge?.max) || (effect.system?.badge?.labels ?? []).length || value;
    const next = Math.min(value + (degree === "criticalFailure" ? 2 : 1), max);
    return next > value ? next : null;
}
