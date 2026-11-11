import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// One MDX file per project and language: src/content/projects/<lang>/<slug>.mdx
// The front matter below is the whole data model of a project. Nothing about a project lives in a component.
const projects = defineCollection({
  loader: glob({ pattern: '{es,en}/*.mdx', base: './src/content/projects' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      tagline: z.string(),
      summary: z.string().max(220),
      status: z.enum(['completed', 'in-progress', 'archived']),
      /** Featured projects get a full expedition; the rest are listed compactly under them. */
      featured: z.boolean().default(false),
      /** Used by the filters. Any new category shows up as a filter by itself. */
      categories: z.array(z.string()).default([]),
      /** Last meaningful update, used when the list is sorted by date. */
      date: z.coerce.date(),
      /** Lower numbers come first when the list is sorted by priority. */
      order: z.number().int().default(99),
      role: z.string().optional(),
      context: z.string().optional(),
      year: z.number().int(),
      stack: z.array(z.string()).min(1),
      repo: z.string().url(),
      demo: z.string().url().optional(),
      /** Colour of the project's planet. */
      accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      cover: image(),
      coverAlt: z.string(),
      gallery: z.array(z.object({ src: image(), alt: z.string() })).default([]),
      // Films live in public/videos. `loop` is the short silent clip, `video` the full film.
      loop: z.string().optional(),
      video: z.string().optional(),
      videoPoster: image().optional(),
      videoOrientation: z.enum(['portrait', 'landscape']).default('landscape'),
      videoNote: z.string().optional(),
      draft: z.boolean().default(false),
    }),
});

export const collections = { projects };
