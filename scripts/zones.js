// Live play: zones (2026-10-12, batch 256; docs/live-play.md). An ability's area that lasts becomes a Region on the scene: PF2e's
// difficult terrain on it, and a script behaviour that hands the module its events (on the active GM). A token entering gets the zone's
// concealment, PF2e's effect or penalties inside, and the save, hazard or damage that entering brings; leaving takes away what it gave;
// a turn starting or ending inside brings its saves and damage. The zone ends with its time (at its maker's turn), or by its card's
// button. Its maker isn't harmed by its own zone. A zone that's gone once it acts (zone.once, the item module's snares) goes with its first
// creature.

import { AIMED, aimedShape, burstReaches, burstWords, coveredSquares, entryDirection, modifierWords, snareSquare, spentZoneCard, zoneActions, zoneDamagePlan, zoneEndsAt, zoneMemberEffect, zoneOver, zoneRegion, zoneSetOff } from "../src/live/zones.js";
import { distanceFeet } from "../../pf2e-resolution-core/src/model/grid.js";
import { box, gridOf } from "./auras.js";
import { isActiveGM, postCard } from "./live.js";
import { noteToGM } from "./recharge.js";

const MODULE_ID = "pf2e-automatic-ability-resolution";
const CONCEALED = "Compendium.pf2e.conditionitems.Item.DmAIPqOBomZ7H95W";
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

// Who is inside each zone, on this (the GM's) client: region uuid → token uuids. (Its entering events may come twice as it's made.)
const inside = new Map();
// The zones gone once they act that a creature has set off (their regions going).
const spent = new Set();

export function setUpZones() {
    Hooks.on("pf2e.startTurn", (combatant) => {
        if (isActiveGM()) expireZones(combatant, "start").catch((error) => console.error(`${MODULE_ID} | zone end`, error));
    });
    Hooks.on("pf2e.endTurn", (combatant) => {
        if (isActiveGM()) expireZones(combatant, "end").catch((error) => console.error(`${MODULE_ID} | zone end`, error));
    });
    // (An encounter's zones end with it, those that end with time.)
    Hooks.on("deleteCombat", (combat) => {
        if (!isActiveGM()) return;
        for (const region of zonesOn(combat.scene ?? canvas.scene).filter((entry) => entry.flags[MODULE_ID].zone.combatId === combat.id && entry.flags[MODULE_ID].zone.endsAt)) region.delete().catch(() => {});
    });
    Hooks.on("renderChatMessageHTML", (message, html) => {
        const card = message.getFlag?.(MODULE_ID, "zoneCard");
        if (!card) return;
        const button = html.querySelector?.("button[data-zone-end]");
        button?.addEventListener("click", async (event) => {
            event.preventDefault();
            button.disabled = true;
            for (const uuid of card.regionUuids ?? []) await (await fromUuid(uuid).catch(() => null))?.delete();
        });
    });
}

const zonesOn = (scene) => (scene?.regions?.contents ?? [...(scene?.regions ?? [])]).filter((region) => region.flags?.[MODULE_ID]?.zone);

// The zones whose time is up at this turn's start or end.
async function expireZones(combatant, phase) {
    const combat = combatant?.parent ?? game.combat;
    if (!combat) return;
    for (const region of zonesOn(combat.scene ?? canvas.scene)) {
        const zone = region.flags[MODULE_ID].zone;
        if (zone.combatId === combat.id && zoneOver(zone.endsAt, { phase, round: combat.round, combatantId: combatant.id })) await region.delete();
    }
}

