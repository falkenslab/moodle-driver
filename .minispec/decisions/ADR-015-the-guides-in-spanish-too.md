# ADR-015: The guides in Spanish too

## Decision

The documentation site is in English and Spanish. English stays the source (ADR-008): every guide is written in `docs/content/` first, and its Spanish translation lives in `docs/i18n/es/docusaurus-plugin-content-docs/current/` under the same path, published under `/es/`. The API reference and the command reference are generated from the code's English doc comments and are not translated: the Spanish site shows the API reference in English, and `npm run cli:generate` writes the command reference's Spanish copy with a Spanish introduction and the commands in English (Docusaurus resolves links between Spanish pages and a page only when it exists under the Spanish folder).

## Motivation

Many of the driver's users are teachers and developers in Spanish-speaking schools and universities, where Moodle itself runs in Spanish. A guide in their language lowers the barrier more than anything else in the docs. Translating the generated references would mean doc comments in two languages in the code, against ADR-008, for pages a developer reads next to the code anyway.

## Consequences

- A change to a guide changes its Spanish page in the same commit, translated paragraph for paragraph, never summarized, with the terms below. `npm run docs:check` fails when a guide exists in one language only, and compiles the Spanish pages' examples too; `npm run docs:build` builds both languages and fails on a broken link or anchor in either.
- Spanish pages keep the English headings' anchors (`## Encabezado {#english-anchor}`), so links and anchors are the same in both languages.
- Diagrams (SVG) keep their English text; their alt text is translated.
- The site's own strings (navbar, footer, sidebar, landing page) are in `docs/i18n/es/*.json`; the landing page's text goes through `<Translate>`.
- Front matter: `title`, `sidebar_label` and `description` translated; `id`, `slug` and the rest as they are. A heading that is a function name (`## backupCourse`) stays as is.
- Code: identifiers, option names, error codes, commands and output stay as they are; comments and strings meant for people (messages, names in examples) are translated. Admonitions keep their keyword (`:::note`); their title and text are translated.
- What stays English: the driver's own output (`changed` sentences, its error messages, CLI tables) and literal values a program compares. Moodle's interface labels are quoted as Moodle's Spanish interface words them.

## Spanish terms

Moodle's terms as its Spanish interface says them, and the driver's own, always the same:

| English | Spanish |
| --- | --- |
| course, section, activity, resource, course module | curso, sección, actividad, recurso, módulo del curso |
| assignment, submission, extension, feedback | tarea, entrega, ampliación del plazo, retroalimentación |
| grade (noun / verb), gradebook, grader report, grade item, grade category | calificación / calificar, libro de calificaciones, informe del calificador, elemento de calificación, categoría de calificación |
| rubric, marking workflow, marker | rúbrica, flujo de trabajo de calificación, evaluador |
| quiz, attempt, question bank, override | cuestionario, intento, banco de preguntas, excepción |
| forum, discussion, post, reply, subscription | foro, debate, mensaje, respuesta, suscripción |
| lesson, workshop, choice, survey, page, label, book, folder | lección, taller, consulta, encuesta, página, área de texto y medios, libro, carpeta |
| participants, enrolment / enrol, enrolment method, role, group, grouping | participantes, matriculación / matricular, método de matriculación, rol, grupo, agrupamiento |
| completion, access restrictions | finalización, restricciones de acceso |
| logs, report, calendar, event, deadline, notification, message, conversation, badge | registros, informe, calendario, evento, fecha límite, notificación, mensaje, conversación, insignia |
| backup, restore, reset, import | copia de seguridad, restaurar, reiniciar, importar |
| student, teacher, non-editing teacher, manager, admin | estudiante, profesor, profesor sin permiso de edición, gestor, administrador |
| log in, session, site, capability | iniciar sesión, sesión, sitio, capacidad |
| the driver, fake Moodle, sandbox, data categories, trail | el driver, Moodle simulado, sandbox, categorías de datos, rastro |
| browser profile, headless, working tab, background browser | perfil del navegador, sin ventana (headless), pestaña de trabajo, navegador en segundo plano |
| override a grade or completion (verb / noun) | anular / anulación (quiz, assignment and lesson overrides stay "excepción") |
| unenrol, self enrolment, guest access, enrolment key | dar de baja, automatriculación, acceso de invitados, clave de matriculación |
| scale, aggregation, weight, rating / rate, mark | escala, agregación, peso, valoración / valorar, puntuación |
| grading method, marking guide, remarks | método de calificación, guía de evaluación, observaciones |
| workshop assessment, reviewer, assessment phase | evaluación, revisor, fase de evaluación |
| dashboard, timeline, draft area, file picker, editing mode | área personal, línea de tiempo, área de borrador, selector de archivos, modo edición |
| course module id, instance id, slot | id del módulo del curso, id de instancia, posición (`slot` in code) |
| database entry, glossary entry | entrada de una base de datos, entrada de glosario |
| the examples' headings: The program, Step by step, What it prints, Variations, When something goes wrong, Data it touches | El programa, Paso a paso, Lo que imprime, Variaciones, Cuando algo sale mal, Datos que toca |
