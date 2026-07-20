import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const sourceExtensions = new Set([".rs", ".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const ignoredDirectories = new Set([".git", "node_modules", "dist", "target"]);
const violations = [];

await visit(root);

if (violations.length) {
  process.stderr.write(`${violations.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Repository source checks passed.\n");
}

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(path);
      continue;
    }
    const name = relative(root, path);
    if (entry.name.endsWith(".go") || entry.name.toLowerCase().includes("gofmt")) {
      violations.push(`${name}: Go/gofmt artifacts are not allowed`);
    }
    if (!sourceExtensions.has(extname(entry.name))) continue;
    const lineCount = (await readFile(path, "utf8")).split(/\r?\n/).length;
    if (lineCount >= 1_000) violations.push(`${name}: ${lineCount} lines (maximum 999)`);
  }
}
