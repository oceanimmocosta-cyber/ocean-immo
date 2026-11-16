// Genera sitemap.xml con todas las páginas HTML públicas del sitio.
// Se ejecuta DESPUÉS de sync-inmoweb.mjs, generate-property-pages.mjs y
// generate-listing-pages.mjs, desde la raíz del repositorio.
import fs from 'fs';
import path from 'path';

const SITE_URL = 'https://www.oceanimmocosta.com';
// Solo se incluyen las páginas públicas de la web. Cualquier otro .html del
// repositorio (herramientas internas, pruebas...) queda fuera del sitemap.
const PAGINAS_RAIZ = new Set(['index.html', 'comprar.html', 'servicios.html']);
const CARPETAS_PUBLICAS = ['comprar', 'servicios', 'propiedades'];
// Versiones por idioma de la portada y de Comprar (las genera generate-language-pages.mjs).
const IDIOMAS = ['ca', 'en', 'fr'];
const PAGINAS_IDIOMA = ['index.html', 'comprar.html'];

function listarHtml(carpeta) {
  if (!fs.existsSync(carpeta)) return [];
  return fs.readdirSync(carpeta)
    .filter((f) => f.endsWith('.html'))
    .map((f) => `${carpeta}/${f}`);
}

function buscarHtml() {
  const rutas = [...PAGINAS_RAIZ].filter((f) => fs.existsSync(f));
  for (const c of CARPETAS_PUBLICAS) rutas.push(...listarHtml(c));
  for (const l of IDIOMAS) for (const f of PAGINAS_IDIOMA) if (fs.existsSync(`${l}/${f}`)) rutas.push(`${l}/${f}`);
  return rutas.map((ruta) => ({ ruta, mtime: fs.statSync(ruta).mtime }));
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const paginas = buscarHtml().sort((a, b) => a.ruta.localeCompare(b.ruta));

// Dirección pública de una ruta de archivo (index.html -> /, en/index.html -> /en/).
const urlDe = (ruta) => {
  const limpia = ruta.replace(/(^|\/)index\.html$/, '$1');
  return `${SITE_URL}/${limpia.split('/').map(encodeURIComponent).join('/')}`;
};
// Grupos de idiomas: la portada y Comprar existen en español (raíz) y en cada idioma.
const grupoDe = (ruta) => {
  const base = ruta.replace(/^(?:ca|en|fr)\//, '');
  if (!PAGINAS_IDIOMA.includes(base)) return null;
  const versiones = [['es', base]];
  for (const l of IDIOMAS) if (fs.existsSync(`${l}/${base}`)) versiones.push([l, `${l}/${base}`]);
  return versiones.length > 1 ? versiones : null;
};

const urls = paginas.map((p) => {
  const base = p.ruta.replace(/^(?:ca|en|fr)\//, '');
  const esInicio = base === 'index.html';
  const loc = urlDe(p.ruta);
  const prioridad = esInicio ? '1.0' : p.ruta.startsWith('propiedades/') ? '0.7' : '0.8';
  const grupo = grupoDe(p.ruta);
  const alternos = grupo
    ? grupo.map(([l, r]) => `\n    <xhtml:link rel="alternate" hreflang="${l}" href="${esc(urlDe(r))}"/>`).join('') +
      `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${esc(urlDe(grupo[0][1]))}"/>`
    : '';
  return `  <url>\n    <loc>${esc(loc)}</loc>${alternos}\n    <lastmod>${p.mtime.toISOString().slice(0, 10)}</lastmod>\n    <priority>${prioridad}</priority>\n  </url>`;
});

fs.writeFileSync('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`);
console.log(`sitemap.xml generado con ${urls.length} páginas`);
