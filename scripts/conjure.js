// Creatures an ability makes or becomes, in live play (2026-10-13, batch 295; the user's call on the last deferred abilities): Eye Probe's
// probes, Spirit Blades' blades, the lantern archons' Gestalt. Each is a world actor of its own (PF2e's creature when the ability links one,
// else one with the numbers the text gives) and a token beside its maker; a card dismisses them. A merge hides the creatures it's made of
// and takes them out of the turns (Foundry doesn't skip hidden ones), keeping one's place for itself; parting puts them back, each with its
// share of the merged creature's Hit Points. Those with a time end at their maker's turn, as zones do.

import { beyondMax, conjuredActorData, conjuredName, placements, shares } from "../src/live/conjure.js";
import { zoneEndsAt, zoneOver } from "../src/live/zones.js";
import { isActiveGM } from "./live.js";
import { noteToGM } from "./recharge.js";

const MODULE_ID = "pf2e-automatic-ability-resolution";
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

// (One at a time: PF2e starts a turn once for each defeated combatant it skips, all at once.)
let queue = Promise.resolve();
const ending = new Set();

export function setUpConjure() {
    Hooks.on("pf2e.startTurn", (combatant) => {
        if (isActiveGM()) queue = queue.then(() => expireConjured(combatant, "start")).catch((error) => console.error(`${MODULE_ID} | conjured end`, error));
    });
    Hooks.on("pf2e.endTurn", (combatant) => {
        if (isActiveGM()) queue = queue.then(() => expireConjured(combatant, "end")).catch((error) => console.error(`${MODULE_ID} | conjured end`, error));
    });
    Hooks.on("renderChatMessageHTML", (message, html) => {
        const card = message.getFlag?.(MODULE_ID, "conjureCard");
        if (!card) return;
        const button = html.querySelector?.("button[data-conjure-end]");
        if (!game.user.isGM) button?.remove();
        button?.addEventListener("click", async (event) => {
            event.preventDefault();
            button.disabled = true;
            await endConjured(card.actorIds ?? []);
        });
    });
}

const conjuredOn = (scene) => (scene?.tokens?.contents ?? []).filter((token) => token.actor?.flags?.[MODULE_ID]?.conjured);

// Their time up at this turn's start or end: dismissed, a merge parted.
async function expireConjured(combatant, phase) {
    const combat = combatant?.parent ?? game.combat;
    if (!combat) return;
    const over = new Set();
    for (const token of conjuredOn(combat.scene ?? canvas.scene)) {
        const conjured = token.actor.flags[MODULE_ID].conjured;
        if (conjured.combatId === combat.id && zoneOver(conjured.endsAt, { phase, round: combat.round, combatantId: combatant.id })) over.add(token.actor.id);
    }
    if (over.size) await endConjured([...over]);
}

// Dismissed (their card's button, or their time), each once.
export async function endConjured(actorIds) {
    for (const id of actorIds) {
        const actor = game.actors.get(id);
        // (Once each: a second click, or its time, while it's already going.)
        if (!actor || ending.has(id)) continue;
        ending.add(id);
        try {
            await endOne(actor);
        } finally {
            ending.delete(id);
        }
    }
}

// One of them ended: its tokens and actor gone; a merge's creatures back, each with its share.
async function endOne(actor) {
    const conjured = actor.flags?.[MODULE_ID]?.conjured ?? {};
    const scene = game.scenes.get(conjured.sceneId) ?? canvas.scene;
    const tokens = (scene?.tokens?.contents ?? []).filter((token) => token.actorId === actor.id);
    if (conjured.merged?.length) {
        const left = Number(tokens[0]?.actor?.system?.attributes?.hp?.value ?? actor.system?.attributes?.hp?.value ?? 0);
        const parts = shares(left, conjured.merged.length);
        const back = [];
        let handBack = null;
        for (const [index, tokenId] of conjured.merged.entries()) {
            const token = scene?.tokens?.get(tokenId);
            if (!token) continue;
            await token.update({ hidden: false });
            await token.actor?.update({ "system.attributes.hp.value": parts[index] });
            if (parts[index] <= 0) await token.actor?.toggleStatusEffect?.("dead", { active: true, overlay: true });
            const turn = (conjured.turns ?? []).find((entry) => entry.tokenId === tokenId);
            const entry = turn ? { tokenId, sceneId: scene.id, actorId: turn.actorId, initiative: turn.initiative, hidden: turn.hidden, ...(parts[index] <= 0 ? { defeated: true } : {}) } : null;
            if (turn?.kept) handBack = entry;
            else if (entry) back.push(entry);
        }
        // (Back in the turns at their own initiative: the place it kept handed back, so the turn doesn't move, then the others.)
        const combat = game.combats.get(conjured.combatId);
        const holder = combat?.combatants?.find((entry) => tokens.some((token) => token.id === entry.tokenId));
        if (holder && handBack) await holder.update({ tokenId: handBack.tokenId, actorId: handBack.actorId, hidden: handBack.hidden, ...(handBack.defeated ? { defeated: true } : {}) });
        if (combat && back.length) await combat.createEmbeddedDocuments("Combatant", back.filter((entry) => !combat.combatants.some((other) => other.tokenId === entry.tokenId)));
        await noteToGM(null, null, [`<strong>${escape(actor.name)}</strong> parts: ${parts.join(", ")} Hit Points each.`]);
    }
    for (const combat of game.combats.contents) {
        const gone = combat.combatants.filter((entry) => tokens.some((token) => token.id === entry.tokenId)).map((entry) => entry.id);
        if (gone.length) await combat.deleteEmbeddedDocuments("Combatant", gone);
    }
    if (tokens.length && scene) await scene.deleteEmbeddedDocuments("Token", tokens.map((token) => token.id));
    await actor.delete();
}

