/* global firebase, calcularSectorCuauhtemoc, ubicacionLat:writable, ubicacionLon:writable, ubicacionEsAproximada:writable, seleccionarServicioBase,
   irAAgendaDesdeExtras, elegirDiaCalendario, seleccionarHora, avanzarAFormularioDesdeAgenda, seleccionarTamanoManual,
   servicioNecesitaCorrienteDelCliente, seleccionarTomaCorriente, cancelarCitaAtomica, fechaLocalISO, sumarDias,
   esDomingoDeDescanso, mostrarPantalla, baseLista, usuarioActual, claveHora */
// PRUEBA REAL DE PUNTA A PUNTA contra el Firebase de producción (se corre a mano
// desde Actions, ver prueba-real.yml). Hace lo mismo que un cliente:
//   crea una cuenta "Prueba automática" → agenda un lavado en una fecha lejana →
//   comprueba la pantalla del ticket y que la cita y su horario quedaron en la
//   base → cancela la cita → borra el perfil y la cuenta.
// Pase lo que pase, al final limpia: no deja cuenta, cita ni horario apartado.
// Además anota cualquier bloqueo de la política de seguridad (CSP) y cualquier
// error de JavaScript que salga en el camino.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { servir } from './servidor.mjs';

const PUERTO = 4173;
const CAPTURAS = 'prueba-real';
mkdirSync(CAPTURAS, { recursive: true });
// 555 + 7 dígitos: claramente de prueba, nunca de un cliente real.
const TELEFONO = '555' + String(Date.now()).slice(-7);
const CLAVE = 'Prueba-' + Math.random().toString(36).slice(2, 10);
// NOTA_WEBSOCKET=1: como un teléfono al que Firebase le dejó la nota "el
// WebSocket falló" (entra por long polling). Fue lo que tumbó la base en la
// tablet de Tristán en septiembre de 2026.
const NOTA_WEBSOCKET = !!process.env.NOTA_WEBSOCKET;

const servidor = await servir('dist', PUERTO);
const navegador = await chromium.launch();
const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    locale: 'es-MX', timezoneId: 'America/Chihuahua', serviceWorkers: 'block' });
const p = await ctx.newPage();
const t0 = Date.now();
const seg = () => ((Date.now() - t0) / 1000).toFixed(1) + ' s';
const problemas = [];
let fallas = 0;
const paso = (ok, texto, extra) => {
    if (!ok) fallas++;
    console.log(`${ok ? '✅' : '❌'} [${seg()}] ${texto}${!ok && extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 400) : ''}`);
    return ok;
};
p.on('pageerror', e => problemas.push('Error de JavaScript: ' + e.message));
p.on('console', m => {
    const t = m.text();
    if (/Content Security Policy|Refused to/i.test(t)) problemas.push('Bloqueo CSP: ' + t.slice(0, 220));
});
// El mapa no hace falta para agendar (la ubicación se pone como lo hace el GPS)
// y la llave de Mapbox no está autorizada para localhost:4173.
await p.route(/api\.mapbox\.com|events\.mapbox\.com/, r => r.abort());
if (NOTA_WEBSOCKET) {
    // eslint-disable-next-line no-undef
    await p.addInitScript(() => { try { localStorage.setItem('firebase:previous_websocket_failure', 'true'); } catch (e) { /* sin almacenamiento */ } });
    console.log('(con la nota de "WebSocket falló": Firebase entra por long polling)');
}

