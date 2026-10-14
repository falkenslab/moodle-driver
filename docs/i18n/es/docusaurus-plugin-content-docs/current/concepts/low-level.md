# Bajar de nivel

Las áreas cubren lo que más piden los programas, pero Moodle tiene mucho más. Las primitivas con las que está construido el driver tienen su propio punto de entrada, `@falkenslab/moodle-driver/internals`, para que un programa pueda alcanzar de la misma forma lo que aún no está cubierto, con la sesión de la persona y las propias comprobaciones de Moodle. La mayoría están en la [categoría de datos](data-categories.md) `any`: alcanzan aquello a lo que se las apunte.

**Términos:** [internals](../reference/glossary.md#internals), [servicio AJAX](../reference/glossary.md#ajax-service), [sesskey](../reference/glossary.md#sesskey).

```ts
import { callService, openSitePage, setFields, submitForm } from "@falkenslab/moodle-driver/internals";
```

Siguen el mismo versionado que la entrada principal, pero están más cerca de Moodle: reciben páginas, nombres de formularios y nombres de servicios, así que un cambio en Moodle se nota antes a través de ellas. Los analizadores y pasos sueltos propios de las áreas (las páginas de un intento de cuestionario, el panel de calificación de una tarea) no se exportan en absoluto: cambian con las páginas que leen.

## Llamar a un servicio {#calling-a-service}

```ts
function callService<T>(context: BrowserContext, siteUrl: string, methodname: string, args: Record<string, unknown>): Promise<T>;
```

También es un método del objeto: `moodle.callService<T>(methodname, args)`. Llama a uno de los servicios AJAX de Moodle con la sesión de la persona y su `sesskey`, como hacen las páginas de Moodle, por HTTP y sin pestaña. Lanza `NotLoggedInError` cuando no hay sesión y `MoodleServiceError` (con `errorcode`) cuando el servicio falla. Solo funcionan los servicios que Moodle abre a AJAX (`'ajax' => true` en su `db/services.php`); los demás responden `servicenotavailable`, aunque la app móvil pueda usarlos.

```ts
const groups = await moodle.callService<{ id: number; name: string }[]>("core_group_get_course_groups", { courseid: 3 });
```

`readPageConfig(context, siteUrl)` lee el id, el idioma de la interfaz y la zona horaria de la persona del `M.cfg` de una página; `readOwnProfile(context, siteUrl)`, el id y el nombre de la persona de su página de perfil.

## Abrir una página {#opening-a-page}

```ts
function openSitePage(context: BrowserContext, siteUrl: string, path: string, options?: { follow?: boolean }): Promise<Page>;
```

Abre una página del sitio (una ruta relativa a él) en una pestaña nueva y comprueba que hay sesión, lanzando `NotLoggedInError` cuando Moodle responde con su página de inicio de sesión. Cierra la página al terminar. También es un método, `moodle.openSitePage(path)`, como `moodle.openForm(path)`. Mientras el navegador se muestra bajo demanda, la página se muestra después en la pestaña de trabajo (`follow: false` lo evita).

Lee las páginas por estructura, no por texto (consulta [Cómo funciona](how-it-works.md)): el id del body nombra la página (`page-mod-quiz-view`), y los ids y atributos de datos nombran las cosas. `moodleErrorMessage(page)` da el mensaje de Moodle en una página de error; `readSessionFacts(page)` y `pageIsLoggedIn(page, siteUrl)` dicen si una página tiene un usuario con la sesión iniciada, e `isLoggedIn(url, siteUrl, facts)` lo decide a partir de la URL final de una página y esos datos (para HTML obtenido sin pestaña, `htmlSessionFacts(html)` los da). `readTexts(page, selector)` da el texto de los elementos con párrafos y listas, `readMedia(page, selector)` los medios que contienen, y `readImages(page, selector)` sus imágenes, una lista por elemento.

Para leer el HTML de una página sin pestaña, `fetchSitePage(context, siteUrl, path)` da su URL final y su HTML por HTTP con la sesión del perfil, y lanza `NotLoggedInError` cuando Moodle responde con su página de inicio de sesión; `readMoodleConfig(html)` analiza su `M.cfg`, y `htmlSessionFacts(html)` dice si hay alguien con la sesión iniciada. El servidor de Moodle se lleva la mayor parte del tiempo de una página, así que es más ligero más que mucho más rápido (ADR-011).

## Formularios {#forms}

```ts
openForm(context, siteUrl, path): Promise<Page>; // espera a los editores y a las dependencias de formulario de Moodle
formValue(page, name): Promise<string | undefined>; // el valor de un campo oculto
setFields(page, values, formSelector?): Promise<void>; // por nombre de campo, en orden
uploadToDraft(page, draftItemId, filePaths, { overwrite }?): Promise<string[]>; // como la subida del selector de archivos; las URL de borrador de los archivos
draftFiles(page, draftItemId): Promise<DraftFile[]>; // los archivos de un área de borrador, subcarpetas incluidas
deleteDraftFile(page, draftItemId, name): Promise<void>; // como el borrado del gestor de archivos
removeFromDraft(page, draftItemId, names): Promise<void>; // varios, por ruta, rechazando los que el área no tiene
submitForm(page, button): Promise<void>; // lanza FormError con los mensajes de Moodle
dateSelectorValues(page, name, date, timeZone?); // las partes de un selector de fecha, en la zona horaria de la persona (la de la página, o la indicada)
dateSelectorDate(page, name); // la fecha que contiene un selector
```

- `setFields` fija campos de texto y textareas (a través de TinyMCE donde este los edita), desplegables (varios valores para uno múltiple), casillas de verificación y botones de opción, un campo cada vez para que los manejadores de Moodle se ejecuten entre medias. Lanza `FormError` para los campos que el formulario no tiene y para los que siguen desactivados después de fijar los anteriores: Moodle no los enviaría.
- Los selectores de fecha (`duedate[day]`, `[month]`, `[year]`, `[hour]`, `[minute]`) se leen en la zona horaria de la persona (`M.cfg.usertimezone`): construye sus valores con `dateSelectorValues`, activando antes la casilla `[enabled]` del selector cuando la tiene.
- `submitForm` espera a la página siguiente y lee los mensajes de validación de Moodle por campo.
- Un área de borrador guarda los archivos de un área de archivos mientras su formulario está abierto (el valor del campo de archivos es su id). `uploadToDraft` recibe rutas locales, o `{ from, to }` para dar nombre a un archivo en el área o ponerlo en una subcarpeta (`to: "week1/notes.pdf"`, creando antes las carpetas); con `overwrite: true` se sustituye un archivo del mismo nombre y, si no, Moodle conserva ambos y renombra el nuevo. Devuelve la URL de borrador de cada archivo (`draftfile.php/<user context>/user/draft/<item>/<name>`), lo que un editor escribe en su HTML para un archivo de su propia área de borrador (`<editor>[itemid]`). `draftFiles` y `deleteDraftFile` identifican los archivos por su ruta en el área, mediante `repository/draftfiles_ajax.php` del gestor de archivos. Nada cambia en la actividad hasta que se guarda el formulario.

```ts
import { setFields, submitForm, dateSelectorValues } from "@falkenslab/moodle-driver/internals";

const page = await moodle.openForm("course/modedit.php?update=35&return=0");
try {
  await setFields(page, { "duedate[enabled]": true, ...(await dateSelectorValues(page, "duedate", new Date("2026-11-02T22:59:00Z"))) });
  await submitForm(page, "submitbutton2");
} finally {
  await page.close();
}
```

## El editor del curso {#the-course-editor}

`editCourse(context, siteUrl, courseId, action, ids, target?)` ejecuta una de las acciones de edición de la página del curso (`cm_hide`, `cm_move`, `section_add`…) mediante su servicio, como hace el editor; `renameActivity` y `renameSection` usan los editores en línea. Las funciones de [actividades](../areas/activities.md) están construidas sobre ellas.

`courseState(context, siteUrl, courseId)` da `core_courseformat_get_state` analizado, con los nombres de campo propios de Moodle, y `activityDetails(context, siteUrl, courseId, state)` las fechas y restricciones que muestra la página del curso, por actividad: aquello de lo que está hecho `courseStructure` (consulta [Cursos](../areas/courses.md)).

## Ejecutar código en una página {#running-code-in-a-page}

`page.evaluate` de Playwright envía el código fuente de una función a la página. Con algunos ejecutores de TypeScript (tsx, `keepNames` de esbuild), las funciones con nombre que hay dentro quedan envueltas en un helper `__name` que la página no tiene, y fallan. `inPage(page, fn, arg)` define antes ese helper: úsalo para código de página con funciones auxiliares, o limítate a callbacks anónimos.

## Texto y ritmo {#text-and-pace}

`decodeEntities(text)` decodifica las entidades que escribe `format_string` de Moodle; `readingSeconds(text)` es el tiempo que necesita una persona para leer un texto, y `pause(seconds, onProgress?)` lo espera (consulta [Ritmo del estudiante](student-pace.md)). `readWwwroot(html)` encuentra la URL base de un sitio en una de sus páginas, y `fileNameFor(url, disposition)` es el nombre con el que `downloadFile` guarda un archivo.

## Manejar el navegador tú mismo {#driving-the-browser-yourself}

`moodle.tab()` da la pestaña de trabajo, con la sesión iniciada, para todo lo que sea mejor hacer a mano con Playwright (consulta [El navegador](browser.md)).
