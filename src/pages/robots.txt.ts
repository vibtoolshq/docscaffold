import type { APIRoute } from "astro";
import siteConfig from "../../config/site.config.json";

export const prerender = true;

export const GET: APIRoute = () => {
  const baseDomain = (/^https?:\/\//i.test(siteConfig.domain)
    ? siteConfig.domain
    : `https://${siteConfig.domain}`
  ).replace(/\/+$/, "");
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /pagefind/",
    "",
    `Sitemap: ${baseDomain}/sitemap-index.xml`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
