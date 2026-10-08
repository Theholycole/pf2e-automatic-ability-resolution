// When a monster's aura acts, from its text (the live cards' triggers):
// - "enter": a creature enters it ("enters", "entering", "moves into")
// - "start-turn": a creature starts its turn in it ("starts its turn", "begins their turn", "at the start of their turn")
// - "end-turn": a creature ends its turn in it
// Monster Core: an aura that does nothing but deal damage hits a creature that
// enters it or starts its turn in it, and only once per round. An aura with no
// timing that does more than damage (one that acts when a creature Casts a
// Spell) gets none: live play leaves it to the GM.

const INLINE = /@\w+\[(?:[^[\]]|\[[^\]]*\])*\](?:\{[^}]*\})?/g;

// Its text without the leading radius ("20 feet.").
const body = (plain) => String(plain ?? "").replace(/\s+/g, " ").trim().replace(/^\d+ feet\.\s*/i, "");

// "@Damage[4d6[fire]] damage (@Check[reflex|dc:37|basic] save)", with nothing else in its first sentence.
export function damageOnly(plain) {
    const text = body(plain);
    if (!/^@Damage\[/i.test(text)) return false;
    const first = text.replace(INLINE, " ").split(/\.(?:\s|$)/)[0];
    return !/[a-z]/i.test(first.replace(/\b(?:damage|basic|save|saving throw)\b/gi, ""));
}

export function readAuraTiming(plain) {
    const text = body(plain);
    const when = [];
    if (/\b(?:enters?|entering|moves? into)\b/i.test(text)) when.push("enter");
    if (/\b(?:starts?|starting|begins?|beginning) (?:its|their|his|her|your) turns?\b|\bstart of (?:its|their|his|her|each of its) turns?\b/i.test(text)) when.push("start-turn");
    if (/\b(?:ends?|ending) (?:its|their|his|her|your) turns?\b/i.test(text)) when.push("end-turn");
    if (when.length) return { when };
    return damageOnly(plain) ? { when: ["enter", "start-turn"], oncePerRound: true } : { when: [] };
}

// "After the dragon uses their Poison Breath, a cloud … for 1 round": the aura
// acts only for that long after the named ability. → { ability, rounds } or null.
export function readActiveAfter(plain) {
    const match = /^After the [^,]+? uses (?:their|its|his|her) ([A-Z][\w' -]+?), [^.]*?\bfor (\d+|one) rounds?\b/i.exec(body(plain));
    return match ? { ability: match[1].trim(), rounds: /^\d+$/.test(match[2]) ? Number(match[2]) : 1 } : null;
}
