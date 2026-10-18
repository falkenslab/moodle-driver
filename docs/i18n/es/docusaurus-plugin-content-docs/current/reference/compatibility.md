# Compatibilidad

## Moodle

El driver es compatible con **Moodle 4.5** (la versión con soporte a largo plazo) y **Moodle 5.x**. Se desarrolla con Moodle 5.2 y se comprueba con sitios reales de ambos en Docker (los sitios 5.2 y 4.5 del sandbox de Moodle); la mayor parte de lo que lee es estable desde Moodle 4.0: el estado del editor del curso, los servicios AJAX, los nombres de los campos de formulario, los ids del body. Los comportamientos confirmados a mano están marcados como "confirmed empirically" en los comentarios del código, con la versión de Moodle.

Donde Moodle cambió de una versión a otra, el driver sigue el camino que necesita la versión del sitio. Lo que a una versión simplemente le falta se rechaza antes de abrir nada, con un `MoodleError` de código `not-available` que nombra la función, el Moodle que necesita y el que ejecuta el sitio ("activitiesOverview needs Moodle 5.0 or later; this site runs 4.5").

### Funciones que necesitan un Moodle más reciente {#functions-that-need-a-newer-moodle}

Todas las funciones que no aparecen aquí funcionan desde Moodle 4.5.

| Función | Necesita | Por qué |
| --- | --- | --- |
| `activitiesOverview` | Moodle 5.0 | La página de vista general de actividades y su servicio llegaron en la 5.0. |

Otras diferencias dentro de una función, que no son rechazos:

- Los bancos de preguntas como actividades `qbank`, y los bancos propios de los cuestionarios: Moodle 5.0 y posteriores.
- Los bancos de preguntas como actividades `qbank`, y los bancos propios de los cuestionarios: Moodle 5.0 y posteriores. En 4.x las funciones de los bancos de preguntas trabajan con el banco propio de cada curso, cuyo id es el del curso (consulta [Bancos de preguntas](../areas/question-banks.md#moodle-4x-the-courses-bank)).
- La vista general de actividades (`activitiesOverview`): Moodle 5.0 y posteriores.
- Las preguntas aleatorias de cuestionario como referencias a conjuntos de preguntas (mostradas como posiciones `random`): Moodle 4.3 y posteriores.

### Cómo se averigua la versión {#how-the-version-is-found}

`moodleVersion()` (consulta [usuarios y el sitio](../areas/users-and-site.md#moodleversion)) dice la rama del sitio ("4.5", "5.2"…) y su versión completa, sin permisos de administrador: Moodle muestra su versión solo a los administradores, así que el driver lee lo que el sitio ofrece a cualquiera.

- La configuración pública de plataforma de LTI (`mod/lti/openid-configuration.php`, presente desde Moodle 3.10) nombra la versión completa: la rama sale de ella.
- Cuando no está disponible, los módulos que tiene el sitio: las actividades de banco de preguntas (`mod/qbank`) llegaron en la 5.0, las subsecciones (`mod/subsection`) en la 4.5. Un sitio con subsecciones y sin actividades de banco de preguntas es 4.5.
- Si no, la rama es `unknown`, nunca se supone la más reciente: un sitio 5.x que oculta su versión, o un sitio anterior a la 4.5. Las funciones que necesitan un Moodle más reciente dejan pasar una versión desconocida, y fallan según responda Moodle.

La respuesta se pregunta una vez por contexto del navegador y se reutiliza.

### Temas e idiomas {#themes-and-languages}

Los temas de Moodle cambian el aspecto pero rara vez la estructura que lee el driver; se comprueba con Boost (el tema predeterminado, en el sandbox 5.2) y con Classic (en el sandbox 4.5, como lo usan muchos campus con la 4.5). Las páginas se leen por estructura que dibujan los dos temas, como ids, atributos data y nombres de campo; donde una función lee una parte que Classic dibuja de otra forma, su guía lo dice. Los idiomas de la interfaz no importan: nada se lee por su texto.

## Navegadores {#browsers}

Microsoft Edge, Google Chrome o el Chromium de Playwright, mediante `playwright-core` 1.64 o posterior (una dependencia peer). El navegador funciona en Windows, macOS y Linux; en Linux sin pantalla, solo sin ventana.

El Firefox de Playwright (`channel: "firefox"`) también funciona, elegido de forma explícita y nunca como navegador en segundo plano. La suite de regresión contra sitios Moodle reales se ejecuta con Chromium; Firefox se comprueba contra el Moodle simulado (el lanzamiento, los servicios, la sesión conservada entre lanzamientos), así que una página que se comporte de otra forma en Firefox aún podría aparecer ahí primero.

## Node.js

Node.js 20 o posterior, solo ESM.

## Inicio de sesión único {#single-sign-on}

Cualquier cosa que la persona pueda completar en una ventana del navegador: el propio formulario de Moodle, SAML, OAuth 2 (Google, Microsoft), CAS, autenticación en dos pasos. El driver solo espera hasta que una página del sitio muestra un usuario con la sesión iniciada.

## Plugins

Los módulos de plugins funcionan allí donde el driver lee las estructuras genéricas de Moodle (el estado del curso, la vista general de actividades, los formularios de configuración). Las funciones de las áreas están escritas para los módulos del núcleo, y para el plugin questionnaire en [encuestas](../areas/surveys-and-choices.md). `moduleCategories()` responde `any` para los módulos que no conoce.
