# ECS Architecture Contract

This document defines the baseline rules for client-side ECS architecture.

## Non-Negotiables

- Entities are composition containers only, not behavior objects.
- Components are data-first and narrowly scoped.
- Systems own behavior and are the only layer that should orchestrate cross-component flow.
- Input source details (keyboard, gamepad, AI, network) must not leak into gameplay systems.
- Control handoff (for possession and remote takeover) must be evented and observable.

## Control vs Authority

- `ControlComponent` answers: who is currently driving intent for this entity.
- `AuthorityComponent` answers: which simulation side is authoritative for state.
- These are intentionally separate:
  - Control can change frequently (local player, AI, possession target).
  - Authority is a networking/simulation ownership rule and should change rarely.

## Resolved Intent Shape

`IntentComponent` stores resolved intent, not raw input:

- `moveX`: float in `[-1, 1]`
- `moveY`: float in `[-1, 1]`
- `wantsSprint`: boolean
- `wantsDash`: boolean edge-trigger intent
- `wantsAttackPrimary`: boolean edge-trigger intent
- `wantsAttackSecondary`: boolean edge-trigger intent
- `aimX`: float
- `aimY`: float

Any controller (keyboard, AI, replay, network ghost) should write this same shape.

## Canonical System Order

Systems must execute in this order to avoid one-frame lag and hidden race conditions:

1. `InputIntentSystem` (produce/refresh intent)
2. `LocomotionSystem` (intent -> desired velocity)
3. `DashSystem` (dash overrides / dash state transitions)
4. `PhysicsSystem` (integrate + collide)
5. `TransformSyncSystem` (physics -> transform)
6. `VisualSyncSystem` (transform -> Phaser game object)
7. `PresentationSystem` (HUD/VFX/UI-only feedback)

Order is an engine contract, not a convention.

Current implementation anchor:

- `GameScene.fixedUpdate()` executes explicit phase arrays in canonical order.
- `InputIntentSystem`, `LocomotionSystem`, and `DashSystem` run explicitly in that order each fixed tick.
- Combat triggers (primary/secondary + aim) are routed through `IntentComponent` and gated by `ControlComponent`.
- `CombatSystem` consumes attack intent and invokes weapon actions before physics.
- `PlayerStateMachine` now owns locomotion/dash only; weapon/combat state lives in `PlayerCombatComponent`.
- Systems run local simulation only when `AuthoritySystem.canSimulateOnClient(entity)` is true.
- `GameRoom` server tick now runs explicit phase functions in order: input/intent -> locomotion+dash -> physics/transform -> snapshot/history -> broadcast.
- `GameRoom` player state is now component-like (`transform`, `intent`, `motion`, `stats`, `net`) to mirror ECS semantics.
- Server phase logic is centralized in shared adapter functions (`@clay-and-blood/shared/server-tick`).
- `EntityManager.updateComponents()` applies ordered phase updates.
- `EntityManager.updateRemainingComponents()` is a temporary fallback for unmapped components.

## Event Contract

When control routing changes, emit:

- Event name: `control:changed`
- Payload:
  - `entityId`
  - `controlMode`: `'local' | 'remote' | 'ai' | 'disabled'`
  - `controllerId`: string or `null`
  - `previousControlMode`
  - `previousControllerId`
  - `reason`: string

Systems that consume intent routing should subscribe to this event instead of polling for handoff transitions.

## Migration Guardrails

- Legacy wrappers are temporary scaffolding only.
- Do not add new features to compatibility wrappers.
- Remove wrappers once all call sites are migrated.

## Known Future Need

- Parent/child transforms (entity hierarchy) are expected for equipped items, indicators, and camera anchors.
- Add this as a first-class ECS concern when attachment gameplay begins, not as ad-hoc per-feature code.
