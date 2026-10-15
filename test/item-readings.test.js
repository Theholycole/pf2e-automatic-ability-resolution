import test from "node:test";
import assert from "node:assert/strict";

import { compileMonsterAbility } from "../src/compiler/index.js";

// Readings the item module found wrong in item texts (2026-10-15). Synthetic wording, after each.
const item = (html) => ({ type: "action", name: "Test Activation", system: { slug: null, actionType: { value: "action" }, actions: { value: 2 }, traits: { value: [] }, rules: [], description: { value: html } } });
const link = (name) => `@UUID[Compendium.pf2e.conditionitems.Item.test0000000000000]{${name}}`;
const rows = (plan) => Object.fromEntries(["criticalSuccess", "success", "failure", "criticalFailure"].map((degree) => [degree, (plan.resolution.outcomes[degree]?.effects ?? []).filter((effect) => effect.kind === "condition").map((effect) => `${effect.slug} ${effect.value ?? "-"}${effect.stack ? ` +${effect.stack.by}${effect.stack.max ? `≤${effect.stack.max}` : ""}` : ""}`)]));

test("\"increases its slowed condition by 1, to a maximum of Slowed 3\": that much, stacking to that most (Gearbinder Oil)", () => {
    const plan = compileMonsterAbility(item(`<p>The test oil binds a target within 10 feet, which must attempt a @Check[fortitude|dc:20] save.</p><p><strong>Critical Success</strong> The target is unaffected.</p><p><strong>Success</strong> The target reduces its slowed condition by 1.</p><p><strong>Failure</strong> The target increases its slowed condition by 1, to a maximum of ${link("Slowed 3")}.</p><p><strong>Critical Failure</strong> The target increases its slowed condition by 2, to a maximum of slowed 3.</p>`));
    assert.deepEqual([rows(plan).failure, rows(plan).criticalFailure], [["slowed 1 +1≤3"], ["slowed 2 +2≤3"]]);
});

test("\"while it is slowed\" names no new condition (Mamlambo Scale); \"As failure\" keeps the failure's (Frightening Shush)", () => {
    const plan = compileMonsterAbility(item(`<p>Each creature within 20 feet must attempt a @Check[will|dc:20] save.</p><p><strong>Critical Success</strong> The creature is unaffected.</p><p><strong>Success</strong> The creature is ${link("Frightened 1")}.</p><p><strong>Failure</strong> The creature is ${link("Frightened 2")}.</p><p><strong>Critical Failure</strong> As failure, but the creature is also ${link("Off-Guard")} against the first Strike made against it while it is slowed.</p>`));
    assert.deepEqual(rows(plan).criticalFailure.sort(), ["frightened 2", "off-guard -"]);
});

test("\"Clumsy 1 for 1 round on a failure, or Clumsy 2 on a critical failure\": each degree's own (Fireworks Boots)", () => {
    const plan = compileMonsterAbility(item(`<p>You Stride, and creatures within 5 feet of each space you move through must attempt a @Check[reflex|dc:20] save. They become ${link("Clumsy 1")} for 1 round on a failure, or ${link("Clumsy 2")} on a critical failure.</p>`));
    assert.deepEqual([rows(plan).failure, rows(plan).criticalFailure], [["clumsy 1"], ["clumsy 2"]]);
});

test("only some creatures' condition (\"Creatures that are vulnerable to sunlight are also Frightened 1 if they fail\") is the GM's (Horn of the Sun Aurochs)", () => {
    const plan = compileMonsterAbility(item(`<p>Enemies in a @Template[emanation|distance:20] take @Damage[4d6[sonic]] damage (@Check[fortitude|dc:20|basic] save). Creatures that are specifically vulnerable to sunlight are also ${link("Frightened 1")} if they fail this save or ${link("Frightened 2")} on a critical failure.</p>`));
    assert.deepEqual([rows(plan).failure, rows(plan).criticalFailure], [[], []]);
    assert.equal(plan.resolution.outcomes.failure.damage.multiplier, 1);
});
