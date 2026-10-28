// Live play: a new save at a creature's turns (src/live/recurring.js). On the active GM's client, at the end (or start) of the turn of a creature
// that has one of this module's Effects flagged saveEnds — a condition's granting Effect, a note Effect, or the Effect that keeps an escalating
// condition's saves — a save card for it: a gate first when the save has one (the GM's yes or no), then a button its owner or the GM rolls
// with. The roll's degree does the rest: ends it (and what it also ends), steps the condition's value, takes a round off, or lowers the DC.

import { degreeResult, recurringCardHTML, turnStep } from "../src/live/recurring.js";
import { isActiveGM } from "./live.js";

const MODULE_ID = "pf2e-automatic-ability-resolution";
const FLAG = "recurring";
const PREFIX = "aar-recurring:";
const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const DEGREE_WORDS = { criticalSuccess: "critical success", success: "success", failure: "failure", criticalFailure: "critical failure" };

export function setUpRecurring() {
    Hooks.on("pf2e.endTurn", (combatant) => {
        if (isActiveGM()) atTurn(combatant, "end").catch((error) => console.error(`${MODULE_ID} | end-of-turn save`, error));
    });
    Hooks.on("pf2e.startTurn", (combatant) => {
        if (isActiveGM()) atTurn(combatant, "start").catch((error) => console.error(`${MODULE_ID} | start-of-turn save`, error));
    });
    Hooks.on("createChatMessage", (message) => {
        if (isActiveGM()) rolled(message).catch((error) => console.error(`${MODULE_ID} | a repeated save's roll`, error));
    });
    Hooks.on("renderChatMessageHTML", (message, html) => wire(message, html));
    for (const element of document.querySelectorAll("[data-message-id]")) {
        const message = game.messages.get(element.dataset.messageId);
        if (message?.flags?.[MODULE_ID]?.[FLAG]) wire(message, element);
    }
}

// --- At its turns -----------------------------------------------------------------

async function atTurn(combatant, timing) {
    const actor = combatant.actor;
    if (!actor || actor.isDead) return;
    const token = combatant.token ?? null;
    for (const effect of [...actor.itemTypes.effect]) {
        const flag = effect.flags?.[MODULE_ID]?.saveEnds;
        if (!flag || (flag.timing ?? "end") !== timing) continue;
        // (An escalating condition gone by other means: its saves with it.)
        if (flag.condition && !actor.itemTypes.condition.some((condition) => condition.slug === flag.condition && condition.active)) {
            await effect.delete();
            continue;
        }
        const step = turnStep(flag);
        await effect.update({ [`flags.${MODULE_ID}.saveEnds`]: step.next });
        if (step.skip) continue;
        if (step.expire) {
            await endIt(actor, effect, flag, `${token?.name ?? actor.name}'s ${flag.what} ends: its time is up.`, token);
            continue;
        }
        const state = { kind: "recurring", actorUuid: actor.uuid, tokenUuid: token?.uuid ?? null, effectId: effect.id, name: token?.name ?? actor.name, ability: effect.flags?.[MODULE_ID]?.ability ?? effect.name, what: flag.what ?? effect.name, save: flag.save, dc: flag.dc, gate: flag.gate ?? null, status: flag.gate ? "gate" : "open" };
        await ChatMessage.create({ content: recurringCardHTML(state), speaker: ChatMessage.getSpeaker({ actor, token: token ?? undefined }), flags: { [MODULE_ID]: { [FLAG]: state } } });
    }
}

// Ends it: the Effect (a granted condition goes with it), the condition an escalate tracker keeps, and what it also ends; a line in the chat.
async function endIt(actor, effect, flag, line, token = null) {
    const slugs = [...(flag.condition ? [flag.condition] : []), ...(flag.alsoEnds ?? [])];
    if (actor.items.has(effect.id)) await effect.delete();
    for (const slug of slugs) {
        const held = actor.itemTypes.condition.filter((condition) => condition.slug === slug);
        if (held.length) await actor.deleteEmbeddedDocuments("Item", held.map((condition) => condition.id)).catch(() => null);
    }
    await ChatMessage.create({ content: `<p>${escapeHTML(line)}</p>`, speaker: ChatMessage.getSpeaker({ actor, token: token ?? undefined }) });
}

// --- The roll ---------------------------------------------------------------------

