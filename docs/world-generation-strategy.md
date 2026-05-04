# World Generation Strategy

## Purpose

This document captures the current world generation design for Clay and Blood. It is intended to onboard future development sessions quickly and to serve as a living reference as new zones are designed.

The current direction is a hybrid authored/generated world:

- Important places can be fully static and authored by hand.
- Most exploration zones can be deterministic generated spaces whose particulars vary by world seed.
- Generated zones can contain static authored landmarks.
- Every generated output should be inspectable in an HTML preview and validated before it is trusted in-game.

The Great Northern Road is the first reference implementation for this strategy.

## Core Vocabulary

### Stage

A stage is one playable map instance. It can be small, such as an inn room or shop interior, or large, such as a winding road segment or wilderness area.

Stages are entered and exited through named exits. A stage owns:

- Stable `id`
- `zoneId`
- Tile grid
- Exit definitions
- Explicit arrival positions
- Optional terrain and metadata
- Static connections or generated topology connections

Examples:

- `town-square`
- `northern-gate`
- `great-northern-road::road-01`
- `great-northern-road::merchant-caravan`

### Zone

A zone is a conceptual area made of multiple stages. It is the world layer above stages.

Examples:

- `lunavik`
- `great-northern-road`
- `the-meadows`
- `western-wilds`

Zones are the right unit for:

- Theming
- Music and ambience
- Difficulty bands
- Spawn tables
- Generation rules
- Map previews
- Future discovery/progression flags

We intentionally removed the older `region` concept. For the current game, stages and zones are enough. If the game later needs broader geographic grouping, that should be added only when there is a real gameplay or content management need.

### Static Stage

A static stage is authored directly. Its layout is stable across world seeds.

Static stages are used for:

- Town centers
- Shops and interiors
- Gates
- Special landmarks
- Boss rooms
- Designed encounters
- Any space where authorial control matters more than variation

Static does not mean disconnected from generated content. A static stage can live inside a generated zone, as with `great-northern-road::merchant-caravan`.

### Generated Stage

A generated stage is produced deterministically from a seed and generation parameters.

Generated stages should still have stable stage IDs. The ID identifies the stage slot, not necessarily the exact terrain.

For example, `great-northern-road::road-07` should always mean "the seventh generated road slot in the Great Northern Road route", but its tile layout can vary by world seed.

This is important for save/load. A save can store "the player is in `great-northern-road::road-07`" while the world seed recreates that stage layout.

### Static Landmark

A static landmark is a hand-authored stage embedded into a generated zone topology.

Example:

```txt
great-northern-road::road-07
great-northern-road::road-08
great-northern-road::merchant-caravan
great-northern-road::road-09
```

The zone generator decides where the landmark is inserted. The landmark itself owns its authored terrain.

The current rule for the merchant caravan is:

- It must appear in the Great Northern Road.
- It must appear somewhere around road stages 6-9.
- Its exact insertion position is deterministic from the world seed.

### World Seed

The world seed is the high-level seed that controls generated world variation.

Current state:

- The default seed is effectively `gnr-map-01`.
- The Great Northern Road uses this seed to produce deterministic road stages and to place its static landmark.

Future state:

- The server should own the world seed.
- Save data should store the world seed.
- Preview tools should accept the same world seed.
- Generated stage contents should be derived from `worldSeed + zoneId + stageSlotId`.

## Design Principles

### 1. Stable Identity, Variable Particulars

Generated zones should have stable identity even when their generated contents vary.

The Great Northern Road should always be:

- The Great Northern Road
- A travel route north of Lunavik
- Mostly linear
- Generally north/south in progression
- Connected to Northern Gate
- Containing certain required landmarks

But its exact road shapes, bends, pools, grass, clearings, and widths can vary per seed.

### 2. Authorial Control Where It Matters

Procedural generation is not a replacement for design.

For memorable locations, story spaces, vendors, major encounters, or deliberately composed rooms, use static authored stages.

For travel texture, repeated wilderness, cave branches, road variations, and replayability, use deterministic generation.

The goal is not "random everything." The goal is a designed world that has controlled variation.

