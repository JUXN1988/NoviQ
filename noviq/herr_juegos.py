# -*- coding: utf-8 -*-
"""Herramientas del agente para el 🎮 Estudio de juegos y el ecosistema 🟩 NVIDIA (las registra tools.py).

- crear_juego: idea → diseño → proyecto con motor probado (3D / vóxel / 2D según la PC) + activos 3D libres.
- buscar_activos_3d / descargar_activo: primero la carpeta 3D del usuario (docs/3D), luego galerías gratuitas (Poly Haven,
  ambientCG, Sketchfab, Poly Pizza).
- nvidia_ia: info de la GPU y consejos (también para programación normal: CUDA, PyTorch, NVENC, IA local),
  texturas PBR con IA (FLUX), modelos 3D con IA (TRELLIS) y animación facial desde una voz (Audio2Face-3D)."""
import json
from pathlib import Path

from .config import CONFIG

GAME_TOOLS = {"crear_juego", "buscar_activos_3d", "descargar_activo", "mejorar_diseno"}


def _log(ctx, t):
    ctx.emit("tool_output", {"id": ctx.call_id, "text": t + "\n"})


def _proyecto_dir(ctx):
    if not ctx.conv.get("project"):
        return None
    return ctx.cwd


def t_crear_juego(a, ctx):
    from . import juegos as JG
    idea = (a.get("idea") or "").strip()
    if not idea and not a.get("diseno"):
        return "ERROR: describe la idea del juego en 'idea' (lo que el usuario quiere)."
    _log(ctx, "🖥 Midiendo la tarjeta gráfica y la memoria de la PC…")
    perfil = JG.perfil_grafico()
    _log(ctx, f"   Nivel «{perfil['nivel']}» ({perfil['motivo']}). {perfil['consejo']}")
    estilo = a.get("estilo") if a.get("estilo") in JG.ESTILOS else None
    genero = a.get("genero") if a.get("genero") in JG.GENEROS else None
    if isinstance(a.get("diseno"), (dict, str)):
        d = a["diseno"]
        if isinstance(d, str):
            try:
                d = json.loads(d)
            except Exception:
                d = {}
        base = JG.plan_local(idea or d.get("descripcion", ""), estilo, genero, perfil)
        diseno = JG.normalizar(d, base)
        diseno["idea"] = idea or diseno.get("idea", "")
    else:
        _log(ctx, "🧠 Convirtiendo la idea en el diseño del juego…")
        r = JG.planificar(idea, estilo, genero, usar_ia=True, perfil=perfil)
        diseno = r["diseno"]
        if r.get("aviso"):
            _log(ctx, "   " + r["aviso"])
    if estilo:
        diseno["estilo"] = estilo
    aviso_estilo = ""
    if not perfil["estilos"][diseno["estilo"]]["ok"]:
        aviso_estilo = (f"⚠ La PC es nivel «{perfil['nivel']}»: el estilo «{diseno['estilo']}» puede ir lento. Recomendado: "
                        f"«{perfil['recomendado']}». El juego baja la calidad solo si hacen falta FPS.")
        _log(ctx, "   " + aviso_estilo)
    _log(ctx, f"🎮 Diseño: «{diseno['titulo']}» · {diseno['genero']} · {diseno['estilo']} · objetivo: {diseno['objetivo']['texto']}")
    res = JG.crear(diseno, a.get("nombre"), None, a.get("buscar_activos", True) is not False, emit=lambda t: _log(ctx, t), perfil=perfil)
    ctx.conv["project"] = res["proyecto"]
    ctx.conv["modo_juego"] = True
    ctx.emit("project", {"name": res["proyecto"], "path": res["ruta"]})
    from .tools import file_event
    file_event(ctx, Path(res["index"]), action="creado")
    d = res["diseno"]
    return (f"✅ Juego base creado y activado como proyecto: {res['ruta']}\n"
            f"- Motor: {d['motor']} · estilo {d['estilo']} · calidad «{d['calidad']['nivel']}» para esta PC. {aviso_estilo}\n"
            f"- Objetivo: {d['objetivo']['texto']} · enemigos: {', '.join(e['nombre'] for e in d['enemigos']) or 'ninguno'} · "
            f"objetos: {', '.join(o['nombre'] for o in d['objetos']) or 'ninguno'}\n"
            f"- Activos descargados: {', '.join((x.get('rol') or x['nombre']) + ' (' + x['licencia'] + ')' for x in res['activos']) or 'ninguno (el motor dibuja formas propias)'}"
            + (f"\n- Problemas con activos: {'; '.join(res['errores'][:3])}" if res["errores"] else "") +
            "\n\nARCHIVOS: juego.config.js (diseño, editable), juego.js (reglas propias con ganchos), motor*.js/comun.js (NO los "
            "reescribas), assets/ (modelos y créditos), jugar.bat (doble clic para jugar).\n"
            "SIGUIENTE: prueba con probar_web ruta='index.html?prueba=1' (acciones: teclas W, Space; evaluar_js='JSON.stringify(estadoJuego())'), "
            "programa en juego.js las mecánicas especiales que pidió el usuario"
            + (": " + "; ".join(d.get("reglas_extra") or []) if d.get("reglas_extra") else "") +
            ", vuelve a probar y explícale al usuario cómo jugar.")


