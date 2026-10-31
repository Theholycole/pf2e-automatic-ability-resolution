// A creature's own numbers its abilities name by path (2026-10-30, the feat loop: Teams+ Magic's aspects, whose saves are
// "@Check[reflex|dc:resolve(@actor.flags.pf2e.aspectDC)|basic]" and damage "@Damage[(@actor.flags.pf2e.aspectRank)d6[bludgeoning]]", the
// spell's DC and rank kept on the aspect). Each "dc:resolve(…)" whose paths are all numbers becomes "dc:N", and each "@actor.flags…" path
// in a @Damage formula the number; the rest stays as it was. read(path) gives the creature's value at "@actor.…", or undefined.

const PATH = /@actor\.[\w.-]+/g;
const ARITHMETIC = /^[\d\s+\-*/().]+$/;

const number = (value) => (typeof value === "number" || (typeof value === "string" && value.trim() !== "") ? Number(value) : NaN);

function worked(expression, read) {
    let missing = false;
    const filled = expression.replace(PATH, (path) => {
        const value = number(read(path));
        if (!Number.isFinite(value)) missing = true;
        return String(value);
    });
    if (missing || !ARITHMETIC.test(filled)) return null;
    // (Digits, operators and parentheses only.)
    const value = Function(`"use strict"; return (${filled});`)();
    return Number.isFinite(value) ? Math.round(value) : null;
}

export function fillRollData(html, read) {
    if (typeof html !== "string" || typeof read !== "function" || !html.includes("@actor.")) return html;
    return html
        .replace(/(@Check\[[^\]]*?\bdc:)resolve\(((?:[^()]|\([^()]*\))*)\)/g, (all, head, expression) => {
            const value = worked(expression, read);
            return value === null ? all : `${head}${value}`;
        })
        .replace(/@Damage\[((?:[^\[\]]|\[(?:[^\[\]]|\[[^\]]*\])*\])*)\]/g, (all, inner) => {
            const filled = inner.replace(/@actor\.flags\.[\w.-]+/g, (path) => {
                const value = number(read(path));
                return Number.isFinite(value) ? String(value) : path;
            });
            return `@Damage[${filled}]`;
        });
}

// The item itself, its actor and parent kept, with other text (as monster.js's).
export function withDescription(item, html) {
    const description = { ...(item.system?.description ?? {}), value: html };
    const system = new Proxy(item.system, { get: (target, key) => (key === "description" ? description : Reflect.get(target, key)) });
    return new Proxy(item, { get: (target, key) => (key === "system" ? system : Reflect.get(target, key)) });
}
