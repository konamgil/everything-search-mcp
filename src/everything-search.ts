import { getReadySdk as getV1Sdk } from "./everything-sdk.js";
import { getV3Sdk, type V3SearchOptions, type V3SearchResponse } from "./everything-sdk-v3.js";

export class ValidationError extends Error {
  readonly errorCode: string;
  constructor(message: string, errorCode: string) {
    super(message);
    this.name = "ValidationError";
    this.errorCode = errorCode;
  }
}

export const Limits = {
  MAX_QUERY_LENGTH: 4000,
  MAX_PATH_LENGTH: 4096,
  MAX_RESULTS: 10000,
  MAX_OFFSET: 100000,
} as const;

export function validateQuery(query: unknown): asserts query is string {
  if (typeof query !== "string") throw new ValidationError("Query must be a string", "INVALID_TYPE");
  if (query.trim().length === 0) throw new ValidationError("Query cannot be empty", "EMPTY_QUERY");
  if (query.length > Limits.MAX_QUERY_LENGTH) {
    throw new ValidationError(
      `Query exceeds maximum length of ${Limits.MAX_QUERY_LENGTH} characters`,
      "QUERY_TOO_LONG",
    );
  }
}

export function validatePath(p: unknown): asserts p is string {
  if (typeof p !== "string") throw new ValidationError("Path must be a string", "INVALID_TYPE");
  if (p.trim().length === 0) throw new ValidationError("Path cannot be empty", "EMPTY_PATH");
  if (p.length > Limits.MAX_PATH_LENGTH) {
    throw new ValidationError(
      `Path exceeds maximum length of ${Limits.MAX_PATH_LENGTH} characters`,
      "PATH_TOO_LONG",
    );
  }
}

export type Backend = "v3-1.5" | "v1-1.4";

export interface UnifiedSearchOptions {
  query: string;
  matchCase?: boolean;
  matchWholeWord?: boolean;
  matchPath?: boolean;
  regex?: boolean;
  max?: number;
  offset?: number;
  sort?: V3SearchOptions["sort"];
  includeSize?: boolean;
  includeDates?: boolean;
  includeExtension?: boolean;
  includeAttributes?: boolean;
  includeSnippet?: boolean;
  /** Force the backend to use. Default: auto (v3 first, fall back to v1 unless snippet requested). */
  backend?: Backend | "auto";
}

export interface UnifiedSearchResult {
  fullPath: string;
  fileName: string;
  parentPath: string;
  type: "file" | "folder" | "volume";
  size?: number;
  dateModified?: string | null;
  dateCreated?: string | null;
  dateAccessed?: string | null;
  extension?: string;
  attributes?: number;
  snippet?: string;
}

export interface UnifiedSearchResponse {
  backend: Backend;
  version: string;
  totalResults: number;
  returnedResults: number;
  results: UnifiedSearchResult[];
}

function v3ToUnified(resp: V3SearchResponse, version: string): UnifiedSearchResponse {
  return {
    backend: "v3-1.5",
    version,
    totalResults: resp.totalResults,
    returnedResults: resp.returnedResults,
    results: resp.results.map((r) => ({
      fullPath: r.fullPath,
      fileName: r.fileName,
      parentPath: r.parentPath,
      type: "file",
      size: r.size,
      dateModified: r.dateModified?.toISOString() ?? null,
      dateCreated: r.dateCreated?.toISOString() ?? null,
      dateAccessed: r.dateAccessed?.toISOString() ?? null,
      extension: r.extension,
      snippet: r.snippet,
    })),
  };
}

