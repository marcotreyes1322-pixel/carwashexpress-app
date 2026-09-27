# Cómo probar y publicar la app

**En corto:** editas, haces `git push` a `main` y GitHub se encarga del resto:
construye la versión optimizada, la revisa, la abre en un Chrome de verdad y,
si todo sale bien, la publica. Tarda unos 3 minutos. **Ya no hay que subir el
número de versión a mano.**

---

## Una sola vez, en GitHub

**Settings → Pages → Build and deployment → Source: `GitHub Actions`**

Mientras no se cambie, Pages sigue publicando los archivos de la rama tal
cual (sin optimizar) y cada corrida de `main` deja un aviso amarillo que lo
recuerda. La app funciona igual en los dos casos; con el cambio, el teléfono
del cliente baja la mitad.

---

## En la tablet (Termux)

**Instalar (una vez):**

```bash
pkg install nodejs git
cd ~/carwashexpress-app
npm install
```

**Probar lo que estás editando:**

```bash
npm run servir
```

Abre **http://localhost:3000** en el Chrome de la tablet. Así sí funcionan el
GPS, el modo sin internet y App Check. Abriendo `index.html` directo (como
archivo) el navegador los bloquea, y lo que ves no es lo que ve el cliente.

**Ver la versión optimizada, tal como se va a publicar:**

```bash
npm run construir
npm run ver-construida      # → http://localhost:3001
```

**Revisar antes de subir** (construye y busca errores en el código):

```bash
npm run revisar
```

La prueba de humo, que necesita Chrome de escritorio, corre sola en GitHub.

**Atajos** (agrégalos al final de `~/.bashrc`):

```bash
alias cw='cd ~/carwashexpress-app'
alias cws='npm run servir'
alias cwr='npm run revisar'
cwp() { git add -A && git commit -m "$*" && git push; }   # uso: cwp "cambié el precio del básico"
```

---

## ¿Salió bien? (se ve desde el celular)

- Pestaña **Actions** del repositorio: ✅ o ❌ en cada push.
- Al tocar una corrida sale el **resumen**: cuánto pesa la app, cuántas fotos
  encontró, avisos, y qué revisión falló si algo falló. Abajo está el
  artefacto **capturas**, con la app en 4 tamaños de pantalla.
- Un aviso amarillo que dice **"Node.js 20 is deprecated"** es de las
  herramientas de GitHub (se arregla solo cuando GitHub las actualice), no de
  la app: se puede ignorar.
- ¿La app se queda "cargando" o dice que no se pudo conectar? En **Actions →
  Diagnóstico Firebase → Run workflow** GitHub abre la app con internet de
  verdad y dice si reCAPTCHA, App Check y la base de datos conectan. Si ahí
  todo sale bien, el problema está en el teléfono, no en la app.
- Para confirmar qué versión está publicada, abre
  `https://marcotreyes1322-pixel.github.io/carwashexpress-app/version.json`.
  Es la misma que ve Tristán junto al logo al entrar con su número.

---

## Fotos de trabajos

Van en la carpeta **`trabajos/`**. Salen en el fondo del inicio (una cada
3 segundos, la más nueva primero) y en el menú.

**Sube las fotos ORIGINALES del teléfono, tal cual**, aunque sean HEIC del
iPhone. No hace falta achicarlas, convertirlas ni renombrarlas. Antes de
publicar, GitHub:
- convierte las HEIC a JPG;
- las deja un poco más grandes que la pantalla de cualquier teléfono, en vertical (1620×2880):
  nítidas a pantalla completa y sin pesar de más (la original se queda
  guardada en el repositorio). Las horizontales se recortan a vertical
  quedándose con la parte más llamativa de la foto;
- las endereza si el teléfono las guardó de lado;
- les **borra la ubicación GPS** que guardan los celulares (así no se publica
  dónde se tomó la foto, que suele ser la casa del cliente).

**Cómo subirlas desde el teléfono:** en el navegador (en modo escritorio),
entra a `github.com/marcotreyes1322-pixel/carwashexpress-app/tree/main/trabajos`
→ **Add file → Upload files** → elige las fotos → **Commit changes**. En unos
2 minutos ya salen en la app.

| Nombre | Qué pasa |
|---|---|
| Cualquiera, por ejemplo `IMG_4521.JPG` | Se acomoda por fecha de subida: la más nueva sale primero |
| `15.jpg` | El número manda: el más alto sale primero |
| `3-antes.jpg` + `3-despues.jpg` | Par antes/después |

- Sirven `.jpg`, `.jpeg`, `.png`, `.webp` y `.heic`.
- **Fotos chicas** (menos de 1000 px en su lado largo, como las que se bajan
  de redes sociales): también salen de fondo. GitHub las agranda con un filtro
  fino y las intercala con las originales, pero se ven menos nítidas que una
  foto directa del teléfono. La corrida de Actions avisa cuáles son; si tienes
  la original, súbela con el mismo nombre.
- Para quitar una foto: ábrela en GitHub → ícono del bote de basura →
  **Commit changes**.

Las fotos del login están en `fondos/` (`1.jpg` a `6.jpg`). Para cambiar
una, sube la nueva con el mismo nombre.

---

## Qué revisa cada push

| Paso | Qué hace | Si falla |
|---|---|---|
| Construir | Minifica, sella la versión (fecha + commit) en la app y en el Service Worker y arma `trabajos/lista.json` | No se publica. El mensaje dice qué faltó |
| Revisar el código | Busca errores que rompen la app sin avisar: variables mal escritas, funciones que no existen | El número de línea es **el mismo de `index.html`** |
| Prueba de humo | Abre la app a 320, 360, 390 y 800 px: errores de JavaScript, cosas cortadas o salidas de lado, botones que llaman funciones inexistentes, versión de la app ≠ del Service Worker, fotos, y que abra sin internet | El resumen dice qué revisión falló, y están las capturas |
| Publicar | Sólo en `main` y sólo si todo lo anterior salió bien | — |
