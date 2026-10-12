import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { actorData } from "../scripts/actor-data.js";
import { compileAbility, compileBasicActions } from "../src/compiler/index.js";

const PACKS = `${process.env.HOME}/.local/share/FoundryVTT/Data/systems/pf2e/packs`;
const available = existsSync(`${PACKS}/actions`) && existsSync(`${PACKS}/pathfinder-monster-core`);
const readPack = async (name) => (await import("../tools/leveldb.mjs")).readDocuments(`${PACKS}/${name}`);

test("the creature's data for the compiler: its source data, one copy until it changes (2026-10-12)", () => {
    let copies = 0;
    const actor = { toObject: () => ({ name: "Test", copy: ++copies, items: [] }) };
    assert.equal(actorData(actor).copy, 1);
    assert.equal(actorData(actor).copy, 1, "the same copy");
    assert.equal(actorData(null), null);
    assert.equal(actorData({ name: "plain data" }), null);
});

test("an ability compiled live with its creature reads as it does offline: Trample, Engulf's size (2026-10-12)", { skip: !available && "PF2e's packs not found" }, async () => {
    const basicActions = compileBasicActions((await readPack("actions")).filter((doc) => doc.collection === "items"));
    const npcs = (await readPack("pathfinder-monster-core")).filter((doc) => doc.collection === "actors");
    for (const [name, ability] of [["Elephant", "Trample"], ["Living Tar", "Engulf"]]) {
        const npc = npcs.find((doc) => doc.name === name);
        const item = npc.items.find((entry) => entry.name === ability);
        const live = { toObject: () => structuredClone(npc) };
        assert.deepEqual(compileAbility(item, { basicActions, actor: actorData(live) }), compileAbility(item, { basicActions, actor: npc }), `${name}: ${ability}`);
    }
    const elephant = npcs.find((doc) => doc.name === "Elephant");
    assert.equal(compileAbility(elephant.items.find((entry) => entry.name === "Trample"), { basicActions }), null, "without its creature, Trample didn't compile");
});
