// Descarga el feed XML de Inmoweb y lo convierte a properties.json
// para que la web de Ocean Immo lo lea sin depender del horario de disponibilidad de Inmoweb.
import { XMLParser } from 'fast-xml-parser';
import fs from 'fs';

const OP_MAP = { '1': 'Venta', '2': 'Alquiler', '3': 'Venta', '4': 'Alquiler', '5': 'Venta', '6': 'Alquiler' };

// Traduce cada característica del feed de Inmoweb a una frase legible en español.
// Si una característica no está presente o no aplica (valor vacío/"no"), no se incluye.
const FEATURE_LABELS = {
  piscina: (v) => (v ? `Piscina ${v}` : null),
  jardin: (v) => (v ? `Jardín ${v}` : null),
  garaje: (v) => (v && v !== 'no' ? 'Garaje' + (v === 'numerado' ? ' numerado' : '') : null),
  parking: (v) => (v && v !== 'no' ? 'Parking' + (v === 'numerado' ? ' numerado' : '') : null),
  ascensor: (v) => (v === '1' ? 'Ascensor' : null),
  chimenea: (v) => (v === '1' ? 'Chimenea' : null),
  trastero: (v) => (v === '1' ? 'Trastero' : null),
  aa: (v) => (v === '1' ? 'Aire acondicionado' : null),
  armarios_empotrados: (v) => (v === '1' ? 'Armarios empotrados' : null),
  puerta_blindada: (v) => (v === '1' ? 'Puerta blindada' : null),
  primera_linea: (v) => (v === '1' ? 'Primera línea de mar' : null),
  solarium: (v) => (v === '1' ? 'Solárium' : null),
  amueblado: (v) => (v && v !== 'no' ? (v === 'semi amueblado' ? 'Semi amueblado' : 'Amueblado') : null),
  vistas: (v) => (v ? `Vistas a ${v}` : null),
  orientacion: (v) => (v ? `Orientación ${v}` : null),
  calefaccion: (v) => (v && v !== 'no disponible' ? `Calefacción ${v}` : null),
  doble_acristalamiento: (v) => (v === '1' ? 'Doble acristalamiento' : null),
  terraza: (v) => (v ? `Terraza (${v})` : null),
};

function toArray(x) {
  return x == null ? [] : (Array.isArray(x) ? x : [x]);
}

function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'object') return String(node['#text'] ?? '').trim();
  return String(node).trim();
}

// Escapa texto antes de insertarlo en HTML (el email de aviso), para evitar que datos
// externos de Inmoweb (título, zona...) puedan inyectar código en el correo enviado.
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function main() {
  const key = process.env.INMOWEB_KEY;
  if (!key) throw new Error('Falta la variable de entorno INMOWEB_KEY (revisa el secreto en GitHub).');

  const res = await fetch(`https://feed.inmoweb.es/?key=${key}`);
  if (!res.ok) throw new Error('Error al descargar el feed de Inmoweb: HTTP ' + res.status);
  const xml = await res.text();

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });
  const data = parser.parse(xml);
  const propsRaw = toArray(data.properties?.propiedad);

  const propiedades = propsRaw.map((p) => {
    const opId = String(p.operacion?.['@_id'] ?? '');
    const operacion = OP_MAP[opId] || 'Venta';

    const descs = toArray(p.descripciones?.descripcion);
    const descEs = descs.find((d) => d['@_idioma'] === 'es') || descs[0] || {};
    const titulo = textOf(descEs.titulo);
    const descripcion = textOf(descEs.descripcion);

    const imgs = toArray(p.imagenes?.imagen)
      .map((i) => i['@_url'])
      .filter(Boolean);

    const caract = toArray(p.caracteristicas?.caracteristica);
    const cmap = {};
    caract.forEach((c) => {
      cmap[c['@_id']] = textOf(c);
    });

    const feats = Object.keys(FEATURE_LABELS)
      .map((k) => FEATURE_LABELS[k](cmap[k]))
      .filter(Boolean);

    const zona = textOf(p.localizacion?.zona) || textOf(p.localizacion?.poblacion);
    const poblacion = textOf(p.localizacion?.poblacion) || textOf(p.localizacion?.zona);
    const banosNum = Number(p.banos) || 0;

    // Inmoweb marca el estado con "etiquetas" (Vendido, Reservado, Exclusiva...),
    // no con un campo "estado" como se probó al principio. Puede haber una sola
    // etiqueta (texto) o varias (lista), así que lo tratamos siempre como lista.
    const etiquetasRaw = toArray(p.etiquetas?.etiqueta).map((e) => textOf(e));
    const etiquetasNorm = etiquetasRaw.map((e) => e.toLowerCase());
    const vendido = etiquetasNorm.some((e) => e.includes('vend'));

    return {
      referencia: textOf(p.referencia) || String(p['@_id'] || ''),
      titulo,
      descripcion,
      operacion,
      zona,
      poblacion,
      precio: textOf(p.precio),
      m2: p.superficies?.construida || p.superficies?.habitable || null,
      habitaciones: p.dormitorios ?? null,
      banos: banosNum || null,
      fotos: imgs,
      anioConstruccion: cmap['ano_construccion'] || null,
      certEnergetica: cmap['certificacion_energetica'] || '',
      certConsumoLetra: cmap['certificacion_energetica_letra'] || '',
      certConsumoValor: cmap['certificacion_energetica_valor'] || '',
      certEmisionesLetra: cmap['certificacion_emisiones_letra'] || '',
      certEmisionesValor: cmap['certificacion_emisiones_valor'] || '',
      caracteristicas: feats,
      modalidad: opId === '6' ? 'Vacacional' : null,
      etiquetas: etiquetasRaw,
      vendido,
    };
  });

  // Si el feed devuelve 0 propiedades pero antes había muchas, algo ha ido mal
  // (feed caído, XML corrupto...). Mejor no sobrescribir y avisar, que borrar la cartera.
  let propiedadesAnteriores = [];
  try {
    const anterior = JSON.parse(fs.readFileSync('properties.json', 'utf8'));
    propiedadesAnteriores = anterior.propiedades || [];
  } catch {
    // No hay properties.json previo (primera ejecución) — no se avisa de "nuevas" la primera vez.
  }

  if (propiedades.length === 0 && propiedadesAnteriores.length > 0) {
    throw new Error(
      `El feed de Inmoweb ha devuelto 0 propiedades, pero antes había ${propiedadesAnteriores.length}. ` +
      `Por seguridad, no se sobrescribe properties.json. Revisa el feed de Inmoweb manualmente.`
    );
  }

  // ===== Detectar propiedades nuevas comparando con el properties.json anterior =====
  const refsAnteriores = new Set(propiedadesAnteriores.map((p) => p.referencia));
  const nuevas = propiedadesAnteriores.length
    ? propiedades.filter((p) => !refsAnteriores.has(p.referencia) && !p.vendido)
    : [];

  fs.writeFileSync(
    'properties.json',
    JSON.stringify({ actualizado: new Date().toISOString(), propiedades }, null, 2)
  );
  console.log(`Guardadas ${propiedades.length} propiedades en properties.json`);

  if (nuevas.length) {
    console.log(`Detectadas ${nuevas.length} propiedades nuevas. Avisando a los suscriptores...`);
    await avisarSuscriptores(nuevas);
  } else {
    console.log('No hay propiedades nuevas desde la última sincronización.');
  }
}

