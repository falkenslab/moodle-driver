# Herramientas externas

Esta área trabaja con las herramientas externas (LTI) de un curso: listar las herramientas que puede usar un curso (`externalTools`), añadir una al curso (`addExternalTool`), mostrarla en el selector de actividades u ocultarla de él (`setExternalToolInChooser`), borrar las del propio curso (`deleteExternalTool`) y dar a la persona la URL que lanza una actividad de herramienta externa (`externalToolLaunchUrl`). Una actividad se crea a partir de una herramienta con `createActivity` y el id de la herramienta (consulta [Construir un curso](activities.md#createactivity)). Gestionar herramientas requiere las capacidades de LTI de Moodle en el curso, que los profesores tienen por defecto; lanzar requiere `mod/lti:view`, que tiene todo participante.

**Términos:** [herramienta externa](../reference/glossary.md#external-tool).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos; las primitivas de más bajo nivel están en `@falkenslab/moodle-driver/internals` (consulta [Bajar de nivel](../concepts/low-level.md)).

## Cómo funcionan las herramientas externas en Moodle {#how-external-tools-work-in-moodle}

Una herramienta se configura antes de que ninguna actividad la use: un administrador configura las herramientas del sitio (Administración del sitio > Extensiones > Herramienta externa > Gestionar herramientas), que puede usar cualquier curso, y un profesor añade las del propio curso en la página "Herramientas externas LTI" del curso (Más > Herramientas externas LTI, `mod/lti/coursetools.php`). Cada una tiene una URL, y la clave de consumidor y el secreto compartido que dio su proveedor. Moodle 5 crea toda actividad de herramienta externa a partir de una herramienta: la actividad ya no guarda una URL propia. Una herramienta que se muestra en el selector de actividades se ofrece allí con su propio nombre; una que no, no se ofrece en ninguna página del curso, pero se puede seguir creando una actividad a partir de ella.

Moodle no tiene ningún servicio abierto a AJAX que liste las herramientas de un curso para un profesor: el driver lee la página de herramientas del curso, una tabla del generador de informes, como lo haría un profesor, y añade una herramienta mediante el formulario de herramienta del curso (`mod/lti/coursetooledit.php`). Mostrar, ocultar y borrar pasan por los servicios que llaman el propio interruptor de la página y su acción de borrar (`mod_lti_toggle_showinactivitychooser`, `mod_lti_delete_course_tool_type`).

El registro dinámico, en el que una herramienta se registra sola en Moodle, no se cubre: Moodle 5.2 solo lo ofrece a los administradores, en la página de gestión de herramientas del sitio, no en la de un curso.

## ExternalTool

Las herramientas que lista `externalTools` y que devuelven las escrituras:

```ts
interface ExternalTool {
  id: number;
  name: string;
  description: string;
  scope?: "site" | "course";
  url?: string;
  shownInActivityChooser: boolean;
}
```

- `id`: el id de la herramienta (el id del tipo de herramienta de Moodle), el que `createActivity` toma como `toolId` y el que toman las demás funciones.
- `description`: texto plano, `""` si no tiene.
- `scope`: `"site"` para una herramienta que configuró un administrador, que los profesores no pueden cambiar; `"course"` para una añadida a este curso. Moodle bloquea todas las filas por igual a quien no puede añadir herramientas al curso, así que para ellos no aparece.
- `url`: la URL de una herramienta del curso, tal como la guarda su formulario; la de una herramienta del sitio no se muestra a los profesores, así que no aparece.
- `shownInActivityChooser`: si los profesores la encuentran en el selector de actividades.

El secreto compartido de una herramienta nunca se lee ni se devuelve.

## externalTools

Las herramientas externas que puede usar un curso, tal como las lista su página "Herramientas externas LTI": las herramientas del sitio y las del propio curso, por nombre.

```ts
function externalTools(context: BrowserContext, siteUrl: string, courseId: number): Promise<ExternalTool[]>;
```

La página muestra diez herramientas; el resto, en un curso con más, llega del propio servicio de la tabla (`core_table_get_dynamic_table_content`), como hace su paginación. La URL de una herramienta del curso sale de su formulario de edición, pedido sin pestaña, una petición por herramienta del curso. Moodle lista solo las herramientas que se pueden usar en el curso: las del sitio restringidas a otras categorías de cursos, y las que un administrador puso en "No mostrar", no aparecen.

Lanza `ExternalToolError` cuando la persona no puede ver las herramientas del curso (requiere `mod/lti:addpreconfiguredinstance`).

## addExternalTool

Añade una herramienta externa a un curso mediante el formulario de herramienta del curso de Moodle, y la devuelve.

```ts
function addExternalTool(context: BrowserContext, siteUrl: string, courseId: number, tool: NewExternalTool): Promise<{ changed: string; tool: ExternalTool }>;

interface NewExternalTool {
  name: string;
  url: string;
  description?: string;
  key?: string;
  secret?: string;
  settings?: Record<string, FieldValue>;
}
```

- `url`: la URL de lanzamiento de la herramienta, `http` o `https`, o la de un cartucho (un archivo XML que describe la herramienta, a partir del cual Moodle rellena el resto).
- `key`, `secret`: la clave de consumidor y el secreto compartido que dio el proveedor de la herramienta, para una herramienta LTI 1.0/1.1. Moodle guarda el secreto; nada lo devuelve.
- `settings`: cualquier otro campo del formulario, por su nombre, y estos ganan: `lti_ltiversion` (`"1.3.0"` para LTI 1.3, que además necesita `lti_publickeyset`, `lti_initiatelogin` y `lti_redirectionuris`), `lti_launchcontainer` (2 incrustar, 3 incrustar sin bloques, 5 ventana existente, 4 ventana nueva), `lti_sendname`, `lti_sendemailaddr`, `lti_acceptgrades`, `lti_customparameters`.

Moodle muestra la herramienta nueva en el selector de actividades. Al guardar el formulario, Moodle pide la URL para ver si es un cartucho; una URL que bloquean sus ajustes de red (localhost, direcciones privadas) se guarda tal cual (confirmado empíricamente, Moodle 5.2).

Lanza `ExternalToolError` cuando la persona no puede añadir herramientas al curso (requiere `mod/lti:addcoursetool`), un `MoodleError` con código `invalid-input` para un nombre vacío o una URL que no es `http(s)`, y `FormError` con el motivo de Moodle cuando rechaza el formulario.

## setExternalToolInChooser

Muestra una herramienta externa en el selector de actividades del curso, o la oculta de él, como hace el interruptor de la página de herramientas del curso, y devuelve la herramienta después.

```ts
function setExternalToolInChooser(context: BrowserContext, siteUrl: string, courseId: number, toolId: number, shown: boolean): Promise<{ changed: string; tool: ExternalTool }>;
```

Para una herramienta del sitio el ajuste es del propio curso: el sitio y los demás cursos mantienen el suyo (Moodle lo guarda como un registro por curso, que no elimina cuando se borra la herramienta o el curso). `createActivity` sigue creando una actividad a partir de una herramienta oculta (confirmado empíricamente, Moodle 5.2).

Lanza `ExternalToolError` cuando el curso no lista la herramienta, y cuando la persona no puede cambiar las herramientas del curso (requiere `mod/lti:addcoursetool`).

## deleteExternalTool

Borra una de las herramientas externas del propio curso, como hace la acción de borrar de la página de herramientas del curso.

```ts
function deleteExternalTool(context: BrowserContext, siteUrl: string, courseId: number, toolId: number): Promise<{ changed: string }>;
```

Las actividades creadas a partir de ella siguen en el curso, pero ya no se pueden lanzar: la página de Moodle avisa de cuántas la usan, y el driver no pregunta. Borrar un curso no borra sus herramientas (Moodle 5.2): bórralas antes cuando ya no hagan falta.

Lanza `ExternalToolError` cuando el curso no lista la herramienta, para una herramienta del sitio (solo la borra un administrador), y cuando la persona no puede cambiar las herramientas del curso (requiere `mod/lti:addcoursetool`).

## externalToolLaunchUrl

La URL que lanza una actividad de herramienta externa para la persona, `mod/lti/launch.php?id=<activityId>`, para que la persona la abra en su navegador.

```ts
function externalToolLaunchUrl(context: BrowserContext, siteUrl: string, activityId: number): Promise<string>;
```

Abrir la URL registra la visita, como abrir la actividad, y envía a la persona a la herramienta con su lanzamiento firmado. Para comprobar que la persona puede lanzarla y que es una herramienta externa, el driver lee una vez la página de lanzamiento de Moodle por HTTP, sin registrar ninguna visita: la página es un formulario que el navegador enviaría a la herramienta, y el driver nunca lo envía, así que nada llega a la herramienta. Moodle firma cada lanzamiento cuando se abre, así que lo que hay que guardar es la URL, no el lanzamiento.

Lanza `ExternalToolError` con el mensaje de Moodle cuando la actividad no es una herramienta externa o la persona no puede lanzarla (requiere `mod/lti:view`).

## Ejemplo {#example}

Un profesor añade a un curso un simulador que paga el centro, lo deja fuera del selector de actividades, crea una actividad a partir de él y da el enlace a un estudiante.

```ts
import { ExternalToolError } from "@falkenslab/moodle-driver";

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

try {
  const { tool } = await moodle.addExternalTool(3, { name: "Simulador de circuitos", url: "https://sim.example.edu/lti", key: "centro-42", secret: "del-proveedor" });
  await moodle.setExternalToolInChooser(3, tool.id, false);

  const { activityId } = await moodle.createActivity({ courseId: 3, sectionId: 12, type: "lti", toolId: tool.id, name: "Monta un circuito", visibility: "shown" });

  for (const t of await moodle.externalTools(3)) console.log(t.id, t.name, t.scope, t.shownInActivityChooser);
  console.log(await moodle.externalToolLaunchUrl(activityId!));
} catch (error) {
  if (error instanceof ExternalToolError) console.log(error.message);
  else throw error;
}
```

## Categorías de datos {#data-categories}

De `DATA_CATEGORIES` (consulta [Categorías de datos](../concepts/data-categories.md)):

- `externalTools`, `addExternalTool`, `setExternalToolInChooser`, `deleteExternalTool`: `course-content` (lo que configuran los profesores; el secreto de una herramienta nunca se devuelve).
- `externalToolLaunchUrl`: `own` (el lanzamiento de la propia persona).
