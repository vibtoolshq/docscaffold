import assert from "node:assert/strict";
import test from "node:test";
import { formatVersionBadge } from "./theme";
import {
  buildVibtoolsJsonSchema,
  deriveSlugFromSource,
  extractMarkdownMetadata,
  normalizeRegistryEntry,
  parseVibtoolsRepoConfig,
  resolvePortalProjectConfig,
  VIBTOOLS_SCHEMA_PATH,
} from "./vibtoolsConfig";

test("parseVibtoolsRepoConfig validates single and dual target configs cleanly", () => {
  const validDual = parseVibtoolsRepoConfig({
    $schema: "https://docs.vib.tools/schemas/vibtools-docs.schema.json",
    schemaVersion: 1,
    slug: "calgrid",
    title: "CalGrid",
    version: "1.0.2",
    accentColor: "#2563EB",
    logoPath: ".vibtools/logo.png",
    targets: {
      users: {
        category: "Desktop Apps",
        description: "User guides for CalGrid.",
        docsPath: "docs/users",
        ctaLabel: "Get CalGrid",
        ctaUrl: "https://vib.tools/calgrid",
      },
      developer: {
        slug: "calgrid-sdk",
        title: "CalGrid SDK",
        category: "SDKs & Modules",
        docsPath: "docs/dev",
      },
    },
  });

  assert.equal(validDual.success, true);
  if (validDual.success) {
    assert.equal(
      validDual.data.$schema,
      "https://docs.vib.tools/schemas/vibtools-docs.schema.json",
    );
    assert.equal(validDual.data.targets?.users?.docsPath, "docs/users");
    assert.equal(validDual.data.targets?.developer?.slug, "calgrid-sdk");
  }
});

test("parseVibtoolsRepoConfig rejects path traversal, invalid slug, and invalid accentColor", () => {
  const traversal = parseVibtoolsRepoConfig({ docsPath: "../secret" });
  assert.equal(traversal.success, false);

  const logoAbsolute = parseVibtoolsRepoConfig({ logoPath: "/etc/passwd" });
  assert.equal(logoAbsolute.success, false);

  const badSlug = parseVibtoolsRepoConfig({ slug: "CalGrid_App" });
  assert.equal(badSlug.success, false);

  const badAccent = parseVibtoolsRepoConfig({ accentColor: "purple" });
  assert.equal(badAccent.success, false);

  const emptySchema = parseVibtoolsRepoConfig({ $schema: "   " });
  assert.equal(emptySchema.success, false);
});

test("normalizeRegistryEntry supports bare repoUrl strings and rejects embedded credentials", () => {
  const urlOnly = normalizeRegistryEntry("https://github.com/vibtools/calgrid.git");
  assert.equal(urlOnly.success, true);
  if (urlOnly.success) {
    assert.equal(urlOnly.data.repoUrl, "https://github.com/vibtools/calgrid.git");
  }

  const withCreds = normalizeRegistryEntry("https://user:token@github.com/vibtools/calgrid.git");
  assert.equal(withCreds.success, false);

  assert.equal(deriveSlugFromSource("https://github.com/vibtools/Cal_Grid.git"), "cal-grid");
});

test("resolvePortalProjectConfig selects users vs developer target and skips mismatches cleanly", () => {
  const parsed = parseVibtoolsRepoConfig({
    schemaVersion: 1,
    slug: "calgrid",
    title: "CalGrid",
    version: "1.0.2",
    accentColor: "#2563EB",
    logoPath: ".vibtools/logo.png",
    targets: {
      users: {
        category: "Desktop Apps",
        docsPath: "docs/users",
      },
      developer: {
        slug: "calgrid-sdk",
        title: "CalGrid SDK",
        category: "SDKs & Modules",
        docsPath: "docs/dev",
      },
    },
  });
  assert.equal(parsed.success, true);
  if (!parsed.success) return;

  const entry = normalizeRegistryEntry("https://github.com/vibtools/calgrid.git");
  assert.equal(entry.success, true);
  if (!entry.success) return;

  const usersResolved = resolvePortalProjectConfig({
    portalType: "users",
    registryEntry: entry.data,
    remoteConfig: parsed.data,
  });
  assert.equal(usersResolved.matched, true);
  if (usersResolved.matched) {
    assert.equal(usersResolved.project.slug, "calgrid");
    assert.equal(usersResolved.project.docsPath, "docs/users");
    assert.equal(usersResolved.project.logoPath, ".vibtools/logo.png");
  }

  const devResolved = resolvePortalProjectConfig({
    portalType: "developer",
    registryEntry: entry.data,
    remoteConfig: parsed.data,
  });
  assert.equal(devResolved.matched, true);
  if (devResolved.matched) {
    assert.equal(devResolved.project.slug, "calgrid-sdk");
    assert.equal(devResolved.project.title, "CalGrid SDK");
    assert.equal(devResolved.project.docsPath, "docs/dev");
  }

  const devOnly = parseVibtoolsRepoConfig({
    docsType: "developer",
    slug: "engine",
    category: "Core Engine",
  });
  assert.equal(devOnly.success, true);
  if (devOnly.success) {
    const skipped = resolvePortalProjectConfig({
      portalType: "users",
      registryEntry: entry.data,
      remoteConfig: devOnly.data,
    });
    assert.equal(skipped.matched, false);
  }
});

