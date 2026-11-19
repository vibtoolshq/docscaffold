---
title: Vib Docs Engine
description: A static multi-product documentation engine with zero-touch .vibtools/ auto-discovery and AI-readable documentation endpoints.
version: "v1.0.0"
---

> Public template note: the shipped registry contains only this public engine. Configure any external documentation repositories deliberately.

# Vib Docs Engine — Operator & AI Agent Guide

`vib-docs-engine` builds static documentation portals for multiple products (`https://docs.vib.tools` for end-user product docs and `https://developer.vibtools.io` for open-source/developer docs). During a build, the engine inspects each product repository's `.vibtools/docs.config.json` (or `.vibtools/config.docs.json`) via 2-step Git sparse checkout, validates and normalizes Markdown/MDX documentation from the configured `docsPath`, generates the portal manifest and sidebar tree, builds Astro static HTML + raw `.md` + `llms.txt` routes, and indexes all articles with Pagefind.

---

## 1. AI Agent & Automated Repository Setup Quick-Start

If you are an **AI coding agent** (or developer) asked to configure `.vibtools/` and `docs/` inside a product repository so it syncs with `https://docs.vib.tools` or `https://developer.vibtools.io`, read these machine-readable resources first:

| Resource | Path | Format & Purpose |
| :--- | :--- | :--- |
| **JSON Schema (Canonical)** | `/schemas/vibtools-docs.schema.json` | Draft 2020-12 JSON Schema for `.vibtools/docs.config.json` & `.vibtools/config.docs.json` |
| **`.vibtools/` & `docs/` Full Spec (HTML)** | `/vib-docs-engine/vibtools-config/` | Complete human & AI specification for `.vibtools/` and `docs/` authoring |
| **`.vibtools/` & `docs/` Full Spec (Raw Markdown)** | `/vib-docs-engine/vibtools-config.md` | Raw YAML-free Markdown of the complete `.vibtools/` + `docs/` specification |
| **Adding Projects Guide (Raw Markdown)** | `/vib-docs-engine/adding-projects.md` | Repository registration (`config/projects.json`) & webhook setup |
| **Deployment Guide (Raw Markdown)** | `/vib-docs-engine/deployment.md` | Dual-portal Cloudflare Pages & Docker/Nginx deployment |
| **Product AI Bundle (`vib-docs-engine`)** | `/vib-docs-engine/llms.txt` | Complete concatenated Markdown for all `vib-docs-engine` guides in one request |
| **Portal AI Directory** | `/llms.txt` | High-level index of all products, pages, raw `.md` URLs, and schema link on this portal |
| **Full Portal AI Corpus** | `/llms-full.txt` | Complete Markdown corpus of every product and page hosted on this portal |

### 3-Step Checklist for AI Agents Configuring a Product Repository

When asked to set up `.vibtools/` and `docs/` in a target repository:

1. **Create `.vibtools/docs.config.json` in the repository root:**
   - Include `"$schema": "https://docs.vib.tools/schemas/vibtools-docs.schema.json"` and `"schemaVersion": 1`.
   - Choose `"docsType"`:
     - `"users"` -> publishes strictly to **`https://docs.vib.tools`** (`portalType: "users"`).
     - `"developer"` -> publishes strictly to **`https://developer.vibtools.io`** (`portalType: "developer"`).
     - `"both"` -> publishes to **both portals** (use `"targets": { "users": { ... }, "developer": { ... } }` when the repository splits end-user docs and developer docs into separate directories like `docs/users` and `docs/dev`).
   - Add optional brand icon at `.vibtools/logo.svg` or `.vibtools/logo.png` (under `2 MB`, static SVG only) and reference it via `"logoPath": ".vibtools/logo.svg"`.
2. **Prepare the `docs/` directory (or per-target `docsPath`):**
   - Every configured `docsPath` **must** contain a root `index.md` (or `README.md`, which the sync engine automatically normalizes to `index.md`).
   - Include clean YAML frontmatter (`title`, `description`, `version`, optional `order`, `draft`) at the top of `index.md`, or rely on Smart Markdown extraction (`# H1` title + first summary paragraph).
   - Never keep duplicate `index.md` and `README.md` with conflicting content in the same folder (`index.md` wins and `README.md` is discarded).
   - Any governance `MANIFEST.md` files inside `docs/` are automatically stripped during sync so they never become public documentation pages (spell it `MANIFEST.md`, never `MINIFEST.md`).
