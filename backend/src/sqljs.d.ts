declare module 'sql.js' {
  export class Statement {
    bind(values?: any): boolean;
    step(): boolean;
    getAsObject(params?: any): Record<string, any>;
    free(): boolean;
  }

  export class Database {
    constructor(data?: ArrayLike<number> | Buffer | null);
    run(sql: string, params?: any[]): this;
    prepare(sql: string, params?: any[]): Statement;
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlJsStatic {
    Database: typeof Database;
  }

  export default function initSqlJs(config?: any): Promise<SqlJsStatic>;
}

