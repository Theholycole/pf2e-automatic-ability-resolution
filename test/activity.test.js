import test from "node:test";
import assert from "node:assert/strict";

import { compileMonsterAbility } from "../src/compiler/index.js";
import { activityRider, fitsSize, strikeMatches } from "../src/live/activity.js";
import { CORE_FAMILIES, createRegistry, validateChanges } from "../../pf2e-resolution-core/src/index.js";

const registry = createRegistry();
for (const family of CORE_FAMILIES) registry.registerFamily(family);
const action = (name, html, actions = 1) => ({ type: "action", name, system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: html } } });
const frightened = (value) => `@UUID[Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL]{Frightened ${value}}`;
const resolve = (plan, degree) => registry.resolveSync(plan, { caster: { id: "m" }, targets: [{ id: "t" }], statistic: () => ({ modifier: 0, dc: 20 }) }, { roll: () => ({ degree }), damage: () => 4 }).changes;

test("a Strike activity's results on a hit, by the Strike's degree (2026-10-10, batch 10)", () => {
    // "If they hit and deal damage, the target is Frightened 1, or Frightened 2 on a critical hit."
    const strike = compileMonsterAbility(action("Test Strike", `<p>The test guard makes a melee Strike. If they hit and deal damage, the target is ${frightened(1)}, or ${frightened(2)} on a critical hit.</p>`));
    assert.equal(strike.builtin, "strike-activity");
    const rider = activityRider(strike);
    assert.equal(rider.plan.resolution.kind, "check");
    const hit = resolve(rider.plan, "success");
    const critical = resolve(rider.plan, "criticalSuccess");
    assert.deepEqual(hit.filter((change) => change.op === "condition").map((change) => [change.target, change.slug, change.value]), [["t", "frightened", 1]]);
    assert.deepEqual(critical.filter((change) => change.op === "condition").map((change) => [change.slug, change.value]), [["frightened", 2]]);
    assert.deepEqual(validateChanges(critical), []);
    assert.deepEqual(resolve(rider.plan, "failure").filter((change) => change.op === "condition"), []);
    // "(Frightened 2 on a critical hit)" in brackets.
    const glare = compileMonsterAbility(action("Test Glare", `<p>The test captain makes a rapier Strike. If she hits and deals damage, the target is ${frightened(1)} (${frightened(2)} on a critical hit).</p>`));
    assert.deepEqual(glare.onHit.critical.map((entry) => [entry.slug, entry.value]), [["frightened", 2]]);
    // Extra damage on a hit, doubled on a critical hit.
    const bite = activityRider({ builtin: "strike-activity", source: { name: "Test Bite" }, onHit: { conditions: [], damage: ["1d6[persistent,bleed]"] } });
    assert.deepEqual(bite.plan.resolution.outcomes.success.damage.formulas, [{ formula: "1d6[persistent,bleed]" }]);
    assert.deepEqual(bite.plan.resolution.outcomes.criticalSuccess.damage.formulas, [{ formula: "2*(1d6)[persistent,bleed]" }]);
    // A save on a hit: the save's own card; nothing on a hit: no card.
    assert.ok(activityRider({ builtin: "strike-activity", onHit: { save: { resolution: { kind: "save" } }, size: "medium" } }).save);
    assert.equal(activityRider({ builtin: "strike-activity", onHit: { conditions: [], damage: [] } }), null);
    // Not with a save of its own in the sentence ("… Paralyzed … (DC 19 Fortitude negates)").
    const nerve = compileMonsterAbility(action("Test Nerve", `<p>The test agent Strikes with their fist. If they hit, the target is @UUID[Compendium.pf2e.conditionitems.Item.6uEgoh53GbXuHpTF]{Paralyzed} until the end of the agent's next turn (@Check[fortitude|dc:19] negates).</p>`));
    assert.notEqual(nerve?.builtin, "strike-activity");
});

