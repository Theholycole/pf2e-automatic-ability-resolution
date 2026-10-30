// Live play: confirmation cards for monster abilities (docs/live-play.md).
//
// - A monster's ability message, or a Strike that hits and lists a rider, gets
//   a resolution card (on the active GM's client).
// - Each target's roll goes through PF2e, tagged with the card; whoever owns the
//   roller rolls (a target's owner its save, the GM the monster's checks), and
//   the active GM's client writes the result onto the card.
// - Apply (the GM) resolves the plan with the core, using the recorded rolls,
//   and applies the changes: damage through PF2e (its resistances and
//   weaknesses), conditions, swallowing, and afflictions handed to Pseudo Afflictions.

import { allRolled, cardCheck, cardHTML, damageExtras, endWords, immunityKey, changeLines, createCard, createCastCard, createEffectCard, createModeCard, itemRecord, modifierTarget, parseIdentifier, recordRoll, rollIdentifier, selectorLabel, standInSource, statisticLabel } from "../src/live/card.js";
import { escapeWords } from "../src/live/escape.js";
import { recurringNote, recurringSpec, recurringWords } from "../src/live/recurring.js";
import { immunityApplies, immunityEffect, isImmune } from "../src/live/auras.js";
import { dropImmuneParts, partImmunities, partImmunityEffect, partImmuneTo, partsEarned, partWords } from "../src/live/part-immunity.js";
import { activityRider, fitsSize, followUpAsHit, followUpFits, strikeMatches, strikesFromOptions } from "../src/live/activity.js";
import { pickWays, strikesFor, withRow } from "../src/live/random.js";
import { exposedAgain, pseudoAfflictionSource } from "../src/live/afflictions.js";
import { startZone } from "./zones.js";
import { startConjure } from "./conjure.js";
import { trapStrikes } from "./reactions.js";
import { strikeBuffEffect } from "../src/live/buff.js";
import { damageNote, golemAnswer, hitSetsOff, ownStrikeSetsOff, traitsFit } from "../src/live/reactions.js";
import { distanceFeet } from "../../pf2e-resolution-core/src/model/grid.js";
import { box, gridOf } from "./auras.js";
import { latestReflectable, reflectedState, remainingRange } from "../src/live/reflect.js";
import { applySwallow } from "./swallow.js";
import { applyFloor, applyWhilePersistent, takesPersistent } from "./floors.js";
import { applyAuraCondition } from "./auras.js";
import { noteToGM, rechargeFormula, rechargeWarning, startRecharge } from "./recharge.js";
import { isDying, recoverFromDying, revivedNote } from "../../pf2e-resolution-core/scripts/dying-recovery.js";

const MODULE_ID = "pf2e-automatic-ability-resolution";
const CORE_ID = "pf2e-resolution-core";
const AFFLICTIONS = "pseudo-afflictions";
const FLAG = "card";

export const isActiveGM = () => game.users.activeGM?.isSelf ?? game.user.isGM;
export const stateOf = (message) => message?.getFlag?.(MODULE_ID, FLAG) ?? null;
const owns = (uuid) => {
    try {
        return !!fromUuidSync(uuid)?.testUserPermission?.(game.user, "OWNER");
    } catch {
        return false;
    }
};

let compile = null;
let ready = Promise.resolve();
let basics = () => ({});

// main.js hands over the compiler (with the basic actions) and a promise for them.
export function setUpLivePlay({ compileItem, basicActions, loaded }) {
    compile = compileItem;
    basics = basicActions;
    ready = loaded;
    injectStyles();
    // (2026-10-29) The physical items PF2e deletes (the last dose of a consumable), for a card posted after: its level for an incapacitation save.
    Hooks.on("deleteItem", (item) => remember(item));
    Hooks.on("createChatMessage", (message) => {
        if (!isActiveGM()) return;
        recordResult(message).catch((error) => console.error(`${MODULE_ID} | recording a roll`, error));
        cardForAbility(message).catch((error) => console.error(`${MODULE_ID} | ability card`, error));
        cardsForRiders(message).catch((error) => console.error(`${MODULE_ID} | rider card`, error));
        cardsForHitBy(message).catch((error) => console.error(`${MODULE_ID} | hit-by card`, error));
        cardsForTargeted(message).catch((error) => console.error(`${MODULE_ID} | targeted card`, error));
        cardsForGolem(message).catch((error) => console.error(`${MODULE_ID} | golem card`, error));
        cardForSkillAction(message).catch((error) => console.error(`${MODULE_ID} | skill action card`, error));
        spendOffGuard(message).catch((error) => console.error(`${MODULE_ID} | spending off-guard`, error));
    });
    // A monster at 0 HP: the abilities that act as it dies (Death Throes, Explosive Death).
    Hooks.on("updateActor", (actor, changed, options) => {
        if (isActiveGM() && changed.system?.attributes?.hp?.value === 0) cardsForDeath(actor).catch((error) => console.error(`${MODULE_ID} | death card`, error));
        // PF2e's damage on it (not its undo): a passive that answers it (Spewing Bile, Diseased Pustules; batch 19).
        if (isActiveGM() && options?.damageTaken > 0 && !options.damageUndo) cardsForDamaged(actor, options.damageTaken).catch((error) => console.error(`${MODULE_ID} | damaged card`, error));
    });
    // A creature's turn starting or ending while a monster holds it (Mind-Numbing Grasp, Wine-Soaked; batch 20).
    Hooks.on("pf2e.startTurn", (combatant) => {
        if (isActiveGM()) cardsForGrabTurn(combatant, "start").catch((error) => console.error(`${MODULE_ID} | grab-turn card`, error));
        // (A monster's permanent condition, back if PF2e lowered it: batch 21.)
        if (isActiveGM() && combatant?.actor) keepPermanent(combatant.actor, false).catch((error) => console.error(`${MODULE_ID} | permanent condition`, error));
    });
    // A condition the monster always has (the zombie's Slow: "permanently Slowed 1 and can't use reactions"), as the encounter starts.
    Hooks.on("combatStart", (combat) => {
        if (!isActiveGM()) return;
        for (const combatant of combat.combatants) if (combatant.actor) keepPermanent(combatant.actor, true).catch((error) => console.error(`${MODULE_ID} | permanent condition`, error));
    });
    Hooks.on("pf2e.endTurn", (combatant) => {
        if (isActiveGM()) cardsForGrabTurn(combatant, "end").catch((error) => console.error(`${MODULE_ID} | grab-turn card`, error));
    });
    Hooks.on("renderChatMessageHTML", (message, html) => wireCard(message, html));
    // The chat log draws the messages already there before "ready": wire those too.
    for (const element of document.querySelectorAll("[data-message-id]")) {
        if (element.querySelector(".pf2e-aar-card")) wireCard(game.messages.get(element.dataset.messageId), element);
    }
}

// --- Cards ------------------------------------------------------------------

// A target: its actor and token, and for a check, its DC against the statistic.
function targetEntry(token, check) {
    const actor = token.actor;
    const entry = { actorUuid: actor.uuid, tokenUuid: token.document?.uuid ?? token.uuid ?? null, name: token.name ?? actor.name };
    // (Batch 290, Feather Strike: an attack at its own bonus against AC — the armor class itself.)
    // (2026-10-27, Mindsponge: a fixed DC, the same for every target.)
    if (check?.kind === "check") entry.dc = !check.against && Number.isFinite(check.dc) ? check.dc : actor.getStatistic?.(check.against)?.dc?.value ?? (check.against === "ac" ? actor.armorClass?.value ?? null : null);
    return entry;
}

// A target of an effect card: on the user's side or not (its token's disposition).
function effectTarget(token, sourceToken) {
    const disposition = (token.document ?? token).disposition;
    return { actorUuid: token.actor.uuid, tokenUuid: token.document?.uuid ?? token.uuid ?? null, name: token.name ?? token.actor.name, allied: !!sourceToken && disposition === (sourceToken.document ?? sourceToken).disposition };
}

// The immunity flags of a creature's Effects that haven't run out (PF2e may leave an expired one if it doesn't remove them itself).
export const immunityFlags = (actor) => (actor?.itemTypes?.effect ?? []).filter((effect) => !(effect.isExpired ?? effect.system?.expired)).map((effect) => effect.flags?.[MODULE_ID]);

// (2026-10-25, for the item module: moveFrom — a token uuid its pushes and pulls are measured from instead of the source's: Dispersing
// Bullet's from the creature its Strike hit.)
export async function postCard({ plan, item, sourceActor, sourceToken, tokens, rider = null, cause = null, aura = null, warning = null, moveFrom = null, zone = null }) {
    const check = cardCheck(plan);
    if (!check) return null;
    // (2026-10-20: a temporary immunity — trigger.immunity —: the creatures already immune left out, and the card says so; none left, a
    // note for the GM. Zones, auras and other modules' cards alike.)
    const immunity = plan?.trigger?.immunity;
    const key = immunity ? immunityKey(plan, item?.name) : null;
    const immune = key ? tokens.filter((token) => token?.actor && isImmune(immunityFlags(token.actor), { slug: key, source: immunity.against === "all" ? null : sourceActor.uuid })) : [];
    if (immune.length) {
        tokens = tokens.filter((token) => !immune.includes(token));
        const said = `${immune.map((token) => token.name).join(", ")} ${immune.length === 1 ? "is" : "are"} immune: ${item.name}.`;
        if (!tokens.length) {
            await noteToGM(sourceActor, sourceToken, [`<strong>${item.name}</strong>: ${said}`]);
            return null;
        }
        warning = [warning, said].filter(Boolean).join(" ");
    }
    // (2026-10-27: an immunity to one part of it — trigger.partImmunity, src/live/part-immunity.js —: said on the card; Apply leaves that part out.)
    const parts = partImmunities(plan, item?.name);
    const partly = parts.flatMap((part) => tokens.filter((token) => token?.actor && partImmuneTo(immunityFlags(token.actor), part, sourceActor.uuid)).map((token) => `${token.name} ${partWords(part, item.name)}`));
    if (partly.length) warning = [warning, `${partly.join("; ")}.`].filter(Boolean).join(" ");
    const record = Number.isFinite(Number(item?.level)) ? itemRecord({ type: "consumable", ...item, level: Number(item.level) }) : await itemRecordOf(item?.uuid);
    const state = createCard({
        plan,
        ability: { name: item.name, uuid: item.uuid, ...(record ? { item: record } : {}) },
        source: { actorUuid: sourceActor.uuid, tokenUuid: sourceToken?.uuid ?? null, name: sourceToken?.name ?? sourceActor.name },
        targets: tokens.map((token) => targetEntry(token, check)),
        rider,
        cause,
        aura,
        warning,
        moveFrom,
        zone
    });
    return ChatMessage.create({
        content: cardHTML(state),
        speaker: ChatMessage.getSpeaker({ actor: sourceActor, token: sourceToken ?? undefined }),
        flags: { [MODULE_ID]: { [FLAG]: state } }
    });
}

// (2026-10-29) The item a card is for, as a record (src/live/card.js itemRecord): the live one, else one PF2e deleted this session. postCard's
// item may give its own level (and type, traits) instead.
const GONE = new Map();
function remember(item) {
    const record = itemRecord(item);
    if (!record || !item.uuid) return;
    GONE.set(item.uuid, record);
    if (GONE.size > 200) GONE.delete(GONE.keys().next().value);
}
async function itemRecordOf(uuid) {
    if (!uuid) return null;
    const live = await fromUuid(uuid).catch(() => null);
    return itemRecord(live) ?? GONE.get(uuid) ?? null;
}

// A card turned back (2026-10-27, the item module's Cayden's Tankard and Scale of Igroon; src/live/reflect.js): plan.reflect { trait?, kinds?,
// of: "targeting-user", to: "creator" | "chosen" } — the latest open save or attack card at the user taken; the same check (its DC, rows,
// damage, traits) posted at its source alone ("creator", the card counteracted for all its targets) or at the creatures the presser targets
// within what's left of its range ("chosen", the user out of the card). On the active GM's client: api.live.reflect({ plan, item,
// userToken, targets }). → { from, card, at: [names], beyond: [names] } or null when no card was found.
export async function reflectCard({ plan, item, userToken, targets = [] }) {
    const reflect = plan?.reflect;
    const user = userToken?.document ?? userToken;
    if (!reflect || !user?.actor) return null;
    const who = { actorUuid: user.actor.uuid, tokenUuid: user.uuid, name: user.name };
    const cards = (game.messages?.contents ?? []).map((message) => ({ id: message.id, state: message.getFlag?.(MODULE_ID, FLAG) })).filter((entry) => entry.state);
    const found = latestReflectable(cards, reflect, who);
    if (!found) {
        await noteToGM(item.actor, user, [`<strong>${item.name}</strong>: no open card${reflect.trait ? ` of a ${[reflect.trait].flat().join(" or ")} effect` : ""} targets ${user.name}; resolve it by hand.`]);
        return null;
    }
    const message = game.messages.get(found.id);
    const state = found.state;
    const sourceActor = await fromUuid(state.source.actorUuid).catch(() => null);
    const sourceToken = state.source.tokenUuid ? await fromUuid(state.source.tokenUuid).catch(() => null) : null;
    const scene = user.parent;
    const grid = scene ? gridOf(scene) : null;
    const apart = (a, b) => (grid && a && b && a.parent === b.parent ? distanceFeet(box(a, grid.size), box(b, grid.size), grid) : 0);
    let at = [];
    let beyond = [];
    let remaining = null;
    if (reflect.to === "creator") {
        if (sourceToken) at = [sourceToken];
    } else {
        const chosen = [...targets].map((token) => token?.document ?? token).filter((token) => token?.actor && token.uuid !== user.uuid);
        if (!chosen.length) throw new Error(`${item.name}: target the creatures to turn it back at.`);
        remaining = remainingRange(state.plan, apart(sourceToken, user));
        at = chosen.filter((token) => apart(user, token) <= remaining);
        beyond = chosen.filter((token) => !at.includes(token));
    }
    const names = at.map((token) => token.name);
    const reach = Number.isFinite(remaining) ? ` within its remaining ${remaining} feet` : "";
    const line = reflect.to === "creator"
        ? `Counteracted for all its targets: ${user.name}'s ${item.name} turned it back on ${state.source.name}${at.length ? "" : " (not on the scene: roll its save by hand)"}.`
        : `${user.name}'s ${item.name} reflected it${names.length ? ` at ${names.join(", ")}` : ""}${reach}${beyond.length ? `; out of reach: ${beyond.map((token) => token.name).join(", ")}` : ""}.`;
    let created = null;
    if (at.length) {
        const made = createCard({ plan: state.plan, ability: { name: `${state.ability.name} (reflected)`, uuid: state.ability.uuid, ...(state.ability.item ? { item: state.ability.item } : {}) }, source: state.source, targets: at.map((token) => targetEntry(token.object ?? token, state.check)), warning: `Reflected by ${user.name}'s ${item.name}: the same DC and results.` });
        const next = { ...made, check: state.check, ...(state.actions !== undefined ? { actions: state.actions } : {}), ...(state.damageType ? { damageType: state.damageType } : {}) };
        created = await ChatMessage.create({ content: cardHTML(next), speaker: ChatMessage.getSpeaker({ actor: sourceActor ?? undefined, token: sourceToken ?? undefined }), flags: { [MODULE_ID]: { [FLAG]: next } } });
    }
    const left = reflectedState(state, { user: who, to: reflect.to, line });
    await message.update({ content: cardHTML(left), [`flags.${MODULE_ID}.${FLAG}`]: left });
    return { from: message.id, card: created?.id ?? null, at: names, beyond: beyond.map((token) => token.name) };
}

// A basic maneuver a reaction answers with (batch 88: Ripping Disarm's Disarm, Absorb Weapon's): PF2e's action as a card on that creature,
// its penalty or bonus on the check.
export async function postSkillCard({ skill, shift = 0, item, sourceActor, sourceToken, tokens }) {
    const basic = basics()?.[skill];
    if (!basic?.resolution?.check) return null;
    const plan = shift ? { ...basic, resolution: { ...basic.resolution, check: { ...basic.resolution.check, bonus: { value: (Number(basic.resolution.check.bonus?.value) || 0) + shift, type: "circumstance" } } } } : basic;
    return postCard({ plan, item, sourceActor, sourceToken, tokens, cause: "reaction" });
}

// A PF2e effect a reaction gives (batch 82: Brutal Rally to its allies, Curl Up to itself): its effect card on those creatures, with
// the GM's Apply.
export async function postEffectCard({ plan, item, sourceActor, sourceToken, tokens }) {
    const state = createEffectCard({
        plan,
        ability: { name: item.name, uuid: item.uuid },
        source: { actorUuid: sourceActor.uuid, tokenUuid: sourceToken?.uuid ?? null, name: sourceToken?.name ?? sourceActor.name },
        targets: tokens.map((token) => effectTarget(token, sourceToken))
    });
    if (!state) return null;
    return ChatMessage.create({ content: cardHTML(state), speaker: ChatMessage.getSpeaker({ actor: sourceActor, token: sourceToken ?? undefined }), flags: { [MODULE_ID]: { [FLAG]: state } } });
}

// A monster's or a hazard's ability, used from its sheet (PF2e's own message for the action).
async function cardForAbility(message) {
    if (message.flags?.pf2e?.context?.type || stateOf(message)) return;
    const origin = message.flags?.pf2e?.origin;
    if (origin?.type !== "action" || !origin.uuid) return;
    const item = await fromUuid(origin.uuid);
    if (!item?.actor || !["npc", "hazard"].includes(item.actor.type)) return;
    await ready;
    const plan = compile(item);
    const sourceToken = message.token ?? item.actor.getActiveTokens(true, true)[0] ?? null;
    // A random effect table (batch 255): its die rolled in chat, the way it picks played as the ability; a bomb's table, its row
    // the Strike's results on a hit; random Strikes, the ones the dice give, for the GM to roll from the sheet.
    if (plan?.builtin === "modes" && plan.random) {
        const rolls = [];
        const picks = await pickWays(plan, async (formula) => {
            const roll = await new Roll(formula).evaluate();
            rolls.push(roll);
            return roll.total;
        });
        await rollsToChat(item, sourceToken, rolls, [...picks.map(({ face, way }) => `${face}: ${way?.name?.replace(/^[\d–-]+:\s*/, "") ?? "nothing happens"}`), ...(plan.notes ?? [])]);
        for (const { way } of picks) {
            if (way?.plan) await playAbility(item, way.plan, sourceToken);
            else if (way?.notes?.length && !way.again) await noteToGM(item.actor, sourceToken, [`<strong>${item.name}</strong>: ${way.notes.join(" ")}`]);
        }
        return;
    }
    if (plan?.builtin === "strike-activity" && plan.randomOnHit) {
        const roll = await new Roll(plan.randomOnHit.formula).evaluate();
        const rowed = withRow(plan, roll.total);
        await rollsToChat(item, sourceToken, [roll], [`${roll.total}: ${rowed.rowName ?? "nothing"}`]);
        return playAbility(item, rowed, sourceToken);
    }
    if (plan?.builtin === "random-strikes") {
        const rolls = await Promise.all(Array.from({ length: plan.times ?? 1 }, () => new Roll(plan.formula).evaluate()));
        const strikes = strikesFor(plan, rolls.map((roll) => roll.total));
        await rollsToChat(item, sourceToken, rolls, strikes.map((strike, index) => `${rolls[index].total}: ${strike ? `a ${strike} Strike` : "nothing"}`));
        const made = strikes.filter(Boolean);
        const words = made.length === 2 && made[0] === made[1] ? `two ${made[0]} Strikes` : made.map((strike) => `a ${strike} Strike`).join(" and ");
        await noteToGM(item.actor, sourceToken, [`<strong>${item.name}</strong>: ${made.length ? `${words}${made.length > 1 && made[0] !== made[1] ? ", in either order" : ""} — roll ${made.length > 1 ? "them" : "it"} from the sheet.` : "no Strike this time."}`]);
        return;
    }
    return playAbility(item, plan, sourceToken);
}

// The dice a random table rolled, in chat: each roll and what it picked.
async function rollsToChat(item, sourceToken, rolls, lines) {
    const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
    if (!rolls.length) return;
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: item.actor, token: sourceToken ?? undefined }), flavor: `<strong>${escape(item.name)}</strong>: ${lines.map(escape).join("; ")}`, rolls });
}

