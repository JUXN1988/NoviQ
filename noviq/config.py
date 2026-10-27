# -*- coding: utf-8 -*-
"""Configuración, rutas y utilidades compartidas."""
import json
import os
import platform
import shutil
import subprocess
import sys
import threading
from pathlib import Path

VERSION = "4.7.2"
# Empaquetado (PyInstaller): los archivos del programa van en _MEIPASS y los datos del usuario en su carpeta personal
FROZEN = bool(getattr(sys, "frozen", False))


def user_data_dir():
    if os.environ.get("NOVIQ_DATOS"):
        return Path(os.environ["NOVIQ_DATOS"]).expanduser()
    if platform.system() == "Windows":
        return Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming") / "Noviq"
    if platform.system() == "Darwin":
        return Path.home() / "Library" / "Application Support" / "Noviq"
    return Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "Noviq"


if FROZEN:
    BASE_DIR = Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
    DATA_DIR = user_data_dir()
else:
    BASE_DIR = Path(__file__).resolve().parent.parent
    DATA_DIR = Path(os.environ["NOVIQ_DATOS"]).expanduser() if os.environ.get("NOVIQ_DATOS") else BASE_DIR / "datos"
CONV_DIR = DATA_DIR / "conversaciones"
CONFIG_FILE = DATA_DIR / "config.json"
MEMORY_FILE = DATA_DIR / "memoria.md"
MCP_FILE = DATA_DIR / "mcp.json"
for d in (DATA_DIR, CONV_DIR):
    d.mkdir(parents=True, exist_ok=True)

IS_WINDOWS = platform.system() == "Windows"

_py_cache = []


def python_exe():
    """Python con el que se ejecuta el código de los proyectos. En el programa instalado (.exe/.app) no se puede usar
    el propio ejecutable de Noviq: se busca el Python del sistema. Devuelve None si no hay ninguno."""
    if not FROZEN:
        return sys.executable
    if _py_cache:
        return _py_cache[0]
    cands = []
    if shutil.which("py"):
        try:
            r = subprocess.run(["py", "-3", "-c", "import sys;print(sys.executable)"], capture_output=True, text=True, timeout=20,
                               creationflags=0x08000000 if platform.system() == "Windows" else 0)
            if r.returncode == 0 and r.stdout.strip():
                cands.append(r.stdout.strip())
        except Exception:
            pass
    for n in ("python3", "python"):
        w = shutil.which(n)
        if w and "WindowsApps" not in w:  # el «python» de la Tienda de Windows solo abre la tienda
            cands.append(w)
    res = next((c for c in cands if Path(c).exists()), None)
    if res:
        _py_cache.append(res)
    return res
OS_NAME = "Windows" if IS_WINDOWS else platform.system()
NO_WINDOW = 0x08000000 if IS_WINDOWS else 0

