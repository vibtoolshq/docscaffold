import type { SiteConfig } from "./manifest";

export interface BreadcrumbCrumb {
  name: string;
  item?: string;
}

export interface DocJsonLdInput {
  site: Pick<SiteConfig, "domain" | "brandName" | "brandLogo" | "portalTitle" | "portalSubtitle">;
  product: {
    slug: string;
    title: string;
    description?: string;
    version?: string | number;
  };
  pageTitle: string;
  description?: string;
  canonicalPath: string;
  breadcrumbs: BreadcrumbCrumb[];
}

export function resolveOrigin(domain: string): string {
  const trimmed = (domain || "https://docs.vib.tools").trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return withScheme.replace(/\/+$/, "");
  }
}

export function resolveAbsoluteUrl(pathOrUrl: string, domain: string): string {
  const origin = resolveOrigin(domain);
  try {
    return new URL(pathOrUrl, `${origin}/`).href;
  } catch {
    return `${origin}/${String(pathOrUrl || "").replace(/^\/+/, "")}`;
  }
}

export function safeJsonLdStringify(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function buildHubJsonLd(site: SiteConfig): Record<string, unknown> {
  const origin = resolveOrigin(site.domain);
  const sameAs = (site.navLinks ?? [])
    .map((link) => link?.href?.trim())
    .filter((href): href is string => Boolean(href && /^https?:\/\//i.test(href)));

  const organization: Record<string, unknown> = {
    "@type": "Organization",
    "@id": `${origin}/#organization`,
    name: site.brandName,
    url: `${origin}/`,
  };

  if (site.brandLogo) {
    organization.logo = resolveAbsoluteUrl(site.brandLogo, origin);
  }
  if (sameAs.length > 0) {
    organization.sameAs = sameAs;
  }

  const website: Record<string, unknown> = {
    "@type": "WebSite",
    "@id": `${origin}/#website`,
    url: `${origin}/`,
    name: site.portalTitle,
    description: site.portalSubtitle,
    publisher: { "@id": `${origin}/#organization` },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${origin}/?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };

  return {
    "@context": "https://schema.org",
    "@graph": [organization, website],
  };
}

export function buildDocJsonLd(input: DocJsonLdInput): Record<string, unknown> {
  const { site, product, pageTitle, description, canonicalPath, breadcrumbs } = input;
  const origin = resolveOrigin(site.domain);
  const canonicalUrl = resolveAbsoluteUrl(canonicalPath, origin);
  const versionText = product.version === undefined ? "" : String(product.version).trim();

  const about: Record<string, unknown> = {
    "@type": "SoftwareApplication",
    name: product.title,
  };
  if (versionText) {
    about.softwareVersion = versionText;
  }

  const techArticle: Record<string, unknown> = {
    "@type": "TechArticle",
    headline: pageTitle,
    description: description?.trim() || product.description?.trim() || site.portalSubtitle,
    url: canonicalUrl,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": canonicalUrl,
    },
    isPartOf: {
      "@type": "WebSite",
      "@id": `${origin}/#website`,
      name: site.portalTitle,
    },
    about,
    publisher: {
      "@type": "Organization",
      "@id": `${origin}/#organization`,
      name: site.brandName,
      url: `${origin}/`,
    },
  };

  const itemListElement = breadcrumbs.map((crumb, index) => {
    const entry: Record<string, unknown> = {
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
    };
    if (crumb.item) {
      entry.item = resolveAbsoluteUrl(crumb.item, origin);
    }
    return entry;
  });

  const breadcrumbList: Record<string, unknown> = {
    "@type": "BreadcrumbList",
    itemListElement,
  };

  return {
    "@context": "https://schema.org",
    "@graph": [techArticle, breadcrumbList],
  };
}
