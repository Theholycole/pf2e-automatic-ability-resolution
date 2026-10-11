# Live play: confirmation cards

The user's decisions (2026-10-08):

- **Cards like the spell module's.** Using an ability from a monster's sheet posts a resolution card under PF2e's own ability message: its targets (the GM's targets), a roll button per target, then **Apply**, which the GM confirms. Simple effects get a card too ("confirmation-first for everything").
- **A target's owner rolls its own save** on the card; the GM can roll for anyone, and nothing is applied before the GM confirms.
- **Riders get a card after the hit.** When a monster's Strike hits and the Strike lists a rider (Grab, Knockdown, Push, a venom), a rider card appears under the Strike's result: Grab's Athletics check against the target, or the venom's save. The GM confirms the result.
- **The first slice is monster abilities:** breath weapons and other save abilities, Strike riders, Constrict, Swallow Whole. PCs' skill actions followed (below).

## How it works

- `src/live/card.js` (pure): the card's state (the ability's plan, the source, the targets and their rolls) and its HTML.
- `scripts/live.js` (Foundry): the triggers, the rolls, the result watcher and Apply. `scripts/auras.js` (Foundry) and `src/live/auras.js` (pure): the aura cards.
  - **Triggers** (on the active GM's client only): a monster's ability message (`flags.pf2e.origin.type === "action"`), an attack roll that hits with a Strike listing a rider, and a PC's skill-action check with a target.
  - **Rolls** go through PF2e's own statistics (a target's save, or the monster's skill against the target's DC), tagged `identifier: "aar:<card>:<target>"`. Whoever owns the roller rolls; the active GM's client writes the result onto the card.
  - **Apply** resolves the plan with the core (`registry.resolve`, the recorded degrees as `io.roll`), then applies the changes: damage through PF2e's `applyDamage` (its resistances and weaknesses), conditions, and afflictions handed to Pseudo Afflictions as the spell module does.

## Status (2026-10-08)

**Checked live in pftest** on a PFTEST SIM scene with PFTEST SIM iconics and monsters:
- **Poison Breath** (a save ability, 3 targets): the card appeared under PF2e's ability message. "Roll the rest" rolled each PC's Fortitude save through PF2e. On Apply, 9d6 was rolled once (28) and the two failures took the full 28 through PF2e's own damage; the critical success took nothing.
- **Giant Scorpion Venom** (a rider): a Stinger hit brought the venom card under the attack roll. A failed save handed the venom to Pseudo Afflictions, which made its affliction effect at stage 1, with enfeebled 1.
- **Grab** (a rider check): the anaconda's Athletics against the target's Fortitude DC. A success applied grabbed; a critical success, restrained, with a reminder of when it ends.

**Not yet:**

## Timed conditions and pushes (2026-10-08, the user's choice)

- **A condition with a duration** ("grabbed until the end of your next turn") is a PF2e effect on the target that grants the condition. Its origin is the monster, and its rounds are counted from where the monster sits in the turn order, as the spell module does: 0 when the monster still acts this round, otherwise 1. PF2e removes the effect and the condition when it runs out. Checked live: an anaconda's Grab in round 1 restrained a PC until the end of the anaconda's turn in round 2, then both were gone.
- **A push or pull** moves the token with the core's forced movement (`api.forcedMovement.forcedMove`, the user's grid rule of 2026-10-05). It goes square by square in the nearest of the 8 directions away from the monster, with diagonals 5 then 10 feet, stops at walls and the scene's edge, and never ends in another creature's space. Checked live: a Megalodon's Push moved a PC 2 squares, beside the anaconda rather than into it.
- **Push's distance:** a critical success pushes no less than the listed success distance (Shove's own critical push is 10 feet).

## PCs' skill actions (2026-10-08, the user's choice)

