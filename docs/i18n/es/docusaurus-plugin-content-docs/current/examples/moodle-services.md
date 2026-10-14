# Llegar a lo que el driver no envuelve {#reaching-what-the-driver-doesnt-wrap}

Moodle tiene mucho más de lo que cubren las áreas del driver. Esta página muestra un programa que llama a un servicio AJAX de Moodle, lee una página por su estructura y rellena un formulario, todo con la sesión de la persona, y después cómo limitar lo que un programa (o un agente que lo maneje) puede llamar, para programadores.

**Usa:** [Bajar de nivel](../concepts/low-level.md), [Categorías de datos](../concepts/data-categories.md), [Cómo funciona](../concepts/how-it-works.md), [Errores](../concepts/errors.md).

## El programa {#the-program}

```ts
import { createMoodle } from "@falkenslab/moodle-driver";
import { readTexts, setFields, submitForm } from "@falkenslab/moodle-driver/internals";

// Los campos de core_course_get_recent_courses que lee este programa; Moodle envía más.
interface RecentCourse {
  id: number;
  fullname: string;
  viewurl: string;
}

await using moodle = createMoodle({ site: "https://campus.example.org/", profileDir: `${process.env.HOME}/.moodle-profile`, headless: true, downloadBrowser: true });
await moodle.logIn();

// 1. Un servicio AJAX: solo funcionan los que Moodle abre a AJAX ('ajax' => true en su db/services.php).
const recent = await moodle.callService<RecentCourse[]>("core_course_get_recent_courses", { limit: 5 });
for (const course of recent) console.log(`Reciente: ${course.fullname} (${course.id})`);

// 2. Una página leída por su estructura: el id del body nombra la página, las clases nombran las cosas (no el idioma del sitio).
const badges = await moodle.openSitePage("badges/mybadges.php");
try {
  const bodyId = await badges.locator("body").getAttribute("id");
  if (bodyId !== "page-badges-mybadges") throw new Error(`No es la página de insignias: ${bodyId}`);
  // Estos selectores son los de la lista de insignias de Moodle: compruébalos con la versión de tu sitio.
  const names = await readTexts(badges, ".badges .badge-name");
  console.log(`Insignias: ${names.join(", ") || "ninguna todavía"}`);
} finally {
  await badges.close(); // Las páginas de openSitePage y openForm son del programa, y le toca cerrarlas.
}

// 3. Un formulario: las preferencias de foro de la persona, por los nombres de los campos en el formulario de Moodle.
const form = await moodle.openForm("user/forum.php");
try {
  await setFields(form, { maildigest: "1", autosubscribe: "0" }); // Resumen diario; sin suscripción automática.
  await submitForm(form, "submitbutton"); // Lanza FormError con los mensajes de Moodle si lo rechaza.
  console.log("Preferencias de foro guardadas.");
} finally {
  await form.close();
}
```

## Paso a paso {#step-by-step}

1. `moodle.callService<T>(methodname, args)` hace un POST a `lib/ajax/service.php` de Moodle con la sesión de la persona y su `sesskey`, como hacen las propias páginas de Moodle. `T` es lo que el programa espera de vuelta: el driver no lo comprueba, así que declara solo los campos que lees.
2. `moodle.openSitePage(path)` abre una página del sitio en una pestaña nueva, como un `Page` de Playwright, y lanza `NotLoggedInError` si Moodle responde con su página de acceso. El programa la lee por su estructura: el id del body (`page-badges-mybadges`) dice qué página es, y las clases encuentran lo que hay en ella, así que el programa funciona sea cual sea el idioma del sitio. `readTexts` de `/internals` da el texto de los elementos conservando párrafos y listas.
3. `moodle.openForm(path)` abre una página con un formulario de Moodle y espera a sus editores y a sus dependencias (campos que habilitan otros). `setFields` pone los campos por nombre, de uno en uno para que entre medias se ejecuten los manejadores de Moodle; `submitForm` pulsa el botón con ese nombre y lee los mensajes de validación de Moodle.
4. Cada página se cierra en un `finally`: a diferencia de las operaciones del driver, estas dan una página al programa, y es del programa.
5. `await using` cierra el navegador al final, guardando la sesión.

## Lo que imprime {#what-it-prints}

Un ejemplo:

```text
Reciente: Programación 1 (3)
Reciente: Bases de datos (7)
Insignias: Primera entrega, Habitual del foro
Preferencias de foro guardadas.
```

## Restringir lo que se puede llamar {#restricting-what-may-be-called}

Un programa que deja que otro elija qué llamar (un asistente, un lenguaje de scripts, un plugin) puede permitir algunos tipos de datos y rechazar el resto. `DATA_CATEGORIES` da las [categorías de datos](../concepts/data-categories.md) de cada función, y `MOODLE_METHODS` los nombres de los métodos del objeto que son funciones del driver.

