# 📥 Bandeja en caliente y 🧭 enrutador de conversaciones (NoviQ 4.7)

## El problema
1. **No se podía pedir nada mientras la IA trabajaba.** `/api/chat` respondía *409 «Esta conversación ya está trabajando»*; la ventana mostraba «⏳ La IA está trabajando…» y Telegram contestaba «Sigo con el pedido anterior». Había que esperar o detener el trabajo.
2. **Todo lo que se le pedía al avatar (y a Telegram) caía en una sola conversación**, aunque fueran temas o proyectos distintos. Solo se abría otra si esa estaba ocupada (sin criterio) o si se decía «nueva».

## 📥 La bandeja (`noviq/bandeja.py`)
- Si la conversación está trabajando, el pedido se **encola** (`POST /api/chat` → **202** `{"encolado": true}`, o `POST /api/conversations/<id>/bandeja`).
- El agente revisa la bandeja **al inicio de cada paso** y **antes de dar el trabajo por terminado**. Lo pendiente entra como mensaje del usuario con instrucciones para integrarlo: corregir el rumbo si cambia lo que se hace, agregarlo al plan (`actualizar_tareas` conservando lo completado), responder si es una pregunta.
- Si el trabajo terminó justo antes de leerlo, el servidor **arranca solo un turno nuevo** con lo pendiente (el cierre del trabajo y el «¿está trabajando?» de `/api/chat` comparten un candado, así que no se pierde nada en la carrera).
- Si pulsaste **Detener**, lo que estaba en cola queda escrito en el chat y «▶ Continuar» lo retoma.
- Se guarda en `datos/bandeja.json` para que no se pierda si cierras el programa. Máximo 20 pedidos por conversación.
- En la ventana: con la IA trabajando y texto en la caja, el botón dice **📥 Agregar**; la barra «📥 En cola» muestra lo pendiente (✕ lo quita antes de que la IA lo lea). Al terminar, el chat se redibuja con tu pedido en su lugar (marcado «📥 agregado mientras trabajaba»).
- Avatar: si hablas mientras el chat abierto trabaja y es el mismo tema, va a su bandeja. Telegram: igual; si es otro tema, se hace en paralelo.
- MCP: `noviq_agregar`.

## 🧭 El enrutador (`noviq/enrutador.py`)
Decide para cada pedido: **misma** · **en_caliente** (misma, pero está trabajando) · **continuar** (otra conversación) · **nueva** (con proyecto o creando uno).

Orden de decisión (lo fiable primero):
1. Frases explícitas: «nueva conversación…», «otro tema…», «crea un proyecto nuevo llamado X…», «continúa / sigue con…».
2. Nombres de tus proyectos en el pedido (sin tildes, mayúsculas, guiones ni espacios; gana el nombre más largo).
3. Parecido de tema (palabras clave del pedido frente a título, pedidos anteriores y tareas de cada conversación de los últimos 14 días). Las respuestas cortas («sí, dale», «y que también…») siguen la conversación actual; si nombran otro tema, no.
4. Solo si queda en duda: la IA más rápida elige entre los candidatos (JSON corto, validado; si falla, se usan las reglas).

Modos: **ventana** (nunca te cambia de chat salvo que lo pidas; si parece otro tema o proyecto, lo sugiere) y **auto** (avatar, Telegram: decide solo). Configuración opcional: `"enrutador": {"activo": true, "ia": true, "dias": 14, "max_candidatos": 40}`. Consulta sin ejecutar: `POST /api/enrutar` o la herramienta MCP `noviq_enrutar`.

## 🏷 Títulos automáticos
El primer pedido de cada conversación se resume en 2–6 palabras con la IA más rápida (en segundo plano; si falla, queda el título de siempre). Se apaga con `"titulos_ia": false`.

## Pruebas
`python -m pytest -q pruebas/` — `pruebas/test_bandeja_enrutador.py` cubre la bandeja, 17 casos del enrutador, los títulos y dos integraciones sin IA real (el servidor encola y arranca el turno siguiente; el agente integra el pedido antes de terminar).

## Investigación: DeepSeek Harness y Hermes Agent
**DeepSeek Harness** (app oficial de DeepSeek, `dsh` 0.2.1-rc.2, licencia MIT; todo son plugins sobre el runtime Cordis) y **Hermes Agent** (Nous Research: memoria, skills que se escriben solas, pasarela a 20+ plataformas, cron). Se estudió la documentación de sus paquetes; no se copió código.

| Idea | Dónde | En NoviQ |
|---|---|---|
| Mensajes del usuario encolados y metidos entre pasos («steering», `agent/inbox`) | dsh-agent-loop | ✅ **Nuevo:** bandeja en caliente |
| Buscar y referenciar otras sesiones (`session_search`, `@sesión`) | dsh-tool-session-query, dsh-session-reference | ✅ **Nuevo:** enrutador (elige y retoma conversaciones por tema) |
| Título de sesión con IA a partir del primer pedido | dsh-session-title-first-prompt-llm | ✅ **Nuevo:** títulos automáticos |
| Objetivo persistente con rondas automáticas (`/goal`) | dsh-goal | ✅ Ya existía: 🧭 director (continúa solo con límites) |
| Plan para aprobar antes de actuar (`/plan`) | dsh-plan-mode | ✅ Ya existía: cerebro + plan aprobable |
| Lista de tareas visible (`todo_write`) | dsh-tool-todo | ✅ Ya existía: `actualizar_tareas` / `marcar_tarea` |
| Aviso si repite la misma herramienta con los mismos argumentos | dsh-repeat-tool-reminder | ✅ Ya existía: detector de bucles + guardián |
| Recortar resultados enormes (cabeza + cola) | dsh-compaction-tool-result-pruner, dsh-spill | ✅ Parcial: modo compacto |
| Pregunta al usuario con tiempo límite (sigue trabajando mientras) | dsh-tool-ask-user (`mode: timed`) | 💡 Propuesta |
| Resumen de archivos cambiados por turno (diff por turno) | dsh-workspace-changes | 💡 Propuesta (hay puntos de restauración) |
| Subagentes en git worktrees aislados | dsh-experimental-worktree, Hermes | 💡 Propuesta |
| Instrucciones por proyecto desde `AGENTS.md` | dsh-agent-instructions | 💡 Propuesta (hoy: instrucciones en los ajustes del proyecto) |
| Memoria con tope que obliga a resumir (`MEMORY.md` / `USER.md`) | Hermes | 💡 Propuesta |
| Skills que la IA guarda tras resolver algo difícil (`SKILL.md`) | Hermes | 💡 Propuesta (hay 🧬 aprendizaje de errores) |
| Revisión automática de permisos por la IA | dsh-experimental-auto-review | ⚠ No recomendado por ahora (la propia DeepSeek lo marca como experimental y riesgoso) |

Fuentes: documentación de los paquetes `@deepseek-ai/dsh-*` incluida en la app instalada; [How to Use DeepSeek Harness](https://docs.kanaries.net/topics/AICoding/deepseek-harness-how-to-use); [What is Hermes Agent](https://parallel.ai/articles/what-is-hermes-agent).