// The ability used: its creatures made beside its maker (a merge's at its place, the others hidden), and their card.
export async function startConjure({ item, plan, sourceToken }) {
    const token = sourceToken?.document ?? sourceToken;
    const scene = token?.parent ?? canvas.scene;
    if (!token || !scene) return noteToGM(item.actor, sourceToken, [`<strong>${escape(item.name)}</strong>: its creatures need the maker's token on the scene.`]);
    const grid = { size: scene.grid.size, distance: scene.grid.distance };
    const combat = game.combats?.find?.((entry) => entry.started && (entry.scene?.id ?? canvas.scene?.id) === scene.id) ?? null;
    // A merge: its maker and the nearest others of its kind beside it, on its side.
    let merged = [];
    if (plan.merge) {
        const near = (other) => Math.hypot(other.x - token.x, other.y - token.y);
        const kin = scene.tokens.filter((other) => other.id !== token.id && !other.hidden && other.actor?.name === token.actor?.name && other.disposition === token.disposition && !other.actor?.isDead).sort((a, b) => near(a) - near(b));
        merged = [token, ...kin].slice(0, plan.merge.count);
        if (merged.length < plan.merge.count) return noteToGM(item.actor, sourceToken, [`<strong>${escape(item.name)}</strong>: it takes ${plan.merge.count} of them; only ${merged.length} are here.`]);
    }
    // (A merge's creatures in the turns: their places, to put them back as it parts. It takes over one of them, the one acting now, else its
    // maker's: when the acting one leaves the turns, Foundry moves the turn on, and PF2e starts it in the wrong round, skipping its next.)
    const mergedTurns = merged.map((entry) => combat?.combatants?.find((candidate) => candidate.tokenId === entry.id)).filter(Boolean);
    const kept = mergedTurns.find((turn) => turn.id === combat?.combatant?.id) ?? mergedTurns.find((turn) => turn.tokenId === token.id) ?? mergedTurns[0] ?? null;
    const turns = mergedTurns.map((turn) => ({ tokenId: turn.tokenId, actorId: turn.actorId, initiative: turn.initiative, hidden: turn.hidden, ...(turn === kept ? { kept: true } : {}) }));
    const combatant = kept ?? combat?.combatants?.find?.((entry) => entry.tokenId === token.id) ?? null;
    const acted = !combatant || combat.combatant?.id === combatant.id || combat.turns.indexOf(combatant) < combat.turn;
    const endsAt = combatant && plan.lasts ? zoneEndsAt(plan.lasts, { round: combat.round, combatantId: combatant.id, acted }) : null;
    const made = [];
    // (On its maker's side: PF2e sets an NPC token's disposition from its actor's alliance, and a compendium creature's is its own.)
    const alliance = item.actor?.alliance;
    const occupied = scene.tokens.filter((other) => !other.hidden).map((other) => ({ x: other.x, y: other.y, width: other.width, height: other.height }));
    const bounds = scene.dimensions?.sceneRect ? { x: scene.dimensions.sceneRect.x, y: scene.dimensions.sceneRect.y, width: scene.dimensions.sceneRect.width, height: scene.dimensions.sceneRect.height } : null;
    for (const creature of plan.creatures ?? []) {
        const count = Math.max(1, Number(creature.count) || 1);
        // (Eye Probe's six at most: the farthest earlier ones go.)
        if (Number.isFinite(plan.max)) {
            const earlier = conjuredOn(scene).filter((other) => other.actor.flags[MODULE_ID].conjured.itemUuid === item.uuid && other.actor.flags[MODULE_ID].conjured.sourceTokenUuid === token.uuid);
            const drop = beyondMax(earlier.map((other) => ({ id: other.actor.id, x: other.x, y: other.y })), { max: plan.max, adding: count, from: { x: token.x, y: token.y } });
            if (drop.length) await endConjured(drop);
        }
        const flags = { itemUuid: item.uuid, itemName: item.name, sourceTokenUuid: token.uuid, sceneId: scene.id, endsAt, combatId: combat?.id ?? null, ...(merged.length ? { merged: merged.filter((entry) => entry.id !== token.id).concat(token).map((entry) => entry.id), turns } : {}) };
        let source = null;
        if (creature.from?.uuid) source = (await fromUuid(creature.from.uuid).catch(() => null))?.toObject?.() ?? null;
        if (creature.from?.uuid && !source) return noteToGM(item.actor, sourceToken, [`<strong>${escape(item.name)}</strong>: PF2e's ${escape(creature.name)} isn't in its compendium.`]);
        const spots = merged.length ? [{ x: token.x, y: token.y }] : placements({ token: { x: token.x, y: token.y, width: token.width, height: token.height }, grid, count, squares: 1, occupied, bounds });
        for (let index = 0; index < count; index++) {
            const name = conjuredName(token.name, creature.name, index, count);
            const data = source
                ? { ...source, name, prototypeToken: { ...(source.prototypeToken ?? {}), name }, flags: { ...(source.flags ?? {}), [MODULE_ID]: { ...(source.flags?.[MODULE_ID] ?? {}), conjured: flags } } }
                : conjuredActorData({ name, size: creature.size, stats: creature.stats, level: item.actor?.level ?? 0, alliance, moduleId: MODULE_ID, flags });
            delete data._id;
            if (source && alliance !== undefined && ["npc", "hazard"].includes(data.type)) foundry.utils.setProperty(data, "system.details.alliance", alliance);
            const actor = await Actor.create(data);
            const spot = spots[index] ?? spots.at(-1) ?? { x: token.x, y: token.y };
            const tokenData = (await actor.getTokenDocument({ x: spot.x, y: spot.y, disposition: token.disposition, hidden: token.hidden })).toObject();
            const [placed] = await scene.createEmbeddedDocuments("Token", [tokenData]);
            made.push({ actor, token: placed });
        }
    }
    // (A merge: the creatures it's made of hidden, out of the turns; it takes over the place it kept, and the others leave.)
    if (merged.length) {
        for (const entry of merged) await entry.update({ hidden: true });
        const [first] = made;
        if (combat && first) {
            if (kept) await kept.update({ tokenId: first.token.id, actorId: first.actor.id, hidden: first.token.hidden });
            else await combat.createEmbeddedDocuments("Combatant", [{ tokenId: first.token.id, sceneId: scene.id, actorId: first.actor.id, initiative: null }]);
            const gone = combat.combatants.filter((candidate) => candidate.id !== kept?.id && merged.some((entry) => entry.id === candidate.tokenId)).map((candidate) => candidate.id);
            if (gone.length) await combat.deleteEmbeddedDocuments("Combatant", gone);
        }
    }
    const lasts = endsAt ? `until ${endsAt.at === "turn-end" ? "the end" : "the start"} of its turn in round ${endsAt.round}` : plan.lasts ? `${plan.lasts.value} ${plan.lasts.unit}` : "until dismissed";
    const names = made.map(({ token: placed }) => escape(placed.name));
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: item.actor, token }),
        whisper: ChatMessage.getWhisperRecipients("GM").map((user) => user.id),
        content: `<section class="pf2e-aar-conjure"><p><strong>${escape(item.name)}</strong>: ${merged.length ? `${merged.length} merged into ${names.join(", ")}` : `${names.length === 1 ? names[0] : `${names.length} of them`}`}. Lasts ${escape(lasts)}.</p>${(plan.notes ?? []).map((note) => `<p>${escape(note)}</p>`).join("")}<button type="button" data-conjure-end>${merged.length ? "Part them" : "Dismiss them"}</button></section>`,
        flags: { [MODULE_ID]: { conjureCard: { actorIds: made.map(({ actor }) => actor.id) } } }
    });
}
