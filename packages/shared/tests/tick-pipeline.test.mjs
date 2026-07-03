import assert from 'node:assert/strict';
import {
    PLAYER_SPEED,
    PLAYER_SPRINT_MULTIPLIER,
    PLAYER_DASH_SPEED,
    PLAYER_DASH_DURATION,
    dashStateFromInput,
    movementStateForSnapshot,
    normalizeMovementState,
    stepPlayerKinematics,
} from '../src/index.js';

const EPS = 1e-6;

function nearlyEqual(a, b, eps = EPS) {
    return Math.abs(a - b) <= eps;
}

function testDashStateFromInputNormalized() {
    const dash = dashStateFromInput({ up: true, right: true });
    assert.ok(dash, 'dash state should exist for directional input');
    const speed = Math.sqrt(dash.dashVx ** 2 + dash.dashVy ** 2);
    assert.ok(nearlyEqual(speed, PLAYER_DASH_SPEED), `expected normalized dash speed, got ${speed}`);
    assert.equal(dash.dashTimeLeftMs, PLAYER_DASH_DURATION);
}

function testDashOverridesWalkIntentDuringDashWindow() {
    const start = {
        x: 100,
        y: 100,
        dashVx: PLAYER_DASH_SPEED,
        dashVy: 0,
        dashTimeLeftMs: 200,
    };

    const out = stepPlayerKinematics(start, { left: true, sprint: true }, 50, null);
    assert.ok(out.x > start.x, 'dash should override opposite locomotion input');
    assert.equal(out.vx, PLAYER_DASH_SPEED);
    assert.equal(out.dashTimeLeftMs, 150);
}

function testLocomotionResumesAfterDashExpires() {
    const start = {
        x: 100,
        y: 100,
        dashVx: PLAYER_DASH_SPEED,
        dashVy: 0,
        dashTimeLeftMs: 50,
    };

    // First tick consumes the remaining dash window.
    const afterDashTick = stepPlayerKinematics(start, { up: true, sprint: true }, 50, null);
    assert.equal(afterDashTick.dashTimeLeftMs, 0);

    // Second tick should use locomotion intent.
    const out = stepPlayerKinematics(afterDashTick, { up: true, sprint: true }, 50, null);
    const expectedVy = -PLAYER_SPEED * PLAYER_SPRINT_MULTIPLIER;

    assert.ok(nearlyEqual(out.vy, expectedVy), `expected sprint vy ${expectedVy}, got ${out.vy}`);
    assert.ok(out.y < afterDashTick.y, 'entity should move upward once dash ends');
}

function testExternalVelocityAddsToMovementState() {
    const start = {
        x: 100,
        y: 100,
        externalVx: 120,
        externalVy: -40,
        externalTimeLeftMs: 50,
    };

    const out = stepPlayerKinematics(start, {}, 50, null);

    assert.ok(nearlyEqual(out.vx, 120), `expected external vx 120, got ${out.vx}`);
    assert.ok(nearlyEqual(out.vy, -40), `expected external vy -40, got ${out.vy}`);
    assert.ok(nearlyEqual(out.x, 106), `expected x 106, got ${out.x}`);
    assert.ok(nearlyEqual(out.y, 98), `expected y 98, got ${out.y}`);
    assert.equal(out.externalTimeLeftMs, 0);
}

function testMovementStateSnapshotRoundTrip() {
    const snapshot = movementStateForSnapshot({
        dashVx: PLAYER_DASH_SPEED,
        dashVy: 0,
        dashTimeLeftMs: 125,
        externalVx: -90,
        externalVy: 30,
        externalTimeLeftMs: 75,
    });
    const normalized = normalizeMovementState(snapshot);

    assert.equal(normalized.dashVx, PLAYER_DASH_SPEED);
    assert.equal(normalized.dashTimeLeftMs, 125);
    assert.equal(normalized.externalVx, -90);
    assert.equal(normalized.externalVy, 30);
    assert.equal(normalized.externalTimeLeftMs, 75);
}

function run() {
    testDashStateFromInputNormalized();
    testDashOverridesWalkIntentDuringDashWindow();
    testLocomotionResumesAfterDashExpires();
    testExternalVelocityAddsToMovementState();
    testMovementStateSnapshotRoundTrip();
    console.log('shared tick pipeline tests passed');
}

run();
