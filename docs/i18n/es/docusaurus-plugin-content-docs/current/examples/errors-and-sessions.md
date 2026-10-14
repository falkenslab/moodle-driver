# Errores y sesiones caducadas {#handling-errors-and-expired-sessions}

Un programa que se ejecuta durante mucho tiempo, o sin nadie delante, se encuentra con una sesión caducada, un navegador que aún se está descargando, un servidor sin pantalla y las negativas de Moodle. Esta página muestra un programa que maneja cada uno de esos casos y siempre cierra el navegador, para programadores que escriben algo más largo que un script de usar y tirar.

**Usa:** [Errores](../concepts/errors.md), [Iniciar sesión](../getting-started/logging-in.md), [El navegador](../concepts/browser.md), [El objeto Moodle y las funciones](../concepts/calling-functions.md), [Cursos](../areas/courses.md).

## El programa {#the-program}

```ts
import { setTimeout as sleep } from "node:timers/promises";
import {
  createMoodle,
  BrowserDownloadingError,
  LoginTimeoutError,
  LoginWindowClosedError,
  MoodleError,
  MoodleServiceError,
  NoDisplayError,
  NotLoggedInError,
  type Moodle,
} from "@falkenslab/moodle-driver";

// Ejecuta un paso; si la sesión de Moodle terminó, vuelve a iniciar sesión (se abre una ventana) y lo reintenta una vez.
async function withSession<T>(moodle: Moodle, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (!(error instanceof NotLoggedInError)) throw error;
    console.error("La sesión de Moodle ha terminado: vuelve a iniciar sesión en la ventana que se abre.");
    await moodle.logIn();
    return await step();
  }
}

// La primera llamada puede empezar a descargar Chromium en segundo plano: espera y vuelve a intentarlo.
async function whenBrowserReady<T>(step: () => Promise<T>, attempts = 10): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await step();
    } catch (error) {
      if (!(error instanceof BrowserDownloadingError) || attempt === attempts) throw error;
      console.error(`Descargando un navegador (intento ${attempt} de ${attempts}), se reintenta en 30 segundos...`);
      await sleep(30_000);
    }
  }
}

async function main(): Promise<void> {
  // `await using` cierra el navegador (guardando la sesión) cuando main() termina, también si hay un error.
  await using moodle = createMoodle({
    site: process.env.MOODLE_URL ?? "https://campus.example.org/",
    profileDir: `${process.env.HOME}/.config/pending-report/moodle-profile`,
    headless: true,
    downloadBrowser: true,
    loginTimeoutMs: 3 * 60_000,
  });
  // Al instante con una sesión guardada; si no, una ventana de inicio de sesión, cuando el navegador ya está.
  const me = await whenBrowserReady(() => moodle.logIn());
  console.log(`${me.fullName} (${me.status})`);

  const courses = await withSession(moodle, () => moodle.listCourses("inprogress"));
  for (const course of courses) {
    // Cada paso por separado: una sesión que termina a mitad cuesta un reintento, no la ejecución entera.
    const { pending } = await withSession(moodle, () => moodle.pendingActivities(course.id));
    console.log(`${course.fullname}: ${pending.length} pendientes`);
  }
}

try {
  await main();
} catch (error) {
  process.exitCode = 1;
  if (error instanceof NoDisplayError) console.error("No hay pantalla en la que iniciar sesión: inicia sesión una vez en un ordenador con este perfil y copia aquí el perfil.");
  else if (error instanceof LoginTimeoutError || error instanceof LoginWindowClosedError) console.error("Nadie inició sesión: vuelve a ejecutarlo cuando puedas.");
  else if (error instanceof MoodleServiceError) console.error(`Moodle rechazó ${error.methodname} (${error.errorcode}): ${error.message}`);
  else if (error instanceof MoodleError) console.error(`[${error.code}] ${error.message}`);
  else throw error; // Un fallo del programa, no algo que dijo Moodle: que se caiga con su traza.
}
```

## Paso a paso {#step-by-step}

