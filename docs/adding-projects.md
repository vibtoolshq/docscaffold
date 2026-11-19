# Adding Projects

A product is added through configuration and a documentation repository. The intended workflow requires no application source changes.

The recommended approach places a self-contained `.vibtools/docs.config.json` (or `.vibtools/config.docs.json`) inside the product repository so the portal only needs a single repository URL in `config/projects.json`. Legacy per-portal objects in `config/projects.json` remain fully supported as overrides or fallbacks.

---

## 0. Organization Strategy (`vibtoolshq` vs `example-org`)

Before adding a project, confirm which GitHub organization hosts its documentation:

- **`https://github.com/vibtoolshq/<repo>` (Open-Source & Free Projects):**
  - The repository contains the open-source code, `.vibtools/docs.config.json`, and `docs/` (or `docs/users/` + `docs/dev/`).
  - Most projects here target `https://developer.vibtools.io` (`"docsType": "developer"`), while dual-audience projects (such as `LicenX`) use `"docsType": "both"` with `targets.users` and `targets.developer` so both portals can pull from the same repo URL.
- **`https://github.com/example-org/<repo>` (Docs-Only Repositories for Private Projects):**
  - When a product's application source code lives in a private repository, create a dedicated public **docs-only** repository at `https://github.com/example-org/<product>` containing only `.vibtools/` and `docs/`.
  - This keeps private source code completely isolated while allowing Cloudflare Pages or Docker builds to sync public documentation without private Git tokens.

---

## 1. Prepare the source repository (`.vibtools/` recommended)

Add a `.vibtools/docs.config.json` file in the repository root alongside your documentation folder (`docs/`, `docs/users/`, or `docs/dev/`):

```json
{
  "$schema": "https://docs.vib.tools/schemas/vibtools-docs.schema.json",
  "schemaVersion": 1,
  "docsType": "users",
  "slug": "product-name",
  "title": "Product Name",
  "category": "Desktop Apps",
  "description": "A concise description of this product.",
  "version": "1.2.0",
  "accentColor": "#22C55E",
  "docsPath": "docs",
  "logoPath": ".vibtools/logo.svg",
  "branch": "main",
  "ctaLabel": "Open Product",
  "ctaUrl": "https://vib.tools/product-name"
}
```

See the full schema (`/schemas/vibtools-docs.schema.json`), `targets.users` / `targets.developer` dual-portal setup, `docs/` authoring rules, and logo rules in [`.vibtools/` Configuration](vibtools-config.md).

### Markdown `index.md` & Smart Metadata Fallback

Every `docsPath` directory needs a root `index.md` (or `README.md`, which is automatically normalized to `index.md`). Explicit YAML frontmatter is recommended when you want exact control:

```md
---
title: Product Name
description: A concise description of this product.
version: "1.2.0"
---
```

If `index.md` does not contain YAML frontmatter, `scripts/sync-docs.mjs` falls back through `.vibtools/` configuration, `config/projects.json` overrides, and **Smart Markdown extraction** (reading the first `# H1` heading, first clean summary paragraph, and `vX.Y.Z` / `Version: X.Y.Z` markers automatically).

Optionally place your product logo at `.vibtools/logo.svg` (or `.png`), point `"logoPath"` at any validated relative file under `2 MB`, or place `logo.svg` / `logo.png` inside `docsPath`. Static SVGs are preferred (script/event/external-reference SVGs are rejected); when no logo is found, the UI generates a monogram.

---

## 2. Register the project in `config/projects.json`

### Zero-config `.vibtools/` URL entry (Recommended)

When the source repository contains `.vibtools/docs.config.json` (or `.vibtools/config.docs.json`), add its credential-free Git URL string to `config/projects.json`:

```json
[
  "https://github.com/vibtoolshq/LicenX.git",
  "https://github.com/vibtoolshq/SocketCore.git",
  "https://github.com/example-org/sample-docs.git"
]
```

Because `scripts/sync-docs.mjs` filters each repository's `.vibtools/` configuration against the active portal's `portalType` (`"users"` on `docs.vib.tools`, `"developer"` on `developer.vibtools.io`), you can even share a common list of repository URLs across both portals and each portal will automatically build only its matching targets.

### Quick CLI registration

Add a repository URL in one command:

```sh
npm run add-project -- --url https://github.com/vibtoolshq/LicenX.git
```

Pass optional override flags (`--slug`, `--category`, `--branch`, `--accent`, `--docs-path`, `--docs-type`, `--secret-key`, `--git-username`, `--cta-label`, `--cta-url`) only when a portal needs to override `.vibtools/` or provide private-repo auth. Running `npm run add-project` interactively also offers **[1] `.vibtools/` Auto** and **[2] Manual / Custom overrides**. Duplicate repository URLs are blocked unless a distinct `--slug` override is supplied.

