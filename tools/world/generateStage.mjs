#!/usr/bin/env node
import { validateStageDefinition } from '../../packages/shared/src/index.js';
import { generatePathFirstRoadStage } from './lib/generators/pathFirstRoad.mjs';
import { printStageSummary, stageToAscii } from './lib/asciiMap.mjs';

const GENERATORS = Object.freeze({
    'path-first-road': generatePathFirstRoadStage,
    road: generatePathFirstRoadStage,
});

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) continue;
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) {
            args[key] = true;
            continue;
        }
        args[key] = next;
        i++;
    }
    return args;
}

function numberArg(args, key) {
    if (args[key] === undefined) return undefined;
    const value = Number(args[key]);
    if (!Number.isFinite(value)) throw new Error(`--${key} must be a number`);
    return value;
}

function printUsage() {
    console.log([
        'Usage: npm run world:generate-stage -- --generator road --seed gnr-01 --width 42 --height 22',
        '',
        'Options:',
        '  --generator path-first-road|road',
        '  --id <stage-id>',
        '  --seed <seed>',
        '  --width <tiles>',
        '  --height <tiles>',
        '  --back <north|east|south|west>',
        '  --forward <north|east|south|west>',
        '  --wander <0..1>',
        '  --path-radius <tiles>',
        '  --clearings-min <count>',
        '  --clearings-max <count>',
        '  --no-arrivals',
    ].join('\n'));
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printUsage();
        return;
    }

    const generatorName = args.generator ?? 'road';
    const generator = GENERATORS[generatorName];
    if (!generator) throw new Error(`Unknown generator "${generatorName}"`);

    const { stage } = generator({
        id: args.id ?? `great-northern-road::candidate-${args.seed ?? 'seed'}`,
        displayName: args.name ?? 'Generated Road Candidate',
        seed: args.seed,
        width: numberArg(args, 'width'),
        height: numberArg(args, 'height'),
        backSide: args.back,
        forwardSide: args.forward,
        wander: numberArg(args, 'wander'),
        pathRadius: numberArg(args, 'path-radius'),
        clearingsMin: numberArg(args, 'clearings-min'),
        clearingsMax: numberArg(args, 'clearings-max'),
        tallGrassChance: numberArg(args, 'tall-grass'),
        waterChance: numberArg(args, 'water'),
    });

    const issues = validateStageDefinition(stage);
    console.log(printStageSummary(stage));
    console.log(`validation: ${issues.length === 0 ? 'ok' : `${issues.length} issue(s)`}`);
    for (const issue of issues) {
        console.log(`  - ${issue.code}: ${issue.message}`);
    }
    console.log('');
    console.log(stageToAscii(stage, { showArrivals: args['no-arrivals'] !== true }));
}

main();
