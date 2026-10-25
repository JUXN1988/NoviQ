# -*- coding: utf-8 -*-
"""📚 Versiones, entregas y biblioteca: lo que un programador profesional hace con su código.

1. VERSIONES DE CADA ARCHIVO (versiones_archivo): antes de cambiar cualquier archivo Noviq guarda una copia en
   <proyecto>/.noviq/respaldos con un índice (qué archivo era, cuándo, en qué conversación y por qué). Las copias
   sirven entre conversaciones: se pueden listar, ver, comparar y restaurar (cualquier versión, no solo la última).
   Antes dos archivos con el mismo nombre en carpetas distintas (src/main.js y lib/main.js) se mezclaban.
2. ENTREGAS (empaquetar_proyecto): un ZIP limpio y numerado de la versión que funciona, en <proyecto>/entregas, con
   un ENTREGA.txt (fecha, archivos, huellas SHA-256, nota). Se crea solo al terminar un trabajo con las pruebas OK.
3. BIBLIOTECA (biblioteca): archivos o carpetas útiles (un login, un conector, un componente…) guardados en
   Noviq_Proyectos/_Biblioteca con su descripción, para reutilizarlos en otros proyectos.
"""
import difflib
import hashlib
import json
import os
import re
import shutil
import threading
import zipfile
from datetime import datetime
from pathlib import Path

from .config import CONFIG, general_dir, meta_dir, projects_root

_lock = threading.RLock()
EXCLUIR_DIRS = {".git", ".noviq", "node_modules", ".venv", "venv", "env", "__pycache__", ".idea", ".vs", ".vscode",
                "dist", "build", ".next", ".gradle", "bin", "obj", ".mypy_cache", ".pytest_cache", "entregas", "capturas",
                ".parcel-cache", "coverage", "target"}
EXCLUIR_EXT = {".pyc", ".pyo", ".log", ".tmp", ".bak", ".swp"}


# ═════════════════════════════ 1. VERSIONES DE ARCHIVOS ═════════════════════════════
def _carpeta(ctx):
    base = meta_dir(ctx.conv["project"]) if ctx.conv.get("project") else general_dir() / ".noviq"
    d = base / "respaldos"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _rel(ctx, p: Path):
    try:
        return p.resolve().relative_to(ctx.cwd.resolve()).as_posix()
    except (ValueError, OSError):
        return str(p)


def _indice(d: Path):
    f = d / "indice.json"
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _guardar_indice(d: Path, data):
    f = d / "indice.json"
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=0), encoding="utf-8")
    tmp.replace(f)


def registrar_copia(ctx, p: Path, copia: Path, nota=""):
    """Anota una copia en el índice del proyecto y borra las más viejas de ese archivo (se guardan las últimas N)."""
    try:
        with _lock:
            d = copia.parent
            idx = _indice(d)
            rel = _rel(ctx, p)
            idx.append({"copia": copia.name, "ruta": rel, "abs": str(p), "t": datetime.now().isoformat(timespec="seconds"),
                        "conv": ctx.conv.get("id", ""), "nota": nota[:200], "bytes": copia.stat().st_size if copia.exists() else 0})
            maxn = int((CONFIG.get("respaldos") or {}).get("max_por_archivo", 40))
            mias = [e for e in idx if e.get("ruta") == rel]
            if len(mias) > maxn:
                for e in mias[:-maxn]:
                    if e.get("fija"):
                        continue
                    try:
                        (d / e["copia"]).unlink()
                    except OSError:
                        pass
                    idx.remove(e)
            _guardar_indice(d, idx)
    except Exception:
        pass


