---
title: ".vibtools/ Configuration"
description: "Complete AI-agent and developer specification for .vibtools/docs.config.json, dual-portal targets, docs/ folder structure, frontmatter rules, and JSON Schema."
version: "v1.0.0"
---

# `.vibtools/` & `docs/` Repository Specification (Developer & AI Agent Reference)

This document is the canonical specification for setting up `.vibtools/` and `docs/` inside any product repository so **Vib Docs Engine** can automatically sync, validate, categorize, and publish its documentation to **`https://docs.vib.tools`** (User Documentation Portal) and/or **`https://developer.vibtools.io`** (Developer Documentation Portal).

> **For AI Coding Agents:** Everything required to configure a new or existing repository is specified on this page. You can also fetch the raw Markdown at `/vib-docs-engine/vibtools-config.md`, the full engine bundle at `/vib-docs-engine/llms.txt`, or the machine-readable JSON Schema at `/schemas/vibtools-docs.schema.json`.

---

## 1. Two-Organization Architecture (`vibtoolshq` vs `example-org`)

Vib Tools separates public open-source code repositories from private commercial product documentation across two GitHub organizations:

| GitHub Organization | Repository Type | What Lives in the Repo | Typical `docsType` / Target Portal |
| :--- | :--- | :--- | :--- |
| **`https://github.com/vibtoolshq`** | Public / Free / Open-Source projects (`LicenX`, `SocketCore`, `KronOTP`, `VPS-MCP`, `UpdatePilot`, `ReadBox`, etc.) | Full open-source project source code + `.vibtools/` + `docs/` | `"developer"` (`developer.vibtools.io`), or `"both"` with `targets.users` + `targets.developer` if also published on `docs.vib.tools` |
| **`https://github.com/example-org`** | Dedicated Public **Docs-Only** repositories for private/commercial projects | **Only** `.vibtools/` + `docs/` (and optional `README.md`). Zero private application source code. | `"users"` (`docs.vib.tools`), or `"both"` if the public docs-only repo includes both end-user and public API/SDK guides |

Why this matters when configuring a repo:
- Because both `https://github.com/vibtoolshq/*` and `https://github.com/example-org/*` repositories are **public**, `config/projects.json` in the documentation portal only needs the bare repository URL string (`"https://github.com/vibtoolshq/<repo>.git"` or `"https://github.com/example-org/<repo>.git"`). No `GIT_TOKEN` or `secretKey` is required for public repositories.
- Even on full source repositories under `github.com/vibtoolshq`, `scripts/sync-docs.mjs` performs a **2-step Git sparse checkout** that downloads only `.vibtools/` first and then only the resolved `docsPath` + `logoPath`. Application source code is never checked out during documentation builds.

---

## 2. Directory Layout & File Naming Rules

### Standard Single-Audience Layout (`docs/`)

Use this layout when the repository targets a single portal (`"docsType": "users"` or `"docsType": "developer"`) or shares the exact same `docs/` folder on both portals:

```text
your-product-repo/
├── .vibtools/
│   ├── docs.config.json        # Canonical config file (or config.docs.json — NEVER both)
│   └── logo.svg                # Optional product logo (.svg, .png, .webp, .avif <= 2 MB)
└── docs/
    ├── index.md                # REQUIRED root landing page (or README.md auto-promoted to index.md)
    ├── 01-getting-started.md   # Ordered top-level guide (numeric prefix stripped from URL & label)
    ├── 02-configuration.md
    ├── guides/                 # Subfolder becomes a collapsible sidebar group
    │   ├── index.md            # Optional subfolder overview (its frontmatter title names the sidebar group)
    │   ├── installation.md
    │   └── troubleshooting.md
    └── assets/                 # Optional images referenced via relative Markdown paths
        └── workflow.png
```

### Dual-Audience Split Layout (`docs/users/` + `docs/dev/`)

Use this layout when a single repository (for example `https://github.com/vibtoolshq/LicenX`) serves **end-user guides** to `https://docs.vib.tools` and **developer/API docs** to `https://developer.vibtools.io` from separate subdirectories:

