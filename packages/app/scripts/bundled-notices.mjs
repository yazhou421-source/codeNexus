import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Keep dependency license texts when excluding redundant node_modules from the installer. */
export function writeBundledNotices() {
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const seen = new Set();
  const notices = [];
  function visit(root) {
    root = realpathSync(root);
    if (seen.has(root)) return;
    seen.add(root);
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const texts = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^(licen[sc]e|notice|copying|copyright)(\.|$)/i.test(entry.name))
      .map((entry) => readFileSync(join(root, entry.name), "utf8"));
    notices.push(`${pkg.name} ${pkg.version} (${pkg.license ?? "see package license"})\n${texts.join("\n\n")}`);
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      let parent = root;
      let found = false;
      while (parent) {
        const candidate = join(parent, "node_modules", name);
        if (existsSync(join(candidate, "package.json"))) {
          visit(candidate);
          found = true;
          break;
        }
        if (parent === parse(parent).root) break;
        parent = dirname(parent);
      }
      if (!found && !pkg.optionalDependencies?.[name]) throw new Error(`Cannot resolve license metadata for ${name}`);
    }
  }
  visit(appRoot);
  notices.sort();
  writeFileSync(
    join(appRoot, "dist", "THIRD-PARTY-LICENSES.txt"),
    "Bundled production dependency notices (including transitive dependencies).\n\n" +
      notices.join("\n\n----------------------------------------\n\n")
  );
}
