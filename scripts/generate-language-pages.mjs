// Genera las versiones por idioma de la portada y del listado de "Comprar":
//   /en/  /en/comprar.html   /fr/  /fr/comprar.html   /ca/  /ca/comprar.html
//
// Cada página sale del index.html real (mismo diseño y funcionamiento), pero:
//   - los textos ya vienen traducidos en el propio HTML (con el diccionario I18N de index.html),
//     para que Google, Bing y quien comparta el enlace vean el idioma correcto sin ejecutar nada;
//   - lleva su <title>, descripción, canonical, Open Graph y etiquetas hreflang;
//   - arranca en ese idioma (window.__LANG).
// También añade las etiquetas hreflang a /comprar.html (español).
//
// Se ejecuta DESPUÉS de generate-listing-pages.mjs, desde la raíz del repositorio.
import fs from 'fs';
import path from 'path';

const INDEX_FILE = 'index.html';
const SITE_URL = 'https://www.oceanimmocosta.com';
const IDIOMAS = ['ca', 'en', 'fr'];            // español = páginas de la raíz
const OG_LOCALE = { es: 'es_ES', ca: 'ca_ES', en: 'en_GB', fr: 'fr_FR' };

// Textos propios de cada idioma (título, descripción) para cada página.
const TEXTOS = {
  home: {
    ca: { title: "Ocean Immo · La teva llar vora el mar a la Costa Brava | Immobiliària a Roses",
          desc: "Ocean Immo, agència immobiliària a Roses (Costa Brava). Compravenda d'habitatges amb atenció en 4 idiomes. Més de 26 anys de coneixement local." },
    en: { title: "Ocean Immo · Your home by the sea on the Costa Brava | Real estate agency in Roses",
          desc: "Ocean Immo, real estate agency in Roses (Costa Brava). Homes for sale with service in 4 languages. Over 26 years of local knowledge." },
    fr: { title: "Ocean Immo · Votre maison au bord de la mer sur la Costa Brava | Agence immobilière à Roses",
          desc: "Ocean Immo, agence immobilière à Roses (Costa Brava). Vente de biens avec un service en 4 langues. Plus de 26 ans de connaissance locale." },
  },
  comprar: {
    ca: { title: "Propietats en venda a Roses i la Costa Brava",
          desc: "Pisos, cases, terrenys i locals en venda a Roses i la Costa Brava. Cartera actualitzada cada dia, amb atenció en espanyol, català, francès i anglès." },
    en: { title: "Properties for sale in Roses and the Costa Brava",
          desc: "Apartments, houses, land and commercial premises for sale in Roses and the Costa Brava. Portfolio updated daily, with service in Spanish, Catalan, French and English." },
    fr: { title: "Biens immobiliers à vendre à Roses et sur la Costa Brava",
          desc: "Appartements, maisons, terrains et locaux commerciaux à vendre à Roses et sur la Costa Brava. Portefeuille mis à jour chaque jour, avec un service en espagnol, catalan, français et anglais." },
  },
};
const MIGAS = {
  ca: { inicio: 'Inici', comprar: 'Comprar' },
  en: { inicio: 'Home', comprar: 'Buy' },
  fr: { inicio: 'Accueil', comprar: 'Acheter' },
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function decode(s) {
  return s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&'; if (k === 'lt') return '<'; if (k === 'gt') return '>';
    if (k === 'quot') return '"'; if (k === 'apos') return "'"; if (k === 'nbsp') return ' ';
    return k[1] === 'x' ? String.fromCodePoint(parseInt(k.slice(2), 16)) : String.fromCodePoint(parseInt(k.slice(1), 10));
  });
}
const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function leerDiccionario(html) {
  const m = html.match(/const I18N = (\{[\s\S]*?\});\n/);
  if (!m) throw new Error('No se encuentra el diccionario I18N en index.html');
  return JSON.parse(m[1]);
}

// Traduce los textos del HTML igual que hace applyLang() en el navegador: cada texto
// (recortado) que esté en el diccionario se cambia; los <script>, <style> y comentarios no se tocan.
function traducirHtml(html, dict) {
  const partes = html.split(/(<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<!--[\s\S]*?-->)/gi);
  let traducidos = 0;
  for (let i = 0; i < partes.length; i += 2) {   // las posiciones pares son HTML normal
    partes[i] = partes[i]
      .replace(/>([^<>]+)</g, (todo, texto) => {
        const recortado = decode(texto.trim());
        if (!recortado) return todo;
        const destino = dict[recortado];
        if (destino === undefined) return todo;
        traducidos++;
        const lead = texto.match(/^\s*/)[0], trail = texto.match(/\s*$/)[0];
        return `>${lead}${escText(destino)}${trail}<`;
      })
      .replace(/placeholder="([^"]*)"/g, (todo, v) => {
        const destino = dict['PH::' + decode(v)];
        return destino === undefined ? todo : `placeholder="${esc(destino)}"`;
      });
  }
  return { html: partes.join(''), traducidos };
}

