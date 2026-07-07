# Environment Rendering Strategy

## Purpose

The environment renderer should support strong spirit-world visuals without turning terrain authoring into a tileset project.

The core rule is:

```txt
gameplay grid -> terrain fields -> material textures -> response decoration -> atmosphere
```

Do not add a second renderer that treats grass, water, or ground as independent sprite-tile systems. If a visual belongs to a surface type, route it through the field and material pipeline.

## Layer Stack

The environment is built in layers. Each layer has one job, and higher layers should not rewrite the responsibilities of lower layers.

### 1. Gameplay Truth

The shared tile grid is the source of gameplay truth.

This layer answers:

- can the player walk here?
- does this tile block vision?
- does this tile change movement speed?
- is this an exit?
- is this broadly floor, wall, tall grass, or shallow water?

This layer should remain renderer-agnostic. It should not know about texture files, glow, edge treatment, particle behavior, or art direction.

### 2. Terrain Fields

`TerrainFieldCompiler` converts gameplay truth into render-friendly fields.

This layer answers:

- what visual material should this cell use?
- is this cell part of a grass or water region?
- how close is this cell to a grass, water, or wall edge?
- how open or enclosed is this cell?
- what deterministic noise values can renderers sample?

Fields are the bridge between generation and art. If a future visual needs spatial knowledge, prefer adding or deriving a field instead of hard-coding neighbor logic in a renderer.

### 3. Material/Base Environment

`ChunkedBaseRenderer` draws the actual terrain material.

This layer answers:

- which material texture is visible at this cell?
- how do ground, path, tall grass, and water fill the world?
- where are simple wall blocks visible?

This is the main environment art layer. It currently draws tileable material textures through `TerrainMaterialRegistry` and does not add decorative response effects.

### 4. Decoration/Response

`TerrainDecorationRenderer` is reserved for field-driven environmental response.

This layer may eventually answer:

- should grass sway here?
- should water ripple here?
- should a boundary glow, dim, or shimmer?
- should a spiritual force change local motion or particles?

This layer is currently disabled. When re-enabled, it should add small, intentional behavior over the material layer, not become a second grass/water/path rendering system.

### 5. Atmosphere/Depth

`EnvironmentalDepthRenderer` and `ZoneAmbientParticleSystem` are reserved for zone-level mood and depth.

This layer may eventually own:

- distant silhouettes
- veils
- ambient motes
- slow parallax
- zone-level spiritual weather

This layer is currently disabled while terrain materials are being evaluated. When re-enabled, it must stay quieter than gameplay surfaces and the player.

### 6. Lighting And Fog Of War

`LightingRenderer` sits above environment rendering and controls what the player can see.

This layer answers:

- what parts of the world are visible?
- what entities are hidden outside field of view?
- how dark is unexplored or unseen space?

Lighting is presentation, but it communicates gameplay visibility. It should not paint terrain details.

### 7. Entities And UI

Characters, interactables, projectiles, spirit particles, and UI sit above the environment.

The player-controlled Intelligence must remain visually sovereign. Environment layers should support the player silhouette and gameplay readability, not compete with them.

## Current Baseline

The active baseline is intentionally minimal:

```txt
gameplay grid -> terrain fields -> material textures -> simple walls -> lighting/FOV -> entities/UI
```

Decoration and atmosphere layers exist as reserved extension points, but they are not currently active. This keeps evaluation focused on whether the terrain material foundation is working.

## Ownership

### Gameplay Grid

The shared tile grid owns gameplay truth:

- walkable vs solid
- movement multipliers
- vision blocking
- exits
- broad terrain type

The grid should not know about texture filenames, visual edge blending, particle density, or local decoration art.

### Terrain Field Compiler

`TerrainFieldCompiler` turns the grid and terrain features into renderable scalar fields.

It owns derived visual data such as:

- material id
- grass mask
- water mask
- wall mask
- signed distance to grass edge
- signed distance to water edge
- wall distance
- openness
- seeded noise fields

New environment behavior should usually start here. For example, if a future corrupted zone needs hostile root influence, add a corruption field rather than hard-coding renderer neighbor checks.

### Material Registry

`TerrainMaterialRegistry` maps terrain material ids to tileable material textures in `apps/client/src/assets/environment/materials`.

Current material assets:

- `spirit-ground.png`
- `spirit-path.png`
- `spirit-tallgrass.png`
- `spirit-water.png`

These are seamless source materials, not classic authored tilemaps. The renderer slices them into frame-aligned chunks at runtime so the same texture can cover arbitrary generated terrain.

### Base Renderer

`ChunkedBaseRenderer` draws the material layer.

It owns:

- chunk lifecycle for static terrain render textures
- drawing material texture frames
- fallback fills if a texture is missing
- wall rendering

It should not draw dense grass blades, decorative water pools, biome-specific doodads, edge tinting, or surface veining. The current baseline is material textures plus minimal wall blocks.

### Decoration Renderer

`TerrainDecorationRenderer` is a response layer over the material base.

It is currently intentionally disabled while the material foundation is being evaluated.

When re-enabled later, it may own:

- subtle grass glow
- grass edge cues
- grass wind strokes
- water ripple strokes
- water edge cues

It should not be the primary source of grass, ground, path, or water appearance. The supplied material textures must remain visually dominant, and response effects should be added back one behavior at a time.

### Atmosphere

`EnvironmentalDepthRenderer` and `ZoneAmbientParticleSystem` provide zone-level atmosphere.

Atmosphere is currently disabled while the material foundation is being evaluated.

When re-enabled later, it should stay lower priority than gameplay surfaces and the player. Avoid dense screen-wide particles while tuning terrain readability.

## Anti-Regression Rules

- Do not reintroduce `SpiritGrassAssets` or cropped grass sprite stamps as the grass foundation.
- Do not stamp decorative PNGs once per terrain cell as a replacement for materials.
- Do not use `Image.setCrop(...)` loops for material drawing into render textures. Use registered texture frames and `drawFrame`.
- Do not make the decoration renderer compete with material textures.
- Do not put gameplay collision or navigation rules in renderers.
- Do not add edge-piece tilesets for grass/water/path transitions. Use terrain fields and distance fields.

## Adding A Surface Type

To add a surface such as corruption, ash, sacred stone, or memory glass:

1. Add or derive a material id in `TerrainFieldCompiler`.
2. Add a seamless material texture under `apps/client/src/assets/environment/materials`.
3. Register it in `TerrainMaterialRegistry`.
4. Add only response behavior to `TerrainDecorationRenderer` if the material needs edge cues, glow, sway, ripple, or other motion.
5. Keep gameplay rules in shared tile data or generation code.

## Current Limitation

The generated road stages still use one generic `floor` tile for both road path and clearing/ground. Visually, `floor` currently maps to `spirit-ground.png`.

The next foundation upgrade should split the visual field into at least:

- ground
- path
- tall grass
- water

That split should happen in `TerrainFieldCompiler` as a visual/material field. It should not require changing movement or collision semantics unless gameplay also needs a distinction.
