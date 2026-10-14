# H5P

Actividades H5P (módulo `h5pactivity`): qué contiene una actividad (su tipo de contenido H5P y su versión), si Moodle registra los intentos, y los intentos de la propia persona con sus puntuaciones. Los estudiantes leen sus intentos; un profesor lee los mismos datos de la actividad, sin intentos (su informe lista participantes en su lugar). El driver no reproduce contenido H5P: la reproducción ocurre en los iframes del contenido, que un programa maneja por su cuenta en la pestaña de trabajo del navegador.

**Términos:** [h5p](../reference/glossary.md#h5p), [intento](../reference/glossary.md#attempt).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos; las primitivas de más bajo nivel están en `@falkenslab/moodle-driver/internals` (consulta [Bajar de nivel](../concepts/low-level.md)).

Todo se lee de las páginas de Moodle (ids del body, atributos data, la configuración del reproductor, la tabla del informe por posición e icono), así que funciona en cualquier idioma de la interfaz. `h5pActivity` lanza `NotLoggedInError` cuando no hay sesión (consulta [Errores](../concepts/errors.md)).

## h5pActivity

Una actividad H5P: su tipo de contenido, si se registran los intentos, y los intentos de la persona con sus puntuaciones.

```ts
function h5pActivity(context: BrowserContext, siteUrl: string, activityId: number): Promise<H5PActivity>;

interface H5PActivity {
  id: number;
  name: string;
  contentType?: { library: string; version: string };
  tracked: boolean;
  attempts: H5PAttempt[];
}

interface H5PAttempt {
  id?: number;
  number: number;
  score?: number;
  maxScore?: number;
  completed?: boolean;
  passed?: boolean;
}
```

- `id`: el id del módulo del curso indicado; `name`: el nombre de la actividad.
- `contentType`: la librería H5P y su versión (`{ library: "H5P.MultiChoice", version: "1.14" }`), leídas de la configuración H5P de la página del reproductor antes de que se ejecute ninguno de sus scripts. Falta cuando la actividad no tiene reproductor (no se ha subido contenido) o no se puede leer la página del reproductor.
- `tracked`: Moodle registra intentos y puntuaciones en esta actividad (su ajuste "habilitar el seguimiento de intentos"): la página enlaza al informe de intentos solo entonces, y la de un estudiante solo cuando ya tiene un intento, así que sin el enlace se abre el propio informe para saberlo (Moodle responde con un error cuando no se registran los intentos, o cuando la actividad no deja a los estudiantes revisarlos).
- `attempts`: los intentos de la propia persona, del más antiguo al más reciente; vacío cuando no se registran los intentos, cuando la persona no tiene ninguno, y para un profesor, cuyo informe lista participantes en lugar de intentos.
- `id`: el id de Moodle del intento, sacado de su enlace en el informe; `number`: su número para la persona (1, 2...).
- `score` y `maxScore`: la puntuación bruta y la máxima, como números.
- `completed` y `passed`: de los iconos de finalización y de éxito del informe; faltan cuando la fila no muestra icono.

Se abren la página de la actividad, la del reproductor y el informe de intentos (`mod/h5pactivity/report.php`); no se reproduce nada, así que no se inicia ni se registra ningún intento. Lanza `NotAnH5PActivityError` cuando el id no es una actividad H5P que la persona pueda abrir.

## Reproducir contenido H5P {#playing-h5p-content}

El contenido H5P se ejecuta como JavaScript dentro de iframes de la página de la actividad, con tantas interacciones como tipos de contenido hay. El driver no ofrece ninguna función para reproducirlo: el programa que quiera hacerlo maneja la página por su cuenta en la pestaña de trabajo del navegador, la misma pestaña que muestra el navegador cuando está visible (consulta [El navegador](../concepts/browser.md) y [Acceso de bajo nivel](../concepts/low-level.md)). `BrowserManager.tab()` devuelve esa pestaña como una `Page` de Playwright, abriendo el navegador si hace falta. Moodle registra los intentos hechos ahí como de la persona (cuando se registran), y `h5pActivity` los lee después.

## Ejemplo {#example}

```ts
import { NotAnH5PActivityError } from "@falkenslab/moodle-driver";

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

try {
  const activity = await moodle.h5pActivity(38);
  console.log(`${activity.name}: ${activity.contentType?.library ?? "tipo desconocido"} ${activity.contentType?.version ?? ""}`);
  if (!activity.tracked) console.log("Moodle no registra los intentos aquí.");
  for (const attempt of activity.attempts) {
    console.log(`Intento ${attempt.number}: ${attempt.score ?? "-"}/${attempt.maxScore ?? "-"}${attempt.passed ? " (superado)" : ""}`);
  }

  // Reproducirlo es cosa del programa: abre la actividad en la pestaña de trabajo y maneja su iframe.
  const tab = await moodle.tab();
  await tab.goto(new URL(`mod/h5pactivity/view.php?id=${activity.id}`, moodle.site).href);
  await tab.locator("iframe.h5p-player").waitFor();
  const player = tab.frameLocator("iframe.h5p-player");
  // ...haz clic y escribe en `player` según lo pida el tipo de contenido.
} catch (error) {
  if (error instanceof NotAnH5PActivityError) console.error(error.message);
  else throw error;
}
```

Los selectores dentro del reproductor dependen del tipo de contenido y de su versión: búscalos en el propio contenido.

## Categorías de datos {#data-categories}

- `h5pActivity`: `course-content` y `own` (el contenido y los intentos de la persona).
- `BrowserManager.tab`: `any`, ya que un programa puede abrir cualquier cosa en ella.

Consulta [Categorías de datos](../concepts/data-categories.md).
