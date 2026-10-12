// Monster reactions in live play, the pure part (scripts/reactions.js is the
// Foundry side). The user's decisions (2026-10-08): a GM-only offer card when
// a reaction's trigger happens, with a button to use it; one reaction per
// round, tracked; Reactive Strike on leaving a square in reach, a ranged
// attack in reach, or a manipulate spell cast in reach; defensive reactions
// offered after the roll only when they matter (Nimble Dodge's +2 AC turning
// a hit into a miss; Challenge Fate on any hit).

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

export const DEGREES = ["criticalFailure", "failure", "success", "criticalSuccess"];
const DEGREE_WORDS = { criticalFailure: "a critical miss", failure: "a miss", success: "a hit", criticalSuccess: "a critical hit" };

// "Reactive Strike (Tail Only)" → "tail"; no restriction → null.
export function onlyStrike(name) {
    const match = /\(([\w' -]+?) only\)/i.exec(String(name ?? ""));
    return match ? match[1].trim().toLowerCase() : null;
}

// PF2e's degree of success: 10 over the DC a critical, 10 under a critical
// failure, a natural 20 or 1 one step better or worse.
export function degreeOf(total, dc, natural = null) {
    let index = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
    if (natural === 20) index = Math.min(3, index + 1);
    else if (natural === 1) index = Math.max(0, index - 1);
    return DEGREES[index];
}

// What a bonus to AC against the attack would make of it: { before, after },
// or null when it changes nothing.
export function higherAC({ total, dc, natural = null, outcome = null }, value) {
    const before = outcome ?? degreeOf(total, dc, natural);
    const after = degreeOf(total, dc + value, natural);
    return DEGREES.indexOf(after) < DEGREES.indexOf(before) ? { before, after } : null;
}

// (Batch 81: a check's words, not an attack's, "a success", for an Escape.)
const CHECK_WORDS = { criticalFailure: "a critical failure", failure: "a failure", success: "a success", criticalSuccess: "a critical success" };
export const degreeWords = (degree, check = false) => (check ? CHECK_WORDS : DEGREE_WORDS)[degree] ?? degree;

// Along a move, in reach or not at each point: did it leave a square in reach?
export function leftReach(insides) {
    for (let index = 1; index < insides.length; index++) if (insides[index - 1]) return true;
    return false;
}

// Conditions that keep a creature from using reactions.
const NO_REACTIONS = new Set(["unconscious", "stunned", "paralyzed", "petrified", "confused"]);
export const blocksReactions = (slugs) => slugs.some((slug) => NO_REACTIONS.has(slug));

// "Reaction used" lasts until the start of the creature's next turn: 0 rounds
// when its turn is still to come this round, otherwise 1.
export const reactionRounds = (position, current) => (position > current ? 0 : 1);

// A trigger that's a hit on the monster (2026-10-10, batch 16: "The dragon is critically hit with a melee attack", "A creature
// within the thoqqua's reach hits the thoqqua with a melee Strike"; a passive's too, batch 19): does this attack roll set it
// off? distance: the attacker's, in feet (null when unknown).
export function hitSetsOff(trigger, { outcome, ranged = false, unarmed = false, distance = null }) {
    if (trigger?.event !== "hit-by" || !["success", "criticalSuccess"].includes(outcome)) return false;
    if (trigger.critical && outcome !== "criticalSuccess") return false;
    if (trigger.melee && ranged) return false;
    if (trigger.unarmed && !unarmed) return false;
    return !(trigger.within && Number.isFinite(distance) && distance > trigger.within);
}

// Its own Strike that sets off a passive or a reaction (batch 18, 19): the degree, the Strike it names, the kind of weapon
// ("with a firearm", "with an unarmed attack", "a brawling weapon", "one of its melee Strikes"). options: the attack roll's.
// (Batch 69: a target with a condition, "hits a Slowed creature" — conditions: the target's condition slugs, or the roll's
// "target:condition:…" options; "… on its turn" — ownTurn: false when it isn't.)
export function ownStrikeSetsOff(trigger, { outcome, strikeName = "", options = [], conditions = [], ownTurn = null }) {
    if (trigger?.event !== "own-strike" || !(trigger.on ?? []).includes(outcome)) return false;
    const name = String(strikeName).toLowerCase();
    if (trigger.strike && !(name.includes(trigger.strike) || trigger.strike.includes(name))) return false;
    if (trigger.condition && !(options.includes(`target:condition:${trigger.condition}`) || conditions.includes(trigger.condition))) return false;
    if (trigger.ownTurn && ownTurn === false) return false;
    const unarmed = options.includes("item:category:unarmed") || options.includes("item:trait:unarmed");
    switch (trigger.weapon) {
        case "firearm": return options.includes("item:group:firearm") || /\b(?:pistol|musket|rifle|arquebus|blunderbuss|pepperbox|firearm|gun)\b/i.test(name);
        case "unarmed": return unarmed;
        case "brawling": return unarmed || options.includes("item:group:brawling") || /\b(?:fist|gauntlet|knuckles?|cestus)\b/i.test(name);
        case "melee": return !options.includes("item:ranged");
        default: return true;
    }
}

// What the GM still checks: "Only on piercing or slashing damage."
export function damageNote(trigger) {
    const types = (trigger?.damageTypes ?? []).map((type) => (type === "physical" ? "physical (bludgeoning, piercing or slashing)" : type));
    if (!types.length) return null;
    return `Only on ${types.length > 1 ? `${types.slice(0, -1).join(", ")} or ${types.at(-1)}` : types[0]} damage.`;
}

// A reaction that moves it off (batch 98: Skitter, Scurry, Flit Back): its button and what the GM does. plan: { move, feet, safe, on }.
export function withdrawMove(plan) {
    // (Batch 133, Slip: a teleport beside another creature within its distance.)
    if (plan?.move === "Teleport") return { label: "Teleport away", note: `It teleports to a clear space beside another creature it can see within ${plan.feet ?? 30} feet: move its token.` };
    // (Batch 136, Crumble: a Burrow down into the ground, its recharge.)
    if (plan?.move === "Burrow") return { label: "Burrow away", note: [`It Burrows ${plan.feet ? `${plan.feet} feet ` : ""}down into the ground: move its token or mark it as burrowed.`, plan.safe ? "This movement doesn't trigger reactions." : null, plan.recharge ? `Not again for ${plan.recharge} rounds.` : null].filter(Boolean).join(" ") };
    const verb = { Step: "Step", Fly: "Fly", Stride: "Stride" }[plan?.move] ?? "Stride";
    const how = plan?.feet ? `up to ${plan.feet} feet` : verb === "Step" ? "5 feet" : "up to its Speed";
    return {
        label: `${verb} away`,
        note: [`It ${verb === "Fly" ? "Flies" : `${verb}s`} ${how} away${plan?.on === "approach" ? " from the creature beside it" : ""}: move its token.`, plan?.safe && verb !== "Step" ? "This movement doesn't trigger reactions." : null, ["attacked", "hit"].includes(plan?.on) ? "After the attack's effects." : null, plan?.recharge ? `Not again for ${plan.recharge} rounds.` : null].filter(Boolean).join(" ")
    };
}

// One that follows a foe moving away (batch 99: No Escape, Reactive Pursuit). plan: { move, prey, strike }.
export function followMove(plan) {
    return {
        label: "Follow",
        note: [plan?.prey ? "Only if the creature is its hunted prey." : null, `It ${plan?.move === "Fly" ? "Flies" : "Strides"} up to its Speed after the creature, keeping it in reach: move its token beside it.`, plan?.strike ? "If it ends in reach, it can make a Strike: roll it from its sheet." : null].filter(Boolean).join(" ")
    };
}

// The offer card. state: { kind, ability, monster, target, trigger, strikes, note, attack, status, result }.
export function offerHTML(state) {
    const who = state.target ? `${escape(state.target.name)} ${escape(state.trigger)}` : escape(state.trigger);
    const buttons = [];
    if (state.status === "open") {
        if (state.kind === "strike") for (const strike of state.strikes ?? []) buttons.push(`<button type="button" data-aar-reaction="strike" data-slug="${escape(strike.slug)}">${escape(strike.label)}${state.penalty ? ` (−${state.penalty})` : ""}</button>`);
        if (state.kind === "ac") buttons.push(`<button type="button" data-aar-reaction="use">Use it: ${escape(degreeWords(state.attack.after, Boolean(state.attack.what)))}</button>`);
        if (state.kind === "misfortune") buttons.push(`<button type="button" data-aar-reaction="use">Reroll, keep the worse</button>`);
        // (Batch 67: Ferocity's kin, "half its HP", "25 HP", "4d10 HP".)
        if (state.kind === "ferocity") buttons.push(`<button type="button" data-aar-reaction="use">Stay at ${escape(state.survive?.hp === "half" ? "half its" : String(state.survive?.hp ?? 1))} HP</button>`);
        if (state.kind === "card") buttons.push(`<button type="button" data-aar-reaction="use">Use it</button>`);
        // (Batch 98: "Use it: Step away".)
        if (state.kind === "move") buttons.push(`<button type="button" data-aar-reaction="use">Use it: ${escape(state.move?.label ?? "move away")}</button>`);
        // (Batch 100: "Use it: recharge Hellfire Breath", "Use it: a critical hit".)
        if (state.kind === "recharge") buttons.push(`<button type="button" data-aar-reaction="use">Use it: ${escape(state.move?.label ?? "recharge")}</button>`);
        if (state.kind === "upgrade") buttons.push(`<button type="button" data-aar-reaction="use">Use it: a critical hit</button>`);
        // (Batch 106: "Use it: take 12 damage", "Use it: keep it up".)
        if (state.kind === "intercept") buttons.push(`<button type="button" data-aar-reaction="use">Use it: take ${escape(state.retribution?.taken ?? 0)} damage</button>`);
        if (state.kind === "rescue") buttons.push(`<button type="button" data-aar-reaction="use">Use it: keep it up</button>`);
        // (Batch 88: a basic maneuver, "Use it: Disarm (−2)".)
        if (state.kind === "skill") buttons.push(`<button type="button" data-aar-reaction="use">Use it: ${escape(String(state.skill?.slug ?? "").replace(/^\w/, (letter) => letter.toUpperCase()))}${state.skill?.shift ? ` (${state.skill.shift > 0 ? "+" : "−"}${Math.abs(state.skill.shift)})` : ""}</button>`);
        if (state.kind === "reroll") buttons.push(`<button type="button" data-aar-reaction="use">${state.attack?.keep === "new" ? "Reroll, take the new result" : "Reroll, keep the better"}</button>`);
        // (Batch 168: "Use it: roll Performance".)
        if (state.kind === "save-skill") buttons.push(`<button type="button" data-aar-reaction="use">Use it: roll ${escape(String(state.skill?.slug ?? "the check").replace(/^\w/, (letter) => letter.toUpperCase()))}</button>`);
        if (state.kind === "boost") buttons.push(`<button type="button" data-aar-reaction="use">Use it: one degree better</button>`);
        if (state.kind === "negate") buttons.push(`<button type="button" data-aar-reaction="use">Use it: negate ${escape(state.negate?.name ?? "it")}</button>`);
        // (The attacker's choice, batch 58: a normal hit, or the critical hit and a condition.)
        if (state.kind === "flat" && state.attack?.or) buttons.push(`<button type="button" data-aar-reaction="use">A normal hit</button>`, `<button type="button" data-aar-reaction="keep">The critical hit, ${escape(state.attack.or.label)}</button>`);
        else if (state.kind === "flat") buttons.push(`<button type="button" data-aar-reaction="use">${state.attack?.dc == null ? "Use it" : `Roll the DC ${escape(state.attack?.dc)} flat check`}</button>`);
        // (Batch 71, Liquefy: the resistance against the damage it took, as Hit Points back.)
        if (state.kind === "resist") buttons.push(`<button type="button" data-aar-reaction="use">Use it: ${escape(state.retribution?.restore ?? 0)} HP back</button>`);
        // Retributive Strike: the ally's resistance, then a Strike at the foe if it's in reach.
        if (state.kind === "retribution") {
            for (const strike of state.strikes ?? []) buttons.push(`<button type="button" data-aar-reaction="strike" data-slug="${escape(strike.slug)}">Resist, then ${escape(strike.label)}</button>`);
            buttons.push(`<button type="button" data-aar-reaction="use">Resist only</button>`);
        }
        buttons.push(`<button type="button" data-aar-reaction="decline">Not now</button>`);
    }
    // (Batch 81: or a higher Escape DC, Tighten Coils.)
    const detail = state.kind === "ac" ? `<p class="aar-hint">+${state.attack.value} ${escape(state.attack.what ?? "AC")}${state.attack.what === "to the save" ? "" : " against it"} turns ${escape(degreeWords(state.attack.before, Boolean(state.attack.what)))} into ${escape(degreeWords(state.attack.after, Boolean(state.attack.what)))}.</p>` : "";
    const note = state.note ? `<p class="aar-hint">${escape(state.note)}</p>` : "";
    const result = state.result ? `<ul class="aar-applied"><li>${escape(state.result)}</li></ul>` : "";
    const controls = buttons.length ? `<footer class="aar-controls">${buttons.join("")}</footer>` : "";
    return `<section class="pf2e-aar-card pf2e-aar-reaction" data-aar-status="${escape(state.status)}"><header><strong>${escape(state.ability.name)}</strong> <span class="aar-rider">${escape(state.monster.name)}'s ${state.free ? "free action" : "reaction"}</span><span class="aar-check">${who}</span></header>${detail}${note}${result}${controls}</section>`;
}

// A creature of the kind an ability names (batch 28: Verdant Burst's "each plant creature", Rotten Burst's "each undead fungi or
// plant creature"): filter { all, any } of trait slugs; none: any creature.
export function traitsFit(traits, filter) {
    const has = new Set([...(traits ?? [])].map((trait) => String(trait).toLowerCase()));
    if (!filter) return true;
    return (filter.all ?? []).every((trait) => has.has(trait)) && (!(filter.any ?? []).length || filter.any.some((trait) => has.has(trait)));
}

// Golem Antimagic (batch 28): what a spell does to a golem, from its kinds (the spell's traits, damage types and name, lowercase):
// { kind: "harmed", formula } (untyped damage instead of the spell's usual effect; from an area, the parenthetical amount),
// { kind: "healed", formula? } (it loses slowed and regains half the damage the spell would have dealt; an area's amount),
// { kind: "slowed", rounds? } (slowed 1 for 2d6 rounds; an area, for that round), or { kind: "immune" }.
export function golemAnswer(plan, { kinds, area = false }) {
    const has = new Set([...(kinds ?? [])].map((kind) => String(kind).toLowerCase()));
    const listed = (entry) => (entry?.by ?? []).some((kind) => has.has(kind));
    if (listed(plan?.harmed)) {
        const formula = area ? plan.harmed.area ?? plan.harmed.damage : plan.harmed.damage ?? plan.harmed.area;
        return formula ? { kind: "harmed", formula } : { kind: "immune" };
    }
    if (listed(plan?.healed)) return { kind: "healed", formula: area ? plan.healed.area ?? null : null };
    if (listed(plan?.slowed)) return { kind: "slowed", rounds: area ? 1 : null };
    return { kind: "immune" };
}
