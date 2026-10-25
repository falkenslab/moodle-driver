# H5P

Actividades H5P (módulo `h5pactivity`): qué contiene una actividad (su tipo de contenido H5P y su versión), si Moodle registra los intentos, y los intentos de la propia persona con sus puntuaciones. Los estudiantes leen sus intentos; un profesor lee los mismos datos de la actividad, sin intentos (su informe lista participantes en su lugar). El driver no reproduce contenido H5P: la reproducción ocurre en los iframes del contenido, que un programa maneja por su cuenta en la pestaña de trabajo del navegador. También se lista el banco de contenido de un curso, donde los profesores guardan contenido H5P para reutilizarlo, y se sube a él, se renombra, se descarga y se borra.

**Términos:** [h5p](../reference/glossary.md#h5p), [intento](../reference/glossary.md#attempt), [banco de contenido](../reference/glossary.md#content-bank).

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

## El banco de contenido {#the-content-bank}

El banco de contenido de un curso guarda contenido H5P aparte de sus actividades, para que los profesores lo reutilicen. Cada contenido tiene un id propio, que no es un id del módulo del curso. Abrir el banco de un curso requiere la capacidad de Moodle `moodle/contentbank:access`, que tienen los profesores y no los estudiantes; cada función lanza `ContentBankError` nombrando la capacidad que pide Moodle cuando se niega, o diciendo que no existe ese contenido.

```ts
function contentBank(context: BrowserContext, siteUrl: string, courseId: number): Promise<BankContent[]>;
function uploadToContentBank(context: BrowserContext, siteUrl: string, courseId: number, file: string): Promise<BankContentUpload>;
function renameContent(context: BrowserContext, siteUrl: string, contentId: number, name: string): Promise<{ changed: string; contentId: number; name: string }>;
function downloadContent(context: BrowserContext, siteUrl: string, contentId: number, destDir: string): Promise<DownloadedFile>;
function deleteContent(context: BrowserContext, siteUrl: string, contentId: number): Promise<{ changed: string; contentId: number }>;

interface BankContent {
  id: number;
  name: string;
  type: string;
  contentType?: { library: string; version: string };
  authorName: string;
  modified?: string;
  size: number;
  uses: number;
  unlisted: boolean;
  fileUrl?: string;
}

interface BankContentUpload {
  changed: string;
  content: BankContent;
}
```

- `contentBank`: los contenidos del curso, tal como los lista la página de su banco (`contentbank/index.php`), leyendo la página de cada contenido (`contentbank/view.php`) para su archivo: una petición por contenido, que Moodle registra como una visita. `type` es el tipo de contenido de Moodle, sacado de la extensión del archivo (`"h5p"`, el único que tiene Moodle); `contentType`, la librería H5P y su versión, sacadas del icono del contenido (falta cuando la librería no tiene); `authorName`, quién lo subió; `modified`, cuándo cambió por última vez (Moodle no muestra la fecha de creación); `size`, en bytes; `uses`, cuántas actividades usan su archivo; `unlisted`, si queda fuera de la lista para quien no puede ver el contenido no listado; `fileUrl`, el archivo del contenido (`pluginfile.php/<context>/contentbank/public/<id>/<file>`). El `name` de un contenido no listado lleva añadido el "(No listado)" de Moodle para quien no puede renombrarlo.
- `uploadToContentBank`: sube un paquete `.h5p` local, como hace el botón "Subir" del banco (su formulario de subida, un área de borrador), y da el contenido nuevo, con el nombre del archivo. Requiere `moodle/contentbank:upload` y `contenttype/h5p:upload`. Un archivo de un tipo que el banco no admite se rechaza antes de enviar nada (`MoodleError`, `invalid-input`); un paquete que Moodle rechaza da el código de error de Moodle. Moodle despliega un paquete la primera vez que se muestra: uno que necesita librerías H5P que el sitio no tiene solo se muestra a quien puede instalarlas (`moodle/h5p:updatelibraries`, el administrador).
- `renameContent`: el nombre nuevo del contenido (`core_contentbank_rename_content`); su archivo conserva su nombre. Moodle lo guarda como texto plano, y `name` es lo que muestra después la página del contenido. Requiere `moodle/contentbank:manageowncontent` para el contenido propio de la persona, `manageanycontent` para el de cualquiera; un nombre vacío es `invalid-input`.
- `downloadContent`: guarda el archivo del contenido en `destDir` desde el enlace "Descargar" de su página, sin sobrescribir nunca, como hace `downloadFile` (que también puede guardar `fileUrl`). Requiere `moodle/contentbank:downloadcontent`.
- `deleteContent`: borra el contenido (`core_contentbank_delete_content`), aunque lo usen actividades, como hace la página después de avisar. Requiere `moodle/contentbank:deleteowncontent` para el contenido propio de la persona, `deleteanycontent` para el de cualquiera.

Una actividad H5P se crea a partir de un paquete local (`createActivity` con `type: "h5pactivity"`): para crear una a partir de un contenido del banco, descárgalo primero y pasa el archivo. La actividad tiene entonces su propia copia, no un enlace al del banco.

```ts
import { tmpdir } from "node:os";
import { ContentBankError } from "@falkenslab/moodle-driver";

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

try {
  const { content } = await moodle.uploadToContentBank(12, "/home/me/quiz.h5p");
  await moodle.renameContent(content.id, "Comprobación de la semana 1");
  for (const item of await moodle.contentBank(12)) {
    console.log(`${item.id} ${item.name} (${item.contentType?.library ?? item.type}), usado ${item.uses} veces`);
  }
  // Una copia como actividad, en la sección cuyo id es 3.
  const saved = await moodle.downloadContent(content.id, tmpdir());
  await moodle.createActivity({ courseId: 12, sectionId: 3, type: "h5pactivity", name: "Comprobación de la semana 1", files: [saved.path] });
  await moodle.deleteContent(content.id);
} catch (error) {
  if (error instanceof ContentBankError) console.error(error.message);
  else throw error;
}
```

## Los tipos de contenido que puede ejecutar un sitio {#the-content-types-a-site-can-run}

Un paquete H5P que solo trae su contenido, sin sus librerías, solo se reproduce donde está instalada su librería principal: Moodle descarga las habituales de h5p.org, o las instala un administrador. `h5pContentTypes` dice cuáles tiene un sitio, antes de construir un paquete así.

```ts
function h5pContentTypes(context: BrowserContext, siteUrl: string, courseId: number): Promise<H5PContentTypes>;

interface H5PContentTypes {
  types: H5PContentType[];
  canInstall: boolean;
}

interface H5PContentType {
  library: string; // "H5P.MultiChoice", como lo nombra el h5p.json de un paquete
  version: string; // "1.16": la más nueva que tiene el sitio
  title: string;
}
```

- `types`: los tipos de contenido que el banco de contenido del curso ofrece para crear (su menú "Añadir"), uno por tipo en su versión más nueva, la que usa el contenido nuevo. Un paquete cuya librería principal está entre ellos se reproduce aquí. Vacía cuando el sitio no tiene librerías H5P, o la persona ve el banco pero no puede crear contenido en él.
- `canInstall`: si la persona puede instalar librerías H5P (`moodle/h5p:updatelibraries`, la del administrador), según se le abra o no la página "Gestionar tipos de contenido H5P" del sitio; abrirla no cambia nada. Solo así se despliega un paquete con librerías que el sitio no tiene.

Lee lo que ve un profesor, nunca la página de librerías del administrador. No usa la lista del propio editor H5P: Moodle no usa el hub de H5P, así que esa lista marca todos los tipos como no instalables, incluso para el administrador. Lanza `ContentBankError` cuando la persona no puede abrir el curso o su banco.

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
- `contentBank`, `h5pContentTypes`, `uploadToContentBank`, `renameContent`, `downloadContent`, `deleteContent`: `course-content` (lo que los profesores guardan en el banco, con el nombre de su autor).
- `BrowserManager.tab`: `any`, ya que un programa puede abrir cualquier cosa en ella.

Consulta [Categorías de datos](../concepts/data-categories.md).
