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
// Lista real donde el formulario de suscripción de la web mete a la gente,
// comprobado suscribiéndose de verdad desde la web y viendo dónde aparece el
// contacto en Brevo: en "Contactos que participan en las conversaciones" (ID 4).
// Las listas "Su primera lista" (ID 2) y "Suscriptores Ocean Immo" (ID 5) no
// reciben contactos del formulario real.
const BREVO_LIST_ID = 4;

function fmtPrecio(n) {
  const num = typeof n === 'string' ? parseFloat(n.replace(/[^\d.,-]/g, '').replace(',', '.')) : n;
  if (isNaN(num)) return n;
  return Math.round(num).toLocaleString('es-ES') + ' €';
}

async function avisarSuscriptores(nuevas, modoPrueba = false) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn('Falta BREVO_API_KEY: no se puede avisar a los suscriptores (revisa el secreto en GitHub).');
    return;
  }

  // Los títulos de Inmoweb suelen venir TODO EN MAYÚSCULAS. En el correo los pasamos a
  // minúsculas normales y mantenemos la mayúscula de los nombres de lugar.
  const LUGARES = ['roses', 'santa', 'margarita', 'margarida', 'empuriabrava', 'castelló', 'castello', "d'empúries", "d'empuries", 'empúries', 'empuries',
    'puig', 'rom', 'mas', 'matas', 'oliva', 'canyelles', 'costa', 'brava', 'girona', 'cadaqués', 'cadaques', 'llançà', 'llanca', 'figueres',
    'palau', 'saverdera', 'garriguella', 'vilajuïga', 'vilajuiga', 'pau', 'peralada', 'pedret', 'marzà', 'marza', 'sant', 'martí', 'llémena', 'cap', 'creus', 'jesús', 'jesus', 'nazaret', 'grecs', 'els'];
  const bonito = (p) => {
    const t = String(p.titulo || '').trim();
    const letras = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
    const mayus = letras.replace(/[^A-ZÀ-ÖØ-Þ]/g, '');
    if (!letras || mayus.length / letras.length < 0.6) return t;   // ya está en minúsculas normales
    const extra = `${p.zona || ''} ${p.poblacion || ''}`.toLowerCase().split(/\s+/).filter(Boolean);
    const lugares = new Set([...LUGARES, ...extra]);
    const out = t.toLowerCase().replace(/[a-zà-ÿ'’]+/g, (w) => (lugares.has(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w));
    return out.replace(/[a-zà-ÿ]/, (c) => c.toUpperCase()).replace(/¡\s+/g, '¡').replace(/\s+!/g, '!');
  };

  const WHATSAPP = '34632251470';
  const tarjetas = nuevas
    .map((p) => {
      const foto = p.fotos && p.fotos[0] ? p.fotos[0] : '';
      const tituloTxt = bonito(p);
      const titulo = escHtml(tituloTxt);
      const operacion = escHtml(p.operacion);
      const poblacion = escHtml(p.poblacion);
      const fotoSafe = escHtml(foto);
      // Enlace directo a la ficha (propiedades/<referencia>.html, mismo criterio que generate-property-pages.mjs)
      const refLimpia = String(p.referencia || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const urlFicha = escHtml(refLimpia ? `${SITE_URL}propiedades/${refLimpia}.html` : SITE_URL);
      const urlWa = escHtml(`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(`Hola, me interesa la propiedad ${refLimpia || tituloTxt}.`)}`);
      // Datos clave: solo los que existen, sin dejar huecos.
      const datos = [];
      if (Number(p.habitaciones) > 0) datos.push(`🛏 ${Number(p.habitaciones)} hab`);
      if (Number(p.banos) > 0) datos.push(`🛁 ${Number(p.banos)} ${Number(p.banos) === 1 ? 'baño' : 'baños'}`);
      if (Number(p.m2) > 0) datos.push(`📐 ${Math.round(Number(p.m2))} m²`);
      if (refLimpia) datos.push(`<span style="color:#8a8578">Ref. ${escHtml(refLimpia)}</span>`);
      const lineaDatos = datos.length
        ? `<p style="margin:0 0 18px;color:#4a5866;font-size:15px">${datos.join(' &nbsp;·&nbsp; ')}</p>`
        : '';
      return `
        <table role="presentation" style="width:100%;max-width:560px;margin:0 auto 24px;border:1px solid #e5e0d8;border-radius:10px;overflow:hidden;font-family:Helvetica,Arial,sans-serif;border-collapse:separate">
          <tr>${foto ? `<td><img src="${fotoSafe}" alt="${titulo}" style="width:100%;display:block;max-height:300px;object-fit:cover"></td>` : ''}</tr>
          <tr><td style="padding:18px 20px 22px">
            <p style="margin:0 0 6px;color:#039BA5;font-weight:700;font-size:13px;letter-spacing:.04em;text-transform:uppercase">${operacion}${poblacion ? ' · ' + poblacion : ''}</p>
            <h3 style="margin:0 0 8px;color:#1A2E43;font-size:20px;line-height:1.3">${titulo}</h3>
            <p style="margin:0 0 12px;color:#1A2E43;font-size:24px;font-weight:700">${escHtml(fmtPrecio(p.precio))}</p>
            ${lineaDatos}
            <a href="${urlFicha}" style="display:block;text-align:center;background:#039BA5;color:#fff;text-decoration:none;padding:13px;border-radius:100px;font-size:15px;font-weight:700;margin-bottom:10px">Ver en la web</a>
            <a href="${urlWa}" style="display:block;text-align:center;background:#fff;color:#128C7E;text-decoration:none;border:2px solid #25D366;padding:11px;border-radius:100px;font-size:15px;font-weight:700">💬 Pregúntanos por WhatsApp</a>
          </td></tr>
        </table>`;
    })
    .join('');

  const htmlContent = `
    <div style="background:#F6F1E7;padding:34px 14px 28px;font-family:Helvetica,Arial,sans-serif">
      <h2 style="text-align:center;color:#1A2E43;margin:0 0 22px;font-size:24px;line-height:1.25">
        ${nuevas.length === 1 ? 'Nueva propiedad disponible en Ocean Immo' : `${nuevas.length} nuevas propiedades disponibles en Ocean Immo`}
      </h2>
      ${tarjetas}
      <div style="max-width:560px;margin:26px auto 0;text-align:center;color:#8a8578;font-size:12px;line-height:1.7;border-top:1px solid #e5e0d8;padding-top:16px">
        <b style="color:#1A2E43">Ocean Immo</b> · Carrer de Bernat Desclot, 17 · Roses<br>
        Tel. 632 25 14 70 · API A14553 · AICAT 13757<br>
        Recibes este aviso porque te suscribiste en oceanimmocosta.com.<br>
        <a href="{{ unsubscribe }}" style="color:#8a8578">Darse de baja</a>
      </div>
    </div>`;

  // Quitamos saltos de línea del título para el asunto del correo: evita que alguien
  // intente inyectar cabeceras de email adicionales (Bcc, etc.) a través de ese campo.
  const tituloSeguro = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
  const subject =
    nuevas.length === 1
      ? `Nueva en ${tituloSeguro(nuevas[0].zona || nuevas[0].poblacion || 'Roses')}: ${tituloSeguro(bonito(nuevas[0]))}${nuevas[0].precio ? ' · ' + fmtPrecio(nuevas[0].precio) : ''}`
      : `${nuevas.length} nuevas propiedades en Ocean Immo`;

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
    // Diagnóstico 2: ¿funciona la clave y se entrega el correo?
    const testRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: 'Ocean Immo', email: 'oceanimmocosta@gmail.com' },
        to: [{ email: 'oceanimmocosta@gmail.com' }],
        subject: '[PRUEBA] ' + subject,
        htmlContent,
      }),
    });
    if (testRes.ok) console.log('Aviso de PRUEBA enviado a oceanimmocosta@gmail.com. Revisa la bandeja (y el spam).');
    else console.error('Error al enviar el aviso de prueba:', testRes.status, await testRes.text());
    return;
  }

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
