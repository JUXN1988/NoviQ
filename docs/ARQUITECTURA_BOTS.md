# Arquitectura de bots de Noviq y del avatar (10-10-2026)

Los diagramas están en Mermaid: se ven en GitHub, en VS Code (con la extensión Markdown Preview Mermaid) y en Obsidian.

## 1. Bots agrupados por función

| Función | Avatar (Node/Electron) | Noviq (Python) |
|---|---|---|
| **Interacción con el usuario** | `mente.js` (bot principal: siempre contesta y reparte), `voz/`, `oido`, `personalidad.js` | `agent.py` (chat con herramientas), `intencion.py` (detector de juegos), `prompts.py` (taller de prompts), `voz.py` |
| **Programación** | **bot `programador`** (MCP `noviq_programador_mcp.py`) · bot `proyectos` (mirar/abrir/ejecutar) · encargo a Noviq | `agent.py` + **`experto/`** (traductor, rutas, explorar, parches) · `compacto.py` (IA local) · `subagente.py` (equipo) · `cerebro.py` (plan) · `ejecutor.py` |
| **Gestión de datos y memoria** | `memoria.js` (usuario, planes, charla) | **`experto/memoria.py`** (usuario · proyecto · ajustes) · `estado.py` (ESTADO DEL TRABAJO) · `aprendizaje.py` (lecciones) · `indice.py` (mapa del código) · `versiones.py` (versiones, biblioteca, entregas) |
| **Mantenimiento y calidad** | `agentes.js` → `Permisos` (auditoría `acciones.log`) | `pruebas.py` (pruebas tras cada cambio) · `diagnostico.py` · `evaluador.py` (ranking de IAs) · `banco.py` · `salud.py` · `guardian.py` · `director.py` · `escalado.py` · `recursos.py` (no colapsar la PC) · `guardia.py` (aprobaciones) |
| **Documentos** | **bot `documentos`** (`documentos.js` + `docx.js`): investiga, redacta, crea .docx, escribe en el Word abierto | `herr_windows.py` (oficina) |
| **PC y servicios** | bots `pc` (vía rápida + PowerShell con permisos), `web`, `vision` · `rapido.js` · `localizador.js` | `pc.py`, `navegador.py`, `herr_windows.py` (oficina, correo, agenda, Telegram), `nvidia.py`, `juegos.py` |

Reglas para que no choquen:
- **Una sola lista de nombres** (`noviq/experto/alias.json`), que leen los dos programas.
- **Una sola implementación de las herramientas de código:** el avatar usa las de Noviq por MCP, no copias.
- **Respaldos compartidos:** lo que cambia el avatar aparece en `versiones_archivo` de Noviq.
- **El avatar nunca toca la bóveda de Noviq:** `NOVIQ_SIN_BOVEDA` en el servidor MCP y bloqueos en `mcp-interno.js`.

## 2. Flujo de una orden

```mermaid
flowchart TD
  U([Usuario: voz o texto]) --> M{Mente del avatar}
  M -->|1 paso: abrir, apagar, volumen...| R[⚡ Vía rápida sin IA]
  M -->|varios pasos| D{Delegar al bot}
  D --> PC[Bot pc]
  D --> PR[Bot proyectos: mirar / abrir / ejecutar]
  D --> PG[Bot programador: cambios pequeños]
  D --> W[Bot web / visión]
  M -->|programar en grande| NV[Noviq: agentes]
  PG -->|MCP stdio| S[(noviq_programador_mcp.py)]
  S --> K[Herramientas de Noviq + experto]
  NV --> A[Bucle del agente]
  A --> IA[IA elegida por el evaluador]
  IA -->|llamada| TR[🔤 Traductor: nombres y argumentos]
  TR --> RT[🧭 Rutas tolerantes]
  RT --> H[Herramienta: leer / editar / buscar / explorar / ejecutar]
  H --> PZ[🧪 Pruebas automáticas del archivo cambiado]
  PZ --> RES[Resultado + nota para que la IA aprenda]
  RES --> IA
  A -->|se atasca| ESC[🚀 Escalado a una IA mejor]
  A -->|queda a medias| DIR[🧭 Director: continúa]
  A --> MEM[(🧠 Memoria: usuario · proyecto · ajustes)]
  K --> MEM
```

### 2.1 Oído: ¿me hablan a mí? (avatar 2.5)

