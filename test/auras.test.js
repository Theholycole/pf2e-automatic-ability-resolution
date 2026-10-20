import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { compileBasicActions, compileMonsterAbility, inline } from "../src/compiler/index.js";
import { damageOnly, readActiveAfter, readAuraTiming } from "../src/compiler/auras.js";
import { activeAfterUse, auraConditionEffect, auraConditionStep, auraWhen, entered, immunityApplies, immunityEffect, isImmune } from "../src/live/auras.js";
import { cardHTML, createCard } from "../src/live/card.js";

const PACKS = `${process.env.HOME}/.local/share/FoundryVTT/Data/systems/pf2e/packs`;
const available = existsSync(`${PACKS}/actions`) && existsSync(`${PACKS}/pathfinder-monster-core`);
const readPack = async (name) => (await import("../tools/leveldb.mjs")).readDocuments(`${PACKS}/${name}`);

test("an aura's timing from its text; damage-only auras on entering and at turn start, once per round", () => {
    assert.deepEqual(readAuraTiming("20 feet. A creature entering the aura or begins their turn in the aura must succeed at a @Check[fortitude|dc:20] save."), { when: ["enter", "start-turn"] });
    assert.deepEqual(readAuraTiming("20 feet. When a creature ends its turn in the aura, it must succeed at a @Check[will|dc:35] save."), { when: ["end-turn"] });
    assert.deepEqual(readAuraTiming("120 feet. At the start of their turn, a creature in the erosion aura's area takes @Damage[6d6[bludgeoning]] damage."), { when: ["start-turn"] });
    assert.deepEqual(readAuraTiming("10 feet. When a creature moves into the emanation or begins its turn there, shard storm deals damage."), { when: ["enter", "start-turn"] });
    const heat = "5 feet. @Damage[4d6[fire]|options:area-damage] damage (@Check[reflex|dc:37|basic|options:area-effect] save)";
    assert.ok(damageOnly(heat));
    assert.deepEqual(readAuraTiming(heat), { when: ["enter", "start-turn"], oncePerRound: true });
    // More than damage, and no timing: casting a spell in it (left to the GM).
    assert.deepEqual(readAuraTiming("30 feet. Any creature in the aura who Casts a Spell must attempt a @Check[will|dc:37] save."), { when: [] });
    assert.deepEqual(readActiveAfter("20 feet. After the dragon uses their Poison Breath, a cloud of poison gas continues to emanate from their body for 1 round. Any creature that ends its turn in the miasma takes damage."), { ability: "Poison Breath", rounds: 1 });
});

test("immunity: how long, to whom, after which results", () => {
    const presence = inline.immunityDetails("Regardless of the result of the saving throw, the creature is temporarily immune to this monster's Frightful Presence for 1 minute.");
    assert.deepEqual([presence.duration, presence.against, presence.degrees.length], [{ value: 1, unit: "minutes" }, "source", 4]);
    const stench = inline.immunityDetails("A creature that succeeds at its save or recovers from being sickened is temporarily immune to all stench auras for 1 minute.");
    assert.deepEqual([stench.against, stench.degrees], ["all", ["criticalSuccess", "success"]]);
    const footsteps = inline.immunityDetails("Critical Success The creature is unaffected and is temporarily immune for 24 hours.");
    assert.deepEqual([footsteps.duration, footsteps.degrees], [{ value: 24, unit: "hours" }, ["criticalSuccess"]]);
    assert.deepEqual(inline.readImmunity("<p>Regardless of your result, the target is temporarily immune to your attempts to Demoralize it for 10 minutes.</p>").duration, { value: 10, unit: "minutes" });
    // (2026-10-20: not an immunity to attempts to end something — Mindrender Baton's.)
    assert.equal(inline.readImmunity("<p>The commanded creature is then temporarily immune to the commander's attempts to end the command with skills for 24 hours.</p>"), null);
});

