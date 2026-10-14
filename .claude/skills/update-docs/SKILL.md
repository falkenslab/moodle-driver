---
name: update-docs
description: Keep moodle-driver's documentation in step with the code - the documentation site (docs/, Docusaurus), the doc comments the API reference is generated from, README.md and .minispec/ (architecture, conventions, stack, glossary, ADRs). Use after any change to src/, scripts/ or package.json, before every commit of such a change, and before a release. A change is not done until its documentation is.
---

# Keep the documentation up to date

A program's developer learns the driver from the documentation site (`docs/`, published at https://falkenslab.github.io/moodle-driver/: guides in `docs/content/`, the API reference generated from the doc comments), the doc comments in the editor, and `README.md`; future sessions learn it from `.minispec/`. Code that changes what a program sees, can do or must write, and isn't documented, is unfinished work.

## 1. Find what changed

```
git status --short
git diff --stat
git diff -- src/index.ts src/internals.ts src/testing/index.ts
```

For each change, ask: would a program using the driver, or a future session working on it, notice it? Count as yes:

- a new, removed or renamed export, option, parameter, type field or error class;
- a changed default, return shape, behavior or error message;
- a new Moodle area covered, or a write where there was only a read;
- a fix that changes what someone could rely on;
- new or changed scripts, requirements (Node, Playwright, Docker image) or install steps;
- a new rule, decision or term learned while working.

Internal refactors, tests and comments with no visible effect need no change beyond their own comments.

## 2. Update what owns it

- **The site's guides** (`docs/content/`, map in `docs/sidebars.ts`): the area page under `docs/content/areas/` for a Moodle function (its signature, options and defaults, what it returns, its errors, Moodle's behaviors, an example, its data categories); a new area gets a new page in the sidebar; `concepts/` for the browser, conventions, errors, the trail, data categories and the low-level pieces; `getting-started/` for installation and logging in; `reference/` for troubleshooting and compatibility. `grep -rn "<the function>" docs/content` finds every page that mentions it.
- **Doc comments**: every export of `src/index.ts`, `src/internals.ts` and `src/testing/index.ts` has one that says what it's for, what it returns and which errors it throws, not how it's built: the API reference is generated from them. Check new exports: `git diff -- src/index.ts` lists them, and each must have a `/** … */` at its declaration.
- **`README.md`** (English, for a program's developer): the areas covered in its first paragraph, the "Use" example (it must still compile), the "Development" commands. Touch it only when the change shows at that level.
- **`.minispec/core/project.md`**: "What it does" when a Moodle area is added. `architecture.md`: when a file or piece is added, moved or changes role. `stack.md`: dependencies, Docker image, distribution. `conventions.md`: a new rule. `glossary.md`: a new term. A decision that's hard to reverse: a new ADR (`minispec-adr`), or update the ADR whose rule changed.
- **`CLAUDE.md`**: only commands and things easy to get wrong; don't duplicate `.minispec/`.

Search too: `grep -rn "<the function or option>" README.md .minispec CLAUDE.md` finds every place that mentions it, so none keeps describing the old behavior. Change the existing explanation rather than appending a note that contradicts it.

## 3. Write it

- English (ADR-008), technical and concrete; then the guide's Spanish page (3b).
- Markdown: one line per paragraph and list item (no hard wraps), no horizontal rules between sections. Site pages are CommonMark, not MDX: write `<placeholders>` inside backticks.
- MiniSpec limits: 100 lines per document, `project.md` ≤ 50, `principles.md` ≤ 20. When a document grows past them, cut.
- Nothing of moodle-mcp's tools or MCP in the driver's docs, except naming moodle-mcp as a consumer (ADR-006).

## 3b. The Spanish guides

Every guide in `docs/content/` has its Spanish translation at the same path under `docs/i18n/es/docusaurus-plugin-content-docs/current/` (ADR-015); only the generated references (`api/`, `reference/commands.md`) are English only. A change to a guide changes its Spanish page in the same commit: the same facts, examples and links, translated, never summarized. A new guide gets its Spanish page; a renamed one, its Spanish page renamed. `npm run docs:check` fails when a guide exists in one language only.

How to write a Spanish page:
- Spanish from Spain, addressing the reader as `tú`, technical and plain, with the English page's structure, paragraph for paragraph, and the same Markdown rules (one line per paragraph and list item).
- Front matter: translate `title`, `sidebar_label` and `description`; keep `id`, `slug` and anything else as is.
- Every heading whose text changes keeps the English heading's anchor explicitly: `## Restaurar en un curso existente {#restoring-into-an-existing-course}`. A heading that is a function name (`## backupCourse`) stays as is. Links between pages keep the English paths and anchors.
- Code: identifiers, option names, error codes, commands and output stay as they are; comments and string literals meant for people (messages, names in examples) are translated. Inline code stays untranslated.
- Images: same paths (diagrams keep their English text); translate the alt text.
- Admonitions (`:::note`, `:::tip`…) keep their keyword; translate their title and text.
- Moodle's terms as Moodle's Spanish interface says them, and the driver's own terms, always the same:

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

## 4. Build the site

`npm run docs:build` (once `npm run docs:install`): it builds both languages and fails on a broken link or anchor in either. Fix the cause; never turn the check off.

## 5. Commit with the code

The documentation goes in the same commit as the change it describes (or right next to it, `docs: …` / `docs(minispec): …`, when one commit per concern reads better). When the change completes a MiniSpec feature or fix, its issue's closing comment mentions what was documented.

Report which documents you changed, or why none needed to.
