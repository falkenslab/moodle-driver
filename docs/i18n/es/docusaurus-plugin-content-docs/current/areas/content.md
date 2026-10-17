# Contenido

Leer las actividades que los profesores llenan de contenido: el texto de una página o de un área de texto y medios, los capítulos de un libro, el destino de un recurso URL y los archivos de un recurso de archivo o de una carpeta. Es el lado del estudiante (un profesor también puede leerlas): `activityContent` ve la actividad como lo haría una persona, así que Moodle registra la visualización, y con el rastro realista lee al ritmo de una persona para que las visualizaciones y la finalización queden como quedarían con una persona (consulta [el ritmo de un estudiante](../concepts/student-pace.md)). El driver no ve, reproduce ni transcribe contenido multimedia: da la URL de un vídeo, y guarda los archivos con [downloadFile](files.md). Los capítulos de un libro también se listan y se escriben aquí, el lado del profesor (consulta [Los capítulos de un libro](#a-books-chapters)).

**Términos:** [actividad](../reference/glossary.md#activity), [módulo](../reference/glossary.md#module), [id del módulo del curso](../reference/glossary.md#course-module-id), [rastro](../reference/glossary.md#trail).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos; las primitivas de más bajo nivel están en `@falkenslab/moodle-driver/internals` (consulta [Bajar de nivel](../concepts/low-level.md)).

## activityContent

```ts
function activityContent(context: BrowserContext, siteUrl: string, activity: { id: number; type: string }, options?: ContentOptions): Promise<ActivityContent>;
function activityContent(context: BrowserContext, siteUrl: string, activityId: number, type: ContentType, options?: ContentOptions): Promise<ActivityContent>;

interface ContentOptions {
  trail?: Trail;
  onProgress?: (secondsRead: number) => void;
}

type ContentType = "page" | "book" | "label" | "url" | "resource" | "folder"; // CONTENT_TYPES
type Trail = "realistic" | "fast"; // TRAILS
```

Pásale una actividad tal como la lista la [estructura del curso](courses.md) (lo que lee es `{ id, type }`), o su id (id del módulo del curso) y su módulo. Una actividad de un módulo que no lee (un cuestionario, un foro) lanza `NotViewableError` antes de abrir nada. Opciones:

- `trail`: `"realistic"` (el valor por defecto) o `"fast"`.
- `onProgress`: se llama cada pocos segundos mientras el rastro realista hace pausas para leer, con los segundos leídos hasta el momento en toda la llamada; útil para mantener a la espera a quien llama o mostrar el progreso.

Lo que devuelve depende del tipo:

- `activity`: `{ id, type }`, tal como se indicó.
- `text`: en una página o un área de texto y medios, el contenido como texto plano, conservando los párrafos, los saltos de línea y los elementos de lista (como líneas `- `), y sin scripts ni estilos.
- `chapters`: en un libro, `{ title, text }[]` en orden, con el título quitado del principio del texto.
- `media`: en una página, un área de texto y medios o un libro, los vídeos, audios y reproductores del contenido (ver más abajo).
- `images`: en una página, un área de texto y medios o un libro con imágenes en su contenido, cada `{ url, alt? }` una vez; una URL `pluginfile.php` se descarga con `downloadFile`.
- `url`: en un recurso URL, su destino.
- `files`: en un recurso de archivo o una carpeta, `{ name, url }[]`; cada `url` es un enlace `pluginfile.php` para pasarlo a `downloadFile`.
- `trail`: el rastro usado.
- `readingSeconds`: con el rastro realista, el tiempo dedicado a leer (ausente cuando no hubo pausas).

### Qué hace con cada tipo {#what-each-type-does}

- Página: abre `mod/page/view.php` y lee su caja de contenido.
- Área de texto y medios: abre `mod/label/view.php` y la lee tal como la muestra la página del curso.
- Libro, rastro realista: abre el libro y sigue su enlace "siguiente" capítulo a capítulo, deteniéndose en cada uno, como hace un lector (200 capítulos como mucho, para que un enlace roto no provoque un bucle).
- Libro, rastro rápido: lee todos los capítulos de una vez desde la página de impresión del libro (`mod/book/tool/print/index.php`), sin pausas; el mismo vídeo en varios capítulos aparece una sola vez.
- URL: abre el recurso con `forceview=1`, que registra la visualización y muestra el enlace en lugar de salir del sitio, y lee el enlace.
- Recurso de archivo: lo abre con `forceview=1` y lee el enlace del archivo en lugar de descargarlo.
- Carpeta: lee los enlaces a sus archivos del árbol de la carpeta.

### Ritmo {#pace}

Con el rastro realista, cada página, área de texto y medios o capítulo espera lo que tardaría una persona en leerlo: unas 240 palabras por minuto (4 palabras por segundo), un mínimo de 3 y un máximo de 90 segundos por página. `readingSeconds(text)` da ese tiempo para un texto y `pause(seconds, onProgress)` lo espera; ambas se exportan. Los recursos URL, los archivos y las carpetas no tienen pausa. Con el rastro rápido no se espera nada, lo que puede dejar la actividad sin finalizar cuando la finalización depende de verla durante un tiempo o de ver todos los capítulos.

### Multimedia {#media}

Cada `MediaItem` es `{ kind, url, title? }`, con `kind` igual a `"video"`, `"audio"`, `"youtube"`, `"vimeo"` o `"embed"`. Se encuentra en los elementos `<video>` y `<audio>` y sus fuentes, en reproductores dentro de iframes (un iframe que no es de YouTube ni de Vimeo es un `"embed"`), en fuentes de video.js en `data-setup` (el filtro multimedia de Moodle convierte un enlace de YouTube en una) y en enlaces simples a archivos multimedia (por extensión: `.mp4`, `.webm`, `.mp3`, `.ogg`…). Las URL de YouTube se devuelven como enlaces `https://www.youtube.com/watch?v=<id>` sea cual sea la forma que usara la página (embed, enlace corto, Shorts). Cada URL aparece una vez; las URL `blob:` y `data:` se descartan. `readMedia(page, selector)` se exporta para un programa que lea contenido multimedia de una página propia.

### Errores {#errors}

- `NotViewableError` cuando la página no muestra lo que debería según el tipo: la actividad es de otro tipo, o la persona no puede verla. El mensaje remite a la estructura del curso para obtener el id y el módulo correctos.
- `NotLoggedInError` sin sesión.

## Los capítulos de un libro {#a-books-chapters}

`createActivity` crea un libro vacío y `activityContent` lee su texto; estas funciones listan los capítulos de un libro con sus ids y los escriben, como lo hace un profesor en el propio libro: su formulario de capítulo (`mod/book/edit.php`) y los enlaces de mover, mostrar/ocultar y borrar de su tabla de contenidos. Ningún servicio lista ni escribe capítulos. Cada escritura devuelve `{ changed, chapterId, chapters }`: una frase de lo que hizo, el id del capítulo (el del nuevo, en `addBookChapter`) y los capítulos del libro después.

```ts
function bookChapters(context: BrowserContext, siteUrl: string, activityId: number, options?: { content?: boolean }): Promise<BookChapter[]>;
function addBookChapter(context: BrowserContext, siteUrl: string, activityId: number, input: BookChapterInput): Promise<BookChapterChange>;
function editBookChapter(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  chapterId: number,
  input: { title?: string; content?: string; subchapter?: boolean; embed?: string[] },
): Promise<BookChapterChange>;
function moveBookChapter(context: BrowserContext, siteUrl: string, activityId: number, chapterId: number, options: { direction: "up" | "down" }): Promise<BookChapterChange>;
function setBookChapterVisible(context: BrowserContext, siteUrl: string, activityId: number, chapterId: number, options: { visible: boolean }): Promise<BookChapterChange>;
function deleteBookChapter(context: BrowserContext, siteUrl: string, activityId: number, chapterId: number): Promise<BookChapterChange>;

interface BookChapter {
  id: number;
  title: string;
  subchapter: boolean; // un subcapítulo del capítulo anterior
  hidden: boolean;
  position: number; // su lugar en el libro, desde 1, contando los subcapítulos
  content?: string; // con content: el HTML del capítulo
  images?: ImageItem[]; // con content: sus imágenes, cuando tiene
}

interface BookChapterInput {
  title: string;
  content: string; // HTML; Moodle exige alguno
  subchapter?: boolean;
  hidden?: boolean; // visible por defecto
  afterChapterId?: number; // al final del libro sin él
  embed?: string[]; // archivos locales que nombra el contenido: <img src="shot.png">
}
```

- `bookChapters` lee la tabla de contenidos. La de un profesor sale de la página del formulario de capítulo, que no muestra ningún capítulo, así que enlaza todos, también los ocultos; la de cualquier otro, de la página del libro, sin los capítulos que no puede ver. Los títulos llegan sin el número que Moodle les pone delante en un libro numerado ("1.1. "). Con `content`, se abre la página de cada capítulo (Moodle registra una visualización) y se lee su HTML tal como lo muestra el libro, con las URL de `pluginfile.php` de sus imágenes en `images`, para descargarlas con `downloadFile`.
- `addBookChapter` añade después de `afterChapterId`, o al final: justo después de un capítulo significa antes de sus subcapítulos, que pasan a ser del capítulo nuevo, como hace el enlace de añadir de la tabla de contenidos. `subchapter` lo hace subcapítulo del capítulo anterior; `hidden` lo oculta una vez guardado. `embed` pone imágenes y archivos locales en el contenido (consulta [Incrustar archivos en texto enriquecido](files.md#embedding-files-in-rich-text)).
- `editBookChapter` cambia solo lo que se da; `embed` como en `addBookChapter`. El primer capítulo del libro no puede ser un subcapítulo: Moodle bloquea el campo ahí.
- `moveBookChapter` mueve un lugar, como las flechas de la tabla de contenidos: un capítulo se mueve con sus subcapítulos más allá del capítulo entero anterior o siguiente, un subcapítulo solo, más allá de uno. Al principio o al final no se mueve nada, y `changed` lo dice.
- `setBookChapterVisible` lo muestra o lo oculta, solo cuando no lo está ya; los subcapítulos de un capítulo se muestran u ocultan con él, y un subcapítulo de un capítulo oculto sigue oculto.
- `deleteBookChapter` lo borra con sus archivos; borrar un capítulo borra también sus subcapítulos.

Errores:

- `BookError` cuando la actividad no es un libro que la persona pueda leer (el mensaje lleva el de Moodle), cuando una escritura viene de alguien que no puede editar sus capítulos (un estudiante), cuando un capítulo no está en el libro (el mensaje lista los que tiene) y cuando el primer capítulo sería un subcapítulo.
- Un `MoodleError` (`invalid-input`) cuando un archivo para incrustar y el contenido no casan, antes de enviar nada.
- `FormError` cuando Moodle rechaza el formulario de capítulo (falta el título o el contenido); `NotLoggedInError` sin sesión.

```ts fragment
const { chapterId } = await moodle.addBookChapter(812, { title: "Bucles", content: '<p>Cómo se ejecuta un bucle:</p><p><img src="loop.png" alt="Un bucle"></p>', embed: ["/home/ada/loop.png"] });
await moodle.addBookChapter(812, { title: "Bucles while", content: "<p>Hasta que falla una condición.</p>", subchapter: true, afterChapterId: chapterId });
await moodle.setBookChapterVisible(812, chapterId, { visible: false });
for (const chapter of await moodle.bookChapters(812)) console.log(`${chapter.position}. ${chapter.subchapter ? "  " : ""}${chapter.title}${chapter.hidden ? " (oculto)" : ""}`);
```

## Ejemplo {#example}

```ts

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

const sections = await moodle.courseStructure(3);
const book = sections.flatMap((s) => s.activities).find((a) => a.type === "book" && a.availableToMe);

if (book) {
  const content = await moodle.activityContent(book, {
    trail: "realistic",
    onProgress: (seconds) => console.log(`Leyendo... ${seconds} s`),
  });
  for (const chapter of content.chapters ?? []) console.log(`# ${chapter.title}\n${chapter.text}\n`);
  for (const item of content.media ?? []) console.log(`${item.kind}: ${item.url}`);
  console.log(`Leído en ${content.readingSeconds ?? 0} segundos`);
}

// Los archivos de una carpeta, obtenidos sin pausas y guardados con la sesión.
const folder = await moodle.activityContent(57, "folder", { trail: "fast" });
for (const file of folder.files ?? []) {
  const saved = await moodle.downloadFile(file.url, "/home/ada/course-3");
  console.log(`${saved.name}: ${saved.size} bytes`);
}
```

## Categorías de datos {#data-categories}

`activityContent` es `course-content`, y también lo son `bookChapters`, `addBookChapter`, `editBookChapter`, `moveBookChapter`, `setBookChapterVisible` y `deleteBookChapter`. `readTexts`, `readMedia`, `readImages`, `readingSeconds` y `pause` son `none`: solo analizan una página o esperan. Para leer el módulo de cualquier actividad, `moduleCategories(module)` devuelve `course-content` para páginas, libros, áreas de texto y medios, URL, archivos y carpetas. Consulta [categorías de datos](../concepts/data-categories.md).
