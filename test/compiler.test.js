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
    // Drink Blood: Athletics against Fortitude; a success drains; the healing is a note for the GM.
    const drink = compileMonsterAbility(action("Drink Blood", "<p>The test vampire sinks its fangs into that creature to drink its blood. This requires an @Check[athletics|defense:fortitude] check against the victim's Fortitude DC if the victim is grabbed and is automatic for any of the other conditions. The victim is Drained 1 and the vampire regains @Damage[12[healing]] HP.</p>", { slug: "drink-blood" }));
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
