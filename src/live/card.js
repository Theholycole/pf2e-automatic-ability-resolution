// A live-play confirmation card for an ability, as pure data and HTML: the
// ability's plan, who uses it, its targets and their rolls, and what Apply did.
// The Foundry side (scripts/live.js) makes the rolls, keeps the card's state in
// its chat message's flags and applies the results.

export const CARD_VERSION = 1;
export const DEGREE_LABELS = Object.freeze({ criticalFailure: "critical failure", failure: "failure", success: "success", criticalSuccess: "critical success" });

const STATISTIC_LABELS = { ac: "AC", fortitude: "Fortitude", reflex: "Reflex", will: "Will", perception: "Perception", athletics: "Athletics", acrobatics: "Acrobatics", intimidation: "Intimidation", deception: "Deception" };
// (A special attack's slug, batch 121: "efficient-capture" → "Efficient Capture".)
export const statisticLabel = (slug) => STATISTIC_LABELS[slug] ?? String(slug ?? "").split("-").map((word) => word.replace(/^./, (letter) => letter.toUpperCase())).join(" ");
// PF2e selectors as the card says them ("all-speeds", batch 121: its Speeds).
export const selectorLabel = (selector) => ({ "all-speeds": "Speeds" })[selector] ?? selector;

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

// What a plan asks for: a save each target attempts against a fixed DC, or the
// user's check against each target's DC. null when it rolls nothing a card can.
export function cardCheck(plan) {
    const check = plan?.resolution?.check;
    if (!check) return null;
    if (check.roll === "save" && check.against?.dc === "fixed") return { kind: "save", statistic: check.statistic, dc: check.against.value, basic: !!check.basic };
    // No roll ("The target takes 3d8 fire damage"): every target is affected (2026-10-10).
    if (check.roll === "automatic") return { kind: "automatic" };
    // (A bonus of its own, "a +4 status bonus to the Athletics check", batch 36: added to the roll.)
    if (check.roll === "skill" && check.against?.dc === "target") return { kind: "check", statistic: [].concat(check.statistic)[0], against: check.against.statistic, ...(Number(check.bonus?.value) ? { bonus: { value: Number(check.bonus.value), type: check.bonus.type ?? "untyped" } } : {}) };
    return null;
}

// A new card's state. source: { actorUuid, tokenUuid, name }; targets: [{ actorUuid, tokenUuid, name }].
// cause: why it appeared, for the header ("entered the aura"); aura: { key, when } for an aura's card;
// warning: a line for the GM ("Avalanche Breath is still recharging: 2 rounds left.").
// An ability used in one of several ways (a dragon's two breath weapons): a card where the GM picks the way, which then
// becomes that way's card (createCard). modes: [{ name, plan }], plan null for a way the GM resolves by hand.
export function createModeCard({ modes, ability, source, targets, warning = null }) {
    return {
        version: CARD_VERSION,
        kind: "modes",
        ability: { name: ability?.name ?? "Ability", uuid: ability?.uuid ?? null, slug: null },
        source,
        modes: modes.map((mode) => ({ name: mode.name, plan: mode.plan && cardCheck(mode.plan) ? mode.plan : null })),
        warning,
        targets: targets.map((target) => ({ actorUuid: target.actorUuid, tokenUuid: target.tokenUuid ?? null, name: target.name })),
        status: "choose",
        results: []
    };
}

// An ability whose result is a PF2e effect (Battle Cry, Raise Guard, Fiery Rhetoric): a card naming who gets it, with
// the GM's Apply. targets: [{ actorUuid, tokenUuid, name, allied }] (allied: on the user's side); none when the
// effect is the user's own.
export function createEffectCard({ plan, ability, source, targets, warning = null }) {
    const application = plan?.resolution?.applications?.[0];
    if (plan?.resolution?.kind !== "effect" || !application) return null;
    return {
        version: CARD_VERSION,
        kind: "effect",
        modes: null,
        ability: { name: ability?.name ?? plan?.source?.name ?? "Ability", uuid: ability?.uuid ?? plan?.source?.uuid ?? null, slug: abilitySlug(plan, ability?.name) },
        source,
        plan,
        check: null,
        warning,
        targets: application.recipients === "self" ? [] : targets.map((target, index) => ({ id: `t${index}`, actorUuid: target.actorUuid, tokenUuid: target.tokenUuid ?? null, name: target.name, allied: Boolean(target.allied) })),
        status: "open",
        results: []
    };
}

