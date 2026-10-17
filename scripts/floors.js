// Live play: condition floors (src/live/floor.js). applyFloor makes a floor's Effect on a creature; a floor that lasts while the creature
// takes persistent damage of a type ends with its last persistent damage of that type (the active GM, as PF2e deletes the condition).

import { floorEffectSource, floorLabel, floorsToLift, isFloor, persistentConditionSource } from "../src/live/floor.js";

const MODULE_ID = "pf2e-automatic-ability-resolution";

// The floor's Effect on the actor; rounds: a fixed duration's value as live play counts it (turnRounds). → what it did, for the card
// ("can't reduce Sickened below 1 while taking persistent fire damage"), or null.
export async function applyFloor(actor, floor, state, { rounds = null, anchor = null } = {}) {
    if (!isFloor(floor)) return null;
    const template = game.pf2e.ConditionManager.getCondition(floor.slug);
    if (!template) return null;
    const created = await actor.createEmbeddedDocuments("Item", [floorEffectSource(floor, {
        moduleId: MODULE_ID,
        abilityName: state.ability.name,
        abilityUuid: state.ability.uuid ?? null,
        sourceName: state.source.name,
        sourceActorUuid: state.source.actorUuid,
        targetActorUuid: actor.uuid,
        conditionUuid: template._stats?.compendiumSource ?? template.sourceId ?? template.uuid,
        img: template.img,
        rounds,
        worldTime: game.time.worldTime,
        initiative: game.combat?.started ? game.combat.combatant?.initiative ?? null : null
    })]);
    if (anchor) await anchor(created);
    return floorLabel(floor).replace(/^Can't/, "can't");
}

// (2026-10-17) A condition that lasts while the creature takes persistent damage of a type (Sparking Spellgun's dazzled): its Effect, ended
// with that damage (setUpFloors). → whether it applied (not when the creature takes no persistent damage of that type).
export async function applyWhilePersistent(actor, slug, value, type, state) {
    const takes = (actor.itemTypes?.condition ?? []).some((condition) => condition.slug === "persistent-damage" && condition.system?.persistent?.damageType === type);
    const template = game.pf2e.ConditionManager.getCondition(slug);
    if (!takes || !template) return false;
    await actor.createEmbeddedDocuments("Item", [persistentConditionSource(slug, value, type, {
        moduleId: MODULE_ID,
        abilityName: state.ability.name,
        abilityUuid: state.ability.uuid ?? null,
        sourceName: state.source.name,
        sourceActorUuid: state.source.actorUuid,
        targetActorUuid: actor.uuid,
        conditionUuid: template._stats?.compendiumSource ?? template.sourceId ?? template.uuid,
        img: template.img,
        worldTime: game.time.worldTime,
        initiative: game.combat?.started ? game.combat.combatant?.initiative ?? null : null
    })]);
    return true;
}

export function setUpFloors() {
    Hooks.on("deleteItem", (item) => {
        if (item?.slug !== "persistent-damage" || game.users.activeGM?.id !== game.user.id) return;
        const actor = item.parent;
        if (!actor) return;
        const types = (actor.itemTypes?.condition ?? []).filter((condition) => condition.slug === "persistent-damage").map((condition) => condition.system?.persistent?.damageType).filter(Boolean);
        const ids = floorsToLift(actor.itemTypes?.effect ?? [], types, MODULE_ID);
        if (ids.length) actor.deleteEmbeddedDocuments("Item", ids).catch((error) => console.error(`${MODULE_ID} | condition floor`, error));
    });
}