// The ability's zone: its Region (placed by the GM when it's at range, a cone or a line), its time, and its card. (item: the ability, or
// { name, uuid, actor } for one already used up, the item module's snares; on the GM's client, which makes the Region.)
// at (2026-10-16): { token, scene } — a square to make it at in place of the creature's token (a snare's area where the snare was, zone.then);
// sourceToken still gives its time.
export async function startZone({ item, plan, sourceToken, at = null }) {
    const zone = plan.zone;
    const token = sourceToken?.document ?? sourceToken;
    const scene = at?.scene ?? token?.parent ?? canvas.scene;
    const place = at?.token ?? (token ? { id: token.id, x: token.x, y: token.y, width: token.width, height: token.height, shape: token.shape } : null);
    if (!place || !scene) {
        await noteToGM(item.actor, sourceToken, [`<strong>${escape(item.name)}</strong>: its area needs the creature's token on the scene.`]);
        return;
    }
    const rolled = zone.lasts?.valueRoll ? (await new Roll(zone.lasts.valueRoll).evaluate()).total : null;
    const combat = game.combats?.find?.((entry) => entry.started && (entry.scene?.id ?? canvas.scene?.id) === scene.id) ?? null;
    const combatant = token ? combat?.combatants?.find?.((entry) => entry.tokenId === token.id) ?? null : null;
    const acted = !combatant || combat.combatant?.id === combatant.id || combat.turns.indexOf(combatant) < combat.turn;
    const endsAt = combatant ? zoneEndsAt(zone.lasts, { round: combat.round, combatantId: combatant.id, rolled, acted }) : null;
    const flags = { zone, itemUuid: item.uuid, itemName: item.name, sourceActorUuid: item.actor.uuid, sourceTokenUuid: token?.uuid ?? null, endsAt, combatId: endsAt ? combat.id : null, createdAt: Date.now() };
    const made = [];
    for (let count = 0; count < Math.max(1, Number(plan.times) || 1); count++) {
        const built = zoneRegion({ name: item.name, zone, token: place, grid: { size: scene.grid.size, distance: scene.grid.distance }, moduleId: MODULE_ID, flags: { ...flags, createdAt: Date.now() }, visibility: CONST.REGION_VISIBILITY?.ALWAYS ?? 2 });
        if (!built) break;
        let region = null;
        if (built.place && canvas.scene?.id === scene.id && canvas.regions?.placeRegion) {
            ui.notifications.info(`${item.name}: place its area${zone.range ? ` (within ${zone.range} feet)` : ""}; the mouse wheel turns it, right-click skips it.`);
            region = await canvas.regions.placeRegion(built.data, { create: true }).catch(() => null);
        } else {
            [region] = await scene.createEmbeddedDocuments("Region", [built.data]);
        }
        if (region) made.push(region);
    }
    const lasts = endsAt ? `until ${endsAt.at === "turn-end" ? "the end" : "the start"} of its turn in round ${endsAt.round}${rolled ? ` (${rolled} rounds rolled)` : ""}` : zone.lasts ? `${rolled ?? zone.lasts.value} ${(rolled ?? zone.lasts.value) === 1 ? zone.lasts.unit.replace(/s$/, "") : zone.lasts.unit} (end it on this card)` : zone.untilReused ? "until it ends it (use End on this card)" : zone.once ? "until a creature sets it off (or use End on this card)" : "until it's cleared (use End on this card)";
    const parts = [
        zone.concealed ? "those inside are Concealed, and those outside concealed to them" : null,
        zone.terrain?.length ? `difficult terrain${zone.others ? ` (not for ${escape(item.actor.name)}: move it normally)` : ""}` : null,
        zone.hazard ? "hazardous terrain (damage on entering)" : null,
        zone.saves?.length ? "a save on whoever it says" : null,
        zone.effect ? `${escape(zone.effect.label)} on ${zone.effect.allies ? "its allies" : "those"} inside` : null,
        modifierWords(zone.modifiers),
        zone.inside?.length ? "its own rules on those inside it names" : null,
        zone.adjustments?.length ? "its allies' and foes' checks changed inside" : null,
        zone.damage?.length ? "damage at a turn's end inside" : null,
        zone.once ? "gone once a creature sets it off" : null
    ].filter(Boolean);
    const placed = made.length ? "" : " <em>Not placed.</em>";
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: item.actor, ...(token ? { token } : {}) }),
        content: `<section class="pf2e-aar-zone"><p><strong>${escape(item.name)}</strong>: ${parts.join("; ")}. Lasts ${escape(lasts)}.${placed}</p>${(zone.notes ?? []).map((note) => `<p>${escape(note)}</p>`).join("")}${made.length ? `<button type="button" data-zone-end><i class="fa-solid fa-xmark"></i> End ${escape(item.name)}</button>` : ""}</section>`,
        flags: { [MODULE_ID]: { zoneCard: { regionUuids: made.map((region) => region.uuid) } } }
    });
}

