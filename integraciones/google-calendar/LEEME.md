# Citas de la app → Google Calendar (automático)

Cada 5 minutos, un programa en **tu** cuenta de Google lee las citas de la app
y las deja en un calendario llamado **"Car Wash Express"**:

| En la app | En el calendario |
|---|---|
| Cita nueva | Aparece el evento, con aviso 1 hora antes |
| Cita reagendada | El mismo evento se mueve |
| Cita cancelada | El evento se borra |
| Marcada como completada | Le sale ✅ y se pone verde |
| Marcada como "no se hizo" | Le sale ❌ y se pone gris |

Cada evento trae el cliente, su WhatsApp (se toca y abre el chat), el auto, el
servicio y los extras, la toma de corriente, la referencia, la ubicación
(se toca y abre Maps), el total y el folio. Los lavados salen en azul y los
detallados en morado, y ocupan el día entero (o dos días, si es Completo).

**TimeTree** lo muestra solo, porque lee los calendarios del teléfono.

> ⚠️ El calendario lo escribe el programa. Si mueves un evento a mano, se
> regresa a como está en la app la próxima vez que esa cita cambie. **Los
> cambios se hacen en la app.** Si borras un evento a mano, vuelve a aparecer
> en 5 minutos (mientras la cita siga en la app).

No cuesta nada ni hay que guardar contraseñas: corre con tu permiso de dueño
del proyecto de Firebase.

---

## Instalación (una sola vez, ~10 minutos)

Hazlo en la computadora o en la tablet con Chrome en **"Sitio para
computadoras"** (⋮ → Sitio para computadoras). En el celular, el editor es
muy incómodo.

### 1. Abre Apps Script con la cuenta correcta

1. Entra a **https://script.google.com**.
2. Revisa la foto de arriba a la derecha: tiene que ser **la misma cuenta con
   la que entras a la consola de Firebase** (la dueña del proyecto
   `carwashexpress`). Si no, cámbiala ahí mismo.
3. Toca **Nuevo proyecto**.
4. Arriba, donde dice "Proyecto sin título", ponle **Car Wash Express →
   Calendario**.

### 2. Pega el programa

1. Borra todo lo que trae el archivo `Código.gs` (tres renglones de ejemplo).
2. Abre este enlace, selecciona todo y cópialo:
   https://raw.githubusercontent.com/marcotreyes1322-pixel/carwashexpress-app/main/integraciones/google-calendar/Codigo.gs
3. Pégalo en `Código.gs` y toca 💾 **Guardar**.

### 3. Pega los permisos (manifiesto)

1. A la izquierda, toca ⚙️ **Configuración del proyecto**.
2. Marca **"Mostrar el archivo de manifiesto «appsscript.json» en el editor"**.
3. Regresa al editor (ícono `< >` de la izquierda). Ya aparece
   `appsscript.json`: ábrelo y borra lo que trae.
4. Abre este enlace, cópialo todo y pégalo ahí:
   https://raw.githubusercontent.com/marcotreyes1322-pixel/carwashexpress-app/main/integraciones/google-calendar/appsscript.json
5. Revisa que termine en la **línea 12** con `}`. Si hay una línea 13 con
   otra `}` en rojo (se queda de lo que traía el archivo), bórrala. Que los
   renglones salgan "en escalera" no importa.
6. 💾 **Guardar**. Arriba debe dejar de decir "Cambios sin guardar".

### 4. Enciéndelo

1. Toca `Código.gs` en la lista de archivos de la izquierda. **Los botones
   ▷ Ejecutar y la lista de funciones sólo aparecen con un archivo `.gs`
   abierto**; con `appsscript.json` abierto no salen.
2. Si `Código.gs` tiene un circulito naranja junto al nombre, falta guardarlo:
   💾 **Guardar**. Si al guardar sale un error rojo con un número de línea,
   algo se pegó mal: vuelve a copiar y pegar el archivo completo.
3. En la barra de arriba, junto a **▷ Ejecutar** y **Depurar**, hay una lista
   de funciones: elige **instalar**.
4. Toca **▷ Ejecutar**.
5. Google pide permiso (es normal, el programa es tuyo):
   1. **Revisar permisos** → elige tu cuenta.
   2. Sale "Google no verificó esta app": toca **Configuración avanzada** →
      **Ir a Car Wash Express → Calendario (no seguro)** (sale el nombre
      que le pusiste al proyecto; si no le cambiaste el nombre, dice
      "Proyecto sin título").
   3. Si salen casillas, marca **Seleccionar todo** (si falta una, el
      programa no puede trabajar) y toca **Continuar**. Si sale un botón
      **Permitir**, tócalo.
