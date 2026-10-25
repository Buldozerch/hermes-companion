import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { projectRoot } from "./check-release.mjs";

const platforms = {
  "linux-x86_64": { target: "x86_64-unknown-linux-gnu", extensions: [".deb", ".AppImage"] },
  "windows-x86_64": { target: "x86_64-pc-windows-msvc", extensions: [".exe"] },
  "macos-aarch64": { target: "aarch64-apple-darwin", extensions: [".dmg"] },
  "macos-x86_64": { target: "x86_64-apple-darwin", extensions: [".dmg"] },
};

function walk(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? walk(child) : entry.isFile() ? [child] : [];
  });
}

export function collectRelease(platform, artifacts) {
  platform ??= `${process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : process.platform}-${process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch}`;
  const settings = platforms[platform];
  if (!settings) throw new Error("Select a supported desktop release platform.");
  if (!artifacts) {
    const target = resolve(projectRoot, "target");
    const native = join(target, "release", "bundle");
    const explicit = join(target, settings.target, "release", "bundle");
    artifacts = walk(process.env.RELEASE_TARGET ? explicit : native);
  }
  if (!Array.isArray(artifacts) || !artifacts.every((path) => typeof path === "string"))
    throw new Error("The build did not return an artifact list.");
  const targetRoot = realpathSync(resolve(projectRoot, "target")) + sep;
  const files = new Map();
  for (const path of artifacts) {
    const extension = settings.extensions.find((item) => path.endsWith(item));
    if (!extension) continue;
    const source = realpathSync(resolve(projectRoot, path));
    if (!source.startsWith(targetRoot) || !statSync(source).isFile())
      throw new Error("Release artifacts must be files inside the project target directory.");
    if (files.has(extension))
      throw new Error("More than one installer matches the same platform and format.");
    files.set(extension, source);
  }
  if (settings.extensions.some((extension) => !files.has(extension)))
    throw new Error("The build is missing a required installer format.");
  const version = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8")).version;
  const destination = resolve(projectRoot, "releases", platform);
  mkdirSync(destination, { recursive: true });
  const sums = [];
  for (const [extension, source] of files) {
    const name = `Hermes-Companion_${version}_${platform}${extension === ".exe" ? "_setup" : ""}${extension}`;
    copyFileSync(source, join(destination, name));
    const hash = createHash("sha256").update(readFileSync(source)).digest("hex");
    sums.push(`${hash}  ${name}`);
  }
  writeFileSync(join(destination, `SHA256SUMS-${platform}.txt`), sums.sort().join("\n") + "\n");
  console.log(
    `Collected ${files.size} installer(s) and SHA-256 checksums in releases/${platform}/.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    collectRelease(
      process.argv[2],
      process.env.TAURI_ARTIFACTS ? JSON.parse(process.env.TAURI_ARTIFACTS) : undefined,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