// A region event of one of the module's zones (from its script behaviour, on the active GM).
export async function zoneEvent(region, behavior, event) {
    const flags = region?.flags?.[MODULE_ID]?.zone;
    const token = event?.data?.token;
    if (!flags || !token?.actor || !isActiveGM() || spent.has(region.uuid)) return;
    const members = inside.get(region.uuid) ?? new Set();
    inside.set(region.uuid, members);
    if (event.name === "tokenEnter") {
        if (members.has(token.uuid)) return;
        members.add(token.uuid);
    }
    if (event.name === "tokenExit") members.delete(token.uuid);
    const own = token.uuid === flags.sourceTokenUuid || token.actor.uuid === flags.sourceActorUuid;
    const initial = event.name === "tokenEnter" && !event.data.movement && Date.now() - (flags.createdAt ?? 0) < 10000;
    // (A zone gone once it acts: claimed before the awaits, so two creatures entering at once don't both set it off.)
    const claims = !!flags.zone.once && !own && ["tokenEnter", "tokenMoveWithin"].includes(event.name);
    if (claims) spent.add(region.uuid);
    const sourceToken = await fromUuid(flags.sourceTokenUuid).catch(() => null);
    const allied = !own && !!sourceToken && token.disposition === sourceToken.disposition;
    const found = await fromUuid(flags.itemUuid).catch(() => null);
    const sourceActor = found?.actor ?? (await fromUuid(flags.sourceActorUuid).catch(() => null));
    const name = flags.itemName ?? found?.name ?? "Zone";
    // (An item used up since, a snare: its name on the cards.)
    const item = found ?? (sourceActor ? { name, uuid: null, actor: sourceActor } : null);
    const target = token.object ?? token;
    // (2026-10-18: its traits, for a save or damage only for some — Sanctified Beans'.)
    const traits = [...(token.actor.traits ?? token.actor.system?.traits?.value ?? [])];
    // (2026-10-26: its size, for one only for Small or larger creatures — the item module's snares.)
    const size = token.actor.size ?? token.actor.system?.traits?.size?.value ?? null;
    const actions = zoneActions(flags.zone, event.name, { own, allied, initial, traits, size });
    const setOff = claims && zoneSetOff(flags.zone, actions);
    if (claims && !setOff) spent.delete(region.uuid);
    for (const action of actions) {
        if (action.kind === "clear") await clearZone(token.actor, region.uuid, flags.zone);
        else if (["conceal", "modifiers", "adjust", "inside"].includes(action.kind)) await token.actor.createEmbeddedDocuments("Item", [zoneMemberEffect({ name, kind: action.kind, modifiers: action.modifiers, adjustments: action.adjustments, rules: action.rules, concealedUuid: CONCEALED, regionUuid: region.uuid, moduleId: MODULE_ID })]);
        else if (action.kind === "effect") {
            const source = await fromUuid(action.uuid).catch(() => null);
            if (!source) continue;
            const data = source.toObject();
            delete data._id;
            await token.actor.createEmbeddedDocuments("Item", [{ ...data, system: { ...data.system, duration: { value: -1, unit: "unlimited", expiry: null, sustained: false } }, flags: { ...(data.flags ?? {}), [MODULE_ID]: { zone: region.uuid } } }]);
        } else if (action.kind === "save" && item && sourceActor) await postCard({ plan: action.plan, item, sourceActor, sourceToken, tokens: [target], warning: `${name}: ${eventWords(event.name, initial)}.` });
        else if ((action.kind === "damage" || action.kind === "hazard") && item && sourceActor) await postCard({ plan: zoneDamagePlan(name, action.formulas), item, sourceActor, sourceToken, tokens: [target], warning: action.kind === "hazard" ? `${name}: on entering it; as much again for each further square it moves into.` : `${name}: ${eventWords(event.name, initial)}.` });
        else if (action.kind === "note") await noteToGM(sourceActor, sourceToken, [`<strong>${escape(name)}</strong> — ${escape(token.name)}: ${escape(action.text)}`]);
        else if (action.kind === "burst" && item && sourceActor) {
            const { tokens, aimless } = burstTokens(region, token, action.burst, event.data.movement);
            // (othersOnly, 2026-10-27, Piercing Whistle Snare: the setter has its own save in zone.saves; nobody else reached, no card.)
            if (action.burst.othersOnly && !aimless && !tokens.length) continue;
            const warning = aimless ? `${name}: set off by ${token.name}, from a way it can't tell; aim its ${action.burst.area.value}-foot ${action.burst.area.type} yourself and use your targets.` : `${name}: set off by ${token.name}; everyone${action.burst.othersOnly ? " else" : ""} ${burstWords(action.burst)}.`;
            await postCard({ plan: action.burst.plan, item, sourceActor, sourceToken, tokens, warning });
        }
    }
    if (setOff) {
        // (2026-10-16: a snare that leaves an area where it was — Smoke Screen Snare's smoke —: that area, at its square, once it's gone.)
        const square = flags.zone.then ? snareSquare(region.shapes?.[0], region.parent?.grid?.size ?? canvas.scene?.grid?.size ?? 100) : null;
        const scene = region.parent;
        await spendZone(region, flags, token.name);
        if (flags.zone.then && square && scene && item) await startZone({ item, plan: { zone: { ...flags.zone.then, centre: "snare" } }, sourceToken, at: { token: square, scene } });
    }
}

