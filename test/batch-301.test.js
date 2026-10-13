import test from "node:test";
import assert from "node:assert/strict";

import { compileMonsterAbility } from "../src/compiler/index.js";
import { reactionOpen } from "../src/live/reactions.js";

// Passives PF2e's own rules hold, and three read from their words (2026-10-13, batch 301; the user's call: "the crash, traps and then passives").
const passive = (name, html, rules = []) => ({ type: "action", name, system: { slug: null, actionType: { value: "passive" }, actions: { value: null }, traits: { value: [] }, description: { value: html }, rules } });
const OFF_GUARD = "Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg";
const SELECTORS = ["strike-attack-roll", "spell-attack-roll", "strike-damage", "attack-spell-damage"];

test("save degrees from PF2e's AdjustDegreeOfSuccess: Evasion, Bravery (and its lower frightened), Mythic Resilience; not a predicate the simulation can't test (batch 301)", () => {
    const evasion = compileMonsterAbility(passive("Evasion", "<p>When the test thief rolls a success on a Reflex save, it gets a critical success instead.</p>", [{ key: "AdjustDegreeOfSuccess", selector: "reflex", adjustment: { success: "one-degree-better" } }]));
    assert.deepEqual(evasion, { builtin: "passive-rules", saveDegrees: [{ saves: ["reflex"], adjustment: { success: "one-degree-better" } }] });
    const bravery = compileMonsterAbility(passive("Bravery", "<p>When the test guard rolls a success on a Will save against a fear effect, it gets a critical success instead. In addition, any time it gains the @UUID[Compendium.pf2e.conditionitems.Item.x]{Frightened} condition, reduce its value by 1.</p>", [{ key: "AdjustDegreeOfSuccess", selector: "will", type: "save", predicate: ["item:trait:fear"], adjustment: { success: "one-degree-better" } }]));
    assert.deepEqual([bravery.saveDegrees, bravery.lessFrightened], [[{ saves: ["will"], adjustment: { success: "one-degree-better" }, predicate: ["item:trait:fear"] }], 1]);
    const mythic = compileMonsterAbility(passive("Mythic Resilience", "<p>Test.</p>", [{ key: "AdjustDegreeOfSuccess", selector: "saving-throw", adjustment: { all: "one-degree-better" } }, { key: "Note", selector: "will", text: "x" }]));
    assert.deepEqual(mythic.saveDegrees, [{ saves: ["fortitude", "reflex", "will"], adjustment: { all: "one-degree-better" } }]);
    // (What it inflicts, a trap's traits: never true in the simulation, so not read.)
    assert.equal(compileMonsterAbility(passive("Called", "<p>Test.</p>", [{ key: "AdjustDegreeOfSuccess", selector: "saving-throw", predicate: ["item:trait:mental", "inflicts:controlled"], adjustment: { success: "one-degree-better" } }])), null);
});