6. Abajo, en el **Registro de ejecución**, debe salir:
   `✅ Listo. Calendario "Car Wash Express". Se revisa cada 5 minutos...`

Listo: ya corre solo, aunque cierres la página y apagues la computadora.

### 5. Velo en el teléfono

1. **Google Calendar** (app): ☰ menú → baja hasta tu cuenta → marca
   **Car Wash Express**. Si no aparece, en ⚙️ Configuración → tu cuenta →
   activa la sincronización de ese calendario.
2. **Zona horaria** (importante): entra a **calendar.google.com** →
   ⚙️ Configuración → **Zona horaria** → **(GMT-06:00) Chihuahua** (o Ciudad
   de México). Si está en "UTC", en la computadora las citas salen 6 horas
   después.
3. **TimeTree**: en su configuración, activa que muestre los calendarios del
   teléfono (o "otros calendarios") y marca **Car Wash Express**.

> ¿Quieres que alguien más lo vea (un ayudante, tu pareja)? En
> calendar.google.com → Car Wash Express → ⋮ → **Configuración y uso
> compartido** → **Compartir con personas específicas**. Ojo: los eventos traen
> teléfonos y domicilios de tus clientes; compártelo sólo con quien lo necesite.

---

## Si algo sale mal

| Qué ves | Qué hacer |
|---|---|
| `Firebase contestó 401` o `403` | La cuenta no es dueña del proyecto de Firebase. Entra a script.google.com con la cuenta correcta, o agrega esa cuenta en la consola de Firebase → ⚙️ → **Usuarios y permisos** como **Propietario** o **Editor**. Después corre **instalar** otra vez |
| No aparecen eventos | Tienen que ser citas de hoy en adelante (o de la última semana). En Apps Script, ícono ☰▶ **Ejecuciones** a la izquierda: ahí sale cada vuelta y si hubo error |
| Te llega un correo "Summary of failures" de Google | El programa falló 3 veces seguidas (15 min). Abre **Ejecuciones** y mira el mensaje. Si es un error de internet, se arregla solo |
| `Por seguridad no se borró nada` | Firebase contestó vacío, lo cual nunca pasa en un negocio con citas. El programa no borró nada y lo reintenta en 5 minutos |
| Quieres apagarlo | En `Código.gs` elige la función **desinstalar** → ▷ Ejecutar. Los eventos que ya están se quedan |

**Antes de activar App Check en modo "Aplicar"** (pendiente de la
auditoría): al día siguiente de activarlo, revisa **Ejecuciones**. Si sale
`401` o `403`, regrésalo a "Supervisión" y avísame.

---

## Para actualizar el programa

Si cambia `Codigo.gs` en GitHub: abre el proyecto en script.google.com, borra
`Código.gs`, pega el nuevo y 💾 **Guardar**. El reloj de 5 minutos sigue
igual; no hace falta correr **instalar** otra vez, salvo que también cambie
`appsscript.json`.

---

## Para el que programa

- `Codigo.gs` y `appsscript.json` corren en Google Apps Script (V8), **no** en
  la app, y no se publican en GitHub Pages.
- **Lectura de Firebase:** `ScriptApp.getOAuthToken()` contra la API REST
  (`/ordenes.json?access_token=...`), con los permisos `firebase.database` y
  `userinfo.email`. Ese permiso de dueño no pasa por las reglas de la base:
  sólo lee, nunca escribe.
- **Qué evento es de qué cita:** se guarda en las Propiedades del script
  (`cita:<id>` → id del evento, huella y último día). Si la huella no cambia,
  el evento no se vuelve a escribir.
- **Horario:** sale de `agendaDia` + `agendaHora` + paquete, con la misma regla
  que `huecosQueOcupa` de la app. `huecosOcupados` sólo se usa si la hora no
  se entiende.
- **Seguros:**
  - Si Firebase falla, la vuelta se detiene antes de tocar el calendario.
  - Si la base contesta vacía con 3 o más citas por venir, no se borra nada.
  - Una cita con datos raros no frena a las demás, y su evento no se borra.
  - Las fallas sueltas no mandan correo; desde la 3ª seguida, sí.
- **Pruebas:** `npm run prueba-calendario` corre este mismo `Codigo.gs` con un
  Google simulado (Calendar, Firebase, propiedades y reloj) por todos los
  casos. Corre en cada push (Actions).
