import test from "node:test";
import assert from "node:assert/strict";

import { compileMonsterAbility } from "../src/compiler/index.js";
import { beyondMax, conjuredActorData, conjuredName, placements, shares } from "../src/live/conjure.js";

const ability = (name, html, actions = 1) => ({ type: "action", name, system: { slug: null, actionType: { value: "action" }, actions: { value: actions }, traits: { value: [] }, description: { value: html } } });

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
