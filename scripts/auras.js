// Live play: cards for monsters' auras (docs/live-play.md).
//
// The user's decisions (2026-10-08):
// - foes only: creatures whose token disposition differs from the monster's
//   (the GM can add others with "Use my targets");
// - being inside when combat starts counts as entering;
// - an aura moving onto a creature (the monster moves) counts as entering;
// - only while an encounter runs on the scene.
//
// An aura acts when its text says (src/compiler/auras.js): a creature enters
// it, starts its turn in it or ends its turn in it. Distances are PF2e's
// (the core's grid geometry), from the monster's space; walls don't block (the
// GM confirms every card). A creature already immune (Frightful Presence's
// minute), or already waiting on an open card from the same aura, gets none.
// Only the active GM's client acts, one trigger at a time.

import { distanceFeet, pathPositions } from "../../pf2e-resolution-core/src/model/grid.js";
import { cardCheck } from "../src/live/card.js";
import { AURA_CAUSES, activeAfterUse, auraWhen, entered, isImmune } from "../src/live/auras.js";
import { isActiveGM, postCard, stateOf } from "./live.js";

const MODULE_ID = "pf2e-automatic-ability-resolution";

let compile = () => null;
let ready = Promise.resolve();
let queue = Promise.resolve();
const plans = new Map();
// Abilities used during an encounter, for auras that act only after one (Miasma): "token:name" → { combatId, round, turn }.
const uses = new Map();
// Damage auras hit a creature once per round: "combat:aura:token" → round.
const hits = new Map();
const started = new Set();

// One trigger at a time, so a card is posted before the next trigger looks for open ones.
const serially = (label, task) => {
    queue = queue.then(task).catch((error) => console.error(`${MODULE_ID} | aura ${label}`, error));
    return queue;
};

export function setUpAuras({ compileItem, loaded }) {
    compile = compileItem;
    ready = loaded;
    // Encounters already under way when the world loads have had their start.
    for (const combat of game.combats) if (combat.started) started.add(combat.id);
    Hooks.on("moveToken", (token, movement) => {
        if (isActiveGM()) serially("move", () => onMove(token, movement));
    });
    Hooks.on("updateCombat", (combat, changed) => {
        if (!isActiveGM() || changed.round !== 1 || started.has(combat.id) || !combat.started) return;
        started.add(combat.id);
        serially("combat start", () => onCombatStart(combat));
    });
    Hooks.on("deleteCombat", (combat) => started.delete(combat.id));
    Hooks.on("pf2e.startTurn", (combatant, encounter) => {
        if (isActiveGM()) serially("turn start", () => onTurn(combatant, encounter, "start-turn"));
    });
    Hooks.on("pf2e.endTurn", (combatant, encounter) => {
        if (isActiveGM()) serially("turn end", () => onTurn(combatant, encounter, "end-turn"));
    });
    Hooks.on("createChatMessage", (message) => {
        if (isActiveGM()) recordUse(message);
    });
}

// --- The scene's auras ----------------------------------------------------------

// The aura plan of an item (cached until the item changes), or null.
function auraPlan(item) {
    const stamp = `${item.uuid}@${item._stats?.modifiedTime ?? 0}`;
    if (!plans.has(stamp)) {
        const plan = compile(item);
        plans.set(stamp, plan?.trigger?.event === "aura" && cardCheck(plan) && auraWhen(plan).length ? plan : null);
    }
    return plans.get(stamp);
}

const radiusOf = (item, plan) => Number(item.rules?.find((rule) => rule.key === "Aura")?.radius) || Number(plan.targeting?.area?.value) || 0;

// The monsters' auras on a scene: { token, actor, item, plan, when, radius, key }.
function auraSources(scene) {
    const sources = [];
    for (const token of scene.tokens) {
        const actor = token.actor;
        if (!actor || actor.type !== "npc" || token.hidden || actor.isDead) continue;
        for (const item of actor.itemTypes.action) {
            const plan = auraPlan(item);
            if (!plan) continue;
            sources.push({ token, actor, item, plan, when: auraWhen(plan), radius: radiusOf(item, plan), key: `${token.id}:${plan.source?.slug ?? item.id}` });
        }
    }
    return sources;
}

// The encounter running on a scene, or null.
const runningCombat = (scene) => game.combats.find((combat) => combat.started && (combat.scene?.id === scene.id || combat.combatants.some((combatant) => combatant.sceneId === scene.id))) ?? null;

const gridOf = (scene) => ({ size: scene.grid.size, gridFeet: scene.grid.distance });

// A token's space, at a point of a path or where it stands. (Its stored
// position: while a move animates, Foundry 14's x and y can still show the old one.)
const box = (token, size, at = token._source ?? token) => ({ x: at.x, y: at.y, w: Number(at.width ?? token.width ?? 1) * size, h: Number(at.height ?? token.height ?? 1) * size, elevation: Number(at.elevation ?? token.elevation ?? 0) });

const isFoe = (source, token) => !!token.actor?.isOfType?.("creature") && token.id !== source.token.id && !token.hidden && !token.actor.isDead && token.disposition !== source.token.disposition;

