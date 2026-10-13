// Bravery live (2026-10-13, batch 302; the user's call: "Have Bravery apply as intended even if it changes how morale works on that
// creature"): "any time it gains the Frightened condition, reduce its value by 1". PF2e's rules give Bravery only its better Will save, so
// here any frightened the creature gains comes that much lower, whoever adds it — a spell, Demoralize, the Combat Simulator's morale card,
// the GM — and one that would come to 0 isn't added. The GM gets a note each time.

import { noteToGM } from "./recharge.js";

let compile = () => null;

// How much lower: its passives' (passive-rules' lessFrightened) — a monster's actions, a PC's feats.
function lessFrightened(actor) {
    let less = 0;
    for (const item of [...(actor?.itemTypes?.action ?? []), ...(actor?.itemTypes?.feat ?? [])]) {
        if (item.system?.actionType?.value !== "passive" || !/frightened/i.test(item.system?.description?.value ?? "")) continue;
        const plan = compile(item);
        if (plan?.builtin === "passive-rules" && plan.lessFrightened) less = Math.max(less, plan.lessFrightened);
    }
    return less;
}

const tell = (actor, gained, now) => noteToGM(actor, null, [`<strong>Bravery</strong>: ${actor.name} gains frightened ${gained}, ${now > 0 ? `lowered to ${now}` : "lowered to none"}.`]).catch(() => null);

export function setUpBravery({ compileItem }) {
    compile = compileItem;
    // (On whichever client adds it: a pre-hook runs where the change starts.)
    Hooks.on("preCreateItem", (item) => {
        if (item.type !== "condition" || item.slug !== "frightened" || !item.actor) return;
        const less = lessFrightened(item.actor);
        if (!less) return;
        const value = Number(item.system?.value?.value) || 1;
        tell(item.actor, value, value - less);
        if (value - less <= 0) return false;
        item.updateSource({ "system.value.value": value - less });
    });
    Hooks.on("preUpdateItem", (item, changes) => {
        if (item.type !== "condition" || item.slug !== "frightened" || !item.actor) return;
        const next = Number(foundry.utils.getProperty(changes, "system.value.value"));
        const before = Number(item.system?.value?.value) || 0;
        if (!Number.isFinite(next) || next <= before) return;
        const less = lessFrightened(item.actor);
        if (!less) return;
        const after = Math.max(before, next - less);
        tell(item.actor, next, after);
        if (after === before) return false;
        foundry.utils.setProperty(changes, "system.value.value", after);
    });
}
