// A new save at a creature's turns (2026-10-20): a condition's duration.saveEnds, or a note Effect's note.saveEnds — batch 311's monster
// reading ("It can attempt a new Fortitude save at the end of each of its turns", the ghast's paralysis) and the item module's rows:
//   { save: "fortitude"|"reflex"|"will", dc: number | null (null: the plan's own DC), drop? (the DC that much lower after each failure),
//     timing?: "end" (default) | "start" of the bearer's turns, from?: "next" (not the first such turn), rounds? (it ends after that many),
//     mode?: "end" (default: a success or better ends it) | "reduce" (a success takes a round off its time, a critical success ends it) |
//     "escalate" (escalate: { criticalSuccess, success, failure, criticalFailure } — a step on its value, or "end"; max: the most it gets),
//     alsoEnds?: [slugs gone with it], gate?: "<words>" (the GM says yes before the roll, or no for no save that turn) }
// Live (scripts/recurring.js): the Effect that carries it is flagged saveEnds; at that turn's end or start the active GM gets a save card for
// the creature, and its roll does the rest. Pure.

export const SAVES = ["fortitude", "reflex", "will"];
const DEGREES = ["criticalFailure", "failure", "success", "criticalSuccess"];
const MODES = ["end", "reduce", "escalate"];
const capital = (text) => String(text ?? "").charAt(0).toUpperCase() + String(text ?? "").slice(1);

// The saveEnds as live play keeps it on the Effect's flag, or null when it can't be played. dc: the plan's own, for a null one.
export function recurringSpec(saveEnds, dc = null) {
    if (!saveEnds || !SAVES.includes(saveEnds.save)) return null;
    const value = Number(saveEnds.dc === null || saveEnds.dc === undefined || saveEnds.dc === "spell" ? dc : saveEnds.dc);
    if (!Number.isFinite(value) || value <= 0) return null;
    const mode = MODES.includes(saveEnds.mode) ? saveEnds.mode : "end";
    return {
        save: saveEnds.save,
        dc: value,
        drop: Number(saveEnds.drop) || 0,
        timing: saveEnds.timing === "start" ? "start" : "end",
        mode,
        ...(mode === "escalate" ? { escalate: { ...(saveEnds.escalate ?? {}) }, ...(Number.isFinite(Number(saveEnds.max)) ? { max: Number(saveEnds.max) } : {}) } : {}),
        alsoEnds: (saveEnds.alsoEnds ?? []).filter((slug) => typeof slug === "string"),
        ...(Number(saveEnds.rounds) > 0 ? { rounds: Number(saveEnds.rounds) } : {}),
        ...(typeof saveEnds.gate === "string" && saveEnds.gate.trim() ? { gate: saveEnds.gate.trim() } : {}),
        skipFirst: saveEnds.from === "next",
        turns: 0
    };
}

// At a turn of the bearer's: { skip } (the first, from "next"), { expire } (its turns are up), or { roll } — with the flag as it's kept after.
export function turnStep(flag) {
    if (flag.skipFirst) return { skip: true, next: { ...flag, skipFirst: false } };
    const turns = (Number(flag.turns) || 0) + 1;
    if (flag.rounds && turns > flag.rounds) return { expire: true, next: { ...flag, turns } };
    return { roll: true, next: { ...flag, turns } };
}

// What a save's degree does: { kind: "end" } | { kind: "set", value } (escalate) | { kind: "reduce" } (a round off) | { kind: "drop", dc }
// (end's failure with a drop) | { kind: "none" }. now: the condition's value (escalate).
export function degreeResult(flag, degree, now = 0) {
    if (!DEGREES.includes(degree)) return { kind: "none" };
    if (flag.mode === "escalate") {
        const step = flag.escalate?.[degree];
        if (step === "end") return { kind: "end" };
        const value = Math.max(0, Math.min(Number.isFinite(flag.max) ? flag.max : Infinity, (Number(now) || 0) + (Number(step) || 0)));
        if (value <= 0) return { kind: "end" };
        return value === Number(now) ? { kind: "none" } : { kind: "set", value };
    }
    if (flag.mode === "reduce") return degree === "criticalSuccess" ? { kind: "end" } : degree === "success" ? { kind: "reduce" } : { kind: "none" };
    if (degree === "success" || degree === "criticalSuccess") return { kind: "end" };
    return flag.drop ? { kind: "drop", dc: flag.dc - flag.drop } : { kind: "none" };
}

// Its words on a card or an Effect: "a new Will save at the end of each of its turns ends it (DC 25, 1 lower each time)".
export function recurringWords(flag) {
    const when = `${flag.timing === "start" ? "the start" : "the end"} of each of its turns${flag.skipFirst ? " after this one" : ""}`;
    const save = `a new ${capital(flag.save)} save at ${when}`;
    const dc = `DC ${flag.dc}${flag.drop ? `, ${flag.drop} lower each time` : ""}`;
    const limit = flag.rounds ? `; it ends after ${flag.rounds} of them` : "";
    const gate = flag.gate ? ` (only if ${flag.gate.replace(/\.$/, "")})` : "";
    if (flag.mode === "reduce") return `${save}${gate}: a success takes a round off it, a critical success ends it (${dc})${limit}`;
    if (flag.mode === "escalate") {
        const steps = DEGREES.filter((degree) => flag.escalate?.[degree] !== undefined).map((degree) => `${degree.replace(/([A-Z])/g, " $1").toLowerCase()} ${flag.escalate[degree] === "end" ? "ends it" : `${Number(flag.escalate[degree]) > 0 ? "+" : ""}${flag.escalate[degree]}`}`);
        return `${save}${gate}: ${steps.join(", ")}${Number.isFinite(flag.max) ? ` (at most ${flag.max})` : ""} (${dc})${limit}`;
    }
    return `${save}${gate} ends it (${dc})${limit}`;
}

// The Effect's words for it, after its own: " A new Will save at the end of each of its turns ends it (DC 25)."
export const recurringNote = (flag) => (flag ? ` ${recurringWords(flag).replace(/^a/, "A")}.` : "");

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

// The card: state { name, ability, what, save, dc, gate, status: "gate"|"open"|"done", result }. The buttons are scripts/recurring.js's.
export function recurringCardHTML(state) {
    const head = `<header><strong>${escape(state.ability)}</strong><span class="aar-check">${escape(state.name)}: DC ${escape(state.dc)} ${escape(capital(state.save))} save against ${escape(state.what)}</span></header>`;
    if (state.status === "done") return `<section class="pf2e-aar-card">${head}<p>${escape(state.result)}</p></section>`;
    if (state.status === "gate") return `<section class="pf2e-aar-card">${head}<p>Only if ${escape(String(state.gate).replace(/\.$/, ""))}. Did it?</p><div class="aar-buttons"><button type="button" data-aar-recurring="yes">Yes: it saves</button><button type="button" data-aar-recurring="no">No: no save this turn</button></div></section>`;
    return `<section class="pf2e-aar-card">${head}<div class="aar-buttons"><button type="button" data-aar-recurring="roll">Roll the ${escape(capital(state.save))} save</button></div></section>`;
}
