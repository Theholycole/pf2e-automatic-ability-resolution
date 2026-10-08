// Live play: confirmation cards for monster abilities (docs/live-play.md).
//
// - A monster's ability message, or a Strike that hits and lists a rider, gets
//   a resolution card (on the active GM's client).
// - Each target's roll goes through PF2e, tagged with the card; whoever owns the
//   roller rolls (a target's owner its save, the GM the monster's checks), and
//   the active GM's client writes the result onto the card.
// - Apply (the GM) resolves the plan with the core, using the recorded rolls,
//   and applies the changes: damage through PF2e (its resistances and
//   weaknesses), conditions, swallowing, and afflictions handed to Pseudo Afflictions.

import { allRolled, cardCheck, cardHTML, changeLines, createCard, parseIdentifier, recordRoll, rollIdentifier, statisticLabel } from "../src/live/card.js";

const MODULE_ID = "pf2e-automatic-ability-resolution";
const CORE_ID = "pf2e-resolution-core";
const AFFLICTIONS = "pseudo-afflictions";
const FLAG = "card";

const isActiveGM = () => game.users.activeGM?.isSelf ?? game.user.isGM;
const stateOf = (message) => message?.getFlag?.(MODULE_ID, FLAG) ?? null;
const owns = (uuid) => {
    try {
        return !!fromUuidSync(uuid)?.testUserPermission?.(game.user, "OWNER");
    } catch {
        return false;
    }
};

let compile = null;
let ready = Promise.resolve();

// main.js hands over the compiler (with the basic actions) and a promise for them.
export function setUpLivePlay({ compileItem, loaded }) {
    compile = compileItem;
    ready = loaded;
    injectStyles();
    Hooks.on("createChatMessage", (message) => {
        if (!isActiveGM()) return;
        recordResult(message).catch((error) => console.error(`${MODULE_ID} | recording a roll`, error));
        cardForAbility(message).catch((error) => console.error(`${MODULE_ID} | ability card`, error));
        cardsForRiders(message).catch((error) => console.error(`${MODULE_ID} | rider card`, error));
    });
    Hooks.on("renderChatMessageHTML", (message, html) => wireCard(message, html));
}

// --- Cards ------------------------------------------------------------------

// A target: its actor and token, and for a check, its DC against the statistic.
function targetEntry(token, check) {
    const actor = token.actor;
    const entry = { actorUuid: actor.uuid, tokenUuid: token.document?.uuid ?? token.uuid ?? null, name: token.name ?? actor.name };
    if (check?.kind === "check") entry.dc = actor.getStatistic?.(check.against)?.dc?.value ?? null;
    return entry;
}

async function postCard({ plan, item, sourceActor, sourceToken, tokens, rider = null }) {
    const check = cardCheck(plan);
    if (!check) return null;
    const state = createCard({
        plan,
        ability: { name: item.name, uuid: item.uuid },
        source: { actorUuid: sourceActor.uuid, tokenUuid: sourceToken?.uuid ?? null, name: sourceToken?.name ?? sourceActor.name },
        targets: tokens.map((token) => targetEntry(token, check)),
        rider
    });
    return ChatMessage.create({
        content: cardHTML(state),
        speaker: ChatMessage.getSpeaker({ actor: sourceActor, token: sourceToken ?? undefined }),
        flags: { [MODULE_ID]: { [FLAG]: state } }
    });
}

// A monster's ability, used from its sheet (PF2e's own message for the action).
async function cardForAbility(message) {
    if (message.flags?.pf2e?.context?.type || stateOf(message)) return;
    const origin = message.flags?.pf2e?.origin;
    if (origin?.type !== "action" || !origin.uuid) return;
    const item = await fromUuid(origin.uuid);
    if (!item?.actor || item.actor.type !== "npc") return;
    await ready;
    const plan = compile(item);
    if (!plan?.resolution || (plan.trigger?.event ?? "use") !== "use") return;
    const sourceToken = message.token ?? item.actor.getActiveTokens(true, true)[0] ?? null;
    await postCard({ plan, item, sourceActor: item.actor, sourceToken, tokens: [...game.user.targets] });
}

