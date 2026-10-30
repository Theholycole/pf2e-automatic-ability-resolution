# Player feats

Started 2026-10-30. The user asked for automation of the player options PF2e and the suite don't automate yet ("PF2e Feat automation": class, ancestry, skill and general feats, backgrounds, heritages, and the actions they grant), Teams+ content included. The index of what's left, by mechanic pattern, is the project's `feat-automation/feat-automation-index.csv` and the doc "PF2e Feat Automation: work index". The user's instruction for this work: build, and keep the decisions for the end (listed below).

It's built here, on the ability module's readers and live cards, because PC feats read like monster abilities once the character's own numbers are in. It can move to a module of its own later (decision D1).

## Slice 1: saves against the character's own DC (2026-10-30)

- **The character's numbers** (`src/compiler/pc-dcs.js`, `options.dcs`; live: `scripts/pc-dcs.js` reads them off the actor):
  - Saves PF2e writes against a statistic ("@Check[reflex|against:class-spell|basic]", "dc:resolve(@actor.attributes.classDC.value)") get the character's DC: class, spell, the higher of the two, a class's own (exemplar, commander…), a tradition's, Perception, a skill's.
  - Damage scaled by the character ("ceil(@actor.level/2)d6", "max(1, @actor.abilities.str.mod)", ternary by level, "@item.level", the damage type the player chose) is worked out. Live, PF2e's own roll data fills any other path first.
  - A save whose DC can't be found, or a check against the target's DC ("@Check[athletics|against:fortitude]"), is left as it was.
- **Live cards for characters** (`scripts/live.js`, `cardForCharacterAbility`): a character's feat or action posted to chat gets the confirmation card when it reads into a save, a check against a creature, or healing. The targets are the player's own, recorded on the message by their client (`recordTargets`), since the card is made on the GM's.
  - Anything else the reader makes of a character's feat stays PF2e's for now (D2), and so does a feat whose damage still names something the roll data doesn't hold (D3).
- **Measured** on PF2e's packs and the Teams+ modules (a level 8 character, class DC 25, spell DC 27): 262 of the 4,826 options the index lists as needing work now compile to a save plan. Before, none did, because they had no number to save against.

## Slice 2: Strike feats (2026-10-30)

- **The reader** (`src/compiler/pc-strikes.js`): a character's feat that has its user make a Strike ("Make a melee Strike", "Stride twice, then Strike", "make two dagger Strikes") and that the monster readings don't take whole becomes the strike-activity builtin the monsters' activities use:
  - its Strides before the Strike, the number of Strikes, "counts as two attacks", a circumstance bonus or penalty to the attack roll;
  - a hit's and a critical hit's results: conditions, damage (inline or written out, "an additional 10d10 precision damage"), a push, a save the creature hit attempts (with its degree sections);
  - "Make a Strike" with no kind named is any of the character's Strikes (`anyStrike`), a melee or ranged one only that kind.
  - What it doesn't read goes to the GM as notes on the card (the monster readings drop an activity they can't read whole; a feat's wordings vary too much for that). Flavour sentences are left out.
- **Live:** the player uses the feat, then rolls the Strike from the sheet; when it hits, the card offers its results (`cardsForRiders` now takes a character's Strike after one of its Strike feats, and nothing else of the monsters').
- **Measured:** about 100 more options compile (78 of them from the index's "Strike variant or Strike rider" pattern).

## Decisions kept for the user

| # | Question | What's built meanwhile |
|---|---|---|
| D1 | Should the feat work stay in the ability module, or move to its own module ("PF2e Automatic Feat Resolution")? A new repository has to be created by you. | Built here, in files that can move: `src/compiler/pc-dcs.js`, `scripts/pc-dcs.js`, `cardForCharacterAbility` in `scripts/live.js`. |
| D2 | Should characters get cards for the ability readings beyond saves, checks and healing (Effects, builtins like stances and self-buffs)? | Only saves, checks and healing get a card. |
| D3 | A feat whose damage names a value PF2e's roll data doesn't hold: post the card anyway with the GM to fix the dice, or leave it to PF2e? | Left to PF2e. |
| D5 | Strike feats whose text the reader only partly reads: post the card with the unread sentences as GM notes, or keep such feats PF2e's until they're read whole? | Card with GM notes. |
| D6 | A feat that is only "Stride, then Strike" (Viper Strike, Looming Gait) has no hit results: just the GM note and the simulator's Strides, no card. Enough? | Note only. |
| D4 | The card aims at the player's targets when the feat was posted. If there were none, should it fall back to the GM's targets? | No targets: the card is posted with none. |
