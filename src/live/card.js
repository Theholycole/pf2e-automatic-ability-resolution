// A live-play confirmation card for an ability, as pure data and HTML: the
// ability's plan, who uses it, its targets and their rolls, and what Apply did.
// The Foundry side (scripts/live.js) makes the rolls, keeps the card's state in
// its chat message's flags and applies the results.

export const CARD_VERSION = 1;
export const DEGREE_LABELS = Object.freeze({ criticalFailure: "critical failure", failure: "failure", success: "success", criticalSuccess: "critical success" });

const STATISTIC_LABELS = { fortitude: "Fortitude", reflex: "Reflex", will: "Will", perception: "Perception", athletics: "Athletics", acrobatics: "Acrobatics", intimidation: "Intimidation", deception: "Deception" };
export const statisticLabel = (slug) => STATISTIC_LABELS[slug] ?? String(slug ?? "").replace(/^./, (letter) => letter.toUpperCase());

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

// What a plan asks for: a save each target attempts against a fixed DC, or the
// user's check against each target's DC. null when it rolls nothing a card can.
export function cardCheck(plan) {
    const check = plan?.resolution?.check;
    if (!check) return null;
    if (check.roll === "save" && check.against?.dc === "fixed") return { kind: "save", statistic: check.statistic, dc: check.against.value, basic: !!check.basic };
    if (check.roll === "skill" && check.against?.dc === "target") return { kind: "check", statistic: [].concat(check.statistic)[0], against: check.against.statistic };
    return null;
}

// A new card's state. source: { actorUuid, tokenUuid, name }; targets: [{ actorUuid, tokenUuid, name }].
export function createCard({ plan, ability, source, targets, rider = null }) {
    const check = cardCheck(plan);
    if (!check) return null;
    return {
        version: CARD_VERSION,
        ability: { name: ability?.name ?? plan?.source?.name ?? "Ability", uuid: ability?.uuid ?? plan?.source?.uuid ?? null, slug: plan?.source?.slug ?? null },
        source,
        plan,
        check,
        rider,
        targets: targets.map((target, index) => ({ id: `t${index}`, actorUuid: target.actorUuid, tokenUuid: target.tokenUuid ?? null, name: target.name, dc: target.dc ?? null, total: null, natural: null, degree: null })),
        status: "open",
        results: []
    };
}

// The roll a target row waits for, as the identifier its roll carries.
export const rollIdentifier = (cardId, targetId) => `aar:${cardId}:${targetId}`;

export function parseIdentifier(identifier) {
    const match = /^aar:([^:]+):([^:]+)$/.exec(String(identifier ?? ""));
    return match ? { cardId: match[1], targetId: match[2] } : null;
}

// Records a roll on the card. Returns the new state (or the same one if the target isn't there).
export function recordRoll(state, targetId, { total, natural, degree }) {
    if (!DEGREE_LABELS[degree]) return state;
    return { ...state, targets: state.targets.map((target) => (target.id === targetId ? { ...target, total, natural, degree } : target)) };
}

export const allRolled = (state) => state.targets.length > 0 && state.targets.every((target) => target.degree);

// The check line under the title: "DC 33 basic Reflex save" or "Athletics against each target's Fortitude DC".
export function checkLine(state) {
    const check = state.check;
    if (check.kind === "save") return `DC ${check.dc}${check.basic ? " basic" : ""} ${statisticLabel(check.statistic)} save`;
    return `${statisticLabel(check.statistic)} against each target's ${statisticLabel(check.against)} DC`;
}

// The card's HTML. Buttons carry data-aar-action ("roll", "roll-all", "targets",
// "apply") and data-target-id; the Foundry side shows each to whoever may press it.
export function cardHTML(state) {
    const rows = state.targets.map((target) => {
        // A save: the target's roll; a check: the user's roll against the target's DC.
        const roll = state.check.kind === "check" ? `${statisticLabel(state.check.statistic)} ${target.total} vs DC ${target.dc}` : `${target.total}`;
        const result = target.degree
            ? `<span class="aar-result aar-${escape(target.degree)}">${escape(roll)}: ${escape(DEGREE_LABELS[target.degree])}</span>`
            : state.status === "open" ? `<button type="button" data-aar-action="roll" data-target-id="${escape(target.id)}">Roll ${escape(state.check.kind === "save" ? statisticLabel(state.check.statistic) : statisticLabel(state.check.statistic))}</button>` : "<span class=\"aar-result\">not rolled</span>";
        return `<li class="aar-target" data-target-id="${escape(target.id)}"><span class="aar-name">${escape(target.name)}</span>${result}</li>`;
    }).join("");
    const controls = state.status === "open"
        ? `<footer class="aar-controls"><button type="button" data-aar-action="targets" data-gm-only="true">Use my targets</button><button type="button" data-aar-action="roll-all" data-gm-only="true"${state.targets.some((target) => !target.degree) ? "" : " disabled"}>Roll the rest</button><button type="button" data-aar-action="apply" data-gm-only="true"${allRolled(state) ? "" : " disabled"}>Apply</button></footer>`
        : "";
    const results = state.results.length ? `<ul class="aar-applied">${state.results.map((line) => `<li>${escape(line)}</li>`).join("")}</ul>` : "";
    const empty = state.targets.length ? "" : `<p class="aar-hint">No targets: target the creatures, then press Use my targets.</p>`;
    const rider = state.rider ? ` <span class="aar-rider">after ${escape(state.rider.strikeName)}</span>` : "";
    return `<section class="pf2e-aar-card" data-aar-status="${escape(state.status)}"><header><strong>${escape(state.ability.name)}</strong>${rider}<span class="aar-check">${escape(checkLine(state))}</span></header>${empty}<ul class="aar-targets">${rows}</ul>${results}${controls}</section>`;
}

// Plain lines for what Apply did, from the core's changes. names: { id: name }.
export function changeLines(changes, names, { conditionLabel = (slug) => slug } = {}) {
    const lines = [];
    for (const change of changes) {
        const who = names[change.target] ?? "a creature";
        switch (change.op) {
            case "damage":
                lines.push(`${who} takes ${change.instances.map((instance) => `${instance.amount} ${instance.type}`).join(" and ")}`);
                break;
            case "condition":
                lines.push(`${who} is ${conditionLabel(change.slug)}${Number.isFinite(change.value) ? ` ${change.value}` : ""}`);
                break;
            case "move":
                lines.push(`${who} is ${change.kind === "pull" ? "pulled" : "pushed"} ${change.distance} feet (move the token)`);
                break;
            case "affliction":
                lines.push(`${who} is afflicted with ${change.data?.name ?? "the affliction"} (stage ${change.data?.stage ?? 1})`);
                break;
            case "effect":
                if (change.effect?.kind === "swallow") lines.push(`${who} is swallowed (grabbed and slowed 1; takes ${change.effect.damage} at the end of each of its turns${change.effect.rupture ? `; Rupture ${change.effect.rupture}` : ""}${change.effect.escapeDC ? `; Escape DC ${change.effect.escapeDC}` : ""})`);
                break;
            case "note":
                lines.push(change.text);
                break;
            default:
                break;
        }
    }
    return lines;
}
