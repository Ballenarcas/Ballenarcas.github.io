import { getCollection, type CollectionEntry } from 'astro:content';
import type { Lang } from './i18n/ui';
import { projectSort } from './data/site';

export type Project = CollectionEntry<'projects'>;
export const slugOf = (p: Project) => p.id.split('/')[1];

/** Published projects of one language: featured first, then by priority or by date. */
export async function projectsFor(lang: Lang, sort: 'priority' | 'date' = projectSort): Promise<Project[]> {
  const all = await getCollection('projects', (p) => p.id.startsWith(`${lang}/`) && !(import.meta.env.PROD && p.data.draft));
  const by = sort === 'date'
    ? (a: Project, b: Project) => b.data.date.getTime() - a.data.date.getTime()
    : (a: Project, b: Project) => a.data.order - b.data.order;
  return all.sort((a, b) => Number(b.data.featured) - Number(a.data.featured) || by(a, b));
}
