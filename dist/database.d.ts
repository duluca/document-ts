import { Db } from 'mongodb';
export declare function connect(mongoUri: string, isProduction?: boolean, connectionRetryWait?: number, connectionRetryMax?: number, certFileUri?: string): Promise<void>;
export declare function close(force?: boolean): Promise<void>;
export declare function connectionStatus(): boolean;
export declare function getDbInstance(): Db;
