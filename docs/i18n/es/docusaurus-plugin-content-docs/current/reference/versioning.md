# Versionado

El driver sigue el [versionado semántico](https://semver.org) con la regla habitual para las versiones `0.x`:

- **Menor** (`0.1.x` → `0.2.0`): funcionalidades nuevas, y cualquier cambio que pueda romper un programa existente (la firma de una función, un campo devuelto, una clase de error).
- **Parche** (`0.1.0` → `0.1.1`): correcciones y cambios internos, sin cambios en la API.
- **Mayor** (`1.0.0`): cuando la API se declare estable; desde entonces los cambios incompatibles suben la versión mayor.

Cada release es una etiqueta `vX.Y.Z` con notas de la versión en [GitHub](https://github.com/falkenslab/moodle-driver/releases), que listan las funcionalidades nuevas, las correcciones y los cambios incompatibles con cómo adaptarse.

## Qué cuenta como API {#what-counts-as-the-api}

Todo lo que exportan `@falkenslab/moodle-driver`, `@falkenslab/moodle-driver/internals` y `@falkenslab/moodle-driver/testing`, tal como lo describe la referencia de la API: funciones, sus parámetros y opciones, las formas devueltas, las clases de error con sus nombres y códigos, `DATA_CATEGORIES`. Los mensajes de error pueden cambiar de redacción en cualquier versión; compara los errores por clase, `name` o `code`, no por mensaje.

## Cambios en Moodle {#moodle-changes}

Una nueva versión de Moodle puede cambiar una página o un servicio que lee el driver. Las correcciones para eso llegan como versiones de parche cuando la API no cambia.