let uid = null, citaId = null, cita = null;
try {
    await p.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => !document.getElementById('screen-login-phone').classList.contains('hidden'), null, { timeout: 30000 });
    await p.evaluate(() => new Promise(res => { const q = firebase.auth().onAuthStateChanged(() => { q(); res(); }); }));

    // 1) Crear la cuenta por la pantalla de registro
    await p.evaluate(() => mostrarPantalla('screen-registro'));
    await p.fill('#input-registro-nombre', 'Prueba automática');
    await p.fill('#input-registro-telefono', TELEFONO);
    await p.fill('#input-registro-password', CLAVE);
    await p.click('#btn-registrarme');
    const entro = await p.waitForFunction(() => !document.getElementById('screen-welcome').classList.contains('hidden') && baseLista() && usuarioActual,
        null, { timeout: 40000 }).then(() => true, () => false);
    if (!paso(entro, 'crea la cuenta y entra a la bienvenida')) throw new Error('no entró');
    uid = await p.evaluate(() => usuarioActual.uid);
    const conectada = await p.evaluate(() => new Promise(res => {
        const ref = firebase.database().ref('.info/connected');
        const f = s => { if (s.val() === true) { ref.off('value', f); res(true); } };
        ref.on('value', f); setTimeout(() => { ref.off('value', f); res(false); }, 20000);
    }));
    if (!paso(conectada, 'la base de datos se conecta')) throw new Error('sin base');
    await p.waitForFunction(() => /Prueba/.test(document.getElementById('saludo-simple').textContent), null, { timeout: 15000 }).catch(() => {});
    paso(/Hola, Prueba/.test(await p.textContent('#saludo-simple')), 'el saludo trae el nombre del registro', await p.textContent('#saludo-simple'));

    // 2) Agendar un Lavado Básico en una fecha lejana, en el primer horario libre
    const fecha = await p.evaluate(() => { let d = sumarDias(fechaLocalISO(), 60); while (esDomingoDeDescanso(d) || new Date(d + 'T00:00:00').getDay() === 0) d = sumarDias(d, 1); return d; });
    await p.evaluate(() => { ubicacionLat = 28.4053; ubicacionLon = -106.8664; ubicacionEsAproximada = false; calcularSectorCuauhtemoc(28.4053, -106.8664); });
    await p.evaluate(() => { seleccionarServicioBase('Lavado Básico'); irAAgendaDesdeExtras(); });
    await p.evaluate(f => elegirDiaCalendario(f), fecha);
    const cargo = await p.waitForFunction(() => !/Consultando/.test(document.getElementById('agenda-aviso').textContent), null, { timeout: 20000 }).then(() => true, () => false);
    const avisoAgenda = await p.textContent('#agenda-aviso');
    paso(cargo && !/No pudimos|no logró/i.test(avisoAgenda), 'el calendario carga los horarios del día', avisoAgenda);
    const libre = await p.evaluate(() => {
        const s = [['10:00 AM', 'slot-10'], ['12:00 PM', 'slot-12'], ['04:00 PM', 'slot-16'], ['06:00 PM', 'slot-18']]
            .find(([, id]) => !document.getElementById(id).classList.contains('ocupado'));
        if (s) seleccionarHora(s[0], s[1]);
        return s ? s[0] : null;
    });
    if (!paso(!!libre, `hay un horario libre el ${fecha} (${libre})`)) throw new Error('sin horario');
    await p.evaluate(() => avanzarAFormularioDesdeAgenda());
    paso(await p.inputValue('#input-nombre') === 'Prueba automática', '"Tus datos" sale con el nombre ya llenado', await p.inputValue('#input-nombre'));
    await p.fill('#input-vehiculo', 'Prueba automática (se borra sola)');
    await p.evaluate(() => { seleccionarTamanoManual('chico', 'tam-chico'); if (servicioNecesitaCorrienteDelCliente()) seleccionarTomaCorriente('si', 'luz-si'); });
    const tGuardar = Date.now();
    await p.click('#btn-finalizar');
    await p.waitForFunction(() => !document.getElementById('screen-confirmacion').classList.contains('hidden') || !document.getElementById('aviso-fondo').classList.contains('hidden'),
        null, { timeout: 30000 }).catch(() => {});
    const confirmada = await p.evaluate(() => !document.getElementById('screen-confirmacion').classList.contains('hidden'));
    const aviso = await p.evaluate(() => document.getElementById('aviso-fondo').classList.contains('hidden') ? null : document.getElementById('aviso-texto').textContent);
    paso(confirmada, `guarda la cita y sale la pantalla del ticket (en ${((Date.now() - tGuardar) / 1000).toFixed(1)} s)`, aviso);
    await p.waitForTimeout(2500);   // deja que corra la animación del ticket
    await p.screenshot({ path: `${CAPTURAS}/ticket${NOTA_WEBSOCKET ? '-long-polling' : ''}.png` });
    const folio = await p.textContent('#conf-folio');
    paso(/\S/.test(folio) && folio !== '—', 'el ticket trae folio', folio);

    // 3) Lo guardado en la base, leído con la misma sesión
    const guardado = await p.evaluate(async ([fol, f, h]) => {
        const ordenes = (await firebase.database().ref('ordenes/' + usuarioActual.uid).once('value')).val() || {};
        const id = Object.keys(ordenes).find(k => ordenes[k].idLocal === fol);
        const hueco = (await firebase.database().ref('agenda/' + f + '/' + claveHora(h)).once('value')).val();
        return { id, cita: id ? ordenes[id] : null, hueco };
    }, [folio, fecha, libre]);
    citaId = guardado.id; cita = guardado.cita;
    paso(!!guardado.cita && guardado.cita.agendaDia === fecha && guardado.cita.status === 'Pendiente', 'la cita quedó guardada en "ordenes"', guardado.cita);
    paso(!!guardado.hueco && guardado.hueco.uid === uid, 'su horario quedó apartado en "agenda"', guardado.hueco);

    // 4) Cancelarla como lo hace "Mis citas"
    if (citaId) {
        await p.evaluate(([id, c]) => cancelarCitaAtomica(id, c), [citaId, cita]);
        const quedo = await p.evaluate(async ([id, f, h]) => ({
            cita: (await firebase.database().ref('ordenes/' + usuarioActual.uid + '/' + id).once('value')).val(),
            hueco: (await firebase.database().ref('agenda/' + f + '/' + claveHora(h)).once('value')).val()
        }), [citaId, fecha, libre]);
        if (paso(!quedo.cita && !quedo.hueco, 'al cancelar se borra la cita y se suelta el horario', quedo)) { citaId = null; cita = null; }
    }
} catch (e) {
    paso(false, 'la prueba se detuvo: ' + e.message);
    await p.screenshot({ path: `${CAPTURAS}/donde-se-detuvo.png` }).catch(() => {});
} finally {
    // 5) Limpieza: pase lo que pase, no se queda nada de la prueba
    if (uid) {
        const limpieza = await p.evaluate(async ([id, c]) => {
            const r = [];
            try { if (id && c) { await cancelarCitaAtomica(id, c); r.push('cita cancelada en la limpieza'); } } catch (e) { r.push('cita: ' + e.message); }
            try { await firebase.database().ref('usuarios/' + usuarioActual.uid).remove(); r.push('perfil borrado'); } catch (e) { r.push('perfil: ' + e.message); }
            try { await firebase.auth().currentUser.delete(); r.push('cuenta borrada'); } catch (e) { r.push('cuenta: ' + (e.code || e.message)); }
            return r;
        }, [citaId, cita]).catch(e => ['limpieza: ' + e.message]);
        paso(limpieza.includes('perfil borrado') && limpieza.includes('cuenta borrada'), 'limpieza: ' + limpieza.join(', '), limpieza);
    }
    paso(problemas.length === 0, 'sin bloqueos de CSP ni errores de JavaScript', problemas);
    await navegador.close();
    servidor.close();
    console.log(`\n${fallas === 0 ? 'TODO BIEN' : fallas + ' PROBLEMA(S)'} — teléfono de prueba ${TELEFONO}`);
    process.exitCode = fallas ? 1 : 0;
}
