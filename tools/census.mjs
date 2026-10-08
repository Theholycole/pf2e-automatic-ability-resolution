#!/usr/bin/env node
// Census of non-spell abilities in PF2e's compendiums: what the ability
// module would have to automate, sorted into rule families.
//
// Usage: node tools/census.mjs [packsDirectory]
// Writes reports/census.json; docs/census.md is written from it by hand-checked
// templates in tools/census-report.mjs.

import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { readDocuments } from "./leveldb.mjs";

const packsDirectory = path.resolve(process.argv[2] ?? `${process.env.HOME}/.local/share/FoundryVTT/Data/systems/pf2e/packs`);
const outputDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../reports");

const SKILLS = "acrobatics|arcana|athletics|crafting|deception|diplomacy|intimidation|medicine|nature|occultism|performance|religion|society|stealth|survival|thievery|perception|lore";
const SENSES = new Set(["darkvision", "greater-darkvision", "low-light-vision", "scent", "tremorsense", "lifesense", "wavesense", "thoughtsense", "all-around-vision", "telepathy", "echolocation", "motion-sense", "spiritsense", "light-blindness"]);
// Glossary abilities the simulator already handles itself.
const BUILT_IN = new Set(["attack-of-opportunity", "reactive-strike", "shield-block"]);

// PF2e's standard monster abilities (bestiary-ability-glossary-srd). NPC copies
// point at the glossary text with @Localize instead of containing it, so they
// are classified by hand. Senses and the built-in reactions are handled above.
const GLOSSARY_FAMILIES = {
    "grab": "strike", "improved-grab": "strike", "knockdown": "strike", "improved-knockdown": "strike",
    "push": "strike", "improved-push": "strike", "pull": "strike", "rend": "strike", "power-attack": "strike",
    "throw-rock": "strike", "retributive-strike": "strike", "sneak-attack": "passive-conditional",
    "constrict": "save", "greater-constrict": "save", "trample": "save", "buck": "save", "engulf": "save",
    "swallow-whole": "save", "frightful-presence": "aura", "aura": "aura", "stench": "aura",
    "fast-healing": "healing", "regeneration": "healing", "void-healing": "passive-always",
    "ferocity": "other-structured", "nimble-dodge": "other-structured", "catch-rock": "other-structured",
    "aquatic-ambush": "strike", "disease": "affliction", "poison": "affliction",
    "constant-spells": "spells", "at-will-spells": "spells", "change-shape": "utility", "coven": "spells",
    "swarm-mind": "passive-always", "troop-defenses": "troop", "troop-movement": "troop", "form-up": "troop",
    "change-formation": "troop", "master-s-eye": "utility"
};

export const FAMILIES = [
    ["healing", "Healing (including fast healing and regeneration)"],
    ["skill-check", "Check against a DC (Trip, Demoralize pattern)"],
    ["save", "Saving throw (area or target)"],
    ["strike", "Strike rider or Strike variant (Grab, Knockdown, Power Attack)"],
    ["aura", "Aura or emanation"],
    ["stance", "Stance"],
    ["movement", "Movement"],
    ["affliction", "Affliction (disease, poison)"],
    ["troop", "Troop rules"],
    ["spells", "Spellcasting (spell module)"],
    ["utility", "Utility, no combat effect"],
    ["out-of-combat", "Exploration or downtime"],
    ["sense", "Sense, no combat effect"],
    ["built-in", "Already built into the simulator"],
    ["passive-always", "Passive, always on (PF2e already applies it to the stat block)"],
    ["passive-conditional", "Passive, conditional rule elements (needs simulation)"],
    ["passive-text", "Passive, text only"],
    ["other-structured", "Other, with inline checks, damage or conditions"],
    ["other-prose", "Other, prose only"]
];

