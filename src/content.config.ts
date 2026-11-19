import { glob } from "astro/loaders";
import { defineCollection, z } from "astro:content";

const docs = defineCollection({
  loader: glob({
    pattern: "**/*.{md,mdx}",
    base: "./src/content/docs",
  }),
  schema: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      version: z.union([z.string(), z.number()]).optional(),
      order: z.number().optional(),
      draft: z.boolean().optional(),
      template: z.string().optional(),
    })
    .passthrough(),
});

export const collections = { docs };
