export const languages = ['es', 'en'] as const;
export type Lang = (typeof languages)[number];
export const defaultLang: Lang = 'es';

export const author = {
  name: 'Ángel Espada',
  fullName: 'Ángel Espada Jiménez',
  first: 'Ángel',
  last: 'Espada',
  email: 'angelespada23@gmail.com',
  github: 'https://github.com/Ballenarcas',
  linkedin: 'https://www.linkedin.com/in/%C3%A1ngel-espada-jim%C3%A9nez-0998a3405',
};

const ui = {
  es: {
    'site.title': 'Ángel Espada · Desarrollador full stack',
    'site.description':
      'Portfolio de Ángel Espada, estudiante de Ingeniería del Software. Aplicaciones web completas con React, FastAPI, .NET e IA sujeta a reglas.',
    'nav.work': 'Proyectos',
    'nav.about': 'Sobre mí',
    'nav.contact': 'Contacto',
    'nav.skip': 'Saltar al contenido',
    'nav.switch': 'English',
    'hero.sentence':
      'Estudiante de Ingeniería del Software. Construyo aplicaciones web completas, de la base de datos a la interfaz, con IA sujeta a reglas.',
    'hero.pick': 'Elige un proyecto',
    'hero.open': 'Ver',
    'work.open': 'Ver el proyecto',
    'work.repo': 'Código en GitHub',
    'about.title': 'Sobre mí',
    'about.statement':
      'Me interesa el software útil: que resuelva algo concreto, que se pueda mantener y que use la IA con límites claros.',
    'about.more': 'Más sobre mí',
    'about.languages': 'Lenguajes',
    'about.frontend': 'Frontend',
    'about.backend': 'Backend',
    'about.data': 'Datos',
    'about.ai': 'IA',
    'contact.title': 'Contacto',
    'contact.sentence': '¿Un proyecto, unas prácticas o una pregunta? Escríbeme.',
    'footer.top': 'Volver arriba',
    'footer.built': 'Hecho con Astro. Código en GitHub.',
    'project.film': 'Vídeo del proyecto',
    'project.play': 'Reproducir el vídeo',
    'project.stack': 'Tecnologías',
    'project.role': 'Mi papel',
    'project.context': 'Contexto',
    'project.year': 'Año',
    'project.gallery': 'Pantallas',
    'project.next': 'Siguiente proyecto',
    '404.title': 'Esta página no existe',
    '404.text': 'Puede que el enlace esté roto o que la página se haya movido.',
    '404.home': 'Ir al inicio',
  },
  en: {
    'site.title': 'Ángel Espada · Full-stack developer',
    'site.description':
      'Portfolio of Ángel Espada, software engineering student. Complete web apps with React, FastAPI, .NET and AI kept inside rules.',
    'nav.work': 'Projects',
    'nav.about': 'About',
    'nav.contact': 'Contact',
    'nav.skip': 'Skip to content',
    'nav.switch': 'Español',
    'hero.sentence':
      'Software engineering student. I build complete web apps, from the database to the interface, with AI kept inside rules.',
    'hero.pick': 'Pick a project',
    'hero.open': 'See',
    'work.open': 'See the project',
    'work.repo': 'Code on GitHub',
    'about.title': 'About me',
    'about.statement':
      'I care about useful software: it solves one concrete thing, it can be maintained, and it uses AI within clear limits.',
    'about.more': 'More about me',
    'about.languages': 'Languages',
    'about.frontend': 'Frontend',
    'about.backend': 'Backend',
    'about.data': 'Data',
    'about.ai': 'AI',
    'contact.title': 'Contact',
    'contact.sentence': 'A project, an internship or a question? Write to me.',
    'footer.top': 'Back to top',
    'footer.built': 'Built with Astro. Code on GitHub.',
    'project.film': 'Project film',
    'project.play': 'Play the film',
    'project.stack': 'Stack',
    'project.role': 'My role',
    'project.context': 'Context',
    'project.year': 'Year',
    'project.gallery': 'Screens',
    'project.next': 'Next project',
    '404.title': 'This page does not exist',
    '404.text': 'The link may be broken or the page may have moved.',
    '404.home': 'Go to the home page',
  },
} as const;

export type UiKey = keyof (typeof ui)['es'];
export const t = (lang: Lang, key: UiKey): string => ui[lang][key];

export const skills = {
  'about.languages': 'TypeScript, JavaScript, Python, C#, Java',
  'about.frontend': 'React 19, Vite, Tailwind CSS, Blazor WebAssembly, Astro',
  'about.backend': 'FastAPI, ASP.NET, Pydantic, REST',
  'about.data': 'Supabase (Postgres), SQLite, Entity Framework',
  'about.ai': 'OpenAI-compatible APIs, Groq',
} as const;

/** The same page in the other language. */
export function otherLangPath(pathname: string, lang: Lang): string {
  const other: Lang = lang === 'es' ? 'en' : 'es';
  const rest = pathname.replace(/^\/(es|en)(?=\/|$)/, '');
  return `/${other}${rest || '/'}`;
}
