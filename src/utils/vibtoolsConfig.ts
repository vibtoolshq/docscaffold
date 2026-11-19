export const PORTAL_TYPES = ["users", "developer", "all"] as const;
export type PortalType = (typeof PORTAL_TYPES)[number];

export const DOCS_TYPES = ["users", "developer", "both"] as const;
export type DocsType = (typeof DOCS_TYPES)[number];

export const VIBTOOLS_DIR = ".vibtools";
export const VIBTOOLS_CONFIG_FILENAMES = ["docs.config.json", "config.docs.json"] as const;
export const VIBTOOLS_SCHEMA_PATH = "/schemas/vibtools-docs.schema.json";
export const DEFAULT_DOCS_PATH = "docs";
export const DEFAULT_BRANCH = "main";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_COLOR_PATTERN = /^#(?:[\da-fA-F]{3}|[\da-fA-F]{4}|[\da-fA-F]{6}|[\da-fA-F]{8})$/;

export interface VibtoolsTargetConfig {
  slug?: string;
  title?: string;
  category?: string;
  description?: string;
  version?: string;
  accentColor?: string;
  docsPath?: string;
  logoPath?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  branch?: string;
}

export interface VibtoolsRepoConfig extends VibtoolsTargetConfig {
  $schema?: string;
  schemaVersion?: 1;
  docsType?: DocsType;
  targets?: {
    users?: VibtoolsTargetConfig;
    developer?: VibtoolsTargetConfig;
  };
}

export interface RegistryProjectInput extends VibtoolsTargetConfig {
  repoUrl?: string;
  localPath?: string;
  secretKey?: string;
  gitToken?: string;
  gitTokenEnv?: string;
  gitUsername?: string;
  docsType?: DocsType;
}

export interface ResolvedProjectConfig {
  slug: string;
  category: string;
  accentColor: string;
  repoUrl?: string;
  localPath?: string;
  secretKey?: string;
  gitToken?: string;
  gitTokenEnv?: string;
  gitUsername?: string;
  branch: string;
  docsPath: string;
  logoPath?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  title?: string;
  description?: string;
  version?: string;
  docsType: DocsType;
}

export type ResolvePortalResult =
  | { matched: true; project: ResolvedProjectConfig }
  | { matched: false; reason: string };

export interface ExtractedMarkdownMetadata {
  title: string;
  description: string;
  version: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeRelativeRepoPath(
  value: unknown,
  field: string,
  allowSingleDot = false,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: `${field} must be a string` };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false, error: `${field} must not be empty` };
  }
  if (trimmed.includes("\\") || trimmed.startsWith("/") || /^[a-zA-Z]:/.test(trimmed)) {
    return { ok: false, error: `${field} must be a relative POSIX path inside the repository` };
  }
  const normalized = trimmed.replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (!normalized || (!allowSingleDot && normalized === ".")) {
    return { ok: false, error: `${field} must point to a concrete relative path` };
  }
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return { ok: false, error: `${field} must not contain '.' or '..' traversal segments` };
  }
  return { ok: true, value: segments.join("/") };
}

export function isSupportedGitRemote(value: string): boolean {
  return (
    /^https:\/\//i.test(value) ||
    /^ssh:\/\//i.test(value) ||
    /^[^@\s]+@[^:\s]+:.+/.test(value)
  );
}

export function validateRepoUrl(value: unknown, field = "repoUrl"): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, error: `${field} must be a non-empty string` };
  }
  const trimmed = value.trim();
  if (!isSupportedGitRemote(trimmed)) {
    return { ok: false, error: `${field} must use HTTPS or SSH Git transport` };
  }
  if (/^https:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.username || parsed.password) {
        return {
          ok: false,
          error: `${field} must not contain embedded credentials; use secretKey or GIT_TOKEN instead`,
        };
      }
    } catch {
      return { ok: false, error: `${field} is not a valid HTTPS URL` };
    }
  }
  return { ok: true, value: trimmed };
}

