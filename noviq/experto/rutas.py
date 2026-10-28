# -*- coding: utf-8 -*-
"""🧭 Rutas tolerantes: encuentra el archivo que la IA QUISO decir.

Errores reales de las IAs pequeñas en los registros de Noviq:
  · solo el nombre («motor3d.js») cuando el archivo está en lib/ o src/js/  → buscar_en_archivos decía
    «Sin coincidencias» (¡buscaba en un archivo que no existe!) y la IA concluía que el código no estaba
  · otra carpeta de usuario inventada («C:\\Users\\otro_usuario\\…\\Noviq_Proyectos\\…»)
  · el nombre del proyecto repetido («MiJuego/src/x.js» estando ya dentro de MiJuego)
  · barras al revés o de más
Si hay UNA sola candidata clara se usa y se avisa; si hay varias, se listan para que la IA elija (sin adivinar).
Solo se busca dentro del proyecto activo y de las carpetas de proyectos (nunca en el resto del disco).
"""
import difflib
import os
import re
from pathlib import Path

SALTAR = {".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next", ".gradle", "bin", "obj",
          ".idea", ".vs", ".noviq", ".noviq_logs", ".pytest_cache", ".mypy_cache", "entregas", "site-packages"}
MAX_ENTRADAS = 25000


def _partes(ruta):
    return [p for p in re.split(r"[\\/]+", str(ruta or "").strip().strip('"').strip("'")) if p and p not in (".",)]


def _caminar(raiz: Path):
    n = 0
    for dp, dns, fns in os.walk(raiz):
        dns[:] = [d for d in dns if d not in SALTAR and not d.startswith(".")]
        for f in fns:
            n += 1
            if n > MAX_ENTRADAS:
                return
            yield Path(dp) / f
        for d in dns:
            yield Path(dp) / d


def _existe(p: Path, quiere):
    try:
        if quiere == "archivo":
            return p.is_file()
        if quiere == "carpeta":
            return p.is_dir()
        return p.exists()
    except OSError:
        return False


def _puntaje(cand: Path, partes_pedidas, base: Path):
    """Cuántas carpetas de la ruta pedida coinciden (desde el final) con la candidata."""
    try:
        rel = [x.lower() for x in cand.relative_to(base).parts]
    except ValueError:
        rel = [x.lower() for x in cand.parts]
    ped = [x.lower() for x in partes_pedidas]
    s = 0
    for a, b in zip(reversed(rel), reversed(ped)):
        if a != b:
            break
        s += 1
    return s


def sanar(ruta, cwd: Path, raices=(), quiere="cualquiera"):
    """Devuelve (Path | None, nota, candidatas). Si la ruta existe tal cual, nota=''.
    quiere: 'archivo' | 'carpeta' | 'cualquiera'."""
    texto = str(ruta or "").strip().strip('"').strip("'")
    if not texto:
        return None, "", []
    cwd = Path(cwd)
    p = Path(os.path.expandvars(os.path.expanduser(texto)))
    if not p.is_absolute():
        p = cwd / p
    if _existe(p, quiere):
        return p, "", []
    partes = _partes(texto)
    if not partes:
        return None, "", []
    # 1) barras al revés (rutas de Windows en otro sistema o al revés)
    alt = Path(texto.replace("\\", os.sep).replace("/", os.sep))
    alt = alt if alt.is_absolute() else cwd / alt
    if _existe(alt, quiere):
        return alt, f"usé {alt}", []
    bases = [cwd] + [Path(r) for r in raices if r]
    # 2) re-anclar desde el nombre de una carpeta conocida (proyecto o carpeta de proyectos)
    for base in bases:
        nb = base.name.lower()
        for i, parte in enumerate(partes[:-1] if quiere == "archivo" else partes):
            if parte.lower() == nb:
                c = base.joinpath(*partes[i + 1:]) if partes[i + 1:] else base
                if _existe(c, quiere):
                    return c, f"la ruta tenía otra carpeta delante; el archivo real es {c}", []
    # 3) colas de la ruta relativas al proyecto («x/y/z.js» → «y/z.js» → «z.js»)
    for k in range(1, len(partes)):
        c = cwd.joinpath(*partes[k:])
        if _existe(c, quiere):
            return c, f"usé {c} (la ruta pedida no existía)", []
    # 4) por nombre dentro del proyecto activo
    nombre = partes[-1].lower()
    halladas = []
    for c in _caminar(cwd):
        if c.name.lower() == nombre and _existe(c, quiere):
            halladas.append(c)
            if len(halladas) > 12:
                break
    if len(halladas) == 1:
        return halladas[0], f"«{texto}» no existe; está en {halladas[0]}", []
    if len(halladas) > 1:
        orden = sorted(halladas, key=lambda c: (-_puntaje(c, partes, cwd), len(c.parts)))
        if _puntaje(orden[0], partes, cwd) > _puntaje(orden[1], partes, cwd) and _puntaje(orden[0], partes, cwd) >= 2:
            return orden[0], f"«{texto}» no existe; usé {orden[0]}", []
        return None, "", orden[:8]
    # 5) nombres parecidos (para sugerir, nunca para usar solos)
    nombres = {}
    for c in _caminar(cwd):
        if _existe(c, quiere):
            nombres.setdefault(c.name.lower(), c)
        if len(nombres) > 5000:
            break
    cerca = difflib.get_close_matches(nombre, list(nombres), n=5, cutoff=0.72)
    return None, "", [nombres[x] for x in cerca]


def mensaje_no_existe(ruta, candidatas, cwd: Path):
    def rel(c):
        try:
            return str(Path(c).relative_to(cwd))
        except ValueError:
            return str(c)
    if candidatas:
        return (f"ERROR: no existe {ruta}. ¿Quisiste decir: " + ", ".join(rel(c) for c in candidatas) + "? "
                "Repite la llamada con una de esas rutas.")
    return (f"ERROR: no existe {ruta} (carpeta de trabajo: {cwd}). Usa buscar_archivos o explorar_codigo para "
            "encontrar el archivo correcto.")