// A Strike that hits and lists riders (Grab, Knockdown, Push, a venom): a card for each.
async function cardsForRiders(message) {
    const context = message.flags?.pf2e?.context;
    if (context?.type !== "attack-roll" || !["success", "criticalSuccess"].includes(context.outcome)) return;
    const strike = message.flags?.pf2e?.origin?.uuid ? await fromUuid(message.flags.pf2e.origin.uuid) : null;
    const actor = strike?.actor;
    const effects = strike?.system?.attackEffects?.value ?? [];
    if (!actor || actor.type !== "npc" || !effects.length) return;
    const targetToken = context.target?.token ? await fromUuid(context.target.token) : null;
    const target = targetToken?.object ?? targetToken;
    if (!target?.actor) return;
    await ready;
    for (const item of actor.itemTypes.action) {
        const plan = compile(item);
        const trigger = plan?.trigger;
        if (trigger?.event !== "strike" || !(effects.includes(trigger.attackEffect) || effects.includes(plan.source?.slug))) continue;
        await postCard({ plan, item, sourceActor: actor, sourceToken: message.token ?? null, tokens: [target], rider: { strikeName: strike.name, cost: trigger.cost ?? "free" } });
    }
}

// --- Rolls --------------------------------------------------------------------

async function rollTarget(message, target) {
    const state = stateOf(message);
    const actor = await fromUuid(target.actorUuid);
    const source = await fromUuid(state.source.actorUuid);
    const item = state.ability.uuid ? await fromUuid(state.ability.uuid) : null;
    const identifier = rollIdentifier(message.id, target.id);
    if (state.check.kind === "save") {
        const statistic = actor?.getStatistic?.(state.check.statistic);
        if (!statistic) throw new Error(`${target.name} has no ${statisticLabel(state.check.statistic)} save.`);
        return statistic.roll({ dc: { value: state.check.dc, label: `${state.ability.name} DC` }, identifier, skipDialog: true, item, origin: source });
    }
    const statistic = source?.getStatistic?.(state.check.statistic);
    if (!statistic) throw new Error(`${state.source.name} has no ${statisticLabel(state.check.statistic)}.`);
    if (!Number.isFinite(target.dc)) throw new Error(`${target.name}'s ${statisticLabel(state.check.against)} DC is unknown.`);
    return statistic.roll({ dc: { value: target.dc, label: `${target.name}'s ${statisticLabel(state.check.against)} DC` }, identifier, skipDialog: true, item });
}

// A roll tagged with a card's identifier: its result, onto the card (active GM only).
async function recordResult(message) {
    const context = message.flags?.pf2e?.context;
    const id = parseIdentifier(context?.identifier ?? message.rolls?.[0]?.options?.identifier);
    if (!id) return;
    const card = game.messages.get(id.cardId);
    const state = stateOf(card);
    if (!state || state.status !== "open" || !context?.outcome) return;
    const roll = message.rolls?.[0];
    const next = recordRoll(state, id.targetId, { total: roll?.total ?? null, natural: roll?.dice?.[0]?.total ?? null, degree: context.outcome });
    if (next !== state) await card.update({ content: cardHTML(next), [`flags.${MODULE_ID}.${FLAG}`]: next });
}

// --- Buttons ------------------------------------------------------------------

function mayRoll(state, target) {
    if (game.user.isGM) return true;
    return state.check.kind === "save" ? owns(target.actorUuid) : owns(state.source.actorUuid);
}

function wireCard(message, html) {
    const state = stateOf(message);
    if (!state) return;
    for (const button of html.querySelectorAll("[data-aar-action]")) {
        const target = state.targets.find((entry) => entry.id === button.dataset.targetId);
        const visible = button.dataset.gmOnly === "true" ? game.user.isGM : button.dataset.aarAction === "roll" ? target && mayRoll(state, target) : true;
        if (!visible) {
            button.remove();
            continue;
        }
        button.addEventListener("click", async (event) => {
            event.preventDefault();
            button.disabled = true;
            try {
                await press(message, button.dataset.aarAction, button.dataset.targetId);
            } catch (error) {
                ui.notifications.error(`${state.ability.name}: ${error.message}`);
                console.error(`${MODULE_ID} |`, error);
                button.disabled = false;
            }
        });
    }
}

