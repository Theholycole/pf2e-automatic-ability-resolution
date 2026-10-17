// A condition floor in live play (2026-10-16, for the item module's save rows — Timpani of Panic, Tallow Bombs, Putrescent Glob — and
// monster abilities: "can't reduce its frightened value below 1"): the core's { op: "effect", effect: { kind: "floor", floor } }, the
// spell module's shape. An Effect that grants the condition at the floor's value, locked (PF2e keeps a granted condition while the Effect
// exists, so a lower value stops at the floor):
//   floor { slug, value, lifetime, duration?, persistentDamage?, liftedBy? }
//   - lifetime "fixed": for its duration ({ value, unit, expiry?, anchor? }, "until the end of its next turn" anchored on the target);
//   - "while-persistent": while the creature takes persistent damage of persistentDamage's type (scripts/floors.js ends it with the last);
//   - "until-lifted": until what liftedBy says ("it spends a concentrate action"), the GM's to end (deleting the Effect).
// Pure.

export const FLOOR_CONDITIONS = Object.freeze(["clumsy", "drained", "enfeebled", "frightened", "sickened", "stupefied"]);
const UNITS = ["rounds", "minutes", "hours"];

// Whether the floor is one live play applies.
export function isFloor(floor) {
    if (!floor || !FLOOR_CONDITIONS.includes(floor.slug) || !(Number.isInteger(floor.value) && floor.value >= 1)) return false;
    if (floor.lifetime === "fixed") return Number.isInteger(floor.duration?.value) && floor.duration.value >= 0 && UNITS.includes(floor.duration.unit);
    if (floor.lifetime === "while-persistent") return /^[a-z-]+$/.test(floor.persistentDamage ?? "");
    if (floor.lifetime === "until-lifted") return typeof floor.liftedBy === "string" && floor.liftedBy.trim().length > 3;
    return false;
}

const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// The card's and the Effect's words: "Can't reduce Frightened below 1 for 1 minutes".
export function floorLabel(floor) {
    const name = capital(floor.slug);
    if (floor.lifetime === "while-persistent") return `Can't reduce ${name} below ${floor.value} while taking persistent ${floor.persistentDamage} damage`;
    if (floor.lifetime === "until-lifted") return `Can't reduce ${name} below ${floor.value} until ${floor.liftedBy} (GM: delete this Effect then)`;
    const until = floor.duration?.expiry === "turn-end" && floor.duration.unit === "rounds" && floor.duration.value <= 1 ? "until the end of its next turn" : `for ${floor.duration.value} ${floor.duration.unit}`;
    return `Can't reduce ${name} below ${floor.value} ${until}`;
}

// The Effect's source. context: { moduleId, abilityName, abilityUuid, sourceName, sourceActorUuid, targetActorUuid, conditionUuid, img,
// rounds (a fixed duration's value, counted as live play counts it), worldTime, initiative }.
export function floorEffectSource(floor, context) {
    const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
    const duration = floor.lifetime === "fixed"
        ? { value: context.rounds ?? floor.duration.value, unit: floor.duration.unit, expiry: floor.duration.expiry ?? "turn-start", sustained: false }
        : { value: -1, unit: "unlimited", expiry: null, sustained: false };
    return {
        name: `${context.abilityName}: ${floor.slug} floor`,
        type: "effect",
        img: context.img ?? "icons/svg/downgrade.svg",
        flags: { [context.moduleId]: { conditionFloor: { ...floor }, source: context.sourceActorUuid ?? null } },
        system: {
            description: { value: `<p>${escape(floorLabel(floor))}.</p><p>From <strong>${escape(context.abilityName)}</strong> (${escape(context.sourceName)}).</p>` },
            duration,
            start: { value: context.worldTime ?? 0, initiative: context.initiative ?? null },
            context: { origin: { actor: floor.duration?.anchor === "target-turn" ? context.targetActorUuid ?? null : context.sourceActorUuid ?? null, item: context.abilityUuid ?? null }, target: { actor: context.targetActorUuid ?? null }, roll: null },
            // (The granted condition can't be removed while the floor lasts — grantee "restrict" — and goes with it.)
            rules: [{ key: "GrantItem", uuid: context.conditionUuid, flag: "floor", allowDuplicate: true, alterations: [{ mode: "override", property: "badge-value", value: floor.value }], onDeleteActions: { granter: "cascade", grantee: "restrict" } }]
        }
    };
}

// The Effects to end when persistent damage goes (effects: [{ id, flags }]): the "while-persistent" floors and the conditions that last
// while a persistent damage does (flags.whilePersistent) whose type the creature no longer takes (types: its persistent damage's types left).
export function floorsToLift(effects, types, moduleId) {
    const left = new Set(types);
    return (effects ?? []).filter((effect) => {
        const flags = effect.flags?.[moduleId];
        const floor = flags?.conditionFloor;
        if (floor?.lifetime === "while-persistent") return !left.has(floor.persistentDamage);
        return Boolean(flags?.whilePersistent) && !left.has(flags.whilePersistent);
    }).map((effect) => effect.id);
}

// (2026-10-17, the item module's Sparking Spellgun: "the target is dazzled while the persistent damage lasts" — a row's condition with
// duration { mode: "while", persistent: "electricity" }.) The Effect that grants the condition for as long as the creature takes persistent
// damage of that type; ended with its last one (floorsToLift). context as floorEffectSource's.
export function persistentConditionSource(slug, value, type, context) {
    const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
    const label = `${capital(slug)}${Number.isFinite(value) ? ` ${value}` : ""}`;
    return {
        name: `${context.abilityName}: ${label}`,
        type: "effect",
        img: context.img ?? "icons/svg/downgrade.svg",
        flags: { [context.moduleId]: { whilePersistent: type, source: context.sourceActorUuid ?? null } },
        system: {
            description: { value: `<p>${escape(label)} while taking persistent ${escape(type)} damage.</p><p>From <strong>${escape(context.abilityName)}</strong> (${escape(context.sourceName)}).</p>` },
            duration: { value: -1, unit: "unlimited", expiry: null, sustained: false },
            start: { value: context.worldTime ?? 0, initiative: context.initiative ?? null },
            context: { origin: { actor: context.sourceActorUuid ?? null, item: context.abilityUuid ?? null }, target: { actor: context.targetActorUuid ?? null }, roll: null },
            rules: [{ key: "GrantItem", uuid: context.conditionUuid, flag: "condition", allowDuplicate: true, alterations: Number.isFinite(value) ? [{ mode: "override", property: "badge-value", value }] : [], onDeleteActions: { granter: "cascade", grantee: "cascade" } }]
        }
    };
}