```text
your-product-repo/
├── .vibtools/
│   ├── docs.config.json        # Uses "docsType": "both" with "targets": { "users": {...}, "developer": {...} }
│   └── logo.svg
└── docs/
    ├── users/                  # Checked out ONLY by docs.vib.tools (portalType: "users")
    │   ├── index.md            # REQUIRED root landing page for end-user docs
    │   └── 01-quickstart.md
    └── dev/                    # Checked out ONLY by developer.vibtools.io (portalType: "developer")
        ├── index.md            # REQUIRED root landing page for developer docs
        └── 01-architecture.md
```

### Strict File Rules for `.vibtools/`

1. **Canonical filename:** `.vibtools/docs.config.json`
2. **Supported alias:** `.vibtools/config.docs.json`
3. **Conflict guard (Fatal Build Error):** Commit **either** `docs.config.json` **or** `config.docs.json` inside `.vibtools/`. If both files exist simultaneously, `scripts/sync-docs.mjs` and `scripts/verify-build.mjs` reject the repository with an explicit conflict error.
4. **JSON validity:** Must be strict, valid JSON (UTF-8, no trailing commas, no `//` comments).

---

## 3. Complete `.vibtools/docs.config.json` Field Reference

Every field is validated by `parseVibtoolsRepoConfig` in `src/utils/vibtoolsConfig.ts` and matched against `/schemas/vibtools-docs.schema.json`:

| Field | Type | Scope | Validation Constraint | Default / Fallback Behavior |
| :--- | :--- | :--- | :--- | :--- |
| `$schema` | `string` | Root only | Non-empty URI string | Optional. Set to `"https://docs.vib.tools/schemas/vibtools-docs.schema.json"` (or `"https://developer.vibtools.io/schemas/vibtools-docs.schema.json"`). |
| `schemaVersion` | `1` (integer) | Root only | Must equal exact integer `1` | Optional (`1`). Any other value fails validation. |
| `docsType` | `"users" \| "developer" \| "both"` | Root only | Exact enum string | Defaults to `"both"` (or inferred from `targets` keys if only one target key is defined). |
| `slug` | `string` | Root & Target | `^[a-z0-9]+(?:-[a-z0-9]+)*$` (lowercase alphanumeric + single hyphens) | Derived automatically from the repository name in `repoUrl` (e.g., `LicenX.git` -> `"licenx"`). |
| `title` | `string` | Root & Target | Non-empty trimmed string | Used for Hub card and topbar title when `index.md` frontmatter lacks `title`. |
| `category` | `string` | Root & Target | Non-empty trimmed string | Hub category filter tab. Defaults to `"Developer Docs"` when `docsType === "developer"`, otherwise `"Documentation"`. |
| `description` | `string` | Root & Target | Non-empty trimmed string | Used for Hub card summary and `<meta name="description">` when `index.md` lacks `description`. |
| `version` | `string \| number` | Root & Target | Non-empty string or finite number | Normalized to string. Displayed in Hub & Topbar version badge (leading `v`/`V` is normalized automatically so `"0.1.0"` and `"v0.1.0"` both render as `v0.1.0`). |
| `accentColor` | `string` | Root & Target | `^#(?:[\da-fA-F]{3}\|[\da-fA-F]{4}\|[\da-fA-F]{6}\|[\da-fA-F]{8})$` | Product brand accent color (e.g., `"#7C3AED"`). Falls back to `site.defaultAccent` from `config/site.config.json`. |
| `docsPath` | `string` | Root & Target | Relative POSIX directory path inside repo. Must **not** start with `/`, contain `\`, contain `..`, or equal `.` | Defaults to `"docs"`. Examples: `"docs"`, `"docs/users"`, `"docs/dev"`, `"packages/sdk/docs"`. |
| `logoPath` | `string` | Root & Target | Relative POSIX file path inside repo. Must **not** start with `/`, contain `\`, contain `..`, or equal `.` | Optional (e.g. `".vibtools/logo.svg"` or `".vibtools/logo.png"`). Checked before automatic logo discovery. |
| `branch` | `string` | Root & Target | Non-empty Git branch name. Must **not** contain whitespace, `\`, or `..` | Defaults to `"main"`. If a target overrides `branch`, `scripts/sync-docs.mjs` fetches and switches sparse checkout to that branch before checking out `docsPath`. |
| `ctaLabel` | `string` | Root & Target | Non-empty trimmed string | Topbar external action button label (defaults to `"Open"` when `ctaUrl` is defined without `ctaLabel`). Ignored if `ctaUrl` is omitted. |
| `ctaUrl` | `string` | Root & Target | Valid absolute `http://` or `https://` URL | Topbar external button destination (e.g., `"https://github.com/vibtoolshq/LicenX"` or `"https://vib.tools/licenx"`). |
| `targets` | `object` | Root only | Object containing `"users"` and/or `"developer"` target override objects (`minProperties: 1`, `additionalProperties: false`) | Optional per-portal overrides. Any field set inside `targets.users` or `targets.developer` overrides the root field on that portal. |

