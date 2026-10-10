// Probe: how much of each non-spell category the spell module's compiler already
// understands, by wrapping each ability in a spell-shaped shell. Read-only.
// Run: node tools/spell-compiler-probe.mjs  (2026-10-08 result: impulses 36%,
// monster abilities 23%, consumables 12%, PC feats 7% compiled into rule plans).

import { readDocuments } from "./leveldb.mjs";
// The spell module's folder sits beside this module's.
const { compileAbility } = await import(new URL("../../PF2e AUTOMATIC SPELL RESOLUTION/src/compiler/index.js", import.meta.url).href);
const P = process.env.HOME + "/.local/share/FoundryVTT/Data/systems/pf2e/packs/";
const items = (pack) => readDocuments(P + pack).filter((d) => d.collection === "items");

function evalExpr(expr, level) {
  const code = expr.replace(/@actor\.level|@item\.level|@item\.rank/g, String(level)).replace(/\bfloor\b/g, "Math.floor").replace(/\bceil\b/g, "Math.ceil").replace(/\bmax\b/g, "Math.max").replace(/\bmin\b/g, "Math.min");
  try { const v = Function(`return (${code});`)(); return Number.isFinite(v) ? v : null; } catch { return null; }
}
// "(floor((@actor.level -1)/2)+1)d6" at a level: every balanced (...)dN becomes a number of dice.
function resolveDice(formula, level) {
  let out = formula;
  for (let guard = 0; guard < 10; guard++) {
    const at = out.search(/\)d\d+/);
    if (at < 0) break;
    let depth = 0, open = -1;
    for (let i = at; i >= 0; i--) { if (out[i] === ")") depth++; else if (out[i] === "(") { depth--; if (depth === 0) { open = i; break; } } }
    if (open < 0) break;
    const n = evalExpr(out.slice(open + 1, at), level);
    out = out.slice(0, open) + String(Math.max(1, Math.round(n ?? 1))) + out.slice(at + 1);
  }
  return out.replace(/@actor\.level|@item\.level/g, String(level));
}
function damageFrom(item, level) {
  const html = item.system?.description?.value ?? "";
  const own = item.system?.damage;
  if (own && typeof own.formula === "string" && own.formula) {
    return { 0: { applyMod: false, category: null, formula: own.formula, kinds: [own.kind === "healing" ? "healing" : "damage"], materials: [], type: own.type ?? "untyped" } };
  }
  const start = html.indexOf("@Damage[");
  if (start < 0) return {};
  let depth = 0, i = start + 8, body = "";
  for (; i < html.length; i++) { const ch = html[i]; if (ch === "[") depth++; else if (ch === "]") { if (depth === 0) break; depth--; } body += ch; }
  const first = body.split("|")[0].split(/,(?![^\[]*\])/)[0];
  const typed = first.match(/^\s*(.+?)\[([a-z,]+)\]\s*$/);
  if (!typed) return {};
  let formula = resolveDice(typed[1], level).replace(/^\((.*)\)$/, "$1");
  if (/@|[a-z]{3,}/i.test(formula.replace(/d\d+/g, ""))) return {};
  const parts = typed[2].split(",");
  const healing = parts.includes("healing");
  return { 0: { applyMod: false, category: parts.includes("persistent") ? "persistent" : null, formula, kinds: [healing ? "healing" : "damage"], materials: [], type: healing ? "vitality" : parts.at(-1) } };
}
function shell(item, level) {
  const html = item.system?.description?.value ?? "";
  const plain = html.replace(/<[^>]+>/g, " ");
  const save = html.match(/@Check\[(fortitude|reflex|will)([^\]]*)\]/);
  const template = html.match(/@Template\[(?:type:)?(cone|burst|emanation|line)\|distance:(\d+)/) ?? plain.match(/Area\s+(\d+)-foot (cone|burst|emanation|line)/);
  let area = null;
  if (template) area = isNaN(template[1]) ? { type: template[1], value: Number(template[2]) } : { type: template[2], value: Number(template[1]) };
  const range = plain.match(/Range\s+([^\n]+?feet)/)?.[1] ?? "";
  const target = plain.match(/Targets?\s+([^\n]+?)(?=\s{2,}|Duration|Range|$)/)?.[1] ?? "";
  const duration = plain.match(/Duration\s+([^\n]+?)(?=\s{2,}|$)/)?.[1] ?? "";
  const actionType = item.system?.actionType?.value;
  const time = actionType === "reaction" ? "reaction" : actionType === "free" ? "free" : String(item.system?.actions?.value ?? 1);
  return {
    _id: item._id, name: item.name, type: "spell", img: item.img,
    system: {
      area, cost: { value: "" }, counteraction: false, damage: damageFrom(item, level), defense: save ? { save: { basic: /basic/.test(save[2]), statistic: save[1] } } : null,
      description: { value: html.replace(/<strong>Level \(\+(\d+)\)<\/strong>/g, (_, n) => "<strong>Heightened (+" + Math.ceil(Number(n) / 2) + ")</strong>") },
      duration: { sustained: /sustain/i.test(duration), value: duration }, heightening: null, level: { value: Math.max(1, Math.min(10, Math.ceil(level / 2))) },
      publication: item.system?.publication ?? {}, range: { value: range }, requirements: "", rules: item.system?.rules ?? [], target: { value: target }, time: { value: time },
      traits: { rarity: "common", traditions: [], value: item.system?.traits?.value ?? [] }, slug: item.system?.slug ?? null
    }
  };
}
function sample(list, n) { const out = []; const step = Math.max(1, list.length / n); for (let i = 0; i < list.length && out.length < n; i += step) out.push(list[Math.floor(i)]); return out; }