function validateHttpUrl(value: unknown, field: string): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, error: `${field} must be a valid HTTP or HTTPS URL` };
  }
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, error: `${field} must use HTTP or HTTPS` };
    }
    return { ok: true, value: trimmed };
  } catch {
    return { ok: false, error: `${field} must be a valid HTTP or HTTPS URL` };
  }
}

function parseOptionalNonEmptyString(
  record: Record<string, unknown>,
  field: string,
): { ok: true; value?: string } | { ok: false; error: string } {
  const raw = record[field];
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== "string") {
    return { ok: false, error: `${field} must be a string` };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: `${field} must not be empty` };
  }
  return { ok: true, value: trimmed };
}

function parseTargetFields(
  record: Record<string, unknown>,
  prefix: string,
): { ok: true; data: VibtoolsTargetConfig } | { ok: false; error: string } {
  const data: VibtoolsTargetConfig = {};

  if (record.slug !== undefined) {
    if (typeof record.slug !== "string" || !SLUG_PATTERN.test(record.slug.trim())) {
      return { ok: false, error: `${prefix}slug must be a lowercase URL-safe slug` };
    }
    data.slug = record.slug.trim();
  }

  for (const field of ["title", "category", "description", "ctaLabel", "branch"] as const) {
    const parsed = parseOptionalNonEmptyString(record, field);
    if (!parsed.ok) return { ok: false, error: `${prefix}${parsed.error}` };
    if (parsed.value !== undefined) {
      if (field === "branch" && /[\s\\]|\.\./.test(parsed.value)) {
        return { ok: false, error: `${prefix}branch must not contain whitespace or '..'` };
      }
      data[field] = parsed.value;
    }
  }

  if (record.version !== undefined) {
    if (typeof record.version === "number" && Number.isFinite(record.version)) {
      data.version = String(record.version);
    } else if (typeof record.version === "string" && record.version.trim()) {
      data.version = record.version.trim();
    } else {
      return { ok: false, error: `${prefix}version must be a non-empty string or number` };
    }
  }

  if (record.accentColor !== undefined) {
    if (typeof record.accentColor !== "string" || !HEX_COLOR_PATTERN.test(record.accentColor.trim())) {
      return {
        ok: false,
        error: `${prefix}accentColor must be a valid 3, 4, 6, or 8 digit hexadecimal CSS color`,
      };
    }
    data.accentColor = record.accentColor.trim();
  }

  if (record.docsPath !== undefined) {
    const parsedDocsPath = normalizeRelativeRepoPath(record.docsPath, `${prefix}docsPath`);
    if (!parsedDocsPath.ok) return parsedDocsPath;
    data.docsPath = parsedDocsPath.value;
  }

  if (record.logoPath !== undefined) {
    const parsedLogoPath = normalizeRelativeRepoPath(record.logoPath, `${prefix}logoPath`);
    if (!parsedLogoPath.ok) return parsedLogoPath;
    data.logoPath = parsedLogoPath.value;
  }

  if (record.ctaUrl !== undefined) {
    const parsedUrl = validateHttpUrl(record.ctaUrl, `${prefix}ctaUrl`);
    if (!parsedUrl.ok) return parsedUrl;
    data.ctaUrl = parsedUrl.value;
  }

  return { ok: true, data };
}

