import test from "node:test";
import assert from "node:assert/strict";

import { incomingFits, lingerDuration, onlyFits, whoFits, zoneActions, zoneEvents, zoneMemberEffect } from "../src/live/zones.js";

// (2026-10-27, the item module's batches 2–4: The Eclipse, Globe of Shrouds, Cube of Force and Nex, Spiral Athame, The Uprising, Portable Seal,
// Soulspark Candle, Godsbreath Bow, Kraken Bottle.)
const save = (when, extra = {}) => ({ when, plan: { source: { name: when.join("+") } }, ...extra });
const kinds = (actions) => actions.map((action) => (action.kind === "save" ? `save:${action.plan.source.name}` : action.kind));

test("who an entry is for: allies and foes of its maker, the maker left out", () => {
    assert.deepEqual([whoFits("allies", { allied: true }), whoFits("allies", { own: true, allied: true }), whoFits("allies", {})], [true, false, false]);
    assert.deepEqual([whoFits("foes", {}), whoFits("foes", { allied: true }), whoFits("foes", { own: true })], [true, false, false]);
    assert.deepEqual([whoFits(undefined, { own: true }), whoFits("others", { own: true }), whoFits("own", { own: true })], [true, false, true]);
    const eclipse = { inside: [{ who: "foes", rules: [{ key: "FlatModifier", selector: "saving-throw", value: -2 }] }], modifiers: [{ selector: "ac", value: 1, who: "allies" }], saves: [save(["enter"], { who: "foes" })] };
    assert.deepEqual(kinds(zoneActions(eclipse, "tokenEnter", {})), ["inside", "save:enter"]);
    assert.deepEqual(kinds(zoneActions(eclipse, "tokenEnter", { allied: true })), ["modifiers"]);
    assert.deepEqual(kinds(zoneActions(eclipse, "tokenEnter", { own: true })), []);
    // (A modifier for everyone stays everyone's, its maker's too.)
    assert.deepEqual(kinds(zoneActions({ modifiers: [{ selector: "ac", value: -1 }] }, "tokenEnter", { own: true })), ["modifiers"]);
});

test("entry filters: not these traits, all of them, conditions it has or lacks, how it moved", () => {
    const living = { only: { notTraits: ["undead", "construct"] } };
    assert.deepEqual([onlyFits(living, ["humanoid"]), onlyFits(living, ["undead"])], [true, false]);
    const summonedUndead = { only: { all: ["summoned", "undead"] } };
    assert.deepEqual([onlyFits(summonedUndead, ["summoned", "undead", "zombie"]), onlyFits(summonedUndead, ["undead"])], [true, false]);
    const grabbed = { only: { conditions: ["grabbed"] } };
    const free = { only: { lacks: { conditions: ["grabbed"] } } };
    assert.deepEqual([onlyFits(grabbed, [], null, { conditions: ["grabbed"] }), onlyFits(grabbed, [], null, { conditions: [] })], [true, false]);
    assert.deepEqual([onlyFits(free, [], null, { conditions: ["grabbed"] }), onlyFits(free, [], null, { conditions: ["prone"] })], [false, true]);
    const flying = { only: { moving: "fly" } };
    assert.deepEqual([onlyFits(flying, [], null, { moving: "fly" }), onlyFits(flying, [], null, { moving: "walk" }), onlyFits(flying, [], null, {})], [true, false, false]);
    // (The Uprising: at its turn's end, the save only when it's not grabbed.)
    const uprising = { saves: [save(["end"], free)] };
    assert.deepEqual(kinds(zoneActions(uprising, "tokenTurnEnd", { conditions: ["grabbed"] })), []);
    assert.deepEqual(kinds(zoneActions(uprising, "tokenTurnEnd", { conditions: [] })), ["save:end"]);
    // (Godsbreath Bow: its region hears moves within it when a save is only for flying through.)
    assert.ok(zoneEvents({ saves: [save(["enter"], flying)] }).includes("tokenMoveWithin"));
    assert.ok(!zoneEvents({ saves: [save(["enter"])] }).includes("tokenMoveWithin"));
});

