/* =====================================================================
   SERVICE WORKER — el que hace que la app abra SIN INTERNET.
   =====================================================================
   Qué es, en español: un pedacito de código que el navegador deja
   corriendo aparte de la página. Se mete entre la app y la red, y puede
   contestar con una copia guardada cuando no hay señal.

   Para qué sirve aquí: hoy, sin internet, la app no abre. Con esto, una
   vez que el cliente la abrió una vez, vuelve a abrir aunque esté en un
   sótano — y arranca al instante, sin volver a bajar los 390 KB.

   ⚠️ REGLA IMPORTANTE: la caché guarda el archivo VIEJO. Si no se sube el
   número de VERSION en cada entrega, Tristán y sus clientes seguirían
   viendo la versión anterior aunque el servidor ya tenga la nueva. Es el
   error clásico de las PWA y es justo el problema que ya nos pasó a mano.
   ===================================================================== */

const VERSION = 'cwe-2026.08.16a';

// Lo mínimo para que la app abra sin red. Las librerías (Mapbox, Firebase,
// Three.js) NO se guardan a propósito: pesan 2 MB, cambian por su cuenta, y
// sin internet tampoco servirían de nada (no hay mapa ni base de datos).
const ARCHIVOS = [
  './',
  './index.html',
  './manifest.json',
  './icono-192.png',
  './icono-512.png'
];

self.addEventListener('install', evento => {
  evento.waitUntil(
    caches.open(VERSION)
      .then(cache => cache.addAll(ARCHIVOS))
      // Si algún archivo falla, mejor instalar lo que se pueda que no
      // instalar nada: la app sigue funcionando con red.
      .catch(err => console.warn('SW: no se pudo guardar todo:', err))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', evento => {
  // Se borran las cachés de versiones anteriores. Sin esto se irían
  // acumulando copias viejas ocupando espacio en la tablet del cliente.
  evento.waitUntil(
    caches.keys()
      .then(nombres => Promise.all(
        nombres.filter(n => n !== VERSION).map(n => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', evento => {
  const pedido = evento.request;

  // Sólo se toca lo NUESTRO y sólo lecturas. Las llamadas a Firebase y a
  // Mapbox tienen que pasar derecho: guardar una respuesta de la base de
  // datos serviría citas viejas, que es peor que no servir nada.
  if (pedido.method !== 'GET') return;
  const url = new URL(pedido.url);
  if (url.origin !== self.location.origin) return;

  // "Primero la red, y si no hay, lo guardado". Al revés (primero la
  // caché) la app abriría más rápido pero mostraría la versión vieja
  // hasta la siguiente vez — y ya vimos lo confuso que es eso.
  evento.respondWith(
    fetch(pedido)
      .then(respuesta => {
        const copia = respuesta.clone();
        caches.open(VERSION).then(cache => cache.put(pedido, copia)).catch(() => {});
        return respuesta;
      })
      .catch(() => caches.match(pedido).then(r => r || caches.match('./index.html')))
  );
});
