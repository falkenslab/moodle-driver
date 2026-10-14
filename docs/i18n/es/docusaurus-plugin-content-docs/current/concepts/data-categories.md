# Categorías de datos

Algunos programas no deben alcanzar todo lo que podría alcanzar la persona: un asistente que construye un curso pero nunca lee el trabajo de los estudiantes, una herramienta que puede leer calificaciones pero nunca cambiarlas. El driver no puede decidir eso por ellos, pero declara, para cada función pública, qué tipos de datos lee o escribe, de modo que un programa pueda permitir algunos tipos y rechazar el resto sin clasificar el driver a mano.

**Términos:** [categoría de datos](../reference/glossary.md#data-category).

![Las categorías de datos, de inofensivas a poderosas, con una función de ejemplo cada una](/img/diagrams/data-categories.svg)

## Las categorías {#the-categories}

```ts
type DataCategory = "none" | "own" | "course-content" | "others-aggregate" | "others-personal" | "others-write" | "communication" | "any";
```

| Categoría | Significado | Ejemplos |
| --- | --- | --- |
| `none` | La sesión o el sitio, nada de nadie; también las funciones que solo analizan lo que el llamante ya ha obtenido | `logIn`, `publicSiteInfo`, `readTexts` |
| `own` | Los datos y acciones propios de la persona | `myGrades`, `whoAmI`, `answerQuizQuestions`, `saveSubmission` |
| `course-content` | Lo que hacen los profesores: estructura, actividades y su configuración, rúbricas, preguntas | `courseStructure`, `createActivity`, `importQuestions`, `rubric` |
| `others-aggregate` | Recuentos que no identifican a nadie | `activitiesOverview` ("2 de 4 entregadas"), `courseUpdates` |
| `others-personal` | Datos o trabajo de otros: nombres, roles, entregas, mensajes, intentos, calificaciones | `participants`, `assignmentSubmissions`, `discussion`, `quizResults` |
| `others-write` | Decidir sobre otros: calificaciones, retroalimentación, ampliaciones del plazo, excepciones, finalización | `gradeSubmission`, `grantExtension`, `setQuizOverride`, `overrideCompletion` |
| `communication` | Escribir a otros o delante de otros | `replyToPost`, `startDiscussion`, `sendMessage`, `setDiscussionState` |
| `any` | Primitivas genéricas que alcanzan aquello a lo que se las apunte | `callService`, `openSitePage`, `openForm`, `setFields`, `BrowserManager.tab` |

Una función que puede tocar varios tipos los lista todos (`gradeSubmission` lee una entrega y decide una calificación: `others-personal` y `others-write`); un programa debería tomar el más estricto.

## DATA_CATEGORIES

```ts
import { DATA_CATEGORIES } from "@falkenslab/moodle-driver";

DATA_CATEGORIES.courseStructure; // ["course-content", "own"]
DATA_CATEGORIES.gradeSubmission; // ["others-personal", "others-write"]
DATA_CATEGORIES["BrowserManager.tab"]; // ["any"]
```

Tiene una entrada para cada función exportada por el paquete, para cada método del gestor del navegador (`BrowserManager.<method>`) y para los métodos propios del objeto Moodle (`Moodle.<method>`: `logIn`, `close`, `callService`, `tab`…). Los demás métodos del objeto son las funciones del mismo nombre, bajo sus nombres: `moodle.gradeSubmission` es `DATA_CATEGORIES.gradeSubmission`. Las pruebas del driver fallan cuando una nueva exportación no tiene entrada, así que el manifiesto no puede quedarse atrás respecto al código.

## moduleCategories

Leer una actividad lee cosas distintas según su módulo: una página solo contiene lo que escribió un profesor; una tarea, un foro o un cuestionario contienen también el trabajo de los participantes. `moduleCategories(module)` responde por módulo:

```ts
import { moduleCategories } from "@falkenslab/moodle-driver";

moduleCategories("page"); // ["course-content"]
moduleCategories("forum"); // ["course-content", "others-personal"]
moduleCategories("someplugin"); // ["any"]: un plugin desconocido podría contener cualquier cosa
```

## Una política por encima {#a-policy-on-top}

```ts
import { DATA_CATEGORIES, type DataCategory } from "@falkenslab/moodle-driver";

const allowed = new Set<DataCategory>(["none", "own", "course-content", "others-aggregate"]);

function mayCall(fn: string): boolean {
  const categories = DATA_CATEGORIES[fn];
  return categories !== undefined && categories.every((category) => allowed.has(category));
}

mayCall("createActivity"); // true
mayCall("assignmentSubmissions"); // false
```

moodle-mcp construye así los ámbitos de sus herramientas: la persona elige qué tipos de herramientas existen para un agente, y el ámbito de cada herramienta se deduce de las categorías de las funciones del driver a las que llama.
