import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import astroExpressiveCode from "astro-expressive-code";
import { defineConfig } from "astro/config";
import { unified } from "@astrojs/markdown-remark";
import { readFileSync } from "node:fs";
import path from "node:path";

const siteConfigPath = new URL("./config/site.config.json", import.meta.url);
const siteConfig = JSON.parse(readFileSync(siteConfigPath, "utf8"));

function cleanSegment(segment) {
  const withoutExt = segment.replace(/\.mdx?$/i, "");
  const stripped = withoutExt.replace(/^\d+[-_]/, "");
  return (stripped || withoutExt).toLowerCase();
}

function externalMarkdownLinks() {
  return (tree) => {
    function visit(node) {
      if (node.type === "link" && /^https?:\/\//i.test(node.url || "")) {
        node.data ??= {};
        node.data.hProperties = {
          ...node.data.hProperties,
          target: "_blank",
          rel: ["noopener", "noreferrer"],
        };
      }
      for (const child of node.children || []) visit(child);
    }

    visit(tree);
  };
}

function rewriteInternalMarkdownLinks() {
  return (tree, file) => {
    const sourcePath = String(file?.history?.[0] || file?.path || "").replace(
      /\\/g,
      "/",
    );
    const marker = "/src/content/docs/";
    const markerIndex = sourcePath.lastIndexOf(marker);
    let docRelativePath = "";
    if (markerIndex !== -1) {
      docRelativePath = sourcePath.slice(markerIndex + marker.length);
    } else if (sourcePath.startsWith("src/content/docs/")) {
      docRelativePath = sourcePath.slice("src/content/docs/".length);
    }

    function visit(node) {
      if (node.type === "link" && typeof node.url === "string") {
        const rawUrl = node.url.trim();
        if (
          rawUrl &&
          !rawUrl.startsWith("#") &&
          !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(rawUrl)
        ) {
          const match = rawUrl.match(/^([^?#]*)(.*)$/);
          const pathPart = match?.[1] ?? "";
          const suffix = match?.[2] ?? "";

          if (/\.mdx?$/i.test(pathPart)) {
            if (docRelativePath) {
              const currentDir = path.posix.dirname(docRelativePath);
              const resolvedDocPath = pathPart.startsWith("/")
                ? path.posix.normalize(pathPart.replace(/^\/+/, ""))
                : path.posix.normalize(path.posix.join(currentDir, pathPart));

              if (!resolvedDocPath.startsWith("..")) {
                const segments = resolvedDocPath.split("/").filter(Boolean);
                if (segments.length > 0) {
                  const productSlug = segments[0];
                  const innerSegments = segments.slice(1);
                  const lastSegment =
                    innerSegments[innerSegments.length - 1] ?? "";
                  const isIndexOrReadme = /^(?:index|readme)\.mdx?$/i.test(
                    lastSegment,
                  );
                  const routeSegments = (
                    isIndexOrReadme
                      ? innerSegments.slice(0, -1)
                      : innerSegments
                  )
                    .map(cleanSegment)
                    .filter(Boolean);

                  node.url = `/${[productSlug, ...routeSegments].join("/")}/${suffix}`;
                }
              }
            } else {
              const normalized = path.posix.normalize(pathPart);
              const segments = normalized
                .split("/")
                .filter((seg) => seg && seg !== ".");
              const lastSegment = segments[segments.length - 1] ?? "";
              const isIndexOrReadme = /^(?:index|readme)\.mdx?$/i.test(
                lastSegment,
              );
              const routeSegments = (
                isIndexOrReadme ? segments.slice(0, -1) : segments
              )
                .map((seg) => (seg === ".." ? ".." : cleanSegment(seg)))
                .filter(Boolean);
              node.url =
                routeSegments.length > 0
                  ? `./${routeSegments.join("/")}/${suffix}`
                  : `./${suffix}`;
            }
          }
        }
      }
      for (const child of node.children || []) visit(child);
    }

    visit(tree);
  };
}

function servePagefindInDev() {
  const pagefindDistDir = path.resolve(process.cwd(), "dist", "pagefind");
  const mimeTypes = {
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".wasm": "application/wasm",
    ".pf_meta": "application/octet-stream",
    ".pf_index": "application/octet-stream",
    ".pf_fragment": "application/octet-stream",
    ".pagefind": "application/octet-stream",
  };
  return {
    name: "vib-serve-pagefind-dev",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rawUrl = req.url?.split(/[?#]/, 1)[0] ?? "";
        if (!rawUrl.startsWith("/pagefind/")) return next();
        let relPath;
        try {
          relPath = decodeURIComponent(rawUrl.slice("/pagefind/".length));
        } catch {
          return next();
        }
        const targetPath = path.resolve(pagefindDistDir, relPath);
        const relative = path.relative(pagefindDistDir, targetPath);
        if (
          !relative ||
          relative.startsWith("..") ||
          path.isAbsolute(relative)
        ) {
          return next();
        }
        try {
          const content = readFileSync(targetPath);
          const ext = path.extname(targetPath).toLowerCase();
          res.setHeader(
            "Content-Type",
            mimeTypes[ext] || "application/octet-stream",
          );
          res.setHeader("Cache-Control", "no-cache");
          res.end(content);
        } catch {
          next();
        }
      });
    },
  };
}

const sharedRemarkPlugins = [
  externalMarkdownLinks,
  rewriteInternalMarkdownLinks,
];

export default defineConfig({
  site: siteConfig.domain,
  output: "static",
  trailingSlash: "ignore",
  server: {
    host: "0.0.0.0",
    port: 3000,
  },
  integrations: [
    astroExpressiveCode({
      themes: ["github-dark", "github-light"],
    }),
    mdx(),
    sitemap(),
    {
      name: "vib-prune-public-governance-docs",
      hooks: {
        "astro:build:done": async ({ dir }) => {
          const { promises: fs } = await import("node:fs");
          const { fileURLToPath } = await import("node:url");
          const outDir = fileURLToPath(dir);
          for (const governanceFile of ["MANIFEST.md", "README.md"]) {
            await fs.rm(path.join(outDir, governanceFile), { force: true });
          }
          const aistudioAssetsDir = path.join(outDir, "assets", "aistudio");
          await fs.rm(aistudioAssetsDir, { recursive: true, force: true });
          const assetsDir = path.join(outDir, "assets");
          try {
            const entries = await fs.readdir(assetsDir);
            if (entries.length === 0) {
              await fs.rmdir(assetsDir);
            }
          } catch {
            // assetsDir does not exist
          }
        },
      },
    },
  ],
  vite: {
    plugins: [tailwindcss(), servePagefindInDev()],
    server: {
      allowedHosts: true,
    },
  },
  markdown: {
    processor: unified({ remarkPlugins: sharedRemarkPlugins }),
  },
});
