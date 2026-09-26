// =====================================================================
// CONSTRUIR LA VERSIÓN QUE SE PUBLICA  →  carpeta dist/
//
//   npm run construir
//
// Lo corre GitHub Actions en cada push (ver .github/workflows/publicar.yml),
// pero también se puede correr en la tablet para ver el resultado.
//
// Qué hace:
//   1. SELLA LA VERSIÓN (fecha + commit) en la app y en el Service Worker, las
//      dos con el MISMO valor. Se acabó la regla de "subir el número a mano en
//      cada entrega", que ya había fallado (la app y el SW llegaron a decir
//      versiones distintas).
//   2. MINIFICA el CSS y el JS de index.html con esbuild y quita los
//      comentarios del HTML. El código fuente NO se toca: los comentarios se
//      quedan en el repositorio, sólo dejan de viajar a cada teléfono.
//   3. GENERA trabajos/lista.json con las fotos que haya en trabajos/, para que
//      la app haga una sola petición en vez de preguntar foto por foto.
//   4. COPIA íconos, fondos, fotos, manifest y robots.txt a dist/.
//
// Si algo sale mal, termina con error y NO se publica nada.
// =====================================================================
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(RAIZ, 'dist');
const INTERMEDIOS = path.join(RAIZ, '.construccion');   // el JS ya sellado, sin minificar: lo revisa el lint
const EN_ACTIONS = !!process.env.GITHUB_ACTIONS;

// Hasta dónde se permite que llegue la sintaxis del resultado. El código de la
// app no usa nada más nuevo que esto; sin este tope, esbuild podría "ahorrar"
// bytes escribiendo `a ||= b` o `inset: 0`, que un Android o un iPhone de hace
// unos años no entienden — y en JS eso no rompe una línea: rompe la app entera.
const COMPATIBLE_CON = ['chrome64', 'edge79', 'firefox67', 'safari12'];

// Presupuesto: si index.html comprimido pasa de esto, algo se coló (una foto en
// base64, una librería pegada) y es mejor enterarse antes de publicar.
const MAXIMO_KB_COMPRIMIDO = 150;

const avisos = [];
function avisar(texto, archivo) {
    avisos.push(texto);
    // En Actions sale como aviso amarillo junto al archivo, visible desde el celular.
    console.log(EN_ACTIONS ? `::warning${archivo ? ` file=${archivo}` : ''}::${texto}` : `⚠️  ${texto}`);
}