---

## 4. Portal Routing & Metadata Precedence Rules

### How `portalType` Matches `docsType` and `targets`

Each portal deployment sets `"portalType"` inside its `config/site.config.json`:

1. **`docs.vib.tools` (`"portalType": "users"`)**:
   - **Includes** repositories where:
     - `targets.users` is defined, OR
     - `docsType` is `"users"` or `"both"` (and `targets` does not restrict exclusively to `developer`).
   - **Skips** repositories where `docsType` is `"developer"` (and `targets.users` is not defined). Skipped repositories log a clean `Skipped ...` notice and do not fail the build.
2. **`developer.vibtools.io` (`"portalType": "developer"`)**:
   - **Includes** repositories where:
     - `targets.developer` is defined, OR
     - `docsType` is `"developer"` or `"both"` (and `targets` does not restrict exclusively to `users`).
   - **Skips** repositories where `docsType` is `"users"` (and `targets.developer` is not defined).
3. **Combined / Preview Portal (`"portalType": "all"`)**:
   - **Includes** all repositories.
   - If a repository defines both `targets.users` and `targets.developer`, an explicit `"docsType": "developer"` or `"docsType": "users"` on the entry in `config/projects.json` selects that target; otherwise `targets.users` is selected by default.

### Metadata Resolution Order (Highest to Lowest Priority)

When resolving `slug`, `docsPath`, `logoPath`, `branch`, `category`, `accentColor`, `ctaLabel`, and `ctaUrl`:
1. **`config/projects.json` explicit override field** (if the portal registry entry is an object instead of a bare URL string)
2. **`.vibtools/` active target** (`targets.users` on user portal, `targets.developer` on developer portal)
3. **`.vibtools/` root fields**
4. **Engine defaults** (`branch: "main"`, `docsPath: "docs"`, `slug` from `repoUrl`, `category: "Documentation"` or `"Developer Docs"`)

When resolving display `title`, `description`, and `version` for a product:
1. **Root `index.md` YAML frontmatter** (`title` if not `"Overview"`, `description`, `version`)
2. **Resolved `.vibtools/` / `config/projects.json` metadata** (`title`, `description`, `version`)
3. **Smart Markdown Extraction fallback** (`extractMarkdownMetadata` in `src/utils/vibtoolsConfig.ts`):
   - **Title:** First `# H1` heading in `index.md`, automatically stripping noisy suffixes like `— User Documentation`, `- Developer Docs`, or `| Documentation`.
   - **Description:** First clean prose paragraph (skipping badges, tables, blockquotes, HTML tags, and boilerplate headings), stripped of inline Markdown syntax and truncated cleanly at a word boundary around `160` characters.
   - **Version:** First `Version: X.Y.Z`, `Release: vX.Y.Z`, or standalone `vX.Y.Z` semantic version badge found in the opening lines.

---

## 5. `docs/` Authoring Rules & Markdown/MDX Contract

Every AI agent and developer authoring files inside `docsPath` (`docs/`, `docs/users/`, `docs/dev/`) must follow these rules so `scripts/sync-docs.mjs`, `src/utils/sidebar.ts`, and Astro Content Collections compile without errors:

### 5.1 Mandatory Root `index.md` (or `README.md`)

- Every configured `docsPath` **must** have a root `index.md`, `index.mdx`, `README.md`, or `README.mdx`.
- If a directory contains `README.md` and no `index.md`, `scripts/sync-docs.mjs` automatically renames `README.md` -> `index.md`.
- If a directory contains **both** `index.md` and `README.md`, `index.md` is kept and `README.md` is deleted to prevent duplicate route collisions.
- In the left sidebar, the root `index.md` is always rendered first with the label **`Overview`**, while the page's `<title>` and `<h1>` use the frontmatter `title` (or `.vibtools` product title).

