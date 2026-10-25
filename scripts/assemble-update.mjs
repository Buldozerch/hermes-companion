import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function assembleUpdate(directory = "releases") {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  const platforms = {};
  for (const platform of ["linux-x86_64", "windows-x86_64", "macos-aarch64", "macos-x86_64"]) {
    const manifest = JSON.parse(
      readFileSync(resolve(directory, `update-${platform}.json`), "utf8"),
    );
    if (manifest.version !== version) throw new Error("Update artifacts have mismatched versions.");
    Object.assign(platforms, manifest.platforms);
  }
  const required = [
    "linux-x86_64-deb",
    "linux-x86_64-appimage",
    "windows-x86_64-nsis",
    "darwin-aarch64-app",
    "darwin-x86_64-app",
  ];
  for (const target of required) {
    const entry = platforms[target];
    const prefix = `https://github.com/Buldozerch/hermes-companion/releases/download/v${version}/`;
    if (!entry?.signature || !entry.url?.startsWith(prefix))
      throw new Error(`Missing or invalid signed update: ${target}`);
    const file = entry.url.slice(prefix.length);
    if (
      !file ||
      file.includes("/") ||
      file.includes("..") ||
      !readFileSync(resolve(directory, file)).length
    )
      throw new Error("Missing update artifact.");
  }
  const manifest = {
    version,
    notes: readFileSync("docs/release-notes.md", "utf8"),
    pub_date: new Date().toISOString(),
    platforms,
  };
  writeFileSync(resolve(directory, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assembleUpdate(process.argv[2]);
  console.log("Signed update manifest assembled for all desktop packages.");
}
