# Noviq Avatar 2.6 — tu asistente independiente

Un robot que vive encima de cualquier programa (fondo transparente, siempre encima) y que ahora es **un asistente completo e independiente**: tiene **su propia mente, memoria, ajustes, voz, oído, herramientas y API**. Funciona solo, con Noviq o desde cualquier otra aplicación.

- 🧠 **Mente propia**: respuestas instantáneas (saludos con tu nombre, hora, recordatorios, agenda, lo que le enseñaste…) y, para lo demás, **la IA más rápida que tenga** (Groq, NVIDIA, Gemini, OpenAI, OpenRouter, LM Studio, Ollama, una propia o la de Noviq). Planea contigo y solo manda trabajo a Noviq con una orden directa o un plan confirmado.
- 💾 **Memoria permanente propia** (`%APPDATA%\Noviq Avatar\memoria.json`): tu nombre (si no lo sabe, te lo pregunta), lo que le cuentas, planes, recordatorios, lo que aprendió y las últimas charlas.
- 🎭 **Personalidad combinable**: curioso, divertido, animado, tranquilo, triste, preguntón, profesor, valiente, serio, cariñoso, sarcástico (hasta 4). Cambia su cara, su ritmo y su tono de voz. Iniciativa propia (gestos, datos curiosos, preguntas para conocerte).
- 🗣 **Voz propia**: voces neuronales de Microsoft (gratis, sin clave; hombre y mujer de Ecuador, México, Colombia, Argentina, Perú, Chile…), NVIDIA Magpie con emociones, las de Noviq (Piper sin internet) o las de Windows.
- 🎙 **Oído propio**: escucha siempre pero solo reacciona cuando dices **su nombre** (o siempre, o al hacer clic, o nunca). Entiende con Groq Whisper, NVIDIA Whisper, OpenAI o el oído de Noviq (faster-whisper sin internet).
- 🧰 **Herramientas propias**: buscar y leer en internet, abrir webs/carpetas/programas, portapapeles (sin leer nunca claves), recordatorios, calculadora exacta. Con Noviq abierto suma **todas las herramientas y agentes de Noviq**.
- ⚙ **Su propia página de ajustes**: `http://127.0.0.1:7777/ajustes` (clic derecho en el robot → ⚙ Ajustes, o doble clic en su icono de la bandeja). Noviq muestra esa misma página en ⚙ Ajustes → 🤖 Avatar.
- 🔌 **API para llevarlo a cualquier app**: HTTP + WebSocket, **compatible con OpenAI** (`/v1/chat/completions`), servidor **MCP** y clientes Python/JS.
- Cuerpo: arrastrable, vuela, pasea o sigue al puntero; ojos que siguen al puntero; brazos, manos y dedos articulados; boca con lip‑sync real; burbujas; 14 expresiones; modo icono; sonidos de robot sintetizados.

---

## 0. Lo suyo (independiente)

**Llámalo por su nombre**: «Noviq, ¿qué tengo para hoy?», «Noviq, recuérdame mañana a las 9 llamar a Ana», «Noviq, recuerda que me gusta el café sin azúcar», «Noviq, ¿qué sabes de mí?», «Noviq, sé más profesor», «Noviq, habla más despacio», «Noviq, cuéntame un chiste», «Noviq, abre YouTube / descargas / el bloc de notas», «Noviq, ¿cuánto es 15 % de 230?», «Noviq, busca el clima de mañana en Quito», «Noviq, lee lo que copié», «cuando te diga *buenos días, jefe* responde *¡a la orden!*». Tras su respuesta puedes seguir hablando unos segundos **sin repetir su nombre**. Clic en el micrófono (o el atajo, por defecto **Ctrl+Alt+Espacio**; si otro programa lo usa, elige otro y te lo dice) = te escucha una frase sin decir su nombre. Si le cambias el nombre (p. ej. «Jarvis»), responde a ese nombre y a sus variantes, y «Noviq» sigue funcionando.

**Sin ninguna IA** ya es útil: hora y fecha, **clima** («¿qué clima hace en Quito?», «¿va a llover mañana?»; recuerda tu ciudad), **noticias** del día, **Wikipedia** («¿qué es la fotosíntesis?», «¿quién fue Simón Bolívar?»), **cálculos** dichos en voz («cuánto es el 15 por ciento de 230»), **conversiones** de unidades y **monedas** con la tasa de hoy, **temporizadores**, recordatorios, memoria, **música en YouTube** («ponme música de Juanes»), abrir programas y webs, y voces de Microsoft. Todo con servicios gratis sin clave (Open-Meteo, Wikipedia, Google Noticias, open.er-api.com).

