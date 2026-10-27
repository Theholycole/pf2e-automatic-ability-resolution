import test from "node:test";
import assert from "node:assert/strict";

import { snareSquare, zoneRegion, zoneSetOff } from "../src/live/zones.js";
import { cardCheck, checkLine } from "../src/live/card.js";

// (2026-10-16, for the item module: snares that leave an area where they were — Smoke Screen, Hampering, Shadow Cloak — zone.then.)
const SMOKE = { area: { type: "burst", value: 5 }, centre: "placed", once: true, saves: [], then: { area: { type: "burst", value: 20 }, lasts: { mode: "fixed", value: 1, unit: "minutes" }, concealed: true } };

test("a snare with zone.then is set off by any creature entering, with nothing done to it; one without, only by what it does", () => {
    assert.equal(zoneSetOff(SMOKE, []), true);
    assert.equal(zoneSetOff({ ...SMOKE, then: undefined }, []), false);
    assert.equal(zoneSetOff({ ...SMOKE, then: undefined }, [{ kind: "save" }]), true);
    assert.equal(zoneSetOff({ ...SMOKE, once: false }, []), false);
});

test("its area at the snare's square: the square under the snare's shape, a burst or a square centred there, not placed, not attached", () => {
    const grid = { size: 100, distance: 5 };
    assert.deepEqual(snareSquare({ type: "circle", x: 450, y: 250, radius: 100 }, 100), { id: null, x: 400, y: 200, width: 1, height: 1, shape: 0 });
    assert.deepEqual(snareSquare({ type: "rectangle", x: 400, y: 200, width: 100, height: 100 }, 100), { id: null, x: 400, y: 200, width: 1, height: 1, shape: 0 });
    const square = snareSquare({ type: "circle", x: 450, y: 250, radius: 100 }, 100);
    const smoke = zoneRegion({ name: "Smoke", zone: { ...SMOKE.then, centre: "snare" }, token: square, grid, moduleId: "aar", flags: {} });
    assert.deepEqual([smoke.place, smoke.data.shapes[0].type, smoke.data.shapes[0].x, smoke.data.shapes[0].y, smoke.data.shapes[0].radius, smoke.data.attachment], [false, "circle", 450, 250, 400, undefined]);
    const hampering = zoneRegion({ name: "Hampering", zone: { area: { type: "square", value: 10 }, centre: "snare", terrain: [{ movement: ["walk"] }] }, token: square, grid, moduleId: "aar", flags: {} });
    assert.deepEqual([hampering.place, hampering.data.shapes[0].type, hampering.data.shapes[0].width], [false, "rectangle", 200]);
});

test("a target's Perception against a fixed DC, rolled as a save, is a check on the card", () => {
    const check = cardCheck({ resolution: { check: { roll: "save", statistic: "perception", against: { dc: "fixed", value: 38 } } } });
    assert.deepEqual([check.kind, check.statistic, check.dc], ["save", "perception", 38]);
    assert.equal(checkLine({ check }), "DC 38 Perception check");
    assert.equal(checkLine({ check: { ...check, statistic: "will" } }), "DC 38 Will save");
});

test("2026-10-18: a zone's save or damage only for creatures with some traits (Sanctified Beans' fiends, fey, ghosts, spirits and undead): not on others", async () => {
    const { zoneActions } = await import("../src/live/zones.js");
    const save = { when: ["end"], plan: { source: { name: "Beans" } }, only: { traits: ["fiend", "fey", "ghost", "spirit", "undead"] } };
    const incorporeal = { when: ["end"], plan: { source: { name: "Beans: incorporeal" } }, only: { traits: ["incorporeal"] } };
    const zone = { area: { type: "square", value: 5 }, saves: [save, incorporeal], damage: [{ when: "end", formulas: ["1d6"], only: { traits: ["undead"] } }, { when: "end", formulas: ["1"] }] };
    const kinds = (traits) => zoneActions(zone, "tokenTurnEnd", { traits }).map((action) => action.kind === "save" ? action.plan.source.name : action.formulas[0]);
    assert.deepEqual(kinds(["humanoid"]), ["1"]);
    assert.deepEqual(kinds(["undead"]), ["Beans", "1d6", "1"]);
    assert.deepEqual(kinds(["undead", "incorporeal", "ghost"]), ["Beans", "Beans: incorporeal", "1d6", "1"]);
});

test("2026-10-26: a zone's entry only for a size or larger (only.minSize: the item module's 'Small or larger' snares): a smaller creature gets none and doesn't set the snare off", async () => {
    const { onlyFits, zoneActions, zoneSetOff } = await import("../src/live/zones.js");
    const snare = { once: true, area: { type: "square", value: 5 }, saves: [{ when: ["enter"], note: "The alarm sounds.", only: { minSize: "sm" } }] };
    const hoof = { once: true, area: { type: "square", value: 5 }, saves: [{ when: ["enter"], plan: { id: "hoof" }, only: { minSize: "lg" } }], damage: [{ when: "enter", formulas: ["1d6"], only: { minSize: "lg" } }] };
    assert.deepEqual(zoneActions(snare, "tokenEnter", { size: "tiny" }), []);
    assert.equal(zoneSetOff(snare, zoneActions(snare, "tokenEnter", { size: "tiny" })), false);
    for (const size of ["sm", "med", "grg"]) assert.equal(zoneSetOff(snare, zoneActions(snare, "tokenEnter", { size })), true, size);
    assert.deepEqual(zoneActions(hoof, "tokenEnter", { size: "med" }), []);
    assert.deepEqual(zoneActions(hoof, "tokenEnter", { size: "lg" }).map((action) => action.kind), ["save", "damage"]);
    assert.deepEqual(zoneActions(hoof, "tokenEnter", { size: "huge" }).map((action) => action.kind), ["save", "damage"]);
    // (Unknown size fits; the word works as well as PF2e's slug; traits and size together both have to fit.)
    assert.equal(onlyFits({ only: { minSize: "lg" } }, [], null), true);
    assert.equal(onlyFits({ only: { minSize: "large" } }, [], "med"), false);
    assert.equal(onlyFits({ only: { minSize: "sm", traits: ["undead"] } }, ["undead"], "tiny"), false);
    assert.equal(onlyFits({ only: { minSize: "sm", traits: ["undead"] } }, ["humanoid"], "med"), false);
    assert.equal(onlyFits({ only: { minSize: "sm", traits: ["undead"] } }, ["undead"], "med"), true);
    assert.equal(onlyFits({ only: { traits: ["undead"] } }, ["undead"]), true);
});