// A monster's or a hazard's ability as compiled (or the way a random table picked): its card, its effect, its note.
// targets: the tokens it's aimed at, the user's own when not given (2026-10-30: the feat module's character feats, at the targets their
// player had, which it records on the message).
export async function playAbility(item, plan, sourceToken, targets = null) {
    const chosenTargets = targets ?? game.user.targets;
    // (2026-10-27: a card turned back, plan.reflect — reflectCard, at the user's own targets.)
    if (plan?.reflect) {
        await reflectCard({ plan, item, userToken: sourceToken, targets: [...(chosenTargets ?? [])] });
        return;
    }
    // An area that lasts (batch 256): its Region and card (scripts/zones.js).
    if (plan?.builtin === "zone") {
        await startZone({ item, plan, sourceToken });
        const recharge = rechargeFormula(item, plan);
        if (recharge) await noteToGM(item.actor, sourceToken, [rechargeWarning(item.actor, item.name), await startRecharge({ actor: item.actor, item, formula: recharge, tokenUuid: sourceToken?.uuid ?? null })].filter(Boolean));
        return;
    }
    // (Batch 295: creatures it makes or becomes — Eye Probe's probes, the Gestalt: their tokens and card, scripts/conjure.js.)
    if (plan?.builtin === "conjure") {
        await startConjure({ item, plan, sourceToken });
        return;
    }
    // (Batch 299: a trap's own Strike, offered at the creatures it hits; scripts/reactions.js.)
    if (plan?.builtin === "trap-strike") {
        await trapStrikes({ item, plan, sourceToken });
        return;
    }
    // (Batch 274: a choice PF2e holds as the ability's own toggle — Ablative Adaptation's material: the toggle set to it.)
    if (plan?.builtin === "roll-option") {
        // (Batch 276: a plain toggle switched on or off — Extend Strands. Its domain, the rule's own: "skill-check" there.)
        // (Batch 292, Sphere Shift: the toggle on another of its items, by name — its Elemental Attunement's.)
        const holder = plan.itemName ? item.actor?.items?.find?.((entry) => entry.name === plan.itemName) ?? item : item;
        const rule = (holder.system?.rules ?? []).find((entry) => entry?.key === "RollOption" && entry.option === plan.option);
        await item.actor?.toggleRollOption?.(plan.domain ?? rule?.domain ?? "all", plan.option, holder.id, plan.value ?? true, plan.suboption ?? null);
        await noteToGM(item.actor, sourceToken, [`<strong>${item.name}</strong>: ${plan.label ?? plan.suboption}.`, ...(plan.notes ?? [])]);
        return;
    }
    // (Batch 274: a table rolled — Unstable Feedback's Wellspring Surge for the caster: PF2e's table drawn to chat, for the GM to apply.)
    if (plan?.builtin === "roll-table") {
        const table = plan.table?.uuid ? await fromUuid(plan.table.uuid).catch(() => null) : null;
        if (table?.draw) await table.draw();
        await noteToGM(item.actor, sourceToken, [`<strong>${item.name}</strong>: ${table ? `${plan.table.name} rolled` : `roll ${plan.table?.name ?? "its table"} by hand`}, on ${plan.target ?? "its target"}.`, ...(plan.notes ?? [])]);
        return;
    }
    const formula = rechargeFormula(item, plan);
    // Used again while it recharges: the card says so (the GM decides).
    const warning = formula ? rechargeWarning(item.actor, item.name) : null;
    // A follow-up to a Strike (batch 36, "last action was a successful jaws Strike"): on the creature that Strike hit.
    if (plan?.resolution && plan.trigger?.followUp && (plan.trigger.event ?? "use") === "use") {
        await followUpCard(item, plan, sourceToken, warning);
        return;
    }
    if (plan?.resolution && (plan.trigger?.event ?? "use") === "use" && cardCheck(plan)) {
        // On itself (Go Dark, batch 26): its own token; on its allies around it: those in its emanation; otherwise the GM's targets.
        const area = plan.targeting?.allies && plan.targeting.area?.type === "emanation" ? Number(plan.targeting.area.value) || 0 : 0;
        // (Stoke the Flames, batch 52: its foes within its distance taking persistent damage of that type.)
        const taking = plan.targeting?.taking && sourceToken ? Number(plan.targeting.area?.value) || 0 : 0;
        const tokens = plan.targeting?.target === "self" ? (sourceToken ? [sourceToken.object ?? sourceToken] : [])
            : area && sourceToken ? tokensAround(sourceToken, area).filter((token) => (token.document ?? token).disposition === sourceToken.disposition)
            : taking ? tokensAround(sourceToken, taking).filter((token) => (token.document ?? token).disposition !== sourceToken.disposition && (token.actor?.itemTypes?.condition ?? []).some((condition) => condition.slug === "persistent-damage" && condition.system?.persistent?.damageType === plan.targeting.taking))
            : [...chosenTargets];
        // (Batch 119: its notes for the GM on the card — Double Breath's second area, a lingering gas.)
        await postCard({ plan, item, sourceActor: item.actor, sourceToken, tokens, warning: [warning, ...(plan.notes ?? [])].filter(Boolean).join(" ") || null });
        return;
    }
    // A PF2e effect on itself, its allies or a target (Battle Cry, Fiery Rhetoric): the card applies it. Not its own
    // self effect, which PF2e's card already applies.
    if (plan?.resolution?.kind === "effect" && (plan.trigger?.event ?? "use") === "use" && !plan.resolution.applications.every((application) => application.selfEffect)) {
        const state = createEffectCard({
            plan,
            ability: { name: item.name, uuid: item.uuid },
            source: { actorUuid: item.actor.uuid, tokenUuid: sourceToken?.uuid ?? null, name: sourceToken?.name ?? item.actor.name },
            targets: [...chosenTargets].map((token) => effectTarget(token, sourceToken)),
            // (Its notes on the card too: a feat's "Stride once first"; 2026-10-30, the feat module's Foundry test.)
            warning: [warning, ...(plan.notes ?? [])].filter(Boolean).join(" ") || null
        });
        if (state) await ChatMessage.create({ content: cardHTML(state), speaker: ChatMessage.getSpeaker({ actor: item.actor, token: sourceToken ?? undefined }), flags: { [MODULE_ID]: { [FLAG]: state } } });
        return;
    }
    // Used in one of several ways (two breath weapons): the GM picks the way on the card.
    // (Batch 179: or one that casts a spell, Hilarious Exhalation's Laughing Gas.)
    // (Batch 273: or ways that are builtins — a stance or a self-effect of its choice, a maneuver against everyone around it.)
    if (plan?.builtin === "modes" && plan.modes.some((mode) => mode.plan && (mode.plan.builtin === "cast-spell" || (mode.plan.builtin && !["no-effect", "modes"].includes(mode.plan.builtin)) || ((mode.plan.trigger?.event ?? "use") === "use" && cardCheck(mode.plan))))) {
        const state = createModeCard({
            // (Batch 287, Domain Wall: a way that casts a spell linked with no label — named by PF2e's compendium index.)
            modes: plan.modes.map((mode) => (mode.plan?.builtin === "cast-spell" && mode.plan.spell?.uuid && !mode.plan.spell.name ? { ...mode, name: fromUuidSync(mode.plan.spell.uuid)?.name ?? mode.name } : mode)),
            ability: { name: item.name, uuid: item.uuid },
            source: { actorUuid: item.actor.uuid, tokenUuid: sourceToken?.uuid ?? null, name: sourceToken?.name ?? item.actor.name },
            targets: [...chosenTargets].map((token) => targetEntry(token, null)),
            // (Batch 274: every way in turn, Dragonspeech's three Words; its notes on the card.)
            warning: [warning, ...(plan.all ? plan.notes ?? [] : [])].filter(Boolean).join(" ") || null,
            all: Boolean(plan.all)
        });
        await ChatMessage.create({ content: cardHTML(state), speaker: ChatMessage.getSpeaker({ actor: item.actor, token: sourceToken ?? undefined }), flags: { [MODULE_ID]: { [FLAG]: state } } });
        return;
    }
    // It heals itself (Abyssal Healing, Vine Splint; batch 24): PF2e's own healing roll, with its buttons to apply it; its
    // requirements and its other words in the roll's heading, for the GM.
    if (plan?.resolution?.kind === "healing" && plan.targeting?.target === "self") {
        const formula = plan.resolution.native?.healing?.components?.[0]?.formula;
        if (formula) {
            const DamageRoll = damageRollClass();
            const roll = await new DamageRoll(`(${formula})[healing]`).evaluate();
            const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
            const lines = [plan.requires ? `Only if: ${plan.requires}.` : null, ...(plan.notes ?? [])].filter(Boolean).map(escape);
            await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: item.actor, token: sourceToken ?? undefined }), flavor: `<strong>${escape(item.name)}</strong>: ${escape(sourceToken?.name ?? item.actor.name)} heals itself${lines.length ? `<br>${lines.join(" ")}` : ""}` });
        }
        const recharge = rechargeFormula(item, plan);
        if (recharge) await noteToGM(item.actor, sourceToken, [warning, await startRecharge({ actor: item.actor, item, formula: recharge, tokenUuid: sourceToken?.uuid ?? null })].filter(Boolean));
        return;
    }
    // More damage on its own Strikes for a while (batch 37, Vocal Warm-Up): an effect on the monster with that damage, for its time;
    // not when the ability links PF2e's own effect (its card offers that).
    // (Batch 39: a bonus to its AC for a while, Dueling Parry; a plan with its own time only, not a rage's, whose PF2e effect is linked.)
    // (Batch 235: with no time of its own, its model's rounds — Raise Shields, Blood Fury, a rage with no PF2e effect; its healing too.)
    if (plan?.builtin === "self-effect" && (plan.duration || plan.model) && (plan.damage?.length || plan.model?.modifiers?.length || plan.model?.resistances?.length || plan.model?.tempHp || plan.model?.regeneration || plan.model?.materials?.length || plan.model?.toggle || plan.model?.hitBack || plan.model?.fastHealing) && !/@UUID\[Compendium\.[\w-]+\.[\w-]*effects?\.Item\./i.test(item.system?.description?.value ?? "")) {
        await strikeBuff(item, plan, sourceToken);
        if (Number(plan.heal) > 0) {
            const actor = sourceToken?.actor ?? item.actor;
            const hp = actor.system?.attributes?.hp;
            if (hp) await actor.update({ "system.attributes.hp.value": Math.min(Number(hp.max) || Infinity, Number(hp.value) + Number(plan.heal)) });
            await noteToGM(item.actor, sourceToken, [`<strong>${item.name}</strong>: it regains ${Number(plan.heal)} Hit Points.`]);
        }
        if (formula) await noteToGM(item.actor, sourceToken, [warning, await startRecharge({ actor: item.actor, item, formula, tokenUuid: sourceToken?.uuid ?? null })].filter(Boolean));
        return;
    }
    // Batch 41 (the user's choices, 2026-10-11): Mythic abilities and Quickened Casting as notes for the GM; Poison Weapon's poison
    // with its next weapon Strike that hits.
    if (plan?.builtin === "mythic" && plan.kind !== "undying") {
        await noteToGM(item.actor, sourceToken, [`<strong>${item.name}</strong>: it spends 1 Mythic Point and ${plan.kind === "remove-condition" ? "ends one condition affecting it (remove it from its sheet)" : "regains an expended spell, or another use of what it names"}.`]);
        return;
    }
    if (plan?.builtin === "quickened-casting") {
        await noteToGM(item.actor, sourceToken, [`<strong>${item.name}</strong>: its next spell${plan.maxRank ? ` (rank ${plan.maxRank} or lower)` : ""} takes one action fewer (minimum 1).`]);
        return;
    }
    if (plan?.builtin === "poison-weapon") {
        pendingPoisons.set(item.actor.uuid, { name: plan.poison.name, plan: plan.poison.plan, item, at: Date.now() });
        await noteToGM(item.actor, sourceToken, [`<strong>${item.name}</strong>: ${plan.poison.name} on its weapon. Its card comes with the next weapon Strike that hits (apply it if the Strike deals damage; a critical miss wastes it).${plan.own ? "" : " Take a dose from its inventory."}`]);
        return;
    }
    // (Batch 183, Word of Advice: its effect on the ally the GM targets — PF2e's extra damage on that ally's Strike — and a note that the ally can Stride
    // once and Strike once.)
    if (plan?.builtin === "ally-advance") {
        const scene = sourceToken?.parent ?? canvas.scene;
        const grid = gridOf(scene);
        const allies = sourceToken ? [...chosenTargets].map((token) => token.document ?? token).filter((token) => token.id !== sourceToken.id && token.actor && token.disposition === sourceToken.disposition && distanceFeet(box(sourceToken, grid.size), box(token, grid.size), grid) <= plan.within) : [];
        const effect = plan.uuid ? await fromUuid(plan.uuid).catch(() => null) : null;
        if (effect) for (const token of allies) await token.actor.createEmbeddedDocuments("Item", [{ ...effect.toObject(), flags: { ...(effect.toObject().flags ?? {}), [MODULE_ID]: { allyAdvance: { sourceActorUuid: item.actor.uuid } } } }]);
        const extra = (plan.extraDamage ?? []).map((formula) => formula.replace(/\[(\w+)\]/, " $1")).join(" + ");
        // (Batch 202, Kingpin's Command: with the ally's reaction, each ally once; no extra damage.)
        // (Batch 215: a Strike only, as its reaction; only an ally of a trait, of a lower level; its notes.)
        const how = plan.reaction ? (plan.noStride ? "can Strike as its reaction" : "can Stride and Strike as its reaction") : "can Stride once and Strike once, in any order";
        const once = `${plan.oncePerAlly ? " Each ally only once a day." : ""}${plan.trait ? ` Only ${/^[aeiou]/i.test(plan.trait) ? "an" : "a"} ${plan.trait} ally${plan.lowerLevel ? " of a lower level, beside the target" : ""}.` : ""}${plan.notes?.length ? ` ${plan.notes.join(" ")}` : ""}`;
        await noteToGM(item.actor, sourceToken, [`<strong>${item.name}</strong>: ${allies.length ? `${allies.map((token) => token.name).join(", ")} ${how}${extra ? `; ${effect ? "its effect adds" : "add"} ${extra} damage on a hit` : ""}.${once}` : `target an ally within ${plan.within} feet first: it ${how}${extra ? `, adding ${extra} damage on a hit` : ""}.${once}`}`]);
        return;
    }
    // (Batch 167, Tactical Direction: PF2e's own Attack of Opportunity granted to its allies of that trait in the emanation, until the end of their
    // next turn — an effect on each, its GrantItem the glossary's ability; PF2e times it a round from this turn, so the GM ends it early by hand.)
    if (plan?.builtin === "grant-aoo") {
        const scene = sourceToken?.parent ?? canvas.scene;
        const grid = gridOf(scene);
        const reactive = (actor) => actor.itemTypes.action.some((entry) => /^(?:attack of opportunity|reactive strike)$/i.test(entry.name) || ["attack-of-opportunity", "reactive-strike"].includes(entry.system?.slug));
        // (Batch 263, Set Defense: itself, until it moves or attacks.)
        const allies = plan.self && sourceToken ? [sourceToken.document ?? sourceToken] : sourceToken ? scene.tokens.filter((token) => token.id !== sourceToken.id && token.actor && token.disposition === sourceToken.disposition && (!plan.trait || (token.actor.system?.traits?.value ?? []).includes(plan.trait)) && distanceFeet(box(sourceToken, grid.size), box(token, grid.size), grid) <= plan.within) : [];
        const granted = [];
        for (const token of allies) {
            if (reactive(token.actor)) continue;
            await token.actor.createEmbeddedDocuments("Item", [{
                name: `${item.name}: ${plan.reaction ?? "Attack of Opportunity"}`,
                type: "effect",
                img: item.img ?? "icons/svg/sword.svg",
                flags: { [MODULE_ID]: { grantedAoo: { sourceActorUuid: item.actor.uuid } } },
                system: { description: { value: `<p>${plan.reaction ?? "Attack of Opportunity"} from <strong>${item.name}</strong> (${sourceToken.name}), ${plan.untilText ? plan.untilText : plan.until === "move-or-attack" ? "until it takes a move or attack action" : `until the end of ${plan.until === "source" ? `${sourceToken.name}'s` : "its"} next turn`}.</p>` }, duration: plan.until === "move-or-attack" || plan.untilText ? { value: -1, unit: "unlimited", expiry: null, sustained: false } : { value: 1, unit: "rounds", expiry: "turn-end", sustained: false }, tokenIcon: { show: true }, rules: [{ key: "GrantItem", uuid: plan.uuid ?? "Compendium.pf2e.bestiary-ability-glossary-srd.Item.hFtNbo1LKYCoDy2O", onDeleteActions: { granter: "cascade", grantee: "cascade" } }] }
            }]);
            granted.push(token.name);
        }
        // (Batch 176, Call to Arms: Reactive Strike until the end of its own next turn — the effect's own round; an ally that uses it immune after.)
        const reaction = plan.reaction ?? "Attack of Opportunity";
        // (Batch 265, Coil: until it Strikes with its fangs — its own words; its sheet's own Reactive Strike already there (Coiled Strike), said so.)
        const until = plan.untilText ? `${plan.untilText} (remove the effect then).` : plan.until === "move-or-attack" ? "until it takes a move or attack action (remove the effect then)." : plan.until === "source" ? `until the end of ${sourceToken.name}'s next turn.` : `until the end of ${granted.length === 1 ? "its" : "their"} next turn (the effect lasts a round: remove it sooner if that turn ends first).`;
        await noteToGM(item.actor, sourceToken, [`<strong>${item.name}</strong>: ${granted.length ? `${granted.join(", ")} gain${granted.length === 1 ? "s" : ""} ${reaction} ${until}` : plan.self ? `it already has ${reaction} on its sheet: it can use it ${plan.untilText ?? "while this lasts"}.` : `no ${plan.trait ?? ""} ally within ${plan.within} feet lacks ${reaction}.`.replace(/ {2,}/g, " ")}`, ...(plan.usedOnce ? [`One that uses this ${reaction} is immune to ${item.name} from ${sourceToken.name} for 10 minutes.`] : [])]);
        return;
    }
    // Hunt Prey (batch 39): its prey (the GM's target) and its edge, for the GM; PF2e can't count "the first hit each round".
    if (plan?.builtin === "hunt-prey") {
        const prey = [...chosenTargets][0];
        // (Batch 153, Lawbringer: every Strike against the creature it marks; batch 164, Mark for Death: deadly on its Strikes against it.)
        // (Batch 275, Punish the Naughty: a mark with no extra damage, its benefits its notes.)
        const marked = plan.every || plan.mark || plan.edge === "deadly";
        // (Batch 277, Krampus: PF2e's own toggle for the mark, its Perception and Survival bonuses behind it — switched on.)
        if (plan.toggle) await item.actor?.toggleRollOption?.((item.system?.rules ?? []).find((entry) => entry?.key === "RollOption" && entry.option === plan.toggle)?.domain ?? "all", plan.toggle, item.id, true);
        // (Batch 281, Challenge Foe: PF2e's rules wait on its mark — an Effect on itself with that slug, marking the creature.)
        if (plan.markSlug && prey) await item.actor.createEmbeddedDocuments("Item", [{ name: item.name, type: "effect", img: item.img, system: { slug: plan.markSlug, duration: { value: -1, unit: "unlimited", expiry: null, sustained: false }, rules: [{ key: "TokenMark", slug: plan.markSlug, uuid: prey.document?.uuid ?? prey.uuid }], description: { value: `<p>${prey.name}: its ${item.name}.</p>` } } }]);
        const edgeText = !plan.edge ? "" : plan.edge === "deadly" ? `Its ${plan.strike ?? ""} Strikes against that creature gain deadly d${plan.die}.`.replace(/ {2,}/g, " ") : plan.every ? `Each of its Strikes against that creature deals ${plan.dice}d${plan.die} more precision damage (add it to each hit).` : `The first time it hits its prey each round, it deals ${plan.dice}d${plan.die} more precision damage (add it to that hit).`;
        await noteToGM(item.actor, sourceToken, [`<strong>${item.name}</strong>: ${prey ? `${prey.name} is its ${marked ? "mark" : "prey"}` : `its ${marked ? "mark" : "prey"} is the creature it named`}. ${edgeText}`, ...(plan.notes ?? [])]);
        return;
    }
    // Knocking Sweep (batch 45): the basic action's card at each creature the GM targets (separate checks, each at the multiple attack
    // penalty it started with); a note when none is targeted.
    if (plan?.builtin === "skill-sweep") {
        const basic = basics()?.[plan.action];
        const tokens = [...chosenTargets];
        const penalty = plan.sameMap ? ", each at the multiple attack penalty it started with" : "";
        if (basic?.resolution && tokens.length) await postCard({ plan: basic, item, sourceActor: item.actor, sourceToken, tokens, warning: `Separate checks${penalty}.` });
        else await noteToGM(item.actor, sourceToken, [`<strong>${item.name}</strong>: it attempts to ${plan.action.replace(/^\w/, (letter) => letter.toUpperCase())} each creature within its reach (separate checks${penalty}). Target them before using it for their card.`]);
        return;
    }
    // Twin Feint (batch 43): its Strikes from the sheet; the second against an off-guard target, for the GM to give.
    // (Batch 80: what both hits bring — "If they both hit, the target becomes Slowed 1 for 1 round" — for the GM to apply.)
    // (Batch 213, Frightening Flurry: the value as many as the Strikes that hit.)
    if (plan?.builtin === "multi-strike" && plan.bothHit?.perHit) await noteToGM(item.actor, sourceToken, [`<strong>${item.name}</strong>: the target becomes ${plan.bothHit.conditions.map((entry) => entry.slug.replace(/^\w/, (letter) => letter.toUpperCase())).join(" and ")} with a value equal to the number of its Strikes that hit it.`]);
    else if (plan?.builtin === "multi-strike" && plan.bothHit) await noteToGM(item.actor, sourceToken, [`<strong>${item.name}</strong>: if ${plan.bothHit.atLeast ? `${plan.bothHit.atLeast} or more of its Strikes` : "both Strikes"} hit the same creature, ${bothHitText(plan.bothHit)}.`]);
    // (Batch 213, Hundred-Handed Whirlwind: damage even on a failed attack.)
    if (plan?.builtin === "multi-strike" && plan.missDamage?.length) await noteToGM(item.actor, sourceToken, [`<strong>${item.name}</strong>: a creature it fails to hit (not a critical failure) still takes ${plan.missDamage.map((formula) => formula.replace(/\[(\w+)\]/, " $1")).join(" + ")} damage.`]);
    // (Batch 89, Claw Rake: both Strikes at its highest attack bonus.)
    if (plan?.builtin === "multi-strike" && plan.noMap) await noteToGM(item.actor, sourceToken, [`<strong>${item.name}</strong>: each Strike at its highest attack bonus (no multiple attack penalty).`]);
    // (Batch 83, Eviscerate: each Strike's own penalty.)
    if (plan?.builtin === "multi-strike" && plan.penalties?.some(Boolean)) await noteToGM(item.actor, sourceToken, [`<strong>${item.name}</strong>: ${plan.penalties.map((value, index) => `Strike ${index + 1} ${value ? `at −${value}` : "at its full bonus"}`).join(", ")}${plan.requires === "first-attack" ? "; only before any other attack this turn" : ""}.`]);
    // (Batch 82, Pike and Strike: the second Strike only after a hit, at the same penalty; or instead the move, the GM's choice.)
    if (plan?.builtin === "multi-strike" && plan.ifFirstHits) await noteToGM(item.actor, sourceToken, [`<strong>${item.name}</strong>: only if the ${plan.strikes?.[0] ?? "first"} Strike hits, the ${plan.strikes?.[1] ?? "second"} Strike at the same multiple attack penalty${plan.instead ? `, or instead ${plan.instead}` : ""}.`]);
    // (Batch 102, Flurry of Pods: not at the creatures it holds.)
    if (plan?.builtin === "multi-strike" && plan.notGrabbed) await noteToGM(item.actor, sourceToken, [`<strong>${item.name}</strong>: a Strike at each creature in its reach except those it already has Grabbed, at the same multiple attack penalty.`]);
    // (Batch 242, Titanic Charge: a charge's other words for the GM.)
    if (plan?.builtin === "charge" && plan.notes?.length) await noteToGM(item.actor, sourceToken, [`<strong>${item.name}</strong>: ${plan.notes.join(" ")}`]);
    // (Batch 124: its other words for the GM, Twisting Reach's cover ignored.)
    if (plan?.builtin === "multi-strike" && plan.notes?.length) await noteToGM(item.actor, sourceToken, [`<strong>${item.name}</strong>: ${plan.notes.join(" ")}`]);
    // (Batch 152: Hellfire Flurry's extra damage on its Strikes until the end of its turn — its own switch when PF2e gives it one; Fan of
    // Daggers' critical hits, a card on each crit among its next Strikes; Haunting Assault's Demoralize after its Strikes, on the GM's target.)
    if (plan?.builtin === "multi-strike" && plan.extraDamage?.length) await strikeBuff(item, { builtin: "self-effect", actions: plan.actions, model: { name: item.name, rounds: 0, modifiers: [], tempHp: 0 }, damage: plan.extraDamage, strike: null, melee: false, duration: { value: 0, unit: "rounds", expiry: "turn-end" } }, sourceToken);
    if (plan?.builtin === "multi-strike" && plan.critical) {
        const critical = (plan.critical.conditions ?? []).map((entry) => ({ slug: entry.slug, value: entry.value ?? null, duration: entry.rounds ? { mode: "fixed", value: entry.rounds, unit: "rounds", expiry: "turn-start", anchor: "source-turn" } : null }));
        const strike = plan.strikes?.every((name) => name && name === plan.strikes[0]) ? plan.strikes[0] : null;
        pendingActivities.set(item.actor.uuid, { item, plan: { builtin: "strike-activity", strike, onHit: { conditions: [], critical, push: null, damage: [], criticalDamage: [...(plan.critical.damage ?? [])], save: null, size: null } }, token: sourceToken, at: Date.now(), left: plan.strikes?.length ?? 1, critOnly: true });
    }
    if (plan?.builtin === "multi-strike" && plan.then) {
        const basic = basics()?.[plan.then];
        const tokens = [...chosenTargets].slice(0, 1);
        if (basic?.resolution && tokens.length) await postCard({ plan: basic, item, sourceActor: item.actor, sourceToken, tokens, warning: "After its Strikes." });
        else await noteToGM(item.actor, sourceToken, [`<strong>${item.name}</strong>: after its Strikes, it attempts to ${plan.then.replace(/^\w/, (letter) => letter.toUpperCase())} that creature. Target it before using it for its card.`]);
    }
    // (Batch 156, Battering Blow: PF2e's Shove at the GM's target after the Strike, hit or miss.)
    if (plan?.builtin === "strike-activity" && plan.afterStrike) {
        const basic = basics()?.[plan.afterStrike];
        const tokens = [...chosenTargets].slice(0, 1);
        if (basic?.resolution && tokens.length) await postCard({ plan: basic, item, sourceActor: item.actor, sourceToken, tokens, warning: "After its Strike, hit or miss." });
    }
    if (plan?.builtin === "multi-strike" && plan.secondOffGuard) await noteToGM(item.actor, sourceToken, [`<strong>${item.name}</strong>: ${plan.secondOffGuard === "hit" ? "if the first Strike hits, " : ""}the target is off-guard against the second Strike (−2 AC for that roll).`]);
    // (Batch 108: what its Strike gains for the roll — deadly or fatal, counting as more attacks — a note for the GM.)
    // (Batch 109: only at an animal or humanoid, Flay's.)
    // (Batch 112: what its text leaves the GM — the armor it damages, the cover it ignores.)
    if (plan?.builtin === "strike-activity" && (plan.deadly || plan.fatal || plan.countsAs > 1 || plan.targetTraits?.length || plan.attackBonus || plan.notes?.length)) await noteToGM(item.actor, sourceToken, [`<strong>${item.name}</strong>: ${[plan.targetTraits?.length ? `only at ${plan.targetTraits.map((trait) => (/^[aeiou]/.test(trait) ? `an ${trait}` : `a ${trait}`)).join(" or ")}` : null, plan.attackBonus ? `its Strike at ${plan.attackBonus > 0 ? "+" : "−"}${Math.abs(plan.attackBonus)} to the attack roll` : null, plan.deadly ? `its Strike gains deadly d${plan.deadly}` : null, plan.fatal ? `its Strike gains fatal d${plan.fatal}` : null, plan.countsAs > 1 ? `it counts as ${plan.countsAs} attacks for the multiple attack penalty` : null].filter(Boolean).join("; ") || "its Strike as usual"}.`, ...(plan.notes ?? [])]);
    // A Strike activity with more on a hit (Intimidating Strike): its results wait for the creature's Strike.
    if (plan?.builtin === "strike-activity" && activityRider(plan, { targetProne: true, targetTraits: (plan.onHit?.vsTraits ?? []).flatMap((entry) => entry.traits) })) pendingActivities.set(item.actor.uuid, { item, plan, token: sourceToken, at: Date.now() });
    // It casts a spell or has its effects (Dominate, Turn to Mist): a card to cast it through PF2e, at the ability's rank and DC.
    if (plan?.builtin === "cast-spell") {
        const spell = plan.spell?.uuid ? await fromUuid(plan.spell.uuid).catch(() => null) : null;
        const state = createCastCard({
            plan,
            ability: { name: item.name, uuid: item.uuid },
            source: { actorUuid: item.actor.uuid, tokenUuid: sourceToken?.uuid ?? null, name: sourceToken?.name ?? item.actor.name },
            spell: spell ? { uuid: plan.spell.uuid, name: spell.name } : null,
            rank: plan.rank ?? (spell ? defaultRank(spell, item.actor) : null),
            dc: plan.dc ?? spellDC(item.actor),
            warning
        });
        await ChatMessage.create({ content: cardHTML(state), speaker: ChatMessage.getSpeaker({ actor: item.actor, token: sourceToken ?? undefined }), flags: { [MODULE_ID]: { [FLAG]: state } } });
        return;
    }
    // No card to apply: its recharge starts as it's used.
    if (formula) await noteToGM(item.actor, sourceToken, [warning, await startRecharge({ actor: item.actor, item, formula, tokenUuid: sourceToken?.uuid ?? null })].filter(Boolean));
}

