import matter from "gray-matter";
import { execFileSync } from "node:child_process";
import { promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { z } from "zod";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const docsOutput = path.join(projectRoot, "src", "content", "docs");
const logosOutput = path.join(projectRoot, "public", "logos");
const generatedOutput = path.join(projectRoot, "src", "generated");
const siteConfigPath = path.join(projectRoot, "config", "site.config.json");
const projectsConfigPath = path.join(projectRoot, "config", "projects.json");
const hexColorSchema = z
  .string()
  .regex(
    /^#(?:[\da-fA-F]{3}|[\da-fA-F]{4}|[\da-fA-F]{6}|[\da-fA-F]{8})$/,
    "must be a valid 3, 4, 6, or 8 digit hexadecimal CSS color",
  );
const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "must use HTTP or HTTPS");

const siteConfigSchema = z.object({
  portalTitle: z.string().trim().min(1),
  portalSubtitle: z.string(),
  domain: z
    .string()
    .url()
    .refine((value) => new URL(value).protocol === "https:", "must use HTTPS"),
  brandName: z.string().trim().min(1),
  brandLogo: z.string().trim().min(1),
  defaultAccent: hexColorSchema,
  portalType: z.enum(["users", "developer", "all"]).default("all"),
  navLinks: z.array(
    z.object({
      label: z.string().trim().min(1),
      href: z
        .string()
        .trim()
        .min(1)
        .refine(
          (value) =>
            value.startsWith("/") || httpUrlSchema.safeParse(value).success,
          "must be a root-relative path or HTTP(S) URL",
        ),
    }),
  ),
});

function parseJsonFile(filePath) {
  return JSON.parse(requireText(filePath));
}

function requireText(filePath) {
  return readFileSync(filePath, "utf8");
}

function sanitizeError(error, secrets = []) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets.filter(Boolean))
    message = message.split(secret).join("[REDACTED]");
  return message.replace(/https:\/\/[^/@\s]+@/gi, "https://[REDACTED]@");
}

async function clearOutputDirectory(
  directory,
  preservedNames = new Set([".gitkeep"]),
) {
  await fs.mkdir(directory, { recursive: true });
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (preservedNames.has(entry.name)) continue;
    if (entry.isDirectory()) {
      await clearOutputDirectory(entryPath, preservedNames);
      const remaining = await fs.readdir(entryPath);
      if (remaining.length === 0) await fs.rmdir(entryPath);
    } else {
      await fs.rm(entryPath, { recursive: true, force: true });
    }
  }
}