**Para conversar de cualquier cosa** usa la IA que tengas (Ajustes → 🧠 Cerebro):
- **En tu PC, sin internet ni clave:** [Ollama](https://ollama.com/download) o [LM Studio](https://lmstudio.ai) abiertos. Elige el modelo de su lista (marca cuáles están cargados, cuáles «piensan» y su tamaño) o deja *Automático*: prefiere uno pequeño (3–8B) que no «piense» de más. La primera vez espera a que el modelo se cargue (puede tardar) y lo deja cargado 30 min; al abrir el avatar lo precalienta.
- **Con una clave gratis:** Groq, Google Gemini, Cerebras, NVIDIA, Mistral, OpenRouter (y de pago: DeepSeek, OpenAI, o tu propia URL compatible con OpenAI). Cada uno muestra **su lista real de modelos** para elegir; *Automático* usa el más rápido para conversar y, si uno no sirve (no existe, no conversa, sin cuota), lo anota y usa otro.
- **Gratis sin cuenta:** si no tiene ninguna otra, usa LLM7 o Kilo (con límites; se puede apagar). Con una clave gratis de LLM7 (la trae de Noviq) tiene más límite y también le sirve de **oído**. Sin ninguna clave puedes elegir el **oído de Windows** (Ajustes → Oído; sin internet, menos preciso).
- **Noviq abierto:** usa la IA más rápida de Noviq.

Las claves se **limpian** («Bearer …», comillas, `GEMINI_API_KEY=…`), se **comprueban** con el servicio al guardarlas (si no sirven no se guardan y te dice por qué; si pegas la de otro servicio la mueve al correcto) y se guardan **cifradas con tu cuenta de Windows**; nunca salen por la API. **«Traer mis claves de Noviq»** se las pide a Noviq (si está cerrado, lo abre y espera) y se queda solo con las que funcionan; el avatar nunca lee la bóveda de Noviq por su cuenta.

## 0.1 Con Noviq

Si Noviq está abierto, el avatar se conecta solo (lee `..\datos\.token`) y **Noviq lo abre al arrancar** (si su motor Electron falta o está dañado, lo descarga de GitHub, verifica su huella SHA‑256 y lo repara solo). La primera vez **hereda** la memoria y los ajustes que tenía dentro de Noviq.

| Pasa en Noviq | El avatar |
|---|---|
| Empieza un trabajo | Se despierta, pone cara de concentrado y trabaja en su panel |
| Usa una herramienta | Icono en el visor (código, lupa, terminal, web…) y la animación que toca |
| Avanza la lista de tareas | Tableta con barra de progreso y la tarea actual |
| Pide permiso | «Necesito tu permiso: … ¿Lo apruebo?» → respondes **sí/no** sin decir su nombre (lo delicado se aprueba en la ventana) |
| La IA te pregunta algo | «Necesito tu ayuda: …» y le contestas hablando |
| Termina | «¡Ya terminé!» y, si quieres, «¿Qué más hacemos?» (y lo recuerda en su memoria) |
| Falla / queda algo a medias | Te lo dice y ofrece continuarlo |

Por voz también: «Noviq, ¿cómo vas?», «Noviq, detente», «Noviq, continúa», «Noviq, abre la ventana», «Noviq, nueva conversación: …», «Noviq, vamos a trabajar en el proyecto X» (las órdenes van a ese proyecto sin mezclar la charla con tus chats), «Noviq, crea una página de recetas» (orden directa → agentes de Noviq). Cómo te avisa de los trabajos lo decides en sus Ajustes → 🔗 Noviq.

---

## 1. Abrirlo a mano (Windows)

1. Doble clic en **`iniciar.bat`**. Si ya está el motor (`node_modules\electron\dist\electron.exe`) abre directo; si falta y tienes **Node.js**, lo descarga; si no tienes Node.js, abre Noviq, que lo repara solo.
2. En sus Ajustes → 🤖 Identidad → *Abrirse al iniciar Windows* puedes hacer que arranque solo, sin esperar a Noviq.

El robot aparece abajo a la derecha y saluda. Verás su icono en la bandeja (clic = ocultar/mostrar, doble clic = ajustes, clic derecho = menú). `electron.exe . --ajustes` abre directo sus ajustes.

**Panel de pruebas:** http://127.0.0.1:7777/panel prueba todos los comandos del cuerpo con botones.

### Crear un .exe (opcional)
```bat
npm run empaquetar
```
Genera en `dist\` un **portable** y un **instalador**. Pon un `config.json` al lado del .exe para configurarlo.

---

## 2. Usar la API

Base: `http://127.0.0.1:7777` (solo accesible desde tu PC).

| Método | Ruta | Uso |
|---|---|---|
| POST | `/comando` | Cuerpo JSON con `"cmd"`. Una **lista** = secuencia. Añade `?esperar=1` para que responda cuando termine la animación. |
| GET | `/cmd/{nombre}?param=valor` | Atajo para probar desde el navegador: `/cmd/decir?texto=Hola` |
| GET | `/estado` | Posición, acción, expresión, modo, si habla, texto visible… |
| GET | `/comandos` | Catálogo completo con descripción y ejemplo de cada comando |
| WS | `/ws` | Envía comandos y recibe **eventos** en vivo |
| POST | `/charla` | Conversa con su mente: `{"texto":"¿qué tengo hoy?","hablar":true}` → `{"respuesta":…,"accion":…}` |
| GET/POST | `/api/ajustes` | Sus ajustes (JSON parcial: `{"voz":{"velocidad":1.1}}`). Las claves nunca se devuelven |
| POST | `/api/claves` | `{"nombre":"groq","valor":"gsk_…"}` guarda una clave (cifrada) |
| GET/POST | `/api/memoria` | Su memoria (leer, agregar/borrar datos, recordatorios, planes, lo aprendido) |
| GET | `/api/herramientas` · POST `/api/herramienta` | Sus herramientas (+ las de Noviq): `{"nombre":"buscar_internet","args":{"consulta":"…"}}` |
| POST | `/api/voz/hablar` · `/api/voz/escuchar` | Texto → audio con su voz · WAV base64 → texto (`"entender": true` para que actúe) |
| POST | `/api/preguntar` | Pregunta al usuario; la respuesta llega por WS como evento `respuesta` `{id, valor: si|no|otro, texto}` |
| POST | `/api/eventos-app` | Cuéntale algo que pasó en tu programa: `{"app":"mi-app","tipo":"nota","texto":"…"}` |
| GET | `/ajustes` | Su página de ajustes |
| GET/POST | `/v1/models` · `/v1/chat/completions` | **Compatible con OpenAI** (con su clave `av-…`, en Ajustes → 🔌 API) |

### Ejemplos rápidos

```bash
curl -X POST http://127.0.0.1:7777/comando -H "Content-Type: application/json" -d "{\"cmd\":\"reir\"}"
curl -X POST http://127.0.0.1:7777/comando -H "Content-Type: application/json" -d "{\"cmd\":\"decir\",\"texto\":\"Hola Gabriel\"}"
curl -X POST "http://127.0.0.1:7777/comando?esperar=1" -H "Content-Type: application/json" -d "{\"cmd\":\"ir\",\"a\":\"centro\"}"
```

**Python** (cliente incluido, sin dependencias — `clientes/noviq_avatar.py`):
```python
from noviq_avatar import NoviqAvatar
av = NoviqAvatar()
av.decir("Voy a revisar tu sistema", esperar=True)
av.analizar(duracion=4000, esperar=True)
av.textear("Encontré 3 archivos duplicados.")
av.herramientas(["engranaje", "codigo", "lupa"])
for p in range(0, 101, 10):
    av.progreso(p, "Limpiando")
av.ir("abajo-derecha")
```

**JavaScript / Node** (`clientes/noviq-avatar.js`):
```js
const { NoviqAvatar } = require('./noviq-avatar');
const av = new NoviqAvatar();
await av.decir('Hola', {}, { esperar: true });
av.eventos((nombre, datos) => console.log(nombre, datos)); // clic, accion_fin, habla_fin…
```

**C#**:
```csharp
using var http = new HttpClient();
await http.PostAsync("http://127.0.0.1:7777/comando",
    new StringContent("{\"cmd\":\"saludar\"}", Encoding.UTF8, "application/json"));
```

También acepta texto plano: `POST /comando` con cuerpo `decir Hola mundo`.

**Conversar con su mente** (misma memoria y personalidad que por voz):
```python
av.charlar("Recuérdame en 20 minutos sacar la ropa")       # lo dice en voz alta y responde el texto
av.recordatorio("Revisar el ATM 3", "mañana a las 9")
av.preguntar("¿Publico la versión?", id="p1")             # la respuesta llega por escuchar_eventos → «respuesta»
av.usar_herramienta("buscar_internet", consulta="dólar hoy Ecuador")
av.cambiar_ajustes(identidad={"personalidad": ["profesor", "tranquilo"]})
```

**Como si fuera un modelo de IA (OpenAI)** — base `http://127.0.0.1:7777/v1`, clave `av-…` (sus Ajustes → 🔌 API):
```python
from openai import OpenAI
bot = OpenAI(base_url="http://127.0.0.1:7777/v1", api_key="av-…")
r = bot.chat.completions.create(model="noviq-avatar", messages=[{"role": "user", "content": "¿Qué recuerdas de mí?"}])
print(r.choices[0].message.content)        # extra_body={"hablar": True} para que además lo diga en voz alta
```

**MCP** (Claude Desktop, VS Code, Cursor, LM Studio, Noviq…): herramientas `avatar_charlar`, `avatar_decir`, `avatar_comando`, `avatar_recordar`, `avatar_recordatorio`, `avatar_memoria`, `avatar_herramienta`, `avatar_estado`.
```json
{ "mcpServers": { "noviq-avatar": { "command": "node",
    "args": ["C:\\…\\noviq-avatar\\clientes\\mcp-avatar.js"],
    "env": { "NOVIQ_AVATAR_URL": "http://127.0.0.1:7777" } } } }
```

### Secuencias
```json
{ "cmd": "secuencia", "repetir": 1, "pasos": [
  { "cmd": "ir", "a": "centro" },
  { "cmd": "saludar", "paralelo": true },
  { "cmd": "decir", "texto": "Analizando..." },
  { "cmd": "analizar", "duracion": 4000 },
  { "cmd": "esperar", "ms": 500 },
  { "cmd": "celebrar" }
]}
```
Cada paso espera al anterior salvo `"paralelo": true`. `detener` cancela la secuencia.

---

## 3. Comandos

Los nombres aceptan español o inglés, con o sin tildes (`señalar` = `senalar` = `point`). `duracion` en milisegundos; `duracion: 0` = repetir hasta nueva orden.

**Acciones**
| Comando | Parámetros | Qué hace |
|---|---|---|
| `saludar` | `lado` | Saluda con la mano |
| `reir` | `duracion` | Se ríe con "JA JA" |
| `sonreir` | `duracion` | Sonríe |
| `pensar` | `texto` | Mano al mentón; con texto, burbuja de pensamiento |
| `textear` | `texto`, `velocidad` | Teclea en teclado holográfico; el texto aparece letra a letra |
| `trabajar` | `duracion` | Maneja un panel de instrumentos |
| `analizar` | `duracion` | Circuitos y paneles de datos salen de la cabeza |
| `herramientas` | `lista` | Herramientas emergen de la cabeza y orbitan |
| `herramienta` | `nombre`, `duracion` | Icono de herramienta dentro del visor |
| `escuchar` | `duracion` | Mano a la oreja y ondas de sonido |
| `aclarar` | | Gesto con ambas manos |
| `senalar` | `direccion`: izquierda/derecha/arriba/abajo/frente | Señala |
| `asentir` / `negar` | | Sí / No con la cabeza |
| `celebrar`, `sorpresa`, `confundido`, `bailar` | `duracion` | |
| `dormir` / `despertar` | | Se duerme (Zzz) hasta que lo despiertes |
| `progreso` | `valor` 0–100, `etiqueta` | Tableta con barra; en 100 muestra ✓ y la guarda |

Cualquier acción acepta `texto` (habla mientras actúa) y `expresion` (cambia su cara).

**Habla y mensajes**
| Comando | Parámetros | |
|---|---|---|
| `decir` | `texto`, `voz` (true/false), `velocidad`, `gestos`, `expresion`, `fijo` | Burbuja + boca sincronizada. `voz:true` usa las voces de Windows |
| `mensaje` | `texto`, `duracion`, `tipo` (mensaje/habla/pensamiento) | Solo burbuja |
| `callar` | | Cierra la burbuja y corta la voz |
| `boca` | `abrir` 0–1 | Lip‑sync con tu propio audio (envíalo ~30 veces/s por WebSocket) |
| `aviso` | `tipo` (exito, error, atencion, permiso, pregunta, info, trabajando, escuchando, saludo, adios), `texto`, `voz`, `fijo` | Mensaje corto con sonido + gesto + expresión (lo que usa Noviq) |

**Sonidos y oído**
| Comando | Parámetros | |
|---|---|---|
| `sonido` | `nombre`: exito, error, atencion, pregunta, info, blip, clic, procesar, pensar, escribir, escuchar, entendido, no_entendi, risa, celebrar, sorpresa, triste, confundido, dormir, despertar, encender, apagar, volar… | Pitido de robot |
| `sonidos` | `activo`, `volumen` 0–1, `automaticos`, `charla` | Configura los sonidos |
| `microfono` | sin parámetros = escucha UNA frase ahora · `modo`: apagado, palabra, siempre, pulsar | Oído |
| `configurar` | `identidad{}`, `voz{}`, `oido{}`, `cerebro{}`, `sonidos{}`, `portapapeles{}`, `apariencia{}`, `herramientas{}`, `noviq{}`, `escala` | Cambia y guarda **sus** ajustes (los mismos de su página) |
| `abrir_ajustes` | `seccion` (voz, oido, cerebro, memoria, api…) | Abre su ventana de ajustes |
| `vincular` | `url`, `token` | Conecta con Noviq (lo hace solo) |
| `abrir_noviq` | | Muestra Noviq (o lo abre si el avatar vive en su carpeta) |

**Mente**
| Comando | Parámetros | |
|---|---|---|
| `charlar` | `texto`, `hablar` | Conversa con su mente (responde y lo dice) |
| `preguntar` | `texto`, `id`, `segundos`, `tipo` (si_no/libre) | Pregunta al usuario; respuesta → evento `respuesta` |
| `escuchar_respuesta` | `segundos` | Acepta lo que digas sin su nombre durante unos segundos |
| `recordar` | `texto` | Guarda un dato en su memoria |
| `recordatorio` | `texto`, `cuando` («mañana a las 9», «en 20 minutos», «los lunes a las 7») | Crea un recordatorio |
| `evento_app` | `app`, `tipo` (nota/fin_trabajo), `texto` | Le cuentas algo que pasó en tu programa |

**Cara y control fino**
| Comando | Parámetros |
|---|---|
| `expresion` | `valor`: neutral, feliz, sonrisa, risa, sorpresa, enfocado, pensando, procesando, dormido, triste, enojado, guino, confundido, atento — con `duracion` es temporal |
| `mirar` | `direccion` o `x`,`y` (−1..1), `duracion`; `frente` suelta, `cursor` sigue el puntero |
| `cabeza` | `giro` (−1..1), `inclinacion` (−1..1), `rotacion` (grados), `duracion` |
| `brazo` | `lado` (izquierda/derecha/ambos), `hombro` 0–180, `codo` −160..120, `muneca`, `gesto`, `duracion` |
| `mano` | `lado`, `gesto`: abierta, relajada, puno, senalar, paz, pulgar, agarrar, garra |
| `pose` | `cabeza{}`, `brazoIzquierdo{}`, `brazoDerecho{}`, `manoIzquierda`, `manoDerecha`, `expresion`, `duracion` |
| `soltar` | Quita el control manual |

"izquierda/derecha" es siempre el lado de la **pantalla**.

**Pantalla y modo**
| Comando | Parámetros |
|---|---|
| `ir` | `a`: centro, arriba, abajo, izquierda, derecha, arriba-izquierda, arriba-derecha, abajo-izquierda, abajo-derecha, cursor; `pantalla` (0, 1…) |
| `mover` | `x`, `y` en píxeles o `"50%"`, `duracion` |
| `desplazar` | `dx`, `dy` |
| `escala` | `valor` 0.3–2 |
| `pasear` / `seguir` | `activo` true/false |
| `ocultar` / `mostrar` | |
| `icono` / `expandir` | Forma minimalista ↔ avatar |
| `interactivo` | `activo: false` → los clics atraviesan incluso al robot |
| `detener` | Para todo y vuelve al reposo |
| `salir` | Cierra la app |

Iconos de herramientas: engranaje, llave, codigo, terminal, lupa, grafico, base_datos, chip, nube, documento, rayo, carpeta, web, escudo, mensaje, red, camara, microfono, musica, reloj, candado, ok.

### Eventos (WebSocket `/ws`)
`listo`, `clic`, `doble_clic`, `accion_inicio`, `accion_fin`, `habla_inicio`, `habla_fin`, `movimiento_fin`, `arrastre_fin`, `modo`, `visibilidad`, `error`, y de su mente: `dice` (lo que va a decir), `charla` (cada intercambio), `voz` (lo que oyó), `respuesta` (a un `preguntar`), `recordatorio`, `ajustes` (cambiaron), `noviq` (conexión).
Formato: `{"tipo":"evento","nombre":"clic","datos":{...}}`. Por el mismo WebSocket puedes enviar comandos; añade `"ref"` para identificar la respuesta.

---

## 4. Ratón
- **Arrastrar** el robot para moverlo (se sorprende al agarrarlo).
- **Clic**: sonríe y emite el evento `clic` (tu programa puede reaccionar, p. ej. abrir el chat de Noviq).
- **Doble clic**: alterna modo icono.
- **Clic derecho**: menú (tamaño, ir a…, pasear, seguir puntero, panel de pruebas, salir).

## 5. Ajustes

**Sus ajustes** (su página `/ajustes`, guardados en `%APPDATA%\Noviq Avatar\ajustes.json`; claves cifradas en `claves.json`):

| Sección | Qué tiene |
|---|---|
| 🤖 Identidad | Nombre (y palabra para llamarlo) + variantes, personalidad (hasta 4 rasgos), iniciativa propia, idioma, indicaciones para él, saludar al abrirse, ojos que siguen al puntero, abrirse con Windows, dormirse tras N min |
| 🗣 Voz | Hablar en voz alta, motor (auto, Microsoft, NVIDIA, Noviq, Windows), voz (catálogo con filtros mujer/hombre, latinas, país, ▶ escuchar), velocidad, tono, volumen, sonidos de robot |
| 🎙 Oído | Cuándo escucha (por su nombre, siempre, al hacer clic, nunca), motor (Groq, NVIDIA, OpenAI, Noviq), sensibilidad, frase más larga, atajo de teclado |
| 🧠 Cerebro | Qué IA usar primero (auto = la más rápida que responda), una tarjeta por servicio con su clave (se prueba al guardarla), **su lista real de modelos** para elegir, ↻ y *Probar*; direcciones de Ollama/LM Studio/tu IA propia; IAs gratis sin cuenta (sí/no); creatividad y largo de respuesta; «Traer mis claves de Noviq» |
| 🧰 Herramientas | Internet, abrir cosas, recordatorios, portapapeles (mirar / solo si le pido / nunca) y ayuda con errores copiados |
| 💾 Memoria | Tu nombre, tus datos, lo que recuerda, recordatorios, planes, respuestas aprendidas, últimas charlas, olvidar todo |
| 🔗 Noviq | Conectarse con Noviq, usar sus herramientas y cómo avisarte de sus trabajos |
| 🔌 API | Dirección, su clave `av-…`, ejemplos (curl, Python, JS, OpenAI, MCP, WebSocket) |

**`config.json`** (técnico: cuerpo y API):
| Clave | Por defecto | |
|---|---|---|
| `puerto` | 7777 | Puerto de la API (o variable `NOVIQ_PUERTO`) |
| `token` | "" | Si lo pones, exige cabecera `X-Noviq-Token` (o `?token=`) — la clave `av-…` también vale |
| `origenesPermitidos` | [] | Webs que pueden llamar a la API desde el navegador (p. ej. `["http://localhost:3000"]`) |
| `escala` | 0.8 | Tamaño |
| `posicionInicial` | abajo-derecha | Si no hay posición recordada |
| `recordarPosicion`, `interactivo`, `dobleClicIcono` | true | |
| `desactivarGPU` | false | Ponlo en `true` si ves un fondo negro en vez de transparente |
| `nivelEncima` | screen-saver | Qué tan «encima» queda |

## 6. Problemas comunes
- **Se cierra al abrir (código 4294930435 / 0xFFFF7003, «crashpad … not connected»):** su motor Electron está dañado o mezclado (p. ej. archivos de otro sistema). Noviq lo detecta y lo vuelve a descargar solo; a mano: ⚙ Ajustes → 🤖 Avatar → *Reparar*. En `datos\avatar_arranque.log` (o `%APPDATA%\Noviq Avatar\avatar_arranque.log`) queda en qué paso se cayó.
- **"Windows no puede encontrar node_modules\electron\dist\electron.exe":** faltaba el motor. Abre Noviq (lo descarga y verifica solo) o usa *Reparar*. También `iniciar.bat` lo descarga si tienes Node.js.
- **No me entiende / «necesito un motor de voz»:** pon una clave gratis de Groq o NVIDIA en sus Ajustes → 🧠 Cerebro, deja activadas las IAs gratis sin cuenta, o conéctalo con Noviq.
- **«…rechazó la clave: no es válida»:** esa clave no es de ese servicio (p. ej. una de Noviq `nvq…` en Gemini) o está vencida. Las de Gemini empiezan por `AIza`, las de Groq por `gsk_`, las de NVIDIA por `nvapi-`. O pulsa «Traer mis claves de Noviq».
- **Ollama / LM Studio «tardó demasiado»:** la primera vez se carga el modelo en la memoria; si pasa siempre, elige uno más pequeño (3–8B) y que no diga «🧠 piensa». LM Studio necesita su servidor encendido (pestaña *Developer* → *Start Server*).
- **No me escucha:** Windows → Configuración → Privacidad → Micrófono → *Permitir que las aplicaciones de escritorio accedan al micrófono*.
- **El atajo no funciona:** otro programa lo usa; el avatar elige otro (lo ves en sus Ajustes → 🎙 Oído) o pon uno distinto.
- **Se escucha a sí mismo:** no pasa: mientras habla o suena, el micrófono se pausa. Con mucho ruido usa *Solo al hacer clic*.
- **Responde a la tele o a otras personas:** dile «**Noviq, aprende mi voz**» (4 frases) y, cuando se confunda, «**eso fue la tele**» (aprende cómo suena el fondo y saca esa frase de la charla). Con mucho ruido: Ajustes → 🎙 Oído → *Voces de fondo* → **Estricto**. En `datos\avatar.log` de Noviq cada frase ignorada dice por qué (`[oído] ignoro «…» (puntaje/umbral: motivos)`).
- **Solo hace sonidos de robot y no habla:** su voz estaba apagada (Ajustes → Voz → *activada*). Dile «**habla en voz alta**» o «**no te escucho**»: la enciende, prueba el motor y te dice la verdad.
- **«Abre Word» abría Edge o no lo encontraba:** arreglado en 2.5 (la palabra «Word» se tomaba como «archivo de Word» y quedaba solo «Microsoft»). Ahora busca el acceso **Word** del menú Inicio.
- **PowerShell no devuelve nada (las órdenes del PC «no hacen nada»):** desde 2.6, la primera vez que pasa prueba sus modos (por la entrada, como argumento con el script entero, en una línea), usa el que funciona y lo recuerda en `%APPDATA%\Noviq Avatar\powershell.json`. En `datos\avatar.log` de Noviq busca `[powershell]`. No hace falta tocar el antivirus.
- **Dice que hace algo y no lo hace / «ya está listo» sin estarlo:** desde 2.6 revisa cada respuesta de la IA antes de decirla: si promete sin hacer nada, lo hace de verdad (vía rápida, un bot o Noviq) o lo dice claro. En `datos\avatar.log` verás `[verdad] …` cada vez que corrigió a la IA.
- **«¿Qué te pasa?» / errores raros:** dile «**hazte un autodiagnóstico**»: revisa voz, oído, PowerShell, la IA (y si se quedó sin cuota), Noviq y los últimos trabajos, y te deja el informe en Word.
- **Fondo negro en vez de transparente:** `"desactivarGPU": true` en `config.json`.
- **"puerto ocupado":** cambia `puerto` (o `NOVIQ_PUERTO`).
- **Un juego a pantalla completa lo tapa:** los juegos en modo exclusivo quedan por encima de todo; usa modo ventana sin bordes.

## Estructura
```
main.js              proceso principal: ventana flotante, vuelo, arrastre, bandeja, ventana de ajustes
preload.js           puente seguro renderer ↔ principal
src/nucleo.js        une todo lo de abajo y define su API propia
src/mente.js         🧠 su mente: palabra de activación, reflejos, IA, planes, órdenes, vida propia
src/memoria.js       💾 su memoria permanente          src/ajustes.js  ⚙ sus ajustes + claves cifradas
src/cerebro.js       IA: elige proveedor y modelo, llama, precalienta los locales, anota los modelos que fallan
src/proveedores.js   cada servicio de IA: su lista real de modelos, cuál conviene, claves y errores explicados
src/saberes.js       sin IA: clima, Wikipedia, noticias, divisas, conversiones, cálculos por voz, días que faltan
src/voz/oido-windows.ps1  oído con el reconocedor de voz de Windows (sin internet; solo si lo eliges en Oído)
src/herramientas.js  🧰 internet, abrir, orden_pc, portapapeles, recordatorios, calculadora (+ las de Noviq)
src/rapido.js        ⚡ vía rápida: órdenes del PC sin IA (abrir, cerrar, apagar, volumen, captura, buscar archivos, proyectos, documentos, Configuración)
src/documentos.js    📄 bot de documentos: investiga (Wikipedia completa + internet), redacta con la IA (o sin ella), crea el .docx, escribe en el Word abierto
src/docx.js          .docx propio sin dependencias (títulos, viñetas, numeración, tablas, enlaces, citas, saltos de página)
src/voz/escucha.js   👂 huella de la voz (MFCC + tono), perfil «tu voz / fondo», detector de TV o ruido constante
src/voz/atencion.js  🎯 «¿me hablan a mí?»: orden/pregunta para él, continuidad, otra persona por su nombre, confianza de Whisper, voz
src/localizador.js   🔎 índice de lo que se puede abrir: menú Inicio, apps (Get-StartApps), escritorio real (OneDrive y público), proyectos
src/mcp-proyectos.js 🗂 servidor interno del bot de proyectos (listar, buscar y leer código, abrir en VS Code, ejecutar)
src/personalidad.js  rasgos, frases, chistes y datos     src/tiempo.js  «mañana a las 8», «en 20 minutos»…
src/voz/             tts.js (voz), stt.js (oído), edge.js (Microsoft), riva.js + grpc.js (NVIDIA), catalogo.js
src/puente-noviq.js  conector con Noviq (sus herramientas, IA, voces, oído y avisos de trabajos)
src/api.js           servidor HTTP + WebSocket (con protección de origen, host y clave)
ajustes/             su página de ajustes (/ajustes)
renderer/            el robot (SVG articulado), motor de animación, efectos, burbujas, sonidos y oído (micrófono)
panel/panel.html     panel de pruebas del cuerpo
clientes/            cliente Python, cliente JavaScript y servidor MCP (mcp-avatar.js)
pruebas/             npm test (mente, API, OpenAI, MCP, cerebro y saberes con servidores falsos; sin Electron) · npm run test-vivo
```

## Bots internos, MCP y visión (2.2.0)

- **Bot principal + bots internos**: el avatar siempre contesta primero; si hay trabajo, lo delega a bots internos (`pc`, `web`, `vision`, `noviq` y uno por cada MCP) que trabajan en segundo plano y avisan al terminar. «¿cómo va?» y «cancela todo» funcionan en cualquier momento.
- **MCP**: Ajustes → Bots y MCP. Presets con un clic (Noviq, archivos, navegador Playwright, fetch, memoria, Windows-MCP) o cualquier servidor stdio/HTTP. Internos: PowerShell, CMD, archivos y control de PC (captura, ventanas, ratón, teclado).
- **Permisos**: `pregunta_todo | pregunta_cambios | solo_peligro`. Antivirus, comandos codificados, bóveda de Noviq y formateo de discos están bloqueados siempre. Registro en `acciones.log`.
- **Visión**: Ajustes → Visión. Cámara apagada por defecto; una imagen por petición, no se guarda. Modelos locales primero (Ollama/LM Studio).
- **El avatar como servidor MCP**: `POST /mcp` (con la clave `av-…`) expone `avatar_charlar, avatar_delegar, avatar_bots, avatar_ver, avatar_herramienta, avatar_decir`.
- API: `/api/mcp/servidores`, `/api/mcp/probar`, `/api/mcp/herramientas`, `/api/mcp/llamar`, `/api/agentes`, `/api/agentes/delegar`, `/api/agentes/cancelar`, `/api/aprobaciones`, `/api/acciones`, `/api/vision`, `/api/vision/camaras`, `/api/vision/ver`.
- Pruebas: `npm test` (+ `node pruebas/prueba-ui-bots.js` con Playwright).

## ⚡ Vía rápida y delegados (2.3.0)

Antes, «apaga la PC» o «abre Hub UI» acababan en los agentes de Noviq, que planificaban durante minutos con IAs gratuitas lentas. Ahora:

1. **Vía rápida (sin IA, 0,1–2 s)** — `src/rapido.js` entiende la orden en español latino («sí, abre…», «¿puedes…?», «quiero que apagues…») y la hace con el **localizador** (`src/localizador.js`): menú Inicio, apps de Windows (`Get-StartApps` → `shell:AppsFolder`), lo que hay en tu **escritorio real** (también el de OneDrive y el Escritorio público, incluidos programas dentro de carpetas) y tus proyectos de `Documentos\Noviq_Proyectos`.
   - abrir / cerrar (como la X: si hay algo sin guardar, el programa pregunta; nunca cierra el sistema, el antivirus ni Noviq)
   - apagar / reiniciar con **1 minuto para arrepentirse** («cancela el apagado»), suspender, bloquear
   - volumen (subir, bajar, silencio, «al 30 %»), minimizar todo, captura de pantalla (Imágenes\Capturas de Noviq)
   - buscar archivos («busca el pdf de la factura» → te dice cuáles y «el segundo» lo abre)
   - proyectos: «ejecuta el juego X» (jugar.bat, iniciar.bat, index.html, main.py, npm…), «abre el proyecto X en VS Code»
2. **Delegados** (bots internos, pocos pasos, en segundo plano): **bot de PC** para crear/mover/organizar/borrar archivos y carpetas o revisar el sistema; **bot de proyectos** para mirar/buscar/leer el código («muéstrame el código del cóndor en el proyecto…») y abrirlo en VS Code en la línea exacta. Los dos prueban la vía rápida antes de pensar con la IA.
3. **Noviq solo para programar** (crear o cambiar software) o si dices «pásaselo a Noviq». Si la IA quiere mandarle a Noviq algo que no es programar, el avatar lo hace con sus propias herramientas (ajuste *A Noviq solo le mando programar*).

Ajustes → Bots y MCP → **⚡ Vía rápida**: activarla, el tiempo para cancelar un apagado y **«Probar una frase»** (dice qué haría y qué abriría, sin hacer nada).
API: `POST /api/rapido/entender {texto}`, `POST /api/rapido/buscar {texto}`, `POST /api/rapido/reindexar`, `GET /api/rapido`. Herramienta de la IA: `orden_pc`.
Arreglos: si un modelo responde con `<tool_call>` en vez del JSON, se usa la herramienta (antes lo decía en voz alta); los textos con tildes en PowerShell ya no se rompen; el avatar encuentra Noviq aunque lo hayan copiado en la raíz de Noviq.
Pruebas: `node pruebas/prueba-rapido.js` (93) y `npm test`.

## 📄 Asistente 2.5: documentos, oído que distingue la TV, órdenes bien repartidas y memoria compacta

**Documentos de Word (bot «documentos», sin Noviq):**
- «Hazme un resumen de la Batalla de Pichincha en Word» · «escribe en el Word un informe sobre las abejas» · «crea una hoja completa de lo que encuentres en internet» · «quiero que crees un resumen dentro del Word que está ahí» · «abre un documento nuevo de Word».
- Sin tema, pregunta «¿Sobre qué tema…?» (tu respuesta vale sin decir «Noviq»). Recuerda el último tema 30 min («hazlo más largo», «el documento que te pedí»).
- Investiga en **Wikipedia completa** (sin «Referencias») + 1-2 páginas de internet, redacta con tu IA usando **solo ese material**, agrega **Fuentes** con enlaces y lo guarda en `Documentos\Noviq Documentos\«Título - fecha».docx` (nunca sobrescribe). Sin IA, lo arma con las secciones encontradas.
- «…en el Word que está abierto»: lo escribe al final del documento abierto (Word COM `InsertFile`); si Word no está abierto, lo abre aparte y te lo dice.
- Crear un documento nuevo es seguro (solo crea, no cambia nada tuyo); escribir en tu Word abierto pide permiso salvo en *solo_peligro*.
- «Abre Word / Microsoft Word / el Word» abre el **Word del menú Inicio** (antes podía abrir Edge). «Abre la configuración de sonido / pantalla / wifi / bluetooth…» abre esa página de Windows.

**Oído: tú vs. TV, radio u otras personas** (Ajustes → 🎙 Oído → *Voces de fondo*):
- Su nombre (al inicio, en medio o al final: «abre YouTube, Noviq») o el clic: **siempre** te escucha.
- Sin nombre (en la charla o en modo «siempre») decide con: ¿es una orden o pregunta para él? ¿sigue el tema? ¿le habla a otra persona («…, Carlos?»)? ¿es narración en tercera persona o muy larga? ¿Whisper estaba seguro? ¿**suena a tu voz** o al fondo aprendido? ¿hay TV encendida (sonido constante)? → más exigente.
- «**Noviq, aprende mi voz**» (4 frases) · «**eso fue la tele / no te hablaba a ti**» (aprende el fondo y borra esa frase de la charla) · «**¿reconoces mi voz?**» · «**olvida mi voz**». El perfil (`voz_perfil.json`) guarda solo números de la voz, nunca audio.
- Con la TV puesta, una orden sin nombre solo se hace si **suena a tu voz**; si no, di su nombre.
- La ventana de charla sin nombre es más corta (7 s; 15 s si te hizo una pregunta).
- Medido: frases reales del 10-10 que lo confundían **44/45 (97,8 %)**; frases nuevas que nunca vio **54/56 (96,4 %)** (te atendió 28/30 e ignoró 26/26 de TV). Voces sintéticas: tu voz 10/10, TV 10/10 (son señales limpias: en tu sala será menor; mejora con «eso fue la tele»).

**Su voz dice la verdad:** «no te escucho / habla en voz alta / solo estás escribiendo / revisa tu voz» → si estaba apagada la enciende; si estaba encendida prueba el motor y ofrece abrir la configuración de sonido. «Habla solo con texto» la apaga. La IA recibe su **estado real** (voz encendida/apagada, micrófono, filtro) y ya no inventa «mi motor de voz funciona perfecto».

**Órdenes bien repartidas:** documentos → bot `documentos` aunque la IA elija `pc` o Noviq; PC → bot `pc`; código → `proyectos`/`programador`; **Noviq solo para lo que ningún bot ni MCP puede** (programar en grande). Los bots aprenden de su **experiencia** (qué bot resolvió pedidos parecidos, aciertos y fallos) y se la pasan a la IA.

**Memoria compacta para la IA (ahorra tokens):** en vez de 25 recuerdos + 25 proyectos + 12 mensajes completos, recibe solo lo **relevante a tu frase** (≤ 1 100 caracteres): tu nombre y datos, los recuerdos que sirven (y los 2 más nuevos), planes, proyecto activo, su experiencia y las notas útiles de `datos\memoria.md` y `memoria_ajustes.md` de Noviq (solo lectura, nunca claves); el historial va recortado (8 mensajes). No repite recuerdos: «le encanta programar en Python» = «disfruta programar en Python»; al arrancar une los repetidos.

API nueva: `GET /api/oido/perfil` · `POST /api/oido/perfil {accion: olvidar | olvidar_fondo}`. Servidor interno MCP `documentos`: `redactar_documento`, `crear_documento`, `documento_nuevo`, `leer_documento`, `mis_documentos`.
Pruebas: `node pruebas/prueba-asistente.js` (55) y `npm test`.

## 🤝 Avatar 2.6: solo es autónomo; con Noviq abierto le pasa lo que no puede

Lo que pasó el 10-10 (registros reales): la conexión con Noviq **sí funcionaba** (latidos, eventos, su IA), pero el avatar **nunca le pasaba trabajo**; su IA (Groq sin cuota → la de Noviq, gpt-oss-20b) **prometía sin hacer** («acabo de delegar», «voy a leer el documento», «estoy a full con tu documento»), dijo «ya está creado» antes de crearlo, inventó «conexión inestable» y **recomendó desactivar el antivirus** (no hacía falta). No podía leer un documento en voz alta ni tenía autodiagnóstico, y creó dos documentos iguales.

**Solo (Noviq cerrado) — autónomo:**
- Usa su IA, sus bots (PC, documentos, internet, visión, proyectos, programador) y sus herramientas. El bot «Noviq» ya no aparece si Noviq está cerrado (la IA lo elegía y fallaba).
- Si algo no lo puede hacer (o un bot falla): te lo dice y pregunta «**¿Lo abro y se lo paso?**». Con «sí» abre Noviq, espera a que conecte y le manda el trabajo.

**Con Noviq abierto — lo usa para lo que no puede:**
- Si un bot falla o responde «no tengo herramientas para…», **se lo pasa a Noviq solo** (con el motivo) y te avisa. Lo que tú rechazaste (permiso) no se le pasa.
- «**pásaselo a Noviq**» manda lo último que pediste. Programar en grande sigue yendo a Noviq; abrir, apagar, documentos y mirar código siguen siendo de sus bots (segundos, no minutos).
- Ajustes → Conexión con Noviq → *Si mis bots no pueden algo, pasárselo a Noviq* (encendido por defecto).

**Verdad:**
- Cada respuesta de la IA se revisa: si promete y no hace, se cumple de verdad (o se dice claro); si delega diciendo «listo», se cambia por «te aviso cuando termine»; nunca manda desactivar el antivirus.
- «¿Ya hiciste el documento?», «¿cómo vamos?», «¿estás trabajando en eso o no?» → responde con los trabajos **reales** (bots y Noviq). La IA también los recibe.
- Lo mismo **en curso** no se lanza dos veces.

**Leer en voz alta:** «léeme el documento», «lee el archivo que dice Batalla de Pichincha», «lee lo que está en la pantalla», «captura la pantalla y léelo». Lee el Word abierto (o el documento con ese nombre) **completo y por partes**; «para» o **un clic en el robot** lo detiene. Sin Word abierto, lee la pantalla con su visión (y si no puede, Noviq).

**🩺 Autodiagnóstico:** «hazte un autodiagnóstico», «revisa tus errores», «¿qué te pasa?» → datos reales (voz, oído y tu perfil de voz, TV de fondo, PowerShell, IA y cuotas, Noviq, últimos trabajos) + cómo arreglarlo; «sí» → informe en Word.

**Nombre:** también entiende «Nodi», «Nomiq», «Nuvic» (así lo escribió Whisper) y ya no los toma como «le habla a otra persona». Solo aprende tu voz cuando se te oye claro y sin TV (el 10-10 se mezclaba con la tele).

Pruebas: `node pruebas/prueba-autonomia.js` (34) y `npm test`.
