import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { checkRelease, projectRoot } from "./check-release.mjs";
import { collectRelease } from "./collect-release.mjs";

try {
  checkRelease();
  const cli = resolve(projectRoot, "node_modules/@tauri-apps/cli/tauri.js");
  const result = spawnSync(process.execPath, [cli, "build", "--ci", "--", "--locked"], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  collectRelease();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
