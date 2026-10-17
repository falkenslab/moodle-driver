---
slug: /intro
sidebar_label: Introducción
---

# moodle-driver

`@falkenslab/moodle-driver` es una biblioteca de Node.js que da a un programa el control completo de un sitio Moodle como cualquier usuario, con su propio inicio de sesión: sin servicios web, sin tokens, sin administrador. La persona inicia sesión una vez, a mano, en una ventana que abre el driver (Edge, Chrome o Chromium, mediante [Playwright](https://playwright.dev)) con un perfil propio; desde ese momento el driver trabaja en el sitio con esa sesión, como lo haría la persona: lee cursos, contenidos, tareas, cuestionarios y calificaciones, publica en foros, califica entregas, crea actividades y secciones, y responde como estudiante. Todas las funciones devuelven datos simples.

![moodle-driver de un vistazo: tu programa llama al driver, que trabaja en Moodle con el inicio de sesión de la propia persona, y recibe datos simples](/img/diagrams/at-a-glance.svg)

![Lo que puede hacer como estudiante, como profesor y para tu programa](/img/diagrams/what-it-can-do.svg)

## Por qué con el inicio de sesión de la propia persona {#why-the-persons-own-login}

![Dos formas de automatizar Moodle: los servicios web necesitan un administrador y un token; moodle-driver necesita que la persona inicie sesión una vez](/img/diagrams/no-web-services.svg)

Moodle tiene una API de servicios web, pero usarla requiere un token, y muchas instituciones no habilitan los servicios web para estudiantes ni profesores, o no les dejan crear tokens. El inicio de sesión único (SAML, OAuth, CAS) lo complica aún más. Iniciar sesión, en cambio, es algo que todo usuario de Moodle ya hace.

moodle-driver inicia sesión como lo hace la persona, en una ventana del navegador, una sola vez; guarda la sesión en un perfil en disco y, a partir de ahí, llama a los mismos servicios AJAX que llaman las propias páginas de Moodle, con esa sesión, o lee y rellena las propias páginas y formularios donde ningún servicio sirve. Nunca escribe, guarda ni pide una contraseña.

## Qué cubre {#what-it-covers}

| Área | Qué puede hacer un programa |
| --- | --- |
| Cursos | Listar los cursos de la persona, leer las secciones y actividades de un curso, lo que tiene pendiente, cambiar la configuración de un curso, reiniciarlo para un nuevo curso académico; añadir, configurar, mover y eliminar los bloques de su página |
| Copia, copia de seguridad y restauración | Copiar un curso en uno nuevo, hacer una copia de seguridad (completa o parcial) en un archivo, leer lo que contiene una copia de seguridad, anonimizarla para compartirla, restaurar una copia de seguridad donde elijas, importar actividades de otro curso |
| Contenido | Leer páginas, libros, áreas de texto y medios, URL, archivos y carpetas, con sus medios |
| Construir un curso | Crear, actualizar, mover, duplicar y eliminar actividades y secciones; sus archivos, descripciones, restricciones de acceso y condiciones de finalización; leer la configuración de una actividad |
| Tareas | Hacer entregas como estudiante; leer las entregas de todos, calificar (simple, con rúbricas, con guías de evaluación, con archivos de retroalimentación, grupos enteros), el flujo de trabajo de calificación y los evaluadores, conceder ampliaciones del plazo como profesor |
| Cuestionarios | Hacer un intento de un cuestionario página a página; leer resultados y estadísticas, calificar ensayos a mano; leer, añadir, quitar, mover y paginar las preguntas del cuestionario; fijar excepciones |
| Bancos de preguntas | Listar bancos y preguntas, importar y exportar GIFT o Moodle XML, crear, editar y eliminar preguntas sueltas, organizar las categorías y mover preguntas entre ellas |
| Foros | Leer debates y mensajes, responder, abrir debates, editar y eliminar mensajes, fijar y bloquear, calificar el foro en su conjunto, valorar mensajes (y entradas de glosario, registros de bases de datos) |
| Talleres | Leer la fase de un taller, sus entregas y evaluaciones, cambiar su fase, asignar revisores (a mano, al azar, programada), evaluar una entrega, entregar, preparar y evaluar envíos de ejemplo, calcular y anular las calificaciones |
| Encuestas y consultas | Responder cuestionarios de encuesta, actividades de retroalimentación y consultas; leer las respuestas de todos, y construir las preguntas y plantillas de una retroalimentación, como profesor |
| Bases de datos | Dar a una actividad de base de datos sus campos, plantillas y preajustes; leer, añadir, editar, aprobar y eliminar sus entradas, exportarlas e importarlas como CSV |
| Glosarios | Leer, añadir, cambiar y eliminar entradas, aprobarlas, añadir categorías, exportar e importar entradas en el XML de Moodle |
| Lecciones, H5P y SCORM | Recorrer una lección página a página; leer el tipo y los intentos de una actividad H5P; leer los intentos y los SCO de un SCORM, abrir su reproductor, crear uno a partir de un paquete |
| Calificaciones | Las calificaciones de la persona, el informe del calificador y las exportaciones de calificaciones de Moodle, calificar y anular calificaciones en el libro de calificaciones, la configuración del libro de calificaciones (elementos manuales, categorías, ponderaciones), importaciones CSV, escalas y letras de calificación |
| Finalización, insignias y competencias | Marcar actividades como hechas, anular la finalización, leer el informe de progreso; insignias del curso: crearlas, fijar sus criterios, habilitarlas, otorgarlas a mano; competencias: añadirlas a un curso, vincularlas a actividades, valorar a los participantes |
| Personas | Participantes con sus roles y grupos, inactividad; matricular y desmatricular, asignar roles, grupos y agrupamientos, métodos de matriculación, anotaciones sobre ellos; enviar un mensaje a varios a la vez |
| Registros e informes | Los registros de un curso por usuario, actividad, acción y fecha; las visitas por actividad; quién participó en una actividad |
| Vista general | La vista general de actividades, fechas límite, novedades del curso |
| Calendario y mensajes | Eventos del curso (crear, cambiar, eliminar); notificaciones, conversaciones, mensajes privados |
| Sesión y sitio | Iniciar sesión a mano, cerrar sesión, quién es la persona, la información pública del sitio |

## Para quién es {#who-its-for}

Programas que trabajan en Moodle por una persona: un asistente que califica o responde en los foros por un profesor, un ayudante de estudio para un estudiante, un script que exporta o importa actividades, una herramienta de seguimiento. Su primer consumidor es moodle-mcp, un servidor MCP que permite a agentes de IA trabajar en Moodle; el driver en sí no sabe nada de MCP ni de agentes.

## Un primer vistazo {#a-first-look}

```ts
import { createMoodle } from "@falkenslab/moodle-driver";

// `await using` cierra el navegador cuando termina el programa, también si hay un error.
await using moodle = createMoodle({
  site: "https://campus.example.org/",
  profileDir: "/home/me/.moodle-profile",
  headless: true,
  downloadBrowser: true,
});

// La primera vez se abre una ventana en la página de inicio de sesión y espera a que la persona inicie sesión allí.
await moodle.logIn();

const courses = await moodle.listCourses();
for (const course of courses) console.log(course.id, course.fullname);
```

## Por dónde seguir {#where-to-go-next}

- [Instalación](getting-started/installation.md): requisitos y el navegador que usa.
- [Iniciar sesión](getting-started/logging-in.md): perfiles, sesiones y ventanas.
- [Tu primer programa](getting-started/first-program.md): un script completo, paso a paso.
- [Cómo funciona](concepts/how-it-works.md): servicios, páginas y por qué el driver lee Moodle como lo hace.
- [La línea de comandos](getting-started/command-line.md): cada operación como un comando `moodle`, sin escribir un programa.
- [Ejemplos](examples/index.md): programas completos para tareas reales, como estudiante, como profesor y para tu programa, comentados paso a paso.
- [Áreas de Moodle](areas/courses.md): una página por área, con todas sus funciones.
- [Glosario](reference/glossary.md): los términos de Moodle (entrega, intento, posición (slot), excepción…) explicados para programadores.
- La referencia de la API, generada a partir del código, en la barra superior.
