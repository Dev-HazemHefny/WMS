const { spawnSync } = require("node:child_process");

const electronPath = require("electron");
const jestPath = require.resolve("jest/bin/jest");
const result = spawnSync(electronPath, [jestPath, ...process.argv.slice(2)], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  stdio: "inherit"
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
