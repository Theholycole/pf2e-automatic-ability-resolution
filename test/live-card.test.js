import test from "node:test";
import assert from "node:assert/strict";

import { abilitySlug, actionCounts, allRolled, cardCheck, cardHTML, damageExtras, changeLines, checkLine, createCard, createCastCard, createModeCard, incapacitates, parseIdentifier, recordRoll, rollIdentifier } from "../src/live/card.js";

const breath = {
    source: { name: "Avalanche Breath", slug: "avalanche-breath" },
    resolution: { kind: "save", check: { roll: "save", statistic: "reflex", basic: true, against: { dc: "fixed", value: 33 } } }
};
const grab = {
    source: { name: "Grab", slug: "grab" },
    resolution: { kind: "check", check: { roll: "skill", statistic: "athletics", against: { dc: "target", statistic: "fortitude" } } }
};

test("a card's check: a save against a fixed DC, or the user's check against each target's DC", () => {
    assert.deepEqual(cardCheck(breath), { kind: "save", statistic: "reflex", dc: 33, basic: true });
    assert.deepEqual(cardCheck(grab), { kind: "check", statistic: "athletics", against: "fortitude" });
    assert.equal(cardCheck({ resolution: { kind: "save", check: { roll: "save", statistic: "will", against: { dc: "spell" } } } }), null);
});

test("a card's moveFrom: the token its pushes and pulls are measured from, kept on the state (the item module's Dispersing Bullet)", () => {
    const plain = createCard({ plan: breath, ability: { name: "Avalanche Breath" }, source: { actorUuid: "Actor.x", tokenUuid: "Scene.s.Token.src", name: "Dragon" }, targets: [{ actorUuid: "Actor.a", name: "Valeros" }] });
    assert.equal(plain.moveFrom, undefined);
    const moved = createCard({ plan: breath, ability: { name: "Dispersing Bullet" }, source: { actorUuid: "Actor.x", tokenUuid: "Scene.s.Token.src", name: "Gunner" }, targets: [{ actorUuid: "Actor.a", name: "Valeros" }], moveFrom: "Scene.s.Token.hit" });
    assert.equal(moved.moveFrom, "Scene.s.Token.hit");
});

test("a card's state: targets, rolls recorded by identifier, Apply when all have rolled", () => {
    const state = createCard({ plan: breath, ability: { name: "Avalanche Breath", uuid: "Actor.x.Item.y" }, source: { actorUuid: "Actor.x", name: "Dragon" }, targets: [{ actorUuid: "Actor.a", name: "Valeros" }, { actorUuid: "Actor.b", name: "Seelah" }] });
    assert.deepEqual(state.targets.map((target) => target.id), ["t0", "t1"]);
    assert.equal(parseIdentifier(rollIdentifier("msg123", "t1")).targetId, "t1");
    assert.equal(parseIdentifier("strike.1.2"), null);
    let next = recordRoll(state, "t0", { total: 24, natural: 12, degree: "failure" });
    assert.equal(allRolled(next), false);
    assert.match(cardHTML(next), /data-aar-action="apply" data-gm-only="true" disabled/);
    next = recordRoll(next, "t1", { total: 35, natural: 18, degree: "success" });
    assert.equal(allRolled(next), true);
    const html = cardHTML(next);
    assert.match(html, /DC 33 basic Reflex save/);
    assert.match(html, /24: failure/);
    assert.doesNotMatch(html, /data-aar-action="apply" data-gm-only="true" disabled/);
    assert.equal(recordRoll(state, "t0", { total: 1, degree: "nonsense" }), state);
});

test("what Apply did, in plain lines", () => {
    const lines = changeLines([
        { op: "damage", target: "t0", instances: [{ type: "bludgeoning", amount: 24 }] },
        { op: "condition", target: "t0", slug: "grabbed", value: null },
        { op: "move", target: "t1", kind: "push", distance: 10 },
        { op: "affliction", target: "t1", data: { name: "Giant Scorpion Venom", stage: 1 } },
        { op: "effect", target: "t1", effect: { kind: "swallow", damage: "(2d8+5)[bludgeoning]", rupture: 20 } }
    ], { t0: "Valeros", t1: "Seelah" });
    assert.deepEqual(lines, ["Valeros takes 24 bludgeoning", "Valeros is grabbed", "Seelah is pushed 10 feet", "Seelah is afflicted with Giant Scorpion Venom (stage 1)", "Seelah is swallowed (grabbed and slowed 1; takes (2d8+5)[bludgeoning] at the end of each of its turns; Rupture 20)"]);
});