def t_buscar_activos_3d(a, ctx):
    from . import activos as A
    from . import juegos as JG
    q = (a.get("consulta") or "").strip()
    if not q:
        return "ERROR: falta 'consulta' (ej. 'knight', 'árbol', 'rock')."
    tipo = a.get("tipo") if a.get("tipo") in ("modelo", "textura", "hdri") else "modelo"
    nivel = None
    try:
        nivel = JG.perfil_grafico()["nivel"]
    except Exception:
        pass
    tema = genero = None
    try:  # si hay un juego activo, su temática ayuda a elegir de la carpeta 3D del usuario
        dis = json.loads((ctx.cwd / "diseno.json").read_text(encoding="utf-8")) if ctx.conv.get("project") else {}
        tema, genero = dis.get("tema"), dis.get("genero")
    except Exception:
        pass
    r = A.buscar(q, tipo, a.get("fuentes") or None, a.get("estilo"), nivel, int(a.get("limite") or 8),
                 bool(a.get("solo_cc0", (CONFIG.get("juegos") or {}).get("solo_cc0"))), rol=a.get("rol") or None, tema=tema, genero=genero)
    res = r["resultados"][: int(a.get("limite") or 8)]
    ctx.conv["_activos_ult"] = res
    if not res:
        return (f"Sin resultados para «{q}» (buscado como «{r['consulta_en']}»). Errores: {r['errores'] or 'ninguno'}. "
                "Prueba otra palabra en inglés, o genera el modelo con nvidia_ia accion='modelo_3d'.")
    lin = [f"{i + 1}. {x['nombre']} — {'📁 carpeta 3D del usuario, paquete ' + str(x.get('paquete')) if x['fuente'] == 'local' else x['fuente']} · {x['licencia']} · autor {x.get('autor') or '?'}"
           + (f" · {x['caras']:,} caras" if x.get("caras") else "") + (" · animado" if x.get("animado") else "")
           for i, x in enumerate(res)]
    extra = ""
    if r.get("sin_clave"):
        extra = f"\n(Sin clave: {', '.join(r['sin_clave'])}; el usuario puede agregarlas en ⚙ Ajustes → Juegos y NVIDIA.)"
    if r["errores"]:
        extra += f"\n(Galerías que fallaron: {r['errores']})"
    return (f"Resultados para «{q}» (en inglés: «{r['consulta_en']}»):\n" + "\n".join(lin) + extra +
            "\n\nDescarga con descargar_activo(numero=N, rol='jugador'|'enemigo'|'coleccionable'|'arbol'|…): el motor usa "
            "ACTIVOS.modelos[rol] automáticamente (rol = el 'modelo' de juego.config.js).")


