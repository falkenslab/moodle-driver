# Foros

Los debates de un foro y sus mensajes como datos simples, publicar como la persona (respuestas y debates nuevos, con adjuntos), editar y eliminar mensajes, suscribirse a debates y la moderación de un profesor (fijar y bloquear debates, cambiar o quitar los mensajes de cualquiera). Calificar un foro en conjunto y valorar mensajes está en [Calificar](grading.md#forumgrades). Estudiantes y profesores leen y publican por igual, dentro de lo que el foro les permite; fijar y bloquear requieren los permisos de moderación que tiene un profesor.

**Términos:** [participante](../reference/glossary.md#participant), [id de instancia](../reference/glossary.md#instance-id), [notificación](../reference/glossary.md#notification).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos; las primitivas de más bajo nivel están en `@falkenslab/moodle-driver/internals` (consulta [Bajar de nivel](../concepts/low-level.md)).

Un foro se identifica por su id de actividad (`activityId`, el `id` de `mod/forum/view.php?id=`), y los debates y los mensajes por los ids de Moodle. Los debates se leen de las páginas del foro (por atributos de datos, enlaces y marcas de tiempo, así que en cualquier idioma), los mensajes mediante el servicio `mod_forum_get_discussion_posts` de Moodle, y publicar pasa por el propio formulario de mensajes de Moodle (`mod/forum/post.php`), que admite adjuntos y rellena el asunto de una respuesta. Todas las funciones lanzan `NotLoggedInError` cuando no hay sesión (consulta [Errores](../concepts/errors.md)).

## forumDiscussions

Los debates de un foro tal como los lista su página, a lo largo de todas sus páginas: quién empezó cada uno, cuántas respuestas tiene, el último mensaje, si está fijado o bloqueado y si la persona está suscrita a él.

```ts
function forumDiscussions(context: BrowserContext, siteUrl: string, activityId: number, options?: { limit?: number; offset?: number }): Promise<ForumDiscussion[]>; // ListPage<ForumDiscussion> con limit

interface ForumDiscussion {
  id: number;
  subject: string;
  author: string;
  started?: string;
  lastPost: { author: string; time?: string; postId?: number };
  replies: number;
  locked: boolean;
  pinned: boolean;
  subscribed: boolean;
}
```

- `id`: el id del debate, que reciben `discussion`, `setDiscussionState` y `setDiscussionSubscription`.
- `author`: el nombre de quien lo empezó, tal como se muestra; `started`: cuándo, como fecha ISO.
- `lastPost`: quién publicó el último, cuándo (ISO) y el id de ese mensaje cuando la página lo enlaza.
- `replies`: el número de respuestas que se muestra.
- `pinned`: el debate se queda arriba de la lista; `locked`: ya nadie puede responder.
- `subscribed`: la persona recibe sus mensajes por notificación, ya esté suscrita al propio debate o a todo el foro (y no se haya excluido de este debate), según marca Moodle la fila.

La suscripción de la persona al foro en conjunto no se lee: la página del foro solo la muestra como un botón cuyo enlace es el mismo en ambos casos, y solo su etiqueta dice el estado.

Con `limit` y `offset`, una página de los debates en el orden del foro (consulta [Listas largas](../concepts/calling-functions.md#long-lists)): el driver abre la página de la paginación propia del foro (sus parámetros `s` y `p`) que la contiene, en lugar de todas.

Lanza `NotAForumError` cuando el id no es un foro que la persona pueda ver.

## discussion

Los mensajes de un debate, del más antiguo al más reciente, con su texto como texto plano, y si la persona está suscrita a él.

```ts
function discussion(context: BrowserContext, siteUrl: string, discussionId: number, options?: { limit?: number; offset?: number }): Promise<{
  discussion: { id: number; forumInstanceId: number; courseId: number; subscribed?: boolean };
  posts: ForumPost[]; // ListPage<ForumPost> con limit
}>;

interface ForumPost {
  id: number;
  parentId?: number;
  subject: string;
  author: { id: number; fullName: string };
  created?: string;
  modified?: string;
  text: string;
  images?: ImageItem[]; // { url, alt? }
  attachments: { name: string; url: string }[];
  privateReply: boolean;
  unread?: boolean;
}
```

- `discussion.forumInstanceId`: el id de instancia del foro (no su id de actividad, que es el que reciben las funciones de foros); `courseId`: su curso.
- `discussion.subscribed`: si la persona está suscrita a él, leído del elemento de suscripción de la página del debate (su menú de ajustes); falta donde la página no lo tiene (la persona no puede suscribirse, o el foro fuerza la suscripción).
- `parentId`: el mensaje al que responde; falta en el primer mensaje del debate.
- `limit`, `offset`: `posts` como una página (consulta [Listas largas](../concepts/calling-functions.md#long-lists)). El servicio de Moodle no tiene paginación: se leen todos los mensajes y se recortan, pero solo los de la página se convierten en texto.
- `created`, `modified`: fechas ISO; `modified` solo cuando el mensaje se editó más de un minuto después de publicarlo.
- `text`: el mensaje como texto, con sus párrafos y listas conservados.
- `images`: las imágenes del mensaje (`{ url, alt? }`), cuando tiene alguna; sus URL de `pluginfile.php` se descargan con [`downloadFile`](files.md).
- `attachments`: el nombre y la URL de cada archivo; descárgalos con la sesión mediante [`downloadFile`](files.md).
- `privateReply`: una respuesta privada, que solo ven su autor y la persona a la que responde (y los profesores).
- `unread`: si la persona no lo ha leído, cuando Moodle lo registra.

Lanza `NotAForumError` cuando el debate no existe o la persona no puede verlo, y `MoodleServiceError` para otros rechazos del servicio.

## replyToPost

Responde a un mensaje mediante el formulario de mensajes de Moodle y devuelve el id del nuevo mensaje y el de su debate; cuando se da `subscribe`, también la suscripción de la persona al debate después, leída de vuelta de su página, así que la llamada confirma que se aplicó.

```ts
function replyToPost(context: BrowserContext, siteUrl: string, postId: number, input: PostInput & { subject?: string }): Promise<{
  changed: string;
  postId?: number;
  discussionId?: number;
  subscribed?: boolean;
}>;

interface PostInput {
  message: string;
  files?: string[];
  embed?: string[];
  subscribe?: boolean;
  fields?: Record<string, FieldValue>;
}
```

- `message`: el mensaje como HTML (`"<p>Gracias, ha funcionado.</p>"`).
- `subject`: el asunto de la respuesta; sin él, el que rellena Moodle ("Re: ...").
- `files`: rutas absolutas de archivos locales que adjuntar, subidos como lo hace el selector de archivos.
- `embed`: rutas absolutas de imágenes y archivos locales que poner dentro del mensaje, que nombra cada uno por su nombre de archivo (`'<p>Aquí: <img src="error.png"></p>'`), como inserta una imagen el editor de Moodle (consulta [Incrustar archivos en texto enriquecido](files.md#embedding-files-in-rich-text)).
- `subscribe`: suscribirse al debate o no; sin él, lo predeterminado de Moodle.
- `fields`: otros campos del formulario de mensajes por nombre, fijados después de los demás (el `{ pinned: true }` de un profesor en un debate nuevo, o `{ mailnow: true }`).

Errores antes de publicar nada: un `MoodleError` cuando el mensaje está vacío (`invalid-input`) (Moodle publicaría `<p></p>` como un mensaje en blanco; un mensaje con solo una imagen, un vídeo, un audio o un iframe cuenta como contenido), cuando la ruta de un archivo no es absoluta o no existe, o cuando el foro no admite adjuntos (`not-available`). `FormError` cuando Moodle no muestra formulario de mensajes (la persona no puede responder ahí: un debate bloqueado, sin permiso), cuando el formulario no tiene un campo con un nombre dado, o cuando Moodle rechaza los valores, con sus mensajes por campo.

## startDiscussion

Empieza un debate en un foro, mediante el mismo formulario, y devuelve su id, si está fijado y si la persona está suscrita a él, tal como lo lista el foro después: una sola llamada confirma lo que fijan `subscribe` y `fields: { pinned: true }`.

```ts
function startDiscussion(context: BrowserContext, siteUrl: string, activityId: number, input: PostInput & { subject: string }): Promise<{
  changed: string;
  discussionId?: number;
  pinned?: boolean;
  subscribed?: boolean;
}>;
```

Aquí `subject` es obligatorio; el resto es como en `replyToPost`. El id del nuevo debate se encuentra comparando los debates del foro antes y después de publicar, así que falta si la lista del foro no le muestra el nuevo debate a la persona. Lanza `NotAForumError` cuando el id no es un foro que la persona pueda ver o en el que pueda publicar, y en lo demás los mismos errores que `replyToPost`. Algunos tipos de foro limitan quién empieza debates (un foro de avisos, a los profesores): donde la persona no puede, Moodle no muestra formulario de mensajes y `FormError` lo dice.

## setDiscussionState

Fija o desfija, bloquea o desbloquea un debate, como hace el menú de la lista de debates, mediante los servicios `mod_forum_set_pin_state` y `mod_forum_set_lock_state` de Moodle. Devuelve el debate tal como lo lista el foro después.

```ts
function setDiscussionState(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  discussionId: number,
  state: { pinned?: boolean; locked?: boolean },
): Promise<{ changed: string; discussion?: ForumDiscussion }>;
```

Es idempotente: lo que ya está así se deja como está, y una llamada que no cambia nada no llama a ningún servicio y responde `"Nothing to change."`. Un estado que no se da no se toca. Lanza `NotAForumError` cuando el foro no tiene ese debate, y `MoodleServiceError` cuando Moodle lo rechaza (la persona no puede fijar ni bloquear debates).

## setDiscussionSubscription

Suscribe a la persona a un debate o la da de baja, como hace el interruptor de la lista de debates, mediante el servicio `mod_forum_set_subscription_state` de Moodle. Devuelve el debate tal como lo lista el foro después.

```ts
function setDiscussionSubscription(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  discussionId: number,
  subscribed: boolean,
): Promise<{ changed: string; discussion?: ForumDiscussion }>;
```

Es idempotente: cuando la persona ya está así, no llama a ningún servicio y responde `"Nothing to change."`. Darse de baja de un debate de un foro al que la persona está suscrita la excluye solo de ese debate. Lanza `NotAForumError` cuando el foro no tiene ese debate, y `MoodleServiceError` cuando Moodle lo rechaza (un foro con las suscripciones desactivadas o forzadas).

## editPost

Cambia un mensaje mediante el propio formulario de mensajes de Moodle (`post.php?edit=`), como su autor o como moderador: solo cambia lo que se da. Devuelve el mensaje después, tal como lo lee `discussion`.

```ts
function editPost(context: BrowserContext, siteUrl: string, postId: number, changes: PostChanges): Promise<{
  changed: string;
  post?: ForumPost;
}>;

interface PostChanges {
  subject?: string;
  message?: string;
  files?: { add?: string[]; remove?: string[] };
  embed?: string[];
}
```

- `message`: el nuevo mensaje como HTML, que sustituye al anterior.
- `embed`: rutas absolutas de imágenes y archivos locales que nombra el nuevo `message`, como en `replyToPost`.
- `files.add`: rutas absolutas de archivos locales que adjuntar; `files.remove`: adjuntos que quitar, por nombre (tal como los lista `discussion` en `attachments`).
- Sin nada que cambiar, no abre ningún formulario y responde `"Nothing to change."`.

Moodle deja al autor editar un mensaje solo dentro del tiempo de edición del sitio (30 minutos por defecto) y a un moderador (un profesor, `mod/forum:editanypost`) editar cualquier mensaje en cualquier momento. Errores antes de guardar nada: un `MoodleError` cuando el mensaje o el asunto están vacíos (`invalid-input`), cuando la ruta de un archivo no es absoluta o no existe, o cuando el foro no admite adjuntos (`not-available`); `FormError` cuando el mensaje no tiene un adjunto con un nombre que quitar. `ForumError` con el motivo de Moodle cuando lo rechaza: el tiempo de edición ha terminado, el mensaje es de otra persona o no existe ese mensaje.

## deletePost

Elimina un mensaje y todas las respuestas que cuelgan de él, mediante la propia confirmación de Moodle (`post.php?delete=`). El primer mensaje de un debate se lleva el debate entero.

```ts
function deletePost(context: BrowserContext, siteUrl: string, postId: number): Promise<{
  changed: string;
  discussionId?: number;
  replies: number;
  discussionDeleted: boolean;
}>;
```

- `replies`: cuántas respuestas se fueron con él, a cualquier profundidad.
- `discussionDeleted`: el mensaje era el primero del debate, así que el debate ya no existe.

El autor elimina su propio mensaje dentro del tiempo de edición y mientras no tenga respuestas; un moderador (`mod/forum:deleteanypost`) elimina cualquier mensaje, respuestas incluidas. Lanza `ForumError` con el motivo de Moodle cuando lo rechaza (el mensaje de otra persona, un mensaje con respuestas, el tiempo de edición terminado, no existe ese mensaje).

## NotAForumError

La clase que lanzan todas las funciones de foros cuando el id no es el módulo del curso de un foro, la persona no puede verlo o un debate no está. Su mensaje dice de dónde sacar el id correcto (la estructura del curso, los debates del foro). Captúrala con `instanceof NotAForumError`.

## ForumError

Lo que lanzan `editPost` y `deletePost` cuando Moodle se niega a cambiar o eliminar un mensaje; su mensaje termina con el propio motivo de Moodle, en el idioma del sitio. Código `forum`.

## Ejemplo {#example}

```ts
import { ForumError, NotAForumError } from "@falkenslab/moodle-driver";

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.
const forumId = 37;

try {
  const discussions = await moodle.forumDiscussions(forumId);
  for (const d of discussions) console.log(`${d.pinned ? "[fijado] " : ""}${d.subject} de ${d.author}, ${d.replies} respuestas`);

  const first = discussions[0];
  if (first) {
    const { posts } = await moodle.discussion(first.id);
    const opening = posts[0]!;
    console.log(`${opening.author.fullName}: ${opening.text}`);
    const reply = await moodle.replyToPost(opening.id, { message: "<p>Gracias, Ada. El bucle termina en 2.</p>", subscribe: false });
    // Pensándolo mejor, dentro del tiempo de edición.
    if (reply.postId) await moodle.editPost(reply.postId, { message: "<p>Gracias, Ada. El bucle termina en 3.</p>" });
  }

  const started = await moodle.startDiscussion(forumId, {
    subject: "Soluciones del ejercicio 3",
    message: "<p>Publica aquí tu solución del ejercicio 3.</p>",
    files: ["/home/me/exercise3.pdf"],
  });

  // Dejar de seguirlo.
  if (started.subscribed && started.discussionId) await moodle.setDiscussionSubscription(forumId, started.discussionId, false);

  // Como profesor: mantenerlo arriba y cerrado a respuestas.
  if (started.discussionId) await moodle.setDiscussionState(forumId, started.discussionId, { pinned: true, locked: true });
} catch (error) {
  if (error instanceof NotAForumError || error instanceof ForumError) console.error(error.message);
  else throw error;
}
```

## Categorías de datos {#data-categories}

- `forumDiscussions`, `discussion`: `others-personal` (los nombres y mensajes de otros).
- `replyToPost`, `startDiscussion`: `communication` (escribir ante otros).
- `setDiscussionState`: `others-personal` y `communication`.
- `setDiscussionSubscription`: `own` (la suscripción de la persona) y `others-personal` (el debate que devuelve nombra a quien lo empezó).
- `editPost`, `deletePost`: `communication` (los mensajes propios) y `others-write` (un moderador que cambia o quita los de otra persona).

Consulta [Categorías de datos](../concepts/data-categories.md).
