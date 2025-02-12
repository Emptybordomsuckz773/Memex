import {
    RemoteFunctionRole,
    RemoteFunctionWithExtraArgs,
} from 'src/util/webextensionRPC'

export interface PageIndexingInterface<Role extends RemoteFunctionRole> {
    setTabAsIndexable: RemoteFunctionWithExtraArgs<Role, void>
}
export enum StoredContentType {
    HtmlBody = 'htmlBody',
    PdfContent = 'pdfContent',
}
