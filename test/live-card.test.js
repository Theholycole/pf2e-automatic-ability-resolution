import test from "node:test";
import assert from "node:assert/strict";

import { allRolled, cardCheck, cardHTML, changeLines, createCard, parseIdentifier, recordRoll, rollIdentifier } from "../src/live/card.js";

const breath = {
    source: { name: "Avalanche Breath", slug: "avalanche-breath" },
    resolution: { kind: "save", check: { roll: "save", statistic: "reflex", basic: true, against: { dc: "fixed", value: 33 } } }
};
const grab = {
    source: { name: "Grab", slug: "grab" },
    resolution: { kind: "check", check: { roll: "skill", statistic: "athletics", against: { dc: "target", statistic: "fortitude" } } }
};

test("a card's check: a save against a fixed DC, or the user's check against each target's DC", () => {
    assert.deepEqual(cardCheck(breath), { kind: "save", statistic: "reflex", dc: 33, basic: true });
    assert.deepEqual(cardCheck(grab), { kind: "check", statistic: "athletics", against: "fortitude" });
    assert.equal(cardCheck({ resolution: { kind: "save", check: { roll: "save", statistic: "will", against: { dc: "spell" } } } }), null);
});

test("a card's state: targets, rolls recorded by identifier, Apply when all have rolled", () => {
    const state = createCard({ plan: breath, ability: { name: "Avalanche Breath", uuid: "Actor.x.Item.y" }, source: { actorUuid: "Actor.x", name: "Dragon" }, targets: [{ actorUuid: "Actor.a", name: "Valeros" }, { actorUuid: "Actor.b", name: "Seelah" }] });
    assert.deepEqual(state.targets.map((target) => target.id), ["t0", "t1"]);
    assert.equal(parseIdentifier(rollIdentifier("msg123", "t1")).targetId, "t1");
    assert.equal(parseIdentifier("strike.1.2"), null);
    let next = recordRoll(state, "t0", { total: 24, natural: 12, degree: "failure" });
    assert.equal(allRolled(next), false);
    assert.match(cardHTML(next), /data-aar-action="apply" data-gm-only="true" disabled/);
    next = recordRoll(next, "t1", { total: 35, natural: 18, degree: "success" });
    assert.equal(allRolled(next), true);
    const html = cardHTML(next);
    assert.match(html, /DC 33 basic Reflex save/);
    assert.match(html, /24: failure/);
    assert.doesNotMatch(html, /data-aar-action="apply" data-gm-only="true" disabled/);
    assert.equal(recordRoll(state, "t0", { total: 1, degree: "nonsense" }), state);
});

test("what Apply did, in plain lines", () => {
    const lines = changeLines([
        { op: "damage", target: "t0", instances: [{ type: "bludgeoning", amount: 24 }] },
        { op: "condition", target: "t0", slug: "grabbed", value: null },
        { op: "move", target: "t1", kind: "push", distance: 10 },
        { op: "affliction", target: "t1", data: { name: "Giant Scorpion Venom", stage: 1 } },
        { op: "effect", target: "t1", effect: { kind: "swallow", damage: "(2d8+5)[bludgeoning]", rupture: 20 } }
    ], { t0: "Valeros", t1: "Seelah" });
    assert.deepEqual(lines, ["Valeros takes 24 bludgeoning", "Valeros is grabbed", "Seelah is pushed 10 feet", "Seelah is afflicted with Giant Scorpion Venom (stage 1)", "Seelah is swallowed (grabbed and slowed 1; takes (2d8+5)[bludgeoning] at the end of each of its turns; Rupture 20)"]);
});

test("off-guard to one creature: its attacks, or only its next melee attack", () => {
    const lines = changeLines([
        { op: "condition", target: "t0", slug: "off-guard", value: null, scope: { attacker: "source", attacks: "melee", uses: 1 } },
        { op: "condition", target: "source", slug: "off-guard", value: null, scope: { attacker: "t0", attacks: "melee", uses: null } },
        { op: "condition", target: "t0", slug: "off-guard", value: null, scope: { attacker: "source", attacks: "any", uses: 1 } }
    ], { source: "Merisiel", t0: "Giant Scorpion" });
    assert.deepEqual(lines, ["Giant Scorpion is off-guard to Merisiel's next melee attack", "Merisiel is off-guard to Giant Scorpion's melee attacks", "Giant Scorpion is off-guard to Merisiel's next attack"]);
});

test("Disarm: a weakened grip has a line; a dropped weapon is named when it falls", () => {
    const lines = changeLines([
        { op: "effect", target: "t0", effect: { kind: "disarm", what: "weaken", penalty: 2 } },
        { op: "effect", target: "t0", effect: { kind: "disarm", what: "drop" } }
    ], { t0: "Seelah" });
    assert.deepEqual(lines, ["Seelah's grip is weakened (−2 to attacks with that weapon)"]);
});

test("by-hand instructions name the user and the target", () => {
    const lines = changeLines([{ op: "note", audience: "gm", target: "t0", text: "Move {target} up to 5 feet, staying within {source}'s reach (by hand).", manual: true }], { source: "Valeros", t0: "Giant Scorpion" });
    assert.deepEqual(lines, ["Move Giant Scorpion up to 5 feet, staying within Valeros's reach (by hand)."]);
});

test("a check card's row shows the user's roll against the target's DC", () => {
    const state = createCard({ plan: grab, ability: { name: "Grab" }, source: { actorUuid: "Actor.s", name: "Snake" }, targets: [{ actorUuid: "Actor.a", name: "Seelah", dc: 22 }] });
    assert.match(cardHTML(recordRoll(state, "t0", { total: 27, natural: 15, degree: "success" })), /Athletics 27 vs DC 22: success/);
});