// position: { round, turn } of the moment (by default the encounter's current turn).
function active(source, combat, position = { round: combat.round, turn: combat.turn }) {
    const after = source.plan.trigger?.activeAfter;
    if (!after) return true;
    const use = uses.get(`${source.token.id}:${after.ability.toLowerCase()}`);
    return use?.combatId === combat.id && activeAfterUse(use, position, after.rounds);
}

// --- Triggers -------------------------------------------------------------------

// A token moved (each checkpoint of a move): a creature that entered an aura,
// or creatures a moving aura reached.
async function onMove(token, movement) {
    const scene = token.parent;
    const combat = scene && runningCombat(scene);
    if (!combat || !movement?.passed?.waypoints?.length) return;
    await ready;
    const grid = gridOf(scene);
    const path = pathPositions([movement.origin, ...movement.passed.waypoints], { size: grid.size, teleport: (point) => point.action === "displace" });
    for (const source of auraSources(scene)) {
        if (!source.when.includes("enter") || !active(source, combat)) continue;
        const inside = (from, to) => distanceFeet(from, to, grid) <= source.radius;
        let targets = [];
        if (source.token.id === token.id) {
            // The aura moved with its monster.
            targets = scene.tokens.filter((other) => isFoe(source, other) && entered(path.map((at) => inside(box(token, grid.size, at), box(other, grid.size)))));
        } else if (isFoe(source, token) && entered(path.map((at) => inside(box(source.token, grid.size), box(token, grid.size, at))))) {
            targets = [token];
        }
        if (targets.length) await trigger(source, targets, "enter", combat);
    }
}

// Combat starts: everyone inside an aura that acts on entering is treated as entering it.
async function onCombatStart(combat) {
    const scene = combat.scene ?? game.scenes.get(combat.combatants.contents[0]?.sceneId);
    if (!scene) return;
    await ready;
    const grid = gridOf(scene);
    for (const source of auraSources(scene)) {
        if (!source.when.includes("enter") || !active(source, combat)) continue;
        const targets = scene.tokens.filter((other) => isFoe(source, other) && distanceFeet(box(source.token, grid.size), box(other, grid.size), grid) <= source.radius);
        if (targets.length) await trigger(source, targets, "combat-start", combat);
    }
}

// A creature starts or ends its turn: the auras it's in that act then.
async function onTurn(combatant, combat, when) {
    const token = combatant.token;
    const scene = token?.parent;
    if (!scene || !token.actor) return;
    await ready;
    const grid = gridOf(scene);
    // When a turn ends, the encounter has already moved on: the moment is the ended turn's.
    const turn = combat.turns.findIndex((entry) => entry.id === combatant.id);
    const position = when === "end-turn" && turn >= 0 ? { round: turn > combat.turn ? combat.round - 1 : combat.round, turn } : undefined;
    for (const source of auraSources(scene)) {
        if (!source.when.includes(when) || !active(source, combat, position) || !isFoe(source, token)) continue;
        if (distanceFeet(box(source.token, grid.size), box(token, grid.size), grid) <= source.radius) await trigger(source, [token], when, combat);
    }
}

// A monster used an ability: auras that act after it (Miasma after Poison Breath) start.
function recordUse(message) {
    const origin = message.flags?.pf2e?.origin;
    if (origin?.type !== "action" || message.flags?.pf2e?.context?.type) return;
    const item = message.item ?? (origin.uuid ? fromUuidSync(origin.uuid) : null);
    const token = message.token ?? null;
    const combat = token?.parent ? runningCombat(token.parent) : null;
    if (!item?.name || !token || !combat) return;
    uses.set(`${token.id}:${item.name.toLowerCase()}`, { combatId: combat.id, round: combat.round, turn: combat.turn });
}

// The card for an aura's targets, less those immune, already hit this round
// (a damage aura) or waiting on an open card from the same aura.
async function trigger(source, tokens, when, combat) {
    const slug = source.plan.source?.slug ?? null;
    const immunity = source.plan.trigger?.immunity;
    const sourceUuid = source.actor.uuid;
    let targets = tokens.filter((token) => !(slug && isImmune(token.actor.itemTypes.effect.map((effect) => effect.flags?.[MODULE_ID]), { slug, source: immunity?.against === "all" ? null : sourceUuid })));
    if (source.plan.trigger?.oncePerRound) {
        targets = targets.filter((token) => hits.get(`${combat.id}:${source.key}:${token.id}`) !== combat.round);
        for (const token of targets) hits.set(`${combat.id}:${source.key}:${token.id}`, combat.round);
    }
    const waiting = new Set(game.messages.contents.slice(-100).map(stateOf).filter((state) => state?.status === "open" && state.aura?.key === source.key).flatMap((state) => state.targets.map((target) => target.tokenUuid)));
    targets = targets.filter((token) => !waiting.has(token.uuid));
    if (!targets.length) return;
    await postCard({ plan: source.plan, item: source.item, sourceActor: source.actor, sourceToken: source.token, tokens: targets, cause: AURA_CAUSES[when] ?? null, aura: { key: source.key, when } });
}
