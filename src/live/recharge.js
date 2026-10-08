// Recharging abilities in live play, the pure part (scripts/recharge.js is the
// Foundry side). The user's decisions (2026-10-08): the recharge is rolled on
// Apply (an ability without a card starts it when used from the sheet), and
// using it again while it recharges still gets its card, with a warning.
//
// "It can't use Avalanche Breath again for 1d4 rounds": an effect on the
// monster for that many rounds, ending at the start of its turn.

export const rechargeKey = (name) => String(name ?? "").trim().toLowerCase();

// The effect. ability: { name, img }; time: { worldTime, initiative } (the monster's own initiative).
export function rechargeEffect(moduleId, { ability, rounds, formula, time }) {
    return {
        name: `Recharging: ${ability.name}`,
        type: "effect",
        img: ability.img ?? "icons/svg/clockwork.svg",
        flags: { [moduleId]: { recharging: { ability: ability.name, key: rechargeKey(ability.name), formula, rounds } } },
        system: {
            description: { value: `<p>${ability.name} can't be used again for ${rounds} ${rounds === 1 ? "round" : "rounds"} (${formula}): until the start of the creature's turn then.</p>` },
            duration: { value: rounds, unit: "rounds", expiry: "turn-start", sustained: false },
            start: { value: time.worldTime, initiative: time.initiative ?? null },
            tokenIcon: { show: true },
            rules: []
        }
    };
}

export const rechargeLine = (name, rounds, formula) => `${name} recharges in ${rounds} ${rounds === 1 ? "round" : "rounds"} (${formula})`;

export const warningLine = (name, roundsLeft) => `${name} is still recharging${Number.isFinite(roundsLeft) ? `: ${roundsLeft} ${roundsLeft === 1 ? "round" : "rounds"} left` : ""}.`;

// Draconic Momentum: which recharging effects a critical hit ends, given their
// flags ({ ability, key }) and the abilities it names (none named: all of them).
export function momentumRecharges(recharging, names) {
    const wanted = new Set((names ?? []).map(rechargeKey));
    return recharging.filter((flag) => flag && (!wanted.size || wanted.has(flag.key)));
}
