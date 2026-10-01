// PRUEBA DEL SINCRONIZADOR CON GOOGLE CALENDAR (integraciones/google-calendar).
// Corre el Codigo.gs de verdad, pero con un Google "de mentiras" (Calendar,
// Firebase, propiedades, reloj de 5 minutos) que se porta como el real, y lo
// pasa por todos los casos: cita nueva, sin cambios, reagendada, completada,
// cancelada, detallados, datos raros, evento o calendario borrado a mano,
// tropiezos de internet, error de Firebase, base vacía y empezar de cero.
// Uso: npm run prueba-calendario
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const CODIGO = readFileSync(new URL('../integraciones/google-calendar/Codigo.gs', import.meta.url), 'utf8');
const MANIFIESTO = JSON.parse(readFileSync(new URL('../integraciones/google-calendar/appsscript.json', import.meta.url), 'utf8'));

let fallas = 0, pasadas = 0;
const ver = (ok, texto, extra) => {
    if (ok) pasadas++; else fallas++;
    console.log(`${ok ? '✅' : '❌'} ${texto}${!ok && extra !== undefined ? '  → ' + String(JSON.stringify(extra)).slice(0, 300) : ''}`);
};

// Fechas relativas a hoy en Chihuahua (UTC-6, sin horario de verano desde 2022)
const hoyChihuahua = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
const dia = n => { const d = new Date(hoyChihuahua() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Opciones que acepta cada método según la documentación de Apps Script:
// si el programa manda otra (como "summary"), Google la ignoraría sin avisar.
const OPCIONES = {
    createCalendar: ['location', 'description', 'timeZone', 'color', 'hidden', 'selected'],
    createEvent: ['description', 'location', 'guests', 'sendInvites']
};
const revisarOpciones = (metodo, opciones) => {
    const raras = Object.keys(opciones || {}).filter(k => !OPCIONES[metodo].includes(k));
    if (raras.length) throw new Error(`${metodo} no acepta: ${raras.join(', ')}`);
};

function crearGoogle() {
    const g = { respuesta: { codigo: 200, cuerpo: 'null' }, urls: [], consultas: 0, disparadores: [], bitacora: [], props: new Map(), calendarios: [], siguienteId: 1 };
    const nuevoEvento = (cal, titulo, inicio, fin, opciones = {}) => {
        const ev = {
            id: 'ev' + (g.siguienteId++), titulo, inicio, fin, descripcion: opciones.description || '', lugar: opciones.location || '',
            color: null, avisos: [], borrado: false,
            getId() { return this.id; }, setTitle(t) { this.titulo = t; }, setTime(a, b) { if (isNaN(a) || isNaN(b) || b <= a) throw new Error('setTime: fechas inválidas'); this.inicio = a; this.fin = b; },
            setDescription(d) { this.descripcion = d; }, getDescription() { return this.descripcion; }, setLocation(l) { this.lugar = l; }, setColor(c) { this.color = c; },
            removeAllReminders() { this.avisos = []; }, addPopupReminder(m) { this.avisos.push(m); },
            deleteEvent() { this.borrado = true; cal.eventos = cal.eventos.filter(e => e !== this); }
        };
        cal.eventos.push(ev);
        return ev;
    };
    const nuevoCalendario = (nombre, opciones) => {
        const cal = {
            id: 'cal' + (g.siguienteId++), nombre, opciones, eventos: [],
            getId() { return this.id; }, getName() { return this.nombre; },
            createEvent(t, a, b, o) {
                revisarOpciones('createEvent', o);
                if (!(a instanceof Date) || !(b instanceof Date) || isNaN(a) || isNaN(b) || b <= a) throw new Error('createEvent: fechas inválidas');
                return nuevoEvento(cal, t, a, b, o);
            },
            getEventById(id) { return cal.eventos.find(e => e.id === id) || null; },
            getEvents(a, b) { g.consultas++; return cal.eventos.filter(e => e.inicio < b && e.fin > a); }
        };
        g.calendarios.push(cal);
        return cal;
    };
    g.contexto = vm.createContext({
        console, JSON, Math, Date, Object, String, Number, Array, RegExp, Error, encodeURIComponent, parseInt,
        Utilities: {
            parseDate: (texto, zona, formato) => {
                if (zona !== 'America/Chihuahua' || formato !== 'yyyy-MM-dd HH:mm') throw new Error('parseDate inesperado ' + zona + ' ' + formato);
                const [d, t] = texto.split(' ');
                return new Date(`${d}T${t}:00-06:00`);
            },
            formatDate: (fecha, zona, formato) => {
                if (formato !== 'yyyy-MM-dd') throw new Error('formatDate inesperado');
                return new Date(fecha.getTime() - 6 * 3600e3).toISOString().slice(0, 10);
            }
        },
        UrlFetchApp: { fetch: (url) => { g.urls.push(url); return { getResponseCode: () => g.respuesta.codigo, getContentText: () => g.respuesta.cuerpo }; } },
        ScriptApp: {
            getOAuthToken: () => 'token-de-prueba',
            getProjectTriggers: () => g.disparadores.slice(),
            deleteTrigger: (t) => { g.disparadores = g.disparadores.filter(x => x !== t); },
            newTrigger: (fn) => ({ timeBased: () => ({ everyMinutes: (n) => ({ create: () => { const t = { fn, n, getHandlerFunction: () => fn }; g.disparadores.push(t); return t; } }) }) })
        },
        PropertiesService: {
            getScriptProperties: () => ({
                getProperty: k => (g.props.has(k) ? g.props.get(k) : null),
                setProperty: (k, v) => { g.props.set(k, String(v)); },
                deleteProperty: k => { g.props.delete(k); },
                getProperties: () => Object.fromEntries(g.props)
            })
        },
        LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
        Logger: { log: (...a) => { g.bitacora.push(a.join(' ')); } },
        CalendarApp: {
            Color: { PURPLE: '#8E24AA' },
            EventColor: { BLUE: '9', GREEN: '10', MAUVE: '3', GRAY: '8' },
            getCalendarById: id => g.calendarios.find(c => c.id === id) || null,
            getCalendarsByName: n => g.calendarios.filter(c => c.nombre === n),
            createCalendar: (n, o) => { revisarOpciones('createCalendar', o); return nuevoCalendario(n, o); }
        }
    });
    vm.runInContext(CODIGO, g.contexto, { filename: 'Codigo.gs' });
    g.ordenes = (o) => { g.respuesta = { codigo: 200, cuerpo: JSON.stringify(o) }; };
    g.correr = (fn = 'sincronizar') => vm.runInContext(fn + '()', g.contexto);
    // Igual que correr, pero si truena devuelve { lanzo: mensaje } en vez de tumbar la prueba.
    g.intentar = (fn) => { try { return g.correr(fn); } catch (e) { return { lanzo: e.message }; } };
    g.cal = () => g.calendarios[0];
    return g;
}

const lavado = (extra = {}) => ({
    idLocal: 'CWE-1001', cliente: 'Juan Pérez', contacto: '6251234567', auto: 'Jetta 2020', tamanoVehiculo: 'chico',
    tipoLavado: 'completo', paquete: 'Lavado Básico', costoBase: 250, extras: { faros: 200 }, referencia: 'Portón negro',
    tomaCorriente: 'si', coordenadas: 'Dentro de la ciudad', lat: 28.4053, lon: -106.8664, ubicacionAproximada: false,
    cargoEnvio: 0, agendaDia: dia(3), agendaHora: '10:00 AM', total: 450, timestamp: 1, status: 'Pendiente',
    huecosOcupados: [{ fecha: dia(3), hora: '10:00 AM' }], ...extra
});

// ── 0) El manifiesto pide justo lo necesario ─────────────────────────
console.log('0) Manifiesto (appsscript.json)');
ver(MANIFIESTO.timeZone === 'America/Chihuahua' && MANIFIESTO.runtimeVersion === 'V8', 'zona de Chihuahua y motor V8');
for (const s of ['calendar', 'firebase.database', 'userinfo.email', 'script.external_request', 'script.scriptapp']) {
    ver(MANIFIESTO.oauthScopes.some(x => x.endsWith('/auth/' + s)), `pide el permiso ${s}`);
}

// ── 1) Instalar: crea el calendario, el reloj de 5 min y la primera cita ──
console.log('\n1) Instalar');
let g = crearGoogle();
g.ordenes({ uidJuan: { citaA: lavado() } });
let r = g.correr('instalar');
ver(g.calendarios.length === 1 && g.cal().nombre === 'Car Wash Express' && g.cal().opciones.timeZone === 'America/Chihuahua' && /se hacen en la app/.test(g.cal().opciones.description),
    'crea el calendario "Car Wash Express" en hora de Chihuahua, con su descripción', g.cal() && g.cal().opciones);
ver(g.disparadores.length === 1 && g.disparadores[0].fn === 'sincronizar' && g.disparadores[0].n === 5, 'deja el reloj: sincronizar cada 5 minutos');
ver(r.creadas === 1 && g.cal().eventos.length === 1, 'crea el evento de la cita', r);
ver(/\/ordenes\.json\?access_token=token-de-prueba$/.test(g.urls[0]) && g.urls[0].startsWith('https://carwashexpress-default-rtdb.firebaseio.com/'), 'lee las citas de Firebase con el permiso de dueño', g.urls[0]);
let ev = g.cal().eventos[0];
ver(ev.inicio.toISOString() === new Date(`${dia(3)}T10:00:00-06:00`).toISOString(), 'empieza a las 10:00 de Chihuahua', ev.inicio);
ver(ev.fin - ev.inicio === 2 * 3600e3, 'dura 2 horas (una franja)');
ver(ev.titulo === '🚗 Lavado Básico · Juan Pérez (Jetta 2020)', 'título con servicio, cliente y auto', ev.titulo);
ver(ev.lugar === '28.4053,-106.8664', 'lugar con las coordenadas (se abre en Maps)', ev.lugar);
for (const [texto, que] of [['https://wa.me/526251234567', 'enlace de WhatsApp del cliente'], ['Pulido de Faros ($200)', 'extras con nombre y precio'],
    ['Total: $450 MXN', 'total'], ['Folio: CWE-1001', 'folio'], ['Referencia: Portón negro', 'referencia del domicilio'],
    ['https://www.google.com/maps?q=28.4053,-106.8664', 'enlace al mapa'], ['Completo (exterior + interior)', 'tipo de lavado']]) {
    ver(ev.descripcion.includes(texto), 'la descripción trae ' + que, ev.descripcion);
}
g.ordenes({ uidJuan: { citaA: lavado(), citaBed: lavado({ idLocal: 'CWE-1002', cliente: 'Bed Liner', agendaHora: '12:00 PM', extras: { bedliner: 0, cajuela: 80 } }) } });
g.correr();
const conBedliner = g.cal().eventos.find(e => e.titulo.includes('Bed Liner'));
ver(conBedliner && conBedliner.descripcion.includes('Extras: Aplicación de Bedliner (por cotizar), Aspirado de Cajuela o 3ª Fila ($80)'),
    'un extra que se cotiza dice "por cotizar", no "$0"', conBedliner && conBedliner.descripcion);
conBedliner.deleteEvent();
g.props.delete('cita:citaBed');
g.ordenes({ uidJuan: { citaA: lavado() } });
ver(ev.color === '9' && ev.avisos.length === 1 && ev.avisos[0] === 60, 'color azul (lavado) y aviso 1 hora antes', { color: ev.color, avisos: ev.avisos });

// ── 2) Sin cambios: no toca nada ─────────────────────────────────────
console.log('\n2) Otra vuelta sin cambios');
r = g.correr();
ver(r.sinCambios === 1 && r.creadas === 0 && r.actualizadas === 0 && g.cal().eventos.length === 1, 'no vuelve a escribir ni duplica', r);
g.correr('instalar');
ver(g.disparadores.length === 1, 'reinstalar no duplica el reloj');

// ── 3) Reagendada: mueve el MISMO evento ─────────────────────────────
console.log('\n3) La cita se reagenda');
const idOriginal = g.cal().eventos[0].id;
g.ordenes({ uidJuan: { citaA: lavado({ agendaDia: dia(4), agendaHora: '04:00 PM', huecosOcupados: [{ fecha: dia(4), hora: '04:00 PM' }] }) } });
r = g.correr();
ev = g.cal().eventos[0];
ver(r.actualizadas === 1 && g.cal().eventos.length === 1 && ev.id === idOriginal, 'actualiza el mismo evento (no crea otro)', r);
ver(ev.inicio.toISOString() === new Date(`${dia(4)}T16:00:00-06:00`).toISOString(), 'queda a las 4:00 PM del día nuevo', ev.inicio);

// ── 4) Completada / No se hizo ───────────────────────────────────────
console.log('\n4) Cambia el estado');
g.ordenes({ uidJuan: { citaA: lavado({ agendaDia: dia(4), agendaHora: '04:00 PM', huecosOcupados: [{ fecha: dia(4), hora: '04:00 PM' }], status: 'Completada' }) } });
g.correr();
ev = g.cal().eventos[0];
ver(ev.titulo.startsWith('✅ ') && ev.color === '10' && ev.descripcion.includes('Estado: Completada'), 'completada: ✅ y verde', ev.titulo);
g.ordenes({ uidJuan: { citaA: lavado({ agendaDia: dia(4), agendaHora: '04:00 PM', huecosOcupados: [{ fecha: dia(4), hora: '04:00 PM' }], status: 'NoSeHizo' }) } });
g.correr();
ev = g.cal().eventos[0];
ver(ev.titulo.startsWith('❌ ') && ev.color === '8' && ev.descripcion.includes('Estado: No se hizo'), '"no se hizo": ❌ y gris', ev.titulo);

// ── 5) Detallado Completo de dos días ────────────────────────────────
console.log('\n5) Detallado Completo (dos días enteros)');
const franjas = f => ['10:00 AM', '12:00 PM', '04:00 PM', '06:00 PM'].map(h => ({ fecha: f, hora: h }));
g.ordenes({
    uidJuan: { citaA: lavado({ agendaDia: dia(4), agendaHora: '04:00 PM', huecosOcupados: [{ fecha: dia(4), hora: '04:00 PM' }], status: 'NoSeHizo' }) },
    uidAna: { citaB: lavado({ idLocal: 'CWE-2002', cliente: 'Ana López', paquete: 'Detallado Completo', tomaCorriente: 'taller', agendaDia: dia(6), agendaHora: '', huecosOcupados: [...franjas(dia(7)), ...franjas(dia(6))], total: 1200 }) }
});
r = g.correr();
ev = g.cal().eventos.find(e => e.titulo.includes('Ana López'));
ver(r.creadas === 1 && !!ev, 'crea el evento del detallado', r);
ver(ev && ev.inicio.toISOString() === new Date(`${dia(6)}T10:00:00-06:00`).toISOString() && ev.fin.toISOString() === new Date(`${dia(7)}T20:00:00-06:00`).toISOString(),
    'va del primer día 10:00 al segundo día 20:00 (aunque los huecos vengan desordenados)', ev && [ev.inicio, ev.fin]);
ver(ev && ev.titulo.startsWith('✨ ') && ev.color === '3' && ev.descripcion.includes('No aplica (en el taller)'), 'detallado: ✨, color malva y "en el taller"', ev && ev.titulo);

// ── 6) Cancelada desde "Mis citas" (la app la borra) ─────────────────
console.log('\n6) El cliente cancela');
g.ordenes({ uidAna: { citaB: lavado({ idLocal: 'CWE-2002', cliente: 'Ana López', paquete: 'Detallado Completo', agendaDia: dia(6), huecosOcupados: [...franjas(dia(6)), ...franjas(dia(7))], total: 1200 }) } });
r = g.correr();
ver(r.borradas === 1 && !g.cal().eventos.some(e => e.titulo.includes('Juan Pérez')), 'borra el evento de la cita que ya no está', r);
ver(!g.props.has('cita:citaA'), 'y deja de seguirla');
g.ordenes({ uidAna: { citaB: lavado({ idLocal: 'CWE-2002', cliente: 'Ana López', paquete: 'Detallado Completo', agendaDia: dia(6), huecosOcupados: [...franjas(dia(6)), ...franjas(dia(7))], total: 1200, status: 'Cancelada' }) } });
r = g.correr();
ver(r.borradas === 1 && g.cal().eventos.length === 0, 'una cita con estado "Cancelada" también se borra', r);

// ── 7) Citas viejas y datos raros ────────────────────────────────
console.log('\n7) Citas viejas y datos raros');
g.ordenes({ u1: {
    vieja: lavado({ idLocal: 'V', cliente: 'Muy Vieja', agendaDia: dia(-30), huecosOcupados: [{ fecha: dia(-30), hora: '10:00 AM' }] }),
    sinHuecos: lavado({ idLocal: 'S', cliente: 'Sin Huecos', agendaDia: dia(2), agendaHora: '12:00 PM', huecosOcupados: undefined }),
    // Reagendada con una versión vieja de la app: huecosOcupados se quedó en otro día.
    desfasada: lavado({ idLocal: 'D', cliente: 'Desfasada', agendaDia: dia(5), agendaHora: '06:00 PM', huecosOcupados: [{ fecha: dia(1), hora: '10:00 AM' }] }),
    huecosComoObjeto: lavado({ idLocal: 'O', cliente: 'Objeto', agendaDia: dia(2), agendaHora: '', huecosOcupados: { 0: { fecha: dia(2), hora: '06:00 PM' } } }),
    horaRara: lavado({ idLocal: 'R', cliente: 'Hora Rara', agendaDia: dia(2), agendaHora: 'pronto', huecosOcupados: undefined }),
    fechaRara: lavado({ idLocal: 'F', cliente: 'Fecha Rara', agendaDia: 'mañana', huecosOcupados: undefined }),
    horaImposible: lavado({ idLocal: 'H', cliente: 'Hora Imposible', agendaDia: dia(2), agendaHora: '25:99', huecosOcupados: undefined }),
    minutosImposibles: lavado({ idLocal: 'M', cliente: 'Minutos Imposibles', agendaDia: dia(2), agendaHora: '10:75 AM', huecosOcupados: undefined }),
    fechaImposible: lavado({ idLocal: 'I', cliente: 'Fecha Imposible', agendaDia: '2026-13-45', huecosOcupados: undefined }),
    express: lavado({ idLocal: 'E', cliente: 'Express', paquete: 'Detallado Express (Mediano)', agendaDia: dia(8), agendaHora: undefined, huecosOcupados: undefined }),
    basura: 'no es una cita'
}, u2: 'tampoco' });
r = g.correr();
const titulos = g.cal().eventos.map(e => e.titulo).join(' | ');
const empieza = (quien, fechaHora) => g.cal().eventos.some(e => e.titulo.includes(quien) && e.inicio.toISOString() === new Date(fechaHora + ':00-06:00').toISOString());
ver(!titulos.includes('Muy Vieja'), 'no crea eventos de citas de hace un mes', titulos);
ver(empieza('Sin Huecos', `${dia(2)}T12:00`), 'una cita sin "huecosOcupados" usa su día y hora', titulos);
ver(empieza('Desfasada', `${dia(5)}T18:00`), 'manda el día y la hora de la cita, como en la app (aunque los huecos vengan desfasados)', titulos);
ver(empieza('Objeto', `${dia(2)}T18:00`), 'sin hora, usa los huecos aunque Firebase los mande como objeto', titulos);
const express = g.cal().eventos.find(e => e.titulo.includes('Express'));
ver(empieza('Express', `${dia(8)}T10:00`) && express.fin.toISOString() === new Date(`${dia(8)}T20:00:00-06:00`).toISOString(),
    'Detallado Express: el día entero, de 10:00 a 20:00', express && [express.inicio, express.fin]);
ver(!/Rara|Imposible/.test(titulos) && r.creadas === 4 && !r.errores, 'una hora o fecha que no se entiende (o que no existe, como 25:99, 10:75 o el mes 13) se ignora sin tronar', r);

// ── 8) Seguros: Firebase falla o contesta vacía ──────────────────
console.log('\n8) Seguros');
const antes = g.cal().eventos.length;
g.respuesta = { codigo: 401, cuerpo: '{"error":"Permission denied"}' };
r = g.intentar();
ver(r && /Firebase contestó 401/.test(r.error || '') && g.cal().eventos.length === antes, 'si Firebase falla, no borra nada', r);
ver(r.fallasSeguidas === 1 && g.bitacora.some(l => /se reintenta/.test(l)), 'un tropiezo suelto sólo se anota (no manda correo de error)', r);
g.intentar();
let error = g.intentar().lanzo;
ver(/Firebase contestó 401/.test(error || '') && g.cal().eventos.length === antes, 'a la 3ª falla seguida (15 min) sí truena, para que Google avise por correo', error);
g.ordenes({ u1: { sinHuecos: lavado({ idLocal: 'S', cliente: 'Sin Huecos', agendaDia: dia(2), agendaHora: '12:00 PM', huecosOcupados: undefined }) } });
r = g.correr();
ver(!r.error && !g.props.has('fallasSeguidas'), 'cuando vuelve a funcionar, el contador de fallas se limpia', r);
g.respuesta = { codigo: 500, cuerpo: 'Internal error' };
error = g.intentar('instalar').lanzo;
ver(/Firebase contestó 500/.test(error || ''), 'al instalar, un error se ve al momento (no se esconde)', error);
const g2 = crearGoogle();
g2.respuesta = { codigo: 403, cuerpo: '{"error":"Permission denied"}' };
error = g2.intentar('instalar').lanzo;
ver(/403/.test(error || '') && g2.disparadores.length === 0, 'si la instalación falla (cuenta equivocada), NO deja el reloj puesto mandando correos', { error, relojes: g2.disparadores.length });
g2.ordenes({ u: { a: lavado() } });
g2.correr('instalar');
ver(g2.disparadores.length === 1 && g2.cal().eventos.length === 1, 'y al corregirlo e instalar de nuevo, queda funcionando', g2.disparadores.length);

g = crearGoogle();
g.ordenes({ u: { a: lavado({ idLocal: 'A1' }), b: lavado({ idLocal: 'B1', agendaHora: '12:00 PM' }), c: lavado({ idLocal: 'C1', agendaHora: '04:00 PM' }) } });
g.correr('instalar');
g.respuesta = { codigo: 200, cuerpo: 'null' };
r = g.intentar();
ver(/Por seguridad no se borró nada/.test(r.error || '') && g.cal().eventos.length === 3, 'si la base contesta VACÍA con 3 citas en el calendario, no borra nada', r);
g.ordenes({ u: { b: lavado({ idLocal: 'B1', agendaHora: '12:00 PM' }) } });
r = g.correr();
ver(r.borradas === 2 && g.cal().eventos.length === 1, 'pero sí borra las que se cancelaron de verdad (la base trae otras citas)', r);

// ── 9) Alguien borra el calendario a mano ────────────────────────────
console.log('\n9) Calendario borrado a mano');
g.calendarios.length = 0;
r = g.correr();
ver(g.calendarios.length === 1 && g.cal().nombre === 'Car Wash Express', 'lo vuelve a crear solo', g.calendarios.map(c => c.nombre));
ver(g.cal().eventos.length === 1 && r.creadas === 1, 'y vuelve a poner la cita que sigue en pie', r);

// ── 10) Un evento borrado a mano ─────────────────────────────────
console.log('\n10) Alguien borra un evento a mano');
if (g.cal().eventos[0]) g.cal().eventos[0].deleteEvent();
r = g.intentar();
ver(r.creadas === 1 && g.cal().eventos.length === 1, 'lo vuelve a poner en la siguiente vuelta', r);
const consultasAntes = g.consultas;
g.correr();
ver(g.consultas === consultasAntes + 1, 'revisa el calendario con UNA sola consulta por vuelta (no una por cita)', g.consultas - consultasAntes);

// ── 11) Una cita que hace fallar a Google no frena a las demás ───────
console.log('\n11) Una cita con problema no frena a las demás');
g = crearGoogle();
g.ordenes({ u: { mala: lavado({ idLocal: 'M', cliente: 'Problema' }), buena: lavado({ idLocal: 'B', cliente: 'Bien', agendaHora: '12:00 PM' }) } });
g.correr('instalar');
const crear = g.cal().createEvent;
g.cal().createEvent = function (t, ...resto) { if (t.includes('Problema')) throw new Error('Límite de Google'); return crear.call(this, t, ...resto); };
g.cal().eventos.find(e => e.titulo.includes('Problema')).deleteEvent();
g.ordenes({ u: { mala: lavado({ idLocal: 'M', cliente: 'Problema', agendaHora: '04:00 PM' }), buena: lavado({ idLocal: 'B', cliente: 'Bien', agendaHora: '12:00 PM' }), nueva: lavado({ idLocal: 'N', cliente: 'Nueva', agendaHora: '06:00 PM' }) } });
r = g.correr();
ver(r.errores === 1 && r.creadas === 1 && g.cal().eventos.some(e => e.titulo.includes('Nueva')), 'las demás citas sí se pasan', r);
ver(g.props.has('cita:mala'), 'y no da por perdida la que falló: la reintenta en la próxima vuelta', [...g.props.keys()]);
g.cal().createEvent = crear;
r = g.intentar();
ver(r.creadas === 1 && g.cal().eventos.some(e => e.titulo.includes('Problema') && e.inicio.toISOString() === new Date(`${dia(3)}T16:00:00-06:00`).toISOString()), 'en la siguiente vuelta, ya pasa (y con la hora nueva)', r);

const eventosAntes = g.cal().eventos.length;
const original = g.contexto.eventoDesdeCita_;
g.contexto.eventoDesdeCita_ = (cita, id) => { if (id === 'buena') throw new Error('dato inesperado'); return original(cita, id); };
r = g.intentar();
g.contexto.eventoDesdeCita_ = original;
ver(r.errores === 1 && g.cal().eventos.length === eventosAntes && g.props.has('cita:buena'),
    'si una cita truena antes de leerse, su evento NO se borra (no se confunde con cancelada)', r);

// ── 12) Borrar a mano una cita que ya pasó ───────────────────────
console.log('\n12) Borrar a mano una cita que ya pasó');
g = crearGoogle();
g.ordenes({ u: { pasada: lavado({ idLocal: 'P', cliente: 'Ya Pasó', agendaDia: dia(-2) }), futura: lavado({ idLocal: 'F', cliente: 'Viene', agendaDia: dia(2) }) } });
g.correr('instalar');
ver(g.cal().eventos.length === 2, 'al instalar pone también las de la última semana (historial)', g.cal().eventos.map(e => e.titulo));
g.cal().eventos.slice().forEach(e => e.deleteEvent());
r = g.correr();
ver(r.creadas === 1 && g.cal().eventos.length === 1 && g.cal().eventos[0].titulo.includes('Viene'), 'la que ya pasó NO regresa; la que viene sí (por si fue un borrón sin querer)', r);
g.ordenes({ u: { pasada: lavado({ idLocal: 'P', cliente: 'Ya Pasó', agendaDia: dia(-2), status: 'Completada' }), futura: lavado({ idLocal: 'F', cliente: 'Viene', agendaDia: dia(2) }) } });
r = g.correr();
ver(r.creadas === 0 && g.cal().eventos.length === 1, 'aunque después cambie su estado, sigue sin regresar', r);

// ── 13) Empezar de cero (citas de prueba antes de lanzar la app) ──────
console.log('\n13) Empezar de cero');
g = crearGoogle();
g.ordenes({ u: {
    a: lavado({ idLocal: 'A', cliente: 'Prueba A', agendaDia: dia(-3) }),
    b: lavado({ idLocal: 'B', cliente: 'Prueba B' }), c: lavado({ idLocal: 'C', cliente: 'Prueba C', agendaHora: '12:00 PM' }),
    d: lavado({ idLocal: 'D', cliente: 'Prueba D', agendaHora: '04:00 PM' })
} });
g.correr('instalar');
const vieja = g.cal().createEvent('Prueba vieja', new Date(`${dia(-200)}T10:00:00-06:00`), new Date(`${dia(-200)}T12:00:00-06:00`), { description: 'Cliente: X\n\nAgendada en la app. Este evento se actualiza solo: los cambios se hacen en la app, no aquí.' });
const mia = g.cal().createEvent('Cumpleaños de mi mamá', new Date(`${dia(5)}T15:00:00-06:00`), new Date(`${dia(5)}T17:00:00-06:00`));
ver(g.cal().eventos.length === 6 && vieja && mia, 'antes: 4 citas de prueba + 1 de hace meses + 1 evento personal', g.cal().eventos.length);
// Se borran las citas de prueba en Firebase: el seguro de "base vacía" detiene la vuelta normal…
g.respuesta = { codigo: 200, cuerpo: 'null' };
r = g.intentar();
ver(/empezarDeCero/.test(r.error || '') && g.cal().eventos.length === 6, 'con la base vacía, la vuelta normal no borra nada y dice que corras empezarDeCero', r);
// …y empezarDeCero deja el calendario limpio
r = g.intentar('empezarDeCero');
ver(r && r.quitados === 5 && g.cal().eventos.length === 1 && g.cal().eventos[0] === mia, 'empezarDeCero quita los 5 eventos del programa (también los viejos) y deja el personal', r);
ver(![...g.props.keys()].some(k => k.startsWith('cita:')) && !g.props.has('fallasSeguidas'), 'y olvida las citas de prueba (y el contador de fallas)', [...g.props.keys()]);
r = g.intentar();
ver(!r.error && !r.lanzo && g.cal().eventos.length === 1, 'después, las vueltas normales siguen sin error', r);
g.ordenes({ u: { real: lavado({ idLocal: 'R', cliente: 'Primer Cliente' }) } });
r = g.correr();
ver(r.creadas === 1 && g.cal().eventos.some(e => e.titulo.includes('Primer Cliente')), 'y la primera cita de verdad aparece normal', r);
g.ordenes({ u: { real: lavado({ idLocal: 'R', cliente: 'Primer Cliente' }), otra: lavado({ idLocal: 'O', cliente: 'Segundo', agendaHora: '06:00 PM' }) } });
r = g.intentar('empezarDeCero');
ver(r.quitados === 1 && r.vuelta.creadas === 2 && g.cal().eventos.length === 3, 'con citas en la app, empezarDeCero las vuelve a poner todas', r);

console.log(`\nRESULTADO: ${pasadas} bien, ${fallas} mal`);
process.exitCode = fallas ? 1 : 0;
