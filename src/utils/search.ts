import type { ManifestProject } from "./manifest";

export interface SearchLinkEntry {
  title: string;
  route: string;
  productSlug: string;
  productTitle: string;
  breadcrumb: string;
}

function humanizeSegment(segment: string): string {
  return decodeURIComponent(segment)
    .replace(/[-_]+/g, " ")
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export function normalizeRoutePath(value: string): string {
  try {
    const url = new URL(value, "https://docs.local");
    const cleaned = url.pathname.replace(/\/+$/, "") || "/";
    return cleaned === "/" ? "/" : `${cleaned}/`;
  } catch {
    return value;
  }
}

export function formatBreadcrumb(routeOrUrl: string, productTitle?: string): string {
  const normalized = normalizeRoutePath(routeOrUrl);
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) return productTitle || "Docs";
  const parts = segments.map((segment, index) =>
    index === 0 && productTitle ? productTitle : humanizeSegment(segment),
  );
  if (parts.length === 1) parts.push("Overview");
  return parts.join(" › ");
}

export function upsertRecentDoc(
  existing: SearchLinkEntry[],
  entry: SearchLinkEntry,
  limit = 3,
): SearchLinkEntry[] {
  const targetRoute = normalizeRoutePath(entry.route);
  const normalizedEntry: SearchLinkEntry = {
    ...entry,
    route: targetRoute,
    breadcrumb: entry.breadcrumb || formatBreadcrumb(targetRoute, entry.productTitle),
  };
  const deduped = existing.filter(
    (item) => normalizeRoutePath(item.route) !== targetRoute,
  );
  return [normalizedEntry, ...deduped].slice(0, Math.max(1, limit));
}

export function buildQuickSuggestions(
  projects: ManifestProject[],
  limit = 5,
): SearchLinkEntry[] {
  const candidates: SearchLinkEntry[] = [];
  const maxPerProject = projects.length > 1 ? 2 : Math.max(1, limit);

  for (const project of projects) {
    const pages = Array.isArray(project.flatPages) ? project.flatPages : [];
    let addedForProject = 0;
    const orderedPages = [
      ...pages.filter((page) => normalizeRoutePath(page.route) !== `/${project.slug}/`),
      ...pages.filter((page) => normalizeRoutePath(page.route) === `/${project.slug}/`),
    ];
    for (const page of orderedPages) {
      if (addedForProject >= maxPerProject) break;
      const route = normalizeRoutePath(page.route);
      candidates.push({
        title: page.title,
        route,
        productSlug: project.slug,
        productTitle: project.title,
        breadcrumb: formatBreadcrumb(route, project.title),
      });
      addedForProject += 1;
    }
  }

  return candidates.slice(0, Math.max(1, limit));
}

export function selectInitialSuggestions(params: {
  suggestions: SearchLinkEntry[];
  recentDocs: SearchLinkEntry[];
  scope: string;
  scopeSlug: string;
  limit?: number;
}): { recent: SearchLinkEntry[]; suggested: SearchLinkEntry[] } {
  const { suggestions, recentDocs, scope, scopeSlug, limit = 4 } = params;
  const scopedFilter = (item: SearchLinkEntry) =>
    scope !== "product" || !scopeSlug || item.productSlug === scopeSlug;

  const recent = recentDocs.filter(scopedFilter).slice(0, 3);
  const recentRoutes = new Set(recent.map((item) => normalizeRoutePath(item.route)));

  const suggested = suggestions
    .filter(scopedFilter)
    .filter((item) => !recentRoutes.has(normalizeRoutePath(item.route)))
    .slice(0, Math.max(1, limit));

  return { recent, suggested };
}
