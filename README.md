# Ángel Espada · Portfolio (Lunar Experience)

The source of [ballenarcas.github.io](https://ballenarcas.github.io): a bilingual (Spanish and English) portfolio told as a trip to the Moon. A 3D Moon grows, moves and changes its light with the scroll, through five scenes: home, about, skills, expeditions (the projects) and contact.

Built with [Astro](https://astro.build), [Three.js](https://threejs.org) and [GSAP](https://gsap.com). Every push to `main` publishes the site through GitHub Actions.

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

Projects are data. Nothing about a project is written in a component.

1. **Copy the template** `src/content/projects/_template.mdx.txt` to `src/content/projects/es/<slug>.mdx` and `src/content/projects/en/<slug>.mdx`. Use the same `<slug>` in both.
2. **Add the pictures** to `src/assets/projects/<slug>/`. Optional films go in `public/videos/`.
3. **Fill in the front matter** in both files:

   | Field | What it does |
   | --- | --- |
   | `status` | `completed`, `in-progress` or `archived` |
   | `featured` | `true` gives the project a full expedition; `false` lists it in one line under "More expeditions" |
   | `categories` | The filters. A new category appears as a filter by itself |
   | `order`, `date` | Position in the list. `src/data/site.ts` chooses whether the list is sorted by priority or by date |
   | `accent` | Colour of the project's planet |
   | `repo`, `demo` | Links. Leave `demo` out when there is none |
   | `draft` | `true` hides the project from the published site |

4. **Push to `main`.** The project appears among the expeditions, gets its own page in both languages and joins the "next expedition" chain.

To change or remove a project, edit or delete its two files.

## Where things are

| Path | What it holds |
| --- | --- |
| `src/content/projects/` | One MDX case study per project and language |
| `src/content.config.ts` | The fields a project file can have |
| `src/data/skills.ts` | The technologies of the constellations |
| `src/data/site.ts` | How the projects are sorted |
| `src/i18n/ui.ts` | Interface texts and contact details |
| `src/components/` | The five scenes and the reusable pieces (`Expedition`, `Planet`, `StatusBadge`) |
| `src/scripts/space/poses.ts` | Where the Moon is, how large and how it is lit in every scene |
| `src/scripts/space/controller.ts` | Turns the scroll position into the state of the scene |
| `src/scripts/space/scene.ts` | The Three.js scene: stars, halo and the Moon shader |
| `src/scripts/space/flat.ts` | The 2D fallback |
| `src/scripts/motion.ts` | Starts the scene and runs the animations of the content |
| `src/styles/global.css` | Colours, type and every layout |

## How the scene adapts

- **Full 3D**: desktop computers. 4K Moon map and fine surface grain up close.
- **Light 3D**: phones and modest computers. 2K map, fewer stars.
- **2D**: no WebGL, very little memory or data-saver mode. A picture of the Moon moved with CSS.
- **Reduced motion**: a still Moon over the first screen and no animation.
- If frames arrive late, the scene lowers its own quality.

Add `?high`, `?low` or `?flat` to the address to force one of them while testing.

## Credits

- Moon map: Clementine mission data (USGS), version processed by Jens Meyer and Steve Albers, free for personal non-commercial use. To replace it, put another equirectangular map in `public/textures/moon-2k.webp` and `moon-4k.webp` (NASA's CGI Moon Kit is in the public domain).
- Technology icons: [Simple Icons](https://simpleicons.org).
- The films of Boost and Votify were recorded with sample data.

To publish, the repository needs **Settings → Pages → Source: GitHub Actions**.
