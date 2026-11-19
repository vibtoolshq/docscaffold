# Go-Live Deployment Runbook

This runbook exports the single engine into independent user and developer portal repositories, verifies the static build, and connects product repositories to protected deployment hooks. Each portal owns its own config, Git credentials, project registry, and webhook URL.

## 1. Split into two portals

Run these commands from the engine repository root. The output directories must not already exist:

```sh
npm run export-portal -- --portal user --out ../docs-vib-tools
npm run export-portal -- --portal dev --out ../developer-vibtools-io
```

The exporter copies the engine source while excluding dependencies, build output, generated documentation, generated logos, development notes, `.aistudio`, `public/assets/aistudio`, `bun.lock`, and the presets directory (and omits engine `.vibtools/` when exporting `--portal user`). It installs the matching preset files as each export's active `config/site.config.json` (`"portalType": "users"` for `docs.vib.tools` and `"portalType": "developer"` for `developer.vibtools.io`) and `config/projects.json`, updates `wrangler.toml` (`name = "docs-vib-tools"` vs `name = "developer-vibtools-io"`) and `public/site.webmanifest` branding/theme color, and preserves the `.gitkeep` files in generated folders.

Because `scripts/sync-docs.mjs` matches each portal's `portalType` against each repository's `.vibtools/docs.config.json` (or `config.docs.json`) `docsType` and `targets` block, a shared repository URL can live in one or both portal registries while checking out only the matching audience's `docsPath`. See [`.vibtools/` Configuration](vibtools-config.md).

Before building in production (`CF_PAGES=1` or `STRICT_SYNC=1`), replace all `YOUR_ORG` repository URLs in the user and developer presets with real documentation repositories (or add new `.vibtools/` repositories with `npm run add-project -- --url <repoUrl>`). Production CI builds reject unreplaced `YOUR_ORG` starter placeholders automatically. Review each CTA, category, branch, and `docsPath`. Then initialize and push each exported directory to its own deployment repository:

```sh
cd ../docs-vib-tools
git init
npm install
npm run build
```

Repeat for `../developer-vibtools-io`. Never copy generated content or credentials from one portal to the other.

## 2. Deploy with Cloudflare Pages & Functions

Create a separate Pages project for each exported Git repository. The repository includes `wrangler.toml`, `.node-version`, `.nvmrc`, `package-lock.json`, `public/_headers`, `public/_redirects`, `public/_routes.json`, and `functions/api/` out of the box:

