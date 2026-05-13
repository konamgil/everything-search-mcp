import koffi from "koffi";
import { existsSync } from "node:fs";
import path from "node:path";

export const PROP = {
  NAME: 0,
  PATH: 1,
  SIZE: 2,
  EXTENSION: 3,
  DATE_MODIFIED: 5,
  DATE_CREATED: 6,
  DATE_ACCESSED: 7,
  ATTRIBUTES: 8,
  CONTENT: 416,
} as const;

export const V3_SORT_PROPERTY: Record<string, number> = {
  NAME_ASCENDING: PROP.NAME,
  NAME_DESCENDING: PROP.NAME,
  PATH_ASCENDING: PROP.PATH,
  PATH_DESCENDING: PROP.PATH,
  SIZE_ASCENDING: PROP.SIZE,
  SIZE_DESCENDING: PROP.SIZE,
  EXTENSION_ASCENDING: PROP.EXTENSION,
  EXTENSION_DESCENDING: PROP.EXTENSION,
  DATE_MODIFIED_ASCENDING: PROP.DATE_MODIFIED,
  DATE_MODIFIED_DESCENDING: PROP.DATE_MODIFIED,
  DATE_CREATED_ASCENDING: PROP.DATE_CREATED,
  DATE_CREATED_DESCENDING: PROP.DATE_CREATED,
  DATE_ACCESSED_ASCENDING: PROP.DATE_ACCESSED,
  DATE_ACCESSED_DESCENDING: PROP.DATE_ACCESSED,
};

const FILETIME_EPOCH_DIFF_MS = 11644473600000n;

function filetimeToDate(ft: bigint): Date | null {
  if (ft === 0n || ft === 0xffffffffffffffffn) return null;
  const ms = ft / 10000n - FILETIME_EPOCH_DIFF_MS;
  return new Date(Number(ms));
}

function resolveDllPath(): string {
  const candidates: string[] = [];
  if (process.env.EVERYTHING3_DLL_PATH) candidates.push(process.env.EVERYTHING3_DLL_PATH);

  const moduleDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  candidates.push(
    path.join(moduleDir, "..", "Everything3_x64.dll"),
    path.join(moduleDir, "..", "..", "Everything3_x64.dll"),
    path.join(process.cwd(), "Everything3_x64.dll"),
    "C:\\Program Files\\Everything 1.5a\\Everything3_x64.dll",
    "C:\\Program Files\\Everything\\Everything3_x64.dll",
  );
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(`Everything3_x64.dll not found. Tried: ${candidates.join(", ")}`);
}

export interface V3SearchOptions {
  query: string;
  matchCase?: boolean;
  matchWholeWord?: boolean;
  matchPath?: boolean;
  regex?: boolean;
  max?: number;
  offset?: number;
  sort?: keyof typeof V3_SORT_PROPERTY;
  includeSize?: boolean;
  includeDates?: boolean;
  includeExtension?: boolean;
  includeAttributes?: boolean;
  includeSnippet?: boolean;
}

export interface V3SearchResult {
  fullPath: string;
  fileName: string;
  parentPath: string;
  size?: number;
  dateModified?: Date | null;
  dateCreated?: Date | null;
  dateAccessed?: Date | null;
  extension?: string;
  attributes?: number;
  snippet?: string;
}

export interface V3SearchResponse {
  totalResults: number;
  returnedResults: number;
  results: V3SearchResult[];
}

const SENTINEL_U64 = 0xffffffffffffffffn;

class EverythingSdkV3 {
  private lib: koffi.IKoffiLib;
  private client: unknown = null;
  private fn: {
    ConnectW: (s: string | null) => unknown;
    DestroyClient: (c: unknown) => number;
    IsDBLoaded: (c: unknown) => number;
    GetMajor: (c: unknown) => number;
    GetMinor: (c: unknown) => number;
    GetRev: (c: unknown) => number;
    GetBuild: (c: unknown) => number;
    GetLastError: () => number;

    CreateState: () => unknown;
    DestroyState: (s: unknown) => number;
    SetText: (s: unknown, q: string) => number;
    SetMatchCase: (s: unknown, b: number) => number;
    SetMatchWholeWords: (s: unknown, b: number) => number;
    SetMatchPath: (s: unknown, b: number) => number;
    SetRegex: (s: unknown, b: number) => number;
    SetViewportOffset: (s: unknown, n: number) => number;
    SetViewportCount: (s: unknown, n: number) => number;
    SetSort: (s: unknown, prop: number, asc: number) => number;
    AddPropertyRequest: (s: unknown, prop: number) => number;
    AddPropertyRequestHighlighted: (s: unknown, prop: number) => number;

    Search: (c: unknown, s: unknown) => unknown;
    DestroyRL: (rl: unknown) => number;
    RLCount: (rl: unknown) => number;
    GetFullPath: (rl: unknown, idx: number, buf: Buffer, wcap: number) => number;
    GetName: (rl: unknown, idx: number, buf: Buffer, wcap: number) => number;
    GetPath: (rl: unknown, idx: number, buf: Buffer, wcap: number) => number;
    GetExt: (rl: unknown, idx: number, buf: Buffer, wcap: number) => number;
    GetSize: (rl: unknown, idx: number) => bigint;
    GetDateModified: (rl: unknown, idx: number) => bigint;
    GetDateCreated: (rl: unknown, idx: number) => bigint;
    GetDateAccessed: (rl: unknown, idx: number) => bigint;
    GetHighlightedW: (rl: unknown, idx: number, prop: number, buf: Buffer, wcap: number) => number;
  };

