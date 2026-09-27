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

// ── 3. Las fotos ─────────────────────────────────────────────────────────
// Tristán puede subir las fotos TAL CUAL salen del teléfono (4000 px, 3-5 MB,
// HEIC del iPhone, con cualquier nombre, como IMG_4521.HEIC). Aquí, antes de
// publicar:
//   · las HEIC se convierten a JPG (ningún navegador fuera de Safari las abre);
//   · se dejan del tamaño de una pantalla de teléfono, en vertical: nítidas a
//     pantalla completa sin pesar de más (las originales no se tocan: se
//     quedan en el repositorio). Las horizontales se recortan a vertical con
//     "recorte inteligente": se queda la parte más llamativa (el auto), no
//     siempre el centro;
//   · se giran si el teléfono las guardó "acostadas";
//   · se les BORRAN los datos ocultos (EXIF), que en una foto de celular
//     incluyen la ubicación GPS exacta de donde se tomó: la casa del cliente.
// Nombres: 15.jpg (el número manda el orden: el más alto sale primero),
// 3-antes.jpg + 3-despues.jpg (par antes/después), o cualquier otro nombre:
// ésas se acomodan por fecha de subida, la más nueva primero.
const ES_FOTO = /\.(jpe?g|png|webp|heic|heif)$/i;
const ES_HEIC = /\.(heic|heif)$/i;
const FOTO_NUMERO = /^(\d+)\.(jpe?g|png|webp|heic|heif)$/i;
const FOTO_PAR = /^(\d+)-(antes|despues)\.(jpe?g|png|webp|heic|heif)$/i;
// Son fotos de pantalla completa en calidad alta: hasta ~700 KB es normal.
const PESO_MAXIMO_FOTO_KB = 700;
// Menos que esto en su lado largo y la foto se ve borrosa a pantalla completa:
// la app no la usa de fondo en el inicio (sí en el menú).
const LADO_MINIMO_PANTALLA_COMPLETA = 1000;
// 1296×2304 es una pantalla de iPhone en vertical (9:16) a tamaño real: la foto
// se ve nítida de orilla a orilla y pesa ~300 KB en vez de 2-3 MB.
const LIMITES = {
    trabajos: { ancho: 1296, alto: 2304, calidad: 80, vertical: true },
    fondos:   { ancho: 1080, alto: 2340, calidad: 78 }
};

async function cargarHeic() {
    try { return (await import('heic-decode')).default; } catch { return null; }
}

async function cargarSharp() {
    try { return (await import('sharp')).default; } catch { return null; }
}

function fechaDeSubida(ruta) {
    try {
        const t = Number(sh(`git log -1 --format=%ct -- "${ruta}"`));
        if (t) return t;
    } catch { /* sin git */ }
    return Math.floor(statSync(path.join(RAIZ, ruta)).mtimeMs / 1000);
}

