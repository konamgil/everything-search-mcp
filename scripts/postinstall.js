#!/usr/bin/env node
/**
 * Postinstall: on Windows, auto-download the two voidtools SDK DLLs that the
 * MCP server FFI-loads at runtime:
 *   - Everything64.dll        (1.4 SDK, window-message IPC)
 *   - Everything3_x64.dll     (1.5 SDK 3.0.0.9, named-pipe IPC + content search)
 *
 * Skipped on non-Windows platforms. Failures here do NOT fail `npm install` —
 * the user can re-run `npm run install-sdk && npm run install-sdk-v3` later.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const log = (msg) => console.log(`[everything-search-mcp] ${msg}`);
const warn = (msg) => console.warn(`[everything-search-mcp] ${msg}`);

if (process.platform !== "win32") {
  log(`platform=${process.platform} — Everything is Windows-only; skipping SDK download.`);
  process.exit(0);
}

if (process.env.EVERYTHING_MCP_SKIP_POSTINSTALL === "1") {
  log("EVERYTHING_MCP_SKIP_POSTINSTALL=1 set — skipping SDK download.");
  process.exit(0);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(scriptDir);
const v1 = path.join(projectRoot, "Everything64.dll");
const v3 = path.join(projectRoot, "Everything3_x64.dll");

function runPs(scriptPath) {
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
    { stdio: "inherit" },
  );
}

try {
  if (!existsSync(v1)) {
    log("fetching Everything 1.4 SDK (Everything64.dll)...");
    runPs(path.join(scriptDir, "install-sdk.ps1"));
  } else {
    log("Everything64.dll already present — skipping 1.4 SDK download.");
  }

  if (!existsSync(v3)) {
    log("fetching Everything 1.5 SDK 3 (Everything3_x64.dll)...");
    runPs(path.join(scriptDir, "install-sdk-v3.ps1"));
  } else {
    log("Everything3_x64.dll already present — skipping 1.5 SDK download.");
  }

  log("SDK setup complete.");
} catch (err) {
  warn(`SDK auto-download failed: ${err.message}`);
  warn("Re-run manually later:");
  warn("  npm run install-sdk        # 1.4 SDK");
  warn("  npm run install-sdk-v3     # 1.5 SDK 3");
  warn("Or set EVERYTHING_DLL_PATH / EVERYTHING3_DLL_PATH to existing DLLs.");
  // Do NOT fail the install — the user can recover.
}
