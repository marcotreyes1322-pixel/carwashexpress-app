/**
 * CAR WASH EXPRESS → GOOGLE CALENDAR (automático)
 * =====================================================================
 * Qué hace: cada 5 minutos lee las citas de la app (Firebase) y las deja en
 * un calendario de Google llamado "Car Wash Express":
 *   · cita nueva          → crea el evento
 *   · cita reagendada     → mueve el evento (el mismo, no uno nuevo)
 *   · cita cancelada      → borra el evento
 *   · cita completada     → le pone ✅ (y ❌ si "no se hizo")
 * TimeTree lo muestra porque lee los calendarios del teléfono.
 *
 * Dónde vive: en la cuenta de Google de Tristán (script.google.com), NO en la
 * app. Corre con su permiso de dueño del proyecto de Firebase, así que no hace
 * falta guardar ninguna contraseña ni clave secreta en ningún lado.
 *
 * Cómo se instala: ver LEEME.md de esta misma carpeta. Una sola vez:
 * pegar este archivo y appsscript.json, y correr la función instalar().
 *
 * ⚠️ El evento lo escribe este programa: si se edita a mano en el calendario,
 * el cambio se pierde la próxima vez que cambie la cita en la app. Los
 * cambios se hacen en la app.
 */

const CONFIG = {
  BASE_DE_DATOS: 'https://carwashexpress-default-rtdb.firebaseio.com',
  NOMBRE_CALENDARIO: 'Car Wash Express',
  ZONA: 'America/Chihuahua',
  CADA_MINUTOS: 5,
  // Cuánto dura cada franja de la agenda (10, 12, 4 y 6). Un lavado ocupa una;
  // un detallado, el día entero (o dos días, si es Completo).
  HORAS_POR_FRANJA: 2,
  // Las citas de hace más de esto ya no se tocan (su evento se queda como historial).
  DIAS_DE_HISTORIAL: 7,
  // Recordatorio en el teléfono antes de cada cita.
  AVISO_MINUTOS_ANTES: 60
};

// Las franjas de la app, en formato de 24 horas.
const FRANJAS = { '10:00 AM': '10:00', '12:00 PM': '12:00', '04:00 PM': '16:00', '06:00 PM': '18:00' };

// Los nombres de los extras (los mismos de la app; si se agrega uno nuevo y no
// está aquí, sale con su clave, que también se entiende).
const NOMBRES_DE_EXTRAS = {
  faros: 'Pulido de Faros',
  cera: 'Cera Cerámica en Pasta',
  ceraliquida: 'Cera Líquida',
  rines: 'Descontaminación de Rines',
  vidrios: 'Descontaminación de Vidrios',
  asientos: 'Rejuvenecimiento de Asientos',
  cajuela: 'Aspirado de Cajuela o 3ª Fila',
  vapor: 'Máquina de Vapor',
  bedliner: 'Aplicación de Bedliner'
};

const PREFIJO = 'cita:';   // así se guarda en las propiedades qué evento es de qué cita

// ─────────────────────────────────────────────────────────────────────
// 1) LO QUE SE CORRE A MANO
// ─────────────────────────────────────────────────────────────────────

/**
 * Se corre UNA vez: crea el calendario, hace la primera vuelta y deja el reloj
 * de 5 minutos. Si la primera vuelta falla (p. ej. la cuenta no es dueña del
 * Firebase), el error se ve al momento y el reloj NO se pone.
 */
function instalar() {
  const calendario = obtenerCalendario_();
  const r = sincronizarAhora_();
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sincronizar')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sincronizar').timeBased().everyMinutes(CONFIG.CADA_MINUTOS).create();
  propiedades_().deleteProperty('fallasSeguidas');
  Logger.log('✅ Listo. Calendario "%s". Se revisa cada %s minutos. Primera vuelta: %s',
    calendario.getName(), String(CONFIG.CADA_MINUTOS), JSON.stringify(r));
  return r;
}

