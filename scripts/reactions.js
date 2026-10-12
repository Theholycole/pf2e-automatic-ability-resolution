// Live play: monsters' reactions (docs/live-play.md; the decisions are in src/live/reactions.js).
//
// While an encounter runs, for monsters in it that can react (alive, no
// "reaction used", nothing keeping them from reacting), the active GM gets a
// whispered offer card when a trigger happens:
// - Reactive Strike: a foe leaves a square in its reach (Foundry's movement
//   path; forced movement doesn't count), makes a ranged attack in its reach,
//   or casts a manipulate spell in its reach. "(Tail Only)" offers that Strike.
// - Twisting Tail and the like: a foe moves in its reach; the Strike takes its penalty.
// - Nimble Dodge and the like (+N AC): after an attack roll on it, when the
//   bonus would change the result.
// - Challenge Fate: after a hit on it, a reroll keeping the worse (PF2e's own reroll).
// - Death Frenzy: a Strike when reduced to 0 HP (at the GM's target).
// - Ferocity: back to 1 HP, wounded +1, when reduced to 0 HP (not at wounded 3).
// - Resilient Form and the like: after a critical hit on it, a flat check that makes it a normal hit (a free
//   action's uses aren't counted here: the GM's).
// - A reaction with a save or other results whose trigger is a hit, a critical hit or damage on it ("The dragon is
//   critically hit with a melee attack", "The bul-gae takes damage"): after the attack roll, or when PF2e applies damage;
//   using it posts the ability's card, on the attacker or the creatures around it (2026-10-10).
// - Retributive Strike (a monster's, the glossary's): when PF2e applies damage to
//   its ally and the creature whose turn it is (taken as the attacker) is a foe,
//   both within 15 feet. Using it gives the ally back what its resistance
//   (2 + the monster's level) would have kept off, then Strikes if in reach.
// - Skitter, Scurry, Flit Back and the like (batch 98): a foe missing, hitting or damaging it, or coming beside it; using it
//   tells the GM how far to move its token. No Escape and the like (batch 99): a foe in its reach moving away, followed.
// Using one marks the monster "Reaction used" until the start of its next turn.

import { distanceFeet, pathPositions } from "../../pf2e-resolution-core/src/model/grid.js";
import { blocksReactions, damageNote, degreeOf, degreeWords, higherAC, hitSetsOff, leftReach, offerHTML, onlyStrike, followMove, ownStrikeSetsOff, reactionRounds, withdrawMove } from "../src/live/reactions.js";
import { box, gridOf, inEncounter, runningCombat } from "./auras.js";
import { fitsSize } from "../src/live/activity.js";
import { resistEffects } from "../src/live/buff.js";
import { isActiveGM, postCard, postEffectCard, postSkillCard, targetedEvent, targetedSetsOff, tokensAround } from "./live.js";

const MODULE_ID = "pf2e-automatic-ability-resolution";
const FLAG = "reaction";
const KINDS = new Set(["reactive-strike", "reaction-strike", "ac-reaction", "attack-misfortune", "death-strike", "ferocity", "retributive-strike", "crit-downgrade", "conceal-reaction", "crit-resistance", "negate-condition", "save-boost", "save-reroll", "ally-ac-reaction", "resist-damage", "escape-guard", "save-bonus-reaction", "withdraw", "follow"]);

let compile = () => null;
let queue = Promise.resolve();
const serially = (label, task) => {
    queue = queue.then(task).catch((error) => console.error(`${MODULE_ID} | reaction ${label}`, error));
    return queue;
};

export function setUpReactions({ compileItem }) {
    compile = compileItem;
    Hooks.on("moveToken", (token, movement) => {
        if (isActiveGM()) serially("move", () => onMove(token, movement));
    });
    Hooks.on("createChatMessage", (message) => {
        if (isActiveGM()) serially("message", () => onMessage(message));
    });
    Hooks.on("updateActor", (actor, changed, options) => {
        if (isActiveGM() && changed.system?.attributes?.hp?.value === 0) serially("down", () => onDown(actor));
        // (A creature a monster downed: its reaction to that, You're Next; batch 52.)
        if (isActiveGM() && changed.system?.attributes?.hp?.value === 0) serially("downed", () => onDowned(actor));
        // PF2e's damage, with the amount it applied (not its undo).
        if (isActiveGM() && options?.damageTaken > 0 && !options.damageUndo) serially("damaged", () => onDamaged(actor, options.damageTaken));
    });
    // A creature's turn starting (Petrifying Glance), and the encounter starting (Chilling Cry's "rolls initiative"; batch 18).
    Hooks.on("updateCombat", (combat, changed) => {
        if (isActiveGM() && combat.started && ("turn" in changed || "round" in changed)) serially("turn", () => onTurnStart(combat));
        // (A creature ending its turn beside a monster, Biting Snakes; batch 55.)
        if (isActiveGM() && combat.started && ("turn" in changed || "round" in changed)) serially("turn-end", () => onTurnEnd(combat));
    });
    Hooks.on("combatStart", (combat) => {
        if (isActiveGM()) serially("initiative", () => onInitiative(combat));
    });
    // A condition landing on a monster that can negate it (Shake It Off; batch 49).
    Hooks.on("createItem", (item) => {
        if (isActiveGM() && item.type === "condition" && item.actor?.type === "npc") serially("negate", () => onConditionGained(item));
    });
    // A condition ending on a creature (Consume Fear's "A creature within 60 feet loses the Frightened condition"; batch 46).
    Hooks.on("deleteItem", (item) => {
        if (isActiveGM() && item.type === "condition" && item.actor) serially("condition-lost", () => onConditionLost(item));
    });
    Hooks.on("renderChatMessageHTML", (message, html) => wire(message, html));
    for (const element of document.querySelectorAll("[data-message-id]")) {
        const message = game.messages.get(element.dataset.messageId);
        if (message?.flags?.[MODULE_ID]?.[FLAG]) wire(message, element);
    }
}

// --- Who can react ---------------------------------------------------------------

// A monster's reactions the live cards play: [{ item, plan }].
function reactionsOf(actor) {
    // (A free action with a trigger, such as Cushioned Blow, too.)
    // (Reactive Strike's older name, "Attack of Opportunity", is the same reaction.)
    const same = (plan) => (plan?.builtin === "attack-of-opportunity" ? { ...plan, builtin: "reactive-strike" } : plan);
    // (Not one that can't use reactions: the zombie's Slow; batch 21.)
    if ((actor?.itemTypes?.action ?? []).some((item) => item.system?.actionType?.value === "passive" && compile(item)?.noReactions)) return [];
    // (And a reaction with results of its own whose trigger the module reads: plan.trigger.reaction.)
    return (actor?.itemTypes?.action ?? []).filter((item) => ["reaction", "free"].includes(item.system?.actionType?.value)).map((item) => ({ item, plan: same(compile(item)) }))
        .filter(({ plan, item }) => (KINDS.has(plan?.builtin) && (item.system?.actionType?.value === "reaction" || plan.builtin === "crit-downgrade" || (item.system?.actionType?.value === "free" && plan.free))) || ((item.system?.actionType?.value === "reaction" || plan?.trigger?.free) && plan?.trigger?.reaction && plan.resolution));
}

// Still running, by PF2e's live count (its stored expired flag is only as fresh as the last data preparation).
const running = (effect) => !(effect.remainingDuration?.expired ?? effect.isExpired);
const reactionUsed = (actor) => actor.itemTypes.effect.some((effect) => effect.flags?.[MODULE_ID]?.reactionUsed && running(effect));

// Monsters in the encounter on this scene that can react now: [{ token, actor, reactions }].
function reactors(scene, combat, { atZero = false } = {}) {
    const taking = inEncounter(combat);
    const found = [];
    for (const token of scene.tokens) {
        const actor = token.actor;
        if (!actor || actor.type !== "npc" || token.hidden || !taking.has(token.id)) continue;
        if (!atZero && (actor.isDead || actor.hitPoints?.value <= 0)) continue;
        if (blocksReactions(actor.conditions.active.map((condition) => condition.slug)) || reactionUsed(actor)) continue;
        const reactions = reactionsOf(actor);
        if (reactions.length) found.push({ token, actor, reactions });
    }
    return found;
}

// (Batch 64, Tail Smash: what a critical hit may add.)
const CRITICAL_TRIP = "On a critical hit, it can also attempt an Athletics check to Trip the creature.";

const isFoe = (monster, token) => !!token.actor?.isOfType?.("creature") && token.id !== monster.id && !token.hidden && token.disposition !== monster.disposition;

// Its melee Strikes a reaction may use, with their reach: [{ slug, label, reach }].
function meleeStrikes(actor, name) {
    // (A "melee Strike" with no name, batch 63's and Stand Still's: any of them.)
    const only = onlyStrike(name);
    const any = !only || /^(?:null|melee|weapon|melee weapon)$/.test(only);
    return (actor.system.actions ?? [])
        .filter((action) => action.type === "strike" && action.item?.isMelee !== false && !action.item?.isRanged)
        .filter((action) => any || action.label.toLowerCase().includes(only))
        .map((action) => ({ slug: action.slug, label: action.label, reach: Number(actor.getReach?.({ action: "attack", weapon: action.item })) || 5 }));
}

// --- Triggers -------------------------------------------------------------------