test("off-guard to one creature: its attacks, or only its next melee attack", () => {
    const lines = changeLines([
        { op: "condition", target: "t0", slug: "off-guard", value: null, scope: { attacker: "source", attacks: "melee", uses: 1 } },
        { op: "condition", target: "source", slug: "off-guard", value: null, scope: { attacker: "t0", attacks: "melee", uses: null } },
        { op: "condition", target: "t0", slug: "off-guard", value: null, scope: { attacker: "source", attacks: "any", uses: 1 } }
    ], { source: "Merisiel", t0: "Giant Scorpion" });
    assert.deepEqual(lines, ["Giant Scorpion is off-guard to Merisiel's next melee attack", "Merisiel is off-guard to Giant Scorpion's melee attacks", "Giant Scorpion is off-guard to Merisiel's next attack"]);
});

test("Disarm: a weakened grip has a line; a dropped weapon is named when it falls", () => {
    const lines = changeLines([
        { op: "effect", target: "t0", effect: { kind: "disarm", what: "weaken", penalty: 2 } },
        { op: "effect", target: "t0", effect: { kind: "disarm", what: "drop" } }
    ], { t0: "Seelah" });
    assert.deepEqual(lines, ["Seelah's grip is weakened (−2 to attacks with that weapon)"]);
});

test("by-hand instructions name the user and the target", () => {
    const lines = changeLines([{ op: "note", audience: "gm", target: "t0", text: "Move {target} up to 5 feet, staying within {source}'s reach (by hand).", manual: true }], { source: "Valeros", t0: "Giant Scorpion" });
    assert.deepEqual(lines, ["Move Giant Scorpion up to 5 feet, staying within Valeros's reach (by hand)."]);
});

test("a check card's row shows the user's roll against the target's DC", () => {
    const state = createCard({ plan: grab, ability: { name: "Grab" }, source: { actorUuid: "Actor.s", name: "Snake" }, targets: [{ actorUuid: "Actor.a", name: "Seelah", dc: 22 }] });
    assert.match(cardHTML(recordRoll(state, "t0", { total: 27, natural: 15, degree: "success" })), /Athletics 27 vs DC 22: success/);
});

test("an ability with no slug of its own gets one from its name, for its immunity effects", () => {
    assert.equal(abilitySlug({ source: { slug: "frightful-presence" } }, "Frightful Presence"), "frightful-presence");
    assert.equal(abilitySlug({ source: { slug: null, name: "Baleful Shriek" } }), "baleful-shriek");
    assert.equal(abilitySlug({ source: {} }, "Gogunta's Croak"), "goguntas-croak");
    const state = createCard({ plan: { ...grab, source: { name: "Baleful Shriek", slug: null } }, ability: { name: "Baleful Shriek" }, source: { actorUuid: "Actor.s", name: "Revenant" }, targets: [{ actorUuid: "Actor.a", name: "Seelah" }] });
    assert.equal(state.ability.slug, "baleful-shriek");
});


test("a choice of ways: a GM button for each way, then that way's own card", () => {
    const source = { actorUuid: "Actor.d", tokenUuid: null, name: "Dragon" };
    const state = createModeCard({ modes: [{ name: "Flame", plan: breath }, { name: "Odd Gas", plan: null }], ability: { name: "Breath Weapon", uuid: "Item.b" }, source, targets: [{ actorUuid: "Actor.a", name: "Amiri" }] });
    assert.deepEqual([state.kind, state.status, state.modes.map((mode) => !!mode.plan)], ["modes", "choose", [true, false]]);
    const html = cardHTML(state);
    assert.match(html, /data-aar-action="mode" data-mode="0" data-gm-only="true">Flame</);
    assert.match(html, /data-mode="1" data-gm-only="true">Odd Gas \(by hand\)</);
    // The way's card replaces every key the choice had (a chat flag update merges).
    const card = createCard({ plan: breath, ability: { name: "Breath Weapon (Flame)", uuid: "Item.b" }, source, targets: state.targets });
    assert.deepEqual([card.kind, card.modes, card.actions, card.targets[0].id], ["resolve", null, null, "t0"]);
});

