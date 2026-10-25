# -*- coding: utf-8 -*-
"""🧠 Memoria ordenada en 3 lugares, sin repeticiones, y un mapa de «dónde buscar».

  · usuario  (datos/memoria.md)              → quién es el usuario, gustos, equipos, cómo quiere que trabajes
  · proyecto (<proyecto>/.noviq/memoria.md)  → decisiones, estado, cómo se ejecuta, pendientes de ESE proyecto
  · ajustes  (datos/memoria_ajustes.md)      → qué IAs/servicios funcionan o fallan, claves sin crédito, rutas de
                                               herramientas, configuración que conviene recordar (NUNCA claves)
Problemas reales que arregla: (1) la memoria general tenía el resumen del Tetris DOS veces; (2) con alcance='proyecto'
sin proyecto activo daba ERROR y la IA terminaba guardando cosas del proyecto en la memoria general; (3) ninguna
IA sabía qué había en cada memoria → ahora hay un mapa corto en el prompt y accion='buscar' busca en las tres.
Al guardar algo casi igual a una nota existente, se ACTUALIZA esa nota en vez de duplicarla.
"""
import difflib
import re
import shutil
import unicodedata
from pathlib import Path

from ..config import DATA_DIR, MEMORY_FILE, meta_dir, project_path

AJUSTES_FILE = DATA_DIR / "memoria_ajustes.md"
ALCANCES = ("usuario", "proyecto", "ajustes")
SECRETO = re.compile(r"(nvapi-[A-Za-z0-9_\-]{12,}|sk-[A-Za-z0-9_\-]{16,}|AIza[0-9A-Za-z_\-]{20,}|gsk_[A-Za-z0-9]{16,}|"
                     r"ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[bpas]-[A-Za-z0-9\-]{10,}|\b\d{8,10}:[A-Za-z0-9_\-]{30,})")
AJUSTE_RX = re.compile(r"(?i)\b(modelo|modelos|ia\b|ias\b|api|clave|claves|token|proveedor|cr[eé]dito|cuota|ajuste|"
                       r"configuraci[oó]n|config|gemini|nvidia|ollama|lm ?studio|groq|kimi|nemotron|glm|deepseek|qwen|"
                       r"llama|mistral|openrouter|cerebras|telegram|correo smtp|puerto|ruta de|carpeta de proyectos)\b")


def _norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def archivo(alcance, proyecto=None):
    if alcance == "proyecto" and proyecto:
        return meta_dir(proyecto) / "memoria.md"
    if alcance == "ajustes":
        return AJUSTES_FILE
    return MEMORY_FILE


def _leer(f: Path):
    try:
        return f.read_text(encoding="utf-8") if f.exists() else ""
    except OSError:
        return ""


def entradas(texto):
    """Notas de una memoria (para buscar y resumir): cada «- …» sin sangría empieza una nota; las líneas con sangría
    o el texto suelto se suman a la nota anterior."""
    out, cur = [], []
    for ln in (texto or "").replace("\r\n", "\n").split("\n"):
        if re.match(r"^[-*•]\s+", ln):
            if cur:
                out.append("\n".join(cur).strip())
            cur = [re.sub(r"^[-*•]\s+", "", ln, count=1)]
        elif ln.strip():
            cur.append(ln.strip())
    if cur:
        out.append("\n".join(cur).strip())
    return [e for e in out if e]


def _formato(texto):
    """Una nota nueva: «- primera línea» y el resto con sangría (así nunca se confunde con otra nota)."""
    ls = [x.rstrip() for x in str(texto).strip().split("\n")]
    return f"- {ls[0]}\n" + "".join((f"  {x}\n" if x.strip() else "") for x in ls[1:])