function sh(comando) {
    return execSync(comando, { cwd: RAIZ, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
}

// ── 1. La versión ─────────────────────────────────────────────────────────
// Formato: 2026.09.26-1fff14d  → fecha del commit (hora de Chihuahua) + commit.
// Con cambios sin guardar en git se le agrega "+hhmmss", para que cada prueba
// local sea una versión distinta y el Service Worker no sirva la anterior.
function versionDeEstaEntrega() {
    if (process.env.VERSION_APP) return process.env.VERSION_APP;
    const dia = (fecha) => new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Chihuahua', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(fecha).replaceAll('-', '.');
    try {
        const commit = sh('git rev-parse --short=7 HEAD');
        const fecha = new Date(sh('git log -1 --format=%cI'));
        const sinGuardar = sh('git status --porcelain --untracked-files=no') !== '';
        const hora = new Date().toTimeString().slice(0, 8).replaceAll(':', '');
        return `${dia(fecha)}-${commit}${sinGuardar ? '+' + hora : ''}`;
    } catch {
        return `${dia(new Date())}-local`;       // sin git (p. ej. un .zip descargado)
    }
}

function reemplazarUnaVez(texto, patron, nuevo, que) {
    const veces = (texto.match(new RegExp(patron.source, 'g')) || []).length;
    if (veces !== 1) throw new Error(`Esperaba encontrar ${que} UNA vez y lo encontré ${veces}.`);
    return texto.replace(patron, nuevo);
}

// ── 2. El HTML ────────────────────────────────────────────────────────────
// Se recorre como lo hace el navegador: los comentarios <!-- --> se saltan, y
// lo que hay dentro de <script> y <style> se toma TAL CUAL (ahí un "<!--" o un
// "<script" es texto, no una etiqueta). Esto importa: hay comentarios del HTML
// que mencionan "<script>" y los JS arman HTML con plantillas.
function trocear(html) {
    const partes = [];
    const minusculas = html.toLowerCase();
    const inicio = /<!--|<(script|style)\b[^>]*>/gi;
    let i = 0, texto = '';
    for (;;) {
        inicio.lastIndex = i;
        const m = inicio.exec(html);
        if (!m) { texto += html.slice(i); break; }
        texto += html.slice(i, m.index);
        if (m[0] === '<!--') {
            const fin = html.indexOf('-->', m.index + 4);
            if (fin < 0) throw new Error('Hay un comentario <!-- sin cerrar en index.html');
            i = fin + 3;                                   // el comentario no se publica
            continue;
        }
        const etiqueta = m[1].toLowerCase();
        const cierre = minusculas.indexOf('</' + etiqueta, inicio.lastIndex);
        if (cierre < 0) throw new Error(`Hay un <${etiqueta}> sin cerrar en index.html`);
        partes.push({ tipo: 'html', texto });
        texto = '';
        partes.push({ tipo: etiqueta, apertura: m[0], contenido: html.slice(inicio.lastIndex, cierre), desde: inicio.lastIndex });
        i = html.indexOf('>', cierre) + 1;
        partes.push({ tipo: 'html', texto: html.slice(cierre, i) });
    }
    partes.push({ tipo: 'html', texto });
    return partes;
}

// Sólo se quita la sangría y los espacios repetidos: se conserva UN salto de
// línea donde había, así que se ve idéntico (en HTML normal un salto vale lo
// mismo que un espacio, y en white-space: pre-line los saltos se respetan).
// NO se pegan las etiquetas entre sí: "<b>a</b> <i>b</i>" perdería el espacio.
function compactarHtml(texto) {
    return texto
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{2,}/g, '\n')
        .replace(/[ \t]{2,}/g, ' ');
}

async function minificar(codigo, loader) {
    const r = await transform(codigo, {
        loader, minify: true, charset: 'utf8', legalComments: 'none', target: COMPATIBLE_CON,
        // esbuild marca la desestructuración ([a, b] = …) como "con fallas" en
        // Safari anterior a 14.1 y se niega a tocarla. El código original ya la
        // usa y funciona: se le dice que la deje igual, sin cambiar el tope de
        // todo lo demás.
        supported: loader === 'js' ? { destructuring: true } : undefined
    });
    r.warnings.forEach(w => avisar(`esbuild (${loader}): ${w.text}`, 'index.html'));
    return r.code.trim();
}

async function construirIndex(version) {
    const fuente = readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
    const salida = [];
    let scriptsDeLaApp = 0;
    for (const p of trocear(fuente)) {
        if (p.tipo === 'html') { salida.push(compactarHtml(p.texto)); continue; }
        const apertura = compactarHtml(p.apertura);
        if (p.tipo === 'style') {
            salida.push(apertura + await minificar(p.contenido, 'css'));
        } else if (/\bsrc\s*=/.test(p.apertura)) {
            salida.push(apertura);                            // librería externa: queda igual
        } else if (/application\/ld\+json/i.test(p.apertura)) {
            salida.push(apertura + JSON.stringify(JSON.parse(p.contenido)));
        } else {
            scriptsDeLaApp++;
            const sellado = reemplazarUnaVez(p.contenido, /const VERSION_APP = '[^']*';/,
                `const VERSION_APP = '${version}';`, 'const VERSION_APP');
            // Se antepone un renglón vacío por cada renglón de index.html que hay
            // antes del script: así, si el lint marca "línea 4321", es la línea
            // 4321 de index.html, no hay que hacer cuentas.
            const renglonesAntes = fuente.slice(0, p.desde).split('\n').length - 1;
            mkdirSync(INTERMEDIOS, { recursive: true });
            writeFileSync(path.join(INTERMEDIOS, 'app-fuente.js'), '\n'.repeat(renglonesAntes) + sellado);
            salida.push(apertura + await minificar(sellado, 'js'));
        }
    }
    if (scriptsDeLaApp !== 1) throw new Error(`Esperaba UN script de la app en index.html y hay ${scriptsDeLaApp}.`);
    return salida.join('').trim() + '\n';
}