```ts
import { createMoodle, DATA_CATEGORIES, MOODLE_METHODS, MoodleError, type DataCategory, type Moodle } from "@falkenslab/moodle-driver";

// Este programa puede leer y construir contenido del curso y los datos propios de la persona, nunca los de otros.
const ALLOWED = new Set<DataCategory>(["none", "own", "course-content", "others-aggregate"]);

/** Por qué no se puede llamar a un método, o undefined cuando sí se puede. */
function refusal(method: string): string | undefined {
  if (!MOODLE_METHODS.includes(method)) return `${method} no es uno de los métodos del driver`;
  const categories = DATA_CATEGORIES[method];
  if (!categories) return `${method} no tiene categorías de datos`; // Sin clasificar: se rechaza, no se adivina.
  const denied = categories.filter((category) => !ALLOWED.has(category));
  return denied.length > 0 ? `${method} toca ${denied.join(", ")}` : undefined;
}

/** Llama a un método del objeto por su nombre, solo si todas sus categorías están permitidas. */
export async function callAllowed(moodle: Moodle, method: string, args: unknown[]): Promise<unknown> {
  const reason = refusal(method);
  if (reason) throw new MoodleError(`No permitido: ${reason}.`, "invalid-input");
  const fn = (moodle as unknown as Record<string, (...rest: unknown[]) => Promise<unknown>>)[method]!;
  return fn.apply(moodle, args);
}

// Por ejemplo, con un nombre y unos argumentos que llegaron de otra parte:
await using moodle = createMoodle({ site: "https://campus.example.org/", profileDir: `${process.env.HOME}/.moodle-profile`, headless: true, downloadBrowser: true });
await moodle.logIn();
console.log(await callAllowed(moodle, "courseStructure", [3])); // Permitido: course-content, own.
await callAllowed(moodle, "assignmentSubmissions", [35]).catch((error: Error) => console.error(error.message)); // Rechazado: others-personal.
```

- Los miembros propios del objeto (`callService`, `tab`, `logIn`…) no están en `MOODLE_METHODS`, así que `callAllowed` los rechaza; sus categorías están en `DATA_CATEGORIES` como `Moodle.callService` y así sucesivamente, si quieres permitir alguno.
- `callService`, `openSitePage`, `openForm`, `setFields` y el resto de `/internals` son `any`: llegan a cualquier cosa a la que se les apunte, así que una lista de permitidos sin `any` los deja fuera.
- Una función con varias categorías solo se permite cuando lo están todas: `gradeSubmission` (`others-personal`, `others-write`) necesita las dos.

## Variaciones {#variations}

- Otro servicio: `core_calendar_get_calendar_upcoming_view`, `core_message_get_unread_conversations_count`, `core_course_get_enrolled_users_by_cmid`… La documentación de la API de Moodle, o la pestaña de red del navegador en la página que lo usa, da el nombre y los argumentos.
- Una página que la persona debe ver: `moodle.tab()` da la pestaña de trabajo, que la persona ve cuando el navegador se muestra (`setVisible(true)`); déjala abierta, el driver la reutiliza.
- Sin el objeto: cada primitiva es una función de `/internals` que recibe primero el contexto y el sitio, `callService(await moodle.context(), moodle.site, ...)`.
- Por actividad: `moduleCategories(module)` dice qué toca leer una actividad de ese módulo (una página solo contiene contenido del curso; un foro, también mensajes de otros).

## Cuando algo sale mal {#when-something-goes-wrong}

- `MoodleServiceError` con `servicenotavailable`: el servicio no está abierto a AJAX, aunque la app móvil pueda llamarlo. Con `invalidparameter`: los argumentos no encajan con los del servicio; `nopermissions` o `requireloginerror`: la persona no puede.
- `NotLoggedInError`: no hay sesión, desde cualquiera de ellos. Vuelve a iniciar sesión y reintenta; consulta [Errores y sesiones caducadas](errors-and-sessions.md).
- `FormError`: Moodle rechazó el formulario (sus mensajes por campo), un campo no está en él, o está desactivado hasta que otro lo habilite: pon primero el campo que lo habilita, en el mismo `setFields`.
- Un selector que no encuentra nada: la página cambió con la versión o el tema de Moodle. Cuando puedas, lee estructura que Moodle mantiene (ids del body, atributos `data-`, ids) antes que clases, y `moodleErrorMessage(page)` te dice cuándo Moodle respondió en cambio con una página de error.

## Datos que toca {#data-it-touches}

Los servicios, las páginas y los formularios están en la [categoría de datos](../concepts/data-categories.md) `any`: este programa lee los cursos y las insignias de la propia persona y cambia sus propias preferencias, pero las mismas llamadas podrían llegar a cualquier cosa a la que llegue la persona. Por eso la lista de permitidos rechaza `any` salvo que un programa diga lo contrario.
