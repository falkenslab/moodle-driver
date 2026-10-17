# Bloques

Esta área trabaja con los bloques de la página de un curso, la columna junto a sus secciones: leerlos (`courseBlocks`), añadir uno (`addBlock`), cambiar su configuración (`configureBlock`), moverlo (`moveBlock`) y eliminarlo (`deleteBlock`). El habitual es un bloque de texto (tipo `html`, "Texto" en la interfaz de Moodle) con una bienvenida o enlaces; los demás tipos son los de Moodle (eventos próximos, actividad reciente, últimos anuncios…). Cualquiera en el curso lee los bloques que la página le muestra; cambiarlos requiere `moodle/site:manageblocks` en el curso, que los profesores tienen por defecto, y añadir uno también `block/<type>:addinstance`.

**Términos:** [bloque](../reference/glossary.md#block).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos; las primitivas de más bajo nivel están en `@falkenslab/moodle-driver/internals` (consulta [Bajar de nivel](../concepts/low-level.md)).

## Cómo funcionan los bloques en Moodle {#how-blocks-work-in-moodle}

Un bloque está en una región de la página, y su peso lo ordena en ella (el menor va primero). Boost, el tema por defecto de Moodle, da a las páginas de curso una sola región, `side-pre`, el cajón de bloques; otros temas pueden tener más (`side-post`). Los bloques se cambian en modo edición: "Agregar un bloque", y el menú de acciones de cada bloque (configurar, mover, ocultar, eliminar). Un bloque puede ocultarse a los estudiantes; entonces solo lo ve quien puede editar los bloques.

Moodle no tiene ningún servicio abierto a AJAX que liste los bloques de un curso (`core_block_get_course_blocks` es para la app móvil), así que el driver los lee de la página del curso, y los cambia como lo hace su modo edición: las acciones de bloque en la página del curso (`bui_addblock`, `bui_moveid`, `bui_deleteid`) y el formulario de configuración de cada bloque (`bui_editid`). Los tipos de bloque que ofrece la página vienen de `core_block_fetch_addable_blocks`, el servicio al que llama el diálogo "Agregar un bloque". El modo edición es un ajuste de la sesión de la persona: las funciones lo activan para el trabajo y lo desactivan después, cuando estaba desactivado, para que la pestaña de la persona encuentre el curso como lo dejó.

## CourseBlock

Los bloques que lista `courseBlocks` y que devuelven las escrituras:

```ts
interface CourseBlock {
  id: number;
  type: string;
  title: string;
  region: string;
  weight?: number;
  visible: boolean;
  content?: string;
}
```

- `id`: el id de la instancia del bloque, lo que toman las demás funciones.
- `type`: el nombre del plugin del bloque sin `block_`: `html` para un bloque de texto, `calendar_upcoming`, `recent_activity`…
- `title`: su título como lo muestra la página; para un bloque de texto, el título que se le dio (`""` si no tiene, aunque en modo edición la página muestra un texto provisional).
- `region`: la región en la que está (`side-pre`).
- `weight`: su peso en la región, de su formulario de configuración; solo para quien puede editar los bloques del curso.
- `visible`: false para un bloque oculto a los estudiantes.
- `content`: el contenido de un bloque de texto, HTML como lo muestra la página, con sus archivos como URLs `pluginfile.php` (`downloadFile` los guarda con la sesión).

## courseBlocks

Los bloques de la página de un curso, en el orden de cada región.

```ts
function courseBlocks(context: BrowserContext, siteUrl: string, courseId: number): Promise<CourseBlock[]>;
```

Quien puede editar los bloques del curso los recibe todos, también los ocultos y los vacíos, con sus pesos: la página se lee en modo edición, y el formulario de configuración de cada bloque da su peso. Los demás reciben los bloques que la página les muestra, sin pesos. Lanza `BlockError` cuando la página del curso no se puede abrir (no existe el curso, o la persona no está en él).

## addBlock

Añade un bloque a la página del curso, como hace "Agregar un bloque", y lo devuelve.

```ts
function addBlock(context: BrowserContext, siteUrl: string, courseId: number, block: NewBlock): Promise<{ changed: string; block: CourseBlock }>;

interface NewBlock {
  type: string;
  region?: string;
  title?: string;
  content?: string;
  embed?: string[];
}
```

- `type`: el tipo de bloque, `html` para un bloque de texto.
- `region`: una de las regiones de la página; por defecto la suya por defecto (`side-pre`). Moodle pone el bloque al final de la región.
- `title`, `content`: el título y el contenido HTML de un bloque de texto, que se fijan con su formulario de configuración después de añadirlo.
- `embed`: archivos locales que nombra el contenido (`<img src="map.png">`), como rutas absolutas, que se suben y se colocan en él como lo hace el editor de Moodle (consulta [Incrustar archivos en texto enriquecido](files.md#embedding-files-in-rich-text)).

Lanza `BlockError` cuando la persona no puede editar los bloques del curso (nombrando `moodle/site:manageblocks`), cuando la página no ofrece el tipo (no está instalado o está deshabilitado, ya está y solo se permite uno, como eventos próximos, o la persona no tiene `block/<type>:addinstance`; el mensaje lista los tipos que ofrece), o para una región que la página no tiene. Un título o contenido para un tipo cuyo formulario no tiene ese campo es `FormError`, y el bloque se quita de nuevo.

## configureBlock

Cambia la configuración de un bloque con su formulario de configuración, y devuelve el bloque después.

```ts
function configureBlock(context: BrowserContext, siteUrl: string, courseId: number, blockId: number, changes: BlockChanges): Promise<{ changed: string; block: CourseBlock }>;

interface BlockChanges {
  title?: string;
  content?: string;
  embed?: string[];
  settings?: Record<string, FieldValue>;
}
```

- `title`, `content`, `embed`: los de un bloque de texto, como en `addBlock` (los campos `config_title` y `config_text` del formulario).
- `settings`: cualquier otro campo del formulario del bloque por su nombre, como los toma `setFields`: `bui_visible: "0"` oculta el bloque a los estudiantes; los campos propios de otros tipos empiezan por `config_`.

Lanza `BlockError` cuando la página no tiene ese bloque o la persona no puede editar sus bloques, y `FormError` nombrando un campo que el formulario no tiene, o con el motivo de Moodle cuando rechaza el formulario.

## moveBlock

Mueve un bloque a una región y a un peso en ella, como lo hace la acción de mover del bloque, y lo devuelve.

```ts
function moveBlock(context: BrowserContext, siteUrl: string, courseId: number, blockId: number, to: { region?: string; weight?: number }): Promise<{ changed: string; block: CourseBlock }>;
```

- `region`: la región a la que moverlo; por defecto aquella en la que está.
- `weight`: un número entero, el menor primero; Moodle desplaza los bloques de alrededor para hacerle sitio. Sin él, el bloque va detrás de los demás bloques de la región.

Lanza `BlockError` cuando la página no tiene ese bloque o esa región (las páginas de curso de Boost solo tienen `side-pre`), o la persona no puede editar sus bloques.

## deleteBlock

Elimina un bloque de la página del curso, como lo hace su acción de eliminar una vez confirmada.

```ts
function deleteBlock(context: BrowserContext, siteUrl: string, courseId: number, blockId: number): Promise<{ changed: string }>;
```

Lanza `BlockError` cuando la página no tiene ese bloque, o la persona no puede eliminarlo (requiere `moodle/site:manageblocks`, y `block/<type>:addinstance` para la mayoría de los tipos).

## Ejemplo {#example}

Un profesor da a un curso un bloque de bienvenida con un mapa, lo pone el primero y más tarde cambia su texto.

```ts
import { BlockError } from "@falkenslab/moodle-driver";

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

try {
  const { block } = await moodle.addBlock(3, { type: "html", title: "Bienvenida", content: '<p>Empieza por la introducción. <img src="map.png" alt="Mapa del curso"></p>', embed: ["/home/ana/curso/map.png"] });
  await moodle.moveBlock(3, block.id, { weight: -10 });
  await moodle.configureBlock(3, block.id, { content: '<p>Empieza por <a href="https://moodle.org/">la guía</a>.</p>' });

  for (const b of await moodle.courseBlocks(3)) console.log(b.id, b.type, b.title, b.weight);
} catch (error) {
  if (error instanceof BlockError) console.log(error.message);
  else throw error;
}
```

## Categorías de datos {#data-categories}

De `DATA_CATEGORIES` (consulta [Categorías de datos](../concepts/data-categories.md)):

- `courseBlocks`, `addBlock`, `configureBlock`, `moveBlock`, `deleteBlock`: `course-content`.
