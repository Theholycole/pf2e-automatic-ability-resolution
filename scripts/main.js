// PF2e Automatic Ability Resolution: registers the ability compiler with the
// resolution core and offers the compiled basic actions (Demoralize, Trip,
// Grapple, Shove, Escape) to the core's users, such as the Combat Simulator.
// Live play: confirmation cards (scripts/live.js) and aura triggers (scripts/auras.js).

import { BASIC_ACTIONS, compileAbility, compileBasicActions } from "../src/compiler/index.js";
import { applyChange, playAbility, postCard, reflectCard, setUpLivePlay } from "./live.js";
import { setUpAuras } from "./auras.js";
import { setUpSwallow } from "./swallow.js";
import { setUpFloors } from "./floors.js";
import { setUpEscapes } from "./escape.js";
import { setUpRecurring } from "./recurring.js";
import { setUpRecharge } from "./recharge.js";
import { setUpReactions } from "./reactions.js";
import { setUpHazards } from "./hazards.js";
import { endZones, setUpZones, startZone, zoneEvent } from "./zones.js";
import { pickCreature, setUpConjure, startConjure } from "./conjure.js";
import { registerReminderSetting, setUpReminders } from "./reminders.js";
import { actorData, watchActors } from "./actor-data.js";
import { setUpBravery } from "./bravery.js";
import { initiativeSkills } from "../src/compiler/initiative.js";

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

// An ability compiled with its creature, as offline (scripts/actor-data.js); without it if a reading fails on the world's data.
const compileWithActor = (item) => {
    try {
        return compileAbility(item, { basicActions, actor: actorData(item?.actor) });
    } catch (error) {
        console.warn(`${MODULE_ID} | ${item?.name} didn't compile with its creature.`, error);
        return compileAbility(item, { basicActions });
    }
};
watchActors();

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
            return compileWithActor(item);
        }
    });
});

// Live play: the confirmation cards (scripts/live.js), the monsters' auras
// (scripts/auras.js) and Swallow Whole over the turns (scripts/swallow.js).
Hooks.once("ready", () => {
    const compileItem = compileWithActor;
    setUpLivePlay({ compileItem, basicActions: () => basicActions, loaded });
    setUpAuras({ compileItem, loaded });
    setUpSwallow();
    // (2026-10-16: condition floors that last while persistent damage does.)
    setUpFloors();
    // (2026-10-20: Effects a successful Escape ends, and one-roll misfortunes once used.)
    setUpEscapes();
    // (2026-10-20: a new save at a creature's turns.)
    setUpRecurring();
    setUpRecharge({ compileItem });
    setUpReactions({ compileItem });
    // (Batch 302: Bravery's lower frightened, from whatever adds it.)
    setUpBravery({ compileItem });
    setUpHazards({ compileItem });
    setUpZones();
    setUpConjure({ compileItem });
    setUpReminders({ compileItem });
});

// (Batch 296: the reaction reminders' world setting.)
Hooks.once("init", () => registerReminderSetting());

Hooks.once("ready", async () => {
    await loadBasicActions();
    const module = game.modules.get(MODULE_ID);
    // (zoneEvent: the zones' Region script behaviours call it, batch 256.)
    // (initiativeSkills, batch 302: the skills an ability names for its creature's own initiative — the simulator's.)
    // (live.applyChange, 2026-10-15: the item module's cards apply the core's changes with this module's Foundry code — heal, temporary Hit
    // Points, native Effects, timed conditions, the affliction hand-off.)
    // (live.startConjure, 2026-10-18: the item module's conjure plans — Fossil Fragments, Wondrous Figurines — as playAbility makes them:
    // startConjure({ item, plan, sourceToken }), item.actor the user.)
    // (live.playAbility, 2026-10-30: the feat module's character feats, played as a monster's ability is: playAbility(item, plan, sourceToken,
    // targets).)
    if (module) module.api = Object.freeze({ get basicActions() { return basicActions; }, compileAbility: compileWithActor, initiativeSkills, zoneEvent, live: Object.freeze({ applyChange, postCard, playAbility, startZone, startConjure, endZones, pickCreature, reflect: reflectCard }) });
});
