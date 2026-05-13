import { getReadySdk } from "./everything-sdk.js";

const sdk = await getReadySdk();

const v = sdk.getVersion();
console.log(
  `Everything ${v.major}.${v.minor}.${v.revision}.${v.build}  dbLoaded=${v.dbLoaded}`,
);

const query = process.argv[2] ?? "package.json";
const res = sdk.search({
  query,
  max: 5,
  sort: "DATE_MODIFIED_DESCENDING",
  requestSize: true,
  requestDates: true,
  requestExtension: true,
});

console.log(`\nquery: "${query}"  total=${res.totalResults}  returned=${res.returnedResults}\n`);
for (const r of res.results) {
  const kind = r.isVolume ? "[V]" : r.isFolder ? "[D]" : "[F]";
  console.log(
    `${kind} ${r.fullPath}  size=${r.size ?? "-"}  modified=${r.dateModified?.toISOString() ?? "-"}`,
  );
}
