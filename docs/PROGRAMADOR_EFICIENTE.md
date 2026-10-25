# 🧑‍💻 Programador eficiente — manual de uso

**Versión:** Noviq 4.6.0 (carpeta local; `VERSION` sigue en 4.2.0) · Avatar 2.4.0 · 10-10-2026

## 1. Qué cambió en una frase

Las IAs pequeñas (tu modelo local de 4B en LM Studio, Ollama, modelos gratis) ahora **trabajan como un programador
ordenado**. Antes se perdían por errores de forma, como usar otro nombre de herramienta, poner mal una ruta o repetir
un fragmento. Ahora Noviq corrige esos errores solo y les dice en una línea cómo hacerlo bien la próxima vez.

En el banco de pruebas, con una IA débil simulada que comete los mismos errores de tus registros reales:

| Grupo de tareas | Antes | Ahora |
|---|---|---|
| 32 tareas sacadas de tus registros (27-09 al 10-10) | 7/32 (22 %) | 32/32 (100 %) |
| 16 tareas «de control», escritas después y no usadas para ajustar | 1/16 (6 %) | 12/16 la 1.ª vez (75 %) → 16/16 tras añadir los formatos de parche |
| 10 tareas «a ciegas», escritas al final y ejecutadas una sola vez | 0/10 (0 %) | 8/10 la 1.ª vez (80 %) → 10/10 tras corregir los 2 casos |

La cifra más honesta para errores **nuevos** es la de la primera vez: entre el 75 % y el 80 %. El 100 % se mide
contra pruebas ya conocidas.

## 2. Lo nuevo en Noviq

### 2.1 Traductor de llamadas (invisible)
Si la IA escribe `Read`, `Edit`, `MultiEdit`, `Grep`, `Glob`, `Bash`, `TodoWrite`, `read_file`, `str_replace_editor`,
`mkdir`, `apply_patch`… con argumentos como `file_path`, `old_string` o `pattern`, Noviq hace la acción correcta.
Después responde, por ejemplo: «[Noviq tradujo tu llamada: «Edit» es «editar_archivo»…]». La lista de equivalencias
está en `noviq/experto/alias.json` y la comparten Noviq y el avatar.

Esto también vale para las llamadas escritas como **texto**, en los formatos Qwen `<function=…>`, Hermes `<tool_call>`,
LM Studio `[TOOL_REQUEST]` o un bloque ```json```. En el modo normal, el bloque ```json``` solo se ejecuta si la
respuesta es casi solo ese bloque. Así un ejemplo dentro de una explicación nunca se ejecuta por error.

### 2.2 Rutas tolerantes
Si la ruta no existe, Noviq busca **dentro del proyecto** el archivo que la IA quiso decir:
- solo el nombre (`motor3d.js`, cuando el archivo está en `lib/`);
- otra carpeta de usuario inventada (`C:\Users\gclaudio\…`);
- el nombre del proyecto repetido;
- barras al revés o mayúsculas distintas.

Si hay **una** candidata clara, la usa y lo avisa. Si hay varias, las lista para que la IA elija: nunca adivina.

### 2.3 Edición más precisa (`editar_archivo`)
- Si el texto aparece varias veces, se puede elegir con `ocurrencia=2` o indicando la línea (`desde_linea`).
  Antes esto fallaba **aunque la IA diera la línea**.
- Si falla, el mensaje muestra cada aparición con su número de línea y su contexto.

### 2.4 Búsquedas como las de Claude
- **`explorar_codigo`** (nueva): «¿dónde se controla el salto del jugador?» → archivo y líneas en **una** llamada.
  Usa sinónimos español↔inglés (salto = jump), nombres de funciones y comentarios, y se salta librerías como
  three.min.js.
- **`buscar_en_archivos`**:
  - modos `lineas`, `archivos` y `conteo`, con `limite`, `desde` y `multilinea`;
  - si la regex está mal escrita, busca el texto literal;
  - si no encuentra nada, vuelve a buscar **sin tildes** antes de decir «sin coincidencias».
- **`buscar_archivos`**: `**` funciona de verdad (`src/**/*.js` incluye `src/main.js`) y muestra primero los
  archivos cambiados hace menos.
- **`leer_archivo`**: una línea minificada de 200 KB se recorta, para no llenar el contexto de una IA pequeña.

### 2.5 Ya no confunde «probar otra vez» con un bucle
Volver a ejecutar la misma prueba **después de cambiar un archivo** está permitido. Repetirla sin cambiar nada
sigue bloqueado.

### 2.6 Memoria en 3 lugares, sin repeticiones

| Lugar | Archivo | Qué guarda |
|---|---|---|
| `usuario` | `datos/memoria.md` | quién eres, gustos, equipos, cómo quieres que trabaje |
| `proyecto` | `<proyecto>/.noviq/memoria.md` | decisiones, estado, cómo se ejecuta ese proyecto |
| `ajustes` | `datos/memoria_ajustes.md` | qué IAs y servicios funcionan o fallan, rutas (**nunca claves**) |

- `memoria accion='buscar' texto='…'` busca en los tres lugares y en las memorias de tus otros proyectos.
- Si se guarda algo **casi igual** a una nota que ya existe, esa nota se **actualiza** en vez de duplicarse.
- Antes, `alcance='proyecto'` sin un proyecto abierto daba error. Ahora se guarda en el proyecto que mencione el texto
  o, si no menciona ninguno, en la memoria general, y se avisa dónde quedó.
