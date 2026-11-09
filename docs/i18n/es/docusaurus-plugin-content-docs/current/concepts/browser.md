# El navegador

`createMoodle()` crea un `BrowserManager` a partir de sus opciones (es `moodle.browser`), o toma el tuyo; `createBrowserManager(options)` crea uno por su cuenta. Es el único navegador persistente con el que tu programa trabaja en Moodle. No lanza nada hasta que hace falta, mantiene el navegador abierto entre llamadas y lo cierra con `close()`.

**Términos:** [perfil](../reference/glossary.md#profile), [pestaña de trabajo](../reference/glossary.md#working-tab), [mostrado bajo demanda](../reference/glossary.md#shown-on-demand).

## Opciones {#options}

```ts
interface BrowserOptions {
  /** La carpeta del perfil persistente donde la persona inicia sesión. */
  profileDir: string;
  /** Un canal, o undefined para Edge, después Chrome, después (con downloadBrowser) Chromium. */
  channel?: "msedge" | "chrome" | "chromium" | "firefox";
  /** Sin ventana, salvo que se pida una (al iniciar sesión) o se muestre bajo demanda. */
  headless: boolean;
  /** Descarga el Chromium de Playwright (o Firefox, si se elige) cuando no funciona ningún navegador instalado. */
  downloadBrowser: boolean;
  /** Cuántos fallos de un navegador se toleran en esta ejecución antes de preferir otro instalado; undefined: nunca. */
  switchAfterCrashes?: number;
}
```

El gestor lee las opciones cada vez que lanza el navegador, así que un programa puede cambiarlas en el mismo objeto entre lanzamientos (otro perfil, otro canal) y cerrar el navegador para aplicarlas.

## El gestor {#the-manager}

| Método | Qué hace |
| --- | --- |
| `context({ headed? })` | El `BrowserContext` abierto, lanzando el navegador si hace falta. `headed: true` relanza con ventana un navegador sin ventana; una petición sin ventana reutiliza una ventana ya abierta en lugar de cerrársela a la persona. |
| `close()` | Guarda las cookies de sesión y cierra el navegador. |
| `saveSession()` | Guarda ahora las cookies de sesión del navegador abierto (iniciar sesión lo hace). |
| `visible()` | Si el navegador muestra ahora una ventana. |
| `setVisible(visible)` | Muestra el navegador (relanzándolo con ventana, conservando la sesión) y sigue las páginas que abren las funciones, o lo oculta. |
| `show(url)` | Mientras se muestra, trae al frente de la ventana una página del sitio; nunca lanza errores. |
| `tab()` | La única pestaña de trabajo que un programa maneja por sí mismo, abriendo el navegador si hace falta. |
| `openChannel()` | El canal del navegador abierto, o `undefined`. |
| `chromiumDownload()` | `"downloading"`, `"failed"` o `undefined`. |

Las llamadas al gestor se ejecutan una a una: un lanzamiento y un relanzamiento nunca se solapan sobre el perfil.

## Elegir un navegador {#choosing-a-browser}

Sin `channel`, el gestor prueba Edge, después Chrome y después (solo con `downloadBrowser: true`) el Chromium de Playwright. Cuando no hay ninguno instalado y no se permite descargar, lanza `BrowserNotFoundError`. Si se permite descargar, la primera llamada inicia la descarga en segundo plano y lanza `BrowserDownloadingError` al momento; las llamadas siguientes también lo lanzan hasta que termina la descarga (unos minutos), y entonces lanzan Chromium. Una descarga fallida se reintenta en la siguiente llamada, y mientras tanto `chromiumDownload()` informa de `"failed"`.

`channel: "firefox"` lanza en su lugar la versión de Firefox propia de Playwright, nunca el Firefox del sistema (Playwright no puede manejarlo); solo se lanza cuando se elige. Se descarga la primera vez que hace falta de la misma forma cuando `downloadBrowser` es `true` (`chromiumDownload()` también informa de esa descarga), y sin ella un Firefox que falta lanza `BrowserNotFoundError`. Firefox guarda su propio tipo de perfil, así que dale un `profileDir` propio en lugar de uno que haya usado un navegador basado en Chromium. Un navegador en segundo plano (más abajo) no puede ser Firefox: se ofrece con el protocolo de depuración de Chromium, y `hostBrowser` lo rechaza.

## Mostrar el navegador {#showing-the-browser}

Puede que una persona quiera ver lo que hace un programa, o intervenir (una página pregunta algo que solo ella puede responder). `setVisible(true)` relanza el navegador con ventana, conservando la sesión, y desde ese momento las páginas que abren las funciones se muestran, una tras otra, en una única pestaña de trabajo de esa ventana ("seguimiento"). Cuando un método del objeto `Moodle` termina bien, deja en esa pestaña la página que muestra su resultado, después de las páginas en las que ha trabajado. Una creación muestra lo que ha creado, no el formulario con el que lo creó: `createActivity` muestra la actividad nueva. Una edición muestra el elemento, o la página que lo lista, y una lectura la página que lee. Un método que trabaja con los servicios AJAX de Moodle (`listCourses`, `courseStructure`, `gradeSubmission`…) también muestra esa página, aunque no haya abierto ninguna. Mostrarla es una cortesía: nunca hace fallar ni cambia la llamada, y mientras el navegador está oculto no se carga nada para ello. `FOLLOWED_PAGES` da la página de cada método, una ruta relativa al sitio construida a partir de los argumentos y el resultado de la llamada, con ventana o sin ella: un programa puede enlazar a la persona con ella con `new URL(FOLLOWED_PAGES.createActivity(args, result), site)`. `UNFOLLOWED_METHODS` lista los métodos sin página que mostrar (una descarga de un archivo, un valor sin página propia). `setVisible(false)` cierra la ventana; la siguiente llamada vuelve a ejecutarse sin ventana. Si la persona cierra la ventana ella misma, el gestor lo nota: la siguiente llamada vuelve a abrir el navegador, sin ventana.

Un navegador también puede fallar durante una llamada. Un método de `Moodle` que solo lee abre otro y se ejecuta de nuevo, una vez. Lo que haya podido cambiar Moodle no se repite: falla con `BrowserLostError`, porque lo que estaba enviando puede haber llegado, y enviar un formulario dos veces crea dos veces lo mismo. Por defecto, el driver sigue con el mismo navegador tras un fallo. Con `switchAfterCrashes: n` en las opciones, y sin `channel`, un navegador que ha fallado `n` veces en esta ejecución pasa detrás de los demás instalados en los siguientes arranques, con el mismo perfil. Edge y Chrome conservaron la sesión del otro en la única configuración en que se probó (Windows 11, noviembre de 2026), así que compruébalo en la tuya. Una ventana que cierra la persona no cuenta como fallo.

En Linux una ventana necesita `DISPLAY` o `WAYLAND_DISPLAY`; sin ellas (un servidor, un contenedor), pedir una lanza `NoDisplayError` en lugar de intentarlo. `canShowWindow()` lo dice de antemano.

## La pestaña de trabajo {#the-working-tab}

Algunas cosas no se pueden hacer mediante una función: reproducir una actividad H5P, hacer un paquete SCORM (`openScorm` abre su reproductor aquí), una página que el driver no cubre, algo que una persona debería ver. `tab()` da la pestaña de trabajo del navegador, una `Page` de Playwright que el programa maneja como quiera, con la sesión iniciada. Es la misma pestaña que usa el seguimiento mientras se muestra el navegador, así que la persona la ve.

```ts
const tab = await moodle.tab();
await tab.goto(`${moodle.site}mod/h5pactivity/view.php?id=38`);
// ...maneja el contenido H5P en sus iframes con Playwright...
```

Déjala abierta: el gestor la reutiliza.

## Un navegador abierto en segundo plano {#a-browser-left-open-in-the-background}

`moodle open` mantiene un navegador abierto en un perfil para todos los comandos de ese perfil (consulta [la línea de comandos](../getting-started/command-line.md#watching-separate-commands-act)). Un programa también puede trabajar en ese navegador, en lugar de lanzar uno sobre el mismo perfil (lo que fallaría: un perfil está abierto en un solo navegador cada vez). `backgroundBrowser(profileDir)` lee dónde está y su token del `.browser.json` del perfil (`undefined` cuando no hay ninguno en marcha, y elimina un archivo obsoleto), y `connectBrowserManager()` da un gestor sobre él para `createMoodle`:

```ts
import { backgroundBrowser, connectBrowserManager, createMoodle, siteProfileDir } from "@falkenslab/moodle-driver";

const site = "https://campus.example.org/";
const profileDir = siteProfileDir(site);
const running = await backgroundBrowser(profileDir);
if (!running) throw new Error("Ejecuta antes `moodle open --show`.");

const moodle = createMoodle({ site, browser: connectBrowserManager({ ...running, profileDir }) });
console.log(await moodle.listCourses());
await moodle.close(); // se desconecta: el navegador sigue abierto
```

El gestor conectado trabaja en el propio contexto del navegador, y `close()` guarda la sesión y se desconecta. No puede añadir ni quitar una ventana a un navegador que no lanzó: si tiene una, las páginas que abren las funciones se siguen en su primera pestaña, y `setVisible(true)` en uno sin ventana lanza `NoDisplayError`. El navegador acepta un cliente cada vez; otro que se conecte mientras tanto es rechazado. Nada se conecta sin el token de `.browser.json`, que solo puede leer la persona: el puerto de depuración del propio Chromium, que no tiene esa comprobación, no se abre nunca.

## La sesión en disco {#the-session-on-disk}

El perfil guarda las cookies y el almacenamiento del navegador. Chromium descarta las cookies de sesión (las que no tienen fecha de caducidad, como `MoodleSession` de Moodle) al cerrarse, así que el gestor las escribe en un archivo dentro del perfil (`SESSION_COOKIES_FILE`, legible solo por el usuario) con `close()`, `saveSession()` y después de iniciar sesión, y las restaura al lanzarse. Trata toda la carpeta del perfil como un secreto.

## Varios sitios, varias cuentas {#several-sites-several-accounts}

Un perfil puede guardar sesiones en varios sitios a la vez: la cookie de sesión de Moodle (`MoodleSession`) pertenece al host y a la ruta del sitio, así que los sitios en hosts distintos, o en rutas distintas de un mismo host (la ruta predeterminada de la cookie de Moodle es la del propio sitio), no se sobrescriben entre sí. Dos objetos `Moodle` pueden entonces compartir un navegador, `createMoodle({ site: other, browser: moodle.browser })`, con la persona iniciando sesión una vez en cada sitio. El driver guarda la `sesskey` de un solo sitio por navegador cada vez, así que alternar sitios en un navegador vuelve a leer la página de la sesión en cada cambio (una petición más), nada más. Dos cuentas en el mismo sitio comparten esa cookie, así que cada una necesita su propio perfil (`siteProfileDir` da nombre a uno por sitio y cuenta para el comando `moodle`). Esto se deduce de cómo guardan las sesiones el driver y Moodle, no de una prueba con dos sitios.

## Tiempos de espera {#timeouts}

Las navegaciones esperan hasta 60 segundos: las primeras páginas después de que arranque un sitio, o un guardado que hace que Moodle recalcule calificaciones, pueden tardar.
