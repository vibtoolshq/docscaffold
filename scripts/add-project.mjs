import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const projectsPath = path.join(projectRoot, "config", "projects.json");
const temporaryProjectsPath = `${projectsPath}.${process.pid}.tmp`;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const hexColorPattern =
  /^#(?:[\da-fA-F]{3}|[\da-fA-F]{4}|[\da-fA-F]{6}|[\da-fA-F]{8})$/;

const usage = `Usage:
  npm run add-project
  npm run add-project -- --url <repoUrl> [options]

Options (for quick .vibtools/ or override registration):
  --url, --repo <url>       Credential-free Git HTTPS/SSH repository URL
  --slug <slug>             Optional URL slug override
  --category <name>         Optional Hub category override
  --branch <branch>         Optional branch override
  --accent <hex>            Optional hex accent color override
  --docs-path <path>        Optional relative docs path override
  --docs-type <type>        Optional portal filter (users | developer | both)
  --secret-key <value>      Optional private repo token or $ENV_VAR name
  --git-username <user>     Optional Git token username
  --cta-label <label>       Optional CTA label (requires --cta-url)
  --cta-url <url>           Optional CTA HTTP(S) URL
  -h, --help                Show this help message`;

async function loadVibtoolsConfigHelpers() {
  const sourcePath = path.join(
    projectRoot,
    "src",
    "utils",
    "vibtoolsConfig.ts",
  );
  const source = await readFile(sourcePath, "utf8");
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

function parseCliArgs(args, vibtoolsHelpers) {
  const options = {};
  const valueFlags = new Set([
    "url",
    "repo",
    "slug",
    "category",
    "branch",
    "accent",
    "docs-path",
    "docs-type",
    "secret-key",
    "git-username",
    "cta-label",
    "cta-url",
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-h" || arg === "--help") {
      return { help: true };
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument "${arg}".\n\n${usage}`);
    }
    const eqIndex = arg.indexOf("=");
    const flagName = eqIndex >= 0 ? arg.slice(2, eqIndex) : arg.slice(2);
    if (!valueFlags.has(flagName)) {
      throw new Error(`Unknown option "--${flagName}".\n\n${usage}`);
    }
    let value;
    if (eqIndex >= 0) {
      value = arg.slice(eqIndex + 1);
    } else {
      value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for "--${flagName}".\n\n${usage}`);
      }
      index += 1;
    }

    const mappedKey =
      flagName === "repo"
        ? "url"
        : flagName === "accent"
          ? "accentColor"
          : flagName === "docs-path"
            ? "docsPath"
            : flagName === "docs-type"
              ? "docsType"
              : flagName === "secret-key"
                ? "secretKey"
                : flagName === "git-username"
                  ? "gitUsername"
                  : flagName === "cta-label"
                    ? "ctaLabel"
                    : flagName === "cta-url"
                      ? "ctaUrl"
                      : flagName;
    options[mappedKey] = value.trim();
  }

  if (options.url) {
    const check = vibtoolsHelpers.validateRepoUrl(options.url, "--url");
    if (!check.ok) throw new Error(check.error);
    options.repoUrl = check.value;
    delete options.url;
  } else if (Object.keys(options).length > 0) {
    throw new Error(`"--url <repoUrl>" is required when using CLI flags.\n\n${usage}`);
  }

  return { help: false, options };
}

function collectExistingEntries(projects, vibtoolsHelpers) {
  const existingRepos = new Map();
  const existingSlugs = new Set();

  for (const rawEntry of projects) {
    const normalized = vibtoolsHelpers.normalizeRegistryEntry(rawEntry);
    if (!normalized.success) continue;
    const entry = normalized.data;
    const resolvedSlug =
      entry.slug ||
      vibtoolsHelpers.deriveSlugFromSource(entry.repoUrl, entry.localPath);
    if (resolvedSlug) existingSlugs.add(resolvedSlug);

    const repoKey = canonicalRepoKey(entry.repoUrl);
    if (repoKey) {
      if (!existingRepos.has(repoKey)) existingRepos.set(repoKey, []);
      existingRepos.get(repoKey).push(entry.slug || resolvedSlug || "");
    }
  }

  return { existingRepos, existingSlugs };
}

