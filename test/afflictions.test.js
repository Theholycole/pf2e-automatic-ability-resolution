import test from "node:test";
import assert from "node:assert/strict";

import { exposedAgain, pseudoAfflictionSource } from "../src/live/afflictions.js";

// (2026-10-29, the item module's Horn of Rust: an affliction Pseudo Afflictions has no Effect for, its own built in Pseudo Afflictions' format.)
const tetanus = {
    name: "Test Tetanus", slug: "test-tetanus", traits: ["disease", "unholy"], level: 9, statistic: "fortitude", dc: 19, onset: { value: 10, unit: "days" }, maximumDuration: null,
    stages: [
        { stage: 1, damage: [], conditions: [{ slug: "clumsy", value: 1 }], duration: { value: 1, unit: "weeks" }, text: "clumsy 1 (1 week)" },
        { stage: 2, damage: ["2d6[poison]", "1d6[bleed]"], conditions: [{ slug: "clumsy", value: 2 }, { slug: "mute", value: null }], duration: { value: 1, unit: "days" }, effects: [{ uuid: "Compendium.pf2e.other-effects.Item.AAAAAAAAAAAAAAAA", label: "Stage 2" }], text: "clumsy 2 and can't speak (1 day)" },
        { stage: 3, damage: [], conditions: [{ slug: "paralyzed", value: null }], duration: { value: 1, unit: "days" }, text: "paralyzed (1 day)" },
        { stage: 4, damage: [], conditions: [], duration: null, death: true, text: "death" }
    ]
};
const options = { effectTraits: ["disease", "poison"], isCondition: (slug) => slug !== "mute", moduleId: "aar" };

test("2026-10-29: an affliction Pseudo Afflictions lacks, its Effect from the hand-off's stages: the onset its stage 1, a death last", () => {
    const built = pseudoAfflictionSource({ ...tetanus, stage: 1 }, options);
    assert.equal(built.name, "Affliction Effect: Test Tetanus");
    assert.deepEqual(built.system.traits.value, ["disease"], "an Effect's traits only");
    assert.equal(built.system.level.value, 9);
    assert.deepEqual(built.system.badge, { type: "counter", value: 1, labels: ["Onset", "Stage 1", "Stage 2", "Stage 3", "Stage 4"] });
    assert.deepEqual(built.system.duration, { expiry: "turn-end", sustained: false, unit: "unlimited", value: -1 });
    const flag = built.flags["pseudo-afflictions"];
    assert.deepEqual(flag.save, { type: "fortitude", value: 19 });
    assert.equal(flag.onset, true);
    assert.equal(flag.startStage, undefined);
    assert.deepEqual(flag.stages["1"], { duration: { expiry: "turn-end", sustained: false, unit: "days", value: 10 } });
    assert.deepEqual(flag.stages["2"], { duration: { expiry: "turn-end", sustained: false, unit: "days", value: 7 }, conditions: [{ slug: "clumsy", linked: true }] }, "a week, 7 days");
    assert.deepEqual(flag.stages["3"], { duration: { expiry: "turn-end", sustained: false, unit: "days", value: 1 }, conditions: [{ slug: "clumsy", value: 2, linked: true }], effects: ["Compendium.pf2e.other-effects.Item.AAAAAAAAAAAAAAAA"], damage: { formula: "{2d6[poison],1d6[bleed]}" } });
    assert.deepEqual(flag.stages["5"], { duration: { expiry: "turn-end", sustained: false, unit: "unlimited", value: -1 }, note: "Character is dead" });
    assert.deepEqual(built.flags.aar, { affliction: { slug: "test-tetanus", name: "Test Tetanus" } });
    assert.match(built.system.description.value, /<strong>Onset<\/strong> 10 days.*<strong>Stage 2<\/strong> clumsy 2 and can't speak/);
});

test("2026-10-29: a critical failure one stage further (its startStage with an onset, else its badge); a poison's maximum duration its own", () => {
    assert.equal(pseudoAfflictionSource({ ...tetanus, stage: 2 }, options).flags["pseudo-afflictions"].startStage, 3);
    const venom = { name: "Test Venom", traits: ["poison"], statistic: "fortitude", dc: 18, maximumDuration: { value: 6, unit: "rounds" }, stages: [{ stage: 1, damage: ["3d8[poison]"], conditions: [], duration: { value: 2, unit: "rounds" }, text: "test venom's first" }, { stage: 2, damage: ["5d8[poison]"], conditions: [{ slug: "enfeebled", value: 1 }], duration: { value: 2, unit: "rounds" }, text: "test venom's second" }], stage: 2 };
    const built = pseudoAfflictionSource(venom, options);
    assert.equal(built.system.badge.value, 2);
    assert.equal(built.flags["pseudo-afflictions"].onset, false);
    assert.equal(built.flags["pseudo-afflictions"].startStage, undefined);
    assert.equal(built.system.level.value, 1, "no level: 1");
    assert.deepEqual(built.system.duration, { expiry: "turn-end", sustained: false, unit: "rounds", value: 6 });
    assert.deepEqual(built.flags["pseudo-afflictions"].stages["2"].conditions, [{ slug: "enfeebled", linked: true }]);
    assert.equal(pseudoAfflictionSource({ ...venom, stages: [] }, options), null, "no stages: nothing");
    assert.equal(pseudoAfflictionSource({ ...venom, dc: null }, options), null, "no DC: nothing");
});

test("2026-10-29: exposed again while it has the built Effect: a poison a stage on (two on a critical failure, to its last), a disease no change", () => {
    const effect = (traits, value, labels = ["Stage 1", "Stage 2", "Stage 3"]) => ({ system: { traits: { value: traits }, badge: { value, labels } } });
    assert.equal(exposedAgain(effect(["poison"], 1), "failure"), 2);
    assert.equal(exposedAgain(effect(["poison"], 1), "criticalFailure"), 3);
    assert.equal(exposedAgain(effect(["poison"], 2), "criticalFailure"), 3);
    assert.equal(exposedAgain(effect(["poison"], 3), "failure"), null);
    assert.equal(exposedAgain(effect(["disease"], 1), "criticalFailure"), null);
});
