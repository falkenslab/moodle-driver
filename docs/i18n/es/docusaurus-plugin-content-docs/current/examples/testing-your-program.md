# Probar tu programa {#testing-your-program}

Un programa construido sobre el driver tiene lógica propia (qué contar, qué saltar, de qué informar) que merece pruebas, y esas pruebas no deberían necesitar un Moodle real, un inicio de sesión ni una red. Esta página prueba una función de un programa con `node:test` contra el Moodle simulado de `@falkenslab/moodle-driver/testing`, para programadores.

**Usa:** [Probar con un Moodle simulado](../testing/fake-moodle.md), [El objeto Moodle y las funciones](../concepts/calling-functions.md), [Vista general y fechas límite](../areas/overview-and-deadlines.md), [Errores](../concepts/errors.md).

## El programa {#the-program}

La función que se prueba es `dueByCourse`: lo que vence en los próximos días, contado por curso, con los cursos que tienen trabajo atrasado primero. Recibe un objeto `Moodle`, así que la prueba puede darle uno sobre el sitio simulado. En un programa vive en su propio módulo (`src/agenda.ts`, que la prueba importa como `../src/agenda.js`); aquí está al principio del archivo de pruebas, para que la página muestre un único archivo completo. El Moodle simulado responde al servicio de calendario al que llama `deadlines()` del driver, con eventos que la prueba se inventa.

```ts
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createMoodle, MoodleServiceError, NotLoggedInError, type Moodle } from "@falkenslab/moodle-driver";
import { SITE, ServiceFailure, fakeBrowserManager, launchTestBrowser, serveFakeMoodle, type FakeMoodleState } from "@falkenslab/moodle-driver/testing";

// La función que se prueba (src/agenda.ts en el programa).
export async function dueByCourse(moodle: Moodle, days = 7): Promise<{ course: string; due: number; overdue: number }[]> {
  const byCourse = new Map<string, { course: string; due: number; overdue: number }>();
  for (const deadline of await moodle.deadlines({ days })) {
    const course = deadline.course?.shortname ?? "(sitio)"; // Un evento del sitio (sin curso) también cuenta.
    const entry = byCourse.get(course) ?? { course, due: 0, overdue: 0 };
    entry.due++;
    if (deadline.overdue) entry.overdue++;
    byCourse.set(course, entry);
  }
  return [...byCourse.values()].sort((a, b) => b.overdue - a.overdue || a.course.localeCompare(b.course));
}

// Un navegador sin ventana, o undefined donde no hay ninguno: entonces las pruebas se saltan.
const browser = await launchTestBrowser();
after(() => browser?.close());

// Un objeto Moodle sobre un sitio simulado con este estado: sin sitio real, sin inicio de sesión, sin red.
async function fakeMoodle(state: FakeMoodleState) {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, state);
  return createMoodle({ site: SITE, browser: fakeBrowserManager({ context: async () => context, close: () => context.close() }) });
}

const ADA = { id: 4, fullName: "Ada Lovelace" };
const tomorrow = Math.floor(Date.now() / 1000) + 86_400;
// Un evento de acción del calendario tal como lo envía el servicio de Moodle.
const event = (shortname: string, overdue = false) => ({ name: "Vence la redacción", activityname: "Redacción", modulename: "assign", eventtype: "due", timesort: tomorrow, overdue, course: { id: 3, shortname } });

describe("dueByCourse", { skip: !browser && "sin navegador" }, () => {
  it("cuenta las fechas límite por curso, primero las que tienen trabajo atrasado", async () => {
    await using moodle = await fakeMoodle({
      user: ADA,
      services: { core_calendar_get_action_events_by_timesort: () => ({ events: [event("PROG1"), event("DB"), event("DB", true)] }) },
    });
    assert.deepEqual(await dueByCourse(moodle), [
      { course: "DB", due: 2, overdue: 1 },
      { course: "PROG1", due: 1, overdue: 0 },
    ]);
  });

  it("transmite que la sesión terminó", async () => {
    await using moodle = await fakeMoodle({}); // Sin usuario: todas las páginas son la página de acceso de Moodle.
    await assert.rejects(dueByCourse(moodle), NotLoggedInError);
  });

  it("transmite la negativa de Moodle", async () => {
    await using moodle = await fakeMoodle({
      user: ADA,
      services: { core_calendar_get_action_events_by_timesort: () => { throw new ServiceFailure("nopermissions"); } },
    });
    await assert.rejects(dueByCourse(moodle), (error) => error instanceof MoodleServiceError && error.errorcode === "nopermissions");
  });
});
```