function hreflangs(pagina) {
  const ruta = (lang) => `${SITE_URL}/${lang === 'es' ? '' : lang + '/'}${pagina === 'comprar' ? 'comprar.html' : ''}`;
  const filas = ['es', ...IDIOMAS].map((l) => `<link rel="alternate" hreflang="${l}" href="${ruta(l)}">`);
  filas.push(`<link rel="alternate" hreflang="x-default" href="${ruta('es')}">`);
  return filas.join('\n');
}

function etiquetas(lang, pagina, titulo, desc) {
  const url = `${SITE_URL}/${lang}/${pagina === 'comprar' ? 'comprar.html' : ''}`;
  return [
    `<link rel="canonical" href="${url}">`,
    hreflangs(pagina),
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Ocean Immo">`,
    `<meta property="og:locale" content="${OG_LOCALE[lang]}">`,
    `<meta property="og:title" content="${esc(titulo)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:image" content="${SITE_URL}/og-image.jpg">`,
    `<meta property="og:url" content="${url}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:image" content="${SITE_URL}/og-image.jpg">`,
  ].join('\n');
}

function main() {
  let indexHtml = fs.readFileSync(INDEX_FILE, 'utf8');
  indexHtml = indexHtml.replace(/<!--og-home-->[\s\S]*?<!--\/og-home-->\n?/, '');
  const dict = leerDiccionario(indexHtml);

  const tituloOrig = indexHtml.match(/<title>[^<]*<\/title>/);
  const descOrig = indexHtml.match(/<meta name="description" content="[^"]*">/);
  if (!tituloOrig || !descOrig) throw new Error('No se encuentra <title> o <meta description> en index.html');

  for (const lang of IDIOMAS) {
    if (!dict[lang]) throw new Error(`El diccionario no tiene el idioma ${lang}`);
    fs.mkdirSync(lang, { recursive: true });

    for (const pagina of ['home', 'comprar']) {
      const t = TEXTOS[pagina][lang];
      const titulo = pagina === 'home' ? t.title : `${t.title} · Ocean Immo`;
      const tr = traducirHtml(indexHtml, dict[lang]);
      let html = tr.html;

      html = html.replace('<html lang="es">', `<html lang="${lang}">`);
      html = html.replace(tituloOrig[0], `<title>${esc(titulo)}</title>`);
      html = html.replace(descOrig[0], `<meta name="description" content="${esc(t.desc)}">\n${etiquetas(lang, pagina, titulo, t.desc)}`);

      const homeTitulo = TEXTOS.home[lang].title;
      const comprarTitulo = `${TEXTOS.comprar[lang].title} · Ocean Immo`;
      let inyeccion =
        `<script>window.__LANG=${JSON.stringify(lang)};window.__HOME_TITLE=${JSON.stringify(homeTitulo)};` +
        `window.__PAGE_TITLES=${JSON.stringify({ comprar: comprarTitulo })};` +
        (pagina === 'comprar' ? `window.__OPEN_PAGE="comprar";` : '') + `</script>\n`;
      if (pagina === 'comprar') inyeccion += `<style id="oc-preload">#home{display:none}#page-comprar{display:block}</style>\n`;
      const ld = {
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: pagina === 'home'
          ? [{ '@type': 'ListItem', position: 1, name: MIGAS[lang].inicio }]
          : [{ '@type': 'ListItem', position: 1, name: MIGAS[lang].inicio, item: `${SITE_URL}/${lang}/` },
             { '@type': 'ListItem', position: 2, name: MIGAS[lang].comprar }],
      };
      inyeccion += `<script type="application/ld+json">${JSON.stringify(ld)}</script>\n`;
      html = html.replace('</head>', `${inyeccion}</head>`);

      // La página está una carpeta más adentro: se suben las rutas relativas un nivel.
      html = html.replace(/(["'(])\.\//g, '$1../');
      html = html.replace(/href="servicios\//g, 'href="../servicios/');

      const salida = path.join(lang, pagina === 'home' ? 'index.html' : 'comprar.html');
      fs.writeFileSync(salida, html);
      console.log(`${salida}: ${tr.traducidos} textos traducidos`);
    }
  }

  // hreflang en /comprar.html (español), generado antes por generate-listing-pages.mjs.
  if (fs.existsSync('comprar.html')) {
    let c = fs.readFileSync('comprar.html', 'utf8');
    c = c.replace(/<link rel="alternate" hreflang="[^"]*" href="[^"]*">\n?/g, '');
    c = c.replace(/(<link rel="canonical" href="[^"]*">\n)/, `$1${hreflangs('comprar')}\n`);
    fs.writeFileSync('comprar.html', c);
    console.log('comprar.html: hreflang añadido');
  }
}

main();
