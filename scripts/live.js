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
import { immunityApplies, immunityEffect, isImmune } from "../src/live/auras.js";
import { applySwallow } from "./swallow.js";
import { applyAuraCondition } from "./auras.js";
import { noteToGM, rechargeFormula, rechargeWarning, startRecharge } from "./recharge.js";

const MODULE_ID = "pf2e-automatic-ability-resolution";
const CORE_ID = "pf2e-resolution-core";
const AFFLICTIONS = "pseudo-afflictions";
const FLAG = "card";

export const isActiveGM = () => game.users.activeGM?.isSelf ?? game.user.isGM;
export const stateOf = (message) => message?.getFlag?.(MODULE_ID, FLAG) ?? null;
const owns = (uuid) => {
    try {
        return !!fromUuidSync(uuid)?.testUserPermission?.(game.user, "OWNER");
    } catch {
        return false;
    }
};

let compile = null;
let ready = Promise.resolve();
let basics = () => ({});

// main.js hands over the compiler (with the basic actions) and a promise for them.
export function setUpLivePlay({ compileItem, basicActions, loaded }) {
    compile = compileItem;
    basics = basicActions;
    ready = loaded;
    injectStyles();
    Hooks.on("createChatMessage", (message) => {
        if (!isActiveGM()) return;
        recordResult(message).catch((error) => console.error(`${MODULE_ID} | recording a roll`, error));
        cardForAbility(message).catch((error) => console.error(`${MODULE_ID} | ability card`, error));
        cardsForRiders(message).catch((error) => console.error(`${MODULE_ID} | rider card`, error));
        cardForSkillAction(message).catch((error) => console.error(`${MODULE_ID} | skill action card`, error));
        spendOffGuard(message).catch((error) => console.error(`${MODULE_ID} | spending off-guard`, error));
    });
    Hooks.on("renderChatMessageHTML", (message, html) => wireCard(message, html));
    // The chat log draws the messages already there before "ready": wire those too.
    for (const element of document.querySelectorAll("[data-message-id]")) {
        if (element.querySelector(".pf2e-aar-card")) wireCard(game.messages.get(element.dataset.messageId), element);
    }
}

// --- Cards ------------------------------------------------------------------

// A target: its actor and token, and for a check, its DC against the statistic.
function targetEntry(token, check) {
    const actor = token.actor;
    const entry = { actorUuid: actor.uuid, tokenUuid: token.document?.uuid ?? token.uuid ?? null, name: token.name ?? actor.name };
    if (check?.kind === "check") entry.dc = actor.getStatistic?.(check.against)?.dc?.value ?? null;
    return entry;
}

export async function postCard({ plan, item, sourceActor, sourceToken, tokens, rider = null, cause = null, aura = null, warning = null }) {
    const check = cardCheck(plan);
    if (!check) return null;
    const state = createCard({
        plan,
        ability: { name: item.name, uuid: item.uuid },
        source: { actorUuid: sourceActor.uuid, tokenUuid: sourceToken?.uuid ?? null, name: sourceToken?.name ?? sourceActor.name },
        targets: tokens.map((token) => targetEntry(token, check)),
        rider,
        cause,
        aura,
        warning
    });
    return ChatMessage.create({
        content: cardHTML(state),
        speaker: ChatMessage.getSpeaker({ actor: sourceActor, token: sourceToken ?? undefined }),
        flags: { [MODULE_ID]: { [FLAG]: state } }
    });
}

// A monster's or a hazard's ability, used from its sheet (PF2e's own message for the action).
async function cardForAbility(message) {
    if (message.flags?.pf2e?.context?.type || stateOf(message)) return;
    const origin = message.flags?.pf2e?.origin;
    if (origin?.type !== "action" || !origin.uuid) return;
    const item = await fromUuid(origin.uuid);
    if (!item?.actor || !["npc", "hazard"].includes(item.actor.type)) return;
    await ready;
    const plan = compile(item);
    const sourceToken = message.token ?? item.actor.getActiveTokens(true, true)[0] ?? null;
    const formula = rechargeFormula(item, plan);
    // Used again while it recharges: the card says so (the GM decides).
    const warning = formula ? rechargeWarning(item.actor, item.name) : null;
    if (plan?.resolution && (plan.trigger?.event ?? "use") === "use" && cardCheck(plan)) {
        await postCard({ plan, item, sourceActor: item.actor, sourceToken, tokens: [...game.user.targets], warning });
        return;
    }
    // No card to apply: its recharge starts as it's used.
    if (formula) await noteToGM(item.actor, sourceToken, [warning, await startRecharge({ actor: item.actor, item, formula, tokenUuid: sourceToken?.uuid ?? null })].filter(Boolean));
}

