import type { APIRoute } from "astro";
import manifest from "../generated/manifest.json";
import type { ManifestProject, SiteConfig } from "../utils/manifest";
import { buildRootLlmsText } from "../utils/llms";

export const prerender = true;

export const GET: APIRoute = () => {
  const body = buildRootLlmsText({
    site: manifest.site as SiteConfig,
    categories: manifest.categories,
    projects: manifest.projects as ManifestProject[],
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
};
