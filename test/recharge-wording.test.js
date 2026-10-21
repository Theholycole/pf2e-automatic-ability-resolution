import test from "node:test";
import assert from "node:assert/strict";

import { compileMonsterAbility, inline } from "../src/compiler/index.js";

// A recharge in more words, and one shared with another of the creature's abilities (2026-10-21; found by the simulator's danger study, where
// the Ash Giant used Blastboil three times a round). Synthetic wording.
const item = (name, html, actions = 1) => ({ type: "action", name, system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, rules: [], description: { value: html } } });
const passive = (name, html) => ({ type: "action", name, system: { slug: null, actionType: { value: "passive" }, actions: { value: null }, traits: { value: [] }, rules: [], description: { value: html } } });
const BURST = "The test giant bursts a blister. Each creature in a @Template[type:cone|distance:15] takes @Damage[4d6[poison]] damage (@Check[reflex|dc:25|basic] save).";

test("a recharge after \"until … in 1d4 rounds\", shared with another ability the creature has", () => {
    const burst = item("Test Burst", `<p>${BURST} This ability and test pop can't be used again until another blister grows in [[/gmr 1d4 #rounds]]{1d4 rounds}.</p>`);
    const pop = passive("Test Pop", "<p>When the test giant takes piercing damage, a blister bursts, with the effect of Test Burst.</p>");
    const plan = compileMonsterAbility(burst, { basicActions: {}, actor: { name: "Test Giant", items: [burst, pop] } });
    assert.deepEqual([plan.trigger.recharge, plan.sharesRecharge], [{ formula: "1d4", unit: "rounds" }, "Test Pop"]);
    // Without that ability on the creature: its own recharge only.
    const alone = compileMonsterAbility(burst, { basicActions: {}, actor: { name: "Test Giant", items: [burst] } });
    assert.deepEqual([alone.trigger.recharge, alone.sharesRecharge], [{ formula: "1d4", unit: "rounds" }, undefined]);
    assert.equal(inline.readRecharge("It can't use Test Burst again until a blister grows in 2 rounds."), "2");
    // A target's immunity is no recharge.
    assert.equal(inline.readRecharge("A creature can't be affected by Test Burst again until it rests in [[/gmr 1d4 #rounds]]{1d4 rounds}."), null);
});

test("a recharge whose formula is in braces", () => {
    assert.equal(inline.readRecharge("The test rat can't use Test Breath again for [[/br {1d4} #Recharge Test Breath]]{1d4 rounds}."), "1d4");
    assert.equal(inline.readRecharge("It can't use Test Arc again for [[/br {1d6}#Recharge Test Arc]]{1d6 rounds}."), "1d6");
    const arc = compileMonsterAbility(item("Test Arc", "<p>The test robot sparks, dealing @Damage[2d6[electricity]] damage to all adjacent creatures (@Check[reflex|dc:16|basic] save). It can't use Test Arc again for [[/br {1d4}#Recharge Test Arc]]{1d4 rounds}.</p>"));
    assert.deepEqual(arc.trigger.recharge, { formula: "1d4", unit: "rounds" });
});

test("\"can't use A or B again\": each shares the other's recharge, a plan made from the other's too", () => {
    const breath = item("Test Breath", "<p>The test wyrm breathes acid. Each creature in a @Template[type:line|distance:60] takes @Damage[8d6[acid]] damage (@Check[reflex|dc:28|basic] save). The test wyrm can't use Test Breath or Double Breath again for 1d4 rounds.</p>", 2);
    const double = item("Double Breath", "<p>The test wyrm uses Test Breath twice. A creature attempts only one save and can take damage only once. The test wyrm can't use Test Breath or Double Breath again for 2d4 rounds.</p>", 3);
    const actor = { name: "Test Wyrm", items: [breath, double] };
    const first = compileMonsterAbility(breath, { basicActions: {}, actor });
    const second = compileMonsterAbility(double, { basicActions: {}, actor });
    assert.deepEqual([first.trigger.recharge.formula, first.sharesRecharge], ["1d4", "Double Breath"]);
    assert.deepEqual([second.trigger.recharge.formula, second.sharesRecharge], ["2d4", "Test Breath"]);
});

test("\"it can't be used again\": once a fight", () => {
    const bow = (after) => compileMonsterAbility(item("Test Bow", `<p>The test brute fires a bone at one target within 60 feet. The target must succeed at a @Check[reflex|dc:20] save or take @Damage[(2d8+4)[piercing]] damage. ${after}</p>`));
    assert.equal(bow("Once the test bow has been used once it can't be used again.").oncePerFight, true);
    assert.equal(bow("The test bow can't be used again until the test brute grows another bone.").oncePerFight, undefined);
});