export async function unifiedSearch(options: UnifiedSearchOptions): Promise<UnifiedSearchResponse> {
  const backend = options.backend ?? "auto";

  const tryV3 = (): UnifiedSearchResponse => {
    const sdk = getV3Sdk();
    const v = sdk.getVersion();
    const resp = sdk.search({
      query: options.query,
      matchCase: options.matchCase,
      matchWholeWord: options.matchWholeWord,
      matchPath: options.matchPath,
      regex: options.regex,
      max: options.max,
      offset: options.offset,
      sort: options.sort,
      includeSize: options.includeSize,
      includeDates: options.includeDates,
      includeExtension: options.includeExtension,
      includeSnippet: options.includeSnippet,
    });
    return v3ToUnified(resp, `${v.major}.${v.minor}.${v.revision}.${v.build}`);
  };

  const tryV1 = async (): Promise<UnifiedSearchResponse> => {
    if (options.includeSnippet) {
      throw new Error("Snippet output requires Everything 1.5 (v3 SDK). Run Claude Code elevated so the MCP server can reach the 1.5a named pipe.");
    }
    const sdk = await getV1Sdk();
    const v = sdk.getVersion();
    const resp = sdk.search({
      query: options.query,
      matchCase: options.matchCase,
      matchWholeWord: options.matchWholeWord,
      matchPath: options.matchPath,
      regex: options.regex,
      max: options.max,
      offset: options.offset,
      sort: options.sort as never,
      requestSize: options.includeSize,
      requestDates: options.includeDates,
      requestExtension: options.includeExtension,
      requestAttributes: options.includeAttributes,
    });
    return {
      backend: "v1-1.4",
      version: `${v.major}.${v.minor}.${v.revision}.${v.build}`,
      totalResults: resp.totalResults,
      returnedResults: resp.returnedResults,
      results: resp.results.map((r) => ({
        fullPath: r.fullPath,
        fileName: r.fileName,
        parentPath: r.parentPath,
        type: r.isVolume ? "volume" : r.isFolder ? "folder" : "file",
        size: r.size,
        dateModified: r.dateModified?.toISOString() ?? null,
        dateCreated: r.dateCreated?.toISOString() ?? null,
        dateAccessed: r.dateAccessed?.toISOString() ?? null,
        extension: r.extension,
        attributes: r.attributes,
      })),
    };
  };

  if (backend === "v3-1.5") return tryV3();
  if (backend === "v1-1.4") return tryV1();

  try {
    return tryV3();
  } catch (err) {
    if (options.includeSnippet) throw err;
    try {
      return await tryV1();
    } catch (fallbackErr) {
      const m1 = err instanceof Error ? err.message : String(err);
      const m2 = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      throw new Error(`Both backends failed.\n  v3 (1.5): ${m1}\n  v1 (1.4): ${m2}`);
    }
  }
}

export async function getFileInfo(fullPath: string): Promise<UnifiedSearchResult> {
  validatePath(fullPath);
  const resp = await unifiedSearch({
    query: `"${fullPath}"`,
    matchPath: true,
    max: 10,
    includeSize: true,
    includeDates: true,
    includeExtension: true,
    includeAttributes: true,
  });
  const target = fullPath.toLowerCase();
  const match = resp.results.find((r) => r.fullPath.toLowerCase() === target);
  if (!match) {
    throw new ValidationError(
      `File not found in Everything index: ${fullPath}`,
      "FILE_NOT_FOUND",
    );
  }
  return match;
}

export async function getStatus(): Promise<{
  v3: { available: boolean; version?: string; dbLoaded?: boolean; error?: string };
  v1: { available: boolean; version?: string; dbLoaded?: boolean; error?: string };
}> {
  const result: Awaited<ReturnType<typeof getStatus>> = {
    v3: { available: false },
    v1: { available: false },
  };

  try {
    const v3 = getV3Sdk().getVersion();
    result.v3 = {
      available: true,
      version: `${v3.major}.${v3.minor}.${v3.revision}.${v3.build}`,
      dbLoaded: v3.dbLoaded,
    };
  } catch (err) {
    result.v3.error = err instanceof Error ? err.message : String(err);
  }

  try {
    const v1 = (await getV1Sdk()).getVersion();
    result.v1 = {
      available: true,
      version: `${v1.major}.${v1.minor}.${v1.revision}.${v1.build}`,
      dbLoaded: v1.dbLoaded,
    };
  } catch (err) {
    result.v1.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}
