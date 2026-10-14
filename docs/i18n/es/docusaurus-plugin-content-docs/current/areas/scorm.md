# SCORM

Actividades SCORM (módulo `scorm`): lo que la persona ve en la página de la actividad (intentos permitidos y realizados, el método de calificación, la calificación comunicada y la de cada intento) y sus SCO con el estado y la puntuación de la persona; el reproductor de Moodle abierto en la pestaña de trabajo para hacerla; y, para un profesor, un SCORM creado a partir de un paquete. Un paquete es HTML y JavaScript del propio profesor: el driver no lo hace, y nunca escribe sus datos de seguimiento ni una calificación. Su resultado sale solo de hacerlo en el reproductor.

**Términos:** [SCORM](../reference/glossary.md#scorm), [intento](../reference/glossary.md#attempt), [pestaña de trabajo](../reference/glossary.md#working-tab).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos; `openScorm` recibe en su lugar el gestor del navegador (`moodle.openScorm(…)`).

Moodle no abre sus servicios de SCORM a AJAX: todo se lee de sus páginas (ids del body, los campos del formulario "Entrar", el estado del intento por la posición de la línea, el estado de los SCO por icono), así que funciona en cualquier idioma de la interfaz. Ambas funciones lanzan `NotLoggedInError` cuando no hay sesión (consulta [Errores](../concepts/errors.md)).

## scorm

Una actividad SCORM tal como la ve la persona.

```ts
function scorm(context: BrowserContext, siteUrl: string, activityId: number): Promise<ScormActivity>;

interface ScormActivity {
  id: number;
  name: string;
  description?: string;
  attemptsAllowed?: number;
  attemptsMade?: number;
  gradingMethod?: string;
  grade?: string;
  attemptGrades: { attempt: number; grade: string }[];
  scos: ScormSco[];
}

interface ScormSco {
  id: number;
  title: string;
  status?: "not-attempted" | "incomplete" | "completed" | "passed" | "failed" | "browsed" | "suspended";
  score?: number;
}
```

- `id`: el id del módulo del curso indicado; `name` y `description` (HTML): los de la actividad.
- `attemptsAllowed`: falta cuando son ilimitados; `attemptsMade`: los de la persona.
- `gradingMethod`: con las palabras del sitio ("Intento con mejor calificación"); `grade`: la calificación comunicada al libro de calificaciones, y `attemptGrades` la de cada intento, tal como las muestra Moodle ("100%", o un número de SCO en un SCORM calificado por objetos de aprendizaje). No hay `grade` antes del primer intento.
- `scos`: los SCO del paquete (las partes que lanza el reproductor), con el `status` y el `score` de la persona en su último intento (el primero, si aún no hay ninguno), tal como los muestra la tabla de contenidos del reproductor.

Los campos del estado de los intentos faltan cuando la actividad lo oculta (su ajuste "mostrar el estado de los intentos"). Se abre la página de la actividad de forma que Moodle nunca la salte para ir al reproductor, y la tabla de contenidos se lee de `prereqs.php` de Moodle: no se inicia ningún intento. Moodle no muestra la versión de SCORM en la página; la da `openScorm`. Lanza `ScormError` cuando el id no es un SCORM que la persona pueda abrir.

## openScorm

Abre un SCORM en el reproductor de Moodle, en modo normal, en la [pestaña de trabajo](../concepts/browser.md#the-working-tab) del navegador, para que la persona (o el programa que maneja la pestaña) lo haga ahí.

```ts
function openScorm(browser: BrowserManager, siteUrl: string, activityId: number, options?: { scoId?: number; newAttempt?: boolean }): Promise<OpenedScorm>;

interface OpenedScorm {
  attempt: number;
  scoId: number;
  version?: "SCORM 1.2" | "SCORM 2004" | "AICC";
  url: string;
}
```

- Continúa el último intento, o empieza el primero; `newAttempt: true` empieza uno nuevo cuando Moodle lo permite (puede mantener abierto el último mientras esté incompleto). `attempt` es el que abrió Moodle.
- En el SCO que abre el botón "Entrar", o en `scoId` (uno de los `scos` de `scorm`).
- Se resuelve cuando el SCO se ha cargado en el marco del reproductor (`#scorm_object`), tras la página de "cargando" de Moodle: a partir de ahí se puede manejar la pestaña, o mostrársela a la persona.

Abrir el reproductor es lo que inicia un intento en Moodle y marca la actividad como vista. Lanza `ScormError` cuando Moodle no ofrece forma de entrar (cerrado, sin intentos restantes) o no abre el reproductor. El comando `moodle` no tiene `open-scorm`: su navegador se cierra cuando termina el comando.

## Crear un SCORM {#creating-a-scorm}

`createActivity` con `type: "scorm"` recibe el paquete, un `.zip` con su `imsmanifest.xml`, como el primero de `files` (consulta [Actividades y secciones](activities.md)):

```ts fragment
await moodle.createActivity({ courseId: 3, sectionId: 7, type: "scorm", name: "Comprueba lo que sabes", files: ["/home/ada/scorm/check.zip"], visibility: "shown" });
```

Los demás ajustes van en `settings` por los nombres de los campos de su formulario (`maxattempt`, `grademethod`, `whatgrade`, `skipview`…).

## Ejemplo {#example}

```ts
import { ScormError } from "@falkenslab/moodle-driver";

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

try {
  const activity = await moodle.scorm(44);
  console.log(`${activity.name}: ${activity.attemptsMade ?? "?"} intentos, calificación ${activity.grade ?? "ninguna todavía"}`);
  for (const sco of activity.scos) console.log(`  ${sco.title}: ${sco.status ?? "?"}${sco.score !== undefined ? ` (${sco.score})` : ""}`);

  // El reproductor en la pestaña de trabajo: la persona lo hace ahí, o el programa maneja el marco del SCO.
  await moodle.setVisible(true);
  const opened = await moodle.openScorm(activity.id);
  console.log(`Intento ${opened.attempt}, ${opened.version ?? "versión desconocida"}`);
  const sco = (await moodle.tab()).frameLocator("#scorm_object");
  await sco.locator("body").waitFor();
  // ...haz clic y escribe en `sco` según lo pida el paquete.
} catch (error) {
  if (error instanceof ScormError) console.error(error.message);
  else throw error;
}
```

Cuando la persona sale del reproductor (o el paquete termina), `scorm` lee el nuevo estado y la nueva calificación.

## Categorías de datos {#data-categories}

- `scorm`: `course-content` y `own` (la actividad y los intentos de la persona).
- `openScorm`: `own` (el intento de la persona).

Consulta [Categorías de datos](../concepts/data-categories.md).
