// Zones in live play (2026-10-12, batch 256; the user's call: zones automated, not the GM's): an ability's area that lasts, as a Region
// on the scene. Foundry tells the module when a token enters or leaves it, or starts or ends its turn in it (a script behaviour); PF2e's
// own behaviour makes its difficult terrain. Pure: the Region's data, when it ends, and what each event does.

const NONE = { damage: { mode: "none", multiplier: 0, sourceComponentIds: [] }, effects: [] };

// The script behaviour's source: on the active GM only, the module's handler.
export const zoneScript = (moduleId) => `if (game.users.activeGM?.id !== game.user.id) return;\nawait game.modules.get(${JSON.stringify(moduleId)})?.api?.zoneEvent?.(region, behavior, event);`;

// The rounds it lasts (rolled: a rolled count, "1d4 rounds"), or null when nothing ends it but the GM (dismissed, used again, an hour or
// more, no time said).
export function zoneRounds(lasts, rolled = null) {
    if (!lasts) return null;
    const value = Number.isFinite(rolled) ? rolled : Number(lasts.value);
    if (!Number.isFinite(value)) return null;
    if (lasts.unit === "rounds") return value;
    if (lasts.unit === "minutes") return value * 10;
    return null;
}

// When it ends: { combatantId, round, at } — the start (or the end) of its maker's turn that many rounds on (its next turn this round when
// it hasn't acted yet: acted false); null when it lasts until the GM ends it, or there's no combat.
export function zoneEndsAt(lasts, { round, combatantId, rolled = null, acted = true }) {
    const rounds = zoneRounds(lasts, rolled);
    if (!Number.isFinite(rounds) || rounds <= 0 || !combatantId || !Number.isFinite(round)) return null;
    return { combatantId, round: round + rounds - (acted ? 0 : 1), at: lasts.expiry === "turn-end" ? "turn-end" : "turn-start" };
}

// Whether it has ended, at a turn's start (phase "start") or end ("end"): its maker's turn in its last round or later, or any turn past it.
export function zoneOver(endsAt, { phase, round, combatantId }) {
    if (!endsAt || !Number.isFinite(round)) return false;
    if (round > endsAt.round) return true;
    if (round < endsAt.round || combatantId !== endsAt.combatantId) return false;
    return (phase === "start" && endsAt.at === "turn-start") || (phase === "end" && endsAt.at === "turn-end");
}

// The movement costs of its difficult terrain: { action: difficulty } (2 difficult, 3 greater), walking with travel, as PF2e's own does.
export function zoneDifficulties(terrain) {
    const out = {};
    for (const { movement = ["walk"], difficulty = 2 } of terrain ?? []) {
        for (const action of [...movement, ...(movement.includes("walk") ? ["travel"] : [])]) out[action] = Math.max(out[action] ?? 1, difficulty);
    }
    return out;
}

// The Region's data: { data, place } — its shape at the token (an emanation attached to it, a burst centred on it) or for the GM to place
// (a burst at range, a cone or a line from it: place true), PF2e's difficult terrain, the script behaviour, its flags. token: { id, x, y,
// width, height, shape } (x, y in pixels, width and height in squares); grid: { size, distance }.
export function zoneRegion({ name, zone, token, grid, moduleId, flags, visibility = 2 }) {
    const perFoot = grid.size / grid.distance;
    const radius = Number(zone.area?.value ?? 0) * perFoot;
    const centre = token ? { x: token.x + (token.width * grid.size) / 2, y: token.y + (token.height * grid.size) / 2 } : { x: 0, y: 0 };
    let shape = null;
    let place = false;
    let attach = false;
    // (2026-10-16: an area a snare leaves where it was, zone.then — centre "snare": at its square, never placed, never attached.)
    const atSnare = zone.centre === "snare" && token;
    if (atSnare && ["burst", "emanation"].includes(zone.area?.type)) {
        shape = { type: "circle", x: centre.x, y: centre.y, radius, gridBased: true };
    } else if (atSnare && zone.area?.type === "square") {
        shape = { type: "rectangle", x: centre.x, y: centre.y, width: radius, height: radius, anchorX: 0.5, anchorY: 0.5, rotation: 0, gridBased: true };
    } else if (zone.area?.type === "emanation" && token) {
        shape = { type: "emanation", base: { type: "token", x: token.x, y: token.y, width: token.width, height: token.height, shape: token.shape ?? 0 }, radius, gridBased: true };
        attach = true;
    } else if (zone.area?.type === "burst" && zone.centre !== "placed" && token) {
        shape = { type: "circle", x: centre.x, y: centre.y, radius, gridBased: true };
    } else if (zone.area?.type === "burst" || zone.area?.type === "emanation") {
        shape = { type: "circle", x: centre.x, y: centre.y, radius, gridBased: true };
        place = true;
    } else if (zone.area?.type === "cone") {
        shape = { type: "cone", x: centre.x, y: centre.y, radius, angle: 90, rotation: 0, curvature: "round", gridBased: true };
        place = true;
    } else if (zone.area?.type === "line") {
        shape = { type: "line", x: centre.x, y: centre.y, length: radius, width: grid.size, rotation: 0, gridBased: true };
        place = true;
    } else if (zone.area?.type === "square") {
        // (Batch 262: "a 15-foot by 15-foot area": a square the GM places.)
        shape = { type: "rectangle", x: centre.x, y: centre.y, width: radius, height: radius, anchorX: 0.5, anchorY: 0.5, rotation: 0, gridBased: true };
        place = true;
    }
    if (!shape) return null;
    const difficulties = zoneDifficulties(zone.terrain);
    const behaviors = [
        ...(Object.keys(difficulties).length ? [{ name: `${name}: difficult terrain`, type: "modifyMovementCost", system: { difficulties } }] : []),
        // (Batch 274: a save on each move within it, Tempest Downdrafts': its moves too.)
        { name: `${name}: zone`, type: "executeScript", system: { events: ["tokenEnter", "tokenExit", "tokenTurnStart", "tokenTurnEnd", ...((zone.saves ?? []).some((save) => save.when?.includes("move")) ? ["tokenMoveWithin"] : [])], source: zoneScript(moduleId) } }
    ];
    const color = zone.hazard || zone.damage?.length ? "#a0412d" : zone.concealed ? "#8a94a0" : zone.terrain?.length ? "#7a5c3a" : "#5b6f8c";
    return {
        place,
        data: {
            name,
            color,
            shapes: [shape],
            behaviors,
            visibility,
            highlightMode: "coverage",
            displayMeasurements: false,
            ...(attach && !place ? { attachment: { token: token.id } } : {}),
            flags: { [moduleId]: { zone: flags } }
        }
    };
}

