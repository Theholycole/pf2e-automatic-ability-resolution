import test from "node:test";
import assert from "node:assert/strict";

import { compileMonsterAbility } from "../src/compiler/index.js";

// A new save at the end of each turn (2026-10-13, batch 311; found by the simulator's deadliest-creatures study). Synthetic wording.
const item = (name, html, actions = 2) => ({ type: "action", name, system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, rules: [], description: { value: html } } });

test("a condition with a new save at the end of each of its turns carries duration.saveEnds; an open one is unlimited (batch 311)", () => {
    const dust = compileMonsterAbility(item("Test Dust", "<p>The test ghoul exhales grave dust in a @Template[cone|distance:15]. Each creature in the area must succeed at a @Check[fortitude|dc:20] save or become @UUID[Compendium.pf2e.conditionitems.Item.6uEgoh53GbXuHpTF]{Paralyzed}. It can attempt a new save at the end of each of its turns, and the DC cumulatively decreases by 1.</p>"));
    assert.deepEqual(dust.resolution.outcomes.failure.effects, [{ kind: "condition", slug: "paralyzed", value: null, duration: { mode: "unlimited", saveEnds: { save: "fortitude", dc: 20, drop: 1 } } }]);
    const song = compileMonsterAbility(item("Test Song", "<p>The test siren sings. Every creature within a @Template[emanation|distance:30] of it attempts a @Check[will|dc:22] save.</p><p><strong>Success</strong> The creature is unaffected.</p><p><strong>Failure</strong> The creature is @UUID[Compendium.pf2e.conditionitems.Item.yblD8fOR1J8rDwEQ]{Confused} for 1 minute. It can attempt a new save at the end of each of its turns to end the effect.</p><p><strong>Critical Failure</strong> As failure, and the creature takes @Damage[2d6[mental]] damage.</p>"));
    const confused = song.resolution.outcomes.failure.effects[0];
    assert.deepEqual([confused.duration.mode, confused.duration.value, confused.duration.saveEnds], ["fixed", 1, { save: "will", dc: 22, drop: 0 }]);
    // No new save in the text: as before.
    const plain = compileMonsterAbility(item("Test Dust", "<p>The test ghoul exhales grave dust in a @Template[cone|distance:15]. Each creature in the area must succeed at a @Check[fortitude|dc:20] save or become @UUID[Compendium.pf2e.conditionitems.Item.6uEgoh53GbXuHpTF]{Paralyzed} for 1 round.</p>"));
    assert.equal(plain.resolution.outcomes.failure.effects[0].duration.saveEnds, undefined);
});