### 3. Zone Generators Own Zone Rules

Each generated zone should eventually have its own generator/blueprint. A zone generator should know:

- Which stages exist
- Which generated stage archetypes it uses
- Which static landmarks are required
- Where landmarks are allowed to appear
- How topology is assembled
- How exits are wired
- What validation rules must pass
- How preview output should look

The Great Northern Road generator should be allowed to become specifically good at generating the Great Northern Road. Future zones should have their own generator rules rather than overloading one universal generator too early.

### 4. Topology and Terrain Are Separate Concerns

Topology is the graph:

- Which stages exist
- Which stage connects to which
- What direction the route flows
- Which exits represent forward/back/branch/return

Terrain is the stage interior:

- Organic outline
- Walkable area
- Walls/void
- Water
- Grass
- Clearings
- Corridors
- Landmarks inside a map

The same topology pattern can support different terrain styles. For example, a road chain, cave descent, and dungeon hallway can all use route-chain topology but very different terrain generation.

### 5. Explicit Arrival Points

Exits should declare where the player appears when entering through them.

The current convention:

- Exit tile is on or near the boundary.
- Arrival tile is usually the adjacent walkable tile just inside the stage.
- Arrival tile must be walkable.
- Arrival tile must not be the exit tile itself.
- Arrival should be placed so the player understands which exit they came from.

This replaced relying purely on runtime "find an inward tile" behavior. The automatic fallback still exists for procedural compatibility, but authored/generated static outputs should use explicit arrivals.

This improves:

- Player expectations
- Exit pair readability
- Debounce behavior
- Avoiding immediate re-trigger loops
- Avoiding bad spawn tiles
- Level design control

### 6. Validation Is Part of Authoring

Validation is not optional polish. It is part of the authoring workflow.

Every stage and generated zone should be validated before being trusted. The current validation code catches real mistakes, including disconnected walkable tiles in the first merchant caravan pass.

Validation should keep expanding as the world model gets richer.

### 7. Preview Before Committing

The HTML preview exists because ASCII maps and generated topology need human judgment.

The workflow should be:

1. Generate a zone candidate from a seed.
2. Inspect the route-level HTML map.
3. Inspect individual stage cards.
4. Walk the result in game.
5. Adjust generator rules.
6. Repeat.

The HTML preview is also a possible ancestor of an in-game map system. It already expresses stage layout, route stitching, exits, arrivals, landmarks, and validation state.

## Current Architecture

### Zone Registry

File:

- `packages/shared/src/world/zoneRegistry.js`

The zone registry stores canonical zone metadata:

- `id`
- `displayName`
- `biome`
- `tags`
- `hubStageId`
- `stageIds`
- `proceduralPrefix`
- `defaultStage`

For static or mixed zones, `stageIds` should include every known stage in the zone. For generated procedural-open zones, membership can be derived from stage ID prefix.

The Great Northern Road stage list is now derived from the shared generator so the zone registry and stage registry agree about the inserted merchant caravan.

### Stage Registry

File:

- `packages/shared/src/world/stageRegistry.js`

The stage registry exposes stage definitions to the rest of the game. It contains static authored Lunavik stages and registers generated Great Northern Road and Meadows stages from their shared zone generators.

Important existing stages:

- `town-square`
- `west-gate`
- `inn`
- `shop-1`
- `northern-gate`

Generated/mixed stages:

- `great-northern-road::road-01` through `great-northern-road::road-15`
- `great-northern-road::merchant-caravan`

### Authored Stage Parser

File:

- `packages/shared/src/world/authoredStage.js`

This supports ASCII tile maps. ASCII map authoring is the chosen data format for hand-authored stage terrain and generated terrain serialization.

Current tile characters include:

```txt
. floor
# wall
W wall
^ void / impassable outside
, tall grass
~ shallow water
```

Exit markers are supplied separately through `exitMarkers`, usually as `A`, `B`, `C`, etc. The parser replaces those markers with exit tiles and records exit metadata.

Benefits of ASCII maps:

- Compact
- Human-readable
- Easy to visualize in code
- Easy to parse
- Easy to validate
- Useful for preview generation
- Future-friendly for map editing or generation tools