// What a region event does to the token: [{ kind, … }]. On entering: concealed, PF2e's effect inside (its allies only, when so), penalties
// inside; then (not on its maker: own) the hazard's damage, the saves and damage on entering, at a turn's start or end. initial: in the area
// as it's made (a save "as it's made" only, not one on entering). Leaving: clear what the zone gave.
// traits (2026-10-18): the creature's, for a save or damage only for some (entry.only.traits, any of them: Sanctified Beans' fiends, fey,
// ghosts, spirits and undead; Anathema Fulu's chosen trait). A creature with none of them: not that entry.
export const onlyFits = (entry, traits) => !entry?.only?.traits?.length || entry.only.traits.some((trait) => (traits ?? []).includes(trait));

export function zoneActions(zone, event, { own = false, allied = false, initial = false, traits = [] } = {}) {
    if (event === "tokenExit") return [{ kind: "clear" }];
    const when = event === "tokenEnter" ? (initial ? "initial" : "enter") : event === "tokenTurnStart" ? "start" : event === "tokenTurnEnd" ? "end" : event === "tokenMoveWithin" ? "move" : null;
    if (!when) return [];
    const actions = [];
    if (event === "tokenEnter") {
        if (zone.concealed) actions.push({ kind: "conceal" });
        if (zone.effect && (!zone.effect.allies || allied)) actions.push({ kind: "effect", uuid: zone.effect.uuid, label: zone.effect.label });
        if (zone.modifiers?.length) actions.push({ kind: "modifiers", modifiers: zone.modifiers.map((modifier) => ({ ...modifier })) });
        // (Batch 274, Sink or Swim: PF2e's degree adjustments, its allies' on its allies, its foes' on the others; not on itself.)
        const adjustments = (zone.adjustments ?? []).filter((entry) => (entry.allies ? allied : !allied && !own));
        if (adjustments.length) actions.push({ kind: "adjust", adjustments: adjustments.map((entry) => ({ ...entry })) });
    }
    if (own) return actions;
    // (A zone of its allies' gifts, Cleansing Earth's: nothing more on them.)
    if (allied && zone.effect?.allies) return actions;
    if (when === "enter" && zone.hazard?.formulas?.length) actions.push({ kind: "hazard", formulas: [...zone.hazard.formulas] });
    for (const save of zone.saves ?? []) {
        if (!save.when.includes(when) || !onlyFits(save, traits)) continue;
        actions.push(save.plan ? { kind: "save", plan: save.plan } : { kind: "note", text: save.note });
    }
    for (const entry of zone.damage ?? []) if (entry.when === when && onlyFits(entry, traits)) actions.push({ kind: "damage", formulas: [...entry.formulas] });
    return actions;
}

