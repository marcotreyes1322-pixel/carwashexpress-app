// =====================================================================
// SERVIDOR LOCAL para probar la app en la tablet (Termux) o en la compu.
//
//   npm run servir            → la app tal como está en el repo: http://localhost:3000
//   npm run ver-construida    → la versión construida (dist/):    http://localhost:3001
//
// ¿Por qué no abrir index.html directo? Porque abierto como archivo (file:// o
// content://) el navegador NO deja usar el GPS, el modo sin internet ni App
// Check. Servido desde "localhost" sí: el navegador lo trata como seguro, igual
// que la dirección https:// publicada. Así lo que se prueba es lo que ve el cliente.
//
// Sin dependencias: sólo Node, para que funcione en Termux sin instalar nada más.
// =====================================================================
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TIPOS = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8'
};

export function servir(carpeta, puerto = 3000, host = '127.0.0.1') {
    const raiz = path.resolve(carpeta);
    const servidor = http.createServer((req, res) => {
        let ruta;
        try { ruta = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
        catch { res.writeHead(400).end(); return; }
        if (ruta.endsWith('/')) ruta += 'index.html';
        const archivo = path.join(raiz, ruta);
        // Nada fuera de la carpeta (…/../../algo)
        if (archivo !== raiz && !archivo.startsWith(raiz + path.sep)) { res.writeHead(403).end(); return; }
        let datos;
        try { datos = statSync(archivo); } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No existe'); return; }
        if (datos.isDirectory()) { res.writeHead(301, { Location: ruta + '/' }).end(); return; }
        res.writeHead(200, {
            'Content-Type': TIPOS[path.extname(archivo).toLowerCase()] || 'application/octet-stream',
            'Content-Length': datos.size,
            // Siempre pregunta: al probar, lo último que guardaste es lo que se ve.
            'Cache-Control': 'no-cache'
        });
        if (req.method === 'HEAD') { res.end(); return; }
        createReadStream(archivo).pipe(res);
    });
    return new Promise((resolver, fallar) => {
        servidor.once('error', fallar);
        servidor.listen(puerto, host, () => resolver(servidor));
    });
}

// Uso directo: node scripts/servidor.mjs [carpeta] [puerto]
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const carpeta = process.argv[2] || '.';
    const puerto = Number(process.argv[3]) || 3000;
    servir(carpeta, puerto).then(() => {
        console.log(`Sirviendo ${path.resolve(carpeta)}`);
        console.log(`Abre en el navegador: http://localhost:${puerto}   (Ctrl+C para detener)`);
    }).catch(e => {
        console.error(e.code === 'EADDRINUSE'
            ? `El puerto ${puerto} ya está ocupado (¿ya hay otro servidor abierto?).`
            : e.message);
        process.exit(1);
    });
}
