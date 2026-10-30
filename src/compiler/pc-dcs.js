// A character's own DCs in its feats' inline saves (2026-10-30, the feat work: docs/pc-feats.md). PF2e writes a PC ability's save
// against the character's statistic, not a number: "@Check[reflex|against:class-spell|basic]", "@Check[will|dc:resolve(@actor.
// attributes.classDC.value)]". The monster readings need the number, so each such save gets the character's DC first
// (options.dcs, scripts/pc-dcs.js reads them off the live actor; the tests give them as they are).
//
// dcs: { class, spell, perception, byClass: { exemplar: 24, … }, byTradition: { occult: 23, … }, statistics: { deception: 22, … },
//        level, abilities: { str: 4, … }, resolve? }
// The level and attribute modifiers fill the damage PF2e scales with them ("@Damage[(floor(@actor.level/2)d6)[bludgeoning]]" at 8th
// level: "(4d6)[bludgeoning]"), so the card and the simulator roll the character's own dice.

const SAVES = new Set(["fortitude", "reflex", "will"]);
const TRADITIONS = new Set(["arcane", "divine", "occult", "primal"]);

// The tag's parameters, split on the bars outside brackets and parentheses ("dc:resolve(max(10, @actor.level))").
function parameters(raw) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index <= raw.length; index++) {
        const character = raw[index];
        if (character === "[" || character === "(") depth++;
        else if (character === "]" || character === ")") depth--;
        if ((character === "|" && depth === 0) || index === raw.length) {
            parts.push(raw.slice(start, index));
            start = index + 1;
        }
    }
    return parts;
}

const finite = (value) => (Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value) : null);
const best = (...values) => {
    const numbers = values.map(finite).filter((value) => value !== null);
    return numbers.length ? Math.max(...numbers) : null;
};

// One "against:" slug → the character's DC, or null when it has none.
export function dcFor(slug, dcs) {
    if (!dcs) return null;
    const key = String(slug ?? "").trim().toLowerCase().replace(/[^a-z-]/g, "");
    if (["class", "classdc", "class-dc"].includes(key)) return finite(dcs.class);
    if (key === "spell" || key === "spelldc" || key === "spell-dc") return finite(dcs.spell);
    // PF2e's "class or spell DC, whichever is higher" (most archetype and ancestry abilities).
    if (key === "class-spell" || key === "classorspelldc") return best(dcs.class, dcs.spell);
    if (TRADITIONS.has(key)) return finite(dcs.byTradition?.[key]) ?? finite(dcs.spell);
    if (key === "perception") return finite(dcs.perception);
    if (finite(dcs.byClass?.[key]) !== null) return finite(dcs.byClass[key]);
    if (finite(dcs.statistics?.[key]) !== null) return finite(dcs.statistics[key]);
    return null;
}

// "dc:resolve(@actor.attributes.classDC.value)" and its kin → the DC it names, or null for any other expression.
function resolvedDC(expression, dcs) {
    const path = String(expression).replace(/\s+/g, "");
    if (/^resolve\(@actor\.(?:system\.)?attributes\.classOrSpellDC\.value\)$/.test(path)) return best(dcs.class, dcs.spell);
    if (/^resolve\(@actor\.(?:system\.)?attributes\.classDC\.value\)$/.test(path)) return finite(dcs.class);
    if (/^resolve\(@actor\.(?:system\.)?attributes\.spellDC\.value\)$/.test(path)) return finite(dcs.spell);
    return null;
}

// The description with each save PF2e leaves to the character given its DC. A check that isn't a save keeps its "against:" (that's the
// target's DC: "@Check[athletics|against:fortitude]"), and a save whose DC can't be found stays as it was, for the GM.
export function fillCharacterDCs(html, dcs) {
    if (!html || !dcs) return html;
    let out = "";
    let index = 0;
    while (index < html.length) {
        const at = html.indexOf("@Check[", index);
        if (at < 0) break;
        let depth = 0;
        let end = at + 6;
        for (; end < html.length; end++) {
            if (html[end] === "[") depth++;
            else if (html[end] === "]" && --depth === 0) break;
        }
        if (end >= html.length) break;
        const inner = html.slice(at + 7, end);
        out += html.slice(index, at) + `@Check[${filledInner(inner, dcs)}]`;
        index = end + 1;
    }
    return out + html.slice(index);
}

function filledInner(inner, dcs) {
    const parts = parameters(inner);
    const statistic = parts[0].replace(/^type:/, "").trim().toLowerCase();
    if (!SAVES.has(statistic)) return inner;
    let dc = null;
    const kept = [parts[0]];
    for (const part of parts.slice(1)) {
        const [key, ...rest] = part.split(":");
        const value = rest.join(":");
        if (key === "against") {
            dc ??= dcFor(value, dcs);
            continue;
        }
        if (key === "dc" && !finite(value)) {
            dc = resolvedDC(value, dcs) ?? dc;
            continue;
        }
        if (key === "dc") return inner;
        kept.push(part);
    }
    if (dc === null) return inner;
    return [...kept, `dc:${dc}`].join("|");
}

