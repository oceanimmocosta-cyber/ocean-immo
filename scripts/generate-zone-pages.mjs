// Genera las páginas de zona con URL propia, en 4 idiomas:
//   zonas/roses.html  en/zonas/roses.html  fr/zonas/roses.html  ca/zonas/roses.html
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


const IDIOMAS = ['ca', 'en', 'fr'];            // español = carpeta zonas/ de la raíz
const OG_LOCALE = { es: 'es_ES', ca: 'ca_ES', en: 'en_GB', fr: 'fr_FR' };
const HOME_TITLE = {
  ca: "Ocean Immo · La teva llar vora el mar a la Costa Brava | Immobiliària a Roses",
  en: "Ocean Immo · Your home by the sea on the Costa Brava | Real estate agency in Roses",
  fr: "Ocean Immo · Votre maison au bord de la mer sur la Costa Brava | Agence immobilière à Roses",
};
const COMPRAR_TITLE = {
  ca: "Propietats en venda a Roses i la Costa Brava · Ocean Immo",
  en: "Properties for sale in Roses and the Costa Brava · Ocean Immo",
  fr: "Biens immobiliers à vendre à Roses et sur la Costa Brava · Ocean Immo",
};
const MIGAS_FALLBACK = { es: { inicio: 'Inicio', comprar: 'Comprar' } };

function decode(s) {
  return s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&'; if (k === 'lt') return '<'; if (k === 'gt') return '>';
    if (k === 'quot') return '"'; if (k === 'apos') return "'"; if (k === 'nbsp') return ' ';
    return k[1] === 'x' ? String.fromCodePoint(parseInt(k.slice(2), 16)) : String.fromCodePoint(parseInt(k.slice(1), 10));
  });
}
const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function leerDiccionario(html) {
  const m = html.match(/const I18N = (\{[\s\S]*?\});\n/);
  if (!m) throw new Error('No se encuentra el diccionario I18N en index.html');
  return JSON.parse(m[1]);
}
// Igual que generate-language-pages.mjs: traduce los textos fijos del HTML con el diccionario I18N.
function traducirHtml(html, dict) {
  const partes = html.split(/(<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<!--[\s\S]*?-->)/gi);
  for (let i = 0; i < partes.length; i += 2) {
    partes[i] = partes[i]
      .replace(/>([^<>]+)</g, (todo, texto) => {
        const recortado = decode(texto.trim());
        if (!recortado) return todo;
        const destino = dict[recortado];
        if (destino === undefined) return todo;
        const lead = texto.match(/^\s*/)[0], trail = texto.match(/\s*$/)[0];
        return `>${lead}${escText(destino)}${trail}<`;
      })
      .replace(/placeholder="([^"]*)"/g, (todo, v) => {
        const destino = dict['PH::' + decode(v)];
        return destino === undefined ? todo : `placeholder="${esc(destino)}"`;
      });
  }
  return partes.join('');
}
// La zona con sus textos en ese idioma (lo que falte se queda en castellano).
const enIdioma = (z, lang) => (lang === 'es' || !z.i18n?.[lang]) ? z : { ...z, ...z.i18n[lang] };
const rutaZona = (slug, lang) => `${lang === 'es' ? '' : lang + '/'}zonas/${slug}.html`;

