#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SORT } from "./everything-sdk.js";
import {
  unifiedSearch,
  getStatus,
  getFileInfo,
  validateQuery,
  validatePath,
  ValidationError,
  Limits,
  type Backend,
} from "./everything-search.js";

const SortKeys = Object.keys(SORT) as (keyof typeof SORT)[];

const server = new McpServer({
  name: "everything-search-mcp",
  version: "0.3.0",
});

function ok(payload: object) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ success: true, ...payload }, null, 2) }],
  };
}

function fail(err: unknown, tool: string) {
  const isVal = err instanceof ValidationError;
  const errorCode = isVal ? err.errorCode : err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "INTERNAL_ERROR";
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ success: false, tool, error: message, errorCode }, null, 2),
      },
    ],
    isError: true,
  };
}

server.registerTool(
  "everything_search",
  {
    title: "Everything Search (filename + full-text content)",
    description:
      "Search files on Windows via voidtools Everything (instant, index-backed). Supports BOTH:\n" +
      "  1. Filename / path search (works on Everything 1.4 and 1.5)\n" +
      "  2. Full-text CONTENT search across indexed files — use `content:keyword` in the query (requires Everything 1.5 with content indexing enabled, which is set up here)\n" +
      "When content is indexed, this is significantly faster than ripgrep/grep over the same scope because lookups hit a pre-built index. Set `includeSnippet: true` to also get the matched snippet with `*highlight*` markers, just like a code-aware grep result.\n\n" +
      "Examples:\n" +
      "  • find files named foo.ts:                      query='foo.ts'\n" +
      "  • find code containing the word ServerRegistry: query='content:ServerRegistry path:mandu'\n" +
      "  • full-text regex over indexed files:           query='regex:content:export\\\\s+function' (with regex=true)\n" +
      "  • exact phrase + filename filter:               query='content:\"export function startServer\" ext:ts'\n\n" +
      "Backend auto-selects 1.5 first, falls back to 1.4. Override with `backend`.",
    inputSchema: {
      query: z
        .string()
        .min(1, "Query cannot be empty")
        .max(Limits.MAX_QUERY_LENGTH)
        .describe(
          "Everything query. PREFIX WITH `content:` for full-text search inside indexed files (Everything 1.5). " +
            'Operators: AB | CD (or), !x (not), <a b> (group), "exact phrase", and function operators ' +
            "ext:, size:, dm:, path:, parent:, content:, count:. Set regex=true to interpret the whole query as a regex.",
        ),
      max: z.number().int().min(1).max(Limits.MAX_RESULTS).default(100),
      offset: z.number().int().min(0).max(Limits.MAX_OFFSET).default(0),
      matchCase: z.boolean().default(false),
      matchWholeWord: z.boolean().default(false),
      matchPath: z.boolean().default(false),
      regex: z.boolean().default(false),
      sort: z.enum(SortKeys as [string, ...string[]]).optional(),
      includeSize: z.boolean().default(true),
      includeDates: z.boolean().default(true),
      includeExtension: z.boolean().default(false),
      includeAttributes: z.boolean().default(false),
      includeSnippet: z
        .boolean()
        .default(false)
        .describe(
          "When using content:keyword, include the matched text snippet with `*highlight*` markers (like grep -C). Requires Everything 1.5 with content indexing enabled.",
        ),
      backend: z.enum(["auto", "v3-1.5", "v1-1.4"]).default("auto"),
    },
  },
  async (args) => {
    try {
      validateQuery(args.query);
      const r = await unifiedSearch({
        query: args.query,
        matchCase: args.matchCase,
        matchWholeWord: args.matchWholeWord,
        matchPath: args.matchPath,
        regex: args.regex,
        max: args.max,
        offset: args.offset,
        sort: args.sort as never,
        includeSize: args.includeSize,
        includeDates: args.includeDates,
        includeExtension: args.includeExtension,
        includeAttributes: args.includeAttributes,
        includeSnippet: args.includeSnippet,
        backend: args.backend as Backend | "auto",
      });
      return ok(r);
    } catch (err) {
      return fail(err, "everything_search");
    }
  },
);

server.registerTool(
  "everything_get_file_info",
  {
    title: "Everything Get File Info",
    description:
      "Fetch indexed metadata (size, dateModified/Created/Accessed, extension, attributes) for a specific file or folder by full path. Faster than `fs.stat` for repeated lookups because results come from Everything's pre-built index. Returns `FILE_NOT_FOUND` if the path is not in the index — re-run an index refresh or call `everything_search` first to confirm.",
    inputSchema: {
      path: z
        .string()
        .min(1, "Path cannot be empty")
        .max(Limits.MAX_PATH_LENGTH)
        .describe("Absolute Windows path to look up, e.g. C:\\projects\\foo\\bar.ts"),
    },
  },
  async (args) => {
    try {
      validatePath(args.path);
      const info = await getFileInfo(args.path);
      return ok({ info });
    } catch (err) {
      return fail(err, "everything_get_file_info");
    }
  },
);

server.registerTool(
  "everything_status",
  {
    title: "Everything Status",
    description:
      "Report which Everything backends are reachable. If v3 (1.5) is available and dbLoaded, full-text `content:` search via everything_search is supported. If only v1 (1.4) is available, only filename/path search works.",
    inputSchema: {},
  },
  async () => {
    try {
      const status = await getStatus();
      return ok({ status });
    } catch (err) {
      return fail(err, "everything_status");
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("everything-search-mcp@0.3.0 ready (stdio) — supports 1.5 v3 + 1.4 v1\n");
}

main().catch((e) => {
  process.stderr.write(`Fatal: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
});
