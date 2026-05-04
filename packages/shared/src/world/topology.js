function getExitByRole(stage, role) {
    if (!stage || !Array.isArray(stage.exits)) return null;
    return stage.exits.find((exit) => exit.connectionRole === role) ?? null;
}

function oppositeArrivalDirectionForSide(side) {
    switch (side) {
        case 'north': return 'south';
        case 'east': return 'west';
        case 'south': return 'north';
        case 'west': return 'east';
        default: return null;
    }
}

function makeConnection(targetStage, targetExit) {
    return Object.freeze({
        levelId: targetStage.id,
        exitId: targetExit.id,
        exitIndex: targetExit.exitIndex,
        arrivalDirection: oppositeArrivalDirectionForSide(targetExit.side),
    });
}

function withConnection(stage, sourceExit, connection) {
    return Object.freeze({
        ...stage,
        connectionsByExitId: Object.freeze({
            ...(stage.connectionsByExitId ?? {}),
            [sourceExit.id]: connection,
        }),
    });
}

export function compileRouteChain(stages, options = {}) {
    const chain = Array.isArray(stages) ? [...stages] : [];
    if (chain.length === 0) return [];

    const backRole = options.backRole ?? 'back';
    const forwardRole = options.forwardRole ?? 'forward';
    const compiled = chain.map((stage) => ({ ...stage, connectionsByExitId: { ...(stage.connectionsByExitId ?? {}) } }));

    for (let index = 0; index < compiled.length - 1; index++) {
        const current = compiled[index];
        const next = compiled[index + 1];
        const currentForward = getExitByRole(current, forwardRole);
        const nextBack = getExitByRole(next, backRole);
        if (!currentForward) {
            throw new Error(`${current.id} is missing a "${forwardRole}" exit`);
        }
        if (!nextBack) {
            throw new Error(`${next.id} is missing a "${backRole}" exit`);
        }

        compiled[index] = withConnection(current, currentForward, makeConnection(next, nextBack));
        compiled[index + 1] = withConnection(next, nextBack, makeConnection(current, currentForward));
    }

    return compiled;
}
