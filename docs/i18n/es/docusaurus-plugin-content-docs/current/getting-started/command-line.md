# La línea de comandos

Cada operación del driver es también un comando de `moodle`, para probarla, usarla en scripts desde una shell o comprobar algo en un sitio sin escribir un programa. Viene con el paquete y no necesita nada más.

**Términos:** [sitio](../reference/glossary.md#site), [perfil](../reference/glossary.md#profile), [categoría de datos](../reference/glossary.md#data-category), [changed](../reference/glossary.md#changed).

## Instalar {#install}

En cualquier lugar, como un comando de tu sistema:

```bash
npm i -g @falkenslab/moodle-driver

# O desde un clon, para seguir main
git clone https://github.com/falkenslab/moodle-driver.git
cd moodle-driver && npm install && npm link
```

`npm i -g github:falkenslab/moodle-driver` no funciona: npm compila un paquete instalado desde git con sus dependencias de desarrollo, y una instalación global las pone en el sitio equivocado (un fallo de npm, no del driver). `npm link` desde un clon lo compila donde está. npm 11 puede avisar de los scripts del paquete (`install-scripts`): no hace falta ejecutar nada, el comando funciona tal cual.

En un proyecto que ya usa la biblioteca, también está ahí: `npx moodle …` lo ejecuta desde `node_modules/.bin`, útil para ver qué devuelve una función mientras escribes tu programa. Sin instalar nada: `npx -p @falkenslab/moodle-driver moodle …`.

El paquete de npm `moodle-cli` (otro proyecto) también instala un comando llamado `moodle`: con ambos instalados globalmente, npm rechaza el segundo.

## Iniciar sesión una vez {#log-in-once}

```bash
moodle login --site https://campus.example.org/
```

Se abre una ventana del navegador en la página de inicio de sesión del sitio; inicia sesión allí como siempre (inicio de sesión único y doble factor incluidos). El comando recuerda el sitio y guarda la sesión en un perfil del navegador propio, uno por sitio, en `~/.moodle-driver` (consulta [Dónde está cada cosa](#where-things-are)). A partir de ahí, sin ventana y sin `--site`:

```bash
moodle who-am-i
moodle list-courses
moodle my-grades 3
```

Cuando Moodle cierra la sesión, un comando responde `not-logged-in` y `moodle login` vuelve a abrir la ventana.

## Comandos, argumentos y opciones {#commands-arguments-and-options}

Un comando es un método del [objeto Moodle](../concepts/calling-functions.md), en kebab-case o tal como se escribe el método: `moodle list-courses` y `moodle listCourses` son lo mismo. Sus argumentos van en orden, y sus opciones como `--name value`:

```bash
moodle course-structure 3 --details
moodle grade-submission 35 7 --grade 8.5 --feedback "<p>Bien argumentado.</p>" --notify
moodle participants 3 --role 5 --inactive-since 2026-10-01
moodle save-submission 45 --files factorial.py,notes.md --online-text "<p>Hecho.</p>"
moodle call-service core_course_get_recent_courses --limit 5
```

- Los números, las fechas (`2026-11-30`, `2026-11-30T18:00:00Z`), las listas (`1,2,3`, o la opción repetida) y los interruptores (`--notify`, `--no-notify` o `--notify=false`) se convierten según los recibe cada parámetro; un valor fuera de una lista de opciones indica cuáles son válidos.
- Los archivos locales pueden ser relativos: se toman de la carpeta actual. `download-file` guarda en la carpeta actual salvo que se le indique otra.
- Un argumento que es un objeto o una lista de objetos va como JSON: `moodle answer-choice 40 2,3`, `moodle submit-survey 34 '{"textfield_12":"Claro"}'`.
- `--json '{…}'` da todo el objeto de opciones de una vez, para lo que resulta incómodo con flags.

`moodle help` lista todos los comandos con lo que hace cada uno; `moodle help <command>` (o `--help` detrás de él) muestra sus argumentos, sus opciones y los datos que toca. La [referencia de comandos](../reference/commands.md) los tiene todos.

## Qué imprime {#what-it-prints}

En un terminal, los resultados salen como tablas y líneas clave-valor, y las escrituras dicen primero qué han cambiado:

```text
$ moodle list-courses
id  shortname  fullname          category    url                                       visible
--  ---------  ----------------  ----------  ----------------------------------------  -------
3   loops      Loops in Python   Computing   https://campus.example.org/course/view…   true

$ moodle set-completion 42 true
✔ Activity 42 marked done.
```

Con `--json`, o cuando la salida va a una tubería o a un archivo, imprime exactamente lo que devuelve el método, como JSON:

```bash
moodle deadlines --days 7 --json | jq -r '.[] | "\(.date[0:10]) \(.activity)"'
moodle grader-report 3 > grades.json
```

Los errores van a la salida de error estándar como `code: message` (los [códigos de error](../concepts/errors.md)), con estado de salida 1; una línea de comandos que no encaja sale con 2 y dice qué encajaría.

## Opciones globales {#global-options}

| Opción | Qué hace |
| --- | --- |
| `--site <url>` | El sitio Moodle; o `MOODLE_SITE`; se recuerda tras `moodle login` |
| `--as <name>` | El perfil en el sitio, por nombre; o `MOODLE_AS`; el predeterminado del sitio si no se indica |
| `--profile <dir>` | Una carpeta de perfil del navegador propia, por encima de todo lo demás; o `MOODLE_PROFILE` |
| `--json` | Imprime JSON incluso en un terminal |
| `--show` | Muestra el navegador mientras trabaja el comando (consulta [El navegador](../concepts/browser.md)) |
| `--allow <categories>` | Rechaza los comandos que tocan otras [categorías de datos](../concepts/data-categories.md): `--allow own,course-content` lee tus propios datos y los cursos, nada sobre los demás |
| `--help`, `--version` | La ayuda y la versión del driver |

## Una sesión interactiva {#an-interactive-session}

Cada `moodle …` abre el navegador, trabaja y lo cierra, así que con `--show` la ventana solo vive mientras se ejecuta ese comando. `moodle shell` mantiene un navegador abierto mientras escribes comandos uno tras otro, cada uno como lo ejecutaría `moodle <command>`, sin el `moodle` delante:

```text
$ moodle shell --show
moodle campus.example.org a.martin> list-courses
id  shortname  fullname          …
3   loops      Loops in Python   …
moodle campus.example.org a.martin> course-structure 3
…
moodle campus.example.org a.martin> activity-settings 57
…
moodle campus.example.org a.martin> exit
```

- Acepta las opciones globales (`--site`, `--as`, `--profile`, `--show`, `--allow`, `--json`), que valen para todas las líneas; una línea puede añadir aún las suyas, como `list-courses --json`.
- Con `--show` la ventana se abre al momento y sigue abierta; cada página que abre un comando pasa al frente de su pestaña (consulta [El navegador](../concepts/browser.md)). Los comandos que solo llaman a los servicios de Moodle, como `list-courses` y `course-structure`, no abren ninguna página. `show` y `hide` abren y cierran la ventana durante la sesión.
- Un comando que falla imprime su error y la sesión continúa. `exit`, `quit` o Ctrl+D salen, cerrando el navegador y guardando la sesión; Ctrl+C borra la línea que se está escribiendo. El estado de salida es 0.
- `help` lista los comandos, y `help <command>` explica uno. El tabulador completa los nombres de los comandos y las opciones de un comando; las líneas escritas se guardan en `~/.moodle-driver/history` para las flechas del teclado.
- `sites`, `forget` y `login` funcionan dentro. `login --as <name>` continúa con el perfil con el que se ha iniciado sesión, y `use <site>` (o `use --as <name>`) pasa a trabajar en otro sitio o perfil; cualquiera de los dos cierra el navegador y lo abre con el nuevo perfil.
- Las líneas se dividen como las divide una shell: las comillas mantienen juntos los espacios y el JSON (`submit-survey 34 '{"textfield_12":"Claro"}'`), y una barra invertida solo escapa un espacio, una comilla u otra barra invertida, así que las rutas de Windows van tal como se escriben.

Las líneas también pueden venir de un archivo o de una tubería (`moodle shell < monday.txt`): entonces no hay prompt, y la sesión termina con la entrada. Con un [navegador en segundo plano](#watching-separate-commands-act) abierto en el perfil, la shell trabaja en él, una línea cada vez.

## Ver actuar comandos separados {#watching-separate-commands-act}

`moodle open` deja un navegador abierto en segundo plano en el perfil, y todos los comandos de ese perfil, desde cualquier terminal o script, trabajan en él en lugar de lanzar el suyo; `moodle close` lo cierra y guarda la sesión. Con `--show` tiene una ventana, donde las páginas de cada comando pasan al frente de su primera pestaña:

```bash
moodle open --show                 # se abre una ventana, y se queda
moodle list-courses                # desde cualquier terminal: no se lanza ningún navegador
moodle activity-settings 57        # su formulario aparece en la ventana
moodle close
```

- Los comandos se turnan: uno trabaja con el navegador en segundo plano cada vez, y otro espera unos segundos y luego responde `browser-busy`.
- `moodle sites` indica qué perfiles tienen uno en marcha (`background`). Sin él, cada comando lanza su propio navegador, como siempre.
- Si su proceso ya no existe (el ordenador se reinició o cerraste la ventana), el siguiente comando lo nota, elimina lo que dejó y lanza el suyo.

### Su seguridad {#its-security}

Un navegador que otros programas pueden manejar es, mientras se ejecuta, tan poderoso como tu sesión iniciada. Por eso el comando no abre el puerto de depuración del propio Chromium, que cualquier programa del ordenador podría usar sin preguntar. El navegador solo habla con el proceso en segundo plano del comando, por una tubería; ese proceso acepta conexiones solo en 127.0.0.1 (nunca desde la red), y solo con un token aleatorio que escribe, junto con la dirección, en el `.browser.json` del perfil, legible solo por ti (en Linux y macOS; en Windows, tu carpeta de usuario ya lo es). Rechaza de plano las páginas web. Un programa tuyo puede compartir el navegador con `backgroundBrowser(profileDir)` y `connectBrowserManager()` (consulta [El navegador](../concepts/browser.md#a-browser-left-open-in-the-background)). Usa `moodle close` cuando termines.

## Varios sitios y cuentas {#several-sites-and-accounts}

Inicia sesión en cada sitio una vez; el último es el predeterminado, y `--site` (o `MOODLE_SITE`) elige otro para un comando. `moodle login` en un sitio cuya sesión sigue viva no abre ninguna ventana: solo hace que ese sitio sea el predeterminado.

```bash
moodle login --site https://campus.uni-a.es/
moodle login --site https://aulavirtual.uni-b.es/
moodle --site https://campus.uni-a.es/ list-courses
```

Cada cuenta en un sitio tiene su propio perfil, con su propia sesión, y un nombre: el primer inicio de sesión le pone el nombre de usuario de Moodle de la persona (`profiles/a.martin/`). El perfil con el que se inició sesión por última vez es el predeterminado del sitio, indicado en su `site.json`. Para otra cuenta en el mismo sitio (un profesor y un estudiante, por ejemplo), vuelve a iniciar sesión con un nombre que elijas; `--as` (o `MOODLE_AS`) elige uno para un comando.

```bash
moodle login --site https://campus.uni-a.es/            # perfil "a.martin", el predeterminado
moodle login --site https://campus.uni-a.es/ --as student   # perfil "student", ahora el predeterminado
moodle --as a.martin who-am-i
moodle login --as a.martin                               # a.martin vuelve a ser el predeterminado
```

`moodle sites` lista todos los sitios y perfiles: cuál es el predeterminado y si tiene un archivo de sesión (puede que Moodle ya haya cerrado la sesión), y si hay un navegador en segundo plano en marcha en él. Olvidar un perfil cierra antes su navegador en segundo plano. `moodle forget <site>` borra un sitio con sus perfiles y sesiones, y `moodle forget <site> --as <name>` un perfil; olvidar el predeterminado deja el sitio sin ninguno hasta el siguiente `login` (o un `--as`).

```text
$ moodle sites
site                            profile   default  session  background  path
------------------------------  --------  -------  -------  ----------  --------------------------------------------------------------
https://aulavirtual.uni-b.es/   ada       true     true     false       /home/ada/.moodle-driver/sites/aulavirtual.uni-b.es/profiles/ada
https://campus.uni-a.es/        a.martin  false    true     true        /home/ada/.moodle-driver/sites/campus.uni-a.es/profiles/a.martin
https://campus.uni-a.es/        student   false    true     false       /home/ada/.moodle-driver/sites/campus.uni-a.es/profiles/student
```

## Dónde está cada cosa {#where-things-are}

Todo está en `~/.moodle-driver`, igual en Windows, Linux y macOS (`MOODLE_DRIVER_HOME` lo traslada, por ejemplo para tenerlo bajo `~/.config` o en el disco de datos de un servidor):

```text
~/.moodle-driver/
├── config.json                  el sitio predeterminado
├── history                      las líneas escritas en `moodle shell`
└── sites/<host>/                una carpeta por sitio (localhost:8080 es localhost_8080)
    ├── site.json                su URL y su perfil predeterminado por nombre
    └── profiles/<name>/         un perfil del navegador por cuenta, con su sesión (moodle-session.json),
                                 con el nombre de usuario de Moodle o el de --as;
                                 .browser.json mientras `moodle open` mantiene un navegador en él,
                                 .browser.lock mientras un comando trabaja con ese navegador
```

Trata `~/.moodle-driver` como tratarías un navegador con la sesión iniciada: sus perfiles guardan las sesiones. En Linux y macOS sus archivos solo los puedes leer tú.

Un programa que usa la biblioteca puede compartir las sesiones del comando: `siteProfileDir(site)` da el perfil predeterminado del sitio (o `siteProfileDir(site, { as: "student" })` uno con nombre), para pasarlo como `profileDir`. Un perfil solo lo usa un navegador cada vez, así que no mientras un comando se está ejecutando en él.

## Como estudiante, como profesor {#as-a-student-as-a-teacher}

```bash
# La semana de un estudiante
moodle deadlines --days 7
moodle pending-activities 3
moodle activity-content 57 folder --trail fast
moodle download-file https://campus.example.org/pluginfile.php/88/mod_resource/content/1/slides.pdf

# La mañana de un profesor
moodle assignment-submissions 35 --no-include-content
moodle grade-submission 35 7 --grade 9 --feedback "<p>Muy bien.</p>" --notify
moodle grant-extension 35 7 2026-11-30T23:59:00Z
```

Los [ejemplos](../examples/index.md) hacen esto como programas; cualquiera de sus pasos puede probarse antes como comando.
