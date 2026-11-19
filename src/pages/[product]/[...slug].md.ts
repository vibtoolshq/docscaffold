import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection, getEntry } from "astro:content";
import manifest from "../../generated/manifest.json";
import type { FlatPage, ManifestProject } from "../../utils/manifest";
import {
  buildSingleDocMarkdownText,
  resolveProductEntries,
  routeToMarkdownSlug,
} from "../../utils/llms";

interface Props {
  project: ManifestProject;
  page: FlatPage;
  entryId: string;
}

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
  const entries = await getCollection("docs");
  const paths = [];

  for (const rawProject of manifest.projects) {
    const project = rawProject as unknown as ManifestProject;
    const resolvedPages = resolveProductEntries(project, entries);
    for (const { page, entry } of resolvedPages) {
      paths.push({
        params: {
          product: project.slug,
          slug: routeToMarkdownSlug(page.route),
        },
        props: {
          project,
          page,
          entryId: entry.id,
        },
      });
    }
  }

  return paths;
};

export const GET: APIRoute = async (context) => {
  const { project, page, entryId } = context.props as Props;
  const entry = await getEntry("docs", entryId);
  if (!entry) {
    return new Response("Document not found.", { status: 404 });
  }

  const body = await buildSingleDocMarkdownText({
    project,
    page,
    entry,
    domain: manifest.site.domain,
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
};
