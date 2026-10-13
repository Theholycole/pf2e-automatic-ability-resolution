// Creatures an ability makes or becomes (2026-10-13, batch 295): tokens of their own beside their maker. Pure: their actor's data, where they
// stand, and how a merged creature's Hit Points go back to the creatures it was made of.

const SIZE_SQUARES = { tiny: 1, sm: 1, small: 1, med: 1, medium: 1, lg: 2, large: 2, huge: 3, grg: 4, gargantuan: 4 };
const PF2E_SIZES = { tiny: "tiny", small: "sm", medium: "med", large: "lg", huge: "huge", gargantuan: "grg" };

// A token's name for one of them: "Hyakume's Eye Probe 3" (numbered when there are several).
export const conjuredName = (maker, name, index, count) => `${maker}'s ${name}${count > 1 ? ` ${index + 1}` : ""}`;

// A creature with only the numbers the ability gives (AC, Hit Points, Speeds; none for a marker): an NPC's data at its maker's level.
// alliance: its maker's side ("party", "opposition", null for neutral), when given.
export function conjuredActorData({ name, size = "tiny", stats = null, level = 0, alliance, img = "icons/svg/mystery-man.svg", moduleId, flags = {} }) {
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
            traits: { size: { value: PF2E_SIZES[String(size).toLowerCase()] ?? "tiny" }, value: [] }
        },
        prototypeToken: { name, actorLink: false, width: SIZE_SQUARES[String(size).toLowerCase()] ?? 1, height: SIZE_SQUARES[String(size).toLowerCase()] ?? 1, texture: { src: img } },
        flags: { [moduleId]: { conjured: flags } }
    };
}

// Free squares around a token, nearest ring first: [{ x, y }] in pixels, `count` of them, each `squares` wide, inside the scene's bounds
// ({ x, y, width, height } in pixels) and not on another token. token: { x, y, width, height } (x, y in pixels, width and height in squares).
export function placements({ token, grid, count, squares = 1, occupied = [], bounds = null }) {
    const size = grid.size;
    const taken = occupied.map((entry) => ({ x: entry.x, y: entry.y, right: entry.x + entry.width * size, bottom: entry.y + entry.height * size }));
    const overlaps = (x, y) => taken.some((box) => x < box.right && x + squares * size > box.x && y < box.bottom && y + squares * size > box.y);
    const inside = (x, y) => !bounds || (x >= bounds.x && y >= bounds.y && x + squares * size <= bounds.x + bounds.width && y + squares * size <= bounds.y + bounds.height);
    const found = [];
    for (let ring = 1; ring <= 12 && found.length < count; ring++) {
        const left = token.x - ring * size - (squares - 1) * size;
        const top = token.y - ring * size - (squares - 1) * size;
        const right = token.x + (token.width + ring - 1) * size;
        const bottom = token.y + (token.height + ring - 1) * size;
        for (let y = top; y <= bottom && found.length < count; y += size) {
            for (let x = left; x <= right && found.length < count; x += size) {
                const edge = x === left || x === right || y === top || y === bottom;
                if (!edge || overlaps(x, y) || !inside(x, y)) continue;
                found.push({ x, y });
                taken.push({ x, y, right: x + squares * size, bottom: y + squares * size });
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

// The ones to remove when more would be out than it can keep (Eye Probe's six): the farthest from it first. tokens: [{ id, x, y }].
export function beyondMax(tokens, { max, adding, from }) {
    if (!Number.isFinite(max)) return [];
    const extra = tokens.length + adding - max;
    if (extra <= 0) return [];
    const distance = (token) => Math.hypot(token.x - from.x, token.y - from.y);
    return [...tokens].sort((a, b) => distance(b) - distance(a)).slice(0, extra).map((token) => token.id);
}