  constructor(dllPath?: string) {
    const resolved = dllPath ?? resolveDllPath();
    this.lib = koffi.load(resolved);
    const l = this.lib;

    const fn = (name: string, ret: string, args: string[]) =>
      l.func("__stdcall", name, ret, args) as never;

    this.fn = {
      ConnectW: fn("Everything3_ConnectW", "void *", ["str16"]),
      DestroyClient: fn("Everything3_DestroyClient", "int", ["void *"]),
      IsDBLoaded: fn("Everything3_IsDBLoaded", "int", ["void *"]),
      GetMajor: fn("Everything3_GetMajorVersion", "uint32", ["void *"]),
      GetMinor: fn("Everything3_GetMinorVersion", "uint32", ["void *"]),
      GetRev: fn("Everything3_GetRevision", "uint32", ["void *"]),
      GetBuild: fn("Everything3_GetBuildNumber", "uint32", ["void *"]),
      GetLastError: fn("Everything3_GetLastError", "uint32", []),

      CreateState: fn("Everything3_CreateSearchState", "void *", []),
      DestroyState: fn("Everything3_DestroySearchState", "int", ["void *"]),
      SetText: fn("Everything3_SetSearchTextW", "int", ["void *", "str16"]),
      SetMatchCase: fn("Everything3_SetSearchMatchCase", "int", ["void *", "int"]),
      SetMatchWholeWords: fn("Everything3_SetSearchMatchWholeWords", "int", ["void *", "int"]),
      SetMatchPath: fn("Everything3_SetSearchMatchPath", "int", ["void *", "int"]),
      SetRegex: fn("Everything3_SetSearchRegex", "int", ["void *", "int"]),
      SetViewportOffset: fn("Everything3_SetSearchViewportOffset", "int", ["void *", "size_t"]),
      SetViewportCount: fn("Everything3_SetSearchViewportCount", "int", ["void *", "size_t"]),
      SetSort: fn("Everything3_SetSearchSort", "int", ["void *", "uint32", "int"]),
      AddPropertyRequest: fn("Everything3_AddSearchPropertyRequest", "int", ["void *", "uint32"]),
      AddPropertyRequestHighlighted: fn(
        "Everything3_AddSearchPropertyRequestHighlighted",
        "int",
        ["void *", "uint32"],
      ),

      Search: fn("Everything3_Search", "void *", ["void *", "void *"]),
      DestroyRL: fn("Everything3_DestroyResultList", "int", ["void *"]),
      RLCount: fn("Everything3_GetResultListCount", "size_t", ["void *"]),
      GetFullPath: fn("Everything3_GetResultFullPathNameW", "size_t", [
        "void *",
        "size_t",
        "uint16_t *",
        "size_t",
      ]),
      GetName: fn("Everything3_GetResultNameW", "size_t", ["void *", "size_t", "uint16_t *", "size_t"]),
      GetPath: fn("Everything3_GetResultPathW", "size_t", ["void *", "size_t", "uint16_t *", "size_t"]),
      GetExt: fn("Everything3_GetResultExtensionW", "size_t", [
        "void *",
        "size_t",
        "uint16_t *",
        "size_t",
      ]),
      GetSize: fn("Everything3_GetResultSize", "uint64", ["void *", "size_t"]),
      GetDateModified: fn("Everything3_GetResultDateModified", "uint64", ["void *", "size_t"]),
      GetDateCreated: fn("Everything3_GetResultDateCreated", "uint64", ["void *", "size_t"]),
      GetDateAccessed: fn("Everything3_GetResultDateAccessed", "uint64", ["void *", "size_t"]),
      GetHighlightedW: fn("Everything3_GetResultPropertyTextHighlightedW", "size_t", [
        "void *",
        "size_t",
        "uint32",
        "uint16_t *",
        "size_t",
      ]),
    };
  }

  connect(instance: string | null = "1.5a"): boolean {
    if (this.client) return true;
    const c = this.fn.ConnectW(instance);
    if (!c) return false;
    this.client = c;
    return true;
  }

