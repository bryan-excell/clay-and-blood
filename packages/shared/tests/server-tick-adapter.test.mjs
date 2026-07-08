import assert from 'node:assert/strict';
import {
    phaseInputIntent,
    phaseLocomotionDash,
    phasePhysicsTransform,
    phaseBuildSnapshotPlayers,
    phaseBuildHistoryPositions,
} from '../src/serverTickAdapter.js';

function makePlayer() {
    return {
        transform: { x: 100, y: 100, levelId: 'nativity' },
        intent: { up: false, down: false, left: false, right: true, sprint: false },
        motion: {
            dashVx: 0,
            dashVy: 0,
            dashTimeLeftMs: 0,
            externalVx: 40,
            externalVy: 0,
            externalTimeLeftMs: 100,
        },
        stats: { hp: 100 },
        net: { lastSeq: 7, lastReceivedInputSeq: 9, lastProcessedInputSeq: 8 },
        teamId: 'players',
        sightRadius: 320,
    };
}

function testAdapterPipeline() {
    const players = new Map([['p1', makePlayer()]]);
    const inputEntries = phaseInputIntent(players, () => null);
    assert.equal(inputEntries.length, 1);

    const locomotionEntries = phaseLocomotionDash(inputEntries, 50);
    phasePhysicsTransform(players, locomotionEntries);

    const p1 = players.get('p1');
    assert.ok(p1.transform.x > 100, 'expected movement along +x');
    assert.equal(p1.motion.externalTimeLeftMs, 50);

    const snapshotPlayers = phaseBuildSnapshotPlayers(players);
    assert.equal(snapshotPlayers.length, 1);
    assert.equal(snapshotPlayers[0].seq, 8);
    assert.equal(snapshotPlayers[0].lastReceivedInputSeq, 9);
    assert.equal(snapshotPlayers[0].lastProcessedInputSeq, 8);
    assert.equal(snapshotPlayers[0].levelId, 'nativity');
    assert.deepEqual(snapshotPlayers[0].movementState.dash, { vx: 0, vy: 0, timeLeftMs: 0 });
    assert.deepEqual(snapshotPlayers[0].movementState.externalVelocity, { vx: 40, vy: 0, timeLeftMs: 50 });
    assert.equal(snapshotPlayers[0].teamId, 'players');
    assert.equal(snapshotPlayers[0].sightRadius, 320);

    const history = phaseBuildHistoryPositions(players);
    const h = history.get('p1');
    assert.ok(h, 'history should include player');
    assert.equal(h.levelId, 'nativity');
}

function run() {
    testAdapterPipeline();
    console.log('shared server tick adapter tests passed');
}

run();
