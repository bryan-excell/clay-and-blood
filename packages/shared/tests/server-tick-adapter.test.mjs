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
        transform: { x: 100, y: 100, levelId: 'town-square' },
        intent: { up: false, down: false, left: false, right: true, sprint: false },
        motion: { dashVx: 0, dashVy: 0, dashTimeLeftMs: 0 },
        stats: { hp: 100 },
        net: { lastSeq: 7 },
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

    const snapshotPlayers = phaseBuildSnapshotPlayers(players);
    assert.equal(snapshotPlayers.length, 1);
    assert.equal(snapshotPlayers[0].seq, 7);
    assert.equal(snapshotPlayers[0].levelId, 'town-square');
    assert.equal(snapshotPlayers[0].teamId, 'players');
    assert.equal(snapshotPlayers[0].sightRadius, 320);

    const history = phaseBuildHistoryPositions(players);
    const h = history.get('p1');
    assert.ok(h, 'history should include player');
    assert.equal(h.levelId, 'town-square');
}

function run() {
    testAdapterPipeline();
    console.log('shared server tick adapter tests passed');
}

run();
