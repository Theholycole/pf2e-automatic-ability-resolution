# PF2e Automatic Ability Resolution (planning)

The future `pf2e-automatic-ability-resolution` module: automation for everything in PF2e that isn't a spell (basic actions, class features, feats, monster abilities, afflictions, non-spell consumables). It will work the same way as the spell module and register its rule families with the shared core, so the PF2e Combat Simulator can use them.

**Status (2026-10-08): planning only.** There is no `module.json` yet and nothing loads in Foundry. Building it needs `pf2e-resolution-core`, which is on hold until the user and the spell-automation session agree on timing.

- Plan and family order: [../PF2e COMBAT SIMULATOR/docs/ability-module-plan.md](../PF2e%20COMBAT%20SIMULATOR/docs/ability-module-plan.md)
- Census of what there is to automate: [docs/census.md](docs/census.md), with raw data in `reports/census.json`

## Tools

- `node tools/census.mjs` regenerates the census from the PF2e compendiums in the Foundry data folder. It takes about 2 seconds.
- `tools/leveldb.mjs` is a read-only, dependency-free reader for Foundry's LevelDB packs. It never writes, so it's safe while Foundry is running, and it doesn't need a Foundry login.
