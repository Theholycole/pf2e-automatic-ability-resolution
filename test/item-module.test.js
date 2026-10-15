import test from "node:test";
import assert from "node:assert/strict";

import { compileAbility } from "../src/compiler/index.js";

// For the item module (2026-10-15): it feeds consumables to compileAbility as action-shaped data. An area given only as an inline square
// @Template (a snare's "10-foot-by-10-foot area") made readZone throw — it read the wording's match, null there.
test("a square area given only as an inline @Template compiles without throwing, in every action shape", () => {
    const description = "<p>You arrange brambles and wires to slow a creature. The square with this trap and three adjacent squares (to form a @Template[square|distance:10]{10-foot-by-10-foot area}) become difficult terrain when the first creature enters it, for [[/gmr 1d4 #rounds]]{1d4 rounds}.</p>";
    for (const [kind, actions] of [["action", 1], ["action", 2], ["passive", null], ["reaction", null], ["free", null]]) {
        const item = { type: "action", name: "Test Snare", system: { slug: null, actionType: { value: kind }, actions: { value: actions }, traits: { value: [] }, rules: [], description: { value: description } } };
        assert.doesNotThrow(() => compileAbility(item), `${kind} ${actions ?? ""}`);
    }
});
