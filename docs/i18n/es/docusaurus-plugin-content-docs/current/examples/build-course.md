# Construir una unidad del curso a partir de un esquema {#build-a-course-unit-from-an-outline}

Un profesor escribe el esquema de una unidad como datos simples en el programa (una sección, sus páginas, un enlace, un archivo y una tarea con fecha de entrega) y el programa la construye en el curso, dejando la tarea oculta hasta que esté lista.

**Usa:** [Actividades y secciones](../areas/activities.md), [Cursos](../areas/courses.md), [Archivos](../areas/files.md).

## El programa {#the-program}

```ts
import { createMoodle, FormError, MoodleError, NotLoggedInError } from "@falkenslab/moodle-driver";

// El id del curso, de su dirección (course/view.php?id=3) o de moodle.listCourses().
const COURSE_ID = 3;

// La unidad, como datos simples: cámbiala y vuelve a ejecutarlo para construir otra unidad.
const outline = {
  section: "Unidad 4: Recursividad",
  pages: [
    { name: "Qué es la recursividad", html: "<p>Una función que se llama a sí misma, con un <strong>caso base</strong> que la detiene.</p>" },
    { name: "La recursividad y la pila de llamadas", html: "<p>Cada llamada espera en la pila hasta que vuelve la que ella hizo.</p>" },
  ],
  link: { name: "Mira cómo crece la pila de llamadas", url: "https://pythontutor.com/" },
  slides: { name: "Diapositivas de la unidad 4", file: "/home/teacher/unidad-4/diapositivas.pdf" },
  assignment: {
    name: "Factorial recursivo",
    description: "<p>Escribe <code>factorial(n)</code> de forma recursiva y sube tu archivo <code>.py</code>.</p>",
    // En la zona horaria del profesor en Moodle: los selectores de fecha del formulario trabajan en ella.
    due: { day: 30, month: 11, year: 2026, hour: 23, minute: 55 },
  },
};

await using moodle = createMoodle({ site: "https://campus.example.org/", profileDir: "/home/teacher/.moodle-profile", headless: true, downloadBrowser: true });

try {
  await moodle.logIn();

  // Una sección nueva al final del curso; sectionId es su id en la base de datos, no su número.
  const section = await moodle.addSection(COURSE_ID, { name: outline.section });
  const sectionId = section.sectionId!;
  const course = { courseId: COURSE_ID, sectionId };

  // createActivity oculta lo que crea salvo que se le diga otra cosa: estas están listas, así que se muestran.
  for (const page of outline.pages) {
    const created = await moodle.createActivity({ ...course, type: "page", name: page.name, content: page.html, visibility: "shown" });
    console.log(created.changed);
  }
  console.log((await moodle.createActivity({ ...course, type: "url", name: outline.link.name, url: outline.link.url, visibility: "shown" })).changed);
  // Un recurso de tipo archivo: el PDF se sube al área de archivos del formulario antes de guardar.
  console.log((await moodle.createActivity({ ...course, type: "resource", name: outline.slides.name, files: [outline.slides.file], visibility: "shown" })).changed);

  // La tarea se queda oculta (el valor por defecto) hasta que el profesor la revise.
  const { due } = outline.assignment;
  const assignment = await moodle.createActivity({
    ...course,
    type: "assign",
    name: outline.assignment.name,
    description: outline.assignment.description,
    settings: {
      // Las partes de una fecha están desactivadas hasta que se marca su casilla "Habilitar": esa va primero.
      "duedate[enabled]": true,
      "duedate[day]": due.day,
      "duedate[month]": due.month,
      "duedate[year]": due.year,
      "duedate[hour]": due.hour,
      "duedate[minute]": due.minute,
      // Moodle rechaza una fecha de "Recordarme calificar antes de" anterior a la fecha de entrega; esta unidad no la usa.
      "gradingduedate[enabled]": false,
      assignsubmission_file_enabled: true,
      assignsubmission_onlinetext_enabled: false,
    },
  });
  console.log(assignment.changed);

  // Cada cambio devuelve el curso tal como queda: no hace falta volver a leerlo.
  const built = assignment.sections.find((s) => s.id === sectionId);
  console.log(`\n${built?.title}`);
  for (const activity of built?.activities ?? []) console.log(`  [${activity.type}] ${activity.name} (${activity.id})${activity.visible ? "" : " - oculta"}`);
} catch (error) {
  if (error instanceof FormError) for (const { field, message } of error.fields) console.error(`${field}: ${message}`);
  else if (error instanceof NotLoggedInError) console.error("No hay sesión: vuelve a ejecutarlo para iniciar sesión.");
  else if (error instanceof MoodleError) console.error(`${error.code}: ${error.message}`);
  else throw error;
}
```

