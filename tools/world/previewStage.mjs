#!/usr/bin/env node
import {
    getAllAuthoredStageDefinitions,
    getStageDefinition,
    validateStageDefinition,
} from '../../packages/shared/src/index.js';
import { printStageSummary, stageToAscii } from './lib/asciiMap.mjs';

function parseArgs(argv) {
    const args = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) {
            args._.push(arg);
            continue;
        }
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

function printUsage() {
    console.log([
        'Usage: npm run world:preview-stage -- coalescence-of-lunavik',
        '',
        'Options:',
        '  --list',
        '  --no-arrivals',
    ].join('\n'));
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printUsage();
        return;
    }
    if (args.list) {
        for (const stage of getAllAuthoredStageDefinitions()) {
            console.log(`${stage.id} (${stage.width}x${stage.height}, ${stage.zoneId})`);
        }
        return;
    }

    const stageId = args._[0];
    if (!stageId) {
        printUsage();
        process.exitCode = 1;
        return;
    }

    const stage = getStageDefinition(stageId);
    if (!stage || stage.kind !== 'static') {
        console.error(`No authored stage found for "${stageId}"`);
        process.exitCode = 1;
        return;
    }

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
