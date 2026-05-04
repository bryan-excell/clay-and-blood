import { isWalkableTile } from './tileRegistry.js';

const CARDINAL_VECTORS = Object.freeze([
    Object.freeze({ dx: 1, dy: 0 }),
    Object.freeze({ dx: -1, dy: 0 }),
    Object.freeze({ dx: 0, dy: 1 }),
    Object.freeze({ dx: 0, dy: -1 }),
]);

function addIssue(issues, code, message, context = {}) {
    issues.push({ code, message, ...context });
}

function isRectangularGrid(grid) {
    if (!Array.isArray(grid) || grid.length === 0 || !Array.isArray(grid[0])) return false;
    const width = grid[0].length;
    return width > 0 && grid.every((row) => Array.isArray(row) && row.length === width);
}

function getGridSize(grid) {
    return {
        width: Array.isArray(grid?.[0]) ? grid[0].length : 0,
        height: Array.isArray(grid) ? grid.length : 0,
    };
}

function inBounds(grid, x, y) {
    const { width, height } = getGridSize(grid);
    return x >= 0 && x < width && y >= 0 && y < height;
}

function reachableWalkableTiles(grid, startX, startY) {
    if (!inBounds(grid, startX, startY) || !isWalkableTile(grid[startY][startX])) return new Set();
    const seen = new Set([`${startX},${startY}`]);
    const queue = [{ x: startX, y: startY }];
    for (let i = 0; i < queue.length; i++) {
        const current = queue[i];
        for (const vector of CARDINAL_VECTORS) {
            const nx = current.x + vector.dx;
            const ny = current.y + vector.dy;
            const key = `${nx},${ny}`;
            if (seen.has(key) || !inBounds(grid, nx, ny) || !isWalkableTile(grid[ny][nx])) continue;
            seen.add(key);
            queue.push({ x: nx, y: ny });
        }
    }
    return seen;
}

function findFirstWalkableTile(grid) {
    const { width, height } = getGridSize(grid);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (isWalkableTile(grid[y][x])) return { x, y };
        }
    }
    return null;
}

export function validateStageDefinition(stage, options = {}) {
    const issues = [];
    if (!stage || typeof stage !== 'object') {
        addIssue(issues, 'stage.invalid', 'Stage definition must be an object');
        return issues;
    }

    if (typeof stage.id !== 'string' || stage.id.length === 0) {
        addIssue(issues, 'stage.id.missing', 'Stage must declare a stable id');
    }
    if (typeof stage.zoneId !== 'string' || stage.zoneId.length === 0) {
        addIssue(issues, 'stage.zone.missing', `${stage.id ?? 'unknown'} must declare a zoneId`, { stageId: stage.id });
    }

    const grid = stage.tiles;
    if (!isRectangularGrid(grid)) {
        addIssue(issues, 'stage.grid.ragged', `${stage.id ?? 'unknown'} must have a rectangular tile grid`, { stageId: stage.id });
        return issues;
    }

    const { width, height } = getGridSize(grid);
    if (Number.isFinite(stage.width) && stage.width !== width) {
        addIssue(issues, 'stage.width.mismatch', `${stage.id} width does not match tile grid`, { stageId: stage.id, expected: width, actual: stage.width });
    }
    if (Number.isFinite(stage.height) && stage.height !== height) {
        addIssue(issues, 'stage.height.mismatch', `${stage.id} height does not match tile grid`, { stageId: stage.id, expected: height, actual: stage.height });
    }

    const exits = Array.isArray(stage.exits) ? stage.exits : [];
    const exitIds = new Set();
    for (const exit of exits) {
        if (!exit || typeof exit !== 'object') {
            addIssue(issues, 'exit.invalid', `${stage.id} has an invalid exit`, { stageId: stage.id });
            continue;
        }
        if (typeof exit.id !== 'string' || exit.id.length === 0) {
            addIssue(issues, 'exit.id.missing', `${stage.id} has an exit without an id`, { stageId: stage.id });
        } else if (exitIds.has(exit.id)) {
            addIssue(issues, 'exit.id.duplicate', `${stage.id} has duplicate exit id ${exit.id}`, { stageId: stage.id, exitId: exit.id });
        }
        exitIds.add(exit.id);

        if (!Number.isInteger(exit.x) || !Number.isInteger(exit.y) || !inBounds(grid, exit.x, exit.y)) {
            addIssue(issues, 'exit.position.invalid', `${stage.id}:${exit.id ?? '?'} has an invalid position`, { stageId: stage.id, exitId: exit.id });
            continue;
        }
        if (!isWalkableTile(grid[exit.y][exit.x])) {
            addIssue(issues, 'exit.position.blocked', `${stage.id}:${exit.id} is not on a walkable tile`, { stageId: stage.id, exitId: exit.id });
        }

        if (options.requireExplicitArrivals !== false) {
            if (!exit.arrival) {
                addIssue(issues, 'exit.arrival.missing', `${stage.id}:${exit.id} must declare an arrival tile`, { stageId: stage.id, exitId: exit.id });
            } else {
                const ax = exit.arrival.x;
                const ay = exit.arrival.y;
                if (!Number.isInteger(ax) || !Number.isInteger(ay) || !inBounds(grid, ax, ay)) {
                    addIssue(issues, 'exit.arrival.invalid', `${stage.id}:${exit.id} has an invalid arrival tile`, { stageId: stage.id, exitId: exit.id });
                } else if (!isWalkableTile(grid[ay][ax])) {
                    addIssue(issues, 'exit.arrival.blocked', `${stage.id}:${exit.id} arrival is not walkable`, { stageId: stage.id, exitId: exit.id });
                } else if (ax === exit.x && ay === exit.y) {
                    addIssue(issues, 'exit.arrival.on_exit', `${stage.id}:${exit.id} arrival cannot be on the exit tile`, { stageId: stage.id, exitId: exit.id });
                }
            }
        }
    }

    const firstWalkable = findFirstWalkableTile(grid);
    if (!firstWalkable) {
        addIssue(issues, 'stage.walkable.missing', `${stage.id} has no walkable tiles`, { stageId: stage.id });
    } else if (options.requireConnectedWalkable !== false) {
        const reachable = reachableWalkableTiles(grid, firstWalkable.x, firstWalkable.y);
        let walkableCount = 0;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (isWalkableTile(grid[y][x])) walkableCount++;
            }
        }
        if (reachable.size !== walkableCount) {
            addIssue(issues, 'stage.walkable.disconnected', `${stage.id} has disconnected walkable areas`, {
                stageId: stage.id,
                reachable: reachable.size,
                walkable: walkableCount,
            });
        }
    }

    return issues;
}

