// Swallow Whole and Engulf in live play, the pure part (scripts/swallow.js is
// the Foundry side). PF2e's glossary text: a swallowed creature is grabbed and
// slowed 1, takes the listed damage when swallowed and at the end of each of
// its turns, can attack the monster only with unarmed attacks or light
// weapons (the monster is off-guard to them), gets out by Escaping or when the
// monster takes piercing or slashing damage of at least the Rupture value
// from a single attack or spell, and if the monster dies, adjacent creatures
// cut it open with 3 actions.

// The effect on the swallowed creature. swallow: the core's change
// ({ damage, rupture, escapeDC }); source: { actorUuid, tokenUuid, name };
// ability: { name, img }; templates: the grabbed, slowed and off-guard
// conditions' compendium UUIDs; slug: its token mark.
export function swallowedEffect(moduleId, { swallow, source, ability, templates, slug, time }) {
    const flag = { by: source.name, byActor: source.actorUuid, byToken: source.tokenUuid, ability: ability.name, damage: swallow.damage, rupture: swallow.rupture ?? null, escapeDC: swallow.escapeDC ?? null };
    const grant = (uuid, name, value = null) => ({ key: "GrantItem", uuid, flag: name, allowDuplicate: true, alterations: Number.isFinite(value) ? [{ mode: "override", property: "badge-value", value }] : [], onDeleteActions: { granter: "cascade", grantee: "cascade" } });
    const rules = [grant(templates.grabbed, "swallowGrabbed"), grant(templates.slowed, "swallowSlowed", 1)];
    // Its attacks find the monster off-guard (PF2e 8.5 gives the mark as self:mark on the target's side).
    if (source.tokenUuid && templates.offGuard) {
        rules.push({ key: "TokenMark", slug, uuid: source.tokenUuid });
        rules.push({ key: "EphemeralEffect", affects: "target", selectors: ["strike-attack-roll"], uuid: templates.offGuard, predicate: [{ or: [`target:mark:${slug}`, `self:mark:${slug}`] }] });
    }
    const lines = [
        `Swallowed by <strong>${source.name}</strong> (${ability.name}): grabbed and slowed 1, and holding its breath.`,
        `It takes ${swallow.damage} at the end of each of its turns (a roll to apply appears then).`,
        `Escaping${swallow.escapeDC ? ` (DC ${swallow.escapeDC})` : ""} gets it out.${swallow.rupture ? ` So does piercing or slashing damage of ${swallow.rupture} or more to ${source.name} from one attack or spell (Rupture ${swallow.rupture}).` : ""}`,
        `It can attack ${source.name} only with unarmed attacks or light weapons; ${source.name} is off-guard to them.`,
        `If ${source.name} dies, creatures next to it cut it open with 3 actions.`
    ];
    return {
        name: `Swallowed by ${source.name}`,
        type: "effect",
        img: ability.img ?? "icons/svg/mystery-man.svg",
        flags: { [moduleId]: { swallowed: flag } },
        system: {
            description: { value: lines.map((line) => `<p>${line}</p>`).join("") },
            duration: { value: -1, unit: "unlimited", expiry: null, sustained: false },
            start: { value: time.worldTime, initiative: time.initiative ?? null },
            rules
        }
    };
}

// Piercing and slashing damage in one roll's instances ({ type, total, persistent }).
export const cuttingDamage = (instances) => instances.filter((instance) => !instance.persistent && ["piercing", "slashing"].includes(instance.type)).reduce((sum, instance) => sum + Math.max(0, Number(instance.total) || 0), 0);

// Does this damage to the monster cut a swallowed creature free?
export const ruptures = (instances, rupture) => Number.isFinite(rupture) && rupture > 0 && cuttingDamage(instances) >= rupture;

// A formula PF2e's DamageRoll takes: several damage types need braces
// ("(3d10+10)[bludgeoning],2d6[fire]" → "{(3d10+10)[bludgeoning],2d6[fire]}").
export function damageRollFormula(formula) {
    const text = String(formula ?? "").trim();
    if (text.startsWith("{")) return text;
    let depth = 0;
    for (const character of text) {
        if ("([{".includes(character)) depth++;
        else if (")]}".includes(character)) depth--;
        else if (character === "," && depth === 0) return `{${text}}`;
    }
    return text;
}
