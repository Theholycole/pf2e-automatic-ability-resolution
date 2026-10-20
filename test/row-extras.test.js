import test from "node:test";
import assert from "node:assert/strict";

import { compileMonsterAbility } from "../src/compiler/index.js";
import { escapedItems, escapeWords, spentOnce } from "../src/live/escape.js";
import { escapeIn } from "../src/compiler/row-extras.js";
import { changeLines, endWords, modifierTarget } from "../src/live/card.js";

// What a save's result rows say beyond damage and conditions (2026-10-20, src/compiler/row-extras.js; the item module's rows left to the GM).
// Synthetic wording, after each.
const ability = (html) => ({ type: "action", name: "Test Ability", system: { slug: null, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: [] }, rules: [], description: { value: html } } });
const link = (name) => `@UUID[Compendium.pf2e.conditionitems.Item.test0000000000000]{${name}}`;
const save = (dc, rows) => `<p>The creature must attempt a @Check[reflex|dc:${dc}] save.</p>${Object.entries(rows).map(([label, text]) => `<p><strong>${label}</strong> ${text}</p>`).join("")}`;
const outcomes = (html) => compileMonsterAbility(ability(html)).resolution.outcomes;
const minute = { mode: "fixed", value: 1, unit: "minutes", expiry: "turn-start", anchor: "effect-start" };
const round = { mode: "fixed", value: 1, unit: "rounds", expiry: "turn-start", anchor: "effect-start" };

test("a Speed penalty for a time or until it Escapes, and \"As success, but the penalty is -10 feet\" (Hobbling Snare)", () => {
    const rows = outcomes(save(20, { "Critical Success": "The creature is unaffected.", Success: "The creature takes a –5-foot status penalty to its Speed for 1 minute or until it [[/act escape dc=18]]{Escapes}.", Failure: "As success, but the penalty is -10 feet.", "Critical Failure": "As success, but the penalty is -20 feet." }));
    assert.deepEqual(rows.success.modifiers, [{ selector: "land-speed", value: -5, type: "status", duration: minute, escape: { dc: 18 } }]);
    assert.deepEqual([rows.failure.modifiers[0].value, rows.criticalFailure.modifiers[0].value], [-10, -20]);
    assert.deepEqual(rows.failure.modifiers[0].escape, { dc: 18 });
    for (const degree of ["success", "failure", "criticalFailure"]) assert.equal(rows[degree].manualInstructions, undefined);
});

test("two penalties in one clause, ranged attack rolls and a fly Speed, for the sentence's time (Storm Arrow)", () => {
    const rows = outcomes(save(25, { Success: "The foe is unaffected.", Failure: "The foe is buffeted by winds for 1 round, taking a -2 circumstance penalty to ranged attack rolls and a –10-foot circumstance penalty to its fly Speed.", "Critical Failure": "As failure." }));
    assert.deepEqual(rows.failure.modifiers.map((modifier) => [modifier.selector, modifier.value, modifier.duration.value]), [["ranged-attack-roll", -2, 1], ["fly-speed", -10, 1]]);
    assert.equal(rows.criticalFailure.modifiers.length, 2);
});

test("attack rolls against creatures other than you until the end of its next turn; the penalty's time for its floor (Gleaming Cuirass)", () => {
    const rows = outcomes(save(31, {
        Success: "The target takes a –1 status penalty to attack rolls against creatures other than you until the end of its next turn.",
        Failure: "As success, but the penalty lasts for 1 minute.",
        "Critical Failure": `As success, but the penalty lasts for 1 minute. In addition, the target is ${link("Frightened 1")} and can't reduce its frightened value below 1 for the duration of the penalty.`
    }));
    assert.deepEqual(rows.success.modifiers, [{ selector: "attack-roll", against: "others", value: -1, type: "status", duration: { mode: "fixed", value: 1, unit: "rounds", expiry: "turn-end", anchor: "target-turn" } }]);
    assert.deepEqual(rows.failure.modifiers[0].duration, minute);
    assert.deepEqual(rows.criticalFailure.conditionFloor, { slug: "frightened", value: 1, lifetime: "fixed", duration: { value: 1, unit: "minutes", expiry: "turn-start" } });
    assert.equal(rows.criticalFailure.manualInstructions, undefined);
});

test("\"The effects last until the target Escapes\": each row's conditions until then, at the save's DC; a bonus to Escape (Black Tendril Shot)", () => {
    const rows = outcomes(`<p>The target must attempt a @Check[fortitude|dc:25] save. The effects last until the target Escapes.</p><p><strong>Success</strong> The target is ${link("Slowed 1")} but gains a +2 circumstance bonus to Escape the effect.</p><p><strong>Failure</strong> The target is ${link("Slowed 2")}.</p>`);
    assert.deepEqual(rows.failure.effects[0].duration, { mode: "until-escape", escape: { dc: 25 } });
    assert.deepEqual(rows.success.modifiers, [{ selector: "check", predicate: ["action:escape"], value: 2, type: "circumstance", duration: null, escape: { dc: 25 } }]);
});