test("damage by the number of actions: the GM picks 1, 2 or 3 actions on the card", () => {
    const troop = { ...breath, resolution: { ...breath.resolution, native: { byActions: { 3: { sharedDamage: { components: [] } }, 1: { sharedDamage: { components: [] } }, 2: { sharedDamage: { components: [] } } } } } };
    assert.deepEqual(actionCounts(troop), [1, 2, 3]);
    assert.deepEqual(actionCounts(breath), []);
    const state = createCard({ plan: troop, ability: { name: "Clash of Steel" }, source: { actorUuid: "Actor.t", name: "Infantry" }, targets: [] });
    assert.equal(state.actions, 1);
    const open = cardHTML({ ...state, actions: 2 });
    assert.match(open, /data-actions="2" data-gm-only="true" class="aar-chosen" disabled>2</);
    assert.match(open, /data-actions="3" data-gm-only="true">3</);
    assert.match(cardHTML({ ...state, actions: 3, status: "applied" }), /With 3 actions/);
    assert.doesNotMatch(cardHTML(createCard({ plan: breath, ability: { name: "Avalanche Breath" }, source: { actorUuid: "Actor.d", name: "Dragon" }, targets: [] })), /aar-actions/);
});

test("an effect card: who gets the effect, allies marked, Apply", async () => {
    const { createEffectCard } = await import("../src/live/card.js");
    const plan = (recipients, area = null) => ({ source: { name: "Test Cry" }, targeting: { target: null, range: null, area }, resolution: { kind: "effect", applications: [{ kind: "native-spell-effect", uuid: "Compendium.pf2e.bestiary-effects.Item.AAAAAAAAAAAAAAA4", label: "Effect: Test Cry", recipients }] } });
    const source = { actorUuid: "Actor.c", tokenUuid: null, name: "Chief" };
    const allies = createEffectCard({ plan: plan("allies-in-area", { type: "emanation", value: 60 }), ability: { name: "Test Cry" }, source, targets: [{ actorUuid: "Actor.o", name: "Orc", allied: true }, { actorUuid: "Actor.v", name: "Valeros", allied: false }] });
    const html = cardHTML(allies);
    assert.match(html, /Effect: Test Cry on its allies within 60 feet/);
    assert.match(html, /Orc<\/span><span class="aar-result">ally/);
    assert.match(html, /Valeros<\/span><span class="aar-result">not an ally: left out/);
    assert.match(html, /data-aar-action="apply" data-gm-only="true">Apply/);
    // On itself: no targets, Apply at once.
    const self = createEffectCard({ plan: plan("self"), ability: { name: "Test Guard" }, source, targets: [{ actorUuid: "Actor.v", name: "Valeros" }] });
    assert.deepEqual(self.targets, []);
    assert.doesNotMatch(cardHTML(self), /Use my targets|disabled/);
    assert.deepEqual(changeLines([{ op: "effect", target: "source", effect: { kind: "native", uuid: "x", label: "Effect: Test Guard" } }], { source: "Chief" }), ["Chief gets Effect: Test Guard"]);
});

test("a card line for a creature that dies", () => {
    assert.deepEqual(changeLines([{ op: "death", target: "t0" }, { op: "death", target: "t0", ifReducedTo: 0 }], { t0: "Valeros" }), ["Valeros dies"]);
});

test("a cast card: the spell, its rank and DC as fields the GM can change, what the ability changes, Cast", () => {
    const plan = { builtin: "cast-spell", source: { name: "Test Haunt" }, spell: { uuid: "Compendium.pf2e.spells-srd.Item.AAAAAAAAAAAAAAD2", name: "Possession" }, rank: null, dc: 23, attack: null, tradition: null, notes: ["This has the same effect as the Possession spell (DC 23 Will), except the test ghost has no body to leave behind."] };
    const state = createCastCard({ plan, ability: { name: "Test Haunt", uuid: "Actor.a.Item.b" }, source: { actorUuid: "Actor.a", name: "Test Ghost" }, spell: { uuid: plan.spell.uuid, name: "Possession" }, rank: 7 });
    assert.deepEqual([state.kind, state.rank, state.dc, state.status, state.targets], ["cast", 7, 23, "open", []]);
    const html = cardHTML(state);
    assert.match(html, /Possession \(rank 7, DC 23\)/);
    assert.match(html, /data-aar-field="rank" value="7"/);
    assert.match(html, /data-aar-field="dc" value="23"/);
    assert.match(html, /data-aar-action="cast"[^>]*>Cast Possession</);
    assert.match(html, /<li>This has the same effect as the Possession spell \(DC 23 Will\), except the test ghost has no body to leave behind\.<\/li>/);
    assert.doesNotMatch(cardHTML({ ...state, status: "cast", results: ["Cast Possession at rank 7 (DC 23)."] }), /data-aar-action="cast"/);
    assert.equal(createCastCard({ plan: { builtin: "trample" } }), null);
});