/** Para apagarlo (los eventos que ya están se quedan). */
function desinstalar() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sincronizar')
    .forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log('Apagado: ya no se revisan las citas.');
}

// ─────────────────────────────────────────────────────────────────────
// 2) LA SINCRONIZACIÓN (la corre el reloj cada 5 minutos)
// ─────────────────────────────────────────────────────────────────────

/**
 * La corre el reloj. Un tropiezo suelto de internet no manda correo de error:
 * se anota y se reintenta en 5 minutos. Si falla 3 veces seguidas (15 min),
 * entonces sí truena para que Google le avise a Tristán por correo.
 */
function sincronizar() {
  const propiedades = propiedades_();
  try {
    const r = sincronizarAhora_();
    propiedades.deleteProperty('fallasSeguidas');
    return r;
  } catch (e) {
    const fallas = Number(propiedades.getProperty('fallasSeguidas') || 0) + 1;
    propiedades.setProperty('fallasSeguidas', String(fallas));
    if (fallas >= 3) throw e;
    Logger.log('No se pudo esta vez (%s seguida/s), se reintenta en %s minutos: %s', String(fallas), String(CONFIG.CADA_MINUTOS), e.message);
    return { error: e.message, fallasSeguidas: fallas };
  }
}

function sincronizarAhora_() {
  const candado = LockService.getScriptLock();
  if (!candado.tryLock(20000)) return { ocupado: true };   // ya hay una vuelta corriendo
  try {
    const ordenes = leerOrdenes_();                          // si falla, se detiene AQUÍ sin borrar nada
    const calendario = obtenerCalendario_();
    const propiedades = propiedades_();
    const guardados = cargarGuardados_(propiedades);
    const hoy = Utilities.formatDate(new Date(), CONFIG.ZONA, 'yyyy-MM-dd');
    const desde = sumarDias_(hoy, -CONFIG.DIAS_DE_HISTORIAL);
    const r = { creadas: 0, actualizadas: 0, borradas: 0, sinCambios: 0 };
    const vistas = {};

    // Qué eventos siguen de verdad en el calendario (una sola consulta). Si
    // alguien borró uno a mano, o el calendario entero, se vuelve a poner.
    const enCalendario = {};
    const inicioRango = Utilities.parseDate(desde + ' 00:00', CONFIG.ZONA, 'yyyy-MM-dd HH:mm');
    const finRango = new Date(inicioRango.getTime() + 800 * 24 * 3600 * 1000);
    calendario.getEvents(inicioRango, finRango).forEach(ev => { enCalendario[ev.getId()] = true; });

    // Una cita → su evento (crea, actualiza o borra, según haga falta).
    const procesarCita = (cita, citaId) => {
      const evento = eventoDesdeCita_(cita, citaId);
      if (!evento) return;
      vistas[citaId] = true;
      const guardado = guardados[citaId];

      if (evento.ultimoDia < desde) {
        // Ya es historial: su evento se queda como está y se deja de seguir.
        if (guardado) { propiedades.deleteProperty(PREFIJO + citaId); delete guardados[citaId]; }
        return;
      }
      if (cita.status === 'Cancelada') {
        if (guardado) { borrarEvento_(calendario, guardado.e); propiedades.deleteProperty(PREFIJO + citaId); delete guardados[citaId]; r.borradas++; }
        return;
      }
      const sigueAhi = !!(guardado && enCalendario[guardado.e]);
      if (sigueAhi && guardado.h === evento.huella) { r.sinCambios++; return; }

      let existente = null;
      if (sigueAhi) { try { existente = calendario.getEventById(guardado.e); } catch (e) { existente = null; } }
      if (existente) { aplicar_(existente, evento); r.actualizadas++; }
      else { existente = calendario.createEvent(evento.titulo, evento.inicio, evento.fin, { description: evento.descripcion, location: evento.lugar }); aplicar_(existente, evento, true); r.creadas++; }
      const registro = { e: existente.getId(), h: evento.huella, f: evento.ultimoDia };
      propiedades.setProperty(PREFIJO + citaId, JSON.stringify(registro));
      guardados[citaId] = registro;
    };

    Object.keys(ordenes).forEach(uid => {
      const delCliente = ordenes[uid];
      if (!delCliente || typeof delCliente !== 'object') return;
      Object.keys(delCliente).forEach(citaId => {
        const cita = delCliente[citaId];
        if (!cita || typeof cita !== 'object' || !cita.agendaDia) return;
        try {
          procesarCita(cita, citaId);
        } catch (e) {
          // Una cita con un dato raro no frena a las demás, y su evento no se
          // borra por error: se reintenta en la próxima vuelta.
          vistas[citaId] = true;
          r.errores = (r.errores || 0) + 1;
          Logger.log('No se pudo pasar la cita %s: %s', citaId, e.message);
        }
      });
    });

    // Citas que ya no están en la app: se cancelaron desde "Mis citas" (la app
    // las borra). Se quita su evento si todavía no pasa.
    const desaparecidas = Object.keys(guardados).filter(id => !vistas[id]);
    const futurasDesaparecidas = desaparecidas.filter(id => guardados[id].f >= hoy);
    // Seguro contra un susto: la base de un negocio que ya trabaja nunca está
    // vacía (siempre hay citas viejas). Si contesta vacía mientras el calendario
    // tiene varias citas por venir, es una lectura rara: no se borra nada y se avisa.
    if (futurasDesaparecidas.length >= 3 && Object.keys(ordenes).length === 0) {
      throw new Error('La base contestó sin citas pero había ' + futurasDesaparecidas.length +
        ' en el calendario. Por seguridad no se borró nada; se vuelve a intentar en ' + CONFIG.CADA_MINUTOS + ' minutos.');
    }
    desaparecidas.forEach(id => {
      if (guardados[id].f >= hoy) { borrarEvento_(calendario, guardados[id].e); r.borradas++; }
      propiedades.deleteProperty(PREFIJO + id);
    });
    return r;
  } finally {
    candado.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────────────────
// 3) DE CITA A EVENTO
// ─────────────────────────────────────────────────────────────────────

function eventoDesdeCita_(cita, citaId) {
  const franja = horarioDeLaCita_(cita);
  if (!franja) return null;
  const inicio = Utilities.parseDate(franja.desde.fecha + ' ' + franja.desde.hora, CONFIG.ZONA, 'yyyy-MM-dd HH:mm');
  const finUltima = Utilities.parseDate(franja.hasta.fecha + ' ' + franja.hasta.hora, CONFIG.ZONA, 'yyyy-MM-dd HH:mm');
  const fin = new Date(finUltima.getTime() + CONFIG.HORAS_POR_FRANJA * 3600 * 1000);
  const ultimo = franja.hasta;

  const estado = cita.status || 'Pendiente';
  const marca = estado === 'Completada' ? '✅ ' : estado === 'NoSeHizo' ? '❌ ' : '';
  const esDetallado = /detallado/i.test(cita.paquete || '');
  const titulo = marca + (esDetallado ? '✨ ' : '🚗 ') + (cita.paquete || 'Servicio') + ' · ' + (cita.cliente || 'Cliente')
    + (cita.auto ? ' (' + cita.auto + ')' : '');

  const tel = String(cita.contacto || '').replace(/\D/g, '');
  const tieneUbicacion = typeof cita.lat === 'number' && typeof cita.lon === 'number';
  const mapa = tieneUbicacion ? 'https://www.google.com/maps?q=' + cita.lat + ',' + cita.lon : '';
  // Un extra en $0 es de los que se cotizan (el bedliner): se dice así, no "$0".
  const extras = Object.keys(cita.extras || {}).map(k => (NOMBRES_DE_EXTRAS[k] || k)
    + (Number(cita.extras[k]) > 0 ? ' (' + dinero_(cita.extras[k]) + ')' : ' (por cotizar)'));
  const corriente = { si: 'Sí, a menos de 40 m', nose: '⚠️ No está seguro: confirmarlo antes de ir', taller: 'No aplica (en el taller)' }[cita.tomaCorriente];
  const tipo = { completo: 'Completo (exterior + interior)', exterior: 'Sólo exterior', interior: 'Sólo interior' }[cita.tipoLavado];

  const lineas = [
    'Cliente: ' + (cita.cliente || '—'),
    tel ? 'Teléfono: ' + tel + '  ·  WhatsApp: https://wa.me/52' + tel.slice(-10) : null,
    'Auto: ' + (cita.auto || '—') + (cita.tamanoVehiculo ? ' (' + cita.tamanoVehiculo + ')' : ''),
    'Servicio: ' + (cita.paquete || '—') + (tipo && !esDetallado ? ' · ' + tipo : ''),
    extras.length ? 'Extras: ' + extras.join(', ') : null,
    corriente ? 'Toma de corriente: ' + corriente : null,
    cita.referencia ? 'Referencia: ' + cita.referencia : null,
    cita.coordenadas ? 'Sector: ' + cita.coordenadas + (cita.cargoEnvio ? ' (+' + dinero_(cita.cargoEnvio) + ' de traslado)' : '') : null,
    mapa ? 'Ubicación: ' + mapa + (cita.ubicacionAproximada ? '  (aproximada: confirmar la dirección)' : '') : null,
    'Total: ' + dinero_(cita.total) + ' MXN',
    'Folio: ' + (cita.idLocal || citaId) + '  ·  Estado: ' + ({ Pendiente: 'Pendiente', Completada: 'Completada', NoSeHizo: 'No se hizo' }[estado] || estado),
    '',
    'Agendada en la app. Este evento se actualiza solo: los cambios se hacen en la app, no aquí.'
  ].filter(l => l !== null);

  const color = estado === 'Completada' ? CalendarApp.EventColor.GREEN
    : estado === 'NoSeHizo' ? CalendarApp.EventColor.GRAY
    : esDetallado ? CalendarApp.EventColor.MAUVE : CalendarApp.EventColor.BLUE;
  const lugar = tieneUbicacion ? cita.lat + ',' + cita.lon : (cita.coordenadas || '');
  const descripcion = lineas.join('\n');
  return {
    titulo: titulo, inicio: inicio, fin: fin, lugar: lugar, descripcion: descripcion, color: color,
    ultimoDia: ultimo.fecha,
    huella: huella_([titulo, inicio.getTime(), fin.getTime(), lugar, descripcion, color].join('|'))
  };
}

function aplicar_(evento, datos, recienCreado) {
  if (!recienCreado) {
    evento.setTitle(datos.titulo);
    evento.setTime(datos.inicio, datos.fin);
    evento.setDescription(datos.descripcion);
    evento.setLocation(datos.lugar);
  }
  evento.setColor(datos.color);
  if (recienCreado && CONFIG.AVISO_MINUTOS_ANTES) {
    evento.removeAllReminders();
    evento.addPopupReminder(CONFIG.AVISO_MINUTOS_ANTES);
  }
}

// ─────────────────────────────────────────────────────────────────────
// 4) AYUDANTES
// ─────────────────────────────────────────────────────────────────────

/** Lee TODAS las citas con el permiso de dueño del proyecto (sin contraseñas). */
function leerOrdenes_() {
  const url = CONFIG.BASE_DE_DATOS + '/ordenes.json?access_token=' + encodeURIComponent(ScriptApp.getOAuthToken());
  const respuesta = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const codigo = respuesta.getResponseCode();
  if (codigo !== 200) {
    throw new Error('Firebase contestó ' + codigo + ' al leer las citas: ' + respuesta.getContentText().slice(0, 200));
  }
  const datos = JSON.parse(respuesta.getContentText() || 'null');
  return datos && typeof datos === 'object' ? datos : {};
}

function propiedades_() {
  return PropertiesService.getScriptProperties();
}

function obtenerCalendario_() {
  const propiedades = propiedades_();
  const id = propiedades.getProperty('calendarioId');
  let calendario = id ? CalendarApp.getCalendarById(id) : null;
  if (!calendario) {
    const conEseNombre = CalendarApp.getCalendarsByName(CONFIG.NOMBRE_CALENDARIO);
    calendario = conEseNombre.length ? conEseNombre[0]
      : CalendarApp.createCalendar(CONFIG.NOMBRE_CALENDARIO, {
          timeZone: CONFIG.ZONA,
          color: CalendarApp.Color.PURPLE,
          description: 'Citas de la app Car Wash Express. Se llena solo; los cambios se hacen en la app.'
        });
    propiedades.setProperty('calendarioId', calendario.getId());
  }
  return calendario;
}

function cargarGuardados_(propiedades) {
  const todas = propiedades.getProperties();
  const guardados = {};
  Object.keys(todas).forEach(k => {
    if (k.indexOf(PREFIJO) !== 0) return;
    try { guardados[k.slice(PREFIJO.length)] = JSON.parse(todas[k]); } catch (e) { /* se ignora una entrada rota */ }
  });
  return guardados;
}

function borrarEvento_(calendario, eventoId) {
  try {
    const evento = calendario.getEventById(eventoId);
    if (evento) evento.deleteEvent();
  } catch (e) { /* ya no existía: nada que borrar */ }
}

/**
 * Primera y última franja de la cita, con la MISMA regla de la app
 * (huecosQueOcupa): manda el día y la hora de la cita; un Detallado Express
 * ocupa el día entero y un Detallado Completo, dos días. Los huecosOcupados
 * sólo se usan si la hora no se entiende (en citas reagendadas con versiones
 * viejas de la app pueden venir desfasados).
 */
function horarioDeLaCita_(cita) {
  if (!fechaValida_(cita.agendaDia)) return null;
  const dias = /Detallado Completo/i.test(cita.paquete || '') ? 2 : /Detallado Express/i.test(cita.paquete || '') ? 1 : 0;
  if (dias > 0) {
    return { desde: { fecha: cita.agendaDia, hora: '10:00' }, hasta: { fecha: sumarDias_(cita.agendaDia, dias - 1), hora: '18:00' } };
  }
  const hora = hora24_(cita.agendaHora);
  if (hora) return { desde: { fecha: cita.agendaDia, hora: hora }, hasta: { fecha: cita.agendaDia, hora: hora } };
  let huecos = cita.huecosOcupados;
  if (huecos && !Array.isArray(huecos)) huecos = Object.keys(huecos).map(k => huecos[k]);   // Firebase a veces da objeto
  huecos = (huecos || [])
    .filter(h => h && fechaValida_(h.fecha) && hora24_(h.hora))
    .map(h => ({ fecha: h.fecha, hora: hora24_(h.hora) }))
    .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
  return huecos.length ? { desde: huecos[0], hasta: huecos[huecos.length - 1] } : null;
}

/** '04:00 PM' → '16:00' (también entiende '4:00 pm' y '16:00'). */
function hora24_(hora) {
  if (FRANJAS[hora]) return FRANJAS[hora];
  const m = String(hora || '').trim().match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const ampm = (m[3] || '').toUpperCase();
  if (Number(m[2]) > 59 || (ampm ? h < 1 || h > 12 : h > 23)) return null;
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return (h < 10 ? '0' : '') + h + ':' + m[2];
}

/** 'AAAA-MM-DD' de un día que existe (no '2026-13-45'). */
function fechaValida_(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return false;
  const d = new Date(fecha + 'T12:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === fecha;
}

function sumarDias_(fechaISO, n) {
  const d = new Date(fechaISO + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dinero_(n) {
  const v = Math.round(Number(n) || 0);
  return '$' + String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Huella corta de un texto: si no cambia, el evento no se vuelve a escribir. */
function huella_(texto) {
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + '.' + texto.length;
}
