# Particle Rendering System

The client uses particles as a primary rendering tool for dynamic entity art. The goal is not to make every object a loose visual effect; the goal is to build readable entity visuals from small reusable generated textures, emitter profiles, and lightweight render rigs.

Gameplay state remains separate from particle rendering. Transforms, health, collision, targeting, visibility, and authority still come from ECS/shared/server systems. Particle systems read that state and communicate it visually.

## Core Concepts

### Generated Textures

Particle textures are generated at runtime by `ParticleTextureFactory`.

Current texture keys include:

- `particle-soft`: soft circular particle for body mass, glows, and bursts.
- `particle-dot`: small hard mote for dense ambient fields.
- `particle-streak`: elongated particle for trails and projectile wakes.
- `spirit-core`: stable high-contrast center texture.
- `spirit-mote`: small soft mote for controlled orbit particles.

These textures are white by design. Color is applied by tinting emitters or sprites, which keeps the system asset-light and palette-driven.

### Particle Profiles

`particleProfiles.js` defines reusable profile specs for normal entity visuals. Profiles describe texture, blend mode, depth, budget, emitter shape, base emission behavior, modifiers, and bursts.

Profiles are compiled by `ParticleProfileCompiler` into Phaser emitter configs. Future profiles should stay declarative where possible. Use the compiler to resolve palette colors, semantic colors, emit zones, and budget constraints.

Use profile-based `ParticleComponent` for entities that can be represented by one continuous emitter plus optional bursts: simple enemies, loot, exits, projectiles, interactables, and environmental effects.

### Spirit Forms

Important entities can use `SpiritFormComponent` instead of a single emitter. A spirit form is a small layered render rig:

- Stable core sprite for identity and hitbox readability.
- Core glow for emphasis.
- Controlled orbit motes for readable motion and cohesion.
- Body cloud emitter for soft mass.
- Trail emitter for movement history.
- Burst emitter path for damage, death, and flinch feedback.

Use spirit forms when an entity needs a consistently readable center plus richer motion/state expression. The player uses this path. Replicated players use a lighter non-ECS `RemoteSpiritVisual` with the same general structure.

## State And Events

Persistent visual state is handled by `ParticleModifierSystem`.

Examples:

- `low_hp`
- `dashing`
- `controlled`
- `possessed`
- `hostile`

One-shot visual events are handled by `ParticleEventSystem`.

Examples:

- damage burst
- flinch burst
- death burst
- cleanse/world reset burst

Keep this split intact. Continuous conditions should be modifiers. Instant feedback should be event bursts.

## Structural Anchors

Existing `CircleComponent` and `RectangleComponent` visuals are currently kept as hidden structural anchors. They are still used by camera follow, interpolation, hover logic, damage anchors, exit proximity, and other gameplay-adjacent systems.

Do not remove these components from an entity just because particles now render the visible body. First audit whether the shape is still being used as an anchor or logical bound.

Set `VITE_DEBUG_VISUAL_ANCHORS=1` to make these anchors visible while debugging.

## Visibility And Fog

Actor particles and spirit-form objects must be registered with `LightingRenderer` so they respect fog-of-war visibility masking.

Ambient particles are different. They are world atmosphere, not actors, and can remain unmasked as long as they do not reveal entity positions. They still render below the darkness layer, so unexplored or unseen space remains dark.

## Rendering Priorities

Particle visuals should preserve gameplay readability.

Recommended priority order:

1. Player core and controlled entity
2. Immediate threats
3. Interactables and objectives
4. Enemy bodies
5. Trails and aura effects
6. Ambient particles
7. Decorative effects

The brightest, sharpest, most stable visual point should usually belong to the player or currently controlled entity.

## Authoring Guidance

When adding or revising entity art, choose the smallest rendering structure that communicates the entity clearly:

- Use `ParticleComponent` plus a profile for simple particle bodies.
- Use `SpiritFormComponent` or a similar layered rig for high-importance entities.
- Use event bursts for short feedback moments.
- Use modifiers for persistent gameplay states.
- Use semantic colors for gameplay meaning and palette colors for local atmosphere.

Avoid relying on color alone. A good particle visual should also communicate through behavior: cohesion, orbit speed, emission rate, trail length, jitter, contraction, expansion, and burst intensity.

Every particle layer should have a job. If a layer does not improve identity, motion, state readability, interaction feedback, or atmosphere, it should probably be removed or reduced.

## Performance Philosophy

The system favors many small reusable textures and bounded emitters over bespoke image assets. Each profile or rig should define reasonable particle limits. Continuous emitters should stay modest; high-count effects should be short-lived.

Prefer:

- Generated textures.
- Shared profiles.
- Short burst lifetimes.
- Camera/visibility-aware updates.
- Stable anchors for gameplay logic.

Avoid:

- Long opaque trails that hide hitboxes.
- Large always-on emitters for simple entities.
- Decorative particles with no readability purpose.
- Using particles as authoritative gameplay data.
