import type { APIRoute } from "astro";
import manifestData from "../../generated/manifest.json";
import type { ProjectManifest } from "../../utils/manifest";
import { resolveAbsoluteUrl } from "../../utils/seo";
import {
  buildVibtoolsJsonSchema,
  VIBTOOLS_SCHEMA_PATH,
} from "../../utils/vibtoolsConfig";

const manifest = manifestData as ProjectManifest;

export const GET: APIRoute = () => {
  const schemaId = resolveAbsoluteUrl(
    VIBTOOLS_SCHEMA_PATH,
    manifest.site.domain,
  );
  const schema = buildVibtoolsJsonSchema(schemaId);
  return new Response(`${JSON.stringify(schema, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/schema+json; charset=utf-8",
    },
  });
};
