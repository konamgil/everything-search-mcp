#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SORT } from "./everything-sdk.js";
import { unifiedSearch, getStatus, type Backend } from "./everything-search.js";

const SortKeys = Object.keys(SORT) as (keyof typeof SORT)[];

const server = new McpServer({
  name: "everything-search-mcp",
  version: "0.2.0",
});

server.registerTool(
  "everything_search",
  {
    title: "Everything Search",
    description:
      "Search files on Windows via voidtools Everything. Auto-uses Everything 1.5 (content/snippet supported) when reachable, falls back to 1.4 otherwise. Set backend='v3-1.5' or 'v1-1.4' to pin. Use content:keyword in the query for full-text search (1.5 only).",
    inputSchema: {
      query: z.string().describe(
        'Everything query. Operators: AB | CD (or), !x (not), <a b> (group), "exact phrase", and function operators ext:, size:, dm:, path:, parent:, content: (1.5 only), count:. Set regex=true to interpret the whole query as a regex.',
      ),
      max: z.number().int().min(1).max(10000).default(100),
      offset: z.number().int().min(0).default(0),
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
          "Include matched content snippet with highlight markers. Requires Everything 1.5 (v3 SDK).",
        ),
      backend: z.enum(["auto", "v3-1.5", "v1-1.4"]).default("auto"),
    },
  },
  async (args) => {
    const response = await unifiedSearch({
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
    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  },
);

server.registerTool(
  "everything_status",
  {
    title: "Everything Status",
    description:
      "Report which Everything backends (1.5 v3 + 1.4 v1) are reachable from this process, with version and DB-loaded state for each.",
    inputSchema: {},
  },
  async () => {
    const status = await getStatus();
    return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("everything-search-mcp ready (stdio) — supports 1.5 v3 + 1.4 v1\n");
}

main().catch((e) => {
  process.stderr.write(`Fatal: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
});