## Paso a paso {#step-by-step}

1. La función recibe el objeto `Moodle` como parámetro en vez de crearlo: el programa le pasa el real; la prueba, uno simulado. Es la única decisión de diseño que exigen las pruebas.
2. `launchTestBrowser()` lanza el primer navegador sin ventana que encuentra (Edge, Chrome o el Chromium de Playwright), o responde `undefined`; el `skip` de `describe` convierte eso en pruebas saltadas en lugar de fallos.
3. `serveFakeMoodle(context, state)` responde a cada petición a `SITE` (`http://moodle.test/`) dentro de ese contexto del navegador como lo haría Moodle: las páginas, con la sesión de `state.user`, y `lib/ajax/service.php`, con `state.services[methodname](args)`.
4. `fakeBrowserManager({ context, close })` es un gestor de navegador que no lanza nada: su contexto es el simulado, y cerrarlo cierra ese contexto. `createMoodle({ site: SITE, browser })` construye encima el mismo objeto que usa el programa.
5. Cada prueba prepara el estado del curso que necesita: eventos en dos cursos, ningún usuario (la sesión terminó), o un servicio que lanza `ServiceFailure("nopermissions")`, que el simulado responde con el formato de excepción de Moodle.
6. `await using` cierra el contexto de cada prueba cuando esta termina, a través del `close` del gestor simulado.

## Ejecutar las pruebas {#running-the-tests}

Con `tsx` para ejecutar TypeScript:

```text
npx tsx --test "test/**/*.test.ts"
```

Las pruebas abren un navegador sin ventana. Ejecútalas donde las ventanas no molesten a nadie: en CI, o en un contenedor con un navegador (las imágenes Docker de Playwright traen uno). Una ejecución de ejemplo:

```text
▶ dueByCourse
  ✔ cuenta las fechas límite por curso, primero las que tienen trabajo atrasado (412ms)
  ✔ transmite que la sesión terminó (98ms)
  ✔ transmite la negativa de Moodle (87ms)
▶ dueByCourse (601ms)
ℹ tests 3
ℹ pass 3
ℹ fail 0
```

En una máquina sin ningún navegador las tres aparecen como saltadas, con el motivo "sin navegador".

## Variaciones {#variations}

- Comprobar lo que pidió el programa: da al estado un array `serviceCalls: []` y comprueba los métodos y los argumentos después de la llamada (por ejemplo, que pidió siete días hacia delante).
- Páginas, no servicios: `state.bodies[path]` añade HTML a una página, y `moodlePage({ userId, bodyId, body })` construye una entera para un `context.route` propio (un formulario que hace POST); consulta [Probar con un Moodle simulado](../testing/fake-moodle.md).
- Sin navegador en absoluto: la lógica que solo usa el gestor de navegador (mostrar el navegador, iniciar sesión) puede recibir `fakeBrowserManager({ visible: () => true, ... })` sin ningún contexto detrás.
- Muchas pruebas sobre el mismo estado: construye el objeto en un `before` y ciérralo en un `after` en vez de en cada prueba.

## Cuando algo sale mal {#when-something-goes-wrong}

- Todas las pruebas saltadas: no se encontró ningún navegador. Instala Edge o Chrome, o el Chromium de Playwright (`npx playwright-core install chromium`), en la imagen donde se ejecutan las pruebas.
- `MoodleServiceError` con `invalidrecord`: el código llamó a un servicio que el estado no define. Añádelo a `state.services`, o mira `serviceCalls` para ver cuál era.
- Una prueba que se queda colgada o agota el tiempo: una página que el driver espera no está simulada como él la lee (un formulario, un elemento). Las pruebas del propio driver (`test/areas/` en su repositorio) tienen simulaciones para todas las áreas de las que partir.
- Fechas que se desplazan: `deadlines()` del driver pide una ventana alrededor del momento actual, así que crea los eventos relativos a `Date.now()`, como hace la prueba, no con fechas fijas.

## Datos que toca {#data-it-touches}

Nada real: el sitio simulado solo contiene lo que se inventa la prueba. La función en sí lee las fechas límite de la propia persona, la [categoría de datos](../concepts/data-categories.md) `own`.
