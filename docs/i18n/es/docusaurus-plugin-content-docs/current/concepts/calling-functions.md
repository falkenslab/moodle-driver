# El objeto Moodle y las funciones

Hay dos formas de llamar al driver, y son las mismas operaciones:

**Términos:** [id del módulo del curso](../reference/glossary.md#course-module-id), [changed](../reference/glossary.md#changed), [sitio](../reference/glossary.md#site).

- **El objeto Moodle**: `createMoodle()` guarda el sitio y el navegador, y tiene cada operación como un método. La forma habitual.
- **Las funciones**: cada operación es también una función exportada que recibe primero el contexto del navegador y el sitio. Para programas que gestionan el navegador por su cuenta, trabajan con varios sitios o bajan a un [nivel más bajo](low-level.md).

```ts
import { createMoodle, listCourses } from "@falkenslab/moodle-driver";

const moodle = createMoodle({ site: "https://campus.example.org/", profileDir: "/home/ada/.moodle-profile", headless: true, downloadBrowser: true });

// La misma llamada, de las dos formas.
const a = await moodle.listCourses("inprogress");
const b = await listCourses(await moodle.context(), moodle.site, "inprogress");
```

## createMoodle

```ts
function createMoodle(options: MoodleDefaults & (({ site: string } & BrowserOptions) | { site: string; browser: BrowserManager })): Moodle;
```

Dale el sitio y las [opciones del navegador](browser.md) (se crea un gestor del navegador nuevo para él), o un gestor del navegador que ya tengas. El sitio se normaliza (`parseSiteUrl`): una barra final, sin query; algo que no es una URL http(s) lanza `MoodleUrlError`. No se lanza nada hasta la primera llamada que necesita el navegador.

## Valores predeterminados {#defaults}

Los ajustes que un programa repetiría en cada llamada se le dan al objeto una vez; cualquier llamada puede seguir dando los suyos.

| Opción | Valor predeterminado | Lo usan |
| --- | --- | --- |
| `trail` | `"realistic"` | `activityContent`, `answerQuizQuestions`, `answerLessonPage`: el [ritmo del estudiante](student-pace.md) |
| `onProgress(elapsed, total?)` | ninguno | Las mismas tres, mientras esperan al ritmo de un lector |
| `loginTimeoutMs` | 5 minutos | `logIn()`, cuánto espera a la persona |
| `downloadDir` | ninguno | `downloadFile(url)` sin carpeta, `exportGrades(courseId, options)` sin `destDir` |

```ts
import { createMoodle } from "@falkenslab/moodle-driver";

const moodle = createMoodle({
  site: "https://campus.example.org/",
  profileDir: "/home/ada/.moodle-profile",
  headless: true,
  downloadBrowser: true,
  trail: "fast",
  downloadDir: "/home/ada/moodle-files",
});
await moodle.logIn();
const book = await moodle.activityContent(6, "book"); // rápido
const slow = await moodle.activityContent(6, "book", { trail: "realistic" }); // solo esta llamada
```

`moodle.defaults` los devuelve.

## Los métodos del objeto {#the-objects-methods}

Cada operación cuyos primeros parámetros son el contexto del navegador y el sitio es un método del mismo nombre sin ellos: `gradeSubmission(context, site, 35, 7, input)` es `moodle.gradeSubmission(35, 7, input)`, con las mismas opciones, resultado y errores. Las páginas de las áreas muestran las firmas de las funciones; quita los dos primeros parámetros para el método. Las primitivas con las que se construyen las operaciones (los servicios, páginas y formularios de Moodle, el estado en bruto del curso, las acciones del editor) son funciones de `@falkenslab/moodle-driver/internals`, para limitar la entrada principal y el objeto a lo que llaman los programas; consulta [Bajar de nivel](low-level.md). Los analizadores y pasos sueltos propios de las áreas no se exportan.

El objeto también tiene lo suyo:

| Miembro | Qué es |
| --- | --- |
| `site` | La URL base del sitio, normalizada |
| `browser` | El gestor del navegador que hay debajo |
| `context()` | El contexto del navegador, lanzándolo si hace falta: lo que reciben las funciones |
| `logIn({ timeoutMs?, onWait? })` | Se asegura de que hay una sesión, esperando `loginTimeoutMs` por defecto; consulta [Iniciar sesión](../getting-started/logging-in.md) |
| `logOut()` | Cierra la sesión de Moodle |
| `publicSiteInfo()` | Lo que el sitio cuenta a cualquiera antes de iniciar sesión |
| `callService<T>(methodname, args)` | Uno de los servicios AJAX de Moodle, tipado; consulta [Bajar de nivel](low-level.md) |
| `tab()`, `visible()`, `setVisible(visible)` | La pestaña de trabajo y mostrar el navegador; consulta [El navegador](browser.md) |
| `saveSession()`, `close()` | Guardar la sesión y cerrar el navegador |
| `[Symbol.asyncDispose]()` | `close()`, para que `await using` cierre el navegador cuando termina el bloque |
| `defaults` | Los valores predeterminados con los que se creó |

Con `await using` (TypeScript 5.2 o posterior, en un entorno de ejecución que lo tenga o mediante un transpilador), el navegador se cierra solo cuando termina el bloque, también si hay un error:

```ts
import { createMoodle } from "@falkenslab/moodle-driver";

await using moodle = createMoodle({ site: "https://campus.example.org/", profileDir: "/home/ada/.moodle-profile", headless: true, downloadBrowser: true });
await moodle.logIn();
console.log(await moodle.listCourses());
// moodle.close() se ejecuta aquí
```

## Argumentos {#arguments}

Después del contexto y el sitio, cada operación recibe los ids con los que trabaja y luego un objeto de opciones cuando tiene ajustes opcionales, con el comportamiento anterior como valor predeterminado.

```ts
const discussions = await moodle.forumDiscussions(37);
await moodle.gradeSubmission(35, 7, { grade: "8.5", feedback: "<p>Bien argumentado.</p>", notify: true });
```

## Ids {#ids}

Moodle tiene varios tipos de ids, y el driver recibe los que muestran sus páginas:

| Id | Qué es | Dónde obtenerlo |
| --- | --- | --- |
| Id del curso | `course/view.php?id=3` | `listCourses()` |
| Id de la actividad (id del módulo del curso, "cmid") | `mod/quiz/view.php?id=27` | `courseStructure()`, el `id` de cada actividad |
| Id de la sección | No es su número: un id de la base de datos | `courseStructure()`, el `id` de cada sección |
| Id del usuario | `user/view.php?id=4` | `participants()`, `whoAmI()`, cualquier listado de personas |
| Ids del debate y del mensaje | `mod/forum/discuss.php?d=4`, `#p8` | `forumDiscussions()`, `discussion()` |
| Id del intento | `mod/quiz/attempt.php?attempt=9` | `startQuizAttempt()`, `quizInfo()`, `quizResults()` |
| Ids de la pregunta, la categoría y el banco | Los del banco de preguntas | `questionBanks()`, `questions()` |
| Ids del elemento de calificación y de la categoría | Los del libro de calificaciones | `gradebookSetup()`, `graderReport()` |

Las operaciones sobre una actividad reciben siempre su id del módulo del curso (el `id` de su URL), como un parámetro llamado `activityId` sea cual sea el módulo (un cuestionario, un foro, un banco de preguntas), nunca su id de instancia: el driver encuentra la instancia por sí mismo cuando Moodle la necesita.

## Resultados {#results}

Los resultados son datos simples que puedes serializar como JSON:

- fechas como cadenas ISO 8601 en UTC (`2026-10-23T12:30:00.000Z`), salvo donde Moodle solo muestra una fecha como texto (entonces llega tal como se muestra, en el idioma del sitio);
- nombres y textos decodificados, y el HTML convertido en texto plano conservando párrafos y listas donde una operación lee contenido;
- el id propio de una cosa es `id`, y los ids de otras a las que hace referencia son `<thing>Id` (`courseId`, `userId`, `activityId`): un intento es `{ id, userId, … }`, una calificación `{ itemId, grade }`;
- ningún objeto de Playwright, nada que cerrar.

## Listas largas {#long-lists}

Las funciones cuyas listas crecen sin límite en un sitio real (notificaciones, conversaciones y sus mensajes, los debates de un foro y los mensajes de un debate, las entregas de una tarea, los intentos de un cuestionario, las preguntas de un banco, los participantes y los registros de un curso) las leen página a página, todas de la misma forma:

- `limit`: cuántos elementos devolver (1 o más), y `offset`: cuántos saltarse antes (0 si no se indica), contados en los elementos propios de la función y en su propio orden (los más recientes primero para notificaciones y mensajes, y el resto como los lista Moodle);
- sin `limit`, la función lo devuelve todo, como una lista simple, como siempre ha hecho (`offset` solo se salta los primeros);
- con `limit`, la lista llega como una `ListPage`, `{ items, more }`: los elementos de la página y si hay más después. Pide la página siguiente con `offset` desplazado en `limit` hasta que `more` sea `false`.

```ts
interface ListPage<T> {
  items: T[];
  more: boolean;
}
```

Los tipos siguen a la llamada: TypeScript da `ListPage<Notification>` para `notifications({ limit: 20 })` y `Notification[]` para `notifications()`. Donde la lista forma parte de un resultado mayor, la propia lista se convierte en la página: `discussion(id, { limit })` da `{ discussion, posts: { items, more } }`.

```ts
let offset = 0;
for (;;) {
  const page = await moodle.notifications({ unreadOnly: true, limit: 20, offset });
  for (const notification of page.items) console.log(notification.subject);
  if (!page.more) break;
  offset += 20;
}
```

Una página cuesta menos que la lista entera allí donde Moodle lo permite: el driver pide al servicio de Moodle solo la página, o abre solo la página de la paginación propia de Moodle que la contiene. Donde Moodle no pagina (los mensajes de un debate, las preguntas de un banco dentro de una categoría), el driver lee la lista y la recorta, pero aun así solo convierte los elementos de la página; la sección de cada función indica cuáles. Un `limit` menor que 1 o un `offset` menor que 0 es un `MoodleError` con el código `invalid-input`. Las páginas se leen cuando se piden: si mientras tanto se añade algo, una página posterior puede repetir un elemento o saltarse uno.

El comando `moodle` las recibe como `--limit` y `--offset`, muestra una página como sus elementos e indica cuándo hay más.

## Las escrituras responden con el estado posterior {#writes-answer-with-the-state-afterwards}

Toda operación que cambia algo devuelve un objeto con una frase corta `changed` que dice lo que ha hecho, junto al estado posterior cuando es barato de leer: la estructura del curso después de crear una actividad, la tarea después de hacer la entrega, la consulta después de responderla, el debate después de fijarlo, los ids de lo que ha creado. Compruébalo en lugar de volver a leer.

```ts
const result = await moodle.createActivity({ courseId: 3, sectionId: 7, type: "page", name: "Bucles", content: "<p>...</p>" });
console.log(result.changed); // Created page 42 "Bucles" in section 2.
console.log(result.activityId); // 42
```

Muchas escrituras son idempotentes allí donde lo son las de Moodle: marcar una actividad como hecha dos veces, fijar un debate ya fijado, marcar notificaciones como leídas. Otras crean algo cada vez (un mensaje, una actividad, una pregunta).

## Una cosa cada vez {#one-thing-at-a-time}

Las operaciones comparten el navegador y la sesión de la persona. Llámalas una tras otra (con `await` en cada una) en lugar de en paralelo sobre el mismo objeto: la sesión y los tokens de formulario de Moodle son por persona, y un sitio se comporta mejor con una persona haciendo una cosa cada vez. Varios sitios, o varias personas, llevan un objeto (y un perfil) cada uno.

## Los permisos son los de Moodle {#permissions-are-moodles}

El driver puede hacer todo lo que la persona puede hacer en Moodle, y nada más. Un estudiante que llama a una operación de profesor recibe como error el rechazo de Moodle, normalmente con el propio mensaje de Moodle ("Sorry, but you do not currently have permissions to do that (View grader report)", en el idioma del sitio). No hay un modelo de permisos aparte en el driver; un programa que quiera uno puede construirlo sobre las [categorías de datos](data-categories.md).
