import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";

// Bundle TSX for React's test renderer; this does not launch a browser or WebGL.
export async function componentBundle(name, plugins = []) {
  const outfile = fileURLToPath(
    new URL(
      `../../node_modules/.cache/gugis-tests/${name}.mjs`,
      import.meta.url,
    ),
  );
  await build({
    entryPoints: [
      fileURLToPath(new URL(`../../src/studio/${name}.tsx`, import.meta.url)),
    ],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile,
    plugins,
  });
  return (await import(pathToFileURL(outfile).href)).default;
}
