import { browser } from 'webextension-polyfill-ts'
import * as PDFJS from 'pdfjs-dist/es5/build/pdf'
import transformPageText from 'src/util/transform-page-text'
import { PDF_RAW_TEXT_SIZE_LIMIT } from './constants'

// Run PDF.js to extract text from each page and read document metadata.
async function extractContent(pdfData: ArrayBuffer) {
    // Point PDF.js to its worker code, a static file in the extension.
    PDFJS.GlobalWorkerOptions.workerSrc = browser.extension.getURL(
        '/build/pdf.worker.min.js',
    )

    // Load PDF document into PDF.js
    // @ts-ignore
    const pdf = await PDFJS.getDocument(pdfData).promise

    // Read text from pages one by one (in parallel may be too heavy).
    const pageTexts = []
    let textSize = 0
    let truncated = false
    let pageIndex = 0
    for (pageIndex = 0; pageIndex < pdf.numPages; ++pageIndex) {
        const page = await pdf.getPage(pageIndex + 1) // starts at page number 1, not 0
        // wait for object containing items array with text pieces
        const pageItems = await page.getTextContent()
        const pageText = pageItems.items.map((item) => item.str).join(' ')

        textSize += pageText.length
        if (textSize > PDF_RAW_TEXT_SIZE_LIMIT) {
            truncated = true
            break
        }

        pageTexts.push(pageText)
    }

    // Run the joined texts through our pipeline
    const { text: processedText } = transformPageText({
        text: pageTexts.join(' '),
    })

    const metadata = await pdf.getMetadata()
    if (truncated) {
        metadata.memexTruncated = true
        metadata.memexTotalPages = pdf.numPages
        metadata.memexIncludedPages = pageIndex // not off by one, but pageIndex is the index it discarded
    }

    return {
        pdfPageTexts: pageTexts,
        pdfMetadata: metadata,
        fullText: processedText,
        author: metadata.info.Author,
        title: metadata.info.Title,
        keywords: metadata.info.Keywords,
    }
}

// Given a PDF as blob or URL, return a promise of its text and metadata.
export default async function extractPdfContent(
    input: { url: string } | { blob: Blob },
    options?: { fetch?: typeof fetch },
) {
    // TODO: If the PDF is open in a Memex PDF Reader, we should be able to save the content from that tab
    // instead of re-fetching it.

    // Fetch document if only a URL is given.
    let blob = 'blob' in input ? input.blob : undefined

    if (!('blob' in input)) {
        const doFetch = options?.fetch ?? fetch
        const response = await doFetch(input.url)

        if (response.status >= 400 && response.status < 600) {
            return Promise.reject(
                new Error(`Bad response from server: ${response.status}`),
            )
        }

        blob = await response.blob()
    }

    const pdfData = await new Promise<ArrayBuffer>(function (resolve, reject) {
        const fileReader = new FileReader()
        fileReader.onload = async (event) => {
            resolve(event.target.result as ArrayBuffer)
        }
        fileReader.onerror = (event) => reject(event.target.error)
        fileReader.readAsArrayBuffer(blob)
    })

    return extractContent(pdfData)
}
