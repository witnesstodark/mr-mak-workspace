---
name: game-architecture-foundation
description: Set up or audit a game's core architecture so tuning, new content and testing stay cheap: data-driven numbers, modular entity definitions, simulation apart from presentation, a single command path, in-game development tools, data scenarios and versioned saves. Use when starting a game project, before adding a major system or layer, or when tuning needs code changes.
---

# Game architecture foundation

These rules come from a real cost. A strategy game began with numbers and entity
types in code. Its map editor later required migrating every entity type to a
modular model and moving the numbers out of code: one change touched 537
references in 87 files, and finished features had to be rebuilt on the new base.
Each rule below is cheap on day one and expensive after content exists.

## When to apply

- At the start of a game project, before the first playable prototype grows.
- Before adding a major layer (strategy map, economy, campaign, editor, new unit
  families) to an existing prototype.
- When a balance pass needs recompiling, or a new unit type needs a new class.

For an existing project, audit first: list each rule as met, partial or missing,
with the files that show it. Propose a foundation stage that migrates what
exists with the current regression tests as proof that behaviour is unchanged.
Present the audit and let the user choose the scope before refactoring.

## The rules

### 1. Numbers live in a rules file

- One readable text file is the single source of gameplay numbers: one line per
  value, carrying the id of the design decision behind it
  (`F3 jump.capital.charge 3`).
- Load and validate it at start (known keys, types, ranges); fail loudly with the
  line at fault. No parallel tables in presentation code.
- Development builds reload it while the game runs. Define how in-flight state
  reacts to a change (keep the health fraction, apply damage on the next shot,
  costs on the next purchase).
- Customised content (mods, campaign variants) resolves on top of the base file
  into one effective catalogue that both simulation and presentation read.

### 2. Entities are data plus composable capabilities

- One generic entity definition for units, structures, props, projectiles-as-
  needed and future families. A type is a data file that combines capabilities
  (move, turret, jump, regenerate, hangar, cargo, garrison), not a new class.
- Variants inherit from one base (which may itself be a variant), show the origin
  of each field and can restore inherited values. Validate references and cycles.
- Shared definitions (a weapon used by many types) never share runtime state
  such as cooldowns or ammunition.
- Per placed instance, edit only position, orientation, owner and initial state;
  type attributes belong to the definition.
- Keep rules and appearance as separate layers of the definition (model, LODs,
  icon, sound and text apart from the gameplay fields).

### 3. Simulation is separate from presentation

- Simulation state exists without the visual object: an entity can be simulated,
  saved, aggregated or run headless with no actor, mesh, camera or sound.
- The engine object (actor, GameObject, node) is a view and an input surface over
  that state. This is what makes cheap off-screen simulation, aggregation at
  distance and fast batch testing possible.
- Pick the network model deliberately and record it. Lockstep needs determinism
  everywhere in the simulation (fixed point, seeded RNG, fixed step, stable
  iteration order). Server authority does not, but still benefits from seeded RNG
  for reproducible tests.

### 4. Every action is a command

- Player input, AI, automated tests, agents and tuning tools all issue the same
  command objects (who, what, target, parameters) through one path with one set
  of validations.
- Commands carry the issuing player, so multiplayer permission checks live in one
  place. Logging commands with the seed and content version gives replays and a
  reproducible diagnostic export.
- Never let a UI or test call gameplay methods directly when a command exists.

### 5. Development tools inside the game

Development builds only, never shipped as a feature:

- game speed from 0.5x to 8x, pause and single-step;
- save a moment and return to it;
- take control of any side, or hand any side to the AI;
- information layers (ranges, regions, routes, supply, AI intentions);
- live tuning panel with notes; on exit it writes a report of changes and notes
  for review, and the rules file changes only through a reviewed commit;
- AI-versus-AI batch comparison: the same scenario over several fixed seeds,
  accelerated and in the background, reporting winner, duration and margins.
  Use it for every balance decision instead of single manual runs.

### 6. Scenarios are data, apart from the game mode

- Test and demo situations are files (sides, fleets or units, positions, seed,
  duration, what to measure) run by one scenario runner, repeatable with one click
  or one command line.
- Keep the test harness out of the game mode and rules classes.
- Every automated scenario logs machine-readable results and exits with a status.

### 7. Saves and content formats are versioned from the start

- Every saved format carries a version; incompatible files are refused with an
  explanation, and old files are never deleted.
- A saved session keeps the content it needs to resume (or an exact reference to
  it), so later edits to definitions do not silently change a saved game.

## Order of work

1. Audit or plan against the seven rules; agree the scope with the user.
2. Rules file and its loader, with the current numbers moved over unchanged.
3. Generic entity definitions, migrating every existing type (not samples).
4. Simulation state apart from the engine objects.
5. Command path; route input, AI and tests through it.
6. Scenario runner and batch comparison; port the existing automated tests.
7. Live tuning, information layers and saves as the systems that need them land.

After each step, run the full regression and compare results with the baseline
recorded before the step. A refactor that changes behaviour without a decision
is a regression.

## Record

Write the agreed rules and their status in the project's design or decision log,
with dates. Do not mark a rule met because a document describes it: it is met
when the code does it and a test shows it.