test("an Escape ends what's named before it, back to a time of its own; a leading \"Until it Escapes\" what follows", () => {
    const rows = outcomes(save(25, {
        Success: `The creature becomes ${link("Clumsy 1")} until the end of its next turn and is ${link("Immobilized")} until it Escapes.`,
        Failure: `The creature is ${link("Restrained")} for 2 rounds or until it Escapes, then ${link("Sickened 1")}.`,
        "Critical Failure": `Until it Escapes, the target is ${link("Drained 1")}.`
    }));
    assert.deepEqual(rows.success.effects.map((effect) => [effect.slug, Boolean(effect.duration?.escape)]), [["clumsy", false], ["immobilized", true]]);
    assert.deepEqual(rows.failure.effects.map((effect) => [effect.slug, Boolean(effect.duration?.escape)]), [["restrained", true], ["sickened", false]]);
    assert.deepEqual(rows.criticalFailure.effects[0].duration, { mode: "until-escape", escape: { dc: 25 } });
});

test("an Escape's DC: its own, \"from the ice (DC 41)\", \"against a DC of 18\", else the effect's", () => {
    assert.deepEqual([escapeIn("Slowed 1 for 1 minute, or until it Escapes from the ice (DC 41).", 30), escapeIn("until it Escapes against a DC of 18", 30), escapeIn("Immobilized until it Escapes.", 30), escapeIn("Immobilized for 1 round.", 30)], [{ dc: 41 }, { dc: 18 }, { dc: 30 }, null]);
});

test("a lowered condition, misfortune and negated invisibility (Gearbinder Oil, Grinning Pugwampi, Squid Ink Sac)", () => {
    const lowered = outcomes(save(20, { Success: "The target reduces its slowed condition by 1.", Failure: `The target is ${link("Slowed 1")}.` }));
    assert.deepEqual(lowered.success.effects, [{ kind: "condition", slug: "slowed", value: 0, duration: null, stack: { by: -1 } }]);
    const unlucky = outcomes(save(30, { Success: "The creature must roll twice and take the worse result on the next check it attempts.", Failure: "The creature must roll twice and take the worse result on all checks until the end of its next turn." }));
    assert.deepEqual(unlucky.success.noteEffects[0].rules, [{ key: "RollTwice", selector: "check", keep: "lower", removeAfterRoll: true }]);
    assert.equal(unlucky.success.noteEffects[0].once, true);
    assert.deepEqual(unlucky.failure.noteEffects[0].duration, { mode: "fixed", value: 1, unit: "rounds", expiry: "turn-end", anchor: "target-turn" });
    const seen = outcomes(save(20, { Success: "The target's invisibility is negated for 2 rounds.", Failure: `The target is ${link("Blinded")} for 1 round. Its invisibility is negated for 1 minute.` }));
    assert.deepEqual(seen.success.noteEffects[0].rules[0], { key: "GrantItem", uuid: "Compendium.pf2e.conditionitems.Item.DmAIPqOBomZ7H95W", predicate: ["self:condition:invisible"], reevaluateOnUpdate: true, allowDuplicate: false });
    assert.deepEqual(seen.failure.noteEffects[0].duration, minute);
    for (const rows of [lowered, unlucky, seen]) assert.equal(rows.success.manualInstructions, undefined);
});

test("a floor until a concentrate action, its GM line gone; kept when it says more of another (Terrifying Ammunition)", () => {
    const rows = outcomes(save(20, {
        Failure: `The creature is ${link("Frightened 1")} and can't reduce its frightened value below 1 until it spends an action, which has the concentrate trait, to calm itself down.`,
        "Critical Failure": `As failure, but the creature can't reduce its frightened condition below 2 for 1 minute. In addition, the dancer is affected by its own stage fright.`
    }));
    assert.deepEqual(rows.failure.conditionFloor, { slug: "frightened", value: 1, lifetime: "until-lifted", liftedBy: "it spends a concentrate action" });
    assert.equal(rows.failure.manualInstructions, undefined);
    assert.match(rows.criticalFailure.manualInstructions[0], /the rest by hand/);
});