### 5.2 Supported Frontmatter Fields (`.md` / `.mdx`)

All frontmatter fields are optional in `src/content.config.ts`, except `draft` must be a boolean if present:

```yaml
---
title: "Configuration Guide"
description: "Configure environment variables, webhooks, and runtime options."
version: "1.2.0"
order: 2
category: "Core Engine"
draft: false
---
```

| Frontmatter Key | Type | Effect |
| :--- | :--- | :--- |
| `title` | `string` | Page `<h1>`, HTML `<title>`, OpenGraph title, and sidebar link label (root `index.md` keeps `"Overview"` as its sidebar link label). |
| `description` | `string` | Meta description, OpenGraph description, and `/llms.txt` page summary. |
| `version` | `string` | Product version read from the root `index.md` (e.g. `"1.2.0"`). |
| `order` | `number` | Explicit sidebar sort priority within its folder (lower numbers appear first; pages with `order` sort before pages without `order`). |
| `category` | `string` | Optional metadata tag. |
| `draft` | `boolean` | When `draft: true`, `scripts/sync-docs.mjs` completely removes the file during sync so it is never published, routed, or indexed. **Must be an unquoted YAML boolean (`true` or `false`), never a string `"true"`.** |

### 5.3 File & Folder Ordering, URL Slugs, and Subfolder Groups

- **Numeric filename prefixes:** You can prefix filenames or folders with `NN-` or `NN_` (e.g., `01-quickstart.md`, `02-api-reference.md`).
  - `src/utils/sidebar.ts` uses the numeric prefix for sorting (`01` before `02`), and **strips** the prefix from both the generated URL route (`/product/quickstart/`) and the humanized sidebar title (`Quickstart`).
- **Subfolders (`docs/guides/...`):**
  - Every subfolder containing Markdown files becomes a collapsible sidebar section.
  - To customize a subfolder's sidebar group title, add an `index.md` inside that subfolder with a frontmatter `title` (for example `title: "Advanced Guides"`). Otherwise, the folder name is humanized (`02-api-guides` -> `Api Guides`).
- **Route collision guard:** Two files in the same folder that normalize to the same slug (for example `01-setup.md` and `02-setup.md`) will fail the build with a duplicate route collision error. Keep normalized slugs unique per directory.

### 5.4 Governance Files (`MANIFEST.md`) Inside `docs/`

- `scripts/sync-docs.mjs` automatically strips any file named `MANIFEST.md` (case-insensitive) from synced documentation trees so repository inventory files never pollute public documentation sidebars.
- **Warning:** Always spell manifest files exactly `MANIFEST.md`. A misspelled filename like `MINIFEST.md` will **not** be stripped and will be published as a public documentation page.

### 5.5 Internal Links & Relative Images

- **Internal Markdown links:** You may link between pages using either relative Markdown filenames (`[Adding Projects](adding-projects.md)` or `[Setup](./01-setup.md#install)`) or root-relative routes (`[Adding Projects](/vib-docs-engine/adding-projects/)`). The `rewriteInternalMarkdownLinks` Remark plugin in `astro.config.mjs` automatically rewrites relative `.md`/`.mdx` links into clean normalized Astro routes while preserving `#hash` anchors and `?query` parameters.
- **Images & relative assets:** Place diagrams or screenshots inside `docs/assets/` (or any subfolder of `docsPath`) and reference them with relative Markdown image syntax (`![Architecture](./assets/diagram.png)`). `scripts/verify-build.mjs` verifies every internal `href` and `img[src]` in `dist/` and fails the build if any link or image is broken.

### 5.6 Built-In MDX Components (`.mdx` files only)

When a file uses the `.mdx` extension, you can import the engine's built-in interactive components:

```mdx
import Callout from "../../../components/mdx/Callout.astro";
import CodeTabs from "../../../components/mdx/CodeTabs.astro";

<Callout type="tip" title="Zero-Config Sync">
  Bare repository URLs in `config/projects.json` automatically read `.vibtools/docs.config.json`.
</Callout>

<CodeTabs labels={["npm", "pnpm"]}>
  ```sh
  npm run sync
  ```
  ```sh
  pnpm run sync
  ```
</CodeTabs>
```