// The effect of a self-buff on its Strikes (batch 37), on the monster the GM used it from; a GM note when it can't be made.
async function strikeBuff(item, plan, sourceToken) {
    const actor = sourceToken?.actor ?? item.actor;
    const strikes = actor.itemTypes.melee.map((melee) => ({ name: melee.name, slug: melee.slug ?? null, isRanged: !!melee.isRanged }));
    // (Its own switch, when PF2e gives it one: turned on for its time.)
    const toggles = (item.system?.rules ?? []).filter((rule) => rule?.key === "RollOption" && rule.toggleable && rule.option).map((rule) => ({ domain: rule.domain ?? "all", option: rule.option }));
    const data = strikeBuffEffect(plan, { name: item.name, img: item.img, strikes, uuid: item.uuid, toggles });
    if (!data) return noteToGM(item.actor, sourceToken, [`${item.name}: add its extra damage to ${plan.strike ? `the ${plan.strike} Strikes` : "the Strikes"} by hand.`]);
    const combat = game.combat;
    data.system.start = { value: game.time.worldTime, initiative: combat?.started ? combat.combatant?.initiative ?? null : null };
    // (Earlier copies of it end.)
    const old = actor.itemTypes.effect.filter((effect) => effect.flags?.[MODULE_ID]?.strikeBuff && effect.slug === data.system.slug).map((effect) => effect.id);
    if (old.length) await actor.deleteEmbeddedDocuments("Item", old);
    await actor.createEmbeddedDocuments("Item", [data]);
}

// A spell an ability casts, with no rank given: half the creature's level rounded up (as its focus spells and cantrips), not
// below the spell's own rank.
function defaultRank(spell, actor) {
    const half = Math.min(10, Math.max(1, Math.ceil(Number(actor.level ?? 1) / 2)));
    return spell.isCantrip ? half : Math.max(Number(spell.system?.level?.value ?? 1), half);
}

// The creature's spell DC: its best spellcasting entry's, or null.
function spellDC(actor) {
    const dcs = [...(actor.spellcasting ?? [])].filter((entry) => entry.isOfType?.("spellcastingEntry")).map((entry) => Number(entry.statistic?.dc?.value)).filter(Number.isFinite);
    return dcs.length ? Math.max(...dcs) : null;
}

// Cast: through PF2e, at the card's rank, which posts the spell's card (the spell module resolves it as it does any cast);
// nothing is spent. The creature's own copy of the spell when it has one at that DC (a vampire's innate Dominate), or else
// the spell from an innate spellcasting entry of the ability's own (made on the first use, its DC and attack kept up to date).
async function castFromCard(message, state, data) {
    if (state?.kind !== "cast" || state.status !== "open") return null;
    const actor = await fromUuid(state.source.actorUuid);
    if (!actor) throw new Error("The creature isn't there any more.");
    // (Batch 275, Endless Spellscales: a spell the GM names on the card — found by name in PF2e's spells, within the ability's rank and rarity.)
    if (state.pick && !state.spell?.uuid) {
        const named = String(data.spell ?? "").trim().toLowerCase();
        if (!named) throw new Error("Name the spell first.");
        // (Batch 276, Emotional Frenzy: one of its own spells — the creature must have it.)
        if (state.pick.own) {
            // (A name without its sheet suffix too: "fear" for "Fear (At Will)".)
            const mine = actor.itemTypes.spell.find((spell) => spell.name.toLowerCase() === named) ?? actor.itemTypes.spell.find((spell) => spell.name.toLowerCase().replace(/\s*\([^)]*\)\s*$/, "") === named);
            if (!mine) throw new Error(`${actor.name} has no spell called "${data.spell}".`);
            // (Batch 286, Two Step Waltz: one of its cantrips.)
            if (state.pick.cantrip && !(mine.isCantrip ?? (mine.system?.traits?.value ?? []).includes("cantrip"))) throw new Error(`${mine.name} isn't a cantrip.`);
            state = { ...state, spell: { uuid: mine.sourceId ?? mine._stats?.compendiumSource ?? mine.uuid, name: mine.name }, dc: mine.spellcasting?.statistic?.dc?.value ?? state.dc };
        } else {
            const pack = game.packs.get("pf2e.spells-srd");
            const index = pack ? await pack.getIndex({ fields: ["system.level.value", "system.traits.rarity"] }) : null;
            const found = index ? [...index].find((entry) => entry.name.toLowerCase() === named) : null;
            if (!found) throw new Error(`No spell called "${data.spell}" in PF2e's spells.`);
            if (state.pick.maxRank && Number(found.system?.level?.value) > state.pick.maxRank) throw new Error(`${found.name} is above rank ${state.pick.maxRank}.`);
            if (state.pick.rarity === "common" && (found.system?.traits?.rarity ?? "common") !== "common") throw new Error(`${found.name} isn't a common spell.`);
            state = { ...state, spell: { uuid: found.uuid ?? `Compendium.pf2e.spells-srd.Item.${found._id}`, name: found.name } };
        }
    }

    const source = (await fromUuid(state.spell.uuid).catch(() => null))?.toObject();
    if (!source) throw new Error(`${state.spell.name} isn't in PF2e's compendium.`);
    const cantrip = (source.system?.traits?.value ?? []).includes("cantrip");
    const rank = Math.min(10, Math.max(Number(source.system?.level?.value ?? 1), Number(data.rank) || state.rank || 1));
    const dc = Number(data.dc) || state.dc || 10;
    const attack = state.attack ?? dc - 10;
    // A hazard (PF2e gives hazards no spells): the spell module's plan for the spell, from the core's registry, as a save card
    // at the ability's DC for the creatures targeted now.
    if (actor.type === "hazard") return hazardCast(message, state, { rank, dc });
    const own = actor.itemTypes.spell.find((spell) => (spell.sourceId ?? spell._stats?.compendiumSource) === state.spell.uuid && !spell.flags?.[MODULE_ID]?.abilityCast
        && spell.spellcasting?.isOfType?.("spellcastingEntry") && Number(spell.spellcasting.statistic?.dc?.value) === dc && (state.attack == null || Number(spell.spellcasting.statistic?.check?.mod) === attack));
    if (own) await own.spellcasting.cast(own, { rank, consume: false });
    else {
        const key = state.ability.uuid ?? `${actor.uuid}:${state.ability.name}`;
        let entry = actor.itemTypes.spellcastingEntry.find((candidate) => candidate.flags?.[MODULE_ID]?.abilityCast === key);
        if (!entry) {
            // (Its tradition: the text's, the creature's own innate magic's, or the spell's first.)
            const tradition = state.tradition ?? actor.itemTypes.spellcastingEntry.find((candidate) => !candidate.flags?.[MODULE_ID]?.abilityCast)?.system?.tradition?.value ?? source.system?.traits?.traditions?.[0] ?? "arcane";
            [entry] = await actor.createEmbeddedDocuments("Item", [{ name: `${state.ability.name} (ability)`, type: "spellcastingEntry", flags: { [MODULE_ID]: { abilityCast: key } },
                system: { tradition: { value: tradition }, prepared: { value: "innate" }, spelldc: { dc, value: attack } } }]);
        } else if (Number(entry.system.spelldc?.dc) !== dc || Number(entry.system.spelldc?.value) !== attack) {
            await entry.update({ "system.spelldc.dc": dc, "system.spelldc.value": attack });
        }
        entry = actor.items.get(entry.id);
        let spell = actor.itemTypes.spell.find((candidate) => candidate.system?.location?.value === entry.id && candidate.flags?.[MODULE_ID]?.abilityCast === state.spell.uuid);
        if (!spell) {
            delete source._id;
            source.system.location = { value: entry.id, ...(cantrip ? {} : { heightenedLevel: rank }) };
            foundry.utils.setProperty(source, `flags.${MODULE_ID}.abilityCast`, state.spell.uuid);
            [spell] = await actor.createEmbeddedDocuments("Item", [source]);
        } else if (!cantrip && Number(spell.system.location?.heightenedLevel) !== rank) {
            await spell.update({ "system.location.heightenedLevel": rank });
        }
        await entry.cast(actor.items.get(spell.id), { rank, consume: false });
    }
    const lines = [`Cast ${state.spell.name} at rank ${rank} (DC ${dc}${state.attack != null ? `, +${attack}` : ""}).`];
    const item = state.ability.uuid ? await fromUuid(state.ability.uuid).catch(() => null) : null;
    const formula = item ? rechargeFormula(item) : null;
    if (item && formula) lines.push(await startRecharge({ actor: item.actor, item, formula, tokenUuid: state.source.tokenUuid }));
    const next = { ...state, rank, dc, status: "cast", results: lines };
    return message.update({ content: cardHTML(next), [`flags.${MODULE_ID}.${FLAG}`]: next });
}

async function hazardCast(message, state, { rank, dc }) {
    const core = game.modules.get(CORE_ID)?.api;
    const spell = await fromUuid(state.spell.uuid).catch(() => null);
    const prepared = core && spell ? await core.registry.preparePlan(spell).catch(() => null) : null;
    const plan = prepared?.plan ? foundry.utils.deepClone(prepared.plan) : null;
    const check = plan?.resolution?.check;
    if (!plan || check?.roll !== "save") throw new Error(`a hazard can't cast ${state.spell.name} through PF2e, and it has no save to roll here: resolve it by hand.`);
    check.against = { dc: "fixed", value: dc };
    const tokens = [...game.user.targets];
    if (!tokens.length) throw new Error("Target the creatures first.");
    const next = createCard({ plan, ability: { name: `${state.ability.name} (${state.spell.name})`, uuid: state.ability.uuid }, source: state.source, targets: tokens.map((token) => targetEntry(token, cardCheck(plan))), warning: state.warning });
    next.castRank = rank;
    return message.update({ content: cardHTML(next), [`flags.${MODULE_ID}.${FLAG}`]: next });
}

// A Strike activity used (Intimidating Strike): its results wait for the creature's next Strike, by actor (the active GM's
// client; a use more than 10 minutes old is dropped).
const pendingActivities = new Map();
const ACTIVITY_WAIT = 10 * 60 * 1000;
// A poisoned weapon's poison (batch 41), until its next weapon Strike that hits.
const pendingPoisons = new Map();
// Each monster's last Strike, hit or miss (batch 36): the creature a follow-up acts on, and the Strike's degree.
const lastStrikes = new Map();

// A follow-up's card: on the creature the monster's last Strike hit when that Strike allows it (its results by that Strike's
// degree when they differ); otherwise on the GM's targets, a hit's results, with a line to check the requirement.
async function followUpCard(item, plan, sourceToken, warning) {
    const last = lastStrikes.get(item.actor.uuid);
    const fresh = last && Date.now() - last.at <= ACTIVITY_WAIT && last.target?.actor ? last : null;
    const fits = fresh && followUpFits(plan.trigger.followUp, { outcome: fresh.context.outcome, strikeName: fresh.strike.name, ranged: !!fresh.strike.isRanged, attackEffects: fresh.strike.system?.attackEffects?.value ?? [] });
    const token = sourceToken ?? fresh?.sourceToken ?? null;
    if (fits && plan.resolution.check?.statistic === "strike") return degreeCard(fresh.message, item, plan, { ...fresh, sourceToken: token, cost: "action" });
    if (fits) return postCard({ plan, item, sourceActor: item.actor, sourceToken: token, tokens: [fresh.target], rider: { strikeName: fresh.strike.name, cost: "action" }, warning });
    const need = plan.trigger.followUp;
    const strike = `${need.on?.length === 1 && need.on[0] === "criticalSuccess" ? "critical hit" : "hit"}${need.strike ? ` with its ${need.strike}` : ""}`;
    const unchecked = `No ${strike} just before was found: check ${item.name}'s requirement.`;
    return postCard({ plan: followUpAsHit(plan), item, sourceActor: item.actor, sourceToken: token, tokens: [...game.user.targets], warning: [warning, unchecked].filter(Boolean).join(" ") });
}