### Topology Compiler

File:

- `packages/shared/src/world/topology.js`

`compileRouteChain()` wires a list of stages into a bidirectional route chain.

The current roles are:

- `back`
- `forward`

Each adjacent pair is wired:

```txt
current.forward -> next.back
next.back -> current.forward
```

This supports generated stages and static landmark stages the same way as long as they expose compatible connection roles.

Future role vocabulary may include:

- `branch`
- `return`
- `secret`
- `shortcut`
- `locked`
- `one-way`

But avoid adding these until a zone requires them.

### Great Northern Road Generator

File:

- `packages/shared/src/world/generators/greatNorthernRoad.js`

This is now the reference implementation for a mixed generated/static zone.

It currently owns:

- Default world seed
- Zone ID
- Road stage count
- Forward direction pattern
- Generated stage assembly
- Merchant caravan static stage
- Merchant caravan insertion rule
- Boundary connection back to `northern-gate`
- Final-stage forward-exit removal
- Stage ID list generation

Important exports:

- `buildGreatNorthernRoadStages()`
- `buildGreatNorthernRoadStageEntries()`
- `getGreatNorthernRoadStageIds()`

The stage entries variant is useful for tooling because it includes metadata such as:

- `kind`
- `landmarkId`
- `backSide`
- `forwardSide`
- `pathRadius`
- `seed`

### The Meadows Generator

File:

- `packages/shared/src/world/generators/theMeadows.js`

The Meadows is the second generated-zone pattern. It is a loose 5x5 grid east of Lunavik, with a few missing cells and one smaller static clearing so the result is interconnected without being a perfect square.

It currently owns:

- Zone ID
- Stable 5x5-ish stage coordinate slots
- Large meadow stage generation
- A small static clearing landmark
- Cardinal neighbor exits
- Reciprocal grid connections
- Boundary connection back to Lunavik's east road
- Stage ID list generation

Important exports:

- `buildTheMeadowsStages()`
- `buildTheMeadowsStageEntries()`
- `getTheMeadowsStageIds()`
- `getTheMeadowsEntryStageId()`

### Path-First Road Stage Generator

File:

- `packages/shared/src/world/generators/pathFirstRoad.js`

This creates an individual organic road-like stage. It is terrain-focused, not zone-focused.

It:

- Chooses entry/exit points on specified sides.
- Builds a path between them.
- Carves organic playable space around the path.
- Adds clearings.
- Adds optional grass and water.
- Places explicit exits and arrivals.
- Returns an authored stage definition plus ASCII.

This is useful as a reusable terrain generator. It should not own Great Northern Road-specific landmark placement or zone topology.

### RNG Helpers

File:

- `packages/shared/src/world/generators/rng.js`

These helpers provide deterministic seeded generation:

- `createRng()`
- `intRange()`
- `choice()`

Any generated world output that needs to match between server, client, tests, and preview should use shared deterministic RNG helpers.

### Validation

File:

- `packages/shared/src/world/validation.js`

Current validation checks include:

- Stage has stable ID.
- Stage has zone ID.
- Tile grid is rectangular.
- Stage width/height match tile grid.
- Exit IDs are present and unique.
- Exit positions are in bounds.
- Exit positions are walkable.
- Explicit arrivals are present.
- Arrival positions are in bounds.
- Arrival positions are walkable.
- Arrival positions are not on exit tiles.
- Walkable area is connected.
- Stage zone exists.
- Connection targets exist.
- Connection target exits exist.
- Connections are reciprocal by default.
- Zone stage IDs exist.
- Zone stage IDs match stage zone membership.

This validation has already caught useful bugs.

Future validation should add:

- Required landmark presence per zone.
- Landmark insertion range.
- Required connection roles on static landmarks.
- Route reachability from zone entry.
- Intentional final-stage behavior.
- No dynamic leak unless explicitly allowed.
- Seed preview and stage registry match.
- Spawn table placement validity.
- Enemy spawn walkability and spacing.
- Treasure/vendor/interactable placement validity.
- Minimum/maximum stage dimensions per zone.
- Minimum route length and optional branch constraints.