async function onMove(token, movement) {
    const scene = token.parent;
    const combat = scene && runningCombat(scene);
    const waypoints = movement?.passed?.waypoints ?? [];
    // Forced movement and teleports don't trigger reactions.
    if (!combat || !waypoints.length || waypoints.every((point) => point.action === "displace") || !inEncounter(combat).has(token.id)) return;
    const grid = gridOf(scene);
    const path = pathPositions([movement.origin, ...waypoints], { size: grid.size });
    const squares = path.length - 1;
    for (const { token: monster, actor, reactions } of reactors(scene, combat)) {
        if (!isFoe(monster, token)) continue;
        // Scurry, Flit Back (batch 98): a foe ending its move beside it, or coming beside it; Opportune Step's only if dazzled or blinded.
        const off = reactions.find(({ plan }) => plan.builtin === "withdraw" && plan.on === "approach" && (!plan.foe || plan.foe.some((slug) => token.actor?.hasCondition?.(slug))));
        if (off) {
            const insides = path.map((at) => distanceFeet(box(monster, grid.size), box(token, grid.size, at), grid) <= 5);
            if (!insides[0] && (off.plan.enters ? insides.some(Boolean) : insides.at(-1))) {
                const move = withdrawMove(off.plan);
                await offer({ kind: "move", item: off.item, monster, actor, target: token, trigger: off.plan.enters ? "came beside it" : "ended its move beside it", note: move.note, move: { label: move.label } });
                continue;
            }
        }
        // No Escape (batch 99): a foe that started in its reach and moved away from it.
        const chase = reactions.find(({ plan }) => plan.builtin === "follow");
        if (chase) {
            const reach = Math.max(5, ...meleeStrikes(actor, null).map((strike) => strike.reach));
            const distances = path.map((at) => distanceFeet(box(monster, grid.size), box(token, grid.size, at), grid));
            if (distances[0] <= reach && distances.at(-1) > distances[0]) {
                const move = followMove(chase.plan);
                // (Its Reactive Strike's offer too, below: the GM picks one.)
                await offer({ kind: "move", item: chase.item, monster, actor, target: token, trigger: "moved away from it", note: move.note, move: { label: move.label } });
            }
        }
        // Tentacle Trip, Ectoplasmic Filaments, Entangling Train: leaving a square within its distance, moving within it, or
        // coming into it (batch 22).
        const own = reactions.find(({ plan }) => {
            const trigger = plan.trigger;
            if (!trigger?.reaction || trigger.event !== "provoke") return false;
            const radius = provokeRadius(actor, trigger.within);
            const insides = path.map((at) => distanceFeet(box(monster, grid.size), box(token, grid.size, at), grid) <= radius);
            return (trigger.triggers.includes("leave") && leftReach(insides)) || (trigger.triggers.includes("move") && insides.some(Boolean)) || (trigger.triggers.includes("enter") && !insides[0] && insides.some(Boolean));
        });
        if (own) {
            await offer({ kind: "card", item: own.item, monster, actor, target: token, trigger: `moved within ${typeof own.plan.trigger.within === "number" ? `${own.plan.trigger.within} feet` : "its reach"}`, free: !!own.plan.trigger.free, note: squares === 1 ? "If this was a Step, it doesn't trigger." : null });
            continue;
        }
        // Telekinetic Defense, Wing Rebuff (batch 54): a creature coming within its distance (or its Strike's reach), a Strike at it.
        const approach = reactions.find(({ plan }) => plan.builtin === "reaction-strike" && plan.triggers?.includes("approach"));
        if (approach) {
            const strikes = (actor.system.actions ?? []).filter((action) => action.type === "strike" && action.label.toLowerCase().includes(approach.plan.strike))
                .map((action) => ({ slug: action.slug, label: action.label, reach: Number(actor.getReach?.({ action: "attack", weapon: action.item })) || 5 }));
            const radius = approach.plan.within ?? Math.max(5, ...strikes.map((strike) => strike.reach));
            const insides = path.map((at) => distanceFeet(box(monster, grid.size), box(token, grid.size, at), grid) <= radius);
            if (strikes.length && !insides[0] && insides.some(Boolean)) {
                await offer({ kind: "strike", item: approach.item, monster, actor, target: token, strikes, penalty: approach.plan.penalty ?? 0, trigger: `came within ${radius} feet`, note: approach.plan.disrupts ? "If it Pushes the creature, the move is disrupted." : null });
                continue;
            }
        }
        for (const { item, plan } of reactions) {
            const movesTrigger = plan.builtin === "reactive-strike" || (plan.builtin === "reaction-strike" && plan.triggers?.includes("move"));
            if (!movesTrigger) continue;
            // (Batch 68, Snap Shot: a distance in feet, its Strike by name, ranged too.)
            const strikes = plan.within && plan.builtin === "reaction-strike"
                ? (actor.system.actions ?? []).filter((action) => action.type === "strike" && action.label.toLowerCase().includes(plan.strike)).map((action) => ({ slug: action.slug, label: action.label, reach: plan.within }))
                : meleeStrikes(actor, plan.builtin === "reaction-strike" ? `(${plan.strike} only)` : item.name);
            if (!strikes.length) continue;
            const reach = Math.max(...strikes.map((strike) => strike.reach));
            const insides = path.map((at) => distanceFeet(box(monster, grid.size), box(token, grid.size, at), grid) <= reach);
            // Reactive Strike: leaving a square in reach. Twisting Tail: a move action in reach.
            const triggered = plan.builtin === "reactive-strike" ? leftReach(insides) : insides.some(Boolean);
            if (!triggered) continue;
            await offer({
                kind: "strike", item, monster, actor, target: token, strikes, penalty: plan.penalty ?? 0,
                trigger: plan.builtin === "reactive-strike" ? "left a square in its reach" : "moved in its reach",
                note: [squares === 1 ? "If this was a Step, it doesn't trigger." : null, plan.disrupts === "critical" ? "If the Strike is a critical hit, the move is disrupted." : plan.disrupts ? "If the Strike hits, the action is disrupted." : null, plan.criticalTrip ? CRITICAL_TRIP : null].filter(Boolean).join(" ") || null
            });
            break;
        }
    }
}

async function onMessage(message) {
    if (message.flags?.[MODULE_ID]) return;
    const context = message.flags?.pf2e?.context;
    const origin = message.flags?.pf2e?.origin;
    const token = message.token;
    const scene = token?.parent;
    const combat = scene && runningCombat(scene);
    if (!combat || !inEncounter(combat).has(token.id)) return;
    // A mental effect aimed at it (Entropic Feedback; 2026-10-10, batch 17): its card on the creature that aimed it, on Use.
    const event = await targetedEvent(message);
    if (event) {
        const mine = reactors(scene, combat).find((entry) => entry.token.id === event.defender.id);
        const entry = mine && isFoe(mine.token, event.attacker) ? mine.reactions.find(({ plan }) => plan.trigger?.reaction && targetedSetsOff(plan.trigger, event)) : null;
        if (entry) await offer({ kind: "card", item: entry.item, monster: mine.token, actor: mine.actor, target: event.attacker, trigger: `aimed ${event.spell ? "a spell" : "an effect"} at it (${event.traits.filter((trait) => entry.plan.trigger.traits?.includes(trait)).join(", ") || "spell"})`, free: !!entry.plan.trigger.free });
        // Superconductor (batch 57): an attack or a spell aimed at it, its Strike back at the attacker at any range.
        const attack = event.spell || event.traits.includes("attack") || ["attack-roll", "spell-attack-roll"].includes(context?.type);
        const conductor = mine && attack && isFoe(mine.token, event.attacker) ? mine.reactions.find(({ plan }) => plan.builtin === "reaction-strike" && plan.triggers?.includes("targeted")) : null;
        const strikes = conductor ? (mine.actor.system.actions ?? []).filter((action) => action.type === "strike" && action.label.toLowerCase().includes(conductor.plan.strike)).map((action) => ({ slug: action.slug, label: action.label })) : [];
        if (strikes.length) await offer({ kind: "strike", item: conductor.item, monster: mine.token, actor: mine.actor, target: event.attacker, strikes, penalty: conductor.plan.penalty ?? 0, trigger: `aimed ${event.spell ? "a spell" : "an attack"} at it`, note: "At any range." });
    }
    // (Batch 65: a failed Escape from a monster that answers it; batch 81: one it makes harder. PF2e rolls the Escape with the best of
    // Acrobatics, Athletics and an unarmed attack: a skill check or an attack roll.)
    if (["skill-check", "attack-roll"].includes(context?.type) && (context.options ?? []).includes("action:escape")) await escapeAnswers(message, context, scene, combat, token);
    if (context?.type === "attack-roll") {
        const ranged = (context.options ?? []).includes("item:ranged") || (context.domains ?? []).includes("ranged-attack-roll");
        if (ranged) await reachTrigger(scene, combat, token, "made a ranged attack in its reach", "ranged");
        if (ranged) await provokeTrigger(scene, combat, token, "ranged", "made a ranged attack");
        await defend(message, context, scene, combat, token);
        await guardAlly(message, context, scene, combat, token);
        await ownStrike(message, context, scene, combat, token);
        await strikeAnswers(context, scene, combat, token);
        await allyHitAnswers(context, scene, combat, token);
        await withdrawAnswers(context, scene, combat, token);
        if (context.outcome === "criticalFailure") await mishapAnswers(scene, token, "critically failed a Strike");
        return;
    }
    // A failed saving throw (batch 53): Golden Luck, Word of Wisdom, Cat's Luck.
    if (context?.type === "saving-throw" && ["failure", "criticalFailure"].includes(context.outcome)) await saveAnswers(message, context, scene, combat, token);
    // (A skill check that's an attack, Trip or Grapple: Tail Lash's other trigger, batch 38.)
    if (context?.type === "skill-check" && (context.traits ?? []).map((trait) => trait?.name ?? trait).includes("attack")) await strikeAnswers(context, scene, combat, token, { skill: true });
    // A spell cast (its card, which PF2e 8.5 marks "spell-cast"; not its rolls), with the manipulate trait.
    const castTraits = (context?.type === "spell-cast" || !context?.type) && origin?.type === "spell" ? (message.item?.system?.traits?.value ?? []) : null;
    if (castTraits?.includes("manipulate")) {
        await reachTrigger(scene, combat, token, "cast a manipulate spell in its reach", "manipulate");
        await provokeTrigger(scene, combat, token, "manipulate", "cast a manipulate spell");
    }
    // A concentrate action: a spell with the trait, or a check with it (Demoralize; batch 22).
    if (castTraits?.includes("concentrate") || (context?.type === "skill-check" && (context.traits ?? []).map((trait) => trait?.name ?? trait).includes("concentrate"))) {
        await provokeTrigger(scene, combat, token, "concentrate", castTraits ? "cast a concentrate spell" : "used a concentrate action");
    }
}

