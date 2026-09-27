// DIAGNÓSTICO TEMPORAL: abre la versión construida en un Chrome con internet de
// verdad (el de GitHub Actions) y mide qué frena la conexión con Firebase.
// No inicia sesión ni escribe nada en la base: sólo mira .info/connected,
// el permiso de App Check y una lectura sin sesión (que DEBE ser rechazada).
import { chromium } from 'playwright';
import { servir } from './servidor.mjs';

const PUERTO = 4173;
const servidor = await servir('dist', PUERTO);
const navegador = await chromium.launch();

async function probar(nombre, { sinAppCheck = false } = {}) {
    console.log(`\n══ ${nombre} ══`);
    const ctx = await navegador.newContext({ serviceWorkers: 'block' });
    const p = await ctx.newPage();
    const t0 = Date.now();
    const seg = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
    p.on('console', m => { const t = m.text(); if (/app-?check|recaptcha|firebase|database|token/i.test(t)) console.log(`  [${seg()}] consola ${m.type()}: ${t.slice(0, 300)}`); });
    p.on('pageerror', e => console.log(`  [${seg()}] ERROR JS: ${e.message}`));
    p.on('requestfailed', r => console.log(`  [${seg()}] FALLÓ ${r.url().slice(0, 120)} → ${r.failure() && r.failure().errorText}`));
    p.on('response', r => { if (/recaptcha|firebaseappcheck|securetoken|identitytoolkit/.test(r.url())) console.log(`  [${seg()}] ${r.status()} ${r.url().split('?')[0].slice(0, 120)}`); });
    if (sinAppCheck) await p.route(/firebase-app-check-compat/, r => r.abort());
    await p.route(/(mapbox|open-meteo|three)/, r => r.abort());
    await p.addInitScript(() => {
        window.__logs = [];
        const t = setInterval(() => {
            if (window.firebase && window.firebase.database && window.firebase.database.enableLogging) {
                clearInterval(t);
                window.firebase.database.enableLogging(m => window.__logs.push(((performance.now() / 1000).toFixed(1)) + 's ' + m));
            }
        }, 5);
    });
    await p.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length, null, { timeout: 30000 }).catch(() => {});
    const r = await p.evaluate(async () => {
        const out = {};
        const t0 = performance.now();
        const ms = () => Math.round(performance.now() - t0);
        const db = firebase.database();
        out.conectado = await new Promise(res => {
            const ref = db.ref('.info/connected');
            const f = s => { if (s.val() === true) { ref.off('value', f); res('sí, a los ' + ms() + ' ms'); } };
            ref.on('value', f);
            setTimeout(() => { ref.off('value', f); res('NO en 25 s'); }, 25000);
        });
        if (firebase.appCheck) {
            try { const tk = await firebase.appCheck().getToken(); out.appCheck = 'permiso de ' + (tk && tk.token ? tk.token.length : 0) + ' caracteres, a los ' + ms() + ' ms'; }
            catch (e) { out.appCheck = 'ERROR: ' + (e && e.message); }
        } else out.appCheck = 'sin App Check';
        out.lecturaSinSesion = await db.ref('agenda').limitToFirst(1).once('value').then(() => 'la dejó leer (¡revisar reglas!)', e => 'rechazada como debe: ' + (e && e.code || e.message));
        out.logs = (window.__logs || []).filter(l => /connect|token|appcheck|App Check|websocket|Websocket|long-?poll|error|fail|interrupt/i.test(l)).slice(0, 60);
        return out;
    });
    console.log('  → Base conectada:', r.conectado);
    console.log('  → App Check:', r.appCheck);
    console.log('  → Lectura sin sesión:', r.lecturaSinSesion);
    console.log('  → Registro de Realtime Database:\n    ' + r.logs.join('\n    '));
    await ctx.close();
    return r;
}

try {
    await probar('La app tal cual (con App Check)');
    await probar('Sin App Check (para comparar)', { sinAppCheck: true });
} finally {
    await navegador.close();
    servidor.close();
}
