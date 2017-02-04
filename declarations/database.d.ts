import { Db } from 'mongodb';
export declare function connect(mongoUri: string, isProduction?: boolean, certFileUri?: string): Promise<void>;
export declare function getDbInstance(): Db;