### Manual override / legacy object format

If a repository does not include `.vibtools/` yet (or if a specific portal needs to override values in `.vibtools/`), store an object in `config/projects.json`:

```json
{
  "slug": "product-name",
  "category": "Developer Tools",
  "accentColor": "#22C55E",
  "repoUrl": "https://github.com/vibtoolshq/product-name.git",
  "secretKey": "$GIT_TOKEN",
  "branch": "main",
  "docsPath": "docs",
  "docsType": "developer",
  "ctaLabel": "View repository",
  "ctaUrl": "https://github.com/vibtoolshq/product-name",
  "title": "Product Name",
  "description": "Optional fallback if index.md and .vibtools lack a description.",
  "version": "1.2.0"
}
```

Use a unique, URL-safe slug. Category filters are derived dynamically from resolved project records. Repository URLs may use HTTPS or SSH Git transports for GitHub, GitLab, Gitea, or Forgejo, and must never contain embedded credentials.

---

## 3. Configure public vs. private repository access

- **Public repositories (`https://github.com/vibtoolshq/*` and `https://github.com/example-org/*`):** require no `secretKey` or `GIT_TOKEN`. Leave `secretKey` omitted and `scripts/sync-docs.mjs` performs a 2-step sparse checkout directly without credentials.
- **Private repositories:** set `secretKey` on the project in `config/projects.json` (an environment variable reference such as `"$GIT_TOKEN"` or `"GIT_TOKEN"`, plus optional `gitUsername` if your Git host requires a non-default username; GitLab defaults to `oauth2` and GitHub/Gitea/Forgejo default to `x-access-token`). `scripts/sync-docs.mjs` automatically strips `secretKey`, `gitToken`, `gitTokenEnv`, and `gitUsername` before writing `src/generated/manifest.json` and redacts them from error output.

---

## 4. Configure rebuild webhooks

Configure the source host to trigger the portal's protected build hook on pushes to the configured branch when files under `.vibtools/` or the documentation path change.

- **Cloudflare Pages:** create a Pages build hook for the appropriate deployment (or point the repository webhook at `/api/webhook`) and protect the hook URL / `WEBHOOK_SECRET` as secrets.
- **Docker/Nginx VPS:** use CI or a small protected webhook receiver to validate the provider's signature and start the build pipeline. Build to a staging directory and switch the served output only after sync, Astro, Pagefind, and `npm run verify` succeed.

---

## 5. Verify sync and the portal

Run `npm test`, `npm run sync`, then `npm run build` and `npm run verify` (`node scripts/verify-build.mjs`). Confirm `.vibtools/` validation passes, the product appears on the matching portal Hub (`portalType` vs `docsType`), metadata/logo are resolved cleanly, and Pagefind indexes the article body. On a product page, `Ctrl+K` searches that product by default; switch to “All Docs” for portal-wide results. Check `/llms.txt`, `/llms-full.txt`, `/<slug>/llms.txt`, `/<slug>/<page>.md`, `/schemas/vibtools-docs.schema.json`, `/robots.txt`, `/sitemap-index.xml`, and `/404`.

Use `npm run preview` to inspect the built static portal locally. For VPS testing with private repositories, build with `docker buildx build --secret id=git_token,env=GIT_TOKEN -t vib-docs-engine .` and run `docker run --rm -p 8080:80 vib-docs-engine`.

---

## 6. Select a portal preset

The engine includes paired starter configs with `"portalType"` configured:

- `config/presets/user-portal/` (`portalType: "users"`) for `docs.vib.tools`.
- `config/presets/dev-portal/` (`portalType: "developer"`) for `developer.vibtools.io`.

Use `npm run export-portal -- --portal <user|dev> --out <dir>` or copy both `site.config.json` and `projects.json` from the same preset directory into `config/`. Replace starter `YOUR_ORG` URLs with real `https://github.com/example-org/*` or `https://github.com/vibtoolshq/*` repositories before deploying.

---

## 7. Automate rebuilds from product repositories

For GitHub (`vibtoolshq` and `example-org` repositories), copy `templates/github-notify-docs.yml` into the product repository at `.github/workflows/notify-docs.yml` (which watches both `docs/**` and `.vibtools/**`) and set the `DOCS_DEPLOY_HOOK_URL` secret to the target portal's build hook.

For GitLab, Gitea/Forgejo, or a VPS receiver, use `templates/webhook-trigger.sh` and store `DOCS_DEPLOY_HOOK_URL` in protected CI secrets.
