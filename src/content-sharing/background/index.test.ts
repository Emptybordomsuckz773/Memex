import orderBy from 'lodash/orderBy'
import expect from 'expect'
import { normalizeUrl } from '@worldbrain/memex-url-utils'
import { TEST_USER } from '@worldbrain/memex-common/lib/authentication/dev'
import { StorexPersonalCloudBackend } from '@worldbrain/memex-common/lib/personal-cloud/backend/storex'
import { SharedListRoleID } from '@worldbrain/memex-common/lib/content-sharing/types'
import {
    backgroundIntegrationTestSuite,
    backgroundIntegrationTest,
    BackgroundIntegrationTestInstance,
    BackgroundIntegrationTestContext,
} from 'src/tests/integration-tests'
import * as data from './index.test.data'
import { AnnotationPrivacyLevels } from 'src/annotations/types'
import { BackgroundIntegrationTestSetupOpts } from 'src/tests/background-integration-tests'
import { StorageHooksChangeWatcher } from '@worldbrain/memex-common/lib/storage/hooks'
import { createLazyMemoryServerStorage } from 'src/storage/server'
import { FakeFetch } from 'src/util/tests/fake-fetch'

function convertRemoteId(id: string) {
    return parseInt(id, 10)
}

async function setupPreTest({ setup }: BackgroundIntegrationTestContext) {
    setup.injectCallFirebaseFunction(async <Returns>() => null as Returns)
}

interface TestData {
    localListId?: number
    remoteListId?: string
}

async function setupTest(options: {
    setup: BackgroundIntegrationTestContext['setup']
    testData: TestData
    createTestList?: boolean
}) {
    const { setup, testData } = options
    const { contentSharing, personalCloud } = setup.backgroundModules
    setup.authService.setUser(TEST_USER)
    personalCloud.actionQueue.forceQueueSkip = true
    await personalCloud.setup()

    const serverStorage = await setup.getServerStorage()
    await serverStorage.storageManager.operation(
        'createObject',
        'user',
        TEST_USER,
    )

    if (options.createTestList) {
        testData.localListId = await data.createContentSharingTestList(setup)
    }

    const shareTestList = async (shareOptions: { shareEntries: boolean }) => {
        const listShareResult = await contentSharing.shareList({
            listId: testData.localListId,
        })
        if (shareOptions.shareEntries) {
            await contentSharing.shareListEntries({
                listId: testData.localListId,
            })
        }
        return listShareResult.remoteListId
    }

    return {
        contentSharing,
        personalCloud,
        shareTestList,
    }
}