// A monster's or a hazard's Strike that hits and lists riders (Grab, Knockdown, Push, a venom): a card for each.
async function cardsForRiders(message) {
    const context = message.flags?.pf2e?.context;
    if (context?.type !== "attack-roll" || !["success", "criticalSuccess"].includes(context.outcome)) return;
    const strike = message.flags?.pf2e?.origin?.uuid ? await fromUuid(message.flags.pf2e.origin.uuid) : null;
    const actor = strike?.actor;
    const effects = strike?.system?.attackEffects?.value ?? [];
    if (!actor || !["npc", "hazard"].includes(actor.type) || !effects.length) return;
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

// A skill action PF2e has already rolled (a PC's Demoralize, Trip, Grapple,
// Shove, Disarm, Feint, Create a Diversion, Reposition or Escape): a card with
// the roll in, for the GM to apply its result.
const SKILL_ACTIONS = ["demoralize", "trip", "grapple", "shove", "disarm", "feint", "create-a-diversion", "reposition", "escape"];

async function cardForSkillAction(message) {
    const context = message.flags?.pf2e?.context;
    if (!context?.outcome || parseIdentifier(context.identifier)) return;
    const options = context.options ?? [];
    const slug = SKILL_ACTIONS.find((action) => options.includes(`action:${action}`));
    if (!slug) return;
    await ready;
    const plan = basics()[slug];
    if (!plan) return;
    const actor = message.actor ?? (message.speaker?.actor ? game.actors.get(message.speaker.actor) : null);
    if (!actor) return;
    const token = message.token ?? null;
    const targetToken = context.target?.token ? await fromUuid(context.target.token) : null;
    const target = targetToken?.object ?? targetToken;
    const item = await fromUuid(plan.source?.uuid ?? "").catch(() => null);
    const state = createCard({
        plan,
        ability: { name: plan.source?.name ?? slug, uuid: item?.uuid ?? null },
        source: { actorUuid: actor.uuid, tokenUuid: token?.uuid ?? null, name: token?.name ?? actor.name },
        targets: target?.actor ? [{ actorUuid: target.actor.uuid, tokenUuid: targetToken.uuid, name: target.name ?? target.actor.name, dc: context.dc?.value ?? null }] : []
    });
    if (!state) return;
    const roll = message.rolls?.[0];
    const rolled = state.targets.length ? recordRoll(state, state.targets[0].id, { total: roll?.total ?? null, natural: roll?.dice?.[0]?.total ?? null, degree: context.outcome }) : state;
    await ChatMessage.create({ content: cardHTML(rolled), speaker: ChatMessage.getSpeaker({ actor, token: token ?? undefined }), flags: { [MODULE_ID]: { [FLAG]: rolled } } });
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
        if (button.dataset.aarWired) continue;
        button.dataset.aarWired = "true";
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
    lines.push(...(await grantImmunity(state)));
    // "It can't use it again for 1d4 rounds": rolled now.
    const recharge = state.plan?.trigger?.recharge?.formula;
    if (recharge && state.ability.uuid) {
        const item = await fromUuid(state.ability.uuid).catch(() => null);
        const actor = item?.actor ?? (await fromUuid(state.source.actorUuid));
        if (item && actor) lines.push(await startRecharge({ actor, item, formula: recharge, tokenUuid: state.source.tokenUuid }));
    }
    const names = { source: state.source.name, ...Object.fromEntries(state.targets.map((target) => [target.id, target.name])) };
    // What happened first, then the rolls and reminders.
    const next = { ...stateOf(message), status: "applied", results: [...changeLines(result.changes, names), ...lines] };
    if (!next.results.length) next.results = ["Nothing to apply."];
    return message.update({ content: cardHTML(next), [`flags.${MODULE_ID}.${FLAG}`]: next });
}

// "Temporarily immune for 1 minute" (Frightful Presence, Stench, Demoralize):
// an effect on each target whose result grants it, which aura cards check.
async function grantImmunity(state) {
    const immunity = state.plan?.trigger?.immunity;
    const slug = state.plan?.source?.slug ?? state.ability.slug;
    if (!immunity?.duration || !slug) return [];
    const item = state.ability.uuid ? await fromUuid(state.ability.uuid).catch(() => null) : null;
    const lines = [];
    for (const target of state.targets) {
        if (!immunityApplies(immunity, target.degree)) continue;
        const { actor } = await targetOf(state, target.id);
        if (!actor) continue;
        const source = immunity.against === "all" ? null : state.source.actorUuid;
        if (isImmune(actor.itemTypes.effect.map((effect) => effect.flags?.[MODULE_ID]), { slug, source })) continue;
        const data = immunityEffect(MODULE_ID, immunity, {
            ability: { name: state.ability.name, slug, img: item?.img },
            source: { actorUuid: state.source.actorUuid, name: state.source.name },
            time: { worldTime: game.time.worldTime, initiative: game.combat?.started ? game.combat.combatant?.initiative ?? null : null }
        });
        await actor.createEmbeddedDocuments("Item", [data]);
        lines.push(`${target.name} is immune to ${immunity.against === "all" ? `every ${state.ability.name}` : `${state.source.name}'s ${state.ability.name}`} for ${immunity.duration.value} ${immunity.duration.unit.replace(/s$/, immunity.duration.value === 1 ? "" : "s")}`);
    }
    return lines;
}

async function targetOf(state, id) {
    // The user itself (Trip's critical failure, Escape's success).
    if (id === "source") {
        const token = state.source.tokenUuid ? await fromUuid(state.source.tokenUuid) : null;
        return { target: { id: "source", name: state.source.name }, token, actor: token?.actor ?? (await fromUuid(state.source.actorUuid)) };
    }
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
            // Off-guard to one creature's attacks (Feint, Create a Diversion): an effect on that creature.
            if (change.slug === "off-guard" && change.scope?.attacker) return scopedOffGuard(state, change);
            // While it stays in the aura (Aura of Sobs' stupefied): an effect scripts/auras.js ends when it leaves.
            if (change.duration?.mode === "in-aura" && (await applyAuraCondition(actor, change, state))) {
                const after = change.duration.after;
                return `${target.name}'s ${change.slug} lasts while it stays in the aura${after ? `, and ${after.value} ${after.value === 1 ? after.unit.replace(/s$/, "") : after.unit} after it leaves` : ""}`;
            }
            // A condition with a duration: a PF2e effect that grants it and ends on the monster's turn.
            if (change.duration?.mode === "fixed" && ["rounds", "minutes"].includes(change.duration.unit)) {
                await timedCondition(actor, change.slug, change.value, change.duration, state);
                return `${target.name}'s ${change.slug} lasts ${durationText(change.duration, state.source.name)}`;
            }
            await setCondition(actor, change.slug, change.value);
            return null;
        }
        case "effect":
            // Swallowed: an effect granting grabbed and slowed 1, with the damage at the end of each turn (scripts/swallow.js).
            if (change.effect?.kind === "swallow") return applySwallow(state, actor, change.effect);
            if (change.effect?.kind === "disarm") return disarm(actor, change.effect, target);
            if (change.effect?.kind === "modifier") return penaltyEffect(actor, change.effect.modifier, state);
            return null;
        case "end": {
            // Escape: the user's grabbed or restrained ends (an effect granting it goes with it).
            if (change.what?.stabilize) {
                await actor.decreaseCondition?.("dying", { forceRemove: true });
                return `${target.name} is stabilized (still unconscious)`;
            }
            const slugs = change.what?.conditions ?? [];
            const gone = actor.itemTypes.condition.filter((condition) => slugs.includes(condition.slug));
            if (gone.length) await actor.deleteEmbeddedDocuments("Item", gone.map((condition) => condition.id));
            return gone.length ? `${target.name} is no longer ${[...new Set(gone.map((condition) => condition.slug))].join(" or ")}` : null;
        }
        case "affliction":
            return handOffAffliction(state, target, actor, change.data);
        case "move":
            return forcedMove(state, target, token, change);
        case "note":
        default:
            return null;
    }
}