def t_descargar_activo(a, ctx):
    from . import activos as A
    p = _proyecto_dir(ctx)
    if not p:
        return "ERROR: no hay proyecto activo. Crea el juego con crear_juego o activa el proyecto con cambiar_proyecto."
    ult = ctx.conv.get("_activos_ult") or []
    item = None
    if a.get("numero"):
        try:
            item = ult[int(a["numero"]) - 1]
        except (ValueError, IndexError, TypeError):
            return f"ERROR: no hay resultado número {a.get('numero')}; busca primero con buscar_activos_3d."
    elif a.get("fuente") == "local" and a.get("id"):
        from . import biblioteca3d as B
        m = B.por_id(a["id"])
        if not m:
            return f"ERROR: «{a['id']}» no está en la carpeta 3D ({B.carpeta()}). Busca con buscar_activos_3d."
        item = B.item_activo(m)
    elif a.get("fuente") and a.get("id"):
        item = {"fuente": a["fuente"], "id": a["id"], "tipo": a.get("tipo", "modelo"), "nombre": a.get("nombre") or a["id"],
                "licencia": "CC0" if a["fuente"] in ("polyhaven", "ambientcg") else "revisar"}
        if a["fuente"] in ("polypizza", "ambientcg"):
            m = next((x for x in ult if x["fuente"] == a["fuente"] and str(x["id"]) == str(a["id"])), None)
            if m:
                item = m
    if not item:
        return "ERROR: indica numero (de buscar_activos_3d) o fuente + id."
    rol = (a.get("rol") or "").strip() or None
    _log(ctx, f"📁 Copiando {item.get('nombre')} de la carpeta 3D…" if item.get("fuente") == "local" else f"⬇ Descargando {item.get('nombre')} de {item.get('fuente')}…")
    try:
        ent = A.descargar(item, p, rol=rol)
    except Exception as e:
        return f"ERROR descargando: {e}"
    from .tools import file_event
    if ent.get("archivo"):
        file_event(ctx, p / ent["archivo"], action="descargado")
    return (f"✅ Descargado «{ent['nombre']}» ({ent['licencia']}, {ent.get('autor') or 'autor ?'}) → "
            f"{ent.get('archivo') or ent.get('carpeta')}. Registrado en assets/activos.js"
            + (f" como ACTIVOS.modelos['{rol}']" if rol and ent["tipo"] == "modelo" else "")
            + " y en CREDITOS.md. Recarga el juego para verlo (el motor lo escala solo).")


