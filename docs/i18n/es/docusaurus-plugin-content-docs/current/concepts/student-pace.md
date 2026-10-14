# Trabajar al ritmo de un estudiante

Cuando un programa actúa como estudiante, Moodle registra lo que hace como del estudiante: visitas a páginas en los registros, tiempo en el curso, finalización que depende de ver. Un programa que lee un libro entero en un segundo, o que responde un cuestionario en cuanto se abre, deja registros que ninguna persona dejaría. Las funciones que actúan como estudiante aceptan una opción `trail` para elegir (ADR-005).

**Términos:** [rastro](../reference/glossary.md#trail).

![Dos rastros: realista, por las páginas reales al ritmo de un lector, o rápido, de golpe](/img/diagrams/student-pace.svg)

## Los dos rastros {#the-two-trails}

```ts
type Trail = "realistic" | "fast";
```

- `"realistic"` (el predeterminado): por las páginas reales, una a una, esperando lo que una persona necesitaría para leer cada una (unas 240 palabras por minuto, entre 3 y 90 segundos por página). Moodle registra las visitas y la finalización como las de una persona.
- `"fast"`: sin esperas, y el camino más rápido que ofrece Moodle (la vista de impresión de un libro en lugar de capítulo a capítulo). Para pruebas, sandboxes y programas en los que nadie mira los registros.

## Dónde se aplica {#where-it-applies}

| Función | Realista | Rápido |
| --- | --- | --- |
| `activityContent()` | Una página o un área de texto y medios leída durante lo que tarda su texto; un libro capítulo a capítulo, siguiendo "siguiente" | Una página leída al momento; un libro desde su vista de impresión |
| `answerQuizQuestions()` | Cada página de preguntas leída antes de guardarla | Guardada al momento |
| `answerLessonPage()` | La página leída antes de responder | Respondida al momento |

## Elegirlo una vez {#choosing-it-once}

Un programa suele querer un mismo ritmo en todas partes: dáselo al objeto, `createMoodle({ …, trail: "fast" })`, y todas las acciones de estudiante lo usan salvo que una llamada diga otra cosa (consulta [Valores predeterminados](calling-functions.md#defaults)). Un `onProgress` dado al objeto informa de las esperas de todas las llamadas.

## Progreso {#progress}

Esperar puede llevar minutos. Estas funciones aceptan un callback `onProgress`, al que llaman cada pocos segundos mientras esperan, para que un programa pueda avisar a la persona o mantener viva una conexión (un protocolo que caduca sin actividad).

```ts
const book = await moodle.activityContent(6, "book", {
  trail: "realistic",
  onProgress: (secondsRead) => process.stderr.write(`\rLeyendo... ${secondsRead}s`),
});
console.log(`\n${book.chapters?.length} capítulos, ${book.readingSeconds}s`);
```

`answerQuizQuestions` y `answerLessonPage` llaman a `onProgress(elapsed, total)` con los segundos transcurridos y el total de la página.

## Construir tu propio ritmo {#building-your-own-pace}

`readingSeconds(text)` da los segundos que tardaría una persona en leer un texto, y `pause(seconds, onProgress?)` espera ese tiempo informando del progreso: las mismas piezas que usa el driver, para los pasos propios de un programa.
