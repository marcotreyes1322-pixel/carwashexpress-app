// =====================================================================
// PRUEBA DE HUMO de la versión construida (dist/)
//
//   npm run construir && npm run humo
//
// La corre GitHub Actions en cada push, ANTES de publicar: si algo falla, no
// se publica. Abre la app en un Chrome de verdad y revisa lo que un cliente
// notaría primero:
//   · que abra sin errores de JavaScript en 4 tamaños de pantalla
//     (320×568, 360×640, 390×844 y una tablet de 800×1280)
//   · que nada se salga de lado ni quede cortado arriba en login/Crear cuenta
//   · que cada botón llame a una función que EXISTE (si la minificación
//     renombrara una, el botón dejaría de hacer algo sin avisar)
//   · que la versión de la app, la del Service Worker y version.json coincidan
//   · que las fotos salgan de trabajos/lista.json, sin preguntar una por una
//   · que después de abrirla una vez, vuelva a abrir SIN INTERNET
// Las capturas quedan en capturas/ (en Actions se descargan como "capturas").
//
// No toca la base de datos ni el mapa: la prueba no inicia sesión, y App
// Check, la base, Mapbox y el clima se bloquean para no gastar ni ensuciar
// las métricas de producción.
//
// Variables opcionales (para correrla sin internet, como en un contenedor):
//   HUMO_SIN_RED=1                 bloquea todo lo que no sea la propia app
//   HUMO_FIREBASE_LOCAL=carpeta    sirve firebase-app/auth-compat.js desde ahí
//   CHROMIUM_PATH=ruta             usa ese Chrome en vez del de Playwright
// =====================================================================
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { servir } from './servidor.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(RAIZ, 'dist');
const CAPTURAS = path.join(RAIZ, 'capturas');
const PUERTO = Number(process.env.HUMO_PUERTO) || 4173;
const URL_APP = `http://localhost:${PUERTO}/`;
const SIN_RED = !!process.env.HUMO_SIN_RED;
const FIREBASE_LOCAL = process.env.HUMO_FIREBASE_LOCAL;
const PANTALLAS = [[320, 568], [360, 640], [390, 844], [800, 1280]];

const resultados = [];
function ver(ok, texto, detalle) {
    resultados.push({ ok, texto });
    console.log(`  ${ok ? '✅' : '❌'} ${texto}${ok || detalle === undefined ? '' : '  → ' + JSON.stringify(detalle).slice(0, 300)}`);
}

async function preparar(contexto) {
    // Lo que esta prueba no necesita y no debe tocar producción.
    await contexto.route(/(firebase-app-check|firebase-database|recaptcha|firebaseio\.com|firebaseappcheck|mapbox|open-meteo)/, r => r.abort());
    if (FIREBASE_LOCAL) {
        await contexto.route(/gstatic\.com\/firebasejs\/[^/]+\/(firebase-(?:app|auth)-compat\.js)/, (r) => {
            const archivo = r.request().url().match(/(firebase-(?:app|auth)-compat\.js)/)[1];
            return r.fulfill({ contentType: 'application/javascript', body: readFileSync(path.join(FIREBASE_LOCAL, archivo), 'utf8') });
        });
    }
    if (SIN_RED) {
        await contexto.route(u => !u.href.startsWith(URL_APP) && !(FIREBASE_LOCAL && /gstatic\.com\/firebasejs/.test(u.href)), r => r.abort());
    }
}

async function abrir(navegador, [ancho, alto], { serviceWorker = false } = {}) {
    const contexto = await navegador.newContext({
        viewport: { width: ancho, height: alto }, isMobile: ancho < 700, hasTouch: true,
        deviceScaleFactor: 2, locale: 'es-MX', serviceWorkers: serviceWorker ? 'allow' : 'block'
    });
    await preparar(contexto);
    const pagina = await contexto.newPage();
    pagina.errores = [];
    pagina.pedidos = [];
    pagina.on('pageerror', e => pagina.errores.push(e.message));
    pagina.on('request', r => pagina.pedidos.push({ metodo: r.method(), url: r.url() }));
    await pagina.goto(URL_APP, { waitUntil: 'domcontentloaded' });
    await pagina.waitForFunction(() => {
        const login = document.getElementById('screen-login-phone');
        return login && !login.classList.contains('hidden');
    }, null, { timeout: 25000 });
    return { contexto, pagina };
}

