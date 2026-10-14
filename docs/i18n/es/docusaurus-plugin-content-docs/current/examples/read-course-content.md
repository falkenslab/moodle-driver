# Leer el contenido de un curso {#read-a-courses-content}

Un programa para un estudiante que recorre las páginas y los libros de un curso como lo haría una persona, haciendo una pausa para leer cada uno, guarda su texto en disco y los marca como completados donde la actividad tiene finalización manual.

**Usa:** [cursos](../areas/courses.md), [contenido](../areas/content.md), [finalización](../areas/completion.md); consulta también [Trabajar al ritmo de un estudiante](../concepts/student-pace.md).

## El programa {#the-program}

```ts
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CompletionError, createMoodle } from "@falkenslab/moodle-driver";

// El id del curso, de listCourses(); los textos van a NOTES, un archivo por actividad.
const COURSE_ID = 3;
const NOTES = "/home/ada/apuntes/programacion-101";

await using moodle = createMoodle({
  site: "https://campus.example.org/",
  profileDir: "/home/ada/.moodle-profile",
  headless: true,
  downloadBrowser: true,
  // El valor por defecto, dicho por claridad: las páginas reales una a una, con las pausas de quien lee.
  trail: "realistic",
  // Se llama cada pocos segundos durante las pausas: una línea, reescrita en el sitio.
  onProgress: (seconds) => process.stdout.write(`\r  leyendo... ${seconds}s`),
});
await moodle.logIn();
await mkdir(NOTES, { recursive: true });

for (const section of await moodle.courseStructure(COURSE_ID)) {
  for (const activity of section.activities) {
    if ((activity.type !== "page" && activity.type !== "book") || !activity.availableToMe) continue;
    // Ya completada (a mano, o al verla): se salta, así que al volver a ejecutarlo sigue donde se quedó.
    if (activity.completion?.complete) continue;

    console.log(`${section.title} > ${activity.name}`);
    // Una página espera lo que tarda en leerse su texto; un libro se lee capítulo a capítulo, siguiendo "siguiente".
    const content = await moodle.activityContent(activity);
    const text = content.chapters?.map((c) => `# ${c.title}\n\n${c.text}`).join("\n\n") ?? content.text ?? "";
    await writeFile(path.join(NOTES, `${activity.id}.md`), `# ${activity.name}\n\n${text}\n`);
    console.log(`\r  leído en ${content.readingSeconds ?? 0}s${content.chapters ? `, ${content.chapters.length} capítulos` : ""}`);

    // Solo una actividad que sigue la finalización de la persona tiene `completion`.
    if (!activity.completion) continue;
    try {
      const { changed } = await moodle.setCompletion(activity.id, true);
      console.log(`  ${changed}`);
    } catch (error) {
      // Finalización automática (al verla, por ejemplo): decide Moodle, y lo que cuenta es la lectura de arriba.
      if (error instanceof CompletionError) console.log("  se completa automáticamente");
      else throw error;
    }
  }
}
```

## Paso a paso {#step-by-step}

1. `createMoodle` recibe el ritmo una sola vez: `trail: "realistic"` (el valor por defecto) y un `onProgress` que usan todas las llamadas que leen. Consulta [Trabajar al ritmo de un estudiante](../concepts/student-pace.md).
2. `logIn()` abre una ventana la primera vez para que la persona inicie sesión.
3. `courseStructure(COURSE_ID)` enumera las secciones y las actividades, con la finalización de la persona en cada una. Se saltan las páginas y los libros que la persona aún no puede abrir (`availableToMe: false`) y los que ya están completados.
4. `activityContent(activity)` recibe la actividad tal como la da la estructura. Cada página espera lo que tardaría una persona en leerla (unas 240 palabras por minuto, de 3 a 90 segundos por página), así que la ejecución dura minutos, y la línea de progreso cuenta los segundos. Moodle registra las visitas como las de una persona.
5. El texto (en un libro, sus capítulos con sus títulos) va a un archivo Markdown con el id de la actividad como nombre.
6. `setCompletion(activity.id, true)` es "Marcar como hecha". Moodle solo lo acepta con finalización manual: una actividad que se completa sola (al verla, al calificarla…) responde con `CompletionError`, y el programa sigue.

## Lo que imprime {#what-it-prints}

Un ejemplo; el curso decide los nombres y los tiempos.

```text
Bucles > ¿Qué es un bucle?
  leído en 41s
  Activity 52 marked done.
Bucles > El libro de los bucles
  leído en 236s, 5 capítulos
  se completa automáticamente
Recursividad > La recursividad, paso a paso
  leído en 87s
  Activity 61 marked done.
```

## Variaciones {#variations}

- Rápido, para un sandbox donde nadie lee los registros: `trail: "fast"`. Un libro se lee de una vez desde su página de impresión, lo que puede dejar sin cumplir la finalización que exige ver cada capítulo.
- También las áreas de texto y medios (los textos de la propia página del curso): añade `activity.type === "label"`; tienen `text` como una página.
- Los vídeos del contenido: `for (const item of content.media ?? []) console.log(item.kind, item.url)`; el driver da sus URL, no los reproduce.
- Deshacer una marca hecha por error: `await moodle.setCompletion(52, false)`.

## Cuando algo sale mal {#when-something-goes-wrong}

- `CompletionError` de `setCompletion`: la actividad se completa automáticamente, el curso no tiene la finalización activada o la persona no puede cambiarla. El programa lo indica y sigue.
- `NotViewableError` de `activityContent`: la página o el libro no se puede ver ahora (se ocultó o se restringió después de leer la estructura).
- `NotLoggedInError`: la sesión caducó, algo más probable en una lectura larga. Llama a `moodle.logIn()` y vuelve a ejecutarlo: lo completado se salta.
- `MoodleServiceError` de `courseStructure` o `setCompletion`: Moodle se negó, con su `errorcode` (un curso en el que la persona no está matriculada, por ejemplo). Consulta [Errores](../concepts/errors.md).

## Datos que toca {#data-it-touches}

`courseStructure` es `course-content` y `own`, `activityContent` es `course-content`, y `setCompletion` es `own`. Consulta [categorías de datos](../concepts/data-categories.md).
