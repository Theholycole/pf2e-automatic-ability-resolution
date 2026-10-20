// An early end when the creature Escapes (2026-10-20, src/compiler/row-extras.js's escape { dc }: "for 1 minute or until it Escapes (DC 27)",
// "The ammunition's effects last until the target Escapes"): the Effects a card made for it — a penalty's, a condition's — carry
// flags[moduleId].escape { dc }, and a successful Escape check against that DC ends them (scripts/escape.js). And a misfortune for one roll
// (a note Effect flagged once, PF2e's RollTwice): gone after the roll it made worse, when PF2e doesn't remove it itself. Pure.

// The ids of the actor's items (items: [{ id, flags }]) an Escape check's message ended. context: PF2e's message context ({ options, outcome,
// dc }); total: the roll's total. A DC in the message must be the item's own (the Escape was against it) and the check a success; with none,
// the total against the item's DC.
export function escapedItems(items, context, total, moduleId) {
    if (!(context?.options ?? []).includes("action:escape")) return [];
    const dc = Number(context.dc?.value);
    const against = Number.isFinite(dc) && dc > 0;
    if (against && !["success", "criticalSuccess"].includes(context.outcome)) return [];
    return (items ?? []).filter((item) => {
        const own = Number(item?.flags?.[moduleId]?.escape?.dc);
        if (!Number.isFinite(own) || own <= 0) return false;
        return against ? dc === own : Number.isFinite(Number(total)) && Number(total) >= own;
    }).map((item) => item.id);
}

// The one-roll misfortunes a check rolled twice used up: the ids of the actor's Effects flagged once whose RollTwice selector the roll's
// domains hold. kept: whether the roll kept one of two dice.
export function spentOnce(items, context, kept, moduleId) {
    if (!kept) return [];
    const domains = context?.domains ?? [];
    return (items ?? []).filter((item) => item?.flags?.[moduleId]?.once && (item.system?.rules ?? []).some((rule) => rule?.key === "RollTwice" && [].concat(rule.selector ?? []).some((selector) => domains.includes(selector)))).map((item) => item.id);
}

// What an Effect that ends so says, after its own words: "It ends when the creature Escapes (DC 18): [[/act escape dc=18]]{Escape}."
export const escapeWords = (escape) => (Number(escape?.dc) > 0 ? ` It ends when the creature Escapes (DC ${Number(escape.dc)}): [[/act escape dc=${Number(escape.dc)}]]{Escape}.` : "");
