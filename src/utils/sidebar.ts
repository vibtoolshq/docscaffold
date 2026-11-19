/**
 * Build a deterministic navigation tree and pagination order from Markdown files.
 * Dependencies are injected so this JavaScript-compatible TypeScript module can
 * be shared by the Node sync script and Astro build-time code.
 */
type DirectoryEntry = {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
};

type SidebarPage = {
  type: "page";
  title: string;
  route: string;
  source: string;
  order?: number;
  numericPrefix?: string;
  isIndex: boolean;
};

type SidebarGroup = {
  type: "group";
  title: string;
  route: string;
  source: string;
  order?: number;
  numericPrefix?: string;
  children: SidebarNode[];
  isIndex: false;
};

type SidebarNode = SidebarPage | SidebarGroup;
type FlatPage = Pick<SidebarPage, "title" | "route" | "source" | "order">;

type SidebarOptions = {
  docsRoot: string;
  projectSlug: string;
  readDirectory: (directory: string) => Promise<DirectoryEntry[]>;
  readTextFile: (filePath: string) => Promise<string>;
  parseFrontmatter: (source: string) => Record<string, unknown>;
  joinPath: (...segments: string[]) => string;
};

export async function buildSidebar(options: SidebarOptions): Promise<{
  sidebar: SidebarNode[];
  flatPages: FlatPage[];
}> {
  const {
    docsRoot,
    projectSlug,
    readDirectory,
    readTextFile,
    parseFrontmatter,
    joinPath,
  } = options;
  const seenRoutes = new Set();

  function cleanSegment(value: string): string {
    const stripped = value.replace(/^\d+[-_.\s]+/, "");
    const normalized = stripped
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!normalized)
      throw new Error(`Cannot create a route segment from "${value}"`);
    return normalized;
  }

  function humanize(value: string): string {
    const stripped = value.replace(/^\d+[-_.\s]+/, "");
    const words = stripped.replace(/[-_]+/g, " ").trim();
    if (!words || words.toLowerCase() === "index") return "Overview";
    return words.replace(/\b[a-z]/g, (letter: string) => letter.toUpperCase());
  }

  async function inspectPage(
    filePath: string,
    relativeFile: string,
    directoryRoute: string,
    filename: string,
    treatReadmeAsIndex = false,
    rootLevel = false,
  ): Promise<SidebarPage | null> {
    const source = await readTextFile(filePath);
    const data = parseFrontmatter(source);
    if (data.draft !== undefined && typeof data.draft !== "boolean") {
      throw new Error(`Frontmatter draft in ${relativeFile} must be a boolean`);
    }
    if (data.draft === true) return null;

    const extension = filename.toLowerCase().endsWith(".mdx") ? 4 : 3;
    const stem = filename.slice(0, -extension);
    const lowerStem = stem.toLowerCase();
    const isIndex =
      lowerStem === "index" || (treatReadmeAsIndex && lowerStem === "readme");
    const routeSegment = isIndex ? "" : `${cleanSegment(stem)}/`;
    const route = `${directoryRoute}${routeSegment}` || `/${projectSlug}/`;
    if (seenRoutes.has(route)) throw new Error(`Route collision at ${route}`);
    seenRoutes.add(route);

    if (data.title !== undefined && typeof data.title !== "string") {
      throw new Error(`Frontmatter title in ${relativeFile} must be a string`);
    }
    const orderValue =
      data.order === undefined ? undefined : Number(data.order);
    if (orderValue !== undefined && !Number.isFinite(orderValue)) {
      throw new Error(`Frontmatter order in ${relativeFile} must be a number`);
    }

    const resolvedTitle =
      rootLevel && isIndex
        ? "Overview"
        : data.title?.trim() || humanize(isIndex ? "index" : stem);

    return {
      type: "page",
      title: resolvedTitle,
      route,
      source: relativeFile.split("\\").join("/"),
      order: orderValue,
      numericPrefix: /^\s*(\d+)/.exec(filename)?.[1],
      isIndex,
    };
  }

  function extractIndexLinkOrder(markdownSource: string): Map<string, number> {
    const orderMap = new Map<string, number>();
    const linkPattern = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    let match: RegExpExecArray | null;
    while ((match = linkPattern.exec(markdownSource)) !== null) {
      const rawHref = match[1].trim();
      if (
        !rawHref ||
        rawHref.startsWith("#") ||
        rawHref.startsWith("/") ||
        /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(rawHref)
      ) {
        continue;
      }
      const pathPart = rawHref.split(/[?#]/, 1)[0].replace(/^\.\/+/, "");
      if (!pathPart || pathPart.startsWith("..")) continue;
      const firstSegment = pathPart.split("/").filter(Boolean)[0];
      if (!firstSegment) continue;
      const stem = firstSegment.replace(/\.mdx?$/i, "");
      if (!stem || /^(?:index|readme)$/i.test(stem)) continue;
      try {
        const cleaned = cleanSegment(stem);
        if (!orderMap.has(cleaned)) {
          orderMap.set(cleaned, orderMap.size);
        }
      } catch {
        // Ignore non-routable segments
      }
    }
    return orderMap;
  }

  function itemSegmentKey(item: SidebarNode): string {
    const parts = item.source.split("/").filter(Boolean);
    if (item.type === "group") {
      const folder = parts[parts.length - 1] || item.title;
      try {
        return cleanSegment(folder);
      } catch {
        return "";
      }
    }
    const file = parts[parts.length - 1] || "";
    const stem = file.replace(/\.mdx?$/i, "");
    try {
      return cleanSegment(stem);
    } catch {
      return "";
    }
  }

  function compareItems(
    left: SidebarNode,
    right: SidebarNode,
    linkOrderMap: Map<string, number>,
  ): number {
    if (left.isIndex !== right.isIndex)
      return left.isIndex ? -1 : 1;
    if (left.order !== right.order) {
      if (left.order === undefined) return 1;
      if (right.order === undefined) return -1;
      return left.order - right.order;
    }
    const leftPrefix =
      left.numericPrefix === undefined
        ? Number.POSITIVE_INFINITY
        : Number(left.numericPrefix);
    const rightPrefix =
      right.numericPrefix === undefined
        ? Number.POSITIVE_INFINITY
        : Number(right.numericPrefix);
    if (leftPrefix !== rightPrefix) return leftPrefix - rightPrefix;
    if (linkOrderMap.size > 0) {
      const leftLinkRank =
        linkOrderMap.get(itemSegmentKey(left)) ?? Number.POSITIVE_INFINITY;
      const rightLinkRank =
        linkOrderMap.get(itemSegmentKey(right)) ?? Number.POSITIVE_INFINITY;
      if (leftLinkRank !== rightLinkRank) return leftLinkRank - rightLinkRank;
    }
    return left.title.localeCompare(right.title, undefined, {
      sensitivity: "base",
    });
  }

  async function walk(
    directoryPath: string,
    relativeDirectory: string,
    route: string,
    rootLevel = false,
  ): Promise<SidebarNode[]> {
    const entries = await readDirectory(directoryPath);
    const directories = entries.filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith("."),
    );
    const rawFiles = entries.filter(
      (entry) =>
        entry.isFile() &&
        /\.mdx?$/i.test(entry.name) &&
        entry.name.toLowerCase() !== "manifest.md",
    );
    const hasExplicitIndex = rawFiles.some((entry) =>
      /^index\.mdx?$/i.test(entry.name),
    );
    let readmeKept = false;
    const files = rawFiles.filter((entry) => {
      if (!/^readme\.mdx?$/i.test(entry.name)) return true;
      if (hasExplicitIndex || readmeKept) return false;
      readmeKept = true;
      return true;
    });
    const indexEntry = files.find((entry) =>
      hasExplicitIndex
        ? /^index\.mdx?$/i.test(entry.name)
        : /^readme\.mdx?$/i.test(entry.name),
    );
    const linkOrderMap = indexEntry
      ? extractIndexLinkOrder(
          await readTextFile(joinPath(directoryPath, indexEntry.name)),
        )
      : new Map<string, number>();
    const items: SidebarNode[] = [];

    for (const directory of directories) {
      const segment = cleanSegment(directory.name);
      const childRoute = `${route}${segment}/`;
      const childRelative = relativeDirectory
        ? `${relativeDirectory}/${directory.name}`
        : directory.name;
      const children: SidebarNode[] = await walk(
        joinPath(directoryPath, directory.name),
        childRelative,
        childRoute,
      );
      if (children.length) {
        const indexPage = children.find(
          (item): item is SidebarPage => item.type === "page" && item.isIndex,
        );
        const groupTitle =
          indexPage?.title && indexPage.title !== "Overview"
            ? indexPage.title
            : humanize(directory.name);
        items.push({
          type: "group",
          title: groupTitle,
          route: indexPage?.route || childRoute,
          source: childRelative.split("\\").join("/"),
          order: indexPage?.order,
          numericPrefix: /^\s*(\d+)/.exec(directory.name)?.[1],
          children,
          isIndex: false,
        });
      }
    }

    for (const file of files) {
      const relativeFile = relativeDirectory
        ? `${relativeDirectory}/${file.name}`
        : file.name;
      const page = await inspectPage(
        joinPath(directoryPath, file.name),
        relativeFile,
        route,
        file.name,
        !hasExplicitIndex,
        rootLevel,
      );
      if (page) items.push(page);
    }

    items.sort((left, right) => compareItems(left, right, linkOrderMap));
    return items;
  }

  const sidebar = await walk(docsRoot, "", `/${projectSlug}/`, true);
  const flatPages: FlatPage[] = [];
  function flatten(items: SidebarNode[]): void {
    for (const item of items) {
      if (item.type === "page") {
        flatPages.push({
          title: item.title,
          route: item.route,
          source: item.source,
          order: item.order,
        });
      } else {
        flatten(item.children);
      }
    }
  }
  flatten(sidebar);

  return { sidebar, flatPages };
}