def t_nvidia_ia(a, ctx):
    from . import nvidia as NV
    acc = (a.get("accion") or "info").lower()
    if acc == "info":
        i = NV.info(max_age=0 if a.get("actualizar") else 120)
        return NV.resumen(i) + "\n\n" + NV.consejos(a.get("tema") or "todo", i)
    if acc == "consejos":
        return NV.consejos(a.get("tema") or "todo")
    if acc == "perfil_juego":
        from . import juegos as JG
        p = JG.perfil_grafico()
        return (f"Nivel de la PC para juegos: {p['nivel']} ({p['motivo']}). Estilo recomendado: {p['recomendado']}.\n{p['consejo']}\n"
                + "\n".join(f"- {v['nombre']}: {'✔' if v['ok'] else '⚠ ' + v['aviso']}" for v in p["estilos"].values()))
    destino_base = ctx.cwd
    if acc == "textura":
        desc = (a.get("descripcion") or a.get("prompt") or "").strip()
        if not desc:
            return "ERROR: falta 'descripcion' en inglés (ej. 'mossy cobblestone', 'sci-fi metal floor')."
        _log(ctx, f"🎨 Generando textura PBR sin costuras con FLUX: {desc}")
        try:
            r = NV.textura(desc, destino_base / "assets" / "texturas", a.get("nombre") or "textura")
        except Exception as e:
            return f"ERROR: {e}"
        from . import activos as A
        from .tools import file_event
        rel = {k: str(Path(v).relative_to(destino_base)).replace("\\", "/") for k, v in r.items() if k in ("color", "normal")}
        if ctx.conv.get("project"):
            A.registrar(destino_base, {"id": "ia-" + (a.get("nombre") or "textura"), "fuente": "nvidia", "nombre": a.get("nombre") or "textura",
                                       "tipo": "textura", "rol": a.get("rol") or a.get("nombre") or "", "licencia": "generada con IA",
                                       "autor": "NVIDIA FLUX (build.nvidia.com)", "mapas": rel})
        ctx.emit("image", {"name": Path(r["color"]).name, "path": r["color"]})
        file_event(ctx, Path(r["normal"]), action="creado")
        return (f"✅ Textura repetible creada: {rel.get('color')} + mapa normal {rel.get('normal')}. En el motor 3D, rol 'suelo' "
                "se aplica al terreno automáticamente; en Three.js: new THREE.TextureLoader().load(ruta) con wrapS/wrapT = RepeatWrapping.")
    if acc in ("modelo_3d", "modelo3d", "3d"):
        desc = (a.get("descripcion") or a.get("prompt") or "").strip()
        if not desc:
            return "ERROR: falta 'descripcion' corta en inglés (máx. 77 caracteres), ej. 'low poly wooden treasure chest'."
        _log(ctx, f"🧊 Generando modelo 3D con TRELLIS: {desc[:77]} (tarda 30-90 s)…")
        try:
            r = NV.modelo_3d(desc, destino_base / "assets" / "modelos", a.get("rol") or a.get("nombre") or "modelo")
        except Exception as e:
            return f"ERROR: {e}"
        from . import activos as A
        from .tools import file_event
        rel = str(Path(r["glb"]).relative_to(destino_base)).replace("\\", "/")
        if ctx.conv.get("project"):
            A.registrar(destino_base, {"id": "ia-" + Path(r["glb"]).stem, "fuente": "nvidia", "nombre": desc[:60], "tipo": "modelo",
                                       "rol": a.get("rol") or "", "licencia": "generado con IA", "autor": "Microsoft TRELLIS (build.nvidia.com)",
                                       "archivo": rel, "bytes": r["bytes"]})
        file_event(ctx, Path(r["glb"]), action="creado")
        return (f"✅ Modelo 3D creado: {rel} ({r['bytes'] // 1024} KB)"
                + (f", registrado como ACTIVOS.modelos['{a.get('rol')}']" if a.get("rol") else "") + ". Recarga el juego para verlo.")
    if acc in ("cara_voz", "audio2face"):
        wav = ctx.resolve(a.get("audio") or "")
        _log(ctx, "🙂 Audio2Face-3D: voz → animación facial (blendshapes ARKit)…")
        try:
            r = NV.cara_voz(wav, destino_base / "assets" / "animaciones", a.get("personaje") or "mark", emit=lambda t: _log(ctx, t))
        except Exception as e:
            return f"ERROR: {e}"
        return ("✅ Animación facial lista: " + ", ".join(r["archivos"]) + ". El CSV tiene los blendshapes por tiempo (curvas "
                "ARKit): se aplican a un personaje con morph targets (Three.js: mesh.morphTargetInfluences) o en Unreal con el plugin.")
    return "ERROR: accion debe ser info | consejos | perfil_juego | textura | modelo_3d | cara_voz"


def t_crear_figura(a, ctx):
    """🧍 Figura 3D ANIMADA (esqueleto + Idle, caminar, correr, saltar, atacar, golpe, caer…) desde una descripción."""
    from . import figuras3d as F
    desc = (a.get("descripcion") or "").strip()
    if not desc and not a.get("plantilla"):
        return "ERROR: describe la figura en 'descripcion' (ej. 'soldado camuflado', 'vaca de bloques', 'dragón rojo', 'espada')."
    if a.get("plantilla") in F.POR_ID:
        pl, cambios = F.POR_ID[a["plantilla"]], {}
    else:
        pl, cambios, pts = F.desde_texto(desc)
    if a.get("estilo") == "bloques" and pl["rig"] in ("humanoide", "cuadrupedo"):
        cambios["_estilo"] = "bloques"
    _log(ctx, f"🧍 Creando «{pl['nombre']}»{' (bloques)' if cambios.get('_estilo') == 'bloques' else ''}…")
    info = F.guardar(pl, cambios, float(a.get("detalle") or 1.0), nombre=a.get("nombre") or None, descripcion=desc)
    msg = (f"✅ {'Reutilizada' if info.get('reutilizado') else 'Creada'}: {info['ruta']} (categoría {info.get('categoria')}, "
           f"{len(info.get('animaciones') or [])} animaciones: {', '.join(info.get('animaciones') or []) or 'estática'}; miniatura {info.get('miniatura_png')}).")
    try:
        ctx.emit("image", {"name": Path(info["miniatura_png"]).name, "path": info["miniatura_png"]})
    except Exception:
        pass
    rol = (a.get("rol") or "").strip()
    base = _proyecto_dir(ctx)
    if rol and base:
        ent = F.a_proyecto(info, base, rol)
        msg += f"\nCopiada al juego como ACTIVOS.modelos['{rol}'] → {ent['archivo']} (recarga el juego para verla)."
    return msg