# Proveedores compatibles con la API de OpenAI (chat/completions). Las claves van en la bóveda cifrada.
DEFAULT_PROVIDERS = {
    "nvidia": {"name": "NVIDIA", "base_url": "https://integrate.api.nvidia.com/v1", "enabled": True,
               "context_chars": 400000, "web": "https://build.nvidia.com/models"},
    "ollama": {"name": "Ollama (local)", "base_url": "http://localhost:11434/v1", "enabled": True, "local": True,
               "context_chars": 60000, "web": "https://ollama.com/download"},
    "lmstudio": {"name": "LM Studio (local)", "base_url": "http://localhost:1234/v1", "enabled": True, "local": True,
                 "context_chars": 60000, "web": "https://lmstudio.ai"},
    "gemini": {"name": "Google Gemini", "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
               "enabled": False, "context_chars": 600000, "web": "https://aistudio.google.com/apikey"},
    "openai": {"name": "OpenAI", "base_url": "https://api.openai.com/v1", "enabled": False,
               "context_chars": 300000, "web": "https://platform.openai.com/api-keys"},
    "anthropic": {"name": "Anthropic (Claude)", "base_url": "https://api.anthropic.com/v1", "enabled": False,
                  "context_chars": 500000, "max_temp": 1.0, "anthropic_headers": True,
                  "web": "https://console.anthropic.com/settings/keys"},
    "openrouter": {"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "enabled": False,
                   "context_chars": 300000, "web": "https://openrouter.ai/keys", "solo_gratis": True},
    "groq": {"name": "Groq", "base_url": "https://api.groq.com/openai/v1", "enabled": False,
             "context_chars": 100000, "web": "https://console.groq.com/keys"},
    "deepseek": {"name": "DeepSeek", "base_url": "https://api.deepseek.com/v1", "enabled": False,
                 "context_chars": 200000, "web": "https://platform.deepseek.com/api_keys"},
    "mistral": {"name": "Mistral", "base_url": "https://api.mistral.ai/v1", "enabled": False,
                "context_chars": 200000, "web": "https://console.mistral.ai/api-keys"},
    "xai": {"name": "xAI (Grok)", "base_url": "https://api.x.ai/v1", "enabled": False,
            "context_chars": 300000, "web": "https://console.x.ai"},
    "cerebras": {"name": "Cerebras", "base_url": "https://api.cerebras.ai/v1", "enabled": False,
                 "context_chars": 120000, "web": "https://cloud.cerebras.ai/"},
    "huggingface": {"name": "Hugging Face", "base_url": "https://router.huggingface.co/v1", "enabled": False,
                    "context_chars": 120000, "web": "https://huggingface.co/settings/tokens"},
    # ── Gratis SIN cuenta ni clave (anónimos, con límites bajos) ──
    "kilo": {"name": "Kilo Gateway (sin cuenta)", "base_url": "https://api.kilo.ai/api/gateway", "enabled": False,
             "context_chars": 200000, "web": "https://kilo.ai", "anonimo": True, "solo_gratis": True},
    "llm7": {"name": "LLM7 (sin cuenta)", "base_url": "https://api.llm7.io/v1", "enabled": False, "context_chars": 200000,
             "web": "https://token.llm7.io", "anonimo": True, "clave_anonima": "unused"},
    "ovh": {"name": "OVHcloud AI Endpoints (sin cuenta)", "base_url": "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1",
            "enabled": False, "context_chars": 100000, "web": "https://endpoints.ai.cloud.ovh.net", "anonimo": True},
    # ── Gratis con cuenta (sin tarjeta) ──
    "zai": {"name": "Z.ai (GLM Flash gratis)", "base_url": "https://api.z.ai/api/paas/v4", "enabled": False,
            "context_chars": 200000, "web": "https://z.ai/manage-apikey/apikey-list", "filtro_gratis": "flash"},
    "cohere": {"name": "Cohere", "base_url": "https://api.cohere.ai/compatibility/v1", "enabled": False,
               "context_chars": 200000, "web": "https://dashboard.cohere.com/api-keys",
               "modelos_fijos": ["command-a-03-2025", "command-a-reasoning-08-2025", "command-a-vision-07-2025", "command-r-plus-08-2024"]},
    "cloudflare": {"name": "Cloudflare Workers AI", "base_url": "https://api.cloudflare.com/client/v4/accounts/{cuenta}/ai/v1",
                   "enabled": False, "context_chars": 100000, "web": "https://dash.cloudflare.com/profile/api-tokens",
                   "necesita_cuenta": True, "modelos_fijos": ["@cf/openai/gpt-oss-120b", "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
                                                                "@cf/qwen/qwen3-30b-a3b-fp8", "@cf/moonshotai/kimi-k2-instruct",
                                                                "@cf/zai-org/glm-4.7-flash", "@cf/google/gemma-3-12b-it"]},
    "aion": {"name": "Aion Labs", "base_url": "https://api.aionlabs.ai/v1", "enabled": False, "context_chars": 100000,
             "web": "https://platform.aionlabs.ai"},
    "pollinations": {"name": "Pollinations", "base_url": "https://gen.pollinations.ai/v1", "enabled": False,
                     "context_chars": 100000, "web": "https://enter.pollinations.ai"},
    "ollamacloud": {"name": "Ollama Cloud", "base_url": "https://ollama.com/v1", "enabled": False, "context_chars": 200000,
                    "web": "https://ollama.com/settings/keys"},
    "vercel": {"name": "Vercel AI Gateway", "base_url": "https://ai-gateway.vercel.sh/v1", "enabled": False,
               "context_chars": 200000, "web": "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys"},
    "custom": {"name": "Otro (compatible OpenAI)", "base_url": "", "enabled": False, "context_chars": 200000},
    "remoto": {"name": "Servidor GPU en la nube (Kaggle)", "base_url": "", "enabled": False, "context_chars": 100000,
               "web": "https://www.kaggle.com/code", "remoto": True},
    # No es de chat: decisiones rápidas tipadas (System One). Lo usa el decisor de Noviq si tiene clave.
    "typesafe": {"name": "TypeSafe Jev (decisiones)", "base_url": "https://api.typesafe.ai/v1", "enabled": False,
                 "decisor": True, "web": "https://typesafe.ai", "modelo": "jev-latest"},
}