// A monster's or a hazard's Strike that hits and lists riders (Grab, Knockdown, Push, a venom): a card for each. The Strike of
// a Strike activity used just before: a card with the activity's results on a hit.
async function cardsForRiders(message) {
    const context = message.flags?.pf2e?.context;
    if (context?.type !== "attack-roll") return;
    const strike = message.flags?.pf2e?.origin?.uuid ? await fromUuid(message.flags.pf2e.origin.uuid) : null;
    const actor = strike?.actor;
    // (2026-10-30: a character's Strike after one of its Strike feats, which the feat module plays as Strike activities; nothing else of the
    // monsters' below.)
    const character = actor?.type === "character";
    if (!actor || (!character && !["npc", "hazard"].includes(actor.type))) return;
    const hit = ["success", "criticalSuccess"].includes(context.outcome);
    const targetToken = context.target?.token ? await fromUuid(context.target.token) : null;
    const target = targetToken?.object ?? targetToken;
    if (target?.actor) lastStrikes.set(actor.uuid, { message, actor, strike, target, targetToken, context, sourceToken: message.token ?? null, at: Date.now() });
    // (A poisoned weapon, batch 41: a weapon Strike, not an unarmed attack; it hits, or a critical miss wastes the poison.)
    const poisoned = pendingPoisons.get(actor.uuid);
    if (poisoned && Date.now() - poisoned.at <= ACTIVITY_WAIT && !(strike.system?.traits?.value ?? []).includes("unarmed")) {
        if (hit && target?.actor) {
            pendingPoisons.delete(actor.uuid);
            await postCard({ plan: poisoned.plan, item: { name: poisoned.name, uuid: poisoned.item.uuid }, sourceActor: actor, sourceToken: message.token ?? null, tokens: [target], rider: { strikeName: strike.name, cost: "free" }, warning: "Only if the Strike dealt damage." });
        } else if (context.outcome === "criticalFailure") pendingPoisons.delete(actor.uuid);
    }
    // (The activity's Strike, hit or miss, uses it up.)
    const pending = pendingActivities.get(actor.uuid);
    if (pending && Date.now() - pending.at > ACTIVITY_WAIT) pendingActivities.delete(actor.uuid);
    else if (pending) {
        // (A Strike a stance grants: its message's origin is the stance's Effect, so the Strike by its roll options, named on the card.)
        const granted = !["weapon", "melee"].includes(strike?.type) ? strikesFromOptions(context.options ?? []).find((each) => strikeMatches(pending.plan, each)) : null;
        const used = granted ? { name: granted.name.replace(/\b\w/g, (letter) => letter.toUpperCase()), system: strike?.system ?? {}, actor } : strike;
        if (granted || strikeMatches(pending.plan, strike)) {
            // (Batch 152, Fan of Daggers: each of its Strikes, a card on a critical hit only.)
            if (pending.left > 1) pending.left--;
            else pendingActivities.delete(actor.uuid);
            if (hit && target?.actor && !(pending.critOnly && context.outcome !== "criticalSuccess")) await activityCard(message, pending, { actor, strike: used, target, targetToken, context });
            // (Focused Assault, batch 43: a failure, not a critical one, still deals the Strike's damage.)
            else if (context.outcome === "failure" && pending.plan.failureDamage && target?.actor) await noteToGM(actor, message.token ?? null, [`<strong>${pending.item.name}</strong>: a failure still deals one ${used.name} Strike's damage to ${target.name}. Roll the Strike's damage from its attack card (not the extra dice).`]);
        }
    }
    if (character) return;
    // Its passives its own Strike sets off ("When the gunmarshal makes a critical hit with a firearm, …"; batch 19): on the
    // creature it hit.
    if (hit && target?.actor) {
        await ready;
        for (const item of actor.itemTypes.action) {
            const plan = compile(item);
            if (plan?.trigger?.reaction || !ownStrikeSetsOff(plan?.trigger, { outcome: context.outcome, strikeName: strike.name, options: context.options ?? [], conditions: [...(target.actor.conditions ?? [])].map((condition) => condition.slug) }) || !plan.resolution || !cardCheck(plan)) continue;
            await postCard({ plan, item, sourceActor: actor, sourceToken: message.token ?? null, tokens: [target], rider: { strikeName: strike.name, cost: "free" } });
        }
    }
    const effects = strike?.system?.attackEffects?.value ?? [];
    if (!hit || !target?.actor) return;
    await ready;
    const strikeName = String(strike?.name ?? "").toLowerCase();
    for (const item of actor.itemTypes.action) {
        const plan = compile(item);
        const trigger = plan?.trigger;
        // Listed by the Strike, or naming it ("hit by the wraith's spectral hand Strike"; batch 28).
        if (trigger?.event !== "strike" || !(effects.includes(trigger.attackEffect) || effects.includes(plan.source?.slug) || (trigger.strikes ?? []).includes(strikeName))) continue;
        // (A critical hit's only, "A creature critically hit by …": not on a plain hit; batch 28.)
        if (!(trigger.on ?? ["success", "criticalSuccess"]).includes(context.outcome)) continue;
        // (Batch 137, Punish Flight: a reaction's Strike that "doesn't have Improved Grab".)
        if ((context.options ?? []).includes("pf2e-automatic-ability-resolution:no-grab") && ["grab", "improved-grab"].includes(trigger.attackEffect ?? plan.source?.slug)) continue;
        // (Its results by the Strike's degree, "Enfeebled 1 (or Enfeebled 2 on a critical hit)"; batch 34.)
        if (plan.resolution?.check?.statistic === "strike") {
            await degreeCard(message, item, plan, { actor, strike, target, targetToken, context, sourceToken: message.token ?? null, cost: trigger.cost ?? "free" });
            continue;
        }
        await postCard({ plan, item, sourceActor: actor, sourceToken: message.token ?? null, tokens: [target], rider: { strikeName: strike.name, cost: trigger.cost ?? "free" } });
    }
}

// A melee Strike that hits a monster or a hazard whose passive answers it ("A creature that hits the pukwudgie with an unarmed
// Strike … takes 3d8 piercing damage"): a card for the attacker (2026-10-10). One for unarmed Strikes only: not for a weapon.
// (Batch 19: also any attack when it says so, "If the arboreal snag takes damage from a piercing attack"; a critical hit only;
// the damage types as a note; its area around the monster, "creatures within 10 feet of the snag".)
async function cardsForHitBy(message) {
    const context = message.flags?.pf2e?.context;
    if (context?.type !== "attack-roll" || !["success", "criticalSuccess"].includes(context.outcome)) return;
    const options = context.options ?? [];
    const domains = context.domains ?? [];
    const ranged = options.includes("item:ranged") || domains.some((domain) => /^ranged-/.test(domain)) || !(options.includes("item:melee") || domains.some((domain) => /^melee-/.test(domain)));
    const unarmed = options.includes("item:category:unarmed") || options.includes("item:trait:unarmed");
    const targetToken = context.target?.token ? await fromUuid(context.target.token) : null;
    const defender = targetToken?.actor;
    const attacker = message.token?.object ?? message.token ?? null;
    if (!defender || !["npc", "hazard"].includes(defender.type) || !attacker?.actor) return;
    await ready;
    for (const item of defender.itemTypes.action) {
        const plan = compile(item);
        const trigger = plan?.trigger;
        // (A reaction is offered to the GM instead: scripts/reactions.js.)
        if (trigger?.reaction || !hitSetsOff(trigger, { outcome: context.outcome, ranged, unarmed }) || !plan.resolution || !cardCheck(plan)) continue;
        const tokens = plan.targeting?.target === "the attacker" ? [attacker] : plan.targeting?.area?.type === "emanation" ? tokensAround(targetToken, Number(plan.targeting.area.value) || 0, { foes: !!plan.targeting.area.foes }) : [];
        await postCard({ plan, item, sourceActor: defender, sourceToken: targetToken, tokens, cause: `hit by ${attacker.name ?? attacker.actor.name}`, warning: damageNote(trigger) });
    }
}

// Damage on a monster whose passive answers it ("When the penanggalan takes slashing damage, their wound spews bile on adjacent
// creatures"; batch 19): its card on the creatures around it, or on the creature whose turn it is (taken as the attacker); the
// damage types as a note for the GM (PF2e doesn't say which it was).
async function cardsForDamaged(actor, amount) {
    if (!["npc", "hazard"].includes(actor?.type)) return;
    await ready;
    const passives = actor.itemTypes.action.map((item) => ({ item, plan: compile(item) })).filter(({ plan }) => plan?.trigger?.event === "damaged" && !plan.trigger.reaction && plan.resolution && cardCheck(plan));
    if (!passives.length) return;
    const token = actor.getActiveTokens(false, true)[0] ?? null;
    const attacker = game.combat?.combatant?.token ?? null;
    for (const { item, plan } of passives) {
        const tokens = plan.targeting?.target === "the attacker" ? (attacker && attacker.id !== token?.id ? [attacker.object ?? attacker] : []) : plan.targeting?.area?.type === "emanation" ? tokensAround(token, Number(plan.targeting.area.value) || 0, { foes: !!plan.targeting.area.foes }) : [];
        await postCard({ plan, item, sourceActor: actor, sourceToken: token, tokens, cause: `took ${amount} damage`, warning: damageNote(plan.trigger) });
    }
}

// A creature aiming an effect at a monster or a hazard (2026-10-10, batch 17): its skill check or attack roll at it (Demoralize),
// or the monster's save against a targeted spell or effect (not an area's). { defender, attacker } (token documents), the
// effect's traits and whether it's a spell; null for any other message.
export async function targetedEvent(message) {
    const context = message.flags?.pf2e?.context;
    if (!context?.type || message.flags?.[MODULE_ID]) return null;
    const options = context.options ?? [];
    const traits = [...new Set([...(context.traits ?? []).map((trait) => trait?.name ?? trait), ...options.filter((option) => option.startsWith("item:trait:")).map((option) => option.slice(11))])];
    const spell = options.includes("item:type:spell");
    if (["skill-check", "attack-roll", "spell-attack-roll"].includes(context.type)) {
        const defender = context.target?.token ? await fromUuid(context.target.token) : null;
        return defender && message.token ? { defender, attacker: message.token, traits, spell, kind: context.type } : null;
    }
    if (context.type === "saving-throw" && !options.some((option) => /^item:area\b|^area-effect$/.test(option))) {
        const attacker = context.origin?.token ? await fromUuid(context.origin.token) : null;
        return attacker && message.token && attacker.id !== message.token.id ? { defender: message.token, attacker, traits, spell, kind: context.type } : null;
    }
    return null;
}

// Does the event set off this trigger ("targets the hound with a mental effect", "… or spell")?
// (Batch 263: trigger.any — anything aimed at it, Slack of Opportunity's hostile action.)
// (Batch 300: trigger.attack — an attack roll only, Shielding Stone's.)
export const targetedSetsOff = (trigger, event) => trigger?.event === "targeted-by" && (!trigger.attack || ["attack-roll", "spell-attack-roll"].includes(event.kind)) && (trigger.any || (trigger.traits ?? []).some((trait) => event.traits.includes(trait)) || (trigger.spells && event.spell));

// A monster's passive that answers it (Otherworldly Mind): its card on the creature that aimed the effect.
async function cardsForTargeted(message) {
    const event = await targetedEvent(message);
    const defender = event?.defender?.actor;
    if (!defender || !["npc", "hazard"].includes(defender.type) || !event.attacker.actor || event.attacker.disposition === event.defender.disposition) return;
    await ready;
    for (const item of defender.itemTypes.action) {
        const plan = compile(item);
        if (plan?.trigger?.reaction || !targetedSetsOff(plan?.trigger, event) || !plan.resolution || !cardCheck(plan)) continue;
        await postCard({ plan, item, sourceActor: defender, sourceToken: event.defender, tokens: [event.attacker.object ?? event.attacker], cause: `targeted by ${event.attacker.name}` });
    }
}

// Golem Antimagic (batch 28): a spell's attack roll against a golem, or the golem's save against a spell (an area's too): harmed
// (PF2e's untyped damage roll instead of the spell's usual effect), healed (the GM's note; an area's healing roll), slowed (a
// card applying Slowed 1 for 2d6 rounds, or that round for an area), or immune (the GM's note), as its list says.
async function cardsForGolem(message) {
    const context = message.flags?.pf2e?.context;
    if (!context?.type || message.flags?.[MODULE_ID]) return;
    const options = context.options ?? [];
    const defender = ["attack-roll", "spell-attack-roll"].includes(context.type) ? (context.target?.token ? await fromUuid(context.target.token) : null) : context.type === "saving-throw" ? message.token : null;
    const actor = defender?.actor;
    if (actor?.type !== "npc") return;
    const spell = message.item?.type === "spell" ? message.item : message.flags?.pf2e?.origin?.uuid ? await fromUuid(message.flags.pf2e.origin.uuid).catch(() => null) : null;
    if (spell?.type !== "spell" && !options.includes("item:type:spell")) return;
    await ready;
    const item = actor.itemTypes.action.find((entry) => compile(entry)?.builtin === "golem-antimagic");
    if (!item || spell?.actor?.uuid === actor.uuid) return;
    const plan = compile(item);
    const kinds = [
        ...(context.traits ?? []).map((trait) => trait?.name ?? trait),
        ...options.filter((option) => /^(?:origin:)?item:trait:/.test(option)).map((option) => option.replace(/^(?:origin:)?item:trait:/, "")),
        ...(spell?.system?.traits?.value ?? []),
        ...Object.values(spell?.system?.damage ?? {}).map((entry) => entry?.type).filter(Boolean),
        spell?.name ?? ""
    ];
    const area = options.some((option) => /^(?:origin:)?item:area\b|^area-effect$/.test(option)) || Boolean(spell?.system?.area);
    const answer = golemAnswer(plan, { kinds, area });
    const name = defender.name ?? actor.name;
    const what = spell?.name ?? "this spell";
    const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
    const speaker = ChatMessage.getSpeaker({ actor, token: defender ?? undefined });
    if (answer.kind === "harmed" || (answer.kind === "healed" && answer.formula)) {
        const DamageRoll = damageRollClass();
        const roll = await new DamageRoll(`(${answer.formula})[${answer.kind === "harmed" ? "untyped" : "healing"}]`).evaluate();
        await roll.toMessage({ speaker, flavor: `<strong>${escape(item.name)}</strong>: ${escape(name)} is ${answer.kind} by ${escape(what)}${answer.kind === "harmed" ? ", instead of its usual effect" : ", and loses Slowed"}` });
    } else if (answer.kind === "healed") {
        await noteToGM(actor, defender, [`<strong>${escape(item.name)}</strong>: ${escape(name)} is healed by ${escape(what)}: instead of its usual effect, it loses Slowed and regains Hit Points equal to half the damage the spell would have dealt.`]);
    } else if (answer.kind === "slowed") {
        const rounds = answer.rounds ?? (await new Roll("2d6").evaluate()).total;
        const none = { mode: "none", multiplier: 0, sourceComponentIds: [] };
        const row = (effects) => ({ damage: { ...none }, effects });
        const slowed = { kind: "condition", slug: "slowed", value: 1, duration: { mode: "fixed", value: rounds, unit: "rounds", expiry: "turn-end", anchor: "effect-start" } };
        const card = { modelVersion: 13, source: { name: item.name }, rank: 1, traits: [], activation: { time: "free", traits: [] }, automation: { level: "automatic" }, targeting: { target: "self", range: null, area: null }, trigger: { event: "use" }, resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: row([slowed]), success: row([slowed]), failure: row([slowed]), criticalFailure: row([slowed]) } } };
        await postCard({ plan: card, item, sourceActor: actor, sourceToken: defender, tokens: [defender.object ?? defender], cause: `slowed by ${what}, ${rounds} round${rounds === 1 ? "" : "s"}, instead of its usual effect` });
    } else {
        await noteToGM(actor, defender, [`<strong>${escape(item.name)}</strong>: ${escape(name)} is immune to ${escape(what)}.`]);
    }
}

// A passive on a creature a monster holds, as a turn starts or ends (2026-10-10, batch 20): on the held creature's turn, its
// holder's ("A creature that starts its turn grabbed by the baatamidar must …"); on the monster's own turn, each creature it
// holds ("at the end of its turn, all creatures it has grabbed take …"). Swallowed: the "Swallowed by …" effect
// names the monster. Grabbed: PF2e's grabbed or restrained, within the monster's reach (PF2e doesn't say who holds it: a note).
async function cardsForGrabTurn(combatant, at) {
    const token = combatant?.token;
    const actor = token?.actor;
    const scene = token?.parent;
    if (!actor || !scene) return;
    await ready;
    const grid = gridOf(scene);
    const holding = (holder, other) => {
        const swallowed = (other.actor?.itemTypes?.effect ?? []).some((effect) => [holder.uuid, holder.actor?.uuid].includes(effect.flags?.[MODULE_ID]?.swallowed?.byToken) || effect.flags?.[MODULE_ID]?.swallowed?.byActor === holder.actor?.uuid);
        const reach = Math.max(5, Number(holder.actor?.system?.attributes?.reach?.base) || 5);
        const grabbed = !swallowed && ["grabbed", "restrained"].some((slug) => other.actor?.hasCondition?.(slug)) && distanceFeet(box(holder, grid.size), box(other, grid.size), grid) <= reach;
        return { swallowed, grabbed };
    };
    const living = (other) => !["undead", "construct"].some((trait) => other?.traits?.has?.(trait));
    const sets = (plan, whose, held, heldActor) => plan?.trigger?.event === "grab-turn" && plan.trigger.at === at && plan.trigger.whose === whose && (plan.trigger.hold === "swallowed" ? held.swallowed : held.grabbed) && (!plan.trigger.living || living(heldActor)) && plan.resolution && cardCheck(plan);
    const when = at === "start" ? "as its turn starts" : "as its turn ends";
    // Its turn, held.
    for (const holder of scene.tokens) {
        if (holder.id === token.id || !["npc", "hazard"].includes(holder.actor?.type) || holder.actor.isDead) continue;
        const held = holding(holder, token);
        if (!held.swallowed && !held.grabbed) continue;
        for (const item of holder.actor.itemTypes.action) {
            const plan = compile(item);
            if (!sets(plan, "held", held, actor)) continue;
            await postCard({ plan, item, sourceActor: holder.actor, sourceToken: holder, tokens: [token.object ?? token], cause: `${token.name} held, ${when}`, warning: held.grabbed ? `Only if ${holder.name} is the one holding it.` : null });
        }
    }
    // The monster's own turn.
    if (!["npc", "hazard"].includes(actor.type) || actor.isDead) return;
    for (const item of actor.itemTypes.action) {
        const plan = compile(item);
        if (plan?.trigger?.event !== "grab-turn" || plan.trigger.whose !== "own") continue;
        const tokens = scene.tokens.filter((other) => other.id !== token.id && other.actor && sets(plan, "own", holding(token, other), other.actor)).map((other) => other.object ?? other);
        if (tokens.length) await postCard({ plan, item, sourceActor: actor, sourceToken: token, tokens, cause: when, warning: plan.trigger.hold === "grabbed" ? `Only the creatures ${token.name} is holding.` : null });
    }
}

// A monster's permanent conditions (batch 21): set to at least their value; told to the GM as the encounter starts.
async function keepPermanent(actor, tell) {
    if (!["npc", "hazard"].includes(actor?.type)) return;
    await ready;
    for (const item of actor.itemTypes.action) {
        const plan = compile(item);
        if (plan?.builtin !== "permanent-condition") continue;
        const lines = [];
        for (const { slug, value } of plan.conditions ?? []) {
            const current = actor.getCondition?.(slug);
            const wanted = Number(value) || null;
            if (current && (!wanted || (current.value ?? 0) >= wanted)) continue;
            if (wanted && current) await game.pf2e.ConditionManager.updateConditionValue(current.id, actor, wanted);
            else await actor.increaseCondition(slug, wanted ? { value: wanted } : {});
            lines.push(`${slug}${wanted ? ` ${wanted}` : ""}`);
        }
        if (tell && lines.length) await ChatMessage.create({ content: `<p><strong>${item.name}</strong>: ${actor.name} is ${lines.join(", ")} for good${plan.noReactions ? " and can't use reactions" : ""}${plan.quickenedFor === "strike" ? " (its extra action only to Strike)" : ""}.</p>`, speaker: ChatMessage.getSpeaker({ actor }), whisper: ChatMessage.getWhisperRecipients("GM").map((user) => user.id) });
    }
}

// A monster's abilities that act as it dies ("When the skeleton is destroyed, … adjacent creatures take 2d6 slashing damage"):
// a card for the creatures in their area around it, once for each death (2026-10-10). One with no area: a card with no
// targets, for the GM to target.
const recentDeaths = new Map();
async function cardsForDeath(actor) {
    if (!["npc", "hazard"].includes(actor?.type)) return;
    const last = recentDeaths.get(actor.uuid);
    if (last && Date.now() - last < 30 * 1000) return;
    await ready;
    // Undying Myth (batch 41): a note for the GM, who keeps its Mythic Points.
    const undying = actor.itemTypes.action.map((item) => ({ item, plan: compile(item) })).find(({ plan }) => plan?.builtin === "mythic" && plan.kind === "undying");
    if (undying) {
        recentDeaths.set(actor.uuid, Date.now());
        const hp = undying.plan.amount ?? Math.floor((actor.system?.attributes?.hp?.max ?? 0) * (undying.plan.fraction ?? 0.5));
        await noteToGM(actor, actor.getActiveTokens(true, true)[0]?.document ?? null, [`<strong>${undying.item.name}</strong>: if it has a Mythic Point left, it spends them all and stays standing and conscious with ${hp} Hit Points.`]);
    }
    const deaths = actor.itemTypes.action.map((item) => ({ item, plan: compile(item) })).filter(({ plan }) => plan?.trigger?.event === "death" && plan.resolution && (cardCheck(plan) || plan.resolution.kind === "healing"));
    if (!deaths.length) return;
    recentDeaths.set(actor.uuid, Date.now());
    const token = actor.getActiveTokens(true, true)[0] ?? null;
    for (const { item, plan } of deaths) {
        // Only the creatures of the kind it names (Verdant Burst's plant creatures; batch 28).
        const tokens = tokensAround(token, Number(plan.targeting?.area?.value) || 0).filter((other) => traitsFit(other.actor?.traits ?? other.document?.actor?.traits, plan.targeting?.traits));
        if (plan.resolution.kind === "healing") await deathHealing(item, plan, actor, token, tokens);
        else await postCard({ plan, item, sourceActor: actor, sourceToken: token, tokens, cause: "as it dies" });
    }
}