def t_crear_diseno_2d(a, ctx):
    """🎨 Diseño 2D profesional: retrato, tarjeta, icono, hoja de sprites animada, fondo por capas (parallax), textura o baldosas."""
    from . import figuras2d as F2
    desc = (a.get("descripcion") or "").strip()
    tipo = a.get("tipo") or ""
    if not desc:
        return "ERROR: describe el diseño en 'descripcion' (ej. 'retrato de una bruja', 'fondo de bosque al atardecer', 'sprites de un lobo')."
    texto = (f"{ {'retrato': 'retrato de', 'icono': 'icono de', 'sprites': 'sprites de', 'fondo': 'fondo de', 'textura': 'textura de', 'baldosas': 'baldosas de', 'tarjeta': 'tarjeta de'}.get(tipo, '') } {desc}").strip()
    _log(ctx, f"🎨 Dibujando: {texto}…")
    info = F2.crear_desde_texto(texto)
    msg = f"✅ {'Reutilizado' if info.get('reutilizado') else 'Creado'} ({info.get('categoria')}): {info['png']}"
    if info.get("capas"):
        msg += f"\nCapas para parallax (misma carpeta): {', '.join(info['capas'].values())}"
    if info.get("hoja"):
        h = info["hoja"]
        msg += (f"\nHoja de sprites: cuadro {h['cuadro'][0]}×{h['cuadro'][1]} px, pivote (pies) {h['pivote']}, animaciones "
                + ", ".join(f"{k} (fila {v['fila']}, {v['cuadros']} cuadros, {v['fps']} fps)" for k, v in h["anims"].items()))
    try:
        ctx.emit("image", {"name": Path(info["png"]).name, "path": info["png"]})
    except Exception:
        pass
    destino = (a.get("copiar_a") or "").strip()
    base = _proyecto_dir(ctx)
    if destino and base:
        import shutil
        d = (Path(base) / destino).resolve()
        if str(d).startswith(str(Path(base).resolve())):
            d.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(info["png"], d)
            msg += f"\nCopiado al proyecto: {destino}"
    return msg


def t_mejorar_diseno(a, ctx):
    """🎬 El director creativo vuelve a trabajar el diseño del juego activo (más épico) y lo deja en diseno_mejorado.json."""
    from . import director_juegos as DJ
    from . import juegos as JG
    base = _proyecto_dir(ctx)
    if not base or not (Path(base) / "diseno.json").exists():
        return "ERROR: no hay un juego activo con diseno.json (crea uno con crear_juego)."
    d = json.loads((Path(base) / "diseno.json").read_text(encoding="utf-8"))
    idea = (a.get("pedido") or "").strip()
    idea = (d.get("idea") or d.get("descripcion") or "") + (" · " + idea if idea else "")
    _log(ctx, "🎬 El director creativo está mejorando el diseño…")
    nuevo, info = DJ.dirigir(d, idea, JG.perfil_grafico(), usar_ia=True)
    (Path(base) / "diseno_mejorado.json").write_text(json.dumps(nuevo, ensure_ascii=False, indent=2), encoding="utf-8")
    return (f"✅ Diseño mejorado (calidad {info['puntaje']}/100{', completado: ' + ', '.join(info['completado']) if info.get('completado') else ''}) → diseno_mejorado.json\n\n"
            + DJ.texto(nuevo)[:3500] + "\n\nPara aplicarlo con figuras, iconos y sprites nuevos: crear_juego con idea igual y diseno = el contenido de diseno_mejorado.json.")


