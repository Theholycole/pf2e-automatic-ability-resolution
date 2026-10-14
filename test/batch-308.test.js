import test from "node:test";
import assert from "node:assert/strict";

import { compileMonsterAbility } from "../src/compiler/index.js";

// A damage for each count of actions in "If it uses 1 action … 2 actions … 3 actions" wording (2026-10-13, batch 308). Synthetic wording.
test("an ability whose damage grows with the actions spent: the first count's damage, the others by count (batch 308)", () => {
    const item = { type: "action", name: "Test Pulse", system: { slug: null, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: ["force"] }, rules: [], description: { value: "<p>The test golem pulses. If the test golem uses 1 action, it deals @Damage[2d6[force]] damage to all creatures in a @Template[cone|distance:15]. If the test golem uses 2 actions, the damage is @Damage[4d6[force]]. If the test golem uses 3 actions, the damage is @Damage[6d6[force]]. Each creature in the area must attempt a @Check[fortitude|dc:20] save.</p><p><strong>Critical Success</strong> The creature is unaffected.</p><p><strong>Success</strong> The creature takes half damage.</p><p><strong>Failure</strong> The creature takes full damage.</p><p><strong>Critical Failure</strong> The creature takes double damage.</p>" } } };
    const plan = compileMonsterAbility(item);
    assert.deepEqual(plan.resolution.sharedDamage.components.map((component) => component.formula), ["2d6[force]"]);
    assert.deepEqual(Object.fromEntries(Object.entries(plan.resolution.native.byActions).map(([count, row]) => [count, row.sharedDamage.components[0].formula])), { 1: "2d6[force]", 2: "4d6[force]", 3: "6d6[force]" });
    assert.deepEqual(plan.resolution.outcomes.failure.damage.sourceComponentIds, ["0"]);
});
