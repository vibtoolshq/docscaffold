export interface PagesFunctionContext<Env = Record<string, string | undefined>> {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
  waitUntil: (promise: Promise<unknown>) => void;
  next: (input?: Request | string, init?: RequestInit) => Promise<Response>;
}

export function onRequestGet(): Response {
  return Response.json(
    {
      ok: true,
      service: "vib-docs-engine",
      runtime: "cloudflare-pages-functions",
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export function onRequestHead(): Response {
  return new Response(null, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export function onRequest(): Response {
  return Response.json(
    {
      ok: false,
      error: "Method Not Allowed. Use GET or HEAD /api/health.",
    },
    {
      status: 405,
      headers: {
        Allow: "GET, HEAD",
        "Cache-Control": "no-store",
      },
    },
  );
}