function assertNoDuplicateEntry(
  candidateEntry,
  existingRepos,
  existingSlugs,
  vibtoolsHelpers,
) {
  const candidateSlug =
    candidateEntry.slug ||
    vibtoolsHelpers.deriveSlugFromSource(
      candidateEntry.repoUrl,
      candidateEntry.localPath,
    );

  if (candidateEntry.slug && existingSlugs.has(candidateEntry.slug)) {
    throw new Error(
      `Slug "${candidateEntry.slug}" already exists in config/projects.json. Choose another.`,
    );
  }

  if (candidateEntry.repoUrl) {
    const repoKey = canonicalRepoKey(candidateEntry.repoUrl);
    if (repoKey && existingRepos.has(repoKey)) {
      if (!candidateEntry.slug) {
        throw new Error(
          `Repository URL "${candidateEntry.repoUrl}" already exists in config/projects.json (pass a distinct --slug override if registering a second target from the same repo).`,
        );
      }
      const existingRepoSlugs = existingRepos.get(repoKey);
      if (existingRepoSlugs.includes(candidateEntry.slug)) {
        throw new Error(
          `Repository URL "${candidateEntry.repoUrl}" already uses slug "${candidateEntry.slug}".`,
        );
      }
    }
  }

  if (!candidateEntry.slug && candidateSlug && existingSlugs.has(candidateSlug)) {
    throw new Error(
      `Derived slug "${candidateSlug}" already conflicts with an existing entry in config/projects.json. Pass a unique --slug override.`,
    );
  }
}

async function askUntil(readline, label, validate, initialValue = "") {
  while (true) {
    const answer =
      (
        await readline.question(
          `${label}${initialValue ? ` [${initialValue}]` : ""}: `,
        )
      ).trim() || initialValue;
    const error = validate(answer);
    if (!error) return answer;
    stdout.write(`${error}\n`);
  }
}

async function createPromptReader() {
  const readline = createInterface({ input: stdin, output: stdout });
  if (stdin.isTTY) return { readline, prompts: readline };

  const answers = [];
  for await (const answer of readline) answers.push(answer);
  const prompts = {
    question: async (label) => {
      stdout.write(label);
      if (answers.length === 0)
        throw new Error("Not enough input values were provided.");
      return answers.shift();
    },
  };
  return { readline, prompts };
}

function validateDocsPath(value) {
  const trimmed = value.trim().replace(/^[\\/]+|[\\/]+$/g, "");
  if (!trimmed) return "Documentation path cannot be empty.";
  if (path.isAbsolute(value) || /^[\\/]|^[a-zA-Z]:/.test(value)) {
    return "Documentation path must be a relative path inside the repository.";
  }
  const segments = trimmed.split(/[\\/]+/).filter(Boolean);
  if (
    segments.length === 0 ||
    segments.includes("..") ||
    segments.includes(".")
  ) {
    return "Documentation path cannot contain '.' or '..' segments.";
  }
  return "";
}

async function resolveLocalPath(value) {
  if (!value || path.isAbsolute(value) || value.split(/[\\/]/).includes(".."))
    return null;
  const absolutePath = path.resolve(projectRoot, value);
  const relativePath = path.relative(projectRoot, absolutePath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  )
    return null;
  try {
    if (!(await stat(absolutePath)).isDirectory()) return null;
  } catch {
    return null;
  }
  return `./${relativePath.split(path.sep).join("/")}`;
}

