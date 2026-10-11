import test from "node:test";
import assert from "node:assert/strict";

import { blocksReactions, damageNote, degreeOf, higherAC, hitSetsOff, leftReach, offerHTML, onlyStrike, reactionRounds } from "../src/live/reactions.js";

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
