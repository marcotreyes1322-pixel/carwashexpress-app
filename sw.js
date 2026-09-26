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

const VERSION = 'cwe-2026.09.26d';

// Lo mínimo para que la app abra sin red. Las librerías (Mapbox, Firebase,
// Three.js) NO se guardan a propósito: pesan 2 MB, cambian por su cuenta, y
// sin internet tampoco servirían de nada (no hay mapa ni base de datos).
const ARCHIVOS = [
  './',
  './index.html',
  './manifest.json',
  './icono-192.png',
  './icono-512.png',
  // Los fondos de las DOS pantallas de entrada: el 1 es el primero del login
  // y el 3 es el fijo de Crear cuenta. Sin el 3, Crear cuenta sin señal salía
  // con el fondo negro. Los demás fondos se guardan solos la primera vez que
  // salen en el carrusel.
  './fondos/1.jpg',
  './fondos/3.jpg'
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

// Guarda una copia SÓLO si la respuesta es buena y completa. Antes se
// guardaba cualquier cosa, incluidos los 404 de las fotos que no existen.
function guardarSiSirve(pedido, respuesta) {
  if (respuesta && respuesta.status === 200 && respuesta.type === 'basic') {
    const copia = respuesta.clone();
    caches.open(VERSION).then(cache => cache.put(pedido, copia)).catch(() => {});
  }
  return respuesta;
}

self.addEventListener('fetch', evento => {
  const pedido = evento.request;
  const url = new URL(pedido.url);

  // Sólo se toca lo NUESTRO. Las llamadas a Firebase y a Mapbox tienen que
  // pasar derecho: guardar una respuesta de la base de datos serviría citas
  // viejas, que es peor que no servir nada.
  if (url.origin !== self.location.origin) return;

  // 1) HEAD: así pregunta la app si existe una foto de trabajos, sin bajarla.
  //    Con red contesta el servidor. Sin red, si esa foto ya está guardada, se
  //    contesta "sí existe" para que el carrusel siga saliendo en el sótano.
  if (pedido.method === 'HEAD') {
    evento.respondWith(
      fetch(pedido).catch(() => caches.match(url.href).then(guardada =>
        guardada ? new Response(null, { status: 200, headers: guardada.headers }) : Response.error()))
    );
    return;
  }
  if (pedido.method !== 'GET') return;

  // 2) LA PÁGINA: "primero la red, y si no hay, lo guardado". Así siempre se
  //    ve la versión nueva en cuanto hay señal. Se guarda bajo UNA sola llave
  //    (index.html), así que también abre sin red si se entró por "/", por
  //    "/index.html" o por un enlace con ?algo al final.
  //    (Antes, sin red, a CUALQUIER cosa que faltara —hasta a una foto— se le
  //    contestaba con index.html, y eso era una imagen rota.)
  if (pedido.mode === 'navigate') {
    evento.respondWith(
      fetch(pedido)
        .then(respuesta => {
          if (respuesta.status === 200) {
            const copia = respuesta.clone();
            caches.open(VERSION).then(cache => cache.put('./index.html', copia)).catch(() => {});
          }
          return respuesta;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 3) LO DEMÁS (fotos, fondos, íconos, manifest): lo guardado se entrega AL
  //    INSTANTE y, por detrás, se pide la versión de la red para la próxima.
  //    Antes todo esperaba a la red aunque la foto ya estuviera guardada: con
  //    una rayita de señal, las fotos tardaban en salir aunque ya estuvieran
  //    en el teléfono. (Si Tristán cambia una foto por otra con el MISMO
  //    nombre, la nueva se ve a partir de la siguiente apertura.)
  const deLaRed = fetch(pedido).then(respuesta => guardarSiSirve(pedido, respuesta));
  evento.respondWith(
    caches.match(pedido)
      .then(guardada => guardada || deLaRed)
  );
  // Que el refresco de fondo termine aunque la página ya tenga su respuesta.
  evento.waitUntil(deLaRed.catch(() => {}));
});
