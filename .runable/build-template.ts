import { Glob } from "bun";
import { z } from "zod/v4";
import { releaseJournalSchema } from "./releases.schema";

// Single build step for the derived files the template ships:
//   .template-version              — the latest managed-release version
//   .runable/protected-files.json  — sha256 manifest of every __ source file
//
// Sources of truth: .runable/releases.json (hand-authored) and the __ files
// themselves. This is platform tooling, not an app script — the sandbox image
// build (runable/packages/sandbox) runs it against the cloned template; it is
// intentionally NOT wired into the app's package.json. Default writes both
// files; `--check` validates releases.json and fails if either committed
// output is stale, without writing.

const runableDir = new URL("./", import.meta.url);
const rootUrl = new URL("../", import.meta.url);
const rootPath = rootUrl.pathname;

const VERSION_OUTPUT = new URL(".template-version", rootUrl);
const MANIFEST_OUTPUT = new URL("protected-files.json", runableDir);

const SOURCE_EXT = /\.(ts|tsx|js|jsx|cjs|mjs)$/;
const IGNORED_SEGMENTS = new Set(["node_modules", "dist", ".expo", "__pycache__"]);
// __ files live under packages/ (template plumbing) and __lint-rules/ (the
// enforcement rules themselves). Scanned explicitly to skip node_modules etc.
const SCAN_GLOBS = ["packages/**/*", "__lint-rules/**/*"];

// Latest managed-release version, from the validated release journal. Releases
// are appended in order, so the last entry is newest (matches the platform's
// migration runner). Validation failures abort the build.
async function buildVersion(): Promise<string> {
  const journal = await Bun.file(new URL("releases.json", runableDir)).json();
  const result = releaseJournalSchema.safeParse(journal);
  if (!result.success) {
    console.error(z.prettifyError(result.error));
    process.exit(1);
  }
  const { releases } = result.data;
  return releases[releases.length - 1]!.version;
}

// sha256 manifest of every __ (double-underscore) source file.
async function buildManifest(): Promise<string> {
  const entries: [string, string][] = [];
  for (const glob of SCAN_GLOBS) {
    for await (const path of new Glob(glob).scan({ cwd: rootPath, onlyFiles: true })) {
      const segments = path.split("/");
      if (segments.some((s) => IGNORED_SEGMENTS.has(s))) continue;
      if (!SOURCE_EXT.test(path)) continue;
      if (!segments.some((s) => s.startsWith("__"))) continue;
      const content = await Bun.file(`${rootPath}${path}`).arrayBuffer();
      entries.push([path, new Bun.CryptoHasher("sha256").update(content).digest("hex")]);
    }
  }
  entries.sort(([a], [b]) => a.localeCompare(b));
  return `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`;
}

const outputs = [
  { output: VERSION_OUTPUT, label: ".template-version", content: await buildVersion() },
  { output: MANIFEST_OUTPUT, label: ".runable/protected-files.json", content: await buildManifest() },
];

if (process.argv.includes("--check")) {
  const stale: string[] = [];
  for (const { output, label, content } of outputs) {
    const current = await Bun.file(output)
      .text()
      .catch(() => null);
    if (current !== content) stale.push(label);
  }
  if (stale.length > 0) {
    console.error(
      `Stale generated file(s): ${stale.join(", ")}. Run \`bun run internal:build-template\`.`,
    );
    process.exit(1);
  }
  console.log("Generated template files are up to date");
} else {
  for (const { output, content } of outputs) await Bun.write(output, content);
  console.log(
    `Built .template-version (${outputs[0]!.content}) and .runable/protected-files.json`,
  );
}