test("compiled auras: Frightful Presence on entering, Stench also at turn start, Miasma after Poison Breath; other passives aren't auras", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const npcs = (await readPack("pathfinder-monster-core")).filter((doc) => doc.collection === "actors" && doc.type === "npc");
    const ability = (creature, name) => npcs.find((npc) => npc.name === creature).items.find((item) => item.name.startsWith(name));
    const presence = compileMonsterAbility(ability("Adamantine Dragon (Adult)", "Frightful Presence"));
    assert.deepEqual([presence.trigger.event, presence.trigger.when, presence.trigger.immunity.against], ["aura", ["enter"], "source"]);
    const stench = compileMonsterAbility(ability("Ghoul Soldier", "Stench"));
    assert.deepEqual([stench.trigger.when, stench.trigger.immunity.against, stench.trigger.immunity.degrees], [["enter", "start-turn"], "all", ["criticalSuccess", "success"]]);
    const miasma = npcs.flatMap((npc) => npc.items.filter((item) => item.name === "Miasma").map((item) => compileMonsterAbility(item, { basicActions, actor: npc })))[0];
    assert.deepEqual([miasma.trigger.when, miasma.trigger.activeAfter], [["end-turn"], { ability: "Poison Breath", rounds: 1 }]);
    // A passive with a save that isn't an aura or a Strike's venom (it acts on its own trigger): not played as an aura.
    const passive = npcs.flatMap((npc) => npc.items.map((item) => ({ npc, item }))).find(({ npc, item }) => item.type === "action" && item.system.actionType?.value === "passive" && !(item.system.traits?.value ?? []).includes("aura") && !(item.system.rules ?? []).some((rule) => rule.key === "Aura") && compileMonsterAbility(item, { basicActions })?.resolution && compileMonsterAbility(item, { basicActions, actor: npc }).trigger?.event !== "strike");
    // (It acts on its own trigger: a passive, or since 2026-10-10 a hit on the monster or its death.)
    assert.ok(["passive", "hit-by", "death"].includes(compileMonsterAbility(passive.item, { basicActions, actor: passive.npc }).trigger.event), passive.item.name);
});

test("live auras: entering along a path, the time an aura runs after an ability, immunity", () => {
    assert.deepEqual(auraWhen({ trigger: { when: "enter" } }), ["enter"]);
    assert.ok(entered([false, false, true, true]));
    assert.ok(!entered([true, true, false]), "already inside, then left");
    assert.ok(entered([true, false, true]), "left and came back");
    // Poison Breath in round 2 at turn 1: the miasma runs until the start of the dragon's turn in round 3.
    assert.ok(activeAfterUse({ round: 2, turn: 1 }, { round: 2, turn: 3 }));
    assert.ok(activeAfterUse({ round: 2, turn: 1 }, { round: 3, turn: 0 }));
    assert.ok(!activeAfterUse({ round: 2, turn: 1 }, { round: 3, turn: 1 }));
    const stench = { duration: { value: 1, unit: "minutes" }, degrees: ["criticalSuccess", "success"], against: "all", raw: "…" };
    assert.ok(immunityApplies(stench, "success") && !immunityApplies(stench, "failure"));
    const flags = [{ immunity: { slug: "stench", source: null } }, { immunity: { slug: "frightful-presence", source: "Actor.dragon" } }];
    assert.ok(isImmune(flags, { slug: "stench", source: "Actor.ghoul" }), "all stench auras");
    assert.ok(isImmune(flags, { slug: "frightful-presence", source: "Actor.dragon" }));
    assert.ok(!isImmune(flags, { slug: "frightful-presence", source: "Actor.other-dragon" }), "another dragon's presence");
    const effect = immunityEffect("aar", { ...stench, against: "source" }, { ability: { name: "Frightful Presence", slug: "frightful-presence" }, source: { actorUuid: "Actor.dragon", name: "Horned Dragon" }, time: { worldTime: 0 } });
    assert.deepEqual([effect.name, effect.system.duration.value, effect.system.duration.unit, effect.flags.aar.immunity], ["Immune: Frightful Presence (Horned Dragon)", 1, "minutes", { slug: "frightful-presence", source: "Actor.dragon" }]);
});

test("an aura's card says why it appeared", () => {
    const plan = { source: { name: "Stench", slug: "stench" }, resolution: { kind: "save", check: { roll: "save", statistic: "fortitude", basic: false, against: { dc: "fixed", value: 20 } }, outcomes: {} } };
    const state = createCard({ plan, ability: { name: "Stench" }, source: { actorUuid: "Actor.g", name: "Ghoul" }, targets: [{ actorUuid: "Actor.v", name: "Valeros" }], cause: "entered the aura", aura: { key: "t1:stench", when: "enter" } });
    assert.match(cardHTML(state), /Stench<\/strong> <span class="aar-rider">entered the aura<\/span>/);
    assert.deepEqual(state.aura, { key: "t1:stench", when: "enter" });
});

