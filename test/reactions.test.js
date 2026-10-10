import test from "node:test";
import assert from "node:assert/strict";

import { blocksReactions, degreeOf, higherAC, leftReach, offerHTML, onlyStrike, reactionRounds } from "../src/live/reactions.js";

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
