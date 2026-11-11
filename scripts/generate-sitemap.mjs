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

function listarHtml(carpeta) {
  if (!fs.existsSync(carpeta)) return [];
  return fs.readdirSync(carpeta)
    .filter((f) => f.endsWith('.html'))
    .map((f) => `${carpeta}/${f}`);
}

function buscarHtml() {
  const rutas = [...PAGINAS_RAIZ].filter((f) => fs.existsSync(f));
  for (const c of CARPETAS_PUBLICAS) rutas.push(...listarHtml(c));
  return rutas.map((ruta) => ({ ruta, mtime: fs.statSync(ruta).mtime }));
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const paginas = buscarHtml().sort((a, b) => a.ruta.localeCompare(b.ruta));

const urls = paginas.map((p) => {
  const esInicio = p.ruta === 'index.html';
  const loc = esInicio ? `${SITE_URL}/` : `${SITE_URL}/${p.ruta.split('/').map(encodeURIComponent).join('/')}`;
  const prioridad = esInicio ? '1.0' : p.ruta.includes('/') && p.ruta.startsWith('propiedades/') ? '0.7' : '0.8';
  return `  <url>\n    <loc>${esc(loc)}</loc>\n    <lastmod>${p.mtime.toISOString().slice(0, 10)}</lastmod>\n    <priority>${prioridad}</priority>\n  </url>`;
});

fs.writeFileSync('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
console.log(`sitemap.xml generado con ${urls.length} páginas`);
