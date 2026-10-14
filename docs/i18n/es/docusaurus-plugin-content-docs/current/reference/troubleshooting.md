# Resolución de problemas

## NotLoggedInError en todas las llamadas {#notloggedinerror-on-every-call}

La sesión ha terminado: Moodle la hizo caducar, la persona cerró sesión, o inició sesión en otro lugar en un sitio que solo permite una sesión. Vuelve a llamar a `logIn()`; se abre una ventana. Si ocurre justo después de iniciar sesión, comprueba que la carpeta del perfil es la misma en ambas ejecuciones y que se puede escribir en ella: las cookies de sesión viven en un archivo dentro de ella.

## "Neither Microsoft Edge nor Google Chrome is available, so it's being downloaded"

Es `BrowserDownloadingError`: no se encontró ningún navegador del sistema y Chromium se está descargando en segundo plano (unos 180 MB). Vuelve a intentarlo en un minuto o dos. Detrás de un proxy o sin internet la descarga falla; `chromiumDownload()` dice entonces `"failed"`. Instala Edge o Chrome, o define `PLAYWRIGHT_BROWSERS_PATH` con una carpeta que tenga los navegadores de Playwright.

## NoDisplayError

Hacía falta una ventana (para iniciar sesión, `setVisible(true)`) en Linux sin `DISPLAY` ni `WAYLAND_DISPLAY`: un servidor, un contenedor, una sesión SSH. Inicia sesión una vez donde haya pantalla con el mismo perfil y luego ejecuta sin ventana. En un contenedor, `xvfb-run` da una pantalla virtual si de verdad hace falta una ventana.

## Un formulario "has no such field" o "has these fields disabled" {#a-form-has-no-such-field-or-has-these-fields-disabled}

Los nombres de los campos son los de Moodle, del HTML del formulario: léelos con `activitySettings()` para una actividad, o de la página. Un campo desactivado está esperando a otro: la casilla `[enabled]` de una fecha, la opción "reescalar calificaciones existentes" de una tarea antes de una nueva calificación máxima. Fija ese antes en la misma llamada.

## Moodle rechazó el formulario {#moodle-refused-the-form}

`FormError` lista los mensajes de validación de Moodle por campo, en el idioma del sitio: un nombre corto ya usado, una fecha anterior a otra, un campo obligatorio vacío. Corrige los valores y vuelve a intentarlo; no se ha guardado nada.

## "servicenotavailable" desde callService {#servicenotavailable-from-callservice}

El servicio existe pero no está abierto a AJAX: muchos son solo para la app móvil. Las funciones del driver solo usan servicios habilitados para AJAX, o las páginas y formularios donde no hay ninguno abierto.

## El informe del calificador dice que está recalculando {#the-grader-report-says-its-recalculating}

Después de eliminar actividades o cambiar ponderaciones, Moodle recalcula las calificaciones en una tarea en segundo plano, y mientras tanto el informe del calificador muestra una barra de progreso (`GradebookError`). En un sitio sin cron (un sandbox local), ejecuta las tareas de Moodle.

## Un cuestionario no puede cambiar sus preguntas {#a-quiz-cant-change-its-questions}

Moodle no deja añadir ni quitar preguntas a un cuestionario con intentos. Crea un cuestionario nuevo, o elimina antes sus intentos en Moodle.

## Llamadas lentas {#slow-calls}

Cada llamada es una página o una petición a un servicio, y las funciones de estudiante con el rastro realista esperan como un lector (consulta [Trabajar al ritmo de un estudiante](../concepts/student-pace.md)). Usa `trail: "fast"` donde el ritmo no importe, lee una vez lo que necesites y guárdalo, y prefiere las funciones que devuelven el estado tras un cambio en lugar de volver a leerlo.

## Algo funciona en el navegador pero no a través del driver {#something-works-in-the-browser-but-not-through-the-driver}

Muestra el navegador con `setVisible(true)`: sigue las páginas que abren las funciones, así que ves dónde se detiene. `moodleErrorMessage(page)` lee el error de Moodle en una página tuya, y `browser.tab()` te permite probar los pasos a mano con Playwright.
