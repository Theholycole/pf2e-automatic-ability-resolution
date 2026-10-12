import test from "node:test";
import assert from "node:assert/strict";

import { compileMonsterAbility } from "../src/compiler/index.js";
import { activityRider, fitsSize, followUpAsHit, followUpFits, strikeMatches } from "../src/live/activity.js";
import { resistEffects, strikeBuffEffect } from "../src/live/buff.js";
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
    // A save of its own in the sentence ("… Paralyzed … (DC 19 Fortitude negates)"): not Paralyzed on any hit, the save's failure (batch 128).
    const nerve = compileMonsterAbility(action("Test Nerve", `<p>The test agent Strikes with their fist. If they hit, the target is @UUID[Compendium.pf2e.conditionitems.Item.6uEgoh53GbXuHpTF]{Paralyzed} until the end of the agent's next turn (@Check[fortitude|dc:19] negates).</p>`));
    assert.deepEqual([nerve?.onHit?.conditions, nerve?.onHit?.save?.resolution?.outcomes?.failure?.effects?.[0]?.slug], [[], "paralyzed"]);
});

test("which Strike is the activity's, and who fits its save", () => {
    assert.equal(strikeMatches({ strike: "jaws" }, { name: "Jaws" }), true);
    assert.equal(strikeMatches({ strike: "jaws" }, { name: "Claw" }), false);
    assert.equal(strikeMatches({ strike: null }, { name: "Claw", isRanged: false }), true);
    assert.equal(strikeMatches({ strike: null }, { name: "Javelin", isRanged: true }), false);
    // "makes a ranged Strike" (batch 97).
    assert.equal(strikeMatches({ strike: "ranged" }, { name: "Crossbow", isRanged: true }), true);
    assert.equal(strikeMatches({ strike: "ranged" }, { name: "Fist", isRanged: false }), false);
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

test("a hit's results part by part, and the opening's extras (2026-10-10, batch 27)", () => {
    const prone = "@UUID[Compendium.pf2e.conditionitems.Item.j91X7x0XSomq8d60]{Prone}";
    // Extra dice with no type are the Strike's own; a condition after them.
    const thrust = compileMonsterAbility(action("Test Thrust", `<p>The test horse Strides and makes a horn Strike. If this Strike hits, it deals an additional 2d8 damage, and the target is knocked ${prone}.</p>`, 2));
    assert.deepEqual([thrust.builtin, thrust.strides, thrust.strike, thrust.onHit.damage, thrust.onHit.conditions.map((entry) => entry.slug)], ["strike-activity", 1, "horn", ["2d8[strike]"], ["prone"]]);
    // Its card: the type of the Strike that hit.
    assert.deepEqual(activityRider(thrust, { strikeType: "piercing" }).plan.resolution.outcomes.success.damage.formulas, [{ formula: "2d8[piercing]" }]);
    // Damage taken, then a condition: "On a successful attack, the target takes … damage, and is Sickened 3 from …".
    const bite = compileMonsterAbility(action("Test Bite", "<p>The test wyrm makes a jaws Strike. On a successful attack, the target takes @Damage[5d6[persistent,acid]] damage, and is @UUID[Compendium.pf2e.conditionitems.Item.fesd1n5eVhpCSS18]{Sickened 3} from the sting of the brine.</p>", 2));
    assert.deepEqual([bite.onHit.damage, bite.onHit.conditions.map((entry) => [entry.slug, entry.value])], [["5d6[persistent,acid]"], [["sickened", 3]]]);
    // Damage, then a save: both cards.
    const shock = compileMonsterAbility(action("Test Shock", "<p>The test cultist makes a Strike with a glass weapon. If the Strike hits, it deals an additional @Damage[2d6[mental]] damage, and the target must succeed at a @Check[will|dc:20] save or become @UUID[Compendium.pf2e.conditionitems.Item.TpZdFbFXNnYbLeYE]{Confused} for 1 round.</p>", 2));
    const rider = activityRider(shock);
    assert.deepEqual([shock.onHit.damage, rider.plan.resolution.outcomes.success.damage.formulas, rider.save.resolution.check.statistic], [["2d6[mental]"], [{ formula: "2d6[mental]" }], "will"]);
    // "succeed on a … save"; a move after the Strike is the GM's.
    const blow = compileMonsterAbility(action("Test Blow", "<p>The test bird makes a beak Strike. On a hit, the target must succeed on a @Check[fortitude|dc:30] save or become @UUID[Compendium.pf2e.conditionitems.Item.dfCMdR4wnpbYNTix]{Stunned 1}. After this Strike, the test bird can Fly up to half its fly Speed.</p>", 2));
    assert.equal(blow.onHit.save.resolution.check.statistic, "fortitude");
    // Two extra dice of weapon damage; a die of weapon damage and persistent bleed.
    const swing = compileMonsterAbility(action("Test Swing", "<p>The test guard makes a melee Strike. This counts as two attacks for the test guard's multiple attack penalty. If this Strike hits, they deal two extra dice of weapon damage.</p>", 2));
    assert.deepEqual([swing.extraWeaponDice, swing.countsAs], [2, 2]);
    const cut = compileMonsterAbility(action("Test Cut", "<p>The test knight makes a longsword Strike. If the Strike hits, it deals an additional die of weapon damage and 1d4 persistent bleed damage.</p>", 2));
    assert.deepEqual([cut.extraWeaponDice, cut.onHit.damage], [1, ["1d4[persistent,bleed]"]]);
    // The opening's extras: "with its gaff", a penalty, "dealing an extra … on a hit (… on a critical hit)", a bonus.
    const kick = compileMonsterAbility(action("Test Kick", "<p>The test elk bucks, making a Strike with a -2 circumstance penalty to the attack roll. If it hits, it deals an extra @Damage[1d8[bludgeoning]] damage.</p>"));
    assert.deepEqual([kick.attackBonus, kick.onHit.damage], [-2, ["1d8[bludgeoning]"]]);
    const skewer = compileMonsterAbility(action("Test Skewer", "<p>The test triton makes a trident Strike, dealing an extra @Damage[2d6[bleed]] on a hit (@Damage[4d6[bleed]] on a critical hit).</p>"));
    assert.deepEqual([skewer.strike, skewer.onHit.damage], ["trident", ["2d6[bleed]"]]);
    const lunge = compileMonsterAbility(action("Test Lunge", "<p>The test duelist Strikes with their rapier, and they gain a +1 circumstance bonus to the attack roll. If they succeed, the target takes @Damage[1d6[bleed]].</p>"));
    assert.deepEqual([lunge.strike, lunge.attackBonus, lunge.onHit.damage], ["rapier", 1, ["1d6[bleed]"]]);
    // A push on a hit, a farther one on a critical hit.
    const shove = compileMonsterAbility(action("Test Shove", "<p>The test brute makes a melee Strike. On a hit, the target is pushed back 5 feet. On a critical hit, the target is pushed back 10 feet</p>"));
    const pushes = activityRider(shove).plan.resolution.outcomes;
    assert.deepEqual([pushes.success.forcedMovement.distance, pushes.criticalSuccess.forcedMovement.distance], [5, 10]);
    // "The extra damage and frightened value are doubled on a critical hit."
    const smite = compileMonsterAbility(action("Test Smite", `<p>The test zealot makes a melee Strike. On a hit, the target takes an additional 2d8 mental damage and is ${frightened(2)}. The extra damage and frightened value are doubled on a critical hit.</p>`));
    assert.deepEqual([smite.onHit.damage, smite.onHit.critical.map((entry) => entry.value)], [["2d8[mental]"], [4]]);
    // Not: a result on a condition ("if the Strike dealt bludgeoning damage"), a duration not read.
    assert.notEqual(compileMonsterAbility(action("Test Gnash", "<p>The test beast makes a jaws Strike. On a hit, the target is @UUID[Compendium.pf2e.conditionitems.Item.xYTAsEpcJE1Ccni3]{Slowed 1} for 1 round if the Strike dealt bludgeoning damage.</p>"))?.builtin, "strike-activity");
    assert.notEqual(compileMonsterAbility(action("Test Qi", "<p>The test monk makes a fist Strike. On a hit, the creature takes @Damage[3d6[persistent,void]] damage and is @UUID[Compendium.pf2e.conditionitems.Item.MIRkyAjyBeXivMa7]{Enfeebled 2} until the persistent damage ends.</p>"))?.builtin, "strike-activity");
});

test("a skill action after the Strike's hit, and an automatic Shove (2026-10-10, batch 35)", () => {
    const charge = compileMonsterAbility(action("Test Charge", "<p>The test skeleton Strides and makes a claw Strike with a +4 circumstance bonus to damage. If the Strike hits, it attempts to [[/act demoralize]] the target.</p>", 2));
    assert.deepEqual([charge.strides, charge.damageBonus, charge.onHit.follow], [1, 4, "demoralize"]);
    assert.deepEqual(activityRider(charge), { follow: "demoralize" });
    const pin = compileMonsterAbility(action("Test Pin", "<p>The test dinosaur Strides and makes a Strike at the end of its movement. If the Strike hits, it deals damage as normal and the test dinosaur makes an Athletics check to Trip the target. This check counts toward the test dinosaur's multiple attack penalty, but the multiple attack penalty doesn't increase until after both attacks.</p>", 2));
    assert.equal(pin.onHit.follow, "trip");
    // "can automatically Shove the target, with the same benefits as the Shove action …": pushed 5 feet, 10 on a critical hit.
    const shove = compileMonsterAbility(action("Test Shove", "<p>The test guard makes a longsword Strike. If the Strike hits, the target is @UUID[Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg]{Off-Guard} until the start of the test guard's next turn, and the test guard can automatically Shove the target, with the same benefits as the Shove action (including the critical success effect if the Strike was a critical hit). If the test guard moves to follow the target, this movement doesn't trigger reactions.</p>", 2));
    assert.deepEqual([shove.onHit.push, shove.onHit.criticalPush, shove.onHit.conditions[0].duration?.expiry], [5, 10, "turn-start"]);
});

test("a follow-up's last Strike: its degree, name, range and listed riders; a hit's results with no Strike to go by (2026-10-10, batch 36)", () => {
    const need = { strike: "jaws", melee: false, on: ["success", "criticalSuccess"] };
    assert.equal(followUpFits(need, { outcome: "success", strikeName: "Jaws" }), true);
    assert.equal(followUpFits(need, { outcome: "failure", strikeName: "Jaws" }), false);
    assert.equal(followUpFits(need, { outcome: "success", strikeName: "Claw" }), false);
    assert.equal(followUpFits({ strike: null, melee: true, on: ["criticalSuccess"] }, { outcome: "criticalSuccess", strikeName: "Javelin", ranged: true }), false);
    assert.equal(followUpFits({ strike: null, melee: false, on: ["success"], listing: "push" }, { outcome: "success", strikeName: "Wing", attackEffects: ["improved-push"] }), true);
    const row = (slug, value) => ({ damage: { mode: "none", multiplier: 0, sourceComponentIds: [] }, effects: [{ kind: "condition", slug, value }] });
    const plan = { resolution: { kind: "check", check: { roll: "skill", statistic: "strike", against: { dc: "target", statistic: "ac" } }, outcomes: { criticalSuccess: row("enfeebled", 3), success: row("enfeebled", 2), failure: row("x", 0), criticalFailure: row("x", 0) } } };
    const asHit = followUpAsHit(plan);
    assert.deepEqual([asHit.resolution.check.roll, asHit.resolution.outcomes.success.effects[0].value, asHit.resolution.outcomes.criticalSuccess.effects.length], ["automatic", 2, 0]);
});

test("more damage on its own Strikes: a PF2e effect with DamageDice and FlatModifier rules, on the Strike it names (2026-10-10, batch 37)", () => {
    const strikes = [{ name: "Fangs", slug: "fangs", isRanged: false }, { name: "Claw", slug: null, isRanged: false }];
    const plan = (fields) => ({ builtin: "self-effect", actions: 1, model: { name: "Test Buff", rounds: 1 }, strike: null, melee: false, duration: { value: 1, unit: "rounds", expiry: "turn-start" }, ...fields });
    const fangs = strikeBuffEffect(plan({ damage: ["2d8[sonic]"], strike: "fangs" }), { name: "Test Buff", strikes });
    assert.deepEqual([fangs.type, fangs.system.duration, fangs.system.rules], ["effect", { value: 1, unit: "rounds", expiry: "turn-start", sustained: false }, [{ key: "DamageDice", selector: "fangs-damage", diceNumber: 2, dieSize: "d8", damageType: "sonic", label: "Test Buff" }]]);
    assert.equal(strikeBuffEffect(plan({ damage: ["1d6[fire]"], strike: "claw" }), { name: "x", strikes }).system.rules[0].selector, "claw-damage");
    assert.equal(strikeBuffEffect(plan({ damage: ["1d6[fire]"], melee: true }), { name: "x", strikes }).system.rules[0].selector, "melee-strike-damage");
    assert.deepEqual(strikeBuffEffect(plan({ damage: ["1d10[persistent,bleed]", "2[acid]", "2d8[precision]", "die"] }), { name: "x", strikes }).system.rules.map(({ label, ...rule }) => rule), [
        { key: "DamageDice", selector: "strike-damage", diceNumber: 1, dieSize: "d10", damageType: "bleed", category: "persistent" },
        { key: "FlatModifier", selector: "strike-damage", value: 2, damageType: "acid" },
        { key: "DamageDice", selector: "strike-damage", diceNumber: 2, dieSize: "d8", category: "precision" },
        { key: "DamageDice", selector: "strike-damage", diceNumber: 1 }
    ]);
    // (A Strike activity's precision damage takes the Strike's own type.)
    assert.deepEqual(activityRider({ builtin: "strike-activity", source: { name: "Test Stab" }, onHit: { conditions: [], damage: ["4d6[precision]"] } }, { strikeType: "piercing" }).plan.resolution.outcomes.success.damage.formulas, [{ formula: "4d6[precision,piercing]" }]);
    // (Batch 39: a bonus to its own AC, a FlatModifier.)
    assert.deepEqual(strikeBuffEffect(plan({ model: { name: "Test Parry", rounds: 1, modifiers: [{ on: "ac", type: "circumstance", value: 2 }] } }), { name: "Test Parry", strikes }).system.rules, [{ key: "FlatModifier", selector: "ac", type: "circumstance", value: 2, label: "Test Parry" }]);
    // (Its own switch in PF2e: the effect turns it on.)
    assert.deepEqual(strikeBuffEffect(plan({ model: { name: "Test Parry", rounds: 1, modifiers: [{ on: "ac", type: "circumstance", value: 1 }] } }), { name: "Test Parry", strikes, toggles: [{ domain: "ac", option: "test-parry" }] }).system.rules, [{ key: "RollOption", domain: "ac", option: "test-parry" }]);
    // No such Strike: none (the GM's note instead).
    assert.equal(strikeBuffEffect(plan({ damage: ["1d6[fire]"], strike: "tail" }), { name: "x", strikes }), null);
});

test("what a resistance reaction leaves on the monster: the resistance for a while, its AC lower for a day (2026-10-11, batch 71)", () => {
    const [lasting] = resistEffects({ builtin: "resist-damage", value: 20, on: ["fire"], types: ["fire"], lasts: 1 }, { name: "Liquefy" });
    assert.deepEqual([lasting.system.rules, lasting.system.duration], [[{ key: "Resistance", type: "fire", value: 20 }], { value: 1, unit: "rounds", expiry: "turn-end", sustained: false }]);
    const [ac] = resistEffects({ builtin: "resist-damage", value: 15, on: ["piercing", "slashing"], types: null, acPenalty: 2 }, { name: "Chipping Scales" });
    assert.deepEqual([ac.name, ac.system.rules, ac.system.duration.unit], ["Chipping Scales (AC)", [{ key: "FlatModifier", selector: "ac", type: "untyped", value: -2, label: "Chipping Scales" }], "days"]);
    assert.deepEqual(resistEffects({ builtin: "resist-damage", value: 5, on: ["piercing"], types: ["piercing"] }, { name: "Pincushion" }), []);
});

test("more damage on a creature already Prone (2026-10-11, batch 83)", () => {
    const stomp = { builtin: "strike-activity", source: { name: "Test Stomp" }, onHit: { conditions: [], damage: [], proneDamage: ["2d6[bleed]"] } };
    assert.equal(activityRider(stomp), null, "not on a creature standing");
    assert.deepEqual(activityRider(stomp, { targetProne: true }).plan.resolution.outcomes.success.damage.formulas, [{ formula: "2d6[bleed]" }]);
});

test("Quickened for its rolled rounds after a resistance; damage a critical hit alone brings (2026-10-12, batch 152)", () => {
    const plan = { builtin: "resist-damage", value: 20, on: ["electricity"], types: ["electricity"], quickened: "1d4" };
    const [quick] = resistEffects(plan, { name: "Test Surge", quickened: { rounds: 3, uuid: "Compendium.pf2e.conditionitems.Item.quickened", img: "q.webp" } });
    assert.deepEqual([quick.name, quick.system.rules[0].key, quick.system.rules[0].uuid, quick.system.duration.value, quick.flags["pf2e-automatic-ability-resolution"].resist, quick.img], ["Test Surge (Quickened)", "GrantItem", "Compendium.pf2e.conditionitems.Item.quickened", 3, undefined, "q.webp"]);
    assert.deepEqual(resistEffects(plan, { name: "Test Surge" }), [], "none without PF2e's condition");
    const rider = activityRider({ builtin: "strike-activity", source: { name: "Test Fan" }, onHit: { conditions: [], critical: [{ slug: "blinded", value: null, duration: null }], damage: [], criticalDamage: ["2d10[bleed]"] } });
    const outcomes = rider.plan.resolution.outcomes;
    assert.deepEqual([outcomes.criticalSuccess.damage.formulas, outcomes.criticalSuccess.effects.map((effect) => effect.slug), outcomes.success.damage.mode, outcomes.success.effects], [[{ formula: "2d10[bleed]" }], ["blinded"], "none", []]);
});

test("the Hit Points a Strike activity's hit gives back to the monster (2026-10-12, batch 153)", () => {
    const rider = activityRider({ builtin: "strike-activity", source: { name: "Test Drain" }, onHit: { conditions: [{ slug: "drained", value: 1, duration: null }], damage: [], selfHeal: 4 } });
    assert.deepEqual(rider.plan.resolution.outcomes.success.effects.map((effect) => effect.kind === "heal" ? [effect.kind, effect.amount, effect.recipient] : effect.slug), ["drained", ["heal", 4, "self"]]);
});