async function rolled(message) {
    const context = message.flags?.pf2e?.context;
    const identifier = String(context?.identifier ?? message.rolls?.[0]?.options?.identifier ?? "");
    if (!identifier.startsWith(PREFIX) || !context?.outcome) return;
    const card = game.messages.get(identifier.slice(PREFIX.length));
    const state = card?.flags?.[MODULE_ID]?.[FLAG];
    if (!state || state.status !== "open") return;
    const actor = await fromUuid(state.actorUuid);
    const effect = actor?.items.get(state.effectId);
    const flag = effect?.flags?.[MODULE_ID]?.saveEnds;
    const token = state.tokenUuid ? await fromUuid(state.tokenUuid) : null;
    const said = `${state.name}: ${DEGREE_WORDS[context.outcome] ?? context.outcome}`;
    const done = (result) => card.update({ content: recurringCardHTML({ ...state, status: "done", result }), [`flags.${MODULE_ID}.${FLAG}`]: { ...state, status: "done", result } });
    if (!actor || !effect || !flag) return done(`${said}; the effect was already gone.`);
    const slug = flag.condition ?? flag.slug ?? null;
    const held = slug ? actor.itemTypes.condition.find((condition) => condition.slug === slug && condition.active) : null;
    const result = degreeResult(flag, context.outcome, Number(held?.value) || 0);
    if (result.kind === "end") {
        await endIt(actor, effect, flag, `${state.name} is free of ${state.what}.`, token);
        return done(`${said}: it ends.`);
    }
    if (result.kind === "set" && held) {
        await game.pf2e.ConditionManager.updateConditionValue(held.id, actor, result.value);
        // (2026-10-27, Dreaming Round: the condition its value brings, escalate.atValue.)
        if (result.then && !actor.hasCondition?.(result.then)) await actor.increaseCondition?.(result.then);
        return done(`${said}: ${held.name.replace(/\s*\d+$/, "")} ${result.value}${result.then ? `, and it's ${result.then}` : ""}.`);
    }
    if (result.kind === "reduce") {
        const left = (Number(effect.system?.duration?.value) || 0) - 1;
        if (effect.system?.duration?.unit !== "rounds" || left <= 0) {
            await endIt(actor, effect, flag, `${state.name} is free of ${state.what}.`, token);
            return done(`${said}: its last round is gone; it ends.`);
        }
        await effect.update({ "system.duration.value": left });
        return done(`${said}: a round off (${left} left).`);
    }
    if (result.kind === "drop") {
        await effect.update({ [`flags.${MODULE_ID}.saveEnds.dc`]: result.dc });
        return done(`${said}: it lasts; the next save is DC ${result.dc}.`);
    }
    return done(`${said}: it lasts.`);
}

// --- Buttons ----------------------------------------------------------------------

function wire(message, html) {
    const state = message.flags?.[MODULE_ID]?.[FLAG];
    if (!state || state.kind !== "recurring") return;
    for (const button of html.querySelectorAll("[data-aar-recurring]")) {
        if (button.dataset.wired) continue;
        button.dataset.wired = "1";
        button.addEventListener("click", () => press(message, button.dataset.aarRecurring).catch((error) => ui.notifications.error(error.message)));
    }
}

async function press(message, action) {
    const state = message.flags?.[MODULE_ID]?.[FLAG];
    if (!state) return;
    if (action === "yes" || action === "no") {
        if (!game.user.isGM) return ui.notifications.warn("The GM answers this.");
        const next = action === "yes" ? { ...state, status: "open" } : { ...state, status: "done", result: `${state.name}: no save this turn.` };
        return message.update({ content: recurringCardHTML(next), [`flags.${MODULE_ID}.${FLAG}`]: next });
    }
    if (action !== "roll" || state.status !== "open") return;
    const actor = await fromUuid(state.actorUuid);
    if (!actor) return ui.notifications.warn("That creature isn't here.");
    if (!game.user.isGM && !actor.isOwner) return ui.notifications.warn(`Only ${state.name}'s owner or the GM rolls this.`);
    const statistic = actor.saves?.[state.save] ?? actor.getStatistic?.(state.save);
    if (!statistic) return ui.notifications.warn(`${state.name} has no ${state.save} save.`);
    await statistic.roll({ dc: { value: state.dc, label: `${state.ability} DC` }, identifier: `${PREFIX}${message.id}`, skipDialog: true });
}