  ensureConnected(): void {
    if (this.client) return;
    const tried: { instance: string | null; err: number }[] = [];
    for (const inst of ["1.5a", "", null] as (string | null)[]) {
      const c = this.fn.ConnectW(inst);
      const err = this.fn.GetLastError();
      tried.push({ instance: inst, err });
      if (c) {
        this.client = c;
        return;
      }
    }
    const details = tried.map((t) => `${t.instance === null ? "<null>" : `"${t.instance}"`}=0x${t.err.toString(16)}`).join(", ");
    throw new Error(`Everything3 connect failed (${details}). Pipe likely not accessible — Medium-IL shells often get 0xE0000002.`);
  }

  getVersion() {
    this.ensureConnected();
    return {
      major: this.fn.GetMajor(this.client),
      minor: this.fn.GetMinor(this.client),
      revision: this.fn.GetRev(this.client),
      build: this.fn.GetBuild(this.client),
      dbLoaded: this.fn.IsDBLoaded(this.client) !== 0,
    };
  }

  search(options: V3SearchOptions): V3SearchResponse {
    this.ensureConnected();

    const state = this.fn.CreateState();
    if (!state) throw new Error("CreateSearchState returned null");

    try {
      this.fn.SetText(state, options.query);
      if (options.matchCase) this.fn.SetMatchCase(state, 1);
      if (options.matchWholeWord) this.fn.SetMatchWholeWords(state, 1);
      if (options.matchPath) this.fn.SetMatchPath(state, 1);
      if (options.regex) this.fn.SetRegex(state, 1);
      this.fn.SetViewportCount(state, options.max ?? 100);
      this.fn.SetViewportOffset(state, options.offset ?? 0);

      if (options.sort) {
        const prop = V3_SORT_PROPERTY[options.sort];
        const asc = options.sort.endsWith("ASCENDING") ? 1 : 0;
        this.fn.SetSort(state, prop, asc);
      }

      this.fn.AddPropertyRequest(state, PROP.NAME);
      this.fn.AddPropertyRequest(state, PROP.PATH);
      if (options.includeSize) this.fn.AddPropertyRequest(state, PROP.SIZE);
      if (options.includeDates) {
        this.fn.AddPropertyRequest(state, PROP.DATE_MODIFIED);
        this.fn.AddPropertyRequest(state, PROP.DATE_CREATED);
        this.fn.AddPropertyRequest(state, PROP.DATE_ACCESSED);
      }
      if (options.includeExtension) this.fn.AddPropertyRequest(state, PROP.EXTENSION);
      if (options.includeSnippet) this.fn.AddPropertyRequestHighlighted(state, PROP.CONTENT);

      const rl = this.fn.Search(this.client, state);
      if (!rl) {
        const err = this.fn.GetLastError();
        throw new Error(`Everything3 search failed: 0x${err.toString(16)}`);
      }

      try {
        const totalCount = this.fn.RLCount(rl);
        const fetchCount = Math.min(totalCount, options.max ?? 100);
        const results: V3SearchResult[] = [];
        const cap = 4096;
        const wbuf = Buffer.alloc(cap * 2);
        const snipBuf = Buffer.alloc(8192 * 2);

        for (let i = 0; i < fetchCount; i++) {
          const nameLen = this.fn.GetName(rl, i, wbuf, cap);
          const fileName = wbuf.subarray(0, nameLen * 2).toString("utf16le");
          const pathLen = this.fn.GetPath(rl, i, wbuf, cap);
          const parentPath = wbuf.subarray(0, pathLen * 2).toString("utf16le");
          const fullPath = parentPath ? path.win32.join(parentPath, fileName) : fileName;

          const r: V3SearchResult = { fullPath, fileName, parentPath };

          if (options.includeSize) {
            const sz = this.fn.GetSize(rl, i);
            if (sz !== SENTINEL_U64) r.size = Number(sz);
          }
          if (options.includeDates) {
            r.dateModified = filetimeToDate(this.fn.GetDateModified(rl, i));
            r.dateCreated = filetimeToDate(this.fn.GetDateCreated(rl, i));
            r.dateAccessed = filetimeToDate(this.fn.GetDateAccessed(rl, i));
          }
          if (options.includeExtension) {
            const eLen = this.fn.GetExt(rl, i, wbuf, cap);
            r.extension = wbuf.slice(0, eLen * 2).toString("utf16le");
          }
          if (options.includeSnippet) {
            const hLen = this.fn.GetHighlightedW(rl, i, PROP.CONTENT, snipBuf, 8192);
            if (hLen > 0) r.snippet = snipBuf.slice(0, hLen * 2).toString("utf16le");
          }

          results.push(r);
        }

        return { totalResults: totalCount, returnedResults: results.length, results };
      } finally {
        this.fn.DestroyRL(rl);
      }
    } finally {
      this.fn.DestroyState(state);
    }
  }

  close(): void {
    if (this.client) {
      this.fn.DestroyClient(this.client);
      this.client = null;
    }
  }
}

let instance: EverythingSdkV3 | null = null;

export function getV3Sdk(): EverythingSdkV3 {
  if (!instance) instance = new EverythingSdkV3();
  return instance;
}