// Healing as it dies (Verdant Burst): PF2e's own healing roll, with its buttons to apply it to the selected tokens; the creatures
// it reaches and its other words (difficult terrain) in the roll's heading, for the GM.
async function deathHealing(item, plan, actor, token, tokens) {
    const formula = plan.resolution.native?.healing?.components?.[0]?.formula;
    if (!formula) return;
    const DamageRoll = damageRollClass();
    const roll = await new DamageRoll(`(${formula})[healing]`).evaluate();
    const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
    const kind = [...(plan.targeting?.traits?.all ?? []), (plan.targeting?.traits?.any ?? []).join(" or ")].filter(Boolean).join(" ");
    const who = tokens.length ? `heals ${tokens.map((other) => escape(other.name)).join(", ")}` : `no ${escape(kind || "creature")} creature within ${Number(plan.targeting?.area?.value) || 0} feet to heal`;
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor, token: token ?? undefined }), flavor: `<strong>${escape(item.name)}</strong>: as ${escape(token?.name ?? actor.name)} dies, ${who}${(plan.notes ?? []).length ? `<br>${plan.notes.map(escape).join(" ")}` : ""}` });
}

// The creatures (on either side) within radius feet of the token's space, measured as auras are.
// (Batch 229, foes: only the creatures of another disposition — "each foe within 5 feet".)
export function tokensAround(token, radius, { foes = false } = {}) {
    const scene = token?.parent;
    const grid = scene ? gridOf(scene) : null;
    if (!grid || !radius) return [];
    return scene.tokens.filter((other) => other.id !== token.id && other.actor?.isOfType?.("creature") && !other.hidden && !(other.actor.isDead ?? false) && (!foes || other.disposition !== token.disposition) && distanceFeet(box(token, grid.size), box(other, grid.size), grid) <= radius).map((other) => other.object ?? other);
}

// A Strike activity's results on the creature its Strike hit: the activity's save to roll, or its results by the Strike's own
// degree (recorded, as a skill action's roll is) for the GM's Apply.
async function activityCard(message, pending, { actor, strike, target, targetToken, context }) {
    // (Extra dice of the Strike's own type: the type of the Strike that hit, batch 27.)
    const strikeType = Object.values(strike.system?.damageRolls ?? {})[0]?.damageType ?? null;
    const rider = activityRider(pending.plan, { strikeType, targetProne: Boolean(target?.actor?.hasCondition?.("prone")), targetTraits: [...(target?.actor?.traits ?? [])] });
    if (!rider) return;
    const sourceToken = message.token ?? pending.token ?? null;
    if (rider.plan) await activityResults(message, pending, rider, { actor, strike, target, targetToken, context, sourceToken });
    // (Batch 127, Clobber: its save only against an off-guard target — a line for the GM.)
    if (rider.save && fitsSize(target.actor.size, rider.size)) await postCard({ plan: rider.save, item: pending.item, sourceActor: actor, sourceToken, tokens: [target], rider: { strikeName: strike.name, cost: "activity" }, ...(rider.saveIf === "off-guard" ? { warning: "Only if the target is off-guard." } : {}) });
    // A skill action after the hit (batch 35: Terrifying Charge's Demoralize): PF2e's basic action, its card on the creature hit.
    const follow = rider.follow ? basics()[rider.follow] : null;
    if (follow && target?.actor) await postCard({ plan: follow, item: pending.item, sourceActor: actor, sourceToken, tokens: [target], rider: { strikeName: strike.name, cost: "activity" } });
}

// Its results by the Strike's own degree, recorded as a skill action's roll is, for the GM's Apply.
async function activityResults(message, pending, rider, { actor, strike, target, targetToken, context, sourceToken }) {
    return degreeCard(message, pending.item, rider.plan, { actor, strike, target, targetToken, context, sourceToken, cost: "activity" });
}

// A card whose results go by the Strike's own degree (a Strike activity's, or a rider's with a critical hit's alternative, batch
// 34): the Strike's roll recorded on it, as a skill action's is.
async function degreeCard(message, item, plan, { actor, strike, target, targetToken, context, sourceToken, cost }) {
    const state = createCard({
        plan,
        ability: { name: item.name, uuid: item.uuid },
        source: { actorUuid: actor.uuid, tokenUuid: sourceToken?.uuid ?? null, name: sourceToken?.name ?? actor.name },
        targets: [{ actorUuid: target.actor.uuid, tokenUuid: targetToken.uuid, name: target.name ?? target.actor.name, dc: context.dc?.value ?? null }],
        rider: { strikeName: strike.name, cost }
    });
    if (!state) return;
    const roll = message.rolls?.[0];
    const rolled = recordRoll(state, state.targets[0].id, { total: roll?.total ?? null, natural: roll?.dice?.[0]?.total ?? null, degree: context.outcome });
    await ChatMessage.create({ content: cardHTML(rolled), speaker: ChatMessage.getSpeaker({ actor, token: sourceToken ?? undefined }), flags: { [MODULE_ID]: { [FLAG]: rolled } } });
}

// A skill action PF2e has already rolled (a PC's Demoralize, Trip, Grapple,
// Shove, Disarm, Feint, Create a Diversion, Reposition or Escape): a card with
// the roll in, for the GM to apply its result.
const SKILL_ACTIONS = ["demoralize", "trip", "grapple", "shove", "disarm", "feint", "create-a-diversion", "reposition", "escape"];

async function cardForSkillAction(message) {
    const context = message.flags?.pf2e?.context;
    if (!context?.outcome || parseIdentifier(context.identifier)) return;
    const options = context.options ?? [];
    const slug = SKILL_ACTIONS.find((action) => options.includes(`action:${action}`));
    if (!slug) return;
    await ready;
    const plan = basics()[slug];
    if (!plan) return;
    const actor = message.actor ?? (message.speaker?.actor ? game.actors.get(message.speaker.actor) : null);
    if (!actor) return;
    const token = message.token ?? null;
    const targetToken = context.target?.token ? await fromUuid(context.target.token) : null;
    const target = targetToken?.object ?? targetToken;
    const item = await fromUuid(plan.source?.uuid ?? "").catch(() => null);
    const state = createCard({
        plan,
        ability: { name: plan.source?.name ?? slug, uuid: item?.uuid ?? null },
        source: { actorUuid: actor.uuid, tokenUuid: token?.uuid ?? null, name: token?.name ?? actor.name },
        targets: target?.actor ? [{ actorUuid: target.actor.uuid, tokenUuid: targetToken.uuid, name: target.name ?? target.actor.name, dc: context.dc?.value ?? null }] : []
    });
    if (!state) return;
    const roll = message.rolls?.[0];
    const rolled = state.targets.length ? recordRoll(state, state.targets[0].id, { total: roll?.total ?? null, natural: roll?.dice?.[0]?.total ?? null, degree: context.outcome }) : state;
    await ChatMessage.create({ content: cardHTML(rolled), speaker: ChatMessage.getSpeaker({ actor, token: token ?? undefined }), flags: { [MODULE_ID]: { [FLAG]: rolled } } });
}

// --- Rolls --------------------------------------------------------------------

// (2026-10-29) An unsaved copy of the card's item on its user, at the item's level, once PF2e has deleted it — or null.
function standIn(state, source) {
    const data = source ? standInSource(state.ability, state.plan) : null;
    if (!data) return null;
    try { return new CONFIG.Item.documentClass(data, { parent: source }); } catch (error) { console.warn(`${MODULE_ID} | stand-in item`, error); return null; }
}

// (2026-10-29, the item module's turn auras: an ability uuid that's an Actor — PF2e's check takes an item and throws on anything else, so
// the card's roll did nothing. Only an Item.)
const itemOnly = (found) => (found?.documentName === "Item" ? found : null);

async function rollTarget(message, target) {
    const state = stateOf(message);
    const actor = await fromUuid(target.actorUuid);
    const source = await fromUuid(state.source.actorUuid);
    const item = itemOnly(state.ability.uuid ? await fromUuid(state.ability.uuid).catch(() => null) : null) ?? (state.check.incapacitation ? standIn(state, source) : null);
    const identifier = rollIdentifier(message.id, target.id);
    // (2026-10-27, Essence Prism: a secret check, as PF2e rolls one with the secret trait — the GM's alone, blind when a player rolls it.)
    const secret = state.check.secret ? { messageMode: game.user.isGM ? "gm" : "blind" } : {};
    if (state.check.kind === "save") {
        const statistic = actor?.getStatistic?.(state.check.statistic);
        // (2026-10-27: a Lore it hasn't — untrained, its Intelligence modifier.)
        if (!statistic && isLore(state.check.statistic)) return untrainedLore(actor, state, identifier, item, { value: state.check.dc, label: `${state.ability.name} DC` }, secret);
        if (!statistic) throw new Error(`${target.name} has no ${statisticLabel(state.check.statistic)}${["fortitude", "reflex", "will"].includes(state.check.statistic) ? " save" : ""}.`);
        // (Batch 286: its own bonus or penalty on the save, and a save rolled twice keeping the worse — PF2e's rollTwice.)
        const saveBonus = state.check.bonus && game.pf2e?.Modifier ? [new game.pf2e.Modifier({ label: state.ability.name, modifier: state.check.bonus.value, type: state.check.bonus.type })] : [];
        // (2026-10-27: an incapacitation effect — PF2e improves the save of a creature above the effect's level: the item's, a spell's twice its
        // rank, otherwise the source's. 2026-10-29: an item PF2e has deleted since, the last dose, as a stand-in at its level — standIn.)
        return statistic.roll({ dc: { value: state.check.dc, label: `${state.ability.name} DC` }, identifier, skipDialog: true, item, origin: source, ...(saveBonus.length ? { modifiers: saveBonus } : {}), ...(state.check.misfortune ? { rollTwice: "keep-lower" } : {}), ...(state.check.incapacitation ? { extraRollOptions: ["item:trait:incapacitation"] } : {}), ...secret });
    }
    // (Batch 288: a check at a set modifier, Envelop's +16 or a spell attack modifier in place of Athletics: PF2e's check with that as its base.)
    if (Number.isFinite(state.check.modifier)) {
        if (!Number.isFinite(target.dc)) throw new Error(`${target.name}'s ${statisticLabel(state.check.against)} DC is unknown.`);
        const { Check, CheckModifier, Modifier } = game.pf2e ?? {};
        if (!Check?.roll || !CheckModifier || !Modifier) throw new Error("PF2e's check roller isn't available.");
        const extra = state.check.bonus ? [new Modifier({ label: state.ability.name, modifier: state.check.bonus.value, type: state.check.bonus.type })] : [];
        const check = new CheckModifier(state.ability.name, { modifiers: [] }, [new Modifier({ slug: "base", label: state.ability.name, modifier: state.check.modifier, type: "untyped" }), ...extra]);
        return Check.roll(check, { actor: source, type: "skill-check", identifier, item, dc: { value: target.dc, label: `${target.name}'s ${statisticLabel(state.check.against)} DC` }, options: new Set(), domains: [], traits: [], skipDialog: true });
    }
    const statistic = source?.getStatistic?.(state.check.statistic);
    const dcLabel = state.check.against ? `${target.name}'s ${statisticLabel(state.check.against)} DC` : `${state.ability.name} DC`;
    if (!statistic && isLore(state.check.statistic) && Number.isFinite(target.dc)) return untrainedLore(source, state, identifier, item, { value: target.dc, label: dcLabel }, secret);
    if (!statistic) throw new Error(`${state.source.name} has no ${statisticLabel(state.check.statistic)}.`);
    if (!Number.isFinite(target.dc)) throw new Error(`${target.name}'s ${statisticLabel(state.check.against)} DC is unknown.`);
    // (Its own bonus, batch 36: "They gain a +4 status bonus to the Athletics check".)
    const bonus = state.check.bonus && game.pf2e?.Modifier ? [new game.pf2e.Modifier({ label: state.ability.name, modifier: state.check.bonus.value, type: state.check.bonus.type })] : [];
    return statistic.roll({ dc: { value: target.dc, label: dcLabel }, identifier, skipDialog: true, item, ...(bonus.length ? { modifiers: bonus } : {}), ...secret });
}

const isLore = (slug) => /-lore$/.test(String(slug ?? "")) || slug === "lore";

// A Lore the roller hasn't (or "a Lore", any of its own): its best Lore, otherwise untrained — PF2e's check at its Intelligence modifier.
async function untrainedLore(actor, state, identifier, item, dc, secret) {
    const lores = Object.values(actor?.skills ?? {}).filter((skill) => skill?.lore);
    const best = state.check.statistic === "lore" ? lores.sort((a, b) => (b.mod ?? 0) - (a.mod ?? 0))[0] : null;
    if (best) return best.roll({ dc, identifier, skipDialog: true, item, ...secret });
    const { Check, CheckModifier, Modifier } = game.pf2e ?? {};
    if (!Check?.roll || !CheckModifier || !Modifier) throw new Error("PF2e's check roller isn't available.");
    const check = new CheckModifier(`${statisticLabel(state.check.statistic)} (untrained)`, { modifiers: [] }, [new Modifier({ slug: "int", label: "Intelligence", modifier: Number(actor?.abilities?.int?.mod) || 0, type: "ability" })]);
    return Check.roll(check, { actor, type: "skill-check", identifier, item, dc, options: new Set(), domains: [], traits: [], skipDialog: true, ...secret });
}

// A roll tagged with a card's identifier: its result, onto the card (active GM only).
async function recordResult(message) {
    const context = message.flags?.pf2e?.context;
    const id = parseIdentifier(context?.identifier ?? message.rolls?.[0]?.options?.identifier);
    if (!id) return;
    const card = game.messages.get(id.cardId);
    const state = stateOf(card);
    if (!state || state.status !== "open" || !context?.outcome) return;
    const roll = message.rolls?.[0];
    const next = recordRoll(state, id.targetId, { total: roll?.total ?? null, natural: roll?.dice?.[0]?.total ?? null, degree: context.outcome });
    if (next !== state) await card.update({ content: cardHTML(next), [`flags.${MODULE_ID}.${FLAG}`]: next });
}

// --- Buttons ------------------------------------------------------------------

function mayRoll(state, target) {
    if (game.user.isGM) return true;
    return state.check.kind === "save" ? owns(target.actorUuid) : owns(state.source.actorUuid);
}

function wireCard(message, html) {
    const state = stateOf(message);
    if (!state) return;
    // (A secret check's result: the GM's alone.)
    for (const element of html.querySelectorAll(game.user.isGM ? "[data-aar-player-text]" : "[data-aar-gm-text]")) element.remove();
    for (const button of html.querySelectorAll("[data-aar-action]")) {
        if (button.dataset.aarWired) continue;
        button.dataset.aarWired = "true";
        const target = state.targets.find((entry) => entry.id === button.dataset.targetId);
        const visible = button.dataset.gmOnly === "true" ? game.user.isGM : button.dataset.aarAction === "roll" ? target && mayRoll(state, target) : true;
        if (!visible) {
            button.remove();
            continue;
        }
        button.addEventListener("click", async (event) => {
            event.preventDefault();
            button.disabled = true;
            try {
                // (The card's fields: a cast's rank and DC.)
                const fields = Object.fromEntries([...(button.closest(".pf2e-aar-card")?.querySelectorAll("input[data-aar-field]") ?? [])].map((input) => [input.dataset.aarField, input.value]));
                await press(message, button.dataset.aarAction, button.dataset.targetId, { ...button.dataset, ...fields });
            } catch (error) {
                ui.notifications.error(`${state.ability.name}: ${error.message}`);
                console.error(`${MODULE_ID} |`, error);
                button.disabled = false;
            }
        });
    }
}

async function press(message, action, targetId, data = {}) {
    const state = stateOf(message);
    if (action === "roll") return rollTarget(message, state.targets.find((target) => target.id === targetId));
    if (!game.user.isGM) throw new Error("Only the GM can use this control.");
    if (action === "mode") return chooseMode(message, state, Number(data.mode));
    if (action === "cast") return castFromCard(message, state, data);
    // (Batch 142: the damage type the monster picks.)
    if (action === "damage-type") {
        if (state.status !== "open") return null;
        const next = { ...state, damageType: String(data.type) };
        return message.update({ content: cardHTML(next), [`flags.${MODULE_ID}.${FLAG}`]: next });
    }
    // Damage by the number of actions: the count the monster spent.
    if (action === "actions") {
        if (state.status !== "open") return null;
        const next = { ...state, actions: Number(data.actions) };
        return message.update({ content: cardHTML(next), [`flags.${MODULE_ID}.${FLAG}`]: next });
    }
    if (action === "roll-all") {
        for (const target of state.targets.filter((entry) => !entry.degree)) await rollTarget(message, target);
        return null;
    }
    if (action === "targets") {
        const tokens = [...game.user.targets];
        if (!tokens.length) throw new Error("Target the creatures first.");
        if (state.kind === "effect") {
            const sourceToken = state.source.tokenUuid ? await fromUuid(state.source.tokenUuid) : null;
            const next = { ...state, targets: createEffectCard({ plan: state.plan, ability: state.ability, source: state.source, targets: tokens.map((token) => effectTarget(token, sourceToken)) }).targets };
            return message.update({ content: cardHTML(next), [`flags.${MODULE_ID}.${FLAG}`]: next });
        }
        const kept = new Map(state.targets.map((target) => [target.tokenUuid ?? target.actorUuid, target]));
        const fresh = createCard({ plan: state.plan, ability: state.ability, source: state.source, targets: tokens.map((token) => targetEntry(token, state.check)) });
        const targets = fresh.targets.map((target) => {
            const before = kept.get(target.tokenUuid ?? target.actorUuid);
            return before?.degree ? { ...target, total: before.total, natural: before.natural, degree: before.degree } : target;
        });
        const next = { ...state, targets };
        return message.update({ content: cardHTML(next), [`flags.${MODULE_ID}.${FLAG}`]: next });
    }
    if (action === "apply") return applyCard(message);
    return null;
}

// The way the GM picked: the card becomes that way's card, for the same targets; a way to resolve by hand starts the
// ability's recharge now (an automated way's starts on Apply).
async function chooseMode(message, state, index) {
    const mode = state?.kind === "modes" && state.status === "choose" ? state.modes[index] : null;
    if (!mode) return null;
    const name = `${state.ability.name} (${mode.name})`;
    // (Batch 274: every way in turn — Dragonspeech's Words, each on its own ally: each way's own card (the creature's own ability by that name,
    // when it has one), on the targets of the moment; the card stays until each is used.)
    if (state.all) {
        if ((state.used ?? []).includes(index)) return null;
        const item = state.ability.uuid ? await fromUuid(state.ability.uuid).catch(() => null) : null;
        const token = state.source.tokenUuid ? await fromUuid(state.source.tokenUuid).catch(() => null) : null;
        const own = item?.actor?.items?.find?.((entry) => entry.name === mode.name && entry.id !== item.id) ?? null;
        if (item && mode.plan) await playAbility(own ?? item, mode.plan, token);
        // (Batch 275: ways in groups, Choose Weakness's damage and resistance — one from each: the others of its group go with it.)
        const used = [...new Set([...(state.used ?? []), index, ...(mode.group ? state.modes.flatMap((entry, at) => (entry.group === mode.group ? [at] : [])) : [])])];
        const next = { ...state, used, status: used.length >= state.modes.length ? "chosen" : "choose", results: [...state.results, ...(mode.plan ? [`${name}.`] : [`${name}: resolve it by hand.`, ...(mode.notes ?? [])])] };
        return message.update({ content: cardHTML(next), [`flags.${MODULE_ID}.${FLAG}`]: next });
    }
    if (!mode.plan) {
        // (Batch 273: with what that way does, in words.)
        const lines = [`${name}: resolve it by hand.`, ...(mode.notes ?? [])];
        const item = state.ability.uuid ? await fromUuid(state.ability.uuid).catch(() => null) : null;
        const formula = item ? rechargeFormula(item) : null;
        if (item && formula) lines.push(await startRecharge({ actor: item.actor, item, formula, tokenUuid: state.source.tokenUuid }));
        const next = { ...state, status: "chosen", results: lines };
        return message.update({ content: cardHTML(next), [`flags.${MODULE_ID}.${FLAG}`]: next });
    }
    // (Batch 273: a way that's a builtin — played as the ability itself would be; the card says which.)
    if (mode.plan.builtin && mode.plan.builtin !== "cast-spell") {
        const item = state.ability.uuid ? await fromUuid(state.ability.uuid).catch(() => null) : null;
        const token = state.source.tokenUuid ? await fromUuid(state.source.tokenUuid).catch(() => null) : null;
        if (item) await playAbility(item, mode.plan, token);
        const next = { ...state, status: "chosen", results: [`${name}.`] };
        return message.update({ content: cardHTML(next), [`flags.${MODULE_ID}.${FLAG}`]: next });
    }
    // (Batch 179: a way that casts a spell — its cast card, at the ability's rank and DC.)
    if (mode.plan.builtin === "cast-spell") {
        const item = state.ability.uuid ? await fromUuid(state.ability.uuid).catch(() => null) : null;
        const spell = mode.plan.spell?.uuid ? await fromUuid(mode.plan.spell.uuid).catch(() => null) : null;
        const next = createCastCard({ plan: mode.plan, ability: { name, uuid: state.ability.uuid }, source: state.source, spell: spell ? { uuid: mode.plan.spell.uuid, name: spell.name } : null, rank: mode.plan.rank ?? (spell && item ? defaultRank(spell, item.actor) : null), dc: mode.plan.dc ?? (item ? spellDC(item.actor) : null), warning: state.warning });
        return message.update({ content: cardHTML(next), [`flags.${MODULE_ID}.${FLAG}`]: next });
    }
    const check = cardCheck(mode.plan);
    const targets = [];
    for (const target of state.targets) {
        const actor = await fromUuid(target.actorUuid).catch(() => null);
        targets.push({ ...target, dc: check?.kind === "check" ? (!check.against && Number.isFinite(check.dc) ? check.dc : actor?.getStatistic?.(check.against)?.dc?.value ?? null) : null });
    }
    const next = createCard({ plan: mode.plan, ability: { name, uuid: state.ability.uuid }, source: state.source, targets, warning: state.warning });
    return message.update({ content: cardHTML(next), [`flags.${MODULE_ID}.${FLAG}`]: next });
}

