import { build } from "esbuild";

await build({
  entryPoints: [new URL("./src/index.ts", import.meta.url).pathname],
  outfile: new URL("./dist/index.mjs", import.meta.url).pathname,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  sourcemap: true,
  banner: { js: "#!/usr/bin/env node" },
});