// Achica, gira, convierte y limpia las fotos YA copiadas en dist/.
// Devuelve, por cada original, el nombre con que se publica y sus medidas.
async function optimizarFotos(sharp, carpeta) {
    const dir = path.join(DIST, carpeta);
    const medidas = new Map();
    if (!existsSync(dir)) return medidas;
    const limite = LIMITES[carpeta];
    const heic = await cargarHeic();
    let antes = 0, despues = 0, tocadas = 0;
    for (const archivo of readdirSync(dir).sort()) {
        if (!ES_FOTO.test(archivo)) continue;
        const ruta = path.join(dir, archivo);
        const original = readFileSync(ruta);
        antes += original.length;
        const esHeic = ES_HEIC.test(archivo);
        if (!sharp || (esHeic && !heic)) {
            if (esHeic) {
                // Sin herramientas no hay cómo convertirla: se quita para no publicar una foto rota.
                rmSync(ruta);
                avisar(`"${archivo}" es HEIC y aquí no se puede convertir (falta sharp o heic-decode): no sale en esta prueba local.`, `${carpeta}/${archivo}`);
                continue;
            }
            medidas.set(archivo, { archivo });
            despues += original.length;
            continue;
        }
        // HEIC → píxeles (ya derechos: libheif aplica el giro al decodificar).
        let entrada = sharp(original, { failOn: 'none' });
        let orientacion = 1, ancho, alto, conDatos;
        if (esHeic) {
            const px = await heic({ buffer: original });
            entrada = sharp(Buffer.from(px.data.buffer), { raw: { width: px.width, height: px.height, channels: 4 } });
            ancho = px.width; alto = px.height; conDatos = true;
        } else {
            const meta = await entrada.metadata();
            orientacion = meta.orientation || 1;
            const acostada = orientacion >= 5;                  // EXIF 5-8: vienen de lado
            ancho = acostada ? meta.height : meta.width;
            alto = acostada ? meta.width : meta.height;
            conDatos = !!(meta.exif || meta.xmp || meta.iptc) || orientacion !== 1;
        }
        const horizontal = ancho > alto;
        const excede = limite.vertical
            ? (horizontal ? alto > limite.ancho : ancho > limite.ancho || alto > limite.alto)
            : ancho > limite.ancho || alto > limite.alto;
        const nombre = esHeic ? archivo.replace(/(\.(heic|heif))+$/i, '') + '.jpg' : archivo;
        if (!excede && !conDatos && !esHeic) {
            medidas.set(archivo, { archivo, w: ancho, h: alto });
            despues += original.length;
            continue;                                            // ya está bien: no se re-comprime
        }
        const calidad = excede ? limite.calidad : 90;            // si no se achica, casi sin pérdida
        let proceso = entrada.rotate();
        proceso = (limite.vertical && horizontal)
            // Horizontal → vertical, quedándose con lo más llamativo de la foto.
            ? proceso.resize({ width: Math.min(limite.ancho, Math.round(alto * 9 / 16)), height: Math.min(limite.alto, alto),
                               fit: 'cover', position: 'attention', withoutEnlargement: true })
            : proceso.resize({ width: limite.ancho, height: limite.alto, fit: 'inside', withoutEnlargement: true });
        const tipo = esHeic ? 'jpg' : archivo.toLowerCase().split('.').pop();
        proceso = tipo === 'png' ? proceso.png({ compressionLevel: 9 })
                : tipo === 'webp' ? proceso.webp({ quality: calidad })
                : proceso.jpeg({ quality: calidad, mozjpeg: true, progressive: true });
        const { data, info } = await proceso.toBuffer({ resolveWithObject: true });
        if (nombre !== archivo) rmSync(ruta);
        writeFileSync(path.join(dir, nombre), data);
        medidas.set(archivo, { archivo: nombre, w: info.width, h: info.height });
        despues += data.length;
        tocadas++;
    }
    if (tocadas) console.log(`${carpeta}/: ${tocadas} foto(s) optimizadas, sin datos de ubicación (${kb(antes)} → ${kb(despues)})`);
    return medidas;
}