function assertWithin(parent, candidate, label) {
  const relative = path.relative(parent, candidate);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} resolves outside the allowed directory`);
  }
}

async function copyTree(source, destination) {
  const sourceStat = await fs.lstat(source);
  if (!sourceStat.isDirectory())
    throw new Error(`Documentation source is not a directory: ${source}`);
  await fs.mkdir(destination, { recursive: true });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(
        `Symbolic links are not allowed in documentation: ${sourcePath}`,
      );
    if (entry.isDirectory()) {
      await copyTree(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
}

async function normalizeDocsTree(directory, relativeDirectory = "") {
  const initialEntries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of initialEntries) {
    if (entry.isFile() && entry.name.toLowerCase() === "manifest.md") {
      await fs.rm(path.join(directory, entry.name), { force: true });
    }
  }

  const afterManifestEntries = await fs.readdir(directory, {
    withFileTypes: true,
  });
  const hasExplicitIndex = afterManifestEntries.some(
    (entry) => entry.isFile() && /^index\.mdx?$/i.test(entry.name),
  );
  const readmeEntries = afterManifestEntries.filter(
    (entry) => entry.isFile() && /^readme\.mdx?$/i.test(entry.name),
  );

  for (const [index, readmeEntry] of readmeEntries.entries()) {
    const readmePath = path.join(directory, readmeEntry.name);
    if (hasExplicitIndex || index > 0) {
      await fs.rm(readmePath, { force: true });
    } else {
      const ext =
        path.extname(readmeEntry.name).toLowerCase() === ".mdx"
          ? ".mdx"
          : ".md";
      await fs.rename(readmePath, path.join(directory, `index${ext}`));
    }
  }

  const currentEntries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of currentEntries) {
    const entryPath = path.join(directory, entry.name);
    const relPath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    if (entry.isDirectory()) {
      await normalizeDocsTree(entryPath, relPath);
      const remaining = await fs.readdir(entryPath);
      if (remaining.length === 0) await fs.rmdir(entryPath);
    } else if (entry.isFile() && /\.mdx?$/i.test(entry.name)) {
      const source = await fs.readFile(entryPath, "utf8");
      const { data } = matter(source);
      if (data.draft !== undefined && typeof data.draft !== "boolean") {
        throw new Error(`Frontmatter draft in ${relPath} must be a boolean`);
      }
      if (data.draft === true) {
        await fs.rm(entryPath, { force: true });
      }
    }
  }
}

async function resolveRootIndexPath(directory) {
  for (const candidate of ["index.md", "index.mdx"]) {
    const fullPath = path.join(directory, candidate);
    try {
      await fs.access(fullPath);
      return fullPath;
    } catch {}
  }
  throw new Error(
    `Missing required root index.md (or README.md) in ${directory}`,
  );
}

function resolveSecretValue(raw) {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return "";
  if (trimmed.startsWith("$")) {
    return (process.env[trimmed.slice(1).trim()] || "").trim();
  }
  if (/^[A-Z_][A-Z0-9_]*$/.test(trimmed) && process.env[trimmed]) {
    return (process.env[trimmed] || "").trim();
  }
  return trimmed;
}

function resolveProjectAuth(project, globalToken = "") {
  const explicitToken =
    resolveSecretValue(project.secretKey) ||
    resolveSecretValue(project.gitToken) ||
    (project.gitTokenEnv
      ? (process.env[project.gitTokenEnv.trim()] || "").trim()
      : "");
  const username =
    resolveSecretValue(project.gitUsername) ||
    (process.env.GIT_USERNAME || "").trim();
  return {
    explicitToken,
    fallbackToken: (globalToken || "").trim(),
    username,
  };
}

function authenticatedCloneUrl(repoUrl, token, username = "") {
  if (!token || !repoUrl.toLowerCase().startsWith("https://")) return repoUrl;
  const parsed = new URL(repoUrl);
  const defaultUser = parsed.hostname.toLowerCase().includes("gitlab")
    ? "oauth2"
    : "x-access-token";
  parsed.username = username || process.env.GIT_USERNAME || defaultUser;
  parsed.password = token;
  return parsed.toString();
}

const nonInteractiveGitEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "never",
  GIT_ASKPASS: "",
  SSH_ASKPASS: "",
};

function runGitSparseCloneBase(cloneUrl, branch, destination, initialPath) {
  execFileSync(
    "git",
    [
      "clone",
      "--depth",
      "1",
      "--filter=blob:none",
      "--sparse",
      "--branch",
      branch,
      cloneUrl,
      destination,
    ],
    {
      cwd: projectRoot,
      stdio: "pipe",
      encoding: "utf8",
      env: nonInteractiveGitEnv,
    },
  );
  execFileSync("git", ["sparse-checkout", "set", initialPath], {
    cwd: destination,
    stdio: "pipe",
    encoding: "utf8",
    env: nonInteractiveGitEnv,
  });
}

function addGitSparsePaths(destination, paths) {
  const uniquePaths = [...new Set(paths.filter((p) => p && p !== "."))];
  if (uniquePaths.length === 0) return;
  execFileSync("git", ["sparse-checkout", "add", ...uniquePaths], {
    cwd: destination,
    stdio: "pipe",
    encoding: "utf8",
    env: nonInteractiveGitEnv,
  });
}

function switchGitSparseBranch(destination, targetBranch, secrets = []) {
  try {
    execFileSync("git", ["fetch", "--depth", "1", "origin", targetBranch], {
      cwd: destination,
      stdio: "pipe",
      encoding: "utf8",
      env: nonInteractiveGitEnv,
    });
    execFileSync("git", ["checkout", "-B", targetBranch, "FETCH_HEAD"], {
      cwd: destination,
      stdio: "pipe",
      encoding: "utf8",
      env: nonInteractiveGitEnv,
    });
  } catch (error) {
    throw new Error(
      `Failed to switch sparse checkout to branch "${targetBranch}": ${sanitizeError(error, secrets)}`,
    );
  }
}

async function cloneMetadataFirst(entry, destination, token, initialSparsePath) {
  const branch = entry.branch || "main";
  const { explicitToken, fallbackToken, username } = resolveProjectAuth(
    entry,
    token,
  );
  if (explicitToken) {
    const cloneUrl = authenticatedCloneUrl(
      entry.repoUrl,
      explicitToken,
      username,
    );
    runGitSparseCloneBase(cloneUrl, branch, destination, initialSparsePath);
    return;
  }

  try {
    runGitSparseCloneBase(entry.repoUrl, branch, destination, initialSparsePath);
  } catch (publicCloneError) {
    if (!fallbackToken || !entry.repoUrl.toLowerCase().startsWith("https://")) {
      throw publicCloneError;
    }
    await fs.rm(destination, { recursive: true, force: true });
    const fallbackUrl = authenticatedCloneUrl(
      entry.repoUrl,
      fallbackToken,
      username,
    );
    runGitSparseCloneBase(fallbackUrl, branch, destination, initialSparsePath);
  }
}

async function readVibtoolsConfigFromRoot(repoRoot, helpers) {
  const vibtoolsDir = path.join(repoRoot, helpers.VIBTOOLS_DIR);
  const dirStat = await fs.lstat(vibtoolsDir).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!dirStat) return null;
  if (dirStat.isSymbolicLink()) {
    throw new Error("Symbolic links are not allowed for .vibtools directory");
  }
  if (!dirStat.isDirectory()) {
    throw new Error(".vibtools must be a directory");
  }

  const foundFiles = [];
  for (const filename of helpers.VIBTOOLS_CONFIG_FILENAMES) {
    const candidatePath = path.join(vibtoolsDir, filename);
    const fileStat = await fs.lstat(candidatePath).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (!fileStat) continue;
    if (fileStat.isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed for .vibtools/${filename}`);
    }
    if (!fileStat.isFile()) {
      throw new Error(`.vibtools/${filename} must be a regular file`);
    }
    foundFiles.push({ filename, candidatePath });
  }

  if (foundFiles.length > 1) {
    throw new Error(
      `Conflicting .vibtools config files (${foundFiles.map((f) => f.filename).join(" and ")}); keep only one canonical file`,
    );
  }
  if (foundFiles.length === 0) return null;

  const { filename, candidatePath } = foundFiles[0];
  let parsedJson;
  try {
    parsedJson = JSON.parse(await fs.readFile(candidatePath, "utf8"));
  } catch (error) {
    throw new Error(`Malformed JSON in .vibtools/${filename}: ${error.message}`);
  }

  const validated = helpers.parseVibtoolsRepoConfig(parsedJson);
  if (!validated.success) {
    throw new Error(`Invalid .vibtools/${filename}: ${validated.error}`);
  }
  return validated.data;
}