test("a card with no roll: every target affected, Apply at once", () => {
    const plan = { source: { name: "Test Burn" }, resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, outcomes: {} } };
    const state = createCard({ plan, ability: { name: "Test Burn" }, source: { actorUuid: "Actor.m", name: "Test Statue" }, targets: [{ actorUuid: "Actor.v", name: "Valeros" }] });
    assert.deepEqual([state.check.kind, state.targets[0].degree, allRolled(state)], ["automatic", "success", true]);
    const html = cardHTML(state);
    assert.match(html, /no roll/);
    assert.match(html, /Valeros<\/span><span class="aar-result">affected/);
    assert.doesNotMatch(html, /data-aar-action="roll/);
    assert.match(html, /data-aar-action="apply" data-gm-only="true">Apply/);
});

test("a way that casts a spell keeps its plan on the mode card (2026-10-12, batch 179)", () => {
    const cast = { builtin: "cast-spell", spell: { uuid: "Compendium.pf2e.spells-srd.Item.x", name: "Grease" }, rank: null, dc: 20, attack: null, tradition: null, self: false, notes: [] };
    const state = createModeCard({ modes: [{ name: "Puddle", plan: cast }, { name: "Odd Gas", plan: null }], ability: { name: "Test Breath", uuid: "Item.b" }, source: { actorUuid: "Actor.d", tokenUuid: null, name: "Dragon" }, targets: [] });
    assert.deepEqual(state.modes.map((mode) => mode.plan?.builtin ?? null), ["cast-spell", null]);
});