export const INTEGRATION_TESTS = backgroundIntegrationTestSuite(
    'Content sharing',
    [
        backgroundIntegrationTest(
            'should share a new list with its entries',
            { skipConflictTests: true },
            () => {
                const testData: TestData = {}

                return {
                    setup: setupPreTest,
                    steps: [
                        {
                            execute: async ({ setup }) => {
                                const {
                                    shareTestList,
                                    personalCloud,
                                } = await setupTest({
                                    setup,
                                    testData,
                                    createTestList: true,
                                })

                                const localListEntries = await setup.storageManager.operation(
                                    'findObjects',
                                    'pageListEntries',
                                    {
                                        sort: [['createdAt', 'desc']],
                                    },
                                )

                                await shareTestList({ shareEntries: true })
                                await personalCloud.waitForSync()

                                const serverStorage = await setup.getServerStorage()
                                expect(
                                    await serverStorage.storageManager.operation(
                                        'findObjects',
                                        'sharedList',
                                        {},
                                    ),
                                ).toEqual([
                                    {
                                        id: expect.anything(),
                                        creator: TEST_USER.id,
                                        createdWhen: expect.any(Number),
                                        updatedWhen: expect.any(Number),
                                        title: 'My shared list',
                                        description: null,
                                    },
                                ])
                                expect(
                                    orderBy(
                                        await serverStorage.storageManager.operation(
                                            'findObjects',
                                            'sharedListEntry',
                                            {},
                                        ),
                                        ['createdWhen'],
                                        ['desc'],
                                    ),
                                ).toEqual([
                                    {
                                        id: expect.anything(),
                                        creator: TEST_USER.id,
                                        sharedList: convertRemoteId(
                                            testData.remoteListId,
                                        ),
                                        createdWhen: localListEntries[1].createdAt.getTime(),
                                        updatedWhen: expect.any(Number),
                                        originalUrl: 'https://www.eggs.com/foo',
                                        normalizedUrl: 'eggs.com/foo',
                                        entryTitle: 'Eggs.com title',
                                    },
                                    {
                                        id: expect.anything(),
                                        creator: TEST_USER.id,
                                        sharedList: convertRemoteId(
                                            testData.remoteListId,
                                        ),
                                        createdWhen: localListEntries[2].createdAt.getTime(),
                                        updatedWhen: expect.any(Number),
                                        originalUrl: 'https://www.spam.com/foo',
                                        normalizedUrl: 'spam.com/foo',
                                        entryTitle: 'Spam.com title',
                                    },
                                ])
                            },
                            postCheck: async ({ setup }) => {
                                const listMetadata = await setup.storageManager.operation(
                                    'findObjects',
                                    'sharedListMetadata',
                                    {},
                                )
                                expect(listMetadata).toEqual([
                                    {
                                        localId: testData.localListId,
                                        remoteId: testData.remoteListId,
                                    },
                                ])
                            },
                        },
                    ],
                }
            },
        ),
        backgroundIntegrationTest(
            'should share new entries to an already shared list',
            { skipConflictTests: true },
            () => {
                const testData: TestData = {}

                return {
                    setup: setupPreTest,
                    steps: [
                        {
                            execute: async ({ setup }) => {
                                const {
                                    contentSharing,
                                    personalCloud,
                                    shareTestList,
                                } = await setupTest({
                                    setup,
                                    testData,
                                    createTestList: true,
                                })
                                testData.remoteListId = await shareTestList({
                                    shareEntries: true,
                                })

                                // Add new entry
                                await setup.backgroundModules.pages.addPage({
                                    pageDoc: {
                                        url: 'https://www.fish.com/cheese',
                                        content: {
                                            title: 'Fish.com title',
                                        },
                                    },
                                    visits: [],
                                    rejectNoContent: false,
                                })
                                await setup.backgroundModules.customLists.insertPageToList(
                                    {
                                        id: testData.localListId,
                                        url: 'https://www.fish.com/cheese',
                                    },
                                )
                                await personalCloud.waitForSync()

                                const serverStorage = await setup.getServerStorage()
                                expect(
                                    orderBy(
                                        await serverStorage.storageManager.operation(
                                            'findObjects',
                                            'sharedListEntry',
                                            {},
                                        ),
                                        ['createdWhen'],
                                        ['asc'],
                                    ),
                                ).toEqual([
                                    expect.objectContaining({
                                        normalizedUrl: 'spam.com/foo',
                                        entryTitle: 'Spam.com title',
                                    }),
                                    expect.objectContaining({
                                        normalizedUrl: 'eggs.com/foo',
                                        entryTitle: 'Eggs.com title',
                                    }),
                                    expect.objectContaining({
                                        normalizedUrl: 'fish.com/cheese',
                                        entryTitle: 'Fish.com title',
                                    }),
                                ])
                            },
                        },
                    ],
                }
            },
        ),
        backgroundIntegrationTest(
            'should sync the title when changing the title of an already shared list',
            { skipConflictTests: true },
            () => {
                const testData: TestData = {}

                return {
                    setup: setupPreTest,
                    steps: [
                        {
                            execute: async ({ setup }) => {
                                const {
                                    contentSharing,
                                    personalCloud,
                                    shareTestList,
                                } = await setupTest({
                                    setup,
                                    testData,
                                    createTestList: true,
                                })
                                testData.remoteListId = await shareTestList({
                                    shareEntries: false,
                                })

                                const updatedTitle =
                                    'My shared list (updated title)'
                                await setup.backgroundModules.customLists.updateList(
                                    {
                                        id: testData.localListId,
                                        oldName: data.LIST_DATA.name,
                                        newName: updatedTitle,
                                    },
                                )
                                await personalCloud.waitForSync()

                                const serverStorage = await setup.getServerStorage()
                                expect(
                                    await serverStorage.storageManager.operation(
                                        'findObjects',
                                        'sharedList',
                                        {},
                                    ),
                                ).toEqual([
                                    {
                                        id: expect.anything(),
                                        creator: TEST_USER.id,
                                        createdWhen: expect.any(Number),
                                        updatedWhen: expect.any(Number),
                                        title: updatedTitle,
                                        description: null,
                                    },
                                ])

                                // It should not fail when trying to update other fields than the title of the list
                                await setup.storageManager.operation(
                                    'updateObject',
                                    'customLists',
                                    { id: testData.localListId },
                                    { searchableName: 'something' },
                                )
                                await personalCloud.waitForSync()
                                expect(
                                    await serverStorage.storageManager.operation(
                                        'findObjects',
                                        'sharedList',
                                        {},
                                    ),
                                ).toEqual([
                                    {
                                        id: expect.anything(),
                                        creator: TEST_USER.id,
                                        createdWhen: expect.any(Number),
                                        updatedWhen: expect.any(Number),
                                        title: updatedTitle,
                                        description: null,
                                    },
                                ])
                            },
                        },
                    ],
                }
            },
        ),
        backgroundIntegrationTest(
            'should delete list entries of an already shared list',
            { skipConflictTests: true },
            () => {
                const testData: TestData = {}

                return {
                    setup: setupPreTest,
                    steps: [
                        {
                            execute: async ({ setup }) => {
                                const {
                                    contentSharing,
                                    personalCloud,
                                    shareTestList,
                                } = await setupTest({
                                    setup,
                                    testData,
                                    createTestList: true,
                                })
                                testData.remoteListId = await shareTestList({
                                    shareEntries: true,
                                })

                                await setup.backgroundModules.customLists.removePageFromList(
                                    {
                                        id: testData.localListId,
                                        url: 'https://www.spam.com/foo',
                                    },
                                )
                                await personalCloud.waitForSync()

                                const serverStorage = await setup.getServerStorage()
                                expect(
                                    await serverStorage.storageManager.operation(
                                        'findObjects',
                                        'sharedListEntry',
                                        {},
                                    ),
                                ).toEqual([
                                    expect.objectContaining({
                                        entryTitle: 'Eggs.com title',
                                    }),
                                ])
                            },
                        },
                    ],
                }
            },
        ),
        backgroundIntegrationTest(
            `should share newly shared annotations in an already shared list using the 'shareAnnotation' method`,
            { skipConflictTests: true },
            () =>
                makeShareAnnotationTest({
                    annotationSharingMethod: 'shareAnnotation',
                    testDuplicateSharing: false,
                }),
        ),
        backgroundIntegrationTest(
            `should not share annotations more than once in an already shared list using the 'shareAnnotation' method`,
            { skipConflictTests: true },
            () =>
                makeShareAnnotationTest({
                    annotationSharingMethod: 'shareAnnotation',
                    testDuplicateSharing: true,
                }),
        ),
        backgroundIntegrationTest(
            `should share newly shared annotations in an already shared list using the 'shareAnnotations' method`,
            { skipConflictTests: true },
            () =>
                makeShareAnnotationTest({
                    annotationSharingMethod: 'shareAnnotations',
                    testDuplicateSharing: false,
                }),
        ),
        backgroundIntegrationTest(
            `should not share annotations more than once in an already shared list using the 'shareAnnotations' method`,
            { skipConflictTests: true },
            () =>
                makeShareAnnotationTest({
                    annotationSharingMethod: 'shareAnnotations',
                    testDuplicateSharing: true,
                }),
        ),
        backgroundIntegrationTest(
            `should skip sharing protected annotations in an already shared list using the 'shareAnnotations' method`,
            { skipConflictTests: true },
            () =>
                makeShareAnnotationTest({
                    annotationSharingMethod: 'shareAnnotations',
                    testProtectedBulkShare: true,
                    testDuplicateSharing: true,
                }),
        ),
        backgroundIntegrationTest(
            'should unshare annotations from lists',
            { skipConflictTests: true },
            () => {
                const testData: TestData = {}

                return {
                    setup: setupPreTest,
                    steps: [
                        {
                            execute: async ({ setup }) => {
                                const {
                                    contentSharing,
                                    personalCloud,
                                    shareTestList,
                                } = await setupTest({
                                    setup,
                                    testData,
                                    createTestList: true,
                                })
                                testData.remoteListId = await shareTestList({
                                    shareEntries: true,
                                })
                                const annotationUrl = await setup.backgroundModules.directLinking.createAnnotation(
                                    {} as any,
                                    data.ANNOTATION_1_1_DATA,
                                    { skipPageIndexing: true },
                                )
                                await contentSharing.shareAnnotation({
                                    annotationUrl,
                                })
                                await contentSharing.shareAnnotationsToLists({
                                    annotationUrls: [annotationUrl],
                                })
                                await personalCloud.waitForSync()

                                const remoteAnnotationIds = await contentSharing.storage.getRemoteAnnotationIds(
                                    {
                                        localIds: [annotationUrl],
                                    },
                                )

                                const serverStorage = await setup.getServerStorage()
                                const getShared = (collection: string) =>
                                    serverStorage.storageManager.operation(
                                        'findObjects',
                                        collection,
                                        {},
                                    )

                                expect(
                                    await getShared(
                                        'sharedAnnotationListEntry',
                                    ),
                                ).toEqual([
                                    expect.objectContaining({
                                        sharedAnnotation: convertRemoteId(
                                            remoteAnnotationIds[
                                                annotationUrl
                                            ] as string,
                                        ),
                                    }),
                                ])
                                await contentSharing.unshareAnnotationsFromLists(
                                    {
                                        annotationUrls: [annotationUrl],
                                    },
                                )
                                await personalCloud.waitForSync()

                                expect(
                                    await getShared(
                                        'sharedAnnotationListEntry',
                                    ),
                                ).toEqual([])
                                expect(
                                    await getShared('sharedAnnotation'),
                                ).toEqual([
                                    expect.objectContaining({
                                        id: convertRemoteId(
                                            remoteAnnotationIds[
                                                annotationUrl
                                            ] as string,
                                        ),
                                    }),
                                ])
                                expect(
                                    await setup.storageManager
                                        .collection('sharedAnnotationMetadata')
                                        .findObjects({}),
                                ).toEqual([
                                    {
                                        localId: annotationUrl,
                                        remoteId: expect.anything(),
                                        excludeFromLists: true,
                                    },
                                ])
                            },
                        },
                    ],
                }
            },
        ),
        backgroundIntegrationTest(
            'should share already shared annotations adding a page to another shared list',
            { skipConflictTests: true },
            () => {
                const testData: TestData = {}
                let firstLocalListId: number
                let secondLocalListId: number

                return {
                    setup: setupPreTest,
                    steps: [
                        {
                            execute: async ({ setup }) => {
                                const {
                                    contentSharing,
                                    personalCloud,
                                } = await setupTest({
                                    setup,
                                    testData,
                                })

                                firstLocalListId = await data.createContentSharingTestList(
                                    setup,
                                )
                                secondLocalListId = await setup.backgroundModules.customLists.createCustomList(
                                    {
                                        name: 'Second list',
                                    },
                                )
                                for (const localListId of [
                                    firstLocalListId,
                                    secondLocalListId,
                                ]) {
                                    await contentSharing.shareList({
                                        listId: localListId,
                                    })
                                    await contentSharing.shareListEntries({
                                        listId: localListId,
                                    })
                                }
                                const remoteListIds = await Promise.all(
                                    [firstLocalListId, secondLocalListId].map(
                                        (localId) =>
                                            contentSharing.storage.getRemoteListId(
                                                {
                                                    localId,
                                                },
                                            ),
                                    ),
                                )

                                const firstAnnotationUrl = await setup.backgroundModules.directLinking.createAnnotation(
                                    {} as any,
                                    data.ANNOTATION_1_1_DATA,
                                    { skipPageIndexing: true },
                                )
                                const secondAnnotationUrl = await setup.backgroundModules.directLinking.createAnnotation(
                                    {} as any,
                                    data.ANNOTATION_1_2_DATA,
                                    { skipPageIndexing: true },
                                )
                                await contentSharing.shareAnnotation({
                                    annotationUrl: firstAnnotationUrl,
                                })
                                await contentSharing.shareAnnotation({
                                    annotationUrl: secondAnnotationUrl,
                                })
                                await contentSharing.shareAnnotationsToLists({
                                    annotationUrls: [firstAnnotationUrl],
                                })
                                await personalCloud.waitForSync()

                                const remoteAnnotationIds = await contentSharing.storage.getRemoteAnnotationIds(
                                    {
                                        localIds: [
                                            firstAnnotationUrl,
                                            secondAnnotationUrl,
                                        ],
                                    },
                                )
                                await setup.backgroundModules.customLists.insertPageToList(
                                    {
                                        id: secondLocalListId,
                                        ...data.ENTRY_1_DATA,
                                    },
                                )
                                await personalCloud.waitForSync()

                                const serverStorage = await setup.getServerStorage()
                                const getShared = (collection: string) =>
                                    serverStorage.storageManager.operation(
                                        'findObjects',
                                        collection,
                                        {},
                                        { order: [['id', 'asc']] },
                                    )
                                const sharedAnnotations = await getShared(
                                    'sharedAnnotation',
                                )
                                expect(sharedAnnotations).toEqual([
                                    {
                                        id:
                                            convertRemoteId(
                                                remoteAnnotationIds[
                                                    firstAnnotationUrl
                                                ] as string,
                                            ) ||
                                            remoteAnnotationIds[
                                                firstAnnotationUrl
                                            ],
                                        creator: TEST_USER.id,
                                        normalizedPageUrl: normalizeUrl(
                                            data.ANNOTATION_1_1_DATA.pageUrl,
                                        ),
                                        createdWhen: expect.any(Number),
                                        uploadedWhen: expect.any(Number),
                                        updatedWhen: expect.any(Number),
                                        comment:
                                            data.ANNOTATION_1_1_DATA.comment,
                                        body: data.ANNOTATION_1_1_DATA.body,
                                        selector: JSON.stringify(
                                            data.ANNOTATION_1_1_DATA.selector,
                                        ),
                                    },
                                    expect.objectContaining({
                                        body: data.ANNOTATION_1_2_DATA.body,
                                    }),
                                ])
                                const sharedAnnotationListEntries = await getShared(
                                    'sharedAnnotationListEntry',
                                )
                                const sharedAnnotationId =
                                    convertRemoteId(
                                        remoteAnnotationIds[
                                            firstAnnotationUrl
                                        ] as string,
                                    ) || remoteAnnotationIds[firstAnnotationUrl]
                                expect(sharedAnnotationListEntries).toEqual([
                                    expect.objectContaining({
                                        normalizedPageUrl: normalizeUrl(
                                            data.ANNOTATION_1_1_DATA.pageUrl,
                                        ),
                                        sharedList: convertRemoteId(
                                            remoteListIds[0],
                                        ),
                                        sharedAnnotation: sharedAnnotationId,
                                    }),
                                    expect.objectContaining({
                                        normalizedPageUrl: normalizeUrl(
                                            data.ANNOTATION_1_1_DATA.pageUrl,
                                        ),
                                        sharedList: convertRemoteId(
                                            remoteListIds[1],
                                        ),
                                        sharedAnnotation: sharedAnnotationId,
                                    }),
                                ])
                            },
                        },
                    ],
                }
            },
        ),
        backgroundIntegrationTest(
            'should update the body of a shared annotation',
            { skipConflictTests: true },
            () => {
                const testData: TestData = {}

                return {
                    setup: setupPreTest,
                    steps: [
                        {
                            execute: async ({ setup }) => {
                                const {
                                    contentSharing,
                                    personalCloud,
                                    shareTestList,
                                } = await setupTest({
                                    setup,
                                    testData,
                                    createTestList: true,
                                })
                                testData.remoteListId = await shareTestList({
                                    shareEntries: true,
                                })
                                const annotationUrl = await setup.backgroundModules.directLinking.createAnnotation(
                                    {} as any,
                                    data.ANNOTATION_1_1_DATA,
                                    { skipPageIndexing: true },
                                )
                                await contentSharing.shareAnnotation({
                                    annotationUrl,
                                })
                                await personalCloud.waitForSync()

                                await setup.backgroundModules.directLinking.editAnnotation(
                                    null,
                                    annotationUrl,
                                    'Updated comment',
                                )
                                await personalCloud.waitForSync()

                                const serverStorage = await setup.getServerStorage()
                                const getShared = (collection: string) =>
                                    serverStorage.storageManager.operation(
                                        'findObjects',
                                        collection,
                                        {},
                                    )
                                const sharedAnnotations = await getShared(
                                    'sharedAnnotation',
                                )
                                expect(sharedAnnotations).toEqual([
                                    expect.objectContaining({
                                        comment: 'Updated comment',
                                        body: data.ANNOTATION_1_1_DATA.body,
                                    }),
                                ])
                            },
                        },
                    ],
                }
            },
        ),
        backgroundIntegrationTest(
            'should share already shared annotations when sharing a list containing already shared pages',
            { skipConflictTests: true },
            () => {
                const testData: TestData = {}
                let firstLocalListId: number
                let secondLocalListId: number

                return {
                    setup: setupPreTest,
                    steps: [
                        {
                            execute: async ({ setup }) => {
                                const {
                                    contentSharing,
                                    personalCloud,
                                    shareTestList,
                                } = await setupTest({ setup, testData })

                                firstLocalListId = await data.createContentSharingTestList(
                                    setup,
                                )
                                secondLocalListId = await setup.backgroundModules.customLists.createCustomList(
                                    {
                                        name: 'Second list',
                                    },
                                )
                                await contentSharing.shareList({
                                    listId: firstLocalListId,
                                })
                                await contentSharing.shareListEntries({
                                    listId: firstLocalListId,
                                })
                                await personalCloud.waitForSync()

                                const annotationUrl = await setup.backgroundModules.directLinking.createAnnotation(
                                    {} as any,
                                    data.ANNOTATION_1_1_DATA,
                                    { skipPageIndexing: true },
                                )
                                await contentSharing.shareAnnotation({
                                    annotationUrl,
                                })
                                await contentSharing.shareAnnotationsToLists({
                                    annotationUrls: [annotationUrl],
                                })
                                await personalCloud.waitForSync()

                                await setup.backgroundModules.customLists.insertPageToList(
                                    {
                                        id: secondLocalListId,
                                        ...data.ENTRY_1_DATA,
                                    },
                                )
                                await contentSharing.shareList({
                                    listId: secondLocalListId,
                                })
                                await contentSharing.shareListEntries({
                                    listId: secondLocalListId,
                                })

                                await personalCloud.waitForSync()
                                const remoteListIds = await Promise.all(
                                    [firstLocalListId, secondLocalListId].map(
                                        (localId) =>
                                            contentSharing.storage.getRemoteListId(
                                                {
                                                    localId,
                                                },
                                            ),
                                    ),
                                )
                                const remoteAnnotationIds = await contentSharing.storage.getRemoteAnnotationIds(
                                    {
                                        localIds: [annotationUrl],
                                    },
                                )

                                const serverStorage = await setup.getServerStorage()
                                const getShared = (collection: string) =>
                                    serverStorage.storageManager.operation(
                                        'findObjects',
                                        collection,
                                        {},
                                        { order: [['id', 'asc']] },
                                    )
                                const sharedAnnotations = await getShared(
                                    'sharedAnnotation',
                                )
                                expect(sharedAnnotations).toEqual([
                                    {
                                        id:
                                            convertRemoteId(
                                                remoteAnnotationIds[
                                                    annotationUrl
                                                ] as string,
                                            ) ||
                                            remoteAnnotationIds[annotationUrl],
                                        creator: TEST_USER.id,
                                        normalizedPageUrl: normalizeUrl(
                                            data.ANNOTATION_1_1_DATA.pageUrl,
                                        ),
                                        createdWhen: expect.any(Number),
                                        uploadedWhen: expect.any(Number),
                                        updatedWhen: expect.any(Number),
                                        comment:
                                            data.ANNOTATION_1_1_DATA.comment,
                                        body: data.ANNOTATION_1_1_DATA.body,
                                        selector: JSON.stringify(
                                            data.ANNOTATION_1_1_DATA.selector,
                                        ),
                                    },
                                ])
                                const sharedAnnotationListEntries = await getShared(
                                    'sharedAnnotationListEntry',
                                )
                                const sharedAnnotationId =
                                    convertRemoteId(
                                        remoteAnnotationIds[
                                            annotationUrl
                                        ] as string,
                                    ) || remoteAnnotationIds[annotationUrl]
                                expect(sharedAnnotationListEntries).toEqual([
                                    expect.objectContaining({
                                        normalizedPageUrl: normalizeUrl(
                                            data.ANNOTATION_1_1_DATA.pageUrl,
                                        ),
                                        sharedList: convertRemoteId(
                                            remoteListIds[0],
                                        ),
                                        sharedAnnotation: sharedAnnotationId,
                                    }),
                                    expect.objectContaining({
                                        normalizedPageUrl: normalizeUrl(
                                            data.ANNOTATION_1_1_DATA.pageUrl,
                                        ),
                                        sharedList: convertRemoteId(
                                            remoteListIds[1],
                                        ),
                                        sharedAnnotation: sharedAnnotationId,
                                    }),
                                ])

                                expect(
                                    await contentSharing.getAllRemoteLists(),
                                ).toEqual([
                                    {
                                        localId: firstLocalListId,
                                        remoteId: remoteListIds[0],
                                        name: 'My shared list',
                                    },
                                    {
                                        localId: secondLocalListId,
                                        remoteId: remoteListIds[1],
                                        name: 'Second list',
                                    },
                                ])
                            },
                        },
                    ],
                }
            },
        ),
        backgroundIntegrationTest(
            'should unshare an annotation',
            { skipConflictTests: true },
            () => {
                const testData: TestData = {}
                let localListIds: number[]

                return {
                    setup: setupPreTest,
                    steps: [
                        {
                            execute: async ({ setup }) => {
                                const {
                                    contentSharing,
                                    personalCloud,
                                    shareTestList,
                                } = await setupTest({ setup, testData })

                                localListIds = [
                                    await data.createContentSharingTestList(
                                        setup,
                                    ),
                                    await data.createContentSharingTestList(
                                        setup,
                                        { dontIndexPages: true },
                                    ),
                                ]
                                for (const localListId of localListIds) {
                                    await contentSharing.shareList({
                                        listId: localListId,
                                    })
                                    await contentSharing.shareListEntries({
                                        listId: localListId,
                                    })
                                }
                                await personalCloud.waitForSync()

                                const annotationUrl = await setup.backgroundModules.directLinking.createAnnotation(
                                    {} as any,
                                    data.ANNOTATION_1_1_DATA,
                                    { skipPageIndexing: true },
                                )
                                await contentSharing.shareAnnotation({
                                    annotationUrl,
                                })
                                await contentSharing.shareAnnotationsToLists({
                                    annotationUrls: [annotationUrl],
                                })
                                await personalCloud.waitForSync()

                                const serverStorage = await setup.getServerStorage()
                                const getShared = (collection: string) =>
                                    serverStorage.storageManager.operation(
                                        'findObjects',
                                        collection,
                                        {},
                                        { order: [['id', 'asc']] },
                                    )
                                expect(
                                    await getShared('sharedAnnotation'),
                                ).toEqual([
                                    expect.objectContaining({
                                        body: data.ANNOTATION_1_1_DATA.body,
                                    }),
                                ])
                                expect(
                                    await getShared(
                                        'sharedAnnotationListEntry',
                                    ),
                                ).toEqual([
                                    expect.objectContaining({}),
                                    expect.objectContaining({}),
                                ])

                                await contentSharing.unshareAnnotation({
                                    annotationUrl,
                                })

                                expect(
                                    await setup.storageManager.operation(
                                        'findObjects',
                                        'sharedAnnotationMetadata',
                                        {},
                                    ),
                                ).toEqual([])
                                expect(
                                    await getShared('sharedAnnotation'),
                                ).toEqual([])
                                expect(
                                    await getShared(
                                        'sharedAnnotationListEntry',
                                    ),
                                ).toEqual([])
                            },
                        },
                    ],
                }
            },
        ),
        backgroundIntegrationTest(
            'should unshare annotations when removing a page from a shared list',
            { skipConflictTests: true },
            () => {
                const testData: TestData = {}
                let localListIds: number[]

                return {
                    setup: setupPreTest,
                    steps: [
                        {
                            execute: async ({ setup }) => {
                                const {
                                    contentSharing,
                                    personalCloud,
                                    shareTestList,
                                } = await setupTest({ setup, testData })

                                localListIds = [
                                    await data.createContentSharingTestList(
                                        setup,
                                    ),
                                    await data.createContentSharingTestList(
                                        setup,
                                        { dontIndexPages: true },
                                    ),
                                ]
                                for (const localListId of localListIds) {
                                    await contentSharing.shareList({
                                        listId: localListId,
                                    })
                                    await contentSharing.shareListEntries({
                                        listId: localListId,
                                    })
                                }
                                await personalCloud.waitForSync()

                                const annotationUrl = await setup.backgroundModules.directLinking.createAnnotation(
                                    {} as any,
                                    data.ANNOTATION_1_1_DATA,
                                    { skipPageIndexing: true },
                                )
                                await contentSharing.shareAnnotation({
                                    annotationUrl,
                                })
                                await contentSharing.shareAnnotationsToLists({
                                    annotationUrls: [annotationUrl],
                                })
                                await personalCloud.waitForSync()

                                const serverStorage = await setup.getServerStorage()
                                const getShared = (collection: string) =>
                                    serverStorage.storageManager.operation(
                                        'findObjects',
                                        collection,
                                        {},
                                        { order: [['id', 'asc']] },
                                    )
                                expect(
                                    await getShared('sharedAnnotation'),
                                ).toEqual([
                                    expect.objectContaining({
                                        body: data.ANNOTATION_1_1_DATA.body,
                                    }),
                                ])
                                expect(
                                    await getShared(
                                        'sharedAnnotationListEntry',
                                    ),
                                ).toEqual([
                                    expect.objectContaining({}),
                                    expect.objectContaining({}),
                                ])

                                await setup.backgroundModules.customLists.removePageFromList(
                                    {
                                        id: localListIds[0],
                                        url: data.PAGE_1_DATA.pageDoc.url,
                                    },
                                )
                                await personalCloud.waitForSync()

                                expect(
                                    await getShared(
                                        'sharedAnnotationListEntry',
                                    ),
                                ).toEqual([expect.objectContaining({})])

                                await setup.backgroundModules.customLists.removePageFromList(
                                    {
                                        id: localListIds[1],
                                        url: data.PAGE_1_DATA.pageDoc.url,
                                    },
                                )
                                await personalCloud.waitForSync()

                                expect(
                                    await getShared(
                                        'sharedAnnotationListEntry',
                                    ),
                                ).toEqual([])
                            },
                        },
                    ],
                }
            },
        ),
        backgroundIntegrationTest(
            'should unshare annotation and remove list entries when removed locally',
            { skipConflictTests: true },
            () => {
                const testData: TestData = {}
                let localListIds: number[]

                return {
                    setup: setupPreTest,
                    steps: [
                        {
                            execute: async ({ setup }) => {
                                const {
                                    contentSharing,
                                    personalCloud,
                                    shareTestList,
                                } = await setupTest({ setup, testData })

                                localListIds = [
                                    await data.createContentSharingTestList(
                                        setup,
                                    ),
                                    await data.createContentSharingTestList(
                                        setup,
                                        { dontIndexPages: true },
                                    ),
                                ]
                                for (const localListId of localListIds) {
                                    await contentSharing.shareList({
                                        listId: localListId,
                                    })
                                    await contentSharing.shareListEntries({
                                        listId: localListId,
                                    })
                                }
                                await personalCloud.waitForSync()

                                const annotationUrl = await setup.backgroundModules.directLinking.createAnnotation(
                                    {} as any,
                                    data.ANNOTATION_1_1_DATA,
                                    { skipPageIndexing: true },
                                )
                                await contentSharing.shareAnnotation({
                                    annotationUrl,
                                })
                                await contentSharing.shareAnnotationsToLists({
                                    annotationUrls: [annotationUrl],
                                })
                                await personalCloud.waitForSync()

                                const serverStorage = await setup.getServerStorage()
                                const getShared = (collection: string) =>
                                    serverStorage.storageManager.operation(
                                        'findObjects',
                                        collection,
                                        {},
                                        { order: [['id', 'asc']] },
                                    )
                                expect(
                                    await getShared('sharedAnnotation'),
                                ).toEqual([
                                    expect.objectContaining({
                                        body: data.ANNOTATION_1_1_DATA.body,
                                    }),
                                ])
                                expect(
                                    await getShared(
                                        'sharedAnnotationListEntry',
                                    ),
                                ).toEqual([
                                    expect.objectContaining({}),
                                    expect.objectContaining({}),
                                ])

                                await setup.backgroundModules.directLinking.deleteAnnotation(
                                    null,
                                    annotationUrl,
                                )
                                await personalCloud.waitForSync()

                                expect(
                                    await getShared('sharedAnnotation'),
                                ).toEqual([])
                                expect(
                                    await getShared(
                                        'sharedAnnotationListEntry',
                                    ),
                                ).toEqual([])
                            },
                        },
                    ],
                }
            },
        ),
        backgroundIntegrationTest(
            'should add a list to local lists and store its metadata when the user joined a new list',
            { skipConflictTests: true, skipSyncTests: true },
            () => {
                const testData: TestData = {}

                return {
                    setup: setupPreTest,
                    steps: [
                        {
                            execute: async ({ setup }) => {
                                const { personalCloud } = await setupTest({
                                    setup,
                                    testData,
                                })

                                const serverStorage = await setup.getServerStorage()
                                const listReference = await serverStorage.storageModules.contentSharing.createSharedList(
                                    {
                                        listData: {
                                            title: 'Test list',
                                        },
                                        userReference: {
                                            type: 'user-reference',
                                            id: 'someone-else',
                                        },
                                    },
                                )
                                const {
                                    keyString,
                                } = await serverStorage.storageModules.contentSharing.createListKey(
                                    {
                                        key: { roleID: SharedListRoleID.Admin },
                                        listReference,
                                    },
                                )
                                await setup.backgroundModules.contentSharing.options.backend.processListKey(
                                    {
                                        keyString,
                                        listId: listReference.id,
                                    },
                                )

                                await personalCloud.integrateAllUpdates()
                                await personalCloud.waitForSync()

                                const customLists = await setup.storageManager.operation(
                                    'findObjects',
                                    'customLists',
                                    {},
                                )
                                expect(customLists).toEqual([
                                    expect.objectContaining({
                                        name: 'Test list',
                                    }),
                                ])
                                expect(
                                    await setup.storageManager.operation(
                                        'findObjects',
                                        'sharedListMetadata',
                                        {},
                                    ),
                                ).toEqual([
                                    {
                                        localId: customLists[0].id,
                                        remoteId: listReference.id.toString(),
                                    },
                                ])
                            },
                        },
                    ],
                }
            },
        ),
        backgroundIntegrationTest(
            'should add an annotation and store its metadata when the user creates a new annotation to their own page via the web UI',
            { skipConflictTests: true, skipSyncTests: true },
            () => makeAnnotationFromWebUiTest({ ownPage: true }),
        ),
        backgroundIntegrationTest(
            `should add an annotation and store its metadata when the user creates a new annotation to another user's page via the web UI`,
            { skipConflictTests: true, skipSyncTests: true },
            () => makeAnnotationFromWebUiTest({ ownPage: false }),
        ),
    ],
    { includePostSyncProcessor: true },
)

