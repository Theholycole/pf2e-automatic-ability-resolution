// Creatures an ability makes or becomes, in live play (2026-10-13, batch 295; the user's call on the last deferred abilities): Eye Probe's
// probes, Spirit Blades' blades, the lantern archons' Gestalt. Each is a world actor of its own (PF2e's creature when the ability links one,
// else one with the numbers the text gives) and a token beside its maker; a card dismisses them. A merge hides the creatures it's made of
// and takes them out of the turns (Foundry doesn't skip hidden ones), keeping one's place for itself; parting puts them back, each with its
// share of the merged creature's Hit Points. Those with a time end at their maker's turn, as zones do.
// (Batch 297, the user's call: summons too — src/compiler/summons.js. What the GM decides comes first, on a card: one creature of a list, how
// many of a roll, whether what it needs is there, a creature from the compendiums (a rune trap's, asked as it's placed). Those that act on
// their own join the turns; summoned ones go at 0 HP, some with their maker.)

import { CORE_PACKS } from "../src/compiler/gm-fallback.js";
import { beyondMax, conjuredActorData, conjuredName, makerStats, pickLevels, pickable, placements, shares } from "../src/live/conjure.js";
import { zoneEndsAt, zoneOver } from "../src/live/zones.js";
import { damageRollClass, isActiveGM } from "./live.js";
import { noteToGM } from "./recharge.js";

const MODULE_ID = "pf2e-automatic-ability-resolution";
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const whisper = () => ChatMessage.getWhisperRecipients("GM").map((user) => user.id);

// (One at a time: PF2e starts a turn once for each defeated combatant it skips, all at once.)
let queue = Promise.resolve();
const serially = (label, task) => {
    queue = queue.then(task).catch((error) => console.error(`${MODULE_ID} | ${label}`, error));
    return queue;
};
const ending = new Set();
let compile = () => null;

export function setUpConjure({ compileItem } = {}) {
    if (compileItem) compile = compileItem;
    Hooks.on("pf2e.startTurn", (combatant) => {
        if (isActiveGM()) serially("conjured end", () => expireConjured(combatant, "start"));
    });
    Hooks.on("pf2e.endTurn", (combatant) => {
        if (isActiveGM()) serially("conjured end", () => expireConjured(combatant, "end"));
    });
    Hooks.on("renderChatMessageHTML", (message, html) => {
        const card = message.getFlag?.(MODULE_ID, "conjureCard");
        if (card) {
            const button = html.querySelector?.("button[data-conjure-end]");
            if (!game.user.isGM) button?.remove();
            button?.addEventListener("click", async (event) => {
                event.preventDefault();
                button.disabled = true;
                await endConjured(card.actorIds ?? []);
            });
        }
        // (Batch 297: the GM's choice before a summon.)
        if (!message.getFlag?.(MODULE_ID, "summonCard")) return;
        for (const button of html.querySelectorAll?.("button[data-summon]") ?? []) {
            if (!game.user.isGM) {
                button.remove();
                continue;
            }
            button.addEventListener("click", async (event) => {
                event.preventDefault();
                button.disabled = true;
                try {
                    await useSummonCard(message, button.dataset.summon);
                } catch (error) {
                    ui.notifications.error(`${MODULE_ID}: ${error.message}`);
                    console.error(`${MODULE_ID} | summon`, error);
                } finally {
                    button.disabled = false;
                }
            });
        }
    });
    // (Batch 297: at 0 HP, a summoned one goes, and its maker takes what the text says; a maker at 0 HP takes those that go with it.)
    Hooks.on("updateActor", (actor, changed) => {
        const hp = changed?.system?.attributes?.hp?.value;
        if (!isActiveGM() || hp === undefined || hp > 0) return;
        serially("conjured at 0 HP", () => onZero(actor));
    });
    // (Batch 297, the user's request: a rune trap that summons "a specific creature, determined when the trap is created" asks for it as it's placed.)
    Hooks.on("createToken", (token, _options, userId) => {
        if (userId !== game.user.id || !game.user.isGM) return;
        askRune(token).catch((error) => console.error(`${MODULE_ID} | rune creature`, error));
    });
}

