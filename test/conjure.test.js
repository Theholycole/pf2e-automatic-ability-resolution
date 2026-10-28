import test from "node:test";
import assert from "node:assert/strict";

import { compileMonsterAbility } from "../src/compiler/index.js";
import { beyondMax, conjuredActorData, conjuredName, makerStats, pickLevels, pickable, placements, shares } from "../src/live/conjure.js";

const ability = (name, html, actions = 1, type = "action") => ({ type: "action", name, system: { slug: null, actionType: { value: type }, actions: { value: type === "action" ? actions : null }, traits: { value: [] }, description: { value: html } } });

test("creatures an ability makes: probes with their own numbers, markers, a merge into PF2e's creature (2026-10-13, batch 295)", () => {
    const probes = compileMonsterAbility(ability("Test Eyes", "<p><strong>Frequency</strong> once per day</p><p><strong>Effect</strong> Up to four of the test watcher's eyes detach from its body. Each eye has AC 20, HP 2, and a fly speed of 30 feet. The test watcher can see through all of them.</p>", 3), {});
    assert.deepEqual([probes.builtin, probes.max, probes.creatures], ["conjure", 4, [{ name: "Eye Probe", count: 4, size: "tiny", stats: { ac: 20, hp: 2, speeds: { fly: 30 } }, from: null }]]);
    const merge = compileMonsterAbility(ability("Test Merge", "<p>Five test sprites can use this activity, all within 1 round of the first, to merge together to form a composite being for 3 rounds. It's a @UUID[Compendium.pf2e.pathfinder-bestiary.Actor.aaaaaaaaaaaaaaaa]{Test Composite}.</p>", 3), {});
    assert.deepEqual([merge.merge, merge.creatures[0].from, merge.lasts.value], [{ count: 5, split: true }, { uuid: "Compendium.pf2e.pathfinder-bestiary.Actor.aaaaaaaaaaaaaaaa" }, 3]);
});

test("conjured creatures live: names, actor data, places around the maker, shares on parting, the farthest over the limit", () => {
    assert.equal(conjuredName("Hyakume", "Eye Probe", 2, 6), "Hyakume's Eye Probe 3");
    assert.equal(conjuredName("Archon", "Gestalt", 0, 1), "Archon's Gestalt");
    const data = conjuredActorData({ name: "Probe", size: "tiny", stats: { ac: 26, hp: 1, speeds: { fly: 40 } }, level: 15, moduleId: "m", flags: { itemUuid: "x" } });
    assert.deepEqual([data.system.attributes.ac.value, data.system.attributes.hp, data.system.attributes.speed, data.system.traits.size.value, data.flags.m.conjured.itemUuid], [26, { value: 1, max: 1 }, { value: 0, otherSpeeds: [{ type: "fly", value: 40 }] }, "tiny", "x"]);
    // On its maker's side: the alliance given, or PF2e's default when none is.
    assert.deepEqual([conjuredActorData({ name: "Probe", alliance: "party", moduleId: "m" }).system.details.alliance, "alliance" in data.system.details], ["party", false]);
    // Around a 1-square token at (500, 500) on a 100-pixel grid: the first ring, not on the token beside it.
    const spots = placements({ token: { x: 500, y: 500, width: 1, height: 1 }, grid: { size: 100 }, count: 9, occupied: [{ x: 600, y: 500, width: 1, height: 1 }] });
    assert.equal(spots.length, 9);
    assert.ok(!spots.some((spot) => spot.x === 600 && spot.y === 500) && !spots.some((spot) => spot.x === 500 && spot.y === 500));
    assert.deepEqual(spots.slice(0, 3), [{ x: 400, y: 400 }, { x: 500, y: 400 }, { x: 600, y: 400 }]);
    assert.deepEqual([shares(100, 9), shares(5, 9)], [Array(9).fill(11), [1, 1, 1, 1, 1, 0, 0, 0, 0]]);
    assert.deepEqual(beyondMax([{ id: "a", x: 0, y: 0 }, { id: "b", x: 900, y: 0 }, { id: "c", x: 100, y: 0 }], { max: 4, adding: 3, from: { x: 0, y: 0 } }), ["b", "c"]);
});