// A condition that lasts "until the end of the monster's next turn" and the
// like: an effect granting it, its duration counted on the monster's turns (as
// the spell module does): 0 rounds when the monster still acts this round, else 1.
async function timedCondition(actor, slug, value, duration, state) {
    const template = game.pf2e.ConditionManager.getCondition(slug);
    if (!template) return setCondition(actor, slug, value);
    const combat = game.combat;
    let rounds = Number(duration.value ?? 1);
    if (duration.anchor === "source-turn" && combat?.started && duration.unit === "rounds" && rounds <= 1) {
        const position = combat.turns.findIndex((turn) => turn.actor?.uuid === state.source.actorUuid);
        if (position >= 0) rounds = (rounds === 0 && duration.expiry === "turn-end" ? position >= combat.turn : position > combat.turn) ? 0 : 1;
    }
    const label = `${template.name}${Number.isFinite(value) ? ` ${value}` : ""}`;
    await actor.createEmbeddedDocuments("Item", [{
        name: `${state.ability.name}: ${label}`,
        type: "effect",
        img: template.img,
        flags: { [MODULE_ID]: { timedCondition: { slug, sourceActorUuid: state.source.actorUuid } } },
        system: {
            description: { value: `<p>${label} from <strong>${state.ability.name}</strong> (${state.source.name}).</p>` },
            duration: { value: rounds, unit: duration.unit, expiry: duration.expiry ?? "turn-start", sustained: false },
            start: { value: game.time.worldTime, initiative: combat?.started ? combat.combatant?.initiative ?? null : null },
            context: { origin: { actor: state.source.actorUuid, item: state.ability.uuid }, target: { actor: actor.uuid }, roll: null },
            rules: [{ key: "GrantItem", uuid: template._stats?.compendiumSource ?? template.sourceId ?? template.uuid, flag: "condition", allowDuplicate: true, alterations: Number.isFinite(value) ? [{ mode: "override", property: "badge-value", value }] : [], onDeleteActions: { granter: "cascade", grantee: "cascade" } }]
        }
    }]);
}

