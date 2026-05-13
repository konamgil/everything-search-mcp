import { ensureEverythingRunning, type ProbeFns } from "./everything-process.js";
import { getSdk } from "./everything-sdk.js";

const realSdk = getSdk();
const versionBefore = realSdk.getVersion();
console.log(`Before: version=${versionBefore.major}.${versionBefore.minor}.${versionBefore.revision}.${versionBefore.build}  dbLoaded=${versionBefore.dbLoaded}`);

let pretendDead = true;
const probedReal = { attempts: 0 };

setTimeout(() => {
  pretendDead = false;
  console.log("(mock) IPC marked alive");
}, 1500);

const fakeFns: ProbeFns = {
  GetMajorVersion: () => {
    probedReal.attempts++;
    if (pretendDead) return 0;
    return realSdk.getVersion().major;
  },
  GetLastError: () => (pretendDead ? 2 : 0),
  IsDBLoaded: () => (realSdk.getVersion().dbLoaded ? 1 : 0),
};

console.log("Simulating IPC-dead, expecting spawn + recovery...");
const t0 = Date.now();

await ensureEverythingRunning(fakeFns, { startupTimeoutMs: 10000, dbLoadTimeoutMs: 15000 }).then(() => {
  console.log(`ensureEverythingRunning resolved in ${Date.now() - t0}ms after ${probedReal.attempts} probes`);
}).catch((err) => {
  console.error(`ensureEverythingRunning FAILED in ${Date.now() - t0}ms: ${err.message}`);
  process.exit(1);
});

console.log("Switching probe to real and verifying live SDK still works...");
pretendDead = false;

const search = realSdk.search({ query: "package.json", max: 1, requestSize: true });
console.log(`Real query: total=${search.totalResults} returned=${search.returnedResults}`);
console.log(`Sample: ${search.results[0]?.fullPath}`);
