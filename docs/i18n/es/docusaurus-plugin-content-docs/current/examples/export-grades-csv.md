# Exportar el informe del calificador a CSV {#export-the-grader-report-to-csv}

Un profesor guarda en un archivo CSV las calificaciones de todos en un curso: una fila por estudiante, una columna por elemento de calificación con el nombre que le da el libro de calificaciones, con los totales de categoría y del curso.

**Usa:** [Calificaciones y libro de calificaciones](../areas/grades-and-gradebook.md), [Participantes](../areas/participants.md).

## El programa {#the-program}

```ts
import { writeFileSync } from "node:fs";
import { createMoodle, GradebookError, NotLoggedInError } from "@falkenslab/moodle-driver";

// El id del curso, de su dirección (course/view.php?id=3) o de moodle.listCourses().
const COURSE_ID = 3;
// Solo los estudiantes de un grupo (un id de moodle.groups(COURSE_ID)), o undefined para el informe tal como se abre.
const GROUP_ID: number | undefined = undefined;
const OUTPUT = "/home/teacher/calificaciones/curso-3.csv";

// RFC 4180: una celda con una coma, unas comillas o un salto de línea va entre comillas, con sus comillas duplicadas.
function cell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

await using moodle = createMoodle({ site: "https://campus.example.org/", profileDir: "/home/teacher/.moodle-profile", headless: true, downloadBrowser: true });

try {
  await moodle.logIn();

  // Todas las páginas del informe del calificador, leídas hasta que no llegan estudiantes nuevos.
  const report = await moodle.graderReport(COURSE_ID, { group: GROUP_ID });

  // Las columnas llegan en el orden del informe: elementos, después el total de cada categoría y luego el total del curso.
  const header = ["Id de usuario", "Nombre completo", ...report.columns.map((c) => c.name)];
  const lines = [header.map(cell).join(",")];
  for (const row of report.rows) {
    // Una calificación se refiere a su columna por itemId; una celda sin calificación ("-") no tiene campo grade.
    const byItem = new Map(row.grades.map((g) => [g.itemId, g.grade]));
    const grades = report.columns.map((c) => byItem.get(c.id) ?? "");
    lines.push([row.userId, row.fullName, ...grades].map(cell).join(","));
  }

  // Finales de línea CRLF, como esperan RFC 4180 y las hojas de cálculo.
  writeFileSync(OUTPUT, lines.join("\r\n") + "\r\n", "utf8");
  console.log(`${report.rows.length} estudiantes, ${report.columns.length} columnas de calificación -> ${OUTPUT}`);
} catch (error) {
  // GradebookError lleva el motivo de Moodle: sin permiso, curso inexistente o calificaciones recalculándose.
  if (error instanceof GradebookError) console.error(error.message);
  else if (error instanceof NotLoggedInError) console.error("No hay sesión: vuelve a ejecutarlo para iniciar sesión.");
  else throw error;
}
```

## Paso a paso {#step-by-step}

1. `COURSE_ID` es el id del curso; `GROUP_ID`, cuando se da, es el id de un grupo sacado de `groups()` o de `participantFilters()`.
2. `logIn()` abre una ventana la primera vez para que el profesor inicie sesión; las siguientes ejecuciones reutilizan la sesión sin mostrar nada.
3. `graderReport` abre el informe del calificador del curso (`grade/report/grader/index.php`) y lee todas sus páginas. Lee la tabla por su estructura, así que el idioma del sitio no importa, y da las calificaciones como el texto que muestra Moodle ("8.00", "80.00 %", "B+"): la configuración de visualización de calificaciones del curso decide su formato.
4. La cabecera toma el `name` de cada columna tal como lo muestra el informe ("Factorial recursivo", "Total prácticas", "Total del curso"). El `kind` de una columna distingue un elemento (`"item"`) del total de una categoría (`"category"`) y del total del curso (`"course"`).
5. Las calificaciones de cada estudiante se casan con las columnas por `itemId`, así que una celda sin calificación se convierte en una celda CSV vacía en lugar de desplazar la fila.
6. `cell` pone entre comillas lo que lo necesita: nombres con comas ("Ruiz, Ana"), comillas, o calificaciones escritas con coma decimal ("8,50") en un sitio en español.
7. El archivo se escribe con `node:fs`; el navegador se cierra cuando termina el programa, gracias a `await using`.

## Lo que imprime {#what-it-prints}

Una ejecución de ejemplo:

```text
24 estudiantes, 7 columnas de calificación -> /home/teacher/calificaciones/curso-3.csv
```

Y el principio del archivo:

```text
Id de usuario,Nombre completo,Cuestionario 1,Factorial recursivo,Práctica 1,Práctica 2,Total prácticas,Total del curso
41,Ada Byron,8.00,9.50,10.00,7.00,17.00,34.50
42,"Ruiz, Ana",6.50,,9.00,8.00,17.00,23.50
```

## Variaciones {#variations}

- Solo los elementos, sin totales: `report.columns.filter((c) => c.kind === "item")` antes de construir la cabecera y las filas.
- Un archivo por grupo, para el tutor de cada grupo: recorre `await moodle.groups(COURSE_ID)` y llama a `graderReport(COURSE_ID, { group: group.id })` con un archivo que lleve el `group.name`.
- Para Excel, que lee un archivo UTF-8 sin más como la página de códigos del sistema, empieza el archivo con una marca de orden de bytes: `writeFileSync(OUTPUT, "﻿" + lines.join("\r\n"), "utf8")`.
- Añade el id de la actividad a la cabecera (`${c.name} (${c.activityId})`) cuando dos elementos comparten nombre, o para cruzar el archivo con otros datos por actividad.

## Cuando algo sale mal {#when-something-goes-wrong}

- `GradebookError`: Moodle rechazó el informe (la persona no puede ver el informe del calificador, o el curso no existe), con el motivo de Moodle en el mensaje. También llega mientras Moodle recalcula las calificaciones del curso tras un cambio (el informe muestra una barra de progreso): espera un momento y vuelve a ejecutarlo.
- `NotLoggedInError`: la sesión caducó; vuelve a ejecutarlo e inicia sesión.
- Un error de Node.js de `writeFileSync` (`ENOENT`) cuando la carpeta de salida no existe: créala antes con `mkdirSync(dir, { recursive: true })`.

## Datos que toca {#data-it-touches}

`graderReport` es `others-personal`: los nombres y las calificaciones de todos, que luego también contiene el archivo CSV; lo mismo `groups`, de donde sale el id de un grupo. Consulta [categorías de datos](../concepts/data-categories.md).
