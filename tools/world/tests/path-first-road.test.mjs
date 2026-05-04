import assert from 'node:assert/strict';
import { validateStageDefinition } from '../../../packages/shared/src/index.js';
import { generatePathFirstRoadStage } from '../lib/generators/pathFirstRoad.mjs';

function testGeneratedRoadCandidatesValidate() {
    const sides = [
        ['south', 'north'],
        ['south', 'east'],
        ['west', 'north'],
        ['east', 'west'],
    ];
    for (let i = 0; i < 24; i++) {
        const [backSide, forwardSide] = sides[i % sides.length];
        const { stage } = generatePathFirstRoadStage({
            id: `great-northern-road::candidate-${i}`,
            seed: `road-candidate-${i}`,
            width: 24 + (i % 5) * 8,
            height: 14 + (i % 4) * 5,
            backSide,
            forwardSide,
            wander: 0.25 + (i % 4) * 0.1,
        });
        assert.deepEqual(validateStageDefinition(stage), [], `candidate ${i} should validate`);
    }
}

testGeneratedRoadCandidatesValidate();
console.log('path-first-road generator tests passed');
