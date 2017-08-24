import { Db } from 'mongodb';
export declare function connect(mongoUri: string, isProduction?: boolean, connectionRetryWait?: number, connectionRetryMax?: number, certFileUri?: string): Promise<void>;
export declare function getDbInstance(): Db;