export function parseVibtoolsRepoConfig(
  raw: unknown,
): { success: true; data: VibtoolsRepoConfig } | { success: false; error: string } {
  if (!isPlainObject(raw)) {
    return { success: false, error: ".vibtools config must be a JSON object" };
  }

  const base = parseTargetFields(raw, "");
  if (!base.ok) return { success: false, error: base.error };

  const result: VibtoolsRepoConfig = { ...base.data };

  if (raw.$schema !== undefined) {
    if (typeof raw.$schema !== "string" || !raw.$schema.trim()) {
      return { success: false, error: "$schema must be a non-empty string" };
    }
    result.$schema = raw.$schema.trim();
  }

  if (raw.schemaVersion !== undefined) {
    if (raw.schemaVersion !== 1) {
      return { success: false, error: "schemaVersion must be 1" };
    }
    result.schemaVersion = 1;
  }

  if (raw.docsType !== undefined) {
    if (
      typeof raw.docsType !== "string" ||
      !(DOCS_TYPES as readonly string[]).includes(raw.docsType)
    ) {
      return {
        success: false,
        error: `docsType must be one of: ${DOCS_TYPES.join(", ")}`,
      };
    }
    result.docsType = raw.docsType as DocsType;
  }

  if (raw.targets !== undefined) {
    if (!isPlainObject(raw.targets)) {
      return { success: false, error: "targets must be an object with optional users/developer keys" };
    }
    const targetKeys = Object.keys(raw.targets);
    if (targetKeys.length === 0) {
      return { success: false, error: "targets must define at least one of users or developer" };
    }
    for (const key of targetKeys) {
      if (key !== "users" && key !== "developer") {
        return { success: false, error: `Unknown target "${key}" in targets (expected users or developer)` };
      }
    }
    result.targets = {};
    if (raw.targets.users !== undefined) {
      if (!isPlainObject(raw.targets.users)) {
        return { success: false, error: "targets.users must be an object" };
      }
      const usersTarget = parseTargetFields(raw.targets.users, "targets.users.");
      if (!usersTarget.ok) return { success: false, error: usersTarget.error };
      result.targets.users = usersTarget.data;
    }
    if (raw.targets.developer !== undefined) {
      if (!isPlainObject(raw.targets.developer)) {
        return { success: false, error: "targets.developer must be an object" };
      }
      const devTarget = parseTargetFields(raw.targets.developer, "targets.developer.");
      if (!devTarget.ok) return { success: false, error: devTarget.error };
      result.targets.developer = devTarget.data;
    }
  }

  return { success: true, data: result };
}

export function normalizeRegistryEntry(
  rawEntry: unknown,
): { success: true; data: RegistryProjectInput } | { success: false; error: string } {
  if (typeof rawEntry === "string") {
    const repoCheck = validateRepoUrl(rawEntry, "repoUrl");
    if (!repoCheck.ok) return { success: false, error: repoCheck.error };
    return {
      success: true,
      data: {
        repoUrl: repoCheck.value,
      },
    };
  }

  if (!isPlainObject(rawEntry)) {
    return { success: false, error: "Project entry must be a repository URL string or JSON object" };
  }

  const parsedFields = parseTargetFields(rawEntry, "");
  if (!parsedFields.ok) return { success: false, error: parsedFields.error };

  const entry: RegistryProjectInput = { ...parsedFields.data };

  if (rawEntry.repoUrl !== undefined) {
    const repoCheck = validateRepoUrl(rawEntry.repoUrl, "repoUrl");
    if (!repoCheck.ok) return { success: false, error: repoCheck.error };
    entry.repoUrl = repoCheck.value;
  }

  if (rawEntry.localPath !== undefined) {
    const localCheck = normalizeRelativeRepoPath(rawEntry.localPath, "localPath", true);
    if (!localCheck.ok) return { success: false, error: localCheck.error };
    entry.localPath = rawEntry.localPath === "." ? "." : localCheck.value;
  }

  if (!entry.repoUrl && !entry.localPath) {
    return { success: false, error: "repoUrl is required unless localPath is set" };
  }

  for (const authField of ["secretKey", "gitToken", "gitTokenEnv", "gitUsername"] as const) {
    const parsedAuth = parseOptionalNonEmptyString(rawEntry, authField);
    if (!parsedAuth.ok) return { success: false, error: parsedAuth.error };
    if (parsedAuth.value !== undefined) {
      entry[authField] = parsedAuth.value;
    }
  }

  if (rawEntry.docsType !== undefined) {
    if (
      typeof rawEntry.docsType !== "string" ||
      !(DOCS_TYPES as readonly string[]).includes(rawEntry.docsType)
    ) {
      return {
        success: false,
        error: `docsType must be one of: ${DOCS_TYPES.join(", ")}`,
      };
    }
    entry.docsType = rawEntry.docsType as DocsType;
  }

  return { success: true, data: entry };
}

