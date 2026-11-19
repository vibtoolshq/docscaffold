import type { CollectionEntry } from "astro:content";
import matter from "gray-matter";
import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { FlatPage, ManifestProject, SiteConfig } from "./manifest";
import { resolveAbsoluteUrl } from "./seo";
import { VIBTOOLS_SCHEMA_PATH } from "./vibtoolsConfig";

export interface ResolvedDocPage {
  page: FlatPage;
  entry: CollectionEntry<"docs">;
}

export function routeToMarkdownSlug(route: string): string {
  const segments = route.split("/").filter(Boolean).slice(1);
  return segments.length > 0 ? segments.join("/") : "index";
}

export function routeToMarkdownPath(route: string, productSlug: string): string {
  return `/${encodeURIComponent(productSlug)}/${routeToMarkdownSlug(route)}.md`;
}

export function resolveProductEntries(
  project: ManifestProject,
  entries: CollectionEntry<"docs">[],
): ResolvedDocPage[] {
  const projectPrefix = `${project.slug}/`;
  const contentRoot = resolve(
    process.cwd(),
    "src",
    "content",
    "docs",
    project.slug,
  );
  const orderedSources = project.flatPages;

  return entries
    .flatMap((entry) => {
      if (entry.data.draft === true) return [];
      const normalizedId = entry.id.replace(/\\/g, "/");
      if (
        normalizedId !== project.slug &&
        !normalizedId.startsWith(projectPrefix)
      ) {
        return [];
      }

      const sourcePath = entry.filePath
        ? relative(contentRoot, resolve(entry.filePath)).split(sep).join("/")
        : normalizedId === project.slug
          ? "index.md"
          : normalizedId.slice(projectPrefix.length);

      const page = orderedSources.find(
        (candidate) => candidate.source.replace(/\\/g, "/") === sourcePath,
      );
      if (!page) return [];
      return [{ page, entry }];
    })
    .sort(
      (left, right) =>
        orderedSources.indexOf(left.page) - orderedSources.indexOf(right.page),
    );
}

export async function readCleanMarkdownBody(
  entry: CollectionEntry<"docs">,
  fallbackTitle: string,
  fallbackDescription?: string,
): Promise<string> {
  let rawSource = entry.body || "";
  if (entry.filePath) {
    try {
      rawSource = await readFile(entry.filePath, "utf8");
    } catch {
      rawSource = entry.body || "";
    }
  }

  const stripped = matter(rawSource).content.trim();
  if (stripped) return stripped;

  const summary = fallbackDescription?.trim() || "Documentation page.";
  return `# ${fallbackTitle}\n\n${summary}`;
}

