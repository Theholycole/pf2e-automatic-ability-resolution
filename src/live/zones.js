// Zones in live play (2026-10-12, batch 256; the user's call: zones automated, not the GM's): an ability's area that lasts, as a Region
// on the scene. Foundry tells the module when a token enters or leaves it, or starts or ends its turn in it (a script behaviour); PF2e's
// own behaviour makes its difficult terrain. Pure: the Region's data, when it ends, and what each event does.

import { sizeIndex } from "./activity.js";

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
// size (2026-10-26, the item module's snares: "When a Small or larger creature enters the square", Hoof Stakes Snare's "only when a Large
// or larger creature"): the creature's (PF2e's actor.size), for an entry only for that size or larger (entry.only.minSize, "sm" … "grg").
// A smaller one: not that entry — nothing sets the snare off, so it stays. A creature of unknown size fits. (2026-10-27: entry.only.maxSize
// as well, that size or smaller — Trip Snare's "A Medium or smaller creature that enters the snare's square".)
export function onlyFits(entry, traits, size) {
    if (entry?.only?.traits?.length && !entry.only.traits.some((trait) => (traits ?? []).includes(trait))) return false;
    const at = entry?.only?.minSize || entry?.only?.maxSize ? sizeIndex(size) : -1;
    if (at < 0) return true;
    const [low, high] = [entry.only.minSize ? sizeIndex(entry.only.minSize) : -1, entry.only.maxSize ? sizeIndex(entry.only.maxSize) : -1];
    return (low < 0 || at >= low) && (high < 0 || at <= high);
}

export function zoneActions(zone, event, { own = false, allied = false, initial = false, traits = [], size = null } = {}) {
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
        // (2026-10-20: rules for the creatures inside that fit — zone.inside [{ rules, only, who? }]: Incense of Distilled Death's fast healing 4
        // for undead —, its maker too when it fits; who "others": not its maker, "own": its maker only — Maelstromic Destabilizer's weakness to
        // spirit on the others, its holder's resistance.)
        for (const entry of zone.inside ?? []) {
            if (!(entry.rules ?? []).length || !onlyFits(entry, traits, size) || (entry.who === "others" && own) || (entry.who === "own" && !own)) continue;
            actions.push({ kind: "inside", rules: entry.rules.map((rule) => ({ ...rule })) });
        }
    }
    // (2026-10-20: a save its maker attempts too — saves[i].own, Candle of Truth's "each creature (including you)".)
    if (own) {
        for (const save of zone.saves ?? []) if (save.own && save.when.includes(when) && onlyFits(save, traits, size)) actions.push(save.plan ? { kind: "save", plan: save.plan } : { kind: "note", text: save.note });
        return actions;
    }
    // (A zone of its allies' gifts, Cleansing Earth's: nothing more on them.)
    if (allied && zone.effect?.allies) return actions;
    // (2026-10-27, the item module's snares that burst — Shrapnel Snare, Puff Dragon, Bomb Snare: zone.burst { area, plan, from?, only? }: one
    // save card of its plan on everyone in that area, the creature that set it off among them, when a creature that fits enters.)
    if (when === "enter" && zone.burst?.plan && onlyFits(zone.burst, traits, size)) actions.push({ kind: "burst", burst: zone.burst });
    if (when === "enter" && zone.hazard?.formulas?.length && onlyFits(zone.hazard, traits, size)) actions.push({ kind: "hazard", formulas: [...zone.hazard.formulas] });
    for (const save of zone.saves ?? []) {
        if (!save.when.includes(when) || !onlyFits(save, traits, size)) continue;
        actions.push(save.plan ? { kind: "save", plan: save.plan } : { kind: "note", text: save.note });
    }
    for (const entry of zone.damage ?? []) if (entry.when === when && onlyFits(entry, traits, size)) actions.push({ kind: "damage", formulas: [...entry.formulas] });
    return actions;
}

// A zone that's gone once it acts (2026-10-15, the item module's snares: "the first creature to enter the square"): whether what an event
// did sets it off. A save, damage or a note on the creature does; what entering gives everyone (concealment, penalties inside) doesn't.
// (2026-10-16: one that leaves an area where it was, zone.then — Smoke Screen Snare —: any creature's entering sets it off.)
const SETS_OFF = new Set(["save", "damage", "hazard", "note", "effect", "burst"]);
export function zoneSetOff(zone, actions) {
    return !!zone?.once && (!!zone.then || actions.some((action) => SETS_OFF.has(action.kind)));
}

