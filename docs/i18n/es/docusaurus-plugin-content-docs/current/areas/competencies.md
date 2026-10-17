# Competencias

Esta área trabaja con las competencias de un curso: los marcos de los que puede tomarlas (`competencyFrameworks`), las competencias del curso y las actividades vinculadas a ellas (`courseCompetencies`), añadirlas y quitarlas (`addCourseCompetency`, `removeCourseCompetency`), vincularlas a una actividad (`setActivityCompetencies`) y la valoración de un participante en una (`competencyRating`, `rateCompetency`). Cualquiera en el curso lee sus competencias; gestionarlas y valorar a los participantes requiere las capacidades de competencias de Moodle en el curso, que los profesores tienen por defecto. Los marcos, los planes de aprendizaje y las plantillas se crean a nivel de sitio: el driver solo lee los marcos.

**Términos:** [competencia](../reference/glossary.md#competency).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos; las primitivas de más bajo nivel están en `@falkenslab/moodle-driver/internals` (consulta [Bajar de nivel](../concepts/low-level.md)).

## Cómo funcionan las competencias en Moodle {#how-competencies-work-in-moodle}

Un marco de competencias (lo crea un administrador, para el sitio o una categoría) es un árbol de competencias con una escala: "Todavía no competente", "Competente", por ejemplo, con las valoraciones que cuentan como competente. Un profesor añade algunas de las competencias de un marco a un curso (su página "Competencias") y las vincula a las actividades del curso (los ajustes "Competencias" de cada actividad). Después se valora a cada participante en cada competencia del curso, a mano o mediante una regla cuando finaliza una actividad vinculada; cada valoración se guarda como evidencia, con la nota del profesor. La valoración de un curso puede pasar a los planes de aprendizaje del participante, según digan los ajustes de competencias del curso.

Las competencias son una función del sitio que activa un administrador (Administración del sitio > Características avanzadas > Habilitar competencias). El driver usa los servicios que llaman las propias páginas de competencias de Moodle, todos abiertos a AJAX (Moodle 5.2): `core_competency_list_competency_frameworks` y `core_competency_list_competencies`, el `tool_lp_data_for_course_competencies_page` de la página de competencias del curso, `core_competency_add_competency_to_course` y `core_competency_remove_competency_from_course`, y el `tool_lp_data_for_user_competency_summary_in_course` y `core_competency_grade_competency_in_course` de la página de competencia del usuario. Moodle no tiene ningún servicio que vincule una competencia a una actividad: `setActivityCompetencies` guarda el formulario de ajustes de la actividad con su campo de competencias del curso.

## competencyFrameworks

Los marcos visibles de los que un curso puede tomar sus competencias (los del sitio y los de sus categorías), cada uno con sus competencias.

```ts
function competencyFrameworks(context: BrowserContext, siteUrl: string, courseId: number): Promise<CompetencyFramework[]>;

interface CompetencyFramework {
  id: number;
  shortName: string;
  idNumber: string;
  description: string;
  competencies: Competency[];
}

interface Competency {
  id: number;
  shortName: string;
  idNumber: string;
  description: string;
  parentId: number;
}
```

- `description`: HTML, tal como lo formatea Moodle.
- `competencies`: el árbol entero, los padres antes que sus hijos; `parentId` es la competencia de la que cuelga, 0 en la raíz. Su `id` es lo que recibe `addCourseCompetency`.

Requiere `moodle/competency:competencyview`, que los profesores tienen.

## courseCompetencies

Las competencias de un curso, tal como las lista su página de competencias.

```ts
function courseCompetencies(context: BrowserContext, siteUrl: string, courseId: number): Promise<CourseCompetency[]>;

interface CourseCompetency {
  id: number;
  shortName: string;
  idNumber: string;
  description: string;
  framework: { id: number; name: string };
  activities: { id: number; name: string }[];
}
```

- `framework`: el marco del que viene, por su nombre corto.
- `activities`: las actividades del curso vinculadas a ella, por id del módulo del curso.

Requiere `moodle/competency:coursecompetencyview`, que tienen estudiantes y profesores.

## addCourseCompetency

Añade a un curso una competencia de un marco, y devuelve después las competencias del curso.

```ts
function addCourseCompetency(context: BrowserContext, siteUrl: string, courseId: number, competencyId: number): Promise<CourseCompetencyChange>;

interface CourseCompetencyChange {
  changed: string;
  courseId: number;
  competencyId: number;
  competencies: CourseCompetency[];
}
```

Una competencia que ya está en el curso se deja como está (`changed` lo dice). Requiere `moodle/competency:coursecompetencymanage`; una competencia que no existe es un `CompetencyError` con el motivo de Moodle.

## removeCourseCompetency

Quita una competencia de un curso, y devuelve después las competencias del curso.

```ts
function removeCourseCompetency(context: BrowserContext, siteUrl: string, courseId: number, competencyId: number): Promise<CourseCompetencyChange>;
```

Moodle la desvincula también de las actividades del curso, y conserva las valoraciones ya dadas. Una competencia que no está en el curso se deja fuera (`changed` lo dice). Requiere `moodle/competency:coursecompetencymanage`.

## setActivityCompetencies

Fija a cuáles de las competencias de su curso está vinculada una actividad, todas a la vez, con el formulario de ajustes de la actividad.

```ts
function setActivityCompetencies(context: BrowserContext, siteUrl: string, activityId: number, competencyIds: number[]): Promise<ActivityCompetencyChange>;

interface ActivityCompetencyChange {
  changed: string;
  activityId: number;
  competencyIds: number[];
}
```

Las competencias que no se dan se desvinculan, y `[]` las desvincula todas. Solo se pueden vincular competencias del curso: añade una antes con `addCourseCompetency`. Los demás ajustes del formulario, entre ellos la regla al finalizar, se quedan como están. `competencyIds` se lee después de las competencias del curso.

Lanza `CompetencyError` para una competencia que no es del curso, para una actividad cuyo formulario Moodle no muestra, y cuando la persona no puede vincular competencias (requiere `moodle/competency:coursecompetencymanage`, y editar la actividad).

## competencyRating

La valoración de un participante en una de las competencias del curso, tal como la muestra su página de competencia en el curso.

```ts
function competencyRating(context: BrowserContext, siteUrl: string, courseId: number, userId: number, competencyId: number): Promise<CompetencyRating>;

interface CompetencyRating {
  courseId: number;
  userId: number;
  competencyId: number;
  rating: { value: number; name: string } | null;
  proficient: boolean | null;
  scale: CompetencyScaleItem[];
  evidence: CompetencyEvidence[];
  canRate: boolean;
}

interface CompetencyScaleItem {
  value: number;
  name: string;
  proficient: boolean;
}

interface CompetencyEvidence {
  id: number;
  action: "log" | "complete" | "override";
  description: string;
  note: string;
  rating: { value: number; name: string } | null;
  by?: { id: number; name: string };
  created: string;
}
```

- `rating`, `proficient`: la valoración del participante en el curso y si es competente; `null` mientras no está valorado.
- `scale`: la escala de la competencia, `value` 1 para su primer elemento; `proficient` según lo configura el marco (o la competencia).
- `evidence`: las evidencias en el curso, la más reciente primero: `override` una valoración dada a mano, `complete` una regla que la completa, `log` un registro sin valoración. `description` es la de Moodle, en el idioma del sitio; `note` es la del profesor (texto plano, `""` si no hay); `created` es ISO.
- `canRate`: si la persona puede valorarlo.

Un profesor lee la de cualquiera en el curso (requiere `moodle/competency:usercompetencyview`); un estudiante lee la suya.

## rateCompetency

Valora a un participante en una de las competencias del curso, como hace el diálogo de valoración de su página de competencia, y devuelve después la valoración.

```ts
function rateCompetency(context: BrowserContext, siteUrl: string, courseId: number, userId: number, competencyId: number, input: CompetencyRatingInput): Promise<{ changed: string; rating: CompetencyRating }>;

interface CompetencyRatingInput {
  rating: number | string;
  note?: string;
}
```

- `rating`: el valor de un elemento de la escala (1 para el primero) o su nombre, sin importar mayúsculas.
- `note`: se guarda con la valoración, como su evidencia.

La nueva valoración sustituye a la del curso; Moodle además la pasa a los planes de aprendizaje del participante cuando los ajustes de competencias del curso lo dicen. Una valoración que no está en la escala es un `MoodleError` con código `invalid-input`, comprobado antes de enviar nada. Requiere `moodle/competency:competencygrade`, y que el participante esté matriculado como alguien a quien se puede valorar (un estudiante).

## Errores {#errors}

Todas las funciones lanzan `CompetenciesDisabledError` (código `competencies-disabled`) en un sitio con las competencias desactivadas, y `CompetencyError` (código `competency`) nombrando la capacidad cuando a la persona le falta, o con el motivo de Moodle en otro caso (una competencia que no es del curso, un participante al que no se puede valorar).

## Ejemplo {#example}

Un profesor añade a un curso la primera competencia de un marco, la vincula a una actividad y valora a un estudiante en ella con una nota.

```ts
import { CompetenciesDisabledError, CompetencyError } from "@falkenslab/moodle-driver";

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

try {
  const [framework] = await moodle.competencyFrameworks(3);
  const competency = framework?.competencies[0];
  if (competency) {
    await moodle.addCourseCompetency(3, competency.id);
    await moodle.setActivityCompetencies(42, [competency.id]);

    const { rating } = await moodle.rateCompetency(3, 57, competency.id, { rating: "Competent", note: "Explicó la tarea al grupo." });
    console.log(rating.rating?.name, rating.proficient ? "competente" : "no competente");
  }
  for (const c of await moodle.courseCompetencies(3)) console.log(c.shortName, c.framework.name, c.activities.map((a) => a.name));
} catch (error) {
  if (error instanceof CompetenciesDisabledError || error instanceof CompetencyError) console.log(error.message);
  else throw error;
}
```

## Categorías de datos {#data-categories}

De `DATA_CATEGORIES` (consulta [Categorías de datos](../concepts/data-categories.md)):

- `competencyFrameworks`, `courseCompetencies`, `addCourseCompetency`, `removeCourseCompetency`, `setActivityCompetencies`: `course-content`.
- `competencyRating`: `own` y `others-personal` (la valoración de la propia persona, o la de un participante).
- `rateCompetency`: `others-personal` y `others-write`.
