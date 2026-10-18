# Wikis

Actividades de wiki (módulo `wiki`), tal como las usan los participantes y los profesores: las páginas de una subwiki listadas, una página leída con sus enlaces y su historial, páginas nuevas creadas y páginas editadas, enteras o por sección. La wiki en sí se crea con `createActivity({ type: "wiki", … })` (consulta [Actividades y secciones](activities.md)), con sus ajustes por los nombres de su formulario (`wikimode: "collaborative"` o `"individual"`, `firstpagetitle`, `defaultformat`…).

**Términos:** [wiki](../reference/glossary.md#wiki), [id del módulo del curso](../reference/glossary.md#course-module-id).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos.

Ninguno de los servicios de wiki de Moodle está abierto a AJAX (son de la aplicación móvil): el driver lee las propias páginas de la wiki, la lista de páginas y los enlaces de su mapa, la vista y el historial de cada página, y escribe mediante el formulario de página nueva y el editor de la página, leídos por sus enlaces, campos y clases, así que funciona en cualquier idioma de la interfaz, en Moodle 4.5 (Boost o Classic) como en 5.x. Todas las funciones lanzan `NotAWikiError` cuando el id no es una wiki que la persona pueda abrir, `WikiError` cuando Moodle lo rechaza (con el mensaje de Moodle y la capacidad que requiere) y `NotLoggedInError` cuando no hay sesión (consulta [Errores](../concepts/errors.md)).

Una wiki guarda sus páginas en subwikis: una wiki colaborativa tiene una para todos, o una por grupo en una wiki con grupos; una wiki individual tiene una por participante. Las funciones trabajan sobre la subwiki de la persona (la de la wiki, la de su grupo o la suya) salvo que `groupId` o `userId` elijan otra, como hace el menú de grupos o de participantes de la wiki: elegir un grupo lo convierte además en el grupo actual de la persona en el curso, como hace el menú. Una wiki con una sola subwiki para todos los rechaza con `WikiError`.

## wikiPages

Las páginas de una subwiki, por título.

```ts
function wikiPages(context: BrowserContext, siteUrl: string, activityId: number, options?: WikiPagesOptions): Promise<WikiPageSummary[]>;

interface WikiPagesOptions {
  groupId?: number;
  userId?: number;
  limit?: number;
  offset?: number;
}

interface WikiPageSummary {
  id: number;
  title: string;
  links: WikiLink[];
  version: number;
  modified?: string;
  authorId?: number;
  authorName?: string;
}

interface WikiLink {
  title: string;
  pageId?: number;
}
```

- `links`: las páginas a las que enlaza, desde el mapa de la wiki; un enlace a una página que aún no existe no tiene `pageId` (Moodle lo muestra como una página por crear).
- `version`, `modified`, `authorId` y `authorName`: su última versión, desde su historial; `modified` al minuto, como lo muestra el historial. Una página creada y nunca guardada es la versión 0, sin autor.
- Vacía mientras la subwiki no tiene páginas: Moodle empieza cada subwiki por la primera página de la wiki.
- `limit` y `offset` paginan la lista como cualquier lista larga (consulta [Listas largas](../concepts/calling-functions.md#long-lists)); más allá de la lista de páginas, solo se leen las páginas devueltas, dos páginas de Moodle cada una.

## wikiPage

Una página con su contenido.

```ts
function wikiPage(context: BrowserContext, siteUrl: string, activityId: number, pageId: number, options?: { history?: boolean }): Promise<WikiPage>;

interface WikiPage extends WikiPageSummary {
  subwikiId?: number;
  html: string;
  text: string;
  sections: string[];
  images?: ImageItem[];
  media?: MediaItem[];
  history?: WikiVersion[];
}

interface WikiVersion {
  version: number;
  modified?: string;
  authorId: number;
  authorName: string;
}
```

- `html`: el contenido tal como lo muestra Moodle (los enlaces a otras páginas como enlaces, las imágenes con sus URL del sitio), sin la tabla de contenidos ni los enlaces "[editar]" que Moodle le añade; `text`, `images` y `media` como los da [`activityContent`](content.md).
- `sections`: los encabezados de la página por los que Moodle la edita, el `section` de `editWikiPage`.
- `links`: las páginas a las que enlaza su contenido, como en `wikiPages`.
- Con `history`, todas las versiones, la más reciente primero.
- `WikiError` cuando la página no está en la wiki (toma su id de `wikiPages`).

## createWikiPage

Crea una página en una subwiki como la persona, como hacen seguir un enlace a una página que aún no existe y guardar su editor.

```ts
function createWikiPage(context: BrowserContext, siteUrl: string, activityId: number, input: WikiPageInput): Promise<WikiPageChange>;

interface WikiPageInput {
  title: string;
  content: string;
  groupId?: number;
  userId?: number;
  embed?: string[];
}

interface WikiPageChange {
  changed: string;
  pageId: number;
  page: WikiPage;
}
```

- `content`: HTML en una wiki de páginas HTML (lo predeterminado en Moodle), el marcado de la wiki en una Creole o NWiki; `[[Título]]` enlaza a otra página, exista o no. Con `embed`, los archivos locales (rutas absolutas) que el HTML nombra por su nombre de archivo (`<img src="shot.png">`) se suben a él, como los incrusta [`createActivity`](activities.md); solo en páginas HTML.
- Una subwiki sin páginas empieza por la primera página de la wiki, como la empieza Moodle: su título tiene que ser el de la primera página de la wiki (si no, `WikiError` lo nombra).
- Un título que ya está en la subwiki se rechaza con `WikiError` (Moodle abriría esa página): cámbiala con `editWikiPage`.
- Requiere `mod/wiki:createpage` y `mod/wiki:editpage`, que tienen los estudiantes, en una subwiki que sea de la persona (o cualquiera, para los profesores).

## editWikiPage

Cambia el contenido de una página como hace su editor: una versión nueva, de la persona.

```ts
function editWikiPage(context: BrowserContext, siteUrl: string, activityId: number, pageId: number, changes: WikiPageChanges): Promise<WikiPageChange>;

interface WikiPageChanges {
  content: string;
  section?: string;
  embed?: string[];
}
```

- `content` sustituye el contenido de la página; con `section` (una de las `sections` de `wikiPage`), solo el de esa sección, con su encabezado, como hace el enlace "[editar]" de la sección en Moodle.
- Moodle bloquea una página mientras alguien la tiene abierta en su editor. Cuando otra persona tiene el bloqueo, el driver lanza `WikiPageLockedError` y nunca lo anula, ni siquiera para un profesor que podría: Moodle no dice quién lo tiene. El bloqueo termina cuando esa persona guarda o sale del editor, o 30 segundos después de que se cierre su editor; vuelve a intentarlo entonces.
- El propio editor del driver toma el bloqueo mientras guarda, y siempre sale por la vista de la página, que lo libera como salir del editor en Moodle.
- Requiere `mod/wiki:editpage`, en una subwiki que sea de la persona (o cualquiera, para los profesores); `WikiError` cuando la sección no está en la página.

## Ejemplo {#example}

```ts
// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.
const activityId = 72;

// La primera página de la wiki, y después una página a la que enlaza.
const home = await moodle.createWikiPage(activityId, { title: "Inicio", content: "<p>Empieza por las [[Normas]].</p>" });
await moodle.createWikiPage(activityId, { title: "Normas", content: "<h3>Sé amable</h3><p>Siempre.</p><h3>Cita</h3><p>Tus fuentes.</p>" });

for (const page of await moodle.wikiPages(activityId)) {
  console.log(`${page.title}: versión ${page.version}, de ${page.authorName ?? "nadie todavía"}`);
}

const rules = (await moodle.wikiPages(activityId)).find((page) => page.title === "Normas")!;
await moodle.editWikiPage(activityId, rules.id, { section: "Cita", content: "<h3>Cita</h3><p>Tus fuentes, con enlaces.</p>" });
const read = await moodle.wikiPage(activityId, home.pageId, { history: true });
console.log(read.text, read.history?.length);
```

## Categorías de datos {#data-categories}

`wikiPages` y `wikiPage` son `course-content` y `others-personal` (las páginas y sus versiones llevan sus autores, a menudo estudiantes); `createWikiPage` y `editWikiPage` son `course-content`: las páginas de una wiki son su contenido compartido, las haya escrito quien las haya escrito. Consulta [Categorías de datos](../concepts/data-categories.md).
