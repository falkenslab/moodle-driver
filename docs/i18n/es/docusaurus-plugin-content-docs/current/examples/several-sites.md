# Trabajar con varios sitios {#working-several-sites}

Una persona suele tener más de un Moodle: el de un instituto y el de una universidad, o la cuenta de profesor y la de un estudiante de prueba en el mismo sitio. Esta página muestra un programa que trabaja con cada uno mediante su propio objeto `Moodle` y su propio perfil, uno tras otro, y deja que la persona vea el navegador si quiere, para programadores.

**Usa:** [El objeto Moodle y las funciones](../concepts/calling-functions.md), [El navegador](../concepts/browser.md), [Iniciar sesión](../getting-started/logging-in.md), [Vista general y fechas límite](../areas/overview-and-deadlines.md).

## El programa {#the-program}

```ts
import { homedir } from "node:os";
import path from "node:path";
import { canShowWindow, createMoodle, type Moodle } from "@falkenslab/moodle-driver";

// Un perfil por sitio y por persona: cada carpeta guarda la sesión de esa persona en ese sitio.
const profiles = path.join(homedir(), ".config", "week-ahead");
const ACCOUNTS = [
  { label: "Instituto", site: "https://campus.school.example/", profileDir: path.join(profiles, "school-ada") },
  { label: "Universidad", site: "https://moodle.uni.example/", profileDir: path.join(profiles, "uni-ada") },
  // El mismo sitio otra vez como otra persona: otro objeto, otro perfil.
  { label: "Universidad (estudiante de prueba)", site: "https://moodle.uni.example/", profileDir: path.join(profiles, "uni-student") },
];

// `--watch` muestra el navegador mientras el programa trabaja, cuando hay una pantalla en la que mostrarlo.
const watch = process.argv.includes("--watch") && canShowWindow();

async function weekAhead(moodle: Moodle): Promise<string[]> {
  const items = await moodle.deadlines({ days: 7, pastDays: 0 });
  return items.map((item) => `${item.date.slice(0, 10)}  ${item.course?.shortname ?? "-"}  ${item.activity}${item.overdue ? " (atrasada)" : ""}`);
}

for (const account of ACCOUNTS) {
  // Un bloque por cuenta: `await using` cierra este navegador antes de que se abra el siguiente.
  await using moodle = createMoodle({ site: account.site, profileDir: account.profileDir, headless: true, downloadBrowser: true });

  // Una ventana de inicio de sesión solo para una cuenta cuyo perfil aún no tiene sesión.
  const me = await moodle.logIn();
  if (watch) await moodle.setVisible(true); // Se relanza con ventana, conservando la sesión; las páginas que se abran después se ven.

  console.log(`\n${account.label}: ${me.fullName}`);
  const lines = await weekAhead(moodle);
  console.log(lines.length > 0 ? lines.join("\n") : "Nada que entregar esta semana.");

  if (watch) await moodle.setVisible(false); // De vuelta a sin ventana; close() también valdría.
}
```

## Paso a paso {#step-by-step}

1. Cada cuenta tiene su propia carpeta de perfil. Un perfil son las cookies y el almacenamiento de un navegador: una sesión de una persona en un sitio. Dos personas en el mismo sitio necesitan dos perfiles, como muestra la tercera entrada.
2. El cuerpo del bucle es un bloque, así que `await using` desecha el objeto al final de cada iteración: el navegador guarda la sesión de esa cuenta y se cierra antes de que se abra el de la siguiente.
3. `moodle.logIn()` responde al instante para una cuenta que ya ha iniciado sesión. La primera vez abre una ventana para ese sitio, la persona inicia sesión y la ventana se cierra.
4. Con `--watch`, `setVisible(true)` relanza el navegador con una ventana, conservando la sesión, y desde ese momento las páginas que abren los métodos se muestran en una pestaña de trabajo, una tras otra, para que la persona vea lo que hace el programa. `canShowWindow()` lo deja desactivado donde no hay pantalla.
5. `deadlines()` lee los eventos de acción del calendario de los próximos siete días para esa cuenta. Los resultados son datos simples; no hay que cerrar nada.
6. `setVisible(false)` cierra la ventana; el navegador vuelve a ejecutarse sin ventana en la siguiente llamada, o se cierra con el bloque.

## Lo que imprime {#what-it-prints}

Un ejemplo, con sitios y cursos inventados:

```text
Instituto: Ada Lovelace
2026-10-12  MATH3  Ficha de fracciones
2026-10-15  HIST3  Redacción: la Revolución Industrial

Universidad: Ada Lovelace
2026-10-11  PROG1  Ejercicios de bucles (atrasada)

Universidad (estudiante de prueba): Estudiante de Prueba
Nada que entregar esta semana.
```

## Variaciones {#variations}

- En paralelo: dos objetos con dos perfiles pueden ejecutarse a la vez (`await Promise.all(ACCOUNTS.map(...))`), cada uno con su navegador. Nunca dos objetos sobre la misma carpeta de perfil a la vez: un navegador bloquea su perfil.
- No sobre un mismo objeto: las llamadas a un mismo objeto comparten el navegador y la sesión y los tokens de formulario de Moodle, y Moodle se comporta mejor con una persona haciendo una cosa cada vez. Usa `await` en cada llamada; no hagas `Promise.all` de llamadas a un mismo objeto.
- Mantener abiertos todos los navegadores: crea los objetos una vez, fuera del bucle, y ciérralos al final (un `await using` por cada uno, en el mismo bloque). Cada navegador abierto cuesta memoria.
- Mostrarlo solo cuando haga falta: mantén el navegador oculto y llama a `setVisible(true)` solo cuando la persona deba mirar (una página pregunta algo que solo ella puede responder); entonces `moodle.tab()` da la pestaña que ve.

## Cuando algo sale mal {#when-something-goes-wrong}

- `NotLoggedInError` en una cuenta: la sesión de ese sitio terminó. Llama a `logIn()` para ese objeto y reintenta; las demás cuentas no se ven afectadas. Consulta [Errores y sesiones caducadas](errors-and-sessions.md).
- `NoDisplayError` de `logIn()` o `setVisible(true)`: no hay pantalla (un servidor, un contenedor). Inicia sesión donde haya una con las mismas carpetas de perfil y cópialas.
- `MoodleUrlError` de `createMoodle`: una URL de sitio que no es http(s). `findMoodleSite(url)` encuentra la URL base de un sitio a partir de cualquiera de sus páginas.
- Un navegador que no arranca porque el perfil está en uso: otro objeto, u otro programa, tiene abierto ese perfil. Ciérralo primero.

## Datos que toca {#data-it-touches}

Las fechas límite de la propia persona en cada sitio: la [categoría de datos](../concepts/data-categories.md) `own`. Iniciar sesión y mostrar el navegador no tocan nada de nadie (`none`).