// --- Apply ----------------------------------------------------------------------

const instanceFormula = (instance) => [...(instance.dice ?? []).map((term) => `${term.factor && term.factor !== 1 ? `${term.factor}*` : ""}${term.count}d${term.die}`), instance.constant ? String(instance.constant) : null].filter(Boolean).join(" + ") || "0";

async function applyCard(message) {
    const state = stateOf(message);
    if (!state || state.status !== "open") return null;
    if (state.kind !== "effect" && !allRolled(state)) throw new Error("Not every target has rolled yet.");
    const core = game.modules.get(CORE_ID)?.api;
    if (!core) throw new Error("The resolution core isn't active.");
    const caster = { id: "source" };
    const wrappers = state.targets.map((target) => ({ id: target.id }));
    // Allies (an effect card's): on the user's side, as the card recorded.
    const allied = (wrapper) => wrapper?.id === "source" || Boolean(state.targets.find((target) => target.id === wrapper?.id)?.allied);
    // (A spell's rank, for its heightened damage: a hazard's spell.)
    const context = { caster, targets: wrappers, id: (c) => c.id, statistic: () => ({ modifier: 0, dc: 10 }), allied, ...(Number.isFinite(state.actions) ? { actions: state.actions } : {}), ...(Number.isFinite(state.castRank) ? { castRank: state.castRank } : {}) };
    const rolled = [];
    const io = {
        roll: (_statistic, options) => {
            const who = options?.target ?? options?.actor;
            const target = state.targets.find((entry) => entry.id === who?.id);
            return { degree: target?.degree ?? "failure", total: target?.total ?? null, natural: target?.natural ?? null };
        },
        damage: async (instance) => {
            const formula = instanceFormula(instance);
            const roll = await new Roll(formula).evaluate();
            rolled.push(`${formula}${instance.type ? ` ${instance.type}` : ""} = ${roll.total}`);
            return roll.total;
        },
        // (Batch 142: the GM's damage type on the card.)
        choose: (decision) => (decision?.id === "caster-choice:damage-type" ? state.damageType ?? undefined : undefined)
    };
    const resolved = await core.registry.resolve(state.plan, context, io);
    // (2026-10-27: a part immunity — the conditions its targets are already immune to left out, the rest as rolled.)
    const parts = partImmunities(state.plan, state.ability.name);
    const immune = new Map();
    for (const target of parts.length ? state.targets : []) {
        const { actor } = await targetOf(state, target.id);
        const held = parts.filter((part) => actor && partImmuneTo(immunityFlags(actor), part, state.source.actorUuid)).map((part) => part.condition);
        if (held.length) immune.set(target.id, new Set(held));
    }
    const { kept, dropped } = dropImmuneParts(resolved.changes, immune);
    const result = { ...resolved, changes: kept };
    // (A heal's roll, "Ease the Burden": not "Damage rolled"; 2026-10-30 feat module Foundry test. Only when nothing else rolls damage.)
    const resolutionText = JSON.stringify(state.plan?.resolution ?? {});
    const healsOnly = resolutionText.includes('"kind":"heal"') && !/"mode":"(?:shared|formulas)"/.test(resolutionText);
    const lines = rolled.map((line) => `${healsOnly ? "Healing rolled" : "Damage rolled"}: ${healsOnly ? line.replace(/ untyped(?= =)/, "") : line}`);
    // (2026-10-27: "Drained 1d4" — rolled for each creature now, so the card's lines carry the value.)
    for (const [index, change] of result.changes.entries()) {
        if (!rollsValue(change)) continue;
        const { target, actor } = await targetOf(state, change.target);
        result.changes[index] = await withRolledValue(change, state, target?.name, actor);
        lines.push(`${target?.name ?? "A creature"}'s ${change.slug} rolled ${change.valueRoll}: ${result.changes[index].value}`);
    }
    for (const { target, slug } of dropped) lines.push(`${state.targets.find((entry) => entry.id === target)?.name ?? "A creature"} ${partWords(parts.find((part) => part.condition === slug), state.ability.name)}`);
    for (const change of result.changes) {
        try {
            const extra = await applyChange(change, state);
            if (extra) lines.push(extra);
        } catch (error) {
            lines.push(`Couldn't apply ${change.op} to ${state.targets.find((target) => target.id === change.target)?.name ?? "a creature"}: ${error.message}`);
        }
    }
    lines.push(...(await grantImmunity(state)));
    lines.push(...(await grantPartImmunity(state, parts, result.changes, immune)));
    // Fast Swallow (batch 38): a creature it just Grabbed: its Swallow Whole's card, as its reaction.
    await fastSwallow(state, result.changes);
    await grabStrike(state, result.changes);
    // "It can't use it again for 1d4 rounds": rolled now.
    const recharge = state.plan?.trigger?.recharge?.formula;
    if (recharge && state.ability.uuid) {
        const item = await fromUuid(state.ability.uuid).catch(() => null);
        const actor = item?.actor ?? (await fromUuid(state.source.actorUuid));
        if (item && actor) lines.push(await startRecharge({ actor, item, formula: recharge, tokenUuid: state.source.tokenUuid, shares: state.plan?.sharesRecharge ?? null }));
    }
    const names = { source: state.source.name, ...Object.fromEntries(state.targets.map((target) => [target.id, target.name])) };
    // What happened first, then the rolls and reminders.
    const next = { ...stateOf(message), status: "applied", results: [...changeLines(result.changes, names), ...lines] };
    if (!next.results.length) next.results = ["Nothing to apply."];
    const updated = await message.update({ content: cardHTML(next), [`flags.${MODULE_ID}.${FLAG}`]: next });
    // (2026-10-25, for other modules' follow-ups — the item module's space-picking card after Roc-Shaft Arrow's failed save: each target's
    // token and degree, on the client that applied the card.)
    Hooks.callAll(`${MODULE_ID}.applied`, { message, state: next, targets: next.targets.map((target) => ({ id: target.id, tokenUuid: target.tokenUuid ?? null, actorUuid: target.actorUuid, name: target.name, degree: target.degree ?? null })), changes: result.changes });
    return updated;
}

// "Temporarily immune for 1 minute" (Frightful Presence, Stench, Demoralize):
// an effect on each target whose result grants it, which aura cards check.
async function fastSwallow(state, changes) {
    // (Grabbed, or restrained by a Grab's critical success.)
    const grabbed = changes.filter((change) => change.op === "condition" && ["grabbed", "restrained"].includes(change.slug) && change.target !== "source");
    if (!grabbed.length || !state.source?.actorUuid) return;
    const actor = await fromUuid(state.source.actorUuid);
    if (!actor || !["npc", "hazard"].includes(actor.type)) return;
    await ready;
    const abilities = actor.itemTypes.action.map((item) => ({ item, plan: compile(item) }));
    const fast = abilities.find(({ plan }) => plan?.builtin === "fast-swallow");
    const swallow = fast ? abilities.find(({ plan }) => Object.values(plan?.resolution?.outcomes ?? {}).some((row) => row?.effects?.some((effect) => effect.kind === "swallow"))) : null;
    if (!swallow) return;
    const sourceToken = state.source.tokenUuid ? await fromUuid(state.source.tokenUuid) : null;
    for (const change of grabbed) {
        const target = state.targets.find((entry) => entry.id === change.target);
        const token = target?.tokenUuid ? await fromUuid(target.tokenUuid) : null;
        if (token) await postCard({ plan: swallow.plan, item: swallow.item, sourceActor: actor, sourceToken, tokens: [token.object ?? token], cause: `${fast.item.name} (its reaction)` });
    }
}

// (Batch 197, Deadly Mandibles: a creature its card just grabbed — its reaction Strike at it, a note for the GM to roll from its sheet.)
async function grabStrike(state, changes) {
    const grabbed = changes.filter((change) => change.op === "condition" && ["grabbed", "restrained"].includes(change.slug) && change.target !== "source");
    if (!grabbed.length || !state.source?.actorUuid) return;
    const actor = await fromUuid(state.source.actorUuid);
    if (!actor || !["npc", "hazard"].includes(actor.type)) return;
    await ready;
    const answer = actor.itemTypes.action.map((item) => ({ item, plan: compile(item) })).find(({ plan }) => plan?.builtin === "reaction-strike" && plan.triggers?.includes("grabs"));
    if (!answer) return;
    const sourceToken = state.source.tokenUuid ? await fromUuid(state.source.tokenUuid) : null;
    const names = grabbed.map((change) => state.targets.find((entry) => entry.id === change.target)?.name).filter(Boolean);
    await noteToGM(actor, sourceToken, [`<strong>${answer.item.name}</strong> (its reaction): ${answer.plan.note ? `${answer.plan.note} ` : ""}Then its ${answer.plan.strike} Strike at ${names.join(", ") || "the creature it grabbed"}: roll it from its sheet.`]);
}

// (2026-10-27) The part immunities a card's changes earn (src/live/part-immunity.js): an "Immune: <condition> (<ability>)" Effect for their time.
async function grantPartImmunity(state, parts, changes, immune) {
    if (!parts.length) return [];
    const item = state.ability.uuid ? await fromUuid(state.ability.uuid).catch(() => null) : null;
    const lines = [];
    for (const { target: id, part } of partsEarned(changes, state.targets, parts, immune)) {
        const { target, actor } = await targetOf(state, id);
        if (!actor) continue;
        await actor.createEmbeddedDocuments("Item", [partImmunityEffect(MODULE_ID, part, {
            ability: { name: state.ability.name, img: item?.img },
            source: { actorUuid: state.source.actorUuid, name: state.source.name },
            conditionName: game.pf2e.ConditionManager.getCondition(part.condition)?.name ?? part.condition,
            time: { worldTime: game.time.worldTime, initiative: game.combat?.started ? game.combat.combatant?.initiative ?? null : null }
        })]);
        lines.push(`${target.name} ${partWords(part, state.ability.name, true)}`);
    }
    return lines;
}

async function grantImmunity(state) {
    const immunity = state.plan?.trigger?.immunity;
    // (2026-10-20: its own key first — an item's grades share one — trigger.immunity.slug.)
    const slug = immunity?.slug ?? state.plan?.source?.slug ?? state.ability.slug ?? immunityKey(state.plan, state.ability.name);
    if (!immunity?.duration || !slug) return [];
    const item = state.ability.uuid ? await fromUuid(state.ability.uuid).catch(() => null) : null;
    const lines = [];
    for (const target of state.targets) {
        if (!immunityApplies(immunity, target.degree)) continue;
        const { actor } = await targetOf(state, target.id);
        if (!actor) continue;
        const source = immunity.against === "all" ? null : state.source.actorUuid;
        if (isImmune(immunityFlags(actor), { slug, source })) continue;
        const data = immunityEffect(MODULE_ID, immunity, {
            ability: { name: state.ability.name, slug, img: item?.img },
            source: { actorUuid: state.source.actorUuid, name: state.source.name },
            time: { worldTime: game.time.worldTime, initiative: game.combat?.started ? game.combat.combatant?.initiative ?? null : null }
        });
        await actor.createEmbeddedDocuments("Item", [data]);
        lines.push(`${target.name} is immune to ${immunity.against === "all" ? `every ${state.ability.name}` : `${state.source.name}'s ${state.ability.name}`} for ${immunity.duration.value} ${immunity.duration.unit.replace(/s$/, immunity.duration.value === 1 ? "" : "s")}`);
    }
    return lines;
}

async function targetOf(state, id) {
    // The user itself (Trip's critical failure, Escape's success).
    if (id === "source") {
        const token = state.source.tokenUuid ? await fromUuid(state.source.tokenUuid) : null;
        return { target: { id: "source", name: state.source.name }, token, actor: token?.actor ?? (await fromUuid(state.source.actorUuid)) };
    }
    const target = state.targets.find((entry) => entry.id === id);
    if (!target) return {};
    const token = target.tokenUuid ? await fromUuid(target.tokenUuid) : null;
    return { target, token, actor: token?.actor ?? (await fromUuid(target.actorUuid)) };
}

// A condition whose value is rolled (the core's valueRoll, kept when the text gives dice): the roll, posted, at least 1 — as the spell
// module's basic saves do.
const rollsValue = (change) => change?.op === "condition" && !Number.isFinite(change.value) && typeof change.valueRoll === "string" && change.valueRoll.trim() !== "";

async function withRolledValue(change, state, name, actor) {
    const roll = await new Roll(change.valueRoll).evaluate();
    try { await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: actor ?? undefined }), flavor: `${state.ability?.name ?? "Ability"}: ${name ?? "a creature"}'s ${change.slug} value (${change.valueRoll})` }); } catch (_) {}
    const { valueRoll, ...rest } = change;
    return { ...rest, value: Math.max(1, Number(roll.total) || 0), rolled: valueRoll };
}

export const damageRollClass = () => (CONFIG.Dice?.rolls ?? []).find((roll) => roll?.name === "DamageRoll");

// (2026-10-26, for the item module's Exsanguinate: what each target actually took — after its resistances, from its Hit Points and temporary
// ones — as a card's changes are applied in turn, for a later tempHp change's fromDamage { of, fraction, afterResistances }.)
const TAKEN = new WeakMap();
const hitPointsOf = (actor) => (Number(actor?.system?.attributes?.hp?.value) || 0) + (Number(actor?.system?.attributes?.hp?.temp) || 0);
// The times a PF2e Effect counts: a condition for one of them is an Effect that grants it, for that time (2026-10-27: hours and days too —
// Grease Snare's "clumsy 1 for 1 hour" stayed on for good).
const TIMED_UNITS = ["rounds", "minutes", "hours", "days"];

