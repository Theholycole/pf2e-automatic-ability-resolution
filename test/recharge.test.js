import test from "node:test";
import assert from "node:assert/strict";

import { momentumRecharges, rechargeEffect, rechargeLine, warningLine } from "../src/live/recharge.js";
import { cardHTML, createCard } from "../src/live/card.js";

test("the recharging effect: that many rounds, ending at the start of the monster's turn", () => {
    const effect = rechargeEffect("aar", { ability: { name: "Avalanche Breath" }, rounds: 3, formula: "1d4", time: { worldTime: 60, initiative: 21 } });
    assert.equal(effect.name, "Recharging: Avalanche Breath");
    assert.deepEqual(effect.system.duration, { value: 3, unit: "rounds", expiry: "turn-start", sustained: false });
    assert.deepEqual(effect.system.start, { value: 60, initiative: 21 });
    assert.deepEqual(effect.flags.aar.recharging, { ability: "Avalanche Breath", key: "avalanche breath", formula: "1d4", rounds: 3 });
    assert.equal(rechargeLine("Avalanche Breath", 1, "1d4"), "Avalanche Breath recharges in 1 round (1d4)");
    assert.equal(warningLine("Avalanche Breath", 2), "Avalanche Breath is still recharging: 2 rounds left.");
});

test("Draconic Momentum ends the recharge of the abilities it names, or of all of them", () => {
    const flags = [{ ability: "Poison Breath", key: "poison breath" }, { ability: "Spit Venom", key: "spit venom" }];
    assert.deepEqual(momentumRecharges(flags, ["Poison Breath"]), [flags[0]]);
    assert.deepEqual(momentumRecharges(flags, []), flags);
});

test("a card for an ability still recharging carries the warning", () => {
    const plan = { source: { name: "Avalanche Breath" }, resolution: { kind: "save", check: { roll: "save", statistic: "reflex", basic: true, against: { dc: "fixed", value: 33 } }, outcomes: {} } };
    const state = createCard({ plan, ability: { name: "Avalanche Breath" }, source: { actorUuid: "Actor.d", name: "Dragon" }, targets: [], warning: "Avalanche Breath is still recharging: 2 rounds left." });
    assert.match(cardHTML(state), /<p class="aar-warning">Avalanche Breath is still recharging: 2 rounds left\.<\/p>/);
});
