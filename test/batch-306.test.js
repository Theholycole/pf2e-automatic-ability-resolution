import test from "node:test";
import assert from "node:assert/strict";

import { compileMonsterAbility } from "../src/compiler/index.js";

// Creature rules for the simulator (2026-10-13, batch 306; the user's call: "build everything you brought up", tier 2). Synthetic wording.
const passive = (name, text, rules = []) => ({ type: "action", name, system: { slug: null, actionType: { value: "passive" }, actions: { value: null }, traits: { value: [] }, rules, description: { value: `<p>${text}</p>` } } });
const compile = (name, text, rules) => compileMonsterAbility(passive(name, text, rules));

test("Strike extras against a condition, a damage bonus, and one against a creature it holds itself (batch 306)", () => {
    assert.deepEqual(compile("Test Pile On", "Extra dice on a held foe.", [{ key: "DamageDice", diceNumber: 2, dieSize: "d6", predicate: ["target:condition:grabbed"], selector: "strike-damage" }]),
        { builtin: "strike-extra", extras: [{ when: "condition:grabbed", dice: 2, die: 6, precision: false, type: null }] });
    assert.deepEqual(compile("Test Crush", "The test bear gains a +3 circumstance bonus to damage rolls against creatures it has Grabbed.", [{ key: "FlatModifier", predicate: ["test-crush"], selector: "strike-damage", type: "circumstance", value: 3 }, { key: "RollOption", option: "test-crush", toggleable: true, domain: "damage" }]),
        { builtin: "strike-extra", extras: [{ when: "grabbing", dice: 0, die: 0, bonus: 3, precision: false, type: null }] });
    // A toggle without those words isn't read as one it holds.
    assert.equal(compile("Test Mood", "A mood.", [{ key: "FlatModifier", predicate: ["test-mood"], selector: "strike-damage", value: 3 }, { key: "RollOption", option: "test-mood", toggleable: true }]), null);
    assert.deepEqual(compile("Test Gang", "Flanking with friends.", [{ key: "ActiveEffectLike", mode: "add", path: "system.attributes.flanking.canGangUp", value: true }]), { builtin: "passive-rules", flanking: { gangUp: true } });
});

test("creature rules from words and rules: a critical rider, swiftness, inexorable, a damage type of its choice, Hit Point shares (batch 306)", () => {
    assert.deepEqual(compile("Test Beating", "When the test thug deals damage on a critical hit, the target is Frightened 1, and the test thug can knock the target up to 10 feet away (this is forced movement)."),
        { builtin: "creature-rules", critRider: { conditions: [{ slug: "frightened", value: 1 }], push: 10 } });
    assert.deepEqual(compile("Test Shove", "When the test brute deals damage on a critical hit, the target is Frightened 1, and the test brute can push the target up to 5 feet."),
        { builtin: "creature-rules", critRider: { conditions: [{ slug: "frightened", value: 1 }], push: 5 } });
    assert.deepEqual(compile("Test Quick", "The test wisp's movement doesn't trigger reactions."), { builtin: "creature-rules", swiftness: true });
    assert.deepEqual(compile("Test Unstoppable", "It recovers from the Slowed and Stunned conditions at the end of its turn. It's also immune to penalties to its Speeds, and it ignores difficult terrain."),
        { builtin: "creature-rules", inexorable: { recover: ["slowed", "stunned"], speedPenalties: false, difficultTerrain: false } });
    const ghostly = [{ key: "RollOption", option: "test-touch", toggleable: true }, { key: "DamageAlteration", mode: "override", predicate: ["test-touch"], property: "damage-type", selectors: ["strike-damage"], value: "spirit" }];
    assert.deepEqual(compile("Test Touch", "Each time it makes a Strike, the test ghost can choose to deal spirit damage instead of the normal physical damage type.", ghostly), { builtin: "creature-rules", strikeTypes: ["spirit"] });
    // A bond that changes its damage type isn't a choice.
    assert.equal(compile("Test Bond", "While bonded, its Strikes change.", ghostly), null);
    assert.deepEqual(compile("Test Shed", "Below half its Hit Points, it sheds armor.", [{ key: "Resistance", type: "physical", value: 20, exceptions: ["adamantine"], predicate: [{ gte: ["hp-percent", 50] }] }, { key: "Resistance", type: "physical", value: 10, exceptions: ["adamantine"], predicate: [{ lt: ["hp-percent", 50] }] }, { key: "FlatModifier", selector: "speed", type: "circumstance", value: 10, predicate: [{ lt: ["hp-percent", 50] }] }]),
        { builtin: "creature-rules", hpRules: [{ atLeast: 50, resistances: [{ type: "physical", value: 20, exceptions: ["adamantine"] }], speed: 0 }, { below: 50, resistances: [{ type: "physical", value: 10, exceptions: ["adamantine"] }], speed: 10 }] });
});