function buildCompactCliRecord(options, vibtoolsHelpers) {
  const overrideKeys = [
    "slug",
    "category",
    "branch",
    "accentColor",
    "docsPath",
    "docsType",
    "secretKey",
    "gitUsername",
    "ctaLabel",
    "ctaUrl",
  ];
  const hasAnyExtra = overrideKeys.some((key) => Boolean(options[key]));

  if (!hasAnyExtra) {
    return {
      storageValue: options.repoUrl,
      normalized: { repoUrl: options.repoUrl },
      displayLabel:
        vibtoolsHelpers.deriveSlugFromSource(options.repoUrl) || options.repoUrl,
    };
  }

  const record = { repoUrl: options.repoUrl };
  if (options.slug) record.slug = options.slug;
  if (options.category) record.category = options.category;
  if (options.branch) record.branch = options.branch;
  if (options.accentColor) record.accentColor = options.accentColor;
  if (options.docsPath) record.docsPath = options.docsPath;
  if (options.docsType) record.docsType = options.docsType;
  if (options.secretKey) record.secretKey = options.secretKey;
  if (options.gitUsername && options.secretKey) {
    record.gitUsername = options.gitUsername;
  }
  if (options.ctaUrl) {
    record.ctaLabel = options.ctaLabel || "View repository";
    record.ctaUrl = options.ctaUrl;
  } else if (options.ctaLabel) {
    throw new Error("--cta-label requires --cta-url.");
  }

  const parsed = vibtoolsHelpers.normalizeRegistryEntry(record);
  if (!parsed.success) {
    throw new Error(parsed.error);
  }

  return {
    storageValue: parsed.data,
    normalized: parsed.data,
    displayLabel:
      parsed.data.slug ||
      vibtoolsHelpers.deriveSlugFromSource(parsed.data.repoUrl) ||
      parsed.data.repoUrl,
  };
}

async function runInteractiveAutoMode(
  prompts,
  existingRepos,
  existingSlugs,
  vibtoolsHelpers,
) {
  const repoUrl = await askUntil(
    prompts,
    "Repository URL (Git HTTPS/SSH)",
    (value) => {
      const check = vibtoolsHelpers.validateRepoUrl(value, "repoUrl");
      if (!check.ok) return check.error;
      const repoKey = canonicalRepoKey(check.value);
      if (repoKey && existingRepos.has(repoKey)) {
        return `Repository URL "${check.value}" already exists. Use Manual mode with a distinct slug override to add a second target.`;
      }
      const derivedSlug = vibtoolsHelpers.deriveSlugFromSource(check.value);
      if (derivedSlug && existingSlugs.has(derivedSlug)) {
        return `Derived slug "${derivedSlug}" already exists. Use Manual mode to choose a unique slug override.`;
      }
      return "";
    },
  );

  const secretKeyInput = (
    await prompts.question(
      "Secret key / Git token for private repo (optional, leave blank for public repo): ",
    )
  ).trim();

  if (!secretKeyInput) {
    return {
      storageValue: repoUrl,
      normalized: { repoUrl },
      displayLabel:
        vibtoolsHelpers.deriveSlugFromSource(repoUrl) || repoUrl,
    };
  }

  const entry = {
    repoUrl,
    secretKey: secretKeyInput,
  };
  const gitUsernameInput = (
    await prompts.question(
      "Git token username (optional, e.g. oauth2 for GitLab, leave blank for auto): ",
    )
  ).trim();
  if (gitUsernameInput) {
    entry.gitUsername = gitUsernameInput;
  }

  return {
    storageValue: entry,
    normalized: entry,
    displayLabel:
      vibtoolsHelpers.deriveSlugFromSource(repoUrl) || repoUrl,
  };
}