// A zone that's gone once it acts (2026-10-15, the item module's snares: "the first creature to enter the square"): whether what an event
// did sets it off. A save, damage or a note on the creature does; what entering gives everyone (concealment, penalties inside) doesn't.
// (2026-10-16: one that leaves an area where it was, zone.then — Smoke Screen Snare —: any creature's entering sets it off.)
const SETS_OFF = new Set(["save", "damage", "hazard", "note", "effect"]);
export function zoneSetOff(zone, actions) {
    return !!zone?.once && (!!zone.then || actions.some((action) => SETS_OFF.has(action.kind)));
}

// The card's words for a zone's modifiers inside, by their sign (2026-10-19: Sprite Apple's light gives +1 to Performance — "a bonus").
export function modifierWords(modifiers) {
    const values = (modifiers ?? []).map((modifier) => Number(modifier?.value) || 0);
    if (!values.length) return null;
    if (values.every((value) => value > 0)) return values.length === 1 ? "a bonus inside" : "bonuses inside";
    if (values.every((value) => value < 0)) return values.length === 1 ? "a penalty inside" : "penalties inside";
    return "bonuses and penalties inside";
}

// The square a snare's Region stands on, as a one-square token there (its shape's middle): for the area it leaves (zone.then).
export function snareSquare(shape, gridSize) {
    if (!shape) return null;
    const middle = shape.type === "circle" || (shape.type === "rectangle" && shape.anchorX === 0.5 && shape.anchorY === 0.5)
        ? { x: shape.x, y: shape.y }
        : shape.type === "rectangle" ? { x: shape.x + (shape.width ?? gridSize) / 2, y: shape.y + (shape.height ?? gridSize) / 2 }
            : Number.isFinite(shape.x) && Number.isFinite(shape.y) ? { x: shape.x, y: shape.y } : null;
    if (!middle) return null;
    return { id: null, x: Math.floor(middle.x / gridSize) * gridSize, y: Math.floor(middle.y / gridSize) * gridSize, width: 1, height: 1, shape: 0 };
}

// Its card once it's set off: who set it off, and no End button when none of its areas are left.
export function spentZoneCard(content, { who, left = 0 }) {
    const line = `<p><em>${String(who ?? "A creature").replace(/[&<>"']/g, "")} set it off; it's gone.</em></p>`;
    const button = /<button type="button" data-zone-end>[\s\S]*?<\/button>/;
    if (button.test(content)) return content.replace(button, (found) => (left > 0 ? `${line}${found}` : line));
    return content.replace(/<\/section>\s*$/, `${line}</section>`);
}

// A card's plan for damage the zone deals with no save (at a turn's end, a hazard on entering): the formulas, applied as rolled.
export function zoneDamagePlan(name, formulas) {
    return {
        modelVersion: 13,
        source: { name },
        rank: 1,
        traits: [],
        activation: { time: "free", traits: [] },
        automation: { level: "automatic" },
        targeting: { target: "1 creature", range: null, area: null },
        trigger: { event: "zone" },
        resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: { ...NONE }, success: { damage: { mode: "formulas", formulas: formulas.map((formula) => ({ formula })), rollScope: "target" }, effects: [] }, failure: { ...NONE }, criticalFailure: { ...NONE } } }
    };
}

// The Effect a creature holds while inside: concealed (PF2e's condition, granted; a note on its attacks out), the zone's penalties, or (batch 274)
// PF2e's degree adjustments ("a success … to Swim is a critical success instead").
export function zoneMemberEffect({ name, kind, modifiers = [], adjustments = [], concealedUuid, regionUuid, moduleId, img = "icons/svg/mystery-man.svg" }) {
    const rules = kind === "conceal"
        ? [{ key: "GrantItem", uuid: concealedUuid, flag: "concealed", allowDuplicate: true, onDeleteActions: { granter: "cascade", grantee: "cascade" } }, { key: "Note", selector: ["attack-roll"], title: name, text: `Creatures outside ${name} are concealed to you: DC 5 flat check.` }]
        : kind === "adjust"
            ? adjustments.map((entry) => ({ key: "AdjustDegreeOfSuccess", selector: entry.selector, ...(entry.predicate?.length ? { predicate: [...entry.predicate] } : {}), adjustment: { ...entry.adjustment } }))
            : modifiers.map((modifier) => ({ key: "FlatModifier", selector: modifier.selector, value: modifier.value, type: modifier.type ?? "untyped", label: name }));
    return {
        name: kind === "conceal" ? `${name}: inside (concealed)` : `${name}: inside`,
        type: "effect",
        img,
        system: { duration: { value: -1, unit: "unlimited", expiry: null, sustained: false }, rules, description: { value: `<p>Inside <strong>${String(name).replace(/[&<>"']/g, "")}</strong>.${kind === "conceal" ? " Concealed; creatures outside are concealed to it (DC 5 flat check)." : ""}</p>` } },
        flags: { [moduleId]: { zone: regionUuid } }
    };
}