test("2026-10-19: a zone card words its modifiers inside by their sign — Sprite Apple's +1 is a bonus", async () => {
    const { modifierWords } = await import("../src/live/zones.js");
    assert.equal(modifierWords([{ selector: "performance", value: 1, type: "item" }]), "a bonus inside");
    assert.equal(modifierWords([{ selector: "ac", value: -2 }]), "a penalty inside");
    assert.equal(modifierWords([{ value: -1 }, { value: -2 }]), "penalties inside");
    assert.equal(modifierWords([{ value: 1 }, { value: -1 }]), "bonuses and penalties inside");
    assert.equal(modifierWords([]), null);
});

test("2026-10-20: a temporary immunity's key — its own (trigger.immunity.slug: an item's grades share one), else the ability's slug, else its name's", async () => {
    const { immunityKey } = await import("../src/live/card.js");
    const { isImmune } = await import("../src/live/auras.js");
    const lesser = { source: { name: "Aetheric Irritant (Lesser)", slug: "aetheric-irritant-lesser" }, trigger: { immunity: { slug: "aetheric-irritant", against: "all", duration: { value: 1, unit: "hours" } } } };
    const major = { ...lesser, source: { name: "Aetheric Irritant (Major)", slug: "aetheric-irritant-major" } };
    assert.equal(immunityKey(lesser), "aetheric-irritant");
    assert.equal(immunityKey(major), immunityKey(lesser), "the grades alike");
    assert.equal(immunityKey({ source: { slug: "stench" }, trigger: { immunity: {} } }), "stench");
    assert.equal(immunityKey({ source: { name: "Frightful Presence" } }), "frightful-presence");
    assert.equal(isImmune([{ immunity: { slug: "aetheric-irritant", source: null } }], { slug: immunityKey(major), source: null }), true);
});

test("2026-10-20: zones for candles and incense — a modifier's predicate on the inside Effect, a save its maker attempts too, rules for those inside that fit", async () => {
    const { zoneActions, zoneMemberEffect } = await import("../src/live/zones.js");
    const truth = { area: { type: "emanation", value: 10 }, modifiers: [{ selector: "deception", value: -4, type: "status", predicate: ["action:lie"] }],
        saves: [{ when: ["enter"], plan: { source: { name: "Truth" } }, own: true }, { when: ["enter"], plan: { source: { name: "Others" } } }] };
    const effect = zoneMemberEffect({ name: "Candle of Truth", kind: "modifiers", modifiers: truth.modifiers, regionUuid: "r", moduleId: "aar" });
    assert.deepEqual(effect.system.rules[0], { key: "FlatModifier", selector: "deception", value: -4, type: "status", label: "Candle of Truth", predicate: ["action:lie"] });
    const names = (options) => zoneActions(truth, "tokenEnter", options).filter((action) => action.kind === "save").map((action) => action.plan.source.name);
    assert.deepEqual(names({ own: true }), ["Truth"], "its maker: the save that says so, not the other");
    assert.deepEqual(names({}), ["Truth", "Others"]);
    const incense = { area: { type: "emanation", value: 20 }, inside: [{ rules: [{ key: "FastHealing", value: 4 }], only: { traits: ["undead"] } }] };
    const inside = (traits, own = false) => zoneActions(incense, "tokenEnter", { traits, own }).filter((action) => action.kind === "inside");
    assert.deepEqual(inside(["undead"]).map((action) => action.rules), [[{ key: "FastHealing", value: 4 }]]);
    assert.deepEqual(inside(["humanoid"]), []);
    assert.equal(inside(["undead"], true).length, 1, "its maker too when it fits");
    // (who: "others" not its maker, "own" its maker only — a gadget's weakness on the others, its holder's resistance.)
    const gadget = { area: { type: "emanation", value: 10 }, inside: [{ rules: [{ key: "Resistance", type: "spirit", value: 5 }], who: "own" }, { rules: [{ key: "Weakness", type: "spirit", value: 5 }], who: "others" }] };
    const keys = (own) => zoneActions(gadget, "tokenEnter", { own }).filter((action) => action.kind === "inside").map((action) => action.rules[0].key);
    assert.deepEqual([keys(true), keys(false)], [["Resistance"], ["Weakness"]]);
    assert.deepEqual(zoneMemberEffect({ name: "Incense", kind: "inside", rules: [{ key: "FastHealing", value: 4 }], regionUuid: "r", moduleId: "aar" }).system.rules, [{ key: "FastHealing", value: 4 }]);
});
