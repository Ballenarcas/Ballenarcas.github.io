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
      tagline: z.string().optional(),
      summary: z.string().max(220),
      /** `private`: the project shows its name and summary only. It gets no page of its own and no links. */
      status: z.enum(['completed', 'in-progress', 'archived', 'private']),
      /** Featured projects get a full expedition; the rest are listed compactly under them. */
      featured: z.boolean().default(false),
      /** Kinds of project. Kept in the data; the site does not show them at the moment. */
      categories: z.array(z.string()).default([]),
      /** Last meaningful update, used when the list is sorted by date. */
      date: z.coerce.date(),
      /** Lower numbers come first when the list is sorted by priority. */
      order: z.number().int().default(99),
      role: z.string().optional(),
      context: z.string().optional(),
      year: z.number().int(),
      stack: z.array(z.string()).default([]),
      repo: z.string().url().optional(),
      demo: z.string().url().optional(),
      /** Colour of the project's planet. */
      accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      /** The planet in the 3D orbit: a designed look, its second colour and its size. All optional. */
      planet: z.enum(['tech', 'organic', 'network', 'celestial']).optional(),
      accent2: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      planetSize: z.enum(['medium', 'medium-large']).optional(),
      cover: image().optional(),
      coverAlt: z.string().default(''),
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
