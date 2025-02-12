const wrtc = require('wrtc')
import StorageManager from '@worldbrain/storex'
import { TypeORMStorageBackend } from '@worldbrain/storex-backend-typeorm'
import { extractUrlParts, normalizeUrl } from '@worldbrain/memex-url-utils'
import { MetaPickerStorage } from '@worldbrain/memex-storage/lib/mobile-app/features/meta-picker/storage'
import { OverviewStorage } from '@worldbrain/memex-storage/lib/mobile-app/features/overview/storage'
import { PageEditorStorage } from '@worldbrain/memex-storage/lib/mobile-app/features/page-editor/storage'
import { registerModuleMapCollections } from '@worldbrain/storex-pattern-modules'
import { SharedSyncLog } from '@worldbrain/storex-sync/lib/shared-sync-log'
import { ClientSyncLogStorage } from '@worldbrain/storex-sync/lib/client-sync-log'
import { COLLECTION_DEFINITIONS as READER_COLLECTION_DEFINITIONS } from '@worldbrain/memex-storage/lib/reader/constants'
import SyncService, {
    SignalTransportFactory,
} from '@worldbrain/memex-common/lib/sync'
import { MemoryAuthService } from '@worldbrain/memex-common/lib/authentication/memory'
import { SyncInfoStorage } from '@worldbrain/memex-common/lib/sync/storage'
import MemoryBrowserStorage from 'src/util/tests/browser-storage'
import { MemexExtSyncSettingStore } from 'src/sync/background/setting-store'
import { setStorageMiddleware } from 'src/storage/middleware'
import { ContentSharingClientStorage } from 'src/content-sharing/background/storage'

export interface MobileIntegrationTestSetup {
    storage: {
        manager: StorageManager
        modules: {
            metaPicker: MetaPickerStorage
            overview: OverviewStorage
            pageEditor: PageEditorStorage
        }
    }
    services: {
        sync: SyncService
    }
    destroy: () => Promise<void>
}

let storageBackendsCreated = 0

export async function setupMobileIntegrationTest(options?: {
    signalTransportFactory?: SignalTransportFactory
    sharedSyncLog?: SharedSyncLog
    browserLocalStorage?: MemoryBrowserStorage
}): Promise<MobileIntegrationTestSetup> {
    const browserLocalStorage =
        (options && options.browserLocalStorage) || new MemoryBrowserStorage()

    const backend = new TypeORMStorageBackend({
        connectionOptions: {
            type: 'sqlite',
            database: ':memory:',
            name: `connection-${++storageBackendsCreated}`,
        },
        // connectionOptions: { type: 'sqlite', database: ':memory:', logging: true },
        // connectionOptions: { type: 'sqlite', database: '/tmp/test.sqlite', logging: true },
        legacyMemexCompatibility: true,
    })

    const storageManager = new StorageManager({ backend })
    const storageModules = {
        metaPicker: new MetaPickerStorage({
            storageManager,
            normalizeUrl,
        }),
        overview: new OverviewStorage({
            storageManager,
            extractUrlParts,
            normalizeUrl,
        }),
        pageEditor: new PageEditorStorage({ storageManager, normalizeUrl }),
        clientSyncLog: new ClientSyncLogStorage({ storageManager }),
        syncInfoStorage: new SyncInfoStorage({ storageManager }),
    }

    const authService = new MemoryAuthService()
    // const subscriptionService = new MemorySubscriptionsService()
    // const auth: AuthBackground = new AuthBackground({
    //     authService,
    //     subscriptionService,
    // })

    const sync = new SyncService({
        auth: authService,
        storageManager,
        signalTransportFactory: options && options.signalTransportFactory,
        getSharedSyncLog: async () => options && options.sharedSyncLog,
        productType: 'app',
        productVersion: '1.2.3',
        devicePlatform: 'integration-tests',
        clientSyncLog: storageModules.clientSyncLog,
        syncInfoStorage: storageModules.syncInfoStorage,
        settingStore: new MemexExtSyncSettingStore({
            browserAPIs: {
                storage: {
                    local: new MemoryBrowserStorage(),
                } as any,
            },
        }),
        disableEncryption: true,
    })
    sync.initialSync.wrtc = wrtc
    registerModuleMapCollections(storageManager.registry, {
        ...storageModules,
        clientSyncLog: sync.clientSyncLog,
        syncInfo: sync.syncInfoStorage,
        contentSharing: new ContentSharingClientStorage({ storageManager }),
    })

    // REMOVE THIS LINE WHEN MERGING READER
    storageManager.registry.registerCollections(READER_COLLECTION_DEFINITIONS)

    await storageManager.finishInitialization()

    await setStorageMiddleware(storageManager, {})

    await storageManager.backend.migrate()

    return {
        storage: {
            manager: storageManager,
            modules: storageModules,
        },
        services: {
            sync,
        },
        destroy: async () => {
            if (backend.connection) {
                await backend.connection.close()
            }
        },
    }
}
