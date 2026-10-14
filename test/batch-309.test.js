import test from "node:test";
import assert from "node:assert/strict";

import { compileMonsterAbility } from "../src/compiler/index.js";
import { readNeeds, requirementText } from "../src/compiler/needs.js";

// Requirements no reading kept (2026-10-13, batch 309): the simulator played them as if always met. Synthetic wording.
const item = (name, html, actions = 1) => ({ type: "action", name, system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, rules: [], description: { value: html } } });
const requiring = (requirement, effect, name = "Test Ability") => compileMonsterAbility(item(name, `<p><strong>Requirements</strong> ${requirement}</p><hr /><p><strong>Effect</strong> ${effect}</p>`));
const SURGE = "The test golem Strides up to its Speed. This movement doesn't trigger reactions.";

test("a requirement no reading kept is requirementUnread; a spent resource once a fight; one always met unchanged (batch 309)", () => {
    assert.equal(requiring("The test golem is standing in deep water.", SURGE).requirementUnread, "The test golem is standing in deep water");
    const tank = requiring("The test golem has a full oil tank.", "The test golem sprays oil, dealing @Damage[3d6[fire]] damage to each creature in a @Template[cone|distance:15] (@Check[reflex|dc:20|basic] save). This empties the tank.");
    assert.equal(tank.oncePerFight, true);
    assert.equal(tank.requirementUnread, undefined);
    for (const always of ["The test golem has a hand free.", "The test golem can see the target.", "The test golem is wielding a club."]) assert.equal(requiring(always, SURGE).requirementUnread, undefined, always);
    // Nothing said, nothing added.
    assert.deepEqual(compileMonsterAbility(item("Test Run", `<p>${SURGE}</p>`)), { builtin: "safe-move", actions: 1 });
});

test("hit-point thresholds, held creatures and a Strike before, in more words (batch 309)", () => {
    const needs = (requirement) => readNeeds(item("Test", `<p><strong>Requirements</strong> ${requirement}</p><p><strong>Effect</strong> ${SURGE}</p>`));
    assert.deepEqual(needs("The test troll has 30 Hit Points or fewer."), [{ hpBelow: 31 }]);
    assert.deepEqual(needs("The test troll has been reduced to 30 Hit Points or fewer."), [{ hpBelow: 31 }]);
    assert.deepEqual(needs("The test troll has 40 or more Hit Points remaining."), [{ hpAtLeast: 40 }]);
    assert.deepEqual(needs("The test troll is below half its total Hit Points."), [{ hpBelowHalf: true }]);
    assert.deepEqual(needs("The test troll is at less than its maximum Hit Points."), [{ hurt: true }]);
    assert.deepEqual(needs("The test troll has taken damage."), [{ hurt: true }]);
    assert.deepEqual(needs("The test troll isn't Fatigued or raging."), [{ notFatigued: true }]);
    assert.deepEqual(needs("The test troll has a Medium or smaller creature Grabbed."), [{ grabbing: {} }]);
    assert.deepEqual(needs("The test troll damaged a creature with a jaws Strike on its last action."), [{ afterStrike: { strike: "jaws", on: ["success", "criticalSuccess"] } }]);
    assert.deepEqual(needs("The test crab has a creature Grabbed in one or both pincers."), [{ grabbing: {} }]);
    assert.deepEqual(needs("The test crab has Grabbed a creature."), [{ grabbing: {} }]);
    assert.deepEqual(needs("The test crab's previous action was a claw Strike against the target creature."), [{ afterStrike: { strike: "claw", on: ["criticalFailure", "failure", "success", "criticalSuccess"] } }]);
    assert.deepEqual(needs("The test crab's last action was a successful claw Strike against a creature."), [{ afterStrike: { strike: "claw", on: ["success", "criticalSuccess"] } }]);
    // A Requirements sentence that runs on into the effect: its first sentence.
    assert.equal(requirementText(item("Test", "<p><strong>Requirements</strong> The test troll isn't raging. The test troll howls and rages.</p>")), "The test troll isn't raging");
    assert.equal(requirementText(item("Test", "<p><strong>Requirements</strong> The test troll is hurt</p><p><strong>Effects</strong> It howls.</p>")), "The test troll is hurt");
});
