import koffi from "koffi";
import { existsSync } from "node:fs";
import path from "node:path";

const dllCandidates = [
  process.env.EVERYTHING3_DLL_PATH,
  path.join(process.cwd(), "Everything3_x64.dll"),
  "C:\\Program Files\\Everything 1.5a\\Everything3_x64.dll",
].filter((p): p is string => !!p);

const dllPath = dllCandidates.find((p) => existsSync(p));
if (!dllPath) {
  console.error("Everything3_x64.dll not found. Tried:", dllCandidates);
  process.exit(2);
}

const lib = koffi.load(dllPath);

const Connect = lib.func("__stdcall", "Everything3_ConnectW", "void *", ["str16"]) as (s: string | null) => unknown;
const DestroyClient = lib.func("__stdcall", "Everything3_DestroyClient", "int", ["void *"]) as (c: unknown) => number;
const GetMajor = lib.func("__stdcall", "Everything3_GetMajorVersion", "uint32", ["void *"]) as (c: unknown) => number;
const GetMinor = lib.func("__stdcall", "Everything3_GetMinorVersion", "uint32", ["void *"]) as (c: unknown) => number;
const GetRev = lib.func("__stdcall", "Everything3_GetRevision", "uint32", ["void *"]) as (c: unknown) => number;
const GetBuild = lib.func("__stdcall", "Everything3_GetBuildNumber", "uint32", ["void *"]) as (c: unknown) => number;
const CreateState = lib.func("__stdcall", "Everything3_CreateSearchState", "void *", []) as () => unknown;
const DestroyState = lib.func("__stdcall", "Everything3_DestroySearchState", "int", ["void *"]) as (s: unknown) => number;
const SetSearchText = lib.func("__stdcall", "Everything3_SetSearchTextW", "int", ["void *", "str16"]) as (
  s: unknown,
  q: string,
) => number;
const SetViewportCount = lib.func("__stdcall", "Everything3_SetSearchViewportCount", "int", ["void *", "size_t"]) as (
  s: unknown,
  n: number,
) => number;
const Search = lib.func("__stdcall", "Everything3_Search", "void *", ["void *", "void *"]) as (
  c: unknown,
  s: unknown,
) => unknown;
const DestroyRL = lib.func("__stdcall", "Everything3_DestroyResultList", "int", ["void *"]) as (r: unknown) => number;
const RLCount = lib.func("__stdcall", "Everything3_GetResultListCount", "size_t", ["void *"]) as (r: unknown) => number;
const GetFullPath = lib.func(
  "__stdcall",
  "Everything3_GetResultFullPathNameW",
  "size_t",
  ["void *", "size_t", "uint16_t *", "size_t"],
) as (r: unknown, i: number, buf: Buffer, wcap: number) => number;
const GetSize = lib.func("__stdcall", "Everything3_GetResultSize", "uint64", ["void *", "size_t"]) as (
  r: unknown,
  i: number,
) => bigint;

console.log(`Loading DLL: ${dllPath}`);

const kernel32 = koffi.load("kernel32.dll");
const GetLastError = kernel32.func("__stdcall", "GetLastError", "uint32", []) as () => number;

const candidates: (string | null)[] = process.argv[2]
  ? [process.argv[2]]
  : ["1.5a", "(1.5a)", "", null];

let client: unknown = null;
let usedInstance: string | null = null;
for (const inst of candidates) {
  const label = inst === null ? "<null>" : `"${inst}"`;
  const c = Connect(inst);
  const err = GetLastError();
  console.log(`Connect(${label}) → ${c ? "OK" : "null"}  GetLastError=${err}`);
  if (c) {
    client = c;
    usedInstance = inst;
    break;
  }
}

if (!client) {
  console.error("All Connect attempts failed.");
  process.exit(3);
}
console.log(`Using instance: ${usedInstance === null ? "<null>" : `"${usedInstance}"`}`);

console.log(
  `Connected. Version ${GetMajor(client)}.${GetMinor(client)}.${GetRev(client)}.${GetBuild(client)}`,
);

const state = CreateState();
const query = process.argv[3] ?? "content:ServerRegistry path:mandu";
SetSearchText(state, query);
SetViewportCount(state, 5);

console.log(`Query: "${query}"`);
const t0 = Date.now();
const rl = Search(client, state);
const elapsed = Date.now() - t0;

if (!rl) {
  console.error("Search returned null.");
  DestroyState(state);
  DestroyClient(client);
  process.exit(4);
}

const count = RLCount(rl);
console.log(`Result count: ${count} (in ${elapsed}ms)`);

const cap = 2048;
const buf = Buffer.alloc(cap * 2);
for (let i = 0; i < Math.min(count, 5); i++) {
  const wlen = GetFullPath(rl, i, buf, cap);
  const text = buf.slice(0, wlen * 2).toString("utf16le");
  const sz = GetSize(rl, i);
  console.log(`  [${i}] size=${sz}  ${text}`);
}

DestroyRL(rl);
DestroyState(state);
DestroyClient(client);
