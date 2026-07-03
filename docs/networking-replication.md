# Networking And Replication Contract

This document captures the current multiplayer movement model and the rules for
adding future movement without reintroducing jitter or rubber-banding.

## Goals

- Local controlled movement should feel immediate.
- The server remains authoritative for gameplay state.
- Remote players and world entities should render smoothly from server snapshots.
- Client prediction must reconcile from the exact server state associated with
  the server's last processed input command.

## High-Level Flow

1. The client samples local intent during `GameScene.fixedUpdate()`.
2. The client predicts local player movement immediately with shared kinematics.
3. The client sends one sequenced `PLAYER_INPUT` command for that fixed step.
4. `GameRoom` enqueues the command and processes it inside the authoritative tick.
5. The server broadcasts `STATE_SNAPSHOT` with authoritative positions, metadata,
   and `lastProcessedInputSeq`.
6. The local client reconciles itself; other clients interpolate remote snapshots.

The client never sends its position as movement authority. It sends input
commands. The server simulates those commands.

## Local Player Prediction

Local player movement uses client-side prediction:

- `NetworkManager.sendInput()` sends a command with `seq` and `dtMs`.
- `GameScene` stores the same command in `_pendingInputBuffer`.
- The command buffer stores the movement state that existed before the command:
  `{ seq, input, preMovementState, dt }`.
- The server snapshots `lastProcessedInputSeq`, not merely the last received seq.

When a snapshot arrives for the local player, `GameScene._applyServerCorrection()`
does this:

1. Drops every pending command whose `seq <= lastProcessedInputSeq`.
2. Starts from the server's authoritative `x`, `y`, and `movementState`.
3. Replays only the remaining unprocessed commands through `stepPlayerKinematics()`.
4. Updates local transform/body and local movement state to the replayed result.
5. Blends only the visual/camera correction offset so simulation stays exact.

This is the Gambetta-style prediction/reconciliation loop. The important detail
is that the server ack and the replicated movement state describe the same
authoritative moment.

## Remote Replication

Remote players are not predicted locally. Their snapshots are buffered and
sampled behind real time:

- `GameScene._pushRemoteSnapshot()` records server positions by tick/time.
- `renderUpdate()` samples those tracks with interpolation delay.
- This is why remote players can look smooth even when local reconciliation is
  broken: remote replication and local prediction are different paths.

World entities use the same general snapshot idea. Continuous world-state
updates should be treated as replication streams. Hard resyncs should clear stale
buffers only when the authoritative scope actually invalidates them.

## Movement State

Movement state is distinct from position and input.

Server-side `GameRoom` stores the authoritative component as `player.motion`.
Snapshot payloads expose it as `movementState`:

```js
{
  dash: { vx, vy, timeLeftMs },
  externalVelocity: { vx, vy, timeLeftMs }
}
```

The shared helpers normalize both flat internal state and nested snapshot state:

- `normalizeMovementState()`
- `movementStateForSnapshot()`
- `stepPlayerKinematics()`

Dash currently uses the `dash` lane. Future server-owned pushes use the
`externalVelocity` lane unless they need a richer model.

## Adding Future Movement

### Input-Predicted Movement

Examples: dash, dodge, roll, input-driven sprint bursts.

Use this path when the local player should feel the action immediately.

- Add the input edge or command data to the fixed-step `PLAYER_INPUT` command.
- Predict it locally before sending the command.
- Validate/accept it on the server while processing that command.
- Store any continuing state in `motion`.
- Include that state in snapshot `movementState`.
- Reconcile by restoring server movement state, then replaying pending commands.

Do not add a separate client-only movement timer outside the movement state.

### Server-Owned Movement

Examples: enemy knockback, wind, hazards, traps, traction, conveyor movement,
launches, roots, forced pulls.

Use this path when the server decides the movement happened.

- Apply the effect to authoritative `motion`, usually `externalVx`,
  `externalVy`, and `externalTimeLeftMs`.
- Let `stepPlayerKinematics()` integrate it on the server.
- Snapshot the resulting `movementState`.
- The local client will pick it up on reconciliation and replay pending inputs on
  top of it.

If future effects need stacking, friction curves, IDs, or cancellation rules,
extend `movementState` and `stepPlayerKinematics()` in shared code first. Do not
create a one-off correction path in `GameScene`.

### Terrain And Speed Modifiers

Terrain speed is derived from authoritative position during simulation/replay.
The client should not send terrain-applied speed as hidden authority.

Current flow:

- The client sends base input plus local action modifiers.
- Client prediction applies terrain at the predicted position.
- Server processing applies terrain at the authoritative position.
- Replay applies terrain at each replayed position.

That keeps terrain deterministic enough for reconciliation.

## Anti-Regression Rules

- Do not throttle `PLAYER_INPUT` below the client fixed update rate.
- Do not acknowledge movement from `lastReceivedInputSeq`; use
  `lastProcessedInputSeq`.
- Do not mutate player movement directly when a `PLAYER_INPUT` packet arrives.
  Enqueue it and process it in the server tick.
- Do not reconcile local player movement from position alone. Position must be
  paired with authoritative `movementState`.
- Do not solve simulation jitter with visual smoothing. Visual smoothing may hide
  a correction, but the correction itself must come from deterministic replay.
- Do not add new movement outside shared kinematics unless it is purely cosmetic.
- Do not let remote interpolation logic influence local player prediction.

## File Map

- `apps/client/src/core/NetworkManager.js`: sends sequenced fixed-step input.
- `apps/client/src/scenes/GameScene.js`: predicts local movement, buffers inputs,
  reconciles local snapshots, and interpolates remote tracks.
- `apps/server/src/GameRoom.js`: enqueues inputs, runs authoritative movement,
  builds snapshots, and owns gameplay validation.
- `packages/shared/src/index.js`: shared movement constants, movement-state
  helpers, and deterministic kinematics.
- `packages/shared/src/serverTickAdapter.js`: pure server tick helper functions
  used by tests.
- `packages/shared/tests/*`: regression coverage for physics, tick flow, and
  snapshot movement-state shape.

## Debugging Checklist

When movement feels jittery:

1. Check whether the jitter affects only the local player or also remote players.
2. Log correction distance, `lastProcessedInputSeq`, pending buffer length, and
   snapshot `movementState`.
3. If remote players are smooth but local is not, inspect prediction/replay first.
4. If jitter appears only during a movement ability, verify that ability's
   continuing state is replicated in `movementState`.
5. If corrections cluster around high speed or state transitions, look for hidden
   state that exists on one side but not the other.