3. **Follow the 2-Organization Convention:**
   - **`https://github.com/vibtoolshq/<repo>`**: Public, free, and open-source project repositories. Add `.vibtools/docs.config.json` directly inside the code repository alongside `docs/`. Most repos here use `"docsType": "developer"` (or `"docsType": "both"` with `targets.users` and `targets.developer` when a project like `LicenX` serves both `docs.vib.tools` and `developer.vibtools.io`).
   - **`https://github.com/example-org/<repo>`**: Public **docs-only** mirror repositories for private/commercial projects. Create a dedicated public repository per product in `github.com/example-org` containing **only** `.vibtools/` and `docs/` (zero private application source code), typically targeting `https://docs.vib.tools` (`"docsType": "users"` or `"both"`).

Read the full field-by-field contract and copy-paste templates in [`.vibtools/` Configuration](vibtools-config.md).

---

## 2. Prerequisites for the Implemented Engine

- Node.js `>=22.23.4` (pinned to official `22.23.5` in `.node-version` and `.nvmrc`) and npm.
- Git with sparse-checkout support (Git 2.25 or newer).
- Network access to the configured source repositories; credentials (`GIT_TOKEN` / `secretKey`) only when private repositories require them. Public repositories under `https://github.com/vibtoolshq` and `https://github.com/example-org` require zero credentials.

---

## 3. Local Workflow

1. Install dependencies using `npm install` (or `npm ci` from `package-lock.json` in CI).
2. Set `GIT_TOKEN` in the process environment or deployment secret store only when private HTTPS repositories require it. Never commit credentials or put them in public build variables.
3. Run `npm run sync` to synchronize docs and regenerate `src/generated/manifest.json`.
4. Run `npm run dev` to sync automatically, then start Astro's development server on `0.0.0.0:3000`.
5. Run `npm run build` to sync, build Astro, and run Pagefind. Run `npm run verify` to execute the full post-build verifier (`scripts/verify-build.mjs`). `npm run preview` previews an existing Astro build on `0.0.0.0:3000`.

The `predev` and `prebuild` lifecycle hooks run the sync script automatically. When syncing the engine's own `vib-docs-engine` record without remote Git credentials, `scripts/sync-docs.mjs` falls back to the in-repository `docs/` directory. `localPath` can also temporarily target a local folder (for example `./docs`) for an isolated sync test; keep it out of production config. Generated content and manifests are ignored build inputs and must not be hand-edited.

Press `Ctrl+K` (or `Cmd+K` on macOS) anywhere to open search. On a product page, search starts scoped to that product; switch to “All Docs” for portal-wide results. Hub searches are global.

Static AI indexes are available at `/llms.txt`, `/llms-full.txt`, `/<product-slug>/llms.txt`, and per-page `/<product-slug>/<page>.md`. The `.vibtools/` JSON Schema is served at `/schemas/vibtools-docs.schema.json`. `robots.txt` allows crawlers and points to `/sitemap-index.xml`. Unknown paths use the compact static 404 page.

---

## 4. Configuration Overview

- `config/site.config.json` controls portal title, subtitle, canonical domain, brand identity, default accent, `portalType` (`"users"`, `"developer"`, or `"all"`), and navigation.
- `config/projects.json` accepts bare Git repository URLs (`"https://github.com/vibtoolshq/..."` or `"https://github.com/example-org/..."`) for repos that include `.vibtools/docs.config.json` (or `.vibtools/config.docs.json`), or override objects with explicit fields and private-repo `secretKey` references.
- `.vibtools/docs.config.json` (alias `.vibtools/config.docs.json`) lets any repository declare its own `$schema`, `schemaVersion`, `docsType`, dual `targets.users` / `targets.developer`, `docsPath`, `logoPath`, `slug`, `category`, `title`, `description`, `version`, `accentColor`, `branch`, and CTA metadata in one place.
- Categories are derived dynamically from resolved products. Adding a category does not require code changes.

Synchronized files under `src/content/docs/`, generated data under `src/generated/`, and synchronized logos under `public/logos/` are build artifacts and are ignored by Git except for `.gitkeep` files. Do not edit generated files by hand.

---

## 5. Deployment

Configure the host to build from the portal's own deployment repository. A documentation source repository webhook should trigger the host's protected build hook; the build fetches `.vibtools/` and only the matching documentation directories with 2-step Git sparse checkout, then publishes a complete static output. For Cloudflare Pages, set the build command to `npm run build`, the output directory to `dist`, and use a protected Pages build hook. For a self-hosted VPS, build the Docker image and have Nginx serve only the resulting static files.

See [`.vibtools/` Configuration](vibtools-config.md) for the complete `.vibtools/` and `docs/` specification, [Adding Projects](adding-projects.md) for CLI and webhook steps, [Go-Live Deployment](deployment.md) for dual-portal hosting, and [Portal User Guide](portal-user-guide.md) for reader navigation.
