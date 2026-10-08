// Live play: hazards (docs/live-play.md; the decisions are in src/live/hazards.js).
//
// - "Trigger Regions" on a hazard's sheet links Regions to its token; "Reset"
//   arms it again. Its state is on the token: armed, active, spent, disabled, destroyed.
// - A party creature (a PC or a friendly token) moving into a linked Region of
//   an armed hazard brings the GM a whispered "Fire / Not now" card. Fire posts
//   its reaction cards (public) or rolls its Strikes at that creature; a simple
//   hazard is then spent, a complex one joins the encounter (Stealth initiative).
// - At a complex hazard's turn: a GM card with its routine and a button per
//   Strike, at the creatures in its Regions or the GM's targets.
// - A PC's Disable check (the hazard's own skill and DC) counts toward the
//   successes it needs; a critical failure brings the Fire card.
// - At 0 HP a hazard is destroyed; disabled or destroyed, it's defeated in the
//   encounter and its Regions stop prompting.

import { pathPositions } from "../../pf2e-resolution-core/src/model/grid.js";
import { htmlToPlainText } from "../../pf2e-resolution-core/src/text/plain-text.js";
import { mentionsStrike, parseDisable } from "../../pf2e-resolution-core/src/text/hazard-text.js";
import { cardCheck } from "../src/live/card.js";
import { ARMED, disableOption, disableProgress, entered, progressKey, promptHTML, prompts, turnHTML } from "../src/live/hazards.js";
import { isActiveGM, postCard } from "./live.js";
import { noteToGM } from "./recharge.js";

const MODULE_ID = "pf2e-automatic-ability-resolution";
const FLAG = "hazard";
const TRIGGER_TYPES = new Set(["reaction", "free"]);
const AREA_WORDS = /\b(?:burst|emanation|cone|line|centered on|each creature|every creature|all creatures)\b/i;

let compile = () => null;
let queue = Promise.resolve();
const serially = (label, task) => {
    queue = queue.then(task).catch((error) => console.error(`${MODULE_ID} | hazard ${label}`, error));
    return queue;
};

export function setUpHazards({ compileItem }) {
    compile = compileItem;
    Hooks.on("moveToken", (token, movement) => {
        if (isActiveGM()) serially("move", () => onMove(token, movement));
    });
    Hooks.on("createChatMessage", (message) => {
        if (isActiveGM()) serially("check", () => onCheck(message));
    });
    Hooks.on("pf2e.startTurn", (combatant) => {
        if (isActiveGM()) serially("turn", () => onTurn(combatant));
    });
    Hooks.on("updateActor", (actor, changed) => {
        if (isActiveGM() && actor.type === "hazard" && changed.system?.attributes?.hp?.value === 0) serially("destroyed", () => onDestroyed(actor));
    });
    Hooks.on("renderChatMessageHTML", (message, html) => wire(message, html));
    for (const element of document.querySelectorAll("[data-message-id]")) {
        const message = game.messages.get(element.dataset.messageId);
        if (message?.flags?.[MODULE_ID]?.[FLAG]) wire(message, element);
    }
    // The sheet's buttons: application v1 and v2 sheets.
    Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
        if (sheet.actor?.type !== "hazard" || !game.user.isGM) return;
        buttons.unshift({ label: "Reset", class: "aar-hazard-reset", icon: "fa-solid fa-rotate-left", onclick: () => resetHazard(hazardToken(sheet)) });
        buttons.unshift({ label: "Trigger Regions", class: "aar-hazard-regions", icon: "fa-solid fa-draw-polygon", onclick: () => chooseRegions(hazardToken(sheet)) });
    });
    Hooks.on("getHeaderControlsActorSheetV2", (sheet, controls) => {
        if (sheet.actor?.type !== "hazard" || !game.user.isGM) return;
        controls.unshift({ label: "Reset", icon: "fa-solid fa-rotate-left", onClick: () => resetHazard(hazardToken(sheet)) });
        controls.unshift({ label: "Trigger Regions", icon: "fa-solid fa-draw-polygon", onClick: () => chooseRegions(hazardToken(sheet)) });
    });
}

// --- The hazard's token and its state -------------------------------------------

// The sheet's token, or the actor's token on the scene being viewed.
function hazardToken(sheet) {
    return sheet.token ?? sheet.actor?.token ?? sheet.actor?.getActiveTokens(false, true).find((token) => token.parent === canvas.scene) ?? null;
}

const stateOf = (token) => token?.flags?.[MODULE_ID]?.[FLAG] ?? {};
const setState = (token, changes) => token.update({ [`flags.${MODULE_ID}.${FLAG}`]: { ...stateOf(token), ...changes } });

