// The ability compiler: PF2e's non-spell abilities as plans for the
// resolution core. Pure: Node, Web Workers and Foundry.

import { compileDisarm, compileDiversion, compileEscape, compileFeint, compileFirstAid, compileReposition, compileSkillAction } from "./checks.js";
import { compileMonsterAbility, glossarySlug, BUILT_IN } from "./monster.js";

export { compileDisarm, compileDiversion, compileEscape, compileFeint, compileFirstAid, compileReposition, compileSkillAction, readSkillCheck } from "./checks.js";
export { compileMonsterAbility, glossarySlug, BUILT_IN } from "./monster.js";
export * as inline from "./inline.js";

// The basic actions the simulator and the riders use, from PF2e's actions pack.
export const BASIC_ACTIONS = Object.freeze(["demoralize", "trip", "grapple", "shove", "escape", "disarm", "feint", "create-a-diversion", "administer-first-aid", "reposition"]);

// The skill actions whose results need more than conditions.
const SPECIAL = { escape: compileEscape, disarm: compileDisarm, feint: compileFeint, "create-a-diversion": compileDiversion, "administer-first-aid": compileFirstAid, reposition: compileReposition };

function compileBasic(item, slug) {
    return (SPECIAL[slug] ?? compileSkillAction)(item);
}

// items: the actions pack's items (or any with those slugs) → { slug: plan }.
export function compileBasicActions(items) {
    const plans = {};
    for (const item of items ?? []) {
        const slug = item?.system?.slug ?? item?.name?.toLowerCase();
        if (!BASIC_ACTIONS.includes(slug)) continue;
        plans[slug] = compileBasic(item, slug);
    }
    return plans;
}

// One ability item → a plan, { builtin }, or null.
export function compileAbility(item, options = {}) {
    if (item?.type === "action" && BASIC_ACTIONS.includes(item.system?.slug) && !item.actor) {
        return compileBasic(item, item.system.slug);
    }
    return compileMonsterAbility(item, options);
}

export { glossarySlug as abilitySlug };
export const builtIn = (slug) => BUILT_IN.has(slug);