function listaDeFotos(medidas) {
    const carpeta = path.join(RAIZ, 'trabajos');
    const archivos = existsSync(carpeta) ? readdirSync(carpeta).sort() : [];
    const numeradas = new Map(), antes = new Map(), despues = new Map(), libres = [];
    for (const archivo of archivos) {
        if (archivo === 'lista.json' || archivo.startsWith('.')) continue;
        if (!ES_FOTO.test(archivo)) {
            avisar(`"${archivo}" no es una foto (sirven .jpg, .jpeg, .png, .webp y .heic).`, `trabajos/${archivo}`);
            continue;
        }
        if (!medidas.has(archivo)) continue;                    // HEIC que no se pudo convertir (ya avisado)
        const par = archivo.match(FOTO_PAR), num = archivo.match(FOTO_NUMERO);
        const destino = par ? (par[2].toLowerCase() === 'antes' ? antes : despues) : num ? numeradas : null;
        if (!destino) { libres.push(archivo); continue; }
        const n = Number((par || num)[1]);
        if (destino.has(n)) {
            avisar(`Hay dos fotos con el número ${n} ("${destino.get(n)}" y "${archivo}"); sólo se usa la primera.`, `trabajos/${archivo}`);
            continue;
        }
        destino.set(n, archivo);
    }
    // Las de nombre libre van DESPUÉS de las numeradas, por fecha de subida:
    // la más nueva recibe el número más alto y por eso sale primero.
    let siguiente = Math.max(0, ...numeradas.keys()) + 1;
    libres
        .map(archivo => ({ archivo, fecha: fechaDeSubida(`trabajos/${archivo}`) }))
        .sort((x, y) => x.fecha - y.fecha || x.archivo.localeCompare(y.archivo))
        .forEach(({ archivo }) => numeradas.set(siguiente++, archivo));

    // Con el nombre con que se PUBLICA (las HEIC salen como .jpg) y sus medidas.
    const publicada = (archivo) => (medidas.get(archivo) || {}).archivo || archivo;
    const conMedidas = (datos, archivo) => {
        const m = medidas.get(archivo) || {};
        return m.w ? Object.assign(datos, { w: m.w, h: m.h }) : datos;
    };
    const pares = [];
    for (const [n, a] of antes) {
        if (despues.has(n)) pares.push(conMedidas({ n, antes: publicada(a), despues: publicada(despues.get(n)) }, despues.get(n)));
        else avisar(`"${a}" no tiene su "${n}-despues": media comparación no se muestra.`, `trabajos/${a}`);
    }
    for (const [n, d] of despues) {
        if (!antes.has(n)) avisar(`"${d}" no tiene su "${n}-antes": media comparación no se muestra.`, `trabajos/${d}`);
    }
    const sueltas = [...numeradas].map(([n, foto]) => conMedidas({ n, foto: publicada(foto) }, foto));

    // Avisos útiles: las que pesan de más (sin sharp) y las que son chicas.
    const chicas = [];
    for (const f of [...sueltas, ...pares]) {
        const archivo = f.foto || f.despues;
        const pesa = Math.round(statSync(path.join(DIST, 'trabajos', archivo)).size / 1024);
        if (pesa > PESO_MAXIMO_FOTO_KB) avisar(`"${archivo}" pesa ${pesa} KB: con datos móviles tarda en salir.`, `trabajos/${archivo}`);
        if (f.w && Math.max(f.w, f.h) < LADO_MINIMO_PANTALLA_COMPLETA) chicas.push(archivo);
    }
    if (chicas.length) {
        avisar(`${chicas.length} foto(s) miden menos de ${LADO_MINIMO_PANTALLA_COMPLETA} px (${chicas.slice(0, 6).join(', ')}${chicas.length > 6 ? '…' : ''}): no se usan de fondo en el inicio porque se verían borrosas (sí salen en el menú). Sube la original del teléfono si quieres que salgan.`);
    }
    return {
        pares: pares.sort((x, y) => x.n - y.n),
        sueltas: sueltas.sort((x, y) => x.n - y.n)
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

    const sharp = await cargarSharp();
    if (!sharp) {
        // En GitHub NUNCA se publica sin esto: se publicarían las fotos con la
        // ubicación GPS de donde se tomaron. En la tablet sólo se avisa.
        if (EN_ACTIONS) throw new Error('No se pudo cargar sharp (la herramienta de fotos): no se publica para no subir fotos con su ubicación GPS.');
        avisar('Sin la herramienta de fotos (sharp) las fotos se copian tal cual: sin achicar y con sus datos de ubicación. Está bien para probar en la tablet; en GitHub sí se optimizan.');
    }
    await optimizarFotos(sharp, 'fondos');
    const fotos = listaDeFotos(await optimizarFotos(sharp, 'trabajos'));
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