function makeShareAnnotationTest(options: {
    annotationSharingMethod: 'shareAnnotation' | 'shareAnnotations'
    testDuplicateSharing: boolean
    testProtectedBulkShare?: boolean
}): BackgroundIntegrationTestInstance {
    let localListId: number

    return {
        setup: async ({ setup }) => {},
        steps: [
            {
                execute: async ({ setup }) => {
                    const {
                        contentSharing,
                        personalCloud,
                    } = setup.backgroundModules
                    setup.authService.setUser(TEST_USER)
                    personalCloud.actionQueue.forceQueueSkip = true
                    await personalCloud.setup()

                    localListId = await data.createContentSharingTestList(setup)
                    await contentSharing.shareList({
                        listId: localListId,
                    })
                    await contentSharing.shareListEntries({
                        listId: localListId,
                    })
                    const firstAnnotationUrl = await setup.backgroundModules.directLinking.createAnnotation(
                        {} as any,
                        data.ANNOTATION_1_1_DATA,
                        { skipPageIndexing: true },
                    )
                    const secondAnnotationUrl = await setup.backgroundModules.directLinking.createAnnotation(
                        {} as any,
                        {
                            ...data.ANNOTATION_1_2_DATA,
                            privacyLevel: options.testProtectedBulkShare
                                ? AnnotationPrivacyLevels.PROTECTED
                                : AnnotationPrivacyLevels.PRIVATE,
                        },
                        { skipPageIndexing: true },
                    )
                    if (options.annotationSharingMethod === 'shareAnnotation') {
                        await contentSharing.shareAnnotation({
                            annotationUrl: firstAnnotationUrl,
                        })
                        await contentSharing.shareAnnotation({
                            annotationUrl: secondAnnotationUrl,
                        })

                        if (options.testDuplicateSharing) {
                            await contentSharing.shareAnnotation({
                                annotationUrl: secondAnnotationUrl,
                            })
                        }
                    } else if (
                        options.annotationSharingMethod === 'shareAnnotations'
                    ) {
                        await contentSharing.shareAnnotations({
                            annotationUrls: [
                                firstAnnotationUrl,
                                secondAnnotationUrl,
                            ],
                        })
                        if (options.testDuplicateSharing) {
                            await contentSharing.shareAnnotations({
                                annotationUrls: [
                                    firstAnnotationUrl,
                                    secondAnnotationUrl,
                                ],
                            })
                        }
                    }
                    await personalCloud.waitForSync()

                    const sharedAnnotationMetadataPre = await setup.storageManager.operation(
                        'findObjects',
                        'sharedAnnotationMetadata',
                        {},
                    )
                    expect(sharedAnnotationMetadataPre[0]).toEqual({
                        localId: firstAnnotationUrl,
                        remoteId: expect.anything(),
                        excludeFromLists: true,
                    })
                    expect(sharedAnnotationMetadataPre[1]).toEqual(
                        options.testProtectedBulkShare
                            ? undefined
                            : {
                                  localId: secondAnnotationUrl,
                                  remoteId: expect.anything(),
                                  excludeFromLists: true,
                              },
                    )
                    const remoteAnnotationIds = await contentSharing.storage.getRemoteAnnotationIds(
                        {
                            localIds: [firstAnnotationUrl, secondAnnotationUrl],
                        },
                    )
                    expect(remoteAnnotationIds[firstAnnotationUrl]).toEqual(
                        sharedAnnotationMetadataPre[0].remoteId,
                    )
                    expect(remoteAnnotationIds[secondAnnotationUrl]).toEqual(
                        options.testProtectedBulkShare
                            ? undefined
                            : sharedAnnotationMetadataPre[1].remoteId,
                    )

                    const serverStorage = await setup.getServerStorage()
                    const getShared = (collection: string) =>
                        serverStorage.storageManager.operation(
                            'findObjects',
                            collection,
                            {},
                        )
                    const sharedAnnotations = await getShared(
                        'sharedAnnotation',
                    )
                    expect(sharedAnnotations[0]).toEqual({
                        id:
                            convertRemoteId(
                                remoteAnnotationIds[
                                    firstAnnotationUrl
                                ] as string,
                            ) || remoteAnnotationIds[firstAnnotationUrl],
                        creator: TEST_USER.id,
                        normalizedPageUrl: normalizeUrl(
                            data.ANNOTATION_1_1_DATA.pageUrl,
                        ),
                        createdWhen: expect.any(Number),
                        uploadedWhen: expect.any(Number),
                        updatedWhen: expect.any(Number),
                        comment: data.ANNOTATION_1_1_DATA.comment,
                        body: data.ANNOTATION_1_1_DATA.body,
                        selector: JSON.stringify(
                            data.ANNOTATION_1_1_DATA.selector,
                        ),
                    })
                    expect(sharedAnnotations[1]).toEqual(
                        options.testProtectedBulkShare
                            ? undefined
                            : expect.objectContaining({
                                  body: data.ANNOTATION_1_2_DATA.body,
                              }),
                    )
                    expect(
                        await getShared('sharedAnnotationListEntry'),
                    ).toEqual([])

                    await contentSharing.shareAnnotationsToLists({
                        annotationUrls: [firstAnnotationUrl],
                    })
                    if (options.testDuplicateSharing) {
                        await contentSharing.shareAnnotationsToLists({
                            annotationUrls: [firstAnnotationUrl],
                        })
                    }
                    await personalCloud.waitForSync()

                    expect(
                        await getShared('sharedAnnotationListEntry'),
                    ).toEqual([
                        {
                            id: expect.anything(),
                            creator: TEST_USER.id,
                            normalizedPageUrl: normalizeUrl(
                                data.ANNOTATION_1_1_DATA.pageUrl,
                            ),
                            createdWhen: expect.any(Number),
                            uploadedWhen: expect.any(Number),
                            updatedWhen: expect.any(Number),
                            sharedList: expect.any(Number),
                            sharedAnnotation:
                                convertRemoteId(
                                    remoteAnnotationIds[
                                        firstAnnotationUrl
                                    ] as string,
                                ) || remoteAnnotationIds[firstAnnotationUrl],
                        },
                    ])
                    expect(await getShared('sharedPageInfo')).toEqual([
                        {
                            id: expect.anything(),
                            createdWhen: expect.any(Number),
                            updatedWhen: expect.any(Number),
                            creator: TEST_USER.id,
                            fullTitle: data.PAGE_1_DATA.pageDoc.content.title,
                            normalizedUrl: normalizeUrl(
                                data.ANNOTATION_1_1_DATA.pageUrl,
                            ),
                            originalUrl: data.ENTRY_1_DATA.url,
                        },
                    ])
                    const sharedAnnotationMetadataPost = await setup.storageManager.operation(
                        'findObjects',
                        'sharedAnnotationMetadata',
                        {},
                    )
                    expect(sharedAnnotationMetadataPost[0]).toEqual({
                        localId: firstAnnotationUrl,
                        remoteId: expect.anything(),
                        excludeFromLists: false,
                    })
                    expect(sharedAnnotationMetadataPost[1]).toEqual(
                        options.testProtectedBulkShare
                            ? undefined
                            : {
                                  localId: secondAnnotationUrl,
                                  remoteId: expect.anything(),
                                  excludeFromLists: true,
                              },
                    )
                },
            },
        ],
    }
}