test("left to the GM as before: a list with a part unread, another creature's bonus, an \"As success\" whose rest isn't read", () => {
    const rows = outcomes(save(20, {
        Success: "For 1 round, the creature takes a -1 status penalty to attack rolls, saving throws, and skill checks, and its other emotion effects are suppressed.",
        Failure: "The creature takes a –5-foot status penalty to its Speed, and the hunter gains a +5-foot status bonus to its Speeds until the end of its next turn.",
        "Critical Failure": "As success, but the hunter can Stride and drags the creature along."
    }));
    assert.equal(rows.success.modifiers, undefined);
    assert.equal(rows.failure.modifiers, undefined);
    assert.equal(rows.criticalFailure.modifiers, undefined);
    for (const degree of ["success", "failure", "criticalFailure"]) assert.ok(rows[degree].manualInstructions?.length, degree);
});

test("a section's own PF2e Effect: the text's reading when it reads it all; else the Effect, the text's early end on it (Deadweight Snare)", () => {
    const effect = "@UUID[Compendium.pf2e.equipment-effects.Item.TESTEFFECT000001]{Effect: Test Snare (Success)}";
    const read = outcomes(save(20, { Success: `The creature takes a -1 status penalty to attack rolls for 1 round or until it Escapes (DC 18). ${effect}` }));
    assert.deepEqual([read.success.modifiers?.[0]?.escape, read.success.nativeEffects], [{ dc: 18 }, undefined]);
    const missed = outcomes(save(20, { Success: `The creature takes a +1 status bonus on its damage rolls and a -1 status penalty to Reflex saves for 1 round or until it Escapes (DC 18). ${effect}` }));
    assert.equal(missed.success.modifiers, undefined);
    assert.deepEqual(missed.success.nativeEffects, [{ uuid: "Compendium.pf2e.equipment-effects.Item.TESTEFFECT000001", label: "Test Snare (Success)", covers: ["penalty"], escape: { dc: 18 } }]);
    assert.equal(missed.success.manualInstructions, undefined);
});

test("\"As failure\": the copied row's unread words too, on its GM line", () => {
    const rows = outcomes(save(20, { Failure: `The creature is ${link("Sickened 2")} and cannot recover from the sickened condition while within 20 feet of the mage.`, "Critical Failure": "As failure, but sickened 4." }));
    assert.match(rows.criticalFailure.manualInstructions[0], /\(failure: The creature is Sickened 2 and cannot recover/);
});

test("live: an Escape check against an Effect's DC ends it; one with none, by its total; a one-roll misfortune after its roll", () => {
    const items = [{ id: "a", flags: { m: { escape: { dc: 18 } } } }, { id: "b", flags: { m: { escape: { dc: 25 } } } }, { id: "c", flags: {} }];
    assert.deepEqual(escapedItems(items, { options: ["action:escape"], outcome: "success", dc: { value: 18 } }, 19, "m"), ["a"]);
    assert.deepEqual(escapedItems(items, { options: ["action:escape"], outcome: "failure", dc: { value: 18 } }, 12, "m"), []);
    assert.deepEqual(escapedItems(items, { options: ["action:escape"] }, 26, "m"), ["a", "b"]);
    assert.deepEqual(escapedItems(items, { options: ["action:grapple"], outcome: "success", dc: { value: 18 } }, 30, "m"), []);
    const notes = [{ id: "n", flags: { m: { once: true } }, system: { rules: [{ key: "RollTwice", selector: "check", keep: "lower" }] } }];
    assert.deepEqual(spentOnce(notes, { domains: ["check", "skill-check"] }, true, "m"), ["n"]);
    assert.deepEqual(spentOnce(notes, { domains: ["check"] }, false, "m"), []);
    assert.match(escapeWords({ dc: 18 }), /Escapes \(DC 18\): \[\[\/act escape dc=18\]\]\{Escape\}/);
});

test("live: the card's words for an Escape bonus, a penalty against others, its early end, and a lowering", () => {
    assert.equal(modifierTarget({ selector: "check", predicate: ["action:escape"] }), "Escape");
    assert.equal(modifierTarget({ selector: "attack-roll", against: "others" }, "Valeros"), "attack-roll against creatures other than Valeros");
    assert.equal(endWords({ escape: { dc: 27 }, until: "it spends an Interact action" }), " or until it Escapes (DC 27) or until it spends an Interact action");
    const lines = changeLines([
        { op: "effect", target: "t", effect: { kind: "modifier", modifier: { selector: "land-speed", value: -5, type: "status", duration: { mode: "fixed", value: 1, unit: "minutes" }, escape: { dc: 18 } } } },
        { op: "condition", target: "t", slug: "slowed", value: 0, stack: { by: -1 } }
    ], { source: "Snare", t: "Kyra" });
    assert.deepEqual(lines, ["Kyra takes −5 status to land-speed (1 minutes or until it Escapes (DC 18))", "Kyra's slowed drops by 1"]);
});