## Great Northern Road: Reference Implementation

### Design Intent

The Great Northern Road is a route leaving Lunavik through the Northern Gate.

It should feel like:

- A connected road heading generally north.
- Mostly linear.
- Occasionally turning east/west.
- A mix of small and large stages.
- Organic rather than rectangular.
- Open clearings mixed with tighter paths.
- A travel zone, not a random cave.

### Current Stage Flow

The route starts:

```txt
town-square
  -> northern-gate
  -> great-northern-road::road-01
```

The generated route contains:

- 15 generated road stages
- 1 static landmark: `great-northern-road::merchant-caravan`

For the current default seed, the caravan is inserted after `road-08`.

### Caravan Rule

The caravan is a static stage embedded into the generated road.

Current requirements:

- It belongs to `great-northern-road`.
- It is static across seeds as a landmark stage.
- It must be inserted somewhere around road stages 6-9.
- Its insertion point is deterministic from the world seed.
- It exposes `back` and `forward` exits so route compilation can wire it naturally.

This proves the important future pattern:

Generated zones can contain authored landmarks without special runtime hacks.

### Final Stage Rule

The final generated road stage currently has its forward exit removed. This prevents accidentally falling through into dynamic procedural wilderness before there is a designed destination.

When a future northern destination exists, replace this rule with an explicit zone boundary connection.

## The Meadows: Grid Reference Implementation

### Design Intent

The Meadows is a broad outdoor zone east of Lunavik.

It should feel like:

- A loose grid of large fields.
- More interconnected than a road.
- Easy to wander, backtrack, and approach from different directions.
- Open, grassy, and readable.
- Not a perfect 5x5 square.

### Current Stage Flow

The route starts:

```txt
town-square
  -> the-meadows::meadow-r3c1
```

The generated zone contains:

- 22 generated meadow stages.
- 1 small static landmark: `the-meadows::a-clearing`
- Stable stage IDs based on row and column coordinates.
- A few omitted grid cells to break the perfect square.

### Connection Rule

Each stage exposes exits for neighboring meadow cells in the cardinal directions. Connections are reciprocal.

The west exit of `the-meadows::meadow-r3c1` returns to Lunavik's town square east road.

## Preview Tooling

### HTML Zone Preview

Command:

```powershell
npm run world:generate-zone-preview -- --seed gnr-map-01
```

Output:

```txt
tools/world/out/great-northern-road-preview.html
```

The preview shows:

- Stitched route layout.
- Individual stage cards.
- Generated vs static-landmark stage kind.
- Exits.
- Arrival tiles.
- Validation state.
- Dimensions.
- Seed metadata.

The stitched view places stages according to the same route topology the game uses. It aligns a stage's forward exit to the next stage's back exit.

### CLI Zone Dump

Command:

```powershell
npm run world:generate-zone -- --seed gnr-map-01
```

This prints each generated/static stage as ASCII plus validation status. It is useful for quick debugging, diffs, and copying candidate maps if needed.

### Single Stage Generator

Command:

```powershell
npm run world:generate-stage -- --seed road-test --width 42 --height 24
```

This creates a single path-first road candidate. It is useful for experimenting with terrain parameters without assembling a full zone.

### Existing Stage Preview

Command:

```powershell
npm run world:preview-stage -- northern-gate
```

This previews an existing authored stage from the registry.

## Recommended Workflow For New Generated Zones

When adding a new generated zone, use Great Northern Road as the model.

### Step 1: Define Zone Design Intent

Write down:

- What is this zone for?
- Is it traversal, combat, exploration, puzzle, town, dungeon, or resource gathering?
- What should the player feel?
- How long should it take?
- What broad direction or structure does it have?
- What must always be present?
- What can vary?

Examples:

- Road: mostly linear, readable, travel-oriented.
- Woods: winding, branching, confusing, multiple exits.
- Desert: broad, open, sparse cover, large stages.
- Mine: vertical/depth progression, dangerous branches.
- Dungeon: authored rooms plus generated connectors.

### Step 2: Define Topology Archetype