// Tail Lash, Avenging Bite, Violent Retort (batch 38): a Strike in its reach (or a skill check that's an attack), an attack on one of
// its allies, a critical hit on it; a Strike at it, a critically failed one (batch 57): its reaction Strike, offered at the creature.
// Tail Lash's hit: the GM lowers the roll.
async function strikeAnswers(context, scene, combat, attacker, { skill = false } = {}) {
    const grid = gridOf(scene);
    const targetToken = context.target?.token ? fromUuidSync(context.target.token) : null;
    for (const { token: monster, actor, reactions } of reactors(scene, combat)) {
        if (!isFoe(monster, attacker)) continue;
        for (const { item, plan } of reactions) {
            if (plan.builtin !== "reaction-strike") continue;
            const triggers = plan.triggers ?? [];
            const onIt = targetToken?.id === monster.id;
            const onAlly = !!targetToken && targetToken.id !== monster.id && targetToken.disposition === monster.disposition;
            const why = triggers.includes(skill ? "skill" : "strike") ? (skill ? "attempted an attack check in its reach" : "made a Strike in its reach")
                : !skill && triggers.includes("ally-attacked") && onAlly ? "attacked its ally"
                : !skill && triggers.includes("critical-hit") && onIt && context.outcome === "criticalSuccess" ? "critically hit it"
                // (Batch 88: a melee hit on it, Absorb Weapon's.)
                : !skill && triggers.includes("hit") && onIt && ["success", "criticalSuccess"].includes(context.outcome) && !(context.options ?? []).includes("item:ranged") ? "hit it with a melee Strike"
                // (Batch 57: Cutting Rebuke, Bite Back; Opportune Bite, Gnawing Retort.)
                : !skill && triggers.includes("attacked") && onIt ? "made a Strike against it"
                : !skill && triggers.includes("critical-miss") && onIt && context.outcome === "criticalFailure" ? "critically failed a Strike against it"
                // (Batch 63: a failed or critically failed one.)
                : !skill && triggers.includes("missed") && onIt && ["failure", "criticalFailure"].includes(context.outcome) ? `${context.outcome === "failure" ? "failed" : "critically failed"} a Strike against it`
                // (Batch 66, Counterattack: an attack from beside it while it's concealed; the GM checks the flat check failed.)
                : !skill && triggers.includes("concealed-miss") && onIt && (actor.hasCondition?.("concealed") || actor.hasCondition?.("hidden")) ? "attacked it while it's concealed" : null;
            if (!why) continue;
            const distance = distanceFeet(box(monster, grid.size), box(attacker, grid.size), grid);
            // (Batch 88: a basic maneuver in place of the Strike, at a creature in its reach.)
            if (plan.skill) {
                if (distance > provokeRadius(actor)) continue;
                await offer({ kind: "skill", item, monster, actor, target: attacker, trigger: why, skill: { slug: plan.skill, shift: (plan.bonus ?? 0) - (plan.penalty ?? 0) } });
                break;
            }
            const strikes = meleeStrikes(actor, `(${plan.strike} only)`).filter((strike) => distance <= strike.reach);
            if (!strikes.length) continue;
            await offer({ kind: "strike", item, monster, actor, target: attacker, strikes, penalty: plan.penalty ?? 0, trigger: why, note: plan.hinders ? `If the Strike hits, the triggering roll takes a –${plan.hinders} circumstance penalty: lower its result by ${plan.hinders}.` : plan.fortune ? "Roll the attack twice and take the better result (a fortune effect)." : triggers.includes("concealed-miss") ? "Only if the attack missed because of its concealment (a failed flat check)." : null });
            break;
        }
    }
}

// One of its allies hitting a creature in its reach with a melee Strike (batch 94, Opportune Backstab): its Strike offer at that creature.
async function allyHitAnswers(context, scene, combat, attacker) {
    if (!["success", "criticalSuccess"].includes(context.outcome) || (context.options ?? []).includes("item:ranged")) return;
    const target = context.target?.token ? fromUuidSync(context.target.token) : null;
    if (!target) return;
    const grid = gridOf(scene);
    for (const { token: monster, actor, reactions } of reactors(scene, combat)) {
        if (monster.id === attacker.id || monster.disposition !== attacker.disposition || !isFoe(monster, target)) continue;
        const entry = reactions.find(({ plan }) => plan.builtin === "reaction-strike" && plan.triggers?.includes("ally-hit"));
        if (!entry) continue;
        const distance = distanceFeet(box(monster, grid.size), box(target, grid.size), grid);
        const strikes = meleeStrikes(actor, `(${entry.plan.strike} only)`).filter((strike) => distance <= strike.reach);
        if (strikes.length) await offer({ kind: "strike", item: entry.item, monster, actor, target, strikes, penalty: entry.plan.penalty ?? 0, trigger: `was hit by ${attacker.name}` });
    }
}

// A melee Strike on it that misses, hits, or is made at all (batch 98: Skitter, Skittish, Bolt): its offer to move off.
async function withdrawAnswers(context, scene, combat, attacker) {
    if ((context.options ?? []).includes("item:ranged")) return;
    const target = context.target?.token ? fromUuidSync(context.target.token) : null;
    const mine = target ? reactors(scene, combat).find((entry) => entry.token.id === target.id) : null;
    if (!mine || !isFoe(mine.token, attacker)) return;
    const hit = ["success", "criticalSuccess"].includes(context.outcome);
    const entry = mine.reactions.find(({ plan }) => plan.builtin === "withdraw" && (plan.on === "attacked" || (plan.on === "hit" && hit) || (plan.on === "missed" && ["failure", "criticalFailure"].includes(context.outcome))));
    if (!entry) return;
    const move = withdrawMove(entry.plan);
    await offer({ kind: "move", item: entry.item, monster: mine.token, actor: mine.actor, target: attacker, trigger: entry.plan.on === "missed" ? "missed it with a melee Strike" : hit ? "hit it with a melee Strike" : "made a melee Strike against it", note: move.note, move: { label: move.label } });
}

// A creature a monster holds failing to Escape (batch 65: Savage, Gnashing Bite): the monster's Strike or card at it. The monster: the
// Escape's target, or else a foe in its reach.
async function escapeAnswers(message, context, scene, combat, escaper) {
    const holder = context.target?.token ? fromUuidSync(context.target.token) : null;
    const grid = gridOf(scene);
    // (Batch 81: a reaction that makes the Escape harder, Tighten Coils: offered when its higher DC turns the success into a failure.)
    if (["success", "criticalSuccess"].includes(context.outcome)) {
        const dc = context.dc?.value;
        const roll = message.rolls?.[0];
        if (!Number.isFinite(dc)) return;
        for (const { token: monster, actor, reactions } of reactors(scene, combat)) {
            if (!isFoe(monster, escaper) || (holder && holder.id !== monster.id)) continue;
            if (!holder && distanceFeet(box(monster, grid.size), box(escaper, grid.size), grid) > provokeRadius(actor)) continue;
            const entry = reactions.find(({ plan }) => plan.builtin === "escape-guard");
            const change = entry ? higherAC({ total: roll?.total, dc, natural: roll?.dice?.[0]?.total ?? null, outcome: context.outcome }, entry.plan.value) : null;
            if (change) return offer({ kind: "ac", item: entry.item, monster, actor, target: escaper, trigger: `rolled ${degreeWords(change.before, true)} to Escape`, attack: { messageId: message.id, value: entry.plan.value, what: "Escape DC", ...change } });
        }
        return;
    }
    if (!["failure", "criticalFailure"].includes(context.outcome)) return;
    const critical = context.outcome === "criticalFailure";
    for (const { token: monster, actor, reactions } of reactors(scene, combat)) {
        if (!isFoe(monster, escaper) || (holder && holder.id !== monster.id)) continue;
        if (!holder && distanceFeet(box(monster, grid.size), box(escaper, grid.size), grid) > provokeRadius(actor)) continue;
        const why = `${critical ? "critically failed" : "failed"} to Escape`;
        for (const { item, plan } of reactions) {
            if (plan.builtin === "reaction-strike" && (plan.triggers?.includes("escape-failed") || (critical && plan.triggers?.includes("escape-critical-failure")))) {
                const strikes = meleeStrikes(actor, `(${plan.strike} only)`);
                if (strikes.length) return offer({ kind: "strike", item, monster, actor, target: escaper, strikes, trigger: why });
            }
            if (plan.trigger?.reaction && plan.trigger.event === "escape-failed" && (!plan.trigger.critical || critical)) return offer({ kind: "card", item, monster, actor, target: escaper, trigger: why, free: !!plan.trigger.free });
        }
    }
}

// Its reach, or the feet its trigger names.
function provokeRadius(actor, within) {
    if (typeof within === "number") return within;
    return Math.max(5, ...meleeStrikes(actor, "").map((strike) => strike.reach));
}