// An ability that casts a spell or has its effects (Dominate, Turn to Mist): a card with the spell, its rank and DC (the GM
// can change them) and what the ability changes, and the GM's Cast, which casts the spell through PF2e. plan: the
// compiler's { builtin: "cast-spell" }; spell: { uuid, name }; rank, dc: what the card starts with (the plan's, or the
// creature's own); attack: its spell attack modifier (dc − 10 unless the text gives a counteract or attack modifier).
export function createCastCard({ plan, ability, source, spell, rank, dc, warning = null }) {
    if (plan?.builtin !== "cast-spell") return null;
    return {
        version: CARD_VERSION,
        kind: "cast",
        modes: null,
        ability: { name: ability?.name ?? plan.source?.name ?? "Ability", uuid: ability?.uuid ?? plan.source?.uuid ?? null, slug: null },
        source,
        spell: { uuid: spell?.uuid ?? plan.spell.uuid, name: spell?.name ?? plan.spell.name ?? "the spell" },
        rank: rank ?? plan.rank ?? null,
        dc: dc ?? plan.dc ?? null,
        attack: plan.attack ?? null,
        tradition: plan.tradition ?? null,
        notes: [...(plan.notes ?? [])],
        check: null,
        warning,
        targets: [],
        status: "open",
        results: []
    };
}

// Who an effect card's effect goes to, in words.
export function effectRecipients(state) {
    const application = state.plan?.resolution?.applications?.[0] ?? {};
    const area = state.plan?.targeting?.area;
    if (application.recipients === "self") return "on itself";
    if (application.recipients === "allies-in-area") return area?.value ? `on its allies within ${area.value} feet (target them)` : "on the allies you target";
    return "on the creature you target";
}

// The ability's slug, for its immunity effects and marks: PF2e's, or one from its name (most bestiary
// abilities have none, and without it Apply couldn't record "immune to the Revenant's Baleful Shriek").
export function abilitySlug(plan, name = null) {
    const slug = plan?.source?.slug;
    if (slug) return slug;
    const from = name ?? plan?.source?.name;
    return from ? String(from).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || null : null;
}

// The action counts a plan's damage depends on (a troop's attacks: 1, 2 or 3 actions), lowest first; [] for one cost.
export function actionCounts(plan) {
    const variants = plan?.resolution?.native?.byActions;
    return variants && typeof variants === "object" ? Object.keys(variants).map(Number).filter(Number.isFinite).sort((a, b) => a - b) : [];
}

