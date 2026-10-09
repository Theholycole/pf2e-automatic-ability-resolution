// Live play: cards for monsters' auras (docs/live-play.md).
//
// The user's decisions (2026-10-08):
// - foes only: creatures whose token disposition differs from the monster's
//   (the GM can add others with "Use my targets");
// - being inside when combat starts counts as entering;
// - an aura moving onto a creature (the monster moves) counts as entering;
// - only while an encounter runs on the scene, and only between creatures in it.
//
// An aura acts when its text says (src/compiler/auras.js): a creature enters
// it, starts its turn in it or ends its turn in it. Distances are PF2e's
// (the core's grid geometry), from the monster's space; walls don't block (the
// GM confirms every card). A creature already immune (Frightful Presence's
// minute), or already waiting on an open card from the same aura, gets none.
// Only the active GM's client acts, one trigger at a time.

import { distanceFeet, pathPositions } from "../../pf2e-resolution-core/src/model/grid.js";
import { abilitySlug, cardCheck } from "../src/live/card.js";
import { AURA_CAUSES, activeAfterUse, auraConditionEffect, auraConditionStep, auraWhen, entered, isImmune } from "../src/live/auras.js";
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
        if (!isActiveGM()) return;
        serially("move", () => onMove(token, movement));
        // Conditions that last while in an aura, in or out of an encounter.
        serially("leaving", () => checkAuraConditions(token.parent));
    });
    Hooks.on("updateActor", (actor, changed) => {
        if (!isActiveGM() || changed.system?.attributes?.hp?.value === undefined) return;
        for (const scene of new Set(actor.getActiveTokens(false, true).map((token) => token.parent))) serially("aura's creature down", () => checkAuraConditions(scene));
    });
    Hooks.on("deleteToken", (token) => {
        if (isActiveGM() && token.parent) serially("aura's creature gone", () => checkAuraConditions(token.parent));
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

// The tokens taking part in an encounter.
export const inEncounter = (combat) => new Set(combat.combatants.map((combatant) => combatant.tokenId).filter(Boolean));

// The auras of the encounter's monsters on a scene: { token, actor, item, plan, when, radius, key }.
// (A monster on the map but not in the encounter brings no cards.)
function auraSources(scene, combat) {
    const sources = [];
    const taking = inEncounter(combat);
    for (const token of scene.tokens) {
        const actor = token.actor;
        if (!actor || actor.type !== "npc" || token.hidden || actor.isDead || !taking.has(token.id)) continue;
        for (const item of actor.itemTypes.action) {
            const plan = auraPlan(item);
            if (!plan) continue;
            sources.push({ token, actor, item, plan, when: auraWhen(plan), radius: radiusOf(item, plan), key: `${token.id}:${plan.source?.slug ?? item.id}` });
        }
    }
    return sources;
}

// The encounter running on a scene, or null.
export const runningCombat = (scene) => game.combats.find((combat) => combat.started && (combat.scene?.id === scene.id || combat.combatants.some((combatant) => combatant.sceneId === scene.id))) ?? null;

export const gridOf = (scene) => ({ size: scene.grid.size, gridFeet: scene.grid.distance });

// A token's space, at a point of a path or where it stands. (Its stored
// position: while a move animates, Foundry 14's x and y can still show the old one.)
export const box = (token, size, at = token._source ?? token) => ({ x: at.x, y: at.y, w: Number(at.width ?? token.width ?? 1) * size, h: Number(at.height ?? token.height ?? 1) * size, elevation: Number(at.elevation ?? token.elevation ?? 0) });

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
    const taking = inEncounter(combat);
    for (const source of auraSources(scene, combat)) {
        if (!source.when.includes("enter") || !active(source, combat)) continue;
        const inside = (from, to) => distanceFeet(from, to, grid) <= source.radius;
        let targets = [];
        if (source.token.id === token.id) {
            // The aura moved with its monster.
            targets = scene.tokens.filter((other) => taking.has(other.id) && isFoe(source, other) && entered(path.map((at) => inside(box(token, grid.size, at), box(other, grid.size)))));
        } else if (taking.has(token.id) && isFoe(source, token) && entered(path.map((at) => inside(box(source.token, grid.size), box(token, grid.size, at))))) {
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
    const taking = inEncounter(combat);
    for (const source of auraSources(scene, combat)) {
        if (!source.when.includes("enter") || !active(source, combat)) continue;
        const targets = scene.tokens.filter((other) => taking.has(other.id) && isFoe(source, other) && distanceFeet(box(source.token, grid.size), box(other, grid.size), grid) <= source.radius);
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
    for (const source of auraSources(scene, combat)) {
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
    const slug = abilitySlug(source.plan, source.item?.name);
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

// --- Conditions that last while in an aura ------------------------------------------

// Apply's part for a condition lasting "while it remains in the area": an
// effect granting it, tied to the monster's token and the aura's radius. A
// newer one from the same aura replaces the old. false when there's no such condition.
export async function applyAuraCondition(actor, change, state) {
    const template = game.pf2e.ConditionManager.getCondition(change.slug);
    if (!template) return false;
    const item = state.ability.uuid ? await fromUuid(state.ability.uuid).catch(() => null) : null;
    const radius = (item && radiusOf(item, state.plan)) || Number(state.plan?.targeting?.area?.value) || 0;
    const old = actor.itemTypes.effect.filter((effect) => {
        const flag = effect.flags?.[MODULE_ID]?.whileInAura;
        return flag?.sourceToken === state.source.tokenUuid && flag.slug === change.slug;
    });
    if (old.length) await actor.deleteEmbeddedDocuments("Item", old.map((effect) => effect.id));
    await actor.createEmbeddedDocuments("Item", [auraConditionEffect(MODULE_ID, {
        slug: change.slug,
        value: change.value,
        template: { name: template.name, img: template.img, uuid: template._stats?.compendiumSource ?? template.sourceId ?? template.uuid },
        source: state.source,
        ability: { name: state.ability.name, uuid: state.ability.uuid },
        radius,
        after: change.duration?.after ?? null,
        time: { worldTime: game.time.worldTime, initiative: game.combat?.started ? game.combat.combatant?.initiative ?? null : null },
        targetUuid: actor.uuid
    })]);
    return true;
}

// Each such effect on the scene: ended when its creature has left the aura, or
// the monster is dead or gone; or kept for its stated time after leaving.
async function checkAuraConditions(scene) {
    if (!scene) return;
    const grid = gridOf(scene);
    for (const token of scene.tokens) {
        for (const effect of token.actor?.itemTypes?.effect ?? []) {
            const flag = effect.flags?.[MODULE_ID]?.whileInAura;
            if (!flag) continue;
            const source = flag.sourceToken ? fromUuidSync(flag.sourceToken) : null;
            const sourceGone = !source || source.parent?.id !== scene.id || source.hidden || !source.actor || source.actor.isDead;
            const inside = !sourceGone && distanceFeet(box(source, grid.size), box(token, grid.size), grid) <= Number(flag.radius);
            const step = auraConditionStep({ inside, sourceGone, after: flag.after, lingering: flag.lingering });
            if (step === "end") await effect.delete();
            else if (step === "linger") {
                await effect.update({
                    "system.duration": { value: flag.after.value, unit: flag.after.unit, expiry: "turn-start", sustained: false },
                    "system.start": { value: game.time.worldTime, initiative: game.combat?.started ? game.combat.combatant?.initiative ?? null : null },
                    [`flags.${MODULE_ID}.whileInAura.lingering`]: true
                });
            } else if (step === "resume") {
                await effect.update({ "system.duration": { value: -1, unit: "unlimited", expiry: null, sustained: false }, [`flags.${MODULE_ID}.whileInAura.lingering`]: false });
            }
        }
    }
}