- **Trigger:** PF2e's own skill-action check (from the sheet or `game.pf2e.actions`) with a target: Demoralize, Trip, Grapple, Shove, Disarm, Feint, Create a Diversion, Reposition, Escape. The card appears with the check already recorded from PF2e's result ("Athletics 27 vs DC 22: success"); the GM presses Apply.
- **The user's own results** ("source"): Trip's critical failure leaves the user prone, Escape's success ends grabbed (and restrained, immobilized) on the user, Disarm's critical failure makes the user off-guard until the start of their next turn.
- **Off-guard to one creature** (Feint, Create a Diversion) is an effect on the creature whose attacks benefit. It marks the target's token (PF2e's TokenMark, as Hunt Prey does) and makes that target off-guard to its Strikes. Feint counts melee Strikes only (PF2e's `melee-strike-attack-roll`), Create a Diversion any Strike or spell attack. A success lasts for one attack: the active GM's client removes the effect after the next matching attack roll at the marked creature. A Feint's critical failure puts the effect on the target, against the user.
  - PF2e 8.5 names the mark `self:mark:<slug>` (not `target:mark:`) while it builds the target's side of the roll, so the rule accepts either.
- **Disarm:** a success adds PF2e's own Effect: Disarm (Success). Its weapon choice prompts the GM when the target has more than one attack. A critical success drops the target's best held weapon.
- **Reposition** has no automatic move (the user picks the square): the card says how far, with the names ("Move Giant Scorpion up to 5 feet, staying within Valeros's reach…").
- **Cards already in the chat log when Foundry loads** are drawn before the module's "ready"; their buttons are wired then.

**Checked live in pftest** (PFTEST SIM iconics and monsters):
- Demoralize: frightened 1.
- Feint:
  - a critical success made the scorpion off-guard to Merisiel's rapier (AC 16 for 18), not to the shortbow or against the anaconda;
  - a success counted for the next rapier Strike only;
  - a critical failure made Merisiel off-guard to the anaconda's Jaws (AC 20 for 22), not Seelah.
- Create a Diversion: off-guard to Merisiel's next shortbow shot only.
- Trip: target prone; on a critical failure, the user prone.
- Shove: the scorpion was pushed one square straight away.
- Grapple: grabbed until the end of Valeros's next turn.
- Disarm:
  - a success gave −2 with the chosen longsword;
  - a critical success dropped Ezren's Staff of Fire;
  - a critical failure made Valeros off-guard until the start of Valeros's next turn.
- Escape: grabbed ended.
- Reposition: the by-hand line.

## Auras (2026-10-08, the user's choices)

The user's decisions:
- **Foes only:** creatures whose token disposition differs from the monster's. The GM can add others with "Use my targets". Exceptions an aura names ("a non-demon creature", "a living creature") are the GM's call.
- **Combat start counts as entering:** when an encounter starts, every foe inside an aura that acts on entering gets its card ("in the aura as combat began").
- **A moving aura counts:** when the monster moves, foes its aura newly covers have entered it.
- **Combat only:** nothing triggers unless an encounter is running on the scene. Cards come only from monsters in the encounter, for creatures in it. A monster on the map but not in the fight brings none (found in the live test of 2026-10-08).

How it works:
- **When an aura acts** comes from its text (`src/compiler/auras.js`): a creature "enters" it, "starts its turn" in it, or "ends its turn" in it.
  - Frightful Presence acts on entering. Stench acts on entering and at turn start (PF2e's glossary text).
  - An aura that only deals damage (radius, damage, save) acts on entering and at turn start, once per round (Monster Core's rule).
  - An aura with no timing that does more than damage (Magic-Warping Aura acts when a creature Casts a Spell) has no trigger: the GM handles it.
  - Miasma acts only for the round after its Poison Breath.
  - Of 111 auras with a save in Monster Core, Monster Core 2 and NPC Core, 110 have a timing.
- **Triggers**, on the active GM's client, one at a time:
  - **Foundry's `moveToken`:** the path is checked square by square, so walking through an aura counts. A teleport or push counts only where it lands.
  - **Encounter start:** the encounter's first round begins.
  - **PF2e's `pf2e.startTurn` and `pf2e.endTurn`:** a creature starts or ends its turn.
  - **An NPC's ability message:** Miasma's Poison Breath.
- **Inside** is PF2e's distance from the monster's space, measured by the core's grid (`distanceFeet`): diagonals 5 then 10 feet, elevation as a third axis. Walls don't block; the GM confirms every card.
- **No card** for a creature that is immune, or already waiting on an open card from the same aura.
- **Immunity:** Apply records "temporarily immune …" as an effect on the creature ("Immune: Frightful Presence (Horned Dragon)", 1 minute), for the results that grant it.
  - Frightful Presence grants it whatever the result. Stench grants it on a success, to every stench aura.
  - The same applies to any card whose ability grants immunity, Demoralize's 10 minutes included.
  - PF2e removes the effect when it runs out.

**Checked live in pftest** (PFTEST SIM iconics, the young horned dragon, and a new PFTEST SIM Ghoul Soldier, in an encounter on the Live Cards scene):
- Starting the encounter brought one Frightful Presence card for the four PCs.
  - Three failed (frightened 2) and Merisiel succeeded (frightened 1).
  - All four got a 1-minute immunity effect.
- Walking Valeros next to the ghoul brought a Stench card ("entered the aura").
  - Walking him out and back in while it was open brought no second card.
  - His success made him immune to every stench aura.
- Moving the ghoul beside the others brought one card for Seelah, Ezren and Merisiel (Seelah exactly 10 feet away), not the immune Valeros.
- Merisiel's turn start brought no card (immune). With Seelah's immunity removed, her turn start brought one ("started its turn in the aura").
- With the encounter deleted, walking into the stench brought no card.

**Not yet:**
- Rules that hold only inside an aura without a save: "can't reduce its frightened below 1 while in the aura" (Scarecrow's Leer), "can't reduce the value of the sickened condition" (Miasma of Pollution).
- Auras that act on other triggers (casting a spell).
- Stench's "or recovers from being sickened" immunity.

## Swallow Whole and Engulf over the turns (2026-10-08, the user's choice)

- **Apply** on a Swallow Whole or Engulf card deals the damage and gives the creature a "Swallowed by …" effect (`scripts/swallow.js`, `src/live/swallow.js`):
  - grabbed and slowed 1, granted by the effect so they end with it;
  - the monster off-guard to its Strikes (a token mark, as Feint's);
  - the rules in its description: hold its breath, unarmed or light weapons only, Escape, Rupture, the 3 actions to cut open a dead monster.
  - The grab that held it in the jaws ends, as PF2e's text says.
- **At the end of each of its turns** (`pf2e.endTurn`, active GM), the listed damage is rolled as a PF2e damage roll, with an "Apply to …" button for the GM. Several damage types roll together ("{(3d10+10)[bludgeoning],2d6[fire]}"). There's no roll once the monster is dead.
- **Rupture:** when the monster takes piercing or slashing damage of at least its Rupture value from one attack or spell, a card offers "Cut free" for each creature it holds. The core's applyDamage listener notices this. The damage counted is the roll's piercing and slashing before resistances.
- **Escape:** the Escape card's success ends grabbed, and the effect goes with it (and slowed with the effect).
- Tokens aren't moved in or out: the GM places a creature that gets out.

**Checked live in pftest** (the PFTEST SIM Megalodon and Valeros, in an encounter on the Live Cards scene):
- Swallow Whole's card dealt 14 bludgeoning (78 to 64 HP) and gave the effect: grabbed and slowed 1, and the earlier grab ended.
- Valeros's longsword needed AC 25 against the megalodon (27, off-guard), and stayed at 25 against the anaconda.
- At the end of Valeros's turn: a 2d8+5 roll (10) with "Apply to Valeros", which took him to 54.
- Rupture:
  - 15 slashing to the megalodon brought no card;
  - 25 slashing and 10 fire brought one, and "Cut free" ended the effect with its grabbed and slowed.
- Swallowed again: with the megalodon at 0 HP, his turn ended with no roll.
- His Escape (a critical success) ended grabbed, and the effect and slowed went with it.

## Recharging abilities (2026-10-08, the user's choices)

The user's decisions:
- **The recharge starts on Apply:** it's rolled when the GM applies the card, and the card shows it ("Poison Breath recharges in 2 rounds (1d4)"). A recharging ability with no card (37 in the bestiary, such as Ink Cloud) starts when used from the sheet, with a note to the GM.
- **Reuse is warned, not blocked:** using it again while it recharges still brings its card, with a warning ("Poison Breath is still recharging: 1 round left."). The GM decides.

How it works (`scripts/recharge.js`, `src/live/recharge.js`):
- **The effect:** "Recharging: …" on the monster, lasting the rolled number of rounds. It ends at the start of the monster's turn, counted on the monster's own initiative whoever's turn the GM applies it on. PF2e removes it when it runs out.
- **Applying again** starts a new recharge in place of the old one.
- **The formula** comes from the plan (182 of the bestiary's 219 recharging abilities) or from the text ("[[/gmr 1d4 #Recharge …]]", "can't use … again for 1d4 rounds").
- **Draconic Momentum:** a critical hit with a Strike ends the recharge of the abilities it names, with a note to the GM (active GM).

**Checked live in pftest** (the young horned dragon and Valeros, in an encounter on the Live Cards scene):
- Poison Breath's card: Valeros took 15 poison, and the breath recharged in 2 rounds.
- Breathing again at once brought a card warning "2 rounds left"; in round 2 the warning said "1 round left".
- A critical Jaws hit ended the recharge, with the GM note.
- A 1-round recharge was gone at the start of the dragon's next turn, and its next breath had no warning.

## Conditions while in an aura (2026-10-08, the user's choice)

- **The compiler** reads "while it remains in the area" and "for as long as they remain within the aura" as `duration: { mode: "in-aura" }`. It reads "persists for 3 rounds after leaving the aura" and "recovers after it has been out of the aura for 1 minute" as `after: { value, unit }`. In Monster Core, Monster Core 2 and NPC Core:
  - Aura of Sobs: stupefied 1.
  - Heat of the Forge: fatigued.
  - Heavy Aura: encumbered; on a critical failure also 3 rounds after leaving.
  - Draining Presence: drained 1 until a minute after leaving.
- **Apply** gives such a condition as an effect that grants it ("Aura of Sobs: Stupefied 1"), tied to the monster's token and the aura's radius. A newer one from the same aura replaces it.
- **Leaving** (`scripts/auras.js`, the active GM, in or out of an encounter) is checked when any token moves, when the monster's HP changes, and when a token is removed:
  - When the creature has left, or the monster is dead or gone, the effect ends, and the condition with it.
  - If the text says it lasts longer, the effect instead runs for that time from then ("1 minute").
  - Coming back in during that time makes it last while inside again.
- **Compiler fixes found on the way:**
  - "As failure, but …" (and "As success, but …") rows now copy the failure's row, with the row's own conditions in place of the same ones: Scarecrow's Leer's critical failure is fascinated and frightened 3. This changes 57 abilities (50 distinct) whose critical rows had been empty or partial.
  - "If the creature is already encumbered, it is immobilized" is left to the GM.
  - "encumbered" is read in words.

**Checked live in pftest** (Ezren, and new PFTEST SIM Attic Whisperer and War Wraith, in an encounter on the Live Cards scene):
- Aura of Sobs:
  - walking in brought its card; a failure gave stupefied 1 "while it stays in the aura";
  - walking out ended it.
- Draining Presence:
  - a failure gave drained 1 with no end while inside;
  - walking out turned it into 1 minute;
  - walking back in brought a new card (entering again) and made it last while inside again;
  - the wraith's death started the minute.

## Monsters' reactions (2026-10-08, the user's choices)

The user's decisions:
- **A GM-only offer:** a whispered card when the trigger happens, with a button to use the reaction and "Not now". Players don't see the monster's options, and nothing happens until the GM presses a button.
- **One reaction per round, tracked:** using one gives the monster "Reaction used" until the start of its next turn. There are no more offers until then.
- **Reactive Strike triggers:** a foe leaves a square in its reach, makes a ranged attack in its reach, or casts a manipulate spell in its reach.
- **Defensive reactions are offered after the roll when they matter:** Nimble Dodge and the like only when their AC bonus would change a hit; Challenge Fate on any hit.

How it works (`scripts/reactions.js`, `src/live/reactions.js`), for monsters in the running encounter that can react: alive, not unconscious, stunned, paralyzed, petrified or confused, and not having used their reaction.
- **Reactive Strike** (139 in the bestiary): offers a button for each melee Strike that can reach, or just the one its name allows ("(Stinger Only)"). Reach is PF2e's for each Strike.
  - Movement comes from Foundry's movement path, square by square. Forced movement and teleports don't count. A one-square move gets a note that a Step doesn't trigger it.
  - A ranged attack is PF2e's attack roll with `item:ranged`.
  - A manipulate spell is the spell's card (PF2e 8.5 marks it `spell-cast`), with the manipulate trait.
- **Twisting Tail and the like:** a foe moves in its reach. The Strike takes its penalty (−2) as a PF2e modifier and the card notes the disruption.
- **Nimble Dodge and the like (+N AC):** after an attack roll on it that hit, offered when +N AC would make it a hit instead of a critical hit, or a miss instead of a hit. The card tells the GM what to apply.
- **Challenge Fate:** after a hit on it, PF2e's own reroll that keeps the worse result.
- **Death Frenzy:** a Strike at the GM's target when it's reduced to 0 HP.
- **Ferocity:** when it's reduced to 0 HP (and isn't wounded 3), it stays at 1 HP with wounded +1.
- **The Strike button** rolls PF2e's Strike at the triggering creature (made the GM's target) with no multiple attack penalty. Shift is set from the GM's dialog setting, so no dialog opens.
- **"Is it still running?"** goes by PF2e's live count of the effect's remaining time. Its stored "expired" flag can be stale: it showed a fresh 0-round effect as expired.

**Checked live in pftest** (Valeros, Merisiel and Ezren; the Giant Scorpion, the young horned dragon, and PFTEST SIM Wererat and Boar, in an encounter on the Live Cards scene):
- Merisiel's shortbow shot inside the scorpion's reach brought a whispered "Reactive Strike (Stinger Only)" offer with the Stinger only, and "Not now" closed it.
- Ezren walking through both reaches brought two offers:
  - Twisting Tail's Tail Strike at Ezren had "Twisting Tail −2" among its modifiers and no attack penalty;
  - the dragon got "Reaction used" until its turn.
- The cantrip Caustic Blast cast inside the scorpion's reach brought an offer, and the scorpion stung Ezren.
  - Valeros then leaving its reach brought nothing, and walking through the tail's reach brought nothing either: both had used their reactions.
- Of nine attacks on the wererat, Nimble Dodge was offered only for the one where +2 AC mattered (29 against AC 19: a critical hit that becomes a hit).
- The boar at 0 HP: Ferocity left it at 1 HP and wounded 1.
- At their turns both "Reaction used" effects ended, and the next move brought offers again.
- Not checked live: Challenge Fate and Death Frenzy (no such monster in the test). Their code paths are the reroll and the Strike button checked above.

## Hazards (2026-10-08, the user's choices)

The user's decisions:
- **Cards for every hazard moment:**
  - its actions used from its sheet, and its Strike riders (a poison), exactly as a monster's;
  - a GM card at a complex hazard's turn, with its routine and a button per Strike;
  - Disable checks counted toward the successes it needs.
- **Springing:** you tick Regions on the hazard's sheet ("Trigger Regions"). A party creature (a PC or a friendly token) moving into one brings the GM a whispered card: "Valeros stepped into its area", with Fire and Not now. This works in and out of encounters.
- **Fire:**
  - posts its reaction cards (public, so players roll their own saves), or rolls its Strikes at that creature;
  - a complex hazard then joins the running encounter, or a new one on the scene, rolling its Stealth for initiative.
- **Spent until reset:** a simple hazard that fired stops prompting until "Reset" on its sheet. A complex one that fired is in the encounter and stops prompting too.
- **A Disable check's critical failure** brings the GM the Fire card, aimed at whoever tried.
- **Out of the fight:** disabled, or smashed to 0 HP, the hazard is defeated in the encounter, and its Regions stop prompting.
- **Who sees what:** the prompt and the turn card are whispered to the GM; the cards once it fires are public.

How it works (`scripts/hazards.js`, `src/live/hazards.js`):
- **State on the hazard's token** (`flags.pf2e-automatic-ability-resolution.hazard`): its Regions, its status (armed, active, spent, disabled, destroyed) and its Disable progress.
- **Entering** is Foundry's movement path, square by square, tested against the Region (`RegionDocument#testPoint`), as auras do. Only a move from outside to inside counts.
- **Fire, step by step:**
  - Each of the hazard's reactions (and free actions) that compiles into a card is posted at the creature.
  - An area one, by its plan or its text ("burst", "centered on", "each creature"…), also takes the party creatures in its Regions. The card's "Use my targets" adds anyone else.
  - A reaction whose text says the hazard Strikes rolls its Strikes at the creature.
  - Anything else posts its text for the GM.
  - Initiative is rolled without PF2e's dialog, which would otherwise hold the card until the GM answered it.
- **The turn card's Strike button** attacks the party creatures in its Regions, or the GM's targets, one PF2e Strike roll each.
- **A Disable check** is a PC's skill check with a DC. It counts when its skill and DC match one of the hazard's Disable options (read from its `@Check` links, with "twice" or "three times").
  - Which hazard: the check's target; or a hazard the roller has targeted (PF2e leaves a hazard out of the check's target, but Foundry shares each user's targets); or else the one hazard on the scene that fits.
  - A critical success counts twice.
  - The GM gets a note of the progress.
- **Shared text readers:** the hazard text readers (`parseDisable`, `routineActions`, `noMultipleAttackPenalty`, `mentionsStrike`) are the core's (`src/text/hazard-text.js`), shared with the simulator.

**Checked live in pftest** (a PFTEST SIM scene with a trap hall Region; Valeros and Merisiel; PFTEST SIM Scythe Blades, Poisoned Dart Gallery and Fireball Rune):
- "Trigger Regions" on the Scythe Blades' sheet listed the scene's Region, and ticking it linked it.
- Valeros walking in brought the whispered prompt, outside any encounter. Fire rolled the Scythe Strike at Valeros (a hit), and the blades were spent: Merisiel walking in brought nothing. Reset armed them again.
- Merisiel walking in then brought two prompts. "Not now" closed the blades' prompt.
  - Fire on the Dart Gallery rolled its Strike at Merisiel. The hit brought the Flesset Poison rider card.
  - The gallery joined a new encounter on the scene with its Stealth initiative: first with PF2e's dialog, then 29 without it once fixed.
- At the gallery's turn, the whispered turn card showed its routine. Its Poisoned Dart button attacked Valeros and Merisiel (both in the hall), each hit bringing the poison card.
- Merisiel's Thievery check against DC 21, with the gallery targeted, disabled it (it needs one success on the control panel). The GM got a note, and it was defeated in the encounter.
- A Disable check that critically failed brought the "critically failed to disable it" Fire card.
- The blades at 0 HP: destroyed, with a note.
- Fireball Rune's reaction used from its sheet brought its DC 22 basic Reflex card.
  - Fired from its Region, it took Merisiel and Valeros, both in the hall. At first it took Merisiel only, because the compiler gives "a Fireball centered on the triggering creature" no area; the area words fixed that.

## Fleeing and immunity wording (2026-10-08, from the simulator's fleeing audit)

- **"As long as it's frightened"** (Vision of Death's kin: Dread Promise, Night's Breath, Fearsome Blizzard, Nightmare Curse…) reads as `duration: { mode: "while", condition: "frightened" }`, and "as long as it's sickened" likewise. Apply sets the condition and says on the card that it lasts as long as that condition; the GM ends it (not automatic yet).
- **"Fleeing during their next turn"** (Gogunta's Croak) reads like "until the end of its next turn".
- **Frightened next to a timed condition** ("Fleeing for 1 round and Frightened 3", "Confused for 1 round and Frightened 2", "Frightened 2 and slowed 1 for 1 minute", "… and is then temporarily immune for 1 minute") keeps PF2e's own decay; before, the time was given to the frightened too (57 effects in 38 more abilities on 2026-10-09). A time stays frightened's when it follows it ("Frightened 1 for 1 minute") or the frightened can't be reduced ("can't reduce its frightened condition below 2 for 1 minute"); "As failure, but Frightened 3" doesn't inherit the failure's fixed time.
- **Immunity without "temporarily"** ("is then immune to the hantu denai's Terrifying Cry for 1 minute", "immune to this ability for 24 hours") is read when the sentence names the ability, the creature, or "this ability / the trap / its effects"; not another ability's ("immune to all thatchlings' distracting giggle") or a creature's equipment. "Whether it succeeds or fails" grants it after every result, "once it has succeeded" after a success, and a result heading on its own line ("Critical Success The creature is unaffected and immune…") after that result.
- 159 of the 32,860 bestiary abilities compile differently; the rest are byte-identical.
- **Immunity for abilities with no PF2e slug** (most bestiary abilities): Apply recorded no immunity effect for them. The card now takes a slug from the ability's name (`abilitySlug`: "Baleful Shriek" → `baleful-shriek`), and aura cards check immunity by the same slug.
- **Checked live in pftest** (2026-10-09; PFTEST SIM Kimenhul, Megaprimatus and Revenant added; the four iconics as unlinked tokens on a scene since deleted):
  - Megaprimatus's Terrifying Display, critical failures: frightened 2 as a plain condition and "Terrifying Display: Fleeing" until the end of the megaprimatus's next turn. Critical successes: "Immune: Terrifying Display (Megaprimatus)", 1 minute (none before the slug fix).
  - Kimenhul's Eternal Fear: the card says each PC's fleeing lasts as long as it's frightened; immune for 10 minutes.
  - Revenant's Baleful Shriek ("are then immune to Baleful Shriek for 1 hour"): the immunity effect, 1 hour.
  - Fixed after the check (2026-10-09): a frightened beside another timed condition ("paralyzed for 1 round and frightened 2") took that round; see above.


## Other publishers' monsters and basic-save riders (2026-10-10)

- The Battlezoo bestiaries' abilities compile as PF2e's do (see the README). Their actors play the same cards; no Battlezoo module needs to be enabled for a creature already in the world.
- **Rolled durations:** "slowed 1 for 1d4 rounds" is rolled per creature on Apply, and the card names the roll ("… in 2 rounds (rolled 1d4)"). Minutes and longer are shown as the time itself ("1 minute"); before, the card said "next round" for a 1-minute effect.
- **Persistent damage** keeps its dice ("1d4 persistent bleed", rolled each round) unless a basic save halved or doubled the amount. The core now marks those with `damage.multiplier`. The card line reads "Valeros takes 1d4 persistent bleed".
- **Recharge** is also read from "can't Spew Smog again for [[/br 1d4 #rounds]]{1d4 rounds}" (42 Battlezoo abilities and 6 of PF2e's).
- **Checked live in pftest** (PFTEST SIM Hearth Hound, Toy Swarm and Corpsesewn Colossus added from the Battlezoo Bestiary's data; Valeros, Seelah, Ezren and Merisiel on the Live Cards scene, restored afterwards):
  - Hearth Hound's Sorrow's Howl, Will DC 21:
    - Valeros failed: slowed 1 for a rolled 1d4 (2 rounds).
    - Merisiel critically failed: "As failure, but the duration is 1 minute", so 1 minute.
    - Both immune for 24 hours.
  - Toy Swarm's Miniature Barrage, basic Reflex DC 15:
    - Valeros failed: 1d6 piercing plus "fail also take 1d4 bleed", as persistent bleed 1d4.
    - Seelah succeeded: half damage.
  - Corpsesewn Colossus's Spew Smog, basic Fortitude DC 32: critical failures took double damage and became sickened 2; a success took half. Apply started "Recharging: Spew Smog" for a rolled 1d4 rounds.

## Abilities with several ways, troops' action counts, and notes for the GM (2026-10-10)

- **A choice of ways.** Some abilities can be used in one of several ways, each in its own list item: "breathes in one of two ways", "creating one of two effects", "one of the following modes". Using one posts a card asking **which way?**, with a GM button for each.
  - Picking a way turns the card into that way's normal card, for the same targets. Its recharge starts on Apply.
  - A way the module can't read is marked "(by hand)". Picking it starts the recharge at once.
  - The simulator plays each way as an option of its own. The ways share one recharge, and Draconic Momentum recharges them together.
- **Damage by the number of actions** (a troop's attacks, "The damage depends on the number of actions"). The card shows **Actions spent: 1 2 3** buttons for the GM, starting at the fewest. Apply uses the damage for the count picked, and the applied card says "With 2 actions". The simulator picks the count itself.
  - A troop with no template, "each enemy within 10 feet" or "each adjacent enemy", gets that emanation.
- **Notes for the GM.** The card lists, per target, what the module doesn't apply itself:
  - Damage that only happens in some case, such as extra damage if a pushed creature hits a wall.
  - Splash on the creatures around a target ("Splash: 10 acid splash damage to each creature within 5 feet of Valeros").
  - Damage with a save of its own inside a result ("takes 2d10+9 piercing damage (DC 25 basic Fortitude save)").
  - A result with nothing it can apply, such as a creature that can't use reactions for a while: "Valeros (failure): " and the result's text. "As failure, but …" adds the failure's text.
  - A result that applies something but has more it can't, its whole text: "Seelah (critical failure, the rest by hand): " and the text. For a result that slows the creature and also takes away its reactions, slowed is applied and the note is for the rest. This covers "can't …", penalties and bonuses, weakness, "must spend …", teleporting, dying and transforming.
  - Exposure to a disease written after the save (Vamollaroth's Spew Pollution): "Valeros is exposed to Brain Worm: a DC 44 Fortitude save against it". The Reflex result isn't the disease's own save, so it isn't handed to Pseudo Afflictions.
- **Readings fixed along the way:**
  - "takes full damage … and 2d6 persistent bleed" keeps the bleed (it used to drop).
  - "As failure, except the creature is pushed 70 feet" pushes 70 feet.
  - A pull "closer to" or "toward" the monster itself ("toward the kun") pulls the target toward the monster. A copy named otherwise ("Elite Kun", "PFTEST SIM Kun") counts too: its token's name and the last word of its name are read.
  - Damage under "one of the following effects, as chosen by …" is left to the GM.
- **Checked live in pftest** (2026-10-10). PFTEST SIM copies of Floral Dragon (Young), Harlequin Dragon (Great Wyrm), Kelp Dragon (Young) (Battlezoo), Conscript Squad (NPC Core) and Kun (Lost Omens) were used on the Live Cards scene; all were deleted afterwards and the PCs restored.
  - Floral Dragon's Breath Weapon: the "which way?" card. Slumber Pollen became a DC 28 Will card. Valeros and Seelah failed: unconscious for 1 round and prone. Apply started the Breath Weapon recharge.
  - Harlequin Dragon:
    - Laughing Gas: two critical failures were slowed 1 for 3 rounds, with the "the rest by hand" note for the reactions they lose.
    - Using it again warned "Breath Weapon is still recharging: 3 rounds left".
  - Kelp Dragon's "Grasping Reeds (by hand)": "resolve it by hand", and the recharge started.
  - Conscript Squad's Indiscriminate Assault:
    - The GM picked 3 actions, and the card read "With 3 actions".
    - Damage 2d8+4 = 11: Merisiel failed and took 11; Valeros succeeded and took 5.
  - Kun's Funnel: Ezren critically failed. He took double damage and was pulled toward the kun until a creature in the way stopped him.
    - The first try found no pull, because the copy's name "PFTEST SIM Kun" didn't match "toward the kun". The name reading above was added for that.

## Effects, Retributive Strike, Pull and other glossary abilities (2026-10-10, batch 4)

- **Abilities whose result is a PF2e effect** (Battle Cry, Raise Guard, Fiery Rhetoric, Living Shield) post an effect card: the effect, who gets it, and the GM's **Apply**, which puts a copy of PF2e's effect item on each creature with the monster as its origin (so "until the start of its next turn" counts on the monster's turns).
  - Who gets it is read from the sentence that grants it: the monster itself ("gaining a +2 circumstance bonus to AC"); its allies, in an emanation when one is given ("itself and all allies within 60 feet"); or one creature ("an adjacent ally", "an enemy within 30 feet … The target takes …").
  - For allies, the card marks each target ally or not; Apply leaves the others out.
  - Not read: abilities with a Strike, a check, a spell, a choice, a trigger, movement or terrain as well; those stay the GM's.
  - A monster's own PF2e self effect (its "Use" button) gets no card, since PF2e's own card applies it. The simulator plays both.
- **Retributive Strike** (the glossary's, archons and others): when PF2e applies damage to the monster's ally and the creature whose turn it is (taken as the attacker) is a foe, both within 15 feet, the GM gets an offer: **Resist, then <Strike>** gives the ally back what its resistance (2 + the monster's level) kept off and rolls the Strike; **Resist only**; **Not now**. The simulator plays it as a champion's Retributive Strike.
- **Pull** (and Improved Pull): a Reposition after the Strike that lists it, pulling the creature toward the monster: 5 feet on a success (or the listed distance), 10 or the listed distance on a critical success. Improved Pull is free. "Push 10ft" and "Improved Push (20 Feet)" now read their distances.
- **Form Up and Catch Rock** change nothing in a fight against PCs.
- **Fixed readings:** Trample listed with semicolons, after other text, or written out ("the damage of the headbutt Strike"), and a Strike found by its last word ("blade" for Dulled Blade); a Trample variant's own size (Keelhaul's Huge); Engulf with no damage; an untyped roll labelled as damage (`[[/r {1d8 + 8}]]{1d8 + 8 damage}`).
- **Checked live in pftest** (PFTEST SIM Orc Commander, Political Upstart, Horned Archon and Oath Dragon (Adult), deleted afterwards; Valeros restored):
  - Battle Cry with the commander, the archon and Valeros targeted: the card marked Valeros "not an ally: left out"; Apply gave the commander and the archon Effect: Battle Cry (1 round, until the commander's turn starts).
  - Fiery Rhetoric on Valeros: his Will went from +10 to +8.
  - On Valeros's turn, PF2e applied 12 damage to the commander: the archon's offer read "resists 6 of it (resistance 6)"; Resist, then Horn put the commander back to 26 HP, rolled the Horn Strike at Valeros, and marked the archon's reaction used.
  - The dragon's Claw hit Valeros 10 feet away: the Pull card's Athletics critically succeeded and pulled him 10 feet, stopping next to the dragon.

## Checks with prose results, and Resilient Form (2026-10-10, batch 5)

- **A monster's check against a creature's DC whose results are written as sentences** (no Critical Success / Success paragraphs) gets a card like the others:
  - "On a success, the target is Confused until the end of their next turn"; "If it succeeds, …; if it critically succeeds, …"; "Each creature the thief succeeds against is Fascinated"; "On a hit, …".
  - A bracket gives the critical success its own: "Clumsy 1 (Clumsy 2 on a critical success)", "pulling it up to 30 feet closer on a success (60 feet on a critical success)", "(doubled on a critical success)".
  - "On a critical success, the creature also falls Prone" adds to the success; "the damage is doubled" doubles it; a critical success that applies nothing of its own keeps the success's results and shows its text to the GM.
  - A critical failure that names no one else ("On a critical failure, it is Confused") falls on the user itself.
  - Off-guard only to the user ("Off-Guard against the aerialist's Strikes", "Off-Guard to Delaraius until …") is marked as Feint's is; "pulls the creature into an adjacent space" pulls it in (up to 30 feet).
  - What it can't apply is shown to the GM, as for saves. Not read: a passive's rider (a spell's), or a choice of what to try ("attempts to either pull … or Disarm …").
- **Fixed readings, all monsters:** "the grabbed creature" is no condition of its own; "Off-Guard until no longer sickened" is read (it used to be skipped as a condition ending), with "until no longer X" lasting while X does.
- **Resilient Form and the like** (Cushioned Blow, Extraneous Flesh): after a critical hit on the monster, the GM gets an offer to roll its flat check; a success makes the attack a normal hit (the GM applies its normal damage). A free action's version doesn't use the reaction. The simulator plays it.
- **Checked live in pftest** (PFTEST SIM Strix Aerialist, Enigmatic Conspirant, Cave Giant and Adamantine Dragon (Young), deleted afterwards; Valeros restored):
  - Aerial Feint on Valeros (critical success): the strix got "Valeros is off-guard to you" for 1 round.
  - Unbelievable Connection: Valeros was stupefied 1 for 1 minute and off-guard to the conspirant (the first try showed only a note; "until no longer stupefied" was then read).
  - Smear's critical success dealt 2×(2d8+8): 42.
  - Valeros critically hit the dragon (its AC lowered on the copy): Resilient Form's offer rolled the DC 17 flat check (11, a failure: the critical hit stood) and marked its reaction used.

## Strike abilities (2026-10-10, batch 6)

- **Follow-ups to a Strike that hit** ("Requirements The skull fairy's last action was a successful fist Strike … Effect … The creature must succeed at a Fortitude save or be Stunned 1"): the Effect is read as an ability of its own, a card when the GM uses it as before, on the creature the Strike hit. The simulator uses it only as the action straight after a hit with that Strike (any Strike when none is named; only a critical hit when it says so). Not read when the Strike is one of several ("… or a Draconic Frenzy that included …").
- **Several Strikes in one action**, read from more wordings for the simulator: "makes one claw Strike and one tail Strike in either order", "Froglegs makes two dagger Strikes", "makes two Strikes, one with their rapier and one with their dagger", "makes two unarmed Strikes" (its best melee Strike), "against a single creature", "the multiple attack penalty doesn't increase until after …", "Frequency once per turn", Flurry of Blows. Not with more to it ("If both hit the same creature, … must succeed at a save …" stays a Strike activity).
- **A Strike against each creature in reach** (Vine Lash, Thrash, Wide Cleave, Tail Sweep): the simulator Strikes every enemy in its Melee, the penalty rising only after all of them when the text says so.
- In live play the GM rolls these Strikes from the sheet as before; nothing new to check there.

## Moves before a Strike, and more Strike activities (2026-10-10, batch 7)

For the simulator (in live play the GM rolls these Strikes from the sheet as before):
- **Charges with other moves and wordings:** "Flies up to double its fly Speed … and then makes a talon Strike", "Uri Strides and makes a scimitar Strike at any point during the Stride", "Swims up to 10 feet and makes a jaws Strike against a foe within its reach", after a first sentence that only describes it.
- **Strike activities:** a named subject ("Viro makes a longsword Strike"); "Strides or Steps, then Strikes"; "This Strike deals an additional 3d6 precision damage"; extra damage written as plain dice ("1d12 electricity"); "This counts as two attacks for his multiple attack penalty"; "he deals an extra die of weapon damage" (Power Attack and the like). A move written into the subject ("The worm Burrows at least 10 feet and then attempts a jaws Strike") is read as a move.

## Save or die, pulls and penalties in prose saves, and the effect a result links (2026-10-10, batch 8)

- **Save or die:** "…must succeed at a Fortitude save or instantly die", "If it fails, it dies": on Apply, a creature that failed is at 0 HP and marked dead; the card says "Valeros dies".
- **Prose saves read more:** "…save or be pulled 10 feet toward the doblagub" pulls toward the monster (farther on a critical failure when a bracket says so); "…save or take a –1 status penalty to attack rolls for 1 round" is the penalty.
- **The PF2e effect a save or check links**, on results that apply nothing else (a save's failure and critical failure, a check's success and critical success): Apply puts a copy of it on the creature, or on the monster itself when the text says the monster gains it ("the raw nerve … gains a +2 circumstance bonus to AC"). An effect asking which result it was for (PF2e's "Degree of success" choice) is set to the creature's own result, so no prompt opens. Not where the text's own results were read (a penalty that differs by degree stays the text's).
- **Checked live in pftest** (PFTEST SIM Astradaemon and Ulat-Kini Mindreaver, deleted afterwards; the PCs restored):
  - Devour Soul on Ezren (critical failure): "Ezren dies"; Ezren was at 0 HP and marked dead.
  - Psychic Daze on Valeros (failure): "Valeros gets Psychic Daze", weakness 1 to mental damage for 1 minute. The first try opened PF2e's "Degree of success" prompt; the card now answers it from the creature's result.

## Abilities that cast a spell (2026-10-10, batch 9)

- **Read:** an action, reaction or free action whose Effect casts one PF2e spell or has its effects: "The onryo … casts a 5th-rank Geas on the creature it hit (DC 30)", "This has the same effect as the Possession spell (DC 23), except …", "The vampire can cast Dominate at will as a divine innate spell", "turns into a cloud of vapor, as the Vapor Form spell", "gains the effect of the Blur spell", "casts Spell Turning on him (counteract modifier +32)".
- **Not read:** a choice of spells or of actions ("Strides …, Leaps … or casts Translocate"); a Strike or another attack with it ("casts Translocate, then makes a melee Strike"); a spell its trigger or requirement names ("Trigger The wendigo casts Migration"); a rule on its own casting ("When the acolyte casts Harm …", "Casting a Shatter spell on the golem …"); a permission ("can cast Dominate through this sensory link"); a save of its own before the spell; a reaction that sends a spell back or counters the triggering spell; "one of the following"; passive abilities.
- **The card:** the spell, its rank and DC as fields the GM can change, and the ability's sentences that say more than the spell (its exceptions, what else happens) as notes. Its rank is the text's, or else half the creature's level rounded up, not below the spell's own rank (as a monster's focus spells and cantrips heighten). Its DC is the text's, or else the creature's best spell DC.
- **Cast** casts the spell through PF2e, which posts the spell's own card; the spell module resolves it as it does any cast. Nothing is spent. The creature's own copy of the spell is used when it has one at that DC (a vampire's innate Dominate); otherwise the first use adds an innate spellcasting entry named after the ability ("Turn to Mist (ability)": the text's tradition, the creature's own, or the spell's), kept at the card's DC. The ability's recharge starts on Cast.
- **A hazard** can't hold spells in PF2e: its Cast turns the card into a save card at the ability's DC, from the spell module's plan for the spell (through the core's registry), for the creatures targeted; Apply resolves it at the card's rank.
- **The simulator** gives the monster the spell as one of its abilities, at that rank and DC, with the spell module's plan (the creature's own copy of the same spell left out). A spell the engine can't cast, or one needing a DC the creature hasn't got, stays a gap.
- **Checked live in pftest** (PFTEST SIM Vampire Count, Culdewen, Color Spray Trap and Crystal Strider, deleted afterwards; the PCs restored):
  - Vampire Count's Dominate at Valeros: cast from its own innate Dominate at rank 6, DC 22; the spell module's "Prepare Saves — Save DC 22 Will" followed. Its Turn to Mist made a "Turn to Mist (ability)" entry and cast Vapor Form at rank 4.
  - Culdewen's Swear (Mariner's Curse, DC 25): cast at rank 5; with the fields changed to rank 6 and DC 27, the same entry was updated and the spell heightened.
  - Color Spray Trap's Color Spray: a DC 21 Will save card for Dizzying Colors on Merisiel; a success dazzled her until the trap's next turn.

## Strike activities in live play, and more Strike wordings (2026-10-10, batch 10)

- **A Strike activity's results on a hit:** when the GM uses an activity whose Strike does more on a hit (Intimidating Strike's "If it hits and deals damage, the target is Frightened 1, or Frightened 2 on a critical hit", Death Roll's Prone, Rhinoceros Charge's save, a Strike's extra persistent damage), the module waits for that creature's next Strike: the one the activity names ("a jaws Strike"), or any melee Strike when it names none.
  - A hit gets a card with the Strike's own roll in it ("Strike 23 vs AC 22: success"): the hit's results, or the critical hit's (the extra damage doubled), for the GM's Apply.
  - An activity with a save gets that save's card for the creature hit (only one small enough when the text sets a size).
  - A miss uses the activity up with no card; a Strike with another weapon leaves it waiting; a use more than 10 minutes old is dropped. "…and deals damage" is left to the GM.
- **More wordings, for the simulator:**
  - Sudden Charge: "Strides twice. If it ends its movement within melee reach of at least one enemy, it makes a melee Strike against that enemy."
  - Strikes against different creatures: "makes up to four tentacle Strikes, each against a different target", "tail Strikes against two different creatures", "two Strikes with its claw against two adjacent foes". The simulator Strikes that many enemies in its Melee (any enemies for a ranged Strike); these were played at one target before.
  - Swipe and Wide Swing: one attack compared to up to two foes' AC, counted as two attacks.
  - Coiling Frenzy: the dragon's Grab after either Strike hits.
  - "This Strike ignores their multiple attack penalty and doesn't count toward that penalty" (Wriggling Beard); "Frequency once per round" on a Strike activity.
  - Death Roll: "+2 circumstance bonus to the attack roll against the grabbed creature. If it hits, it also knocks the creature Prone."
  - "If they hit and deal damage, …", "(Frightened 2 on a critical hit)" in brackets.
  - Not read: a condition with a save of its own in the sentence ("Paralyzed … (DC 19 Fortitude negates)").
- **Checked live in pftest** (PFTEST SIM Jailer, Rhinoceros and Crocodile, deleted afterwards; the PCs restored):
  - Jailer's Intimidating Strike, then a Club Strike that hit Valeros (30 vs AC 21): the card's Apply made Valeros Frightened 1.
  - Rhinoceros Charge: a horn Strike that critically missed gave no card; the next use's hit gave a DC 21 Reflex save card for Seelah.
  - Crocodile's Death Roll: the jaws hit on Merisiel made her Prone on Apply. After another Death Roll, a Tail hit gave no card and left it waiting; the Jaws hit then got the card.

## Results with no roll (2026-10-10, batch 11)

- **Read:** an ability with no check whose result goes on the creatures it names: "The target takes @Damage damage" (Burn Alive), "The creature the megalodon hit takes 2d12 slashing damage" (Savage), "<it> deals 3d6 persistent bleed damage to the creature" (Serrated Takedown), "Each enemy within 30 feet takes …" (around it), "The target takes … and is Drained 1", "The creature gains Drained 1". A formula with the creature's level ("(@actor.level)[persistent,poison]") gets its level. A follow-up to a hit ("Requirements … last action was a successful jaws Strike") keeps that requirement for the simulator. Its later sentences, and one that says more than it applies ("…, and its resistances … are reduced"), are notes for the GM.
- **Not read:** a save, check or Strike in it (also one without an inline check: "must attempt a Reflex save"); a choice; some of them only ("Each creature that fails its save", "Every foe … taking persistent fire damage"); a result by a degree ("Frightened 1, or Frightened 2 on a critical hit"); "if", "unless", "instead"; damage per something; damage to itself; off-guard to some attackers only; concealment.
- **The card** says "no roll" and each target "affected"; Apply deals the damage (persistent damage as PF2e's condition) and the conditions, as a save card's results.
- **Core:** the check family's `check.roll: "automatic"` rolls nothing and gives every target the success row; the simulator counts it as certain (B40).
- The glossary's Grab (and Knockdown, Push, Pull) written out with no slug is read as that rider again.
- **Checked live in pftest** (the scene's PFTEST SIM Megalodon, and a PFTEST SIM Giant Animated Statue deleted afterwards; the PCs restored): Savage on Valeros, "Valeros takes 7 slashing"; Burn Alive on Seelah, 7 fire and 1d8 persistent fire.

## Reactions: Reactive Strike's older name, and concealment (2026-10-10, batch 12)

- **Attack of Opportunity:** the reaction offers knew only Reactive Strike's current slug. A monster whose reaction still has the older one ("attack-of-opportunity": Bestiary 1–3 and other older books, 441 PF2e and 32 Battlezoo) never got an offer; it now does, as Reactive Strike. Eleven more whose glossary text is written out with no slug ("Attack of Opportunity", "Reactive Strike (Tail Only)") are read as it again, as Grab and the other riders were in batch 11.
- **Concealment against the attack** ("The dragon gains concealment against the triggering attack", "The attacker must succeed at a DC 11 flat check in order to affect the drake, as if the drake were Hidden", "must attempt a DC 11 flat check; on a failure, the attack passes harmlessly through"): offered, as Nimble Dodge is, when an attack hits the monster (a ranged attack only when the trigger says so). Its button rolls the attacker's flat check, DC 5 (concealment) or DC 11 (hidden); a failure is a miss, so the GM ignores its damage. The reaction is used either way.
- **"If she succeeds at a DC 16 flat check, the attack becomes a normal hit"** (Saving Slash) is a critical-hit flat check, as Resilient Form's.
- **The simulator** (B41): the reaction's flat check when an attack hits; and any concealed or hidden target makes attackers roll a DC 5 or DC 11 flat check first.
- **Checked live in pftest** (PFTEST SIM Barghest and Shadow Drake, and a test combat, deleted afterwards; the PCs restored): the Barghest's Attack of Opportunity was offered when Valeros left its reach (Claw, Jaws, Not now); Valeros's critical hit on the Shadow Drake brought the Shadow Evade offer, whose flat check rolled 12 against DC 11 ("The attack still hits"), and the reaction was marked used.

## Passives a Strike lists are its riders (2026-10-10, batch 13)

- **The gap:** a passive ability that a monster's Strikes list ("Claw +12 … plus Paralysis") was read as a passive, so neither a hit in live play nor the simulator ever brought it (282 abilities: ghoul Paralysis, Drain Life, Sinful Bite and the like). It's now a rider of those Strikes, as Grab is: free, on a hit (on a critical hit alone when its text says "critically hit by" or "scores a critical hit"), on the creature the Strike hit (an area of its own stays). Actions the Strikes list ("Jaws … plus Algae Scourge") are riders at their own cost.
- **Newly read, for these riders only:** the trigger clause that opens a sentence is dropped ("When the devourer damages a living creature with its claw Strike, the devourer gains 10 temporary Hit Points and the creature must succeed at a … save or become Drained 1"); the Strike it names doesn't stop the reading; results with no roll ("A creature hit by the spider's web Strike is Immobilized … until it Escapes", "If the boggard hits a creature with its tongue, that creature becomes Grabbed") are batch 11's automatic results; "A Medium or smaller creature hit by …" gets its size as a note.
- **Not read:** a trigger clause with a condition of its own ("against a creature that's taking persistent bleed damage", "a Small or smaller creature …, and the target is made of metal", or a hit that must also drop the creature to 0 HP), or one on a miss too ("regardless of whether or not it hit").
- **Checked live in pftest** (PFTEST SIM Boggard Warrior and Envyspawn, deleted afterwards; the PCs restored): the boggard's Tongue hit Valeros (24) and its Tongue Grab card followed, with no roll; Apply grabbed him, with its notes ("isn't Immobilized, but …"). The envyspawn's Jaws hit Seelah (25): the Sinful Bite DC 18 Will save card; she rolled 15, a failure, and was Sickened 2, as its text's failure says.

## Abilities that act as the monster dies (2026-10-10, batch 14)

- **The gap:** "When the skeleton is destroyed, its bones shatter and explode. Adjacent creatures take 2d6 slashing damage (basic Reflex save)", "When a sodden sentinel is reduced to 0 Hit Points, it explodes …" were read as passives that nothing triggers (124 with a save). Their trigger is now the monster's death: an opening "When/If/As … dies / is destroyed / is killed / is slain / is reduced to 0 Hit Points". Their area is the template, "adjacent creatures" (5 feet), or "each creature within 30 feet". One more with no roll ("…, dealing 1d6 slashing and 1d6 poison damage to each creature within 30 feet").
- **Live play:** when the monster's Hit Points reach 0, a card for each such ability, headed "as it dies", for every creature (on either side) within its area of the monster's space, measured as auras are; once for each death (30 seconds). One with no area has no targets: the GM targets the creatures and presses Use my targets.
- **The simulator** (B42): as the monster dies, the ability on the creatures in its Melee (10 feet or less), those not far off (more), or everyone (60 feet or more); one with no area isn't played.
- **Checked live in pftest** (a PFTEST SIM Firewyrm, deleted afterwards; the PCs restored): its HP set to 0 brought the Explosion card ("as it dies", DC 28 basic Reflex) for the 8 creatures within 10 feet of its Huge space. With Valeros and Seelah targeted instead: Valeros critically succeeded, Seelah critically failed and took 30 fire.


## Passives that answer a melee hit on the monster (2026-10-10, batch 15)

- **The gap:** "A creature that hits the pukwudgie with an unarmed Strike or a non-reach melee Strike takes 3d8 piercing damage (basic Reflex save)", Short Circuit's 5 electricity on an unarmed hit, Corrosive Flesh, Rotting Flesh: read as passives with a save, or not read at all, and nothing set them off. Their trigger is now a melee hit on the monster ("A creature that hits / touches / Strikes / grapples …", "If a creature hits … with a melee Strike"), on the attacker. One that names only unarmed attacks, touching or grappling is for unarmed Strikes only. Not read: only some weapons ("with a metal weapon"), a ranged attack or a spell, a condition on the attacker, the first hit only, the monster's body after it dies. 33 in all (23 PF2e, 10 Battlezoo).
- **Live play:** a melee Strike that hits a monster or a hazard with such a passive (PF2e's "item:melee" roll option or a melee domain) posts its card on the attacker, headed "hit by Valeros". Not for a ranged or thrown Strike; for an unarmed-only one, not for a weapon. A Grapple isn't caught: the GM targets the creature and uses the ability from the sheet.
- **The simulator** (B43): after a melee Strike that hits, the monster's passive acts on the attacker; an unarmed-only one only after an unarmed Strike.
- **Also fixed:** "takes 1d6 void damage and must succeed at a Reflex save or become Enfeebled 2" halved the damage on a success. The save decides only the rest: the damage now comes at every degree (8 abilities: Final Shake, Soul Bleed, Unusual Bane, Ectoplasmic Secretions, Withering Aura and others).
- **Checked live in pftest** (PFTEST SIM Pukwudgies and a Sparking Zombie Brute, deleted afterwards; Valeros restored):
  - Valeros' longsword hit on the pukwudgie brought the Defensive Quills card (DC 22 basic Reflex); he succeeded and took 7 of the 15 piercing.
  - On the zombie, his longsword hit brought no card; his unarmed hit brought Short Circuit's (no roll), and Apply dealt 5 electricity.
  - A pukwudgie's thrown hatchet critically hit the other pukwudgie: only its own Pukwudgie Poison card, no Defensive Quills.

## Reactions to a hit or damage on the monster (2026-10-10, batch 16)

- **The gap:** reactions with a save or other results of their own (Shrapnel Splash, Regent's Glower, Freezing Blood, Reactive Thrash, Solar Flare, Self-Destruct) were read, but nothing offered them: the GM had to notice the trigger and use them from the sheet. The simulator never used them.
- **Their trigger is read now:**
  - a hit or a critical hit on the monster: "The dragon is critically hit with a melee weapon or unarmed attack", "A creature within the thoqqua's reach hits the thoqqua with a melee Strike", "An adjacent creature deals piercing or slashing damage to the dragon", "A creature within 30 feet damages the oath howler";
  - damage on it from anything: "The bul-gae takes damage", "The nyogoth takes piercing or slashing damage";
  - its death: "The juggernaut is reduced to 0 Hit Points".
  - Not read: any other trigger (a spell cast, a move, a hazard's), one with a condition of its own (an ally, an aura, a size, a metal weapon, "at least 40 points of damage"), or one of several triggers in a list. The first of two ("A foe critically hits the banshee, or the banshee critically fails …") is read; the GM uses it for the other.
  - 130 in all (115 PF2e, 15 Battlezoo): 78 hits, 23 damage, 14 deaths in PF2e.
- **Its targets:** the attacker when the text names it ("the triggering creature", "the creature who dealt the triggering damage", or "the creature" as the first it names); the creatures in its emanation ("on adjacent creatures", "Each creature within 10 feet"); otherwise the GM's.
- **Live play** (in an encounter, when the monster can react):
  - after an attack roll on it that sets it off (melee or any attack, critical or not, unarmed, within its distance), the GM gets a whispered offer: "Valeros rolled a critical hit against it", with Use it and Not now;
  - when PF2e applies damage to it: "Valeros hurt it (10 damage, on Valeros's turn)", the creature whose turn it is taken as the attacker;
  - a damage type it needs is a note on the offer ("Only on piercing or slashing damage."): the GM checks it;
  - Use it posts the ability's card on the attacker or on the creatures in its emanation (both sides), or with no targets for the GM to target, and marks the monster's reaction used;
  - its death: the card as it dies, as for death throes (batch 14).
- **The simulator** (B44): the monster uses it whenever it can react and the ability is ready, on the attacker, or on the creatures in its area when a foe is among them. Over Monster Core 1–2, Bestiary 1–2 and the Lost Omens bestiary (4,521 fights, no errors): Freezing Blood 56, Shrapnel Splash 33, Regent's Glower 33, Boiling Blood 23, Biomineralize 22, Rage of the Divine 21, Hell's Sting 19, Caustic Blood 14 and six more.
- **Checked live in pftest** (a PFTEST SIM Diabolic Dragon (Young) and Nyogoth in an encounter with Valeros, deleted afterwards; HP restored):
  - Valeros' miss and his plain hit on the dragon brought no offer; his critical hit brought Hell's Sting's. Not now closed it; a second critical hit brought it again, and Use it posted the card on Valeros (DC 30 basic Will) and gave the dragon "Reaction used". He critically failed and took 42 mental.
  - 10 damage on the nyogoth during Valeros' turn brought Caustic Blood's offer ("Only on piercing or slashing damage."); Use it posted the card on the six creatures adjacent to it, both sides. Applied: double on a critical failure, full on a failure.

## More dodges, and answers to a mental effect (2026-10-10, batch 17)

- **AC reactions in other wordings:** Nimble Dodge and the like were read only when the item had PF2e's rule for the bonus and the words "AC against the triggering attack". Now also:
  - the bonus from the text ("gains a +2 circumstance bonus to AC against the triggering Strike");
  - no "Effect" label ("Trigger Pin is targeted with a melee or ranged attack by an attacker he can see. Pin gains …");
  - more after the bonus ("…, then Strides up to half their Speed after the Strike resolves", resistance against the attack), shown as a note on the offer for the GM;
  - melee or ranged attacks only ("An adjacent enemy targets the swarm with a Strike", "targeted by a physical ranged Strike");
  - Shielding Wing's own part ("The oath dragon or a bonded companion within 15 feet is targeted").
  - Not read: a reaction that protects another creature (an ally, a rider, a liege), one with a requirement other than "not encumbered", one against a spell, a splash or an area, one that lasts ("until the start of its next turn").
  - 27 more (25 PF2e, 2 Battlezoo). The simulator plays them as Nimble Dodge, melee or ranged only where they say so (B45).
- **A mental effect aimed at the monster:** Otherworldly Mind's "Whenever a creature targets the hound with a mental effect, that creature takes 8d6 mental damage (basic Will save)" (14 monsters, and Destiny Tempest's), Entropic Feedback's and Psychic Superiority's reactions ("A creature attempts to target the hundun with a mental effect", "… with a mental effect or spell").
  - Live play: a skill check or an attack roll at the monster with the trait (Demoralize), or the monster's save against a targeted spell or effect with it (Daze, Fear; not an area's, such as Calm), sets it off. A passive's card goes on the creature that aimed it ("targeted by Valeros"); a reaction is offered to the GM in an encounter, and Use it posts its card.
  - The simulator (B46): after a targeted spell or action with the trait (Demoralize too), the passive on its caster; the reaction when the monster can react.
- **Checked live in pftest** (a PFTEST SIM Hound of Tindalos and Hundun Chaos Mage, deleted afterwards; Valeros restored):
  - Valeros' Demoralize at the hound brought the Otherworldly Mind card on him (DC 25 basic Will); he failed and took 7 mental on Apply.
  - The hound's Will saves against Ezren's Daze and Fear each brought the card on Ezren; against Electric Arc (not mental) and Calm (an area), none.
  - In an encounter, Valeros' Demoralize at the hundun brought Entropic Feedback's offer ("Valeros aimed an effect at it (mental)"); Use it posted its DC 40 Will card on him.

## Reactions to its own Strike, to being attacked, to a turn starting near it, and at initiative (2026-10-10, batch 18)

- **Their triggers are read now** (reactions, and free actions with a trigger):
  - its own Strike that hits or critically hits, the Strike and the size its trigger names: "The tyrannosaurus critically hits a Large or smaller foe with its foot" (Pin Prey), "Raskus critically hits with a beak Strike", "The pachycephalosaurus damages a Medium or smaller foe with its skull Strike". On the creature it hit, or around it ("a blast of lightning in a 10-foot burst centered on the target", Storm Smite). Not one on only some creatures ("a holy creature", "an off-guard creature").
  - a Strike at it, before the roll: "A hostile creature targets the jinxer with a melee Strike", "Adma is targeted with a Strike by a creature within 30 feet". On the attacker.
  - a creature starting its turn near it: "A creature within 30 feet that the basilisk can see starts its turn" (Petrifying Glance, Draining Glance). On that creature; "a living creature" not on undead or constructs.
  - rolling initiative: "Losko rolls initiative" (Chilling Cry, Predestined Defeat, Dramatic Entrance). On the creatures in its area.
  - also "A creature scores a critical hit on the firehoof minotaur" (batch 16's hits), and batch 16's triggers on free actions.
  - Not read: one that leaves a lasting area ("…; a creature who starts its turn in the area takes …"), one aimed at a creature other than the one that set it off ("chooses a different creature … and attempts to swap places with that creature"), "rolls initiative while in water".
  - 41 in all (37 PF2e, 4 Battlezoo).
- **Live play** (in an encounter): the GM's offer as for batch 16, and Use it posts the card.
  - its own Strike: after its attack roll hits ("Valeros took a hit from Skull");
  - attacked: after the attack roll, with a note: the reaction comes before the roll, so when its result stops the attack, the GM sets the roll aside;
  - a turn starting: when the encounter's turn changes, for each monster that can react within the distance;
  - initiative: when the encounter starts.
  - A free action doesn't use the monster's reaction; its card says "free action".
- **The simulator** (B47): its own hit, after the Strike; a Strike at it, before the roll (one that leaves the attacker unable to act stops the Strike); a turn starting near it, by the bands; initiative, as the fight starts. Over seven bestiaries (5,673 fights, no errors): Petrifying Glance 47, Draining Glance 9, Dramatic Entrance 6, Sudden Shove 3.
- **Checked live in pftest** (a PFTEST SIM Basilisk, Pachycephalosaurus, Grippli Jinxer and Flamboyant Thief in an encounter with Valeros, deleted afterwards):
  - Starting the encounter brought Dramatic Entrance's offer (a free action: Use it left the thief's reaction unused; its card, Performance against each Will DC, listed the creatures within 120 feet) and, as Valeros' turn started, Petrifying Glance's (its card: DC 20 Fortitude on Valeros; the basilisk got "Reaction used").
  - Valeros' Strike at the jinxer (a miss) brought Hypnotic Tattoos' offer with the note; its card was DC 22 Will on Valeros.
  - The pachycephalosaurus' skull hit on Valeros brought Sudden Shove's offer; its card was Athletics against his Fortitude DC.

## Passives: more death wordings, its own critical hit, damage on it (2026-10-10, batch 19)

- **The gap:** of the NPC passives with results that nothing set off (176), three groups had triggers the module can follow.
- **More death wordings** (batch 14's): "When killed, the star archon explodes …", "When destroyed, a flaming skull explodes …", and the clause opening a later sentence with "it" or "they" ("The snapdrake's death reveals one last surprise. When it dies, it explodes …"); "Each time … and when they're reduced to 0 Hit Points". Not a death a later sentence mentions otherwise ("When the creature dies, it rises as a spawn"). 13 more.
- **Its own Strike:** "When the gunmarshal makes a critical hit with a firearm, the target must succeed at a Fortitude save or be Stunned 1" (critical specializations), "When the kurobozu scores a critical hit with an unarmed attack, …", "When the tough deals damage on a critical hit, …", "When a target takes damage from one of the dragon's melee Strikes, …". The kind of weapon it names (a firearm, an unarmed attack, a brawling weapon, its melee Strikes) or a Strike's name. On the creature it hit. 17 (2 Battlezoo).
- **Damage on it:** "When the penanggalan takes slashing damage, their wound spews bile on adjacent creatures …", "Whenever the festrog takes piercing or slashing damage, creatures adjacent to the festrog take …", "Each time an adjacent creature deals slashing or piercing damage to the brimorak, the attacker is sprayed …", "If the arboreal snag takes damage from a piercing attack, …", "When the dragon takes a critical hit from any attack that deals physical damage, …". Read as batch 16's reactions are, with no reaction: on the attacker, or the creatures around it. Not the first time each round only, nor damage "from a source other than itself". 16.
- **Live play:** the card, with no offer (a passive):
  - its own Strike: after its attack roll hits, headed "after Flintlock Musket";
  - a hit on it: after the attack roll, as batch 15's (now any attack when it says so, a critical hit only, around the monster);
  - damage on it: when PF2e applies damage to it, headed "took 10 damage"; on the creatures around it, or on the creature whose turn it is when it names the attacker.
  - The damage types it needs are a note on the card ("Only on slashing or piercing damage."): the GM checks them.
- **Also fixed:** a token smaller than a square (a Tiny creature's) now occupies the square it's in when distances are measured (auras, death cards, reactions). A flaming skull's explosion missed the creature next to it: the half-square gap counted as 10 feet.
- **The simulator** (B48): its own hit, after the Strike; damage on it, as PF2e applies it; a hit on it, with the types dealt. Over seven bestiaries (5,673 fights, no errors): Boiling Blood 37, Sacred Wrappings 31, Shimmering Armor 24, Viviparous Birth 15, Spewing Bile 6, Toxic Blood 6, Diseased Pustules 5 and more.
- **Checked live in pftest** (a PFTEST SIM Flaming Skull, Festrog, Brimorak and Gunmarshal, deleted afterwards; Valeros restored):
  - Valeros' longsword critical hit on the brimorak brought Boiling Blood's card on him ("Only on slashing or piercing damage."); he succeeded and took 2 of the 4 fire.
  - 10 damage on the festrog brought Diseased Pustules' card on the six creatures adjacent to it.
  - The gunmarshal's musket critical hit on Valeros brought Firearms Critical Specialization's card on him, "after Flintlock Musket".
  - The flaming skull at 0 HP brought Fiery Explosion's card; at first it missed Valeros next to it (the Tiny token's gap), and after the fix it listed him and the others around its square.

## Passives on a creature it holds, as a turn starts or ends (2026-10-10, batch 20)

- **Read now:** "A creature that starts its turn grabbed by the baatamidar must attempt a Will save …", "When a creature ends its turn Swallowed Whole by the animated wine vessel, it must …", one acting at the end of the monster's own turn on every creature it has grabbed, and one with no roll that wasn't read before ("A creature that starts its turn Grabbed by the doprillu takes 7d6 fire damage"). "A living creature" not on undead or constructs. 9 in all (7 PF2e, 2 Battlezoo, with batch 19's damage reading now also taking a subject such as "Whenever a husk takes fire damage").
- **Live play:** on PF2e's turn start and end. On the held creature's turn, its holder's card on it; on the monster's own turn, its card on each creature it holds. Swallowed: the "Swallowed by …" effect names the monster. Grabbed: PF2e's grabbed or restrained condition within the monster's reach, as PF2e doesn't say who holds it, so the card says "Only if the doprillu is the one holding it."
- **The simulator** (B49): at the start and end of each turn, by who holds whom (grabbed or restrained by it and not swallowed; swallowed, inside it).
- **Checked live in pftest** (a PFTEST SIM Doprillu next to Valeros, Grabbed, in an encounter; deleted afterwards, Valeros restored): his turn starting brought Volcanic Veins' card on him with the note; Apply dealt 24 fire. Without the grabbed condition, his next turn brought none.

## A condition the monster always has (2026-10-10, batch 21)

- **Read now:** "A zombie is permanently Slowed 1 and can't use reactions" (Slow), "Inizra is permanently Quickened. She can use her extra action only to Strike." (Weapon Supremacy; also "to Stride or Strike"), "The irnakurse is permanently Frightened 2, …". Not one only to move ("its extra action only to Step or Stride"), a choice of conditions, or one with a condition of its own ("while it's in sunlight"). 78 (77 PF2e, 1 Battlezoo).
- **Live play:** as the encounter starts, the monster gets the condition when it doesn't have it yet, with a GM-only note ("Slow: the sulfur zombie is slowed 1 for good and can't use reactions."); at each of its turns, the condition goes back up if PF2e lowered it. PF2e's own data already gives 70 of the 78 their condition (a rule on the ability, or the condition on the actor): for those, nothing changes. Reaction offers skip a monster that can't use reactions.
- **The simulator** (B50): the condition from the start of the fight and back at each of its turns; no reactions when it says so. Quickened only for Strikes counts as quickened. This matters most for creatures read straight from PF2e's packs (the bestiary tool), where a zombie had all three actions before.
- **Checked live in pftest** (PFTEST SIM zombies and an irnakurse, deleted afterwards): a Zombie Shambler, an Ofalth Zombie and the Afflicted Irnakurse already had their condition from PF2e, and nothing was added; a Sulfur Zombie (no rule in PF2e's data) got Slowed 1 as the encounter started, with the GM-only note.

## Reactions to a creature acting near the monster, and casting provokes in the simulator (2026-10-10, batch 22)

- **Read now:** reactions with results of their own on Reactive Strike's triggers, and a few more: "A creature within the razorbones' reach uses a manipulate action or a move action or leaves a square during a move action it's using", "An enemy within 5 feet of the arboreal copse uses …, makes a ranged attack, or …", troops' "within a 10-foot emanation", "A creature within 30 feet Strides", "A creature the brine dragon observes within 30 feet uses a concentrate action", "A creature within 100 feet makes a ranged attack or uses an action that has the concentrate trait", "A creature enters the thunderbird's reach …", "A creature moves adjacent to the pakalchi". On the creature that acted. Not one in a place ("in area A7", "beneath the portcullis"), or an aura it leaves. 31 (24 PF2e, 7 of them hazards' that the GM still uses; 3 Battlezoo).
- **Live play** (in an encounter, a monster that can react): its offer when a foe moves (leaving a square within its distance, moving within it, or coming into it, with "If this was a Step, it doesn't trigger."), makes a ranged attack, casts a manipulate spell, or casts a concentrate spell or makes a check with the concentrate trait (Demoralize), within its distance (its reach, or the feet it names).
- **The simulator** (B51): the same, where the simulation has them (leaving a Melee, a ranged attack, a manipulate or concentrate action).
- **Also fixed in the simulator:** casting a spell with the manipulate trait in a Melee now provokes Reactive Strike, as spell decision S12 says (the planner already counted the cost, but casting never provoked); a critical hit disrupts the spell. A concentrate action provokes only the reactions that say so.
- **Checked live in pftest** (a PFTEST SIM Lacridaemon and Izhkarial in an encounter with Valeros, deleted afterwards): Valeros' move of one square brought Steal Bearings' offer ("moved within 30 feet", with the Step note); his Demoralize at the dragon brought Brine Spit's ("used a concentrate action"), and Use it posted its DC 34 basic Reflex card on him.

## More spell wordings, and linked words in built-in readings (2026-10-10, batch 23)

- **Spells (batch 9's casting, in more wordings):** "Each creature in the area is subjected to a 5th-rank Phantasmal Killer spell", "is subjected to the effects of Divine Decree", "takes the effects of the Charm spell", "suffers the result of a 4th-rank Charm spell", "affects all enemies it can see within 60 feet with Calm", "affecting them with Wave of Despair (7th level, … save)", "targeting the creature with Phantasmal Killer", "must succeed at a … save or be affected by a 6th-rank Dominate spell", "is targeted by Cursed Metamorphosis". "The eloko is affected by a 4th-rank Enlarge spell": on itself. 28 more (25 PF2e, 3 Battlezoo).
  - Not any more: a spell after a check or damage the spell doesn't bring ("… must succeed at an Acrobatics check or take … damage. Additionally, a creature damaged by it is affected by Command"): its card had only the spell. One ability lost its card this way (Taviah's Drain Thoughts).
- **Linked words:** the built-in readings (several Strikes, charges, reactions) now read a linked word as its label. Coiling Frenzy ("…can attempt to Grab the target with that limb…", Grab linked) was never read; neither was "…automatically Grabs the target". 29 more (24 PF2e, 5 Battlezoo): Coiling Frenzy on 25 dragons, Slaughter Tackle, Eagle Dive.
- **Checked live in pftest** (a PFTEST SIM Terrorguard, deleted afterwards): Breath of Phantasms posted its cast card, "Phantasmal Killer (rank 5, DC 31)"; Cast posted PF2e's own spell card for Phantasmal Killer at rank 5.

## The monster healing itself (2026-10-10, batch 24)

- **Read now:** "Frequency once per round Effect The imp regains 1d6 Hit Points", "The quasit restores 1d6 HP to itself", "The golem repairs itself, regaining 30 Hit Points", "… repairing the damage and restoring 40 HP to itself. The canopy elder can't use Vine Splint again for 1d4 rounds." A plan of the core's healing family on itself. Its requirements ("Requirements The bush is adjacent to a corpse …") and its other sentences (words only) are kept for the GM. Not one that heals others too ("… and each living ally within 10 feet"), or by a count ("for each enemy that is frightened"), or with a roll or condition in its other sentences. 79 (78 PF2e, 1 Battlezoo); 60 of them have requirements.
- **Live play:** when the GM uses it, PF2e's own healing roll is posted ("Abyssal Healing: the quasit heals itself", with "Only if: …" for its requirements), with PF2e's button to apply the healing to the selected token; its recharge starts.
- **The simulator** (B52): one without requirements is an action that heals the monster, which the planner weighs as any healing; one with requirements isn't played.
- **Checked live in pftest** (a PFTEST SIM Quasit at 5 HP, deleted afterwards): Abyssal Healing posted a 1d6 healing roll, "Abyssal Healing: PFTEST SIM Quasit heals itself", whose card offers "Apply full healing to selected tokens".

## More charges and Strike activities (2026-10-10, batch 25)

- **Read now** (for the simulator, as batch 7's charges and batch 10's Strike activities):
  - a move and a Strike in more actions than the moves take: Swoop's "The pteranodon Flies up to its Speed and makes one beak Strike at any point during that movement" (2 actions); before, a charge's actions had to equal its moves;
  - "Grandfather Mantis Strides, then Strikes.", "… Strides twice, then Strikes with their horn", "Strides up to two times";
  - the 20-foot bonus in more wordings: "As long as he moved at least 20 feet, he gains a +2 circumstance bonus to his attack roll", "… to the attack roll", "If it moved at least 20 feet from its starting position, the Strike's damage is increased to …"; and "During the Stride, it gains a +10-foot circumstance bonus to its Speed" (nothing for the simulation);
  - "A Medium or smaller creature damaged (or hit) by this attack must succeed at …", as "struck by".
  - 33 (26 charges, 7 Strike activities with a save), all PF2e.
- **Live play:** the Strike activities' saves come as batch 10's cards after their Strike hits; charges stay the GM's (PF2e's own Strike).
- Over seven bestiaries (5,673 fights, no errors): Powerful Charge 6, Swoop 5, Thundering Charge 4, Rush 2, Furious Charge 2.

## A condition the monster gives itself or its allies (2026-10-10, batch 26)

- **Read now:** an action whose only result is a helpful condition on the monster itself or on its allies, with no roll:
  - on itself: "The dread wisp extinguishes their Dread Flickering, becoming Invisible", "The peng is Concealed until the end of their next turn";
  - at the start of its own turn, as a free action: "Trigger The charau-ka's turn begins. … Effect The charau-ka is Quickened until the end of its turn" (offered to the GM as that turn starts);
  - on its allies: "Each ally who hears and understands this command becomes Quickened until the end of that ally's next turn", "All allies within the dragon's heartening aura become Quickened for 1 round", "Each other zombie within 10 feet of the dirge piper is Quickened for 1 round". "Their/that ally's next turn" is each one's own turn.
  - Not one on "the animal", "the target" or another creature, and not one whose other sentences roll or deal damage.
  - 52 (47 PF2e, 5 Battlezoo): 31 on itself, 9 at its turn start, 12 on its allies. Quickened 30, Invisible 12, Concealed 5.
- **Live play:** when the GM uses it, its card applies the condition to the monster's own token, or to its allies (the tokens of its disposition within the emanation, or the GM's targets for "each ally"). The start-of-turn ones are offered as the monster's turn starts, as a free action (the reaction stays unused).
- **The simulator** (B53): Quickened gives an extra action (at once, when the monster gives it to itself on its turn); Concealed and Invisible make it harder to hit; the planner weighs them as any helpful condition. Commands to allies go to its allies only, so they're used only when it has some.
- Over seven bestiaries (5,673 fights, no errors): Go Dark 18, Shrieking Frenzy 18. With a second copy of each monster (four packs, 2,550 fights, no errors): Royal Command 10, Korog's Command 10, Inspiring Word 7, Advancing Orders 1.
- **Checked live in pftest** (a PFTEST SIM will-o'-wisp and charau-ka, deleted afterwards): Go Dark's card went on the wisp itself, and Apply made it Invisible; Shrieking Frenzy was offered as the charau-ka's turn started, and its card made it Quickened with a timed effect.

## More results of a Strike activity's hit (2026-10-10, batch 27)

- **Read now** (batch 10's Strike activities, part by part):
  - extra damage and a condition in one sentence: "If this Strike hits, it deals an additional 2d8 damage, and the target is knocked Prone", "If this Strike hits, the babau deals an additional 2d6 damage of the same damage type, and the creature struck is Frightened 2", "On a hit, the target takes an additional 2d4 electricity damage and is pushed back 5 feet";
  - damage the target takes: "On a hit, the target takes 5d6 persistent acid damage, and is Sickened 3 …", "If they succeed, the target takes 1d6 bleed";
  - extra damage and a save: "If the Strike hits, it deals an additional 2d6 mental damage, and the target must succeed at a DC 20 Will save … or become Confused for 1 round"; "succeed on a … save" too;
  - weapon dice: "they deal two extra dice of weapon damage", "an additional die of weapon damage and 1d4 persistent bleed damage";
  - the opening's extras: "makes a melee Strike with its gaff" (the gaff Strike), "making a Strike with a -2 circumstance penalty to the attack roll", ", dealing an extra 2d6 bleed on a hit (4d6 bleed on a critical hit)", "Strikes with their rapier, and they gain a +1 circumstance bonus to the attack roll";
  - "On a critical hit, the target is pushed back 10 feet"; "The extra damage and frightened value are doubled on a critical hit"; "After this Strike, the harmona can Fly up to half their fly Speed" (the GM's move).
  - Extra dice with no type ("an additional 2d8 damage") are the Strike's own type.
  - Not one whose result depends on something else ("Slowed 1 … if the Strike dealt bludgeoning damage"), or whose duration isn't read ("until the persistent damage ends").
  - 35 (33 PF2e, 2 Battlezoo): Skewer, Vicious Swing, Grievous Strike, Rearing Thrust, Shock Mind, Concussive Blow, Calculated Blow, Foxfire Blast, Kick Back, Wall Slam and the like.
- **Live play:** as batch 10, when the Strike hits after the GM uses the activity: a card with the damage and conditions by the Strike's degree, its untyped dice taking the type of the Strike that hit (doubled on a critical hit, a farther push then), and the save's card after it when there's one.
- **The simulator** (B54): the same, the untyped dice of the Strike's damage type.
- Over seven bestiaries (5,673 fights, no errors): Skewer 18, Calculated Blow 7, Grievous Strike 6, Kick Back 2, Shock Mind 2, Fiendish Lunge 1.
- **Checked live in pftest** (a PFTEST SIM Grioth Cultist, Babau and Goblin Warrior, deleted afterwards): Shock Mind's hit posted the damage card ("Strike 18 vs AC 16: success") and the DC 20 Will save card; Apply dealt 9 mental damage. Grievous Strike's critical hit with the Claw posted 2×(2d6) slashing; Apply dealt 18 slashing and made the goblin Frightened 2.

## Steady Spellcasting, Golem Antimagic, healing as it dies, more riders, natural invisibility (2026-10-10, batch 28)

- **Steady Spellcasting** (81, 2 Battlezoo): "If another creature's reaction would disrupt the cleric's spellcasting action, the cleric attempts a DC 15 flat check. On a success, the action isn't disrupted." Read as its flat check's DC (15; 12 for troops, 17 once). For the simulator only (B55); in live play PF2e's own flat-check button on the sheet stays the GM's, as disruption isn't tracked.
- **Golem Antimagic** (46, 4 Battlezoo): "Harmed by fire (5d8, 3d4 from areas or persistent damage); healed by electricity (area 2d4 HP); slowed by cold" (PF2e's glossary for the rest). Read as what harms, heals and slows it, with the amounts.
  - **Live play:** a spell's attack roll against the golem, or the golem's save against a spell:
    - harmed: PF2e's untyped damage roll ("… is harmed by Ignition, instead of its usual effect"), whatever the attack roll;
    - slowed: a card applying Slowed 1 for 2d6 rounds (rolled);
    - healed: a note to the GM ("loses Slowed and regains Hit Points equal to half the damage the spell would have dealt"), or an area's healing roll;
    - anything else: a note to the GM that it's immune.
  - From an area: the amounts in brackets, and slowed for that round. PF2e's data doesn't list golems' immunity to magic, so the spell's own damage is still the GM's to leave unapplied.
  - **The simulator** (B56): the same; the planner knows the golem shrugs off other magic.
- **Healing as it dies, for creatures of a kind** (30): Verdant Burst's "When a leshy dies, a burst of primal energy explodes from its body, restoring 2d8 Hit Points to each plant creature in a 30-foot emanation" (Rotten Burst: "each undead fungi or plant creature"). Its other sentences (difficult terrain) are the GM's notes.
  - **Live play:** as it dies, PF2e's healing roll naming the creatures of that kind within the emanation, with its button to apply the healing to the selected tokens.
  - **The simulator** (B57): those creatures in the area are healed.
- **More riders** (13, 1 Battlezoo):
  - "Creatures hit by the clockwork assassin's rapier hand Strike are Off-Guard …", "A creature critically hit by an amphisbaena's spit Strike is Blinded for 1 round": the creature hit as the subject;
  - a passive that names its Strike but isn't listed by it ("When the wraith damages a living creature with its spectral hand Strike, …") rides on the Strike it names;
  - **fixed:** a rider for critical hits only ("A creature critically hit by …") came on every hit, in live play and in the simulator (39 such riders); now only on a critical hit (B58).
- **Naturally invisible** (12): "A poltergeist is naturally Invisible. It becomes visible only when it uses Frighten.", "The phade is Invisible at all times, though when it takes a hostile action …". Invisible as a condition it always has (batch 21's), back at the start of its turns; not one only somewhere ("while within sight of their bound home"). The simulator plays it as hidden (B58).
- Over seven bestiaries (5,673 fights, no errors); the critical-hit fix shows: Devastation 14 → 1, Grievous Wound 5 → 1, Blinding Sand 4 → 0. With a second copy of each monster: Verdant Burst and Spiny Burst heal the other leshy.
- **Checked live in pftest** (PFTEST SIM Flesh Golem, two Leaf Leshies, Goblin Warrior, Poltergeist and Amphisbaena, and a token of the PFTEST SIM Ezren fixture; deleted afterwards):
  - Ignition at the golem: "harmed by Ignition" with a 5d8 untyped roll;
  - Frostbite: the slowed card, whose Apply made it Slowed 1 with a 6-round effect;
  - Electric Arc: the healed note;
  - Hand of the Apprentice: the immune note;
  - a leshy at 0 HP: a 1d4 healing roll naming only the other leshy, whose button healed it 3;
  - the poltergeist's Invisible, removed, came back at its turn;
  - the Amphisbaena's Blinding Spittle card came with its 2 critical hits and none of its 4 plain hits.

## Critical hits made hits, resistance against a critical hit, champion reactions, more reaction triggers (2026-10-10, batch 29)

- **A critical hit made a normal hit, with no check** (9): Collapse's "the attack deals damage for a hit, rather than a critical hit" or "… deals only normal damage", Twist Fate's "The triggering attack becomes a hit instead", Half-Ear's Luck (a free action, once a day). Collapse's "until it does, it is Immobilized and Off-Guard" (re-forming as an action) comes with it.
  - **Live play:** offered as a critical hit lands on the monster ("Use it": apply the attack's normal damage), as batch 12's flat-check ones; Use applies Collapse's Immobilized and Off-Guard.
  - **The simulator** (B59): the critical hit is a hit; a collapsed monster spends its first action re-forming.
- **Resistance against a critical hit** (24): "Trigger The dragon is critically hit by an attack; Effect … gaining resistance 20 to all damage against the triggering attack" (Wished Away, Withhold Death, Divine Deflection).
  - **Live play:** offered on the critical hit, with the resistance for the GM to take off as the damage is applied.
  - **The simulator** (B60): the critical hit's damage with that resistance.
- **Nimble Dodge's older wording** (5): "Requirements … can't use this reaction while Encumbered. Trigger … is hit or critically hit by an attack made by a creature it can see": +2 AC against the attack, offered on a hit it would turn into a miss.
- **Champion reactions in their own words** (14): Archon's Protection, Exalted Retributive Strike and Retributive Strikes written out ("The ally gains resistance 15 to all damage against the triggering damage and the archon can make a Strike against the enemy"): the glossary Retributive Strike's offer (its resistance, then a Strike) and simulation.
- **More reaction triggers** (28, 23 Battlezoo): a hit by a Strike or a spell attack from a creature some distance away ("within 30 feet"), an attack that deals a type of damage to it, damage it "would take" or "is dealt" of a type ("The spark troll would take sonic damage"), damage "by a creature within their reach" ("The woodblessed is damaged by a creature within their reach"): reactions whose results already compiled are now offered (batch 16's hit and damage offers).
- 80 in all (52 new PF2e, plus 28 triggers read).
- Over seven bestiaries (5,673 fights, no errors): Wished Away, Withhold Death and Divine Deflection on critical hits; Nimble Dodge 37 → 40; with a second copy of each monster, Archon's Protection 6, Retributive Strike 2.
- **Checked live in pftest** (PFTEST SIM goblins of the party's alliance against an Iroran Skeleton, Wish Dragon, Drow Rogue, and a Rekhep with a goblin ally; deleted afterwards):
  - a critical hit on the skeleton offered Collapse, whose Use made it Immobilized and Off-Guard;
  - one on the dragon offered Wished Away with resistance 20;
  - a hit by 1 on the drow offered Nimble Dodge ("+2 AC against it turns a hit into a miss"); hits by 4 or 5 offered nothing;
  - 6 damage on the Rekhep's ally offered Archon's Protection (resistance 15, then a Strike), and "Resist only" put the goblin back to 6 HP.
  - (PF2e sets an NPC token's disposition from its actor's alliance: a test attacker needs the "party" alliance.)

## Temporary Hit Points, Wrap in Coils, more multi-Strikes (2026-10-10, batch 30)

- **Temporary Hit Points** (12, 3 Battlezoo): "The forest dragon gains 40 temporary Hit Points that last for 1 minute", "The swarm gains 10 temporary Hit Points that last for 1 round", with the triggers the module reads ("The forest dragon is targeted with a water spell or effect", now a targeted-by trigger; "is critically hit by a Strike").
  - The core's new `temp-hp` effect: a fixed amount or a formula rolled.
  - **Live play:** the card's Apply gives the higher of the creature's current temporary Hit Points and these (they don't stack), and says how long they last.
  - **The simulator** (B61): the same; the planner counts them as healing that may go unused.
- **Wrap in Coils** (9): "The python moves the creature into its coils, freeing its jaws to make attacks, then uses Constrict against the creature": the creature's own Constrict (or Greater Constrict) on the creature it holds, as this action; the coils' room is the GM's note.
- **More multi-Strikes** (53), for the simulator (batch 7's multi-Strikes):
  - Flurry of Blows' "If both hit the same creature, combine their damage …" with "As it has the flourish trait, … only once per turn", and its substitutions as words;
  - Flying Strafe's "Flies up to its fly Speed and makes two talon Strikes at any point during that movement. Each Strike must target a different creature";
  - Hungry Flurry's and Double Shot's "at a -2 penalty" or "each strike takes a –2 penalty";
  - Rapid Strikes' "attempts three claw Strikes, each against a different target within reach";
  - Frenzied Slashes' "The pusk gains the Clumsy 2 condition until the beginning of its next turn";
  - Maul's "against a creature it has Grabbed";
  - Claw Frenzy's "; no more than two can be against the same target";
  - Draconic Frenzy with no final period.
- **Fixed in the simulator** (B62): a monster's multi-Strike whose penalty "doesn't increase until after all the attacks" gave each Strike after the first −2 (Double Slice's rule); now only Double Slice does.
- Over seven bestiaries (5,673 fights, no errors): Flurry of Blows 11 → 27, Claw Frenzy 8, Pulverizing Barrage 5, Rapid Strikes 3, Wrap in Coils 6 → 8.
- **Checked live in pftest** (a party-side PFTEST SIM goblin, a Vibrant Pup Swarm, a Python and a goblin it held; deleted afterwards):
  - a critical hit on the swarm offered Feel No Pain, whose card's Apply gave it 10 temporary Hit Points ("for 1 round");
  - Wrap in Coils posted the python's Constrict, a DC 17 basic Fortitude card on the grabbed goblin: a success, 1 bludgeoning.

## Blood Drain and the Drink Blood family (2026-10-10, batch 31)

- **Blood Drain** (9): "Requirements The manananggal has a creature Grabbed. Effect The manananggal drives their tongue into the grabbed creature to drink its blood. This deals 4d6 damage, and the manananggal gains temporary Hit Points equal to the damage dealt. A creature whose blood is drained by a manananggal is Drained 1 until it receives healing (of any kind or amount)."
  - Damage with no roll on the creature it holds, Drained (until healed, a reminder), temporary Hit Points equal to the damage, or its healing ("regains 8 Hit Points, gaining any excess as temporary Hit Points").
  - Temporary Hit Points for some creatures only ("If the creature is a demon, fey, or sorcerer, …") are the GM's reminder.
  - The core's `temp-hp` and new `heal` effects take `fromDamage`: the row's damage on that target.
- **The Drink Blood family** (14): Drain Qi's "drains the victim's life energy", Drain Thoughts' "consumes its memories", Slurp Blood's "slurping its blood", Drain Blood: an Athletics check against the victim's Fortitude DC, the victim's condition (Drained, or Stupefied with more on a critical success) or damage.
  - Its healing goes on the card, any excess as temporary Hit Points, unless it depends on the victim ("Drinking Blood from a creature that's already drained doesn't restore any Hit Points"): then it stays the GM's reminder, as before.
  - One with more than one condition on the victim isn't read this way.
- **Live play:** the card's Apply heals the monster (any excess as temporary Hit Points, the higher of those and its current ones) and gives it temporary Hit Points equal to the damage.
- **The simulator** (B63): the same, against the creature it holds.
- 23, all PF2e.
- **Checked live in pftest** (a PFTEST SIM Manananggal and Puddles Ghoul, each holding a party-side goblin; deleted afterwards):
  - Blood Drain dealt 14 untyped damage, left the goblin Drained 1, and gave the manananggal 14 temporary Hit Points;
  - Slurp Blood's Athletics 20 against DC 15 dealt 4 piercing, and the ghoul, 1 HP below its maximum, regained 1 HP and gained 2 temporary Hit Points.

## Rages and frenzies, for the simulator (2026-10-10, batch 32)

- **Read now** (23, all PF2e): an action that puts the monster into a rage or frenzy, read as an effect on itself: "Akiros flies into a rage. He gains 6 temporary Hit Points, deals 2 additional damage with melee Strikes, takes a -1 penalty to AC, and can't use other actions with the concentrate trait. This effect lasts for 1 minute", Fanatical Frenzy's "+1 status bonus to attack rolls and a +2 status bonus to damage rolls, but takes a –2 penalty to AC", "a number of temporary Hit Points equal to its level plus its Constitution modifier" (from the creature), "deals an additional 1d4 electricity damage with her weapon Strikes".
  - A requirement it can check: "isn't Fatigued or raging"; "has taken damage" (Fanatical Frenzy) means once it's hurt.
  - Not one with another requirement ("A creature within its scent range is taking bleed damage"), a trigger, confusion, a weakness, or allies.
- **Live play:** unchanged: most link PF2e's own Rage effect, which PF2e's card applies.
- **The simulator** (B64): a self-effect with those modifiers, temporary Hit Points and extra dice on its melee Strikes, for 1 minute; no concentrate actions while it lasts.

## Triggered rages and frenzies, for the simulator (2026-10-10, batch 33)

- **Read now** (13, all PF2e): batch 32's rages with the triggers the simulator plays:
  - "The sea devil deals bleed damage to a living creature" (Blood Frenzy, a free action);
  - "The Tiger Lord suffers damage that reduces its Hit Points to 100 or less" (Vengeful Rage, a reaction);
  - "Hymmir damages a living creature with his jaws Strike" (Hungry Rage, a reaction).
  - Not one that also attacks its allies ("continue to attack bystanders and allies afterward"), or that confuses it.
- **Live play:** unchanged (PF2e's linked Rage effect, the GM's when the trigger comes).
- **The simulator** (B65): when the trigger comes, once a fight, the reaction spent when it's one. Blood Frenzy needs bleed the simulation sees: a Strike's own bleed damage (the sea devils' and bunyip's come from a passive or the text, so it's rarely set off).

## Riders by the Strike's degree, and Passionate Kiss (2026-10-10, batch 34)

- **A rider with a critical hit's alternative** (3, 1 Battlezoo): "A creature hit by a xulgath leader's jaws or claw Strike is Enfeebled 1 (or Enfeebled 2 on a critical hit) for 1 round", "that creature becomes Dazzled (or Blinded on a critical hit)", a longer time on a critical hit ("for 2 rounds, or for 4 rounds on a critical hit", a made-up example). The hit's words and the critical hit's are each read: the check is the Strike itself, the hit's results on a success, the critical hit's on a critical success.
  - **Live play:** the rider's card records the Strike's own roll and degree (as batch 10's Strike activities), so Apply gives the right row.
  - **The simulator** (B66): the Strike's degree is passed to the rider; the planner counts it as mostly a hit, sometimes a critical hit.
  - Not one on only some creatures: "a creature that qualifies as their favored game", "an attack that deals persistent fire damage" are refused now (they'd have applied on every hit).
- **Passionate Kiss** (5): batch 31's Blood Drain for "engages a creature they have Grabbed or Restrained … to drain its vital essence": 3d6 void damage, Drained 1, and the succubus regains Hit Points equal to the damage dealt. "… or increases its drained value by 1" and the Will save against a Suggestion are the GM's reminders.
- 8 in all.
- **Checked live in pftest** (a PFTEST SIM Xulgath Leader and Succubus against party-side goblins; deleted afterwards):
  - the leader's critical hit with its claw brought a Weakening Strike card recording "Strike 88 vs AC 16: critical success", whose Apply made the goblin Enfeebled 2; a plain hit's card (23 vs 16: success) made it Enfeebled 1;
  - Passionate Kiss dealt 7 void damage, left the goblin Drained 1, and the succubus regained 7 Hit Points.

## A skill action after a Strike activity's hit, and an automatic Shove (2026-10-10, batch 35)

- **Read now** (11, 1 Battlezoo), batch 27's hit sentences:
  - a skill action after the hit: "If the Strike hits, it attempts to Demoralize the target" (Terrifying Charge), "it deals damage as normal and the grave spinosaurus makes an Athletics check to Trip the target", "they attempt an Athletics check to Trip the creature they hit", "the vigilante can then Shove the target"; the sentences about its multiple attack penalty are words;
  - "the guard can automatically Shove the target, with the same benefits as the Shove action (including the critical success effect if the Strike was a critical hit)": pushed 5 feet, 10 on a critical hit; following the target and an object it's pushed into are the GM's;
  - "until the start of the guard's next turn" read as its own turn; a miss's retreat and Hide ("If the Strike misses, the vigilante can Step up to three times") are the GM's.
- **Live play:** after the Strike hits, the skill action's card (PF2e's basic action: the monster's Intimidation against the target's Will DC, or Athletics against Reflex) on the creature hit.
- **The simulator** (B67): the monster's own basic action after the hit (when its skills give it one).
- **Checked live in pftest** (a PFTEST SIM Skeletal Giant and Promise Guard against party-side goblins; deleted afterwards):
  - Terrifying Charge's critical hit brought a Demoralize card: Intimidation 20 against Will DC 13, a success, the goblin Frightened 1 (its 10-minute immunity named after Terrifying Charge, the card's ability);
  - Shield Shove's critical hit: Apply made the goblin Off-Guard and pushed it 10 feet (the scene's edge stopped it after a square).

## Follow-ups to a Strike (2026-10-10, batch 36)

- **Read now** (53, 5 Battlezoo; and 9 follow-ups whose requirement wasn't read before, such as Grisly Gash, Twist Blade, Inflict Misery):
  - more wordings of the requirement: "previous action (this turn) was", "a success with a jaws Strike", "a melee Strike that critically succeeded", "a fang Strike that hit the target", "a hoof Strike that dealt damage to its target", "damaged a creature with a jaws Strike in its previous action", "a hit against an adjacent creature with its tendril Strike", "a successful Strike with its proboscis", "a success with a Strike that has Disarm in its damage entry" (a Strike listing it); what the creature hit is ("against a creature with teeth") is the GM's. Not with more it needs (", and the target is adjacent to a wall", a size, "or a Draconic Frenzy that included …");
  - results with no roll of their own, on the creature hit: damage ("automatically deals an additional 2d8 bludgeoning damage to the creature it just bit", "…, inflicting 1d6 bleed to the target"), conditions ("making the creature Enfeebled 2 (or Enfeebled 3 on a critical hit)": by the Strike's degree), a push or a pull ("pushes his foe back 5 feet, with the effects of a successful Shove", "pulls the creature 5 feet closer and Grabs it"), a Disarm's critical success, the monster's own healing ("the flea regains 5 HP"); later sentences ("This is cumulative with other enfeebled conditions …", Drained "until it receives healing") are the GM's reminders;
  - a skill action: "attempts to Disarm the creature they hit. They gain a +4 status bonus to the Athletics check. This attempt neither applies nor counts toward the … multiple attack penalty": PF2e's Disarm with the bonus on its roll, without the attack trait;
  - a second Strike, as a Strike activity after such a Strike: "makes a second jaws Strike … On a success, the target takes an additional 1d4 slashing damage and 1 persistent bleed damage", "makes another greatclub Strike against the same target, using the previous Strike's multiple attack penalty" (after a miss), "Strikes the same target, who is Off-Guard against this attack", "Strides up to 10 feet and Strikes";
  - "must succeed on a … save" read as "at a"; a first sentence that only tells what it does left out.
  - Not one used in one of several ways ("choosing one of the three following options").
- **Live play:** the module remembers each monster's last Strike. A follow-up's card goes on the creature that Strike hit, "after Jaws"; results by the Strike's degree record that Strike's roll. With no fitting Strike just before, the card goes on the GM's targets with a hit's results and a line to check the requirement. A check's own bonus is on the card ("Athletics (+4 status) against each target's Reflex DC") and added to PF2e's roll. A second Strike is a Strike activity: its results come with the Strike's card.
- **The simulator** (B68): a follow-up only straight after a Strike that allows it (its degree, name, range, listed rider), at the creature struck; results by the Strike's degree use that degree. A follow-up's Strike likewise; "using the previous Strike's multiple attack penalty" at that penalty, adding none. A check's own bonus counts.
- **Checked live in pftest** (PFTEST SIM B36 Greater Shadow, Gimmerling, Severed Head, Snapping Turtle and Giant Flea against the Ezren fixture; deleted afterwards, Ezren restored):
  - the shadow's critical hit, then Steal Shadow: a card on Ezren "after Shadow Hand" recording "Strike 33 vs AC 20: critical success"; Apply made Ezren Enfeebled 3, with the three reminders;
  - Sly Disarm after a claw hit: "Athletics (+4 status)", and PF2e's roll listed "Sly Disarm +4 status";
  - Clench Jaws after a jaws hit: 1 bludgeoning damage, no roll;
  - Suck Blood after a miss: the warning "No hit with its proboscis just before was found", and Apply left Ezren Drained 1 while the flea's token regained 5 Hit Points;
  - Gnash, then a jaws hit: its card on Ezren, 1d4 slashing and 1 persistent bleed.

## More damage on its own Strikes, plain Strikes, more charges (2026-10-10, batch 37)

- **More damage on its own Strikes for a while** (12, 1 Battlezoo): "Until the start of her next turn, her fangs Strikes deal an additional 2d8 sonic damage" (Vocal Warm-Up), "… its claws Strikes deal an additional 1d10 persistent bleed damage" (Raking Claws), "For the next minute, its melee Strikes deal an additional 1d6 fire damage" (Blistering Touch), "While in this stance, all the hero hunter's Strikes deal an additional 2d8 precision damage" (Hunter's Precision), "the dragon's melee Strikes deal an additional 1d6 fire damage and 1d6 spirit damage" for 1 minute (Luminous Form), "… 2 points of acid damage" until the end of its turn (Caustic Drool). A first sentence that only tells what it does is left out; the rest are notes ("can't use Vocal Warm-up if she has an object in her cheek pouches", a longer range increment). Not with a trigger or a requirement, nor only against some creatures ("to that creature").
  - **Live play:** using it puts a PF2e effect on the monster: a DamageDice rule for dice ("2d8 sonic", persistent bleed, precision), a FlatModifier for flat damage, on the Strike it names ("claw-damage"), its melee Strikes or all of them, for its time (until the start of its next turn, 1 minute, a stance's for good); a new use replaces the old effect. Not when the ability links PF2e's own effect (Caustic Drool), whose card offers it. With no Strike by that name, a GM note.
  - **The simulator** (B69): the extra damage on the Strike it names, its melee Strikes, or all of them; for its time.
- **Only a Strike** (78, 2 Battlezoo): drawing a weapon or a bomb first (Quick Draw, Quick Bomber, Quick Grenadier, Quick Rummage, Shootist's Draw), reloading first, a boomerang that returns, "increases his reach by 5 feet for this Strike" (Lunge). Nothing more than the Strike from the sheet.
- **More charges and Strike activities** (18, 2 Battlezoo): "During the Stride, the grizzly bear gains a +10-foot circumstance bonus to its Speed" (Rush), "Strides or Steps, then Strikes with his hand crossbow", "Burrows and then Strikes", "Strides twice and Strikes with its bayonet", "If it ends its movement within melee range of an enemy" / "with an enemy within its reach", "This Strike gains the fatal d12 trait" (Pointed Charge), "The Strike deals half damage" after "Swims, making one tail Strike at any point along the way" (Strafing Chomp), "makes a fist strike gaining a +4 status bonus to the damage roll" (Kinetic Strike), "This Strike deals an additional 1d6 persistent bleed damage" (Goring Charge); a follow-up after "last attack was a successful melee Strike with her rapier": "makes a main-gauche Strike against the same creature that she just hit" (Deepen the Wound).
- **Precision damage** from a Strike activity ("deals an additional 4d6 precision damage") now takes the Strike's own damage type, in live play and the simulator (it was untyped).
- **Checked live in pftest** (PFTEST SIM B37 Hooklimb Xulgath, Aurocan, Hero Hunter, Abyssal Warhound Pack Leader and Fayati Alummur against the Ezren fixture; deleted afterwards, Ezren restored):
  - Raking Claws: an effect "until the start of its next turn"; the claw's damage became "(2d8 + 13) slashing + 1d10 bleed" (persistent in the roll), the jaws' unchanged;
  - Blistering Touch: 1 minute; hoof and horn both +1d6 fire;
  - Hunter's Precision: a stance effect; greataxe, fist and hand crossbow all +2d8 precision;
  - Caustic Drool: no effect of the module's (PF2e links its own);
  - Deepen the Wound, then a critical hit with the main-gauche: its card dealt 2 × 4d6 piercing precision damage.

## Reaction Strikes, Fast Swallow, safe moves (2026-10-10, batch 38)

- **Reaction Strikes** (43, 5 Battlezoo):
  - "A creature within reach of the dragon's tail takes an action to Strike or attempt a skill check" (Tail Lash): its tail Strike, at its penalty; "If it hits, the creature takes a –2 circumstance penalty to the triggering roll";
  - "A creature within reach of the warg's jaws attacks one of the warg's allies" (Avenging Bite);
  - "A creature within the sovereign dragon's reach critically hits the dragon" (Violent Retort): its claw Strike back.
  - **Live play:** offered as the monster's reaction when PF2e's attack roll comes in: a Strike (or a skill check with the attack trait) by a creature in its reach, an attack on another creature on its side, a critical hit on it; the Strike buttons for the Strikes in reach. Tail Lash's card says to lower the triggering roll by 2 if its Strike hits (PF2e has rolled it already).
  - **The simulator** (B70): before the roll of a Strike by an engaged foe (Tail Lash; its hit takes 2 off that roll) or on one of its allies (Avenging Bite); after a critical hit on it (Violent Retort).
- **Fast Swallow** (26, 4 Battlezoo): "The worm Grabs a creature (in its jaws). Effect The worm uses Swallow Whole." Live play: when a Grab card leaves a creature grabbed or restrained by the monster, its Swallow Whole card follows on that creature ("Fast Swallow (its reaction)"). The simulator: Swallow Whole as its reaction once the action that grabbed ends.
- **A move that doesn't trigger reactions** (68): "jumps up to half its Speed. This movement doesn't trigger reactions" (Swift Leap), "moves up to 60 feet in a straight line through the water without triggering reactions" (Jet). The simulator: out of a Melee without provoking where a Step can't go (a foe with reach). Live play: the GM moves the token (nothing to apply).
- **Charges** (57, 8 Battlezoo): "makes a single greataxe Strike and compares the attack roll result to the ACs of up to two foes within its reach" (Wide Swing); "Strides twice. If the guard captain ends their movement within a melee reach of at least one enemy" (Sudden Charge); "swims up to 10 feet in a straight line and makes a jaws Strike with a reach of 10 feet" (Lunging Bite); Aquatic Ambush (the glossary's): a move and a Strike at a creature off-guard to it, once a fight (it starts hidden in the water).
- **Nothing for a fight's numbers** (48): two Strides with a bonus to its Speed (Gallop), a Step when a goblin ally moves next to it (Goblin Scuttle), capsizing a vessel, a disguise that "doesn't change its Speed or its attack and damage bonuses with its Strikes", a jaws Strike with a longer reach (the dragons' Lunging Bite).
- **Checked live in pftest** (PFTEST SIM B38 River Drake, two Wargs and a Cave Worm around an Ezren token, in a combat; all deleted afterwards, Ezren restored):
  - Ezren's staff Strike at one warg brought two offers: the drake's Tail Lash ("made a Strike in its reach", with the note to lower the roll by 2) and the other warg's Avenging Bite ("attacked its ally");
  - the worm's jaws hit, its Improved Grab card applied (a success: grabbed; a critical success restrains, which also counts), and the Swallow Whole card followed on Ezren, "Fast Swallow (its reaction)".

## Focus Gaze, Hunt Prey, a bonus to its own AC (2026-10-11, batch 39)

- **Focus Gaze** (28): "The medusa fixes their glare at a creature they can see within 30 feet. The target must immediately attempt a … save against the medusa's petrifying gaze. If the creature was already Slowed …, a failed save causes it to be Petrified permanently. After attempting its save, the creature is then temporarily immune …": the gaze it names (the creature's own ability, compiled) as a save for that one creature, its range; the rest are reminders for the GM. Not when the gaze is another creature's (a wild hunt archer's names the hound's) or doesn't read as a save. Live play: its save card on the GM's target. The simulator: a save at one creature.
- **Hunt Prey** in a monster's own words (38): "The first time the hunter hits the designated prey in a round, they deal an additional 1d8 precision damage" (or 2d8, 1d6): a ranger's precision edge (31); with only the bonuses to Seek and Track and the range increment, nothing for the fight's numbers (7). Live play: a GM note naming its prey (the GM's target) and the extra damage to add to its first hit each round (PF2e can't count "the first hit each round" for an effect). The simulator (B71): the edge with its own dice.
- **A bonus to its own AC for a while** (15): "He gains a +2 circumstance bonus to AC until the start of his next turn" (Dueling Parry, Twin Parry), "They gain a +1 circumstance bonus to AC until the start of their next turn" (Hydraulic Deflection), "Until the start of its next turn, it gains a +2 circumstance bonus to AC, and when an adjacent creature … takes 2d6 persistent fire damage" (Armor of Flames: the rest for the GM). Not when it links PF2e's own effect or PF2e finds one by its name (Hobgoblin Phalanx's), nor with a Strike or a move in it, nor with a requirement other than what it holds.
  - **Live play:** batch 37's effect on the monster, with a FlatModifier to its AC, for its time. When the ability has PF2e's own switch (a toggleable roll option its own modifier waits on, as Hydraulic Deflection's and Armor of Flames'), the effect turns that on instead.
  - **The simulator** (B71): the bonus on its AC until its next turn.
- **Checked live in pftest** (PFTEST SIM B39 Medusa, Werebear and Azarketi Explorer with an Ezren token; deleted afterwards):
  - Focus Gaze: a "DC 25 Fortitude save" card on Ezren, Slowed on a failure, the petrification and immunity sentences as reminders;
  - Hunt Prey: a note to the GM, "Ezren is its prey. The first time it hits its prey each round, it deals 1d8 more precision damage";
  - Hydraulic Deflection: the item's own +1 waited on its switch (a modifier of the same name, which hid the effect's own at first); the effect now turns the switch on: AC 18 → 19.

## Mist Escape, a weapon that appears, unlabeled reactions (2026-10-11, batch 40)

- **Nothing for a fight's numbers** (37): Mist Escape ("Trigger The vampire is reduced to 0 HP. Effect The vampire uses Turn to Mist. They can take move actions to move toward its coffin …": it leaves the fight, which the simulation already counts at 0 Hit Points; the GM plays the mist), Manifest Runelord's Polearm ("causes their runelord's polearm to appear in one of their hands": the simulation has its Strikes ready), Goblin Scuttle written as "If a goblin ally ends a move action adjacent to the goblin warrior, the warrior can use their reaction to Step", and as "An ally ends a move action adjacent to the pirate goblin".
- **Avenging Bite** (2): "When a creature within the reach of the warg's bite attacks one of its allies, the warg can spend its reaction to make a jaws Strike against that creature" and "within the reach of": batch 38's reaction Strike to an attack on an ally.
- Compiler only: the plays and cards are batch 38's; no live check needed.

## Mythic abilities, Quickened Casting, Speed Surge, Poison Weapon (2026-10-11, batch 41)

The user's choices of 2026-10-11 for the larger groups left.

- **Mythic abilities** (92): "Cost 1 Mythic Point Effect The creature ends one condition affecting it" (Remove a Condition), "… regains an expended spell slot or can use Quickened Casting again", "… gains one additional use of …" (Recharge), "Cost all the creature's Mythic Points Trigger The creature would die … Effect … remains standing and conscious, and recovers 50% of its maximum Hit Points" (Undying Myth, or the Hit Points it names).
  - **Live play:** notes for the GM, who keeps its Mythic Points: on use, "it spends 1 Mythic Point and ends one condition affecting it"; as it drops to 0 Hit Points, "if it has a Mythic Point left, it spends them all and stays standing and conscious with 270 Hit Points".
  - **The simulator** (B72): three Mythic Points a fight: an action to end its worst condition; an action to regain a spent spell, a recharging ability or Quickened Casting; Undying Myth at 0 Hit Points.
- **Quickened Casting** (37): "If the risen runelord's next action is to cast a cantrip or spell that's 4th-rank or lower, reduce the number of actions to cast it by 1 (minimum 1 action)" (the tradition it names is the GM's; not with a requirement the simulation can't check). Live play: a note for the GM. The simulator: a spell of that rank or lower one action fewer, once a fight.
- **A monster's Spellstrike** (12): the simulator's magus Spellstrike (C20), with the spells it has. Live play: PF2e's own.
- **Speed Surge** (28, 2 Battlezoo): "Frequency three times per day Effect The drake Strides or Flies twice", "moves up to twice its Speed. It can do this three times per day". The simulator: a foe two Strides away engaged for one action, three times a fight. Live play: the GM moves the token.
- **Hurried Retreat, Scamper** (30): "Strides up to its Speed plus 5 feet and gains a +2 circumstance bonus to AC against reactions triggered by this movement": batch 38's move that doesn't trigger reactions.
- **Poison Weapon** (12): "applies a poison to the weapon", "applies one of their black adder venom poisons to their wielded weapon", "draws a poison and applies it to a weapon": the injury poison it carries (its highest-level one with stages), its affliction compiled.
  - **Live play:** a note for the GM ("Shadow Essence on its weapon … Take a dose from its inventory"); its next weapon Strike that hits (not an unarmed attack) brings the poison's save card on the creature hit, "Only if the Strike dealt damage"; a critical miss wastes it.
  - **The simulator:** an Interact (it provokes) while it has doses, then the poison with the next weapon Strike that hits and deals damage; a critical miss wastes it.
- **The GM's** (98, 1 Battlezoo): Drain Bonded Item ("cast one prepared spell … already cast … without spending a spell slot"), Reach Spell, Counterspell, the harrowkin's Shuffle the Deck and Read the Cards: nothing to apply.
- **Checked live in pftest** (PFTEST SIM B41 Gray Gardener Assassin, Amnerion and Risen Runelord Aethusa II with an Ezren token; deleted afterwards):
  - Poison Weapon: the GM's note, then the kukri's critical hit brought a "Shadow Essence after Kukri, DC 29 Fortitude save" card on Ezren with "Only if the Strike dealt damage";
  - Remove a Condition and Quickened Casting: their notes to the GM; Amnerion at 0 Hit Points: Undying Myth's note, 270 Hit Points.

## Statues, web descents, Running Reload, Skirmish Strike and more wordings (2026-10-11, batch 42)

Compiler readings only; live play uses what each builtin already does (nothing to apply, or the Strikes from the sheet).

- **Nothing for a fight's numbers** (33, 1 Battlezoo): "Until the next time it acts, the gargoyle appears to be a statue. It has an automatic result of 32 on Deception checks and DCs to pass as a statue" (Statue, with a Perception check to see through it, or a sentence about its looks; not with fast healing while it stays still), Feign Death's "falls Prone, and lies completely still … appears to be an ordinary corpse", Descend on a Web, Running Reload ("Strides, Steps, or Sneaks, then Interacts to reload": the simulator reloads with its own Interact).
- **Only a Strike** (10): Skirmish Strike, "either Steps and then Strikes, or Strikes and then Steps" (once a turn, after a sentence that only tells what it does).
- **Hunt Prey** (13, 1 Battlezoo): "inflicts an additional 2d8 precision damage" on "his prey", the first hit "each round" before the hit, "deals 1d8 precision damage to her prey the first time she hits her prey each round"; "designates one or two targets", "a single creature he can see or hear, and gains a +2 circumstance bonus …", a new prey in place of the old, how long it lasts.
- **Several Strikes** (27): a first sentence that only tells what it does (Swipe, Twin Takedown, Temporal Flurry, Lashing Tongues, Swift Staff Strike, Rolling Assault and Pummeling Charge, whose moves the simulator leaves out), "within the guard captain's melee reach and adjacent to the other", "rolls damage only once and applies it to each creature he hit", "counts as two attacks toward …, though the penalty does not increase until after both attacks are resolved", the sweep trait's bonus (left out); Flurry of Blows' "applying her multiple attack penalty as normal", "each of which must be an unarmed Strike or temple bell Strike", "or one unarmed Strike and a dueling pistol Strike", "combine their damages"; Twin Takedown's "Requirements … is wielding two melee weapons, each in a different hand" and "two Strikes against his hunted prey, one with each of the required weapons" (its best melee Strike twice, at one creature); a trained bat's "making wing Strikes against up to three adjacent foes".
- **Sudden Charge** (6): "They Stride or Swim twice; if they end their movement within melee reach of at least one enemy, they can make a melee Strike against it", after "With a quick sprint, the lizardfolk warrior dashes up to their foe and swings".
- **Left for later** (they need the simulator): Twin Feint (the second attack against an off-guard target), Three-Headed Strike (a different Strike at each creature, counted as one attack), Focused Assault (extra dice on a hit, the Strike's damage on a failure), Feign Death as a reaction, Unnerving Prowess.

## Twin Feint, Three-Headed Strike, Storm of Jaws, Focused Assault (2026-10-11, batch 43)

Several Strikes with more to them, which the simulator now plays (B74).

- **Twin Feint** (8): "makes one Strike with each of their two melee weapons, both against the same target. The target is automatically Off-Guard against the second attack" (after a first sentence that only tells what it does; "one with their shortsword and one with their dagger"; "each of his short swords"). The simulator: the target off-guard against the second Strike. Live play: a note for the GM as it's used, "the target is off-guard against the second Strike (−2 AC for that roll)".
- **Three-Headed Strike** (7): "makes a Strike with its dragon jaws, lion jaws, and goat horns, each at a -2 penalty and targeting a different creature. These Strikes count as only one attack for the chimera's multiple attack penalty …" (or "with each of its heads", three of its best Strike; "count as two attacks"). The simulator: a different Strike at each creature, each at −2, counted as one attack (or two). The four-fanged maharaja's "count as only one attack" now counts as one too.
- **Storm of Jaws and its kin** (12, 1 Battlezoo): "makes a number of Strikes up to its number of heads, each against a different target", with the heads its Head Regrowth names ("A hydra ordinarily has five heads", "has ten heads"); not without them. Also larger numbers: "up to six claw Strikes", "up to 12 jaws Strikes", "five Strikes", and several named Strikes each at a different creature (Slithering Attack, Two-Headed Assault).
- **Focused Assault** (10): "The hydra Strikes with its fangs. On a successful attack, the hydra deals damage from its fangs Strike …, plus an additional 1d6 damage for every head it has beyond the first. On a failure (but not a critical failure), the hydra deals the damage from one fangs Strike … This Strike counts as a number of attacks equal to the number of heads …" → a Strike activity: that many more dice on a hit (4d6 for five heads; 3d8 for "all four of its leaves"; 5d8 for the marilith's "typically 5d8"; the Strike's own type unless it names one), the Strike's damage on a failure, counted as that many attacks.
  - **Live play:** the hit's card with the extra dice (doubled on a critical hit); on a failure, a note for the GM: "a failure still deals one Fangs Strike's damage to Ezren. Roll the Strike's damage from its attack card (not the extra dice)".
  - Live play compiles an ability with no actor given, so the heads come from the item's own creature.
- **Left out:** Sharkskin's Twin Feint (its own wording), the giant pirate skeleton's Focused Assault ("doesn't use this ability if there is more than one creature within its reach"), Storm of Blades (its move).
- **Checked live in pftest** (PFTEST SIM B43 Bugbear Tormentor and Hydra from Monster Core, at Ezren; deleted afterwards):
  - Twin Feint: the GM's note;
  - Focused Assault with a natural 3 (19 against AC 20): the failure's note; with a natural 10 (26): its card, 4d6 piercing (2×(4d6) on a critical hit).