// Whether a burst (zone.burst.area) reaches a creature's space (boxes { x, y, w, h, elevation } in pixels, as the auras' box gives them),
// from its origin — the snare's square, or the space of the creature that set it off. An emanation or a burst: within its feet of the
// origin by PF2e's distance (distance: the core's distanceFeet); a square: that many feet across, centred on the origin.
export function burstReaches(burst, origin, space, grid, distance) {
    const feet = Number(burst?.area?.value) || 0;
    if (burst?.area?.type !== "square") return distance(origin, space, grid) <= feet;
    const reach = Math.max(0, Math.floor((Math.round(feet / grid.gridFeet) - 1) / 2));
    const out = reach * grid.size;
    const level = Math.round(Math.abs((Number(origin.elevation) || 0) - (Number(space.elevation) || 0)) / grid.gridFeet);
    return space.x < origin.x + origin.w + out && space.x + space.w > origin.x - out && space.y < origin.y + origin.h + out && space.y + space.h > origin.y - out && level <= reach;
}

// The card's words for a burst's reach: "within 10 feet of its square".
export function burstWords(burst) {
    const feet = Number(burst?.area?.value) || 0;
    const from = burst?.from === "creature" ? "it" : "its square";
    if (AIMED.has(burst?.area?.type)) return `in its ${feet}-foot ${burst.area.type} back the way it came`;
    return burst?.area?.type === "square" ? `in the ${feet}-foot square around ${from}` : `within ${feet} feet of ${from}`;
}

// --- Aimed bursts (2026-10-27, the item module's Flame Drake Snare: "a 15-foot cone in the direction from which the creature entered",
// Frost Worm Snare's 30-foot line): burst.area { type: "cone" | "line", value }, aimed from the snare's square back the way the creature
// that set it off came in. The squares it covers are PF2e's own for its cone and line areas (its RegionDocumentPF2e coverage): a square
// whose centre is inside the shape, by PF2e's grid distance from the cone's point, and not behind a wall from it (the script's test).

export const AIMED = new Set(["cone", "line"]);

// A token's space at a top-left point (width, height in squares; a Tiny one's is the square its point is in), in pixels.
const spaceAt = (point, width, height, size) => {
    const square = (value, span) => (span < 1 ? Math.floor(value / size) * size : value);
    return { x: square(point.x, width), y: square(point.y, height), w: Math.max(1, width) * size, h: Math.max(1, height) * size };
};
const overlaps = (space, square, size) => space.x < square.x + size && space.x + space.w > square.x && space.y < square.y + size && space.y + space.h > square.y;

// The way the creature came into the snare's square, as one of the 8 directions { dx, dy } (y down) pointing back along it: from its
// path (the move's origin then the waypoints it passed, top-left points), the part along which its space first covers the square, turned
// round. null when its path doesn't come in from outside (a token made there, or one that started its move in the square).
export function entryDirection(path, { width = 1, height = 1 } = {}, square, size) {
    const points = (path ?? []).filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
    if (!points.length || overlaps(spaceAt(points[0], width, height, size), square, size)) return null;
    for (let index = 1; index < points.length; index++) {
        const [from, to] = [points[index - 1], points[index]];
        const [dx, dy] = [to.x - from.x, to.y - from.y];
        const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (size / 4));
        if (!steps) continue;
        for (let step = 1; step <= steps; step++) {
            const at = { x: from.x + (dx * step) / steps, y: from.y + (dy * step) / steps };
            if (!overlaps(spaceAt(at, width, height, size), square, size)) continue;
            const turn = Math.round(Math.atan2(-dy, -dx) / (Math.PI / 4));
            return { dx: Math.round(Math.cos((turn * Math.PI) / 4)) || 0, dy: Math.round(Math.sin((turn * Math.PI) / 4)) || 0 };
        }
    }
    return null;
}

// The aimed area's shape, as a Region's (PF2e's cone and line): from the snare's square's edge (aimed straight) or corner (aimed
// diagonally) in that direction. square: its top-left point; grid { size, gridFeet }.
export function aimedShape(burst, square, direction, grid) {
    const half = grid.size / 2;
    const x = square.x + half + direction.dx * half;
    const y = square.y + half + direction.dy * half;
    const rotation = (360 + (Math.atan2(direction.dy, direction.dx) * 180) / Math.PI) % 360;
    const reach = ((Number(burst?.area?.value) || 0) / grid.gridFeet) * grid.size;
    return burst?.area?.type === "line" ? { type: "line", x, y, length: reach, width: grid.size, rotation } : { type: "cone", x, y, radius: reach, angle: 90, rotation };
}

// PF2e's distance on a square grid between two points: squares along each axis rounded up, diagonals 5 then 10 feet.
const gridDistance = (a, b, { size, gridFeet }) => {
    const [low, high] = [Math.ceil(Math.abs(b.x - a.x) / size), Math.ceil(Math.abs(b.y - a.y) / size)].sort((one, two) => one - two);
    return Math.floor(low * 1.5 + (high - low)) * gridFeet;
};