def _parecida(a, b):
    na, nb = _norm(a), _norm(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    sa, sb = set(na.split()), set(nb.split())
    jac = len(sa & sb) / max(1, len(sa | sb))
    if max(len(na), len(nb)) > 1500:
        return jac
    return max(jac, difflib.SequenceMatcher(None, na, nb).ratio())


def _escribir(f: Path, texto):
    f.parent.mkdir(parents=True, exist_ok=True)
    if f.exists():
        try:
            shutil.copy2(f, f.with_suffix(".md.bak"))
        except OSError:
            pass
    tmp = f.with_suffix(".tmp")
    tmp.write_text(texto, encoding="utf-8")
    tmp.replace(f)


def _clave_linea(ln):
    return _norm(re.sub(r"^\s*[-*•]\s+", "", ln))


def limpiar(f: Path):
    """Quita lo repetido sin reordenar nada: (a) bloques de 3 o más líneas seguidas que ya aparecieron antes
    (p. ej. el resumen del Tetris copiado dos veces) y (b) notas de una línea idénticas a otra anterior.
    Deja copia en memoria.md.bak. Devuelve cuántas líneas quitó."""
    txt = _leer(f)
    ls = txt.replace("\r\n", "\n").split("\n")
    k = [_clave_linea(x) for x in ls]
    quitar = set()
    i = 0
    while i < len(ls):
        if not k[i]:
            i += 1
            continue
        mejor = 0
        for j in range(i):
            if k[j] != k[i]:
                continue
            n = 0
            while i + n < len(ls) and j + n < i and (k[i + n] == k[j + n]):
                n += 1
            mejor = max(mejor, n)
        utiles = sum(1 for x in k[i:i + mejor] if x)
        if utiles >= 3:
            quitar.update(range(i, i + mejor))
            i += mejor
            continue
        if re.match(r"^[-*•]\s+", ls[i]) and len(k[i]) >= 25 and (i + 1 >= len(ls) or re.match(r"^[-*•]\s+", ls[i + 1]) or not ls[i + 1].strip()) \
                and any(k[j] == k[i] for j in range(i)):
            quitar.add(i)
        i += 1
    if not quitar:
        return 0
    nuevo = "\n".join(x for n, x in enumerate(ls) if n not in quitar)
    nuevo = re.sub(r"\n{3,}", "\n\n", nuevo).strip() + "\n"
    _escribir(f, nuevo)
    return len([n for n in quitar if k[n]])


def agregar(texto, alcance, proyecto=None):
    """Guarda una nota sin repetir. Devuelve (archivo, accion) con accion = 'nueva' | 'actualizada' | 'igual'."""
    texto = re.sub(r"^\s*[-*•]\s+", "", str(texto or "").strip())
    f = archivo(alcance, proyecto)
    actual = _leer(f)
    nt = _norm(texto)
    if nt and nt in _norm(actual):
        return f, "igual"
    ls = actual.replace("\r\n", "\n").split("\n")
    # notas de UNA línea parecidas: se reemplaza esa línea (la idea se actualiza, no se duplica)
    mejor, idx = 0.0, -1
    for i, ln in enumerate(ls):
        sola = re.match(r"^[-*•]\s+", ln) and (i + 1 >= len(ls) or not ls[i + 1].startswith((" ", "\t")) or not ls[i + 1].strip())
        if sola:
            r = _parecida(texto, ln)
            if r > mejor:
                mejor, idx = r, i
    if mejor >= 0.97:
        return f, "igual"
    if mejor >= 0.86 and "\n" not in texto:
        ls[idx] = "- " + texto
        _escribir(f, "\n".join(ls).rstrip() + "\n")
        return f, "actualizada"
    _escribir(f, (actual.rstrip() + "\n" if actual.strip() else "") + _formato(texto))
    return f, "nueva"


def olvidar(texto, alcance, proyecto=None):
    """Quita las notas que contienen ese texto (la nota completa: su línea «- » y sus líneas con sangría)."""
    f = archivo(alcance, proyecto)
    ls = _leer(f).replace("\r\n", "\n").split("\n")
    q = _norm(texto)
    if not q:
        return 0
    quitar, i, n = set(), 0, 0
    while i < len(ls):
        if re.match(r"^[-*•]\s+", ls[i]):
            j = i + 1
            while j < len(ls) and ls[j].startswith((" ", "\t")) and ls[j].strip():
                j += 1
            bloque = "\n".join(ls[i:j])
            if q in _norm(bloque) or _parecida(texto, bloque) >= 0.86:
                quitar.update(range(i, j))
                n += 1
            i = j
            continue
        i += 1
    if n:
        _escribir(f, "\n".join(x for k, x in enumerate(ls) if k not in quitar).rstrip() + "\n")
    return n


def buscar(texto, proyecto=None, proyectos=()):
    """Busca en las tres memorias (y en las de otros proyectos si se pasan). Devuelve líneas «[lugar] nota»."""
    q = [w for w in _norm(texto).split() if len(w) > 2]
    lugares = [("usuario", MEMORY_FILE), ("ajustes", AJUSTES_FILE)]
    if proyecto:
        lugares.insert(0, (f"proyecto {proyecto}", archivo("proyecto", proyecto)))
    for p in proyectos:
        if p != proyecto:
            f = meta_dir(p, create=False) / "memoria.md"
            if f.exists():
                lugares.append((f"proyecto {p}", f))
    res = []
    for nombre, f in lugares:
        for n in entradas(_leer(f)):
            nn = _norm(n)
            score = sum(1 for w in q if w in nn)
            if score:
                res.append((score, nombre, n))
    res.sort(key=lambda x: -x[0])
    return [f"[{lugar}] {n if len(n) < 600 else n[:600] + '…'}" for _, lugar, n in res[:15]]


def adivinar_alcance(texto, proyecto):
    if AJUSTE_RX.search(texto or ""):
        return "ajustes"
    return "proyecto" if proyecto else "usuario"


def mapa(proyecto=None):
    """Una línea por memoria: cuántas notas hay y de qué tratan (para saber dónde buscar)."""
    def resumen(f):
        ns = entradas(_leer(f))
        if not ns:
            return "vacía"
        temas = "; ".join(re.sub(r"\s+", " ", n)[:60] for n in ns[-3:])
        return f"{len(ns)} notas (últimas: {temas})"
    s = [f"- usuario: {resumen(MEMORY_FILE)}", f"- ajustes: {resumen(AJUSTES_FILE)}"]
    if proyecto:
        s.insert(0, f"- proyecto {proyecto}: {resumen(archivo('proyecto', proyecto))}")
    return "\n".join(s)


def leer(alcance, proyecto=None):
    return _leer(archivo(alcance, proyecto))


def tool(a, ctx):
    """Herramienta `memoria` (reemplaza a la anterior; mismas acciones + buscar/olvidar/limpiar y alcance 'ajustes')."""
    acc = (a.get("accion") or "ver").strip().lower()
    alc = (a.get("alcance") or "").strip().lower()
    texto = str(a.get("texto") or "").strip()
    proyecto = ctx.conv.get("project")
    nota = ""
    if alc in ("todas", "todo", "todos", "") and acc in ("ver",):
        alc = "todas"
    if alc not in ALCANCES and alc != "todas":
        alc = adivinar_alcance(texto, proyecto) if acc in ("agregar", "olvidar") else ("proyecto" if proyecto else "usuario")
    if alc == "proyecto" and not proyecto:
        # antes: ERROR → la IA se quedaba sin guardar o guardaba en la general a ciegas
        try:
            from ..tools import list_projects
            nombres = [p["name"] if isinstance(p, dict) else str(p) for p in list_projects()]
        except Exception:
            nombres = []
        citado = next((n for n in nombres if n and _norm(n) and _norm(n) in _norm(texto)), None)
        if citado and project_path(citado).exists():
            proyecto, nota = citado, f" (no había proyecto activo: lo guardé en el proyecto «{citado}» que mencionas)"
        else:
            alc, nota = "usuario", " (no había proyecto activo: lo guardé en la memoria general del usuario)"
    if SECRETO.search(texto):
        return "ERROR: eso parece una clave o token. Las claves NO se guardan en la memoria: van cifradas en ⚙ Ajustes."
    if acc == "ver":
        if alc == "todas":
            partes = []
            if proyecto:
                partes.append(f"## Proyecto {proyecto}\n" + (leer("proyecto", proyecto).strip() or "(vacía)"))
            partes.append("## Usuario\n" + (leer("usuario").strip() or "(vacía)"))
            partes.append("## Ajustes\n" + (leer("ajustes").strip() or "(vacía)"))
            return "\n\n".join(partes)
        m = leer(alc, proyecto).strip()
        return m or f"(memoria de {alc}{' ' + proyecto if alc == 'proyecto' else ''} vacía)"
    if acc == "agregar":
        if not texto:
            return "ERROR: falta el texto a guardar."
        f, que = agregar(texto, alc, proyecto)
        donde = f"del proyecto {proyecto}" if alc == "proyecto" else ("de ajustes" if alc == "ajustes" else "del usuario")
        return {"nueva": f"Guardado en la memoria {donde}.", "actualizada": f"Actualicé una nota parecida que ya estaba en la memoria {donde} (sin repetir).",
                "igual": f"Eso ya estaba en la memoria {donde}; no lo repetí."}[que] + nota
    if acc == "buscar":
        if not texto:
            return "ERROR: indica qué buscar en 'texto'."
        try:
            from ..tools import list_projects
            todos = [p["name"] if isinstance(p, dict) else str(p) for p in list_projects()][:60]
        except Exception:
            todos = []
        r = buscar(texto, proyecto, todos)
        return ("Encontré en la memoria:\n" + "\n".join(r)) if r else f"No hay nada sobre «{texto}» en las memorias (usuario, ajustes{', proyecto ' + proyecto if proyecto else ''})."
    if acc == "olvidar":
        n = olvidar(texto, alc, proyecto)
        return f"Quité {n} nota(s) de la memoria de {alc}." if n else "No encontré esa nota."
    if acc == "limpiar":
        n = limpiar(archivo(alc, proyecto)) if alc != "todas" else sum(limpiar(archivo(x, proyecto)) for x in ALCANCES if x != "proyecto" or proyecto)
        return f"Quité {n} nota(s) repetida(s)." if n else "No había notas repetidas."
    if acc == "reemplazar_todo":
        f = archivo(alc, proyecto)
        _escribir(f, texto.rstrip() + "\n")
        return f"Memoria de {alc} reescrita (queda copia en {f.name}.bak)." + nota
    return "ERROR: acción inválida (ver | agregar | buscar | olvidar | limpiar | reemplazar_todo)."


TOOL_DEF = {"type": "function", "function": {
    "name": "memoria",
    "description": ("Memoria permanente en 3 lugares: alcance='usuario' (datos y gustos del usuario), 'proyecto' (decisiones, estado, "
                    "cómo ejecutar el proyecto activo) y 'ajustes' (qué IAs/servicios funcionan o fallan, rutas; nunca claves). "
                    "accion='buscar' busca en todas. Al agregar algo parecido a una nota existente, se actualiza (no se repite)."),
    "parameters": {"type": "object", "properties": {
        "accion": {"type": "string", "enum": ["ver", "agregar", "buscar", "olvidar", "limpiar", "reemplazar_todo"]},
        "alcance": {"type": "string", "enum": ["usuario", "proyecto", "ajustes", "todas"]},
        "texto": {"type": "string", "description": "Nota a guardar, o qué buscar/olvidar"}},
        "required": ["accion"]}}}


def para_prompt(conv, compacto=False):
    """Texto de memoria para el prompt del sistema: el mapa y lo más útil (corto en modo compacto)."""
    proyecto = conv.get("project")
    s = ""
    if compacto:
        pm = leer("proyecto", proyecto).strip() if proyecto else ""
        if pm:
            s += "\nMEMORIA DEL PROYECTO:\n" + pm[-700:] + "\n"
        s += "(Memoria: usuario / proyecto / ajustes. Para recordar algo usa memoria accion='buscar'.)\n"
        return s
    um = leer("usuario").strip()
    if um:
        s += f"\n## Memoria sobre el usuario\n{um[-6000:]}\n"
    pm = leer("proyecto", proyecto).strip() if proyecto else ""
    if pm:
        s += f"\n## Memoria del proyecto (decisiones y estado)\n{pm[-8000:]}\n"
    am = leer("ajustes").strip()
    if am:
        s += f"\n## Memoria de ajustes (qué IAs y servicios funcionan)\n{am[-1500:]}\n"
    s += ("\n## Dónde buscar en la memoria\n" + mapa(proyecto)
          + "\nGuarda con `memoria` en el lugar correcto: datos del usuario → 'usuario'; decisiones y estado del proyecto → "
            "'proyecto'; IAs/servicios/configuración → 'ajustes'. Para encontrar algo: accion='buscar'.\n")
    return s
