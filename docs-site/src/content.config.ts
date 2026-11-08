import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

/**
 * The docs pages are the repo's own `docs/*.md` files, read in place. Nothing
 * is copied or duplicated: edit `docs/getting-started.md` and the site shows it
 * on the next build.
 */
const docs = defineCollection({
  loader: glob({ pattern: "*.md", base: new URL("../../docs", import.meta.url) }),
  schema: z.object({
    title: z.string().optional(),
  }),
});

export const collections = { docs };
