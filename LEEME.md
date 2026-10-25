# NoviQ 4.7: agente de IA de escritorio

NoviQ es un programa para trabajar con IA en tu PC al estilo de Claude. La IA no solo conversa: crea proyectos, escribe y edita código, lo prueba, ejecuta PowerShell y Python, busca en internet, dibuja, ve tu pantalla y recuerda lo que haces. Funciona con **NVIDIA (build.nvidia.com)**, **Gemini, OpenAI, Anthropic, OpenRouter, Groq, DeepSeek, Mistral, xAI y más**, y con **IA local mediante Ollama y LM Studio**. Si una IA falla, **continúa con otra sin perder nada**.

> **Estado:** en actualización activa. Todavía **no hay instaladores publicados**: NoviQ se ejecuta desde el código (abajo). Si quieres un instalador propio, puedes compilarlo con los scripts de `packaging/` (sección «Compilar los instaladores»).

NoviQ se abre en **su propia ventana nativa**, como cualquier programa (no en el navegador). El idioma (**español o inglés**) se elige solo según tu sistema; puedes cambiarlo en ⚙ Ajustes. Para cerrarlo por completo usa **⏻ Apagar Noviq**. Tus datos se guardan en `%APPDATA%\Noviq` (Windows), `~/Library/Application Support/Noviq` (macOS) o `~/.local/share/Noviq` (Linux).

## Novedades de la 4.7: pedir cosas mientras trabaja y conversaciones que no se mezclan
- **📥 Peticiones en caliente.** Si la IA o los agentes están trabajando y escribes algo más (en la ventana, por voz al avatar, por Telegram o por MCP), ya no aparece «Esta conversación ya está trabajando». El pedido entra en la **bandeja** de esa conversación y la IA lo **integra en el siguiente paso**, sin detenerse: si corrige el rumbo, lo ajusta; si es algo adicional, lo agrega al plan (conservando lo ya completado); si es una pregunta, la responde y sigue. Si el trabajo terminó justo antes, arranca solo un turno nuevo con lo pendiente. En la ventana, con la IA trabajando y texto en la caja, el botón cambia a **📥 Agregar**; lo que está en cola se ve sobre la caja y puedes quitarlo con ✕ antes de que la IA lo lea.
- **🧭 Enrutador de conversaciones.** Cada pedido va a donde corresponde: sigue la **misma** conversación si es el mismo tema o una respuesta («sí, dale», «y que también…»), **retoma otra** si dices «sigue con lo del login» o es claramente ese tema, abre una **nueva** si dices «nueva conversación: …» / «otro tema…», trabaja **dentro del proyecto** que nombras («en el proyecto tienda online…», sin importar tildes ni guiones) y crea un **proyecto nuevo** si lo pides («crea un proyecto nuevo llamado …»). Primero usa reglas fiables; solo si queda en duda consulta a la IA más rápida. En la ventana nunca te cambia de chat sin pedirlo: si parece otro tema, te lo sugiere. Con el avatar y Telegram decide solo (antes todo caía en una sola conversación).
- **🏷 Títulos automáticos.** El primer pedido de cada conversación se resume en un título corto (2 a 6 palabras). Se apaga con `"titulos_ia": false` en la configuración.
- **🔌 MCP:** nuevas herramientas `noviq_agregar` (agregar a una conversación sin detenerla) y `noviq_enrutar` (consultar a dónde iría un pedido).
- Configuración del enrutador (opcional) en la configuración: `"enrutador": {"activo": true, "ia": true, "dias": 14}`.

