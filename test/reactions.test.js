import test from "node:test";
import assert from "node:assert/strict";

import { blocksReactions, damageNote, degreeOf, higherAC, hitSetsOff, leftReach, offerHTML, onlyStrike, followMove, ownStrikeSetsOff, reactionRounds, withdrawMove } from "../src/live/reactions.js";

test("which Strike a reaction allows", () => {
    assert.equal(onlyStrike("Reactive Strike (Tail Only)"), "tail");
    assert.equal(onlyStrike("Reactive Strike (Jaws only)"), "jaws");
    assert.equal(onlyStrike("Reactive Strike (Special)"), null);
    assert.equal(onlyStrike("Reactive Strike"), null);
});

test("degrees of success, and what +2 AC would make of a hit", () => {
    assert.equal(degreeOf(25, 25), "success");
    assert.equal(degreeOf(35, 25), "criticalSuccess");
    assert.equal(degreeOf(24, 25), "failure");
    assert.equal(degreeOf(15, 25), "criticalFailure");
    assert.equal(degreeOf(24, 25, 20), "success", "a natural 20 one step better");
    assert.equal(degreeOf(25, 25, 1), "failure", "a natural 1 one step worse");
    assert.deepEqual(higherAC({ total: 26, dc: 25, outcome: "success" }, 2), { before: "success", after: "failure" });
    assert.deepEqual(higherAC({ total: 36, dc: 25, outcome: "criticalSuccess" }, 2), { before: "criticalSuccess", after: "success" });
    assert.equal(higherAC({ total: 30, dc: 25, outcome: "success" }, 2), null, "still a hit");
});

test("leaving a square in reach; who can't react; reaction used until its turn", () => {
    assert.ok(leftReach([true, false, false]), "stepped out of reach");
    assert.ok(leftReach([false, true, true]), "moved through its reach");
    assert.ok(!leftReach([false, false, true]), "only ended in reach");
    assert.ok(blocksReactions(["off-guard", "stunned"]));
    assert.ok(!blocksReactions(["frightened", "grabbed"]));
    assert.equal(reactionRounds(3, 1), 0, "its turn is still to come this round");
    assert.equal(reactionRounds(1, 3), 1);
});

test("the offer card: a button per Strike, a decline, and what it did", () => {
    const state = { kind: "strike", ability: { name: "Reactive Strike" }, monster: { name: "Giant Anaconda" }, target: { name: "Valeros" }, trigger: "left a square in its reach", strikes: [{ slug: "jaws", label: "Jaws" }], penalty: 0, status: "open", result: null };
    const html = offerHTML(state);
    assert.match(html, /data-aar-reaction="strike" data-slug="jaws">Jaws</);
    assert.match(html, /data-aar-reaction="decline"/);
    assert.match(offerHTML({ ...state, status: "used", result: "Giant Anaconda Strikes with Jaws." }), /<li>Giant Anaconda Strikes with Jaws\.<\/li>/);
    const ac = offerHTML({ ...state, kind: "ac", ability: { name: "Nimble Dodge" }, attack: { value: 2, before: "success", after: "failure" } });
    assert.match(ac, /\+2 AC against it turns a hit into a miss/);
});

test("Retributive Strike's offer: resist then Strike, or resist only", () => {
    const state = { kind: "retribution", ability: { name: "Retributive Strike" }, monster: { name: "Warden" }, target: { name: "Valeros" }, trigger: "damaged Guard (12)", strikes: [{ slug: "halberd", label: "Halberd" }], note: "Guard resists 8 of it (resistance 8).", retribution: { ally: { name: "Guard" }, restore: 8 }, status: "open", result: null };
    const html = offerHTML(state);
    assert.match(html, /data-aar-reaction="strike" data-slug="halberd">Resist, then Halberd</);
    assert.match(html, /data-aar-reaction="use">Resist only</);
    assert.match(html, /Guard resists 8 of it/);
    assert.doesNotMatch(offerHTML({ ...state, status: "used", result: "Guard resists 8 damage (back to 40 HP)." }), /data-aar-reaction/);
});

test("a flat-check offer after a critical hit (Resilient Form)", () => {
    const html = offerHTML({ kind: "flat", ability: { name: "Resilient Form" }, monster: { name: "Dragon" }, target: { name: "Valeros" }, trigger: "critically hit it", note: "On a success, the critical hit becomes a normal hit.", attack: { dc: 14 }, status: "open", result: null });
    assert.match(html, /data-aar-reaction="use">Roll the DC 14 flat check</);
    assert.match(html, /Valeros critically hit it/);
});