const conjuredOn = (scene) => (scene?.tokens?.contents ?? []).filter((token) => token.actor?.flags?.[MODULE_ID]?.conjured);

// Their time up at this turn's start or end: dismissed, a merge parted.
async function expireConjured(combatant, phase) {
    const combat = combatant?.parent ?? game.combat;
    if (!combat) return;
    const over = new Set();
    for (const token of conjuredOn(combat.scene ?? canvas.scene)) {
        const conjured = token.actor.flags[MODULE_ID].conjured;
        if (conjured.combatId === combat.id && zoneOver(conjured.endsAt, { phase, round: combat.round, combatantId: combatant.id })) over.add(token.actor.id);
    }
    if (over.size) await endConjured([...over]);
}

// A creature at 0 HP: a summoned one gone (its maker hurt when the text says so), or a maker's creatures that go with it.
async function onZero(actor) {
    const conjured = actor.flags?.[MODULE_ID]?.conjured;
    const id = actor.token?.actorId ?? actor.id;
    if (conjured) {
        if (Number(conjured.makerDamage) > 0) {
            const maker = conjured.sourceTokenUuid ? await fromUuid(conjured.sourceTokenUuid).catch(() => null) : null;
            const DamageRoll = damageRollClass();
            if (maker && DamageRoll) {
                const roll = await new DamageRoll(`${Number(conjured.makerDamage)}[untyped]`).evaluate();
                await roll.toMessage({ speaker: ChatMessage.getSpeaker({ token: maker }), flavor: `<strong>${escape(conjured.itemName)}</strong>: ${escape(maker.name)} takes ${Number(conjured.makerDamage)} damage as ${escape(actor.name)} falls.` });
            }
        }
        if (conjured.vanishAtZero) await endConjured([id]);
        return;
    }
    const makers = new Set(actor.getActiveTokens(false, true).map((token) => token.uuid));
    if (!makers.size) return;
    const going = new Set();
    for (const scene of game.scenes.contents) {
        for (const token of conjuredOn(scene)) {
            const flags = token.actor.flags[MODULE_ID].conjured;
            if (flags.endsWithMaker && makers.has(flags.sourceTokenUuid)) going.add(token.actor.id);
        }
    }
    if (going.size) await endConjured([...going]);
}

// Dismissed (their card's button, or their time), each once.
export async function endConjured(actorIds) {
    for (const id of actorIds) {
        const actor = game.actors.get(id);
        // (Once each: a second click, or its time, while it's already going.)
        if (!actor || ending.has(id)) continue;
        ending.add(id);
        try {
            await endOne(actor);
        } finally {
            ending.delete(id);
        }
    }
}

