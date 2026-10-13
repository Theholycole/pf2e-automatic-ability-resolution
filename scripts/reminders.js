// Reminders for the reactions the module can't watch (2026-10-13, batch 296; the user's call: "does the module give a reminder for when the
// reaction could be used? If not it should"). The module offers a reaction itself when it sees its trigger happen (scripts/reactions.js);
// for the others — a trigger it can't see, such as someone saying its name — a GM-only card at the start of each turn
// (or each round, by the world setting) lists the monsters' reactions still open to them, each with its trigger and a Use button. Only the
// newest card stays.

import { reminderFor, reminderHTML } from "../src/live/reactions.js";
import { htmlToPlainText } from "../../pf2e-resolution-core/src/text/plain-text.js";
import { isActiveGM } from "./live.js";
import { markUsed, reactionAvailable, reactionsLeft } from "./reactions.js";

const MODULE_ID = "pf2e-automatic-ability-resolution";
const SETTING = "reactionReminders";
let compile = () => null;
let queue = Promise.resolve();

export function registerReminderSetting() {
    game.settings.register(MODULE_ID, SETTING, {
        name: "Reaction reminders",
        hint: "A GM-only card listing the monsters' reactions whose triggers the module can't see (the ones it can see, it offers as they happen).",
        scope: "world",
        config: true,
        type: String,
        choices: { turn: "At the start of each turn", round: "At the start of each round", off: "Off" },
        default: "turn"
    });
}

export function setUpReminders({ compileItem }) {
    compile = compileItem;
    Hooks.on("pf2e.startTurn", (combatant) => {
        if (!isActiveGM()) return;
        // (One at a time: two turn starts at once, as when a defeated one is skipped, would each miss the other's card.)
        queue = queue.then(() => remind(combatant)).catch((error) => console.error(`${MODULE_ID} | reaction reminders`, error));
    });
    Hooks.on("renderChatMessageHTML", (message, html) => {
        const card = message.getFlag?.(MODULE_ID, "reminderCard");
        if (!card) return;
        for (const button of html.querySelectorAll?.("button[data-aar-remind]") ?? []) {
            if (!game.user.isGM) {
                button.remove();
                continue;
            }
            button.addEventListener("click", async (event) => {
                event.preventDefault();
                button.disabled = true;
                await useReminded(message, button.dataset.aarRemind).catch((error) => ui.notifications.error(`${MODULE_ID}: ${error.message}`));
            });
        }
    });
}

const mode = () => {
    try {
        return game.settings.get(MODULE_ID, SETTING);
    } catch {
        return "turn";
    }
};

// The monsters in the encounter that can still react, and their reactions the module doesn't watch.
function reminders(combat) {
    const groups = [];
    for (const combatant of combat.combatants) {
        const token = combatant.token;
        const actor = token?.actor;
        if (!actor || !["npc", "hazard"].includes(actor.type) || combatant.defeated || combatant.hidden || token.hidden || actor.isDead || (actor.hitPoints?.value ?? 1) <= 0) continue;
        // (Batch 301: by name — an Extra Reaction's for one thing only.)
        const open = (item) => reactionAvailable(actor, item.name);
        const entries = [];
        for (const item of actor.itemTypes?.action ?? []) {
            const type = item.system?.actionType?.value;
            if (!["reaction", "free"].includes(type)) continue;
            // (A spent reaction waits for its turn; a free action doesn't.)
            if (type === "reaction" && !open(item)) continue;
            let plan = null;
            try {
                plan = compile(item);
            } catch {
                plan = null;
            }
            const text = htmlToPlainText(String(item.system?.description?.value ?? "").replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, "$1")).replace(/\s+/g, " ").trim();
            const reminder = reminderFor({ type, plan, text });
            if (!reminder) continue;
            entries.push({ ability: item.name, trigger: reminder.trigger, free: type === "free", used: false, key: `${token.uuid}|${item.id}` });
        }
        // (Batch 302: a creature with more than one a round — how many it has left.)
        const { total, left } = reactionsLeft(actor);
        if (entries.length) groups.push({ creature: token.name, entries, ...(total > 1 ? { reactions: { total, left } } : {}) });
    }
    return groups;
}

async function remind(combatant) {
    const combat = combatant?.parent ?? game.combat;
    const setting = mode();
    if (!combat || setting === "off" || (setting === "round" && combat.turn !== 0)) return;
    const groups = reminders(combat);
    // (The cards before it go: found by their combat, so a reload doesn't leave them behind.)
    const earlier = game.messages.contents.filter((message) => message.flags?.[MODULE_ID]?.reminderCard?.combatId === combat.id);
    for (const message of earlier) await message.delete().catch(() => {});
    if (!groups.length) return;
    await ChatMessage.create({
        content: reminderHTML(groups),
        whisper: ChatMessage.getWhisperRecipients("GM").map((user) => user.id),
        speaker: { alias: "Reaction reminders" },
        flags: { [MODULE_ID]: { reminderCard: { combatId: combat.id, groups } } }
    });
}

// Use: the ability posted as from its sheet (the module plays it), its reaction marked spent, and the card says so.
async function useReminded(message, key) {
    const [tokenUuid, itemId] = String(key).split("|");
    const token = await fromUuid(tokenUuid);
    const item = token?.actor?.items?.get(itemId);
    if (!item) throw new Error("That reaction isn't there any more.");
    await item.toMessage(undefined, { speaker: ChatMessage.getSpeaker({ token }) });
    if (item.system?.actionType?.value === "reaction") await markUsed(token.actor, token, item.name);
    const card = message.getFlag(MODULE_ID, "reminderCard");
    // (Batch 302: its count of reactions left, after this one.)
    const groups = (card?.groups ?? []).map((group) => ({ ...group, entries: group.entries.map((entry) => (entry.key === key ? { ...entry, used: true } : entry)), ...(group.reactions && group.entries.some((entry) => entry.key === key) ? { reactions: reactionsLeft(token.actor) } : {}) }));
    await message.update({ content: reminderHTML(groups), [`flags.${MODULE_ID}.reminderCard`]: { ...card, groups } });
}
