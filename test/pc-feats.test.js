import test from "node:test";
import assert from "node:assert/strict";

import { compileAbility, dcFor, fillCharacterDCs } from "../src/compiler/index.js";
import { fillCharacterNumbers } from "../src/compiler/pc-dcs.js";

// A 8th-level character: class DC 25, spell DC 27 (occult), Strength +4.
const DCS = { level: 8, class: 25, spell: 27, perception: 24, byClass: { exemplar: 26 }, byTradition: { occult: 27 }, statistics: { deception: 23 }, abilities: { str: 4, cha: 3 } };
const feat = (name, html, actions = 2) => ({ name, type: "feat", system: { description: { value: html }, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, rules: [] } });

test("a character's DCs by PF2e's slugs", () => {
    assert.equal(dcFor("class", DCS), 25);
    assert.equal(dcFor("classDC", DCS), 25);
    assert.equal(dcFor("class-spell", DCS), 27, "the higher of the two");
    assert.equal(dcFor("spell", DCS), 27);
    assert.equal(dcFor("occult", DCS), 27);
    assert.equal(dcFor("exemplar", DCS), 26);
    assert.equal(dcFor("deception", DCS), 23);
    assert.equal(dcFor("perception", DCS), 24);
    assert.equal(dcFor("mystery", DCS), null);
});

test("saves get the character's DC; a check against a target's DC and an unknown statistic stay", () => {
    assert.equal(fillCharacterDCs("@Check[reflex|against:class-spell|basic|options:area-effect]", DCS), "@Check[reflex|basic|options:area-effect|dc:27]");
    assert.equal(fillCharacterDCs("@Check[will|dc:resolve(@actor.attributes.classDC.value)]", DCS), "@Check[will|dc:25]");
    assert.equal(fillCharacterDCs("@Check[fortitude|dc:resolve(@actor.system.attributes.classOrSpellDC.value)]", DCS), "@Check[fortitude|dc:27]");
    assert.equal(fillCharacterDCs("@Check[athletics|against:fortitude]", DCS), "@Check[athletics|against:fortitude]");
    assert.equal(fillCharacterDCs("@Check[will|against:mystery]", DCS), "@Check[will|against:mystery]");
    assert.equal(fillCharacterDCs("@Check[will|dc:20]", DCS), "@Check[will|dc:20]", "a number of its own stays");
});

test("damage scaled by level or an attribute is worked out", () => {
    assert.equal(fillCharacterNumbers("@Damage[(floor(@actor.level/2)d6)[bludgeoning]|options:area-damage]", DCS), "@Damage[(4d6)[bludgeoning]|options:area-damage]");
    assert.equal(fillCharacterNumbers("@Damage[ceil(@actor.level/2)d6[sonic]]", DCS), "@Damage[4d6[sonic]]");
    assert.equal(fillCharacterNumbers("@Damage[(@actor.level+2)d8[fire]]", DCS), "@Damage[10d8[fire]]");
    assert.equal(fillCharacterNumbers("@Damage[(max(1,@actor.abilities.str.mod)+2)[fire]]", DCS), "@Damage[(6)[fire]]");
    assert.equal(fillCharacterNumbers("@Damage[(@actor.flags.pf2e.fabricate)d6[fire]]", DCS), "@Damage[(@actor.flags.pf2e.fabricate)d6[fire]]", "a flag stays");
    // PF2e's Invoke the Elements and Call Hellfire: a ternary by level, the damage type the player chose, the feat's own level.
    const chosen = { flags: { system: { rulesSelections: { changelingType: "cold" } } }, system: { level: { value: 8 } } };
    assert.equal(fillCharacterNumbers("@Damage[(ternary(gte(@actor.level,17),3,ternary(gte(@actor.level,13),2,1)))d12[@item.flags.system.rulesSelections.changelingType]]", { ...DCS, level: 14 }, chosen), "@Damage[2d12[cold]]");
    assert.equal(fillCharacterNumbers("@Damage[((floor(@item.level/2) -1 ) * 2)d6[fire]]", DCS, chosen), "@Damage[6d6[fire]]");
});

// PF2e's Fleeing Shriek (kobold ancestry feat), as the pack has it.
const FLEEING_SHRIEK = "<p><strong>Frequency</strong> once per hour</p><hr /><p>You let out an ear-piercing screech. Each creature in a @Template[emanation|distance:10] takes @Damage[ceil(@actor.level/2)d6[sonic]|options:area-damage] damage, with a @Check[fortitude|against:class-spell|basic|options:area-effect] saving throw against the higher of your class DC or spell DC. You then Stride, and this movement doesn't trigger reactions from any creature that failed or critically failed its saving throw.</p>";
// PF2e's Tectonic Stomp (deviant feat), its first paragraph.
const TECTONIC_STOMP = "<p>You cause minor tremors that topple your enemies. All creatures in a @Template[emanation|distance:30] who are standing on the ground take @Damage[(floor(@actor.level/2)d6)[bludgeoning]|options:area-damage]{1d6 bludgeoning damage for every 2 levels} you have, with a @Check[reflex|against:class-spell|basic|options:area-effect,inflicts:prone,inflicts:stunned] save. A creature that fails its save also falls @UUID[Compendium.pf2e.conditionitems.Item.Prone].</p>";

