const fs = require("node:fs");
const path = require("node:path");

const workspace = fs.realpathSync.native(path.join(__dirname, "../.."));
const root = path.join(workspace, ".wms-dev");
const profile = path.join(root, "pre-phase-5");
const toolsDirectory = path.join(root, "pre-phase-5-tools");
const manifestName = "pre-phase-5-seed.json";

function stat(target) {
  return fs.lstatSync(target, { throwIfNoEntry: false });
}

function assertLocal(target, kind) {
  const info = stat(target);
  const valid = kind === "directory" ? info?.isDirectory() : info?.isFile() && info.nlink === 1;
  if (!valid || fs.realpathSync.native(target) !== target) {
    throw new Error(`Expected a local ${kind} at ${target}`);
  }
}

function readManifest() {
  assertLocal(root, "directory");
  assertLocal(profile, "directory");
  const marker = path.join(profile, manifestName);
  assertLocal(marker, "file");
  const manifest = JSON.parse(fs.readFileSync(marker, "utf8"));
  if (manifest.dataset !== "warehouse-wms-pre-phase-5") throw new Error("Unrecognized demo profile");
  return manifest;
}

function ensureLocalDirectory(directory) {
  try {
    fs.mkdirSync(directory);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  assertLocal(directory, "directory");
}

function ensureToolsDirectory() {
  ensureLocalDirectory(root);
  ensureLocalDirectory(toolsDirectory);
  const bundle = path.join(toolsDirectory, "seed.cjs");
  if (stat(bundle)) assertLocal(bundle, "file");
}

async function prepareProfile(seed) {
  ensureLocalDirectory(root);
  if (stat(profile)) return { ...readManifest(), existing: true };

  const staging = fs.mkdtempSync(path.join(root, "pre-phase-5-staging-"));
  try {
    const seedRows = await seed(staging);
    const manifest = { dataset: "warehouse-wms-pre-phase-5", seedRows };
    fs.writeFileSync(path.join(staging, manifestName), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
    // The target cannot be replaced after another seed publishes its nonempty profile.
    try {
      fs.renameSync(staging, profile);
    } catch (error) {
      if (!stat(profile)) throw error;
      return { ...readManifest(), existing: true };
    }
    return { ...manifest, existing: false };
  } finally {
    if (stat(staging)) {
      assertLocal(staging, "directory");
      fs.rmSync(staging, { recursive: true });
    }
  }
}

module.exports = { workspace, profile, toolsDirectory, assertLocal, readManifest, ensureToolsDirectory, prepareProfile };
