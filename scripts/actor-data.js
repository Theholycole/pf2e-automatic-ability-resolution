// The creature an ability belongs to, as the compiler reads it (2026-10-12): its source data, as PF2e's packs give it — the way the
// offline compiles, the simulator's bestiary runs and the tests read it (its level and size, its Strikes' names and damage, the other
// abilities it has). Without it, readings that need the creature came out differently live, 519 of them to nothing (Trample, Drain
// Life, Focus Gaze …). One copy per actor, until the actor, its token or one of its items changes.

const copies = new WeakMap();

export function actorData(actor) {
    if (!actor || typeof actor.toObject !== "function") return null;
    let data = copies.get(actor);
    if (!data) {
        data = actor.toObject();
        copies.set(actor, data);
    }
    return data;
}

function forget(actor) {
    if (actor) copies.delete(actor);
}

export function watchActors() {
    Hooks.on("updateActor", (actor) => forget(actor));
    Hooks.on("updateToken", (token) => forget(token.actor));
    for (const hook of ["createItem", "updateItem", "deleteItem"]) Hooks.on(hook, (item) => forget(item.parent));
}
