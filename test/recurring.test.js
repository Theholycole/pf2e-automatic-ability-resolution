import test from "node:test";
import assert from "node:assert/strict";

import { degreeResult, recurringCardHTML, recurringNote, recurringSpec, recurringWords, turnStep } from "../src/live/recurring.js";

// A new save at a creature's turns (2026-10-20, src/live/recurring.js; scripts/recurring.js plays it): duration.saveEnds / note.saveEnds.

test("the spec: the plan's own DC for a null one, its mode, timing and limits; none without a save it knows or a DC", () => {
    assert.deepEqual(recurringSpec({ save: "will", dc: null }, 25), { save: "will", dc: 25, drop: 0, timing: "end", mode: "end", alsoEnds: [], skipFirst: false, turns: 0 });
    const oil = recurringSpec({ save: "fortitude", dc: 20, mode: "escalate", escalate: { criticalFailure: 2, failure: 1, success: -1, criticalSuccess: "end" }, max: 3, rounds: 6, gate: "it took an action with the attack, manipulate or move trait this round", from: "next", timing: "end" });
    assert.deepEqual([oil.mode, oil.max, oil.rounds, oil.skipFirst, oil.gate.startsWith("it took")], ["escalate", 3, 6, true, true]);
    assert.equal(recurringSpec({ save: "will", dc: null }), null);
    assert.equal(recurringSpec({ save: "perception", dc: 20 }), null);
    assert.equal(recurringSpec({ save: "fortitude", dc: "spell" }, 31).dc, 31);
});

test("its turns: the first skipped from \"next\", then counted, done after its rounds", () => {
    const flag = recurringSpec({ save: "will", dc: 20, rounds: 2, from: "next" });
    const first = turnStep(flag);
    assert.ok(first.skip && !first.next.skipFirst);
    const second = turnStep(first.next);
    assert.ok(second.roll && second.next.turns === 1);
    const third = turnStep(turnStep(second.next).next);
    assert.ok(third.expire);
});

test("each mode's degrees: end (a success ends it, a failure lowers the DC), reduce, escalate (to its most, gone at 0 or \"end\")", () => {
    const ghast = recurringSpec({ save: "fortitude", dc: 30, drop: 1 });
    assert.deepEqual([degreeResult(ghast, "success"), degreeResult(ghast, "failure")], [{ kind: "end" }, { kind: "drop", dc: 29 }]);
    const fulu = recurringSpec({ save: "will", dc: 28, mode: "reduce" });
    assert.deepEqual(["criticalSuccess", "success", "failure"].map((degree) => degreeResult(fulu, degree).kind), ["end", "reduce", "none"]);
    const oil = recurringSpec({ save: "fortitude", dc: 20, mode: "escalate", escalate: { criticalFailure: 2, failure: 1, success: -1, criticalSuccess: "end" }, max: 3 });
    assert.deepEqual([degreeResult(oil, "criticalFailure", 2), degreeResult(oil, "failure", 3), degreeResult(oil, "success", 1), degreeResult(oil, "success", 2), degreeResult(oil, "criticalSuccess", 3)], [{ kind: "set", value: 3 }, { kind: "none" }, { kind: "end" }, { kind: "set", value: 1 }, { kind: "end" }]);
});

test("its words, on the card and the Effect; the card's gate and roll buttons", () => {
    assert.equal(recurringWords(recurringSpec({ save: "fortitude", dc: 30, drop: 1 })), "a new Fortitude save at the end of each of its turns ends it (DC 30, 1 lower each time)");
    assert.match(recurringNote(recurringSpec({ save: "will", dc: 25, mode: "reduce", timing: "start" })), /^ A new Will save at the start of each of its turns: a success takes a round off it, a critical success ends it \(DC 25\)\.$/);
    assert.match(recurringWords(recurringSpec({ save: "fortitude", dc: 20, mode: "escalate", escalate: { failure: 1, success: -1, criticalSuccess: "end" }, max: 3, rounds: 6 })), /failure \+1, success -1, critical success ends it \(at most 3\) \(DC 20\); it ends after 6 of them$/);
    const state = { name: "Kyra", ability: "Gearbinder Oil", what: "Slowed", save: "fortitude", dc: 20, gate: "it took a move action this round" };
    assert.match(recurringCardHTML({ ...state, status: "gate" }), /data-aar-recurring="yes".*data-aar-recurring="no"/);
    assert.match(recurringCardHTML({ ...state, status: "open" }), /data-aar-recurring="roll">Roll the Fortitude save</);
    assert.doesNotMatch(recurringCardHTML({ ...state, status: "done", result: "Kyra: success: it ends." }), /<button/);
});

test("2026-10-27: an escalating condition that brings another at a value (Dreaming Round's unconscious at 3)", () => {
    const flag = recurringSpec({ save: "will", dc: 20, mode: "escalate", escalate: { failure: 1, criticalFailure: 2, success: -1, atValue: { 3: "unconscious" } } });
    assert.deepEqual(degreeResult(flag, "failure", 1), { kind: "set", value: 2 });
    assert.deepEqual(degreeResult(flag, "failure", 2), { kind: "set", value: 3, then: "unconscious" });
    assert.deepEqual(degreeResult(flag, "criticalFailure", 2), { kind: "set", value: 4, then: "unconscious" });
    assert.deepEqual(degreeResult(flag, "failure", 3), { kind: "set", value: 4 }, "once only, as it gets there");
    assert.match(recurringWords(flag), /; at 3, unconscious \(DC 20\)/);
});
