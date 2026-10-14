# Mensajes

Esta área cubre la mensajería de Moodle de la persona: sus notificaciones (`notifications`, `markNotificationsRead`), sus conversaciones (`conversations`, `conversation`) y el envío de un mensaje privado (`sendMessage`), a una persona o a varios participantes de un curso a la vez (`messageParticipants`). Funciona igual para estudiantes y profesores, siempre como la persona que ha iniciado sesión: no se pueden leer los mensajes de otra persona. Los mensajes de los foros están en [Foros](forums.md).

**Términos:** [notificación](../reference/glossary.md#notification), [conversación](../reference/glossary.md#conversation).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos; las primitivas de más bajo nivel están en `@falkenslab/moodle-driver/internals` (consulta [Bajar de nivel](../concepts/low-level.md)).

Todo pasa por los servicios que llaman la propia ventana emergente de notificaciones y el cajón de mensajería de Moodle. Las personas llegan como un id de usuario y un nombre completo; los mensajes como texto plano (con los párrafos y las listas conservados y el marcado quitado), y las fechas como cadenas ISO en UTC.

## notifications

Las notificaciones de la persona, de la más reciente a la más antigua, opcionalmente solo las no leídas, todas o una página cada vez (consulta [Listas largas](../concepts/calling-functions.md#long-lists)).

```ts
function notifications(context: BrowserContext, siteUrl: string, options?: { unreadOnly?: boolean; limit?: number; offset?: number }): Promise<Notification[]>; // ListPage<Notification> con limit

interface Notification {
  id: number;
  subject: string;
  text: string;
  fromUserId: number;
  time?: string;
  read: boolean;
  url?: string;
  component?: string;
  eventType?: string;
}
```

- `unreadOnly`: `false` por defecto; con ella, `offset` cuenta notificaciones no leídas.
- `limit`, `offset`: una página de ellas, de la más reciente a la más antigua; sin `limit`, todas.
- `subject` y `text`: el asunto de la notificación y su mensaje como texto plano.
- `fromUserId`: de quién es; un id negativo es el propio sitio (el usuario no-reply o el de soporte).
- `url`: adónde lleva (el mensaje del foro, la tarea, la entrega calificada…).
- `component` y `eventType`: qué la envió, como `"mod_forum"` con `"posts"`, o `"mod_assign"`; útiles para filtrar por tipo en cualquier idioma.

Lee `message_popup_get_popup_notifications`, el servicio de la ventana emergente: sin límite, todo; con uno, solo la página. El servicio no tiene filtro de no leídas: para una página de no leídas, el driver lee las notificaciones en lotes de 50 (o más para una página mayor) hasta llenar la página.

### Las notificaciones de los foros llegan más tarde {#forum-notifications-come-later}

Moodle no notifica un mensaje de foro cuando se escribe. Sus tareas programadas (cron) envían las notificaciones de los foros después, una vez pasado el tiempo de edición del mensaje (30 minutos por defecto, el "Tiempo máximo para editar" del sitio). Un programa que responde con `replyToPost` y luego lee las notificaciones del destinatario no la encontrará enseguida; cuánto tarda depende del cron del sitio, no del driver. Los mensajes privados enviados con `sendMessage` aparecen en la conversación de inmediato.

## markNotificationsRead

Marca como leídas todas las notificaciones de la persona, como hace "Marcar todas como leídas" de la ventana emergente. Hacerlo dos veces no cambia nada.

```ts
function markNotificationsRead(context: BrowserContext, siteUrl: string): Promise<{ changed: string }>;
```

Pasa por `core_message_mark_all_notifications_as_read` para el usuario que ha iniciado sesión. No se puede marcar una sola notificación.

## conversations

Las conversaciones de la persona, de la más reciente a la más antigua, cada una con su último mensaje, todas o una página cada vez (consulta [Listas largas](../concepts/calling-functions.md#long-lists)).

```ts
function conversations(context: BrowserContext, siteUrl: string, options?: { limit?: number; offset?: number }): Promise<ConversationSummary[]>; // ListPage<ConversationSummary> con limit

interface ConversationSummary {
  id: number;
  type: "private" | "group" | "self";
  name?: string;
  members: { userId: number; fullName: string }[];
  unread: number;
  lastMessage?: { fromUserId: number; text: string; time?: string };
}
```

- `type`: `"private"` entre dos personas, `"group"` para la conversación de un grupo del curso (con el `name` del grupo), `"self"` para las notas de la persona a sí misma.
- `members`: los miembros que Moodle devuelve con ella (en una conversación privada, la otra persona).
- `unread`: cuántos mensajes no ha leído la persona.
- `lastMessage`: su remitente, su texto y cuándo se envió.

Lee `core_message_get_conversations`, el servicio del cajón, que devuelve solo la página pedida.

## conversation

Los miembros y los mensajes de una conversación, del más antiguo al más reciente, todos o una página cada vez (consulta [Listas largas](../concepts/calling-functions.md#long-lists)).

```ts
function conversation(context: BrowserContext, siteUrl: string, conversationId: number, options?: { limit?: number; offset?: number }): Promise<{
  id: number;
  members: { userId: number; fullName: string }[];
  messages: { id: number; fromUserId: number; text: string; time?: string }[]; // ListPage<…> con limit
}>;
```

- `members`: todos los de la conversación salvo la persona, hayan escrito en ella o no, tal como los da `conversations` (en la conversación de la persona consigo misma, la persona).
- `messages`: su remitente, su texto y cuándo se enviaron. Con `limit`, una página contada desde el mensaje más reciente: la primera página tiene los últimos mensajes, `more` dice que hay otros más antiguos, y los mensajes de cada página siguen llegando del más antiguo al más reciente. `core_message_get_conversation_messages` devuelve solo la página.

`conversationId` es un `id` de `conversations`, o el `conversationId` que devuelve `sendMessage`. Lee `core_message_get_conversation_members` y `core_message_get_conversation_messages`; la persona tiene que ser miembro, o Moodle lo rechaza con un `MoodleServiceError` (consulta [Errores](../concepts/errors.md)).

## sendMessage

Envía un mensaje privado a un usuario, como hace el cajón de mensajería, y devuelve el id del mensaje y su conversación.

```ts
function sendMessage(context: BrowserContext, siteUrl: string, userId: number, text: string): Promise<{ changed: string; messageId: number; conversationId?: number }>;
```

- `userId`: el destinatario (el `userId` de un participante, consulta [Participantes](participants.md)).
- `text`: el mensaje como HTML (`"<p>Hola</p>"`); el texto plano también funciona.

Lanza `MessageError`:

- antes de enviar nada, cuando el texto está vacío una vez quitados su marcado y los espacios de no separación;
- cuando Moodle no lo entrega, con el motivo de Moodle (el destinatario ha bloqueado a la persona, por ejemplo).

Pasa por `core_message_send_instant_messages`.

## messageParticipants

Envía un mensaje a varios participantes de un curso, como hace "Enviar un mensaje" de la página de participantes para los usuarios seleccionados: un mensaje privado a cada uno, en una sola llamada.

```ts
function messageParticipants(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  text: string,
  selection?: { userIds: number[] } | { role?: number; group?: number; inactiveSince?: Date },
): Promise<{ changed: string; sentTo: number[]; refused: { userId: number; reason: string }[] }>;
```

- `selection`: los usuarios por id, o los participantes que elige `participants` con `role`, `group` e `inactiveSince` (consulta [Participantes](participants.md)); sin filtro, todos los participantes. Cuando se eligen por filtros, la persona queda fuera.
- `sentTo` enumera exactamente quién recibió el mensaje; `refused`, a quién no escribió Moodle, con su motivo (han bloqueado a la persona, su privacidad de mensajería).

Lanza `MessageError` antes de enviar nada cuando el texto está vacío o nadie coincide, y `NoParticipantsError` cuando la persona no puede ver los participantes del curso. Quien puede enviar mensajes a cualquier usuario (un profesor, en un sitio predeterminado: `moodle/site:messageanyuser`) atraviesa un bloqueo, como en la propia página de Moodle: un estudiante que ha bloqueado a su profesor sigue recibiendo el mensaje del profesor (comprobado empíricamente, Moodle 5.2).

## Ejemplo {#example}

Leer las notificaciones no leídas y luego responder al último mensaje de un estudiante.

```ts
import { MessageError } from "@falkenslab/moodle-driver";

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

for (const notification of await moodle.notifications({ unreadOnly: true })) {
  console.log(`[${notification.component ?? "sitio"}] ${notification.subject}`);
}
await moodle.markNotificationsRead();

const [latest] = await moodle.conversations();
const other = latest?.members.find((m) => m.userId === 7);
if (latest?.type === "private" && other && latest.unread > 0) {
  try {
    const sent = await moodle.sendMessage(other.userId, "<p>Gracias, Ada. Lo reviso mañana.</p>");
    console.log(sent.changed);
  } catch (error) {
    if (error instanceof MessageError) console.log(error.message);
    else throw error;
  }
}
```

## Categorías de datos {#data-categories}

De `DATA_CATEGORIES` (consulta [Categorías de datos](../concepts/data-categories.md)):

- `notifications`, `markNotificationsRead`: `own`.
- `conversations`, `conversation`: `others-personal` (contienen mensajes de otros).
- `sendMessage`, `messageParticipants`: `communication` (escribir a otros).
