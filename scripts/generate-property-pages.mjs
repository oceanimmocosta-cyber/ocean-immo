// Genera una página HTML por cada propiedad (propiedades/<referencia>.html) que es
// EXACTAMENTE el mismo index.html de la web (mismo header, footer, estilos, JS...),
// solo que:
//   1) lleva las etiquetas <title>/<meta description>/Open Graph propias de esa
//      propiedad (para SEO y para que la vista previa de WhatsApp/redes muestre
//      foto, título y precio correctos), y
//   2) al cargar, se abre automáticamente en la ficha de detalle de esa propiedad
//      (usando el mismo mecanismo openProperty()/fillFromCard() de la propia web).
//
// Se ejecuta DESPUÉS de sync-inmoweb.mjs en el mismo workflow de GitHub Actions,
// y debe ejecutarse desde la raíz del repositorio (donde está index.html).
import fs from 'fs';
import path from 'path';

const SITE_URL = 'https://oceanimmocosta-cyber.github.io/ocean-immo';
const OUT_DIR = 'propiedades';
const INDEX_FILE = 'index.html';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function limpiarTexto(s) {
  if (!s) return '';
  return String(s).replace(/&#13;/g, '\n').replace(/\[iw\]/gi, '').trim();
}

function fmtPrecio(n) {
  const num = typeof n === 'string' ? parseFloat(n.replace(/[^\d.,-]/g, '').replace(',', '.')) : n;
  if (isNaN(num)) return String(n ?? '');
  return Math.round(num).toLocaleString('es-ES') + ' €';
}

function slugRef(ref) {
  return String(ref || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

// Agrupa el tipo de propiedad tal como lo manda Inmoweb en uno de los 8 "cajones"
// que ya usamos en el menú Comprar, solo para poder construir la miga de pan.
function tipoBreadcrumb(pTipo) {
  const t = (pTipo || '').toLowerCase();
  if (t.includes('piso')) return { slug: 'piso', label: 'Pisos' };
  if (t.includes('ático') || t.includes('atico')) return { slug: 'atico', label: 'Áticos' };
  if (t.includes('dúplex') || t.includes('duplex')) return { slug: 'duplex', label: 'Dúplex' };
  if (t.includes('estudio')) return { slug: 'estudio', label: 'Estudios' };
  if (t.includes('casa') || t.includes('chalet')) return { slug: 'casa', label: 'Casas y chalets' };
  if (t.includes('finca') || t.includes('solar') || t.includes('rústica') || t.includes('rustica') || t.includes('urbano')) return { slug: 'terreno', label: 'Terrenos' };
  if (t.includes('garaje') || t.includes('parking')) return { slug: 'garaje', label: 'Garajes y parkings' };
  if (t.includes('local')) return { slug: 'local', label: 'Locales comerciales' };
  return null;
}

function precioNumerico(n) {
  const num = typeof n === 'string' ? parseFloat(n.replace(/[^\d.,-]/g, '').replace(',', '.')) : n;
  return isNaN(num) ? null : Math.round(num);
}

function jsonLd(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
}

function main() {
  const raw = JSON.parse(fs.readFileSync('properties.json', 'utf8'));
  const propiedades = raw.propiedades || [];
  const indexHtml = fs.readFileSync(INDEX_FILE, 'utf8');

  // Localizamos, dentro del index.html real, el <title> y el <meta description>
  // originales para poder sustituirlos por los de cada propiedad.
  const tituloOriginalMatch = indexHtml.match(/<title>[^<]*<\/title>/);
  const descOriginalMatch = indexHtml.match(/<meta name="description" content="[^"]*">/);
  if (!tituloOriginalMatch || !descOriginalMatch) {
    throw new Error(
      'No se ha encontrado el <title> o el <meta name="description"> originales en index.html. ' +
      'Puede que la cabecera del archivo haya cambiado: revisa este script antes de continuar.'
    );
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Limpia páginas de propiedades que ya no existen en el feed.
  const refsActuales = new Set(propiedades.map((p) => slugRef(p.referencia) + '.html'));
  if (fs.existsSync(OUT_DIR)) {
    for (const f of fs.readdirSync(OUT_DIR)) {
      if (f.endsWith('.html') && !refsActuales.has(f)) {
        fs.unlinkSync(path.join(OUT_DIR, f));
      }
    }
  }

  let generadas = 0;
  for (const p of propiedades) {
    const ref = slugRef(p.referencia);
    if (!ref) continue;

    const titulo = esc(p.titulo || 'Propiedad en venta');
    const precio = fmtPrecio(p.precio);
    const descripcionLimpia = limpiarTexto(p.descripcion);
    const descripcionCorta = esc(descripcionLimpia.replace(/\n+/g, ' ').slice(0, 160));
    const foto = (p.fotos && p.fotos[0]) || '';
    const url = `${SITE_URL}/${OUT_DIR}/${ref}.html`;
    const vendido = !!p.vendido;

    let pagina = indexHtml;

    // 1) Título y descripción propios de la propiedad.
    pagina = pagina.replace(tituloOriginalMatch[0], `<title>${titulo} · ${precio} · Ocean Immo</title>`);
    pagina = pagina.replace(
      descOriginalMatch[0],
      `<meta name="description" content="${descripcionCorta}">`
    );

    // 2) Etiquetas Open Graph / Twitter Card + canonical + robots, insertadas justo
    //    después del <meta name="description"> ya sustituido.
    const ogTags = [
      `<link rel="canonical" href="${url}">`,
      `<meta property="og:type" content="website">`,
      `<meta property="og:title" content="${titulo} · ${precio}">`,
      `<meta property="og:description" content="${descripcionCorta}">`,
      foto ? `<meta property="og:image" content="${esc(foto)}">` : '',
      `<meta property="og:url" content="${url}">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="robots" content="${vendido ? 'noindex,follow' : 'index,follow'}">`,
    ].filter(Boolean).join('\n');
    pagina = pagina.replace(
      `<meta name="description" content="${descripcionCorta}">`,
      `<meta name="description" content="${descripcionCorta}">\n${ogTags}`
    );

    // 2.5) Datos estructurados (Schema.org / JSON-LD): la ficha del inmueble en sí
    //      (precio, superficie, ubicación...) y la miga de pan (Inicio > Comprar > Tipo > Ficha),
    //      para que Google (y buscadores/IA que lean datos estructurados) entiendan la página.
    const precioNum = precioNumerico(p.precio);
    const m2Num = p.m2 ? Number(p.m2) : null;
    const breadcrumbTipo = tipoBreadcrumb(p.tipo);

    const listingLd = jsonLd({
      '@context': 'https://schema.org',
      '@type': 'RealEstateListing',
      name: p.titulo || undefined,
      description: descripcionLimpia || undefined,
      url,
      image: (p.fotos || []).slice(0, 8),
      datePosted: raw.actualizado || undefined,
      address: {
        '@type': 'PostalAddress',
        addressLocality: p.poblacion || undefined,
        addressRegion: 'Girona',
        addressCountry: 'ES',
      },
      floorSize: m2Num ? { '@type': 'QuantitativeValue', value: m2Num, unitCode: 'MTK' } : undefined,
      numberOfRooms: p.habitaciones ? Number(p.habitaciones) || undefined : undefined,
      numberOfBathroomsTotal: p.banos ? Number(p.banos) || undefined : undefined,
      offers: {
        '@type': 'Offer',
        price: precioNum || undefined,
        priceCurrency: 'EUR',
        availability: vendido ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
        url,
      },
    });

    const breadcrumbItems = [
      { '@type': 'ListItem', position: 1, name: 'Inicio', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'Comprar', item: `${SITE_URL}/comprar.html` },
    ];
    if (breadcrumbTipo) {
      breadcrumbItems.push({
        '@type': 'ListItem', position: 3, name: breadcrumbTipo.label,
        item: `${SITE_URL}/comprar/${breadcrumbTipo.slug}.html`,
      });
    }
    breadcrumbItems.push({
      '@type': 'ListItem', position: breadcrumbItems.length + 1, name: p.titulo || ref,
    });
    const breadcrumbLd = jsonLd({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: breadcrumbItems,
    });

    pagina = pagina.replace('</head>', `${listingLd}\n${breadcrumbLd}\n</head>`);

    // 3) Variable que la propia web (index.html) detecta al cargar para abrir
    //    automáticamente la ficha de esta propiedad, justo antes de </head>.
    pagina = pagina.replace(
      '</head>',
      `<script>window.__OPEN_PROPERTY_REF=${JSON.stringify(p.referencia)};</script>\n</head>`
    );

    // 4) Esta página vive en una subcarpeta (propiedades/), un nivel más adentro
    //    que index.html en la raíz. Las rutas relativas del propio index.html
    //    (properties.json, imgproxy, etc.) hay que subirlas un nivel para que
    //    sigan apuntando al sitio correcto.
    pagina = pagina.replace(/(["'(])\.\//g, '$1../');

    fs.writeFileSync(path.join(OUT_DIR, `${ref}.html`), pagina);
    generadas++;
  }

  console.log(`Generadas ${generadas} páginas individuales en ${OUT_DIR}/ (a partir de ${INDEX_FILE})`);
}

main();
