# Calificar

El lado del profesor en una tarea, en los foros y en los talleres: las calificaciones de foro completo con `forumGrades` y `gradeForumUser`, las valoraciones de mensajes de foro, entradas de glosario y entradas de bases de datos con `rate`, y un taller de principio a fin: sus fases, la asignación y las evaluaciones con `workshopInfo`, `setWorkshopPhase`, `workshopAllocation`, `allocateReviewer`, `removeReviewer`, `allocateRandomly`, `scheduleAllocation` y `assessWorkshopSubmission`, la entrega de un participante con `workshopSubmission` y `saveWorkshopSubmission`, los envíos de ejemplo con `workshopExamples`, `addWorkshopExample`, `editWorkshopExample`, `deleteWorkshopExample` y `assessWorkshopExample`, y sus calificaciones con `calculateWorkshopGrades` y `overrideWorkshopGrade`. En una tarea: las entregas de todos con su contenido y sus fechas, calificar a un participante como lo hace el calificador de Moodle (una calificación simple o una escala, los niveles de una rúbrica, las puntuaciones de una guía de evaluación, observaciones y comentarios de retroalimentación), leer el método de calificación y sus criterios, definir una rúbrica o una guía de evaluación, y conceder ampliaciones del plazo; los archivos de retroalimentación van con la calificación. También se cubren las tareas con entregas en grupo y el flujo de trabajo de calificación: quién entrega por qué grupo, calificar a todo un grupo a la vez, los estados del flujo de trabajo, los evaluadores y la publicación de calificaciones. Necesita permisos de profesor en la tarea (las capacidades de calificación de Moodle); a un estudiante, Moodle se lo rechaza. Calificar pasa por el propio panel y servicio del calificador (`core_get_fragment` con el `gradingpanel` de `mod_assign`, y luego `mod_assign_submit_grading_form`), y los campos se encuentran por sus nombres en el formulario, así que funciona en cualquier idioma. El lado del estudiante está en [tareas](assignments.md); las excepciones de los cuestionarios, en [cuestionarios](quizzes.md).

