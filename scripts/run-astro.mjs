import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const astroPackageDir = path.dirname(require.resolve("astro/package.json"));
const astroBin = path.join(astroPackageDir, "bin", "astro.mjs");

const [major = 0, minor = 0, patch = 0] = process.versions.node
  .split(".")
  .map((part) => Number.parseInt(part, 10) || 0);

const needsWebcontainerFloor =
  major === 22 && (minor === 22 || (minor === 23 && patch < 4));

const nodeArgs = [];
if (needsWebcontainerFloor) {
  nodeArgs.push(
    "--import",
    "data:text/javascript,process.versions.webcontainer='1'",
  );
}
nodeArgs.push(astroBin, ...process.argv.slice(2));

const child = spawn(process.execPath, nodeArgs, {
  stdio: "inherit",
  env: process.env,
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