// ── 3. Las fotos de trabajos ──────────────────────────────────────────────
// Reglas de nombre (las mismas de siempre): 15.jpg → foto suelta;
// 3-antes.jpg + 3-despues.jpg → par antes/después. Ahora también sirven .jpeg,
// .png y .webp. Lo que no siga la regla se avisa en Actions, para que Tristán
// sepa por qué una foto no sale en vez de adivinar.
const FOTO = /^(\d+)(?:-(antes|despues))?\.(jpe?g|png|webp)$/i;
const PESO_MAXIMO_FOTO_KB = 450;

function listaDeFotos() {
    const carpeta = path.join(RAIZ, 'trabajos');
    const archivos = existsSync(carpeta) ? readdirSync(carpeta).sort() : [];
    const sueltas = new Map(), antes = new Map(), despues = new Map();
    for (const archivo of archivos) {
        if (archivo === 'lista.json' || archivo.startsWith('.')) continue;
        const m = archivo.match(FOTO);
        if (!m) {
            avisar(`La foto "${archivo}" no se va a ver: el nombre debe ser un número (15.jpg) o un par (3-antes.jpg y 3-despues.jpg).`, `trabajos/${archivo}`);
            continue;
        }
        const n = Number(m[1]);
        const destino = m[2] === 'antes' ? antes : m[2] === 'despues' ? despues : sueltas;
        if (destino.has(n)) {
            avisar(`Hay dos fotos con el número ${n} ("${destino.get(n)}" y "${archivo}"); sólo se usa la primera.`, `trabajos/${archivo}`);
            continue;
        }
        destino.set(n, archivo);
        const kb = Math.round(statSync(path.join(carpeta, archivo)).size / 1024);
        if (kb > PESO_MAXIMO_FOTO_KB) {
            avisar(`"${archivo}" pesa ${kb} KB: conviene bajarla a menos de ${PESO_MAXIMO_FOTO_KB} KB (con datos móviles tarda en salir).`, `trabajos/${archivo}`);
        }
    }
    const pares = [];
    for (const [n, a] of antes) {
        if (despues.has(n)) pares.push({ n, antes: a, despues: despues.get(n) });
        else avisar(`"${a}" no tiene su "${n}-despues": media comparación no se muestra.`, `trabajos/${a}`);
    }
    for (const [n, d] of despues) {
        if (!antes.has(n)) avisar(`"${d}" no tiene su "${n}-antes": media comparación no se muestra.`, `trabajos/${d}`);
    }
    return {
        pares: pares.sort((x, y) => x.n - y.n),
        sueltas: [...sueltas].map(([n, foto]) => ({ n, foto })).sort((x, y) => x.n - y.n)
    };
}