async function press(message, action, targetId) {
    const state = stateOf(message);
    if (action === "roll") return rollTarget(message, state.targets.find((target) => target.id === targetId));
    if (!game.user.isGM) throw new Error("Only the GM can use this control.");
    if (action === "roll-all") {
        for (const target of state.targets.filter((entry) => !entry.degree)) await rollTarget(message, target);
        return null;
    }
    if (action === "targets") {
        const tokens = [...game.user.targets];
        if (!tokens.length) throw new Error("Target the creatures first.");
        const kept = new Map(state.targets.map((target) => [target.tokenUuid ?? target.actorUuid, target]));
        const fresh = createCard({ plan: state.plan, ability: state.ability, source: state.source, targets: tokens.map((token) => targetEntry(token, state.check)) });
        const targets = fresh.targets.map((target) => {
            const before = kept.get(target.tokenUuid ?? target.actorUuid);
            return before?.degree ? { ...target, total: before.total, natural: before.natural, degree: before.degree } : target;
        });
        const next = { ...state, targets };
        return message.update({ content: cardHTML(next), [`flags.${MODULE_ID}.${FLAG}`]: next });
    }
    if (action === "apply") return applyCard(message);
    return null;
}

// --- Apply ----------------------------------------------------------------------

const instanceFormula = (instance) => [...(instance.dice ?? []).map((term) => `${term.factor && term.factor !== 1 ? `${term.factor}*` : ""}${term.count}d${term.die}`), instance.constant ? String(instance.constant) : null].filter(Boolean).join(" + ") || "0";

async function applyCard(message) {
    const state = stateOf(message);
    if (!state || state.status !== "open") return null;
    if (!allRolled(state)) throw new Error("Not every target has rolled yet.");
    const core = game.modules.get(CORE_ID)?.api;
    if (!core) throw new Error("The resolution core isn't active.");
    const caster = { id: "source" };
    const wrappers = state.targets.map((target) => ({ id: target.id }));
    const context = { caster, targets: wrappers, id: (c) => c.id, statistic: () => ({ modifier: 0, dc: 10 }), allied: () => false };
    const rolled = [];
    const io = {
        roll: (_statistic, options) => {
            const who = options?.target ?? options?.actor;
            const target = state.targets.find((entry) => entry.id === who?.id);
            return { degree: target?.degree ?? "failure", total: target?.total ?? null, natural: target?.natural ?? null };
        },
        damage: async (instance) => {
            const formula = instanceFormula(instance);
            const roll = await new Roll(formula).evaluate();
            rolled.push(`${formula}${instance.type ? ` ${instance.type}` : ""} = ${roll.total}`);
            return roll.total;
        }
    };
    const result = await core.registry.resolve(state.plan, context, io);
    const lines = rolled.map((line) => `Damage rolled: ${line}`);
    for (const change of result.changes) {
        try {
            const extra = await applyChange(change, state);
            if (extra) lines.push(extra);
        } catch (error) {
            lines.push(`Couldn't apply ${change.op} to ${state.targets.find((target) => target.id === change.target)?.name ?? "a creature"}: ${error.message}`);
        }
    }
    const names = Object.fromEntries(state.targets.map((target) => [target.id, target.name]));
    // What happened first, then the rolls and reminders.
    const next = { ...stateOf(message), status: "applied", results: [...changeLines(result.changes, names), ...lines] };
    if (!next.results.length) next.results = ["Nothing to apply."];
    return message.update({ content: cardHTML(next), [`flags.${MODULE_ID}.${FLAG}`]: next });
}

async function targetOf(state, id) {
    const target = state.targets.find((entry) => entry.id === id);
    if (!target) return {};
    const token = target.tokenUuid ? await fromUuid(target.tokenUuid) : null;
    return { target, token, actor: token?.actor ?? (await fromUuid(target.actorUuid)) };
}

const damageRollClass = () => (CONFIG.Dice?.rolls ?? []).find((roll) => roll?.name === "DamageRoll");

// One change from the core, applied in Foundry. Returns an extra line for the card, or null.
async function applyChange(change, state) {
    const { target, token, actor } = await targetOf(state, change.target);
    if (!actor && change.target !== undefined) return null;
    switch (change.op) {
        case "damage": {
            const parts = change.instances.filter((instance) => instance.amount > 0).map((instance) => `${instance.amount}[${instance.category === "persistent" ? "persistent," : ""}${instance.type ?? "untyped"}]`);
            if (!parts.length) return null;
            const DamageRoll = damageRollClass();
            const roll = await new DamageRoll(parts.length === 1 ? parts[0] : `{${parts.join(",")}}`).evaluate();
            const item = state.ability.uuid ? await fromUuid(state.ability.uuid) : null;
            await actor.applyDamage({ damage: roll, token: token ?? undefined, item: item ?? undefined });
            return null;
        }
        case "condition": {
            if (change.slug === "persistent-damage") {
                const DamageRoll = damageRollClass();
                const roll = await new DamageRoll(`(${change.damage?.formula ?? change.damage?.amount ?? 1})[persistent,${change.damage?.type ?? "untyped"}]`).evaluate();
                await actor.applyDamage({ damage: roll, token: token ?? undefined });
                return null;
            }
            await setCondition(actor, change.slug, change.value);
            return change.duration?.mode === "fixed" ? `${target.name}'s ${change.slug} lasts ${durationText(change.duration, state.source.name)} (end it then)` : null;
        }
        case "effect":
            if (change.effect?.kind === "swallow") {
                await setCondition(actor, "grabbed", null);
                await setCondition(actor, "slowed", 1);
            }
            return null;
        case "affliction":
            return handOffAffliction(state, target, actor, change.data);
        case "move":
        case "note":
        default:
            return null;
    }
}

