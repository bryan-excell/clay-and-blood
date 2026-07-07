# Environment Rendering Strategy

## Purpose

The environment renderer should support strong spirit-world visuals without turning terrain authoring into a tileset project.

The core rule is:

```txt
gameplay grid -> terrain fields -> material textures -> response decoration -> atmosphere
```

Do not add a second renderer that treats grass, water, or ground as independent sprite-tile systems. If a visual belongs to a surface type, route it through the field and material pipeline.

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
