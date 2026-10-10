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
