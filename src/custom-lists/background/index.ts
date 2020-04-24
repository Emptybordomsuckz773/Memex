import Storex from '@worldbrain/storex'
import { Windows, Tabs, Storage } from 'webextension-polyfill-ts'
import { normalizeUrl } from '@worldbrain/memex-url-utils'

import { makeRemotelyCallable } from 'src/util/webextensionRPC'
import CustomListStorage from './storage'
import internalAnalytics from '../../analytics/internal'
import { EVENT_NAMES } from '../../analytics/internal/constants'
import { TabManager } from 'src/activity-logger/background/tab-manager'
import { SearchIndex } from 'src/search'
import {
    Tab,
    RemoteCollectionsInterface,
    CollectionsSettings,
    PageList,
    PageListEntry,
} from './types'
import PageStorage from 'src/page-indexing/background/storage'
import { pageIsStub, maybeIndexTabs } from 'src/page-indexing/utils'
import { bindMethod } from 'src/util/functions'
import { getOpenTabsInCurrentWindow } from 'src/activity-logger/background/util'
import { BrowserSettingsStore } from 'src/util/settings'

const limitSuggestionsReturnLength = 10
const limitSuggestionsStorageLength = 20

export default class CustomListBackground {
    storage: CustomListStorage
    _createPage: SearchIndex['createPageViaBmTagActs'] // public so tests can override as a hack
    remoteFunctions: RemoteCollectionsInterface

    private localStorage: BrowserSettingsStore<CollectionsSettings>

    constructor(
        private options: {
            storageManager: Storex
            searchIndex: SearchIndex
            pageStorage: PageStorage
            queryTabs?: Tabs.Static['query']
            windows?: Windows.Static
            createPage?: SearchIndex['createPageViaBmTagActs']
            localBrowserStorage: Storage.LocalStorageArea
        },
    ) {
        // Makes the custom list Table in indexed DB.
        this.storage = new CustomListStorage({
            storageManager: options.storageManager,
        })
        this._createPage =
            options.createPage || options.searchIndex.createPageViaBmTagActs

        this.remoteFunctions = {
            createCustomList: bindMethod(this, 'createCustomList'),
            insertPageToList: async (params) => {
                const currentTab = await this.options.queryTabs?.({
                    active: true,
                    currentWindow: true,
                })
                params.tabId = currentTab?.[0]?.id
                return this.insertPageToList(params)
            },
            updateListName: bindMethod(this, 'updateList'),
            removeList: bindMethod(this, 'removeList'),
            removePageFromList: bindMethod(this, 'removePageFromList'),
            fetchAllLists: bindMethod(this, 'fetchAllLists'),
            fetchListById: bindMethod(this, 'fetchListById'),
            fetchListPagesByUrl: bindMethod(this, 'fetchListPagesByUrl'),
            fetchInitialListSuggestions: bindMethod(
                this,
                'fetchInitialListSuggestions',
            ),
            fetchListNameSuggestions: bindMethod(
                this,
                'fetchListNameSuggestions',
            ),
            fetchListPagesById: bindMethod(this, 'fetchListPagesById'),
            fetchListIgnoreCase: bindMethod(this, 'fetchListIgnoreCase'),
            addOpenTabsToList: bindMethod(this, 'addOpenTabsToList'),
            removeOpenTabsFromList: bindMethod(this, 'removeOpenTabsFromList'),
        }

        this.localStorage = new BrowserSettingsStore<CollectionsSettings>(
            options.localBrowserStorage,
            { prefix: 'custom-lists' },
        )
    }

    setupRemoteFunctions() {
        makeRemotelyCallable<RemoteCollectionsInterface>(this.remoteFunctions)
    }

    generateListId() {
        return Date.now()
    }

    async fetchAllLists({
        excludeIds = [],
        skip = 0,
        limit = 20,
        skipMobileList = false,
    }): Promise<PageList[]> {
        return this.storage.fetchAllLists({
            excludedIds: excludeIds,
            skipMobileList,
            limit,
            skip,
        })
    }

    async fetchListById({ id }: { id: number }) {
        return this.storage.fetchListById(id)
    }

    async fetchListByName({ name }: { name: string }) {
        return this.storage.fetchListIgnoreCase({ name })
    }

    async createCustomLists({ names }: { names: string[] }) {
        const existingLists = new Map<string, number>()

        for (const name of names) {
            const list = await this.fetchListByName({ name })

            if (list) {
                existingLists.set(list.name, list.id)
            }
        }

        const missing = names.filter((name) => !existingLists.has(name))

        const missingEntries = await Promise.all(
            missing.map(async (name) => {
                let id: number
                try {
                    id = await this.createCustomList({ name })
                } catch (err) {
                    const list = await this.fetchListByName({ name })
                    id = list.id
                }
                return [name, id] as [string, number]
            }),
        )

        const listIds = new Map([...existingLists, ...missingEntries])

        return names.map((name) => listIds.get(name))
    }

    async fetchListPagesById({ id }: { id: number }) {
        return this.storage.fetchListPagesById({
            listId: id,
        })
    }