- `Callout`: `type` supports `"info"` (default), `"tip"`, `"warning"`, or `"danger"`, plus optional `title`.
- `CodeTabs`: `labels` accepts an array of tab names matching the child code blocks.

---

## 6. Logo Discovery & Security Validation Rules

When `scripts/sync-docs.mjs` resolves a product logo, it checks candidate paths in this exact order:

1. Explicit `logoPath` (from `config/projects.json` override -> `.vibtools/` active target -> `.vibtools/` root)
2. `.vibtools/logo.svg`, `.vibtools/logo.png`, `.vibtools/logo.webp`, `.vibtools/logo.avif`, `.vibtools/icon.svg`, `.vibtools/icon.png`
3. `<docsPath>/logo.*`, `<docsPath>/icon.*`, `<docsPath>/assets/logo.*`, `<docsPath>/images/logo.*`

Every logo candidate must pass these security checks:
- Must resolve inside the repository root (`assertWithin`) with zero symlinks (`fs.lstat`).
- Maximum file size: **`2 MB`** (`2,097,152` bytes).
- `.png` files must start with the valid 8-byte PNG signature (`89 50 4E 47 0D 0A 1A 0A`).
- `.svg` files must be static XML/SVG and are rejected if they contain `<script>`, `<foreignObject>`, inline `on*=` event handlers, `javascript:`/`data:text/html` URIs, or external `http://`/`https://` references.
- If no logo exists (or if a candidate fails validation), the engine logs a warning and renders a deterministic 2-letter product monogram badge using `accentColor`.

---

## 7. Production Copy-Paste Templates

### Template A — Public Docs-Only Repo in `github.com/example-org` (`docs.vib.tools`)

Use this in `https://github.com/example-org/<product>` for private/commercial apps whose user documentation is published on `https://docs.vib.tools`:

```json
{
  "$schema": "https://docs.vib.tools/schemas/vibtools-docs.schema.json",
  "schemaVersion": 1,
  "docsType": "users",
  "slug": "calgrid",
  "title": "CalGrid",
  "category": "Desktop Apps",
  "description": "Batch Google Calendar scheduling and deliverability workflows.",
  "version": "1.0.2",
  "accentColor": "#2563EB",
  "docsPath": "docs",
  "logoPath": ".vibtools/logo.png",
  "branch": "main",
  "ctaLabel": "Get CalGrid",
  "ctaUrl": "https://vib.tools/calgrid"
}
```

### Template B — Open-Source Repo in `github.com/vibtoolshq` (`developer.vibtools.io`)

Use this in `https://github.com/vibtoolshq/<repo>` for open-source tools, SDKs, or servers published on `https://developer.vibtools.io`:

```json
{
  "$schema": "https://developer.vibtools.io/schemas/vibtools-docs.schema.json",
  "schemaVersion": 1,
  "docsType": "developer",
  "slug": "socketcore",
  "title": "SocketCore",
  "category": "Core Infrastructure",
  "description": "High-throughput WebSocket and event transport core for Vib Tools services.",
  "version": "1.0.0",
  "accentColor": "#0EA5E9",
  "docsPath": "docs",
  "logoPath": ".vibtools/logo.svg",
  "branch": "main",
  "ctaLabel": "GitHub",
  "ctaUrl": "https://github.com/vibtoolshq/SocketCore"
}
```

### Template C — Dual-Portal Open-Source Repo in `github.com/vibtoolshq` (Both Portals)

Use this when a repository under `https://github.com/vibtoolshq/<repo>` (such as `LicenX`) maintains separate end-user docs (`docs/users`) for `https://docs.vib.tools` and developer docs (`docs/dev`) for `https://developer.vibtools.io`:

