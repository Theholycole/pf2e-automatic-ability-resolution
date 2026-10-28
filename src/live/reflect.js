// Reflecting a card back (2026-10-27, the item module's Cayden's Tankard and Scale of Igroon): plan.reflect { trait?, kinds?, of:
// "targeting-user", to: "creator" | "chosen" }. The latest open save or attack card whose targets include the user (and, given them, with one
// of the traits — a fear effect's — or of one of the kinds: "line", "ray", "attack") is turned back: to "creator", the whole card
// counteracted and the same check posted at its source alone; to "chosen", the user out of that card and the same check posted at the
// creatures the presser targets, within what's left of its range. The same DC, rows, damage and traits: the card's own check and plan.
// Live: scripts/live.js reflectCard (api.live.reflect). Pure.

const listOf = (value) => [value ?? []].flat().filter((entry) => typeof entry === "string" && entry);

// Whether a card's state is one a reflection can take: open, a save or an attack (a check against AC), targeting the user, of its trait or kind.
export function reflectable(state, reflect, user) {
    if (!state || state.kind !== "resolve" || state.status !== "open") return false;
    const attack = state.check?.kind === "check" && state.check.against === "ac";
    if (state.check?.kind !== "save" && !attack) return false;
    const targeted = (state.targets ?? []).some((target) => (user.tokenUuid && target.tokenUuid === user.tokenUuid) || (!target.tokenUuid && target.actorUuid === user.actorUuid) || (!user.tokenUuid && target.actorUuid === user.actorUuid));
    if (!targeted) return false;
    const traits = listOf(reflect?.trait);
    const has = [...(state.plan?.traits ?? []), ...(state.plan?.activation?.traits ?? [])];
    if (traits.length && !traits.some((trait) => has.includes(trait))) return false;
    const kinds = listOf(reflect?.kinds);
    const kindOf = { line: state.plan?.targeting?.area?.type === "line", attack, ray: /\bray\b/i.test(`${state.ability?.name ?? ""} ${state.plan?.source?.name ?? ""}`) };
    return !kinds.length || kinds.some((kind) => kindOf[kind]);
}

// The latest card a reflection takes: cards [{ id, state }] oldest first → the entry, or null.
export function latestReflectable(cards, reflect, user) {
    for (let index = (cards ?? []).length - 1; index >= 0; index--) if (reflectable(cards[index].state, reflect, user)) return cards[index];
    return null;
}

// Its range in feet: "60 feet", "30 ft.", touch 5; a line's own length when it has none; none (Infinity) when it says nothing.
export function rangeFeet(plan) {
    const text = String(plan?.targeting?.range ?? "");
    const feet = /(\d+)\s*(?:feet|foot|ft\.?)/i.exec(text);
    if (feet) return Number(feet[1]);
    if (/^touch$/i.test(text.trim())) return 5;
    if (plan?.targeting?.area?.type === "line" && Number(plan.targeting.area.value) > 0) return Number(plan.targeting.area.value);
    return Infinity;
}

// What's left of its range once it has come as far as the user.
export const remainingRange = (plan, travelled) => Math.max(0, rangeFeet(plan) - (Number(travelled) || 0));

// The card it was taken from, as it's left: to "creator" (or no one left), counteracted for all its targets; otherwise without the user.
export function reflectedState(state, { user, to, line }) {
    const isUser = (target) => (user.tokenUuid && target.tokenUuid === user.tokenUuid) || target.actorUuid === user.actorUuid;
    const targets = to === "creator" ? state.targets : state.targets.filter((target) => !isUser(target));
    const whole = to === "creator" || !targets.length;
    return { ...state, targets, ...(whole ? { status: "counteracted" } : {}), reflected: [...(state.reflected ?? []), { to, user: user.name ?? null }], results: [...(state.results ?? []), line] };
}