- Build command: `npm run build` (or `npm run cf:build`)
- Build output directory: `dist`
- Node.js version: pinned automatically to `22.23.5` via `.node-version` and `.nvmrc` (an official Node.js 22 release satisfying Astro 7's `>=22.23.4` requirement and `engines.node >=22.23.4` in `package.json`).
- Private repository credentials:
  - Single shared org/account token: add `GIT_TOKEN` as a protected Pages environment secret. Add `GIT_USERNAME` only if that Git host needs a non-default username.
  - Multiple independent private repositories: create distinct Pages environment secrets (e.g., `GIT_TOKEN_APP1`, `GIT_TOKEN_APP2`) and reference them per project via `"secretKey": "$GIT_TOKEN_APP1"` in `config/projects.json`.
- Static Edge & Functions routing:
  - `public/_headers`: configures immutable caching for `/_astro/*`, revalidation for `/pagefind/*`, `Content-Type` + cache headers for `/llms.txt`, `/llms-full.txt`, `/*/llms.txt`, `/*.md`, `/site.webmanifest`, and `/robots.txt`, plus security headers. Internal `public/MANIFEST.md`, `public/README.md`, and any `public/assets/aistudio/` workspace files are automatically pruned from `dist/` at build completion.
  - `public/_redirects`: holds relative-path redirect rules (Cloudflare Pages `_redirects` does not support custom-domain-to-domain redirects).
  - `public/_routes.json`: restricts Cloudflare Pages Functions invocation strictly to `/api/*` so all documentation pages serve directly from the static CDN edge.
- Built-in Pages Functions (`functions/api/`):
  - `GET /api/health` & `HEAD /api/health`: returns JSON health and runtime readiness status (`200` on `GET`/`HEAD`, `405` on other methods).
  - `POST /api/webhook`: optional authenticated webhook relay. Set `CF_DEPLOY_HOOK_URL` (the portal's HTTPS Cloudflare Pages Deploy Hook URL) and `WEBHOOK_SECRET` in Pages environment variables. `POST /api/webhook` fails closed with HTTP `501` when `WEBHOOK_SECRET` is missing unless `ALLOW_UNAUTHENTICATED_WEBHOOK="true"` is explicitly configured for development. Supports GitHub (`X-Hub-Signature-256`), Gitea/Forgejo (`X-Gitea-Signature`, `X-Forgejo-Signature`) HMAC-SHA256 signatures, `X-Gitlab-Token`, `X-Webhook-Secret`, and `Authorization: Bearer <secret>`, ignores initial `ping` events with HTTP `200`, and parses both JSON and `application/x-www-form-urlencoded` payloads for `ALLOWED_BRANCHES` (e.g., `main,docs`).
- Attach `docs.vib.tools` to the user portal and `developer.vibtools.io` to the developer portal.
- For the legacy `docs.vibtools.io` hostname, add a Cloudflare Zone Redirect Rule in the dashboard: match `docs.vibtools.io/*`, redirect to `https://docs.vib.tools/$1`, status `301`.

Create a separate protected Pages build hook for each portal. Product repository webhooks must call only the portal whose registry contains that product.

## 3. Deploy to a VPS with Docker or Coolify

The repository's multi-stage `Dockerfile` installs `git` and `openssh-client` in `node:22-alpine` for sparse-checkout builds and copies only `dist/` into `nginx:alpine`. `nginx.conf` mirrors `public/_headers` with gzip, global security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`), immutable 1-year caching for `/_astro/*`, 1-hour `must-revalidate` caching for `/pagefind/*`, `text/markdown; charset=utf-8` / `text/plain; charset=utf-8` responses for `.md` and `llms.txt`, and the static 404 route.

For private docs repositories, provide a BuildKit secret rather than committing a token or putting it in the final image:

```sh
docker buildx build --secret id=git_token,env=GIT_TOKEN -t vib-docs-engine:latest .
docker run --rm -p 8080:80 vib-docs-engine:latest
```

In Coolify, configure the Git repository, Dockerfile build, port `80`, portal domain, and `GIT_TOKEN` as a build secret/environment secret. Use separate services and secrets for the two portals. Configure a protected webhook or CI trigger to rebuild the right service. The webhook receiver must verify signatures, rate-limit requests, and publish only a successfully built image; Nginx serves static files and never fetches docs at request time.

## 4. Connect product repositories

For a GitHub product repository, copy `templates/github-notify-docs.yml` to `.github/workflows/notify-docs.yml`. Add the repository Actions secret `DOCS_DEPLOY_HOOK_URL` with the protected build-hook URL for the correct portal. The workflow listens for pushes to `main` that modify `docs/**` or `.vibtools/**` and sends a POST request to the hook.

For GitLab, Gitea/Forgejo, or a VPS receiver, use `templates/webhook-trigger.sh` as the curl request. Store `DOCS_DEPLOY_HOOK_URL` as a protected CI/webhook secret. Configure source-host signature verification and path/event filters where available; do not expose hook URLs in logs or source code.

## Final launch checks

Before DNS cutover, run `npm test`, `npm run lint`, and `npm run verify` in each portal repository. Confirm the selected preset and real repository URLs, private-repo access, static routes, Pagefind index, sitemap, robots, global and per-product `llms.txt`, per-page `.md` exports, and 404 output. Test one product docs push and confirm only its intended portal rebuilds. Preview a local build with `npm run preview` before publishing changes.