Choose or create a topology pattern.

Current implemented pattern:

- `route_chain`

Future possible patterns:

- `hub_and_spokes`
- `branching_wilds`
- `dungeon_depth`
- `authored_cluster`
- `loop_with_shortcuts`
- `main_route_with_optional_branches`

Do not build a universal topology engine too early. Add patterns when a concrete zone needs them.

### Step 3: Define Static Landmarks

List required static stages.

For each landmark define:

- Stage ID
- Zone ID
- Display name
- Required connection roles
- Allowed insertion range or placement rule
- Whether it is required or optional
- Whether it has extra exits/interiors

Example:

```txt
merchant-caravan
  required: true
  allowedAfter: road-06..road-09
  exits: back, forward
```

### Step 4: Create Zone Generator Module

Add a shared generator module under:

```txt
packages/shared/src/world/generators/
```

The generator should export:

- Stage builder for game registry
- Stage entry builder for preview tools
- Stage ID builder for zone registry

For example:

```js
buildGreatNorthernRoadStages()
buildGreatNorthernRoadStageEntries()
getGreatNorthernRoadStageIds()
```

Future zones should follow this pattern with zone-specific names.

### Step 5: Use Shared Generator In Registry And Tools

The game registry, zone registry, previewer, and tests must all use the same shared generator. Avoid copying generation logic into tools.

Good:

```txt
shared generator -> game registry
shared generator -> zone registry
shared generator -> preview tool
shared generator -> tests
```

Bad:

```txt
game has one generator
preview has copied generator
tests assume a third shape
```

### Step 6: Add Validation Tests

Add or extend tests for:

- Zone stage IDs resolve.
- Static landmarks are present.
- Landmark insertion rules hold.
- Route chain transitions resolve.
- Final exit behavior is intentional.
- World validation passes.

Validation should be the safety net that lets us iterate quickly.

### Step 7: Generate Preview

Use the HTML preview to review:

- Route shape
- Landmark placement
- Stage size variety
- Organic outlines
- Exit positions
- Arrival positions
- Obvious bad generation patterns

### Step 8: Walk It In Game

Preview catches structure. Gameplay catches feel.

After preview approval, walk the zone in-game and judge:

- Travel pacing
- Exit readability
- Camera/viewport feel
- Stage size feel
- Movement friction
- Whether the player understands the route
- Whether terrain features feel interesting or annoying

## Save/Load Implications

The intended save model is:

- Save the world seed.
- Save player stage ID and position.
- Save discovered/progression flags.
- Save deltas for modified world state only when necessary.

Do not save every generated tile grid unless the world has been modified in ways that cannot be reconstructed from the seed.

Good first save data:

```js
{
  worldSeed: 'example-seed',
  currentStageId: 'great-northern-road::road-07',
  playerPosition: { x, y },
  discoveredStages: [...],
  progressionFlags: {...}
}
```

Later, when dynamic changes exist:

```js
{
  worldDeltas: {
    'great-northern-road::merchant-caravan': {
      merchantInventoryOverrides: {...}
    },
    'some-mine::level-03': {
      openedChests: [...],
      destroyedTiles: [...]
    }
  }
}
```

## Server/Client Authority Considerations

The server should eventually own:

- World seed
- Authoritative stage generation
- Player transitions
- Spawn state
- Persistent world deltas

The client can generate or receive enough world data to render, but it should not be the authority for progression or persistence.

Because generation is deterministic shared code, both client and server can independently derive the same stage layouts from the same seed.

## Known Current Limitations

### World Seed Is Not Fully Plumbed

The default seed is currently hardcoded for the Great Northern Road path. This is acceptable for the current development pass, but the next hardening step should make world seed a first-class runtime/save concept.

### Great Northern Road Is The Only Mixed Zone

The pattern exists, but it has only one reference implementation. The next generated zone should follow the same architecture and reveal what needs to be generalized.

### Route Chain Is The Only Topology Compiler

`compileRouteChain()` is enough for Great Northern Road. Branching wilds, mines, and dungeons will likely need additional topology compilers or blueprint patterns.

