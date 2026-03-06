import assert from 'node:assert/strict';
import {
    PLAYER_SPEED,
    PLAYER_SPRINT_MULTIPLIER,
    PLAYER_DASH_SPEED,
    PLAYER_DASH_DURATION,
    dashStateFromInput,
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

function run() {
    testDashStateFromInputNormalized();
    testDashOverridesWalkIntentDuringDashWindow();
    testLocomotionResumesAfterDashExpires();
    console.log('shared tick pipeline tests passed');
}

run();
