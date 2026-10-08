# Live play: confirmation cards

The user's decisions (2026-10-08):

- **Cards like the spell module's.** Using an ability from a monster's sheet posts a resolution card under PF2e's own ability message: its targets (the GM's targets), a roll button per target, then **Apply**, which the GM confirms. Simple effects get a card too ("confirmation-first for everything").
- **A target's owner rolls its own save** on the card; the GM can roll for anyone, and nothing is applied before the GM confirms.
- **Riders get a card after the hit.** When a monster's Strike hits and the Strike lists a rider (Grab, Knockdown, Push, a venom), a rider card appears under the Strike's result: Grab's Athletics check against the target, or the venom's save. The GM confirms the result.
- **The first slice is monster abilities:** breath weapons and other save abilities, Strike riders, Constrict, Swallow Whole. PCs' skill actions come next.

## How it works

- `src/live/card.js` (pure): the card's state (the ability's plan, the source, the targets and their rolls) and its HTML.
- `scripts/live.js` (Foundry): the triggers, the rolls, the result watcher and Apply.
  - **Triggers** (on the active GM's client only): a monster's ability message (`flags.pf2e.origin.type === "action"`), and an attack roll that hits with a Strike listing a rider.
  - **Rolls** go through PF2e's own statistics (a target's save, or the monster's skill against the target's DC), tagged `identifier: "aar:<card>:<target>"`. Whoever owns the roller rolls; the active GM's client writes the result onto the card.
  - **Apply** resolves the plan with the core (`registry.resolve`, the recorded degrees as `io.roll`), then applies the changes: damage through PF2e's `applyDamage` (its resistances and weaknesses), conditions, and afflictions handed to Pseudo Afflictions as the spell module does.

## Status (2026-10-08)

**Checked live in pftest** on a PFTEST SIM scene with PFTEST SIM iconics and monsters:
- **Poison Breath** (a save ability, 3 targets): the card appeared under PF2e's ability message. "Roll the rest" rolled each PC's Fortitude save through PF2e. On Apply, 9d6 was rolled once (28) and the two failures took the full 28 through PF2e's own damage; the critical success took nothing.
- **Giant Scorpion Venom** (a rider): a Stinger hit brought the venom card under the attack roll. A failed save handed the venom to Pseudo Afflictions, which made its affliction effect at stage 1, with enfeebled 1.
- **Grab** (a rider check): the anaconda's Athletics against the target's Fortitude DC. A success applied grabbed; a critical success, restrained, with a reminder of when it ends.

**Not yet:**
- Conditions with a duration are applied, with a reminder line of when they end; they don't end on their own.
- Pushes are reminders (move the token).
- Swallow Whole's damage at the end of each turn is a reminder too.
- Auras (Frightful Presence, Stench) have no card: they need "entering the aura" triggers.
- Recharge isn't tracked live; PF2e's own text has the roll.
- PCs' skill actions are the next slice.
