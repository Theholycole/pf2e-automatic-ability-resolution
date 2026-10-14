import test from "node:test";
import assert from "node:assert/strict";

import { compileMonsterAbility } from "../src/compiler/index.js";

// How often an ability can be used, in more words (2026-10-13, batch 310; found by the simulator's deadliest-creatures study). Synthetic
// wording.
const item = (name, html, actions = 2) => ({ type: "action", name, system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, rules: [], description: { value: html } } });
const SPRAY = "The test golem sprays oil, dealing @Damage[3d6[fire]] damage to each creature in a @Template[cone|distance:15] (@Check[reflex|dc:20|basic] save).";
const plan = (after) => compileMonsterAbility(item("Oil Spray", `<p>${SPRAY} ${after}</p>`));

test("a recharge in minutes, in its own name without again; once a fight for an hour, a day or a spent store (batch 310)", () => {
    assert.deepEqual(plan("The test golem can't use Oil Spray again for 1 minute.").trigger.recharge, { formula: "10", unit: "rounds" });
    assert.deepEqual(plan("The test golem can't use Oil Spray for [[/gmr 1d4 #Recharge Oil Spray]]{1d4 rounds}.").trigger.recharge, { formula: "1d4", unit: "rounds" });
    assert.deepEqual(plan("The test golem can't use Oil Spray for 2 rounds.").trigger.recharge, { formula: "2", unit: "rounds" });
    assert.equal(plan("The test golem can't use Oil Spray again for 1 day.").oncePerFight, true);
    assert.equal(plan("The test golem can't use Oil Spray again until 1 hour has passed.").oncePerFight, true);
    assert.equal(plan("After the oil is spent, the tank goes dormant until the test golem refills it.").oncePerFight, true);
    // A target's immunity, or another creature that can't act: no limit on the ability.
    const immune = plan("A creature can't be affected by Oil Spray again for 1 minute.");
    assert.equal(immune.trigger.recharge, undefined);
    assert.equal(immune.oncePerFight, undefined);
    assert.equal(plan("A creature that fails can't use reactions for 1d4 rounds.").trigger.recharge, undefined);
});