async function chooseRegions(token) {
    if (!token) return ui.notifications.warn("Place the hazard's token on the scene first.");
    const regions = token.parent?.regions?.contents ?? [];
    if (!regions.length) return ui.notifications.warn("This scene has no Regions.");
    const linked = new Set(stateOf(token).regions ?? []);
    const content = `<p>A party creature moving into a ticked Region brings the GM a card to fire ${foundry.utils.escapeHTML?.(token.name) ?? token.name}.</p>${regions.map((region) => `<label class="checkbox"><input type="checkbox" name="region" value="${region.id}" ${linked.has(region.id) ? "checked" : ""}> ${region.name || region.id}</label>`).join("<br>")}`;
    const chosen = await foundry.applications.api.DialogV2.prompt({
        window: { title: `Trigger Regions: ${token.name}` },
        content,
        ok: { label: "Save", callback: (event, button) => [...button.form.querySelectorAll("input[name=region]:checked")].map((input) => input.value) },
        rejectClose: false
    });
    if (chosen) await setState(token, { regions: chosen });
}

async function resetHazard(token) {
    if (!token) return;
    await setState(token, { status: ARMED, progress: {} });
    ui.notifications.info(`${token.name} is armed again.`);
}

// --- Springing ----------------------------------------------------------------------

const isParty = (token) => token?.actor?.type === "character" || token?.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY;

// The creature's center at each square of its move, and whether each is in the Region.
function insides(region, token, movement) {
    const size = token.parent.grid.size;
    const points = [movement.origin, ...(movement.passed?.waypoints ?? [])].filter(Boolean);
    const positions = pathPositions(points, { size, teleport: (point) => point.action === "displace" });
    const width = Number(token._source?.width ?? token.width ?? 1) * size;
    const height = Number(token._source?.height ?? token.height ?? 1) * size;
    return positions.map((at) => region.testPoint({ x: at.x + width / 2, y: at.y + height / 2, elevation: at.elevation ?? token.elevation ?? 0 }));
}

async function onMove(token, movement) {
    if (!isParty(token) || !movement?.origin) return;
    const scene = token.parent;
    for (const hazard of scene.tokens.filter((entry) => entry.actor?.type === "hazard")) {
        const state = stateOf(hazard);
        if (!state.regions?.length || !prompts(state.status)) continue;
        const into = state.regions.map((id) => scene.regions.get(id)).filter(Boolean).some((region) => entered(insides(region, token, movement)));
        if (into) await prompt(hazard, token, "enter");
    }
}

// The GM's Fire / Not now card, unless one for the same hazard and creature is still open.
async function prompt(hazard, creature, kind) {
    const open = game.messages.contents.slice(-30).some((message) => {
        const state = message.flags?.[MODULE_ID]?.[FLAG];
        return state?.card === "prompt" && state.status === "open" && state.hazard.tokenUuid === hazard.uuid && state.creature.tokenUuid === creature.uuid;
    });
    if (open) return;
    const state = { card: "prompt", kind, hazard: { tokenUuid: hazard.uuid, actorUuid: hazard.actor.uuid, name: hazard.name }, creature: { tokenUuid: creature.uuid, name: creature.name }, status: "open", result: null };
    await ChatMessage.create({ content: promptHTML(state), speaker: ChatMessage.getSpeaker({ actor: hazard.actor, token: hazard }), whisper: ChatMessage.getWhisperRecipients("GM").map((user) => user.id), flags: { [MODULE_ID]: { [FLAG]: state } } });
}

// The party creatures in the hazard's linked Regions.
function inItsRegions(hazard) {
    const scene = hazard.parent;
    const regions = (stateOf(hazard).regions ?? []).map((id) => scene.regions.get(id)).filter(Boolean);
    if (!regions.length) return [];
    const size = scene.grid.size;
    return scene.tokens.filter((token) => isParty(token) && regions.some((region) => region.testPoint({ x: token.x + Number(token.width ?? 1) * size / 2, y: token.y + Number(token.height ?? 1) * size / 2, elevation: token.elevation ?? 0 })));
}

// Shift skips PF2e's roll dialog when the GM shows it by default.
const quietly = () => new PointerEvent("click", { shiftKey: !!game.user.settings?.showCheckDialogs });

async function strikeAt(actor, strike, targets) {
    for (const target of targets) {
        target.object?.setTarget(true, { releaseOthers: true, groupSelection: false });
        await strike.variants[0].roll({ event: quietly() });
    }
}

