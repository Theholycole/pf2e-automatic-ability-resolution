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
    assert.equal(ability("Hyaenodon", "Drag"), null, "dragging the enemy along isn't read");
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
    assert.equal(compileMonsterAbility(item("Test Stance", "<p><strong>Requirements</strong> Test Monk is in Test Stance</p><hr /><p><strong>Effect</strong> Test Monk gains a +2 circumstance bonus to AC until the start of her next turn.</p>"))?.builtin, undefined);
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
    assert.equal(compileMonsterAbility(poisoner, { actor: { items: [poisoner] } })?.builtin, undefined, "not with no poison to apply");
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