```json
{
  "$schema": "https://docs.vib.tools/schemas/vibtools-docs.schema.json",
  "schemaVersion": 1,
  "docsType": "both",
  "slug": "licenx",
  "title": "LicenX",
  "version": "1.0.0",
  "logoPath": ".vibtools/logo.svg",
  "branch": "main",
  "targets": {
    "users": {
      "slug": "licenx",
      "title": "LicenX",
      "category": "License Management",
      "description": "End-user dashboard guide, license activation flows, and billing setup for LicenX.",
      "accentColor": "#7C3AED",
      "docsPath": "docs/users",
      "ctaLabel": "Open LicenX",
      "ctaUrl": "https://vib.tools/licenx"
    },
    "developer": {
      "slug": "licenx",
      "title": "LicenX Developer Guide",
      "category": "SDKs & APIs",
      "description": "Self-hosted deployment, webhook verification, and SDK integration reference for LicenX.",
      "accentColor": "#0EA5E9",
      "docsPath": "docs/dev",
      "ctaLabel": "GitHub",
      "ctaUrl": "https://github.com/vibtoolshq/LicenX"
    }
  }
}
```

### Portal `config/projects.json` Registration

Once `.vibtools/docs.config.json` is committed in the product repository, register the repo in the portal's `config/projects.json` using just its Git URL:

```json
[
  "https://github.com/vibtoolshq/LicenX.git",
  "https://github.com/vibtoolshq/SocketCore.git",
  "https://github.com/example-org/sample-docs.git"
]
```

Or add it via CLI:

```sh
npm run add-project -- --url https://github.com/vibtoolshq/LicenX.git
```

---

## 8. Canonical JSON Schema (Draft 2020-12)

This schema is hosted live at `/schemas/vibtools-docs.schema.json` on both `https://docs.vib.tools/schemas/vibtools-docs.schema.json` and `https://developer.vibtools.io/schemas/vibtools-docs.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://docs.vib.tools/schemas/vibtools-docs.schema.json",
  "title": "VibToolsDocsConfig",
  "description": "Repository-level .vibtools/docs.config.json (or .vibtools/config.docs.json) contract for Vib Docs Engine single-portal and dual-portal documentation sync.",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "$schema": {
      "type": "string",
      "minLength": 1,
      "description": "Optional JSON Schema reference URL (for example https://docs.vib.tools/schemas/vibtools-docs.schema.json)."
    },
    "schemaVersion": {
      "const": 1,
      "description": "Schema format version marker. Must be 1 when provided."
    },
    "docsType": {
      "type": "string",
      "enum": ["users", "developer", "both"],
      "default": "both",
      "description": "Target portal audience: 'users' (docs.vib.tools), 'developer' (developer.vibtools.io), or 'both'."
    },
    "slug": {
      "type": "string",
      "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$",
      "description": "Lowercase URL-safe product route slug (e.g. 'licenx', 'socket-core'). Defaults to the normalized repository name."
    },
    "title": {
      "type": "string",
      "minLength": 1,
      "description": "Display name of the product shown on Hub cards, breadcrumbs, and topbar."
    },
    "category": {
      "type": "string",
      "minLength": 1,
      "description": "Hub category tab label (e.g. 'Core Engine', 'SDKs & CLI', 'Desktop Apps')."
    },
    "description": {
      "type": "string",
      "minLength": 1,
      "description": "Concise product summary for Hub cards, SEO meta tags, and llms.txt indexes."
    },
    "version": {
      "type": ["string", "number"],
      "description": "Product release or docs version badge (e.g. '1.2.0')."
    },
    "accentColor": {
      "type": "string",
      "pattern": "^#(?:[\\da-fA-F]{3}|[\\da-fA-F]{4}|[\\da-fA-F]{6}|[\\da-fA-F]{8})$",
      "description": "CSS hex accent color (#RGB, #RGBA, #RRGGBB, or #RRGGBBAA)."
    },
    "docsPath": {
      "type": "string",
      "minLength": 1,
      "pattern": "^(?!/)(?!\\.$)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$)).+$",
      "default": "docs",
      "description": "Relative POSIX directory path to Markdown/MDX documentation inside the repository (e.g. 'docs', 'docs/users', 'docs/dev')."
    },
    "logoPath": {
      "type": "string",
      "minLength": 1,
      "pattern": "^(?!/)(?!\\.$)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$)).+$",
      "description": "Relative POSIX file path to the product logo (.svg, .png, .webp, .avif under 2 MB, e.g. '.vibtools/logo.svg')."
    },
    "branch": {
      "type": "string",
      "minLength": 1,
      "pattern": "^(?!.*\\s)(?!.*\\\\)(?!.*\\.\\.).+$",
      "default": "main",
      "description": "Git branch to sparse-clone during documentation sync."
    },
    "ctaLabel": {
      "type": "string",
      "minLength": 1,
      "description": "Topbar external CTA button label (defaults to 'Open' when ctaUrl is set)."
    },
    "ctaUrl": {
      "type": "string",
      "format": "uri",
      "pattern": "^https?://",
      "description": "Absolute HTTP/HTTPS destination URL for the topbar CTA button."
    },
    "targets": {
      "type": "object",
      "minProperties": 1,
      "additionalProperties": false,
      "description": "Optional per-portal overrides when a single repository serves both docs.vib.tools ('users') and developer.vibtools.io ('developer').",
      "properties": {
        "users": { "$ref": "#/$defs/target" },
        "developer": { "$ref": "#/$defs/target" }
      }
    }
  },
  "$defs": {
    "target": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "slug": {
          "type": "string",
          "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$"
        },
        "title": { "type": "string", "minLength": 1 },
        "category": { "type": "string", "minLength": 1 },
        "description": { "type": "string", "minLength": 1 },
        "version": { "type": ["string", "number"] },
        "accentColor": {
          "type": "string",
          "pattern": "^#(?:[\\da-fA-F]{3}|[\\da-fA-F]{4}|[\\da-fA-F]{6}|[\\da-fA-F]{8})$"
        },
        "docsPath": {
          "type": "string",
          "minLength": 1,
          "pattern": "^(?!/)(?!\\.$)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$)).+$"
        },
        "logoPath": {
          "type": "string",
          "minLength": 1,
          "pattern": "^(?!/)(?!\\.$)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$)).+$"
        },
        "branch": {
          "type": "string",
          "minLength": 1,
          "pattern": "^(?!.*\\s)(?!.*\\\\)(?!.*\\.\\.).+$"
        },
        "ctaLabel": { "type": "string", "minLength": 1 },
        "ctaUrl": {
          "type": "string",
          "format": "uri",
          "pattern": "^https?://"
        }
      }
    }
  }
}
```

