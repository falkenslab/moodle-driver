# Descargar los archivos de un curso {#download-a-courses-files}

Un programa para un estudiante que guarda todos los archivos de un curso (los recursos de tipo archivo y los archivos de las carpetas) en una carpeta local, con una subcarpeta por sección, para conservarlos o leerlos sin conexión.

**Usa:** [cursos](../areas/courses.md), [contenido](../areas/content.md), [archivos](../areas/files.md).

## El programa {#the-program}

```ts
import path from "node:path";
import { createMoodle, MoodleError } from "@falkenslab/moodle-driver";

// El id del curso, de listCourses() (el id de course/view.php?id=3).
const COURSE_ID = 3;
// Dónde van los archivos, como ruta absoluta: una subcarpeta por sección.
const ROOT = "/home/ada/moodle-files/programacion-101";

await using moodle = createMoodle({
  site: "https://campus.example.org/",
  profileDir: "/home/ada/.moodle-profile",
  headless: true,
  downloadBrowser: true,
  // Leer el enlace de un archivo no es leer: no hacen falta pausas, y una carpeta se lee de su árbol de una vez.
  trail: "fast",
  // Lo que usa downloadFile(url) cuando no recibe carpeta; aquí, la raíz donde van las carpetas de las secciones.
  downloadDir: ROOT,
});
await moodle.logIn();

// "03 Recursividad": primero el número, para que las carpetas se ordenen como el curso; sin caracteres que un nombre de carpeta no admite.
const folderFor = (number: number, title: string) => `${String(number).padStart(2, "0")} ${title.replace(/[\\/:*?"<>|.]+/g, "_").trim()}`;

let count = 0;
for (const section of await moodle.courseStructure(COURSE_ID)) {
  // Recursos de tipo archivo ("resource") y carpetas; los restringidos aún no se pueden abrir.
  const withFiles = section.activities.filter((a) => (a.type === "resource" || a.type === "folder") && a.availableToMe);
  if (withFiles.length === 0) continue;
  const dir = path.join(moodle.defaults.downloadDir ?? ROOT, folderFor(section.number, section.title));
  console.log(`${section.title}/`);

  for (const activity of withFiles) {
    // Solo los enlaces (URL de pluginfile.php): todavía no se descarga nada, pero Moodle registra la visita.
    const { files = [] } = await moodle.activityContent(activity);
    for (const file of files) {
      try {
        // Se descarga con las cookies de la sesión, sin abrir una pestaña; un nombre que ya existe pasa a ser "nombre (2).ext".
        const saved = await moodle.downloadFile(file.url, dir);
        console.log(`  ${saved.name} (${Math.round(saved.size / 1024)} KB)`);
        count++;
      } catch (error) {
        // Un archivo borrado u oculto desde que se leyó la carpeta: se salta y se sigue.
        if (error instanceof MoodleError && error.code === "not-found") console.log(`  ${file.name}: no disponible`);
        else throw error;
      }
    }
  }
}
console.log(`\n${count} archivos guardados en ${ROOT}`);
```

## Paso a paso {#step-by-step}

1. `createMoodle` recibe `trail: "fast"` y `downloadDir` una sola vez, como valores por defecto para todas las llamadas (consulta [Valores por defecto](../concepts/calling-functions.md#defaults)). El rastro rápido encaja aquí: no hay texto que leer, solo enlaces.
2. `logIn()` abre una ventana la primera vez para que la persona inicie sesión, y después responde al instante.
3. `courseStructure(COURSE_ID)` da las secciones del curso en orden, cada una con sus actividades. `COURSE_ID` sale de `listCourses()`; el `id` y el `type` de cada actividad salen de aquí.
4. Para cada recurso de tipo archivo o carpeta que la persona puede abrir, `activityContent(activity)` devuelve `files`: sus nombres y sus enlaces `pluginfile.php`. Un recurso de tipo archivo tiene uno; una carpeta, los archivos que muestra su árbol, todos en una lista.
5. `downloadFile(url, dir)` guarda cada uno en la carpeta de la sección, y la crea si hace falta. Pone al archivo el nombre con que lo envía Moodle y nunca sobrescribe.

## Lo que imprime {#what-it-prints}

Un ejemplo; los títulos y los nombres son los del curso.

```text
General/
  Guía docente.pdf (182 KB)
01 Primeros pasos/
  Instalar Python.pdf (640 KB)
02 Bucles/
  Diapositivas de bucles.pdf (1204 KB)
  ejercicios.zip (36 KB)
  soluciones.zip: no disponible
03 Recursividad/
  Apuntes de recursividad.pdf (512 KB)

5 archivos guardados en /home/ada/moodle-files/programacion-101
```

## Variaciones {#variations}

- Todos los archivos en una carpeta, sin subcarpetas: `await moodle.downloadFile(file.url)` guarda en el `downloadDir` del objeto.
- También los archivos adjuntos a las descripciones de las tareas: para las actividades de tipo `"assign"`, `(await moodle.studentAssignment(activity.id)).descriptionFiles` tiene los mismos enlaces `{ name, url }`.
- Todos los cursos en marcha: recorre `await moodle.listCourses("inprogress")` y usa el `shortname` de cada curso como subcarpeta de la raíz.
- Dejar en cambio un rastro realista en los registros (una persona abriendo cada recurso): quita `trail: "fast"`. Los archivos y las carpetas no tienen pausas de todos modos, así que solo importa si el programa también lee páginas.

## Cuando algo sale mal {#when-something-goes-wrong}

- `NotLoggedInError`: la sesión caducó, o la URL de un archivo respondió con la página de acceso. Llama a `moodle.logIn()` y vuelve a ejecutarlo; los archivos ya guardados se conservan, y se guardan de nuevo como "nombre (2)" salvo que el programa se los salte.
- `MoodleError` con código `not-found`: Moodle respondió con un estado de error para ese archivo (borrado, u oculto para la persona). El programa lo salta.
- `MoodleError` con código `outside-site`: la URL no está en el sitio. No pasa con los `files` de un recurso o una carpeta, que son enlaces `pluginfile.php`; sí con el destino de un recurso URL.
- `NotViewableError` de `activityContent`: la actividad no se puede ver como ese tipo (se cambió, o la persona perdió el acceso). Consulta [Errores](../concepts/errors.md).

## Datos que toca {#data-it-touches}

`courseStructure` es `course-content` y `own`, `activityContent` es `course-content`, y `downloadFile` es `course-content` y `others-personal` (la misma función guarda entregas de otros; aquí todas las URL vienen de los recursos del curso). Consulta [categorías de datos](../concepts/data-categories.md).
