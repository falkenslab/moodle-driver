# Participantes

Esta área enumera quién está en un curso: sus participantes con sus roles y grupos (`participants`), sus grupos con sus miembros (`groups`) y los roles y grupos por los que filtra la página de participantes (`participantFilters`). Un profesor también cambia quién está en él: matriculando usuarios (`potentialUsers`, `enrolUsers`), dándolos de baja (`unenrolUser`), dando o quitando roles (`setUserRoles`), creando grupos y agrupamientos y eligiendo sus miembros (`createGroup`, `setGroupMembers`, `groupings`, `createGrouping`…), fijando cómo entra la gente: los métodos de matriculación del curso (`enrolmentMethods`, `setEnrolmentMethod`), y guardando anotaciones sobre los participantes (`notes`, `addNote`, `editNote`, `deleteNote`). Leer es sobre todo para profesores, pero funciona para cualquiera que pueda abrir la página de participantes del curso: un estudiante ve lo que Moodle le muestra ahí (en un curso con grupos separados, solo su propio grupo).

**Términos:** [participante](../reference/glossary.md#participant), [rol](../reference/glossary.md#role), [grupo](../reference/glossary.md#group).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos; las primitivas de más bajo nivel están en `@falkenslab/moodle-driver/internals` (consulta [Bajar de nivel](../concepts/low-level.md)).

Las personas llegan como un id de usuario y un nombre completo, con sus roles y grupos por id. Los correos (salvo en `potentialUsers`), los teléfonos, los campos de perfil, las imágenes y las fechas de último acceso se dejan fuera a propósito: distinguir a los participantes, filtrarlos y actuar sobre ellos (calificar, conceder excepciones, enviarles mensajes) no necesita nada más. Un solo usuario se lee por id con `userById` (consulta [Usuarios y sitio](users-and-site.md)).

## Cómo lee Moodle {#how-it-reads-moodle}

Los participantes vienen del propio servicio de tabla de la página de participantes (`core_table_get_dynamic_table_content`), el que llama la página cuando cambian sus filtros, 100 personas por petición, ordenadas por apellido. Los roles y los grupos se leen de los menús de filtro de la página (`user/index.php`) por los valores de sus opciones, así que los ids son los mismos sea cual sea el idioma del sitio. Cada rol y cada grupo es un filtro propio: un curso con muchos roles o grupos lleva una petición por rol y por grupo (y más en cursos grandes).

## participants

Los participantes de un curso con sus roles y grupos, opcionalmente solo los que tienen un rol, están en un grupo o están inactivos desde una fecha.

```ts
function participants(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  options?: { role?: number; group?: number; inactiveSince?: Date; limit?: number; offset?: number },
): Promise<Participant[]>; // ListPage<Participant> con limit

interface Participant {
  userId: number;
  fullName: string;
  roles: { id: number; name: string }[];
  groups: { id: number; name: string }[];
}
```

Opciones (todas opcionales, combinadas cuando se dan varias):

- `role`: un id de rol de `participantFilters` (5 es Estudiante en un sitio predeterminado, pero léelo en lugar de suponerlo).
- `group`: un id de grupo de `participantFilters` o de `groups`.
- `inactiveSince`: solo quienes no han accedido al curso desde esa fecha, como hace el filtro "Inactivo durante más de" de la página.
- `limit`, `offset`: una página de ellos, por apellido como los lista la página (consulta [Listas largas](../concepts/calling-functions.md#long-lists)): la página de la paginación propia de la tabla que la contiene. Los miembros de cada rol y de cada grupo se siguen leyendo enteros, para saber los roles y los grupos de los participantes de la página.

Cada participante llega con todos los roles y grupos que tiene en el curso (`roles` y `groups` pueden estar vacíos: alguien sin rol, o en ningún grupo). Lanza `NoParticipantsError` cuando la persona no puede ver los participantes del curso, o el curso no existe.

## groups

Los grupos del curso que la persona puede ver, cada uno con los ids de usuario de sus miembros.

```ts
function groups(context: BrowserContext, siteUrl: string, courseId: number): Promise<CourseGroup[]>;

interface CourseGroup {
  id: number;
  name: string;
  members: number[];
}
```

Los grupos son los que la página de participantes ofrece a la persona: todos para un profesor, solo el suyo en un curso con grupos separados. Lanza `NoParticipantsError` como `participants`.

## participantFilters

Los roles y grupos por los que filtra la página de participantes en un curso, tal como los puede usar la persona.

```ts
function participantFilters(context: BrowserContext, siteUrl: string, courseId: number): Promise<{ roles: { id: number; name: string }[]; groups: { id: number; name: string }[] }>;
```

Los nombres están en el idioma del sitio ("Student", "Estudiante"); los ids son lo que reciben `participants` y `graderReport`. Las opciones "Sin roles" y "Sin grupo" de la página se dejan fuera. Lanza `NoParticipantsError` cuando la persona no puede abrir la página.

## potentialUsers

Los usuarios que la persona puede matricular en un curso por matriculación manual, tal como los encuentra el diálogo "Matricular usuarios" de la página de participantes.

```ts
function potentialUsers(context: BrowserContext, siteUrl: string, courseId: number, search?: string): Promise<PotentialUser[]>;

interface PotentialUser {
  userId: number;
  fullName: string;
  email?: string;
}
```

`search` coincide en cualquier parte del nombre o de los campos de identidad que el sitio muestra a la persona (vacío: cualquiera, hasta 100). Los usuarios ya matriculados se dejan fuera. `email` solo llega cuando el sitio se lo muestra a la persona; es el único sitio en que esta área devuelve uno, porque distinguir a personas que aún no son participantes puede necesitarlo. Viene de `core_enrol_get_potential_users`, el propio servicio del diálogo. Lanza `EnrolmentError` cuando el curso no tiene una matriculación manual que la persona pueda usar (no está entre sus métodos de matriculación, está desactivada o no hay permiso para matricular), y `NoParticipantsError` cuando la persona no puede abrir la página de participantes.

## enrolUsers

Matricula usuarios por la matriculación manual del curso, como hace el diálogo "Matricular usuarios".

```ts
function enrolUsers(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  userIds: number[],
  options?: { roleId?: number; start?: Date; end?: Date },
): Promise<{ changed: string; count: number; roleId?: number }>;
```

- `roleId`: el rol que dar; el rol predeterminado de la matriculación manual (normalmente Estudiante) si se omite. Los roles que la persona puede dar son los de `setUserRoles`.
- `start`: cuándo empieza la matriculación; el valor predeterminado del diálogo ("Ahora", o lo que fije el sitio) si se omite.
- `end`: cuándo termina; la duración predeterminada de la matriculación (ilimitada salvo que el método fije una) si se omite.

Las fechas se envían en la zona horaria de la persona en Moodle, como hacen los selectores de fecha del diálogo. El driver lee el formulario del diálogo (`core_get_fragment`) para sus valores predeterminados y lo envía adonde lo hace el diálogo (`enrol/manual/ajax.php`); `count` es el número de matriculados que informa Moodle. Un usuario ya matriculado por ese método conserva la matriculación, con el nuevo rol añadido y las nuevas fechas. Los rechazos de Moodle lanzan `EnrolmentError` con su motivo: un rol que la persona no puede asignar ("Invalid role"), la falta de matriculación manual.

## unenrolUser

Quita a un usuario de un curso, como hace el icono de dar de baja en la columna de estado de la página de participantes, una vez por cada matriculación que el usuario tiene ahí.

```ts
function unenrolUser(context: BrowserContext, siteUrl: string, courseId: number, userId: number): Promise<{ changed: string; removed: string[]; kept: string[] }>;
```

Se van todas las matriculaciones del usuario que la persona puede quitar (`core_enrol_unenrol_user_enrolment`), y con ellas Moodle le quita sus roles y su pertenencia a grupos en el curso; `removed` las nombra por método de matriculación ("Manual enrolments"), `kept` nombra las que la persona no puede quitar (una sincronización de cohorte, un método sin el permiso), que mantienen al usuario en el curso. Lanza `EnrolmentError` cuando el usuario no está matriculado, o cuando no se puede quitar ninguna de sus matriculaciones.

## setUserRoles

Fija los roles de un usuario en un curso, como hace la columna de roles de la página de participantes.

```ts
function setUserRoles(context: BrowserContext, siteUrl: string, courseId: number, userId: number, roleIds: number[]): Promise<{ changed: string; roleIds: number[] }>;
```

Se dan los roles de `roleIds` y se quitan los demás roles que la persona puede asignar; los roles que la persona no puede asignar y los que vienen de otro sitio (una categoría, un método de matriculación que protege sus roles) se quedan. El resultado son los roles del usuario después, tal como los muestra la columna. Pasa por el propio servicio de la columna (`core_update_inplace_editable`). Un profesor con permiso de edición suele poder asignar Profesor sin permiso de edición y Estudiante, no Profesor: un rol fuera de esos se rechaza con `EnrolmentError` y el motivo de Moodle ("Role cannot be assigned in this course"), igual que un usuario que no está matriculado ("User does not belong to the course").

## Grupos y agrupamientos {#groups-and-groupings}

Un profesor crea, cambia y elimina los grupos y agrupamientos de un curso, y elige sus miembros, en las páginas de grupos de Moodle: ningún servicio de grupos que escriba está abierto a AJAX. Cada escritura devuelve `changed`, y las que crean algo, el nuevo id.

```ts
function createGroup(context: BrowserContext, siteUrl: string, courseId: number, settings: GroupSettings & { name: string }): Promise<{ changed: string; groupId: number }>;
function updateGroup(context: BrowserContext, siteUrl: string, groupId: number, settings: GroupSettings): Promise<{ changed: string }>;
function deleteGroup(context: BrowserContext, siteUrl: string, groupId: number): Promise<{ changed: string }>;
function setGroupMembers(context: BrowserContext, siteUrl: string, groupId: number, change: { add?: number[]; remove?: number[] }): Promise<{ changed: string; members: number[] }>;

function groupings(context: BrowserContext, siteUrl: string, courseId: number): Promise<Grouping[]>;
function createGrouping(context: BrowserContext, siteUrl: string, courseId: number, settings: GroupingSettings & { name: string }): Promise<{ changed: string; groupingId: number }>;
function deleteGrouping(context: BrowserContext, siteUrl: string, groupingId: number): Promise<{ changed: string }>;
function setGroupingGroups(context: BrowserContext, siteUrl: string, groupingId: number, groupIds: number[]): Promise<{ changed: string; groupIds: number[] }>;

interface GroupSettings {
  name?: string;
  description?: string; // HTML
  idNumber?: string;
  enrolmentKey?: string; // pone en este grupo a un estudiante que se automatricula con ella
}

interface GroupingSettings {
  name?: string;
  description?: string;
  idNumber?: string;
}

interface Grouping {
  id: number;
  name: string;
  groupIds: number[];
}
```

- `createGroup`, `updateGroup` y `createGrouping` rellenan el formulario del grupo o del agrupamiento (`group/group.php`, `group/grouping.php`); lo que no se da se queda como estaba. Los rechazos de Moodle llegan como `FormError` con su motivo por campo: un nombre de grupo ya usado en el curso, una clave de matriculación que tiene otro grupo.
- `setGroupMembers` añade y quita ids de usuario en la página de miembros del grupo (`group/members.php`), como hacen sus botones Agregar y Quitar, y devuelve los miembros después. Solo se pueden añadir participantes del curso: los ids que la página no ofrece se quedan como estaban y se nombran en `changed`.
- `groupings` lee la página de agrupamientos del curso y la página de grupos de cada agrupamiento (una persona sin `moodle/course:managegroups`, un estudiante, recibe un `MoodleError` con el rechazo de Moodle); `setGroupingGroups` hace que los grupos de un agrupamiento sean exactamente los dados en esa página (`group/assign.php`), dejando fuera los ids que no son grupos del curso.
- `deleteGroup` y `deleteGrouping` hacen lo que hace su confirmación; los miembros del grupo se quedan en el curso, y los grupos de un agrupamiento se quedan como grupos.

Un grupo o agrupamiento que no existe, o que la persona no puede gestionar, lanza un `MoodleError` (código `not-found`) con el mensaje de Moodle. `groups` lee los grupos con sus miembros.

## Métodos de matriculación {#enrolment-methods}

Cómo entra la gente en un curso: matriculación manual, automatriculación (con clave o sin ella), acceso de invitados… leídos y fijados en la página "Métodos de matriculación" del curso (`enrol/instances.php`) y en el formulario de cada método (`enrol/editinstance.php`); ningún servicio para ellos está abierto a AJAX.

```ts
function enrolmentMethods(context: BrowserContext, siteUrl: string, courseId: number): Promise<EnrolmentMethod[]>;
function setEnrolmentMethod(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  method: number | { type: string },
  settings: EnrolmentMethodSettings,
): Promise<{ changed: string; method: EnrolmentMethod }>;

interface EnrolmentMethod {
  id: number;
  type: string; // "manual", "self", "guest", "cohort"…
  name: string; // como lo nombra la página, en el idioma del sitio
  enabled: boolean;
  users: number;
  roleId?: number;
  hasKey?: boolean; // automatriculación y acceso de invitados; la clave en sí nunca se devuelve
  start?: string; // automatriculación: fechas ISO
  end?: string;
  maxUsers?: number; // automatriculación
}

interface EnrolmentMethodSettings {
  enabled?: boolean;
  key?: string; // "" la quita
  start?: Date | null; // null quita la fecha
  end?: Date | null;
  roleId?: number;
  maxUsers?: number; // 0: sin límite
  welcome?: string | false; // mensaje de bienvenida de la matriculación manual y la automatriculación; false no envía ninguno
}
```

`enrolmentMethods` enumera los métodos en el orden en que Moodle los prueba, y abre el formulario de cada método para leer su rol, su clave, sus fechas y su límite. Lo que muestra un formulario depende de los permisos de la persona: un profesor con permiso de edición suele configurar la automatriculación y el acceso de invitados pero no la matriculación manual, cuyo rol entonces no se devuelve.

`setEnrolmentMethod` recibe un método por id, o por tipo (`{ type: "self" }`: el primero de ese tipo del curso, que se añade cuando el curso no tiene ninguno y el menú "Añadir método" de la página lo ofrece). Solo cambian los ajustes que se dan; las fechas están en la zona horaria de la persona en Moodle. Un mensaje de bienvenida activa el envío (desde el contacto del curso, salvo que se haya elegido otro remitente). `enabled` activa o desactiva un método existente con los iconos de activar y desactivar de su fila en la página de métodos, como lo haría una persona; los demás ajustes pasan por su formulario (un método nuevo toma su estado también del formulario). Devuelve el método después.

Lo que Moodle deja cambiar a la persona depende del método y de sus permisos: un profesor con permiso de edición activa, desactiva y configura la automatriculación y el acceso de invitados, pero no la matriculación manual (requiere `enrol/manual:config`, que por defecto solo tienen los gestores y los administradores): Moodle no le ofrece ni sus iconos ni su estado y su rol, solo su mensaje de bienvenida. Pedir un estado que el método ya tiene no es un cambio, así que `{ enabled: true }` en un método manual activado también funciona para él. Desactivar el método por el que está matriculada la persona pide en Moodle una confirmación que el driver no da.

Lanza `EnrolmentError` para un método que el curso no tiene y no puede añadir, cuando la persona no puede gestionar los métodos del curso, y para un ajuste que Moodle no le deja cambiar (nombrándolo, antes de guardar nada); `FormError` con el motivo de Moodle cuando rechaza el formulario.

Un estudiante se matricula con la clave en el propio Moodle (el "Matricularme" del curso); el driver solo configura el método.

## Anotaciones sobre los participantes {#notes-about-participants}

Un profesor guarda anotaciones sobre los participantes de un curso en las páginas de anotaciones de Moodle: la página de anotaciones las lista (`notes/index.php`), su formulario las escribe y las edita (`notes/edit.php`) y su confirmación las borra (`notes/delete.php`). De los servicios de anotaciones de Moodle solo `core_notes_create_notes` está abierto a AJAX, y archiva una anotación del sitio bajo la portada del sitio en lugar del curso, a diferencia del formulario (así lo hace `notes/externallib.php` en Moodle 5.2); por eso el driver usa las páginas para todo.

```ts
function notes(context: BrowserContext, siteUrl: string, courseId: number, options?: { userId?: number; limit?: number; offset?: number }): Promise<ParticipantNote[]>; // ListPage<ParticipantNote> con limit
function addNote(context: BrowserContext, siteUrl: string, courseId: number, userId: number, fields: { content: string; context?: NoteContext }): Promise<NoteChange>;
function editNote(context: BrowserContext, siteUrl: string, noteId: number, fields: { content?: string; context?: NoteContext }): Promise<NoteChange>;
function deleteNote(context: BrowserContext, siteUrl: string, noteId: number): Promise<NoteChange>;

type NoteContext = "personal" | "course" | "site";

interface ParticipantNote {
  id: number;
  courseId: number; // el curso en que se escribió: una anotación del sitio puede venir de otro
  userId: number; // el participante del que trata
  userName: string;
  content: string; // HTML
  context: NoteContext;
  authorId: number;
  authorName: string;
  created?: string; // ISO
  modified?: string;
  editable: boolean; // la página le muestra a la persona sus enlaces de editar y borrar
}

interface NoteChange {
  changed: string;
  noteId: number;
  note?: ParticipantNote; // después; ninguna tras borrarla
}
```

El contexto de una anotación es quién la ve: `personal`, solo su autor (Moodle la llama borrador); `course`, quien puede ver las anotaciones del curso (los profesores, por defecto); `site`, quien puede ver anotaciones en cualquier curso en que esté el participante.

- `notes` lee lo que la página de anotaciones le muestra a la persona: las anotaciones del sitio (de cualquier curso; sin `userId`, sobre cualquiera del sitio), las del curso y después las anotaciones personales de la propia persona (las de nadie más se muestran, ni siquiera a un administrador), cada grupo de la más reciente a la más antigua. `userId` deja las anotaciones sobre un participante. `limit` y `offset` las paginan (consulta [Listas largas](../concepts/calling-functions.md#long-lists)); la página en sí no pagina, así que se lee entera. Las fechas se leen del texto de la página con el formato de fecha del idioma del sitio, en la zona horaria de la persona; la que no se puede leer se deja fuera.
- `addNote` escribe una anotación sobre un participante con su contenido (HTML) y su contexto (`course` si no se indica), y devuelve su id y la anotación.
- `editNote` cambia el contenido de una anotación y, con `context`, quién la ve; lo que no se indica se queda igual. Moodle deja editar las anotaciones del curso y las anotaciones personales propias donde la persona puede gestionar anotaciones, y las del sitio con esa capacidad en todo el sitio.
- `deleteNote` borra una anotación, como hace su enlace de borrar tras la confirmación de Moodle.

Leer requiere `moodle/notes:view` y escribir `moodle/notes:manage` (las dos de los profesores por defecto, no de los estudiantes). Si falta una, se lanza `NoteError` nombrándola; una anotación que no existe lanza `NoteError` con el mensaje de Moodle; un sitio con las anotaciones desactivadas (Administración del sitio > Características avanzadas > Habilitar anotaciones) lanza `NotesDisabledError` (código `notes-disabled`), sea cual sea la función.

## Enviar mensajes a los participantes {#messaging-participants}

`messageParticipants` (en [Mensajes](messages.md)) escribe un mensaje a varios participantes a la vez, elegidos como los elige `participants`: por rol, grupo o inactividad.

## Seudonimizar {#pseudonymizing}

El driver devuelve los nombres reales: es una biblioteca para cualquier programa, y lo que un programa haga con los nombres es decisión suya. Un programa que pasa los datos de los participantes a otro (un modelo de IA, por ejemplo) los seudonimiza él mismo; moodle-mcp, uno de sus consumidores, lo hace con `@falkenslab/pseudonym`. Los ids de usuario son estables dentro de un sitio, así que un programa puede guardar una tabla de id a seudónimo y traducir de vuelta antes de actuar.

## Ejemplo {#example}

Encontrar a los estudiantes del grupo "Group A" que no han abierto el curso 3 en dos semanas.

```ts
import { NoParticipantsError } from "@falkenslab/moodle-driver";

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

try {
  const { roles, groups } = await moodle.participantFilters(3);
  const student = roles.find((r) => r.name === "Student");
  const groupA = groups.find((g) => g.name === "Group A");
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const inactive = await moodle.participants(3, { role: student?.id, group: groupA?.id, inactiveSince: twoWeeksAgo });
  for (const person of inactive) console.log(person.userId, person.fullName);
} catch (error) {
  if (error instanceof NoParticipantsError) console.log(error.message);
  else throw error;
}
```

Buscar los roles por nombre solo funciona en un sitio en inglés; un programa para cualquier sitio los busca por id, o deja que la persona elija de `roles`.

## Categorías de datos {#data-categories}

De `DATA_CATEGORIES` (consulta [Categorías de datos](../concepts/data-categories.md)):

- `participants`, `groups`: `others-personal`.
- `participantFilters`: `course-content` (los roles y grupos del curso, los datos de nadie).
- `potentialUsers`: `others-personal`.
- `createGroup`, `updateGroup`, `deleteGroup`, `groupings`, `createGrouping`, `deleteGrouping`, `setGroupingGroups`: `course-content`.
- `setGroupMembers`: `others-personal` y `others-write`.
- `enrolmentMethods`, `setEnrolmentMethod`: `course-content`.
- `enrolUsers`, `unenrolUser`, `setUserRoles`: `others-personal` y `others-write` (decidir quién está en el curso y con qué rol).
- `notes`: `others-personal`.
- `addNote`, `editNote`, `deleteNote`: `others-personal` y `others-write` (un juicio sobre alguien, como lo es la retroalimentación).
