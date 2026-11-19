import { promises as fs } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(process.cwd());
const usage = `Usage: npm run export-portal -- --portal <user|dev> --out <targetDirectory>

Example:
  npm run export-portal -- --portal user --out ../docs-vib-tools`;
const excludedNames = new Set([
  "node_modules",
  "dist",
  ".astro",
  ".wrangler",
  ".git",
  "notes",
  ".playwright-mcp",
  ".playwright-cli",
  ".aistudio",
  "artifacts",
]);
const generatedRoots = ["src/content/docs", "src/generated", "public/logos"];
const portalWranglerNames = {
  user: "docscaffold-users",
  dev: "docscaffold-developers",
};

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--portal" || arg === "--out") {
      const value = args[index + 1];
      if (!value || value.startsWith("--"))
        throw new Error(`Missing value for ${arg}.\n\n${usage}`);
      options[arg.slice(2)] = value;
      index += 1;
    } else if (arg.startsWith("--portal=")) {
      options.portal = arg.slice("--portal=".length);
    } else if (arg.startsWith("--out=")) {
      options.out = arg.slice("--out=".length);
    } else {
      throw new Error(`Unknown option: ${arg}\n\n${usage}`);
    }
  }
  if (!options.portal || !options.out)
    throw new Error(`Both --portal and --out are required.\n\n${usage}`);
  if (!new Set(["user", "dev"]).has(options.portal)) {
    throw new Error(
      `Invalid portal "${options.portal}". Choose "user" or "dev".\n\n${usage}`,
    );
  }
  return options;
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

function shouldSkip(relativePath, portal) {
  const normalized = relativePath.split(path.sep).join("/");
  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) => excludedNames.has(segment) || segment.startsWith(".env"),
    )
  )
    return true;
  if (portal === "user" && segments[0] === ".vibtools") return true;
  if (normalized === "bun.lock" || normalized === "bun.lockb") return true;
  if (
    normalized === "public/assets/aistudio" ||
    normalized.startsWith("public/assets/aistudio/")
  )
    return true;
  if (segments[0] === "config" && segments[1] === "presets") return true;

  for (const generatedRoot of generatedRoots) {
    if (normalized === generatedRoot) return false;
    if (normalized.startsWith(`${generatedRoot}/`)) {
      if (
        generatedRoot === "public/logos" &&
        normalized === "public/logos/vib-tools.png"
      ) {
        return false;
      }
      return normalized !== `${generatedRoot}/.gitkeep`;
    }
  }
  return false;
}

async function copyEngine(
  sourceDirectory,
  destinationDirectory,
  portal,
  relativeDirectory = "",
) {
  await fs.mkdir(destinationDirectory, { recursive: true });
  for (const entry of await fs.readdir(sourceDirectory, {
    withFileTypes: true,
  })) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (shouldSkip(relativePath, portal)) continue;
    const sourcePath = path.join(sourceDirectory, entry.name);
    const destinationPath = path.join(destinationDirectory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Refusing to export symbolic link: ${relativePath}`);
    if (entry.isDirectory()) {
      await copyEngine(sourcePath, destinationPath, portal, relativePath);
    } else if (entry.isFile()) {
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
}

async function main() {
  let stagingDirectory;
  try {
    const options = parseArgs(process.argv.slice(2));
    const presetDirectory = path.join(
      projectRoot,
      "config",
      "presets",
      `${options.portal}-portal`,
    );
    const presetFiles = ["site.config.json", "projects.json"];
    const presetData = {};
    for (const fileName of presetFiles) {
      const presetPath = path.join(presetDirectory, fileName);
      const raw = await fs.readFile(presetPath, "utf8");
      presetData[fileName] = JSON.parse(raw);
    }
    if (
      !presetData["projects.json"] ||
      !Array.isArray(presetData["projects.json"])
    ) {
      throw new Error(
        `${path.join(presetDirectory, "projects.json")} must contain a JSON array.`,
      );
    }
    if (
      !presetData["site.config.json"] ||
      typeof presetData["site.config.json"] !== "object"
    ) {
      throw new Error(
        `${path.join(presetDirectory, "site.config.json")} must contain a JSON object.`,
      );
    }

    const outputDirectory = path.resolve(process.cwd(), options.out);
    if (
      isWithin(projectRoot, outputDirectory) ||
      isWithin(outputDirectory, projectRoot)
    ) {
      throw new Error(
        "Output directory must be outside the engine repository to prevent recursive or destructive exports.",
      );
    }
    try {
      await fs.lstat(outputDirectory);
      throw new Error(
        `Output directory already exists: ${outputDirectory}\nChoose a new, empty target directory.`,
      );
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    const parentDirectory = path.dirname(outputDirectory);
    await fs.mkdir(parentDirectory, { recursive: true });
    stagingDirectory = `${outputDirectory}.tmp-${process.pid}`;
    await fs.mkdir(stagingDirectory, { recursive: false });
    await copyEngine(projectRoot, stagingDirectory, options.portal);
    const targetConfigDirectory = path.join(stagingDirectory, "config");
    await fs.mkdir(targetConfigDirectory, { recursive: true });
    await fs.writeFile(
      path.join(targetConfigDirectory, "site.config.json"),
      `${JSON.stringify(presetData["site.config.json"], null, 2)}\n`,
    );
    await fs.writeFile(
      path.join(targetConfigDirectory, "projects.json"),
      `${JSON.stringify(presetData["projects.json"], null, 2)}\n`,
    );

    const wranglerPath = path.join(stagingDirectory, "wrangler.toml");
    const targetProjectName = portalWranglerNames[options.portal];
    if (targetProjectName) {
      try {
        const wranglerRaw = await fs.readFile(wranglerPath, "utf8");
        const updatedWrangler = wranglerRaw.replace(
          /^name\s*=\s*"[^"]*"/m,
          `name = "${targetProjectName}"`,
        );
        await fs.writeFile(wranglerPath, updatedWrangler, "utf8");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }

    const webmanifestPath = path.join(stagingDirectory, "public", "site.webmanifest");
    try {
      const siteCfg = presetData["site.config.json"];
      const manifestRaw = await fs.readFile(webmanifestPath, "utf8");
      const manifestObj = JSON.parse(manifestRaw);
      if (typeof siteCfg.portalTitle === "string" && siteCfg.portalTitle.trim()) {
        manifestObj.name = siteCfg.portalTitle.trim();
      }
      if (typeof siteCfg.brandName === "string" && siteCfg.brandName.trim()) {
        manifestObj.short_name = siteCfg.brandName.trim();
      }
      if (typeof siteCfg.defaultAccent === "string" && siteCfg.defaultAccent.trim()) {
        manifestObj.theme_color = siteCfg.defaultAccent.trim();
      }
      await fs.writeFile(
        webmanifestPath,
        `${JSON.stringify(manifestObj, null, 2)}\n`,
        "utf8",
      );
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    await fs.rename(stagingDirectory, outputDirectory);
    stagingDirectory = undefined;

    console.log(`Exported the ${options.portal} portal to ${outputDirectory}.`);
    console.log(
      `Next: cd "${outputDirectory}" && git init && npm install && npm run build`,
    );
    if (
      presetData["projects.json"].some((project) => {
        const repoUrl = typeof project === "string" ? project : project?.repoUrl;
        return typeof repoUrl === "string" && repoUrl.includes("YOUR_ORG");
      })
    ) {
      console.log(
        "Replace the preset's YOUR_ORG repository URLs before building.",
      );
    }
  } catch (error) {
    console.error(`Portal export failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (stagingDirectory)
      await fs.rm(stagingDirectory, { recursive: true, force: true });
  }
}

main();
