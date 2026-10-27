// (2026-10-27, for the item module: Poison Fizz, Durian Bomb, Scalding Gauntlets, Phantasmal Doorknob.) A temporary immunity to one part of an
// ability, "temporarily immune to being blinded by poison fizz for 1 hour", beside trigger.immunity's to all of it: trigger.partImmunity
// { condition, duration: { value, unit }, slug?, degrees?, against? }, or a list of them. A creature already immune gets its row without that
// condition (its damage and the rest as rolled); one the card gives that condition, on a result in degrees (any when none), becomes immune for
// the duration. against "all": from anyone's (Durian Bomb's "caused by other durian bombs"); otherwise from this source's only, as
// trigger.immunity's. (Its own key: the Combat Simulator reads trigger.immunity as immunity to the whole ability.)

import { abilitySlug } from "./card.js";

const UNITS = ["rounds", "minutes", "hours", "days"];

// The plan's part immunities, each with its key (an item's grades share one: its slug, else the ability's).
export function partImmunities(plan, name = null) {
    return [plan?.trigger?.partImmunity ?? []].flat()
        .filter((part) => part?.condition && Number(part.duration?.value) > 0 && UNITS.includes(part.duration.unit))
        .map((part) => ({ ...part, slug: part.slug ?? abilitySlug(plan, name) }))
        .filter((part) => part.slug);
}

// Is the creature immune to this part, given its Effects' flags (as immunityFlags gives them), against this source's?
export function partImmuneTo(flagsList, part, source) {
    return (flagsList ?? []).some((flags) => {
        const held = flags?.partImmunity;
        return held?.slug === part.slug && held.condition === part.condition && (!held.source || held.source === source);
    });
}

// The changes without the conditions their targets are immune to (immune: target id → the conditions). → { kept, dropped: [{ target, slug }] }
export function dropImmuneParts(changes, immune) {
    const dropped = [];
    const kept = (changes ?? []).filter((change) => {
        if (change?.op !== "condition" || !immune.get(change.target)?.has(change.slug)) return true;
        dropped.push({ target: change.target, slug: change.slug });
        return false;
    });
    return { kept, dropped };
}

// The immunities the card's changes earn (targets: [{ id, degree }]): a target given the part's condition on a result in its degrees, not
// immune already. → [{ target, part }]
export function partsEarned(changes, targets, parts, immune) {
    const earned = [];
    for (const target of targets ?? []) {
        for (const part of parts) {
            if (immune.get(target.id)?.has(part.condition)) continue;
            if (part.degrees?.length && !part.degrees.includes(target.degree)) continue;
            if ((changes ?? []).some((change) => change?.op === "condition" && change.target === target.id && change.slug === part.condition)) earned.push({ target: target.id, part });
        }
    }
    return earned;
}

const unitWords = (duration) => `${duration.value} ${Number(duration.value) === 1 ? duration.unit.replace(/s$/, "") : duration.unit}`;

// The card's words: "is immune to being blinded by Poison Fizz", "… for 1 hour".
export const partWords = (part, name, duration = false) => `is immune to being ${part.condition} by ${name}${duration ? ` for ${unitWords(part.duration)}` : ""}`;

// The PF2e Effect that records it. ability: { name, img }; source: { actorUuid, name }; conditionName: the condition's own name; time:
// { worldTime, initiative }.
export function partImmunityEffect(moduleId, part, { ability, source, conditionName, time }) {
    const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
    const all = part.against === "all";
    return {
        name: `Immune: ${conditionName ?? part.condition} (${ability.name})`,
        type: "effect",
        img: ability.img ?? "icons/svg/shield.svg",
        flags: { [moduleId]: { partImmunity: { slug: part.slug, condition: part.condition, source: all ? null : source.actorUuid ?? null } } },
        system: {
            description: { value: `<p>Temporarily immune to being ${escape(part.condition)} by ${all ? `any ${escape(ability.name)}` : `${escape(source.name)}'s ${escape(ability.name)}`}, for ${escape(unitWords(part.duration))}; the rest of it still applies.</p>${part.raw ? `<p><em>${escape(part.raw)}</em></p>` : ""}` },
            duration: { value: Number(part.duration.value), unit: part.duration.unit, expiry: "turn-start", sustained: false },
            start: { value: time?.worldTime ?? 0, initiative: time?.initiative ?? null },
            tokenIcon: { show: false },
            rules: []
        }
    };
}
