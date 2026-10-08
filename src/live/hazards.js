// Hazards in live play, the pure part (scripts/hazards.js is the Foundry side).
// The user's decisions (2026-10-08):
// - Cards for a hazard's actions from its sheet and its Strike riders (as a
//   monster's), a GM card at a complex hazard's turn with its routine and a
//   button per Strike, and Disable checks counted toward the successes it needs.
// - Regions linked to a hazard (ticked on its sheet): a party creature moving
//   into one brings the GM a "Fire / Not now" card, in or out of an encounter.
//   Fire posts its reaction card or rolls its Strikes at that creature; a
//   complex hazard then joins the encounter, rolling Stealth for initiative.
// - A simple hazard that fired is spent until "Reset" on its sheet. A hazard
//   disabled or smashed to 0 HP is defeated, and its Regions stop prompting.
// - A Disable check's critical failure brings the GM the Fire card, aimed at
//   whoever tried.
// - The prompt and the turn card are whispered to the GM; the cards once it fires are public.

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

// A hazard's state on its token: armed (the default), active (a complex one that fired), spent, disabled, destroyed.
export const ARMED = "armed";
export const prompts = (status) => (status ?? ARMED) === ARMED;

// Which Disable option a check is: the one with its skill and DC. options: [{ skill, dc, needed }].
export function disableOption(options, skills, dc) {
    return (options ?? []).find((option) => option.dc === dc && skills.includes(option.skill)) ?? null;
}

// Progress after a Disable check: { count, done }. A critical success counts twice.
export function disableProgress(count, option, outcome) {
    const gained = outcome === "criticalSuccess" ? 2 : outcome === "success" ? 1 : 0;
    const next = (count ?? 0) + gained;
    return { count: next, done: next >= option.needed };
}

export const progressKey = (option) => `${option.skill}:${option.dc}`;

// Along a move, inside a Region or not at each point: did it go in from outside?
export function entered(insides) {
    for (let index = 1; index < insides.length; index++) if (insides[index] && !insides[index - 1]) return true;
    return false;
}

// The GM's prompt. state: { kind: "enter" | "critfail", hazard: { name }, creature: { name }, status, result }.
export function promptHTML(state) {
    const why = state.kind === "critfail"
        ? `${escape(state.creature.name)} critically failed to disable it.`
        : `${escape(state.creature.name)} stepped into its area.`;
    const buttons = state.status === "open" ? `<footer class="aar-controls"><button type="button" data-aar-hazard="fire">Fire</button><button type="button" data-aar-hazard="decline">Not now</button></footer>` : "";
    const result = state.result ? `<ul class="aar-applied"><li>${escape(state.result)}</li></ul>` : "";
    return `<section class="pf2e-aar-card pf2e-aar-hazard" data-aar-status="${escape(state.status)}"><header><strong>${escape(state.hazard.name)}</strong> <span class="aar-rider">hazard</span><span class="aar-check">${why}</span></header>${result}${buttons}</section>`;
}

// The GM's card at a complex hazard's turn. state: { hazard, routine (plain text), strikes: [{ slug, label }],
// targets: [{ name }], fromRegions, status, result }.
export function turnHTML(state) {
    const names = state.targets.map((target) => escape(target.name)).join(", ");
    const at = state.fromRegions ? `In its area: ${names}` : "At your targets";
    const buttons = state.strikes.map((strike) => `<button type="button" data-aar-hazard="strike" data-slug="${escape(strike.slug)}">${escape(strike.label)}</button>`).join("");
    const result = state.result ? `<ul class="aar-applied"><li>${escape(state.result)}</li></ul>` : "";
    return `<section class="pf2e-aar-card pf2e-aar-hazard" data-aar-status="${escape(state.status)}"><header><strong>${escape(state.hazard.name)}</strong> <span class="aar-rider">routine</span><span class="aar-check">${at}</span></header>${state.routine ? `<p class="aar-hint">${escape(state.routine)}</p>` : ""}${result}${buttons ? `<footer class="aar-controls">${buttons}</footer>` : ""}</section>`;
}