// Fire: its reaction cards (public), or its Strikes at the creature; then spent, or into the encounter.
async function fire(hazard, creature) {
    const actor = hazard.actor;
    const fired = [];
    const reactions = actor.itemTypes.action.filter((item) => TRIGGER_TYPES.has(item.system?.actionType?.value));
    let strikes = false;
    for (const item of reactions) {
        const plan = compile(item);
        if (plan?.resolution && (plan.trigger?.event ?? "use") === "use" && cardCheck(plan)) {
            // An area one (its plan's, or its text's: "a Fireball centered on the triggering creature"):
            // everyone in its Regions too. The card's "Use my targets" adds anyone else.
            const area = plan.targeting?.area || AREA_WORDS.test(htmlToPlainText(item.system?.description?.value ?? ""));
            const tokens = area ? [...new Set([creature, ...inItsRegions(hazard)])] : [creature];
            await postCard({ plan, item, sourceActor: actor, sourceToken: hazard, tokens });
            fired.push(item.name);
        } else if (mentionsStrike(item.system?.description?.value)) strikes = true;
        else {
            // Its text, for the GM to play.
            await item.toMessage?.();
            fired.push(`${item.name} (its text)`);
        }
    }
    const attacks = (actor.system?.actions ?? []).filter((entry) => entry.type === "strike" || entry.variants);
    if ((strikes || !reactions.length) && attacks.length) {
        for (const strike of attacks) await strikeAt(actor, strike, [creature]);
        fired.push(`${attacks.map((strike) => strike.label).join(", ")} at ${creature.name}`);
    }
    const complex = !!actor.system?.details?.isComplex;
    await setState(hazard, { status: complex ? "active" : "spent" });
    if (complex) await joinEncounter(hazard);
    return `${hazard.name} fires${fired.length ? `: ${fired.join("; ")}` : ""}.${complex ? " It rolls initiative." : " It's spent until Reset."}`;
}

// Into the running encounter on its scene, or a new one there, with its initiative (PF2e rolls its Stealth).
async function joinEncounter(hazard) {
    const scene = hazard.parent;
    let combat = game.combats.find((entry) => entry.started && entry.scene?.id === scene.id) ?? game.combats.find((entry) => entry.scene?.id === scene.id) ?? null;
    if (!combat) combat = await Combat.create({ scene: scene.id, active: true });
    let combatant = combat.combatants.find((entry) => entry.tokenId === hazard.id);
    if (!combatant) [combatant] = await combat.createEmbeddedDocuments("Combatant", [{ tokenId: hazard.id, sceneId: scene.id, actorId: hazard.actorId }]);
    // PF2e's roll dialog would hold the card until the GM answers it.
    if (combatant.initiative === null || combatant.initiative === undefined) await combat.rollInitiative([combatant.id], { skipDialog: true });
}

// --- Its turn -----------------------------------------------------------------------

async function onTurn(combatant) {
    const hazard = combatant?.token;
    const actor = combatant?.actor;
    if (actor?.type !== "hazard" || !actor.system?.details?.isComplex) return;
    const status = stateOf(hazard).status;
    if (["disabled", "destroyed", "spent"].includes(status)) return;
    const strikes = (actor.system?.actions ?? []).map((strike) => ({ slug: strike.slug, label: strike.label }));
    const inRegions = inItsRegions(hazard);
    const state = { card: "turn", hazard: { tokenUuid: hazard.uuid, actorUuid: actor.uuid, name: hazard.name }, routine: htmlToPlainText(actor.system?.details?.routine ?? "").trim(), strikes, targets: inRegions.map((token) => ({ name: token.name })), fromRegions: inRegions.length > 0, status: "open", result: null };
    await ChatMessage.create({ content: turnHTML(state), speaker: ChatMessage.getSpeaker({ actor, token: hazard }), whisper: ChatMessage.getWhisperRecipients("GM").map((user) => user.id), flags: { [MODULE_ID]: { [FLAG]: state } } });
}

// --- Disable checks ---------------------------------------------------------------------

// The hazard a Disable check is for: the check's target, or a hazard the roller has
// targeted (PF2e leaves a hazard out of the check's target; Foundry shares each
// user's targets), else the one hazard on the scene whose skill and DC fit.
async function hazardFor(message, context, scene, domains) {
    const targeted = [...(message.author?.targets ?? [])].map((token) => token.document ?? token).find((token) => token.actor?.type === "hazard") ?? null;
    const target = (context.target?.token ? await fromUuid(context.target.token) : null) ?? targeted;
    const dc = context.dc?.value;
    const fits = (token) => {
        const status = stateOf(token).status;
        if (["disabled", "destroyed"].includes(status)) return null;
        return disableOption(parseDisable(token.actor?.system?.details?.disable), domains, dc);
    };
    if (target?.actor?.type === "hazard") {
        const option = fits(target);
        return option ? { hazard: target, option } : null;
    }
    const matches = (scene?.tokens ?? []).filter((token) => token.actor?.type === "hazard").map((token) => ({ hazard: token, option: fits(token) })).filter((entry) => entry.option);
    return matches.length === 1 ? matches[0] : null;
}