test("which Strike is the activity's, and who fits its save", () => {
    assert.equal(strikeMatches({ strike: "jaws" }, { name: "Jaws" }), true);
    assert.equal(strikeMatches({ strike: "jaws" }, { name: "Claw" }), false);
    assert.equal(strikeMatches({ strike: null }, { name: "Claw", isRanged: false }), true);
    assert.equal(strikeMatches({ strike: null }, { name: "Javelin", isRanged: true }), false);
    assert.equal(fitsSize("med", "medium"), true);
    assert.equal(fitsSize("lg", "medium"), false);
    assert.equal(fitsSize("huge", null), true);
});

test("more Strike wordings for the simulator (batch 10): Sudden Charge, Strikes at different creatures, Swipe, Coiling Frenzy", () => {
    const charge = compileMonsterAbility(action("Test Charge", "<p>The test guard Strides twice. If they end their movement within melee reach of at least one enemy, they can make a melee Strike against that enemy.</p>", 2));
    assert.deepEqual([charge.builtin, charge.strides, charge.strike], ["charge", 2, null]);
    const gore = compileMonsterAbility(action("Test Gore", "<p>The test hare Strides twice. If it ends its movement within melee reach of at least one enemy, it makes a horn Strike against that enemy. This Strike deals an additional @Damage[1d6[persistent,bleed]] damage.</p>", 2));
    assert.deepEqual([gore.builtin, gore.strides, gore.strike, gore.onHit.damage], ["strike-activity", 2, "horn", ["1d6[persistent,bleed]"]]);
    const claws = compileMonsterAbility(action("Test Claws", "<p>The test gug makes up to four claw Strikes, each against a different target. These attacks count toward its multiple attack penalty, but the penalty doesn't increase until after it makes all its attacks.</p>", 2));
    assert.deepEqual([claws.builtin, claws.each, claws.max, claws.sameMap, claws.strikes[0]], ["multi-strike", true, 4, true, "claw"]);
    const lash = compileMonsterAbility(action("Test Lash", "<p>The test bird makes tail Strikes against two different creatures within reach. Its multiple attack penalty does not increase until it has finished both attacks.</p>"));
    assert.deepEqual([lash.each, lash.max], [true, 2]);
    const swipe = compileMonsterAbility(action("Test Swipe", "<p>The test veteran makes a melee Strike and compares the attack roll result to the AC of up to two foes, each of whom must be within their melee reach and adjacent to each other. Roll damage only once and apply it to each creature hit. A Swipe counts as two attacks for the veteran's multiple attack penalty.</p>"));
    assert.deepEqual([swipe.builtin, swipe.each, swipe.max, swipe.sameMap, swipe.strikes], ["multi-strike", true, 2, true, [null]]);
    const frenzy = compileMonsterAbility(action("Test Frenzy", "<p>The test dragon makes one claw Strike and one tail Strike in either order, each against the same target. If either Strike hits, the dragon can attempt to Grab the target with that limb as a free action. The dragon can have up to three creatures Grabbed at a time.</p>", 2));
    assert.deepEqual([frenzy.strikes, frenzy.sameTarget, frenzy.grab], [["claw", "tail"], true, true]);
    const steady = compileMonsterAbility(action("Test Steady", "<p>The test duelist makes a melee Strike. This Strike ignores their multiple attack penalty and doesn't count toward that penalty.</p>"));
    assert.deepEqual([steady.builtin, steady.noMap], ["strike-activity", true]);
});

test("an activity's card reads as the Strike against the target's AC", async () => {
    const { cardHTML, createCard, recordRoll } = await import("../src/live/card.js");
    const rider = activityRider({ builtin: "strike-activity", source: { name: "Test Strike" }, onHit: { conditions: [{ slug: "frightened", value: 1 }] } });
    const state = createCard({ plan: rider.plan, ability: { name: "Test Strike" }, source: { actorUuid: "Actor.m", name: "Test Guard" }, targets: [{ actorUuid: "Actor.v", name: "Valeros", dc: 21 }], rider: { strikeName: "Club", cost: "activity" } });
    const html = cardHTML(recordRoll(state, state.targets[0].id, { total: 30, natural: 15, degree: "success" }));
    assert.match(html, /Strike against the target(?:'|&#39;)s AC/);
    assert.match(html, /Strike 30 vs AC 21: success/);
});
