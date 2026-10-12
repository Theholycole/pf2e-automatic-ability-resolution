// Random effect tables in live play (2026-10-12, batch 255; the user's choice: rolled and played, not picked): the die rolled
// in chat, the way it picks played as the ability. Pure; rollDie(formula) → the face, the caller's roll.

// The ways a random plan's roll picks: [{ face, way }] (way null: nothing for that face). A way that rolls again ("roll twice")
// rolls that many more, each again on a face that would roll again too.
export async function pickWays(plan, rollDie) {
    const find = (face) => plan.modes.find((mode) => (mode.faces ?? []).includes(face)) ?? null;
    const picks = [];
    const times = Math.max(1, Number(plan.random?.times) || 1);
    for (let count = 0; count < times; count++) {
        const face = await rollDie(plan.random.formula);
        const way = find(face);
        picks.push({ face, way });
        if (!way?.again) continue;
        for (let again = 0; again < way.again; again++) {
            let next = null;
            let rolled = null;
            // (At most 20 tries, should every face roll again.)
            for (let tries = 0; tries < 20 && (!next || next.again); tries++) {
                rolled = await rollDie(plan.random.formula);
                next = find(rolled);
            }
            picks.push({ face: rolled, way: next?.again ? null : next });
        }
    }
    return picks;
}

// A Strike activity with a table of results on a hit (Generate Bomb): the activity with the row of the face rolled — its
// results on a hit, its notes, its name.
export function withRow(plan, face) {
    const row = (plan.randomOnHit?.rows ?? []).find((entry) => entry.faces.includes(face)) ?? null;
    const { randomOnHit, ...rest } = plan;
    if (!row) return rest;
    return { ...rest, onHit: row.onHit, notes: [...(plan.notes ?? []), ...(row.notes ?? [])], rowName: row.name };
}

// Random Strikes' faces (Chaotic Gizmos): the Strike each face makes, or null for one that makes none.
export function strikesFor(plan, faces) {
    return faces.map((face) => plan.faces?.[face] ?? null);
}
