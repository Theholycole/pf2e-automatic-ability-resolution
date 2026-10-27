import test from "node:test";
import assert from "node:assert/strict";

import { dropImmuneParts, partImmunities, partImmunityEffect, partImmuneTo, partsEarned, partWords } from "../src/live/part-immunity.js";

// Part immunities (2026-10-27, the item module's request): Poison Fizz's blinded, Durian Bomb's sickened.
const FIZZ = { source: { slug: "poison-fizz-lesser" }, trigger: { partImmunity: { condition: "blinded", slug: "poison-fizz", duration: { value: 1, unit: "hours" }, degrees: ["criticalFailure"], against: "all" } } };

test("a plan's part immunities, one or a list, each with its key", () => {
    assert.deepEqual(partImmunities(FIZZ).map((part) => [part.slug, part.condition]), [["poison-fizz", "blinded"]]);
    const durian = { trigger: { partImmunity: [{ condition: "sickened", duration: { value: 1, unit: "minutes" } }, { condition: "blinded", duration: { value: 0, unit: "minutes" } }] } };
    assert.deepEqual(partImmunities(durian, "Durian Bomb (Moderate)").map((part) => [part.slug, part.condition]), [["durian-bomb-moderate", "sickened"]]);
    assert.deepEqual(partImmunities({ trigger: { immunity: { duration: { value: 1, unit: "minutes" } } } }), []);
    assert.deepEqual(partImmunities({ trigger: { partImmunity: { condition: "blinded", duration: { value: 1, unit: "weeks" } } } }, "X"), []);
});

test("immune to the part from anyone's, or from one source's only", () => {
    const [part] = partImmunities(FIZZ);
    assert.equal(partImmuneTo([{ partImmunity: { slug: "poison-fizz", condition: "blinded", source: null } }], part, "Actor.b"), true);
    assert.equal(partImmuneTo([{ partImmunity: { slug: "poison-fizz", condition: "blinded", source: "Actor.a" } }], part, "Actor.b"), false);
    assert.equal(partImmuneTo([{ partImmunity: { slug: "poison-fizz", condition: "blinded", source: "Actor.a" } }], part, "Actor.a"), true);
    assert.equal(partImmuneTo([{ partImmunity: { slug: "poison-fizz", condition: "sickened", source: null } }], part, "Actor.a"), false);
    // (A whole-ability immunity's flags aren't a part's.)
    assert.equal(partImmuneTo([{ immunity: { slug: "poison-fizz", source: null } }, undefined], part, "Actor.a"), false);
});

test("an immune target's row loses that condition only; the others' earn the immunity on their results", () => {
    const [part] = partImmunities(FIZZ);
    const changes = [
        { op: "damage", target: "t1", instances: [{ amount: 7, type: "poison" }] },
        { op: "condition", target: "t1", slug: "blinded", value: null, duration: { mode: "fixed", value: 1, unit: "rounds" } },
        { op: "condition", target: "t1", slug: "sickened", value: 1 },
        { op: "damage", target: "t2", instances: [{ amount: 7, type: "poison" }] },
        { op: "condition", target: "t2", slug: "blinded", value: null },
        { op: "condition", target: "t3", slug: "blinded", value: null }
    ];
    const immune = new Map([["t1", new Set(["blinded"])]]);
    const { kept, dropped } = dropImmuneParts(changes, immune);
    assert.deepEqual(dropped, [{ target: "t1", slug: "blinded" }]);
    assert.deepEqual(kept.map((change) => `${change.target}:${change.op}:${change.slug ?? ""}`), ["t1:damage:", "t1:condition:sickened", "t2:damage:", "t2:condition:blinded", "t3:condition:blinded"]);
    const targets = [{ id: "t1", degree: "criticalFailure" }, { id: "t2", degree: "criticalFailure" }, { id: "t3", degree: "failure" }, { id: "t4", degree: "criticalFailure" }];
    assert.deepEqual(partsEarned(kept, targets, [part], immune).map((entry) => entry.target), ["t2"]);
    // (No degrees: any result that gave it.)
    assert.deepEqual(partsEarned(kept, targets, [{ ...part, degrees: undefined }], immune).map((entry) => entry.target), ["t2", "t3"]);
});

test("the immunity's Effect and the card's words", () => {
    const [part] = partImmunities(FIZZ);
    const effect = partImmunityEffect("aar", part, { ability: { name: "Poison Fizz (Lesser)" }, source: { actorUuid: "Actor.a", name: "Ezren" }, conditionName: "Blinded", time: { worldTime: 10, initiative: null } });
    assert.equal(effect.name, "Immune: Blinded (Poison Fizz (Lesser))");
    assert.deepEqual(effect.flags.aar.partImmunity, { slug: "poison-fizz", condition: "blinded", source: null });
    assert.deepEqual([effect.system.duration.value, effect.system.duration.unit], [1, "hours"]);
    assert.match(effect.system.description.value, /blinded by any Poison Fizz \(Lesser\), for 1 hour; the rest of it still applies/);
    const own = partImmunityEffect("aar", { ...part, against: undefined, duration: { value: 24, unit: "hours" } }, { ability: { name: "Phantasmal Doorknob" }, source: { actorUuid: "Actor.a", name: "Ezren" }, time: {} });
    assert.equal(own.flags.aar.partImmunity.source, "Actor.a");
    assert.match(own.system.description.value, /Ezren's Phantasmal Doorknob, for 24 hours/);
    assert.equal(partWords(part, "Poison Fizz (Lesser)"), "is immune to being blinded by Poison Fizz (Lesser)");
    assert.equal(partWords(part, "Poison Fizz (Lesser)", true), "is immune to being blinded by Poison Fizz (Lesser) for 1 hour");
});