const feats = items("feats").filter((f) => f.type === "feat");
const classFeatures = items("class-features");
const isImpulse = (i) => (i.system?.traits?.value ?? []).includes("impulse");
const active = (i) => ["action", "reaction", "free"].includes(i.system?.actionType?.value);
const categories = {};
categories["Kineticist impulses"] = [...feats.filter(isImpulse), ...classFeatures.filter(isImpulse), ...items("actions").filter(isImpulse)].map((i) => ({ item: i, level: i.system?.level?.value ?? 1 }));
const monsters = [...readDocuments(P + "pathfinder-monster-core"), ...readDocuments(P + "pathfinder-monster-core-2")].filter((d) => d.type === "npc");
const seen = new Set(); const monsterAbilities = [];
for (const m of monsters) for (const i of m.items ?? []) { if (i.type !== "action" || !active(i)) continue; const key = `${i.name}|${(i.system.description?.value ?? "").slice(0, 200)}`; if (seen.has(key)) continue; seen.add(key); monsterAbilities.push({ item: i, level: m.system?.details?.level?.value ?? 1 }); }
categories["Monster abilities (active)"] = sample(monsterAbilities, 600);
categories["Player feats (active)"] = sample(feats.filter((f) => active(f) && !isImpulse(f)).map((i) => ({ item: i, level: i.system?.level?.value ?? 1 })), 600);
const consumables = items("equipment").filter((i) => i.type === "consumable" && !["scroll", "wand"].includes(i.system?.category));
categories["Items (consumables)"] = sample(consumables.map((i) => ({ item: i, level: i.system?.level?.value ?? 1 })), 600);

const NOTE_KINDS = new Set(["spell-note", "condition-note", "unsupported"]);
for (const [name, list] of Object.entries(categories)) {
  const levels = {}; const kinds = {}; let errors = 0, structured = 0, automated = 0, partial = 0;
  const t0 = Date.now();
  for (const { item, level } of list) {
    let plan;
    try { plan = compileAbility(shell(item, level), {}); } catch { errors++; continue; }
    const lvl = plan.automation?.level ?? "?"; levels[lvl] = (levels[lvl] ?? 0) + 1;
    const kind = plan.resolution?.kind ?? "none"; kinds[kind] = (kinds[kind] ?? 0) + 1;
    if (!NOTE_KINDS.has(kind) && ["automatic", "prompted"].includes(lvl)) automated++;
    else if (!NOTE_KINDS.has(kind) && lvl === "guided") partial++;
    if (/@Check\[|@Damage\[|conditionitems|<strong>Critical Success/.test(item.system?.description?.value ?? "")) structured++;
  }
  const n = list.length;
  console.log(`\n== ${name}: ${n} sampled, ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(`   structured text ${Math.round(100 * structured / n)}% | compiled fully ${Math.round(100 * automated / n)}% | partly ${Math.round(100 * partial / n)}% | note or unsupported ${Math.round(100 * (n - automated - partial - errors) / n)}% | errors ${errors}`);
  console.log("   levels", JSON.stringify(levels));
  console.log("   top kinds", JSON.stringify(Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 8)));
}
