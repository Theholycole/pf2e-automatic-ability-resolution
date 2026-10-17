import test from "node:test";
import assert from "node:assert/strict";

import { floorEffectSource, floorLabel, floorsToLift, isFloor, persistentConditionSource } from "../src/live/floor.js";
import { changeLines } from "../src/live/card.js";

// Condition floors (2026-10-16, the item module's request: Timpani of Panic, Tallow Bombs, Putrescent Glob…).
const TIMPANI = { slug: "frightened", value: 1, lifetime: "fixed", duration: { value: 1, unit: "minutes" } };
const TALLOW = { slug: "sickened", value: 1, lifetime: "while-persistent", persistentDamage: "fire" };
const AMMUNITION = { slug: "frightened", value: 1, lifetime: "until-lifted", liftedBy: "it spends a concentrate action" };
const GLOB = { slug: "sickened", value: 1, lifetime: "fixed", duration: { value: 1, unit: "rounds", expiry: "turn-end", anchor: "target-turn" } };

test("a floor live play applies: a valued condition, a value, and a lifetime it can keep", () => {
    for (const floor of [TIMPANI, TALLOW, AMMUNITION, GLOB]) assert.equal(isFloor(floor), true, JSON.stringify(floor));
    assert.equal(isFloor({ ...TIMPANI, slug: "prone" }), false, "not a valued condition");
    assert.equal(isFloor({ ...TIMPANI, value: 0 }), false);
    assert.equal(isFloor({ ...TALLOW, persistentDamage: null }), false);
    assert.equal(isFloor({ ...AMMUNITION, liftedBy: "" }), false);
    assert.equal(isFloor({ ...TIMPANI, lifetime: "spell" }), false, "a spell's: the spell module's");
});

test("its words, and its Effect: the condition granted at the floor's value, locked, for its time", () => {
    assert.equal(floorLabel(TIMPANI), "Can't reduce Frightened below 1 for 1 minutes");
    assert.equal(floorLabel(GLOB), "Can't reduce Sickened below 1 until the end of its next turn");
    assert.equal(floorLabel(TALLOW), "Can't reduce Sickened below 1 while taking persistent fire damage");
    assert.match(floorLabel(AMMUNITION), /until it spends a concentrate action \(GM: delete this Effect then\)/);
    const context = { moduleId: "aar", abilityName: "Tallow Bomb", abilityUuid: "Item.tallow", sourceName: "Ezren", sourceActorUuid: "Actor.ezren", targetActorUuid: "Actor.ogre", conditionUuid: "Compendium.pf2e.conditionitems.Item.sickened", worldTime: 10 };
    const source = floorEffectSource(TALLOW, context);
    assert.equal(source.name, "Tallow Bomb: sickened floor");
    assert.deepEqual(source.system.duration, { value: -1, unit: "unlimited", expiry: null, sustained: false });
    assert.deepEqual(source.system.rules[0].alterations, [{ mode: "override", property: "badge-value", value: 1 }]);
    assert.deepEqual(source.system.rules[0].onDeleteActions, { granter: "cascade", grantee: "restrict" });
    assert.deepEqual(source.flags.aar.conditionFloor, TALLOW);
    const timed = floorEffectSource(GLOB, { ...context, rounds: 1 });
    assert.deepEqual(timed.system.duration, { value: 1, unit: "rounds", expiry: "turn-end", sustained: false });
    assert.equal(timed.system.context.origin.actor, "Actor.ogre", "counted on the target's turns");
});

test("a while-persistent floor ends with the last persistent damage of its type; others stay", () => {
    const effects = [{ id: "a", flags: { aar: { conditionFloor: TALLOW } } }, { id: "b", flags: { aar: { conditionFloor: { ...TALLOW, persistentDamage: "acid" } } } }, { id: "c", flags: { aar: { conditionFloor: TIMPANI } } }, { id: "d", flags: {} }];
    assert.deepEqual(floorsToLift(effects, ["acid"], "aar"), ["a"]);
    assert.deepEqual(floorsToLift(effects, ["fire", "acid"], "aar"), []);
    assert.deepEqual(floorsToLift(effects, [], "aar"), ["a", "b"]);
});

test("the card says it", () => {
    const lines = changeLines([{ op: "effect", target: "t", effect: { kind: "floor", floor: TIMPANI } }], { t: "Ogre" });
    assert.ok(lines.some((line) => line === "Ogre: can't reduce Frightened below 1 for 1 minutes"), JSON.stringify(lines));
});

test("2026-10-17: a condition that lasts while a persistent damage does (Sparking Spellgun's dazzled) — its Effect, ended with the last of that damage", () => {
    const source = persistentConditionSource("dazzled", null, "electricity", { moduleId: "aar", abilityName: "Sparking Spellgun", sourceName: "Ezren", sourceActorUuid: "Actor.ezren", targetActorUuid: "Actor.ogre", conditionUuid: "Compendium.pf2e.conditionitems.Item.dazzled" });
    assert.equal(source.name, "Sparking Spellgun: Dazzled");
    assert.deepEqual([source.flags.aar.whilePersistent, source.system.duration.unit, source.system.rules[0].alterations, source.system.rules[0].onDeleteActions.grantee], ["electricity", "unlimited", [], "cascade"]);
    const effects = [{ id: "d", flags: { aar: { whilePersistent: "electricity" } } }, { id: "f", flags: { aar: { conditionFloor: TALLOW } } }];
    assert.deepEqual(floorsToLift(effects, ["fire"], "aar"), ["d"]);
    assert.deepEqual(floorsToLift(effects, [], "aar"), ["d", "f"]);
    assert.deepEqual(floorsToLift(effects, ["fire", "electricity"], "aar"), []);
});
