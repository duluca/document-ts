export declare class DocumentException extends Error {
    error: string | Error;
    name: string;
    constructor(error: string | Error);
}
