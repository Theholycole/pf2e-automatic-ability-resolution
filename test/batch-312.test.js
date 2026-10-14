import test from "node:test";
import assert from "node:assert/strict";

import { compileMonsterAbility } from "../src/compiler/index.js";

// A Strike rider that also follows a critically failed save against the creature's spells (2026-10-14, batch 312; the user asked whether the
// Grim Reaper's death effects worked).
// (A rider of the creature's scythe, which lists it among its attack effects.)
const actor = { name: "Test Reaper", items: [{ type: "melee", name: "Scythe", system: { attackEffects: { value: ["death-strike"] }, traits: { value: [] } } }] };
const item = (html, slug = "death-strike") => ({ type: "action", name: "Test Doom", system: { slug, actionType: { value: "passive" }, actions: { value: null }, traits: { value: ["death"] }, rules: [], description: { value: html } } });

test("Death Strike's spell half: trigger.spellCriticalFailure beside the Strike's critical hit (batch 312)", () => {
    const both = compileMonsterAbility(item("<p>A creature critically hit by any of the test reaper's attacks or that critically fails against any of its spells must succeed at a @Check[fortitude|dc:30] save or die.</p>"), { actor });
    assert.equal(both.trigger.event, "strike");
    assert.equal(both.trigger.spellCriticalFailure, true);
    const hits = compileMonsterAbility(item("<p>A creature critically hit by any of the test reaper's attacks must succeed at a @Check[fortitude|dc:30] save or die.</p>"), { actor });
    assert.equal(hits.trigger.spellCriticalFailure, undefined);
});
