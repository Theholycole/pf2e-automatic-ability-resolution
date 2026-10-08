import test from "node:test";
import assert from "node:assert/strict";

import { disableOption, disableProgress, entered, progressKey, promptHTML, prompts, turnHTML } from "../src/live/hazards.js";

const options = [{ skill: "thievery", dc: 21, needed: 2 }, { skill: "religion", dc: 35, needed: 1 }];

test("a Disable check: matched by skill and DC, a success counts once and a critical success twice", () => {
    assert.deepEqual(disableOption(options, ["all", "check", "skill-check", "dex-based", "thievery"], 21), options[0]);
    assert.equal(disableOption(options, ["thievery"], 19), null, "a different DC");
    assert.equal(disableOption(options, ["crafting"], 21), null);
    assert.deepEqual(disableProgress(0, options[0], "success"), { count: 1, done: false });
    assert.deepEqual(disableProgress(1, options[0], "success"), { count: 2, done: true });
    assert.deepEqual(disableProgress(0, options[0], "criticalSuccess"), { count: 2, done: true });
    assert.deepEqual(disableProgress(1, options[0], "failure"), { count: 1, done: false });
    assert.equal(progressKey(options[0]), "thievery:21");
});

test("stepping into a Region: in from outside along the move; only an armed hazard prompts", () => {
    assert.ok(entered([false, false, true]));
    assert.ok(entered([false, true, false]), "through it");
    assert.ok(!entered([true, true]), "already inside");
    assert.ok(!entered([false, false]));
    assert.ok(prompts(undefined) && prompts("armed"));
    assert.ok(!prompts("spent") && !prompts("active") && !prompts("disabled"));
});

test("the cards: the GM's Fire / Not now prompt, and a complex hazard's turn", () => {
    const prompt = { card: "prompt", kind: "enter", hazard: { name: "Scythe Blades" }, creature: { name: "Valeros" }, status: "open", result: null };
    assert.match(promptHTML(prompt), /Valeros stepped into its area/);
    assert.match(promptHTML(prompt), /data-aar-hazard="fire"/);
    assert.match(promptHTML({ ...prompt, kind: "critfail" }), /critically failed to disable it/);
    assert.doesNotMatch(promptHTML({ ...prompt, status: "used", result: "Scythe Blades fires." }), /data-aar-hazard/);
    const turn = turnHTML({ card: "turn", hazard: { name: "Poisoned Dart Gallery" }, routine: "(1 action) The trap launches one dart against every creature in the gallery.", strikes: [{ slug: "poisoned-dart", label: "Poisoned Dart" }], targets: [{ name: "Valeros" }], fromRegions: true, status: "open", result: null });
    assert.match(turn, /In its area: Valeros/);
    assert.match(turnHTML({ card: "turn", hazard: { name: "Trap" }, routine: "", strikes: [], targets: [], fromRegions: false, status: "open", result: null }), /At your targets/);
    assert.match(turn, /data-aar-hazard="strike" data-slug="poisoned-dart"/);
});
