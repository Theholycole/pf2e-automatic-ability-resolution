// Creatures an ability makes or becomes (2026-10-13, batch 295): tokens of their own beside their maker. Pure: their actor's data, where they
// stand, and how a merged creature's Hit Points go back to the creatures it was made of.

import { SUMMON_LEVELS } from "../compiler/summons.js";

const SIZE_SQUARES = { tiny: 1, sm: 1, small: 1, med: 1, medium: 1, lg: 2, large: 2, huge: 3, grg: 4, gargantuan: 4 };
const PF2E_SIZES = { tiny: "tiny", small: "sm", medium: "med", large: "lg", huge: "huge", gargantuan: "grg" };

// A token's name for one of them: "Hyakume's Eye Probe 3" (numbered when there are several).
export const conjuredName = (maker, name, index, count) => `${maker}'s ${name}${count > 1 ? ` ${index + 1}` : ""}`;

// A creature with only the numbers the ability gives (AC, Hit Points, Speeds; none for a marker): an NPC's data at its maker's level.
// alliance: its maker's side ("party", "opposition", null for neutral), when given. (Batch 297: its saves, and traits.)
export function conjuredActorData({ name, size = "tiny", stats = null, level = 0, alliance, traits = [], img = "icons/svg/mystery-man.svg", moduleId, flags = {} }) {
    const speeds = stats?.speeds ?? {};
    const others = Object.entries(speeds).filter(([type]) => type !== "land").map(([type, value]) => ({ type, value: Number(value) }));
    return {
        name,
        type: "npc",
        img,
        system: {
            details: { level: { value: Number(level) || 0 }, ...(alliance !== undefined ? { alliance } : {}), publicNotes: stats ? "" : "<p>A marker: it has no statistics of its own.</p>" },
            attributes: {
                ac: { value: Number(stats?.ac) || 10 },
                hp: { value: Number(stats?.hp) || 1, max: Number(stats?.hp) || 1 },
                speed: { value: Number(speeds.land) || 0, otherSpeeds: others }
            },
            ...(stats?.saves ? { saves: Object.fromEntries(["fortitude", "reflex", "will"].map((save) => [save, { value: Number(stats.saves[save]) || 0 }])) } : {}),
            traits: { size: { value: PF2E_SIZES[String(size).toLowerCase()] ?? "tiny" }, value: [...traits] }
        },
        prototypeToken: { name, actorLink: false, width: SIZE_SQUARES[String(size).toLowerCase()] ?? 1, height: SIZE_SQUARES[String(size).toLowerCase()] ?? 1, texture: { src: img } },
        flags: { [moduleId]: { conjured: flags } }
    };
}

// Free squares around a token, nearest ring first: [{ x, y }] in pixels, `count` of them, each `squares` wide, inside the scene's bounds
// ({ x, y, width, height } in pixels) and not on another token. token: { x, y, width, height } (x, y in pixels, width and height in squares).
// (2026-10-27, the item module's boats: squares { width, height } for a token that isn't square — a 1-by-2 Rowboat —, or one number.)
export function placements({ token, grid, count, squares = 1, occupied = [], bounds = null }) {
    const size = grid.size;
    const wide = Math.max(1, Number(squares?.width ?? squares) || 1);
    const tall = Math.max(1, Number(squares?.height ?? squares) || 1);
    const taken = occupied.map((entry) => ({ x: entry.x, y: entry.y, right: entry.x + entry.width * size, bottom: entry.y + entry.height * size }));
    const overlaps = (x, y) => taken.some((box) => x < box.right && x + wide * size > box.x && y < box.bottom && y + tall * size > box.y);
    const inside = (x, y) => !bounds || (x >= bounds.x && y >= bounds.y && x + wide * size <= bounds.x + bounds.width && y + tall * size <= bounds.y + bounds.height);
    const found = [];
    for (let ring = 1; ring <= 12 && found.length < count; ring++) {
        const left = token.x - ring * size - (wide - 1) * size;
        const top = token.y - ring * size - (tall - 1) * size;
        const right = token.x + (token.width + ring - 1) * size;
        const bottom = token.y + (token.height + ring - 1) * size;
        for (let y = top; y <= bottom && found.length < count; y += size) {
            for (let x = left; x <= right && found.length < count; x += size) {
                const edge = x === left || x === right || y === top || y === bottom;
                if (!edge || overlaps(x, y) || !inside(x, y)) continue;
                found.push({ x, y });
                taken.push({ x, y, right: x + wide * size, bottom: y + tall * size });
            }
        }
    }
    return found;
}