async function runInteractiveManualMode(
  prompts,
  projects,
  existingRepos,
  existingSlugs,
  vibtoolsHelpers,
) {
  const slug = await askUntil(
    prompts,
    "Project slug (lowercase letters/numbers/hyphens)",
    (value) => {
      if (!slugPattern.test(value))
        return "Use lowercase letters and numbers separated by single hyphens.";
      if (existingSlugs.has(value))
        return `Slug "${value}" already exists. Choose another.`;
      return "";
    },
  );

  const existingCategories = [
    ...new Set(
      projects
        .map((project) =>
          typeof project === "object" && project ? project.category : "",
        )
        .filter(Boolean),
    ),
  ];
  if (existingCategories.length)
    stdout.write(`Existing categories: ${existingCategories.join(", ")}\n`);
  const category = await askUntil(prompts, "Category", (value) =>
    value ? "" : "Category cannot be empty.",
  );

  let repositoryInput = await askUntil(
    prompts,
    "Repository URL (Git HTTPS/SSH) or local docs path",
    (value) => {
      if (vibtoolsHelpers.isSupportedGitRemote(value)) {
        const check = vibtoolsHelpers.validateRepoUrl(value, "repoUrl");
        if (!check.ok) return check.error;
        const repoKey = canonicalRepoKey(check.value);
        if (
          repoKey &&
          existingRepos.has(repoKey) &&
          existingRepos.get(repoKey).includes(slug)
        ) {
          return `Repository URL "${check.value}" already uses slug "${slug}".`;
        }
        return "";
      }
      return "";
    },
  );
  const branch = await askUntil(
    prompts,
    "Branch",
    (value) => (value ? "" : "Branch cannot be empty."),
    "main",
  );
  const accentColor = await askUntil(
    prompts,
    "Accent color",
    (value) =>
      hexColorPattern.test(value)
        ? ""
        : "Use a 3, 4, 6, or 8 digit hex color such as #2563eb.",
    "#2563eb",
  );
  const docsPathInput = await askUntil(
    prompts,
    "Documentation path in repository",
    validateDocsPath,
    "docs",
  );
  const docsTypeInput = await askUntil(
    prompts,
    "Portal type (users | developer | both)",
    (value) =>
      vibtoolsHelpers.DOCS_TYPES.includes(value)
        ? ""
        : `Choose one of: ${vibtoolsHelpers.DOCS_TYPES.join(", ")}.`,
    "both",
  );
  const project = {
    slug,
    category,
    branch,
    accentColor,
    docsPath: docsPathInput
      .trim()
      .replace(/^[\\/]+|[\\/]+$/g, "")
      .split(/[\\/]+/)
      .join("/"),
    ...(docsTypeInput !== "both" ? { docsType: docsTypeInput } : {}),
  };

  if (vibtoolsHelpers.isSupportedGitRemote(repositoryInput)) {
    project.repoUrl = repositoryInput;
  } else {
    const localPath = await resolveLocalPath(repositoryInput);
    while (!localPath) {
      stdout.write(
        "Local docs path must be an existing directory inside this engine repository, with no '..' segments.\n",
      );
      repositoryInput = (
        await prompts.question("Repository URL or local docs path: ")
      ).trim();
      if (vibtoolsHelpers.isSupportedGitRemote(repositoryInput)) {
        const check = vibtoolsHelpers.validateRepoUrl(
          repositoryInput,
          "repoUrl",
        );
        if (!check.ok) {
          stdout.write(`${check.error}\n`);
          continue;
        }
        project.repoUrl = check.value;
        break;
      }
      const normalizedPath = await resolveLocalPath(repositoryInput);
      if (normalizedPath) {
        project.localPath = normalizedPath;
        break;
      }
    }
    if (localPath) project.localPath = localPath;
  }

  if (project.repoUrl) {
    const secretKeyInput = (
      await prompts.question(
        "Secret key / Git token for private repo (optional, leave blank for public repo): ",
      )
    ).trim();
    if (secretKeyInput) {
      project.secretKey = secretKeyInput;
      const gitUsernameInput = (
        await prompts.question(
          "Git token username (optional, e.g. oauth2 for GitLab, leave blank for auto): ",
        )
      ).trim();
      if (gitUsernameInput) {
        project.gitUsername = gitUsernameInput;
      }
    }
  }

  const ctaLabel = (await prompts.question("CTA label (optional): ")).trim();
  const ctaUrlInput = (
    await prompts.question("CTA URL (optional, HTTP(S)): ")
  ).trim();
  let validCtaUrl = "";
  if (ctaUrlInput) {
    let ctaUrl = ctaUrlInput;
    while (true) {
      try {
        const parsed = new URL(ctaUrl);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          validCtaUrl = ctaUrl;
          break;
        }
      } catch {}
      ctaUrl = (
        await prompts.question("Enter a valid HTTP(S) URL, or leave blank: ")
      ).trim();
      if (!ctaUrl) break;
    }
  }
  if (validCtaUrl) {
    project.ctaLabel = ctaLabel || "View repository";
    project.ctaUrl = validCtaUrl;
  } else if (ctaLabel) {
    stdout.write(
      "CTA URL was left blank; skipping CTA label so CTA configuration stays paired.\n",
    );
  }

  return {
    storageValue: project,
    normalized: project,
    displayLabel: slug,
  };
}