- `accion='limpiar'` quita bloques repetidos. Cada vez que cambia una memoria se guarda antes una copia `.md.bak`.
- El prompt incluye un **mapa de dónde buscar**: cuántas notas hay en cada lugar y de qué tratan.

### 2.7 Herramientas ocultas
No aparecen en la lista para no gastar tokens, pero funcionan si la IA las llama:
- `crear_carpeta`;
- `aplicar_parche` (bloques SEARCH/REPLACE de Cline/Aider, diff unificado y `*** Begin Patch` de Codex);
- `verificar_codigo`.

## 3. Lo nuevo en el avatar: el **Bot programador**

- Se agrega solo la primera vez que abres el avatar 2.4.0, en *Ajustes → Bots y MCP → servidores*: «Programador de
  Noviq». Si lo quitas, no vuelve a aparecer. Para volver a ponerlo, usa el preset de la misma página.
- **Para qué sirve:** cambios **pequeños** de código (un valor, un texto, un error puntual, una función corta) y
  preguntas como «¿dónde está X en el código?». Programas nuevos y cambios grandes siguen yendo a Noviq.
- **Método que sigue:**
  1. `usar_proyecto`;
  2. `explorar_codigo`;
  3. `leer_archivo`, solo esas líneas;
  4. `editar_archivo`;
  5. `verificar_codigo`;
  6. informe.
- **No necesita Noviq abierto:** usa `noviq_programador_mcp.py` con el Python del `.venv` de Noviq.
- **Seguridad:**
  - solo trabaja dentro de tus carpetas de proyectos;
  - no lee ni cambia archivos de claves (`.env`, `.token`, `claves.*`, `.pem`…);
  - **no ejecuta comandos**;
  - este proceso no puede abrir la bóveda de Noviq (`NOVIQ_SIN_BOVEDA`), para que no se repita el incidente de Avast;
  - cada cambio deja una copia que ven `deshacer_cambio` y el historial de versiones de Noviq.
- **Permisos:** leer no pide permiso. Editar es una «acción»: con tu modo actual (`solo_peligro`) no pregunta, pero
  queda en `acciones.log`.
- Los bots (`pc`, `proyectos`, `programador`) también entienden nombres como `Read`, `Grep`, `mkdir`…, gracias a la
  misma lista `alias.json`.

**Ejemplos por voz:**
- «Noviq, en Aventura en los Andes haz que el cóndor vuele más rápido.»
- «¿Dónde está el control del salto en mi juego?»

## 4. Usarlo desde Claude Desktop u otro programa (opcional)

El servidor es MCP estándar. En `claude_desktop_config.json`:

```json
"noviq-programador": {
  "command": "C:\\Users\\TU_USUARIO\\Proyectos_Programacion\\Noviq\\.venv\\Scripts\\python.exe",
  "args": ["C:\\Users\\TU_USUARIO\\Proyectos_Programacion\\Noviq\\noviq_programador_mcp.py"]
}
```

## 5. Pruebas

```bat
cd C:\Users\TU_USUARIO\Proyectos_Programacion\Noviq
.venv\Scripts\python.exe -m pip install pytest
.venv\Scripts\python.exe -m pytest pruebas -q --junitxml=pruebas\resultados\pytest.xml
.venv\Scripts\python.exe pruebas\banco_programador.py
cd noviq-avatar && npm test
```

O, más fácil, haz doble clic en `pruebas\probar_programador.bat`.

- `pruebas/test_experto.py`: 55 pruebas unitarias (traductor, rutas, edición, búsquedas, parches, memoria, seguridad).
- `pruebas/test_programador_mcp.py`: 4 pruebas del servidor MCP como proceso aparte.
- `pruebas/banco_programador.py`: 58 tareas simuladas sobre el agente real (grupos `registros`, `control` y `ciegas`).
  Escribe los resultados en `pruebas/resultados/`.
- `noviq-avatar/pruebas/prueba-programador.js`: 20 pruebas del bot programador, contra el servidor real.

## 6. Archivos

| Nuevo / cambiado | Qué |
|---|---|
| `noviq/experto/` (nuevo) | `alias.json` + `alias.py` (traductor), `rutas.py`, `explorar.py`, `memoria.py`, `parches.py`, `herramientas.py` |
| `noviq_programador_mcp.py` (nuevo) | servidor MCP del programador |
| `noviq/tools.py` | búsquedas, `leer_archivo`, `ocurrencia`, memoria nueva, registro del experto |
| `noviq/edicion.py` | elegir la aparición correcta (línea u `ocurrencia`) |
| `noviq/agent.py` | traductor en el bucle, permite repetir la prueba tras un cambio, memoria y consejos en el prompt |
| `noviq/compacto.py` | `explorar_codigo` y memoria en el modo para IAs locales |
| `noviq/providers.py` | llamadas escritas como texto con nombres ajenos |
| `noviq/subagente.py` | el traductor también para el equipo de IAs |
| `noviq/vault.py`, `noviq/config.py` | `NOVIQ_SIN_BOVEDA`; carpeta Documentos por la API de Windows (sin abrir PowerShell) |
| `noviq-avatar/src/agentes.js`, `mcp-cliente.js`, `mente.js` | bot programador, siembra, alias compartidos |
| `docs/ARQUITECTURA_BOTS.md` | diagramas de flujo y de clases |