test("zones live: the Region at the token or for the GM to place, its terrain, its end, what each event does (2026-10-12, batch 256)", async () => {
    const { zoneActions, zoneDamagePlan, zoneDifficulties, zoneEndsAt, zoneMemberEffect, zoneOver, zoneRegion, zoneRounds } = await import("../src/live/zones.js");
    const grid = { size: 100, distance: 5 };
    const token = { id: "tok", x: 200, y: 300, width: 2, height: 2, shape: 0 };
    const zone = { area: { type: "emanation", value: 10 }, centre: "self", lasts: { mode: "fixed", value: 1, unit: "minutes", expiry: "turn-start" }, concealed: true, terrain: [{ movement: ["walk"], difficulty: 2 }, { movement: ["fly"], difficulty: 3 }], others: true, hazard: { formulas: ["1[fire]"] }, saves: [{ when: ["enter", "start"], plan: { id: "save" } }, { when: ["initial"], plan: null, note: "Exposed." }], damage: [{ when: "end", formulas: ["2d6[fire]"] }], effect: { uuid: "Compendium.pf2e.bestiary-effects.Item.x", label: "Test" }, modifiers: [] };
    const aura = zoneRegion({ name: "Test Smoke", zone, token, grid, moduleId: "mod", flags: { id: 1 } });
    assert.deepEqual([aura.place, aura.data.attachment, aura.data.shapes[0].type, aura.data.shapes[0].radius, aura.data.shapes[0].base], [false, { token: "tok" }, "emanation", 200, { type: "token", x: 200, y: 300, width: 2, height: 2, shape: 0 }]);
    assert.deepEqual(aura.data.behaviors.map((behavior) => behavior.type), ["modifyMovementCost", "executeScript"]);
    assert.deepEqual(zoneDifficulties(zone.terrain), { walk: 2, travel: 2, fly: 3 });
    assert.match(aura.data.behaviors[1].system.source, /activeGM[\s\S]*zoneEvent/);
    assert.deepEqual(aura.data.flags, { mod: { zone: { id: 1 } } });
    const burst = zoneRegion({ name: "Test Fog", zone: { ...zone, area: { type: "burst", value: 20 }, centre: "placed", terrain: [] }, token, grid, moduleId: "mod", flags: {} });
    assert.deepEqual([burst.place, burst.data.shapes[0].type, burst.data.shapes[0].radius, burst.data.behaviors.length], [true, "circle", 400, 1]);
    const own = zoneRegion({ name: "Test Puff", zone: { ...zone, area: { type: "burst", value: 10 }, centre: "self" }, token, grid, moduleId: "mod", flags: {} });
    assert.deepEqual([own.place, own.data.shapes[0].x, own.data.shapes[0].y], [false, 300, 400]);
    assert.equal(zoneRegion({ name: "Test Cone", zone: { ...zone, area: { type: "cone", value: 15 } }, token, grid, moduleId: "mod", flags: {} }).data.shapes[0].angle, 90);
    // (Batch 262: a square the GM places.)
    const square = zoneRegion({ name: "Test Web", zone: { ...zone, area: { type: "square", value: 15 }, centre: "placed" }, token, grid, moduleId: "mod", flags: {} });
    assert.deepEqual([square.place, square.data.shapes[0].type, square.data.shapes[0].width, square.data.shapes[0].height, square.data.shapes[0].anchorX], [true, "rectangle", 300, 300, 0.5]);
    // Its time: rounds (a minute ten), its maker's turn; for good when it's the GM's to end.
    assert.deepEqual([zoneRounds(zone.lasts), zoneRounds({ value: 2, unit: "rounds" }, 3), zoneRounds({ value: 1, unit: "hours" }), zoneRounds(null)], [10, 3, null, null]);
    const ends = zoneEndsAt({ value: 1, unit: "rounds", expiry: "turn-end" }, { round: 2, combatantId: "c1" });
    assert.deepEqual(ends, { combatantId: "c1", round: 3, at: "turn-end" });
    assert.deepEqual(zoneEndsAt({ value: 1, unit: "rounds", expiry: "turn-start" }, { round: 2, combatantId: "c1", acted: false }), { combatantId: "c1", round: 2, at: "turn-start" });
    assert.deepEqual([zoneOver(ends, { phase: "end", round: 2, combatantId: "c1" }), zoneOver(ends, { phase: "start", round: 3, combatantId: "c1" }), zoneOver(ends, { phase: "end", round: 3, combatantId: "c2" }), zoneOver(ends, { phase: "end", round: 3, combatantId: "c1" }), zoneOver(ends, { phase: "start", round: 4, combatantId: "c2" })], [false, false, false, true, true]);
    // Each event: what entering gives, the saves and damage (not on its maker), clearing on leaving.
    assert.deepEqual(zoneActions(zone, "tokenEnter").map((action) => action.kind), ["conceal", "effect", "hazard", "save"]);
    assert.deepEqual(zoneActions(zone, "tokenEnter", { initial: true }).map((action) => action.kind), ["conceal", "effect", "note"]);
    assert.deepEqual(zoneActions(zone, "tokenEnter", { own: true }).map((action) => action.kind), ["conceal", "effect"]);
    assert.deepEqual(zoneActions(zone, "tokenTurnStart").map((action) => action.kind), ["save"]);
    assert.deepEqual(zoneActions(zone, "tokenTurnEnd").map((action) => [action.kind, action.formulas]), [["damage", ["2d6[fire]"]]]);
    assert.deepEqual(zoneActions(zone, "tokenExit"), [{ kind: "clear" }]);
    assert.deepEqual(zoneActions({ ...zone, effect: { ...zone.effect, allies: true } }, "tokenEnter", { allied: false }).map((action) => action.kind), ["conceal", "hazard", "save"]);
    assert.equal(zoneDamagePlan("Test", ["2d6[fire]"]).resolution.outcomes.success.damage.formulas[0].formula, "2d6[fire]");
    const hidden = zoneMemberEffect({ name: "Test Fog", kind: "conceal", concealedUuid: "Compendium.pf2e.conditionitems.Item.DmAIPqOBomZ7H95W", regionUuid: "Scene.s.Region.r", moduleId: "mod" });
    assert.deepEqual([hidden.system.rules[0].key, hidden.system.rules[0].uuid, hidden.flags.mod.zone], ["GrantItem", "Compendium.pf2e.conditionitems.Item.DmAIPqOBomZ7H95W", "Scene.s.Region.r"]);
    assert.deepEqual(zoneMemberEffect({ name: "Test", kind: "modifiers", modifiers: [{ selector: "reflex", value: -2, type: "status" }], regionUuid: "r", moduleId: "mod" }).system.rules, [{ key: "FlatModifier", selector: "reflex", value: -2, type: "status", label: "Test" }]);
});

