# BigBlueButton

Actividades BigBlueButton (módulo `bigbluebuttonbn`): el estado y el horario de la reunión, si la persona puede entrar ahora, y sus grabaciones; para quienes gestionan las grabaciones, una grabación publicada, despublicada o eliminada; y la URL de la persona para entrar, para que la abra ella. El driver nunca entra en una reunión. Crear una es `createActivity` con `type: "bigbluebuttonbn"` (consulta [Actividades y secciones](activities.md)).

**Términos:** [BigBlueButton](../reference/glossary.md#bigbluebutton) e [id de instancia](../reference/glossary.md#instance-id).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos.

Todas las funciones abren primero la página de la actividad (Moodle registra una visita), para el id de instancia que toman los servicios AJAX de Moodle (`mod_bigbluebuttonbn_meeting_info`, `mod_bigbluebuttonbn_get_recordings`, `mod_bigbluebuttonbn_update_recording`); las celdas de las grabaciones llegan como HTML y se leen por su estructura (atributos data, clases de iconos), así que funciona en cualquier idioma de la interfaz. Todas necesitan el servidor BigBlueButton del sitio: Moodle le pide la reunión y las grabaciones. Lanzan `NotLoggedInError` cuando no hay sesión (consulta [Errores](../concepts/errors.md)).

## Un sitio sin servidor {#a-site-without-a-server}

Un sitio cuyo servidor BigBlueButton no está configurado (sin URL del servidor ni secreto compartido en Administración del sitio > Extensiones > Módulos de actividad > BigBlueButton) muestra una página neutra en lugar de la reunión, y uno cuyo servidor no responde devuelve a la persona al curso. Entonces todas las funciones lanzan `BigBlueButtonServerError` (código `bigbluebutton-server`), nunca un estado vacío: sin servidor no hay estado de la reunión ni grabaciones que leer. Moodle trae el módulo deshabilitado: un administrador lo habilita en Administración del sitio > Extensiones > Módulos de actividad > Gestionar actividades antes de que nadie pueda crear una.

## bigBlueButton

Una actividad BigBlueButton tal como la ve la persona.

```ts
function bigBlueButton(context: BrowserContext, siteUrl: string, activityId: number): Promise<BigBlueButtonActivity>;

interface BigBlueButtonActivity {
  id: number;
  name: string;
  status: "not-open-yet" | "open" | "running" | "closed";
  opensAt?: string;
  closesAt?: string;
  startedAt?: string;
  moderators?: number;
  participants?: number;
  canJoin: boolean;
  moderator: boolean;
  waitForModerator: boolean;
  userLimit?: number;
  recordings: BigBlueButtonRecording[];
}

interface BigBlueButtonRecording {
  id: number;
  name: string;
  description?: string;
  date?: string;
  minutes?: number;
  published: boolean;
  protected?: boolean;
  imported: boolean;
  playbacks: { format: string; url: string }[];
}
```

- `status`: `not-open-yet` antes de su hora de apertura, `open` mientras se puede entrar, `running` mientras hay alguien dentro (entonces `startedAt`, `moderators` y `participants`), `closed` después de su hora de cierre. `opensAt` y `closesAt`: su horario, cuando tiene uno.
- `canJoin`: si la persona puede entrar ahora: está abierta, hay sitio (`userLimit`), hay un moderador cuando los oyentes deben esperarlo (`waitForModerator`), y la persona tiene `mod/bigbluebuttonbn:join`. `moderator`: si entra como moderador.
- `recordings`: todas para quien tiene `mod/bigbluebuttonbn:managerecordings`, las publicadas para los demás; ninguna para una actividad del tipo "solo sala". `date`: cuándo empezó la reunión grabada; `minutes`: su duración, tal como la da el servidor; `playbacks`: las URL de Moodle que la reproducen, en cada `format` ("presentation", "video"…), solo mientras está publicada. `protected` (reproducción solo a través de Moodle) aparece donde el servidor lo admite y la persona puede cambiarlo.

Lanza `BigBlueButtonError` cuando el id no es un BigBlueButton que la persona pueda abrir, y `BigBlueButtonServerError` (consulta [Un sitio sin servidor](#a-site-without-a-server)).

## bigBlueButtonJoinUrl

La URL de la persona para entrar en la reunión: la página de entrada de Moodle (`mod/bigbluebuttonbn/bbb_view.php?action=join…`), que crea la reunión cuando no está en curso y lleva a la persona dentro. Es para que la persona la abra en su navegador; el driver no la abre.

```ts
function bigBlueButtonJoinUrl(context: BrowserContext, siteUrl: string, activityId: number): Promise<string>;
```

Lanza `BigBlueButtonError` diciendo el motivo cuando la persona no puede entrar ahora: aún no abierta o cerrada (con la hora), oyentes esperando a un moderador, la reunión llena, o un rol sin `mod/bigbluebuttonbn:join`.

## setRecordingPublished

Publica o despublica una grabación. Así se oculta una grabación: una grabación despublicada solo aparece a quienes gestionan las grabaciones, y sus reproducciones quedan desactivadas para todos. "Proteger" en Moodle es otra cosa (la reproducción solo a través de Moodle, no por el enlace propio del servidor), que el driver lee como `protected` pero no cambia.

```ts
function setRecordingPublished(context: BrowserContext, siteUrl: string, activityId: number, recordingId: number, published: boolean): Promise<{ changed: string; recording: BigBlueButtonRecording }>;
```

- `recordingId`: una de las `recordings` de `bigBlueButton`; `recording`: la grabación después. No cambia nada cuando ya está así (`changed` lo dice).
- Requiere `mod/bigbluebuttonbn:managerecordings` y `mod/bigbluebuttonbn:publishrecordings` o `mod/bigbluebuttonbn:unpublishrecordings` (los profesores las tienen): sin ellas, `BigBlueButtonError` nombrándolas. Una grabación que la actividad no lista: un `MoodleError` (`not-found`).

## deleteRecording

Elimina una grabación: también en el servidor BigBlueButton, salvo que se importara de otra actividad (entonces solo se va su enlace aquí).

```ts
function deleteRecording(context: BrowserContext, siteUrl: string, activityId: number, recordingId: number): Promise<{ changed: string; recordingId: number }>;
```

Requiere `mod/bigbluebuttonbn:managerecordings` y `mod/bigbluebuttonbn:deleterecordings`; los errores son los de `setRecordingPublished`.

## Ejemplo {#example}

```ts
import { BigBlueButtonError, BigBlueButtonServerError } from "@falkenslab/moodle-driver";

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

try {
  const meeting = await moodle.bigBlueButton(51);
  console.log(`${meeting.name}: ${meeting.status}${meeting.opensAt ? `, abre ${meeting.opensAt}` : ""}`);
  if (meeting.canJoin) console.log(`Entra en ${await moodle.bigBlueButtonJoinUrl(51)}`);

  // Oculta a los estudiantes la grabación de la semana pasada.
  for (const recording of meeting.recordings) {
    console.log(`  ${recording.id} ${recording.name} (${recording.minutes ?? "?"} min) ${recording.published ? "publicada" : "oculta"}`);
  }
  const last = meeting.recordings[0];
  if (last?.published) console.log((await moodle.setRecordingPublished(51, last.id, false)).changed);
} catch (error) {
  if (error instanceof BigBlueButtonServerError) console.error(`Sin servidor: ${error.message}`);
  else if (error instanceof BigBlueButtonError) console.error(error.message);
  else throw error;
}
```

## Categorías de datos {#data-categories}

- `bigBlueButton`: `course-content` y `others-personal` (la reunión y sus grabaciones, que muestran a las personas que hay en ellas).
- `bigBlueButtonJoinUrl`: `own` (la forma de entrar de la persona).
- `setRecordingPublished`, `deleteRecording`: `course-content`.

Consulta [Categorías de datos](../concepts/data-categories.md).