// "@actor.level", "@actor.abilities.str.mod" and their system paths → the character's numbers, inside the @Damage tags only; then each
// arithmetic of plain numbers is worked out ("floor(8/2)" → "4"). A formula with anything else it reads (a flag, a choice) stays.
const ACTOR_NUMBERS = [
    [/@actor\.(?:system\.details\.)?level(?:\.(?:value|base))?\b/g, (dcs) => dcs.level],
    [/@actor\.(?:system\.)?abilities\.(str|dex|con|int|wis|cha)\.mod\b/g, (dcs, ability) => dcs.abilities?.[ability]]
];
const ARITHMETIC = /^[\d\s+\-*/.]+$/;
// PF2e's formula functions on numbers (ternary's test as 1 or 0, as gte and the rest give it here).
const FUNCTIONS = {
    floor: Math.floor, ceil: Math.ceil, max: Math.max, min: Math.min,
    gte: (a, b) => Number(a >= b), gt: (a, b) => Number(a > b), lte: (a, b) => Number(a <= b), lt: (a, b) => Number(a < b), eq: (a, b) => Number(a === b),
    ternary: (test, yes, no) => (test ? yes : no)
};
// "4/2", "3 + 1" → the number (digits and operators only, left to right with * and / first), or null.
function worked(expression) {
    if (!ARITHMETIC.test(expression)) return null;
    const tokens = expression.replace(/\s+/g, "").match(/\d+(?:\.\d+)?|[+\-*/]/g) ?? [];
    const terms = [];
    let sign = 1;
    let term = null;
    let operator = null;
    for (const token of tokens) {
        if (/^[+-]$/.test(token) && operator === null && term !== null) {
            terms.push(sign * term);
            sign = token === "-" ? -1 : 1;
            term = null;
        } else if (/^[*/]$/.test(token)) operator = token;
        else if (/^[+-]$/.test(token)) sign *= token === "-" ? -1 : 1;
        else {
            const number = Number(token);
            term = term === null ? number : operator === "*" ? term * number : term / number;
            operator = null;
        }
    }
    if (term === null) return null;
    terms.push(sign * term);
    const value = terms.reduce((sum, each) => sum + each, 0);
    return Number.isFinite(value) ? value : null;
}
function workedCall(name, args) {
    const values = args.split(",").map(worked);
    return values.every((value) => value !== null) ? FUNCTIONS[name](...values) : null;
}
// item: the feat itself, for "@item.level" and the choice PF2e keeps for it ("[@item.flags.system.rulesSelections.damageType]").
export function fillCharacterNumbers(html, dcs, item = null) {
    if (!html || !dcs || !html.includes("@Damage[")) return html;
    const selections = item?.flags?.system?.rulesSelections ?? {};
    const itemLevel = Number(item?.system?.level?.value);
    return html.replace(/@Damage\[((?:[^\[\]]|\[(?:[^\[\]]|\[[^\]]*\])*\])*)\]/g, (all, inner) => {
        // (Live, dcs.resolve is PF2e's own: Roll.replaceFormulaData with the feat's roll data, which knows every path.)
        let formula = typeof dcs.resolve === "function" ? String(dcs.resolve(inner) ?? inner) : inner;
        for (const [pattern, read] of ACTOR_NUMBERS) {
            formula = formula.replace(pattern, (match, key) => {
                const number = Number(read(dcs, key));
                return Number.isFinite(number) ? String(number) : match;
            });
        }
        formula = formula.replace(/@item\.level\b/g, (match) => (Number.isFinite(itemLevel) ? String(itemLevel) : match))
            .replace(/@item\.flags\.system\.rulesSelections\.(\w+)/g, (match, key) => (["string", "number"].includes(typeof selections[key]) ? String(selections[key]) : match));
        if (formula.includes("@")) return all;
        // Innermost first: floor(4/2), ternary(gte(8,13),2,1), max(1, …), or plain (2*3), until none is left to work out.
        for (let guard = 0; guard < 20; guard++) {
            const next = formula.replace(/\b(floor|ceil|max|min|gte|gt|lte|lt|eq|ternary)\(([\d\s+\-*/.,]+)\)|\(([\d\s.]+[+\-*/][\d\s+\-*/.]*)\)/, (match, name, args, plain) => {
                const value = name ? workedCall(name, args) : worked(plain);
                return value === null ? match : name ? String(value) : `(${value})`;
            });
            // A number left in parentheses inside the arithmetic ("((3) * 2)") is just the number.
            const bare = next.replace(/\((\d+(?:\.\d+)?)\)(?=\s*[+\-*/,)])/g, "$1");
            if (bare === formula) break;
            formula = bare;
        }
        // "(4)d6" → "4d6".
        formula = formula.replace(/\((\d+)\)(?=d\d)/g, "$1");
        return `@Damage[${formula}]`;
    });
}

export function withCharacterDCs(item, dcs) {
    const html = item?.system?.description?.value;
    if (!dcs || typeof html !== "string" || !(html.includes("@Check[") || html.includes("@Damage["))) return item;
    const filled = fillCharacterNumbers(fillCharacterDCs(html, dcs), dcs, item);
    if (filled === html) return item;
    return withText(item, filled);
}

// The item itself, its actor and parent kept, with other text (as monster.js's withDescription).
export function withText(item, html) {
    const description = { ...item.system.description, value: html };
    const system = new Proxy(item.system, { get: (target, key) => (key === "description" ? description : Reflect.get(target, key)) });
    return new Proxy(item, { get: (target, key) => (key === "system" ? system : Reflect.get(target, key)) });
}
