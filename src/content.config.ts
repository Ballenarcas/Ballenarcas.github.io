import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

// One MDX file per project and language: src/content/projects/<lang>/<slug>.mdx
const projects = defineCollection({
  loader: glob({ pattern: '{es,en}/*.mdx', base: './src/content/projects' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      tagline: z.string(),
      summary: z.string().max(220),
      role: z.string().optional(),
      context: z.string().optional(),
      year: z.number().int(),
      stack: z.array(z.string()).min(1),
      repo: z.string().url(),
      demo: z.string().url().optional(),
      // The project's own colour world: the page takes these on its project screens.
      ground: hex,
      ink: hex,
      cover: image(),
      coverAlt: z.string(),
      gallery: z.array(z.object({ src: image(), alt: z.string() })).default([]),
      // Films live in public/videos. `loop` is the short silent clip, `video` the full film.
      loop: z.string().optional(),
      video: z.string().optional(),
      videoPoster: image().optional(),
      videoOrientation: z.enum(['portrait', 'landscape']).default('landscape'),
      videoNote: z.string().optional(),
      order: z.number().int().default(99),
      draft: z.boolean().default(false),
    }),
});

export const collections = { projects };
