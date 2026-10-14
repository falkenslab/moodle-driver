# Probar con un Moodle simulado

Un programa que usa el driver debería poder probarse sin un Moodle real, sin un inicio de sesión real y sin red. `@falkenslab/moodle-driver/testing` tiene lo que usan las propias pruebas del driver: un Moodle simulado servido dentro de un contexto del navegador, fragmentos de página inventados y un gestor del navegador que no lanza nada.

```ts
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle, ServiceFailure, fakeBrowserManager, PANEL, type FakeMoodleState } from "@falkenslab/moodle-driver/testing";
```

## El sitio simulado {#the-fake-site}

`serveFakeMoodle(context, state)` redirige toda petición a `SITE` (`http://moodle.test/`) dentro de un contexto del navegador de Playwright y responde como lo haría Moodle:

- Sin sesión (sin `state.user`), toda página es la página de inicio de sesión de Moodle, como con el inicio de sesión forzado.
- Con sesión, cada página es una página mínima de Moodle: el id del body que Moodle da a esa ruta (`/mod/forum/view.php` es `page-mod-forum-view`), `M.cfg` con `wwwroot`, `sesskey`, `userId`, `usertimezone` (`Europe/Madrid`), el enlace de cerrar sesión del menú de usuario y el HTML adicional de `state.bodies[path]`.
- `lib/ajax/service.php` responde con `state.services[methodname](args)`, o con el formato de excepción de Moodle: `servicerequireslogin` sin usuario, `invalidsesskey` con una `sesskey` antigua, `invalidrecord` para un servicio que el estado no define, y cualquier código de error que un servicio lance como `new ServiceFailure(code)`.

```ts
interface FakeMoodleState {
  user?: { id: number; fullName: string };
  sesskey?: string;
  services?: Record<string, (args: Record<string, unknown>) => unknown>;
  bodies?: Record<string, string>;
  bodyClasses?: Record<string, string>;
  pagesServed?: string[];
  serviceCalls?: { methodname: string; args: Record<string, unknown> }[];
}
```

`pagesServed` y `serviceCalls`, si se dan, recogen lo que se ha pedido, para las aserciones. `moodlePage({ userId, heading, bodyId, body… })` construye tú mismo una de esas páginas, para rutas propias (un formulario que hace POST, una página cuyo id del body no es el de su ruta).

## Una prueba {#a-test}

```ts
import assert from "node:assert/strict";
import { after, it } from "node:test";
import { listCourses } from "@falkenslab/moodle-driver";
import { SITE, launchTestBrowser, serveFakeMoodle } from "@falkenslab/moodle-driver/testing";

const browser = await launchTestBrowser();
after(() => browser?.close());

it("lista los cursos de la persona", { skip: !browser && "sin navegador" }, async () => {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, {
    user: { id: 4, fullName: "Ada Lovelace" },
    services: {
      core_course_get_enrolled_courses_by_timeline_classification: () => ({
        courses: [{ id: 3, shortname: "loops", fullname: "Bucles &amp; listas", viewurl: `${SITE}course/view.php?id=3`, visible: true }],
      }),
    },
  });
  const courses = await listCourses(context, SITE);
  assert.equal(courses[0]?.fullname, "Bucles & listas");
  await context.close();
});
```

`launchTestBrowser()` lanza el primer navegador sin ventana que encuentra (Edge, Chrome o el Chromium de Playwright) y responde `undefined` cuando no hay ninguno, para que las pruebas puedan omitirse en lugar de fallar.

## Rutas propias {#routes-of-your-own}

Para páginas que cambian con lo que hace el programa (un formulario que hace POST, un intento de cuestionario), añade un `context.route` después de `serveFakeMoodle`: Playwright prueba primero la ruta registrada en último lugar.

```ts fragment
await context.route(`${SITE}mod/choice/view.php**`, (route) => {
  if (route.request().method() === "POST") chosen = new URLSearchParams(route.request().postData() ?? "").get("answer");
  return route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 4, bodyId: "page-mod-choice-view", body: choicePage(chosen) }) });
});
```

Las propias pruebas del driver (`test/areas/` en el repositorio) tienen simulaciones para cada área: formularios con sus envíos, paneles de calificación, intentos de cuestionario, lecciones, el libro de calificaciones.

## Un gestor del navegador que no lanza nada {#a-browser-manager-that-launches-nothing}

Para probar la lógica propia de un programa en torno al gestor del navegador (iniciar sesión, mostrar el navegador) sin navegador, `fakeBrowserManager(overrides)` da un `BrowserManager` cuyos métodos no hacen nada, salvo los que le pases:

```ts
const manager = fakeBrowserManager({ context: async () => context, visible: () => true });
```

También es la forma en que un programa construido sobre el objeto Moodle se encuentra con el sitio simulado: dale a `createMoodle` un gestor del navegador simulado cuyo contexto sea el que sirve el Moodle simulado.

```ts
import { createMoodle } from "@falkenslab/moodle-driver";
import { SITE, fakeBrowserManager, launchTestBrowser, serveFakeMoodle } from "@falkenslab/moodle-driver/testing";

const browser = await launchTestBrowser();
const context = await browser!.newContext();
await serveFakeMoodle(context, { user: { id: 4, fullName: "Ada Lovelace" }, services: { /* ... */ } });

const moodle = createMoodle({ site: SITE, browser: fakeBrowserManager({ context: async () => context }) });
const courses = await moodle.listCourses();
```

El `close()` del gestor simulado no hace nada, así que `moodle.close()` (o el final de un bloque `await using`) deja el contexto abierto: pasa `close: () => context.close()` para que lo cierre, o cierra tú el contexto al final de la prueba.

## Paneles de calificación {#grading-panels}

`PANEL` es un panel del calificador inventado (una entrega con texto en línea, un archivo y comentarios) tal como lo sirve el calificador de Moodle, para pruebas de programas que leen entregas.

## Ejecutar pruebas con navegador {#running-browser-tests}

Las pruebas que lanzan navegadores abren ventanas en algunos sistemas. El driver ejecuta las suyas solo en Docker (`npm run test:docker`), nunca en el escritorio del desarrollador; consulta [Desarrollo](../reference/development.md).
