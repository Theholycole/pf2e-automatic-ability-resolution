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

## Snagging Strike, Unnerving Prowess, Leaping Charge, Feign Death (2026-10-11, batch 44)

Compiler readings into what live play and the simulator already do.

- **Snagging Strike** (7): "Requirements The scout has one hand free, and its target is within reach of that hand Effect The scout makes a melee Strike while keeping one hand free. If this Strike hits, the target is Off-Guard until the start of the scout's next turn or until it leaves the scout's reach, whichever comes first." → a Strike activity needing a free hand (not while it holds a creature), off-guard until the start of its next turn (leaving its reach is the GM's). The same requirement written as a "Trigger" in an action reads as a requirement. Combat Grab's "has one hand free" and "while keeping one hand free" read the same way (5). Not read: one copy whose data makes it a reaction.
- **Unnerving Prowess** (5): "Trigger Dura critically succeeds at a Strike or Disarm with her Aldori dueling sword. Effect Dura attempts to Demoralize the target of her Strike or Disarm. This Demoralize attempt does not have the auditory trait, …" → PF2e's Demoralize, set off by its own critical hit with that weapon (a free action), without the auditory trait. Live play: the reaction offer after that critical hit, then Demoralize's card. The simulator: its answer to its own critical hit. Not read: a copy that writes "hisAldori".
- **Leaping Charge** (3): "Strides up to 10 feet, ignoring difficult terrain as it leaps over obstacles. It then makes a Strike with its talons, gaining a +1 circumstance bonus to its attack roll", "Leaps up to 20 feet. It then makes a mandibles Strike, …" → a charge: one move and the Strike at +1.
- **Feign Death as a reaction** (4): "Trigger The opossum is reduced below 15 HP Effect The opossum collapses. It is Off-Guard and can use actions that require only its mind, but any other action ends the ruse. …" → the GM's (no-effect), as the other ruses.

## Capsize, Drench, Impaling Charge, Knocking Sweep (2026-10-11, batch 45)

- **Nothing for a fight's numbers** (25, 2 Battlezoo): Capsize with its roll, "tries to capsize an adjacent aquatic vessel of its size or smaller. The turtle must succeed at a @Check[athletics|dc:35] check … or the pilot's Sailing Lore DC, whichever is higher" (and "attempts to capsize an aquatic vessel … that it's adjacent to"); Drench, "puts out all fires in a @Template[emanation|distance:5]. … attempts to counteract magical fires (… counteract modifier)" (or "all non-magical fires within 5 feet"). Not the manifestation that shakes a ship to Trip every foe on it.
- **Impaling Charge** (12): "Requirements The dragon doesn't have a creature impaled on their horn Effect The dragon attempts to gore a foe. They Stride, then attempt a horn Strike. On a hit, the target becomes impaled on the dragon's horn. The creature is Grabbed while on the horn (and can attempt to Escape as normal). …" → a Strike activity: a Stride, the horn Strike, Grabbed on a hit (until it Escapes); not while it already holds a creature. The opening now takes "They Stride, then attempt …" too (Slashing Snare and Celestial Might came along). Not read: the narwhal's (more damage after 20 feet, a grab with its own DC) and Cuetzmonquali's (its own Escape DC, Restrained on a critical hit).
- **Knocking Sweep** (12): "They attempt separate Athletics checks to Trip any number of creatures within their reach. Each attempt counts toward the ki adept's multiple attack penalty, but the multiple attack penalty doesn't increase until after they make all the attacks." (once a round, when it says so) → { builtin: "skill-sweep", action: "trip", sameMap }.
  - **The simulator** (B75): PF2e's Trip at each enemy in its Melee, each at the penalty it started with, counted as that many attacks afterwards; worth what each Trip would be.
  - **Live play:** Trip's card at the creatures the GM targets, a roll for each ("Separate checks, each at the multiple attack penalty it started with."); with none targeted, a note to target them.
- **Checked live in pftest** (PFTEST SIM B45 Jackal Guard from Strength of Thousands; deleted afterwards): with no target, the note; at Valeros and Seelah, Trip's card, rolled: Athletics 37 against DC 21 (critical success) and 25 against DC 18 (success); not applied.

## Consume Fear (2026-10-11, batch 46)

- **Consume Fear** (9): "Trigger A creature within 60 feet loses the Frightened condition Effect The dragon feasts upon the fear that leaves the triggering creature's body, gaining 6d8 temporary Hit Points that last for 1 minute." → a new reaction trigger, { event: "condition-lost", condition: "frightened", within: 60 }, with batch 30's temporary Hit Points on itself. (The trigger was hidden from its reader by the marks around a linked condition; they're taken out first now.)
  - **The simulator** (B76): as a creature's frightened ends at the end of its turn, each monster with the reaction and its reaction free (anyone in the fight from 60 feet) gains the temporary Hit Points.
  - **Live play:** as a condition item leaves a creature on the scene, a monster in the encounter within the distance gets its reaction offer ("Ezren is no longer frightened"), then the card.
- **Checked live in pftest** (PFTEST SIM B46 Despair Dragon (Young) from Monster Core 2 in an encounter with Ezren; deleted afterwards): Ezren Frightened 1, then not: the offer; Use it, then Apply: the dragon has 26 temporary Hit Points (4d8) for 1 minute.

## Power Attack, Lunge, Quick Bomber, Thrash, Recharge Spell, Phase Jump, Spurred by Death (2026-10-11, batch 47)

Compiler readings into what already exists; nothing new in live play or the simulator.

