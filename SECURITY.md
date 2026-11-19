# Security Policy

Please report vulnerabilities affecting DocScaffold privately to **support@vibtools.io** rather than opening a public issue. Do not publish real tokens, proof-of-concept exploits against live services or private documentation.

## Operator guidance

- Keep private repository tokens and deploy-hook URLs in CI/hosting secrets, never tracked source.
- Require webhook authentication in production. Never set `ALLOW_UNAUTHENTICATED_WEBHOOK=true` in production.
- Allowlist intended repositories and branches; do not automatically onboard private products.
- Review untrusted Markdown/MDX content before rendering or deploying.
- Use HTTPS and rotate leaked credentials immediately.

Supported development target: the current `main` branch. Security fixes will be provided by the maintainers when available.
