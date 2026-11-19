import { promises as fs } from "node:fs";
import path from "node:path";
import ts from "typescript";

const projectRoot = path.resolve(process.cwd());
const distDirectory = path.join(projectRoot, "dist");
const manifestPath = path.join(
  projectRoot,
  "src",
  "generated",
  "manifest.json",
);
const missingFiles = [];
const brokenLinks = [];

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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

async function loadVibtoolsConfigHelpers() {
  const sourcePath = path.join(
    projectRoot,
    "src",
    "utils",
    "vibtoolsConfig.ts",
  );
  const source = await fs.readFile(sourcePath, "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
  return import(moduleUrl);
}

function canonicalRepoKey(repoUrl) {
  const trimmed = String(repoUrl || "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const cleanPath = parsed.pathname
        .replace(/\/+$/, "")
        .replace(/\.git$/i, "");
      return `${parsed.hostname.toLowerCase()}${cleanPath.toLowerCase()}`;
    } catch {
      return trimmed.toLowerCase();
    }
  }
  return trimmed.replace(/\/+$/, "").replace(/\.git$/i, "").toLowerCase();
}

async function validateVibtoolsAndRegistry() {
  const errors = [];
  const vibtoolsHelpers = await loadVibtoolsConfigHelpers();

  const vibtoolsDir = path.join(projectRoot, vibtoolsHelpers.VIBTOOLS_DIR);
  const vibtoolsStat = await fs.lstat(vibtoolsDir).catch(() => null);
  if (vibtoolsStat) {
    if (vibtoolsStat.isSymbolicLink() || !vibtoolsStat.isDirectory()) {
      errors.push(".vibtools must be a real directory inside the repository root");
    } else {
      const foundConfigFiles = [];
      for (const fileName of vibtoolsHelpers.VIBTOOLS_CONFIG_FILENAMES) {
        const candidatePath = path.join(vibtoolsDir, fileName);
        const candidateStat = await fs.lstat(candidatePath).catch(() => null);
        if (candidateStat) {
          if (candidateStat.isSymbolicLink() || !candidateStat.isFile()) {
            errors.push(`.vibtools/${fileName} must be a regular file`);
          } else {
            foundConfigFiles.push(fileName);
          }
        }
      }

      if (foundConfigFiles.length > 1) {
        errors.push(
          `Conflicting .vibtools configs found (${foundConfigFiles.join(", ")}); keep only one canonical config file`,
        );
      } else if (foundConfigFiles.length === 0) {
        errors.push(
          `.vibtools directory exists without ${vibtoolsHelpers.VIBTOOLS_CONFIG_FILENAMES.join(" or ")}`,
        );
      } else {
        const activeFile = foundConfigFiles[0];
        try {
          const parsedJson = JSON.parse(
            await fs.readFile(path.join(vibtoolsDir, activeFile), "utf8"),
          );
          const parsedConfig =
            vibtoolsHelpers.parseVibtoolsRepoConfig(parsedJson);
          if (!parsedConfig.success) {
            errors.push(`.vibtools/${activeFile}: ${parsedConfig.error}`);
          } else {
            const configData = parsedConfig.data;
            const docsPathsToCheck = new Set();
            const logoPathsToCheck = new Set();
            if (configData.docsPath) docsPathsToCheck.add(configData.docsPath);
            if (configData.logoPath) logoPathsToCheck.add(configData.logoPath);
            for (const targetKey of ["users", "developer"]) {
              const target = configData.targets?.[targetKey];
              if (target?.docsPath) docsPathsToCheck.add(target.docsPath);
              if (target?.logoPath) logoPathsToCheck.add(target.logoPath);
            }

            for (const relDocsPath of docsPathsToCheck) {
              const absDocsPath = path.resolve(projectRoot, relDocsPath);
              if (!isWithin(projectRoot, absDocsPath)) {
                errors.push(`.vibtools/${activeFile}: docsPath "${relDocsPath}" escapes repository`);
                continue;
              }
              const stat = await fs.lstat(absDocsPath).catch(() => null);
              if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
                errors.push(`.vibtools/${activeFile}: docsPath "${relDocsPath}" is missing or not a directory`);
              }
            }

            for (const relLogoPath of logoPathsToCheck) {
              const absLogoPath = path.resolve(projectRoot, relLogoPath);
              if (!isWithin(projectRoot, absLogoPath)) {
                errors.push(`.vibtools/${activeFile}: logoPath "${relLogoPath}" escapes repository`);
                continue;
              }
              const stat = await fs.lstat(absLogoPath).catch(() => null);
              if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
                errors.push(`.vibtools/${activeFile}: logoPath "${relLogoPath}" is missing or not a regular file`);
              } else if (stat.size === 0 || stat.size > 2 * 1024 * 1024) {
                errors.push(`.vibtools/${activeFile}: logoPath "${relLogoPath}" must be between 1 byte and 2 MB`);
              }
            }
          }
        } catch (error) {
          errors.push(`.vibtools/${activeFile} is invalid JSON: ${error.message}`);
        }
      }
    }
  }

  const siteConfigPath = path.join(projectRoot, "config", "site.config.json");
  if (await exists(siteConfigPath)) {
    try {
      const siteJson = JSON.parse(await fs.readFile(siteConfigPath, "utf8"));
      if (
        siteJson.portalType !== undefined &&
        !vibtoolsHelpers.PORTAL_TYPES.includes(siteJson.portalType)
      ) {
        errors.push(
          `config/site.config.json: portalType must be one of ${vibtoolsHelpers.PORTAL_TYPES.join(", ")}`,
        );
      }
    } catch (error) {
      errors.push(`config/site.config.json is invalid JSON: ${error.message}`);
    }
  }

  const projectsConfigPath = path.join(projectRoot, "config", "projects.json");
  if (await exists(projectsConfigPath)) {
    try {
      const projectsJson = JSON.parse(
        await fs.readFile(projectsConfigPath, "utf8"),
      );
      if (!Array.isArray(projectsJson)) {
        errors.push("config/projects.json must contain a JSON array");
      } else {
        const seenRepos = new Map();
        const seenExplicitSlugs = new Set();
        for (const [index, rawEntry] of projectsJson.entries()) {
          const parsed = vibtoolsHelpers.normalizeRegistryEntry(rawEntry);
          if (!parsed.success) {
            errors.push(`config/projects.json[${index}]: ${parsed.error}`);
            continue;
          }
          const entry = parsed.data;
          if (entry.slug) {
            if (seenExplicitSlugs.has(entry.slug)) {
              errors.push(
                `config/projects.json[${index}]: duplicate explicit slug "${entry.slug}"`,
              );
            }
            seenExplicitSlugs.add(entry.slug);
          }
          const repoKey = canonicalRepoKey(entry.repoUrl);
          if (repoKey) {
            const slugMarker = entry.slug || "__auto__";
            if (!seenRepos.has(repoKey)) seenRepos.set(repoKey, new Set());
            const existingMarkers = seenRepos.get(repoKey);
            if (existingMarkers.has(slugMarker) || existingMarkers.has("__auto__") || slugMarker === "__auto__" && existingMarkers.size > 0) {
              errors.push(
                `config/projects.json[${index}]: duplicate repoUrl "${entry.repoUrl}" without distinct explicit slug overrides`,
              );
            }
            existingMarkers.add(slugMarker);
          }
          const isStrictVerify =
            process.env.CF_PAGES === "1" ||
            process.env.CF_PAGES === "true" ||
            process.env.STRICT_SYNC === "1" ||
            process.env.STRICT_SYNC === "true" ||
            process.argv.includes("--strict");
          if (
            isStrictVerify &&
            typeof entry.repoUrl === "string" &&
            entry.repoUrl.includes("YOUR_ORG")
          ) {
            errors.push(
              `config/projects.json[${index}]: starter placeholder "${entry.repoUrl}" is not allowed in strict/CF_PAGES builds`,
            );
          }
        }
      }
    } catch (error) {
      errors.push(`config/projects.json is invalid JSON: ${error.message}`);
    }
  }

  return errors;
}

