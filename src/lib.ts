import { getCollection, type CollectionEntry } from 'astro:content';
import type { Lang } from './i18n/ui';

/** Published projects of one language, in portfolio order. */
export async function projectsFor(lang: Lang): Promise<CollectionEntry<'projects'>[]> {
  const all = await getCollection('projects', (p) => p.id.startsWith(`${lang}/`) && !(import.meta.env.PROD && p.data.draft));
  return all.sort((a, b) => a.data.order - b.data.order);
}
