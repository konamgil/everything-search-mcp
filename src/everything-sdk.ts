import koffi from "koffi";
import { existsSync } from "node:fs";
import path from "node:path";
import { ensureEverythingRunning, INSTALL_HINT, type EnsureOptions } from "./everything-process.js";

export const REQUEST = {
  FILE_NAME: 0x00000001,
  PATH: 0x00000002,
  FULL_PATH_AND_FILE_NAME: 0x00000004,
  EXTENSION: 0x00000008,
  SIZE: 0x00000010,
  DATE_CREATED: 0x00000020,
  DATE_MODIFIED: 0x00000040,
  DATE_ACCESSED: 0x00000080,
  ATTRIBUTES: 0x00000100,
} as const;

export const SORT = {
  NAME_ASCENDING: 1,
  NAME_DESCENDING: 2,
  PATH_ASCENDING: 3,
  PATH_DESCENDING: 4,
  SIZE_ASCENDING: 5,
  SIZE_DESCENDING: 6,
  EXTENSION_ASCENDING: 7,
  EXTENSION_DESCENDING: 8,
  DATE_CREATED_ASCENDING: 11,
  DATE_CREATED_DESCENDING: 12,
  DATE_MODIFIED_ASCENDING: 13,
  DATE_MODIFIED_DESCENDING: 14,
  ATTRIBUTES_ASCENDING: 15,
  ATTRIBUTES_DESCENDING: 16,
  FILE_LIST_FILENAME_ASCENDING: 17,
  FILE_LIST_FILENAME_DESCENDING: 18,
  RUN_COUNT_ASCENDING: 19,
  RUN_COUNT_DESCENDING: 20,
  DATE_RECENTLY_CHANGED_ASCENDING: 21,
  DATE_RECENTLY_CHANGED_DESCENDING: 22,
  DATE_ACCESSED_ASCENDING: 23,
  DATE_ACCESSED_DESCENDING: 24,
  DATE_RUN_ASCENDING: 25,
  DATE_RUN_DESCENDING: 26,
} as const;

export const ERROR_CODES: Record<number, string> = {
  0: "OK",
  1: "ERROR_MEMORY: Out of memory",
  2: "ERROR_IPC: Everything is not running (IPC unavailable)",
  3: "ERROR_REGISTERCLASSEX: Failed to register the search query window class",
  4: "ERROR_CREATEWINDOW: Failed to create the search query window",
  5: "ERROR_CREATETHREAD: Failed to create the search query thread",
  6: "ERROR_INVALIDINDEX: Invalid result index",
  7: "ERROR_INVALIDCALL: Invalid call",
  8: "ERROR_INVALIDREQUEST: Invalid request data — call SetRequestFlags before Query",
  9: "ERROR_INVALIDPARAMETER: Bad parameter",
};

const FILETIME_EPOCH_DIFF_MS = 11644473600000n;

export function filetimeToDate(ft: bigint): Date | null {
  if (ft === 0n) return null;
  const ms = ft / 10000n - FILETIME_EPOCH_DIFF_MS;
  return new Date(Number(ms));
}

function resolveDllPath(): string {
  const candidates: string[] = [];

  if (process.env.EVERYTHING_DLL_PATH) {
    candidates.push(process.env.EVERYTHING_DLL_PATH);
  }

  const moduleDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  candidates.push(
    path.join(moduleDir, "..", "Everything64.dll"),
    path.join(moduleDir, "..", "..", "Everything64.dll"),
    path.join(process.cwd(), "Everything64.dll"),
    "C:\\Program Files\\Everything\\Everything64.dll",
    "C:\\Program Files\\Everything\\SDK\\dll\\Everything64.dll",
    "C:\\tools\\Everything-SDK\\dll\\Everything64.dll",
  );

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  throw new Error(
    `Everything64.dll not found. Set EVERYTHING_DLL_PATH or place the DLL in one of: ${candidates.join(", ")}`,
  );
}

export interface SearchResult {
  fullPath: string;
  fileName: string;
  parentPath: string;
  isFolder: boolean;
  isVolume: boolean;
  size?: number;
  dateModified?: Date | null;
  dateCreated?: Date | null;
  dateAccessed?: Date | null;
  extension?: string;
  attributes?: number;
}

export interface SearchOptions {
  query: string;
  matchCase?: boolean;
  matchWholeWord?: boolean;
  matchPath?: boolean;
  regex?: boolean;
  max?: number;
  offset?: number;
  sort?: keyof typeof SORT;
  requestSize?: boolean;
  requestDates?: boolean;
  requestExtension?: boolean;
  requestAttributes?: boolean;
}

export interface SearchResponse {
  totalResults: number;
  returnedResults: number;
  results: SearchResult[];
}

