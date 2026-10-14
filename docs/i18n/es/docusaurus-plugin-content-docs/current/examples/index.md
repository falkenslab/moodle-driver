---
sidebar_label: Resumen
---

# Ejemplos {#examples}

Programas completos para tareas reales, cada uno explicado paso a paso, con el código comentado allí donde Moodle o el driver hacen algo que no adivinarías. Copia uno, cambia el sitio, el perfil y los ids, y ejecútalo.

Todos los programas empiezan igual: un objeto `Moodle` para el sitio, creado con `await using` para que el navegador se cierre cuando termina el programa, y `logIn()`, que solo abre una ventana la primera vez (consulta [Iniciar sesión](../getting-started/logging-in.md)). Los ids salen del sitio: el de un curso, de `listCourses()`; el de una actividad, de `courseStructure()` (consulta [Ids](../concepts/calling-functions.md#ids)).

## 🎒 Como estudiante {#-as-a-student}

| Ejemplo | Qué hace |
| --- | --- |
| [Una agenda semanal](weekly-agenda.md) | Cursos en marcha, fechas límite de la semana, lo pendiente y las notificaciones sin leer |
| [Descargar los archivos de un curso](download-course-files.md) | Todos los archivos y carpetas de un curso, guardados en una carpeta por sección |
| [Leer el contenido de un curso](read-course-content.md) | Páginas y libros al ritmo de una persona, marcados como completados donde el curso lo pide |
| [Enviar una tarea](submit-assignment.md) | Texto en línea y un archivo, enviados para calificar, con la declaración aceptada por la persona |
| [Responder un cuestionario](answer-quiz.md) | Un intento página a página, terminado, con su revisión impresa |
| [Encuestas y consultas](surveys-and-choices.md) | Una encuesta de feedback o questionnaire, y una consulta |

## 🧑‍🏫 Como profesor {#-as-a-teacher}

| Ejemplo | Qué hace |
| --- | --- |
| [Calificar entregas](grade-submissions.md) | Entregas pendientes calificadas con retroalimentación, de forma simple o con una rúbrica |
| [Ampliaciones y excepciones](extensions-and-overrides.md) | Más tiempo para un estudiante: una ampliación del plazo de una tarea y una excepción de un cuestionario |
| [Escribir a los estudiantes inactivos](message-inactive-students.md) | Los estudiantes que llevan dos semanas sin entrar, cada uno con un mensaje |
| [Un informe diario](daily-report.md) | Notificaciones, fechas límite, lo que ha cambiado en un curso y los debates más recientes del foro |
| [Construir una unidad del curso](build-course.md) | Una sección con páginas, un enlace y una tarea, a partir de un esquema en el programa |
| [Exportar las calificaciones a CSV](export-grades-csv.md) | El informe del calificador como hoja de cálculo |
| [Preguntas en un cuestionario](questions-into-quiz.md) | Preguntas importadas a un banco y añadidas a un cuestionario, también una aleatoria |

## 🛠️ Para tu programa {#️-for-your-program}

| Ejemplo | Qué hace |
| --- | --- |
| [Errores y sesiones](errors-and-sessions.md) | Un programa que vuelve a iniciar sesión cuando la sesión termina e informa de los errores por su código |
| [Varios sitios](several-sites.md) | Un objeto por sitio y persona, y el navegador a la vista mientras alguien mira |
| [Servicios de Moodle](moodle-services.md) | Lo que el driver no envuelve: los servicios AJAX, las páginas y los formularios de Moodle, y cómo limitar lo que se puede llamar |
| [Probar tu programa](testing-your-program.md) | Pruebas contra el Moodle simulado, sin un sitio real |