export function createCard({ plan, ability, source, targets, rider = null, cause = null, aura = null, warning = null }) {
    const check = cardCheck(plan);
    if (!check) return null;
    const counts = actionCounts(plan);
    return {
        version: CARD_VERSION,
        // A card that was a choice of ways before (createModeCard) is one no longer.
        kind: "resolve",
        modes: null,
        // How many actions the monster spent, for damage by the number of actions (the GM picks; the fewest at first).
        actions: counts.length ? counts[0] : null,
        ability: { name: ability?.name ?? plan?.source?.name ?? "Ability", uuid: ability?.uuid ?? plan?.source?.uuid ?? null, slug: abilitySlug(plan, ability?.name) },
        source,
        plan,
        check,
        rider,
        cause,
        aura,
        warning,
        targets: targets.map((target, index) => ({ id: `t${index}`, actorUuid: target.actorUuid, tokenUuid: target.tokenUuid ?? null, name: target.name, dc: target.dc ?? null, total: null, natural: null, degree: check.kind === "automatic" ? "success" : null })),
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
    if (check.kind === "automatic") return "no roll";
    // (A Strike activity's results: by the Strike already rolled against the target's AC.)
    if (check.against === "ac") return `${statisticLabel(check.statistic)} against the target's AC`;
    const bonus = check.bonus ? ` (+${check.bonus.value} ${check.bonus.type})` : "";
    return `${statisticLabel(check.statistic)}${bonus} against each target's ${statisticLabel(check.against)} DC`;
}

// The card's HTML. Buttons carry data-aar-action ("roll", "roll-all", "targets",
// "apply") and data-target-id; the Foundry side shows each to whoever may press it.
export function cardHTML(state) {
    if (state.kind === "modes") return modeCardHTML(state);
    if (state.kind === "cast") return castCardHTML(state);
    if (state.kind === "effect") return effectCardHTML(state);
    const rows = state.targets.map((target) => {
        // A save: the target's roll; a check: the user's roll against the target's DC.
        const roll = state.check.kind === "check" ? `${statisticLabel(state.check.statistic)} ${target.total} vs ${state.check.against === "ac" ? "AC" : "DC"} ${target.dc}` : `${target.total}`;
        const result = state.check.kind === "automatic" ? `<span class="aar-result">affected</span>`
            : target.degree
            ? `<span class="aar-result aar-${escape(target.degree)}">${escape(roll)}: ${escape(DEGREE_LABELS[target.degree])}</span>`
            : state.status === "open" ? `<button type="button" data-aar-action="roll" data-target-id="${escape(target.id)}">Roll ${escape(state.check.kind === "save" ? statisticLabel(state.check.statistic) : statisticLabel(state.check.statistic))}</button>` : "<span class=\"aar-result\">not rolled</span>";
        return `<li class="aar-target" data-target-id="${escape(target.id)}"><span class="aar-name">${escape(target.name)}</span>${result}</li>`;
    }).join("");
    const controls = state.status === "open"
        ? `<footer class="aar-controls"><button type="button" data-aar-action="targets" data-gm-only="true">Use my targets</button>${state.check.kind === "automatic" ? "" : `<button type="button" data-aar-action="roll-all" data-gm-only="true"${state.targets.some((target) => !target.degree) ? "" : " disabled"}>Roll the rest</button>`}<button type="button" data-aar-action="apply" data-gm-only="true"${allRolled(state) ? "" : " disabled"}>Apply</button></footer>`
        : "";
    const results = state.results.length ? `<ul class="aar-applied">${state.results.map((line) => `<li>${escape(line)}</li>`).join("")}</ul>` : "";
    const empty = state.targets.length ? "" : `<p class="aar-hint">No targets: target the creatures, then press Use my targets.</p>`;
    const rider = state.rider ? ` <span class="aar-rider">after ${escape(state.rider.strikeName)}</span>` : state.cause ? ` <span class="aar-rider">${escape(state.cause)}</span>` : "";
    const warning = state.warning ? `<p class="aar-warning">${escape(state.warning)}</p>` : "";
    // Damage by the number of actions: the GM's pick while the card is open, then the count used.
    const counts = actionCounts(state.plan);
    const actions = !counts.length ? ""
        : state.status === "open" ? `<p class="aar-actions">Actions spent: ${counts.map((count) => `<button type="button" data-aar-action="actions" data-actions="${count}" data-gm-only="true"${count === state.actions ? ' class="aar-chosen" disabled' : ""}>${count}</button>`).join("")}</p>`
        : `<p class="aar-actions">With ${escape(state.actions ?? counts[0])} action${(state.actions ?? counts[0]) === 1 ? "" : "s"}</p>`;
    // (Batch 142, Eye Beams: a damage type of the monster's choosing — the GM's pick while the card is open, the first at first.)
    const types = state.plan?.resolution?.casterChoice?.kind === "damage-type" ? state.plan.resolution.casterChoice.values ?? [] : [];
    const chosenType = state.damageType ?? types[0];
    const typePicker = !types.length ? ""
        : state.status === "open" ? `<p class="aar-actions">Damage type: ${types.map((type) => `<button type="button" data-aar-action="damage-type" data-type="${escape(type)}" data-gm-only="true"${type === chosenType ? ' class="aar-chosen" disabled' : ""}>${escape(type)}</button>`).join("")}</p>`
        : `<p class="aar-actions">As ${escape(chosenType)} damage</p>`;
    return `<section class="pf2e-aar-card" data-aar-status="${escape(state.status)}"><header><strong>${escape(state.ability.name)}</strong>${rider}<span class="aar-check">${escape(checkLine(state))}</span></header>${warning}${actions}${typePicker}${empty}<ul class="aar-targets">${rows}</ul>${results}${controls}</section>`;
}

// An effect card: the effect, who gets it, the targets (allies marked), Apply.
function effectCardHTML(state) {
    const application = state.plan?.resolution?.applications?.[0] ?? {};
    const self = application.recipients === "self";
    const allies = application.recipients === "allies-in-area";
    const rows = state.targets.map((target) => `<li class="aar-target" data-target-id="${escape(target.id)}"><span class="aar-name">${escape(target.name)}</span><span class="aar-result">${allies && !target.allied ? "not an ally: left out" : target.allied ? "ally" : "foe"}</span></li>`).join("");
    const ready = self || state.targets.some((target) => !allies || target.allied);
    const controls = state.status === "open"
        ? `<footer class="aar-controls">${self ? "" : `<button type="button" data-aar-action="targets" data-gm-only="true">Use my targets</button>`}<button type="button" data-aar-action="apply" data-gm-only="true"${ready ? "" : " disabled"}>Apply</button></footer>`
        : "";
    const results = state.results.length ? `<ul class="aar-applied">${state.results.map((line) => `<li>${escape(line)}</li>`).join("")}</ul>` : "";
    const warning = state.warning ? `<p class="aar-warning">${escape(state.warning)}</p>` : "";
    const empty = self || state.targets.length ? "" : `<p class="aar-hint">No targets: target the creatures, then press Use my targets.</p>`;
    return `<section class="pf2e-aar-card" data-aar-status="${escape(state.status)}"><header><strong>${escape(state.ability.name)}</strong><span class="aar-check">${escape(application.label ?? "Effect")} ${escape(effectRecipients(state))}</span></header>${warning}${empty}${rows ? `<ul class="aar-targets">${rows}</ul>` : ""}${results}${controls}</section>`;
}

// A spell cast: the spell, its rank and DC (fields the GM can change before Cast), the ability's changes, Cast.
function castCardHTML(state) {
    const warning = state.warning ? `<p class="aar-warning">${escape(state.warning)}</p>` : "";
    const notes = state.notes?.length ? `<ul class="aar-notes">${state.notes.map((note) => `<li>${escape(note)}</li>`).join("")}</ul>` : "";
    const numbers = [state.rank ? `rank ${state.rank}` : null, state.dc ? `DC ${state.dc}` : null, state.attack != null ? `+${state.attack}` : null].filter(Boolean).join(", ");
    const controls = state.status === "open"
        ? `<footer class="aar-controls aar-cast"><label>Rank <input type="number" min="1" max="10" data-aar-field="rank" value="${escape(state.rank ?? "")}"></label><label>DC <input type="number" min="1" data-aar-field="dc" value="${escape(state.dc ?? "")}"></label><button type="button" data-aar-action="cast" data-gm-only="true">Cast ${escape(state.spell.name)}</button></footer>`
        : "";
    const results = state.results.length ? `<ul class="aar-applied">${state.results.map((line) => `<li>${escape(line)}</li>`).join("")}</ul>` : "";
    return `<section class="pf2e-aar-card" data-aar-status="${escape(state.status)}"><header><strong>${escape(state.ability.name)}</strong><span class="aar-check">${escape(state.spell.name)}${numbers ? ` (${escape(numbers)})` : ""}</span></header>${warning}${notes}${results}${controls}</section>`;
}

// A choice of ways: a GM button for each ("Flame", "Weakening Gas (by hand)").
function modeCardHTML(state) {
    const warning = state.warning ? `<p class="aar-warning">${escape(state.warning)}</p>` : "";
    const buttons = state.status === "choose"
        ? `<footer class="aar-controls aar-modes">${state.modes.map((mode, index) => `<button type="button" data-aar-action="mode" data-mode="${index}" data-gm-only="true">${escape(mode.name)}${mode.plan ? "" : " (by hand)"}</button>`).join("")}</footer>`
        : "";
    const results = state.results.length ? `<ul class="aar-applied">${state.results.map((line) => `<li>${escape(line)}</li>`).join("")}</ul>` : "";
    const targets = state.targets.length ? `<p class="aar-hint">Targets: ${escape(state.targets.map((target) => target.name).join(", "))}</p>` : "";
    return `<section class="pf2e-aar-card" data-aar-status="${escape(state.status)}"><header><strong>${escape(state.ability.name)}</strong><span class="aar-check">${state.status === "choose" ? `which way? (${state.modes.length})` : ""}</span></header>${warning}${targets}${results}${buttons}</section>`;
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
                // "Valeros takes 1d4 persistent bleed" (the dice when they stand as rolled, else the amount).
                if (change.slug === "persistent-damage") {
                    const damage = change.damage ?? {};
                    const dice = damage.dice?.length && !damage.multiplier ? [...damage.dice.map((term) => `${term.factor && term.factor !== 1 ? `${term.factor}×` : ""}${term.count}d${term.die}`), damage.constant ? String(damage.constant) : null].filter(Boolean).join("+") : null;
                    lines.push(`${who} takes ${damage.formula ?? dice ?? damage.amount ?? "some"} persistent ${damage.type ?? "untyped"}`);
                    break;
                }
                lines.push(`${who} is ${conditionLabel(change.slug)}${Number.isFinite(change.value) ? ` ${change.value}` : ""}${change.scope?.attacker ? ` to ${names[change.scope.attacker] ?? "one creature"}'s ${change.scope.uses === 1 ? "next " : ""}${change.scope.attacks === "melee" ? "melee " : ""}attack${change.scope.uses === 1 ? "" : "s"}` : ""}`);
                break;
            case "move":
                lines.push(`${who} is ${change.kind === "pull" ? "pulled" : "pushed"} ${change.distance} feet`);
                break;
            case "death":
                if (change.ifReducedTo === undefined) lines.push(`${who} dies`);
                break;
            case "affliction":
                lines.push(`${who} is afflicted with ${change.data?.name ?? "the affliction"} (stage ${change.data?.stage ?? 1})`);
                break;
            case "effect":
                // "Valeros takes −2 status to will (1 minutes)"
                if (change.effect?.kind === "modifier") {
                    const modifier = change.effect.modifier;
                    lines.push(`${who} takes ${modifier.value < 0 ? "−" : "+"}${Math.abs(modifier.value)} ${modifier.type} to ${selectorLabel(modifier.selector)}${modifier.duration?.mode === "fixed" ? ` (${modifier.duration.value} ${modifier.duration.unit})` : ""}`);
                }
                // A dropped weapon is named by the Foundry side, which knows which one fell.
                if (change.effect?.kind === "disarm" && change.effect.what === "weaken") lines.push(`${who}'s grip is weakened (−${change.effect.penalty ?? 2} to attacks with that weapon)`);
                if (change.effect?.kind === "native") lines.push(`${who} gets ${change.effect.label ?? "the effect"}`);
                if (change.effect?.kind === "swallow") lines.push(`${who} is swallowed (grabbed and slowed 1; ${change.effect.damage ? `takes ${change.effect.damage}` : "no damage"} at the end of each of its turns${change.effect.rupture ? `; Rupture ${change.effect.rupture}` : ""}${change.effect.escapeDC ? `; Escape DC ${change.effect.escapeDC}` : ""})`);
                break;
            case "note":
                // By-hand instructions name the creatures: {source} uses the ability on {target}.
                lines.push(String(change.text).replaceAll("{source}", names.source ?? "the user").replaceAll("{target}", names[change.target] ?? "the target"));
                break;
            default:
                break;
        }
    }
    return lines;
}
