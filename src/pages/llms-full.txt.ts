import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import manifest from "../generated/manifest.json";
import type { ManifestProject, SiteConfig } from "../utils/manifest";
import { buildRootLlmsFullText } from "../utils/llms";

export const prerender = true;

export const GET: APIRoute = async () => {
  const entries = await getCollection("docs");
  const body = await buildRootLlmsFullText({
    site: manifest.site as SiteConfig,
    projects: manifest.projects as ManifestProject[],
    entries,
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
};