async function onCheck(message) {
    const context = message.flags?.pf2e?.context;
    if (context?.type !== "skill-check" || typeof context.dc?.value !== "number" || !context.outcome) return;
    const actor = message.actor;
    if (actor?.type !== "character") return;
    const scene = message.token?.parent ?? canvas.scene;
    const domains = context.domains ?? [];
    const found = await hazardFor(message, context, scene, domains);
    if (!found) return;
    const { hazard, option } = found;
    const who = message.token?.name ?? actor.name;
    const progress = { ...(stateOf(hazard).progress ?? {}) };
    const key = progressKey(option);
    const result = disableProgress(progress[key], option, context.outcome);
    progress[key] = result.count;
    const lines = [];
    if (result.done) {
        await setState(hazard, { progress, status: "disabled" });
        await markDefeated(hazard);
        lines.push(`<strong>${hazard.name}</strong> is disabled (${who}).`);
    } else {
        await setState(hazard, { progress });
        lines.push(`${who}: ${result.count}/${option.needed} toward disabling <strong>${hazard.name}</strong>.`);
    }
    await noteToGM(hazard.actor, hazard, lines);
    if (context.outcome === "criticalFailure" && !result.done) {
        const creature = message.token ?? actor.getActiveTokens(false, true)[0];
        if (creature) await prompt(hazard, creature, "critfail");
    }
}

// --- Out of the fight ---------------------------------------------------------------

async function markDefeated(hazard) {
    for (const combat of game.combats) {
        const combatant = combat.combatants.find((entry) => entry.tokenId === hazard.id);
        if (combatant && !combatant.defeated) await combatant.update({ defeated: true });
    }
}

async function onDestroyed(actor) {
    const tokens = actor.isToken ? [actor.token] : actor.getActiveTokens(false, true);
    for (const token of tokens) {
        if (stateOf(token).status === "destroyed") continue;
        await setState(token, { status: "destroyed" });
        await markDefeated(token);
        await noteToGM(actor, token, [`<strong>${token.name}</strong> is destroyed.`]);
    }
}

// --- The cards' buttons -------------------------------------------------------------

function wire(message, html) {
    const state = message?.flags?.[MODULE_ID]?.[FLAG];
    if (!state) return;
    for (const button of html.querySelectorAll("[data-aar-hazard]")) {
        if (button.dataset.aarWired) continue;
        button.dataset.aarWired = "true";
        if (!game.user.isGM) {
            button.remove();
            continue;
        }
        button.addEventListener("click", async () => {
            button.disabled = true;
            try {
                await press(message, button.dataset.aarHazard, button.dataset.slug);
            } catch (error) {
                ui.notifications.error(`${state.hazard.name}: ${error.message}`);
                console.error(`${MODULE_ID} |`, error);
                button.disabled = false;
            }
        });
    }
}

async function press(message, action, slug) {
    const state = foundry.utils.deepClone(message.flags[MODULE_ID][FLAG]);
    const hazard = await fromUuid(state.hazard.tokenUuid);
    if (!hazard?.actor) throw new Error("The hazard's token isn't there any more.");
    const render = state.card === "turn" ? turnHTML : promptHTML;
    const settle = (changes) => message.update({ content: render({ ...state, ...changes }), [`flags.${MODULE_ID}.${FLAG}`]: { ...state, ...changes } });
    if (state.card === "prompt") {
        if (state.status !== "open") return;
        if (action === "decline") return settle({ status: "declined", result: "Not now." });
        const creature = await fromUuid(state.creature.tokenUuid);
        if (!creature) throw new Error(`${state.creature.name} isn't there any more.`);
        return settle({ status: "used", result: await fire(hazard, creature) });
    }
    // The turn card: a Strike at the creatures in its Regions, or the GM's targets.
    const strike = (hazard.actor.system?.actions ?? []).find((entry) => entry.slug === slug);
    if (!strike) throw new Error("No such Strike.");
    const inRegions = inItsRegions(hazard);
    const targets = inRegions.length ? inRegions : [...game.user.targets].map((token) => token.document ?? token);
    if (!targets.length) throw new Error("Target creatures first.");
    await strikeAt(hazard.actor, strike, targets);
    return settle({ result: [state.result, `${strike.label} at ${targets.map((token) => token.name).join(", ")}`].filter(Boolean).join("; ") });
}
