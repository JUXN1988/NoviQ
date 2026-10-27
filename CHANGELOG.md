# Changelog / Historial de cambios

## v4.7.1 — 2026-10-26
- **⚡ Fast path for simple tasks / Vía rápida.** Information and notification requests (news, weather, prices, search, summaries, send by Telegram/email, reminders) run directly: no project diagnosis, no architect plan or plan review, no file tree in the instructions, at most 20 steps, and a clear guide to use `buscar_en_internet`, `leer_pagina_web` and `telegram`. Real case fixed: «Revisa las noticias… y envíalas por Telegram» took 5 minutes and 40+ steps editing `.env` and scripts. / Las tareas simples se hacen directo.
- The bug detector no longer treats «revisa / corrige / arregla» alone as «fix the project», and never auto-diagnoses `_General`. / «Revisa» solo ya no dispara el diagnóstico.
- The `telegram` tool now says it sends any message the user asks for (not only urgent notices). / La herramienta telegram se describe mejor.

## v4.7.0 — 2026-10-25
- **📥 Requests while it works / Peticiones en caliente.** Messages sent while a conversation is working are no longer rejected (HTTP 409). They go to that conversation's inbox and the agent merges them into its plan at the next step; if the job had just finished, a new turn starts with them. Works from the window (button «📥 Agregar», queue bar with ✕), the avatar, Telegram and MCP (`noviq_agregar`). / Lo que pides mientras trabaja entra en la bandeja y se integra al plan en el siguiente paso, sin detenerlo.
- **🧭 Conversation router / Enrutador de conversaciones.** Each request goes to the same conversation, resumes another one, opens a new one (also inside the project you name) or creates a new project. Rules first, the fastest AI only when in doubt. The avatar and Telegram no longer put everything into a single conversation; Telegram no longer answers «busy» (other topics run in parallel). MCP: `noviq_enrutar`. / Cada pedido va a su conversación o proyecto.
- **🏷 Automatic titles / Títulos automáticos** with the fastest AI (`"titulos_ia": false` turns it off).
- Fixes / Arreglos: the release workflow now uploads the files the build scripts really produce (`Noviq-*`); test fixtures no longer leave folders in your projects folder; visible name «NoviQ» in the window title.
- Ideas studied from DeepSeek Harness and Hermes Agent: see `docs/BANDEJA_Y_ENRUTADOR.md`.

## v4.3 – v4.6 — 2026-09/10
Game studio (2D, 3D, voxel, 2D/3D figures), avatar 2.x (connected, own mind and voices, independent, bots, MCP, vision, fast lane), efficient programmer MCP, Telegram, email, schedule, office tools, test bench, AI evaluator and director. / Estudio de juegos, avatar 2.x, programador eficiente, Telegram, correo, agenda, oficina, banco de pruebas, evaluador y director.

## v4.2.0 — 2026-09
**New name: NoviQ** (formerly Noviq, Rurak and NVIDIA Chat). Your data and key vault keep working.
**Nuevo nombre: NoviQ** (antes Noviq, Rurak y NVIDIA Chat). Tus datos y tu bóveda de claves siguen funcionando.

- Reasoning guardian: stops models that think too long or loop, and makes them act / Guardián de razonamiento.
- Escalation to the most capable enabled model when the agent gets stuck / Escalado a la IA más capaz.
- New debugging tools: `diagnosticar` (prioritized problems with file:line) and `probar_web` (invisible browser tests for web apps and games) / Herramientas nuevas para depurar.
- Safer file editing: encoding detection, tolerant `editar_archivo`, warnings when files shrink or contain placeholders, safer PowerShell writes / Edición de archivos más segura.
- Model list shows only working models, best first; several keys per provider / Solo modelos operativos; varias claves por proveedor.
- Live editable plan, live writing, per-project screens and models, environments, smoke tests and secret scanner / Plan en vivo editable, escritura en vivo, entornos, pruebas y escáner de secretos.
- "System One" decider for fast typed decisions; Kaggle GPU server; 20+ providers / Decisor, servidor GPU en Kaggle, 20+ proveedores.
- Build scripts for installers (Windows .exe + portable, Ubuntu/Debian .deb, macOS .dmg) and a GitHub Actions workflow; no installers are published yet / Scripts para compilar instaladores (aún no hay instaladores publicados).
- English and Spanish UI with automatic detection / Interfaz en inglés y español.

## v4.1
Model health checks and NVIDIA 404 failover, planning brain, timed phases, parallel conversations, continuous learning, PC control, scheduled tasks.

## v4.0
Local AI with context sized to VRAM, compact mode, project indexer and tests, free AI providers.

## v3.0
AI team (multi-agent), code-runner agent, Chrome/Edge control, automatic vision for any model, surgical file edits.
