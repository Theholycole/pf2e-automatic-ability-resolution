import test from "node:test";
import assert from "node:assert/strict";

import { latestReflectable, rangeFeet, reflectable, reflectedState, remainingRange } from "../src/live/reflect.js";

// (2026-10-27, the item module's Cayden's Tankard and Scale of Igroon: plan.reflect.)
const user = { actorUuid: "Actor.u", tokenUuid: "Scene.s.Token.u", name: "Valeros" };
const card = (extra = {}) => ({ kind: "resolve", status: "open", ability: { name: "Frightful Moan" }, plan: { traits: ["fear", "emotion"], targeting: { range: "60 feet" } }, check: { kind: "save", statistic: "will", dc: 25 }, targets: [{ id: "t0", actorUuid: "Actor.u", tokenUuid: "Scene.s.Token.u", name: "Valeros" }, { id: "t1", actorUuid: "Actor.k", tokenUuid: "Scene.s.Token.k", name: "Kyra" }], results: [], ...extra });

test("the card a reflection takes: open, a save or an attack at the user, of its trait or kind; the latest", () => {
    assert.equal(reflectable(card(), { trait: "fear" }, user), true);
    assert.equal(reflectable(card(), { trait: "fire" }, user), false);
    assert.equal(reflectable(card({ status: "applied" }), {}, user), false);
    assert.equal(reflectable(card({ targets: [{ id: "t0", actorUuid: "Actor.k", tokenUuid: "Scene.s.Token.k" }] }), {}, user), false);
    assert.equal(reflectable(card({ check: { kind: "automatic" } }), {}, user), false);
    // (Scale of Igroon: a line, a ray or an attack.)
    const line = card({ plan: { traits: ["fire"], targeting: { area: { type: "line", value: 60 } } } });
    assert.equal(reflectable(line, { kinds: ["line", "ray", "attack"] }, user), true);
    assert.equal(reflectable(card(), { kinds: ["line", "ray", "attack"] }, user), false);
    assert.equal(reflectable(card({ ability: { name: "Ray of Frost" } }), { kinds: ["ray"] }, user), true);
    assert.equal(reflectable(card({ check: { kind: "check", statistic: "strike", against: "ac" } }), { kinds: ["attack"] }, user), true);
    const older = { id: "a", state: card() };
    const newer = { id: "b", state: card({ plan: { traits: ["fire"] } }) };
    assert.equal(latestReflectable([older, newer], {}, user).id, "b");
    assert.equal(latestReflectable([older, newer], { trait: "fear" }, user).id, "a");
    assert.equal(latestReflectable([], {}, user), null);
});

test("what's left of its range, and the card it was taken from", () => {
    assert.deepEqual([rangeFeet({ targeting: { range: "60 feet" } }), rangeFeet({ targeting: { range: "touch" } }), rangeFeet({ targeting: { range: null, area: { type: "line", value: 120 } } }), rangeFeet({})], [60, 5, 120, Infinity]);
    assert.equal(remainingRange({ targeting: { range: "60 feet" } }, 25), 35);
    assert.equal(remainingRange({ targeting: { range: "30 feet" } }, 40), 0);
    const all = reflectedState(card(), { user, to: "creator", line: "Counteracted" });
    assert.deepEqual([all.status, all.targets.length, all.results, all.reflected], ["counteracted", 2, ["Counteracted"], [{ to: "creator", user: "Valeros" }]]);
    const rest = reflectedState(card(), { user, to: "chosen", line: "Reflected" });
    assert.deepEqual([rest.status, rest.targets.map((target) => target.name)], ["open", ["Kyra"]]);
    // (Kyra with a scale of her own: the card still hers to turn back.)
    assert.equal(reflectable(rest, {}, { actorUuid: "Actor.k", tokenUuid: "Scene.s.Token.k" }), true);
    assert.equal(reflectable(rest, {}, user), false);
    assert.equal(reflectedState(card({ targets: [card().targets[0]] }), { user, to: "chosen", line: "x" }).status, "counteracted");
});
