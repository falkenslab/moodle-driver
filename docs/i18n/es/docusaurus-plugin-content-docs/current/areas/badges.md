# Insignias

Esta área trabaja con las insignias de un curso: leerlas (`courseBadges`), crear una (`createBadge`), fijar qué la gana (`setBadgeCriteria`), habilitarla o deshabilitarla (`setBadgeEnabled`) y otorgarla a mano (`awardBadge`). Cualquiera en el curso puede leer sus insignias habilitadas; crearlas, fijar sus criterios y otorgarlas requiere las capacidades de insignias de Moodle en el curso, que los profesores tienen por defecto. Las insignias del sitio no se cubren: solo las del curso.

**Términos:** [insignia](../reference/glossary.md#badge).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos; las primitivas de más bajo nivel están en `@falkenslab/moodle-driver/internals` (consulta [Bajar de nivel](../concepts/low-level.md)).

## Cómo funciona una insignia en Moodle {#how-a-badge-works-in-moodle}

Una insignia empieza deshabilitada ("No disponible para los usuarios") y sin criterios. Sus criterios dicen qué la gana: finalizar actividades, finalizar el curso, que se la otorgue a mano alguien con un rol dado, y otros tipos que el driver no fija (otras insignias, competencias, campos del perfil). Con más de un criterio, la insignia dice si deben cumplirse todos o basta con uno. Una vez habilitada, Moodle la otorga en el acto a quien ya cumple sus criterios, y después a quien los cumpla. Mientras una insignia está habilitada sus criterios no pueden cambiar; en cuanto alguien la tiene, Moodle la bloquea, y sus criterios ya no cambian nunca (un profesor la copia en su lugar).

Moodle no da nada de esto por un servicio abierto a AJAX: el driver lee la página de insignias del curso (`badges/index.php`), la vista general de cada insignia, su página de criterios y los formularios de cada criterio, y su página para otorgarla, como lo haría un profesor. Habilitar y deshabilitar pasan por los servicios a los que llaman los propios botones de la página de insignias (`core_badges_enable_badges`, `core_badges_disable_badges`).

## CourseBadge

Las insignias que lista `courseBadges` y que devuelven las escrituras:

```ts
interface CourseBadge {
  id: number;
  courseId: number;
  name: string;
  description: string;
  imageUrl: string;
  enabled: boolean;
  criteria: string;
  recipients?: number;
  awarded: boolean;
}
```

- `id`: el id de la insignia, lo que toman las demás funciones.
- `description`: texto plano (Moodle le quita las etiquetas).
- `imageUrl`: la versión grande de su imagen, tal como la sirve Moodle; `downloadFile` la guarda con la sesión.
- `enabled`: si está disponible para los usuarios. Solo se otorga una insignia habilitada.
- `criteria`: qué la gana, tal como lo resume la página de insignias, en el idioma del sitio (`""` sin criterios). Es para mostrárselo a una persona; `setBadgeCriteria` devuelve los criterios como datos.
- `recipients`: cuántas personas la tienen, para quien puede ver quién la tiene (un profesor); no aparece para un estudiante.
- `awarded`: si la persona la tiene.

## courseBadges

Las insignias de un curso, tal como las lista su página de insignias, con la descripción y la imagen de cada una sacadas de su vista general.

```ts
function courseBadges(context: BrowserContext, siteUrl: string, courseId: number): Promise<CourseBadge[]>;
```

Un estudiante solo ve las insignias habilitadas, sin `recipients`; un profesor ve también las deshabilitadas. La página de insignias muestra una página de su tabla; el resto, en un curso con más insignias que esas, llega del propio servicio de la tabla (`core_table_get_dynamic_table_content`), como hace su paginación.

Lanza `BadgesDisabledError` en un sitio con las insignias, o las insignias de curso, desactivadas; `BadgeError` cuando la persona no puede ver las insignias del curso (Moodle la manda a la portada).

## createBadge

Crea una insignia de curso con el formulario de nueva insignia de Moodle, deshabilitada y sin criterios, y la devuelve.

```ts
function createBadge(context: BrowserContext, siteUrl: string, courseId: number, badge: NewBadge): Promise<{ changed: string; badge: CourseBadge }>;

interface NewBadge {
  name: string;
  description: string;
  image: string;
  imageCaption?: string;
}
```

- `name`, `description`: Moodle los exige; la descripción es texto plano.
- `image`: un archivo de imagen local, como ruta absoluta: PNG, JPEG o GIF, de 256 KB como mucho. Se sube como lo hace el selector de archivos del formulario; Moodle la redimensiona.
- `imageCaption`: el pie de la imagen, su texto alternativo.

El emisor (nombre y contacto) es el predeterminado del sitio, como lo rellena el formulario. Lanza `BadgeError` cuando la persona no puede crear insignias en el curso (requiere `moodle/badges:createbadge`), `BadgesDisabledError` en un sitio con las insignias desactivadas, un `MoodleError` con código `not-found` para una imagen que no está, y `FormError` con el motivo de Moodle cuando rechaza el formulario.

## setBadgeCriteria

Fija qué gana una insignia, con su página de criterios y el formulario de cada criterio, y devuelve los criterios después.

```ts
function setBadgeCriteria(context: BrowserContext, siteUrl: string, badgeId: number, changes: BadgeCriteriaChanges): Promise<{ changed: string; criteria: BadgeCriteria }>;

interface BadgeCriteriaChanges {
  activities?: { activityIds: number[]; all?: boolean } | null;
  courseCompletion?: { minGrade?: number; by?: Date } | null;
  manual?: { roleIds: number[]; all?: boolean } | null;
  all?: boolean;
}

interface BadgeCriteria {
  activities?: { activityIds: number[]; all: boolean };
  courseCompletion?: { minGrade?: number; by?: string };
  manual?: { roleIds: number[]; all: boolean };
  all?: boolean;
}
```

- `activities`: finalizar estas actividades, por id del módulo del curso. Moodle solo ofrece las actividades del curso con seguimiento de finalización. `all` (por defecto `true`) exige todas; `false`, cualquiera de ellas. El formulario de Moodle empieza en "cualquiera": el valor por defecto del driver es lo que suele querer decir una lista de actividades.
- `courseCompletion`: finalizar el curso, que debe tener seguimiento de finalización. `minGrade` añade una calificación mínima del curso; `by`, una fecha para finalizarlo (cuenta el día, en la zona horaria de la persona).
- `manual`: otorgada a mano por personas con estos roles, por id de rol (3 es el profesor en un sitio estándar; `courseRoles` da los roles de una persona en un curso). Moodle solo ofrece los roles que pueden otorgar insignias. `all` (por defecto `false`) exige que la otorgue cada uno de los roles; por defecto basta con uno de ellos.
- `all`: con más de un criterio, si deben cumplirse todos (lo predeterminado en Moodle) o basta con uno. Se ignora con un solo criterio. Para una insignia que un profesor otorga a mano tenga lo que tenga además, da `all: false`.

Un criterio dado sustituye los ajustes de ese tipo; `null` lo quita; uno que no se da se queda. Los demás tipos de criterio que pueda tener una insignia se quedan como están. En el resultado, `courseCompletion.by` es una fecha ISO, y `all` solo aparece con más de un criterio.

Lanza `BadgeError` cuando la persona no puede fijar criterios (requiere `moodle/badges:configurecriteria`), cuando la insignia está habilitada (deshabilítala antes) o bloqueada porque alguien la tiene, y para actividades o roles que el criterio no ofrece, nombrándolos junto con los que sí ofrece; `BadgesDisabledError` en un sitio con las insignias desactivadas.

## setBadgeEnabled

Habilita o deshabilita una insignia, y la devuelve después.

```ts
function setBadgeEnabled(context: BrowserContext, siteUrl: string, badgeId: number, enabled: boolean): Promise<{ changed: string; badge: CourseBadge }>;
```

Habilitarla la otorga en el acto a quien ya cumple sus criterios (`recipients` los cuenta después). Una insignia que ya está en ese estado se queda como está: si no, el servicio de Moodle bloquearía una insignia habilitada al habilitarla otra vez. Una insignia deshabilitada que alguien tiene conserva sus receptores, y sigue bloqueada.

Lanza `BadgeError` cuando la persona no puede (requiere `moodle/badges:configurecriteria`) o la insignia aún no tiene criterios; `BadgesDisabledError` en un sitio con las insignias o las insignias de curso desactivadas.

## awardBadge

Otorga una insignia a mano a un participante, con su página para otorgarla, y devuelve la insignia después.

```ts
function awardBadge(context: BrowserContext, siteUrl: string, badgeId: number, userId: number, options?: { roleId?: number }): Promise<{ changed: string; badge: CourseBadge }>;
```

La insignia debe estar habilitada y tener un criterio manual que nombre un rol que la persona tiene en el curso. La persona la otorga con ese rol; cuando el criterio nombra varios que tiene, Moodle pregunta cuál, y `roleId` responde (si no, el primero). Moodle emite la insignia cuando se cumplen sus criterios: en el acto cuando basta con otorgarla a mano (es su único criterio, o la gana cualquiera de ellos), y si no, cuando se cumplan también los demás (confirmado empíricamente, Moodle 5.2). Un participante al que ya se le otorgó a mano se queda como está.

Lanza `BadgeError` cuando la persona no puede otorgarla (requiere `moodle/badges:awardbadge` y uno de los roles del criterio), cuando la insignia no está habilitada o no tiene criterio manual, y cuando Moodle no se la otorga al usuario (no es un participante al que se le pueda otorgar).

## Ejemplo {#example}

Un profesor crea una insignia por leer una página, que gana tanto finalizar la página como que la otorgue un profesor, la habilita y se la otorga a una estudiante que la leyó en papel.

```ts
import { BadgeError, BadgesDisabledError } from "@falkenslab/moodle-driver";

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

try {
  const { badge } = await moodle.createBadge(3, { name: "Lectora", description: "Leyó la introducción del curso.", image: "/home/ana/badges/lectora.png" });

  // 3: el rol de profesor en un sitio estándar.
  const { criteria } = await moodle.setBadgeCriteria(badge.id, {
    activities: { activityIds: [42] },
    manual: { roleIds: [3] },
    all: false,
  });
  console.log(criteria);

  await moodle.setBadgeEnabled(badge.id, true);
  const awarded = await moodle.awardBadge(badge.id, 57);
  console.log(awarded.changed);

  for (const b of await moodle.courseBadges(3)) console.log(b.name, b.enabled ? "habilitada" : "deshabilitada", b.recipients);
} catch (error) {
  if (error instanceof BadgesDisabledError || error instanceof BadgeError) console.log(error.message);
  else throw error;
}
```

## Categorías de datos {#data-categories}

De `DATA_CATEGORIES` (consulta [Categorías de datos](../concepts/data-categories.md)):

- `courseBadges`: `course-content`, `own` y `others-aggregate` (las insignias que preparan los profesores, si la persona tiene cada una y cuántos la tienen).
- `createBadge`, `setBadgeCriteria`: `course-content`.
- `setBadgeEnabled`: `course-content` y `others-write` (habilitarla otorga la insignia a quien cumple sus criterios).
- `awardBadge`: `others-write`.