class EverythingSDK {
  private lib: koffi.IKoffiLib;
  private fn: {
    SetSearchW: (s: string) => void;
    SetMatchPath: (b: number) => void;
    SetMatchCase: (b: number) => void;
    SetMatchWholeWord: (b: number) => void;
    SetRegex: (b: number) => void;
    SetMax: (n: number) => void;
    SetOffset: (n: number) => void;
    SetSort: (n: number) => void;
    SetRequestFlags: (n: number) => void;
    QueryW: (wait: number) => number;
    GetNumResults: () => number;
    GetTotResults: () => number;
    GetResultFileNameW: (i: number) => string | null;
    GetResultPathW: (i: number) => string | null;
    GetResultExtensionW: (i: number) => string | null;
    GetResultSize: (i: number, out: Buffer) => number;
    GetResultDateModified: (i: number, out: Buffer) => number;
    GetResultDateCreated: (i: number, out: Buffer) => number;
    GetResultDateAccessed: (i: number, out: Buffer) => number;
    GetResultAttributes: (i: number) => number;
    IsFolderResult: (i: number) => number;
    IsVolumeResult: (i: number) => number;
    GetLastError: () => number;
    GetMajorVersion: () => number;
    GetMinorVersion: () => number;
    GetRevision: () => number;
    GetBuildNumber: () => number;
    IsDBLoaded: () => number;
    CleanUp: () => void;
    Reset: () => void;
  };

  constructor(dllPath?: string) {
    const resolved = dllPath ?? resolveDllPath();
    this.lib = koffi.load(resolved);

    const l = this.lib;
    this.fn = {
      SetSearchW: l.func("__stdcall", "Everything_SetSearchW", "void", ["str16"]) as never,
      SetMatchPath: l.func("__stdcall", "Everything_SetMatchPath", "void", ["int"]) as never,
      SetMatchCase: l.func("__stdcall", "Everything_SetMatchCase", "void", ["int"]) as never,
      SetMatchWholeWord: l.func("__stdcall", "Everything_SetMatchWholeWord", "void", ["int"]) as never,
      SetRegex: l.func("__stdcall", "Everything_SetRegex", "void", ["int"]) as never,
      SetMax: l.func("__stdcall", "Everything_SetMax", "void", ["uint32"]) as never,
      SetOffset: l.func("__stdcall", "Everything_SetOffset", "void", ["uint32"]) as never,
      SetSort: l.func("__stdcall", "Everything_SetSort", "void", ["uint32"]) as never,
      SetRequestFlags: l.func("__stdcall", "Everything_SetRequestFlags", "void", ["uint32"]) as never,
      QueryW: l.func("__stdcall", "Everything_QueryW", "int", ["int"]) as never,
      GetNumResults: l.func("__stdcall", "Everything_GetNumResults", "uint32", []) as never,
      GetTotResults: l.func("__stdcall", "Everything_GetTotResults", "uint32", []) as never,
      GetResultFileNameW: l.func("__stdcall", "Everything_GetResultFileNameW", "str16", ["uint32"]) as never,
      GetResultPathW: l.func("__stdcall", "Everything_GetResultPathW", "str16", ["uint32"]) as never,
      GetResultExtensionW: l.func("__stdcall", "Everything_GetResultExtensionW", "str16", ["uint32"]) as never,
      GetResultSize: l.func("__stdcall", "Everything_GetResultSize", "int", ["uint32", "void *"]) as never,
      GetResultDateModified: l.func("__stdcall", "Everything_GetResultDateModified", "int", ["uint32", "void *"]) as never,
      GetResultDateCreated: l.func("__stdcall", "Everything_GetResultDateCreated", "int", ["uint32", "void *"]) as never,
      GetResultDateAccessed: l.func("__stdcall", "Everything_GetResultDateAccessed", "int", ["uint32", "void *"]) as never,
      GetResultAttributes: l.func("__stdcall", "Everything_GetResultAttributes", "uint32", ["uint32"]) as never,
      IsFolderResult: l.func("__stdcall", "Everything_IsFolderResult", "int", ["uint32"]) as never,
      IsVolumeResult: l.func("__stdcall", "Everything_IsVolumeResult", "int", ["uint32"]) as never,
      GetLastError: l.func("__stdcall", "Everything_GetLastError", "uint32", []) as never,
      GetMajorVersion: l.func("__stdcall", "Everything_GetMajorVersion", "uint32", []) as never,
      GetMinorVersion: l.func("__stdcall", "Everything_GetMinorVersion", "uint32", []) as never,
      GetRevision: l.func("__stdcall", "Everything_GetRevision", "uint32", []) as never,
      GetBuildNumber: l.func("__stdcall", "Everything_GetBuildNumber", "uint32", []) as never,
      IsDBLoaded: l.func("__stdcall", "Everything_IsDBLoaded", "int", []) as never,
      CleanUp: l.func("__stdcall", "Everything_CleanUp", "void", []) as never,
      Reset: l.func("__stdcall", "Everything_Reset", "void", []) as never,
    };
  }

