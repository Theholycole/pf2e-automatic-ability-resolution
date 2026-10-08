import test from "node:test";
import assert from "node:assert/strict";

import { cuttingDamage, damageRollFormula, ruptures, swallowedEffect } from "../src/live/swallow.js";

test("the Swallowed effect: grabbed and slowed 1 granted, the monster off-guard to its attacks, what it takes each turn", () => {
    const effect = swallowedEffect("aar", {
        swallow: { damage: "(2d8+5)[bludgeoning]", rupture: 20 },
        source: { actorUuid: "Scene.s.Token.m.Actor.a", tokenUuid: "Scene.s.Token.m", name: "Megalodon" },
        ability: { name: "Swallow Whole" },
        templates: { grabbed: "Compendium.pf2e.conditionitems.Item.grabbed", slowed: "Compendium.pf2e.conditionitems.Item.slowed", offGuard: "Compendium.pf2e.conditionitems.Item.offguard" },
        slug: "aar-swallow-m",
        time: { worldTime: 0 }
    });
    assert.equal(effect.name, "Swallowed by Megalodon");
    assert.deepEqual(effect.system.rules.map((rule) => `${rule.key} ${rule.flag ?? rule.slug ?? rule.selectors}`), ["GrantItem swallowGrabbed", "GrantItem swallowSlowed", "TokenMark aar-swallow-m", "EphemeralEffect strike-attack-roll"]);
    assert.deepEqual(effect.system.rules[1].alterations, [{ mode: "override", property: "badge-value", value: 1 }]);
    assert.deepEqual(effect.flags.aar.swallowed, { by: "Megalodon", byActor: "Scene.s.Token.m.Actor.a", byToken: "Scene.s.Token.m", ability: "Swallow Whole", damage: "(2d8+5)[bludgeoning]", rupture: 20, escapeDC: null });
    assert.match(effect.system.description.value, /Rupture 20/);
});

test("Rupture: piercing or slashing damage from one attack, at least the value", () => {
    const hit = [{ type: "slashing", total: 14 }, { type: "fire", total: 9 }, { type: "piercing", total: 7 }];
    assert.equal(cuttingDamage(hit), 21);
    assert.ok(ruptures(hit, 20));
    assert.ok(!ruptures(hit, 22));
    assert.ok(!ruptures([{ type: "bleed", total: 30, persistent: true }], 20));
    assert.ok(!ruptures(hit, null), "no Rupture value");
});

test("a damage formula PF2e's DamageRoll takes", () => {
    assert.equal(damageRollFormula("(2d8+5)[bludgeoning]"), "(2d8+5)[bludgeoning]");
    assert.equal(damageRollFormula("(3d10+10)[bludgeoning],2d6[fire]"), "{(3d10+10)[bludgeoning],2d6[fire]}");
    assert.equal(damageRollFormula("{1d6[fire],1d6[cold]}"), "{1d6[fire],1d6[cold]}");
});