test("summons (2026-10-13, batch 297): steeds, horns, swarms from the remains, mounts, entities, corpses, a choice of two, a pick", () => {
    const actor = (name, level = 10, items = []) => ({ name, system: { details: { level: { value: level } } }, items });
    const steed = compileMonsterAbility(ability("Summon Steed", "<p>The test rider summons a @UUID[Compendium.pf2e.pathfinder-monster-core.Actor.ExVmw8bSvUd2wYkI]{War Horse} with elite adjustments and the fiend trait. This steed remains until it is slain, the test rider Dismisses it, or the test rider summons another steed.</p>", 2), { actor: actor("Test Rider"), pack: "pathfinder-monster-core" });
    assert.deepEqual([steed.builtin, steed.max, steed.creatures[0].from, steed.creatures[0].adjust, steed.creatures[0].traits], ["conjure", 1, { uuid: "Compendium.pf2e.pathfinder-monster-core.Actor.ExVmw8bSvUd2wYkI" }, "elite", ["fiend", "summoned", "minion"]]);
    const horn = compileMonsterAbility(ability("Final Spite", "<p><strong>Trigger</strong> The test captain is reduced to 0 Hit Points</p><hr /><p><strong>Effect</strong> The test captain blows a horn. The blast summons reinforcements, raising [[/r 1d4 #Corpses]]{1d4 corpses} in a @Template[emanation|distance:100] as @UUID[Compendium.pf2e.pathfinder-monster-core.Actor.DBTbqI9QQRtlJwWh]{Wights}.</p>", 0, "reaction"), { actor: actor("Test Captain"), pack: "pathfinder-monster-core" });
    assert.deepEqual([horn.trigger, horn.creatures[0].name, horn.creatures[0].count, horn.creatures[0].initiative, horn.needs], [{ event: "death", reaction: true }, "Wight", { formula: "1d4" }, "roll", "corpses within 100 feet (as many as there are, up to the roll)"]);
    const swarm = compileMonsterAbility(ability("Last Stones", "<p><strong>Trigger</strong> The test heap is reduced to 0 Hit Points</p><hr /><p><strong>Effect</strong> A @UUID[Compendium.pf2e.pathfinder-bestiary-3.Actor.BrGvmcM6jl3xUs4d]{Cobbleswarm} spawns in the space the test heap previously occupied, or the nearest adjacent space.</p>", 0, "reaction"), { actor: actor("Test Heap"), pack: "pathfinder-monster-core" });
    assert.deepEqual([swarm.at, swarm.creatures[0].initiative, swarm.trigger.event], ["maker", "maker", "death"]);
    const mount = compileMonsterAbility(ability("Phantom Mount", "<p>HP 40; AC 25, Fort +15, Ref +13, Will +12</p><hr /><p>The test knight summons a supernatural mount as per @UUID[Compendium.pf2e.spells-srd.Item.WPKJOhEihhcIm2uQ]{Marvelous Mount}, heightened to a level equal to half the test knight's level.</p>", 3), { actor: actor("Test Knight", 10), pack: "pathfinder-monster-core" });
    assert.deepEqual(mount.creatures[0].stats, { ac: 25, hp: 40, saves: { fortitude: 15, reflex: 13, will: 12 }, speeds: { land: 60, fly: 60 } });
    const entities = compileMonsterAbility(ability("Rise Up", "<p>The test caller summons two Medium undead entities in different empty squares up to 30 feet away. These undead entities can take the form of zombies, skeletons, or ghosts, chosen by the test caller. Each entity has 1 Hit Point and the same AC and saves as the test caller. They can't take actions of their own and deteriorate if the test caller is reduced to 0 Hit Points. The test caller can have up to four undead entities at any given time.</p>"), { actor: actor("Test Caller", 5), pack: "pathfinder-npc-core" });
    assert.deepEqual([entities.options.map((option) => option.label), entities.max, entities.oldest, entities.endsWithMaker, entities.options[1].creatures[0].stats], [["Zombies", "Skeletons", "Ghosts"], 4, true, true, { hp: 1, maker: { ac: 0, saves: 0 } }]);
    const pair = compileMonsterAbility(ability("Webbed Kin", "<p>The test weaver summons a @UUID[Compendium.pf2e.pathfinder-monster-core.Actor.4ISm82EYQeOndynw]{Giant Tarantula} or @UUID[Compendium.pf2e.pathfinder-monster-core.Actor.NcYbJS5PWBGdNDqh]{Spider Swarm}. These spiders have the summoned trait and remain for 10 minutes or until reduced to 0 Hit Points, whichever comes first.</p>", 3), { actor: actor("Test Weaver"), pack: "pathfinder-monster-core" });
    assert.deepEqual([pair.options.map((option) => option.label), pair.lasts.value], [["Giant Tarantula", "Spider Swarm"], 10]);
    const ally = compileMonsterAbility(ability("Call the Deep", "<p><strong>Effect</strong> The test diver blows a horn, casting a 2nd-rank Summon Animal spell. The test diver can summon only an aquatic creature. This creature remains until it is slain, the test diver Dismisses it, or the test diver summons another ally.</p>", 3), { actor: actor("Test Diver", 2), pack: "pathfinder-bestiary-2" });
    assert.deepEqual(ally.pick, { any: ["animal"], all: ["aquatic"], maxLevel: 1 });
    // A rune trap: one "determined when the trap is created" asked for as it's placed; (batch 298, the user's call) an adventure's too, the creature
    // it names offered first, elite or weak as written; another adventure trap that summons, the GM's.
    const rune = (text, pack) => compileMonsterAbility(ability("Summon Monster", `<p><strong>Trigger</strong> A creature steps on it</p><hr /><p><strong>Effect</strong> ${text}</p>`, 0, "reaction"), { actor: { name: "Test Rune", type: "hazard", system: { details: { level: { value: 1 } } } }, pack });
    const asked = rune("This trap summons a specific 1st-level creature, determined when the trap is created. The creature rolls initiative and remains for [[/br 2d6 #rounds]]{2d6 rounds}, after which the spell ends.", "hazards");
    assert.deepEqual([asked.pick, asked.lasts.formula, asked.creatures[0].initiative], [{ level: 1, when: "placed" }, "2d6", "roll"]);
    const named = rune("This trap summons a @UUID[Compendium.pf2e.pathfinder-monster-core.Actor.MrzlaE7k1PEsd3iQ]{Cockatrice} with the elite adjustment. The cockatrice rolls initiative and remains for 1 minute.", "some-adventure-bestiary");
    assert.deepEqual([named.pick, named.creatures[0].adjust, named.lasts.value, named.lasts.unit], [{ default: { uuid: "Compendium.pf2e.pathfinder-monster-core.Actor.MrzlaE7k1PEsd3iQ", name: "Cockatrice" }, when: "placed" }, "elite", 1, "minutes"]);
    const between = rune("This trap summons a specific level -1 creature, determined when the trap is created. The red squares summon one kind, the green squares another. The creature rolls initiative and remains for [[/br 2d4 #rounds]]{2d4 rounds}.", "some-adventure-bestiary");
    assert.deepEqual([between.pick, between.lasts.formula], [{ level: -1, when: "placed" }, "2d4"]);
    const earlier = rune("The trap summons one of the creatures previously encountered in the hall with the weak adjustment. The creature rolls initiative and remains for 5 rounds.", "some-adventure-bestiary");
    assert.deepEqual([earlier.pick, earlier.creatures[0].adjust], [{ when: "placed" }, "weak"]);
    assert.deepEqual(rune("The trap summons four test guards, who then roll initiative and remain for up to 1 minute.", "some-adventure-bestiary"), { builtin: "no-effect", gm: "adventure" });
    // A reaction that uses its summon, and one that casts its own summon spell unlinked.
    const more = ability("More Of Me", "<p>It causes another test twin to spontaneously come into being in an unoccupied space within 30 feet.</p>", 2);
    const twin = compileMonsterAbility(ability("Not Yet", "<p><strong>Trigger</strong> The test twin is reduced to 0 Hit Points</p><hr /><p><strong>Effect</strong> The test twin uses More Of Me as a reaction.</p>", 0, "reaction"), { actor: actor("Test Twin", 3, [more]), pack: "blog-bestiary" });
    assert.deepEqual([twin.creatures[0].from, twin.trigger, twin.actions], [{ self: true }, { event: "death", reaction: true }, 0]);
    const own = { type: "spell", name: "Summon Fiend (Imps Only)", system: { location: { heightenedLevel: 6 } } };
    const mirror = compileMonsterAbility(ability("Answer In Kind", "<p><strong>Trigger</strong> A creature summons something</p><hr /><p><strong>Effect</strong> The test lord casts summon fiend.</p>", 0, "reaction"), { actor: actor("Test Lord", 12, [own]), pack: "pathfinder-monster-core-2" });
    assert.deepEqual([mirror.builtin, mirror.spell.name, mirror.rank, mirror.notes[0]], ["cast-spell", "Summon Fiend", 6, "Imps Only, as its own spell says."]);
});

