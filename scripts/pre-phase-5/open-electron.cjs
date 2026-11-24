const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { workspace, profile, assertLocal, readManifest } = require("./profile.cjs");

readManifest();
const database = path.join(profile, "warehouse.sqlite");
assertLocal(database, "file");
for (const suffix of ["-shm", "-wal", "-journal"]) {
  const sidecar = database + suffix;
  if (fs.lstatSync(sidecar, { throwIfNoEntry: false })) assertLocal(sidecar, "file");
}
app.setPath("userData", profile);
require(path.join(workspace, "out/main/index.js"));