// The creatures a snare's burst reaches (zone.burst, 2026-10-27): the one that set it off first (wherever its move ends), then every other
// creature on the scene in the area — measured from the snare's square at that creature's height, or (from "creature", Bomb Snare's "the
// target and all creatures in adjacent squares") from its space where it covers the square; not one behind a wall from it. othersOnly
// (2026-10-27, Piercing Whistle Snare, whose setter has worse results of its own in zone.saves): not the setter.
// An aimed one (a cone or a line back the way it came in, from its move's path): the creatures on the squares it covers, walls between
// them and its point stopping it as PF2e's areas are, within its reach of the setter's height; not the one that set it off (it's "to hit
// any allies behind" it). No way in to tell (a token made there): none, and the card says to aim it. { tokens, aimless }
function burstTokens(region, token, burst, movement) {
    const scene = region.parent;
    const grid = gridOf(scene);
    const square = snareSquare(region.shapes?.[0], grid.size);
    const space = box(token, grid.size);
    const others = (test) => scene.tokens.filter((other) => other.id !== token.id && other.actor?.isOfType?.("creature") && !other.hidden && !(other.actor.isDead ?? false) && test(other));
    if (AIMED.has(burst.area?.type)) {
        const path = movement ? [movement.origin, ...(movement.passed?.waypoints ?? [])] : [];
        const direction = square ? entryDirection(path, { width: Number(token.width) || 1, height: Number(token.height) || 1 }, square, grid.size) : null;
        if (!direction) return { tokens: [], aimless: true };
        const { squares } = coveredSquares(aimedShape(burst, square, direction, grid), grid, { blocked: wallBetween(scene) });
        const covered = new Set(squares.map((corner) => `${corner.x},${corner.y}`));
        const feet = Number(burst.area.value) || 0;
        const hit = others((other) => {
            const at = box(other, grid.size);
            if (Math.abs(at.elevation - space.elevation) > feet) return false;
            for (let x = at.x; x < at.x + at.w; x += grid.size) for (let y = at.y; y < at.y + at.h; y += grid.size) if (covered.has(`${x},${y}`)) return true;
            return false;
        });
        return { tokens: hit.map((entry) => entry.object ?? entry), aimless: false };
    }
    const own = square ? { ...box(square, grid.size), elevation: space.elevation } : space;
    const covers = square && space.x < own.x + own.w && space.x + space.w > own.x && space.y < own.y + own.h && space.y + space.h > own.y;
    const origin = burst.from === "creature" && (covers || !square) ? space : own;
    // (Line of effect: one behind a wall from the area's middle on every square it takes up isn't reached.)
    const blocked = wallBetween(scene);
    const middle = { x: origin.x + origin.w / 2, y: origin.y + origin.h / 2 };
    const seen = (at) => {
        for (let x = at.x; x < at.x + at.w; x += grid.size) for (let y = at.y; y < at.y + at.h; y += grid.size) if (!blocked(middle, { x: x + grid.size / 2, y: y + grid.size / 2 })) return true;
        return false;
    };
    const reached = others((other) => burstReaches(burst, origin, box(other, grid.size), grid, distanceFeet) && seen(box(other, grid.size)));
    return { tokens: [...(burst.othersOnly ? [] : [token]), ...reached].map((entry) => entry.object ?? entry), aimless: false };
}

