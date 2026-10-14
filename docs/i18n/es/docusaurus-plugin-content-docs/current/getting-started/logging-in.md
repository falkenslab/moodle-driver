# Iniciar sesión

El driver nunca maneja una contraseña. La persona inicia sesión a mano, en una ventana del navegador que el driver abre en la página de inicio de sesión del sitio, con lo que use el sitio: su propio formulario, inicio de sesión único, doble factor. El driver espera hasta que hay una sesión y la guarda en un perfil del navegador en disco, de modo que las ejecuciones siguientes empiezan con la sesión ya iniciada.

![Inicia sesión una vez: una ventana la primera vez, la sesión guardada en el perfil, ninguna ventana después hasta que Moodle cierra la sesión](/img/diagrams/log-in-once.svg)

## El perfil {#the-profile}

Un perfil es una carpeta donde el navegador guarda sus cookies y su almacenamiento, igual que el perfil de usuario de un navegador. Elige uno por persona y por sitio, fuera de la carpeta de tu programa y fuera de cualquier repositorio: contiene una sesión activa, tan sensible como una contraseña. Para compartir la sesión con la que inició sesión el [comando `moodle`](command-line.md), usa su carpeta: `siteProfileDir(site)` (o `siteProfileDir(site, { as: "student" })` para una cuenta con nombre) te la da.

```ts
import { createMoodle } from "@falkenslab/moodle-driver";

const moodle = createMoodle({
  site: "https://campus.example.org/",
  profileDir: "/home/ada/.config/my-program/moodle-profile",
  headless: true,
  downloadBrowser: true,
});
```

Chromium olvida las cookies de sesión al cerrarse un perfil persistente, y la cookie `MoodleSession` de Moodle es una de ellas. El driver las guarda en un archivo dentro del perfil (`SESSION_COOKIES_FILE`) al cerrarse o después de iniciar sesión, y las restaura cuando vuelve a abrir el navegador, así que la sesión sobrevive a los reinicios hasta que el propio Moodle la cierra.

## logIn

`moodle.logIn({ timeoutMs?, onWait? })` es la función `logIn(browser, siteUrl, options)` con el navegador y el sitio del objeto; sin `timeoutMs` espera el `loginTimeoutMs` del objeto, cinco minutos si no se indica otro.

```ts
function logIn(
  browser: BrowserManager,
  siteUrl: string,
  options?: { timeoutMs?: number; onWait?: (elapsedMs: number) => void },
): Promise<LoginResult>;

interface LoginResult {
  status: "already-logged-in" | "logged-in";
  userId: number;
  fullName: string;
}
```

- Si el perfil ya tiene una sesión, responde al momento con `already-logged-in`.
- Si no, abre una ventana en la página de inicio de sesión del sitio y espera, llamando a `onWait` cada segundo con el tiempo transcurrido, hasta que la persona ha iniciado sesión (una página del sitio con un usuario real). Pasar por otros dominios por el camino (un proveedor de identidad) no es problema.
- Después guarda la sesión y, salvo que el navegador se esté mostrando bajo demanda, cierra la ventana: la siguiente llamada vuelve a abrir el navegador sin ventana.

Lanza `LoginTimeoutError` cuando nadie inicia sesión dentro de `timeoutMs` (la ventana se cierra), `LoginWindowClosedError` cuando la persona cierra la ventana antes, y `NoDisplayError` donde no hay pantalla para mostrar una ventana (un servidor, un contenedor sin pantalla).

```ts
import { createMoodle, LoginTimeoutError } from "@falkenslab/moodle-driver";

const moodle = createMoodle({ site: "https://campus.example.org/", profileDir: "/home/ada/.moodle-profile", headless: true, downloadBrowser: true });
try {
  const me = await moodle.logIn({
    timeoutMs: 5 * 60_000,
    onWait: (ms) => process.stderr.write(`\rEsperando a que inicies sesión... ${Math.round(ms / 1000)}s`),
  });
  console.log(`\n${me.status}: ${me.fullName} (${me.userId})`);
} catch (error) {
  if (error instanceof LoginTimeoutError) console.error("Nadie ha iniciado sesión a tiempo.");
  else throw error;
}
```

## Encontrar la URL del sitio {#finding-the-sites-url}

Lo habitual es tener a mano la URL de un curso o de la página de inicio de sesión, no la base del sitio. `findMoodleSite(url)` la descarga (sin navegador, sin sesión) y lee la URL base que Moodle escribe en todas sus páginas; `parseSiteUrl(url)` solo la normaliza (http o https, una barra final, sin query). Ambas lanzan `MoodleUrlError` con algo que no es un sitio Moodle o no es una URL.

```ts
import { findMoodleSite } from "@falkenslab/moodle-driver";

const site = await findMoodleSite("https://campus.example.org/course/view.php?id=3");
// "https://campus.example.org/"
```

`publicSiteInfo(site)` lee lo que el sitio cuenta a cualquiera antes de iniciar sesión: su nombre, sus idiomas, si usa proveedores de identidad, el modo de mantenimiento. Consulta [Usuarios y el sitio](../areas/users-and-site.md).

## Cuando termina la sesión {#when-the-session-ends}

Moodle cierra las sesiones tras un tiempo de inactividad, al cerrar sesión, o cuando la persona inicia sesión en otro lugar y el sitio solo permite una sesión. Cualquier operación que necesite la sesión lanza entonces `NotLoggedInError`: vuelve a llamar a `logIn` (se abre una ventana) y reinténtalo. Consulta [Errores](../concepts/errors.md).

## Cerrar sesión {#logging-out}

`moodle.logOut()` cierra la sesión de Moodle mediante el enlace de cerrar sesión del menú de usuario, y responde `false` cuando no había nadie con la sesión iniciada. Un proveedor de inicio de sesión único puede mantener su propia sesión: entonces el siguiente inicio de sesión puede completarse sin contraseña.

## Donde no hay pantalla {#where-theres-no-screen}

En un servidor o en un contenedor no hay pantalla para la ventana de inicio de sesión. Inicia sesión una vez donde la haya (tu ordenador) con la misma carpeta de perfil y luego copia o monta el perfil donde se ejecuta el programa: arranca sin ventana y con la sesión iniciada. En Linux el driver solo abre una ventana cuando `DISPLAY` o `WAYLAND_DISPLAY` están definidas; si no, lanza `NoDisplayError` en lugar de intentarlo.
