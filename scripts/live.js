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

import { allRolled, cardCheck, cardHTML, changeLines, createCard, createCastCard, createEffectCard, createModeCard, parseIdentifier, recordRoll, rollIdentifier, statisticLabel } from "../src/live/card.js";
import { immunityApplies, immunityEffect, isImmune } from "../src/live/auras.js";
import { activityRider, fitsSize, strikeMatches } from "../src/live/activity.js";
import { damageNote, hitSetsOff, ownStrikeSetsOff } from "../src/live/reactions.js";
import { distanceFeet } from "../../pf2e-resolution-core/src/model/grid.js";
import { box, gridOf } from "./auras.js";
import { applySwallow } from "./swallow.js";
import { applyAuraCondition } from "./auras.js";
import { noteToGM, rechargeFormula, rechargeWarning, startRecharge } from "./recharge.js";

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
    Hooks.on("createChatMessage", (message) => {
        if (!isActiveGM()) return;
        recordResult(message).catch((error) => console.error(`${MODULE_ID} | recording a roll`, error));
        cardForAbility(message).catch((error) => console.error(`${MODULE_ID} | ability card`, error));
        cardsForRiders(message).catch((error) => console.error(`${MODULE_ID} | rider card`, error));
        cardsForHitBy(message).catch((error) => console.error(`${MODULE_ID} | hit-by card`, error));
        cardsForTargeted(message).catch((error) => console.error(`${MODULE_ID} | targeted card`, error));
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
    if (check?.kind === "check") entry.dc = actor.getStatistic?.(check.against)?.dc?.value ?? null;
    return entry;
}

// A target of an effect card: on the user's side or not (its token's disposition).
function effectTarget(token, sourceToken) {
    const disposition = (token.document ?? token).disposition;
    return { actorUuid: token.actor.uuid, tokenUuid: token.document?.uuid ?? token.uuid ?? null, name: token.name ?? token.actor.name, allied: !!sourceToken && disposition === (sourceToken.document ?? sourceToken).disposition };
}

export async function postCard({ plan, item, sourceActor, sourceToken, tokens, rider = null, cause = null, aura = null, warning = null }) {
    const check = cardCheck(plan);
    if (!check) return null;
    const state = createCard({
        plan,
        ability: { name: item.name, uuid: item.uuid },
        source: { actorUuid: sourceActor.uuid, tokenUuid: sourceToken?.uuid ?? null, name: sourceToken?.name ?? sourceActor.name },
        targets: tokens.map((token) => targetEntry(token, check)),
        rider,
        cause,
        aura,
        warning
    });
    return ChatMessage.create({
        content: cardHTML(state),
        speaker: ChatMessage.getSpeaker({ actor: sourceActor, token: sourceToken ?? undefined }),
        flags: { [MODULE_ID]: { [FLAG]: state } }
    });
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
    const formula = rechargeFormula(item, plan);
    // Used again while it recharges: the card says so (the GM decides).
    const warning = formula ? rechargeWarning(item.actor, item.name) : null;
    if (plan?.resolution && (plan.trigger?.event ?? "use") === "use" && cardCheck(plan)) {
        await postCard({ plan, item, sourceActor: item.actor, sourceToken, tokens: [...game.user.targets], warning });
        return;
    }
    // A PF2e effect on itself, its allies or a target (Battle Cry, Fiery Rhetoric): the card applies it. Not its own
    // self effect, which PF2e's card already applies.
    if (plan?.resolution?.kind === "effect" && (plan.trigger?.event ?? "use") === "use" && !plan.resolution.applications.every((application) => application.selfEffect)) {
        const state = createEffectCard({
            plan,
            ability: { name: item.name, uuid: item.uuid },
            source: { actorUuid: item.actor.uuid, tokenUuid: sourceToken?.uuid ?? null, name: sourceToken?.name ?? item.actor.name },
            targets: [...game.user.targets].map((token) => effectTarget(token, sourceToken)),
            warning
        });
        if (state) await ChatMessage.create({ content: cardHTML(state), speaker: ChatMessage.getSpeaker({ actor: item.actor, token: sourceToken ?? undefined }), flags: { [MODULE_ID]: { [FLAG]: state } } });
        return;
    }
    // Used in one of several ways (two breath weapons): the GM picks the way on the card.
    if (plan?.builtin === "modes" && plan.modes.some((mode) => mode.plan && (mode.plan.trigger?.event ?? "use") === "use" && cardCheck(mode.plan))) {
        const state = createModeCard({
            modes: plan.modes,
            ability: { name: item.name, uuid: item.uuid },
            source: { actorUuid: item.actor.uuid, tokenUuid: sourceToken?.uuid ?? null, name: sourceToken?.name ?? item.actor.name },
            targets: [...game.user.targets].map((token) => targetEntry(token, null)),
            warning
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
    // A Strike activity with more on a hit (Intimidating Strike): its results wait for the creature's Strike.
    if (plan?.builtin === "strike-activity" && activityRider(plan)) pendingActivities.set(item.actor.uuid, { item, plan, token: sourceToken, at: Date.now() });
    // It casts a spell or has its effects (Dominate, Turn to Mist): a card to cast it through PF2e, at the ability's rank and DC.
    if (plan?.builtin === "cast-spell") {
        const spell = await fromUuid(plan.spell.uuid).catch(() => null);
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

// A monster's or a hazard's Strike that hits and lists riders (Grab, Knockdown, Push, a venom): a card for each. The Strike of
// a Strike activity used just before: a card with the activity's results on a hit.
async function cardsForRiders(message) {
    const context = message.flags?.pf2e?.context;
    if (context?.type !== "attack-roll") return;
    const strike = message.flags?.pf2e?.origin?.uuid ? await fromUuid(message.flags.pf2e.origin.uuid) : null;
    const actor = strike?.actor;
    if (!actor || !["npc", "hazard"].includes(actor.type)) return;
    const hit = ["success", "criticalSuccess"].includes(context.outcome);
    const targetToken = context.target?.token ? await fromUuid(context.target.token) : null;
    const target = targetToken?.object ?? targetToken;
    // (The activity's Strike, hit or miss, uses it up.)
    const pending = pendingActivities.get(actor.uuid);
    if (pending && Date.now() - pending.at > ACTIVITY_WAIT) pendingActivities.delete(actor.uuid);
    else if (pending && strikeMatches(pending.plan, strike)) {
        pendingActivities.delete(actor.uuid);
        if (hit && target?.actor) await activityCard(message, pending, { actor, strike, target, targetToken, context });
    }
    // Its passives its own Strike sets off ("When the gunmarshal makes a critical hit with a firearm, …"; batch 19): on the
    // creature it hit.
    if (hit && target?.actor) {
        await ready;
        for (const item of actor.itemTypes.action) {
            const plan = compile(item);
            if (plan?.trigger?.reaction || !ownStrikeSetsOff(plan?.trigger, { outcome: context.outcome, strikeName: strike.name, options: context.options ?? [] }) || !plan.resolution || !cardCheck(plan)) continue;
            await postCard({ plan, item, sourceActor: actor, sourceToken: message.token ?? null, tokens: [target], rider: { strikeName: strike.name, cost: "free" } });
        }
    }
    const effects = strike?.system?.attackEffects?.value ?? [];
    if (!hit || !effects.length || !target?.actor) return;
    await ready;
    for (const item of actor.itemTypes.action) {
        const plan = compile(item);
        const trigger = plan?.trigger;
        if (trigger?.event !== "strike" || !(effects.includes(trigger.attackEffect) || effects.includes(plan.source?.slug))) continue;
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
        const tokens = plan.targeting?.target === "the attacker" ? [attacker] : plan.targeting?.area?.type === "emanation" ? tokensAround(targetToken, Number(plan.targeting.area.value) || 0) : [];
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
        const tokens = plan.targeting?.target === "the attacker" ? (attacker && attacker.id !== token?.id ? [attacker.object ?? attacker] : []) : plan.targeting?.area?.type === "emanation" ? tokensAround(token, Number(plan.targeting.area.value) || 0) : [];
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
        return defender && message.token ? { defender, attacker: message.token, traits, spell } : null;
    }
    if (context.type === "saving-throw" && !options.some((option) => /^item:area\b|^area-effect$/.test(option))) {
        const attacker = context.origin?.token ? await fromUuid(context.origin.token) : null;
        return attacker && message.token && attacker.id !== message.token.id ? { defender: message.token, attacker, traits, spell } : null;
    }
    return null;
}

// Does the event set off this trigger ("targets the hound with a mental effect", "… or spell")?
export const targetedSetsOff = (trigger, event) => trigger?.event === "targeted-by" && ((trigger.traits ?? []).some((trait) => event.traits.includes(trait)) || (trigger.spells && event.spell));

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
    const deaths = actor.itemTypes.action.map((item) => ({ item, plan: compile(item) })).filter(({ plan }) => plan?.trigger?.event === "death" && plan.resolution && cardCheck(plan));
    if (!deaths.length) return;
    recentDeaths.set(actor.uuid, Date.now());
    const token = actor.getActiveTokens(true, true)[0] ?? null;
    for (const { item, plan } of deaths) await postCard({ plan, item, sourceActor: actor, sourceToken: token, tokens: tokensAround(token, Number(plan.targeting?.area?.value) || 0), cause: "as it dies" });
}

// The creatures (on either side) within radius feet of the token's space, measured as auras are.
export function tokensAround(token, radius) {
    const scene = token?.parent;
    const grid = scene ? gridOf(scene) : null;
    if (!grid || !radius) return [];
    return scene.tokens.filter((other) => other.id !== token.id && other.actor?.isOfType?.("creature") && !other.hidden && !(other.actor.isDead ?? false) && distanceFeet(box(token, grid.size), box(other, grid.size), grid) <= radius).map((other) => other.object ?? other);
}

// A Strike activity's results on the creature its Strike hit: the activity's save to roll, or its results by the Strike's own
// degree (recorded, as a skill action's roll is) for the GM's Apply.
async function activityCard(message, pending, { actor, strike, target, targetToken, context }) {
    const rider = activityRider(pending.plan);
    if (!rider) return;
    const sourceToken = message.token ?? pending.token ?? null;
    if (rider.save) {
        if (!fitsSize(target.actor.size, rider.size)) return;
        await postCard({ plan: rider.save, item: pending.item, sourceActor: actor, sourceToken, tokens: [target], rider: { strikeName: strike.name, cost: "activity" } });
        return;
    }
    const state = createCard({
        plan: rider.plan,
        ability: { name: pending.item.name, uuid: pending.item.uuid },
        source: { actorUuid: actor.uuid, tokenUuid: sourceToken?.uuid ?? null, name: sourceToken?.name ?? actor.name },
        targets: [{ actorUuid: target.actor.uuid, tokenUuid: targetToken.uuid, name: target.name ?? target.actor.name, dc: context.dc?.value ?? null }],
        rider: { strikeName: strike.name, cost: "activity" }
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

async function rollTarget(message, target) {
    const state = stateOf(message);
    const actor = await fromUuid(target.actorUuid);
    const source = await fromUuid(state.source.actorUuid);
    const item = state.ability.uuid ? await fromUuid(state.ability.uuid) : null;
    const identifier = rollIdentifier(message.id, target.id);
    if (state.check.kind === "save") {
        const statistic = actor?.getStatistic?.(state.check.statistic);
        if (!statistic) throw new Error(`${target.name} has no ${statisticLabel(state.check.statistic)} save.`);
        return statistic.roll({ dc: { value: state.check.dc, label: `${state.ability.name} DC` }, identifier, skipDialog: true, item, origin: source });
    }
    const statistic = source?.getStatistic?.(state.check.statistic);
    if (!statistic) throw new Error(`${state.source.name} has no ${statisticLabel(state.check.statistic)}.`);
    if (!Number.isFinite(target.dc)) throw new Error(`${target.name}'s ${statisticLabel(state.check.against)} DC is unknown.`);
    return statistic.roll({ dc: { value: target.dc, label: `${target.name}'s ${statisticLabel(state.check.against)} DC` }, identifier, skipDialog: true, item });
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
    if (!mode.plan) {
        const lines = [`${name}: resolve it by hand.`];
        const item = state.ability.uuid ? await fromUuid(state.ability.uuid).catch(() => null) : null;
        const formula = item ? rechargeFormula(item) : null;
        if (item && formula) lines.push(await startRecharge({ actor: item.actor, item, formula, tokenUuid: state.source.tokenUuid }));
        const next = { ...state, status: "chosen", results: lines };
        return message.update({ content: cardHTML(next), [`flags.${MODULE_ID}.${FLAG}`]: next });
    }
    const check = cardCheck(mode.plan);
    const targets = [];
    for (const target of state.targets) {
        const actor = await fromUuid(target.actorUuid).catch(() => null);
        targets.push({ ...target, dc: check?.kind === "check" ? actor?.getStatistic?.(check.against)?.dc?.value ?? null : null });
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
        }
    };
    const result = await core.registry.resolve(state.plan, context, io);
    const lines = rolled.map((line) => `Damage rolled: ${line}`);
    for (const change of result.changes) {
        try {
            const extra = await applyChange(change, state);
            if (extra) lines.push(extra);
        } catch (error) {
            lines.push(`Couldn't apply ${change.op} to ${state.targets.find((target) => target.id === change.target)?.name ?? "a creature"}: ${error.message}`);
        }
    }
    lines.push(...(await grantImmunity(state)));
    // "It can't use it again for 1d4 rounds": rolled now.
    const recharge = state.plan?.trigger?.recharge?.formula;
    if (recharge && state.ability.uuid) {
        const item = await fromUuid(state.ability.uuid).catch(() => null);
        const actor = item?.actor ?? (await fromUuid(state.source.actorUuid));
        if (item && actor) lines.push(await startRecharge({ actor, item, formula: recharge, tokenUuid: state.source.tokenUuid }));
    }
    const names = { source: state.source.name, ...Object.fromEntries(state.targets.map((target) => [target.id, target.name])) };
    // What happened first, then the rolls and reminders.
    const next = { ...stateOf(message), status: "applied", results: [...changeLines(result.changes, names), ...lines] };
    if (!next.results.length) next.results = ["Nothing to apply."];
    return message.update({ content: cardHTML(next), [`flags.${MODULE_ID}.${FLAG}`]: next });
}

// "Temporarily immune for 1 minute" (Frightful Presence, Stench, Demoralize):
// an effect on each target whose result grants it, which aura cards check.
async function grantImmunity(state) {
    const immunity = state.plan?.trigger?.immunity;
    const slug = state.plan?.source?.slug ?? state.ability.slug;
    if (!immunity?.duration || !slug) return [];
    const item = state.ability.uuid ? await fromUuid(state.ability.uuid).catch(() => null) : null;
    const lines = [];
    for (const target of state.targets) {
        if (!immunityApplies(immunity, target.degree)) continue;
        const { actor } = await targetOf(state, target.id);
        if (!actor) continue;
        const source = immunity.against === "all" ? null : state.source.actorUuid;
        if (isImmune(actor.itemTypes.effect.map((effect) => effect.flags?.[MODULE_ID]), { slug, source })) continue;
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

const damageRollClass = () => (CONFIG.Dice?.rolls ?? []).find((roll) => roll?.name === "DamageRoll");

// One change from the core, applied in Foundry. Returns an extra line for the card, or null.
async function applyChange(change, state) {
    const { target, token, actor } = await targetOf(state, change.target);
    if (!actor && change.target !== undefined) return null;
    switch (change.op) {
        case "damage": {
            const parts = change.instances.filter((instance) => instance.amount > 0).map((instance) => `${instance.amount}[${instance.category === "persistent" ? "persistent," : ""}${instance.type ?? "untyped"}]`);
            if (!parts.length) return null;
            const DamageRoll = damageRollClass();
            const roll = await new DamageRoll(parts.length === 1 ? parts[0] : `{${parts.join(",")}}`).evaluate();
            const item = state.ability.uuid ? await fromUuid(state.ability.uuid) : null;
            await actor.applyDamage({ damage: roll, token: token ?? undefined, item: item ?? undefined });
            return null;
        }
        case "condition": {
            if (change.slug === "persistent-damage") {
                const DamageRoll = damageRollClass();
                // Its dice ("1d4 bleed" rolls each round), unless a basic save halved or doubled the rolled amount.
                const dice = change.damage?.dice?.length && !change.damage?.multiplier ? instanceFormula(change.damage) : null;
                const roll = await new DamageRoll(`(${change.damage?.formula ?? dice ?? change.damage?.amount ?? 1})[persistent,${change.damage?.type ?? "untyped"}]`).evaluate();
                await actor.applyDamage({ damage: roll, token: token ?? undefined });
                return null;
            }
            // Off-guard to one creature's attacks (Feint, Create a Diversion): an effect on that creature.
            if (change.slug === "off-guard" && change.scope?.attacker) return scopedOffGuard(state, change);
            // While it stays in the aura (Aura of Sobs' stupefied): an effect scripts/auras.js ends when it leaves.
            if (change.duration?.mode === "in-aura" && (await applyAuraCondition(actor, change, state))) {
                const after = change.duration.after;
                return `${target.name}'s ${change.slug} lasts while it stays in the aura${after ? `, and ${after.value} ${after.value === 1 ? after.unit.replace(/s$/, "") : after.unit} after it leaves` : ""}`;
            }
            // A condition with a duration: a PF2e effect that grants it and ends on the monster's turn.
            if (change.duration?.mode === "fixed" && ["rounds", "minutes"].includes(change.duration.unit)) {
                // "for 1d4 rounds": rolled for each creature.
                const duration = change.duration.valueRoll ? { ...change.duration, value: (await new Roll(change.duration.valueRoll).evaluate()).total } : change.duration;
                await timedCondition(actor, change.slug, change.value, duration, state);
                return `${target.name}'s ${change.slug} lasts ${durationText(duration, state.source.name)}${change.duration.valueRoll ? ` (rolled ${change.duration.valueRoll})` : ""}`;
            }
            await setCondition(actor, change.slug, change.value);
            // "Fleeing for as long as it's frightened": the GM ends it with that condition.
            if (change.duration?.mode === "while" && change.duration.condition) return `${target.name}'s ${change.slug} lasts as long as it's ${change.duration.condition}`;
            return null;
        }
        case "effect":
            // Swallowed: an effect granting grabbed and slowed 1, with the damage at the end of each turn (scripts/swallow.js).
            if (change.effect?.kind === "swallow") return applySwallow(state, actor, change.effect);
            if (change.effect?.kind === "disarm") return disarm(actor, change.effect, target);
            if (change.effect?.kind === "modifier") return penaltyEffect(actor, change.effect.modifier, state);
            if (change.effect?.kind === "native") return nativeEffect(actor, change.effect, state, state.targets.find((entry) => entry.id === change.target)?.degree ?? null);
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
        case "affliction":
            return handOffAffliction(state, target, actor, change.data);
        // "…save or instantly die": at 0 HP and marked dead (the GM pressed Apply on the results).
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
async function timedCondition(actor, slug, value, duration, state) {
    const template = game.pf2e.ConditionManager.getCondition(slug);
    if (!template) return setCondition(actor, slug, value);
    const combat = game.combat;
    let rounds = Number(duration.value ?? 1);
    if (duration.anchor === "source-turn" && combat?.started && duration.unit === "rounds" && rounds <= 1) {
        const position = combat.turns.findIndex((turn) => turn.actor?.uuid === state.source.actorUuid);
        if (position >= 0) rounds = (rounds === 0 && duration.expiry === "turn-end" ? position >= combat.turn : position > combat.turn) ? 0 : 1;
    }
    const label = `${template.name}${Number.isFinite(value) ? ` ${value}` : ""}`;
    await actor.createEmbeddedDocuments("Item", [{
        name: `${state.ability.name}: ${label}`,
        type: "effect",
        img: template.img,
        flags: { [MODULE_ID]: { timedCondition: { slug, sourceActorUuid: state.source.actorUuid } } },
        system: {
            description: { value: `<p>${label} from <strong>${state.ability.name}</strong> (${state.source.name}).</p>` },
            duration: { value: rounds, unit: duration.unit, expiry: duration.expiry ?? "turn-start", sustained: false },
            start: { value: game.time.worldTime, initiative: combat?.started ? combat.combatant?.initiative ?? null : null },
            context: { origin: { actor: state.source.actorUuid, item: state.ability.uuid }, target: { actor: actor.uuid }, roll: null },
            rules: [{ key: "GrantItem", uuid: template._stats?.compendiumSource ?? template.sourceId ?? template.uuid, flag: "condition", allowDuplicate: true, alterations: Number.isFinite(value) ? [{ mode: "override", property: "badge-value", value }] : [], onDeleteActions: { granter: "cascade", grantee: "cascade" } }]
        }
    }]);
}

// A penalty or bonus from the result (Bon Mot's -2 status to Perception and
// Will for 1 minute): a PF2e effect with that FlatModifier, for its duration.
// A PF2e effect item (an effect card's): a copy on the creature, its origin the monster and its ability, so PF2e
// counts "until the start of its next turn" on the monster's turns.
async function nativeEffect(actor, effect, state, degree = null) {
    const template = await fromUuid(effect.uuid).catch(() => null);
    if (!template) return `${actor.name}: ${effect.label ?? "the effect"} wasn't found; apply it by hand.`;
    const source = template.toObject();
    delete source._id;
    // A choice of the save's result in the effect (PF2e's "Degree of success" prompt): the target's own, so no prompt.
    for (const rule of source.system?.rules ?? []) {
        if (rule?.key !== "ChoiceSet" || rule.selection !== undefined || !Array.isArray(rule.choices) || !degree) continue;
        const choice = rule.choices.find((entry) => new RegExp(`\\.${degree}$`).test(String(entry?.label ?? "")));
        if (choice) rule.selection = choice.value;
    }
    source._stats = { ...(source._stats ?? {}), compendiumSource: effect.uuid };
    source.system.context = { ...(source.system.context ?? {}), origin: { ...(source.system.context?.origin ?? {}), actor: state.source.actorUuid, token: state.source.tokenUuid ?? null, item: state.ability.uuid ?? null } };
    source.flags = { ...(source.flags ?? {}), [MODULE_ID]: { ...(source.flags?.[MODULE_ID] ?? {}), card: true } };
    await actor.createEmbeddedDocuments("Item", [source]);
    return null;
}

async function penaltyEffect(actor, modifier, state) {
    const duration = modifier.duration?.mode === "fixed" ? { value: modifier.duration.value, unit: modifier.duration.unit, expiry: modifier.duration.expiry ?? "turn-start", sustained: false } : { value: -1, unit: "unlimited", expiry: null, sustained: false };
    const sign = modifier.value > 0 ? "+" : "−";
    await actor.createEmbeddedDocuments("Item", [{
        name: `${state.ability.name}: ${sign}${Math.abs(modifier.value)} to ${modifier.selector}`,
        type: "effect",
        img: "icons/svg/downgrade.svg",
        flags: { [MODULE_ID]: { modifier: { selector: modifier.selector, source: state.source.actorUuid } } },
        system: {
            description: { value: `<p>${sign}${Math.abs(modifier.value)} ${modifier.type} to ${modifier.selector}, from <strong>${state.ability.name}</strong> (${state.source.name}).</p>` },
            duration,
            start: { value: game.time.worldTime, initiative: game.combat?.started ? game.combat.combatant?.initiative ?? null : null },
            rules: [{ key: "FlatModifier", selector: modifier.selector, type: modifier.type ?? "untyped", value: modifier.value }]
        }
    }]);
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
    const source = state.source.tokenUuid ? await fromUuid(state.source.tokenUuid) : null;
    if (!mover || !token || !source) return `${target.name}: move the token ${change.distance} feet by hand.`;
    const size = source.parent?.grid?.size ?? canvas.grid.size;
    const point = { x: source.x + Number(source.width ?? 1) * size / 2, y: source.y + Number(source.height ?? 1) * size / 2 };
    const result = await mover.forcedMove(token, { point, direction: change.kind === "pull" ? "toward" : "away", feet: change.distance, stopAt: change.kind === "pull" ? source : null, reason: state.ability.name });
    if (!result.moved) return `${target.name} couldn't be moved (${result.stoppedBy ?? result.reason}).`;
    return result.stoppedBy && result.stoppedBy !== "occupied" ? `${target.name} was stopped by ${result.stoppedBy === "wall" ? "a wall" : result.stoppedBy === "edge" ? "the scene's edge" : "a creature"}.` : null;
}

// A condition at least at this value (PF2e's conditions take the higher value, not the sum).
async function setCondition(actor, slug, value) {
    const existing = actor.itemTypes.condition.find((condition) => condition.slug === slug && condition.active);
    if (existing) {
        if (Number.isFinite(value) && (existing.value ?? 0) < value) await game.pf2e.ConditionManager.updateConditionValue(existing.id, actor, value);
        return;
    }
    await actor.increaseCondition(slug, Number.isFinite(value) ? { value } : {});
}

function durationText(duration, source) {
    // Minutes and longer: the time itself ("1 minute"); the monster's turns only count rounds.
    if (duration.unit && duration.unit !== "rounds") return `${duration.value} ${duration.value === 1 ? duration.unit.replace(/s$/, "") : duration.unit}`;
    if (duration.expiry === "turn-end") return duration.value === 0 ? `until the end of ${source}'s turn` : `until the end of ${source}'s next turn`;
    if (duration.expiry === "turn-start") return `until the start of ${source}'s turn ${duration.value === 1 ? "next round" : `in ${duration.value} rounds`}`;
    return `${duration.value} ${duration.unit}`;
}

// A creature afflicted by a monster's poison or disease: Pseudo Afflictions
// tracks it from the affliction item, as for the spell module's afflictions.
async function handOffAffliction(state, target, actor, data) {
    if (game.modules.get(AFFLICTIONS)?.active !== true) return `${target.name}: Pseudo Afflictions isn't active, so track ${data?.name ?? "the affliction"} by hand (stage ${data?.stage ?? 1}).`;
    const item = state.ability.uuid ? await fromUuid(state.ability.uuid) : null;
    const source = await fromUuid(state.source.actorUuid);
    if (!item) return `${target.name}: the affliction's item is gone; track it by hand.`;
    Hooks.callAll(`${AFFLICTIONS}.processMessage`, {
        actor,
        item,
        speaker: { actor: source?.id ?? null },
        flags: { pf2e: { context: { type: "saving-throw", outcome: target.degree, dc: { value: data?.dc ?? state.check.dc, label: `${state.ability.name} DC` } } } },
        getRollData: () => item.getRollData?.() ?? {}
    }, {}, game.userId);
    return null;
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
