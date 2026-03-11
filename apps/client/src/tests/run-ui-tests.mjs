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
import {
    runLoadoutKitAssignmentTest,
    runLoadoutKitActivationAndCyclingTest,
    runLoadoutActiveSlotReassignTest,
} from '../components/loadout-component.test.mjs';

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
run('Loadout kit assignment', runLoadoutKitAssignmentTest);
run('Loadout kit activation and cycling', runLoadoutKitActivationAndCyclingTest);
run('Loadout active slot reassignment', runLoadoutActiveSlotReassignTest);