test("a zone gone once it acts, the item module's snares: set off by its first creature's save, not by its maker or what entering gives; its card says so (2026-10-15)", async () => {
    const { spentZoneCard, zoneActions, zoneRegion, zoneSetOff } = await import("../src/live/zones.js");
    const snare = { area: { type: "square", value: 5 }, centre: "placed", range: 5, lasts: null, saves: [{ when: ["enter"], plan: { id: "save" } }], once: true, terrain: [], damage: [], modifiers: [], notes: [] };
    const region = zoneRegion({ name: "Test Snare", zone: snare, token: { id: "tok", x: 0, y: 0, width: 1, height: 1 }, grid: { size: 100, distance: 5 }, moduleId: "mod", flags: {} });
    assert.deepEqual([region.place, region.data.shapes[0].type, region.data.shapes[0].width], [true, "rectangle", 100]);
    assert.equal(zoneSetOff(snare, zoneActions(snare, "tokenEnter")), true);
    assert.equal(zoneSetOff(snare, zoneActions(snare, "tokenEnter", { own: true })), false);
    assert.equal(zoneSetOff(snare, zoneActions(snare, "tokenEnter", { initial: true })), false);
    assert.equal(zoneSetOff({ ...snare, once: false }, zoneActions(snare, "tokenEnter")), false);
    assert.equal(zoneSetOff({ ...snare, concealed: true, saves: [] }, zoneActions({ ...snare, concealed: true, saves: [] }, "tokenEnter")), false);
    const card = '<section class="pf2e-aar-zone"><p><strong>Test Snare</strong>: a save on whoever it says.</p><button type="button" data-zone-end><i class="fa-solid fa-xmark"></i> End Test Snare</button></section>';
    assert.equal(spentZoneCard(card, { who: "Goblin <b>", left: 0 }), '<section class="pf2e-aar-zone"><p><strong>Test Snare</strong>: a save on whoever it says.</p><p><em>Goblin b set it off; it\'s gone.</em></p></section>');
    assert.ok(spentZoneCard(card, { who: "Goblin", left: 1 }).includes("it's gone.</em></p><button"));
});

test("a choice of ways keeps its builtins and words; every way in turn; zones that change checks by side and save on moving (2026-10-13, batch 274)", async () => {
    const source = { actorUuid: "Actor.m", tokenUuid: null, name: "Test Mantis" };
    const stance = { builtin: "self-effect", actions: 1, model: { name: "Iron", modifiers: [{ on: "ac", type: "circumstance", value: 2 }] } };
    const ways = createModeCard({ modes: [{ name: "Iron", plan: stance }, { name: "Odd", plan: null, notes: ["Do it by hand."] }], ability: { name: "Test Stances" }, source, targets: [] });
    assert.deepEqual([ways.modes[0].plan?.builtin, ways.modes[1].notes, ways.all], ["self-effect", ["Do it by hand."], undefined]);
    const effect = { resolution: { kind: "effect", applications: [] } };
    const all = createModeCard({ modes: [{ name: "Calm", plan: effect, group: "words" }, { name: "Iron", plan: stance }], ability: { name: "Test Words" }, source, targets: [], all: true });
    assert.deepEqual([all.all, all.used, all.modes[0].plan?.resolution?.kind, all.modes[0].group, all.modes[1].group], [true, [], "effect", "words", undefined]);
    const html = cardHTML({ ...all, used: [0] });
    assert.ok(html.includes("each in turn (1 left)") && !html.includes('data-mode="0"') && html.includes('data-mode="1"'));
    const { zoneActions, zoneMemberEffect, zoneRegion } = await import("../src/live/zones.js");
    const swim = { area: { type: "emanation", value: 30 }, adjustments: [{ allies: true, selector: "athletics", predicate: ["action:swim"], adjustment: { success: "one-degree-better" } }, { allies: false, selector: "athletics", predicate: ["action:swim"], adjustment: { failure: "one-degree-worse" } }] };
    assert.deepEqual(zoneActions(swim, "tokenEnter", { allied: true }).map((action) => action.adjustments.map((entry) => entry.allies)), [[true]]);
    assert.deepEqual(zoneActions(swim, "tokenEnter", {}).map((action) => action.adjustments.map((entry) => entry.allies)), [[false]]);
    assert.deepEqual(zoneActions(swim, "tokenEnter", { own: true }), []);
    assert.deepEqual(zoneMemberEffect({ name: "Test Sea", kind: "adjust", adjustments: [swim.adjustments[1]], regionUuid: "r", moduleId: "mod" }).system.rules, [{ key: "AdjustDegreeOfSuccess", selector: "athletics", predicate: ["action:swim"], adjustment: { failure: "one-degree-worse" } }]);
    const winds = { area: { type: "emanation", value: 30 }, saves: [{ when: ["move"], plan: { id: "gust" } }] };
    assert.deepEqual(zoneActions(winds, "tokenMoveWithin", {}), [{ kind: "save", plan: { id: "gust" } }]);
    assert.deepEqual(zoneActions(winds, "tokenTurnStart", {}), []);
    const region = zoneRegion({ name: "Test Winds", zone: winds, token: { id: "t", x: 0, y: 0, width: 1, height: 1 }, grid: { size: 100, distance: 5 }, moduleId: "mod", flags: {} });
    assert.ok(region.data.behaviors.at(-1).system.events.includes("tokenMoveWithin"));
    assert.ok(!zoneRegion({ name: "Test Sea", zone: swim, token: { id: "t", x: 0, y: 0, width: 1, height: 1 }, grid: { size: 100, distance: 5 }, moduleId: "mod", flags: {} }).data.behaviors.at(-1).system.events.includes("tokenMoveWithin"));
});

