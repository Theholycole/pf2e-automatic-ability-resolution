# Milestone 3, first slice: monster abilities and basic actions

Chosen by the user on 2026-10-08: monster abilities next. That means save abilities (breath weapons), Strike riders (Grab, Knockdown) and the basic actions they rest on (Demoralize, Trip, Grapple, Shove, Escape). These matter in almost every fight. The full family list is in the simulator's `docs/ability-module-plan.md`.

## What PF2e's data gives us

- **Inline tags carry the numbers.** A breath weapon is `@Damage[11d8[bludgeoning]|options:area-damage]` in a `@Template[cone|distance:40]` with a `@Check[reflex|dc:33|basic]` save, and `[[/gmr 1d4 #Recharge …]]{1d4 rounds}` gives its recharge.
- **Glossary abilities carry only parameters.** Grab, Knockdown, Push, Constrict, Frightful Presence, Ferocity and Rend point at PF2e's standard wording (`@Localize[PF2E.NPC.Abilities.Glossary.Grab]`). The stat block adds just the numbers: `@Damage[(2d8+3)[bludgeoning]], @Check[fortitude|dc:23|basic]` for Constrict, `90 feet. @Check[will|dc:30]` for Frightful Presence. Each one is modelled once from the glossary text.
- **Strike riders are listed on the Strike** (`system.attackEffects.value: ["grab"]`). Grab, Knockdown and Push are "attempt to Grapple / Trip / Shove", with no multiple attack penalty. So the basic actions come first and the riders reuse them.
- **Basic actions** (the `actions` pack) have outcome sections with condition links:
  - Demoralize: Intimidation against the target's Will DC → frightened 2 / 1, target immune for 10 minutes.
  - Trip: Athletics against Reflex DC → prone (plus 1d6 bludgeoning on a critical success); you fall prone on a critical failure.
  - Grapple: Athletics against Fortitude DC → restrained / grabbed until the end of your next turn.
  - Shove: Athletics against Fortitude DC → pushed 10 / 5 feet.
  - Escape: unarmed attack, Acrobatics or Athletics against the grabber's Athletics DC.

## Pieces

1. **Core: the `check` family** (kind `check`): the actor's skill against a target's DC (`check.roll: "skill"`, `against: { dc: "target", statistic }`). Outcomes are keyed from the actor's side, as attacks are. Effects can name `recipient: "self"` (Trip's critical failure). It shares the save family's steps.
2. **Ability compiler** (this module, `src/compiler/`, pure, tested on PF2e's packs):
   - basic actions from the `actions` pack: the check from `[[/act …]]{Skill} check against the target's X DC`, outcome sections, conditions, durations, push distances and self effects
   - inline-save abilities → kind `save`, with a fixed DC, the area from `@Template`, the range from "within N feet", and the recharge
   - glossary riders → `check` plans with `trigger: { event: "strike", attackEffect, cost: "action" | "free", map: false }`
   - Constrict → `save` against "creatures it grabs"; Frightful Presence → an aura save; Ferocity and Rend → flags the engine knows
   - registers with the core (`registry.registerCompiler`) in Foundry
3. **Simulator engine:**
   - who is grabbing whom, and its end
   - Escape
   - recharge timers
   - riders after a Strike hits
   - Frightful Presence at the start of the fight
   - Ferocity, Rend and Constrict
   - basic actions as planner options
4. **Live play:** confirmation cards for every ability, as the user decided. This comes after the simulator slice.

## Status (2026-10-08)

Pieces 1–3 are built:
- **Core:** the `check` family.
- **Compiler:** 922 plans from the 5,796 abilities in Monster Core 1–2 and NPC Core, plus 200 rules the engine already plays, with no errors.
- **Simulator:** 1,106 real creatures in 3,318 fights, with no errors.
- **Tests:** 54 core, 84 simulator, 5 here.

The simulator's defaults (B1–B6), which the user confirmed on 2026-10-08, are in `../PF2e COMBAT SIMULATOR/docs/ability-decisions.md`.

**To check live:** Foundry has to be restarted to discover this module. Then it's enabled in `pftest`, and the simulator reads a monster's abilities through the core.

**Next:** Swallow Whole and Trample, then the other skill actions (Reposition, Disarm, Feint), healing outside spells (Battle Medicine, potions), and live-play confirmation cards.