test("saves on leaving (Cube of Force's walls crossed either way) and on a melee Strike into it (Portable Seal)", () => {
    const cube = { saves: [save(["enter", "exit"], { only: { notTraits: ["undead", "construct"] } })] };
    assert.deepEqual(kinds(zoneActions(cube, "tokenExit", { traits: ["humanoid"] })), ["clear", "save:enter+exit"]);
    assert.deepEqual(kinds(zoneActions(cube, "tokenExit", { traits: ["undead"] })), ["clear"]);
    assert.deepEqual(kinds(zoneActions({ saves: [save(["enter"])] }, "tokenExit", {})), ["clear"]);
    const seal = { saves: [save(["enter", "strike-into"], { only: { traits: ["summoned"] } })] };
    assert.deepEqual(kinds(zoneActions(seal, "strikeInto", { traits: ["summoned", "fiend"] })), ["save:enter+strike-into"]);
    assert.deepEqual(kinds(zoneActions(seal, "strikeInto", { traits: ["fiend"] })), []);
    // (No entering's gifts on a Strike.)
    assert.deepEqual(kinds(zoneActions({ ...seal, concealed: true }, "strikeInto", { traits: ["summoned"] })), ["save:enter+strike-into"]);
});

test("inside Effects with words, kept after leaving (lingers), and undetected inside (Kraken Bottle's ink)", () => {
    const globe = { inside: [{ text: "Shrouded: concealed to creatures outside.", lingers: "turn-start", label: "shrouded" }], undetected: true };
    const actions = zoneActions(globe, "tokenEnter", {});
    assert.deepEqual(kinds(actions), ["undetected", "inside"]);
    const effect = zoneMemberEffect({ name: "Globe of Shrouds", kind: "inside", rules: [], text: actions[1].text, lingers: actions[1].lingers, label: actions[1].label, regionUuid: "Scene.s.Region.r", moduleId: "aar" });
    assert.equal(effect.name, "Globe of Shrouds: shrouded");
    assert.deepEqual(effect.flags.aar, { zone: "Scene.s.Region.r", lingers: { value: 1, unit: "rounds", expiry: "turn-start", sustained: false } });
    assert.match(effect.system.description.value, /Shrouded: concealed to creatures outside\.<\/p><p>It lasts until the start of its next turn after it leaves\./);
    const hidden = zoneMemberEffect({ name: "Kraken Bottle", kind: "undetected", undetectedUuid: "Compendium.pf2e.conditionitems.Item.VRSef5y1LmL2Hkjf", regionUuid: "r", moduleId: "aar" });
    assert.deepEqual([hidden.name, hidden.system.rules[0].uuid, hidden.system.rules[0].key], ["Kraken Bottle: inside (undetected)", "Compendium.pf2e.conditionitems.Item.VRSef5y1LmL2Hkjf", "GrantItem"]);
    assert.deepEqual(lingerDuration({ value: 1, unit: "minute" }), { value: 1, unit: "minutes", expiry: "turn-start", sustained: false });
    assert.equal(lingerDuration({ value: 0, unit: "minutes" }), null);
    assert.equal(zoneMemberEffect({ name: "X", kind: "inside", rules: [{ key: "Note" }], regionUuid: "r", moduleId: "aar" }).flags.aar.lingers, undefined);
});

test("an attack's damage that gets a zone's extra (Godsbreath Bow: ranged and physical)", () => {
    const bow = { damage: "1d8[bludgeoning]", attacks: ["ranged", "physical"] };
    assert.equal(incomingFits(bow, { options: ["item:ranged"], domains: ["strike-damage"], types: ["piercing"] }), true);
    assert.equal(incomingFits(bow, { options: ["item:ranged"], types: ["fire"] }), false);
    assert.equal(incomingFits(bow, { options: ["item:melee"], types: ["slashing"] }), false);
    assert.equal(incomingFits(bow, { options: ["item:melee", "item:thrown-melee"], types: ["piercing"] }), true, "a thrown weapon's attack is ranged");
});
