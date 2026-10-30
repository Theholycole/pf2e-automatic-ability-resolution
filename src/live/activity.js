// A Strike activity's results on a hit, for live play (2026-10-10): Intimidating Strike's "If it hits and deals damage, the
// target is Frightened 1, or Frightened 2 on a critical hit", Rhinoceros Charge's save, a Strike's extra persistent damage.
// The GM uses the activity, then rolls the Strike from the sheet; when that Strike hits, its results get a card. Pure.

const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
const NONE = { mode: "none", multiplier: 0, sourceComponentIds: [] };

// The activity's on-hit results as cards' plans: { plan } (results by the Strike's degree: a hit is the check's success, a
// critical hit its critical success), { save, size } (a save the creature hit attempts; size: the largest it works on), both
// (batch 27: "deals an additional 2d6 mental damage, and the target must succeed at a … save"), or null when a hit adds
// nothing. Extra dice of the Strike's own type ("2d8[strike]") take strikeType, the type of the Strike that hit.
// (Batch 83, Stomp: proneDamage, more damage on a creature already Prone — targetProne: the creature hit is.)
// (Batch 258, Resonating Kick: vsTraits, more damage against a creature with a trait — targetTraits: the creature hit's.)
export function activityRider(activity, { strikeType = null, targetProne = false, targetTraits = [] } = {}) {
    const onHit = activity?.builtin === "strike-activity" ? activity.onHit ?? {} : null;
    if (!onHit) return null;
    // (A skill action after the hit, batch 35: its basic action's card, "demoralize", "trip", "shove".)
    // (Batch 127, Clobber: saveIf, its save only against an off-guard target.)
    const save = onHit.save?.resolution || onHit.follow ? { ...(onHit.save?.resolution ? { save: onHit.save, size: onHit.size ?? null, ...(onHit.saveIf ? { saveIf: onHit.saveIf } : {}) } : {}), ...(onHit.follow ? { follow: onHit.follow } : {}) } : null;
    const conditions = (list) => (list ?? []).map((entry) => ({ kind: "condition", slug: entry.slug, value: entry.value ?? null, duration: entry.duration ?? null }));
    // (Batch 153, Draining Touch: the Hit Points it regains on a hit, on itself.)
    const healSelf = Number(onHit.selfHeal) > 0 ? [{ kind: "heal", amount: Number(onHit.selfHeal), recipient: "self" }] : [];
    const hit = [...conditions(onHit.conditions), ...healSelf];
    const critical = onHit.critical ? [...conditions(onHit.critical), ...healSelf] : hit;
    // (Precision damage too, "4d6[precision]", batch 37: the Strike's type.)
    const traits = new Set([...(targetTraits ?? [])].map((trait) => String(trait).toLowerCase()));
    const againstTrait = (onHit.vsTraits ?? []).filter((entry) => entry.traits.some((trait) => traits.has(trait))).flatMap((entry) => entry.damage);
    const formulas = [...(onHit.damage ?? []), ...(targetProne ? onHit.proneDamage ?? [] : []), ...againstTrait].filter(Boolean).map((formula) => String(formula).replace(/\[strike\]/g, `[${strikeType ?? "untyped"}]`).replace(/\[precision\]/g, `[precision,${strikeType ?? "untyped"}]`));
    const pushOf = (distance) => (Number(distance) > 0 ? { kind: "push", distance: Number(distance), upTo: false, optional: false, direction: "away" } : null);
    const push = pushOf(onHit.push);
    const criticalPush = pushOf(onHit.criticalPush) ?? push;
    // (Batch 152, Fan of Daggers: damage a critical hit alone brings, "On a critical hit, the target takes 2d10 bleed damage", as written.)
    const criticalOnly = (onHit.criticalDamage ?? []).filter(Boolean);
    // (Batch 255, Generate Bomb: a bomb's splash on the target, not doubled; PF2e's own effect it leaves, Frost Vial's.)
    const splash = (onHit.splash ?? []).filter(Boolean);
    const native = onHit.nativeEffects?.length ? onHit.nativeEffects.map((entry) => ({ ...entry })) : null;
    if (!hit.length && !critical.length && !formulas.length && !criticalOnly.length && !push && !criticalPush && !splash.length && !native) return save;
    // (A critical hit doubles the Strike's damage, its extra dice too.)
    const row = (effects, double, moved = push, more = [], landed = true) => {
        const all = [...formulas.map((formula) => ({ formula: double ? doubled(formula) : formula })), ...more.map((formula) => ({ formula }))];
        return {
            damage: all.length ? { mode: "formulas", formulas: all, rollScope: "outcome" } : { ...NONE },
            effects,
            ...(moved ? { forcedMovement: { ...moved } } : {}),
            ...(native && landed ? { nativeEffects: native } : {})
        };
    };
    const source = activity.source ?? { name: "Strike activity" };
    return {
        ...(save ?? {}),
        plan: {
            modelVersion: activity.modelVersion ?? 13,
            source,
            rank: 1,
            traits: [],
            activation: { time: "free", traits: [] },
            automation: { level: "automatic" },
            targeting: { target: "the creature the Strike hits", range: "touch", area: null },
            trigger: { event: "strike-activity" },
            resolution: {
                kind: "check",
                check: { roll: "skill", statistic: "strike", against: { dc: "target", statistic: "ac" } },
                sharedDamage: null,
                outcomes: { criticalSuccess: row(critical, true, criticalPush, [...criticalOnly, ...splash]), success: row(hit, false, push, splash), failure: row([], false, null, [], false), criticalFailure: row([], false, null, [], false) }
            }
        }
    };
}

