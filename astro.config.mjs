import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** After the build, puts the 3D scene's chunk name into the page head's preload hint, so the scene's
 *  code is requested from the very start instead of after the page's own script. */
function preloadScene() {
  return {
    name: 'preload-scene',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const root = fileURLToPath(dir);
        const chunk = (await readdir(join(root, '_astro'))).find((f) => /^scene\.[\w-]+\.js$/.test(f));
        if (!chunk) return;
        const walk = async (d) => (await Promise.all((await readdir(d, { withFileTypes: true })).map((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.html') ? [join(d, e.name)] : [])))).flat();
        for (const file of await walk(root)) {
          const html = await readFile(file, 'utf8');
          if (html.includes('__SCENE_CHUNK__')) await writeFile(file, html.replaceAll('__SCENE_CHUNK__', `/_astro/${chunk}`));
        }
      },
    },
  };
}

export default defineConfig({
  site: 'https://ballenarcas.github.io',
  integrations: [
    mdx(),
    sitemap({ i18n: { defaultLocale: 'es', locales: { es: 'es-ES', en: 'en-US' } } }),
    preloadScene(),
  ],
});