**Términos:** [tarea](../reference/glossary.md#assignment), [entrega](../reference/glossary.md#submission), [método de calificación](../reference/glossary.md#grading-method), [ampliación del plazo](../reference/glossary.md#extension), [escala](../reference/glossary.md#scale), [taller](../reference/glossary.md#workshop).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos; las primitivas de más bajo nivel están en `@falkenslab/moodle-driver/internals` (consulta [Bajar de nivel](../concepts/low-level.md)).

## assignmentSubmissions

La entrega de cada participante en una tarea.

```ts
function assignmentSubmissions(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  options?: { includeContent?: boolean; userIds?: number[]; limit?: number; offset?: number },
): Promise<Submission[]>; // ListPage<Submission> con limit
```

`activityId` es el id de actividad de la tarea (id del módulo del curso). `userIds` se limita a esos participantes; `limit` y `offset` dan una página de ellos en el orden del calificador (consulta [Listas largas](../concepts/calling-functions.md#long-lists)). El servicio de participantes de Moodle lista a todos de una vez, así que la lista se recorta, pero solo se sigue leyendo a los participantes de la página (sus fechas, ampliaciones del plazo y paneles de calificación): una página cuesta las peticiones de una página. Cada `Submission` tiene:

- `userId`, `fullName`: el participante.
- `status`: el estado de la entrega en Moodle, `"submitted"`, `"draft"`, `"new"`, `"reopened"`, o `"none"` si no hay entrega.
- `submitted`: enviada para calificar.
- `needsGrading`: Moodle dice que requiere calificación.
- `extensionGranted`: el participante tiene una ampliación del plazo.
- `extensionDueDate`: hasta cuándo (ISO 8601), si se ha concedido una ampliación del plazo.
- `allowSubmissionsFrom`, `dueDate`, `cutoffDate`: para este participante, con sus excepciones y ampliaciones del plazo aplicadas (ISO 8601; ausentes cuando la tarea no las tiene).
- `feedbackFiles`: los archivos adjuntos a la retroalimentación del participante, `{ name, url }`, cuando la tarea tiene activados los archivos de retroalimentación. Se leen tal como los tiene el gestor de archivos del calificador: `url` es la copia de trabajo de la persona (`draftfile.php`), que [downloadFile](files.md) guarda mientras dure la sesión; el estudiante ve los enlaces propios de los archivos guardados (`studentAssignment`).
- `group`: con entregas en grupo ("Los estudiantes envían en grupo"), el grupo por el que entrega el participante, `{ id, name }`; ausente para un participante que no está en ningún grupo (el "Grupo por defecto" de Moodle).
- `workflowState`: con el flujo de trabajo de calificación, el estado de la entrega: `"notmarked"`, `"inmarking"`, `"readyforreview"` (calificación completada), `"inreview"`, `"readyforrelease"` o `"released"`. Los estudiantes solo ven su calificación cuando está publicada.
- `markers`: con la asignación de evaluadores, los evaluadores asignados a la entrega, `{ id, name }[]` (Moodle 5.2 permite varios por entrega; vacío cuando no hay ninguno).
- `content`: por cada plugin de entrega, `{ plugin, text, files }`: `plugin` es el nombre del plugin (`"onlinetext"`, `"file"`…), `text` su contenido como texto plano conservando párrafos y listas, `files` sus enlaces `{ name, url }` (para [downloadFile](files.md)). Solo en entregas enviadas y en borrador; el plugin de comentarios no forma parte de él.

`includeContent` es `true` por defecto. El contenido, los archivos de retroalimentación, el estado del flujo de trabajo y los evaluadores salen del panel de calificación de cada participante (el grupo, del servicio de participantes, siempre), una llamada al servicio por participante (y un listado de los archivos de retroalimentación del panel cuando la tarea los tiene); con `includeContent: false` no se carga nada de eso, lo que es mucho más rápido en un curso grande cuando solo hacen falta los estados. El panel solo se abre para los participantes con entrega: el panel de calificación de Moodle crea una entrega vacía (`"new"`) para un participante que no tiene ninguna, así que leer deja a un participante que nunca entregó en `"none"`, sin archivos de retroalimentación, estado del flujo de trabajo ni evaluadores. Aun así, abrirlo no está libre de escrituras, como en el calificador de Moodle: un participante con entrega y sin calificación recibe una vacía (sin calificar), y Moodle registra un evento "Formulario de calificación visto". Los participantes se leen de uno en uno; la fecha de una ampliación del plazo sale del formulario de ampliación (ningún servicio abierto a AJAX la da), una página por cada participante con ampliación.

Lanza `NotAnAssignmentError` cuando el id no es una tarea que la persona pueda calificar, y transmite los rechazos de los servicios como `MoodleServiceError`.

## gradeSubmission

Califica a un participante como lo hace el calificador, y vuelve a leer la calificación.

```ts
function gradeSubmission(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  userId: number,
  input: {
    grade?: string | number;
    rubric?: Record<number, number>; // id del criterio -> id del nivel
    guide?: Record<number, number>; // id del criterio -> puntuación
    remarks?: Record<number, string>; // id del criterio -> observación
    feedback?: string;
    feedbackFiles?: string[];
    workflowState?: WorkflowState;
    applyToGroup?: boolean;
    notify?: boolean;
    fields?: Record<string, FieldValue>;
  },
): Promise<{ changed: string; grade?: string; gradebookGrade?: string; feedback?: string; feedbackFiles?: { name: string; url: string }[]; workflowState?: WorkflowState }>;

type WorkflowState = "notmarked" | "inmarking" | "readyforreview" | "inreview" | "readyforrelease" | "released";
```

- `grade`: en la calificación simple, la calificación como número (`8.5`) o tal como la admite el campo del calificador (`"8.5"`, o `"8,5"` donde el sitio escribe los decimales con coma); en una escala, el valor del elemento de la escala.
- `rubric`: en una rúbrica, el nivel elegido en cada criterio, por los ids que da `rubric()`.
- `guide`: en una guía de evaluación, la puntuación de cada criterio.
- `remarks`: la observación de una rúbrica o de una guía en cada criterio.
- `feedback`: comentarios de retroalimentación (HTML), cuando la tarea tiene activados los comentarios de retroalimentación.
- `feedbackFiles`: rutas locales absolutas de archivos para la retroalimentación (un PDF corregido, un comentario de audio), cuando la tarea tiene activados los archivos de retroalimentación. Sustituyen a los archivos que tenía el participante: se borra lo que contiene el gestor de archivos del panel, y luego se suben desde la página de calificación de Moodle del participante (`mod/assign/view.php?action=grade`, cuyo selector de archivos lleva el repositorio de subida), antes de enviar el formulario. `[]` los quita todos; sin la opción se quedan como están.
- `workflowState`: con el flujo de trabajo de calificación, el estado en el que queda la entrega (`WORKFLOW_STATES` los lista); `"released"` muestra la calificación al estudiante, cualquier otro estado la mantiene oculta. Moodle ofrece a cada persona solo los estados que puede poner (publicar requiere su propia capacidad).
- `applyToGroup`: con entregas en grupo, si la calificación y la retroalimentación van a todos los miembros del grupo del participante (`true`, el valor por defecto de Moodle) o solo a él.
- `notify`: si Moodle notifica al estudiante; si no, el valor por defecto del panel.
- `fields`: cualquier otro campo del formulario del panel de calificación por su nombre (el de otro plugin de retroalimentación, un estado del flujo de trabajo…); las opciones con nombre prevalecen para el mismo campo.

Rellena el formulario del panel en una pestaña en blanco (no se carga nada de la página del calificador), lo envía mediante `mod_assign_submit_grading_form`, y luego vuelve a leer el panel. El resultado tiene:

- `changed`: lo que se hizo.
- `grade`: el valor actual del campo de calificación, en la calificación simple.
- `gradebookGrade`: la "Calificación actual en el libro de calificaciones" que muestra Moodle, que en una rúbrica o una guía es el total que ha calculado a partir de los niveles o las puntuaciones (`"75.00"`); ausente cuando no hay ninguna.
- `feedback`: los comentarios de retroalimentación actuales.
- `feedbackFiles`: cuando se indicaron archivos, los archivos de retroalimentación actuales del participante, tal como los da `assignmentSubmissions`.
- `workflowState`: el estado actual de la entrega en el flujo de trabajo, con el flujo de trabajo de calificación.

Con el flujo de trabajo de calificación, `gradebookGrade` sigue "sin calificar" hasta que se publica la calificación: solo entonces la recibe el libro de calificaciones.

Errores:

- `NotAnAssignmentError` cuando el id no es una tarea que la persona pueda calificar.
- `FormError` cuando un campo no está en el formulario del panel, como un id de criterio o de nivel que no existe (`advancedgrading[criteria][9][levelid]`), o `grade` en una tarea calificada con rúbrica.
- Un `MoodleError` (`not-available`) cuando se indica `feedback` y la tarea no tiene comentarios de retroalimentación; no se guarda nada.
- `GradingError` cuando se indica `feedbackFiles` y la tarea no tiene archivos de retroalimentación, `workflowState` y no usa el flujo de trabajo de calificación (o el estado no es uno que el formulario ofrezca a la persona), o `applyToGroup` y no admite entregas en grupo; no se guarda nada.
- Un `MoodleError` (`invalid-input`, `not-found`) cuando una ruta de archivo no es absoluta o no existe, comprobado antes de nada; `FormError` cuando falla la subida (no hay repositorio de subida, un archivo demasiado grande).
- `GradingError` cuando Moodle no guarda la calificación. El servicio de Moodle solo responde que no pudo guardarla, sin el motivo: normalmente, una calificación fuera del rango o de la escala de la tarea, o el nombre de un campo.

## rubric

El método de calificación de una tarea y, en una rúbrica o una guía de evaluación, sus criterios con los ids que recibe `gradeSubmission`.

```ts
function rubric(context: BrowserContext, siteUrl: string, activityId: number): Promise<{ assignment: { id: number }; method: "simple" | "rubric" | "guide"; criteria: GradingCriterion[] }>;

interface GradingCriterion {
  id: number;
  description: string;
  details?: string;
  markers?: string;
  levels?: { id: number; definition: string; score: number }[];
  maxScore?: number;
}
```

`method` es `"simple"` para una calificación sencilla o una escala (sin criterios), y `"rubric"` o `"guide"` para la calificación avanzada. Un criterio de rúbrica tiene su `description` y sus `levels` (`id` para `gradeSubmission`, la `definition` del nivel y su `score`). Un criterio de guía tiene su nombre corto como `description`, su descripción para los estudiantes (`details`) y para los evaluadores (`markers`), y su `maxScore`.

Se lee del panel de calificación del primer participante de la tarea con entrega, así que lanza `GradingError` cuando la tarea no tiene participantes. Cuando nadie ha entregado todavía, el panel es el del primer participante, y Moodle le crea una entrega vacía (`"new"`) al abrirlo. Lanza `NotAnAssignmentError` cuando el id no es una tarea que la persona pueda calificar.

## setGradingDefinition

Establece el método de calificación avanzada de una tarea, una rúbrica o una guía de evaluación, y guarda su definición lista para usarse, como lo hacen la página de calificación avanzada de Moodle y su editor de rúbricas o de guías.

```ts
function setGradingDefinition(context: BrowserContext, siteUrl: string, activityId: number, definition: GradingDefinitionInput): Promise<{ changed: string; assignment: { id: number }; method: "rubric" | "guide"; criteria: GradingCriterion[] }>;

type GradingDefinitionInput =
  | { method: "rubric"; name: string; description?: string; criteria: { description: string; levels: { definition: string; score: number }[] }[] }
  | { method: "guide"; name: string; description?: string; criteria: { shortName: string; description?: string; markers?: string; maxScore: number }[]; comments?: string[] };
```

`name` es el nombre de la definición y `description` su descripción (HTML). Cada criterio de una rúbrica tiene una descripción y dos niveles como mínimo, y cada nivel su definición y su puntuación. Cada criterio de una guía tiene un nombre corto, una descripción para los estudiantes y los evaluadores (`description`), otra solo para los evaluadores (`markers`) y una puntuación máxima; `comments` son sus comentarios de uso frecuente. Los criterios, los niveles y los comentarios van en el orden dado.

Cuando la tarea no tiene una definición para ese método, se crea una; cuando ya la tiene, se sustituye entera (criterios, niveles y comentarios), así que sus ids cambian. El método de calificación se establece cuando es otro. Devuelve la definición tal como la lee [`rubric`](#rubric), con los ids que recibe `gradeSubmission`, pero leída del editor de la definición, no de un panel de calificación: no crea una entrega a nadie.

El editor de Moodle deja cambiar una definición libremente solo mientras no se ha calificado nada con ella; después, guardarla pide recalificar. Por eso una definición ya usada para calificar se rechaza con `GradingError` antes de cambiar nada (tampoco el método): cámbiala en el editor de Moodle, o bórrala antes en la página de calificación avanzada de la tarea. También lanza `GradingError` cuando la persona no puede gestionar los formularios de calificación (la capacidad `moodle/grade:managegradingforms` de Moodle, que tienen los profesores y no los profesores sin permiso de edición) o cuando el editor de Moodle no guarda la definición (con sus motivos); `MoodleError` (`invalid-input`) antes de abrir nada, para una definición que el editor no aceptaría (sin nombre, sin criterios, un criterio de rúbrica con menos de dos niveles, puntuaciones más altas que suman 0, una puntuación máxima negativa); y `NotAnAssignmentError` cuando el id no es una tarea que la persona pueda calificar.

```ts
const rubric = await moodle.setGradingDefinition(1234, {
  method: "rubric",
  name: "Bucles",
  criteria: [
    { description: "Explica un bucle", levels: [{ definition: "No", score: 0 }, { definition: "En parte", score: 1 }, { definition: "Con claridad", score: 2 }] },
    { description: "Da un ejemplo", levels: [{ definition: "Ninguno", score: 0 }, { definition: "Correcto", score: 2 }] },
  ],
});
console.log(rubric.changed);
const [explains, example] = rubric.criteria;
await moodle.gradeSubmission(1234, 7, { rubric: { [explains!.id]: explains!.levels![2]!.id, [example!.id]: example!.levels![1]!.id } });
```

## grantExtension

Concede a uno o más participantes una ampliación del plazo hasta una fecha, mediante el formulario de ampliación de la tarea (varios a la vez, como hace su acción en bloque).

```ts
function grantExtension(context: BrowserContext, siteUrl: string, activityId: number, userIds: number[], until: Date): Promise<{ changed: string }>;
```

La fecha se escribe en el selector de fecha del formulario en la zona horaria de la persona en Moodle (`M.cfg.usertimezone`), que es como la lee Moodle, así que `until` es el momento exacto sea cual sea la zona horaria del programa. El selector de fecha de Moodle tiene minutos, así que los segundos se descartan. Concederla de nuevo sustituye la ampliación.

Errores:

- `GradingError` cuando `userIds` está vacío.
- `NotAnAssignmentError` cuando no se puede abrir el formulario de ampliación (la actividad no es una tarea), o cuando Moodle se niega a guardarlo con su página de error (la persona no puede conceder ampliaciones: Moodle abre el formulario a cualquiera y solo lo comprueba al guardar), con el motivo de Moodle.
- `FormError` cuando Moodle rechaza el formulario, con su mensaje por campo: una fecha anterior a la fecha de entrega de la tarea, por ejemplo. También cuando la zona horaria de la persona en Moodle no es una que conozca el driver.

`assignmentSubmissions` informa de la fecha concedida como `extensionDueDate`.

## setWorkflowState

Pone el estado del flujo de trabajo de calificación de las entregas de varios participantes a la vez, como hace "Establecer el estado del flujo de trabajo de calificación" de la tabla de calificación (`mod/assign/view.php?action=viewbatchsetmarkingworkflowstate`), y publica sus calificaciones con `"released"`.

```ts
function setWorkflowState(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  userIds: number[],
  state: "inmarking" | "readyforreview" | "inreview" | "readyforrelease" | "released",
  options?: { notify?: boolean },
): Promise<{ changed: string }>;
```

- `state`: cualquier estado salvo `"notmarked"`, que el formulario no ofrece. Publicar hace visibles la calificación y la retroalimentación a los estudiantes y pone la calificación en el libro de calificaciones.
- `notify`: al publicar, si Moodle notifica a los estudiantes, como hace "Notificar a los estudiantes" del formulario; `false` por defecto, el valor por defecto del formulario. Moodle solo notifica al publicar, así que `notify` con otro estado se rechaza.

Con entregas en grupo, los miembros de un grupo son participantes separados: indica el id de todos los miembros (`assignmentSubmissions` da el `group` de cada uno). Con varios evaluadores por entrega, pone el estado global de la entrega (el contexto "Calificación" del formulario), no la calificación propia de la persona. Moodle se salta a los participantes cuya calificación está deshabilitada (bloqueada, o una entrega en la que no se les puede calificar).

Errores (`GradingError`): `userIds` vacío; un estado que no existe, o que el formulario no ofrece a la persona (publicar requiere la capacidad "publicar calificaciones" de Moodle); `notify` sin publicar; una tarea sin el flujo de trabajo de calificación (se lee del panel de calificación de un participante con entrega, o del primero indicado, antes de enviar nada: el formulario en bloque de Moodle se abriría y guardaría igualmente); Moodle no abre el formulario (la persona no tiene permiso), con el motivo de Moodle cuando lo da. `NotAnAssignmentError` cuando el id no es una tarea que la persona pueda calificar. `FormError` cuando Moodle rechaza el formulario.

## allocateMarker

Asigna un evaluador a las entregas de varios participantes, como hace "Asignar evaluador" de la tabla de calificación (`mod/assign/view.php?action=viewbatchmarkingallocation`), en una tarea con el flujo de trabajo de calificación y la asignación de evaluadores activados.

```ts
function allocateMarker(context: BrowserContext, siteUrl: string, activityId: number, userIds: number[], markerId: number | number[]): Promise<{ changed: string }>;
```

- `markerId`: el id de usuario de alguien del curso que puede calificar la tarea; un array cuando la tarea usa varios evaluadores por entrega (el "Número de evaluadores" de Moodle 5.2), uno por evaluador en orden. Los que no se indican quedan sin asignar. Moodle 4.5 tiene un evaluador por entrega: allí, un solo id.

Moodle no toca las entregas cuyo estado ya ha pasado de la calificación (calificación completada, en revisión, lista para publicar, publicada). `assignmentSubmissions` da los `markers` de cada entrega.

Errores (`GradingError`): `userIds` o `markerId` vacíos; una tarea sin asignación de evaluadores, o una persona que no puede gestionar las asignaciones (se lee del panel de calificación de un participante con entrega, o del primero indicado, antes de enviar nada: el formulario en bloque de Moodle se abriría y guardaría igualmente); más evaluadores de los que usa la tarea; un usuario que no puede calificarla; Moodle no abre el formulario, con su motivo, como una tarea que necesita más evaluadores por entrega de los que tiene el curso ("No hay suficientes evaluadores (1) para alcanzar el número requerido para esta tarea (2)").

## forumGrades

La calificación de foro completo de todos en un foro calificado en conjunto ("Calificación de foro completo" en los ajustes del foro), tal como la muestra el calificador "Calificar usuarios" del foro.

```ts
function forumGrades(context: BrowserContext, siteUrl: string, activityId: number, options?: { groupId?: number }): Promise<ForumGrades>;

interface ForumGrades {
  activityId: number;
  method: "point" | "scale";
  maxGrade?: number;
  scale?: { value: number; name: string }[];
  grades: ForumGrade[];
}

interface ForumGrade {
  userId: number;
  fullName: string;
  grade?: string;
  value?: number;
  gradedBy?: string;
  gradedAt?: string;
}
```

- `method`: sobre puntos (`maxGrade`) o con una escala (`scale`, sus elementos por valor).
- `grades`: una por persona a la que el calificador puede calificar (los usuarios calificables del curso, solo los activos cuando el foro lo indica; los de un grupo con `groupId`). `grade` viene tal como lo muestra Moodle ("8,00 / 10,00", el nombre de un elemento de la escala), `value` es el número guardado; ambos se omiten cuando la persona no tiene calificación.

Lee los ids del botón del calificador de la página del foro y pasa por los propios servicios del calificador (`core_grades_get_gradable_users`, `core_grades_grader_gradingpanel_point_fetch` o `…_scale_fetch`), una llamada por persona. Lanza `NotAForumError` con otra actividad, y `GradingError` cuando el foro no se califica en conjunto (o la persona no puede calificarlo) o usa un método de calificación avanzado (una rúbrica), que el driver no rellena en los foros.

## gradeForumUser

Da a una persona su calificación de foro completo, como hace el panel del calificador.

```ts
function gradeForumUser(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  userId: number,
  options: { grade: number | string | null; notify?: boolean },
): Promise<{ changed: string; grade: Omit<ForumGrade, "fullName"> }>;
```

- `grade`: puntos (de 0 al máximo del foro), o el nombre o el valor de un elemento de la escala; `null` quita la calificación. Una calificación fuera de rango o que no está en la escala lanza `GradingError` antes de enviar nada.
- `notify`: envía a la persona la notificación de calificación de Moodle, como hace la casilla del panel (desactivada por defecto).

El calificador de foros de Moodle no tiene texto de retroalimentación, así que no hay ninguno que dar. La calificación va al libro de calificaciones como el elemento "foro completo" del foro, junto a su elemento "valoración" cuando el foro también usa [valoraciones](#rate).

## rate

Valora un mensaje de foro, una entrada de glosario o una entrada de una base de datos como la persona, como hace el menú de valoración que tiene debajo.

```ts
function rate(context: BrowserContext, siteUrl: string, item: RateableItem, rating: number | string | null): Promise<{ changed: string; aggregate?: string; count?: number }>;

type RateableItem =
  | { type: "forum-post"; id: number; discussionId: number }
  | { type: "glossary-entry"; id: number }
  | { type: "database-record"; id: number };
```

- `item`: un mensaje de foro por su id y el de su debate (de [`discussion`](forums.md#discussion)), una entrada de glosario o una entrada de una base de datos.
- `rating`: el número de una escala de puntos, o el nombre o el valor de un elemento de una escala; `null` quita la valoración de la persona.
- `aggregate`, `count`: el agregado del elemento después, según como agregue las valoraciones la actividad (promedio, recuento, máximo…), y cuántas valoraciones tiene; no hay `aggregate` cuando no queda ninguna.

Abre la página del elemento (`mod/forum/discuss.php`; en una entrada de glosario, el `mod/glossary/view.php` de su glosario mostrando la entrada, ya que el propio `showentry.php` de la entrada no tiene valoraciones; `mod/data/view.php`), lee el formulario de valoración del elemento por sus campos ocultos y su menú, y lo envía a `rating/rate_ajax.php` como hace el propio script de la página. Lanza `GradingError` cuando el elemento no tiene menú de valoración para la persona (la actividad no usa valoraciones, el elemento es suyo, el periodo de valoración ha terminado, o no tiene permiso para valorar), cuando la valoración no está en el menú, y cuando Moodle la rechaza. Las valoraciones de mensajes de foro se han comprobado con Moodle 5.2; las entradas de glosario y de bases de datos usan el mismo formulario de valoración, en sus propias páginas.

Las valoraciones de un foro y su calificación de foro completo son elementos de calificación separados en el libro de calificaciones, y ambos aparecen en [`graderReport`](grades-and-gradebook.md#graderreport).

## workshopInfo

La fase de un taller, y su informe tal como lo muestra a un profesor la página del taller.

```ts
function workshopInfo(context: BrowserContext, siteUrl: string, activityId: number): Promise<WorkshopInfo>;

type WorkshopPhase = "setup" | "submission" | "assessment" | "evaluation" | "closed";

interface WorkshopInfo {
  activityId: number;
  phase: WorkshopPhase;
  submissions: WorkshopSubmission[];
  assessments: WorkshopAssessment[];
}

interface WorkshopSubmission {
  id: number;
  title: string;
  authorId: number;
  author: string;
  grade?: number;
  gradeOverride?: number;
}

interface WorkshopAssessment {
  id: number;
  submissionId?: number;
  authorId?: number;
  author?: string;
  reviewerId?: number;
  reviewer?: string;
  grade?: number;
  gradingGrade?: number;
  gradingGradeOverride?: number;
  weight: number;
}
```

- `phase`: la fase en la que está el taller (`WORKSHOP_PHASES` las lista en orden).
- `submissions`: una por cada participante que entregó, con la calificación por la entrega una vez que la fase de calificación de evaluaciones la ha calculado (sobre la "calificación por la entrega" del taller), y la calificación con la que el profesor la sobrescribe.
- `assessments`: cada evaluación de una entrega, con su revisor (se omite cuando la persona no puede ver los nombres de los revisores), el autor de la entrega, la calificación que da (sobre el mismo máximo; se omite hasta que se evalúa), su peso, y la calificación por la propia evaluación una vez calculada.

Lee la página del taller (`mod/workshop/view.php`), todas las páginas de su informe, por las clases y los enlaces de la lista de fases y del informe, así que funciona en cualquier idioma. Moodle muestra el informe desde la fase de envío en adelante a quienes pueden ver todas las entregas (un profesor), en el grupo actual del curso; para un estudiante, ambas listas están vacías. Las calificaciones son números tal como los muestra Moodle, con tantos decimales como dicen los ajustes del taller. Las calificaciones de la fase de calificación de evaluaciones se calculan con [`calculateWorkshopGrades`](#calculateworkshopgrades). Lanza `WorkshopError` con una actividad que no es un taller que la persona pueda ver.

## setWorkshopPhase

Cambia un taller a una fase, como hacen los enlaces de fase de su página.

```ts
function setWorkshopPhase(context: BrowserContext, siteUrl: string, activityId: number, phase: WorkshopPhase): Promise<{ changed: string; phase: WorkshopPhase }>;
```

Abre la confirmación de Moodle (`mod/workshop/switchphase.php`) y la confirma, y luego lee la fase de la página del taller a la que llega. Se puede elegir cualquier fase, hacia delante o hacia atrás. Cambiar de fase solo hace eso: las entregas se asignan a los revisores con las funciones de más abajo ("Asignar envíos" de Moodle), y las calificaciones se calculan con `calculateWorkshopGrades`. Lanza `WorkshopError` con el motivo de Moodle cuando la persona no puede cambiar de fase (un estudiante), y `MoodleError` (`invalid-input`) con una fase que no es una de las cinco.

## assessWorkshopSubmission

Evalúa una entrega como la persona, mediante el formulario de evaluación del taller.

```ts
function assessWorkshopSubmission(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  submissionId: number,
  input: { criteria?: WorkshopCriterion[]; feedback?: string; fields?: Record<string, FieldValue> },
): Promise<{ changed: string; assessmentId: number; grade?: number; maxGrade?: number }>;

interface WorkshopCriterion {
  grade?: number | string;
  comment?: string;
}
```

- `criteria`: uno por cada criterio del formulario, en su orden (el primero es el "Aspecto 1" del formulario). Lo que admite `grade` depende de la estrategia de calificación del taller: en la calificación acumulativa, los puntos (`8`) o el nombre de un elemento de una escala; en número de errores, `1` cuando la afirmación se cumple y `-1` cuando no (o la palabra que haya puesto el profesor para cada caso); en rúbrica, el nivel, por su posición (`1` para el primero) o su definición; en comentarios, nada. `comment` es el comentario sobre el criterio (no en una rúbrica).
- `feedback`: la retroalimentación global para el autor (HTML), cuando el taller tiene activada la retroalimentación global.
- `fields`: cualquier otro campo del formulario por su nombre, como `weight` (el peso de la evaluación, para un profesor).
- `grade`, `maxGrade`: la calificación que la evaluación da a la entrega, sobre la calificación por la entrega del taller, tal como la muestra después la página de la evaluación.

Un profesor que no ha evaluado la entrega recibe una evaluación propia, como hace "Evaluar" en la página de la entrega (`mod/workshop/submission.php`); una que la persona ya hizo (la de un profesor, o la asignada a un revisor) se cambia. El formulario (`mod/workshop/assessment.php`) se rellena por los nombres de sus campos y se guarda con "Guardar y continuar editando". Moodle solo deja evaluar en la fase de evaluación. Lanza `WorkshopError` cuando Moodle no ofrece ninguna evaluación (otra fase, o la persona no es revisor ni profesor), cuando la calificación de un criterio no es una que admita (el error lista las que admite), cuando se indican más criterios de los que tiene el formulario, o cuando el taller no tiene retroalimentación global; `FormError` con los mensajes de Moodle cuando rechaza el formulario (un criterio sin calificación).

Un participante entrega con [`saveWorkshopSubmission`](#saveworkshopsubmission). Un revisor asignado a su propia entrega (autoevaluación) la evalúa de la misma forma.

## workshopAllocation

Quién evalúa a quién en un taller: su asignación, tal como la muestra a un profesor la página de asignación manual de Moodle.

```ts
function workshopAllocation(context: BrowserContext, siteUrl: string, activityId: number): Promise<WorkshopAllocation>;

interface WorkshopAllocation {
  activityId: number;
  submissions: WorkshopAllocatedSubmission[];
  potentialReviewers: { userId: number; fullName: string }[];
}

interface WorkshopAllocatedSubmission {
  id: number;
  title: string;
  authorId: number;
  author: string;
  reviewers: WorkshopReviewer[];
}

interface WorkshopReviewer {
  assessmentId: number;
  reviewerId: number;
  reviewer: string;
}
```

- `submissions`: una por cada participante que entregó, con los revisores asignados a ella. Una asignación es una evaluación que crea Moodle, vacía hasta que el revisor evalúa: `assessmentId` es su id. La evaluación propia de un profesor sobre una entrega también cuenta como asignación.
- `potentialReviewers`: los participantes que Moodle ofrece como revisores, los que pueden evaluar a sus compañeros en el curso (sus estudiantes).

Lee todas las páginas de la página de asignación manual (`mod/workshop/allocation.php`) por las clases de las celdas y los enlaces de su tabla, en el grupo actual del curso, en cualquier fase. Lanza `WorkshopError` cuando la persona no puede asignar (la capacidad `mod/workshop:allocate` de Moodle, de un profesor; a un estudiante, Moodle se lo rechaza) o el id no es de un taller.

## allocateReviewer

Asigna un revisor a una entrega, como hace el menú "Añadir revisor" de la página de asignación manual.

```ts
function allocateReviewer(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  input: { submissionId?: number; authorId?: number; reviewerId: number },
): Promise<{ changed: string; added: boolean; assessmentId: number; submission: WorkshopAllocatedSubmission }>;
```

- `submissionId` o `authorId`: la entrega, por su id o por el id de usuario de su autor (uno de los dos).
- `reviewerId`: el id de usuario del revisor; tiene que ser uno de los que el menú de Moodle ofrece para la entrega (un participante que puede evaluar a sus compañeros, no el autor salvo que el taller permita la autoevaluación).
- `added`: false cuando el revisor ya estaba asignado (entonces no cambia nada); `assessmentId`: la evaluación de la asignación; `submission`: la entrega y sus revisores después.

Moodle asignaría por sí mismo cualquier id de usuario que se le dé, también a alguien de fuera del curso; el driver asigna solo a quienes ofrece su menú, y lanza `WorkshopError` con cualquier otro (el error lista a quiénes ofrece), con el autor cuando la autoevaluación está desactivada, con una entrega que no encuentra (un autor sin entrega), y cuando la persona no puede asignar. Asignar funciona en cualquier fase; los revisores evalúan en la fase de evaluación.

## removeReviewer

Quita la asignación de un revisor a una entrega, como hace el icono de borrar de la página de asignación manual.

```ts
function removeReviewer(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  input: { submissionId?: number; authorId?: number; reviewerId: number; evenIfAssessed?: boolean },
): Promise<{ changed: string; assessmentId: number; submission: WorkshopAllocatedSubmission }>;
```

Moodle borra la evaluación de la entrega por parte del revisor. Antes pregunta, y avisa cuando el revisor ya la ha evaluado: el driver pasa por esa pregunta y se detiene ahí con `WorkshopError` salvo que se indique `evenIfAssessed`, porque se pierden la evaluación y su calificación. También lanza `WorkshopError` cuando el revisor no está asignado a la entrega y cuando la persona no puede asignar.

## allocateRandomly

Asigna las entregas a los revisores al azar, como hace el formulario de asignación aleatoria de Moodle.

```ts
function allocateRandomly(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  settings: RandomAllocationSettings,
): Promise<{ changed: string; added: number; removed: number; report: string[]; problems: string[]; allocation: WorkshopAllocation }>;

interface RandomAllocationSettings {
  perSubmission?: number;
  perReviewer?: number;
  keepCurrent?: boolean;
  withoutSubmission?: boolean;
  selfAssessment?: boolean;
  excludeSameGroup?: boolean;
}
```

- `perSubmission` o `perReviewer` (uno de los dos): cuántas revisiones recibe cada entrega, o hace cada revisor (el "Número de revisiones" de Moodle).
- `keepCurrent`: conserva las asignaciones que hay (por defecto), o las quita antes (el "Eliminar las asignaciones actuales" de Moodle; nunca quita una evaluación ya calificada).
- `withoutSubmission`: también revisores sin entrega propia (desactivado por defecto, como en el formulario de Moodle).
- `selfAssessment`: añade la autoevaluación de cada autor, cuando el taller permite la autoevaluación.
- `excludeSameGroup`: sin revisiones entre compañeros del mismo grupo, solo en el modo de grupos visibles (en grupos separados Moodle asigna dentro de cada grupo).
- `added`, `removed`: las asignaciones añadidas y quitadas, contadas a partir de la asignación de antes y de después; `report`: el relato de Moodle de lo que hizo, línea a línea, en el idioma del sitio; `problems`: las líneas que Moodle marca como errores (no hay revisores suficientes, una evaluación calificada que conservó); `allocation`: la asignación después.

Lanza `WorkshopError` con un ajuste que el taller no tiene (la autoevaluación desactivada, no está en modo de grupos visibles) y cuando la persona no puede asignar, `MoodleError` (`invalid-input`) sin número de revisiones o con los dos, y `FormError` cuando Moodle rechaza el formulario.

## scheduleAllocation

Activa o desactiva la asignación programada, como hace el formulario de asignación programada de Moodle.

```ts
function scheduleAllocation(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  settings: RandomAllocationSettings & { enabled: boolean },
): Promise<{ changed: string } & ScheduledAllocation>;

interface ScheduledAllocation {
  enabled: boolean;
  perSubmission?: number;
  perReviewer?: number;
  keepCurrent: boolean;
  withoutSubmission: boolean;
  selfAssessment: boolean;
  status: string;
}
```

Cuando está activada, Moodle ejecuta por sí mismo la asignación aleatoria, con estos ajustes, al final de la fase de envío: una vez pasada la fecha límite de envíos del taller, desde sus tareas programadas. Los ajustes que no se indican conservan lo que tiene el formulario. Devuelve la asignación programada tal como la muestra el formulario después, con `status`, lo que dice Moodle de ella (un taller sin fecha límite de envíos nunca se asigna, y el estado lo dice). Errores como en `allocateRandomly`.

## workshopSubmission

Una entrega de un taller tal como la muestra su página.

```ts
function workshopSubmission(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  which?: { submissionId?: number; authorId?: number },
): Promise<WorkshopSubmissionContent | undefined>;

interface WorkshopSubmissionContent {
  id: number;
  title: string;
  content: string;
  authorId?: number;
  author?: string;
  attachments: WorkshopAttachment[];
  editable: boolean;
}

interface WorkshopAttachment {
  name: string;
  url: string;
}
```

- Sin `which`: la entrega propia de la persona, `undefined` antes de que entregue.
- `submissionId`: esa entrega, que Moodle muestra a su autor, a sus revisores y a quienes pueden ver todas las entregas (un profesor).
- `authorId`: la entrega de ese participante, encontrada en el informe del taller (el de un profesor), `undefined` cuando no tiene ninguna.
- `content`: su texto (HTML), con las URL del sitio de los archivos incrustados en él; `attachments`: sus archivos adjuntos, cada uno con su URL en el sitio (`downloadFile` guarda uno); `author`: se omite donde Moodle oculta los nombres de los autores; `editable`: si Moodle deja a la persona editarla ahora (la suya, en la fase de envío).

Lee la página de la entrega (`mod/workshop/submission.php`) por las clases de su recuadro. Lanza `WorkshopError` cuando Moodle no deja a la persona ver la entrega, cuando alguien sin entrega propia no puede entregar (`mod/workshop:submit`, la de un estudiante: un profesor no tiene ninguna que leer), o con un id que no es de un taller; `MoodleError` (`invalid-input`) con `submissionId` y `authorId` a la vez.

## saveWorkshopSubmission

Añade la entrega de la persona a un taller, o cambia la que tiene, mediante el formulario de entrega de Moodle.

```ts
function saveWorkshopSubmission(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  input: WorkshopSubmissionInput,
): Promise<{ changed: string; submissionId: number; submission: WorkshopSubmissionContent }>;

interface WorkshopSubmissionInput {
  title?: string;
  content?: string;
  attachments?: string[];
  embed?: string[];
}
```

- `title`: Moodle exige uno, así que una entrega nueva lo lleva; al editar, si se omite se conserva el que hay.
- `content`: el texto (HTML), donde el taller admite texto en línea.
- `attachments`: archivos locales (rutas absolutas) para adjuntar; sustituyen a los adjuntos de antes, hasta el "Número máximo de archivos adjuntos" del taller. Si se omite se conservan; `[]` los quita.
- `embed`: archivos locales para incrustar en el contenido, que nombra cada uno por su nombre de archivo (`<img src="shot.png">`), subidos como los inserta el editor de Moodle (consulta [Incrustar archivos en texto enriquecido](files.md#embedding-files-in-rich-text)).

Hace lo que hacen "Añadir envío" y "Editar envío": solo cambia lo que se indica. Moodle acepta entregas en la fase de envío, dentro de sus fechas, y después de los ejemplos que el taller pida evaluar antes; donde el taller acepta entregas tardías, también una primera entrega en la fase de evaluación. Lanza `WorkshopError` cuando la persona no puede entregar (`mod/workshop:submit`, la de un estudiante), cuando Moodle no acepta la entrega ahora (el error dice cuándo la acepta), o cuando el taller no admite texto en línea o adjuntos; `FormError` con los mensajes de Moodle cuando rechaza el formulario (demasiados adjuntos, falta una parte obligatoria); `MoodleError` (`invalid-input`) sin nada que guardar, o con una entrega nueva sin título.

## workshopExamples

Los envíos de ejemplo de un taller, tal como los lista su página a un profesor.

```ts
function workshopExamples(context: BrowserContext, siteUrl: string, activityId: number): Promise<WorkshopExample[]>;

interface WorkshopExample {
  id: number;
  title: string;
  assessed: boolean;
  grade?: number;
  maxGrade?: number;
}
```

Los ejemplos son entregas que el profesor prepara y evalúa (la evaluación de referencia) para que los participantes practiquen la evaluación antes de entregar su trabajo, o antes de evaluar a sus compañeros, según digan los ajustes del taller ("Usar ejemplos" y su modo). `assessed` dice si la evaluación de referencia está hecha, y `grade` es la calificación que da, sobre `maxGrade` (la calificación por la entrega del taller). Moodle lista los ejemplos en la página del taller solo en la fase de configuración; el driver lanza `WorkshopError` en otra fase, y cuando la página no lista ninguno (el taller no usa ejemplos, o la persona no puede gestionarlos: `mod/workshop:manageexamples`, la de un profesor).

## addWorkshopExample, editWorkshopExample y deleteWorkshopExample {#addworkshopexample-editworkshopexample-and-deleteworkshopexample}

Añaden, cambian y borran los envíos de ejemplo de un taller, como hacen "Añadir ejemplo de envío", "Editar ejemplo" y "Eliminar ejemplo".

```ts
function addWorkshopExample(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  input: WorkshopSubmissionInput & { title: string },
): Promise<{ changed: string; exampleId: number; example: { id: number; title: string; content: string; attachments: WorkshopAttachment[] } }>;

function editWorkshopExample(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  exampleId: number,
  input: WorkshopSubmissionInput,
): Promise<{ changed: string; example: { id: number; title: string; content: string; attachments: WorkshopAttachment[] } }>;

function deleteWorkshopExample(context: BrowserContext, siteUrl: string, activityId: number, exampleId: number): Promise<{ changed: string }>;
```

Un ejemplo usa el propio formulario de la entrega (`mod/workshop/exsubmission.php`), así que la entrada es la de `saveWorkshopSubmission`: un título, el texto, adjuntos que sustituyen a los que hay, archivos para incrustar. Moodle pide la evaluación de referencia de un ejemplo en cuanto se añade: `assessWorkshopExample` la hace. Borrar pasa por la confirmación de Moodle y borra con el ejemplo sus evaluaciones. Los ejemplos solo cuentan donde el taller los usa, algo que Moodle no comprueba al añadirlos. Lanzan `WorkshopError` cuando la persona no puede gestionar ejemplos (`mod/workshop:manageexamples`) o el ejemplo no está; `FormError` cuando Moodle rechaza el formulario.

## assessWorkshopExample

Evalúa un envío de ejemplo mediante el formulario de evaluación del taller, como hace "Evaluar" en el ejemplo.

```ts
function assessWorkshopExample(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  exampleId: number,
  input: { criteria?: WorkshopCriterion[]; feedback?: string; fields?: Record<string, FieldValue> },
): Promise<{ changed: string; assessmentId: number; grade?: number; maxGrade?: number }>;
```

Para un profesor que gestiona ejemplos, es la evaluación de referencia del ejemplo, con la que se comparan las evaluaciones que hacen de él los participantes; para un participante, su propia evaluación de práctica, donde el taller le deja evaluar ejemplos ahora (de forma voluntaria, o antes de entregar o de evaluar, en esa fase). El formulario es el de la estrategia de calificación, rellenado como [`assessWorkshopSubmission`](#assessworkshopsubmission) rellena el de una entrega (`criteria` en el orden del formulario, `feedback` donde el taller tiene retroalimentación global), en `mod/workshop/exassessment.php`, y se guarda con "Guardar y continuar editando"; `grade` es la calificación que da sobre `maxGrade`. Lanza `WorkshopError` cuando Moodle no ofrece ninguna evaluación del ejemplo, o cuando la calificación de un criterio no es una que admita; `FormError` cuando Moodle rechaza el formulario.

## calculateWorkshopGrades

Calcula las calificaciones de un taller, como hace "Recalcular calificaciones" en la fase de calificación de evaluaciones.

```ts
function calculateWorkshopGrades(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  options?: { comparison?: WorkshopComparison },
): Promise<{ changed: string; comparison?: WorkshopComparison } & WorkshopInfo>;

type WorkshopComparison = "very strict" | "strict" | "fair" | "lax" | "very lax";
```

Moodle calcula la calificación de cada entrega a partir de sus evaluaciones (su media ponderada; las asignaciones sin evaluar no cuentan), y la calificación por evaluar de cada evaluación con el método de evaluación de calificaciones del taller, "Comparación con la mejor evaluación" salvo que haya otro instalado. `comparison` es lo estricto de ese método ("Comparación de evaluaciones" de Moodle); si se omite, el formulario conserva la última usada ("justa" al principio). Las calificaciones anuladas se mantienen. Devuelve la comparación usada y el taller tal como lo lee después [`workshopInfo`](#workshopinfo), con las calificaciones. El formulario de ajustes está en la página del taller (`mod/workshop/view.php`, que envía a `mod/workshop/aggregate.php`), y se encuentra por su clase y se rellena por el nombre de su campo. Lanza `WorkshopError` fuera de la fase de calificación de evaluaciones, cuando la persona no puede anular calificaciones (`mod/workshop:overridegrades`, la de un profesor), o cuando el método de evaluación no tiene comparación y se indica una; `MoodleError` (`invalid-input`) con una comparación que no es una de las cinco.

## overrideWorkshopGrade

Anula una calificación que Moodle calculó en un taller: la calificación de una entrega, o la calificación por evaluar de una evaluación.

```ts
function overrideWorkshopGrade(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  override: WorkshopGradeOverride,
): Promise<{ changed: string; submission?: WorkshopSubmission; assessment?: WorkshopAssessment }>;

interface WorkshopGradeOverride {
  submissionId?: number;
  assessmentId?: number;
  grade: number | null;
  feedback?: string;
}
```

- `submissionId` o `assessmentId` (uno de los dos): la entrega cuya calificación anular ("Anular calificación por la entrega", en la página de la entrega), o la evaluación cuya calificación por evaluar anular ("Anular calificación por la evaluación", en los "Ajustes de la evaluación" de la página de la evaluación).
- `grade`: un número entero de 0 a la calificación por la entrega del taller (o por la evaluación); `null` quita la anulación, así que vuelve a contar la calificación calculada.
- `feedback`: la retroalimentación para el autor (la de una entrega) o para el revisor (la de una evaluación), en HTML; si se omite se conserva la que hay.

Devuelve la entrega o la evaluación después, tal como la lee `workshopInfo` (`gradeOverride`, `gradingGradeOverride`). Moodle ofrece la anulación de una entrega solo en la fase de calificación de evaluaciones, y la de una evaluación en cualquier fase, pero no en la evaluación propia de la persona mientras aún puede cambiarla (la de un profesor, en la fase de calificación de evaluaciones). Lanza `WorkshopError` donde Moodle no muestra ninguna anulación (la fase, la evaluación propia de la persona, o sin `mod/workshop:overridegrades`), con una calificación que el formulario no admite, o con una entrega o evaluación que no es del taller; `MoodleError` (`invalid-input`) sin uno de los dos ids, o con una calificación que no es un número entero.

## Ejemplo {#example}

```ts

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

const submissions = await moodle.assignmentSubmissions(45);
for (const s of submissions.filter((s) => s.needsGrading)) {
  const text = s.content?.find((c) => c.plugin === "onlinetext")?.text ?? "";
  console.log(`${s.fullName} (${s.userId}): ${text.slice(0, 80)}`);
}

const definition = await moodle.rubric(45);
if (definition.method === "rubric") {
  // Elige el nivel más alto de cada criterio para el usuario 7.
  const levels = Object.fromEntries(definition.criteria.map((c) => [c.id, c.levels!.at(-1)!.id]));
  const result = await moodle.gradeSubmission(45, 7, {
    rubric: levels,
    remarks: { [definition.criteria[0]!.id]: "Caso base claro." },
    feedback: "<p>Bien hecho, Ada.</p>",
    notify: true,
  });
  console.log(result.changed, result.gradebookGrade);
} else {
  // Una copia corregida del trabajo vuelve con la calificación.
  await moodle.gradeSubmission(45, 7, { grade: "9", feedback: "<p>Bien hecho, Ada.</p>", feedbackFiles: ["/home/teacher/corrected/ada.pdf"] });
}

await moodle.grantExtension(45, [4, 7], new Date("2026-11-06T22:59:00Z"));

// Un foro calificado en conjunto: califica a todos los que aún no tienen calificación, y valora un mensaje.
const forum = await moodle.forumGrades(54);
for (const person of forum.grades.filter((g) => g.grade === undefined)) {
  await moodle.gradeForumUser(54, person.userId, { grade: forum.method === "point" ? 7 : forum.scale![0]!.name });
}
await moodle.rate({ type: "forum-post", id: 11, discussionId: 6 }, 4);

// Un taller: dos revisores para cada entrega, y luego abre la fase de evaluación y evalúa cada
// entrega con un formulario acumulativo de dos criterios.
const allocated = await moodle.allocateRandomly(58, { perSubmission: 2 });
if (allocated.problems.length > 0) console.log(allocated.problems.join("\n"));
await moodle.setWorkshopPhase(58, "assessment");
const workshop = await moodle.workshopInfo(58);
for (const submission of workshop.submissions) {
  const result = await moodle.assessWorkshopSubmission(58, submission.id, {
    criteria: [{ grade: 8, comment: "Claro." }, { grade: 4 }],
    feedback: "<p>Buen trabajo.</p>",
  });
  console.log(submission.author, result.grade, "de", result.maxGrade);
}

// Después, la fase de calificación de evaluaciones: calcula las calificaciones, y sube una.
await moodle.setWorkshopPhase(58, "evaluation");
const graded = await moodle.calculateWorkshopGrades(58, { comparison: "fair" });
const first = graded.submissions[0];
if (first) await moodle.overrideWorkshopGrade(58, { submissionId: first.id, grade: 70, feedback: "<p>Mejor de lo que dicen las evaluaciones.</p>" });
```

Una tarea con entregas en grupo y el flujo de trabajo de calificación: califica a un miembro por todo el grupo, y luego publica las calificaciones del grupo.

```ts

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

const submissions = await moodle.assignmentSubmissions(52);
const ada = submissions.find((s) => s.userId === 7)!;
await moodle.allocateMarker(52, [7], 3);
await moodle.gradeSubmission(52, 7, { grade: 8, feedback: "<p>Buen trabajo, equipo.</p>", workflowState: "readyforrelease", applyToGroup: true });

// Todos los miembros del grupo de Ada, publicados a la vez.
const members = submissions.filter((s) => s.group && s.group.id === ada.group?.id).map((s) => s.userId);
await moodle.setWorkflowState(52, members, "released", { notify: true });
```

## Categorías de datos {#data-categories}

`assignmentSubmissions` es `others-personal`. `gradeSubmission` es `others-personal` y `others-write` (lee el panel y decide sobre alguien). `rubric` y `setGradingDefinition` son `course-content`, y `grantExtension`, `setWorkflowState` y `allocateMarker` son `others-write`. `forumGrades` es `others-personal`, `gradeForumUser`, `others-personal` y `others-write`, y `rate`, `others-write`. `workshopInfo` es `others-personal`, `setWorkshopPhase`, `others-write` (abre y cierra el trabajo de los participantes), y `assessWorkshopSubmission`, `others-personal` y `others-write`. `workshopAllocation` es `others-personal`; `allocateReviewer`, `removeReviewer` y `allocateRandomly`, `others-personal` y `others-write` (deciden quién evalúa el trabajo de quién), y `scheduleAllocation`, `others-write`. `workshopSubmission` es `own` y `others-personal` (también el trabajo de otro), y `saveWorkshopSubmission`, `own`; `workshopExamples`, `addWorkshopExample`, `editWorkshopExample` y `deleteWorkshopExample` son `course-content`, y `assessWorkshopExample`, `course-content` y `own` (la evaluación de referencia de un profesor, o la práctica de un participante); `calculateWorkshopGrades` y `overrideWorkshopGrade` son `others-personal` y `others-write`. Consulta [categorías de datos](../concepts/data-categories.md).