async function revisarPantallasDeEntrada(pagina, [ancho, alto]) {
    for (const [id, nombre] of [['screen-login-phone', 'login'], ['screen-registro', 'registro']]) {
        await pagina.evaluate(p => mostrarPantalla(p), id);      // eslint-disable-line no-undef
        await pagina.waitForTimeout(300);
        const m = await pagina.evaluate((p) => {
            const pantalla = document.getElementById(p);
            pantalla.scrollTop = 0;
            const logo = pantalla.querySelector('.hero-logo');
            const boton = pantalla.querySelector('.btn-premium');
            const arriba = logo ? Math.round(logo.getBoundingClientRect().top) : null;
            boton.scrollIntoView({ block: 'nearest' });
            const b = boton.getBoundingClientRect();
            const alcanza = b.top >= 0 && b.bottom <= innerHeight;
            pantalla.scrollTop = 0;
            return { arriba, alcanza, deLado: document.documentElement.scrollWidth - innerWidth };
        }, id);
        const tam = `${ancho}×${alto}`;
        ver(m.arriba !== null && m.arriba >= 0, `${nombre} ${tam}: el logo se ve completo`, m);
        ver(m.alcanza, `${nombre} ${tam}: el botón principal se alcanza`, m);
        ver(m.deLado <= 1, `${nombre} ${tam}: nada se sale de lado`, m);
        await pagina.screenshot({ path: path.join(CAPTURAS, `${nombre}-${ancho}x${alto}.png`) });
    }
}

