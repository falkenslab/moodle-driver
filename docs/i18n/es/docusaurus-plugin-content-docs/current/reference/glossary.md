# Glosario

Las guías y la API usan los términos de Moodle tal como los nombra el código de Moodle, que pueden diferir de lo que su interfaz muestra a una persona (el "assign" del código es la "Tarea" de la interfaz, y la "slot" de un cuestionario no tiene ningún nombre en pantalla). La segunda parte explica los términos propios del driver: cómo mantiene el navegador, la sesión y el ritmo de la persona.

## Términos de Moodle {#moodle-terms}

### Actividad (activity) {#activity}

Cualquier cosa que un profesor añade a una sección de un curso: una tarea, un cuestionario, un foro, pero también una página, un archivo o un área de texto y medios (la interfaz de Moodle separa "actividades" de "recursos"; su código, y el driver, las llaman a todas actividades). Cada una es una instancia de un [módulo](#module) colocada en el curso como módulo del curso, identificada por su [id del módulo del curso](#course-module-id). El driver las lista con `courseStructure` (las `activities` de cada sección, como `CourseActivity` con `id`, `name` y `type`) y las construye con `createActivity`, `updateActivity`, `editActivity`, `duplicateActivity` y `deleteActivity`; consulta [Cursos](../areas/courses.md) y [Actividades y secciones](../areas/activities.md).

### Servicio AJAX (AJAX service) {#ajax-service}

Una función de los servicios web de Moodle a la que sus propias páginas llaman desde JavaScript mediante `lib/ajax/service.php`, con la [sesskey](#sesskey) de la página, y que responde JSON; solo funcionan desde un navegador las declaradas para AJAX (`'ajax' => true`), las demás responden `servicenotavailable`. El driver las llama por HTTP con la sesión de la persona y su sesskey, sin pestaña, siempre que una sirve para la tarea, y da a un programa la misma puerta con `callService` (también `moodle.callService`); un fallo llega como `MoodleServiceError` con el `errorcode` de Moodle. Consulta [Cómo funciona](../concepts/how-it-works.md) y [Bajar de nivel](../concepts/low-level.md).
`moodle.callService("core_group_get_course_groups", { courseid: 3 })`

### Tarea (assignment) {#assignment}

La actividad en la que los estudiantes entregan un trabajo para que un profesor lo califique: módulo `assign` en el código y las URL de Moodle (`mod/assign/view.php`), "Tarea" en la interfaz. La parte del estudiante es `studentAssignment`, `saveSubmission` y `submitForGrading` ([Tareas](../areas/assignments.md)); la del profesor es `assignmentSubmissions`, `gradeSubmission`, `rubric`, `grantExtension`, `setWorkflowState` y `allocateMarker` ([Calificación](../areas/grading.md)); `listAssignments` lista las de un curso ([Cursos](../areas/courses.md)). Un id que no es una tarea lanza `SubmissionError` o `NotAnAssignmentError`.

### Intento (attempt) {#attempt}

Una vez que se hace un cuestionario, desde que se empieza hasta que se envía, con sus respuestas, puntos y calificación; Moodle numera los intentos por persona e identifica cada uno con un id de intento (`mod/quiz/attempt.php?attempt=9`). El driver empieza o continúa uno con `startQuizAttempt` (que devuelve `attemptId`), lo lee y lo responde con `readAttempt` y `answerQuizQuestions`, lo termina con `finishQuizAttempt`, y lista los de todos con `quizResults` (`QuizAttemptResult`, con `id` y `userId`); `quizInfo` da los de la propia persona como `attempts`. Las actividades H5P también tienen intentos (`h5pActivity`, `H5PAttempt`). Consulta [Cuestionarios](../areas/quizzes.md) y [H5P](../areas/h5p.md).

### Copia de seguridad (backup) {#backup}

Un curso, o parte de uno (su contenido, y los datos de sus personas cuando se pide), guardado como un archivo `.mbz` (un archivo comprimido con gzip de archivos XML y los archivos del contenido), que Moodle puede restaurar en un curso nuevo o en uno existente; una copia de curso y una importación son una copia de seguridad restaurada al momento, sin archivo. Moodle las hace mediante asistentes, y puede hacer las copias de seguridad, restauraciones y copias más tarde, en sus tareas programadas (cron). El driver las hace con `backupCourse`, `restoreCourse`, `copyCourse` e `importActivities`, esperando a Moodle hasta un tiempo límite. Una copia de seguridad anónima (`anonymizeBackup`, por defecto para parte de un curso) no nombra a nadie ni ningún sitio: sin ids de usuario ni autores, con un sitio y un curso de origen neutros. Consulta [Copia, copia de seguridad y restauración](../areas/copy-backup-restore.md).

### Insignia (badge) {#badge}

Un reconocimiento de un curso (o del sitio) que gana una persona, que se muestra con su imagen en su perfil: Moodle la emite cuando se cumplen sus criterios (finalizar actividades o el curso, que un profesor la otorgue a mano…), una vez habilitada. Mientras está habilitada sus criterios no pueden cambiar, y en cuanto alguien la tiene Moodle la bloquea. El driver trabaja con las insignias de curso: `courseBadges` las lee (`CourseBadge`), `createBadge` crea una, `setBadgeCriteria` fija qué la gana, `setBadgeEnabled` la habilita o deshabilita y `awardBadge` la otorga a mano. Consulta [Insignias](../areas/badges.md).

### BigBlueButton {#bigbluebutton}

Un sistema de videoconferencia web de código abierto; en un curso es una actividad BigBlueButton, módulo `bigbluebuttonbn`, una sala de reuniones con un horario opcional, donde las personas entran como moderadores u oyentes y cuyas sesiones pueden grabarse. Moodle habla con el servidor BigBlueButton del sitio (su URL y su secreto compartido, que fija un administrador) para la reunión y sus grabaciones, que quienes gestionan las grabaciones publican (los estudiantes solo ven las publicadas), protegen o eliminan. El driver la lee con `bigBlueButton` (`BigBlueButtonActivity`, con `status`, `canJoin` y `recordings`), da la URL de la persona para entrar con `bigBlueButtonJoinUrl`, y cambia las grabaciones con `setRecordingPublished` y `deleteRecording`; nunca entra en una reunión. Consulta [BigBlueButton](../areas/bigbluebutton.md).

### Bloque (block) {#block}

Una caja en una región de una página junto a su contenido (en la página de un curso, el cajón de bloques de Boost, región `side-pre`): un bloque de texto (tipo `html`) con la bienvenida o los enlaces de un profesor, eventos próximos, actividad reciente… Cada uno es una instancia con un id, una región y un peso que lo ordena en ella; los profesores los añaden, configuran, mueven, ocultan y eliminan en modo edición. El driver lee los de un curso con `courseBlocks` (`CourseBlock`) y los cambia con `addBlock`, `configureBlock`, `moveBlock` y `deleteBlock`. Consulta [Bloques](../areas/blocks.md).

### Evento del calendario (calendar event) {#calendar-event}

Una entrada del calendario de Moodle: un evento de curso, de grupo, de usuario o del sitio, o uno que crea una actividad para sus fechas (la fecha de entrega de una tarea, el cierre de un cuestionario). El driver los lee como `CalendarEvent` (`id`, `type`, `start`, `courseId` y, para el evento de una actividad, `activity: { type, instance }`, con el [id de instancia](#instance-id)) con `upcomingEvents` (uno solo con `calendarEvent`), crea eventos de curso con `createEvent`, cambia uno con `updateEvent` y elimina uno con `deleteEvent`; `deadlines` lee del mismo calendario lo que la persona tiene que hacer antes de una fecha. Consulta [Calendario](../areas/calendar.md) y [Vista general y fechas límite](../areas/overview-and-deadlines.md).

### Consulta (choice) {#choice}

La actividad en la que los participantes eligen una o varias opciones que ofrece un profesor (módulo `choice`, "Consulta" en la interfaz), a menudo para una votación rápida o una inscripción con plazas limitadas. El driver la lee con `getChoice` (`Choice`, con `options[].id`, `selected`, `full`, `multiple`, `canAnswer`, `canChange`) y responde con `answerChoice`, que recibe ids de opciones; sus errores son `ChoiceError`. Consulta [Encuestas y consultas](../areas/surveys-and-choices.md).

### Competencia (competency) {#competency}

Una habilidad o conocimiento en el que se valora a un participante, de un marco de competencias (un árbol de ellas con una escala, que crea un administrador para el sitio o una categoría). Un profesor añade a un curso competencias de un marco y las vincula a sus actividades; a los participantes se les valora en cada una, a mano o mediante una regla al finalizar una actividad vinculada, y cada valoración se guarda como evidencia. El driver lee los marcos con `competencyFrameworks` y las competencias de un curso con `courseCompetencies` (`CourseCompetency`, con su `framework` y sus `activities` vinculadas), las añade y quita con `addCourseCompetency` y `removeCourseCompetency`, las vincula con `setActivityCompetencies`, y lee y da la valoración de un participante con `competencyRating` y `rateCompetency`. Consulta [Competencias](../areas/competencies.md).

### Finalización (completion) {#completion}

La finalización de actividades de Moodle: si cada participante ha hecho cada actividad, marcada a mano (manual) o por Moodle cuando se cumple una condición (automática), en uno de cuatro estados que el driver llama `incomplete`, `complete`, `complete-pass` y `complete-fail` (`COMPLETION_STATES`, `CompletionState`). La de la propia persona viene con `courseStructure` (la `completion` de cada actividad), `setCompletion` la marca, `overrideCompletion` fija la de otra persona como profesor, y `completionReport` lee el informe de progreso ("Finalización de actividad" en la interfaz), cada celda con `state`, `tracking` y `overridden`. Las reglas de una actividad son su `completion` en `createActivity`, `updateActivity` y `activitySettings`. No es la [finalización del curso](#course-completion), que trata del curso entero. Consulta [Finalización](../areas/completion.md).

### Banco de contenido (content bank) {#content-bank}

El almacén de contenido H5P de un curso (o de una categoría, o del sitio), aparte de sus actividades para que los profesores lo reutilicen; cada contenido tiene un id propio (`contentbank/view.php?id=4`), un nombre y un archivo. El driver trabaja el de un curso con `contentBank` (`BankContent`, con `id`, `name`, `fileUrl` y `uses`), `uploadToContentBank`, `renameContent`, `downloadContent` y `deleteContent`. Las copias de seguridad lo dejan fuera. Consulta [H5P](../areas/h5p.md#the-content-bank).

### Conversación (conversation) {#conversation}

Un hilo de mensajes privados de la mensajería de Moodle: entre dos personas (`private`), de un grupo del curso (`group`), o las notas de la persona para sí misma (`self`). El driver lista las de la persona con `conversations` (`ConversationSummary`, con `id`, `type`, `members` y `unread`), lee una con `conversation(conversationId)` y envía un mensaje privado con `sendMessage`, que devuelve `messageId` y `conversationId`. Consulta [Mensajes](../areas/messages.md).

### Finalización del curso (course completion) {#course-completion}

Si un participante ha completado un curso entero, según las condiciones que fijan sus ajustes de "Finalización del curso" (actividades completadas, otros cursos, una fecha, días matriculado, la baja, una calificación del curso, la autofinalización, la marca de un rol), todas o una cualquiera. Moodle bloquea las condiciones en cuanto alguien cumple una. El driver las lee y las fija con `courseCompletionCriteria` y `setCourseCompletionCriteria` (`CourseCompletionCriteria`, con `locked` y `unlock`), lee la de cada participante del informe de finalización del curso con `courseCompletionStatus` (`CourseCompletionStatus`, con `complete` y el `met` de cada condición), y marca a alguien como completado con `markCourseComplete`. Algunas condiciones solo las revisa la tarea programada de finalización de Moodle. No es la [finalización de actividades](#completion) (el informe de progreso). Consulta [Finalización](../areas/completion.md#course-completion).

### Id del módulo del curso (course module id) {#course-module-id}

El id de una actividad en su curso, el `id` de la URL de la actividad (`mod/quiz/view.php?id=27`), escrito a menudo "cmid" en el código de Moodle; el driver lo llama id de la actividad. Todas las funciones de actividades lo reciben como un parámetro llamado `activityId`, sea cual sea el módulo, y los resultados lo dan como `id` para la propia actividad (`CourseActivity.id`) y como `activityId` donde hacen referencia a una (`GradeRow.activityId`, `CompletionCell.activityId`); nunca es el [id de instancia](#instance-id). Consulta [el objeto Moodle y las funciones](../concepts/calling-functions.md#ids).
`moodle.quizInfo(27)`

### Base de datos (database) {#database}

Una actividad, módulo `data`, en la que los participantes añaden entradas con los campos que define un profesor (texto corto, lista desplegable, fecha, imagen…), listadas, mostradas y buscadas mediante sus plantillas; un preajuste le da campos y plantillas a la vez. El driver lee y escribe sus campos con `databaseFields`, `addDatabaseField`, `editDatabaseField` y `deleteDatabaseField`, sus plantillas con `databaseTemplates` y `setDatabaseTemplate`, y le da uno de los preajustes del sitio con `databasePresets` y `applyDatabasePreset`; sus entradas se leen con `databaseEntries`, se escriben con `addDatabaseEntry`, `editDatabaseEntry` y `deleteDatabaseEntry`, se aprueban con `setDatabaseEntryApproved`, se mueven como CSV con `exportDatabaseEntries` e `importDatabaseEntries`, y se valoran con `rate`. Consulta [Bases de datos](../areas/databases.md).

### Ampliación del plazo (extension) {#extension}

Más tiempo para que un participante haga la entrega de una tarea, más allá de su fecha de entrega y de su fecha límite: "Conceder ampliación del plazo" en la tabla de calificación. El driver la concede a uno o varios participantes con `grantExtension(activityId, userIds, until)`, y `assignmentSubmissions` la indica por participante como `extensionGranted` y `extensionDueDate`. En un cuestionario, lo equivalente es una [excepción](#override). Consulta [Calificación](../areas/grading.md).

### Herramienta externa (external tool) {#external-tool}

Una aplicación fuera de Moodle que un curso abre mediante LTI (Learning Tools Interoperability): Moodle envía a la persona a ella con un lanzamiento firmado, y la herramienta puede devolver calificaciones. Una herramienta se configura una vez, por un administrador para todo el sitio o por un profesor para un curso, con su URL y la clave y el secreto que da su proveedor; después se crea a partir de ella una actividad, módulo `lti`. El driver lista las herramientas de un curso con `externalTools` (`ExternalTool`, cuyo id es el id del tipo de herramienta de Moodle), añade una con `addExternalTool`, la muestra u oculta en el selector de actividades con `setExternalToolInChooser`, borra una del propio curso con `deleteExternalTool`, crea una actividad a partir de una con `createActivity` (`toolId`), y da a la persona la URL de lanzamiento de una actividad con `externalToolLaunchUrl`. Consulta [Herramientas externas](../areas/external-tools.md).

### Retroalimentación (feedback) {#feedback}

Consulta [encuesta](#survey): el módulo `feedback` de Moodle es una actividad de encuesta, no los comentarios de retroalimentación que escribe un profesor al calificar (esos son la entrada `feedback` de `gradeSubmission`, consulta [método de calificación](#grading-method)). Los archivos que un profesor adjunta a esa retroalimentación (un PDF corregido, un comentario de audio) son los archivos de retroalimentación de una tarea: `feedbackFiles` de `gradeSubmission`, que el estudiante lee en `studentAssignment` y el profesor en `assignmentSubmissions` ([Calificación](../areas/grading.md)).

### Glosario (glossary) {#glossary-activity}

Una actividad, módulo `glossary`, en la que los participantes (o solo los profesores) añaden entradas: un concepto, su definición, otras palabras por las que se encuentra (alias) y, si se quiere, categorías y archivos adjuntos; un glosario puede hacer que las entradas de los estudiantes esperen la aprobación de un profesor. El driver lee sus entradas con `glossaryEntries`, las escribe con `addGlossaryEntry`, `editGlossaryEntry` y `deleteGlossaryEntry`, las aprueba con `setGlossaryEntryApproved`, trabaja sus categorías con `glossaryCategories` y `addGlossaryCategory`, y lleva entradas en el XML de Moodle con `exportGlossaryEntries` e `importGlossaryEntries`; `rate` valora sus entradas. Consulta [Glosarios](../areas/glossaries.md).

### Categoría de calificación (grade category) {#grade-category}

Un grupo de elementos de calificación del libro de calificaciones que combina las calificaciones de sus hijos en un total, con un método de agregación (natural, media, la más alta…); el propio curso es la categoría superior. El driver las lee con `gradebookSetup` (`GradebookCategory`, con `id`, `itemId` para el elemento de calificación de su total, `parentId`, `aggregation`, `weight`), crea una con `addGradeCategory` (`aggregation`, uno de `GRADE_AGGREGATIONS`), cambia o elimina una con `updateGradeCategory` y `deleteGradeCategory`, y mueve elementos a una con `updateGradeItem`; las filas de `myGrades` de `kind` `"category"` y `"categoryTotal"` las muestran. Consulta [Calificaciones y libro de calificaciones](../areas/grades-and-gradebook.md).

### Elemento de calificación (grade item) {#grade-item}

Una columna del libro de calificaciones: la calificación de una actividad, un elemento manual, o el total de una categoría o del curso. El driver los lee con `gradebookSetup` (`GradebookItem`, con `id`, `categoryId`, `maxGrade`, `weight`, `weightOverridden`), cambia uno con `updateGradeItem(courseId, itemId, changes)`, añade y elimina los manuales con `addGradeItem` y `deleteGradeItem`, califica a una persona en uno con `setGrade` (la calificación de una actividad queda anulada), y `graderReport` da una `GradeColumn` por elemento y cada calificación como `{ itemId, grade }`. Consulta [Calificaciones y libro de calificaciones](../areas/grades-and-gradebook.md).

### Letra de calificación (grade letter) {#grade-letter}

Una letra (o palabra) con la que se muestra una calificación, a partir de un porcentaje: "A" desde el 93 %, "B" desde el 83 %… El sitio fija las predeterminadas y un curso puede anularlas. El driver lee las de un curso con `gradeLetters` (`{ overridden, letters }`, cada letra con su `minGrade` en porcentaje) y las fija, o vuelve a las del sitio, con `setGradeLetters`. Consulta [Calificaciones y libro de calificaciones](../areas/grades-and-gradebook.md#gradeletters).

### Libro de calificaciones (gradebook) {#gradebook}

Las calificaciones de un curso y cómo se construyen: sus [elementos de calificación](#grade-item) y sus [categorías de calificación](#grade-category), mostrados como informes ("Calificaciones" en la interfaz: el informe del usuario que ve un participante, el informe del calificador que ve un profesor, y la "Configuración del libro de calificaciones"). El driver lee el informe del usuario con `myGrades` (`GradeRow`), el de todos con `graderReport`, la configuración con `gradebookSetup`, califica en él con `setGrade`, y lo cambia con `addGradeItem`, `updateGradeItem`, `deleteGradeItem`, `addGradeCategory`, `updateGradeCategory` y `deleteGradeCategory`; los errores son `NoGradeReportError` y `GradebookError`. Consulta [Calificaciones y libro de calificaciones](../areas/grades-and-gradebook.md).

### Método de calificación (grading method) {#grading-method}

Cómo se califica una tarea: calificación simple directa (un número o una [escala](#scale)), o uno de los métodos avanzados, una rúbrica (criterios, cada uno con niveles que valen una puntuación) o una guía de evaluación (criterios, cada uno puntuado hasta un máximo, con observaciones). El código de Moodle llama `guide` a la guía de evaluación. El driver lee el método y sus criterios con `rubric`, cuyo `method` es `"simple"`, `"rubric"` o `"guide"` y cuyos `criteria` son `GradingCriterion` (`id`, `levels`, `maxScore`); `gradeSubmission` recibe `grade`, `rubric` (id de criterio a id de nivel) o `guide` (id de criterio a puntuación), con `remarks` y `feedback`. Consulta [Calificación](../areas/grading.md).
`moodle.gradeSubmission(45, 7, { guide: { 12: 8 }, remarks: { 12: "Claro." } })`

### Grupo (group) {#group}

Un conjunto de participantes dentro de un curso, usado para separarlos o filtrarlos (los debates propios de un grupo en un foro, un informe del calificador por grupo). El driver los lista con `groups` (`CourseGroup`, con `id`, `name`, `members`), da los `groups` de cada participante con `participants`, y recibe un id de grupo como opción `group` de `participants`, `graderReport` y `completionReport`. Consulta [Participantes](../areas/participants.md). Una tarea con entregas en grupo recibe una entrega por grupo: `assignmentSubmissions` da el `group` de cada participante, `applyToGroup` de `gradeSubmission` califica a todo el grupo, y `studentAssignment` da el `group` del estudiante ([Calificación](../areas/grading.md)).

### H5P

Contenido interactivo (cuestionarios, presentaciones, vídeos interactivos…) construido con bibliotecas H5P; en un curso es una actividad H5P, módulo `h5pactivity`, que puede registrar intentos y puntuaciones. El driver la lee con `h5pActivity` (`H5PActivity`, con `contentType`, `tracked` y los `attempts` de la persona); reproducir el contenido queda a cargo del programa, en la [pestaña de trabajo](#working-tab). Consulta [H5P](../areas/h5p.md).

### Id de instancia (instance id) {#instance-id}

El id de una actividad en la tabla propia de su módulo (el id del cuestionario entre los cuestionarios, el del foro entre los foros), que piden algunos servicios y páginas de Moodle; el [id del módulo del curso](#course-module-id) es otro número. El driver nunca lo pide: recibe el id del módulo del curso y encuentra la instancia por sí mismo. Aparece en unos pocos resultados, con un nombre que dice lo que es: el `activity.instance` de un evento del calendario y el `forumInstanceId` de un debate de un foro. Consulta [Calendario](../areas/calendar.md) y [Foros](../areas/forums.md).

### Página de lección (lesson page) {#lesson-page}

Una página de una actividad de lección (módulo `lesson`): una página de contenido con botones que saltan a otro sitio, o una página de pregunta con un formulario, tras la cual Moodle puede mostrar retroalimentación; Moodle guarda en qué página está la persona. El driver lee la actual con `lessonPage` (`LessonPage`, con `kind` `"content"`, `"question"`, `"feedback"` o `"end"`, `pageId`, `buttons[].jumpTo`, `fields`) y la responde con `answerLessonPage`, que devuelve la `page` siguiente. Su profesor construye las páginas con `addLessonPage`, `editLessonPage`, `moveLessonPage` y `deleteLessonPage`, y las lee con `lessonPages` (`LessonPageDefinition`: un `type` de `LESSON_PAGE_TYPES`, sus `buttons` o `answers`, cada uno con un `jumpTo`: un id de página o uno de los saltos de Moodle por nombre, `LESSON_JUMPS`). Consulta [Lecciones](../areas/lessons.md).

### Registro (log) {#log}

El registro que hace Moodle de cada evento de un curso: quién hizo qué, cuándo, dónde y sobre quién ("Módulo de curso visto", "Entrega calificada"), guardado por su almacén de registros y leído por los profesores en los informes de registros, de actividad y de participación. El driver los lee con `courseLogs` (`LogEntry`, con `time`, `userId`, `relatedUserId`, `activityId`, `event`, `description`), las visitas por actividad con `activityReport`, y quién participó en una actividad con `participationReport`. Actuar al ritmo de una persona (el [rastro](#trail)) hace que el registro parezca el de una persona. Consulta [Registros e informes](../areas/logs-and-reports.md).

### Flujo de trabajo de calificación (marking workflow) {#marking-workflow}

Un ajuste de las tareas ("Usar flujo de trabajo de calificación") con el que una calificación pasa por varios estados antes de que la vean los estudiantes: sin calificar, en calificación, calificación completada, en revisión, lista para publicar, publicada; se pueden asignar evaluadores a las entregas ("Usar asignación de evaluadores"). El driver nombra los estados como lo hace el código de Moodle (`WorkflowState`: `"notmarked"`, `"inmarking"`, `"readyforreview"`, `"inreview"`, `"readyforrelease"`, `"released"`), da el `workflowState` y los `markers` de cada entrega en `assignmentSubmissions`, fija uno con `workflowState` de `gradeSubmission`, varios con `setWorkflowState` (que publica), y asigna evaluadores con `allocateMarker`. Consulta [Calificación](../areas/grading.md).

### Módulo (module) {#module}

El tipo de una actividad, por el nombre de su plugin en el código y las URL de Moodle: `assign` (Tarea), `quiz`, `forum`, `page`, `resource` (Archivo), `url`, `h5pactivity`, `qbank` (un banco de preguntas compartido)… El driver lo da como el `type` de la actividad (`CourseActivity.type`, `activityType` en las filas de calificaciones, `activity.type` en los eventos del calendario) y lo recibe como el `type` de `createActivity`; `courseActivityTypes` lista los que la persona puede añadir, y `moduleCategories` dice qué toca leer uno. Consulta [Cursos](../areas/courses.md) y [Actividades y secciones](../areas/activities.md).

### Notificación (notification) {#notification}

Un mensaje que Moodle envía a la persona por su cuenta (un mensaje nuevo en un foro, una entrega calificada, una fecha de entrega), mostrado bajo la campana en la interfaz, aparte de las [conversaciones](#conversation). El driver las lee con `notifications` (`Notification`, con `id`, `subject`, `text`, `fromUserId`, `read`, `url`, `component`, `eventType`), opcionalmente `unreadOnly`, y las marca todas como leídas con `markNotificationsRead`. Consulta [Mensajes](../areas/messages.md).

### Excepción (override) {#override}

Una configuración distinta de un cuestionario para una persona: otras fechas de apertura y cierre, un límite de tiempo o un número de intentos ("Excepciones de usuario" en la configuración del cuestionario). El driver fija una con `setQuizOverride(activityId, userId, { open, close, timeLimitMinutes, attempts })`. La finalización de Moodle también se puede anular, una decisión del profesor registrada como tal: `overrideCompletion`, y `overridden` en el informe de [finalización](#completion). Consulta [Cuestionarios](../areas/quizzes.md).

### Participante (participant) {#participant}

Alguien matriculado en un curso, con uno o más roles (estudiante, profesor…) y posiblemente grupos. El driver los lista con `participants` (`Participant`, con `userId`, `fullName`, `roles`, `groups`), filtrados por rol, grupo o inactividad, y `participantFilters` da los roles y grupos del curso por los que filtrar; los listados de personas de todo el driver las dan por `userId` y `fullName`. Consulta [Participantes](../areas/participants.md).

### Banco de preguntas (question bank) {#question-bank}

Donde un curso guarda sus preguntas para los cuestionarios. Desde Moodle 5 un banco compartido es una actividad propia (módulo `qbank`), y cada cuestionario tiene un banco privado. El driver lista los de un curso con `questionBanks` (`QuestionBank`, cuyo `id` es el id del módulo del curso del banco, con `type` y `shared`), lee uno con `questions`, le añade preguntas con `importQuestions` (GIFT o Moodle XML) y `createQuestion`, y lo cambia con `updateQuestion` (una versión nueva), `setQuestionStatus` y `deleteQuestions` (una pregunta en uso se oculta en su lugar); `addQuestionsToQuiz` pone sus preguntas en un cuestionario. Consulta [Bancos de preguntas](../areas/question-banks.md).

### Categoría de preguntas (question category) {#question-category}

Una carpeta de preguntas dentro de un [banco de preguntas](#question-bank); cada banco tiene una categoría "Superior" que no contiene preguntas y, debajo, una predeterminada. El driver da las categorías de un banco con `questions` (`BankCategory`, con `id` y `name`) y el `categoryId` de cada pregunta; `importQuestions` y `createQuestion` reciben un `categoryId`, y `addQuestionsToQuiz` saca preguntas aleatorias de una con `random: { categoryId, count }`. Consulta [Bancos de preguntas](../areas/question-banks.md).

### Cuestionario (quiz) {#quiz}

La actividad de preguntas que un participante responde en [intentos](#attempt), calificada automáticamente donde se puede (módulo `quiz`). El driver cubre la parte del estudiante (`quizInfo`, `startQuizAttempt`, `readAttempt`, `answerQuizQuestions`, `finishQuizAttempt`, `readReview`) y la del profesor (`quizResults`, `questionsToGrade`, `gradeQuizQuestion`, `quizStructure`, `addQuestionsToQuiz`, `editQuizSlot`, `removeQuizSlot`, `setQuizPages`, `addQuizSection`, `setQuizOverride`); sus errores son `QuizError`. Consulta [Cuestionarios](../areas/quizzes.md).

### Valoración (rating) {#rating}

El juicio de un participante sobre el mensaje de un foro, la entrada de un glosario o el registro de una base de datos de otro, en una escala o sobre unos puntos, cuando la actividad usa valoraciones; la actividad las agrega (media, recuento, máximo…) en un elemento de calificación propio. Aparte, un foro se puede calificar en su conjunto ("Calificación del foro completo"), una calificación por persona. El driver valora con `rate(item, rating)`, y lee y pone las calificaciones del foro completo con `forumGrades` y `gradeForumUser`. Consulta [Calificación](../areas/grading.md#rate).

### Revisión (review) {#review}

La página de un [intento](#attempt) terminado que muestra su resumen y sus preguntas con su estado, puntos, retroalimentación y respuesta correcta, hasta donde lo permiten las opciones de revisión del cuestionario ("Revisión" en la interfaz). El driver la lee con `readReview(attemptId)` (`summary` y `questions`, con el `comment` del profesor en una pregunta calificada a mano), y `finishQuizAttempt` la devuelve como `review` cuando el cuestionario la muestra enseguida. Consulta [Cuestionarios](../areas/quizzes.md).

### Rol (role) {#role}

Lo que una persona puede hacer en un contexto, un curso en la mayoría de los casos: estudiante, profesor (`editingteacher` de Moodle), profesor sin permiso de edición, gestor. Los roles tienen ids que varían según el sitio (5 es Estudiante en uno predeterminado). El driver da los `roles` de un participante como `{ id, name }` en `participants`, los de un usuario en un curso con `courseRoles`, los de la persona con `whoAmI(courseId)` (`course.roles`), y los del curso por los que filtrar con `participantFilters`; `courseAbilities` responde qué puede hacer la persona (`canEdit`, `canGrade`). Consulta [Participantes](../areas/participants.md) y [Usuarios y el sitio](../areas/users-and-site.md).

### Escala (scale) {#scale}

Una lista de palabras usadas como calificaciones en lugar de números ("Todavía no, Competente, Excelente"), elegida como tipo de calificación de una actividad. En el driver, una tarea calificada con una escala tiene `method: "simple"` en `rubric`, y el `grade` de `gradeSubmission` recibe el valor del elemento de la escala. Consulta [Calificación](../areas/grading.md). Un curso usa sus propias escalas y las estándar del sitio: `courseScales` las enumera (`GradeScale`, con `items`, `used`, `site`), `addScale` y `editScale` escriben las del curso; una escala en uso conserva sus valores ([Calificaciones y libro de calificaciones](../areas/grades-and-gradebook.md#coursescales)).

### SCORM

Un estándar para paquetes de e-learning: un `.zip` de HTML y JavaScript con un `imsmanifest.xml`, cuyas partes (SCO) informan a Moodle mediante la API de SCORM (estado, puntuación) mientras la persona las hace en el reproductor de Moodle; en un curso es una actividad SCORM, módulo `scorm`, con intentos y una calificación. El driver la lee con `scorm` (`ScormActivity`, con los intentos, `grade` y los `scos` con su `status`), abre el reproductor en la [pestaña de trabajo](#working-tab) con `openScorm`, y crea una con `createActivity({ type: "scorm", files: [package] })`; nunca informa de resultados en nombre de la persona. Consulta [SCORM](../areas/scorm.md).

### Sección (section) {#section}

Una parte de la página de un curso que contiene actividades: un tema o una semana según el formato del curso, siendo la sección 0 la general, arriba del todo; una subsección es una sección dentro de otra. Una sección tiene un id (un id de la base de datos) y un número (su posición), y el driver siempre recibe el id: `CourseSection` en `courseStructure` tiene `id`, `number`, `title`, `parentSectionId` y `activities`; `createActivity` recibe `sectionId`, y `addSection`, `editSection` y `deleteSection` trabajan con ellas. Consulta [Cursos](../areas/courses.md) y [Actividades y secciones](../areas/activities.md).

### Sesskey

El token que Moodle da a cada sesión (`M.cfg.sesskey` en sus páginas) y que espera con cada acción que cambia algo y con cada llamada AJAX, para distinguir las peticiones de la propia persona de las falsificadas. Un programa nunca la maneja: el driver la lee una vez de una página con la sesión iniciada y la envía con cada llamada a un servicio, y una respuesta `invalidsesskey` hace que la vuelva a leer. Consulta [Cómo funciona](../concepts/how-it-works.md).

### Posición (slot) {#slot}

El lugar de una pregunta en un cuestionario, numerado desde 1 en el orden del cuestionario; la interfaz muestra en su lugar números de pregunta, que se saltan las descripciones. En un intento, las respuestas se dan por posición: `Question.slot` en `startQuizAttempt`, `readAttempt` y `readReview`, y `answerQuizQuestions` recibe `{ slot, responses }[]`, con nombres de campo como `q9:1_answer` (`q<usage>:<slot>_<name>`); `quizStructure` lista las posiciones de un cuestionario como `QuizSlot` (`id`, `slot`, `page`, `questionId`, `type`, `mark`) y sus secciones (un encabezado antes de un grupo de páginas, cuyas preguntas pueden barajarse), `editQuizSlot` y `removeQuizSlot` reciben una posición, y `quizResults` da los puntos de cada intento por posición. Consulta [Cuestionarios](../areas/quizzes.md).
`moodle.answerQuizQuestions(9, [{ slot: 1, responses: { "q9:1_answer": "1" } }])`

### Entrega (submission) {#submission}

El trabajo de un participante para una tarea: texto en línea, archivos o ambos, en uno de los estados de Moodle, `new` (nada todavía), `draft` (guardada, no enviada), `submitted` (para calificar) o `reopened` (un profesor la reabrió para otro intento). El estudiante la guarda con `saveSubmission` y la envía con `submitForGrading`, y `studentAssignment` da su `submissionState`; el profesor lee las de todos con `assignmentSubmissions` (`Submission`, con `userId`, `status`, que es `"none"` si no hay ninguna, `needsGrading` y `content`). Sus errores son `SubmissionError`. Consulta [Tareas](../areas/assignments.md) y [Calificación](../areas/grading.md).

### Encuesta (survey) {#survey}

Una actividad que hace preguntas a los participantes sin calificarlos. El driver responde dos módulos: el propio `feedback` de Moodle ("Retroalimentación" en la interfaz) y el plugin `questionnaire`; el módulo `survey`, más antiguo, de Moodle, con instrumentos fijos, no está cubierto. Lee una con `getSurvey` (`SurveyQuestion`, con `page`, `required` y `fields`) y responde con `submitSurvey`, ambas recibiendo el módulo como un `SurveyType`; sus errores son `SurveyError`. Consulta [Encuestas y consultas](../areas/surveys-and-choices.md).

### Taller (workshop) {#workshop}

Una actividad de evaluación entre pares, módulo `workshop`, que pasa por cinco fases que cambia un profesor: configuración, envío (los participantes entregan su trabajo), evaluación (los revisores evalúan las entregas que tienen asignadas mediante el formulario de evaluación del taller, cuya estrategia de calificación es calificación acumulativa, comentarios, número de errores o una rúbrica), evaluación de calificaciones (Moodle calcula una calificación para cada entrega y otra para la evaluación de cada revisor) y cerrado. El driver lee la fase y el informe de entregas y evaluaciones con `workshopInfo`, cambia de fase con `setWorkshopPhase`, lee y fija quién evalúa a quién (la asignación) con `workshopAllocation`, `allocateReviewer`, `removeReviewer`, `allocateRandomly` y `scheduleAllocation`, evalúa una entrega con `assessWorkshopSubmission`, lee y guarda la entrega de un participante con `workshopSubmission` y `saveWorkshopSubmission`, prepara envíos de ejemplo (con los que los participantes practican la evaluación frente a la evaluación de referencia del profesor) con `workshopExamples`, `addWorkshopExample`, `editWorkshopExample`, `deleteWorkshopExample` y `assessWorkshopExample`, y calcula y anula las calificaciones con `calculateWorkshopGrades` y `overrideWorkshopGrade`; sus errores son `WorkshopError`. Consulta [Calificación](../areas/grading.md#workshopinfo).

## Términos del driver {#driver-terms}

### Navegador en segundo plano (background browser) {#background-browser}

Un navegador que `moodle open` deja abierto en un [perfil](#profile), en el que trabajan todos los comandos de ese perfil (y `moodle shell`, y un programa mediante `backgroundBrowser` y `connectBrowserManager`) en lugar de lanzar el suyo, uno cada vez, hasta `moodle close`. Se accede a él en 127.0.0.1 con un token del `.browser.json` del perfil. Consulta [La línea de comandos](../getting-started/command-line.md#watching-separate-commands-act) y [El navegador](../concepts/browser.md#a-browser-left-open-in-the-background).

### Cambio (changed) {#changed}

La frase corta que toda escritura devuelve como `changed`, diciendo lo que ha hecho (`Created page 42 "Loops" in section 2.`), junto al estado posterior cuando es barato de leer (las `sections` del curso, la `assignment`, la `choice`) y los ids de lo que ha creado (`activityId`, `attemptId`, `messageId`). Un programa puede mostrarla tal cual o comprobar el estado en lugar de volver a leer. Consulta [el objeto Moodle y las funciones](../concepts/calling-functions.md#writes-answer-with-the-state-afterwards).
`const { changed, activityId } = await moodle.createActivity(…)`

### Categoría de datos (data category) {#data-category}

El tipo de datos que lee o escribe una función, declarado para cada función pública para que un programa pueda permitir algunos tipos y rechazar el resto: `none`, `own`, `course-content`, `others-aggregate`, `others-personal`, `others-write`, `communication` o `any` (`DataCategory`, `ALL_DATA_CATEGORIES`). `DATA_CATEGORIES` da las de cada función, y `moduleCategories(module)` lo que toca leer una actividad de un módulo. Consulta [Categorías de datos](../concepts/data-categories.md).
`DATA_CATEGORIES.gradeSubmission // ["others-personal", "others-write"]`

### Código de error (error code) {#error-code}

El `code` estable que lleva todo error que el driver lanza a propósito: `MoodleError` es la clase base, cada subclase tiene su propio código (su nombre en kebab-case sin `Error`, `not-logged-in` para `NotLoggedInError`), y los errores sin clase propia usan uno genérico (`invalid-input`, `not-found`, `not-available`…), todos listados por el tipo `MoodleErrorCode`. Compara los errores por clase, `name` o `code`, nunca por mensaje. Consulta [Errores](../concepts/errors.md).
`error instanceof MoodleError && error.code === "not-found"`

### Internals

El punto de entrada `@falkenslab/moodle-driver/internals`, con las primitivas con las que se construyen las operaciones: `callService`, `openSitePage`, `openForm`, `setFields`, `submitForm`, `inPage`, `courseState`, `editCourse` y otras. Siguen el mismo versionado que la entrada principal pero están más cerca de Moodle, y reciben páginas, nombres de formularios y nombres de servicios. Consulta [Bajar de nivel](../concepts/low-level.md).

### Perfil (profile) {#profile}

La carpeta persistente de datos de usuario del navegador (`profileDir`), donde guarda las cookies y el almacenamiento de la persona, para que la sesión sobreviva entre ejecuciones; el driver también escribe ahí las cookies de sesión de Moodle (`SESSION_COOKIES_FILE`). Uno por persona y sitio, usado por un solo navegador cada vez, y tan sensible como una contraseña. El comando `moodle` guarda uno por sitio y cuenta en `~/.moodle-driver/sites/<host>/`, y `siteProfileDir(site, { as })` da la misma carpeta a un programa. Consulta [Iniciar sesión](../getting-started/logging-in.md), [El navegador](../concepts/browser.md) y [La línea de comandos](../getting-started/command-line.md#where-things-are).

### Sesión (session) {#session}

La sesión de Moodle iniciada de la persona, creada cuando inicia sesión a mano en la ventana que abre `logIn` (`LoginResult`, con `status`, `userId`, `fullName`) y guardada en el [perfil](#profile); `logOut` la cierra. Todas las funciones trabajan con ella, y una que no encuentra ninguna, o la encuentra caducada, lanza `NotLoggedInError`: vuelve a iniciar sesión y reintenta. Consulta [Iniciar sesión](../getting-started/logging-in.md).

### Mostrado bajo demanda (shown on demand) {#shown-on-demand}

El navegador funciona sin ventana y solo muestra una cuando se le pide: `setVisible(true)` lo relanza con ventana (conservando la sesión) y, desde ese momento, las páginas que abren las funciones se suceden en su [pestaña de trabajo](#working-tab), para que una persona pueda mirar o intervenir; `setVisible(false)` lo oculta, `visible()` lo dice, y `canShowWindow()` indica si hay pantalla siquiera (si no, `NoDisplayError`). Consulta [El navegador](../concepts/browser.md#showing-the-browser).

### Sitio (site) {#site}

La instalación de Moodle con la que trabaja el driver, dada por su URL base (la opción `site` de `createMoodle`, `siteUrl` en las funciones), normalizada por `parseSiteUrl` para que acabe en `/`; `findMoodleSite` la encuentra a partir de cualquiera de sus páginas, y `publicSiteInfo` lee lo que cuenta a cualquiera antes de iniciar sesión. Uno no válido lanza `MoodleUrlError`. Consulta [Usuarios y el sitio](../areas/users-and-site.md).

### Rastro (trail) {#trail}

Cómo ven y hacen las cosas las funciones que actúan como estudiante, elegido con la opción `trail` (`Trail`, `TRAILS`): `"realistic"`, el predeterminado, recorre las páginas reales al ritmo de lectura de una persona, para que los registros y la finalización de Moodle se vean como se verían para una persona; `"fast"` no espera y toma el camino más rápido. `activityContent`, `answerQuizQuestions` y `answerLessonPage` lo reciben, con un callback `onProgress` mientras esperan, y `createMoodle({ trail })` lo fija para todas las llamadas. Consulta [Trabajar al ritmo de un estudiante](../concepts/student-pace.md).
`moodle.activityContent(6, "book", { trail: "fast" })`

### Pestaña de trabajo (working tab) {#working-tab}

La única pestaña del navegador que un programa puede manejar por sí mismo, una `Page` de Playwright con la sesión iniciada que da `moodle.tab()` (o `BrowserManager.tab()`), para lo que no cubre ninguna función, como reproducir contenido H5P. Es la misma pestaña en la que el navegador sigue las páginas mientras se [muestra](#shown-on-demand), así que la persona ve lo que ocurre en ella; déjala abierta, el driver la reutiliza. Consulta [El navegador](../concepts/browser.md#the-working-tab).
