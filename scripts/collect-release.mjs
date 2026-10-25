import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve, sep } from "node:path";
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

export function collectRelease(platform, artifacts, outputRoot = resolve(projectRoot, "releases")) {
  platform ??= `${process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : process.platform}-${process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch}`;
  const settings = platforms[platform];
  if (!settings) throw new Error("Select a supported desktop release platform.");
  const version = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8")).version;
  const signed = !!process.env.TAURI_SIGNING_PRIVATE_KEY;
  const extensions = [
    ...settings.extensions,
    ...(signed && platform.startsWith("macos-") ? [".app.tar.gz"] : []),
  ];
  if (!artifacts) {
    const target = resolve(projectRoot, "target");
    const native = join(target, "release", "bundle");
    const explicit = join(target, settings.target, "release", "bundle");
    artifacts = walk(process.env.RELEASE_TARGET ? explicit : native).filter(
      (path) => path.endsWith(".app.tar.gz") || basename(path).includes(`_${version}_`),
    );
  }
  if (!Array.isArray(artifacts) || !artifacts.every((path) => typeof path === "string"))
    throw new Error("The build did not return an artifact list.");
  const targetRoot = realpathSync(resolve(projectRoot, "target")) + sep;
  const files = new Map();
  for (const path of artifacts) {
    const extension = extensions.find((item) => path.endsWith(item));
    if (!extension) continue;
    const source = realpathSync(resolve(projectRoot, path));
    if (!source.startsWith(targetRoot) || !statSync(source).isFile())
      throw new Error("Release artifacts must be files inside the project target directory.");
    if (files.has(extension))
      throw new Error("More than one installer matches the same platform and format.");
    files.set(extension, source);
  }
  const missing = extensions.filter((extension) => !files.has(extension));
  if (missing.length) {
    const hint = missing.includes(".app.tar.gz")
      ? ' Configure macOS bundle.targets with both "app" and "dmg" to generate the updater archive.'
      : "";
    throw new Error(
      `The build is missing required release files for ${platform}: ${missing.join(", ")}.${hint}`,
    );
  }
  const destination = resolve(outputRoot, platform);
  mkdirSync(destination, { recursive: true });
  const sums = [];
  const updates = {};
  for (const [extension, source] of files) {
    const name = `Hermes-Companion_${version}_${platform}${extension === ".exe" ? "_setup" : ""}${extension}`;
    copyFileSync(source, join(destination, name));
    const hash = createHash("sha256").update(readFileSync(source)).digest("hex");
    sums.push(`${hash}  ${name}`);
    if (signed && extension !== ".dmg") {
      const result = spawnSync(
        process.execPath,
        [
          resolve(projectRoot, "node_modules/@tauri-apps/cli/tauri.js"),
          "signer",
          "sign",
          source,
          "--app-version",
          version,
        ],
        { encoding: "utf8" },
      );
      if (result.error || result.status !== 0)
        throw new Error("Could not sign the update artifact. Check the release signing secrets.");
      const signature = readFileSync(source + ".sig", "utf8").trim();
      writeFileSync(join(destination, name + ".sig"), signature + "\n");
      sums.push(
        `${createHash("sha256")
          .update(signature + "\n")
          .digest("hex")}  ${name}.sig`,
      );
      const target = platform.replace("macos-", "darwin-");
      const bundle = {
        ".deb": "deb",
        ".AppImage": "appimage",
        ".exe": "nsis",
        ".app.tar.gz": "app",
      }[extension];
      updates[`${target}-${bundle}`] = {
        signature,
        url: `https://github.com/Buldozerch/hermes-companion/releases/download/v${version}/${name}`,
      };
    }
  }
  if (signed)
    writeFileSync(
      join(destination, `update-${platform}.json`),
      JSON.stringify({ version, platforms: updates }, null, 2) + "\n",
    );
  writeFileSync(join(destination, `SHA256SUMS-${platform}.txt`), sums.sort().join("\n") + "\n");
  console.log(
    `Collected ${files.size} release file(s) and SHA-256 checksums in releases/${platform}/.`,
  );
  return destination;
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
