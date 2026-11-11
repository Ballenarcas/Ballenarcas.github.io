// The technologies shown as constellations. `icon` is a simple-icons export name; leave it out
// when the brand has no icon there and the star is drawn plain.
import type { Lang } from '../i18n/ui';

export interface Skill { name: string; icon?: string }
export interface SkillGroup { id: string; name: Record<Lang, string>; items: Skill[] }

export const skillGroups: SkillGroup[] = [
  {
    id: 'frontend',
    name: { es: 'Frontend', en: 'Frontend' },
    items: [
      { name: 'React', icon: 'siReact' },
      { name: 'TypeScript', icon: 'siTypescript' },
      { name: 'JavaScript', icon: 'siJavascript' },
      { name: 'Blazor', icon: 'siBlazor' },
      { name: 'Tailwind CSS', icon: 'siTailwindcss' },
      { name: 'Astro', icon: 'siAstro' },
      { name: 'HTML & CSS', icon: 'siHtml5' },
    ],
  },
  {
    id: 'backend',
    name: { es: 'Backend', en: 'Backend' },
    items: [
      { name: 'Python', icon: 'siPython' },
      { name: 'FastAPI', icon: 'siFastapi' },
      { name: 'C#' },
      { name: '.NET', icon: 'siDotnet' },
      { name: 'Node.js', icon: 'siNodedotjs' },
      { name: 'Java', icon: 'siOpenjdk' },
    ],
  },
  {
    id: 'databases',
    name: { es: 'Bases de datos', en: 'Databases' },
    items: [
      { name: 'PostgreSQL', icon: 'siPostgresql' },
      { name: 'Supabase', icon: 'siSupabase' },
      { name: 'SQLite', icon: 'siSqlite' },
      { name: 'Entity Framework' },
    ],
  },
  {
    id: 'devops',
    name: { es: 'DevOps / Infraestructura', en: 'DevOps / Infrastructure' },
    items: [
      { name: 'Docker', icon: 'siDocker' },
      { name: 'Linux', icon: 'siLinux' },
      { name: 'GitHub Actions', icon: 'siGithubactions' },
      { name: 'GitHub Pages', icon: 'siGithubpages' },
      { name: 'Nginx', icon: 'siNginx' },
    ],
  },
  {
    id: 'ai',
    name: { es: 'IA / Automatización', en: 'AI / Automation' },
    items: [
      { name: 'Claude Code', icon: 'siClaude' },
      { name: 'OpenAI Codex' },
      { name: 'Cursor', icon: 'siCursor' },
      { name: 'Groq' },
      { name: 'OpenAI-compatible APIs' },
    ],
  },
  {
    id: 'tools',
    name: { es: 'Herramientas', en: 'Tools' },
    items: [
      { name: 'Git', icon: 'siGit' },
      { name: 'GitHub', icon: 'siGithub' },
      { name: 'Vite', icon: 'siVite' },
      { name: 'Vitest', icon: 'siVitest' },
      { name: 'Pytest', icon: 'siPytest' },
    ],
  },
];