// One change from the core, applied in Foundry. Returns an extra line for the card, or null.
// (2026-10-15: exported on the module api as api.live.applyChange for the item module's cards — run it on the active GM's client, with a state
// { plan, ability: { name, uuid }, source: { actorUuid, tokenUuid, name }, targets: [{ id, actorUuid, tokenUuid, name }] }. Keep its
// signature stable.)
export async function applyChange(change, state) {
    const { target, token, actor } = await targetOf(state, change.target);
    if (!actor && change.target !== undefined) return null;
    // (2026-10-27, for the item module's cards: a value the text rolls, "Drained 1d4" — the core's valueRoll, rolled here when the caller
    // hasn't.)
    if (rollsValue(change)) {
        const rolled = await withRolledValue(change, state, target?.name, actor);
        const line = await applyChange(rolled, state);
        return [`${target?.name ?? "A creature"}'s ${change.slug} rolled ${change.valueRoll}: ${rolled.value}`, line].filter(Boolean).join("; ");
    }
    switch (change.op) {
        case "damage": {
            // (2026-10-16: a material the damage carries — "3d8[fire,silver]", the core's instance.materials — back in its flavor, which PF2e's
            // DamageRoll reads, so a weakness to silver applies.)
            const parts = change.instances.filter((instance) => instance.amount > 0).map((instance) => `${instance.amount}[${[...(instance.category === "persistent" ? ["persistent"] : []), instance.type ?? "untyped", ...(instance.materials ?? [])].join(",")}]`);
            if (!parts.length) return null;
            const DamageRoll = damageRollClass();
            const roll = await new DamageRoll(parts.length === 1 ? parts[0] : `{${parts.join(",")}}`).evaluate();
            const item = itemOnly(state.ability.uuid ? await fromUuid(state.ability.uuid).catch(() => null) : null);
            const before = hitPointsOf(actor);
            // (2026-10-27: its roll options and the resistance and immunities it ignores, src/live/card.js damageExtras.)
            const { rollOptions, ...ignores } = damageExtras(state.plan);
            await actor.applyDamage({ damage: roll, token: token ?? undefined, item: item ?? undefined, ...(rollOptions ? { rollOptions: new Set(rollOptions) } : {}), ...ignores });
            const taken = Math.max(0, before - hitPointsOf(actor));
            if (!TAKEN.has(state)) TAKEN.set(state, new Map());
            TAKEN.get(state).set(change.target, (TAKEN.get(state).get(change.target) ?? 0) + taken);
            return null;
        }
        case "condition": {
            if (change.slug === "persistent-damage") {
                const DamageRoll = damageRollClass();
                // Its dice ("1d4 bleed" rolls each round), unless a basic save halved or doubled the rolled amount.
                const dice = change.damage?.dice?.length && !change.damage?.multiplier ? instanceFormula(change.damage) : null;
                const roll = await new DamageRoll(`(${change.damage?.formula ?? dice ?? change.damage?.amount ?? 1})[${["persistent", change.damage?.type ?? "untyped", ...(change.damage?.materials ?? [])].join(",")}]`).evaluate();
                await actor.applyDamage({ damage: roll, token: token ?? undefined });
                return null;
            }
            // Already slowed (batch 75): "a failed save causes it to be Petrified permanently" — the worse condition, for its time or for good.
            if (change.escalate?.slug && actor.itemTypes.condition.some((condition) => condition.slug === change.escalate.if && condition.active)) {
                const worse = change.escalate;
                if (worse.duration?.mode === "fixed" && TIMED_UNITS.includes(worse.duration.unit)) {
                    await timedCondition(actor, worse.slug, worse.value, worse.duration, state);
                    return `${target.name} was already ${worse.if}: ${worse.slug}, ${durationText(worse.duration, state.source.name, target.name)}`;
                }
                await setCondition(actor, worse.slug, worse.value);
                return `${target.name} was already ${worse.if}: ${worse.slug}${worse.duration ? "" : " (until it's restored)"}`;
            }
            // Off-guard to one creature's attacks (Feint, Create a Diversion): an effect on that creature.
            if (change.slug === "off-guard" && change.scope?.attacker) return scopedOffGuard(state, change);
            // While it stays in the aura (Aura of Sobs' stupefied): an effect scripts/auras.js ends when it leaves.
            if (change.duration?.mode === "in-aura" && (await applyAuraCondition(actor, change, state))) {
                const after = change.duration.after;
                return `${target.name}'s ${change.slug} lasts while it stays in the aura${after ? `, and ${after.value} ${after.value === 1 ? after.unit.replace(/s$/, "") : after.unit} after it leaves` : ""}`;
            }
            // (2026-10-17: "dazzled while the persistent damage lasts" — Sparking Spellgun: an Effect granting it, ended with the creature's last
            // persistent damage of that type, scripts/floors.js; none of it, no condition.)
            if (change.duration?.mode === "while" && change.duration.persistent) {
                const type = change.duration.persistent;
                return (await applyWhilePersistent(actor, change.slug, change.value, type, state))
                    ? `${target.name}'s ${change.slug} lasts while it takes persistent ${type} damage`
                    : `${target.name} takes no persistent ${type} damage, so it isn't ${change.slug}`;
            }
            // (2026-10-20: "The target reduces its slowed condition by 1" — the core's stack, by below 0: that much lower, gone at 0; nothing when
            // it has none.)
            if (Number(change.stack?.by) < 0) {
                const existing = actor.itemTypes.condition.find((condition) => condition.slug === change.slug && condition.active);
                if (!existing) return `${target.name} isn't ${change.slug}`;
                const lower = Math.max(0, (Number(existing.value) || 0) + Number(change.stack.by));
                if (lower > 0) await game.pf2e.ConditionManager.updateConditionValue(existing.id, actor, lower);
                else await actor.decreaseCondition(change.slug, { forceRemove: true });
                return lower > 0 ? `${target.name}'s ${change.slug} drops to ${lower}` : `${target.name} is no longer ${change.slug}`;
            }
            // (2026-10-20: "a new Will save at the end of each of its turns" — duration.saveEnds, src/live/recurring.js: scripts/recurring.js posts
            // the saves. One that escalates: the condition itself, with an Effect that keeps its saves; otherwise an Effect that grants it, for
            // its time or until a save ends it.)
            const recurring = change.duration?.saveEnds ? recurringSpec(change.duration.saveEnds, planDC(state)) : null;
            if (recurring) {
                const words = `; ${recurringWords(recurring)}`;
                if (recurring.mode === "escalate") {
                    const now = Number(actor.itemTypes.condition.find((condition) => condition.slug === change.slug && condition.active)?.value) || 0;
                    const value = change.stack && now > 0 && Number.isFinite(change.value) ? Math.min(Number(change.stack.max) || Infinity, now + (Number(change.stack.by) || 1)) : change.value;
                    await setCondition(actor, change.slug, value);
                    await saveTracker(actor, change.slug, recurring, state);
                    return `${target.name} is ${change.slug}${Number.isFinite(value) ? ` ${value}` : ""}${words}`;
                }
                const fixed = change.duration.mode === "fixed" && TIMED_UNITS.includes(change.duration.unit);
                const duration = fixed ? (change.duration.valueRoll ? { ...change.duration, value: (await new Roll(change.duration.valueRoll).evaluate()).total } : change.duration) : { mode: "unlimited", ...(change.duration.escape ? { escape: change.duration.escape } : {}) };
                await timedCondition(actor, change.slug, change.value, duration, state, { recurring });
                return `${target.name} is ${change.slug}${fixed ? ` for ${durationText(duration, state.source.name, target.name)}` : ""}${words}`;
            }
            // (2026-10-20: "Immobilized for 1 minute or until it Escapes (DC 27)", "Slowed 1" until it Escapes: an Effect granting it, for its time or
            // until removed, that a successful Escape ends — scripts/escape.js.)
            if (change.duration?.escape && (change.duration.mode === "until-escape" || (change.duration.mode === "fixed" && TIMED_UNITS.includes(change.duration.unit)))) {
                const duration = change.duration.valueRoll ? { ...change.duration, value: (await new Roll(change.duration.valueRoll).evaluate()).total } : change.duration;
                await timedCondition(actor, change.slug, change.value, duration, state);
                return `${target.name}'s ${change.slug} lasts ${duration.mode === "fixed" ? `${durationText(duration, state.source.name, target.name)} or ` : ""}until it Escapes (DC ${duration.escape.dc})`;
            }
            // A condition with a duration: a PF2e effect that grants it and ends on the monster's turn.
            if (change.duration?.mode === "fixed" && TIMED_UNITS.includes(change.duration.unit)) {
                // "for 1d4 rounds": rolled for each creature.
                const duration = change.duration.valueRoll ? { ...change.duration, value: (await new Roll(change.duration.valueRoll).evaluate()).total } : change.duration;
                await timedCondition(actor, change.slug, change.value, duration, state);
                return `${target.name}'s ${change.slug} lasts ${durationText(duration, state.source.name, target.name)}${change.duration.valueRoll ? ` (rolled ${change.duration.valueRoll})` : ""}${saveEndsText(change)}`;
            }
            // A condition that grows with each later failure (batch 74): what it already has plus the stack, to its maximum.
            const now = Number(actor.itemTypes.condition.find((condition) => condition.slug === change.slug && condition.active)?.value) || 0;
            if (change.stack && now > 0 && Number.isFinite(change.value)) {
                const grown = Math.min(Number(change.stack.max) || Infinity, now + (Number(change.stack.by) || 1));
                await setCondition(actor, change.slug, grown);
                return `${target.name}'s ${change.slug} grows to ${grown}${Number.isFinite(change.stack.max) && grown >= change.stack.max ? " (its maximum)" : ""}`;
            }
            await setCondition(actor, change.slug, change.value);
            // "Fleeing for as long as it's frightened": the GM ends it with that condition.
            if (change.duration?.mode === "while" && change.duration.condition) return `${target.name}'s ${change.slug} lasts as long as it's ${change.duration.condition}`;
            // (Batch 311: a new save at the end of each of its turns — the GM rolls it.)
            if (change.duration?.saveEnds) return `${target.name} is ${change.slug}${saveEndsText(change)}`;
            return null;
        }
        case "effect":
            // Swallowed: an effect granting grabbed and slowed 1, with the damage at the end of each turn (scripts/swallow.js).
            if (change.effect?.kind === "swallow") return applySwallow(state, actor, change.effect);
            if (change.effect?.kind === "disarm") return disarm(actor, change.effect, target);
            if (change.effect?.kind === "modifier") return penaltyEffect(actor, change.effect.modifier, state, change.against ?? null);
            if (change.effect?.kind === "native") return nativeEffect(actor, change.effect, state, state.targets.find((entry) => entry.id === change.target)?.degree ?? null);
            if (change.effect?.kind === "note") return noteEffect(actor, change.effect.note, state);
            // (2026-10-16: a condition floor — "can't reduce its sickened value below 1 while the persistent fire damage lasts", the item
            // module's save rows; scripts/floors.js.)
            if (change.effect?.kind === "floor") {
                const floor = change.effect.floor;
                const duration = floor?.duration;
                const rounds = floor?.lifetime === "fixed" && duration ? (duration.anchor === "target-turn" ? turnRounds(duration, actor.uuid) : duration.anchor === "source-turn" ? turnRounds(duration, state.source.actorUuid) : duration.value) : null;
                const done = await applyFloor(actor, floor, state, { rounds, anchor: (created) => anchorToTarget(created, actor, duration) });
                return done ? `${target.name}: ${done}` : null;
            }
            return null;
        case "end": {
            // Escape: the user's grabbed or restrained ends (an effect granting it goes with it).
            if (change.what?.stabilize) {
                await actor.decreaseCondition?.("dying", { forceRemove: true });
                return `${target.name} is stabilized (still unconscious)`;
            }
            const slugs = change.what?.conditions ?? [];
            const gone = actor.itemTypes.condition.filter((condition) => slugs.includes(condition.slug));
            if (gone.length) await actor.deleteEmbeddedDocuments("Item", gone.map((condition) => condition.id));
            return gone.length ? `${target.name} is no longer ${[...new Set(gone.map((condition) => condition.slug))].join(" or ")}` : null;
        }
        // Healing on the creature (batch 31: Drink Blood's "regains 10 Hit Points, gaining any excess as temporary Hit Points").
        case "heal": {
            // (2026-10-15: a dying creature healed to 1 HP or more loses Dying and Unconscious and gains Wounded — the core's dying recovery,
            // shared with the spell and item modules; PF2e leaves Dying to the table.)
            const wasDying = isDying(actor);
            const hp = actor.system?.attributes?.hp ?? {};
            const value = Number(hp.value) || 0;
            const max = Number(hp.max) || value;
            const healed = Math.min(change.amount, Math.max(0, max - value));
            const excess = change.excessAsTemp ? change.amount - healed : 0;
            const update = { "system.attributes.hp.value": value + healed };
            if (excess > (Number(hp.temp) || 0)) update["system.attributes.hp.temp"] = excess;
            await actor.update(update);
            const revived = await recoverFromDying(actor, wasDying);
            return `${target.name} regains ${healed} Hit Points${excess > 0 ? ` and has ${Math.max(excess, Number(hp.temp) || 0)} temporary Hit Points` : ""}${revived ? `. ${revivedNote(revived)}` : ""}`;
        }
        // Temporary Hit Points (batch 30): the higher of its current and these (they don't stack); how long they last, for the GM.
        case "tempHp": {
            // (A share of what a target took after its resistances, as this card applied it: Exsanguinate's half.)
            let amount = change.amount;
            if (change.fromDamage?.afterResistances) {
                const taken = TAKEN.get(state)?.get(change.fromDamage.of);
                if (Number.isFinite(taken)) amount = Math.floor(taken * (Number(change.fromDamage.fraction) || 1));
                if (!(amount > 0)) return `${target.name} gains no temporary Hit Points (no damage was taken)`;
            }
            const current = Number(actor.system?.attributes?.hp?.temp) || 0;
            const lasting = change.duration?.mode === "fixed" && change.duration.value ? `, for ${change.duration.value} ${change.duration.value === 1 ? String(change.duration.unit).replace(/s$/, "") : change.duration.unit}` : "";
            // (2026-10-26: for a set time, PF2e's own TempHP rule on an Effect that lasts it — "You lose any remaining temporary Hit Points after
            // 1 minute": they go when it ends.)
            if (lasting && TIMED_UNITS.includes(change.duration.unit) && amount > current) {
                await actor.createEmbeddedDocuments("Item", [{
                    name: `Temporary Hit Points (${state.ability?.name ?? "ability"})`,
                    type: "effect",
                    img: "icons/svg/regen.svg",
                    system: { slug: "temporary-hit-points", duration: { value: Number(change.duration.value), unit: change.duration.unit, expiry: "turn-start", sustained: false }, rules: [{ key: "TempHP", value: amount }], description: { value: `<p>${amount} temporary Hit Points${lasting}.</p>` } },
                    flags: { [MODULE_ID]: { tempHp: { amount, source: state.ability?.name ?? null } } }
                }]);
            } else if (amount > current) await actor.update({ "system.attributes.hp.temp": amount });
            return amount > current ? `${target.name} has ${amount} temporary Hit Points${lasting}` : `${target.name} keeps its ${current} temporary Hit Points (more than ${amount})`;
        }
        case "affliction":
            return handOffAffliction(state, target, actor, change.data);
        // "…save or instantly die": at 0 HP and marked dead (the GM pressed Apply on the results).
        // (Batch 257: a second save for the creature, "… save or be exposed to its venom" — the poison's own card on it.)
        case "followUp": {
            const sourceActor = await fromUuid(state.source.actorUuid).catch(() => null);
            const sourceToken = state.source.tokenUuid ? await fromUuid(state.source.tokenUuid).catch(() => null) : null;
            const item = state.ability?.uuid ? await fromUuid(state.ability.uuid).catch(() => null) : null;
            if (!change.plan || !sourceActor || !token) return null;
            await postCard({ plan: change.plan, item: item ?? { name: state.ability?.name ?? change.plan.source?.name ?? "Follow-up", uuid: null }, sourceActor, sourceToken, tokens: [token.object ?? token] });
            return `${target.name}: its next save's card follows`;
        }
        case "death": {
            if (change.ifReducedTo !== undefined) return null;
            await actor.update({ "system.attributes.hp.value": 0 });
            if (!actor.statuses?.has?.("dead")) await actor.toggleStatusEffect?.("dead", { active: true, overlay: true });
            return null;
        }
        case "move":
            return forcedMove(state, target, token, change);
        case "note":
        default:
            return null;
    }
}

// A condition that lasts "until the end of the monster's next turn" and the
// like: an effect granting it, its duration counted on the monster's turns (as
// the spell module does): 0 rounds when the monster still acts this round, else 1.
// ("target-turn", the item module's bombs: counted on the creature's own turns, and it the effect's origin, so PF2e starts the effect at
// its initiative and ends a turn-start one on its turn.)
// (2026-10-20: duration.escape, an Escape that ends it early — flagged for scripts/escape.js; with mode "until-escape", no time of its own.
// recurring: a new save at its turns, src/live/recurring.js — flagged saveEnds for scripts/recurring.js; with no fixed time, until a save ends it.)
async function timedCondition(actor, slug, value, duration, state, { recurring = null } = {}) {
    const template = game.pf2e.ConditionManager.getCondition(slug);
    if (!template) return setCondition(actor, slug, value);
    const combat = game.combat;
    const timed = duration.mode === "fixed";
    const rounds = timed ? turnRounds(duration, duration.anchor === "target-turn" ? actor.uuid : duration.anchor === "source-turn" ? state.source.actorUuid : null) : -1;
    const origin = duration.anchor === "target-turn" ? actor.uuid : state.source.actorUuid;
    const label = `${template.name}${Number.isFinite(value) ? ` ${value}` : ""}`;
    await actor.createEmbeddedDocuments("Item", [{
        name: `${state.ability.name}: ${label}`,
        type: "effect",
        img: template.img,
        flags: { [MODULE_ID]: { timedCondition: { slug, sourceActorUuid: state.source.actorUuid }, ...(duration.escape ? { escape: { dc: Number(duration.escape.dc) } } : {}), ...(recurring ? { saveEnds: { ...recurring, slug, what: label }, ability: state.ability.name } : {}) } },
        system: {
            description: { value: `<p>${label} from <strong>${state.ability.name}</strong> (${state.source.name}).${escapeWords(duration.escape)}${recurringNote(recurring)}</p>` },
            duration: timed ? { value: rounds, unit: duration.unit, expiry: duration.expiry ?? "turn-start", sustained: false } : { value: -1, unit: "unlimited", expiry: null, sustained: false },
            start: { value: game.time.worldTime, initiative: combat?.started ? combat.combatant?.initiative ?? null : null },
            context: { origin: { actor: origin, item: state.ability.uuid }, target: { actor: actor.uuid }, roll: null },
            rules: [{ key: "GrantItem", uuid: template._stats?.compendiumSource ?? template.sourceId ?? template.uuid, flag: "condition", allowDuplicate: true, alterations: Number.isFinite(value) ? [{ mode: "override", property: "badge-value", value }] : [], onDeleteActions: { granter: "cascade", grantee: "cascade" } }]
        }
    }]);
}

// Rounds for a duration counted on one creature's turns (its actor's uuid): 0 when it still acts this round ("until the end of its
// turn" also during that turn), else 1; longer ones, or none in the encounter, as given.
function turnRounds(duration, anchorUuid) {
    const combat = game.combat;
    const rounds = Number(duration.value ?? 1);
    if (!anchorUuid || !combat?.started || duration.unit !== "rounds" || rounds > 1) return rounds;
    const position = combat.turns.findIndex((turn) => turn.actor?.uuid === anchorUuid);
    if (position < 0) return rounds;
    return (rounds === 0 && duration.expiry === "turn-end" ? position >= combat.turn : position > combat.turn) ? 0 : 1;
}

// A rule-less or modifier effect counted on the creature's own turns ("target-turn"): PF2e starts an effect at the current turn's
// initiative, so once made its start is the creature's (as the spell module's createNativeEffect does). It has no origin, so PF2e already
// ends a turn-start one on the creature's own turn.
async function anchorToTarget(created, actor, duration) {
    if (duration?.anchor !== "target-turn" || !game.combat?.started) return;
    const initiative = game.combat.turns.find((turn) => turn.actor?.uuid === actor.uuid)?.initiative;
    const effect = created?.[0];
    if (Number.isFinite(initiative) && effect && effect.system?.start?.initiative !== initiative) await effect.update({ "system.start.initiative": initiative });
}

// A penalty or bonus from the result (Bon Mot's -2 status to Perception and
// Will for 1 minute): a PF2e effect with that FlatModifier, for its duration.
// A PF2e effect item (an effect card's): a copy on the creature, its origin the monster and its ability, so PF2e
// counts "until the start of its next turn" on the monster's turns.
// (2026-10-20: its early end, from the plan's own entry for it — the core passes only its uuid and label: "or until it Escapes (DC 18)", flagged for
// scripts/escape.js; "or until it uses an Interact action …", in its description for the GM.)
// (2026-10-27, the item module's Static Snare: whilePersistent, a damage type — "for as long as the persistent electricity damage lasts":
// flagged so scripts/floors.js ends it with the creature's last persistent damage of that type; with none of it, no Effect.)
function nativeExtras(plan, uuid) {
    const seen = new Set();
    const walk = (node) => {
        if (!node || typeof node !== "object" || seen.has(node)) return null;
        seen.add(node);
        const own = Array.isArray(node.nativeEffects) ? node.nativeEffects.find((entry) => entry?.uuid === uuid && (entry.escape || entry.until || entry.whilePersistent)) : null;
        if (own) return own;
        for (const value of Object.values(node)) {
            const found = walk(value);
            if (found) return found;
        }
        return null;
    };
    return walk(plan);
}

async function nativeEffect(actor, effect, state, degree = null) {
    const template = await fromUuid(effect.uuid).catch(() => null);
    if (!template) return `${actor.name}: ${effect.label ?? "the effect"} wasn't found; apply it by hand.`;
    const source = template.toObject();
    delete source._id;
    const extras = nativeExtras(state.plan, effect.uuid);
    const lasting = extras?.whilePersistent ? String(extras.whilePersistent) : null;
    const label = effect.label ?? source.name ?? "the effect";
    if (lasting && !takesPersistent(actor, lasting)) return `${actor.name} takes no persistent ${lasting} damage, so it doesn't get ${label}`;
    if (extras) {
        const words = `${lasting ? ` It lasts while ${actor.name} takes persistent ${lasting} damage.` : ""}${extras.until ? ` It ends early once ${extras.until} (GM: delete this Effect then).` : ""}${escapeWords(extras.escape)}`;
        source.system.description = { ...(source.system.description ?? {}), value: `${source.system.description?.value ?? ""}<p>${words.trim()}</p>` };
    }
    // A choice of the save's result in the effect (PF2e's "Degree of success" prompt): the target's own, so no prompt.
    for (const rule of source.system?.rules ?? []) {
        if (rule?.key !== "ChoiceSet" || rule.selection !== undefined || !Array.isArray(rule.choices) || !degree) continue;
        const choice = rule.choices.find((entry) => new RegExp(`\\.${degree}$`).test(String(entry?.label ?? "")));
        if (choice) rule.selection = choice.value;
    }
    source._stats = { ...(source._stats ?? {}), compendiumSource: effect.uuid };
    source.system.context = { ...(source.system.context ?? {}), origin: { ...(source.system.context?.origin ?? {}), actor: state.source.actorUuid, token: state.source.tokenUuid ?? null, item: state.ability.uuid ?? null } };
    source.flags = { ...(source.flags ?? {}), [MODULE_ID]: { ...(source.flags?.[MODULE_ID] ?? {}), card: true, ...(Number(extras?.escape?.dc) > 0 ? { escape: { dc: Number(extras.escape.dc) } } : {}), ...(lasting ? { whilePersistent: lasting } : {}) } };
    await actor.createEmbeddedDocuments("Item", [source]);
    return lasting ? `${actor.name}'s ${label} lasts while it takes persistent ${lasting} damage` : null;
}

// A note Effect (batch 274): what the module can't play, on the creature as a rule-less Effect that says it (Rescue's "inside the carriage", Arcane
// Harmony's choice for the next spell), lasting as the note says (until removed when it doesn't).
async function noteEffect(actor, note, state) {
    if (!note?.text) return null;
    // (2026-10-27, Static Snare's critical failure: whilePersistent, as a PF2e Effect's — nativeExtras.)
    const lasting = note.whilePersistent ? String(note.whilePersistent) : null;
    if (lasting && !takesPersistent(actor, lasting)) return `${actor.name} takes no persistent ${lasting} damage, so it doesn't get "${note.label ?? "the note"}"`;
    const found = note.saveEnds ? recurringSpec(note.saveEnds, planDC(state)) : null;
    const recurring = found ? { ...found, ...(found.mode === "escalate" ? { mode: "end" } : {}) } : null;
    // (2026-10-27, the item module's Timeflaying Blade: a time the text rolls, duration.valueRoll "1d4" — rolled here, its roll in the chat.)
    const timeRoll = note.duration?.mode === "fixed" && typeof note.duration.valueRoll === "string" && note.duration.valueRoll.trim() ? await new Roll(note.duration.valueRoll).evaluate() : null;
    if (timeRoll) await timeRoll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `${state.ability.name}: ${note.label ?? "its"} time for ${actor.name} (${note.duration.valueRoll} ${note.duration.unit})` });
    const timed = timeRoll ? { ...note.duration, value: Math.max(1, Number(timeRoll.total) || 1) } : note.duration;
    const duration = timed?.mode === "fixed" ? { value: timed.anchor === "target-turn" ? turnRounds(timed, actor.uuid) : timed.value, unit: timed.unit, expiry: timed.expiry ?? "turn-start", sustained: false } : { value: -1, unit: "unlimited", expiry: null, sustained: false };
    // (2026-10-27: note.escape { dc }, Halcyon Heart's — a successful Escape at that DC ends it too, scripts/escape.js; note.whileInside, a zone's
    // save row's — gone when the creature leaves the zone it came from, scripts/zones.js.)
    const escapeDC = Number(note.escape?.dc) > 0 ? Number(note.escape.dc) : null;
    const inside = note.whileInside && state.zone ? state.zone : null;
    const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
    const created = await actor.createEmbeddedDocuments("Item", [{
        name: `${state.ability.name}: ${note.label ?? "note"}`,
        type: "effect",
        img: "icons/svg/book.svg",
        // (2026-10-20: a note Effect may carry PF2e's own rules — a misfortune's RollTwice, Concealed while Invisible — then it's a real one; once:
        // for one roll, gone after it, scripts/escape.js.)
        // (2026-10-20: note.saveEnds, a new save at its turns that ends it — src/live/recurring.js, scripts/recurring.js.)
        flags: { [MODULE_ID]: { note: { source: state.source.actorUuid }, ...(note.once ? { once: true } : {}), ...(recurring ? { saveEnds: { ...recurring, what: note.label ?? "the effect" }, ability: state.ability.name } : {}), ...(lasting ? { whilePersistent: lasting } : {}), ...(escapeDC ? { escape: { dc: escapeDC } } : {}), ...(inside ? { whileInside: inside } : {}) } },
        system: {
            description: { value: `<p>${escape(note.text)}${escape(recurringNote(recurring))}</p>${lasting && !/\bpersistent\b/i.test(note.text) ? `<p>It lasts while taking persistent ${escape(lasting)} damage.</p>` : ""}${escapeDC ? `<p>${escape(escapeWords({ dc: escapeDC }).trim())}</p>` : ""}${inside ? "<p>It lasts while it stays inside the area.</p>" : ""}<p>From <strong>${escape(state.ability.name)}</strong> (${escape(state.source.name)}).</p>` },
            duration,
            start: { value: game.time.worldTime, initiative: game.combat?.started ? game.combat.combatant?.initiative ?? null : null },
            rules: (Array.isArray(note.rules) ? note.rules : []).filter((rule) => rule && typeof rule.key === "string").map((rule) => structuredClone(rule))
        }
    }]);
    await anchorToTarget(created, actor, timed);
    if (timeRoll) return `${actor.name}'s "${note.label ?? "note"}" lasts ${duration.value} ${duration.value === 1 ? String(duration.unit).replace(/s$/, "") : duration.unit} (${note.duration.valueRoll} rolled)`;
    return lasting ? `${actor.name}'s "${note.label ?? "note"}" lasts while it takes persistent ${lasting} damage` : null;
}