test("a character's save feat compiles with its own DC and dice", () => {
    const actor = { type: "character", system: { details: { level: { value: 8 } } } };
    assert.equal(compileAbility(feat("Fleeing Shriek", FLEEING_SHRIEK), { actor }), null, "without the character's DCs there's no number to save against");
    const shriek = compileAbility(feat("Fleeing Shriek", FLEEING_SHRIEK), { actor, dcs: DCS });
    assert.equal(shriek.resolution.kind, "save");
    assert.deepEqual([shriek.resolution.check.statistic, shriek.resolution.check.basic, shriek.resolution.check.against.value], ["fortitude", true, 27]);
    assert.equal(shriek.resolution.sharedDamage.components[0].formula, "4d6[sonic]");
    assert.deepEqual(shriek.targeting.area, { type: "emanation", value: 10 });
    const stomp = compileAbility(feat("Tectonic Stomp", TECTONIC_STOMP), { actor, dcs: DCS });
    assert.equal(stomp.resolution.sharedDamage.components[0].formula, "(4d6)[bludgeoning]");
    assert.ok(["failure", "criticalFailure"].every((degree) => stomp.resolution.outcomes[degree].effects.some((effect) => effect.slug === "prone")), "prone on a failure");
});

// Slice 2: a character's Strike feats as Strike activities (src/compiler/pc-strikes.js).
import { activityRider, strikeMatches } from "../src/live/activity.js";
import { characterStrike } from "../src/compiler/pc-strikes.js";

test("a Strike feat: its Strides, attack count, bonus and its hit's results", () => {
    const actor = { type: "character", system: { details: { level: { value: 8 } } } };
    const frightened = "@UUID[Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL]{Frightened 1}";
    const charge = compileAbility(feat("Test Charge", "<p>You rush forward with a battle cry. Stride twice, then make a melee Strike. You gain a +1 circumstance bonus to your attack roll. If the Strike hits, the target is " + frightened + ".</p>"), { actor, dcs: DCS });
    assert.equal(charge.builtin, "strike-activity");
    assert.deepEqual([charge.strides, charge.attackBonus, charge.melee, charge.anyStrike], [2, 1, true, false]);
    assert.deepEqual(charge.onHit.conditions.map((entry) => [entry.slug, entry.value]), [["frightened", 1]]);
    assert.ok(!charge.notes.some((note) => /battle cry|circumstance bonus/.test(note)), "flavour and the bonus read aren't notes");
    // PF2e's Spiritual Disruption: two attacks for the penalty, persistent damage on a hit; its stupefied's own end the GM's.
    const disruption = compileAbility(feat("Spiritual Disruption", "<p>You channel disruptive power that severs a foe's spiritual connection to their magic. Make a melee Strike. This counts as two attacks when calculating your multiple attack penalty. If the attack hits, the target takes @Damage[1d6[persistent,spirit]] damage. The target is @UUID[Compendium.pf2e.conditionitems.Item.Stupefied]{Stupefied 1} until it stops taking the persistent spirit damage.</p>"), { actor, dcs: DCS });
    assert.equal(disruption.countsAs, 2);
    assert.deepEqual(disruption.onHit.damage, ["1d6[persistent,spirit]"]);
    const rider = activityRider(disruption);
    assert.equal(rider.plan.resolution.outcomes.success.damage.formulas[0].formula, "1d6[persistent,spirit]");
    // Written-out damage: PF2e's Fatal Shot.
    const fatal = compileAbility(feat("Fatal Shot", "<p>Make a ranged Strike. On a hit, you deal an additional 10d10 precision damage.</p>"), { actor, dcs: DCS });
    assert.deepEqual([fatal.strike, fatal.onHit.damage], ["ranged", ["10d10[precision]"]]);
});

test("any Strike when the feat names none; not a feat about an ally's Strike", () => {
    assert.equal(strikeMatches({ anyStrike: true }, { name: "Longbow", isRanged: true }), true);
    assert.equal(strikeMatches({}, { name: "Longbow", isRanged: true }), false, "a monster's activity with no Strike named stays melee");
    assert.equal(characterStrike(feat("Test Order", "<p>Your ally can make a Strike. If the Strike hits, the target is @UUID[Compendium.pf2e.conditionitems.Item.Prone].</p>")), null);
});