1. `withSession` envuelve un paso del programa. Cuando lanza `NotLoggedInError` (la sesión caducó, o la persona cerró la sesión en otro sitio), llama a `moodle.logIn()`, que abre una ventana en la página de acceso del sitio, y ejecuta el paso una vez más. Un segundo `NotLoggedInError` se propaga: algo más va mal.
2. `whenBrowserReady` se ocupa de la primera ejecución en un ordenador sin Edge ni Chrome: con `downloadBrowser: true`, la primera llamada empieza a descargar Chromium y lanza `BrowserDownloadingError` al instante, y lo mismo las siguientes llamadas hasta que termina la descarga. El programa espera y vuelve a intentarlo.
3. `await using moodle = createMoodle(...)` hace desechable el objeto: cuando `main()` vuelve o lanza, se ejecuta `moodle.close()`, que guarda las cookies de la sesión en el perfil y cierra el navegador. No hace falta `finally`.
4. `logIn()` responde al instante con `already-logged-in` cuando el perfil tiene una sesión; si no, la persona inicia sesión a mano, dentro de `loginTimeoutMs`.
5. Todas las lecturas pasan por `withSession`, paso a paso, así que una caducidad en mitad de un bucle largo cuesta un inicio de sesión y un reintento.
6. El `catch` exterior se ejecuta con el navegador ya cerrado. Convierte los errores del driver en mensajes para la persona: por clase los que el programa trata, por `code` el resto. Los errores que no son `MoodleError` son fallos del propio programa y se propagan.

## Lo que imprime {#what-it-prints}

Una ejecución de ejemplo cuya sesión caducó entre dos cursos:

```text
Ada Lovelace (already-logged-in)
Programación 1: 3 pendientes
La sesión de Moodle ha terminado: vuelve a iniciar sesión en la ventana que se abre.
Bases de datos: 0 pendientes
Diseño web: 5 pendientes
```

## Variaciones {#variations}

- Comparar por `error.code` en vez de por clase (`error.code === "not-logged-in"`) cuando el error puede venir de otro bundle del driver: `instanceof` necesita la misma copia de la clase, el código no.
- Un programa desatendido (una tarea nocturna) no debería abrir una ventana de inicio de sesión que nadie va a ver: captura `NotLoggedInError` e informa de que hay que "volver a iniciar sesión" en vez de reintentar, o comprueba antes `canShowWindow()`.
- Reintenta las lecturas sin problema. En las escrituras que crean algo (un mensaje, una actividad), lee el estado antes de reintentar: la escritura puede haberse hecho antes de que fallara la comprobación de la sesión.
- Sin `await using` (un TypeScript más antiguo, un entorno de ejecución que no lo tiene), llama a `await moodle.close()` en un `finally`, como en [Tu primer programa](../getting-started/first-program.md).

## Cuando algo sale mal {#when-something-goes-wrong}

- `NotLoggedInError` dos veces seguidas: el inicio de sesión funcionó pero el sitio termina la sesión al instante (una política de sesión única, la persona inició sesión en otro sitio). Cierra la otra sesión.
- `NoDisplayError`: en Linux sin `DISPLAY` ni `WAYLAND_DISPLAY` (un servidor, un contenedor) el driver no abre la ventana de inicio de sesión. Inicia sesión donde haya pantalla con la misma carpeta de perfil y copia el perfil; consulta [Iniciar sesión](../getting-started/logging-in.md).
- `BrowserNotFoundError`: no hay Edge ni Chrome, y `downloadBrowser` es `false`. Instala uno, o permite la descarga.
- `BrowserDownloadingError` tras todos los intentos: la descarga es lenta o está fallando; `moodle.browser.chromiumDownload()` dice `"failed"` cuando falló (se reintenta en la siguiente llamada).
- `MoodleServiceError` con `nopermissions`: la persona no puede hacer eso en Moodle. El driver no tiene permisos propios; consulta [Errores](../concepts/errors.md).

## Datos que toca {#data-it-touches}

Solo los cursos y las actividades pendientes de la propia persona: las [categorías de datos](../concepts/data-categories.md) `own` y `course-content`. Manejar errores e iniciar sesión no tocan nada de nadie (`none`).
