// PF2e Automatic Ability Resolution: registers the ability compiler with the
// resolution core and offers the compiled basic actions (Demoralize, Trip,
// Grapple, Shove, Escape) to the core's users, such as the Combat Simulator.
// Live play's confirmation cards come in a later slice.

import { BASIC_ACTIONS, compileAbility, compileBasicActions } from "../src/compiler/index.js";
import { setUpLivePlay } from "./live.js";

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
        // Monster abilities for now; class features, feats and consumables come later.
        handles: (item) => item?.type === "action" && item.actor?.type === "npc",
        // Waits for the basic actions, which the riders (Grab, Knockdown, Push) are built on.
        compile: async (item) => {
            await loaded;
            return compileAbility(item, { basicActions });
        }
    });
});

// Live play: the confirmation cards (scripts/live.js).
Hooks.once("ready", () => setUpLivePlay({ compileItem: (item) => compileAbility(item, { basicActions }), loaded }));

Hooks.once("ready", async () => {
    await loadBasicActions();
    const module = game.modules.get(MODULE_ID);
    if (module) module.api = Object.freeze({ get basicActions() { return basicActions; }, compileAbility: (item) => compileAbility(item, { basicActions }) });
});