test("conditions while in an aura: until leaving, or a while after; 'As failure, but' rows", { skip: !available && "PF2e's packs not found" }, async () => {
    assert.deepEqual(inline.readDuration("or become fatigued while it remains in the area."), { mode: "in-aura" });
    assert.deepEqual(inline.readDuration("stupefied 1 for as long as they remain within the aura."), { mode: "in-aura" });
    assert.deepEqual(inline.readLinger("As failure, but the effect persists for 3 rounds after leaving the aura."), { value: 3, unit: "rounds" });
    // "If the creature is already encumbered, it is immobilized": conditional on what it already has, left to the GM.
    assert.deepEqual(inline.readConditions("<p>The creature is encumbered while it remains in the area. If the creature is already encumbered, it is @UUID[Compendium.pf2e.conditionitems.Item.eIcWbB5o3pP6OIMe]{Immobilized} while it remains within the aura.</p>").map((effect) => `${effect.slug} ${effect.duration?.mode}`), ["encumbered in-aura"]);
    const npcs = [...(await readPack("pathfinder-monster-core")), ...(await readPack("pathfinder-monster-core-2"))].filter((doc) => doc.collection === "actors" && doc.type === "npc");
    const plan = (name) => { for (const npc of npcs) { const item = npc.items.find((entry) => entry.name === name); if (item) return compileMonsterAbility(item, { actor: npc }); } return null; };
    const heavy = plan("Heavy Aura").resolution.outcomes;
    assert.deepEqual(heavy.failure.effects.map((effect) => [effect.slug, effect.duration]), [["encumbered", { mode: "in-aura" }]]);
    assert.deepEqual(heavy.criticalFailure.effects.map((effect) => [effect.slug, effect.duration]), [["encumbered", { mode: "in-aura", after: { value: 3, unit: "rounds" } }]]);
    assert.deepEqual(plan("Draining Presence").resolution.outcomes.failure.effects.map((effect) => [effect.slug, effect.duration]), [["drained", { mode: "in-aura", after: { value: 1, unit: "minutes" } }]]);
    // "As failure, but frightened 3": the failure's fascinated, with its own frightened in place of the failure's.
    assert.deepEqual(plan("Scarecrow's Leer").resolution.outcomes.criticalFailure.effects.map((effect) => `${effect.slug} ${effect.value ?? ""}`.trim()), ["fascinated", "frightened 3"]);
});

test("live: the effect of a condition while in an aura, and what leaving does to it", () => {
    const effect = auraConditionEffect("aar", { slug: "stupefied", value: 1, template: { name: "Stupefied", img: "s.svg", uuid: "Compendium.pf2e.conditionitems.Item.s" }, source: { actorUuid: "Actor.w", tokenUuid: "Scene.s.Token.w", name: "Attic Whisperer" }, ability: { name: "Aura of Sobs" }, radius: 10, time: { worldTime: 0 }, targetUuid: "Actor.v" });
    assert.equal(effect.name, "Aura of Sobs: Stupefied 1");
    assert.deepEqual(effect.flags.aar.whileInAura, { slug: "stupefied", sourceToken: "Scene.s.Token.w", sourceActor: "Actor.w", radius: 10, after: null, lingering: false });
    assert.equal(effect.system.duration.unit, "unlimited");
    const after = { value: 3, unit: "rounds" };
    assert.equal(auraConditionStep({ inside: true, sourceGone: false, after: null, lingering: false }), "keep");
    assert.equal(auraConditionStep({ inside: false, sourceGone: false, after: null, lingering: false }), "end");
    assert.equal(auraConditionStep({ inside: false, sourceGone: false, after, lingering: false }), "linger");
    assert.equal(auraConditionStep({ inside: false, sourceGone: false, after, lingering: true }), "keep", "already counting down");
    assert.equal(auraConditionStep({ inside: true, sourceGone: false, after, lingering: true }), "resume", "back inside");
    assert.equal(auraConditionStep({ inside: false, sourceGone: true, after: null, lingering: false }), "end", "the monster died");
});
