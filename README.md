<p align="center"><img src="docs/img/logo.png" width="140" alt="NoviArk"></p>
<h1 align="center">NoviArk</h1>
<p align="center">
<b>Agente de IA que escribe, ejecuta, prueba y corrige programas en tu computadora.</b><br>
<b>An AI agent that writes, runs, tests and fixes programs on your computer.</b>
</p>

<p align="center">
<img alt="Estado" src="https://img.shields.io/badge/estado-en%20actualizaci%C3%B3n-d98a5e?style=flat-square">
<img alt="Python" src="https://img.shields.io/badge/python-3.10%2B-3fe9c4?style=flat-square">
<a href="LICENSE.md"><img alt="Licencia" src="https://img.shields.io/badge/licencia-Community%20(gratis%20personal)-8aff45?style=flat-square"></a>
</p>

<p align="center">
<a href="#-ejecutar"><b>Ejecutar</b></a> ·
<a href="#-capturas"><b>Capturas</b></a> ·
<a href="#-el-avatar-noviq-avatar"><b>Avatar</b></a> ·
<a href="#-comentarios-y-sugerencias"><b>Comentarios</b></a> ·
<a href="#-español">Español</a> ·
<a href="#-english">English</a>
</p>

> **⚠️ En actualización activa.** Estamos mejorando el programa y pueden existir pequeñas fallas que se están corrigiendo. Usa siempre la última versión del repositorio. / **Active development.** We are improving the app and minor bugs may exist while we fix them. Always use the latest version of the repository.

---

## 🇪🇸 Español

NoviArk es un programa de escritorio que recibe lo que quieres construir, crea el proyecto, escribe el código, lo ejecuta, lee los errores y los corrige. Funciona con modelos de IA en la nube (NVIDIA, Google Gemini, OpenAI, Anthropic, OpenRouter y más) o con **modelos locales** en tu PC (Ollama y LM Studio); con modelos locales, tu código no sale de tu equipo.

El repositorio tiene dos partes:

- **NoviArk** (la raíz): el programa principal.
- **[noviq-avatar](noviq-avatar/README.md)**: un robot asistente de escritorio que flota sobre tus programas, tiene su propia memoria y voz, y se conecta con NoviArk para mostrar en qué está trabajando.

### ▶ Ejecutar

Necesitas **Python 3.10 o superior**.

```bash
git clone https://github.com/JUXN1988/noviark.git
cd noviark
# Windows: doble clic en iniciar.bat   (crea el entorno .venv y abre la app)
# Linux / macOS:
bash iniciar.sh
```

La app abre una ventana nativa. También puedes ejecutar `python app.py` y abrir `http://127.0.0.1:7860` en el navegador.

Para el avatar, en Windows entra a `noviq-avatar` y haz doble clic en `iniciar.bat`. La primera vez necesita Node.js.

Luego entra en **⚙ Ajustes → Proveedores y claves**, pega la API key de un proveedor (o conecta Ollama / LM Studio) y empieza a conversar.

### 📸 Capturas

<p align="center"><img src="docs/img/app_inicio_es.png" width="900" alt="Pantalla de inicio de NoviArk"></p>
<p align="center"><img src="docs/img/app_ia_gratis_es.png" width="900" alt="Conectar modelos de IA gratis"></p>
<p align="center"><img src="docs/img/work_es.webp" width="900" alt="NoviArk trabajando en un proyecto"></p>
<p align="center"><img src="docs/img/plan_es.webp" width="440" alt="Plan editable en vivo">&nbsp;<img src="docs/img/picker_es.webp" width="440" alt="Selector de modelos que funcionan"></p>
<p align="center"><img src="docs/img/project_es.webp" width="900" alt="Vista de proyecto a pantalla completa"></p>

### ✨ Qué hace

