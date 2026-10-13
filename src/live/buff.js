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
// (Batch 274: all saves, and a modifier only against effects of a trait — its predicate, PF2e's "item:trait:fire".)
const MODIFIER_SELECTORS = { ac: "ac", attack: "attack", damage: "damage", reflex: "reflex", fortitude: "fortitude", will: "will", "saving-throw": "saving-throw" };
const modifierRule = (modifier, label) => (MODIFIER_SELECTORS[modifier.on] ? { key: "FlatModifier", selector: MODIFIER_SELECTORS[modifier.on], type: modifier.type ?? "untyped", value: Number(modifier.value), label, ...(modifier.vsTrait ? { predicate: [`item:trait:${modifier.vsTrait}`] } : {}) } : null);

// The effect's data (PF2e's effect item), or null when it can't be made (no such Strike, a part it can't write). toggles: the
// ability's own switch, when PF2e gives it one ([{ domain, option }] from its toggleable RollOption rules, batch 39: Hydraulic
// Deflection's "hydraulic-deflection", whose FlatModifier waits on it): the effect turns that on instead, for its time.
// A self-effect's time when its plan gives none (2026-10-12, batch 235: Raise Shields, Blood Fury, a rage with no PF2e effect of its own): its model's
// rounds — 0 to the end of its turn, N to the start of its turn N rounds on — a stance until it ends, or else a minute.
export function selfEffectDuration(plan) {
    if (plan?.duration) return plan.duration;
    const rounds = plan?.model?.rounds;
    if (rounds === 0) return { value: 0, unit: "rounds", expiry: "turn-end" };
    if (Number.isFinite(rounds) && rounds > 0) return rounds % 10 === 0 ? { value: rounds / 10, unit: "minutes", expiry: null } : { value: rounds, unit: "rounds", expiry: "turn-start" };
    if (plan?.stance || rounds === null) return { value: -1, unit: "unlimited", expiry: null };
    return { value: 1, unit: "minutes", expiry: null };
}

