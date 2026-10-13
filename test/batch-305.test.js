import test from "node:test";
import assert from "node:assert/strict";

import { compileMonsterAbility } from "../src/compiler/index.js";

// Fast Healing and regeneration only while something holds (2026-10-13, batch 305; the user's call: "build everything you brought up").
const passive = (name, rules) => ({ type: "action", name, system: { slug: null, actionType: { value: "passive" }, actions: { value: null }, traits: { value: [] }, rules, description: { value: "<p>@Localize[PF2E.NPC.Abilities.Glossary.FastHealing]</p>" } } });

test("a passive's predicated Fast Healing or regeneration keeps PF2e's predicate for the simulation; a bonus on the same passive comes first (batch 305)", () => {
    // Its own toggle: fast healing while it holds.
    assert.deepEqual(compileMonsterAbility(passive("Fast Healing 2 (Test Terrain)", [{ key: "FastHealing", predicate: ["fast-healing"], value: 2 }, { key: "RollOption", option: "fast-healing", toggleable: true }])), { builtin: "fast-healing", value: 2, when: ["fast-healing"] });
    // Not in a form: on unless it holds.
    assert.deepEqual(compileMonsterAbility(passive("Fast Healing 7", [{ key: "FastHealing", predicate: [{ not: "turn-to-mist" }], value: 7 }])), { builtin: "fast-healing", value: 7, when: [{ not: "turn-to-mist" }] });
    assert.deepEqual(compileMonsterAbility(passive("Regeneration 20 (Deactivated by Cold)", [{ key: "FastHealing", type: "regeneration", deactivatedBy: ["cold"], predicate: ["test-mask"], value: 20 }])), { builtin: "regeneration", value: 20, deactivatedBy: ["cold"], when: ["test-mask"] });
    // Without a predicate, as before.
    assert.deepEqual(compileMonsterAbility(passive("Fast Healing 5", [{ key: "FastHealing", value: 5 }])), { builtin: "fast-healing", value: 5 });
    // A save bonus on the same passive is read first.
    assert.equal(compileMonsterAbility(passive("Test Curse", [{ key: "FlatModifier", selector: "saving-throw", type: "status", value: -2, predicate: ["test-curse"] }, { key: "FastHealing", predicate: ["test-curse"], value: 5 }]))?.builtin, "save-bonus");
});
