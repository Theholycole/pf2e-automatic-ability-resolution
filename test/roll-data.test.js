import test from "node:test";
import assert from "node:assert/strict";
import { fillRollData, withDescription } from "../src/compiler/roll-data.js";
import { compileAbility } from "../src/compiler/index.js";

const aspect = { "@actor.flags.pf2e.aspectDC": 27, "@actor.flags.pf2e.aspectRank": 4 };
const read = (path) => aspect[path];

test("an aspect's DC and rank by path: the save's DC and the damage dice (2026-10-30, Teams+ Magic)", () => {
    const html = "<p>The aspect deals @Damage[(@actor.flags.pf2e.aspectRank)d6[bludgeoning]]{1d6 damage per rank} of the spell to all creatures within 15 feet with a @Check[reflex|dc:resolve(@actor.flags.pf2e.aspectDC)|basic]. Creatures that critically fail their save are knocked prone.</p>";
    const filled = fillRollData(html, read);
    assert.match(filled, /@Check\[reflex\|dc:27\|basic\]/);
    assert.match(filled, /@Damage\[\(4\)d6\[bludgeoning\]\]/);
    const plan = compileAbility({ name: "Aftershock", type: "action", system: { actionType: { value: "action" }, actions: { value: 2 }, traits: { value: [] }, description: { value: filled } } }, {});
    assert.equal(plan?.resolution?.kind, "save");
    assert.equal(plan.resolution.check.against.value, 27);
});

test("a path it can't read, or arithmetic around it: as it was, or worked out", () => {
    assert.equal(fillRollData("@Check[will|dc:resolve(@actor.flags.pf2e.missing)]", read), "@Check[will|dc:resolve(@actor.flags.pf2e.missing)]");
    assert.equal(fillRollData("@Check[will|dc:resolve(@actor.flags.pf2e.aspectDC + 2)]", read), "@Check[will|dc:29]");
    assert.equal(fillRollData("@Damage[(@actor.level)d6[fire]]", read), "@Damage[(@actor.level)d6[fire]]");
    const item = { name: "X", system: { description: { value: "a" }, level: { value: 3 } } };
    assert.equal(withDescription(item, "b").system.description.value, "b");
    assert.equal(withDescription(item, "b").system.level.value, 3);
});

test("\"must make a … save or become Frightened 1 (Frightened 2 on a critical failure)\" (2026-10-30, Teams+ Magic's Behold!)", () => {
    const html = "<p>The aspect reveals its true nature to all enemies within @Template[type:emanation|distance:30]{30 feet}. Creatures in the area must make a @Check[will|dc:resolve(@actor.flags.pf2e.aspectDC)] save or become @UUID[Compendium.pf2e.conditionitems.TBSHQspnbcqxsmjL]{Frightened 1} (@UUID[Compendium.pf2e.conditionitems.TBSHQspnbcqxsmjL]{Frightened 2} on a critical failure).</p>";
    const plan = compileAbility({ name: "Behold!", type: "action", system: { actionType: { value: "action" }, actions: { value: 2 }, traits: { value: [] }, description: { value: fillRollData(html, read) } } }, {});
    assert.equal(plan?.resolution?.check.against.value, 27);
    assert.deepEqual(plan.resolution.outcomes.failure.effects.map((each) => [each.slug, each.value]), [["frightened", 1]]);
    assert.deepEqual(plan.resolution.outcomes.criticalFailure.effects.map((each) => [each.slug, each.value]), [["frightened", 2]]);
});