export function deriveSlugFromSource(repoUrl?: string, localPath?: string): string {
  const source = (repoUrl || localPath || "").trim();
  if (!source) return "";
  let tail = "";
  if (/^(?:https|ssh):\/\//i.test(source)) {
    try {
      const pathname = new URL(source).pathname;
      tail = pathname.split("/").filter(Boolean).pop() || "";
    } catch {
      tail = "";
    }
  } else {
    const clean = source.replace(/[:\\]/g, "/");
    tail = clean.split("/").filter(Boolean).pop() || "";
  }
  const normalized = tail
    .replace(/\.git$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return SLUG_PATTERN.test(normalized) ? normalized : "";
}

function selectActiveTarget(
  portalType: PortalType,
  remoteConfig: VibtoolsRepoConfig | null | undefined,
  registryDocsType?: DocsType,
): { matched: true; targetConfig?: VibtoolsTargetConfig; effectiveDocsType: DocsType } | { matched: false; reason: string } {
  if (!remoteConfig) {
    const fallbackType = registryDocsType ?? "both";
    if (portalType === "users" && fallbackType === "developer") {
      return { matched: false, reason: "developer-only entry skipped on users portal" };
    }
    if (portalType === "developer" && fallbackType === "users") {
      return { matched: false, reason: "users-only entry skipped on developer portal" };
    }
    return { matched: true, effectiveDocsType: fallbackType };
  }

  const targets = remoteConfig.targets;
  const declaredDocsType = remoteConfig.docsType;

  if (targets) {
    if (portalType === "users") {
      if (targets.users) {
        return { matched: true, targetConfig: targets.users, effectiveDocsType: "users" };
      }
      if (declaredDocsType === "users" || declaredDocsType === "both") {
        return { matched: true, effectiveDocsType: declaredDocsType };
      }
      return { matched: false, reason: "repository .vibtools targets only developer portal" };
    }

    if (portalType === "developer") {
      if (targets.developer) {
        return { matched: true, targetConfig: targets.developer, effectiveDocsType: "developer" };
      }
      if (declaredDocsType === "developer" || declaredDocsType === "both") {
        return { matched: true, effectiveDocsType: declaredDocsType };
      }
      return { matched: false, reason: "repository .vibtools targets only users portal" };
    }

    if (registryDocsType === "developer" && targets.developer) {
      return { matched: true, targetConfig: targets.developer, effectiveDocsType: "developer" };
    }
    if (registryDocsType === "users" && targets.users) {
      return { matched: true, targetConfig: targets.users, effectiveDocsType: "users" };
    }
    if (targets.users && !targets.developer) {
      return { matched: true, targetConfig: targets.users, effectiveDocsType: "users" };
    }
    if (targets.developer && !targets.users) {
      return { matched: true, targetConfig: targets.developer, effectiveDocsType: "developer" };
    }
    return {
      matched: true,
      targetConfig: targets.users ?? targets.developer,
      effectiveDocsType: declaredDocsType ?? "both",
    };
  }

  const effectiveDocsType = declaredDocsType ?? registryDocsType ?? "both";
  if (portalType === "users" && effectiveDocsType === "developer") {
    return { matched: false, reason: "repository .vibtools docsType is developer-only" };
  }
  if (portalType === "developer" && effectiveDocsType === "users") {
    return { matched: false, reason: "repository .vibtools docsType is users-only" };
  }

  return { matched: true, effectiveDocsType };
}

export function resolvePortalProjectConfig(input: {
  portalType?: PortalType;
  registryEntry: RegistryProjectInput;
  remoteConfig?: VibtoolsRepoConfig | null;
  defaultAccent?: string;
}): ResolvePortalResult {
  const portalType = input.portalType ?? "all";
  const { registryEntry, remoteConfig } = input;
  const targetSelection = selectActiveTarget(portalType, remoteConfig, registryEntry.docsType);
  if (!targetSelection.matched) {
    return targetSelection;
  }

  const targetConfig = targetSelection.targetConfig;
  const pick = <K extends keyof VibtoolsTargetConfig>(key: K): VibtoolsTargetConfig[K] =>
    registryEntry[key] ?? targetConfig?.[key] ?? remoteConfig?.[key];

  const slug =
    pick("slug") ||
    deriveSlugFromSource(registryEntry.repoUrl, registryEntry.localPath);
  if (!slug || !SLUG_PATTERN.test(slug)) {
    return {
      matched: false,
      reason: "could not resolve a valid URL-safe slug from registry or .vibtools config",
    };
  }

  const defaultCategory =
    targetSelection.effectiveDocsType === "developer" ? "Developer Docs" : "Documentation";
  const category = pick("category") || defaultCategory;
  const accentColor = pick("accentColor") || input.defaultAccent || "#7C3AED";
  const branch = pick("branch") || DEFAULT_BRANCH;
  const docsPath = pick("docsPath") || DEFAULT_DOCS_PATH;
  const logoPath = pick("logoPath");
  const title = pick("title");
  const description = pick("description");
  const version = pick("version");
  const rawCtaUrl = pick("ctaUrl");
  const rawCtaLabel = pick("ctaLabel");

  return {
    matched: true,
    project: {
      slug,
      category,
      accentColor,
      repoUrl: registryEntry.repoUrl,
      localPath: registryEntry.localPath,
      secretKey: registryEntry.secretKey,
      gitToken: registryEntry.gitToken,
      gitTokenEnv: registryEntry.gitTokenEnv,
      gitUsername: registryEntry.gitUsername,
      branch,
      docsPath,
      ...(logoPath ? { logoPath } : {}),
      ...(rawCtaUrl ? { ctaUrl: rawCtaUrl, ctaLabel: rawCtaLabel || "Open" } : {}),
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(version ? { version } : {}),
      docsType: targetSelection.effectiveDocsType,
    },
  };
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanExtractedTitle(rawHeading: string): string {
  return rawHeading
    .replace(/\s+#+$/, "")
    .replace(
      /\s*[—–-]\s*(?:user|developer|end-user)?\s*(?:documentation|user\s+guide|developer\s+guide|docs)\s*$/i,
      "",
    )
    .trim();
}

function clampDescription(text: string, maxLength = 160): string {
  if (text.length <= maxLength) return text;
  const firstSentence = /^(.{24,}?[.!?])(?:\s|$)/.exec(text)?.[1];
  if (firstSentence && firstSentence.length <= maxLength) {
    return firstSentence;
  }
  const clipped = text.slice(0, maxLength - 3);
  const lastSpace = clipped.lastIndexOf(" ");
  const boundary = lastSpace > 40 ? clipped.slice(0, lastSpace) : clipped;
  return `${boundary.replace(/[,:;.\s-]+$/, "")}...`;
}

export function extractMarkdownMetadata(markdownSource: string): ExtractedMarkdownMetadata {
  const withoutFrontmatter = markdownSource
    .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  const headingMatch = /^\s*#\s+(.+?)\s*#*\s*$/m.exec(withoutFrontmatter);
  const title = headingMatch?.[1] ? cleanExtractedTitle(headingMatch[1]) : "";

  const lines = withoutFrontmatter.split(/\r?\n/);
  const paragraphLines: string[] = [];
  let inCodeFence = false;
  let startedParagraph = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (/^(?:```|~~~)/.test(trimmed)) {
      if (startedParagraph) break;
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    if (!trimmed) {
      if (startedParagraph) break;
      continue;
    }

    if (/^#{1,6}\s/.test(trimmed)) {
      if (startedParagraph) break;
      continue;
    }

    if (/^(?:---+|===+|\*\*\*+|[-*+]\s|\d+\.\s|>\s|\|)/.test(trimmed)) {
      if (startedParagraph) break;
      continue;
    }

    if (/^(?:!\[|\[\!\[|<img\b|<div\b|<\/div>)/i.test(trimmed)) {
      if (startedParagraph) break;
      continue;
    }

    startedParagraph = true;
    paragraphLines.push(trimmed);
  }

  const plainParagraph = stripInlineMarkdown(paragraphLines.join(" "));
  const description = plainParagraph ? clampDescription(plainParagraph, 160) : "";

  const versionMatch =
    /(?:^|\b)version\s*[:=]\s*v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/im.exec(
      withoutFrontmatter,
    ) ||
    /(?:^|\s)v(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/m.exec(withoutFrontmatter);
  const version = versionMatch?.[1] || "";

  return {
    title,
    description,
    version,
  };
}

export function buildVibtoolsJsonSchema(
  schemaId = "https://docs.vib.tools/schemas/vibtools-docs.schema.json",
): Record<string, unknown> {
  const targetProperties = {
    slug: {
      type: "string",
      pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
      description:
        "Lowercase URL-safe product slug (e.g. 'licenx', 'socketcore'). Defaults to normalized repository name from repoUrl.",
    },
    title: {
      type: "string",
      minLength: 1,
      description:
        "Display title for the product card and navigation header. Falls back to root index.md frontmatter or first # H1 heading.",
    },
    category: {
      type: "string",
      minLength: 1,
      description:
        "Hub filter category label (e.g. 'Desktop Apps', 'Core Engine', 'SDKs & Modules').",
    },
    description: {
      type: "string",
      minLength: 1,
      description:
        "Concise 1-2 sentence product summary for Hub cards, SEO meta description, and llms.txt index.",
    },
    version: {
      type: ["string", "number"],
      description:
        "Displayed release version badge (e.g. '1.2.0'). Leading 'v' is normalized automatically at render time.",
    },
    accentColor: {
      type: "string",
      pattern: "^#(?:[\\da-fA-F]{3}|[\\da-fA-F]{4}|[\\da-fA-F]{6}|[\\da-fA-F]{8})$",
      description:
        "3, 4, 6, or 8 digit hexadecimal CSS accent color (e.g. '#7C3AED' or '#2563EB').",
    },
    docsPath: {
      type: "string",
      minLength: 1,
      default: "docs",
      description:
        "Relative POSIX folder path inside the repository containing index.md or README.md (e.g. 'docs', 'docs/users', 'docs/dev'). No leading '/', '\\', '..', or '.'.",
    },
    logoPath: {
      type: "string",
      minLength: 1,
      description:
        "Relative POSIX file path to a static SVG or PNG product logo under 2 MB (e.g. '.vibtools/logo.png' or '.vibtools/logo.svg').",
    },
    branch: {
      type: "string",
      minLength: 1,
      default: "main",
      description:
        "Git branch to sparse-checkout for documentation (defaults to 'main').",
    },
    ctaLabel: {
      type: "string",
      minLength: 1,
      description:
        "Topbar external action button label (e.g. 'View repository', 'Get License'). Ignored unless ctaUrl is also set.",
    },
    ctaUrl: {
      type: "string",
      format: "uri",
      pattern: "^https?://",
      description:
        "External HTTP or HTTPS URL opened by the topbar CTA button.",
    },
  };

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: schemaId,
    title: "VibToolsDocsConfig",
    description:
      "Canonical repository configuration schema (.vibtools/docs.config.json or .vibtools/config.docs.json) for Vib Docs Engine single-portal and dual-portal (docs.vib.tools & developer.vibtools.io) synchronization.",
    type: "object",
    additionalProperties: false,
    properties: {
      $schema: {
        type: "string",
        description:
          "Optional URI pointing to this JSON Schema (e.g. 'https://docs.vib.tools/schemas/vibtools-docs.schema.json').",
      },
      schemaVersion: {
        const: 1,
        default: 1,
        description: "Schema format version marker. Must be 1 when specified.",
      },
      docsType: {
        type: "string",
        enum: ["users", "developer", "both"],
        default: "both",
        description:
          "Target portal audience: 'users' (docs.vib.tools), 'developer' (developer.vibtools.io), or 'both' (serves both portals).",
      },
      ...targetProperties,
      targets: {
        type: "object",
        minProperties: 1,
        additionalProperties: false,
        description:
          "Optional per-portal overrides allowing a single repository to serve different docsPath, slug, title, category, description, accentColor, logoPath, ctaUrl, or branch to docs.vib.tools ('users') and developer.vibtools.io ('developer').",
        properties: {
          users: { $ref: "#/$defs/target" },
          developer: { $ref: "#/$defs/target" },
        },
      },
    },
    $defs: {
      target: {
        type: "object",
        additionalProperties: false,
        properties: targetProperties,
      },
    },
  };
}
