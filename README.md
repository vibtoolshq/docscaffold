# DocScaffold

<img src="public/docscaffold-icon.svg" alt="DocScaffold icon" width="88" height="88" />

**DocScaffold** is an open-source, configuration-driven documentation portal built with Astro, MDX, Tailwind CSS and Pagefind. It aggregates Markdown/MDX guides from separate Git repositories without bundling those projects' source code.

This is the public, engine-only distribution of Vib Docs Engine, maintained by [Vib Tools](https://vib.tools/).

**Stable release:** [v1.0.0](https://github.com/vibtoolshq/docscaffold/releases/tag/v1.0.0).

## Features

- Multi-project documentation hub with user and developer portal presets
- Repository-driven `.vibtools/docs.config.json` discovery and Git sparse checkout
- Navigation tree, table of contents, search, dark/light theme and responsive layouts
- SEO routes, sitemap, raw Markdown and AI/LLM-readable endpoints
- Static deployment to Cloudflare Pages or Docker/Nginx
- Optional authenticated webhook endpoint for triggering rebuilds

## Requirements

Node.js 22.23.4 or newer, npm and Git with sparse-checkout support. The validated Node version is pinned in `.nvmrc`.

## Quick start

```bash
git clone https://github.com/vibtoolshq/docscaffold.git
cd docscaffold
npm ci
npm run dev
```

Open http://localhost:3000. The starter registry includes **only this public repository**. The end-user portal preset starts **empty**. No private project documentation is bundled.

Before production deployment, set your actual HTTPS domain in `config/site.config.json` and adjust the portal branding. Choose `portalType` as `users`, `developer` or `all`. Register only public, publishable projects, for example:

```bash
npm run add-project -- --url https://github.com/YOUR_ORG/YOUR_PUBLIC_REPO.git
```

Each product can define `.vibtools/docs.config.json` and keep its documentation in its own `docs/` directory. Private repositories require explicit operator opt-in and CI/environment secrets; **never commit private repository URLs, docs, tokens or passwords to this project**.

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Sync allowed docs and run local dev server |
| `npm run build` | Build static HTML and Pagefind search index |
| `npm run preview` | Preview the built site |
| `npm test` | Unit tests |
| `npm run lint` | Type checks |
| `npm run verify` | Build and structural verification |
| `npm run export-portal -- --portal dev --out ../your-dev-site` | Export a dedicated portal |

## Guides

- [Operator and API overview](docs/index.md)
- [Adding projects](docs/adding-projects.md)
- [Repository metadata and docs format](docs/vibtools-config.md)
- [Cloudflare and Docker deployment](docs/deployment.md)
- [Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md)

Cloudflare Pages: build command `npm run build`, output `dist`; Node.js 22.23.4+. Docker: use the included multi-stage `Dockerfile` and `nginx.conf`. Deployment credentials remain in your provider's secrets manager.

## Public release boundary

This repository contains the application, tests and example configurations only. It intentionally omits private product docs, real credentials, internal engineering notes, debug logs, generated build output and the upstream Git commit history. The default registries contain no private docs repositories.

## License

MIT — see [LICENSE](LICENSE). Copyright © 2026 Vib Tools.
