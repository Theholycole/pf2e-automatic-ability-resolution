// More damage on a monster's own Strikes for a while, for live play (2026-10-10, batch 37): "Until the start of her next turn, her
// fangs Strikes deal an additional 2d8 sonic damage". The ability's self-effect plan as a PF2e effect on the monster: a
// DamageDice rule for each dice part ("2d8[sonic]", "1d10[persistent,bleed]", "2d8[precision]", "die": one more of the Strike's
// own dice), a FlatModifier for each flat one ("2[acid]"), on the Strike it names (its "<slug>-damage"), its melee Strikes
// ("melee-strike-damage") or all of them ("strike-damage"); for its time. Pure.

import { strikeMatches } from "./activity.js";

const sluggify = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// The damage selector, or null when the creature has no Strike by the name the plan gives. strikes: [{ name, slug, isRanged }].
export function buffSelector(plan, strikes = []) {
    if (plan.strike) {
        const strike = strikes.find((entry) => strikeMatches({ strike: plan.strike }, entry));
        return strike ? `${strike.slug || sluggify(strike.name)}-damage` : null;
    }
    return plan.melee ? "melee-strike-damage" : "strike-damage";
}

// One part's rule: "2d8[sonic]" → DamageDice; "2[acid]" → FlatModifier.
export function buffRule(formula, selector, label) {
    if (formula === "die") return { key: "DamageDice", selector, diceNumber: 1, label };
    const match = /^\(?(?:(\d+)d(\d+))?\+?(\d+)?\)?\[([\w,]+)\]$/.exec(String(formula).replace(/\s+/g, ""));
    if (!match || (!match[1] && !match[3])) return null;
    const kinds = match[4].split(",");
    const category = kinds.find((kind) => kind === "persistent" || kind === "precision") ?? null;
    const type = kinds.find((kind) => kind !== "persistent" && kind !== "precision" && kind !== "untyped") ?? null;
    if (match[1] && !match[3]) return { key: "DamageDice", selector, diceNumber: Number(match[1]), dieSize: `d${match[2]}`, ...(type ? { damageType: type } : {}), ...(category ? { category } : {}), label };
    if (!match[1]) return { key: "FlatModifier", selector, value: Number(match[3]), ...(type ? { damageType: type } : {}), ...(category ? { damageCategory: category } : {}), label };
    return null;
}

// A bonus to its own statistic (batch 39: Dueling Parry's "+2 circumstance bonus to AC"): its FlatModifier.
const MODIFIER_SELECTORS = { ac: "ac", attack: "attack", damage: "damage", reflex: "reflex", fortitude: "fortitude", will: "will" };
const modifierRule = (modifier, label) => (MODIFIER_SELECTORS[modifier.on] ? { key: "FlatModifier", selector: MODIFIER_SELECTORS[modifier.on], type: modifier.type ?? "untyped", value: Number(modifier.value), label } : null);

// The effect's data (PF2e's effect item), or null when it can't be made (no such Strike, a part it can't write). toggles: the
// ability's own switch, when PF2e gives it one ([{ domain, option }] from its toggleable RollOption rules, batch 39: Hydraulic
// Deflection's "hydraulic-deflection", whose FlatModifier waits on it): the effect turns that on instead, for its time.
export function strikeBuffEffect(plan, { name, img = null, strikes = [], uuid = null, toggles = [] } = {}) {
    if (plan?.builtin !== "self-effect" || (!plan.damage?.length && !plan.model?.modifiers?.length)) return null;
    const selector = plan.damage?.length && !toggles.length ? buffSelector(plan, strikes) : null;
    if (plan.damage?.length && !toggles.length && !selector) return null;
    const rules = toggles.length ? toggles.map(({ domain, option }) => ({ key: "RollOption", domain, option }))
        : [...(plan.damage ?? []).map((formula) => buffRule(formula, selector, name)), ...(plan.model?.modifiers ?? []).map((modifier) => modifierRule(modifier, name))];
    if (rules.some((rule) => !rule)) return null;
    const duration = plan.duration ?? { value: -1, unit: "unlimited", expiry: null };
    const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
    const which = plan.strike ? `its ${plan.strike} Strikes` : plan.melee ? "its melee Strikes" : "its Strikes";
    const notes = (plan.notes ?? []).map((note) => `<p>${escape(note)}</p>`).join("");
    const said = [plan.damage?.length ? `${which}: ${plan.damage.join(", ")} more damage.` : null, ...(plan.model?.modifiers ?? []).map((modifier) => `${modifier.value > 0 ? "+" : ""}${modifier.value} ${modifier.type ?? ""} to ${modifier.on}.`.replace(/ {2,}/g, " "))].filter(Boolean).join(" ");
    return {
        name,
        type: "effect",
        img: img ?? "icons/svg/upgrade.svg",
        flags: { "pf2e-automatic-ability-resolution": { strikeBuff: { uuid } } },
        system: {
            slug: `aar-${sluggify(name)}`,
            description: { value: `<p>${escape(said)}</p>${notes}` },
            duration: { value: duration.value, unit: duration.unit, expiry: duration.expiry ?? null, sustained: false },
            tokenIcon: { show: true },
            rules
        }
    };
}

// What a resistance reaction leaves on the monster (2026-10-11, batch 71): the resistance until the end of its next turn (Liquefy's
// "fire resistance 20 … until the end of their next turn"), its AC lower for a day (Chipping Scales' "AC is reduced by 2 for 1 day"),
// as PF2e effects' data: [] when it leaves nothing. Pure.
export function resistEffects(plan, { name, img = null } = {}) {
    if (plan?.builtin !== "resist-damage") return [];
    const effect = (label, rules, duration, said) => ({
        name: label,
        type: "effect",
        img: img ?? "icons/svg/shield.svg",
        flags: { "pf2e-automatic-ability-resolution": { resist: true } },
        system: { slug: `aar-${sluggify(label)}`, description: { value: `<p>${said}</p>` }, duration: { ...duration, sustained: false }, tokenIcon: { show: true }, rules }
    });
    const effects = [];
    if (plan.lasts) effects.push(effect(name, (plan.types ?? ["all-damage"]).map((type) => ({ key: "Resistance", type, value: plan.value })), { value: plan.lasts, unit: "rounds", expiry: "turn-end" }, `Resistance ${plan.value}${plan.types ? ` to ${plan.types.join(", ")}` : ""}.`));
    if (plan.acPenalty) effects.push(effect(`${name} (AC)`, [{ key: "FlatModifier", selector: "ac", type: "untyped", value: -plan.acPenalty, label: name }], { value: 1, unit: "days", expiry: null }, `AC −${plan.acPenalty} for a day.`));
    return effects;
}