// A merged creature parting: its Hit Points shared evenly among the `count` it was made of, rounded down; with fewer than one each, the
// first ones get 1 and the rest 0 (they die).
export function shares(total, count) {
    const hp = Math.max(0, Math.floor(Number(total) || 0));
    const each = Math.floor(hp / count);
    if (each >= 1) return Array(count).fill(each);
    return Array.from({ length: count }, (_value, index) => (index < hp ? 1 : 0));
}

// The ones to remove when more would be out than it can keep (Eye Probe's six): the farthest from it first; (batch 297) the oldest first when
// the text says so (Undead, Arise!). tokens: [{ id, x, y, made }].
export function beyondMax(tokens, { max, adding, from, oldest = false }) {
    if (!Number.isFinite(max)) return [];
    const extra = tokens.length + adding - max;
    if (extra <= 0) return [];
    const distance = (token) => Math.hypot(token.x - from.x, token.y - from.y);
    const order = oldest ? (a, b) => (Number(a.made) || 0) - (Number(b.made) || 0) : (a, b) => distance(b) - distance(a);
    return [...tokens].sort(order).slice(0, extra).map((token) => token.id);
}

// (Batch 297.) Numbers from its maker's (Undead, Arise!'s "the same AC and saves as the necromancer", a mount 4 lower with a third of its Hit
// Points): stats.maker { ac, saves } added to the maker's, { hp } a fraction of its maximum; the rest as given. maker: { ac, saves, hp }.
export function makerStats(stats, maker) {
    if (!stats?.maker) return stats;
    const { maker: from, ...rest } = stats;
    const out = { ...rest };
    if (Number.isFinite(from.ac) && Number.isFinite(maker?.ac)) out.ac = maker.ac + from.ac;
    if (Number.isFinite(from.saves) && maker?.saves) out.saves = Object.fromEntries(["fortitude", "reflex", "will"].map((save) => [save, (Number(maker.saves[save]) || 0) + from.saves]));
    if (Number.isFinite(from.hp) && Number.isFinite(maker?.hp)) out.hp = Math.max(1, Math.floor(maker.hp * from.hp));
    return out;
}

// (Batch 297.) The levels a pick allows: { level } (a rune's "specific 1st-level creature") or { maxLevel }, with the rank a summon reached when
// the damage it took heightens it (Detach Soul's "for every additional 10 damage … heightened by 1"): context.damage. { rank, level, maxLevel }.
export function pickLevels(pick, context = {}) {
    if (Number.isFinite(pick?.level)) return { level: pick.level };
    if (Number.isFinite(pick?.maxLevel)) return { maxLevel: pick.maxLevel };
    const by = pick?.rank;
    if (!by) return {};
    const damage = Number(context.damage);
    const rank = Number.isFinite(damage) && by.from === "damage" ? Math.min(by.max ?? 10, by.base + Math.max(0, Math.floor((damage - by.over) / by.per))) : by.base;
    return { rank, maxLevel: SUMMON_LEVELS[rank] ?? null };
}

// (Batch 297.) The creatures a pick offers, from the compendiums' index entries [{ uuid, name, level, traits, type }]: creatures of its level (or
// up to it), with one of `any` traits and all of `all`; one per name (the first pack's), highest level first. (Batch 298: a rune's own creature,
// pick.default, first — found among them, or context.defaultEntry when it's in an adventure's pack — and the others of its level after it.)
export function pickable(entries, pick, context = {}) {
    const wanted = pick?.default ? String(pick.default.name ?? "").toLowerCase() : null;
    const known = pick?.default ? entries.find((entry) => (pick.default.uuid && entry.uuid === pick.default.uuid) || entry.name.toLowerCase() === wanted) ?? context.defaultEntry ?? null : null;
    const levels = pickLevels(pick, context);
    const level = Number.isFinite(levels.level) ? levels.level : Number.isFinite(known?.level) ? known.level : undefined;
    const { maxLevel } = levels;
    const seen = new Set();
    const out = [];
    for (const entry of entries) {
        const traits = entry.traits ?? [];
        if (entry.type && entry.type !== "npc") continue;
        if (Number.isFinite(level) && entry.level !== level) continue;
        if (Number.isFinite(maxLevel) && !(entry.level <= maxLevel)) continue;
        if (pick?.any?.length && !pick.any.some((trait) => traits.includes(trait))) continue;
        if (pick?.all?.length && !pick.all.every((trait) => traits.includes(trait))) continue;
        if (seen.has(entry.name)) continue;
        seen.add(entry.name);
        out.push(entry);
    }
    out.sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
    return known ? [known, ...out.filter((entry) => entry.uuid !== known.uuid && entry.name !== known.name)] : out;
}