## Paso a paso {#step-by-step}

1. `COURSE_ID` es el id del curso: el `id` de su dirección, o el `id` de un curso de `listCourses()`. El esquema son datos corrientes; el programa podría leerlos igual de un archivo JSON o YAML.
2. `logIn()` abre una ventana la primera vez para que el profesor inicie sesión él mismo; las siguientes ejecuciones reutilizan la sesión guardada en el perfil y no muestran nada.
3. `addSection` añade la sección al final del curso y le pone nombre. Su `sectionId` es lo que recibe `createActivity`, no el número que muestra la página del curso.
4. Cada `createActivity` rellena el formulario propio de la actividad (`course/modedit.php`) y lo guarda con "Guardar cambios y regresar al curso", como lo haría el profesor. Las actividades salen ocultas por defecto, así que las páginas, el enlace y las diapositivas piden `visibility: "shown"`.
5. Las diapositivas son un recurso de tipo archivo (`type: "resource"`): `files` recibe rutas locales absolutas, comprobadas antes de abrir ninguna página, y las sube al área de archivos del formulario.
6. Las opciones de la tarea van en `settings` por sus nombres en el formulario de Moodle. Las partes de la fecha de entrega se ponen una a una en el orden dado, así que `duedate[enabled]` va primero; Moodle las lee en la zona horaria que el profesor tiene en su perfil.
7. La tarea se deja oculta: el profesor la revisa en Moodle y la muestra cuando está lista (consulta las variaciones).
8. Las `sections` del último resultado son la estructura del curso tras el cambio, el mismo `CourseSection[]` que da `courseStructure()`: el programa imprime de ahí la sección nueva.

## Lo que imprime {#what-it-prints}

Una ejecución de ejemplo:

```text
Created page 812 "Qué es la recursividad" in section 5.
Created page 813 "La recursividad y la pila de llamadas" in section 5.
Created url 814 "Mira cómo crece la pila de llamadas" in section 5.
Created resource 815 "Diapositivas de la unidad 4" in section 5.
Created assign 816 "Factorial recursivo" in section 5.

Unidad 4: Recursividad
  [page] Qué es la recursividad (812)
  [page] La recursividad y la pila de llamadas (813)
  [url] Mira cómo crece la pila de llamadas (814)
  [resource] Diapositivas de la unidad 4 (815)
  [assign] Factorial recursivo (816) - oculta
```

## Variaciones {#variations}

- Mostrar la tarea una vez revisada: `await moodle.editActivity(COURSE_ID, 816, { visibility: "shown" });`.
- Poner la unidad después de otra sección en vez de al final: `await moodle.addSection(COURSE_ID, { name: outline.section, afterSectionId: 21 })`, con el id sacado de `courseStructure()`.
- Averiguar el nombre de una opción en el formulario antes de usarla: `(await moodle.activitySettings(816)).fields` enumera todos los campos con su `name`, su `label` y si está `disabled`; `courseActivityTypes(COURSE_ID)` enumera los tipos que el profesor puede añadir.
- Subir varios archivos como un único recurso que los estudiantes abren como lista: `type: "folder"` con todas las rutas en `files`.

## Cuando algo sale mal {#when-something-goes-wrong}

- `FormError`: Moodle rechazó el formulario (falta un nombre, una fecha de entrega anterior a la de "Permitir entregas desde"), el nombre de una opción no está en el formulario, o un campo sigue desactivado. Sus `fields` contienen cada campo y el mensaje de Moodle; marca primero la casilla que lo habilita en los mismos `settings`.
- `MoodleError` con código `not-found`: el curso no tiene ninguna sección con ese id, o un archivo de `files` no existe; `invalid-input`: una ruta relativa, o `content` para un tipo que no es una página ni un área de texto y medios; `not-available`: `files` para un tipo cuyo formulario no admite archivos.
- `MoodleServiceError` de `addSection` (con el `errorcode` de Moodle, como `nopermissions`): el profesor no puede editar este curso.
- `NotLoggedInError`: la sesión caducó; vuelve a ejecutarlo e inicia sesión. Las actividades ya creadas se quedan en el curso, así que bórralas o borra la sección (`deleteSection`) antes de volver a ejecutar el esquema entero.

## Datos que toca {#data-it-touches}

Todas las funciones a las que llama (`addSection`, `createActivity`) son `course-content`: lo que hacen los profesores, sin datos personales de nadie. Consulta [categorías de datos](../concepts/data-categories.md).
