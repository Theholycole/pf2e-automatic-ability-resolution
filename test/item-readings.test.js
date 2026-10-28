import test from "node:test";
import assert from "node:assert/strict";

import { compileMonsterAbility } from "../src/compiler/index.js";
import { readAffliction as readStages } from "../src/compiler/afflictions.js";

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

test("a basic save's degree sections add their own conditions to the basic rows (Vision of Meloth); not a second check's sections", () => {
    const plan = compileMonsterAbility(item(`<p>The target takes @Damage[6d6[mental]] damage with a @Check[will|dc:25|basic] save.</p><p><strong>Critical Success</strong> The target is unaffected.</p><p><strong>Success</strong> The target takes half damage and is ${link("Frightened 1")}.</p><p><strong>Failure</strong> The target takes full damage and is ${link("Frightened 2")}.</p><p><strong>Critical Failure</strong> The target takes double damage, is ${link("Frightened 4")}, and is ${link("Slowed 1")} as long as it remains frightened.</p>`));
    assert.deepEqual([rows(plan).success, rows(plan).failure, rows(plan).criticalFailure], [["frightened 1"], ["frightened 2"], ["frightened 4", "slowed 1"]]);
    assert.deepEqual(["success", "criticalFailure"].map((degree) => plan.resolution.outcomes[degree].damage.multiplier), [0.5, 2]);
    const two = compileMonsterAbility(item(`<p>The burst deals @Damage[4d6[fire]] damage (@Check[reflex|dc:25|basic] save). Each creature that breathes the smoke must attempt a @Check[fortitude|dc:25] save.</p><p><strong>Success</strong> The creature is unaffected.</p><p><strong>Failure</strong> The creature is ${link("Sickened 1")}.</p>`));
    assert.deepEqual(rows(two).failure.filter((entry) => entry.startsWith("sickened")), []);
});

test("\"On a critical failure, the foe is also knocked Prone\" after a basic save: the critical failure's (Stampede Medallion)", () => {
    const plan = compileMonsterAbility(item(`<p>The herd tramples the foes around it for @Damage[4d6[bludgeoning]] damage, with a @Check[reflex|dc:25|basic] save. On a critical failure, the foe is also knocked ${link("Prone")}.</p>`));
    assert.deepEqual([rows(plan).failure, rows(plan).criticalFailure], [[], ["prone -"]]);
});

test("an affliction's stages: a condition by its noun, \"(remaining duration)\", a stage's own PF2e Effect (Grit, Blaze, Succubus Kiss)", async () => {
    const { readAffliction } = await import("../src/compiler/afflictions.js");
    const effect = (id, label) => `<p>@UUID[Compendium.pf2e.equipment-effects.Item.${id}]{Effect: ${label}}</p>`;
    const html = `<p><strong>Saving Throw</strong> @Check[fortitude|dc:20]</p><p><strong>Maximum Duration</strong> 1 day</p>`
        + `<p><strong>Stage 1</strong> +1 item bonus to Athletics checks (10 minutes)</p>${effect("TESTSTAGEONE0001", "Test Drug")}`
        + `<p><strong>Stage 2</strong> ${link("Confusion")} (1 round)</p>`
        + `<p><strong>Stage 3</strong> ${link("Blindness")} or ${link("Deafness")} (1 hour)</p>`
        + `<p><strong>Stage 4</strong> ${link("Unconscious")} (remaining duration)</p>${effect("TESTWHOLEAFFLICT", "Test Drug")}`;
    const stages = readAffliction({ name: "Test Drug", system: { slug: "test-drug", traits: { value: ["poison"] }, description: { value: html } } }).stages;
    assert.deepEqual(stages[0].effects, [{ uuid: "Compendium.pf2e.equipment-effects.Item.TESTSTAGEONE0001", label: "Test Drug" }]);
    assert.deepEqual(stages[1].conditions, [{ slug: "confused", value: null }]);
    assert.deepEqual(stages[2].conditions, [], "a choice: the GM's");
    assert.deepEqual([stages[3].duration, stages[3].effects], [{ value: null, unit: "remaining" }, undefined], "not the whole affliction's Effect after its last stage");
});

test("Administer First Aid's critical failure raises dying by 1, not to 1 (the item module's live check)", async () => {
    const { compileFirstAid } = await import("../src/compiler/checks.js");
    const { CORE_FAMILIES, createRegistry } = await import("../../pf2e-resolution-core/src/index.js");
    const plan = compileFirstAid({ name: "Administer First Aid" });
    assert.deepEqual(plan.resolution.outcomes.criticalFailure.effects, [{ kind: "condition", slug: "dying", value: 1, duration: null, stack: { by: 1 } }]);
    // (The core passes the stack on, as for a save's.)
    const registry = createRegistry();
    for (const family of CORE_FAMILIES) registry.registerFamily(family);
    const result = registry.resolveSync(plan, { caster: { id: "a" }, targets: [{ id: "b" }], id: (c) => c.id, statistic: () => ({ modifier: 0, dc: 20 }), traits: () => [], iwr: () => ({ immunities: [] }), allied: () => true }, { roll: () => ({ degree: "criticalFailure" }) });
    assert.deepEqual(result.changes.find((change) => change.op === "condition")?.stack, { by: 1 });
});

test("no encounter: no one is in it (a condition landing outside one no longer throws in the reaction hooks)", async () => {
    const { inEncounter } = await import("../scripts/auras.js");
    assert.deepEqual([...inEncounter(null)], []);
    assert.deepEqual([...inEncounter({ combatants: [{ tokenId: "a" }, { tokenId: null }, { tokenId: "b" }] })], ["a", "b"]);
});

test("2026-10-27: an affliction's range of stages alike ('Stages 1–5'), and its fields stopping at the next one", () => {
    const itch = { name: "Test Itch", system: { slug: "test-itch", traits: { value: ["poison"] }, description: { value: "<p>The onset period begins only if a victim eats it.</p><p><strong>Saving Throw</strong> @Check[fortitude|dc:30]</p><p><strong>Onset</strong> 10 minutes <strong>Maximum Duration</strong> 6 minutes</p><p><strong>Stages 1–5</strong> 1d6 poison damage (1 round)</p>" } } };
    const read = readStages(itch);
    assert.equal(read.stages.length, 5);
    assert.deepEqual(read.stages.map((stage) => [stage.stage, stage.damage.join(","), stage.duration?.value]), [1, 2, 3, 4, 5].map((stage) => [stage, "(1d6)[poison]", 1]));
    assert.deepEqual([read.onset, read.maximumDuration], [{ value: 10, unit: "minutes" }, { value: 6, unit: "minutes" }]);
});