// One of them ended: its tokens and actor gone; a merge's creatures back, each with its share.
async function endOne(actor) {
    const conjured = actor.flags?.[MODULE_ID]?.conjured ?? {};
    const scene = game.scenes.get(conjured.sceneId) ?? canvas.scene;
    const tokens = (scene?.tokens?.contents ?? []).filter((token) => token.actorId === actor.id);
    if (conjured.merged?.length) {
        const left = Number(tokens[0]?.actor?.system?.attributes?.hp?.value ?? actor.system?.attributes?.hp?.value ?? 0);
        const parts = shares(left, conjured.merged.length);
        const back = [];
        let handBack = null;
        for (const [index, tokenId] of conjured.merged.entries()) {
            const token = scene?.tokens?.get(tokenId);
            if (!token) continue;
            await token.update({ hidden: false });
            await token.actor?.update({ "system.attributes.hp.value": parts[index] });
            if (parts[index] <= 0) await token.actor?.toggleStatusEffect?.("dead", { active: true, overlay: true });
            const turn = (conjured.turns ?? []).find((entry) => entry.tokenId === tokenId);
            const entry = turn ? { tokenId, sceneId: scene.id, actorId: turn.actorId, initiative: turn.initiative, hidden: turn.hidden, ...(parts[index] <= 0 ? { defeated: true } : {}) } : null;
            if (turn?.kept) handBack = entry;
            else if (entry) back.push(entry);
        }
        // (Back in the turns at their own initiative: the place it kept handed back, so the turn doesn't move, then the others.)
        const combat = game.combats.get(conjured.combatId);
        const holder = combat?.combatants?.find((entry) => tokens.some((token) => token.id === entry.tokenId));
        if (holder && handBack) await holder.update({ tokenId: handBack.tokenId, actorId: handBack.actorId, hidden: handBack.hidden, ...(handBack.defeated ? { defeated: true } : {}) });
        if (combat && back.length) await combat.createEmbeddedDocuments("Combatant", back.filter((entry) => !combat.combatants.some((other) => other.tokenId === entry.tokenId)));
        await noteToGM(null, null, [`<strong>${escape(actor.name)}</strong> parts: ${parts.join(", ")} Hit Points each.`]);
    }
    for (const combat of game.combats.contents) {
        const gone = combat.combatants.filter((entry) => tokens.some((token) => token.id === entry.tokenId)).map((entry) => entry.id);
        if (gone.length) await combat.deleteEmbeddedDocuments("Combatant", gone);
    }
    if (tokens.length && scene) await scene.deleteEmbeddedDocuments("Token", tokens.map((token) => token.id));
    await actor.delete();
}

// --- What the GM decides first (batch 297) -----------------------------------------------------------------------

// The creatures the compendiums hold, for a pick: PF2e's rulebook bestiaries (Monster Core first) and Battlezoo's, as index entries.
let indexCache = null;
async function creatureIndex() {
    if (indexCache) return indexCache;
    const rank = (pack) => (pack.metadata.packageName === "pf2e" ? (/monster-core/.test(pack.metadata.name) ? 0 : pack.metadata.name === "pathfinder-npc-core" ? 1 : 2) : 3);
    const packs = game.packs.filter((pack) => pack.documentName === "Actor" && (!pack.metadata.system || pack.metadata.system === "pf2e") && (pack.metadata.packageName === "pf2e" ? CORE_PACKS.has(pack.metadata.name) : String(pack.metadata.packageName ?? "").startsWith("battlezoo"))).sort((a, b) => rank(a) - rank(b));
    const entries = [];
    for (const pack of packs) {
        const index = await pack.getIndex({ fields: ["system.details.level.value", "system.traits.value", "type"] });
        for (const entry of index) entries.push({ uuid: entry.uuid ?? `Compendium.${pack.collection}.Actor.${entry._id}`, name: entry.name, level: Number(entry.system?.details?.level?.value), traits: entry.system?.traits?.value ?? [], type: entry.type });
    }
    indexCache = entries;
    return entries;
}

// A creature the text names without a link ("animated armor", a Battlezoo fractrix): the first of that name.
async function findCreature(name) {
    const want = String(name ?? "").trim().toLowerCase();
    return (await creatureIndex()).find((entry) => entry.type === "npc" && entry.name.toLowerCase() === want)?.uuid ?? null;
}

