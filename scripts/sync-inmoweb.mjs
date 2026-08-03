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
    const banosNum = (Number(p.banos) || 0) + (Number(p.aseos) || 0);

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
      caracteristicas: feats,
      modalidad: opId === '6' ? 'Vacacional' : null,
      etiquetas: etiquetasRaw,
      vendido,
    };
  });

  fs.writeFileSync(
    'properties.json',
    JSON.stringify({ actualizado: new Date().toISOString(), propiedades }, null, 2)
  );
  console.log(`Guardadas ${propiedades.length} propiedades en properties.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