// "2*(1d6)[persistent,bleed]" from "1d6[persistent,bleed]".
function doubled(formula) {
    const match = /^\(?(.+?)\)?(\[[^\]]+\])$/.exec(String(formula).trim());
    return match ? `2*(${match[1]})${match[2]}` : `2*(${formula})`;
}

// The Strike rolled is the activity's: its named Strike ("jaws" for "Jaws"), or any melee Strike when it names none.
export function strikeMatches(activity, strike) {
    const wanted = String(activity?.strike ?? "").toLowerCase();
    const name = String(strike?.name ?? "").toLowerCase();
    // (2026-10-30, the feat module: a character's feat that says only "Make a Strike" — any of its Strikes.)
    if (activity?.anyStrike) return true;
    if (!wanted) return !strike?.isRanged;
    // (Batch 97: "makes a ranged Strike" — any of its ranged Strikes.)
    if (wanted === "ranged" && !name.includes("ranged")) return !!strike?.isRanged;
    return name === wanted || name.startsWith(wanted) || wanted.startsWith(name) || name.includes(wanted);
}

// The Strikes an attack roll may have been made with, from its roll options (2026-10-30, Foundry test: a Strike a stance or another rule
// element grants, Wolf Jaws, has the stance's Effect as its message's origin): [{ name, isRanged }] from "origin:item:slug:wolf-jaws" and
// "item:slug:…".
export function strikesFromOptions(options = []) {
    const isRanged = options.includes("item:ranged");
    return [...new Set(options.map((option) => /^(?:origin:)?item:slug:(.+)$/.exec(option)?.[1]).filter(Boolean))].map((slug) => ({ name: slug.replace(/-/g, " "), isRanged }));
}

// A size (PF2e's slug "sm", "med" … or the word) as its place: tiny 0 … gargantuan 5; -1 when unknown.
export const sizeIndex = (size) => SIZES.indexOf(String(size ?? "").toLowerCase().replace(/^sm$/, "small").replace(/^med$/, "medium").replace(/^lg$/, "large").replace(/^grg$/, "gargantuan"));

// A creature small enough for the activity's save ("A Medium or smaller creature struck by this attack must succeed …").
export function fitsSize(size, limit) {
    if (!limit) return true;
    const at = sizeIndex(size);
    return at < 0 || at <= SIZES.indexOf(String(limit).toLowerCase());
}

// Whether the creature's last Strike allows a follow-up (batch 36: "Requirements … last action was a successful jaws Strike"):
// followUp { strike, melee, on, listing } against that Strike's outcome, name, range and listed riders ("disarm").
export function followUpFits(followUp, { outcome, strikeName = "", ranged = false, attackEffects = [] } = {}) {
    if (!followUp || !(followUp.on ?? ["success", "criticalSuccess"]).includes(outcome)) return false;
    if (followUp.melee && ranged) return false;
    if (followUp.listing && !attackEffects.some((effect) => String(effect).replace(/^improved-/, "") === followUp.listing)) return false;
    return !followUp.strike || strikeMatches({ strike: followUp.strike }, { name: strikeName, isRanged: ranged });
}

// A follow-up by the Strike's degree with no Strike to go by: a hit's results, applied as they are (the GM checks the rest).
export function followUpAsHit(plan) {
    const resolution = plan?.resolution;
    if (resolution?.check?.statistic !== "strike") return plan;
    const none = { damage: { mode: "none", multiplier: 0, sourceComponentIds: [] }, effects: [] };
    return { ...plan, resolution: { ...resolution, check: { roll: "automatic", statistic: "automatic" }, outcomes: { criticalSuccess: { ...none }, success: resolution.outcomes.success, failure: { ...none }, criticalFailure: { ...none } } } };
}