// A reaction with results of its own to a creature acting within its distance (Quick Spike, Brine Spit, Baleful Gaze; batch 22).
async function provokeTrigger(scene, combat, token, kind, words) {
    const grid = gridOf(scene);
    for (const { token: monster, actor, reactions } of reactors(scene, combat)) {
        if (!isFoe(monster, token)) continue;
        const entry = reactions.find(({ plan }) => plan.trigger?.reaction && plan.trigger.event === "provoke" && plan.trigger.triggers.includes(kind) && distanceFeet(box(monster, grid.size), box(token, grid.size), grid) <= provokeRadius(actor, plan.trigger.within));
        if (entry) await offer({ kind: "card", item: entry.item, monster, actor, target: token, trigger: words, free: !!entry.plan.trigger.free });
    }
}

// Reactive Strike against a creature in reach that made a ranged attack or cast a manipulate spell.
async function reachTrigger(scene, combat, token, trigger, kind = null) {
    const grid = gridOf(scene);
    for (const { token: monster, actor, reactions } of reactors(scene, combat)) {
        if (!isFoe(monster, token)) continue;
        // (Batch 64: a reaction Strike its trigger sets off on a ranged attack in its reach, Tail Smash's; the GM checks it was at it.)
        const entry = reactions.find(({ plan }) => plan.builtin === "reactive-strike" || (kind && plan.builtin === "reaction-strike" && plan.triggers?.includes(kind)));
        if (!entry) continue;
        const distance = distanceFeet(box(monster, grid.size), box(token, grid.size), grid);
        // (Batch 68: a distance in feet, Snap Shot's, its Strike by name, ranged too.)
        const strikes = (entry.plan.within && entry.plan.builtin === "reaction-strike"
            ? (actor.system.actions ?? []).filter((action) => action.type === "strike" && action.label.toLowerCase().includes(entry.plan.strike)).map((action) => ({ slug: action.slug, label: action.label, reach: entry.plan.within }))
            : meleeStrikes(actor, entry.plan.builtin === "reaction-strike" ? `(${entry.plan.strike} only)` : entry.item.name)).filter((strike) => distance <= strike.reach);
        if (strikes.length) await offer({ kind: "strike", item: entry.item, monster, actor, target: token, strikes, trigger, note: entry.plan.criticalTrip ? CRITICAL_TRIP : null });
    }
}

// An attack roll on a monster's ally (batch 66: Hammer Block, Stygian Guardian): the monster's +AC for it, offered when that changes the
// result; Reactive Defense's Strike after it, a note.
async function guardAlly(message, context, scene, combat, attacker) {
    const targetToken = context.target?.token ? fromUuidSync(context.target.token) : null;
    if (!targetToken || !inEncounter(combat).has(targetToken.id) || !["success", "criticalSuccess"].includes(context.outcome)) return;
    const roll = message.rolls?.[0];
    const dc = context.dc?.value;
    if (!Number.isFinite(dc)) return;
    const options = context.options ?? [];
    const ranged = options.includes("item:ranged") || (context.domains ?? []).includes("ranged-attack-roll");
    const grid = gridOf(scene);
    for (const { token: guard, actor, reactions } of reactors(scene, combat)) {
        if (guard.id === targetToken.id || guard.disposition !== targetToken.disposition || !isFoe(guard, attacker)) continue;
        const entry = reactions.find(({ plan }) => plan.builtin === "ally-ac-reaction" && (!plan.ranged || ranged));
        if (!entry) continue;
        const within = entry.plan.within === "reach" ? provokeRadius(actor) : Number(entry.plan.within) || 5;
        if (distanceFeet(box(guard, grid.size), box(targetToken, grid.size), grid) > within) continue;
        const change = higherAC({ total: roll?.total, dc, natural: roll?.dice?.[0]?.total ?? null, outcome: context.outcome }, entry.plan.value);
        if (!change) continue;
        return offer({ kind: "ac", item: entry.item, monster: guard, actor, target: attacker, trigger: `rolled ${degreeWords(change.before)} against ${targetToken.name}`, note: entry.plan.strike ? "Then its melee Strike at the attacker: roll it from its sheet." : null, attack: { messageId: message.id, value: entry.plan.value, ...change } });
    }
}

// An attack roll on a monster: Nimble Dodge when its AC bonus changes the result; Challenge Fate on a hit.
async function defend(message, context, scene, combat, attacker) {
    const targetToken = context.target?.token ? fromUuidSync(context.target.token) : null;
    if (!targetToken || !inEncounter(combat).has(targetToken.id)) return;
    const mine = reactors(scene, combat).find((entry) => entry.token.id === targetToken.id);
    if (!mine || !isFoe(mine.token, attacker)) return;
    const roll = message.rolls?.[0];
    const dc = context.dc?.value;
    const hit = ["success", "criticalSuccess"].includes(context.outcome);
    const options = context.options ?? [];
    const ranged = options.includes("item:ranged") || (context.domains ?? []).includes("ranged-attack-roll");
    const unarmed = options.includes("item:category:unarmed") || options.includes("item:trait:unarmed");
    const grid = gridOf(scene);
    const distance = distanceFeet(box(mine.token, grid.size), box(attacker, grid.size), grid);
    for (const { item, plan } of mine.reactions) {
        // Hypnotic Tattoos, Venom Spit: targeted by the attack (batch 18). PF2e has rolled it already: the GM sets it aside when
        // the reaction's result stops it.
        const trigger = plan.trigger;
        if (trigger?.reaction && trigger.event === "attacked" && (!trigger.melee || !ranged) && !(trigger.within && distance > trigger.within)) {
            return offer({ kind: "card", item, monster: mine.token, actor: mine.actor, target: attacker, trigger: "attacked it", free: !!trigger.free, note: "It comes before the attack roll: if its result stops the attack, set the roll aside." });
        }
        // Shrapnel Splash, Reactive Thrash: its card on Use.
        if (hitSetsOff(plan.trigger, { outcome: context.outcome, ranged, unarmed, distance })) {
            return offer({ kind: "card", item, monster: mine.token, actor: mine.actor, target: attacker, trigger: `rolled ${degreeWords(context.outcome)} against it`, note: damageNote(plan.trigger), free: !!plan.trigger.free });
        }
        // Only a hit it could undo (turning a miss into a critical miss rarely matters).
        // (Only melee or only ranged attacks when the trigger says so; what else it does, a note: "then Strides up to half its Speed".)
        if (plan.builtin === "ac-reaction" && Number.isFinite(dc) && hit && (!plan.against || (plan.against === "ranged") === ranged)) {
            const change = higherAC({ total: roll?.total, dc, natural: roll?.dice?.[0]?.total ?? null, outcome: context.outcome }, plan.value);
            if (change) return offer({ kind: "ac", item, monster: mine.token, actor: mine.actor, target: attacker, trigger: `rolled ${degreeWords(change.before)} against it`, note: plan.notes?.join(" ") || null, attack: { messageId: message.id, value: plan.value, ...change } });
        }
        if (plan.builtin === "attack-misfortune" && hit) return offer({ kind: "misfortune", item, monster: mine.token, actor: mine.actor, target: attacker, trigger: `rolled ${degreeWords(context.outcome)} against it`, attack: { messageId: message.id } });
        // Wished Away (batch 29): resistance to all damage against the critical hit, for the GM as the damage is applied.
        if (plan.builtin === "crit-resistance" && context.outcome === "criticalSuccess") {
            const text = `Resistance ${plan.value} to all damage against this attack: take ${plan.value} off each damage type as you apply its damage.`;
            return offer({ kind: "flat", item, monster: mine.token, actor: mine.actor, target: attacker, trigger: "critically hit it", note: text, attack: { messageId: message.id, dc: null, text } });
        }
        // (No check, batch 29: Collapse, Twist Fate: the critical hit becomes a normal hit; Collapse leaves it immobilized and off-guard.)
        // (Batch 58, Unbidden Thoughts: the attacker chooses, a normal hit or the critical hit and Frightened 2; a button for each.)
        const or = plan.or ? `${plan.or.slug.replace(/^\w/, (letter) => letter.toUpperCase())} ${plan.or.value}` : null;
        if (plan.builtin === "crit-downgrade" && context.outcome === "criticalSuccess") return offer({ kind: "flat", item, monster: mine.token, actor: mine.actor, target: attacker, trigger: "critically hit it", note: or ? `${attacker.name} chooses: the critical hit becomes a normal hit, or it stands and ${attacker.name} is ${or}.` : plan.dc == null ? `The critical hit becomes a normal hit${plan.collapse ? "; it collapses, Immobilized and Off-Guard until it re-forms (an action)" : ""}.` : "On a success, the critical hit becomes a normal hit.", attack: { messageId: message.id, dc: plan.dc ?? null, free: item.system?.actionType?.value === "free", collapse: Boolean(plan.collapse), ...(plan.or ? { or: { ...plan.or, label: or } } : {}) } });
        // Concealment against the attack (Shadow Evade): offered on a hit, the attacker's flat check; a failure misses (2026-10-10).
        if (plan.builtin === "conceal-reaction" && hit && (!plan.ranged || ranged)) {
            return offer({ kind: "flat", item, monster: mine.token, actor: mine.actor, target: attacker, trigger: `rolled ${degreeWords(context.outcome)} against it`, note: `${attacker.name} rolls a DC ${plan.dc} flat check (${plan.dc === 11 ? "as if it were Hidden" : "concealment"}); on a failure, the attack misses.`,
                attack: { messageId: message.id, dc: plan.dc, success: "success. The attack still hits.", failure: "failure. The attack misses: ignore its damage and effects." } });
        }
    }
}

