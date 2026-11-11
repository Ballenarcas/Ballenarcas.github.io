# Ángel Espada · Portfolio

The source of [ballenarcas.github.io](https://ballenarcas.github.io): a bilingual (Spanish and English) portfolio built with [Astro](https://astro.build). Every push to `main` publishes the site through GitHub Actions.

## Run it

You need Node 22 or newer.

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run build
```

`npm run check` type-checks the project, including the front matter of every project file.

## Add a project in 4 steps

1. **Copy the template** `src/content/projects/_template.mdx.txt` to `src/content/projects/es/<slug>.mdx` and `src/content/projects/en/<slug>.mdx`. Use the same `<slug>` in both.
2. **Add the pictures** to `src/assets/projects/<slug>/` (a cover and, if you like, a gallery). Optional films go in `public/videos/`: `<slug>-loop.mp4` plus a `<slug>-loop.jpg` poster for the short silent clip on the home page, and `<slug>.mp4` for the full film.
3. **Fill in the front matter** in both files. `ground` and `ink` are the project's own background and text colours; `order` sets its position. `draft: true` hides it from the published site.
4. **Push to `main`.** The project appears on the home page, gets its own page in both languages and joins the "next project" chain. No code changes are needed.

## Where things are

| Path | What it holds |
| --- | --- |
| `src/content/projects/` | One MDX case study per project and language |
| `src/content.config.ts` | The fields a project file can have |
| `src/i18n/ui.ts` | Interface texts, contact details and the skills list |
| `src/components/` | Hero, project panels, about, footer |
| `src/pages/[lang]/` | Home, about and project pages |
| `src/styles/global.css` | Colours, type sizes and every layout |
| `src/scripts/motion.ts` | Reveals, the hero project picker and the horizontal project scene |
| `.github/workflows/deploy.yml` | Build and publish to GitHub Pages |

## Notes

- The films of Boost and Votify were recorded with sample data.
- Animations switch off for visitors who ask their system for reduced motion.
- To publish, the repository needs **Settings → Pages → Source: GitHub Actions**.
