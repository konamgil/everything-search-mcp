import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const COMMON_EXE_PATHS = [
  "C:\\Program Files\\Everything\\Everything.exe",
  "C:\\Program Files\\Everything 1.5a\\Everything.exe",
  "C:\\Program Files (x86)\\Everything\\Everything.exe",
];

export const INSTALL_HINT =
  "Everything is not running. Install it with `winget install voidtools.Everything` (or download from https://www.voidtools.com/), then launch it once. The MCP server will keep it running automatically afterwards.";

function findEverythingExe(): string | null {
  if (process.env.EVERYTHING_EXE_PATH && existsSync(process.env.EVERYTHING_EXE_PATH)) {
    return process.env.EVERYTHING_EXE_PATH;
  }
  for (const p of COMMON_EXE_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

export interface ProbeFns {
  GetMajorVersion: () => number;
  GetLastError: () => number;
  IsDBLoaded: () => number;
}

function isIpcAlive(fns: ProbeFns): boolean {
  const v = fns.GetMajorVersion();
  if (v === 0) {
    const err = fns.GetLastError();
    if (err === 2) return false;
  }
  return v > 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface EnsureOptions {
  autoStart?: boolean;
  startupTimeoutMs?: number;
  dbLoadTimeoutMs?: number;
}

export async function ensureEverythingRunning(
  fns: ProbeFns,
  options: EnsureOptions = {},
): Promise<void> {
  const autoStart = options.autoStart ?? true;
  const startupTimeoutMs = options.startupTimeoutMs ?? 8000;
  const dbLoadTimeoutMs = options.dbLoadTimeoutMs ?? 30000;

  if (isIpcAlive(fns)) {
    await waitForDbLoaded(fns, dbLoadTimeoutMs);
    return;
  }

  if (!autoStart) {
    throw new Error(INSTALL_HINT);
  }

  const exe = findEverythingExe();
  if (!exe) {
    throw new Error(INSTALL_HINT);
  }

  spawn(exe, ["-startup"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();

  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    await sleep(200);
    if (isIpcAlive(fns)) {
      await waitForDbLoaded(fns, dbLoadTimeoutMs);
      return;
    }
  }

  throw new Error(
    `Everything was launched (${exe}) but its IPC did not respond within ${startupTimeoutMs}ms. ${INSTALL_HINT}`,
  );
}

async function waitForDbLoaded(fns: ProbeFns, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fns.IsDBLoaded() !== 0) return;
    await sleep(250);
  }
  throw new Error(
    `Everything IPC reachable but the database did not finish loading within ${timeoutMs}ms. The index may be rebuilding — try again shortly.`,
  );
}