// A penalty or bonus from the result (Bon Mot's -2 status to Perception and
// Will for 1 minute): a PF2e effect with that FlatModifier, for its duration.
async function penaltyEffect(actor, modifier, state) {
    const duration = modifier.duration?.mode === "fixed" ? { value: modifier.duration.value, unit: modifier.duration.unit, expiry: modifier.duration.expiry ?? "turn-start", sustained: false } : { value: -1, unit: "unlimited", expiry: null, sustained: false };
    const sign = modifier.value > 0 ? "+" : "−";
    await actor.createEmbeddedDocuments("Item", [{
        name: `${state.ability.name}: ${sign}${Math.abs(modifier.value)} to ${modifier.selector}`,
        type: "effect",
        img: "icons/svg/downgrade.svg",
        flags: { [MODULE_ID]: { modifier: { selector: modifier.selector, source: state.source.actorUuid } } },
        system: {
            description: { value: `<p>${sign}${Math.abs(modifier.value)} ${modifier.type} to ${modifier.selector}, from <strong>${state.ability.name}</strong> (${state.source.name}).</p>` },
            duration,
            start: { value: game.time.worldTime, initiative: game.combat?.started ? game.combat.combatant?.initiative ?? null : null },
            rules: [{ key: "FlatModifier", selector: modifier.selector, type: modifier.type ?? "untyped", value: modifier.value }]
        }
    }]);
    return null;
}

// Off-guard to one creature only (Feint, Create a Diversion): an effect on the
// creature whose attacks benefit, marking the target's token (PF2e's
// TokenMark, as Hunt Prey does) and making the marked target off-guard to its
// Strikes (melee ones only for Feint), for the duration.
async function scopedOffGuard(state, change) {
    const { actor: attacker } = await targetOf(state, change.scope.attacker);
    const markedId = change.target;
    const { target: marked, token } = await targetOf(state, markedId);
    const offGuard = game.pf2e.ConditionManager.getCondition("off-guard");
    if (!attacker || !token || !offGuard) return `${marked?.name ?? "The target"} is off-guard to ${attacker?.name ?? "one creature"}'s attacks (apply by hand).`;
    const slug = `aar-${state.ability.slug ?? "mark"}-${token.id}`.toLowerCase();
    const duration = change.duration?.mode === "fixed" ? change.duration : { value: 0, unit: "rounds", expiry: "turn-end" };
    const rounds = duration.value === 0 ? 0 : 1;
    await attacker.createEmbeddedDocuments("Item", [{
        name: `${state.ability.name}: ${marked.name} is off-guard to you`,
        type: "effect",
        img: offGuard.img,
        flags: { [MODULE_ID]: { scopedOffGuard: { target: token.uuid, melee: change.scope.attacks === "melee", uses: change.scope.uses ?? null } } },
        system: {
            description: { value: `<p>${marked.name} is off-guard to your ${change.scope.attacks === "melee" ? "melee Strikes" : "attacks"}${change.scope.uses === 1 ? " (your next one)" : ""}.</p>` },
            duration: { value: rounds, unit: "rounds", expiry: duration.expiry ?? "turn-end", sustained: false },
            start: { value: game.time.worldTime, initiative: game.combat?.started ? game.combat.combatant?.initiative ?? null : null },
            rules: [
                { key: "TokenMark", slug, uuid: token.uuid },
                { key: "EphemeralEffect", affects: "target", selectors: change.scope.attacks === "melee" ? ["melee-strike-attack-roll"] : ["strike-attack-roll", "spell-attack-roll"], uuid: offGuard._stats?.compendiumSource ?? offGuard.sourceId ?? offGuard.uuid, predicate: [{ or: [`target:mark:${slug}`, `self:mark:${slug}`] }] }
            ]
        }
    }]);
    return null;
}