test("flanking and off-guard from PF2e's rules: All-Around Vision, Deny Advantage, Surprise Attack, Dread Striker; not a GM's toggle (batch 301)", () => {
    const vision = compileMonsterAbility(passive("All-Around Vision", "<p>Test.</p>", [{ key: "ActiveEffectLike", mode: "override", path: "system.attributes.flanking.flankable", value: false }]));
    assert.deepEqual(vision.flanking, { flankable: false });
    // (By PF2e's glossary alone.)
    assert.deepEqual(compileMonsterAbility(passive("All-Around Vision", "<p>@Localize[PF2E.NPC.Abilities.Glossary.AllAroundVision]</p>")).flanking, { flankable: false });
    const deny = compileMonsterAbility(passive("Deny Advantage", "<p>Test.</p>", [{ key: "ActiveEffectLike", mode: "override", path: "system.attributes.flanking.offGuardable", value: 6 }]));
    assert.deepEqual(deny.flanking, { offGuardable: 6 });
    assert.deepEqual(compileMonsterAbility(passive("Watchful", "<p>Test.</p>", [{ key: "ActiveEffectLike", mode: "override", path: "system.attributes.flanking.offGuardable", value: "@actor.level" }])).flanking, { offGuardable: "level" });
    const rank = { lt: ["self:participant:initiative:rank", "target:participant:initiative:rank"] };
    const surprise = compileMonsterAbility(passive("Surprise Attack", "<p>Test.</p>", [{ key: "EphemeralEffect", predicate: ["encounter:round:1", rank, { or: ["self:participant:initiative:stat:deception", "self:participant:initiative:stat:stealth"] }], selectors: SELECTORS, uuid: OFF_GUARD }]));
    assert.deepEqual(surprise.offGuardTo, [{ when: { round: 1, notActed: true, initiative: ["deception", "stealth"] }, strikes: "all", spells: true }]);
    const dread = compileMonsterAbility(passive("Dread Striker", "<p>Test.</p>", [{ key: "EphemeralEffect", predicate: [{ or: ["target:condition:confused", "target:condition:stupefied"] }], selectors: ["strike-attack-roll", "strike-damage"], uuid: OFF_GUARD }]));
    assert.deepEqual(dread.offGuardTo, [{ when: { conditions: [["confused", "stupefied"]] }, strikes: "all" }]);
    // In words alone.
    const worded = compileMonsterAbility(passive("Surprise Attacker", "<p>On the first round of combat, if the test rogue rolls Deception or Stealth for initiative, creatures that haven't acted yet are @UUID[Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg]{Off-Guard} to it.</p>"));
    assert.deepEqual(worded.offGuardTo, [{ when: { round: 1, notActed: true, initiative: ["deception", "stealth"] }, strikes: "all", spells: true }]);
    // A GM's toggle, or damage dice beside it: not read.
    assert.equal(compileMonsterAbility(passive("Terrain Edge", "<p>Test.</p>", [{ key: "RollOption", option: "terrain-edge", toggleable: true }, { key: "EphemeralEffect", predicate: ["terrain-edge"], selectors: SELECTORS, uuid: OFF_GUARD }])), null);
    assert.equal(compileMonsterAbility(passive("Agony", "<p>Test.</p>", [{ key: "EphemeralEffect", predicate: ["target:condition:frightened"], selectors: SELECTORS, uuid: OFF_GUARD }, { key: "DamageDice", selector: "strike-damage", diceNumber: 1, dieSize: "d6" }])), null);
});

test("Construct Armor from PF2e's rules: its Hardness, the AC it loses below half its Hit Points or on a critical hit (batch 301)", () => {
    const broken = [{ or: ["construct-armor", { lt: ["hp-percent", 50] }] }];
    const rules = [{ key: "RollOption", option: "construct-armor", toggleable: true }, { key: "FlatModifier", predicate: broken, selector: "ac", value: -4 }, { key: "ActiveEffectLike", mode: "override", path: "system.attributes.hardness.value", predicate: broken, value: 0 }];
    const armor = compileMonsterAbility(passive("Construct Armor (Hardness 9)", "<p>Test.</p>", rules));
    assert.deepEqual(armor.constructArmor, { hardness: 9, losesHardness: true, ac: -4, below: 50 });
    // Its Hardness from the creature's own numbers; one set only while it holds (a jar shell's).
    const statue = { name: "Test Statue", type: "npc", system: { attributes: { hardness: { value: 7 } } } };
    assert.equal(compileMonsterAbility(passive("Construct Armor", "<p>Test.</p>", rules), { actor: statue }).constructArmor.hardness, 7);
    const shell = compileMonsterAbility(passive("Jar Shell", "<p>Test.</p>", [rules[0], { ...rules[1], selector: ["ac"], value: -3 }, { key: "ActiveEffectLike", mode: "override", path: "system.attributes.hardness.value", predicate: [{ nor: ["construct-armor", { lt: ["hp-percent", 50] }] }], value: 2 }]));
    assert.deepEqual(shell.constructArmor, { hardness: 2, losesHardness: true, ac: -3, below: 50 });
    // (An AC that drops alone keeps its Hardness.)
    assert.deepEqual(compileMonsterAbility(passive("Durable Shell", "<p>Test.</p>", rules.slice(0, 2)), { actor: statue }).constructArmor, { hardness: 7, losesHardness: false, ac: -4, below: 50 });
});

