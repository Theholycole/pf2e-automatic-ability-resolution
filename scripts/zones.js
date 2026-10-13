// Live play: zones (2026-10-12, batch 256; docs/live-play.md). An ability's area that lasts becomes a Region on the scene: PF2e's
// difficult terrain on it, and a script behaviour that hands the module its events (on the active GM). A token entering gets the zone's
// concealment, PF2e's effect or penalties inside, and the save, hazard or damage that entering brings; leaving takes away what it gave;
// a turn starting or ending inside brings its saves and damage. The zone ends with its time (at its maker's turn), or by its card's
// button. Its maker isn't harmed by its own zone.

import { zoneActions, zoneDamagePlan, zoneEndsAt, zoneMemberEffect, zoneOver, zoneRegion } from "../src/live/zones.js";
import { isActiveGM, postCard } from "./live.js";
import { noteToGM } from "./recharge.js";

const MODULE_ID = "pf2e-automatic-ability-resolution";
const CONCEALED = "Compendium.pf2e.conditionitems.Item.DmAIPqOBomZ7H95W";
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

// Who is inside each zone, on this (the GM's) client: region uuid → token uuids. (Its entering events may come twice as it's made.)
const inside = new Map();

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

// The ability's zone: its Region (placed by the GM when it's at range, a cone or a line), its time, and its card.
export async function startZone({ item, plan, sourceToken }) {
    const zone = plan.zone;
    const token = sourceToken?.document ?? sourceToken;
    const scene = token?.parent ?? canvas.scene;
    if (!token || !scene) {
        await noteToGM(item.actor, sourceToken, [`<strong>${escape(item.name)}</strong>: its area needs the creature's token on the scene.`]);
        return;
    }
    const rolled = zone.lasts?.valueRoll ? (await new Roll(zone.lasts.valueRoll).evaluate()).total : null;
    const combat = game.combats?.find?.((entry) => entry.started && (entry.scene?.id ?? canvas.scene?.id) === scene.id) ?? null;
    const combatant = combat?.combatants?.find?.((entry) => entry.tokenId === token.id) ?? null;
    const acted = !combatant || combat.combatant?.id === combatant.id || combat.turns.indexOf(combatant) < combat.turn;
    const endsAt = combatant ? zoneEndsAt(zone.lasts, { round: combat.round, combatantId: combatant.id, rolled, acted }) : null;
    const flags = { zone, itemUuid: item.uuid, itemName: item.name, sourceActorUuid: item.actor.uuid, sourceTokenUuid: token.uuid, endsAt, combatId: endsAt ? combat.id : null, createdAt: Date.now() };
    const made = [];
    for (let count = 0; count < Math.max(1, Number(plan.times) || 1); count++) {
        const built = zoneRegion({ name: item.name, zone, token: { id: token.id, x: token.x, y: token.y, width: token.width, height: token.height, shape: token.shape }, grid: { size: scene.grid.size, distance: scene.grid.distance }, moduleId: MODULE_ID, flags: { ...flags, createdAt: Date.now() }, visibility: CONST.REGION_VISIBILITY?.ALWAYS ?? 2 });
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
    const lasts = endsAt ? `until ${endsAt.at === "turn-end" ? "the end" : "the start"} of its turn in round ${endsAt.round}${rolled ? ` (${rolled} rounds rolled)` : ""}` : zone.lasts ? `${rolled ?? zone.lasts.value} ${(rolled ?? zone.lasts.value) === 1 ? zone.lasts.unit.replace(/s$/, "") : zone.lasts.unit} (end it on this card)` : zone.untilReused ? "until it ends it (use End on this card)" : "until it's cleared (use End on this card)";
    const parts = [
        zone.concealed ? "those inside are Concealed, and those outside concealed to them" : null,
        zone.terrain?.length ? `difficult terrain${zone.others ? ` (not for ${escape(item.actor.name)}: move it normally)` : ""}` : null,
        zone.hazard ? "hazardous terrain (damage on entering)" : null,
        zone.saves?.length ? "a save on whoever it says" : null,
        zone.effect ? `${escape(zone.effect.label)} on ${zone.effect.allies ? "its allies" : "those"} inside` : null,
        zone.modifiers?.length ? "a penalty inside" : null,
        zone.adjustments?.length ? "its allies' and foes' checks changed inside" : null,
        zone.damage?.length ? "damage at a turn's end inside" : null
    ].filter(Boolean);
    const placed = made.length ? "" : " <em>Not placed.</em>";
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: item.actor, token }),
        content: `<section class="pf2e-aar-zone"><p><strong>${escape(item.name)}</strong>: ${parts.join("; ")}. Lasts ${escape(lasts)}.${placed}</p>${(zone.notes ?? []).map((note) => `<p>${escape(note)}</p>`).join("")}${made.length ? `<button type="button" data-zone-end><i class="fa-solid fa-xmark"></i> End ${escape(item.name)}</button>` : ""}</section>`,
        flags: { [MODULE_ID]: { zoneCard: { regionUuids: made.map((region) => region.uuid) } } }
    });
}

