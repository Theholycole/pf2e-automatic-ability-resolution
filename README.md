# PF2e Automatic Ability Resolution

The `pf2e-automatic-ability-resolution` Foundry module (milestone 3): automation for everything in PF2e that isn't a spell or an item (basic actions, class features, feats, monster abilities, afflictions). Items (consumables, weapons, armor, worn items) will get their own module later (the user, 2026-10-10). It compiles them into plans for `pf2e-resolution-core`, which resolves them for live play and the PF2e Combat Simulator, the same way the spell module does.

- Plan and family order: [the simulator's docs/ability-module-plan.md](https://github.com/Theholycole/pf2e-combat-simulator/blob/main/docs/ability-module-plan.md)
- Census of what there is to automate: [docs/census.md](docs/census.md), with raw data in `reports/census.json`

## Install

In Foundry go to **Add-on Modules → Install Module**, paste this manifest URL and click **Install**:

```
https://github.com/Theholycole/pf2e-automatic-ability-resolution/releases/latest/download/module.json
```

It needs **PF2e Resolution Core**, which Foundry offers to install with it. Foundry 14 and the PF2e system 8.5 or later. For afflictions it hands the stages to the **Pseudo Afflictions** module when that's active. MIT licensed (see [LICENSE](LICENSE)); the Pathfinder rules text it reads comes from the PF2e system under Paizo's ORC license.

**Status (2026-10-08): first slice, monster abilities.** See [docs/milestone-3.md](docs/milestone-3.md).

- **Basic actions** from PF2e's actions pack: Demoralize, Trip, Grapple, Shove, Escape, Disarm, Feint, Create a Diversion, Administer First Aid (to stabilize) and Reposition. They're read from PF2e's own text: the check against a DC, outcome sections, conditions, durations, push distances, and effects on the actor itself. Disarm, Feint, Create a Diversion and First Aid get their non-condition results (a dropped weapon, off-guard to one creature, stabilizing) from `checks.js`.
- **Monster abilities:**
  - glossary riders: Grab, Improved Grab, Knockdown, Push
  - Constrict and Frightful Presence
  - breath weapons and other inline-save abilities, with their recharge
  - skill-check abilities
  - Swallow Whole, Trample, Stench, and creature afflictions with their stages (`afflictions.js`)
  - Ferocity, Rend, Sneak Attack, Pack Attack, Regeneration, Fast Healing, Draconic Frenzy, Pounce, Draconic Momentum and save bonuses against magic are flagged as builtins for the simulator to play (`builtins.js`)
- Compiling Monster Core 1–2 and NPC Core gives 922 plans from 5,796 abilities, with 200 more built in and no errors. Live-play confirmation cards come later.
- **Other publishers' monsters** (2026-10-10): the Battlezoo bestiaries by Roll For Combat (Bestiary, Strange and Unusual, Elemental Storm, and the Battle, Fairy, Leshy and Misfit dragons) compile like PF2e's own.
  - Their older inline syntax is read as PF2e's current syntax: `[[/r 2d6[fire]]]` damage rolls, `@Compendium[…]` links (by ID or by name), and "basic" written only in a check's label or before it.
  - Of their 4,910 abilities, 1,353 get a card and 571 are built in. Before, it was 1,221 and 562, and some of those plans were wrong.
  - Their text isn't copied here: the tests read the installed modules and are skipped without them.
- **Readings shared by all monsters** (2026-10-10), which also changed about 1,300 plans in PF2e's own books:
  - A basic save's damage is only the damage in the save's own sentence. Riders after it now count: "A creature that fails is also knocked Prone", "Creatures that critically fail also take 1d6 persistent fire".
  - "For 1d4 rounds" is rolled when the card is applied; the simulator uses the average.
  - The GM is left to decide a choice of conditions ("Enfeebled 1, Clumsy 1, or Stupefied 1"), along with conditional and negated conditions.
  - A push is played only when it's away from the monster. A pull is played when it's toward the monster.
- **Several ways and action counts** (2026-10-10, batch 3):
  - An ability used "in one of two ways" gets a card where the GM picks the way. The simulator plays each way, with one recharge between them.
  - A troop's damage "depends on the number of actions": the GM picks 1, 2 or 3 actions on the card.
  - The card names, per target, what it leaves to the GM: damage that happens only "if…", splash on nearby creatures, results it can't apply (a creature that loses its reactions for a while).
  - Since batch 1's commit: PF2e's bestiaries give 8,051 cards (was 7,675) plus 52 cards with a choice of ways; Monster Core and NPC Core give 1,336 (was 1,278) plus 3. Battlezoo gives 1,348 plus 74 with a choice of ways (was 1,353, some of them only one of the ways).
  - See [docs/live-play.md](docs/live-play.md#abilities-with-several-ways-troops-action-counts-and-notes-for-the-gm-2026-10-10).
- **Effects and glossary abilities** (2026-10-10, batch 4):
  - An ability whose one result is a PF2e effect (Battle Cry, Raise Guard, Fiery Rhetoric) gets an effect card that applies it to the monster, its allies or a target, as its text says.
  - Retributive Strike is offered to the GM when a foe damages the monster's ally; Pull is a rider like Push; Form Up and Catch Rock change nothing in a fight.
  - Since batch 3's commit: 165 abilities apply an effect (27 of them in Monster Core and NPC Core, 9 Battlezoo), 90 more are built in, 19 more get a card.
  - See [docs/live-play.md](docs/live-play.md#effects-retributive-strike-pull-and-other-glossary-abilities-2026-10-10-batch-4).
- **Checks with prose results** (2026-10-10, batch 5): a monster's check against a creature's DC whose results are sentences ("On a success, the target is Confused …", "Clumsy 1 (Clumsy 2 on a critical success)") gets a card; Resilient Form and the like turn a critical hit into a normal hit on a flat check. Since batch 4's commit: 78 more cards, 13 more built in.
- **Strike abilities** (2026-10-10, batch 6): follow-ups to a Strike that hit ("last action was a successful claw Strike"), more wordings of several Strikes in one action, and a Strike against each creature in reach, for the simulator; 108 more built in.
- **Moves before a Strike** (2026-10-10, batch 7): charges with other moves (Fly, Swim, Leap, Burrow) and Strike activities with extra damage, an extra weapon die or counted as two attacks, for the simulator; 23 more built in.
- **Save or die and linked effects** (2026-10-10, batch 8): "save or instantly die" marks a creature dead on Apply; prose saves read pulls toward the monster and penalties; the PF2e effect a save or check links goes on the creature (or the monster) for results with nothing else.
- **Abilities that cast a spell** (2026-10-10, batch 9): "casts a 5th-rank Geas", "has the same effect as the Possession spell (DC 23), except …", "can cast Dominate at will": a card with the spell, its rank and DC (the GM can change them) and what the ability changes; Cast casts the spell through PF2e, for the spell module to resolve. 201 abilities (14 Battlezoo). The simulator gives the monster that spell. See [docs/live-play.md](docs/live-play.md#abilities-that-cast-a-spell-2026-10-10-batch-9).
- **Strike activities in live play and more Strike wordings** (2026-10-10, batch 10): after the GM uses a Strike activity (Intimidating Strike, Rhinoceros Charge, Death Roll), its Strike that hits gets a card with the activity's results: conditions by hit or critical hit, a push, extra damage, or its save. For the simulator: Sudden Charge, Strikes against different creatures (Dual Tusks, Furious Claws), Swipe, Coiling Frenzy's Grab, a Strike outside the multiple attack penalty; 89 more built in, and 28 Strike readings corrected (Strikes "each against a different target" were played at one target). See [docs/live-play.md](docs/live-play.md#strike-activities-in-live-play-and-more-strike-wordings-2026-10-10-batch-10).
- **Results with no roll** (2026-10-10, batch 11): "The target takes 3d8 fire damage", "Each enemy within 30 feet takes 1d8 slashing damage", "The creature takes 3d6 piercing damage and is Drained 1": a card with no roll, its Apply deals the damage and the conditions to the creatures targeted; the simulator plays them as certain. 113 more cards (15 Battlezoo). See [docs/live-play.md](docs/live-play.md#results-with-no-roll-2026-10-10-batch-11).
- **Reactions: Reactive Strike's older name, and concealment** (2026-10-10, batch 12): monsters whose Reactive Strike is still "Attack of Opportunity" (473 of them) now get the live offer too, as do 11 whose text is written out with no slug. "Gains concealment against the triggering attack" (Scintillating Defense) and "as if … Hidden" (Shadow Evade) are offered when an attack hits: the attacker's DC 5 or DC 11 flat check, a miss on a failure. See [docs/live-play.md](docs/live-play.md#reactions-reactive-strikes-older-name-and-concealment-2026-10-10-batch-12).
- **Passives a Strike lists are its riders** (2026-10-10, batch 13): "Any living creature hit by a ghoul's attack must succeed at a Fortitude save or become Paralyzed", "A creature hit by the spider's web Strike is Immobilized": when a Strike that lists them ("Claw … plus Paralysis") hits, their card follows (their save, or their results with no roll), and the simulator plays them on its hits. 614 more (79 Battlezoo): 282 that were read but never brought by a hit, 310 newly read, 22 actions the Strikes list. See [docs/live-play.md](docs/live-play.md#passives-a-strike-lists-are-its-riders-2026-10-10-batch-13).
- **Abilities that act as the monster dies** (2026-10-10, batch 14): Death Throes, Explosive Death and the like (125, 7 Battlezoo) were read but never triggered. When the monster drops to 0 HP, live play posts their card for the creatures in their area around it ("as it dies"), and the simulator resolves them as it dies. See [docs/live-play.md](docs/live-play.md#abilities-that-act-as-the-monster-dies-2026-10-10-batch-14).
- **Passives that answer a melee hit on the monster** (2026-10-10, batch 15): Defensive Quills, Short Circuit, Corrosive Flesh and the like (33, 10 Battlezoo) never fired. A melee Strike that hits the monster now posts their card on the attacker (unarmed Strikes only where the text says so), and the simulator plays them after its melee hits. Also: damage before "and must succeed at a save or become …" now comes whatever the save (8 abilities). See [docs/live-play.md](docs/live-play.md#passives-that-answer-a-melee-hit-on-the-monster-2026-10-10-batch-15).
- **Reactions to a hit or damage on the monster** (2026-10-10, batch 16): Shrapnel Splash, Freezing Blood, Reactive Thrash, Solar Flare, Self-Destruct and the like (130, 15 Battlezoo) had results but no trigger. Their trigger is read now (a hit, a critical hit, damage, its death): live play offers them to the GM after the attack roll or the damage, Use it posts the card on the attacker or the creatures around the monster, and the simulator uses them whenever the monster can react. See [docs/live-play.md](docs/live-play.md#reactions-to-a-hit-or-damage-on-the-monster-2026-10-10-batch-16).
- **More dodges, and answers to a mental effect** (2026-10-10, batch 17): 27 more AC reactions read (the bonus from the text, no Effect label, a Stride after as a note, melee or ranged only), and Otherworldly Mind and the like: a Demoralize, or a save against a targeted mental spell, posts its card on the creature that aimed it (a reaction is offered to the GM). See [docs/live-play.md](docs/live-play.md#more-dodges-and-answers-to-a-mental-effect-2026-10-10-batch-17).
- **Reactions to its own Strike, to being attacked, to a turn starting near it, and at initiative** (2026-10-10, batch 18): Pin Prey, Storm Smite, Hypnotic Tattoos, Petrifying Glance, Chilling Cry and the like (41, 4 Battlezoo; free actions with a trigger too). Live play offers them to the GM at their trigger; the simulator plays them. See [docs/live-play.md](docs/live-play.md#reactions-to-its-own-strike-to-being-attacked-to-a-turn-starting-near-it-and-at-initiative-2026-10-10-batch-18).
- **Passives: more death wordings, its own critical hit, damage on it** (2026-10-10, batch 19): Explosive Rebirth, Viviparous Birth, the critical specializations, Spewing Bile, Boiling Blood, Shimmering Armor and the like (46, 2 Battlezoo) get their card at their trigger, and the simulator plays them. Also: a Tiny creature's token occupies its whole square when distances are measured. See [docs/live-play.md](docs/live-play.md#passives-more-death-wordings-its-own-critical-hit-damage-on-it-2026-10-10-batch-19).
- **Passives on a creature it holds, as a turn starts or ends** (2026-10-10, batch 20): Mind-Numbing Grasp, Wine-Soaked, Volcanic Veins and the like (9, 2 Battlezoo): their card on the held creature at PF2e's turn start or end; the simulator plays them. See [docs/live-play.md](docs/live-play.md#passives-on-a-creature-it-holds-as-a-turn-starts-or-ends-2026-10-10-batch-20).
- **A condition the monster always has** (2026-10-10, batch 21): the zombie's Slow ("permanently Slowed 1 and can't use reactions"), Weapon Supremacy and the like (78, 1 Battlezoo): live play applies the condition as the encounter starts when PF2e's data doesn't (8 of them), and the simulator plays it. See [docs/live-play.md](docs/live-play.md#a-condition-the-monster-always-has-2026-10-10-batch-21).
- **Reactions to a creature acting near the monster** (2026-10-10, batch 22): Tentacle Trip, Ectoplasmic Filaments, troops' Reactive Attack, Brine Spit, Baleful Gaze and the like (31, 3 Battlezoo): live play offers them on a move, a ranged attack, a manipulate spell or a concentrate action within their distance; the simulator plays them, and casting a manipulate spell in a Melee now provokes there. See [docs/live-play.md](docs/live-play.md#reactions-to-a-creature-acting-near-the-monster-and-casting-provokes-in-the-simulator-2026-10-10-batch-22).
- **More spell wordings, and linked words in built-in readings** (2026-10-10, batch 23): "is subjected to a 5th-rank Phantasmal Killer spell", "affecting them with Wave of Despair" and the like (28, 3 Battlezoo) get their cast card; Coiling Frenzy (25 dragons) and others whose linked words weren't read are built in. See [docs/live-play.md](docs/live-play.md#more-spell-wordings-and-linked-words-in-built-in-readings-2026-10-10-batch-23).
- **The monster healing itself** (2026-10-10, batch 24): Abyssal Healing, Vine Splint, Self-Repair and the like (79, 1 Battlezoo): PF2e's healing roll when the GM uses it, with its requirements for the GM; the simulator plays the ones without requirements. See [docs/live-play.md](docs/live-play.md#the-monster-healing-itself-2026-10-10-batch-24).
- **More charges and Strike activities** (2026-10-10, batch 25): Swoop, Rush, Powerful Charge, Ram, Thundering Charge and the like (33): a move and a Strike in more actions than the moves take, "Strides, then Strikes", the 20-foot bonus in more wordings, "damaged by this attack". See [docs/live-play.md](docs/live-play.md#more-charges-and-strike-activities-2026-10-10-batch-25).
- **A condition the monster gives itself or its allies** (2026-10-10, batch 26): Go Dark, Shrieking Frenzy, Inspiring Word, Royal Command and the like (52, 5 Battlezoo): Quickened, Concealed or Invisible on its own token, at its turn start as a free action, or on its allies. See [docs/live-play.md](docs/live-play.md#a-condition-the-monster-gives-itself-or-its-allies-2026-10-10-batch-26).
- **More results of a Strike activity's hit** (2026-10-10, batch 27): Skewer, Vicious Swing, Grievous Strike, Shock Mind, Concussive Blow and the like (35, 2 Battlezoo): extra damage with a condition or a save in one sentence, extra dice of the Strike's own type, weapon dice, a penalty or bonus in the opening, a farther push on a critical hit. See [docs/live-play.md](docs/live-play.md#more-results-of-a-strike-activitys-hit-2026-10-10-batch-27).
- **Steady Spellcasting, Golem Antimagic, healing as it dies, more riders, natural invisibility** (2026-10-10, batch 28): 182 (7 Battlezoo): Steady Spellcasting for the simulator; golems harmed, healed, slowed or immune as a spell targets them; Verdant Burst's healing for the plant creatures around; riders worded "Creatures hit by …" or naming their Strike; naturally invisible monsters. Fixed: a critical hit's rider came on every hit. See [docs/live-play.md](docs/live-play.md#steady-spellcasting-golem-antimagic-healing-as-it-dies-more-riders-natural-invisibility-2026-10-10-batch-28).
- **Hazard actions** compile too (2026-10-08): the registry handles hazard actors' actions as it does monsters'. 27 of the 68 actions in PF2e's hazards pack compile: save-based reactions, and poisons that ride on Strikes.
- **Hazards in live play** (2026-10-08):
  - Regions linked on a hazard's sheet bring the GM a Fire / Not now card when a party creature steps in. Fire posts the hazard's reaction cards or rolls its Strikes, and a complex hazard joins the encounter.
  - A complex hazard's turn brings a routine card.
  - Disable checks count toward its successes.
  - See [docs/live-play.md](docs/live-play.md#hazards-2026-10-08-the-users-choices).

| Path | Holds |
|---|---|
| `src/compiler/` | pure: `inline.js` (PF2e's inline syntax), `checks.js` (skill actions), `monster.js` (monster abilities), `builtins.js` (rules the simulator plays itself), `afflictions.js` (poisons, diseases), `auras.js` (when an aura acts), `index.js` |
| `scripts/main.js` | Foundry: registers the compiler with the core and offers the basic actions |
| `scripts/live.js`, `src/live/card.js` | live play: confirmation cards for monster abilities, Strike riders and PCs' skill actions ([docs/live-play.md](docs/live-play.md)) |
| `scripts/auras.js`, `src/live/auras.js` | live play: cards when a foe enters a monster's aura or starts or ends its turn in it |
| `scripts/swallow.js`, `src/live/swallow.js` | live play: Swallow Whole and Engulf over the turns (damage at the end of each turn, Rupture, Escape) |
| `scripts/recharge.js`, `src/live/recharge.js` | live play: recharging abilities (rolled on Apply, a warning on reuse, Draconic Momentum) |
| `scripts/reactions.js`, `src/live/reactions.js` | live play: monsters' reactions as GM-only offers (Reactive Strike, Twisting Tail, Nimble Dodge, Challenge Fate, Death Frenzy, Ferocity) |
| `tools/` | `leveldb.mjs` (reads PF2e's packs), `census.mjs`, `spell-compiler-probe.mjs` |
| `docs/` | `census.md`, `milestone-3.md` |

## Tools

- `node tools/census.mjs` regenerates the census from the PF2e compendiums in the Foundry data folder. It takes about 2 seconds.
- `tools/leveldb.mjs` is a read-only, dependency-free reader for Foundry's LevelDB packs. It never writes, so it's safe while Foundry is running, and it doesn't need a Foundry login.

Run the tests with `node --test`.