DEFAULT_CONFIG = {
    "providers": DEFAULT_PROVIDERS,
    "model": "nvidia::z-ai/glm-5.3-flash",
    "image_model": "black-forest-labs/flux.1-schnell",
    "projects_dir": "",               # vacío = Documentos\Noviq_Proyectos
    "permission_mode": "preguntar",   # preguntar | auto_seguro | auto
    "tool_mode": "auto",              # auto | nativo | texto | ninguno
    "temperature": 0.6,
    "top_p": 0.95,
    "max_tokens": 16384,
    "reasoning_effort": "",
    "max_steps": 40,
    "system_prompt": "",
    "model_overrides": {},            # "prov::modelo": {"tool_mode": "texto", "no_system": true, ...}
    "fallback_enabled": True,         # si una IA falla, continúa con la siguiente
    "fallback_models": [],            # orden de respaldo, ej. ["gemini::gemini-3.8-flash", "ollama::qwen3:8b"]
    "read_timeout": 240,
    "fallback_rounds": 3,
    "ejecutor": "auto",               # agente ejecutor de bloques de código: auto | siempre | nunca
    "modelo_vision": "",              # modelo que analiza imágenes si el principal no ve ("" = automático)
    "modelo_auxiliar": "",            # modelo para subagentes (navegador) ("" = automático)
    "navegador_directo": False,
    "equipo_max": 3,
    "vanguardia": {"activo": False, "planificar": True},
    "modelo_cerebro": "auto",
    "respaldo_auto": True,
    "verificar_modelos": True,        # agente verificador: prueba en segundo plano qué modelos responden
    "solo_operativos": True,          # la lista de modelos oculta los que no funcionan
    "revisar_plan_seg": 30,           # segundos para revisar/editar el plan antes de aprobarlo solo (0 = no esperar)
    "local": {"vram_gb": 16, "ram_gb": 32, "num_ctx": 0, "max_ctx": 32768, "kv_q8": False, "ollama_nativo": True,
              "modo_compacto": "auto", "pensar": "auto", "keep_alive": "30m", "max_steps": 150},
    "pruebas_auto": True,             # agente de pruebas tras cada cambio de código
    "diagnostico_auto": True,         # si el usuario dice que algo no funciona, diagnostica el proyecto antes de que la IA empiece
    # guardián: corta el razonamiento eterno (caracteres/segundos pensando sin actuar) y los bucles de texto repetido
    "guardian": {"activo": True, "max_razonamiento": 16000, "max_seg_razonamiento": 150, "repeticion": True},
    # escalador: si la IA se atasca, pasa el trabajo a la IA más capaz habilitada y con cuota
    "escalado": {"activo": True, "umbral": 5, "max_escalados": 2, "permitir_pago": True},
    # 🏆 evaluador: ranking de IAs por tipo de tarea (estadísticas propias + 👍/👎). elegir_al_inicio: si_falla | siempre | nunca
    "evaluador": {"activo": True, "elegir_al_inicio": "si_falla", "min_datos": 6},
    # 🧭 director: si el trabajo queda a medias, lo continúa solo (con la mejor IA) dentro de estos límites
    "director": {"activo": True, "max_continuaciones": 4, "max_minutos": 120, "espera_error_seg": 30},
    # 📦 entregas: al terminar un trabajo con las pruebas OK se guarda un ZIP de la versión estable en <proyecto>/entregas
    "entregas": {"auto": True, "max": 10},
    # 🗂 copias de respaldo de cada archivo antes de cambiarlo (versiones_archivo); se guardan las últimas N por archivo
    "respaldos": {"max_por_archivo": 40},
    # ⚙ rendimiento: no colapsar la PC. perfil: auto (según la RAM LIBRE) | basico | equilibrado | potente | personalizado
    "recursos": {"perfil": "auto", "reserva_gb": 0, "limitar_wsl": True, "limitar_procesos": True, "preferir_nativo": True,
                 "usar_gpu": "auto", "vista_previa_auto": False, "vista_max_gb": 2.5, "vm_gb": 4, "vm_cpus": 2, "swap_gb": 2,
                 "navegadores": 1, "proc_mb": 2048, "cpu_pct": 75},
    "proyectos_externos": {},         # nombre -> carpeta de proyectos que ya existían en la PC
    # 🎮 Estudio de juegos: detector de intención (auto = abre el estudio al enviar · preguntar = solo sugiere · apagado)
    "juegos": {"detector": "auto", "solo_cc0": False, "buscar_activos": True},
    "modelo_rapido": "",              # IA para tareas cortas (mejorar prompts, diseñar juegos); "" = la más rápida del banco de pruebas
    "prompt_tools": {"barra": True, "correccion_local": True},
    # 🖥 PC: navegador para el agente (auto = el automático; real = tu Chrome abierto con sesiones si está conectado)
    "pc": {"navegador": "auto"},
    "permisos_siempre": [],           # herramientas que el usuario ya permitió «siempre» (se recuerdan entre conversaciones)
    # 🛡 guardia: acciones que SIEMPRE piden aprobación (Noviq + Telegram), aun en automático; sin respuesta en espera_min → se cancela
    "guardia": {"activo": True, "enviar": True, "eliminar": True, "instalar": True, "pagos": True, "espera_min": 30},
    # ✉ cuentas de correo (las claves van cifradas en la bóveda)
    "correo": {"cuentas": [], "predeterminada": ""},
    # 📱 Telegram (el token va cifrado en la bóveda)
    "telegram": {"activo": False, "bot": "", "chat_id": "", "usuario": "", "codigo": "",
                 "avisos": {"tareas": True, "errores": True, "terminado": True, "aprobaciones": True, "notas": False}},
    # 🤖 avatar flotante (carpeta noviq-avatar): cara, voz y oído de Noviq. escuchar: apagado | palabra («Noviq…») | siempre | pulsar
    # motor_voz: auto | local (faster-whisper) | nvidia (Whisper en build.nvidia.com) | nube (Groq/OpenAI) | windows
    "avatar": {"activo": True, "voz": True, "sonidos": True, "volumen": 0.5, "escuchar": "palabra", "motor_voz": "auto",
               "modelo_local": "auto", "herramientas": True, "burbujas_herramientas": False, "anunciar_inicio": False,
               "que_mas": True, "dormir_min": 15, "cerrar_con_noviq": True, "ofrecer_continuar": True, "puerto": 0,
               "limite_nube_hora": 150,
               # 🧠 mente: nombre del bot, personalidad (combinable), autonomía 0-3, portapapeles (observar | pregunta | apagado)
               "nombre_bot": "Noviq", "personalidad": ["animado", "curioso", "divertido"], "autonomia": 2,
               "portapapeles": "observar", "ayuda_portapapeles": True, "modelo_charla": "", "instrucciones_extra": "",
               # 🗣 voz: microsoft (neuronales, gratis) | nvidia (Magpie) | piper (sin internet) | windows
               "voz_motor": "microsoft", "voz_id": "es-EC-LuisNeural", "voz_vel": 1.0, "voz_tono": 1.0, "detector_local": True},
}