def _versiones(ctx, p: Path):
    """Todas las copias de un archivo (las del índice y las antiguas .bak sin índice), de la más nueva a la más vieja."""
    d = _carpeta(ctx)
    rel = _rel(ctx, p)
    idx = _indice(d)
    out = []
    indexadas = {e.get("copia") for e in idx}
    for i, e in enumerate(idx):
        if e.get("ruta") == rel or e.get("abs") == str(p):
            f = d / e["copia"]
            if f.exists():
                out.append(dict(e, _f=f, _orden=(e.get("t", ""), i)))
    for f in d.glob(p.name + ".*.bak"):  # copias de versiones anteriores de Noviq (solo tenían el nombre, sin índice)
        if f.name in indexadas:
            continue
        m = re.search(r"\.(\d{8})_(\d{6})(?:_\d+)?\.bak$", f.name)
        t = (datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S").isoformat(timespec="seconds") if m else "")
        out.append({"copia": f.name, "ruta": rel, "t": t, "nota": "(copia antigua: puede ser de otro archivo con el mismo nombre)",
                    "bytes": f.stat().st_size, "_f": f, "_orden": (t, -1)})
    out.sort(key=lambda e: e["_orden"], reverse=True)
    return out


def _leer(f: Path):
    from . import texto as TX
    try:
        return TX.read_text(f)
    except Exception:
        return f.read_bytes().decode("utf-8", "replace")


def t_versiones_archivo(a, ctx):
    from .tools import _backup, cut, file_event
    acc = (a.get("accion") or "listar").lower()
    p = ctx.resolve(a.get("ruta", ""))
    if acc == "todas":  # resumen de todos los archivos con copias
        idx = _indice(_carpeta(ctx))
        cuenta = {}
        for e in idx:
            cuenta.setdefault(e.get("ruta"), []).append(e.get("t", ""))
        if not cuenta:
            return "Todavía no hay copias de respaldo en este proyecto."
        filas = sorted(cuenta.items(), key=lambda x: max(x[1]), reverse=True)
        return "Archivos con versiones guardadas (archivo — nº de versiones — última):\n" + "\n".join(
            f"- {r} — {len(ts)} — {max(ts).replace('T', ' ')}" for r, ts in filas[:80])
    if not a.get("ruta"):
        return "ERROR: indica ruta (el archivo). Usa accion='todas' para ver qué archivos tienen versiones."
    vers = _versiones(ctx, p)
    if acc == "guardar":
        if not p.exists():
            return f"ERROR: no existe {p}."
        dest = _backup(ctx, p, nota=a.get("nota") or "versión guardada a mano", forzar=True)
        if dest:
            _fijar(ctx, dest.name, a.get("nota") or "versión guardada a mano")
        return f"✔ Versión de {p.name} guardada ({dest.name if dest else '—'}). No se borrará automáticamente."
    if not vers:
        return (f"No hay versiones guardadas de {p.name}. (Se guardan solas cada vez que la IA lo modifica; usa "
                "accion='guardar' para guardar la versión actual.)")
    if acc == "listar":
        lineas = []
        actual = _leer(p) if p.exists() else None
        for i, e in enumerate(vers, 1):
            try:
                txt = _leer(e["_f"])
                n = txt.count("\n") + 1
                igual = " (= actual)" if actual is not None and txt == actual else ""
            except Exception:
                n, igual = "?", ""
            lineas.append(f"{i}. {e.get('t', '').replace('T', ' ')} · {n} líneas · {e.get('bytes', 0)} bytes{igual}"
                          + (f" · {e['nota']}" if e.get("nota") else ""))
        return (f"Versiones de {_rel(ctx, p)} (1 = la más reciente; la actual es la del archivo):\n" + "\n".join(lineas[:60])
                + "\n→ versiones_archivo(accion='diferencias', version=N) para comparar o accion='restaurar', version=N para volver.")
    try:
        n = int(a.get("version") or 1)
    except (TypeError, ValueError):
        return "ERROR: version debe ser un número de la lista (1 = la más reciente)."
    if not 1 <= n <= len(vers):
        return f"ERROR: hay {len(vers)} versiones (1 a {len(vers)})."
    e = vers[n - 1]
    txt = _leer(e["_f"])
    if acc == "ver":
        ls = txt.split("\n")
        d_, h_ = int(a.get("desde_linea") or 1), int(a.get("hasta_linea") or min(len(ls), 400))
        return (f"Versión {n} de {p.name} ({e.get('t', '').replace('T', ' ')}), líneas {d_}-{h_} de {len(ls)}:\n"
                + cut("\n".join(f"{i:>5}\t{ls[i - 1]}" for i in range(max(1, d_), min(len(ls), h_) + 1)), 20000))
    if acc == "diferencias":
        otro = _leer(p) if p.exists() else ""
        nombre_otro = "actual"
        if a.get("contra"):
            try:
                m = int(a["contra"])
                otro, nombre_otro = _leer(vers[m - 1]["_f"]), f"versión {m}"
            except (ValueError, IndexError):
                return "ERROR: contra debe ser otro número de versión."
        diff = "".join(difflib.unified_diff(txt.splitlines(True), otro.splitlines(True), f"versión {n}", nombre_otro, n=2))
        return cut(diff, 15000) or f"La versión {n} es igual a la {nombre_otro}."
    if acc == "restaurar":
        cur = _backup(ctx, p, nota=f"antes de restaurar la versión {n}") if p.exists() else None
        p.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(e["_f"], p)
        file_event(ctx, p, action="restaurado")
        return (f"✔ {p.name} restaurado a la versión {n} ({e.get('t', '').replace('T', ' ')})."
                + (" La versión que había quedó guardada (puedes volver a ella con versiones_archivo)." if cur else ""))
    return "ERROR: accion debe ser listar, ver, diferencias, restaurar, guardar o todas."


def _fijar(ctx, nombre_copia, nota):
    try:
        with _lock:
            d = _carpeta(ctx)
            idx = _indice(d)
            for e in idx:
                if e.get("copia") == nombre_copia:
                    e["fija"] = True
                    e["nota"] = nota[:200]
            _guardar_indice(d, idx)
    except Exception:
        pass


# ═════════════════════════════ 2. ENTREGAS (ZIP) ═════════════════════════════
def _tam(n):
    return f"{n} bytes" if n < 1024 else f"{n / 1024:.0f} KB" if n < 1_048_576 else f"{n / 1_048_576:.1f} MB"


def _archivos_proyecto(root: Path, max_mb=300):
    total = 0
    for dp, dns, fns in os.walk(root):
        dns[:] = sorted(x for x in dns if x not in EXCLUIR_DIRS and not x.startswith(".noviq"))
        for f in sorted(fns):
            p = Path(dp) / f
            if p.suffix.lower() in EXCLUIR_EXT or f.startswith((".noviq", "~$")) or f in (".DS_Store", "Thumbs.db"):
                continue
            try:
                sz = p.stat().st_size
            except OSError:
                continue
            total += sz
            if total > max_mb * 1_000_000:
                return
            yield p


def crear_entrega(root: Path, proyecto: str, nota="", auto=False):
    """Crea <proyecto>/entregas/<proyecto>_vNNN_<fecha>.zip. Devuelve (ruta_zip, n_archivos, bytes)."""
    out_dir = root / "entregas"
    out_dir.mkdir(parents=True, exist_ok=True)
    nums = [int(m.group(1)) for z in out_dir.glob("*.zip") if (m := re.search(r"_v(\d{2,4})_", z.name))]
    n = max(nums, default=0) + 1
    limpio = re.sub(r"[^\w\-]+", "_", proyecto)[:40] or "proyecto"
    extra = re.sub(r"[^\w\-]+", "_", nota)[:30].strip("_") if nota and not auto else ""
    z_path = out_dir / f"{limpio}_v{n:03d}_{datetime.now():%Y%m%d_%H%M}{('_' + extra) if extra else ''}.zip"
    manifiesto, count = [], 0
    with zipfile.ZipFile(z_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for p in _archivos_proyecto(root):
            rel = p.relative_to(root).as_posix()
            try:
                data = p.read_bytes()
            except OSError:
                continue
            z.writestr(zipfile.ZipInfo.from_file(p, rel, strict_timestamps=False), data, zipfile.ZIP_DEFLATED)
            manifiesto.append(f"{hashlib.sha256(data).hexdigest()[:16]}  {len(data):>9}  {rel}")
            count += 1
        cab = [f"Proyecto: {proyecto}", f"Versión: v{n:03d}", f"Fecha: {datetime.now():%Y-%m-%d %H:%M}",
               f"Creada: {'automáticamente al terminar con las pruebas OK' if auto else 'a pedido'}"]
        if nota:
            cab.append(f"Nota: {nota}")
        z.writestr("ENTREGA.txt", "\n".join(cab + ["", f"{count} archivos (sha256 · bytes · ruta):"] + manifiesto) + "\n")
    maxz = int((CONFIG.get("entregas") or {}).get("max", 10))
    zips = sorted(out_dir.glob("*.zip"), key=lambda x: x.stat().st_mtime)
    for old in zips[:-maxz]:
        try:
            old.unlink()
        except OSError:
            pass
    try:
        reg = root / ".noviq" / "entregas.json"
        reg.parent.mkdir(exist_ok=True)
        hist = json.loads(reg.read_text(encoding="utf-8")) if reg.exists() else []
        hist.append({"zip": z_path.name, "t": datetime.now().isoformat(timespec="seconds"), "archivos": count,
                     "bytes": z_path.stat().st_size, "nota": nota, "auto": auto})
        reg.write_text(json.dumps(hist[-100:], ensure_ascii=False, indent=1), encoding="utf-8")
    except Exception:
        pass
    return z_path, count, z_path.stat().st_size


def t_empaquetar_proyecto(a, ctx):
    from .tools import file_event
    root = ctx.cwd
    if a.get("accion") == "listar":
        d = root / "entregas"
        zs = sorted(d.glob("*.zip"), key=lambda x: x.stat().st_mtime, reverse=True) if d.exists() else []
        return ("Entregas del proyecto (más nueva primero):\n" + "\n".join(
            f"- {z.name} · {_tam(z.stat().st_size)}" for z in zs)) if zs else "Todavía no hay entregas (ZIP) en este proyecto."
    if not ctx.conv.get("project"):
        return "ERROR: no hay proyecto activo. Usa cambiar_proyecto o crear_proyecto primero."
    z, n, size = crear_entrega(root, ctx.conv["project"], a.get("nota") or "")
    file_event(ctx, z, action="creado")
    return (f"📦 Entrega creada: {z} ({n} archivos, {_tam(size)}). Incluye ENTREGA.txt con la lista de archivos y sus "
            "huellas. Se excluyen node_modules, .venv, .git, .noviq, capturas, dist/build y archivos temporales.")


def entrega_automatica(conv, emit):
    """Al terminar un trabajo con las pruebas OK: ZIP de la versión estable (si está activado en ⚙ Ajustes)."""
    try:
        if not (CONFIG.get("entregas") or {}).get("auto", True) or not conv.get("project"):
            return None
        from .config import project_path
        root = project_path(conv["project"])
        if not root.exists():
            return None
        pedido = ((conv.get("estado") or {}).get("pedidos") or [{}])[-1].get("texto", "")
        z, n, size = crear_entrega(root, conv["project"], nota=pedido[:80], auto=True)
        emit("notice", {"text": f"📦 Versión estable guardada: entregas/{z.name} ({n} archivos, {_tam(size)})."})
        emit("file", {"name": z.name, "path": str(z), "size": size, "action": "creado"})
        return z
    except Exception as e:
        emit("notice", {"text": f"📦 No pude crear el ZIP de la versión estable: {e}"})
        return None


# ═════════════════════════════ 3. BIBLIOTECA ═════════════════════════════
def biblioteca_dir() -> Path:
    d = projects_root() / "_Biblioteca"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _entradas():
    out = []
    for d in sorted(biblioteca_dir().iterdir()):
        if d.is_dir():
            meta = {}
            try:
                meta = json.loads((d / "biblioteca.json").read_text(encoding="utf-8"))
            except Exception:
                pass
            out.append((d, meta))
    return out


def t_biblioteca(a, ctx):
    from .tools import _backup, file_event
    acc = (a.get("accion") or "listar").lower()
    if acc in ("listar", "buscar"):
        q = (a.get("texto") or a.get("nombre") or "").lower() if acc == "buscar" else ""
        filas = []
        for d, m in _entradas():
            blob = " ".join([d.name, m.get("descripcion", ""), " ".join(m.get("etiquetas") or [])]).lower()
            if q and not all(w in blob for w in q.split()):
                continue
            filas.append(f"- {d.name}: {m.get('descripcion', '(sin descripción)')}"
                         + (f" [{', '.join(m.get('etiquetas'))}]" if m.get("etiquetas") else "")
                         + f" · {len(m.get('archivos') or [])} archivo(s) · de {m.get('origen', '?')}")
        return ("📚 Biblioteca de código reutilizable (" + str(biblioteca_dir()) + "):\n" + "\n".join(filas)) if filas else \
            ("No hay nada en la biblioteca" + (f" que coincida con «{q}»" if q else "") + ". Guarda algo con accion='guardar'.")
    nombre = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", (a.get("nombre") or "").strip())[:60].strip(" ._")
    if acc == "guardar":
        src = ctx.resolve(a.get("ruta") or "")
        if not a.get("ruta") or not src.exists():
            return "ERROR: indica ruta (archivo o carpeta del proyecto) que exista."
        nombre = nombre or src.stem
        dest = biblioteca_dir() / nombre
        if dest.exists() and not a.get("reemplazar"):
            return f"ERROR: ya existe «{nombre}» en la biblioteca. Usa otro nombre o reemplazar=true."
        if dest.exists():
            shutil.rmtree(dest, ignore_errors=True)
        dest.mkdir(parents=True)
        archivos = []
        if src.is_dir():
            for p in _archivos_proyecto(src, max_mb=50):
                rel = p.relative_to(src).as_posix()
                (dest / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(p, dest / rel)
                archivos.append(rel)
        else:
            shutil.copy2(src, dest / src.name)
            archivos.append(src.name)
        meta = {"descripcion": a.get("descripcion") or "", "etiquetas": a.get("etiquetas") or [],
                "origen": ctx.conv.get("project") or "(sin proyecto)", "ruta_origen": str(src),
                "fecha": datetime.now().isoformat(timespec="seconds"), "archivos": archivos}
        (dest / "biblioteca.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
        return f"📚 Guardado en la biblioteca como «{nombre}» ({len(archivos)} archivo(s)). Úsalo en otro proyecto con biblioteca(accion='usar', nombre='{nombre}')."
    ent = biblioteca_dir() / nombre if nombre else None
    if not ent or not ent.exists():
        return f"ERROR: no existe «{nombre}» en la biblioteca. Usa accion='listar' o 'buscar'."
    meta = {}
    try:
        meta = json.loads((ent / "biblioteca.json").read_text(encoding="utf-8"))
    except Exception:
        pass
    archivos = meta.get("archivos") or [p.relative_to(ent).as_posix() for p in ent.rglob("*") if p.is_file() and p.name != "biblioteca.json"]
    if acc == "ver":
        prim = next((ent / x for x in archivos if (ent / x).suffix.lower() not in (".png", ".jpg", ".ico", ".zip")), None)
        cuerpo = _leer(prim)[:6000] if prim else ""
        return (f"📚 {nombre}: {meta.get('descripcion', '')}\nArchivos: {', '.join(archivos[:40])}\n"
                + (f"\n--- {prim.name} ---\n{cuerpo}" if prim else ""))
    if acc == "usar":
        if not ctx.conv.get("project"):
            return "ERROR: activa primero el proyecto donde se va a usar (cambiar_proyecto)."
        destino = ctx.resolve(a.get("destino") or ".")
        copiados, respaldados = [], 0
        for rel in archivos:
            s_ = ent / rel
            if not s_.exists():
                continue
            d_ = destino / rel
            if d_.exists():
                _backup(ctx, d_, nota=f"antes de copiar «{nombre}» de la biblioteca")
                respaldados += 1
            d_.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(s_, d_)
            copiados.append(d_)
            file_event(ctx, d_, action="creado")
        return (f"✔ Copié «{nombre}» de la biblioteca al proyecto ({len(copiados)} archivo(s) en {destino})."
                + (f" {respaldados} archivo(s) que ya existían quedaron respaldados (versiones_archivo)." if respaldados else "")
                + " Revisa rutas/imports y pruébalo.")
    return "ERROR: accion debe ser listar, buscar, guardar, ver o usar."