def T(name, desc, props, required=()):
    return {"type": "function", "function": {"name": name, "description": desc, "parameters": {
        "type": "object", "properties": props, "required": list(required)}}}


S = lambda d: {"type": "string", "description": d}
B_ = lambda d: {"type": "boolean", "description": d}
I_ = lambda d: {"type": "integer", "description": d}

DEFS = [
    T("crear_juego", "🎮 Crea un VIDEOJUEGO completo y jugable a partir de la idea del usuario (para principiantes): mide la PC (si la tarjeta no aguanta 3D realista usa vóxel estilo Minecraft HD o 2D pixel art), convierte la idea en el diseño, instala un motor probado y optimizado (Three.js 3D, vóxel o 2D), busca y descarga modelos 3D libres según el género/tema y deja jugar.bat. Úsalo SIEMPRE como primer paso para un juego nuevo; luego personaliza juego.js / juego.config.js y prueba con probar_web.",
      {"idea": S("La idea del usuario, completa y en sus palabras"), "estilo": {"type": "string", "enum": ["realista", "lowpoly", "voxel", "pixel2d"], "description": "Opcional: forzar estilo (si no, se elige según la PC y la idea)"},
       "genero": {"type": "string", "enum": ["aventura", "plataformas", "carreras", "disparos", "supervivencia", "construccion", "puzle", "rpg", "terror", "deportes", "exploracion"]},
       "nombre": S("Nombre de la carpeta del proyecto (opcional)"), "buscar_activos": B_("Descargar modelos 3D libres automáticamente (def. sí)"),
       "diseno": {"type": "object", "description": "Opcional: diseño ya decidido (titulo, genero, estilo, tema, objetivo{tipo,cantidad,texto}, jugador, enemigos[], objetos[], decoracion[], activos{rol: búsqueda en inglés}, reglas_extra[])"}},
      ["idea"]),
    T("buscar_activos_3d", "🧱 Busca modelos 3D, texturas PBR o cielos HDRI GRATIS y legales: PRIMERO en la carpeta 3D del usuario (📁 docs/3D: modelos .glb que ya descargó, fuente 'local'), luego Poly Haven y ambientCG CC0, Sketchfab CC0/CC-BY, Poly Pizza low poly. Devuelve una lista numerada con licencia, autor y polígonos (filtrados según la tarjeta de la PC).",
      {"consulta": S("Qué buscar (mejor en inglés: 'knight', 'pine tree', 'sci-fi crate')"), "tipo": {"type": "string", "enum": ["modelo", "textura", "hdri"]},
       "estilo": {"type": "string", "enum": ["realista", "lowpoly", "voxel"]}, "fuentes": {"type": "array", "items": {"type": "string", "enum": ["local", "polyhaven", "ambientcg", "sketchfab", "polypizza"]}},
       "rol": S("Opcional: para qué rol del juego es (jugador, enemigo, coleccionable, arbol, vehiculo, lapida…): ayuda a elegir de la carpeta 3D"),
       "solo_cc0": B_("Solo dominio público (sin obligación de dar crédito)"), "limite": I_("Máximo de resultados (def. 8)")}, ["consulta"]),
    T("descargar_activo", "⬇ Descarga un activo de la última búsqueda (numero) al proyecto activo: modelos a assets/modelos/<rol>.glb (se empaqueta en .glb), texturas a assets/texturas/, cielos a assets/cielos/; actualiza assets/activos.js (el motor lo usa solo) y CREDITOS.md con licencia y autor.",
      {"numero": I_("Número del resultado de buscar_activos_3d"), "rol": S("Para qué se usa: jugador, enemigo, enemigo2, coleccionable, meta, arbol, roca, casa… (igual que 'modelo' en juego.config.js)"),
       "fuente": S("O fuente + id directamente"), "id": S("Id del activo en la fuente"), "tipo": {"type": "string", "enum": ["modelo", "textura", "hdri"]}}),
    T("nvidia_ia", "🟩 Herramientas NVIDIA (juegos Y programación): accion='info' (tarjeta, CUDA, RT/Tensor cores, DLSS, NVENC, apps instaladas y cómo aprovecharla), 'consejos' (tema: pytorch | cupy | video | ia_local | juegos_web | unreal | omniverse | audio2face), 'perfil_juego' (qué estilo gráfico aguanta la PC), 'textura' (textura PBR repetible con IA FLUX + mapa normal), 'modelo_3d' (modelo .glb desde texto con TRELLIS), 'cara_voz' (Audio2Face-3D: voz .wav → animación facial). Úsalo cuando un programa necesite GPU/CUDA/NVENC o un juego necesite texturas/modelos propios.",
      {"accion": {"type": "string", "enum": ["info", "consejos", "perfil_juego", "textura", "modelo_3d", "cara_voz"]},
       "tema": S("Para consejos/info"), "descripcion": S("textura/modelo_3d: descripción EN INGLÉS (modelo_3d: máx. 77 caracteres)"),
       "nombre": S("Nombre del archivo/carpeta"), "rol": S("Rol en el juego (ej. 'suelo' para la textura del terreno, 'enemigo' para un modelo)"),
       "audio": S("cara_voz: archivo .wav"), "personaje": {"type": "string", "enum": ["mark", "claire", "james"]}, "actualizar": B_("Volver a medir la GPU")},
      ["accion"]),
]
DEFS += [
    T("crear_figura", "🧍 Crea una FIGURA 3D propia y TOTALMENTE ANIMADA (.glb con esqueleto: Idle, caminar, correr, saltar, atacar, disparar, golpe, caer…) desde una descripción: personajes (explorador, caballero, granjera, soldados y militares: soldado camuflado, comando, francotirador, general, médico, piloto, mercenario…), enemigos (zombi, esqueleto, orco, lobo, dragón…), animales (cerdo, vaca, oveja, caballo…), armas, objetos y escenario (tanque, jeep, sacos de arena, torre de vigilancia…). estilo='bloques' la hace de bloques estilo vóxel/pixel art 3D (como Minecraft, con diseño propio). Se guarda en la carpeta 3D (Noviq Creados/<categoría>) para reutilizarla; con 'rol' se copia al juego activo.",
      {"descripcion": S("Qué figura: 'soldado con camuflaje del desierto', 'vaca', 'rey calabaza', 'espada', 'tanque'…"), "estilo": {"type": "string", "enum": ["normal", "bloques"]},
       "rol": S("Opcional: rol en el juego activo (jugador, enemigo, enemigo2, jefe, npc, arma_<id>, coleccionable, arbol…)"), "nombre": S("Nombre del archivo (opcional)"),
       "detalle": {"type": "number", "description": "0.6 a 1.25 (def. 1)"}}, ["descripcion"]),
    T("crear_diseno_2d", "🎨 Crea un DISEÑO 2D profesional y lo guarda en la carpeta 2D (Noviq Creados/<categoría>): retrato (busto con fondo y marco, para diálogos), tarjeta (personaje de 3/4 para menús), icono (arma u objeto), sprites (hoja animada desde la figura 3D: Idle, correr, saltar, atacar, golpe, caer; 'pixel' para pixel art, 'desde arriba' para 4 direcciones), fondo (panorama por capas cielo/lejos/medio/cerca para parallax; por tema y hora), textura (sin costuras) o baldosas (tiles del motor 2D).",
      {"descripcion": S("Qué dibujar: 'una bruja', 'bosque al atardecer', 'lobo pixel', 'espada', 'piedra'…"),
       "tipo": {"type": "string", "enum": ["retrato", "tarjeta", "icono", "sprites", "fondo", "textura", "baldosas"]},
       "copiar_a": S("Opcional: ruta dentro del juego activo donde copiarlo (ej. 'assets/iconos/npc_npc.png')")}, ["descripcion", "tipo"]),
    T("mejorar_diseno", "🎬 El director creativo vuelve a trabajar el diseño del juego activo para hacerlo más épico (travesía por zonas, trajes y armas para elegir, jefe con fases, contratiempos, obstáculos, logros) y lo evalúa con la rúbrica de los mejores juegos. Deja diseno_mejorado.json.",
      {"pedido": S("Opcional: qué quiere agregar o cambiar el usuario")}),
]
FUNCS = {"crear_juego": t_crear_juego, "buscar_activos_3d": t_buscar_activos_3d, "descargar_activo": t_descargar_activo, "nvidia_ia": t_nvidia_ia,
         "crear_figura": t_crear_figura, "crear_diseno_2d": t_crear_diseno_2d, "mejorar_diseno": t_mejorar_diseno}