```mermaid
flowchart TD
  MIC([Micrófono: un tramo de voz]) --> AN[escucha.js: huella de la voz MFCC + tono, nivel sobre el ruido]
  AN --> PV{PerfilVoz: ¿tu voz o el fondo aprendido?}
  AN --> AMB[Ambiente: ¿sonido constante? → TV]
  PV -->|suena IGUAL al fondo y hay TV| X1[No se transcribe: ahorro]
  PV --> STT[Whisper: texto + confianza]
  STT --> NOM{¿Dijo «Noviq» o hizo clic?}
  NOM -->|sí| OK[Atiende y aprende tu voz]
  NOM -->|no| AT[atencion.js: orden / pregunta / sigue el tema / le habla a otro / narración / confianza / voz / TV]
  AT -->|puntaje ≥ umbral| OK
  AT -->|no| IGN[Ignora y lo anota en datos/avatar.log con los motivos]
  OK --> MEN[Mente: reflejos → vía rápida → bots → IA → Noviq]
  MEN -.->|«eso fue la tele»| FONDO[Aprende el fondo y borra la frase de la charla]
```

### 2.2 Documentos

```mermaid
flowchart LR
  P([«resumen de X en Word»]) --> RP[rapido.js: tipo, tema, extensión, ¿Word abierto?]
  RP -->|sin tema| Q[«¿Sobre qué tema…?»]
  RP --> BD[Bot documentos]
  IA[IA eligió pc o Noviq] -->|se corrige| BD
  BD --> INV[Wikipedia completa + internet]
  INV --> RED[IA redacta SOLO con el material / sin IA: arma con las secciones]
  RED --> DX[docx.js → Documentos/Noviq Documentos]
  DX -->|«en el Word abierto»| COM[Word COM: InsertFile]
  DX --> AB[Lo abre y avisa: palabras y fuentes]
  BD --> EXP[(Experiencia: pedido → bot, aciertos)]
```

### 2.3 Autónomo solo, Noviq para lo que no puede (avatar 2.6)

```mermaid
flowchart TD
  P([Pedido]) --> R{Vía rápida / reflejo}
  R -->|sí| H[Lo hace al instante]
  R -->|no| IA[IA del avatar]
  IA --> V{Verificar: ¿prometió sin hacer? ¿dijo «listo» antes? ¿antivirus?}
  V -->|corrige| C[Cumplir de verdad: vía rápida → bot que ya lo resolvió → Noviq]
  V --> B[Bot propio]
  B -->|bien| OK[Avisa el resultado]
  B -->|falló o «no tengo herramientas»| E{¿Noviq abierto?}
  C --> E
  E -->|sí| NV[Noviq: agentes con todas sus herramientas]
  E -->|no| Q[«¿Lo abro y se lo paso?» → sí → abre, espera y se lo pasa]
  NV --> AV[Noviq avisa al terminar]
```

## 3. Ciclo del programador eficiente (IA pequeña)

```mermaid
sequenceDiagram
  participant IA as IA pequeña (4B)
  participant N as Noviq (agente)
  participant X as experto
  participant F as Archivos del proyecto
  IA->>N: Grep {pattern:"salto"}  (nombre y args de Claude)
  N->>X: alias.normalizar → buscar_en_archivos {regex:"salto"}
  X->>F: búsqueda (y sin tildes si no hay nada)
  F-->>IA: "Sin coincidencias… prueba explorar_codigo" + nota de traducción
  IA->>N: explorar_codigo {pregunta:"¿dónde se controla el salto?"}
  N->>F: términos + sinónimos (salto=jump) + puntaje por zona
  F-->>IA: src/jugador.js líneas 5-9 (en jump)
  IA->>N: Edit {file_path:"jugador.js", old_string, new_string}
  N->>X: rutas.sanar("jugador.js") → src/jugador.js
  X->>F: edicion.aplicar (respaldo, tolerancia, ocurrencia/línea)
  F-->>N: diff
  N->>F: pruebas automáticas del archivo
  N-->>IA: "Editado… ✅ PRUEBAS OK" (+ [Ruta corregida…])
  IA->>N: ejecutar_python (misma prueba otra vez) → permitido: hubo un cambio
```

## 4. Diagrama de clases (lo nuevo y con qué se conecta)