test("creature rules: protean resistance, troops, split, attach, berserk, weapon master, a granted condition (batch 306)", () => {
    assert.deepEqual(compile("Test Anatomy", "It is immune to polymorph effects unless it is a willing target. If Blinded or Deafened, it automatically recovers at the end of its next turn.", [{ key: "ActiveEffectLike", mode: "upgrade", path: "flags.system.proteanResistance", value: 7 }]),
        { builtin: "creature-rules", protean: { value: 7, recover: ["blinded", "deafened"] }, immunities: ["polymorph"] });
    assert.deepEqual(compile("Troop Defenses", "HP 90 (4 segments); Thresholds 60 (3 segments), 30 (2 segments)"), { builtin: "creature-rules", troop: { thresholds: [{ hp: 60, segments: 3 }, { hp: 30, segments: 2 }] } });
    assert.deepEqual(compile("Troop Defenses", "@Localize[PF2E.NPC.Abilities.Glossary.TroopDefenses]"), { builtin: "creature-rules", troop: { thresholds: null } });
    assert.deepEqual(compile("Test Divide", "When the test ooze is hit by an attack that would deal slashing or piercing damage and has 10 or more HP, it splits into two identical oozes, each with half the original's HP."),
        { builtin: "creature-rules", split: { types: ["slashing", "piercing"], minHp: 10 } });
    assert.deepEqual(compile("Test Cling", "When the test leech hits a target larger than itself, its suckers attach it to that creature. The test leech is Off-Guard while attached."),
        { builtin: "creature-rules", attach: { offGuard: true } });
    assert.deepEqual(compile("Test Rampage", "If it has 30 or fewer HP at the start of its turn, the test golem must succeed at a @Check[flat|dc:5] check or go berserk. A berserk golem wildly attacks the nearest living creature."),
        { builtin: "creature-rules", berserk: { atMost: 30, dc: 5 } });
    assert.deepEqual(compile("Test Mastery", "It has its weapons' critical specialization effects.", [{ key: "CriticalSpecialization" }]), { builtin: "creature-rules", critSpec: true });
    const quickened = [{ key: "GrantItem", uuid: "Compendium.pf2e.conditionitems.Item.nlCjDvLMf2EkV2dl", inMemoryOnly: true }];
    assert.deepEqual(compile("Test Tireless", "It's permanently Quickened, and the extra action can be used only to Stride or Strike.", quickened), { builtin: "creature-rules", permanent: [{ slug: "quickened", value: null }] });
    // Not when its extra action can't Strike.
    assert.equal(compile("Test Crew", "It's permanently Quickened. It can use this extra action only to Load a siege weapon.", quickened), null);
});

test("an elemental dragon's Countered by and Fed by (batch 306)", () => {
    assert.deepEqual(compile("Countered by Fire", "If the test dragon takes fire damage, its metal is tempered. Until the end of their next turn, they take a –1 circumstance penalty to attack rolls and AC, and their jaws Strikes don't deal electricity damage."),
        { builtin: "creature-rules", elemental: [{ on: "damage", types: ["fire"], effect: { until: "end-of-next-turn", modifiers: [{ on: "attack", type: "circumstance", value: -1 }, { on: "ac", type: "circumstance", value: -1 }], jawsLose: "electricity" } }] });
    assert.deepEqual(compile("Fed by Earth", "When a test dragon is targeted by an earth spell or effect, its scales shimmer. For 1 minute, the test dragon is Concealed while flying."),
        { builtin: "creature-rules", elemental: [{ on: "targeted", traits: ["earth"], effect: { rounds: 10, conditions: [{ slug: "concealed", value: null }] } }] });
    assert.deepEqual(compile("Countered by Metal", "If the test dragon takes damage from a metal item or effect with the metal trait, they lose woodland passage until the end of their next turn."), { builtin: "no-effect" });
});