function main() {
  const cfg = JSON.parse(fs.readFileSync('zonas.json', 'utf8'));
  const minimo = cfg.minimo ?? 3;
  const propiedades = (JSON.parse(fs.readFileSync('properties.json', 'utf8')).propiedades || [])
    .filter((p) => (p.operacion || '').toLowerCase() === 'venta' && !p.vendido);

  let indexHtml = fs.readFileSync(INDEX_FILE, 'utf8');
  indexHtml = indexHtml.replace(/<!--og-home-->[\s\S]*?<!--\/og-home-->\n?/, '');
  const dict = leerDiccionario(indexHtml);
  const tituloOriginal = indexHtml.match(/<title>[^<]*<\/title>/);
  const descOriginal = indexHtml.match(/<meta name="description" content="[^"]*">/);
  if (!tituloOriginal || !descOriginal) {
    throw new Error('No se ha encontrado el <title> o el <meta name="description"> originales en index.html: revisa este script.');
  }

  const activas = { es: new Set(), ca: new Set(), en: new Set(), fr: new Set() };
  const resumen = [];
  const zonasActivas = [];
  for (const z of cfg.zonas) {
    const n = propiedades.filter((p) => coincide(p, z)).length;
    resumen.push(`${z.nombre}: ${n}`);
    if (n >= minimo) zonasActivas.push(z);
  }

  const indexIdioma = { es: indexHtml };
  for (const l of IDIOMAS) indexIdioma[l] = dict[l] ? traducirHtml(indexHtml, dict[l]) : indexHtml;

  for (const z0 of zonasActivas) {
    // hreflang entre las 4 versiones de la misma zona
    const hreflangs = ['es', ...IDIOMAS].map((l) => `<link rel="alternate" hreflang="${l}" href="${SITE_URL}/${rutaZona(z0.slug, l)}">`);
    hreflangs.push(`<link rel="alternate" hreflang="x-default" href="${SITE_URL}/${rutaZona(z0.slug, 'es')}">`);

    for (const lang of ['es', ...IDIOMAS]) {
      const z = enIdioma(z0, lang);
      const ui = { ...(cfg.ui?.es || {}), ...(cfg.ui?.[lang] || {}) };
      const carpeta = lang === 'es' ? 'zonas' : `${lang}/zonas`;
      const nivel = lang === 'es' ? '../' : '../../';
      activas[lang].add(`${z0.slug}.html`);

      const url = `${SITE_URL}/${rutaZona(z0.slug, lang)}`;
      const imagen = z.hero ? `${SITE_URL}/${z.hero}` : `${SITE_URL}/og-image.jpg`;
      const meta = [
        `<meta name="description" content="${esc(z.descripcion)}">`,
        `<link rel="canonical" href="${url}">`,
        ...hreflangs,
        `<meta property="og:type" content="website">`,
        `<meta property="og:site_name" content="Ocean Immo">`,
        `<meta property="og:locale" content="${OG_LOCALE[lang]}">`,
        `<meta property="og:title" content="${esc(z.titulo)}">`,
        `<meta property="og:description" content="${esc(z.descripcion)}">`,
        `<meta property="og:image" content="${esc(imagen)}">`,
        `<meta property="og:url" content="${url}">`,
        `<meta name="twitter:card" content="summary_large_image">`,
      ].join('\n');

      let pagina = indexIdioma[lang];
      if (lang !== 'es') pagina = pagina.replace('<html lang="es">', `<html lang="${lang}">`);
      pagina = pagina.replace(tituloOriginal[0], () => `<title>${esc(z.titulo)}</title>`);
      pagina = pagina.replace(descOriginal[0], () => meta);
      const raizLang = `${SITE_URL}/${lang === 'es' ? '' : lang + '/'}`;
      const inicioTxt = ui.inicio || 'Inicio', comprarTxt = ui.comprar || 'Comprar';
      const langScript = lang === 'es' ? '' :
        `window.__LANG=${JSON.stringify(lang)};window.__HOME_TITLE=${JSON.stringify(HOME_TITLE[lang])};window.__PAGE_TITLES=${JSON.stringify({ comprar: COMPRAR_TITLE[lang] })};`;
      pagina = pagina.replace(
        '</head>',
        () => `<script>${langScript}window.__OPEN_PAGE='zona';window.__ZONA_SLUG=${JSON.stringify(z0.slug)};</script>\n` +
          `<style id="oc-preload">#home{display:none}#page-zona{display:block}</style>\n` +
          jsonLd({
            '@context': 'https://schema.org', '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: inicioTxt, item: raizLang },
              { '@type': 'ListItem', position: 2, name: comprarTxt, item: `${raizLang}comprar.html` },
              { '@type': 'ListItem', position: 3, name: z.nombre },
            ],
          }) + '\n' +
          jsonLd({
            '@context': 'https://schema.org', '@type': 'Place', name: z.nombre,
            description: z.texto.join(' '),
            geo: { '@type': 'GeoCoordinates', longitude: z0.punto[0], latitude: z0.punto[1] },
            url,
          }) + '\n</head>'
      );
      // Contenido visible también sin JavaScript (buscadores simples, vistas previas).
      pagina = pagina.replace(
        '</body>',
        () => `<noscript><div style="max-width:760px;margin:0 auto;padding:120px 20px 60px;font-family:sans-serif"><h1>${esc(z.h1)}</h1><p>${esc(z.lead)}</p><h2>${esc(z.h2texto)}</h2>${z.texto.map((t) => `<p>${esc(t)}</p>`).join('')}<p><a href="${nivel}${lang === 'es' ? '' : lang + '/'}comprar.html">${esc(ui.verTodas || 'Ver todas las propiedades')}</a></p></div></noscript>\n</body>`
      );
      // Más adentro que index.html: subimos las rutas relativas (1 nivel en español, 2 en los otros idiomas).
      pagina = pagina.replace(/(["'(])\.\//g, `$1${nivel}`);
      pagina = pagina.replace(/href="servicios\//g, `href="${nivel}servicios/`);
      fs.mkdirSync(carpeta, { recursive: true });
      fs.writeFileSync(path.join(carpeta, `${z0.slug}.html`), pagina);
    }
  }

  // Borra las páginas de zonas que ya no cumplen el mínimo (o que se hayan quitado de zonas.json), en todos los idiomas.
  for (const lang of ['es', ...IDIOMAS]) {
    const carpeta = lang === 'es' ? 'zonas' : `${lang}/zonas`;
    if (!fs.existsSync(carpeta)) continue;
    for (const f of fs.readdirSync(carpeta)) {
      if (f.endsWith('.html') && !activas[lang].has(f)) {
        fs.unlinkSync(path.join(carpeta, f));
        console.log(`Zona sin propiedades suficientes, página eliminada: ${carpeta}/${f}`);
      }
    }
  }
  console.log(`Zonas (mínimo ${minimo}): ${resumen.join(' · ')}. Páginas generadas: ${zonasActivas.length} zonas × 4 idiomas`);
}

main();
