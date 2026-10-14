# Archivos

Archivos en las dos direcciones: guardar los archivos de un sitio (un recurso, los archivos de una carpeta, una entrega, el adjunto de un mensaje, una imagen de una página o de un mensaje) en una carpeta local con la sesión de la persona, y subir archivos locales en los formularios que los admiten (un recurso de archivo o una carpeta, una entrega, un mensaje de foro, una importación de preguntas), o dentro del HTML que escribe una función (una imagen en una página, la descripción de una sección o de un curso, un mensaje). Cualquiera puede descargar lo que alcanza su sesión; subir depende del formulario, y por tanto de quién puede usarlo (un profesor que crea un recurso, un estudiante que entrega). El driver nunca abre ni interpreta los archivos: un programa recibe sus rutas.

**Términos:** [sesión](../reference/glossary.md#session), [sitio](../reference/glossary.md#site).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos; las primitivas de más bajo nivel están en `@falkenslab/moodle-driver/internals` (consulta [Bajar de nivel](../concepts/low-level.md)).

## downloadFile

Guarda un archivo del sitio en una carpeta local con la sesión de la persona.

```ts
function downloadFile(context: BrowserContext, siteUrl: string, url: string, destDir: string): Promise<DownloadedFile>;

interface DownloadedFile {
  path: string;
  name: string;
  size: number;
  contentType?: string;
}
```

- `url`: una URL absoluta del sitio, normalmente un enlace `pluginfile.php` de otra función (los `files` de [activityContent](content.md), los `files` de una entrega en [calificar](grading.md), `submittedFiles` y `descriptionFiles` en [tareas](assignments.md), los adjuntos de un mensaje en [foros](forums.md)). Los medios que el sitio sirve fuera de la ruta de Moodle valen, siempre que estén en el mismo origen.
- `destDir`: una carpeta absoluta, que se crea cuando no existe. Como método, `moodle.downloadFile(url, destDir?)` usa el `downloadDir` del objeto cuando no se le da una, y lanza un error sin ninguna de las dos.

Obtiene el archivo mediante la API de peticiones del contexto del navegador, que lleva las cookies de la sesión sin abrir una pestaña, siguiendo hasta 5 redirecciones. El nombre del archivo viene del `Content-Disposition` de la respuesta (nombres UTF-8 incluidos), si no del último segmento de la URL, reducido a un nombre simple: nunca una ruta, y sin caracteres que un nombre de archivo no puede tener. Nunca sobrescribe: cuando el nombre está ocupado guarda `name (2).ext`, `name (3).ext`… El resultado tiene la `path` del archivo guardado, su `name` (tal como se guardó), su `size` en bytes y el `contentType` de la respuesta (`"application/pdf"`), sin parámetros.

Errores:

- Un `MoodleError` (`outside-site`) cuando la URL no es del origen del sitio: las cookies de la sesión no van a ningún otro sitio, así que los enlaces a otros sitios (un vídeo de YouTube, un recurso URL externo) no se pueden descargar con ella.
- Un `MoodleError` (`invalid-input`) cuando `destDir` no es absoluta.
- `NotLoggedInError` cuando Moodle responde con su página de inicio de sesión: la sesión caducó, o el archivo necesita una sesión que la persona no tiene.
- Un `MoodleError` (`not-found`) con el estado HTTP cuando Moodle responde con un error (`Moodle answered 404 for ...`): el archivo no existe, o la persona no puede verlo.

`fileNameFor(url, disposition)` es la regla de nombres por sí sola, exportada para un programa que obtiene los archivos él mismo.

## checkLocalFiles

Comprueba que los archivos locales que subir se dan como rutas absolutas y existen.

```ts
function checkLocalFiles(files: string[]): Promise<void>;
```

Lanza un `MoodleError` para la primera ruta que no es absoluta (`invalid-input`: `Give files as absolute paths: "brief.txt".`) o no existe (`not-found`: `There's no file at /home/ada/brief.txt.`). Toda función que sube archivos la llama primero, antes de abrir ninguna página, así que una ruta errónea nunca deja un formulario a medio rellenar. Un programa puede llamarla antes, para avisar a la persona antes de empezar.

## Subir en formularios {#uploading-in-forms}

Las funciones que reciben archivos locales los reciben como rutas absolutas y los suben como lo hace "Subir un archivo" del selector de archivos: al área de borrador del formulario mediante el repositorio de subida de Moodle (`repository/repository_ajax.php`), y luego guardan el formulario, que los mueve a su sitio. No hace falta nada más: ni servicios web ni tokens.

| Función | Opción | Adónde van los archivos |
| --- | --- | --- |
| `createActivity` | `files` | Los archivos de un recurso de archivo o de una carpeta, o el paquete de un SCORM ([actividades](activities.md), [SCORM](scorm.md)). |
| `updateActivity` | `files` | Archivos añadidos, quitados o sustituidos en un recurso de archivo o una carpeta ([actividades](activities.md#changing-a-resources-or-folders-files)). |
| `saveSubmission` | `files` | La entrega de la persona, añadidos a los archivos que ya hay ([tareas](assignments.md)). |
| `replyToPost`, `startDiscussion` | `files` | Los adjuntos del mensaje ([foros](forums.md)). |
| `importQuestions` | `file` | El archivo GIFT o Moodle XML que importar ([bancos de preguntas](question-banks.md)). |

Lo que puede fallar, además de los errores de `checkLocalFiles`:

- El formulario no tiene área de archivos: un `MoodleError` con el código `not-available` de `createActivity` (`A url takes no files in its form.`) o de las funciones de foros (`This forum takes no attachments.`), un `SubmissionError` de `saveSubmission` (`Assignment 45 doesn't take file submissions.`).
- La subida falla: un `FormError` cuyos `fields` llevan un `{ field: "files", message }` por archivo con la respuesta de Moodle, como un archivo por encima del límite de tamaño o de un tipo que la actividad no acepta, o `the site has no upload repository enabled` cuando el sitio desactivó el repositorio de subida.
- Moodle rechaza el formulario al guardarlo: un `FormError` con los mensajes de Moodle por campo.

`updateActivity` cambia los archivos de un recurso de archivo o de una carpeta solo cuando su `files` dice qué añadir, quitar o sustituir; si no, se quedan los que hay. `activitySettings` los enumera. Las funciones de bajo nivel `uploadToDraft`, `draftFiles`, `deleteDraftFile` y `removeFromDraft` funcionan con cualquier formulario abierto con `openForm` (consulta [acceso de bajo nivel](../concepts/low-level.md)).

## Incrustar archivos en texto enriquecido {#embedding-files-in-rich-text}

Las imágenes y los archivos pueden ir dentro del HTML que escribe una función, como hace una persona que inserta una imagen en el editor de Moodle. El HTML nombra cada archivo por su nombre de archivo, en un `src` o un `href` (`<img src="diagram.png" alt="El bucle">`, `<a href="notes.pdf">los apuntes</a>`), y `embed` da sus rutas locales absolutas:

| Función | Adónde va el HTML |
| --- | --- |
| `createActivity`, `updateActivity` | `description`, `content` o un editor en `settings` (`"activityeditor[text]"`) ([actividades](activities.md)). |
| `addSection`, `editSection` | El `summary` de la sección ([actividades](activities.md#addsection-editsection-and-deletesection)). |
| `startDiscussion`, `replyToPost`, `editPost` | El `message` del mensaje ([foros](forums.md)). |
| `updateCourse` | El `summary` del curso ([cursos](courses.md#updatecourse)). |

Cada editor de un formulario de Moodle guarda los archivos que muestra su texto en un área de borrador propia (el campo `<editor>[itemid]` junto a `<editor>[text]`), no en la del gestor de archivos. El driver sube cada archivo al área de borrador del editor cuyo HTML lo nombra (sustituyendo uno del mismo nombre que haya ahí) y reescribe ese `src` o `href` con la URL de borrador del archivo (`draftfile.php/<user context>/user/draft/<item>/diagram.png`), que es lo que escribe el editor; al guardar, Moodle guarda los archivos con el texto y convierte las URL en las suyas, así que los lectores reciben URL de `pluginfile.php`. Los lectores las encuentran en las `images` de [activityContent](content.md) y en las `images` de un [mensaje de foro](forums.md#discussion), y las descargan con `downloadFile`. Comprobado empíricamente en Moodle 5.2: la imagen de una página y la de una respuesta se muestran al estudiante y se descargan con su sesión.

Un nombre es un `src` o un `href` sin esquema (`https:`, `mailto:`) que no empieza por `/`, `#` ni `?`; los escapes se interpretan (`my%20diagram.png` nombra `my diagram.png`). Antes de enviar nada, un `MoodleError` (`invalid-input`) rechaza un archivo que incrustar que ningún texto nombra, un nombre que el texto usa sin archivo dado (otro enlace relativo cuenta: da la URL completa en su lugar) y dos archivos con el mismo nombre; los errores de `checkLocalFiles` van primero. Un editor que no admite archivos es un `MoodleError` (`not-available`). Sin `embed`, el HTML se envía tal como se da.

```ts fragment
// Una página con un diagrama, y una respuesta que muestra una captura de pantalla.
await moodle.createActivity({ courseId: 3, sectionId: 21, type: "page", name: "Bucles", content: '<p>Cómo se ejecuta un bucle:</p><p><img src="loop.png" alt="Un bucle"></p>', embed: ["/home/ada/loop.png"] });
await moodle.replyToPost(1204, { message: '<p>Este es el error que me sale: <img src="error.png" alt="El error"></p>', embed: ["/home/ada/error.png"] });
```

## Ejemplo {#example}

```ts
import { checkLocalFiles } from "@falkenslab/moodle-driver";

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

// Subir los apuntes del tema como una carpeta, oculta hasta que el profesor la revise.
const files = ["/home/ada/unit-4/recursion.pdf", "/home/ada/unit-4/exercises.pdf"];
await checkLocalFiles(files);
const created = await moodle.createActivity({ courseId: 3, sectionId: 21, type: "folder", name: "Apuntes del tema 4", files });
console.log(created.changed);

// Guardar los archivos adjuntos a la descripción de una tarea.
const assignment = await moodle.studentAssignment(45);
for (const file of assignment.descriptionFiles) {
  const saved = await moodle.downloadFile(file.url, "/home/ada/downloads");
  console.log(`${saved.path} (${saved.size} bytes, ${saved.contentType ?? "tipo desconocido"})`);
}
```

## Categorías de datos {#data-categories}

`downloadFile` es `course-content` y `others-personal`: la misma función guarda los archivos de un curso y los de una entrega o un mensaje, así que un programa que no debe alcanzar el trabajo de otros comprueba de dónde vino la URL. `checkLocalFiles` y `fileNameFor` son `none`; `uploadToDraft`, `draftFiles`, `deleteDraftFile` y `removeFromDraft` son `any`. Las funciones que suben archivos se clasifican por lo que hacen: `createActivity` y `updateActivity` son `course-content`, `saveSubmission` es `own`, `replyToPost`, `startDiscussion` y `editPost` son `communication` (`editPost` también `others-write`, la edición de un moderador), `importQuestions` es `course-content`. Consulta [categorías de datos](../concepts/data-categories.md).