// The GM's pick of a creature the plan allows: a list to filter by name. { uuid, name } or null.
// (2026-10-27: exported on the module api as api.live.pickCreature, for the item module.)
export async function pickCreature({ title, pick, context = {} }) {
    // (Batch 298: the rune's own creature, from wherever it is — an adventure's pack too.)
    const named = pick.default?.uuid ? await fromUuid(pick.default.uuid).catch(() => null) : null;
    const defaultEntry = named ? { uuid: pick.default.uuid, name: named.name, level: Number(named.system?.details?.level?.value), traits: named.system?.traits?.value ?? [], type: named.type } : null;
    const entries = pickable(await creatureIndex(), pick, { ...context, defaultEntry });
    if (!entries.length) {
        ui.notifications.warn(`${title}: no creature in the compendiums fits.`);
        return null;
    }
    const { level, maxLevel, rank } = pickLevels(pick, context);
    const own = pick.default ? entries[0] : null;
    const what = [Number.isFinite(level) ? `level ${level}` : Number.isFinite(maxLevel) ? `level ${maxLevel} or lower` : own && Number.isFinite(own.level) ? `level ${own.level}` : null, rank ? `(rank ${rank})` : null, pick.any?.length ? pick.any.join(" or ") : null, pick.all?.length ? pick.all.join(" and ") : null, own ? `its own ${own.name} first` : null].filter(Boolean).join(", ");
    const options = entries.map((entry, index) => `<option value="${escape(entry.uuid)}"${index ? "" : " selected"}>${escape(entry.name)} (${entry.level})</option>`).join("");
    const content = `<p>A creature: ${escape(what || "any")}.</p><input type="search" name="filter" placeholder="Filter by name" autocomplete="off"><select name="creature" size="12" style="width: 100%; height: 18em; margin-top: 4px">${options}</select>`;
    const DialogV2 = foundry.applications.api.DialogV2;
    const uuid = await DialogV2.wait({
        window: { title },
        content,
        buttons: [
            { action: "summon", label: "Summon", default: true, callback: (_event, button) => button.form?.elements?.creature?.value || null },
            { action: "cancel", label: "Cancel", callback: () => null }
        ],
        render: (_event, dialog) => {
            const root = dialog.element ?? dialog;
            const filter = root.querySelector?.("input[name=filter]");
            const select = root.querySelector?.("select[name=creature]");
            filter?.addEventListener("input", () => {
                const words = filter.value.trim().toLowerCase();
                for (const option of select.options) option.hidden = Boolean(words) && !option.textContent.toLowerCase().includes(words);
            });
        },
        rejectClose: false
    }).catch(() => null);
    // (Foundry's dialog answers with the button's action, "cancel", when its callback gives nothing: only a creature from the list counts.)
    const chosen = entries.find((entry) => entry.uuid === uuid);
    return chosen ? { uuid: chosen.uuid, name: chosen.name } : null;
}

// A rune trap placed: its creature asked for and kept on the token.
async function askRune(token) {
    const actor = token.actor;
    if (actor?.type !== "hazard") return;
    for (const item of actor.itemTypes?.action ?? []) {
        const plan = compile(item);
        if (plan?.builtin !== "conjure" || plan.pick?.when !== "placed") continue;
        const picked = await pickCreature({ title: `${token.name}: ${item.name}`, pick: plan.pick });
        if (!picked) {
            await noteToGM(actor, token, [`<strong>${escape(item.name)}</strong>: ${plan.pick.default ? `it summons ${escape(plan.pick.default.name)}, as written` : "no creature chosen yet; it's asked for when the trap goes off"}.`]);
            continue;
        }
        await token.update({ [`flags.${MODULE_ID}.runeCreature`]: { ...picked, itemId: item.id } });
        await noteToGM(actor, token, [`<strong>${escape(item.name)}</strong>: it summons ${escape(picked.name)}.`]);
    }
}

// The ability used: what the GM decides first on a card, or its creatures at once.
export async function startConjure({ item, plan, sourceToken, context = {} }) {
    const token = sourceToken?.document ?? sourceToken;
    const scene = token?.parent ?? canvas.scene;
    if (!token || !scene) return noteToGM(item.actor, sourceToken, [`<strong>${escape(item.name)}</strong>: its creatures need the maker's token on the scene.`]);
    const preset = plan.pick?.when === "placed" ? token.flags?.[MODULE_ID]?.runeCreature ?? null : null;
    const counted = (plan.creatures ?? []).find((creature) => creature.count?.formula);
    const rolled = counted ? (await new Roll(counted.count.formula).evaluate()).total : null;
    // (Batch 298: a rune that names its creature summons that one when none was picked.)
    if (plan.options?.length || plan.needs || counted || (plan.pick && !preset && !plan.pick.default)) return summonCard({ item, plan, token, context, rolled, formula: counted?.count?.formula ?? null });
    return makeConjured({ item, plan, token, context, picked: preset });
}