_lock = threading.RLock()


def _merge(base, extra):
    out = dict(base)
    for k, v in (extra or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


CONFIG_VERSION = 4


CONFIG_AVISOS = []  # problemas al leer/guardar la configuración (se muestran en ⚙ Ajustes)


def _leer_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def load_config():
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    user = None
    if CONFIG_FILE.exists():
        try:
            user = _leer_json(CONFIG_FILE)
            if not isinstance(user, dict):
                raise ValueError("no es un objeto JSON")
        except Exception as e:
            # Antes un config.json dañado se ignoraba EN SILENCIO y el siguiente guardado lo pisaba con los valores por
            # defecto: parecía que «no se guardaba nada». Ahora se recupera la copia sana y se aparta el archivo dañado.
            import time as _t
            danado = CONFIG_FILE.with_name(f"config.danado_{_t.strftime('%Y%m%d_%H%M%S')}.json")
            try:
                shutil.copy2(CONFIG_FILE, danado)
            except OSError:
                pass
            user = None
            bak = CONFIG_FILE.with_suffix(".json.bak")
            if bak.exists():
                try:
                    user = _leer_json(bak)
                    CONFIG_AVISOS.append(f"config.json estaba dañado ({e}); recuperé la última copia buena. "
                                         f"El archivo dañado quedó en {danado.name}.")
                except Exception:
                    user = None
            if user is None:
                CONFIG_AVISOS.append(f"config.json estaba dañado ({e}) y no había copia; se usan los valores por defecto. "
                                     f"El archivo dañado quedó en {danado.name}.")
            print("[config]", CONFIG_AVISOS[-1])
    if user:
        cfg = _merge(cfg, user)
    if cfg.get("config_version", 0) < CONFIG_VERSION:
        # v2.1: más tokens por respuesta (los modelos con razonamiento se cortaban antes de actuar)
        cfg["max_tokens"] = max(int(cfg.get("max_tokens") or 0), 16384)
        if cfg.get("config_version", 0) < 4:
            # v4: un error 404 «Function not found» se confundía con «no acepta herramientas»; se reaprende
            for ov in (cfg.get("model_overrides") or {}).values():
                if ov.get("tool_mode") == "texto":
                    ov.pop("tool_mode")
        cfg["config_version"] = CONFIG_VERSION
    return cfg


def migrate_keys(cfg):
    """Mueve las claves que estuvieran en texto plano a la bóveda cifrada."""
    if os.environ.get("NOVIQ_SIN_BOVEDA"):  # procesos auxiliares (MCP del programador): nunca tocan la bóveda
        return False
    from . import vault
    changed = False
    for pid, p in cfg["providers"].items():
        keys = p.pop("api_keys", None)
        if keys:
            real = [k for k in keys if k and k not in ("ollama", "lm-studio", "sin-clave") and "…" not in k]
            if real:
                vault.set_keys(pid, list(dict.fromkeys(vault.get_keys(pid) + real)))
            changed = True
    old = BASE_DIR / "config.json"  # versión 1
    if old.exists():
        try:
            o = json.loads(old.read_text(encoding="utf-8"))
            if o.get("api_key") and not vault.get_keys("nvidia"):
                vault.set_keys("nvidia", [o["api_key"]])
            old.rename(old.with_suffix(".json.v1_migrado"))
        except Exception:
            pass
    env_key = os.environ.get("NVIDIA_API_KEY")
    if env_key and not vault.get_keys("nvidia"):
        vault.set_keys("nvidia", [env_key])
    return changed


CONFIG = load_config()
_MIGRADO = migrate_keys(CONFIG)


def save_config():
    """Guarda la configuración de forma SEGURA: escribe un temporal y lo cambia por el real en un solo paso (si el
    programa se cierra a mitad, config.json no queda cortado) y deja config.json.bak con la versión anterior.
    Devuelve True si se guardó; si no, anota el motivo en CONFIG_AVISOS y devuelve False."""
    import time as _t
    with _lock:
        texto = None
        for _ in range(5):  # otro hilo puede estar cambiando CONFIG justo ahora («dictionary changed size…»)
            try:
                texto = json.dumps(CONFIG, indent=2, ensure_ascii=False)
                break
            except RuntimeError:
                _t.sleep(0.05)
        if texto is None:
            CONFIG_AVISOS.append("No se pudo guardar la configuración (estaba cambiando); se reintentará.")
            return False
        tmp = CONFIG_FILE.with_suffix(".json.tmp")
        try:
            tmp.write_text(texto, encoding="utf-8")
            for i in range(8):  # en Windows el antivirus u OneDrive bloquean el archivo un instante
                try:
                    tmp.replace(CONFIG_FILE)
                    break
                except PermissionError:
                    if i == 7:
                        raise
                    _t.sleep(0.25)
            try:  # copia espejo de la última versión buena (se usa si config.json aparece dañado)
                bak_tmp = CONFIG_FILE.with_suffix(".json.bak.tmp")
                bak_tmp.write_text(texto, encoding="utf-8")
                bak_tmp.replace(CONFIG_FILE.with_suffix(".json.bak"))
            except OSError:
                pass
            return True
        except OSError as e:
            CONFIG_AVISOS.append(f"No se pudo guardar config.json: {e}")
            print("[config] no se pudo guardar:", e)
            return False
    return True


if _MIGRADO:
    save_config()


def model_override(model_id):
    return CONFIG.setdefault("model_overrides", {}).setdefault(model_id, {})


def set_override(model_id, key, value):
    with _lock:
        model_override(model_id)[key] = value
        save_config()


# ───────────── Carpeta Documentos real (incluye OneDrive redirigido) ─────────────
_documents = None


def documents_dir() -> Path:
    global _documents
    if _documents:
        return _documents
    p = None
    if IS_WINDOWS:
        try:  # directo con la API de Windows (sin abrir PowerShell: más rápido y sin procesos extra)
            import ctypes
            buf = ctypes.create_unicode_buffer(1024)
            if ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buf) == 0 and buf.value:  # 5 = CSIDL_PERSONAL
                p = Path(buf.value)
        except Exception:
            p = None
        if not p:
            try:
                r = subprocess.run(["powershell", "-NoProfile", "-Command",
                                    "[Environment]::GetFolderPath('MyDocuments')"],
                                   capture_output=True, text=True, timeout=15, creationflags=NO_WINDOW)
                if r.stdout.strip():
                    p = Path(r.stdout.strip())
            except Exception:
                pass
    if not p:
        p = Path.home() / "Documents"
        if not p.exists() and (Path.home() / "Documentos").exists():
            p = Path.home() / "Documentos"
    _documents = p
    return p