// Its own Strike that hits or critically hits (Pin Prey, Storm Smite, Go For the Eyes; batch 18): the Strike its trigger
// names, a creature no bigger than it says.
async function ownStrike(message, context, scene, combat, token) {
    if (!["success", "criticalSuccess"].includes(context.outcome)) return;
    const mine = reactors(scene, combat).find((entry) => entry.token.id === token.id);
    if (!mine) return;
    const strike = message.flags?.pf2e?.origin?.uuid ? await fromUuid(message.flags.pf2e.origin.uuid) : null;
    const target = context.target?.token ? await fromUuid(context.target.token) : null;
    if (!strike || !target?.actor || !isFoe(mine.token, target)) return;
    for (const { item, plan } of mine.reactions) {
        const trigger = plan.trigger;
        if (!trigger?.reaction || trigger.event !== "own-strike" || !trigger.on?.includes(context.outcome)) continue;
        const conditions = [...(target.actor.conditions ?? [])].map((condition) => condition.slug);
        if (!ownStrikeSetsOff(trigger, { outcome: context.outcome, strikeName: strike.name, options: context.options ?? [], conditions, ownTurn: combat?.combatant ? combat.combatant.tokenId === mine.token.id : null }) || !fitsSize(target.actor.size, trigger.maxSize)) continue;
        return offer({ kind: "card", item, monster: mine.token, actor: mine.actor, target, trigger: `took ${degreeWords(context.outcome)} from ${strike.name}`, free: !!trigger.free });
    }
}

// A creature ending its turn adjacent to a monster (Biting Snakes, batch 55): its Strike offer at that creature.
async function onTurnEnd(combat) {
    const token = combat.previous?.tokenId ? combat.scene?.tokens?.get(combat.previous.tokenId) ?? game.scenes.get(combat.previous.sceneId ?? "")?.tokens?.get(combat.previous.tokenId) : null;
    const scene = token?.parent;
    if (!token?.actor || !scene) return;
    const grid = gridOf(scene);
    for (const { token: monster, actor, reactions } of reactors(scene, combat)) {
        if (monster.id === token.id || !isFoe(monster, token)) continue;
        const entry = reactions.find(({ plan }) => plan.builtin === "reaction-strike" && plan.triggers?.includes("turn-end-adjacent"));
        if (!entry || distanceFeet(box(monster, grid.size), box(token, grid.size), grid) > 5) continue;
        const strikes = meleeStrikes(actor, `(${entry.plan.strike} only)`);
        if (strikes.length) await offer({ kind: "strike", item: entry.item, monster, actor, target: token, strikes, penalty: entry.plan.penalty ?? 0, trigger: "ended its turn beside it" });
    }
}

// A creature's turn starting within the distance of a monster's reaction to it (Petrifying Glance, Draining Glance).
async function onTurnStart(combat) {
    const token = combat.combatant?.token;
    const scene = token?.parent;
    if (!token?.actor || !scene) return;
    // Its own free action as its turn begins (Shrieking Frenzy, Sudden Surge; batch 26).
    const self = reactors(scene, combat).find((entry) => entry.token.id === token.id);
    const own = self?.reactions.find(({ plan }) => plan.trigger?.event === "own-turn-start");
    if (own) await offer({ kind: "card", item: own.item, monster: token, actor: token.actor, target: null, trigger: "its turn begins", free: true });
    const grid = gridOf(scene);
    const living = !["undead", "construct"].some((trait) => token.actor.traits?.has?.(trait));
    for (const { token: monster, actor, reactions } of reactors(scene, combat)) {
        if (!isFoe(monster, token)) continue;
        const entry = reactions.find(({ plan }) => plan.trigger?.reaction && plan.trigger.event === "turn-start" && (!plan.trigger.living || living));
        if (!entry || distanceFeet(box(monster, grid.size), box(token, grid.size), grid) > entry.plan.trigger.within) continue;
        await offer({ kind: "card", item: entry.item, monster, actor, target: token, trigger: `starts its turn within ${entry.plan.trigger.within} feet`, free: !!entry.plan.trigger.free });
    }
}

// A condition landing on a monster that negates it (Shake It Off, Slough Skin; batch 49, the user's choice): the offer to remove it,
// while it has a use left (its frequency). Not for a condition that helps it, nor off-guard.
const NOT_HARMFUL = new Set(["off-guard", "quickened", "concealed", "hidden", "invisible", "undetected", "unnoticed"]);
async function onConditionGained(item) {
    const slug = item.slug ?? item.system?.slug;
    if (!slug || NOT_HARMFUL.has(slug)) return;
    const token = item.actor?.token ?? item.actor?.getActiveTokens?.(false, true)?.[0] ?? null;
    const scene = token?.parent;
    if (!scene) return;
    if (slug === "prone") await mishapAnswers(scene, token, "fell prone");
    const mine = reactors(scene, game.combat).find((entry) => entry.token.id === token.id);
    const entry = mine?.reactions.find(({ plan }) => plan.builtin === "negate-condition" && (!plan.conditions || plan.conditions.includes(slug)));
    if (!entry) return;
    const left = Number(entry.item.system?.frequency?.value);
    if (Number.isFinite(left) && left <= 0) return;
    await offer({ kind: "negate", item: entry.item, monster: token, actor: mine.actor, target: null, trigger: `it would be ${item.name}`, negate: { itemId: item.id, name: item.name } });
}

// A failed save in an encounter (batch 53): the saver's own Cat's Luck (that kind of save; a reroll keeping the better, while it has a use
// today) or Golden Luck (one degree better), or an ally's Word of Wisdom within its distance (one degree better, for the GM to apply).
async function saveAnswers(message, context, scene, combat, saver) {
    const statistic = ["fortitude", "reflex", "will"].find((save) => context.statistic === save || (context.domains ?? []).includes(save));
    const better = context.outcome === "criticalFailure" ? "a failure" : "a success";
    const grid = gridOf(scene);
    for (const { token, actor, reactions } of reactors(scene, combat)) {
        const self = token.id === saver.id;
        for (const { item, plan } of reactions) {
            // (Batch 65: "must use the new result", keep "new"; a free action's.)
            if (self && plan.builtin === "save-reroll" && (!plan.save || plan.save === statistic)) {
                const left = Number(item.system?.frequency?.value);
                if (Number.isFinite(left) && left <= 0) continue;
                return offer({ kind: "reroll", item, monster: token, actor, target: null, trigger: `failed its ${statistic ?? ""} save`.replace(/ {2,}/g, " "), attack: { messageId: message.id, keep: plan.keep ?? "higher" }, free: !!plan.free, note: plan.mythic ? "It costs a Mythic Point." : null });
            }
            // (Batch 87, Occult Ward: a bonus to its own save, offered when it turns the failure around; against a spell, a spell's save.)
            if (self && plan.builtin === "save-bonus-reaction") {
                const roll = message.rolls?.[0];
                const dc = context.dc?.value;
                const spell = message.flags?.pf2e?.origin?.type === "spell" || (context.options ?? []).some((option) => /^origin:item:type:spell$|^item:type:spell$/.test(option));
                const magical = spell || (context.options ?? []).some((option) => /^(?:origin:)?item:trait:(?:magical|arcane|divine|occult|primal)$/.test(option));
                if (!Number.isFinite(dc) || !Number.isFinite(roll?.total) || (plan.against === "spell" && !spell) || (plan.against === "magical" && !magical)) continue;
                const after = degreeOf(roll.total + plan.value, dc, roll.dice?.[0]?.total ?? null);
                if (after === context.outcome) continue;
                return offer({ kind: "ac", item, monster: token, actor, target: null, trigger: `failed its ${statistic ?? ""} save`.replace(/ {2,}/g, " "), attack: { messageId: message.id, value: plan.value, what: "to the save", before: context.outcome, after } });
            }
            if (plan.builtin !== "save-boost" || (self ? plan.ally : !plan.ally)) continue;
            if (!self && (token.disposition !== saver.disposition || (plan.within && distanceFeet(box(token, grid.size), box(saver, grid.size), grid) > plan.within))) continue;
            // (Batch 65: only a critical failure, Reality Twist's; once a day, Stubborn Resolve's.)
            if (plan.criticalOnly && context.outcome !== "criticalFailure") continue;
            const left = Number(item.system?.frequency?.value);
            if (self && plan.uses && Number.isFinite(left) && left <= 0) continue;
            return offer({ kind: "boost", item, monster: token, actor, target: self ? null : saver, trigger: self ? "failed a saving throw" : "failed a saving throw", note: `The save becomes ${better}: apply that result instead.${plan.recharge ? ` Not again for ${plan.recharge} rounds.` : ""}`, free: !!plan.free });
        }
    }
}

// A creature a monster downed (You're Next, batch 52): that monster's reaction offer, its card at the GM's target. The monster: the
// source of the damage the core remembered for the creature, in the last ten seconds.
async function onDowned(actor) {
    const source = game.modules.get("pf2e-resolution-core")?.api?.patches?.damage?.lastSource(actor.uuid);
    if (!source?.actor || Date.now() - (source.at ?? 0) > 10000) return;
    for (const token of actor.getActiveTokens(false, true)) {
        const scene = token.parent;
        const combat = scene && runningCombat(scene);
        if (!combat) continue;
        const mine = reactors(scene, combat).find((entry) => entry.actor.uuid === source.actor);
        const entry = mine?.reactions.find(({ plan }) => plan.trigger?.reaction && plan.trigger.event === "downs");
        if (entry) await offer({ kind: "card", item: entry.item, monster: mine.token, actor: mine.actor, target: null, trigger: `downed ${token.name}`, free: !!entry.plan.trigger.free });
    }
}