    async fetchListPagesByUrl({ url }: { url: string }) {
        return this.storage.fetchListPagesByUrl({
            url: normalizeUrl(url),
        })
    }

    async createCustomList({ name }: { name: string }): Promise<number> {
        internalAnalytics.processEvent({
            type: EVENT_NAMES.CREATE_COLLECTION,
        })

        const inserted = await this.storage.insertCustomList({
            id: this.generateListId(),
            name,
        })

        await this._updateListSuggestionsCache({ added: name })

        return inserted
    }

    async updateList({ id, name }: { id: number; name: string }) {
        return this.storage.updateListName({
            id,
            name,
        })
    }

    private async createPageIfNeeded({
        url,
        tabId,
    }: {
        url: string
        tabId?: number
    }) {
        const exists = await this.options.pageStorage.pageExists(url)
        if (!exists) {
            await this._createPage({
                url,
                tabId,
                visitTime: Date.now(),
                save: true,
            })
        }
    }

    async insertPageToList({
        id,
        url,
        tabId,
    }: {
        id: number
        url: string
        tabId?: number
    }): Promise<{ object: PageListEntry }> {
        internalAnalytics.processEvent({
            type: EVENT_NAMES.INSERT_PAGE_COLLECTION,
        })

        await this.createPageIfNeeded({ url, tabId })

        const retVal = await this.storage.insertPageToList({
            listId: id,
            pageUrl: normalizeUrl(url),
            fullUrl: url,
        })

        const list = await this.fetchListById({ id })
        await this._updateListSuggestionsCache({ added: list.name })

        return retVal
    }

    async removeList({ id }: { id: number }) {
        internalAnalytics.processEvent({
            type: EVENT_NAMES.REMOVE_COLLECTION,
        })

        return this.storage.removeList({
            id,
        })
    }

    async removePageFromList({ id, url }: { id: number; url: string }) {
        internalAnalytics.processEvent({
            type: EVENT_NAMES.REMOVE_PAGE_COLLECTION,
        })

        return this.storage.removePageFromList({
            listId: id,
            pageUrl: normalizeUrl(url),
        })
    }

    async fetchInitialListSuggestions(
        { limit }: { limit?: number } = { limit: limitSuggestionsReturnLength },
    ) {
        let suggestions = await this.localStorage.get('suggestions')

        if (!suggestions) {
            const lists = await this.fetchAllLists({
                limit,
                skipMobileList: true,
            })
            suggestions = lists.map((l) => l.name)

            console['info'](
                'No cached tag suggestions found so loaded suggestions from DB:',
                suggestions,
            )
            await this.localStorage.set('suggestions', suggestions)
        }

        return suggestions.slice(0, limit)
    }

    async _updateListSuggestionsCache(args: {
        added?: string
        removed?: string
    }) {
        let suggestions = (await this.localStorage.get('suggestions')) ?? []

        if (args.added) {
            const index = suggestions.indexOf(args.added)
            if (index) {
                delete suggestions[index]
                suggestions = suggestions.filter(Boolean)
            }
            suggestions.unshift(args.added)
        }

        if (args.removed) {
            const index = suggestions.indexOf(args.removed)
            delete suggestions[index]
            suggestions = suggestions.filter(Boolean)
        }

        suggestions = suggestions.slice(0, limitSuggestionsStorageLength)
        await this.localStorage.set('suggestions', suggestions)
    }

    async fetchListNameSuggestions({
        name,
        url,
    }: {
        name: string
        url: string
    }) {
        return this.storage.fetchListNameSuggestions({
            name,
            url: normalizeUrl(url),
        })
    }

    async fetchListIgnoreCase({ name }: { name: string }) {
        return this.storage.fetchListIgnoreCase({
            name,
        })
    }

    async addOpenTabsToList({
        listId,
        tabs,
    }: {
        listId: number
        tabs?: Tab[]
    }) {
        if (!tabs) {
            tabs = await getOpenTabsInCurrentWindow(
                this.options.windows,
                this.options.queryTabs,
            )
        }

        const time = Date.now()

        const indexed = await maybeIndexTabs(tabs, {
            pageStorage: this.options.pageStorage,
            createPage: this._createPage,
            time,
        })

        await Promise.all(
            indexed.map(({ fullUrl }) => {
                this.storage.insertPageToList({
                    listId,
                    fullUrl,
                    pageUrl: normalizeUrl(fullUrl),
                })
            }),
        )

        const list = await this.fetchListById({ id: listId })
        await this._updateListSuggestionsCache({ added: list.name })
    }

    async removeOpenTabsFromList({
        listId,
        tabs,
    }: {
        listId: number
        tabs?: Tab[]
    }) {
        if (!tabs) {
            tabs = await getOpenTabsInCurrentWindow(
                this.options.windows,
                this.options.queryTabs,
            )
        }

        await Promise.all(
            tabs.map((tab) =>
                this.storage.removePageFromList({
                    listId,
                    pageUrl: normalizeUrl(tab.url),
                }),
            ),
        )
    }
}