// A region event of one of the module's zones (from its script behaviour, on the active GM).
export async function zoneEvent(region, behavior, event) {
    const flags = region?.flags?.[MODULE_ID]?.zone;
    const token = event?.data?.token;
    if (!flags || !token?.actor || !isActiveGM()) return;
    const members = inside.get(region.uuid) ?? new Set();
    inside.set(region.uuid, members);
    if (event.name === "tokenEnter") {
        if (members.has(token.uuid)) return;
        members.add(token.uuid);
    }
    if (event.name === "tokenExit") members.delete(token.uuid);
    const sourceToken = await fromUuid(flags.sourceTokenUuid).catch(() => null);
    const own = token.uuid === flags.sourceTokenUuid || token.actor.uuid === flags.sourceActorUuid;
    const allied = !own && !!sourceToken && token.disposition === sourceToken.disposition;
    const initial = event.name === "tokenEnter" && !event.data.movement && Date.now() - (flags.createdAt ?? 0) < 10000;
    const item = await fromUuid(flags.itemUuid).catch(() => null);
    const sourceActor = item?.actor ?? (await fromUuid(flags.sourceActorUuid).catch(() => null));
    const name = flags.itemName ?? item?.name ?? "Zone";
    const target = token.object ?? token;
    for (const action of zoneActions(flags.zone, event.name, { own, allied, initial })) {
        if (action.kind === "clear") await clearZone(token.actor, region.uuid, flags.zone);
        else if (action.kind === "conceal" || action.kind === "modifiers" || action.kind === "adjust") await token.actor.createEmbeddedDocuments("Item", [zoneMemberEffect({ name, kind: action.kind, modifiers: action.modifiers, adjustments: action.adjustments, concealedUuid: CONCEALED, regionUuid: region.uuid, moduleId: MODULE_ID })]);
        else if (action.kind === "effect") {
            const source = await fromUuid(action.uuid).catch(() => null);
            if (!source) continue;
            const data = source.toObject();
            delete data._id;
            await token.actor.createEmbeddedDocuments("Item", [{ ...data, system: { ...data.system, duration: { value: -1, unit: "unlimited", expiry: null, sustained: false } }, flags: { ...(data.flags ?? {}), [MODULE_ID]: { zone: region.uuid } } }]);
        } else if (action.kind === "save" && item && sourceActor) await postCard({ plan: action.plan, item, sourceActor, sourceToken, tokens: [target], warning: `${name}: ${eventWords(event.name, initial)}.` });
        else if ((action.kind === "damage" || action.kind === "hazard") && item && sourceActor) await postCard({ plan: zoneDamagePlan(name, action.formulas), item, sourceActor, sourceToken, tokens: [target], warning: action.kind === "hazard" ? `${name}: on entering it; as much again for each further square it moves into.` : `${name}: ${eventWords(event.name, initial)}.` });
        else if (action.kind === "note") await noteToGM(sourceActor, sourceToken, [`<strong>${escape(name)}</strong> — ${escape(token.name)}: ${escape(action.text)}`]);
    }
}

const eventWords = (name, initial) => (initial ? "in the area as it's made" : name === "tokenEnter" ? "entering it" : name === "tokenTurnStart" ? "starting its turn in it" : name === "tokenMoveWithin" ? "moving within it" : "ending its turn in it");

// Leaving (or the zone ending): what the zone gave the creature, and PF2e's effects of the zone's own on it (its "while inside" ones).
async function clearZone(actor, regionUuid, zone) {
    const sources = new Set([zone.effect?.uuid, ...(zone.saves ?? []).flatMap((save) => ["failure", "criticalFailure"].flatMap((degree) => (save.plan?.resolution?.outcomes?.[degree]?.nativeEffects ?? []).map((entry) => entry.uuid)))].filter(Boolean));
    const gone = (actor.itemTypes?.effect ?? []).filter((effect) => effect.flags?.[MODULE_ID]?.zone === regionUuid || sources.has(effect._stats?.compendiumSource ?? effect.flags?.core?.sourceId)).map((effect) => effect.id);
    if (gone.length) await actor.deleteEmbeddedDocuments("Item", gone);
}