- **Agente con 40 herramientas**: crear y editar archivos, buscar en el código, ejecutar PowerShell, Python y comandos de Linux, administrar procesos, hacer peticiones HTTP, buscar y leer páginas web, descargar archivos, generar imágenes, captura de pantalla, abrir archivos y programas, y usar un navegador automatizado.
- **Plan antes de actuar**: el agente hace un plan de trabajo que puedes editar o aprobar. Si no haces nada, se aprueba automáticamente tras una cuenta regresiva.
- **Se prueba a sí mismo**: `diagnosticar` revisa el proyecto y reporta problemas con archivo y línea; `probar_web` abre webs y juegos en un navegador invisible y revisa errores de JavaScript, archivos que no cargan y si los controles responden.
- **Guardián de razonamiento**: si un modelo piensa demasiado sin actuar o entra en bucle, NoviArk lo corta y lo obliga a actuar.
- **Escalado**: si el agente se atasca, pasa el trabajo al modelo más capaz que tengas habilitado.
- **Trabajo que no se pierde**: guarda el estado (objetivo, plan, lo hecho, archivos y errores). Si un modelo falla o se queda sin cuota, el siguiente continúa desde ahí.
- **Varios proyectos**, cada uno con su pantalla y su modelo. Puedes importar proyectos que ya tengas en tu PC.
- **Servidores MCP**: mismo formato de configuración que Claude Desktop (`datos/mcp.json`).
- **Seguridad**:
  - Modos de permiso: `preguntar`, `auto_seguro` y `auto`.
  - Copias y puntos de restauración antes de los cambios.
  - Los archivos eliminados van a la Papelera de reciclaje.
  - Escáner de secretos que revisa los proyectos en busca de claves filtradas.
  - Las API keys se guardan en `claves.vault`. En Windows se cifran con DPAPI, así que solo tu usuario de Windows en esa PC puede leerlas. En otros sistemas están ofuscadas y con permisos 600; no están cifradas.
- **Proveedores de IA**: NVIDIA, Google Gemini, OpenAI, Anthropic, OpenRouter, Groq, DeepSeek, Mistral, xAI, Cerebras, Hugging Face, Cohere, Cloudflare Workers AI, Ollama Cloud, Vercel AI Gateway y cualquier API compatible con OpenAI. Puedes guardar varias claves por proveedor.
- **IA local**: Ollama y LM Studio, con el contexto ajustado a la memoria de tu equipo.
- **Interfaz en español e inglés.**

### 🤖 El avatar (noviq-avatar)

Un robot que vive encima de tus programas, con fondo transparente. Tiene su propia mente, memoria, voz y oído, y puede usar las herramientas de NoviArk cuando está abierto.

<p align="center"><img src="docs/img/avatar_estados.webp" width="900" alt="Estados del avatar: saluda, trabaja, analiza, usa herramientas, se ríe y pregunta"></p>

| Estado | Qué hace el robot |
|---|---|
| 👋 Saluda | Se presenta y saluda cuando lo abres. |
| ✍️ Trabaja | Pone cara de concentrado cuando NoviArk empieza un trabajo y escribe en su panel. |
| 🛠 Usa herramientas | Muestra un icono en su visor según la herramienta: código, lupa, terminal o web. |
| ❓ Pide permiso o ayuda | «Necesito tu permiso…» o «Necesito tu ayuda…», y le respondes hablando. |
| ✅ Termina | Dice «¡Ya terminé!» y pregunta qué más hacemos. |

Además: **permisos por voz** (responde sí o no sin decir su nombre), **tareas a la vista** (barra de progreso con la tarea actual), **API compatible con OpenAI** para usarlo desde otras apps, y servidor **MCP**.

### 💬 Comentarios y sugerencias

Como el proyecto está en actualización, tu opinión ayuda mucho:

- **Reportar un error:** [abre un issue de error](https://github.com/JUXN1988/noviark/issues/new?template=bug_report.yml)
- **Proponer una mejora:** [abre una sugerencia](https://github.com/JUXN1988/noviark/issues/new?template=feature_request.yml)
- **Ver lo que se está corrigiendo:** [issues abiertos](https://github.com/JUXN1988/noviark/issues)

### 📄 Licencia

NoviArk se distribuye bajo la **Noviark Community License 1.0** (ver [LICENSE.md](LICENSE.md)). Es **gratis para uso personal, educativo, de investigación y sin fines de lucro**. Las empresas pueden evaluarlo hasta 60 días; el uso comercial continuado requiere una licencia comercial.

El avatar (`noviq-avatar`) tiene su propio `package.json` marcado como `UNLICENSED`; su licencia se definirá aparte.

---

## 🇬🇧 English

NoviArk is a desktop app that takes what you want to build, creates the project, writes the code, runs it, reads the errors and fixes them. It works with cloud AI models (NVIDIA, Google Gemini, OpenAI, Anthropic, OpenRouter and more) or with **local models** on your computer (Ollama and LM Studio); with local models, your code stays on your machine.

The repository has two parts:

- **NoviArk** (the root): the main app.
- **[noviq-avatar](noviq-avatar/README.md)**: a desktop robot assistant that floats above your programs, has its own memory and voice, and connects to NoviArk to show what it is working on.

### ▶ Run

You need **Python 3.10 or newer**.

```bash
git clone https://github.com/JUXN1988/noviark.git
cd noviark
# Windows: double-click iniciar.bat   (creates .venv and opens the app)
# Linux / macOS:
bash iniciar.sh
```

The app opens in a native window. You can also run `python app.py` and open `http://127.0.0.1:7860` in your browser.

For the avatar on Windows, go to `noviq-avatar` and double-click `iniciar.bat`. The first run needs Node.js.

Then go to **⚙ Settings → Providers & keys**, paste an API key from a provider (or connect Ollama / LM Studio) and start a conversation.

### 📸 Screenshots

<p align="center"><img src="docs/img/app_inicio_es.png" width="900" alt="NoviArk home screen"></p>
<p align="center"><img src="docs/img/app_ia_gratis_es.png" width="900" alt="Connect free AI models"></p>
<p align="center"><img src="docs/img/work_en.webp" width="900" alt="NoviArk building an app live"></p>
<p align="center"><img src="docs/img/plan_en.webp" width="440" alt="Editable live plan">&nbsp;<img src="docs/img/picker_en.webp" width="440" alt="Model picker showing only working models"></p>
<p align="center"><img src="docs/img/project_en.webp" width="900" alt="Full-screen project view"></p>

### ✨ What it does

- **Agent with 40 tools**: create and edit files, search code, run PowerShell, Python and Linux commands, manage processes, make HTTP requests, search and read web pages, download files, generate images, take screenshots, open files and programs, and use an automated browser.
- **Plan before acting**: the agent drafts a work plan you can edit or approve. If you do nothing, it is approved automatically after a countdown.
- **Tests its own work**: `diagnosticar` checks the project and reports problems with file and line; `probar_web` opens web apps and games in an invisible browser and checks for JavaScript errors, files that fail to load and whether controls respond.
- **Reasoning guardian**: if a model thinks too long without acting or loops, NoviArk stops it and makes it act.
- **Escalation**: if the agent gets stuck, the work moves to the most capable model you have enabled.
- **Work that is not lost**: keeps the state (goal, plan, done, files, errors). If a model fails or runs out of quota, the next one continues from there.
- **Several projects**, each with its own screen and model. You can import projects you already have on your PC.
- **MCP servers**: same configuration format as Claude Desktop (`datos/mcp.json`).
- **Safety**:
  - Permission modes: `preguntar` (ask), `auto_seguro` (safe auto) and `auto`.
  - Backups and restore points before changes.
  - Deleted files go to the Recycle Bin.
  - A secret scanner checks projects for leaked keys.
  - API keys are stored in `claves.vault`. On Windows they are encrypted with DPAPI, so only your Windows user on that PC can read them. On other systems they are obfuscated with permission 600; they are not encrypted.
- **AI providers**: NVIDIA, Google Gemini, OpenAI, Anthropic, OpenRouter, Groq, DeepSeek, Mistral, xAI, Cerebras, Hugging Face, Cohere, Cloudflare Workers AI, Ollama Cloud, Vercel AI Gateway and any OpenAI-compatible API. You can store several keys per provider.
- **Local AI**: Ollama and LM Studio, with the context size adjusted to your computer's memory.
- **Interface in Spanish and English.**

### 🤖 The avatar (noviq-avatar)

A robot that lives above your programs with a transparent background. It has its own mind, memory, voice and hearing, and can use NoviArk's tools when NoviArk is open.

<p align="center"><img src="docs/img/avatar_estados.webp" width="900" alt="Avatar states: greets, works, analyzes, uses tools, laughs and asks"></p>

| State | What the robot does |
|---|---|
| 👋 Greets | Introduces itself and says hello when you open it. |
| ✍️ Works | Looks focused when NoviArk starts a job and writes in its panel. |
| 🛠 Uses tools | Shows an icon on its visor for the tool in use: code, magnifier, terminal or web. |
| ❓ Asks permission or help | «I need your permission…» or «I need your help…», and you answer by voice. |
| ✅ Finishes | Says «Done!» and asks what to do next. |

Also: **voice permissions** (answer yes or no without saying its name), **tasks at a glance** (progress bar with the current task), an **OpenAI-compatible API** to use it from other apps, and an **MCP** server.

### 💬 Comments and suggestions

Since the project is being updated, your feedback helps a lot:

- **Report a bug:** [open a bug issue](https://github.com/JUXN1988/noviark/issues/new?template=bug_report.yml)
- **Suggest an improvement:** [open a feature request](https://github.com/JUXN1988/noviark/issues/new?template=feature_request.yml)
- **See what is being fixed:** [open issues](https://github.com/JUXN1988/noviark/issues)

### 📄 License

NoviArk is distributed under the **Noviark Community License 1.0** (see [LICENSE.md](LICENSE.md)). It is **free for personal, educational, research and non-profit use**. Companies may evaluate it for up to 60 days; continued commercial use requires a commercial license.

The avatar (`noviq-avatar`) has its own `package.json` marked `UNLICENSED`; its license will be defined separately.

---

<p align="center">© 2026 Noviark Labs</p>