```mermaid
classDiagram
  class ToolContext {
    conv: dict
    emit(kind, payload)
    stop_ev: Event
    cwd: Path
    resolve(ruta) Path
  }
  class tools {
    BUILTIN: list
    FUNCS: dict
    esquema_de(nombre) dict
    t_leer_archivo(a, ctx)
    t_editar_archivo(a, ctx)
    t_buscar_en_archivos(a, ctx)
    t_buscar_archivos(a, ctx)
    t_memoria(a, ctx)
  }
  class alias {
    alias.json
    nombre(n, validos)
    normalizar(n, args, validos, props_de)
    nota_para_ia(nota)
  }
  class rutas {
    sanar(ruta, cwd, raices, quiere)
    mensaje_no_existe(ruta, candidatas, cwd)
  }
  class explorar {
    SINONIMOS
    terminos(pregunta)
    explorar(pregunta, raiz, max_resultados)
  }
  class parches {
    es_parche(texto)
    convertir(texto, ruta) list
    t_aplicar_parche(a, ctx)
  }
  class memoria {
    usuario / proyecto / ajustes
    agregar(texto, alcance, proyecto)
    buscar(texto, proyecto, proyectos)
    limpiar(archivo)
    para_prompt(conv, compacto)
    tool(a, ctx)
  }
  class herramientas {
    CON_RUTA
    con_ruta_sana(nombre, fn)
    t_explorar_codigo / t_crear_carpeta / t_verificar_codigo
    instalar(builtin, funcs)
  }
  class edicion {
    aplicar(texto, viejo, nuevo, todo, rango, ocurrencia)
    _elegir(lineas, rango, ocurrencia)
  }
  class agent {
    run_agent(conv, emit, stop)
    FILE_TOOLS / RERUN_TOOLS
    edit_ver
  }
  class ServidorMCP {
    noviq_programador_mcp.py
    HERRAMIENTAS
    llamar(nombre, args)
    _dentro(ruta) bool
  }
  class Agentes_js {
    bots()
    herramientasDe(bot)
    correr(bot, orden)
    herramientaParecida(nombre, hs)
  }
  class Conexiones_js {
    presets()
    sembrar()
    llamar(id, nombre, args)
  }
  tools --> herramientas : instalar()
  tools --> memoria
  tools --> edicion
  herramientas --> rutas
  herramientas --> explorar
  herramientas --> parches
  agent --> alias
  agent --> tools
  ServidorMCP --> tools
  ServidorMCP --> alias
  Agentes_js --> Conexiones_js
  Conexiones_js --> ServidorMCP : stdio JSON-RPC
  Agentes_js ..> alias : lee alias.json
  tools ..> ToolContext
```

## 5. Seguridad (resumen)

| Riesgo | Protección |
|---|---|
| Una IA escribe fuera de los proyectos | El MCP rechaza rutas fuera de `all_roots()`. Las rutas corregidas solo buscan dentro del proyecto o de la carpeta de proyectos. |
| Leer claves | El MCP rechaza `.env`, `.token`, `claves.*`, `.pem`, `.key`, `id_rsa`… La memoria rechaza textos con forma de clave. El proceso MCP no puede abrir la bóveda (`NOVIQ_SIN_BOVEDA`). |
| Antivirus (incidente del 01-10) | Ni el avatar ni el MCP usan DPAPI ni `-EncodedCommand`. La carpeta Documentos se lee con la API de Windows, sin abrir PowerShell. |
| Ejecutar algo por error | El MCP del programador no ejecuta comandos. Un bloque ```json``` solo se ejecuta si es casi toda la respuesta. Los alias nunca adivinan herramientas desconocidas (umbral 0,86–0,88). |
| Que la TV dé órdenes | Sin su nombre, la frase pasa por `atencion.js` (texto + voz + ambiente). Con TV, una orden sin nombre solo se hace si suena a tu voz. El perfil de voz guarda números, nunca audio. |
| Documentos | Solo crea archivos NUEVOS en `Documentos\Noviq Documentos` (nunca sobrescribe); escribir en tu Word abierto pide permiso de acción. El script de Word recibe la ruta por variable de entorno (sin `-EncodedCommand`). |
| Memoria hacia la IA | Solo lo relevante (≤ 1 100 caracteres); las líneas con forma de clave nunca se guardan ni se envían; las notas de Noviq se leen, no se escriben. |
| Perder código | Copia antes de cada cambio, `deshacer_cambio`, `versiones_archivo`. Los parches nunca borran archivos. |