// (Batch 275, Gauge Potential: a bonus against one creature only — PF2e's TokenMark on that creature's token; attack and damage rolls predicated
// on target:mark, AC and saves on origin:mark.)
// (2026-10-20: modifier.against "others" — "attack rolls against creatures other than you": the source's token marked, the modifier on every
// attack but those against it; modifier.escape, ended by a successful Escape (scripts/escape.js); modifier.until, how it ends early, the GM's.)
async function penaltyEffect(actor, modifier, state, against = null) {
    const others = modifier.against === "others";
    const marked = against ? (await targetOf(state, against)).token ?? null : others ? (await targetOf(state, "source")).token ?? null : null;
    const slug = marked ? `aar-${String(state.ability.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${marked.id}`.toLowerCase() : null;
    const outgoing = /^(?:attack|damage|strike|ranged-attack|melee-attack)/.test(String(modifier.selector));
    const duration = modifier.duration?.mode === "fixed" ? { value: modifier.duration.anchor === "target-turn" ? turnRounds(modifier.duration, actor.uuid) : modifier.duration.value, unit: modifier.duration.unit, expiry: modifier.duration.expiry ?? "turn-start", sustained: false } : { value: -1, unit: "unlimited", expiry: null, sustained: false };
    const sign = modifier.value > 0 ? "+" : "−";
    const what = modifierTarget(modifier, marked?.name ?? state.source.name);
    const ends = modifier.until ? ` It ends early once ${modifier.until} (GM: delete this Effect then).` : "";
    const created = await actor.createEmbeddedDocuments("Item", [{
        name: `${state.ability.name}: ${sign}${Math.abs(modifier.value)} to ${what}${marked && !others ? ` against ${marked.name}` : ""}`,
        type: "effect",
        img: "icons/svg/downgrade.svg",
        flags: { [MODULE_ID]: { modifier: { selector: modifier.selector, source: state.source.actorUuid }, ...(Number(modifier.escape?.dc) > 0 ? { escape: { dc: Number(modifier.escape.dc) } } : {}) } },
        system: {
            description: { value: `<p>${sign}${Math.abs(modifier.value)} ${modifier.type} to ${what}, from <strong>${state.ability.name}</strong> (${state.source.name}).${ends}${escapeWords(modifier.escape)}</p>` },
            duration,
            start: { value: game.time.worldTime, initiative: game.combat?.started ? game.combat.combatant?.initiative ?? null : null },
            rules: slug
                ? [{ key: "TokenMark", slug, uuid: marked.uuid }, { key: "FlatModifier", selector: modifier.selector, type: modifier.type ?? "untyped", value: modifier.value, predicate: [others ? { not: `target:mark:${slug}` } : `${outgoing ? "target" : "origin"}:mark:${slug}`, ...(modifier.predicate ?? [])] }]
                // (Batch 280, Divine Aegis: a modifier only against some effects — its predicate.)
                : [{ key: "FlatModifier", selector: modifier.selector, type: modifier.type ?? "untyped", value: modifier.value, ...(modifier.predicate?.length ? { predicate: modifier.predicate } : {}) }]
        }
    }]);
    await anchorToTarget(created, actor, modifier.duration);
    return null;
}

// Off-guard to one creature only (Feint, Create a Diversion): an effect on the
// creature whose attacks benefit, marking the target's token (PF2e's
// TokenMark, as Hunt Prey does) and making the marked target off-guard to its
// Strikes (melee ones only for Feint), for the duration.
async function scopedOffGuard(state, change) {
    const { actor: attacker } = await targetOf(state, change.scope.attacker);
    const markedId = change.target;
    const { target: marked, token } = await targetOf(state, markedId);
    const offGuard = game.pf2e.ConditionManager.getCondition("off-guard");
    if (!attacker || !token || !offGuard) return `${marked?.name ?? "The target"} is off-guard to ${attacker?.name ?? "one creature"}'s attacks (apply by hand).`;
    const slug = `aar-${state.ability.slug ?? "mark"}-${token.id}`.toLowerCase();
    const duration = change.duration?.mode === "fixed" ? change.duration : { value: 0, unit: "rounds", expiry: "turn-end" };
    const rounds = duration.value === 0 ? 0 : 1;
    await attacker.createEmbeddedDocuments("Item", [{
        name: `${state.ability.name}: ${marked.name} is off-guard to you`,
        type: "effect",
        img: offGuard.img,
        flags: { [MODULE_ID]: { scopedOffGuard: { target: token.uuid, melee: change.scope.attacks === "melee", uses: change.scope.uses ?? null } } },
        system: {
            description: { value: `<p>${marked.name} is off-guard to your ${change.scope.attacks === "melee" ? "melee Strikes" : "attacks"}${change.scope.uses === 1 ? " (your next one)" : ""}.</p>` },
            duration: { value: rounds, unit: "rounds", expiry: duration.expiry ?? "turn-end", sustained: false },
            start: { value: game.time.worldTime, initiative: game.combat?.started ? game.combat.combatant?.initiative ?? null : null },
            rules: [
                { key: "TokenMark", slug, uuid: token.uuid },
                { key: "EphemeralEffect", affects: "target", selectors: change.scope.attacks === "melee" ? ["melee-strike-attack-roll"] : ["strike-attack-roll", "spell-attack-roll"], uuid: offGuard._stats?.compendiumSource ?? offGuard.sourceId ?? offGuard.uuid, predicate: [{ or: [`target:mark:${slug}`, `self:mark:${slug}`] }] }
            ]
        }
    }]);
    return null;
}

// A Feint's success lasts for one melee attack: the attacker's next Strike at
// the marked creature (melee, if only melee counts) spends it (active GM only).
async function spendOffGuard(message) {
    const context = message.flags?.pf2e?.context;
    if (context?.type !== "attack-roll" || !context.target?.token) return;
    const attacker = message.actor ?? game.actors.get(message.speaker?.actor);
    const spent = (attacker?.itemTypes?.effect ?? []).filter((effect) => {
        const scoped = effect.flags?.[MODULE_ID]?.scopedOffGuard;
        if (!scoped || scoped.uses !== 1 || scoped.target !== context.target.token) return false;
        return !scoped.melee || (context.options ?? []).includes("item:melee");
    });
    if (spent.length) await attacker.deleteEmbeddedDocuments("Item", spent.map((effect) => effect.id));
}

// Disarm: a success weakens the grip (PF2e's own Effect: Disarm (Success), which
// asks which weapon); a critical success knocks the target's weapon out of its hands.
async function disarm(actor, effect, target) {
    if (effect.what === "weaken") {
        const source = await fromUuid("Compendium.pf2e.other-effects.Item.PuDS0DEq0CnaSIFV");
        if (source) await actor.createEmbeddedDocuments("Item", [source.toObject()]);
        return source ? null : `${target.name}'s grip is weakened (−2 to attacks with it; apply by hand).`;
    }
    const weapon = actor.itemTypes.weapon?.filter((item) => item.isHeld && item.category !== "unarmed").sort((a, b) => (b.system.bonus?.value ?? 0) - (a.system.bonus?.value ?? 0))[0];
    if (!weapon) return `${target.name} has no weapon in hand to drop.`;
    await weapon.update({ "system.equipped.carryType": "dropped", "system.equipped.handsHeld": 0 });
    return `${target.name} drops ${weapon.name}`;
}

// A push or pull: the token moves square by square away from (or toward) the
// monster, stopped by walls and the scene's edge (the core's forced movement).
async function forcedMove(state, target, token, change) {
    const mover = game.modules.get(CORE_ID)?.api?.forcedMovement;
    // (Measured from the card's moveFrom token when it has one — postCard's —, else its source.)
    const origin = state.moveFrom ?? state.source.tokenUuid;
    const source = origin ? await fromUuid(origin).catch(() => null) : null;
    if (!mover || !token || !source) return `${target.name}: move the token ${change.distance} feet by hand.`;
    const size = source.parent?.grid?.size ?? canvas.grid.size;
    const point = { x: source.x + Number(source.width ?? 1) * size / 2, y: source.y + Number(source.height ?? 1) * size / 2 };
    const result = await mover.forcedMove(token, { point, direction: change.kind === "pull" ? "toward" : "away", feet: change.distance, stopAt: change.kind === "pull" ? source : null, reason: state.ability.name });
    if (!result.moved) return `${target.name} couldn't be moved (${result.stoppedBy ?? result.reason}).`;
    return result.stoppedBy && result.stoppedBy !== "occupied" ? `${target.name} was stopped by ${result.stoppedBy === "wall" ? "a wall" : result.stoppedBy === "edge" ? "the scene's edge" : "a creature"}.` : null;
}

// What both hits bring, in words: "it is Slowed 1 for 1 round and takes 1d8[persistent,bleed] damage".
function bothHitText(rider) {
    const conditions = (rider.conditions ?? []).map((entry) => `${entry.slug.replace(/^\w/, (letter) => letter.toUpperCase())}${Number.isFinite(entry.value) ? ` ${entry.value}` : ""}${entry.rounds ? ` for ${entry.rounds} round${entry.rounds === 1 ? "" : "s"}` : ""}`);
    const damage = (rider.damage ?? []).map((formula) => `${formula} damage`);
    // (Batch 87, Dual Disarm: a basic action at it; batch 198, Gory Rend: its affliction.)
    return [conditions.length ? `it is ${conditions.join(" and ")}` : null, damage.length ? `it takes ${damage.join(" and ")}` : null, rider.affliction ? `it is exposed to ${rider.affliction} (its card from the sheet)` : null, rider.follow ? `the attacker can attempt to ${rider.follow.replace(/^\w/, (letter) => letter.toUpperCase())} it` : null, rider.strikeDamage ? `it takes extra damage equal to one ${rider.strikeDamage} Strike (roll its damage again)` : null].filter(Boolean).join(", and ");
}

// A condition at least at this value (PF2e's conditions take the higher value, not the sum).
// (2026-10-20) The plan's own DC, for a repeated save whose dc is null: its card's, else its check's fixed one.
const planDC = (state) => Number(state.check?.dc ?? state.plan?.resolution?.check?.against?.value) || null;

// (2026-10-20) An escalating condition's saves (src/live/recurring.js mode "escalate"): a rule-less Effect on the creature that keeps them, flagged
// saveEnds with the condition it steps (scripts/recurring.js); gone with the condition.
async function saveTracker(actor, slug, recurring, state) {
    const label = game.pf2e.ConditionManager.getCondition(slug)?.name ?? slug;
    await actor.createEmbeddedDocuments("Item", [{
        name: `${state.ability.name}: ${label} saves`,
        type: "effect",
        img: "icons/svg/dice-target.svg",
        flags: { [MODULE_ID]: { saveEnds: { ...recurring, condition: slug, what: label }, ability: state.ability.name } },
        system: {
            description: { value: `<p>${label} from <strong>${state.ability.name}</strong> (${state.source.name}).${recurringNote(recurring)}</p>` },
            duration: { value: -1, unit: "unlimited", expiry: null, sustained: false },
            start: { value: game.time.worldTime, initiative: game.combat?.started ? game.combat.combatant?.initiative ?? null : null },
            rules: []
        }
    }]);
}

async function setCondition(actor, slug, value) {
    const existing = actor.itemTypes.condition.find((condition) => condition.slug === slug && condition.active);
    if (existing) {
        if (Number.isFinite(value) && (existing.value ?? 0) < value) await game.pf2e.ConditionManager.updateConditionValue(existing.id, actor, value);
        return;
    }
    await actor.increaseCondition(slug, Number.isFinite(value) ? { value } : {});
}

// (Batch 311) "; a new Fortitude save at the end of each of its turns ends it (DC 34, 1 lower each time)".
function saveEndsText(change) {
    const ends = change.duration?.saveEnds;
    if (!ends) return "";
    const spec = recurringSpec(ends, Number(ends.dc) || null);
    if (spec) return `; ${recurringWords(spec)}`;
    return `; a new ${ends.save ? ends.save[0].toUpperCase() + ends.save.slice(1) : ""} save at the end of each of its turns ends it (DC ${ends.dc}${ends.drop ? `, ${ends.drop} lower each time` : ""})`;
}

function durationText(duration, source, target = null) {
    if (duration.anchor === "target-turn" && target) source = target;
    // Minutes and longer: the time itself ("1 minute"); the monster's turns only count rounds.
    if (duration.unit && duration.unit !== "rounds") return `${duration.value} ${duration.value === 1 ? duration.unit.replace(/s$/, "") : duration.unit}`;
    // (More than a round, batch 28's Golem Antimagic: "until the end of its turn in 6 rounds".)
    if (duration.expiry === "turn-end") return duration.value === 0 ? `until the end of ${source}'s turn` : duration.value > 1 ? `until the end of ${source}'s turn in ${duration.value} rounds` : `until the end of ${source}'s next turn`;
    if (duration.expiry === "turn-start") return `until the start of ${source}'s turn ${duration.value === 1 ? "next round" : `in ${duration.value} rounds`}`;
    return `${duration.value} ${duration.unit}`;
}

// A creature afflicted by a monster's poison or disease: Pseudo Afflictions
// tracks it from the affliction item, as for the spell module's afflictions.
async function handOffAffliction(state, target, actor, data) {
    if (game.modules.get(AFFLICTIONS)?.active !== true) return `${target.name}: Pseudo Afflictions isn't active, so track ${data?.name ?? "the affliction"} by hand (stage ${data?.stage ?? 1}).`;
    const ability = itemOnly(state.ability.uuid ? await fromUuid(state.ability.uuid).catch(() => null) : null);
    const source = await fromUuid(state.source.actorUuid);
    // (Live check of batch 257: an exposure that another ability brings, Spit Venom's jungle drake venom, goes on with the affliction's own item,
    // whose stages Pseudo Afflictions reads; the ability's text has none.)
    const own = (entry) => entry !== ability && String(entry.name ?? "").toLowerCase() === String(data?.name ?? "").toLowerCase() && /Stage\s*1/i.test(entry.system?.description?.value ?? "");
    // (2026-10-27, the item module's Kraken Bottle: an affliction item named by its uuid in the hand-off — a zone's save, whose item isn't it.)
    const named = data?.uuid ? await fromUuid(data.uuid).catch(() => null) : null;
    // (2026-10-29: a card with no item of its own, an environment's or an Effect's save, still asks Pseudo Afflictions by the affliction's name
    // and builds the Effect from the hand-off when it makes nothing.)
    const item = named ?? (data?.name ? source?.items?.find?.(own) : null) ?? ability;
    // (2026-10-27, the item module's Horn of Rust: Pseudo Afflictions finds an affliction by the item's slug, its name, or the DC's label — the
    // affliction's own name in it, "Tetanus DC", when the hand-off names one. When it makes nothing, the card says to track it by hand.)
    const name = data?.name ?? state.ability.name;
    const dc = data?.dc ?? state.check.dc;
    const made = pseudoAfflictionMade(actor, 2000);
    Hooks.callAll(`${AFFLICTIONS}.processMessage`, {
        actor,
        item: item ?? { name, slug: null },
        speaker: { actor: source?.id ?? null },
        flags: { pf2e: { context: { type: "saving-throw", outcome: target.degree, dc: { value: dc, label: `${name} DC` } } } },
        getRollData: () => item?.getRollData?.() ?? {}
    }, {}, game.userId);
    if (await made) return null;
    const held = (actor.itemTypes?.effect ?? []).find((effect) => isPseudoAffliction(effect) && String(effect.name).toLowerCase().includes(String(name).toLowerCase()));
    // (2026-10-29, the item module's Horn of Rust: one Pseudo Afflictions has no Effect for, its own built from the hand-off's stages — src/live/
    // afflictions.js — which Pseudo Afflictions runs from there. Exposed again while it has it: a poison's stage on, as Pseudo Afflictions' own.)
    if (held?.flags?.[MODULE_ID]?.affliction) {
        const next = exposedAgain(held, target.degree);
        if (next) await held.update({ "system.badge.value": next });
        return next ? `${target.name}'s ${held.name} goes to ${held.system?.badge?.labels?.[next - 1] ?? `stage ${next}`}` : `${target.name} already has ${held.name}`;
    }
    if (held) return `${target.name} already has ${held.name}`;
    const conditions = game.pf2e?.ConditionManager;
    const built = pseudoAfflictionSource(data, { name, dc, level: data?.level ?? item?.level ?? item?.system?.level?.value ?? source?.level, img: item?.img ?? null, effectTraits: Object.keys(CONFIG.PF2E?.effectTraits ?? {}), isCondition: (slug) => !conditions?.getCondition || Boolean(conditions.getCondition(slug)), moduleId: MODULE_ID });
    if (built) {
        const [effect] = await actor.createEmbeddedDocuments("Item", [built]);
        if (effect) return `${target.name}: ${effect.name}, ${effect.system?.badge?.labels?.[(Number(effect.system?.badge?.value) || 1) - 1] ?? "stage 1"} (Pseudo Afflictions runs it from here)`;
    }
    return `${target.name}: Pseudo Afflictions has nothing for ${name}; track it by hand (stage ${data?.stage ?? 1}, DC ${dc}).`;
}

// A Pseudo Afflictions Effect: its own flag, or one from its compendium.
const isPseudoAffliction = (item) => item?.type === "effect" && (!!item.flags?.[AFFLICTIONS] || String(item._stats?.compendiumSource ?? item.sourceId ?? "").startsWith(`Compendium.${AFFLICTIONS}.`));

// Whether Pseudo Afflictions makes or changes an Effect on the creature within `ms` (it works on its own hook, unawaited).
function pseudoAfflictionMade(actor, ms) {
    return new Promise((resolve) => {
        const mine = (item) => isPseudoAffliction(item) && (item.parent === actor || item.parent?.uuid === actor.uuid);
        const done = (result) => {
            Hooks.off("createItem", created);
            Hooks.off("updateItem", updated);
            clearTimeout(timer);
            resolve(result);
        };
        const created = (item) => mine(item) && done(true);
        const updated = (item) => mine(item) && done(true);
        Hooks.on("createItem", created);
        Hooks.on("updateItem", updated);
        const timer = setTimeout(() => done(false), ms);
    });
}

// --- Styles ---------------------------------------------------------------------

function injectStyles() {
    if (document.getElementById(`${MODULE_ID}-styles`)) return;
    const style = document.createElement("style");
    style.id = `${MODULE_ID}-styles`;
    style.textContent = `
.pf2e-aar-card header { display: flex; flex-wrap: wrap; gap: 0.25rem 0.5rem; align-items: baseline; margin-bottom: 0.25rem; }
.pf2e-aar-card .aar-check, .pf2e-aar-card .aar-rider { font-size: 0.85em; opacity: 0.8; }
.pf2e-aar-card ul { list-style: none; margin: 0.25rem 0; padding: 0; }
.pf2e-aar-card .aar-target { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; padding: 0.15rem 0; border-bottom: 1px solid rgba(0,0,0,0.1); }
.pf2e-aar-card .aar-target button { flex: 0 0 auto; width: auto; line-height: 1.4; padding: 0 0.5rem; }
.pf2e-aar-card .aar-criticalSuccess { color: #2e7d32; font-weight: bold; }
.pf2e-aar-card .aar-success { color: #388e3c; }
.pf2e-aar-card .aar-failure { color: #c62828; }
.pf2e-aar-card .aar-criticalFailure { color: #b71c1c; font-weight: bold; }
.pf2e-aar-card .aar-controls { display: flex; gap: 0.25rem; margin-top: 0.25rem; }
.pf2e-aar-card .aar-applied li { font-size: 0.9em; }
.pf2e-aar-card .aar-hint { font-size: 0.9em; font-style: italic; }
.pf2e-aar-card .aar-warning { margin: 0.25rem 0; font-size: 0.9em; font-weight: bold; color: #b26a00; }
.pf2e-aar-card .aar-actions { display: flex; align-items: center; gap: 0.25rem; margin: 0.25rem 0; font-size: 0.9em; }
.pf2e-aar-card .aar-actions button { flex: 0 0 auto; width: auto; line-height: 1.4; padding: 0 0.6rem; }
.pf2e-aar-card .aar-actions button.aar-chosen { font-weight: bold; opacity: 1; box-shadow: 0 0 0 2px #b26a00 inset; }
.pf2e-aar-card .aar-modes { display: flex; flex-wrap: wrap; gap: 0.25rem; }
.pf2e-aar-card .aar-notes { margin: 0.25rem 0; padding-left: 1.1rem; font-size: 0.9em; }
.pf2e-aar-card .aar-cast { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem; }
.pf2e-aar-card .aar-cast label { display: flex; align-items: center; gap: 0.2rem; flex: 0 0 auto; }
.pf2e-aar-card .aar-cast input { width: 3.2rem; }
.pf2e-aar-card .aar-cast button { flex: 1 1 auto; }`;
    document.head.append(style);
}