async function walkHtml(directory) {
  const htmlFiles = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      htmlFiles.push(...(await walkHtml(entryPath)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
      htmlFiles.push(entryPath);
    }
  }
  return htmlFiles;
}

function routeToHtml(route) {
  const cleanRoute = route.split(/[?#]/, 1)[0];
  const segments = cleanRoute.split("/").filter(Boolean);
  return path.join(distDirectory, ...segments, "index.html");
}

function routeToMarkdownFile(route, productSlug) {
  const cleanRoute = route.split(/[?#]/, 1)[0];
  const segments = cleanRoute.split("/").filter(Boolean).slice(1);
  const mdSlug = segments.length > 0 ? segments.join("/") : "index";
  return path.join(distDirectory, productSlug, `${mdSlug}.md`);
}

function isInternalReference(value) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) {
    return false;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return false;
  }
  return true;
}

function resolveCandidatePath(rawRef, sourceHtmlFile) {
  const withoutQueryOrHash = rawRef.split(/[?#]/, 1)[0];
  if (withoutQueryOrHash === "") {
    return rawRef.startsWith("?") || rawRef.startsWith("#")
      ? sourceHtmlFile
      : null;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(withoutQueryOrHash);
  } catch {
    return null;
  }

  const candidatePath = decodedPath.startsWith("/")
    ? path.resolve(distDirectory, `.${decodedPath}`)
    : path.resolve(path.dirname(sourceHtmlFile), decodedPath);

  const relative = path.relative(distDirectory, candidatePath);
  if (
    path.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`)
  ) {
    return null;
  }

  return candidatePath;
}

async function resolveInternalHref(href, sourceHtmlFile) {
  const candidatePath = resolveCandidatePath(href, sourceHtmlFile);
  if (!candidatePath) return false;

  if (await exists(candidatePath)) {
    const stat = await fs.stat(candidatePath);
    if (stat.isFile()) return true;
    if (
      stat.isDirectory() &&
      (await exists(path.join(candidatePath, "index.html")))
    )
      return true;
  }
  if (!path.extname(candidatePath) && (await exists(`${candidatePath}.html`)))
    return true;
  if (await exists(path.join(candidatePath, "index.html"))) return true;
  return false;
}

async function resolveInternalAsset(src, sourceHtmlFile) {
  const candidatePath = resolveCandidatePath(src, sourceHtmlFile);
  if (!candidatePath) return false;

  if (await exists(candidatePath)) {
    const stat = await fs.stat(candidatePath);
    return stat.isFile();
  }
  return false;
}

async function main() {
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    const requiredFiles = [
      "index.html",
      "404.html",
      "robots.txt",
      "sitemap-index.xml",
      "llms.txt",
      "llms-full.txt",
      "favicon.ico",
      "favicon-96x96.png",
      "apple-touch-icon.png",
      "site.webmanifest",
      "og-default.png",
      "_headers",
      "_redirects",
      "_routes.json",
      path.join("schemas", "vibtools-docs.schema.json"),
      path.join("pagefind", "pagefind.js"),
    ];
    for (const file of requiredFiles) {
      const filePath = path.join(distDirectory, file);
      if (!(await exists(filePath)))
        missingFiles.push(path.relative(projectRoot, filePath));
    }

    const brandLogo = manifest.site?.brandLogo;
    if (typeof brandLogo === "string" && brandLogo.startsWith("/")) {
      const logoDistPath = path.join(distDirectory, brandLogo.slice(1));
      if (!(await exists(logoDistPath))) {
        missingFiles.push(path.relative(projectRoot, logoDistPath));
      }
    }

    const webmanifestPath = path.join(distDirectory, "site.webmanifest");
    if (await exists(webmanifestPath)) {
      const webmanifest = JSON.parse(await fs.readFile(webmanifestPath, "utf8"));
      for (const icon of webmanifest.icons ?? []) {
        if (typeof icon?.src === "string" && icon.src.startsWith("/")) {
          const iconPath = path.join(distDirectory, icon.src.slice(1));
          if (!(await exists(iconPath))) {
            missingFiles.push(path.relative(projectRoot, iconPath));
          }
        }
      }
    }

    const cloudflareErrors = [];
    const requiredCloudflareSourceFiles = [
      "wrangler.toml",
      ".node-version",
      ".nvmrc",
      "package-lock.json",
      path.join("functions", "tsconfig.json"),
      path.join("functions", "api", "health.ts"),
      path.join("functions", "api", "webhook.ts"),
    ];
    for (const file of requiredCloudflareSourceFiles) {
      const filePath = path.join(projectRoot, file);
      if (!(await exists(filePath)))
        missingFiles.push(path.relative(projectRoot, filePath));
    }

    const nodeVersionPath = path.join(projectRoot, ".node-version");
    const nvmrcPath = path.join(projectRoot, ".nvmrc");
    if ((await exists(nodeVersionPath)) && (await exists(nvmrcPath))) {
      const nodeVer = (await fs.readFile(nodeVersionPath, "utf8"))
        .trim()
        .replace(/^v/i, "");
      const nvmrcVer = (await fs.readFile(nvmrcPath, "utf8"))
        .trim()
        .replace(/^v/i, "");
      if (nodeVer !== nvmrcVer) {
        cloudflareErrors.push(
          `.node-version (${nodeVer}) and .nvmrc (${nvmrcVer}) must specify the same Node.js version`,
        );
      }
      if (nodeVer === "22.24.0") {
        cloudflareErrors.push(
          `.node-version/${nodeVer} is not a published Node.js release on nodejs.org/dist (pin to 22.23.5)`,
        );
      }
      const [maj, min, pat] = nodeVer.split(".").map(Number);
      const satisfiesAstroNode =
        maj > 22 ||
        (maj === 22 && (min > 23 || (min === 23 && pat >= 4)));
      if (!satisfiesAstroNode) {
        cloudflareErrors.push(
          `.node-version (${nodeVer}) must be >=22.23.4 for Astro 7 compatibility`,
        );
      }
    }

    for (const conflictingLockfile of ["bun.lock", "bun.lockb"]) {
      if (await exists(path.join(projectRoot, conflictingLockfile))) {
        cloudflareErrors.push(
          `${conflictingLockfile} must not exist alongside package-lock.json (prevents Cloudflare Pages package-manager mismatch)`,
        );
      }
    }

    const packageLockPath = path.join(projectRoot, "package-lock.json");
    if (await exists(packageLockPath)) {
      try {
        const lockJson = JSON.parse(await fs.readFile(packageLockPath, "utf8"));
        const rootEnginesNode = lockJson?.packages?.[""]?.engines?.node;
        if (rootEnginesNode !== ">=22.23.4") {
          cloudflareErrors.push(
            `package-lock.json packages[""].engines.node is "${rootEnginesNode}" (expected ">=22.23.4")`,
          );
        }
        const resolvedCount = Object.entries(lockJson?.packages ?? {}).filter(
          ([key, val]) => key !== "" && typeof val?.resolved === "string",
        ).length;
        if (resolvedCount === 0) {
          cloudflareErrors.push(
            "package-lock.json is missing registry resolved tarball URLs",
          );
        }
      } catch (error) {
        cloudflareErrors.push(
          `package-lock.json is invalid JSON: ${error.message}`,
        );
      }
    }

    const distRoutesPath = path.join(distDirectory, "_routes.json");
    if (await exists(distRoutesPath)) {
      try {
        const routesConfig = JSON.parse(await fs.readFile(distRoutesPath, "utf8"));
        if (
          routesConfig?.version !== 1 ||
          !Array.isArray(routesConfig?.include) ||
          !Array.isArray(routesConfig?.exclude)
        ) {
          cloudflareErrors.push(
            "dist/_routes.json must specify version: 1 with include and exclude arrays",
          );
        }
      } catch (error) {
        cloudflareErrors.push(
          `dist/_routes.json is invalid JSON: ${error.message}`,
        );
      }
    }

    const distRedirectsPath = path.join(distDirectory, "_redirects");
    if (await exists(distRedirectsPath)) {
      const redirectLines = (await fs.readFile(distRedirectsPath, "utf8"))
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
      for (const line of redirectLines) {
        const sourcePattern = line.split(/\s+/)[0] || "";
        if (/^https?:\/\//i.test(sourcePattern)) {
          try {
            const parsedSource = new URL(sourcePattern);
            if (!parsedSource.hostname.endsWith(".pages.dev")) {
              cloudflareErrors.push(
                `dist/_redirects contains unsupported custom-domain source rule "${sourcePattern}" (use Cloudflare Redirect Rules instead)`,
              );
            }
          } catch {
            cloudflareErrors.push(
              `dist/_redirects contains invalid source URL "${sourcePattern}"`,
            );
          }
        }
      }
    }

    for (const leakedFile of [
      "MANIFEST.md",
      "README.md",
      path.join("assets", "aistudio"),
    ]) {
      if (await exists(path.join(distDirectory, leakedFile))) {
        cloudflareErrors.push(
          `dist/${leakedFile} must not be published in the static output root`,
        );
      }
    }

    if (await exists(path.join(projectRoot, ".github", "README.md"))) {
      cloudflareErrors.push(
        ".github/README.md must not exist because GitHub prioritizes .github/README.md over the root /README.md on the repository homepage",
      );
    }

    const vibtoolsErrors = await validateVibtoolsAndRegistry();

    for (const project of manifest.projects ?? []) {
      if (!project?.slug || !Array.isArray(project.flatPages)) {
        missingFiles.push(
          `manifest project entry missing slug/flatPages: ${JSON.stringify(project)}`,
        );
        continue;
      }
      const llmsPath = path.join(distDirectory, project.slug, "llms.txt");
      if (!(await exists(llmsPath)))
        missingFiles.push(path.relative(projectRoot, llmsPath));
      for (const page of project.flatPages) {
        const htmlPath = routeToHtml(page.route);
        if (!(await exists(htmlPath)))
          missingFiles.push(path.relative(projectRoot, htmlPath));
        const mdPath = routeToMarkdownFile(page.route, project.slug);
        if (!(await exists(mdPath)))
          missingFiles.push(path.relative(projectRoot, mdPath));
      }
    }

    const seoErrors = [];
    const notFoundHtmlPath = path.join(distDirectory, "404.html");
    if (await exists(notFoundHtmlPath)) {
      const notFoundHtml = await fs.readFile(notFoundHtmlPath, "utf8");
      if (!/<meta\s+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(notFoundHtml)) {
        seoErrors.push("dist/404.html is missing <meta name=\"robots\" content=\"noindex, ...\">");
      }
    }

    const htmlFiles = await walkHtml(distDirectory);
    const jsonLdPattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    for (const htmlFile of htmlFiles) {
      const html = await fs.readFile(htmlFile, "utf8");
      const relHtmlPath = path.relative(distDirectory, htmlFile);
      const jsonLdMatches = Array.from(html.matchAll(jsonLdPattern));
      if (relHtmlPath === "index.html" && jsonLdMatches.length === 0) {
        seoErrors.push("dist/index.html is missing Schema.org JSON-LD");
      }
      for (const jsonMatch of jsonLdMatches) {
        try {
          JSON.parse(jsonMatch[1]);
        } catch (error) {
          seoErrors.push(`${relHtmlPath} contains invalid JSON-LD: ${error.message}`);
        }
      }

      const hrefPattern = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
      for (const match of html.matchAll(hrefPattern)) {
        const href = (match[1] ?? match[2] ?? "").replace(/&amp;/g, "&");
        if (!isInternalReference(href)) continue;
        if (!(await resolveInternalHref(href, htmlFile))) {
          brokenLinks.push(
            `${relHtmlPath} -> ${href}`,
          );
        }
      }

      const imgSrcPattern =
        /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi;
      for (const match of html.matchAll(imgSrcPattern)) {
        const src = (match[1] ?? match[2] ?? "").replace(/&amp;/g, "&");
        if (!isInternalReference(src)) continue;
        if (!(await resolveInternalAsset(src, htmlFile))) {
          brokenLinks.push(
            `${relHtmlPath} -> img[src="${src}"]`,
          );
        }
      }

      const iconLinkPattern =
        /<link\b[^>]*?\brel\s*=\s*(?:"([^"]*icon[^"]*)"|'([^']*icon[^']*)')[^>]*>/gi;
      for (const match of html.matchAll(iconLinkPattern)) {
        const hrefMatch = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(match[0]);
        const iconHref = (hrefMatch?.[1] ?? hrefMatch?.[2] ?? "").replace(/&amp;/g, "&");
        if (!iconHref || !isInternalReference(iconHref)) continue;
        if (!(await resolveInternalAsset(iconHref, htmlFile))) {
          brokenLinks.push(
            `${relHtmlPath} -> link[href="${iconHref}"]`,
          );
        }
      }
    }

    if (
      missingFiles.length ||
      brokenLinks.length ||
      cloudflareErrors.length ||
      vibtoolsErrors.length ||
      seoErrors.length
    ) {
      console.error("Build verification failed.");
      if (missingFiles.length) {
        console.error("Missing files:");
        for (const file of missingFiles) console.error(`  - ${file}`);
      }
      if (cloudflareErrors.length) {
        console.error("Cloudflare configuration errors:");
        for (const err of cloudflareErrors) console.error(`  - ${err}`);
      }
      if (vibtoolsErrors.length) {
        console.error(".vibtools / registry errors:");
        for (const err of vibtoolsErrors) console.error(`  - ${err}`);
      }
      if (seoErrors.length) {
        console.error("SEO / AI verification errors:");
        for (const err of seoErrors) console.error(`  - ${err}`);
      }
      if (brokenLinks.length) {
        console.error("Broken internal links:");
        for (const link of brokenLinks) console.error(`  - ${link}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log(
      `Build verification passed: ${htmlFiles.length} HTML files, ${requiredFiles.length} required assets, ${manifest.projects?.length ?? 0} projects, and no broken internal links.`,
    );
  } catch (error) {
    console.error(`Build verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