- **Power Attack** (2): "makes a melee Strike that counts as two attacks when calculating their multiple attack penalty. If this strike hits, it deals an extra die of weapon damage" (and "This counts as two attacks when calculating the multiple attack penalty", "an extra a die" as printed) → a Strike activity, counted as two attacks, an extra weapon die on a hit. Not the one written only as PF2e's glossary reference.
- **Only a Strike** (16): Lunge, "makes a Strike with a melee weapon, increasing the reach of the Strike by 5 feet", "… with their rotcarver scythe, increasing their reach by 5 feet for that Strike" (a following "can choose to Trip … instead", "If the weapon has the disarm, shove, or trip trait, … the corresponding action instead of a Strike": the GM's); Quick Bomber, "can use Interact to draw a bomb and then Strike with it" (no final period too); Quick Draw, "Interacts to take out their machete or shortbow, then Strikes with the weapon", "then Strikes with the weapon they just drew".
- **Thrash** (6): "Strikes once with its jaws and once with its tail, each targeting a different creature" (a different Strike at each, batch 43's), "attempts individual Strikes against each creature in its reach. It can attempt up to one jaws Strike and any number of leg Strikes", "Strikes once against each creature in its reach. It can make one of these Strikes with each of its maws, … Each attack takes a –2 circumstance penalty …" (its best Strike at each, at −2).
- **Recharge Spell** (6): "Cost 1 Mythic Point Effect Pteios regains one spell", "… gains an additional use of any of their innate spells", "… an additional casting of any of his innate primal spells that he has already cast" (also with no "Effect" label) → batch 41's Mythic Recharge.
- **Phase Jump** (8): "Frequency once per round Effect The dragon teleports up to 120 feet. If they are airborne, they maintain their momentum, …" → batch 38's move that triggers no reactions.
- **Spurred by Death** (5): "Trigger An ally within 30 feet reduces a creature to 0 HP Effect The burnbearer Steps or Strides." → nothing for the fight's numbers. Not the ones that also Strike, Drink Blood or Hunt Prey.

## Plane and form shifts (2026-10-11, batch 48)

The user's choice (2026-10-11): the GM's. Counted as covered, nothing to apply; the simulator doesn't use them.

- **Skip Between** (10): "moves from the Universe to the Ethereal Plane or vice-versa", "can move itself between the Ethereal Plane and the Material Plane, as Ethereal Jaunt".
- **Walk the Ethereal Line** (10, 1 Battlezoo): "walks the thin line between the Ethereal Plane and the Universe".
- **Swarm Shape** and its kin (10): "collapses into a shapeless swarm of worms. … It can use the same action to coalesce back into its normal form."
- **Shadow Form** (9): "reverts to pure shadow and absorbs its body and its gear into the darkness".
- **Reef Meld** (8): "physically merges with the reef and vanishes".
- **Bramble Jump** (8): "instantly teleports to a square of undergrowth within 60 feet" (where the undergrowth is, the GM knows).
- **Disperse as a reaction** (4): "Trigger The storm lord takes damage from a hostile action. Effect The storm lord disperses. Until the end of the current turn, it can't be attacked or targeted, …".
- **Disperse as a move** (1): "Strides or Flies. This movement doesn't trigger reactions. … It then coalesces back into its normal form." → batch 38's move that triggers no reactions.

## Shake It Off and Slough Skin (2026-10-11, batch 49)

The user's choice (2026-10-11): the simulator negates the first harmful condition; live play offers the reaction as a condition lands.

- **The text** (18): "Frequency once per day Trigger The purple worm would be affected by a condition or adverse effect (such as Cursed Metamorphosis) Effect The purple worm negates the triggering condition or effect. Effects from artifacts, deities, or a similarly powerful source can't be avoided in this way." (Shake It Off; the Monster Core cave worms' Slough Skin, "… by sloughing an outer layer of its skin") → { builtin: "negate-condition" }; Dogged Persistence's "would be affected by the Immobilized, Paralyzed, Slowed, or Stunned conditions, or by an effect that would give it a penalty to its Speeds, …" → those conditions only. (Its labels are found by their capital letter: "adverse effect (such as …)" isn't its Effect.)
- **The simulator** (B77): the first condition an enemy gives it that harms it (not off-guard, quickened, concealed, hidden or invisible), negated with its reaction, once a fight.
- **Live play:** as a condition item lands on the monster in an encounter (not off-guard or one that helps it), the offer "it would be Frightened 1 — Use it: negate Frightened 1"; using it deletes that condition and spends a use of the ability's frequency; with none left, no offer.
- **Checked live in pftest** (PFTEST SIM B49 Cave Worm from Monster Core in an encounter with Ezren; deleted afterwards): Frightened 1 on it: the offer; Use it: the condition gone, Slough Skin's uses today 1 → 0; Sickened 1 after that: no offer.

## Trap falls and summoning traps (2026-10-11, batch 50)

The user's choice (2026-10-11): a trap's damage, saves and conditions into its card where the text allows; summoning stays the GM's.

- **A fall with Grab an Edge** (14 new, 5 better): "Trigger A creature walks onto the trapdoor. Effect The triggering creature falls in and takes falling damage (typically @Damage[10[bludgeoning]] damage) as well as @Damage[2d6[piercing]] damage from falling on to the knives. That creature can use the Grab an Edge reaction to avoid falling." → its damage on the creature that set it off (the GM's target), with the reminder "{target} can use Grab an Edge (a Reflex save) to avoid falling and the damage". With its DC given ("(@Check[reflex|dc:22] save)", "[[/act grab-an-edge dc=16]]", "the DC to Climb the walls or Grab an Edge is 14"): a Reflex save, a success catching the edge (no damage), a failure the fall. "The trapdoor then slams shut, and the hazard rolls initiative" comes along as a reminder.
  - Only falls: not with a Strike, a condition, a Speed penalty, drowning, or a save of its own against spikes (the weakened floor keeps its earlier reading).
  - The simulator: a hazard's trigger abilities already fire at the creature that set it off (E4); these now carry their damage.
- **A trap that summons a creature** (11): "Effect The trap summons a Cockatrice. The cockatrice rolls initiative and remains for 2d6 rounds; …" → the GM's.

## Wicked Bite (2026-10-11, batch 51)

The user's choice (2026-10-11): a GM button for each way; the simulator picks the better one.

- **Wicked Bite** (12): "Requirements The urdefhan damaged a creature with a jaws Strike on their last action Effect … The target must succeed at a @Check[fortitude|dc:22] save or be affected by drain blood or drain vitality (the urdefhan's choice). If the jaws Strike was a critical hit, the creature is affected by both effects, using the same save result for both. • Drain Blood … On a failed save, the creature is Drained 1 and the urdefhan regains 5 HP (or, on a critical failure, it's Drained 2 and the urdefhan regains 10 HP). • Drain Vitality … Enfeebled 1 for 1 hour on a failed save (or Enfeebled 2 for 1 hour on a critical failure)." (also "chooses one of two options, each of which requires a … save", the ways without bold names) → { builtin: "modes" } with two ways, each a Fortitude save after that Strike: Drained (its regained Hit Points a reminder, "{source} regains 5 HP (10 on a critical failure)"), Enfeebled for 1 hour; the critical hit's both ways a reminder.
  - **Live play:** "Wicked Bite: which way?" with a button for each, then that way's card (checked live: an Urdefhan Tormentor's jaws hit on Ezren, Wicked Bite, Drain Vitality: a DC 22 Fortitude save card, Enfeebled 1 for 1 hour on a failure).
  - **The simulator** (B78): a Strike now readies every follow-up it allows (each way), and the planner weighs each; after a jaws hit it usually still prefers a second Strike.
- **Not yet:** Kharostan's (a trigger, Doomed too), Pike and Strike (moving the target or a second Strike: the simulator's ways are saves and checks).

## You're Next and Stoke the Flames (2026-10-11, batch 52)

- **You're Next** (9): "Trigger The prisoner reduces a creature to 0 hit points. Effect The prisoner attempts an Intimidation check with a +2 circumstance bonus to Demoralize a single creature it can see and that can see them." (also "attempts to Demoralize a single creature he can see. He gains a +2 circumstance bonus to this check", "a creature within 60 feet, with a +2 circumstance bonus", a first sentence that only tells it) → a new trigger, { event: "downs" }, with PF2e's Demoralize and its bonus (check.bonus, batch 41's).
  - **The simulator** (B79): as it downs a creature, its reaction: Demoralize at another foe, one in its Melee first.
  - **Live play:** as a creature drops to 0 Hit Points, the monster that last damaged it (the core's damage memory, the last ten seconds) gets its reaction offer, "downed Dummy A"; Use it posts Demoralize's card, "Intimidation (+2 circumstance) against each target's Will DC", for the GM's target.
- **Stoke the Flames** (9): "The dragon intensifies nearby fires. Every foe within 60 feet that is taking persistent fire damage takes @Damage[5d6[fire]] damage." → that damage on those foes (targeting.foes, targeting.taking: "fire").
  - **The simulator** (B79): the foes taking persistent fire damage.
  - **Live play:** the card finds them itself: the tokens within 60 feet of another disposition with a persistent fire damage condition.
- **Checked live in pftest** (PFTEST SIM B52 Prisoner from NPC Core, Cinder Dragon (Young) from Monster Core 2, three dummies on the party's side, in an encounter; deleted afterwards): the Prisoner's Shiv taking a dummy to 0: the offer, then the Demoralize card with its +2; Stoke the Flames with one dummy taking persistent fire: its card on that dummy only. (A dummy NPC's disposition follows its alliance: set to the party's.)

## Golden Luck, Word of Wisdom, Cat's Luck (2026-10-11, batch 53)

- **Golden Luck** (7, 2 Battlezoo): "Trigger The gold dragon fails a saving throw Effect The dragon improves its result by one degree of success, turning a failure into a success or a critical failure into a normal failure. The dragon can't use this ability again for 1d4 rounds." → { builtin: "save-boost", recharge: "1d4" }.
- **Word of Wisdom** (6): "Trigger An ally within 60 feet fails a saving throw Effect The ally improves its result by one degree …" → { builtin: "save-boost", ally: true, within: 60, recharge }.
- **Cat's Luck** (5): "Frequency once per day Trigger … fails or critically fails a Reflex saving throw Effect … rerolls the saving throw and takes the better result" (also "Reroll that saving throw and take the better result") → { builtin: "save-reroll", save: "reflex" }.
- **The simulator** (B80): as a save is rolled (any plan's), a failure is made better: Cat's Luck rerolls its own save of that kind once a fight, keeping the better; Golden Luck its own, Word of Wisdom an ally's within its distance, one degree better, each then not for its recharge; each with its reaction.
- **Live play:** a failed save in an encounter: the saver's Cat's Luck ("Reroll, keep the better": PF2e's reroll from the save's message keeping the higher, a use of the day spent) or Golden Luck, or an ally's Word of Wisdom within its distance ("Use it: one degree better": "The save becomes a success: apply that result instead. Not again for 1d4 rounds.").
- **Checked live in pftest** (PFTEST SIM B53 Catfolk Pouncer from Monster Core and Gold Dragon (Adult) from the Bestiary in an encounter; deleted afterwards): the Pouncer's Reflex save failing DC 60: the offer, the reroll keeping the higher, its use today 1 → 0; the dragon's Fortitude save critically failing DC 80: "The save becomes a failure: apply that result instead. Not again for 1d4 rounds."

## Wing Thrash, Telekinetic Defense, Wing Rebuff (2026-10-11, batch 54)

- **Wing Thrash** (7): "Trigger An adjacent enemy damages the giant bat Effect The bat makes one or two wing Strikes—one against the triggering creature and one against another adjacent creature." (or "each against a different adjacent creature") → a reaction Strike, { triggers: ["damaged-adjacent"], second: true }.
  - **The simulator** (B81): a melee Strike that damages it, answered with its wing Strike at the attacker, then one at another foe in its Melee.
  - **Live play:** as damage lands on it while an adjacent foe has the turn, the Strike offer at that foe, "It can make a second Strike at another adjacent creature."
- **Telekinetic Defense, Wing Rebuff** (11): "Trigger A creature approaches within 10 feet of the poltergeist Effect The poltergeist makes a telekinetic object Strike against the triggering creature.", "A creature moves from beyond the reach of the roc's wing to within the reach of the roc's wing" / "moves into the reach of the frost roc's wing" (… "If the roc Pushes the creature, it disrupts the triggering move action.") → { triggers: ["approach"], within? }.
  - **The simulator** (B81): a creature engaging it (a Stride into its Melee) is Struck by it.
  - **Live play:** a token whose move comes from outside its distance (or its Strike's reach) to inside: the Strike offer, ranged ones too ("came within 10 feet").
- **Not read:** Clawed Feet (only while it's flying).
- **Checked live in pftest** (PFTEST SIM B54 Giant Bat and Poltergeist from Monster Core, two dummies on the party's side, in an encounter; deleted afterwards): damage on the bat on an adjacent dummy's turn: Wing Thrash's offer with its second-Strike note; a dummy walking within 10 feet of the poltergeist: Telekinetic Defense's offer, its ranged Strike rolled from it.

## Breach, glides, Envenom Weapon, Reactive Tail, Biting Snakes (2026-10-11, batch 55)

- **Breach** (7): "The shark Swims up to its swim Speed, then Leaps vertically out of the water up to 25 feet high, making a Strike against a creature at any point during the jump (…). After the Strike, the shark splashes back down into the water." → a charge with two moves; "Leaps and makes a Strike at any point along its movement" → one. Not the megalodon's, whose data gives it one action.
- **Nothing for a fight's numbers** (37, 2 Battlezoo): glides ("glides gently through the air, moving 5 feet toward the ground and up to 25 feet forward", the mammoth land star's hover and two Strides), Reel In's pull of a creature it holds (a free action too), a troop's "uses Change Formation", Shadow Stride (a Stride in dim light), Corrupt Water ("permanently befouls 10 cubic feet of liquid"), Adamantine Claws (against objects).
- **Envenom Weapon** (7): "The seugathi applies their seugathi venom to one weapon they wield" → batch 41's Poison Weapon with the creature's own Seugathi Venom ability (its affliction), no doses to count; live play's note leaves out taking a dose.
- **Reactive Tail** (8): "Trigger A creature within reach of the dragon's tail uses a manipulate action or a move action, makes a ranged attack, or leaves a square … Effect The dragon attempts an Athletics check to Trip the triggering creature. This check doesn't count toward the dragon's multiple attack penalty, …" → PF2e's Trip (without its attack trait) at the provoking creature, on batch 22's provoke trigger (the simulator: 37 uses in the bestiary run; live play: the provoke offer's card).
- **Biting Snakes** (8): "Trigger A creature ends its turn adjacent to the medusa. Effect The medusa makes a snake fangs Strike against the creature." → a reaction Strike, { triggers: ["turn-end-adjacent"] }.
  - **The simulator** (B82): as a creature's turn ends in its Melee, its Strike at it.
  - **Live play:** as the turn passes, the Strike offer at the creature that ended its turn within 5 feet of it.
- **Checked live in pftest** (PFTEST SIM B55 Medusa from Monster Core and a dummy on the party's side; deleted afterwards): the medusa's own turn ending: nothing; the dummy's ending beside it: "ended its turn beside it", Snake Fangs.

## Feed on Fear, Scattershot (2026-10-11, batch 56)

- **Feed on Fear** (9): "Requirements An enemy is under a fear effect or Dying within 15 feet of the will-o'-wisp. Effect The will-o'-wisp feeds on the creature's terror. It regains 2d4 Hit Points, and if it has Gone Dark, its glow reignites." → batch 24's healing on itself, now in all its wordings ("An enemy within 15 feet is under …", "is being affected by …", "is affected by a fear effect or has the Frightened or Dying condition, and is within 25 feet"; "They regains", "if they've Gone Dark, their glow reignites", "its Glow reignites if it had been extinguished"). The requirement's "fear effect" no longer ends it early (the labels are capitalised). The glow is a note; "only once per round" too. The voidglutton's "It cannot use Consume Light again for 1d4 rounds" is Consume Light's wait, so a note, not Feed on Fear's recharge.
  - **The requirement** for the simulator: { requiresFoe: { conditions: ["frightened", "dying"], within } }.
  - **The simulator** (B83): only while an enemy within that distance is frightened, or down and dying.
  - **Live play:** PF2e's healing roll, its heading "Only if: …" for the GM, as before.
- **Scattershot** (8): "The dragon exhales a cloud of small balls of pure energy that deal 5d4+5 force damage in a 30-foot cone with no save. The dragon can't use Scattershot again for 1d4 rounds." → the damage on everyone in the area, no roll to resist; its recharge (the simulator: 43 uses in the bestiary run; live play: the card at the GM's targets, "no roll", then Apply).
- **Checked live in pftest** (PFTEST SIM B56 Barrage Dragon (Young) from the Lost Omens Bestiary, two goblin dummies on the party's side, and a Monster Core Will-o'-Wisp; deleted afterwards): Scattershot's card at the two targets, Apply: one 5d4+5 roll, 14 force to each, "recharges in 2 rounds"; Feed on Fear's roll: "Only if: An enemy within 15 feet is under a fear effect or Dying. If it has Gone Dark, its glow reignites."

## Reaction Strikes and Jeer at Failure (2026-10-11, batch 57)

- **A Strike back** (27): reaction Strikes with new triggers, { builtin: "reaction-strike", triggers: [...] }:
  - **"attacked"**, a creature that Strikes it in its reach: Cutting Rebuke ("A creature within reach of the dragon's chin blade that the dragon can see makes a Strike against the dragon"), Bite Back ("The taunting skull is attacked by a creature within their reach"), Opportune Witchflame ("makes a melee Strike against or touches the witchfire").
  - **"critical-miss"**, a creature in its reach that critically fails a Strike against it: Opportune Bite ("A creature within the great wolf's reach critically fails a Strike against it"), Gnawing Retort ("critically misses the wereant with a melee Strike"), Defensive Needle.
  - **"damaged-adjacent"**, one Strike (batch 54's, without the second): Squealed Outrage ("The war pig is damaged by an adjacent creature").
  - **"targeted"**, an attack or a spell aimed at it, answered at any range: Superconductor ("The dragon is targeted by an attack or spell … The dragon attempts a storm bolt Strike against the attacker, regardless of range").
  - Not when it may do something else instead (Dueling Riposte's "or attempts to Disarm"), nor the blackfrost zombie's Step first.
  - **The simulator** (B84): a Strike in its Melee at it, before the Strike; a critical miss in its Melee; a Strike or an attack check (Trip, Grapple) or a spell aimed at it, at any range, before the attack (after a spell's effect).
  - **Live play:** the Strike offer, as batch 38's: "made a Strike against it", "critically failed a Strike against it", "damaged it", and "aimed an attack (a spell) at it", "At any range", with the Strike it names whatever its reach.
- **Jeer at Failure** (8): "Trigger A foe within 90 feet becomes Prone or critically fails on a Strike Effect The mocking dragon laughs dismissively at the foe, attempting an Intimidation check to Demoralize the creature. …" → PF2e's Demoralize at that foe, { trigger: { event: "foe-mishap", within: 90 } }.
  - **The simulator** (B85): as a foe falls prone (a Trip, a condition) or critically fails a Strike, within its distance and Demoralize's 30 feet, once (its reaction).
  - **Live play:** the offer as a foe within its distance gets the Prone condition or rolls a critical failure on a Strike; Use it: the Demoralize card at that foe.
- **Checked live in pftest** (PFTEST SIM B57 Vorpal, Stormcrown and Mocking Dragons (Young) from the Lost Omens Bestiary, a Fey-Touched Great Wolf, a War Pig and goblin dummies on the party's side, in a combat; deleted afterwards): a dummy's critically missed Strike at the vorpal dragon: Cutting Rebuke ("made a Strike against it", Chin Blade) and Jeer at Failure ("critically failed a Strike"; Use it: the Intimidation card at that dummy); a shortbow Strike at the stormcrown dragon 45 feet away: Superconductor ("At any range", Storm Bolt); with the mocking dragon's reaction spent, nothing more; once free again, a dummy falling prone: Jeer at Failure ("fell prone"); a critical miss at the wolf: Opportune Bite; 5 damage on the pig on the dummy's turn: Squealed Outrage, Hoof.

## Breath of Loss, Distracting Whisper, Unbidden Thoughts (2026-10-11, batch 58)

- **Breath of Loss** (8): "… dealing 14d6 mental damage in a 40-foot cone (DC 34 Will save). A creature that critically fails its save is also consumed with the memory of the moment and is Stunned 1. The wish dragon can't use Breath of Loss again for 1d4 rounds." Its words don't say "basic", but a critical failure that is "also" worse is a basic save's, and PF2e's area damage with a save is basic: read as one (half on a success, double and Stunned 1 on a critical failure), its recharge. Only that wording: one damage, one save in brackets right after its area, no degrees of its own, and that sentence.
- **Distracting Whisper** (8): "Trigger The dragon is targeted with an attack Effect … inflicting a –2 circumstance penalty to the triggering attack." → batch 29's AC reaction, +2 against the attack (the same numbers): the simulator as an AC reaction when targeted; live play, the offer when +2 AC would change the result.
- **Unbidden Thoughts** (9): "Trigger The dragon is critically hit with a weapon or unarmed attack Effect The attacker's mind fills with visions of their worst fears …, and they must choose one of the following results: either the triggering attack becomes a normal success, or the critical hit is unaffected but the triggering creature becomes Frightened 2." → batch 29's critical hit made a normal hit, with the other way: { builtin: "crit-downgrade", dc: null, or: { slug: "frightened", value: 2 } }.
  - **The simulator** (B86): the attacker keeps the critical hit and is frightened 2, unless a normal hit's damage is expected to finish the target anyway.
  - **Live play** (the user's choice for choices: a button for each): "A normal hit", or "The critical hit, Frightened 2" (that condition on the attacker).
- **Checked live in pftest** (PFTEST SIM B58 Despair and Whisper Archdragons and a Wish Dragon (Young) from the Lost Omens Bestiary, goblin dummies on the party's side, in a combat; deleted afterwards): a dummy's critical hit on the despair dragon: the offer with both buttons; "The critical hit, Frightened 2": the dummy Frightened 2, the dragon's reaction used. A hit by 0 on the whisper dragon: "+2 AC against it turns a hit into a miss". Breath of Loss at a dummy: "DC 29 basic Will save"; a critical failure: 68 mental (double the 34 rolled), Stunned 1, "recharges in 3 rounds".

## Teleports, Scuttle, Hidden Blade (2026-10-11, batch 59)

- **Teleports of its own** (13): Jaunt's "The poracha teleports up to 40 feet to a location it can see. It can't use Jaunt again for 1d4 rounds.", Personal Portal's "Frequency once per round Effect The kerulkagon teleports to an unoccupied space it can see within 30 feet.", Shadow Flitter's "… to a square they can see within 30 feet that isn't in an area of bright light", Monitor Escape (a first sentence that only tells it), Astral Blink, Transdimensional Step, the amalgamite's Reposition → batch 47's move that triggers no reactions, { builtin: "safe-move", actions, recharge? }. Not one with a requirement (Shadow Jump's "Light Aura is suppressed"), nor one that does more.
  - **The simulator** (B87): out of a Melee a Step can't leave, as before; then not again until its recharge.
  - **Live play:** the GM moves it; a recharge starts from its words as it's used, as before.
- **Scuttle** (1): "The profane ghoul crawls on all fours, moving up to half its Speed. This movement doesn't trigger reactions." → the same move ("moving" read as a move).
- **A weapon drawn as part of it** (3): Hidden Blade's "Frequency once per round Effect The spy draws a weapon and then Strikes with it. The target of the Strike is Off-Guard against the attack." → a Strike activity, off-guard, once a turn; Improvised Surprise's "uses an Interact action to pick up an improvised weapon within reach and then Strikes with it. The drunken brawler has a +2 circumstance bonus to this attack." → its +2 (a bonus with a condition, "If it moved at least 20 feet…", isn't read here). Live play: PF2e's Strike, its bonus or off-guard the GM's, as for other activities.

## Strikes with different limbs, charges, Savage Jaws, Bully's Bludgeon, Steps (2026-10-11, batch 60)

- **A Strike at each of several creatures** (12): Writhing Arms' "The giant octopus makes up to four Strikes with different arms, each against a different target. Each attack counts separately for the octopus's multiple attack penalty, but the penalty doesn't increase the until the octopus has made all the attacks.", the kraken's Double Attack ("two Strikes with two different arms or tentacles, each limb targeting a different creature"), the zelekhut's, Ravenous Jaws, Tentacle Flurry → batch 31's multi-Strike, each at a different creature, at one penalty. Their last sentence, "If the octopus subsequently uses the Grab action, it can Grab any number of creatures it hit" (or Knockdown, "it affects all creatures it hit"), is the GM's.
- **Charges** (9): Ram Charge's and Skull Charge's "Strides twice in a straight line and then makes a horn Strike with a +1 circumstance bonus to its attack roll"; Propulsive Launch's "Leaps up to 40 feet, then makes a sucker Strike. If it's in the air and not attached to a creature after the Strike, it falls." (the fall the GM's).
- **Savage Jaws** (5): "The dracolisk makes a single Strike with its jaws. If the attack hits, it deals (4d12+16) piercing damage (versatile S). This counts as two attacks for its multiple attack penalty." → a Strike activity with that damage in place of the Strike's, counted as two attacks.
- **Bully's Bludgeon** (3): "makes a morningstar Strike with a +2 circumstance bonus to its attack roll. This attack is nonlethal." → its +2, nonlethal. The simulator (B88): a PC it knocks out is unconscious, not dying (PF2e's rule for nonlethal damage; until now only PCs dealt it).
- **Steps** (3): Elf Step's and Coordinated Step's "Steps twice" → a move without reactions (batch 47's).
- **Undulate** (5): "Strides or Steps (Swims). During this movement, it can pass through spaces as narrow as 5 feet without Squeezing." → nothing for a fight.
- **Live play:** nothing new — PF2e's Strikes, with what the activities add on the GM's side as before.

## Furious Flailing, Splinter, Death Slam (2026-10-11, batch 61)

- **A Strike as it takes damage of some types** (9): the forest troll's Furious Flailing, "Trigger The forest troll takes electricity or fire damage Effect The troll makes a claw Strike against a random creature within its reach. If the troll has persistent fire damage, they attempt a DC 15 flat check to remove it." (the trollhound's Flailing Bite, the ice troll's Furious Carve with "a hatchet or claw Strike", the sludge troll's Furious Spit "within their first range increment"); the wood golem's Splinter, "takes physical damage … The golem makes a splinter Strike against an adjacent creature without triggering reactions." (Rotten Burst) → { builtin: "reaction-strike", triggers: ["damaged-by"], damageTypes, random?, persistentFire? }.
  - **The simulator** (B89): damage of those types on it (any source, persistent too), a Strike at a random creature in its Melee, or the attacker when it's there; then the trolls' extra flat check against persistent fire.
  - **Live play:** the Strike offer as it's damaged ("damaged it (4)" with the attacker beside it, or "It took 6 damage" for a random creature, the GM's target), with notes: "Only if it was electricity or fire damage.", "At a random creature within its reach: target it first.", and the flat check.
- **Death Slam** (1): "Trigger The argorth is reduced to 0 Hit Points Effect Before it's knocked out, the argorth makes a tail Strike against a random creature within reach." → batch 25's Strike as it dies.
- **Checked live in pftest** (PFTEST SIM B61 Forest Troll from Monster Core, Wood Golem from Bestiary 2, goblin dummies on the party's side, in a combat; deleted afterwards): on a dummy's turn, 4 damage on the golem beside it: Splinter, "damaged it (4)", "Only if it was physical damage."; 6 damage on the troll: Furious Flailing with its notes; Claw at the dummy the GM targeted: a hit.

## Form shifts (2026-10-11, batch 62)

- **The user's choice** (2026-10-11, with the plane shifts of batch 48): a form shift is the GM's, counted as covered; the simulator doesn't use it.
- **Which** (42, 8 of them Battlezoo's): a polymorph action that changes only its own shape — Change Shape's "can take on the appearance of any Small or Medium humanoid. This increases their Speed to 25 feet. It doesn't change their attack and damage modifiers …", Mimic Object's "assumes the shape of any Medium object", Impersonate Shape's "changes into a faceless version of a … humanoid", Sand Form's "becomes an animated pile of sand", Spider Legs, Pruning, Ooze Form and their kin → { builtin: "no-effect" }.
- **Not** one with a save, damage, healing or temporary Hit Points, an attack, another creature as its subject (Change Size, Fortune's Favor), or a linked spell's effects (Rushed Transformation's humanoid form stays batch 37's spell, cast through PF2e).

## Battlezoo dragons' parries, wreaths, assaults and counters (2026-10-11, batch 63)

Four abilities of the Battlezoo dragon families (8 each, 32 in all; their own words stay out of this repository):

- **A raised guard** (batch 39's AC self-effect): +2 circumstance to AC until the start of its next turn, with a sentence that only bars one of its own Strikes while it flies, now a note. Live play: PF2e's own toggle where the item has one (checked: AC 30 → 32).
- **Strikes wreathed in energy** (batch 37's Strike-damage self-buff): three or more of its Strikes, named in a list, gain a property rune's effects and extra damage until its next turn → its melee Strikes, the rune a note. Live play: a DamageDice rule on "melee-strike-damage" (checked: 2d6 force).
- **An assault on the move** (batch 25's charge): a move of up to half its Speed that triggers no reactions, with a Strike at an off-guard foe in reach at any point of it → { strides: 1, offGuard: true, safe: true }. The simulator (B90): a charge with safe set leaves a Melee without provoking.
- **A counter to a failed attack** (batch 57's reaction Strikes): a creature in its reach failing or critically failing an attack roll against it → triggers ["missed"]; a first sentence that only tells it is left out; a Strike rolled twice keeping the better (a fortune effect) → fortune. The simulator (B90): its best melee Strike back (twice, the better, when fortune). Live play: the Strike offer, "failed a Strike against it" (or "critically failed"), every melee Strike as a button, and a note for the fortune roll (checked: Horn, Jaws, Tail).
- **A reaction Strike named only "melee"** (Stand Still too): its best melee Strike in the simulator, any of its melee Strikes on the live offer. Until now it found no Strike by that name.

## A follow-up after an unarmed hit, a Strike at a creature that shoots or moves away (2026-10-11, batch 64)

Two Battlezoo dragon abilities (8 each; their own words stay out of this repository):

- **A follow-up after an unarmed hit** (batch 36's follow-ups): a requirement of a successful melee unarmed Strike just before, or a Draconic Frenzy with one, is read as the single Strike's follow-up (a melee one); the Frenzy's several targets are the GM's. Its Fortitude save (Enfeebled 1, Enfeebled 2 on a critical failure) is the card's. Checked live: after a Jaws hit, the card "after Jaws, DC 29 Fortitude save" at the creature hit.
- **A Strike at a creature that shoots at it or moves away** (batch 22's move trigger): a creature in its tail's reach making a ranged attack at it, or moving away from it during a move action, → triggers ["move", "ranged"]; the Trip it may add on a critical success → criticalTrip, a note in live play. The simulator (B91) already answers both kinds (a ranged attack or a move out of its Melee). Live play: the Strike offer on a ranged attack in its reach ("made a ranged attack in its reach"; the GM checks it was at the dragon) or a move in its reach ("moved in its reach"), each with the Trip note. Checked live on both.

## Its own failed saves, failed Escapes (2026-10-11, batch 65)

- **Its own failed save** (11, batch 53's builtins in more wordings): "The shootist fails a save … rerolls the save and uses the better result" → { builtin: "save-reroll", save: null }; Halfling Luck's "rerolls the triggering check, but she must use the new result, even if it's worse" → keep "new" (a free action's, free); Fortune's Friend's "The result of the saving throw is improved one degree. The Lantern King can't Fortune's Friend for 1d4 rounds." → { builtin: "save-boost", recharge }; Stubborn Resolve's "treats a critical failure as a failure, or a failure as a success" (once a day) → save-boost, uses 1; Reality Twist's "The critical failure becomes a normal failure" → save-boost, criticalOnly; Avatar's Resistance, Temporal Reversion (a check, the save among them). A frequency of once a day, a minute or an hour: one use a fight.
  - **The simulator** (B93): the new roll kept when it says so; a free action's needs no reaction; uses counted; criticalOnly only on a critical failure.
  - **Live play:** batch 53's offers: "Reroll, take the new result" (PF2e's reroll keeping the new one), the boost's note, a use of its frequency spent; Reality Twist's only on a critical failure.
- **A creature it holds failing to Escape** (8): Savage's "Trigger A creature Grabbed by the wyvern critically fails a skill check to Escape Effect The wyvern makes a stinger Strike against the triggering creature." → { builtin: "reaction-strike", triggers: ["escape-critical-failure"] } ("fails" → "escape-failed"); Gnashing Bite's "A creature Grabbed by the corrosive lizard's jaws fails a check to Escape … The lizard's jaws deal 1d6 piercing and 1d6 acid damage to the triggering creature." → its damage, trigger { event: "escape-failed", critical? }. The venom ones (Gnashing Grip, Hundred Deadly Feet) stay the GM's.
  - **The simulator** (B92): after an Escape from it fails (or fails critically, as it says), its Strike or its damage at that creature.
  - **Live play:** an Escape check that fails, at the monster (its target, or a foe in its reach): the Strike offer, or the card offer, "failed to Escape" ("critically failed").
- **Checked live in pftest** (PFTEST SIM B65 Drow Shootist, Paga Nikohian, Pleroma, Wyvern, Corrosive Lizard and goblin dummies, in a combat; deleted afterwards): failed Reflex saves: Shootist's Luck "Reroll, keep the better", Halfling Luck "Reroll, take the new result" (used: rerolled, its use spent), Reality Twist on a critical failure; a dummy's critically failed Escape from the wyvern: Savage, Stinger; a failed one from the lizard: Gnashing Bite, Use it: its card on the dummy.

## An ally's +AC, Counterattack (2026-10-11, batch 66)

- **+AC for an ally** (10): Hammer Block's "Trigger An ally within the bramble champion's reach is targeted by an attack, and the bramble champion can see the attacker Effect … giving the ally a +2 circumstance bonus to AC against the triggering attack.", Stygian Guardian's "A creature or object within the sarglagon's reach is targeted by an attack … Standard Cover against the attack (+2 circumstance bonus to AC)" (a troop's "standard cover": +2), Warding Shove, Impress the Boss ("An adjacent … ally"), Wind Shell's "+4 status bonus to AC against physical ranged attacks", Reactive Defense's "It then makes a melee Strike against the triggering creature." → { builtin: "ally-ac-reaction", value, type, within ("reach" or feet), ranged?, strike? }.
  - **The simulator** (B94): as an attack hits an ally within its distance, its +AC when that turns the hit aside (its reaction); Reactive Defense's Strike at the attacker after.
  - **Live play:** an attack roll that hits its ally within its distance, when +AC would change the result: the offer "rolled a hit against <the ally>", "+2 AC against it turns a hit into a miss"; Reactive Defense's Strike, a note.
- **Counterattack** (5): "Trigger The shae is targeted by an attack from an adjacent creature that misses due to the shae being Concealed Requirements The shae is aware of the attack Effect The shae makes a Strike against the attacker." → { builtin: "reaction-strike", triggers: ["concealed-miss"] }, its best melee Strike.
  - **The simulator** (B94): an attack from its Melee that fails its flat check against its concealment, a Strike back.
  - **Live play:** an attack from beside it while it's Concealed or Hidden: the Strike offer, "attacked it while it's concealed", noting it only answers a miss from the failed flat check.
- **Checked live in pftest** (PFTEST SIM B66 Deep End Sarglagon, a goblin it guards, Monster Core 2's Shae and goblin dummies, in a combat; deleted afterwards): a hit by 0 on the guarded goblin: Stygian Guardian, "+2 AC against it turns a hit into a miss", Use it: a miss; an attack on the concealed shae from beside it: Counterattack with its note, Dagger.

## Ferocity's kin (2026-10-11, batch 67)

- **Kept standing at 0 HP** (10): Orc Ferocity's "Frequency once per day Trigger Evora would be reduced to 0 Hit Points but not immediately killed Effect Evora avoids being knocked out and remains at 1 Hit Point, and her Wounded condition increases by 1.", Mythic Ferocity's "Cost 1 Mythic Point … avoids being knocked out and remains at half its maximum HP, but its wounded value increases by 1" (or "regains 4d10 Hit Points"), Indomitable Beast's "… remains at 1 HP, then can make a stinger Strike against a creature in its reach", Never Fall's "Obrimar's Hit Points are reduced to 0 for the first time that day … He remains standing with 25 Hit Points." → { builtin: "ferocity", hp (1, "half", a number or a formula), wounded, uses?, strike?, mythic?, free? }. Fungal Fervor (slowed that grows each use) stays the GM's.
  - **The simulator** (B95): at 0 HP, those Hit Points (half its maximum, the number, or the roll), wounded +1 only when it says so; its uses, a Mythic Point when it costs one, no reaction when it's a free action; Indomitable Beast's Strike at a creature in its Melee after.
  - **Live play:** batch 21's Ferocity offer, "Stay at half its HP" / "Stay at 25 HP" / "Stay at 1 HP", with notes for the Mythic Point and the Strike; its use sets those Hit Points (a roll for a formula), wounded only when it says so, and spends a use of its frequency.
  - **A fix:** using the offer no longer stops with an error when PF2e has already cleared the dead status as the Hit Points come back (the card stayed open before).
- **Checked live in pftest** (PFTEST SIM B67 Desert Manticore and Mythic Ogre Boss, in a combat; deleted afterwards): the manticore at 0 HP: Indomitable Beast, "Stay at 1 HP" with its Strike note; the ogre: Mythic Ferocity, "It costs a Mythic Point", "Stay at half its HP", used: 65 of 130 HP, wounded, the card settled.

## Reactive Strike's kin (2026-10-11, batch 68)

- **A Strike at a creature that moves (or acts) in its reach** (14): batch 22's provoke trigger read in more wordings ("in the grick's reach", "within a clockwork sentry's reach", "within reach of Racharak's tail", "uses an action with the move trait to leave a square", "uses a move action to leave a square adjacent to the ragewight", "leaves a space within the constable's reach during its move", a closing aside in brackets left out), and its effect as a reaction Strike: "Racharak makes a tail Strike at the creature with a -2 penalty. If it hits, she disrupts the creature's action.", "The grick makes a tentacle Strike against the target. If the attack is a critical hit and the trigger was a move action, the grick disrupts that action.", "The jungle drake Strikes the target with its stinger.", "… against the attacker", Snap Shot's "within 30 feet … This Strike doesn't contribute to his multiple attack penalty, …" → { builtin: "reaction-strike", triggers (move, ranged, manipulate, concentrate; "leave" a move, "enter" an approach), strike, penalty, disrupts (true, or "critical"), within? }. A first sentence that only tells it is left out (its capitalised Strike or Trip words count, not "strikes out"). Root In Place's falling flier is the GM's.
- **A Trip or a Grapple** (7, 2 Battlezoo): batch 55's provoked skill action in more wordings: "attempts to Trip the triggering creature", "uses its tail to attempt to Trip …", "makes an Athletics check to Grapple the triggering creature", "… to Grapple the target"; "This attempt neither applies nor counts toward its multiple attack penalty", "On a success, the triggering movement is disrupted" (a Trip that lands stops it anyway). Not one that adds damage or terrain (Whiplash, Territorial Retaliation, Grasping Strands' Pull).
- **The simulator** (B96): as batch 22's, its disruption on a critical hit only when it says so.
- **Live play:** the move offer as before, "If the Strike is a critical hit, the move is disrupted." for those; Snap Shot's distance with its ranged Strike.
- **Checked live in pftest** (PFTEST SIM B68 Grick, Clockwork Sentry, Raskus and goblin dummies, in a combat; deleted afterwards): a dummy moving away from the grick: Gripping Tentacle with the critical-hit note; from the sentry: Sudden Seize's card; one moving within 30 feet of Raskus: Snap Shot, Spike Launcher.

## Its own hit, or a foe's, that brings a save (2026-10-11, batch 69)

- **A save after a hit** (9): a reaction's save no longer stops at the "hits" or "Strike" of its own trigger — the hit is the trigger's, the save the reaction's: Frightful Strike ("The hamatula hits a creature with a barb Strike"; then immune for 24 hours), Invoke Reckoning, Caress Soul, Pyrebite, Barbed Maw (its bleed while immobilized and its Escape DC for the GM, on the failures), and the foes' hits Slip Up, Mass Wriggle and Web Spray (on the attacker).
- **Its own hit, read more closely** (batch 18's trigger): "hits a Slowed creature", "hits an Off-Guard creature and deals damage", "deals damage to a Frightened creature with a fangs Strike" → { condition }; "… with its peck Strike on its turn" → { ownTurn }; "with a Strike" is any Strike, "with a melee Strike" and "with an unarmed Strike" its kind of weapon (it was read as a Strike named "melee" before). New: Impose Paralysis (2), Necrotic Affliction; better: Master Strike, Numbing Strike, Enfeebling Strike, Feast on Fear (a GM-triggered card before). Not Critical Debilitating Strike, whose save comes only on a critical hit after a choice on any hit (the GM's, as before).
- **Demoralize after a hit** (batch 36's skill action): "makes an Intimidate check to Demoralize the target creature", "attempts to Demoralize the creature with a mere look"; the downed target's alternative (Demoralize all opponents within 30 feet) and the language rule are reminders for the GM. Intimidating Strike, Shock and Awe.
- **Extra damage on the creature it hit** (no roll): "dealing an additional 1d8 sonic damage to the creature struck" (Reverb, 3); "This is in addition to the normal … damage" is left out.
- **"(Enfeebled 2 if it critically fails)"**: the critical failure's own (Caress Soul; Matriarch's Caress now Stupefied 2 on a critical failure too). The later "condition value increases" on more failed saves is not read yet.
- **The simulator** (B97): the condition as the hit lands (off-guard as the attack found it, flanking included), only on its own turn when it says so.
- **Live play:** batch 18's offer after its own Strike, only when the target has the condition (or the attack roll says it's off-guard) and, for "on its turn", only on the monster's own turn.
- **Checked live in pftest** (PFTEST SIM B69 Stone Golem, Hamatula, Pyrefowl and a party Guard, in a combat; deleted afterwards): the golem's Fist hit the Guard: no offer; with the Guard Slowed 1, Impose Paralysis's offer → DC 30 Fortitude card → Paralyzed until the start of the golem's next turn. The hamatula's Barb: Frightful Strike, a free action. The pyrefowl's Peck on the golem's turn: no offer; on its own: Pyrebite → DC 16 Reflex failure → 1d4 persistent fire (no damage at once).

## Charges in their own words (2026-10-11, batch 70)

- **The Strike in a sentence of its own** (batch 7's charge): "The mist bear Strides twice. During this movement, … Concealed. The mist bear then Strikes.", "… Strides up to twice its Speed, during which it attempts a High Jump or a Long Jump. At any point during its movement, the morlock can make a melee Strike against an enemy in its reach." — read as one move and its Strike; what only tells the move (concealed as it moves, ignoring difficult terrain, moving through creatures, flying or swimming in place of a Stride, another ability's temporary Hit Points) is left out.
- **More wordings:** a Strike "after either Stride", "against any foe along its path", "at any point during its movement" after "Strides twice and Strikes"; "Strides twice, Leaps twice, or Strides once and Leaps once. It then makes a jaws Strike …"; Feral Leap's jump of half its Speed that triggers no reactions (a safe move, batch 63's); batch 42's "if it ends its movement within melee reach …" with its full stop missing, by flight "at a lower elevation than they started", "gaining a +1 circumstance bonus to the Strike" (its attack bonus); any name before "moved at least 20 feet" ("the ōmukade").
- **What they add:** "The target is Off-Guard to this attack if the bear moved at least 20 feet" (off-guard); "… unless it has seen a Rearward Rush before" (off-guard only the first time against that creature); "The morlock then can't use Leap Attack for 1 round" (a recharge); a circumstance bonus to its damage roll once it has moved 20 feet (+N damage). Extra damage on a hit stays the Strike activity's (batch 10), whose card applies it: Furious Charge.
- Not: a charge only in the first round of combat (Startled Charge), or one with a target in darkness, a Feint, a Grapple, a whirlpool or a spell after it.
- **The simulator** (B98): off-guard only the first time against each creature, the recharge, the damage bonus.
- **Live play:** as batch 7's charges — the GM moves the monster and rolls its Strike; Furious Charge's extra damage comes on the Strike activity's card.

## Resistance against the damage that sets it off (2026-10-11, batch 71)

- **The reaction** (14 PF2e, 4 Battlezoo): a trigger of damage on it — "The dragon takes fire damage", "… would take piercing damage", "… is about to take piercing or slashing damage", "… is damaged by an attack dealing physical damage", "An enemy is about to damage the cavern seer with bludgeoning damage (or with a spell that has the earth trait)" — and an effect that gains resistance against it, perhaps after a sentence that only tells it: "They gain fire resistance 20, including against the triggering effect, until the end of their next turn", "… gaining resistance 5 against the triggering piercing damage", "… gains resistance 15 to the damage, but their AC is reduced by 2 for 1 day" → { builtin: "resist-damage", value, on (the damage types that set it off), types (those it resists; none: all that damage), attack?, foe?, lasts?, acPenalty?, uses? }. Liquefy, Chipping Scales, Sacrifice Armor, Reactive Growth, Pincushion, Stone Defense, Elemental Bulwark; a Battlezoo dragon's guard against physical damage.
- Not: one for an ally (Liberating Step, Selfish Shield), one with a requirement (Shell Block), or one that also moves, teleports, Strikes or deals damage back (Gnomish Shift, Bounce Away, Brimstone Defense, Sharp Riposte), nor one whose type follows the damage for a while (Runic Resistance, Chromatic Shift, Energy Ward).
- **The simulator** (B99): when damage of its types would hurt it (an attack's only, an enemy's only, when it says so), its reaction: resistance N against that damage, off each damage type; kept until the end of its next turn when it says so; AC lower for the rest of the fight when it says so; once a fight for a use a day.
- **Live play:** PF2e has applied the damage by then, so an offer comes after it: "Use it: 12 HP back" gives back what the resistance would have kept off — sized from the latest damage roll's types when there is one (no offer when none of its types sets it off), otherwise the resistance at most, with a note on which damage counts. Using it puts what lasts on the monster as PF2e effects: the resistance until the end of its next turn (a Resistance rule), its AC for a day (an AC modifier); and spends a use of its frequency. No offer while its resistance from before still lasts.
- **Checked live in pftest** (PFTEST SIM B71 Sea Dragon (Ancient), Aapoph Granitescale and a party Guard, in a combat; deleted afterwards): 31 fire on the dragon → Liquefy's offer → 20 HP back and a Liquefy effect with fire resistance 20; the next 25 fire took 5. Cold damage from a damage roll: no offer; 12 fire: "12 HP back". 30 slashing on the granitescale → Chipping Scales: 15 HP back, AC 24 → 22 for a day, its daily use spent; the next round's damage: no offer.

## Its turn beginning, the fight starting, a hazard joining it (2026-10-11, batch 72)

- **Its own turn beginning** as a trigger in its own right ("The director general's turn begins", "The fetch starts its turn") → { event: "own-turn-start" }, as batch 26's free actions had it. Not with a requirement (Petrify Prey, Sacrifice Warshard: the GM's, as before), nor a hazard's (Explosive Blast: its hazard flow posts its card); and its target is never "the attacker" (there is none).
- **Demoralize as the fight starts or its turn begins** (batch 52's reader): "The Brass Dragon roars out a mighty challenge and attempts to Demoralize a creature it can see" (Battle Cry, initiative), "The director general attempts to Demoralize a creature within 60 feet that they can see and that can see the director general" (Stern Glare, its turn) → PF2e's Demoralize with that trigger.
- **What only brings another into the fight** (79): "The trap rolls initiative.", "The rocks of the area begin to crumble. The hazard rolls for initiative.", "The augdunars roll initiative." — every sentence words only (no number, damage, save, Strike, spell, condition, move or creature exposed to an effect) → no-effect: the hazard flows already bring a complex hazard into the encounter and post its text. Also Sustain a Spell as its turn begins (Effortless Concentration, Nature's Concentration). Not: Surge of Pain (it casts a spell), Grasping Hands (Grabbed), Ghostly Assault, Spew Toxins, Gale, Begin to Spin, Find Freedom in the Song.
- **The simulator** (B100): a one-creature ability with no creature setting it off (initiative, its own turn): at its nearest foe — in its Melee, else not far when its range is over 10 feet; none, not used.
- **Live play:** batch 26's offer as its turn begins and batch 47's at initiative, as before (the GM targets the creature on the card).

## Double moves, a final Strike, a foe teleported away (2026-10-11, batch 73)

- **Two Strides for two actions** (9): "The horse Strides twice, with its Speed increased by 10 feet.", "The manta ray Swims twice. It has a +10-foot circumstance bonus to its Speed during these actions.", "The pegasus uses 2 move actions, each of which can be either Stride or Fly …", Clear the Rain's terrain → no-effect: two Stride actions, which the simulator and PF2e play already; the Speed bonus and the terrain are the GM's. Not one joined to another action ("Raises a Shield and Strides twice").
- **One action for two moves** (batch 41's Speed Surge): "Frequency once per round … Strides twice. During this movement, …, gaining resistance 5 to physical damage." (Flickering Dash: once a round, no count), "Strides twice, Steps twice, or Steps and Strides (in either order). It cannot use Burst of Speed again for 1d4 rounds." (its recharge).
- **Final Blow** (batch 61's death Strike): "Berleth is reduced to 0 HP" (a name, "HP"), "makes a final shovel Strike before dying".
- **Bounding Sprint**: batch 70's charge, its "has nothing in its hands" requirement met by natural attacks.
- **Raise a Shield** under its own name with no slug (a Battlezoo dragon's "Raise a Shield (Wing Only)"): PF2e's basic action, which the simulator plays for a creature with a shield.
- **Shoo!** (8): "An enemy within 15 feet damages the dragon … The dragon teleports the creature up to 45 feet away. The destination must be on the ground and in a space with no hazards." → no roll, on the attacker: a push of that distance (the simulator's, and the card's through the core's forced movement), with a note that it's a teleport (through anything in the way, the destination's rules).
- **The simulator** (B101): Speed Surge's kin once a round or with a recharge; Shoo!'s push takes the foe out of its Melee.
- **Checked live in pftest** (PFTEST SIM B73 Phase Dragon (Young) and a party Guard, in a combat; deleted afterwards): the Guard's critical Sap hit → Shoo!'s offer → its card at the Guard → Apply: pushed 15 feet (the young dragon's distance), with the teleport note.

## Conditions that grow with each later failure (2026-10-11, batch 74)

- **The reading** (28 compiled plans, 5 Battlezoo; their conditions applied a flat value before): "If the target fails additional saves against this ability, the condition value increases by 1 (or 2 if it critically fails) (to a maximum of stupefied 4)", Caress Soul's "by 1 if failed, or 2 if critically failed", "Each time a target fails an additional save against this ability, the condition value increases by 1 (to a maximum of Clumsy 4)", "On each subsequent failure, the drained condition value increases by 1 (or by 2 on a critical failure), to a maximum of drained 4", "If the creature is already drained, its drained value increases by 1 (to a maximum of drained 4)", "If it's already stupefied, its stupefied value increases by 1 instead", "… this increases its drained value instead" (by its own value) → the failure's and critical failure's condition get { stack: { by, max? } }. Not one that grows two conditions ("drained or doomed"), nor drinking blood's (its healing changes too).
- **The core** passes the stack on in the condition change; **live play** sets the condition to what the creature has plus the stack, to its maximum ("the Guard's stupefied grows to 2"); **the simulator** (B102) the same.
- **Checked live in pftest** (PFTEST SIM B74 Lamia and a party Guard; deleted afterwards): Lamia's Caress failed once → Stupefied 1; again → "stupefied grows to 2", Stupefied 2.

## Slowed, then petrified (2026-10-11, batch 75)

- **The reading:** "If the creature was already Slowed by petrifying gaze before attempting its save, a failed save causes it to be Petrified permanently" (Focus Gaze), "If the creature was already slowed by this ability or Petrifying Glance, a failed save causes the creature to be Petrified permanently" (Petrifying Gaze), "If a creature is already slowed when it fails its save, it becomes Paralyzed for 1 round" (Paralytic Saliva), "When a creature already slowed by Briar's Hold fails its Fortitude save, it becomes Petrified for 1 minute …" → { escalate: { if: "slowed", slug, duration } } on the failures' Slowed. The sentence is set aside before the other readings, which lets the Basilisk's and the dracolisks' Petrifying Gaze and the Fossil Golem's Fossilization compile (6 new); on the Focus Gazes it was a reminder for the GM before. The sentence is found by its own split, across a paragraph's end too.
- **Also:** what batch 74 marks (a condition that grows) and this now reach the plans the later readers make (Focus Gaze, Paralytic Secretion, Energy Drain), not only the first ones.
- **The core** passes the escalation on; **live play** applies the worse condition to a creature that already has the first ("was already slowed: petrified (until it's restored)"), timed when it says so; **the simulator** (B103) the same, petrified playing as paralyzed.
- **Checked live in pftest** (PFTEST SIM B75 Basilisk and a party Guard; deleted afterwards): the first failed Petrifying Gaze → Slowed 1; the second → Petrified.

## A save to avoid becoming a condition (2026-10-11, batch 76)

- **The wording:** "… must succeed at a … save to avoid becoming Sickened 1 (Sickened 2 on a critical failure)", "… save to resist becoming Slowed 1", "… save to avoid being knocked Prone (and Stunned 1 on a critical failure)" → what it avoids is the failure's result, as "… save or become …" is (17 PF2e, 2 Battlezoo). The Wild Hunt's Wild Gaze auras (5) compile with it, and through them their Focus Gazes (5, batch 39's reader), which also carry batch 75's "already slowed by the wild gaze → Paralyzed for 1 round"; the bandersnatches' Pain rider; hazards' Erupting Burst, Break Your Fast, Listen to Your Own Decay, You Will Know My Name!
- **"Permanently":** "Dazzled for 1 minute (or Blinded permanently on a critical failure)" — the critical failure's condition no longer takes the failure's minute.
- Live play and the simulator: their cards and plans as any save's.

## More saves to avoid a condition (2026-10-11, batch 77)

- **"Must attempt a … save to avoid becoming"** (18): batch 76's wording when the save is only attempted — Stunning Despair ("Creatures within 30 feet must attempt a … save to avoid becoming Stunned 1 (Stunned 3 on a critical failure)"), Muddle Mind (3), Mindwarp Ink (2), Decaying Touch, Tickle, Enticing Charade, Green Glow, Command Zombie, and haunts' and hazards' We've Been Here Forever, The Sky Breathes Smoke, They're All Around Us!, Moment of Glory, Bow Before Your God, Cyclone of Hair, Reminders of Life.
- **A critical failure's longer time with words after it:** "Paralyzed for 1 round (or 1 minute on a critical failure, with a new save at the end of their turn to recover)" — the critical failure's minute (the new save is the GM's); Soul Reflection's "(or 1 minute on a critical failure, as …)" too.

## A reaction's save whose trigger names a Strike (2026-10-11, batch 78)

- **The guard:** batch 69 let a reaction's save read from its Effect when its trigger read; now for any reaction or free action with a Trigger and an Effect. One whose trigger the module can't read is a card for the GM to use (as 737 reactions already were): Savvy Joinin' Me Crew? (3), No Prey, No Pay (3), Grizzly Arrival (2), Peel Face, Retributive Suplex, and Battlezoo reactions (7).
- **New triggers:** "A creature lands a critical hit with a melee Strike against the vitalia" (hit-by, melee, critical: Blood Eruption at the attacker), a melee Strike that "succeeds" against it (hit-by, melee), "The artist is targeted with a melee or ranged Strike by a creature within 15 feet" (attacked within 15 feet, any Strike: Flick Ink).
- Live play and the simulator: batch 16's and batch 47's offers and reactions.

## A rage that says whom it attacks (2026-10-11, batch 79)

- **The reading:** batch 33's triggered rage (its Hit Points at or below a number as it takes damage) when its text also has a sentence that only says whom it attacks first and whom after — its allies among them. That sentence is set aside (the GM's); the rest reads as before: temporary Hit Points, a status bonus to damage, a penalty to AC, no concentrate actions. 8 Battlezoo dragons.
- The simulator and live play: batch 33's rage, as it takes damage at or below that number.

## Two Strikes that both hit; more Strike activities (2026-10-11, batch 80)

- **What both hits bring** (batch 13's multi-Strike): "If they both hit, the target becomes Slowed 1 for 1 round" (Chilling Combo), "If both attacks hit, the target is also knocked Prone" (Hoof Avalanche), "If both hit, the creature is Grabbed …" (Slam Doors), "If both attacks hit, the target is also dealt 1d8 persistent bleed damage" (Vicious Flurry) → { bothHit: { conditions, damage } }, on one creature. Not one with more than that (an exposure to a poison, a Disarm, temporary Hit Points). Its first sentence in more words: "They make two hoof Strikes against the same target", "… at the same target, each using her current multiple attack penalty" (also Claw Feint, batch 43's off-guard second Strike).
- **Strike activities:** Terrifying Smite's "against an enemy that has one of the rekhep's allies within its reach" (requires "ally-adjacent"; its extra damage and Frightened 2, doubled on a critical hit, as batch 27 read); Pierce Armor's prone on a hit and 2d6 bleed (the armor it breaks: the GM's; with hardness 10 or lower it breaks on the hit that brings the bleed); Drag's Strike at a Prone enemy (batch 37's Strike-only; its drag the GM's).
- **The simulator** (B104): the rider when every Strike hits the same creature; Terrifying Smite only at a foe in the same Melee as one of its allies.
- **Live play:** the multi-Strike as before (the GM rolls the Strikes); a note to the GM as it's used: "if both Strikes hit the same creature, it is Slowed 1 for 1 round". The activity cards as batch 10's.

## A harder Escape; a failed save's own sentence; a monster's name in a duration (2026-10-11, batch 81)

- **A harder Escape:** "Trigger A creature Grabbed or Restrained by the zinba attempts to Escape. Effect The DC of the Escape check is increased by 2." (Tighten Coils, 5) and "… takes a –2 circumstance penalty to the check to Escape" (No Liberation) → { builtin: "escape-guard", value }. The simulator (B105) spends the monster's reaction as a creature it holds tries to Escape, and that check's DC is 2 higher; the planner counts it when weighing an Escape. Live play: when an Escape succeeds by too little for the higher DC, the GM gets an offer ("+2 Escape DC against it turns a success into a failure"); using it posts "the Escape DC 2 higher makes it a failure. Valeros stays held" and spends the reaction.
- **An Escape rolled as an unarmed attack:** PF2e rolls an Escape with the best of Acrobatics, Athletics and an unarmed attack; an unarmed one is an attack roll, which the Escape reactions (batch 65's, and this one) didn't see before.
- **"If the target fails a … save, it gains …"** (also "…, they are Dazzled until …", "…, they become Sickened 2 …"): that save's failure (Dancer's Curse, Fling Sand in the Eyes with its critical failure's Blinded, Blighted Consumption as a card for the GM).
- **A monster's name in a duration:** "until the beginning of Bshez's next turn", "until the start of the skeletal knight's next turn" → until the start of its next turn (both spellings, "start" and "beginning", and "end" already). 40 compiled abilities (2 Battlezoo) gain an end to a condition that had none: Unbalancing Blow, Grip of Fear's Paralyzed, Snagging Strike, Think Fast! … Intimidating Charge's off-guard no longer takes its Frightened's minute.
- **Strike activities:** Stunning Strike ("Requirements … hit a foe earlier this turn with a weapon Strike": requires "hit-earlier", the simulator only at a foe it hit this turn, after its Strikes; "On a critical failure, the foe is Stunned 2 instead." as its save's critical failure); Tangle Prey ("draws a bola and Strikes a target within 20 feet", then "rolls an Athletics check … to Trip them" on a success: a bola Strike and a Trip).
- **Multi-Strikes:** Painful Limbs ("up to four Strikes against different targets, each using a different limb"), Wing Snap ("two wing Strikes, then falls if it's flying. It can't Fly until the end of its turn": the fall the GM's).
- **Checked live in pftest** (PFTEST SIM B81 Anaconda, Snow Oni and a copy of Valeros; deleted afterwards): an Escape by unarmed attack 1 over the DC → the Tighten Coils offer; Use it → a failure, the reaction spent; one that the higher DC doesn't change → no offer. Batch 80's Chilling Combo → the GM note "if both Strikes hit the same creature, it is Slowed 1 for 1 round".

## A second Strike after a hit; berserk; an effect from a reaction; a maneuver with another skill (2026-10-11, batch 82)

- **A second Strike only after a hit:** Pike and Strike's "makes a melee Strike with their naval pike. If this Strike hits, the bosun can either move the target 5 feet within the pike's reach or make a fist Strike against the target without increasing their multiple attack penalty until after the fist Strike" → a multi-Strike { strikes: [naval pike, fist], sameTarget, sameMap, ifFirstHits, instead }. The simulator (B106) makes the second Strike only after a hit and values it by the first's chance to hit; it never takes the move. Live play: the GM rolls the Strikes from the sheet; a note says "only if the naval pike Strike hits, the fist Strike at the same multiple attack penalty, or instead move the target 5 feet within the pike's reach".
- **Berserk Slam:** "Requirements The flesh golem is berserk. Effect The flesh golem Strikes with its fist at a -1 circumstance penalty. If it hits, it deals 1d6 extra damage and knocks the target Prone." → a Strike activity (requires "berserk"; fist at −1; 1d6 of the Strike's type and Prone on a hit). "Requirement" (singular) heads read as "Requirements" do. The simulator doesn't play a golem's berserk state, so it never plans one; live play's card as other activities'.
- **A reaction whose result is a PF2e effect:** batch 37's effect reader now takes a reaction whose trigger reads: Brutal Rally ("The gang leader rolls a critical hit against a creature": its own Strike's critical hit; "All allies that can see the gang leader gain …": its allies), Curl Up (itself, as it takes damage), Consumed by Bloodlust (itself, as it damages a creature), You'll Pay for That (its allies, as an enemy damages it). Fed by Water (a water effect aimed at it) now gives its PF2e effect rather than its temporary Hit Points alone. The simulator (B106) gives the effect to itself, or to its allies in the fight, as the trigger comes. Live play: the offer's Use posts the effect card, on itself or on its allies in the encounter; Apply gives the effect.
- **A maneuver with another skill:** Embrace's "attempts to Grapple a creature using their Diplomacy bonus instead of Athletics" (also Deception) → PF2e's Grapple, rolled with that skill (a willing creature is the GM's).
- **Checked live in pftest** (PFTEST SIM B82 Gang Leader, Bosun, Trilobite and a copy of Valeros; deleted afterwards): the Gang Leader's critical hit → the Brutal Rally offer; Use → the effect card on the Bosun and the Trilobite; Apply → both have Effect: Brutal Rally, Valeros not. 3 damage on the Trilobite → the Curl Up offer; Use → its effect card; Apply → AC 17 (+2). Pike and Strike → the GM note above.

## Only a Strike; every creature in reach; damage on a Prone creature; four Strikes at their own penalties (2026-10-11, batch 83)

- **Only a Strike** (batch 47's reading): "Requirements Quara is holding an unloaded repeating hand crossbow Effect Quara Interacts to reload the repeating hand crossbow and Strikes with it" (Reloading Trick; a requirement that it hold the weapon, and "Interacts to reload the …", now read); "makes a mandibles Strike; if the Strike hits, the target's armor takes the damage …" (Armor-Rending Bite); "makes a mandibles Strike against a creature it has Grabbed. If that Strike hits and the creature is wearing armor with Hardness 12 or lower, the armor is broken. …" (Rending Mandibles, Pry). What happens to the armor is the GM's.
- **A Strike at every creature in its reach** (batch 13's sweep): "… makes a tentacle Strike against every creature within its reach" after a first sentence that only tells it (Whirlwind of Hooks), "makes a single claw Strike against every creature in reach" (Skeletal Storm: the claw).
- **A distant Strike:** Portal Strike's "makes a claw Strike against a creature within 120 feet. The target is Off-Guard to the Strike." → a Strike activity (claw, off-guard); the distance is the GM's (the simulator plays it in melee).
- **Damage on a creature already Prone:** Stomp's "Strides up to half its Speed and makes a boot Strike … If the boot Strike hits a Prone creature, it deals an extra 2d6 bleed" → onHit.proneDamage. The simulator (B107) adds it when the creature hit was already Prone; live play's activity card has it only then.
- **Four Strikes at their own penalties:** Eviscerate's "Requirements The rivka has not attacked yet this turn … It makes four Strikes: the first at its highest attack bonus, the next two with a -4 penalty to their attack rolls, and the last one with a -8 penalty. This ability counts as four Strikes for the purpose of its multiple attack penalty." → a multi-Strike { penalties: [0, 4, 4, 8], countsAs: 4, requires: "first-attack" }. The simulator (B107) plans it only before any attack that turn. Live play: the GM rolls the Strikes; a note gives each one's penalty.
- **Checked live in pftest** (PFTEST SIM B83 Redcap, Rivka and a copy of Valeros; deleted afterwards): Stomp, then an Iron Boot hit on a Prone Valeros → the activity card; Apply → persistent 2d6 bleed (no immediate damage). The same on a standing Valeros → no card. Eviscerate → the note "Strike 1 at its full bonus, Strike 2 at −4, Strike 3 at −4, Strike 4 at −8; only before any other attack this turn".

## Any disguise; a mythic reroll; a Stride and then Strikes (2026-10-11, batch 84)

- **A disguise as any object** (batch 42's, for statues and corpses): "Until the next time it acts, the doorwarden appears to be a door. It has an automatic result of 31 on Deception checks and DCs to pass as a door." — also "Until it acts, … resembles …", "appears as …", "Until it next acts", "(44 in forests or swamps)", "on Deception and Stealth checks", "to convincingly pass as", a requirement of where or in what form it is. Nothing for the fight's numbers (no-effect): the Deception DC is for before the fight. Not one that also gives fast healing (Statue), turns an aura off (Natural Formation, Monument), lets a creature walk into it and be Engulfed (Dune), or Strikes (Mud Puddle).
- **A mythic reroll:** "Cost 1 Mythic Point Trigger The ancient one fails a check Effect The ancient one rerolls the check." → batch 65's save reroll (keep "new": a plain reroll keeps the new result), mythic. The simulator (B108) spends a Mythic Point (3 a fight) each time. Live play: batch 53's offer as its save fails, with "It costs a Mythic Point."
- **A Stride, then Strikes:** Chase Prey's "rushes forward on all fours, Striding and then making two claw Strikes", Frumious Charge's "Strides, ignoring difficult terrain, then makes two claw Strikes at the end of its movement" → a multi-Strike { strikes: [claw, claw], sameTarget, strides: 1 }. The simulator (B108) Strides to a creature one Stride away, then makes the Strikes; the planner counts a creature that close. Live play: the GM moves the creature and rolls the Strikes.

## A hazard that only rolls initiative; a form shift as the fight starts; charges after a distance; Strikes along a Stride (2026-10-11, batch 85)

- **Only into the fight** (batch 72's, in any quiet wording): a reaction whose effect only describes itself and has the hazard (or creature) roll initiative — "Spectral faces appear, and the haunt rolls initiative.", "The hazard rolls initiative as the flood surges forth.", "The blade begins to float in the air, then rolls initiative.", "All eight looms roll initiative." A creature that emerges or spawns to defend it is the GM's, as summons are (the user's choice of 2026-10-11): Portal, Bloom, Conjure Daemon, Planar Breach, Aquatic Onslaught. Not one that also targets, shoots or sinks a creature (Needle Rain, Expunge, Submerge, Heavy Water, Capture), performs its routine at once (Storm Surge), or uses a skill action. Nothing for the fight's numbers (no-effect); the hazard's routine is its own.
- **A form shift as the fight starts:** Quick Change's "… uses Change Shape to enter her hybrid form" and True Appearance's "… ends Change Shape" as initiative is rolled — the GM's, as form shifts are (the user's choice of 2026-10-11).
- **After a distance:** "If the unicorn moved at least 20 feet, it deals an additional 2d6 damage on a hit" (Powerful Charge) — the charge's Strike's extra damage; "If it moved at least 10 feet, it gains a +1 circumstance bonus to its attack roll" (Rampaging Charge; batch 25 read only 20 feet). Clobbering Charge's "Strides up to its Speed. If it ends its movement within melee reach of a target, it can make a skull Strike against that target. If the pachycephalosaurus critically hits with this Strike, the creature hit is Stunned 1." → a Stride and a skull Strike, Stunned 1 on a critical hit.
- **Strikes along a Stride:** Mauling Rush's "Strides up to its Speed. It can make up to four claw Strikes at any point during this movement, each against a different target. These attacks count toward …, but the multiple attack penalty doesn't increase until after …" (also Storm of Blades, Whirling Slashes "His multiple attack penalty applies as usual") → a multi-Strike { each, max, strides: 1 }; Scimitar Blitz's "Strides up to their Speed, Striking once with each of their scimitars …" → two scimitar Strikes after a Stride. The simulator (B109) Strides into a Melee one Stride away and Strikes each creature there (up to the number); the planner weighs each place it could go. Live play: the GM moves the creature and rolls the Strikes.

## Counterspell's kin (2026-10-11, batch 86)

- **The reading:** a reaction whose Trigger names a spell or an effect ("is the target of a spell", "A creature within 30 feet casts a divine spell", "is targeted by a mental effect they're aware of", "uses an auditory or sonic effect") and whose Effect attempts to counteract it ("attempts to counteract the triggering spell", "makes a counteract check against the effect", "to counter the triggering creature's casting") → no-effect: the GM's, as Counterspell is (the user's choice of 2026-10-11, batch 41). What a success brings besides (the spell turned back on its caster, the dragon regaining a spell slot, the caster Stunned) is the GM's too. Its own split of Trigger and Effect is case-sensitive: "a mental effect they're aware of Effect …" keeps the trigger whole.
- Not one set off by anything else (a creature reduced to 0 Hit Points, entering magical darkness, about to be affected by a condition).

## A teleport and a Strike; a Disarm when both hit; a bonus to its own save (2026-10-11, batch 87)

- **A teleport and a Strike:** Slip Between's "teleports into an occupied space it can see within 50 feet and makes a melee Strike" → batch 70's charge, its move triggering no reactions (B90's safe), as many Strides as the distance covers (25 feet each).
- **Two weapons, a Disarm when both hit:** Dual Disarm's "makes two Strikes, one with their rapier and one with their main-gauche (in either order). If both Strikes hit, the ship captain can attempt to Disarm the target." → a multi-Strike [rapier, main-gauche] with bothHit { follow: "disarm" }. The simulator (B110) casts its own Disarm at the creature both Strikes hit. Live play: the GM note "if both Strikes hit the same creature, the attacker can attempt to Disarm it".
- **Only a Strike:** Reloading Strike's "makes a melee Strike against an opponent within reach and Interacts to reload a firearm in their other hand".
- **A bonus to its own save as it comes:** "Trigger Padli attempts a saving throw against a spell cast by a creature he can see Effect Padli gains a +2 circumstance bonus to the triggering save." (Occult Ward), "is about to make a saving throw against a spell or magical effect" (Orc Superstition, +1), "is about to attempt a saving throw" (Reaper's Protection), "is targeted by a spell that allows a saving throw" (Divine Grace), "An opponent casts a spell that targets the manticore and requires a saving throw" (Spell Reflection, +4; what a critical success brings is the GM's) → { builtin: "save-bonus-reaction", value, against? }. The simulator (B110) spends its reaction on the first such save and counts the bonus. Live play: offered as the save fails, when the bonus would change the result ("+2 to the save turns a failure into a success"); using it says the new result for the GM to apply.
- **Free actions among its answers:** batch 16's reaction offers took built-in answers of reactions only; a free action's (its plan marked free: a mythic Reroll, batch 65's free rerolls) is now offered too.
- **Checked live in pftest** (PFTEST SIM B87 Padli, Kitari, Ancient One and a copy of Ezren; deleted afterwards): Padli's Will save against a spell failed by 1 → the Occult Ward offer; Use → "+2 to the save makes it a success". The Ancient One's failed save → the Reroll offer with "It costs a Mythic Point." (batch 84's). Dual Disarm → the GM note.

## A maneuver back in place of a Strike (2026-10-11, batch 88)

- **The reading:** batch 57's reaction Strikes, with a basic maneuver in place of the Strike → { builtin: "reaction-strike", triggers, strike: null, skill, penalty, bonus? }. Triggers: "A creature rolls a critical failure on a melee weapon Strike against …" or "critically fails a weapon Strike against …" (critical-miss), "misses … with a melee (weapon) Strike|attack", "makes a melee weapon Strike against … and misses" (missed), "hits … with a melee weapon|Strike", "is hit by a melee attack" (hit, new), "takes damage from a melee attack|an adjacent creature" (damaged-adjacent). Effects: "attempts to Disarm|Shove|Trip|Grapple|Demoralize the triggering creature|the creature|the attacker|the weapon used in the triggering Strike", "at a -2 penalty", "gaining a +1 circumstance bonus". Sentences after it with no numbers, conditions or damage of their own are the GM's (a weapon kept, "If it rolls a success, it gets a critical success instead" — not counted). Not one with a requirement (Defensive Disarm, Snagging Catch), a condition it adds (Opportunistic Brawler's Prone), or a choice of a Strike instead (Dueling Riposte).
- **The simulator** (B111): its own basic action at the creature (the penalty or bonus on the check, no multiple attack penalty since it isn't its turn), as a reaction Strike would be; a melee hit on it is a new trigger.
- **Live play:** an offer "Use it: Disarm (−2)"; using it posts PF2e's maneuver as a card on the creature (the penalty or bonus on the check).
- **Checked live in pftest** (PFTEST SIM B88 Omox and a copy of Valeros; deleted afterwards): Valeros's longsword hit on the omox → the Absorb Weapon offer; Use it → the Disarm card (Athletics against Valeros's Reflex DC).

## Summoned steeds; more multi-Strikes; Claw Rake (2026-10-11, batch 89)

- **Summons, the GM's** (the user's choice of 2026-10-11): Summon Steed's "The dullahan summons a war horse with elite adjustments … This steed remains until it is slain, …" → no-effect; batch 50's summoning traps also as "This trap summons a specific level -1 creature, determined when the trap is created. … The creature rolls initiative and remains for …".
- **Multi-Strikes:** Rapid Strikes' "makes three melee Strikes, each against a different target within reach. The multiple attack penalty applies to each attack but increases only after all the attacks have been made." (the penalty sentence, without its comma); Scimitar Storm's and Falchion Swipe's "makes a scimitar attack against each enemy within reach" (an attack read as a Strike; "The first enemy they damage is subject to …" — its other ability, the GM's); Flying Fists' "Flies and makes up to four fist Strikes against different targets at any points during this movement" and Double Bite's "Strides and then makes a jaws Strike with each of their heads, each against a different target" (batch 85's Strikes along a move).
- **Claw Rake:** "makes two claw Strikes at the same target, using the same attack bonus as their highest melee attack. If both attacks deal damage, the target takes extra damage equal to one claw Strike." → a multi-Strike { noMap, bothHit: { strikeDamage: "claw" } }. The simulator (B112) makes both at its highest attack bonus (two attacks counted after) and rolls a claw's damage again when both hit. Live play: GM notes, "each Strike at its highest attack bonus" and "if both Strikes hit the same creature, it takes extra damage equal to one claw Strike (roll its damage again)".
- **Allies Quickened:** batch 26's allies with their kind named ("Each ogre ally who hears and understands this command becomes Quickened until the end of that ally's next turn but can use the extra action only to Step or Stride").
- **Checked live in pftest** (PFTEST SIM B89 Sphinx; deleted afterwards): Claw Rake → both GM notes.

## More multi-Strike wordings (2026-10-11, batch 90)

- **Wordings:** "makes a Strike with each set of jaws, each against a different creature. These Strikes count as one attack for … multiple attack penalty, and the penalty doesn't increase until after both attacks" (Two-Headed Strike); "It makes up to five melee blade Strikes. No single creature can be targeted by more than one blade Strike during one use of this ability." (Whirling Death: each at a different creature); "makes two Strikes with their greataxe against two adjacent enemies … The second attack uses the same multiple attack penalty as the first, but attacks they make after this take a –10 multiple attack penalty." and "… making greataxe Strikes against any two foes who are adjacent to each other …" (Axe Swipe: two attacks counted); "makes a Strike with up to four arms, each against a different target and using a claw or scimitar as appropriate … can use Grab following this activity" (Bloody Dance: a Grab after a hit); "makes two claw Strikes and one jaws Strike in any order … becomes Clumsy 1 until the start of their next turn" (Fervent Frenzy; its off-guard while frightened by its other ability is the GM's); "against an Immobilized or Off-Guard target" (Dual Stab: requires "off-guard"); Sweeping Axes' "Requirements … is wielding two battle axes" (what it wields) and "the bonus from sweep applies to each attack" (left out).
- **A Stride and a Strike, nothing more:** Darting Strike's "Strides up to 10 feet and then makes a Strike, or makes a Strike and then Strides up to 10 feet" (batch 42's Step-or-Strike kin); a Strike activity read through whose only parts are its Strides and its Strike, for as many actions (Feathered Charge: terrain it ignores, a fall the GM's) → only a Strike (no-effect, strikeOnly).
- **The simulator** (B113): a multi-Strike requiring "off-guard" only at an Off-Guard or Immobilized creature; one with a requirement the engine doesn't know, never.

## Strikes with each head, each weapon, at a longer reach, after a Stride (2026-10-11, batch 91)

- **Multi-Strike wordings:** "makes a fangs Strike with each of its heads, each against a different target" (Twin Bites); "Requirements … is wielding two scimitars Effect … makes two Strikes against the same target, one with each of their scimitars … This counts as one attack when calculating … multiple attack penalty" (Paired Strike; what it wields is a requirement now read, which also names the weapon in three Double Slices); "makes two Strikes with her bow using her current multiple attack penalty" (Twin Shot); "… reach increases to 20 feet for these Strikes" (Extend Limbs: the reach the GM's); "each against a diferent target" (Barbed Cirri: the text's own spelling).
- **A Stride, then two Strikes:** Dual Pounce's "Strides and makes two claw Strikes against the same creature at the end of that movement" (batch 84's Chase Prey).
- **A Stride with more Speed:** On All Fours' "Strides with a +10-foot circumstance bonus to their Speed" (nothing in its hands as its requirement) → no-effect, as batch 73's moves.

## Strikes along a swim, six vines, more moves, a Demoralize with Performance (2026-10-11, batch 92)

- **Strikes along a move:** Vicious Strafe's "Swims up to its Speed. It can make one jaws Strike and one tail Strike at any points during its movement, each attacking a different target." (batch 85's Strikes along a Stride).
- **Six vines:** Vine Forest's "They make up to six vine Strikes, each against a different target; this counts as one attack for their multiple attack penalty, increasing only after all the attacks are made." (a subject of "They", up to six).
- **Moves only** (no-effect, as batch 73's): "jumps up to their Speed horizontally, or half that vertically" (Unnatural Leap), "Steps and Strides in any order" (Fancy Footwork), "Leaps up to 10 feet vertically or 30 feet horizontally" (Coiled Leap).
- **A maneuver with another skill** (batch 82's Embrace): Cutting Remarks' "levies insults or backhanded compliments, attempting to Demoralize a creature using their Performance modifier instead of Intimidation" → PF2e's Demoralize, rolled with Performance.

## A charge in fewer actions than its moves; allies only moving closer (2026-10-11, batch 93)

- **Fewer actions than moves:** batch 25 read a charge only when it took at least as many actions as its moves (Swoop's 2 actions for one Fly and a Strike). The text decides now: the knight's "Frequency once per turn Effect The knight Strides twice. If they end their movement within melee reach of at least one enemy, the knight can make a melee Strike against that enemy." (1 action), Eagle Dive's "Flies up to double his fly Speed in a straight line, descending at least 10 feet, and then makes a talon Strike" (1 action), Breach (1 action).
- **Its frequency:** a charge's "Frequency once per turn" or "once per round" is kept as oncePerTurn (the simulator, as batch 70's charges already could; live play as before): 8 charges that had it in their text gain it.
- **Allies only moving closer:** an ability that lets its allies in range take a Step or a Stride, as long as they end up nearer to it → no-effect (moves only, as batch 73's).

## A Strike at a creature an ally just hit (2026-10-11, batch 94)

- **The reading:** batch 57's reaction Strikes with a new trigger, "A creature within Fayati's reach is hit by a melee Strike from one of her allies" (also "melee attack", "within melee reach", a name of several words) → { builtin: "reaction-strike", triggers: ["ally-hit"], strike: null } when the effect only Strikes ("makes|attempts a Strike against the triggering creature", "Strikes the triggering creature"). Not Falrok's or Delamar's, whose effects say more.
- **The simulator** (B114): after a melee hit, each of the attacker's allies in the struck creature's Melee with it uses its reaction Strike (its best melee Strike, B90's) at that creature.
- **Live play:** as one of its allies' melee Strikes hits a creature within its reach, the offer with its melee Strikes that reach.
- **Checked live in pftest** (PFTEST SIM B94 Fayati, a gang leader and a copy of Valeros; deleted afterwards): the leader's fist hit on Valeros → Fayati's Opportune Backstab offer with her Main-Gauche and Rapier.

## A flavour clause after the target; a range increment; traps that drop (2026-10-11, batch 95)

- **Strike activities:** "attempts a weapon Strike against a target, shouting threats and curses" (a clause that only tells it, with no numbers) and "makes an arquebus Strike against a creature within the weapon's first range increment" read as their Strikes; "On a success, the creature must succeed at a … save or be Stunned 1 (Stunned 2 on a critical failure)" as the hit's save.
- **Traps that drop** (the user's choice of 2026-10-11: hazards' cards where the text allows): "The stone slab deals 3d8 bludgeoning damage to anyone beneath or adjacent to the slab when it drops … A creature that succeeds at a @Check[reflex|dc:17] save takes no damage and rolls out of the way …" (or "takes half damage", "On a critical success, they take no damage and can choose the direction") → a Reflex save card: its damage rolled once, whole on a failure, half or none on a success, none on a critical success. What the GM needs after it (lifting the slab, its Hardness and HP) is left for the GM; where creatures are pushed or roll, a reminder. Not one that also Immobilizes or curses.

## A save succeeded on, or made successfully (2026-10-11, batch 96)

- **Wordings:** "Creatures within the chamber must succeed on a @Check[fortitude|dc:30] save or become Stupefied 1 (Stupefied 2 on a critical failure)" and "All living creatures in area B7 must make a successful @Check[will|dc:28] save or become Frightened 1 (Frightened 3 on a critical failure)" read as "must succeed at a … save or …": a save card (6 PF2e: a trap's gas, a haunt, a beetle's saliva rider, a thrown rock's damage, a fall Prone, a critical hit's Drained; 4 Battlezoo).

## The creature that dealt the triggering Strike; a Strike that deals damage (2026-10-11, batch 97)

- **Reactions:** "Trigger The hellcat is critically hit by any Strike. Effect … The creature that dealt the triggering Strike must succeed at a @Check[will|dc:37] save or become Frightened 2 (Frightened 4 on a critical failure)": the Strike named is the trigger's, not one of its own, so the save reads as the reaction's, on the attacker (the hit-by reaction card of batch 69). Its other ability recharging is left for the GM.
- **Strike activities:** "makes a ranged Strike. If the Strike deals damage, the target must succeed at a @Check[reflex|dc:26] saving throw or fall Prone": "deals damage" reads as a hit, and "ranged" means any of its ranged Strikes (live: the next ranged Strike it rolls; simulator: its first ranged Strike).

## Reactions that move it off (2026-10-11, batch 98)

- **Compiled** → `{ builtin: "withdraw", on, melee, enters, foe, move, feet, safe }`: "Trigger A creature misses the necrohusk with a melee Strike Effect The necrohusk Steps." (on "missed"), "… takes damage from a Strike Effect … Steps away from the source of the Strike." ("damaged"), "… is hit with a melee attack Effect … takes a step after the effects of the triggering attack are resolved." ("hit"), an attack with a melee weapon ("attacked"), and a foe ending its move beside it or coming beside it ("approach": Scurry, Slink, Skitter Away, Run Away!, Flinch Back, Flit Back; Opportune Step's only for a dazzled or blinded one). A Step, or a move that "doesn't trigger reactions", is safe; "It must end its movement in a location that isn't within 5 feet of a foe" is part of where it goes. Not one that drops what it holds, changes form, gains a bonus, or does more besides.
- **Live:** an offer card (the attack roll, PF2e's damage, or Foundry's movement path), "Use it: Step away"; using it marks its reaction used and says how far to move the token (where is the GM's).
- **Simulator:** it leaves the Melee it shares with the foe, while that foe still has actions to spend this turn (or it has a ranged Strike, or it's fleeing), and not while it holds a creature; a move that isn't safe is a Stride out of the Melee (its reactions).

## Reactions that follow a foe moving away (2026-10-11, batch 99)

- **Compiled** → `{ builtin: "follow", move, prey, strike }`: "Trigger An enemy within reach of the guard attempts to move away Effect The guard Strides up to their Speed, following the enemy and keeping the enemy in reach throughout its movement until the enemy stops moving or the guard moves their full Speed." and its kin ("A foe within Horba's reach …", "An adjacent foe moves away.", "keeps pace with the triggering foe" first, "Climbs or Strides", "Flies up to its fly Speed"; "the ochiastis's hunted prey" only; a Strike after when it ends in reach).
- **Live:** a foe that started in its reach and moved away gets a "Follow" offer (its Reactive Strike's offer too: the GM picks); using it says to move its token beside the creature, and its Strike to roll from the sheet where it has one.
- **Simulator:** after a Stride or Step out of its Melee (not a move that triggers no reactions), it Strides after the creature into its Melee when its Speed is at least the creature's and it holds no one; then its Strike, where it has one.

## A critical hit that recharges its breath; its own hit made critical (2026-10-11, batch 100)

- **Compiled** → `{ builtin: "crit-recharge", recharges, untilNatural }`: "Trigger The greater hell hound is critically hit by any Strike Effect The greater hell hound's Hellfire Breath recharges. They can immediately use it as part of this reaction." (Hellish Revenge) and "… It can't use this reaction again until it recharges Breathe Energy naturally." (Spitting Rage). `{ builtin: "crit-upgrade", perDay, ferocityRecharges, free }`: "Frequency once per day, and recharges when the great cyclops uses Ferocity. Trigger The great cyclops succeeds at an attack roll. Effect The attack becomes a critical success." (Flash of Brutality).
- **Live:** a critical hit on it (the attack roll) brings an offer, "Use it: recharge Hellfire Breath": its "Recharging" effect goes and the card says to use the ability now from its sheet (Spitting Rage's wait is a reminder). Its own attack roll that succeeds brings a free-action offer, "Use it: a critical hit": a use of its frequency, and the card says to roll the critical damage from the attack card.
- **Simulator:** the critical hit ends the recharge (of the ability, or of its ways) and it uses the ability at once, at the targets the planner likes best, when that's worth something; only the recharge when it isn't. Spitting Rage waits for the ability's own recharge to run out. Flash of Brutality turns its first hit into a critical hit, once a fight, again after its Ferocity.

## Ways from one of its heads (2026-10-11, batch 101)

- **Compiled:** "The mukradi breathes a blast of energy from one of its three heads; each creature in the area must attempt a @Check[reflex|dc:36|basic] save. The mukradi can't Breathe Energy again for 1d4 rounds." with its ways listed (Acid Maw, Flame Maw, Shock Maw) → `{ builtin: "modes" }` (one of the ways an ability is used in, batch 25's). When the save comes before the list, its recharge sentence moves after each way's words so the save and the way's damage read together; a way that starts with its area ("(fire) @Template[cone|distance:60] of fire dealing …") keeps its traits in front. The Aspect of Insects' Breath Weapon, which read as its first way only, now has all three.
- **Live:** the "which way?" card, a button for each, then that way's save card. **Simulator:** each way an ability of its own, sharing the recharge; Spitting Rage's recharge is the ways'.

## Strikes at every creature but those it holds; sweeps behind a requirement (2026-10-11, batch 102)

- **Compiled** (the sweep reader, batch 47's): "makes a spike Strike against each target within its reach" and "… each target within range" as each creature in its reach; "… a single pseudopod Strike against each target within range it hasn't already Grabbed" → `notGrabbed`; "Requirements The golem is uncontrollable Effect The golem makes a melee Strike against every creature in its reach, whether that creature is an ally or not." and "Requirements The bikkhasura is holding six spirit blades Effect … makes up to six spirit blade Strikes, each against a different target" → `requires: "requirement"` (a state the module doesn't play; allies too only behind such a requirement).
- **Live:** Flurry of Pods brings a GM note (not at the creatures it holds); the Strikes are rolled from the sheet. **Simulator:** not at the creatures it holds; a sweep with a requirement it can't check isn't planned.

## Reaction Strikes with more (2026-10-11, batch 103)

- **Compiled:** "Trigger A creature within reach of the frost drake's tail successfully damages the frost drake with a Strike Effect The frost drake attempts to Strike with their tail. If the Strike hits, it deals an additional 1d6 damage." → `triggers: ["damaged-adjacent"]`, `extraDamage`; "Trigger A creature within 10 feet damages the feathered bear's ally with a melee attack Effect The feathered bear immediately Steps toward the triggering attacker and makes a claws Strike." → `["ally-damaged"]`, `within`, `step`; "Trigger The marauder takes damage from a creature 20 feet or further away Effect The marauder makes a ranged spear Strike against the triggering creature. …" → `["damaged-far"]`, `from`, `ranged`.
- **Live** (PF2e's damage, the creature whose turn it is as the attacker): the tail Strike offer within its reach, with "add 1d6 damage" on a hit; the bear's offer when the attacker is no more than 10 feet away (the GM moves the bear first and checks it was a melee attack); the thrown spear's offer when the attacker is at least 20 feet away. A Strike named "claws" is the creature's "Claw".
- **Simulator:** the extra dice on its Strike; the bear, in the Melee of its ally or the attacker, Steps into the attacker's and Strikes; damage from a creature outside its Melee, its ranged spear back.

## Reaction Strikes at attackers and casters (2026-10-11, batch 104)

- **Compiled:** "Trigger A creature attacks the subject of bodyguard's defense Effect The bodyguard makes a Strike against the triggering creature." → `["ally-attacked"]`, `ward` (its charge: the GM checks); "Trigger An attacker the duelist can see targets them with a Strike or spell Requirements The duelist is holding a loaded firearm Effect The duelist makes a firearm Strike against the triggering creature. On a critical hit, they disrupt the triggering action." → `["targeted"]`, `strike: "firearm"`, `disrupts: "critical"`; "Trigger A creature within 10 feet of the mage killer Casts a Spell Effect The mage killer makes a melee Strike or thrown dagger Strike against the triggering creature. If it hits, the spell is disrupted." → `["cast"]`, `disrupts`; "Trigger The enigmatic conspiracist is targeted by a melee Strike or touch spell Effect … Demoralizes the creature that targeted them. …" → `["attacked"]`, `skill: "demoralize"`, `melee`.
- **Live:** Bodyguard's Reprisal's offer as its ally is attacked (with that note); Shoot First's as an attack or spell is aimed at it, with its firearms (a weapon of the firearm group, or a pistol, musket and the like), "before the triggering action"; Spell Interception's as a creature within 10 feet casts a spell (its spell card); Knowing Glance's Demoralize offer at a melee Strike only.
- **Simulator:** Shoot First before the Strike, a critical hit disrupting it; Spell Interception as a spell (not an ability) is cast in its Melee, a hit disrupting it; Knowing Glance's Demoralize at a melee Strike only.

## More reaction Strikes and maneuvers (2026-10-11, batch 105)

- **Compiled** (`readMoreReactionStrikes`): Clawed Feet ("… is Flying, and a creature moves into an adjacent square below it", and its older "If the gargoyle is flying …" wording; the kapoacinth's "is Swimming") → `["approach"]`, `while`; Quick Capture ("A creature hits or touches the flytrap … If it hits, the creature is Grabbed in that leaf.") → `["hit"]`, `grab`; Reflexive Grab ("leaves a square within … reach using a move action or attempts a melee Strike against …", a Grapple) → `["leave", "attacked"]`, `skill: "grapple"`, `melee`, `release`; Clutching Armor ("attempts to move away", a Grapple at its Athletics − 2) → `["leave"]`, `penalty`; Wrappings Lash ("uses an action to Strike or attempt a skill check", a critical hit disrupting) → `["strike", "skill"]`, `disrupts: "critical"`; Retaliating Strike ("takes damage from any source", the attacker when beside it) → `["damaged-by"]`; Deadly Cleave ("reduces a creature to 0 Hit Points with a halberd Strike … another halberd Strike against a different creature, using the same multiple attack penalty") → `["downs"]`, `sameMap`.
- **Live:** the gargoyle's offer as a creature comes beside it ("only while it's flying"); Quick Capture's with "If it hits, the creature is Grabbed"; Reflexive Grab's Grapple offer at a melee Strike on it (the weapon may be let go) and as a creature leaves its reach; Clutching Armor's Grapple (−2) as a creature leaves its reach; Wrappings Lash's at a Strike in its reach; Retaliating Strike's on any damage; Deadly Cleave's when PF2e's damage from its weapon downs a creature (the GM targets a different one).
- **Simulator:** the Grab on Quick Capture's hit; a move out of its Melee answered by a "leave" Grapple; Wrappings Lash's critical hit disrupts the Strike; Deadly Cleave's second Strike at another creature in its Melee once the action ends, at the downing Strike's penalty (and it counts).

## Guards and rescues (2026-10-11, batch 106)

- **Compiled** (`readGuardian`): "Trigger The toady's boss takes damage from an attack, and the toady is adjacent to them Effect The toady takes the damage instead, … This damage can't be reduced in any way." → `{ builtin: "intercept", ward: "boss", share: 1, unreduced }`; Mortal Shield (half the damage of a Strike or spell attack, its master) → `share: 0.5`; Interposition (a ward within its reach, a Strike's damage; or an ally within 15 feet, a Stride and a switch of places) → `ward`, `within`, `swap`. "Trigger An allied creature within 30 feet would be reduced to 0 Hit Points Effect … remains at 1 HP. …" → `{ builtin: "rescue", within, hp: 1, oncePerTarget }`; Soul Anchor (any creature within 60 feet; Doomed 2 and fast healing) → `doomed`, `fastHealing`; Recall the Fallen (an allied creature not construct or undead, its Hit Points back, once a day) → `heal`, `living`, `perDay`.
- **Live:** damage on a monster beside its guard (on the turn of a foe): "Use it: take 8 damage" — the ward's Hit Points back by that much, the damage on the guard (without its resistances for Human Shield); the GM checks the ward is its boss, master or ward. An NPC reduced to 0 HP near an ally with a rescue: "Use it: keep it up" — 1 HP or the Hit Points rolled, its unconscious and dying gone, Doomed where it says so, a use of its frequency spent.
- **Simulator:** the guard, in its ward's Melee (its highest-level ally for a boss, master or ward; any ally more hurt or about to drop for Interposition), takes a Strike's damage (all or half) in its place; an ally within the rescue's distance about to drop stays up — at 1 HP, or at the Hit Points rolled, prone and wounded 1 — once per creature or once a fight as it says.

## An ally's save helped (2026-10-12, batch 107)

- **Compiled** (`readAllySave`): "Trigger An ally within 60 feet fails a saving throw against an emotion or mental effect Effect The ally rerolls the saving throw, taking the better of the two results." (Hold Fast), "An ally within 10 feet of the dancer rolls a saving throw against a mental or illusion effect … can roll the save twice and take the better result." (Distracting Frolic), "Frequency once per hour Trigger The lucky courser or an ally within 10 feet fails a Reflex save, Acrobatics check, or Athletics check …" (Guide to Fortune: its own save too) → `{ builtin: "save-reroll", ally, self, within, save, against, uses }`; "An allied animal within 30 feet attempts a saving throw … a +1 circumstance bonus to the save" (Stay Strong!) and "An ally of the yamah's attempts a saving throw against an effect that has the mental trait … +4 status bonus … If the ally rolls a success, they get a critical success instead." (Free Mind) → `{ builtin: "save-bonus-reaction", ally, within, value, kind, against, animal, upgrade }`.
- **Live:** an ally's failed save (the effect's traits from the save's roll options) brings each helper's offer: "Reroll, keep the better" (PF2e's reroll on that save), or the bonus offer when it turns the failure around ("+4 to the save turns a failure into a success"; Free Mind's critical success noted).
- **Simulator:** the bonus first, as the save comes, when it changes the result (Free Mind's success a critical one); then, on a failure, an ally's reroll keeping the better, within its distance and against the effects it names.

## Strike activities that gain deadly or count twice; a swim and Strike (2026-10-12, batch 108)

- **Compiled:** "makes a rock ranged Strike that gains the deadly d10 trait. On a successful hit, the target also falls Prone." → its rock Strike, `deadly: 10`, Prone on a hit; "attempts a stone tool Strike while wedging the blow further with another tool. If it hits, the target takes an additional 3d10 damage of the same type as the Strike and is Enfeebled 2 for 1 hour or until the creature is fully healed. This counts as two attacks for … multiple attack penalty." → `3d10[strike]`, Enfeebled 2 (its healing the GM's), `countsAs: 2`; "… swims and attacks in one of two patterns. They either Swim twice and Strike at the end of their movement, or Swim once and Strike at any point during their movement." → a charge of two moves (the GM's choice live).
- **Live:** using a Strike activity whose Strike gains deadly or fatal, or counts as more attacks, brings a GM note saying so; its results follow its Strike as before.

## Requirements the module doesn't play; Strikes told another way (2026-10-12, batch 109)

- **Compiled:** a Strike activity whose requirement names a state the module doesn't track ("The dragon is burrowed", "The dragon is enraged", "is on the deck of a ship") → `requires: "requirement"` (not one that names damage); "It's the first round of combat" → `"first-round"`. "makes a blade Strike against an animal or humanoid. On a success, … ; if the skitterstitch dealt damage, it deals an additional 1d6 persistent bleed damage." → `targetTraits`, its bleed on a hit; "makes a melee Strike with its gaff. If it hits, it twists and yanks the gaff …, dealing 3d6 persistent bleed damage to the creature." → its gaff Strike, the bleed on a hit; "Requirements A creature is grabbed in the glabrezu's pincer. Effect The glabrezu pulls the grabbed creature up to 5 feet closer, then makes two claw Strikes against it. Those Strikes count as one attack …" → two claws at the creature it holds, one multiple attack penalty.
- **Live:** the GM uses it when its requirement is met, and the card follows the Strike as before; a GM note names the creatures it may target ("only at an animal or a humanoid").
- **Simulator:** a requirement it can't check isn't planned; the first-round one only in round 1; a Strike activity with target traits only at creatures with one of them.

## A Grab with its free hand; Prone and a bleed told as a wound (2026-10-12, batch 110)

- **Compiled:** "makes a melee Strike while keeping one hand free. If this Strike hits, the ruffian Grabs the target using their free hand. The creature remains Grabbed until the end of the ruffian's next turn or until it Escapes, whichever comes first." (and "makes a melee Strike with one hand. If it hits, they grab the target using their other hand.") → Grabbed on a hit, its requirement a free hand; "If it hits, it twists and yanks the gaff to knock the target Prone and create an awful wound, dealing 2d6 persistent bleed damage to the creature." → Prone and the bleed on a hit.
- **Live:** the card after its Strike applies Grabbed (or Prone and the persistent bleed); checked in pftest with the ruffian, the marsh giant and the skinstitch (Flay's note "only at an animal or a humanoid").

## Special attacks with a modifier of their own (2026-10-12, batch 121)

- **Compiled:** "If the sneak succeeds at an attack roll with a @Check[efficient-capture|against:ac]{+16} modifier against the target's AC, they apply the manacles." → a check `{ roll: "skill", statistic: "efficient-capture", against: { dc: "target", statistic: "ac" }, modifier: 16 }`; a hit applies PF2e's Effect: Manacles (also when no result is said: "They must succeed at an attack roll …"). "makes a ranged Strike (with a @Check[hurl-net|against:ac]{+10} modifier) … On a hit, the target is Off-Guard and takes a –10-foot circumstance penalty to its Speeds. On a critical hit, the creature is instead Restrained." → Off-Guard and an `all-speeds` penalty, Restrained on a critical hit; the attack trait for the multiple attack penalty. The cloaker's Envelop against the Reflex DC → Restrained; the sentences after the results (the net's Escape DC, the cloaker's shared damage) → the plan's notes. One whose results are all the GM's (Hat Toss's save against a listed hat) isn't compiled.
- **Live:** the card rolls PF2e's own special statistic (with its modifier) against the target's AC or DC and says "Hurl Net against the target's AC"; Apply gives the conditions, a penalty effect "−10 to Speeds", or Effect: Manacles, whose legs-or-wrists choice PF2e asks the GM as it's created. Checked in pftest with the bog strider, a Scarlet Triad thug and the cloaker.
- **Simulator:** the fixed modifier, less the actor's penalties and the multiple attack penalty, against the target's AC or DC.

## Reaction Strikes back in more words (2026-10-12, batch 122)

- **Compiled:** "A creature within Grandfather Mantis's reach is hit by an ally's melee attack" → `ally-hit`; "A creature within 10 feet makes a melee Strike against the plague giant" → `attacked`, melee; "A creature critically hits the mutant with a melee unarmed Strike or a non-reach melee Strike" → `critical-hit`; "An adjacent creature deals the gibbering mouther slashing damage" → `damaged-adjacent` with `damageTypes`; a hit by an adjacent creature's attack of named damage types → `hit` with `damageTypes`; "A creature damages Satinder Morne with a melee Strike" + "-2 penalty on the attack roll but … +2 bonus on the damage roll" → `damaged-adjacent`, `penalty`, `damageBonus`; "A creature within reach of Athervox's tail Casts a Spell" + "with a –2 penalty. If the Strike hits, Athervox disrupts the creature's action." → `cast`, penalty, disrupts; "A creature the leviathan louse had Grabbed or Restrained successfully Escapes" → `escaped`; "A creature ends a move action within reach of the carnotaurus's horn Strike" → `approach`.
- **Live:** the Strike offer as before, with notes for the damage types ("Only if it was slashing damage.") and the +2 damage; a successful Escape from its hold offers its Strike at the creature ("escaped its hold"); a cast answer at its penalty. Checked in pftest with the gibbering mouther and the leviathan louse.
- **Simulator:** a hit or damage answered only when the Strike deals a named type; a creature it held getting free answered with its Strike; the +2 on the Strike's damage.

## Multi-Strikes in more words (2026-10-12, batch 124)

- **Compiled:** "If his first attack hits, the target is Off-Guard to the second attack" → `secondOffGuard: "hit"`; "If it hits the same creature with both attacks, that creature is Grabbed until the end of the mantis's next turn" → `bothHit` Grabbed for a round; "A creature hit by both claw Strikes also takes 1d4 persistent fire damage" → `bothHit` damage; "ignoring the target's cover", "can't Grab as its next action after …", "can replace any of these Strikes with Demoralize or Step" → `notes`.
- **Live:** a GM line on use with the notes, and "if the first Strike hits, the target is off-guard against the second Strike"; checked in pftest with the myrucarx and Nishkiv.
- **Simulator:** as before (the off-guard after a first hit and the both-hit riders were already played).

## Strike activities in more words (2026-10-12, batch 127)

- **Compiled:** "On a hit, if the target is Off-Guard, the target must succeed at a … save or be Stunned 2" → `onHit.saveIf: "off-guard"`; "attempts a Strike with a falchion"; "makes a ranged Strike with the dagger with the range increment to 30 feet"; "On a hit, he inflicts an additional 2d6 bleed damage"; Grievous Cut's "In addition to the normal damage caused by the attack, the creature struck takes 4d6 bleed damage and becomes Wounded 1 (…)"; the critical hit's worse save, a weapon's magic lost → notes. "a Strike with a voidglass weapon" stays its best Strike.
- **Live:** the save card after the Strike hits says "Only if the target is off-guard."; checked in pftest with the Black Whale guard.
- **Simulator:** the save only when the target is off-guard (B130).

## A Grapple as a reaction to damage of a type (2026-10-12, batch 132)

- **Compiled:** Electric Reflexes ("takes electricity damage and a creature is adjacent to it … attempts an Athletics check to Grapple an adjacent creature. The creature also takes 3d6 electricity damage on a success, or 6d6 … on a critical success") → the Grapple basic action's plan with that damage on its successes, `trigger: { event: "damaged", reaction: true, damageTypes: ["electricity"] }`, `targeting.target: "an adjacent creature"`.
- **Live:** a reaction to damage on itself is offered only when the latest damage roll's types include one it names (slashing no longer offers Electric Reflexes); "Use it" posts the Grapple card on the attacker when it's beside it (otherwise the GM targets); checked in pftest with a flesh golem: a critical success dealt 6d6 electricity and Restrained the goblin.
- **Simulator:** "an adjacent creature" — the creature that set it off when it's in its Melee, else another foe there (B131).

## A teleport away; a failed Will save made a success at a cost (2026-10-12, batch 133)

- **Compiled:** Slip → `{ builtin: "withdraw", on: "approach", enters: true, move: "Teleport", feet: 30, safe: true }`; Gardener's Resolve → `{ builtin: "save-boost", failureOnly: true, save: "will", against: ["mental", "fear"], selfDamage: "3d8[mental]", notes }`.
- **Live:** Slip's offer reads "Teleport away" ("It teleports to a clear space beside another creature it can see within 30 feet: move its token") — the approach detection is batch 98's (token movement couldn't be exercised in pftest this time: every token update was refused in that world, cause unknown). Gardener's Resolve: offered on its own failed Will save carrying a mental or fear trait, with the damage and the mask as the GM's lines; not on a critical failure, another save or a fire effect; checked in pftest.
- **Simulator:** the boost only on a failure of that save against those traits, then 3d8 mental damage on itself (B132).

## A Burrow away on damage; a resistance with a teleport (2026-10-12, batch 136)

- **Compiled:** Crumble → `{ builtin: "withdraw", on: "damaged", hostile: true, while: "atop rock or earth", move: "Burrow", feet: 10, safe: true, recharge: "1d4" }`; Gnomish Shift → `{ builtin: "resist-damage", value: 2, on: null, types: null, shift: true }`.
- **Live:** Crumble's offer, on any damage while a foe has the turn, reads "Burrow away" with "Only damage from a hostile source, while atop rock or earth. It Burrows 10 feet down into the ground: move its token or mark it as burrowed. This movement doesn't trigger reactions. Not again for 1d4 rounds." (the GM declines it off rock or earth and keeps the recharge); Gnomish Shift's offer gives 2 HP back with "It then teleports to an adjacent space: move its token."; both checked in pftest (the bard back from 9 to 11 HP).
- **Simulator:** Crumble Burrows away from a Strike's damage, then not again for 1d4 rounds (B135); a spell's damage doesn't set it off there.

## Reaction Strikes on new triggers; provoked Trips that do more (2026-10-12, batch 137)

- **Compiled:** Tail Trip → `{ builtin: "reaction-strike", triggers: ["leave"], strike: "tail", only: "a creature carrying a metal item" }`; Punish Flight → `{ triggers: ["escape"], strike: "loathing garotte", noGrab: true }`; Sweeping Hook → `{ triggers: ["tripped"], strike: "ogre hook", using: "ogre hook" }`; Tail Whip → PF2e's Trip with the tail Strike's damage on its successes and the fall as a reminder; Kneecapper → PF2e's Trip rolled with Acrobatics, Prone on either success and nothing else, `trigger.sizes: ["medium"]`; Territorial Retaliation → PF2e's Trip with the difficult terrain as a reminder.
- **Live:** a creature leaving the rust monster's reach gets the Tail Trip offer with "Only at a creature carrying a metal item."; Kneecapper is offered when a Medium creature leaves its reach, not a Small one, and its card rolls Acrobatics against the Reflex DC (Prone applied); an Escape check against the siktempora offers Punish Flight ("As it tries: if this Strike stops it, ignore the Escape's result.") and its Strike carries a roll option that keeps the Improved Grab card from being posted; the ogre boss's Trip that succeeds offers Sweeping Hook ("Only if the Trip was made with its ogre hook."), a failed one doesn't. All checked in pftest (token moves were accepted again this time).
- **Simulator:** Kneecapper only at a Medium mover; Punish Flight's Strike before the Escape is rolled; Sweeping Hook after its own Trip succeeds (B136). The metal item and the weapon used aren't checked there.

## Guards that last until it moves; more multi-Strike wordings (2026-10-12, batch 138)

- **Compiled:** Cower → `{ builtin: "self-effect", model: { modifiers: [ac +4 circumstance, attack −2] }, stance: true, endsOnMove: true, duration: unlimited, notes }`; Entrench → the same with AC and Reflex +2 and its notes (immobilized by choice, can't be forcibly moved or tripped); Tentacle Stab → multi-strike with `noGrab` and notes; Rattling Spear → PF2e's Demoralize in a 30-foot emanation with `trigger.followUp: { strike: "longspear" }`.
- **Live:** Cower puts an effect on the pusk that turns on PF2e's own Cower toggle (AC 17 → 21, attack +10 → +8), with no end date and "It ends when it moves." for the GM; Tentacle Stab's note reads "These Strikes deal piercing damage instead of bludgeoning. It can't Grab with them: skip a Grab card after them."; both checked in pftest.
- **Simulator:** a stance with `endsOnMove` is removed when the creature Strides or Steps; a multi-strike with `noGrab` makes its Strikes without their Grab (B137).

## Strike activities and multi-Strikes in more words; a reaction to initiative with a skill (2026-10-12, batch 139)

- **Compiled:** Skewer → a Strike activity with +1 to hit and 1d6 bleed on damage; Big Swing → `onHit.push: 10, criticalPush: 20` and the collision as a note; Rapid Rake, Whirling Frenzy (`each`), Team Attack (`each`), Mangling Rend (`bothHit` with 2d6 and Off-Guard, the Speeds a note), Circling Attack (its flights a note) → multi-strike; Daunting Charisma → `trigger: { event: "initiative", skills: ["deception", "performance"], free }`.
- **Live:** the encounter starting offers Daunting Charisma with "Only if it rolled initiative with Deception or Performance."; "Use it" posts its Demoralize card; checked in pftest.
- **Simulator:** the initiative reaction is played as if it rolled with that skill (B138).

## What a Strike leaves on itself; Hit Points back on downing a foe (2026-10-12, batch 140)

- **Compiled:** Punishing Strike → a Strike activity with an extra weapon die, a 5-foot push and `selfAfter: [{ slug: "off-guard", until: "own-turn-start" }]`, counted as two attacks; Defensive Slam → `selfAfter: [{ ac: 2, type: "circumstance" }]` (PF2e's linked effect is the bonus); Hateful Tide → a sweep with `requires: "requirement"`; Ghost Dodge → `ac-reaction` with its notes; Absorb Sin → the self-heal with `trigger: { event: "downs", free, note }`.
- **Live:** the Strike activities' notes go to the GM when used ("It's Off-Guard until the start of its next turn.", "After the Strike, it gains a +2 circumstance bonus to AC until the start of its next turn."); Absorb Sin is offered as batch 52's downs reactions are, now with its note ("Only a creature it can smell with its true sin scent."). Not run in pftest: the only live change is that note on an existing offer.
- **Simulator:** the Off-Guard or the guard after the Strike, until its next turn, and the planner weighs it (B139); the self-heal when it downs a foe, only when it's hurt (B140).

## Maneuvers with more on a success; a Stride and a maneuver in fewer words (2026-10-12, batch 141)

- **Compiled:** Condemn → PF2e's Demoralize with Stunned 1 on a success and Stunned 2 on a critical success; Stampeding Shove → PF2e's Shove with `2d10[bludgeoning]` on a success and `2*2d10[bludgeoning]` on a critical success; Strangle → PF2e's Grapple at +2 with `(1d6+6)[bludgeoning]` on its successes; Into the Fray and Shielded Advance → `approach: { strides: 1 }` with their notes (Shielded Advance `requires: "requirement"`).
- **Live:** no new live code: their cards are the maneuver cards of batches 125 and 134, the notes on them.
- **Simulator:** the doubled formula ("2*2d10") resolves as twice the roll (B141).

## A damage type of its choosing; degrees listed in brackets (2026-10-12, batch 142)

- **Compiled:** Eye Beams → a basic Reflex save with one damage component (`2d6[cold]`) and `resolution.casterChoice: { kind: "damage-type", values: ["cold", "fire"] }`; Roar → its four degrees as sections (Frightened 1, 2, 3; nothing on a critical success) in a 100-foot emanation, with its immunity; Create Boulder → a rock Strike activity with its Reflex save against Prone.
- **Live:** a card whose plan has that damage-type choice shows "Damage type:" buttons (the first chosen at first; GM only) and, applied, "As fire damage" with the damage rolled as that type; checked in pftest (Eye Beams: fire picked, "2d6 fire" rolled).
- **Simulator:** PF2e's caster choice answered by the type that does the most to the targets after their weaknesses and resistances (B142).

## Champion reactions in a monster's words (2026-10-12, batch 143)

- **Compiled:** `{ builtin: "champion-reaction", slug, resistance, self?, dice?, selfDamage?, damage?, note? }` — Glimpse of Redemption and Liberating Step for an ally; Iron Command (`dice`), Selfish Shield (`resistance`) and Destructive Vengeance (`selfDamage`, `damage`) on itself.
- **Live:** an ally within 15 feet of the champion, hurt by a foe within 15 feet of it, brings the champion's offer: "Resist only" gives the resistance back as Hit Points, the note saying what the foe chooses (Glimpse) or what the ally gets (Liberating Step); the champion hurt itself by a foe within 15 feet: Selfish Shield "Use it: N HP back", Iron Command "Use it: command it to kneel" and Destructive Vengeance "Use it: take more, deal it back" with what to roll in the note. Checked in pftest (an aasimar redeemer's Glimpse gave 7 back, a Deskari champion's Selfish Shield 5; a first try offered self-only reactions to allies — fixed).
- **Simulator:** played as a champion's (B143): the resistance; Glimpse's choice as before; Iron Command's kneel or mental damage; Destructive Vengeance's extra damage on itself and the damage back.

## A riposte, shields raised together, a Reposition with more (2026-10-12, batch 144)

- **Compiled:** Opportune Riposte → `{ builtin: "reaction-strike", triggers: ["critical-miss"], note }`; Raise Shields → a self-effect (+2 AC and Reflex) until its next turn; Slither → a plain move; Right This Way → PF2e's Reposition with Clumsy 1 / 2 and notes; Trident of Dis → a Strike.
- **Live:** a reaction Strike's offer now carries its plan's note (Opportune Riposte: "Or it can Disarm the attacker of that weapon instead."); the rest use existing cards and effects. Not run in pftest: the only live change is that note.
- **Simulator:** nothing new: the critical-miss reaction Strike, the guard, the Reposition card's conditions are played as before.

## A maneuver, then a Strike at the same creature (2026-10-12, batch 146)

- **Compiled:** PF2e's Feint, Shove, Trip or Demoralize with `then` (the Strike after it) and notes; Slippery Fighter with `approach: { strides: 1 }`.
- **Live:** the maneuver's card, with "Then it Strikes at the same creature if this succeeds." (and the rest: the precision dice, the fatal trait, the Frightened bonus) as its note line; the GM rolls the Strike from the sheet. Checked in pftest (a noble's Noble's Ruse).
- **Simulator:** after the maneuver resolves, the Strike at the same creature (only on a success when it says so), at the same multiple attack penalty when it says so, the bully's Stride after a Shove that succeeds, the extra dice; the planner counts the Strike's expected damage (half of it when the maneuver must succeed) (B146).

## A Strike that shoves or knocks down; Strikes and buffs straight after a spell (2026-10-12, batch 147)

- **Compiled:** Brutish Shove and Improved Knockdown → Strike activities (push 5 / 10 and Off-Guard; Prone and 1d6 bludgeoning); Residual Force and Addling Strike → Strike activities with `requires: "after-cast"`; Primal Weapon → a free Strike buff with `requires: "after-cast"`, `nonCantrip`.
- **Live:** no new live code: the activities' riders and notes and the buff's effect (Primal Weapon turns on PF2e's own toggle) as before; the GM uses them when their requirement is met.
- **Simulator:** the engine records a spell it just cast; what needs it is planned only as its next action (not after a cantrip when it says non-cantrip) (B147).

## A Shove at a creature coming into reach (2026-10-12, batch 151)

- **Compiled:** Toss → `{ builtin: "reaction-strike", triggers: ["approach"], skill: "shove", note }`.
- **Live:** a creature moving from outside its reach to inside it brings the offer "Use it: Shove" (its maneuver card at the creature) with "It can't Stride after the creature."; checked in pftest with a long-horned bison and a goblin.
- **Simulator:** the approach reaction's basic action, as for its Strikes (B151); Shatter Defenses planned only at a frightened creature.

## A flurry's extra damage and critical rider, Strikes then Demoralize, Quickened after a resistance (2026-10-12, batch 152)

- **Compiled:** Fan of Daggers → a `multi-strike` with `critical: { conditions, damage }`; Hellfire Flurry → `extraDamage` and `flourish` (from the item's traits); Haunting Assault → `then: "demoralize"`; Overcharge → `resist-damage` with `quickened: "1d4"`; Determined Charge and Dive Bomb → charges of one Stride; Demon-Touched Weapon → a Strike buff after a non-cantrip spell; Ledorick's Dueling Riposte → a `reaction-strike` with `requires`; Disorienting Shot → a Strike activity with the Stride a note.
- **Live:** the extra damage as the Strike buff's effect until the end of its turn (Hellfire Flurry turns on PF2e's own `hellfire-flurry` switch, so its fist damage reads "+ 1d4 fire"); a critical rider waits for its next Strikes and posts a card only on a critical hit (Blinded and 2d10 persistent bleed on Apply); the Demoralize card at the GM's target with "After its Strikes."; Overcharge's offer says it also becomes Quickened, and Use adds "Overcharge (Quickened)" granting PF2e's Quickened for the rolled rounds. All four checked in pftest (a monastic bodyguard, Twisted Jack, a scarecrow, a synthetic khismar).
- **Simulator:** each Strike with the extra damage; each critical hit's rider; the Demoralize after the Strikes; a flurry with the flourish trait once a turn; Quickened for 1d4 rounds after the resistance (B152).

## No-damage Strikes that heal, a Strike for an ally, a mark for every hit, a weapon after a spell (2026-10-12, batch 153)

- **Compiled:** multi-Strikes with `strides`, `oncePerFight` and `"ranged"` Strikes; Strike activities with `noDamage`, `onHit.selfHeal` and `onHit.allyStrike`; Lawbringer → `hunt-prey` with `every`; Divine Weapon → a Strike buff after a spell (a free action or a reaction).
- **Live:** Draining Touch's card after its Strike: Drained 1 on the target and "Ulthadar regains 4 Hit Points" on Apply, with "It deals no damage" as its note; Lawbringer's note names the mark and every hit's 2d8 precision; Divine Weapon's effect adds 1d4 spirit to its Strikes until the end of its turn. Checked in pftest (Ulthadar, a corrupt shieldmarshal, a Chelaxian cleric). The ally's Strike after Shared Feast or Bonded Strike is a note.
- **Found:** live compiles didn't pass the creature to the compiler, so readings that need its sheet (its level, its Strikes) differed live — 830 PF2e abilities, 519 of them (Trample, Paralysis, Drain Life, Focus Gaze …) to nothing. Fixed next (below).
- **Simulator:** each of the above (B153).

## The creature in live compiles (2026-10-12)

- **Change:** `scripts/main.js` compiles every live ability, and the core registry's compile, with `actor: actorData(item.actor)` — the creature's source data, as PF2e's packs give it and as the offline compiles read it (`scripts/actor-data.js`: one copy per actor, dropped on `updateActor`, `updateToken`, `createItem`, `updateItem`, `deleteItem`). If a reading throws on the world's data, the item compiles without it, as before.
- **Effect:** 830 PF2e abilities now compile live as they do offline; 519 that compiled to nothing now work (Trample 116, Paralysis riding its Strike, Drain Life, Focus Gaze, Tongue Grab, Grabbing Trunk, Poison Weapon …); Engulf's size and Retributive Strike's resistance come from the creature.
- **Checked in pftest:** an elephant's Trample card (DC 24 basic Reflex, its foot Strike's 2d10+9; a critically failing goblin took 42), Beluthus's Drain Life card after its claw hit, the boggard's Tongue Grab, the living tar's Engulf and the bandersnatch's Focus Gaze compiled; changing the foot Strike's damage changed Trample's at once (the copy renewed); the core registry's plan for Trample too.

## A stay at 1 HP once per mask, another ability in a cone (2026-10-12, batch 154)

- **Compiled:** Exit Stage → `ferocity` with `hp: 1`, `wounded: false`, `uses` (the masks on its sheet) and a note; Change Characters and Abandon Body → healing on itself, their other words notes; Exhale Miasma → the creature's own Enfeebling Humors plan with this action's cone, cost and recharge; Tail Sweep, Mutually Assured, Watch over Evil → reaction Strikes (approach, damaged-adjacent, cast).
- **Live:** the ferocity offer now carries its plan's note ("It then teleports to an empty space within 30 feet: move its token. One of its masks stays behind, broken."); Stay at 1 HP left Taljjae at 1. Exhale Miasma posts its DC 20 Fortitude card for the creatures in the cone ("Only living creatures in the area."). Checked in pftest.
- **Simulator:** nothing new: ferocity's uses, area saves and reaction Strikes as before.

## While its rage lasts; a resistance that lashes back (2026-10-12, batch 155)

- **Compiled:** sweeps and multi-Strikes behind "is enraged" or "is raging" → `requires: "raging"` (a sweep after a Stride with `strides: 1`, `noMomentum`); a Strike buff behind it → `requires: "raging"`, unlimited (until its rage ends); `resist-damage` with `lashBack: { bonus }` and a note.
- **Live:** the resistance offer now carries its plan's note (the lash back, for the GM to roll); the rest as before (multi-Strike notes, the buff's effect). Not run in pftest: the only live change is that note line.
- **Simulator:** `isRaging` (a rage on itself that keeps it from concentrating) gates what needs it; the lash back rolls d20 + its modifier against the attacker's AC and deals what it resisted, of that type; Strikes marked `noMomentum` don't recharge its Breath Weapon (B155).

## Short wordings: a Strike then a Shove, Reactive Strike behind a state (2026-10-12, batch 156)

- **Compiled:** Strike activities with `afterStrike` (a basic action at the creature, hit or miss), `damageTimes`, more notes (a reach, the GM's armor rule), pushes by size; multi-Strikes with Strides along the way; maneuvers with Feint, a check `statistic` (Deception for a Grapple) or a fixed `modifier`; `reactive-strike` with `requires` and a `note`.
- **Live:** Battering Blow posts PF2e's Shove card at the GM's target ("After its Strike, hit or miss.") beside its notes; Grab Attention's card rolls Deception against Fortitude; Coiled Strike's offer as a creature leaves its reach says "The goblin snake can use this reaction only if it's Coiled." Checked in pftest.
- **Simulator:** the basic action after the Strike, hit or miss; damage multiplied for `damageTimes`; Reactive Strike behind a state not loaded (B156).

## A screech on the move, a Disarm behind a requirement, melee-or-ranged AC reactions (2026-10-12, batch 157)

- **Compiled:** Screeching Advance → the owlbear's own Bloodcurdling Screech plan with 2 actions and a note; Storm Strikes Twice → a multi-Strike with `sameMap`; skill reactions may now carry a requirement (`requires`, `note`); AC reactions from a FlatModifier rule gain `against` from their trigger.
- **Live:** no new live code: the save card, the multi-Strike notes, the skill and AC offers as before. Not run in pftest.
- **Simulator:** nothing new: the screech as an area save, the two Strikes, the AC reaction only against that kind of attack.

## A stance and a guard only in it; moves with AC reactions (2026-10-12, batch 158)

- **Compiled:** Mountain Stance → a stance self-effect (+4 status AC) with notes; a guard behind "is in X Stance" → `requiresEffect`; Spinning Shield → AC and Reflex until its next turn; AC reactions whose words move it keep those words as a note.
- **Live:** no new live code: the effects and the AC offers (with their notes) as before. Not run in pftest.
- **Simulator:** a self-effect with `requiresEffect` is planned only while its own effect of that name is on it (B158).

## A deadly mark (2026-10-12, batch 164)

- **Compiled:** Mark for Death → `hunt-prey` with `edge: "deadly"`, `die`, `strike` (or the executioners' precision edge).
- **Live:** the mark's note names it and says which Strikes gain deadly against it. Not run in pftest: a note line.
- **Simulator:** its Strikes (or the named ones) against its prey gain deadly of that die (B164).

## Attack of Opportunity for its allies (2026-10-12, batch 167)

- **Compiled:** Tactical Direction → `grant-aoo` with `within` (the emanation's feet), `trait` (whose allies) and `uuid` (PF2e's Attack of Opportunity).
- **Live:** each token of its disposition with that trait within that distance that lacks Attack of Opportunity or Reactive Strike gets an effect whose GrantItem adds PF2e's Attack of Opportunity; a GM note names them (or says none lacks it). PF2e times the effect a round from this turn, so the note says to remove it sooner if the ally's turn ends first; deleting the effect removes the reaction. Run in pftest: the wight 10 feet away gained it, the one 55 feet away didn't, a second use found none lacking it, and deleting the effect removed the reaction.
- **Simulator:** worth a little per ally of that trait near it without the reaction; each gains it until its own turn ends (B167).

## A skill check for a save (2026-10-12, batch 168)

- **Compiled:** Drowning Drone, Cautionary Tale, Focusing Drone → `save-skill` with `skill`, `save` (one kind of save), `against` (the effect's traits), `ally` and `within` (its allies' saves too), `allyTrait` (only allies of that trait benefit).
- **Live:** a failed save it covers (its own, or an ally's within that distance, of that trait, against those traits) brings an offer, "Use it: roll Performance". The button rolls PF2e's check against the save's DC and says whether its total beats the save's and what the save becomes, for the GM to apply. For an area effect, the note says the one check counts for each ally in the area. Like the other save reactions, it's offered after the roll, on a failure. Run in pftest: a boggard warrior's failed sonic Will save brought the swampseer's offer. A Performance roll that beat the save at the same degree said so. One that beat it at a better degree turned a critical failure into a success. With its reaction already used that round, there was no offer.
- **Simulator:** its reaction on the first save it covers. One d20 + its skill for that effect, that round, is kept for each such save where it beats the save's total (B168).

## A success instead of rolling (2026-10-12, batch 169)

- **Compiled:** Flash of Insight → `save-boost` with `toSuccess`, `uses: 1`, `free`, and a note that any other d20 roll is the GM's.
- **Live:** its failed save brings the boost offer as before, its button "Use it: a success", its note "The save becomes a success: apply that result instead." with the GM's other rolls; a use of its frequency spent. Not run in pftest: the offer's label and note on the boost offer that batches 53 and 65 ran.
- **Simulator:** its first failed save (a failure or a critical failure) becomes a success, once a fight, without its reaction (B169).

## Its allies' initiative (2026-10-12, batch 170)

- **Compiled:** Guide's Warning, Scout's Warning, Sentry's Warning, Warning Hoot → `initiative-warning` with `value`, `skills` and `free`, and a note for the guide's +2 after Scouting. Vare's version, written as a passive with no labels, compiles too.
- **Live:** as the encounter starts, its offer says to use it only if it rolled initiative with those skills, and only for the allies that can hear or see it. "Use it: +1 to its allies' initiative" adds the bonus to each rolled initiative of its disposition, since they have rolled by then; the turn order follows. Run in pftest: the guide's offer came up at the start, its two allies went from 15 to 16 and from 9 to 10, its reaction was marked used, and the turn stayed on the first creature.
- **Simulator:** unless it rolls Stealth for an ambush, its allies' initiative rolls get the bonus, which doesn't stack with another circumstance bonus. Its reaction is spent until its turn (B170).

## A missed Strike sent elsewhere (2026-10-12, batch 171)

- **Compiled:** Sidestep, Glide Aside, Deflective Dodge → `redirect-attack`, with `step` for Deflective Dodge's choice of a Step.
- **Live:** a Strike on it that fails or critically fails brings an offer, "Use it: redirect the attack", while another creature in the encounter is beside it. The note names those creatures and says the attacker rerolls the Strike's attack roll against the one it picks; Deflective Dodge's note adds the Step. Run in pftest: a missed Strike from one of two heroes beside the assassin brought the offer naming the other hero, and using it marked the reaction used. Tokens beside it but not in the encounter aren't named.
- **Simulator:** its reaction on that miss, while another of the attacker's side is in its melee. The attacker rerolls that Strike against that creature at the same multiple attack penalty (B171).

## More ways to move and Strike (2026-10-12, batch 172)

- **Compiled:** Tackle ("If it ends this movement in reach of a creature, it makes a fist Strike against that creature") → a Strike activity with its Strides; Horn Toss ("the target is flung 20 feet in a direction of its choice") → a push on a hit, with a note; Hopping Strike ("Leaps 15 feet … dealing an additional 1d6 bludgeoning damage") → a Stride and the damage on a hit; Ibis Dive (its descent) and Lurching Charge ("If it moves at least 20 feet from where it started, it gets a +2 circumstance bonus on the attack roll") → charges; Lurching Skewer → two Strikes at one creature after a Stride; the leopard's Pounce, its Hide part the GM's.
- **Live:** no new live code. They play as the charges, Strike activities and multi-Strikes did before. Not run in pftest.
- **Simulator:** nothing new: the same plans.

## Ranged Strike activities (2026-10-12, batch 173)

- **Compiled:** Hunting Throw ("within 60 feet without ranged penalties", a note; Prone on a hit; on a critical hit Prone and Immobilized), Guerrilla Tactics (its Strike, the draw after a note), Bounce Cruuk (its Strike, the return a note), Deadly Aim (its circumstance bonus to damage; "hasn't attempted a Strike during his turn yet" as `requires: "first-attack"`), Hunter's Aim (at its prey, a note, in either telling).
- **Live:** no new live code. Their Strike cards are as before. Not run in pftest.
- **Simulator:** nothing new: the Strike activities as before, Deadly Aim only as its first attack of a turn.

## Multi-Strikes and swipes in more words (2026-10-12, batch 174)

- **Compiled:** Ferocious Bites ("makes three Strikes with its jaws attack. Each Strike must be against a different opponent"), Branch Whip (its longer reach the GM's), the pirate skeleton's Focused Assault (a note: only with one creature in its reach), a skeletal giant's Broad Swipe (the horns' penalty left out) → multi-Strikes. Axe Swipe ("compares the roll to the AC of up to two foes that are in reach and adjacent", its +1 a note and a negative `penalty`), Double Chomp ("targeting two creatures adjacent to each other"), Ricochet (once a round; its 60 feet a note) → one roll against up to two foes. Heavy Swing → a Strike activity with its own damage and the bleed on a hit. The diabolic messenger's Hidden Blade (its full stop missing) also compiles. A "Frequency once per round" before a swipe is now kept, so the cyclops's Swipe is once a round.
- **Live:** no new live code. Their notes go to the GM as before. Not run in pftest.
- **Simulator:** nothing new. Axe Swipe's bonus plays as a negative penalty.

## Two Strikes with a Stride between; at its prey (2026-10-12, batch 175)

- **Compiled:** Dancing Blade and Guardbreaker ("makes a Strike against a creature, then Strides. … another Strike against it. If both Strikes succeed, …") → two Strikes at one creature, the same penalty, off-guard for a round after both hit, the Stride between a note; Hunter's Wound ("Prerequisites", "a reload of 0", "two ranged Strikes against their prey") → its two Strikes, the bleed after both, a prey note (Spirit Shot gains that note too); Fast Sweep → two Strikes at different creatures with its +1 (a note, a negative `penalty`). A both-hit condition "until the start of Rayhnne's next turn" (a name) now lasts a round.
- **Live:** no new live code. Not run in pftest.
- **Simulator:** nothing new.

## Reactive Strike until its own next turn (2026-10-12, batch 176)

- **Compiled:** Call to Arms → `grant-aoo` with `reaction: "Reactive Strike"`, `until: "source"`, `usedOnce`.
- **Live:** the grant-aoo effect as in batch 167, named for Reactive Strike. PF2e times it a round from this turn, which is exactly "until the end of its next turn". The GM note says so and that an ally that uses it is immune to it for 10 minutes. Not run in pftest: only names and note text differ from batch 167's run.
- **Simulator:** the grant ends at the end of the granter's next turn. An ally that makes the Attack of Opportunity is never granted it by that creature again (B176).

## A rune detonated on the attacker; creatures that come as it falls (2026-10-12, batch 177)

- **Compiled:** Retributive Rune → a reaction card when a creature within 15 feet damages it: an automatic hit at the attacker for the damage written in the creature's own Detonating Rune, with notes for its type (the dragon's current Shifting Rune, the GM's) and the archdragon's extra reaction. Final Spite's raised reinforcements and the cobbled bruiser's swarms are the GM's (`no-effect`), as summons are by the user's choice of 2026-10-11. The Menace Under Otari wight's unlabeled Final Spite → `death-strike`.
- **Live:** no new live code: the hit-by offer and its card at the attacker, as before. Not run in pftest.
- **Simulator:** nothing new. The card plays as an answer to being hit, and the death Strike as before (B177).

## Demoralize as it rolls initiative; allies within 10 feet (2026-10-12, batch 178)

- **Compiled:** Battle Cry ("Frequency once per day Trigger … rolls initiative Effect … attempts to Demoralize an observed foe") → PF2e's Demoralize as the fight starts. Warning Ears ("rolls initiative using Perception or Survival … granting allies within 10 feet a +2 circumstance bonus to initiative rolls") → `initiative-warning` with `within`.
- **Live:** Battle Cry's offer and card as the fight starts, as before. Warning Ears' offer names the distance, and its button adds the bonus only to allies of its disposition within that many feet. Not run in pftest: the distance filter on batch 170's offer, which was run.
- **Simulator:** Battle Cry plays as before. Warning Ears gives its bonus only to the allies in its melee (B178).

## Ways that cast a spell (2026-10-12, batch 179)

- **Compiled:** a way of a `modes` ability can be a `cast-spell` plan (Hilarious Exhalation's "This has the effect of Laughing Fit …", "This creates a 15-foot burst with the area effect of Grease …"). A sentence with an area before a casting becomes a note on any cast-spell plan, and so does the casting sentence when it has the area itself (Belch Smoke, Breath of Phantasms, Silkworm's Basket and Despairing Weep gained theirs).
- **Live:** the mode card shows such a way, and picking it turns the card into that spell's cast card at the ability's rank and DC. Run in pftest: a young mocking dragon's Hilarious Exhalation card offered both ways. Slippery Puddle became "Grease (rank 4, DC 26)" with its burst note, and casting it posted PF2e's Grease and started the recharge.
- **Simulator:** the in-Foundry snapshot reads each way that casts a spell as one of its abilities, sharing the recharge. In pftest the young dragon's Laughing Gas came in at rank 4, DC 26. Grease, which the engine can't cast, was left out (B179).

## Ways as paragraphs (2026-10-12, batch 180)

- **Compiled:** when a choose-a-way ability has no list but bold-named paragraphs one after another (with only rules between them), those paragraphs are its ways. The last way's degrees of success after them stay with it. Veksciralenix's Breath Weapon (Storm, and Time Displacement's stunned 1/4/6) and Saint Fang's Dragon Breath (Blade and Forge Breath, once read as one) are such abilities.
- **Live:** no new live code: the mode card as before. Not run in pftest.
- **Simulator:** nothing new: each way one of its abilities, sharing the recharge.

## An aura reroll with a floor (2026-10-12, batch 181)

- **Compiled:** a reaction for a creature in its aura that fails a save against certain kinds of effect (a Battlezoo dragon line's) → `save-reroll` with `ally`, `within` (the actor's Aura rule radius, 30 feet when none is there to read), `against` (the effect kinds), `keep: "new"` and `floor: "failure"`.
- **Live:** the ally reroll offer as in batch 107. It keeps the new roll, and a note says a critical failure on it is a failure instead. Not run in pftest: the keep and the note on that offer.
- **Simulator:** the ally reroll as before, a critical failure on it counted as a failure (B181).

## A shield for itself or an ally (2026-10-12, batch 182)

- **Compiled:** a Battlezoo dragon line's shielding reaction → `ally-ac-reaction` with `self`, `within` (its feet), `value` (its own shield's AC bonus, 2 when there's none to read) and a note.
- **Live:** batch 66's ally-guard offer now also comes when it is itself the target, carrying the plan's note. Not run in pftest: the self case on that offer.
- **Simulator:** the guard's +AC once a hit would land now covers itself as well (B182).

## An ally's Stride and Strike (2026-10-12, batch 183)

- **Compiled:** Word of Advice → `ally-advance` with `within`, `extraDamage`, the linked effect's `uuid` and `oncePerTurn`.
- **Live:** the linked PF2e effect goes on each ally of its disposition that the GM targets within that distance, and a GM note says the ally can Stride once and Strike once, adding the damage. With no target, the note says to target one. Run in pftest: a young vizier dragon's goblin student got "Effect: Word of Advice" (PF2e's damage dice), and the note named it.
- **Simulator:** once a turn, its best ally's best Strike at a foe in its reach or one Stride away, with the extra dice. It isn't that ally's turn, so there's no multiple attack penalty. It's worth the damage it does, as Strike Hard! is (B183).

## A rope swing behind a requirement (2026-10-12, batch 184)

- **Compiled:** Halyard Swing → a Strike activity with two Strides, its tentacle Strike and a note for the rope swing. Its requirement (a ship's deck) is `requires: "requirement"`. A Strike activity with Strides and no rider, but behind such a requirement and with a note, is now kept rather than left to the charge reader.
- **Live:** no new live code: the Strike activity's card and note. Not run in pftest.
- **Simulator:** nothing new; a plan behind a requirement isn't planned.

## Boarding a boat; a teleport before each Strike (2026-10-12, batch 185)

- **Compiled:** Boarding Action → a Strike activity with two Strides and the extra weapon die, `requires: "requirement"` (only after boarding or leaving a boat), and a note. Blinking Barrage → a multi-Strike at different creatures (up to four, or any number), at the same penalty, its teleports and its later teleportation limit as notes.
- **Live:** no new live code. Not run in pftest.
- **Simulator:** Boarding Action isn't planned (its requirement). Blinking Barrage plays as a multi-Strike at the creatures in its melee.

## At a helpless creature; a retreat; one with each weapon (2026-10-12, batch 186)

- **Compiled:** Ravage → a multi-Strike with `noMap`, at one creature, `requires: "helpless"`, its death trait and Body Thief as notes. Thrashing Retreat → two Strikes at different creatures, the Swim after a note. Graceful Double Slice ("one with each kukri, using her current multiple attack penalty") → its two Strikes at one creature, counted as one attack.
- **Live:** no new live code: the multi-Strike notes. Not run in pftest.
- **Simulator:** Ravage only at a Paralyzed, Restrained or Unconscious creature (B186); the others as before.

## A drawn weapon's Strike; a hit that grabs and pulls (2026-10-12, batch 187)

- **Compiled:** Swift Blow → a Strike activity, off-guard, with 2d8 bleed on a hit and a note for the draw. Attack from Above → its claw Strike (its reach a note), extra damage and Grabbed on a hit, and a note for the pull. Both are behind requirements the GM checks.
- **Live:** no new live code. Not run in pftest.
- **Simulator:** nothing new; they aren't planned (their requirements).

## A shape with a spell's effects (2026-10-12, batch 188)

- **Compiled:** "… otherwise uses the effects of" a linked spell is a cast-spell plan (a leshy's Change Shape, One with Plants).
- **Live:** no new live code: the cast card. Not run in pftest.
- **Simulator:** nothing new; a utility spell isn't cast.

## The GM's, by choice (2026-10-12)

- **Compiled:** `src/compiler/gm-fallback.js`, the last step of `compileMonsterAbility`. When no reading plays an action, reaction or free action, it compiles as `{ builtin: "no-effect", gm }` if one of these holds:
  - its requirement names a state the simulator can't see (`"state"`);
  - its words have no combat numbers and are out of combat or narrative, or it has the exploration or downtime trait (`"out-of-combat"`);
  - the creature comes from a PF2e bestiary that isn't a rulebook's (`"adventure"`). The pack is the tool's `pack` option, or the actor's `_stats.compendiumSource` (`flags.core.sourceId`, `sourceId`).
- **Live:** nothing changes in play: PF2e's own card, as for any `no-effect`. Run in pftest: Murschen, imported from the Abomination Vaults bestiary, kept its compendium source. His uncovered Red Ruin Stance compiled as the GM's (`adventure`), on the world actor and on an unlinked token's actor, while his Flurry of Blows stayed a multi-Strike.
- **Simulator:** these aren't played, and the in-Foundry snapshot and the bestiary tool still list them among what the simulation leaves out.

## An ability three times; more multi-Strikes (2026-10-12, batch 190)

- **Compiled:** "uses X three times. None of the bursts can overlap." → X's plan with this action's cost, its other areas a note (Bathygenic Barrage). Multi-Strikes with a move first: flying (Aerial Attack), jumping (Spring Forward, with a note for its Knockdown), striding (Quickening Jolt, a blog creature's). Dead Shot is two ranged Strikes at one creature, with notes for the range increment and the precision once; its requirement after its frequency is now read. Lightning Blade → a Strike at each creature in reach, with its penalty, extra damage and "counts as two", one roll a note. Towering Bite → its jaws Strike with a reach note, Grabbed and a pull note on a hit. Masterful Engagement → its Strike with a Step note.
- **Live:** no new live code. Not run in pftest.
- **Simulator:** nothing new.

## A redirect as it's targeted; a move as a creature closes (2026-10-12, batch 191)

- **Compiled:** Hop-Dodge → `redirect-attack` with `when: "targeted"`, `melee` and a note for its Stride. Skittering Reposition → `withdraw` as a creature comes into its reach ("moves 10 feet. This does not trigger reactions."). Bark Orders and Encircling Command → `no-effect`, only allies' Steps. Shadow Chain → its Strike, with notes for its 60-foot reach and the teleport on a failed save. Lunging Strike → a plain Strike (its reach and Capturing Grab after are the GM's).
- **Live:** for `when: "targeted"`, batch 171's redirect offer comes on any melee Strike at it, while a creature in the encounter is beside it. It says the Strike goes to that creature instead, so the attacker rolls it against that one and its first result doesn't count. Not run in pftest: a second wording on batch 171's offer.
- **Simulator:** before the roll, its reaction sends the melee Strike at another of the attacker's side in both their melees, at the same penalty (B191).

## A Strike after a teleport; Hit Points with no type (2026-10-12, batch 192)

- **Compiled:**
  - Dimensional Ambush → a melee Strike with three additional weapon damage dice, counting as two attacks, with a note for its Translocate first.
  - Extend Mandibles → its mandibles Strike, with a note for the 10-foot reach without agile.
  - Exemplar of Violence → a Strike with `onHit.allyStrike`, with a note for its allies' Step or Stride.
  - Draw Bugs → healing on itself, from "regain @Damage[10] HP" with no type; its "At the GM's discretion" sentence is a note.
  - Aquatic Drag → `no-effect`: it only moves, carrying what it holds.
- **Live:** no new live code. Not run in pftest.
- **Simulator:** nothing new.

## A spell attack rolled twice; resistance to spells by rank (2026-10-12, batch 193)

- **Compiled:**
  - Ray Displacement → `attack-misfortune` with `spell: true, ranged: true`.
  - Divert Essence → `resist-damage` with `value: "rank"`, `spell: true`, `types: ["spells"]`, `lasts: 1` and `until: "turn-start"`.
- **Live:**
  - A spell attack roll that hits a monster with Ray Displacement brings an offer that rerolls it, keeping the lower roll (PF2e's reroll from the message). Only a ranged one counts: the roll's "item:ranged" option. PF2e 8.5 types a spell's attack roll "attack-roll", with the option "item:type:spell", and the module reads both that and "spell-attack-roll" (found live; the first version waited for "spell-attack-roll" alone).
  - A spell aimed at a monster with Divert Essence (its spell attack roll, or the monster's save against a spell that isn't an area's) brings a resist offer. Use puts PF2e's resistance to spells, equal to the spell's rank, on the monster until the start of its next turn. The rank is read from the message: the cast rank, its "item:rank" option, or the spell's own. Without a rank, the note asks the GM to set it.
  - Strike misfortune and damage resistance offers leave these spell variants out.
  - The offer buttons say "Use it: resistance N to spells".
  - **Live-checked in pftest (2026-10-12):**
    - An adult sage dragon's Will save against Ezren's Fear brought "Resistance 1 (the spell's rank)", read from the message's cast rank. Use put PF2e's resistance 1 to spells on it, ending at the start of its turn.
    - Ezren's Telekinetic Projectile hit an ancient barrage dragon. Use rerolled it keeping the lower, as a new reroll message, and brought no second offer.
- **Simulator:** see B193 in its ability decisions.

## Another ability with a push; a Dirty Trick after a tail Strike (2026-10-12, batch 194)

- **Compiled:**
  - Pushing Pulse → Force Pulse's plan at two actions, with a push on a failure (the archdragon's: 15 feet, or 30 feet when the save is critically failed). Force Pulse's further pulses for more actions are a note.
  - Vex → a follow-up to a successful tail Strike: PF2e's Dirty Trick (a Thievery check against the Reflex DC; Clumsy 1, or Prone itself on a critical failure), with `map: false`.
  - Improved Vex → the same as a free action (`time: "free"`, `trigger.cost: "free"`). A free action's follow-up is read only when no other reading has it, so Strike riders stay riders.
- **Live:** no new code. They are cards, as other follow-ups and save abilities are. Not run in pftest.
- **Simulator:** a free follow-up is used at once after the hit (B194).

## A creature brought back; a foe's healing at its least (2026-10-12, batch 195)

- **Compiled:**
  - Reawaken! → `rescue` with `onDeath`, `sees` (any it can see), `oncePerTarget` and `living`, in three forms:
    - `hp: "half"` (ancient and archdragons);
    - `hp: 0, dying: 1` (young: "returned to life with the Dying 1 condition at the start of its next turn");
    - `hp: 0, stable: true` (adult: "stabilized at 0 HP").
  - Siphon Life → `heal-siphon` with `within`, `tempHp` (its dice by age) and `tempRounds`. "rolls" or "results in" the minimum amount.
- **Live:**
  - A monster ally of the dragon dropping to 0 HP brings "Use it: bring it back", at any distance. Use sets its Hit Points (half, or 0 with Dying 1, or 0 stable and unconscious), takes off dead and defeated, and says where it is. The note says only a willing creature, and each creature once (the GM keeps to that).
  - A foe's spell cast with the healing trait within its distance brings "Use it: the healing at its least". The note says each die is 1 and flat values are halved, for the GM to apply. Use rolls its temporary Hit Points and gives them to it when they are more than it has; their 1 round is the GM's.
  - **Live-checked in pftest (2026-10-12):**
    - A goblin warrior dropped to 0 HP beside an ancient resurrection dragon. Use brought it back at 3 of its 6 HP, not dead or defeated.
    - Seelah's Lay on Hands card, posted near it, brought the Siphon Life offer. Use rolled 3d8 (16) and gave it 16 temporary HP. In the same round, with its reaction already spent on Reawaken!, it had brought no offer, as it should.
- **Simulator:** see B195 in its ability decisions.

## Resistance on itself; a condition unless it saves (2026-10-12, batch 196)

- **Compiled:**
  - Self-buffs with resistance → `self-effect` with `model.resistances` (`{ type, value, exceptions }`):
    - Reef Armor: with `tempHp` and `endsWithTempHp`, for 1 minute;
    - Shifting Form: all damage except force, void and ghost touch, to the end of its next turn, with a note that it's incorporeal;
    - Harden Chitin: a stance ending when it moves;
    - Osseous Defense: a stance; its Strike lines after the text are PF2e's own, on its sheet.
  - Gales of Laughter → a Will save: on a failure, Deafened for 1 round and the persistent damage. "Deafening it … and causing … damage unless it succeeds" is read as "becomes Deafened … and takes … damage".
  - Dying Wish → `no-effect`: back at 1 HP miles away, out of the fight as Mist Escape is.
  - Haul Away and a giant ant's carry → `no-effect`: a move with what it holds.
  - Ink Cloud → `{ builtin: "no-effect", gm: "state" }`: "no effect outside water" is where it is, which the simulator can't see.
- **Live:** Use puts an effect on the monster with PF2e's Resistance rules (exceptions kept) and a TempHP rule, for the plan's time. The effect's text says what it gives and when it ends. An ability with its own PF2e switch (Osseous Defense, Harden Chitin, Shifting Form) gets an effect that turns the switch on instead.
  - **Live-checked in pftest (2026-10-12):**
    - An ancient coral dragon's Reef Armor gave it resistance 10 to piercing and slashing and 50 temporary HP, for 1 minute.
    - A zecui's Harden Chitin and a joseung saja's Shifting Form turned on their PF2e switches. They had resistance 5 to all damage except mental and spirit, and 10 except force, void and ghost touch.
- **Simulator:** see B196 in its ability decisions.

## Multi-Strikes on the move; a Strike as it grabs (2026-10-12, batch 197)

- **Compiled:**
  - Unstoppable Charge → a multi-Strike with two claws and a jaws Strike at different creatures, after two Strides.
  - Claw Storm → four claw Strikes at different creatures after a Stride, with extra electricity damage and the same multiple attack penalty; its other sentences are notes.
  - Flurry of Strands → six strand Strikes at different creatures, with a note for those Immobilizing.
  - Ravenous Embrace → four arm Strikes; the beak Strike after is a note.
  - Deadly Mandibles → `reaction-strike` with trigger `grabs`, and a note for the pull.
- **Live:** when a monster's card grabs a creature and the monster has Deadly Mandibles, the GM gets a note: its mandibles Strike at that creature, to roll from its sheet. The multi-Strikes are cards as before.
  - **Live-checked in pftest (2026-10-12):** a giant mantis's leg hit Valeros and its Grab card critically succeeded. Apply made him Restrained and whispered the GM "Deadly Mandibles (its reaction): … its mandibles Strike at Valeros".
- **Simulator:** see B197 in its ability decisions.

## Both hits with an affliction; Strikes at the creature it holds (2026-10-12, batch 198)

- **Compiled:**
  - Gory Rend → its two claws at the same creature; `bothHit` with the bleed and `affliction: "piscovenom"`.
  - Tooth Grind → its jaws Strike at the creature it holds (`requires: "grabbed"`): bleed and Wounded 1 on a hit, Wounded 2 on a critical hit. Notes cover its bludgeoning damage, the wounded increase, and the healing when the creature dies.
  - Toxic Bite → its beak Strike at the creature it holds, with a note that the venom gains the virulent trait.
  - Gnaw Metal → its jaws Strike at the creature it holds: Prone if Medium or smaller, with notes for the broken armor and the bleed after.
  - Isolating Lash → a melee Strike with one extra weapon die and its own Off-Guard until its next turn. The Will save on a hit and its results are notes for the GM.
- **Live:** Gory Rend's note to the GM now names the affliction ("it is exposed to piscovenom (its card from the sheet)"). The rest are cards and notes as before. Not run in pftest.
- **Simulator:** see B198 in its ability decisions.

## A Stride and a Strike as it rolls initiative (2026-10-12, batch 199)

- **Compiled:** Uncanny Pounce → a Strike activity with `actions: 0`, one Stride, its claw (or jaws) and `initiative: true`, with a note naming the Lore it rolls.
- **Live:** as the encounter starts, a siktempora in it brings a free Strike offer with its named Strike. The note names the Lore it rolls for initiative and says it Strides once, before or after the Strike.
  - **Live-checked in pftest (2026-10-12):** a misery siktempora's encounter start brought the offer with its Claw button. A love siktempora brought none: PF2e gives it no claw Strike, only Emotional Bolt, and the simulator also skips it.
- **Simulator:** see B199 in its ability decisions.

## NPC Core Strikes and moves (2026-10-12, batch 200)

- **Compiled:**
  - Staff Swipe → a sweep at each enemy, with a note for the 15-foot cone.
  - Power Through → three melee Strikes at different creatures with the same multiple attack penalty, `requires: "not-fatigued"`, then Fatigued (`until: "save"`), with a note for its Fortitude save at each turn's start.
  - Swinging Strike → two Strides and a melee Strike, behind its rope or trapeze (`requires: "requirement"`).
  - Flying Attack → a Stride and a Strike, played as PF2e's own (`strikeOnly`).
  - Reshape the Battle and Reel In → their Strikes, with notes for the Reposition and the 30-foot pull.
  - Scurry and Stealthy Pad → `no-effect` (a move and hiding).
  - Fence's Feint → PF2e's Feint, with notes for the Step and the longer Off-Guard.
  - Local Poison → 2 persistent poison on its dagger Strikes until the end of its turn.
- **Live:** cards, offers and buffs as for their kinds before. Not run in pftest.
- **Simulator:** see B200 in its ability decisions.

## NPC Core Strike riders, a guard and moves (2026-10-12, batch 201)

- **Compiled:**
  - Head Shot → a Strike: Dazzled until the end of its next turn on a hit, Blinded on a critical hit instead. Its Create a Diversion first is PF2e's, on the sheet.
  - Disrupt Qi → an unarmed Strike: on a hit, 3d6 persistent void and Enfeebled 2, with notes for a living target and the Enfeebled lasting with the damage.
  - Wrangling Whip → a whip Strike that knocks Prone on a hit, the simulator's pick; the 5-foot pull instead and the mount's free Strike are notes.
  - Full Bore → two arquebus Strikes at different creatures, counting as two attacks, with a note for the two being side by side and the damage rolled once.
  - Shields Up! → +2 AC and Reflex until its next turn, with a note for +3 against physical ranged attacks.
  - Daredevil Strike → played as a Stride and a Strike (`strikeOnly`); its Step after is the GM's.
  - Will Not Falter → a Stride and a Strike; the allies' bonus is PF2e's linked effect.
  - Beat a Retreat → `safe-move`.
  - Chasm Crossing → `no-effect` (a move).
- **Live:** cards and buffs as before. Not run in pftest.
- **Simulator:** nothing new.

## An ally's reaction Strike; a Strike then a maneuver (2026-10-12, batch 202)

- **Compiled:**
  - Kingpin's Command → `ally-advance` with `reaction`, `oncePerAlly` and no extra damage.
  - Fencing Brawl → a rapier Strike with `afterStrike: "grapple"`, with a note for the Disarm instead and the one attack.
  - Juggling Bounce → two Strikes at different creatures, the second only after a hit, at the same penalty.
  - Musketeer's Advance → its flintlock musket Strike, with notes for the Off-Guard on a hit and the swap and Stride after.
- **Live:** the GM's ally-advance note says the ally can Stride and Strike as its reaction, and that each ally gets it once a day. With no extra damage, the note leaves the damage out. Not run in pftest.
- **Simulator:** see B202 in its ability decisions.

## Mixed multi-Strikes, a weapon that flies off, a Strike then a Stride (2026-10-12, batch 203)

- **Compiled:**
  - Sixfold Flurry → six Strikes (two longsword, four fist) at different creatures with the same multiple attack penalty; the AC for Strikes not taken is a note (PF2e's linked effect).
  - Unleash Weapon → two morningstar Strikes at different creatures, with notes for the 20-foot range and the return.
  - Gouging Lunge → a thumb spike Strike with 1d8 slashing on a hit, counting as two attacks, with a note for the 15-foot Stride after.
  - Surge of Speed, Take Prisoner and Scuttle Away → `no-effect` (moves).
  - "a number of jaws Strikes up to their number of heads" reads the creature's heads when one of its abilities states them ("has nine heads"). The jotund troll's own sheet doesn't, so its Ravenous Jaws stays uncovered.
- **Live:** cards and notes as before. Not run in pftest.
- **Simulator:** nothing new.

## A cast by another verb; Strikes on the move and from a jump; a ward's guard (2026-10-12, batch 204)

- **Compiled:**
  - Wail → `cast-spell` of Wails of the Damned at DC 38 ("unleashes a soul-chilling Wails of the Damned"); its overcoming silence and lingering for a round are notes. Unlabelled inline rolls in a cast's notes now read as their formulas.
  - Skittering Assault → three leg Strikes at different creatures after three Strides, one Strike per Stride, with the same multiple attack penalty.
  - Spike Volley → two spike Strikes at different creatures counted as one attack; the single-creature pin and the 12 spikes a day are notes.
  - The bulette's Leaping Charge → a jump and two claw Strikes at the same creature, with a note that the second needs a long enough jump.
  - The narwhal's Impaling Charge → two Swims and a tusk Strike: 1d10 more on a hit and Grabbed until its next turn starts, with notes for the 20 feet and the Escape DC.
  - Water Sprint → three Strides and a Strike, behind the smooth water (`requires: "requirement"`).
  - Hurl Weapon → a plain Strike (`strikeOnly`).
  - Retaliate → `reaction-strike` when its ward is attacked within its reach (`ally-attacked`, `ward`).
- **Live:** cards and offers as for their kinds. Not run in pftest.
- **Simulator:** nothing new.

## Healing as it kills; Quickened as its turn begins (2026-10-12, batch 205)

- **Compiled:**
  - Lifedrinker → healing on itself with trigger `downs`, free, with a note that only a living creature it kills at level 15 or above counts.
  - Quicken → Quickened for 1 minute as its turn begins, free, with a note that it can't use it on its first turn of the combat.
  - Reposition and Limb Extension → `no-effect` (moving the creature it hit, a longer reach).
- **Live:** the downs-heal and turn-start offers, as for batches 140 and 72. Not run in pftest.
- **Simulator:** nothing new; the level and the first turn are notes.

## Charges, a sting, flights and a retreat (2026-10-12, batch 206)

- **Compiled:**
  - Goring Charge → two Strides and an antlers Strike, 2d12 bludgeoning on a hit, with notes for the Strike after either Stride and the save penalty.
  - Scorpion Sting → a stinger Strike with `requires: "off-guard"`, 4d8 poison on a hit, and a note for the save penalty.
  - Razor-Edged Flight → two flights and two wing Strikes at different creatures, 2d6 persistent bleed on a critical hit.
  - Paired Spikes → two spike Strikes at different creatures counted as one attack; the one-creature way and its electricity weakness are notes (PF2e's linked effect).
  - Panicked Withdrawal → `withdraw` when damaged by a melee Strike, 15 feet, with a note that it drops what it holds.
  - Stone Bolt and Phantom Step → `no-effect` (moves).
- **Live:** cards and offers as for their kinds. Not run in pftest.
- **Simulator:** see B206 in its ability decisions.

## A guard after a Strike; a bite that heals; a retort that frightens (2026-10-12, batch 207)

- **Compiled:**
  - Parry Dance → a melee Strike, then +2 circumstance AC on itself (`selfAfter`), with a note for the Step.
  - Devour Flesh → a jaws Strike at the creature it holds: on a hit `onHit.selfHeal: "3d6"` and Drained 1 (Drained 2 on a critical hit); releasing the creature and once an hour are notes.
  - Leap into the Fray → a claw, a jaws and a tail Strike after a Leap; its Mythic Point a note.
  - Repartee Riposte → `reaction-strike` on a critical miss, with `onHit` conditions (Frightened 1, Frightened 2 on a critical hit) and a note saying so.
  - Divine Guardian → `intercept` of an ally's attack, with a note that the attack is aimed at it, against its AC.
  - Sudden Surge → Quickened this turn as its turn begins, with its 1d4-round recharge (`trigger.recharge`); its first Strike's Off-Guard is a note.
- **Live:** the offers and cards as before. The retort's note says what it inflicts. Not run in pftest.
- **Simulator:** see B207 in its ability decisions.

## A coil, a pursuit, a tail Strike, a lucky save (2026-10-12, batch 208)

- **Compiled:**
  - Defensive Coil → `self-effect` with resistance 20 to physical damage until its next turn starts, with a note that it's against attacks only.
  - Deadly Pursuit → `follow` with `strike` (its jaws Strike when it ends in reach).
  - Viper Tail → `reaction-strike` on a creature leaving a square near it ("whips around and attempts a tail Strike").
  - Good Fortune → `save-reroll` for itself or an ally within 30 feet, once a fight, with a note that it's rolled twice before the roll. The simulator plays it as a reroll of a failed save, which gives the same chances.
  - Determined Trudge → `no-effect` (a move).
- **Live:** offers and buffs as for their kinds. Not run in pftest.
- **Simulator:** nothing new.

## Battlezoo guards, a healing split, and two states (2026-10-12, batch 209)

Four Battlezoo dragon abilities, eight copies each; their own words stay out of this repository.

- **Compiled:**
  - A guard of whoever it's sworn to protect → `reaction-strike` with `ally-attacked`, `ward` and `melee`. Its note says it can give that creature +2 AC against the Strike instead.
  - A share of a vitality healing aimed at a creature near it → `heal-siphon` with `share: 0.5` and `tempRounds: 10`.
  - Two abilities whose requirement the simulator can't see → `{ builtin: "no-effect", gm: "state" }`: a story it spun that day, and standing beside the corpse of a creature it killed. The second wording also moves two PF2e corpse-eaters to the GM's state category.
- **Live:**
  - The siphon offer for the split says the creature gets half and the monster the rest as temporary Hit Points, gone after a minute, for the GM to apply.
  - Its button reads "Use it: split the healing", and Use rolls nothing.
  - Not run in pftest.
- **Simulator:** see B209 in its ability decisions.

## A teleport and a Strike (2026-10-12, batch 210)

- **Compiled:** a Battlezoo dragon's teleporting charge (four copies; its own words stay out of this repository) → a Strike activity with one move (the teleport, a note), its horn Strike, extra piercing damage on a hit, and a note for the save penalty it adds. "The Strike deals an additional NdM type damage." is now read as damage on a hit.
- **Live:** a card as for Strike activities. Not run in pftest.
- **Simulator:** nothing new.

## More states the simulator can't see (2026-10-12, batch 211)

- **Compiled:** more requirement wordings are now unseen states, giving `{ builtin: "no-effect", gm: "state" }` once every reading has failed:
  - something it holds, stores or carries (not a weapon it Strikes with): an instrument, a lantern, a soul gem, a stored potion, water in a tank, a breath held;
  - a named mode, form, posture or stance of its own; something it's merged with, possesses, rides or partners;
  - where it stands: a desert, cold water, a treetop, lava, magical darkness, another plane, hanging from a rope, flying high above;
  - things around it: a corpse, metal, a book;
  - what it senses: speech, a spell's words, a hiding or undetected creature.
- **Numbers:** 92 new in PF2e and 65 in Battlezoo; 59 PF2e abilities that were already the GM's as adventure creatures' (and one Battlezoo one, as out of combat) now say `"state"`.
- **Test flip:** one batch-88 case, a reaction behind a defensive mode of its own, was `null` and is now the GM's.
- **Still the simulator's:** a Grabbed creature, its last action, its Hit Points and conditions.
- **Live:** the GM's card, as for every `no-effect`. Not run in pftest.
- **Simulator:** nothing new; these abilities play no part.

## Sweeps, Strides with Strikes, disguises (2026-10-12, batch 212)

- **Compiled** (21 Battlezoo abilities; their own words stay out of this repository):
  - **A Strike at every creature in reach:** attacks (not "Strikes") at every creature it can reach; a penalty that rises only once all are made, in two more wordings.
  - **That many Strikes, each at a different creature:**
    - never the same creature twice;
    - one Strike aimed at up to three separate creatures;
    - each shot at its own target;
    - three tongue Strikes at separate targets, counted as one attack.
  - **A move with Strikes along it (`strides`, a note):**
    - a Fly Striking creatures beside its path;
    - a charge in a straight line Striking each foe it passes;
    - a Stride with up to two Strikes during it, each at a different creature (a critical miss ends it, a note);
    - a Stride up to its Speed, with up to three Strikes on the way.
    - Two PF2e Strides with two Strikes during them now count the Stride.
  - **Three Strikes split among up to three creatures:** three Strikes at whichever it likes.
  - **Strikes, then a Step:** a note.
  - **Two or more of three bites hitting the same creature:** it's Frightened 1 (`bothHit: { …, atLeast: 2 }`).
  - **Disguises:**
    - a lead-in sentence before the disguise;
    - the automatic Deception result in the disguise's own sentence: while flattened, while prone, or until it next acts;
    - a Bulk of goods it can slip into.
    - Not when it also lets go of a creature it holds.
- **Live:** cards as for multi-Strikes. The GM's whisper now says "if 2 or more of its Strikes hit the same creature" for `atLeast`. Not run in pftest.
- **Simulator:** `bothHit.atLeast` gives the rider once at least that many Strikes hit the creature (B212). It's logged as "2 Strikes hit …".

## Sweeps in a line, damage on a miss, Frightened per hit, reach and Speeds (2026-10-12, batch 213)

- **Compiled:**
  - **Spearing Tail** → a sweep over "each creature in a @Template[line|distance:20]", with one attack roll for all of them (a note):
    - "Any creature hit takes 4d6 bleed (2× on a critical hit)" → `extraDamage: ["4d6[persistent,bleed]"]`;
    - "This counts as two attacks for … multiple attack penalty" → `countsAs: 2`.
    - Gaze Upon's "every creature in a cone" reads the same, but its recharge keeps it uncovered.
  - **Hundred-Handed Whirlwind** → a sweep at each foe in reach. "Even on a failed attack (but not a critical failure), the titan deals 24 force damage" → `missDamage: ["24[force]"]`; it counts as three attacks.
  - "This counts as N attacks …, but the penalty doesn't increase until …" now keeps N in `countsAs`. Wide Cleave and Staff Swipe gained it, and an adventure creature's cone sweep now plays.
  - **Frightening Flurry** → three Strikes at one target and `bothHit: { conditions: [frightened], atLeast: 1, perHit: true }`: Frightened as many as the Strikes that hit.
  - **Mend Soul** → healing itself. "Or an incorporeal creature it has Grabbed" becomes a note.
  - **No-effect:** an action that only lengthens its reach ("from 5 to 10 feet", "gaining 10-foot reach") or gives it a climb, fly or swim Speed for a while, with no reaction, bonus, damage or condition. This covers Coil, Pull Arm, Extend Vines, Mobile Morph, Jump Jets, Inflate, Crystalline Dust Form, and two Battlezoo ones.
- **Live:**
  - For Frightening Flurry, the GM's whisper gives the value per hit.
  - For `missDamage`, a whisper says a creature it fails to hit (not a critical failure) still takes that damage.
  - The bleed rides on the Strikes' damage effect as persistent.
  - Not run in pftest.
- **Simulator (B213):**
  - `missDamage` on each failed Strike of a sweep;
  - `perHit` sets the condition's value to the number of hits;
  - `withExtraDamage` reads `[persistent,type]` and makes bleed persistent.

## A resistance to the triggering type, half damage, Scatter, a retreat (2026-10-12, batch 214)

- **Compiled:**
  - **Runic Resistance** → `resist-damage` `{ value: 5, types: ["triggering"], lasts: 10 }`: resistance 5 to one type of the triggering damage for a minute. Where there are several types it chooses; the simulator and the live offer take the type it took most of.
  - **Shadow Siphon** → `resist-damage` `{ value: "half", magical: true }`: half the damage of a spell or magical effect.
  - **Scatter** → `save-bonus-reaction` `{ value: 2, kind: "reflex", area: true }`, plus a note for the +2 AC against a splash attack.
  - **Tactical Retreat** → `withdraw` on any damage (a Stride). Its Fleeing until its next turn is a note.
  - **Rally** (a thrall back to its master) → no-effect.
- **Live:**
  - The resistance offer gives back half the damage for "half".
  - For "triggering" it gives back up to 5 of the type it took most of, and the lasting effect is resistance to that type.
  - The save bonus is offered only for its Reflex save, with the area a note.
- **Live check (pftest, 2026-10-12):** done with Monster Core 2 creatures beside Valeros.
  - **Runic Resistance:** Valeros's 16 slashing → the offer "Resistance 5 to slashing … for 10 rounds … 5 HP back". Use: 74 → 79 HP, and a 10-round effect of Resistance 5 to slashing, which PF2e lists.
  - **Shadow Siphon:** Ezren's Force Barrage for 5 → "Half this damage, only from a spell or magical effect … 2 HP back". Use: 210 → 212 HP, no lasting effect. The offer named Valeros, whose turn it was, as the attacker: resistance offers take the turn's creature as the source.
  - **Scatter:** 25 Reflex saves against DC 27. Only a failure by 1 (26) was offered: "+2 to the save turns a failure into a success. Only against an area effect …". Failures by more got nothing. Two Will saves that also missed by 2 or less got no offer.
  - **Frightening Flurry** (batch 213): the GM's whisper "the target becomes Frightened with a value equal to the number of its Strikes that hit it".
- **Simulator (B214):**
  - `resistReaction` halves the damage after resistances for "half", a spell's only with `magical`.
  - `"triggering"` resists the largest type, kept by `lasts`.
  - `saveBonusReaction` checks `kind` and `area`.

## Commands for an ally's reaction Strike (2026-10-12, batch 215)

- **Compiled** → `ally-advance` with `reaction` and `noStride` (a Strike only):
  - **Interest is Due!**: 1d6 mental extra damage, once a round. "Only at a creature that owes it money" is a note.
  - **Tactical Command**: once a round. The ally's Stride instead, and its +2 against a creature it knows, are notes.
  - **Timely Trick**: `trait: "animal"`; the animal's Step or Stride instead is a note.
  - **Stab it! Stab it! Stab it!**: `trait: "goblin"`, `lowerLevel`. The goblins' extra damage die until its next turn is a note.
  - **Advise Swarm** → no-effect (the ratfolk's Steps, Strides and Take Cover).
- **Live:** the GM's whisper says the targeted ally "can Strike as its reaction", only an animal (or a lower-level goblin beside the target) where it says so, with the notes. Not run in pftest.
- **Simulator (B215):** `bestAdvance` keeps to allies of the trait and lower level, and to Strikes needing no Stride.

## Spell Dodge, Warding Strike, ruses, states in triggers (2026-10-12, batch 216)

- **Compiled:**
  - **Spell Dodge** → `save-bonus-reaction` `{ value: 2, against: "spell" }`; the +2 AC against the spell's attack is a note.
  - **Warding Strike** → `reaction-strike` on `ally-attacked`. The 8 (16 on a critical) off the attack's damage is a note.
  - **No-effect:**
    - Dramatic Death (a ruse, as Feign Death);
    - Live to Tell the Tale (unconscious for hours instead of dying: out of the fight);
    - The Jig Is Up and Zealous Rush (a Stride).
- **The GM's** (`gm-fallback.js`, once every reading fails):
  - `"state"`: a trigger behind a state the simulator can't see. This uses the requirement patterns plus "while underwater", "while Feigning Death", "while Hiding in water" and "is using X, and …".
  - `"out-of-combat"`: a trigger set off by a social or exploration skill check (Survival, Deception, Diplomacy, Performance, a Lore, "a check to Balance or Climb", a Charisma-based skill check).
  - The trigger is read up to its first full stop, so the rest of an unlabelled text doesn't count.
  - Numbers: 22 new in PF2e, of which 16 are now the GM's; 12 in Battlezoo, all the GM's (states).
- **Live:** the save bonus offer shows its notes (Spell Dodge's AC). Not run in pftest.
- **Simulator:** nothing new.

## Battlezoo foresight, luck and quick escapes (2026-10-12, batch 217)

- **Compiled** (12 Battlezoo abilities; their own words stay out of this repository):
  - An attacker made to roll twice and keep the lower, as it's the target of an attack → `attack-misfortune`.
  - Two rolls for its own save against a spell, the higher kept → `save-reroll` `{ against: "spell" }` (a failed save rerolled).
  - Its failed save of one kind made a degree better, once a minute → `save-boost` `{ save, uses: 1 }`. Its AC and Speed for a few rounds after are a note.
  - An ally's failed or critically failed save rerolled, the better kept, after a sentence that only tells it → the ally `save-reroll`.
  - **Moves away** → `withdraw` with these triggers and moves:
    - any damage → a flight or swim of half its Speed, with no reactions;
    - a Strike that hits it → a move of some feet with no reactions; Concealed for the attacker's turn is a note;
    - damage dealt to it → a short Leap (a Stride), with another way to move as a note;
    - an attempt to target it or catch it in an area → a Step or Stride; the attacker's choice of another action is a note;
    - a foe ending its turn beside it → half its Speed away, not next to another foe, with no reactions.
  - A swarm Striding after a creature that leaves its space → `follow`.
  - Resistance to all damage but one type against what hurt it, and a short teleport → `resist-damage` (the type left out a note, the teleport `shift`).
- **Live:** offers as for these kinds. The own reroll is offered only for a spell's save. Not run in pftest.
- **Simulator (B217):** `saveReroll.against` "spell" checks the save comes from a spell.

## More Battlezoo reactions (2026-10-12, batch 218)

- **Compiled** (7 Battlezoo abilities; their own words stay out of this repository):
  - A bonus to its own save when a mental effect that allows one is aimed at it → `save-bonus-reaction` `{ against: "mental" }`.
  - A creature moving into its space, answered with a jaws Strike after a sentence that only tells it → `reaction-strike` on `approach`.
  - A flight toward a spell's caster as it's targeted → no-effect.
  - Damage from a physical attack cut by some, then a Step, with a little cold back at an adjacent attacker → `resist-damage` `{ on: ["physical"], attack: true }`; the Step and the cold are a note.
  - An AC bonus for a creature in its aura as it's attacked → `ally-ac-reaction` within the aura's size (30 feet when the aura can't be read); a teleport on a miss is a note.
  - A taunt, then a Stride of half its Speed once the Strike resolves → `withdraw` on `attacked`; its allies' Strides are a note.
  - Invisible before a Strike at it resolves, then a Step → `conceal-reaction` (DC 11, as Hidden). How long it stays invisible is a note.
- **Live:** the mental bonus is offered only for a save against a mental effect. Not run in pftest.
- **Simulator (B218):** `saveBonusReaction.against` of another trait checks the effect's traits.

## Lost Omens Strike riders, curls and splashes (2026-10-12, batch 219)

- **Compiled:**
  - **Chain Shot**: "A creature hit by this Strike is Grabbed by the chain (Escape DC 41)" → Grabbed on a hit, its Escape DC a note. The reeling in is the GM's.
  - **Drain Nutrients**: "targets a creature with a claw Strike" → its claw Strike, then a Fortitude save after a hit: Drained 2, or Drained 1 on a success. A bracketed "(X on a success, no effect on a critical success)" now sets the success. The temporary Hit Points are a note.
  - **Impaling Charge** (Cuetzmonquali): "impaled on one of … horns. The creature becomes Grabbed" → Grabbed on a hit; on a critical hit, Grabbed and Restrained for 1 round. The Escape DC of 40 is a note.
  - **Tactical Gnaw**: the armor made Broken "on a successful attack" is the GM's, a note.
  - **Defensive Curl** → +2 circumstance AC until it moves ("can't move …, but it can unfurl as an action"). The exposure to its plates is a note.
  - **Bounce Away** → resistance 3 to bludgeoning against the hit, "and Flies away from the attacker" (`shift`).
  - **Digestive Secretions**: "secretes acid for 1 round. Whenever it makes a melee Strike, it deals an additional 2d8 acid splash damage" → its melee Strikes deal 2d8 acid until its next turn starts. Splash damage reads as its type; where it splashes is a note.
  - **No-effect:** Drag Under (a swim with its prey) and Pacify (nonlethal for a while).
- **Live:** cards as for these kinds. Not run in pftest.
- **Simulator:** nothing new.

## Chains, fury, second chances, stolen healing (2026-10-12, batch 220)

- **Compiled:**
  - **Cleanse the Forest** → `multi-strike` with three melee Strikes, each at a different enemy, `chain` (the next only after a hit), a Stride first. The Strides between and the return are notes.
  - **Blood Fury** → as it deals bleed damage (`trigger: { kind: "deals-bleed", reaction: true }`): +1 status to attack rolls until the end of its turn and `heal: 5`.
  - **Second Chance** (four time dragons) → `save-reroll` `{ ally, self, within: 60, keep: "new", perRound, free }`. A failed skill check and the day's immunity are notes.
  - **Parasitic Healing** → `heal-siphon` `{ share: 0.5, selfHeal: "full" }`: the creature regains half, and the monster regains the full amount.
- **Live:**
  - The siphon offer says the creature regains only half and the monster the full amount, applied by hand.
  - Second Chance is offered as a free reroll keeping the new result.
  - Blood Fury is PF2e's own effect.
  - Not run in pftest.
- **Simulator (B220):**
  - `chain` stops a sweep at its first miss;
  - a triggered self-effect heals by `heal`;
  - the ally reroll can keep the new result and be free once a round;
  - the heal-siphon can heal the siphoner by the full amount.

## Monster Core sweeps, leaps and moves (2026-10-12, batch 221)

- **Compiled:**
  - **Flaming Stroke** → a sweep over a 15-foot line at –2: one attack roll (a note), +1d6 fire on each hit, counted as one attack.
  - **Tail Sweep** → up to three foes on one roll, counted as two attacks (`countsAs: 2` from the swipe's sentence). The tail's reach and "adjacent to at least one other target" are read too.
  - **Strafing Chomp** → a Swim and a half-damage jaws Strike in one action; the swim after is a note. A half-damage Strike is now kept even with fewer actions than its moves plus one.
  - **Leaping Grab** → a Leap (a Stride) and a leg Strike that Grabs on a hit; the jump's distances are a note.
  - **Thundering Iron** → +1d10 sonic on a hit. The same damage and a push for creatures around the target are the GM's, a note.
  - **Shielded Charge** → its shield's AC bonus until its next turn (2 when there's none to read); the two Strides are a note.
  - **No-effect:** Deep Plunge, Wriggling Rush, Swim Together, Mask Stench, Quick Stow.
- **Live:** cards as for these kinds. Not run in pftest.
- **Simulator:** nothing new.

## Battlezoo Demoralizes, Feints, curls and Strikes (2026-10-12, batch 222)

- **Compiled** (11 Battlezoo abilities and PF2e's Mocking Cry; the Battlezoo words stay out of this repository):
  - **Demoralize** (PF2e's own action):
    - rolled with Deception (Mocking Cry; a Battlezoo mimic);
    - at all who hear it in a cone, with no language penalty (the cone a note);
    - "a single Intimidation check" for all within some feet or a template.
    - A critical success's counteracting of good emotion effects is a note; immunity of an hour or a day is read.
    - The maneuver reader now reads @Compendium links as their labels too.
  - **A Feint at a creature some feet away**: its longer Off-Guard on a success is a note.
  - **Strike-only:** an object picked up and thrown as its ranged Strike.
  - **A curl** → +2 circumstance AC until it uncurls; its Speed and the limbs it can't use are a note.
  - **No-effect:** a Leap any way, upward included.
  - **A pinning Strike** → Immobilized and Off-Guard until its next turn starts; ending early once the target isn't beside it is a note.
  - **A Strike "that deals no damage"** → `noDamage`, Dazzled for a round on a hit (Blinded and Dazzled on a critical).
  - **A step through time** (gone and back in a free space nearby, with no reactions) → `safe-move`.
- **Live:** cards as for these kinds. Not run in pftest.
- **Simulator:** nothing new.

## Battlezoo self-buffs (2026-10-12, batch 223)

- **Compiled** (4 Battlezoo abilities; their own words stay out of this repository):
  - **Quickened for a minute**, its extra action each round or turn for one thing only → the self-condition reading (its extra action's use widened).
  - **A bonus to one save and some temporary HP for a minute, with penalties to others**, once a day → `self-effect`. The save modifiers are read; Perception and initiative penalties are a note.
  - **Its next named Strike this turn, at that creature**: a circumstance bonus to the attack and extra precision damage on a hit → `self-effect` with `nextStrike`.
  - **A circumstance AC bonus for a round, and poison for those who end their turns beside it** → `self-effect`; the poison is a note.
  - The self-guard reading now skips only abilities that link PF2e's own effects; a module's linked effect (a Battlezoo one) no longer stops it.
- **Live:** effects as for these kinds. Not run in pftest.
- **Simulator:** nothing new.

## Bestiary reach, shields, volleys and slams (2026-10-12, batch 224)

- **Compiled:**
  - **No-effect** (reach only): Extend Limb, Extend Neck, Reassemble. Grab and Go is a move.
  - **Raise Shields** (a troop) → +2 circumstance AC until its next turn.
  - **Furious Fusillade** → its best ranged Strike at each creature in a 30-foot cone, each rolled separately, counted as one attack. "A ranged Strike" in a sweep now names its best ranged Strike.
  - **Prudent Asterism** → up to six starknife Strikes at different creatures, the next only after a hit (`chain`), on one penalty. Each within 60 feet of the last is a note.
  - **Impaling Barb** → its barb Strike, with 2d8 piercing and Immobilized on a hit. The half-Speed Stride after and the Escape DC are notes.
  - **Focused Slam** → its fist Strike: +3d8 on a hit, the Strike's damage on a failure, counted as four attacks, Off-Guard on itself until its next turn. Being able to Rend is a note.
- **Live:** cards as for these kinds. Not run in pftest.
- **Simulator:** nothing new.

## Reaction Strikes at auditory and healing actions, shocks and bites (2026-10-12, batch 225)

- **Compiled:**
  - **Auditory Swipe, Disruptive Screech** → `reaction-strike` with the trigger `auditory`: a creature in its reach, or within 30 feet for Disruptive Screech's screech, uses an auditory action. Disruptive Screech's critical hit disrupts the action.
  - **Clinch Victory** → `reaction-strike` with the trigger `healing`: an action that would restore Hit Points, in its reach. A critical hit disrupts it.
  - **Shell Shock** → 7d6 electricity on a creature that hits it with any melee attack. "A melee or an unarmed attack" is now any melee attack, not unarmed only, and "A lightning turtle is hit" names the monster.
  - **Gnashing Grip** → when a creature it holds fails to Escape, its own venom's save, with 1d6 piercing damage on every result.
  - **Serrated Teeth** → 2d6 slashing on a creature that Escapes it: the new trigger `escaped`.
  - **Scurry** → a Stride once an attack on it is done, with no reactions. The text only rules out the attacker's reactions.
- **Live:**
  - An auditory action (a spell with the trait, or a check with it, such as Demoralize) or a healing one (a spell, or a check with the trait, such as Battle Medicine) offers the reaction Strikes that name it, never Reactive Strike. Cards whose trigger names those kinds are offered too.
  - The offer's note says when a critical hit disrupts the action.
  - Escaping a monster's hold offers its `escaped` card.
  - **Checked in pftest (2026-10-12):**
    - Valeros's Demoralize at a Morthak offered Auditory Swipe ("used an auditory action") with its Claw, and no Reactive Strike. The Claw rolled against Valeros.
    - Seelah's Lay on Hands beside a Triumph Siktempora offered Clinch Victory, with the critical-hit note. The healer has to be in the encounter.
    - Merisiel's failed Escape from an Allosaurus offered nothing. The same Escape reposted as a success offered Serrated Teeth, and its card dealt her 5 damage.
- **Simulator:** see B225 in its ability decisions.

## Fear shrugged off, softened failures, costly rerolls, unseen states (2026-10-12, batch 226)

- **Compiled:**
  - **Fearless Rush** → `negate-condition` for Frightened with `reduceBy: 1` and `stride: "toward"`: the condition lands 1 lower, then it Strides toward an enemy.
  - **Light of Diligence** → an ally's `save-boost` within 15 feet, for a critical failure only (`criticalOnly`), each ally once (`perAlly`). Other checks are the GM's, in a note.
  - **Prescient Revision** → its own `save-reroll` keeping the better result. What it gives up for 1d4 rounds is a note.
  - **The GM's** (`gm: "state"`) for a trigger or requirement the simulator can't see: a liege, passengers, a chosen egg, a lower-ranking cultist beside it, being Retracted, being transformed by an ability, an ability active, cover an animal ally gives it, a burrow hole. Guard's Parry, Protect the Master!, Speaker's Privilege, Burrowing Retreat, Parental Wrath, Protect Passenger, Protective Pinch, Object Lesson, End the Charade, Guardian Spirit.
- **Live:**
  - Fearless Rush offers "Use it: Frightened 2 1 lower" when it gains Frightened. Using it lowers the condition by 1 through PF2e and notes the Stride (the GM moves the token).
  - A reroll's offer carries its plan's notes.
  - **Checked in pftest (2026-10-12):** a Karkadann given Frightened 2 got the offer, beside the simulator's morale card. Using it left Frightened 1.
- **Simulator:** see B226 in its ability decisions.

## Battlezoo reaction Strikes, splashes and last acts (2026-10-12, batch 227)

- **Compiled** (Battlezoo; wordings paraphrased here):
  - **Reaction Strikes at a concentrate action** → `reaction-strike` with the trigger `concentrate`. One disrupts the action on a hit. The other disrupts it unless the creature passes a Will save (`disruptSave`). "Outside its multiple attack penalty" sentences are read.
  - **A reaction Strike at Standing up** → the trigger `stand`. A critical hit disrupts it.
  - **A Strike activity used as a reaction** at a creature trying to move beside it → `reaction-strike` with that activity's Strike and its hit conditions (`onHit`, with their durations), and a note. A name with small words ("… on …") is read.
  - **A Trip at a creature leaving a square within 15 feet** → PF2e's Trip with a `provoke` trigger (`leave`, within 15).
  - **Its poison splashed onto the attacker**, or **puffed over the creatures within 10 feet** after a critical hit → its own affliction's save on them.
  - **Another ability used as it dies** → that ability with the death trigger. Where its area starts, and its destruction, are notes.
  - **A Demoralize back at a ranged attacker** → `reaction-strike` with `skill: "demoralize"` and `rangedAttack`. The immunity rule is a note.
- **Live:**
  - A concentrate action (a spell or a check with the trait) offers the reaction Strikes that name it, never Reactive Strike.
  - Prone ending on a creature's own turn counts as its Stand.
  - The offer says when a save keeps the action, and carries the plan's note on the move path too.
  - A ranged Strike at it offers the Demoralize within 30 feet.
  - **Checked in pftest (2026-10-12):**
    - Valeros's Demoralize at a Staccarix offered its beak Strike, with "If the Strike hits, the triggering action is disrupted."
    - Merisiel losing Prone on her own turn beside a Reaver Beaver offered its tail Strike ("stood up"), with the critical-hit note.
    - Valeros's shortbow Strike at a Braincase 20 feet away offered "Use it: Demoralize" with the immunity note. His ammunition was assigned for the test and restored after.
- **Simulator:** see B227 in its ability decisions.

## Battlezoo guards, lunges, kin follow-ups and unseen states (2026-10-12, batch 228)

- **Compiled** (Battlezoo; wordings paraphrased here):
  - **Resistance to the triggering damage type for a minute** → `resist-damage` with `types: ["triggering"]` and `lasts: 10`. A new use replacing the last, and cold iron getting through, are a note.
  - **An ally's Strike taken in its place** → `intercept` (`ward: "ally"`, `share: 1`, `strikes`).
  - **A critical hit beside it shared half and half** → `intercept` with `share: 0.5` and `critical`. That both take the hit's effects, and neither takes the critical hit's, is a note.
  - **A Strike back at a creature Striking it**, at the cost of 2 AC against that Strike → `reaction-strike` `attacked` with `selfAcPenalty`. When it can use it again is a note.
  - **Another of its kind's bite followed up** → `reaction-strike` `ally-hit` with `kin` and `allyStrike`. Only one answer per Strike.
  - **The GM's** (`gm: "state"`): a pose held by an ability; its chosen victim; an area its ability made; an ability active; a count of its limbs; a creature attached to it; being out of water; a broken keepsake; a light in its space; a teleport into distant darkness. A fallen ally raised as undead is a summon (no-effect). A sound illusion seen through with Perception is narrative (`gm: "out-of-combat"`).
- **Live:**
  - The intercept offer carries its plan's note.
  - The ally-hit offer checks the kin (the same actor name) and the Strike (the `item:slug:` roll option), and carries the note.
  - The lunge's AC note goes on its Strike offer.
  - Not run in pftest.
- **Simulator:** see B228 in its ability decisions.

## "Each creature within N feet" as an area; poisons and drains (2026-10-12, batch 229)

- **Compiled:**
  - **An area around it:** a save whose text names "each/all/every creature (or foe, enemy) within N feet" with no template is an emanation of N feet (`targeting.area`). Before, it was one creature at range N. Foes or enemies only add `area.foes`. "Within N feet of the target" (or of another creature or point) is left as before. About 100 PF2e plans changed (mostly adventure creatures and hazards: screams, explosions, slams) and 23 in Battlezoo.
  - **Its own poison on its weapon** in two more wordings (Battlezoo): one secreted or smeared onto the weapon, and a dose applied to it.
  - **A damage-type pick** ("X or Y damage") on a formula in brackets, such as "(1d6+3)".
  - **Blood lapped up** from a creature it holds: Blood Drain's reading (damage, temporary HP equal to it, Drained until healed).
- **Live:** a reaction's or passive's emanation card takes only the foes around it when `area.foes` is set. A used action's emanation is still the GM's targets.
- **Simulator:** see B229 in its ability decisions. Reactions whose plan was "1 creature" with a creature setting them off found no target there. As emanations they now play.

## Shells, teeth, plates and shed armor (2026-10-12, batch 230)

- **Compiled:**
  - **Retract, Shell Defense, Roll Up** → a `self-effect` stance (`shell`) with its AC bonus and resistances. Shell Defense's "AC to 18" is the difference from its own AC; without one it's a note. What it can still do, being Prone or Blinded, and the damage to a creature hitting it are notes.
  - **Broken Thorns, Poison Tooth** → follow-ups to "its most recent action this turn". Poison Tooth's tooth removal (a Medicine check) is a GM note.
  - **Flight Commander of Dis** → no-effect (a fly-Speed bonus only).
  - **Activate Defenses** → its PF2e effect, on itself or a creature beside it (the GM's target).
  - **Shed Armor** → 60 HP on itself, `oncePerFight` ("can't be used again until 1 hour has passed"). The lower AC is a note.
- **Live:** cards as for these kinds. Not run in pftest.
- **Simulator:** see B230 in its ability decisions.

## Diseases shed, many-headed jaws, gullets, flavoured rolls and sweeps at a penalty (2026-10-12, batch 231)

- **Compiled:**
  - **Scratch** → its own disease's save on every creature beside it (a 5-foot emanation).
  - **Ravenous Jaws** → one jaws Strike per head, each at a different creature. When no ability states the count, its heads come from the creature's notes ("nine-headed").
  - **Pharyngeal Jaws** → its damage on the creature it holds. The bonus to Swallow Whole and to the Escape DC is a note. The automatic-effect reading now lets through an Escape named only as a DC with a bonus or penalty (a reaction that holds a creature "until it Escapes" stays the GM's).
  - **Flavoured rolls** (Battlezoo's older syntax): "[[/r 2d10 #cold]]{2d10 cold damage}" is typed damage. Eight Battlezoo area saves written this way now compile, and some affliction stages gained their damage.
  - **A sweep of everything in its reach, each roll at a penalty** → a sweep with `penalty`. A push it can use on each creature hit is a note.
- **Live:** cards as for these kinds. Not run in pftest.
- **Simulator:** nothing new.

## Counterspell's kin in actions (2026-10-12, batch 232)

- **Compiled:** after every reading fails, an ability whose effect is only an attempt to counteract a spell or magical effect becomes `{ builtin: "no-effect" }`, like batch 86's reactions (the user's choice: Counterspell is the GM's). Examples: dispelling a flight or light, taking control of a fire or plant spell, silencing an area.
  - **Not** when it also has damage, a save, a Strike, a bonus or penalty, a condition, a reroll, Unconscious or dying.
  - **Not** when others need a counteract check to end its own magic ("can be dispelled", "anyone else").
  - **Not** a reaction set off by anything other than a spell, an effect or magic.
  - 10 new in PF2e, 13 adventure ones relabelled (still the GM's), and 14 in Battlezoo.
- **Live / simulator:** no-effect, as before.

## Spell-charged Strikes, chain charges, weapons in hand (2026-10-12, batch 233)

- **Compiled:**
  - **Bespell Strikes** → its Strikes deal an extra 2d6 force damage until the end of its turn, after a non-cantrip spell (`requires: "after-cast"`). A spell that dealt another damage type is a note.
  - **Charge Chain** → its next chain Strike this turn deals an extra 4d6 void damage (`nextStrike`). The other choice, 120-foot reach, is a note. A free action limited to once a round is now read by the Strike-buff reading too.
  - **Re-Arm, Hidden Pockets** → no-effect (a weapon formed in hand, an item drawn).
- **Live:** as for these kinds. Not run in pftest.
- **Simulator:** nothing new.

## Battlezoo troop attacks, a shell, a tonic and a still disguise (2026-10-12, batch 234)

- **Compiled** (Battlezoo; wordings paraphrased here):
  - **A troop's attack whose damage depends on the actions**, its counts written as icon spans, on the enemies in its squares or within 5 feet → the action-count save, an emanation on its foes (`area.foes`). That is now so for every troop's "each enemy within N feet" (8 in PF2e).
  - **A shell stance** whose AC bonus also names the AC it reaches and covers its saves against areas → `shell` with the AC bonus. The saves, what it can do meanwhile, and Prone in the shell are notes.
  - **Healing with a save bonus after it** (an item bonus to some saves for a minute) → its healing, the bonus a note.
  - **A still disguise** with its automatic Deception result "until it acts again" → no-effect.
- **Live:** as for these kinds. Not run in pftest.
- **Simulator:** nothing new (`area.foes` as in batch 229).

