# Usuarios y sitio

Quién es la persona que ha iniciado sesión, otros usuarios por id, los roles de un usuario y las capacidades de la persona en un curso, y lo que el sitio cuenta de sí mismo, antes y después de iniciar sesión. Cualquiera con la sesión iniciada puede usarlas; lo que Moodle muestra de otro usuario depende de los derechos de la persona. Tres funciones no necesitan navegador ni sesión en absoluto (`parseSiteUrl`, `findMoodleSite`, `publicSiteInfo`): un programa puede usarlas para comprobar el sitio que da la persona antes de [iniciar sesión](../getting-started/logging-in.md).

**Términos:** [sitio](../reference/glossary.md#site), [sesión](../reference/glossary.md#session), [rol](../reference/glossary.md#role).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos; las primitivas de más bajo nivel están en `@falkenslab/moodle-driver/internals` (consulta [Bajar de nivel](../concepts/low-level.md)).

## whoAmI

Quién es la persona que ha iniciado sesión; con un curso, también sus roles y capacidades en él.

```ts
function whoAmI(context: BrowserContext, siteUrl: string, courseId?: number): Promise<Me>;

interface Me {
  userId: number;
  username?: string;
  fullName: string;
  email?: string;
  language: string;
  timeZone: string;
  firstAccess?: string;
  lastAccess?: string;
  site: { name?: string; url: string };
  course?: { id: number; roles: { id: number; name: string }[]; canEdit: boolean; canGrade: boolean };
}
```

- `userId`, `language` y `timeZone` vienen del `M.cfg` de la página (`language` es el idioma de la interfaz en uso, `timeZone` la zona horaria de la persona en Moodle, como `"Europe/Madrid"`).
- `username`, `fullName`, `email`, `firstAccess` y `lastAccess` (ISO 8601) vienen de `userById` para la persona.
- `site.name` es la respuesta de `siteName`, `site.url` la URL dada.
- `course`, solo con `courseId`: `roles` tal como los lee `courseRoles`, y `canEdit` y `canGrade` tal como los dice `courseAbilities`.

Lanza `NotLoggedInError` sin sesión, y `MoodleServiceError` para un curso que la persona no puede ver (primero se lee el estado del curso, que lo comprueba).

## userById

Un usuario por id, mediante `core_user_get_users_by_field`, o `undefined` cuando no hay nadie: no existe ese usuario, la persona no puede verlo o es una cuenta eliminada. Moodle conserva el registro de una cuenta eliminada y se lo sigue dando a un administrador, renombrado y con el correo sustituido por un hash; el driver la trata como desaparecida.

```ts
function userById(context: BrowserContext, siteUrl: string, userId: number): Promise<User | undefined>;

interface User {
  id: number;
  username?: string;
  fullName: string;
  email?: string;
  firstAccess?: string;
  lastAccess?: string;
}
```

`firstAccess` y `lastAccess` son fechas ISO 8601, que se dejan fuera cuando el usuario nunca entró. Moodle decide lo que devuelve: los campos opcionales solo llegan cuando la persona puede verlos (un estudiante normalmente no recibe los nombres de usuario ni los correos de otros usuarios), y un usuario que la persona no puede ver puede volver como `undefined`.

## courseRoles

Los roles de un usuario en un curso, leídos de su perfil en el curso (`user/view.php?id=<user>&course=<course>`).

```ts
function courseRoles(context: BrowserContext, siteUrl: string, userId: number, courseId: number): Promise<{ id: number; name: string }[]>;
```

El `id` de cada rol viene del `roleid` de los enlaces de los roles, así que es fiable en cualquier idioma; `name` es el nombre del rol tal como lo muestra la página (`"Non-editing teacher"`). Un usuario sin rol en el curso da una lista vacía. Lanza `NotLoggedInError` sin sesión.

## courseAbilities

Lo que la persona puede hacer en un curso, preguntado a servicios de solo lectura que requieren la capacidad; no se cambia nada.

```ts
function courseAbilities(context: BrowserContext, siteUrl: string, courseId: number, sectionId: number): Promise<{ canEdit: boolean; canGrade: boolean }>;
```

- `canEdit`: el selector de actividades le ofrece a la persona algún tipo que añadir a la sección (`core_courseformat_get_section_content_items`), lo que requiere `moodle/course:manageactivities`.
- `canGrade`: se pueden leer los usuarios del informe del calificador (`gradereport_grader_get_users_in_report`); una respuesta `nopermissions` significa `false`.

`sectionId` es cualquier sección del curso (su id, de la [estructura del curso](courses.md)); `whoAmI` usa la primera. Los errores distintos de `nopermissions` pasan como `MoodleServiceError`.

## siteName

El nombre del sitio, de sus ajustes públicos (`tool_mobile_get_public_config`) con la sesión de la persona.

```ts
function siteName(context: BrowserContext, siteUrl: string): Promise<string | undefined>;
```

Devuelve `undefined` cuando la llamada falla por cualquier motivo, como un sitio con el soporte de la app móvil desactivado. Nunca lanza un error, ni siquiera sin sesión.

## moodleVersion

El Moodle que ejecuta el sitio: su rama y, cuando el sitio la dice, su versión completa. No necesita permisos de administrador, ni sesión.

```ts
function moodleVersion(context: BrowserContext, siteUrl: string): Promise<MoodleVersion>;

interface MoodleVersion {
  branch: string; // "4.5", "5.0", "5.1", "5.2"…, o "unknown"
  release?: string; // "4.5.15 (Build: 20261005)"
}
```

Cómo se averigua, y por qué puede ser `unknown`, está en [compatibilidad](../reference/compatibility.md#how-the-version-is-found). Se pregunta una vez por contexto del navegador: las llamadas siguientes, y las funciones que necesitan un Moodle más reciente, reutilizan la respuesta. Nunca lanza un error; un sitio que no responde da `unknown`, y se vuelve a preguntar la próxima vez.

```ts fragment
const { branch } = await moodle.moodleVersion();
if (branch === "4.5") console.log("Aquí no hay vista general de actividades.");
```

## publicSiteInfo

Lo que el sitio cuenta de sí mismo a cualquiera, mediante el punto de entrada de Moodle para los servicios que no requieren inicio de sesión (`lib/ajax/service-nologin.php`): sin navegador ni sesión.

```ts
function publicSiteInfo(
  siteUrl: string,
  fetchImpl?: typeof fetch,
): Promise<{
  name: string;
  url: string;
  language?: string;
  languages?: string[];
  login: { appLogin?: "app" | "browser" | "embedded"; guestAccess: boolean; identityProviders: string[] };
  maintenance?: string;
  supportPage?: string;
}>;
```

- `name`: el nombre del sitio, con las entidades decodificadas; `url`: su `wwwroot`.
- `language`: el idioma predeterminado; `languages`: los códigos que ofrece el menú de idiomas, ausente cuando el sitio no los restringe (todos los idiomas instalados).
- `login.appLogin`: cómo le dice el sitio a la app móvil de Moodle que inicie sesión, lo que indica si usa su propio formulario (`"app"`) o un navegador (`"browser"`, `"embedded"`, como hacen los sitios con inicio de sesión único); `guestAccess`: los invitados pueden entrar; `identityProviders`: los nombres de los proveedores de identidad de la página de inicio de sesión (`"Google"`, `"CAS"`).
- `maintenance`: el mensaje de mantenimiento, solo cuando el sitio está en modo mantenimiento.
- `supportPage`: la página de soporte del sitio, cuando tiene una.

Moodle solo muestra su versión a los administradores, así que no está aquí. `fetchImpl` es por defecto el `fetch` global (un programa o una prueba pueden pasar el suyo); la petición caduca a los 60 segundos. Un servicio que falla vuelve como `MoodleServiceError` (un sitio con los servicios de la app móvil desactivados responde con uno), y un sitio inalcanzable, como el error de `fetch`.

## findMoodleSite y parseSiteUrl {#findmoodlesite-and-parsesiteurl}

```ts
function parseSiteUrl(value: string): string;
function findMoodleSite(url: string, fetchImpl?: typeof fetch): Promise<string>;
```

`parseSiteUrl` normaliza la URL base de un sitio sin obtener nada: http o https, sin consulta ni fragmento, y con una barra final (`"https://campus.example.org/moodle"` pasa a ser `"https://campus.example.org/moodle/"`). Lanza `MoodleUrlError` para algo que no es una URL o no es http(s). Todas las funciones reciben la URL del sitio de esta forma.

`findMoodleSite` encuentra la URL base del sitio a partir de cualquier URL suya (la página de inicio, un curso, la página de inicio de sesión, una URL que la persona copió de la barra de direcciones): obtiene la página, siguiendo las redirecciones, y lee el `M.cfg.wwwroot` que Moodle pone en todas las páginas, y luego lo normaliza con `parseSiteUrl`. No usa navegador ni sesión, y espera hasta 60 segundos, porque un sitio que acaba de arrancar puede tardar en responder. Lanza `MoodleUrlError` cuando la URL está mal formada, el sitio no se puede alcanzar o la página no es de Moodle.

## Ejemplo {#example}

```ts
import { MoodleUrlError, createMoodle, findMoodleSite, publicSiteInfo } from "@falkenslab/moodle-driver";

// Antes de iniciar sesión: de lo que pegó la persona a la URL base del sitio.
let site: string;
try {
  site = await findMoodleSite("https://campus.example.org/course/view.php?id=3");
} catch (error) {
  if (error instanceof MoodleUrlError) throw new Error(`Eso no es un sitio Moodle: ${error.message}`);
  throw error;
}
const info = await publicSiteInfo(site);
if (info.maintenance) console.log(`${info.name} está en mantenimiento: ${info.maintenance}`);

// Luego el sitio va al objeto que usan todas las llamadas; tras iniciar sesión:
const moodle = createMoodle({ site, profileDir: "/home/ada/.moodle-profile", headless: true, downloadBrowser: true });
await moodle.logIn({ timeoutMs: 5 * 60_000 });
const me = await moodle.whoAmI(3);
console.log(`${me.fullName} (${me.userId}), ${me.timeZone}`);
console.log(me.course?.roles.map((r) => r.name), me.course?.canEdit ? "puede editar" : "no puede editar");
```

## Categorías de datos {#data-categories}

`whoAmI` y `courseAbilities` son `own`. `userById` y `courseRoles` son `others-personal` (leen los datos de cualquiera, incluidos los de la persona). `siteName`, `moodleVersion`, `publicSiteInfo`, `findMoodleSite`, `parseSiteUrl` y la función de bajo nivel `readWwwroot` son `none`; las de bajo nivel `readPageConfig` y `readOwnProfile` son `own`. Consulta [categorías de datos](../concepts/data-categories.md).
