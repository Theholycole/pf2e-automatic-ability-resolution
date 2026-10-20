// Live play: an early end on Escaping (src/live/escape.js). On the active GM's client, a creature's successful Escape check ends the module's
// Effects whose Escape DC it beat (a snare's Speed penalty, an ammunition's slowed), with a line in the chat; and a misfortune for one roll goes
// after that roll, when PF2e's own "remove expired effects" setting doesn't remove it.

import { escapedItems, spentOnce } from "../src/live/escape.js";

const MODULE_ID = "pf2e-automatic-ability-resolution";
const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

export function setUpEscapes() {
    Hooks.on("createChatMessage", (message) => {
        if (game.users.activeGM?.id !== game.user.id) return;
        endEscaped(message).catch((error) => console.error(`${MODULE_ID} | ending on an Escape`, error));
    });
}

async function endEscaped(message) {
    const context = message.flags?.pf2e?.context;
    const actor = message.actor ?? (message.speaker?.actor ? game.actors.get(message.speaker.actor) : null);
    if (!context || !actor) return;
    const roll = message.rolls?.[0];
    const items = [...actor.items];
    const escaped = escapedItems(items, context, roll?.total ?? null, MODULE_ID);
    const kept = (roll?.dice ?? []).some((die) => (die.modifiers ?? []).some((modifier) => /^k[hl]/i.test(String(modifier))));
    // (PF2e removes a RollTwice Effect after its roll itself when its setting is on.)
    const spent = game.pf2e?.settings?.automation?.removeEffects ? [] : spentOnce(items, context, kept, MODULE_ID).filter((id) => !escaped.includes(id));
    const ids = [...escaped, ...spent].filter((id) => actor.items.has(id));
    if (!ids.length) return;
    const names = escaped.map((id) => actor.items.get(id)?.name).filter(Boolean);
    await actor.deleteEmbeddedDocuments("Item", ids);
    if (names.length) await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor, token: message.token ?? undefined }), content: `<p><strong>${escapeHTML(actor.name)}</strong> escapes: ${names.map(escapeHTML).join(", ")} ${names.length === 1 ? "ends" : "end"}.</p>` });
}
