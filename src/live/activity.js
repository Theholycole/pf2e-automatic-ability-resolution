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
export function activityRider(activity, { strikeType = null, targetProne = false } = {}) {
    const onHit = activity?.builtin === "strike-activity" ? activity.onHit ?? {} : null;
    if (!onHit) return null;
    // (A skill action after the hit, batch 35: its basic action's card, "demoralize", "trip", "shove".)
    // (Batch 127, Clobber: saveIf, its save only against an off-guard target.)
    const save = onHit.save?.resolution || onHit.follow ? { ...(onHit.save?.resolution ? { save: onHit.save, size: onHit.size ?? null, ...(onHit.saveIf ? { saveIf: onHit.saveIf } : {}) } : {}), ...(onHit.follow ? { follow: onHit.follow } : {}) } : null;
    const conditions = (list) => (list ?? []).map((entry) => ({ kind: "condition", slug: entry.slug, value: entry.value ?? null, duration: entry.duration ?? null }));
    const hit = conditions(onHit.conditions);
    const critical = onHit.critical ? conditions(onHit.critical) : hit;
    // (Precision damage too, "4d6[precision]", batch 37: the Strike's type.)
    const formulas = [...(onHit.damage ?? []), ...(targetProne ? onHit.proneDamage ?? [] : [])].filter(Boolean).map((formula) => String(formula).replace(/\[strike\]/g, `[${strikeType ?? "untyped"}]`).replace(/\[precision\]/g, `[precision,${strikeType ?? "untyped"}]`));
    const pushOf = (distance) => (Number(distance) > 0 ? { kind: "push", distance: Number(distance), upTo: false, optional: false, direction: "away" } : null);
    const push = pushOf(onHit.push);
    const criticalPush = pushOf(onHit.criticalPush) ?? push;
    if (!hit.length && !critical.length && !formulas.length && !push && !criticalPush) return save;
    // (A critical hit doubles the Strike's damage, its extra dice too.)
    const row = (effects, double, moved = push) => ({
        damage: formulas.length ? { mode: "formulas", formulas: formulas.map((formula) => ({ formula: double ? doubled(formula) : formula })), rollScope: "outcome" } : { ...NONE },
        effects,
        ...(moved ? { forcedMovement: { ...moved } } : {})
    });
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
                outcomes: { criticalSuccess: row(critical, true, criticalPush), success: row(hit, false), failure: row([], false, null), criticalFailure: row([], false, null) }
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
    if (!wanted) return !strike?.isRanged;
    // (Batch 97: "makes a ranged Strike" — any of its ranged Strikes.)
    if (wanted === "ranged" && !name.includes("ranged")) return !!strike?.isRanged;
    return name === wanted || name.startsWith(wanted) || wanted.startsWith(name) || name.includes(wanted);
}

// A creature small enough for the activity's save ("A Medium or smaller creature struck by this attack must succeed …").
export function fitsSize(size, limit) {
    if (!limit) return true;
    const at = SIZES.indexOf(String(size ?? "").toLowerCase().replace(/^sm$/, "small").replace(/^med$/, "medium").replace(/^lg$/, "large").replace(/^grg$/, "gargantuan"));
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