// A foe's mishap within a monster's distance (Jeer at Failure, batch 57: "A foe within 90 feet becomes Prone or critically fails on a
// Strike"): the monster's reaction, at that foe.
async function mishapAnswers(scene, token, why) {
    const combat = runningCombat(scene);
    if (!combat || !inEncounter(combat).has(token.id)) return;
    const grid = gridOf(scene);
    for (const { token: monster, actor, reactions } of reactors(scene, combat)) {
        if (!isFoe(monster, token)) continue;
        const entry = reactions.find(({ plan }) => plan.trigger?.reaction && plan.trigger.event === "foe-mishap");
        if (!entry || (entry.plan.trigger.within && distanceFeet(box(monster, grid.size), box(token, grid.size), grid) > entry.plan.trigger.within)) continue;
        await offer({ kind: "card", item: entry.item, monster, actor, target: token, trigger: why, free: !!entry.plan.trigger.free });
    }
}

// A creature losing a condition within a monster's distance (Consume Fear, batch 46): the monster's reaction, on itself.
async function onConditionLost(item) {
    const slug = item.slug ?? item.system?.slug;
    const token = item.actor?.token ?? item.actor?.getActiveTokens?.(false, true)?.[0] ?? null;
    const scene = token?.parent;
    if (!slug || !scene) return;
    const grid = gridOf(scene);
    for (const { token: monster, actor, reactions } of reactors(scene, game.combat)) {
        if (monster.id === token.id) continue;
        const entry = reactions.find(({ plan }) => plan.trigger?.reaction && plan.trigger.event === "condition-lost" && plan.trigger.condition === slug);
        if (!entry || (entry.plan.trigger.within && distanceFeet(box(monster, grid.size), box(token, grid.size), grid) > entry.plan.trigger.within)) continue;
        await offer({ kind: "card", item: entry.item, monster, actor, target: null, trigger: `${token.name} is no longer ${slug}`, free: !!entry.plan.trigger.free });
    }
}

// The encounter starting: a monster's reaction to rolling initiative (Chilling Cry, Predestined Defeat).
async function onInitiative(combat) {
    const scene = combat.scene ?? game.scenes.get(combat.combatants.contents[0]?.sceneId);
    if (!scene) return;
    for (const { token: monster, actor, reactions } of reactors(scene, combat)) {
        const entry = reactions.find(({ plan }) => plan.trigger?.reaction && plan.trigger.event === "initiative");
        if (entry) await offer({ kind: "card", item: entry.item, monster, actor, target: null, trigger: "rolls initiative", free: !!entry.plan.trigger.free });
    }
}

// Reduced to 0 HP: Ferocity, or Death Frenzy's last Strike.
async function onDown(actor) {
    if (actor.type !== "npc") return;
    for (const token of actor.getActiveTokens(false, true)) {
        const scene = token.parent;
        const combat = scene && runningCombat(scene);
        if (!combat) continue;
        const mine = reactors(scene, combat, { atZero: true }).find((entry) => entry.token.id === token.id);
        if (!mine) continue;
        for (const { item, plan } of mine.reactions) {
            // (Batch 67, Ferocity's kin: its Hit Points, whether it's wounded, a use of its frequency, a Mythic Point, a Strike after.)
            const left = Number(item.system?.frequency?.value);
            if (plan.builtin === "ferocity" && (plan.wounded === false || (actor.getCondition?.("wounded")?.value ?? 0) < 3) && !(plan.uses && Number.isFinite(left) && left <= 0)) {
                const hp = plan.hp ?? 1;
                await offer({ kind: "ferocity", item, monster: token, actor, target: null, trigger: "is reduced to 0 HP", free: !!plan.free, note: [plan.mythic ? "It costs a Mythic Point." : null, plan.strike ? `Then its ${plan.strike} Strike at a creature in its reach: roll it from its sheet.` : null].filter(Boolean).join(" ") || null, survive: { hp, wounded: plan.wounded !== false } });
            }
            if (plan.builtin === "death-strike") {
                const strikes = meleeStrikes(actor, plan.strike ? `(${plan.strike} only)` : item.name);
                if (strikes.length) await offer({ kind: "strike", item, monster: token, actor, target: null, strikes, trigger: "is reduced to 0 HP: a Strike before it dies", note: "It Strikes your target." });
            }
        }
    }
}

// Damage on a monster's ally: Retributive Strike, against the creature whose turn it is when that's a foe.
// The damage just applied, by type (batch 71): the latest damage roll's instances (within 15 seconds), [{ type, total }]; null when
// there's no damage roll to go by.
function lastDamageTypes() {
    const message = game.messages.contents.slice(-10).reverse().find((entry) => entry.flags?.pf2e?.context?.type === "damage-roll" && Date.now() - (entry.timestamp ?? 0) < 15000);
    const instances = message?.rolls?.[0]?.instances ?? [];
    return instances.length ? instances.map((instance) => ({ type: instance.type, total: Number(instance.total) || 0 })) : null;
}

async function onDamaged(actor, amount) {
    for (const token of actor.getActiveTokens(false, true)) {
        const scene = token.parent;
        const combat = scene && runningCombat(scene);
        if (!combat || !inEncounter(combat).has(token.id)) continue;
        const attacker = combat.combatant?.token;
        // Its own reaction to damage on it (Solar Flare, Caustic Blood): the creature whose turn it is taken as the attacker.
        const mine = reactors(scene, combat).find((entry) => entry.token.id === token.id);
        const own = mine?.reactions.find(({ plan }) => plan.trigger?.reaction && plan.trigger.event === "damaged");
        if (own) {
            const foe = attacker && attacker.id !== token.id && attacker.parent?.id === scene.id && isFoe(token, attacker) ? attacker : null;
            await offer({ kind: "card", item: own.item, monster: token, actor, target: foe, trigger: foe ? `hurt it (${amount} damage, on ${foe.name}'s turn)` : `It took ${amount} damage`, note: damageNote(own.plan.trigger), free: !!own.plan.trigger.free });
        }
        // Skittish (batch 98): damage from a Strike, the creature whose turn it is taken as the attacker; the GM checks it was a Strike.
        const off = mine?.reactions.find(({ plan }) => plan.builtin === "withdraw" && plan.on === "damaged");
        if (off) {
            const foe = attacker && attacker.id !== token.id && attacker.parent?.id === scene.id && isFoe(token, attacker) ? attacker : null;
            const move = withdrawMove(off.plan);
            await offer({ kind: "move", item: off.item, monster: token, actor, target: foe, trigger: foe ? `damaged it (${amount})` : `It took ${amount} damage`, note: `Only if the damage came from a${off.plan.melee ? " melee" : ""} Strike. ${move.note}`, move: { label: move.label } });
        }
        // Liquefy, Chipping Scales (batch 71): its resistance against that damage, given back as Hit Points (the GM checks the type);
        // an enemy's damage only when it says so; while it has a use left.
        // (The damage's types from its damage roll when there is one: no offer when none of them sets it off; the resistance off each type.)
        // (Not while its resistance from before still lasts: they don't stack.)
        const resist = mine?.reactions.find(({ plan }) => plan.builtin === "resist-damage");
        const usesLeft = Number(resist?.item.system?.frequency?.value);
        const lasting = resist && actor.itemTypes.effect.some((effect) => effect.flags?.[MODULE_ID]?.resist && effect.name === resist.item.name && !effect.isExpired);
        if (resist && !lasting && !(Number.isFinite(usesLeft) && usesLeft <= 0)) {
            const plan = resist.plan;
            const foe = attacker && attacker.id !== token.id && attacker.parent?.id === scene.id && isFoe(token, attacker) ? attacker : null;
            const kinds = lastDamageTypes();
            const fits = (type, types) => !types || types.includes(type) || (types.includes("physical") && ["bludgeoning", "piercing", "slashing"].includes(type));
            if ((!plan.foe || foe) && (!kinds || kinds.some(({ type }) => fits(type, plan.on)))) {
                const restore = Math.min(amount, kinds ? kinds.filter(({ type }) => fits(type, plan.types)).reduce((sum, { total }) => sum + Math.min(plan.value, total), 0) : plan.value);
                const note = [kinds ? null : `Only against ${plan.on ? `${plan.on.join(" or ")} damage` : "damage"}${plan.attack ? " from an attack" : ""}${plan.foe ? " by an enemy" : ""}: resistance ${plan.value}${plan.types ? ` to ${plan.types.join(", ")}` : ""}, so fewer Hit Points back if part of it was another type.`, kinds && plan.attack ? "Only against an attack's damage." : null, plan.lasts ? "It keeps the resistance until the end of its next turn." : null, plan.acPenalty ? `Its AC is ${plan.acPenalty} lower for a day.` : null].filter(Boolean).join(" ");
                await offer({ kind: "resist", item: resist.item, monster: token, actor, target: foe, trigger: foe ? `damaged it (${amount})` : `It took ${amount} damage`, note: note || null, retribution: { ally: { actorUuid: actor.uuid, name: token.name }, restore } });
            }
        }
        // Furious Flailing, Splinter (batch 61): damage of its types (the GM checks the type), its Strike at a random creature in its
        // reach (the GM's target), or at the attacker beside it; the trolls' flat check against persistent fire, a note.
        const flail = mine?.reactions.find(({ plan }) => plan.builtin === "reaction-strike" && plan.triggers?.includes("damaged-by"));
        if (flail) {
            const near = attacker && attacker.id !== token.id && attacker.parent?.id === scene.id && isFoe(token, attacker) && distanceFeet(box(token, gridOf(scene).size), box(attacker, gridOf(scene).size), gridOf(scene)) <= 5;
            const foe = !flail.plan.random && near ? attacker : null;
            const strikes = (actor.system.actions ?? []).filter((action) => action.type === "strike" && action.label.toLowerCase().includes(flail.plan.strike)).map((action) => ({ slug: action.slug, label: action.label }));
            const note = [`Only if it was ${(flail.plan.damageTypes ?? []).join(" or ")} damage.`, flail.plan.random ? "At a random creature within its reach: target it first." : foe ? null : "At a creature beside it: target it first.", flail.plan.persistentFire ? "If it has persistent fire damage, it also attempts a DC 15 flat check to remove it." : null].filter(Boolean).join(" ");
            if (strikes.length) await offer({ kind: "strike", item: flail.item, monster: token, actor, target: foe, strikes, trigger: foe ? `damaged it (${amount})` : `It took ${amount} damage`, note });
        }
        if (!attacker || attacker.id === token.id || attacker.parent?.id !== scene.id) continue;
        const grid = gridOf(scene);
        // Wing Thrash (batch 54): an adjacent enemy (the one whose turn it is) that damages it, a Strike back (and one at another);
        // Squealed Outrage (batch 57): the Strike back only.
        const thrash = mine?.reactions.find(({ plan }) => plan.builtin === "reaction-strike" && plan.triggers?.includes("damaged-adjacent"));
        if (thrash && isFoe(token, attacker) && distanceFeet(box(token, grid.size), box(attacker, grid.size), grid) <= 5) {
            const strikes = meleeStrikes(actor, `(${thrash.plan.strike} only)`);
            if (strikes.length) await offer({ kind: "strike", item: thrash.item, monster: token, actor, target: attacker, strikes, penalty: thrash.plan.penalty ?? 0, trigger: `damaged it (${amount})`, note: thrash.plan.second ? "It can make a second Strike at another adjacent creature." : null });
        }
        for (const { token: monster, actor: monsterActor, reactions } of reactors(scene, combat)) {
            if (monster.id === token.id || monster.disposition !== token.disposition || !isFoe(monster, attacker)) continue;
            const entry = reactions.find(({ plan }) => plan.builtin === "retributive-strike");
            if (!entry) continue;
            const distance = (other) => distanceFeet(box(monster, grid.size), box(other, grid.size), grid);
            if (distance(token) > 15 || distance(attacker) > 15) continue;
            const strikes = meleeStrikes(monsterActor, entry.item.name).filter((strike) => distance(attacker) <= strike.reach);
            const resistance = entry.plan.resistance ?? 0;
            const restore = Math.min(amount, resistance);
            await offer({
                kind: "retribution", item: entry.item, monster, actor: monsterActor, target: attacker, strikes,
                trigger: `damaged ${token.name} (${amount})`,
                note: `${token.name} resists ${restore} of it (resistance ${resistance}).${strikes.length ? "" : ` ${attacker.name} isn't in reach for a Strike.`}`,
                retribution: { ally: { actorUuid: actor.uuid, name: token.name }, restore }
            });
        }
    }
}