export function buildRootLlmsText(params: {
  site: SiteConfig;
  categories: string[];
  projects: ManifestProject[];
}): string {
  const { site, categories, projects } = params;
  const fullLlmsUrl = resolveAbsoluteUrl("/llms-full.txt", site.domain);
  const schemaUrl = resolveAbsoluteUrl(VIBTOOLS_SCHEMA_PATH, site.domain);

  const lines = [
    `# ${site.portalTitle}`,
    "",
    `> ${site.portalSubtitle}`,
    "",
    `Domain: ${resolveAbsoluteUrl("/", site.domain)}`,
    `Portal Type: ${site.portalType || "all"}`,
    `Full AI Index: ${fullLlmsUrl}`,
    `.vibtools Config JSON Schema: ${schemaUrl}`,
    "",
    "This portal contains static product documentation powered by Vib Docs Engine. Every documentation page is available as HTML, raw Markdown (`/<product>/<page>.md`), per-product AI bundle (`/<product>/llms.txt`), and portal-wide corpus (`/llms-full.txt`).",
  ];

  for (const category of categories) {
    const categoryProjects = projects.filter(
      (project) => project.category === category,
    );
    if (categoryProjects.length === 0) continue;
    lines.push("", `## ${category}`, "");
    for (const project of categoryProjects) {
      const version = project.version ? ` (v${project.version})` : "";
      const docsUrl = resolveAbsoluteUrl(
        `/${encodeURIComponent(project.slug)}/`,
        site.domain,
      );
      const llmsUrl = resolveAbsoluteUrl(
        `/${encodeURIComponent(project.slug)}/llms.txt`,
        site.domain,
      );
      const rootMdUrl = resolveAbsoluteUrl(
        routeToMarkdownPath(`/${project.slug}/`, project.slug),
        site.domain,
      );
      lines.push(
        `- [${project.title}${version}](${docsUrl}) - ${project.description || "Product documentation."} ([AI index](${llmsUrl}) | [Markdown](${rootMdUrl}))`,
      );
      for (const page of project.flatPages ?? []) {
        const pageUrl = resolveAbsoluteUrl(page.route, site.domain);
        const pageMdUrl = resolveAbsoluteUrl(
          routeToMarkdownPath(page.route, project.slug),
          site.domain,
        );
        lines.push(
          `  - [${page.title}](${pageUrl}) ([Markdown](${pageMdUrl}))`,
        );
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function buildProductLlmsText(
  project: ManifestProject,
  pageEntries: ResolvedDocPage[],
  domain: string,
): Promise<string> {
  const canonicalProjectUrl = resolveAbsoluteUrl(
    `/${encodeURIComponent(project.slug)}/`,
    domain,
  );
  const rootMdUrl = resolveAbsoluteUrl(
    routeToMarkdownPath(`/${project.slug}/`, project.slug),
    domain,
  );
  const schemaUrl = resolveAbsoluteUrl(VIBTOOLS_SCHEMA_PATH, domain);
  const lines = [
    `# ${project.title}`,
    "",
    project.description || "Product documentation.",
    "",
    `Version: ${project.version || "Not specified"}`,
    `Documentation: ${canonicalProjectUrl}`,
    `Markdown Entry: ${rootMdUrl}`,
    `.vibtools Config JSON Schema: ${schemaUrl}`,
    "",
    "## Pages",
    "",
  ];

  for (const { page } of pageEntries) {
    const pageUrl = resolveAbsoluteUrl(page.route, domain);
    const mdUrl = resolveAbsoluteUrl(
      routeToMarkdownPath(page.route, project.slug),
      domain,
    );
    lines.push(`- [${page.title}](${pageUrl}) ([Markdown](${mdUrl}))`);
  }

  lines.push("", "## Full documentation", "");
  for (const { page, entry } of pageEntries) {
    const pageUrl = resolveAbsoluteUrl(page.route, domain);
    const cleanBody = await readCleanMarkdownBody(
      entry,
      page.title,
      entry.data.description,
    );
    lines.push(`<!-- ${pageUrl} -->`, "", cleanBody, "");
  }

  return `${lines.join("\n")}\n`;
}

export async function buildRootLlmsFullText(params: {
  site: SiteConfig;
  projects: ManifestProject[];
  entries: CollectionEntry<"docs">[];
}): Promise<string> {
  const { site, projects, entries } = params;
  const schemaUrl = resolveAbsoluteUrl(VIBTOOLS_SCHEMA_PATH, site.domain);
  const lines = [
    `# ${site.portalTitle} — Complete Documentation`,
    "",
    `> ${site.portalSubtitle}`,
    "",
    `Portal: ${resolveAbsoluteUrl("/", site.domain)}`,
    `Portal Type: ${site.portalType || "all"}`,
    `.vibtools Config JSON Schema: ${schemaUrl}`,
    "",
  ];

  for (const project of projects) {
    const pageEntries = resolveProductEntries(project, entries);
    const projectUrl = resolveAbsoluteUrl(
      `/${encodeURIComponent(project.slug)}/`,
      site.domain,
    );
    lines.push(
      `---`,
      "",
      `## ${project.title}${project.version ? ` (v${project.version})` : ""}`,
      "",
      project.description || "Product documentation.",
      `URL: ${projectUrl}`,
      "",
    );

    for (const { page, entry } of pageEntries) {
      const pageUrl = resolveAbsoluteUrl(page.route, site.domain);
      const cleanBody = await readCleanMarkdownBody(
        entry,
        page.title,
        entry.data.description,
      );
      lines.push(`<!-- ${pageUrl} -->`, "", cleanBody, "");
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function buildSingleDocMarkdownText(params: {
  project: ManifestProject;
  page: FlatPage;
  entry: CollectionEntry<"docs">;
  domain: string;
}): Promise<string> {
  const { project, page, entry, domain } = params;
  const pageUrl = resolveAbsoluteUrl(page.route, domain);
  const title = entry.data.title || page.title;
  const cleanBody = await readCleanMarkdownBody(
    entry,
    title,
    entry.data.description,
  );
  const hasH1 = /^#\s+\S/m.test(cleanBody);
  const parts = [`<!-- Source: ${pageUrl} | Product: ${project.title} -->`, ""];
  if (!hasH1) {
    parts.push(`# ${title}`, "");
  }
  parts.push(cleanBody, "");
  return parts.join("\n");
}
