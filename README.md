# Ángel Espada · Portfolio (Violet Moon)

The source of [ballenarcas.github.io](https://ballenarcas.github.io): a bilingual (Spanish and English) portfolio built around a violet 3D Moon. As the visitor scrolls through the five scenes (home, about, skills, expeditions and contact) the Moon moves, grows and slides into a total eclipse with a violet corona; scrolling back up brings the light back.

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
   | `categories` | Kinds of project. Kept in the data; not shown on the site at the moment |
   | `order`, `date` | Position in the list. `src/data/site.ts` chooses whether the list is sorted by priority or by date |
   | `accent` | Colour of the project's planet |
   | `repo`, `demo` | Links. Leave `demo` out when there is none |
   | `draft` | `true` hides the project from the published site |
   | `planet`, `accent2`, `planetSize` | Optional. The planet's designed look in the 3D orbit (`tech`, `organic`, `network`, `celestial`), its second colour and its size. Without `planet`, a surface is picked automatically |
   | `planetTextures` | `true` when `public/textures/planets/` holds the project's five equirectangular maps: `<slug>_albedo.png` (sRGB), `_normal`, `_height`, `_roughness` and `_emissive` (plain data). They become the planet's surface; without them, or until they load, the surface is drawn by the shader |
   | `status: "private"` | The project shows only its name and summary: no page, no links, no stack. `repo`, `cover` and `tagline` can then be left out |

4. **Push to `main`.** The project appears among the expeditions, gets its own page in both languages and joins the "next expedition" chain.

To change or remove a project, edit or delete its two files.

## Where things are

| Path | What it holds |
| --- | --- |
| `src/content/projects/` | One MDX case study per project and language |
| `src/content.config.ts` | The fields a project file can have |
| `src/data/skills.ts` | The constellations: each technology's star (position, size, glow) and the lines between them |
| `src/data/site.ts` | How the projects are sorted |
| `src/i18n/ui.ts` | Interface texts and contact details |
| `src/components/` | The five scenes and the reusable pieces (`Expedition`, `Planet`, `StatusBadge`) |
| `src/scripts/space/poses.ts` | Where the Moon is and how large in every scene, and how the scroll becomes the eclipse |
| `src/scripts/space/controller.ts` | Turns the scroll position into the state of the scene |
| `src/scripts/space/scene.ts` | The Three.js scene: stars, the violet Moon (surface and aura shaders), the orbit's camera rigs |
| `src/scripts/space/camera.ts` | The only code that moves the camera: rigs and the director that blends them |
| `src/scripts/space/planets.ts` | The project planets: generated from the project data, orbits, surfaces, picking |
| `src/scripts/orbit-ui.ts` | Planet labels, selection, the project panel and Escape in the orbit |
| `src/scripts/space/flat.ts` | The 2D fallback |
| `src/scripts/motion.ts` | Starts the scene and runs the animations of the content |
| `src/styles/global.css` | Colours, type and every layout |

## The eclipse

One value, `eclipse`, goes from 0 (full violet Moon) to 1 (total eclipse) with the scroll of the whole page (`eclipseFor` in `poses.ts`). The controller eases it together with the Moon's position, and the scene derives everything from it: the direction of the sun (`sunFor`), the earthshine on the night side, the violet rim and the corona. Poses only place the Moon; nothing else changes the light.

## The Moon

- **Surface**, in three scales: basins, maria and rays come from the Clementine photograph; craters, rims and ridges from NASA's measured relief (LOLA), whose slopes tilt the light and whose curvature finds rims and floors; craters too small for the map are procedural and only appear once they are a few pixels wide. The photograph's brightness runs through the violet palette (deep purple maria, violet and lavender highlands, lilac rays). The sunlight follows lunar reflectance, so the full Moon is evenly bright and the shadow only grows.
- **Aura**, one shader on one plane behind the Moon, with five layers that each move at their own pace: a breathing halo on the limb, corona-like streamers, short aurora curtains, a small cloud of violet gas and a few faint motes. It grows with the eclipse and leans towards the hidden sun; it steps back when the Moon is close. The rim light on the Moon follows the same pattern as the streamers.
- On slow devices the fine grit, the smallest craters, the motes and the finer threads go first.

## The orbit of the projects

With the 3D scene, the expeditions section is a pinned stage the scroll travels through: every published project is a planet circling the Moon. Nothing is written per project: size, orbit, surface (rock, banded gas or ice), ring and colour come from the project's data (`featured`, `order`, `accent`, its slug as a seed). Add a project and it gets a planet.

- **One camera, one owner.** `camera.ts` describes a camera as a rig (what it looks at, from where, how much fits on screen). The director follows one source at a time, the exploration (the scroll through the section) or one planet. Any change starts from the camera as it is at that moment and blends into the new source, so quick clicks, planet to planet, closing and scrolling during a focus never jump.
- **Exploration**: the progress is measured on the section itself. The system of planets comes in as the section arrives, holds a steady view centred on the Moon while it scrolls (no zoom, a few degrees of drift) and goes as it leaves. The planets keep turning on their orbits by themselves.
- **Focus**: a click, a tap or Enter on a planet's label flies the camera to it, follows it round its orbit and opens its panel; the scroll keeps working. Escape, the close button or clicking empty sky go back to the composition of the current scroll position. Leaving the section closes it.
- Without 3D (2D, reduced motion, no script) the section is the list of expeditions, as before.

## How the scene adapts

- **Full 3D**: desktop computers. 4K Moon map and fine surface grain up close.
- **Light 3D**: phones and modest computers. 2K map, fewer stars.
- **2D**: no WebGL, very little memory or data-saver mode. A picture of the violet Moon moved with CSS; it darkens and gains a violet glow with the eclipse (a flat picture cannot show the shadow advancing).
- **Reduced motion**: a still full violet Moon over the first screen, no eclipse and no animation.
- If frames arrive late, the scene lowers its own quality.

Add `?high`, `?low` or `?flat` to the address to force one of them while testing.

## Credits

- Moon relief: the LOLA laser altimeter of NASA's Lunar Reconnaissance Orbiter (`ldem_16`, NASA/GSFC, public domain), resampled to 2048×1024 and stored compressed in `public/textures/moon-relief-2k.webp` (8 bits, tanh of the local height).
- Moon map: Clementine mission data (USGS), version processed by Jens Meyer and Steve Albers, free for personal non-commercial use. The violet colour is applied in the shader, not baked into the map. To replace it, put another equirectangular map in `public/textures/moon-2k.webp` and `moon-4k.webp` (NASA's CGI Moon Kit is in the public domain).
- Technology icons: [Simple Icons](https://simpleicons.org).
- The films of Boost and Votify were recorded with sample data.

To publish, the repository needs **Settings → Pages → Source: GitHub Actions**.