// A wall that stops movement between two points, as PF2e's areas test it (only on the scene on the canvas; none otherwise).
function wallBetween(scene) {
    const backend = CONFIG.Canvas?.polygonBackends?.move;
    if (canvas?.scene?.id !== scene.id || !backend?.testCollision) return () => false;
    return (origin, point) => {
        try {
            return !!backend.testCollision(origin, point, { type: "move", mode: "any", ...(canvas.level ? { level: canvas.level } : {}) });
        } catch {
            return false;
        }
    };
}

// A zone gone once it acts, set off: what it gave those inside taken away, its Region deleted, and its card saying so.
async function spendZone(region, flags, who) {
    for (const uuid of inside.get(region.uuid) ?? []) {
        const member = await fromUuid(uuid).catch(() => null);
        if (member?.actor) await clearZone(member.actor, region.uuid, flags.zone);
    }
    inside.delete(region.uuid);
    const message = game.messages?.contents?.findLast?.((entry) => entry.getFlag?.(MODULE_ID, "zoneCard")?.regionUuids?.includes(region.uuid)) ?? null;
    await region.delete().catch(() => null);
    if (!message) return;
    const left = message.getFlag(MODULE_ID, "zoneCard").regionUuids.filter((uuid) => uuid !== region.uuid);
    await message.update({ content: spentZoneCard(message.content, { who, left: left.length }), [`flags.${MODULE_ID}.zoneCard.regionUuids`]: left });
}

const eventWords = (name, initial) => (initial ? "in the area as it's made" : name === "tokenEnter" ? "entering it" : name === "tokenTurnStart" ? "starting its turn in it" : name === "tokenMoveWithin" ? "moving within it" : "ending its turn in it");

// Leaving (or the zone ending): what the zone gave the creature, and PF2e's effects of the zone's own on it (its "while inside" ones).
async function clearZone(actor, regionUuid, zone) {
    // (Not a save's effects from a zone gone once it acts: a snare's last their own time.)
    const sources = new Set([zone.effect?.uuid, ...(zone.once ? [] : zone.saves ?? []).flatMap((save) => ["failure", "criticalFailure"].flatMap((degree) => (save.plan?.resolution?.outcomes?.[degree]?.nativeEffects ?? []).map((entry) => entry.uuid)))].filter(Boolean));
    const gone = (actor.itemTypes?.effect ?? []).filter((effect) => effect.flags?.[MODULE_ID]?.zone === regionUuid || sources.has(effect._stats?.compendiumSource ?? effect.flags?.core?.sourceId)).map((effect) => effect.id);
    if (gone.length) await actor.deleteEmbeddedDocuments("Item", gone);
}