---

## 9. AI Agent Self-Verification Checklist (10 Points)

Before finishing `.vibtools/` and `docs/` setup in any product repository, verify all 10 items:

1. **Single Config File:** Only `.vibtools/docs.config.json` exists (not both `docs.config.json` and `config.docs.json`).
2. **Valid JSON & Schema:** `.vibtools/docs.config.json` parses with `JSON.parse()`, includes `"$schema": "https://docs.vib.tools/schemas/vibtools-docs.schema.json"` and `"schemaVersion": 1`, and contains zero unknown keys.
3. **Correct `docsType` & `targets`:** `"docsType"` is `"users"`, `"developer"`, or `"both"`. If the repository splits `docs/users` and `docs/dev`, `"targets"` defines both `"users"` and `"developer"` with their respective `"docsPath"`.
4. **Valid `slug` & `accentColor`:** `"slug"` is lowercase kebab-case (`^[a-z0-9]+(?:-[a-z0-9]+)*$`) and `"accentColor"` is a valid CSS hex string (`#RRGGBB`).
5. **Safe Relative `docsPath` & `logoPath`:** Neither path starts with `/`, contains `\`, contains `..`, or equals `.`.
6. **Root `index.md` Exists:** Every configured `docsPath` directory contains a root `index.md` (or `README.md`) with clear title, description, and body content.
7. **Valid YAML Frontmatter:** Every `.md`/`.mdx` file with frontmatter has valid YAML delimiters (`---`), and any `draft` field is a boolean (`true`/`false`), not a string.
8. **No Stray Typo Manifests:** Any directory manifest inside `docs/` is named `MANIFEST.md` (which is auto-stripped), never misspelled as `MINIFEST.md`.
9. **Working Relative Links & Assets:** Every internal Markdown link (`[Guide](guide.md)`) and image (`![Img](./assets/img.png)`) points to an existing file inside `docsPath`.
10. **Logo Compliance:** If `logoPath` is set, the file exists at that exact path, is under `2 MB`, and (if `.svg`) contains zero `<script>`, `<foreignObject>`, event handlers, or external URLs.
