declare module "@modelcontextprotocol/sdk/server/stdio.js" {
  import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
  export class StdioServerTransport implements Transport {
    constructor(stdin?: NodeJS.ReadableStream, stdout?: NodeJS.WritableStream);
    start(): Promise<void>;
    send(message: unknown): Promise<void>;
    close(): Promise<void>;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: unknown) => void;
  }
}

declare module "@modelcontextprotocol/sdk/shared/transport.js" {
  export interface Transport {
    start(): Promise<void>;
    send(message: unknown): Promise<void>;
    close(): Promise<void>;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: unknown) => void;
  }
}
