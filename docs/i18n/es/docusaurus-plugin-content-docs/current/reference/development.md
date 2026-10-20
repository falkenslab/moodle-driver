# Desarrollo

Cómo trabajar en el propio driver. El `CLAUDE.md` y `.minispec/` del repositorio contienen las convenciones y el diseño.

## Comandos {#commands}

```bash
npm install
npm run typecheck
npm run lint
npm run test:docker   # todas las pruebas, en Docker
npm run test:sandbox  # la batería de regresión contra el sandbox de Moodle
npm run build         # dist/, con declaraciones
npm run docs:install  # las dependencias del sitio de documentación
npm run docs:start    # el sitio en localhost, en vivo
npm run cli:generate  # la tabla y la referencia del comando moodle, tras un cambio en la API
npm run docs:check    # todos los programas de las guías compilan contra el código
npm run docs:build    # el sitio, tal como se publica
```

`npm publish` ejecuta antes la comprobación de tipos, el lint, la comprobación de los ejemplos y las pruebas en Docker (`prepublishOnly`): no se publica nada si no pasan, así que Docker tiene que estar en marcha.

## Las pruebas se ejecutan en Docker {#tests-run-in-docker}

Las pruebas lanzan navegadores reales contra el Moodle simulado, un archivo cada vez. Solo se ejecutan en Docker (`scripts/in-docker.mjs`, la imagen de Playwright), nunca en el escritorio del desarrollador, donde abrirían ventanas. Un archivo:

```bash
MSYS_NO_PATHCONV=1 node scripts/in-docker.mjs npx tsx --test test/areas/quizzes/attempts.test.ts
```

(`MSYS_NO_PATHCONV=1` es para Git Bash en Windows). El contenedor guarda su propio `node_modules` en un volumen, que se reinstala cuando cambia el archivo de bloqueo.

## Un Moodle real {#a-real-moodle}

El Moodle simulado representa lo que lee el driver, pero solo un sitio real lo confirma. El sandbox de Moodle (un repositorio hermano, `../moodle-sandbox`) ejecuta Moodle 5.2 en Docker con un curso de demostración, un profesor y estudiantes. Cuando está en marcha, `scripts/in-docker.mjs` se une a su red y redirige `localhost:8080` dentro del contenedor, para que un script de prueba pueda llamar al driver contra él sin ventana, con perfiles en los que se ha iniciado sesión una vez.

`npm run test:sandbox` es la batería de regresión contra él: todas las funciones exportadas, como estudiante, como profesor y como administrador.

```bash
npm run test:sandbox                                      # todos los archivos de test/sandbox/
npm run test:sandbox -- test/sandbox/forums.sandbox.ts    # algunos
npm run test:sandbox -- test/sandbox/forums.sandbox.ts --grep "forumGrades"  # solo las pruebas cuyo nombre coincide
npm run test:sandbox -- --browser firefox                 # en el Firefox de Playwright en vez de su Chromium
```

La batería también se ejecuta en los runners de GitHub, no en tu máquina: el workflow **Sandbox suite** (`.github/workflows/sandbox.yml`) levanta un sandbox 5.2 y otro 4.5 (este con el tema Classic) a partir de las imágenes publicadas y ejecuta la batería contra cada uno, guardando su registro como artefacto. Lánzalo desde la pestaña Actions (versión, archivos, `--grep` y el navegador como entradas) o sube una rama llamada `sandbox-run/<lo que sea>` para ejecutarlo todo (`sandbox-run/firefox-<lo que sea>` en Firefox). El curso de contenido solo existe en el sandbox 5.2 local, así que allí fallan sus lecturas.

- Las cuentas se leen del sandbox cuando empieza la batería (`node manage.mjs info --json`; `MOODLE_SANDBOX_DIR` apunta a otro sitio) en una carpeta temporal que solo puedes leer tú, borrada al final. No se imprime ni se guarda ninguna contraseña. Los perfiles del navegador de las cuentas se quedan en `~/.moodle-driver-sandbox` (una carpeta por checkout; `MOODLE_SANDBOX_PROFILES` la traslada), para que las ejecuciones siguientes no vuelvan a iniciar sesión: contienen las cookies de sesión del sandbox, nada más.
- El curso 3 es el curso de contenido y solo se lee; el propio curso del sandbox (2) no se usa nunca. Las escrituras se hacen en un curso de pruebas que crea cada archivo ("Driver check …") y que luego borra, y cada prueba elimina lo que ha creado.
- El sandbox ejecuta el cron de Moodle en un contenedor propio, cada minuto, para que las copias, las copias de seguridad y las restauraciones terminen como en un sitio real.
- Los nombres de las pruebas empiezan por la función que ejercitan (`courseStructure: …`). Al final, un resumen lista, por función, las superadas, las fallidas o las omitidas con su motivo, y la ejecución completa falla cuando una función exportada no está en ninguna prueba, o una omisión no da motivo.

Se ejecuta bajo demanda, cuando quieres saber si el driver sigue funcionando en un Moodle real (después de cambiar cómo lee Moodle un área, o la versión de Moodle): tarda horas, así que no forma parte de ninguna release ni de ningún `npm publish`.

## Convenciones {#conventions}

- Todo en inglés: código, comentarios, documentación, mensajes de commit; las guías de la web tienen además su traducción al español (ADR-015).
- Una función recibe el contexto del navegador y el sitio, después los ids y después las opciones; devuelve datos simples.
- Toda página que lee una función se abre con `openSitePage()`; los servicios pasan por `callService()`.
- Lee Moodle por estructura (ids, atributos de datos, nombres de campos, ids del body, URL), nunca por el texto visible.
- El código de página con funciones auxiliares pasa por `inPage()`.
- Los errores con los que un programa puede hacer algo tienen su propia clase, con mensajes en términos de Moodle.
- La biblioteca nunca imprime, no lee variables de entorno y no sabe nada de sus consumidores.
- Toda función pública declara sus categorías de datos en `src/categories.ts`; una prueba lo exige.
- Toda función lleva un comentario de documentación: la [referencia de la API](https://falkenslab.github.io/moodle-driver/api) se genera a partir de ellos.

## Documentación {#documentation}

Este sitio vive en `docs/` (Docusaurus). Las guías son Markdown en `docs/content/`, una línea por párrafo; la referencia de la API la genera TypeDoc a partir de `src/index.ts` y `src/testing/index.ts` en cada compilación. Un cambio que notaría un programa que usa el driver actualiza en el mismo commit la guía que lo describe. El sitio se publica en GitHub Pages con cada push a `main`.
