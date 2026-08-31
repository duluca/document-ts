import { Db, MongoClientOptions } from 'mongodb';
export interface ConnectionRetryPolicy {
    /** Maximum number of driver connection attempts. */
    maxAttempts?: number;
    /** Delay between attempts, in seconds. */
    waitSeconds?: number;
}
export interface ConnectionTlsPolicy {
    /** Enables TLS for the MongoDB connection. */
    enabled: boolean;
    /** PEM file containing the trusted certificate authority chain. */
    caFile?: string;
}
export interface DatabaseConnectionOptions {
    /** MongoDB connection string, including the database name when applicable. */
    uri: string;
    /** Enables fail-closed production TLS validation. */
    production?: boolean;
    /** Retry behavior for initial connection failures. */
    retry?: ConnectionRetryPolicy;
    /** TLS policy applied after the driver options. */
    tls?: ConnectionTlsPolicy;
    /** MongoDB 6-compatible driver options. */
    mongoClientOptions?: MongoClientOptions;
}
export type DatabaseConnectionErrorCode = 'ERR_CONNECTION_CLOSED' | 'ERR_CONNECTION_CONFIG_CONFLICT' | 'ERR_INVALID_CONNECTION_OPTIONS';
export declare class DatabaseConnectionError extends Error {
    readonly code: DatabaseConnectionErrorCode;
    constructor(code: DatabaseConnectionErrorCode, message: string);
}
export declare function connect(options: DatabaseConnectionOptions): Promise<void>;
export declare function close(force?: boolean): Promise<void>;
export declare function connectionStatus(): boolean;
export declare function getDbInstance(): Db;
