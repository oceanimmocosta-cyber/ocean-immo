// Genera sitemap.xml con todas las páginas HTML públicas del sitio.
// Se ejecuta DESPUÉS de sync-inmoweb.mjs, generate-property-pages.mjs y
// generate-listing-pages.mjs, desde la raíz del repositorio.
import fs from 'fs';
import path from 'path';

const SITE_URL = 'https://www.oceanimmocosta.com';
const IGNORAR_DIRS = new Set(['.git', '.github', 'node_modules', 'scripts']);
const IGNORAR_ARCHIVOS = new Set(['404.html']);

function buscarHtml(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!IGNORAR_DIRS.has(e.name) && !e.name.startsWith('.')) out.push(...buscarHtml(path.join(dir, e.name), `${base}${e.name}/`));
    } else if (e.name.endsWith('.html') && !IGNORAR_ARCHIVOS.has(e.name)) {
      out.push({ ruta: `${base}${e.name}`, mtime: fs.statSync(path.join(dir, e.name)).mtime });
    }
  }
  return out;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const paginas = buscarHtml('.').sort((a, b) => a.ruta.localeCompare(b.ruta));

const urls = paginas.map((p) => {
  const esInicio = p.ruta === 'index.html';
  const loc = esInicio ? `${SITE_URL}/` : `${SITE_URL}/${p.ruta.split('/').map(encodeURIComponent).join('/')}`;
  const prioridad = esInicio ? '1.0' : p.ruta.includes('/') && p.ruta.startsWith('propiedades/') ? '0.7' : '0.8';
  return `  <url>\n    <loc>${esc(loc)}</loc>\n    <lastmod>${p.mtime.toISOString().slice(0, 10)}</lastmod>\n    <priority>${prioridad}</priority>\n  </url>`;
});

fs.writeFileSync('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
console.log(`sitemap.xml generado con ${urls.length} páginas`);
