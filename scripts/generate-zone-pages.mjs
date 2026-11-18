// Genera las páginas de zona con URL propia: zonas/roses.html, zonas/empuriabrava.html...
//
// Igual que generate-listing-pages.mjs: parte del index.html real de la web y solo
// cambia título, descripción, canonical y vista previa, e inyecta qué zona abrir.
// Los textos y los datos de cada zona viven en zonas.json (fuente única).
//
// Regla automática: una zona solo tiene página si ahora mismo tiene al menos
// "minimo" propiedades en venta (sin contar las vendidas). Si baja de ese número,
// su página se borra sola en la siguiente ejecución, y vuelve a crearse sola cuando
// recupere propiedades. El sitemap solo incluye las páginas que existan.
//
// Se ejecuta DESPUÉS de generate-listing-pages.mjs, desde la raíz del repositorio.
import fs from 'fs';
import path from 'path';

const SITE_URL = 'https://www.oceanimmocosta.com';
const INDEX_FILE = 'index.html';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

// Misma normalización que usa la web en el navegador (index.html): sin tildes, en
// minúsculas, y "Santa Margarita" = "Santa Margarida".
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/margarita/g, 'margarida');
const coincide = (p, z) => {
  const c = z.coincide || {};
  const x = z.excluye || {};
  if ((x.poblacion || []).includes(norm(p.poblacion)) || (x.zona || []).includes(norm(p.zona))) return false;
  return (c.poblacion || []).includes(norm(p.poblacion)) || (c.zona || []).includes(norm(p.zona));
};

function main() {
  const cfg = JSON.parse(fs.readFileSync('zonas.json', 'utf8'));
  const minimo = cfg.minimo ?? 3;
  const propiedades = (JSON.parse(fs.readFileSync('properties.json', 'utf8')).propiedades || [])
    .filter((p) => (p.operacion || '').toLowerCase() === 'venta' && !p.vendido);

  let indexHtml = fs.readFileSync(INDEX_FILE, 'utf8');
  indexHtml = indexHtml.replace(/<!--og-home-->[\s\S]*?<!--\/og-home-->\n?/, '');
  const tituloOriginal = indexHtml.match(/<title>[^<]*<\/title>/);
  const descOriginal = indexHtml.match(/<meta name="description" content="[^"]*">/);
  if (!tituloOriginal || !descOriginal) {
    throw new Error('No se ha encontrado el <title> o el <meta name="description"> originales en index.html: revisa este script.');
  }

  fs.mkdirSync('zonas', { recursive: true });
  const activas = new Set();
  const resumen = [];

  for (const z of cfg.zonas) {
    const n = propiedades.filter((p) => coincide(p, z)).length;
    resumen.push(`${z.nombre}: ${n}`);
    if (n < minimo) continue;
    activas.add(`${z.slug}.html`);

    const url = `${SITE_URL}/zonas/${z.slug}.html`;
    const imagen = z.hero ? `${SITE_URL}/${z.hero}` : `${SITE_URL}/og-image.jpg`;
    const meta = [
      `<meta name="description" content="${esc(z.descripcion)}">`,
      `<link rel="canonical" href="${url}">`,
      `<meta property="og:type" content="website">`,
      `<meta property="og:site_name" content="Ocean Immo">`,
      `<meta property="og:title" content="${esc(z.titulo)}">`,
      `<meta property="og:description" content="${esc(z.descripcion)}">`,
      `<meta property="og:image" content="${esc(imagen)}">`,
      `<meta property="og:url" content="${url}">`,
      `<meta name="twitter:card" content="summary_large_image">`,
    ].join('\n');

    let pagina = indexHtml;
    pagina = pagina.replace(tituloOriginal[0], () => `<title>${esc(z.titulo)}</title>`);
    pagina = pagina.replace(descOriginal[0], () => meta);
    pagina = pagina.replace(
      '</head>',
      () => `<script>window.__OPEN_PAGE='zona';window.__ZONA_SLUG=${JSON.stringify(z.slug)};</script>\n` +
        `<style id="oc-preload">#home{display:none}#page-zona{display:block}</style>\n` +
        jsonLd({
          '@context': 'https://schema.org', '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Inicio', item: `${SITE_URL}/` },
            { '@type': 'ListItem', position: 2, name: 'Comprar', item: `${SITE_URL}/comprar.html` },
            { '@type': 'ListItem', position: 3, name: z.nombre },
          ],
        }) + '\n' +
        jsonLd({
          '@context': 'https://schema.org', '@type': 'Place', name: z.nombre,
          description: z.texto.join(' '),
          geo: { '@type': 'GeoCoordinates', longitude: z.punto[0], latitude: z.punto[1] },
          url,
        }) + '\n</head>'
    );
    // Contenido visible también sin JavaScript (buscadores simples, vistas previas).
    pagina = pagina.replace(
      '</body>',
      () => `<noscript><div style="max-width:760px;margin:0 auto;padding:120px 20px 60px;font-family:sans-serif"><h1>${esc(z.h1)}</h1><p>${esc(z.lead)}</p><h2>${esc(z.h2texto)}</h2>${z.texto.map((t) => `<p>${esc(t)}</p>`).join('')}<p><a href="../comprar.html">Ver todas las propiedades en venta</a></p></div></noscript>\n</body>`
    );
    // Un nivel más adentro que index.html: subimos las rutas relativas.
    pagina = pagina.replace(/(["'(])\.\//g, '$1../');
    fs.writeFileSync(path.join('zonas', `${z.slug}.html`), pagina);
  }

  // Borra las páginas de zonas que ya no cumplen el mínimo (o que se hayan quitado de zonas.json).
  for (const f of fs.readdirSync('zonas')) {
    if (f.endsWith('.html') && !activas.has(f)) {
      fs.unlinkSync(path.join('zonas', f));
      console.log(`Zona sin propiedades suficientes, página eliminada: zonas/${f}`);
    }
  }
  console.log(`Zonas (mínimo ${minimo}): ${resumen.join(' · ')}. Páginas generadas: ${activas.size}`);
}

main();