test("a cast card where the GM names the spell (2026-10-13, batch 275)", () => {
    const state = createCastCard({ plan: { builtin: "cast-spell", spell: null, pick: { maxRank: 7, rarity: "common" }, dc: 40, notes: [] }, ability: { name: "Test Scales" }, source: { actorUuid: "Actor.d", tokenUuid: null, name: "Test Dragon" }, spell: null, rank: null, dc: 40 });
    assert.deepEqual([state.spell, state.pick], [{ uuid: null, name: "a spell the GM names" }, { maxRank: 7, rarity: "common" }]);
    assert.ok(cardHTML(state).includes('data-aar-field="spell"'));
});

test("a save's own bonus and a save rolled twice reach the card (2026-10-13, batch 286)", () => {
    const save = (check) => ({ resolution: { kind: "save", check: { roll: "save", statistic: "fortitude", basic: false, against: { dc: "fixed", value: 23 }, ...check } } });
    assert.deepEqual(cardCheck(save({ bonus: { value: -2, type: "circumstance" } })), { kind: "save", statistic: "fortitude", dc: 23, basic: false, bonus: { value: -2, type: "circumstance" } });
    assert.deepEqual(cardCheck(save({ misfortune: true })), { kind: "save", statistic: "fortitude", dc: 23, basic: false, misfortune: true });
    assert.deepEqual(cardCheck(save({})), { kind: "save", statistic: "fortitude", dc: 23, basic: false });
});