test("resolvePortalProjectConfig lets portal registry override .vibtools values", () => {
  const parsed = parseVibtoolsRepoConfig({
    docsType: "users",
    slug: "calgrid",
    category: "Tools",
    accentColor: "#2563EB",
    docsPath: "docs/users",
  });
  const overrideEntry = normalizeRegistryEntry({
    repoUrl: "https://github.com/vibtools/calgrid.git",
    slug: "calgrid-custom",
    accentColor: "#10B981",
  });
  assert.equal(parsed.success, true);
  assert.equal(overrideEntry.success, true);
  if (!parsed.success || !overrideEntry.success) return;

  const resolved = resolvePortalProjectConfig({
    portalType: "users",
    registryEntry: overrideEntry.data,
    remoteConfig: parsed.data,
  });
  assert.equal(resolved.matched, true);
  if (resolved.matched) {
    assert.equal(resolved.project.slug, "calgrid-custom");
    assert.equal(resolved.project.accentColor, "#10B981");
    assert.equal(resolved.project.docsPath, "docs/users");
  }
});

test("extractMarkdownMetadata extracts clean title, first paragraph description, and version without frontmatter", () => {
  const sampleCalGridMarkdown = `# CalGrid — User Documentation

**CalGrid** is a Windows desktop application for scheduling and batch-sending Google Calendar invitations at scale. With a multi-workspace interface, smart anti-spam engine, Google Drive attachments, and brand identity tools, CalGrid is built for high-deliverability calendar outreach.

---

## About CalGrid

CalGrid v1.0.2 — Google Calendar Dispatcher
`;

  const extracted = extractMarkdownMetadata(sampleCalGridMarkdown);
  assert.equal(extracted.title, "CalGrid");
  assert.equal(
    extracted.description,
    "CalGrid is a Windows desktop application for scheduling and batch-sending Google Calendar invitations at scale.",
  );
  assert.equal(extracted.version, "1.0.2");
});

test("resolvePortalProjectConfig honors registry docsType when portalType is all on dual-target repos", () => {
  const parsed = parseVibtoolsRepoConfig({
    schemaVersion: 1,
    docsType: "both",
    title: "Invio",
    targets: {
      users: {
        slug: "invio",
        docsPath: "docs/users",
      },
      developer: {
        slug: "invio-sdk",
        title: "Invio SDK",
        docsPath: "docs/developer",
      },
    },
  });
  assert.equal(parsed.success, true);
  if (!parsed.success) return;

  const devEntry = normalizeRegistryEntry({
    repoUrl: "https://github.com/example-org/sample-docs.git",
    slug: "invio-sdk",
    docsType: "developer",
  });
  const usersEntry = normalizeRegistryEntry({
    repoUrl: "https://github.com/example-org/sample-docs.git",
    slug: "invio",
    docsType: "users",
  });
  assert.equal(devEntry.success, true);
  assert.equal(usersEntry.success, true);
  if (!devEntry.success || !usersEntry.success) return;

  const devResolved = resolvePortalProjectConfig({
    portalType: "all",
    registryEntry: devEntry.data,
    remoteConfig: parsed.data,
  });
  assert.equal(devResolved.matched, true);
  if (devResolved.matched) {
    assert.equal(devResolved.project.slug, "invio-sdk");
    assert.equal(devResolved.project.docsPath, "docs/developer");
    assert.equal(devResolved.project.docsType, "developer");
  }

  const usersResolved = resolvePortalProjectConfig({
    portalType: "all",
    registryEntry: usersEntry.data,
    remoteConfig: parsed.data,
  });
  assert.equal(usersResolved.matched, true);
  if (usersResolved.matched) {
    assert.equal(usersResolved.project.slug, "invio");
    assert.equal(usersResolved.project.docsPath, "docs/users");
    assert.equal(usersResolved.project.docsType, "users");
  }
});

test("formatVersionBadge normalizes leading v prefixes cleanly", () => {
  assert.equal(formatVersionBadge("1.0.2"), "v1.0.2");
  assert.equal(formatVersionBadge("v1.0.2"), "v1.0.2");
  assert.equal(formatVersionBadge("V2.4.0-rc1"), "v2.4.0-rc1");
  assert.equal(formatVersionBadge("vv0.1.0"), "v0.1.0");
  assert.equal(formatVersionBadge(1.2), "v1.2");
  assert.equal(formatVersionBadge(""), "");
  assert.equal(formatVersionBadge("v"), "");
  assert.equal(formatVersionBadge(undefined), "");
});

test("buildVibtoolsJsonSchema emits Draft 2020-12 schema with canonical $id and target definitions", () => {
  const schema = buildVibtoolsJsonSchema(
    `https://docs.vib.tools${VIBTOOLS_SCHEMA_PATH}`,
  );
  assert.equal(
    schema.$schema,
    "https://json-schema.org/draft/2020-12/schema",
  );
  assert.equal(
    schema.$id,
    "https://docs.vib.tools/schemas/vibtools-docs.schema.json",
  );
  assert.equal(schema.title, "VibToolsDocsConfig");
  assert.equal(typeof schema.properties, "object");
  assert.equal(typeof schema.$defs, "object");
});