// ── 4. El Service Worker ──────────────────────────────────────────────────
async function construirServiceWorker(version) {
    let sw = readFileSync(path.join(RAIZ, 'sw.js'), 'utf8');
    sw = reemplazarUnaVez(sw, /const VERSION = '[^']*';/, `const VERSION = 'cwe-${version}';`, "const VERSION del SW");
    // La lista de fotos sólo existe en la versión construida: se agrega aquí y
    // no en sw.js, porque si falta UN archivo de la lista, cache.addAll falla
    // completo y la app se queda sin modo sin internet.
    sw = reemplazarUnaVez(sw, /const ARCHIVOS = \[/, "const ARCHIVOS = ['./trabajos/lista.json',", 'const ARCHIVOS del SW');
    return (await minificar(sw, 'js')) + '\n';
}

// ── Todo junto ────────────────────────────────────────────────────────────
const kb = (bytes) => (bytes / 1024).toFixed(1) + ' KB';

async function construir() {
    const version = versionDeEstaEntrega();
    console.log(`Construyendo la versión ${version}\n`);

    rmSync(DIST, { recursive: true, force: true });
    mkdirSync(DIST, { recursive: true });

    // Lo que se publica tal cual. Se copia por lista y no "todo": así README,
    // package.json, scripts/ y .github/ nunca llegan al sitio.
    for (const carpeta of ['fondos', 'trabajos']) {
        if (existsSync(path.join(RAIZ, carpeta))) cpSync(path.join(RAIZ, carpeta), path.join(DIST, carpeta), { recursive: true });
    }
    for (const archivo of readdirSync(RAIZ)) {
        if (/\.(png|ico|svg|txt|xml|webmanifest)$/i.test(archivo) || archivo === '.nojekyll') {
            cpSync(path.join(RAIZ, archivo), path.join(DIST, archivo));
        }
    }
    const manifest = JSON.parse(readFileSync(path.join(RAIZ, 'manifest.json'), 'utf8'));
    writeFileSync(path.join(DIST, 'manifest.json'), JSON.stringify(manifest));

    const fotos = listaDeFotos();
    mkdirSync(path.join(DIST, 'trabajos'), { recursive: true });
    writeFileSync(path.join(DIST, 'trabajos', 'lista.json'), JSON.stringify(fotos));

    const index = await construirIndex(version);
    writeFileSync(path.join(DIST, 'index.html'), index);
    writeFileSync(path.join(DIST, 'sw.js'), await construirServiceWorker(version));

    // Para confirmar desde cualquier teléfono qué versión está publicada:
    // abrir …/carwashexpress-app/version.json
    const commit = version.match(/-([0-9a-f]{7})/);
    writeFileSync(path.join(DIST, 'version.json'), JSON.stringify({
        version, commit: commit ? commit[1] : null, construida: new Date().toISOString()
    }) + '\n');

    // ── Resumen ──
    const original = readFileSync(path.join(RAIZ, 'index.html'));
    const gzOriginal = gzipSync(original).length, gzNuevo = gzipSync(index).length;
    const filas = [
        ['index.html', kb(original.length), kb(Buffer.byteLength(index)), kb(gzOriginal), kb(gzNuevo)],
    ];
    console.log('Archivo       Antes        Después      Comprimido antes → después');
    filas.forEach(f => console.log(`${f[0].padEnd(13)} ${f[1].padEnd(12)} ${f[2].padEnd(12)} ${f[3]} → ${f[4]}`));
    console.log(`Fotos: ${fotos.sueltas.length} sueltas, ${fotos.pares.length} pares antes/después`);
    if (avisos.length) console.log(`\n${avisos.length} aviso(s) arriba (no impiden publicar).`);

    if (process.env.GITHUB_STEP_SUMMARY) {
        writeFileSync(process.env.GITHUB_STEP_SUMMARY, [
            `### Versión ${version}`, '',
            '| | Antes | Después |', '|---|---|---|',
            `| index.html | ${kb(original.length)} | ${kb(Buffer.byteLength(index))} |`,
            `| comprimido (lo que baja el teléfono) | ${kb(gzOriginal)} | ${kb(gzNuevo)} |`, '',
            `Fotos de trabajos: **${fotos.sueltas.length}** sueltas y **${fotos.pares.length}** pares antes/después.`,
            ...(avisos.length ? ['', '**Avisos:**', ...avisos.map(a => `- ${a}`)] : []), ''
        ].join('\n'), { flag: 'a' });
    }

    if (gzNuevo / 1024 > MAXIMO_KB_COMPRIMIDO) {
        throw new Error(`index.html comprimido pesa ${kb(gzNuevo)}, más que el tope de ${MAXIMO_KB_COMPRIMIDO} KB.`);
    }
}

construir().catch(e => {
    console.error(EN_ACTIONS ? `::error::${e.message}` : `\n❌ ${e.message}`);
    process.exit(1);
});
