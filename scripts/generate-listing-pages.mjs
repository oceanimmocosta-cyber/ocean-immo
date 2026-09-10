// Genera las páginas de listado con URL propia:
//   - comprar.html                (todas las propiedades en venta)
//   - comprar/piso.html, comprar/terreno.html, etc. (una por cada tipo)
//
// Igual que generate-property-pages.mjs: parte del index.html real de la web
// (mismo header, footer, estilos...) y solo cambia el <title>/<meta description>
// e inyecta una variable que la propia web detecta al cargar para abrir
// directamente el listado correspondiente (con su filtro de tipo, si aplica).
//
// Se ejecuta DESPUÉS de sync-inmoweb.mjs, desde la raíz del repositorio.
import fs from 'fs';
import path from 'path';

const INDEX_FILE = 'index.html';
const SITE_URL = 'https://oceanimmocosta-cyber.github.io/ocean-immo';

function jsonLd(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
}
function breadcrumbLd(items) {
  return jsonLd({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem', position: i + 1, name: it.name, ...(it.url ? { item: it.url } : {}),
    })),
  });
}


// Mismos valores de "tipo" que usa el desplegable de Comprar en el propio index.html
// (data-filter-tipo). Si añades un tipo nuevo ahí, añádelo aquí también.
const TIPOS = [
  { slug: 'piso', tipoFilter: 'Piso', label: 'Pisos' },
  { slug: 'atico', tipoFilter: 'Ático', label: 'Áticos' },
  { slug: 'duplex', tipoFilter: 'Dúplex', label: 'Dúplex' },
  { slug: 'estudio', tipoFilter: 'Estudio', label: 'Estudios' },
  { slug: 'casa', tipoFilter: 'Casa / Chalet,Casa adosada', label: 'Casas y chalets' },
  { slug: 'terreno', tipoFilter: 'Finca rústica,Solar Urbano', label: 'Terrenos' },
  { slug: 'garaje', tipoFilter: 'Garaje / Parking', label: 'Garajes y parkings' },
  { slug: 'local', tipoFilter: 'Local Comercial', label: 'Locales comerciales' },
];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function main() {
  const indexHtml = fs.readFileSync(INDEX_FILE, 'utf8');

  const tituloOriginalMatch = indexHtml.match(/<title>[^<]*<\/title>/);
  const descOriginalMatch = indexHtml.match(/<meta name="description" content="[^"]*">/);
  if (!tituloOriginalMatch || !descOriginalMatch) {
    throw new Error(
      'No se ha encontrado el <title> o el <meta name="description"> originales en index.html. ' +
      'Puede que la cabecera del archivo haya cambiado: revisa este script antes de continuar.'
    );
  }

  // Página /servicios.html (sin filtro), al mismo nivel que index.html.
  {
    const titulo = 'Servicios inmobiliarios en Roses: NIE, cédula, certificado energético';
    const descripcion = 'Valoraciones gratuitas, gestión de NIE, cédula de habitabilidad, certificado energético, seguros e hipotecas. Ocean Immo te acompaña en todo el proceso en Roses y la Costa Brava.';
    let pagina = indexHtml;
    pagina = pagina.replace(tituloOriginalMatch[0], `<title>${esc(titulo)} · Ocean Immo</title>`);
    pagina = pagina.replace(descOriginalMatch[0], `<meta name="description" content="${esc(descripcion)}">`);
    pagina = pagina.replace(
      '</head>',
      `<script>window.__OPEN_PAGE=${JSON.stringify('servicios')};</script>\n</head>`
    );
    const bc = breadcrumbLd([
      { name: 'Inicio', url: `${SITE_URL}/` },
      { name: 'Servicios' },
    ]);
    pagina = pagina.replace('</head>', `${bc}\n</head>`);
    fs.writeFileSync('servicios.html', pagina);
  }

  // Página /comprar.html (sin filtro de tipo), al mismo nivel que index.html.
  {
    const titulo = 'Propiedades en venta en Roses y Costa Brava';
    const descripcion = 'Pisos, casas, terrenos y locales en venta en Roses y la Costa Brava. Cartera actualizada a diario, con atención en español, catalán, francés e inglés.';
    let pagina = indexHtml;
    pagina = pagina.replace(tituloOriginalMatch[0], `<title>${esc(titulo)} · Ocean Immo</title>`);
    pagina = pagina.replace(descOriginalMatch[0], `<meta name="description" content="${esc(descripcion)}">`);
    pagina = pagina.replace(
      '</head>',
      `<script>window.__OPEN_PAGE=${JSON.stringify('comprar')};</script>\n</head>`
    );
    const bc = breadcrumbLd([
      { name: 'Inicio', url: `${SITE_URL}/` },
      { name: 'Comprar' },
    ]);
    pagina = pagina.replace('</head>', `${bc}\n</head>`);
    fs.writeFileSync('comprar.html', pagina);
  }

  // Páginas /comprar/<tipo>.html, un nivel más adentro: hay que subir las rutas
  // relativas del propio index.html (properties.json, etc.) un nivel, igual que
  // hacemos en generate-property-pages.mjs para propiedades/.
  fs.mkdirSync('comprar', { recursive: true });
  for (const t of TIPOS) {
    const titulo = `${t.label} en venta en Roses y Costa Brava`;
    const descripcion = `${t.label} en venta en Roses y alrededores (Costa Brava). Cartera actualizada a diario por Ocean Immo, con atención en cuatro idiomas.`;
    let pagina = indexHtml;
    pagina = pagina.replace(tituloOriginalMatch[0], `<title>${esc(titulo)} · Ocean Immo</title>`);
    pagina = pagina.replace(descOriginalMatch[0], `<meta name="description" content="${esc(descripcion)}">`);
    pagina = pagina.replace(
      '</head>',
      `<script>window.__OPEN_PAGE=${JSON.stringify('comprar')};window.__OPEN_TIPO_FILTER=${JSON.stringify(t.tipoFilter)};</script>\n</head>`
    );
    const bc = breadcrumbLd([
      { name: 'Inicio', url: `${SITE_URL}/` },
      { name: 'Comprar', url: `${SITE_URL}/comprar.html` },
      { name: t.label },
    ]);
    pagina = pagina.replace('</head>', `${bc}\n</head>`);
    pagina = pagina.replace(/(["'(])\.\//g, '$1../');
    fs.writeFileSync(path.join('comprar', `${t.slug}.html`), pagina);
  }

  console.log(`Generadas comprar.html y ${TIPOS.length} páginas por tipo en comprar/`);
}

main();