// The whispered offer, unless one for the same monster and creature is still open.
async function offer({ kind, item, monster, actor, target, strikes = [], penalty = 0, trigger, note = null, attack = null, retribution = null, negate = null, survive = null, free = false, skill = null, move = null }) {
    const open = game.messages.contents.slice(-30).some((message) => {
        const state = message.flags?.[MODULE_ID]?.[FLAG];
        return state?.status === "open" && state.monster.tokenUuid === monster.uuid && state.target?.tokenUuid === (target?.uuid ?? undefined) && state.kind === kind;
    });
    if (open) return;
    const state = {
        kind,
        ability: { name: item.name, uuid: item.uuid },
        monster: { tokenUuid: monster.uuid, actorUuid: actor.uuid, name: monster.name },
        target: target ? { tokenUuid: target.uuid, name: target.name } : null,
        trigger,
        strikes: strikes.map(({ slug, label }) => ({ slug, label })),
        penalty,
        note,
        attack,
        retribution,
        ...(negate ? { negate } : {}),
        ...(survive ? { survive } : {}),
        ...(skill ? { skill } : {}),
        ...(move ? { move } : {}),
        ...(free ? { free: true } : {}),
        status: "open",
        result: null
    };
    await ChatMessage.create({ content: offerHTML(state), speaker: ChatMessage.getSpeaker({ actor, token: monster }), whisper: ChatMessage.getWhisperRecipients("GM").map((user) => user.id), flags: { [MODULE_ID]: { [FLAG]: state } } });
}

// --- Using it -------------------------------------------------------------------

function wire(message, html) {
    if (!message?.flags?.[MODULE_ID]?.[FLAG]) return;
    for (const button of html.querySelectorAll("[data-aar-reaction]")) {
        if (button.dataset.aarWired) continue;
        button.dataset.aarWired = "true";
        if (!game.user.isGM) {
            button.remove();
            continue;
        }
        button.addEventListener("click", async () => {
            button.disabled = true;
            try {
                await use(message, button.dataset.aarReaction, button.dataset.slug);
            } catch (error) {
                ui.notifications.error(`${message.flags[MODULE_ID][FLAG].ability.name}: ${error.message}`);
                console.error(`${MODULE_ID} |`, error);
                button.disabled = false;
            }
        });
    }
}

