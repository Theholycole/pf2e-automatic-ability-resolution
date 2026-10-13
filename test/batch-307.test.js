import test from "node:test";
import assert from "node:assert/strict";

import { compileMonsterAbility } from "../src/compiler/index.js";

// Light, terrain and company for the simulator (2026-10-13, batch 307; the user's call: "build everything you brought up", tier 3).
const passive = (name, html, rules = []) => ({ type: "action", name, system: { slug: null, actionType: { value: "passive" }, actions: { value: null }, traits: { value: [] }, rules, description: { value: `<p>${html}</p>` } } });
const compile = (name, html, rules) => compileMonsterAbility(passive(name, html, rules));

test("light blindness and sunlight (batch 307)", () => {
    assert.deepEqual(compile("Light Blindness", "@Localize[PF2E.NPC.Abilities.Glossary.LightBlindness]"), { builtin: "creature-rules", lightBlindness: {} });
    assert.deepEqual(compile("Light Blindness", "Its light blindness is caused by only sunlight."), { builtin: "creature-rules", lightBlindness: { sunlightOnly: true } });
    assert.deepEqual(compile("Test Sun", "A test shade caught in sunlight is Clumsy 2 and Slowed 2 for as long as it remains in the sunlight."),
        { builtin: "creature-rules", sunlight: { conditions: [{ slug: "clumsy", value: 2 }, { slug: "slowed", value: 2 }] } });
    assert.deepEqual(compile("Test Shade Sun", "While in sunlight, a test shade is Blinded and Slowed 2."),
        { builtin: "creature-rules", sunlight: { conditions: [{ slug: "blinded", value: null }, { slug: "slowed", value: 2 }] } });
    assert.deepEqual(compile("Test Stone", "If exposed to direct sunlight, a test troll immediately becomes Slowed 1 and can't use reactions. The slowed value increases by 1 each time the test troll ends its turn in sunlight. If its actions are reduced to 0 in this way, it becomes Petrified."),
        { builtin: "creature-rules", sunlight: { conditions: [{ slug: "slowed", value: 1 }], noReactions: true, grows: true, end: "petrified" } });
});

test("terrain strides, sight, Hidden Movement and covens (batch 307)", () => {
    assert.deepEqual(compile("Test Stride", "The test treant ignores difficult terrain caused by plants."), { builtin: "creature-rules", terrainStride: ["plants"] });
    assert.deepEqual(compile("Test Wade", "The test frog ignores difficult terrain and greater difficult terrain in swamps."), { builtin: "creature-rules", terrainStride: ["swamp"] });
    assert.deepEqual(compile("Test Frost", "A test giant isn't impeded by difficult terrain caused by snow or ice, nor does it slip."), { builtin: "creature-rules", terrainStride: ["snow", "ice"] });
    assert.deepEqual(compile("Test Blend", "When the test shade is Concealed as a result of dim light, the flat check to target it has a DC of @Check[flat|dc:7], not 5."), { builtin: "creature-rules", dimConcealDC: 7 });
    assert.deepEqual(compile("Test Lurk", "If the test lurker starts its turn Undetected or Hidden to a creature, that creature is Off-Guard against the test lurker's attacks until the end of the turn."), { builtin: "creature-rules", hiddenMovement: true });
    assert.deepEqual(compile("Coven", "A test hag adds Charm to their coven's spells. @Localize[PF2E.NPC.Abilities.Glossary.Coven]"), { builtin: "creature-rules", coven: true });
});

test("a hydra's heads and its regeneration by them; a troll's Head Regrowth is nothing here (batch 307)", () => {
    assert.deepEqual(compile("Head Regrowth", "A test hydra ordinarily has five heads. A creature can attempt to sever one of the hydra's heads by specifically targeting it and dealing damage equal to the head's Hit Points. A creature can prevent this regrowth by dealing acid or fire damage to the stump, cauterizing it. Hydra Head Hit Points 15 Immunities Area Damage Weaknesses Slashing 5"),
        { builtin: "creature-rules", heads: { count: 5, hp: 15, cauterize: ["acid", "fire"], weaknesses: [{ type: "slashing", value: 5 }] } });
    assert.deepEqual(compile("Test Hydra Heads", "HP (head) 22, head regrowth Immunities area damage Weaknesses cold iron 10, slashing 10"),
        { builtin: "creature-rules", heads: { hp: 22, weaknesses: [{ type: "cold-iron", value: 10 }, { type: "slashing", value: 10 }] } });
    assert.deepEqual(compile("Hydra Regeneration", "The hydra has regeneration equal to 3 x the number of heads it has. If a hydra's body is missing any heads and the remaining stumps have not been cauterized, the hydra attempts a @Check[fortitude|immutable:true|dc:25] save after it regains Hit Points from regeneration. On a success, one uncauterized stump regrows two heads. The hydra can never grow more than double the number of heads it ordinarily has."),
        { builtin: "creature-rules", hydraRegeneration: { perHead: 3, dc: 25, perSuccess: 2, double: true } });
    assert.deepEqual(compile("Head Regrowth", "A test troll's regeneration can regrow a severed head. After regaining Hit Points from regeneration, it attempts a @Check[flat|dc:10]. On a success, a missing head is fully restored."), { builtin: "no-effect" });
});
