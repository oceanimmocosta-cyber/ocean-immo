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

// Toma el primer campo de superficie que tenga un valor numérico real (> 0),
// en vez de simplemente "no vacío" (Inmoweb a veces manda "0" como texto, que
// técnicamente no está vacío pero tampoco es un dato útil).
function primeraSuperficieValida(...valores) {
  for (const v of valores) {
    const n = Number(v);
    if (!isNaN(n) && n > 0) return v;
  }
  return null;
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

  const propiedadesFeed = propsRaw.map((p) => {
    const opId = String(p.operacion?.['@_id'] ?? '');
    const operacion = OP_MAP[opId] || 'Venta';

    const descs = toArray(p.descripciones?.descripcion);
    // Inmoweb no siempre usa los códigos ISO estándar en el feed:
    // catalán = 'cat' (no 'ca'), inglés = 'gb' (no 'en').
    const IDIOMA_ALIASES = { ca: ['ca', 'cat'], en: ['en', 'gb'] };
    function descPorIdioma(lang) {
      const codigos = IDIOMA_ALIASES[lang] || [lang];
      const d = descs.find((d) => codigos.includes(d['@_idioma']));
      return d ? { titulo: textOf(d.titulo), descripcion: textOf(d.descripcion) } : null;
    }
    const descEs = descPorIdioma('es') || (descs[0]
      ? { titulo: textOf(descs[0].titulo), descripcion: textOf(descs[0].descripcion) }
      : { titulo: '', descripcion: '' });
    const descCa = descPorIdioma('ca');
    const descFr = descPorIdioma('fr');
    const descEn = descPorIdioma('en');
    const titulo = descEs.titulo;
    const descripcion = descEs.descripcion;

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
    const tipo = textOf(p.familia);
    const banosNum = Number(p.banos) || 0;

    // Inmoweb marca el estado con "etiquetas" (Vendido, Reservado, Exclusiva...),
    // no con un campo "estado" como se probó al principio. Puede haber una sola
    // etiqueta (texto) o varias (lista), así que lo tratamos siempre como lista.
    const etiquetasRaw = toArray(p.etiquetas?.etiqueta).map((e) => textOf(e));
    const etiquetasNorm = etiquetasRaw.map((e) => e.toLowerCase());
    const vendido = etiquetasNorm.some((e) => e.includes('vend'));
    const reservado = !vendido && etiquetasNorm.some((e) => e.includes('reserv'));

    return {
      referencia: textOf(p.referencia) || String(p['@_id'] || ''),
      titulo,
      descripcion,
      tituloCa: descCa ? descCa.titulo : null,
      descripcionCa: descCa ? descCa.descripcion : null,
      tituloFr: descFr ? descFr.titulo : null,
      descripcionFr: descFr ? descFr.descripcion : null,
      tituloEn: descEn ? descEn.titulo : null,
      descripcionEn: descEn ? descEn.descripcion : null,
      operacion,
      zona,
      poblacion,
      tipo,
      precio: textOf(p.precio),
      m2: primeraSuperficieValida(p.superficies?.construida, p.superficies?.habitable, p.superficies?.parcela),
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
      reservado,
    };
  });

  // Propiedades inacabadas: sin título, sin precio y sin fotos. Inmoweb las envía si alguien
  // las marca para la web sin querer; aquí se ignoran hasta que tengan lo mínimo para mostrarse.
  const propiedades = propiedadesFeed.filter((p) => {
    const incompleta = !String(p.titulo || '').trim() && !String(p.precio || '').trim() && (!p.fotos || p.fotos.length === 0);
    if (incompleta) console.log(`Propiedad ${p.referencia} ignorada: está inacabada (sin título, precio ni fotos).`);
    return !incompleta;
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

  // Modo prueba (se activa a mano desde Actions → Run workflow → "probar_aviso"):
  // envía el aviso SOLO a oceanimmocosta@gmail.com con una propiedad cualquiera,
  // para comprobar la clave de Brevo y el remitente sin molestar a los suscriptores.
  // Reenvío REAL (se activa a mano desde Actions → Run workflow → "avisar_suscriptores_ahora"):
  // manda de verdad el aviso a TODOS los suscriptores de la lista con una propiedad
  // de ejemplo, para comprobar que el envío completo funciona.
  if (process.env.REAVISAR === 'true' && process.env.PROBAR_AVISO !== 'true') {
    const ejemplo = propiedades.find((p) => !p.vendido) || propiedades[0];
    if (ejemplo) {
      console.log('REENVÍO REAL: avisando a todos los suscriptores con la propiedad ' + ejemplo.referencia);
      await avisarSuscriptores([ejemplo]);
    }
  }

  if (process.env.PROBAR_AVISO === 'true') {
    const ejemplo = propiedades.find((p) => !p.vendido) || propiedades[0];
    if (ejemplo) {
      console.log('MODO PRUEBA: enviando aviso de prueba a oceanimmocosta@gmail.com');
      await avisarSuscriptores([ejemplo], true);
    }
  }
}

const SITE_URL = 'https://www.oceanimmocosta.com/';
// Una lista de Brevo por idioma. Cada formulario de suscripción de la web (según el idioma
// en que el visitante tenga la web) mete el contacto en SU lista, así cada suscriptor
// recibe el aviso en su idioma. es=4, ca=6, en=7, fr=8.
const BREVO_LISTAS = { es: 4, ca: 6, en: 7, fr: 8 };

function fmtPrecio(n, lang = 'es') {
  const num = typeof n === 'string' ? parseFloat(n.replace(/[^\d.,-]/g, '').replace(',', '.')) : n;
  if (isNaN(num)) return n;
  const r = Math.round(num);
  if (lang === 'en') return '€' + r.toLocaleString('en-GB');
  if (lang === 'fr') return r.toLocaleString('fr-FR').replace(/[  ]/g, ' ') + ' €';
  return r.toLocaleString('es-ES') + ' €';
}

// Textos del correo en cada idioma.
const TEXTOS = {
  es: {
    venta: 'Venta', hab: 'hab', bano: 'baño', banos: 'baños',
    tituloUno: 'Nueva propiedad<br>en Ocean Immo', tituloVarias: (n) => `${n} nuevas propiedades<br>en Ocean Immo`,
    intro: (z) => `Una nueva propiedad${z ? ' en ' + z : ''} acaba de publicarse en Ocean Immo.`,
    ver: 'Ver la propiedad en nuestra web', wa: 'Escríbenos por WhatsApp',
    waMsg: (r) => `Hola, me interesa la propiedad ${r}.`,
    preVarias: (n) => `${n} nuevas propiedades en Roses y la Costa Brava`,
    asuntoUno: (z, t, p) => `Nueva en ${z}: ${t}${p ? ' · ' + p : ''}`, asuntoVarias: (n) => `${n} nuevas propiedades en Ocean Immo`,
    pie: 'Recibes este aviso porque te suscribiste en oceanimmocosta.com.', baja: 'Darse de baja',
    firmaImg: 'firma-email.png', firmaW: 200, firmaAlt: 'Un saludo, el equipo de Ocean Immo',
  },
  ca: {
    venta: 'Venda', hab: 'hab', bano: 'bany', banos: 'banys',
    tituloUno: 'Nova propietat<br>a Ocean Immo', tituloVarias: (n) => `${n} noves propietats<br>a Ocean Immo`,
    intro: (z) => `Una nova propietat${z ? ' a ' + z : ''} acaba de publicar-se a Ocean Immo.`,
    ver: 'Veure la propietat a la nostra web', wa: 'Escriu-nos per WhatsApp',
    waMsg: (r) => `Hola, m'interessa la propietat ${r}.`,
    preVarias: (n) => `${n} noves propietats a Roses i la Costa Brava`,
    asuntoUno: (z, t, p) => `Nova a ${z}: ${t}${p ? ' · ' + p : ''}`, asuntoVarias: (n) => `${n} noves propietats a Ocean Immo`,
    pie: 'Reps aquest avís perquè et vas subscriure a oceanimmocosta.com.', baja: 'Donar-se de baixa',
    firmaImg: 'firma-email-ca.png', firmaW: 182, firmaAlt: "Una salutació, l'equip d'Ocean Immo",
  },
  en: {
    venta: 'For sale', hab: 'bed', bano: 'bath', banos: 'baths',
    tituloUno: 'New property<br>at Ocean Immo', tituloVarias: (n) => `${n} new properties<br>at Ocean Immo`,
    intro: (z) => `A new property${z ? ' in ' + z : ''} has just been listed on Ocean Immo.`,
    ver: 'View the property on our website', wa: 'Message us on WhatsApp',
    waMsg: (r) => `Hello, I'm interested in property ${r}.`,
    preVarias: (n) => `${n} new properties in Roses and the Costa Brava`,
    asuntoUno: (z, t, p) => `New in ${z}: ${t}${p ? ' · ' + p : ''}`, asuntoVarias: (n) => `${n} new properties at Ocean Immo`,
    pie: 'You are receiving this alert because you subscribed at oceanimmocosta.com.', baja: 'Unsubscribe',
    firmaImg: 'firma-email-en.png', firmaW: 178, firmaAlt: 'Kind regards, the Ocean Immo team',
  },
  fr: {
    venta: 'À vendre', hab: 'ch.', bano: 'sdb', banos: 'sdb',
    tituloUno: 'Nouveau bien<br>chez Ocean Immo', tituloVarias: (n) => `${n} nouveaux biens<br>chez Ocean Immo`,
    intro: (z) => `Un nouveau bien${z ? ' à ' + z : ''} vient d’être publié sur Ocean Immo.`,
    ver: 'Voir le bien sur notre site', wa: 'Écrivez-nous sur WhatsApp',
    waMsg: (r) => `Bonjour, je suis intéressé(e) par le bien ${r}.`,
    preVarias: (n) => `${n} nouveaux biens à Roses et sur la Costa Brava`,
    asuntoUno: (z, t, p) => `Nouveau à ${z} : ${t}${p ? ' · ' + p : ''}`, asuntoVarias: (n) => `${n} nouveaux biens chez Ocean Immo`,
    pie: 'Vous recevez cet avis car vous êtes inscrit(e) sur oceanimmocosta.com.', baja: 'Se désabonner',
    firmaImg: 'firma-email-fr.png', firmaW: 176, firmaAlt: 'Cordialement, l’équipe Ocean Immo',
  },
};

// Los títulos de Inmoweb suelen venir TODO EN MAYÚSCULAS. En el correo los pasamos a
// minúsculas normales y mantenemos la mayúscula de los nombres de lugar.
const LUGARES = ['roses', 'santa', 'margarita', 'margarida', 'empuriabrava', 'castelló', 'castello', "d'empúries", "d'empuries", 'empúries', 'empuries',
  'puig', 'rom', 'mas', 'matas', 'oliva', 'canyelles', 'costa', 'brava', 'girona', 'cadaqués', 'cadaques', 'llançà', 'llanca', 'figueres',
  'palau', 'saverdera', 'garriguella', 'vilajuïga', 'vilajuiga', 'pau', 'peralada', 'pedret', 'marzà', 'marza', 'sant', 'martí', 'llémena', 'cap', 'creus', 'jesús', 'jesus', 'nazaret', 'grecs', 'els'];

// Título de la propiedad en el idioma pedido (si Inmoweb no lo trae, el español).
function tituloIdioma(p, lang) {
  const t = { es: p.titulo, ca: p.tituloCa, en: p.tituloEn, fr: p.tituloFr }[lang];
  return String(t || p.titulo || '').trim();
}

function bonito(p, lang = 'es') {
  const t = tituloIdioma(p, lang);
  const letras = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
  const mayus = letras.replace(/[^A-ZÀ-ÖØ-Þ]/g, '');
  if (!letras || mayus.length / letras.length < 0.6) return t;   // ya está en minúsculas normales
  const extra = `${p.zona || ''} ${p.poblacion || ''}`.toLowerCase().split(/\s+/).filter(Boolean);
  const lugares = new Set([...LUGARES, ...extra]);
  const out = t.toLowerCase().replace(/[a-zà-ÿ'’]+/g, (w) => (lugares.has(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w));
  const limpio = out.replace(/[a-zà-ÿ]/, (c) => c.toUpperCase()).replace(/¡\s+/g, '¡').replace(/\s+!/g, '!');
  // En francés se escribe un espacio antes de ! y ?
  return lang === 'fr' ? limpio.replace(/\s*([!?])/g, '\u00a0$1') : limpio;
}

// Quitamos saltos de línea del título para el asunto del correo: evita que alguien
// intente inyectar cabeceras de email adicionales (Bcc, etc.) a través de ese campo.
const tituloSeguro = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();

// Construye el correo (asunto + HTML) en un idioma.
function construirCorreo(nuevas, lang) {
  const T = TEXTOS[lang] || TEXTOS.es;
  const WHATSAPP = '34632251470';
  const IMG = (f) => `${SITE_URL}${f}`;   // imágenes del correo: están en la raíz del repositorio
  const NAVY = '#1A2E43', TURQ = '#039BA5', GRIS = '#8a95a1';
  const sufijoLang = lang === 'es' ? '' : `?lang=${lang}`;

  const tarjetas = nuevas
    .map((p, i) => {
      const foto = p.fotos && p.fotos[0] ? p.fotos[0] : '';
      const tituloTxt = bonito(p, lang);
      const titulo = escHtml(tituloTxt);
      const operacion = escHtml(T.venta);
      const zona = escHtml(p.zona || p.poblacion || '');
      // Enlace directo a la ficha (propiedades/<referencia>.html, mismo criterio que generate-property-pages.mjs)
      // ?lang=xx hace que la ficha se abra ya en el idioma del suscriptor.
      const refLimpia = String(p.referencia || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const urlFicha = escHtml(refLimpia ? `${SITE_URL}propiedades/${refLimpia}.html${sufijoLang}` : SITE_URL + sufijoLang);
      const urlWa = escHtml(`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(T.waMsg(refLimpia || tituloTxt))}`);
      // Datos clave: solo los que existen, sin dejar huecos.
      const datos = [];
      if (Number(p.habitaciones) > 0) datos.push(`🛏 ${Number(p.habitaciones)} ${T.hab}`);
      if (Number(p.banos) > 0) datos.push(`🛁 ${Number(p.banos)} ${Number(p.banos) === 1 ? T.bano : T.banos}`);
      if (Number(p.m2) > 0) datos.push(`📐 ${Math.round(Number(p.m2))} m²`);
      const lineaDatos = datos.length
        ? `<p style="margin:0 18px;text-align:center;color:${NAVY};font-size:15px;font-weight:700">${datos.map((d) => `<span style="white-space:nowrap">${d}</span>`).join(' &nbsp;|&nbsp; ')}</p>`
        : '';
      const refHtml = refLimpia
        ? `<p style="margin:0 0 14px;text-align:center;color:${GRIS};font-size:12px;letter-spacing:.06em">REF. ${escHtml(refLimpia)}</p>`
        : '<div style="height:10px"></div>';
      return `
      <div style="${i > 0 ? 'border-top:1px solid #e6ebf0;margin-top:30px;padding-top:6px' : ''}">
        ${foto ? `<div style="padding:20px 18px 0"><img src="${escHtml(foto)}" alt="${titulo}" width="564" style="width:100%;height:auto;display:block;border-radius:12px"></div>` : ''}
        <table role="presentation" width="100%" style="border-collapse:collapse;margin-top:18px"><tr>
          <td style="padding:0 0 0 18px;vertical-align:middle">
            <span style="display:block;color:${TURQ};font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase">${operacion}</span>
            <span style="display:block;font-family:Georgia,serif;font-size:18px;font-weight:700;margin-top:3px;color:${NAVY}">${zona}</span>
          </td>
          <td style="padding:0 18px 0 0;text-align:right;vertical-align:middle">
            <span style="display:inline-block;background:${TURQ};color:#ffffff;font-size:19px;font-weight:700;padding:7px 16px;border-radius:100px;white-space:nowrap">${escHtml(fmtPrecio(p.precio, lang))}</span>
          </td>
        </tr></table>
        <h3 style="margin:18px 22px 6px;text-align:center;font-family:Georgia,serif;font-size:21px;line-height:1.32;font-weight:700;color:${NAVY}">${titulo}</h3>
        ${refHtml}
        ${lineaDatos}
        <p style="margin:20px 26px 0;text-align:center;color:#3b4b5b;font-size:15px;line-height:1.6">${escHtml(T.intro(p.zona || p.poblacion || ''))}</p>
        <div style="padding:20px 22px 0">
          <a href="${urlFicha}" style="display:block;text-align:center;background:${NAVY};color:#ffffff;text-decoration:none;padding:15px;border-radius:100px;font-size:15px;font-weight:700;margin-bottom:10px"><img src="${IMG('casa-blanca.png')}" width="18" height="18" alt="" style="vertical-align:-3px;margin-right:8px;border:0">${escHtml(T.ver)}</a>
          <a href="${urlWa}" style="display:block;text-align:center;background:#ffffff;color:${NAVY};text-decoration:none;border:2px solid ${TURQ};padding:13px;border-radius:100px;font-size:15px;font-weight:700"><img src="${IMG('chat-turquesa.png')}" width="20" height="20" alt="" style="vertical-align:-4px;margin-right:8px;border:0">${escHtml(T.wa)}</a>
        </div>
      </div>`;
    })
    .join('');

  const primera = nuevas[0] || {};
  const preheader = escHtml(
    nuevas.length === 1
      ? `${bonito(primera, lang)}${primera.precio ? ' · ' + fmtPrecio(primera.precio, lang) : ''}`
      : T.preVarias(nuevas.length)
  );
  const htmlContent = `
    <meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><style>:root{color-scheme:light only;supported-color-schemes:light only}</style>
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#ffffff">${preheader}</div>
    <div style="background-color:#e9eef3;background-image:linear-gradient(#e9eef3,#e9eef3);padding:0;margin:0">
    <div style="max-width:600px;margin:0 auto;background-color:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);font-family:Helvetica,Arial,sans-serif;color:${NAVY}">
      <div style="text-align:center;padding:28px 16px 6px"><img src="${IMG('logo-email.png')}" width="210" alt="Ocean Immo" style="height:auto;display:inline-block;border:0"></div>
      <div style="padding:18px 20px 0;text-align:center">
        <span style="font-family:Georgia,serif;font-size:23px;font-weight:700;line-height:1.3;color:${NAVY}">${nuevas.length === 1 ? T.tituloUno : T.tituloVarias(nuevas.length)}</span>
        <div style="width:44px;height:3px;background:${TURQ};border-radius:3px;margin:12px auto 0"></div>
      </div>
      ${tarjetas}
      <div style="padding:26px 22px 0"><img src="${IMG(T.firmaImg)}" width="${T.firmaW}" alt="${escHtml(T.firmaAlt)}" style="display:block;height:auto;border:0"></div>
      <div style="background-color:#d9f1f3;background-image:url(${IMG('olas-email.jpg')}),linear-gradient(#d9f1f3,#d9f1f3);background-size:100% 100%;background-position:center bottom;background-repeat:no-repeat;padding:48px 16px 22px;text-align:center;font-size:12px;line-height:1.75;color:${NAVY}">
        <b>Ocean Immo</b> · Carrer de Bernat Desclot, 17 · Roses<br>
        Tel. 632 25 14 70 · API A14553 · AICAT 13757<br>
        <span style="color:#3b5368">${escHtml(T.pie)}</span><br>
        <a href="{{ unsubscribe }}" style="color:${NAVY}">${escHtml(T.baja)}</a>
      </div>
    </div>
    </div>`;

  const subject =
    nuevas.length === 1
      ? T.asuntoUno(tituloSeguro(nuevas[0].zona || nuevas[0].poblacion || 'Roses'), tituloSeguro(bonito(nuevas[0], lang)), nuevas[0].precio ? fmtPrecio(nuevas[0].precio, lang) : '')
      : T.asuntoVarias(nuevas.length);
  return { subject, htmlContent };
}

async function avisarSuscriptores(nuevas, modoPrueba = false) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn('Falta BREVO_API_KEY: no se puede avisar a los suscriptores (revisa el secreto en GitHub).');
    return;
  }
  const idiomas = Object.keys(BREVO_LISTAS);

  if (modoPrueba) {
    // Diagnóstico 1: ¿está validado el remitente en Brevo?
    const sendersRes = await fetch('https://api.brevo.com/v3/senders', {
      headers: { 'api-key': apiKey, Accept: 'application/json' },
    });
    if (sendersRes.ok) {
      const { senders = [] } = await sendersRes.json();
      const mio = senders.find((x) => String(x.email).toLowerCase() === 'oceanimmocosta@gmail.com');
      console.log(
        mio
          ? `Remitente oceanimmocosta@gmail.com en Brevo: activo=${mio.active}`
          : 'AVISO: oceanimmocosta@gmail.com NO está dado de alta como remitente en Brevo (Remitentes y IP → Remitentes). Los avisos fallarán.'
      );
    } else {
      console.error('No se pudo consultar los remitentes de Brevo:', sendersRes.status, await sendersRes.text());
    }
    // Diagnóstico 2: ¿funciona la clave y se entrega el correo? Se envía uno por idioma.
    for (const lang of idiomas) {
      const { subject, htmlContent } = construirCorreo(nuevas, lang);
      const testRes = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          sender: { name: 'Ocean Immo', email: 'oceanimmocosta@gmail.com' },
          to: [{ email: 'oceanimmocosta@gmail.com' }],
          subject: `[PRUEBA ${lang.toUpperCase()}] ` + subject,
          htmlContent,
        }),
      });
      if (testRes.ok) console.log(`Aviso de PRUEBA (${lang}) enviado a oceanimmocosta@gmail.com. Revisa la bandeja (y el spam).`);
      else console.error(`Error al enviar el aviso de prueba (${lang}):`, testRes.status, await testRes.text());
    }
    return;
  }

  // Envío real: una campaña por idioma, a la lista de ese idioma.
  for (const lang of idiomas) {
    const listId = BREVO_LISTAS[lang];
    // Si la lista aún no tiene suscriptores confirmados, no se crea la campaña.
    try {
      const lr = await fetch(`https://api.brevo.com/v3/contacts/lists/${listId}`, {
        headers: { 'api-key': apiKey, Accept: 'application/json' },
      });
      if (lr.ok) {
        const info = await lr.json();
        if (Number(info.totalSubscribers ?? info.uniqueSubscribers ?? 1) === 0) {
          console.log(`Lista ${lang} (#${listId}) vacía: no hay nadie a quien avisar en ese idioma.`);
          continue;
        }
      }
    } catch (e) {
      console.warn(`No se pudo consultar la lista ${lang} (#${listId}); se intenta enviar igualmente.`);
    }

    const { subject, htmlContent } = construirCorreo(nuevas, lang);
    const createRes = await fetch('https://api.brevo.com/v3/emailCampaigns', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        name: `Aviso automático ${lang.toUpperCase()} - ${new Date().toISOString().slice(0, 10)}`,
        subject,
        sender: { name: 'Ocean Immo', email: 'oceanimmocosta@gmail.com' },
        htmlContent,
        recipients: { listIds: [listId] },
      }),
    });
    if (!createRes.ok) {
      console.error(`Error al crear la campaña (${lang}) en Brevo:`, createRes.status, await createRes.text());
      continue;
    }
    const { id } = await createRes.json();

    const sendRes = await fetch(`https://api.brevo.com/v3/emailCampaigns/${id}/sendNow`, {
      method: 'POST',
      headers: { 'api-key': apiKey, Accept: 'application/json' },
    });
    if (!sendRes.ok) {
      console.error(`Error al enviar la campaña (${lang}) en Brevo:`, sendRes.status, await sendRes.text());
      continue;
    }
    console.log(`Aviso (${lang}) enviado a la lista #${listId} correctamente.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
