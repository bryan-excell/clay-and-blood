import {
    runUiStateStoreTests,
    runUiStateStoreShallowEqualTests,
} from '../core/ui-state-store.test.mjs';
import {
    runUiProjectionBasicProjectionTest,
    runUiProjectionNetworkOverrideTest,
    runUiProjectionPossessionGuardTest,
    runUiProjectionImmediateControlChangedTest,
} from '../world/ui-projection.test.mjs';

function run(name, fn) {
    fn();
    // Keep output short and deterministic for CI logs.
    console.log(`PASS ${name}`);
}

run('UiStateStore set/get subscriptions', runUiStateStoreTests);
run('UiStateStore shallow-equal guard', runUiStateStoreShallowEqualTests);
run('UiProjection basic projection', runUiProjectionBasicProjectionTest);
run('UiProjection network override', runUiProjectionNetworkOverrideTest);
run('UiProjection possession guard', runUiProjectionPossessionGuardTest);
run('UiProjection immediate control update', runUiProjectionImmediateControlChangedTest);