// Todas las funciones que llaman los botones: las del HTML (onclick="…") y las
// que el JS escribe dentro de plantillas o con setAttribute('onclick', …).
function funcionesDeLosBotones(html) {
    const nombres = new Set();
    const enAtributo = /\bon(?:click|change|input|submit|load|error|keydown|keyup)\s*=\s*\\?["']\s*(?:event\.preventDefault\(\);\s*)?(?:return\s+)?([A-Za-z_$][\w$]*)\s*\(/g;
    const enSetAttribute = /setAttribute\(\s*["']onclick["']\s*,\s*["'`]([A-Za-z_$][\w$]*)\s*\(/g;
    for (const re of [enAtributo, enSetAttribute]) for (const m of html.matchAll(re)) nombres.add(m[1]);
    ['if', 'this', 'event', 'return'].forEach(n => nombres.delete(n));
    return [...nombres].sort();
}

async function principal() {
    if (!existsSync(path.join(DIST, 'index.html'))) {
        throw new Error('No existe dist/index.html: primero corre "npm run construir".');
    }
    mkdirSync(CAPTURAS, { recursive: true });
    const version = JSON.parse(readFileSync(path.join(DIST, 'version.json'), 'utf8')).version;
    const html = readFileSync(path.join(DIST, 'index.html'), 'utf8');
    const lista = JSON.parse(readFileSync(path.join(DIST, 'trabajos', 'lista.json'), 'utf8'));
    console.log(`Prueba de humo de la versión ${version}\n`);

    let servidor = await servir(DIST, PUERTO);
    const navegador = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    try {
        console.log('1) Abre bien en cada tamaño de pantalla');
        for (const tam of PANTALLAS) {
            const { contexto, pagina } = await abrir(navegador, tam);
            if (tam === PANTALLAS[0]) {
                ver(await pagina.evaluate(() => firebaseListo), 'Firebase (login) cargó');   // eslint-disable-line no-undef
            }
            await revisarPantallasDeEntrada(pagina, tam);
            ver(pagina.errores.length === 0, `${tam.join('×')}: sin errores de JavaScript`, pagina.errores);
            await contexto.close();
        }

        console.log('\n2) Botones, versión, fotos y accesibilidad');
        {
            const { contexto, pagina } = await abrir(navegador, [390, 844]);
            const nombres = funcionesDeLosBotones(html);
            const faltan = await pagina.evaluate(ns => ns.filter(n => typeof window[n] !== 'function'), nombres);
            ver(nombres.length > 30 && faltan.length === 0, `las ${nombres.length} funciones que llaman los botones existen`, faltan);

            const enPantalla = await pagina.evaluate(() => document.getElementById('marca-version').textContent);
            const delSW = (await (await fetch(URL_APP + 'sw.js')).text()).match(/VERSION\s*=\s*["']cwe-([^"']+)["']/);
            ver(enPantalla === 'v' + version, `la app dice v${version}`, enPantalla);
            ver(delSW && delSW[1] === version, 'el Service Worker trae la MISMA versión', delSW && delSW[1]);
            if (process.env.GITHUB_SHA) {
                ver(version.includes(process.env.GITHUB_SHA.slice(0, 7)), 'la versión lleva el commit que se está publicando', version);
            }

            const antes = pagina.pedidos.length;
            await pagina.evaluate(() => abrirMenu());               // eslint-disable-line no-undef
            await pagina.waitForFunction(() => document.querySelectorAll('#mosaico-fotos i').length > 0, null, { timeout: 8000 }).catch(() => {});
            const deFotos = pagina.pedidos.slice(antes).filter(p => p.url.includes('/trabajos/'));
            const preguntas = deFotos.filter(p => p.metodo === 'HEAD').length;
            const pidioLista = deFotos.some(p => p.url.endsWith('/trabajos/lista.json'));
            const total = lista.sueltas.length + lista.pares.length;
            const enMosaico = await pagina.evaluate(() => document.querySelectorAll('#mosaico-fotos i').length);
            ver(pidioLista && preguntas === 0, `las fotos salen de lista.json (${total} en la lista) sin preguntar una por una`, { pidioLista, preguntas });
            ver(total === 0 || enMosaico > 0, 'el menú enseña fotos de trabajos', enMosaico);
            await pagina.screenshot({ path: path.join(CAPTURAS, 'menu-390x844.png') });
            await pagina.evaluate(() => cerrarMenu());              // eslint-disable-line no-undef

            const acc = await pagina.evaluate(() => ({
                sinNombre: [...document.querySelectorAll('button')]
                    .filter(b => !b.closest('#aviso-botones') && !b.textContent.trim() && !b.getAttribute('aria-label'))
                    .map(b => b.id || b.className),
                sinEtiqueta: [...document.querySelectorAll('input[id]:not([type=hidden]):not([hidden]):not([type=checkbox]):not([type=range])')]
                    .filter(i => !(i.labels && i.labels.length) && !i.getAttribute('aria-label')).map(i => i.id)
            }));
            ver(acc.sinNombre.length === 0, 'todos los botones tienen texto o nombre para el lector de pantalla', acc.sinNombre);
            ver(acc.sinEtiqueta.length === 0, 'todos los campos tienen su etiqueta', acc.sinEtiqueta);
            ver(pagina.errores.length === 0, 'sin errores de JavaScript', pagina.errores);
            await contexto.close();
        }

        console.log('\n3) Modo sin internet');
        {
            const { contexto, pagina } = await abrir(navegador, [390, 844], { serviceWorker: true });
            const guardado = await pagina.evaluate(async (v) => {
                await navigator.serviceWorker.ready;
                for (let i = 0; i < 40; i++) {
                    const cache = (await caches.keys()).includes('cwe-' + v) ? await caches.open('cwe-' + v) : null;
                    if (cache && await cache.match('./index.html') && await cache.match('./trabajos/lista.json')) return true;
                    await new Promise(r => setTimeout(r, 250));
                }
                return (await caches.keys()).join(', ') || 'sin cachés';
            }, version);
            ver(guardado === true, 'el Service Worker guardó la app y la lista de fotos', guardado);
            // Se "corta el internet": se apaga el servidor, conexiones abiertas incluidas.
            await new Promise(r => { servidor.close(r); servidor.closeAllConnections(); });
            servidor = null;
            const reabre = await pagina.reload({ waitUntil: 'domcontentloaded' })
                .then(() => pagina.waitForFunction(() => !document.getElementById('screen-login-phone').classList.contains('hidden'), null, { timeout: 15000 }))
                .then(() => true, e => e.message.split('\n')[0]);
            ver(reabre === true, 'sin internet, la app vuelve a abrir', reabre);
            await pagina.screenshot({ path: path.join(CAPTURAS, 'sin-internet-390x844.png') });
            await contexto.close();
        }
    } finally {
        await navegador.close();
        if (servidor) servidor.close();
    }

    const malas = resultados.filter(r => !r.ok);
    console.log(`\nResultado: ${resultados.length - malas.length} bien, ${malas.length} mal`);
    if (process.env.GITHUB_STEP_SUMMARY) {
        writeFileSync(process.env.GITHUB_STEP_SUMMARY, [
            `### Prueba de humo: ${malas.length ? `❌ ${malas.length} falla(s)` : '✅ todo bien'} (${resultados.length} revisiones)`, '',
            ...(malas.length ? malas.map(r => `- ❌ ${r.texto}`) : ['Las capturas están en el artefacto **capturas** de esta corrida.']), ''
        ].join('\n'), { flag: 'a' });
    }
    return malas.length === 0;
}

principal().then(bien => process.exit(bien ? 0 : 1), (e) => {
    console.error(process.env.GITHUB_ACTIONS ? `::error::${e.message}` : `\n❌ ${e.stack || e.message}`);
    process.exit(1);
});
