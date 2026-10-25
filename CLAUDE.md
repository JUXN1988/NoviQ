# NoviQ — guía para Claude

Agente de IA de escritorio de Gabriel (Flask + pywebview en Python; avatar en Electron). Repositorio público: **JUXN1988/NoviQ** (antes `noviark`; GitHub redirige el nombre viejo). Web pública: https://juxn1988.github.io/NoviQ/ (GitHub Pages desde `main`, raíz: `index.html`, `css/`, `js/`, `docs/img/`).

## Cómo conectarse y subir cambios (cualquier conversación, nueva o no)
1. La app Claude de GitHub ya está instalada en el repo. Agrega el repo a la sesión con acceso de escritura: `add_repo` → owner `JUXN1988`, repo `NoviQ`, access `push`, y clónalo donde indique.
2. Identidad de los commits: `git config user.name "Claude"` y `git config user.email "noreply@anthropic.com"`. Termina cada mensaje con las líneas de atribución que indique la sesión.
3. Rama `main`; push directo a `origin main` solo cuando Gabriel lo pida (en este proyecto lo pide siempre que «sube a GitHub»).
4. Si el push da 403: la app de GitHub no está instalada o no tiene acceso a ese repo; pídele que la instale en el repo (no inventes otros métodos).

## Dónde está el código vivo
- El programa real está en la PC de Gabriel: `F:\RESPALDOS_PROYECTOS_2026\NoviQ` (carpeta conectada desde la app de escritorio de Claude). Ese es el original: **cópialo de ahí, compara y no lo pises**; haz respaldo (`.respaldos/`) antes de escribir archivos en su PC.
- **Nunca subir**: `.venv/`, `.respaldos/`, `.respaldo_*`, `.hub*`, `.noviq/`, `datos/` (claves, conversaciones), `web/` (código de la web comercial), `entregas/` (zips), `noviq-avatar/node_modules/`, `noviq-avatar/pruebas/` (tiene claves de prueba). Escanea secretos (nvapi-, sk-, AIza, gsk_, hf_, xai-, ghp_, tokens de bots) y rutas personales (`C:\Users\<usuario>`) antes de cada commit.

## Reglas del contenido público
- Solo lo que el programa hace de verdad (verifícalo en el código: p. ej. `len(noviq.tools.FUNCS)` en ejecución = 62 herramientas en 4.7).
- **No hay instaladores publicados**: no prometas `.exe`, `.deb` ni `.dmg`; se ejecuta con `iniciar.bat` (Windows) o `bash iniciar.sh` (Linux/macOS). Los scripts de `packaging/` y `.github/workflows/release.yml` existen para compilarlos.
- Licencia: **Licencia NoviQ de Uso Personal 1.0** (`LICENSE.md`): gratis para personas; empresas, microempresas y uso comercial pagan. Nombre visible: **NoviQ**. En el código, carpetas, ejecutables y datos se llaman `Noviq`/`noviq` (no los renombres: cambiaría dónde se guardan los datos del usuario).

## Probar
```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt pytest
NOVIQ_DATOS=/tmp/noviq_datos .venv/bin/python -m pytest -q pruebas/
```
`NOVIQ_DATOS` aísla los datos de prueba. Comprueba también `python -m py_compile` y `node --check` en los `.js` que cambies.

## Mapa rápido
- `app.py`: servidor (rutas `/api/*`), trabajos por conversación (`start_job`), 📥 bandeja y 🧭 enrutador en `/api/chat`.
- `noviq/agent.py`: ciclo del agente; `noviq/director.py`: continúa trabajos a medias; `noviq/bandeja.py`: peticiones en caliente; `noviq/enrutador.py`: a qué conversación/proyecto va cada pedido; `noviq/tools.py`: herramientas.
- `noviq/avatar_agente.py` + `noviq-avatar/`: avatar; `noviq/telegram_bot.py`; `noviq_mcp.py`: MCP de control.
- `static/`: interfaz de la ventana (`app.js`, traducciones en `i18n_en.json`).
- Diseño de la bandeja y el enrutador, e investigación de DeepSeek Harness / Hermes: `docs/BANDEJA_Y_ENRUTADOR.md`.