async function summonCard({ item, plan, token, context, rolled, formula }) {
    const buttons = [];
    if (plan.options?.length) plan.options.forEach((option, index) => buttons.push([`option:${index}`, option.label]));
    else if (Number.isFinite(rolled)) for (let many = Math.max(1, rolled); many >= 1; many--) buttons.push([`count:${many}`, `${plan.needs ? "Raise" : "Summon"} ${many}`]);
    else if (plan.pick) buttons.push(["pick", "Choose a creature…"]);
    else buttons.push(["go", "Summon"]);
    buttons.push(["decline", "Not now"]);
    const lines = [
        Number.isFinite(rolled) ? `${formula} rolled: ${rolled}.` : null,
        plan.needs ? `Only if there are ${plan.needs}.`.replace(/^Only if there are (an? )/, "Only if there's $1") : null,
        plan.options?.length ? "Which?" : null
    ].filter(Boolean);
    const state = { itemUuid: item.uuid, itemName: item.name, tokenUuid: token.uuid, plan, context, rolled, status: "open" };
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: item.actor, token }),
        whisper: whisper(),
        content: summonCardHTML(state, buttons, lines),
        flags: { [MODULE_ID]: { summonCard: { ...state, buttons, lines } } }
    });
}

const summonCardHTML = (state, buttons, lines, result = null) => `<section class="pf2e-aar-summon"><p><strong>${escape(state.itemName)}</strong>${lines.length ? `: ${lines.map(escape).join(" ")}` : ""}</p>${state.status === "open" ? `<p>${buttons.map(([action, label]) => `<button type="button" data-summon="${escape(action)}">${escape(label)}</button>`).join(" ")}</p>` : `<p><em>${escape(result ?? state.status)}</em></p>`}</section>`;

async function useSummonCard(message, action) {
    const card = foundry.utils.deepClone(message.getFlag(MODULE_ID, "summonCard"));
    if (card.status !== "open") return;
    const settle = (status, result) => message.update({ content: summonCardHTML({ ...card, status }, card.buttons, card.lines, result), [`flags.${MODULE_ID}.summonCard.status`]: status });
    if (action === "decline") return settle("declined", "Not now.");
    const token = await fromUuid(card.tokenUuid).catch(() => null);
    // (2026-10-27, the item module: an item used up since the card was made — its name on what it makes, as the zones' are.)
    const item = (await fromUuid(card.itemUuid).catch(() => null)) ?? (token?.actor ? { name: card.itemName, uuid: null, actor: token.actor } : null);
    if (!item || !token) throw new Error("Its maker isn't there any more.");
    const plan = card.plan;
    let creatures = plan.creatures ?? [];
    let picked = null;
    if (action.startsWith("option:")) creatures = plan.options?.[Number(action.slice(7))]?.creatures ?? [];
    else if (action.startsWith("count:")) creatures = creatures.map((creature) => (creature.count?.formula ? { ...creature, count: Number(action.slice(6)) } : creature));
    else if (action === "pick") {
        picked = await pickCreature({ title: `${token.name}: ${item.name}`, pick: plan.pick, context: card.context });
        if (!picked) return;
    }
    const made = await makeConjured({ item, plan: { ...plan, creatures }, token, context: card.context, picked });
    await settle("used", made.length ? `Summoned: ${made.map(({ token: placed }) => placed.name).join(", ")}.` : "Nothing summoned.");
}

// --- Making them ---------------------------------------------------------------------------------------------------