### Landmark Metadata Is Still Lightweight

The caravan insertion rule is currently encoded in the generator. Future landmarks may need richer metadata:

- Required vs optional
- Placement weights
- Minimum distance from entry
- Maximum distance from boss/exit
- Biome constraints
- Branch-only placement
- Vendor/combat/safe tags

### Preview Is Static HTML

The preview is already extremely useful. Eventually it may become an interactive workbench with:

- Seed input
- Sliders
- Generator profile controls
- Stage selection
- Export/copy support
- Validation panel
- In-game map prototyping

Do not overbuild this until iteration speed requires it.

## Near-Term Hardening Plan

Recommended next steps:

1. Make `worldSeed` a first-class shared concept.
2. Add a dev/default world seed module used by registry and tools.
3. Ensure the server can provide/own the world seed.
4. Add validation for required landmarks per generated zone.
5. Add validation that static landmarks expose required connection roles.
6. Add a generic `buildGeneratedZone` pattern only after a second zone proves what should be generalized.
7. Improve preview metadata display for landmarks and route slots.
8. Walk Great Northern Road in-game and tune the generator for feel.
9. Add the next zone using Great Northern Road as the template.

## Decision Log

### Use Zones And Stages, Not Regions

Decision:

- Keep only zones and stages.

Reason:

- Regions were redundant for current needs.
- Zone is the useful grouping for gameplay, generation, metadata, and presentation.

### Use ASCII Maps

Decision:

- Use ASCII maps as the primary authored terrain representation.

Reason:

- Raw tile arrays do not scale for authoring.
- ASCII maps are compact, readable, parseable, previewable, and easy to validate.

### Use Explicit Arrivals

Decision:

- Exits should define explicit arrival tiles.

Reason:

- Player placement is a level design decision.
- It improves consistency and prevents edge cases around debounce and bad spawn tiles.

### Use Shared Generators

Decision:

- Game, preview, tests, and CLI tools should call shared generator code.

Reason:

- Avoids drift between what we preview and what players walk.

### Generated Zones Can Contain Static Stages

Decision:

- Generated zone assembly must support static authored landmarks.

Reason:

- Real game worlds need both replayable variation and memorable authored places.

### Great Northern Road Is The Reference Implementation

Decision:

- Harden Great Northern Road first before adding many more zones.

Reason:

- It proves the pipeline:
  - Seeded generation
  - Static landmark insertion
  - Route topology
  - Explicit exits/arrivals
  - Validation
  - HTML preview
  - In-game walking

## Current Useful Commands

Generate Great Northern Road preview:

```powershell
npm run world:generate-zone-preview -- --seed gnr-map-01
```

Generate The Meadows preview:

```powershell
npm run world:generate-zone-preview -- --zone the-meadows --seed meadows-map-01
```

Open:

```txt
tools/world/out/great-northern-road-preview.html
tools/world/out/the-meadows-preview.html
```

Dump zone ASCII to terminal:

```powershell
npm run world:generate-zone -- --seed gnr-map-01
npm run world:generate-zone -- --zone the-meadows --seed meadows-map-01
```

Preview a registered stage:

```powershell
npm run world:preview-stage -- northern-gate
```

Generate one road candidate:

```powershell
npm run world:generate-stage -- --seed road-test --width 42 --height 24
```

Run key validation:

```powershell
node packages/shared/tests/world-validation.test.mjs
node packages/shared/tests/zones.test.mjs
node packages/shared/tests/authored-stage.test.mjs
```

Build:

```powershell
npm run -s build
```

## Summary

The current world generation strategy is:

- Use zones as the main world organization layer.
- Use stable stage IDs.
- Generate variable terrain from a world seed.
- Keep important places static.
- Allow generated zones to embed static landmarks.
- Compile topology from connection roles.
- Use explicit arrival tiles.
- Validate aggressively.
- Preview generated worlds in HTML before committing to them.
- Treat Great Northern Road as the route-chain reference and The Meadows as the grid-zone reference.

This gives Clay and Blood a path toward a world that is authored where it matters, variable where replayability matters, and testable enough that world generation bugs are caught early.