function formatSlug(slug) {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function metadataString(value, field, project) {
  if (value === undefined || value === null || value === "") return "";
  if (
    field === "version" &&
    (typeof value === "string" || typeof value === "number")
  )
    return String(value);
  if (typeof value !== "string")
    throw new Error(
      `${field} frontmatter for ${project.slug} must be a string`,
    );
  return value.trim();
}

function titleFromMarkdown(markdown) {
  const heading = /^\s*#\s+(.+?)\s*#*\s*$/m.exec(markdown)?.[1];
  return heading?.replace(/\s+#+$/, "").trim() || "";
}

async function tryCopyValidatedLogo(candidatePath, projectSlug) {
  const extension = path.extname(candidatePath).toLowerCase();
  if (extension !== ".png" && extension !== ".svg") {
    return null;
  }
  try {
    const stat = await fs.lstat(candidatePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) {
      return null;
    }
    const buffer = await fs.readFile(candidatePath);
    if (extension === ".png") {
      const signature = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      if (!buffer.subarray(0, 8).equals(signature)) return null;
    } else {
      const svg = buffer.toString("utf8");
      if (
        !/<svg\b/i.test(svg) ||
        /<script\b|\bon[a-z]+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|javascript:)/i.test(
          svg,
        )
      ) {
        return null;
      }
    }
    const target = path.join(logosOutput, `${projectSlug}${extension}`);
    await fs.copyFile(candidatePath, target);
    return `/logos/${projectSlug}${extension}`;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return null;
  }
}

async function findLogo(sourceDirectory, project, repoRootDirectory = null) {
  const names = ["logo.svg", "logo.png", "icon.svg", "icon.png"];

  if (project.logoPath && repoRootDirectory) {
    const configuredLogoPath = path.resolve(repoRootDirectory, project.logoPath);
    assertWithin(repoRootDirectory, configuredLogoPath, "logoPath");
    const copiedConfigured = await tryCopyValidatedLogo(
      configuredLogoPath,
      project.slug,
    );
    if (copiedConfigured) return copiedConfigured;
    console.warn(
      `Warning [${project.slug}]: configured logoPath "${project.logoPath}" is missing or invalid; falling back to standard logo discovery.`,
    );
  }

  if (repoRootDirectory) {
    const vibtoolsDir = path.join(repoRootDirectory, ".vibtools");
    const vibtoolsStat = await fs.lstat(vibtoolsDir).catch(() => null);
    if (vibtoolsStat?.isDirectory() && !vibtoolsStat.isSymbolicLink()) {
      for (const name of names) {
        const copied = await tryCopyValidatedLogo(
          path.join(vibtoolsDir, name),
          project.slug,
        );
        if (copied) return copied;
      }
    }
  }

  const directories = [
    sourceDirectory,
    path.join(sourceDirectory, "assets"),
    path.join(sourceDirectory, "images"),
  ];
  for (const directory of directories) {
    for (const name of names) {
      const copied = await tryCopyValidatedLogo(
        path.join(directory, name),
        project.slug,
      );
      if (copied) return copied;
    }
  }
  return null;
}

async function loadTypeScriptModule(relativePath) {
  const sourcePath = path.join(projectRoot, relativePath);
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

async function loadSidebarBuilder() {
  return (await loadTypeScriptModule(path.join("src", "utils", "sidebar.ts")))
    .buildSidebar;
}

async function loadVibtoolsConfigHelpers() {
  return loadTypeScriptModule(path.join("src", "utils", "vibtoolsConfig.ts"));
}

async function syncProject(
  registryEntry,
  siteConfig,
  buildSidebar,
  vibtoolsHelpers,
  token,
  reservedSlugs,
) {
  let contentDirectory;
  let temporaryDirectory;
  let projectSlugForCleanup;
  try {
    let sourceDirectory;
    let repoRootForMetadata = null;
    let remoteConfig = null;
    let clonedBranch = null;

    const candidateDerivedSlug =
      registryEntry.slug ||
      vibtoolsHelpers.deriveSlugFromSource(
        registryEntry.repoUrl,
        registryEntry.localPath,
      );

    if (registryEntry.localPath) {
      const resolvedLocal = path.resolve(projectRoot, registryEntry.localPath);
      assertWithin(projectRoot, resolvedLocal, "localPath");
      const localVibtools = await readVibtoolsConfigFromRoot(
        resolvedLocal,
        vibtoolsHelpers,
      );
      if (localVibtools) {
        remoteConfig = localVibtools;
        repoRootForMetadata = resolvedLocal;
      } else {
        sourceDirectory = resolvedLocal;
        repoRootForMetadata =
          registryEntry.localPath === "." ? projectRoot : null;
      }
    } else if (
      candidateDerivedSlug === "docscaffold" &&
      typeof registryEntry.repoUrl === "string" &&
      /^https:\/\/github\.com\/vibtoolshq\/docscaffold(?:\.git)?\/?$/i.test(registryEntry.repoUrl.trim())
    ) {
      const selfVibtools = await readVibtoolsConfigFromRoot(
        projectRoot,
        vibtoolsHelpers,
      );
      if (selfVibtools) {
        remoteConfig = selfVibtools;
        repoRootForMetadata = projectRoot;
      } else {
        const selfDocsCandidate = path.resolve(
          projectRoot,
          registryEntry.docsPath || "docs",
        );
        assertWithin(projectRoot, selfDocsCandidate, "docsPath");
        const stat = await fs.lstat(selfDocsCandidate).catch(() => null);
        if (stat?.isDirectory()) {
          sourceDirectory = selfDocsCandidate;
          repoRootForMetadata = projectRoot;
        }
      }
    } else if (
      typeof registryEntry.repoUrl === "string" &&
      registryEntry.repoUrl.includes("YOUR_ORG")
    ) {
      const isStrictCi =
        process.env.CF_PAGES === "1" ||
        process.env.CF_PAGES === "true" ||
        process.env.STRICT_SYNC === "1" ||
        process.env.STRICT_SYNC === "true" ||
        process.argv.includes("--strict");
      if (isStrictCi) {
        throw new Error(
          `Starter placeholder repoUrl "${registryEntry.repoUrl}" is not allowed in production/CI builds (CF_PAGES / STRICT_SYNC). Replace YOUR_ORG in config/projects.json with a real repository URL.`,
        );
      }
      const defaultLocalDocsCandidate = path.resolve(projectRoot, "docs");
      assertWithin(projectRoot, defaultLocalDocsCandidate, "docs");
      const stat = await fs.lstat(defaultLocalDocsCandidate).catch(() => null);
      if (stat?.isDirectory()) {
        console.warn(
          `Warning [${candidateDerivedSlug || registryEntry.repoUrl}]: repoUrl uses starter placeholder (${registryEntry.repoUrl}); using local ./docs fixture for smoke build.`,
        );
        sourceDirectory = defaultLocalDocsCandidate;
      }
    }

    if (!sourceDirectory && !remoteConfig) {
      temporaryDirectory = await fs.mkdtemp(
        path.join(os.tmpdir(), "vib-docs-sync-"),
      );
      const checkoutDirectory = path.join(temporaryDirectory, "checkout");
      clonedBranch = registryEntry.branch || "main";
      await cloneMetadataFirst(
        registryEntry,
        checkoutDirectory,
        token,
        vibtoolsHelpers.VIBTOOLS_DIR,
      );
      remoteConfig = await readVibtoolsConfigFromRoot(
        checkoutDirectory,
        vibtoolsHelpers,
      );
      repoRootForMetadata = checkoutDirectory;
    }

    const resolution = vibtoolsHelpers.resolvePortalProjectConfig({
      portalType: siteConfig.portalType || "all",
      registryEntry,
      remoteConfig,
      defaultAccent: siteConfig.defaultAccent,
    });

    if (!resolution.matched) {
      return {
        status: "skipped",
        reason: resolution.reason,
        label:
          registryEntry.slug ||
          candidateDerivedSlug ||
          registryEntry.repoUrl ||
          registryEntry.localPath ||
          "unknown",
      };
    }

    const project = resolution.project;
    if (reservedSlugs.has(project.slug)) {
      throw new Error(
        `Duplicate resolved slug "${project.slug}" (conflict across repositories or overrides)`,
      );
    }
    reservedSlugs.add(project.slug);
    projectSlugForCleanup = project.slug;
    contentDirectory = path.join(docsOutput, project.slug);

    if (!sourceDirectory && repoRootForMetadata) {
      const targetDocsDirectory = path.resolve(
        repoRootForMetadata,
        project.docsPath,
      );
      assertWithin(repoRootForMetadata, targetDocsDirectory, "docsPath");

      if (temporaryDirectory) {
        if (clonedBranch && project.branch !== clonedBranch) {
          switchGitSparseBranch(repoRootForMetadata, project.branch, [
            token,
            registryEntry.secretKey,
            registryEntry.gitToken,
            resolveSecretValue(registryEntry.secretKey),
            resolveSecretValue(registryEntry.gitToken),
          ]);
        }
        const extraPaths = [project.docsPath];
        if (project.logoPath) {
          const logoDir = path.posix.dirname(project.logoPath);
          if (logoDir && logoDir !== ".") {
            extraPaths.push(logoDir);
          }
        }
        addGitSparsePaths(repoRootForMetadata, extraPaths);
      }

      sourceDirectory = targetDocsDirectory;
    }

    await copyTree(sourceDirectory, contentDirectory);
    await normalizeDocsTree(contentDirectory);
    const indexPath = await resolveRootIndexPath(contentDirectory);

    const indexSource = await fs.readFile(indexPath, "utf8");
    const parsedIndex = matter(indexSource);
    const frontmatter = parsedIndex.data;
    const extracted = vibtoolsHelpers.extractMarkdownMetadata(indexSource);
    const title =
      project.title ||
      metadataString(frontmatter.title, "title", project) ||
      extracted.title ||
      titleFromMarkdown(parsedIndex.content) ||
      formatSlug(project.slug);
    const description =
      metadataString(frontmatter.description, "description", project) ||
      project.description ||
      extracted.description ||
      "";
    const version =
      metadataString(frontmatter.version, "version", project) ||
      (project.version === undefined ? "" : String(project.version)) ||
      extracted.version ||
      "";
    const logoUrl = await findLogo(
      contentDirectory,
      project,
      repoRootForMetadata,
    );
    const navigation = await buildSidebar({
      docsRoot: contentDirectory,
      projectSlug: project.slug,
      readDirectory: (directory) =>
        fs.readdir(directory, { withFileTypes: true }),
      readTextFile: (filePath) => fs.readFile(filePath, "utf8"),
      parseFrontmatter: (source) => matter(source).data,
      joinPath: path.join,
    });
    const {
      localPath,
      secretKey,
      gitToken,
      gitTokenEnv,
      gitUsername,
      logoPath,
      docsType,
      ...manifestProject
    } = project;

    return {
      status: "synced",
      project: {
        ...manifestProject,
        title,
        description,
        version,
        logoUrl,
        sidebar: navigation.sidebar,
        flatPages: navigation.flatPages,
      },
    };
  } catch (error) {
    if (contentDirectory) {
      await fs.rm(contentDirectory, { recursive: true, force: true });
    }
    if (projectSlugForCleanup) {
      await fs.rm(path.join(logosOutput, `${projectSlugForCleanup}.svg`), {
        force: true,
      });
      await fs.rm(path.join(logosOutput, `${projectSlugForCleanup}.png`), {
        force: true,
      });
    }
    throw error;
  } finally {
    if (temporaryDirectory)
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const rawSiteConfig = parseJsonFile(siteConfigPath);
  const siteResult = siteConfigSchema.safeParse(rawSiteConfig);
  if (!siteResult.success) {
    throw new Error(
      `Invalid config/site.config.json: ${siteResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
  }
  const siteConfig = siteResult.data;
  const preservedLogos = new Set([".gitkeep", "vib-tools.png"]);
  if (siteConfig.brandLogo.startsWith("/logos/")) {
    preservedLogos.add(path.posix.basename(siteConfig.brandLogo));
  }

  await Promise.all([
    clearOutputDirectory(docsOutput),
    clearOutputDirectory(logosOutput, preservedLogos),
    clearOutputDirectory(generatedOutput),
  ]);
  const rawProjects = parseJsonFile(projectsConfigPath);
  if (!Array.isArray(rawProjects))
    throw new Error("config/projects.json must contain a JSON array");

  const [buildSidebar, vibtoolsHelpers] = await Promise.all([
    loadSidebarBuilder(),
    loadVibtoolsConfigHelpers(),
  ]);

  const registryEntries = rawProjects.map((entry, index) => {
    const normalized = vibtoolsHelpers.normalizeRegistryEntry(entry);
    if (!normalized.success) {
      throw new Error(
        `Invalid project at config/projects.json[${index}]: ${normalized.error}`,
      );
    }
    return normalized.data;
  });

  const explicitSlugs = new Set();
  for (const entry of registryEntries) {
    if (entry.slug) {
      if (explicitSlugs.has(entry.slug))
        throw new Error(`Duplicate project slug: ${entry.slug}`);
      explicitSlugs.add(entry.slug);
    }
  }

  const syncedProjects = [];
  const reservedSlugs = new Set();
  let failedCount = 0;
  let skippedCount = 0;
  const token = process.env.GIT_TOKEN;

  for (const entry of registryEntries) {
    try {
      const outcome = await syncProject(
        entry,
        siteConfig,
        buildSidebar,
        vibtoolsHelpers,
        token,
        reservedSlugs,
      );
      if (outcome.status === "skipped") {
        skippedCount += 1;
        console.log(`Skipped ${outcome.label} (${outcome.reason})`);
      } else {
        syncedProjects.push(outcome.project);
        console.log(`Synced ${outcome.project.slug}`);
      }
    } catch (error) {
      failedCount += 1;
      const secretsToRedact = [
        token,
        entry.secretKey,
        entry.gitToken,
        resolveSecretValue(entry.secretKey),
        resolveSecretValue(entry.gitToken),
      ];
      console.warn(
        `Warning: could not sync ${entry.slug || entry.repoUrl || entry.localPath}: ${sanitizeError(error, secretsToRedact)}`,
      );
    }
  }
  if (registryEntries.length > 0 && syncedProjects.length === 0 && failedCount > 0)
    throw new Error(
      "No projects synced successfully; refusing to write an empty manifest",
    );
  if (registryEntries.length > 0 && syncedProjects.length === 0 && skippedCount === registryEntries.length) {
    console.warn(
      `Warning: all ${skippedCount} configured project(s) were filtered out for portalType "${siteConfig.portalType}".`,
    );
  }

  const categories = [
    ...new Set(syncedProjects.map((project) => project.category)),
  ];
  const manifest = {
    generatedAt: new Date().toISOString(),
    site: siteConfig,
    categories,
    projects: syncedProjects,
  };
  await fs.mkdir(generatedOutput, { recursive: true });
  await fs.writeFile(
    path.join(generatedOutput, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  for (const strayBunLock of ["bun.lock", "bun.lockb"]) {
    await fs.rm(path.join(projectRoot, strayBunLock), { force: true });
  }
  console.log(`Wrote manifest for ${syncedProjects.length} project(s)`);
}

main().catch((error) => {
  console.error(
    `Documentation sync failed: ${sanitizeError(error, [process.env.GIT_TOKEN])}`,
  );
  process.exitCode = 1;
});
