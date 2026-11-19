# Contributing to DocScaffold

Contributions are welcome when they are narrowly scoped, testable and safe for public distribution.

## Workflow

1. Fork the repository and install Node.js 22.23.4+ and npm.
2. Run `npm ci` to install locked dependencies.
3. Run `npm test`, `npm run lint` and `npm run verify` before submitting a pull request.
4. Describe the behavior change, update user-facing docs if needed and note security considerations.

## Public data boundaries

- Never commit credentials, private product documentation, non-public repository URLs, personal information or deployment settings.
- Keep product-specific documentation in that product's own repository; this project provides the reusable engine.
- Do not commit generated output in `dist/`, `src/content/docs/`, `src/generated/` or `public/logos/`.
- Use placeholders such as `https://github.com/YOUR_ORG/YOUR_PUBLIC_REPO.git` in examples.
- Report vulnerabilities privately using [SECURITY.md](SECURITY.md).

See [docs/adding-projects.md](docs/adding-projects.md) for configuration instructions.
