import test from "node:test";
import assert from "node:assert/strict";

import { compileMonsterAbility } from "../src/compiler/index.js";
import { readReactions } from "../src/compiler/passive-rules.js";
import { initiativeSkills } from "../src/compiler/initiative.js";
import { reactionCount, reactionOpen } from "../src/live/reactions.js";

// Multiple reactions, initiative skills (2026-10-13, batch 302; the user's calls: "Expand reactions and track monsters with multiple
// reactions", "use different initiative skills such as deception if they have a passive mentioning it").
const item = (name, html, type = "passive") => ({ type: "action", name, system: { slug: null, actionType: { value: type }, actions: { value: null }, traits: { value: [] }, description: { value: html }, rules: [] } });

test("extra reactions in more words: each round, one per trigger, a head each from its stat block, either of two, not with a state (batch 302)", () => {
    assert.deepEqual(readReactions("The test colossus gains 4 reactions each round. It can still use only one reaction per trigger."), { perRound: 4 });
    assert.deepEqual(readReactions("The test sage gets an additional reaction each round, though he still can't use more than one reaction on the same triggering action."), { perRound: 2 });
    assert.deepEqual(readReactions("The test oracle's sight gives her an additional reaction each round."), { perRound: 2 });
    assert.deepEqual(readReactions("At the start of each of its turns, the test knight receives two additional reactions it can use only to perform a Shield Block."), { extra: 2, only: "Shield Block" });
    assert.deepEqual(readReactions("The test paladin gains an additional reaction they can only use to make a Reactive Strike or to Shield Block."), { extra: 1, only: "Reactive Strike or Shield Block" });
    assert.deepEqual(readReactions("The test gourd gains an additional reaction each round that can only be used for Spill Seeds."), { extra: 1, only: "Spill Seeds" });
    // A head each beyond the first, its heads from its stat block; a number of heads in the text.
    const hydra = { name: "Test Hydra", items: [{ name: "Regrow", system: { description: { value: "<p>A test hydra ordinarily has seven heads.</p>" } } }] };
    assert.deepEqual(readReactions("The test hydra gains an extra reaction per round for each of its heads beyond the first, which it can use only to make Reactive Strikes.", hydra), { extra: 6, only: "Reactive Strikes" });
    assert.deepEqual(readReactions("The test flood gains an extra reaction per round for each of its six heads, which they can use only to make Reactive Strikes with their jaws."), { extra: 6, only: "Reactive Strikes" });
    assert.equal(readReactions("The test hydra gains an extra reaction per round for each of its heads beyond the first, which it can use only to make Reactive Strikes."), null, "heads not numbered");
    // Only with a state, or a limit not read.
    assert.equal(readReactions("While raging, the test brute gains an additional reaction each turn, usable only to make a Reactive Strike."), null);
    assert.equal(readReactions("The test golem has a number of reactions per round equal to its working limbs, which it can use only to make Reactive Strikes."), null);
    // A champion's: whichever its champion's reaction is.
    assert.deepEqual(readReactions("At the start of each of your turns, you gain an additional reaction that you can use only for your champion's reaction."), { extra: 1, only: "champion's reaction" });
});

test("a reaction that grants more of itself carries them on its plan; live, they're counted and shown (batch 302)", () => {
    const strike = compileMonsterAbility(item("Reactive Strike", "<p>The test eel gains 1 extra reaction at the start of each of its turns that it can use only to make a Reactive Strike with a tail. It can't use more than one Reactive Strike on the same triggering action. @Localize[PF2E.NPC.Abilities.Glossary.ReactiveStrike]</p>", "reaction"));
    assert.deepEqual([strike.builtin, strike.reactions], ["reactive-strike", { extra: 1, only: "Reactive Strike" }]);
    // "Reaction used (2 of 3)", "1 of 3 reactions left".
    const eel = [{ extra: 2, only: "Attacks of Opportunity" }];
    assert.deepEqual(reactionCount(eel, ["Reactive Strike"]), { total: 3, left: 2 });
    assert.deepEqual(reactionCount(eel, ["Reactive Strike", "Reactive Strike", "Tail Flick"]), { total: 3, left: 0 });
    assert.deepEqual(reactionCount([{ perRound: 3 }], ["Wing Buffet"]), { total: 3, left: 2 });
    assert.equal(reactionOpen(eel, ["Reactive Strike", "Reactive Strike"], "Attack of Opportunity"), true);
});

test("the skills an ability names for its creature's own initiative; not Perception, not another creature's roll (batch 302)", () => {
    assert.deepEqual(initiativeSkills(item("Ambush", "<p>On the first round of combat, if the test rogue rolls Deception or Stealth for initiative, creatures that haven't acted are off-guard to it.</p>")), ["deception", "stealth"]);
    assert.deepEqual(initiativeSkills(item("Roar", "<p>The test cat can roll Intimidation for initiative.</p>")), ["intimidation"]);
    assert.deepEqual(initiativeSkills(item("Warning", "<p><strong>Trigger</strong> The test scout is about to roll a Perception, Society, or Thievery check to determine its initiative</p>", "free")), ["society", "thievery"]);
    assert.deepEqual(initiativeSkills(item("Showtime", "<p>When the test bard rolls initiative using Performance, it gains a +1 bonus.</p>")), ["performance"]);
    assert.deepEqual(initiativeSkills(item("Old Soldier", "<p>The test veteran uses Siege Warfare Lore for initiative.</p>")), ["siege-warfare-lore"]);
    assert.deepEqual(initiativeSkills(item("Tracker", "<p>The test hunter rolls Survival in place of Perception to roll initiative.</p>")), ["survival"]);
    assert.deepEqual(initiativeSkills(item("Wary", "<p>The test guard gains a +2 bonus against all enemies rolling Stealth for initiative.</p>")), []);
});