test("a reaction to a hit on the monster: which attack rolls set it off, and its offer (2026-10-10, batch 16)", () => {
    const crit = { event: "hit-by", reaction: true, melee: true, critical: true };
    assert.equal(hitSetsOff(crit, { outcome: "criticalSuccess" }), true);
    assert.equal(hitSetsOff(crit, { outcome: "success" }), false);
    assert.equal(hitSetsOff(crit, { outcome: "criticalSuccess", ranged: true }), false);
    assert.equal(hitSetsOff({ event: "hit-by", reaction: true, melee: true, unarmed: true }, { outcome: "success", unarmed: false }), false);
    assert.equal(hitSetsOff({ event: "hit-by", reaction: true, melee: false, within: 30 }, { outcome: "success", ranged: true, distance: 25 }), true);
    assert.equal(hitSetsOff({ event: "hit-by", reaction: true, melee: false, within: 30 }, { outcome: "success", ranged: true, distance: 40 }), false);
    assert.equal(hitSetsOff({ event: "hit-by", melee: true }, { outcome: "success" }), true, "a passive's too (batch 19)");
    assert.equal(damageNote({ damageTypes: ["piercing", "slashing"] }), "Only on piercing or slashing damage.");
    assert.equal(damageNote({}), null);
    const html = offerHTML({ kind: "card", ability: { name: "Shrapnel Splash" }, monster: { name: "Dragon" }, target: { name: "Valeros" }, trigger: "rolled a critical hit against it", status: "open" });
    assert.match(html, /data-aar-reaction="use">Use it</);
});

test("the attacker's choice on the offer card: a normal hit, or the critical hit and a condition (2026-10-11, batch 58)", () => {
    const state = { kind: "flat", ability: { name: "Unbidden Thoughts" }, monster: { name: "Despair Dragon" }, target: { name: "Valeros" }, trigger: "critically hit it", note: "Valeros chooses.", attack: { messageId: "x", dc: null, or: { slug: "frightened", value: 2, label: "Frightened 2" } }, status: "open", result: null };
    const html = offerHTML(state);
    assert.match(html, /data-aar-reaction="use">A normal hit</);
    assert.match(html, /data-aar-reaction="keep">The critical hit, Frightened 2</);
    assert.doesNotMatch(html, />Use it</);
});

test("the Ferocity offer names how many Hit Points it stays at (2026-10-11, batch 67)", () => {
    const state = { kind: "ferocity", ability: { name: "Mythic Ferocity" }, monster: { name: "Ogre" }, target: null, trigger: "is reduced to 0 HP", status: "open", result: null };
    assert.match(offerHTML(state), />Stay at 1 HP</);
    assert.match(offerHTML({ ...state, survive: { hp: "half", wounded: true } }), />Stay at half its HP</);
    assert.match(offerHTML({ ...state, survive: { hp: 25, wounded: false } }), />Stay at 25 HP</);
});

test("its own hit sets off a reaction only on a creature with the condition it names, and on its turn when it says so (2026-10-11, batch 69)", () => {
    const slowed = { event: "own-strike", on: ["success", "criticalSuccess"], strike: null, condition: "slowed" };
    assert.equal(ownStrikeSetsOff(slowed, { outcome: "success", strikeName: "Fist" }), false);
    assert.equal(ownStrikeSetsOff(slowed, { outcome: "success", strikeName: "Fist", conditions: ["slowed"] }), true);
    // Off-guard from flanking is the roll's option, not a condition the target has.
    const offGuard = { ...slowed, condition: "off-guard" };
    assert.equal(ownStrikeSetsOff(offGuard, { outcome: "success", strikeName: "Dagger", options: ["target:condition:off-guard"] }), true);
    assert.equal(ownStrikeSetsOff(offGuard, { outcome: "success", strikeName: "Dagger", options: [] }), false);
    // "… on its turn": not on another's; out of combat, the GM's.
    const turn = { event: "own-strike", on: ["success", "criticalSuccess"], strike: "peck", ownTurn: true };
    assert.equal(ownStrikeSetsOff(turn, { outcome: "success", strikeName: "Peck", ownTurn: false }), false);
    assert.equal(ownStrikeSetsOff(turn, { outcome: "success", strikeName: "Peck", ownTurn: true }), true);
    assert.equal(ownStrikeSetsOff(turn, { outcome: "success", strikeName: "Peck" }), true);
    // "With a melee Strike": not a ranged one.
    const melee = { event: "own-strike", on: ["success", "criticalSuccess"], strike: null, weapon: "melee" };
    assert.equal(ownStrikeSetsOff(melee, { outcome: "success", strikeName: "Longbow", options: ["item:ranged"] }), false);
    assert.equal(ownStrikeSetsOff(melee, { outcome: "success", strikeName: "Glaive", options: [] }), true);
});