test("summons live (batch 297): the maker's numbers, a pick's levels and creatures, the oldest past the limit", () => {
    assert.deepEqual(makerStats({ hp: 1, maker: { ac: 0, saves: 0 } }, { ac: 22, saves: { fortitude: 10, reflex: 12, will: 14 }, hp: 80 }), { hp: 1, ac: 22, saves: { fortitude: 10, reflex: 12, will: 14 } });
    assert.deepEqual(makerStats({ maker: { ac: -4, saves: -4, hp: 1 / 3 } }, { ac: 30, saves: { fortitude: 20, reflex: 18, will: 16 }, hp: 100 }), { ac: 26, saves: { fortitude: 16, reflex: 14, will: 12 }, hp: 33 });
    // A summon heightened by the damage taken: rank 1, one more for each 10 past the first 10, at most 7.
    const heightened = { any: ["fey"], rank: { base: 1, from: "damage", over: 10, per: 10, max: 7 } };
    assert.deepEqual([pickLevels(heightened, { damage: 30 }), pickLevels(heightened, { damage: 54 }), pickLevels(heightened, { damage: 200 })], [{ rank: 3, maxLevel: 2 }, { rank: 5, maxLevel: 5 }, { rank: 7, maxLevel: 9 }]);
    const entries = [
        { uuid: "a", name: "Dolphin", level: 1, traits: ["animal", "aquatic"], type: "npc" },
        { uuid: "b", name: "Wolf", level: 1, traits: ["animal"], type: "npc" },
        { uuid: "c", name: "Shark", level: 3, traits: ["animal", "aquatic"], type: "npc" },
        { uuid: "d", name: "Dolphin", level: 1, traits: ["animal", "aquatic"], type: "npc" },
        { uuid: "e", name: "Eel", level: 0, traits: ["animal", "aquatic"], type: "npc" }
    ];
    assert.deepEqual(pickable(entries, { any: ["animal"], all: ["aquatic"], maxLevel: 1 }).map((entry) => entry.uuid), ["a", "e"]);
    assert.deepEqual(pickable(entries, { level: 1 }).map((entry) => entry.uuid), ["a", "b"]);
    // (Batch 298: a rune's own creature first, then the others of its level; one from an adventure's pack, as found live.)
    assert.deepEqual(pickable(entries, { default: { uuid: "b", name: "Wolf" } }).map((entry) => entry.uuid), ["b", "a"]);
    assert.deepEqual(pickable(entries, { default: { uuid: "x", name: "Test Hound (Adventure)" } }, { defaultEntry: { uuid: "x", name: "Test Hound (Adventure)", level: 0, traits: [], type: "npc" } }).map((entry) => entry.uuid), ["x", "e"]);
    assert.deepEqual(beyondMax([{ id: "new", x: 0, y: 0, made: 3 }, { id: "old", x: 0, y: 0, made: 1 }, { id: "mid", x: 900, y: 0, made: 2 }], { max: 4, adding: 2, from: { x: 0, y: 0 }, oldest: true }), ["old"]);
});


test("2026-10-27: a token that isn't square (a 1-by-2 Rowboat) is placed clear of its maker", () => {
    const [spot] = placements({ token: { x: 1200, y: 800, width: 1, height: 1 }, grid: { size: 100 }, count: 1, squares: { width: 1, height: 2 } });
    const covers = (at) => at.x < 1300 && at.x + 100 > 1200 && at.y < 900 && at.y + 200 > 800;
    assert.equal(covers(spot), false, JSON.stringify(spot));
    assert.deepEqual(spot, { x: 1100, y: 600 });
});
