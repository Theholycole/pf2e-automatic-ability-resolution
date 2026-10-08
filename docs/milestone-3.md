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
- **Tests:** 55 core, 104 simulator, 9 here.

The simulator's defaults are in `../PF2e COMBAT SIMULATOR/docs/ability-decisions.md`. The user confirmed B1–B6 and B7–B11 (below) on 2026-10-08.

**Checked live (2026-10-08):** after a Foundry restart the user approved, the module is enabled in `pftest`.
- The basic actions load from `pf2e.actionspf2e`; the pack is named `pf2e.actions` only on disk.
- A monster gets only the basic actions for skills its stat block lists. Its prepared data lists every skill, so they're read from its source data.
- A PFTEST SIM Giant Anaconda grabs, then uses Greater Constrict only on creatures it holds.

## The other skill actions (2026-10-08, at the user's request)

- **Disarm:** a critical success is `{ kind: "disarm", what: "drop" }`, a success `{ what: "weaken", penalty: 2 }`. The core passes them on as `effect` changes of kind `disarm`.
- **Feint:** off-guard with a `scope` (`against: "actor"`, `attacks: "melee"`, `uses`). The core turns it into `scope.attacker`, so only the feinter's attacks gain. A critical failure is scoped the other way (`recipient: "self"`, `against: "target"`).
- **Create a Diversion:** Deception against each watcher's Perception DC, up to 6 creatures within 30 feet. A success makes the watcher off-guard to the next attack (any, 1 use). It counts as an immunity, so one try per creature.
- **Administer First Aid:** Medicine against `stabilize` (5 + 15 + dying), only on a dying creature (`targeting.dying`). A success ends dying with `stabilize`; a critical failure is dying +1. Stopping bleeding comes later.
- **Reposition:** compiles with no effects. A move within reach changes nothing in the simulator's bands.

## More monster abilities (2026-10-08, the user: "keep working on monster abilities")

Chosen from a survey of what still compiled to nothing in Monster Core 1–2 and NPC Core, by how often it appears and how much it changes a fight.

- **Plans:**
  - Swallow Whole: Athletics against Reflex on a creature it holds; a success deals the listed damage and gives `{ kind: "swallow", damage, rupture, size }`, which the core passes on as an `effect` change.
  - Trample: a basic Reflex save against the listed Strike's damage. The Strike's damage rolls come from the creature (`actor` option, or `item.actor` in Foundry).
  - Stench: an aura like Frightful Presence.
  - Afflictions (`afflictions.js`): the stages read into damage, conditions and durations, as `resolution.afflictionHandoff`. A failure afflicts at stage 1, a critical failure at stage 2, and the core's `affliction` change carries it. A Strike that lists the affliction delivers it, for free.
- **Builtins** (`builtins.js`, the simulator plays them as its own rules):
  - `strike-extra`: Sneak Attack, Pack Attack and dice against the living, the undead or the frightened, from DamageDice rules
  - `save-bonus`: from FlatModifier rules with a predicate
  - `regeneration` and `fast-healing`: from the FastHealing rule
  - `multi-strike`: Draconic Frenzy
  - `charge`: Pounce
  - `momentum`: Draconic Momentum
- **Prose saves** ("must succeed at a save or become …", "A creature that fails its save is …"): read in `inlineSave` when there are no outcome sections, about 130 more abilities.
- **Simulator defaults:** B12–B21 in the decisions doc, which the user confirmed on 2026-10-08.
- **Checked live (pftest):** the snapshot reads all of these from PFTEST SIM copies of the Giant Scorpion, Megalodon, Elephant, Forest Troll, Horned Dragon (Young), Smilodon and Wererat. Trample finds its Strike through `item.actor`. Sizes, the builtins and the venom come through, and 200 fights per monster run in the worker in 0.7–1.7 seconds.
- **A fix:** riders listed as "improved-grab" on real Strikes now fire. Before, the rider looked only for "grab".

**Next:** reactions (Nimble Dodge and the like), charges with extra effects, Engulf, the Retch action, healing outside spells (Battle Medicine, potions), Stop Bleeding, and live-play confirmation cards.
