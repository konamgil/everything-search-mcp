# everything-search-mcp

An [MCP](https://modelcontextprotocol.io) server that exposes [voidtools Everything](https://www.voidtools.com/) — the instant Windows file search — to Claude Code and other MCP clients. Index-backed, sub-second results across the whole disk.

Supports **both** Everything generations side-by-side:

- **1.4** — name / path search (mature, window-message IPC)
- **1.5** — name / path **plus full-text content search with snippet highlighting** (named-pipe IPC)

When Everything 1.5 has its content index built, full-text search via this server is **significantly faster than running `ripgrep` over the same scope**, because lookups hit a pre-built index instead of re-reading files.

## Why it exists

Agents tend to assume Everything is "just a filename indexer" and skip it for code-grep tasks. That's true of 1.4 but not of 1.5 — and the AI SDK never made this discoverable. This server bridges that gap with one MCP tool that does both, auto-selecting the right backend.

## Install

### Option A — npx (no clone required)

```bash
claude mcp add everything-search --scope user -- npx -y @konamgil/everything-search-mcp
```

`npx` downloads the package and runs its `postinstall`, which fetches both SDK DLLs from voidtools and the `voidtools/everything_sdk3` GitHub release. Re-launch Claude Code so the new MCP is picked up.

You also need the **Everything app itself** installed:

```powershell
winget install voidtools.Everything
# For content search: also install Everything 1.5 alpha from https://www.voidtools.com/
```

### Option B — clone & build (for development)

```bash
git clone https://github.com/konamgil/everything-search-mcp.git
cd everything-search-mcp
npm install                # postinstall fetches both DLLs automatically
npm run build
```

The two SDK DLLs are git-ignored. If the auto-download is blocked by your network, run them manually:

```bash
npm run install-sdk        # → Everything64.dll      (1.4 SDK)
npm run install-sdk-v3     # → Everything3_x64.dll   (1.5 SDK 3.0.0.9)
```

Set `EVERYTHING_MCP_SKIP_POSTINSTALL=1` to disable the auto-downloader.

### Register a cloned build manually

```bash
claude mcp add everything-search --scope user \
  -e EVERYTHING_DLL_PATH=C:\path\to\everything-search-mcp\Everything64.dll \
  -e EVERYTHING3_DLL_PATH=C:\path\to\everything-search-mcp\Everything3_x64.dll \
  -- node C:\path\to\everything-search-mcp\dist\index.js
```

`EVERYTHING3_DLL_PATH` is optional — if absent, the server probes common install locations.

## Tools

### `everything_search`

Search Windows files. Same call site handles filename, path, and full-text content queries.

| Parameter | Default | Notes |
|---|---|---|
| `query` | (required) | Everything query syntax — see below |
| `max` | 100 | Cap on returned results |
| `offset` | 0 | Pagination |
| `matchCase`, `matchWholeWord`, `matchPath`, `regex` | false | Modifiers |
| `sort` | (none) | e.g. `DATE_MODIFIED_DESCENDING`, `SIZE_DESCENDING` |
| `includeSize`, `includeDates` | true | Cheap metadata |
| `includeExtension`, `includeAttributes` | false | Extra metadata |
| `includeSnippet` | false | Returns matched-content excerpt with `*highlight*` markers (1.5 only) |
| `backend` | `auto` | `auto` \| `v3-1.5` \| `v1-1.4` |

**Query syntax** (full reference: voidtools docs):

| Form | Meaning |
|---|---|
| `foo bar` | implicit AND |
| `foo \| bar` | OR |
| `!foo` | NOT |
| `"exact phrase"` | exact substring |
| `ext:ts` | filename extension |
| `path:packages\core` | filename path contains |
| `size:>1mb`, `dm:thisweek` | function operators |
| `content:keyword` | **full-text content match (1.5 only)** |
| `regex:content:export\s+function` | regex content match (set `regex: true`) |

**Example results**

```jsonc
{
  "backend": "v3-1.5",
  "version": "1.5.0.1409",
  "totalResults": 37,
  "returnedResults": 3,
  "results": [
    {
      "fullPath": "C:\\proj\\src\\runtime\\server.ts",
      "size": 206137,
      "dateModified": "2026-04-30T07:37:58.879Z",
      "snippet": "...class *ServerRegistry* {..."
    }
  ]
}
```

### `everything_status`

Reports which backends are reachable and whether the database is loaded. Use this to verify content search is available:

```jsonc
{
  "v3": { "available": true,  "version": "1.5.0.1409", "dbLoaded": true },
  "v1": { "available": false, "error": "..." }
}
```

If `v3.available` is `true` and `v3.dbLoaded` is `true`, `content:` queries work.

## Enabling 1.5 content indexing

Content indexing is **off by default** in Everything 1.5a. To turn it on, edit `%APPDATA%\Everything\Everything-1.5a.ini` while Everything is **not running**:

```ini
content_indexing_enabled=1
content_indexing_include_only_folders=C:\path\to\your\project
content_indexing_exclude_folders=C:\path\to\your\project\node_modules;C:\path\to\your\project\.git;C:\path\to\your\project\dist
content_indexing_include_only_files=*.ts;*.tsx;*.js;*.jsx;*.json;*.md;*.yml;*.toml;*.txt
```

Save, then launch `C:\Program Files\Everything 1.5a\Everything.exe`. The service worker will index in the background — `everything_status` will report `dbLoaded: true` once it finishes.

> Scope the include folders narrowly. Indexing the contents of the entire C: drive is heavy.

## Permissions — the named-pipe gotcha

Everything 1.5's IPC pipe (`\\.\pipe\Everything IPC (1.5a)`) is ACL'd to **High-IL processes only**. If your shell or Claude Code launched at the default Medium integrity, the MCP server will get `0xE0000002 IPC_PIPE_NOT_FOUND` even though the pipe is visible.

**Fix**: launch Claude Code (or whichever client hosts this MCP) with **"Run as administrator"** once. All child processes — including the MCP server — inherit High IL and the pipe accepts them.

The 1.4 backend is not affected; it uses window-message IPC which crosses IL boundaries normally.

## Architecture

```
src/
  index.ts                MCP server (stdio transport, McpServer + registerTool)
  everything-search.ts    Dispatcher: tries v3, falls back to v1, normalizes results
  everything-sdk.ts       1.4 SDK FFI (Everything64.dll, window-message IPC)
  everything-sdk-v3.ts    1.5 SDK 3 FFI (Everything3_x64.dll, named-pipe IPC)
  everything-process.ts   Detect Everything.exe; auto-spawn with `-startup` if IPC down
  smoke.ts                CLI: smoke test for 1.4
  v3-smoke.ts             CLI: smoke test for 1.5 (use elevated shell)
```

FFI binding uses [koffi](https://koffi.dev/). `__stdcall` calling convention for both DLLs.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `everything_status` reports `v3.available: false` with `0xE0000002` | MCP running at Medium IL; 1.5 pipe rejects | Restart Claude Code as administrator |
| `everything_status` reports `v3.available: true` but content queries return 0 | Content index not built or scope mismatch | Check INI `content_indexing_enabled=1` and folder scope |
| `Everything64.dll not found` | 1.4 SDK DLL missing | `npm run install-sdk` |
| `Everything3_x64.dll not found` | 1.5 SDK DLL missing | `npm run install-sdk-v3` |
| Both backends unreachable | Everything app itself not running | The MCP server auto-spawns the installed exe; install Everything if absent |

## License

MIT. Everything itself is © voidtools, distributed under its own license — this server only links its public C SDK via FFI.