// Rule elements PF2e applies to the stat block unconditionally show up in the
// simulator's snapshot already; predicated ones depend on the situation.
function conditionalRules(rules) {
    return rules.some((rule) => (Array.isArray(rule.predicate) && rule.predicate.length) || (rule.predicate && typeof rule.predicate === "object" && Object.keys(rule.predicate).length) || ["DamageDice", "Note", "RollOption", "AdjustDegreeOfSuccess", "EphemeralEffect"].includes(rule.key));
}

function slugify(text) {
    return String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function textOf(item) {
    return String(item.system?.description?.value ?? "");
}

function traitsOf(item) {
    return item.system?.traits?.value ?? [];
}

function conditionsIn(text) {
    const names = new Set();
    for (const match of text.matchAll(/conditionitems\.Item\.[A-Za-z0-9]+\]\{([^}]+)\}/g)) names.add(match[1].replace(/\s*\d+$/, "").trim().toLowerCase());
    for (const match of text.matchAll(/inflicts:([a-z-]+)/g)) names.add(match[1]);
    return [...names];
}

// activated: consumables have no action type; they are used through their text.
export function analyse(item, { activated = false } = {}) {
    const text = textOf(item);
    const traits = traitsOf(item);
    const slug = item.system?.slug ?? slugify(item.name);
    const actionType = activated ? "activate" : (item.system?.actionType?.value ?? "passive");
    const rules = item.system?.rules ?? [];
    const checks = [...text.matchAll(/@Check\[([a-z-]+)/gi)].map((match) => match[1].toLowerCase());
    const actChecks = [...text.matchAll(/\[\[\/act ([a-z-]+)/gi)].map((match) => match[1].toLowerCase());
    const facts = {
        slug,
        actionType,
        traits,
        ruleKeys: [...new Set(rules.map((rule) => rule.key))],
        saves: checks.filter((check) => /^(fortitude|reflex|will)$/.test(check)),
        skillChecks: [...checks.filter((check) => new RegExp(`^(${SKILLS})`).test(check)), ...actChecks],
        flatChecks: checks.filter((check) => check === "flat"),
        inlineDamage: (text.match(/@Damage\[/g) ?? []).length,
        conditions: conditionsIn(text),
        degreeTable: /Critical Success/i.test(text) && /Failure/i.test(text),
        frequency: !!item.system?.frequency,
        glossary: String(item._stats?.compendiumSource ?? "").includes("bestiary-ability-glossary-srd")
    };
    facts.family = familyOf(item, facts, text);
    facts.structured = facts.saves.length + facts.skillChecks.length + facts.inlineDamage + facts.conditions.length + facts.ruleKeys.length > 0 || facts.degreeTable || facts.glossary;
    return facts;
}

function glossarySlug(facts) {
    // Glossary copies keep the glossary's slug, sometimes with a suffix ("regeneration-10").
    if (GLOSSARY_FAMILIES[facts.slug]) return facts.slug;
    const base = Object.keys(GLOSSARY_FAMILIES).find((slug) => facts.slug.startsWith(`${slug}-`));
    return facts.glossary || base ? base ?? facts.slug : null;
}

function familyOf(item, facts, text) {
    const plain = text.replace(/<[^>]+>/g, " ");
    const rules = item.system?.rules ?? [];
    if (BUILT_IN.has(facts.slug)) return "built-in";
    if (SENSES.has(facts.slug) || [...SENSES].some((sense) => facts.slug.startsWith(`${sense}-`))) return "sense";
    const glossary = glossarySlug(facts);
    if (glossary && GLOSSARY_FAMILIES[glossary]) return GLOSSARY_FAMILIES[glossary];
    if (facts.traits.includes("exploration") || facts.traits.includes("downtime")) return "out-of-combat";
    if (facts.ruleKeys.includes("FastHealing")) return "healing";
    if (facts.traits.includes("healing") || /\bregains?\b[^.]{0,60}\bHit Points\b/i.test(plain) || /\brestores?\b[^.]{0,40}\bHit Points\b/i.test(plain)) return "healing";
    if (facts.traits.includes("stance")) return "stance";
    if (facts.traits.includes("aura") || /\baura\b/i.test(item.name)) return "aura";
    if (facts.traits.includes("disease") || facts.traits.includes("poison") && /\bStage 1\b/.test(plain)) return "affliction";
    if (facts.actionType === "passive" && !facts.saves.length && !facts.skillChecks.length && !facts.inlineDamage) {
        if (!facts.ruleKeys.length) return "passive-text";
        return conditionalRules(rules) ? "passive-conditional" : "passive-always";
    }
    if (facts.skillChecks.length) return "skill-check";
    if (facts.saves.length) return "save";
    if (/\bStrikes?\b/.test(plain)) return "strike";
    if (facts.traits.includes("move") || /^(stride|step|leap|fly|climb|swim|burrow|crawl)\b/i.test(item.name)) return "movement";
    return facts.inlineDamage || facts.conditions.length || facts.ruleKeys.length || facts.degreeTable ? "other-structured" : "other-prose";
}

function countBy(values) {
    const counts = {};
    for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
    return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function summarise(analysed) {
    return {
        total: analysed.length,
        byFamily: countBy(analysed.map((entry) => entry.family)),
        byActionType: countBy(analysed.map((entry) => entry.actionType)),
        structured: analysed.filter((entry) => entry.structured).length,
        withDegreeTable: analysed.filter((entry) => entry.degreeTable).length,
        conditions: countBy(analysed.flatMap((entry) => entry.conditions))
    };
}

function packDirectories() {
    return readdirSync(packsDirectory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

function itemsOf(pack, type) {
    return readDocuments(path.join(packsDirectory, pack)).filter((doc) => doc.collection === "items" && (!type || doc.type === type));
}

const report = { generated: new Date().toISOString(), packsDirectory, sources: {} };

// 1. Basic and class actions.
const actions = itemsOf("actions", "action").map((item) => ({ name: item.name, category: item.system?.category ?? null, ...analyse(item) }));
report.sources.actions = { ...summarise(actions), byCategory: countBy(actions.map((entry) => entry.category ?? "none")) };
report.basicActions = actions.filter((entry) => !entry.traits.some((trait) => /^(class|archetype)$/.test(trait))).map((entry) => ({ name: entry.name, family: entry.family, actionType: entry.actionType, skillChecks: entry.skillChecks, saves: entry.saves, conditions: entry.conditions }));

// 2. Feats and class features.
const feats = itemsOf("feats", "feat").map((item) => ({ name: item.name, category: item.system?.category ?? "none", ...analyse(item) }));
report.sources.feats = { ...summarise(feats), byCategory: countBy(feats.map((entry) => entry.category)) };
report.sources.featsWithActions = summarise(feats.filter((entry) => entry.actionType !== "passive"));
const classFeatures = itemsOf("class-features").filter((item) => item.type === "feat" || item.type === "action").map((item) => ({ name: item.name, ...analyse(item) }));
report.sources.classFeatures = summarise(classFeatures);
const familiar = itemsOf("familiar-abilities").map((item) => ({ name: item.name, ...analyse(item) }));
report.sources.familiarAbilities = summarise(familiar);

// 3. Monster abilities across every NPC pack.
const monsterAbilities = new Map();
const attackEffects = new Map();
let creatures = 0;
const npcPacks = [];
for (const pack of packDirectories()) {
    let documents;
    try {
        documents = readDocuments(path.join(packsDirectory, pack));
    } catch (error) {
        console.warn(`skipping ${pack}: ${error.message}`);
        continue;
    }
    const npcs = documents.filter((doc) => doc.collection === "actors" && doc.type === "npc");
    if (!npcs.length) continue;
    npcPacks.push({ pack, creatures: npcs.length });
    creatures += npcs.length;
    for (const npc of npcs) {
        for (const item of npc.items ?? []) {
            if (item.type === "melee") {
                for (const effect of item.system?.attackEffects?.value ?? []) attackEffects.set(effect, (attackEffects.get(effect) ?? 0) + 1);
                continue;
            }
            if (item.type !== "action") continue;
            const facts = analyse(item);
            const entry = monsterAbilities.get(facts.slug) ?? { slug: facts.slug, name: item.name, count: 0, packs: new Set(), ...facts };
            entry.count++;
            entry.packs.add(pack);
            monsterAbilities.set(facts.slug, entry);
        }
    }
}
const monsterList = [...monsterAbilities.values()].map((entry) => ({ ...entry, packs: entry.packs.size })).sort((a, b) => b.count - a.count);
const occurrences = (filter) => monsterList.filter(filter).reduce((sum, entry) => sum + entry.count, 0);
report.sources.monsters = {
    creatures,
    packs: npcPacks.length,
    distinctAbilities: monsterList.length,
    abilityOccurrences: occurrences(() => true),
    glossaryOccurrences: occurrences((entry) => entry.glossary),
    occurrencesByFamily: Object.fromEntries(FAMILIES.map(([key]) => [key, occurrences((entry) => entry.family === key)]).filter(([, value]) => value)),
    distinctByFamily: countBy(monsterList.map((entry) => entry.family)),
    oneOffAbilities: monsterList.filter((entry) => entry.count === 1).length
};
report.topMonsterAbilities = monsterList.slice(0, 80).map((entry) => ({ name: entry.name, slug: entry.slug, count: entry.count, family: entry.family, actionType: entry.actionType, glossary: entry.glossary }));
report.attackEffects = [...attackEffects].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([name, count]) => ({ name, count }));

// 4. Consumables.
const consumables = itemsOf("equipment", "consumable").map((item) => ({ name: item.name, category: item.system?.category ?? "none", level: item.system?.level?.value ?? 0, ...analyse(item, { activated: true }) }));
const spellModule = new Set(["scroll", "wand"]);
const ours = consumables.filter((entry) => !spellModule.has(entry.category));
report.sources.consumables = {
    ...summarise(ours),
    byCategory: countBy(consumables.map((entry) => entry.category)),
    leftToSpellModule: consumables.filter((entry) => spellModule.has(entry.category)).length
};
report.healingConsumables = ours.filter((entry) => entry.family === "healing").map((entry) => ({ name: entry.name, category: entry.category, level: entry.level })).sort((a, b) => a.level - b.level);

// Healing that can happen in combat (family 2 of the plan).
const inCombat = (entry) => entry.actionType !== "passive" && !entry.traits.includes("exploration") && !entry.traits.includes("downtime");
report.healing = {
    actions: actions.filter((entry) => entry.family === "healing" && inCombat(entry)).map((entry) => entry.name),
    feats: feats.filter((entry) => entry.family === "healing" && inCombat(entry)).map((entry) => ({ name: entry.name, category: entry.category, actionType: entry.actionType })),
    classFeatures: classFeatures.filter((entry) => entry.family === "healing").map((entry) => entry.name),
    monsterOccurrences: report.sources.monsters.occurrencesByFamily.healing ?? 0,
    consumablesByCategory: countBy(report.healingConsumables.map((entry) => entry.category))
};

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(path.join(outputDirectory, "census.json"), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(path.join(outputDirectory, "..", "docs", "census.md"), renderMarkdown(report));

function renderMarkdown(r) {
    const s = r.sources;
    const label = Object.fromEntries(FAMILIES);
    const pct = (part, whole) => `${Math.round((100 * part) / Math.max(1, whole))}%`;
    const familyTable = (counts, total) => [
        "| Family | Count | Share |",
        "|---|---:|---:|",
        ...Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([key, value]) => `| ${label[key] ?? key} | ${value} | ${pct(value, total)} |`)
    ].join("\n");
    const monsters = s.monsters;
    const top = r.topMonsterAbilities.slice(0, 40).map((entry) => `| ${entry.name} | ${entry.count} | ${label[entry.family] ?? entry.family} |`).join("\n");
    return `# Ability census

Generated by \`tools/census.mjs\` from PF2e ${"8.5.0"}'s compendiums on ${r.generated.slice(0, 10)}. Families are sorted by text and data patterns (see the script), so treat them as a first pass, not a final classification.

## Summary

| Source | Items | Structured (inline checks, damage, conditions, rules or result tables) |
|---|---:|---:|
| Basic and class actions | ${s.actions.total} | ${s.actions.structured} (${pct(s.actions.structured, s.actions.total)}) |
| Feats | ${s.feats.total} | ${s.feats.structured} (${pct(s.feats.structured, s.feats.total)}) |
| Class features | ${s.classFeatures.total} | ${s.classFeatures.structured} (${pct(s.classFeatures.structured, s.classFeatures.total)}) |
| Familiar abilities | ${s.familiarAbilities.total} | ${s.familiarAbilities.structured} |
| Consumables (not scrolls or wands) | ${s.consumables.total} | ${s.consumables.structured} (${pct(s.consumables.structured, s.consumables.total)}) |
| Monster abilities | ${monsters.distinctAbilities} distinct, ${monsters.abilityOccurrences} uses on ${monsters.creatures} creatures (${monsters.packs} packs) | ${monsters.glossaryOccurrences} uses (${pct(monsters.glossaryOccurrences, monsters.abilityOccurrences)}) are PF2e's standard glossary abilities |

**Monster abilities have a long tail.** ${monsters.oneOffAbilities} of the ${monsters.distinctAbilities} distinct abilities (${pct(monsters.oneOffAbilities, monsters.distinctAbilities)}) appear on only one creature. The standard glossary abilities and the shared patterns (Strike riders, saves, auras) are where automation pays off. One-off abilities need general pattern rules, like the spell module's.

## Monster abilities by family (uses)

${familyTable(monsters.occurrencesByFamily, monsters.abilityOccurrences)}

## Most common monster abilities

| Ability | Creatures | Family |
|---|---:|---|
${top}

## Strike attack effects (riders on monster Strikes)

${r.attackEffects.slice(0, 20).map((entry) => `${entry.name} ${entry.count}`).join(" · ")}

## Basic and class actions by family

${familyTable(s.actions.byFamily, s.actions.total)}

## Feats with actions or reactions, by family

${s.featsWithActions.total} of ${s.feats.total} feats are actions, reactions or free actions.

${familyTable(s.featsWithActions.byFamily, s.featsWithActions.total)}

Passive feats: ${s.feats.byFamily["passive-always"] ?? 0} always on (PF2e already applies them to the stat block), ${s.feats.byFamily["passive-conditional"] ?? 0} conditional (need simulation), ${s.feats.byFamily["passive-text"] ?? 0} text only.

## Class features by family

${familyTable(s.classFeatures.byFamily, s.classFeatures.total)}

## Consumables by category

${Object.entries(s.consumables.byCategory).map(([key, value]) => `${key} ${value}`).join(" · ")} (scrolls and wands, ${s.consumables.leftToSpellModule}, belong to the spell module).

${familyTable(s.consumables.byFamily, s.consumables.total)}

## Healing (family 2 of the plan)

- **Actions:** ${r.healing.actions.join(", ") || "none"}
- **Feats with actions (${r.healing.feats.length}):** ${r.healing.feats.slice(0, 40).map((entry) => entry.name).join(", ")}${r.healing.feats.length > 40 ? ", …" : ""}
- **Class features (${r.healing.classFeatures.length}):** ${r.healing.classFeatures.join(", ")}
- **Healing consumables (${r.healingConsumables.length}):** ${Object.entries(r.healing.consumablesByCategory).map(([key, value]) => `${key} ${value}`).join(", ")}
- **Monster healing uses:** ${r.healing.monsterOccurrences} (mostly fast healing and regeneration)
`;
}
console.log(JSON.stringify({
    actions: report.sources.actions.total,
    feats: report.sources.feats.total,
    classFeatures: report.sources.classFeatures.total,
    creatures,
    monsterAbilities: report.sources.monsters.distinctAbilities,
    consumables: report.sources.consumables.total
}));