// Its creatures beside it (a merge's at its place, the others hidden; one in its own space when the text says so), their turns, and their card.
async function makeConjured({ item, plan, token, context = {}, picked = null }) {
    const scene = token.parent ?? canvas.scene;
    const grid = { size: scene.grid.size, distance: scene.grid.distance };
    const combat = game.combats?.find?.((entry) => entry.started && (entry.scene?.id ?? canvas.scene?.id) === scene.id) ?? null;
    // A merge: its maker and the nearest others of its kind beside it, on its side.
    let merged = [];
    if (plan.merge) {
        const near = (other) => Math.hypot(other.x - token.x, other.y - token.y);
        const kin = scene.tokens.filter((other) => other.id !== token.id && !other.hidden && other.actor?.name === token.actor?.name && other.disposition === token.disposition && !other.actor?.isDead).sort((a, b) => near(a) - near(b));
        merged = [token, ...kin].slice(0, plan.merge.count);
        if (merged.length < plan.merge.count) {
            await noteToGM(item.actor, token, [`<strong>${escape(item.name)}</strong>: it takes ${plan.merge.count} of them; only ${merged.length} are here.`]);
            return [];
        }
    }
    // (A merge's creatures in the turns: their places, to put them back as it parts. It takes over one of them, the one acting now, else its
    // maker's: when the acting one leaves the turns, Foundry moves the turn on, and PF2e starts it in the wrong round, skipping its next.)
    const mergedTurns = merged.map((entry) => combat?.combatants?.find((candidate) => candidate.tokenId === entry.id)).filter(Boolean);
    const kept = mergedTurns.find((turn) => turn.id === combat?.combatant?.id) ?? mergedTurns.find((turn) => turn.tokenId === token.id) ?? mergedTurns[0] ?? null;
    const turns = mergedTurns.map((turn) => ({ tokenId: turn.tokenId, actorId: turn.actorId, initiative: turn.initiative, hidden: turn.hidden, ...(turn === kept ? { kept: true } : {}) }));
    const makerTurn = combat?.combatants?.find?.((entry) => entry.tokenId === token.id) ?? null;
    const combatant = kept ?? makerTurn;
    const acted = !combatant || combat.combatant?.id === combatant.id || combat.turns.indexOf(combatant) < combat.turn;
    // (Batch 297: a rolled time, a rune's "2d6 rounds".)
    const lastRoll = plan.lasts?.formula ? (await new Roll(plan.lasts.formula).evaluate()).total : null;
    let endsAt = combatant && plan.lasts ? zoneEndsAt(plan.lasts, { round: combat.round, combatantId: combatant.id, acted, rolled: lastRoll }) : null;
    const made = [];
    // (On its maker's side: PF2e sets an NPC token's disposition from its actor's alliance, and a compendium creature's is its own. Batch 297: the
    // side its maker's token shows. Batch 298: a trap's, against those who set it off — PF2e keeps a hazard's token neutral, with no alliance.)
    const makerActor = token.actor ?? item.actor;
    const alliance = makerActor?.type === "hazard" ? "opposition" : ({ [-1]: "opposition", 0: null, 1: "party" }[token.disposition] ?? makerActor?.alliance);
    const maker = { ac: Number(makerActor?.armorClass?.value ?? makerActor?.system?.attributes?.ac?.value), saves: Object.fromEntries(["fortitude", "reflex", "will"].map((save) => [save, Number(makerActor?.saves?.[save]?.mod ?? makerActor?.system?.saves?.[save]?.value) || 0])), hp: Number(makerActor?.system?.attributes?.hp?.max) };
    const target = [...(game.user.targets ?? [])][0] ?? null;
    const occupied = scene.tokens.filter((other) => !other.hidden).map((other) => ({ x: other.x, y: other.y, width: other.width, height: other.height }));
    const bounds = scene.dimensions?.sceneRect ? { x: scene.dimensions.sceneRect.x, y: scene.dimensions.sceneRect.y, width: scene.dimensions.sceneRect.width, height: scene.dimensions.sceneRect.height } : null;
    for (const creature of plan.creatures ?? []) {
        const count = Math.max(1, Number(creature.count) || 1);
        // (Eye Probe's six at most: the farthest earlier ones go; the oldest when the text says so.)
        if (Number.isFinite(plan.max)) {
            const earlier = conjuredOn(scene).filter((other) => other.actor.flags[MODULE_ID].conjured.itemUuid === item.uuid && other.actor.flags[MODULE_ID].conjured.sourceTokenUuid === token.uuid);
            const drop = beyondMax(earlier.map((other) => ({ id: other.actor.id, x: other.x, y: other.y, made: other.actor.flags[MODULE_ID].conjured.made })), { max: plan.max, adding: count, from: { x: token.x, y: token.y }, oldest: !!plan.oldest });
            if (drop.length) await endConjured(drop);
        }
        const flags = { itemUuid: item.uuid, itemName: item.name, sourceTokenUuid: token.uuid, sceneId: scene.id, endsAt, combatId: combat?.id ?? null, made: Date.now(), ...(plan.vanishAtZero ? { vanishAtZero: true } : {}), ...(plan.endsWithMaker ? { endsWithMaker: true } : {}), ...(plan.makerDamage ? { makerDamage: plan.makerDamage } : {}), ...(merged.length ? { merged: merged.filter((entry) => entry.id !== token.id).concat(token).map((entry) => entry.id), turns } : {}) };
        // Its creature: the GM's pick, the one the text links or names, another of its maker, or one with the text's numbers.
        const uuid = picked?.uuid ?? creature.from?.uuid ?? (creature.from?.name ? await findCreature(creature.from.name) : null);
        let source = uuid ? (await fromUuid(uuid).catch(() => null))?.toObject?.() ?? null : null;
        if ((creature.from?.uuid || creature.from?.name) && !picked && !source) {
            await noteToGM(item.actor, token, [`<strong>${escape(item.name)}</strong>: ${escape(creature.from.name ?? creature.name)} isn't in the compendiums.`]);
            return made;
        }
        if (creature.from?.self && makerActor) {
            source = makerActor.toObject();
            source.items = (source.items ?? []).filter((entry) => !["condition", "effect"].includes(entry.type));
            foundry.utils.setProperty(source, "system.attributes.hp.value", Number(source.system?.attributes?.hp?.max) || source.system?.attributes?.hp?.value);
        }
        const stats = makerStats(creature.stats, maker);
        const look = creature.look === "target" && target ? { name: `${creature.name} of ${target.name}`, img: target.document?.texture?.src ?? target.texture?.src ?? null } : null;
        const baseName = creature.from?.self ? token.name : (look?.name ?? picked?.name ?? creature.name);
        for (let index = 0; index < count; index++) {
            const name = creature.from?.self || look ? (count > 1 ? `${baseName} ${index + 1}` : baseName) : conjuredName(token.name, baseName, index, count);
            const data = source
                ? { ...foundry.utils.deepClone(source), name, prototypeToken: { ...(source.prototypeToken ?? {}), name }, flags: { ...(source.flags ?? {}), [MODULE_ID]: { ...(source.flags?.[MODULE_ID] ?? {}), conjured: flags } } }
                : conjuredActorData({ name, size: creature.size, stats, level: item.actor?.level ?? 0, alliance, traits: creature.traits ?? [], ...(look?.img ? { img: look.img } : {}), moduleId: MODULE_ID, flags });
            delete data._id;
            if (source && alliance !== undefined && ["npc", "hazard"].includes(data.type)) foundry.utils.setProperty(data, "system.details.alliance", alliance);
            if (source && creature.traits?.length) foundry.utils.setProperty(data, "system.traits.value", [...new Set([...(data.system?.traits?.value ?? []), ...creature.traits])]);
            const actor = await Actor.create(data);
            // (A war horse "with elite adjustments": PF2e's own.)
            if (creature.adjust && typeof actor.applyAdjustment === "function") await actor.applyAdjustment(creature.adjust);
            const tokenDocument = await actor.getTokenDocument({ disposition: token.disposition, hidden: token.hidden });
            const squares = { width: Math.max(1, Number(tokenDocument.width) || 1), height: Math.max(1, Number(tokenDocument.height) || 1) };
            const spot = plan.at === "maker" || merged.length ? { x: token.x, y: token.y } : placements({ token: { x: token.x, y: token.y, width: token.width, height: token.height }, grid, count: 1, squares, occupied, bounds })[0] ?? { x: token.x, y: token.y };
            occupied.push({ x: spot.x, y: spot.y, width: squares.width, height: squares.height });
            const tokenData = foundry.utils.mergeObject(tokenDocument.toObject(), { x: spot.x, y: spot.y });
            const [placed] = await scene.createEmbeddedDocuments("Token", [tokenData]);
            made.push({ actor, token: placed, initiative: creature.initiative ?? null });
        }
    }
    // (A merge: the creatures it's made of hidden, out of the turns; it takes over the place it kept, and the others leave.)
    if (merged.length) {
        for (const entry of merged) await entry.update({ hidden: true });
        const [first] = made;
        if (combat && first) {
            if (kept) await kept.update({ tokenId: first.token.id, actorId: first.actor.id, hidden: first.token.hidden });
            else await combat.createEmbeddedDocuments("Combatant", [{ tokenId: first.token.id, sceneId: scene.id, actorId: first.actor.id, initiative: null }]);
            const gone = combat.combatants.filter((candidate) => candidate.id !== kept?.id && merged.some((entry) => entry.id === candidate.tokenId)).map((candidate) => candidate.id);
            if (gone.length) await combat.deleteEmbeddedDocuments("Combatant", gone);
        }
    }
    // (Batch 297: those that act on their own join the turns — rolling initiative, or at their maker's.)
    if (combat) {
        const rolling = made.filter((entry) => entry.initiative === "roll");
        const beside = made.filter((entry) => entry.initiative === "maker");
        if (beside.length) await combat.createEmbeddedDocuments("Combatant", beside.map(({ actor, token: placed }) => ({ tokenId: placed.id, sceneId: scene.id, actorId: actor.id, initiative: makerTurn?.initiative ?? null, hidden: placed.hidden })));
        if (rolling.length) {
            const created = await combat.createEmbeddedDocuments("Combatant", rolling.map(({ actor, token: placed }) => ({ tokenId: placed.id, sceneId: scene.id, actorId: actor.id, hidden: placed.hidden })));
            try {
                await combat.rollInitiative(created.map((entry) => entry.id), { skipDialog: true, updateTurn: false });
            } catch (error) {
                console.warn(`${MODULE_ID} | initiative`, error);
                await noteToGM(item.actor, token, [`<strong>${escape(item.name)}</strong>: roll initiative for ${created.map((entry) => escape(entry.name)).join(", ")}.`]);
            }
            // (A rune's creature with no maker in the turns: its time counted from its own turn.)
            if (!endsAt && plan.lasts && created[0]) {
                const own = combat.combatants.get(created[0].id);
                endsAt = zoneEndsAt(plan.lasts, { round: combat.round, combatantId: own.id, acted: combat.turns.indexOf(own) < combat.turn, rolled: lastRoll });
                for (const { actor } of made) await actor.update({ [`flags.${MODULE_ID}.conjured.endsAt`]: endsAt });
            }
        }
    }
    const length = plan.lasts ? `${Number.isFinite(lastRoll) ? lastRoll : plan.lasts.value} ${plan.lasts.unit}` : null;
    const lasts = endsAt ? `until ${endsAt.at === "turn-end" ? "the end" : "the start"} of its turn in round ${endsAt.round}${length ? ` (${length})` : ""}` : length ?? "until dismissed";
    const names = made.map(({ token: placed }) => escape(placed.name));
    if (!made.length) return made;
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: item.actor, token }),
        whisper: whisper(),
        content: `<section class="pf2e-aar-conjure"><p><strong>${escape(item.name)}</strong>: ${merged.length ? `${merged.length} merged into ${names.join(", ")}` : `${names.length === 1 ? names[0] : `${names.length} of them`}`}. Lasts ${escape(lasts)}.</p>${(plan.notes ?? []).map((note) => `<p>${escape(note)}</p>`).join("")}<button type="button" data-conjure-end>${merged.length ? "Part them" : "Dismiss them"}</button></section>`,
        flags: { [MODULE_ID]: { conjureCard: { actorIds: made.map(({ actor }) => actor.id) } } }
    });
    return made;
}