async function use(message, action, slug) {
    const state = foundry.utils.deepClone(message.flags[MODULE_ID][FLAG]);
    if (state.status !== "open") return;
    if (action === "decline") return settle(message, state, "declined", null);
    const monster = await fromUuid(state.monster.tokenUuid);
    const actor = monster?.actor;
    if (!actor) throw new Error(`${state.monster.name} isn't there any more.`);
    if (!state.attack?.free && !state.free && reactionUsed(actor)) return settle(message, state, "declined", `${state.monster.name} has already used its reaction this round.`);
    let result;
    if (state.kind === "strike") {
        result = await rollStrike(state, actor, slug);
    } else if (state.kind === "resist") {
        // Liquefy, Chipping Scales (batch 71): the damage it resisted back as Hit Points; what lasts as PF2e effects; a use spent.
        const hp = actor.system?.attributes?.hp;
        const lines = [];
        if (hp && state.retribution.restore > 0) {
            const value = Math.min(hp.max, hp.value + state.retribution.restore);
            await actor.update({ "system.attributes.hp.value": value });
            lines.push(`${state.monster.name} resists ${state.retribution.restore} damage (back to ${value} HP).`);
        }
        const item = await fromUuid(state.ability.uuid);
        const plan = item ? compile(item) : null;
        const effects = resistEffects(plan, { name: state.ability.name, img: item?.img ?? null });
        if (effects.length) {
            await actor.createEmbeddedDocuments("Item", effects);
            lines.push(effects.map((effect) => effect.name).join(", ") + " on it.");
        }
        const left = Number(item?.system?.frequency?.value);
        if (item && Number.isFinite(left)) await item.update({ "system.frequency.value": Math.max(0, left - 1) });
        result = lines.join(" ") || "Nothing to resist.";
    } else if (state.kind === "retribution") {
        // The resistance after the fact: the damage it would have kept off, back as Hit Points.
        const ally = await fromUuid(state.retribution.ally.actorUuid);
        const hp = ally?.system?.attributes?.hp;
        const lines = [];
        if (hp && state.retribution.restore > 0) {
            const value = Math.min(hp.max, hp.value + state.retribution.restore);
            await ally.update({ "system.attributes.hp.value": value });
            lines.push(`${state.retribution.ally.name} resists ${state.retribution.restore} damage (back to ${value} HP).`);
        }
        if (action === "strike") lines.push(await rollStrike(state, actor, slug));
        result = lines.join(" ") || "Nothing to resist.";
    } else if (state.kind === "move") {
        // (Batch 98: where it goes is the GM's.)
        result = `${state.monster.name} uses ${state.ability.name}: ${state.note ?? "move its token."}`;
    } else if (state.kind === "skill") {
        // (Batch 88: PF2e's maneuver as a card on the creature, its penalty or bonus on the check.)
        const item = await fromUuid(state.ability.uuid);
        const target = state.target ? await fromUuid(state.target.tokenUuid) : null;
        if (!item || !target) throw new Error("The creature or the ability is gone.");
        await postSkillCard({ skill: state.skill.slug, shift: state.skill.shift ?? 0, item, sourceActor: actor, sourceToken: monster, tokens: [target.object ?? target] });
        result = `${state.ability.name}: its ${state.skill.slug.replace(/^\w/, (letter) => letter.toUpperCase())} card is posted.`;
    } else if (state.kind === "card") {
        // Its card: on the attacker, the creatures in its emanation, or the GM's targets.
        const item = await fromUuid(state.ability.uuid);
        const plan = item ? compile(item) : null;
        if (!plan?.resolution) throw new Error("Its results aren't readable any more.");
        const target = state.target ? await fromUuid(state.target.tokenUuid) : null;
        const area = plan.targeting?.area;
        // (Its own Strike's: the creature it hit, or around it: "a 10-foot burst centered on the target".)
        // (Batch 82: a PF2e effect on itself, Curl Up's; on its allies with no area, Brutal Rally's "All allies that can see the gang
        // leader": its allies in the encounter.)
        const applications = plan.resolution.kind === "effect" ? plan.resolution.applications ?? [] : [];
        const ownEffect = applications.length > 0 && applications.every((application) => application.recipients === "self");
        const allyEffect = !area && applications.some((application) => application.recipients === "allies-in-area");
        const running = allyEffect ? runningCombat(monster.parent) : null;
        const taking = running ? inEncounter(running) : new Set();
        const tokens = plan.targeting?.target === "self" || ownEffect ? [monster.object ?? monster]
            : allyEffect ? monster.parent.tokens.filter((token) => taking.has(token.id) && token.id !== monster.id && !token.hidden && token.disposition === monster.disposition && token.actor && !token.actor.isDead).map((token) => token.object ?? token)
            : ["the attacker", "the creature the Strike hits"].includes(plan.targeting?.target) ? (target?.object ? [target.object] : [])
            : area?.around === "target" && target ? [target.object ?? target, ...tokensAround(target, Number(area.value) || 0)].filter((token) => token.id !== monster.id)
            : area?.type === "emanation" ? tokensAround(monster, Number(area.value) || 0) : [];
        if (applications.length) await postEffectCard({ plan, item, sourceActor: actor, sourceToken: monster, tokens: ownEffect ? [] : tokens });
        else await postCard({ plan, item, sourceActor: actor, sourceToken: monster, tokens, cause: state.free ? "free action" : "reaction" });
        result = applications.length ? `${state.ability.name}: its effect card is posted${ownEffect || tokens.length ? "; Apply gives the effect" : "; target the creatures it affects, then Use my targets"}.` : tokens.length ? `${state.ability.name}: its card is posted.` : `${state.ability.name}: its card is posted; target the creatures it affects, then Use my targets.`;
        // (A free action doesn't use the reaction.)
        if (state.free) return settle(message, state, "used", result);
    } else if (state.kind === "reroll") {
        // Cat's Luck (batch 53): the save rerolled through PF2e, the better kept; a use of its frequency spent.
        const save = game.messages.get(state.attack.messageId);
        if (!save) throw new Error("The saving throw is gone.");
        await game.pf2e.Check.rerollFromMessage(save, { keep: state.attack.keep ?? "higher" });
        const item = await fromUuid(state.ability.uuid);
        const left = Number(item?.system?.frequency?.value);
        if (item && Number.isFinite(left)) await item.update({ "system.frequency.value": Math.max(0, left - 1) });
        result = `${state.ability.name}: the save is rerolled, ${state.attack.keep === "new" ? "the new result taken" : "keeping the better"}.`;
        if (state.free) return settle(message, state, "used", result);
    } else if (state.kind === "boost") {
        // Golden Luck, Word of Wisdom (batch 53): one degree better, for the GM to apply; a use of its frequency spent (batch 65).
        const item = await fromUuid(state.ability.uuid);
        const left = Number(item?.system?.frequency?.value);
        if (item && Number.isFinite(left)) await item.update({ "system.frequency.value": Math.max(0, left - 1) });
        result = `${state.ability.name}: ${state.note ?? "one degree better."}`;
        if (state.free) return settle(message, state, "used", result);
    } else if (state.kind === "negate") {
        // Shake It Off (batch 49): the condition it was about to be affected by, removed; a use of its frequency spent.
        await actor.items.get(state.negate.itemId)?.delete();
        const item = await fromUuid(state.ability.uuid);
        const left = Number(item?.system?.frequency?.value);
        if (item && Number.isFinite(left)) await item.update({ "system.frequency.value": Math.max(0, left - 1) });
        result = `${state.ability.name}: ${state.negate.name} is negated.`;
    } else if (state.kind === "ac") {
        // (Batch 81: a higher Escape DC, Tighten Coils: the creature stays held on a failure.)
        result = state.attack.what === "Escape DC"
            ? `${state.ability.name}: the Escape DC ${state.attack.value} higher makes it ${degreeWords(state.attack.after, true)}.${["failure", "criticalFailure"].includes(state.attack.after) ? ` ${state.target?.name ?? "The creature"} stays held.` : ""}`
            : state.attack.what === "to the save"
                // (Batch 87, Occult Ward: the save's result, for the GM to apply.)
                ? `${state.ability.name}: +${state.attack.value} to the save makes it ${degreeWords(state.attack.after, true)}. Apply that result instead.`
                : `${state.ability.name}: +${state.attack.value} AC makes it ${degreeWords(state.attack.after)}. Apply its damage (if any) for that result.`;
    } else if (state.kind === "misfortune") {
        const attack = game.messages.get(state.attack.messageId);
        if (!attack) throw new Error("The attack roll is gone.");
        await game.pf2e.Check.rerollFromMessage(attack, { keep: "lower" });
        result = `${state.ability.name}: the attack is rerolled, keeping the worse.`;
    } else if (state.kind === "flat") {
        if (state.attack.or && action === "keep") {
            // The attacker keeps the critical hit and takes the condition (Unbidden Thoughts, batch 58).
            const attacker = state.target ? await fromUuid(state.target.tokenUuid) : null;
            if (!attacker?.actor) throw new Error(`${state.target?.name ?? "The attacker"} isn't there any more.`);
            await attacker.actor.increaseCondition(state.attack.or.slug, { value: state.attack.or.value });
            result = `The critical hit stands; ${state.target.name} is ${state.attack.or.label}.`;
        } else if (state.attack.dc == null) {
            // No check (Collapse, Twist Fate): a normal hit; Collapse's conditions on the monster.
            if (state.attack.collapse) for (const slug of ["immobilized", "off-guard"]) if (!actor.hasCondition?.(slug)) await actor.increaseCondition(slug);
            result = state.attack.text ?? `The critical hit becomes a normal hit; apply the attack's normal damage.${state.attack.collapse ? ` ${state.monster.name} is Immobilized and Off-Guard until it re-forms (an action).` : ""}`;
        } else {
            // The flat check, rolled for all to see; a success turns the critical hit into a normal hit.
            const roll = await new Roll("1d20").evaluate();
            await roll.toMessage({ flavor: `${state.ability.name}: DC ${state.attack.dc} flat check`, speaker: ChatMessage.getSpeaker({ actor, token: monster }) });
            result = roll.total >= state.attack.dc ? `${roll.total}: ${state.attack.success ?? "success. The critical hit becomes a normal hit; apply the attack's normal damage."}` : `${roll.total}: ${state.attack.failure ?? "failure. The critical hit stands."}`;
        }
        // A free action doesn't use the reaction.
        if (state.attack.free) return settle(message, state, "used", result);
    } else if (state.kind === "ferocity") {
        // (Batch 67: half its Hit Points, a number, or a roll; not wounded when it doesn't say so; a use of its frequency spent.)
        const rule = state.survive ?? { hp: 1, wounded: true };
        const max = Number(actor.system?.attributes?.hp?.max) || 1;
        const hp = rule.hp === "half" ? Math.floor(max / 2) : typeof rule.hp === "string" ? (await new Roll(rule.hp).evaluate()).total : Number(rule.hp) || 1;
        await actor.update({ "system.attributes.hp.value": Math.max(1, Math.min(max, hp)) });
        if (rule.wounded) await actor.increaseCondition("wounded");
        const item = await fromUuid(state.ability.uuid);
        const left = Number(item?.system?.frequency?.value);
        if (item && Number.isFinite(left)) await item.update({ "system.frequency.value": Math.max(0, left - 1) });
        // (PF2e may clear these itself as the Hit Points come back: an effect already gone isn't an error, batch 67.)
        for (const slug of ["unconscious", "dying"]) if (actor.hasCondition?.(slug)) await actor.decreaseCondition(slug, { forceRemove: true }).catch(() => null);
        if (actor.statuses?.has?.("dead")) await Promise.resolve(actor.toggleStatusEffect?.("dead", { active: false })).catch(() => null);
        const combatant = game.combat?.combatants.find((entry) => entry.tokenId === monster.id);
        if (combatant?.defeated) await combatant.update({ defeated: false });
        result = `${state.monster.name} stays at ${actor.system?.attributes?.hp?.value ?? 1} HP${rule.wounded ? `; wounded ${actor.getCondition?.("wounded")?.value ?? 1}` : ""}.`;
        if (state.free) return settle(message, state, "used", result);
    }
    await markUsed(actor, monster);
    return settle(message, state, "used", result);
}

// The monster's Strike at the offer's target (the GM's targets when it has none).
async function rollStrike(state, actor, slug) {
    const strike = actor.system.actions.find((entry) => entry.slug === slug);
    if (!strike) throw new Error(`${state.monster.name} has no such Strike.`);
    const target = state.target ? await fromUuid(state.target.tokenUuid) : null;
    if (target?.object) target.object.setTarget(true, { releaseOthers: true, groupSelection: false });
    else if (!game.user.targets.size) throw new Error("Target a creature first.");
    const modifiers = state.penalty ? [new game.pf2e.Modifier({ slug: "reaction-penalty", label: state.ability.name, modifier: -state.penalty, type: "untyped" })] : [];
    // Shift skips PF2e's roll dialog when the GM shows it by default.
    await strike.variants[0].roll({ event: new PointerEvent("click", { shiftKey: !!game.user.settings?.showCheckDialogs }), modifiers });
    return `${state.monster.name} Strikes with ${strike.label}.`;
}

const settle = (message, state, status, result) => message.update({ content: offerHTML({ ...state, status, result }), [`flags.${MODULE_ID}.${FLAG}`]: { ...state, status, result } });

// "Reaction used" until the start of its next turn.
async function markUsed(actor, token) {
    const combat = game.combat?.started ? game.combat : null;
    const position = combat ? combat.turns.findIndex((entry) => entry.tokenId === token.id) : -1;
    const rounds = combat && position >= 0 ? reactionRounds(position, combat.turn) : 1;
    await actor.createEmbeddedDocuments("Item", [{
        name: "Reaction used",
        type: "effect",
        img: "icons/svg/clockwork.svg",
        flags: { [MODULE_ID]: { reactionUsed: true } },
        system: {
            description: { value: "<p>It has used its reaction; it gets it back at the start of its turn.</p>" },
            duration: { value: rounds, unit: "rounds", expiry: "turn-start", sustained: false },
            start: { value: game.time.worldTime, initiative: position >= 0 ? combat.turns[position].initiative ?? null : null },
            tokenIcon: { show: true },
            rules: []
        }
    }]);
}