## Iniciar desde el código (Windows)
1. Instala **Python 3.10 o superior** (https://www.python.org/downloads/). Al instalarlo, marca **"Add Python to PATH"**.
2. Haz doble clic en **`iniciar.bat`**. La primera vez tarda 1 o 2 minutos porque instala todo en `.venv`. Después se abre en su ventana.
3. Entra en **⚙ Ajustes → Proveedores y claves**, pega tus API keys y marca **activo** (o usa 🎁 IA gratis).
4. Opcional: `crear_acceso_directo.bat` pone un acceso directo **Noviq** con su icono en tu Escritorio.

## Compilar los instaladores
- Windows: `packaging\windows\build.bat` → `dist\Noviq-Setup-Windows.exe` y `dist\Noviq-Windows-portable.zip`
- Ubuntu: `bash packaging/linux/build.sh` → `dist/Noviq-Linux-amd64.deb`
- macOS: `bash packaging/macos/build.sh` → `dist/Noviq-macOS-<arch>.dmg`
- Automático: si subes una etiqueta de versión (por ejemplo `v4.7.0`) a GitHub, el flujo de Actions del repositorio compila los tres y los publica en Releases.

## Claves y proveedores
- Puedes poner **varias claves por proveedor** (una por línea). Si una llega al límite o falla, se usa la siguiente.
- Las claves se guardan en la **bóveda cifrada `claves.vault`** (dentro de tu carpeta de datos), protegida con DPAPI de Windows. Solo tu usuario de Windows, en esta PC, puede descifrarla. Si alguien copia el archivo, no le sirve. En la pantalla nunca se ven completas.
- **IA local**: con Ollama (`http://localhost:11434/v1`) o LM Studio (`http://localhost:1234/v1`, activando el servidor en la pestaña Developer), los modelos que tengas descargados aparecen solos en la lista. Puedes cambiar las rutas en Ajustes.
- **Otros proveedores**: con "＋ Agregar otro proveedor" puedes añadir cualquier servicio compatible con OpenAI.
- Si un modelo no aparece en la lista, elige **"✏ Escribir otro modelo…"**, por ejemplo `gemini::gemini-3.8-flash` u `ollama::qwen3:8b`.

## Continuidad: la IA nunca empieza de cero
El programa (no la IA) lleva un **📋 ESTADO DEL TRABAJO** automático para cada conversación. Contiene:
- lo que pediste,
- el plan con sus tareas (✔ hecha · ▶ en curso · ○ pendiente),
- las acciones ya hechas,
- los archivos creados,
- los errores sin resolver,
- el **▶ SIGUIENTE PASO**.

Se actualiza después de cada paso, se guarda en disco y también en `<proyecto>\.noviq\ESTADO.md`. Puedes verlo con el botón 📋 de arriba.

Todas las IAs lo reciben siempre, y además en estos casos:
- **Relevo automático** (⚙ Ajustes → Respaldo): si una IA falla, se satura o no responde, la siguiente recibe un mensaje de relevo con el estado completo y la orden de seguir con el siguiente paso, sin repetir nada. Si **ninguna** responde, el programa espera y reintenta toda la cadena. No abandona el trabajo.
- **Respuesta cortada** por límite de tokens: continúa solo. Guarda el plan, sube el límite y baja el razonamiento.
- **▶ Continuar el trabajo**: si algo quedó a medias (error, detenido, programa cerrado), aparece este botón. Escribir "continúa" hace lo mismo: la IA recibe el estado y retoma donde quedó.
- **Conversación nueva en el mismo proyecto**: recibe el estado del último trabajo de ese proyecto.
- **Conversación muy larga**: aunque se recorten los mensajes antiguos, el estado conserva lo esencial.

Además, a la IA se le exige registrar primero el plan con la lista de tareas e ir marcándolo, y el programa se lo recuerda si lo olvida.

## Novedades: 🧠 el avatar elige el modelo de cada IA y es más autónomo (octubre 2026)

El avatar (versión 2.1) mejora su 🧠 Cerebro (Ajustes del avatar → 🧠 Cerebro):

- **Eliges el modelo de cada IA de su lista real** (Ollama, LM Studio, Groq, Gemini, Cerebras, NVIDIA, Mistral, OpenRouter, DeepSeek, OpenAI o tu propia URL), con marcas de *cargado*, *gratis*, *🧠 piensa* y tamaño, o dejas *Automático*: usa el más rápido para conversar y, si uno no sirve (no existe, no conversa o sin cuota), lo anota y usa otro. Ya no pone modelos de Gemini que no conversan (Live, TTS, Interactions…).
- **Claves a prueba de errores:** se limpian, se comprueban con el servicio al guardarlas (si no sirven no se guardan y te dice por qué) y, si pegas la de otro servicio, la mueve al correcto. Una clave de Noviq (`nvq…`) puesta como clave de Gemini ahora se avisa. **«Traer mis claves de Noviq»** abre Noviq si está cerrado, le pide sus claves y se queda solo con las que funcionan.
- **Ollama y LM Studio sin cortes:** espera a que el modelo se cargue la primera vez, lo deja cargado 30 min, lo precalienta al abrir, prefiere modelos pequeños que no «piensan» de más (apaga el «pensar» de los que sí) y, si están cerrados, dice exactamente qué abrir.
- **Más autonomía sin IA:** clima (recuerda tu ciudad), noticias, Wikipedia, cálculos dichos en voz, conversiones de unidades y monedas, temporizadores y música en YouTube, con servicios gratis sin clave. Si no hay ninguna IA, usa una **gratis sin cuenta** (LLM7/Kilo, se puede apagar); y para oír sin internet puedes elegir el reconocedor de voz de Windows.

## Novedades: 🤖 el avatar ahora es un asistente INDEPENDIENTE (septiembre 2026)

El robot flotante (`noviq-avatar`, versión 2.0) ya no depende de Noviq: **su mente, memoria, ajustes, voz, oído, herramientas y API son suyos** y viven en él (`%APPDATA%\Noviq Avatar\`). Así lo puedes usar solo, con Noviq o llevarlo a cualquier otra aplicación por su API.

- **Sus propios ajustes en su propia página:** `http://127.0.0.1:7777/ajustes` (clic derecho en el robot → ⚙ Ajustes). Noviq muestra **esa misma página** en ⚙ Ajustes → 🤖 Avatar; en Noviq solo queda si se abre con Noviq, reparar su motor y lo que Noviq le presta.
- **Mente propia:** respuestas instantáneas + la IA más rápida que tenga (Groq, NVIDIA, Gemini, OpenAI, OpenRouter, LM Studio, Ollama, una propia **o la de Noviq**), con sus claves cifradas con tu cuenta de Windows («Traer mis claves de Noviq» las copia con un clic).
- **Herramientas propias** (internet, abrir webs/carpetas/programas, portapapeles, recordatorios, calculadora) y, con Noviq abierto, **todas las de Noviq**: órdenes de trabajo a sus agentes (en el proyecto correcto), estado, proyectos, agenda, detener, continuar…
- **Voz y oído propios:** voces de Microsoft (gratis, sin clave), NVIDIA Magpie, las de Noviq (Piper sin internet) o Windows; oído con Groq Whisper, NVIDIA Whisper, OpenAI o el de Noviq (faster-whisper sin internet). Responde a su nombre (y a cómo lo transcribe Whisper: «Novi», «Novit», «No vi…»).
- **Hereda lo que tenía:** la primera vez trae la memoria (`datos\avatar_memoria.json`) y los ajustes que tenía dentro de Noviq.
- **Noviq le avisa de sus trabajos** (empieza, herramientas, progreso, permisos, preguntas, «¡ya terminé!») según cómo lo configures en los ajustes del avatar (🔗 Noviq), y le cuenta lo que terminó para que lo recuerde.
- **API para otras apps:** HTTP + WebSocket, **compatible con OpenAI** (`http://127.0.0.1:7777/v1`, clave `av-…` en sus ajustes), servidor **MCP** (`noviq-avatar\clientes\mcp-avatar.js`) y clientes Python/JS. Ver `noviq-avatar\README.md`.
- **Arranque blindado:** si su motor Electron se daña o se mezcla con archivos de otro sistema (cerraba con el código 4294930435), Noviq lo detecta y lo vuelve a descargar verificado; `datos\avatar_arranque.log` dice en qué paso se cayó.

## Novedades: 🧠 la mente del avatar y 🗣 voces latinas modernas (septiembre 2026)

- **Conversa rápido y por su cuenta:** saludos, «¿cómo me llamo?», la hora, gracias, recordatorios, tu agenda, «abre YouTube / Descargas / la calculadora» se responden al instante, sin IA. Para charlar, preguntar o aprender usa la **IA más rápida** de tu 🧪 banco de pruebas, y lo que aprende lo vuelve a usar al instante.
- **Memoria propia y permanente** (ahora en el propio avatar; antes `datos\avatar_memoria.json`): tu nombre (si no lo sabe, te lo pregunta), lo que le cuentas («recuerda que…»), planes, recordatorios («recuérdame mañana a las 9 llamar a mamá») y lo que le enseñas («cuando te pregunte X responde Y»). Se ve y se edita en ⚙ Ajustes → 🤖 Avatar.
- **No colapsa tus proyectos:** las ideas quedan como **plan** en el avatar hasta que dices «hazlo»; solo las órdenes directas («crea…», «revisa mis correos», «busca en internet…») van a Noviq, en la conversación de voz de ese proyecto (o en la tuya si dices «en este chat» o estás viendo ese proyecto). «Noviq, vamos a trabajar en el proyecto X» abre ese proyecto.
- **Personalidades combinables:** curioso, divertido, animado, tranquilo, triste, preguntón, profesor, valiente, serio, cariñoso, sarcástico (hasta 4 a la vez; también por voz: «sé más divertido», «ponte en modo profesor»). Cambian lo que dice, su cara, su ritmo, su tono y su iniciativa propia (gestos, datos curiosos, preguntas para conocerte). Puedes ponerle otro nombre.
- **Portapapeles:** sabe lo que copias (filtra claves, contraseñas y tarjetas; solo en RAM). Si copias un error, ofrece ayudarte.
- **Siempre atento, responde solo a su nombre:** con la voz local instalada (faster-whisper), el nombre se detecta en tu PC y nada sale hasta que lo llamas. Después de responder, sigue escuchándote unos segundos sin repetir su nombre.
- **🗣 Voces modernas, gratis, de mujer y de hombre:** Microsoft neuronales (🇪🇨 Andrea/Luis, 🇲🇽 Dalia/Jorge, 🇨🇴 Salomé/Gonzalo, 🇦🇷 Elena/Tomás, 🇵🇪 Camila/Alex, 🇨🇱, 🇻🇪, 🇺🇸 latinas…), NVIDIA Magpie (Isabela/Diego con emociones, tu clave) o Piper (sin internet). Botón ▶ para escucharlas en el robot. La boca se mueve con el audio real.
- **API para otros programas:** ahora la da el propio avatar (ver la novedad de arriba); `POST /api/avatar/charla` y MCP `noviq_charlar` de Noviq siguen funcionando (le pasan la charla al avatar).

## Novedades: 🤖 Avatar conectado — la cara, la voz y el oído de Noviq (septiembre 2026)

El robot flotante (carpeta `noviq-avatar`) ahora es parte del programa:

- **Se abre solo con Noviq** y se cierra al apagarlo. Si le falta su motor (Electron), Noviq lo descarga de GitHub y verifica su huella SHA‑256; también desde ⚙ Ajustes → 🤖 Avatar → *Reparar*.
- **Está ahí mientras trabaja:** icono de la herramienta en el visor, animación según lo que hace, barra de progreso de las tareas, y mensajes cortos con **sonidos de robot**: «¡Ya terminé!», «¿Qué más hacemos?», «Necesito tu permiso…», «Me detuve por un error, ¿lo intento otra vez?», «Quedó a medias… ¿lo continúo?». Sin trabajo un rato, se duerme.
- **Te escucha:** di **«Noviq, …»** y el pedido entra al chat abierto como si lo escribieras (si la ventana está cerrada, Noviq lo hace igual). Por voz también: «¿qué estás haciendo?», «detente», «continúa», **sí/no** a un permiso (lo delicado —enviar, borrar, instalar, pagar— se aprueba solo en la ventana o Telegram), contestar lo que la IA te pregunta, «abre la ventana», «cállate», «duerme», «deja de escuchar». Clic en el micrófono 🎙 del robot, en el 🎙 del chat o **Ctrl+Alt+Espacio** = una frase sin decir su nombre.
- **Voz → texto:** local con faster-whisper (sin internet), **NVIDIA Whisper large-v3** con tu API key (Noviq instala su cliente oficial solo), Groq/OpenAI o el reconocedor de Windows. Se elige en ⚙ Ajustes → 🤖 Avatar.
- **Agente del avatar** (`noviq/avatar_agente.py`): usa las mismas herramientas que el servidor MCP de control (`noviq_mcp.py`), que ahora trae `noviq_avatar` para que cualquier IA (Claude Desktop, Noviq) hable con el usuario a través del robot. La IA de Noviq tiene la herramienta `avatar` (solo aparece si el robot está abierto).

## Novedades: 🎬 juegos épicos, figuras 2D/3D propias y personajes de bloques (septiembre 2026)

### 🎬 Director creativo: de «juego de recoger calabazas» a una aventura épica
Escribe una idea simple y el Estudio la convierte en un juego como los más jugados de su categoría:
travesía por zonas con historia, guía que habla, vistas panorámicas (miradores), **trajes y armas para elegir**, vidas y
puntos de control, obstáculos (troncos, pinchos, lodo, péndulos, cepos, rocas…), **contratiempos** (tormenta, noche, niebla,
emboscada, ladrón, derrumbe), potenciadores, mejoras entre zonas, logros y un **jefe final con fases**. El director revisa el
diseño con una lista de 16 puntos (lo que tienen los mejores juegos) y completa lo que falte. En el Estudio verás el diseño
épico con su nota: **✨ Mejorar más** (vuelve a trabajarlo con la IA) y **👍** (el director aprende de los diseños que te
gustan). Funciona en los tres motores: 3D realista, vóxel y 2D.

### 🧍 Figuras 3D propias, totalmente animadas
Si tu carpeta no tiene el personaje o el enemigo que el juego necesita, Noviq lo crea: .glb con esqueleto y animaciones
(quieto, caminar, correr, saltar, atacar, disparar, magia, golpe, caer, hablar). Más de 160 diseños: héroes, granjeros,
caballeros, magos, **militares** (soldado camuflado, comando con pasamontañas, francotirador, general con medallas, médico de
campo, piloto, soldados de desierto y de montaña, mercenarios, comandante enemigo), zombis, esqueletos, animales, dragones,
armas, objetos y escenario (tanque, jeep, sacos de arena, barricadas, alambre de púas, torre de vigilancia, carpa militar…).

### 🧊 Personajes de BLOQUES (estilo vóxel, parecido a Minecraft pero con diseños propios)
Cualquier figura puede hacerse de bloques con caras en pixel art (escribe «de bloques», «estilo minecraft» o «vóxel», o marca
🧊 Bloques). También hay cerdos, vacas, ovejas, caballos, mineros, aldeanos, zombis de bloques y herramientas pixel (pico,
espada, hacha, pala). El motor vóxel ahora usa estas figuras animadas para el jugador, los enemigos, los guías y el jefe.

### 🎨 Diseños 2D profesionales
Retratos (para los diálogos), tarjetas de personaje, iconos de armas y objetos, **hojas de sprites animadas** (desde las
figuras 3D: vista lateral o desde arriba en 4 direcciones, también estilo pixel art), **fondos panorámicos por capas** para
parallax (cielo, lejos, medio, cerca; por tema y hora), texturas sin costuras y baldosas. El motor 2D ahora es HD: usa esos
sprites, fondos y baldosas, con travesía por zonas, trajes, armas, guía, mirador, obstáculos, contratiempos y jefe.

### 🗂 Todo queda guardado para reutilizarlo
- 3D: `docs\3D\Noviq Creados\<categoría>` (y `…\Bloques\…`, `…\Militares`), con miniatura y ficha `.noviq.json`.
- 2D: `docs\2D\Noviq Creados\<Retratos | Personajes | Iconos | Sprites | Fondos | Texturas | Baldosas>`.
Lo idéntico no se vuelve a crear: se reutiliza. En el Estudio: **🗂 Mis diseños 2D y 3D** (ver, filtrar y crear desde una
descripción). En el chat la IA tiene `crear_figura`, `crear_diseno_2d` y `mejorar_diseno`.

### 🟩 Render de calidad para tarjetas NVIDIA
Las miniaturas, retratos, iconos y sprites se dibujan con un render propio (z-buffer, sombras, oclusión ambiental y
antialiasing); necesita `numpy` (se instala solo con `iniciar.bat`). Los juegos suben la calidad según tu tarjeta
(RTX: sombras 4096, más hierba y distancia).

## Novedades: 🖥 Windows, 📱 Telegram, ✉ correo, 📅 agenda y 🪙 tokens (septiembre 2026)

### 🖥 La IA maneja tu Windows gastando pocos tokens
- **Perfil de Windows**: al iniciar, Noviq averigua solo tu usuario, tus carpetas REALES (aunque OneDrive las mueva),
  navegadores, Office y los programas del menú Inicio. La IA usa esas rutas y abre programas por su nombre sin buscar.
- **Primero texto, luego imágenes**: para leer la pantalla usa UI Automation y el **OCR que ya trae Windows** (sin mandar
  imágenes a la IA), hace clic en el texto que ve (`clic_texto`) y solo si hace falta mira una captura reducida.
- **📎 Oficina sin abrir programas**: Word (crear, leer, reemplazar), Excel (leer, escribir), PDF (leer, unir, convertir),
  buscar documentos, recientes y ordenar carpetas.
- **🔌 MCP con un clic** (🖥 PC → 🔌): los servidores más usados (Windows-MCP, Playwright en Chrome/Edge, tu Chrome abierto
  con tus sesiones, archivos, Excel, Desktop Commander, búsqueda web, fetch, memoria, GitHub…). Instala Node.js o uv si
  faltan. Los de «subagente» no se mandan en cada mensaje: un agente aparte los usa (menos tokens).
- **Arreglado**: Windows-MCP ya no falla con «protocol version not accepted (-32022)» la primera vez (cuando uvx tarda en
  instalar); Noviq detecta la versión nueva del protocolo MCP y se conecta.

### 🛡 Aprobaciones (aunque esté en ⚡ Todo automático)
Enviar correos o mensajes, eliminar o sobrescribir, instalar o comandos de riesgo y pagos o compras **siempre** esperan tu
✅ en Noviq **o en Telegram**, también dentro de los subagentes (navegador, PC, MCP). Todo lo demás se aprueba solo según el
modo de permisos. Lo configuras en ⚙ Ajustes → 📱 Telegram y correo; ahí también ves y quitas los «Permitir siempre».

### 📱 Telegram
1. En Telegram abre @BotFather, escribe `/newbot` y copia el token.
2. ⚙ Ajustes → 📱 Telegram y correo → pégalo → **Guardar y conectar** (se guarda cifrado).
3. Mándale a tu bot el **código de 6 dígitos**. Solo ese chat puede darle órdenes.
Desde el celular: escribe lo que quieres que haga, aprueba con ✅/❌, y usa `/estado`, `/agenda`, `/notas`, `/captura`,
`/ranking`, `/detener`, `/continuar`, `/nuevo`. Te avisa de resultados de tareas, errores y trabajos terminados.

### ✉ Correo
Gmail (con **contraseña de aplicación**), Hotmail/Outlook.com, **Outlook de escritorio** (sin clave, usa tu sesión) y
correo de empresa por SMTP/IMAP. La IA lee, busca y envía (enviar siempre pide aprobación). Si Microsoft rechaza el SMTP
(error 5.7.30), envía con Outlook de escritorio o desde tu Chrome.

### 📅 Agenda
Pide «los lunes, miércoles y jueves a las 9 revisa mis correos» y queda como **tarea programada** (🖥 PC → 📅 Agenda),
con la vista de los próximos 7 días y **notas importantes** (resultados, aprobaciones y lo que anota la IA; las ⭐ llegan
a Telegram). En «Nueva tarea programada» también puedes escribir el «cuándo» en palabras.

### 🏆 Selector de IAs y 🪙 contabilidad de tokens
- La IA que más problemas da últimamente queda **⬇ degradada** y baja al final de la lista (las de razonamiento con un
  umbral más estricto); las mejores y que funcionan van primero. ↺ en 🏆 Ranking la devuelve a su puesto.
- Noviq cuenta los tokens de cada IA (hoy, mes, total) y lee lo que le queda según el proveedor. Un «429 por día» la deja
  **⛽ sin cuota** hasta que se renueve: pasa al respaldo al instante en vez de reintentar minutos. Puedes poner un tope
  diario de tokens por proveedor en 🏆 Ranking de IAs.

## Novedades: 🎮 Estudio de juegos, ✍ taller de prompts y 🟩 herramientas NVIDIA (septiembre 2026)

### 🎮 Estudio de juegos (para principiantes)
- **Solo describes tu idea** («un juego en los Andes donde recojo gemas y me persiguen cóndores»). La IA la convierte en el
  diseño del juego (género, objetivo, jugador, enemigos, objetos, mundo, colores y qué modelos buscar) y crea un proyecto
  **que ya se puede jugar**, con un motor probado y optimizado. Luego la IA del chat programa las mecánicas especiales.
- **Según tu tarjeta gráfica**: Noviq mide la GPU (NVIDIA u otra), la VRAM y la RAM libre y elige el estilo:
  🌄 3D realista · 🎨 3D low poly · 🧊 **vóxel HD estilo Minecraft** (pixelado pero de alta calidad: oclusión ambiental,
  niebla, día y noche, romper y poner bloques) · 🕹 2D pixel art. Si la PC no aguanta 3D, sugiere vóxel o 2D.
- Los juegos bajan la resolución y las sombras solos si van pocos FPS y no tienen fugas de memoria (todo se crea una vez).
- Botón **🎮 Juegos** en la barra lateral, pestaña **🎮 Estudio** en el panel derecho. Para jugar fuera de Noviq:
  doble clic en `jugar.bat` dentro del proyecto.

### 📁 Tu carpeta de modelos 3D (carpeta estándar: `docs\3D`)
- **Pon tus modelos en `docs\3D`** (dentro de la carpeta de Noviq), un paquete por subcarpeta: `.glb` / `.gltf`, o los
  `.zip` tal cual (se descomprimen solos). Los `.fbx` / `.obj` / `.blend` se ignoran: expórtalos a `.glb` con Blender.
- Noviq **escanea la carpeta** y clasifica cada modelo por su nombre (personaje, enemigo, vehículo, arma, árbol, roca, casa,
  edificio, farola, señal, caja, barril, valla, banco, lápida, calabaza…) y cada paquete por temática (ciudad, terror,
  zombies, disparos…). También cuenta polígonos y animaciones y detecta lo que el motor no puede abrir.
- **Al diseñar un juego se usan primero tus modelos** que encajan con la idea: el jugador, los enemigos, lo que se recoge,
  el arma y la decoración (con variantes para que no se repita), y se agrega decoración extra de tu carpeta que va con la
  temática (autos y semáforos en la ciudad, lápidas y calabazas en el terror, barriles y barreras en los de disparos).
  Lo que falte se busca gratis en internet o lo dibuja el motor.
- En el Estudio, la tarjeta **📁 Tus modelos 3D** muestra la carpeta, los paquetes, una galería con vista previa de cada
  modelo (se dibuja una sola vez y se guarda) y el botón **Usar como…** para asignar cualquier modelo a un rol del juego.
  Botones: abrir la carpeta, volver a escanear y cambiar de carpeta (también en ⚙ Ajustes → 🎮 Juegos).
- Opcional: un `_info.json` en cada paquete con autor y licencia (`{"autor": "Quaternius", "licencia": "CC0"}`) para que
  los créditos del juego (`CREDITOS.md`) salgan completos.
- Las **ideas de ejemplo** del Estudio (y las marcadas con 📁, pensadas para tus paquetes) rellenan la idea, eligen el
  género y, si la idea lo pide, el estilo (Minecraft → vóxel, 2D → pixel art). Luego pulsas **✨ Diseñar mi juego**.

### 🌍 Detector de videojuegos en muchos idiomas
«juego», «game», «gamers», «crear mundo», «jogo», «jeu», «Spiel», «gioco», «игра», «游戏», «ゲーム», «게임», «لعبة»,
«pukllay»… incluso con faltas («vidiojuego»). Al enviar, abre el Estudio y la IA entra en **modo videojuego** (con sus
herramientas y reglas). No se confunde con «juego de caracteres» ni «teoría de juegos». Ajuste en ⚙ → 🎮 Juegos y NVIDIA.

### 🧱 Galería de activos 3D gratis y legales
Busca a la vez en **Poly Haven** (CC0, modelos realistas escaneados, texturas PBR y cielos), **ambientCG** (CC0),
**Sketchfab** (solo CC0/CC-BY; descargar requiere tu token gratuito) y **Poly Pizza** (low poly; clave gratuita).
Preselecciona según el género, la temática y los polígonos que aguanta tu tarjeta; empaqueta todo en `.glb` y anota
autor y licencia en `CREDITOS.md` y en la pantalla de créditos del juego.

### 🟩 Herramientas NVIDIA (también para programación normal)
- `nvidia_ia info`: tarjeta, arquitectura, CUDA, RT/Tensor cores, DLSS, NVENC, apps instaladas y cómo aprovecharlas
  (PyTorch con el índice CUDA correcto, CuPy, video con NVENC, IA local, Unreal/DLSS, Omniverse/USD).
- **Texturas con IA** (FLUX): sin costuras + mapa normal. **Modelos 3D con IA** (TRELLIS) desde un texto.
- **Audio2Face-3D**: voz `.wav` → animación facial (blendshapes) con el cliente oficial de NVIDIA.

### ✍ Taller de prompts (barra sobre la caja de mensaje)
🔤 Corregir (ortografía, tildes y sintaxis) · ✨ Profesional (rol, objetivo, contexto, requisitos, restricciones,
entregables y criterios de aceptación) · 🧱 Estructurar · 🎯 Más específico · 🌐 Inglés · 📋 Plantillas (Tab salta entre
los [marcadores]) · ＋ Piezas · medidor de **calidad del prompt** con consejos · ↩ Deshacer y «Ver cambios».
Atajos: Ctrl+Alt+C corregir, Ctrl+Alt+M profesional. Usa la IA más rápida del 🧪 banco de pruebas; sin IA, corrige local.

## Novedades: depuración como un experto (septiembre 2026)

Cuando se le pedía arreglar un programa, la IA a veces se quedaba **razonando sin fin** o daba vueltas sin avanzar. Ahora:

### 🛡 Guardián de razonamiento
- Vigila en vivo lo que escribe la IA. Si piensa demasiado sin actuar (por defecto 16 000 caracteres o 150 s; 40 % menos con IA local) o **repite el mismo texto en bucle**, la corta, le deja un resumen de lo que pensó y le ordena actuar YA con una herramienta y razonamiento breve (`reasoning_effort=low` y, en GLM/Qwen/DeepSeek de NVIDIA, sin «thinking»).
- Configurable en ⚙ Ajustes → Respaldo.

### 🚀 Escalado a la IA más capaz
- Un supervisor suma puntos cuando la IA se atasca (el guardián la cortó, repite acciones, la misma edición falla otra vez, errores seguidos, pruebas que siguen fallando). Al llegar al umbral, el trabajo pasa a **la IA más inteligente que tengas habilitada y con cuota** (sin 429, sin crédito agotado, verificada con tus claves primero), con todo el estado y el diagnóstico. Si ya estás usando la mejor, recibe un diagnóstico y una estrategia nueva; si aun así no avanza, se detiene para no gastar recursos.

### 🩺 Herramientas nuevas para depurar (como las de Claude)
- **diagnosticar**: revisa el proyecto completo y devuelve la lista PRIORIZADA de problemas con archivo:línea y cómo arreglarlos: codificación dañada (la repara a UTF-8 con respaldo), código omitido («// ... resto del código»), funciones que se llaman pero no existen o están en un archivo que la página no carga, orden de los `<script>`, `getElementById` de ids que no existen, librerías (THREE, jQuery, Phaser…) usadas sin cargarlas, módulos ES abiertos con doble clic, sintaxis, nombres y dependencias, y abre la página en un navegador invisible.
- **probar_web**: abre la web o el juego en Edge/Chrome **invisible** (sin instalar nada) y reporta errores de JavaScript con archivo:línea, archivos que no cargan, la consola, una captura (la IA la ve) y si la pantalla o el canvas quedan vacíos. Simula teclas, clics, arrastrar el mouse, rueda y texto, e indica si la imagen cambió (¿los controles funcionan?).
- **Diagnóstico automático**: si dices «no funciona», «revisa», «arregla»…, Noviq diagnostica el proyecto antes de que la IA empiece y le entrega los errores reales como punto de partida.
- El **agente de pruebas final** también abre las webs en el navegador invisible antes de dar el trabajo por terminado.

### ✏️ Archivos más seguros
- **Corregido**: los archivos en ANSI (guardados por PowerShell) se leían como UTF-16 y la IA veía «caracteres chinos», creía que el archivo estaba dañado y lo reescribía. Ahora la codificación se detecta bien y se avisa.
- **editar_archivo** tolera lo que suelen equivocar las IAs pequeñas: números de línea copiados, espacios, sangría, líneas en blanco, escapes dobles y pequeñas diferencias (≥ 90 %). Si falla, muestra las líneas reales con sus números para copiar o usar `desde_linea/hasta_linea`. Nuevo modo `despues_de_linea` para insertar.
- **escribir_archivo** avisa si un archivo se encoge de golpe (¿se borró código?) o si quedó con «...» en vez de código.
- **PowerShell** ya no puede escribir archivos de código con here-strings (`Set-Content @"…"@`), que rompían comillas, `$variables` y la codificación; guarda en UTF-8 y respalda los archivos que un comando menciona, así **deshacer_cambio** siempre puede volver atrás (también con copias de trabajos anteriores).

## Novedades de la versión 4.2

### ✅ La lista de modelos muestra solo los que funcionan (y primero los mejores)
- Arriba aparece «⭐ Los mejores que funcionan con tus claves» (ya probados), y cada modelo tiene una línea en palabras simples: muy inteligente, programa bien, rápido, gratis, ve imágenes… y para qué sirve.
- Si tienes **varias API keys** (por ejemplo dos cuentas de NVIDIA), Noviq prueba cada modelo con todas y usa la clave que funcione con ese modelo. En ⚙ Ajustes → Proveedores, «🩺 Probar cada clave» dice cuál funciona. Al cambiar tus claves se vuelve a probar todo.
- Un **agente verificador** (sin IA) prueba en segundo plano, con un mensaje mínimo y respetando los límites gratuitos, qué modelos responden de verdad con tu cuenta (NVIDIA lista muchos que tu cuenta no puede usar). Cada modelo queda ✅ verificado, ❔ sin verificar o ⛔ no operativo con su motivo.
- Por defecto se ocultan los que no funcionan («✅ Solo los que funcionan»); «🔎 Verificar todos» los vuelve a probar.
- Al final de la lista aparecen las IAs gratis que aún no conectaste, con **🔑 Conseguir clave gratis** y un campo para pegarla ahí mismo.

### 🆓 Más IA gratis
- **Sin cuenta ni clave**: Kilo Gateway (modelos «:free»), LLM7 y OVHcloud AI Endpoints: se activan con un clic.
- **Con cuenta gratis (sin tarjeta)**: Z.ai (GLM Flash), Cloudflare Workers AI, Cohere, Aion Labs, Pollinations, Ollama Cloud (modelos grandes procesados en su nube), Vercel AI Gateway, además de los que ya había.
- **Tu servidor GPU gratis en la nube (Kaggle)**: Noviq genera un cuaderno listo; Kaggle pone 2 GPU T4 (32 GB) y la IA corre allá, no en tu PC.

### 🧠 Plan en vivo que puedes editar
Mientras la IA diseña el plan lo ves en el panel lateral (pestaña 🧠 Plan). Al terminar tienes **30 segundos** para revisarlo: si no haces nada se aprueba solo; si empiezas a editar (tareas, tecnología, archivos) la cuenta se detiene hasta que pulses «Aprobar». También puedes descartarlo.

### ✍ Escritura en vivo y enlaces clicables
- Pestaña **✍ En vivo**: ves lo que la IA va escribiendo en cada archivo (o el código/comando que prepara) mientras lo escribe.
- Las rutas de tu PC que aparecen en las respuestas (C:\...) se pueden pulsar: los archivos se abren en el visor y las carpetas en el explorador (Ctrl+clic = Explorador de Windows).

### 🗂 Cada proyecto con su pantalla y su propia IA
Al elegir un proyecto se abre su pantalla: sus chats (con los que están trabajando), acciones (nuevo chat, archivos, probar y corregir, estado) y **la IA de ese proyecto**. Cada proyecto puede usar una IA distinta y todos pueden trabajar a la vez. Pulsar Enter mientras la IA trabaja ya no la detiene.

### 🧰 Herramientas nuevas para la IA
- **ejecutar_linux** (Linux/WSL dentro de Windows, apt como root), **contenedor** (Docker aislado), **entorno** (entornos virtuales .venv / Node, qué está instalado, instalar Linux), **instalar_herramienta** (agente instalador con winget/apt/pip/npm), **puntos_restauracion** (se crean solos antes de cada trabajo; volver atrás si algo se rompe, sin tocar tu .git), **peticion_http** (probar APIs y servidores).
- **Pruebas como un programador**: el agente de pruebas ahora **ejecuta el programa** (prueba de humo). Si arranca y sigue funcionando (ventana o servidor) sin errores = OK; si falla, pasa a la IA el archivo y la línea para corregirlo solo.
- **Agente de seguridad**: detecta claves API escritas en el código y pide moverlas a un .env.

### ⚖ Decisor «System One» (inspirado en Jev, septiembre 2026)
Decisiones rápidas y tipadas en los puntos clave: ¿este comando es peligroso?, ¿el pedido necesita plan?, ¿qué tan complejo es?, ¿qué tipo de error es? Lo peligroso (borrar carpetas, formatear, apagar, git push --force…) **se pregunta siempre**, aunque estés en ⚡ Todo automático. El modo «🛡 Auto seguro» ahora solo pregunta lo riesgoso. Si pones una clave de **Jev (TypeSafe)** se usa ese modelo; sin clave decide con reglas locales gratis.

## Novedades de la versión 4.1 (y 4.0)

### 🧠 Modo vanguardia: siempre los modelos gratis más inteligentes
- En la lista de modelos: **«🧠 Usar siempre los más inteligentes gratis»** prueba los modelos gratuitos de mayor razonamiento que tengas conectados, pone el mejor que responda como principal y los siguientes como respaldo (de empresas distintas, para que si una se agota siga otra).
- **Cerebro planificador**: antes de construir un programa, el modelo más inteligente diseña el plan completo (tecnología, archivos, tareas, pruebas) con razonamiento alto. Luego la IA de trabajo (aunque sea local) lo ejecuta paso a paso. Se configura en 🎁 IA gratis → Modo vanguardia.
- Etiquetas en la lista: 🚀 vanguardia, 🧠 razonamiento muy alto, 🆓 gratis. El globo informativo muestra también el razonamiento y el costo.

### 🩺 IAs no operativas: motivo y solución
- Si un modelo o proveedor falla, Noviq dice **por qué** y **cómo arreglarlo**: 🔑 clave inválida o faltante, ⛔ modelo no disponible para tu cuenta (el error de NVIDIA «Function not found for account»), 💳 sin crédito, ⏳ límite alcanzado, ⬇ modelo local no descargado, 💾 no cabe en tu memoria, 🔌 Ollama/LM Studio cerrado.
- Esos modelos aparecen **tachados con el motivo** en la lista y Noviq los **salta solo**, pasando al siguiente modelo que funcione **sin perder el trabajo** (se reintentan solos más tarde).
- «🩺 Verificar» en la lista de modelos comprueba cuáles responden de verdad. Una barra arriba avisa si alguna clave dejó de funcionar.
- Arreglado: el 404 de NVIDIA ya no se confunde con «no acepta herramientas».

### ⏳ Ver qué está haciendo la IA (con cronómetro)
Debajo del chat se ve la fase actual y cuánto lleva: 📦 cargando el modelo en memoria (IA local), 📖 leyendo el contexto, 💭 pensando, ✍ respondiendo, 🛠 usando una herramienta. Si la carga tarda demasiado, avisa que el modelo puede ser muy grande para tu PC.

### ⚡ Varios proyectos a la vez
Cada conversación trabaja en su propio hilo: puedes dejar una IA trabajando en un proyecto, abrir otro proyecto (o chat) y trabajar con otra IA al mismo tiempo. Las que siguen trabajando tienen un punto verde en la barra lateral; al volver a ellas ves su progreso en vivo. Te avisa cuando una termina o necesita tu permiso. En la pantalla de proyectos: filtro «Trabajando ahora».

### 🧬 Agentes que aprenden solos
Cuando algo falla y la IA lo arregla, Noviq guarda qué error era y qué lo solucionó. La próxima vez que aparezca ese error (en cualquier proyecto y con cualquier IA) le pasa la solución que ya funcionó; las lecciones más probadas se vuelven reglas. También aprende qué paquete instalar para cada módulo de Python. Todo es a prueba de fallos y se puede revisar o borrar en **🧬 Aprendizaje**.

### 🖥 Control del PC y ⏰ tareas programadas
- La IA puede manejar tu escritorio con el **mismo método que el navegador**: lee la ventana (cada botón o campo tiene una referencia), actúa (abrir programas, clic, escribir, atajos) y verifica. Funciona sin instalar nada; opcionalmente activa **Windows-MCP** (más completo) en 🖥 PC y tareas. Siempre pide permiso antes de actuar, salvo en ⚡ Todo automático.
- **Tareas programadas**: una vez, cada día, ciertos días o cada N minutos. También puedes pedírselo a la IA («cada lunes a las 9 revisa mi proyecto y corre las pruebas»). Se ejecutan mientras Noviq esté abierto; activa «Iniciar Noviq con Windows» para que siempre lo esté.

### 🗂 Proyectos a pantalla completa
La pantalla de proyectos ocupa toda la ventana, con vista de tarjetas o lista, estadísticas y filtro de los que están trabajando.

### 🎁 IA gratis (legal)
Botón **🎁 IA gratis** en la barra lateral:
- **OpenRouter** se conecta **con un clic**: inicias sesión en su web y Noviq recibe la clave solo. Por defecto muestra solo los modelos «:free».
- Para **NVIDIA, Gemini, Groq, Cerebras, Mistral y Hugging Face** hay un botón que abre la página oficial para crear la cuenta y la clave gratuita. La pegas y Noviq la guarda cifrada, activa el proveedor y lo prueba.
- Si activas varios, el **respaldo automático** pasa de uno a otro cuando alguno llega a su límite gratuito.
- Noviq **no** automatiza las webs de pago (ChatGPT, Claude.ai, Gemini web…): va contra sus condiciones y podrían bloquear tus cuentas.

### 💻 IA local que ya no pierde el hilo (Ollama y LM Studio)
**Por qué la IA local empezaba de cero:** Ollama usa por defecto un contexto de solo **4096 tokens**. Las instrucciones, las herramientas y el historial no cabían, Ollama recortaba el inicio de la conversación y el modelo olvidaba el plan. Noviq lo resuelve así:
- **Contexto a la medida de tu equipo:** Noviq habla con Ollama por su API nativa y fija el contexto (`num_ctx`) en cada petición. Lo calcula según tu **VRAM (16 GB)**, tu **RAM (32 GB)**, el tamaño del modelo y lo que ocupa su memoria por token. Con LM Studio lee el contexto cargado y, si el modelo no está cargado, lo carga con uno adecuado.
- **Modo compacto paso a paso** (automático con IA local):
  - la IA trabaja **una tarea a la vez**;
  - al terminar cada tarea, el orquestador «limpia la mesa» y le da solo lo necesario para la siguiente: el estado, el mapa del código y la tarea;
  - si se queda sin actuar, se lo recuerda;
  - si repite la misma acción, la frena (detector de bucles).
- **Memoria compacta y selectiva:**
  - un **mapa del código** ultracompacto (funciones y clases con su número de línea), hecho sin IA a partir del código;
  - el **ESTADO del trabajo** siempre al inicio;
  - solo los últimos resultados de herramientas completos: los anteriores se resumen en una línea (enmascarado de observaciones: según un estudio de JetBrains en NeurIPS 2025, ahorra ~50 % de tokens sin perder calidad);
  - herramientas reducidas a 15 con descripciones cortas (≈1.900 tokens en vez de ≈4.600).
- **Medidor de contexto** bajo el chat: cuántos tokens usa cada petición y de cuántos dispone el modelo.
- **⚙ Ajustes → IA local:** VRAM, RAM, contexto, razonamiento, pasos, y el botón **⚡ Optimizar Ollama para mi GPU**. Ese botón activa flash attention, caché KV q8 (la mitad de memoria), un solo modelo a la vez y keep-alive de 30 min. Luego hay que reiniciar Ollama.

**Modelos recomendados para 16 GB VRAM + 32 GB RAM:**
- **qwen3-coder:30b**: el mejor para programar en local. Es MoE, así que aunque use algo de RAM va bien.
- **gpt-oss:20b** y **devstral**: alternativas.
- **qwen3-vl:4b**: ayudante de visión local.
- **deepseek-r1** solo para razonar: gasta muchos tokens pensando y usa mal las herramientas.

### 🧰 Agentes auxiliares sin IA (scripts que trabajan por la IA)
- **🧪 Agente de pruebas:** revisa sintaxis (Python, JS, JSON, PowerShell), nombres no definidos (pyflakes), archivos enlazados que no existen en HTML y dependencias faltantes, y ejecuta las pruebas (pytest y los comandos del proyecto). Entrega un **reporte mínimo**: archivo:línea, 3 líneas de código, la causa y una pista concreta. Si falla una prueba, señala también **la función probada**, que es donde suele estar el error. Revisa solo los archivos recién cambiados tras cada paso y todo el proyecto al final: si algo falla, le pasa el reporte a la IA para que corrija solo esas líneas (hasta 4 rondas).
- **📦 Agente de dependencias:** instala solo los módulos que faltan (sabe que `cv2` es `opencv-python`, `PIL` es `pillow`, etc.).
- **🗺 Agente indexador:** mantiene el mapa del código en `.noviq/indice.json` y solo vuelve a leer los archivos que cambiaron.
- **🧭 Orquestador:** guía a la IA local tarea por tarea.
- **🔁 Detector de bucles:** detiene a la IA si repite lo mismo sin avanzar.
- Siguen activos el **agente ejecutor de código**, el **agente navegador** y el **analizador visual**.

### 📂 Proyectos que ya tienes en tu PC
Botón **▦ → 📂 Abrir proyecto existente** o **Elegir…** (abre el selector de carpetas de Windows). Noviq detecta el tipo (Python, Node, web, C#, Java, Android, Flutter, Arduino, PHP) y cómo ejecutarlo y probarlo. La IA trabaja ahí igual que en un proyecto propio. Si el proyecto tiene su propio `.venv`, Noviq usa ese Python. Tus archivos no se mueven. Con ✖ lo quitas de Noviq sin borrar nada.

### ▦ Pantalla de proyectos
Todos tus proyectos, **los más recientes primero**, con búsqueda, orden y filtro (creados en Noviq o existentes en tu PC). Desde cada tarjeta: 💬 Trabajar, ↩ Último chat, 📁 Archivos, 🧪 Probar (la IA revisa y corrige todo), 📂 carpeta y ✎ instrucciones.

### 📁 Explorador de archivos y editor
- En el panel derecho, la pestaña **📁 Archivos** muestra el árbol del proyecto. Puedes **arrastrar y soltar** para mover, y con clic derecho: abrir, editar, renombrar, crear, enviar a la papelera, mostrar en el Explorador o «pedir a la IA que lo revise».
- **✏ Editar** abre un editor de código real (colores por lenguaje, números de línea, cierre de paréntesis, buscar con Ctrl+F). **Ctrl+S** guarda y deja antes una copia de respaldo.

### 🎈 Elegir modelo con globo informativo
Pulsa el nombre del modelo, arriba a la izquierda. Al pasar el mouse sobre cada uno aparece un globo con:
- para qué sirve;
- ★ programación, inteligencia y velocidad;
- consumo de tokens;
- si usa herramientas y si ve imágenes;
- tamaño y si **cabe en tu GPU**;
- contexto.

Arriba del listado hay atajos **«¿Cuál elijo?»**: mejor para programar, para programar en local, agente autónomo, ver imágenes, razonar, y rápido y económico.

## Novedades de la versión 3.0

### 👥 Equipo de IAs
- **`planificar_en_equipo`**: tres IAs (arquitecto, experto en calidad y riesgos, desarrollador pragmático) proponen planes a la vez, si es posible con modelos de proveedores distintos. La IA principal, que hace de coordinadora, combina lo mejor de cada una en un plan final.
- **`trabajar_en_equipo`**: la coordinadora reparte las tareas independientes entre varios agentes que trabajan **en paralelo**, cada uno con su propio modelo y **sus archivos asignados**, para que no se pisen. Al final ella integra, prueba y corrige.
- En ⚙ Ajustes → Agentes eliges cuántos agentes trabajan en paralelo (1-4).

### 🤖 Agente ejecutor de código
Si la IA escribe el código en el chat en vez de usar herramientas, el agente ejecutor reconoce cada bloque (inicio, fin, lenguaje y nombre de archivo), **guarda los archivos** en el proyecto (creándolo si hace falta) y **ejecuta los comandos** con tu permiso. Luego devuelve los resultados a la IA para que siga con su plan. Si el código es solo un fragmento de un archivo que ya existe, no lo pisa. Se configura en ⚙ Ajustes → Agentes.

### 🌐 Control de Chrome y Edge
En 🔌 MCP pulsa **«Activar Google Chrome»** o **«Activar Microsoft Edge»**. Necesitas **Node.js** (https://nodejs.org, versión LTS). Después:
- la IA delega las tareas web en un **agente navegador**: abre páginas, hace clic, llena formularios y lee datos. Funciona aunque la IA principal no sepa usar herramientas, porque usa un modelo auxiliar que sí sabe. También ahorra tokens: las ~25 herramientas del navegador solo se envían a ese agente.
- **Plan de respaldo**: si no hay control de navegador o falla, la IA te pide los pasos con **🙋 La IA necesita tu ayuda**. Tú los haces, pegas capturas (Ctrl+V) y respondes.

### 👁 Visión automática para cualquier modelo
Si el modelo que usas **no puede ver imágenes**, el programa lo detecta y un modelo con visión (Gemini, GLM-5.3, Llama-4, GPT-4o…) analiza la captura a fondo: qué es, el texto exacto de los errores, la causa probable y posibles soluciones. Ese resumen se le envía a tu IA. Una imagen cuesta miles de tokens y el resumen unos cientos, y cada análisis se guarda para no repetirlo. Puedes fijar el modelo de visión en ⚙ Ajustes → Agentes.

### ✏️ Corrección quirúrgica de archivos
- **`localizar_error`**: lee la traza del error (Python, JS/TS, C#, Java, PowerShell, PHP…) y muestra el archivo y la línea exacta con el código alrededor.
- **`mapa_codigo`**: lista las funciones y clases de cada archivo con su número de línea, para saber qué tocar sin leerlo todo.
- **`editar_archivo`**: cambia solo lo necesario. Admite varias ediciones en una llamada, rangos de líneas y tolera diferencias de sangría.
- **Protección**: no deja reescribir por completo un archivo grande que ya existe; obliga a editar solo las partes con errores.
- **Copias de respaldo** automáticas antes de cada cambio, y **`deshacer_cambio`** para volver atrás.

## Proyectos
- Cuando pides un programa, la IA crea su carpeta con **PowerShell** en **Documentos\Noviq_Proyectos\<Nombre>**. Cada tipo de proyecto (python, web, node, java, csharp, arduino, android, datos, documentos) lleva sus subcarpetas, README, .gitignore y git.
- Cada proyecto guarda en su carpeta oculta `.noviq`:
  - `memoria.md`: decisiones, estado y cómo ejecutarlo. La IA lo va actualizando.
  - `bitacora.md`: registro de todo lo que se hizo en el proyecto.
- Con ✎, junto al nombre del proyecto, puedes darle **instrucciones propias** (ej. "usa Tkinter y comenta en español").

## Herramientas de la IA
| | |
|---|---|
| 🗂 crear_proyecto / cambiar_proyecto | Carpeta propia para cada proyecto |
| 📄 escribir_archivo / ✏️ editar_archivo | Crea archivos completos y hace cambios puntuales, mostrando las diferencias |
| 📖 leer_archivo | Código, PDF, Word, Excel e imágenes |
| 📁 listar / 🔍 buscar_archivos / buscar_en_archivos | Explorar y buscar texto, como grep |
| 📦 mover_o_copiar / 🗑 eliminar | Eliminar envía a la **Papelera de reciclaje** |
| ⚡ ejecutar_powershell | Salida en vivo. Los servidores pueden ir en segundo plano |
| 🐍 ejecutar_python | Gráficos, Excel, Word, PDF, datos. Muestra los archivos que crea |
| ⚙ procesos | Ver la salida de los procesos en segundo plano o detenerlos |
| 🩺 diagnosticar | Lista priorizada de problemas reales del proyecto (codificación, código incompleto, HTML↔JS, sintaxis, navegador) |
| 🌐 probar_web | Prueba webs y juegos en un navegador invisible: errores, captura, teclas, clics y mouse |
| 🧪 probar_proyecto | Sintaxis, nombres, dependencias, pruebas y (en webs) el navegador invisible |
| 🔎 buscar_en_internet / 🌐 leer_pagina_web / ⬇ descargar_archivo | Internet |
| 🎨 generar_imagen | Dibuja con FLUX de NVIDIA |
| 🖥 captura_pantalla | La IA ve tu pantalla (con modelos que tienen visión) |
| ↗ abrir | Abre archivos o páginas en su programa o en el navegador |
| ✅ actualizar_tareas | Lista de tareas visible mientras trabaja |
| 🧠 memoria | Memoria del usuario y del proyecto |
| 🔌 MCP | Cualquier servidor MCP (mismo formato que Claude Desktop) |

**Vista previa**: las páginas HTML, imágenes, Markdown y código se ven en el panel derecho con 👁 Ver.

## Permisos (selector arriba a la derecha)
- **🔒 Preguntar**: pide permiso antes de PowerShell, Python, eliminar, capturas o escribir fuera de la carpeta de proyectos.
- **🛡 Auto**: solo pregunta antes de PowerShell, Python y eliminar.
- **⚡ Todo automático**: no pregunta nada, salvo lo que vigila la 🛡 guardia (enviar, borrar, instalar, pagar).

También puedes pulsar "Permitir siempre en esta conversación".

## Modelos que no soportan herramientas
El programa lo detecta solo. Si un modelo rechaza las herramientas nativas, cambia al **modo por texto** (funciona con cualquier modelo) y lo recuerda. También reconoce el razonamiento en `<think>` de DeepSeek-R1, Qwen y otros.

## Servidores MCP
En **🔌 MCP** pegas la configuración (igual que en `claude_desktop_config.json`), por ejemplo:
```json
{ "mcpServers": {
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/Users/TU_USUARIO/Desktop"] }
} }
```
Para servidores con `npx` necesitas Node.js y para los de `uvx`, uv.

## Si venías de «Rurak» o «NVIDIA Chat»
Copia la carpeta `datos` de la versión anterior dentro de la carpeta de Noviq: conservas tus claves (la bóveda sigue funcionando), tus conversaciones y tu memoria. La carpeta de proyectos se renombra sola a `Noviq_Proyectos`, y en cada proyecto `.noviq` pasa a `.noviq`.

## Archivos del programa
- `datos/claves.vault`: claves cifradas. **No lo compartas.**
- `datos/config.json`: ajustes (sin claves).
- `datos/conversaciones/`: historial.
- `datos/memoria.md`: tu memoria personal.
- `datos/mcp.json`: servidores MCP.
- `datos/agenda_notas.json`: notas de la agenda · `datos/tokens.json`: consumo de tokens · `datos/perfil_windows.json`: tu perfil de Windows.

## Problemas comunes
- **401/403**: clave incorrecta o vencida. **404**: el modelo ya no existe; elige otro.
- **429**: límite de uso. Pon varias claves o configura el respaldo.
- **Ollama/LM Studio "no está abierto"**: abre el programa. En LM Studio, además, inicia el servidor.
- **Imagen bloqueada**: el filtro de NVIDIA bloquea algunas palabras comunes; la IA reintenta con otras.
- **Puerto ocupado**: `set NVIDIA_CHAT_PORT=7861` antes de iniciar.
