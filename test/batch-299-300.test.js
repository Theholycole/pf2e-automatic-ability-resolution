import test from "node:test";
import assert from "node:assert/strict";

import { compileMonsterAbility } from "../src/compiler/index.js";
import { triggerText, watchTrigger } from "../src/compiler/watch.js";
import { hitSetsOff } from "../src/live/reactions.js";

const ability = (name, html, type = "reaction", actions = null) => ({ type: "action", name, system: { slug: null, actionType: { value: type }, actions: { value: actions }, traits: { value: [] }, description: { value: html } } });
const hazard = { name: "Test Trap", type: "hazard", system: { details: { level: { value: 3 } } } };

test("a trap's own Strike (2026-10-13, batch 299): at the creature that set it off, at all of them, at one beside it, then initiative", () => {
    const snap = compileMonsterAbility(ability("Snap", "<p><strong>Trigger</strong> A creature steps on the plate</p><hr /><p><strong>Effect</strong> The test jaws snap shut, making a jaws Strike against the triggering creature.</p>"), { actor: hazard, pack: "hazards" });
    assert.deepEqual([snap.builtin, snap.strike, snap.at, snap.initiative, snap.notes], ["trap-strike", "jaws", "trigger", false, ["At the creature that set it off: target it."]]);
    const blades = compileMonsterAbility(ability("Blades", "<p><strong>Trigger</strong> The wire is pulled.</p><hr /><p><strong>Effect</strong> Both blades swing down, each one Striking all creatures under the grooves.</p>"), { actor: hazard, pack: "hazards" });
    assert.deepEqual([blades.at, blades.times, blades.notes[0]], ["all", 2, "At all creatures under the grooves: target them."]);
    const pillar = compileMonsterAbility(ability("Pillar", "<p><strong>Trigger</strong> A creature steps on a tile</p><hr /><p><strong>Effect</strong> The trap pops up and makes a spinning blade Strike against one adjacent creature (if any), then rolls initiative.</p>"), { actor: hazard, pack: "hazards" });
    assert.deepEqual([pillar.strike, pillar.at, pillar.initiative], ["spinning blade", "adjacent", true]);
    // More than its Strike: the rest a note for the GM; "against it", the creature that set it off.
    const more = compileMonsterAbility(ability("Lock", "<p><strong>Trigger</strong> A creature picks the lock</p><hr /><p><strong>Effect</strong> A hidden blade stabs it, making a blade Strike against it. Then, the trap releases a cloud of moths.</p>"), { actor: hazard, pack: "some-adventure-bestiary" });
    assert.deepEqual(more.notes, ["At the creature that set it off: target it.", "Also, for the GM: Then, the trap releases a cloud of moths."]);
    // Not a creature's reaction, and not one with numbers of its own.
    assert.notEqual(compileMonsterAbility(ability("Snap", "<p><strong>Trigger</strong> A creature comes near</p><hr /><p><strong>Effect</strong> The test plant makes a jaws Strike against the triggering creature.</p>"), { actor: { name: "Test Plant", type: "npc" } })?.builtin, "trap-strike");
});

test("triggers the module watches, read for reactions that only had a reminder (2026-10-13, batch 300)", () => {
    assert.equal(triggerText("<p><strong>Trigger</strong> The test knight hits a creature with a weapon Strike</p><hr /><p><strong>Effect</strong> It casts something.</p>"), "The test knight hits a creature with a weapon Strike");
    assert.deepEqual(watchTrigger("The test knight hits a creature with a weapon Strike"), { event: "own-strike", reaction: true, on: ["success", "criticalSuccess"] });
    assert.deepEqual(watchTrigger("The test beast hits a creature with a jaws Strike"), { event: "own-strike", reaction: true, on: ["success", "criticalSuccess"], strike: "jaws" });
    assert.deepEqual(watchTrigger("A creature hits the test flock with an attack roll"), { event: "hit-by", reaction: true, melee: false });
    assert.deepEqual(watchTrigger("A creature hits the test liar with a ranged Strike or a ranged spell attack roll"), { event: "hit-by", reaction: true, melee: false, ranged: true });
    assert.deepEqual(watchTrigger("A creature at least 10 feet away from the test drake targets them with an attack"), { event: "targeted-by", reaction: true, any: true, attack: true, from: 10 });
    assert.deepEqual(watchTrigger("A creature fails a Will save against a spell or effect created by the test brain"), { event: "foe-failed-save", reaction: true, save: "will" });
    assert.deepEqual(watchTrigger("The test dragon rolls initiative"), { event: "initiative", reaction: true });
    assert.deepEqual(watchTrigger("A living creature within 30 feet of the test eater dies"), { event: "nearby-death", reaction: true, within: 30, living: true, dies: true });
    assert.deepEqual(watchTrigger("A creature adjacent to the test brawler is reduced to 0 Hit Points"), { event: "nearby-death", reaction: true, within: 5 });
    assert.equal(watchTrigger("A creature enters the marked area"), null);
    // On a plan that plays: the trigger added; a free action's, free.
    const plan = compileMonsterAbility(ability("Test Detain", "<p><strong>Trigger</strong> The test warden hits a creature with a weapon Strike</p><hr /><p><strong>Effect</strong> The test warden casts an innate @UUID[Compendium.pf2e.spells-srd.Item.ksLCg62cLOojw3gN]{Planar Tether} spell on the creature.</p>", "free"), { actor: { name: "Test Warden", type: "npc" } });
    assert.deepEqual([plan.builtin, plan.trigger], ["cast-spell", { event: "own-strike", reaction: true, on: ["success", "criticalSuccess"], free: true }]);
    // A ranged hit only (Deflecting Lie).
    assert.deepEqual([hitSetsOff({ event: "hit-by", ranged: true }, { outcome: "success", ranged: false }), hitSetsOff({ event: "hit-by", ranged: true }, { outcome: "success", ranged: true })], [false, true]);
});