  getVersion() {
    return {
      major: this.fn.GetMajorVersion(),
      minor: this.fn.GetMinorVersion(),
      revision: this.fn.GetRevision(),
      build: this.fn.GetBuildNumber(),
      dbLoaded: this.fn.IsDBLoaded() !== 0,
    };
  }

  search(options: SearchOptions): SearchResponse {
    this.fn.Reset();
    this.fn.SetSearchW(options.query);
    this.fn.SetMatchCase(options.matchCase ? 1 : 0);
    this.fn.SetMatchWholeWord(options.matchWholeWord ? 1 : 0);
    this.fn.SetMatchPath(options.matchPath ? 1 : 0);
    this.fn.SetRegex(options.regex ? 1 : 0);
    this.fn.SetMax(options.max ?? 100);
    this.fn.SetOffset(options.offset ?? 0);

    if (options.sort) {
      this.fn.SetSort(SORT[options.sort]);
    }

    let flags = REQUEST.FILE_NAME | REQUEST.PATH;
    if (options.requestSize) flags |= REQUEST.SIZE;
    if (options.requestDates) {
      flags |= REQUEST.DATE_MODIFIED | REQUEST.DATE_CREATED | REQUEST.DATE_ACCESSED;
    }
    if (options.requestExtension) flags |= REQUEST.EXTENSION;
    if (options.requestAttributes) flags |= REQUEST.ATTRIBUTES;
    this.fn.SetRequestFlags(flags);

    const ok = this.fn.QueryW(1);
    if (!ok) {
      const err = this.fn.GetLastError();
      if (err === 2) {
        throw new Error(INSTALL_HINT);
      }
      throw new Error(`Everything query failed: ${ERROR_CODES[err] ?? `code ${err}`}`);
    }

    const numResults = this.fn.GetNumResults();
    const totalResults = this.fn.GetTotResults();
    const results: SearchResult[] = [];

    for (let i = 0; i < numResults; i++) {
      const fileName = this.fn.GetResultFileNameW(i) ?? "";
      const parentPath = this.fn.GetResultPathW(i) ?? "";
      const fullPath = parentPath ? path.win32.join(parentPath, fileName) : fileName;
      const isFolder = this.fn.IsFolderResult(i) !== 0;
      const isVolume = this.fn.IsVolumeResult(i) !== 0;

      const r: SearchResult = { fullPath, fileName, parentPath, isFolder, isVolume };

      if (options.requestSize) {
        const buf = Buffer.alloc(8);
        if (this.fn.GetResultSize(i, buf)) {
          const v = buf.readBigInt64LE(0);
          r.size = v >= 0n ? Number(v) : undefined;
        }
      }

      if (options.requestDates) {
        const fm = Buffer.alloc(8);
        if (this.fn.GetResultDateModified(i, fm)) {
          r.dateModified = filetimeToDate(fm.readBigUInt64LE(0));
        }
        const fc = Buffer.alloc(8);
        if (this.fn.GetResultDateCreated(i, fc)) {
          r.dateCreated = filetimeToDate(fc.readBigUInt64LE(0));
        }
        const fa = Buffer.alloc(8);
        if (this.fn.GetResultDateAccessed(i, fa)) {
          r.dateAccessed = filetimeToDate(fa.readBigUInt64LE(0));
        }
      }

      if (options.requestExtension) {
        r.extension = this.fn.GetResultExtensionW(i) ?? undefined;
      }

      if (options.requestAttributes) {
        r.attributes = this.fn.GetResultAttributes(i);
      }

      results.push(r);
    }

    return { totalResults, returnedResults: numResults, results };
  }

  cleanup() {
    this.fn.CleanUp();
  }

  async ensureReady(options?: EnsureOptions): Promise<void> {
    await ensureEverythingRunning(
      {
        GetMajorVersion: () => this.fn.GetMajorVersion(),
        GetLastError: () => this.fn.GetLastError(),
        IsDBLoaded: () => this.fn.IsDBLoaded(),
      },
      options,
    );
  }
}

let instance: EverythingSDK | null = null;

export function getSdk(): EverythingSDK {
  if (!instance) instance = new EverythingSDK();
  return instance;
}

let inFlight: Promise<void> | null = null;

export async function getReadySdk(options?: EnsureOptions): Promise<EverythingSDK> {
  const sdk = getSdk();
  if (!inFlight) {
    inFlight = sdk.ensureReady(options).finally(() => {
      inFlight = null;
    });
  }
  await inFlight;
  return sdk;
}
