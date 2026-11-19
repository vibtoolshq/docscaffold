import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDocJsonLd,
  buildHubJsonLd,
  resolveAbsoluteUrl,
  resolveOrigin,
  safeJsonLdStringify,
} from "./seo";
import type { SiteConfig } from "./manifest";

const sampleSite: SiteConfig = {
  portalTitle: "Vib Tools Documentation",
  portalSubtitle: "Guides and references for building with Vib Tools.",
  domain: "docs.vib.tools",
  brandName: "Vib Tools",
  brandLogo: "/logos/vib-tools.png",
  defaultAccent: "#7C3AED",
  navLinks: [
    { label: "Vib Tools", href: "https://vib.tools" },
    { label: "GitHub", href: "https://github.com/vibtools" },
  ],
};

test("resolveOrigin and resolveAbsoluteUrl add https scheme fallback safely", () => {
  assert.equal(resolveOrigin("docs.vib.tools/"), "https://docs.vib.tools");
  assert.equal(
    resolveAbsoluteUrl("/vib-docs-engine/deployment/", sampleSite.domain),
    "https://docs.vib.tools/vib-docs-engine/deployment/",
  );
});

test("safeJsonLdStringify escapes HTML script tags to prevent breakout", () => {
  const serialized = safeJsonLdStringify({ title: "</script><script>alert(1)</script>&" });
  assert.ok(!serialized.includes("</script>"));
  assert.ok(serialized.includes("\\u003c/script\\u003e"));
  assert.ok(serialized.includes("\\u0026"));
  assert.deepEqual(JSON.parse(serialized), {
    title: "</script><script>alert(1)</script>&",
  });
});

test("buildHubJsonLd outputs Organization and WebSite SearchAction nodes", () => {
  const schema = buildHubJsonLd(sampleSite);
  const graph = schema["@graph"] as Array<Record<string, unknown>>;
  assert.equal(schema["@context"], "https://schema.org");
  assert.equal(graph.length, 2);
  assert.equal(graph[0]["@type"], "Organization");
  assert.equal(graph[0].logo, "https://docs.vib.tools/logos/vib-tools.png");
  assert.equal(graph[1]["@type"], "WebSite");
  const action = graph[1].potentialAction as Record<string, unknown>;
  assert.equal(action["@type"], "SearchAction");
  assert.deepEqual(action.target, {
    "@type": "EntryPoint",
    urlTemplate: "https://docs.vib.tools/?q={search_term_string}",
  });
});

test("buildDocJsonLd outputs TechArticle and ordered BreadcrumbList nodes", () => {
  const schema = buildDocJsonLd({
    site: sampleSite,
    product: {
      slug: "vib-docs-engine",
      title: "Vib Docs Engine",
      description: "Static engine docs.",
      version: "0.1.0",
    },
    pageTitle: "Deployment",
    description: "Deploy to Cloudflare Pages.",
    canonicalPath: "/vib-docs-engine/deployment/",
    breadcrumbs: [
      { name: "Docs", item: "/" },
      { name: "Vib Docs Engine", item: "/vib-docs-engine/" },
      { name: "Deployment", item: "/vib-docs-engine/deployment/" },
    ],
  });

  const graph = schema["@graph"] as Array<Record<string, unknown>>;
  assert.equal(graph[0]["@type"], "TechArticle");
  assert.equal(graph[0].headline, "Deployment");
  assert.deepEqual(graph[0].about, {
    "@type": "SoftwareApplication",
    name: "Vib Docs Engine",
    softwareVersion: "0.1.0",
  });

  const breadcrumbs = graph[1];
  assert.equal(breadcrumbs["@type"], "BreadcrumbList");
  const items = breadcrumbs.itemListElement as Array<Record<string, unknown>>;
  assert.equal(items.length, 3);
  assert.equal(items[0].position, 1);
  assert.equal(items[2].item, "https://docs.vib.tools/vib-docs-engine/deployment/");
});
