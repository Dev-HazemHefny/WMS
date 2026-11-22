const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = process.cwd();
const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(
  config.config,
  ts.sys,
  root,
).options;
const graph = new Map();
const relative = (p) => path.relative(root, p).replaceAll("\\", "/");
function visit(file) {
  if (graph.has(file)) return;
  const imports = [];
  graph.set(file, imports);
  const source = fs.readFileSync(path.join(root, file), "utf8");
  for (const statement of ts.preProcessFile(source).importedFiles) {
    const name = statement.fileName;
    const found = ts.resolveModuleName(
      name,
      path.join(root, file),
      options,
      ts.sys,
    ).resolvedModule;
    if (
      file.startsWith("src/renderer/") &&
      (name === "electron" ||
        name.startsWith("node:") ||
        name === "better-sqlite3")
    )
      throw Error(file + " imports " + name);
    if (!found || found.isExternalLibraryImport) continue;
    const target = relative(found.resolvedFileName);
    if (
      file.startsWith("src/renderer/") &&
      /^(electron|src\/core)\//.test(target)
    )
      throw Error(file + " imports " + target);
    if (file.startsWith("src/core/") && target.startsWith("electron/"))
      throw Error(file + " imports " + target);
    const owner = file.match(/^src\/core\/([^/]+)/)?.[1],
      dependency = target.match(/^src\/core\/([^/]+)/)?.[1];
    if (
      owner &&
      dependency &&
      owner !== dependency &&
      dependency !== "shared" &&
      !target.endsWith("/public.ts")
    )
      throw Error(file + " imports private " + target);
    imports.push(target);
    visit(target);
  }
}
for (const base of ["src", "electron"])
  for (const file of ts.sys.readDirectory(base, [".ts", ".tsx"]))
    if (!file.endsWith(".test.ts")) visit(relative(path.resolve(file)));
const complete = new Set();
function cycles(file, stack) {
  if (stack.includes(file)) throw Error(stack.concat(file).join(" -> "));
  if (complete.has(file)) return;
  for (const next of graph.get(file) || []) cycles(next, stack.concat(file));
  complete.add(file);
}
for (const file of graph.keys()) cycles(file, []);
console.log("Architecture import check passed for " + graph.size + " modules.");
