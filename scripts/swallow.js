// Live play: Swallow Whole and Engulf over the turns (docs/live-play.md).
//
// - Apply on a Swallow Whole or Engulf card gives the swallowed creature a
//   "Swallowed by …" effect: grabbed and slowed 1 (granted, so they go with
//   it), the monster off-guard to its attacks, and the jaws' earlier grab ended.
// - At the end of each of its turns (PF2e's pf2e.endTurn, active GM), the
//   listed damage is rolled as a PF2e damage roll with an "Apply to …" button
//   for the GM, as everything in live play waits for the GM. Not once the monster is dead.
// - Rupture: when the monster takes piercing or slashing damage of at least
//   the Rupture value from one attack or spell (the core's applyDamage
//   listener), a card offers "Cut free" for each creature it holds.
// - Escaping ends the grabbed condition, and the effect goes with it.

import { cuttingDamage, damageRollFormula, ruptures, swallowedEffect } from "../src/live/swallow.js";
import { isActiveGM } from "./live.js";

const MODULE_ID = "pf2e-automatic-ability-resolution";
const CORE_ID = "pf2e-resolution-core";
const FLAG = "swallow";

const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const damageRollClass = () => (CONFIG.Dice?.rolls ?? []).find((roll) => roll?.name === "DamageRoll");
const conditionUuid = (slug) => {
    const condition = game.pf2e.ConditionManager.getCondition(slug);
    return condition?._stats?.compendiumSource ?? condition?.sourceId ?? condition?.uuid ?? null;
};

export function setUpSwallow() {
    Hooks.on("pf2e.endTurn", (combatant) => {
        if (isActiveGM()) turnDamage(combatant).catch((error) => console.error(`${MODULE_ID} | swallowed damage`, error));
    });
    Hooks.on("renderChatMessageHTML", (message, html) => wire(message, html));
    for (const element of document.querySelectorAll("[data-message-id]")) {
        const message = game.messages.get(element.dataset.messageId);
        if (message?.flags?.[MODULE_ID]?.[FLAG]) wire(message, element);
    }
    const damage = game.modules.get(CORE_ID)?.api?.patches?.damage;
    if (damage?.onApply) damage.onApply({ module: MODULE_ID, name: "swallow-rupture", before: ruptureCheck });
    else console.warn(`${MODULE_ID} | The resolution core's damage listener isn't there: Rupture won't be noticed.`);
}

// --- Swallowing ---------------------------------------------------------------

// Apply's part for a swallow change: the effect, and the jaws let go of their grab.
export async function applySwallow(state, actor, swallow) {
    const held = actor.itemTypes.condition.filter((condition) => ["grabbed", "restrained"].includes(condition.slug));
    if (held.length) await actor.deleteEmbeddedDocuments("Item", held.map((condition) => condition.id)).catch(() => null);
    const item = state.ability.uuid ? await fromUuid(state.ability.uuid).catch(() => null) : null;
    const tokenId = state.source.tokenUuid?.split(".").at(-1) ?? "monster";
    const data = swallowedEffect(MODULE_ID, {
        swallow,
        source: state.source,
        ability: { name: state.ability.name, img: item?.img },
        templates: { grabbed: conditionUuid("grabbed"), slowed: conditionUuid("slowed"), offGuard: conditionUuid("off-guard") },
        slug: `aar-swallow-${tokenId}`.toLowerCase(),
        time: { worldTime: game.time.worldTime, initiative: game.combat?.started ? game.combat.combatant?.initiative ?? null : null }
    });
    await actor.createEmbeddedDocuments("Item", [data]);
    return null;
}

// The creatures a monster holds swallowed: [{ token, actor, effect, flag }].
function swallowedBy(monster) {
    const found = [];
    const scenes = new Set(monster.getActiveTokens(false, true).map((token) => token.parent).filter(Boolean));
    for (const scene of scenes) {
        for (const token of scene.tokens) {
            for (const effect of token.actor?.itemTypes?.effect ?? []) {
                const flag = effect.flags?.[MODULE_ID]?.swallowed;
                if (flag?.byActor === monster.uuid) found.push({ token, actor: token.actor, effect, flag });
            }
        }
    }
    return found;
}

// --- At the end of its turns ------------------------------------------------------

async function turnDamage(combatant) {
    const actor = combatant.actor;
    if (!actor || actor.isDead) return;
    const token = combatant.token;
    for (const effect of actor.itemTypes.effect) {
        const swallowed = effect.flags?.[MODULE_ID]?.swallowed;
        if (!swallowed?.damage) continue;
        const holder = swallowed.byToken ? fromUuidSync(swallowed.byToken) : null;
        const monster = holder?.actor ?? (swallowed.byActor ? fromUuidSync(swallowed.byActor) : null);
        // A dead monster no longer harms it (creatures next to it cut it open).
        if (!monster || monster.isDead) continue;
        const DamageRoll = damageRollClass();
        const roll = await new DamageRoll(damageRollFormula(swallowed.damage)).evaluate();
        const name = token?.name ?? actor.name;
        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor: monster, token: holder ?? undefined }),
            flavor: `<strong>${escapeHTML(swallowed.ability)}</strong>: ${escapeHTML(name)} is swallowed, at the end of its turn`,
            flags: { [MODULE_ID]: { [FLAG]: { kind: "damage", tokenUuid: token?.uuid ?? null, actorUuid: actor.uuid, name, status: "open" } } }
        });
    }
}

