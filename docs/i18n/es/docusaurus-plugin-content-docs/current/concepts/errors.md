# Errores

Los errores con los que un programa puede hacer algo tienen su propia clase, y sus mensajes hablan en términos de Moodle: el módulo, la estructura del curso, volver a iniciar sesión. Nunca nombran las herramientas ni los ajustes propios de un programa, así que un programa puede mostrarlos tal cual o explicarlos con sus propias palabras.

Tampoco llevan nunca la sesión de la persona, así que pueden registrarse tal cual: cuando una petición a Moodle agota su tiempo de espera, el mensaje de Playwright lista las cabeceras de la petición, y el driver sustituye en él la cookie de sesión y la `sesskey` por `[redacted]`.

**Términos:** [código de error](../reference/glossary.md#error-code).

## Capturarlos {#catching-them}

Todo error que el driver lanza a propósito es un `MoodleError`, o una de sus subclases, con un `code` estable y un `name` igual al nombre de su clase. Compara por clase, por `name` o por `code`, nunca por mensaje: el texto puede cambiar en cualquier versión. `error.name` y `error.code` también funcionan entre bundles distintos.

```ts
import { NotLoggedInError, MoodleServiceError, FormError } from "@falkenslab/moodle-driver";

try {
  await moodle.gradeSubmission(35, 7, { grade: "150" });
} catch (error) {
  if (error instanceof NotLoggedInError) {
    // La sesión ha terminado: moodle.logIn() otra vez (se abre una ventana) y reintenta.
  } else if (error instanceof FormError) {
    for (const { field, message } of error.fields) console.error(`${field}: ${message}`);
  } else if (error instanceof MoodleServiceError) {
    console.error(error.methodname, error.errorcode, error.message);
  } else {
    throw error;
  }
}
```

Los errores sin clase propia son `MoodleError` con un código genérico:

| Código | Cuándo |
| --- | --- |
| `invalid-input` | Un argumento no puede funcionar: una ruta relativa, un mensaje vacío, `content` para un módulo que no tiene, `downloadFile` sin carpeta |
| `not-found` | Lo indicado no está: una sección del curso, un archivo local, un archivo del sitio (Moodle respondió 404) |
| `not-available` | La actividad no lo tiene: una tarea sin comentarios de retroalimentación, un foro sin archivos adjuntos, un módulo sin archivos |
| `outside-site` | Un archivo que descargar no está en el sitio |
| `unexpected-page` | Una página no tiene lo que el driver lee de ella |
| `logout-failed` | Moodle no cerró la sesión |
| `chromium-install-failed` | El instalador de Playwright falló |
| `background-browser` | Un navegador en segundo plano (`moodle open`) no arrancó, no responde o se cerró mientras se usaba |
| `browser-busy` | Otro comando está trabajando con el navegador en segundo plano del perfil: vuelve a intentarlo cuando termine |

```ts
import { MoodleError } from "@falkenslab/moodle-driver";

try {
  await moodle.downloadFile("https://campus.example.org/pluginfile.php/1/x.pdf", "/home/ada/files");
} catch (error) {
  if (error instanceof MoodleError && error.code === "not-found") console.error("Ya no está, o no lo puedes ver.");
  else throw error;
}
```

El código de cada clase es su nombre en kebab-case sin `Error` (`NotLoggedInError` es `not-logged-in`, `SurveyError` es `survey`); el tipo `MoodleErrorCode` los lista todos.

## La sesión y el navegador {#the-session-and-the-browser}

| Error | Cuándo |
| --- | --- |
| `NotLoggedInError` | No hay sesión de Moodle, o ha caducado. Cualquier función que lee el sitio lo lanza. Vuelve a iniciar sesión con `logIn()`. |
| `LoginTimeoutError` | `logIn()` esperó `timeoutMs` y nadie inició sesión; la ventana se cerró. |
| `LoginWindowClosedError` | La persona cerró la ventana de inicio de sesión antes de iniciar sesión. |
| `NoDisplayError` | Hacía falta una ventana (para iniciar sesión, `setVisible(true)`) donde no hay pantalla. |
| `BrowserNotFoundError` | No se pudo lanzar ningún navegador instalado, y no se permite descargar Chromium. |
| `BrowserDownloadingError` | Chromium se está descargando en segundo plano: vuelve a intentarlo en un minuto o dos. |
| `MoodleUrlError` | Una URL de sitio no es una URL, no es http(s) o no es un sitio Moodle. |

## Errores genéricos de Moodle {#generic-moodle-errors}

| Error | Cuándo | Qué lleva |
| --- | --- | --- |
| `MoodleServiceError` | Un servicio AJAX de Moodle respondió con una excepción que el driver no traduce | `methodname`, `errorcode` (el de Moodle, p. ej. `nopermissions`, `invalidrecord`), el mensaje de Moodle |
| `FormError` | Moodle rechazó un formulario (sus mensajes de validación por campo), un campo que hay que fijar no está en el formulario, o está desactivado hasta que otro campo lo activa | `fields: { field, message }[]` |

Un `FormError` por un campo desactivado ocurre donde Moodle no lo guardaría: por ejemplo, la calificación máxima de una tarea una vez que existen calificaciones, hasta que se elige `grade[modgrade_rescalegrades]`. Fija antes el campo que lo activa, en la misma llamada.

## Errores de las áreas {#area-errors}

Cada área tiene su propia clase para lo que le es específico: el id no es de ese tipo de actividad, la persona no puede hacer eso ahora, Moodle rechazó la acción. Sus mensajes dicen qué hacer.

| Error | Área |
| --- | --- |
| `NotViewableError` | [Contenido](../areas/content.md): la actividad no es del tipo pedido, o no se puede ver |
| `BookError` | [Contenido](../areas/content.md#a-books-chapters): no es un libro que la persona pueda leer o editar, o el capítulo no está en él |
| `ActivitySettingsError` | [Actividades](../areas/activities.md): no hay formulario de configuración que leer |
| `CourseError` | [Cursos](../areas/courses.md): la configuración del curso no se puede cambiar, o no se puede reiniciar |
| `BackupError` | [Copia, copia de seguridad y restauración](../areas/copy-backup-restore.md): Moodle se negó, o no terminó a tiempo |
| `SubmissionError` | [Tareas](../areas/assignments.md): nada que entregar, no se puede editar la entrega… |
| `NotAnAssignmentError`, `GradingError` | [Calificación](../areas/grading.md): no es una tarea que la persona pueda calificar; Moodle no guardó la calificación |
| `WorkshopError` | [Calificación](../areas/grading.md#workshopinfo): no es un taller; Moodle se negó a cambiar su fase o no ofrece ninguna evaluación; la persona no puede asignar (`mod/workshop:allocate`) o el revisor no es uno de los que ofrece Moodle |
| `QuizError` | [Cuestionarios](../areas/quizzes.md): intentos, revisiones, resultados, excepciones, estructura |
| `QuestionBankError` | [Bancos de preguntas](../areas/question-banks.md) |
| `NotAForumError`, `ForumError` | [Foros](../areas/forums.md) |
| `SurveyError`, `ChoiceError` | [Encuestas y consultas](../areas/surveys-and-choices.md) |
| `LessonError` | [Lecciones](../areas/lessons.md) |
| `NotAnH5PActivityError` | [H5P](../areas/h5p.md) |
| `ScormError` | [SCORM](../areas/scorm.md) |
| `NotADatabaseError`, `DatabaseError` | [Bases de datos](../areas/databases.md): no es una base de datos; la persona no puede gestionarla, o Moodle rechazó un campo, una plantilla o un preajuste |
| `NotAGlossaryError`, `GlossaryError` | [Glosarios](../areas/glossaries.md): no es un glosario; falta una capacidad del glosario (nombrada), la entrada es de otra persona, se acabó el tiempo de edición, no existe esa entrada |
| `NoGradeReportError`, `GradebookError` | [Calificaciones y libro de calificaciones](../areas/grades-and-gradebook.md) |
| `CompletionError` | [Finalización](../areas/completion.md) |
| `BadgeError`, `BadgesDisabledError` | [Insignias](../areas/badges.md): falta una capacidad de insignias (que se nombra), un criterio que Moodle no ofrece; un sitio con las insignias desactivadas |
| `NoParticipantsError`, `EnrolmentError` | [Participantes](../areas/participants.md): no puede ver los participantes; Moodle se negó a matricular, desmatricular o asignar un rol |
| `ReportError` | [Registros e informes](../areas/logs-and-reports.md): la persona no puede ver el informe, o la actividad no es del curso |
| `CalendarError` | [Calendario](../areas/calendar.md) |
| `MessageError` | [Mensajes](../areas/messages.md) |

## Los mensajes propios de Moodle {#moodles-own-messages}

Cuando Moodle se niega con una página de error (sin permiso, no existe ese registro), el driver incluye el mensaje de Moodle, en el idioma del sitio, después de su propia explicación: "You can't see course 3's grader report: Sorry, but you do not currently have permissions to do that (View grader report)". `moodleErrorMessage(page)` lee ese mensaje de una página tuya.
