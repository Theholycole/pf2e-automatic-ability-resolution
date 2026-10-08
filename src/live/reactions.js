// Monster reactions in live play, the pure part (scripts/reactions.js is the
// Foundry side). The user's decisions (2026-10-08): a GM-only offer card when
// a reaction's trigger happens, with a button to use it; one reaction per
// round, tracked; Reactive Strike on leaving a square in reach, a ranged
// attack in reach, or a manipulate spell cast in reach; defensive reactions
// offered after the roll only when they matter (Nimble Dodge's +2 AC turning
// a hit into a miss; Challenge Fate on any hit).

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

export const DEGREES = ["criticalFailure", "failure", "success", "criticalSuccess"];
const DEGREE_WORDS = { criticalFailure: "a critical miss", failure: "a miss", success: "a hit", criticalSuccess: "a critical hit" };

// "Reactive Strike (Tail Only)" → "tail"; no restriction → null.
export function onlyStrike(name) {
    const match = /\(([\w' -]+?) only\)/i.exec(String(name ?? ""));
    return match ? match[1].trim().toLowerCase() : null;
}

// PF2e's degree of success: 10 over the DC a critical, 10 under a critical
// failure, a natural 20 or 1 one step better or worse.
export function degreeOf(total, dc, natural = null) {
    let index = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
    if (natural === 20) index = Math.min(3, index + 1);
    else if (natural === 1) index = Math.max(0, index - 1);
    return DEGREES[index];
}

// What a bonus to AC against the attack would make of it: { before, after },
// or null when it changes nothing.
export function higherAC({ total, dc, natural = null, outcome = null }, value) {
    const before = outcome ?? degreeOf(total, dc, natural);
    const after = degreeOf(total, dc + value, natural);
    return DEGREES.indexOf(after) < DEGREES.indexOf(before) ? { before, after } : null;
}

export const degreeWords = (degree) => DEGREE_WORDS[degree] ?? degree;

// Along a move, in reach or not at each point: did it leave a square in reach?
export function leftReach(insides) {
    for (let index = 1; index < insides.length; index++) if (insides[index - 1]) return true;
    return false;
}

// Conditions that keep a creature from using reactions.
const NO_REACTIONS = new Set(["unconscious", "stunned", "paralyzed", "petrified", "confused"]);
export const blocksReactions = (slugs) => slugs.some((slug) => NO_REACTIONS.has(slug));

// "Reaction used" lasts until the start of the creature's next turn: 0 rounds
// when its turn is still to come this round, otherwise 1.
export const reactionRounds = (position, current) => (position > current ? 0 : 1);

// The offer card. state: { kind, ability, monster, target, trigger, strikes, note, attack, status, result }.
export function offerHTML(state) {
    const who = state.target ? `${escape(state.target.name)} ${escape(state.trigger)}` : escape(state.trigger);
    const buttons = [];
    if (state.status === "open") {
        if (state.kind === "strike") for (const strike of state.strikes ?? []) buttons.push(`<button type="button" data-aar-reaction="strike" data-slug="${escape(strike.slug)}">${escape(strike.label)}${state.penalty ? ` (−${state.penalty})` : ""}</button>`);
        if (state.kind === "ac") buttons.push(`<button type="button" data-aar-reaction="use">Use it: ${escape(degreeWords(state.attack.after))}</button>`);
        if (state.kind === "misfortune") buttons.push(`<button type="button" data-aar-reaction="use">Reroll, keep the worse</button>`);
        if (state.kind === "ferocity") buttons.push(`<button type="button" data-aar-reaction="use">Stay at 1 HP</button>`);
        buttons.push(`<button type="button" data-aar-reaction="decline">Not now</button>`);
    }
    const detail = state.kind === "ac" ? `<p class="aar-hint">+${state.attack.value} AC against it turns ${escape(degreeWords(state.attack.before))} into ${escape(degreeWords(state.attack.after))}.</p>` : "";
    const note = state.note ? `<p class="aar-hint">${escape(state.note)}</p>` : "";
    const result = state.result ? `<ul class="aar-applied"><li>${escape(state.result)}</li></ul>` : "";
    const controls = buttons.length ? `<footer class="aar-controls">${buttons.join("")}</footer>` : "";
    return `<section class="pf2e-aar-card pf2e-aar-reaction" data-aar-status="${escape(state.status)}"><header><strong>${escape(state.ability.name)}</strong> <span class="aar-rider">${escape(state.monster.name)}'s reaction</span><span class="aar-check">${who}</span></header>${detail}${note}${result}${controls}</section>`;
}
