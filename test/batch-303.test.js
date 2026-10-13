import test from "node:test";
import assert from "node:assert/strict";

import { compileMonsterAbility } from "../src/compiler/index.js";
import { readNeeds } from "../src/compiler/needs.js";

// Requirements the simulator can check, read into needs (2026-10-13, batch 303; the user's call: "work through your recommendations in
// order", item 1).
const item = (name, requirement, effect = "The test beast regains 10 Hit Points.") => ({ type: "action", name, system: { slug: null, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: [] }, description: { value: `<p><strong>Requirements</strong> ${requirement}</p><hr /><p><strong>Effect</strong> ${effect}</p>` }, rules: [] } });

test("requirements read into needs: corpses, holds, numbers, its own state, its last action, a target's state; and both or either (batch 303)", () => {
    assert.deepEqual(readNeeds(item("Feast", "The test ghoul is adjacent to the corpse of a creature that died within the last hour.")), [{ corpse: {} }]);
    assert.deepEqual(readNeeds(item("Feast", "The test ghoul is adjacent to the corpse of an evil or chaotic creature that died within the last hour.")), [{ corpse: { traits: ["evil", "chaotic"] } }]);
    assert.deepEqual(readNeeds(item("Drink", "The test bat has a creature Grabbed")), [{ grabbing: {} }]);
    assert.deepEqual(readNeeds(item("Squeeze", "The test ooze begins its turn with a target of its size or smaller Grabbed")), [{ grabbing: {} }]);
    assert.deepEqual(readNeeds(item("Tear", "The test spirit has an incorporeal creature Grabbed or Restrained")), [{ grabbing: { trait: "incorporeal" } }]);
    assert.deepEqual(readNeeds(item("Transfuse", "The test leech has at least 50 Hit Points")), [{ hpAtLeast: 50 }]);
    assert.deepEqual(readNeeds(item("Push On", "The test warrior is adjacent to at least one enemy, and the test warrior has fewer than 10 Hit Points")), [{ enemyAdjacent: true }, { hpBelow: 10 }]);
    assert.deepEqual(readNeeds(item("Regrow", "The test troll's regeneration is not currently deactivated.")), [{ regeneration: true }]);
    assert.deepEqual(readNeeds(item("Bash Ahead", "The test captain has their shield raised")), [{ shieldRaised: true }]);
    assert.deepEqual(readNeeds(item("Rift", "The test cultist's last action was to cast a non-cantrip spell")), [{ afterCast: { nonCantrip: true } }]);
    assert.deepEqual(readNeeds(item("Lunge On", "The test hound's last action was a successful bite Strike against a Huge or larger creature")), [{ afterStrike: { strike: "bite", on: ["success", "criticalSuccess"], size: { min: "huge" } } }]);
    assert.deepEqual(readNeeds(item("Grind", "The test worm hit with a melee Strike with its last action, or it has a creature Engulfed.")), [{ any: [{ afterStrike: { on: ["success", "criticalSuccess"], melee: true } }, { swallowing: true }] }]);
    assert.deepEqual(readNeeds(item("Haul", "The test hound is adjacent to a Prone creature")), [{ target: { conditions: ["prone"], within: 5 } }]);
    assert.deepEqual(readNeeds(item("Lay Eggs", "The test wasp is adjacent to a Paralyzed, Restrained, or Unconscious creature")), [{ target: { conditions: ["paralyzed", "restrained", "unconscious"], within: 5 } }]);
    assert.deepEqual(readNeeds(item("Throw Ally", "A goblin is within 10 feet of the test ogre")), [{ allyTrait: { trait: "goblin", within: 10 } }]);
    // Not one it can't see: an unaware creature, a body it lives in.
    assert.equal(readNeeds(item("Trick", "The test hag touches a creature that doesn't realize the hag is an enemy")), null);
    assert.equal(readNeeds(item("Leave", "The test worm is Inhabiting a Body")), null);
});

test("a plan with a requirement carries its needs; one with none, or the GM's, doesn't (batch 303)", () => {
    const plan = compileMonsterAbility(item("Test Feast", "The test ghoul is adjacent to the corpse of a creature that died within the last hour.", "The test ghoul devours a chunk of the corpse and regains @Damage[3d6[healing]] Hit Points."));
    assert.deepEqual([plan.resolution.kind, plan.needs], ["healing", [{ corpse: {} }]]);
    // (No requirement: no needs.)
    assert.equal(compileMonsterAbility({ ...item("Test Mend", "x"), system: { ...item("Test Mend", "x").system, description: { value: "<p>The test ghoul regains @Damage[3d6[healing]] Hit Points.</p>" } } })?.needs, undefined);
});
