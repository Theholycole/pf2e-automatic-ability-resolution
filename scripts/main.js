// PF2e Automatic Ability Resolution: registers the ability compiler with the
// resolution core and offers the compiled basic actions (Demoralize, Trip,
// Grapple, Shove, Escape) to the core's users, such as the Combat Simulator.
// Live play: confirmation cards (scripts/live.js) and aura triggers (scripts/auras.js).

import { BASIC_ACTIONS, compileAbility, compileBasicActions } from "../src/compiler/index.js";
import { setUpLivePlay } from "./live.js";
import { setUpAuras } from "./auras.js";
import { setUpSwallow } from "./swallow.js";
import { setUpRecharge } from "./recharge.js";
import { setUpReactions } from "./reactions.js";

const MODULE_ID = "pf2e-automatic-ability-resolution";

let basicActions = {};
let resolveLoaded;
const loaded = new Promise((resolve) => (resolveLoaded = resolve));

// PF2e's own basic actions, from its actions pack, once the world is ready.
async function loadBasicActions() {
    try {
        // PF2e's actions pack: its folder is "actions", its id "pf2e.actionspf2e".
        const pack = game.packs.get("pf2e.actionspf2e") ?? game.packs.get("pf2e.actions");
        const index = await pack.getIndex({ fields: ["system.slug"] });
        const items = [];
        for (const entry of index) if (BASIC_ACTIONS.includes(entry.system?.slug)) items.push(await pack.getDocument(entry._id));
        basicActions = compileBasicActions(items);
    } catch (error) {
        console.warn(`${MODULE_ID} | The basic actions couldn't be compiled.`, error);
    }
    resolveLoaded();
}

// Registered when the script loads, so the order modules load in doesn't matter.
Hooks.once("pf2eResolutionCoreReady", (core) => {
    core.registry.registerCompiler({
        module: MODULE_ID,
        name: "abilities",
        // Monster and hazard abilities, and a PC's feat actions that are a check or a save against a
        // creature (Bon Mot, Dirty Trick: the simulator's C15). Not impulses: the Kineticist module's.
        handles: (item) => {
            if (["npc", "hazard"].includes(item?.actor?.type)) return item.type === "action";
            return item?.actor?.type === "character" && ["action", "feat"].includes(item.type) && item.system?.actionType?.value === "action"
                && !(item.system?.traits?.value ?? []).includes("impulse") && /@Check\[|check against/i.test(item.system?.description?.value ?? "");
        },
        // Waits for the basic actions, which the riders (Grab, Knockdown, Push) are built on.
        compile: async (item) => {
            await loaded;
            return compileAbility(item, { basicActions });
        }
    });
});

// Live play: the confirmation cards (scripts/live.js), the monsters' auras
// (scripts/auras.js) and Swallow Whole over the turns (scripts/swallow.js).
Hooks.once("ready", () => {
    const compileItem = (item) => compileAbility(item, { basicActions });
    setUpLivePlay({ compileItem, basicActions: () => basicActions, loaded });
    setUpAuras({ compileItem, loaded });
    setUpSwallow();
    setUpRecharge({ compileItem });
    setUpReactions({ compileItem });
});

Hooks.once("ready", async () => {
    await loadBasicActions();
    const module = game.modules.get(MODULE_ID);
    if (module) module.api = Object.freeze({ get basicActions() { return basicActions; }, compileAbility: (item) => compileAbility(item, { basicActions }) });
});