async function writeProjectsAtomically(projects) {
  const formatted = `${JSON.stringify(projects, null, 2)}\n`;
  await writeFile(temporaryProjectsPath, formatted, {
    encoding: "utf8",
    flag: "wx",
  });
  await rename(temporaryProjectsPath, projectsPath);
}

async function main() {
  const vibtoolsHelpers = await loadVibtoolsConfigHelpers();
  const parsedArgs = parseCliArgs(process.argv.slice(2), vibtoolsHelpers);
  if (parsedArgs.help) {
    stdout.write(`${usage}\n`);
    return;
  }

  let projects;
  try {
    projects = JSON.parse(await readFile(projectsPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read config/projects.json: ${error.message}`);
  }
  if (!Array.isArray(projects))
    throw new Error("config/projects.json must contain a JSON array");

  const { existingRepos, existingSlugs } = collectExistingEntries(
    projects,
    vibtoolsHelpers,
  );

  if (parsedArgs.options?.repoUrl) {
    try {
      const prepared = buildCompactCliRecord(
        parsedArgs.options,
        vibtoolsHelpers,
      );
      assertNoDuplicateEntry(
        prepared.normalized,
        existingRepos,
        existingSlugs,
        vibtoolsHelpers,
      );
      projects.push(prepared.storageValue);
      await writeProjectsAtomically(projects);
      stdout.write(`\nAdded ${prepared.displayLabel} to config/projects.json.\n`);
      stdout.write(
        "Next: run `npm run build` to sync and build locally, or commit and push to trigger the connected deployment hook.\n",
      );
    } finally {
      await rm(temporaryProjectsPath, { force: true });
    }
    return;
  }

  const { readline, prompts } = await createPromptReader();
  try {
    const mode = await askUntil(
      prompts,
      "Setup mode: [1] .vibtools/ Auto (repoUrl only)  [2] Manual / Custom overrides",
      (value) =>
        value === "1" || value === "2" ? "" : "Choose 1 (.vibtools/ Auto) or 2 (Manual).",
      "1",
    );

    const prepared =
      mode === "1"
        ? await runInteractiveAutoMode(
            prompts,
            existingRepos,
            existingSlugs,
            vibtoolsHelpers,
          )
        : await runInteractiveManualMode(
            prompts,
            projects,
            existingRepos,
            existingSlugs,
            vibtoolsHelpers,
          );

    assertNoDuplicateEntry(
      prepared.normalized,
      existingRepos,
      existingSlugs,
      vibtoolsHelpers,
    );
    projects.push(prepared.storageValue);
    await writeProjectsAtomically(projects);
    stdout.write(`\nAdded ${prepared.displayLabel} to config/projects.json.\n`);
    stdout.write(
      "Next: run `npm run build` to sync and build locally, or commit and push to trigger the connected deployment hook.\n",
    );
  } finally {
    readline.close();
    await rm(temporaryProjectsPath, { force: true });
  }
}

main().catch((error) => {
  console.error(`add-project failed: ${error.message}`);
  process.exitCode = 1;
});