export function validateWorldDefinitions({ stages = [], zones = [] } = {}, options = {}) {
    const issues = [];
    const stageById = new Map(stages.map((stage) => [stage.id, stage]));
    const zoneById = new Map(zones.map((zone) => [zone.id, zone]));

    for (const stage of stages) {
        issues.push(...validateStageDefinition(stage));
        if (stage?.zoneId && !zoneById.has(stage.zoneId)) {
            addIssue(issues, 'stage.zone.unknown', `${stage.id} references unknown zone ${stage.zoneId}`, {
                stageId: stage.id,
                zoneId: stage.zoneId,
            });
        }

        for (const [sourceExitId, connection] of Object.entries(stage.connectionsByExitId ?? {})) {
            const sourceExit = stage.exits?.find((exit) => exit.id === sourceExitId);
            if (!sourceExit) {
                addIssue(issues, 'connection.source.missing', `${stage.id} connection references missing source exit ${sourceExitId}`, {
                    stageId: stage.id,
                    exitId: sourceExitId,
                });
            }
            const targetStage = stageById.get(connection?.levelId);
            if (!targetStage) {
                addIssue(issues, 'connection.target_stage.missing', `${stage.id}:${sourceExitId} targets missing stage ${connection?.levelId}`, {
                    stageId: stage.id,
                    exitId: sourceExitId,
                    targetStageId: connection?.levelId,
                });
                continue;
            }
            const targetExit = targetStage.exits?.find((exit) => exit.id === connection.exitId);
            if (!targetExit) {
                addIssue(issues, 'connection.target_exit.missing', `${stage.id}:${sourceExitId} targets missing exit ${connection.exitId}`, {
                    stageId: stage.id,
                    exitId: sourceExitId,
                    targetStageId: targetStage.id,
                    targetExitId: connection.exitId,
                });
                continue;
            }

            if (options.requireBidirectionalConnections !== false) {
                const returnConnection = targetStage.connectionsByExitId?.[targetExit.id];
                if (!returnConnection ||
                    returnConnection.levelId !== stage.id ||
                    returnConnection.exitId !== sourceExitId) {
                    addIssue(issues, 'connection.reciprocal.missing', `${stage.id}:${sourceExitId} is not reciprocated by ${targetStage.id}:${targetExit.id}`, {
                        stageId: stage.id,
                        exitId: sourceExitId,
                        targetStageId: targetStage.id,
                        targetExitId: targetExit.id,
                    });
                }
            }
        }
    }

    for (const zone of zones) {
        for (const stageId of zone.stageIds ?? []) {
            const stage = stageById.get(stageId);
            if (!stage) {
                addIssue(issues, 'zone.stage.missing', `${zone.id} references missing stage ${stageId}`, { zoneId: zone.id, stageId });
            } else if (stage.zoneId !== zone.id) {
                addIssue(issues, 'zone.stage.mismatch', `${zone.id} references ${stageId}, but the stage belongs to ${stage.zoneId}`, {
                    zoneId: zone.id,
                    stageId,
                    stageZoneId: stage.zoneId,
                });
            }
        }
    }

    return issues;
}