const SITE_URL = 'https://oceanimmocosta-cyber.github.io/ocean-immo/';
const BREVO_LIST_ID = 5;

function fmtPrecio(n) {
  const num = typeof n === 'string' ? parseFloat(n.replace(/[^\d.,-]/g, '').replace(',', '.')) : n;
  if (isNaN(num)) return n;
  return Math.round(num).toLocaleString('es-ES') + ' €';
}

async function avisarSuscriptores(nuevas) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn('Falta BREVO_API_KEY: no se puede avisar a los suscriptores (revisa el secreto en GitHub).');
    return;
  }

  const tarjetas = nuevas
    .map((p) => {
      const foto = p.fotos && p.fotos[0] ? p.fotos[0] : '';
      const titulo = escHtml(p.titulo);
      const operacion = escHtml(p.operacion);
      const poblacion = escHtml(p.poblacion);
      const fotoSafe = escHtml(foto);
      return `
        <table style="width:100%;max-width:560px;margin:0 auto 24px;border:1px solid #e5e0d8;border-radius:8px;overflow:hidden;font-family:Helvetica,Arial,sans-serif">
          <tr>${foto ? `<td><img src="${fotoSafe}" alt="${titulo}" style="width:100%;display:block;max-height:260px;object-fit:cover"></td>` : ''}</tr>
          <tr><td style="padding:16px 20px">
            <p style="margin:0 0 4px;color:#039BA5;font-weight:700;font-size:13px;letter-spacing:.03em;text-transform:uppercase">${operacion}${poblacion ? ' · ' + poblacion : ''}</p>
            <h3 style="margin:0 0 8px;color:#1A2E43;font-size:19px">${titulo}</h3>
            <p style="margin:0 0 14px;color:#1A2E43;font-size:18px;font-weight:700">${escHtml(fmtPrecio(p.precio))}</p>
            <a href="${SITE_URL}" style="display:inline-block;background:#039BA5;color:#fff;text-decoration:none;padding:10px 22px;border-radius:100px;font-size:14px;font-weight:600">Ver en la web</a>
          </td></tr>
        </table>`;
    })
    .join('');

  const htmlContent = `
    <div style="background:#F6F1E7;padding:32px 16px;font-family:Helvetica,Arial,sans-serif">
      <h2 style="text-align:center;color:#1A2E43;margin-bottom:24px">
        ${nuevas.length === 1 ? 'Nueva propiedad disponible en Ocean Immo' : `${nuevas.length} nuevas propiedades disponibles en Ocean Immo`}
      </h2>
      ${tarjetas}
      <p style="text-align:center;color:#8a8578;font-size:12px;margin-top:24px">Ocean Immo · Roses, Costa Brava</p>
    </div>`;

  // Quitamos saltos de línea del título para el asunto del correo: evita que alguien
  // intente inyectar cabeceras de email adicionales (Bcc, etc.) a través de ese campo.
  const tituloSeguro = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
  const subject =
    nuevas.length === 1
      ? `Nueva propiedad: ${tituloSeguro(nuevas[0].titulo)}`
      : `${nuevas.length} nuevas propiedades en Ocean Immo`;

  const createRes = await fetch('https://api.brevo.com/v3/emailCampaigns', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      name: `Aviso automático - ${new Date().toISOString().slice(0, 10)}`,
      subject,
      sender: { name: 'Ocean Immo', email: 'oceanimmocosta@gmail.com' },
      htmlContent,
      recipients: { listIds: [BREVO_LIST_ID] },
    }),
  });
  if (!createRes.ok) {
    console.error('Error al crear la campaña en Brevo:', createRes.status, await createRes.text());
    return;
  }
  const { id } = await createRes.json();

  const sendRes = await fetch(`https://api.brevo.com/v3/emailCampaigns/${id}/sendNow`, {
    method: 'POST',
    headers: { 'api-key': apiKey, Accept: 'application/json' },
  });
  if (!sendRes.ok) {
    console.error('Error al enviar la campaña en Brevo:', sendRes.status, await sendRes.text());
    return;
  }
  console.log('Aviso enviado a los suscriptores correctamente.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