LABELS = {"crear_juego": "🎮 Creando el juego", "buscar_activos_3d": "🧱 Buscando activos 3D libres", "descargar_activo": "⬇ Descargando activo",
          "nvidia_ia": "🟩 Herramientas NVIDIA", "crear_figura": "🧍 Creando figura 3D animada", "crear_diseno_2d": "🎨 Dibujando diseño 2D",
          "mejorar_diseno": "🎬 Mejorando el diseño"}


def modo_juego(conv):
    if conv.get("modo_juego"):
        return True
    pr = conv.get("project")
    if pr:
        try:
            from .tools import project_info
            return project_info(pr).get("tipo") == "juego"
        except Exception:
            return False
    return False


PROMPT_JUEGO = """
## 🎮 Modo videojuego (Estudio de juegos de Noviq)
El usuario quiere crear o mejorar un VIDEOJUEGO y puede ser principiante: él solo describe la idea; tú traduces la idea a la lógica del juego y eliges las herramientas en segundo plano, sin pedirle detalles técnicos.
1. Juego NUEVO → `crear_juego` con la idea completa (mide la PC, elige el estilo que aguanta la tarjeta, instala un motor probado y baja modelos 3D libres). No escribas un motor desde cero.
2. Personaliza SOLO `juego.config.js` (datos) y `juego.js` (ganchos de window.REGLAS: alIniciar, alActualizar, alRecoger, alDerrotar, alDanio, alGanar, alPerder; API window.J explicada en sus comentarios). NO reescribas motor3d.js / motorvoxel.js / motor2d.js / comun.js.
3. Activos: `crear_juego` ya usa solo los modelos de la carpeta 3D del usuario (📁 docs/3D) que encajan con la temática; para cambiar o agregar, `buscar_activos_3d` (lo de su carpeta sale primero, fuente 'local') + `descargar_activo` (rol = el 'modelo' de juego.config.js; decoración nueva: agrega {tipo, modelo, cantidad, altura} a JUEGO.decoracion); si no hay nada bueno, `nvidia_ia` accion='modelo_3d' (TRELLIS) o 'textura' (FLUX, rol 'suelo' para el terreno). Respeta las licencias (CREDITOS.md se actualiza solo).
4. Si la PC es nivel básico (ver `nvidia_ia` accion='perfil_juego'), sugiere vóxel HD (estilo Minecraft pixelado de alta calidad) o 2D pixel art en vez de 3D realista.
4b. `crear_juego` ya hace el juego ÉPICO: el director creativo convierte la idea simple en una travesía por zonas con guía, miradores, trajes y armas para elegir, vidas, contratiempos, obstáculos, mejoras, logros y un jefe final con fases; Noviq crea las figuras 3D animadas (en vóxel, de BLOQUES), los retratos, iconos y (en 2D) sprites, fondos por capas y baldosas, y los guarda para reutilizarlos. Para más: `mejorar_diseno`, `crear_figura` (figura 3D animada, estilo 'bloques' opcional; con rol la copia al juego) y `crear_diseno_2d` (retrato, icono, sprites, fondo, textura, baldosas).
5. PRUEBA siempre con `probar_web` ruta 'index.html?prueba=1' (empieza sin menú), acciones de teclado (W, Space, KeyE…) y evaluar_js 'JSON.stringify(estadoJuego())' para leer puntos, vida, FPS y geometrías (si «geometrias» crece con el tiempo hay una fuga: estás creando cosas en el bucle).
6. Al terminar explícale al usuario, en palabras simples, cómo jugar (doble clic en jugar.bat) y qué puede pedir después.
"""
