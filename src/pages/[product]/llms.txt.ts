import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";
import matter from "gray-matter";
import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import manifest from "../../generated/manifest.json";
import type { FlatPage, ManifestProject } from "../../utils/manifest";

interface Props {
  project: ManifestProject;
}

export const prerender = true;

export const getStaticPaths: GetStaticPaths = () =>
  manifest.projects.map((project) => ({
    params: { product: project.slug },
    props: { project: project as unknown as ManifestProject },
  }));

export const GET: APIRoute = async (context) => {
  const { project } = context.props as Props;
  const entries = await getCollection("docs");
  const projectPrefix = `${project.slug}/`;
  const contentRoot = resolve(
    process.cwd(),
    "src",
    "content",
    "docs",
    project.slug,
  );

  const orderedSources: FlatPage[] = project.flatPages;
  const pageEntries = entries
    .flatMap((entry) => {
      if (entry.data.draft === true) return [];
      const normalizedId = entry.id.replace(/\\/g, "/");
      if (
        normalizedId !== project.slug &&
        !normalizedId.startsWith(projectPrefix)
      )
        return [];
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

  const canonicalProjectUrl = new URL(
    `/${encodeURIComponent(project.slug)}/`,
    manifest.site.domain,
  ).href;
  const lines = [
    `# ${project.title}`,
    "",
    project.description || "Product documentation.",
    "",
    `Version: ${project.version || "Not specified"}`,
    `Documentation: ${canonicalProjectUrl}`,
    "",
    "## Pages",
    "",
  ];

  for (const { page } of pageEntries) {
    const pageUrl = new URL(page.route, manifest.site.domain).href;
    lines.push(`- [${page.title}](${pageUrl})`);
  }

  lines.push("", "## Full documentation", "");
  for (const { page, entry } of pageEntries) {
    const pageUrl = new URL(page.route, manifest.site.domain).href;
    const rawSource = entry.filePath
      ? await readFile(entry.filePath, "utf8")
      : entry.body || "";
    const cleanBody = matter(rawSource).content.trim();
    lines.push(`<!-- ${pageUrl} -->`, "", cleanBody, "");
  }

  return new Response(`${lines.join("\n")}\n`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
};
