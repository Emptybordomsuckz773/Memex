import { TEST_USER } from '@worldbrain/memex-common/lib/authentication/dev'

const FIRST_PAGE_V24 = {
    url: 'getmemexed.com/test',
    fullUrl: 'https://www.getmemexed.com/test',
    domain: 'getmemexed.com',
    hostname: 'www.getmemexed.com',
    fullTitle: 'getmemexed.com title',
    text: 'getmemexed.com page conmtent',
    lang: 'en-GB',
    canonicalUrl: 'https://www.getmemexed.com/test',
    description: 'getmemexed.com description',
}

export const LOCAL_TEST_DATA_V24 = {
    pages: {
        first: FIRST_PAGE_V24,
        second: {
            url: 'notionized.com/foo',
            fullUrl: 'https://www.notionized.com/foo',
            domain: 'notionized.com/foo',
            hostname: 'www.notionized.com/foo',
            fullTitle: 'notionized.com/foo title',
            text: 'notionized.com/foo page conmtent',
            lang: 'en-US',
            canonicalUrl: 'https://www.notionized.com/foo',
            description: 'notionized.com/foo description',
        },
    },
    tags: {
        first: {
            url: FIRST_PAGE_V24.url,
            name: 'foo-tag',
        },
    },
}

export const REMOTE_TEST_DATA_V24 = {
    personalContentMetadata: {
        first: {
            id: 1,
            createdWhen: 555,
            updatedWhen: 555,
            user: TEST_USER.id,
            createdByDevice: undefined, // !!!
            canonicalUrl: 'https://www.getmemexed.com/test',
            title: 'getmemexed.com title',
        },
        second: {
            id: 2,
            createdWhen: 557,
            updatedWhen: 557,
            user: TEST_USER.id,
            createdByDevice: undefined, // !!!
            canonicalUrl: 'https://www.notionized.com/foo',
            title: 'notionized.com/foo title',
        },
    },
    personalContentLocator: {
        first: {
            id: 1,
            createdWhen: 556,
            updatedWhen: 556,
            user: TEST_USER.id,
            createdByDevice: undefined,
            personalContentMetadata: 1,
            contentSize: null,
            fingerprint: null,
            format: 'html',
            lastVisited: null,
            location: 'getmemexed.com/test',
            locationScheme: 'normalized-url-v1',
            locationType: 'remote',
            originalLocation: 'https://www.getmemexed.com/test',
            primary: true,
            valid: true,
            version: 0,
        },
        second: {
            id: 2,
            createdWhen: 558,
            updatedWhen: 558,
            user: TEST_USER.id,
            createdByDevice: undefined,
            personalContentMetadata: 2,
            contentSize: null,
            fingerprint: null,
            format: 'html',
            lastVisited: null,
            location: 'notionized.com/foo',
            locationScheme: 'normalized-url-v1',
            locationType: 'remote',
            originalLocation: 'https://www.notionized.com/foo',
            primary: true,
            valid: true,
            version: 0,
        },
    },
    personalTag: {
        first: {
            id: 1,
            createdByDevice: undefined,
            createdWhen: 559,
            updatedWhen: 559,
            user: TEST_USER.id,
            name: 'foo-tag',
        },
    },
    personalTagConnection: {
        first: {
            id: 1,
            collection: 'personalContentMetadata',
            createdByDevice: undefined,
            createdWhen: 560,
            updatedWhen: 560,
            objectId: 1,
            personalTag: 1,
            user: TEST_USER.id,
        },
    },
}
