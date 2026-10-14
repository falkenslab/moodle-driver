# Instalación

El driver es una biblioteca de Node.js con una única dependencia peer, `playwright-core`, que maneja el navegador.

## Requisitos {#requirements}

- Node.js 20 o posterior.
- Un sitio Moodle en el que la persona pueda iniciar sesión, Moodle 4.x o 5.x (desarrollado y comprobado con la 5.2; consulta [Compatibilidad](../reference/compatibility.md)).
- Un navegador: Microsoft Edge o Google Chrome instalado en el sistema, o permiso para descargar el Chromium de Playwright (unos 180 MB) la primera vez.
- Una pantalla, la primera vez, para que la persona inicie sesión a mano en una ventana del navegador. A partir de ahí el driver funciona sin ventana (headless), también en servidores y contenedores.

## Instalar {#install}

Desde npm, con su única dependencia peer:

```bash
npm install @falkenslab/moodle-driver playwright-core
```

Cada [release de GitHub](https://github.com/falkenslab/moodle-driver/releases) incluye también el paquete, ya compilado, como un `.tgz` (`npm install <su URL>`). O desde un clon, para seguir `main` o modificar el driver:

```bash
# Desde un clon, junto a la carpeta de tu programa
git clone https://github.com/falkenslab/moodle-driver.git
cd moodle-driver && npm install && npm run build
```

```json
{
  "dependencies": {
    "@falkenslab/moodle-driver": "file:../moodle-driver",
    "playwright-core": "^1.64.0"
  }
}
```

`npm install` compila la biblioteca (`prepare` ejecuta `npm run build`), así que una dependencia `file:` funciona tal cual. Después de cambiar el código fuente del driver, vuelve a ejecutar `npm run build` en él para que tu programa vea el cambio.

## El navegador {#the-browser}

El driver usa `playwright-core`, que no trae ningún navegador propio. Busca uno en este orden:

1. Microsoft Edge (`msedge`), instalado en la mayoría de los ordenadores con Windows.
2. Google Chrome (`chrome`).
3. El Chromium de Playwright (`chromium`), que se descarga la primera vez que hace falta cuando `downloadBrowser` es `true`.

Puedes forzar uno con la opción `channel` de `createBrowserManager`. Mientras Chromium se descarga, las llamadas fallan al momento con `BrowserDownloadingError` (la descarga sigue en segundo plano); vuelve a intentarlo un minuto o dos después. `chromiumDownload()` del gestor del navegador indica si se está descargando o si ha fallado. Consulta [El navegador](../concepts/browser.md).

Chromium se guarda donde Playwright guarda sus navegadores: `PLAYWRIGHT_BROWSERS_PATH` si está definida y, si no, la caché `ms-playwright` del usuario.

## Dos puntos de entrada {#two-entry-points}

| Importación | Qué contiene |
| --- | --- |
| `@falkenslab/moodle-driver` | La biblioteca: el gestor del navegador, el inicio de sesión, todas las áreas de Moodle, los errores, las categorías de datos |
| `@falkenslab/moodle-driver/testing` | Utilidades para probar un programa que usa el driver sin un Moodle real: un Moodle simulado servido dentro de un contexto del navegador, un gestor del navegador que no lanza nada |

Ambos son ESM con declaraciones de TypeScript.

## Siguiente paso {#next}

[Inicia sesión](logging-in.md) una vez y luego escribe [tu primer programa](first-program.md).
