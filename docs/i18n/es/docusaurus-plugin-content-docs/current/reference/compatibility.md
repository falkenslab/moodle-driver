# Compatibilidad

## Moodle

El driver se desarrolla y se comprueba con **Moodle 5.2** (un sitio real en Docker, el sandbox de Moodle), y la mayor parte de lo que lee es estable desde Moodle 4.0: el estado del editor del curso, los servicios AJAX, los nombres de los campos de formulario, los ids del body. Los comportamientos confirmados a mano están marcados como "confirmed empirically" en los comentarios del código, con la versión de Moodle.

Lo que depende de versiones más recientes:

- Los bancos de preguntas como actividades `qbank`, y los bancos propios de los cuestionarios: Moodle 5.0 y posteriores.
- La vista general de actividades (`activitiesOverview`): Moodle 5.0 y posteriores.
- Las preguntas aleatorias de cuestionario como referencias a conjuntos de preguntas (mostradas como posiciones `random`): Moodle 4.3 y posteriores.

Los temas de Moodle cambian el aspecto pero rara vez la estructura que lee el driver; se comprueba con Boost, el tema predeterminado. Los idiomas de la interfaz no importan: nada se lee por su texto.

## Navegadores {#browsers}

Microsoft Edge, Google Chrome o el Chromium de Playwright, mediante `playwright-core` 1.64 o posterior (una dependencia peer). El navegador funciona en Windows, macOS y Linux; en Linux sin pantalla, solo sin ventana.

## Node.js

Node.js 20 o posterior, solo ESM.

## Inicio de sesión único {#single-sign-on}

Cualquier cosa que la persona pueda completar en una ventana del navegador: el propio formulario de Moodle, SAML, OAuth 2 (Google, Microsoft), CAS, autenticación en dos pasos. El driver solo espera hasta que una página del sitio muestra un usuario con la sesión iniciada.

## Plugins

Los módulos de plugins funcionan allí donde el driver lee las estructuras genéricas de Moodle (el estado del curso, la vista general de actividades, los formularios de configuración). Las funciones de las áreas están escritas para los módulos del núcleo, y para el plugin questionnaire en [encuestas](../areas/surveys-and-choices.md). `moduleCategories()` responde `any` para los módulos que no conoce.