// A condition at least at this value (PF2e's conditions take the higher value, not the sum).
async function setCondition(actor, slug, value) {
    const existing = actor.itemTypes.condition.find((condition) => condition.slug === slug && condition.active);
    if (existing) {
        if (Number.isFinite(value) && (existing.value ?? 0) < value) await game.pf2e.ConditionManager.updateConditionValue(existing.id, actor, value);
        return;
    }
    await actor.increaseCondition(slug, Number.isFinite(value) ? { value } : {});
}

function durationText(duration, source) {
    if (duration.expiry === "turn-end") return duration.value === 0 ? `until the end of ${source}'s turn` : `until the end of ${source}'s next turn`;
    if (duration.expiry === "turn-start") return `until the start of ${source}'s turn ${duration.value === 1 ? "next round" : `in ${duration.value} rounds`}`;
    return `${duration.value} ${duration.unit}`;
}

// A creature afflicted by a monster's poison or disease: Pseudo Afflictions
// tracks it from the affliction item, as for the spell module's afflictions.
async function handOffAffliction(state, target, actor, data) {
    if (game.modules.get(AFFLICTIONS)?.active !== true) return `${target.name}: Pseudo Afflictions isn't active, so track ${data?.name ?? "the affliction"} by hand (stage ${data?.stage ?? 1}).`;
    const item = state.ability.uuid ? await fromUuid(state.ability.uuid) : null;
    const source = await fromUuid(state.source.actorUuid);
    if (!item) return `${target.name}: the affliction's item is gone; track it by hand.`;
    Hooks.callAll(`${AFFLICTIONS}.processMessage`, {
        actor,
        item,
        speaker: { actor: source?.id ?? null },
        flags: { pf2e: { context: { type: "saving-throw", outcome: target.degree, dc: { value: data?.dc ?? state.check.dc, label: `${state.ability.name} DC` } } } },
        getRollData: () => item.getRollData?.() ?? {}
    }, {}, game.userId);
    return null;
}

// --- Styles ---------------------------------------------------------------------

function injectStyles() {
    if (document.getElementById(`${MODULE_ID}-styles`)) return;
    const style = document.createElement("style");
    style.id = `${MODULE_ID}-styles`;
    style.textContent = `
.pf2e-aar-card header { display: flex; flex-wrap: wrap; gap: 0.25rem 0.5rem; align-items: baseline; margin-bottom: 0.25rem; }
.pf2e-aar-card .aar-check, .pf2e-aar-card .aar-rider { font-size: 0.85em; opacity: 0.8; }
.pf2e-aar-card ul { list-style: none; margin: 0.25rem 0; padding: 0; }
.pf2e-aar-card .aar-target { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; padding: 0.15rem 0; border-bottom: 1px solid rgba(0,0,0,0.1); }
.pf2e-aar-card .aar-target button { flex: 0 0 auto; width: auto; line-height: 1.4; padding: 0 0.5rem; }
.pf2e-aar-card .aar-criticalSuccess { color: #2e7d32; font-weight: bold; }
.pf2e-aar-card .aar-success { color: #388e3c; }
.pf2e-aar-card .aar-failure { color: #c62828; }
.pf2e-aar-card .aar-criticalFailure { color: #b71c1c; font-weight: bold; }
.pf2e-aar-card .aar-controls { display: flex; gap: 0.25rem; margin-top: 0.25rem; }
.pf2e-aar-card .aar-applied li { font-size: 0.9em; }
.pf2e-aar-card .aar-hint { font-size: 0.9em; font-style: italic; }`;
    document.head.append(style);
}
