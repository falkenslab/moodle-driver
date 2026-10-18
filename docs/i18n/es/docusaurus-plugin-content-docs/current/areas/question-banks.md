# Bancos de preguntas

Los bancos de preguntas de un curso tal como los organiza Moodle 5: los bancos compartidos son actividades en sí mismos (módulo `qbank`), y cada cuestionario tiene un banco privado. Un profesor (cualquiera que pueda gestionar las preguntas del curso) lista los bancos, lee las categorías y las preguntas de un banco, importa preguntas en GIFT o Moodle XML (un archivo o texto) y las exporta a un archivo, crea preguntas sueltas de cualquier tipo mediante el formulario de su tipo, las edita, las marca como listas o como borrador, y las borra; organiza las categorías del banco (añadiéndolas, renombrándolas, moviéndolas y borrándolas) y mueve preguntas entre ellas. Los estudiantes no tienen acceso a los bancos. Las preguntas de un banco son lo que [`addQuestionsToQuiz`](quizzes.md#addquestionstoquiz) pone en un cuestionario.

**Términos:** [banco de preguntas](../reference/glossary.md#question-bank), [categoría de preguntas](../reference/glossary.md#question-category), [slot](../reference/glossary.md#slot).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos; las primitivas de más bajo nivel están en `@falkenslab/moodle-driver/internals` (consulta [Bajar de nivel](../concepts/low-level.md)).

Un banco se identifica por el id de su actividad (`activityId`, un id del módulo del curso): el de una actividad qbank, o el del cuestionario al que pertenece el banco. En Moodle 4.x consulta [más abajo](#moodle-4x-the-courses-bank): allí el id es el del curso. Todo se lee de las páginas de los bancos de Moodle por nombres de campo, atributos data e iconos, así que funciona en cualquier idioma de la interfaz. Todas las funciones lanzan `NotLoggedInError` cuando no hay sesión; los demás errores son `QuestionBankError` y, en los formularios, `FormError` (consulta [Errores](../concepts/errors.md)).

## Primero se comprueba el módulo del banco {#the-banks-module-is-checked-first}

En Moodle 5, antes de abrir una página de un banco, `questions`, `importQuestions`, `exportQuestions`, `createQuestion`, `updateQuestion`, `deleteQuestions` y las funciones de categorías comprueban que el módulo del curso guarda preguntas (un `qbank` o un `quiz`), leyendo su módulo del formulario de ajustes, lo que no cambia nada. Esto importa: Moodle crea las categorías por defecto de un banco para cualquier actividad cuya página de banco se abra, así que abrir por error el banco de una página o de un foro dejaría categorías creadas. Un módulo que no guarda preguntas lanza `QuestionBankError` ("Activity 5 is a page, which has no question bank") sin tocarlo; un módulo que la persona no puede editar, o que no existe, también lanza un error. El módulo encontrado se recuerda por sitio e id durante el resto del programa.

## Moodle 4.x: el banco del curso {#moodle-4x-the-courses-bank}

Moodle 4.x no tiene actividades de banco: cada curso tiene su propio banco de preguntas (su página Banco de preguntas, `question/edit.php?courseid=…`), junto a los bancos compartidos de la categoría del curso y de todo el sitio, que solo pueden usar quienes tienen permisos allí (gestores, administradores). En 4.x, `questionBanks(courseId)` da solo el banco del curso, cuyo `id` es el id del curso, su `type` `"course"` y `shared` verdadero; las demás funciones toman ese id donde toman `activityId`, y trabajan con las páginas de banco de 4.x con los mismos resultados. Un programa no necesita saber en qué versión está: los ids que da `questionBanks` son los que toman las demás funciones en las dos.

Se eligió el id del curso en lugar del id del contexto del banco porque las páginas de 4.x se dirigen por curso, así que una función no necesita otra petición para averiguar a qué curso pertenece un contexto, y no hay que recordar nada entre llamadas. Lo que 4.x deja fuera de alcance así:

- Los bancos de la categoría y del sitio: sus categorías no aparecen en el banco del curso (`questions` y `questionCategories` leen solo las del curso). Trabájalos en Moodle, o importa y exporta a través del curso.
- El banco propio de un cuestionario (4.x también guarda uno por cuestionario): sus preguntas se leen a través del cuestionario ([`quizStructure`](quizzes.md#quizstructure)); el id de actividad de un cuestionario dado como el de un banco se lee como id de un curso.

La versión se sabe por si el sitio tiene el módulo `qbank` (su icono, un archivo que cualquiera puede descargar), y se pregunta una vez por sitio.

## questionBanks

Los bancos de preguntas de un curso, tal como los lista su página de bancos de preguntas: los compartidos y los propios de las actividades.

```ts
function questionBanks(context: BrowserContext, siteUrl: string, courseId: number): Promise<QuestionBank[]>;

interface QuestionBank {
  id: number;
  name: string;
  type: string;
  shared: boolean;
}
```

- `id`: el id de la actividad del banco (id del módulo del curso), que las demás funciones reciben como `activityId`; en Moodle 4.x el id del curso.
- `name`: el nombre de la actividad; en 4.x el del curso.
- `type`: el módulo, `"qbank"` en un banco compartido, `"quiz"` en el propio de un cuestionario; `"course"` en el banco del curso de 4.x.
- `shared`: las preguntas de un banco compartido se pueden usar en cualquier parte del curso; las de una actividad, solo en esa actividad.

Lanza `QuestionBankError` cuando el curso no existe o la persona no puede ver sus bancos.

## questions

Las categorías de un banco y todas sus preguntas, categoría a categoría.

```ts
function questions(context: BrowserContext, siteUrl: string, activityId: number, options?: { limit?: number; offset?: number }): Promise<{ categories: BankCategory[]; questions: BankQuestion[] }>; // questions: ListPage<BankQuestion> con limit

interface BankCategory {
  id: number;
  name: string;
}

interface BankQuestion {
  id: number;
  name: string;
  type: string;
  status?: string;
  version?: string;
  categoryId: number;
}
```

- `categories`: del filtro de categorías de la página del banco, en su orden, con los nombres sin su número de preguntas. Cada banco lista primero su categoría "Superior", que no contiene preguntas, luego la de por defecto ("Default for ..." en inglés) y las demás.
- `id`: el id de la pregunta, que es lo que recibe `addQuestionsToQuiz`.
- `type`: el tipo de pregunta, según su icono ("multichoice", "truefalse", "shortanswer", "essay"...).
- `status`: `"ready"` o `"draft"`; `version`: tal como se muestra ("v1").
- `categoryId`: la categoría en la que está.

Con `limit` y `offset`, `questions` es una página de ellas, categoría a categoría, y `categories` todas (consulta [Listas largas](../concepts/calling-functions.md#long-lists)): las categorías se leen en orden hasta llenar la página, cada una entera y luego recortada (los recuentos que muestra el filtro de categorías no son lo bastante fiables para saltarlas por ellos). Se leen hasta 1000 preguntas por categoría. Lanza `QuestionBankError` cuando el módulo no guarda preguntas (ver arriba) o la persona no puede ver su banco. Las categorías de aquí son una lista plana, solo ids y nombres: [`questionCategories`](#questioncategories) da el árbol, con el padre, la descripción y el número de preguntas de cada categoría.

## importQuestions

Importa preguntas a un banco desde un archivo GIFT o Moodle XML, o desde texto, mediante el formulario de importación del banco, y devuelve las preguntas creadas.

```ts
function importQuestions(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  options: { format: "gift" | "xml"; file?: string; text?: string; categoryId?: number },
): Promise<{ changed: string; questions: BankQuestion[] }>;
```

- `format`: `"gift"` o `"xml"` (Moodle XML).
- `file` o `text`, exactamente uno: una ruta absoluta a un archivo local, o las preguntas como texto. El texto se sube como un archivo (`questions.txt` o `questions.xml`), como lo subiría una persona, desde una carpeta temporal que se borra después.
- `categoryId`: la categoría del banco en la que importar; sin ella, la que el formulario de Moodle tenga por defecto. Si se indica, se ignoran las categorías y los contextos del propio archivo, así que todo acaba en esa categoría.

Las preguntas creadas se encuentran comparando las preguntas del banco antes y después de la importación. Cuando Moodle no puede analizar el archivo, no importa nada y muestra sus mensajes: se devuelven como un `QuestionBankError` ("Moodle didn't import the questions: No hay preguntas en el archivo de importación"). Otros errores: `QuestionBankError` cuando se indican los dos, o ninguno, de `file` y `text`, cuando no se puede importar al banco, o cuando la categoría no es del banco; un `MoodleError` cuando la ruta del archivo no es absoluta o no hay ningún archivo en ella; `FormError` cuando Moodle rechaza el formulario.

## exportQuestions

Exporta las preguntas de un banco, o las de una categoría, a un archivo local GIFT o Moodle XML, mediante el formulario de exportación del banco, y devuelve el archivo escrito.

```ts
function exportQuestions(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  options: { format: "gift" | "xml"; categoryId?: number; file: string },
): Promise<DownloadedFile>;
```

- `format`: `"gift"` o `"xml"` (Moodle XML).
- `categoryId`: la categoría que exportar, con sus subcategorías; sin ella, el banco entero (su categoría "Superior", que las contiene todas).
- `file`: una ruta absoluta, donde se escribe el archivo (su carpeta se crea si hace falta, y un archivo que ya esté ahí se sustituye).

El resultado es `{ path, name, size, contentType }`, como el que da [`downloadFile`](files.md). El formulario se envía tal como lo dejan los valores por defecto de Moodle: el archivo nombra la categoría de cada pregunta (y el banco, como `$module$`), así que importarlo sin `categoryId` vuelve a crear esas categorías, e importarlo con `categoryId` pone todas las preguntas en esa. Moodle exporta la última versión de cada pregunta y deja fuera las preguntas ocultas. El formulario se rellena en una pestaña y se envía con la sesión de la persona (la página de respuesta de Moodle convertiría la pestaña en una descarga), y el archivo se descarga desde el enlace de esa respuesta. Errores: `QuestionBankError` con otro formato, un módulo que no guarda preguntas, una persona que no puede exportar las preguntas del banco (`moodle/question:viewall`, o `viewmine` para las suyas), una categoría que no es del banco, o nada que exportar ("Moodle didn't export category 15: No hay preguntas que se puedan exportar. ..."); un `MoodleError` (`invalid-input`) cuando `file` no es absoluta.

## createQuestion

Crea una pregunta en un banco mediante el formulario de edición de su tipo y devuelve su id, de cualquier tipo que ofrezca el diálogo "Añadir una pregunta" del banco. Para varias preguntas, lo propio es importarlas; esto es para casos sueltos.

```ts
function createQuestion(context: BrowserContext, siteUrl: string, activityId: number, input: QuestionInput): Promise<{ changed: string; questionId?: number }>;

interface QuestionInput {
  type: QuestionType; // uno de QUESTION_TYPES
  name: string;
  text: string;
  answers?: { text: string; fraction: number; feedback?: string; tolerance?: number }[];
  correct?: boolean;
  pairs?: { question: string; answer: string }[];
  choose?: number;
  choices?: { text: string; group?: number; unlimited?: boolean }[];
  image?: string;
  drags?: { text?: string; image?: string; group?: number; unlimited?: boolean }[];
  markers?: { text: string; count?: number }[];
  drops?: DropZone[]; // { choice, left?, top?, label?, shape?, coords? }
  items?: string[];
  wildcards?: { name: string; min?: number; max?: number; decimals?: number; distribution?: "uniform" | "loguniform"; values?: number[] }[];
  sets?: number;
  coderunner?: { type: string; answer?: string; testCases: { code: string; expected: string; stdin?: string; extra?: string; useAsExample?: boolean; mark?: number }[] };
  formulas?: { randomVariables?: string; globalVariables?: string; parts: { answer: string; text?: string; mark?: number; unit?: string; localVariables?: string; gradingVariables?: string; gradingCriterion?: string; feedback?: string }[] };
  categoryId?: number;
  defaultMark?: number;
  fields?: Record<string, FieldValue>;
}
```

- `type`: uno de `QUESTION_TYPES`: los propios de Moodle (`multichoice`, `truefalse`, `shortanswer`, `numerical`, `essay`, `calculated`, `calculatedsimple`, `calculatedmulti`, `match`, `randomsamatch`, `ddwtos`, `ddimageortext`, `ddmarker`, `gapselect`, `multianswer`, `ordering`, `description`) y los de plugins (`coderunner`, `formulas`, `gapfill`, `ddmatch`), que se crean cuando el sitio los tiene. Los demás tipos se importan como GIFT o Moodle XML.
- `name`: el nombre de la pregunta en el banco; `text`: el enunciado de la pregunta, en HTML, con los huecos de su tipo: `[[1]]`, `[[2]]`… para las opciones de `ddwtos` y `gapselect`, las respuestas de una pregunta Cloze (`multianswer`: `{1:SHORTANSWER:=París}`), los `[huecos]` de un gap fill, los `{comodines}` de una pregunta calculada.
- `categoryId`: la categoría; sin ella, la que sigue a la "Superior" del banco (su categoría por defecto).
- `defaultMark`: la puntuación por defecto de la pregunta; si no, la de Moodle por defecto (la de una pregunta Cloze es la suma de las de sus respuestas, y una descripción no tiene).
- `fields`: cualquier otro campo del formulario del tipo, por su nombre (`{ shuffleanswers: false }`, `{ answernumbering: "none" }`), que se rellena después de los demás: lo que las entradas no modelan.

Las entradas de cada tipo; las obligatorias se comprueban antes de abrir el formulario (una lista vacía cuenta como ausente):

- `multichoice`, `shortanswer`, `numerical`: `answers`, obligatorio. `fraction` es la parte de la puntuación (1 correcta, 0 incorrecta, negativos para penalizaciones); Moodle solo ofrece calificaciones fijas (100%, 90%, 83,33%, 80%...), así que cada fracción se redondea a la más cercana que ofrezca el formulario (0,82 pasa a 83,33%). `feedback` es la retroalimentación de la respuesta (HTML); `tolerance` es el error admitido en una respuesta numérica. Una pregunta de opción múltiple con más de una respuesta con fracción mayor que 0 se crea como de respuesta múltiple (casillas), y si no, como de respuesta única.
- `truefalse`: `correct`, obligatorio: la respuesta correcta.
- `essay`, `description`, `multianswer` (Cloze), `gapfill`: solo el enunciado.
- `calculated`, `calculatedsimple`, `calculatedmulti`: `answers`, obligatorio, cada una una fórmula de los comodines (`{a} * {b}`; en `calculatedmulti`, escrita como `{={a} * {b}}`); `wildcards`, el rango de cada uno (`min`, `max`, `decimals`, `distribution`; por defecto el de Moodle, de 1 a 10) o sus `values`, uno por conjunto de valores; `sets`, cuántos conjuntos genera Moodle (10 por defecto; de 1 a 100; los `values` indicados lo fijan). Los valores indicados se escriben sobre los que genera Moodle.
- `match`, `ddmatch`: `pairs`, obligatorio: cada pregunta y su respuesta; una respuesta con la pregunta vacía es un distractor. Moodle pide al menos dos preguntas y tres respuestas.
- `randomsamatch`: `choose`, cuántas preguntas de respuesta corta de su categoría toma (la categoría debe tenerlas).
- `ddwtos`, `gapselect`: `choices`, obligatorio: `[[1]]` en el enunciado es la primera; `group` (1 por defecto) es un conjunto de opciones que van en los mismos huecos; `unlimited` (`ddwtos`) deja usar una opción más de una vez.
- `ddimageortext`: `image`, el fondo (un archivo local), `drags`, los elementos arrastrables (una palabra como `text`, o un archivo de imagen local como `image`, con `text` como su texto alternativo; `group`, `unlimited`), y `drops`, dónde van: `choice`, el número del elemento desde 1 en el orden indicado, `left` y `top`, en píxeles de la imagen, y una `label` opcional. Los tres son obligatorios.
- `ddmarker`: `image`, `markers` (cada uno con su `text`, y cuántas veces se puede colocar, `count`; sin límite por defecto) y `drops`: `choice`, el número del marcador desde 1, `shape` (`"circle"`, `"rectangle"` o `"polygon"`) y `coords` como las recibe el formulario de Moodle (un círculo `"x,y;r"`, un rectángulo `"x,y;ancho,alto"`, un polígono `"x1,y1;x2,y2;…"`), dentro de la imagen. Los tres son obligatorios.
- `ordering`: `items`, obligatorio, al menos dos, en el orden correcto.
- `coderunner`: `coderunner`, obligatorio: su `type` de pregunta (el lenguaje y cómo se ejecuta: `"python3"`, `"c_program"`…), una `answer` de ejemplo (CodeRunner la comprueba con las pruebas al guardar) y `testCases`, cada uno con su `code`, la salida `expected` y, opcionales, `stdin`, `extra`, `useAsExample`, `mark`.
- `formulas`: `formulas`, obligatorio: sus `randomVariables` y `globalVariables`, y sus `parts`, cada una con su `answer` y, opcionales, `text`, `mark`, `unit`, `localVariables`, `gradingVariables`, `gradingCriterion`, `feedback`.

Una entrada de otro tipo se rechaza (`A match question doesn't take answers: it takes pairs.`), igual que las zonas de destino que nombran un elemento que no existe y los comodines con distinto número de valores. Las filas en blanco del formulario se amplían con su botón "Espacios en blanco para más" cuando hacen falta más. Los archivos de un arrastrar y soltar sobre una imagen se suben a los selectores de archivos del formulario, y a los menús de sus zonas de destino, que el script de la página solo rellena cuando ha dibujado la imagen, se les dan los números de los elementos. Los tipos calculados ocupan más de una página: `calculatedsimple` encuentra sus comodines y genera sus conjuntos en su propia página; `calculated` y `calculatedmulti` se guardan primero y luego pasan por el asistente de Moodle (los conjuntos de datos de los comodines, privados de la pregunta, y después sus valores: los conjuntos se añaden con su botón "Añadir", de diez en diez y de uno en uno), así que una pregunta cuya página de valores falla ya está en el banco.

Los formularios de los tipos de plugins se leen por los nombres de campo que publican sus plugins; cada uno se crea, se previsualiza, se cambia y se borra en los sandboxes con los que se comprueba el driver (Moodle 4.5 y 5.2), y allí una pregunta CodeRunner se califica mediante un servidor Jobe. En un sitio sin el plugin, `createQuestion` lanza `QuestionBankError` nombrándolo ("This site has no CodeRunner question type (the qtype_coderunner plugin): its administrator would have to install it.").

`questionId` es el id que Moodle indica tras guardar; puede faltar si Moodle acaba en otra página. Errores: `QuestionBankError` para un tipo que no crea, un plugin que el sitio no tiene, una entrada obligatoria que falta o una de otro tipo, un banco que no guarda preguntas o al que no se puede añadir, o una categoría que no es del banco; `FormError` cuando el formulario no tiene ningún campo con un nombre de `fields` o Moodle rechaza los valores (un emparejamiento con muy pocas parejas, una zona de destino fuera de la imagen…), o no se puede subir un archivo.

## updateQuestion

Cambia una pregunta de un banco mediante el formulario de edición de su tipo, con las entradas de `createQuestion`, solo lo que se indique.

```ts
function updateQuestion(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  questionId: number,
  input: Partial<Omit<QuestionInput, "type">>,
): Promise<{ changed: string; questionId?: number }>;
```

- `activityId`: el banco en el que está la pregunta: la página de edición de Moodle funciona dentro de un banco (su id del módulo del curso).
- `input`: como en `createQuestion`, sin `type` (una pregunta conserva su tipo); lo que no se indica queda como está, y una entrada que el tipo de la pregunta no recibe se rechaza.
- Una lista indicada (`answers`, `pairs`, `choices`, `items`, `drags`, `markers`, `drops`, `testCases`, `parts`) es la de la pregunta a partir de ahora: las demás filas del formulario se dejan en blanco, y Moodle descarta las vacías. Una pregunta de opción múltiple pasa a ser de respuesta múltiple o de respuesta única como en `createQuestion`. `image` sustituye el fondo.
- `wildcards` y `sets` (tipos calculados): con `values`, se añaden o se borran conjuntos hasta tener tantos y se les dan esos valores; solo con rangos o `sets`, todos los conjuntos se vuelven a generar con ellos. Sin ninguno, los valores de la pregunta se quedan (`calculated` y `calculatedmulti` pasan igualmente por las páginas del asistente, como hace el formulario de Moodle).

Guardar crea una nueva versión de la pregunta, con un id propio: `questionId` es ese nuevo id, el que lista `questions` a partir de entonces (con su `version` uno más alta). Los cuestionarios que usan la última versión de la pregunta reciben la nueva; un cuestionario fijado a una versión la conserva. Errores: `QuestionBankError` cuando no se indica nada, una entrada que el tipo no recibe, un comodín que la pregunta no tiene, el banco no guarda preguntas o la pregunta no es una que la persona pueda editar ahí; `FormError` como en `createQuestion`.

## deleteQuestions

Borra preguntas de un banco, todas las versiones de cada una, como hace la acción de borrar del banco (preguntando y luego confirmando).

```ts
function deleteQuestions(context: BrowserContext, siteUrl: string, activityId: number, questionIds: number[]): Promise<{ changed: string; deleted: number[]; hidden: number[] }>;
```

Moodle no borra una pregunta que usa un cuestionario: la oculta (desaparece de la lista del banco, y los cuestionarios la conservan). `deleted` y `hidden` dicen qué ha sido de cada id, comprobado después según si la pregunta todavía se puede abrir. Lanza `QuestionBankError` con el mensaje de Moodle cuando lo rechaza (una pregunta que no existe, o que la persona no puede editar), y cuando no se indica ningún id.

## setQuestionStatus

Marca una pregunta como lista (los cuestionarios pueden usarla) o como borrador, como hace el menú de estado del banco, mediante el servicio `qbank_editquestion_set_status` de Moodle.

```ts
function setQuestionStatus(context: BrowserContext, siteUrl: string, questionId: number, status: "ready" | "draft"): Promise<{ changed: string; questionId: number; status: "ready" | "draft" }>;
```

Lanza `QuestionBankError` con otro estado, o con el motivo de Moodle cuando lo rechaza; `MoodleServiceError` cuando falla el servicio (la pregunta no existe, o la persona no puede editarla).

## Categorías {#categories}

Las preguntas de un banco se guardan en categorías, que pueden contener subcategorías. Cada banco tiene una categoría "Superior" oculta, la raíz de su árbol: sus categorías de primer nivel están dentro de ella, empezando por la de por defecto que crea Moodle ("Default for ..." en inglés). Las funciones de categorías trabajan mediante la página de categorías del banco, así que requieren la capacidad de Moodle `moodle/question:managecategory` en el banco (los profesores la tienen); sin ella lanzan `QuestionBankError` nombrándola. Una categoría que no es del banco lanza `QuestionBankError` con la lista de las del banco.

### questionCategories

Las categorías del banco tal como las muestra su página de categorías, cada padre antes de sus subcategorías.

```ts
function questionCategories(context: BrowserContext, siteUrl: string, activityId: number): Promise<QuestionCategory[]>;

interface QuestionCategory {
  id: number;
  name: string;
  parentId: number;
  description: string;
  questionCount: number;
}
```

- `parentId`: la categoría en la que está. La de una categoría de primer nivel es la "Superior" del banco, que no está en la lista (es la primera categoría que lista `questions`).
- `description`: su descripción en HTML, `""` si no tiene.
- `questionCount`: las preguntas que están directamente en ella, sin contar las de sus subcategorías.

Es una función aparte en lugar de más campos en `questions` porque el árbol sale de otra página, que requiere la capacidad de gestionar categorías: `questions` sigue funcionando para cualquiera que pueda ver el banco, y no lee ninguna página más.

### addQuestionCategory

Añade una categoría, como hace "Añadir categoría" en la página de categorías, y la devuelve.

```ts
function addQuestionCategory(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  options: { name: string; parentId?: number; description?: string },
): Promise<{ changed: string; category: QuestionCategory }>;
```

- `parentId`: la categoría en la que va; sin ella, el primer nivel.
- `description`: HTML.

Se rellena el propio formulario de la página como lo hace su diálogo (`core_form_dynamic_form` de Moodle); los rechazos de Moodle por campo se devuelven como un `QuestionBankError` ("Moodle refused the category: name: ..."). Un nombre vacío o un padre que no es del banco lanzan el error antes de enviar nada.

### editQuestionCategory

Cambia una categoría como hace su "Editar ajustes", solo lo que se indique, y la devuelve tal como queda.

```ts
function editQuestionCategory(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  categoryId: number,
  changes: { name?: string; description?: string; parentId?: number },
): Promise<{ changed: string; category: QuestionCategory }>;
```

- `name`, `description` (HTML): renombrarla, describirla.
- `parentId`: moverla, con sus subcategorías y preguntas, dentro de otra categoría; la "Superior" del banco (el `parentId` de las categorías de primer nivel) la mueve al primer nivel.

Moodle no mueve una categoría dentro de sí misma ni de una de sus subcategorías, ni la única categoría de primer nivel del banco (un banco siempre conserva una): las dos cosas lanzan `QuestionBankError`. También lo lanza no indicar nada que cambiar.

### deleteQuestionCategory

Borra una categoría, como hace su acción de borrar.

```ts
function deleteQuestionCategory(context: BrowserContext, siteUrl: string, activityId: number, categoryId: number, options?: { moveTo?: number }): Promise<{ changed: string }>;
```

- `moveTo`: la categoría del banco a la que van sus preguntas. Moodle pide una antes de borrar una categoría con preguntas (incluidas las ocultas y las que usan los cuestionarios); sin ella, la función lanza `QuestionBankError` y no se borra nada. Una categoría vacía no la necesita.

Sus subcategorías suben a su padre, como hace Moodle. Moodle conserva la única categoría de primer nivel del banco: borrarla lanza `QuestionBankError`, igual que mover las preguntas a la propia categoría.

### moveQuestions

Mueve preguntas a una categoría del banco, varias a la vez, como hace la acción en bloque "Mover a" del banco (el servicio `core_question_move_questions` de Moodle).

```ts
function moveQuestions(context: BrowserContext, siteUrl: string, activityId: number, questionIds: number[], categoryId: number): Promise<{ changed: string; questionIds: number[]; categoryId: number }>;
```

Una pregunta movida conserva su id y sus versiones, y los cuestionarios la siguen usando. Moodle comprueba cada pregunta: moverla requiere `moodle/question:moveall` (`moodle/question:movemine` para las preguntas propias de la persona) y `moodle/question:add` en el banco; un rechazo lanza `QuestionBankError` nombrándolas. Otros errores: `QuestionBankError` cuando no se indica ningún id o la categoría no es del banco; `MoodleServiceError` con el motivo de Moodle en los demás casos.

## Ejemplo {#example}

```ts

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

const banks = await moodle.questionBanks(3);
const bank = banks.find((b) => b.shared);
if (!bank) throw new Error("El curso 3 no tiene ningún banco de preguntas compartido.");

const { categories } = await moodle.questions(bank.id);
// La primera categoría es la "Superior" del banco, que no contiene preguntas: la de por defecto va después.
const target = categories[1];

const imported = await moodle.importQuestions(bank.id, {
  format: "gift",
  text: "::Rango:: range(3) termina en 2. {T}\n\n::Sangría:: Python usa la sangría para los bloques. {T}",
  categoryId: target?.id,
});
console.log(imported.changed, imported.questions.map((q) => q.id));

const created = await moodle.createQuestion(bank.id, {
  type: "multichoice",
  name: "Bucle infinito",
  text: "<p>¿Qué bucle no termina nunca?</p>",
  answers: [
    { text: "while True: pass", fraction: 1, feedback: "Correcto." },
    { text: "for i in range(3): pass", fraction: -0.5 },
  ],
  defaultMark: 2,
});
console.log(created.changed);

// Una nueva versión con un enunciado más claro, como borrador hasta revisarla; y las preguntas importadas arriba, borradas de nuevo.
if (created.questionId) {
  const updated = await moodle.updateQuestion(bank.id, created.questionId, { text: "<p>¿Cuál de estos bucles no termina nunca?</p>" });
  if (updated.questionId) await moodle.setQuestionStatus(updated.questionId, "draft");
}
const removed = await moodle.deleteQuestions(bank.id, imported.questions.map((q) => q.id));
console.log(removed.deleted, removed.hidden);

// Una categoría para los bucles, la pregunta de opción múltiple movida a ella, y la categoría guardada como Moodle XML.
const { category } = await moodle.addQuestionCategory(bank.id, { name: "Bucles", description: "<p>while y for</p>" });
if (created.questionId) await moodle.moveQuestions(bank.id, [created.questionId], category.id);
const saved = await moodle.exportQuestions(bank.id, { format: "xml", categoryId: category.id, file: "/tmp/bucles.xml" });
console.log(saved.path, saved.size);
for (const c of await moodle.questionCategories(bank.id)) console.log(c.id, c.name, c.parentId, c.questionCount);
```

## Categorías de datos {#data-categories}

- `questionBanks`, `questions`, `importQuestions`, `exportQuestions`, `createQuestion`, `updateQuestion`, `deleteQuestions`, `setQuestionStatus`, `questionCategories`, `addQuestionCategory`, `editQuestionCategory`, `deleteQuestionCategory`, `moveQuestions`: `course-content` (lo que escriben los profesores).

Consulta [Categorías de datos](../concepts/data-categories.md).