test("a resistance reaction's offer gives back what it resisted (2026-10-11, batch 71)", () => {
    const html = offerHTML({ kind: "resist", ability: { name: "Liquefy" }, monster: { name: "Sea Dragon" }, target: null, trigger: "It took 31 damage", note: "Only against fire damage.", retribution: { restore: 20 }, status: "open" });
    assert.match(html, /Use it: 20 HP back/);
    assert.match(html, /Not now/);
});

test("a reaction that moves it off: its button and the GM's note (2026-10-11, batch 98)", () => {
    assert.deepEqual(withdrawMove({ move: "Step", on: "missed", safe: true }), { label: "Step away", note: "It Steps 5 feet away: move its token." });
    assert.deepEqual(withdrawMove({ move: "Fly", feet: 10, on: "approach", safe: false }), { label: "Fly away", note: "It Flies up to 10 feet away from the creature beside it: move its token." });
    assert.equal(withdrawMove({ move: "Stride", feet: 10, on: "approach", safe: true }).note, "It Strides up to 10 feet away from the creature beside it: move its token. This movement doesn't trigger reactions.");
    assert.equal(withdrawMove({ move: "Step", on: "hit", safe: true }).note, "It Steps 5 feet away: move its token. After the attack's effects.");
    assert.match(offerHTML({ kind: "move", ability: { name: "Test Skitter" }, monster: { name: "Test Beetle" }, target: { name: "Ezren" }, trigger: "missed it", move: { label: "Step away" }, status: "open" }), /Use it: Step away/);
});

test("a reaction that follows a foe moving away: its note (2026-10-11, batch 99)", () => {
    assert.deepEqual(followMove({ move: "Stride" }), { label: "Follow", note: "It Strides up to its Speed after the creature, keeping it in reach: move its token beside it." });
    assert.equal(followMove({ move: "Stride", prey: true, strike: true }).note, "Only if the creature is its hunted prey. It Strides up to its Speed after the creature, keeping it in reach: move its token beside it. If it ends in reach, it can make a Strike: roll it from its sheet.");
});

test("the recharge and critical-hit offers' buttons (2026-10-11, batch 100)", () => {
    assert.match(offerHTML({ kind: "recharge", ability: { name: "Test Revenge" }, monster: { name: "Test Hound" }, target: { name: "Valeros" }, trigger: "critically hit it", move: { label: "recharge Smoke Breath" }, status: "open" }), /Use it: recharge Smoke Breath/);
    assert.match(offerHTML({ kind: "upgrade", ability: { name: "Test Flash" }, monster: { name: "Test Giant" }, target: { name: "Valeros" }, trigger: "was hit", free: true, status: "open" }), /Use it: a critical hit/);
});

test("a skill check for a save: its button rolls that skill (2026-10-12, batch 168)", () => {
    const html = offerHTML({ kind: "save-skill", ability: { name: "Test Hum" }, monster: { name: "Toad" }, target: { name: "Toad Ally" }, trigger: "failed a will save", skill: { slug: "performance" }, attack: { total: 14, dc: 22, before: "failure" }, note: null, status: "open" });
    assert.match(html, /data-aar-reaction="use">Use it: roll Performance</);
    assert.match(html, /data-aar-reaction="decline"/);
});

test("a boost's own label: a success (2026-10-12, batch 169)", () => {
    const state = { kind: "boost", ability: { name: "Test Insight" }, monster: { name: "Seer" }, target: null, trigger: "failed a saving throw", note: "The save becomes a success: apply that result instead.", status: "open" };
    assert.match(offerHTML({ ...state, attack: { label: "a success" } }), /data-aar-reaction="use">Use it: a success</);
    assert.match(offerHTML(state), /data-aar-reaction="use">Use it: one degree better</);
});
