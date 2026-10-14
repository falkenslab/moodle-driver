# Escribir a los estudiantes inactivos {#message-inactive-students}

Un programa para un profesor que busca a los estudiantes que llevan un número de días sin abrir un curso, envía a cada uno un mensaje privado y después imprime un resumen. Por defecto solo los enumera: envía cuando se ejecuta con `--send`.

**Usa:** [participantes](../areas/participants.md), [mensajes](../areas/messages.md).

## El programa {#the-program}

```ts
import { createMoodle, MessageError } from "@falkenslab/moodle-driver";

const COURSE_ID = 3; // course/view.php?id=3, o listCourses()
const STUDENT_ROLE_ID = 5; // Estudiante en un sitio por defecto: el programa lo comprueba contra los roles del curso
const DAYS = 14;
// Un ensayo salvo que se pida: los mensajes no se pueden retirar.
const send = process.argv.includes("--send");

await using moodle = createMoodle({ site: "https://campus.example.org/", profileDir: "/home/teacher/.moodle-profile", headless: true, downloadBrowser: true });
await moodle.logIn();

// Los nombres de los roles están en el idioma del sitio; lo que filtra es el id, así que comprueba que es un rol de este curso.
const { roles } = await moodle.participantFilters(COURSE_ID);
const role = roles.find((r) => r.id === STUDENT_ROLE_ID);
if (!role) throw new Error(`No hay rol ${STUDENT_ROLE_ID} en el curso ${COURSE_ID}; sus roles: ${roles.map((r) => `${r.id} ${r.name}`).join(", ")}`);

// El filtro "Inactivo durante más de" de la página de participantes, combinado con el rol.
const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
const inactive = await moodle.participants(COURSE_ID, { role: role.id, inactiveSince: since });
console.log(`${inactive.length} participantes con rol ${role.name} no han entrado al curso ${COURSE_ID} en ${DAYS} días.`);

const courseUrl = new URL(`course/view.php?id=${COURSE_ID}`, moodle.site).href;
const sent: string[] = [];
const failed: string[] = [];
for (const student of inactive) {
  if (!send) {
    console.log(`  se escribiría a ${student.fullName} (${student.userId})`);
    continue;
  }
  const text = `<p>Hola, ${student.fullName}:</p><p>Hace tiempo que no te vemos por el curso. Los últimos materiales están en <a href="${courseUrl}">${courseUrl}</a>. Escríbeme si algo te lo está poniendo difícil.</p>`;
  try {
    // Un mensaje privado, como lo envía el panel de mensajería: aparece en la conversación al instante.
    await moodle.sendMessage(student.userId, text);
    sent.push(student.fullName);
  } catch (error) {
    // Moodle no lo entregó (el estudiante bloquea los mensajes, por ejemplo): se anota y se sigue.
    if (error instanceof MessageError) failed.push(`${student.fullName}: ${error.message}`);
    else throw error;
  }
}

if (send) {
  console.log(`Enviados ${sent.length}, fallidos ${failed.length}.`);
  for (const line of failed) console.log(`  ${line}`);
} else {
  console.log("Ensayo: no se ha enviado nada. Ejecútalo con --send para enviar los mensajes.");
}
```

## Paso a paso {#step-by-step}

1. `COURSE_ID` es el id del curso (su URL, o `listCourses()`). `STUDENT_ROLE_ID` es el id del rol Estudiante: 5 en un sitio por defecto, pero los sitios pueden variar, así que el programa lo comprueba contra los roles que `participantFilters` lee de la página de participantes del curso. Los nombres de los roles llegan en el idioma del sitio ("Student", "Estudiante"), y por eso el programa filtra por id y solo imprime el nombre.
2. `logIn()` vuelve al instante con una sesión guardada, o abre una ventana para que el profesor inicie sesión la primera vez.
3. `participants` con `role` e `inactiveSince` pide a la tabla de participantes de Moodle los que tienen ese rol y no han entrado al curso desde esa fecha, como hace el filtro "Inactivo durante más de" de la página.
4. Sin `--send`, el programa imprime a quién se escribiría y se detiene ahí: ejecútalo así primero y lee la lista.
5. Con `--send`, `sendMessage` envía a cada estudiante un mensaje privado del profesor. Aparece al instante en el panel de mensajes del estudiante, y Moodle le avisa según sus preferencias de notificación (una ventana emergente, un correo). Cada mensaje es una conversación aparte con ese estudiante.
6. Un mensaje que Moodle no entrega lanza `MessageError` con el motivo de Moodle; el programa los reúne y sigue con el resto, y después imprime el resumen.

## Lo que imprime {#what-it-prints}

Un ensayo de ejemplo, y después el envío real:

```text
3 participantes con rol Estudiante no han entrado al curso 3 en 14 días.
  se escribiría a Alan Turing (9)
  se escribiría a Grace Hopper (12)
  se escribiría a Edsger Dijkstra (15)
Ensayo: no se ha enviado nada. Ejecútalo con --send para enviar los mensajes.
```

```text
3 participantes con rol Estudiante no han entrado al curso 3 en 14 días.
Enviados 2, fallidos 1.
  Edsger Dijkstra: Moodle didn't send the message to user 15: El usuario al que intenta enviar un mensaje le ha bloqueado.
```

## Variaciones {#variations}

- Solo un grupo: añade `group` sacado de `participantFilters(COURSE_ID).groups` o de `groups(COURSE_ID)`: `participants(COURSE_ID, { role: role.id, group: 21, inactiveSince: since })`.
- Los estudiantes que no han entrado nunca están en la misma lista; para distinguirlos el programa necesitaría las fechas del último acceso, que el driver deja fuera de los participantes a propósito.
- Usar el nombre de pila: Moodle solo da el nombre completo; un programa que quiera el nombre de pila lo separa él mismo, sabiendo que puede equivocarse con algunos nombres.
- Dejar que el profesor elija el rol: imprime `roles` y toma el id de la línea de órdenes en vez de una constante.

## Cuando algo sale mal {#when-something-goes-wrong}

- `NoParticipantsError`: el profesor no puede ver los participantes del curso, o el curso no existe. Comprueba `COURSE_ID`.
- `MessageError`: Moodle no entregó un mensaje, con su motivo (el estudiante bloquea los mensajes de quien no es contacto, o la mensajería está desactivada en el sitio). También antes de enviar, cuando un mensaje está vacío.
- `NotLoggedInError`: la sesión caducó; vuelve a ejecutarlo para iniciar sesión. Consulta [Errores](../concepts/errors.md).

## Datos que toca {#data-it-touches}

`participants` es `others-personal` y `participantFilters`, `course-content`; `sendMessage` es `communication`: el programa escribe a otras personas en nombre del profesor, y por eso hace un ensayo salvo que se le diga lo contrario. Consulta [Categorías de datos](../concepts/data-categories.md).
