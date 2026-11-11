// The technologies, drawn as six constellations. Everything about them lives here.
//
// Each star:  name, and how it is drawn.
//   icon  a simple-icons export name, shown beside the name. `mono` replaces it when a brand has none.
//   x, y  position in percent of a square chart (keep them between 10 and 90).
//   size  1 small, 2 medium, 3 bright.       glow  0..1, how much light it gives.
// Each group: `links`, pairs of star indexes joined by a line. Lines may branch; keep them from crossing.
// Spacing rule that keeps names apart: two stars are at least 22 apart in y or 34 apart in x.
// A star without x/y is placed automatically.
import type { Lang } from '../i18n/ui';

export interface Skill { name: string; icon?: string; mono?: string; x?: number; y?: number; size?: 1 | 2 | 3; glow?: number }
export interface SkillGroup { id: string; name: Record<Lang, string>; items: Skill[]; links?: [number, number][] }

export const skillGroups: SkillGroup[] = [
  {
    id: 'frontend',
    name: { es: 'Frontend', en: 'Frontend' },
    items: [
      { name: 'React', icon: 'siReact', x: 16, y: 10, size: 3, glow: 1 },
      { name: 'TypeScript', icon: 'siTypescript', x: 58, y: 13, size: 3, glow: 0.9 },
      { name: 'JavaScript', icon: 'siJavascript', x: 84, y: 36, size: 2, glow: 0.7 },
      { name: 'Blazor', icon: 'siBlazor', x: 40, y: 34, size: 2, glow: 0.7 },
      { name: 'Tailwind CSS', icon: 'siTailwindcss', x: 20, y: 60, size: 2, glow: 0.6 },
      { name: 'Astro', icon: 'siAstro', x: 62, y: 62, size: 1, glow: 0.5 },
      { name: 'HTML & CSS', icon: 'siHtml5', x: 44, y: 86, size: 1, glow: 0.45 },
    ],
    links: [[0, 1], [1, 2], [1, 3], [3, 4], [3, 5], [5, 6]],
  },
  {
    id: 'backend',
    name: { es: 'Backend', en: 'Backend' },
    items: [
      { name: 'Python', icon: 'siPython', x: 82, y: 10, size: 3, glow: 1 },
      { name: 'FastAPI', icon: 'siFastapi', x: 44, y: 13, size: 3, glow: 0.85 },
      { name: 'C#', mono: 'C#', x: 18, y: 36, size: 2, glow: 0.75 },
      { name: '.NET', icon: 'siDotnet', x: 58, y: 40, size: 2, glow: 0.7 },
      { name: 'Node.js', icon: 'siNodedotjs', x: 30, y: 63, size: 1, glow: 0.5 },
      { name: 'Java', icon: 'siOpenjdk', x: 72, y: 86, size: 1, glow: 0.45 },
    ],
    links: [[0, 1], [1, 2], [2, 3], [3, 4], [3, 5]],
  },
  {
    id: 'databases',
    name: { es: 'Bases de datos', en: 'Databases' },
    items: [
      { name: 'PostgreSQL', icon: 'siPostgresql', x: 20, y: 14, size: 2, glow: 0.8 },
      { name: 'Supabase', icon: 'siSupabase', x: 64, y: 30, size: 3, glow: 1 },
      { name: 'SQLite', icon: 'siSqlite', x: 32, y: 60, size: 2, glow: 0.65 },
      { name: 'Entity Framework', mono: 'EF', x: 78, y: 84, size: 1, glow: 0.5 },
    ],
    links: [[0, 1], [0, 2], [1, 3]],
  },
  {
    id: 'devops',
    name: { es: 'DevOps / Infraestructura', en: 'DevOps / Infrastructure' },
    items: [
      { name: 'Docker', icon: 'siDocker', x: 14, y: 12, size: 3, glow: 0.95 },
      { name: 'Linux', icon: 'siLinux', x: 50, y: 22, size: 2, glow: 0.75 },
      { name: 'GitHub Actions', icon: 'siGithubactions', x: 84, y: 12, size: 2, glow: 0.7 },
      { name: 'GitHub Pages', icon: 'siGithubpages', x: 68, y: 52, size: 1, glow: 0.5 },
      { name: 'Nginx', icon: 'siNginx', x: 30, y: 80, size: 1, glow: 0.5 },
    ],
    links: [[0, 1], [1, 2], [1, 3], [1, 4]],
  },
  {
    id: 'ai',
    name: { es: 'IA / Automatización', en: 'AI / Automation' },
    items: [
      { name: 'Claude Code', icon: 'siClaude', x: 82, y: 14, size: 3, glow: 1 },
      { name: 'OpenAI Codex', mono: 'Cx', x: 46, y: 24, size: 2, glow: 0.75 },
      { name: 'Cursor', icon: 'siCursor', x: 16, y: 48, size: 2, glow: 0.7 },
      { name: 'Groq', mono: 'Gq', x: 22, y: 78, size: 1, glow: 0.5 },
      { name: 'OpenAI-compatible APIs', mono: 'API', x: 66, y: 60, size: 2, glow: 0.65 },
    ],
    links: [[0, 1], [1, 2], [1, 4], [2, 3]],
  },
  {
    id: 'tools',
    name: { es: 'Herramientas', en: 'Tools' },
    items: [
      { name: 'Git', icon: 'siGit', x: 18, y: 82, size: 3, glow: 0.95 },
      { name: 'GitHub', icon: 'siGithub', x: 40, y: 52, size: 3, glow: 0.9 },
      { name: 'Vite', icon: 'siVite', x: 78, y: 66, size: 2, glow: 0.65 },
      { name: 'Vitest', icon: 'siVitest', x: 60, y: 26, size: 1, glow: 0.5 },
      { name: 'Pytest', icon: 'siPytest', x: 26, y: 12, size: 1, glow: 0.5 },
    ],
    links: [[0, 1], [1, 2], [1, 3], [3, 4]],
  },
];