export function strikeBuffEffect(plan, { name, img = null, strikes = [], uuid = null, toggles = [] } = {}) {
    // (Batch 196: resistance and temporary Hit Points on itself too — Reef Armor, Shifting Form, Harden Chitin.)
    // (Batch 273: a precious material for its Strikes, of its choice — PF2e's ChoiceSet and AdjustStrike, as its Adaptive Strike effect has them.)
    if (plan?.builtin !== "self-effect" || (!plan.damage?.length && !plan.model?.modifiers?.length && !plan.model?.resistances?.length && !plan.model?.tempHp && !plan.model?.regeneration && !plan.model?.materials?.length)) return null;
    const selector = plan.damage?.length && !toggles.length ? buffSelector(plan, strikes) : null;
    if (plan.damage?.length && !toggles.length && !selector) return null;
    const rules = toggles.length ? toggles.map(({ domain, option }) => ({ key: "RollOption", domain, option }))
        // (Batch 241, Imbue Righteousness: damage only against unholy creatures — the target's trait as its predicate.)
        : [...(plan.damage ?? []).map((formula) => buffRule(formula, selector, name)).map((rule) => (rule && plan.vsTrait ? { ...rule, predicate: [`target:trait:${plan.vsTrait}`] } : rule)), ...(plan.model?.modifiers ?? []).map((modifier) => modifierRule(modifier, name)),
            ...(plan.model?.resistances ?? []).map((entry) => ({ key: "Resistance", type: entry.type, value: Number(entry.value), ...(entry.exceptions?.length ? { exceptions: [...entry.exceptions] } : {}) })),
            ...(plan.model?.tempHp ? [{ key: "TempHP", value: Number(plan.model.tempHp) }] : []),
            ...(plan.model?.materials?.length ? [{ key: "ChoiceSet", flag: "material", choices: plan.model.materials.map((value) => ({ label: value.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()), value })) }, { key: "AdjustStrike", mode: "add", property: "materials", value: "{item|flags.system.rulesSelections.material}", definition: ["item:melee"] }] : []),
            // (Batch 248: regeneration, and the damage that switches it off.)
            ...(plan.model?.regeneration ? [{ key: "FastHealing", type: "regeneration", value: Number(plan.model.regeneration.value), ...(plan.model.regeneration.deactivatedBy?.length ? { deactivatedBy: [...plan.model.regeneration.deactivatedBy] } : {}) }] : [])];
    if (rules.some((rule) => !rule)) return null;
    const duration = selfEffectDuration(plan);
    const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
    const which = plan.strike ? `its ${plan.strike} Strikes` : plan.melee ? "its melee Strikes" : "its Strikes";
    const notes = (plan.notes ?? []).map((note) => `<p>${escape(note)}</p>`).join("");
    const said = [plan.damage?.length ? `${which}: ${plan.damage.join(", ")} more damage${plan.vsTrait ? ` against ${plan.vsTrait} creatures` : ""}.` : null, ...(plan.model?.modifiers ?? []).map((modifier) => `${modifier.value > 0 ? "+" : ""}${modifier.value} ${modifier.type ?? ""} to ${modifier.on}.`.replace(/ {2,}/g, " ")),
        ...(plan.model?.resistances ?? []).map((entry) => `Resistance ${entry.value} to ${entry.type.replace(/-/g, " ")}${entry.exceptions?.length ? ` (except ${entry.exceptions.join(", ").replace(/-/g, " ")})` : ""}.`),
        plan.model?.tempHp ? `${plan.model.tempHp} temporary Hit Points.` : null,
        plan.model?.materials?.length ? `Its Strikes count as ${plan.model.materials.join(", ").replace(/-/g, " ")} (its choice).` : null,
        plan.model?.regeneration ? `Regeneration ${plan.model.regeneration.value}${plan.model.regeneration.deactivatedBy?.length ? ` (deactivated by ${plan.model.regeneration.deactivatedBy.join(", ")})` : ""}.` : null].filter(Boolean).join(" ");
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
// (Batch 152, Overcharge: "… and becomes Quickened for 1d4 rounds" — quickened { rounds (rolled), uuid (PF2e's condition), img }: an effect granting
// the condition for that many rounds.)
// (Batch 193, Divert Essence: value "rank" — the rank of the spell aimed at it, given as rank; until: "turn-start", to the start of its next turn.)
export function resistEffects(plan, { name, img = null, quickened = null, rank = null, type = null } = {}) {
    if (plan?.builtin !== "resist-damage") return [];
    const value = plan.value === "rank" ? Number(rank) : plan.value;
    // (Batch 213, Runic Resistance: the triggering damage's type, as the offer found it; none when it wasn't known.)
    if (plan.types?.includes("triggering") && !type) return [];
    const effect = (label, rules, duration, said) => ({
        name: label,
        type: "effect",
        img: img ?? "icons/svg/shield.svg",
        flags: { "pf2e-automatic-ability-resolution": { resist: true } },
        system: { slug: `aar-${sluggify(label)}`, description: { value: `<p>${said}</p>` }, duration: { ...duration, sustained: false }, tokenIcon: { show: true }, rules }
    });
    const effects = [];
    if (plan.lasts && value > 0) effects.push(effect(name, (plan.types ?? ["all-damage"]).map((kind) => ({ key: "Resistance", type: kind === "triggering" ? type : kind, value })), { value: plan.lasts, unit: "rounds", expiry: plan.until === "turn-start" ? "turn-start" : "turn-end" }, `Resistance ${value}${plan.types ? ` to ${plan.types.map((kind) => (kind === "triggering" ? type : kind)).join(", ")}` : ""}.`));
    if (plan.acPenalty) effects.push(effect(`${name} (AC)`, [{ key: "FlatModifier", selector: "ac", type: "untyped", value: -plan.acPenalty, label: name }], { value: 1, unit: "days", expiry: null }, `AC −${plan.acPenalty} for a day.`));
    if (plan.quickened && quickened?.uuid && Number(quickened.rounds) > 0) {
        const granted = effect(`${name} (Quickened)`, [{ key: "GrantItem", uuid: quickened.uuid, flag: "condition", allowDuplicate: true, onDeleteActions: { granter: "cascade", grantee: "cascade" } }], { value: Number(quickened.rounds), unit: "rounds", expiry: "turn-end" }, `Quickened for ${quickened.rounds} round${Number(quickened.rounds) === 1 ? "" : "s"}.`);
        // (Not the resistance's own effect: its use stays open while only this lasts.)
        delete granted.flags["pf2e-automatic-ability-resolution"].resist;
        if (quickened.img) granted.img = quickened.img;
        effects.push(granted);
    }
    return effects;
}