function makeAnnotationFromWebUiTest(options: {
    ownPage: boolean
}): BackgroundIntegrationTestInstance {
    const testData: TestData = {}
    let storageHooksChangeWatcher: StorageHooksChangeWatcher

    return {
        getSetupOptions: (): BackgroundIntegrationTestSetupOpts => {
            storageHooksChangeWatcher = new StorageHooksChangeWatcher()
            const getServerStorage = createLazyMemoryServerStorage({
                changeWatchSettings: storageHooksChangeWatcher,
            })
            return {
                getServerStorage,
            }
        },
        setup: async (context) => {
            const fakeFetch = new FakeFetch()

            storageHooksChangeWatcher.setUp({
                fetch: fakeFetch.fetch,
                getCurrentUserReference: async () => ({
                    type: 'user-reference',
                    id: (await context.setup.authService.getCurrentUser()).id,
                }),
                serverStorageManager: (await context.setup.getServerStorage())
                    .storageManager,
                services: context.setup.services,
            })
            await setupPreTest(context)
        },
        steps: [
            {
                execute: async ({ setup }) => {
                    const { personalCloud, shareTestList } = await setupTest({
                        setup,
                        testData,
                        createTestList: true,
                    })
                    await shareTestList({ shareEntries: true })
                    await personalCloud.waitForSync()

                    const serverStorage = await setup.getServerStorage()
                    if (!options.ownPage) {
                        await serverStorage.storageModules.contentSharing.ensurePageInfo(
                            {
                                creatorReference: {
                                    type: 'user-reference',
                                    id: TEST_USER.id,
                                },
                                pageInfo: {
                                    normalizedUrl: normalizeUrl(
                                        data.ANNOTATION_1_1_DATA.pageUrl,
                                    ),
                                    originalUrl: data.PAGE_1_DATA.pageDoc.url,
                                    fullTitle: 'Full title',
                                },
                            },
                        )

                        const userTwo = {
                            id: 'test-two',
                            displayName: 'User two',
                            email: 'two@test.com',
                            emailVerified: true,
                        }
                        setup.authService.setUser(userTwo)
                        await serverStorage.storageManager.operation(
                            'createObject',
                            'user',
                            userTwo,
                        )
                    }

                    const createdWhen = Date.now()
                    const dummyLocalId = 'aaa'
                    const {
                        sharedAnnotationReferences,
                    } = await serverStorage.storageModules.contentSharing.createAnnotations(
                        {
                            annotationsByPage: {
                                [normalizeUrl(
                                    data.ANNOTATION_1_1_DATA.pageUrl,
                                )]: [
                                    {
                                        localId: dummyLocalId,
                                        createdWhen,
                                        comment:
                                            data.ANNOTATION_1_1_DATA.comment,
                                    },
                                ],
                            },
                            creator: {
                                type: 'user-reference',
                                id: 'someone-else',
                            },
                            listReferences: [],
                        },
                    )

                    await personalCloud.waitForSync() // wait for receival
                    await personalCloud.integrateAllUpdates()

                    const annotations = await setup.storageManager.operation(
                        'findObjects',
                        'annotations',
                        {},
                    )
                    expect(annotations).toEqual([
                        expect.objectContaining({
                            comment: data.ANNOTATION_1_1_DATA.comment,
                        }),
                    ])
                    expect(
                        await setup.storageManager.operation(
                            'findObjects',
                            'sharedAnnotationMetadata',
                            {},
                        ),
                    ).toEqual([
                        {
                            localId: annotations[0].url,
                            remoteId:
                                sharedAnnotationReferences[dummyLocalId].id,
                            excludeFromLists: false,
                        },
                    ])
                },
            },
        ],
    }
}