test("a check at a set modifier, a save's penalty and a misfortune save, on the card (2026-10-13, batch 288)", () => {
    const plan = (check) => ({ resolution: { kind: "check", check, sharedDamage: null, outcomes: {} } });
    const enfold = plan({ roll: "skill", statistic: "enfold", modifier: 16, against: { dc: "target", statistic: "reflex" } });
    assert.deepEqual(cardCheck(enfold), { kind: "check", statistic: "enfold", against: "reflex", modifier: 16 });
    const card = (resolution) => createCard({ plan: { resolution: { sharedDamage: null, outcomes: {}, ...resolution } }, ability: { name: "Test" }, source: { actorUuid: "Actor.a", name: "A" }, targets: [] });
    assert.match(cardHTML(card(enfold.resolution)), /Enfold \+16 against each target(?:'|&#39;)s Reflex DC/);
    assert.match(cardHTML(card({ kind: "save", check: { roll: "save", statistic: "will", basic: false, against: { dc: "fixed", value: 26 }, misfortune: true } })), /DC 26 Will save, rolled twice \(the worse kept\)/);
    assert.match(cardHTML(card({ kind: "save", check: { roll: "save", statistic: "fortitude", basic: false, against: { dc: "fixed", value: 23 }, bonus: { value: -2, type: "circumstance" } } })), /DC 23 Fortitude save \(−2 circumstance\)/);
});

test("2026-10-27: an incapacitation effect's save says so, for PF2e's own adjustment", () => {
    const resolution = { kind: "save", check: { roll: "save", statistic: "will", basic: false, against: { dc: "fixed", value: 25 } } };
    assert.equal(incapacitates({ traits: ["magical"], activation: { traits: ["incapacitation", "auditory"] } }), true);
    assert.equal(incapacitates({ traits: ["incapacitation"] }), true);
    assert.equal(incapacitates({ traits: ["mental"] }), false);
    assert.deepEqual(cardCheck({ traits: ["incapacitation"], resolution }), { kind: "save", statistic: "will", dc: 25, basic: false, incapacitation: true });
    assert.deepEqual(cardCheck({ traits: [], resolution }), { kind: "save", statistic: "will", dc: 25, basic: false });
    assert.equal(checkLine({ check: cardCheck({ activation: { traits: ["incapacitation"] }, resolution }) }), "DC 25 Will save (incapacitation)");
});

test("2026-10-27: a secret check (Essence Prism) — PF2e's blind roll, its result on the card for the GM only; a skill or Lore rolled as a save", () => {
    const resolution = (statistic, extra = {}) => ({ kind: "save", check: { roll: "save", statistic, basic: false, against: { dc: "fixed", value: 30 }, ...extra }, outcomes: {} });
    assert.deepEqual(cardCheck({ resolution: resolution("arcana", { secret: true }) }), { kind: "save", statistic: "arcana", dc: 30, basic: false, secret: true });
    assert.equal(checkLine({ check: cardCheck({ resolution: resolution("arcana", { secret: true }) }) }), "DC 30 Arcana check, rolled in secret");
    assert.equal(checkLine({ check: cardCheck({ resolution: resolution("warfare-lore") }) }), "DC 30 Warfare Lore check");
    const state = createCard({ plan: { resolution: resolution("arcana", { secret: true }) }, ability: { name: "Essence Prism" }, source: { actorUuid: "Actor.x", name: "Ezren" }, targets: [{ actorUuid: "Actor.x", name: "Ezren" }] });
    const rolled = recordRoll(state, state.targets[0].id, { total: 24, natural: 9, degree: "failure" });
    const html = cardHTML({ ...rolled, results: ["Ezren: the prism is set"] });
    assert.match(html, /<span data-aar-gm-text="true"><span class="aar-result aar-failure">24: failure<\/span><\/span><span class="aar-result" data-aar-player-text="true">rolled in secret<\/span>/);
    assert.match(html, /<ul class="aar-applied" data-aar-gm-text="true">/);
    assert.doesNotMatch(cardHTML(recordRoll(createCard({ plan: { resolution: resolution("arcana") }, ability: { name: "X" }, source: { actorUuid: "Actor.x", name: "Ezren" }, targets: [{ actorUuid: "Actor.x", name: "Ezren" }] }), "t0", { total: 24, natural: 9, degree: "failure" })), /data-aar-gm-text/);
});

test("2026-10-27: the user's own skill against a fixed DC, its rows on each target (Mindsponge's DC 28 Medicine)", () => {
    const plan = { resolution: { kind: "save", check: { roll: "skill", statistic: "medicine", against: { dc: "fixed", value: 28 } }, outcomes: {} } };
    assert.deepEqual(cardCheck(plan), { kind: "check", statistic: "medicine", against: null, dc: 28 });
    assert.equal(checkLine({ check: cardCheck(plan) }), "DC 28 Medicine check");
    assert.equal(cardCheck({ resolution: { ...plan.resolution, check: { ...plan.resolution.check, against: { dc: "fixed", value: 0 } } } }), null);
});

test("2026-10-27: a card's damage carries the plan's roll options and the resistance and immunities it ignores (Hunter's Dawn, Soulspark Candle)", () => {
    assert.deepEqual(damageExtras({ resolution: {} }), {});
    assert.deepEqual(damageExtras({ damageOptions: ["item:rune:property:ghost-touch", ""], resolution: { ignoreResistance: [{ value: null, types: ["fire"] }], ignoreImmunity: "fire" } }), { rollOptions: ["item:rune:property:ghost-touch"], ignoreResistance: [{ value: null, types: ["fire"] }], ignoreImmunity: ["fire"] });
});
