// Live play: recharging abilities (docs/live-play.md).
//
// - Apply on a card for an ability that recharges ("can't use it again for
//   1d4 rounds") rolls the recharge and puts a "Recharging: …" effect on the
//   monster, ending at the start of its turn that many rounds later. An
//   ability with no card starts its recharge when used from the sheet.
// - Using it again while it recharges still brings its card, with a warning.
// - Draconic Momentum: a critical hit with a Strike ends the recharge of the
//   abilities it names (active GM).

import { readRecharge } from "../src/compiler/inline.js";
import { momentumRecharges, rechargeEffect, rechargeKey, rechargeLine, warningLine } from "../src/live/recharge.js";
import { isActiveGM } from "./live.js";

const MODULE_ID = "pf2e-automatic-ability-resolution";

let compile = () => null;

export function setUpRecharge({ compileItem }) {
    compile = compileItem;
    Hooks.on("createChatMessage", (message) => {
        if (isActiveGM()) momentum(message).catch((error) => console.error(`${MODULE_ID} | Draconic Momentum`, error));
    });
}

// An ability's recharge formula ("1d4"), from its plan or its text; null when it has none.
export const rechargeFormula = (item, plan = compile(item)) => plan?.trigger?.recharge?.formula ?? readRecharge(item?.system?.description?.value ?? "") ?? null;

const recharging = (actor, name) => (actor?.itemTypes?.effect ?? []).filter((effect) => effect.flags?.[MODULE_ID]?.recharging?.key === rechargeKey(name));

// The card's warning while the ability still recharges, or null.
export function rechargeWarning(actor, name) {
    const effect = recharging(actor, name).find((entry) => !entry.isExpired);
    if (!effect) return null;
    const seconds = effect.remainingDuration?.remaining;
    return warningLine(name, Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds / 6)) : null);
}

// Rolls the recharge and starts it, replacing one still running. Returns the card's line.
export async function startRecharge({ actor, item, formula, tokenUuid = null }) {
    const roll = await new Roll(formula).evaluate();
    const rounds = Math.max(1, roll.total);
    const old = recharging(actor, item.name);
    if (old.length) await actor.deleteEmbeddedDocuments("Item", old.map((effect) => effect.id));
    // Counted on the monster's own turns, whoever's turn the GM applies it on.
    const combatant = game.combat?.started ? game.combat.combatants.find((entry) => (tokenUuid && entry.token?.uuid === tokenUuid) || entry.actor?.uuid === actor.uuid) : null;
    await actor.createEmbeddedDocuments("Item", [rechargeEffect(MODULE_ID, { ability: { name: item.name, img: item.img }, rounds, formula, time: { worldTime: game.time.worldTime, initiative: combatant?.initiative ?? null } })]);
    return rechargeLine(item.name, rounds, formula);
}

// A GM-only note, for an ability with no card.
export const noteToGM = (actor, token, lines) => ChatMessage.create({ content: lines.map((line) => `<p>${line}</p>`).join(""), speaker: ChatMessage.getSpeaker({ actor, token: token ?? undefined }), whisper: ChatMessage.getWhisperRecipients("GM").map((user) => user.id) });

// Draconic Momentum: "recharges their Poison Breath whenever they score a critical hit with a Strike."
async function momentum(message) {
    const context = message.flags?.pf2e?.context;
    if (context?.type !== "attack-roll" || context.outcome !== "criticalSuccess") return;
    const actor = message.actor;
    if (actor?.type !== "npc" || !["melee", "weapon"].includes(message.item?.type)) return;
    const effects = actor.itemTypes.effect.filter((effect) => effect.flags?.[MODULE_ID]?.recharging);
    if (!effects.length) return;
    for (const item of actor.itemTypes.action) {
        const plan = compile(item);
        if (plan?.builtin !== "momentum") continue;
        const ended = new Set(momentumRecharges(effects.map((effect) => effect.flags[MODULE_ID].recharging), plan.recharges));
        const gone = effects.filter((effect) => ended.has(effect.flags[MODULE_ID].recharging));
        if (!gone.length) continue;
        await actor.deleteEmbeddedDocuments("Item", gone.map((effect) => effect.id));
        await noteToGM(actor, message.token, [`<strong>${item.name}</strong>: the critical hit recharges ${gone.map((effect) => effect.flags[MODULE_ID].recharging.ability).join(" and ")}.`]);
    }
}
