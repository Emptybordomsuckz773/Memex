import { TEST_USER } from '@worldbrain/memex-common/lib/authentication/dev'
import {
    makeSingleDeviceUILogicTestFactory,
    insertBackgroundFunctionTab,
    UILogicTestDevice,
} from 'src/tests/ui-logic-tests'
import { createUIServices } from 'src/services/ui'
import Logic from './logic'
import { STORAGE_KEYS as CLOUD_STORAGE_KEYS } from 'src/personal-cloud/constants'
import type { State, Event } from './types'

async function setupTest(
    {
        backgroundModules,
        browserAPIs,
        services,
        createElement,
    }: UILogicTestDevice,
    args?: { isLoggedOut?: boolean; onModalClose?: () => void },
) {
    if (!args?.isLoggedOut) {
        await services.auth.loginWithEmailAndPassword(
            TEST_USER.email,
            'password',
        )
    }

    const _logic = new Logic({
        services: createUIServices(),
        authBG: backgroundModules.auth.remoteFunctions,
        backupBG: insertBackgroundFunctionTab(
            backgroundModules.backupModule.remoteFunctions,
        ) as any,
        personalCloudBG: backgroundModules.personalCloud.remoteFunctions,
        onModalClose: args?.onModalClose ?? (() => undefined),
        localStorage: browserAPIs.storage.local,
    })

    const logic = createElement<State, Event>(_logic)

    return { _logic, logic }
}

describe('Cloud onboarding UI logic', () => {
    const it = makeSingleDeviceUILogicTestFactory()

    it('should close modal if not logged in', async ({ device }) => {
        let hasModalClosed = false
        const { logic } = await setupTest(device, {
            isLoggedOut: true,
            onModalClose: () => {
                hasModalClosed = true
            },
        })

        expect(hasModalClosed).toBe(false)
        await logic.init()
        expect(hasModalClosed).toBe(true)
    })

    it('should set local storage flag upon onboarding finish', async ({
        device,
    }) => {
        const { logic } = await setupTest(device)

        expect(
            (
                await device.browserAPIs.storage.local.get(
                    CLOUD_STORAGE_KEYS.isEnabled,
                )
            )[CLOUD_STORAGE_KEYS.isEnabled],
        ).not.toBe(true)

        await logic.processEvent('closeMigration', null)

        expect(
            (
                await device.browserAPIs.storage.local.get(
                    CLOUD_STORAGE_KEYS.isEnabled,
                )
            )[CLOUD_STORAGE_KEYS.isEnabled],
        ).toBe(true)
    })

    it('should determine whether dump is needed, based on last backup time existence', async ({
        device,
    }) => {
        device.backgroundModules.backupModule.remoteFunctions.getBackupTimes = async () => ({
            lastBackup: null, // As there isn't a last backup time, it should tell user to dump
            nextBackup: null,
        })
        const { logic: logicA } = await setupTest(device)
        expect(logicA.state.shouldBackupViaDump).toBe(false)
        await logicA.init()
        expect(logicA.state.shouldBackupViaDump).toBe(true)

        device.backgroundModules.backupModule.remoteFunctions.getBackupTimes = async () => ({
            lastBackup: Date.now(), // As there now is a last backup time, it shouldn't tell user to dump
            nextBackup: null,
        })
        const { logic: logicB } = await setupTest(device)
        expect(logicB.state.shouldBackupViaDump).toBe(false)
        await logicB.init()
        expect(logicB.state.shouldBackupViaDump).toBe(false)
    })

    it('should determine whether passive data removal is needed, based on whether data exists from earlier than 2020-09-09', async ({
        device,
    }) => {
        const { logic: logicA } = await setupTest(device)
        expect(logicA.state.needsToRemovePassiveData).toBe(false)
        await logicA.init()
        expect(logicA.state.needsToRemovePassiveData).toBe(false)

        expect(logicA.state.stage).toEqual('data-dump')
        await logicA.processEvent('continueToMigration', null)
        expect(logicA.state.stage).toEqual('data-migration')

        // Try again, this time with old data
        await device.storageManager.collection('visits').createObject({
            url: 'getmemex.com',
            time: new Date('2020-01-01').getTime(),
        })

        const { logic: logicB } = await setupTest(device)
        expect(logicB.state.needsToRemovePassiveData).toBe(false)
        await logicB.init()
        expect(logicB.state.needsToRemovePassiveData).toBe(true)

        expect(logicB.state.stage).toEqual('data-dump')
        await logicB.processEvent('continueToMigration', null)
        expect(logicB.state.stage).toEqual('data-clean')
    })

    it('should only do pre-migration prep step once - migration retries should skip it', async ({
        device,
    }) => {
        // TODO: Implement this!
        expect(true).toBe(false)

        device.backgroundModules.backupModule.remoteFunctions.getBackupTimes = async () => ({
            lastBackup: null, // As there isn't a last backup time, it should tell user to dump
            nextBackup: null,
        })
        const { logic: logicA } = await setupTest(device)
        expect(logicA.state.shouldBackupViaDump).toBe(false)
        await logicA.init()
        expect(logicA.state.shouldBackupViaDump).toBe(true)

        device.backgroundModules.backupModule.remoteFunctions.getBackupTimes = async () => ({
            lastBackup: Date.now(), // As there now is a last backup time, it shouldn't tell user to dump
            nextBackup: null,
        })
        const { logic: logicB } = await setupTest(device)
        expect(logicB.state.shouldBackupViaDump).toBe(false)
        await logicB.init()
        expect(logicB.state.shouldBackupViaDump).toBe(false)
    })
})