import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { compileAbility, compileBasicActions, compileMonsterAbility, glossarySlug, inline } from "../src/compiler/index.js";
import { CORE_FAMILIES, createRegistry, readPlan, validateChanges } from "../../pf2e-resolution-core/src/index.js";

const PACKS = `${process.env.HOME}/.local/share/FoundryVTT/Data/systems/pf2e/packs`;
const available = existsSync(`${PACKS}/actions`) && existsSync(`${PACKS}/pathfinder-monster-core`);
const readPack = async (name) => (await import("../tools/leveldb.mjs")).readDocuments(`${PACKS}/${name}`);

const registry = createRegistry();
for (const family of CORE_FAMILIES) registry.registerFamily(family);

test("inline syntax: checks, damage, templates, recharge, ranges, durations", () => {
    assert.deepEqual(inline.inlineTags("a @Check[reflex|dc:33|basic|options:area-effect] b @Check[will|dc:20]", "Check"), ["reflex|dc:33|basic|options:area-effect", "will|dc:20"]);
    const check = inline.readCheck("reflex|dc:33|basic|options:area-effect");
    assert.deepEqual([check.statistic, check.dc, check.basic, check.save], ["reflex", 33, true, true]);
    assert.equal(inline.readDamage("(3d6+21)[bludgeoning]|options:area-damage"), "(3d6+21)[bludgeoning]");
    assert.deepEqual(inline.readTemplate("cone|distance:40"), { type: "cone", value: 40 });
    assert.equal(inline.readRecharge("They can't use it again for [[/gmr 1d4 #Recharge Avalanche Breath]]{1d4 rounds}."), "1d4");
    assert.equal(inline.readRecharge("<p>It can't use Spray again for 1d6 rounds.</p>"), "1d6");
    assert.equal(inline.readRange("spits a ball up to 60 feet that explodes"), 60);
    assert.deepEqual(inline.readDuration("until the end of your next turn"), { mode: "fixed", value: 1, unit: "rounds", expiry: "turn-end", anchor: "source-turn" });
    assert.equal(inline.readDuration("before the end of your current turn").value, 0);
});

test("conditions: sentence by sentence, the actor's own, and not the ones a sentence ends", () => {
    const prone = "@UUID[Compendium.pf2e.conditionitems.Item.j91X7x0XSomq8d60]{Prone}";
    assert.deepEqual(inline.readConditions(`The target falls and lands ${prone}.`).map((e) => [e.slug, e.recipient ?? "target"]), [["prone", "target"]]);
    assert.deepEqual(inline.readConditions("You lose your balance, fall, and land prone.").map((e) => [e.slug, e.recipient]), [["prone", "self"]]);
    assert.deepEqual(inline.readConditions("You fail to grab your target. If you already had the target grabbed or restrained using a Grapple, those conditions on the target end."), []);
    assert.deepEqual(inline.readConditions("Your target is grabbed until the end of your next turn unless you move or your target Escapes.").map((e) => [e.slug, e.duration?.expiry]), [["grabbed", "turn-end"]]);
    const frightened = "@UUID[Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL]{Frightened 2}";
    const paralyzed = "@UUID[Compendium.pf2e.conditionitems.Item.6uEgoh53GbXuHpTF]{Paralyzed}";
    assert.deepEqual(inline.readConditions(`The creature is ${frightened}. Animals are also ${paralyzed} while frightened.`).map((e) => e.slug), ["frightened"], "only animals are paralyzed");
    assert.ok(inline.readImmunity("<p>Regardless of the result, creatures are temporarily immune to all griffons' Regal Shrieks for 10 minutes.</p>"));
});

test("fleeing and immunity wording: as long as it's frightened, during their next turn, frightened's own decay beside any timed condition, \"is then immune to …\"", () => {
    const frightened = (n) => `@UUID[Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL]{Frightened ${n}}`;
    const fleeing = "@UUID[Compendium.pf2e.conditionitems.Item.sDPxOjQ9kx2RZE8D]{Fleeing}";
    // Vision of Death, Dread Promise: fleeing while frightened lasts; frightened keeps its own decay.
    const lasting = inline.readConditions(`The target is ${frightened(4)} and is ${fleeing} for as long as it's frightened.`);
    assert.deepEqual(lasting.map((e) => [e.slug, e.duration]), [["frightened", null], ["fleeing", { mode: "while", condition: "frightened" }]]);
    // Gogunta's Croak: "during their next turn".
    const croak = inline.readConditions(`The creature is ${frightened(3)} and is also ${fleeing} during their next turn.`);
    assert.deepEqual(croak.find((e) => e.slug === "fleeing").duration, { mode: "fixed", value: 1, unit: "rounds", expiry: "turn-end", anchor: "source-turn" });
    assert.equal(croak.find((e) => e.slug === "frightened").duration, null);
    // "Fleeing for 1 round and Frightened 3": the round is fleeing's.
    const screech = inline.readConditions(`The creature is ${fleeing} for 1 round and ${frightened(3)}.`);
    assert.deepEqual(screech.map((e) => [e.slug, e.duration?.value ?? null]), [["fleeing", 1], ["frightened", null]]);
    // Any other timed condition beside it: the time is that condition's, frightened fades by its own rule.
    const paralyzed = "@UUID[Compendium.pf2e.conditionitems.Item.6uEgoh53GbXuHpTF]{Paralyzed}";
    const shriek = inline.readConditions(`The creature is ${frightened(2)} and ${paralyzed} for 1 round.`);
    assert.deepEqual(shriek.map((e) => [e.slug, e.duration?.value ?? null]), [["frightened", null], ["paralyzed", 1]]);
    assert.equal(inline.readConditions(`The creature is ${frightened(1)} and is then temporarily immune for 1 minute.`)[0].duration, null);
    // A time that is frightened's own: straight after it, or when it can't be reduced.
    assert.equal(inline.readConditions(`The creature is ${frightened(1)} for 1 minute.`)[0].duration.unit, "minutes");
    assert.equal(inline.readConditions(`As failure, but the creature can't reduce its frightened condition below 2 for 1 minute and is ${frightened(2)}.`).find((e) => e.slug === "frightened").duration.unit, "minutes");
    // Immunity without "temporarily", when it names this ability; not another ability's.
    const cry = inline.readImmunity("<p>Each creature in a 120-foot emanation must attempt a Will save and is then immune to the hantu denai's Terrifying Cry for 1 minute.</p>", ["Terrifying Cry", "Hantu Denai"]);
    assert.deepEqual([cry.duration, cry.degrees.length], [{ value: 1, unit: "minutes" }, 4]);
    assert.equal(inline.readImmunity("<p>All non-thatchling creatures within 30 feet take 2d10 sonic damage and become immune to all thatchlings' distracting giggle for 1 minute.</p>", ["Howl of Vengeful Fury", "Red-Hooded Thatchling"]), null);
    assert.equal(inline.readImmunity("<p>All of the creature's equipment is immune to Wasting Gaze for 24 hours.</p>", ["Wasting Gaze"]), null);
    // After which results.
    assert.equal(inline.readImmunity("<p>Whether it succeeds or fails its save, a creature is temporarily immune to Frightening Howl for 24 hours.</p>").degrees.length, 4);
    assert.deepEqual(inline.readImmunity("<p>Once a creature has succeeded at a save against the castaway's Cockamamie Rant, they are immune to its effects for 24 hours.</p>", ["Cockamamie Rant"]).degrees, ["criticalSuccess", "success"]);
    assert.deepEqual(inline.readImmunity("<p>The creature must attempt a save\nCritical Success The creature is unaffected and immune to Shake Confidence for 24 hours\nSuccess The creature is frightened 1.</p>", ["Shake Confidence"]).degrees, ["criticalSuccess"]);
});

test("saves whose results are said in sentences after them (2026-10-10)", () => {
    const fr = (n) => `@UUID[Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL]{Frightened ${n}}`;
    const action = (name, html, actionType = "action") => ({ type: "action", name, system: { slug: null, actionType: { value: actionType }, actions: { value: actionType === "action" ? 1 : null }, traits: { value: [] }, description: { value: html } } });
    const rows = (plan) => Object.fromEntries(Object.entries(plan.resolution.outcomes).map(([degree, row]) => [degree, row.effects.map((e) => `${e.slug}${e.value ? " " + e.value : ""}`).join(", ")]));
    // "On a failure, …; on a critical failure, it's …", and the bracketed critical value is the critical's only.
    const moan = compileMonsterAbility(action("Frightful Moan", `<p>The ghost laments, forcing each living creature within 30 feet to attempt a @Check[will|dc:29] save. On a failure, a creature becomes ${fr(2)} (or ${fr(3)} on a critical failure). On a success, a creature is temporarily immune for 1 minute.</p>`));
    assert.deepEqual(rows(moan), { criticalSuccess: "", success: "", failure: "frightened 2", criticalFailure: "frightened 3" });
    const arrival = compileMonsterAbility(action("Grizzly Arrival", `<p>Each enemy within 30 feet must attempt a @Check[will|dc:23] save. On a failure, the creature is ${fr(2)}; on a critical failure, it's ${fr(4)}.</p>`));
    assert.deepEqual([rows(arrival).failure, rows(arrival).criticalFailure], ["frightened 2", "frightened 4"]);
    // "…save, becoming X on a failure. On a critical failure, it's also Fleeing…": the critical adds.
    const frighten = compileMonsterAbility(action("Frighten", `<p>Each creature within 30 feet must attempt a @Check[will|dc:21] save, becoming ${fr(2)} on a failure. On a critical failure, it's also @UUID[Compendium.pf2e.conditionitems.Item.sDPxOjQ9kx2RZE8D]{Fleeing} for as long as it's frightened.</p>`));
    assert.deepEqual([rows(frighten).failure, rows(frighten).criticalFailure], ["frightened 2", "frightened 2, fleeing"]);
    // "If it fails, …, and if it critically fails, it is instead …"; "must succeed a … saving throw or fall Prone".
    const gaze = compileMonsterAbility(action("Paralyzing Gaze", `<p>The target must attempt a @Check[fortitude|dc:35] save. If it fails, it's @UUID[x]{Slowed 1} for 1 round, and if it critically fails, it is instead @UUID[x]{Paralyzed} for 1 round.</p>`));
    assert.deepEqual([rows(gaze).failure, rows(gaze).criticalFailure], ["slowed 1", "paralyzed"]);
    const tide = compileMonsterAbility(action("Tripping Tide", `<p>All creatures in a 20-foot emanation must succeed a @Check[reflex|dc:37] saving throw or fall @UUID[x]{Prone}.</p>`));
    assert.equal(rows(tide).failure, "prone");
    // A critical naming only some of the failure's conditions swaps those and keeps the rest; "plus" adds.
    const wake = compileMonsterAbility(action("Blood Wake", `<p>Each creature within 30 feet must attempt a @Check[will|dc:37] save. On a failure, the creature becomes ${fr(2)} (${fr(4)} on a critical failure) and @UUID[x]{Stunned 1}.</p>`));
    assert.deepEqual([rows(wake).failure, rows(wake).criticalFailure], ["frightened 2, stunned 1", "frightened 4, stunned 1"]);
    const stench = compileMonsterAbility(action("Odor", `<p>A creature starting its turn within 10 feet must succeed at a @Check[fortitude|dc:26] save or become @UUID[x]{Sickened 1} (plus @UUID[x]{Slowed 1} as long as it's sickened on a critical failure).</p>`));
    assert.deepEqual(stench.resolution.outcomes.criticalFailure.effects.map((e) => [e.slug, e.value, e.duration?.condition ?? null]), [["sickened", 1, null], ["slowed", 1, "sickened"]]);
    // "On a success, …" counts too.
    const screech = compileMonsterAbility(action("Screech", `<p>Each creature within 80 feet must attempt a @Check[will|dc:20] save. On a success, the creature gains the ${fr(1)} condition; on a failure, the creature gains the ${fr(2)} condition.</p>`));
    assert.equal(rows(screech).success, "frightened 1");
    // Left out: the monster saving for itself, a result about the monster, results by creature type or the target's state.
    assert.equal(compileMonsterAbility(action("Vulnerable to Gentle Repose", `<p>The golem attempts a @Check[fortitude|dc:20] save. If it fails, it is @UUID[x]{Immobilized}.</p>`, "passive")), null);
    assert.equal(compileMonsterAbility(action("Focus Gaze", `<p>The target must attempt a @Check[will|dc:21] save. On a failed save, the evangelist is @UUID[x]{Concealed} from the creature.</p>`)), null);
    assert.equal(compileMonsterAbility(action("Distraction", `<p>Each creature in the swarm must attempt a @Check[will|dc:17] save. Humanoids that fail this save are @UUID[x]{Stunned 1}. Animals are ${fr(2)} on a failure.</p>`)), null);
    // The monster's own healing isn't damage to the target.
    const peek = compileMonsterAbility(action("Draining Peek", `<p>The target must attempt a @Check[fortitude|dc:17] save. If it fails, the monster regains @Damage[3[healing]] Hit Points, and the target becomes @UUID[x]{Drained 1}.</p>`, "reaction"));
    assert.equal(peek.resolution.outcomes.failure.damage.mode, "none");
    // The "as long as it's sickened" phrase names a duration, not another condition.
    assert.deepEqual(inline.readConditions("The creature is @UUID[Compendium.pf2e.conditionitems.Item.3uh1r86TzbQvosxv]{Doomed 1} for as long as it is sickened.").map((e) => [e.slug, e.duration?.condition]), [["doomed", "sickened"]]);
});

test("basic actions from PF2e's actions pack", { skip: !available && "PF2e's packs not found" }, async () => {
    const basics = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    assert.deepEqual(Object.keys(basics).sort(), ["administer-first-aid", "create-a-diversion", "demoralize", "disarm", "escape", "feint", "grapple", "reposition", "shove", "trip"]);
    assert.deepEqual(basics.disarm.resolution.outcomes.criticalSuccess.effects, [{ kind: "disarm", what: "drop" }]);
    assert.deepEqual(basics.disarm.resolution.outcomes.criticalFailure.effects.map((e) => `${e.recipient} ${e.slug} ${e.duration.expiry}`), ["self off-guard turn-start"]);
    assert.deepEqual(basics.feint.resolution.outcomes.success.effects[0].scope, { against: "actor", attacks: "melee", uses: 1 });
    assert.equal(basics.feint.resolution.outcomes.criticalFailure.effects[0].recipient, "self");
    assert.deepEqual(basics["create-a-diversion"].resolution.check.against, { dc: "target", statistic: "perception" });
    assert.deepEqual(basics["administer-first-aid"].resolution.check, { roll: "skill", statistic: "medicine", against: { dc: "target", statistic: "stabilize" } });
    assert.deepEqual(basics.trip.resolution.check, { roll: "skill", statistic: "athletics", against: { dc: "target", statistic: "reflex" } });
    assert.deepEqual(basics.trip.resolution.outcomes.criticalFailure.effects.map((e) => `${e.recipient} ${e.slug}`), ["self prone"]);
    assert.match(basics.reposition.resolution.outcomes.criticalSuccess.manualInstructions[0], /^Move \{target\} up to 10 feet/);
    assert.match(basics.reposition.resolution.outcomes.criticalFailure.manualInstructions[0], /^\{target\} may move \{source\} up to 5 feet/);
    assert.deepEqual(basics.grapple.resolution.outcomes.success.effects.map((e) => e.slug), ["grabbed"]);
    assert.deepEqual(basics.grapple.resolution.outcomes.criticalSuccess.effects.map((e) => e.slug), ["restrained"]);
    assert.deepEqual(basics.grapple.resolution.outcomes.failure.effects, []);
    assert.equal(basics.shove.resolution.outcomes.criticalSuccess.forcedMovement.distance, 10);
    assert.deepEqual(basics.demoralize.resolution.outcomes.criticalSuccess.effects.map((e) => `${e.slug} ${e.value}`), ["frightened 2"]);
    assert.ok(basics.demoralize.trigger.immunity);
    for (const plan of Object.values(basics)) assert.deepEqual(registry.familyFor(plan.resolution.kind).gaps(readPlan(plan)), [], plan.source.name);
});

test("monster abilities: riders, Constrict, Frightful Presence, a breath weapon, Ferocity", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const npcs = (await readPack("pathfinder-monster-core")).filter((doc) => doc.collection === "actors" && doc.type === "npc");
    const ability = (creature, name) => npcs.find((npc) => npc.name === creature).items.find((item) => item.name.startsWith(name));

    const grab = compileMonsterAbility(ability("Giant Anaconda", "Grab"), { basicActions });
    assert.deepEqual(grab.trigger, { event: "strike", on: ["success", "criticalSuccess"], attackEffect: "grab", cost: "action", map: false });
    assert.equal(grab.resolution.check.against.statistic, "fortitude");
    const improved = compileMonsterAbility(ability("Tor Linnorm", "Improved Grab"), { basicActions });
    assert.equal(improved.trigger.cost, "free");
    // "Push 15 feet": 15 on a success, and no less on a critical success (Shove's own is 10).
    const push = compileMonsterAbility(ability("Megalodon", "Push"), { basicActions });
    assert.deepEqual([push.resolution.outcomes.success.forcedMovement.distance, push.resolution.outcomes.criticalSuccess.forcedMovement.distance], [15, 15]);

    const greater = compileMonsterAbility(ability("Giant Anaconda", "Greater Constrict"));
    assert.equal(greater.targeting.grabbed, true, "only creatures it holds");
    assert.deepEqual(greater.resolution.outcomes.failure.effects.map((e) => e.slug), ["unconscious"]);
    const constrict = compileMonsterAbility(ability("Sargassum Heap", "Constrict"));
    assert.deepEqual(constrict.resolution.check, { roll: "save", statistic: "fortitude", basic: true, against: { dc: "fixed", value: 23 } });
    assert.equal(constrict.targeting.grabbed, true);

    const presence = compileMonsterAbility(ability("Adamantine Dragon (Adult)", "Frightful Presence"));
    assert.equal(presence.trigger.event, "aura");
    assert.deepEqual(presence.targeting.area, { type: "emanation", value: 90 });
    assert.deepEqual(presence.resolution.outcomes.criticalFailure.effects.map((e) => `${e.slug} ${e.value}`), ["frightened 4"]);

    const breath = compileMonsterAbility(ability("Adamantine Dragon (Adult)", "Avalanche Breath"));
    assert.deepEqual(breath.targeting.area, { type: "cone", value: 40 });
    assert.deepEqual(breath.trigger.recharge, { formula: "1d4", unit: "rounds" });
    assert.deepEqual(breath.resolution.check.against, { dc: "fixed", value: 33 });
    assert.equal(breath.activation.time, "2");

    assert.deepEqual(compileMonsterAbility(ability("Boar", "Ferocity")), { builtin: "ferocity" });
    assert.deepEqual(compileMonsterAbility(ability("Yeti", "Rend")), { builtin: "rend", strike: "Claw" });
    assert.equal(glossarySlug(ability("Megalodon", "Swallow Whole")), "swallow-whole");
});

test("Swallow Whole, Trample and Stench", { skip: !available && "PF2e's packs not found" }, async () => {
    const npcs = (await readPack("pathfinder-monster-core")).filter((doc) => doc.collection === "actors" && doc.type === "npc");
    const npc = (name) => npcs.find((entry) => entry.name === name);
    const ability = (creature, name) => npc(creature).items.find((item) => item.name.startsWith(name));

    const swallow = compileMonsterAbility(ability("Megalodon", "Swallow Whole"));
    assert.deepEqual(swallow.resolution.check, { roll: "skill", statistic: "athletics", against: { dc: "target", statistic: "reflex" } });
    assert.equal(swallow.targeting.grabbed, true, "only a creature it holds");
    assert.deepEqual(swallow.resolution.outcomes.success.effects, [{ kind: "swallow", damage: "(2d8+5)[bludgeoning]", rupture: 20, size: "huge" }]);
    assert.deepEqual(swallow.resolution.outcomes.success.damage.formulas, [{ formula: "(2d8+5)[bludgeoning]" }], "the damage when first swallowed");
    const swallowed = registry.resolveSync(swallow, { caster: { id: "m" }, targets: [{ id: "t" }], statistic: () => ({ modifier: 10, dc: 20 }) }, { roll: () => ({ degree: "success" }), damage: () => 14 });
    assert.deepEqual(swallowed.changes.map((change) => change.op), ["damage", "effect"]);

    assert.equal(compileMonsterAbility(ability("Elephant", "Trample")), null, "the Strike's damage needs the creature");
    const trample = compileMonsterAbility(ability("Elephant", "Trample"), { actor: npc("Elephant") });
    assert.deepEqual(trample.targeting.trample, { size: "large", strides: 2 });
    assert.deepEqual(trample.resolution.check, { roll: "save", statistic: "reflex", basic: true, against: { dc: "fixed", value: 24 } });
    assert.match(trample.resolution.sharedDamage.components[0].formula, /^\(2d\d+\+\d+\)\[bludgeoning\]$/);
    assert.equal(trample.activation.time, "3");

    const stench = compileMonsterAbility(ability("Ghoul Soldier", "Stench"));
    assert.deepEqual([stench.trigger.event, stench.targeting.area.value], ["aura", 10]);
    assert.deepEqual(stench.resolution.outcomes.criticalFailure.effects.map((e) => `${e.slug} ${e.value}`), ["sickened 1", "slowed 1"]);
    for (const plan of [swallow, trample, stench]) assert.deepEqual(registry.familyFor(plan.resolution.kind).gaps(readPlan(plan)), [], plan.source.name);
});

test("rules the simulator plays itself: extra Strike damage, save bonuses, regeneration, Draconic Frenzy, Pounce, Draconic Momentum", { skip: !available && "PF2e's packs not found" }, async () => {
    const npcs = [...(await readPack("pathfinder-monster-core")), ...(await readPack("pathfinder-monster-core-2"))].filter((doc) => doc.collection === "actors" && doc.type === "npc");
    const ability = (creature, name) => compileMonsterAbility(npcs.find((npc) => npc.name === creature).items.find((item) => item.name.startsWith(name)));
    assert.deepEqual(ability("Wererat", "Sneak Attack"), { builtin: "strike-extra", extras: [{ when: "off-guard", dice: 1, die: 6, precision: true, type: null }] });
    assert.deepEqual(ability("Hyaenodon", "Pack Attack").extras.map((extra) => extra.when), ["pack"]);
    assert.deepEqual(ability("Yamaraj", "+1 Status to All Saves vs. Magic"), { builtin: "save-bonus", bonuses: [{ saves: ["fortitude", "reflex", "will"], value: 1, type: "status", predicate: ["item:magical"] }] });
    assert.deepEqual(ability("Tor Linnorm", "Regeneration"), { builtin: "regeneration", value: 20, deactivatedBy: ["cold-iron"] });
    assert.deepEqual(ability("Yamaraj", "Fast Healing"), { builtin: "fast-healing", value: 20 });
    assert.equal(ability("Earth Scamp", "Fast Healing"), null, "only while underground");
    assert.deepEqual(ability("Frost Drake", "Draconic Frenzy"), { builtin: "multi-strike", actions: 2, strikes: ["fangs", "fangs", "tail"] });
    assert.deepEqual(ability("Smilodon", "Pounce"), { builtin: "charge", actions: 1, strides: 1, strike: null });
    assert.deepEqual(ability("Horned Dragon (Young)", "Draconic Momentum"), { builtin: "momentum", recharges: ["Poison Breath"] });
});

test("every Monster Core 1-2 and NPC Core ability compiles and resolves", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    let plans = 0;
    const failures = [];
    for (const pack of ["pathfinder-monster-core", "pathfinder-monster-core-2", "pathfinder-npc-core"]) {
        for (const npc of (await readPack(pack)).filter((doc) => doc.collection === "actors" && doc.type === "npc")) {
            for (const item of npc.items.filter((entry) => entry.type === "action")) {
                try {
                    const plan = compileAbility(item, { basicActions });
                    if (!plan?.resolution) continue;
                    plans++;
                    const context = { caster: { id: "m", side: "foes" }, targets: [{ id: "t", side: "party" }], statistic: () => ({ modifier: 10 }), allied: () => false };
                    const issues = validateChanges(registry.resolveSync(plan, context, { roll: () => ({ degree: "criticalFailure" }) }).changes);
                    if (issues.length) failures.push(`${npc.name} / ${item.name}: ${issues[0].message}`);
                } catch (error) {
                    failures.push(`${npc.name} / ${item.name}: ${error.message}`);
                }
            }
        }
    }
    assert.deepEqual(failures.slice(0, 10), []);
    assert.ok(plans >= 900, `${plans} plans`);
});

test("afflictions: stages read into damage, conditions and durations; a Strike delivers them", { skip: !available && "PF2e's packs not found" }, async () => {
    const npcs = [...(await readPack("pathfinder-monster-core")), ...(await readPack("pathfinder-monster-core-2"))].filter((doc) => doc.collection === "actors" && doc.type === "npc");
    const ability = (creature, name) => compileMonsterAbility(npcs.find((npc) => npc.name === creature).items.find((item) => item.name === name));
    const venom = ability("Giant Scorpion", "Giant Scorpion Venom");
    assert.deepEqual(venom.trigger, { event: "strike", on: ["success", "criticalSuccess"], attackEffect: "giant-scorpion-venom", cost: "free", map: false });
    assert.deepEqual(venom.resolution.check, { roll: "save", statistic: "fortitude", basic: false, against: { dc: "fixed", value: 18 } });
    assert.deepEqual([venom.resolution.outcomes.failure.affliction.stage, venom.resolution.outcomes.criticalFailure.affliction.stage], [1, 2]);
    const handoff = venom.resolution.afflictionHandoff;
    assert.deepEqual(handoff.maximumDuration, { value: 6, unit: "rounds" });
    assert.deepEqual(handoff.stages.map((stage) => [stage.damage.join(), stage.conditions.map((c) => `${c.slug} ${c.value}`).join(), stage.duration.value, stage.duration.unit]), [
        ["1d10[poison]", "enfeebled 1", 1, "rounds"],
        ["2d10[poison]", "enfeebled 1", 1, "rounds"],
        ["(2d10)[poison]", "enfeebled 2", 1, "rounds"]
    ], "plain words as well as links");
    // The coatls' venom has a second block against unholy creatures: the first one only.
    assert.equal(ability("Mix Coatl", "Mix Coatl Venom").resolution.afflictionHandoff.stages.length, 3);
    // The core hands it on as an "affliction" change.
    const result = registry.resolveSync(venom, { caster: { id: "m" }, targets: [{ id: "t" }], statistic: () => ({ modifier: 0 }) }, { roll: () => ({ degree: "failure" }) });
    assert.deepEqual(result.changes.map((change) => [change.op, change.data?.stage]), [["affliction", 1]]);
    assert.deepEqual(registry.familyFor("save").gaps(readPlan(venom)), []);
});

test("saves whose outcomes are prose: \"must succeed at a save or …\", \"A creature that fails its save is …\"", { skip: !available && "PF2e's packs not found" }, async () => {
    const npcs = [...(await readPack("pathfinder-monster-core")), ...(await readPack("pathfinder-monster-core-2")), ...(await readPack("pathfinder-npc-core"))].filter((doc) => doc.collection === "actors" && doc.type === "npc");
    const ability = (creature, name) => compileMonsterAbility(npcs.find((npc) => npc.name === creature).items.find((item) => item.name === name));
    const rows = (plan) => Object.fromEntries(Object.entries(plan.resolution.outcomes).map(([degree, row]) => [degree, `${row.damage.mode === "shared" ? `x${row.damage.multiplier}` : row.damage.mode === "formulas" ? row.damage.formulas.map((f) => f.formula).join("+") : "-"} ${row.effects.map((e) => `${e.slug}${e.value ?? ""}${e.duration ? `/${e.duration.value} ${e.duration.unit}` : ""}`).join(",")}`.trim()]));
    // A breath: damage in the save's sentence is halved on a success; the conditions follow from the next sentence.
    assert.deepEqual(rows(ability("Omen Dragon (Young)", "Destiny Breath")), { criticalSuccess: "x0", success: "x0.5", failure: "x1 slowed1/1 rounds", criticalFailure: "x2 slowed2/1 rounds" });
    // "(1 minute on a critical failure)": the same condition, longer.
    assert.equal(rows(ability("Mirage Dragon (Young, Spellcaster)", "Hallucinatory Breath")).criticalFailure, "x2 confused/1 minutes");
    assert.deepEqual(rows(ability("Lamia Matriarch", "Matriarch's Caress")), { criticalSuccess: "-", success: "-", failure: "- stupefied2", criticalFailure: "- stupefied4" });
    // "(on a critical failure, the creature also falls Prone)": added to the failure's.
    assert.deepEqual(rows(ability("Sewer Ooze", "Filth Wave")), { criticalSuccess: "-", success: "-", failure: "1d4[acid]", criticalFailure: "1d4[acid] prone" });
    // Not actions of their own: after a Strike's hit (part of the Strike activity), or when the creature dies.
    assert.equal(ability("Rhinoceros", "Rhinoceros Charge").builtin, "strike-activity");
    assert.equal(ability("Caligni Dancer", "Final Dance"), null);
});

test("reactions the simulator plays, and charges with a bonus for moving 20 feet", { skip: !available && "PF2e's packs not found" }, async () => {
    const npcs = [...(await readPack("pathfinder-monster-core")), ...(await readPack("pathfinder-monster-core-2"))].filter((doc) => doc.collection === "actors" && doc.type === "npc");
    const ability = (creature, name) => compileMonsterAbility(npcs.find((npc) => npc.name === creature).items.find((item) => item.name === name));
    assert.deepEqual(ability("Wererat", "Nimble Dodge"), { builtin: "ac-reaction", value: 2, when: "targeted" });
    assert.deepEqual(ability("Conspirator Dragon (Ancient)", "Retract Body"), { builtin: "ac-reaction", value: 2, when: "hit" });
    assert.deepEqual(ability("Omen Dragon (Young)", "Challenge Fate"), { builtin: "attack-misfortune" });
    assert.deepEqual(ability("Horned Dragon (Young)", "Twisting Tail"), { builtin: "reaction-strike", triggers: ["move"], strike: "tail", penalty: 2, disrupts: true });
    assert.deepEqual(ability("Reefclaw", "Death Frenzy"), { builtin: "death-strike", strike: "claw" });
    assert.deepEqual(ability("Boar", "Boar Charge"), { builtin: "charge", actions: 2, strides: 2, strike: "tusk", attackBonus: 2 });
    assert.deepEqual(ability("Great Cyclops", "Powerful Charge"), { builtin: "charge", actions: 2, strides: 2, strike: "horn", damage: "3d10+20" });
    assert.equal(ability("Rhinoceros", "Rhinoceros Charge").builtin, "strike-activity", "a save after the hit: a Strike activity");
});

test("Strike activities: a Strike (after Strides) with more on a hit", { skip: !available && "PF2e's packs not found" }, async () => {
    const npcs = [...(await readPack("pathfinder-monster-core")), ...(await readPack("pathfinder-monster-core-2")), ...(await readPack("pathfinder-npc-core"))].filter((doc) => doc.collection === "actors" && doc.type === "npc");
    const ability = (creature, name) => compileMonsterAbility(npcs.find((npc) => npc.name === creature).items.find((item) => item.name === name));
    const wrestle = ability("Tiger", "Wrestle");
    assert.deepEqual([wrestle.builtin, wrestle.actions, wrestle.strides, wrestle.strike, wrestle.requires], ["strike-activity", 1, 0, "claw", "grabbed"]);
    assert.deepEqual(wrestle.onHit.conditions.map((c) => c.slug), ["prone"]);
    const intimidating = ability("Jailer", "Intimidating Strike");
    assert.deepEqual([intimidating.onHit.conditions.map((c) => `${c.slug} ${c.value}`), intimidating.onHit.critical.map((c) => `${c.slug} ${c.value}`)], [["frightened 1"], ["frightened 2"]]);
    const rhino = ability("Rhinoceros", "Rhinoceros Charge");
    assert.deepEqual([rhino.strides, rhino.strike, rhino.damage, rhino.onHit.size], [2, "horn", "(3d8+6)[piercing]", "medium"]);
    assert.deepEqual(rhino.onHit.save.resolution.outcomes.failure.forcedMovement.distance, 5);
    assert.deepEqual(rhino.onHit.save.resolution.outcomes.failure.effects.map((e) => e.slug), ["prone"]);
    assert.equal(ability("Ifrit", "Combat Grab").requires, "free-hand");
    assert.deepEqual([ability("Arboreal Warden", "Shield Push").onHit.push, ability("Skeletal Hulk", "Massive Rush").damageBonus], [10, 4]);
    // (Batch 80: the Strike at a Prone enemy, its drag the GM's.)
    assert.deepEqual(ability("Hyaenodon", "Drag"), { builtin: "no-effect", strikeOnly: true }, "dragging the enemy along is the GM's");
});

test("Engulf: a Reflex save for creatures in its path; a failure engulfs, with the listed Escape DC and Rupture", { skip: !available && "PF2e's packs not found" }, async () => {
    const npcs = [...(await readPack("pathfinder-monster-core")), ...(await readPack("pathfinder-monster-core-2"))].filter((doc) => doc.collection === "actors" && doc.type === "npc");
    const tar = npcs.find((npc) => npc.name === "Living Tar");
    const plan = compileMonsterAbility(tar.items.find((item) => item.name === "Engulf"), { actor: tar });
    assert.deepEqual(plan.targeting.trample, { size: "huge", strides: 2 });
    assert.deepEqual(plan.resolution.check.against, { dc: "fixed", value: 22 });
    assert.deepEqual(plan.resolution.outcomes.failure.effects, [{ kind: "swallow", damage: "(4d6)[acid]", rupture: 15, size: "huge", escapeDC: 22 }]);
    assert.deepEqual(plan.resolution.outcomes.success.effects, []);
});

test("PC feat actions: the inline check, penalties, 'As critical success, but the penalty is –2', the same penalty on yourself", { skip: !available && "PF2e's packs not found" }, async () => {
    const { readPenalties, readSkillCheck } = await import("../src/compiler/checks.js");
    assert.deepEqual(readSkillCheck("<p>roll a @Check[diplomacy|against:will] check against the target's Will DC.</p>"), { roll: "skill", statistic: "diplomacy", against: { dc: "target", statistic: "will" } });
    assert.deepEqual(readSkillCheck("<p>Attempt a @Check[thievery|defense:reflex] check.</p>").against, { dc: "target", statistic: "reflex" });
    assert.deepEqual(readPenalties("The target takes a –2 circumstance penalty to attack rolls until the start of your next turn.").map((m) => `${m.selector} ${m.value} ${m.type}`), ["attack-roll -2 circumstance"]);
    const feats = (await readPack("feats")).filter((doc) => doc.collection === "items");
    const bonMot = compileAbility(feats.find((feat) => feat.name === "Bon Mot"));
    const rows = bonMot.resolution.outcomes;
    assert.deepEqual(rows.criticalSuccess.modifiers.map((m) => `${m.selector} ${m.value} ${m.type} ${m.duration.value} ${m.duration.unit}`), ["perception -3 status 1 minutes", "will -3 status 1 minutes"]);
    assert.deepEqual(rows.success.modifiers.map((m) => `${m.selector} ${m.value}`), ["perception -2", "will -2"]);
    assert.deepEqual(rows.criticalFailure.modifiers.map((m) => `${m.selector} ${m.value} ${m.recipient}`), ["perception -2 self", "will -2 self"]);
});

test("other publishers' monsters (2026-10-10): older inline syntax, basic-save riders, rolled durations, choices", () => {
    const action = (name, html, { actionType = "action", slug = null, actions = 1 } = {}) => ({ type: "action", name, system: { slug, actionType: { value: actionType }, actions: { value: actionType === "action" ? actions : null }, traits: { value: [] }, description: { value: html } } });
    const rows = (plan) => Object.fromEntries(Object.entries(plan.resolution.outcomes).map(([degree, row]) => [degree, row.effects.map((e) => `${e.slug}${e.value ? " " + e.value : ""}`).join(", ")]));
    const link = (id, label) => `@UUID[Compendium.pf2e.conditionitems.Item.${id}]{${label}}`;
    // The older syntax, rewritten in PF2e's current form; PF2e's own text passes through untouched.
    assert.equal(inline.modernInline("takes [[/r (2d6+4)[fire]]]{2d6+4 fire damage} and is @Compendium[pf2e.conditionitems.TkIyaNPgTZFBCCuh]{Dazzled}"), "takes @Damage[(2d6+4)[fire]] damage and is @UUID[Compendium.pf2e.conditionitems.Item.TkIyaNPgTZFBCCuh]{Dazzled}");
    assert.equal(inline.modernInline("@Compendium[pf2e.conditionitems.Sickened]{Sickened 1}"), "@UUID[Compendium.pf2e.conditionitems.Item.Sickened]{Sickened 1}");
    assert.equal(inline.modernInline("(@Check[type:will|dc:20]{basic Will} save)"), "(@Check[type:will|dc:20|basic]{basic Will} save)");
    assert.equal(inline.modernInline("(basic @Check[type:reflex|dc:20] save)"), "(basic @Check[type:reflex|dc:20|basic] save)");
    assert.equal(inline.modernInline("roll [[/r 1d4 #rounds]]{1d4 rounds}"), "roll [[/r 1d4 #rounds]]{1d4 rounds}");
    const pf2e = "<p>@Damage[2d6[fire]] damage (@Check[reflex|dc:20|basic] save).</p>";
    assert.equal(inline.modernInline(pf2e), pf2e);
    assert.equal(inline.readCheck("type:fortitude|dc:40|basic:true").basic, true);
    // A glossary ability written the older way compiles as PF2e's does.
    const swallow = compileMonsterAbility(action("Swallow Whole", "<p>Large, [[/r (2d8+6)[bludgeoning]]] damage, Rupture 20</p><hr /><p>@Localize[PF2E.NPC.Abilities.Glossary.SwallowWhole]</p>", { slug: "swallow-whole" }));
    assert.equal(swallow.resolution.outcomes.success.effects[0].kind, "swallow");
    // A basic save keeps its damage and gains what a failure or critical failure adds.
    const blast = compileMonsterAbility(action("Test Blast", `<p>The beast exhales a cone that deals @Damage[4d6[fire]] damage (@Check[type:reflex|dc:20|basic] save). A creature that fails its save is also ${link("TkIyaNPgTZFBCCuh", "Dazzled")} for 1 round, or ${link("XgEqL1kFApUbl5Z2", "Blinded")} for 1 round on a critical failure. Creatures that critically fail also take @Damage[1d6[persistent,fire]] damage.</p>`, { actions: 2 }));
    assert.deepEqual(blast.resolution.sharedDamage.components.map((c) => c.formula), ["4d6[fire]"]);
    assert.deepEqual([rows(blast).failure, rows(blast).criticalFailure], ["dazzled", "blinded"]);
    assert.deepEqual([blast.resolution.outcomes.failure.damage.mode, blast.resolution.outcomes.criticalFailure.damage.mode], ["shared", "mixed"]);
    assert.deepEqual(blast.resolution.outcomes.criticalFailure.damage.formulas.map((f) => f.formula), ["1d6[persistent,fire]"]);
    // "save or take X damage" doesn't count X twice.
    const pulse = compileMonsterAbility(action("Test Pulse", "<p>Each creature within 20 feet must succeed at a @Check[type:fortitude|dc:20|basic] save or take @Damage[3d6[sonic]] damage.</p>"));
    assert.equal(pulse.resolution.outcomes.failure.damage.mode, "shared");
    // Not one plan: modes, damage by actions spent, an alternative in brackets, damage from a roll on a list.
    assert.equal(compileMonsterAbility(action("Test Breath", "<p>The beast breathes in one of two ways. Fire The beast deals @Damage[6d6[fire]] damage in a cone (@Check[type:reflex|dc:20|basic] save). Frost Each creature must succeed at a @Check[type:fortitude|dc:20] save or be slowed 1.</p>", { actions: 2 })), null);
    // Damage by the number of actions spent: one plan, each count's damage as an action variant (2026-10-10, batch 3).
    const rush = compileMonsterAbility(action("Test Rush", "<p>Each enemy within 5 feet must attempt a @Check[type:reflex|dc:20|basic] save. The damage depends on the number of actions. 1 @Damage[1d8[slashing]] 2 @Damage[2d8[slashing]] 3 @Damage[3d8[slashing]]</p>"));
    assert.deepEqual(Object.fromEntries(Object.entries(rush.resolution.native.byActions).map(([count, variant]) => [count, variant.sharedDamage.components[0].formula])), { 1: "1d8[slashing]", 2: "2d8[slashing]", 3: "3d8[slashing]" });
    const charged = compileMonsterAbility(action("Test Field", "<p>The beast deals @Damage[6d6[electricity]] (@Damage[8d6[electricity]] while charged) damage in a 15-foot emanation (@Check[type:reflex|dc:20|basic] save).</p>", { actions: 2 }));
    assert.deepEqual(charged.resolution.sharedDamage.components.map((c) => c.formula), ["6d6[electricity]"]);
    // Rolled durations: the dice for live play, their average (rounded down) for the simulator; hours stay hours.
    assert.deepEqual(inline.readDuration("is Slowed 1 for [[/br 1d4 #rounds]]{1d4 rounds}"), { mode: "fixed", value: 2, valueRoll: "1d4", unit: "rounds", expiry: "turn-start", anchor: "effect-start" });
    assert.equal(inline.readDuration("is Confused for 1d6+1 rounds").valueRoll, "1d6+1");
    assert.equal(inline.readDuration("takes a penalty for [[/r 1d4 #hours]] hours").unit, "hours");
    assert.equal(inline.readDuration("is Confused for 1 round and takes a penalty for [[/r 1d4 #hours]] hours").value, 1);
    assert.equal(inline.readDuration("can't use it again for [[/br 1d4 #rounds]]{1d4 rounds}"), null);
    assert.deepEqual(inline.readDuration("Immobilized until it's no longer frightened"), { mode: "while", condition: "frightened" });
    // A choice, a negation, a later state: the GM's.
    assert.deepEqual(inline.readConditions(`The creature is ${link("MIRkyAjyBeXivMa7", "Enfeebled 1")}, ${link("i3OJZU2nk64Df3xm", "Clumsy 1")}, or ${link("e1XGnhKNSQIm5IXg", "Stupefied 1")}, as the GM chooses.`), []);
    assert.deepEqual(inline.readConditions(`As failure, but the creature takes half damage and is not ${link("yblD8fOR1J8rDwEQ", "Confused")}.`), []);
    assert.deepEqual(inline.readConditions(`If the target was dying, it remains ${link("fBnFDH2MTzgFijKf", "Unconscious")} for 1 day.`), []);
    assert.deepEqual(inline.readConditions(`The creature is ${link("TBSHQspnbcqxsmjL", "Frightened 1")} and can't reduce its frightened value below 1.`).map((e) => [e.slug, e.value]), [["frightened", 1]]);
    // A push only away from the monster.
    assert.equal(inline.readPush("The creature is pushed back 5 feet.").distance, 5);
    assert.equal(inline.readPush("The creature is pushed 10 feet in a random direction."), null);
    // "Two claw Strikes and one horn Strike. They can make these Strikes in any order."
    assert.deepEqual(compileMonsterAbility(action("Draconic Frenzy", "<p>The test dragon makes two claw Strikes and one horn Strike. They can make these Strikes in any order.</p>", { actions: 2 })).strikes, ["claw", "claw", "horn"]);
});

// Other publishers' bestiaries installed beside PF2e (the Battlezoo modules, 2026-10-10): read from the Foundry data
// folder, never copied into this repository.
const MODULES = `${process.env.HOME}/.local/share/FoundryVTT/Data/modules`;
async function thirdPartyBestiaries(prefix) {
    const { readdirSync, readFileSync } = await import("node:fs");
    if (!existsSync(MODULES)) return [];
    const packs = [];
    for (const id of readdirSync(MODULES).filter((name) => name.startsWith(prefix))) {
        let manifest;
        try {
            manifest = JSON.parse(readFileSync(`${MODULES}/${id}/module.json`, "utf8"));
        } catch {
            continue;
        }
        for (const pack of manifest.packs ?? []) if (pack.type === "Actor" && (pack.system ?? "pf2e") === "pf2e" && !/^sf/.test(pack.name)) packs.push(`${MODULES}/${id}/${pack.path}`);
    }
    return packs;
}

test("every installed Battlezoo monster ability compiles and resolves at every degree", { skip: !(available && existsSync(MODULES)) && "PF2e's packs or the modules folder not found" }, async (t) => {
    const packs = await thirdPartyBestiaries("battlezoo");
    if (!packs.length) return t.skip("no Battlezoo bestiary installed");
    const { readDocuments } = await import("../tools/leveldb.mjs");
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    let plans = 0;
    const failures = [];
    for (const path of packs) {
        for (const npc of readDocuments(path).filter((doc) => doc.collection === "actors" && doc.type === "npc")) {
            for (const item of npc.items.filter((entry) => entry.type === "action")) {
                try {
                    const plan = compileAbility(item, { basicActions, actor: npc });
                    if (!plan?.resolution) continue;
                    plans++;
                    const context = { caster: { id: "m", side: "foes" }, targets: [{ id: "t", side: "party" }], statistic: () => ({ modifier: 10 }), allied: () => false };
                    for (const degree of ["criticalFailure", "failure", "success", "criticalSuccess"]) {
                        const issues = validateChanges(registry.resolveSync(plan, context, { roll: () => ({ degree }) }).changes);
                        if (issues.length) failures.push(`${npc.name} / ${item.name} (${degree}): ${issues[0].message}`);
                    }
                } catch (error) {
                    failures.push(`${npc.name} / ${item.name}: ${error.message}`);
                }
            }
        }
    }
    assert.deepEqual(failures.slice(0, 10), []);
    assert.ok(plans >= 1000, `${plans} plans`);
});

test("a card's line for persistent damage: its dice, or the amount a basic save halved or doubled", async () => {
    const { changeLines } = await import("../src/live/card.js");
    const names = { t: "Valeros" };
    assert.deepEqual(changeLines([{ op: "condition", target: "t", slug: "persistent-damage", damage: { type: "bleed", dice: [{ count: 1, die: 4 }], constant: 0, amount: 2 } }], names), ["Valeros takes 1d4 persistent bleed"]);
    assert.deepEqual(changeLines([{ op: "condition", target: "t", slug: "persistent-damage", damage: { type: "fire", dice: [{ count: 1, die: 6 }], constant: 0, amount: 8, multiplier: 2 } }], names), ["Valeros takes 8 persistent fire"]);
});

test("more save wordings (2026-10-10, batch 2): unless, attempt … or, Buck, Drink Blood, Trample's own damage, each condition's own time", () => {
    const action = (name, html, { actionType = "action", slug = null, actions = 1 } = {}) => ({ type: "action", name, system: { slug, actionType: { value: actionType }, actions: { value: actionType === "action" ? actions : null }, traits: { value: [] }, description: { value: html } } });
    const link = (id, label) => `@UUID[Compendium.pf2e.conditionitems.Item.${id}]{${label}}`;
    const rows = (plan) => Object.fromEntries(Object.entries(plan.resolution.outcomes).map(([degree, row]) => [degree, row.effects.map((e) => `${e.slug}${e.value ? " " + e.value : ""}${e.duration ? `/${e.duration.mode === "fixed" ? `${e.duration.valueRoll ?? e.duration.value} ${e.duration.unit}` : e.duration.mode}` : ""}`).join(", ")]));
    // "becomes X unless they succeed at a save (Y on a critical failure)": a success leaves them untouched, damage included.
    const croak = compileMonsterAbility(action("Test Croak", `<p>Each creature within 30 feet takes @Damage[2d6[sonic]] damage and becomes ${link("TBSHQspnbcqxsmjL", "Frightened 1")} unless it succeeds at a @Check[will|dc:20] save (${link("TBSHQspnbcqxsmjL", "Frightened 2")} on a critical failure).</p>`));
    assert.deepEqual([rows(croak).failure, rows(croak).criticalFailure], ["frightened 1", "frightened 2"]);
    assert.equal(croak.resolution.outcomes.success.damage.multiplier, 0);
    // "must attempt a … save or become …"; "… save or an Acrobatics check. On a failure, …".
    assert.equal(rows(compileMonsterAbility(action("Test Call", `<p>Anyone who hears it must attempt a @Check[will|dc:20] save or become ${link("AdPVz7rbaVSRxHFg", "Fascinated")}.</p>`))).failure, "fascinated");
    const ice = compileMonsterAbility(action("Test Ice", `<p>Any creature on the ice must succeed at a @Check[reflex|dc:15] save or @Check[acrobatics|dc:15] check. On a failure, the creature falls ${link("j91X7x0XSomq8d60", "Prone")}.</p>`));
    assert.equal(rows(ice).failure, "prone");
    // Buck: the rider's Reflex save, Prone; 1d6 bludgeoning more on a critical failure.
    const buck = compileMonsterAbility(action("Buck", "<p>@Check[reflex|dc:20]</p><p>@Localize[PF2E.NPC.Abilities.Glossary.Buck]</p>", { actionType: "reaction", slug: "buck" }));
    assert.deepEqual([rows(buck).failure, rows(buck).criticalFailure, buck.resolution.outcomes.criticalFailure.damage.formulas[0].formula], ["prone", "prone", "1d6[bludgeoning]"]);
    // Drink Blood: Athletics against Fortitude; a success drains; the healing is a note for the GM when it depends on the victim
    // ("from a creature that's already drained doesn't restore any Hit Points"; batch 31: otherwise on the card).
    const drink = compileMonsterAbility(action("Drink Blood", "<p>The test vampire sinks its fangs into that creature to drink its blood. This requires an @Check[athletics|defense:fortitude] check against the victim's Fortitude DC if the victim is grabbed and is automatic for any of the other conditions. The victim is Drained 1 and the vampire regains @Damage[12[healing]] HP. Drinking Blood from a creature that's already drained doesn't restore any HP to the vampire.</p>", { slug: "drink-blood" }));
    assert.deepEqual([drink.resolution.kind, rows(drink).success, rows(drink).failure], ["check", "drained 1", ""]);
    assert.match(drink.resolution.reminders[0], /regains 12 Hit Points/);
    // Trample with its damage written in place of a Strike, and its riders.
    const trample = compileMonsterAbility(action("Trample", "<p>Medium or smaller, @Damage[(2d8+7)[bludgeoning]], @Check[reflex|dc:22|basic]; creatures that fail the save are also knocked Prone</p><p>@Localize[PF2E.NPC.Abilities.Glossary.Trample]</p>", { slug: "trample", actions: 3 }));
    assert.deepEqual([trample.resolution.sharedDamage.components[0].formula, rows(trample).failure], ["(2d8+7)[bludgeoning]", "prone"]);
    // Each condition's own time; stunned with a value takes none; "permanently" has no end; a link with no label is read.
    const flare = compileMonsterAbility(action("Test Flare", `<p>Each creature must attempt a @Check[fortitude|dc:20] save.</p><p><strong>Failure</strong> The creature is ${link("XgEqL1kFApUbl5Z2", "Blinded")} for 1 round and ${link("TkIyaNPgTZFBCCuh", "Dazzled")} for 1 minute.</p><p><strong>Critical Failure</strong> The creature is ${link("dfCMdR4wnpbYNTix", "Stunned 2")} and @UUID[Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg] for 1 minute.</p>`));
    assert.deepEqual([rows(flare).failure, rows(flare).criticalFailure], ["blinded/1 rounds, dazzled/1 minutes", "stunned 2, off-guard/1 minutes"]);
    const roar = compileMonsterAbility(action("Test Roar", `<p>Each creature must succeed at a @Check[fortitude|dc:20] save or be ${link("9PR9y0bi4JPKnHPR", "Deafened")} for 1 minute (or deafened permanently on a critical failure).</p>`));
    assert.deepEqual([rows(roar).failure, rows(roar).criticalFailure], ["deafened/1 minutes", "deafened"]);
});

test("ways and action counts (2026-10-10, batch 3): modes, troops, results only in some cases, notes for the GM", () => {
    const action = (name, html, { actionType = "action", slug = null, actions = 2 } = {}) => ({ type: "action", name, system: { slug, actionType: { value: actionType }, actions: { value: actionType === "action" ? actions : null }, traits: { value: [] }, description: { value: html } } });
    const link = (id, label) => `@UUID[Compendium.pf2e.conditionitems.Item.${id}]{${label}}`;
    const outcomes = (plan) => plan.resolution.outcomes;
    // "creating one of two effects" with a list of ways: a plan for each way, the recharge before the list in both.
    const burble = compileMonsterAbility(action("Test Burble", `<p>The beast babbles, creating one of two effects.</p><p>It can't Burble again for [[/gmr 1d4 #Recharge Burble]]{1d4 rounds}.</p><ul><li><strong>Muddle</strong> @Template[emanation|distance:30]. Each creature in the emanation must succeed at a @Check[will|dc:20] save or become ${link("yblD8fOR1J8rDwEQ", "Confused")} for 1 round.</li><li><strong>Beam</strong> A @Template[line|distance:60] of sound deals @Damage[6d6[sonic]] damage (@Check[reflex|dc:20|basic] save).</li></ul>`));
    assert.equal(burble.builtin, "modes");
    const [muddle, beam] = burble.modes.map((mode) => mode.plan);
    assert.deepEqual([muddle.resolution.check.statistic, outcomes(muddle).failure.effects[0].slug, muddle.resolution.sharedDamage, muddle.trigger.recharge.formula], ["will", "confused", null, "1d4"]);
    assert.deepEqual([beam.resolution.check.statistic, beam.resolution.check.basic, beam.targeting.area, beam.trigger.recharge.formula], ["reflex", true, { type: "line", value: 60 }, "1d4"]);
    // A troop's damage by the number of actions; "each enemy within 10 feet" is a 10-foot emanation.
    const glyph = (n) => `<span class="action-glyph">${n}</span>`;
    const clash = compileMonsterAbility(action("Test Clash", `<p>The troop attacks each enemy within 10 feet (@Check[reflex|dc:20|basic] save). The damage depends on the number of actions.</p><p>${glyph(1)} @Damage[1d8[slashing]] damage</p><p>${glyph(2)} @Damage[(2d8+5)[slashing]] damage</p><p>${glyph(3)} @Damage[(3d8+5)[slashing]] damage</p>`, { actions: 1 }));
    assert.deepEqual([clash.targeting.area, clash.targeting.range, clash.resolution.sharedDamage.components[0].formula, clash.resolution.native.byActions[3].sharedDamage.components[0].formula], [{ type: "emanation", value: 10 }, null, "1d8[slashing]", "(3d8+5)[slashing]"]);
    // Damage "if" something happens is the GM's, told on the card; "As failure, except … pushed 70 feet" pushes 70 feet;
    // a result's own damage beside "full damage" is kept; a pull toward the monster is played.
    const wall = compileMonsterAbility(action("Test Wall", `<p>Creatures in a @Template[cone|distance:30] take @Damage[4d6[force]] damage and must attempt a @Check[fortitude|dc:20] save.</p><p><strong>Critical Success</strong> The creature is unaffected.</p><p><strong>Success</strong> The creature takes half damage and is pushed 5 feet away.</p><p><strong>Failure</strong> The creature takes full damage and @Damage[1d6[persistent,bleed]] damage, and is pushed 20 feet away. If this would push it into a wall, it takes @Damage[2d6[bludgeoning]] damage.</p><p><strong>Critical Failure</strong> As failure, except the creature is pushed 40 feet away.</p>`));
    const failure = outcomes(wall).failure;
    assert.deepEqual([failure.damage.mode, failure.damage.shared.multiplier, failure.damage.formulas.map((f) => f.formula), failure.forcedMovement.distance], ["mixed", 1, ["1d6[persistent,bleed]"], 20]);
    assert.deepEqual(failure.manualInstructions, ["{target}: If this would push it into a wall, it takes 2d6 bludgeoning damage."]);
    assert.equal(outcomes(wall).criticalFailure.forcedMovement.distance, 40);
    const roots = compileMonsterAbility(action("Test Roots", "<p>Each creature in a @Template[emanation|distance:15] must attempt a @Check[reflex|dc:20] save.</p><p><strong>Success</strong> The creature is unaffected.</p><p><strong>Failure</strong> The creature is pulled 5 feet closer to the test shrub.</p>"), { actor: { name: "Test Shrub" } });
    assert.deepEqual(outcomes(roots).failure.forcedMovement, { kind: "pull", distance: 5, upTo: false, optional: false, direction: "toward" });
    // A copy with another name ("PFTEST SIM Kun", "Elite Test Shrub") still pulls toward the monster; "toward the statue" doesn't.
    for (const name of ["PFTEST SIM Test Shrub", "Elite Test Shrub (Old)"]) assert.equal(outcomes(compileMonsterAbility(action("Test Roots", "<p>Each creature in a @Template[emanation|distance:15] must attempt a @Check[reflex|dc:20] save.</p><p><strong>Failure</strong> The creature is pulled 5 feet toward the test shrub.</p>"), { actor: { name } })).failure.forcedMovement?.kind, "pull", name);
    assert.equal(outcomes(compileMonsterAbility(action("Test Statue", "<p>Each creature must attempt a @Check[will|dc:20] save.</p><p><strong>Failure</strong> The creature is pulled 5 feet toward the statue.</p>"), { actor: { name: "Test Haunt" } })).failure.forcedMovement, undefined);
    // A result with nothing to apply brings its text to the GM ("As failure, …" with the failure's); "unaffected" doesn't.
    const giggle = compileMonsterAbility(action("Test Giggle", "<p>Each creature in a @Template[cone|distance:30] must attempt a @Check[will|dc:20] save.</p><p><strong>Critical Success</strong> The creature is unaffected and is temporarily immune for 24 hours.</p><p><strong>Failure</strong> It can't use reactions for 1 round.</p><p><strong>Critical Failure</strong> As failure, but for 2 rounds.</p>"));
    assert.equal(outcomes(giggle).criticalSuccess.manualInstructions, undefined);
    assert.deepEqual(outcomes(giggle).failure.manualInstructions, ["{target} (failure): It can't use reactions for 1 round."]);
    assert.deepEqual(outcomes(giggle).criticalFailure.manualInstructions, ["{target} (critical failure): As failure, but for 2 rounds. (failure: It can't use reactions for 1 round.)"]);
    // A row that applies something, with more it can't: its text too.
    const gas = compileMonsterAbility(action("Test Gas", `<p>Each creature in a @Template[cone|distance:30] must attempt a @Check[will|dc:20] save.</p><p><strong>Failure</strong> It is ${link("xYTAsEpcJE1Ccni3", "Slowed 1")} for 1 round.</p><p><strong>Critical Failure</strong> It is ${link("xYTAsEpcJE1Ccni3", "Slowed 1")} for 2 rounds, and it can't use reactions until then.</p>`));
    assert.equal(outcomes(gas).failure.manualInstructions, undefined);
    assert.deepEqual([outcomes(gas).criticalFailure.effects[0].slug, outcomes(gas).criticalFailure.manualInstructions], ["slowed", ["{target} (critical failure, the rest by hand): It is Slowed 1 for 2 rounds, and it can't use reactions until then."]]);
    // Splash on the creatures around it, and damage with a save of its own, are notes, not the target's damage.
    const burst = compileMonsterAbility(action("Test Burst", "<p>The target takes @Damage[6d6[acid]] damage and must attempt a @Check[will|dc:20] save.</p><p><strong>Success</strong> The target takes half damage.</p><p><strong>Failure</strong> The target takes full damage, and the burst deals @Damage[(3[splash])[acid]]{3 acid splash} damage.</p><p><strong>Critical Failure</strong> The target takes double damage. Its flailing deals @Damage[2d6[bludgeoning]] damage to each adjacent creature (@Check[reflex|dc:20|basic] save).</p>"));
    assert.deepEqual([outcomes(burst).failure.damage.mode, outcomes(burst).failure.manualInstructions], ["shared", ["Splash: 3 acid splash damage to each creature within 5 feet of {target}."]]);
    assert.deepEqual([outcomes(burst).criticalFailure.damage.multiplier, outcomes(burst).criticalFailure.manualInstructions], [2, ["{target}: Its flailing deals 2d6 bludgeoning damage to each adjacent creature (DC 20 basic Reflex save)."]]);
    // A save that exposes the creature to a disease written after it: the save, and the disease's own save as a note.
    const spew = compileMonsterAbility(action("Test Spew", "<p>Creatures in a @Template[cone|distance:30] take @Damage[4d6[poison]] damage and must attempt a @Check[reflex|dc:20] save.</p><hr /><p><strong>Critical Success</strong> The creature takes no damage.</p><p><strong>Success</strong> The creature takes half damage.</p><p><strong>Failure</strong> The creature takes full damage and is exposed to test rot.</p><p><strong>Critical Failure</strong> As failure but double damage.</p><hr /><p><strong>Test Rot</strong></p><p><strong>Saving Throw</strong> @Check[fortitude|dc:22]</p><p><strong>Stage 1</strong> @UUID[Compendium.pf2e.conditionitems.Item.MIRkyAjyBeXivMa7]{Enfeebled 1} (1 day)</p><p><strong>Stage 2</strong> enfeebled 2 (1 day)</p>"));
    assert.deepEqual([spew.trigger.event, spew.resolution.check.statistic, outcomes(spew).criticalFailure.damage.multiplier], ["use", "reflex", 2]);
    assert.deepEqual(outcomes(spew).failure.manualInstructions, ["{target} is exposed to Test Rot: a DC 22 Fortitude save against it (its stages are in the ability's text)."]);
});

test("glossary abilities (2026-10-10, batch 4): Pull, Trample's other listings, Engulf with no damage, Retributive Strike", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const glossary = (key) => `<p>@Localize[PF2E.NPC.Abilities.Glossary.${key}]</p>`;
    const action = (name, html, { actionType = "action", slug = null, actions = 1 } = {}) => ({ type: "action", name, system: { slug, actionType: { value: actionType }, actions: { value: actionType === "action" ? actions : null }, traits: { value: [] }, description: { value: html } } });
    const strike = (name, damage) => ({ type: "melee", name, system: { damageRolls: { a: { damage, damageType: "bludgeoning" } } } });
    const actor = (name, level, strikes = []) => ({ name, system: { details: { level: { value: level } }, traits: { size: { value: "lg" } } }, items: strikes });
    // Pull: a Reposition toward the monster, 5 feet (or the listed distance) on a success, 10 or more on a critical success.
    const pull = compileMonsterAbility(action("Pull", glossary("Pull"), { slug: "pull" }), { basicActions });
    assert.deepEqual([pull.trigger.attackEffect, pull.trigger.cost, pull.resolution.outcomes.success.forcedMovement.kind, pull.resolution.outcomes.success.forcedMovement.distance, pull.resolution.outcomes.criticalSuccess.forcedMovement.distance], ["pull", "action", "pull", 5, 10]);
    const far = compileMonsterAbility(action("Improved Pull 15 Feet", `<p>The test lord uses Pull.</p>${glossary("Pull")}`, { slug: "pull", actionType: "free" }), { basicActions });
    assert.deepEqual([far.trigger.cost, far.resolution.outcomes.success.forcedMovement.distance, far.resolution.outcomes.criticalSuccess.forcedMovement.distance], ["free", 15, 15]);
    assert.equal(compileMonsterAbility(action("Push 10ft", glossary("Push"), { slug: "push" }), { basicActions }).resolution.outcomes.success.forcedMovement.distance, 10);
    // Trample listed with semicolons, after other text, or written out; a Strike found by its last word.
    const centaur = actor("Test Centaur", 4, [strike("Iron Hoof", "1d10+5")]);
    const semi = compileMonsterAbility(action("Trample", `<p>Medium or Smaller; Hoof; @Check[reflex|dc:21|basic]</p>${glossary("Trample")}`, { slug: "trample", actions: 3 }), { actor: centaur });
    assert.deepEqual([semi.targeting.trample.size, semi.resolution.sharedDamage.components[0].formula], ["medium", "(1d10+5)[bludgeoning]"]);
    const wheel = compileMonsterAbility(action("Test Wheel", `<p><strong>Requirements</strong> It is rolling.</p><hr /><p><strong>Effect</strong> As Trample, except it Flies. Huge or smaller, hoof, @Check[reflex|dc:30|basic]</p>${glossary("Trample")}`, { slug: "trample", actions: 3 }), { actor: centaur });
    assert.equal(wheel.targeting.trample.size, "huge");
    const prose = compileMonsterAbility(action("Trample", `<p>It Strides through creatures of size Small or smaller. It deals the damage of the hoof Strike, with a basic Reflex save at @Check[reflex|dc:14|basic]</p><hr />${glossary("Trample")}`, { slug: "trample", actions: 3 }), { actor: centaur });
    assert.deepEqual([prose.targeting.trample.size, prose.resolution.sharedDamage.components[0].formula], ["small", "(1d10+5)[bludgeoning]"]);
    // Engulf with no damage: engulfed all the same, nothing each turn.
    const vessel = compileMonsterAbility(action("Engulf", `<p>@Check[reflex|dc:35] save, no damage, [[/act escape dc=35]], Rupture 28</p>${glossary("Engulf")}`, { slug: "engulf", actions: 2 }), { actor: actor("Test Vessel", 10) });
    assert.deepEqual([vessel.resolution.outcomes.failure.damage.mode, vessel.resolution.outcomes.failure.effects[0].damage, vessel.resolution.outcomes.failure.effects[0].rupture], ["none", null, 28]);
    // An untyped roll labelled as damage ("[[/r {1d8 + 8}]]{1d8 + 8 damage}").
    const constrict = compileMonsterAbility(action("Constrict", `<p>[[/r {1d8 + 8}]]{1d8 + 8 damage}, @Check[type:fortitude|dc:23] save</p>${glossary("Constrict")}`, { slug: "constrict" }));
    assert.equal(constrict.resolution.sharedDamage.components[0].formula, "(1d8+8)[untyped]");
    // Retributive Strike: the ally's resistance is 2 + the monster's level; Form Up and Catch Rock change nothing in a fight.
    assert.deepEqual(compileMonsterAbility(action("Retributive Strike", glossary("RetributiveStrike"), { actionType: "reaction" }), { actor: actor("Test Warden", 6) }), { builtin: "retributive-strike", resistance: 8 });
    for (const key of ["FormUp", "CatchRock"]) assert.equal(compileMonsterAbility(action(key, glossary(key))).builtin, "no-effect");
});

test("abilities whose result is a PF2e effect (2026-10-10, batch 4): on itself, its allies, or a target", () => {
    const effect = (id, label) => `@UUID[Compendium.pf2e.bestiary-effects.Item.${id}]{${label}}`;
    const action = (name, html, { actionType = "action", selfEffect = null } = {}) => ({ type: "action", name, system: { slug: null, actionType: { value: actionType }, actions: { value: actionType === "action" ? 1 : null }, traits: { value: [] }, description: { value: html }, ...(selfEffect ? { selfEffect: { uuid: selfEffect, name: "Effect" } } : {}) } });
    const read = (plan) => plan && [plan.resolution.kind, plan.resolution.applications[0].recipients, plan.targeting.target, plan.targeting.range, plan.targeting.area?.value ?? null];
    // Itself: "gaining a +2 circumstance bonus to AC"; "When the swarm forms up, it gains …"; its PF2e self effect.
    assert.deepEqual(read(compileMonsterAbility(action("Test Guard", `<p>The test knight raises its blade to protect itself, gaining a +2 circumstance bonus to AC until the start of its next turn.</p><p>${effect("AAAAAAAAAAAAAAA1", "Effect: Test Guard")}</p>`))), ["effect", "self", null, null, null]);
    assert.deepEqual(read(compileMonsterAbility(action("Test Formation", `<p>When the test swarm closes ranks, it gains a +2 circumstance bonus to AC.</p><p>${effect("AAAAAAAAAAAAAAA2", "Effect: Test Formation")}</p>`))), ["effect", "self", null, null, null]);
    const own = compileMonsterAbility(action("Test Shields", "<p>The troop raises its shields.</p>", { selfEffect: "Compendium.pf2e.bestiary-effects.Item.AAAAAAAAAAAAAAA3" }));
    assert.deepEqual([...read(own), own.resolution.applications[0].selfEffect], ["effect", "self", null, null, null, true]);
    // Its allies in an emanation; one adjacent ally; its own kind around it.
    assert.deepEqual(read(compileMonsterAbility(action("Test Cry", `<p>The test chief gives themself and all allies within 60 feet a +1 status bonus to attack and damage rolls until the start of its next turn.</p><p>${effect("AAAAAAAAAAAAAAA4", "Effect: Test Cry")}</p>`))), ["effect", "allies-in-area", null, null, 60]);
    assert.deepEqual(read(compileMonsterAbility(action("Test Defense", `<p>The test guard grants an adjacent ally a +2 circumstance bonus to AC.</p><p>${effect("AAAAAAAAAAAAAAA5", "Effect: Test Defense")}</p>`))), ["effect", "allies-in-area", "1 creature", "touch", null]);
    assert.deepEqual(read(compileMonsterAbility(action("Test Call", `<p>Each test goblin within @Template[emanation|distance:30] gains a +2 status bonus to attack rolls.</p><p>${effect("AAAAAAAAAAAAAAA6", "Effect: Test Call")}</p>`))), ["effect", "allies-in-area", null, null, 30]);
    // Another creature: "an enemy within 30 feet. The target takes a –2 status penalty …".
    assert.deepEqual(read(compileMonsterAbility(action("Test Taunt", `<p>The test bard mocks an enemy within 30 feet. The target takes a –2 status penalty to Will saves for 1 minute.</p><p>${effect("AAAAAAAAAAAAAAA7", "Effect: Test Taunt")}</p>`))), ["effect", "target", "1 creature", "30 feet", null]);
    // Not when there's more to it: a Strike, a check, a choice, a trigger, movement.
    for (const html of ["<p>The test knight makes a Strike, then gains a +2 circumstance bonus to AC.</p>", "<p>It attempts an Intimidation check; on a success it gains a +1 status bonus.</p>", "<p>The test knight Strides, then gains a +2 circumstance bonus to AC.</p>"]) assert.equal(compileMonsterAbility(action("Test Busy", `${html}<p>${effect("AAAAAAAAAAAAAAA8", "Effect: Test Busy")}</p>`)), null, html);
});

test("skill checks whose results are prose (2026-10-10, batch 5): leads, brackets, 'also', doubled damage, the user's own failure", () => {
    const link = (id, label) => `@UUID[Compendium.pf2e.conditionitems.Item.${id}]{${label}}`;
    const action = (name, html, { actionType = "action" } = {}) => ({ type: "action", name, system: { slug: null, actionType: { value: actionType }, actions: { value: 1 }, traits: { value: [] }, description: { value: html } } });
    const rows = (plan) => Object.fromEntries(Object.entries(plan.resolution.outcomes).map(([degree, row]) => [degree, [...row.effects.map((e) => `${e.slug}${e.value ? " " + e.value : ""}${e.recipient === "self" ? " (self)" : ""}${e.scope ? ` (to ${e.scope.attacks}${e.scope.uses ? " once" : ""})` : ""}`), ...(row.forcedMovement ? [`${row.forcedMovement.kind} ${row.forcedMovement.distance}`] : []), ...(row.damage?.formulas ?? []).map((f) => f.formula)].join(", ")]));
    // "On a success, the target is Confused …"; a critical success is at least that.
    const insult = compileMonsterAbility(action("Test Insult", `<p>The test sprite taunts a creature within 30 feet and rolls @Check[performance|defense:will] against the target's Will DC. On a success, the target is ${link("yblD8fOR1J8rDwEQ", "Confused")} until the end of their next turn.</p>`));
    assert.deepEqual([insult.resolution.check.statistic, insult.resolution.check.against.statistic, insult.targeting.range, rows(insult).success, rows(insult).criticalSuccess], ["performance", "will", "30 feet", "confused", "confused"]);
    // "(Clumsy 2 on a critical success)", in an area.
    const tricks = compileMonsterAbility(action("Test Tricks", `<p>The test squad trips foes in a @Template[type:emanation|distance:5], attempting a single @Check[thievery|against:reflex] check and comparing the result to each target's Reflex DC. On a success, the target is ${link("i3OJZU2nk64Df3xm", "Clumsy 1")} (${link("i3OJZU2nk64Df3xm", "Clumsy 2")} on a critical success) until they take an Interact action.</p>`));
    assert.deepEqual([tricks.targeting.area, rows(tricks).success, rows(tricks).criticalSuccess], [{ type: "emanation", value: 5 }, "clumsy 1", "clumsy 2"]);
    // A trailing lead: "…, pulling it up to 30 feet closer on a success (60 feet on a critical success)".
    const reel = compileMonsterAbility(action("Test Reel", "<p>If a creature is hooked, the test angler attempts an @Check[athletics|against:fortitude] check against the creature's Fortitude DC, pulling it up to 30 feet closer on a success (60 feet on a critical success).</p>"));
    assert.deepEqual([rows(reel).success, rows(reel).criticalSuccess], ["pull 30", "pull 60"]);
    // "On a critical success, the creature also falls Prone"; "On a critical success, the damage is doubled".
    const chain = compileMonsterAbility(action("Test Chain", `<p>The test skinner attempts an @Check[athletics|defense:reflex] check against the creature's Reflex DC. On a success, it becomes ${link("VcDeM8A5oI6VqhbM", "Restrained")}; on a critical success, the creature also falls ${link("j91X7x0XSomq8d60", "Prone")}.</p>`));
    assert.deepEqual([rows(chain).success, rows(chain).criticalSuccess], ["restrained", "restrained, prone"]);
    const smear = compileMonsterAbility(action("Test Smear", "<p>The test giant attempts an Athletics check against the target's Reflex DC. On a success, it smears the creature along the wall, dealing @Damage[(2d8+8)[bludgeoning]] damage. On a critical success, the damage is doubled.</p>"));
    assert.deepEqual([rows(smear).success, rows(smear).criticalSuccess], ["(2d8+8)[bludgeoning]", "2*(2d8+8)[bludgeoning]"]);
    // Off-guard only to the user; the user's own critical failure; "the grabbed creature" is no condition.
    const gambit = compileMonsterAbility(action("Test Gambit", `<p>The test acrobat attempts an @Check[acrobatics|defense:reflex] check against the Reflex DC of one target. On a success, the target is ${link("AJh5ex99aV6VTggg", "Off-Guard")} against the test acrobat's next melee Strike. On a critical failure, the test acrobat is ${link("yblD8fOR1J8rDwEQ", "Confused")} for 1 round.</p>`));
    assert.deepEqual([rows(gambit).success, rows(gambit).criticalFailure], ["off-guard (to melee once)", "confused (self)"]);
    const toss = compileMonsterAbility(action("Test Toss", "<p>The test brute attempts an @Check[athletics|defense:fortitude] check against the grabbed creature's Fortitude DC. On a success, it throws the grabbed creature 10 feet and it lands prone.</p>"));
    assert.equal(rows(toss).success, "prone");
    // Not: a passive's rider, or a choice of what to try.
    assert.equal(compileMonsterAbility(action("Test Rider", "<p>When it casts a spell, it attempts an @Check[occultism|against:will] check against the target's Will DC. On a success, the target is Frightened 1.</p>", { actionType: "passive" })), null);
    assert.equal(compileMonsterAbility(action("Test Either", "<p>The test toad attempts to either pull the target closer or Disarm it, with an @Check[athletics|defense:fortitude] check against the target's Fortitude DC. On a success, it pulls the target 10 feet closer.</p>")), null);
});

test("Resilient Form and the like: a critical hit on it becomes a normal hit on a flat check (batch 5)", () => {
    const action = (name, html, actionType = "reaction", frequency = null) => ({ type: "action", name, system: { slug: null, actionType: { value: actionType }, actions: { value: null }, traits: { value: [] }, description: { value: html }, ...(frequency ? { frequency } : {}) } });
    assert.deepEqual(compileMonsterAbility(action("Test Form", "<p><strong>Trigger</strong> The test dragon is critically hit with a weapon or unarmed attack;</p><hr /><p><strong>Effect</strong> The dragon's scales ward off deadly attacks. The dragon attempts a @Check[flat|dc:14]. On a success, the triggering attack becomes a normal hit.</p>")), { builtin: "crit-downgrade", dc: 14 });
    assert.deepEqual(compileMonsterAbility(action("Test Blow", "<p><strong>Trigger</strong> It is critically hit with a Strike</p><hr /><p><strong>Effect</strong> It attempts a @Check[flat|dc:11]. On a success, the attack becomes a normal hit instead.</p>", "free", { max: 3, per: "day" })), { builtin: "crit-downgrade", dc: 11, uses: 3 });
});

test("Strike abilities (2026-10-10, batch 6): follow-ups after a hit, several Strikes in one action, a Strike at each creature in reach", () => {
    const link = (id, label) => `@UUID[Compendium.pf2e.conditionitems.Item.${id}]{${label}}`;
    const action = (name, html, actions = 1) => ({ type: "action", name, system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: html } } });
    // A follow-up: the save on the creature the claw hit, used as before; the simulator only straight after such a hit.
    const stitch = compileMonsterAbility(action("Test Follow-up", `<p><strong>Requirements</strong> The test fairy's last action was a successful claw Strike</p><hr /><p><strong>Effect</strong> The test fairy twists the creature's neck. It must succeed at a @Check[reflex|dc:21] save or become ${link("eIcWbB5o3pP6OIMe", "Immobilized")}.</p>`));
    assert.deepEqual([stitch.resolution.check.statistic, stitch.resolution.outcomes.failure.effects[0].slug, stitch.trigger.event, stitch.trigger.followUp, stitch.targeting.target], ["reflex", "immobilized", "use", { strike: "claw", melee: false, on: ["success", "criticalSuccess"] }, "the creature the Strike hits"]);
    const any = compileMonsterAbility(action("Test Delay", `<p><strong>Requirements</strong> The test daemon's last action was a successful Strike that dealt damage</p><hr /><p><strong>Effect</strong> The creature must succeed at a @Check[will|dc:25] save or be ${link("xYTAsEpcJE1Ccni3", "Slowed 1")} for 1 round.</p>`));
    assert.equal(any.trigger.followUp.strike, null);
    // Not when the Strike is one of several ("…or a Draconic Frenzy that included …").
    assert.equal(compileMonsterAbility(action("Test Weaken", "<p><strong>Requirements</strong> The test dragon's last action was a successful Strike with a melee unarmed attack or a Draconic Frenzy that included a successful Strike</p><hr /><p><strong>Effect</strong> The creature must succeed at a @Check[fortitude|dc:30] save or be enfeebled 1.</p>"))?.trigger?.followUp, undefined);
    // Several Strikes: more wordings, the penalty, the target, once a turn.
    const multi = (text, actions = 1) => compileMonsterAbility(action("Test Multi", `<p>${text}</p>`, actions));
    assert.deepEqual(multi("The test dragon makes one claw Strike and one tail Strike in either order.", 2), { builtin: "multi-strike", actions: 2, strikes: ["claw", "tail"] });
    assert.deepEqual(multi("Test Froglegs makes two dagger Strikes."), { builtin: "multi-strike", actions: 1, strikes: ["dagger", "dagger"] });
    assert.deepEqual(multi("The test captain makes two Strikes, one with their rapier and one with their dagger."), { builtin: "multi-strike", actions: 1, strikes: ["rapier", "dagger"] });
    assert.deepEqual(multi("The test beast makes three claw Strikes against a single creature within reach. Its multiple attack penalty doesn't increase until after it makes all three Strikes.", 2), { builtin: "multi-strike", actions: 2, strikes: ["claw", "claw", "claw"], sameMap: true, sameTarget: true });
    assert.deepEqual(compileMonsterAbility(action("Test Flurry", "<p><strong>Frequency</strong> once per turn</p><hr /><p><strong>Effect</strong> The test monk makes two unarmed Strikes. If both hit the same creature, combine their damage for the purpose of resistances and weaknesses.</p>")), { builtin: "multi-strike", actions: 1, strikes: [null, null], oncePerTurn: true });
    // …but not with more to it (a save when both hit is a Strike activity's).
    assert.notEqual(multi("The test monk makes two unarmed Strikes. If both hit the same creature, combine their damage, and the creature must succeed at a @Check[fortitude|dc:20] save or be stunned 1.")?.builtin, "multi-strike");
    // A Strike at each creature in reach.
    assert.deepEqual(multi("The test shambler makes a vine Strike against each creature within reach. Its multiple attack penalty increases only after all the attacks.", 2), { builtin: "multi-strike", actions: 2, strikes: ["vine"], each: true, sameMap: true });
});

test("moves before a Strike and more Strike activities (2026-10-10, batch 7)", () => {
    const action = (name, html, actions = 1) => ({ type: "action", name, system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: html } } });
    const one = (name, text, actions) => compileMonsterAbility(action(name, `<p>${text}</p>`, actions));
    // Other moves: a charge, after a sentence that only describes it.
    assert.deepEqual(one("Test Dive", "The test osprey Flies up to double its fly Speed in a straight line, descending at least 10 feet, and then makes a talon Strike.", 2), { builtin: "charge", actions: 2, strides: 2, strike: "talon" });
    assert.deepEqual(one("Test Slash", "Test Uri Strides and makes a scimitar Strike at any point during the Stride.", 1), { builtin: "charge", actions: 1, strides: 1, strike: "scimitar" });
    assert.deepEqual(one("Test Lunge", "The test shark dashes forward and extends its jaws. The test shark Swims up to 10 feet and makes a jaws Strike against a foe within its reach.", 1), { builtin: "charge", actions: 1, strides: 1, strike: "jaws" });
    // Strike activities: "This Strike deals an additional 3d6 precision damage", an extra weapon die, counted as two attacks.
    const skirmish = one("Test Skirmish", "The test skirmisher Strides or Steps, then Strikes. This Strike deals an additional 3d6 precision damage.", 2);
    assert.deepEqual([skirmish.builtin, skirmish.strides, skirmish.onHit.damage], ["strike-activity", 1, ["3d6[precision]"]]);
    const power = one("Test Power", "Test Alak unleashes a mighty swing. He makes a melee Strike. This counts as two attacks when calculating his multiple attack penalty. If this Strike hits, he deals an extra die of weapon damage.", 2);
    assert.deepEqual([power.builtin, power.countsAs, power.extraWeaponDice], ["strike-activity", 2, 1]);
    // A move written into the subject is read as a move ("Burrows at least 10 feet and then attempts …").
    const glide = one("Test Tunnel", "The test mole Burrows at least 10 feet and then attempts a claw Strike. If the Strike hits, it deals an additional 1d8 fire damage.", 2);
    assert.deepEqual([glide.strides, glide.strike, glide.onHit.damage], [1, "claw", ["1d8[fire]"]]);
});

test("save or die, pulls in prose saves, and the PF2e effect a save or check links (2026-10-10, batch 8)", () => {
    const action = (name, html) => ({ type: "action", name, system: { slug: null, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: [] }, description: { value: html } } });
    const effect = (id, label) => `@UUID[Compendium.pf2e.bestiary-effects.Item.${id}]{${label}}`;
    // "…save or instantly die"; "If it fails, it dies".
    const devour = compileMonsterAbility(action("Test Devour", "<p>The test daemon consumes the soul of a creature it has Grabbed. The creature must succeed at a @Check[fortitude|dc:35] save or instantly die.</p>"));
    assert.deepEqual([devour.resolution.outcomes.failure.terminal, devour.resolution.outcomes.criticalFailure.terminal, devour.resolution.outcomes.success.terminal], [{ kind: "death" }, { kind: "death" }, undefined]);
    const tug = compileMonsterAbility(action("Test Tug", "<p>The test fairy pulls at a dying creature. The target must attempt a @Check[fortitude|dc:20] save. If it fails, it dies, and the test fairy gains 10 temporary Hit Points.</p>"));
    assert.deepEqual(tug.resolution.outcomes.failure.terminal, { kind: "death" });
    // "…save or be pulled 10 feet towards the test magnet (15 feet on a critical failure)".
    const tow = compileMonsterAbility(action("Test Tow", "<p>Each creature in a @Template[emanation|distance:60] must succeed at a @Check[fortitude|dc:28] save or be pulled 10 feet towards the test magnet (15 feet on a critical failure).</p>"), { actor: { name: "Test Magnet" } });
    assert.deepEqual([tow.resolution.outcomes.failure.forcedMovement.kind, tow.resolution.outcomes.failure.forcedMovement.distance, tow.resolution.outcomes.criticalFailure.forcedMovement.distance], ["pull", 10, 15]);
    // A save's failure that is a linked effect; a check's success that is the user's own.
    const gloom = compileMonsterAbility(action("Test Gloom", `<p>Creatures in a @Template[line|distance:15] must succeed at a @Check[will|dc:16] save or take a –1 status penalty to attack rolls until the end of its next turn.</p><p>${effect("AAAAAAAAAAAAAAA9", "Effect: Test Gloom")}</p>`));
    // (The text's own penalty, read; the linked effect fills only results with nothing else.)
    assert.deepEqual(gloom.resolution.outcomes.failure.modifiers.map((m) => `${m.selector} ${m.value} ${m.type}`), ["attack-roll -1 status"]);
    const mark = compileMonsterAbility(action("Test Mark", `<p>The test hunter marks a creature within 60 feet. The target can avoid becoming marked with a successful @Check[reflex|dc:30] save. While marked, it can't hide from the hunter.</p><p>${effect("AAAAAAAAAAAAAAA9", "Effect: Test Mark")}</p>`));
    assert.ok(!mark || !mark.resolution.outcomes.failure.nativeEffects || mark.resolution.outcomes.failure.nativeEffects[0].uuid.endsWith("AAAAAAAAAAAAAAA9"));
    const curse = compileMonsterAbility(action("Test Curse", `<p>The test witch curses one creature within 30 feet. The creature must attempt a @Check[will|dc:25] save. On a failure, it is Frightened 1.</p><p>${effect("AAAAAAAAAAAAAAB2", "Effect: Test Curse")}</p>`));
    assert.equal(curse.resolution.outcomes.failure.nativeEffects, undefined, "a result that applies its own condition keeps it alone");
    const probe = compileMonsterAbility(action("Test Probe", `<p>The test nerve probes a creature within 100 feet, attempting an @Check[occultism|against:will] check against the creature's Will DC. On a success, the test nerve can Step, and gains a +2 circumstance bonus to AC against that creature until the start of its next turn.</p><p>${effect("AAAAAAAAAAAAAAB1", "Effect: Test Probe")}</p>`));
    assert.deepEqual(probe.resolution.outcomes.success.nativeEffects, [{ uuid: "Compendium.pf2e.bestiary-effects.Item.AAAAAAAAAAAAAAB1", label: "Test Probe", recipient: { actor: "source" } }]);
});

test("abilities that cast a spell or have its effects (2026-10-10, batch 9): the spell, at the ability's rank and DC, and what it changes", () => {
    const action = (name, html, type = "action") => ({ type: "action", name, system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? 2 : null }, traits: { value: [] }, description: { value: html } } });
    const spell = (id, label) => `@UUID[Compendium.pf2e.spells-srd.Item.${id}]{${label}}`;
    const dominate = spell("AAAAAAAAAAAAAAD1", "Dominate");
    // "can cast … at will as a divine innate spell", its DC in a check after it.
    const glare = compileMonsterAbility(action("Test Glare", `<p>The test vampire can cast ${dominate} at will as a divine innate spell. It requires meeting the target's gaze (@Check[will|dc:26]). A creature that succeeds is temporarily immune for 24 hours.</p>`));
    assert.deepEqual([glare.builtin, glare.spell.uuid, glare.spell.name, glare.rank, glare.dc, glare.tradition], ["cast-spell", "Compendium.pf2e.spells-srd.Item.AAAAAAAAAAAAAAD1", "Dominate", null, 26, "divine"]);
    assert.deepEqual(glare.notes, ["It requires meeting the target's gaze (DC 26 Will).", "A creature that succeeds is temporarily immune for 24 hours."]);
    // "This has the same effect as the X spell (DC), except …": the exception for the GM.
    const haunt = compileMonsterAbility(action("Test Haunt", `<p>The test ghost enters an adjacent creature. This has the same effect as the ${spell("AAAAAAAAAAAAAAD2", "Possession")} spell (@Check[will|dc:23]), except the test ghost has no body to leave behind.</p>`));
    assert.deepEqual([haunt.dc, haunt.notes], [23, ["This has the same effect as the Possession spell (DC 23 Will), except the test ghost has no body to leave behind."]]);
    // "casts a 5th-rank X on …"; "heightened to 6th rank"; a counteract modifier; the rest of the sentence as a note.
    const oath = compileMonsterAbility(action("Test Oath", `<p><strong>Requirements</strong> The test spirit's last action was a successful claw Strike.</p><hr /><p><strong>Effect</strong> The test spirit casts a 5th-rank ${spell("AAAAAAAAAAAAAAD3", "Geas")} on the creature it hit (@Check[will|dc:30]).</p>`));
    assert.deepEqual([oath.builtin, oath.rank, oath.dc, oath.notes], ["cast-spell", 5, 30, []]);
    const swarm = compileMonsterAbility(action("Test Swarm", `<p>The test druids cast ${spell("AAAAAAAAAAAAAAD4", "Swarm Form")} heightened to 6th rank, but the duration is 1 hour instead of 5 minutes.</p>`));
    assert.deepEqual([swarm.rank, swarm.notes], [6, ["The test druids cast Swarm Form heightened to 6th rank, but the duration is 1 hour instead of 5 minutes."]]);
    const plating = compileMonsterAbility(action("Test Plating", `<p>The test construct's plating casts ${spell("AAAAAAAAAAAAAAD5", "Spell Turning")} on it (counteract modifier +32).</p>`));
    assert.deepEqual([plating.attack, plating.dc], [32, null]);
    const mist = compileMonsterAbility(action("Test Mist", `<p>The test vampire turns into a cloud of vapor, as the ${spell("AAAAAAAAAAAAAAD6", "Vapor Form")} spell, or back to its normal form.</p>`));
    assert.deepEqual([mist.self, mist.notes], [true, ["The test vampire turns into a cloud of vapor, as the Vapor Form spell, or back to its normal form."]]);
    // On itself: "gains the effects of", "on himself".
    const blur = compileMonsterAbility(action("Test Shade", `<p>The test giant gains the effect of the ${spell("AAAAAAAAAAAAAAE1", "Blur")} spell for 1 minute.</p>`));
    assert.deepEqual([blur.self, haunt.self, oath.self], [true, false, false]);
    // Not a casting: a trigger that names the spell, a rule on its own casting, a choice, a Strike with it, a permission, a reflection.
    const not = (name, html, type) => assert.notEqual(compileMonsterAbility(action(name, html, type))?.builtin, "cast-spell", name);
    not("Test Ride", `<p><strong>Trigger</strong> The test wendigo casts ${spell("AAAAAAAAAAAAAAD7", "Migration")} while it has a foe Grabbed.</p><hr /><p><strong>Effect</strong> The grabbed creature comes along.</p>`, "reaction");
    not("Test Rule", `<p>When the test acolyte casts ${spell("AAAAAAAAAAAAAAD8", "Harm")} to damage one creature, that creature is knocked Prone.</p>`);
    not("Test Pounce", `<p>The test warden Strides up to its Speed, Leaps up to its Speed, or casts ${spell("AAAAAAAAAAAAAAD9", "Translocate")}; at the end of that movement, it Strikes.</p>`);
    not("Test Ambush", `<p>The test hound casts ${spell("AAAAAAAAAAAAAAD9", "Translocate")}, then makes a melee Strike that deals one extra die of damage.</p>`);
    not("Test Domain", `<p>The test blight projects its senses into its domain. A test blight can cast ${dominate} through this sensory link.</p>`);
    not("Test Mirror", `<p><strong>Trigger</strong> The test dragon critically succeeds at a save against a spell.</p><hr /><p><strong>Effect</strong> The spell is reflected back upon the caster, with the effect of ${spell("AAAAAAAAAAAAAAD5", "Spell Turning")}.</p>`, "reaction");
    not("Test Passive", `<p>The test vampire can cast ${dominate} at will as a divine innate spell.</p>`, "passive");
    not("Test Choice", `<p>The test herecite casts ${dominate}, ${spell("AAAAAAAAAAAAAAD8", "Harm")}, or ${spell("AAAAAAAAAAAAAAD3", "Geas")} (DC 31).</p>`);
});

test("results with no roll (2026-10-10, batch 11): damage and conditions on the creatures it names, for the GM's Apply", () => {
    const action = (name, html, type = "action") => ({ type: "action", name, system: { slug: null, actionType: { value: type }, actions: { value: 1 }, traits: { value: [] }, description: { value: html } } });
    const drained = "@UUID[Compendium.pf2e.conditionitems.Item.4D2KBtexWXa6oUMR]{Drained 1}";
    const burn = compileMonsterAbility(action("Test Burn", "<p>The test statue grinds a creature it has Grabbed into its coals. The target takes @Damage[3d8[fire],1d8[persistent,fire]] damage.</p>"));
    assert.deepEqual([burn.resolution.kind, burn.resolution.check.roll, burn.resolution.sharedDamage.components.map((c) => c.formula), burn.resolution.outcomes.success.damage.mode, burn.resolution.outcomes.failure.damage.mode], ["check", "automatic", ["3d8[fire],1d8[persistent,fire]"], "shared", "none"]);
    const digest = compileMonsterAbility(action("Test Digest", `<p><strong>Requirements</strong> The test star has a target Grabbed</p><hr /><p><strong>Effect</strong> The test star digests its prey. The target takes @Damage[(2d12+6)[acid]] damage and is ${drained}.</p>`));
    assert.deepEqual(digest.resolution.outcomes.success.effects.map((e) => [e.slug, e.value]), [["drained", 1]]);
    // "Each enemy within 30 feet": around it; "<it> deals … damage to each creature in …".
    const surge = compileMonsterAbility(action("Test Surge", "<p>Each enemy within 30 feet of the test squirrel takes @Damage[1d8[slashing]] damage.</p>"));
    assert.deepEqual(surge.targeting.area, { type: "emanation", value: 30 });
    // A follow-up to a hit with no roll ("Requirements … last action was a successful jaws Strike").
    const gnaw = compileMonsterAbility(action("Test Gnaw", "<p><strong>Requirements</strong> The test hare's last action was a successful jaws Strike</p><hr /><p><strong>Effect</strong> The test hare gnaws deeper. The target takes @Damage[(1d8+3)[piercing]] damage.</p>"));
    assert.deepEqual([gnaw.resolution.check.roll, gnaw.trigger.followUp.strike], ["automatic", "jaws"]);
    // The creature's level in a formula.
    const ichor = compileMonsterAbility(action("Test Ichor", "<p><strong>Trigger</strong> The test villager takes slashing damage from a melee Strike</p><hr /><p><strong>Effect</strong> The creature making the triggering Strike takes @Damage[(@actor.level)[persistent,poison]] damage.</p>", "reaction"), { actor: { name: "Test Villager", system: { details: { level: { value: 3 } } } } });
    assert.deepEqual(ichor.resolution.sharedDamage.components.map((c) => c.formula), ["(3)[persistent,poison]"]);
    // Not: some of them only, a save in it, a choice, a degree, damage to itself, concealment.
    const not = (name, html) => assert.notEqual(compileMonsterAbility(action(name, html))?.resolution?.check?.roll, "automatic", name);
    not("Test Purge", "<p>Each creature that fails its save against the Breath Weapon takes @Damage[4d6[persistent,fire]] damage.</p>");
    not("Test Flames", "<p>Every foe within 60 feet taking persistent fire damage takes @Damage[5d6[fire]] damage.</p>");
    not("Test Topple", `<p>All creatures in a @Template[cone|distance:30] must attempt a Reflex save. Critical Success The target is unaffected. Failure The target is ${drained}.</p>`);
    not("Test Choice", `<p>The foe must choose one: the ally is unharmed, or the enemy is ${drained}.</p>`);
    not("Test Degree", `<p>The victim becomes ${drained}, or Drained 2 on a critical hit.</p>`);
    not("Test Self", "<p>The test swarm takes @Damage[1d6[untyped]] damage as the traps cling on.</p>");
    not("Test Smoke", "<p>All creatures within the cloud become @UUID[Compendium.pf2e.conditionitems.Item.DmAIPqOBomZ7H95W]{Concealed}.</p>");
});

test("concealment against the triggering attack, Reactive Strike under either name (2026-10-10, batch 12)", () => {
    const reaction = (name, html, slug = null) => ({ type: "action", name, system: { slug, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: html } } });
    const concealment = "@UUID[Compendium.pf2e.conditionitems.Item.DmAIPqOBomZ7H95W]{Concealment}";
    assert.deepEqual(compileMonsterAbility(reaction("Test Flash", `<p><strong>Trigger</strong> The test dragon is targeted with an attack</p><hr /><p><strong>Effect</strong> The test dragon flashes its scales. It gains ${concealment} against the triggering attack.</p>`)), { builtin: "conceal-reaction", dc: 5, ranged: false, when: "targeted" });
    assert.deepEqual(compileMonsterAbility(reaction("Test Evade", "<p><strong>Trigger</strong> A creature attacks the test drake while it is in dim light</p><hr /><p><strong>Effect</strong> The attacker must succeed at a @Check[flat|dc:11] check in order to affect the test drake, as if the drake were Hidden for the triggering attack.</p>")).dc, 11);
    assert.equal(compileMonsterAbility(reaction("Test Dodge", `<p><strong>Trigger</strong> The test dragon is targeted with a ranged Strike or spell attack</p><hr /><p><strong>Effect</strong> The test dragon slows time, gaining ${concealment} against the triggering attack.</p>`)).ranged, true);
    // "If she succeeds at a DC 16 flat check, the attack becomes a normal hit".
    assert.deepEqual(compileMonsterAbility(reaction("Test Slash", "<p><strong>Trigger</strong> an opponent critically hits the test duelist with a melee attack</p><p><strong>Effect</strong> If she succeeds at a @Check[flat|dc:16], the attack becomes a normal hit, instead of a critical hit.</p>")), { builtin: "crit-downgrade", dc: 16 });
    // Reactive Strike written out with no slug, under its older name.
    const written = "<p><strong>Trigger</strong> A creature within the monster's reach uses a manipulate action or a move action, makes a ranged attack, or leaves a square during a move action it's using.</p><p><strong>Effect</strong> The monster attempts a melee Strike against the triggering creature.</p>";
    assert.deepEqual(compileMonsterAbility(reaction("Attack of Opportunity", written)), { builtin: "attack-of-opportunity" });
    assert.deepEqual(compileMonsterAbility(reaction("Reactive Strike (Tail Only)", written)), { builtin: "reactive-strike" });
});

test("passives the creature's Strikes list are those Strikes' riders (2026-10-10, batch 13)", () => {
    const passive = (name, html) => ({ type: "action", name, system: { slug: null, actionType: { value: "passive" }, actions: { value: null }, traits: { value: [] }, description: { value: html } } });
    const actor = (...effects) => ({ name: "Test Monster", items: [{ type: "melee", name: "Claw", system: { attackEffects: { value: effects } } }] });
    const paralyzed = "@UUID[Compendium.pf2e.conditionitems.Item.6uEgoh53GbXuHpTF]{Paralyzed}";
    // A save its Strikes list: on a hit, the creature hit saves.
    const paralysis = passive("Paralysis", `<p>Any living creature hit by the test ghoul's attack must succeed at a @Check[fortitude|dc:20] save or become ${paralyzed}.</p>`);
    assert.equal(compileMonsterAbility(paralysis, { actor: actor() }).trigger.event, "passive", "no Strike lists it");
    const rider = compileMonsterAbility(paralysis, { actor: actor("paralysis") });
    assert.deepEqual([rider.trigger.event, rider.trigger.attackEffect, rider.trigger.cost, rider.trigger.on, rider.targeting.target], ["strike", "paralysis", "free", ["success", "criticalSuccess"], "the creature the Strike hits"]);
    // Its trigger clause dropped ("When the devourer damages a living creature with its claw Strike, …"); a critical hit only.
    const drain = compileMonsterAbility(passive("Drain Life", "<p>When the test wight damages a living creature with its claw Strike, the test wight gains 5 temporary Hit Points and the creature must succeed at a @Check[fortitude|dc:20] save or become @UUID[Compendium.pf2e.conditionitems.Item.4D2KBtexWXa6oUMR]{Drained 1}.</p>"), { actor: actor("drain-life") });
    assert.deepEqual([drain.trigger.event, drain.resolution.outcomes.failure.effects.map((e) => e.slug)], ["strike", ["drained"]]);
    const bite = compileMonsterAbility(passive("Bonecrunching Bite", "<p>A creature that is critically hit by the test hyaenodon must succeed at a @Check[fortitude|dc:20] save or become @UUID[Compendium.pf2e.conditionitems.Item.Yl48xTdMh3aeQYL2]{Wounded 1}.</p>"), { actor: actor("bonecrunching-bite") });
    assert.deepEqual(bite.trigger.on, ["criticalSuccess"]);
    // No roll: "A creature hit by … is Immobilized"; "If it hits a creature with its tongue, that creature becomes Grabbed".
    const web = compileMonsterAbility(passive("Web Trap", "<p>A creature hit by the test spider's web Strike is @UUID[Compendium.pf2e.conditionitems.Item.eIcWbB5o3pP6OIMe]{Immobilized} and stuck to the nearest surface until it [[/act escape dc=25]]{Escapes}.</p>"), { actor: actor("web-trap") });
    assert.deepEqual([web.resolution.check.roll, web.resolution.outcomes.success.effects.map((e) => e.slug), web.trigger.event], ["automatic", ["immobilized"], "strike"]);
    const tongue = compileMonsterAbility(passive("Tongue Grab", "<p>If the test boggard hits a creature with its tongue, that creature becomes @UUID[Compendium.pf2e.conditionitems.Item.kWc1fhmv9LBiTuei]{Grabbed} by the boggard.</p>"), { actor: actor("tongue-grab") });
    assert.deepEqual(tongue.resolution.outcomes.success.effects.map((e) => e.slug), ["grabbed"]);
    // Not on only some hits, nor on a miss too.
    assert.equal(compileMonsterAbility(passive("Static Cling", "<p>If the test gecko hits a Small or smaller creature with its tongue, and the target is made of metal, the tongue latches on. The creature must attempt a @Check[reflex|dc:17] save or become @UUID[Compendium.pf2e.conditionitems.Item.kWc1fhmv9LBiTuei]{Grabbed}.</p>"), { actor: actor("static-cling") })?.trigger?.event === "strike", false);
    assert.equal(compileMonsterAbility(passive("Color Splash", "<p>Each creature adjacent to the test elephant when it makes a foot Strike (regardless of whether or not it hit) must succeed at a @Check[will|dc:24] save or become @UUID[Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg]{Off-Guard}.</p>"), { actor: actor("color-splash") })?.trigger?.event === "strike", false);
});

test("abilities that act as the monster dies (2026-10-10, batch 14)", () => {
    const passive = (name, html) => ({ type: "action", name, system: { slug: null, actionType: { value: "passive" }, actions: { value: null }, traits: { value: [] }, description: { value: html } } });
    const skeleton = compileMonsterAbility(passive("Explosive Death", "<p>When the test skeleton is destroyed, its bones shatter and explode. Adjacent creatures take @Damage[2d6[slashing]] damage with a @Check[reflex|dc:17|basic] save.</p>"));
    assert.deepEqual([skeleton.trigger.event, skeleton.targeting.area], ["death", { type: "emanation", value: 5 }]);
    const sentinel = compileMonsterAbility(passive("Tainted Guts", "<p>When a test sentinel is reduced to 0 Hit Points, it explodes, dealing @Damage[6d6[bludgeoning]] damage to each creature in a @Template[emanation|distance:10] (@Check[reflex|dc:30|basic] save).</p>"));
    assert.deepEqual([sentinel.trigger.event, sentinel.targeting.area.value], ["death", 10]);
    const leshy = compileMonsterAbility(passive("Virulent Burst", "<p>When a test leshy dies, it releases a burst of toxic energy. Each living creature within 30 feet takes @Damage[2d6[poison]] damage (@Check[fortitude|dc:20|basic] save).</p>"));
    assert.deepEqual([leshy.trigger.event, leshy.targeting.area.value], ["death", 30]);
    // Not an aura, nor another passive.
    assert.notEqual(compileMonsterAbility(passive("Defensive Quills", "<p>A creature that hits the test pukwudgie with an unarmed Strike takes @Damage[3d8[piercing]] damage (@Check[reflex|dc:28|basic] save).</p>"))?.trigger?.event, "death");
});

test("passives that answer a melee hit on the monster, on the attacker (2026-10-10, batch 15)", () => {
    const passive = (name, html) => ({ type: "action", name, system: { slug: null, actionType: { value: "passive" }, actions: { value: null }, traits: { value: [] }, description: { value: html } } });
    const grabbed = "@UUID[Compendium.pf2e.conditionitems.Item.kWc1fhmv9LBiTuei]{Grabbed}";
    // A save the attacker attempts: any melee Strike, or an unarmed one only.
    const quills = compileMonsterAbility(passive("Test Quills", "<p>A creature that hits the test hedgehog with an unarmed Strike or a non-reach melee Strike takes @Damage[3d8[piercing]] damage (@Check[reflex|dc:28|basic] save).</p>"));
    assert.deepEqual([quills.trigger, quills.targeting.target, quills.resolution.check.statistic], [{ event: "hit-by", melee: true }, "the attacker", "reflex"]);
    const hide = compileMonsterAbility(passive("Test Hide", "<p>A creature that hits the test beast with an unarmed Strike takes @Damage[3d8[piercing]] damage (@Check[reflex|dc:28|basic] save).</p>"));
    assert.equal(hide.trigger.unarmed, true);
    // No roll: the damage on the attacker.
    const heat = compileMonsterAbility(passive("Test Heat", "<p>Any creature that hits the test elemental with a melee Strike takes @Damage[2d6[fire]] damage.</p>"));
    assert.deepEqual([heat.trigger.event, heat.resolution.check.roll, heat.resolution.outcomes.success.damage.multiplier], ["hit-by", "automatic", 1]);
    // "becomes Grabbed unless it succeeds at a save": the condition on a failure.
    const skin = compileMonsterAbility(passive("Test Skin", `<p>A creature that touches the test ooze or hits it with an unarmed attack becomes ${grabbed} unless it succeeds at a @Check[reflex|dc:20] save.</p>`));
    assert.deepEqual([skin.trigger.unarmed, skin.resolution.outcomes.failure.effects.map((e) => e.slug), skin.resolution.outcomes.success.effects], [true, ["grabbed"], []]);
    // Not only some weapons, nor a ranged attack.
    assert.notEqual(compileMonsterAbility(passive("Test Spines", "<p>A creature that hits the test beast with a metal weapon takes @Damage[2d6[electricity]] damage.</p>"))?.trigger?.event, "hit-by");
    assert.notEqual(compileMonsterAbility(passive("Test Shell", "<p>A creature that hits the test beast with a ranged Strike takes @Damage[2d6[electricity]] damage.</p>"))?.trigger?.event, "hit-by");
});

test("reactions to a hit, a critical hit or damage on the monster, or its death (2026-10-10, batch 16)", async () => {
    const { readReactionTrigger } = await import("../src/compiler/monster.js");
    const reaction = (name, html) => ({ type: "action", name, system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: html } } });
    // The trigger's words.
    assert.deepEqual(readReactionTrigger("The dragon is critically hit with a melee weapon or unarmed attack"), { event: "hit-by", reaction: true, melee: true, critical: true });
    assert.deepEqual(readReactionTrigger("The dragon is critically hit by an attack"), { event: "hit-by", reaction: true, melee: false, critical: true });
    assert.deepEqual(readReactionTrigger("A creature within the thoqqua's reach hits the thoqqua with a melee Strike"), { event: "hit-by", reaction: true, melee: true });
    assert.deepEqual(readReactionTrigger("An adjacent creature deals piercing or slashing damage to the dragon."), { event: "hit-by", reaction: true, melee: true, damageTypes: ["piercing", "slashing"] });
    assert.deepEqual(readReactionTrigger("A creature within 30 feet damages the oath howler"), { event: "hit-by", reaction: true, melee: false, within: 30 });
    assert.deepEqual(readReactionTrigger("A creature hits Krankkiss with an unarmed attack."), { event: "hit-by", reaction: true, melee: true, unarmed: true });
    assert.deepEqual(readReactionTrigger("The bul-gae takes damage"), { event: "damaged", reaction: true });
    assert.deepEqual(readReactionTrigger("The nyogoth takes piercing or slashing damage"), { event: "damaged", reaction: true, damageTypes: ["piercing", "slashing"] });
    assert.deepEqual(readReactionTrigger("The hunter wight is reduced to 0 Hit Points"), { event: "death", reaction: true });
    // Its first trigger of several ("…, or the banshee critically fails their save …").
    assert.equal(readReactionTrigger("A foe critically hits the banshee, or the banshee critically fails their save against a foe's damaging effect.").critical, true);
    // Not: an ally's damage, a number of points, an aura, a metal weapon, one of several triggers in a list.
    for (const text of ["An enemy damages an ally of the archon bastion and both are within 15 feet of the archon bastion", "Ainamuuren takes at least 40 points of physical damage from a single attack", "A creature in Caeto's aura damages him", "A creature hits the test golem with a metal weapon", "A creature damages the door, fails to Force Open the door, or fails a check to realign the stonework", "The unfinished portalrender takes any damage or is moved"]) {
        assert.equal(readReactionTrigger(text), null, text);
    }
    // On the attacker when it names it, or "the creature" first; on the creatures around it.
    const splash = compileMonsterAbility(reaction("Test Splash", "<p><strong>Trigger</strong> The dragon is critically hit with a melee weapon or unarmed attack</p><hr /><p><strong>Effect</strong> The dragon's blood erupts from the wound. The creature who dealt the triggering damage takes @Damage[7d6[bludgeoning]] damage with a @Check[reflex|dc:32|basic] save.</p>"));
    assert.deepEqual([splash.trigger.event, splash.trigger.critical, splash.targeting.target], ["hit-by", true, "the attacker"]);
    const blood = compileMonsterAbility(reaction("Test Blood", "<p><strong>Trigger</strong> An adjacent creature deals piercing or slashing damage to the dragon.</p><hr /><p><strong>Effect</strong> The dragon's blood sprays on the creature, dealing @Damage[2d6[cold]] damage.</p>"));
    assert.equal(blood.targeting.target, "the attacker");
    const caustic = compileMonsterAbility(reaction("Test Caustic", "<p><strong>Trigger</strong> The test beast takes piercing or slashing damage</p><hr /><p><strong>Effect</strong> The beast sprays its acidic blood on adjacent creatures, dealing @Damage[6d6[acid]] damage (@Check[reflex|dc:29|basic] save).</p>"));
    assert.deepEqual([caustic.trigger.event, caustic.targeting.area], ["damaged", { type: "emanation", value: 5 }]);
    // Any other reaction stays the GM's to use.
    const other = compileMonsterAbility(reaction("Test Gaze", "<p><strong>Trigger</strong> A creature within 30 feet casts a spell</p><hr /><p><strong>Effect</strong> The test beast glares. The creature takes @Damage[2d6[mental]] damage (@Check[will|dc:20|basic] save).</p>"));
    assert.equal(other.trigger.reaction, undefined);
});

test("AC reactions in other wordings (2026-10-10, batch 17): no rule, no Effect label, more after the bonus, melee or ranged only", () => {
    const reaction = (name, html) => ({ type: "action", name, system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, rules: [], description: { value: html } } });
    const bob = compileMonsterAbility(reaction("Test Bob", "<p><strong>Trigger</strong> The test jester is the target of a Strike by an attacker he can see</p><hr /><p><strong>Effect</strong> The jester gains a +2 circumstance bonus to AC against the triggering Strike.</p>"));
    assert.deepEqual(bob, { builtin: "ac-reaction", value: 2, when: "targeted" });
    // No "Effect" label; "not encumbered" is a requirement it can keep.
    const dodge = compileMonsterAbility(reaction("Test Dodge", "<p><strong>Trigger</strong> A creature targets Tobin with an attack and he can see the attacker.</p><p><strong>Requirements</strong> Tobin is not Encumbered</p><p>Tobin deftly dodges out of the way, gaining a +2 circumstance bonus to AC against the triggering attack.</p>"));
    assert.deepEqual(dodge, { builtin: "ac-reaction", value: 2, when: "targeted" });
    // More after it: a note; melee or ranged only.
    const evade = compileMonsterAbility(reaction("Test Evade", "<p><strong>Trigger</strong> An adjacent enemy targets the test swarm with a Strike</p><p><strong>Effect</strong> The swarm gains a +1 circumstance bonus to AC against the triggering attack. If the attack misses, the swarm can Stride up to 10 feet.</p>"));
    assert.deepEqual([evade.value, evade.against, evade.notes.length], [1, "melee", 1]);
    const slap = compileMonsterAbility(reaction("Test Slap", "<p><strong>Trigger</strong> The test beaver is targeted by a physical ranged Strike from an attacker it can see</p><p><strong>Effect</strong> The beaver swats at the projectile, gaining a +2 circumstance bonus to its AC against the triggering attack.</p>"));
    assert.equal(slap.against, "ranged");
    // Its own part of "itself or the bonded companion".
    const wing = compileMonsterAbility(reaction("Test Wing", "<p><strong>Trigger</strong> The test dragon or a bonded companion within 15 feet is targeted with an attack</p><p><strong>Effect</strong> The dragon raises its wing to protect itself or the bonded companion, providing a +2 circumstance bonus to AC against the triggering attack.</p>"));
    assert.equal(wing.builtin, "ac-reaction");
    // Not: an ally's AC, a requirement it can't check, a spell, one that lasts.
    for (const html of [
        "<p><strong>Trigger</strong> An ally within the test guard's reach is targeted by an attack</p><p><strong>Effect</strong> The ally gains a +2 circumstance bonus to AC against the triggering attack.</p>",
        "<p><strong>Trigger</strong> The test archer is targeted by a ranged attack</p><p><strong>Requirements</strong> The archer has a hand free</p><p><strong>Effect</strong> The archer gains a +4 circumstance bonus to AC against the triggering attack.</p>",
        "<p><strong>Trigger</strong> The test mage killer is targeted by a spell</p><p><strong>Effect</strong> It gains a +2 circumstance bonus to AC and saving throws against the triggering spell.</p>",
        "<p><strong>Trigger</strong> The test trilobite is targeted by a Strike</p><p><strong>Effect</strong> The trilobite gains a +2 circumstance bonus to AC until the start of its next turn.</p>"
    ]) assert.notEqual(compileMonsterAbility(reaction("Test", html))?.builtin, "ac-reaction", html);
});

test("abilities that answer a mental effect aimed at the monster (2026-10-10, batch 17)", async () => {
    const { readReactionTrigger } = await import("../src/compiler/monster.js");
    const passive = (name, html) => ({ type: "action", name, system: { slug: null, actionType: { value: "passive" }, actions: { value: null }, traits: { value: [] }, description: { value: html } } });
    const mind = compileMonsterAbility(passive("Test Mind", "<p>Whenever a creature targets the test hound with a mental effect, that creature takes @Damage[4d6[mental]] damage (@Check[will|dc:25|basic] save).</p>"));
    assert.deepEqual([mind.trigger.event, mind.trigger.traits, mind.targeting.target, mind.resolution.check.statistic], ["targeted-by", ["mental"], "the attacker", "will"]);
    assert.deepEqual(readReactionTrigger("A creature attempts to target the hundun with a mental effect"), { event: "targeted-by", traits: ["mental"], reaction: true });
    assert.deepEqual(readReactionTrigger("A creature targets the manipulator with a mental effect or spell"), { event: "targeted-by", traits: ["mental"], spells: true, reaction: true });
    assert.equal(readReactionTrigger("A creature targets the orb with a divination spell that has the mental trait"), null);
});

test("reactions to its own Strike, to being attacked, to a turn starting near it, and at initiative (2026-10-10, batch 18)", async () => {
    const { readReactionTrigger } = await import("../src/compiler/monster.js");
    assert.deepEqual(readReactionTrigger("The tyrannosaurus critically hits a Large or smaller foe with its foot"), { event: "own-strike", reaction: true, on: ["criticalSuccess"], strike: "foot", maxSize: "large" });
    assert.deepEqual(readReactionTrigger("Ingnovim damages a creature with a syringe Strike"), { event: "own-strike", reaction: true, on: ["success", "criticalSuccess"], strike: "syringe" });
    assert.equal(readReactionTrigger("The creeping crone critically hits a good creature with her walking stick Strike"), null, "only some creatures");
    assert.deepEqual(readReactionTrigger("A hostile creature targets the jinxer with a melee Strike"), { event: "attacked", reaction: true, melee: true });
    assert.deepEqual(readReactionTrigger("Adma is targeted with a Strike by a creature within 30 feet"), { event: "attacked", reaction: true, melee: false, within: 30 });
    assert.deepEqual(readReactionTrigger("A living creature within 30 feet that the bodak can perceive with its Lifesense starts its turn"), { event: "turn-start", reaction: true, within: 30, living: true });
    assert.deepEqual(readReactionTrigger("Losko rolls initiative"), { event: "initiative", reaction: true });
    assert.equal(readReactionTrigger("The coral juggernaut rolls initiative while in water"), null);
    assert.deepEqual(readReactionTrigger("A creature scores a critical hit on the firehoof minotaur"), { event: "hit-by", reaction: true, melee: false, critical: true });
    // Targets: the creature its Strike hit, or around it; the creature starting its turn; the creatures around it at initiative.
    const ability = (name, type, html) => ({ type: "action", name, system: { slug: null, actionType: { value: type }, actions: { value: null }, traits: { value: [] }, description: { value: html } } });
    const smite = compileMonsterAbility(ability("Test Smite", "reaction", "<p><strong>Trigger</strong> The test acolyte critically hits with a scimitar Strike</p><hr /><p><strong>Effect</strong> The acolyte releases a blast of lightning in a @Template[burst|distance:10] centered on the target. A creature in the area takes @Damage[1d6[electricity]] damage (@Check[reflex|dc:13|basic] save).</p>"));
    assert.deepEqual([smite.trigger.event, smite.targeting.area.around], ["own-strike", "target"]);
    const glance = compileMonsterAbility(ability("Test Glance", "reaction", "<p><strong>Trigger</strong> A creature within 30 feet that the test lizard can see starts its turn.</p><p><strong>Effect</strong> The target must attempt a @Check[fortitude|dc:20] save. If it fails, it's @UUID[Compendium.pf2e.conditionitems.Item.xYTAsEpcJE1Ccni3]{Slowed 1} for 1 minute.</p>"));
    assert.deepEqual([glance.trigger.event, glance.targeting.target], ["turn-start", "the attacker"]);
    const cry = compileMonsterAbility(ability("Test Cry", "free", "<p><strong>Trigger</strong> Tobin rolls initiative</p><p><strong>Effect</strong> Tobin cries out. Creatures in a @Template[type:emanation|distance:20] must succeed at a @Check[will|dc:22] save or become @UUID[Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL]{Frightened 1}.</p>"));
    assert.deepEqual([cry.trigger.event, cry.trigger.free, cry.targeting.area.value], ["initiative", true, 20]);
    // Not a creature other than the attacker ("chooses a different creature … and attempts to swap places with that creature").
    const swap = compileMonsterAbility(ability("Test Swap", "reaction", "<p><strong>Trigger</strong> A creature targets the test aberration with a Strike</p><p><strong>Effect</strong> The aberration chooses a different creature within 60 feet and attempts to swap places with that creature. The target must attempt a @Check[will|dc:39] save.</p><hr /><p><strong>Critical Success</strong> The target is unaffected.</p><p><strong>Success</strong> The target is unaffected.</p><p><strong>Failure</strong> The target is @UUID[Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg]{Off-Guard} until the end of its next turn.</p>"));
    assert.equal(swap.trigger.event, "attacked");
    assert.notEqual(swap.targeting.target, "the attacker");
});

test("passives: more death wordings, its own critical hit, damage on it (2026-10-10, batch 19)", () => {
    const passive = (name, html) => ({ type: "action", name, system: { slug: null, actionType: { value: "passive" }, actions: { value: null }, traits: { value: [] }, description: { value: html } } });
    // "When destroyed, …", "When killed, …", "… When it dies, it explodes, …".
    const skull = compileMonsterAbility(passive("Test Explosion", "<p>When destroyed, a test skull explodes in a blast of fire that deals @Damage[1d6[fire]] damage to each adjacent creature (@Check[reflex|dc:18|basic] save).</p>"));
    assert.deepEqual([skull.trigger.event, skull.targeting.area], ["death", { type: "emanation", value: 5 }]);
    const end = compileMonsterAbility(passive("Test End", "<p>The test mutant's death reveals one last surprise. When it dies, it explodes, dealing @Damage[4d6[piercing]] damage to each creature in a @Template[emanation|distance:10], with a @Check[reflex|dc:24|basic] save.</p>"));
    assert.equal(end.trigger.event, "death");
    // Not a death that a later sentence mentions ("If the creature dies, …").
    const wound = compileMonsterAbility(passive("Test Wound", "<p>A creature dealt damage by the test beast's claw Strike must succeed at a @Check[will|dc:30] save or become @UUID[Compendium.pf2e.conditionitems.Item.MIRkyAjyBeXivMa7]{Enfeebled 1}. When the creature dies, it rises as a spawn.</p>"));
    assert.notEqual(wound?.trigger?.event, "death");
    // Its own critical hit: with a firearm, an unarmed attack, any Strike; "one of its melee Strikes".
    const spec = compileMonsterAbility(passive("Test Specialization", "<p>When the test gunner makes a critical hit with a firearm, the target must succeed at a @Check[fortitude|dc:25] save or be @UUID[Compendium.pf2e.conditionitems.Item.dfCMdR4wnpbYNTix]{Stunned 1}.</p>"));
    assert.deepEqual([spec.trigger.event, spec.trigger.on, spec.trigger.weapon, spec.targeting.target], ["own-strike", ["criticalSuccess"], "firearm", "the creature the Strike hits"]);
    const brawl = compileMonsterAbility(passive("Test Brawl", "<p>When the test monk scores a critical hit with an unarmed attack, the target must succeed at a @Check[fortitude|dc:22] save or be @UUID[Compendium.pf2e.conditionitems.Item.xYTAsEpcJE1Ccni3]{Slowed 1} until the end of its next turn.</p>"));
    assert.equal(brawl.trigger.weapon, "unarmed");
    const painful = compileMonsterAbility(passive("Test Painful", "<p>The test dragon's body is encrusted with crystals. When a target takes damage from one of the dragon's melee Strikes, it must succeed at a @Check[fortitude|dc:30] save or become @UUID[Compendium.pf2e.conditionitems.Item.MIRkyAjyBeXivMa7]{Enfeebled 1}.</p>"));
    assert.deepEqual([painful.trigger.event, painful.trigger.on, painful.trigger.weapon], ["own-strike", ["success", "criticalSuccess"], "melee"]);
    assert.notEqual(compileMonsterAbility(passive("Test Blood", "<p>When a creature scores a critical hit against the test beast with a piercing or slashing Strike, each creature within 5 feet takes @Damage[2d6[poison]] damage (@Check[reflex|dc:20|basic] save).</p>"))?.trigger?.event, "own-strike");
    // Damage on it: on the creatures around it, or on the attacker; its types.
    const bile = compileMonsterAbility(passive("Test Bile", "<p>When the test head takes slashing damage, their wound spews bile on adjacent creatures, dealing @Damage[2d10[poison]] damage (@Check[fortitude|dc:19|basic] save).</p>"));
    assert.deepEqual([bile.trigger.event, bile.trigger.damageTypes, bile.targeting.area], ["damaged", ["slashing"], { type: "emanation", value: 5 }]);
    const boiling = compileMonsterAbility(passive("Test Boiling", "<p>Each time an adjacent creature deals slashing or piercing damage to the test demon, the attacker is sprayed with boiling blood, which deals @Damage[2d4[fire]] damage (@Check[reflex|dc:19|basic] save).</p>"));
    assert.deepEqual([boiling.trigger.event, boiling.trigger.melee, boiling.trigger.damageTypes, boiling.targeting.target], ["hit-by", true, ["slashing", "piercing"], "the attacker"]);
    // Not the first time each round only.
    assert.notEqual(compileMonsterAbility(passive("Test Sludge", "<p>The first time each round that the test sludge takes fire damage, a cloud roils outward, dealing @Damage[2d6[poison]] damage to each creature within 10 feet (@Check[fortitude|dc:20|basic] save).</p>"))?.trigger?.event, "damaged");
});

test("passives on a creature it holds as a turn starts or ends (2026-10-10, batch 20)", () => {
    const passive = (name, html) => ({ type: "action", name, system: { slug: null, actionType: { value: "passive" }, actions: { value: null }, traits: { value: [] }, description: { value: html } } });
    const grabbed = "@UUID[Compendium.pf2e.conditionitems.Item.kWc1fhmv9LBiTuei]{Grabbed}";
    const grasp = compileMonsterAbility(passive("Test Grasp", `<p>The test devil's tentacles leech away thought. A creature that starts its turn grabbed by the test devil must attempt a @Check[will|dc:30] save. On a failure, it's @UUID[Compendium.pf2e.conditionitems.Item.e1XGnhKNSQIm5IXg]{Stupefied 2} for 1 round.</p>`));
    assert.deepEqual([grasp.trigger.event, grasp.trigger.at, grasp.trigger.whose, grasp.trigger.hold, grasp.targeting.target], ["grab-turn", "start", "held", "grabbed", "the held creature"]);
    // Not read before: no roll ("… takes 2d6 fire damage").
    const veins = compileMonsterAbility(passive("Test Veins", `<p>Magma runs through the test elemental's veins. A creature that starts its turn ${grabbed} by the test elemental takes @Damage[2d6[fire]] damage.</p>`));
    assert.deepEqual([veins.trigger.event, veins.resolution.check.roll], ["grab-turn", "automatic"]);
    const wine = compileMonsterAbility(passive("Test Wine", "<p>When a creature ends its turn Swallowed Whole by the test vessel, it must succeed at a @Check[fortitude|dc:19] save or become @UUID[Compendium.pf2e.conditionitems.Item.fesd1n5eVhpCSS18]{Sickened 1}.</p>"));
    assert.deepEqual([wine.trigger.at, wine.trigger.hold], ["end", "swallowed"]);
    const roots = compileMonsterAbility(passive("Test Roots", `<p>At the end of the test fern's turn, all creatures ${grabbed} by the test fern take @Damage[3d6[void]] damage (@Check[fortitude|dc:29|basic] save).</p>`));
    assert.deepEqual([roots.trigger.at, roots.trigger.whose], ["end", "own"]);
    // "Whenever a test husk takes fire damage": the monster itself.
    const hair = compileMonsterAbility(passive("Test Hair", "<p>Whenever a test husk takes fire damage, all creatures other than the husk in a @Template[type:emanation|distance:10] must attempt a @Check[fortitude|dc:24] save. On a failure, they become @UUID[Compendium.pf2e.conditionitems.Item.fesd1n5eVhpCSS18]{Sickened 1}.</p>"));
    assert.deepEqual([hair.trigger.event, hair.trigger.damageTypes], ["damaged", ["fire"]]);
});

test("a condition the monster always has (2026-10-10, batch 21)", async () => {
    const { readPermanent } = await import("../src/compiler/builtins.js");
    assert.deepEqual(readPermanent("A zombie is permanently @UUID[Compendium.pf2e.conditionitems.Item.xYTAsEpcJE1Ccni3]{Slowed 1} and can't use reactions."), { builtin: "permanent-condition", conditions: [{ slug: "slowed", value: 1 }], noReactions: true });
    assert.deepEqual(readPermanent("A zombie leshy is permanently slowed 1 and can't use reactions"), { builtin: "permanent-condition", conditions: [{ slug: "slowed", value: 1 }], noReactions: true });
    assert.deepEqual(readPermanent("Tobin is permanently Quickened. She can use her extra action only to Strike."), { builtin: "permanent-condition", conditions: [{ slug: "quickened", value: null }], quickenedFor: "strike" });
    assert.deepEqual(readPermanent("The test cursed is permanently Frightened 2, which lowers its effective level by 1."), { builtin: "permanent-condition", conditions: [{ slug: "frightened", value: 2 }] });
    // Not an extra action only to move, a choice, or one with a condition of its own.
    assert.equal(readPermanent("A test golem is permanently Quickened, and it can use the extra action only to Step or Stride."), null);
    assert.equal(readPermanent("The test monger is permanently Clumsy 1, Drained 1, Enfeebled 1, or Stupefied 1 by a curse. The GM chooses the condition."), null);
    assert.equal(readPermanent("The test shade is permanently Slowed 1 while it's in sunlight."), null);
});

test("reactions to a creature acting near the monster, as Reactive Strike's triggers go (2026-10-10, batch 22)", async () => {
    const { readReactionTrigger } = await import("../src/compiler/monster.js");
    assert.deepEqual(readReactionTrigger("A creature within the test bones' reach uses a manipulate action or a move action or leaves a square during a move action it's using"), { event: "provoke", reaction: true, triggers: ["manipulate", "move", "leave"], within: "reach" });
    assert.deepEqual(readReactionTrigger("A creature within 15 feet of the test master uses a manipulate or move action, makes a ranged attack, or leaves a square during a move action it's using"), { event: "provoke", reaction: true, triggers: ["manipulate", "move", "ranged", "leave"], within: 15 });
    assert.deepEqual(readReactionTrigger("An enemy within a @Template[type:emanation|distance:10] uses a manipulate action or a move action, makes a ranged attack, or leaves a square in the area during a move action it's using"), { event: "provoke", reaction: true, triggers: ["manipulate", "move", "ranged", "leave"], within: 10 });
    assert.deepEqual(readReactionTrigger("A creature the test dragon observes within 30 feet uses a concentrate action"), { event: "provoke", reaction: true, triggers: ["concentrate"], within: 30 });
    assert.deepEqual(readReactionTrigger("A creature within 30 feet Strides"), { event: "provoke", reaction: true, triggers: ["move"], within: 30 });
    assert.deepEqual(readReactionTrigger("A creature adjacent to the test squad leaves a square during a move action it's using"), { event: "provoke", reaction: true, triggers: ["leave"], within: 5 });
    assert.deepEqual(readReactionTrigger("A creature leaves a space within Tobin's reach"), { event: "provoke", reaction: true, triggers: ["leave"], within: "reach" });
    assert.deepEqual(readReactionTrigger("A creature enters the test bird's reach or uses a move action within their reach"), { event: "provoke", reaction: true, triggers: ["enter", "move"], within: "reach" });
    // Not one in a place, or an aura it leaves.
    for (const text of ["a creature attempts a Move action in area A7", "A creature Strides beneath the portcullis while it is raised", "A creature attempts to leave the test lantern's aura during a move action"]) assert.equal(readReactionTrigger(text), null, text);
    // On the creature that acted.
    const reaction = { type: "action", name: "Test Filaments", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: "<p><strong>Trigger</strong> A creature within the test bones' reach uses a manipulate action or a move action</p><p><strong>Effect</strong> Filaments lash out. The creature must succeed at a @Check[reflex|dc:24] save or become @UUID[Compendium.pf2e.conditionitems.Item.eIcWbB5o3pP6OIMe]{Immobilized} for 1 round.</p>" } } };
    const plan = compileMonsterAbility(reaction);
    assert.deepEqual([plan.trigger.event, plan.targeting.target], ["provoke", "the attacker"]);
});

test("abilities that cast a spell, in more wordings (2026-10-10, batch 23)", () => {
    const action = (name, html, type = "action") => ({ type: "action", name, system: { slug: null, actionType: { value: type }, actions: { value: 2 }, traits: { value: [] }, description: { value: html } } });
    const killer = "@UUID[Compendium.pf2e.spells-srd.Item.4gBIw4IDrSfFHik4]{Phantasmal Killer}";
    const subjected = compileMonsterAbility(action("Test Breath", `<p>Phantasms escape from its maw in a @Template[cone|distance:30]. Each creature in the area is subjected to a 5th-rank ${killer} spell (@Check[will|dc:31] save).</p>`));
    assert.deepEqual([subjected.builtin, subjected.spell.name, subjected.rank, subjected.dc, subjected.self], ["cast-spell", "Phantasmal Killer", 5, 31, false]);
    const affecting = compileMonsterAbility(action("Test Cry", `<p>Cries echo off the crystals, affecting all living creatures in the room with ${killer} (7th level, @Check[will|dc:33] save).</p>`, "reaction"));
    assert.deepEqual([affecting.spell.name, affecting.rank, affecting.dc], ["Phantasmal Killer", 7, 33]);
    // On itself: "The eloko is affected by a 4th-rank Enlarge spell".
    const enlarge = compileMonsterAbility(action("Test Size", "<p>The test sprite is affected by a 4th-rank @UUID[Compendium.pf2e.spells-srd.Item.UOKVq2zeHg3yGqv2]{Enlarge} spell.</p>"));
    assert.deepEqual([enlarge.spell.name, enlarge.self], ["Enlarge", true]);
    // Not when a check or damage before it brings what the spell wouldn't.
    assert.equal(compileMonsterAbility(action("Test Spikes", `<p>The creature must succeed at a @Check[acrobatics|dc:27] check or take @Damage[1d6[piercing]] damage. Additionally, a creature damaged by the spikes is affected by ${killer}.</p>`))?.builtin === "cast-spell", false);
});

test("built-in readings with linked words (2026-10-10, batch 23): Coiling Frenzy's linked Grab", () => {
    const action = (name, html) => ({ type: "action", name, system: { slug: null, actionType: { value: "action" }, actions: { value: 2 }, traits: { value: [] }, description: { value: html } } });
    const frenzy = compileMonsterAbility(action("Test Frenzy", "<p>The dragon makes one claw Strike and one tail Strike in either order, each against the same target. If either Strike hits, the dragon can attempt to @UUID[Compendium.pf2e.bestiary-ability-glossary-srd.Item.Tkd8sH4pwFIPzqTr]{Grab} the target with that limb as a free action. The dragon can have up to three creatures @UUID[Compendium.pf2e.conditionitems.Item.kWc1fhmv9LBiTuei]{Grabbed} or Restrained at a time; one in each of its front claws, and a third with their tail.</p>"));
    assert.deepEqual([frenzy.builtin, frenzy.strikes, frenzy.grab], ["multi-strike", ["claw", "tail"], true]);
    const automatic = compileMonsterAbility(action("Test Frenzy 2", "<p>The dragon makes one claw Strike and one tail Strike in either order, each against the same target. If either Strike hits, the dragon automatically Grabs the target.</p>"));
    assert.equal(automatic.grab, true);
});

test("the monster healing itself (2026-10-10, batch 24)", () => {
    const action = (name, html) => ({ type: "action", name, system: { slug: null, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: [] }, description: { value: html } } });
    const quasit = compileMonsterAbility(action("Test Healing", "<p><strong>Frequency</strong> once per round</p><p><strong>Effect</strong> The test imp restores @Damage[1d6[healing]] HP to itself.</p>"));
    assert.deepEqual([quasit.targeting.target, quasit.resolution.kind, quasit.resolution.native.healing.components[0].formula, quasit.requires], ["self", "healing", "1d6", undefined]);
    const splint = compileMonsterAbility(action("Test Splint", "<p>The test tree grows a mesh of vines around its broken branches, repairing the damage and restoring @Damage[40[healing]] HP to itself. The test tree can't use Test Splint again for [[/gmr 1d4 #Recharge Test Splint]]{1d4 rounds}.</p>"));
    assert.deepEqual([splint.resolution.native.healing.components[0].formula, splint.trigger.recharge.formula], ["40", "1d4"]);
    // Requirements: kept for the GM (the simulator doesn't use it).
    const regen = compileMonsterAbility(action("Test Regeneration", "<p><strong>Requirements</strong> The test troll's regeneration is currently active The test troll regains @Damage[20[healing]] HP.</p>"));
    assert.match(regen.requires, /regeneration is currently active/);
    // Not healing others, nor some of the time.
    assert.equal(compileMonsterAbility(action("Test Pulse", "<p>The turtle releases a pulse, restoring @Damage[5d8[healing]] Hit Points to the turtle and each living ally within 10 feet.</p>"))?.resolution?.kind === "healing", false);
    assert.equal(compileMonsterAbility(action("Test Feed", "<p>The test imp regains @Damage[10[healing]] Hit Points for each enemy within 30 feet that is frightened.</p>"))?.resolution?.kind === "healing", false);
});

test("more charge and Strike-activity wordings (2026-10-10, batch 25)", () => {
    const action = (name, html, actions = 2) => ({ type: "action", name, system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: html } } });
    // One move and a Strike in 2 actions (Swoop); "Strides, then Strikes" in 1.
    assert.deepEqual(compileMonsterAbility(action("Test Swoop", "<p>The test reptile Flies up to its Speed and makes one beak Strike at any point during that movement.</p>")), { builtin: "charge", actions: 2, strides: 1, strike: "beak" });
    assert.deepEqual(compileMonsterAbility(action("Test Pounce", "<p>Tobin Strides, then Strikes.</p>", 1)), { builtin: "charge", actions: 1, strides: 1, strike: null });
    // "Strides up to two times"; "he gains … his attack roll"; "from its starting position"; an inline roll.
    assert.equal(compileMonsterAbility(action("Test Boar", "<p>The test boar Strides up to two times and then makes a tusk Strike. As long as it moved at least 20 feet, it gains a +2 circumstance bonus to its attack roll.</p>")).attackBonus, 2);
    assert.equal(compileMonsterAbility(action("Test Ram", "<p>Tobin Strides twice and then makes a horns Strike. As long as he moved at least 20 feet, he gains a +2 circumstance bonus to his attack roll.</p>")).attackBonus, 2);
    assert.equal(compileMonsterAbility(action("Test Effigy", "<p>The test effigy Strides twice and then makes a horn Strike. If it moved at least 20 feet from its starting position, the Strike's damage is increased to @Damage[(3d10+10)[piercing]] damage.</p>")).damage, "(3d10+10)[piercing]");
    // "A Medium or smaller creature damaged by this attack must succeed at …".
    const moose = compileMonsterAbility(action("Test Moose", "<p>The test moose Strides twice and then makes an antler Strike. A Medium or smaller creature damaged by this attack must succeed at a @Check[fortitude|dc:17] save or be @UUID[Compendium.pf2e.conditionitems.Item.dfCMdR4wnpbYNTix]{Stunned 1}.</p>"));
    assert.deepEqual([moose.builtin, moose.onHit.size, moose.onHit.save.resolution.check.statistic], ["strike-activity", "medium", "fortitude"]);
});

test("a condition the monster gives itself or its allies (2026-10-10, batch 26)", () => {
    const ability = (name, html, type = "action") => ({ type: "action", name, system: { slug: null, actionType: { value: type }, actions: { value: 1 }, traits: { value: [] }, description: { value: html } } });
    const invisible = "@UUID[Compendium.pf2e.conditionitems.Item.zJxUflt9np0q4yML]{Invisible}";
    const quickened = "@UUID[Compendium.pf2e.conditionitems.Item.nlCjDvLMf2EkV2dl]{Quickened}";
    const dark = compileMonsterAbility(ability("Test Dark", `<p>The test wisp extinguishes its glow, becoming ${invisible}. It can end this effect with another use of this action.</p>`));
    assert.deepEqual([dark.targeting.target, dark.resolution.check.roll, dark.resolution.outcomes.success.effects[0].slug, dark.notes.length], ["self", "automatic", "invisible", 1]);
    // As its turn begins, a free action: quickened until the end of her turn.
    const frenzy = compileMonsterAbility(ability("Test Frenzy", `<p><strong>Trigger</strong> Tobin's turn begins.</p><p><strong>Frequency</strong> once per hour</p><p><strong>Effect</strong> Tobin is ${quickened} until the end of her turn, and can use the extra action to Stride or Strike.</p>`, "free"));
    assert.deepEqual([frenzy.trigger.event, frenzy.trigger.free, frenzy.resolution.outcomes.success.effects[0].duration.expiry], ["own-turn-start", true, "turn-end"]);
    // Allies: "All allies who hear or see him are Quickened for 1 round".
    const command = compileMonsterAbility(ability("Test Command", `<p>Tobin commands his allies. All allies who hear or see him are ${quickened} for 1 round and can use this extra action to Step, Stride, or make a Strike.</p>`));
    assert.deepEqual([command.targeting.target, command.targeting.allies], ["allies", true]);
    const royal = compileMonsterAbility(ability("Test Royal", `<p>Tobin issues an order. Each ally who hears and understands this command becomes ${quickened} until the end of that ally's next turn but can use the extra action only to Strike.</p>`));
    assert.deepEqual([royal.targeting.allies, royal.resolution.outcomes.success.effects[0].duration.expiry], [true, "turn-end"]);
    // Not another creature ("The animal … becomes Quickened").
    assert.equal(compileMonsterAbility(ability("Test Lead", `<p>The test gnome inspires a willing animal. The animal becomes ${quickened} for 1 round.</p>`))?.targeting?.target === "self", false);
});

test("Steady Spellcasting, Golem Antimagic, and healing as it dies for creatures of a kind (2026-10-10, batch 28)", async () => {
    const { golemAnswer, traitsFit } = await import("../src/live/reactions.js");
    const passive = (name, html) => ({ type: "action", name, system: { slug: null, actionType: { value: "passive" }, actions: { value: null }, traits: { value: [] }, description: { value: html } } });
    // Steady Spellcasting: its flat check's DC.
    const steady = compileMonsterAbility(passive("Steady Spellcasting", "<p>If another creature's reaction would disrupt the test mage's spellcasting action, the test mage attempts a @Check[flat|dc:15]. On a success, the action isn't disrupted.</p>"));
    assert.deepEqual(steady, { builtin: "steady-spellcasting", dc: 15 });
    // Golem Antimagic: what harms, heals and slows it, with the amounts.
    const golem = compileMonsterAbility(passive("Golem Antimagic", "<p>Harmed by cold and water (@Damage[5d10[untyped]], @Damage[2d8[untyped]] from areas or persistent damage); healed by acid (area @Damage[2d8[healing]] HP); slowed by earth @Localize[PF2E.NPC.Abilities.Glossary.GolemAntimagic]</p>"));
    assert.deepEqual(golem, { builtin: "golem-antimagic", harmed: { by: ["cold", "water"], damage: "5d10", area: "2d8" }, healed: { by: ["acid"], area: "2d8" }, slowed: { by: ["earth"] } });
    assert.deepEqual(golemAnswer(golem, { kinds: ["concentrate", "Cold"] }), { kind: "harmed", formula: "5d10" });
    assert.deepEqual(golemAnswer(golem, { kinds: ["water"], area: true }), { kind: "harmed", formula: "2d8" });
    assert.deepEqual(golemAnswer(golem, { kinds: ["acid"] }), { kind: "healed", formula: null });
    assert.deepEqual(golemAnswer(golem, { kinds: ["earth"] }), { kind: "slowed", rounds: null });
    assert.deepEqual(golemAnswer(golem, { kinds: ["fire"] }), { kind: "immune" });
    // Verdant Burst: healing as it dies, for plant creatures only; its other words for the GM.
    const burst = compileMonsterAbility(passive("Verdant Burst", "<p>When a test leshy dies, a burst of primal energy explodes from its body, restoring @Damage[2d8[healing]] Hit Points to each plant creature in a @Template[emanation|distance:30]. The area is filled with flowers, becoming difficult terrain.</p>"));
    assert.deepEqual([burst.trigger.event, burst.targeting.area, burst.targeting.traits, burst.resolution.native.healing.components[0].formula, burst.notes], ["death", { type: "emanation", value: 30 }, { any: ["plant"] }, "2d8", ["The area is filled with flowers, becoming difficult terrain."]]);
    const rotten = compileMonsterAbility(passive("Rotten Burst", "<p>When a test zombie leshy dies, a burst of void energy explodes from its body, restoring @Damage[1d8[healing,void]]{1d8} Hit Points to each undead fungi or plant creature in a @Template[type:emanation|distance:30].</p>"));
    assert.deepEqual(rotten.targeting.traits, { all: ["undead"], any: ["fungus", "plant"] });
    assert.deepEqual([traitsFit(["plant", "leshy"], burst.targeting.traits), traitsFit(["animal"], burst.targeting.traits), traitsFit(["plant"], rotten.targeting.traits), traitsFit(["undead", "fungus"], rotten.targeting.traits)], [true, false, false, true]);
});

test("riders that name their Strike, critical hits only, and natural invisibility (2026-10-10, batch 28)", () => {
    const passive = (name, html) => ({ type: "action", name, system: { slug: null, actionType: { value: "passive" }, actions: { value: null }, traits: { value: [] }, description: { value: html } } });
    const melee = (name, effects = []) => ({ type: "melee", name, system: { attackEffects: { value: effects } } });
    const offGuard = "@UUID[Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg]{Off-Guard}";
    // "Creatures hit by … are": the creature hit as the subject; the Strike lists it.
    const blow = compileMonsterAbility(passive("Test Blow", `<p>Creatures hit by the test automaton's blade hand Strike are ${offGuard} until the start of the test automaton's next turn.</p>`), { actor: { items: [melee("Blade Hand", ["test-blow"])] } });
    assert.deepEqual([blow.trigger.event, blow.trigger.attackEffect, blow.resolution.outcomes.success.effects[0].slug], ["strike", "test-blow", "off-guard"]);
    // Not listed, but named: a rider of the Strike it names; a critical hit's only.
    const gore = compileMonsterAbility(passive("Test Gore", "<p>A creature critically hit by the test stag's antler Strike is @UUID[Compendium.pf2e.conditionitems.Item.dfCMdR4wnpbYNTix]{Stunned 1}.</p>"), { actor: { items: [melee("Antler")] } });
    assert.deepEqual([gore.trigger.strikes, gore.trigger.on, gore.resolution.outcomes.success.effects[0].slug], [["antler"], ["criticalSuccess"], "stunned"]);
    // A critical hit's sentence after a hit's: not the hit's ("A creature critically hit by … is Immobilized").
    const guts = compileMonsterAbility(passive("Test Guts", `<p>A creature hit by the test model's guts attack is ${offGuard} until it takes an action to remove the guts. A creature critically hit by the test model's guts attack is @UUID[Compendium.pf2e.conditionitems.Item.eIcWbB5o3pP6OIMe]{Immobilized} until it Escapes.</p>`), { actor: { items: [melee("Guts", ["test-guts"])] } });
    assert.ok(!(guts?.resolution?.outcomes?.success?.effects ?? []).some((effect) => effect.slug === "immobilized"));
    // Naturally invisible: a condition it always has; not one only somewhere.
    assert.deepEqual(compileMonsterAbility(passive("Natural Invisibility", "<p>A test spirit is naturally Invisible. It becomes visible only when it uses Frighten.</p>")), { builtin: "permanent-condition", conditions: [{ slug: "invisible", value: null }] });
    assert.deepEqual(compileMonsterAbility(passive("Naturally Invisible", "<p>The test wisp is Invisible at all times, though when it takes a hostile action of any kind, it is Hidden instead of undetected until the start of its next turn.</p>")).conditions, [{ slug: "invisible", value: null }]);
    assert.equal(compileMonsterAbility(passive("Shy", "<p>A test sprite is naturally Invisible while within sight of their bound home.</p>"))?.builtin, undefined);
});

test("critical hits made normal hits, resistance against a critical hit, dodges and more reaction triggers (2026-10-10, batch 29)", async () => {
    const { readReactionTrigger } = await import("../src/compiler/monster.js");
    const reaction = (name, html, type = "reaction") => ({ type: "action", name, system: { slug: null, actionType: { value: type }, actions: { value: null }, traits: { value: [] }, frequency: type === "free" ? { max: 1, per: "day" } : null, description: { value: html } } });
    const immobilized = "@UUID[Compendium.pf2e.conditionitems.Item.eIcWbB5o3pP6OIMe]{Immobilized}";
    const offGuard = "@UUID[Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg]{Off-Guard}";
    // Collapse: no check; immobilized and off-guard until it re-forms.
    assert.deepEqual(compileMonsterAbility(reaction("Collapse", `<p><strong>Trigger</strong> The test skeleton is critically hit</p><p><strong>Effect</strong> The test skeleton collapses into a pile of bones and the attack deals only normal damage. The skeleton can reform in a standing position as an action, but until it does, it is ${immobilized} and ${offGuard}.</p>`)), { builtin: "crit-downgrade", dc: null, collapse: true });
    assert.deepEqual(compileMonsterAbility(reaction("Twist Fate", "<p><strong>Trigger</strong> A creature critically hits the test norn</p><p><strong>Effect</strong> The test norn manipulates fortune in her favor. The triggering attack becomes a hit instead.</p>")), { builtin: "crit-downgrade", dc: null });
    assert.deepEqual(compileMonsterAbility(reaction("Luck", "<p><strong>Trigger</strong> The test captain takes a critical hit or critically fails a saving throw</p><p><strong>Effect</strong> The critical hit becomes a normal hit, or the critical failure becomes a normal failure.</p>", "free")), { builtin: "crit-downgrade", dc: null, uses: 1 });
    // Resistance against the critical hit.
    assert.deepEqual(compileMonsterAbility(reaction("Wished Away", "<p><strong>Trigger</strong> The test dragon is critically hit by an attack</p><p><strong>Effect</strong> The test dragon wishes not to be hurt by this attack, gaining resistance 20 to all damage against the triggering attack.</p>")), { builtin: "crit-resistance", value: 20 });
    // Nimble Dodge's older wording, with its Encumbered requirement.
    assert.deepEqual(compileMonsterAbility(reaction("Nimble Dodge", "<p><strong>Requirements</strong> The test rogue can't use this reaction while Encumbered.</p><p><strong>Trigger</strong> The test rogue is hit or critically hit by an attack made by a creature the test rogue can see.</p><p><strong>Effect</strong> The test rogue gains a +2 circumstance bonus to their Armor Class against the triggering attack.</p>")), { builtin: "ac-reaction", value: 2, when: "hit" });
    // More triggers.
    assert.deepEqual(readReactionTrigger("The test golem is hit by an attack or spell attack from an enemy within 30 feet"), { event: "hit-by", reaction: true, melee: false, within: 30 });
    assert.deepEqual(readReactionTrigger("A Strike deals fire damage to the test elemental"), { event: "hit-by", reaction: true, melee: false, damageTypes: ["fire"] });
    assert.deepEqual(readReactionTrigger("The test wall would take damage from a melee attack"), { event: "hit-by", reaction: true, melee: true });
    assert.deepEqual(readReactionTrigger("The test troll would take sonic damage"), { event: "damaged", reaction: true, damageTypes: ["sonic"] });
    assert.deepEqual(readReactionTrigger("The test treant is dealt fire or cold damage"), { event: "damaged", reaction: true, damageTypes: ["fire", "cold"] });
    assert.deepEqual(readReactionTrigger("The test guardian is damaged by a creature within their reach"), { event: "hit-by", reaction: true, melee: true });
    // A champion's reaction in its own words: the glossary Retributive Strike's, with its resistance.
    assert.deepEqual(compileMonsterAbility(reaction("Test Protection", "<p><strong>Trigger</strong> An enemy damages the test archon's ally and both are within 15 feet of the test archon</p><p><strong>Effect</strong> The ally gains resistance 15 to all damage against the triggering damage and the test archon can make a Strike against the enemy.</p>")), { builtin: "retributive-strike", resistance: 15 });
});

test("more multi-Strike wordings (2026-10-10, batch 30)", () => {
    const action = (name, html, actions = 2) => ({ type: "action", name, system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: html } } });
    const pick = (plan) => ({ strikes: plan.strikes, sameMap: plan.sameMap, sameTarget: plan.sameTarget, each: plan.each, penalty: plan.penalty, requires: plan.requires, after: plan.after, oncePerTurn: plan.oncePerTurn });
    // Flurry of Blows: damage combined, the penalty as normal, once a turn as a flourish.
    assert.deepEqual(pick(compileMonsterAbility(action("Flurry of Blows", "<p>The test monk makes two fist Strikes. If both hit the same creature, combine their damage for the purpose of resistances and weaknesses. She applies her multiple attack penalty to the Strikes normally. As it has the flourish trait, the test monk can use Flurry of Blows only once per turn.</p>", 1))), { strikes: ["fist", "fist"], sameMap: undefined, sameTarget: undefined, each: undefined, penalty: undefined, requires: undefined, after: undefined, oncePerTurn: true });
    // Flying Strafe: a Strike at different creatures during its move.
    assert.deepEqual(pick(compileMonsterAbility(action("Test Strafe", "<p>The test hawk Flies up to its fly Speed and makes two talon Strikes at any point during that movement. Each Strike must target a different creature. The attacks take the normal multiple attack penalty.</p>"))).each, true);
    // Hungry Flurry: each at a -2 penalty, at different targets, the penalty not rising.
    assert.deepEqual(pick(compileMonsterAbility(action("Test Flurry", "<p>The test plant makes four leaf Strikes at a -2 penalty, each against a different target. These attacks count toward the test plant's multiple attack penalty, but the multiple attack penalty doesn't increase until after it makes all its attacks.</p>"))), { strikes: ["leaf", "leaf", "leaf", "leaf"], sameMap: true, sameTarget: undefined, each: true, penalty: 2, requires: undefined, after: undefined, oncePerTurn: undefined });
    // Frenzied Slashes: the same creature, -2 each, Clumsy 2 after.
    assert.deepEqual(pick(compileMonsterAbility(action("Test Slashes", "<p>The test imp makes three claw Strikes, each at a -2 penalty, all targeting the same creature. The test imp's multiple attack penalty doesn't increase until after it has made all three attacks. The test imp gains the Clumsy 2 condition until the beginning of its next turn.</p>", 3))).after, [{ slug: "clumsy", value: 2, until: "own-turn-start" }]);
    // Maul: against the creature it holds.
    const maul = compileMonsterAbility(action("Test Maul", "<p>The test cat makes two claw Strikes against a creature it has Grabbed. Both count toward its multiple attack penalty, but the penalty increases only after both attacks are made.</p>", 1));
    assert.deepEqual([maul.requires, maul.sameTarget, maul.sameMap], ["grabbed", true, true]);
    // Double Shot: the current penalty, -2 each, different creatures in the first range increment.
    assert.deepEqual(pick(compileMonsterAbility(action("Test Shot", "<p>The test archer makes two shortbow Strikes targeting two different creatures within the shortbow's first range increment. Both Strikes use the test archer's current multiple attack penalty, but each strike takes a –2 penalty.</p>", 1))), { strikes: ["shortbow", "shortbow"], sameMap: true, sameTarget: undefined, each: true, penalty: 2, requires: undefined, after: undefined, oncePerTurn: undefined });
    // Rapid Strikes ("attempts"), Draconic Frenzy with no final period.
    assert.equal(compileMonsterAbility(action("Test Rapid", "<p>The test ghoul attempts three claw Strikes, each against a different target within reach. The multiple attack penalty applies to each attack, but increases only after all the attacks have been made.</p>")).sameMap, true);
    assert.deepEqual(compileMonsterAbility(action("Draconic Frenzy", "<p>The test dragon makes two claw Strikes and one tail Strike in any order</p>")).strikes, ["claw", "claw", "tail"]);
});

test("Blood Drain and the Drink Blood family (2026-10-10, batch 31)", () => {
    const action = (name, html) => ({ type: "action", name, system: { slug: null, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: [] }, description: { value: html } } });
    const grabbed = "@UUID[Compendium.pf2e.conditionitems.Item.kWc1fhmv9LBiTuei]{Grabbed}";
    const drained = (value) => `@UUID[Compendium.pf2e.conditionitems.Item.4D2KBtexWXa6oUMR]{Drained ${value}}`;
    // Blood Drain: damage on the creature it holds, Drained until healed, temporary Hit Points equal to the damage.
    const drain = compileMonsterAbility(action("Blood Drain", `<p><strong>Requirements</strong> The test leech has a creature ${grabbed}</p><p><strong>Effect</strong> The test leech drives its mouth into the grabbed creature to drink its blood. This deals @Damage[4d6[untyped]] damage, and the test leech gains temporary Hit Points equal to the damage dealt. A creature whose blood is drained by the test leech is ${drained(1)} until it receives healing (of any kind or amount).</p>`));
    assert.deepEqual([drain.targeting.grabbed, drain.resolution.check.roll, drain.resolution.outcomes.success.damage.formulas, drain.resolution.outcomes.success.effects], [true, "automatic", [{ formula: "4d6[untyped]" }], [{ kind: "condition", slug: "drained", value: 1, duration: null }, { kind: "temp-hp", fromDamage: true, recipient: "self" }]]);
    // Only for some creatures: the GM's.
    const plant = compileMonsterAbility(action("Vitality Drain", `<p><strong>Requirements</strong> The test vine has a creature ${grabbed}</p><p><strong>Effect</strong> The test vine drains blood or ichor from the creature it has grabbed, dealing @Damage[2d6[untyped]] damage. If the creature has the plant trait, the test vine gains temporary Hit Points equal to the damage dealt. A creature that has its vitality drained by the test vine is ${drained(1)} until it receives healing of any kind or amount.</p>`));
    assert.match(plant.resolution.reminders[1], /^If \{target\} has the plant trait, \{source\} gains temporary Hit Points/);
    // Slurp Blood: Athletics against Fortitude, damage, and its healing on the card (any excess as temporary Hit Points).
    const slurp = compileMonsterAbility(action("Slurp Blood", "<p><strong>Requirements</strong> A Grabbed, Paralyzed, Restrained, Unconscious, or willing creature is within the test ghoul's reach</p><p><strong>Effect</strong> The test ghoul bites the creature, slurping its blood. This requires an Athletics check against the target's Fortitude DC if the victim is grabbed and is automatic for any of the other conditions. The victim takes @Damage[(1d6+1)[piercing]] damage and the test ghoul regains @Damage[3[healing]] Hit Points, gaining any excess HP as temporary HP.</p>"));
    assert.deepEqual([slurp.resolution.check.statistic, slurp.resolution.outcomes.success.effects], ["athletics", [{ kind: "heal", amount: 3, excessAsTemp: true, recipient: "self" }]]);
    // Drain Thoughts: its own condition, more on a critical success; healing left to the GM when it depends on the victim.
    const thoughts = compileMonsterAbility(action("Drain Thoughts", "<p><strong>Requirements</strong> A Grabbed, Paralyzed, Restrained, Unconscious, or willing creature is within the test vampire's reach</p><p><strong>Effect</strong> The test vampire seizes a creature and consumes its memories. This requires an @Check[athletics|defense:fortitude] check against the victim's Fortitude DC if the victim is grabbed and is automatic for any of the other conditions. The victim is Stupefied 1 (Stupefied 2 if the test vampire's Athletics check is a critical success), and the test vampire regains @Damage[18[healing]] Hit Points, gaining any excess as temporary Hit Points. Draining Thoughts from a creature that is already stupefied doesn't restore any HP to the test vampire.</p>"));
    assert.deepEqual([thoughts.resolution.outcomes.success.effects[0].value, thoughts.resolution.outcomes.criticalSuccess.effects[0].value], [1, 2]);
    assert.match(thoughts.resolution.reminders[0], /regains 18 Hit Points \(any excess as temporary Hit Points\), unless \{target\} was already stupefied/);
});

test("a rage or frenzy on itself, for the simulator (2026-10-10, batch 32)", () => {
    const action = (name, html, type = "action") => ({ type: "action", name, system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? 1 : null }, traits: { value: [] }, description: { value: html } } });
    const rage = compileMonsterAbility(action("Rage", "<p>The test brute flies into a rage. He gains 6 temporary Hit Points, deals 2 additional damage with melee Strikes, takes a -1 penalty to AC, and can't use other actions with the concentrate trait. This effect lasts for 1 minute.</p><p>@UUID[Compendium.pf2e.feat-effects.Item.z3uyCMBddrPK5umr]{Effect: Rage}</p>"));
    assert.deepEqual(rage, { builtin: "self-effect", actions: 1, model: { name: "Rage", rounds: 10, modifiers: [{ on: "damage", type: "untyped", value: 2 }, { on: "ac", type: "untyped", value: -1 }], tempHp: 6 }, noConcentrate: true });
    // "has taken damage": once it's hurt; temporary Hit Points from its level and Constitution.
    const frenzy = compileMonsterAbility(action("Fanatical Frenzy", "<p><strong>Requirements</strong> The test zealot has taken damage and is neither Fatigued nor already in a frenzy</p><p><strong>Effect</strong> The test zealot flies into a frenzy that lasts 1 minute. While frenzied, it gains a +1 status bonus to attack rolls and a +2 status bonus to damage rolls, but takes a –2 penalty to AC.</p>"));
    assert.deepEqual([frenzy.whenHurt, frenzy.model.modifiers.map((modifier) => [modifier.on, modifier.value])], [true, [["damage", 2], ["attack", 1], ["ac", -2]]]);
    const leveled = compileMonsterAbility(action("Rage", "<p><strong>Requirements</strong> The test raider isn't Fatigued or raging</p><p><strong>Effect</strong> The test raider begins raging. It gains a number of temporary Hit Points equal to its level plus its Constitution modifier. While raging, it deals 2 additional damage on melee Strikes.</p>"), { actor: { system: { details: { level: { value: 5 } }, abilities: { con: { mod: 3 } } } } });
    assert.equal(leveled.model.tempHp, 8);
    // Not with a requirement it can't check, nor with a trigger.
    assert.equal(compileMonsterAbility(action("Scent of Blood", "<p><strong>Requirements</strong> A creature within the test beast's scent range is taking bleed damage</p><p><strong>Effect</strong> The test beast flies into a frenzy, gaining 10 temporary HP for 1 minute and a +4 status bonus to damage rolls.</p>"))?.builtin, undefined);
});

test("triggered rages and frenzies (2026-10-10, batch 33)", () => {
    const item = (name, html, type) => ({ type: "action", name, system: { slug: null, actionType: { value: type }, actions: { value: null }, traits: { value: [] }, description: { value: html } } });
    const frenzy = compileMonsterAbility(item("Blood Frenzy", "<p><strong>Requirements</strong> The test shark is not Fatigued or already in a frenzy.</p><p><strong>Trigger</strong> The test shark deals bleed damage to a living creature.</p><p><strong>Effect</strong> The test shark flies into a frenzy that lasts 1 minute. While frenzied, the test shark gains a +4 status bonus to damage rolls with its jaws, gains 8 temporary HP that go away at the end of the frenzy, and takes a -2 penalty to AC.</p>", "free"));
    assert.deepEqual([frenzy.builtin, frenzy.actions, frenzy.trigger, frenzy.model.tempHp], ["self-effect", 0, { kind: "deals-bleed" }, 8]);
    const vengeful = compileMonsterAbility(item("Vengeful Rage", "<p><strong>Requirements</strong> The test chieftain is not Fatigued or already in a rage</p><p><strong>Trigger</strong> The test chieftain suffers damage that reduces its Hit Points to 100 or less.</p><p><strong>Effect</strong> The test chieftain flies into a rage that lasts 1 minute. While raging, the test chieftain gains a +1 status bonus to attack rolls, gains a +2 status bonus to damage rolls, and takes a -2 status penalty to AC.</p>", "reaction"));
    assert.deepEqual(vengeful.trigger, { kind: "hp-at-most", value: 100, reaction: true });
    const hungry = compileMonsterAbility(item("Hungry Rage", "<p><strong>Trigger</strong> The test ogre damages a living creature with his jaws Strike</p><p><strong>Effect</strong> The taste of blood throws the test ogre into a violent rage. He gains 9 temporary Hit Points, deals an additional 2 damage with melee Strikes, and takes a -1 penalty to AC for 1 minute.</p>", "reaction"));
    assert.deepEqual(hungry.trigger, { kind: "own-hit", strike: "jaws", reaction: true });
    // Not one that also attacks its allies, nor another trigger.
    assert.equal(compileMonsterAbility(item("Test Rage", "<p><strong>Trigger</strong> The test dragon is 200 Hit Points or below and takes damage.</p><p><strong>Effect</strong> The test dragon becomes enraged. It gains 35 temporary Hit Points. It attacks bystanders and allies afterward.</p>", "free"))?.builtin, undefined);
});

test("a rider with a critical hit's alternative, by the Strike's degree (2026-10-10, batch 34)", () => {
    const passive = (name, html) => ({ type: "action", name, system: { slug: null, actionType: { value: "passive" }, actions: { value: null }, traits: { value: [] }, description: { value: html } } });
    const actor = { items: [{ type: "melee", name: "Jaws", system: { attackEffects: { value: ["test-weakening"] } } }] };
    const plan = compileMonsterAbility(passive("Test Weakening", "<p>A creature hit by a test lizard's jaws Strike is @UUID[Compendium.pf2e.conditionitems.Item.MIRkyAjyBeXivMa7]{Enfeebled 1} (or @UUID[Compendium.pf2e.conditionitems.Item.MIRkyAjyBeXivMa7]{Enfeebled 2} on a critical hit) for 1 round.</p>"), { actor });
    const values = (row) => plan.resolution.outcomes[row].effects.map((effect) => [effect.slug, effect.value, effect.duration?.value]);
    assert.deepEqual([plan.trigger.event, plan.resolution.check.statistic, values("success"), values("criticalSuccess")], ["strike", "strike", [["enfeebled", 1, 1]], [["enfeebled", 2, 1]]]);
    // "for 2 rounds, or for 4 rounds on a critical hit" (a made-up example).
    const longer = compileMonsterAbility(passive("Test Spit", "<p>A creature hit by a test lizard's jaws Strike is @UUID[Compendium.pf2e.conditionitems.Item.TkIyaNPgTZFBCCuh]{Dazzled} for 2 rounds, or for 4 rounds on a critical hit.</p>"), { actor: { items: [{ type: "melee", name: "Jaws", system: { attackEffects: { value: ["test-spit"] } } }] } });
    assert.deepEqual([longer.resolution.outcomes.success.effects[0].duration.value, longer.resolution.outcomes.criticalSuccess.effects[0].duration.value], [2, 4]);
    // Passionate Kiss: on the creature it holds, healing equal to the damage dealt; the increase and the save the GM's.
    const kiss = compileMonsterAbility({ type: "action", name: "Passionate Kiss", system: { slug: null, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: [] }, description: { value: "<p><strong>Frequency</strong> once per round</p><p><strong>Effect</strong> The test fiend engages a creature they have Grabbed or Restrained in an embrace to drain its vital essence. The kiss makes the creature Drained 1 or increases its drained value by 1, to a maximum of 4. The creature takes @Damage[3d6[void]] damage and the test fiend regains Hit Points equal to the damage dealt. The target must succeed at a @Check[will|dc:28] save or be affected by a Suggestion to submit.</p>" } } });
    assert.deepEqual([kiss.targeting.grabbed, kiss.resolution.outcomes.success.effects.map((effect) => effect.kind), kiss.resolution.reminders.length], [true, ["condition", "heal"], 2]);
    assert.match(kiss.resolution.reminders[1], /DC 28 Will save or be affected by a Suggestion/);
    // Not one on only some creatures ("a creature that qualifies as their favored game").
    assert.equal(compileMonsterAbility(passive("Test Fear", "<p>When the test hunter hits a creature that qualifies as their favored game, that creature is @UUID[Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL]{Frightened 1} (or Frightened 2 on a critical hit).</p>"), { actor: { items: [{ type: "melee", name: "Spear", system: { attackEffects: { value: ["test-fear"] } } }] } })?.trigger?.event, undefined);
});

test("follow-ups to a Strike: more requirement wordings, results with no roll, a skill action, a second Strike (2026-10-10, batch 36)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const action = (name, need, effect) => ({ type: "action", name, system: { slug: null, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: [] }, description: { value: `<p><strong>Requirements</strong> ${need}</p><hr /><p><strong>Effect</strong> ${effect}</p>` } } });
    const compile = (need, effect, name = "Test Follow-up") => compileMonsterAbility(action(name, need, effect), { basicActions });
    const link = (id, label) => `@UUID[Compendium.pf2e.conditionitems.Item.${id}]{${label}}`;
    // The requirement's wordings (made-up creatures).
    const need = (text) => compile(text, "The creature is @UUID[Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg]{Off-Guard} until the start of the test beast's next turn.")?.trigger?.followUp ?? null;
    const hit = ["success", "criticalSuccess"];
    assert.deepEqual(need("The test beast's previous action was a successful horn Strike against the target"), { strike: "horn", melee: false, on: hit });
    assert.deepEqual(need("The test beast's last action was a success with a tusk Strike."), { strike: "tusk", melee: false, on: hit });
    assert.deepEqual(need("The test beast's last action was a melee Strike that critically succeeded"), { strike: null, melee: true, on: ["criticalSuccess"] });
    assert.deepEqual(need("The test beast's last action was a hoof Strike that dealt damage to its target"), { strike: "hoof", melee: false, on: hit });
    assert.deepEqual(need("Test Beast damaged a creature with a jaws Strike in its previous action"), { strike: "jaws", melee: false, on: hit });
    assert.deepEqual(need("The test beast made a successful Strike against a living creature with its cold touch on its previous action"), { strike: "cold touch", melee: false, on: hit });
    assert.deepEqual(need("The test beast's last action was a successful Strike with its stinger against a target with blood"), { strike: "stinger", melee: false, on: hit });
    assert.deepEqual(need("The test beast's last action was a success with a Strike that lists Trip in its damage entry."), { strike: null, melee: false, on: hit, listing: "trip" });
    // (What the creature hit is, the GM's; another way to qualify leaves the Strike's.)
    assert.deepEqual(need("The test beast's last action was a successful claw Strike against a creature that is standing in water"), { strike: "claw", melee: false, on: hit });
    assert.deepEqual(need("The test beast's last action was a successful jaws Strike against a living creature"), { strike: "jaws", melee: false, on: hit });
    assert.deepEqual(need("The test beast's last action was a successful bite Strike or Test Lunge"), { strike: "bite", melee: false, on: hit });
    // Not with more it needs.
    assert.equal(need("The test beast's last action was a successful jaws Strike, and the target is adjacent to a wall"), null);
    assert.equal(need("The test beast's last action was a successful claw Strike against a Medium or larger creature"), null);
    // Damage with no roll on the creature hit, its flavor first.
    const clamp = compile("The test turtle damaged a creature with a jaws Strike in its previous action", "The test turtle bites down hard and automatically deals an additional @Damage[2d6[piercing]] damage to the creature it just bit.");
    assert.deepEqual([clamp.resolution.check.roll, clamp.resolution.outcomes.success.damage.formulas, clamp.targeting.target], ["automatic", [{ formula: "2d6[piercing]" }], "the creature the Strike hits"]);
    const wrench = compile("The test raider's last action was a successful spear Strike", "The test raider twists the spear, inflicting @Damage[1d6[bleed]] to the target.");
    assert.deepEqual(wrench.resolution.outcomes.success.damage.formulas, [{ formula: "1d6[bleed]" }]);
    // A critical hit's condition: results by the Strike's degree; later words about it for the GM.
    const steal = compile("The test shade hit a living creature with a shadow hand Strike on its previous action.", `The test shade tugs at the target's shadow, making the creature ${link("MIRkyAjyBeXivMa7", "Enfeebled 1")} (or ${link("MIRkyAjyBeXivMa7", "Enfeebled 2")} on a critical hit). This adds to other enfeebled conditions from test shades, up to enfeebled 3.`);
    const values = (row) => steal.resolution.outcomes[row].effects.map((effect) => [effect.slug, effect.value]);
    assert.deepEqual([steal.resolution.check.statistic, values("success"), values("criticalSuccess"), steal.resolution.reminders.length], ["strike", [["enfeebled", 1]], [["enfeebled", 2]], 1]);
    // Its own healing, Drained until healed; a push; a pull and a grab; a Disarm's critical success.
    const sip = compile("The test leech's last action was a successful mouth Strike", `The test leech drinks. The victim becomes ${link("4D2KBtexWXa6oUMR", "Drained 1")} and the test leech regains @Damage[6[healing]] HP.`);
    assert.deepEqual(sip.resolution.outcomes.success.effects.map((effect) => [effect.kind, effect.slug ?? effect.amount, effect.recipient ?? null]), [["heal", 6, "self"], ["condition", "drained", null]]);
    const tendril = compile("The test leech's last action was a successful mouth Strike", `The test leech regains @Damage[3[healing]] Hit Points, and the creature is ${link("4D2KBtexWXa6oUMR", "Drained 1")} until it receives healing of any kind or amount.`);
    assert.match(tendril.resolution.reminders[0], /until it receives healing/);
    const shove = compile("The test giant's last action was a successful melee Strike", "The test giant pushes his foe back 10 feet, with the effects of a successful Shove. He can follow the foe as normal for a successful Shove.");
    assert.deepEqual([shove.resolution.outcomes.success.forcedMovement.kind, shove.resolution.outcomes.success.forcedMovement.distance], ["push", 10]);
    const chain = compile("The test devil's last action was a success with a hook Strike.", `The test devil pulls the creature 10 feet closer and ${link("kWc1fhmv9LBiTuei", "Grabs")} it with the hook ([[/act escape dc=30]]). The creature is freed if the test devil moves away.`);
    assert.deepEqual([chain.resolution.outcomes.success.forcedMovement.kind, chain.resolution.outcomes.success.effects.map((effect) => effect.slug)], ["pull", ["grabbed"]]);
    const upper = compile("The test rogue's last action was a melee Strike that critically succeeded", "The test rogue Disarms the creature they hit, as a critical success on a Disarm attempt. The weapon lands next to the creature (the test rogue's choice).");
    assert.deepEqual([upper.trigger.followUp.on, upper.resolution.outcomes.success.effects], [["criticalSuccess"], [{ kind: "disarm", what: "drop" }]]);
    // A skill action after the hit: PF2e's, with its own bonus; not counting toward the penalty, no attack trait.
    const pry = compile("The test imp's last action was a successful claw Strike", "The test imp attempts to [[/act disarm]] the creature they hit. They gain a +4 status bonus to the Athletics check. This attempt neither applies nor counts toward the test imp's multiple attack penalty.");
    assert.deepEqual([pry.resolution.check.statistic, pry.resolution.check.bonus, pry.traits.includes("attack"), pry.resolution.outcomes.criticalSuccess.effects[0].kind], ["athletics", { value: 4, type: "status" }, false, "disarm"]);
    // A second Strike: a Strike activity after such a Strike; "using the previous Strike's multiple attack penalty"; off-guard.
    const gnaw = compile("The test hound's previous action was a jaws Strike that dealt damage to its target", "the test hound makes a second jaws Strike as it shakes its head. On a success, the target takes an additional 1d4 slashing damage and 1 persistent bleed damage.");
    assert.deepEqual([gnaw.builtin, gnaw.strike, gnaw.onHit.damage, gnaw.after.on], ["strike-activity", "jaws", ["1d4[slashing]", "1[persistent,bleed]"], hit]);
    const swing = compile("The test thrall's last action was a club Strike that missed", "The test thrall makes another club Strike against the same target, using the previous Strike's multiple attack penalty.");
    assert.deepEqual([swing.builtin, swing.after.on, swing.previousMap], ["strike-activity", ["failure", "criticalFailure"], true]);
    const feint = compile("The test duelist's previous action this turn was a Strike that failed or critically failed", "The test duelist Strikes the same target, who is Off-Guard against this attack. On a hit, the test duelist deals 1d6 additional precision damage.");
    assert.deepEqual([feint.offGuard, feint.onHit.damage], [true, ["1d6[precision]"]]);
});

test("more damage on its own Strikes for a while, plain Strikes, and more charge and Strike activity wordings (2026-10-10, batch 37)", () => {
    const action = (name, html, actions = 1) => ({ type: "action", name, system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: `<p>${html}</p>` } } });
    const compile = (html, actions = 1, name = "Test Ability") => compileMonsterAbility(action(name, html, actions));
    // Its Strikes' extra damage: the Strike it names, its melee Strikes, all of them; for its time; other sentences the GM's.
    const fangs = compile("The test bat hums deep in its throat. Until the start of its next turn, its fangs Strikes deal an additional @Damage[2d8[sonic]] damage. The test bat can't do this while it holds something in its mouth.");
    assert.deepEqual([fangs.builtin, fangs.damage, fangs.strike, fangs.melee, fangs.duration, fangs.model.rounds, fangs.notes], ["self-effect", ["2d8[sonic]"], "fangs", false, { value: 1, unit: "rounds", expiry: "turn-start" }, 1, ["The test bat can't do this while it holds something in its mouth."]]);
    const hot = compile("For the next minute, its melee Strikes deal an additional 1d6 fire damage.");
    assert.deepEqual([hot.damage, hot.strike, hot.melee, hot.duration.unit, hot.model.rounds], [["1d6[fire]"], null, true, "minutes", 10]);
    const bleed = compile("Until the end of the test lizard's next turn, its claws Strikes deal an additional 1d10 persistent bleed damage.");
    assert.deepEqual([bleed.damage, bleed.duration, bleed.model.rounds], [["1d10[persistent,bleed]"], { value: 1, unit: "rounds", expiry: "turn-end" }, 2]);
    const drool = compile("Until the end of its turn, the test hound's jaws Strike deals an additional 2 points of acid damage on a successful attack, or 4 points on a critical success.");
    assert.deepEqual([drool.damage, drool.duration], [["2[acid]"], { value: 0, unit: "rounds", expiry: "turn-end" }]);
    const stance = compile("While in this stance, all the test hunter's Strikes deal an additional 2d8 precision damage, and its bow's range increment is 20 feet longer.");
    assert.deepEqual([stance.damage, stance.stance, stance.model.rounds, stance.notes], [["2d8[precision]"], true, null, ["Its bow's range increment is 20 feet longer."]]);
    // Not with a requirement, nor only against some creatures.
    assert.equal(compile("<strong>Requirements</strong> The test mage cast a spell last. <strong>Effect</strong> For the next minute, its melee Strikes deal an additional 1d6 fire damage.")?.builtin, undefined);
    assert.equal(compile("Until the start of its next turn, the test guide's Strikes deal an extra 1d4 precision damage to that creature.")?.builtin, undefined);
    // Only a Strike: drawing first, reloading, a returning weapon, a longer reach.
    for (const text of ["The test rogue draws a dagger and attacks in one motion. The test rogue Interacts to draw a weapon, then Strikes with that weapon.", "The test alchemist draws an alchemical bomb with an Interact action and throws it as a ranged Strike.", "The test slinger reloads its sling and makes a sling Strike.", "The test hunter makes a boomerang Strike, after which the boomerang returns to the test hunter's hand.", "Test Brute makes a Strike with his fist and increases his reach by 5 feet for this Strike."]) assert.deepEqual(compile(text), { builtin: "no-effect", strikeOnly: true }, text);
    // Charges and Strike activities.
    assert.deepEqual(compile("The test bear Strides and makes a Strike at the end of that movement. During the Stride, the test bear gains a +10-foot circumstance bonus to its Speed.", 2), { builtin: "charge", actions: 2, strides: 1, strike: null });
    assert.deepEqual(compile("The test skirmisher Strides or Steps, then Strikes with his hand crossbow."), { builtin: "charge", actions: 1, strides: 1, strike: "hand crossbow" });
    assert.deepEqual(compile("The test ox Strides twice. If the test ox ends its movement with an enemy within its reach, it makes a horn Strike against that enemy. The strike gains the fatal d12 trait.", 2), { builtin: "charge", actions: 2, strides: 2, strike: "horn", fatal: 12 });
    assert.deepEqual(compile("The test ray Swims, making one tail Strike at any point along the way. The Strike deals half damage."), { builtin: "charge", actions: 1, strides: 1, strike: "tail", halfDamage: true });
    const lunge = compile("The test husk Strides twice. If it ends its movement within melee range of an enemy, it makes a leg Strike against that enemy. On a hit, the Strike deals an additional @Damage[1d6[bleed]].", 2);
    assert.deepEqual([lunge.builtin, lunge.strides, lunge.strike, lunge.onHit.damage], ["strike-activity", 2, "leg", ["1d6[bleed]"]]);
    const kinetic = compile("The test tanuki makes a fist strike gaining a +4 status bonus to the damage roll.", 2);
    assert.deepEqual([kinetic.builtin, kinetic.strike, kinetic.damageBonus], ["strike-activity", "fist", 4]);
    // A follow-up after "last attack was …": a Strike at the same creature.
    const deepen = compile("<strong>Requirements</strong> Test Duelist's last attack was a successful melee Strike with her rapier</p><hr /><p><strong>Effect</strong> Test Duelist makes a dagger Strike against the same creature that she just hit. This Strike deals an additional 4d6 precision damage.");
    assert.deepEqual([deepen.builtin, deepen.strike, deepen.after, deepen.onHit.damage], ["strike-activity", "dagger", { melee: true, strike: "rapier", on: ["success", "criticalSuccess"] }, ["4d6[precision]"]]);
});

test("reaction Strikes to a Strike, an attack on an ally or a critical hit; Fast Swallow; safe moves; more charges (2026-10-10, batch 38)", () => {
    const item = (name, html, type = "action", actions = 1, slug = null) => ({ type: "action", name, system: { slug, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: [] }, description: { value: html } } });
    const reaction = (trigger, effect) => compileMonsterAbility(item("Test Reaction", `<p><strong>Trigger</strong> ${trigger}</p><hr /><p><strong>Effect</strong> ${effect}</p>`, "reaction"));
    // Tail Lash: a Strike or a skill check in its reach; its hit, -2 to that roll.
    assert.deepEqual(reaction("A creature within reach of the test drake's tail takes an action to Strike or attempt a skill check", "The test drake Strikes with its tail at the triggering creature at a –2 penalty. If it hits, the creature takes a –2 circumstance penalty to the triggering roll."), { builtin: "reaction-strike", triggers: ["strike", "skill"], strike: "tail", penalty: 2, disrupts: false, hinders: 2 });
    assert.deepEqual(reaction("A creature within reach of Test Wyrm's tail uses an action to Strike or attempt a skill check", "Test Wyrm attempts to Strike the triggering creature with their tail. If he hits, the target takes a -2 circumstance penalty to the triggering roll.").hinders, 2);
    assert.deepEqual(reaction("A creature within reach of the test wolf's jaws attacks one of the test wolf's allies", "The test wolf makes a jaws Strike against the triggering creature.").triggers, ["ally-attacked"]);
    assert.deepEqual(reaction("A creature within the test dragon's reach critically hits the dragon", "The test dragon makes a claw or tail Strike against the creature, after applying all the effects of the critical hit to the dragon."), { builtin: "reaction-strike", triggers: ["critical-hit"], strike: "claw", penalty: 0, disrupts: false });
    // Fast Swallow; a Step when an ally moves next to it.
    assert.deepEqual(reaction("The test worm Grabs a creature in its jaws", "The test worm uses Swallow Whole."), { builtin: "fast-swallow" });
    assert.deepEqual(reaction("A goblin ally ends a move action adjacent to Test Boss.", "Test Boss Steps."), { builtin: "no-effect" });
    // A move that doesn't trigger reactions; one with more to it isn't.
    const action = (html, actions = 1) => compileMonsterAbility(item("Test Action", `<p>${html}</p>`, "action", actions));
    assert.deepEqual(action("The test ghoul jumps up to half its Speed. This movement doesn't trigger reactions."), { builtin: "safe-move", actions: 1 });
    assert.deepEqual(action("The test squid moves up to 60 feet in a straight line through the water without triggering reactions.", 2), { builtin: "safe-move", actions: 2 });
    assert.equal(action("The test killer Strides up to twice its Speed. This movement doesn't trigger reactions, but it must begin and end in darkness.", 2)?.builtin, undefined);
    // Nothing for the fight's numbers.
    assert.deepEqual(action("The test shifter can take on the appearance of any Medium humanoid. This doesn't change its Speed or its attack and damage bonuses with its Strikes, but might change the damage type its Strikes deal."), { builtin: "no-effect" });
    assert.deepEqual(action("The test horse Strides twice. It has a +10-foot circumstance bonus to its Speed during these Strides.", 2), { builtin: "no-effect" });
    // More charges: one roll at two foes in its reach; a lunge with a longer reach; Aquatic Ambush (the glossary's), once a fight.
    assert.deepEqual(action("The test giant makes a single greataxe Strike and compares the attack roll result to the ACs of up to two foes within its reach. This counts as two attacks for the test giant's multiple attack penalty."), { builtin: "multi-strike", actions: 1, strikes: ["greataxe"], each: true, max: 2, sameMap: true });
    assert.deepEqual(action("The test eel darts forward. It swims up to 10 feet in a straight line and makes a jaws Strike with a reach of 10 feet.", 2), { builtin: "charge", actions: 2, strides: 1, strike: "jaws" });
    assert.deepEqual(action("The test dragon lunges its head forward, making a jaws Strike with an extended reach of 20 feet."), { builtin: "no-effect", strikeOnly: true });
    assert.deepEqual(action("The test shrike Strides twice. If it ends its movement within melee reach of one creature, it can make a melee Strike against that creature.", 2), { builtin: "charge", actions: 2, strides: 2, strike: null });
    assert.deepEqual(compileMonsterAbility(item("Aquatic Ambush", "<p>30 feet @Localize[PF2E.NPC.Abilities.Glossary.AquaticAmbush]</p>")), { builtin: "charge", actions: 1, strides: 1, strike: null, offGuard: true, oncePerFight: true });
});

test("Focus Gaze through the gaze it names, a monster's Hunt Prey, a bonus to its own AC for a while (2026-10-10, batch 39)", () => {
    const item = (name, html, type = "action") => ({ type: "action", name, system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? 1 : null }, traits: { value: [] }, description: { value: html } } });
    // Focus Gaze: its own gaze's save, for one creature now; the rest for the GM.
    const gaze = item("Test Gaze", "<p>A creature that ends its turn within 30 feet of the test gorgon must succeed at a @Check[fortitude|dc:25] save or be @UUID[Compendium.pf2e.conditionitems.Item.xYTAsEpcJE1Ccni3]{Slowed 1}.</p>", "passive");
    gaze.system.traits.value = ["aura", "visual"];
    const focus = item("Focus Gaze", "<p>The test gorgon fixes their glare at a creature they can see within 30 feet. The target must immediately attempt a @Check[fortitude|dc:25] save against the test gorgon's test gaze. If the creature was already Slowed by the test gaze, a failed save leaves it Immobilized for 1 round. After attempting its save, the creature is temporarily immune until the start of the test gorgon's next turn.</p>");
    const actor = { items: [gaze, focus] };
    const plan = compileMonsterAbility(focus, { actor });
    assert.deepEqual([plan?.resolution?.check?.statistic, plan?.resolution?.outcomes?.failure?.effects?.map((effect) => effect.slug), plan?.targeting?.range, plan?.trigger?.event, plan?.resolution?.reminders?.length], ["fortitude", ["slowed"], "30 feet", "use", 2]);
    assert.equal(compileMonsterAbility(focus, { actor: { items: [focus] } })?.resolution, undefined, "not when it has no such gaze");
    // Hunt Prey: its precision edge, or nothing for the fight's numbers.
    assert.deepEqual(compileMonsterAbility(item("Hunt Prey", "<p>The test hunter designates a single creature they can see and hear, or one they're Tracking, as their prey. The test hunter gains a +2 circumstance bonus to Perception checks to Seek the prey and to Survival checks to Track the prey. The first time the test hunter hits the designated prey in a round, they deal an additional 1d6 precision damage. These effects last until the test hunter uses Hunt Prey again.</p>")), { builtin: "hunt-prey", edge: "precision", dice: 1, die: 6 });
    assert.deepEqual(compileMonsterAbility(item("Hunt Prey", "<p>The test tracker designates a single creature they can see and hear, or one they're Tracking, as their prey. The test tracker gains a +2 circumstance bonus to Perception checks to Seek the prey and to Survival checks to Track the prey. This effect lasts until the test tracker uses Hunt Prey again.</p>")), { builtin: "no-effect" });
    // A bonus to its AC until its next turn; what it holds is its requirement; more words for the GM.
    const parry = compileMonsterAbility(item("Test Parry", "<p><strong>Requirements</strong> Test Duelist is wielding a single one-handed weapon</p><hr /><p><strong>Effect</strong> Test Duelist gains a +2 circumstance bonus to AC until the start of his next turn as long as his other hand remains free.</p>"));
    assert.deepEqual([parry.builtin, parry.model.modifiers, parry.model.rounds, parry.duration, parry.notes], ["self-effect", [{ on: "ac", type: "circumstance", value: 2 }], 1, { value: 1, unit: "rounds", expiry: "turn-start" }, ["As long as his other hand remains free."]]);
    const flames = compileMonsterAbility(item("Test Flames", "<p>The test salamander stokes its flames. Until the start of its next turn, it gains a +2 circumstance bonus to AC, and an adjacent creature that hits it takes 1d6 fire damage.</p>"));
    assert.deepEqual([flames.model.modifiers[0].value, flames.notes], [2, ["An adjacent creature that hits it takes 1d6 fire damage."]]);
    assert.equal(compileMonsterAbility(item("Test Stance", "<p><strong>Requirements</strong> Test Monk is in Test Stance</p><hr /><p><strong>Effect</strong> Test Monk gains a +2 circumstance bonus to AC until the start of her next turn.</p>"))?.requiresEffect, "Test Stance");
});

test("Mist Escape, a weapon that appears in its hand, Goblin Scuttle and Avenging Bite with no labels (2026-10-11, batch 40)", () => {
    const item = (name, html, type) => ({ type: "action", name, system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? 1 : null }, traits: { value: [] }, description: { value: html } } });
    assert.deepEqual(compileMonsterAbility(item("Mist Escape", "<p><strong>Trigger</strong> The test vampire is reduced to 0 HP.</p><hr /><p><strong>Effect</strong> The test vampire uses Turn to Mist. It can take move actions to move toward its coffin even though it's at 0 HP.</p>", "free")), { builtin: "no-effect" });
    assert.deepEqual(compileMonsterAbility(item("Test Polearm", "<p><strong>Requirements</strong> The test lord isn't holding its polearm</p><hr /><p><strong>Effect</strong> The test lord causes its polearm to appear in one of its hands.</p>", "action")), { builtin: "no-effect" });
    assert.deepEqual(compileMonsterAbility(item("Goblin Scuttle", "<p>If a goblin ally ends a move action adjacent to the test goblin, the test goblin can use their reaction to Step.</p>", "reaction")), { builtin: "no-effect" });
    assert.deepEqual(compileMonsterAbility(item("Goblin Scuttle", "<p><strong>Trigger</strong> An ally ends a move action adjacent to the test goblin</p><hr /><p><strong>Effect</strong> The test goblin Steps.</p>", "reaction")), { builtin: "no-effect" });
    assert.deepEqual(compileMonsterAbility(item("Avenging Bite", "<p>When a creature within the reach of the test wolf's bite attacks one of its allies, the test wolf can spend its reaction to make a jaws Strike against that creature.</p>", "reaction")), { builtin: "reaction-strike", triggers: ["ally-attacked"], strike: "jaws", penalty: 0, disrupts: false });
});

test("mythic abilities, Quickened Casting, Spellstrike, Speed Surge, retreats, spellcasting the GM keeps, Poison Weapon (2026-10-11, batch 41)", () => {
    const item = (name, html, type = "action", actions = 1) => ({ type: "action", name, system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: [] }, description: { value: html } } });
    const compile = (name, html, type, actions) => compileMonsterAbility(item(name, html, type, actions));
    // Mythic: three Mythic Points a fight in the simulator; notes for the GM.
    assert.deepEqual(compile("Remove a Condition", "<p><strong>Cost</strong> 1 Mythic Point</p><p><strong>Effect</strong> The test lord ends one condition affecting it.</p>"), { builtin: "mythic", kind: "remove-condition", actions: 1 });
    assert.deepEqual(compile("Recharge", "<p><strong>Cost</strong> 1 Mythic Point</p><p><strong>Effect</strong> The test lord regains an expended spell slot or can use Quickened Casting again.</p>"), { builtin: "mythic", kind: "recharge", quickened: true, actions: 1 });
    assert.deepEqual(compile("Recharge", "<p><strong>Cost</strong> 1 Mythic Point</p><p><strong>Effect</strong> The test wyrm gains one additional use of Test Breath.</p>"), { builtin: "mythic", kind: "recharge", abilities: true, actions: 1 });
    assert.deepEqual(compile("Undying Myth", "<p><strong>Cost</strong> all the creature's Mythic Points</p><p><strong>Trigger</strong> The creature would die and has at least 1 Mythic Point</p><p><strong>Effect</strong> The creature remains standing and conscious, and recovers 50% of its maximum Hit Points.</p>", "free"), { builtin: "mythic", kind: "undying", fraction: 0.5 });
    // Quickened Casting (a free action), Spellstrike, Speed Surge.
    assert.deepEqual(compile("Quickened Casting", "<p><strong>Frequency</strong> once per day</p><p><strong>Effect</strong> If the test mage's next action is to cast a cantrip or spell that's 4th-rank or lower, reduce the number of actions to cast it by 1 (minimum 1 action).</p>", "free"), { builtin: "quickened-casting", maxRank: 4 });
    assert.deepEqual(compile("Spellstrike", "<p>The test magus Casts a Spell that takes 1 or 2 actions to cast and requires a spell attack roll. The effects of the spell don't occur immediately but are imbued into its attack instead. It makes a melee Strike.</p>", "action", 2), { builtin: "spellstrike", actions: 2 });
    assert.deepEqual(compile("Speed Surge", "<p><strong>Frequency</strong> three times per day</p><p><strong>Effect</strong> The test drake Strides or Flies twice.</p>"), { builtin: "speed-surge", actions: 1, uses: 3 });
    assert.deepEqual(compile("Speed Surge", "<p>The test drake moves up to twice its Speed. It can do this three times per day.</p>"), { builtin: "speed-surge", actions: 1, uses: 3 });
    // A retreat with +2 AC against reactions: a move that doesn't trigger them.
    assert.deepEqual(compile("Test Retreat", "<p><strong>Requirements</strong> The test kobold is adjacent to at least one enemy.</p><p><strong>Effect</strong> The test kobold Strides up to its Speed plus 5 feet and gains a +2 circumstance bonus to AC against reactions triggered by this movement. It must end this movement in a space that's not adjacent to any enemy.</p>"), { builtin: "safe-move", actions: 1 });
    // The GM's: Drain Bonded Item, Reach Spell, Counterspell, the harrowkin's initiative.
    assert.deepEqual(compile("Drain Bonded Item", "<p><strong>Frequency</strong> once per day</p><p><strong>Requirements</strong> The test wizard hasn't acted yet on this turn</p><p><strong>Effect</strong> The test wizard can cast one prepared spell he has already cast today without spending a spell slot.</p>", "free"), { builtin: "no-effect" });
    assert.deepEqual(compile("Reach Spell", "<p>If the next action the test sorcerer uses is to Cast a Spell that has a range, increase that spell's range by 30 feet.</p>"), { builtin: "no-effect" });
    assert.deepEqual(compile("Counterspell", "<p><strong>Trigger</strong> A creature casts a spell the test lich has prepared.</p><p><strong>Effect</strong> The test lich expends a prepared spell to counter the triggering creature's casting of that same spell.</p>", "reaction"), { builtin: "no-effect" });
    // Poison Weapon: the injury poison it carries.
    const venom = { type: "consumable", name: "Test Venom", system: { traits: { value: ["consumable", "injury", "poison"] }, level: { value: 3 }, quantity: 2, description: { value: "<p><strong>Saving Throw</strong> @Check[fortitude|dc:20]</p><p><strong>Maximum Duration</strong> 4 rounds</p><p><strong>Stage 1</strong> @Damage[1d6[poison]] damage (1 round)</p><p><strong>Stage 2</strong> @Damage[2d6[poison]] damage (1 round)</p>" } } };
    const poisoner = item("Poison Weapon", "<p><strong>Requirements</strong> The test assassin is wielding a piercing or slashing weapon and has a free hand</p><p><strong>Effect</strong> The test assassin applies a poison to the weapon.</p>");
    const plan = compileMonsterAbility(poisoner, { actor: { items: [poisoner, venom] } });
    assert.deepEqual([plan?.builtin, plan?.poison?.name, plan?.doses, plan?.poison?.plan?.resolution?.check?.statistic], ["poison-weapon", "Test Venom", 2, "fortitude"]);
    // (With no poison to apply: the GM's, behind a free hand the simulator can't see — the user's choice of 2026-10-12.)
    assert.deepEqual(compileMonsterAbility(poisoner, { actor: { items: [poisoner] } }), { builtin: "no-effect", gm: "state" }, "not with no poison to apply");
});

test("statues and feigned corpses, web descents, Running Reload, Skirmish Strike, Hunt Prey, Swipe, Flurry of Blows, Twin Takedown and Sudden Charge in more wordings (2026-10-11, batch 42)", () => {
    const item = (name, html, type = "action", actions = 1) => ({ type: "action", name, system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: [] }, description: { value: html } } });
    const compile = (name, html, actions) => compileMonsterAbility(item(name, html, "action", actions));
    // Nothing for a fight's numbers.
    assert.deepEqual(compile("Statue", "<p>Until the next time they act, the test gargoyle appears to be a statue. They have an automatic result of 30 on Deception checks and DCs to pass as a statue.</p>"), { builtin: "no-effect" });
    assert.deepEqual(compile("Statue", "<p>Until the next time it uses an action, the test gargoyle appears to be a statue. A creature must succeed at a @Check[perception|dc:30] check to figure out that the statue is really a creature.</p>"), { builtin: "no-effect" });
    assert.equal(compile("Statue", "<p>Until the next time it acts, the test gargoyle appears to be a statue. It has an automatic result of 30 on Deception checks and DCs to pass as a statue. While it stays still, it has fast healing 10.</p>"), null, "not with more for it while it waits");
    assert.deepEqual(compile("Feign Death", "<p>The test wight dims its eyes, falls @UUID[Compendium.pf2e.conditionitems.Item.j91X7x0XSomq8d60]{Prone}, and lies completely still. Until the next time it acts, the test wight appears to be an ordinary corpse. It has an automatic result of 30 on Deception checks and DCs to pass as an ordinary corpse.</p>"), { builtin: "no-effect" });
    assert.deepEqual(compile("Descend on a Web", "<p>The test spider moves straight down up to 40 feet, suspended by a web line. It can hang from the web or drop off. The distance it Descends on a Web doesn't count for falling damage. A creature that successfully Strikes the web (AC 20, Hardness 3, 5 HP) severs it, causing the spider to fall.</p>"), { builtin: "no-effect" });
    assert.deepEqual(compile("Running Reload", "<p>The test archer Strides, Steps, or Sneaks, then Interacts to reload.</p>"), { builtin: "no-effect" });
    // Only a Strike.
    assert.deepEqual(compile("Skirmish Strike", "<p><strong>Frequency</strong> once per turn</p><p><strong>Effect</strong> The test hunter's feet and blade move together. It either Steps and then Strikes, or Strikes and then Steps.</p>"), { builtin: "no-effect", strikeOnly: true });
    // Hunt Prey: its edge, or nothing more than the bonuses.
    assert.deepEqual(compile("Hunt Prey", "<p>The test hunter designates a single creature it can see and hear, or one it's Tracking, as its prey. It has a +2 circumstance bonus to Perception checks to Seek its prey. The first time the test hunter hits its prey in a round, it inflicts an additional 2d8 precision damage.</p>"), { builtin: "hunt-prey", edge: "precision", dice: 2, die: 8 });
    assert.deepEqual(compile("Hunt Prey", "<p>The test scout designates a single creature it can see or hear, and gains a +2 circumstance bonus to Perception checks to Seek and Track that prey. It can only have one creature so designated at a time, and if it selects a new hunted prey, the previous designation ends.</p>"), { builtin: "no-effect" });
    assert.deepEqual(compile("Hunt Prey", "<p>The test tracker designates one or two targets it can see or hear as its prey. It gains a +2 circumstance bonus to Perception checks to Seek and Track its prey. If it uses Hunt Prey against a third creature when it already has two designated, a prior creature of its choice loses the designation. Its designation lasts until its next daily preparations.</p>"), { builtin: "no-effect" });
    // Swipe, Flurry of Blows, Twin Takedown, a bat's wings.
    assert.deepEqual(compile("Swipe", "<p>The test draugr lashes out at every foe it can reach. The test draugr makes a melee Strike and compares the attack roll result to the AC of up to two foes, each of whom must be within the test draugr's melee reach and adjacent to the other. It rolls damage only once and applies it to each creature it hit. A Swipe counts as two attacks toward its multiple attack penalty, though the penalty does not increase until after both attacks are resolved.</p>", 2), { builtin: "multi-strike", actions: 2, strikes: [null], each: true, max: 2, sameMap: true });
    assert.deepEqual(compile("Flurry of Blows", "<p>The test monk makes two fist Strikes, applying its multiple attack penalty as normal. If both hit the same creature, combine their damages for the purposes of resistances and weaknesses.</p>"), { builtin: "multi-strike", actions: 1, strikes: ["fist", "fist"] });
    assert.deepEqual(compile("Flurry of Blows", "<p><strong>Frequency</strong> once per round</p><p><strong>Effect</strong> The test monk makes two Strikes, each of which must be an unarmed Strike or test staff Strike. If both hit the same creature, combine their damage for the purpose of resistances and weaknesses.</p>"), { builtin: "multi-strike", actions: 1, strikes: [null, null], oncePerTurn: true });
    assert.deepEqual(compile("Twin Takedown", "<p><strong>Frequency</strong> once per round</p><p><strong>Requirements</strong> The test slayer is wielding two melee weapons, each in a different hand</p><p><strong>Effect</strong> The test slayer swiftly attacks their hunted prey with both weapons, potentially combining their damage into a single devastating attack. They make two Strikes against their hunted prey, one with each of the required weapons. If both hit the same hunted prey, combine their damage for the purpose of its resistances and weaknesses. Apply their multiple attack penalty to each Strike normally.</p>"), { builtin: "multi-strike", actions: 1, strikes: [null, null], sameTarget: true, oncePerTurn: true });
    assert.deepEqual(compile("Wing Thrash", "<p>The test bat thrashes wildly with its wings, making wing Strikes against up to three adjacent foes. Each attack counts toward the bat's multiple attack penalty, but the penalty increases only after all the attacks have been made.</p>", 2), { builtin: "multi-strike", actions: 2, strikes: ["wing", "wing", "wing"], sameMap: true, each: true, max: 3 });
    // Sudden Charge: a first sentence that only tells what it does, "Stride or Swim twice; if …", "against it".
    assert.deepEqual(compile("Sudden Charge", "<p>With a quick sprint, the test warrior dashes up to their foe and swings. They Stride or Swim twice; if they end their movement within melee reach of at least one enemy, they can make a melee Strike against it.</p>", 2), { builtin: "charge", actions: 2, strides: 2, strike: null });
});

test("Twin Feint, Three-Headed Strike, Storm of Jaws by the creature's heads, Focused Assault (2026-10-11, batch 43)", () => {
    const item = (name, html, actions = 2) => ({ type: "action", name, system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: html } } });
    const regrowth = item("Head Regrowth", "<p>A test hydra ordinarily has five heads. A creature can attempt to sever one of its heads.</p>", null);
    const hydra = (ability) => ({ items: [ability, regrowth] });
    // Twin Feint: the second attack against an off-guard target.
    assert.deepEqual(compileMonsterAbility(item("Twin Feint", "<p>The test bugbear makes a dazzling series of attacks with two weapons, using the first attack to throw their foe @UUID[Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg]{Off-Guard} against a second attack at a different angle. They make one Strike with each of their two melee weapons, both against the same target. The target is automatically off-guard against the second attack. Apply the test bugbear's multiple attack penalty to the Strikes normally.</p>")),
        { builtin: "multi-strike", actions: 2, strikes: [null, null], sameTarget: true, secondOffGuard: true });
    assert.deepEqual(compileMonsterAbility(item("Twin Feint", "<p>The test cultist makes two Strikes, one with their shortsword and one with their dagger, both against the same target. The target is automatically Off-Guard against the second attack.</p>")),
        { builtin: "multi-strike", actions: 2, strikes: ["shortsword", "dagger"], sameTarget: true, secondOffGuard: true });
    // Three-Headed Strike: a different Strike at each creature, counted as one attack.
    assert.deepEqual(compileMonsterAbility(item("Three-Headed Strike", "<p>The test chimera makes a Strike with its dragon jaws, lion jaws, and goat horns, each at a -2 penalty and targeting a different creature. These Strikes count as only one attack for the test chimera's multiple attack penalty, and the penalty doesn't increase until after it has made all three attacks.</p>")),
        { builtin: "multi-strike", actions: 2, strikes: ["dragon jaws", "lion jaws", "goat horns"], sameMap: true, each: true, max: 3, penalty: 2, countsAs: 1 });
    // Storm of Jaws: as many Strikes as its heads, each at a different creature; "up to six claw Strikes".
    const storm = item("Storm of Jaws", "<p>The test hydra makes a number of Strikes up to its number of heads, each against a different target. These attacks count toward the test hydra's multiple attack penalty, but the multiple attack penalty doesn't increase until after it makes all its attacks.</p>");
    assert.deepEqual(compileMonsterAbility(storm, { actor: hydra(storm) }), { builtin: "multi-strike", actions: 2, strikes: [null, null, null, null, null], sameMap: true, each: true, max: 5 });
    assert.equal(compileMonsterAbility(storm, { actor: { items: [storm] } }), null, "not without its heads");
    assert.deepEqual(compileMonsterAbility(item("Storm of Claws", "<p>The test demon makes up to six claw Strikes, each against a different target.</p>"))?.strikes?.length, 6);
    // Focused Assault: the Strike, more dice on a hit, its damage on a failure, counted as that many attacks.
    const focused = item("Focused Assault", "<p>The test hydra attacks a single target with its heads, overwhelming its foe with multiple attacks and leaving almost nowhere to dodge. The test hydra Strikes with its fangs. On a successful attack, the test hydra deals damage from its fangs Strike to the target, plus an additional 1d6 damage for every head it has beyond the first. On a failure (but not a critical failure), the test hydra deals the damage from one fangs Strike to the target creature. This Strike counts as a number of attacks equal to the number of heads the test hydra has toward its multiple attack penalty.</p>");
    const plan = compileMonsterAbility(focused, { actor: hydra(focused) });
    assert.deepEqual([plan?.builtin, plan?.strike, plan?.onHit?.damage, plan?.failureDamage, plan?.countsAs], ["strike-activity", "fangs", ["4d6[strike]"], true, 5]);
    const trap = compileMonsterAbility(item("Focused Assault", "<p>The test flytrap attacks a single target with all four of its leaves. The test flytrap makes one leaf Strike. On a success, the test flytrap deals the damage from one leaf Strike plus an additional 1d8 piercing damage for every leaf beyond the first. On a failure, the test flytrap deals the damage from one leaf Strike, but it can't use Improved Grab. It deals no damage on a critical failure. This counts toward the test flytrap's multiple attack penalty as a number of attacks equal to the number of leaves the test flytrap has.</p>"));
    assert.deepEqual([trap?.strike, trap?.onHit?.damage, trap?.countsAs], ["leaf", ["3d8[piercing]"], 4]);
});

test("Snagging Strike, Unnerving Prowess, Leaping Charge, Feign Death as a reaction (2026-10-11, batch 44)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const item = (name, html, type = "action") => ({ type: "action", name, system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? 1 : null }, traits: { value: [] }, description: { value: html } } });
    const offGuard = "@UUID[Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg]{Off-Guard}";
    // Snagging Strike: a "Trigger" that only says what it needs, as a requirement; off-guard until its next turn starts.
    const snag = compileMonsterAbility(item("Snagging Strike", `<p><strong>Trigger</strong> The test thug has one hand free, and its target is within reach of that hand.</p><hr /><p><strong>Effect</strong> The test thug makes a melee Strike while keeping one hand free. If this Strike hits, the target is ${offGuard} until the start of the test thug's next turn or until it leaves the test thug's reach, whichever comes first.</p>`));
    assert.deepEqual([snag?.builtin, snag?.requires, snag?.onHit?.conditions?.[0]?.slug, snag?.onHit?.conditions?.[0]?.duration?.expiry], ["strike-activity", "free-hand", "off-guard", "turn-start"]);
    // Unnerving Prowess: Demoralize after its own critical hit with the weapon it names, without the auditory trait.
    const prowess = compileMonsterAbility(item("Unnerving Prowess", "<p><strong>Trigger</strong> Test Duelist critically succeeds at a Strike or Disarm with her rapier.</p><hr /><p><strong>Effect</strong> Test Duelist attempts to Demoralize the target of her Strike or Disarm. This Demoralize attempt does not have the auditory trait, nor does Test Duelist take a penalty to the check if the target doesn't understand her language.</p>", "free"), { basicActions });
    assert.deepEqual([prowess?.trigger?.event, prowess?.trigger?.on, prowess?.trigger?.strike, prowess?.trigger?.free, prowess?.resolution?.check?.statistic, prowess?.traits?.includes("auditory"), prowess?.activation?.traits?.includes("auditory")], ["own-strike", ["criticalSuccess"], "rapier", true, "intimidation", false, false]);
    // Leaping Charge: a move and a Strike at +1.
    assert.deepEqual(compileMonsterAbility(item("Leaping Charge", "<p>The test raptor Strides up to 10 feet, ignoring difficult terrain as it leaps over obstacles. It then makes a Strike with its talons, gaining a +1 circumstance bonus to its attack roll.</p>")), { builtin: "charge", actions: 1, strides: 1, strike: "talons", attackBonus: 1 });
    // Feign Death as a reaction: the GM's.
    assert.deepEqual(compileMonsterAbility(item("Feign Death", "<p><strong>Trigger</strong> The test possum is reduced below 15 HP</p><hr /><p><strong>Effect</strong> The test possum collapses. It is Off-Guard and can use actions that require only its mind, but any other action ends the ruse. A successful @Check[perception|dc:16] check to Seek is required to determine that the animal is not, in fact, dead.</p>", "reaction")), { builtin: "no-effect" });
});

test("Capsize and Drench with their rolls, Impaling Charge, Knocking Sweep (2026-10-11, batch 45)", () => {
    const item = (name, html, actions = 1) => ({ type: "action", name, system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: html } } });
    // Nothing for a fight's numbers.
    assert.deepEqual(compileMonsterAbility(item("Capsize", "<p>The test turtle tries to capsize an adjacent aquatic vessel of its size or smaller. The test turtle must succeed at a @Check[athletics|dc:30] check (reduced by 5 for each size smaller the vessel is than the turtle) or the pilot's Sailing Lore DC, whichever is higher.</p>")), { builtin: "no-effect" });
    assert.deepEqual(compileMonsterAbility(item("Drench", "<p>The test mephit puts out all fires in a @Template[emanation|distance:5]. The mephit extinguishes all non-magical fires automatically and attempts to counteract magical fires ([[/r 1d20+7 #Drench]]{+7} counteract modifier).</p>")), { builtin: "no-effect" });
    // Impaling Charge: a Stride, a horn Strike, Grabbed on a hit (not while it holds a creature).
    const impale = compileMonsterAbility(item("Impaling Charge", "<p><strong>Requirements</strong> The test dragon doesn't have a creature impaled on their horn</p><hr /><p><strong>Effect</strong> The test dragon attempts to gore a foe. They Stride, then attempt a horn Strike. On a hit, the target becomes impaled on the test dragon's horn. The creature is @UUID[Compendium.pf2e.conditionitems.Item.kWc1fhmv9LBiTuei]{Grabbed} while on the horn (and can attempt to Escape as normal). The test dragon doesn't need to use additional actions to keep the impaled creature grabbed. If the test dragon moves, they bring the grabbed creature along with them.</p>", 2));
    assert.deepEqual([impale?.builtin, impale?.strides, impale?.strike, impale?.requires, impale?.onHit?.conditions], ["strike-activity", 1, "horn", "free-hand", [{ slug: "grabbed", value: null, duration: null }]]);
    // Knocking Sweep: a Trip at each creature in reach, at one multiple attack penalty.
    assert.deepEqual(compileMonsterAbility(item("Knocking Sweep", "<p><strong>Frequency</strong> once per round</p><p><strong>Effect</strong> The test adept swings their weapon with a sweeping spin. They attempt separate Athletics checks to [[/act trip]] any number of creatures within their reach. Each attempt counts toward the test adept's multiple attack penalty, but the multiple attack penalty doesn't increase until after they make all the attacks.</p>", 2)),
        { builtin: "skill-sweep", actions: 2, action: "trip", sameMap: true, oncePerTurn: true });
});

test("Consume Fear: temporary Hit Points as a creature near it loses the Frightened condition (2026-10-11, batch 46)", () => {
    const item = { type: "action", name: "Consume Fear", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: "<p><strong>Trigger</strong> A creature within 60 feet loses the @UUID[Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL]{Frightened} condition</p><hr /><p><strong>Effect</strong> The test dragon feasts upon the fear that leaves the triggering creature's body, gaining 6d8 temporary Hit Points that last for 1 minute.</p>" } } };
    const plan = compileMonsterAbility(item);
    assert.deepEqual(plan?.trigger, { event: "condition-lost", reaction: true, condition: "frightened", within: 60 });
    assert.deepEqual([plan?.targeting?.target, plan?.resolution?.outcomes?.success?.effects?.[0]?.kind, plan?.resolution?.outcomes?.success?.effects?.[0]?.formula], ["self", "temp-hp", "6d8"]);
});

test("Power Attack, Lunge, Quick Bomber, Thrash, Recharge Spell, Phase Jump, Spurred by Death in more wordings (2026-10-11, batch 47)", () => {
    const item = (name, html, actions = 1, type = "action") => ({ type: "action", name, system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: [] }, description: { value: html } } });
    const compile = (name, html, actions, type) => compileMonsterAbility(item(name, html, actions, type));
    const power = compile("Power Attack", "<p>The test veteran makes a melee Strike that counts as two attacks when calculating their multiple attack penalty. If this strike hits, it deals an extra die of weapon damage.</p>", 2);
    assert.deepEqual([power?.builtin, power?.countsAs, power?.extraWeaponDice], ["strike-activity", 2, 1]);
    assert.deepEqual(compile("Lunge", "<p>The test bandit makes a Strike with the spiked chain, increasing their reach by 5 feet for that Strike. The bandit can Disarm or Trip instead of a Strike.</p>"), { builtin: "no-effect", strikeOnly: true });
    assert.deepEqual(compile("Quick Bomber", "<p>Test Alchemist can use Interact to draw a bomb, then Strike with it</p>"), { builtin: "no-effect", strikeOnly: true });
    assert.deepEqual(compile("Quick Draw", "<p>The test scout draws a weapon with an Interact action, then Strikes with the weapon they just drew.</p>"), { builtin: "no-effect", strikeOnly: true });
    assert.deepEqual(compile("Thrash", "<p>The test worm Strikes once with its jaws and once with its tail, each targeting a different creature. Each attack counts toward the test worm's multiple attack penalty, but the multiple attack penalty doesn't increase until after all the attacks have been made.</p>", 2),
        { builtin: "multi-strike", actions: 2, strikes: ["jaws", "tail"], sameMap: true, each: true, max: 2 });
    assert.deepEqual(compile("Thrash", "<p>The test centipede Strikes once against each creature in its reach. It can make one of these Strikes with each of its maws, one with its tail lash, and the rest with its legs. Each attack takes a –2 circumstance penalty and counts toward the test centipede's multiple attack penalty, but the multiple attack penalty doesn't increase until after all the attacks are made.</p>", 2),
        { builtin: "multi-strike", actions: 2, strikes: [null], each: true, sameMap: true, penalty: 2 });
    assert.deepEqual(compile("Recharge Spell", "<p><strong>Cost</strong> 1 Mythic Point</p><p>The test lich regains one spell.</p>"), { builtin: "mythic", kind: "recharge", actions: 1 });
    assert.deepEqual(compile("Phase Jump", "<p><strong>Frequency</strong> once per round</p><p><strong>Effect</strong> The test dragon teleports up to 120 feet. If they are airborne, they maintain their momentum, and do not fall at the end of their turn.</p>"), { builtin: "safe-move", actions: 1 });
    assert.deepEqual(compile("Spurred by Death", "<p><strong>Trigger</strong> An ally within 30 feet reduces a creature to 0 HP</p><hr /><p><strong>Effect</strong> The test raider Steps or Strides.</p>", null, "reaction"), { builtin: "no-effect" });
});

test("plane and form shifts are the GM's (2026-10-11, batch 48; the user's choice)", () => {
    const item = (name, html, type = "action") => ({ type: "action", name, system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? 1 : null }, traits: { value: [] }, description: { value: html } } });
    for (const [name, html, type] of [
        ["Skip Between", "<p>The test sahkil moves from the Universe to the Ethereal Plane or vice-versa. While in the Ethereal Plane, they're unable to affect anything in the Universe.</p>"],
        ["Walk the Ethereal Line", "<p>The test phantom walks the thin line between the Ethereal Plane and the Universe in order to exist on both planes simultaneously.</p>"],
        ["Swarm Shape", "<p>The test worm collapses into a shapeless swarm of worms. It drops all held, worn, and carried items. It can use the same action to coalesce back into its normal form.</p>"],
        ["Shadow Form", "<p>The test strigoi reverts to pure shadow and absorbs its body and its gear into the darkness, or it shifts back to its physical form.</p>"],
        ["Bramble Jump", "<p><strong>Requirements</strong> The test twigjack is in undergrowth</p><p><strong>Effect</strong> The test twigjack scrambles into the undergrowth and instantly teleports to a square of undergrowth within 60 feet. This movement doesn't trigger reactions.</p>"],
        ["Disperse", "<p><strong>Trigger</strong> The test whirlwind takes damage from a hostile action</p><hr /><p><strong>Effect</strong> The test whirlwind disperses. Until the end of the current turn, it can't be attacked or targeted, doesn't take up space, and its aura is suppressed.</p>", "reaction"]
    ]) assert.deepEqual(compileMonsterAbility(item(name, html, type)), { builtin: "no-effect" }, name);
    assert.deepEqual(compileMonsterAbility(item("Disperse", "<p>The test engerra Strides or Flies. This movement doesn't trigger reactions. During the movement, the test engerra can move through occupied spaces. It then coalesces back into its normal form.</p>")), { builtin: "safe-move", actions: 1 });
});

test("Shake It Off and Slough Skin negate a condition (2026-10-11, batch 49; the user's choice)", () => {
    const item = (html) => ({ type: "action", name: "Shake It Off", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: html } } });
    assert.deepEqual(compileMonsterAbility(item("<p><strong>Frequency</strong> once per day</p><p><strong>Trigger</strong> The test worm would be affected by a condition or adverse effect (such as Cursed Metamorphosis)</p><hr /><p><strong>Effect</strong> The test worm negates the triggering condition or effect by sloughing an outer layer of its skin. Effects from artifacts, deities, or a similarly powerful source can't be avoided in this way.</p>")), { builtin: "negate-condition" });
    assert.deepEqual(compileMonsterAbility(item("<p><strong>Frequency</strong> once per minute</p><p><strong>Trigger</strong> The test beast would be affected by the Immobilized, Paralyzed, Slowed, or Stunned conditions, or by an effect that would give it a penalty to its Speeds, from a source of 14th level or less</p><hr /><p><strong>Effect</strong> The test beast negates the triggering condition or effect.</p>")), { builtin: "negate-condition", conditions: ["immobilized", "paralyzed", "slowed", "stunned"] });
});

test("trap falls into cards, summoning traps the GM's (2026-10-11, batch 50; the user's choice)", () => {
    const item = (name, html) => ({ type: "action", name, system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: html } } });
    const edge = "@UUID[Compendium.pf2e.actionspf2e.Item.3yoajuKjwHZ9ApUY]{Grab an Edge}";
    // No DC: the fall's damage, Grab an Edge as a reminder.
    const pit = compileMonsterAbility(item("Pitfall", `<p><strong>Trigger</strong> A creature walks onto the trapdoor.</p><hr /><p><strong>Effect</strong> The triggering creature falls in and takes falling damage (typically @Damage[10[bludgeoning]|options:fall-damage] damage) as well as @Damage[2d6[piercing]] damage from falling on to the knives. That creature can use the ${edge} reaction to avoid falling.</p>`));
    assert.deepEqual([pit?.resolution?.check?.roll, pit?.targeting?.target, pit?.resolution?.outcomes?.success?.damage?.formulas?.map((entry) => entry.formula), pit?.resolution?.reminders?.[0]], ["automatic", "the triggering creature", ["10[bludgeoning]", "2d6[piercing]"], "{target} can use Grab an Edge (a Reflex save) to avoid falling and the damage."]);
    // Its DC given: a Reflex save that catches the edge.
    const ramp = compileMonsterAbility(item("Collapse", `<p><strong>Trigger</strong> A creature walks onto the collapse site</p><hr /><p><strong>Effect</strong> The triggering creature falls off the ramp and lands on the ground, taking @Damage[40[bludgeoning]|options:fall-damage] damage. They can use the ${edge} reaction to avoid falling (@Check[reflex|dc:22] save).</p>`));
    assert.deepEqual([ramp?.resolution?.check?.statistic, ramp?.resolution?.check?.against?.value, ramp?.resolution?.outcomes?.success?.damage?.mode, ramp?.resolution?.outcomes?.failure?.damage?.formulas?.[0]?.formula], ["reflex", 22, "none", "40[bludgeoning]"]);
    // Not with more than a fall: a Strike, a basic save against spikes.
    assert.equal(compileMonsterAbility(item("Pitfall", `<p><strong>Trigger</strong> A creature walks onto the trapdoor.</p><hr /><p><strong>Effect</strong> The triggering creature falls in and takes falling damage (@Damage[10[bludgeoning]] damage) and is targeted by a spike's Strike. A falling creature can attempt to ${edge} with a @Check[reflex|dc:20] save.</p>`)), null);
    // A trap that summons a creature: the GM's.
    assert.deepEqual(compileMonsterAbility(item("Summon Monster", "<p><strong>Trigger</strong> A creature enters the cloud of magical sensors</p><hr /><p><strong>Effect</strong> The trap summons a @UUID[Compendium.pf2e.pathfinder-monster-core.Actor.MrzlaE7k1PEsd3iQ]{Cockatrice}. The cockatrice rolls initiative and remains for [[/gmr 2d6 #Summoning Duration]]{2d6 rounds}.</p>")), { builtin: "no-effect" });
});

test("Wicked Bite: a GM button for each way, each a save after the jaws hit (2026-10-11, batch 51; the user's choice)", () => {
    const html = "<p><strong>Requirements</strong> The test urdefhan damaged a creature with a jaws Strike on their last action</p><hr /><p><strong>Effect</strong> The test urdefhan maintains contact. The target must succeed at a @Check[fortitude|dc:22] save or be affected by drain blood or drain vitality (the test urdefhan's choice). If the jaws Strike was a critical hit, the creature is affected by both effects, using the same save result for both.</p><ul><li><strong>Drain Blood</strong> The test urdefhan drinks some of the creature's blood. On a failed save, the creature is @UUID[Compendium.pf2e.conditionitems.Item.4D2KBtexWXa6oUMR]{Drained 1} and the test urdefhan regains 5 HP (or, on a critical failure, it's @UUID[Compendium.pf2e.conditionitems.Item.4D2KBtexWXa6oUMR]{Drained 2} and the test urdefhan regains 10 HP).</li><li><strong>Drain Vitality</strong> The test urdefhan draws out some of the creature's vital essence. The creature becomes @UUID[Compendium.pf2e.conditionitems.Item.MIRkyAjyBeXivMa7]{Enfeebled 1} for 1 hour on a failed save (or @UUID[Compendium.pf2e.conditionitems.Item.MIRkyAjyBeXivMa7]{Enfeebled 2} for 1 hour on a critical failure).</li></ul>";
    const plan = compileMonsterAbility({ type: "action", name: "Wicked Bite", system: { slug: null, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: [] }, description: { value: html } } });
    assert.deepEqual([plan?.builtin, plan?.modes?.map((mode) => mode.name)], ["modes", ["Drain Blood", "Drain Vitality"]]);
    const [blood, vitality] = plan.modes.map((mode) => mode.plan);
    assert.deepEqual([blood.trigger.followUp.strike, blood.resolution.check.against.value, blood.resolution.outcomes.failure.effects[0], blood.resolution.outcomes.criticalFailure.effects[0].value], ["jaws", 22, { kind: "condition", slug: "drained", value: 1, duration: null }, 2]);
    assert.match(blood.resolution.reminders[0], /regains 5 HP \(10 on a critical failure\)/);
    assert.deepEqual([vitality.resolution.outcomes.failure.effects[0].slug, vitality.resolution.outcomes.failure.effects[0].duration?.unit, vitality.resolution.outcomes.criticalFailure.effects[0].value], ["enfeebled", "hours", 2]);
});

test("You're Next and Stoke the Flames (2026-10-11, batch 52)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const item = (name, html, type) => ({ type: "action", name, system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? 1 : null }, traits: { value: [] }, description: { value: html } } });
    const next = compileMonsterAbility(item("You're Next", "<p><strong>Trigger</strong> The test prisoner reduces a creature to 0 hit points.</p><hr /><p><strong>Effect</strong> The test prisoner attempts an Intimidation check with a +2 circumstance bonus to [[/act demoralize options=youre-next]] a single creature it can see and that can see them.</p>", "reaction"), { basicActions });
    assert.deepEqual([next?.trigger, next?.resolution?.check?.statistic, next?.resolution?.check?.bonus], [{ event: "downs", reaction: true }, "intimidation", { value: 2, type: "circumstance" }]);
    const free = compileMonsterAbility(item("You're Next", "<p><strong>Trigger</strong> Test Brute reduces an enemy to 0 Hit Points</p><hr /><p><strong>Effect</strong> Test Brute attempts to [[/act demoralize]] a single creature he can see. He gains a +2 circumstance bonus to this check.</p>", "free"), { basicActions });
    assert.deepEqual(free?.trigger, { event: "downs", reaction: true, free: true });
    const stoke = compileMonsterAbility(item("Stoke the Flames", "<p>The test dragon intensifies nearby fires. Every foe within 60 feet that is taking persistent fire damage takes @Damage[4d6[fire]] damage.</p>", "action"));
    assert.deepEqual([stoke?.targeting?.foes, stoke?.targeting?.taking, stoke?.targeting?.area?.value, stoke?.resolution?.outcomes?.success?.damage?.formulas?.[0]?.formula], [true, "fire", 60, "4d6[fire]"]);
});

test("Golden Luck, Word of Wisdom, Cat's Luck (2026-10-11, batch 53)", () => {
    const item = (html) => ({ type: "action", name: "Luck", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: html } } });
    assert.deepEqual(compileMonsterAbility(item("<p><strong>Trigger</strong> The test dragon fails a saving throw</p><hr /><p><strong>Effect</strong> The dragon improves its result by one degree of success, turning a failure into a success or a critical failure into a normal failure. The dragon can't use this ability again for [[/gmr 1d4 #Recharge Golden Luck]]{1d4 rounds}.</p>")), { builtin: "save-boost", recharge: "1d4" });
    assert.deepEqual(compileMonsterAbility(item("<p><strong>Trigger</strong> An ally within 60 feet fails a saving throw</p><hr /><p><strong>Effect</strong> The ally improves its result by one degree of success, turning a failure into a success or a critical failure into a normal failure. The dragon can't use this ability again for [[/gmr 1d4 #Recharge Word of Wisdom]]{1d4 rounds}.</p>")), { builtin: "save-boost", ally: true, within: 60, recharge: "1d4" });
    assert.deepEqual(compileMonsterAbility(item("<p><strong>Trigger</strong> The test pouncer fails or critically fails a Reflex saving throw.</p><p><strong>Frequency</strong> Once per day.</p><hr /><p><strong>Effect</strong> Reroll that saving throw and take the better result.</p>")), { builtin: "save-reroll", save: "reflex" });
});

test("Wing Thrash, Telekinetic Defense, Wing Rebuff (2026-10-11, batch 54)", () => {
    const item = (html) => ({ type: "action", name: "Test Reaction", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: html } } });
    assert.deepEqual(compileMonsterAbility(item("<p><strong>Trigger</strong> An adjacent enemy damages the test bat</p><hr /><p><strong>Effect</strong> The bat makes one or two wing Strikes—one against the triggering creature and one against another adjacent creature.</p>")), { builtin: "reaction-strike", triggers: ["damaged-adjacent"], strike: "wing", penalty: 0, disrupts: false, second: true });
    assert.deepEqual(compileMonsterAbility(item("<p><strong>Trigger</strong> A creature approaches within 10 feet of the test poltergeist</p><hr /><p><strong>Effect</strong> The test poltergeist makes a telekinetic object Strike against the triggering creature.</p>")), { builtin: "reaction-strike", triggers: ["approach"], strike: "telekinetic object", penalty: 0, disrupts: false, within: 10 });
    assert.deepEqual(compileMonsterAbility(item("<p><strong>Trigger</strong> A creature moves into the reach of the test roc's wing</p><hr /><p><strong>Effect</strong> The test roc makes a wing Strike against the triggering creature. If the test roc Pushes the creature, it disrupts the triggering move action.</p>")), { builtin: "reaction-strike", triggers: ["approach"], strike: "wing", penalty: 0, disrupts: true });
});

test("Breach, glides and other moves, Envenom Weapon with its own venom, Reactive Tail, Biting Snakes (2026-10-11, batch 55)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const item = (name, html, type = "action", actions = 1) => ({ type: "action", name, system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: [] }, description: { value: html } } });
    assert.deepEqual(compileMonsterAbility(item("Breach", "<p>The test shark Swims up to its swim Speed, then Leaps vertically out of the water up to 25 feet high, making a Strike against a creature at any point during the jump (this lets it attack a creature within 30 feet of the water's surface). After the Strike, the test shark splashes back down into the water.</p>", "action", 2)), { builtin: "charge", actions: 2, strides: 2, strike: null });
    assert.deepEqual(compileMonsterAbility(item("Breach", "<p>The test warden Leaps and makes a Strike at any point along its movement.</p>", "action", 2)), { builtin: "charge", actions: 2, strides: 1, strike: null });
    for (const [name, html, type] of [
        ["Glide", "<p>The test leshy glides gently through the air, moving 5 feet toward the ground and up to 25 feet forward. For the purpose of determining damage from falls, it always treats falls as if they were 20 feet shorter.</p>"],
        ["Reel In", "<p><strong>Requirements</strong> The test wyvern has a creature Grabbed in its tongue.</p><hr /><p><strong>Effect</strong> The test wyvern moves the creature up to 20 feet closer to it.</p>", "free"],
        ["Drilled in Formations", "<p><strong>Frequency</strong> once per round</p><p><strong>Effect</strong> The test infantry uses Change Formation. A test infantry unit typically knows the marching column and wedge formations.</p>"],
        ["Adamantine Claws", "<p><strong>Frequency</strong> one per hour</p><p><strong>Effect</strong> The test dragon infuses their body with adamantine. For the next minute, their melee Strikes are treated as adamantine and ignore half the Hardness of any object hit.</p>"]
    ]) assert.deepEqual(compileMonsterAbility(item(name, html, type)), { builtin: "no-effect" }, name);
    // Envenom Weapon: its own venom (the ability by that name), with no doses to count.
    const envenom = item("Envenom Weapon", "<p>The test seugathi applies their test venom to one weapon they wield.</p>");
    const venom = { type: "action", name: "Test Venom", system: { slug: null, actionType: { value: "passive" }, actions: { value: null }, traits: { value: ["poison"] }, description: { value: "<p><strong>Saving Throw</strong> @Check[fortitude|dc:20]</p><p><strong>Maximum Duration</strong> 4 rounds</p><p><strong>Stage 1</strong> @Damage[1d6[poison]] damage (1 round)</p>" } } };
    const poisoned = compileMonsterAbility(envenom, { actor: { items: [envenom, venom] } });
    assert.deepEqual([poisoned?.builtin, poisoned?.poison?.name, poisoned?.own], ["poison-weapon", "Test Venom", true]);
    // Reactive Tail: PF2e's Trip at the provoking creature.
    const tail = compileMonsterAbility(item("Reactive Tail", "<p><strong>Trigger</strong> A creature within reach of the test dragon's tail uses a manipulate action or a move action, makes a ranged attack, or leaves a square during a move action it's using</p><hr /><p><strong>Effect</strong> The test dragon attempts an Athletics check to [[/act trip]] the triggering creature. This check doesn't count toward the test dragon's multiple attack penalty, and its multiple attack penalty doesn't apply to this check.</p>", "reaction"), { basicActions });
    assert.deepEqual([tail?.trigger?.event, tail?.trigger?.triggers, tail?.resolution?.check?.statistic, tail?.targeting?.target, tail?.traits?.includes("attack")], ["provoke", ["manipulate", "move", "ranged", "leave"], "athletics", "the attacker", false]);
    // Biting Snakes: a Strike at a creature ending its turn beside it.
    assert.deepEqual(compileMonsterAbility(item("Biting Snakes", "<p><strong>Trigger</strong> A creature ends its turn adjacent to the test medusa.</p><hr /><p><strong>Effect</strong> The test medusa makes a snake fangs Strike against the creature.</p>", "reaction")), { builtin: "reaction-strike", triggers: ["turn-end-adjacent"], strike: "snake fangs", penalty: 0, disrupts: false });
});

test("Feed on Fear's wordings and requirement, Scattershot (2026-10-11, batch 56)", () => {
    const item = (name, html, type = "action", actions = 1) => ({ type: "action", name, system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: ["concentrate"] }, description: { value: html } } });
    const heal = (formula) => `@Damage[${formula}[healing]]`;
    for (const [html, within, notes] of [
        [`<p><strong>Requirements</strong> An enemy is under a fear effect or Dying within 15 feet of the test wisp.</p><hr /><p><strong>Effect</strong> The test wisp feeds on the creature's terror. It regains ${heal("2d4")} Hit Points, and if it has Gone Dark, its glow reignites. A test wisp can take this action only once per round.</p>`, 15, ["If it has Gone Dark, its glow reignites.", "A test wisp can take this action only once per round."]],
        [`<p><strong>Requirements</strong> An enemy within 15 feet is under a fear effect or Dying</p><hr /><p><strong>Effect</strong> They regains ${heal("2d4")} Hit Points, and if they've Gone Dark, their glow reignites.</p>`, 15, ["If it has Gone Dark, its glow reignites."]],
        [`<p><strong>Requirements</strong> An enemy is affected by a fear effect or has the Frightened or Dying condition, and is within 25 feet of the test glutton</p><hr /><p><strong>Effect</strong> It regains ${heal("3d4")} Hit Points and its Glow reignites if it had been extinguished. It cannot use Consume Light again for 1d4 rounds, as it is too full to dim.</p>`, 25, ["If it has Gone Dark, its glow reignites.", "It cannot use Consume Light again for 1d4 rounds, as it is too full to dim."]]
    ]) {
        const plan = compileMonsterAbility(item("Feed on Fear", html));
        assert.deepEqual([plan?.resolution?.kind, plan?.targeting?.target, plan?.requiresFoe, plan?.notes, plan?.trigger?.recharge], ["healing", "self", { conditions: ["frightened", "dying"], within }, notes, undefined], html);
    }
    // Scattershot: damage in a cone with no save.
    const shot = compileMonsterAbility(item("Scattershot", "<p>The test dragon exhales a spray of force pellets that deal @Damage[(5d4+5)[force]|options:area-damage] damage in a @Template[type:cone|distance:30] with no save. The test dragon can't use Scattershot again for [[/gmr 1d4 #Recharge Scattershot]]{1d4 rounds}.</p>", "action", 2));
    assert.deepEqual([shot?.targeting?.area?.type, shot?.targeting?.area?.value, shot?.resolution?.check?.statistic, shot?.resolution?.outcomes?.success?.damage?.formulas?.[0]?.formula, shot?.trigger?.recharge?.formula], ["cone", 30, "automatic", "(5d4+5)[force]", "1d4"]);
});

test("Reaction Strikes at a Strike on it, a critical miss on it, damage from beside it, an attack or spell aimed at it (2026-10-11, batch 57)", () => {
    const reaction = (name, trigger, effect) => ({ type: "action", name, system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: `<p><strong>Trigger</strong> ${trigger}</p><hr /><p><strong>Effect</strong> ${effect}</p>` } } });
    const strike = (triggers, name) => ({ builtin: "reaction-strike", triggers, strike: name, penalty: 0, disrupts: false });
    for (const [trigger, effect, expected] of [
        ["A creature within reach of the test dragon's chin blade that the test dragon can see makes a Strike against the test dragon", "The test dragon makes a chin blade Strike against the triggering creature.", strike(["attacked"], "chin blade")],
        ["The test skull is attacked by a creature within their reach", "The test skull makes a jaws Strike against that creature.", strike(["attacked"], "jaws")],
        ["A creature makes a melee Strike against or touches the test witchfire", "The test witchfire makes a witchflame caress Strike against the triggering creature.", strike(["attacked"], "witchflame caress")],
        ["A creature within the test wolf's reach critically fails a Strike against it", "The test wolf makes a jaws Strike against the triggering creature.", strike(["critical-miss"], "jaws")],
        ["A creature adjacent to the test wereant critically misses the test wereant with a melee Strike", "The test wereant makes a mandibles Strike against the triggering creature.", strike(["critical-miss"], "mandibles")],
        ["A creature critically fails a melee Strike against the test dreshkan", "The test dreshkan makes a needle Strike against that creature.", strike(["critical-miss"], "needle")],
        ["The test pig is damaged by an adjacent creature", "The test pig makes a hoof Strike at the triggering creature.", strike(["damaged-adjacent"], "hoof")],
        ["The test dragon is targeted by an attack or spell", "The test dragon channels its lightning along the attack. The test dragon attempts a storm bolt Strike against the attacker, regardless of range.", strike(["targeted"], "storm bolt")]
    ]) assert.deepEqual(compileMonsterAbility(reaction("Test", trigger, effect)), expected, trigger);
    // A Strike or a Disarm (batch 150, the user's rule of 2026-10-11 for choices): its Strike, the Disarm a note; not "at any range" without the
    // trigger that allows it.
    assert.deepEqual(compileMonsterAbility(reaction("Test", "A creature critically fails a Strike against the test duelist", "The test duelist makes a melee Strike against or attempts to Disarm the triggering creature.")), { ...strike(["critical-miss"], null), note: "Or it can Disarm the attacker instead." });
    assert.equal(compileMonsterAbility(reaction("Test", "The test skull is attacked by a creature within their reach", "The test skull makes a jaws Strike against the attacker, regardless of range.")), null);
});

test("Jeer at Failure: PF2e's Demoralize at a foe that falls prone or critically fails a Strike (2026-10-11, batch 57)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const item = { type: "action", name: "Jeer at Failure", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: ["auditory", "emotion"] }, description: { value: "<p><strong>Trigger</strong> A foe within 90 feet becomes @UUID[Compendium.pf2e.conditionitems.Item.j91X7x0XSomq8d60]{Prone} or critically fails on a Strike</p><hr /><p><strong>Effect</strong> The test dragon laughs dismissively at the foe, attempting an Intimidation check to [[/act demoralize]] the creature. They do not take a penalty if the creature doesn't understand their language.</p>" } } };
    const plan = compileMonsterAbility(item, { basicActions });
    assert.deepEqual([plan?.trigger, plan?.targeting?.target, plan?.resolution?.check?.statistic], [{ event: "foe-mishap", reaction: true, within: 90 }, "the attacker", "intimidation"]);
});

test("Breath of Loss's unmarked basic save, Distracting Whisper, Unbidden Thoughts (2026-10-11, batch 58)", () => {
    const item = (name, html, type = "action", actions = 2) => ({ type: "action", name, system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: [] }, description: { value: html } } });
    // A damage save its words don't mark basic, whose critical failure is "also" worse: a basic save, with that on a critical failure.
    const breath = compileMonsterAbility(item("Breath of Loss", "<p>The test dragon breathes a wistful mist, dealing @Damage[14d6[mental]|options:area-damage] damage in a @Template[type:cone|distance:40] (@Check[will|dc:34] save). A creature that critically fails its save is also lost in memory and is @UUID[Compendium.pf2e.conditionitems.Item.dfCMdR4wnpbYNTix]{Stunned 1}. The test dragon can't use Breath of Loss again for [[/gmr 1d4 #Recharge Breath of Loss]]{1d4 rounds}.</p>"));
    const rows = breath?.resolution?.outcomes ?? {};
    assert.deepEqual([breath?.resolution?.check?.basic, rows.success?.damage?.multiplier, rows.criticalFailure?.damage?.multiplier, rows.criticalFailure?.effects?.map((effect) => `${effect.slug} ${effect.value}`), breath?.trigger?.recharge?.formula], [true, 0.5, 2, ["stunned 1"], "1d4"]);
    // Not without that sentence: a save against damage alone stays unread.
    assert.equal(compileMonsterAbility(item("Test Breath", "<p>The test dragon breathes, dealing @Damage[14d6[mental]|options:area-damage] damage in a @Template[type:cone|distance:40] (@Check[will|dc:34] save).</p>"))?.resolution?.check?.basic ?? null, null);
    const reaction = (name, trigger, effect) => item(name, `<p><strong>Trigger</strong> ${trigger}</p><hr /><p><strong>Effect</strong> ${effect}</p>`, "reaction");
    assert.deepEqual(compileMonsterAbility(reaction("Distracting Whisper", "The test dragon is targeted with an attack", "A voice whispers in the triggering creature's ear, inflicting a –2 circumstance penalty to the triggering attack. @UUID[Compendium.pf2e.bestiary-effects.Item.qsvSWxRqVQofjDdH]{Effect: Distracting Whisper}")), { builtin: "ac-reaction", value: 2, when: "targeted" });
    assert.deepEqual(compileMonsterAbility(reaction("Unbidden Thoughts", "The test dragon is critically hit with a weapon or unarmed attack", "The attacker sees their worst fears, and they must choose one of the following results: either the triggering attack becomes a normal success, or the critical hit is unaffected but the triggering creature becomes @UUID[Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL]{Frightened 2}.")), { builtin: "crit-downgrade", dc: null, or: { slug: "frightened", value: 2 } });
});

test("Teleports of its own and Scuttle as moves that trigger no reactions (2026-10-11, batch 59)", () => {
    const item = (name, html, actions = 1) => ({ type: "action", name, system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: ["teleportation"] }, description: { value: html } } });
    for (const [html, actions, recharge] of [
        ["<p>The test poracha teleports up to 40 feet to a location it can see. It can't use Jaunt again for [[/gmr 1d4 #Recharge Jaunt]]{1d4 rounds}.</p>", 1, "1d4"],
        ["<p><strong>Frequency</strong> once per round</p><p><strong>Effect</strong> The test kerulkagon teleports to an unoccupied space it can see within 30 feet.</p>", 1, null],
        ["<p>The test wisp teleports to a square they can see within 30 feet that isn't in an area of bright light. The test wisp can't use again for [[/gmr 1d4 #Recharge Shadow Flitter]]{1d4 rounds}.</p>", 1, "1d4"],
        ["<p>The test soulrider's form blurs as it slips through the multiverse. It teleports to an empty space within 60 feet.</p>", 2, null],
        ["<p>The test ghoul crawls on all fours, moving up to half its Speed. This movement doesn't trigger reactions.</p>", 1, null]
    ]) assert.deepEqual(compileMonsterAbility(item("Test Move", html, actions)), { builtin: "safe-move", actions, ...(recharge ? { recharge } : {}) }, html);
    // Not one with a requirement, nor one that does more.
    assert.equal(compileMonsterAbility(item("Test Jump", "<p><strong>Requirement</strong> The test walker's Light Aura is suppressed</p><p><strong>Effect</strong> The test walker teleports to a square it can see within 60 feet.</p>"))?.builtin ?? null, null);
    assert.notDeepEqual(compileMonsterAbility(item("Test Strike", "<p>The test stalker teleports into an occupied space it can see within 50 feet and makes a melee Strike.</p>", 2))?.builtin, "safe-move");    // A weapon drawn (or picked up) as part of it, then a Strike with it: off-guard, or a bonus; not a bonus that depends on something.
    const blade = compileMonsterAbility({ ...item("Hidden Blade", "<p><strong>Frequency</strong> once per round</p><p><strong>Effect</strong> The test spy draws a weapon and then Strikes with it. The target of the strike is @UUID[Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg]{Off-Guard} against the attack.</p>"), name: "Hidden Blade" });
    assert.deepEqual([blade?.builtin, blade?.strike, blade?.offGuard, blade?.oncePerTurn], ["strike-activity", null, true, true]);
    const surprise = compileMonsterAbility(item("Improvised Surprise", "<p>The test brawler uses an Interact action to pick up an improvised weapon within reach and then Strikes with it. The test brawler has a +2 circumstance bonus to this attack.</p>"));
    assert.deepEqual([surprise?.builtin, surprise?.attackBonus], ["strike-activity", 2]);
    assert.equal(compileMonsterAbility(item("Test Lunge", "<p>The test centipede draws a weapon and then Strikes with it. If the test centipede moved at least 20 feet this turn, it gains a +2 circumstance bonus to this attack roll.</p>")), null);
});

test("Double Attack, Writhing Arms, Ram Charge, Propulsive Launch, Savage Jaws, Bully's Bludgeon, Elf Step, Undulate (2026-10-11, batch 60)", () => {
    const item = (name, html, actions = 2) => ({ type: "action", name, system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: html } } });
    assert.deepEqual(compileMonsterAbility(item("Double Attack", "<p>The test zelekhut makes two chain Strikes, each targeting a different creature. Each Strike counts toward the test zelekhut's multiple attack penalty, but the penalty doesn't increase until after it has made both attacks. If the test zelekhut subsequently uses the @UUID[Compendium.pf2e.bestiary-ability-glossary-srd.Item.BCLvAx4Pz4MLa2pu]{Knockdown} action, it affects all creatures it hit with Double Attack.</p>")), { builtin: "multi-strike", actions: 2, strikes: ["chain", "chain"], sameMap: true, each: true, max: 2 });
    assert.deepEqual(compileMonsterAbility(item("Writhing Arms", "<p>The test octopus makes up to four Strikes with different arms, each against a different target. Each attack counts separately for the test octopus's multiple attack penalty, but the penalty doesn't increase the until the test octopus has made all the attacks. If the test octopus subsequently uses the Grab action, it can Grab any number of creatures it hit with Writhing Arms.</p>")), { builtin: "multi-strike", actions: 2, strikes: [null, null, null, null], sameMap: true, each: true, max: 4 });
    assert.deepEqual(compileMonsterAbility(item("Ram Charge", "<p>The test ram Strides twice in a straight line and then makes a horn Strike with a +1 circumstance bonus to its attack roll.</p>")), { builtin: "charge", actions: 2, strides: 2, strike: "horn", attackBonus: 1 });
    assert.deepEqual(compileMonsterAbility(item("Propulsive Launch", "<p>The test soulrider Leaps up to 40 feet, then makes a sucker Strike. If it's in the air and not attached to a creature after the Strike, it falls.</p>")), { builtin: "charge", actions: 2, strides: 1, strike: "sucker" });
    const jaws = compileMonsterAbility(item("Savage Jaws", "<p>The test dracolisk makes a single Strike with its jaws. If the attack hits, it deals @Damage[(4d12+16)[piercing]] damage (versatile S). This counts as two attacks for its multiple attack penalty.</p>"));
    assert.deepEqual([jaws?.builtin, jaws?.strike, jaws?.damage, jaws?.countsAs], ["strike-activity", "jaws", "(4d12+16)[piercing]", 2]);
    const bludgeon = compileMonsterAbility(item("Bully's Bludgeon", "<p>The test spriggan makes a morningstar Strike with a +2 circumstance bonus to its attack roll. This attack is nonlethal.</p>", 1));
    assert.deepEqual([bludgeon?.builtin, bludgeon?.strike, bludgeon?.attackBonus, bludgeon?.nonlethal], ["strike-activity", "morningstar", 2, true]);
    assert.deepEqual(compileMonsterAbility(item("Elf Step", "<p>The test elementalist Steps twice.</p>", 1)), { builtin: "safe-move", actions: 1 });
    for (const html of ["<p>The test centipede Strides up to its Speed or Steps. During this movement, it can pass through spaces as narrow as 10 feet without @UUID[Compendium.pf2e.actionspf2e.Item.kMcV8e5EZUxa6evt]{Squeezing}.</p>", "<p>The test con rit Swims. During this movement, it can pass through spaces as narrow as 5 feet without Squeezing.</p>"]) assert.deepEqual(compileMonsterAbility(item("Undulate", html, 1)), { builtin: "no-effect" });
});

test("Furious Flailing and Splinter: a Strike as it takes damage of some types (2026-10-11, batch 61)", () => {
    const reaction = (name, trigger, effect) => ({ type: "action", name, system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: `<p><strong>Trigger</strong> ${trigger}</p><hr /><p><strong>Effect</strong> ${effect}</p>` } } });
    const strike = (types, name, extra = {}) => ({ builtin: "reaction-strike", triggers: ["damaged-by"], damageTypes: types, strike: name, penalty: 0, disrupts: false, ...extra });
    for (const [trigger, effect, expected] of [
        ["The test troll takes electricity or fire damage", "The test troll makes a claw Strike against a random creature within its reach. If the test troll has persistent fire damage, they attempt a @Check[flat|dc:15] to remove it.", strike(["electricity", "fire"], "claw", { random: true, persistentFire: true })],
        ["The test troll takes fire or sonic damage", "The test troll makes a hatchet or claw Strike against a random creature within reach. If the test troll has persistent fire damage, they attempt a @Check[flat|dc:15] to remove it.", strike(["fire", "sonic"], "hatchet", { random: true, persistentFire: true })],
        ["The test troll takes cold or fire damage", "The test troll makes a sludge cough Strike against a random creature within their first range increment.", strike(["cold", "fire"], "sludge cough", { random: true })],
        ["The test golem takes physical damage", "A jagged splinter of wood lances out at the test golem's attacker. The test golem makes a splinter Strike against an adjacent creature without triggering reactions.", strike(["physical"], "splinter")]
    ]) assert.deepEqual(compileMonsterAbility(reaction("Test", trigger, effect)), expected, trigger);
    // Death Slam: a Strike as it drops.
    assert.deepEqual(compileMonsterAbility(reaction("Death Slam", "The test argorth is reduced to 0 Hit Points", "Before it's knocked out, the test argorth makes a tail Strike against a random creature within reach.")), { builtin: "death-strike", strike: "tail" });
});

test("Form shifts of its own as the GM's (the user's choice), not one with a save, healing or a linked spell (2026-10-11, batch 62)", () => {
    const item = (html, traits = ["concentrate", "polymorph"]) => ({ type: "action", name: "Test Shape", system: { slug: null, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: traits }, description: { value: html } } });
    for (const html of [
        "<p>The test fiend can take on the appearance of any Small or Medium humanoid. This increases their Speed to 25 feet. It doesn't change their attack and damage modifiers with their Strikes.</p>",
        "<p>The test mimic assumes the shape of any Medium object. They have an automatic result of 28 on Deception checks and DCs to pass as the object.</p>",
        "<p>The test grunt changes into a faceless version of a Small or Medium humanoid they've touched. While transformed, the grunt gains a +2 circumstance bonus to [[/act impersonate]] that creature.</p>",
        "<p><strong>Frequency</strong> once per day</p><p><strong>Effect</strong> The test prophet loses their coherent form and becomes an animated pile of sand. While in this form, the prophet gains resistance 10 to physical damage.</p>"
    ]) assert.deepEqual(compileMonsterAbility(item(html)), { builtin: "no-effect" }, html);
    for (const html of [
        "<p><strong>Frequency</strong> once per day</p><p><strong>Effect</strong> A target creature within 30 feet must succeed at a @Check[will|dc:25] save or gain the effects of a cursed form.</p>",
        "<p>The test leshy merges with an adjacent leshy, restoring @Damage[3d6[healing]] Hit Points to itself.</p>",
        "<p>The test dragon reshapes its body. This has the effects of @UUID[Compendium.pf2e.spells-srd.Item.2qGqa33E4GPUCbMG]{Humanoid Form}.</p>"
    ]) assert.notDeepEqual(compileMonsterAbility(item(html)), { builtin: "no-effect" }, html);
    // Not without the polymorph trait.
    assert.equal(compileMonsterAbility(item("<p>The test fiend can take on the appearance of any Small or Medium humanoid.</p>", ["concentrate"])), null);
});

test("A wing raised for AC, Strikes wreathed in force, a charge that triggers no reactions, a Strike back at a failed attack (2026-10-11, batch 63)", () => {
    const item = (name, html, type = "action", actions = 1) => ({ type: "action", name, system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: [] }, description: { value: html } } });
    // (Made-up wordings in the shapes these readers take.)
    const parry = compileMonsterAbility(item("Test Parry", "<p>The test drake hunches behind its shell. It gains a +2 circumstance bonus to AC until the start of its next turn. It cannot use its tail Strike while in flight for the same duration.</p>"));
    assert.deepEqual([parry?.builtin, parry?.model?.modifiers, parry?.duration?.expiry, parry?.notes?.[0]], ["self-effect", [{ on: "ac", type: "circumstance", value: 2 }], "turn-start", "It cannot use its tail Strike while in flight for the same duration."]);
    const wreath = compileMonsterAbility(item("Test Wreath", "<p>Until the beginning of its next turn, each of the test drake's horn, hoof, and tail Strikes gains the effects of a returning property rune and deals an additional 2d4 cold damage.</p>"));
    assert.deepEqual([wreath?.builtin, wreath?.damage, wreath?.melee, wreath?.strike, wreath?.duration?.expiry, wreath?.notes], ["self-effect", ["2d4[cold]"], true, null, "turn-start", ["The Strikes gain the effects of a returning property rune."]]);
    assert.deepEqual(compileMonsterAbility(item("Test Assault", "<p>The test eel coils and lunges. The test eel Swims up to half its Speed; this movement doesn't trigger reactions. At any point during this movement, it can Strike an enemy within reach; the enemy is Off-Guard against that attack.</p>", "action", 2)), { builtin: "charge", actions: 2, strides: 1, strike: null, offGuard: true, safe: true });
    const back = (effect) => compileMonsterAbility(item("Test Counter", `<p><strong>Trigger</strong> A creature within the test drake's reach fails or critically fails an attack roll against the test drake</p><hr /><p><strong>Effect</strong> ${effect}</p>`, "reaction"));
    assert.deepEqual(back("Seeing the opening it expected, the test drake answers at once. The test drake makes a melee Strike against the triggering creature."), { builtin: "reaction-strike", triggers: ["missed"], strike: "melee", penalty: 0, disrupts: false });
    assert.deepEqual(back("The test drake makes a melee Strike against the triggering creature, rolling the attack roll twice and taking the better result; this is a fortune effect."), { builtin: "reaction-strike", triggers: ["missed"], strike: "melee", penalty: 0, disrupts: false, fortune: true });
});

test("A follow-up save after an unarmed hit, a Strike at a creature that shoots at it or moves away (2026-10-11, batch 64)", () => {
    const item = (name, html, type = "action") => ({ type: "action", name, system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? 1 : null }, traits: { value: [] }, description: { value: html } } });
    // (Made-up wordings in the shapes these readers take.)
    const sap = compileMonsterAbility(item("Test Sap", "<p><strong>Requirements</strong> The test drake's last action was a successful Strike with a melee unarmed attack or a Draconic Frenzy that included a successful Strike with a melee unarmed attack</p><hr /><p><strong>Effect</strong> The target must succeed at a @Check[fortitude|dc:25] saving throw or be @UUID[Compendium.pf2e.conditionitems.Item.MIRkyAjyBeXivMa7]{Enfeebled 1} for 1 minute (@UUID[Compendium.pf2e.conditionitems.Item.MIRkyAjyBeXivMa7]{Enfeebled 2} for 1 minute on a critical failure).</p>"));
    assert.deepEqual([sap?.trigger?.followUp?.melee, sap?.resolution?.check?.statistic, sap?.resolution?.outcomes?.failure?.effects?.[0]?.slug, sap?.resolution?.outcomes?.criticalFailure?.effects?.[0]?.value], [true, "fortitude", "enfeebled", 2]);
    const whip = compileMonsterAbility(item("Test Whip", "<p><strong>Trigger</strong> A creature within reach of the test drake's tail targets the test drake with a ranged attack or attempts to move away from the test drake during a move action it's using</p><hr /><p><strong>Effect</strong> The test drake makes a tail Strike against the triggering creature. On a critical success, the test drake can also attempt an Athletics check to Trip the triggering creature.</p>", "reaction"));
    assert.deepEqual(whip, { builtin: "reaction-strike", triggers: ["move", "ranged"], strike: "tail", penalty: 0, disrupts: false, criticalTrip: true });
});

test("Its own failed save rerolled or improved in more wordings; a creature it holds failing to Escape (2026-10-11, batch 65)", () => {
    const reaction = (name, html, type = "reaction") => ({ type: "action", name, system: { slug: null, actionType: { value: type }, actions: { value: null }, traits: { value: [] }, description: { value: html } } });
    const card = (trigger, effect, frequency = "") => `${frequency ? `<p><strong>Frequency</strong> ${frequency}</p>` : ""}<p><strong>Trigger</strong> ${trigger}</p><hr /><p><strong>Effect</strong> ${effect}</p>`;
    assert.deepEqual(compileMonsterAbility(reaction("Test Luck", `<p><strong>Trigger</strong> The test shootist fails a save <strong>Frequency</strong> once per day</p><hr /><p><strong>Effect</strong> The test shootist rerolls the save and uses the better result.</p>`)), { builtin: "save-reroll", save: null, uses: 1 });
    assert.deepEqual(compileMonsterAbility(reaction("Test Luck", card("Test Halfling fails a skill check or a saving throw.", "Test Halfling rerolls the triggering check, but she must use the new result, even if it's worse.", "once per day"), "free")), { builtin: "save-reroll", save: null, keep: "new", uses: 1, free: true });
    assert.deepEqual(compileMonsterAbility(reaction("Test Friend", card("The test king fails or critically fails a saving throw.", "The result of the saving throw is improved one degree. The test king can't Test Friend for [[/gmr 1d4 #rounds]]{1d4 rounds}."))), { builtin: "save-boost", recharge: "1d4" });
    assert.deepEqual(compileMonsterAbility(reaction("Test Resolve", card("Test Hero fails or critically fails a saving throw", "Test Hero treats a critical failure as a failure, or a failure as a success.", "once per day"))), { builtin: "save-boost", uses: 1 });
    assert.deepEqual(compileMonsterAbility(reaction("Test Twist", card("The test aeon critically fails a saving throw", "The critical failure becomes a normal failure."))), { builtin: "save-boost", criticalOnly: true });
    assert.deepEqual(compileMonsterAbility(reaction("Test Resistance", card("The test avatar fails or critically fails a saving throw", "Its patron's will reaches out to it. The test avatar rerolls the saving throw and takes the better result.", "once per minute"))), { builtin: "save-reroll", save: null, uses: 1 });
    // A creature it holds failing to Escape: a Strike (on a critical failure here), or damage.
    assert.deepEqual(compileMonsterAbility(reaction("Test Savage", card("A creature Grabbed or Restrained by the test wyvern critically fails a skill check to Escape", "The test wyvern makes a stinger Strike against the triggering creature."))), { builtin: "reaction-strike", triggers: ["escape-critical-failure"], strike: "stinger", penalty: 0, disrupts: false });
    const bite = compileMonsterAbility(reaction("Test Bite", card("A creature Grabbed by the test lizard's jaws fails a check to Escape", "The test lizard's jaws deal @Damage[1d6[piercing],1d6[acid]] damage to the triggering creature.")));
    assert.deepEqual([bite?.trigger, bite?.targeting?.target, bite?.resolution?.outcomes?.success?.damage?.multiplier], [{ event: "escape-failed", reaction: true }, "the attacker", 1]);
});

test("+AC for an ally as an attack comes at it; Counterattack at a miss from its concealment (2026-10-11, batch 66)", () => {
    const reaction = (trigger, effect, requirement = "") => ({ type: "action", name: "Test", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: `<p><strong>Trigger</strong> ${trigger}${requirement ? ` <strong>Requirements</strong> ${requirement}` : ""}</p><hr /><p><strong>Effect</strong> ${effect}</p>` } } });
    for (const [trigger, effect, expected] of [
        ["An ally within the test champion's reach is targeted by an attack, and the test champion can see the attacker", "The test champion interposes with its hammer, giving the ally a +2 circumstance bonus to AC against the triggering attack.", { value: 2, type: "circumstance", within: "reach" }],
        ["A creature or object within the test guardian's reach is targeted by an attack", "The test guardian interposes themself, giving the creature or object Standard Cover against the attack (+2 circumstance bonus to AC), or Greater Cover (+4 circumstance bonus to AC) if the test guardian was already granting it lesser cover.", { value: 2, type: "circumstance", within: "reach" }],
        ["An ally within 60 feet is targeted by a physical ranged attack", "Test Monk wraps their ally in a shell of air. The ally gains a +4 status bonus to AC against physical ranged attacks until the beginning of their next turn.", { value: 4, type: "status", within: 60, ranged: true }],
        ["An adjacent test ally is targeted by a melee or ranged attack from an attacker the test recruit can see", "The test recruit rushes to block the blow. The ally gains a +2 circumstance bonus to AC against the triggering attack.", { value: 2, type: "circumstance", within: 5 }],
        ["A creature within reach attacks the test knight's ally", "The test knight raises its shield, granting its ally a +2 circumstance bonus to AC against the triggering attack. It then makes a melee Strike against the triggering creature.", { value: 2, type: "circumstance", within: "reach", strike: "melee" }],
        ["A creature or object within 5 feet of the test troop is targeted by an attack or offensive troop ability", "Some of the test troop interpose themselves, giving the target standard cover against the attack, or greater cover if the test troop was already granting it lesser cover.", { value: 2, type: "circumstance", within: 5 }]
    ]) assert.deepEqual(compileMonsterAbility(reaction(trigger, effect)), { builtin: "ally-ac-reaction", ...expected }, trigger);
    assert.deepEqual(compileMonsterAbility(reaction("The test shae is targeted by an attack from an adjacent creature that misses due to the test shae being Concealed", "The test shae makes a Strike against the attacker.", "The test shae is aware of the attack")), { builtin: "reaction-strike", triggers: ["concealed-miss"], strike: "melee", penalty: 0, disrupts: false });
});

test("Kept standing at 0 HP in its own words, Ferocity's kin (2026-10-11, batch 67)", () => {
    const reaction = (html, type = "reaction") => ({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: null }, traits: { value: [] }, description: { value: html } } });
    const card = (trigger, effect, lead = "") => `${lead}<p><strong>Trigger</strong> ${trigger}</p><hr /><p><strong>Effect</strong> ${effect}</p>`;
    for (const [html, type, expected] of [
        [card("Test Orc would be reduced to 0 Hit Points but not immediately killed", "Test Orc avoids being knocked out and remains at 1 Hit Point, and her @UUID[Compendium.pf2e.conditionitems.Item.Yl48xTdMh3aeQYL2]{Wounded} condition increases by 1.", "<p><strong>Frequency</strong> once per day</p>"), "reaction", { hp: 1, wounded: true, uses: 1 }],
        [card("The test ogre is reduced to 0 HP", "The test ogre avoids being knocked out and remains at half its maximum HP, but its wounded value increases by 1. When it is Wounded 3, it can no longer use this ability.", "<p><strong>Cost</strong> 1 Mythic Point</p>"), "reaction", { hp: "half", wounded: true, mythic: true }],
        [card("The test flame is reduced to 0 HP", "The test flame avoids being knocked out and regains @Damage[4d10[healing]] Hit Points, but its wounded value increases by 1."), "reaction", { hp: "4d10", wounded: true }],
        [card("The test manticore is reduced to 0 HP", "The test manticore avoids being knocked out and remains at 1 HP, then can make a stinger Strike against a creature in its reach.", "<p><strong>Frequency</strong> once per day</p>"), "reaction", { hp: 1, wounded: false, uses: 1, strike: "stinger" }],
        [card("Test Champion's Hit Points are reduced to 0 for the first time that day", "Test Champion refuses to fall. He remains standing with @Damage[25[healing]] Hit Points."), "free", { hp: 25, wounded: false, uses: 1, free: true }]
    ]) assert.deepEqual(compileMonsterAbility(reaction(html, type)), { builtin: "ferocity", ...expected }, html);
});

test("Reactive Strike's kin in its own words: a Strike, a Trip or a Grapple at a creature that moves (or acts) in its reach (2026-10-11, batch 68)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const reaction = (trigger, effect) => ({ type: "action", name: "Test", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: `<p><strong>Trigger</strong> ${trigger}</p><hr /><p><strong>Effect</strong> ${effect}</p>` } } });
    const strike = (triggers, name, extra = {}) => ({ builtin: "reaction-strike", triggers, strike: name, penalty: 0, disrupts: false, ...extra });
    for (const [trigger, effect, expected] of [
        ["A creature within reach of Test Drake's tail uses a move action or leaves a square during a move action it's using.", "Test Drake makes a tail Strike at the creature with a -2 penalty. If it hits, she disrupts the creature's action.", strike(["move"], "tail", { penalty: 2, disrupts: true })],
        ["A creature in the test grick's reach uses a move action or leaves a square during a move action it's using", "The test grick makes a tentacle Strike against the target. If the attack is a critical hit and the trigger was a move action, the test grick disrupts that action.", strike(["move"], "tentacle", { disrupts: "critical" })],
        ["A creature within the test guard's reach uses a move action or leaves a square during a move action it's using", "The test guard strikes out when a foe tries to flee. The test guard makes a melee Strike against the triggering creature. If the attack is a critical hit and the trigger was a move action, they disrupt that action.", strike(["move"], "melee", { disrupts: "critical" })],
        ["A creature within reach of the test drake's stinger uses a move action or leaves a square during a move action it's using", "The test drake Strikes the target with its stinger. If it hits, the test drake disrupts the creature's action.", strike(["move"], "stinger", { disrupts: true })],
        ["A creature within 30 feet of Test Soldier uses a move action, makes a ranged attack, or leaves a square during a move action it's using", "Test Soldier attempts a spike launcher Strike against the triggering creature. This Strike doesn't contribute to his multiple attack penalty, and his multiple attack penalty doesn't apply to this Strike.", strike(["move", "ranged"], "spike launcher", { within: 30 })]
    ]) assert.deepEqual(compileMonsterAbility(reaction(trigger, effect), { basicActions }), expected, trigger);
    for (const [trigger, effect, skill] of [
        ["A creature within Test Ogre's reach uses a move action or leaves a square during a move action it's using", "Test Ogre lashes out with his tail in an attempt to trip the creature up. Test Ogre attempts to Trip the triggering creature.", "athletics"],
        ["A creature uses a move action to leave a square adjacent to the test wight", "The test wight attempts an Athletics check to Grapple the target.", "athletics"],
        ["A creature within a test sentry's reach uses a manipulate action or a move action, makes a ranged attack, or leaves a square during a move action it's using", "The test sentry makes an Athletics check to Grapple the triggering creature.", "athletics"],
        ["A creature within 10 feet uses an action with the move trait or leaves a space within the test constable's reach during its move", "The test constable attempts to Trip the triggering creature. On a success, the triggering action is disrupted.", "athletics"]
    ]) {
        const plan = compileMonsterAbility(reaction(trigger, effect), { basicActions });
        assert.deepEqual([plan?.trigger?.event, plan?.resolution?.check?.statistic, plan?.targeting?.target], ["provoke", skill, "the attacker"], trigger);
    }
});

test("its own hit, or a foe's, that brings a save; on a creature with a condition, on its turn, with a kind of weapon (2026-10-11, batch 69)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const reaction = (trigger, effect, type = "reaction") => ({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: null }, traits: { value: [] }, description: { value: `<p><strong>Trigger</strong> ${trigger}</p><hr /><p><strong>Effect</strong> ${effect}</p>` } } });
    const compile = (trigger, effect, type) => compileMonsterAbility(reaction(trigger, effect, type), { basicActions });
    const slowed = "@UUID[Compendium.pf2e.conditionitems.Item.xYTAsEpcJE1Ccni3]{Slowed}";
    // A save after its own hit: on the creature it hit; "a Slowed creature" — the condition it needs.
    let plan = compile(`The test golem hits a ${slowed} creature.`, "The creature must succeed at a @Check[fortitude|dc:30] save or become @UUID[Compendium.pf2e.conditionitems.Item.6uEgoh53GbXuHpTF]{Paralyzed} for 1 round.");
    assert.deepEqual([plan?.trigger, plan?.targeting?.target, plan?.resolution?.outcomes?.failure?.effects?.[0]?.slug], [{ event: "own-strike", reaction: true, on: ["success", "criticalSuccess"], strike: null, condition: "slowed" }, "the creature the Strike hits", "paralyzed"]);
    // "… on its turn", and persistent damage on a failure.
    plan = compile("The test fowl hits a target with its peck Strike on its turn", "The target must attempt a @Check[reflex|dc:16] save or take @Damage[1d4[persistent,fire]] damage.");
    assert.deepEqual([plan?.trigger?.strike, plan?.trigger?.ownTurn, plan?.resolution?.outcomes?.failure?.damage?.formulas], ["peck", true, [{ formula: "1d4[persistent,fire]" }]]);
    // "With a Strike" is any Strike; "with a melee Strike", "with an unarmed Strike" its kind of weapon.
    assert.equal(compile("The test knight hits a foe with a Strike.", "The creature struck must succeed at a @Check[will|dc:17] save or be Stunned 1.")?.trigger?.strike, null);
    plan = compile("Test Vinn critically hits a foe with an unarmed Strike", "The creature struck must succeed at a @Check[will|dc:17] save or be Stunned 1.");
    assert.deepEqual([plan?.trigger?.on, plan?.trigger?.strike, plan?.trigger?.weapon], [["criticalSuccess"], null, "unarmed"]);
    // "(Enfeebled 2 if it critically fails)": the critical failure's own.
    plan = compile("Test Duelist critically hits a target with his rapier", "The target must succeed at a @Check[will|dc:29] save or become @UUID[Compendium.pf2e.conditionitems.Item.MIRkyAjyBeXivMa7]{Enfeebled 1} (@UUID[Compendium.pf2e.conditionitems.Item.MIRkyAjyBeXivMa7]{Enfeebled 2} if it critically fails).");
    assert.deepEqual([plan?.trigger?.strike, plan?.resolution?.outcomes?.failure?.effects?.[0]?.value, plan?.resolution?.outcomes?.criticalFailure?.effects?.[0]?.value], ["rapier", 1, 2]);
    // A foe's hit on it that brings a save on the attacker ("An adjacent creature damages the test ooze with a melee Strike").
    plan = compile("An adjacent creature damages the test ooze with a melee Strike", "Some of the ooze gushes out under the triggering creature's feet. They must succeed at a @Check[reflex|dc:15] save or fall @UUID[Compendium.pf2e.conditionitems.Item.j91X7x0XSomq8d60]{Prone}.");
    assert.deepEqual([plan?.trigger?.event, plan?.targeting?.target, plan?.resolution?.outcomes?.failure?.effects?.[0]?.slug], ["hit-by", "the attacker", "prone"]);
    // Not a save only a critical hit brings after a choice on any hit: the GM's, as before.
    plan = compile("Test Rogue's Strike hits an Off-Guard creature and deals damage.", "The target becomes Enfeebled 1 or takes a -10-foot status penalty to its Speeds, as chosen by Test Rogue. On a critical hit, the target must also attempt a @Check[fortitude|dc:34] save.");
    assert.notEqual(plan?.trigger?.event, "own-strike");
    // Demoralize after a hit, the downed target's alternative and the language rule for the GM.
    plan = compile("Test Head-Taker hits a creature with a melee Strike", "Test Head-Taker makes an Intimidate check to [[/act demoralize]] the target creature. If the target creature was reduced to 0 Hit Points by the triggering Strike, Test Head-Taker can instead Demoralize all opponents within 30 feet by comparing the result of his Intimidation check to each creature's Will DC. Test Head-Taker doesn't take a penalty to these Intimidation checks for not speaking a target's language.", "free");
    assert.deepEqual([plan?.trigger?.event, plan?.trigger?.weapon, plan?.trigger?.free, plan?.resolution?.check?.statistic, plan?.resolution?.reminders?.length], ["own-strike", "melee", true, "intimidation", 2]);
    plan = compile("The test vanguard critically hits a creature with an alchemical grenade Strike", "The test vanguard attempts to [[/act demoralize]] the creature with a mere look.");
    assert.deepEqual([plan?.trigger?.strike, plan?.resolution?.check?.statistic], ["alchemical grenade", "intimidation"]);
    // Extra damage on the creature it hit, no roll; what only tells it dropped.
    plan = compile("The test elk hits a creature with an antler Strike", "The test elk snarls, dealing an additional @Damage[1d8[sonic]] damage to the creature struck. This is in addition to the normal sonic damage from the antler Strike.");
    assert.deepEqual([plan?.trigger?.strike, plan?.resolution?.check?.roll, plan?.resolution?.sharedDamage?.components?.[0]?.formula, plan?.resolution?.outcomes?.success?.manualInstructions], ["antler", "automatic", "1d8[sonic]", undefined]);
    // A held creature's suffering and its way out, for the GM on the failures.
    plan = compile("The test maw hits a creature with a jaws Strike", "The test maw bites down; the target must succeed at a @Check[reflex|dc:34] save or be @UUID[Compendium.pf2e.conditionitems.Item.eIcWbB5o3pP6OIMe]{Immobilized}. While immobilized, the victim takes @Damage[3d8[persistent,bleed]] damage. The creature is immobilized until the test maw ends the effect as a free action or the target succeeds at a DC 38 check to [[/act escape dc=38]].", "free");
    assert.deepEqual(plan?.resolution?.outcomes?.failure?.manualInstructions, ["{target}: While immobilized, the victim takes 3d8 persistent bleed damage.", "{target}: The creature is immobilized until the test maw ends the effect as a free action or the target succeeds at a DC 38 check to Escape."]);
});

test("charges in their own words: the Strike in a sentence of its own, off-guard the first time, a recharge, a bonus to damage (2026-10-11, batch 70)", () => {
    const action = (description, actions = 2) => ({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: `<p>${description}</p>` } } });
    const charge = (description, actions) => compileMonsterAbility(action(description, actions), { basicActions: {} });
    for (const [description, expected] of [
        // The Strike in a sentence of its own, with what only tells the move between; off-guard if it moved 20 feet.
        ["The test bear Strides twice. During this movement, wisps of smoke trail from its body, making it Concealed. The test bear then Strikes. The target is Off-Guard to this attack if the bear moved at least 20 feet.", { strides: 2, strike: null, offGuard: true }],
        ["The test morlock Strides up to twice its Speed, during which it attempts a High Jump or a Long Jump. At any point during its movement, the test morlock can make a melee Strike against an enemy in its reach. The test morlock then can't use Leap Attack for 1 round.", { strides: 2, strike: null, recharge: "1" }],
        ["The test scavenger Strides twice, ignoring difficult terrain caused by rubble. At any point during its movement, the test scavenger can make a melee Strike against an enemy in its reach.", { strides: 2, strike: null }],
        // Off-guard to a creature that hasn't seen it.
        ["The test evil Strides twice, then makes a pseudopod Strike. The target is Off-Guard against this Strike unless it has seen a Slithering Strike before.", { strides: 2, strike: "pseudopod", offGuard: "first" }],
        // A Strike after either Stride, along its path, at any point; a jump; the Strike if it ends in reach (its full stop missing).
        ["The test aurochs Strides twice and makes a single horn Strike against any foe along its path.", { strides: 2, strike: "horn" }],
        ["The test lagofir Strides twice and Strikes at any point during its movement. It can substitute a Swim action in place of any Stride.", { strides: 2, strike: null }],
        ["The test groplit Strides twice, Leaps twice, or Strides once and Leaps once. It then makes a jaws Strike at the end of the movement.", { strides: 2, strike: "jaws" }],
        ["The test rabbit jumps with a maximum height and distance each equal to half its Speed. This movement doesn't trigger reactions. At any point, the test rabbit attempts a jaws Strike.", { strides: 1, strike: "jaws", safe: true }],
        ["The test raider Strides twice If they end their movement within melee reach of an enemy, they can make a melee Strike against that enemy.", { strides: 2, strike: null }],
        ["The test munagola Flies twice. If they end their flight at a lower elevation than they started and within melee reach of at least one enemy, they can make a melee Strike against that enemy, gaining a +1 circumstance bonus to the Strike.", { strides: 2, strike: null, attackBonus: 1 }],
        ["Test Grace Strides twice; if she ends her movement within melee reach of at least one enemy, she can make a melee Strike against that enemy. Test Grace can Fly instead of Stride if she has a fly speed (such as with Angelic Wings).", { strides: 2, strike: null }],
        // Another ability's temporary Hit Points, a name with an accent, a bonus to damage.
        ["The test glutton Strides twice and makes a jaws Strike. If they damage a living creature with this Strike, the temporary Hit Points they receive from Glutton's Feast is increased to [[/r 2d4 #Temporary Hit Points]]{2d4}.", { strides: 2, strike: "jaws" }],
        ["The ōmukade Strides twice and then makes a mandibles Strike. If the ōmukade moved at least 20 feet away from its starting position, it gains a +2 circumstance bonus to this attack roll.", { strides: 2, strike: "mandibles", attackBonus: 2 }],
        ["The test knight Strides twice and then makes a lance Strike. If the test knight moved at least 20 feet from its starting position, it gains a +3 circumstance bonus to its damage rolls.", { strides: 2, strike: "lance", damageBonus: 3 }]
    ]) assert.deepEqual(charge(description), { builtin: "charge", actions: 2, ...expected }, description);
    // Not only in the first round; extra damage on a hit is the Strike activity's (its card applies it).
    assert.equal(charge("Requirements It's the first round of combat Effect The test elk Strides twice and makes a hoof Strike at the end of either Stride."), null);
    assert.notEqual(charge("The test elk Strides twice and makes a hoof Strike after either Stride. If the Strike hits, the test elk deals an additional @Damage[2d4[bludgeoning]] damage.")?.builtin, "charge");
});

test("a reaction's resistance against the damage that sets it off (2026-10-11, batch 71)", () => {
    const reaction = (description) => ({ type: "action", name: "Test", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: description } } });
    const read = (trigger, effect, frequency = "") => compileMonsterAbility(reaction(`${frequency ? `<p><strong>Frequency</strong> ${frequency}</p>` : ""}<p><strong>Trigger</strong> ${trigger}</p><hr /><p><strong>Effect</strong> ${effect}</p>`), { basicActions: {} });
    for (const [trigger, effect, frequency, expected] of [
        ["The test dragon takes fire damage", "The test dragon turns to water for a moment. They gain fire resistance 20, including against the triggering effect, until the end of their next turn.", "", { value: 20, on: ["fire"], types: ["fire"], lasts: 1 }],
        ["The test poppet would take piercing damage", "The test poppet turns the blade aside, gaining resistance 5 against the triggering piercing damage.", "", { value: 5, on: ["piercing"], types: ["piercing"] }],
        ["The test scale is about to take piercing or slashing damage", "The test scale sheds its hardest scales. The test scale gains resistance 15 to the damage, but their AC is reduced by 2 for 1 day, when the shed scales regrow.", "once per day", { value: 15, on: ["piercing", "slashing"], types: null, acPenalty: 2, uses: 1 }],
        ["An enemy is about to damage the test seer with bludgeoning damage or with a spell that has the earth trait", "The test seer gains resistance 10 against the triggering damage.", "", { value: 10, on: ["bludgeoning"], types: null, foe: true }],
        ["The test scrap is damaged by an attack dealing physical damage", "The test scrap takes the blow on its scraps and gains resistance 15 against the triggering attack, but its AC is lowered by 2 for 24 hours. The test scrap's AC cannot be reduced below 16 in this way.", "", { value: 15, on: ["physical"], types: null, attack: true, acPenalty: 2 }]
    ]) assert.deepEqual(read(trigger, effect, frequency), { builtin: "resist-damage", ...expected }, trigger);
    // Not for an ally, nor with more of its own (damage back); a short teleport is a shift (batch 136).
    assert.notEqual(read("An enemy damages one of the test knight's allies", "The ally gains resistance 10 against the triggering damage.")?.builtin, "resist-damage");
    assert.deepEqual(read("The test bard would take damage", "The test bard gains resistance 2 to the triggering damage and teleports to an adjacent space."), { builtin: "resist-damage", value: 2, on: null, types: null, shift: true });
    assert.notEqual(read("The test devil takes fire damage", "The test devil gains resistance 8 to fire against the triggering attack. If this damage came from an unarmed attack, the creature who caused the damage takes @Damage[8[fire]] damage.")?.builtin, "resist-damage");
});

test("its own turn beginning as a trigger, Demoralize as the fight starts, and what only brings another into the fight (2026-10-11, batch 72)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const { readReactionTrigger } = await import("../src/compiler/monster.js");
    const ability = (trigger, effect, type = "free", { requirements = null, actor = null } = {}) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: null }, traits: { value: [] }, description: { value: `<p><strong>Trigger</strong> ${trigger}</p>${requirements ? `<p><strong>Requirements</strong> ${requirements}</p>` : ""}<hr /><p><strong>Effect</strong> ${effect}</p>` } } }, { basicActions, actor });
    assert.deepEqual(readReactionTrigger("The test director's turn begins"), { event: "own-turn-start", reaction: true });
    assert.deepEqual(readReactionTrigger("The test fetch starts its turn"), { event: "own-turn-start", reaction: true });
    // Demoralize as the fight starts, or as its turn begins.
    let plan = ability("The test dragon rolls initiative.", "The test dragon roars out a mighty challenge and attempts to [[/act demoralize]] a creature it can see.");
    assert.deepEqual([plan?.trigger, plan?.resolution?.check?.statistic], [{ event: "initiative", reaction: true, free: true }, "intimidation"]);
    plan = ability("The test director's turn begins", "The test director attempts to Demoralize a creature within 60 feet that they can see and that can see the test director.");
    assert.deepEqual([plan?.trigger, plan?.resolution?.check?.statistic], [{ event: "own-turn-start", reaction: true, free: true }, "intimidation"]);
    // Only another brought into the fight (the GM's: a hazard joins the encounter in its own flow), or a spell Sustained.
    for (const effect of ["The trap rolls initiative.", "The rocks of the area begin to crumble. The hazard rolls for initiative.", "The test wheel begins to spin and rolls initiative."]) assert.deepEqual(ability("A creature opens the vault door", effect, "reaction"), { builtin: "no-effect" }, effect);
    assert.deepEqual(ability("The test druid's turn begins.", "The test druid calls upon the natural world to support his magic. He Sustains a Spell."), { builtin: "no-effect" });
    // Not with more than that: a spell, a condition, a creature exposed to an effect.
    assert.notDeepEqual(ability("A creature takes damage within the area", "The test coral casts Spirit Link on its ally. The hazard rolls initiative.", "reaction"), { builtin: "no-effect" });
    assert.notDeepEqual(ability("A creature enters the water", "A shadowy figure grabs a creature's ankles; it becomes Grabbed. The haunt then rolls initiative.", "reaction"), { builtin: "no-effect" });
    // Its turn beginning, but a requirement, or a hazard's: as before.
    plan = ability("The test python begins its turn", "That creature must attempt a @Check[fortitude|dc:32] save. Critical Success The creature is unaffected. Success The creature is Slowed 1 for 1 round. Failure The creature is Petrified for 1 round.", "free", { requirements: "The test python has a creature Grabbed" });
    assert.notEqual(plan?.trigger?.event, "own-turn-start");
    plan = ability("The test fireworks begin its turn.", "The test fireworks explode, dealing @Damage[6d8[fire]] damage (@Check[reflex|dc:25|basic]) save to all creatures within 15 feet.", "reaction", { actor: { type: "hazard", name: "Test Fireworks", items: [] } });
    assert.notEqual(plan?.trigger?.event, "own-turn-start");
});

test("plain double moves, Speed Surge's kin, a final Strike, Raise a Shield under its own name, a foe teleported away (2026-10-11, batch 73)", () => {
    const item = (description, { type = "action", actions = null, name = "Test", slug = null } = {}) => ({ type: "action", name, system: { slug, actionType: { value: type }, actions: { value: actions }, traits: { value: [] }, description: { value: description } } });
    const compile = (description, options) => compileMonsterAbility(item(description, options), { basicActions: {} });
    // Two Strides for two actions (its Speed bonus and terrain the GM's); not one joined to another action.
    for (const text of ["<p>The test horse Strides twice, with its Speed increased by 10 feet.</p>", "<p>The test ray Swims twice. It has a +10-foot circumstance bonus to its Speed during these actions.</p>", "<p>The test pegasus uses 2 move actions, each of which can be either Stride or Fly. It gains a +20-foot circumstance bonus to its Speeds during a Gallop.</p>"]) assert.deepEqual(compile(text, { actions: 2 }), { builtin: "no-effect" }, text);
    assert.notDeepEqual(compile("<p>The test warrior Raises a Shield and Strides twice.</p>", { actions: 2 }), { builtin: "no-effect" });
    // One action for two moves: once a round, or a recharge.
    assert.deepEqual(compile("<p><strong>Frequency</strong> once per round</p><p><strong>Effect</strong> The test chameleon Strides twice. During this movement, it flits between planes, gaining resistance 5 to physical damage.</p>", { actions: 1 }), { builtin: "speed-surge", actions: 1, uses: null, oncePerRound: true });
    assert.deepEqual(compile("<p>The test tenome Strides twice, Steps twice, or Steps and Strides (in either order). It cannot use Burst of Speed again for [[/gmr 1d4 #Recharge]]{1d4 rounds}.</p>", { actions: 1 }), { builtin: "speed-surge", actions: 1, uses: null, recharge: "1d4" });
    // A final Strike as it drops, its name before "is reduced to 0 HP".
    assert.deepEqual(compile("<p><strong>Frequency</strong> once per day</p><p><strong>Trigger</strong> Test Berleth is reduced to 0 HP</p><hr /><p><strong>Effect</strong> Test Berleth makes a final shovel Strike before dying.</p>", { type: "reaction" }), { builtin: "death-strike", strike: "shovel" });
    // PF2e's Raise a Shield under its own name, with no slug: the basic action.
    assert.deepEqual(compile("<p><strong>Requirements</strong> You are wielding a shield.</p><p>You position your shield to protect yourself. When you have Raised a Shield, you gain its listed circumstance bonus to AC.</p>", { actions: 1, name: "Raise a Shield (Wing Only)" }), { builtin: "no-effect" });
    // A foe teleported away: a push for the simulator and the card, the teleport's rules a note.
    const plan = compile("<p><strong>Trigger</strong> An enemy within 15 feet damages the test dragon</p><hr /><p><strong>Effect</strong> The test dragon teleports the creature up to 45 feet away. The destination must be on the ground and in a space with no hazards.</p>", { type: "reaction" });
    assert.deepEqual([plan?.trigger?.event, plan?.trigger?.within, plan?.targeting?.target, plan?.resolution?.outcomes?.success?.forcedMovement?.distance], ["hit-by", 15, "the attacker", 45]);
    assert.match(plan.resolution.outcomes.success.manualInstructions[0], /teleported up to 45 feet away rather than pushed/);
});

test("a condition that grows with each later failure (2026-10-11, batch 74)", async () => {
    const { readStack } = await import("../src/compiler/monster.js");
    const action = (description) => ({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: [] }, description: { value: `<p>${description}</p>` } } });
    const stacks = (description) => { const outcomes = compileMonsterAbility(action(description), { basicActions: {} })?.resolution?.outcomes; return ["failure", "criticalFailure"].map((degree) => outcomes?.[degree]?.effects?.map((effect) => [effect.slug, effect.value, effect.stack ?? null])); };
    // "… increases by 1 (or 2 if it critically fails) (to a maximum of stupefied 4)": by the degree.
    assert.deepEqual(stacks("The test lamia touches a creature, who must succeed at a @Check[will|dc:28] save or become Stupefied 1 (Stupefied 2 if it critically fails). If the target fails additional saves against this ability, the condition value increases by 1 (or 2 if it critically fails) (to a maximum of stupefied 4). This condition value decreases by 1 every 24 hours."),
        [[["stupefied", 1, { by: 1, max: 4 }]], [["stupefied", 2, { by: 2, max: 4 }]]]);
    // "If the creature is already drained, this increases its drained value instead": by the value it gives.
    assert.deepEqual(stacks("The grabbed creature must succeed at a @Check[fortitude|dc:38] save or become Drained 2 (Drained 3 on a critical failure). If the creature is already drained, this increases its drained value instead, to a maximum of drained 4."),
        [[["drained", 2, { by: 2, max: 4 }]], [["drained", 3, { by: 3, max: 4 }]]]);
    assert.deepEqual(readStack("<p>On each subsequent failure, the drained condition value increases by 1 (or by 2 on a critical failure), to a maximum of drained 4.</p>"), { slug: "drained", by: 1, critical: 2, max: 4 });
    assert.deepEqual(readStack("<p>If it's already stupefied, its stupefied value increases by 1 instead (to a maximum of Stupefied 4).</p>"), { slug: "stupefied", by: 1, max: 4 });
    assert.deepEqual(readStack("<p>Each time a target fails an additional save against this ability, the condition value increases by 1 (to a maximum of Clumsy 4).</p>"), { slug: null, by: 1, max: 4 });
    // Not two conditions at once.
    assert.equal(readStack("<p>If the target is already drained or doomed, the value increases by 1 (to a maximum of 4).</p>"), null);
});

test("a worse condition for a creature that already has the first: slowed, then petrified (2026-10-11, batch 75)", async () => {
    const { readEscalation } = await import("../src/compiler/monster.js");
    const action = (description) => ({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: [] }, description: { value: description } } });
    // Set aside for the other readings, then on the failure's Slowed; its paragraph's end and a sentence after it.
    const plan = compileMonsterAbility(action("<p>The test basilisk stares at a creature it can see within 30 feet. That creature must attempt a @Check[fortitude|dc:27] save. If it fails and has not already been slowed by this ability, it becomes @UUID[Compendium.pf2e.conditionitems.Item.xYTAsEpcJE1Ccni3]{Slowed 1}. If the creature was already slowed by this ability, a failed save causes the creature to be @UUID[Compendium.pf2e.conditionitems.Item.dTwPJuKgBQCMxixg]{Petrified} permanently.</p>\n<p>A creature petrified in this manner can be restored with fresh blood.</p>"), { basicActions: {} });
    assert.deepEqual(plan?.resolution?.outcomes?.failure?.effects, [{ kind: "condition", slug: "slowed", value: 1, duration: null, escalate: { if: "slowed", slug: "petrified", value: null, duration: null } }]);
    // Its time when it says one.
    assert.deepEqual([readEscalation("<p>If a creature is already slowed when it fails its save, it becomes Paralyzed for 1 round.</p>")].map((entry) => [entry.if, entry.slug, entry.duration?.value, entry.duration?.unit]), [["slowed", "paralyzed", 1, "rounds"]]);
    assert.equal(readEscalation("<p>When a creature already slowed by the test thorns fails its Fortitude save, it becomes Petrified for 1 minute but is turned to wood instead of stone.</p>")?.duration?.unit, "minutes");
});

test("a save to avoid or resist becoming a condition; a critical failure's condition for good (2026-10-11, batch 76)", () => {
    const item = (description, type = "action") => ({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: 1 }, traits: { value: [] }, description: { value: `<p>${description}</p>` } } });
    const rows = (description, type) => { const outcomes = compileMonsterAbility(item(description, type), { basicActions: {} })?.resolution?.outcomes; return ["failure", "criticalFailure"].map((degree) => outcomes?.[degree]?.effects?.map((effect) => [effect.slug, effect.value, effect.duration?.value ?? null])); };
    assert.deepEqual(rows("The test sprite tickles a creature within reach, which must succeed at a @Check[fortitude|dc:20] save to avoid becoming Sickened 1 (Sickened 2 on a critical failure)."), [[["sickened", 1, null]], [["sickened", 2, null]]]);
    // An aura's: "When a creature ends its turn in the aura, it must succeed at a … save to resist becoming Slowed 1".
    assert.deepEqual(rows("30 feet. When a creature ends its turn in the aura, it must succeed at a @Check[will|dc:31] save to resist becoming Slowed 1 (Slowed 2 on a critical failure).", "passive"), [[["slowed", 1, null]], [["slowed", 2, null]]]);
    // "(or Blinded permanently on a critical failure)": not the failure's minute.
    assert.deepEqual(rows("All creatures within 120 feet must succeed at a @Check[fortitude|dc:40] save to resist becoming Dazzled for 1 minute (or Blinded permanently on a critical failure)."), [[["dazzled", null, 1]], [["blinded", null, null]]]);
});

test("a save to avoid a condition that must only be attempted; a critical failure's longer time with words after it (2026-10-11, batch 77)", () => {
    const item = (description) => ({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: 2 }, traits: { value: [] }, description: { value: `<p>${description}</p>` } } });
    const rows = (description) => { const outcomes = compileMonsterAbility(item(description), { basicActions: {} })?.resolution?.outcomes; return ["failure", "criticalFailure"].map((degree) => outcomes?.[degree]?.effects?.map((effect) => [effect.slug, effect.value, effect.duration?.value ?? null, effect.duration?.unit ?? null])); };
    assert.deepEqual(rows("The test governor sobs. Creatures within 30 feet must attempt a @Check[will|dc:29] save to avoid becoming Stunned 1 (Stunned 3 on a critical failure)."), [[["stunned", 1, null, null]], [["stunned", 3, null, null]]]);
    assert.deepEqual(rows("All living creatures within 30 feet must attempt a @Check[will|dc:26] save to avoid becoming Paralyzed for 1 round (or 1 minute on a critical failure, with a new save at the end of their turn to recover)."), [[["paralyzed", null, 1, "rounds"]], [["paralyzed", null, 1, "minutes"]]]);
});

test("a reaction's save whose trigger names a Strike, read or not; more hit and attack triggers (2026-10-11, batch 78)", async () => {
    const { readReactionTrigger } = await import("../src/compiler/monster.js");
    assert.deepEqual(readReactionTrigger("A creature lands a critical hit with a melee Strike against the test vitalia"), { event: "hit-by", reaction: true, melee: true, critical: true });
    assert.deepEqual(readReactionTrigger("A creature succeeds at a melee Strike against the test mat"), { event: "hit-by", reaction: true, melee: true });
    assert.deepEqual(readReactionTrigger("The test artist is targeted with a melee or ranged Strike by a creature within 15 feet"), { event: "attacked", reaction: true, melee: false, within: 15 });
    // A trigger it can't read that names a Strike: its save still reads, as a card for the GM to use.
    const plan = compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: "<p><strong>Trigger</strong> The test ghost reduces a living creature to 0 Hit Points with a melee Strike</p><hr /><p><strong>Effect</strong> The creature must succeed at a @Check[will|dc:25] save or become @UUID[Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL]{Frightened 2}.</p>" } } }, { basicActions: {} });
    assert.deepEqual([plan?.trigger?.event, plan?.resolution?.outcomes?.failure?.effects?.[0]?.slug], ["use", "frightened"]);
});

test("a rage whose text says whom it attacks first and after, allies among them (2026-10-11, batch 79)", () => {
    const plan = compileMonsterAbility({ type: "action", name: "Test Rage", system: { slug: null, actionType: { value: "free" }, actions: { value: null }, traits: { value: [] }, description: { value: "<p><strong>Trigger</strong> The test berserker is 50 Hit Points or below and takes damage.</p><hr /><p><strong>Effect</strong> The test berserker becomes enraged. It gains 10 temporary Hit Points and a +2 status bonus to damage rolls, and takes a –1 penalty to AC. It attacks the nearest creature first and then any others, allies included, until the fight ends.</p>" } } }, { basicActions: {} });
    assert.deepEqual([plan?.builtin, plan?.trigger, plan?.model?.tempHp, plan?.model?.modifiers], ["self-effect", { kind: "hp-at-most", value: 50 }, 10, [{ on: "damage", type: "status", value: 2 }, { on: "ac", type: "untyped", value: -1 }]]);
});

test("two Strikes and what both hits bring; Terrifying Smite, Pierce Armor, Drag (2026-10-11, batch 80)", () => {
    const action = (description, actions = 1) => ({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: `<p>${description}</p>` } } });
    const compile = (description, actions) => compileMonsterAbility(action(description, actions), { basicActions: {} });
    assert.deepEqual(compile("The test oni makes two fist Strikes targeting the same creature. If they both hit, the target becomes @UUID[Compendium.pf2e.conditionitems.Item.xYTAsEpcJE1Ccni3]{Slowed 1} for 1 round."), { builtin: "multi-strike", actions: 1, strikes: ["fist", "fist"], sameTarget: true, bothHit: { conditions: [{ slug: "slowed", value: 1, rounds: 1 }], damage: [] } });
    assert.deepEqual(compile("The test centaur kicks wildly. They make two hoof Strikes against the same target. The test centaur's multiple attack penalty doesn't increase until after it makes both attacks. If both attacks hit, the target is also knocked Prone.", 2)?.bothHit, { conditions: [{ slug: "prone", value: null, rounds: null }], damage: [] });
    assert.deepEqual(compile("Test Okoa makes two claw Strikes at the same target, each using her current multiple attack penalty. If both attacks hit, the target is also dealt @Damage[1d8[persistent,bleed]] damage.")?.bothHit, { conditions: [], damage: ["1d8[persistent,bleed]"] });
    // Not one that brings more than it reads (an exposure to a poison).
    assert.equal(compile("The test daemon makes two claw Strikes against the same creature. If both hit, the creature takes @Damage[2d10[bleed]] and is exposed to test venom.")?.bothHit, undefined);
    // An enemy with one of its allies beside it; the armor it breaks the GM's; a drag the GM's.
    const smite = compile("The test rekhep makes a Strike against an enemy that has one of the test rekhep's allies within its reach. On a hit, the target takes an additional 2d8 mental damage and is Frightened 2. The extra damage and frightened value are doubled on a critical hit.", 2);
    assert.deepEqual([smite?.builtin, smite?.requires, smite?.onHit?.conditions?.[0]?.value, smite?.onHit?.critical?.[0]?.value], ["strike-activity", "ally-adjacent", 2, 4]);
    const pierce = compile("The test smilodon makes a fangs Strike against a creature that's Grabbed or Restrained. If the attack hits, the creature is knocked Prone; if the creature is wearing armor with hardness 10 or lower, the armor is Broken. If this Strike breaks a creature's armor or damages a creature who is unarmored or wearing broken armor, the creature also takes @Damage[2d6[bleed]]. This Strike doesn't further damage armor that's already broken.");
    assert.deepEqual([pierce?.requires, pierce?.onHit?.conditions?.[0]?.slug, pierce?.onHit?.damage], ["grabbed", "prone", ["2d6[bleed]"]]);
    assert.deepEqual(compile("The test hyena makes a jaws Strike against a Prone enemy. If it hits, in addition to dealing damage, the test hyena Strides up to 10 feet, dragging the enemy along."), { builtin: "no-effect", strikeOnly: true });
});

test("a harder Escape; a failed save's own sentence; a hit earlier this turn; bola and limb wordings (2026-10-11, batch 81)", () => {
    const action = (description, actions = 1, type = "action") => ({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: [] }, description: { value: description } } });
    const compile = (description, actions, type) => compileMonsterAbility(action(description, actions, type), { basicActions: {} });
    const reaction = (trigger, effect) => compile(`<p><strong>Trigger</strong> ${trigger}</p><hr /><p><strong>Effect</strong> ${effect}</p>`, null, "reaction");
    // Its reaction as a creature it holds tries to Escape.
    assert.deepEqual(reaction("A creature Grabbed or Restrained by the test serpent attempts to Escape.", "The DC of the Escape check is increased by 2."), { builtin: "escape-guard", value: 2 });
    assert.deepEqual(reaction("A creature grabbed by Test Velka attempts to Escape", "The triggering creature takes a –3 circumstance penalty to the check to Escape."), { builtin: "escape-guard", value: 3 });
    assert.notEqual(reaction("A creature Grabbed by the test serpent attempts to Escape.", "The test serpent makes a jaws Strike against it.")?.builtin, "escape-guard");
    // "If the target fails a … save, it gains …", and a monster's own name in a duration.
    const curse = compile("<p>The test dancer curses a foe it touches. If the target fails a @Check[will|dc:18] save, it gains @UUID[Compendium.pf2e.conditionitems.Item.i3OJZU2nk64Df3xm]{Clumsy 1} and @UUID[Compendium.pf2e.conditionitems.Item.e1XGnhKNSQIm5IXg]{Stupefied 1}.</p>");
    assert.deepEqual(curse?.resolution?.outcomes?.failure?.effects?.map((effect) => [effect.slug, effect.value]), [["clumsy", 1], ["stupefied", 1]]);
    const sand = compile("<p>Test Vashka throws grit into the eyes of a foe beside her. If the target fails a @Check[reflex|dc:30] save, they are @UUID[Compendium.pf2e.conditionitems.Item.TkIyaNPgTZFBCCuh]{Dazzled} until the beginning of Test Vashka's next turn.</p>");
    assert.deepEqual(sand?.resolution?.outcomes?.failure?.effects?.[0]?.duration, { mode: "fixed", value: 1, unit: "rounds", expiry: "turn-start", anchor: "source-turn" });
    // A Strike at a foe it hit earlier this turn, its critical failure in a sentence of its own.
    const stunning = compile("<p><strong>Requirements</strong> The test emissary hit a foe earlier this turn with a weapon Strike</p><hr /><p><strong>Effect</strong> The test emissary makes a weapon Strike against the foe. On a success, the foe must succeed at a @Check[fortitude|dc:30] save or become @UUID[Compendium.pf2e.conditionitems.Item.dfCMdR4wnpbYNTix]{Stunned 1}. On a critical failure, the foe is @UUID[Compendium.pf2e.conditionitems.Item.dfCMdR4wnpbYNTix]{Stunned 2} instead.</p>");
    assert.deepEqual([stunning?.builtin, stunning?.requires, stunning?.onHit?.save?.resolution?.outcomes?.criticalFailure?.effects?.[0]?.value], ["strike-activity", "hit-earlier", 2]);
    // A bola drawn and thrown, then a Trip.
    const bola = compile("<p>The test hunter draws a bola and Strikes a target within 20 feet. On a success, the test hunter immediately rolls an @Check[athletics|defense:fortitude] check against the target's Fortitude DC to Trip them.</p>");
    assert.deepEqual([bola?.strike, bola?.onHit?.follow], ["bola", "trip"]);
    // Strikes each with another limb; wing Strikes, then a fall the GM's.
    assert.deepEqual(compile("<p>The test crawler makes up to three Strikes against different targets, each using a different limb.</p>", 2)?.strikes, [null, null, null]);
    assert.deepEqual(compile("<p><strong>Frequency</strong> once per turn</p><hr /><p><strong>Effect</strong> The test bat makes two wing Strikes, then falls if it's flying. It can't Fly until the end of its turn.</p>")?.strikes, ["wing", "wing"]);
});

test("a second Strike after a hit; berserk; an effect on its own critical hit; a maneuver with another skill (2026-10-11, batch 82)", () => {
    const action = (description, actions = 1, type = "action") => ({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: [] }, description: { value: description } } });
    const compile = (description, actions, type, basicActions = {}) => compileMonsterAbility(action(description, actions, type), { basicActions });
    // The second Strike only after a hit, or instead a move (the GM's).
    assert.deepEqual(compile("<p>The test mate makes a melee Strike with their boat hook. If this Strike hits, the test mate can either move the target 5 feet within the hook's reach or make a fist Strike against the target without increasing their multiple attack penalty until after the fist Strike.</p>", 2),
        { builtin: "multi-strike", actions: 2, strikes: ["boat hook", "fist"], sameTarget: true, sameMap: true, ifFirstHits: true, instead: "move the target 5 feet within the hook's reach" });
    // Only while berserk; "1d6 extra damage" of the Strike's type; a singular "Requirement".
    const slam = compile("<p><strong>Requirement</strong> The test golem is berserk.</p><hr /><p><strong>Effect</strong> The test golem Strikes with its fist at a -1 circumstance penalty. If it hits, it deals 1d6 extra damage and knocks the target Prone.</p>");
    assert.deepEqual([slam?.requires, slam?.strike, slam?.attackBonus, slam?.onHit?.damage, slam?.onHit?.conditions?.[0]?.slug], ["berserk", "fist", -1, ["1d6[strike]"], "prone"]);
    // Its allies' effect as its own Strike critically hits.
    const rally = compile("<p><strong>Trigger</strong> The test captain rolls a critical hit against a creature</p><hr /><p><strong>Effect</strong> All allies that can see the test captain gain a +1 circumstance bonus to attack rolls until the start of the test captain's next turn.</p>\n<p>@UUID[Compendium.pf2e.bestiary-effects.Item.7x0O2GqWBJiAk5PF]{Effect: Test Rally}</p>", null, "reaction");
    assert.deepEqual([rally?.trigger, rally?.resolution?.applications?.[0]?.recipients], [{ event: "own-strike", reaction: true, on: ["criticalSuccess"], strike: null }, "allies-in-area"]);
    // A Grapple with Diplomacy.
    const grapple = { modelVersion: 13, source: { name: "Grapple", slug: "grapple", uuid: null, type: "action" }, rank: 1, traits: ["attack"], activation: { time: "1", traits: ["attack"] }, targeting: { target: "1 creature", range: "touch", area: null }, trigger: { event: "use", immunity: null },
        resolution: { kind: "check", check: { roll: "skill", statistic: "athletics", against: { dc: "target", statistic: "fortitude" } }, sharedDamage: null, outcomes: {} } };
    const embrace = compile("<p>The test charmer attempts to [[/act grapple skill=diplomacy]]{Grapple} a creature using their Diplomacy bonus instead of Athletics. If the creature is willing, the test charmer automatically succeeds.</p>", 1, "action", { grapple });
    assert.deepEqual([embrace?.source?.name, embrace?.resolution?.check?.statistic, embrace?.traits], ["Test", "diplomacy", ["attack"]]);
});

test("only a Strike; a Strike at every creature in reach; a distant Strike; damage on a Prone creature; four Strikes at their penalties (2026-10-11, batch 83)", () => {
    const action = (description, actions = 1) => ({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: description } } });
    const compile = (description, actions) => compileMonsterAbility(action(description, actions), { basicActions: {} });
    const strikeOnly = { builtin: "no-effect", strikeOnly: true };
    assert.deepEqual(compile("<p><strong>Requirements</strong> Test Vela is holding an unloaded hand crossbow</p><hr /><p><strong>Effect</strong> Test Vela Interacts to reload the hand crossbow and Strikes with it.</p>"), strikeOnly);
    assert.deepEqual(compile("<p>The test beetle makes a mandibles Strike; if the Strike hits, the target's armor takes the damage and the acid damage bypasses the armor's Hardness.</p>"), strikeOnly);
    assert.deepEqual(compile("<p>The test mantis makes a mandibles Strike against a creature it has Grabbed. If that Strike hits and the creature is wearing armor with Hardness 10 or lower, the armor is broken. This Strike doesn't further damage armor that's already broken.</p>"), strikeOnly);
    assert.deepEqual(compile("<p>The test squid spins about. The test squid makes a tentacle Strike against every creature within its reach.</p>", 2), { builtin: "multi-strike", actions: 2, strikes: ["tentacle"], each: true });
    const portal = compile("<p>The test dragon opens a small rift and makes a claw Strike against a creature within 100 feet. The target is Off-Guard to the Strike.</p>", 2);
    assert.deepEqual([portal?.builtin, portal?.strike, portal?.offGuard], ["strike-activity", "claw", true]);
    const stomp = compile("<p>The test cap Strides up to half its Speed and makes a boot Strike at any point during that movement. If the boot Strike hits a Prone creature, it deals an extra @Damage[2d6[bleed]].</p>");
    assert.deepEqual([stomp?.strides, stomp?.strike, stomp?.onHit?.damage, stomp?.onHit?.proneDamage], [1, "boot", [], ["2d6[bleed]"]]);
    assert.deepEqual(compile("<p><strong>Requirements</strong> The test rivka has not attacked yet this turn</p><hr /><p><strong>Effect</strong> The test rivka slashes with its claws. It makes four Strikes: the first at its highest attack bonus, the next two with a -4 penalty to their attack rolls, and the last one with a -8 penalty. This ability counts as four Strikes for the purpose of its multiple attack penalty.</p>", 2),
        { builtin: "multi-strike", actions: 2, strikes: [null, null, null, null], sameTarget: true, sameMap: true, penalties: [0, 4, 4, 8], countsAs: 4, requires: "first-attack" });
});

test("any object a creature disguises itself as; a mythic reroll; a Stride and then two Strikes (2026-10-11, batch 84)", () => {
    const action = (description, actions = 1, type = "action") => ({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: [] }, description: { value: description } } });
    const compile = (description, actions, type) => compileMonsterAbility(action(description, actions, type), { basicActions: {} });
    const none = { builtin: "no-effect" };
    assert.deepEqual(compile("<p>Until the next time it acts, the test warden appears to be a door. It has an automatic result of 30 on Deception checks and DCs to pass as a door.</p>"), none);
    assert.deepEqual(compile("<p>Until it acts, the test effigy resembles an ordinary scarecrow. It has an automatic result of 30 on Deception checks and DCs to pass as an ordinary scarecrow.</p>"), none);
    assert.deepEqual(compile("<p>Until the next time they act, the test vine appears to be a tangle of flowers. They have an automatic result of 32 (35 in forests) on Deception and Stealth checks and DCs to pass as a non-creature plant.</p>"), none);
    assert.deepEqual(compile("<p><strong>Requirements</strong> The test chest is in its Lid Shape</p><hr /><p><strong>Effect</strong> Until the test chest acts, they resemble a plain wooden chest. They have an automatic result of 34 on Deception checks and DCs to pass as a chest.</p>"), none);
    // Not with more: fast healing, an aura it turns off, an Engulf.
    assert.notDeepEqual(compile("<p>Until the next time it acts, the test kadamel appears to be a statue. It has an automatic result of 40 on Deception checks and DCs to pass as a statue. While remaining motionless in this way, it has fast healing 10.</p>"), none);
    assert.notDeepEqual(compile("<p>Until the next time it acts, the test outcrop appears to be a rock. It has an automatic result of 40 on Deception checks and DCs to pass as a rock. Its dust aura is deactivated while this is being used.</p>"), none);
    // A mythic reroll, the new result kept.
    assert.deepEqual(compile("<p><strong>Cost</strong> 1 Mythic Point</p>\n<p><strong>Trigger</strong> The test elder fails a check</p><hr /><p><strong>Effect</strong> The test elder rerolls the check.</p>", null, "free"), { builtin: "save-reroll", save: null, keep: "new", free: true, mythic: true });
    // A Stride, then two Strikes.
    assert.deepEqual(compile("<p>The test troll lopes forward, Striding and then making two claw Strikes.</p>", 2), { builtin: "multi-strike", actions: 2, strikes: ["claw", "claw"], sameTarget: true, strides: 1 });
    assert.deepEqual(compile("<p>The test beast Strides, ignoring difficult terrain, then makes two claw Strikes at the end of its movement.</p>", 2)?.strides, 1);
});

test("a hazard that only rolls initiative; a form shift as the fight starts; charges after a distance; a Stride with Strikes along the way (2026-10-11, batch 85)", () => {
    const item = (description, actions = 1, type = "action") => ({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: [] }, description: { value: description } } });
    const compile = (description, actions, type) => compileMonsterAbility(item(description, actions, type), { basicActions: {} });
    const reaction = (trigger, effect, type = "reaction") => compile(`<p><strong>Trigger</strong> ${trigger}</p><hr /><p><strong>Effect</strong> ${effect}</p>`, null, type);
    const none = { builtin: "no-effect" };
    assert.deepEqual(reaction("A creature enters the test crypt", "Ghostly whispers fill the air, and the haunt rolls initiative."), none);
    assert.deepEqual(reaction("A creature opens the test vault", "The hazard rolls initiative as the water surges forth."), none);
    assert.deepEqual(reaction("A creature steps into the test ring", "A test sprite emerges from the ring to defend it, and the hazard then rolls initiative."), none);
    assert.notDeepEqual(reaction("A creature steps into the test hall", "The trap makes an acid dart Strike against the triggering creature. The trap then rolls initiative."), none);
    assert.notDeepEqual(reaction("A creature enters the test deck", "The ship pitches on the waves. The hazard rolls initiative and performs its routine as a free action.", "free"), none);
    assert.deepEqual(reaction("Test Vela rolls initiative", "Test Vela's instincts take over. Test Vela uses Change Shape to enter her hybrid form.", "free"), none);
    // A charge's extra after a distance; a Stride up to its Speed into reach; a critical hit's condition.
    const horn = compile("<p>The test unicorn Strides up to double its Speed in a straight line and then makes a horn Strike. If the test unicorn moved at least 20 feet, it deals an additional 2d6 damage on a hit.</p>", 2);
    assert.deepEqual([horn?.builtin, horn?.strike, horn?.onHit?.damage], ["strike-activity", "horn", ["2d6[strike]"]]);
    assert.equal(compile("<p>The test roast Strides up to double its speed in a straight line and then makes a slam Strike. If it moved at least 10 feet, it gains a +1 circumstance bonus to its attack roll.</p>", 2)?.attackBonus, 1);
    const skull = compile("<p>The test dinosaur Strides up to its Speed. If it ends its movement within melee reach of a target, it can make a skull Strike against that target. If the test dinosaur critically hits with this Strike, the creature hit is @UUID[Compendium.pf2e.conditionitems.Item.dfCMdR4wnpbYNTix]{Stunned 1}.</p>", 2);
    assert.deepEqual([skull?.strides, skull?.strike, skull?.onHit?.critical], [1, "skull", [{ slug: "stunned", value: 1, duration: null }]]);
    // Strikes at different creatures along a Stride.
    assert.deepEqual(compile("<p>The test beast Strides up to its Speed. It can make up to four claw Strikes at any point during this movement, each against a different target. These attacks count toward the test beast's multiple attack penalty, but the multiple attack penalty doesn't increase until after the test beast makes all of its attacks.</p>", 3),
        { builtin: "multi-strike", actions: 3, strikes: ["claw"], each: true, max: 4, strides: 1, sameMap: true });
    assert.deepEqual(compile("<p>The test giant Strides up to their Speed, Striking once with each of their scimitars at any point during the movement.</p>", 2), { builtin: "multi-strike", actions: 2, strikes: ["scimitar", "scimitar"], sameTarget: true, strides: 1 });
});

test("Counterspell's kin: a spell or effect that sets it off and an attempt to counteract it, the GM's (2026-10-11, batch 86)", () => {
    const reaction = (trigger, effect) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: `<p><strong>Trigger</strong> ${trigger}</p><hr /><p><strong>Effect</strong> ${effect}</p>` } } }, { basicActions: {} });
    const none = { builtin: "no-effect" };
    assert.deepEqual(reaction("The test warden is the target of a spell", "The test warden attempts to counteract the triggering spell, with a counteract modifier of [[/r 1d20+20 #Counteract]]{+20}."), none);
    assert.deepEqual(reaction("A creature within 30 feet casts a divine spell", "The test acolyte attempts to counteract the triggering spell using their spell attack modifier and a counteract rank of 2."), none);
    assert.deepEqual(reaction("The test dragon is targeted by a mental effect they're aware of", "The test dragon immediately attempts to counteract the triggering effect (counteract rank 8)."), none);
    assert.deepEqual(reaction("A foe within 60 feet uses an auditory effect", "The test dragon makes a counteract check against the effect (counteract rank 3)."), none);
    // Not a counteract set off by anything else.
    assert.notDeepEqual(reaction("A living creature within 30 feet is reduced to 0 Hit Points", "The residual energy attempts to counteract any vitality effect on it."), none);
});

test("a teleport and a Strike; two weapons and a Disarm when both hit; a Strike and a reload (2026-10-11, batch 87)", () => {
    const compile = (description, actions = 1) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: description } } }, { basicActions: {} });
    assert.deepEqual(compile("<p>The test stalker teleports into an occupied space it can see within 50 feet and makes a melee Strike.</p>", 2), { builtin: "charge", actions: 2, strides: 2, strike: null, safe: true });
    assert.deepEqual(compile("<p>The test captain makes two Strikes, one with their rapier and one with their main-gauche (in either order). If both Strikes hit, the test captain can attempt to [[/act disarm]] the target. Their multiple attack penalty increases only after all the attacks are made.</p>", 2),
        { builtin: "multi-strike", actions: 2, strikes: ["rapier", "main-gauche"], sameMap: true, sameTarget: true, bothHit: { conditions: [], damage: [], follow: "disarm" } });
    assert.deepEqual(compile("<p>The test marshal makes a melee Strike against an opponent within reach and Interacts to reload a firearm in their other hand.</p>"), { builtin: "no-effect", strikeOnly: true });
    // A bonus to its own save as it comes.
    const reaction = (trigger, effect) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: `<p><strong>Trigger</strong> ${trigger}</p><hr /><p><strong>Effect</strong> ${effect}</p>` } } }, { basicActions: {} });
    assert.deepEqual(reaction("Test Pell attempts a saving throw against a spell cast by a creature he can see", "Test Pell gains a +2 circumstance bonus to the triggering save."), { builtin: "save-bonus-reaction", value: 2, against: "spell" });
    assert.deepEqual(reaction("Test Ona is about to make a saving throw against a spell or magical effect", "Test Ona gains a +1 circumstance bonus to the triggering save."), { builtin: "save-bonus-reaction", value: 1, against: "magical" });
    assert.deepEqual(reaction("The test spy is about to attempt a saving throw", "The test spy touches their holy symbol and gains a +2 circumstance bonus to the triggering save."), { builtin: "save-bonus-reaction", value: 2 });
    assert.deepEqual(reaction("An opponent casts a spell that targets the test beast and requires a saving throw", "The test beast gains a +4 circumstance bonus to the saving throw. If they critically succeed at the save, they can choose another creature within 30 feet to target instead."), { builtin: "save-bonus-reaction", value: 4, against: "spell" });
});

test("a basic maneuver back in place of a Strike (2026-10-11, batch 88)", () => {
    const reaction = (trigger, effect, requirements = null) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: `<p><strong>Trigger</strong> ${trigger}</p>${requirements ? `<p><strong>Requirements</strong> ${requirements}</p>` : ""}<hr /><p><strong>Effect</strong> ${effect}</p>` } } }, { basicActions: {} });
    const answer = (triggers, skill, penalty = 0, extra = {}) => ({ builtin: "reaction-strike", triggers, strike: null, skill, penalty, disrupts: false, ...extra });
    assert.deepEqual(reaction("A creature rolls a critical failure on a melee weapon Strike against the test tree", "The test tree attempts to Disarm the creature."), answer(["critical-miss"], "disarm"));
    assert.deepEqual(reaction("A creature within the test thug's reach misses the test thug with a melee Strike.", "The test thug attempts to [[/act shove]] the triggering creature at a -2 penalty. If the test thug rolls a critical failure, it gets a failure instead."), answer(["missed"], "shove", 2));
    assert.deepEqual(reaction("A creature hits the test slime with a melee weapon", "The test slime attempts to Disarm the creature. On a critical success, the weapon sinks into the slime rather than falling to the ground."), answer(["hit"], "disarm"));
    assert.deepEqual(reaction("The test cleric takes damage from a melee attack", "The test cleric swears revenge and attempts to Demoralize the triggering creature."), answer(["damaged-adjacent"], "demoralize"));
    // Not with a condition it adds, a requirement, or a choice of a Strike.
    assert.equal(reaction("A creature hits the test bruiser with a melee Strike", "The test bruiser attempts to Shove the creature. On a success or a critical success, the target is also knocked Prone."), null);
    assert.equal(reaction("A creature makes a melee weapon Strike against the test ape and misses", "The test ape attempts to Disarm the attacker of the triggering weapon.", "The test ape is benefiting from its Defensive Slam"), null);
});

test("summoned steeds and summoning traps; Strikes at different creatures; two Strikes, both at full bonus, a third's damage when both land (2026-10-11, batch 89)", () => {
    const item = (description, actions = 1, type = "action") => ({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: [] }, description: { value: description } } });
    const compile = (description, actions, type) => compileMonsterAbility(item(description, actions, type), { basicActions: {} });
    const none = { builtin: "no-effect" };
    assert.deepEqual(compile("<p>The test rider summons a war horse with elite adjustments. This steed remains until it is slain, the test rider Dismisses this effect, or the test rider summons another steed.</p>", 2), none);
    assert.deepEqual(compile("<p><strong>Trigger</strong> A creature enters the test circle.</p><hr /><p><strong>Effect</strong> This trap summons a specific level 1 creature, determined when the trap is created. The creature rolls initiative and remains for 4 rounds.</p>", null, "reaction"), none);
    assert.deepEqual(compile("<p>The test wraith makes three melee Strikes, each against a different target within reach. The multiple attack penalty applies to each attack but increases only after all the attacks have been made.</p>", 2), { builtin: "multi-strike", actions: 2, strikes: [null, null, null], sameMap: true, each: true, max: 3 });
    assert.deepEqual(compile("<p>The test matriarch makes a scimitar attack against each enemy within reach. Each attack counts toward their multiple attack penalty, but the penalty does not increase until after all the attacks. The first enemy they damage is subject to Test Caress.</p>", 3), { builtin: "multi-strike", actions: 3, strikes: ["scimitar"], each: true, sameMap: true });
    assert.deepEqual(compile("<p>The test monk Flies and makes up to four fist Strikes against different targets at any points during this movement. The attacks count toward its multiple attack penalty normally, but the penalty does not increase until after Test Fists is complete.</p>", 2), { builtin: "multi-strike", actions: 2, strikes: ["fist"], each: true, max: 4, strides: 1, sameMap: true });
    assert.deepEqual(compile("<p>The test linnorm Strides and then makes a jaws Strike with each of their heads, each against a different target. Both attacks count toward the test linnorm's multiple attack penalty, but the multiple attack penalty doesn't increase until after the test linnorm makes all of these attacks.</p>"), { builtin: "multi-strike", actions: 1, strikes: ["jaws"], each: true, max: 2, strides: 1, sameMap: true });
    assert.deepEqual(compile("<p>The test sphinx rears back on their hind legs and makes two claw Strikes at the same target, using the same attack bonus as their highest melee attack. If both attacks deal damage, the target takes extra damage equal to one claw Strike.</p>", 3),
        { builtin: "multi-strike", actions: 3, strikes: ["claw", "claw"], sameTarget: true, noMap: true, bothHit: { conditions: [], damage: [], strikeDamage: "claw" } });
});

test("more multi-Strike wordings; a Stride and a Strike either way; a charge that only moves (2026-10-11, batch 90)", () => {
    const compile = (description, actions = 2) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: description } } }, { basicActions: {} });
    assert.deepEqual(compile("<p>The test baomal makes a Strike with each set of jaws, each against a different creature. These Strikes count as one attack for the test baomal's multiple attack penalty, and the penalty doesn't increase until after both attacks.</p>"), { builtin: "multi-strike", actions: 2, strikes: ["jaws", "jaws"], sameMap: true, each: true, max: 2, countsAs: 1 });
    assert.deepEqual(compile("<p>The test centurion spins in place. It makes up to five melee blade Strikes. No single creature can be targeted by more than one blade Strike during one use of this ability. These attacks count toward the test centurion's multiple attack penalty, but the multiple attack penalty doesn't increase until after all the attacks are made.</p>", 3), { builtin: "multi-strike", actions: 3, strikes: ["blade", "blade", "blade", "blade", "blade"], sameMap: true, each: true, max: 5 });
    assert.deepEqual(compile("<p>The test minotaur makes two Strikes with their greataxe against two adjacent enemies, both of whom are within their reach. The second attack uses the same multiple attack penalty as the first, but attacks they make after this take a –10 multiple attack penalty.</p>"), { builtin: "multi-strike", actions: 2, strikes: ["greataxe", "greataxe"], sameMap: true, each: true, max: 2, countsAs: 2 });
    assert.deepEqual(compile("<p>The test deep one makes two claw Strikes and one jaws Strike in any order. If the target creature is currently frightened by a deep one's Test Devotion ability, it's Off-Guard against these attacks. The test deep one becomes Clumsy 1 until the start of their next turn.</p>", 3), { builtin: "multi-strike", actions: 3, strikes: ["claw", "claw", "jaws"], after: [{ slug: "clumsy", value: 1, until: "own-turn-start" }] });
    assert.deepEqual(compile("<p><strong>Frequency</strong> once per round</p><hr /><p><strong>Effect</strong> The test zecui makes two shortsword Strikes against an Immobilized or Off-Guard target. These strikes count towards the test zecui's multiple attack penalty, but it doesn't increase until after the second attack.</p>", 1), { builtin: "multi-strike", actions: 1, strikes: ["shortsword", "shortsword"], sameMap: true, sameTarget: true, oncePerTurn: true, requires: "off-guard" });
    assert.deepEqual(compile("<p><strong>Requirements</strong> The test warleader is wielding two battle axes</p><hr /><p><strong>Effect</strong> The test warleader makes a battle axe Strike against each creature in their reach and the bonus from sweep applies to each attack. These attacks count against their multiple attack penalty, but the multiple attack penalty doesn't increase until after all the attacks.</p>", 3), { builtin: "multi-strike", actions: 3, strikes: ["battle axe"], each: true, sameMap: true });
    assert.deepEqual(compile("<p>The test raptor Strides up to 10 feet and then makes a Strike, or makes a Strike and then Strides up to 10 feet.</p>", 1), { builtin: "no-effect", strikeOnly: true });
    assert.deepEqual(compile("<p>The test bear Strides and makes a Strike at the end of that movement. During the Stride, the test bear ignores difficult terrain. If the test bear doesn't end their movement on solid ground, they fall as soon as the Strike is completed.</p>"), { builtin: "no-effect", strikeOnly: true });
});

test("Strikes with each head, with each weapon, at a longer reach, after a Stride; a Stride with more Speed (2026-10-11, batch 91)", () => {
    const compile = (description, actions = 2) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: description } } }, { basicActions: {} });
    assert.deepEqual(compile("<p>A test amphisbaena makes a fangs Strike with each of its heads, each against a different target. Both Strikes count toward its multiple attack penalty, but the penalty doesn't increase until after it has made both attacks.</p>", 1), { builtin: "multi-strike", actions: 1, strikes: ["fangs", "fangs"], sameMap: true, each: true, max: 2 });
    assert.deepEqual(compile("<p><strong>Requirements</strong> The test maftet is wielding two scimitars</p><hr /><p><strong>Effect</strong> The test maftet makes two Strikes against the same target, one with each of their scimitars. The test maftet combines the damage of any attacks that hit and applies resistances and weaknesses only once. This counts as one attack when calculating the test maftet's multiple attack penalty.</p>"), { builtin: "multi-strike", actions: 2, strikes: ["scimitar", "scimitar"], sameMap: true, sameTarget: true, countsAs: 1 });
    assert.deepEqual(compile("<p>The test hadrinnex makes two weapon arm Strikes, each targeting a different creature. The test hadrinnex's reach increases to 20 feet for these Strikes.</p>"), { builtin: "multi-strike", actions: 2, strikes: ["weapon arm", "weapon arm"], each: true, max: 2 });
    assert.deepEqual(compile("<p>The test aqudel makes up to four cirrus Strikes, each against a diferent target. These attacks count toward the test aqudel's multiple attack penalty, but the multiple attack penalty doesn't increase until after they makes all of their attacks.</p>")?.max, 4);
    assert.deepEqual(compile("<p>The test lion Strides and makes two claw Strikes against the same creature at the end of that movement. Each attack counts against the test lion's multiple attack penalty, but the penalty doesn't increase until after the test lion makes both attacks. If both attacks hit, combine their damage for the purpose of resistances and weaknesses.</p>"), { builtin: "multi-strike", actions: 2, strikes: ["claw", "claw"], sameTarget: true, strides: 1, sameMap: true });
    assert.deepEqual(compile("<p><strong>Requirements</strong> The test ghoul has nothing in their hands</p><hr /><p><strong>Effect</strong> The test ghoul Strides with a +10-foot circumstance bonus to their Speed.</p>", 1), { builtin: "no-effect" });
});

test("Strikes along a swim, a vine at each of six, more moves, a Demoralize with Performance (2026-10-11, batch 92)", () => {
    const compile = (description, actions = 2, basicActions = {}) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: description } } }, { basicActions });
    assert.deepEqual(compile("<p>The test mosasaur Swims up to its Speed. It can make one jaws Strike and one tail Strike at any points during its movement, each attacking a different target.</p>"), { builtin: "multi-strike", actions: 2, strikes: ["jaws", "tail"], each: true, max: 2, strides: 1 });
    assert.deepEqual(compile("<p>The test green man lashes out with all six vines. They make up to six vine Strikes, each against a different target; this counts as one attack for their multiple attack penalty, increasing only after all the attacks are made.</p>")?.countsAs, 1);
    for (const move of ["The test student Steps and Strides in any order.", "The test thief Leaps up to 10 feet vertically or 30 feet horizontally.", "The test tikbalang jumps up to their Speed horizontally, or half that vertically."]) assert.deepEqual(compile(`<p>${move}</p>`, 1), { builtin: "no-effect" }, move);
    const demoralize = { modelVersion: 13, source: { name: "Demoralize", slug: "demoralize", uuid: null, type: "action" }, rank: 1, traits: ["mental"], activation: { time: "1", traits: ["mental"] }, targeting: { target: "1 creature", range: "30 feet", area: null }, trigger: { event: "use", immunity: null },
        resolution: { kind: "check", check: { roll: "skill", statistic: "intimidation", against: { dc: "target", statistic: "will" } }, sharedDamage: null, outcomes: {} } };
    assert.equal(compile("<p>The test courtesan levies insults, attempting to [[/act demoralize skill=performance]] a creature using their Performance modifier instead of Intimidation.</p>", 1, { demoralize })?.resolution?.check?.statistic, "performance");
});

test("a charge in fewer actions than its moves, its frequency kept; allies only moving closer (2026-10-11, batch 93)", () => {
    const compile = (description, actions = 1) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: description } } }, { basicActions: {} });
    assert.deepEqual(compile("<p><strong>Frequency</strong> once per turn</p><hr /><p><strong>Effect</strong> The test knight Strides twice. If they end their movement within melee reach of at least one enemy, the test knight can make a melee Strike against that enemy.</p>"), { builtin: "charge", actions: 1, strides: 2, strike: null, oncePerTurn: true });
    assert.deepEqual(compile("<p><strong>Frequency</strong> once per round</p><hr /><p><strong>Effect</strong> The test chief bellows a summons. Each ally within 30 feet that hears it can immediately Step or Stride; the move must bring them closer to the test chief.</p>"), { builtin: "no-effect" });
});

test("a Strike at a creature one of its allies just hit (2026-10-11, batch 94)", () => {
    const reaction = (trigger, effect) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: `<p><strong>Trigger</strong> ${trigger}</p><hr /><p><strong>Effect</strong> ${effect}</p>` } } }, { basicActions: {} });
    const answer = { builtin: "reaction-strike", triggers: ["ally-hit"], strike: null, penalty: 0, disrupts: false };
    assert.deepEqual(reaction("A creature within Test Vela's reach is hit by a melee Strike from one of her allies", "Test Vela makes a Strike against the triggering creature."), answer);
    assert.deepEqual(reaction("A creature within melee reach is hit by a melee attack from one of the test ambusher's allies", "The test ambusher attempts a Strike against the triggering creature."), answer);
    assert.deepEqual(reaction("A creature within Test Ola's melee reach is hit by a melee attack from one of her allies", "Test Ola Strikes the triggering creature."), answer);
});

test("a flavour clause after the target; a range increment; the creature's save on a success (2026-10-11, batch 95)", () => {
    const compile = (description, actions = 2) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: description } } }, { basicActions: {} });
    const shout = compile("<p>The test rider attempts a weapon Strike against a target, shouting boasts and insults. If it hits, the target must succeed at a @Check[will|dc:25] save or be @UUID[Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL]{Frightened 2} (Frightened 3 on a critical failure).</p>");
    assert.deepEqual([shout?.builtin, shout?.onHit?.save?.resolution?.outcomes?.failure?.effects?.[0]?.slug], ["strike-activity", "frightened"]);
    const shot = compile("<p>The test sniper makes an arquebus Strike against a creature within the weapon's first range increment. On a success, the creature must succeed at a @Check[fortitude|dc:20] save or be @UUID[Compendium.pf2e.conditionitems.Item.dfCMdR4wnpbYNTix]{Stunned 1} (Stunned 2 on a critical failure).</p>");
    assert.deepEqual([shot?.strike, shot?.onHit?.save?.resolution?.outcomes?.criticalFailure?.effects?.[0]?.value], ["arquebus", 2]);
});

test("a trap's slab that drops: its damage and the Reflex save that avoids it (2026-10-11, batch 95)", () => {
    const trap = (effect) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: `<p><strong>Trigger</strong> Pressure is placed on the test tile.</p><hr /><p><strong>Effect</strong> ${effect}</p>` } } }, { basicActions: {} });
    const slab = trap("The test door falls, closing off the passage. The slab deals @Damage[2d8[bludgeoning]] damage to anyone beneath or adjacent to it when it drops and pushes them out of its space in a random direction. A creature that succeeds at a @Check[reflex|dc:16] save takes no damage and rolls out of the way in a random direction. On a critical success, they can choose the direction.</p><p>Lifting the fallen slab requires a successful @Check[athletics|dc:20] check.");
    assert.deepEqual([slab?.resolution?.check?.against?.value, slab?.resolution?.outcomes?.success?.damage?.mode, slab?.resolution?.outcomes?.failure?.damage?.multiplier, slab?.resolution?.sharedDamage?.components?.[0]?.formula], [16, "none", 1, "2d8[bludgeoning]"]);
    const wall = trap("The test wall collapses, dealing @Damage[2d6[bludgeoning]] damage to creatures within 10 feet of it. A creature that succeeds at a @Check[reflex|dc:15] save takes half damage and rolls out of the way. On a critical success, they take no damage and can choose the direction.");
    assert.equal(wall?.resolution?.outcomes?.success?.damage?.multiplier, 0.5);
    // Not with a condition or a curse.
    assert.equal(trap("The test gate falls. Any creature under it takes @Damage[2d10[piercing]] damage and is Immobilized. A creature that succeeds at a @Check[reflex|dc:15] save takes no damage."), null);
});

test("a save succeeded on, or made successfully (2026-10-11, batch 96)", () => {
    const compile = (description) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: 2 }, traits: { value: [] }, description: { value: description } } }, { basicActions: {} });
    const gas = compile("<p>Gas fills the test chamber. Creatures within the chamber must succeed on a @Check[fortitude|dc:25] save or become @UUID[Compendium.pf2e.conditionitems.Item.e1XGnhKNSQIm5IXg]{Stupefied 1} (Stupefied 2 on a critical failure).</p>");
    assert.deepEqual([gas?.resolution?.outcomes?.failure?.effects?.[0]?.slug, gas?.resolution?.outcomes?.criticalFailure?.effects?.[0]?.value], ["stupefied", 2]);
    const fear = compile("<p>Test figures appear. All living creatures in the test hall must make a successful @Check[will|dc:20] save or become @UUID[Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL]{Frightened 1} (Frightened 3 on a critical failure).</p>");
    assert.deepEqual([fear?.resolution?.outcomes?.failure?.effects?.[0]?.value, fear?.resolution?.outcomes?.criticalFailure?.effects?.[0]?.value], [1, 3]);
});

test("the creature that dealt the triggering Strike saves; a Strike that deals damage (2026-10-11, batch 97)", () => {
    const compile = (type, actions, description) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: actions }, traits: { value: [] }, description: { value: description } } }, { basicActions: {} });
    const growl = compile("reaction", null, "<p><strong>Trigger</strong> The test cat is critically hit by a Strike</p><hr /><p><strong>Effect</strong> The creature that dealt the triggering Strike must succeed at a @Check[will|dc:30] save or become Frightened 1 (Frightened 2 on a critical failure).</p>");
    assert.deepEqual([growl?.resolution?.outcomes?.failure?.effects?.[0]?.slug, growl?.resolution?.outcomes?.criticalFailure?.effects?.[0]?.value], ["frightened", 2]);
    const shot = compile("action", 2, "<p>The test guard makes a ranged Strike. If the Strike deals damage, the target must succeed at a @Check[reflex|dc:20|options:inflicts:prone] saving throw or fall Prone.</p>");
    assert.deepEqual([shot?.builtin, shot?.strike, shot?.onHit?.save?.resolution?.outcomes?.failure?.effects?.[0]?.slug], ["strike-activity", "ranged", "prone"]);
});

test("a reaction that moves it off as a creature comes beside it or attacks it (2026-10-11, batch 98)", () => {
    const reaction = (description) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: description } } }, { basicActions: {} });
    const both = (trigger, effect) => reaction(`<p><strong>Trigger</strong> ${trigger}</p><hr /><p><strong>Effect</strong> ${effect}</p>`);
    assert.deepEqual(both("A creature misses the test beetle with a melee Strike", "The test beetle Steps."), { builtin: "withdraw", on: "missed", melee: true, move: "Step", safe: true });
    assert.deepEqual(both("The test hermit takes damage from a Strike", "The test hermit Steps away from the source of the Strike."), { builtin: "withdraw", on: "damaged", move: "Step", safe: true });
    assert.deepEqual(both("The test vole is hit with a melee attack", "The test vole takes a step after the effects of the triggering attack are resolved."), { builtin: "withdraw", on: "hit", melee: true, move: "Step", safe: true });
    assert.deepEqual(both("A creature enters the test sprite's space or an adjacent square", "The test sprite Flies 10 feet away from the triggering creature."), { builtin: "withdraw", on: "approach", enters: true, move: "Fly", feet: 10, safe: false });
    assert.deepEqual(both("A creature ends its movement adjacent to the test eel or within the test eel's space.", "The test eel Strides or Swims up to 10 feet (or up to the relevant Speed, if that Speed is less than 10 feet). It must end its movement in a location that isn't within 5 feet of a foe. This movement doesn't trigger reactions."), { builtin: "withdraw", on: "approach", move: "Stride", feet: 10, safe: true });
    assert.deepEqual(both("A dazzled or blinded creature, or a creature with light blindness, ends its move adjacent to Test Ulo", "Test Ulo Steps."), { builtin: "withdraw", on: "approach", foe: ["dazzled", "blinded"], move: "Step", safe: true });
    assert.deepEqual(reaction("<p>If a creature ends its movement adjacent to the test asp, the test asp can use its reaction to Stride or Climb up to 10 feet. This movement doesn't trigger reactions.</p>"), { builtin: "withdraw", on: "approach", move: "Stride", feet: 10, safe: true });
    // Not one that drops what it holds first, or does more.
    assert.notEqual(both("The test rodent takes damage from a melee Strike", "The test rodent drops any items held in its hands, then Climbs or Strides up to 15 feet.")?.builtin, "withdraw");
    assert.notEqual(both("A creature misses the test frog with a melee Strike", "The test frog Steps. It gains a +2 circumstance bonus to AC until the end of its next turn.")?.builtin, "withdraw");
});

test("a reaction that follows a foe moving away and keeps it in reach (2026-10-11, batch 99)", () => {
    const both = (trigger, effect) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: `<p><strong>Trigger</strong> ${trigger}</p><hr /><p><strong>Effect</strong> ${effect}</p>` } } }, { basicActions: {} });
    assert.deepEqual(both("An enemy within reach of the test warden attempts to move away", "The test warden Strides up to their Speed, following the enemy and keeping the enemy in reach throughout its movement until the enemy stops moving or the test warden moves their full Speed."), { builtin: "follow", move: "Stride" });
    assert.deepEqual(both("A foe within Test Ama's reach attempts to move away from her", "Test Ama keeps pace with the triggering foe. Test Ama Strides up to her Speed, following that foe and keeping it in reach throughout its movement until it stops moving or Test Ama has moved their full Speed."), { builtin: "follow", move: "Stride" });
    assert.deepEqual(both("An adjacent foe moves away.", "Test Oru can Stride up to his speed, following the triggering creature and keeping it in reach throughout its movement until it stops moving or Test Oru has moved his full Speed."), { builtin: "follow", move: "Stride" });
    assert.deepEqual(both("The test stalker's hunted prey is within their reach and attempts to move away from them", "The test stalker Climbs or Strides up to their Speed, following their hunted prey and keeping it in reach throughout its movement until it stops moving or the test stalker has moved their full Speed."), { builtin: "follow", move: "Stride", prey: true });
    assert.deepEqual(both("A foe within reach attempts to move away from the test lynx", "The test lynx Strides up to its Speed, following the foe and keeping it in reach. If the test lynx ends its move within reach of the foe, it can Strike it."), { builtin: "follow", move: "Stride", strike: true });
});

test("a critical hit on it recharges its breath, used at once; its hit made a critical one (2026-10-11, batch 100)", () => {
    const compile = (type, description) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: null }, traits: { value: [] }, description: { value: description } } }, { basicActions: {} });
    const both = (type, trigger, effect, frequency = "") => compile(type, `${frequency}<p><strong>Trigger</strong> ${trigger}</p><hr /><p><strong>Effect</strong> ${effect}</p>`);
    assert.deepEqual(both("reaction", "The test hound is critically hit by any Strike", "The test hound's Smoke Breath recharges. They can immediately use it as part of this reaction."), { builtin: "crit-recharge", recharges: "Smoke Breath" });
    assert.deepEqual(both("reaction", "A creature scores a critical hit on the test wyrm", "The test wyrm's Breath Weapon recharges. It can use its Breath Weapon immediately as part of this reaction. It can't use this reaction again until it recharges its Breath Weapon naturally."), { builtin: "crit-recharge", recharges: "Breath Weapon", untilNatural: true });
    assert.deepEqual(both("free", "The test giant succeeds at an attack roll.", "The attack becomes a critical success.", "<p><strong>Frequency</strong> once per day, and recharges when the test giant uses Ferocity.</p>"), { builtin: "crit-upgrade", perDay: 1, ferocityRecharges: true, free: true });
});

test("ways from one of its heads; the recharge sentence before the list; a way that starts with its area (2026-10-11, batch 101)", () => {
    const plan = compileMonsterAbility({ type: "action", name: "Test Blast", system: { slug: null, actionType: { value: "action" }, actions: { value: 2 }, traits: { value: [] }, description: { value: "<p>The test hydra breathes a blast of energy from one of its two heads; each creature in the area must attempt a @Check[reflex|dc:30|basic|options:area-effect] save.</p><p>The test hydra can't Test Blast again for [[/gmr 1d4 #Recharge Test Blast]]{1d4 rounds}.</p><ul><li><strong>Cold Head</strong> (cold) 10-foot-wide, @Template[line|distance:60|width:10] of cold dealing @Damage[10d6[cold]|options:area-damage] damage.</li><li><strong>Fire Head</strong> (fire) @Template[cone|distance:30] of fire dealing @Damage[10d6[fire]|options:area-damage] damage.</li></ul>" } } }, { basicActions: {} });
    assert.equal(plan?.builtin, "modes");
    assert.deepEqual(plan.modes.map((mode) => [mode.name, mode.plan?.targeting?.area?.type, mode.plan?.trigger?.recharge?.formula, mode.plan?.resolution?.sharedDamage?.components?.[0]?.formula]), [["Cold Head", "line", "1d4", "10d6[cold]"], ["Fire Head", "cone", "1d4", "10d6[fire]"]]);
});

test("that many Strikes, each at a different creature; every creature but those it holds; a sweep behind a requirement (2026-10-11, batch 102)", () => {
    const compile = (description) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: 2 }, traits: { value: [] }, description: { value: description } } }, { basicActions: {} });
    assert.deepEqual(compile("<p>The test wyrm makes up to four tail Strikes, each against a different target. These attacks count toward the test wyrm's multiple attack penalty, but the penalty doesn't increase until after all the attacks.</p>"), { builtin: "multi-strike", actions: 2, strikes: ["tail", "tail", "tail", "tail"], sameMap: true, each: true, max: 4 });
    // (And behind a requirement, "holding six spirit blades".)
    assert.deepEqual(compile("<p><strong>Requirements</strong> The test asura is holding six spirit blades</p><hr /><p><strong>Effect</strong> The test asura makes up to six spirit blade Strikes, each against a different target. These attacks count toward the test asura's multiple attack penalty, but the multiple attack penalty doesn't increase until after all the attacks.</p>"), { builtin: "multi-strike", actions: 2, strikes: ["spirit blade"], each: true, max: 6, sameMap: true, requires: "requirement" });
    assert.deepEqual(compile("<p>The test ooze makes a single tendril Strike against each target within range it hasn't already Grabbed. These attacks count toward the test ooze's multiple attack penalty, but the penalty doesn't increase until after all of these attacks.</p>"), { builtin: "multi-strike", actions: 2, strikes: ["tendril"], each: true, sameMap: true, notGrabbed: true });
    assert.deepEqual(compile("<p><strong>Requirements</strong> The test statue is uncontrollable</p><hr /><p><strong>Effect</strong> The test statue makes a melee Strike against every creature in its reach, whether that creature is an ally or not. The attacks count toward its multiple attack penalty normally, but the penalty does not increase until after all the Strikes are complete.</p>"), { builtin: "multi-strike", actions: 2, strikes: [null], each: true, sameMap: true, requires: "requirement" });
    // (Allies too only behind such a requirement.)
    assert.equal(compile("<p>The test brute makes a melee Strike against every creature in its reach, whether that creature is an ally or not.</p>")?.builtin, undefined);
});

test("reaction Strikes: extra dice on a hit, a Step to an ally's attacker, a ranged Strike at a far attacker (2026-10-11, batch 103)", () => {
    const reaction = (trigger, effect) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: `<p><strong>Trigger</strong> ${trigger}</p><hr /><p><strong>Effect</strong> ${effect}</p>` } } }, { basicActions: {} });
    assert.deepEqual(reaction("A creature within reach of the test wyvern's tail successfully damages the test wyvern with a Strike", "The test wyvern attempts to Strike with its tail. If the Strike hits, it deals an additional 1d8 damage."), { builtin: "reaction-strike", triggers: ["damaged-adjacent"], strike: "tail", penalty: 0, disrupts: false, extraDamage: "1d8" });
    assert.deepEqual(reaction("A creature within 10 feet damages the test boar's ally with a melee attack", "The test boar immediately Steps toward the triggering attacker and makes a tusk Strike."), { builtin: "reaction-strike", triggers: ["ally-damaged"], strike: "tusk", penalty: 0, disrupts: false, within: 10, step: true });
    assert.deepEqual(reaction("The test raider takes damage from a creature 30 feet or further away", "The test raider makes a ranged javelin Strike against the triggering creature."), { builtin: "reaction-strike", triggers: ["damaged-far"], strike: "javelin", penalty: 0, disrupts: false, from: 30, ranged: true });
});

test("reaction Strikes at a charge's attacker, a shooter first, a caster near it; a Demoralize at a melee attacker (2026-10-11, batch 104)", () => {
    const reaction = (body) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: body } } }, { basicActions: {} });
    const both = (trigger, effect, requirements = "") => reaction(`<p><strong>Trigger</strong> ${trigger}</p>${requirements ? `<p><strong>Requirements</strong> ${requirements}</p>` : ""}<hr /><p><strong>Effect</strong> ${effect}</p>`);
    assert.deepEqual(both("A creature attacks the subject of test guard's defense", "The test guard makes a Strike against the triggering creature."), { builtin: "reaction-strike", triggers: ["ally-attacked"], strike: null, penalty: 0, disrupts: false, ward: true });
    assert.deepEqual(both("An attacker the test gunner can see targets them with a Strike or spell", "The test gunner makes a firearm Strike against the triggering creature. On a critical hit, they disrupt the triggering action.", "The test gunner is holding a loaded firearm"), { builtin: "reaction-strike", triggers: ["targeted"], strike: "firearm", penalty: 0, disrupts: "critical" });
    assert.deepEqual(both("A creature within 10 feet of the test hunter Casts a Spell", "The test hunter makes a melee Strike or thrown dagger Strike against the triggering creature. If it hits, the spell is disrupted."), { builtin: "reaction-strike", triggers: ["cast"], strike: null, penalty: 0, disrupts: true });
    assert.deepEqual(both("The test schemer is targeted by a melee Strike or touch spell", "With a cold stare, the test schemer [[/act demoralize]]{Demoralizes} the creature that targeted them. If the Intimidation check critically succeeds, the test schemer disrupts the triggering action."), { builtin: "reaction-strike", triggers: ["attacked"], strike: null, skill: "demoralize", penalty: 0, disrupts: false, melee: true });
});

test("more reaction Strikes and maneuvers in their own words (2026-10-11, batch 105)", () => {
    const reaction = (body) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: body } } }, { basicActions: {} });
    const both = (trigger, effect) => reaction(`<p><strong>Trigger</strong> ${trigger}</p><hr /><p><strong>Effect</strong> ${effect}</p>`);
    assert.deepEqual(both("The test bat is Flying, and a creature moves into an adjacent square below it.", "The test bat makes a talon Strike against the triggering creature."), { builtin: "reaction-strike", triggers: ["approach"], strike: "talon", penalty: 0, disrupts: false, while: "flying" });
    assert.deepEqual(reaction("<p>If the test bat is flying and a creature moves into an adjacent square below them, the test bat can use their reaction to make a talon Strike against that creature.</p>"), { builtin: "reaction-strike", triggers: ["approach"], strike: "talon", penalty: 0, disrupts: false, while: "flying" });
    assert.deepEqual(both("A creature hits or touches the test vine.", "The test vine makes a tendril Strike against the triggering creature. If it hits, the creature is Grabbed in that tendril."), { builtin: "reaction-strike", triggers: ["hit"], strike: "tendril", penalty: 0, disrupts: false, grab: true });
    assert.deepEqual(both("A creature leaves a square within the test squid's reach using a move action or attempts a melee Strike against the test squid", "The test squid lashes out with an arm, attempting to Grapple the triggering creature."), { builtin: "reaction-strike", triggers: ["leave", "attacked"], strike: null, skill: "grapple", penalty: 0, disrupts: false, melee: true });
    assert.deepEqual(both("A creature attempts to move away from the test knight", "The test knight's gauntlets animate and attempt to Grab the triggering creature. They make an Athletics check to Grapple using the test knight's Athletics modifier – 2."), { builtin: "reaction-strike", triggers: ["leave"], strike: null, skill: "grapple", penalty: 2, disrupts: false });
    assert.deepEqual(both("A creature within reach of the test hag's hair uses an action to Strike or attempt a skill check", "The test hag makes a hair Strike against the triggering creature. If the strike is a critical hit, the triggering action is disrupted."), { builtin: "reaction-strike", triggers: ["strike", "skill"], strike: "hair", penalty: 0, disrupts: "critical" });
    assert.deepEqual(both("The test ooze takes damage from any source", "The test ooze makes a tendril Strike against an adjacent target. If an adjacent creature dealt the triggering damage, that creature is the target of this reaction."), { builtin: "reaction-strike", triggers: ["damaged-by"], strike: "tendril", penalty: 0, disrupts: false });
    assert.deepEqual(both("The test brute reduces a creature to 0 Hit Points with a glaive Strike", "The test brute makes another glaive Strike against a different creature, using the same multiple attack penalty as the glaive Strike that triggered this reaction. This counts toward its multiple attack penalty."), { builtin: "reaction-strike", triggers: ["downs"], strike: "glaive", penalty: 0, disrupts: false, sameMap: true });
});

test("a guard that takes its ward's damage; an ally kept from dropping (2026-10-11, batch 106)", () => {
    const reaction = (body, frequency = "") => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: `${frequency}${body}` } } }, { basicActions: {} });
    const both = (trigger, effect, frequency = "") => reaction(`<p><strong>Trigger</strong> ${trigger}</p><hr /><p><strong>Effect</strong> ${effect}</p>`, frequency);
    assert.deepEqual(both("The test lackey's boss takes damage from an attack, and the test lackey is adjacent to them", "The test lackey takes the damage instead, along with any secondary effects of attack. This damage can't be reduced in any way."), { builtin: "intercept", ward: "boss", share: 1, unreduced: true });
    assert.deepEqual(both("The test servant's master would take damage from a Strike or spell attack and is in an adjacent square", "The test servant leaps in front of their master, taking half the damage of the attack (before applying any weaknesses or resistances). The test servant's master takes the remaining damage, applying any weaknesses or resistances as normal."), { builtin: "intercept", ward: "master", share: 0.5, attacks: true });
    assert.deepEqual(both("An ally within 15 feet of the test sentry would take damage", "The test sentry Strides. This movement does not trigger reactions, and the test sentry must end the Stride in a space adjacent to the ally. The test sentry then switches places with the ally, taking all damage and associated effects instead of the ally."), { builtin: "intercept", ward: "ally", share: 1, within: 15, swap: true });
    assert.deepEqual(both("An allied creature within 30 feet would be reduced to 0 Hit Points", "The test captain barks an order. The creature avoids being knocked out and remains at 1 HP. The creature is then temporarily immune for 24 hours."), { builtin: "rescue", within: 30, hp: 1, oncePerTarget: true });
    assert.deepEqual(both("An allied creature within 60 feet who isn't a construct or undead is reduced to 0 Hit Points and their dying value is 2 or less", "The test angel restores @Damage[4d10[healing]] Hit Points to the target.", "<p><strong>Frequency</strong> once per day</p>"), { builtin: "rescue", within: 60, heal: "4d10", living: true, perDay: 1 });
});

test("an ally's save helped: a reroll keeping the better, a bonus as it comes (2026-10-11, batch 107)", () => {
    const reaction = (body) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: body } } }, { basicActions: {} });
    const both = (trigger, effect, frequency = "") => reaction(`${frequency}<p><strong>Trigger</strong> ${trigger}</p><hr /><p><strong>Effect</strong> ${effect}</p>`);
    assert.deepEqual(both("An ally within 30 feet fails a saving throw against an emotion or mental effect", "The ally rerolls the saving throw, taking the better of the two results."), { builtin: "save-reroll", ally: true, within: 30, against: ["emotion", "mental"] });
    assert.deepEqual(both("An ally within 10 feet of the test jester rolls a saving throw against a mental or illusion effect", "The target ally can roll the save twice and take the better result."), { builtin: "save-reroll", ally: true, within: 10, against: ["mental", "illusion"] });
    assert.deepEqual(both("The test scout or an ally within 10 feet fails a Fortitude save, Athletics check, or Survival check", "The triggering creature rerolls the save or check and uses the better result.", "<p><strong>Frequency</strong> once per hour</p>"), { builtin: "save-reroll", ally: true, self: true, within: 10, save: "fortitude", uses: 1 });
    assert.deepEqual(both("An allied animal within 20 feet attempts a saving throw", "The test handler whistles, granting the allied animal a +1 circumstance bonus to the save."), { builtin: "save-bonus-reaction", ally: true, within: 20, value: 1, kind: "circumstance", animal: true });
    assert.deepEqual(both("An ally of the test guardian's attempts a saving throw against an effect that has the fear trait", "The ally gains a +2 status bonus to the saving throw. If the ally rolls a success, they get a critical success instead."), { builtin: "save-bonus-reaction", ally: true, value: 2, kind: "status", against: "fear", upgrade: true });
});

test("Strike activities: a ranged Strike that gains deadly, a flavour clause, more damage of the Strike's type, two attacks; a swim and Strike (2026-10-11, batch 108)", () => {
    const compile = (description) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: 2 }, traits: { value: [] }, description: { value: description } } }, { basicActions: {} });
    const shot = compile("<p>The test sculptor chips a sharp shard from the wall and makes a shard ranged Strike that gains the deadly d8 trait. On a successful hit, the target also falls Prone.</p>");
    assert.deepEqual([shot?.strike, shot?.deadly, shot?.onHit?.conditions?.[0]?.slug], ["shard", 8, "prone"]);
    const pry = compile("<p>The test mason attempts a chisel Strike while hammering the blow deeper with a mallet. If it hits, the target takes an additional 2d10 damage of the same type as the Strike and is Enfeebled 1 for 1 hour or until the creature is fully healed. This counts as two attacks for the test mason's multiple attack penalty.</p>");
    assert.deepEqual([pry?.strike, pry?.onHit?.damage, pry?.onHit?.conditions?.[0]?.value, pry?.countsAs], ["chisel", ["2d10[strike]"], 1, 2]);
    assert.deepEqual(compile("<p>The test sea elf swims and attacks in one of two patterns. They either Swim twice and Strike at the end of their movement, or Swim once and Strike at any point during their movement.</p>"), { builtin: "charge", actions: 2, strides: 2, strike: null });
});

test("a requirement the module doesn't play; the first round; a Strike at an animal or humanoid; damage told as a wound; Strikes at the creature it holds (2026-10-12, batch 109)", () => {
    const compile = (description, actions = 2) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: description } } }, { basicActions: {} });
    const burrowed = compile("<p><strong>Requirements</strong> The test wurm is burrowed</p><hr /><p><strong>Effect</strong> The test wurm makes a jaws Strike. If it hits, the target is Grabbed.</p>");
    assert.deepEqual([burrowed?.builtin, burrowed?.requires], ["strike-activity", "requirement"]);
    const first = compile("<p><strong>Requirements</strong> It's the first round of combat</p><hr /><p><strong>Effect</strong> The test stag Strides twice and makes a hoof Strike at the end of either Stride. If the Strike hits, the test stag deals an additional 1d4 piercing damage.</p>");
    assert.equal(first?.requires, "first-round");
    const flay = compile("<p>The test stitcher makes a blade Strike against an animal or humanoid. On a success, the test stitcher cuts deep; if the test stitcher dealt damage, it deals an additional 1d6 persistent bleed damage.</p>");
    assert.deepEqual([flay?.strike, flay?.targetTraits, flay?.onHit?.damage], ["blade", ["animal", "humanoid"], ["1d6[persistent,bleed]"]]);
    const hook = compile("<p>The test giant makes a melee Strike with its harpoon. If it hits, it twists and wrenches the harpoon to tear the wound, dealing 2d6 persistent bleed damage to the creature.</p>");
    assert.deepEqual([hook?.strike, hook?.onHit?.damage], ["harpoon", ["2d6[persistent,bleed]"]]);
    assert.deepEqual(compile("<p><strong>Requirements</strong> A creature is grabbed in the test demon's claw.</p><hr /><p><strong>Effect</strong> The test demon pulls the grabbed creature up to 5 feet closer, then makes two horn Strikes against it.</p>", 1), { builtin: "multi-strike", actions: 1, strikes: ["horn", "horn"], sameTarget: true, requires: "grabbed" });
});

test("a Grab on a hit with its free hand; Prone and a bleed told as a wound (2026-10-12, batch 110)", () => {
    const compile = (description, actions = 1) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: description } } }, { basicActions: {} });
    const grab = compile("<p><strong>Requirements</strong> The test bouncer has one hand free</p><hr /><p><strong>Effect</strong> The test bouncer makes a melee Strike while keeping one hand free. If this Strike hits, the test bouncer grabs the target using their free hand. The creature remains Grabbed until the end of the test bouncer's next turn or until it Escapes, whichever comes first.</p>");
    assert.deepEqual([grab?.builtin, grab?.requires, grab?.onHit?.conditions?.[0]?.slug], ["strike-activity", "free-hand", "grabbed"]);
    const hook = compile("<p>The test ogre makes a melee Strike with its hook. If it hits, it twists and drags the hook to knock the target Prone and tear the flesh, dealing @Damage[1d6[persistent,bleed]] damage to the creature.</p>", 2);
    assert.deepEqual([hook?.strike, hook?.onHit?.conditions?.[0]?.slug, hook?.onHit?.damage], ["hook", "prone", ["1d6[persistent,bleed]"]]);
});

test("Strike activities' openings: at the creature it holds, at an adjacent creature or a target within reach, more of its own dice, more damage on a hit (2026-10-12, batch 111)", () => {
    const compile = (description) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: 2 }, traits: { value: [] }, description: { value: description } } }, { basicActions: {} });
    const club = compile("<p>The test brute makes a club Strike that deals two additional weapon dice of damage.</p>");
    assert.deepEqual([club?.strike, club?.extraWeaponDice], ["club", 2]);
    const wing = compile("<p>The test roc makes a wing Strike against a target within reach. On a critical hit, the target is Blinded until the end of its next turn.</p>");
    assert.deepEqual([wing?.strike, wing?.onHit?.critical?.[0]?.slug], ["wing", "blinded"]);
    const held = compile("<p>The test hound makes a jaws Strike against the grabbed creature. If it hits, the target is Frightened 1.</p>");
    assert.deepEqual([held?.requires, held?.onHit?.conditions?.[0]?.slug], ["grabbed", "frightened"]);
    const shot = compile("<p>The test archer makes a ranged Strike and deals an additional @Damage[2d6[piercing]] damage on a hit.</p>");
    assert.deepEqual(shot?.onHit?.damage, ["2d6[piercing]"]);
});

test("Strike activities: a bonus to the attack roll or a status bonus to damage, a Step first, a push told of the creature, what the GM keeps (2026-10-12, batch 112)", () => {
    const compile = (description, actions = 2) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: description } } }, { basicActions: {} });
    const aim = compile("<p>The test lookout aims carefully. They make a ranged weapon Strike with a +2 circumstance bonus. The Strike ignores the Concealed condition, lesser cover, and standard cover, and reduces greater cover to standard cover.</p>");
    assert.deepEqual([aim?.strike, aim?.attackBonus, aim?.notes?.length], ["ranged", 2, 1]);
    const blast = compile("<p>The test warden makes a melee or ranged elemental blast Strike with a +3 status bonus to damage.</p>");
    assert.deepEqual([blast?.strike, blast?.damageBonus], ["elemental blast", 3]);
    const kick = compile("<p><strong>Requirements</strong> The test monk has both hands free</p><hr /><p><strong>Effect</strong> The test monk Steps, then makes a melee Strike at a –1 penalty.</p>", 1);
    assert.deepEqual([kick?.requires, kick?.attackBonus], ["free-hand", -1]);
    const swing = compile("<p>The test laborer makes a sledge Strike against a creature. If it hits, the creature is pushed 5 feet. If the target is wearing metal armor, its armor also takes the damage, which bypasses 5 of the armor's Hardness.</p>");
    assert.deepEqual([swing?.strike, swing?.onHit?.push, swing?.notes?.length], ["sledge", 5, 1]);
});

test("multi-Strikes: a Step between, more damage when both hit the same enemy, a melee and a ranged Strike, a state it must be in (2026-10-12, batch 113)", () => {
    const compile = (description, actions = 2) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: description } } }, { basicActions: {} });
    assert.deepEqual(compile("<p>The test raider Strikes, Steps, then Strikes again. If the test raider hits the same enemy with both Strikes, that enemy takes an additional @Damage[1d4[persistent,bleed]] damage.</p>"), { builtin: "multi-strike", actions: 2, strikes: [null, null], sameTarget: true, bothHit: { conditions: [], damage: ["1d4[persistent,bleed]"] } });
    assert.deepEqual(compile("<p>The test rogue can Step, attempt a melee knife Strike, and attempt a ranged knife Strike, taking the actions in any order. Both Strikes count toward the test rogue's multiple attack penalty, but it doesn't increase until after both attacks.</p>"), { builtin: "multi-strike", actions: 2, strikes: ["knife", "knife"], sameMap: true });
    assert.deepEqual(compile("<p><strong>Requirements</strong> The test brawler is raging</p><hr /><p><strong>Effect</strong> The test brawler attempts two fist Strikes, each against a different creature.</p>", 1), { builtin: "multi-strike", actions: 1, strikes: ["fist", "fist"], each: true, max: 2, requires: "raging" });
});

test("a poison gas breathed over an area: its own poison's stages there, the recharge (2026-10-12, batch 114)", () => {
    const poison = { type: "action", name: "Test Statue Poison", system: { slug: null, actionType: { value: "passive" }, actions: { value: null }, traits: { value: ["poison"] }, description: { value: "<p><strong>Saving Throw</strong> @Check[fortitude|dc:25]</p><hr /><p><strong>Maximum Duration</strong> 4 rounds</p><p><strong>Stage 1</strong> @Damage[1d6[poison]] damage (1 round)</p><p><strong>Stage 2</strong> @Damage[2d6[poison]] damage (1 round)</p>" } } };
    const breath = { type: "action", name: "Test Gas", system: { slug: null, actionType: { value: "action" }, actions: { value: 2 }, traits: { value: [] }, description: { value: "<p>The test statue exhales poisonous gas in a @Template[burst|distance:10]{10-foot radius} centered on the corner of one of the test statue's squares.</p><p>The gas persists for 1 round. Any creature in the area (or that later enters the area) is exposed to the test statue's poison.</p><p>The test statue can't use its Test Gas again for [[/gmr 1d4 #Recharge Test Gas]]{1d4 rounds}.</p>" } } };
    const actor = { name: "Test Statue", items: [breath, poison] };
    const plan = compileMonsterAbility(breath, { basicActions: {}, actor });
    assert.deepEqual([plan?.targeting?.area, plan?.trigger?.recharge?.formula, plan?.resolution?.check?.against?.value, plan?.resolution?.outcomes?.failure?.affliction?.stage], [{ type: "burst", value: 10 }, "1d4", 25, 1]);
});

test("its own affliction at one creature in a state, or over an emanation (2026-10-12, batch 115)", () => {
    const disease = { type: "action", name: "Test Grub Fever", system: { slug: null, actionType: { value: "passive" }, actions: { value: null }, traits: { value: ["disease"] }, description: { value: "<p><strong>Saving Throw</strong> @Check[fortitude|dc:20]</p><hr /><p><strong>Stage 1</strong> carrier with no ill effect (1 day)</p><p><strong>Stage 2</strong> @Damage[1d6[poison]] damage (1 day)</p>" } } };
    const eggs = { type: "action", name: "Test Eggs", system: { slug: null, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: [] }, description: { value: "<p>The test hornet lays eggs in an adjacent creature that is @UUID[Compendium.pf2e.conditionitems.Item.6uEgoh53GbXuHpTF]{Paralyzed} or @UUID[Compendium.pf2e.conditionitems.Item.fBnFDH2MTzgFijKf]{Unconscious}, exposing it to the test grub fever disease.</p>" } } };
    const wings = { type: "action", name: "Test Wings", system: { slug: null, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: [] }, description: { value: "<p><strong>Frequency</strong> once per round</p><hr /><p><strong>Effect</strong> The test shade spreads its wings. Each living creature within a @Template[type:emanation|distance:10] is exposed to test grub fever.</p>" } } };
    const actor = { name: "Test", items: [eggs, wings, disease] };
    const one = compileMonsterAbility(eggs, { basicActions: {}, actor });
    assert.deepEqual([one?.targeting?.target, one?.requiresFoe?.conditions, one?.resolution?.check?.against?.value], ["1 creature", ["paralyzed", "dying"], 20]);
    const all = compileMonsterAbility(wings, { basicActions: {}, actor });
    assert.deepEqual(all?.targeting?.area, { type: "emanation", value: 10 });
});

test("a reaction that exposes a creature to its own affliction (2026-10-12, batch 116)", () => {
    const venom = { type: "action", name: "Test Thorn Venom", system: { slug: null, actionType: { value: "passive" }, actions: { value: null }, traits: { value: ["poison"] }, description: { value: "<p><strong>Saving Throw</strong> @Check[fortitude|dc:18]</p><hr /><p><strong>Stage 1</strong> @Damage[1d6[poison]] damage and Sickened 1 (2 rounds)</p>" } } };
    const spill = { type: "action", name: "Test Spill", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: "<p><strong>Trigger</strong> The test bramble takes piercing or slashing damage</p><hr /><p><strong>Effect</strong> The test bramble sprays its sap onto an adjacent creature. That creature is exposed to test thorn venom.</p>" } } };
    const plan = compileMonsterAbility(spill, { basicActions: {}, actor: { name: "Test", items: [spill, venom] } });
    assert.deepEqual([plan?.trigger?.event, plan?.trigger?.damageTypes, plan?.targeting?.target, plan?.resolution?.check?.against?.value], ["damaged", ["piercing", "slashing"], "1 creature", 18]);
});

test("a thrown rock at a random enemy when hurt by its damage types; a flat check against that persistent damage (2026-10-12, batch 117)", () => {
    const plan = compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: "<p><strong>Trigger</strong> The test ogre takes cold or sonic damage</p><hr /><p><strong>Effect</strong> The test ogre uses Throw Boulder targeting a random enemy within its first range increment. If the test ogre has persistent cold damage, it attempts a @Check[flat|dc:15] to remove it.</p>" } } }, { basicActions: {} });
    assert.deepEqual(plan, { builtin: "reaction-strike", triggers: ["damaged-by"], damageTypes: ["cold", "sonic"], strike: "boulder", penalty: 0, disrupts: false, random: true, ranged: true, persistentType: "cold" });
});

test("a reaction that uses another of its abilities: that ability's results with this trigger (2026-10-12, batch 118)", () => {
    const roar = { type: "action", name: "Test Bellow", system: { slug: null, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: ["auditory"] }, description: { value: "<p>The test ogre bellows. Each enemy in a @Template[emanation|distance:30] must succeed at a @Check[will|dc:20] save or become Frightened 1 (Frightened 2 on a critical failure).</p>" } } };
    const fury = { type: "action", name: "Test Fury", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: "<p><strong>Trigger</strong> The test ogre takes cold or fire damage</p><hr /><p><strong>Effect</strong> The test ogre uses its Test Bellow and, if it's aware of the damage's source, can Stride toward it. If the test ogre has persistent fire damage, it attempts a @Check[flat|dc:15] to remove it.</p>" } } };
    const plan = compileMonsterAbility(fury, { basicActions: {}, actor: { name: "Test", items: [fury, roar] } });
    assert.deepEqual([plan?.source?.name, plan?.trigger?.event, plan?.trigger?.damageTypes, plan?.targeting?.area?.value, plan?.notes?.length], ["Test Fury", "damaged", ["cold", "fire"], 30, 2]);
});

test("an action that uses its breath twice: that breath's plan, this cost and recharge (2026-10-12, batch 119)", () => {
    const breath = { type: "action", name: "Test Spit", system: { slug: null, actionType: { value: "action" }, actions: { value: 2 }, traits: { value: ["acid"] }, description: { value: "<p>The test wyrm spits acid in a @Template[line|distance:60], dealing @Damage[6d6[acid]|options:area-damage] damage (@Check[reflex|dc:25|basic|options:area-effect] save). It can't use Test Spit again for [[/gmr 1d4 #Recharge Test Spit]]{1d4 rounds}.</p>" } } };
    const twice = { type: "action", name: "Test Double Spit", system: { slug: null, actionType: { value: "action" }, actions: { value: 3 }, traits: { value: [] }, description: { value: "<p>The test wyrm uses Test Spit twice. A creature attempts only one save and can take damage only once.</p><p>The test wyrm can't use Test Spit or Test Double Spit again for [[/br 2d4 #Recharge]]{2d4 rounds}.</p>" } } };
    const plan = compileMonsterAbility(twice, { basicActions: {}, actor: { name: "Test", items: [breath, twice] } });
    assert.deepEqual([plan?.source?.name, plan?.activation?.time, plan?.targeting?.area?.type, plan?.trigger?.recharge?.formula, plan?.notes?.length], ["Test Double Spit", "3", "line", "2d4", 2]);
});

test("an effect whose bonuses name checks or Strikes: what it gives isn't what it does (2026-10-12, batch 120)", () => {
    const compile = (description, type = "action") => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? 1 : null }, traits: { value: [] }, description: { value: description } } }, { basicActions: {} });
    const heroism = compile("<p><strong>Frequency</strong> once per round</p><hr /><p><strong>Effect</strong> The test sage inspires. An ally within 60 feet of the test sage gains a +2 status bonus to attack rolls, Perception checks, saving throws, and skill checks for 1 minute.</p><p>@UUID[Compendium.pf2e.bestiary-effects.Item.aaaaaaaaaaaaaaaa]{Effect: Test Heroism}</p>");
    assert.deepEqual([heroism?.resolution?.kind, heroism?.targeting?.range], ["effect", "60 feet"]);
    const chug = compile("<p><strong>Requirements</strong> The test brewer is holding a flagon</p><hr /><p><strong>Effect</strong> The test brewer drinks. For 1 minute, the test brewer gains a +2 item bonus to Athletics checks and damage rolls.</p><p>@UUID[Compendium.pf2e.bestiary-effects.Item.bbbbbbbbbbbbbbbb]{Effect: Test Chug}</p>");
    assert.equal(chug?.resolution?.applications?.[0]?.recipients, "self");
    // (Still not one that makes a check or a Strike.)
    assert.equal(compile("<p>The test bard makes a Performance check. Allies within 30 feet gain a +1 status bonus to attack rolls.</p><p>@UUID[Compendium.pf2e.bestiary-effects.Item.cccccccccccccccc]{Effect: Test Song}</p>"), null);
});

test("a special attack with a fixed modifier of its own: manacles, a thrown net, a check against a DC (2026-10-12, batch 121)", () => {
    const compile = (description, traits = []) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: traits }, description: { value: description } } }, { basicActions: {} });
    const capture = compile("<p><strong>Requirements</strong> The test warden holds manacles and is adjacent to a creature.</p><hr /><p><strong>Effect</strong> The test warden tries to bind the creature's wrists or ankles with the manacles. If the test warden succeeds at an attack roll with a @Check[test-capture|against:ac]{+12} modifier against the target's AC, it applies the manacles.</p>", ["attack"]);
    assert.deepEqual(capture?.resolution?.check, { roll: "skill", statistic: "test-capture", against: { dc: "target", statistic: "ac" }, modifier: 12 });
    assert.equal(capture.resolution.outcomes.success.nativeEffects[0].uuid, "Compendium.pf2e.equipment-effects.Item.OJg3cA6viR3sA3jB");
    assert.equal(capture.targeting.range, "touch");
    // (No result said at all: the manacles still.)
    const bare = compile("<p><strong>Effect</strong> The test warden tries to bind the creature's wrists or ankles with the manacles. It must succeed at an attack roll with a @Check[test-capture|against:ac]{+12} modifier against the target's AC.</p>");
    assert.equal(bare?.resolution?.outcomes?.criticalSuccess?.nativeEffects?.length, 1);
    const net = compile("<p><strong>Effect</strong> The test hunter makes a ranged Strike (with a @Check[test-net|against:ac]{+9} modifier) against a creature within 20 feet. On a hit, the target is @UUID[Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg]{Off-Guard} and takes a –10-foot circumstance penalty to its Speeds. On a critical hit, the creature is instead @UUID[Compendium.pf2e.conditionitems.Item.VcDeM8A5oI6VqhbM]{Restrained}. The DC to [[/act escape dc=15]] the net is 15.</p>");
    assert.deepEqual([net?.traits, net?.targeting?.range, net?.resolution?.outcomes?.success?.modifiers?.[0]?.selector, net?.resolution?.outcomes?.criticalSuccess?.effects?.map((effect) => effect.slug)], [["attack"], "20 feet", "all-speeds", ["restrained"]]);
    assert.deepEqual(net.notes, ["The DC to Escape the net is 15."]);
    const wrap = compile("<p>The test cloak makes an attack roll with a @Check[test-wrap|against:reflex]{+11} bonus against an adjacent creature's Reflex DC. If it succeeds, it wraps the target, who is @UUID[Compendium.pf2e.conditionitems.Item.VcDeM8A5oI6VqhbM]{Restrained}. It can't Fly while wrapping a creature.</p>", ["attack"]);
    assert.deepEqual([wrap?.resolution?.check?.against?.statistic, wrap?.resolution?.outcomes?.success?.effects?.[0]?.slug, wrap?.notes], ["reflex", "restrained", ["It can't Fly while wrapping a creature."]]);
    // (Its results all the GM's: not this plan.)
    assert.equal(compile("<p>The test hatter throws a hat with a @Check[test-hat|against:ac]{+20} modifier. On a hit, the target must succeed at a @Check[will|dc:30] save or suffer the listed effect.</p>"), null);
});

test("reaction Strikes back in more words: an ally's hit, a melee Strike from close by, typed damage, a cast, a getaway (2026-10-12, batch 122)", () => {
    const compile = (description) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: description } } }, { basicActions: {} });
    const react = (trigger, effect) => compile(`<p><strong>Trigger</strong> ${trigger}</p><hr /><p><strong>Effect</strong> ${effect}</p>`);
    assert.deepEqual(react("A creature within the test hound's reach is hit by an ally's melee attack", "The test hound makes a jaws Strike against the triggering creature."), { builtin: "reaction-strike", triggers: ["ally-hit"], strike: "jaws", penalty: 0, disrupts: false });
    assert.deepEqual(react("A creature within 10 feet makes a melee Strike against the test giant", "The test giant makes a fist Strike against the triggering creature. This Strike doesn't count toward the test giant's multiple attack penalty."), { builtin: "reaction-strike", triggers: ["attacked"], melee: true, strike: "fist", penalty: 0, disrupts: false });
    assert.deepEqual(react("An adjacent creature deals the test blob slashing damage.", "The test blob's cut opens wide. It makes a gullet Strike against the triggering creature.")?.damageTypes, ["slashing"]);
    assert.deepEqual(react("An adjacent creature hits the test shrub with an attack that deals slashing or piercing damage", "Sap flies. The test shrub makes a thorn Strike against the creature.")?.damageTypes, ["slashing", "piercing"]);
    assert.deepEqual(react("A creature within reach of the test drake's tail Casts a Spell", "The test drake makes a tail Strike at the creature with a –2 penalty. If the Strike hits, the test drake disrupts the creature's action."), { builtin: "reaction-strike", triggers: ["cast"], strike: "tail", penalty: 2, disrupts: true });
    assert.deepEqual(react("A creature damages the test duelist with a melee Strike", "The test duelist makes a melee Strike against the triggering creature. She suffers a -2 penalty on the attack roll but gains a +2 bonus on the damage roll if the Strike hits."), { builtin: "reaction-strike", triggers: ["damaged-adjacent"], strike: null, penalty: 2, disrupts: false, damageBonus: 2 });
    assert.deepEqual(react("A creature the test crab had Grabbed or Restrained successfully Escapes", "The test crab makes a pincer Strike against the triggering creature.")?.triggers, ["escaped"]);
    assert.deepEqual(react("A creature ends a move action within reach of the test beast's horn Strike", "The test beast makes a horn Strike against the triggering creature.")?.triggers, ["approach"]);
    // (Not with a sentence it can't play after the Strike.)
    assert.equal(react("A creature within 10 feet makes a melee Strike against the test giant", "The test giant makes a fist Strike against the triggering creature. The creature is pushed 10 feet.")?.builtin === "reaction-strike", false);
});

test("a move and nothing else: safe when it triggers no reactions, otherwise nothing for the fight's numbers (2026-10-12, batch 123)", () => {
    const compile = (description, actions = 1) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: `<p>${description}</p>` } } }, { basicActions: {} });
    assert.equal(compile("The test weed Strides up to half its Speed. This movement doesn't provoke reactions.")?.builtin, "safe-move");
    assert.equal(compile("The test vole Strides up to half its speed. It can pass through other creatures' spaces during this movement, though it must end its movement in an unoccupied space.")?.builtin, "no-effect");
    assert.equal(compile("The test dancer hums a tune to tread lightly. It Strides and then Steps, or Steps and then Strides, ignoring difficult terrain during this movement.", 2)?.builtin, "no-effect");
    assert.equal(compile("The test eel moves up to 90 feet in a straight line through the water without triggering any reactions.", 2)?.builtin, "safe-move");
    // (Not with more than moving: a Feint, a light requirement.)
    assert.equal(compile("The test rogue Strides up to half its Speed and attempts a Feint, in either order."), null);
    assert.equal(compile("The test shade Strides up to twice its Speed. This movement doesn't trigger reactions, but the test shade must begin and end in darkness.", 2), null);
});

test("multi-Strikes in more words: off-guard after a first hit, both hits' grab or damage, notes for the GM (2026-10-12, batch 124)", () => {
    const compile = (description, actions = 2) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: `<p>${description}</p>` } } }, { basicActions: {} });
    assert.equal(compile("The test cutter makes two knife Strikes against the same target. If her first attack hits, the target is Off-Guard to the second attack. The multiple attack penalty applies to these attacks as normal.")?.secondOffGuard, "hit");
    assert.deepEqual(compile("The test bug makes two pincer Strikes. If it hits the same creature with both attacks, that creature is Grabbed until the end of the test bug's next turn.")?.bothHit?.conditions, [{ slug: "grabbed", value: null, rounds: 1 }]);
    assert.deepEqual(compile("The test cat makes two paw Strikes against a creature it has Grabbed. A creature hit by both paw Strikes also takes @Damage[1d6[persistent,fire]] damage.", 1)?.bothHit?.damage, ["1d6[persistent,fire]"]);
    const reach = compile("<strong>Frequency</strong> once per round</p><hr /><p><strong>Effect</strong> The test eel makes two fang Strikes against the same target, ignoring the target's cover. The test eel can't Grab as its next action after Test.", 1);
    assert.deepEqual([reach?.oncePerTurn, reach?.notes], [true, ["The Strikes ignore the target's cover.", "The test eel can't Grab as its next action after Test."]]);
    assert.deepEqual(compile("The test brute makes two fist Strikes and one Strike with its horns, hooves, or tail, in any order.")?.strikes, ["fist", "fist", "horns"]);
    assert.equal(compile("The test raptor makes two talon Strikes against different targets. Both attacks count toward its multiple attack penalty, but do not increase the penalty until it has made both attacks.")?.sameMap, true);
});

test("a basic maneuver in its own words, and at each creature around it (2026-10-12, batch 125)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const compile = (description, actions = 1) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: `<p>${description}</p>` } } }, { basicActions });
    const cry = compile("The test hound bays and snarls as it attempts to Demoralize a creature. It gains a +2 circumstance bonus to this Intimidation check, and the attempt is not penalized if the target can't understand the test hound.");
    assert.deepEqual(cry?.resolution?.check?.bonus, { value: 2, type: "circumstance" });
    const flourish = compile("The test duelist attempts an Intimidation check to Demoralize each enemy within 30 feet, without suffering penalties for not sharing a language. Regardless of the result, each creature is temporarily immune to Test for 1 minute.");
    assert.deepEqual([flourish?.targeting?.area, flourish?.trigger?.immunity?.duration], [{ type: "emanation", value: 30 }, { value: 1, unit: "minutes" }]);
    assert.deepEqual(compile("The test ram attempts to Shove the nearest creature and then Strides with a +20-foot circumstance bonus to Speed.")?.notes, ["Then it Strides with a +20-foot circumstance bonus to Speed."]);
    // (Not one with a critical success of its own.)
    assert.equal(compile("The test bouncer attempts to Demoralize a creature. If the test bouncer rolls a critical success, the target can't reduce its frightened value for 1 round."), null);
    assert.deepEqual(compile("The test dancer spins. The test dancer attempts an Athletics check to Disarm against each enemy within melee reach. Each attempt counts toward the test dancer's multiple attack penalty, but the penalty doesn't increase until they have made all the attempts.", 2), { builtin: "skill-sweep", actions: 2, action: "disarm", sameMap: true });
    assert.deepEqual(compile("The test engine attempts to Grab all adjacent creatures.", 3), { builtin: "skill-sweep", actions: 3, action: "grapple" });
});

test("Demoralize at every foe around it, in more words (2026-10-12, batch 126)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const compile = (description, actions = 1) => compileMonsterAbility({ type: "action", name: "Test Howl", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: `<p>${description}</p>` } } }, { basicActions });
    const howl = compile("The test wolf throws back its head, attempting to [[/act demoralize options=area-effect]] each creature within @Template[emanation|distance:20]{20 feet}. These creatures are then immune to Test Howl for 1 minute.");
    assert.deepEqual([howl?.targeting?.area, howl?.trigger?.immunity?.duration], [{ type: "emanation", value: 20 }, { value: 1, unit: "minutes" }]);
    const display = compile("<strong>Requirements</strong> The test knight is wielding a melee weapon</p><hr /><p><strong>Effect</strong> The test knight waves the blade about. It [[/act demoralize]]{Demoralizes} all enemies within 20 feet, rolling once and comparing the result to each target's Will DC.", 2);
    assert.deepEqual(display?.targeting?.area, { type: "emanation", value: 20 });
    const lurk = compile("The test beast growls from the dark. The test beast makes an Intimidation check to Demoralize all living creatures within 40 feet that can hear the test beast but not see them. Roll once and apply the result to all creatures. Each target is temporarily immune for 1 minute.");
    assert.deepEqual(lurk?.notes, ["Only creatures that can hear it but not see it."]);
    assert.equal(compile("The test gang attempts to [[/act demoralize]] up to 3 creatures.")?.targeting?.target, "up to 3 creatures");
    // (Not a choice after a move.)
    assert.equal(compile("The test marshal Strides and then either Interacts to reload a crossbow or makes an Intimidation check to Demoralize a foe."), null);
});

test("Strike activities in more words, a Speed penalty after a save (2026-10-12, batch 127)", () => {
    const compile = (description, actions = 1, type = "action") => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: actions }, traits: { value: [] }, description: { value: `<p>${description}</p>` } } }, { basicActions: {} });
    const clobber = compile("The test brute makes a club Strike. On a hit, if the target is Off-Guard, the target must succeed at a @Check[fortitude|dc:20] save or be Stunned 1.");
    assert.deepEqual([clobber?.strike, clobber?.onHit?.saveIf, clobber?.onHit?.save?.resolution?.outcomes?.failure?.effects?.[0]?.slug], ["club", "off-guard", "stunned"]);
    assert.deepEqual(compile("The test cultist attempts a Strike with a sickle. On a hit, she inflicts an additional @Damage[1d6[bleed]] damage.")?.onHit?.damage, ["1d6[bleed]"]);
    const cut = compile("The test barber attempts a razor Strike against an adjacent target. If he hits, the blade cuts deep and creates a grievous wound. In addition to the normal damage caused by the attack, the creature struck takes @Damage[2d6[bleed]] damage and becomes Wounded 1 (or increases the value of an existing wounded condition by 1, to a maximum of Wounded 4).", 2);
    assert.deepEqual([cut?.onHit?.damage, cut?.onHit?.conditions?.[0]?.slug], [["2d6[bleed]"], "wounded"]);
    const volley = compile("Each creature in a @Template[type:burst|distance:20] within 60 feet must attempt a @Check[fortitude|dc:20] saving throw. On a failure, a creature takes a –10-foot circumstance penalty to its Speed for 1 minute.", 2);
    assert.deepEqual(volley?.resolution?.outcomes?.failure?.modifiers?.[0]?.selector, "land-speed");
});

test("Strike activities with a save or a rider in other words (2026-10-12, batch 128)", () => {
    const compile = (description, actions = 2) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: `<p>${description}</p>` } } }, { basicActions: {} });
    const thrust = compile("The test guard makes a spear Strike. If the Strike hits, the target must attempt a @Check[reflex|dc:18] save. On a failure, the creature is @UUID[Compendium.pf2e.conditionitems.Item.eIcWbB5o3pP6OIMe]{Immobilized} until the test guard moves or lets go of the spear.");
    assert.deepEqual([thrust?.onHit?.save?.resolution?.outcomes?.failure?.effects?.[0]?.slug, thrust?.notes], ["immobilized", ["The creature stays Immobilized until the test guard moves or lets go of the spear."]]);
    const tickle = compile("The test hound makes a jaws Strike. If successful, after taking the normal damage from the Strike, the target must succeed at a @Check[will|dc:20] save or become Slowed 1 for 1 minute as it giggles helplessly.", 3);
    assert.equal(tickle?.onHit?.save?.resolution?.outcomes?.failure?.effects?.[0]?.slug, "slowed");
    const nerve = compile("The test monk Strikes with their fist. If they hit, the target is Paralyzed until the end of the test monk's next turn (@Check[fortitude|dc:17] negates).");
    assert.deepEqual([nerve?.strike, nerve?.onHit?.save?.resolution?.outcomes?.failure?.effects?.[0]?.slug], ["fist", "paralyzed"]);
    const tackle = compile("The test drake makes a jaws Strike. If the jaws Strike hits and the target is Medium or smaller, the target is knocked Prone.", 1);
    assert.deepEqual([tackle?.onHit?.size, tackle?.onHit?.conditions?.[0]?.slug], ["medium", "prone"]);
    assert.deepEqual(compile("The test thug makes a knife Strike. If they hit and deal damage, the damaged creature is Frightened 1 (or Frightened 2 on a critical hit).", 1)?.onHit?.critical, [{ slug: "frightened", value: 2, duration: null }]);
    // (Not "Strikes with its fist at a -1 circumstance penalty" read as a Strike named so.)
    assert.equal(compile("The test golem Strikes with its fist at a -1 circumstance penalty.", 1)?.strike ?? "fist", "fist");
});

test("multi-Strikes and sweeps in more words (2026-10-12, batch 129)", () => {
    const compile = (description, actions = 2) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: `<p>${description}</p>` } } }, { basicActions: {} });
    assert.deepEqual(compile("The test titan makes a bite Strike, two talon Strikes, and one tail Strike in any order.", 3)?.strikes, ["bite", "talon", "talon", "tail"]);
    assert.deepEqual(compile("The test guard makes three mace Strikes against a single target, ignoring the multiple attack penalty until after all three attacks are completed.")?.sameMap, true);
    assert.deepEqual(compile("The test troll swings wildly. The test troll attempts two axe Strikes, each of which must target a different foe within reach.", 1)?.each, true);
    assert.deepEqual(compile("The test psychic makes a Strike with each of its jaws, claw, and tail, in any order. These Strikes have a reach of 60 feet.")?.strikes, ["jaws", "claw", "tail"]);
    assert.equal(compile("The test dervish whirls. They make a melee Strike against each enemy within reach. Each attack counts toward the test dervish's multiple attack penalty, but they don't increase their penalty until they have made all their attacks.", 3)?.sameMap, true);
    assert.deepEqual(compile("The test monk makes a single Strike and compares the result to the AC of all creatures within its reach, dealing damage to each creature hit.")?.max, 8);
    assert.deepEqual(compile("<strong>Requirements</strong> Each of the test brute's four hands wields a club.</p><hr /><p><strong>Effect</strong> The test brute Strides up to half his speed, then makes four club Strikes, applying his multiple attack penalty as normal.", 3)?.strides, 1);
});

test("Strikes in more words: an adjacent shot, a penalty and its damage, a crest's extra die, two weapons at its prey (2026-10-12, batch 130)", () => {
    const compile = (description, actions = 1) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: `<p>${description}</p>` } } }, { basicActions: {} });
    const blank = compile("The test sniper makes a crossbow Strike against an adjacent enemy; unlike most ranged Strikes, this Strike doesn't provoke reactions. If successful, the attack deals an additional 2d6 precision damage.", 2);
    assert.deepEqual([blank?.onHit?.damage, blank?.notes?.length], [["2d6[precision]"], 1]);
    const aim = compile("The test archer makes a ranged Strike at a –2 penalty. The test archer deals 3 additional damage with this Strike.");
    assert.deepEqual([aim?.attackBonus, aim?.damageBonus], [-2, 3]);
    const crest = compile("The test beast rears up. The test beast makes a horn Strike; on a hit, the test beast deals an extra die of damage. This counts as two attacks when calculating the test beast's multiple attack penalty", 2);
    assert.deepEqual([crest?.extraWeaponDice, crest?.countsAs], [1, 2]);
    const butcher = compile("<strong>Frequency</strong> once per round; <strong>Requirement</strong> the test butcher is wielding two melee weapons, each in a different hand</p><hr /><p><strong>Effect</strong> It makes two Strikes against its menaced prey, one with each of the required weapons. In addition, if both Strikes hit, the menaced prey is Off-Guard until the start of the test butcher's next turn.");
    assert.deepEqual(butcher?.bothHit?.conditions, [{ slug: "off-guard", value: null, rounds: 1 }]);
});

test("the glossary's Power Attack, two-weapon flurries, an attack bonus on this Strike (2026-10-12, batch 131)", () => {
    const compile = (description, actions = 2, slug = null) => compileMonsterAbility({ type: "action", name: "Test", system: { slug, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: `<p>${description}</p>` } } }, { basicActions: {} });
    const power = compile("@Localize[PF2E.NPC.Abilities.Glossary.PowerAttack]", 2);
    assert.deepEqual([power?.builtin, power?.countsAs, power?.extraWeaponDice, power?.oncePerTurn], ["strike-activity", 2, 1, true]);
    assert.deepEqual(compile("<strong>Frequency</strong> once per round</p><p><strong>Requirements</strong> The test slayer is wielding two melee weapons, each in a different hand</p><p><strong>Effect</strong> They Strike twice, once with each weapon.", 1)?.strikes, [null, null]);
    const slice = compile("The test captain makes two Strikes, one with each melee weapon, each using his current multiple attack penalty. Both Strikes must have the same target. If the second Strike is made with a weapon that doesn't have the agile trait, it takes a -2 penalty. Precision damage is added only once. This counts as two attacks when calculating his multiple attack penalty.");
    assert.deepEqual([slice?.strikes, slice?.countsAs, slice?.notes?.length], [[null, null], 2, 1]);
    const swing = compile("The test duelist makes a melee weapon Strike. On this Strike, he gains a +2 circumstance bonus to the attack roll and ignores any concealment the target has.");
    assert.deepEqual([swing?.attackBonus, swing?.notes], [2, ["This Strike ignores the target's concealment."]]);
});

test("a Grapple as a reaction to damage of a type, at a creature beside it (2026-10-12, batch 132)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const compile = (description) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: description } } }, { basicActions });
    const plan = compile("<p><strong>Trigger</strong> The test golem takes cold damage and a creature is adjacent to it.</p><hr /><p><strong>Effect</strong> The test golem lashes out and tries to grab a nearby creature. The test golem attempts an Athletics check to [[/act grapple]] an adjacent creature. The creature also takes @Damage[2d6[cold]] damage on a success, or @Damage[4d6[cold]] damage on a critical success.</p>");
    assert.deepEqual([plan?.trigger, plan?.targeting?.target, plan?.resolution?.outcomes?.success?.damage?.formulas?.[0]?.formula, plan?.resolution?.outcomes?.success?.effects?.[0]?.slug], [{ event: "damaged", reaction: true, damageTypes: ["cold"] }, "an adjacent creature", "2d6[cold]", "grabbed"]);
});

test("a teleport away from a creature that comes beside it; a failed Will save made a success at a cost (2026-10-12, batch 133)", () => {
    const compile = (description) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: description } } }, { basicActions: {} });
    assert.deepEqual(compile("<p><strong>Trigger</strong> A creature moves adjacent to the test sprite</p><hr /><p><strong>Effect</strong> The test sprite teleports to a clear space adjacent to another creature it can see within 20 feet.</p>"), { builtin: "withdraw", on: "approach", enters: true, move: "Teleport", feet: 20, safe: true });
    const resolve = compile("<p><strong>Trigger</strong> The test agent rolls a failure (but not a critical failure) on a Will save against an effect with the mental or fear trait</p><p><strong>Requirements</strong> The test agent's features are obscured by a mask or hood</p><hr /><p><strong>Effect</strong> The test agent takes @Damage[2d8[mental]] damage, and the saving throw is a success.</p>");
    assert.deepEqual([resolve?.builtin, resolve?.failureOnly, resolve?.save, resolve?.against, resolve?.selfDamage], ["save-boost", true, "will", ["mental", "fear"], "2d8[mental]"]);
});

test("a move first, then a basic maneuver with what its successes add (2026-10-12, batch 134)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const compile = (description, actions = 2, actor = null) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: `<p>${description}</p>` } } }, { basicActions, actor });
    const tackle = compile("The test brute Strides twice and then attempts to Grapple a creature. On a success, the target is also knocked Prone.");
    assert.deepEqual([tackle?.approach, tackle?.resolution?.outcomes?.success?.effects?.map((effect) => effect.slug)], [{ strides: 2 }, ["grabbed", "prone"]]);
    const mosh = compile("The test punk Leaps to a square adjacent to a creature, then Shoves that creature. If the test punk rolls a success on the [[/act shove]], he gets a critical success instead.", 1);
    assert.deepEqual(mosh?.resolution?.outcomes?.success, mosh?.resolution?.outcomes?.criticalSuccess);
    const actor = { items: [{ type: "melee", name: "Fist", system: { damageRolls: { a: { damage: "1d6+2", damageType: "bludgeoning" } } } }] };
    const ambush = compile("The test lurker Strides up to 10 feet and attempts to Grapple a creature they're Undetected by. If they succeed, they also deal fist damage to that creature.", 1, actor);
    assert.deepEqual([ambush?.requires, ambush?.resolution?.outcomes?.success?.damage?.formulas], ["requirement", [{ formula: "(1d6+2)[bludgeoning]" }]]);
});

test("a move first, then a Feint or Demoralize (2026-10-12, batch 135)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const compile = (description, actions = 2) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: `<p>${description}</p>` } } }, { basicActions });
    const flourish = compile("The test rogue Strides twice. If they end their movement within melee reach of an enemy, they can Feint.");
    assert.deepEqual([flourish?.resolution?.check?.statistic, flourish?.approach], ["deception", { strides: 2 }]);
    const shuffle = compile("The test spy Strides up to half their Speed and attempts a Feint, in either order.", 1);
    assert.deepEqual([shuffle?.approach, shuffle?.notes?.length], [{ strides: 1, half: true }, 2]);
    const rush = compile("The test wolf moves up to half its Speed. This movement doesn't trigger reactions. At the end of the movement, it attempts an Intimidation check to [[/act demoralize]] a target within 5 feet of it.", 1);
    assert.equal(rush?.resolution?.check?.statistic, "intimidation");
    const halt = compile("The test watchman Strides twice and then [[/act demoralize]]{Demoralizes}. On a success, the target is Slowed with a value equal to its Frightened value until it is no longer frightened.");
    assert.deepEqual(halt?.resolution?.outcomes?.criticalSuccess?.effects?.map((effect) => `${effect.slug}${effect.value}`), ["frightened2", "slowed2"]);
});

test("a Burrow away on damage with a recharge, a resistance with a shift, a Strike then a Swim, a burrowed pounce (2026-10-12, batch 136)", () => {
    const compile = (description, type = "reaction", actions = null) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: actions }, traits: { value: [] }, description: { value: description } } }, { basicActions: {} });
    assert.deepEqual(compile("<p><strong>Trigger</strong> The test slab takes damage from a hostile source while atop rock or earth</p><hr /><p><strong>Effect</strong> The test slab crumbles into the ground, Burrowing down 10 feet. This Burrowing does not trigger reactions. The test slab can't Crumble again for [[/gmr 1d4 #Recharge Crumble]]{1d4 rounds}.</p>"), { builtin: "withdraw", on: "damaged", hostile: true, while: "atop rock or earth", move: "Burrow", feet: 10, safe: true, recharge: "1d4" });
    assert.deepEqual(compile("<p><strong>Trigger</strong> The test bard would take damage</p><hr /><p><strong>Effect</strong> The test bard gains resistance 3 to the triggering damage and teleports to an adjacent space.</p>")?.shift, true);
    assert.deepEqual(compile("<p>The test seahorse makes a tail Strike, then Swims with a +10-foot circumstance bonus to its swim Speed. It gains a +2 circumstance bonus to AC against reactions triggered by this movement.</p>", "action", 2), { builtin: "no-effect", strikeOnly: true });
    const pounce = compile("<p><strong>Requirements</strong> The test drake is burrowed</p><hr /><p><strong>Effect</strong> The test drake Burrows, then Leaps out of the ground, landing at a point within 25 feet. The test drake makes a melee Strike against a creature within reach when they land. If the Strike is a critical hit, the target is knocked Prone.</p>", "action", 3);
    assert.deepEqual([pounce?.builtin, pounce?.requires, pounce?.onHit?.critical?.[0]?.slug], ["strike-activity", "requirement", "prone"]);
    assert.equal(compile("<p><strong>Frequency</strong> once per minute</p><hr /><p><strong>Effect</strong> The test bird Strides three times in a straight line</p>", "action", 2)?.builtin, "no-effect");
});

test("reaction Strikes at a creature leaving with metal, trying to Escape or just tripped; provoked Trips with more (2026-10-12, batch 137)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const actor = { items: [{ type: "melee", name: "Tail", system: { damageRolls: { a: { damage: "2d8+9", damageType: "slashing" } } } }] };
    const reaction = (trigger, effect) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: `<p><strong>Trigger</strong> ${trigger}</p><hr /><p><strong>Effect</strong> ${effect}</p>` } } }, { basicActions, actor });
    assert.deepEqual(reaction("A creature carrying a metal item attempts to move out of a square within reach of the test beast's tail.", "The test beast makes a tail Strike against the triggering creature."), { builtin: "reaction-strike", triggers: ["leave"], strike: "tail", penalty: 0, disrupts: false, only: "a creature carrying a metal item" });
    assert.deepEqual(reaction("A creature attempts to Escape from the test strangler", "The test strangler makes a cord Strike against the triggering creature. This Strike doesn't have Improved Grab."), { builtin: "reaction-strike", triggers: ["escape"], strike: "cord", penalty: 0, disrupts: false, noGrab: true });
    assert.deepEqual(reaction("The test brute successfully Trips a creature using a hooked pole", "The test brute makes a hooked pole Strike against the creature they tripped."), { builtin: "reaction-strike", triggers: ["tripped"], strike: "hooked pole", penalty: 0, disrupts: false, using: "hooked pole" });
    // A provoked Trip that also deals its tail's damage on a success, the fall the GM's.
    const whip = reaction("A creature within reach of the test fiend's tail leaves a square during a move action it's using", "The test fiend attempts to [[/act trip]] the triggering creature. On a success, the creature also takes damage as if the test fiend had hit with a tail Strike, and if the creature was flying, it falls 30 feet.");
    assert.deepEqual([whip.trigger.triggers, whip.resolution.outcomes.success.damage.formulas, whip.resolution.reminders], [["leave"], [{ formula: "(2d8+9)[slashing]" }], ["If the creature was flying, it falls 30 feet."]]);
    // Acrobatics against Reflex, Prone on either success, nothing else; only a Medium creature.
    const knees = reaction("A Medium creature within the test imp's reach leaves a square during its move action", "The test imp swipes low at the triggering creature's ankles. The test imp makes an @Check[acrobatics] check against the creature's Reflex DC. On a success, the target falls and lands prone.");
    assert.deepEqual([knees.trigger.sizes, knees.resolution.check.statistic, knees.resolution.outcomes.criticalSuccess.damage.mode, knees.resolution.outcomes.criticalFailure.effects], [["medium"], "acrobatics", "none", []]);
    // A Trip whose ground becomes difficult terrain: a note.
    const ground = reaction("A creature within 15 feet uses a move action (move actions using only a fly Speed don't trigger this reaction)", "The test digger attempts an Athletics check to Trip the triggering creature. Regardless of the result, the space of the triggering creature becomes difficult terrain for 1 round.");
    assert.deepEqual([ground.trigger.within, ground.resolution.reminders.length], [15, 1]);
});

test("guards that last until it moves, a guard raised with a weapon, more multi-Strike wordings, a Demoralize after a hit (2026-10-12, batch 138)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const action = (description, actions = 1) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: description } } }, { basicActions });
    const cower = action("<p>The test grub curls up tight. It gains a +4 circumstance bonus to AC but takes a –2 penalty to attack rolls. This lasts until the test grub moves from its current space, falls Unconscious, or ends the effect as a free action.</p>");
    assert.deepEqual([cower.builtin, cower.model.modifiers, cower.stance, cower.endsOnMove, cower.duration.unit], ["self-effect", [{ on: "ac", type: "circumstance", value: 4 }, { on: "attack", type: "untyped", value: -2 }], true, true, "unlimited"]);
    const entrench = action("<p>The test bulwark locks itself in place, becoming voluntarily Immobilized. While Entrenched, the test bulwark can't be forcibly moved or tripped, and it gains a +2 circumstance bonus to AC and Reflex saves. Entrench ends automatically as soon as the test bulwark uses another move action.</p>");
    assert.deepEqual([entrench.model.modifiers.map((modifier) => modifier.on), entrench.endsOnMove, entrench.notes.length], [["ac", "reflex"], true, 3]);
    const raised = action("<p>The test sailor Interacts to raise their harpoon, gaining a +1 circumstance bonus to AC until the start of their next turn. During this time, any of their allies also gains the bonus while adjacent to the test sailor.</p>");
    assert.deepEqual([raised.model.modifiers, raised.duration.expiry, raised.notes.length], [[{ on: "ac", type: "circumstance", value: 1 }], "turn-start", 1]);
    // Two Strikes that change their damage type and can't Grab; two claws after its own action, a bleed if both hit; two at its prey.
    const stab = action("<p><strong>Frequency</strong> once per round</p><hr /><p><strong>Effect</strong> The test squid makes two tentacle Strikes against the same creature. These Strikes deal piercing damage instead of bludgeoning, and the test squid can't Grab with them. Its multiple attack penalty doesn't increase until after both attacks.</p>");
    assert.deepEqual([stab.strikes, stab.sameMap, stab.noGrab, stab.notes.length], [["tentacle", "tentacle"], true, true, 2]);
    const mauling = action("<p><strong>Requirements</strong> The test vampire's last action was to Drink Blood</p><hr /><p><strong>Effect</strong> The test vampire makes two claw Strikes. Both count toward its multiple attack penalty, but the penalty increases only after it makes both attacks. If it hits with both claws, the target takes @Damage[1d6[bleed]].</p>");
    assert.deepEqual([mauling.requires, mauling.bothHit.damage], ["requirement", ["1d6[bleed]"]]);
    const prey = action("<p><strong>Frequency</strong> once per round</p><p><strong>Requirements</strong> The test stalker has designated a creature as their prey using Spirit Mark</p><hr /><p><strong>Effect</strong> The test stalker makes two ranged Strikes against their prey. If both Strikes hit, combine their damage for the purpose of resistances and weaknesses.</p>");
    assert.deepEqual([prey.builtin, prey.sameTarget, prey.oncePerTurn, prey.requires], ["multi-strike", true, true, "requirement"]);
    // A Demoralize at each foe within 30 feet, straight after a hit with its spear.
    const rattle = action("<p><strong>Requirements</strong> The test lizard's last action was a successful pike Strike</p><hr /><p><strong>Effect</strong> The test lizard bangs the butt of their pike, attempting an Intimidation check to [[/act demoralize]] all enemies within @Template[emanation|distance:30]{30 feet} (compare the test lizard's Intimidation check result to the targets' Will DCs individually).</p>");
    assert.deepEqual([rattle.trigger.followUp.strike, rattle.targeting.area, rattle.resolution.check.statistic], ["pike", { type: "emanation", value: 30 }, "intimidation"]);
    // Not a requirement read as its subject.
    assert.equal(action("<p><strong>Requirements</strong> The test lizard is in the water</p><hr /><p><strong>Effect</strong> The test lizard attempts to Demoralize all enemies within 30 feet.</p>")?.resolution?.check?.statistic === "intimidation", false);
});

test("Strike activities and multi-Strikes in more words; a reaction to initiative with a skill (2026-10-12, batch 139)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const ability = (description, type = "action", actions = 2) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: [] }, description: { value: description } } }, { basicActions });
    const skewer = ability("<p>The test duelist Strikes with its estoc, and gains a +1 circumstance bonus to the attack roll. A creature damaged by the attack takes @Damage[1d4[bleed]].</p>");
    assert.deepEqual([skewer.builtin, skewer.strike, skewer.attackBonus, skewer.onHit.damage], ["strike-activity", "estoc", 1, ["1d4[bleed]"]]);
    const swing = ability("<p>The test ogre makes a maul Strike. The target is Pushed up to 5 feet on a hit or up to 15 feet on a critical hit. If the target collides with a solid object, it takes bludgeoning damage as though it had fallen the distance it moved.</p>");
    assert.deepEqual([swing.onHit.push, swing.onHit.criticalPush, swing.notes.length], [5, 15, 1]);
    const rake = ability("<p>The test badger makes three claw Strikes against a creature it has grabbed. Each attack counts toward the test badger's multiple attack penalty, and the multiple attack penalty increases with each attack.</p>");
    assert.deepEqual([rake.strikes.length, rake.requires, rake.sameMap], [3, "grabbed", undefined]);
    const frenzy = ability("<p>The test beast makes a jaws Strike, a tail Strike, and two hoof Strikes, each against a different target. Each attack counts toward the test beast's multiple attack penalty, but the penalty doesn't increase until after all the attacks.</p>");
    assert.deepEqual([frenzy.strikes, frenzy.each, frenzy.sameMap], [["jaws", "tail", "hoof", "hoof"], true, true]);
    const team = ability("<p>The test haunt makes a spectral axe Strike, spectral spear Strike, and spectral sling Strike in any order. Each must target a different creature. Their multiple attack penalty doesn't increase until after all the attacks.</p>", "action", 3);
    assert.deepEqual([team.strikes, team.each], [["spectral axe", "spectral spear", "spectral sling"], true]);
    // Not a list made of what follows the Strikes.
    assert.notDeepEqual(ability("<p>The test boxer makes two fist Strikes, ignoring the multiple attack penalty until after both Strikes.</p>", "action", 1)?.strikes?.length, 3);
    const rend = ability("<p>The test ape makes two fist Strikes against the same target. If both hit, the attack deals an additional @Damage[2d4[bludgeoning]] damage, the target is Off-Guard, and the target takes a –10-foot status penalty to all Speeds until the end of its next turn.</p>");
    assert.deepEqual([rend.bothHit.damage, rend.bothHit.conditions[0].slug, rend.notes.length], [["2d4[bludgeoning]"], "off-guard", 1]);
    const circle = ability("<p>The test kite Flies up to half its Speed, makes two talon Strikes, then Flies up to half its Speed again to return to its original location. The second half of this movement doesn't trigger reactions. Both attacks count toward the test kite's multiple attack penalty, but the penalty doesn't increase until after it makes both attacks.</p>");
    assert.deepEqual([circle.strikes, circle.sameMap, circle.notes.length], [["talon", "talon"], true, 1]);
    const charm = ability("<p><strong>Trigger</strong> The test showman rolls initiative using Deception or Performance</p><hr /><p><strong>Effect</strong> The test showman can attempt to [[/act demoralize]] one creature they can see.</p>", "free");
    assert.deepEqual([charm.trigger.event, charm.trigger.skills, charm.resolution.check.statistic], ["initiative", ["deception", "performance"], "intimidation"]);
});

test("what a Strike leaves on itself, a sweep in a frenzy, a dodge against a Strike or spell, Hit Points back on downing a foe (2026-10-12, batch 140)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const ability = (description, type = "action", actions = 2) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: [] }, description: { value: description } } }, { basicActions });
    const slam = ability("<p>The test brute braces its shield arm while attacking. The test brute Strikes once and gains a +2 circumstance bonus to AC until the start of its next turn.</p>");
    assert.deepEqual([slam.builtin, slam.selfAfter], ["strike-activity", [{ ac: 2, type: "circumstance" }]]);
    const reckless = ability("<p>The test bruiser swings wildly in a reckless attack that makes him Off-Guard until the start of his next turn.</p><p>He Strikes; if he hits, he increases the number of damage dice by one and adds Push to the effect. This counts as two attacks for his multiple attack penalty.</p>", "action", 1);
    assert.deepEqual([reckless.selfAfter, reckless.extraWeaponDice, reckless.onHit.push, reckless.countsAs], [[{ slug: "off-guard", until: "own-turn-start" }], 1, 5, 2]);
    const tide = ability("<p><strong>Requirements</strong> The test captain is in a blood frenzy.</p><hr /><p><strong>Effect</strong> The test captain unleashes a storm of blows against its foes, making a single melee Strike with its fists or horns against each opponent within reach.</p>");
    assert.deepEqual([tide.builtin, tide.each, tide.requires], ["multi-strike", true, "requirement"]);
    const dodge = ability("<p><strong>Trigger</strong> The test wraith is targeted by a Strike or spell</p><hr /><p><strong>Effect</strong> The test wraith gains a +2 circumstance bonus to AC and resistance 5 to cold damage against the triggering attack.</p>", "reaction");
    assert.deepEqual([dodge.builtin, dodge.value, dodge.notes.length], ["ac-reaction", 2, 2]);
    const absorb = ability("<p><strong>Trigger</strong> The test glutton reduces a creature it can smell with its true sin scent to 0 Hit Points</p><hr /><p><strong>Effect</strong> The test glutton regains @Damage[4d6[healing]] Hit Points.</p>", "free");
    assert.deepEqual([absorb.trigger.event, absorb.trigger.free, absorb.targeting.target, absorb.resolution.kind], ["downs", true, "self", "healing"]);
});

test("maneuvers in their own words with more on a success; a Stride and a maneuver in fewer words (2026-10-12, batch 141)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const action = (description, actions = 1) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: description } } }, { basicActions });
    const condemn = action("<p>The test judge [[/act demoralize]]{Demoralizes}. On a success, the target is Stunned with a value equal to its Frightened condition.</p>");
    assert.deepEqual([condemn.resolution.check.statistic, condemn.resolution.outcomes.success.effects.map((effect) => `${effect.slug} ${effect.value}`), condemn.resolution.outcomes.criticalSuccess.effects.map((effect) => `${effect.slug} ${effect.value}`)], ["intimidation", ["frightened 1", "stunned 1"], ["frightened 2", "stunned 2"]]);
    const shove = action("<p>The test bully [[/act shove]]{Shoves} a creature, gaining a +2 circumstance bonus to their Athletics check if the target is Prone. If the Shove succeeds, the target takes @Damage[2d8[bludgeoning]] damage (double damage on a critical success).</p>");
    assert.deepEqual([shove.resolution.outcomes.success.damage.formulas, shove.resolution.outcomes.criticalSuccess.damage.formulas, shove.notes.length], [[{ formula: "2d8[bludgeoning]" }], [{ formula: "2*2d8[bludgeoning]" }], 1]);
    const strangle = action("<p><strong>Requirements</strong> The test cutthroat must have two free hands or be wielding a garrote</p><hr /><p><strong>Effect</strong> The test cutthroat attempts an Athletics check to Grapple with a +2 circumstance bonus. On a success, the target also takes @Damage[(1d4+3)[bludgeoning]] damage and can't speak (including to Cast a Spell) as long as they're Grabbed or Restrained.</p>");
    assert.deepEqual([strangle.resolution.check.bonus, strangle.resolution.outcomes.success.damage.formulas.length, strangle.notes.length], [{ value: 2, type: "circumstance" }, 1, 1]);
    const fray = action("<p>The test charger Strides then [[/act demoralize]]{Demoralizes} an adjacent Medium or smaller creature. When it does, Demoralize loses the auditory trait and gains the visual trait, and it doesn't take a penalty for the test charger not speaking a language.</p>", 2);
    assert.deepEqual([fray.approach, fray.notes.length, fray.requires], [{ strides: 1 }, 3, undefined]);
    const advance = action("<p><strong>Requirements</strong> The test sergeant has their shield raised</p><hr /><p><strong>Effect</strong> The test sergeant pushes ahead behind the shield. The test sergeant Strides and [[/act shove]]{Shoves}, in either order. The multiple attack penalty doesn't apply to this Shove, though the Shove does count toward the test sergeant's multiple attack penalty.</p>");
    assert.deepEqual([advance.approach, advance.requires], [{ strides: 1 }, "requirement"]);
});

test("degrees listed in brackets, a damage type of its choosing, a thrown rock that knocks down (2026-10-12, batch 142)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const action = (description, actions = 1) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: description } } }, { basicActions });
    const roar = action("<p>The test beast bellows. Other creatures within 60 feet must succeed at a @Check[will|dc:20] save or become Frightened 2 (Frightened 3 on a critical failure, Frightened 1 on a success, or unaffected on a critical success).</p><p>No matter the result, the creature is temporarily immune to the effect for 1 minute.</p>");
    const rows = roar.resolution.outcomes;
    assert.deepEqual([roar.targeting.area, rows.criticalSuccess.effects.length, rows.success.effects[0].value, rows.failure.effects[0].value, rows.criticalFailure.effects[0].value, Boolean(roar.trigger.immunity)], [{ type: "emanation", value: 60 }, 0, 1, 2, 3, true]);
    const beams = action("<p>The test eye glares, dealing @Damage[3d6[acid]|options:area-damage]{acid} or @Damage[3d6[electricity]|options:area-damage]{electricity} damage (@Check[reflex|dc:20|basic|options:area-effect] save) to all creatures in a @Template[line|distance:30].</p>", 2);
    assert.deepEqual([beams.resolution.casterChoice, beams.resolution.sharedDamage.components.map((component) => component.formula)], [{ kind: "damage-type", label: "Damage type", values: ["acid", "electricity"] }, ["3d6[acid]"]]);
    const boulder = action("<p>The test giant pries up a stone and throws it as a rock Strike. A creature hit by the Strike must succeed at a @Check[reflex|dc:24] save or be knocked Prone.</p>");
    assert.deepEqual([boulder.builtin, boulder.strike, boulder.onHit.save.resolution.check.statistic], ["strike-activity", "rock", "reflex"]);
});

test("a redeemer's and a liberator's reactions in a monster's words (2026-10-12, batch 143)", () => {
    const reaction = (trigger, effect) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: `<p><strong>Trigger</strong> ${trigger}</p><hr /><p><strong>Effect</strong> ${effect}</p>` } } }, { basicActions: {} });
    assert.deepEqual(reaction("An enemy damages one of the test saint's allies. Both the enemy and ally must be within 15 feet of the test saint.", "The test saint stays the foe's hand. The foe chooses one of two options: The ally is completely unharmed by the triggering damage. The ally gains resistance 5 to all damage against the triggering damage. After the damaging effect resolves, the enemy becomes Enfeebled 2 until the end of its next turn."), { builtin: "champion-reaction", slug: "glimpse-of-redemption", resistance: 5 });
    assert.deepEqual(reaction("An enemy damages, grabs, or restrains the test paladin's ally, and both are in the test paladin's aura", "The test paladin frees an ally from restraint. If the trigger was an ally taking damage, the ally gains resistance 8 to all damage against the triggering damage."), { builtin: "champion-reaction", slug: "liberating-step", resistance: 8 });
    // Its own: a command to kneel, a selfish resistance, vengeance both ways.
    assert.deepEqual(reaction("An enemy within 15 feet damages the test tyrant", "The test tyrant demands obedience. The foe must choose one of the following options. The enemy kneels, dropping Prone as a free action. The enemy refuses, and the test tyrant deals @Damage[3d6[mental]] damage to it. In addition, the test tyrant's Strikes against the triggering creature deal 2 extra damage until the end of its next turn."), { builtin: "champion-reaction", slug: "iron-command", self: true, resistance: 0, dice: 3, note: "Its Strikes against that creature deal 2 more spirit or void damage until the end of its next turn." });
    assert.deepEqual(reaction("An enemy in this creature's champion's aura damages them", "This creature gains resistance 4 against the triggering damage, regardless of damage type."), { builtin: "champion-reaction", slug: "selfish-shield", self: true, resistance: 4 });
    assert.deepEqual(reaction("An enemy in the test reaver's aura damages the test reaver", "The test reaver increases the amount of damage it takes by @Damage[1d6] and deals @Damage[1d6[void]] damage to the triggering enemy."), { builtin: "champion-reaction", slug: "destructive-vengeance", self: true, resistance: 0, selfDamage: "1d6", damage: "1d6[void]" });
});

test("a riposte, shields raised together, a slither, a Reposition with more, a Strike with longer reach (2026-10-12, batch 144)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const ability = (description, type = "action", actions = 1) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: [] }, description: { value: description } } }, { basicActions });
    assert.deepEqual(ability("<p><strong>Trigger</strong> An enemy within the test fencer's reach critically fails on a Strike against him</p><hr /><p><strong>Effect</strong> The test fencer either makes a melee Strike against the triggering enemy or attempts to Disarm them of the weapon used for the Strike.</p>", "reaction"), { builtin: "reaction-strike", triggers: ["critical-miss"], strike: null, penalty: 0, disrupts: false, note: "Or it can Disarm the attacker of that weapon instead." });
    const shields = ability("<p>The test wardens raise their shields in tandem, gaining a +1 circumstance bonus to AC and Reflex saves.</p>");
    assert.deepEqual([shields.builtin, shields.model.modifiers.map((modifier) => modifier.on), shields.duration.expiry], ["self-effect", ["ac", "reflex"], "turn-start"]);
    assert.deepEqual(ability("<p>The test eel Strides, Climbs, or Swims up to half its Speed, pulling any creatures it has grabbed with it.</p>"), { builtin: "no-effect", actions: 1 });
    const usher = ability("<p><strong>Frequency</strong> once per round</p><hr /><p><strong>Effect</strong> The test valet hurries a guest along. The test valet attempts an Athletics check to [[/act reposition]] a Medium or smaller creature within reach. On a success, the target is also Clumsy 1 (Clumsy 2 on a critical success) as the test valet tugs at their sleeve. The target can remove this condition by taking an Interact action.</p>");
    assert.deepEqual([usher.resolution.outcomes.success.effects.at(-1).value, usher.resolution.outcomes.criticalSuccess.effects.at(-1).value, usher.notes.length], [1, 2, 2]);
    assert.deepEqual(ability("<p>The test guard makes a glaive Strike, increasing their reach to 15 feet for that Strike. If there is an unholy ally between the test guard and their target, that creature's energy causes the Strike to deal an additional 1d4 spirit damage.</p>"), { builtin: "no-effect", strikeOnly: true });
});

test("ripostes with and without a stance, moves in more words, a blitz with two weapons, a stalker's advance (2026-10-12, batch 145)", () => {
    const ability = (description, type = "action", actions = 2) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: [] }, description: { value: description } } }, { basicActions: {} });
    assert.deepEqual(ability("<p><strong>Trigger</strong> A creature within the test duelist's reach critically fails a melee Strike against her</p><p><strong>Requirements</strong> The test duelist is benefiting from Twin Parry</p><hr /><p><strong>Effect</strong> The test duelist attempts a melee Strike or uses a Disarm action against the triggering opponent.</p>", "reaction"), { builtin: "reaction-strike", triggers: ["critical-miss"], strike: null, penalty: 0, disrupts: false, note: "Only while it benefits from Twin Parry. Or it can Disarm the attacker instead.", requires: "requirement" });
    assert.equal(ability("<p><strong>Trigger</strong> A creature within your reach critically fails to Strike you. A clever parry with one weapon leaves your opponent open to an attack with the other weapon. Make a melee Strike or Disarm action against the triggering opponent.</p>", "reaction")?.triggers?.[0], "critical-miss");
    assert.deepEqual(ability("<p>The test ooze separates its flesh from its bones to fit through small spaces. It Strides, ignoring difficult terrain and fitting through tight spaces as though it were a Tiny creature. It can't use any actions other than Test Ooze Step until it occupies an area large enough for its normal form.</p>"), { builtin: "no-effect", actions: 2 });
    assert.deepEqual(ability("<p>The test shade fades into shadow, Strides up to twice its Speed, and reforms.</p><p>This movement doesn't trigger reactions, but the test shade must begin and end in an area of dim light or darkness.</p>"), { builtin: "safe-move", actions: 2 });
    assert.deepEqual(ability("<p><strong>Requirements</strong> The test raider is wielding two one-handed melee weapons, each in a different hand</p><hr /><p><strong>Effect</strong> The test raider attacks as he dashes among foes. He Strides up to his Speed. At any point during this movement, he can Strike once with each of the two required weapons. These Strikes can be against the same or different targets, as he sees fit.</p>"), { builtin: "multi-strike", actions: 2, strikes: [null, null], strides: 1 });
    assert.deepEqual(ability("<p>The test revenant Strides twice and makes a claw Strike; they can ignore difficult terrain during these Strides if they advance toward their murderer. If they Strike and Grab their murderer this turn, they can Constrict as a free action immediately after the Grab.</p>"), { builtin: "charge", actions: 2, strides: 2, strike: "claw" });
    assert.deepEqual(ability("<p><strong>Trigger</strong> Another test bird within 10 feet Strides.</p><hr /><p><strong>Effect</strong> The test bird Strides up to half its Speed.</p>", "reaction"), { builtin: "no-effect" });
});

test("a maneuver, then a Strike at the same creature (2026-10-12, batch 146)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const action = (description, actions = 1) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: description } } }, { basicActions });
    const ruse = action("<p><strong>Frequency</strong> Once per round</p><hr /><p><strong>Effect</strong> The test courtier [[/act feint]]{Feints}. On a success, the test courtier Strikes the target.</p>");
    assert.deepEqual([ruse.resolution.check.statistic, ruse.then, ruse.notes.length], ["deception", { strike: null, onSuccess: true }, 1]);
    const slip = action("<p>The test rogue moves up to his Speed, attempts to Feint a creature within his reach, then makes a melee Strike against that creature.</p>", 2);
    assert.deepEqual([slip.then, slip.approach], [{ strike: null }, { strides: 1 }]);
    const trick = action("<p><strong>Requirements</strong> The test parrot is wielding cards or dice</p><hr /><p><strong>Effect</strong> The test parrot performs a quick shuffle with the cards or dice to Feint, then makes a beak Strike against the same target. If the Feint succeeds, the Strike deals an additional 1d4 precision damage.</p>", 2);
    assert.deepEqual(trick.then, { strike: "beak", successDamage: "1d4[precision]" });
    const bully = action("<p>The test brute Shoves a creature, and Strides after it into the nearest adjacent square if successful. It then makes a fist Strike against the creature, using the same multiple attack penalty.</p>", 2);
    assert.deepEqual([bully.resolution.check.statistic, bully.then], ["athletics", { strike: "fist", sameMap: true, follow: true }]);
    const takedown = action("<p>The test zealot attempts an Athletics check to Trip a creature. If she succeeds, she then makes a melee Strike against the target, granting her weapon the fatal d8 trait until the end of her turn. Both attacks count toward her multiple attack penalty, but the penalty doesn't increase until after she makes both attacks.</p>", 2);
    assert.deepEqual(takedown.then, { strike: null, onSuccess: true, sameMap: true, fatal: 8 });
    const swing = action("<p>The test ogre attempts to Demoralize a foe within its melee reach, then makes a melee Strike against that foe. If the creature is Frightened and takes damage, it takes an additional 2d8 damage and is knocked Prone. This counts as two attacks toward the test ogre's multiple attack penalty.</p>", 2);
    assert.deepEqual([swing.resolution.check.statistic, swing.then], ["intimidation", { strike: null, sameMap: true, ifFrightened: { damage: "2d8", prone: true } }]);
});

test("a Strike that shoves or knocks down, Strikes and buffs straight after a spell (2026-10-12, batch 147)", () => {
    const ability = (description, type = "action", actions = 1) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: [] }, description: { value: description } } }, { basicActions: {} });
    const shove = ability("<p>The test thug makes a single Strike with a two-handed melee weapon. If the test thug hits a target that is their size or smaller, that creature is Off-Guard until the end of the test thug's turn, and the test thug can automatically Shove it with the same benefits as the Shove action (including the critical success effect, if the Strike was a critical hit). If the test thug moves to follow the target, that movement doesn't trigger reactions.</p>");
    assert.deepEqual([shove.builtin, shove.onHit.push, shove.onHit.criticalPush, shove.onHit.conditions[0].slug], ["strike-activity", 5, 10, "off-guard"]);
    const knock = ability("<p>A test watchman can dash their foe to the ground with a single blow. They attempt a single melee Strike. If this Strike hits, they also apply the critical success effect of a Trip.</p>", "action", 2);
    assert.deepEqual([knock.onHit.conditions[0].slug, knock.onHit.damage], ["prone", ["1d6[bludgeoning]"]]);
    const residual = ability("<p><strong>Requirements</strong> The test fiend's most recent action was to cast a spell</p><hr /><p><strong>Effect</strong> Glowing sigils trail its claws. The test fiend makes a claw Strike that has a reach of 15 feet and deals 1d6 additional fire damage.</p>");
    assert.deepEqual([residual.requires, residual.strike, residual.onHit.damage], ["after-cast", "claw", ["1d6[fire]"]]);
    const weapon = ability("<p><strong>Frequency</strong> once per turn</p><p><strong>Requirements</strong> the test druid's most recent action was to cast a non-cantrip spell</p><hr /><p><strong>Effect</strong> Until the end of the test druid's next turn, the test druid deals an extra @Damage[1d4[piercing]] damage with her melee Strikes.</p>", "free");
    assert.deepEqual([weapon.builtin, weapon.actions, weapon.damage, weapon.requires, weapon.nonCantrip], ["self-effect", 0, ["1d4[piercing]"], "after-cast", true]);
});

test("a long-limbed Strike that grabs or trips on a hit (2026-10-12, batch 148)", () => {
    const ability = (description) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: 2 }, traits: { value: [] }, description: { value: description } } }, { basicActions: {} });
    // (Made-up wordings; the Battlezoo dragons' own say more, read the same way.)
    const reach = ability("<p>It makes a talon Strike with reach increased by 10 feet (5 feet for a hatchling). On a successful hit, the test drake can immediately attempt an Athletics check to Grapple the target.</p>");
    assert.deepEqual([reach.builtin, reach.strike, reach.onHit.follow, reach.notes], ["strike-activity", "talon", "grapple", ["Its reach is 10 feet longer for this Strike."]]);
    const lash = ability("<p>The test wyrm makes a lash Strike against a creature within 40 feet; on a success, it can also try to Trip it with a +1 circumstance bonus.</p>");
    assert.deepEqual([lash.strike, lash.onHit.follow, lash.notes], ["lash", "trip", ["Its reach is 40 feet for this Strike.", "+1 circumstance bonus to the Trip."]]);
});

test("a turn to water against energy or physical damage, staying up at 1 Hit Point, a lowercase effect in a trigger (2026-10-12, batch 149)", () => {
    const reaction = (text) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: text } } }, { basicActions: {} });
    // (Made-up wordings; two Battlezoo dragons' reactions say the same in their own words.)
    assert.deepEqual(reaction("<p><strong>Trigger</strong> The test eel is the target of an attack or a spell able to deal sonic or physical damage</p><hr /><p><strong>Effect</strong> The test eel goes slick as oil. It gains resistance 7 to sonic and all physical damage against it.</p>"), { builtin: "resist-damage", value: 7, on: ["sonic", "physical"], types: ["sonic", "physical"] });
    assert.deepEqual(reaction("<p><strong>Frequency</strong> once per day</p><p><strong>Trigger</strong> An attack or another effect would bring the test drake down to 0 Hit Points</p><hr /><p><strong>Effect</strong> The test drake grits its fangs. It stays on its feet with 1 Hit Point. It then uses the Test Second Wind ability.</p>"), { builtin: "ferocity", hp: 1, wounded: false, uses: 1 });
});

test("more wordings: a flurry with no Effect label, one roll for two picks, broken legs, a frenzy with no labels, a growl before a Strike, a clot (2026-10-12, batch 150)", () => {
    const ability = (description, type = "action", actions = 1) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: [] }, description: { value: description } } }, { basicActions: {} });
    assert.deepEqual(ability("<p>Frequency once per round. The test monk makes two strikes.</p>"), { builtin: "multi-strike", actions: 1, strikes: [null, null], oncePerTurn: true });
    const picks = ability("<p><strong>Frequency</strong> once per round</p><hr /><p><strong>Effect</strong> The test digger makes two pick Strikes against a creature within reach. The test digger rolls only one attack roll for both Strikes, then compares the result against the creature's AC. The test digger's multiple attack penalty doesn't increase until after both Strikes.</p>");
    assert.deepEqual([picks.sameTarget, picks.sameMap, picks.notes], [true, true, ["One attack roll for both Strikes."]]);
    const legs = ability("<p>The test brute makes a club Strike against an adjacent creature. If it hits, the creature is knocked Prone and becomes Clumsy 1 for 1 minute. As long as this clumsy condition lasts, the creature also takes a –5-foot penalty to its Speeds.</p>", "action", 2);
    assert.deepEqual([legs.onHit.conditions.map((condition) => condition.slug), legs.notes.length], [["prone", "clumsy"], 1]);
    assert.deepEqual(ability("<p>When the test crab is reduced to 0 hit points it can spend this reaction to make a pincer Strike before dying.</p>", "reaction"), { builtin: "death-strike", strike: "pincer" });
    assert.equal(ability("<p><strong>Trigger</strong> A creature targets the test hound with a melee Strike</p><hr /><p><strong>Effect</strong> The test hound Demoralizes the triggering creature and does not take a penalty for not speaking a language. The results of this check occur before resolving the triggering Strike.</p>", "reaction")?.skill, "demoralize");
    assert.deepEqual(ability("<p><strong>Trigger</strong> The test ooze is damaged by a bludgeoning attack</p><hr /><p><strong>Effect</strong> The test ooze hardens around the blow, reducing the damage taken by 3 (to a minimum of 0).</p>", "reaction"), { builtin: "resist-damage", value: 3, on: ["bludgeoning"], types: null, attack: true });
    assert.deepEqual(ability("<p>The test knight Strikes each enemy within his reach. Each attack counts toward his multiple attack penalty, but do not increase his penalty until he has made all his attacks.</p>", "action", 3), { builtin: "multi-strike", actions: 3, strikes: [null], each: true, sameMap: true });
});

test("a Shove at a creature coming into reach, a Stride then a Grapple, a Strike at a frightened creature, a rolling charge that knocks down (2026-10-12, batch 151)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const ability = (description, type = "action", actions = 1) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: [] }, description: { value: description } } }, { basicActions });
    assert.deepEqual(ability("<p><strong>Trigger</strong> A creature ends its movement within reach of the test ox's horn Strike</p><hr /><p><strong>Effect</strong> The test ox attempts to Shove the triggering creature with its horns. The test ox can't Stride after the triggering creature on a success or critical success.</p>", "reaction"), { builtin: "reaction-strike", triggers: ["approach"], strike: null, skill: "shove", penalty: 0, disrupts: false, note: "It can't Stride after the creature." });
    const rush = ability("<p><strong>Frequency</strong> once per round</p><hr /><p><strong>Effect</strong> The test tough strides up to 10 feet and attempts an Athletics check to Grapple a creature.</p>");
    assert.deepEqual([rush.resolution.check.statistic, rush.approach], ["athletics", { strides: 1, feet: 10 }]);
    const shatter = ability("<p><strong>Requirements</strong> A Frightened creature is within melee reach of the test guard</p><hr /><p><strong>Effect</strong> The test guard makes a melee Strike against the frightened creature. If they hit and deal damage, the target becomes Off-Guard as long as it's frightened.</p>");
    assert.deepEqual([shatter.requires, shatter.onHit.conditions[0].slug], ["frightened", "off-guard"]);
    const roll = ability("<p>The test stone Strides twice, and can then make a Strike with its jaws. This jaws Strike gains Knockdown.</p>", "action", 2);
    assert.deepEqual([roll.builtin, roll.strides, roll.onHit.follow], ["strike-activity", 2, "trip"]);
});

test("three thrown Strikes with a critical rider, a flurry with extra fire, Strikes then Demoralize, Quickened after a resistance, a charge with one Stride, bleed after a spell, a riposte in a parry (2026-10-12, batch 152)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const ability = (description, type = "action", actions = 1, traits = []) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: traits }, description: { value: description } } }, { basicActions });
    assert.deepEqual(ability("<p>The test knave makes three ranged dagger Strikes, each against a separate target; he ignores the multiple attack penalty until after making all three Strikes. On a critical hit, the target takes @Damage[2d6[bleed]] damage and is Blinded for 1 round.</p>", "action", 2), { builtin: "multi-strike", actions: 2, strikes: ["dagger", "dagger", "dagger"], sameMap: true, each: true, max: 3, critical: { conditions: [{ slug: "blinded", value: null, rounds: 1 }], damage: ["2d6[bleed]"] } });
    assert.deepEqual(ability("<p>The test monk makes two Strikes with his fist or with a monk weapon. These attacks deal an extra @Damage[1d6[cold]] damage. If both hit the same creature, combine their damage for the purpose of resistances and weaknesses.</p>", "action", 1, ["flourish"]), { builtin: "multi-strike", actions: 1, strikes: ["fist", "fist"], flourish: true, extraDamage: ["1d6[cold]"] });
    assert.deepEqual(ability("<p>The test scarecrow makes two claw Strikes against a single creature, then Demoralizes that creature.</p>", "action", 2), { builtin: "multi-strike", actions: 2, strikes: ["claw", "claw"], sameTarget: true, then: "demoralize" });
    assert.deepEqual(ability("<p><strong>Trigger</strong> The test golem takes electricity damage</p><hr /><p><strong>Effect</strong> The test golem gains resistance 10 to electricity against the triggering attack and becomes Quickened for [[/gmr 1d4 #Quickened Duration]]{1d4 rounds}.</p>", "reaction"), { builtin: "resist-damage", value: 10, on: ["electricity"], types: ["electricity"], quickened: "1d4" });
    assert.deepEqual(ability("<p>The test hunter Strides, ignoring non-magical difficult terrain and uneven ground. If the test hunter ends their movement within melee reach of at least one enemy, they can make a melee Strike against that enemy.</p>", "action", 2), { builtin: "charge", actions: 2, strides: 1, strike: null });
    assert.deepEqual(ability("<p><strong>Frequency</strong> once per round</p><hr /><p><strong>Effect</strong> The test bat Strides using its fly Speed and makes a Strike at the end of that movement.</p>"), { builtin: "charge", actions: 1, strides: 1, strike: null, oncePerTurn: true });
    const touched = ability("<p><strong>Frequency</strong> once per turn</p><p><strong>Requirements</strong> Tessa's most recent action was to cast a non-cantrip spell</p><hr /><p><strong>Effect</strong> Until the end of her next turn, Tessa deals 1d4 bleed damage with her melee Strikes.</p>");
    assert.deepEqual([touched.builtin, touched.damage, touched.melee, touched.requires, touched.nonCantrip], ["self-effect", ["1d4[bleed]"], true, "after-cast", true]);
    assert.deepEqual(ability("<p><strong>Requirements</strong> Tessa is using Test Parry</p><p><strong>Trigger</strong> A creature within Tessa's reach critically fails a Strike against her</p><hr /><p><strong>Effect</strong> Tessa makes a melee Strike against the triggering creature or attempts to Disarm the triggering creature.</p>", "reaction"), { builtin: "reaction-strike", triggers: ["critical-miss"], strike: null, penalty: 0, disrupts: false, note: "Only while it benefits from Test Parry. Or it can Disarm the attacker instead.", requires: "requirement" });
    const shot = ability("<p>The test archer makes a ranged Strike with his crossbow. He must then Stride. If the ranged Strike hits, the target is Off-Guard until the start of the test archer's next turn.</p>", "action", 2);
    assert.deepEqual([shot.builtin, shot.strike, shot.onHit.conditions[0].slug, shot.notes], ["strike-activity", "crossbow", "off-guard", ["He must then Stride."]]);
});

test("Strikes during a flight once a fight, two ranged shots, a Strike for an ally, Strikes that deal no damage, a foe marked for every hit, a weapon after a spell (2026-10-12, batch 153)", () => {
    const ability = (description, type = "action", actions = 2, actor = undefined) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: [] }, description: { value: description } } }, { basicActions: {}, actor });
    const heads = ability("<p><strong>Frequency</strong> once per minute</p><hr /><p><strong>Effect</strong> The test wyvern sweeps through its foes. The test wyvern Flies twice; at any point during this movement, the test wyvern makes up to two tail Strikes, each against a different creature within reach. The test wyvern's multiple attack penalty doesn't increase until all Strikes are made.</p>");
    assert.deepEqual([heads.strikes, heads.each, heads.sameMap, heads.strides, heads.oncePerFight], [["tail", "tail"], true, true, 2, true]);
    assert.deepEqual(ability("<p>The test ghost makes a Strike with its sabre or pistol, then Flies up to half their Speed and makes a Strike with the other attack. If they moved through an enemy when they Flew, that enemy is Off-Guard against the second Strike.</p>").strikes, ["sabre", "pistol"]);
    assert.deepEqual(ability("<p><strong>Requirements</strong> The test hunter is wielding a ranged weapon with reload 0</p><hr /><p><strong>Effect</strong> The test hunter makes two Strikes with the required weapon at a single target. These Strikes both count toward the test hunter's multiple attack penalty, but the penalty doesn't increase until both attacks are resolved.</p>", "action", 1), { builtin: "multi-strike", actions: 1, strikes: ["ranged", "ranged"], sameMap: true, sameTarget: true });
    assert.deepEqual(ability("<p>Tess fires two shots, making two Strikes, each against a separate target and with a -2 penalty. Both attacks count toward its multiple attack penalty, but the penalty doesn't increase until after it makes both attacks.</p>", "action", 1), { builtin: "multi-strike", actions: 1, strikes: ["ranged", "ranged"], sameMap: true, each: true, max: 2, penalty: 2 });
    const feast = ability("<p>The test eel makes a jaws Strike. If it hits, an ally of their choice can spend a reaction to make a jaws Strike against the same target. Allies with fangs or similar attacks can use those instead of jaws.</p>");
    assert.deepEqual([feast.builtin, feast.strike, feast.onHit.allyStrike], ["strike-activity", "jaws", true]);
    const drain = ability("<p>With a touch, the test ghost attempts to drain a living creature's life force. It makes a ghostly hand Strike but deals no damage on a hit.</p><p>Instead, the target becomes Drained 1 for 1 day, and the test ghost regains @Damage[(max(1,floor(@actor.level/2)))[healing]]{HP equal to half its own level}.</p>", "action", 2, { system: { details: { level: { value: 9 } } } });
    assert.deepEqual([drain.noDamage, drain.onHit.conditions[0].slug, drain.onHit.selfHeal], [true, "drained", 4]);
    // (The sheet's own name for the Strike the text calls otherwise: the one that shares a word with it.)
    assert.equal(ability("<p>The test ghost makes a ghostly hand Strike but deals no damage on a hit. Instead, the target is Drained 1 for 1 day and the test ghost regains @Damage[3[healing]] Hit Points.</p>", "action", 2, { system: { details: { level: { value: 4 } } }, items: [{ type: "melee", name: "Ghostly Fist" }, { type: "melee", name: "Wail" }] }).strike, "ghostly fist");
    const pin = ability("<p>Tess makes a dart Strike. If the attack hits, it deals no damage and instead pins the target to an adjacent surface. The target is Immobilized and must spend an Interact action to attempt a DC 10 Athletics check to pull the dart free; it can't move from its space until it succeeds. The target is Off-Guard while it remains immobilized in this way.</p>", "action", 1);
    assert.deepEqual([pin.noDamage, pin.onHit.conditions.map((condition) => condition.slug)], [true, ["immobilized", "off-guard"]]);
    assert.deepEqual(ability("<p>The test marshal marks a foe for judgment, granting the test marshal a +10-foot circumstance bonus to Speed whenever it Strides toward that creature. The test marshal's Strikes against that creature deal an additional 1d8 precision damage.</p>", "action", 1).every, true);
    const divine = ability("<p><strong>Frequency</strong> once per turn</p><p><strong>Trigger</strong> The test priest finishes Casting a Spell using one of their divine spell slots</p><hr /><p><strong>Effect</strong> Until the end of their turn, the test priest's Strikes gain the unholy trait and deal an additional 1d6 spirit damage; this damage increases to 2d6 against creatures with the holy trait.</p>", "free");
    assert.deepEqual([divine.builtin, divine.actions, divine.damage, divine.requires, divine.notes], ["self-effect", 0, ["1d6[spirit]"], "after-cast", ["This damage increases to 2d6 against creatures with the holy trait."]]);
});

test("a stay at 1 HP with a teleport once per mask, a heal that swaps masks, another ability in a cone, a heal in the process, reaction Strikes on new triggers (2026-10-12, batch 154)", () => {
    const ability = (description, type = "action", actions = 1, actor = undefined) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: [] }, description: { value: description } } }, { basicActions: {}, actor });
    const masks = { items: [{ type: "equipment", name: "Test Mask (The Fool)" }, { type: "equipment", name: "Test Mask (The Sage)" }] };
    assert.deepEqual(ability("<p><strong>Trigger</strong> Tess is reduced to 0 Hit Points</p><hr /><p><strong>Effect</strong> Tess retains 1 Hit Point and teleports to an empty space within 20 feet. One of its masks remains behind and is broken.</p>", "reaction", 1, masks), { builtin: "ferocity", hp: 1, wounded: false, note: "It then teleports to an empty space within 20 feet: move its token. One of its masks stays behind, broken.", uses: 2 });
    const swap = ability("<p><strong>Frequency</strong> once per round</p><hr /><p><strong>Effect</strong> Tess removes its current mask and dons a new one. The change refreshes Tess, restoring @Damage[15[healing]] Hit Points. Tess can't don a broken mask.</p><p>When Tess Changes Characters, it gains access to the listed abilities.</p>");
    assert.deepEqual([swap.resolution.kind, swap.notes.length], ["healing", 3]);
    const humors = { type: "action", name: "Test Humors", system: { slug: null, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: [] }, description: { value: "<p>A creature the test hag touches must succeed at a @Check[fortitude|dc:20] save or become Enfeebled 1.</p>" } } };
    const hag = { items: [humors] };
    const miasma = ability("<p>The test hag exhales a sickly fog. Each living creature in a @Template[cone|distance:15] is affected by her test humors (attempting a save as normal).</p><p>She can't use Test Miasma again for [[/gmr 1d4 #Recharge]]{1d4 rounds}.</p>", "action", 2, hag);
    assert.deepEqual([miasma?.resolution?.kind, miasma?.targeting?.area, miasma?.trigger?.recharge?.formula, miasma?.notes], ["save", { type: "cone", value: 15 }, "1d4", ["Only living creatures in the area."]]);
    const abandon = ability("<p><strong>Requirements</strong> The test worm is Inhabiting a Body</p><hr /><p><strong>Effect</strong> The test worm crawls out of the body it is inhabiting, regaining @Damage[8[healing]] Hit Points in the process.</p>", "action", 2);
    assert.equal(abandon?.resolution?.kind, "healing");
    assert.deepEqual(ability("<p><strong>Trigger</strong> A creature within 10 feet deals damage to the test husk</p><hr /><p><strong>Effect</strong> The test husk makes a claw Strike against the triggering creature.</p>", "reaction"), { builtin: "reaction-strike", triggers: ["damaged-adjacent"], strike: "claw", penalty: 0, disrupts: false });
    assert.deepEqual(ability("<p><strong>Trigger</strong> A creature moves from beyond the reach of the test lizard's tail to within the reach of the test lizard's tail</p><hr /><p><strong>Effect</strong> The test lizard makes a tail Strike against the triggering creature and can use Improved Knockdown if the attack hits, even if it isn't the test lizard's turn.</p>", "reaction").note, "If it hits, it can use Improved Knockdown even on another creature's turn.");
});

test("while its rage lasts: a charge into a sweep, extra fire on its Strikes; a resistance that lashes back (2026-10-12, batch 155)", () => {
    const ability = (description, type = "action", actions = 2) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: [] }, description: { value: description } } }, { basicActions: {} });
    // (Made-up wordings; the Battlezoo dragons' own say more, read the same way.)
    const charge = ability("<p><strong>Requirements</strong> The test drake is enraged</p><hr /><p><strong>Effect</strong> The test drake Strides up to its Speed and then makes a talon Strike against every creature in its reach once it stops. Its multiple attack penalty doesn't increase until after all the attacks. These Strikes don't set off its Draconic Momentum.</p>");
    assert.deepEqual([charge.builtin, charge.strikes, charge.each, charge.sameMap, charge.strides, charge.requires, charge.noMomentum], ["multi-strike", ["talon"], true, true, 1, "raging", true]);
    const fire = ability("<p><strong>Requirements</strong> The test drake is enraged</p><hr /><p><strong>Effect</strong> All of the test drake's melee unarmed attacks deal an extra 1d4 cold damage until the test drake's rage ends.</p>");
    assert.deepEqual([fire.builtin, fire.damage, fire.melee, fire.requires, fire.duration.unit], ["self-effect", ["1d4[cold]"], true, "raging", "unlimited"]);
    const lash = ability("<p><strong>Trigger</strong> A foe within 5 feet is about to damage the test drake with physical damage</p><hr /><p><strong>Effect</strong> The test drake gains resistance 5 to physical damage against the incoming damage. In addition, it attacks the triggering foe with a +12 modifier. On a hit, the attacker takes the resisted damage back.</p>", "reaction");
    assert.deepEqual([lash.builtin, lash.value, lash.on, lash.foe, lash.lashBack], ["resist-damage", 5, ["physical"], true, { bonus: 12 }]);
});

test("Strikes along two Strides, six tentacles, short ranges, a Strike then a Shove, a charge with Improved Knockdown, a Feint and a Step, a Demoralize after a Step, short Steps, Reactive Strike behind a state, a Trip with its own bonus (2026-10-12, batch 156)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const ability = (description, type = "action", actions = 2) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: [] }, description: { value: description } } }, { basicActions });
    assert.deepEqual(ability("<p>Tess Strides twice and makes two staff Strikes at any point along its movement.</p>"), { builtin: "multi-strike", actions: 2, strikes: ["staff", "staff"], notes: ["It Strides twice, making the Strikes at any point along the way."], strides: 2 });
    assert.deepEqual(ability("<p>The test kraken attacks with its tentacles six times.</p>", "action", 3).strikes.length, 6);
    assert.deepEqual(ability("<p>The test dancer makes three spear Strikes, each with a range of 10 feet.</p>").notes, ["Each Strike has a range of 10 feet."]);
    const blow = ability("<p>The test guard Strikes an adjacent creature, then Shoves the same creature.</p>", "action", 1);
    assert.deepEqual([blow.builtin, blow.afterStrike], ["strike-activity", "shove"]);
    const ram = ability("<p>The test ram Strides up to two times, then makes a horn Strike with Improved Knockdown.</p>");
    assert.deepEqual([ram.builtin, ram.strides, ram.strike, ram.onHit.follow], ["strike-activity", 2, "horn", "trip"]);
    const feint = ability("<p>The test rebel Feints, Steps, and Strikes in any order.</p>");
    assert.deepEqual([feint.resolution.check.statistic, feint.then], ["deception", { strike: null }]);
    assert.equal(ability("<p>The test sage Steps or Feints, then Demoralizes.</p>", "action", 1).resolution.check.statistic, "intimidation");
    assert.deepEqual(ability("<p><strong>Frequency</strong> once per round</p><hr /><p><strong>Effect</strong> The test ant Steps, moving up to 15 feet.</p>", "action", 1), { builtin: "safe-move", actions: 1, oncePerTurn: true });
    assert.deepEqual(ability("<p>As Reactive Strike, but the test snake can use this reaction only if it's Coiled.</p>", "reaction"), { builtin: "reactive-strike", requires: "requirement", note: "The test snake can use this reaction only if it's Coiled." });
    const trip = ability("<p>The test haunt attempts to Trip a living creature within 60 feet with a bonus of [[/r 1d20+7]]{+7}.</p>", "action", 1);
    assert.deepEqual([trip.resolution.check.modifier, trip.targeting.range, trip.notes], [7, "60 feet", ["Only a living creature."]]);
});

test("aimed shots, a deep wound, damage three times, a push its size or smaller, a far reach, a Strike from afar, a Strike with the GM's armor rule, two at one creature with a Stride between, a sweep in its own words, a Feint with a ranged rider, a Grapple with Deception (2026-10-12, batch 156)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const ability = (description, actions = 2, actor = undefined) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: description } } }, { basicActions, actor });
    const unfair = ability("<p>The test lord lines up a shot and then attempts a ranged Strike against a hunted prey. On this strike, he treats the target as if they were Off-Guard.</p>");
    assert.deepEqual([unfair.strike, unfair.offGuard, unfair.notes], ["ranged", true, ["Only at its hunted prey."]]);
    assert.deepEqual(ability("<p>The test sniper makes a Strike with their musket, gaining a +2 circumstance bonus to this Strike's attack roll and ignoring the target's concealment.</p>").attackBonus, 2);
    assert.deepEqual(ability("<p>The test raider makes a melee dagger Strike and twists the blade, dealing an extra @Damage[2d4[persistent,bleed]] damage on a hit (4d4 on a critical hit).</p>", 1).onHit.damage, ["2d4[persistent,bleed]"]);
    assert.equal(ability("<p>Tess Strikes with her whip. On a hit, she rolls damage three times. This damage is combined (for resistances).</p>", 1).damageTimes, 3);
    const sweep = ability("<p>The test brute makes a melee greataxe Strike. If he hits a creature of his size or smaller, he can move it 5 feet in any direction, or 10 feet on a critical hit.</p>", 1, { system: { traits: { size: { value: "lg" } } }, items: [] });
    assert.deepEqual([sweep.onHit.push, sweep.onHit.criticalPush, sweep.onHit.size], [5, 10, "large"]);
    assert.deepEqual(ability("<p>The test monk makes a fist Strike against a creature within 15 feet.</p>").notes, ["Its reach is 15 feet for this Strike."]);
    assert.deepEqual(ability("<p>The test beast makes a claw Strike against a creature wearing stone or metal armor. If the Strike hits and the armor's Hardness is 10 or lower, that armor is broken.</p>").notes, ["If the Strike hits and the armor's Hardness is 10 or lower, that armor is broken."]);
    assert.deepEqual(ability("<p>The test wolf makes a jaws Strike against a creature within range. The test wolf can then Stride and make a second jaws Strike against the same creature.</p>"), { builtin: "multi-strike", actions: 2, strikes: ["jaws", "jaws"], sameTarget: true, notes: ["It can Stride between the two Strikes."] });
    assert.deepEqual(ability("<p>Tess Strikes all creatures within her reach with a glaive Strike. Her multiple attack penalty doesn't increase until the end of this activity.</p>", 3), { builtin: "multi-strike", actions: 3, strikes: ["glaive"], each: true, sameMap: true });
    const feint = ability("<p>The test pirate Feints. If the target becomes Off-Guard to the test pirate's melee attacks, it becomes off-guard to the test pirate's ranged attacks as well.</p>", 1);
    assert.deepEqual([feint.resolution.check.statistic, feint.notes], ["deception", ["A target off-guard to its melee attacks is off-guard to its ranged attacks too."]]);
    const grab = ability("<p>The test seer attempts to [[/act grapple skill=deception]] a creature using Deception instead of Athletics. If the creature is willing, she grapples it automatically.</p>", 1);
    assert.deepEqual([grab.resolution.check.statistic, grab.notes], ["deception", ["It rolls Deception for the check.", "A willing creature is grabbed without a check."]]);
});

test("a screech on the move, a thrown Strike then a teleport and a melee one, a Disarm behind a raised cloak, an unlabeled AC reaction, a teleport twice a day (2026-10-12, batch 157)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const item = (description, type = "action", actions = 2, extra = {}) => ({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: [] }, description: { value: description } }, ...extra });
    const ability = (description, type, actions, actor) => compileMonsterAbility(item(description, type, actions), { basicActions, actor });
    const screech = { ...item("<p>The test bird lets out a shriek. Each creature in an @Template[emanation|distance:30] must attempt a @Check[will|dc:18] save.</p><hr /><p><strong>Success</strong> The creature is Frightened 1.</p><p><strong>Failure</strong> The creature is Frightened 2.</p>", "action", 1), name: "Test Shriek" };
    const advance = ability("<p>The test bird makes a Test Shriek and Strides twice. All creatures within 30 feet of the test bird at any point during this movement are subjected to the effects of Test Shriek.</p>", "action", 2, { items: [screech] });
    assert.deepEqual([advance?.resolution?.kind, advance?.activation?.time, advance?.notes?.at(-1)], ["save", "2", "It Strides twice: every creature within the area at any point of the move is affected (target them all)."]);
    assert.deepEqual(ability("<p>The test wind hurls a bolt. It makes a ranged bolt Strike against a creature within its first range increment, teleports to the creature's location as a gust of wind, then grasps the thrown bolt and makes a melee bolt Strike against a creature within reach. Its multiple attack penalty doesn't increase until it has made both attacks.</p>"), { builtin: "multi-strike", actions: 2, strikes: ["bolt", "bolt"], sameMap: true, notes: ["It teleports to the first target's location between the two Strikes."] });
    assert.deepEqual(ability("<p><strong>Requirements</strong> The test monk has their cloak raised</p><p><strong>Trigger</strong> The test monk is attacked by a melee weapon</p><hr /><p><strong>Effect</strong> After the attack's result is resolved, the test monk attempts to Disarm the triggering weapon, gaining a +1 circumstance bonus. The cloak is destroyed after this action.</p>", "reaction"), { builtin: "reaction-strike", triggers: ["attacked"], strike: null, skill: "disarm", penalty: 0, bonus: 1, disrupts: false, uses: 1, requires: "requirement", note: "Only when: the test monk has their cloak raised." });
    const veil = compileMonsterAbility({ ...item("<p>If the test priest is targeted by a melee attack, they can use their reaction to gain a +2 circumstance bonus to AC against the triggering attack.</p>", "reaction"), system: { ...item("", "reaction").system, description: { value: "<p>If the test priest is targeted by a melee attack, they can use their reaction to gain a +2 circumstance bonus to AC against the triggering attack.</p>" }, rules: [{ key: "FlatModifier", selector: "ac", value: 2 }] } }, { basicActions });
    assert.deepEqual(veil, { builtin: "ac-reaction", value: 2, when: "targeted", against: "melee" });
    assert.deepEqual(ability("<p><strong>Frequency</strong> twice per day</p><hr /><p><strong>Effect</strong> Tess steps through a fold in space, instantly teleporting to a space within 60 feet that she can see.</p>", "action", 1), { builtin: "safe-move", actions: 1 });
});

test("a stance for the fight and a guard only in it, AC and Reflex while spinning, a leap with an AC reaction (2026-10-12, batch 158)", () => {
    const ability = (description, type = "action", rules = []) => compileMonsterAbility({ type: "action", name: type === "action" ? "Test Stance" : "Test Leap", system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? 1 : null }, traits: { value: [] }, description: { value: description }, rules } }, { basicActions: {} });
    const stance = ability("<p><strong>Requirements</strong> Tess is unarmored and touching the ground</p><hr /><p><strong>Effect</strong> Tess enters the stance of a rooted oak until she is knocked out or the encounter ends. She gains a +3 status bonus to AC. Her Speed is reduced by 5 feet.</p>");
    assert.deepEqual([stance.stance, stance.model.modifiers, stance.notes], [true, [{ on: "ac", type: "status", value: 3 }], ["Its Speed is 5 feet lower."]]);
    const strong = ability("<p><strong>Requirements</strong> Tess is in Oak Stance</p><hr /><p><strong>Effect</strong> Tess gains a +2 circumstance bonus to AC until the beginning of her next turn.</p>");
    assert.deepEqual([strong.requiresEffect, strong.model.modifiers[0].value], ["Oak Stance", 2]);
    const spin = ability("<p>Tess whirls her chains in all directions, giving her a +1 circumstance bonus to her AC and Reflex saves until the start of her next turn. If she uses Reactive Strike while this ability is active, she adds 1d8 to her damage.</p>");
    assert.deepEqual([spin.model.modifiers.map((modifier) => modifier.on), spin.notes], [["ac", "reflex"], ["While it lasts, its Reactive Strike deals 1d8 more damage."]]);
    const leap = ability("<p><strong>Trigger</strong> Tess is targeted with a ranged attack Tess Leaps up to 20 feet horizontally, and she gains a +2 circumstance bonus to AC against the triggering attack.</p>", "reaction");
    assert.deepEqual([leap.builtin, leap.against, leap.notes?.length], ["ac-reaction", "ranged", 1]);
});

test("area saves in other words, a Strike that pushes and then knocks Prone (2026-10-12, batch 159)", () => {
    const ability = (description, actions = 2) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: description } } }, { basicActions: {} });
    const stomp = ability("<p>The test giant stamps the ground, causing all creatures within @Template[emanation|distance:15]{15 feet} to fall Prone (@Check[reflex|dc:20] save negates).</p>");
    assert.deepEqual([stomp.resolution.kind, stomp.targeting.area, stomp.resolution.outcomes.failure.effects[0].slug], ["save", { type: "emanation", value: 15 }, "prone"]);
    const choke = ability("<p>The test husk breathes out rot that targets all living creatures within a @Template[emanation|distance:20]. Creatures in this area that fail a @Check[fortitude|dc:24] save become Sickened 1 (Sickened 2 on a critical failure).</p>");
    assert.deepEqual([choke.resolution.outcomes.failure.effects[0].slug, choke.resolution.outcomes.criticalFailure.effects[0].value], ["sickened", 2]);
    const strike = ability("<p>The test brute makes a melee Strike and, if the attack hits, it can push the creature back 5 feet (10 feet on a critical hit). The target must succeed at a @Check[fortitude|dc:21] save or be knocked Prone by this attack.</p>");
    assert.deepEqual([strike.builtin, strike.onHit.push, strike.onHit.criticalPush, strike.onHit.save.resolution.check.statistic], ["strike-activity", 5, 10, "fortitude"]);
});

test("a betraying touch with another ability's save, a secret pried loose (2026-10-12, batch 160)", () => {
    const item = (name, description, actions = 1) => ({ type: "action", name, system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: description } } });
    const humors = item("Test Humors", "<p>A creature the test hag touches must succeed at a @Check[fortitude|dc:20] save or become Enfeebled 1.</p>");
    const touch = compileMonsterAbility(item("Test Betrayal", "<p>The test hag touches a creature that doesn't realize she is an enemy. The betrayed creature is affected by her test humors and takes a -4 circumstance penalty to their saving throw against that effect.</p>"), { basicActions: {}, actor: { items: [humors] } });
    assert.deepEqual([touch.resolution.check.against.value, touch.requires, touch.targeting.range], [24, "requirement", "touch"]);
    const secret = compileMonsterAbility(item("Test Secret", "<p>The test drake delves into the mind of a creature within 30 feet, learning something they'd find embarrassing or shameful unless they succeed at a @Check[will|dc:25] save. The target becomes Frightened 1 and cannot reduce their frightened condition for 1 minute or until the test drake reveals the secret.</p>", 2), { basicActions: {} });
    assert.deepEqual([secret.resolution.check.statistic, secret.resolution.outcomes.failure.effects[0].slug, secret.notes], ["will", "frightened", ["It can't reduce that Frightened for 1 minute (or until the secret is revealed)."]]);
});

test("Fling: the creature it holds falls and is let go (2026-10-12, batch 160)", () => {
    const fling = compileMonsterAbility({ type: "action", name: "Test Fling", system: { slug: null, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: [] }, description: { value: "<p>The test mantis flings a Grabbed creature into the air, up to 14 feet overhead and some distance from the test mantis (the creature takes damage from the fall as normal). If the flung creature lands on another creature, the creature it lands on takes the same amount of bludgeoning damage with a @Check[reflex|dc:22|basic] save.</p>" } } }, { basicActions: {} });
    assert.deepEqual([fling.targeting.grabbed, fling.resolution.outcomes.success.damage.formulas, fling.resolution.outcomes.success.effects.map((effect) => effect.slug ?? effect.slugs?.join(","))], [true, [{ formula: "7[bludgeoning]" }], ["grabbed,restrained", "prone"]]);
    assert.equal(fling.notes[1], "A creature it lands on takes the same bludgeoning damage (DC 22 basic Reflex save).");
});

test("healing itself or an ally it touches, with the hour after a note (2026-10-12, batch 161)", () => {
    const plan = compileMonsterAbility({ type: "action", name: "Test Salve", system: { slug: null, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: [] }, description: { value: "<p><strong>Requirements</strong> The test dero is wearing a salve kit and has a hand free</p><hr /><p><strong>Effect</strong> The test dero smears a stinging salve on a wound, healing themself or an ally in reach for @Damage[(1d8+4)[healing]] Hit Points. For 1 hour, the target has fire weakness 3 and is immune to Test Salve.</p>" } } }, { basicActions: {} });
    assert.deepEqual([plan.resolution.kind, plan.resolution.native.healing.components[0].formula, plan.targeting.range, plan.notes.length], ["healing", "1d8+4", "touch", 1]);
});

test("a breath of two ways written as dashed paragraphs, a condition that lasts a minute (2026-10-12, batch 162)", () => {
    const html = "<p>The test golem breathes in one of two ways, then can't use Breath Weapon again for [[/gmr 1d4 #Recharge Breath Weapon]]{1d4 rounds}.</p><p>- Scald (fire) A gout of steam deals @Damage[6d6[fire]|options:area-damage] damage to all creatures in a @Template[cone|distance:30] (@Check[reflex|dc:25|basic|options:area-effect] save).</p><p>- Dulling Haze (mental) A cloud of grey haze forces each creature in a @Template[cone|distance:30] to attempt a @Check[will|dc:25] save; the effect lasts 1 minute.</p><hr /><p><strong>Critical Success</strong> The creature is unaffected.</p><p><strong>Success</strong> The creature is Stupefied 1.</p><p><strong>Failure</strong> The creature is Stupefied 2.</p><p><strong>Critical Failure</strong> The creature is Stupefied 3.</p>";
    const plan = compileMonsterAbility({ type: "action", name: "Breath Weapon", system: { slug: null, actionType: { value: "action" }, actions: { value: 2 }, traits: { value: [] }, description: { value: html } } }, { basicActions: {} });
    assert.deepEqual(plan.modes.map((mode) => mode.name), ["Scald", "Dulling Haze"]);
    assert.deepEqual([plan.modes[0].plan.resolution.check.basic, plan.modes[1].plan.resolution.outcomes.failure.effects[0].duration], [true, { mode: "fixed", value: 1, unit: "minutes" }]);
});

test("a storm of thrown objects: a Strike at each creature around it, or one at a single target (2026-10-12, batch 163)", () => {
    const plan = compileMonsterAbility({ type: "action", name: "Test Storm", system: { slug: null, actionType: { value: "action" }, actions: { value: 2 }, traits: { value: [] }, description: { value: "<p>The test haunt hurls a whirl of cutlery, either spreading them out among multiple foes or directing them at one target.</p><ul><li>When this effect is spread out among multiple foes, the test haunt makes a flung fork Strike at a -2 penalty against each creature within @Template[emanation|distance:20]{20 feet}. These count as one attack for the test haunt's multiple attack penalty, and the penalty doesn't increase until after all the attacks.</li><li>When this effect has only one target, the test haunt makes a flung fork Strike against the target, and the damage increases to 3d10+4. It deals @Damage[1d10[untyped]] damage on a failure, and no damage on a critical failure.</li></ul>" } } }, { basicActions: {} });
    assert.deepEqual([plan.builtin, plan.strikes, plan.each, plan.penalty, plan.countsAs, plan.notes[1]], ["multi-strike", ["flung fork"], true, 2, 1, "Or one Strike at a single target: its damage is 3d10+4, and 1d10 on a failure."]);
});

test("marks: deadly on its Strikes against the mark, or a first hit's precision dice (2026-10-12, batch 164)", () => {
    const ability = (description) => compileMonsterAbility({ type: "action", name: "Test Mark", system: { slug: null, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: [] }, description: { value: description } } }, { basicActions: {} });
    assert.deepEqual(ability("<p>The test killer designates a single creature they can see and hear as their mark. This effect lasts until the mark dies or the test killer uses Test Mark again. The test killer gains a +2 circumstance bonus to Perception checks to Seek the mark. The test killer's melee and ranged Strikes gain the deadly d6 weapon traits when attacking the mark.</p>"), { builtin: "hunt-prey", edge: "deadly", strike: null, die: 6, notes: ["+2 circumstance bonus to Perception checks to Seek its mark (and to Feint against it, when it says so)."] });
    assert.deepEqual(ability("<p>The test headsman marks a single creature they can see for death. The first time each round the test headsman Strikes that creature, the Strike deals an extra 1d10 precision damage.</p><p>The creature remains marked for death until the test headsman is knocked out.</p>"), { builtin: "hunt-prey", edge: "precision", dice: 1, die: 10 });
});

test("a check of its own compared with every creature sharing its space (2026-10-12, batch 165)", () => {
    const plan = compileMonsterAbility({ type: "action", name: "Test Grind", system: { slug: null, actionType: { value: "action" }, actions: { value: 2 }, traits: { value: [] }, description: { value: "<p>The test gravel swarm attempts an @Check[athletics] check and compares the result to the Reflex DC of each creature in its space. This counts as two attacks for the test gravel swarm's multiple attack penalty.</p><hr /><p><strong>Critical Success</strong> The creature falls Prone and takes @Damage[2d4[bludgeoning]] damage.</p><p><strong>Success</strong> The creature falls Prone.</p>" } } }, { basicActions: {} });
    assert.deepEqual([plan.resolution.check.statistic, plan.resolution.check.against.statistic, plan.targeting.target, plan.notes.length], ["athletics", "reflex", "every creature sharing its space", 2]);
});

test("extra precision damage on its next attack only (2026-10-12, batch 166)", () => {
    const plan = compileMonsterAbility({ type: "action", name: "Test Trick", system: { slug: null, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: [] }, description: { value: "<p>The test rogue picks one of their weapons. The next attack with that weapon deals an extra 1d8 precision damage. In addition, the test rogue can Interact to draw the weapon.</p>" } } }, { basicActions: {} });
    assert.deepEqual([plan.builtin, plan.damage, plan.nextStrike, plan.notes[0]], ["self-effect", ["1d8[precision]"], true, "Only its next attack with that weapon (this turn): remove the effect after it."]);
});

test("Attack of Opportunity granted to its allies of a trait in an emanation (2026-10-12, batch 167)", () => {
    const plan = compileMonsterAbility({ type: "action", name: "Test Direction", system: { slug: null, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: ["auditory"] }, description: { value: "<p>Each ghoul ally in a @Template[emanation|distance:20] gains the Attack of Opportunity reaction until the end of their next turn.</p>" } } }, { basicActions: {} });
    assert.deepEqual([plan.builtin, plan.actions, plan.within, plan.trait], ["grant-aoo", 1, 20, "ghoul"]);
});

test("a skill check as it or its allies save, the higher result kept (2026-10-12, batch 168)", () => {
    const compile = (text) => compileMonsterAbility({ type: "action", name: "Test Hum", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: ["auditory"] }, description: { value: `<p>${text}</p>` } } }, { basicActions: {} });
    const allies = compile("<strong>Trigger</strong> The test toad or one of its allies within 30 feet attempts a saving throw against a sonic or visual effect. <strong>Effect</strong> The toad hums loudly. It rolls a @Check[performance] check. It and toad allies in the area can use the higher result of the toad's Performance check or their saves to resolve the effects against that effect.");
    assert.deepEqual([allies.builtin, allies.skill, allies.against, allies.ally, allies.within, allies.allyTrait], ["save-skill", "performance", ["sonic", "visual"], true, 30, "toad"]);
    const own = compile("<strong>Trigger</strong> Test Singer attempts a Fortitude saving throw <strong>Effect</strong> Test Singer hums. She rolls a @Check[performance] check. She can use the higher result between her Performance check and her Fortitude saving throw to resolve the effects against the attack that triggered her Fortitude saving throw.");
    assert.deepEqual([own.builtin, own.save, own.ally], ["save-skill", "fortitude", undefined]);
});

test("a success instead of rolling, once a day: its failed save made a success (2026-10-12, batch 169)", () => {
    const plan = compileMonsterAbility({ type: "action", name: "Test Insight", system: { slug: null, actionType: { value: "free" }, actions: { value: null }, traits: { value: ["divination"] }, description: { value: "<p><strong>Frequency</strong> once per day</p><p><strong>Trigger</strong> The test seer is about to roll a d20.</p><hr /><p><strong>Effect</strong> The test seer glimpses what is to come. It gets a success (but not a critical success) instead of rolling.</p>" } } }, { basicActions: {} });
    assert.deepEqual([plan.builtin, plan.toSuccess, plan.uses, plan.free], ["save-boost", true, 1, true]);
});

test("a circumstance bonus to its allies' initiative as it rolls Perception (2026-10-12, batch 170)", () => {
    const compile = (type, html) => compileMonsterAbility({ type: "action", name: "Test Warning", system: { slug: null, actionType: { value: type }, actions: { value: null }, traits: { value: [] }, description: { value: html } } }, { basicActions: {} });
    const reaction = compile("reaction", "<p><strong>Trigger</strong> The test lookout is about to roll a Perception or Survival check to determine its initiative</p><hr /><p><strong>Effect</strong> The lookout whistles to warn allies, granting them a +2 circumstance bonus to their initiative rolls. This bonus increases to +3 if the lookout was Scouting. Depending on how the lookout warns allies, this action has the auditory or visual trait.</p>");
    assert.deepEqual([reaction.builtin, reaction.value, reaction.skills, reaction.free, reaction.notes], ["initiative-warning", 2, ["perception", "survival"], undefined, ["The bonus increases to +3 if the lookout was Scouting (the GM's)."]]);
    const passive = compile("passive", "<p>When Test Lookout is about to roll a Perception check for initiative, she can alert her allies as a free action. Test Lookout visually or audibly warns allies, granting them a +1 circumstance bonus to their initiative rolls.</p>");
    assert.deepEqual([passive.builtin, passive.value, passive.free], ["initiative-warning", 1, true]);
});

test("a Strike that misses it sent at a creature beside it (2026-10-12, batch 171)", () => {
    const compile = (effect) => compileMonsterAbility({ type: "action", name: "Test Sidestep", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: `<p><strong>Trigger</strong> A Strike targeting the test duelist fails or critically fails</p><hr /><p><strong>Effect</strong> ${effect}</p>` } } }, { basicActions: {} });
    assert.deepEqual(compile("The duelist twirls aside. The duelist redirects the attack to a creature of her choice that is adjacent to her and within reach of the triggering attack. The attacker rerolls the Strike's attack roll against the new target."), { builtin: "redirect-attack" });
    assert.deepEqual(compile("The duelist can choose to either Step or redirect the attack to a creature that is adjacent to her and within the reach of the triggering attack. The attacker rerolls the Strike's attack roll against the new target."), { builtin: "redirect-attack", step: true });
});

test("more ways to move and Strike: a tackle, a toss, a hop, a skewer, a lurch (2026-10-12, batch 172)", () => {
    const compile = (actions, text) => compileMonsterAbility({ type: "action", name: "Test Move", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: `<p>${text}</p>` } } }, { basicActions: {} });
    const tackle = compile(2, "The test golem Strides up to twice its Speed in a straight line. If it ends this movement in reach of a creature, it makes a fist Strike against that creature. On a hit or critical hit, the target takes an additional @Damage[1d4[bludgeoning]] damage and is knocked Prone.");
    assert.deepEqual([tackle.builtin, tackle.strides, tackle.strike, tackle.onHit.damage, tackle.onHit.conditions.map((entry) => entry.slug)], ["strike-activity", 2, "fist", ["1d4[bludgeoning]"], ["prone"]]);
    const toss = compile(2, "The test ram Strides and makes a horn Strike. If the Strike hits, the target is flung 15 feet in a direction of the test ram's choice.");
    assert.deepEqual([toss.onHit.push, toss.notes], [15, ["The target is flung 15 feet in a direction of its choice."]]);
    const hop = compile(2, "The test toad Leaps 10 feet and makes one tongue Strike at any point during that movement, dealing an additional @Damage[1d4[acid]] damage.");
    assert.deepEqual([hop.strides, hop.strike, hop.onHit.damage], [1, "tongue", ["1d4[acid]"]]);
    const skewer = compile(2, "The test hunter Strides, then makes two javelin Strikes, one with each of the two javelins they wield. Both Strikes must have the same target. Apply the test hunter's multiple attack penalty to each Strike normally.");
    assert.deepEqual([skewer.builtin, skewer.strikes, skewer.sameTarget, skewer.strides], ["multi-strike", ["javelin", "javelin"], true, 1]);
    const lurch = compile(2, "The test lizard Strides twice and then makes a jaws Strike. If it moves at least 20 feet from where it started, it gets a +1 circumstance bonus on the attack roll.");
    assert.deepEqual([lurch.builtin, lurch.strides, lurch.attackBonus], ["charge", 2, 1]);
    const pounce = compile(1, "The test cat Strides and makes a Strike at the end of that movement. If the test cat successfully used [[/act hide]] before this action, the target has the Off-Guard condition against this Strike.");
    assert.deepEqual([pounce.builtin, pounce.strides], ["charge", 1]);
});

test("ranged Strike activities: a throw that knocks down, a draw after, a bounce back, an aimed shot (2026-10-12, batch 173)", () => {
    const compile = (actions, html) => compileMonsterAbility({ type: "action", name: "Test Shot", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: html } } }, { basicActions: {} });
    const thrown = compile(2, "<p>The test hunter makes a ranged strike with their spear within 40 feet without ranged penalties. If the strike hits, it has enough force to knock the target Prone. If the strike was a critical success, the target is also Immobilized by the spear.</p>");
    assert.deepEqual([thrown.strike, thrown.onHit.conditions.map((entry) => entry.slug), thrown.onHit.critical.map((entry) => entry.slug), thrown.notes], ["spear", ["prone"], ["prone", "immobilized"], ["Within 40 feet, without range penalties."]]);
    const drawn = compile(1, "<p>The test scout makes a ranged Strike with their javelin and then draws their shortsword.</p>");
    assert.deepEqual([drawn.strike, drawn.notes], ["javelin", ["Then it draws its shortsword (an Interact)."]]);
    const bounce = compile(1, "<p>The test frog makes a ranged Strike with their boomerang against a target within 20 feet. Once the Strike is complete, the boomerang ricochets back into the test frog's hand. If their hands are full when the boomerang returns, it falls to the ground in their space.</p>");
    assert.deepEqual([bounce.strike, bounce.notes], ["boomerang", ["The boomerang comes back to its hand after the Strike (or falls in its space if its hands are full)."]]);
    const aimed = compile(1, "<p><strong>Requirements</strong> Test Archer hasn't attempted a Strike during his turn yet</p><hr /><p><strong>Effect</strong> Test Archer makes a ranged Strike against his target at a –1 penalty. He gains a +3 circumstance bonus to damage on that Strike.</p>");
    assert.deepEqual([aimed.attackBonus, aimed.damageBonus, aimed.requires], [-1, 3, "first-attack"]);
});

test("multi-Strikes and one-roll swipes in more words; a heavy swing; a missing stop (2026-10-12, batch 174)", () => {
    const compile = (actions, html) => compileMonsterAbility({ type: "action", name: "Test Flurry", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: html } } }, { basicActions: {} });
    const bites = compile(2, "<p>The test hound makes three Strikes with its fangs attack. Each Strike must be against a different opponent within its reach. Each attack counts toward the test hound's multiple attack penalty, but does not increase its penalty until it has made all the attacks.</p>");
    assert.deepEqual([bites.strikes, bites.each, bites.max, bites.sameMap], [["fangs", "fangs", "fangs"], true, 3, true]);
    const whip = compile(2, "<p>The test tree makes three vine Strikes against different targets, increasing its reach to 15 feet for these Strikes. These attacks count toward its multiple attack penalty, but this penalty doesn't increase until after all three attacks.</p>");
    assert.deepEqual([whip.strikes.length, whip.each, whip.sameMap], [3, true, true]);
    const focus = compile(2, "<p>The test brute makes two Strikes with its fist against one foe. The multiple attack penalty doesn't increase until after both attacks are resolved. The test brute doesn't use this ability if there is more than one creature within its reach that it can see.</p>");
    assert.deepEqual([focus.strikes, focus.sameTarget, focus.notes], [["fist", "fist"], true, ["Only while it can see no more than one creature in its reach."]]);
    const swing = compile(2, "<p>The test knight makes a melee Strike with a +2 circumstance bonus to the attack roll and compares the roll to the AC of up to two foes that are in reach and adjacent to each other. The test knight rolls damage only once and applies it to each creature they hit. This counts as two attacks toward their multiple attack penalty.</p>");
    assert.deepEqual([swing.max, swing.penalty, swing.notes], [2, -2, ["A +2 circumstance bonus to the attack roll."]]);
    const chomp = compile(1, "<p>The test croc makes a jaws Strike targeting two creatures adjacent to each other. Roll the attack and damage once, and apply it to each creature separately. A Test Chomp counts as two attacks for the multiple attack penalty.</p>");
    assert.deepEqual([chomp.strikes, chomp.max], [["jaws"], 2]);
    const heavy = compile(2, "<p>The test brute Strikes with their maul, dealing 2d12+10 bludgeoning damage plus 1d4 persistent bleed. This counts as two attacks when calculating their multiple attack penalty.</p>");
    assert.deepEqual([heavy.builtin, heavy.strike, heavy.damage, heavy.onHit.damage, heavy.countsAs], ["strike-activity", "maul", "(2d12+10)[bludgeoning]", ["1d4[persistent,bleed]"], 2]);
    const blade = compile(1, "<p><strong>Frequency</strong> once per round</p><hr /><p><strong>Effect</strong> The test thief draws a weapon and then Strikes with it The target of the Strike is Off-Guard against the attack.</p>");
    assert.deepEqual([blade.builtin, blade.offGuard], ["strike-activity", true]);
});

test("two Strikes with a Stride between, at its prey, a fast sweep (2026-10-12, batch 175)", () => {
    const compile = (actions, html) => compileMonsterAbility({ type: "action", name: "Test Pair", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: html } } }, { basicActions: {} });
    const dance = compile(2, "<p>Test Duelist makes a Strike against a creature, then Strides. This Stride doesn't trigger reactions. If she ends this Stride in a different space adjacent to the same creature, she makes another Strike against it. If both Strikes succeed, the creature is Off-Guard until the start of Test Duelist's next turn. Each attack counts against Test Duelist's multiple attack penalty, but the penalty doesn't increase until she's made both attacks.</p>");
    assert.deepEqual([dance.strikes.length, dance.sameTarget, dance.sameMap, dance.bothHit.conditions], [2, true, true, [{ slug: "off-guard", value: null, rounds: 1 }]]);
    const wound = compile(1, "<p><strong>Frequency</strong> once per round</p><p><strong>Prerequisites</strong> The test tracker is wielding a ranged weapon with a reload of 0</p><hr /><p><strong>Effect</strong> The test tracker makes two ranged Strikes against their prey. If both hit and deal damage, the target takes an additional @Damage[1d6[bleed]].</p>");
    assert.deepEqual([wound.oncePerTurn, wound.bothHit.damage, wound.notes], [true, ["1d6[bleed]"], ["Only at its prey."]]);
    const sweep = compile(1, "<p><strong>Frequency</strong> once per turn</p><hr /><p><strong>Effect</strong> The test marlin makes two snout Strikes against two adjacent targets, with a +2 circumstance bonus to its attack rolls.</p>");
    assert.deepEqual([sweep.strikes, sweep.each, sweep.penalty], [["snout", "snout"], true, -2]);
});

test("Reactive Strike for its allies of a trait until its own next turn ends, once for each (2026-10-12, batch 176)", () => {
    const plan = compileMonsterAbility({ type: "action", name: "Test Rally", system: { slug: null, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: [] }, description: { value: "<p>Each kobold within @Template[emanation|distance:20]{20 feet} of the test chief gains the Reactive Strike reaction until the end of the test chief's next turn. Once a kobold has used this Reactive Strike, that kobold is temporarily immune to the same test chief's Test Rally for 10 minutes.</p>" } } }, { basicActions: {} });
    assert.deepEqual([plan.builtin, plan.within, plan.trait, plan.reaction, plan.until, plan.usedOnce], ["grant-aoo", 20, "kobold", "Reactive Strike", "source", true]);
});

test("a rune detonated on the attacker, creatures that come as it falls, a Strike before it's destroyed (2026-10-12, batch 177)", () => {
    const item = (name, type, html) => ({ type: "action", name, system: { slug: null, actionType: { value: type }, actions: { value: null }, traits: { value: [] }, description: { value: html } } });
    const detonating = item("Detonating Rune", "passive", "<p>Its Strikes can leave a detonating rune. A second rune detonates the first, dealing @Damage[3d6[untyped]] damage to the target.</p>");
    const retort = item("Test Retort", "reaction", "<p><strong>Trigger</strong> A creature within 10 feet damages the test drake</p><hr /><p><strong>Effect</strong> With a burst of runic magic, the test drake uses their detonating rune ability on the triggering creature and immediately causes the rune to detonate if it didn't automatically do so.</p>");
    const actor = { items: [detonating, retort] };
    const plan = compileMonsterAbility(retort, { basicActions: {}, actor });
    assert.deepEqual([plan.targeting.target, plan.trigger.reaction, plan.resolution.outcomes.success.damage.formulas[0].formula], ["the attacker", true, "3d6[untyped]"]);
    const horn = compileMonsterAbility(item("Test Horn", "reaction", "<p><strong>Trigger</strong> The test captain is reduced to 0 Hit Points</p><hr /><p><strong>Effect</strong> The test captain sounds a horn as it falls. The call summons reinforcements, raising [[/r 1d6 #Corpses]]{1d6 corpses} in a @Template[emanation|distance:100] as zombies.</p>"), { basicActions: {} });
    assert.equal(horn.builtin, "no-effect");
    const spite = compileMonsterAbility(item("Test Spite", "reaction", "<p>When the test ghoul is reduced to 0 Hit Points, they can use their reaction to make a Strike before being destroyed. They don't gain any Hit Points from ghoul hunger on this Strike.</p>"), { basicActions: {} });
    assert.deepEqual(spite, { builtin: "death-strike", strike: null });
});

test("Demoralize as it rolls initiative, once a day; an initiative bonus for allies within 10 feet (2026-10-12, batch 178)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const item = (type, html) => ({ type: "action", name: "Test Cry", system: { slug: null, actionType: { value: type }, actions: { value: null }, traits: { value: ["auditory"] }, description: { value: html } } });
    const cry = compileMonsterAbility(item("reaction", "<p><strong>Frequency</strong> once per day</p><p><strong>Trigger</strong> Test Raider rolls initiative</p><hr /><p><strong>Effect</strong> Test Raider attempts to [[/act demoralize]] an observed foe.</p>"), { basicActions });
    assert.deepEqual([cry.trigger.event, cry.resolution.check.statistic], ["initiative", "intimidation"]);
    const ears = compileMonsterAbility(item("free", "<p><strong>Trigger</strong> The test hare rolls initiative using Perception or Survival</p><hr /><p><strong>Effect</strong> Their long ears flick in warning, granting allies within 15 feet a +1 circumstance bonus to initiative rolls.</p>"), { basicActions: {} });
    assert.deepEqual([ears.builtin, ears.value, ears.within, ears.free], ["initiative-warning", 1, 15, true]);
});

test("ways that have a spell's effects, an area before a casting as a note (2026-10-12, batch 179)", () => {
    const html = "<p>The test drake unleashes their breath in one of two ways. The test drake can't use Test Breath again for [[/gmr 1d4 #Recharge Test Breath]]{1d4 rounds}.</p><ul><li><p><strong>Giggle Gas</strong> (emotion, mental) The test drake breaths a cloud of gas in a @Template[cone|distance:15]. This has the effect of @UUID[Compendium.pf2e.spells-srd.Item.tlSE7Ly8vi1Dgddv]{Laughing Fit} (@Check[will|dc:20]) with a duration of 1 round.</p></li><li><p><strong>Slick Spit</strong> The test drake spits goo at a solid surface. This creates a @Template[burst|distance:10] with the area effect of @UUID[Compendium.pf2e.spells-srd.Item.Wu0xFpewMKRK3HG8]{Grease} (@Check[reflex|dc:20]).</p></li></ul>";
    const plan = compileMonsterAbility({ type: "action", name: "Test Breath", system: { slug: null, actionType: { value: "action" }, actions: { value: 2 }, traits: { value: [] }, description: { value: html } } }, { basicActions: {} });
    assert.deepEqual(plan.modes.map((mode) => [mode.name, mode.plan.builtin, mode.plan.spell.name, mode.plan.dc]), [["Giggle Gas", "cast-spell", "Laughing Fit", 20], ["Slick Spit", "cast-spell", "Grease", 20]]);
    assert.equal(plan.modes[0].plan.notes[0], "The test drake breaths a cloud of gas in a 15-foot cone.");
});

test("ways written as paragraphs one after another, the last one's degrees after them (2026-10-12, batch 180)", () => {
    const html = "<p>The test drake breathes in one of two ways.</p><p>The test drake can't use Test Breath again for [[/gmr 1d4 #Recharge Test Breath]]{1d4 rounds}.</p><hr /><p><strong>Sparks</strong> The test drake breathes sparks in a @Template[cone|distance:15] that deal @Damage[4d6[electricity]] damage (@Check[reflex|dc:20|basic] save).</p><hr /><p><strong>Slow Fog</strong> The test drake breathes a grey fog. Each creature within a @Template[cone|distance:15] must attempt a @Check[fortitude|dc:20] save.</p><hr /><p><strong>Critical Success</strong> The creature is unaffected.</p><p><strong>Success</strong> The creature is Slowed 1.</p><p><strong>Failure</strong> The creature is Slowed 2.</p><p><strong>Critical Failure</strong> The creature is Slowed 3.</p>";
    const plan = compileMonsterAbility({ type: "action", name: "Test Breath", system: { slug: null, actionType: { value: "action" }, actions: { value: 2 }, traits: { value: [] }, description: { value: html } } }, { basicActions: {} });
    assert.deepEqual(plan.modes.map((mode) => [mode.name, mode.plan.resolution.check.statistic]), [["Sparks", "reflex"], ["Slow Fog", "fortitude"]]);
    assert.deepEqual(plan.modes[1].plan.resolution.outcomes.failure.effects.map((effect) => [effect.slug, effect.value]), [["slowed", 2]]);
});

test("a reroll for a creature in its aura, the new result kept with a floor (2026-10-12, batch 181)", () => {
    const plan = compileMonsterAbility({ type: "action", name: "Test Calm", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: "<p><strong>Trigger</strong> A creature within the test unicorn's calming aura fails a save against an emotion effect or a disease</p><hr /><p><strong>Effect</strong> The test unicorn soothes it. The triggering creature rerolls the save and takes the second result. If the second roll is a critical failure, it's a failure instead.</p>" } } }, { basicActions: {} });
    assert.deepEqual(plan, { builtin: "save-reroll", ally: true, within: 30, against: ["emotion", "disease"], keep: "new", floor: "failure" });
});

test("a shield for itself or an ally within some feet (2026-10-12, batch 182)", () => {
    const plan = compileMonsterAbility({ type: "action", name: "Test Wing", system: { slug: null, actionType: { value: "reaction" }, actions: { value: null }, traits: { value: [] }, description: { value: "<p><strong>Trigger</strong> A creature attacks the test drake or its ally within 10 feet of it</p><hr /><p><strong>Effect</strong> The test drake lifts a wing, using the Raise a Shield action. If it protects the ally, that ally keeps that bonus until the start of its next turn.</p>" } } }, { basicActions: {} });
    assert.deepEqual([plan.builtin, plan.value, plan.within, plan.self], ["ally-ac-reaction", 2, 10, true]);
});

test("an ally's Stride and Strike with extra damage on a hit (2026-10-12, batch 183)", () => {
    const plan = compileMonsterAbility({ type: "action", name: "Test Counsel", system: { slug: null, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: [] }, description: { value: "<p><strong>Frequency</strong> once per round</p><hr /><p><strong>Effect</strong> The test sage barks an order. An ally within 30 feet of the test sage can Stride once and Strike once, in any order. If it hits, the Strike deals an additional 1d6 cold damage.</p>" } } }, { basicActions: {} });
    assert.deepEqual(plan, { builtin: "ally-advance", actions: 1, within: 30, extraDamage: ["1d6[cold]"], oncePerTurn: true });
});

test("a rope swing with a Strike along the way, behind a requirement the GM checks (2026-10-12, batch 184)", () => {
    const plan = compileMonsterAbility({ type: "action", name: "Test Swing", system: { slug: null, actionType: { value: "action" }, actions: { value: 2 }, traits: { value: [] }, description: { value: "<p><strong>Requirements</strong> The test pirate is on the deck of a ship.</p><hr /><p><strong>Effect</strong> The test pirate swings from a nearby rope, moving up to twice its Speed and ignoring any terrain or lack of surface beneath it. It can make a cutlass Strike at any point during this movement.</p>" } } }, { basicActions: {} });
    assert.deepEqual([plan.builtin, plan.strides, plan.strike, plan.requires, plan.notes.length], ["strike-activity", 2, "cutlass", "requirement", 1]);
});

test("a Strike only after boarding a boat; Strikes at different creatures with a teleport before each (2026-10-12, batch 185)", () => {
    const compile = (actions, html) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: html } } }, { basicActions: {} });
    const board = compile(2, "<p>The test deckhand swings on a rope or Strides, moving up to double their Speed. If the deckhand boarded or disembarked a boat during this movement, they can make a melee Strike at the end of their movement that deals one extra damage die on a hit.</p>");
    assert.deepEqual([board.builtin, board.strides, board.requires, board.extraWeaponDice], ["strike-activity", 2, "requirement", 1]);
    const blink = compile(3, "<p>The test drake flickers about. The test drake teleports up to 30 feet to a space adjacent to a creature and makes a tail Strike against that creature. The test drake can do this up to three times, teleporting to a different creature each time. Each attack counts toward its multiple attack penalty, but the penalty does not increase until all attacks have been made.</p>");
    assert.deepEqual([blink.builtin, blink.strikes, blink.each, blink.max, blink.sameMap], ["multi-strike", ["tail"], true, 3, true]);
});

test("two Strikes one with each weapon; two at separate targets then a Swim; two at a helpless creature (2026-10-12, batch 186)", () => {
    const compile = (actions, html) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: `<p>${html}</p>` } } }, { basicActions: {} });
    const slice = compile(2, "Test Duelist makes two Strikes, one with each sickle, using her current multiple attack penalty. This counts as one attack when calculating her multiple attack penalty.");
    assert.deepEqual([slice.strikes, slice.sameTarget, slice.sameMap, slice.countsAs], [["sickle", "sickle"], true, true, 1]);
    const retreat = compile(2, "The test turtle flails as it flees. It makes two flipper Strikes, each of which must be against separate targets, and each of which takes the normal multiple attack penalty. It then Swims up to its swim Speed. This Swim does not trigger reactions based on movement.");
    assert.deepEqual([retreat.each, retreat.max, retreat.notes.length], [true, 2, 1]);
    const ravage = compile(3, "The test brain makes two claw Strikes against a Paralyzed, Restrained, or Unconscious creature, using the same attack modifier as its highest attack modifier. These Strikes gain the death trait.");
    assert.deepEqual([ravage.noMap, ravage.requires, ravage.sameTarget], [true, "helpless", true]);
});

test("a drawn weapon's Strike off-guard with extra bleed; a hit that grabs and pulls (2026-10-12, batch 187)", () => {
    const compile = (html) => compileMonsterAbility({ type: "action", name: "Test", system: { slug: null, actionType: { value: "action" }, actions: { value: 2 }, traits: { value: [] }, description: { value: html } } }, { basicActions: {} });
    const blow = compile("<p>The test duelist Interacts to draw a melee weapon without triggering reactions and makes a Strike with that weapon. The target is Off-Guard against this Strike. The test duelist deals an extra @Damage[1d6[bleed]] with the Strike.</p>");
    assert.deepEqual([blow.offGuard, blow.onHit.damage, blow.notes.length], [true, ["1d6[bleed]"], 1]);
    const drop = compile("<p>The test bat makes a claw Strike. On a hit, the Strike deals an additional @Damage[1d4[slashing]] damage and the test bat immediately Grabs the target and pulls it to a space adjacent to the test bat.</p>");
    assert.deepEqual([drop.onHit.damage, drop.onHit.conditions.map((entry) => entry.slug)], [["1d4[slashing]"], ["grabbed"]]);
});

test("a shape that otherwise uses a spell's effects, cast through PF2e (2026-10-12, batch 188)", () => {
    const plan = compileMonsterAbility({ type: "action", name: "Test Shape", system: { slug: null, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: ["concentrate", "polymorph"] }, description: { value: "<p>The test sprout transforms into a Tiny shrub. This ability otherwise uses the effects of @UUID[Compendium.pf2e.spells-srd.Item.dileJ0Yxqg76LMvu]{One with Plants}.</p>" } } }, { basicActions: {} });
    assert.deepEqual([plan.builtin, plan.spell.name], ["cast-spell", "One with Plants"]);
});

test("what no reading plays: the GM's when behind an unseen state, out of combat, or a one-off adventure creature's (2026-10-12)", () => {
    const item = (type, html, traits = []) => ({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? 1 : null }, traits: { value: traits }, description: { value: html } } });
    const odd = "<p>The test thing does something nobody has written a reading for, vividly.</p>";
    assert.deepEqual(compileMonsterAbility(item("action", `<p><strong>Requirements</strong> The test eel is in water</p><hr />${odd}`), {}), { builtin: "no-effect", gm: "state" });
    assert.deepEqual(compileMonsterAbility(item("reaction", `<p><strong>Requirements</strong> Initiative has not yet been rolled</p><p><strong>Trigger</strong> A creature comes close</p><p><strong>Effect</strong> The test spider wakes up and peers about.</p>`), {}), { builtin: "no-effect", gm: "state" });
    assert.deepEqual(compileMonsterAbility(item("action", "<p>The test sage learns the name of every merchant within 1 mile.</p>"), {}), { builtin: "no-effect", gm: "out-of-combat" });
    assert.deepEqual(compileMonsterAbility(item("action", odd, ["exploration"]), {}), { builtin: "no-effect", gm: "out-of-combat" });
    assert.deepEqual(compileMonsterAbility(item("action", odd), { pack: "abomination-vaults-bestiary" }), { builtin: "no-effect", gm: "adventure" });
    assert.deepEqual(compileMonsterAbility(item("action", odd), { actor: { _stats: { compendiumSource: "Compendium.pf2e.pfs-season-1-bestiary.Actor.abcdefghijklmnop" } } }), { builtin: "no-effect", gm: "adventure" });
    assert.equal(compileMonsterAbility(item("action", odd), { pack: "pathfinder-monster-core" }), null, "a rulebook creature's stays uncovered");
    assert.equal(compileMonsterAbility(item("passive", odd), { pack: "abomination-vaults-bestiary" }), null, "not a passive");
});

test("an ability used three times; flying and leaping multi-Strikes; one roll at everyone in reach; a long bite (2026-10-12, batch 190)", () => {
    const item = (name, actions, html) => ({ type: "action", name, system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: html } } });
    const pool = item("Test Pool", 2, "<p>The test drake expels a @Template[type:burst|distance:10] of water within 60 feet. Each creature in it must succeed at a @Check[fortitude|dc:20] save or be Clumsy 1 for 1 round.</p>");
    const barrage = item("Test Barrage", 2, "<p><strong>Frequency</strong> once per day</p><hr /><p><strong>Effect</strong> The test drake uses Test Pool three times. None of the bursts can overlap.</p>");
    const thrice = compileMonsterAbility(barrage, { actor: { items: [pool, barrage] } });
    assert.deepEqual([thrice.resolution.kind, thrice.notes.at(-1)], ["save", "Test Pool three times: that many areas, none overlapping."]);
    const flying = compileMonsterAbility(item("Test Flight", 2, "<p>The test pegasus Flies and Strikes twice with their hooves at any points during their movement. Each attack counts toward the test pegasus's multiple attack penalty, but the penalty doesn't increase until after they make all the attacks.</p>"), {});
    assert.deepEqual([flying.strikes, flying.strides, flying.sameMap], [["hoove", "hoove"], 1, true]);
    const jump = compileMonsterAbility(item("Test Jump", 2, "<p>The test frog jumps up to 20 feet and makes two tongue Strikes against different targets.</p>"), {});
    assert.deepEqual([jump.each, jump.max, jump.strides], [true, 2, 1]);
    const blade = compileMonsterAbility(item("Test Blade", 3, "<p>The test giant hums. The test giant makes a maul Strike with a -2 circumstance penalty against each creature within its reach. It makes only one attack roll and compares the result against each creature's AC. This Strike deals an additional @Damage[2d6[sonic]] damage and counts as two attacks for the test giant's multiple attack penalty.</p>"), {});
    assert.deepEqual([blade.each, blade.penalty, blade.countsAs, blade.extraDamage], [true, 2, 2, ["2d6[sonic]"]]);
    const bite = compileMonsterAbility(item("Test Bite", 2, "<p>The test snake lunges, making a jaws Strike with a reach of 30 feet. If the Strike hits, its target is Grabbed and pulled to an empty space adjacent to the test snake.</p>"), {});
    assert.deepEqual([bite.strike, bite.onHit.conditions.map((entry) => entry.slug), bite.notes.length], ["jaws", ["grabbed"], 2]);
});

test("a redirect as it's targeted; a move as a creature closes; allies' Steps; a long chain's teleport (2026-10-12, batch 191)", () => {
    const item = (type, html, actions = 1) => ({ type: "action", name: "Test", system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: [] }, description: { value: html } } });
    const hop = compileMonsterAbility(item("reaction", "<p><strong>Trigger</strong> The test hopper is the target of a melee Strike and is adjacent to another enemy that is also within the reach of the melee Strike.</p><hr /><p><strong>Effect</strong> The test hopper springs away, redirecting the triggering Strike against the adjacent enemy. The test hopper Strides up to half its Speed, and this movement does not trigger reactions.</p>"), {});
    assert.deepEqual([hop.builtin, hop.when, hop.melee], ["redirect-attack", "targeted", true]);
    const skitter = compileMonsterAbility(item("reaction", "<p><strong>Trigger</strong> A creature that starts its move outside the test crawler's reach moves into its reach.</p><hr /><p><strong>Effect</strong> The test crawler moves 15 feet. This does not trigger reactions.</p>"), {});
    assert.deepEqual([skitter.builtin, skitter.on, skitter.move, skitter.feet, skitter.safe], ["withdraw", "approach", "Stride", 15, true]);
    assert.deepEqual(compileMonsterAbility(item("action", "<p>The test boss yells. Any allies who hear and understand this order can use a reaction to Step.</p>"), {}), { builtin: "no-effect" });
    const chain = compileMonsterAbility(item("action", "<p>Shadows extend the test giant's whip as they make a whip Strike, increasing their reach to 40 feet for that Strike. If this hits, the target must succeed at a @Check[will|dc:25] save or be teleported to an empty space within the test giant's normal reach.</p>", 2), {});
    assert.deepEqual([chain.strike, chain.notes.length], ["whip", 2]);
});