// A Feint's success lasts for one melee attack: the attacker's next Strike at
// the marked creature (melee, if only melee counts) spends it (active GM only).
async function spendOffGuard(message) {
    const context = message.flags?.pf2e?.context;
    if (context?.type !== "attack-roll" || !context.target?.token) return;
    const attacker = message.actor ?? game.actors.get(message.speaker?.actor);
    const spent = (attacker?.itemTypes?.effect ?? []).filter((effect) => {
        const scoped = effect.flags?.[MODULE_ID]?.scopedOffGuard;
        if (!scoped || scoped.uses !== 1 || scoped.target !== context.target.token) return false;
        return !scoped.melee || (context.options ?? []).includes("item:melee");
    });
    if (spent.length) await attacker.deleteEmbeddedDocuments("Item", spent.map((effect) => effect.id));
}

// Disarm: a success weakens the grip (PF2e's own Effect: Disarm (Success), which
// asks which weapon); a critical success knocks the target's weapon out of its hands.
async function disarm(actor, effect, target) {
    if (effect.what === "weaken") {
        const source = await fromUuid("Compendium.pf2e.other-effects.Item.PuDS0DEq0CnaSIFV");
        if (source) await actor.createEmbeddedDocuments("Item", [source.toObject()]);
        return source ? null : `${target.name}'s grip is weakened (−2 to attacks with it; apply by hand).`;
    }
    const weapon = actor.itemTypes.weapon?.filter((item) => item.isHeld && item.category !== "unarmed").sort((a, b) => (b.system.bonus?.value ?? 0) - (a.system.bonus?.value ?? 0))[0];
    if (!weapon) return `${target.name} has no weapon in hand to drop.`;
    await weapon.update({ "system.equipped.carryType": "dropped", "system.equipped.handsHeld": 0 });
    return `${target.name} drops ${weapon.name}`;
}

// A push or pull: the token moves square by square away from (or toward) the
// monster, stopped by walls and the scene's edge (the core's forced movement).
async function forcedMove(state, target, token, change) {
    const mover = game.modules.get(CORE_ID)?.api?.forcedMovement;
    const source = state.source.tokenUuid ? await fromUuid(state.source.tokenUuid) : null;
    if (!mover || !token || !source) return `${target.name}: move the token ${change.distance} feet by hand.`;
    const size = source.parent?.grid?.size ?? canvas.grid.size;
    const point = { x: source.x + Number(source.width ?? 1) * size / 2, y: source.y + Number(source.height ?? 1) * size / 2 };
    const result = await mover.forcedMove(token, { point, direction: change.kind === "pull" ? "toward" : "away", feet: change.distance, stopAt: change.kind === "pull" ? source : null, reason: state.ability.name });
    if (!result.moved) return `${target.name} couldn't be moved (${result.stoppedBy ?? result.reason}).`;
    return result.stoppedBy && result.stoppedBy !== "occupied" ? `${target.name} was stopped by ${result.stoppedBy === "wall" ? "a wall" : result.stoppedBy === "edge" ? "the scene's edge" : "a creature"}.` : null;
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
.pf2e-aar-card .aar-hint { font-size: 0.9em; font-style: italic; }
.pf2e-aar-card .aar-warning { margin: 0.25rem 0; font-size: 0.9em; font-weight: bold; color: #b26a00; }`;
    document.head.append(style);
}