test("Mobility and Extra Reaction from their words; a reaction for one thing only, and none whose limit isn't read (batch 301)", () => {
    assert.deepEqual(compileMonsterAbility(passive("Mobility", "<p>When the test sneak takes a Stride action to move half its Speed or less, that movement doesn't trigger reactions.</p>")).mobility, { moves: ["stride"] });
    assert.deepEqual(compileMonsterAbility(passive("Slither", "<p>When the test vine Strides or Climbs half its Speed or less, the move doesn't trigger reactions.</p>")).mobility, { moves: ["stride", "climb"] });
    assert.deepEqual(compileMonsterAbility(passive("Glide", "<p>The test spy's movement doesn't trigger reactions when she Strides to move half her Speed or less.</p>")).mobility, { moves: ["stride"] });
    assert.deepEqual(compileMonsterAbility(passive("Extra Reaction", "<p>The test serpent gets four reactions at the start of each of its turns.</p>")).reactions, { perRound: 4 });
    assert.deepEqual(compileMonsterAbility(passive("Time Slip", "<p>The test sage gains an additional reaction each round, though he still can't use more than one reaction on the same triggering action.</p>")).reactions, { perRound: 2 });
    assert.deepEqual(compileMonsterAbility(passive("Ready Shield", "<p>The test knight gains an additional reaction each round that can be used only for Shield Block.</p>")).reactions, { extra: 1, only: "Shield Block" });
    assert.deepEqual(compileMonsterAbility(passive("Quick Feet", "<p>The test dancer gains an additional reaction each turn that she can only use to Slip.</p>")).reactions, { extra: 1, only: "Slip" });
    // (A head each: not read.)
    assert.equal(compileMonsterAbility(passive("Many Heads", "<p>The test beast gains 2 extra reactions each round that it can use only to make Reactive Strikes. It must use a different head for each reaction.</p>")), null);
});

test("live: a monster's reactions this round — one, an Extra Reaction's count, one for a single reaction spent on it first (batch 301)", () => {
    assert.equal(reactionOpen([], []), true);
    assert.equal(reactionOpen([], ["Tail Swipe"]), false);
    assert.equal(reactionOpen([{ perRound: 3 }], ["Tail Swipe", null]), true);
    assert.equal(reactionOpen([{ perRound: 3 }], ["Tail Swipe", null, "Wing Buffet"]), false);
    // One more, for Shield Block only: spent on Shield Block first, so another reaction is still open after it.
    const knight = [{ extra: 1, only: "Shield Block" }];
    assert.equal(reactionOpen(knight, ["Shield Block"], "Reactive Strike"), true);
    assert.equal(reactionOpen(knight, ["Reactive Strike"], "Shield Block"), true);
    assert.equal(reactionOpen(knight, ["Reactive Strike"], "Riposte"), false);
    assert.equal(reactionOpen(knight, ["Reactive Strike", "Shield Block"], "Shield Block"), false);
    // (Plurals and either of two: "Attacks of Opportunity", "Cruel Mockery or Spiteful Curse".)
    assert.equal(reactionOpen([{ extra: 1, only: "Attacks of Opportunity" }], ["Tail Swipe"], "Attack of Opportunity"), true);
    assert.equal(reactionOpen([{ extra: 2, only: "Cruel Mockery or Spiteful Curse" }], ["Tail Swipe", "Cruel Mockery"], "Spiteful Curse"), true);
    // Any at all: an open one for that one only counts.
    assert.equal(reactionOpen(knight, ["Reactive Strike"]), true);
});
