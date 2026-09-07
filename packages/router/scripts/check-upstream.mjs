import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";

const EXPECTED_REFERENCE_HEAD = "f7bf97ccd3bc1b170c4dcf13245a5e5cf78963a1";
const FILES = [
  "chat-to-responses.js",
  "config.js",
  "history.js",
  "image-generation.js",
  "json.js",
  "model-catalog.js",
  "proxy.js",
  "rate-limit.js",
  "responses-to-chat.js",
  "server.js",
  "tools.js",
  "upstream.js",
];
const INTENTIONAL_SEMANTIC_CHANGES = new Set([
  "config.js",
  "json.js",
  "server.js",
  "upstream.js",
]);

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const referenceRoot = resolve(
  process.env.CODEXBRIDGE_REFERENCE_DIR ||
    resolve(packageRoot, "..", "..", "..", "bridge-reference"),
);

const referenceHead = execFileSync(
  "git",
  ["-C", referenceRoot, "rev-parse", "HEAD"],
  { encoding: "utf8" },
).trim();

let failed = false;
if (referenceHead !== EXPECTED_REFERENCE_HEAD) {
  failed = true;
  console.error(
    `Reference HEAD changed: expected ${EXPECTED_REFERENCE_HEAD}, found ${referenceHead}`,
  );
} else {
  console.log(`Reference HEAD: ${referenceHead}`);
}

for (const file of FILES) {
  const [upstreamSource, localSource] = await Promise.all([
    readFile(resolve(referenceRoot, "src", file), "utf8"),
    readFile(resolve(packageRoot, "src", file), "utf8"),
  ]);
  const [upstream, local] = await Promise.all([
    normalize(upstreamSource),
    normalize(localSource),
  ]);
  if (upstream === local) {
    console.log(`SAME       ${file}`);
    continue;
  }
  if (INTENTIONAL_SEMANTIC_CHANGES.has(file)) {
    console.log(`INTENTIONAL ${file}`);
    continue;
  }
  failed = true;
  console.error(`UNEXPECTED ${file}`);
}

if (failed) process.exitCode = 1;

async function normalize(source) {
  const withoutLicenseBanner = source.replace(/^\s*\/\*!.*?\*\/\s*/s, "");
  return await prettier.format(withoutLicenseBanner, { parser: "babel" });
}