def projects_root() -> Path:
    raw = (CONFIG.get("projects_dir") or "").strip()
    if raw:
        p = Path(os.path.expandvars(os.path.expanduser(raw)))
    else:
        p = documents_dir() / "Noviq_Proyectos"
        if not p.exists():
            for oldname in ("Rurak_Proyectos", "NVIDIA_Chat_Proyectos"):  # carpetas de versiones anteriores
                old = documents_dir() / oldname
                if old.exists():
                    try:
                        old.rename(p)
                    except OSError:
                        p = old
                    break
    p.mkdir(parents=True, exist_ok=True)
    return p


META_DIR, META_FILE = ".noviq", ".noviq.json"


def project_path(name) -> Path:
    """Carpeta de un proyecto: los externos (ya existentes en la PC) o los de la carpeta de proyectos."""
    ext = (CONFIG.get("proyectos_externos") or {}).get(name)
    if ext:
        return Path(ext)
    return projects_root() / name


def all_roots():
    """Carpetas donde la IA puede escribir sin pedir permiso (proyectos propios y externos)."""
    return [projects_root()] + [Path(p) for p in (CONFIG.get("proyectos_externos") or {}).values()]


def meta_dir(project, create=True):
    """Carpeta oculta del proyecto (memoria, bitácora, ESTADO.md, respaldos)."""
    base = project_path(project)
    new = base / META_DIR
    for old in (base / ".rurak", base / ".nvchat"):
        if old.exists() and not new.exists():
            try:
                old.rename(new)
            except OSError:
                return old
    if create and base.exists():
        new.mkdir(exist_ok=True)
    return new


def meta_file(project):
    base = project_path(project)
    new = base / META_FILE
    for old in (base / ".rurak.json", base / ".nvchat.json"):
        if old.exists() and not new.exists():
            try:
                old.rename(new)
            except OSError:
                return old
    return new


def general_dir() -> Path:
    """Carpeta para conversaciones sin proyecto."""
    p = projects_root() / "_General"
    p.mkdir(parents=True, exist_ok=True)
    return p


def powershell_exe():
    if IS_WINDOWS:
        # PowerShell 7 (pwsh) si el usuario lo pide; si no, Windows PowerShell 5.1 (siempre instalado)
        if os.environ.get("NVCHAT_USE_PWSH") and shutil.which("pwsh"):
            return "pwsh"
        return "powershell"
    return shutil.which("pwsh")
