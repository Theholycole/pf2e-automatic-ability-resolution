// Aura cards, the pure part (scripts/auras.js is the Foundry side): when an
// aura acts, whether a move entered it, who is immune, and the immunity effect.

// The times an aura acts: "enter", "start-turn", "end-turn" (a plan may give one as a string).
export const auraWhen = (plan) => [].concat(plan?.trigger?.when ?? []).filter(Boolean);

// What brought a card about, for its header.
export const AURA_CAUSES = Object.freeze({
    enter: "entered the aura",
    "combat-start": "in the aura as combat began",
    "start-turn": "started its turn in the aura",
    "end-turn": "ended its turn in the aura"
});

// Along a path, inside or not at each point: did it go from outside to inside?
export function entered(insides) {
    for (let index = 1; index < insides.length; index++) if (insides[index] && !insides[index - 1]) return true;
    return false;
}

// An aura that acts only after another ability (Miasma, after Poison Breath):
// active from that use until the start of the monster's next turn. use: { round, turn }.
export function activeAfterUse(use, { round, turn }, rounds = 1) {
    if (!use) return false;
    const until = { round: use.round + rounds, turn: use.turn };
    return round < until.round || (round === until.round && turn < until.turn);
}

// Which results grant the plan's immunity (every result, unless it says otherwise).
export function immunityApplies(immunity, degree) {
    if (!immunity?.duration || !degree) return false;
    return !immunity.degrees?.length || immunity.degrees.includes(degree);
}

// Is a creature immune, given its effects' flags? Immunity to "all" of a kind
// (stench auras) has no source; to one creature's ability, that creature's actor.
export function isImmune(flagsList, { slug, source }) {
    return flagsList.some((flags) => flags?.immunity?.slug === slug && (!flags.immunity.source || flags.immunity.source === source));
}

// The PF2e effect that records an immunity. ability: { name, slug, img };
// source: { actorUuid, name }; time: { worldTime, initiative }.
export function immunityEffect(moduleId, immunity, { ability, source, time }) {
    const all = immunity.against === "all";
    const unit = ["rounds", "minutes", "hours", "days"].includes(immunity.duration.unit) ? immunity.duration.unit : "minutes";
    return {
        name: `Immune: ${ability.name}${all ? " (all)" : ` (${source.name})`}`,
        type: "effect",
        img: ability.img ?? "icons/svg/shield.svg",
        flags: { [moduleId]: { immunity: { slug: ability.slug, source: all ? null : source.actorUuid } } },
        system: {
            description: { value: `<p>Temporarily immune to ${all ? `every ${ability.name}` : `${source.name}'s ${ability.name}`}.</p>${immunity.raw ? `<p><em>${immunity.raw}</em></p>` : ""}` },
            duration: { value: immunity.duration.value, unit, expiry: "turn-start", sustained: false },
            start: { value: time.worldTime, initiative: time.initiative ?? null },
            tokenIcon: { show: false },
            rules: []
        }
    };
}

// --- Conditions that last while a creature stays in an aura --------------------

// "Stupefied 1 for as long as they remain within the aura": an effect granting
// the condition, which scripts/auras.js ends when the creature leaves (or the
// monster dies or goes), or keeps for a while longer ("persists for 3 rounds
// after leaving"). template: the condition's { name, img, uuid };
// source: { actorUuid, tokenUuid, name }; ability: { name, uuid }; targetUuid: the creature's actor.
export function auraConditionEffect(moduleId, { slug, value, template, source, ability, radius, after = null, time, targetUuid = null }) {
    const label = `${template.name}${Number.isFinite(value) ? ` ${value}` : ""}`;
    return {
        name: `${ability.name}: ${label}`,
        type: "effect",
        img: template.img,
        flags: { [moduleId]: { whileInAura: { slug, sourceToken: source.tokenUuid, sourceActor: source.actorUuid, radius, after, lingering: false } } },
        system: {
            description: { value: `<p>${label} from <strong>${ability.name}</strong> (${source.name}), while in the aura${after ? ` and for ${after.value} ${after.unit} after leaving it` : ""}.</p>` },
            duration: { value: -1, unit: "unlimited", expiry: null, sustained: false },
            start: { value: time.worldTime, initiative: time.initiative ?? null },
            context: { origin: { actor: source.actorUuid, item: ability.uuid ?? null }, target: { actor: targetUuid }, roll: null },
            rules: [{ key: "GrantItem", uuid: template.uuid, flag: "condition", allowDuplicate: true, alterations: Number.isFinite(value) ? [{ mode: "override", property: "badge-value", value }] : [], onDeleteActions: { granter: "cascade", grantee: "cascade" } }]
        }
    };
}

// What happens to such an effect now: "keep" (still inside), "end", "linger"
// (it left, and the effect outlasts that), or "resume" (back inside while lingering).
export function auraConditionStep({ inside, sourceGone, after, lingering }) {
    if (sourceGone) return lingering ? "keep" : after ? "linger" : "end";
    if (inside) return lingering ? "resume" : "keep";
    return lingering ? "keep" : after ? "linger" : "end";
}
