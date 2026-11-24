const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { isBuiltin } = require("node:module");
const { workspace, toolsDirectory, ensureToolsDirectory } = require("./profile.cjs");

async function run() {
  const [mode, ...extra] = process.argv.slice(2);
  if (extra.length || !["seed", "open"].includes(mode)) throw new Error("Expected seed or open");
  const env = { ...process.env };
  delete env.ELECTRON_RENDERER_URL;
  if (mode === "seed") {
    ensureToolsDirectory();
    const { build } = await import("vite");
    await build({
      root: workspace,
      configFile: false,
      resolve: { alias: {
        "@core": path.join(workspace, "src/core"),
        "@shared": path.join(workspace, "src/shared"),
      } },
      build: {
        outDir: toolsDirectory,
        emptyOutDir: false,
        copyPublicDir: false,
        minify: false,
        lib: { entry: path.join(__dirname, "seed.ts"), formats: ["cjs"], fileName: () => "seed.cjs" },
        rollupOptions: { external: id => id === "better-sqlite3" || isBuiltin(id) },
      },
    });
    env.ELECTRON_RUN_AS_NODE = "1";
  } else {
    delete env.ELECTRON_RUN_AS_NODE;
  }
  const result = spawnSync(require("electron"), [path.join(__dirname, `${mode}-electron.cjs`)], {
    cwd: workspace, env, stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
