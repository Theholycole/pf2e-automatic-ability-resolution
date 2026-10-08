# PF2e Automatic Ability Resolution

The `pf2e-automatic-ability-resolution` Foundry module (milestone 3): automation for everything in PF2e that isn't a spell (basic actions, class features, feats, monster abilities, afflictions, non-spell consumables). It compiles them into plans for `pf2e-resolution-core`, which resolves them for live play and the PF2e Combat Simulator, the same way the spell module does.

- Plan and family order: [../PF2e COMBAT SIMULATOR/docs/ability-module-plan.md](../PF2e%20COMBAT%20SIMULATOR/docs/ability-module-plan.md)
- Census of what there is to automate: [docs/census.md](docs/census.md), with raw data in `reports/census.json`

**Status (2026-10-08): first slice, monster abilities.** See [docs/milestone-3.md](docs/milestone-3.md).

- **Basic actions** from PF2e's actions pack: Demoralize, Trip, Grapple, Shove, Escape. They're read from PF2e's own text: the check against a DC, outcome sections, conditions, durations, push distances, and effects on the actor itself.
- **Monster abilities:**
  - glossary riders: Grab, Improved Grab, Knockdown, Push
  - Constrict and Frightful Presence
  - breath weapons and other inline-save abilities, with their recharge
  - skill-check abilities
  - Ferocity and Rend are flagged for the simulator to play
- Compiling Monster Core 1–2 and NPC Core gives 922 plans from 5,796 abilities, with 200 more built in and no errors. Live-play confirmation cards come later.

| Path | Holds |
|---|---|
| `src/compiler/` | pure: `inline.js` (PF2e's inline syntax), `checks.js` (skill actions), `monster.js` (monster abilities), `index.js` |
| `scripts/main.js` | Foundry: registers the compiler with the core and offers the basic actions |
| `tools/` | `leveldb.mjs` (reads PF2e's packs), `census.mjs`, `spell-compiler-probe.mjs` |
| `docs/` | `census.md`, `milestone-3.md` |

## Tools

- `node tools/census.mjs` regenerates the census from the PF2e compendiums in the Foundry data folder. It takes about 2 seconds.
- `tools/leveldb.mjs` is a read-only, dependency-free reader for Foundry's LevelDB packs. It never writes, so it's safe while Foundry is running, and it doesn't need a Foundry login.

Run the tests with `node --test`.
