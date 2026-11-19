import type { PagesFunctionContext } from "./health";

export interface WebhookEnv {
  CF_DEPLOY_HOOK_URL?: string;
  DOCS_DEPLOY_HOOK_URL?: string;
  WEBHOOK_SECRET?: string;
  ALLOW_UNAUTHENTICATED_WEBHOOK?: string;
  ALLOWED_BRANCHES?: string;
  [key: string]: string | undefined;
}

function timingSafeEqualString(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

function extractDirectSecret(request: Request): string {
  const directHeader =
    request.headers.get("x-webhook-secret") ??
    request.headers.get("x-gitlab-token") ??
    "";
  if (directHeader.trim()) return directHeader.trim();

  const authHeader = request.headers.get("authorization") ?? "";
  if (/^bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^bearer\s+/i, "").trim();
  }
  return "";
}

function extractHmacSignature(request: Request): string {
  return (
    request.headers.get("x-hub-signature-256") ??
    request.headers.get("x-gitea-signature") ??
    request.headers.get("x-forgejo-signature") ??
    ""
  ).trim();
}

function toLowerHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

async function verifyHmacSha256(
  secret: string,
  rawBody: string,
  signatureHeader: string,
): Promise<boolean> {
  const normalizedHex = signatureHeader.replace(/^sha256=/i, "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalizedHex)) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const expectedHex = toLowerHex(signature);
  return timingSafeEqualString(expectedHex, normalizedHex);
}

function isAllowedDeployHookUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === "https:") return true;
    return (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

function isPingWebhookEvent(request: Request): boolean {
  const eventName = (
    request.headers.get("x-github-event") ??
    request.headers.get("x-gitea-event") ??
    request.headers.get("x-forgejo-event") ??
    ""
  )
    .trim()
    .toLowerCase();
  return eventName === "ping";
}

function parseBranchFromPayload(
  rawBody: string,
  contentType = "",
): string | null {
  if (!rawBody.trim()) return null;
  let jsonSource = rawBody;
  if (
    contentType.toLowerCase().includes("application/x-www-form-urlencoded") ||
    rawBody.trimStart().startsWith("payload=")
  ) {
    const formPayload = new URLSearchParams(rawBody).get("payload");
    if (!formPayload) return null;
    jsonSource = formPayload;
  }
  try {
    const parsed = JSON.parse(jsonSource) as { ref?: unknown };
    if (typeof parsed?.ref !== "string") return null;
    const ref = parsed.ref.trim();
    if (!ref) return null;
    if (ref.startsWith("refs/heads/")) return ref.slice("refs/heads/".length);
    if (ref.startsWith("refs/")) return "";
    return ref;
  } catch {
    return null;
  }
}

export async function onRequestPost(
  context: PagesFunctionContext<WebhookEnv>,
): Promise<Response> {
  const { request, env } = context;
  const deployHookUrl = (
    env.CF_DEPLOY_HOOK_URL ??
    env.DOCS_DEPLOY_HOOK_URL ??
    ""
  ).trim();

  if (!deployHookUrl) {
    return Response.json(
      {
        ok: false,
        error:
          "CF_DEPLOY_HOOK_URL is not configured in Cloudflare Pages environment variables.",
      },
      { status: 501, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!isAllowedDeployHookUrl(deployHookUrl)) {
    return Response.json(
      {
        ok: false,
        error: "CF_DEPLOY_HOOK_URL must be a valid HTTPS URL.",
      },
      { status: 501, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rawBody = await request.text();
  const configuredSecret = (env.WEBHOOK_SECRET ?? "").trim();
  const allowUnauthenticated =
    (env.ALLOW_UNAUTHENTICATED_WEBHOOK ?? "").trim().toLowerCase() === "true";

  if (!configuredSecret) {
    if (!allowUnauthenticated) {
      return Response.json(
        {
          ok: false,
          error:
            "WEBHOOK_SECRET is not configured in Cloudflare Pages environment variables.",
        },
        { status: 501, headers: { "Cache-Control": "no-store" } },
      );
    }
  } else {
    const providedSecret = extractDirectSecret(request);
    const hasValidDirectSecret =
      Boolean(providedSecret) &&
      timingSafeEqualString(providedSecret, configuredSecret);

    let hasValidHmacSignature = false;
    if (!hasValidDirectSecret) {
      const signatureHeader = extractHmacSignature(request);
      if (signatureHeader) {
        hasValidHmacSignature = await verifyHmacSha256(
          configuredSecret,
          rawBody,
          signatureHeader,
        );
      }
    }

    if (!hasValidDirectSecret && !hasValidHmacSignature) {
      return Response.json(
        {
          ok: false,
          error: "Unauthorized webhook request.",
        },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  if (isPingWebhookEvent(request)) {
    return Response.json(
      {
        ok: true,
        triggered: false,
        skipped: true,
        reason: "ping_event",
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  const allowedBranchesRaw = (env.ALLOWED_BRANCHES ?? "").trim();
  if (allowedBranchesRaw) {
    const allowedBranches = new Set(
      allowedBranchesRaw
        .split(",")
        .map((branch) => branch.trim())
        .filter(Boolean),
    );
    const payloadBranch = parseBranchFromPayload(
      rawBody,
      request.headers.get("content-type") ?? "",
    );
    if (payloadBranch !== null && !allowedBranches.has(payloadBranch)) {
      return Response.json(
        {
          ok: true,
          triggered: false,
          skipped: true,
          reason: "branch_ignored",
          branch: payloadBranch || null,
        },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const hookResponse = await fetch(deployHookUrl, {
      method: "POST",
      headers: { "User-Agent": "vib-docs-engine-cloudflare-function" },
      signal: controller.signal,
    });
    const ok = hookResponse.ok;
    const status = hookResponse.status;
    await hookResponse.body?.cancel().catch(() => {});

    if (!ok) {
      return Response.json(
        {
          ok: false,
          error: `Deploy hook returned HTTP ${status}.`,
        },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    return Response.json(
      {
        ok: true,
        triggered: true,
        timestamp: new Date().toISOString(),
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        ok: false,
        error: "Failed to reach Cloudflare Pages deploy hook.",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export function onRequest(): Response {
  return Response.json(
    {
      ok: false,
      error: "Method Not Allowed. Use POST /api/webhook.",
    },
    {
      status: 405,
      headers: {
        Allow: "POST",
        "Cache-Control": "no-store",
      },
    },
  );
}