// The squares an aimed shape covers (as PF2e's coverage does): [{ x, y }] top-left points, and the point they're seen from. blocked
// (origin, point): a wall between (the script's test; none by default).
export function coveredSquares(shape, grid, { blocked = () => false } = {}) {
    const { size } = grid;
    const radians = (shape.rotation * Math.PI) / 180;
    const along = { x: Math.cos(radians), y: Math.sin(radians) };
    let origin;
    let contains;
    if (shape.type === "cone") {
        // (A point inside a square: moved to its edge or corner the cone points out of, as PF2e does.)
        origin = {
            x: shape.x + (shape.x % size === 0 ? 0 : (Math.sign(Math.round(along.x * 100)) / 2) * size),
            y: shape.y + (shape.y % size === 0 ? 0 : (Math.sign(Math.round(along.y * 100)) / 2) * size)
        };
        const low = (360 + ((shape.rotation - shape.angle / 2) % 360)) % 360;
        const high = (360 + ((shape.rotation + shape.angle / 2) % 360)) % 360;
        const within = (angle) => (low < high ? angle >= low && angle <= high : angle >= low || angle <= high);
        const feet = (shape.radius / size) * grid.gridFeet;
        contains = (point) => {
            const [dx, dy] = [point.x - origin.x, point.y - origin.y];
            if (dx === 0 && dy === 0) return true;
            return within((360 + ((Math.atan2(dy, dx) * 180) / Math.PI) % 360) % 360) && gridDistance(point, origin, grid) <= feet;
        };
    } else {
        const across = { x: -along.y, y: along.x };
        const toCorner = (value, part) => (value % size === 0 ? value : value - Math.sign(Math.round(part * 100)) * (size / 2));
        origin = { x: toCorner(shape.x, along.x), y: toCorner(shape.y, along.y) };
        contains = (point) => {
            const [dx, dy] = [point.x - origin.x, point.y - origin.y];
            const forward = dx * along.x + dy * along.y;
            return forward >= 0 && forward <= shape.length && Math.abs(dx * across.x + dy * across.y) <= shape.width / 2;
        };
    }
    const reach = Math.ceil((shape.type === "cone" ? shape.radius : shape.length) / size) + 1;
    const [i, j] = [Math.floor(origin.x / size), Math.floor(origin.y / size)];
    const squares = [];
    for (let di = -reach; di <= reach; di++) {
        for (let dj = -reach; dj <= reach; dj++) {
            const corner = { x: (i + di) * size, y: (j + dj) * size };
            const centre = { x: corner.x + size / 2, y: corner.y + size / 2 };
            if (centre.x < 0 || centre.y < 0 || !contains(centre) || blocked(origin, centre)) continue;
            squares.push(corner);
        }
    }
    return { origin, squares };
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
// rules (kind "inside", 2026-10-20): the zone's own rule elements for a creature inside that fits (zone.inside).
export function zoneMemberEffect({ name, kind, modifiers = [], adjustments = [], rules: given = [], concealedUuid, regionUuid, moduleId, img = "icons/svg/mystery-man.svg" }) {
    const rules = kind === "inside" ? given.map((rule) => ({ ...rule }))
        : kind === "conceal"
        ? [{ key: "GrantItem", uuid: concealedUuid, flag: "concealed", allowDuplicate: true, onDeleteActions: { granter: "cascade", grantee: "cascade" } }, { key: "Note", selector: ["attack-roll"], title: name, text: `Creatures outside ${name} are concealed to you: DC 5 flat check.` }]
        : kind === "adjust"
            ? adjustments.map((entry) => ({ key: "AdjustDegreeOfSuccess", selector: entry.selector, ...(entry.predicate?.length ? { predicate: [...entry.predicate] } : {}), adjustment: { ...entry.adjustment } }))
            // (2026-10-20: a modifier's predicate — Candle of Truth's −4 to Deception only to Lie, ["action:lie"].)
            : modifiers.map((modifier) => ({ key: "FlatModifier", selector: modifier.selector, value: modifier.value, type: modifier.type ?? "untyped", label: name, ...(modifier.predicate?.length ? { predicate: [...modifier.predicate] } : {}) }));
    return {
        name: kind === "conceal" ? `${name}: inside (concealed)` : `${name}: inside`,
        type: "effect",
        img,
        system: { duration: { value: -1, unit: "unlimited", expiry: null, sustained: false }, rules, description: { value: `<p>Inside <strong>${String(name).replace(/[&<>"']/g, "")}</strong>.${kind === "conceal" ? " Concealed; creatures outside are concealed to it (DC 5 flat check)." : ""}</p>` } },
        flags: { [moduleId]: { zone: regionUuid } }
    };
}
