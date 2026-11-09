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

declare module 'msedge-tts' {
  export const OUTPUT_FORMAT: {
    AUDIO_24KHZ_48KBITRATE_MONO_MP3: string;
    [key: string]: string;
  };
  export class MsEdgeTTS {
    setMetadata(voiceName: string, outputFormat: string): Promise<void>;
    toStream(text: string): { audioStream: AsyncIterable<Buffer | Uint8Array> };
  }
}


