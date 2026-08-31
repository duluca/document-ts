export type DocumentExceptionCode = 'DOCUMENT_CONFLICT' | 'DOCUMENT_DUPLICATE_KEY' | 'DOCUMENT_INVALID_HYDRATION' | 'DOCUMENT_INVALID_ID' | 'DOCUMENT_OPERATION_FAILED' | 'DOCUMENT_VALIDATION_FAILED';
export declare class DocumentException extends Error {
    readonly code: DocumentExceptionCode;
    readonly cause?: unknown | undefined;
    get name(): string;
    protected constructor(code: DocumentExceptionCode, message: string, cause?: unknown | undefined);
    static from(error: unknown): DocumentException;
}
export declare class DocumentConflictException extends DocumentException {
    get name(): string;
    constructor();
}
export declare class DocumentHydrationException extends DocumentException {
    get name(): string;
    constructor();
}
export declare class DocumentIdentifierException extends DocumentException {
    get name(): string;
    constructor();
}
export declare class DocumentValidationException extends DocumentException {
    get name(): string;
    constructor(message?: string);
}
