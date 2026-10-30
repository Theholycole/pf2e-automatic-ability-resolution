// A character's feat in the third person (2026-10-30, docs/pc-feats.md). PF2e writes a PC's ability to the player ("Make a melee Strike.
// If you hit, …", "You Stride twice"), a monster's about the monster ("The ogre makes a melee Strike. If it hits, …"). The monster
// readings know the second; this puts the first in its words, so a feat the readings would read as a monster's gets their plan.
// Only the words about the user change: the conditions, checks and damage tags stay as PF2e wrote them.

// The verbs an ability starts a sentence with as an order ("Stride twice.", "Make a Strike."), with their third-person form.
const IMPERATIVES = {
    Make: "makes", Stride: "Strides", Step: "Steps", Leap: "Leaps", Climb: "Climbs", Swim: "Swims", Fly: "Flies", Burrow: "Burrows",
    Strike: "Strikes", Shove: "Shoves", Trip: "Trips", Grapple: "Grapples", Disarm: "Disarms", Reposition: "Repositions", Demoralize: "Demoralizes",
    Feint: "Feints", Interact: "Interacts", Attempt: "attempts", Choose: "chooses", Deal: "deals", Throw: "throws", Raise: "raises", Draw: "draws",
    Sustain: "Sustains", Command: "Commands", Drop: "drops", Release: "releases", Spend: "spends", Gain: "gains", Roll: "rolls"
};

// "you deal" → "it deals": the verbs a feat says the user does, by their irregular forms; others take an s.
const IRREGULAR = { are: "is", have: "has", do: "does", go: "goes", can: "can", could: "could", must: "must", may: "may", might: "might", would: "would", should: "should", will: "will", were: "was", "aren't": "isn't", "can't": "can't", "don't": "doesn't", "haven't": "hasn't", "didn't": "didn't" };
const third = (verb) => {
    if (IRREGULAR[verb.toLowerCase()]) return IRREGULAR[verb.toLowerCase()];
    if (/(?:s|sh|ch|x|z)$/.test(verb)) return `${verb}es`;
    if (/[^aeiou]y$/.test(verb)) return `${verb.slice(0, -1)}ies`;
    return `${verb}s`;
};

// One run of text outside the tags.
function voiced(text) {
    return text
        // "You Strike with your antler" / "You Strike the target": a Strike with that attack, or a plain one.
        .replace(/\bYou Strike with your ([\w' -]+?)(?=[,.;]| and | against )/g, "It makes a $1 Strike")
        .replace(/\byou Strike with your ([\w' -]+?)(?=[,.;]| and | against )/g, "it makes a $1 Strike")
        .replace(/\b([Yy])ou Strike\b/g, (_all, y) => (y === "Y" ? "It makes a Strike against" : "it makes a Strike against").replace(/ against$/, ""))
        // An order at the start of a sentence: "Make a melee Strike." → "It makes a melee Strike."
        .replace(/(^|[.!?:]\s+|<p>|\]\s*)(Make|Stride|Step|Leap|Climb|Swim|Fly|Burrow|Strike|Shove|Trip|Grapple|Disarm|Reposition|Demoralize|Feint|Interact|Attempt|Choose|Deal|Throw|Raise|Draw|Sustain|Command|Drop|Release|Spend|Gain|Roll)\b/g, (_all, lead, verb) => `${lead}It ${IMPERATIVES[verb]}`)
        // "then Stride" / "and Step" after an order: the same person.
        .replace(/\b(then|and|or) (Stride|Step|Leap|Strike|Shove|Trip|Grapple|Make|Raise|Interact)\b(?! (?:action|actions|check))/g, (_all, joint, verb) => `${joint} ${IMPERATIVES[verb]}`)
        // "you deal", "You can", "you're": the user as it.
        .replace(/\b([Yy])ou're\b/g, (_all, y) => (y === "Y" ? "It's" : "it's"))
        .replace(/\b([Yy])ou've\b/g, (_all, y) => (y === "Y" ? "It has" : "it has"))
        .replace(/\b([Yy])ou (?:also )?([a-z]+(?:n't)?)\b/g, (all, y, verb) => {
            if (/^(?:a|an|the|and|or|to|in|on|at|with|by|of|for|as|from|that|this|it|its|your|you)$/.test(verb)) return all;
            return `${y === "Y" ? "It" : "it"} ${third(verb)}`;
        })
        .replace(/\byourself\b/g, "itself")
        .replace(/\bYour\b/g, "Its")
        .replace(/\byour\b/g, "its")
        .replace(/\bYou\b/g, "It")
        .replace(/\byou\b/g, "it");
}

// The description in the third person; the inline tags ("@Check[…]", "@UUID[…]{…}", "[[/act …]]") and the markup untouched.
export function thirdPerson(html) {
    if (typeof html !== "string" || !/\byou(?:r)?\b|^\s*(?:<p>)?\s*(?:Make|Stride|Step)\b/i.test(html)) return html;
    // Each tag, with its label, kept whole; the words between them voiced.
    const parts = html.split(/(@\w+\[(?:[^\[\]]|\[(?:[^\[\]]|\[[^\]]*\])*\])*\](?:\{[^}]*\})?|\[\[[^\]]*\]\](?:\{[^}]*\})?|<[^>]+>)/g);
    let out = "";
    for (let index = 0; index < parts.length; index++) {
        const part = parts[index];
        if (index % 2) out += part;
        // A tag in the middle of a sentence keeps the sentence: the text after it is voiced from its own start only where a sentence starts.
        else out += voiced(part);
    }
    return out;
}

// A feat's opening flavour ("You channel disruptive power that severs a foe's spiritual connection to their magic."): the sentences before
// its first rule, which the readings would stop at. A sentence is a rule once it has a tag or a game word.
export const RULE_WORDS = /@\w+\[|\[\[|\b(?:Strikes?|Strides?|Steps?|Leaps?|damage|checks?|saves?|saving throws?|DC|bonus|penalty|hits?|feet|actions?|reactions?|rounds?|turns?|minutes?|Hit Points|off-guard|prone|grabbed|frightened|attempts?|Speed|AC|weapon|unarmed|shield|spell|Interact|Raise|Requirements?|Frequency|Trigger)\b/;
export function withoutFlavour(html) {
    if (typeof html !== "string") return html;
    // The first paragraph that isn't a Requirements, Frequency or Trigger block.
    return html.replace(/<p>(?!\s*<strong>\s*(?:Requirements?|Frequency|Trigger|Prerequisites?|Access|Cost)\b)([\s\S]*?)<\/p>/i, (all, body) => {
        const sentences = body.split(/(?<=[.!?])\s+(?=[A-Z@<])/);
        let first = 0;
        while (first < sentences.length - 1 && !RULE_WORDS.test(sentences[first])) first++;
        return first ? `<p>${sentences.slice(first).join(" ")}</p>` : all;
    });
}

export function inThirdPerson(item) {
    const html = item?.system?.description?.value;
    const voicedHtml = thirdPerson(withoutFlavour(html));
    if (voicedHtml === html) return item;
    const description = { ...item.system.description, value: voicedHtml };
    const system = new Proxy(item.system, { get: (target, key) => (key === "description" ? description : Reflect.get(target, key)) });
    return new Proxy(item, { get: (target, key) => (key === "system" ? system : Reflect.get(target, key)) });
}