// --- Rupture ----------------------------------------------------------------------

// The core's applyDamage listener: the monster takes enough piercing or slashing damage at once.
function ruptureCheck(monster, params) {
    const roll = params?.damage;
    if (!roll || typeof roll !== "object" || !Array.isArray(roll.instances)) return null;
    const held = swallowedBy(monster);
    if (!held.length) return null;
    const instances = roll.instances.map((instance) => ({ type: instance.type, total: instance.total, persistent: !!instance.persistent }));
    const freed = held.filter((entry) => ruptures(instances, Number(entry.flag.rupture)));
    if (!freed.length) return null;
    return () => postRupture(monster, freed, cuttingDamage(instances));
}

async function postRupture(monster, freed, amount) {
    const holder = monster.getActiveTokens(false, true)[0] ?? null;
    const state = { kind: "rupture", by: holder?.name ?? monster.name, amount, rupture: freed[0].flag.rupture, creatures: freed.map((entry) => ({ tokenUuid: entry.token.uuid, actorUuid: entry.actor.uuid, effectId: entry.effect.id, name: entry.token.name, freed: false })) };
    await ChatMessage.create({ content: ruptureHTML(state), speaker: ChatMessage.getSpeaker({ actor: monster, token: holder ?? undefined }), flags: { [MODULE_ID]: { [FLAG]: state } } });
}

function ruptureHTML(state) {
    const rows = state.creatures.map((creature, index) => `<li>${escapeHTML(creature.name)} ${creature.freed ? "cut itself free" : `<button type="button" data-aar-swallow="free" data-index="${index}">Cut free</button>`}</li>`).join("");
    return `<section class="pf2e-aar-card"><header><strong>Rupture</strong><span class="aar-check">${escapeHTML(state.by)} took ${state.amount} piercing or slashing damage at once (Rupture ${state.rupture})</span></header><ul class="aar-targets">${rows}</ul></section>`;
}

// --- Buttons ----------------------------------------------------------------------

function wire(message, html) {
    const state = message.flags?.[MODULE_ID]?.[FLAG];
    if (!state) return;
    if (state.kind === "damage") {
        const content = html.querySelector(".message-content") ?? html;
        if (content.querySelector(".pf2e-aar-swallow")) return;
        const footer = document.createElement("div");
        footer.className = "pf2e-aar-swallow";
        if (state.status === "applied") footer.textContent = `Applied to ${state.name}.`;
        else if (game.user.isGM) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = `Apply to ${state.name}`;
            button.addEventListener("click", () => press(button, () => applyTurnDamage(message)));
            footer.append(button);
        }
        content.append(footer);
        return;
    }
    for (const button of html.querySelectorAll("[data-aar-swallow=\"free\"]")) {
        if (button.dataset.aarWired) continue;
        button.dataset.aarWired = "true";
        if (!game.user.isGM) {
            button.remove();
            continue;
        }
        button.addEventListener("click", () => press(button, () => cutFree(message, Number(button.dataset.index))));
    }
}

async function press(button, task) {
    button.disabled = true;
    try {
        await task();
    } catch (error) {
        ui.notifications.error(`Swallow Whole: ${error.message}`);
        console.error(`${MODULE_ID} |`, error);
        button.disabled = false;
    }
}

async function applyTurnDamage(message) {
    const state = message.flags[MODULE_ID][FLAG];
    if (state.status !== "open") return;
    const token = state.tokenUuid ? await fromUuid(state.tokenUuid) : null;
    const actor = token?.actor ?? (await fromUuid(state.actorUuid));
    if (!actor) throw new Error(`${state.name} isn't there any more.`);
    await actor.applyDamage({ damage: message.rolls[0], token: token ?? undefined });
    await message.update({ [`flags.${MODULE_ID}.${FLAG}.status`]: "applied" });
}

async function cutFree(message, index) {
    const state = foundry.utils.deepClone(message.flags[MODULE_ID][FLAG]);
    const creature = state.creatures[index];
    if (!creature || creature.freed) return;
    const token = creature.tokenUuid ? await fromUuid(creature.tokenUuid) : null;
    const actor = token?.actor ?? (await fromUuid(creature.actorUuid));
    const effect = actor?.items.get(creature.effectId);
    if (effect) await effect.delete();
    creature.freed = true;
    await message.update({ content: ruptureHTML(state), [`flags.${MODULE_ID}.${FLAG}`]: state });
}
