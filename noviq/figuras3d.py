# -*- coding: utf-8 -*-
"""🧍 Figuras 3D propias de Noviq: personajes, enemigos, criaturas, jefes, armas, objetos y obstáculos hechos por código,
con ESQUELETO y ANIMACIONES completas (quieto, caminar, correr, saltar, atacar, disparar, lanzar magia, recibir golpe y
morir). Se usan cuando la carpeta 3D del usuario no tiene el modelo que el juego necesita (o no está animado).

- Esqueletos: humanoide (19 huesos, con capa), cuadrúpedo / bípedo (dinosaurios) con alas opcionales (dragón), volador
  (aves, murciélagos, drones con hélices), arácnido (arañas, escorpiones, cangrejos), gota (slime, fantasma, calabaza
  saltarina) y serpiente (8 segmentos).
- CATALOGO: ~90 plantillas con nombre, categoría, temáticas y palabras clave en español e inglés. desde_texto("un
  espantapájaros con sombrero rojo") elige la plantilla y aplica colores y accesorios de la descripción.
- guardar(): escribe el .glb + miniatura .png + ficha .noviq.json en la carpeta 3D estándar (docs/3D/Noviq Creados/
  <Categoría>/), así la biblioteca lo encuentra y los próximos juegos lo reutilizan sin volver a crearlo."""
import hashlib
import json
import math
import re
import time
import unicodedata
from pathlib import Path

from . import geo3d as G

PI = math.pi
sin, cos = math.sin, math.cos
TAU = 2 * PI


def _n(t):
    t = unicodedata.normalize("NFKD", str(t or "").lower())
    return "".join(c for c in t if not unicodedata.combining(c))


# ════════════════════════════════ ESQUELETOS Y ANIMACIONES ════════════════════════════════
def _s(f, fase=0.0):
    return sin(TAU * (f + fase))


def _c(f, fase=0.0):
    return cos(TAU * (f + fase))


def _pos(x):
    return max(0.0, x)


def _suave(a, b, x):
    t = max(0.0, min(1.0, (x - a) / max(1e-6, b - a)))
    return t * t * (3 - 2 * t)


def _mezcla(a, b, t):
    return a + (b - a) * t


# ─── humanoide ───
def esqueleto_humanoide(k=1.0, cabeza=1.0):
    e = G.Esqueleto()
    e.hueso("hips", (0, 0.98 * k, 0))
    e.hueso("spine", (0, 1.12 * k, 0), "hips")
    e.hueso("chest", (0, 1.28 * k, 0), "spine")
    e.hueso("neck", (0, 1.50 * k, 0), "chest")
    e.hueso("head", (0, 1.58 * k, 0), "neck")
    for lado, s in (("L", 1), ("R", -1)):
        e.hueso(f"upperarm_{lado}", (0.205 * k * s, 1.455 * k, 0), "chest")
        e.hueso(f"forearm_{lado}", (0.235 * k * s, 1.185 * k, -0.01 * k), f"upperarm_{lado}")
        e.hueso(f"hand_{lado}", (0.25 * k * s, 0.935 * k, 0.01 * k), f"forearm_{lado}")
    for lado, s in (("L", 1), ("R", -1)):
        e.hueso(f"thigh_{lado}", (0.095 * k * s, 0.93 * k, 0), "hips")
        e.hueso(f"shin_{lado}", (0.10 * k * s, 0.50 * k, 0.01 * k), f"thigh_{lado}")
        e.hueso(f"foot_{lado}", (0.10 * k * s, 0.085 * k, -0.01 * k), f"shin_{lado}")
    e.hueso("cape1", (0, 1.47 * k, -0.13 * k), "chest")
    e.hueso("cape2", (0, 1.06 * k, -0.19 * k), "cape1")
    return e


def anim_humanoide(esq, k=1.0, estilo="normal", arma="cuerpo"):
    """estilo: normal | zombie | pesado | ligero | flotante. arma: cuerpo | disparo | magia (pose de ataque)."""
    z = estilo == "zombie"
    pesado = estilo == "pesado"
    brazos_z = 0.07

    def piernas(f, amp, rodilla, base_r=0.08):
        o = {}
        for lado, fase in (("L", 0.0), ("R", 0.5)):
            s, c = _s(f, fase), _c(f, fase)
            th = -amp * s
            sh = base_r + rodilla * _pos(c) ** 1.4
            o[f"thigh_{lado}"] = {"r": (th, 0, 0)}
            o[f"shin_{lado}"] = {"r": (sh, 0, 0)}
            o[f"foot_{lado}"] = {"r": (-(th + sh) * 0.45, 0, 0)}
        return o

    def idle(f):
        o = {"hips": {"p": (0, -0.006 * k * (1 + _s(f)), 0)}, "chest": {"r": (0.025 * _s(f), 0, 0)}, "spine": {"r": (0.01, 0, 0)},
             "head": {"r": (0.03 * _s(f, 0.2), 0.12 * _s(f * 0.5 + 0.1), 0)},
             "upperarm_L": {"r": (0.04 * _s(f), 0, brazos_z + 0.02 * _s(f))}, "upperarm_R": {"r": (0.04 * _s(f), 0, -brazos_z - 0.02 * _s(f))},
             "forearm_L": {"r": (-0.18, 0, 0)}, "forearm_R": {"r": (-0.18, 0, 0)},
             "cape1": {"r": (0.05 + 0.03 * _s(f), 0, 0)}, "cape2": {"r": (0.03 * _s(f, 0.3), 0, 0)}}
        if z:
            o["upperarm_L"] = {"r": (-1.35 + 0.05 * _s(f), 0, 0.12)}
            o["upperarm_R"] = {"r": (-1.3 + 0.05 * _s(f, 0.3), 0, -0.12)}
            o["head"] = {"r": (0.25, 0.2 * _s(f * 0.5), 0.15)}
        return o

    def andar(f, correr=False):
        amp = 0.95 if correr else (0.28 if z else 0.5)
        rod = 1.35 if correr else (0.45 if z else 0.75)
        o = piernas(f, amp, rod, 0.15 if correr else 0.06)
        bob = (0.05 if correr else 0.022) * k
        o["hips"] = {"p": (0, -bob * (1 - abs(_c(f))) + (0.02 * k if correr else 0), 0), "r": (0, 0.1 * _s(f), 0.035 * _c(f, 0.25) * (2 if z else 1))}
        o["spine"] = {"r": (0.16 if correr else 0.03, -0.06 * _s(f), 0)}
        o["chest"] = {"r": (0.05 if correr else 0, -0.12 * _s(f), 0)}
        o["head"] = {"r": (-0.08 if correr else 0, 0.05 * _s(f), 0)}
        ab = 0.85 if correr else 0.42
        o["upperarm_L"] = {"r": (ab * _s(f), 0, brazos_z)}
        o["upperarm_R"] = {"r": (-ab * _s(f), 0, -brazos_z)}
        o["forearm_L"] = {"r": (-1.25 if correr else -0.22 - 0.25 * _pos(_s(f)), 0, 0)}
        o["forearm_R"] = {"r": (-1.25 if correr else -0.22 - 0.25 * _pos(-_s(f)), 0, 0)}
        o["cape1"] = {"r": (0.35 if correr else 0.15 + 0.05 * abs(_s(f)), 0, 0.04 * _s(f))}
        o["cape2"] = {"r": (0.25 if correr else 0.12 + 0.08 * _s(f, 0.25), 0, 0)}
        if z:
            o["upperarm_L"] = {"r": (-1.35 + 0.1 * _s(f), 0, 0.1)}
            o["upperarm_R"] = {"r": (-1.3 - 0.1 * _s(f), 0, -0.1)}
            o["forearm_L"] = o["forearm_R"] = {"r": (-0.15, 0, 0)}
            o["head"] = {"r": (0.2, 0.15 * _s(f), 0.2)}
        if pesado:
            o["hips"]["p"] = (0, -0.035 * k * (1 - abs(_c(f))), 0)
            o["hips"]["r"] = (0, 0.06 * _s(f), 0.07 * _c(f, 0.25))
        return o

    def saltar(f):
        o = {"hips": {"p": (0, 0.02 * k * _s(f), 0)}, "spine": {"r": (0.1, 0, 0)},
             "thigh_L": {"r": (-0.95, 0, 0.05)}, "shin_L": {"r": (1.25, 0, 0)}, "foot_L": {"r": (-0.2, 0, 0)},
             "thigh_R": {"r": (-0.25, 0, -0.05)}, "shin_R": {"r": (0.55, 0, 0)}, "foot_R": {"r": (0.15, 0, 0)},
             "upperarm_L": {"r": (-0.6 + 0.08 * _s(f), 0, 0.95)}, "upperarm_R": {"r": (-0.6 - 0.08 * _s(f), 0, -0.95)},
             "forearm_L": {"r": (-0.5, 0, 0)}, "forearm_R": {"r": (-0.5, 0, 0)}, "head": {"r": (-0.12, 0, 0)},
             "cape1": {"r": (0.7, 0, 0)}, "cape2": {"r": (0.5, 0, 0)}}
        return o

    def atacar(f):
        # preparación (0-0.35) → golpe (0.35-0.55) → vuelta (0.55-1)
        prep, golpe = _suave(0.0, 0.35, f), _suave(0.35, 0.52, f)
        vuelta = _suave(0.6, 1.0, f)
        ua = _mezcla(_mezcla(0.0, -2.5, prep), 0.55, golpe)
        ua = _mezcla(ua, 0.0, vuelta)
        tw = _mezcla(_mezcla(0.0, 0.45, prep), -0.55, golpe)
        tw = _mezcla(tw, 0.0, vuelta)
        fa = _mezcla(_mezcla(-0.2, -0.9, prep), -0.1, golpe)
        fa = _mezcla(fa, -0.2, vuelta)
        o = {"hips": {"p": (0, -0.04 * k * golpe * (1 - vuelta), 0.03 * k * golpe * (1 - vuelta)), "r": (0, tw * 0.3, 0)},
             "spine": {"r": (0.12 * golpe * (1 - vuelta), tw * 0.5, 0)}, "chest": {"r": (0.1 * golpe * (1 - vuelta), tw * 0.6, 0)},
             "upperarm_R": {"r": (ua, 0, -0.15 - 0.2 * prep * (1 - golpe))}, "forearm_R": {"r": (fa, 0, 0)},
             "upperarm_L": {"r": (-0.55, 0, 0.25)}, "forearm_L": {"r": (-1.3, 0, 0)},
             "thigh_L": {"r": (-0.35, 0, 0.06)}, "shin_L": {"r": (0.3, 0, 0)}, "thigh_R": {"r": (0.3, 0, -0.06)}, "shin_R": {"r": (0.25, 0, 0)},
             "head": {"r": (0.05, -tw * 0.4, 0)}, "cape1": {"r": (0.2 + 0.2 * golpe, 0, 0)}}
        return o

    def disparar(f):
        rec = _pos(1 - f * 4)  # retroceso al inicio
        o = {"spine": {"r": (0.04, 0.25, 0)}, "chest": {"r": (-0.03 * rec, 0.15, 0)},
             "upperarm_R": {"r": (-1.5 - 0.15 * rec, -0.1, -0.1)}, "forearm_R": {"r": (-0.12 - 0.3 * rec, 0, 0)},
             "upperarm_L": {"r": (-1.35, 0.5, 0.2)}, "forearm_L": {"r": (-0.6, 0, 0)},
             "head": {"r": (0.02, -0.3, 0)}, "thigh_L": {"r": (-0.2, 0, 0.05)}, "thigh_R": {"r": (0.15, 0, -0.05)},
             "shin_L": {"r": (0.15, 0, 0)}, "shin_R": {"r": (0.2, 0, 0)}}
        return o

    def magia(f):
        sube = _suave(0.0, 0.4, f) * (1 - _suave(0.7, 1.0, f))
        o = {"spine": {"r": (-0.12 * sube, 0, 0)}, "chest": {"r": (-0.1 * sube, 0, 0)},
             "upperarm_R": {"r": (-1.6 * sube - 0.2, 0, -0.35 * sube)}, "forearm_R": {"r": (-0.3, 0, 0)},
             "upperarm_L": {"r": (-1.5 * sube - 0.2, 0, 0.35 * sube)}, "forearm_L": {"r": (-0.3, 0, 0)},
             "head": {"r": (-0.2 * sube, 0, 0)}, "cape1": {"r": (0.2 + 0.25 * sube, 0, 0)}, "cape2": {"r": (0.2 * sube, 0, 0)}}
        return o

    def golpe(f):
        g = sin(PI * min(1.0, f * 1.4))
        return {"hips": {"p": (0, 0, -0.05 * k * g)}, "spine": {"r": (-0.25 * g, 0, 0.05 * g)}, "chest": {"r": (-0.2 * g, 0, 0)},
                "head": {"r": (-0.35 * g, 0.1 * g, 0)}, "upperarm_L": {"r": (-0.3 * g, 0, 0.4 * g)}, "upperarm_R": {"r": (-0.3 * g, 0, -0.4 * g)}}

    def morir(f):
        a = _suave(0.0, 0.75, f)
        rebote = sin(PI * _suave(0.72, 0.9, f)) * 0.04 * k
        return {"hips": {"p": (0, -0.83 * k * a + rebote, -0.18 * k * a), "r": (-1.42 * a, 0.2 * a, 0)},
                "spine": {"r": (-0.1 * a, 0, 0)}, "chest": {"r": (-0.1 * a, 0, 0)}, "head": {"r": (-0.3 * a, 0.5 * a, 0)},
                "upperarm_L": {"r": (-0.4 * a, 0, 1.2 * a)}, "upperarm_R": {"r": (-0.6 * a, 0, -1.1 * a)},
                "forearm_L": {"r": (-0.4 * a, 0, 0)}, "forearm_R": {"r": (-0.6 * a, 0, 0)},
                "thigh_L": {"r": (0.1 * a, 0, 0.15 * a)}, "thigh_R": {"r": (-0.35 * a, 0, -0.1 * a)},
                "shin_L": {"r": (0.2 * a, 0, 0)}, "shin_R": {"r": (0.9 * a, 0, 0)}, "cape1": {"r": (1.2 * a, 0, 0)}, "cape2": {"r": (0.2 * a, 0, 0)}}

    def hablar(f):
        o = idle(f)
        o["upperarm_R"] = {"r": (-0.35 - 0.25 * _s(f * 2), 0.2, -0.35)}
        o["forearm_R"] = {"r": (-1.3 - 0.35 * _s(f * 2), 0, 0)}
        o["head"] = {"r": (0.06 * _s(f * 4), 0.15 * _s(f), 0)}
        return o
    lento = 1.25 if (z or pesado) else 1.0
    clips = [G.clip(esq, "Idle", 2.6, idle, 16), G.clip(esq, "Walk", 1.05 * lento, lambda f: andar(f), 16),
             G.clip(esq, "Run", 0.68 * lento, lambda f: andar(f, True), 16), G.clip(esq, "Jump", 0.8, saltar, 8),
             G.clip(esq, "Attack", 0.62, atacar, 16, bucle=False), G.clip(esq, "Shoot", 0.35, disparar, 8, bucle=False),
             G.clip(esq, "Cast", 0.9, magia, 12, bucle=False), G.clip(esq, "Hit", 0.4, golpe, 8, bucle=False),
             G.clip(esq, "Death", 1.3, morir, 16, bucle=False), G.clip(esq, "Talk", 2.0, hablar, 16)]
    return clips


# ─── cuadrúpedo / bípedo ───
def esqueleto_cuadrupedo(p):
    L, h = p["largo"], p["alto"]
    bip = p.get("bipedo")
    e = G.Esqueleto()
    e.hueso("hips", (0, h, -L * 0.5))
    e.hueso("spine", (0, h * (1.02 if not bip else 1.05), 0), "hips")
    e.hueso("chest", (0, h * (1.0 if not bip else 1.1), L * 0.45), "spine")
    cuello = p.get("cuello", 0.35)
    e.hueso("neck", (0, h * (1.0 if not bip else 1.1) + 0.05 * h, L * 0.55), "chest")
    e.hueso("head", (0, h * (1.0 if not bip else 1.1) + cuello * h * 0.8, L * 0.55 + cuello * h * 0.55), "neck")
    e.hueso("jaw", (0, h * (1.0 if not bip else 1.1) + cuello * h * 0.8 - 0.05 * h, L * 0.55 + cuello * h * 0.55 + 0.05 * h), "head")
    cola = p.get("cola_largo", 0.6) * L
    for i in range(3):
        e.hueso(f"tail{i + 1}", (0, h * (1.0 - 0.05 * i), -L * 0.5 - cola * i / 3 - 0.05 * L), "hips" if i == 0 else f"tail{i}")
    w = p.get("ancho", 0.22) * L
    patas = [("back", "hips", -L * 0.42)] + ([] if bip else [("front", "chest", L * 0.42)])
    for nombre, padre, zz in patas:
        for lado, s in (("L", 1), ("R", -1)):
            e.hueso(f"{nombre}_upper_{lado}", (w * s, h * 0.95, zz), padre)
            e.hueso(f"{nombre}_lower_{lado}", (w * s, h * 0.5, zz + (0.03 if nombre == "front" else -0.06) * h), f"{nombre}_upper_{lado}")
            e.hueso(f"{nombre}_paw_{lado}", (w * s, h * 0.07, zz), f"{nombre}_lower_{lado}")
    if bip:  # bracitos
        for lado, s in (("L", 1), ("R", -1)):
            e.hueso(f"arm_{lado}", (w * 0.8 * s, h * 1.0, L * 0.5), "chest")
    if p.get("alas"):
        for lado, s in (("L", 1), ("R", -1)):
            e.hueso(f"wing1_{lado}", (w * 0.8 * s, h * 1.15, L * 0.25), "chest")
            e.hueso(f"wing2_{lado}", (w * 0.8 * s + s * L * 0.55, h * 1.25, L * 0.2), f"wing1_{lado}")
    return e


def anim_cuadrupedo(esq, p):
    bip = p.get("bipedo")
    h = p["alto"]
    alas = p.get("alas")

    def patas(f, amp, rod, galope=False):
        o = {}
        if bip:
            fases = {"back_L": 0.0, "back_R": 0.5}
        elif galope:
            fases = {"front_L": 0.0, "front_R": 0.08, "back_L": 0.5, "back_R": 0.58}
        else:
            fases = {"front_L": 0.0, "back_R": 0.02, "front_R": 0.5, "back_L": 0.52}
        for k, fase in fases.items():
            nombre, lado = k.rsplit("_", 1)
            s, c = _s(f, fase), _c(f, fase)
            o[f"{nombre}_upper_{lado}"] = {"r": (-amp * s, 0, 0)}
            o[f"{nombre}_lower_{lado}"] = {"r": (rod * _pos(c) ** 1.3 * (1 if nombre == "front" else 0.8), 0, 0)}
            o[f"{nombre}_paw_{lado}"] = {"r": (-0.3 * _pos(c), 0, 0)}
        return o

    def cola(f, amp=0.25, vel=1):
        return {f"tail{i + 1}": {"r": (0.05 + (0.1 if bip else 0), amp * _s(f * vel, -0.12 * i), 0)} for i in range(3)}

    def alas_pose(f, amp=0.7, base=0.0):
        if not alas:
            return {}
        return {"wing1_L": {"r": (0, 0.1, base + amp * _s(f))}, "wing2_L": {"r": (0, 0, 0.4 * amp * _s(f, -0.12))},
                "wing1_R": {"r": (0, -0.1, -base - amp * _s(f))}, "wing2_R": {"r": (0, 0, -0.4 * amp * _s(f, -0.12))}}

    def idle(f):
        o = {"chest": {"r": (0.015 * _s(f), 0, 0)}, "neck": {"r": (0.03 * _s(f), 0.1 * _s(f * 0.5), 0)}, "head": {"r": (0.05 * _s(f, 0.2), 0.12 * _s(f * 0.5, 0.1), 0)},
             "jaw": {"r": (0.04 + 0.03 * _s(f * 2), 0, 0)}}
        o.update(cola(f, 0.15))
        o.update(alas_pose(f, 0.08, 0.25))
        if bip:
            o["hips"] = {"p": (0, -0.01 * h * (1 + _s(f)), 0)}
        return o

    def andar(f, correr=False):
        o = patas(f, 0.75 if correr else 0.42, 0.9 if correr else 0.55, galope=correr)
        bob = (0.06 if correr else 0.025) * h
        o["hips"] = {"p": (0, -bob * abs(_s(f)), 0), "r": ((0.1 * _s(f) if correr else 0), 0.05 * _s(f), 0)}
        o["spine"] = {"r": ((-0.12 * _s(f, 0.25) if correr else 0.02 * _s(f * 2)), 0, 0)}
        o["chest"] = {"r": ((-0.08 * _s(f) if correr else 0), -0.05 * _s(f), 0)}
        o["neck"] = {"r": (0.06 * _s(f * 2), 0, 0)}
        o["head"] = {"r": (-0.05 * _s(f * 2), 0, 0)}
        o.update(cola(f, 0.3 if correr else 0.2, 1))
        o.update(alas_pose(f, 0.12, 0.2))
        if bip:
            o["hips"]["r"] = (0.05 * _s(f * 2), 0.08 * _s(f), 0.05 * _c(f))
            o["arm_L"] = {"r": (0.3 * _s(f), 0, 0.2)}
            o["arm_R"] = {"r": (-0.3 * _s(f), 0, -0.2)}
        return o

    def saltar(f):
        o = {"hips": {"r": (-0.2, 0, 0)}, "chest": {"r": (-0.1, 0, 0)}, "head": {"r": (0.2, 0, 0)}}
        for pata in ("front", "back"):
            for lado in ("L", "R"):
                o[f"{pata}_upper_{lado}"] = {"r": ((-0.8 if pata == "front" else 0.7), 0, 0)}
                o[f"{pata}_lower_{lado}"] = {"r": (0.9, 0, 0)}
        o.update(cola(f, 0.1))
        o.update(alas_pose(f, 0.9, 0.2))
        return o

    def atacar(f):
        emb = _suave(0.0, 0.3, f) * (1 - _suave(0.6, 1.0, f))
        mord = sin(PI * _suave(0.25, 0.6, f))
        o = {"hips": {"p": (0, -0.05 * h * emb, 0.25 * h * emb)}, "spine": {"r": (0.1 * emb, 0, 0)}, "chest": {"r": (0.15 * emb, 0, 0)},
             "neck": {"r": (0.35 * emb - 0.2 * mord, 0, 0)}, "head": {"r": (-0.35 * mord, 0, 0)}, "jaw": {"r": (0.9 * mord, 0, 0)}}
        if not bip:
            for lado in ("L", "R"):
                o[f"front_upper_{lado}"] = {"r": (-0.9 * emb, 0, 0)}
                o[f"front_lower_{lado}"] = {"r": (0.6 * emb, 0, 0)}
        o.update(alas_pose(f, 0.6, 0.4 * emb))
        o.update(cola(f, 0.4, 2))
        return o

    def golpe(f):
        g = sin(PI * min(1.0, f * 1.4))
        return {"hips": {"p": (0, 0, -0.08 * h * g)}, "chest": {"r": (-0.2 * g, 0, 0.1 * g)}, "head": {"r": (-0.4 * g, 0.2 * g, 0)}, "jaw": {"r": (0.5 * g, 0, 0)}}

    def morir(f):
        a = _suave(0.0, 0.7, f)
        o = {"hips": {"p": (0, -h * 0.62 * a, 0), "r": (0, 0, 1.45 * a)}, "neck": {"r": (0.2 * a, 0, 0.3 * a)}, "head": {"r": (0.3 * a, 0, 0)},
             "jaw": {"r": (0.5 * a, 0, 0)}}
        for pata in ("front", "back"):
            for lado in ("L", "R"):
                o[f"{pata}_upper_{lado}"] = {"r": (0.2 * a * (1 if lado == "L" else -1), 0, 0)}
                o[f"{pata}_lower_{lado}"] = {"r": (0.4 * a, 0, 0)}
        o.update(alas_pose(0, 0.0, -0.3 * a))
        return o
    return [G.clip(esq, "Idle", 2.6, idle, 16), G.clip(esq, "Walk", 1.0 if not bip else 1.2, andar, 16),
            G.clip(esq, "Run", 0.55 if not bip else 0.7, lambda f: andar(f, True), 16), G.clip(esq, "Jump", 0.8, saltar, 8),
            G.clip(esq, "Attack", 0.7, atacar, 14, bucle=False), G.clip(esq, "Hit", 0.4, golpe, 8, bucle=False),
            G.clip(esq, "Death", 1.2, morir, 12, bucle=False)]


# ─── volador ───
def esqueleto_volador(p):
    h, env = p.get("alto", 1.4), p.get("envergadura", 1.0)
    e = G.Esqueleto()
    e.hueso("body", (0, h, 0))
    e.hueso("head", (0, h + 0.08 * env, 0.28 * env), "body")
    e.hueso("tail", (0, h, -0.3 * env), "body")
    for lado, s in (("L", 1), ("R", -1)):
        e.hueso(f"wing1_{lado}", (0.14 * env * s, h + 0.05 * env, 0.02), "body")
        e.hueso(f"wing2_{lado}", (0.55 * env * s, h + 0.05 * env, 0.0), f"wing1_{lado}")
        e.hueso(f"leg_{lado}", (0.07 * env * s, h - 0.12 * env, -0.02), "body")
    if p.get("rotores"):
        for i in range(4):
            a = PI / 4 + i * PI / 2
            e.hueso(f"rotor{i + 1}", (cos(a) * 0.45 * env, h + 0.1 * env, sin(a) * 0.45 * env), "body")
    return e


def anim_volador(esq, p):
    h = p.get("alto", 1.4)
    rot = p.get("rotores")

    def aleteo(f, amp, vel=1.0, base=0.1):
        if rot:
            return {f"rotor{i + 1}": {"r": (0, TAU * f * 4 * (1 if i % 2 else -1), 0)} for i in range(4)}
        return {"wing1_L": {"r": (0, 0, base + amp * _s(f * vel))}, "wing2_L": {"r": (0, 0, 0.55 * amp * _s(f * vel, -0.12))},
                "wing1_R": {"r": (0, 0, -base - amp * _s(f * vel))}, "wing2_R": {"r": (0, 0, -0.55 * amp * _s(f * vel, -0.12))}}

    def idle(f):
        o = aleteo(f, 0.75, 2)
        o["body"] = {"p": (0, 0.06 * h * _s(f * 2, 0.25), 0), "r": (0.05 * _s(f), 0, 0)}
        o["head"] = {"r": (0.1 * _s(f), 0.3 * _s(f * 0.5), 0)}
        o["tail"] = {"r": (0.1 * _s(f), 0, 0)}
        o["leg_L"] = o["leg_R"] = {"r": (0.6, 0, 0)}
        return o

    def volar(f, rapido=False):
        o = aleteo(f, 1.0 if not rapido else 1.15, 2 if not rapido else 3)
        o["body"] = {"p": (0, 0.08 * h * _s(f * (2 if not rapido else 3), 0.25), 0), "r": (0.18 if rapido else 0.1, 0, 0.08 * _s(f))}
        o["head"] = {"r": (-0.1, 0, 0)}
        o["tail"] = {"r": (0.15 * _s(f * 2), 0.1 * _s(f), 0)}
        o["leg_L"] = o["leg_R"] = {"r": (1.1, 0, 0)}
        return o

    def atacar(f):
        d = sin(PI * f)
        o = aleteo(f, 0.25, 1, -0.3 * d)
        o["body"] = {"p": (0, -0.35 * h * d, 0.4 * h * d), "r": (0.8 * d, 0, 0)}
        o["head"] = {"r": (0.2 * d, 0, 0)}
        o["leg_L"] = o["leg_R"] = {"r": (-0.6 * d, 0, 0)}
        return o

    def golpe(f):
        g = sin(PI * min(1.0, f * 1.4))
        o = aleteo(f, 0.4, 1)
        o["body"] = {"p": (0, 0.1 * h * g, -0.1 * h * g), "r": (-0.5 * g, 0, 0.3 * g)}
        return o

    def morir(f):
        a = _suave(0.0, 0.85, f)
        o = aleteo(0, 0.0, 1, 0.9 * (1 - a) - 0.2)
        o["body"] = {"p": (0, -(h - 0.12) * a, 0), "r": (0.3 * a, TAU * 0.5 * a, 1.4 * a)}
        return o
    return [G.clip(esq, "Idle", 1.6, idle, 16), G.clip(esq, "Walk", 1.2, volar, 16), G.clip(esq, "Run", 0.9, lambda f: volar(f, True), 16),
            G.clip(esq, "Jump", 1.0, volar, 8), G.clip(esq, "Attack", 0.8, atacar, 12, bucle=False), G.clip(esq, "Hit", 0.4, golpe, 8, bucle=False),
            G.clip(esq, "Death", 1.3, morir, 14, bucle=False)]


# ─── arácnido (araña, escorpión, cangrejo) ───
def esqueleto_aracnido(p):
    h, r = p.get("alto", 0.5), p.get("radio", 0.5)
    n = p.get("patas", 8)
    e = G.Esqueleto()
    e.hueso("body", (0, h, 0))
    e.hueso("head", (0, h, r * 0.8), "body")
    e.hueso("abdomen", (0, h + 0.05, -r * 0.6), "body")
    pares = n // 2
    for i in range(pares):
        zz = r * (0.5 - i / max(1, pares - 1)) * 0.9
        for lado, s in (("L", 1), ("R", -1)):
            e.hueso(f"leg{i}_a_{lado}", (s * r * 0.45, h, zz), "body")
            e.hueso(f"leg{i}_b_{lado}", (s * r * 1.25, h + r * 0.35, zz * 1.3), f"leg{i}_a_{lado}")
    if p.get("pinzas"):
        for lado, s in (("L", 1), ("R", -1)):
            e.hueso(f"claw_a_{lado}", (s * r * 0.35, h, r * 1.0), "body")
            e.hueso(f"claw_b_{lado}", (s * r * 0.6, h + 0.05, r * 1.6), f"claw_a_{lado}")
    if p.get("cola"):
        for i in range(4):
            e.hueso(f"tail{i + 1}", (0, h + 0.05 + r * 0.35 * i, -r * 1.1 - r * 0.25 * i + (r * 0.3 * i if i > 2 else 0)), "abdomen" if i == 0 else f"tail{i}")
    return e


def anim_aracnido(esq, p):
    h = p.get("alto", 0.5)
    pares = p.get("patas", 8) // 2

    def patas(f, amp, vel=1.0):
        o = {}
        for i in range(pares):
            for lado, s in (("L", 1), ("R", -1)):
                fase = (0.5 if (i % 2) ^ (lado == "R") else 0.0)
                o[f"leg{i}_a_{lado}"] = {"r": (0, amp * _s(f * vel, fase) * s, s * (0.12 + 0.2 * _pos(_c(f * vel, fase))))}
                o[f"leg{i}_b_{lado}"] = {"r": (0, 0, -s * 0.15 * _pos(_c(f * vel, fase)))}
        return o

    def cola(f, amp=0.08):
        return {f"tail{i + 1}": {"r": (0.35 + amp * _s(f, -0.1 * i), 0, 0)} for i in range(4)}

    def idle(f):
        o = patas(f, 0.04)
        o["body"] = {"p": (0, 0.01 * h * _s(f), 0)}
        o["abdomen"] = {"r": (0.05 * _s(f), 0, 0)}
        o.update(cola(f))
        o["claw_b_L"] = {"r": (0, 0.2 + 0.15 * _s(f), 0)}
        o["claw_b_R"] = {"r": (0, -0.2 - 0.15 * _s(f), 0)}
        return o

    def andar(f, rapido=False):
        o = patas(f, 0.35 if not rapido else 0.45, 1)
        o["body"] = {"p": (0, 0.02 * h * abs(_s(f * 2)), 0), "r": (0, 0.05 * _s(f), 0)}
        o["abdomen"] = {"r": (0.05 * _s(f * 2), 0.08 * _s(f), 0)}
        o.update(cola(f, 0.15))
        return o

    def atacar(f):
        a = sin(PI * f)
        o = patas(0, 0)
        o["body"] = {"p": (0, 0.1 * h * a, 0.1 * h * a), "r": (-0.3 * a, 0, 0)}
        o["head"] = {"r": (0.3 * a, 0, 0)}
        o["claw_a_L"] = {"r": (-0.3 * a, -0.4 * a, 0)}
        o["claw_a_R"] = {"r": (-0.3 * a, 0.4 * a, 0)}
        o["claw_b_L"] = {"r": (0, 0.6 * a, 0)}
        o["claw_b_R"] = {"r": (0, -0.6 * a, 0)}
        o.update({f"tail{i + 1}": {"r": (0.35 + 0.5 * a, 0, 0)} for i in range(4)})
        return o

    def golpe(f):
        g = sin(PI * min(1.0, f * 1.4))
        return {"body": {"p": (0, 0.05 * h * g, -0.1 * h * g), "r": (0.3 * g, 0, 0.2 * g)}}

    def morir(f):
        a = _suave(0.0, 0.8, f)
        o = {"body": {"p": (0, 0.1 * h * sin(PI * a), 0), "r": (0, 0, PI * a)}}
        for i in range(pares):
            for lado, s in (("L", 1), ("R", -1)):
                o[f"leg{i}_a_{lado}"] = {"r": (0, 0, s * 0.8 * a)}
                o[f"leg{i}_b_{lado}"] = {"r": (0, 0, -s * 0.9 * a)}
        return o
    return [G.clip(esq, "Idle", 2.0, idle, 12), G.clip(esq, "Walk", 0.8, andar, 16), G.clip(esq, "Run", 0.5, lambda f: andar(f, True), 16),
            G.clip(esq, "Jump", 0.6, idle, 6), G.clip(esq, "Attack", 0.6, atacar, 12, bucle=False), G.clip(esq, "Hit", 0.35, golpe, 8, bucle=False),
            G.clip(esq, "Death", 1.2, morir, 12, bucle=False)]


# ─── gota (slime, fantasma, calabaza saltarina) ───
def esqueleto_gota(p):
    h = p.get("alto", 1.0)
    e = G.Esqueleto()
    e.hueso("base", (0, 0, 0))
    e.hueso("body", (0, h * 0.02, 0), "base")
    e.hueso("top", (0, h * 0.75, 0), "body")
    if p.get("flota"):
        e.hueso("tail", (0, h * 0.35, 0), "body")
    return e


def anim_gota(esq, p):
    h = p.get("alto", 1.0)
    flota = p.get("flota")

    def idle(f):
        if flota:
            return {"base": {"p": (0, 0.35 * h + 0.08 * h * _s(f), 0)}, "body": {"r": (0.05 * _s(f), 0.1 * _s(f * 0.5), 0.05 * _s(f, 0.25))},
                    "tail": {"r": (0.2 * _s(f, 0.2), 0, 0.25 * _s(f, 0.4))}, "top": {"r": (0, 0.2 * _s(f * 0.5), 0)}}
        sq = 0.06 * _s(f)
        return {"body": {"s": (1 + sq, 1 - sq * 1.2, 1 + sq)}, "top": {"r": (0, 0.1 * _s(f * 0.5), 0)}}

    def saltito(f, alto=0.35, rapido=False):
        if flota:
            return {"base": {"p": (0, 0.35 * h + 0.1 * h * _s(f * 2), 0)}, "body": {"r": (0.25, 0, 0.1 * _s(f))},
                    "tail": {"r": (0.4 + 0.2 * _s(f * 2), 0, 0.3 * _s(f))}}
        salto = _pos(_s(f))
        aplasta = _pos(-_s(f)) ** 0.7
        return {"base": {"p": (0, alto * h * salto, 0)}, "body": {"s": (1 + 0.22 * aplasta - 0.08 * salto, 1 - 0.28 * aplasta + 0.15 * salto, 1 + 0.22 * aplasta - 0.08 * salto),
                                                             "r": (0.15 * salto, 0, 0)}}

    def atacar(f):
        a = sin(PI * f)
        return {"base": {"p": (0, (0.35 * h if flota else 0) + 0.2 * h * a, 0.5 * h * a)}, "body": {"s": (1 - 0.15 * a, 1 - 0.1 * a, 1 + 0.45 * a), "r": (0.3 * a, 0, 0)}}

    def golpe(f):
        g = sin(PI * min(1.0, f * 1.4))
        return {"base": {"p": (0, 0.35 * h if flota else 0, -0.15 * h * g)}, "body": {"s": (1 + 0.25 * g, 1 - 0.3 * g, 1 + 0.25 * g)}}

    def morir(f):
        a = _suave(0.0, 0.8, f)
        return {"base": {"p": (0, (0.35 * h if flota else 0) * (1 - a), 0)}, "body": {"s": (1 + 0.8 * a, max(0.05, 1 - 0.95 * a), 1 + 0.8 * a)}}
    return [G.clip(esq, "Idle", 1.8, idle, 12), G.clip(esq, "Walk", 0.8, saltito, 16), G.clip(esq, "Run", 0.55, lambda f: saltito(f, 0.5, True), 16),
            G.clip(esq, "Jump", 0.8, lambda f: saltito(f, 0.8), 12), G.clip(esq, "Attack", 0.6, atacar, 12, bucle=False),
            G.clip(esq, "Hit", 0.35, golpe, 8, bucle=False), G.clip(esq, "Death", 1.0, morir, 10, bucle=False)]


# ─── serpiente ───
N_SERP = 8


def esqueleto_serpiente(p):
    L, r = p.get("largo", 2.4), p.get("grosor", 0.1)
    e = G.Esqueleto()
    e.hueso("seg0", (0, r, L * 0.45))
    for i in range(1, N_SERP):
        e.hueso(f"seg{i}", (0, r, L * 0.45 - L * i / N_SERP), f"seg{i - 1}")
    e.hueso("head", (0, r * 1.2, L * 0.45 + r * 1.2), "seg0")
    e.hueso("jaw", (0, r * 0.9, L * 0.45 + r * 1.3), "head")
    return e


def anim_serpiente(esq, p):
    def onda(f, amp, fase_seg=0.9):
        o = {f"seg{i}": {"r": (0, amp * _s(f, -i * fase_seg / TAU), 0)} for i in range(N_SERP)}
        return o

    def idle(f):
        o = onda(f, 0.12)
        o["seg0"] = {"r": (-0.35 - 0.05 * _s(f), 0.2 * _s(f), 0)}
        o["head"] = {"r": (0.3, 0.1 * _s(f * 2), 0)}
        o["jaw"] = {"r": (0.1 * _pos(_s(f * 3)), 0, 0)}
        return o

    def andar(f, rapido=False):
        o = onda(f, 0.45 if not rapido else 0.55)
        o["head"] = {"r": (0, -0.2 * _s(f), 0)}
        return o

    def atacar(f):
        a = sin(PI * f)
        o = onda(0, 0.05)
        o["seg0"] = {"r": (-0.9 * a, 0, 0)}
        o["seg1"] = {"r": (-0.3 * a, 0, 0)}
        o["head"] = {"r": (0.6 * a, 0, 0)}
        o["jaw"] = {"r": (0.9 * a, 0, 0)}
        return o

    def golpe(f):
        g = sin(PI * min(1.0, f * 1.4))
        o = onda(f, 0.3 * g)
        o["head"] = {"r": (-0.4 * g, 0.3 * g, 0)}
        return o

    def morir(f):
        a = _suave(0.0, 0.8, f)
        o = {f"seg{i}": {"r": (0, 0, 0.35 * a * (1 if i % 2 else -1))} for i in range(N_SERP)}
        o["seg0"] = {"r": (0, 0, 1.3 * a)}
        return o
    return [G.clip(esq, "Idle", 2.0, idle, 12), G.clip(esq, "Walk", 1.2, andar, 16), G.clip(esq, "Run", 0.8, lambda f: andar(f, True), 16),
            G.clip(esq, "Jump", 1.0, idle, 6), G.clip(esq, "Attack", 0.6, atacar, 12, bucle=False), G.clip(esq, "Hit", 0.35, golpe, 8, bucle=False),
            G.clip(esq, "Death", 1.0, morir, 10, bucle=False)]


# ════════════════════════════════ CONSTRUCTORES DE GEOMETRÍA ════════════════════════════════
PIELES = {"clara": "#f1c9a5", "media": "#d9a27a", "morena": "#b07a52", "oscura": "#6f4a33", "zombie": "#8fa47a", "verde": "#6fae5a",
          "azul": "#6f8fd0", "gris": "#9aa0a8", "hueso": "#efe8d6", "palida": "#e9e2dc", "roja": "#c0513f", "morada": "#8a6ac0"}


def humanoide(p, detalle=1.0):
    """Personaje humanoide completo. p: parámetros (colores, ropa, sombrero, cara, complexión…)."""
    k = 1.0
    esq = esqueleto_humanoide(k)
    C = G.Constructor(detalle)
    B = esq
    piel = p.get("piel", PIELES["clara"])
    mat_piel = p.get("mat_piel", "piel")
    ropa = p.get("camisa", "#3f6fb5")
    pant = p.get("pantalon", "#3a3f4a")
    botas = p.get("botas", "#4a3322")
    guantes = p.get("guantes")
    fuerte = {"delgado": 0.85, "normal": 1.0, "fuerte": 1.2, "gordo": 1.12, "enorme": 1.4}.get(p.get("complexion", "normal"), 1.0)
    hs = {"realista": 1.0, "estilizado": 1.3, "chibi": 1.75}.get(p.get("proporcion", "realista"), 1.0) * p.get("cabeza_escala", 1.0)
    tipo = p.get("tipo", "normal")  # normal | esqueleto | robot | espantapajaros | golem | fantasma_h
    var = p.get("variacion", 0.04)
    manga_larga = p.get("manga", "larga") == "larga"
    oscuro = G.oscurecer
    cam = p.get("camuflaje")
    ropa_v = camuflaje(cam, semilla=5) if cam else ropa   # color «vivo» (puede ser camuflaje)
    pant_v = camuflaje(cam, semilla=9) if cam else pant

    # ---------- cuerpo ----------
    if tipo == "esqueleto":
        hueso_c = p.get("hueso", "#efe8d6")
        C.cilindro((0, 0.98, 0), (0, 1.5, 0), 0.02, 0.02, hueso_c, "hueso", B["spine"])
        for i in range(5):
            y = 1.44 - i * 0.06
            C.toro((0, y, 0.0), 0.11 - i * 0.006, 0.013, hueso_c, "hueso", B["chest"], rot=(0, 0, 0), seg=14, seg_tubo=5, arco=PI * 1.6)
        C.esfera((0, 0.98, 0), (0.13, 0.07, 0.08), hueso_c, "hueso", B["hips"])
        for lado, s in (("L", 1), ("R", -1)):
            C.capsula((0.205 * s, 1.455, 0), (0.235 * s, 1.185, -0.01), 0.02, 0.018, hueso_c, "hueso", B[f"upperarm_{lado}"])
            C.capsula((0.235 * s, 1.185, -0.01), (0.25 * s, 0.935, 0.01), 0.017, 0.015, hueso_c, "hueso", B[f"forearm_{lado}"])
            C.esfera((0.252 * s, 0.9, 0.015), (0.024, 0.04, 0.03), hueso_c, "hueso", B[f"hand_{lado}"])
            C.capsula((0.095 * s, 0.93, 0), (0.1 * s, 0.5, 0.01), 0.026, 0.022, hueso_c, "hueso", B[f"thigh_{lado}"])
            C.capsula((0.1 * s, 0.5, 0.01), (0.1 * s, 0.085, -0.01), 0.022, 0.018, hueso_c, "hueso", B[f"shin_{lado}"])
            C.caja((0.1 * s, 0.035, 0.04), (0.035, 0.03, 0.09), hueso_c, "hueso", B[f"foot_{lado}"], radio=0.02)
            for bj, pos in ((f"forearm_{lado}", (0.235 * s, 1.185, -0.01)), (f"shin_{lado}", (0.1 * s, 0.5, 0.01))):
                C.esfera(pos, 0.03, hueso_c, "hueso", B[bj], seg=8)
            C.esfera((0.19 * s, 1.46, 0), 0.04, hueso_c, "hueso", B["chest"], seg=8)
    elif tipo == "robot":
        met = p.get("metal", "#9aa3ad")
        if p.get("roca"):  # gólem: el mismo cuerpo articulado pero de piedra rugosa
            return _golem(p, detalle)
        C.caja((0, 1.36, 0), (0.2 * fuerte, 0.17, 0.13), ropa, "metal", B["chest"], radio=0.05)
        C.caja((0, 1.12, 0), (0.14, 0.09, 0.1), oscuro(met, 0.7), "metal", B["spine"], radio=0.03)
        C.caja((0, 0.98, 0), (0.16, 0.07, 0.11), met, "metal", B["hips"], radio=0.03)
        C.esfera((0, 1.37, 0.13), 0.04, p.get("luz", "#3bffe8"), "emisivo", B["chest"], emisivo=p.get("luz", "#3bffe8"), seg=10)
        for lado, s in (("L", 1), ("R", -1)):
            C.esfera((0.21 * s, 1.46, 0), 0.07, oscuro(met, 0.8), "metal", B["chest"], seg=12)
            C.caja(((0.22 * s), 1.32, -0.005), (0.045, 0.12, 0.045), met, "metal", B[f"upperarm_{lado}"], radio=0.02)
            C.esfera((0.235 * s, 1.185, -0.01), 0.048, oscuro(met, 0.6), "metal", B[f"forearm_{lado}"], seg=10)
            C.caja((0.243 * s, 1.06, 0), (0.042, 0.11, 0.042), ropa, "metal", B[f"forearm_{lado}"], radio=0.02)
            C.caja((0.252 * s, 0.89, 0.015), (0.035, 0.05, 0.04), oscuro(met, 0.7), "metal", B[f"hand_{lado}"], radio=0.015)
            C.caja((0.097 * s, 0.72, 0), (0.065, 0.19, 0.065), met, "metal", B[f"thigh_{lado}"], radio=0.025)
            C.esfera((0.1 * s, 0.5, 0.01), 0.06, oscuro(met, 0.6), "metal", B[f"shin_{lado}"], seg=10)
            C.caja((0.1 * s, 0.3, 0), (0.055, 0.19, 0.055), ropa, "metal", B[f"shin_{lado}"], radio=0.025)
            C.caja((0.1 * s, 0.045, 0.04), (0.055, 0.045, 0.11), oscuro(met, 0.7), "metal", B[f"foot_{lado}"], radio=0.02)
    else:
        mat_ropa = p.get("mat_camisa", "tela")
        panza = 1.35 if p.get("complexion") == "gordo" else 1.0
        fem = p.get("figura") == "femenina"
        hom = 0.9 if fem else 1.0     # hombros más estrechos
        cad = 1.08 if fem else 1.0    # cadera más ancha
        cin = 0.86 if fem else 1.0    # cintura marcada
        # pelvis
        C.esfera((0, 0.99, -0.005), (0.165 * fuerte * cad, 0.12, 0.115 * fuerte * cad), pant_v, p.get("mat_pantalon", "tela"), B["hips"], variacion=var)
        # torso continuo (superficie de revolución de sección elíptica): cintura → pecho → hombros → cuello, sin «muñeco de nieve».
        # Dos piezas que se solapan: abdomen (columna) y pecho, para que se doble al respirar, atacar o correr.
        def _abd(u, y):
            fr = max(0.0, sin(u))
            return 1 + (0.3 if panza > 1 else 0.04) * fr ** 2 * math.exp(-((y - 1.1) / 0.09) ** 2) + 0.03 * math.cos(u) ** 2
        def _pec(u, y):
            fr = max(0.0, sin(u))
            b = (0.2 * math.exp(-((y - 1.33) / 0.055) ** 2) * math.exp(-((abs(math.cos(u)) - 0.5) / 0.28) ** 2)) if fem else 0.0
            return 1 + fr ** 2 * (0.05 * math.exp(-((y - 1.36) / 0.07) ** 2) + b) - 0.05 * max(0.0, -sin(u)) * math.exp(-((y - 1.25) / 0.08) ** 2)
        f = fuerte
        C.torno((0, 0, 0), [(0.152 * f * cad, 0.97), (0.15 * f * (cad + cin) / 2, 1.03), (0.143 * f * cin, 1.1), (0.148 * f * cin, 1.16), (0.158 * f * hom, 1.23)],
                ropa_v, mat_ropa, B["spine"], seg=22, escala=(1, 1, 0.74 * panza ** 0.5), radial=_abd, variacion=var)
        C.torno((0, 0, 0), [(0.15 * f * cin, 1.18), (0.166 * f * hom, 1.25), (0.176 * f * hom, 1.32), (0.18 * f * hom, 1.38), (0.174 * f * hom, 1.43),
                            (0.152 * f * hom, 1.475), (0.11 * f, 1.512), (0.068, 1.532), (0.05, 1.545)],
                ropa_v, mat_ropa, B["chest"], seg=22, escala=(1, 1, 0.7), radial=_pec, variacion=var)
        for lado, s in (("L", 1), ("R", -1)):
            C.esfera((0.178 * s * fuerte * hom, 1.435, 0), (0.064 * fuerte, 0.056, 0.062 * fuerte), ropa_v, mat_ropa, B["chest"], seg=12)
        if p.get("cuello_camisa", True) and not p.get("armadura") and tipo == "normal":  # cuello de la camisa
            C.toro((0, 1.53, 0.0), 0.058, 0.013, oscuro(ropa, 0.85), mat_ropa, B["chest"], rot=(0, 0, 0), seg=16, seg_tubo=5)
        if p.get("cinturon"):  # banda que sigue la cintura (elíptica), con hebilla
            rb = 0.166 * fuerte * cad * max(1.0, panza * 0.95)
            C.torno((0, 0, 0), [(rb * 0.985, 0.978), (rb * 1.01, 0.986), (rb * 1.01, 1.028), (rb * 0.985, 1.036)], p["cinturon"], "cuero", B["hips"], seg=24,
                    escala=(1, 1, 0.74 * panza ** 0.5), cerrar=False)
            C.caja((0, 1.007, rb * 0.74 * panza ** 0.5 + 0.006), (0.028, 0.021, 0.006), "#c9a64a", "oro", B["hips"], radio=0.005)
        if p.get("chaleco"):  # chaleco / chal: sigue la forma del torso, abierto adelante
            f = fuerte * 1.07
            C.torno((0, 0, 0.004), [(0.155 * f * cin, 1.12), (0.16 * f * hom, 1.2), (0.172 * f * hom, 1.28), (0.18 * f * hom, 1.36), (0.176 * f * hom, 1.42), (0.155 * f * hom, 1.468), (0.11 * f, 1.505)],
                    p["chaleco"], "cuero", B["chest"], seg=22, escala=(1, 1, 0.72), cerrar=False, variacion=var, radial=_pec)
        if p.get("medallas"):
            for k_, cm in enumerate(("#c9a64a", "#c0392b", "#2e86de")):
                C.caja((-0.085 + k_ * 0.03, 1.36, 0.128 * fuerte), (0.011, 0.018, 0.006), cm, "oro" if k_ == 0 else "tela", B["chest"], radio=0.003)
        if p.get("brazalete_medico"):
            C.toro((-0.222 * fuerte, 1.33, -0.005), 0.052 * fuerte, 0.012, "#f2f2f2", "tela", B["upperarm_R"], rot=(0, 0, 0.1), seg=14, seg_tubo=4)
        if p.get("armadura"):
            am = p["armadura"]
            C.caja((0, 1.33, 0.012), (0.18 * fuerte, 0.19, 0.135 * fuerte), am, "metal", B["chest"], radio=0.09)
            C.caja((0, 1.14, 0.01), (0.155 * fuerte, 0.07, 0.12 * fuerte), oscuro(am, 0.85), "metal", B["spine"], radio=0.05)
            for lado, s in (("L", 1), ("R", -1)):
                C.esfera((0.2 * s * fuerte, 1.47, 0), (0.1, 0.075, 0.1), am, "metal", B[f"upperarm_{lado}"], corte=0.6, seg=14)
            for zz in (-1, 1):  # faldón
                C.caja((0.0, 0.9, 0.06 * zz), (0.14 * fuerte, 0.09, 0.025), oscuro(am, 0.75), "metal", B["hips"], radio=0.02)
        if p.get("tunica"):
            tc = p["tunica"]
            C.torno((0, 0.12, 0), [(0.34 * fuerte, 0.0), (0.3 * fuerte, 0.25), (0.22 * fuerte, 0.6), (0.17 * fuerte, 0.88), (0.15, 0.95)], tc,
                    "tela", B["hips"], seg=20, cerrar=False, radial=lambda u, y: 1 + 0.03 * sin(u * 7 + y * 9), variacion=var)
        if p.get("mochila"):
            C.caja((0, 1.3, -0.175 * fuerte), (0.13, 0.17, 0.07), p["mochila"], "tela", B["chest"], radio=0.05, variacion=0.05)
            C.caja((0, 1.18, -0.25 * fuerte), (0.11, 0.05, 0.03), oscuro(p["mochila"], 0.8), "tela", B["chest"], radio=0.02)
            for s in (1, -1):
                C.caja((0.1 * s, 1.36, 0.0), (0.018, 0.14, 0.13 * fuerte), oscuro(p["mochila"], 0.7), "cuero", B["chest"], radio=0.01)
        if p.get("traje_espacial"):
            C.caja((0, 1.33, -0.19), (0.15, 0.19, 0.08), "#e8ecf0", "plastico", B["chest"], radio=0.06)
            C.esfera((0, 1.38, 0.115), (0.06, 0.04, 0.02), "#3bffe8", "emisivo", B["chest"], emisivo="#2ad8c8", seg=10)
        # brazos
        manga = ropa_v if manga_larga else piel
        mat_manga = mat_ropa if manga_larga else mat_piel
        for lado, s in (("L", 1), ("R", -1)):
            C.capsula((0.205 * s * fuerte, 1.455, 0), (0.235 * s * fuerte, 1.185, -0.01), 0.056 * fuerte, 0.046 * fuerte, ropa_v if p.get("manga") != "sin" else piel,
                      mat_ropa if p.get("manga") != "sin" else mat_piel, B[f"upperarm_{lado}"], variacion=var)
            C.esfera((0.235 * s * fuerte, 1.185, -0.01), 0.047 * fuerte, manga, mat_manga, B[f"forearm_{lado}"], seg=10)
            C.capsula((0.235 * s * fuerte, 1.185, -0.01), (0.25 * s * fuerte, 0.955, 0.01), 0.045 * fuerte, 0.034 * fuerte, manga, mat_manga, B[f"forearm_{lado}"], variacion=var)
            if manga_larga:  # puño de la manga (tapa la unión con la muñeca)
                C.toro((0.25 * s * fuerte, 0.962, 0.01), 0.037 * fuerte, 0.009, oscuro(ropa, 0.85), mat_ropa, B[f"forearm_{lado}"], seg=14, seg_tubo=5)
            if manga_larga and not guantes:
                C.capsula((0.25 * s * fuerte, 0.955, 0.01), (0.25 * s * fuerte, 0.925, 0.01), 0.031 * fuerte, 0.029 * fuerte, piel, mat_piel, B[f"hand_{lado}"], seg=10)
            mano = guantes or piel
            C.esfera((0.254 * s * fuerte, 0.885, 0.018), (0.03 * fuerte, 0.052, 0.045), mano, "cuero" if guantes else mat_piel, B[f"hand_{lado}"], seg=12)
            C.capsula((0.243 * s * fuerte, 0.905, 0.05), (0.232 * s * fuerte, 0.865, 0.075), 0.012, 0.011, mano, "cuero" if guantes else mat_piel, B[f"hand_{lado}"], seg=6)
            for k_ in range(4):  # dedos, un poco doblados
                zf = -0.018 + k_ * 0.017
                C.capsula((0.256 * s * fuerte, 0.848, zf + 0.012), (0.25 * s * fuerte, 0.812 + 0.004 * abs(k_ - 1.5), zf + 0.02), 0.0095, 0.008, mano,
                          "cuero" if guantes else mat_piel, B[f"hand_{lado}"], seg=6)
            if p.get("paja"):  # espantapájaros: paja saliendo de mangas y piernas
                for i in range(5):
                    a = i * TAU / 5
                    C.cono((0.25 * s * fuerte + 0.02 * cos(a), 0.95, 0.01 + 0.02 * sin(a)), (0.26 * s * fuerte + 0.05 * cos(a), 0.86, 0.01 + 0.05 * sin(a)),
                           0.012, "#d9b25a", "pelo", B[f"hand_{lado}"], seg=5)
        # piernas
        pierna_mat = p.get("mat_pantalon", "tela")
        altas = p.get("botas_altas")
        for lado, s in (("L", 1), ("R", -1)):
            C.capsula((0.095 * s, 0.93, 0), (0.1 * s, 0.5, 0.01), 0.088 * fuerte, 0.06 * fuerte, pant_v, pierna_mat, B[f"thigh_{lado}"], variacion=var)
            C.esfera((0.1 * s, 0.5, 0.012), 0.061 * fuerte, pant_v, pierna_mat, B[f"shin_{lado}"], seg=10)
            C.capsula((0.1 * s, 0.5, 0.01), (0.1 * s, 0.1, -0.01), 0.058 * fuerte, 0.042 * fuerte, botas if altas else pant_v, "cuero" if altas else pierna_mat,
                      B[f"shin_{lado}"], variacion=var)
            if not altas:
                C.capsula((0.1 * s, 0.17, -0.01), (0.1 * s, 0.09, -0.01), 0.047, 0.045, botas, "cuero", B[f"foot_{lado}"], seg=10)
            C.caja((0.1 * s, 0.045, 0.045), (0.05 * fuerte, 0.045, 0.115), botas, "cuero", B[f"foot_{lado}"], radio=0.038, variacion=0.03)
            C.caja((0.1 * s, 0.012, 0.045), (0.052 * fuerte, 0.012, 0.118), oscuro(botas, 0.45), "goma", B[f"foot_{lado}"], radio=0.01)
            if p.get("paja"):
                for i in range(4):
                    a = i * TAU / 4 + 0.4
                    C.cono((0.1 * s + 0.03 * cos(a), 0.14, 0.03 * sin(a)), (0.1 * s + 0.07 * cos(a), 0.06, 0.07 * sin(a)), 0.013, "#d9b25a", "pelo", B[f"shin_{lado}"], seg=5)
            if p.get("parches"):
                C.caja((0.1 * s + 0.07 * s, 0.7, 0.03), (0.005, 0.05, 0.045), p["parches"], "tela", B[f"thigh_{lado}"], radio=0.003)
        if p.get("parches"):
            C.caja((0.09, 1.3, 0.121 * fuerte), (0.045, 0.05, 0.006), p["parches"], "tela", B["chest"], radio=0.004)
        if p.get("vendas"):  # momia: tiras cruzadas
            for i in range(9):
                y = 0.6 + i * 0.1
                bone = B["hips"] if y < 1.05 else B["spine"] if y < 1.22 else B["chest"]
                C.toro((0, y, 0), 0.16 * fuerte if y > 0.9 else 0.19, 0.012, oscuro(p["vendas"], 0.9 + 0.1 * (i % 2)), "tela", bone, rot=(0.12 * (1 if i % 2 else -1), 0, 0), seg=18, seg_tubo=4)
    # cuello
    if tipo not in ("esqueleto",):
        C.capsula((0, 1.49, 0), (0, 1.6, 0.005), 0.058 * max(1.0, fuerte * 0.95), 0.052, piel if tipo != "robot" else "#555b63",
                  mat_piel if tipo != "robot" else "metal", B["neck"], seg=10)
    else:
        C.cilindro((0, 1.5, 0), (0, 1.6, 0), 0.018, 0.018, p.get("hueso", "#efe8d6"), "hueso", B["neck"], seg=6)
    # ---------- cabeza ----------
    cabeza(C, B["head"], p, hs, tipo)
    # ---------- capa ----------
    if p.get("capa"):
        cc = p["capa"]
        C.plano((0, 1.49, -0.14), 0.46 * fuerte, 0.46, cc, "tela_doble", B["cape1"], rot=(0.08, 0, 0), curva=0.07, div=5)
        C.plano((0, 1.07, -0.2), 0.52 * fuerte, 0.62, cc, "tela_doble", B["cape2"], rot=(0.06, 0, 0), curva=0.09, div=6)
        C.toro((0, 1.49, -0.02), 0.13 * fuerte, 0.015, oscuro(cc, 0.7), "tela", B["chest"], rot=(0.25, 0, 0), seg=16, seg_tubo=5, arco=PI)
    # a todo el conjunto se lo escala al final (cabeza grande = más alto)
    return C, esq


# ─── estilo BLOQUES (vóxel, pixel art en 3D): mismo esqueleto y animaciones que los demás ───
def camuflaje(colores, escala=5.0, semilla=7):
    """Color de camuflaje según la posición (manchas continuas entre piezas)."""
    cs = list(colores)

    def f(p):
        n = G.fbm3(p[0] * escala, p[1] * escala, p[2] * escala, semilla, 2)
        m = G.fbm3(p[0] * escala * 1.7 + 11, p[1] * escala * 1.7, p[2] * escala * 1.7, semilla + 3, 2)
        k = 0 if n < -0.12 else 1 if n < 0.12 else 2
        if len(cs) > 3 and m > 0.28:
            k = 3
        return cs[k % len(cs)]
    return f


def esqueleto_bloques():
    e = G.Esqueleto()
    e.hueso("hips", (0, 0.93, 0))
    e.hueso("spine", (0, 1.1, 0), "hips")
    e.hueso("chest", (0, 1.3, 0), "spine")
    e.hueso("neck", (0, 1.53, 0), "chest")
    e.hueso("head", (0, 1.55, 0), "neck")
    for lado, s in (("L", 1), ("R", -1)):
        e.hueso(f"upperarm_{lado}", (0.36 * s, 1.5, 0), "chest")
        e.hueso(f"forearm_{lado}", (0.36 * s, 1.22, 0), f"upperarm_{lado}")
        e.hueso(f"hand_{lado}", (0.36 * s, 0.95, 0.0), f"forearm_{lado}")
    for lado, s in (("L", 1), ("R", -1)):
        e.hueso(f"thigh_{lado}", (0.125 * s, 0.93, 0), "hips")
        e.hueso(f"shin_{lado}", (0.125 * s, 0.48, 0), f"thigh_{lado}")
        e.hueso(f"foot_{lado}", (0.125 * s, 0.1, 0), f"shin_{lado}")
    e.hueso("cape1", (0, 1.5, -0.15), "chest")
    e.hueso("cape2", (0, 1.06, -0.17), "cape1")
    return e


def _cara_bloques(p):
    """Pixel art 8×8 de la cara (+z), los lados, la nuca y la coronilla según el pelo, la barba y el tipo de cara."""
    pelo_t = p.get("pelo_tipo", "corto")
    calvo = pelo_t == "calvo"
    cara = p.get("cara", "normal")
    tipo = p.get("tipo", "normal")
    h = "s" if calvo else "h"
    enojado = p.get("enojado")
    if tipo == "esqueleto" or cara == "calavera":
        frente = ["ssssssss", "ssssssss", "ssssssss", "skksskks", "skksskks", "ssskksss", "sksksksk", "ssssssss"]
        lado = ["s" * 8] * 8
        return {"+z": frente, "+x": lado, "-x": lado, "-z": lado, "+y": lado}
    if tipo == "robot" or cara == "robot":
        frente = ["mmmmmmmm", "mkkkkkkm", "mkllkllm", "mkkkkkkm", "mmmmmmmm", "mkkkkkkm", "mmmmmmmm", "mmmmmmmm"]
        lado = ["mmmmmmmm", "mmmkmmmm", "mmkkkmmm", "mmmkmmmm", "mmmmmmmm", "mmmmmmmm", "mmmmmmmm", "mmmmmmmm"]
        return {"+z": frente, "+x": lado, "-x": lado, "-z": ["m" * 8] * 8, "+y": ["m" * 8] * 8}
    fr = [h * 8, h * 8 if pelo_t != "punk" else "hhhhhhhh", ("s" * 8 if pelo_t in ("mono", "coleta") else h + "ssssss" + h) if not calvo else "s" * 8]
    fr[2] = fr[2][:8]
    fr.append("sbbssbbs" if not enojado else "bbssssbb")
    fr.append("swissiws" if cara != "zombie" else "sziszizs")
    fr.append("sssnnsss")
    fr.append("ssmmmmss" if not enojado else "smmmmmms")
    fr.append("ssssssss")
    if p.get("barba"):
        fr[5] = "rrrnnrrr"
        fr[6] = "rrmmmmrr"
        fr[7] = "rrrrrrrr"
    if p.get("sombrero") == "ninja" or p.get("mascara"):
        fr[5] = "kkkkkkkk"
        fr[6] = "kkkkkkkk"
        fr[7] = "kkkkkkkk"
    largo = pelo_t in ("largo", "melena", "coleta")
    lado = [h * 8, h * 8, (h * 6 + "ss") if not calvo else "s" * 8, (h * 3 + "sssss") if not calvo else "s" * 8,
            ("hh" + "ssssss") if largo else "s" * 8, ("hh" + "ssssss") if largo else "s" * 8, "s" * 8, "s" * 8]
    lado_i = [r[::-1] for r in lado]
    nuca = [h * 8] * (8 if largo else 5) + ["s" * 8] * (0 if largo else 3)
    return {"+z": fr, "+x": lado_i, "-x": lado, "-z": nuca, "+y": [h * 8] * 8}


def _gorro_bloques(C, B, p, P):
    """Sombreros y cascos en bloques sobre la cabeza (cubo de 0.46 con base en y=0)."""
    t = p.get("sombrero")
    col = p.get("color_sombrero")
    hb = B["head"]
    cam = p.get("camuflaje")
    if not t:
        return
    if t in ("militar", "casco_militar"):  # casco de combate
        c = camuflaje(cam) if cam else (col or "#5a6b3a")
        C.cubo(P(0, 0.44, 0), (0.54, 0.14, 0.54), c, hb, pix=9)
        C.cubo(P(0, 0.36, 0), (0.58, 0.04, 0.58), c if not callable(c) else "#4a5a32", hb, pix=9)
        C.cubo(P(0.0, 0.27, -0.26), (0.5, 0.2, 0.06), c if not callable(c) else "#4a5a32", hb, pix=8)
    elif t in ("gorra_militar", "boina"):  # gorra militar con visera
        c = camuflaje(cam) if cam else (col or "#5a6b3a")
        C.cubo(P(0, 0.49, 0), (0.5, 0.1, 0.5), c, hb, pix=8)
        C.cubo(P(0, 0.45, 0.3), (0.34, 0.03, 0.16), G.oscurecer(col or "#4a5a32", 0.8), hb, pix=6)
    elif t == "gorra":
        c = col or "#c0392b"
        C.cubo(P(0, 0.49, 0), (0.5, 0.1, 0.5), c, hb, pix=8)
        C.cubo(P(0, 0.45, 0.32), (0.38, 0.03, 0.2), G.oscurecer(c, 0.8), hb, pix=6)
    elif t in ("paja", "vaquero", "explorador"):
        c = col or {"paja": "#e3c46a", "vaquero": "#7a5433", "explorador": "#d8c8a0"}[t]
        C.cubo(P(0, 0.47, 0), (0.86 if t == "paja" else 0.74, 0.05, 0.86 if t == "paja" else 0.66), c, hb, pix=12)
        C.cubo(P(0, 0.56, 0), (0.48, 0.16, 0.48), c, hb, pix=8, dibujos={"+z": ["cccccccc", "cccccccc", "rrrrrrrr"], "-z": ["cccccccc", "cccccccc", "rrrrrrrr"],
               "+x": ["cccccccc", "cccccccc", "rrrrrrrr"], "-x": ["cccccccc", "cccccccc", "rrrrrrrr"]}, paleta={"c": c, "r": p.get("cinta", "#8a2a2a")})
    elif t in ("bruja", "mago"):
        c = col or ("#2a1a3a" if t == "bruja" else "#3a4aa0")
        C.cubo(P(0, 0.47, 0), (0.8, 0.05, 0.8), c, hb, pix=12)
        for i, (w, y) in enumerate(((0.44, 0.58), (0.34, 0.74), (0.24, 0.88), (0.14, 1.0))):
            C.cubo(P(0.02 * i, y, -0.02 * i), (w, 0.16, w), c, hb, pix=6)
    elif t == "corona":
        oro = col or ORO
        C.cubo(P(0, 0.5, 0), (0.5, 0.1, 0.5), oro, hb, mat="oro", pix=8, dibujos={"+z": ["..r..r.."]}, paleta={"r": "#c0392b"})
        for x in (-0.19, 0, 0.19):
            for z in (-0.19, 0.19):
                C.cubo(P(x, 0.6, z), (0.08, 0.1, 0.08), oro, hb, mat="oro", pix=2)
    elif t == "capucha":
        c = col or p.get("capa") or "#3a3a4a"
        C.cubo(P(0, 0.49, -0.02), (0.54, 0.08, 0.52), c, hb, pix=8)
        C.cubo(P(0, 0.24, -0.26), (0.54, 0.5, 0.06), c, hb, pix=8)
        for s_ in (1, -1):
            C.cubo(P(0.26 * s_, 0.24, 0.0), (0.04, 0.5, 0.5), c, hb, pix=8)
    elif t == "casco_espacial":
        C.cubo(P(0, 0.23, 0), (0.58, 0.58, 0.58), "#bfe6ff", hb, mat="cristal", pix=3, ruido=0.0)
        C.cubo(P(0, -0.03, 0), (0.6, 0.08, 0.6), "#e8ecf0", hb, mat="plastico", pix=8)
    elif t == "casco_vikingo":
        C.cubo(P(0, 0.44, 0), (0.52, 0.14, 0.52), "#9aa3ad", hb, mat="metal", pix=8)
        for s_ in (1, -1):
            C.cubo(P(0.3 * s_, 0.5, 0), (0.1, 0.08, 0.08), "#efe8d6", hb, mat="hueso", pix=2)
            C.cubo(P(0.36 * s_, 0.6, 0), (0.08, 0.14, 0.08), "#efe8d6", hb, mat="hueso", pix=2)
    elif t == "casco" or t == "casco_caballero":
        C.cubo(P(0, 0.24, 0), (0.52, 0.52, 0.52), col or "#9aa3ad", hb, mat="metal", pix=8,
               dibujos={"+z": ["mmmmmmmm", "mmmmmmmm", "mmmmmmmm", "mkkkkkkm", "mmmmmmmm", "mmmkmmmm", "mmmkmmmm", "mmmmmmmm"]}, paleta={"m": col or "#9aa3ad", "k": "#101418"})
        if p.get("penacho"):
            C.cubo(P(0, 0.56, -0.05), (0.06, 0.12, 0.3), p["penacho"], hb, pix=3)
    elif t == "pirata":
        c = col or "#1a1a1f"
        C.cubo(P(0, 0.52, 0), (0.62, 0.14, 0.4), c, hb, pix=8, dibujos={"+z": ["cccccccc", "cccwwccc"]}, paleta={"c": c, "w": "#efe8d6"})
    elif t == "calabaza":
        cal = p.get("calabaza", "#ff7a1a")
        C.cubo(P(0, 0.24, 0), (0.54, 0.5, 0.54), cal, hb, pix=8, dibujos={"+z": ["oooooooo", "oooooooo", "offooffo", "offooffo",
               "oooooooo", "offffffo", "ooffffoo", "oooooooo"]}, paleta={"o": cal, "f": p.get("fuego", "#ffb13a")})
        C.cubo(P(0, 0.54, 0), (0.08, 0.12, 0.08), "#4a6a2a", hb, pix=2)


def humanoide_bloques(p, detalle=1.0):
    """Personaje de bloques (estilo vóxel/pixel art), con el esqueleto humanoide: usa las mismas animaciones."""
    esq = esqueleto_bloques()
    C = G.Constructor(detalle, ao=True)
    B = esq
    tipo = p.get("tipo", "normal")
    piel = p.get("piel", PIELES["clara"])
    if tipo == "esqueleto":
        piel = p.get("hueso", "#efe8d6")
    ropa = p.get("camisa", "#3f6fb5")
    pant = p.get("pantalon", "#3a3f4a")
    botas = p.get("botas", "#4a3322")
    guantes = p.get("guantes")
    pelo = p.get("pelo", "#3a2a1a")
    cam = p.get("camuflaje")
    ropa_c = camuflaje(cam, semilla=5) if cam else ropa
    pant_c = camuflaje(cam, semilla=9) if cam else pant
    if tipo == "esqueleto":  # huesos: todo del color del hueso, con costillas
        ropa = ropa_c = pant = pant_c = botas = piel
        guantes = None
    if tipo == "robot":
        ropa_c = ropa
        pant_c = p.get("metal", "#9aa3ad")
    fuerte = {"delgado": 0.9, "normal": 1.0, "fuerte": 1.1, "gordo": 1.12, "enorme": 1.3}.get(p.get("complexion", "normal"), 1.0)
    mat_ropa = "metal" if tipo == "robot" else p.get("mat_camisa", "tela")
    manga_larga = p.get("manga", "larga") == "larga"
    ojos = p.get("ojos", "#3a6ab0")

    def P(x, y, z):  # cabeza: base en y = 1.55
        return (x, 1.55 + y, z)
    # cabeza con cara pixel art
    pal = {"s": piel, "h": pelo, "b": G.oscurecer(pelo, 0.7) if p.get("pelo_tipo") != "calvo" else G.oscurecer(piel, 0.7), "w": "#f4f1ea",
           "i": ojos, "n": G.oscurecer(piel, 0.86), "m": G.mezclar_hex(piel, "#8a3a30", 0.55), "r": p.get("color_barba", pelo), "k": "#1a1a1f",
           "z": "#d8d8b0", "l": p.get("luz", "#3bffe8"), "_ruido": "shr"}
    if tipo == "robot":
        pal.update({"m": p.get("metal", "#9aa3ad"), "k": "#101418"})
    if tipo == "esqueleto" or p.get("cara") == "calavera":
        pal.update({"s": piel, "k": "#141414"})
    if p.get("cara") == "calabaza":
        p = dict(p, sombrero="calabaza")
    if p.get("sombrero") != "calabaza":
        C.cubo(P(0, 0.23, 0), (0.46, 0.46, 0.46), piel, B["head"], dibujos=_cara_bloques(p), paleta=pal, mat="piel" if tipo != "robot" else "metal",
               ruido=0.05, semilla=3)
    _gorro_bloques(C, B, p, P)
    if p.get("orejas") == "puntiagudas":
        for s_ in (1, -1):
            C.cubo(P(0.28 * s_, 0.28, 0), (0.1, 0.14, 0.06), piel, B["head"], pix=3)
    if p.get("cuernos_h"):
        for s_ in (1, -1):
            C.cubo(P(0.18 * s_, 0.52, 0.05), (0.08, 0.14, 0.08), p.get("color_cuernos", "#2a1a1a"), B["head"], pix=2)
    # torso (dos bloques que se ven como uno) con cinturón, chaleco, armadura…
    w, d = 0.5 * fuerte, 0.26 * fuerte
    frente_sup, frente_inf = None, None
    paleta_t = {"v": p.get("chaleco") or ropa, "p": G.oscurecer(p.get("chaleco") or ropa, 0.75), "c": p.get("cinturon") or G.oscurecer(pant, 0.7),
                "g": "#c9a64a", "t": pant, "x": "#f2f2f2", "e": p.get("insignia", "#c9a64a"), "_ruido": "vpt"}
    if p.get("chaleco"):
        frente_sup = ["vvvvvvvv", "vpvvvvpv", "vvvvvvvv", "vpvvvvpv", "vvvvvvvv", "vvvvvvvv"] if p.get("chaleco_tactico", True) else ["vv....vv"] * 6
        frente_inf = ["vpvvvvpv", "vvvvvvvv", "vvvvvvvv", "cccgcccc" if p.get("cinturon") else "vvvvvvvv", "tttttttt"]
    else:
        frente_sup = ["........"] * 6
        if p.get("medallas"):
            frente_sup[2] = ".ee....."
            frente_sup[3] = ".ee....."
        frente_inf = ["........", "........", "........", "cccgcccc" if p.get("cinturon") else "........", "tttttttt"]
    if tipo == "esqueleto":
        paleta_t.update({"k": "#2a2622", "_ruido": ""})
        frente_sup = ["ssssssss".replace("s", "."), ".kk..kk.", "........", ".kk..kk.", "........", "k......k"]
        frente_inf = ["...kk...", "k..kk..k", "...kk...", "........", "........"]
    if p.get("brazalete_medico"):
        paleta_t["x"] = "#f2f2f2"
    C.cubo((0, 1.365, 0), (w, 0.34, d), ropa_c, B["chest"], dibujos={"+z": frente_sup, "-z": ["vvvvvvvv"] * 6 if p.get("chaleco") else None},
           paleta=paleta_t, mat=mat_ropa, semilla=11)
    C.cubo((0, 1.08, 0), (w * 0.99, 0.3, d * 0.99), ropa_c, B["spine"], dibujos={"+z": frente_inf, "-z": ["vvvvvvvv"] * 3 + ["cccccccc" if p.get("cinturon") else "........", "tttttttt"]
           if p.get("chaleco") else ["........"] * 3 + ["cccccccc" if p.get("cinturon") else "........", "tttttttt"]}, paleta=paleta_t, mat=mat_ropa, semilla=13)
    if p.get("armadura"):
        am = p["armadura"]
        C.cubo((0, 1.33, 0.005), (w + 0.06, 0.42, d + 0.06), am, B["chest"], mat="metal", pix=8)
        for s_ in (1, -1):
            C.cubo((0.36 * s_, 1.5, 0), (0.28, 0.1, 0.28), am, B["upperarm_L" if s_ > 0 else "upperarm_R"], mat="metal", pix=6)
    if p.get("tunica"):
        tc = p["tunica"]
        C.cubo((0, 0.55, 0), (w + 0.06, 0.8, d + 0.08), tc, B["hips"], pix=8)
    if p.get("mochila"):
        C.cubo((0, 1.3, -d / 2 - 0.09), (0.36, 0.42, 0.16), camuflaje(cam, semilla=21) if cam else p["mochila"], B["chest"], pix=8,
               dibujos={"-z": ["mmmmmmmm", "mppppppm", "mppppppm", "mmmmmmmm", "mmmmmmmm", "mmmmmmmm", "mmmmmmmm", "mmmmmmmm"]},
               paleta={"m": p["mochila"], "p": G.oscurecer(p["mochila"], 0.8)})
    if p.get("capa"):
        cc = p["capa"]
        C.plano((0, 1.5, -d / 2 - 0.02), 0.5 * fuerte, 0.44, cc, "tela_doble", B["cape1"], curva=0.0, div=4)
        C.plano((0, 1.06, -d / 2 - 0.03), 0.52 * fuerte, 0.66, cc, "tela_doble", B["cape2"], curva=0.02, div=4)
    # brazos
    for lado, s_ in (("L", 1), ("R", -1)):
        x = 0.36 * s_ * (1 + (fuerte - 1) * 0.6)
        manga = ropa_c if p.get("manga") != "sin" else piel
        C.cubo((x, 1.365, 0), (0.22, 0.3, 0.22), manga, B[f"upperarm_{lado}"], mat=mat_ropa if p.get("manga") != "sin" else "piel", semilla=20 + s_)
        ante = ropa_c if manga_larga else piel
        C.cubo((x, 1.09, 0), (0.215, 0.27, 0.215), ante, B[f"forearm_{lado}"], mat=mat_ropa if manga_larga else "piel", semilla=24 + s_,
               dibujos={"+z": ["........"] * 5 + ["pppppppp"]} if p.get("brazalete_medico") and s_ > 0 else None, paleta={"p": "#f2f2f2"})
        C.cubo((x, 0.885, 0), (0.21, 0.14, 0.21), guantes or piel, B[f"hand_{lado}"], mat="cuero" if guantes else "piel", pix=6)
    # piernas y botas
    altas = p.get("botas_altas")
    for lado, s_ in (("L", 1), ("R", -1)):
        x = 0.125 * s_
        C.cubo((x, 0.705, 0), (0.24, 0.46, 0.24), pant_c, B[f"thigh_{lado}"], mat=p.get("mat_pantalon", "tela"), semilla=30 + s_)
        C.cubo((x, 0.29, 0), (0.235, 0.4, 0.235), botas if altas else pant_c, B[f"shin_{lado}"], mat="cuero" if altas else p.get("mat_pantalon", "tela"), semilla=34 + s_)
        C.cubo((x, 0.055, 0.025), (0.25, 0.11, 0.3), botas, B[f"foot_{lado}"], mat="cuero", pix=7, semilla=38 + s_)
    return C, esq


def cuadrupedo_bloques(p, detalle=1.0):
    """Animal de bloques (vóxel) con el esqueleto de cuadrúpedo: camina, corre, ataca y cae con sus animaciones."""
    esq = esqueleto_cuadrupedo(p)
    C = G.Constructor(detalle, ao=True)
    B = esq
    L, h = p["largo"], p["alto"]
    bip = p.get("bipedo")
    pel = p.get("pelaje", "#7a6a5a")
    vientre = p.get("vientre", G.mezclar_hex(pel, "#f0e6d8", 0.35))
    w = p.get("ancho", 0.22) * L
    gordo = p.get("gordura", 1.0)
    hp = lambda n: esq.huesos[esq[n]]["pos"]
    manchas = p.get("manchas")

    def cuerpo_color(semilla):
        if manchas:
            return lambda q: manchas if G.fbm3(q[0] * 5 + semilla, q[1] * 5, q[2] * 5, semilla, 2) > 0.18 else pel
        return pel
    ancho_c = (2 * w + 0.22 * h) * gordo
    alto_c = 0.52 * h * gordo
    yc = h * 0.97 if not bip else h * 1.05
    zh, zc = hp("hips")[2], hp("chest")[2]
    lana = p.get("lana")
    for nombre, z0, z1 in (("hips", zh - 0.06 * L, (zh + zc) / 2 + 0.02 * L), ("chest", (zh + zc) / 2 - 0.02 * L, zc + 0.08 * L)):
        tam = (ancho_c + (0.08 if lana else 0), alto_c + (0.08 if lana else 0), z1 - z0)
        C.cubo((0, yc, (z0 + z1) / 2), tam, lana or cuerpo_color(3 if nombre == "hips" else 5), B[nombre], mat="pelo", caras={"-y": vientre},
               pix=10 if lana else 8, ruido=0.12 if lana else 0.08, semilla=7)
    # cabeza con cara pixel art (ojos, hocico, nariz)
    hc = hp("head")
    cab = 0.5 * h * p.get("cabeza", 1.0)
    ojos = p.get("ojos", "#1a1a1a")
    frente = ["pppppppp", "pppppppp", "pwkppkwp" if not p.get("ojos_brillo") else "pyyppyyp", "pppppppp", "pppppppp", "pppppppp", "pppppppp", "pppppppp"]
    lana_cara = p.get("cara_color", pel)
    C.cubo((hc[0], hc[1] + cab * 0.15, hc[2] + cab * 0.2), (cab, cab * 0.9, cab * 0.9), lana_cara, B["head"],
           dibujos={"+z": frente}, paleta={"p": lana_cara, "w": "#f4f1ea", "k": ojos, "y": p.get("ojos_brillo", "#ffd23f"), "_ruido": "p"}, mat="pelo", semilla=9)
    hoc = p.get("hocico", 0.8)
    if hoc:
        nariz = p.get("nariz", "#2a1a1a")
        C.cubo((hc[0], hc[1] + cab * 0.02, hc[2] + cab * 0.65 + cab * 0.25 * hoc / 2), (cab * 0.55, cab * 0.4, cab * 0.5 * hoc), p.get("color_hocico", G.mezclar_hex(pel, vientre, 0.5)),
               B["jaw"] if "jaw" in esq else B["head"], dibujos={"+z": ["ssnssnss", "ssssssss", "ssssssss", "ssssssss"]},
               paleta={"s": p.get("color_hocico", G.mezclar_hex(pel, vientre, 0.5)), "n": nariz}, mat="pelo", pix=6)
        if p.get("dientes"):
            for s_ in (1, -1):
                C.cubo((hc[0] + cab * 0.15 * s_, hc[1] - cab * 0.2, hc[2] + cab * 0.85), (0.03, 0.06, 0.03), "#f2efe4", B["jaw"] if "jaw" in esq else B["head"], mat="hueso", pix=1)
    orejas = p.get("orejas", "redondas")
    if orejas != "ninguna":
        for s_ in (1, -1):
            alto_o = cab * (0.45 if orejas == "puntiagudas" else 0.25 if orejas == "redondas" else 0.5)
            pos = (hc[0] + cab * 0.33 * s_, hc[1] + cab * 0.6 + alto_o / 2, hc[2] + cab * 0.05) if orejas != "largas" else (hc[0] + cab * 0.55 * s_, hc[1] + cab * 0.2, hc[2] + cab * 0.1)
            tam = (cab * 0.22, alto_o, cab * 0.12) if orejas != "largas" else (cab * 0.12, cab * 0.5, cab * 0.3)
            C.cubo(pos, tam, pel, B["head"], mat="pelo", pix=3)
    cu = p.get("cuernos")
    if cu:
        for s_ in (1, -1):
            if cu == "colmillos":
                C.cubo((hc[0] + cab * 0.25 * s_, hc[1] - cab * 0.05, hc[2] + cab * 0.95), (0.04, 0.1, 0.04), "#f2efe4", B["head"], mat="hueso", pix=2)
            else:
                C.cubo((hc[0] + cab * 0.55 * s_, hc[1] + cab * 0.55, hc[2] + cab * 0.2), (cab * 0.35, cab * 0.12, cab * 0.12), p.get("color_cuernos", "#e8e0c8"), B["head"], mat="hueso", pix=3)
                C.cubo((hc[0] + cab * 0.7 * s_, hc[1] + cab * 0.75, hc[2] + cab * 0.2), (cab * 0.12, cab * 0.3, cab * 0.12), p.get("color_cuernos", "#e8e0c8"), B["head"], mat="hueso", pix=2)
    # patas
    pw = 0.2 * h * p.get("patas_grosor", 1.0)
    patas = [("back", -1)] + ([] if bip else [("front", 1)])
    for nombre, _ in patas:
        for lado in ("L", "R"):
            up, lo, paw = hp(f"{nombre}_upper_{lado}"), hp(f"{nombre}_lower_{lado}"), hp(f"{nombre}_paw_{lado}")
            C.cubo(((up[0] + lo[0]) / 2, (up[1] + lo[1]) / 2, (up[2] + lo[2]) / 2), (pw, up[1] - lo[1] + 0.04 * h, pw), pel, B[f"{nombre}_upper_{lado}"], mat="pelo", pix=4)
            C.cubo(((lo[0] + paw[0]) / 2, (lo[1] + paw[1]) / 2 + 0.01, (lo[2] + paw[2]) / 2), (pw * 0.92, lo[1] - paw[1] + 0.04 * h, pw * 0.92), pel, B[f"{nombre}_lower_{lado}"], mat="pelo", pix=4)
            C.cubo((paw[0], paw[1] - 0.02 * h, paw[2] + 0.02 * h), (pw * 1.02, 0.1 * h, pw * 1.15), p.get("pezunas", G.oscurecer(pel, 0.6)), B[f"{nombre}_paw_{lado}"], mat="cuero", pix=3)
    if bip:
        for lado in ("L", "R"):
            a = hp(f"arm_{lado}")
            C.cubo((a[0], a[1] - 0.12 * h, a[2] + 0.05 * h), (pw * 0.6, 0.28 * h, pw * 0.6), pel, B[f"arm_{lado}"], mat="pelo", pix=3)
    # cola
    cola = p.get("cola", "delgada")
    if cola != "ninguna":
        for i in range(3):
            t = hp(f"tail{i + 1}")
            g_ = (0.14 if cola == "peluda" else 0.07) * h * (1 - 0.2 * i)
            C.cubo((t[0], t[1], t[2] - 0.08 * L), (g_, g_, 0.2 * L), p.get("punta_cola", pel) if i == 2 and p.get("punta_cola") else pel, B[f"tail{i + 1}"], mat="pelo", pix=3)
    if p.get("alas"):
        for lado, s_ in (("L", 1), ("R", -1)):
            a1, a2 = hp(f"wing1_{lado}"), hp(f"wing2_{lado}")
            C.cubo(((a1[0] + a2[0]) / 2, a1[1] + 0.02, a1[2] - 0.1 * L), (abs(a2[0] - a1[0]), 0.04, 0.5 * L), p.get("color_alas", G.oscurecer(pel, 0.8)), B[f"wing1_{lado}"], mat="tela_doble", pix=8)
    return C, esq


def _golem(p, detalle):
    esq = esqueleto_humanoide(1.0)
    C = G.Constructor(detalle)
    B = esq
    c1, c2 = p.get("camisa", "#8a847a"), p.get("metal", "#6a665e")
    luz = p.get("luz", "#ffb13a")
    sem = 3
    C.roca((0, 1.33, 0), (0.3, 0.22, 0.2), c1, B["chest"], semilla=sem, seg=14)
    C.roca((0, 1.08, 0), (0.2, 0.14, 0.15), c2, B["spine"], semilla=sem + 1, seg=12)
    C.roca((0, 0.95, 0), (0.22, 0.11, 0.16), c1, B["hips"], semilla=sem + 2, seg=12)
    C.esfera((0, 1.33, 0.18), 0.05, luz, "emisivo", B["chest"], emisivo=luz, seg=10)
    for lado, s in (("L", 1), ("R", -1)):
        C.roca((0.3 * s, 1.46, 0), (0.13, 0.12, 0.13), c2, B[f"upperarm_{lado}"], semilla=sem + 3 + (s > 0))
        C.roca((0.26 * s, 1.3, 0), (0.08, 0.14, 0.08), c1, B[f"upperarm_{lado}"], semilla=sem + 5 + (s > 0), seg=10)
        C.roca((0.25 * s, 1.07, 0.0), (0.08, 0.13, 0.08), c1, B[f"forearm_{lado}"], semilla=sem + 7 + (s > 0), seg=10)
        C.roca((0.26 * s, 0.86, 0.02), (0.1, 0.1, 0.1), c2, B[f"hand_{lado}"], semilla=sem + 9 + (s > 0), seg=10)
        C.roca((0.11 * s, 0.72, 0), (0.1, 0.17, 0.1), c1, B[f"thigh_{lado}"], semilla=sem + 11 + (s > 0), seg=10)
        C.roca((0.11 * s, 0.3, 0), (0.09, 0.18, 0.09), c1, B[f"shin_{lado}"], semilla=sem + 13 + (s > 0), seg=10)
        C.roca((0.11 * s, 0.05, 0.05), (0.1, 0.06, 0.13), c2, B[f"foot_{lado}"], semilla=sem + 15 + (s > 0), seg=10)
    C.roca((0, 1.66, 0.02), (0.12, 0.1, 0.11), c2, B["head"], semilla=sem + 20, seg=12)
    for s in (1, -1):
        C.esfera((0.045 * s, 1.68, 0.11), 0.018, luz, "emisivo", B["head"], emisivo=luz, seg=6)
    return C, esq


def cabeza(C, hb, p, hs, tipo):
    piel = p.get("piel", PIELES["clara"])
    mat_piel = p.get("mat_piel", "piel")
    cara = p.get("cara", "normal")
    c0 = (0, 1.595, 0.0)

    def P(x, y, z):  # posición relativa a la base de la cabeza, escalada por hs
        return (c0[0] + x * hs, c0[1] + y * hs, c0[2] + z * hs)
    R = lambda r: (r[0] * hs, r[1] * hs, r[2] * hs) if isinstance(r, tuple) else r * hs
    ojo_col = p.get("ojos", "#3a2a1a")
    if tipo == "esqueleto" or cara == "calavera":
        hueso_c = p.get("hueso", "#efe8d6")
        C.esfera(P(0, 0.115, -0.005), R((0.098, 0.105, 0.11)), hueso_c, "hueso", hb, variacion=0.05)
        C.esfera(P(0, 0.055, 0.035), R((0.07, 0.05, 0.07)), hueso_c, "hueso", hb)
        for s in (1, -1):
            C.esfera(P(0.037 * s, 0.11, 0.082), R((0.028, 0.03, 0.02)), "#141414", "tela", hb, seg=10)
            C.esfera(P(0.037 * s, 0.108, 0.09), R(0.008), p.get("brillo_ojos", "#ff4a2a"), "emisivo", hb, emisivo=p.get("brillo_ojos", "#ff3a1a"), seg=6)
        C.esfera(P(0, 0.075, 0.1), R((0.012, 0.018, 0.01)), "#141414", "tela", hb, seg=6)
        for i in range(6):
            C.caja(P(-0.03 + i * 0.012, 0.04, 0.098), R((0.005, 0.01, 0.005)), hueso_c, "hueso", hb, radio=0.002 * hs)
    elif tipo == "robot" or cara == "robot":
        met = p.get("metal", "#9aa3ad")
        C.caja(P(0, 0.11, 0), R((0.1, 0.1, 0.1)), met, "metal", hb, radio=0.04 * hs)
        C.caja(P(0, 0.12, 0.092), R((0.075, 0.025, 0.012)), "#101418", "brillo", hb, radio=0.01 * hs)
        luz = p.get("luz", "#3bffe8")
        for s in (1, -1):
            C.esfera(P(0.035 * s, 0.12, 0.102), R(0.014), luz, "emisivo", hb, emisivo=luz, seg=8)
        C.cilindro(P(0, 0.2, 0), P(0, 0.29, 0), 0.006 * hs, 0.006 * hs, "#444a52", "metal", hb, seg=6)
        C.esfera(P(0, 0.3, 0), R(0.018), luz, "emisivo", hb, emisivo=luz, seg=8)
        for s in (1, -1):
            C.cilindro(P(0.1 * s, 0.11, 0), P(0.12 * s, 0.11, 0), 0.03 * hs, 0.03 * hs, "#555b63", "metal", hb, seg=10)
    elif cara == "calabaza" or p.get("sombrero") == "calabaza":
        cal = p.get("calabaza", "#ff7a1a")
        C.torno(P(0, 0.02, 0), [(0.03, 0.0), (0.1, 0.02), (0.15, 0.08), (0.16, 0.14), (0.13, 0.21), (0.05, 0.245), (0.02, 0.25)], cal, "piel", hb,
                seg=24, radial=lambda u, y: 1 - 0.07 * abs(cos(u * 4)) ** 0.6, escala=(hs, hs, hs), variacion=0.06)
        C.cilindro(P(0, 0.26, 0), P(0.01, 0.31, 0.0), 0.02 * hs, 0.014 * hs, "#4a6a2a", "madera", hb, seg=7)
        brillo = p.get("fuego", "#ffb13a")
        for s in (1, -1):
            C.extruir(P(0.055 * s, 0.155, 0.148), [(-0.03 * hs, -0.02 * hs), (0.03 * hs, -0.02 * hs), (0.0, 0.03 * hs)], 0.012 * hs, brillo, "emisivo", hb,
                      emisivo=brillo, rot=(-0.12, 0.35 * s, 0))
        boca = [(-0.07, 0.0), (-0.045, -0.02), (-0.025, -0.005), (0, -0.028), (0.025, -0.005), (0.045, -0.02), (0.07, 0.0), (0.04, -0.045), (-0.04, -0.045)]
        C.extruir(P(0, 0.1, 0.152), [(x * hs, y * hs) for x, y in boca], 0.012 * hs, brillo, "emisivo", hb, emisivo=brillo, rot=(-0.2, 0, 0))
    else:
        # cráneo, mandíbula, pómulos, orejas (las facciones se apoyan sobre la superficie real de la piel: zp)
        ELIP = [((0, 0.118, 0.005), (0.096, 0.117, 0.104)), ((0, 0.062, 0.022), (0.078, 0.066, 0.08))]

        def zp(x, y):
            z = -1.0
            for (cx_, cy_, cz_), (rx_, ry_, rz_) in ELIP:
                q = 1 - ((x - cx_) / rx_) ** 2 - ((y - cy_) / ry_) ** 2
                if q > 0:
                    z = max(z, cz_ + rz_ * math.sqrt(q))
            return z
        C.esfera(P(*ELIP[0][0]), R(ELIP[0][1]), piel, mat_piel, hb, seg=22, variacion=0.03)
        C.esfera(P(*ELIP[1][0]), R(ELIP[1][1]), piel, mat_piel, hb, seg=18)
        if cara == "saco":  # espantapájaros: tela de saco con costuras
            C.esfera(P(0, 0.1, 0.008), R((0.108, 0.13, 0.112)), "#c8a672", "tela", hb, seg=18, variacion=0.12)
            for s in (1, -1):
                C.esfera(P(0.04 * s, 0.13, 0.1), R((0.022, 0.022, 0.012)), "#1a1a1a", "tela", hb, seg=8)
            for i in range(7):
                x = -0.05 + i * 0.0167
                C.caja(P(x, 0.055 + 0.012 * abs(i - 3) / 3, 0.103), R((0.006, 0.014, 0.004)), "#2a1a0a", "tela", hb, radio=0.001, rot=(0, 0, 0.5 * (1 if i % 2 else -1)))
        elif cara == "alien":
            C.esfera(P(0, 0.15, 0.0), R((0.12, 0.13, 0.12)), piel, mat_piel, hb, seg=18)
            for s in (1, -1):
                C.esfera(P(0.05 * s, 0.1, 0.085), R((0.035, 0.022, 0.015)), "#050505", "brillo", hb, rot=(0, 0, -0.45 * s), seg=10)
        else:
            anciano = bool(p.get("arrugas")) or p.get("pelo") in ("#ececec", "#e8e8e8", "#dcdcdc", "#f0f0f0")
            sombra_piel = G.oscurecer(piel, 0.82)
            # nariz: puente, punta y aletas
            zn0, zn1 = zp(0, 0.118), zp(0, 0.093)
            C.capsula(P(0, 0.12, zn0 - 0.004), P(0, 0.095, zn1 + 0.011), 0.0075 * hs, 0.0105 * hs, piel, mat_piel, hb, seg=10)
            C.esfera(P(0, 0.091, zn1 + 0.012), R((0.0125, 0.0115, 0.0115)), piel, mat_piel, hb, seg=12)
            for s in (1, -1):
                C.esfera(P(0.0115 * s, 0.0885, zp(0.0115, 0.0885) + 0.006), R((0.0085, 0.0075, 0.008)), piel, mat_piel, hb, seg=8)
                C.esfera(P(0.0085 * s, 0.084, zp(0.0085, 0.084) + 0.0105), R((0.003, 0.0022, 0.002)), G.oscurecer(piel, 0.35), "piel", hb, seg=5)
            for s in (1, -1):
                # orejas con hélice
                C.esfera(P(0.095 * s, 0.1, 0.0), R((0.013, 0.03, 0.021)), piel, mat_piel, hb, seg=10)
                C.toro(P(0.101 * s, 0.1, 0.0), 0.016 * hs, 0.0045 * hs, piel, mat_piel, hb, rot=(0, 0, PI / 2), seg=10, seg_tubo=4, arco=PI * 1.3)
                if p.get("orejas") == "puntiagudas":
                    C.cono(P(0.1 * s, 0.1, 0), P(0.16 * s, 0.17, -0.02), 0.022 * hs, piel, mat_piel, hb, seg=8)
                # ojos: blanco en forma de almendra, iris, pupila, brillo, línea de pestañas y párpado
                ex, ey = 0.034 * s, 0.123
                z0 = zp(0.034, ey)
                blanco = "#f2eee6" if cara != "zombie" else "#d8d8b0"
                C.esfera(P(ex, ey, z0 - 0.0065), R((0.0185, 0.0118, 0.011)), blanco, "brillo", hb, seg=12)
                C.esfera(P(ex, ey - 0.0005, z0 + 0.0012), R((0.0086, 0.0086, 0.0045)), ojo_col if cara != "zombie" else "#b8b890", "brillo", hb, seg=10)
                C.esfera(P(ex, ey - 0.0005, z0 + 0.0036), R((0.0042, 0.0042, 0.0025)), "#050505", "brillo", hb, seg=8)
                C.esfera(P(ex - 0.003, ey + 0.003, z0 + 0.0052), R(0.0017), "#ffffff", "emisivo", hb, emisivo="#ffffff", seg=4)
                pest = G.oscurecer(p.get("pelo", "#3a2a1a"), 0.55) if p.get("pelo_tipo") != "calvo" else "#2a1a14"
                arco_ = [(ex + 0.02 * s, ey - 0.001), (ex + 0.008 * s, ey + 0.0085), (ex - 0.006 * s, ey + 0.0088), (ex - 0.018 * s, ey + 0.001)]
                for (xa, ya), (xb, yb) in zip(arco_, arco_[1:]):
                    C.capsula(P(xa, ya, zp(abs(xa), ya) - 0.0005), P(xb, yb, zp(abs(xb), yb) - 0.0005), 0.0021 * hs, 0.0021 * hs, pest, "pelo", hb, seg=5)
                C.esfera(P(ex, ey + 0.0105, z0 - 0.009), R((0.021, 0.0075, 0.012)), sombra_piel if not anciano else G.oscurecer(piel, 0.75), mat_piel, hb, seg=10)
                if anciano:  # bolsas bajo los ojos
                    C.capsula(P(ex + 0.014 * s, ey - 0.014, z0 - 0.004), P(ex - 0.012 * s, ey - 0.014, z0 - 0.004), 0.0032 * hs, 0.0032 * hs, G.oscurecer(piel, 0.86), mat_piel, hb, seg=5)
                # cejas en arco
                ceja = p.get("pelo", "#3a2a1a") if p.get("pelo_tipo") != "calvo" else G.oscurecer(piel, 0.6)
                if p.get("color_cejas"):
                    ceja = p["color_cejas"]
                ang = -0.006 if p.get("enojado") else 0.004
                cej = [(0.056 * s, 0.141), (0.036 * s, 0.149 + ang * 0.5), (0.016 * s, 0.147 + ang)]
                for (xa, ya), (xb, yb) in zip(cej, cej[1:]):
                    C.capsula(P(xa, ya, zp(abs(xa), ya) - 0.001), P(xb, yb, zp(abs(xb), yb) - 0.001), 0.0048 * hs, 0.0042 * hs, ceja, "pelo", hb, seg=6)
            # boca: labio superior en arco, labio inferior más lleno y la comisura
            labios = G.mezclar_hex(piel, "#a8483f", 0.45) if cara != "zombie" else "#4a3030"
            if p.get("labios"):
                labios = p["labios"]
            ym = 0.066
            sup = [(-0.021, ym + 0.001), (-0.007, ym + 0.0035), (0.007, ym + 0.0035), (0.021, ym + 0.001)]
            for (xa, ya), (xb, yb) in zip(sup, sup[1:]):
                C.capsula(P(xa, ya, zp(abs(xa), ya) - 0.001), P(xb, yb, zp(abs(xb), yb) - 0.001), 0.0042 * hs, 0.0042 * hs, labios, "piel", hb, seg=6)
            C.capsula(P(-0.015, ym - 0.0048, zp(0.015, ym - 0.005) - 0.001), P(0.015, ym - 0.0048, zp(0.015, ym - 0.005) - 0.001), 0.0056 * hs, 0.0056 * hs,
                      labios, "piel", hb, seg=6)
            C.capsula(P(-0.019, ym - 0.001, zp(0.019, ym) + 0.0012), P(0.019, ym - 0.001, zp(0.019, ym) + 0.0012), 0.0016 * hs, 0.0016 * hs,
                      G.oscurecer(labios, 0.4), "piel", hb, seg=4)
            if p.get("colmillos"):
                for s in (1, -1):
                    C.cono(P(0.018 * s, 0.066, zp(0.018, 0.066) + 0.002), P(0.02 * s, 0.035, zp(0.02, 0.04) + 0.004), 0.006 * hs, "#f2efe4", "hueso", hb, seg=5)
        # pelo
        pelo_tipo = p.get("pelo_tipo", "corto")
        pelo = p.get("pelo", "#3a2a1a")
        if pelo_tipo != "calvo" and cara not in ("saco", "alien"):
            C.esfera(P(0, 0.132, -0.01), R((0.103, 0.118, 0.112)), pelo, "pelo", hb, corte=0.56, seg=22, rot=(-0.25, 0, 0), variacion=0.08)
            # línea del pelo natural: mechones sobre la frente y las sienes, patillas (no parece un casco)
            n_m = 11 if cara not in ("zombie",) else 7
            if p.get("sombrero") in ("casco", "casco_vikingo", "capucha", "casco_espacial", "ninja", "militar"):
                n_m = 0  # bajo el casco o la capucha no asoma el flequillo
            for i in range(n_m):
                a = -1.3 + 2.6 * i / (n_m - 1)
                x, z = 0.086 * math.sin(a), 0.004 + 0.092 * math.cos(a)
                y = 0.19 - 0.024 * abs(a) ** 1.5 + 0.003 * ((i * 7) % 3)
                C.esfera(P(x, y, z), R((0.022, 0.013 + 0.002 * (i % 2), 0.016)), G.oscurecer(pelo, 0.93 + 0.07 * (i % 2)), "pelo", hb,
                         rot=(0.55, a, 0.25 * (1 if a > 0 else -1)), seg=10, variacion=0.05)
            for s in (1, -1):
                if n_m:
                    C.caja(P(0.088 * s, 0.117, 0.028), R((0.009, 0.022, 0.014)), pelo, "pelo", hb, radio=0.006 * hs, variacion=0.05)
                    C.esfera(P(0.075 * s, 0.17, -0.02), R((0.035, 0.04, 0.06)), pelo, "pelo", hb, seg=10, variacion=0.06)
            if pelo_tipo in ("largo", "melena"):
                C.caja(P(0, 0.04, -0.07), R((0.095, 0.12, 0.045)), pelo, "pelo", hb, radio=0.04 * hs, variacion=0.08)
                for s in (1, -1):  # mechones que caen a los lados de la cara
                    C.capsula(P(0.088 * s, 0.15, 0.01), P(0.095 * s, 0.0, -0.005), 0.026 * hs, 0.018 * hs, pelo, "pelo", hb, seg=10, variacion=0.06)
                    C.capsula(P(0.07 * s, 0.14, -0.06), P(0.085 * s, -0.03, -0.06), 0.03 * hs, 0.02 * hs, G.oscurecer(pelo, 0.92), "pelo", hb, seg=10, variacion=0.06)
            elif pelo_tipo == "coleta":
                C.esfera(P(0, 0.15, -0.11), R(0.035), pelo, "pelo", hb, seg=10)
                C.capsula(P(0, 0.14, -0.13), P(0, 0.0, -0.15), 0.028 * hs, 0.012 * hs, pelo, "pelo", hb, seg=8)
            elif pelo_tipo == "punk":
                for i in range(5):
                    C.cono(P(0, 0.2, 0.06 - i * 0.04), P(0, 0.29 - abs(i - 2) * 0.015, 0.06 - i * 0.045), 0.02 * hs, pelo, "pelo", hb, seg=6)
            elif pelo_tipo == "mono":
                C.esfera(P(0, 0.23, -0.06), R(0.045), pelo, "pelo", hb, seg=10)
        if p.get("mascara"):  # pasamontañas / máscara táctica (deja ver los ojos)
            mc = p.get("color_mascara", "#1f2226")
            C.esfera(P(0, 0.05, 0.018), R((0.086, 0.075, 0.092)), mc, "tela", hb, seg=16, variacion=0.05)
        barba = p.get("barba")
        if barba:
            larga = barba == "larga"
            C.esfera(P(0, 0.045 - (0.04 if larga else 0), 0.05), R((0.078, 0.07 + (0.07 if larga else 0), 0.07)), p.get("color_barba", pelo), "pelo", hb,
                     seg=14, variacion=0.1)
    if p.get("cuernos_h"):
        for s_ in (1, -1):
            C.capsula(P(0.06 * s_, 0.2, 0.0), P(0.1 * s_, 0.27, 0.02), 0.022 * hs, 0.016 * hs, p.get("color_cuernos", "#2a1a1a"), "hueso", hb, seg=8)
            C.cono(P(0.1 * s_, 0.27, 0.02), P(0.1 * s_, 0.36, 0.06), 0.016 * hs, p.get("color_cuernos", "#2a1a1a"), "hueso", hb, seg=8)
    # sombreros y cascos
    sombrero(C, hb, p, P, R, hs)


def sombrero(C, hb, p, P, R, hs):
    t = p.get("sombrero")
    col = p.get("color_sombrero")
    if not t or t == "calabaza":
        return
    if t == "paja":
        c = col or "#d9b25a"
        C.cilindro(P(0, 0.2, -0.005), P(0, 0.215, -0.005), 0.21 * hs, 0.2 * hs, c, "tela", hb, seg=22)
        C.cilindro(P(0, 0.21, -0.005), P(0, 0.3, -0.005), 0.105 * hs, 0.095 * hs, c, "tela", hb, seg=18)
        C.toro(P(0, 0.225, -0.005), 0.106 * hs, 0.012 * hs, p.get("cinta", "#8a2a1a"), "tela", hb, seg=18, seg_tubo=4)
    elif t == "vaquero":
        c = col or "#7a4f2a"
        C.torno(P(0, 0.19, 0), [(0.0, 0.0), (0.2, 0.0), (0.22, 0.03)], c, "cuero", hb, seg=22, radial=lambda u, y: 1 + 0.12 * abs(cos(u)) ** 3 * (y > 0.01),
                escala=(hs, hs, hs), cerrar=False)
        C.esfera(P(0, 0.25, -0.005), R((0.1, 0.075, 0.11)), c, "cuero", hb, corte=0.65, seg=16)
        C.toro(P(0, 0.215, -0.005), 0.1 * hs, 0.01 * hs, "#2a1a0a", "cuero", hb, seg=16, seg_tubo=4)
    elif t == "bruja":
        c = col or "#2a1f3a"
        C.cilindro(P(0, 0.2, 0), P(0, 0.21, 0), 0.23 * hs, 0.22 * hs, c, "tela", hb, seg=22)
        C.cono(P(0, 0.205, 0), P(0.03, 0.52, -0.06), 0.105 * hs, c, "tela", hb, seg=16)
        C.toro(P(0, 0.225, 0), 0.1 * hs, 0.014 * hs, p.get("cinta", "#8a4ad0"), "tela", hb, seg=16, seg_tubo=4)
        C.caja(P(0, 0.225, 0.1), R((0.02, 0.018, 0.006)), "#d8c060", "oro", hb, radio=0.004 * hs)
    elif t in ("casco", "casco_vikingo"):
        c = col or "#9aa3ad"
        C.esfera(P(0, 0.13, 0.0), R((0.115, 0.13, 0.12)), c, "metal", hb, corte=0.62, seg=20)
        if t == "casco":
            C.caja(P(0, 0.07, 0.07), R((0.1, 0.06, 0.05)), c, "metal", hb, radio=0.03 * hs)
            C.caja(P(0, 0.12, 0.117), R((0.075, 0.008, 0.005)), "#141414", "tela", hb, radio=0.003 * hs)
            C.cono(P(0, 0.24, -0.02), P(0, 0.36, -0.08), 0.02 * hs, p.get("pluma", "#c0392b"), "tela", hb, seg=6)
        else:
            for s in (1, -1):
                C.capsula(P(0.1 * s, 0.17, 0), P(0.16 * s, 0.24, 0.01), 0.025 * hs, 0.02 * hs, "#efe8d6", "hueso", hb, seg=8)
                C.capsula(P(0.16 * s, 0.24, 0.01), P(0.17 * s, 0.33, 0.03), 0.02 * hs, 0.006 * hs, "#efe8d6", "hueso", hb, seg=8)
            C.caja(P(0, 0.1, 0.12), R((0.012, 0.045, 0.01)), c, "metal", hb, radio=0.004 * hs)
    elif t == "corona":
        c = col or "#e8c040"
        C.cilindro(P(0, 0.2, 0), P(0, 0.24, 0), 0.085 * hs, 0.09 * hs, c, "oro", hb, seg=18, tapas=False)
        for i in range(8):
            a = i * TAU / 8
            C.cono(P(0.088 * cos(a), 0.235, 0.088 * sin(a)), P(0.09 * cos(a), 0.29, 0.09 * sin(a)), 0.016 * hs, c, "oro", hb, seg=5)
        for i in range(4):
            a = i * TAU / 4 + PI / 2
            C.esfera(P(0.092 * cos(a), 0.222, 0.092 * sin(a)), R(0.012), ["#e0203a", "#20a0e0", "#30d060", "#a040e0"][i], "cristal", hb, seg=6)
    elif t == "capucha":
        c = col or "#2f5a3a"
        C.esfera(P(0, 0.12, -0.03), R((0.12, 0.14, 0.13)), c, "tela_doble", hb, corte=0.72, rot=(-0.75, 0, 0), seg=20, variacion=0.05)
    elif t == "gorra_militar":
        c = col or "#4a5a32"
        C.cilindro(P(0, 0.19, 0), P(0, 0.26, 0.0), 0.108 * hs, 0.118 * hs, c, "tela", hb, seg=18)
        C.cilindro(P(0, 0.26, 0.01), P(0, 0.275, 0.015), 0.125 * hs, 0.125 * hs, c, "tela", hb, seg=18)
        C.caja(P(0, 0.195, 0.115), R((0.08, 0.006, 0.045)), G.oscurecer(c, 0.5), "cuero", hb, radio=0.004 * hs, rot=(0.25, 0, 0))
        C.esfera(P(0, 0.235, 0.118), R(0.012), "#c9a64a", "oro", hb, seg=6)
    elif t == "boina":
        c = col or "#3a4a2a"
        C.esfera(P(0.015, 0.2, -0.01), R((0.12, 0.05, 0.12)), c, "tela", hb, seg=16, rot=(0, 0, 0.18))
    elif t == "gorra":
        c = col or "#c0392b"
        C.esfera(P(0, 0.15, -0.005), R((0.104, 0.1, 0.112)), c, "tela", hb, corte=0.5, seg=18)
        C.caja(P(0, 0.155, 0.13), R((0.085, 0.006, 0.055)), c, "tela", hb, radio=0.005 * hs, rot=(0.12, 0, 0))
    elif t == "explorador":
        c = col or "#c8b48a"
        C.esfera(P(0, 0.16, -0.005), R((0.115, 0.11, 0.125)), c, "tela", hb, corte=0.55, seg=18)
        C.cilindro(P(0, 0.16, -0.005), P(0, 0.17, -0.005), 0.19 * hs, 0.18 * hs, c, "tela", hb, seg=22)
        C.toro(P(0, 0.175, -0.005), 0.115 * hs, 0.01 * hs, "#6b4a2b", "tela", hb, seg=16, seg_tubo=4)
    elif t == "casco_espacial":
        C.esfera(P(0, 0.12, 0.0), R((0.16, 0.16, 0.16)), "#e8ecf0", "plastico", hb, seg=22, corte=0.9)
        C.esfera(P(0, 0.12, 0.05), R((0.12, 0.1, 0.12)), "#e6a82a", "oro", hb, seg=18, corte=None, rot=(0, 0, 0))
    elif t == "militar":
        c = col or "#5a6b3a"
        C.esfera(P(0, 0.14, -0.005), R((0.12, 0.115, 0.125)), c, "tela", hb, corte=0.58, seg=18, variacion=0.1)
    elif t == "copa":
        c = col or "#1a1a1f"
        C.cilindro(P(0, 0.2, 0), P(0, 0.21, 0), 0.16 * hs, 0.16 * hs, c, "tela", hb, seg=18)
        C.cilindro(P(0, 0.21, 0), P(0, 0.4, 0), 0.09 * hs, 0.095 * hs, c, "tela", hb, seg=18)
        C.toro(P(0, 0.23, 0), 0.093 * hs, 0.01 * hs, "#8a1a1a", "tela", hb, seg=16, seg_tubo=4)
    elif t == "pirata":
        c = col or "#1f1a18"
        C.esfera(P(0, 0.2, -0.005), R((0.11, 0.07, 0.12)), c, "tela", hb, corte=0.6, seg=16)
        for i in range(3):
            a = i * TAU / 3 + PI / 2
            C.capsula(P(0.13 * cos(a), 0.2, 0.13 * sin(a)), P(0.13 * cos(a + TAU / 3), 0.2, 0.13 * sin(a + TAU / 3)), 0.03 * hs, 0.03 * hs, c, "tela", hb, seg=8)
        C.esfera(P(0, 0.22, 0.115), R((0.02, 0.02, 0.005)), "#efe8d6", "hueso", hb, seg=6)
    elif t == "ninja":
        c = col or "#15161a"
        C.esfera(P(0, 0.118, 0.005), R((0.102, 0.122, 0.109)), c, "tela", hb, seg=18, corte=0.45)
        C.esfera(P(0, 0.07, 0.03), R((0.08, 0.06, 0.082)), c, "tela", hb, seg=14)
        C.toro(P(0, 0.17, 0), 0.105 * hs, 0.012 * hs, p.get("cinta", "#c0392b"), "tela", hb, seg=16, seg_tubo=4)


def cuadrupedo(p, detalle=1.0):
    """Lobos, zorros, osos, perros, gatos, llamas, ciervos, jabalíes, dinosaurios (bípedos) y dragones (con alas)."""
    esq = esqueleto_cuadrupedo(p)
    C = G.Constructor(detalle)
    B = esq
    L, h = p["largo"], p["alto"]
    bip = p.get("bipedo")
    pel = p.get("pelaje", "#7a6a5a")
    vientre = p.get("vientre", G.mezclar_hex(pel, "#f0e6d8", 0.45))
    oscuro = G.oscurecer
    mat = p.get("mat", "pelo")
    gordo = p.get("gordura", 1.0)
    var = 0.09 if mat == "pelo" else 0.05
    hp = lambda n: B.huesos[B[n]]["pos"]
    # tronco: cadera, medio y pecho (se solapan para que se vea continuo)
    rc = h * 0.34 * gordo
    C.esfera(hp("hips"), (rc * 0.95, rc * 0.95, L * 0.3), pel, mat, B["hips"], variacion=var)
    C.esfera(hp("spine"), (rc * 1.02, rc * (1.05 if not bip else 1.1), L * 0.32), pel, mat, B["spine"], variacion=var)
    C.esfera(v_desp(hp("spine"), (0, -rc * 0.35, 0)), (rc * 0.85, rc * 0.7, L * 0.28), vientre, mat, B["spine"], variacion=var)
    C.esfera(hp("chest"), (rc * 1.05, rc * 1.1, L * 0.3), pel, mat, B["chest"], variacion=var)
    # cuello y cabeza
    cab = hp("head")
    rh = h * 0.25 * p.get("cabeza", 1.0)
    C.capsula(hp("neck"), cab, rc * 0.62, rh * 0.62, pel, mat, B["neck"], variacion=var)
    C.esfera(cab, (rh * 0.85, rh * 0.8, rh * 0.9), pel, mat, B["head"], variacion=var)
    hocico = p.get("hocico", 1.0)
    punta = v_desp(cab, (0, -rh * 0.2, rh * (0.7 + 0.9 * hocico)))
    C.capsula(v_desp(cab, (0, -rh * 0.05, rh * 0.3)), punta, rh * 0.52, rh * 0.28 * (0.8 + 0.4 * (1 - hocico)), pel, mat, B["head"], variacion=var)
    C.esfera(v_desp(punta, (0, rh * 0.06, rh * 0.22)), (rh * 0.14, rh * 0.11, rh * 0.1), p.get("nariz", "#1a1414"), "brillo", B["head"], seg=10)
    # mandíbula (se mueve)
    C.capsula(v_desp(cab, (0, -rh * 0.4, rh * 0.25)), v_desp(punta, (0, -rh * 0.18, -rh * 0.05)), rh * 0.34, rh * 0.18, vientre, mat, B["jaw"], seg=10)
    if p.get("dientes"):
        for i in range(5):
            f = i / 4
            for s in (1, -1):
                C.cono(v_desp(v_lerp_(cab, punta, 0.35 + 0.55 * f), (s * rh * (0.32 - 0.12 * f), -rh * 0.32, rh * 0.25)),
                       v_desp(v_lerp_(cab, punta, 0.35 + 0.55 * f), (s * rh * (0.32 - 0.12 * f), -rh * 0.5, rh * 0.25)), rh * 0.05, "#f4efe2", "hueso", B["head"], seg=5)
    for s in (1, -1):  # ojos
        ojo = v_desp(cab, (s * rh * 0.5, rh * 0.25, rh * 0.55))
        C.esfera(ojo, rh * 0.16, p.get("ojos", "#e8b830"), "brillo", B["head"], seg=10, emisivo=p.get("ojos_brillan"))
        C.esfera(v_desp(ojo, (s * rh * 0.03, 0, rh * 0.12)), rh * 0.075, "#050505", "brillo", B["head"], seg=8)
    orejas = p.get("orejas", "puntiagudas")
    for s in (1, -1):
        base = v_desp(cab, (s * rh * 0.5, rh * 0.62, -rh * 0.1))
        if orejas == "puntiagudas":
            C.cono(base, v_desp(base, (s * rh * 0.2, rh * 0.75, -rh * 0.1)), rh * 0.24, pel, mat, B["head"], seg=8)
        elif orejas == "redondas":
            C.esfera(v_desp(base, (0, rh * 0.1, 0)), (rh * 0.24, rh * 0.24, rh * 0.1), pel, mat, B["head"], seg=10)
        elif orejas == "largas":
            C.capsula(base, v_desp(base, (s * rh * 0.25, rh * 1.0, -rh * 0.2)), rh * 0.14, rh * 0.1, pel, mat, B["head"], seg=8, achatar=0.45)
    cuernos = p.get("cuernos")
    if cuernos == "cuernos":
        for s in (1, -1):
            b0 = v_desp(cab, (s * rh * 0.42, rh * 0.7, 0))
            C.capsula(b0, v_desp(b0, (s * rh * 0.5, rh * 0.45, -rh * 0.3)), rh * 0.14, rh * 0.1, p.get("color_cuernos", "#e8e0c8"), "hueso", B["head"], seg=8)
            C.cono(v_desp(b0, (s * rh * 0.5, rh * 0.45, -rh * 0.3)), v_desp(b0, (s * rh * 0.65, rh * 0.95, -rh * 0.1)), rh * 0.1,
                   p.get("color_cuernos", "#e8e0c8"), "hueso", B["head"], seg=8)
    elif cuernos == "astas":
        for s in (1, -1):
            b0 = v_desp(cab, (s * rh * 0.35, rh * 0.75, -rh * 0.1))
            b1 = v_desp(b0, (s * rh * 0.5, rh * 1.3, -rh * 0.3))
            C.capsula(b0, b1, rh * 0.07, rh * 0.05, "#8a6a4a", "hueso", B["head"], seg=6)
            for j, f in enumerate((0.35, 0.65, 0.95)):
                q = v_lerp_(b0, b1, f)
                C.capsula(q, v_desp(q, (s * rh * 0.15, rh * 0.45, rh * 0.25 * (1 if j % 2 else -0.3))), rh * 0.045, rh * 0.03, "#8a6a4a", "hueso", B["head"], seg=6)
    elif cuernos == "colmillos":
        for s in (1, -1):
            b0 = v_desp(punta, (s * rh * 0.28, -rh * 0.2, -rh * 0.2))
            C.cono(b0, v_desp(b0, (s * rh * 0.15, rh * 0.45, rh * 0.15)), rh * 0.08, "#f4efe2", "hueso", B["jaw"], seg=6)
    if p.get("melena"):
        C.esfera(v_desp(cab, (0, 0, -rh * 0.2)), (rh * 1.25, rh * 1.2, rh * 0.9), p["melena"], "pelo", B["head"], seg=14, variacion=0.12)
    if p.get("pelo_cuello"):  # llama / alpaca: cuello lanudo
        C.capsula(hp("neck"), cab, rc * 0.78, rh * 0.72, pel, "pelo", B["neck"], variacion=0.12)
    # patas
    grosor = p.get("patas_grosor", 1.0)
    patas = [("back", "hips")] + ([] if bip else [("front", "chest")])
    for nombre, _ in patas:
        for lado in ("L", "R"):
            a, b, c = hp(f"{nombre}_upper_{lado}"), hp(f"{nombre}_lower_{lado}"), hp(f"{nombre}_paw_{lado}")
            gr = h * 0.105 * grosor * (1.5 if bip else 1.0)
            C.capsula(v_desp(a, (0, h * 0.05, 0)), b, gr * 1.5, gr * 0.9, pel, mat, B[f"{nombre}_upper_{lado}"], variacion=var)
            C.capsula(b, c, gr * 0.8, gr * 0.6, p.get("patas", pel), mat, B[f"{nombre}_lower_{lado}"], variacion=var)
            C.esfera(v_desp(c, (0, -h * 0.02, h * 0.05)), (gr * 0.85, gr * 0.6, gr * 1.1), p.get("pezunas", oscuro(p.get("patas", pel), 0.7)),
                     "hueso" if p.get("pezunas") else mat, B[f"{nombre}_paw_{lado}"], seg=10)
            if p.get("garras"):
                for g in (-1, 0, 1):
                    C.cono(v_desp(c, (g * gr * 0.4, -h * 0.02, gr * 0.9)), v_desp(c, (g * gr * 0.45, -h * 0.05, gr * 1.5)), gr * 0.16, "#f0ead8", "hueso",
                           B[f"{nombre}_paw_{lado}"], seg=5)
    if bip:
        for lado, s in (("L", 1), ("R", -1)):
            a = hp(f"arm_{lado}")
            C.capsula(a, v_desp(a, (s * h * 0.05, -h * 0.25, h * 0.12)), h * 0.05, h * 0.035, pel, mat, B[f"arm_{lado}"], seg=8)
    # cola
    cola = p.get("cola", "larga")
    if cola != "ninguna":
        pts = [hp("hips")] + [hp(f"tail{i + 1}") for i in range(3)]
        g0 = {"peluda": 0.16, "larga": 0.09, "gruesa": 0.2, "corta": 0.1, "delgada": 0.05}.get(cola, 0.09) * h
        for i in range(3):
            fin = pts[i + 2] if i < 2 else v_desp(pts[3], v_sub_(pts[3], pts[2]))
            if cola == "corta" and i > 0:
                break
            r0 = g0 * (1 - i * 0.28) * (1.3 if cola == "peluda" else 1)
            C.capsula(pts[i + 1], fin, r0, max(0.01, r0 * 0.72), pel if not (cola == "peluda" and i == 2) else p.get("punta_cola", pel), mat, B[f"tail{i + 1}"], seg=10, variacion=var)
    if p.get("pua_lomo"):  # crestas de dragón/dinosaurio
        for i in range(7):
            f = i / 6
            q = v_lerp_(hp("hips"), hp("chest"), f)
            C.cono(v_desp(q, (0, rc * 0.9, 0)), v_desp(q, (0, rc * 1.35, -rc * 0.25)), rc * 0.18, p["pua_lomo"], "hueso", B["spine"] if 0.2 < f < 0.8 else (B["hips"] if f <= 0.2 else B["chest"]), seg=5)
    if p.get("alas"):
        ac = p.get("color_alas", oscuro(pel, 0.8))
        for lado, s in (("L", 1), ("R", -1)):
            w1, w2 = hp(f"wing1_{lado}"), hp(f"wing2_{lado}")
            C.capsula(w1, w2, h * 0.06, h * 0.04, pel, mat, B[f"wing1_{lado}"], seg=8)
            punta_a = v_desp(w2, (s * L * 0.55, h * 0.05, -L * 0.05))
            C.capsula(w2, punta_a, h * 0.04, h * 0.02, pel, mat, B[f"wing2_{lado}"], seg=8)
            # membrana en dos partes (cada una unida a su hueso)
            m1 = [(0, 0), (s * (w2[0] - w1[0]), w2[1] - w1[1]), (s * (w2[0] - w1[0]) * 0.9, -L * 0.45), (0, -L * 0.3)]
            _membrana(C, w1, m1, s, ac, B[f"wing1_{lado}"])
            m2 = [(0, 0), (s * (punta_a[0] - w2[0]), punta_a[1] - w2[1]), (s * (punta_a[0] - w2[0]) * 0.5, -L * 0.5), (0, -L * 0.45)]
            _membrana(C, w2, m2, s, ac, B[f"wing2_{lado}"])
    return C, esq


def _membrana(C, origen, poli_xz, s, color, hueso):
    """Membrana de ala (plana en XZ, mirando arriba) desde el origen. poli_xz: (x a lo largo del ala, z hacia atrás)."""
    pts = [(x * s, z) for x, z in poli_xz]
    verts = [(origen[0] + x, origen[1], origen[2] + z) for x, z in pts]
    tris = [(0, i, i + 1) for i in range(1, len(verts) - 1)]
    norms = [(0, 1, 0)] * len(verts)
    C._agregar(verts, norms, tris, color, hueso, "tela_doble")


def v_desp(a, d):
    return (a[0] + d[0], a[1] + d[1], a[2] + d[2])


def v_sub_(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def v_lerp_(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


def volador(p, detalle=1.0):
    """Cuervos, cóndores, águilas, murciélagos, abejas y drones con hélices."""
    esq = esqueleto_volador(p)
    C = G.Constructor(detalle)
    B = esq
    env = p.get("envergadura", 1.0)
    col = p.get("color", "#2a2a30")
    tipo = p.get("tipo", "ave")
    hp = lambda n: B.huesos[B[n]]["pos"]
    b0 = hp("body")
    if tipo == "dron":
        met = p.get("metal", "#8a939c")
        C.caja(b0, (0.18 * env, 0.07 * env, 0.24 * env), col, "plastico", B["body"], radio=0.05 * env)
        C.esfera(v_desp(b0, (0, -0.02, 0.24 * env)), (0.07 * env, 0.05 * env, 0.03 * env), "#101418", "brillo", B["body"], seg=10)
        C.esfera(v_desp(b0, (0, -0.02, 0.26 * env)), 0.022 * env, p.get("luz", "#ff3b3b"), "emisivo", B["body"], emisivo=p.get("luz", "#ff3b3b"), seg=8)
        for i in range(4):
            rp = hp(f"rotor{i + 1}")
            C.capsula(b0, rp, 0.022 * env, 0.02 * env, met, "metal", B["body"], seg=8)
            C.cilindro(v_desp(rp, (0, -0.04 * env, 0)), rp, 0.04 * env, 0.035 * env, "#30343a", "metal", B["body"], seg=10)
            C.caja(v_desp(rp, (0, 0.012 * env, 0)), (0.22 * env, 0.005 * env, 0.025 * env), "#1a1c20", "plastico", B[f"rotor{i + 1}"], radio=0.004 * env)
            C.caja(v_desp(rp, (0, 0.012 * env, 0)), (0.025 * env, 0.005 * env, 0.22 * env), "#1a1c20", "plastico", B[f"rotor{i + 1}"], radio=0.004 * env)
        for s in (1, -1):
            C.capsula(v_desp(b0, (0.12 * s * env, -0.07 * env, 0.1 * env)), v_desp(b0, (0.14 * s * env, -0.14 * env, -0.1 * env)), 0.012 * env, 0.012 * env, met, "metal", B["body"], seg=6)
        return C, esq
    vientre = p.get("vientre", G.mezclar_hex(col, "#dddddd", 0.25))
    murcielago = tipo == "murcielago"
    abeja = tipo == "abeja"
    C.esfera(b0, (0.12 * env, 0.12 * env, 0.24 * env), col, "pelo" if murcielago or abeja else "tela", B["body"], variacion=0.08)
    C.esfera(v_desp(b0, (0, -0.04 * env, 0.02)), (0.1 * env, 0.08 * env, 0.18 * env), vientre, "tela", B["body"], variacion=0.05)
    if abeja:
        for i in range(3):
            C.toro(v_desp(b0, (0, 0, -0.05 * env - i * 0.07 * env)), 0.11 * env * (1 - i * 0.12), 0.025 * env, "#1a1a1a", "pelo", B["body"],
                   rot=(PI / 2, 0, 0), seg=14, seg_tubo=5)
    cab = hp("head")
    C.esfera(cab, 0.095 * env * p.get("cabeza", 1.0), p.get("color_cabeza", col), "pelo" if murcielago else "tela", B["head"], variacion=0.06)
    if p.get("cuello_blanco"):  # cóndor
        C.toro(v_desp(cab, (0, -0.06 * env, -0.07 * env)), 0.085 * env, 0.035 * env, "#f4f4f0", "pelo", B["head"], rot=(PI / 2 - 0.4, 0, 0), seg=14, seg_tubo=6)
    if murcielago:
        for s in (1, -1):
            C.cono(v_desp(cab, (0.05 * s * env, 0.06 * env, -0.01)), v_desp(cab, (0.08 * s * env, 0.19 * env, -0.02)), 0.035 * env, col, "pelo", B["head"], seg=6)
        C.cono(v_desp(cab, (0.02 * env, -0.03 * env, 0.08 * env)), v_desp(cab, (0.02 * env, -0.07 * env, 0.08 * env)), 0.008 * env, "#f4f0e4", "hueso", B["head"], seg=4)
        C.cono(v_desp(cab, (-0.02 * env, -0.03 * env, 0.08 * env)), v_desp(cab, (-0.02 * env, -0.07 * env, 0.08 * env)), 0.008 * env, "#f4f0e4", "hueso", B["head"], seg=4)
    elif not abeja:
        pico = p.get("pico", "#e8b83a")
        C.cono(v_desp(cab, (0, -0.01, 0.07 * env)), v_desp(cab, (0, -0.03 * env, 0.2 * env * p.get("pico_largo", 1.0))), 0.035 * env, pico, "hueso", B["head"], seg=8)
    for s in (1, -1):
        ojo = v_desp(cab, (0.055 * s * env, 0.025 * env, 0.06 * env))
        C.esfera(ojo, 0.022 * env, p.get("ojos", "#f0c030"), "brillo", B["head"], seg=8, emisivo=p.get("ojos_brillan"))
        C.esfera(v_desp(ojo, (0.005 * s, 0, 0.015 * env)), 0.011 * env, "#050505", "brillo", B["head"], seg=6)
    # alas
    for lado, s in (("L", 1), ("R", -1)):
        w1, w2 = hp(f"wing1_{lado}"), hp(f"wing2_{lado}")
        punta = v_desp(w2, (s * 0.5 * env, 0.02, -0.08 * env))
        if murcielago:
            C.capsula(w1, w2, 0.02 * env, 0.014 * env, col, "piel", B[f"wing1_{lado}"], seg=6)
            C.capsula(w2, punta, 0.014 * env, 0.008 * env, col, "piel", B[f"wing2_{lado}"], seg=6)
            _membrana(C, w1, [(0, 0), (s * (w2[0] - w1[0]), 0), (s * (w2[0] - w1[0]) * 0.8, -0.22 * env), (0, -0.25 * env)], s, p.get("membrana", "#3a2a2a"), B[f"wing1_{lado}"])
            _membrana(C, w2, [(0, 0), (s * (punta[0] - w2[0]), -0.08 * env), (s * (punta[0] - w2[0]) * 0.55, -0.3 * env), (s * 0.1 * env, -0.2 * env), (0, -0.25 * env)],
                      s, p.get("membrana", "#3a2a2a"), B[f"wing2_{lado}"])
        elif abeja:
            _membrana(C, w1, [(0, 0), (s * 0.45 * env, 0.02 * env), (s * 0.4 * env, -0.18 * env), (0, -0.12 * env)], s, "#cfe8ff", B[f"wing1_{lado}"])
        else:
            C.esfera(v_lerp_(w1, w2, 0.5), (abs(w2[0] - w1[0]) * 0.62, 0.035 * env, 0.17 * env), col, "tela", B[f"wing1_{lado}"], variacion=0.08)
            C.esfera(v_lerp_(w2, punta, 0.5), (abs(punta[0] - w2[0]) * 0.6, 0.025 * env, 0.14 * env), p.get("puntas", col), "tela", B[f"wing2_{lado}"], variacion=0.08)
            for i in range(4):  # plumas primarias
                f = i / 3
                q = v_lerp_(w2, punta, 0.6 + 0.4 * f)
                C.esfera(v_desp(q, (0, 0, -0.1 * env)), (0.03 * env, 0.012 * env, 0.12 * env), G.oscurecer(p.get("puntas", col), 0.8), "tela", B[f"wing2_{lado}"],
                         rot=(0, s * (0.3 - 0.25 * f), 0), seg=8)
        lg = hp(f"leg_{lado}")
        C.capsula(lg, v_desp(lg, (0, -0.1 * env, 0.02)), 0.015 * env, 0.012 * env, p.get("patas", "#d8a040"), "piel", B[f"leg_{lado}"], seg=6)
    cola = hp("tail")
    if not murcielago and not abeja:
        C.esfera(v_desp(cola, (0, 0, -0.08 * env)), (0.1 * env, 0.02 * env, 0.14 * env), p.get("puntas", col), "tela", B["tail"], variacion=0.08)
    elif abeja:
        C.cono(v_desp(cola, (0, 0, 0.05)), v_desp(cola, (0, -0.02, -0.12 * env)), 0.02 * env, "#1a1a1a", "hueso", B["tail"], seg=6)
    return C, esq


def aracnido(p, detalle=1.0):
    esq = esqueleto_aracnido(p)
    C = G.Constructor(detalle)
    B = esq
    r = p.get("radio", 0.5)
    col = p.get("color", "#2a2226")
    hp = lambda n: B.huesos[B[n]]["pos"]
    mat = p.get("mat", "pelo")
    tipo = p.get("tipo", "arana")
    C.esfera(hp("body"), (r * 0.55, r * 0.35, r * 0.6), col, mat, B["body"], variacion=0.08)
    if tipo == "cangrejo":
        C.esfera(hp("body"), (r * 0.95, r * 0.35, r * 0.7), col, "plastico", B["body"], variacion=0.06)
    else:
        C.esfera(hp("abdomen"), (r * 0.7, r * 0.55, r * 0.8) if tipo == "arana" else (r * 0.45, r * 0.3, r * 0.6), col if tipo != "arana" else G.oscurecer(col, 0.9),
                 mat, B["abdomen"], variacion=0.1)
        if p.get("marca"):
            C.esfera(v_desp(hp("abdomen"), (0, r * 0.48, -r * 0.1)), (r * 0.2, r * 0.1, r * 0.25), p["marca"], "brillo", B["abdomen"], seg=10)
    cab = hp("head")
    C.esfera(cab, (r * 0.35, r * 0.28, r * 0.3), col, mat, B["head"])
    ojo_c = p.get("ojos", "#ff2a2a")
    for i in range(4 if tipo == "arana" else 2):
        s = 1 if i % 2 else -1
        C.esfera(v_desp(cab, (s * r * (0.1 + 0.08 * (i // 2)), r * (0.15 - 0.05 * (i // 2)), r * 0.25)), r * 0.05, ojo_c, "brillo", B["head"], seg=6, emisivo=ojo_c if p.get("ojos_brillan") else None)
    if tipo == "cangrejo":
        for s in (1, -1):
            C.capsula(v_desp(cab, (s * r * 0.15, 0, 0)), v_desp(cab, (s * r * 0.2, r * 0.35, r * 0.05)), r * 0.03, r * 0.03, col, "plastico", B["head"], seg=6)
            C.esfera(v_desp(cab, (s * r * 0.2, r * 0.38, r * 0.05)), r * 0.06, "#101010", "brillo", B["head"], seg=6)
    pares = p.get("patas", 8) // 2
    for i in range(pares):
        for lado, s in (("L", 1), ("R", -1)):
            a, b = hp(f"leg{i}_a_{lado}"), hp(f"leg{i}_b_{lado}")
            pie = (b[0] + s * r * 0.35, 0.0, b[2] * 1.1)
            C.capsula(a, b, r * 0.07, r * 0.055, col, mat, B[f"leg{i}_a_{lado}"], seg=6)
            C.capsula(b, pie, r * 0.05, r * 0.02, col, mat, B[f"leg{i}_b_{lado}"], seg=6)
    if p.get("pinzas"):
        for lado, s in (("L", 1), ("R", -1)):
            a, b = hp(f"claw_a_{lado}"), hp(f"claw_b_{lado}")
            C.capsula(a, b, r * 0.09, r * 0.08, col, "plastico", B[f"claw_a_{lado}"], seg=8)
            C.esfera(v_desp(b, (0, 0, r * 0.12)), (r * 0.16, r * 0.1, r * 0.22), col, "plastico", B[f"claw_b_{lado}"], seg=10)
            C.cono(v_desp(b, (s * r * 0.08, 0, r * 0.2)), v_desp(b, (s * r * 0.02, 0, r * 0.45)), r * 0.06, col, "plastico", B[f"claw_b_{lado}"], seg=6)
            C.cono(v_desp(b, (-s * r * 0.05, 0, r * 0.2)), v_desp(b, (0, 0, r * 0.42)), r * 0.05, col, "plastico", B[f"claw_b_{lado}"], seg=6)
    if p.get("cola"):
        pts = [hp("abdomen")] + [hp(f"tail{i + 1}") for i in range(4)]
        for i in range(4):
            fin = pts[i + 2] if i < 3 else v_desp(pts[4], (0, r * 0.15, r * 0.25))
            C.capsula(pts[i + 1], fin, r * (0.13 - 0.02 * i), r * (0.11 - 0.02 * i), col, "plastico", B[f"tail{i + 1}"], seg=8)
        C.cono(v_desp(pts[4], (0, r * 0.15, r * 0.25)), v_desp(pts[4], (0, r * 0.05, r * 0.5)), r * 0.06, p.get("aguijon", "#d8c060"), "hueso", B["tail4"], seg=6)
    if tipo == "arana":
        for s in (1, -1):
            C.cono(v_desp(cab, (s * r * 0.08, -r * 0.1, r * 0.25)), v_desp(cab, (s * r * 0.06, -r * 0.3, r * 0.3)), r * 0.05, "#1a1010", "hueso", B["head"], seg=5)
    return C, esq


def gota(p, detalle=1.0):
    esq = esqueleto_gota(p)
    C = G.Constructor(detalle)
    B = esq
    h = p.get("alto", 1.0)
    col = p.get("color", "#5ad05a")
    tipo = p.get("tipo", "slime")
    if tipo == "fantasma":
        C.esfera((0, h * 0.72, 0), (h * 0.32, h * 0.32, h * 0.3), col, "plastico", B["body"], seg=18, emisivo=p.get("brillo"))
        C.torno((0, h * 0.2, 0), [(h * 0.28, 0.0), (h * 0.33, h * 0.25), (h * 0.32, h * 0.5)], col, "plastico", B["tail"], seg=18, cerrar=False,
                radial=lambda u, y: 1 + (0.12 * sin(u * 6) if y < 0.02 else 0), emisivo=p.get("brillo"))
        for s in (1, -1):
            C.esfera((s * h * 0.1, h * 0.78, h * 0.25), (h * 0.05, h * 0.075, h * 0.03), "#141418", "brillo", B["body"], seg=8)
        C.esfera((0, h * 0.62, h * 0.27), (h * 0.06, h * 0.05, h * 0.02), "#141418", "brillo", B["body"], seg=8)
        for s in (1, -1):
            C.capsula((s * h * 0.28, h * 0.66, 0.02), (s * h * 0.42, h * 0.5, h * 0.12), h * 0.06, h * 0.04, col, "plastico", B["body"], seg=8)
        return C, esq
    if tipo == "calabaza":
        C.torno((0, 0, 0), [(0.05 * h, 0.0), (0.3 * h, 0.05 * h), (0.45 * h, 0.25 * h), (0.47 * h, 0.42 * h), (0.38 * h, 0.64 * h), (0.12 * h, 0.72 * h), (0.05 * h, 0.73 * h)],
                col, "piel", B["body"], seg=26, radial=lambda u, y: 1 - 0.07 * abs(cos(u * 4)) ** 0.6, variacion=0.06)
        C.cilindro((0, 0.72 * h, 0), (0.02 * h, 0.86 * h, 0.01 * h), 0.05 * h, 0.035 * h, "#4a6a2a", "madera", B["top"], seg=7)
        fuego = p.get("fuego", "#ffb13a")
        for s in (1, -1):
            C.extruir((0.16 * h * s, 0.45 * h, 0.43 * h), [(-0.08 * h, -0.05 * h), (0.08 * h, -0.05 * h), (0, 0.08 * h)], 0.02 * h, fuego, "emisivo", B["body"],
                      emisivo=fuego, rot=(-0.1, 0.35 * s, 0))
        boca = [(-0.22, 0.0), (-0.14, -0.05), (-0.07, -0.01), (0, -0.07), (0.07, -0.01), (0.14, -0.05), (0.22, 0.0), (0.12, -0.13), (-0.12, -0.13)]
        C.extruir((0, 0.3 * h, 0.44 * h), [(x * h, y * h) for x, y in boca], 0.02 * h, fuego, "emisivo", B["body"], emisivo=fuego, rot=(-0.25, 0, 0))
        for s in (1, -1):  # hojas
            C.esfera((0.1 * h * s, 0.74 * h, 0.05 * h), (0.1 * h, 0.015 * h, 0.05 * h), "#3f7a2a", "hoja", B["top"], rot=(0, 0, 0.3 * s), seg=8)
        return C, esq
    # slime
    C.esfera((0, h * 0.4, 0), (h * 0.48, h * 0.42, h * 0.46), col, "brillo", B["body"], seg=22, deformar=lambda q: (q[0], max(q[1], -h * 0.36), q[2]))
    C.esfera((0, h * 0.4, 0), (h * 0.3, h * 0.25, h * 0.28), G.oscurecer(col, 0.7), "brillo", B["body"], seg=12)
    for s in (1, -1):
        C.esfera((s * h * 0.16, h * 0.52, h * 0.38), (h * 0.08, h * 0.1, h * 0.05), "#ffffff", "brillo", B["body"], seg=10)
        C.esfera((s * h * 0.16, h * 0.5, h * 0.42), h * 0.045, "#101010", "brillo", B["body"], seg=8)
    C.capsula((-h * 0.08, h * 0.33, h * 0.43), (h * 0.08, h * 0.33, h * 0.43), h * 0.025, h * 0.025, "#2a1010", "brillo", B["body"], seg=6)
    if p.get("corona"):
        for i in range(6):
            a = i * TAU / 6
            C.cono((0.15 * h * cos(a), h * 0.78, 0.15 * h * sin(a)), (0.15 * h * cos(a), h * 0.95, 0.15 * h * sin(a)), 0.05 * h, "#e8c040", "oro", B["top"], seg=5)
        C.cilindro((0, h * 0.76, 0), (0, h * 0.82, 0), 0.17 * h, 0.17 * h, "#e8c040", "oro", B["top"], seg=16)
    return C, esq


def serpiente(p, detalle=1.0):
    esq = esqueleto_serpiente(p)
    C = G.Constructor(detalle)
    B = esq
    r = p.get("grosor", 0.1)
    col = p.get("color", "#4a8a3a")
    ban = p.get("bandas")
    hp = lambda n: B.huesos[B[n]]["pos"]
    for i in range(N_SERP):
        a = hp(f"seg{i}")
        b = hp(f"seg{i + 1}") if i + 1 < N_SERP else v_desp(a, (0, 0, -(hp("seg0")[2] - hp("seg1")[2])))
        rr0 = r * (1.0 - 0.1 * max(0, i - 4))
        rr1 = r * (1.0 - 0.1 * max(0, i - 3)) if i < N_SERP - 1 else r * 0.15
        C.capsula(a, b, rr0, rr1, ban if (ban and i % 2) else col, "piel", B[f"seg{i}"], seg=12, achatar=1.0, variacion=0.06)
    cab = hp("head")
    C.esfera(cab, (r * 1.25, r * 0.8, r * 1.5), col, "piel", B["head"], seg=14)
    C.esfera(v_desp(hp("jaw"), (0, -r * 0.15, r * 0.5)), (r * 1.0, r * 0.4, r * 1.1), p.get("vientre", "#d8d0a0"), "piel", B["jaw"], seg=10)
    for s in (1, -1):
        C.esfera(v_desp(cab, (s * r * 0.7, r * 0.35, r * 0.7)), r * 0.25, p.get("ojos", "#f0d030"), "brillo", B["head"], seg=8)
        C.esfera(v_desp(cab, (s * r * 0.78, r * 0.35, r * 0.85)), r * 0.12, "#050505", "brillo", B["head"], seg=6)
    C.capsula(v_desp(cab, (0, -r * 0.2, r * 1.4)), v_desp(cab, (0, -r * 0.25, r * 2.2)), r * 0.06, r * 0.04, "#d8304a", "piel", B["jaw"], seg=5)
    return C, esq


# ════════════════════════════════ OBJETOS SIN ESQUELETO ════════════════════════════════
# Armas: el MANGO está en el origen y el arma apunta a +Z (hojas y cañones). Así el motor la pone en la mano del personaje.
METAL = "#cfd5dc"
MADERA = "#7a5433"
CUERO = "#4a2f1c"
ORO = "#e2b64a"


def _hoja(C, largo, ancho, color=METAL, z0=0.0, punta=0.12, curva=0.0, grosor=0.012, mat="metal", eje=None):
    n = 8
    lado_a, lado_b = [], []
    for i in range(n + 1):
        f = i / n
        y = z0 + largo * f
        w = ancho * (1 - 0.15 * f)
        cx = curva * (f ** 2) * largo
        lado_a.append((cx + w / 2, y))
        lado_b.append((cx - w / 2, y))
    tip = (curva * largo, z0 + largo + punta)
    poli = [lado_b[0]] + [lado_a[i] for i in range(n + 1)] + [tip] + [lado_b[i] for i in range(n, 0, -1)]
    C.extruir((0, 0, 0), poli, grosor, color, mat, 0, rot=eje or G.EJE_ARMA, bisel=0.35)


def arma(tipo, p=None, detalle=1.0):
    p = p or {}
    C = G.Constructor(detalle, ao=False)
    met = p.get("color", METAL)
    if tipo in ("espada", "katana", "daga", "cuchillo"):
        L = {"espada": 0.72, "katana": 0.8, "daga": 0.28, "cuchillo": 0.2}[tipo]
        W = {"espada": 0.065, "katana": 0.04, "daga": 0.05, "cuchillo": 0.035}[tipo]
        C.cilindro((0, 0, -0.12), (0, 0, 0.03), 0.019, 0.017, p.get("mango", CUERO), "cuero", seg=10)
        for i in range(4):
            C.toro((0, 0, -0.1 + i * 0.035), 0.019, 0.004, G.oscurecer(p.get("mango", CUERO), 0.7), "cuero", rot=(PI / 2, 0, 0), seg=10, seg_tubo=4)
        C.esfera((0, 0, -0.135), 0.03, p.get("guarda", ORO), "oro", seg=10)
        if tipo == "katana":
            C.cilindro((0, 0, 0.03), (0, 0, 0.045), 0.045, 0.045, p.get("guarda", "#2a2a2a"), "metal", seg=14)
        else:
            C.caja((0, 0, 0.045), (0.02, 0.11 if tipo == "espada" else 0.05, 0.018), p.get("guarda", ORO), "oro", radio=0.012)
        _hoja(C, L, W, met, 0.05, punta=W * 1.3, curva=0.06 if tipo == "katana" else 0.0, grosor=0.012 if tipo != "cuchillo" else 0.008)
        C.caja((0, 0, 0.05 + L * 0.42), (0.0065, W * 0.12, L * 0.36), G.oscurecer(met, 0.6), "metal", radio=0.002)
        if p.get("brillo"):
            _hoja(C, L * 0.9, W * 0.35, p["brillo"], 0.08, punta=W * 0.5, grosor=0.0135, mat="emisivo")
    elif tipo in ("hacha", "hoz", "guadana"):
        largo = {"hacha": 0.75, "hoz": 0.3, "guadana": 1.5}[tipo]
        C.capsula((0, 0, -0.05), (0, 0, largo), 0.02, 0.018, p.get("mango", MADERA), "madera", seg=10, variacion=0.1)
        if tipo == "hacha":
            filo = [(0, -0.07), (0.1, -0.12), (0.18, -0.1), (0.2, 0.0), (0.18, 0.1), (0.1, 0.12), (0, 0.07)]
            C.extruir((0, 0.02, largo - 0.1), filo, 0.02, met, "metal", rot=[[0, 0, 1, 0], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 1]], bisel=0.3)
            C.caja((0, 0, largo - 0.1), (0.028, 0.035, 0.07), G.oscurecer(met, 0.7), "metal", radio=0.01)
            C.cono((0, -0.03, largo - 0.1), (0, -0.1, largo - 0.1), 0.025, G.oscurecer(met, 0.8), "metal", seg=6)
        else:
            # hoja en cuña (lomo grueso, filo fino) unida al mango con una virola: la hoz es una «C», la guadaña sale de lado
            ROT = [[0, 0, -1, 0], [0, 1, 0, 0], [1, 0, 0, 0], [0, 0, 0, 1]]  # x local → a lo largo del mango (+Z), y local → de lado
            n = max(10, int(22 * detalle))
            espina, filo, gros = [], [], []
            if tipo == "hoz":
                R, t_fin, w0 = 0.14, 0.15 * PI, 0.05
                for i in range(n):
                    t = i / (n - 1)
                    th = PI - (PI - t_fin) * t
                    w = w0 * (1 - t) ** 0.8 + 0.004
                    espina.append((R + (R + w * 0.5) * cos(th), (R + w * 0.5) * sin(th)))
                    filo.append((R + (R - w * 0.5) * cos(th), (R - w * 0.5) * sin(th)))
                    gros.append(0.0075 - 0.0045 * t)
                C.lamina((0, 0, largo - 0.018), espina, filo, gros, met, "metal", rot=ROT)
            else:
                L = 0.82
                for i in range(n):
                    t = i / (n - 1)
                    xs_ = 0.045 + 0.09 * sin(PI * t * 0.9) - 0.3 * t * t
                    w = 0.12 * (1 - t) ** 0.7 + 0.004
                    espina.append((xs_, L * t))
                    filo.append((xs_ - w, L * t + 0.02 * (1 - t)))
                    gros.append(0.011 - 0.007 * t)
                C.lamina((0, 0, largo - 0.03), espina, filo, gros, met, "metal", rot=ROT)
                C.caja((0, 0.0, largo - 0.03), (0.022, 0.03, 0.05), G.oscurecer(met, 0.6), "metal", radio=0.008)
            C.cilindro((0, 0, largo - 0.05), (0, 0, largo + 0.006), 0.025, 0.023, G.oscurecer(met, 0.65), "metal", seg=12)
            C.toro((0, 0, largo - 0.05), 0.025, 0.004, G.oscurecer(met, 0.5), "metal", rot=(PI / 2, 0, 0), seg=12, seg_tubo=4)
    elif tipo == "lanza":
        C.capsula((0, 0, -0.5), (0, 0, 1.1), 0.02, 0.018, p.get("mango", MADERA), "madera", seg=10, variacion=0.1)
        _hoja(C, 0.16, 0.07, met, 1.1, punta=0.1)
        C.cilindro((0, 0, 1.08), (0, 0, 1.13), 0.026, 0.02, G.oscurecer(met, 0.7), "metal", seg=10)
        C.plano((0, 0.0, 1.07), 0.04, 0.2, p.get("cinta", "#c0392b"), "tela_doble", rot=(0.3, 0, 0))
    elif tipo in ("martillo", "maza"):
        C.capsula((0, 0, -0.12), (0, 0, 0.62), 0.022, 0.02, p.get("mango", MADERA), "madera", seg=10)
        if tipo == "martillo":
            C.caja((0, 0, 0.62), (0.07, 0.15, 0.07), met, "metal", radio=0.02)
            C.cilindro((0, 0.15, 0.62), (0, 0.17, 0.62), 0.06, 0.06, G.oscurecer(met, 0.8), "metal", seg=12)
        else:
            C.esfera((0, 0, 0.64), 0.08, met, "metal", seg=14)
            for i in range(10):
                a, b = i * TAU / 10, (0.6 if i % 2 else -0.6)
                d = (cos(a) * cos(b), sin(b), sin(a) * cos(b))
                C.cono((d[0] * 0.07, d[1] * 0.07, 0.64 + d[2] * 0.07), (d[0] * 0.13, d[1] * 0.13, 0.64 + d[2] * 0.13), 0.022, G.oscurecer(met, 0.85), "metal", seg=5)
    elif tipo in ("arco", "ballesta"):
        madera = p.get("mango", MADERA)
        if tipo == "arco":
            C.capsula((0, -0.06, 0), (0, 0.06, 0), 0.024, 0.024, CUERO, "cuero", seg=8)
            R = 0.62
            pts = [(0, R * sin(t), R * cos(t) - R) for t in [(-1.0 + 2.0 * i / 14) for i in range(15)]]
            for i in range(14):
                r0 = 0.018 - 0.01 * abs(i - 7) / 7
                C.capsula(pts[i], pts[i + 1], r0, r0 * 0.95, madera, "madera", seg=7)
            C.cilindro(pts[0], pts[-1], 0.003, 0.003, "#f0ead8", "tela", seg=4, tapas=False)
            C.cilindro((0, 0, pts[0][2]), (0, 0, 0.25), 0.005, 0.005, MADERA, "madera", seg=5)
            C.cono((0, 0, 0.25), (0, 0, 0.31), 0.012, METAL, "metal", seg=5)
            for s_ in (1, -1):
                C.plano((0, 0, pts[0][2] + 0.03), 0.03, 0.05, "#c0392b", "tela_doble", rot=(PI / 2, 0, s_ * 0.6))
        else:
            C.caja((0, -0.02, 0.1), (0.02, 0.025, 0.3), madera, "madera", radio=0.01)
            C.caja((0, -0.08, -0.05), (0.018, 0.06, 0.02), madera, "madera", radio=0.008)
            R = 0.3
            pts = [(R * sin(t), 0, 0.35 + R * cos(t) - R) for t in [(-1.0 + 2.0 * i / 10) for i in range(11)]]
            for i in range(10):
                C.capsula(pts[i], pts[i + 1], 0.012, 0.012, METAL, "metal", seg=6)
            C.cilindro(pts[0], pts[-1], 0.003, 0.003, "#f0ead8", "tela", seg=4, tapas=False)
    elif tipo == "tirachinas":
        C.capsula((0, -0.12, 0), (0, 0.02, 0), 0.018, 0.02, p.get("mango", MADERA), "madera", seg=8)
        for s in (1, -1):
            C.capsula((0, 0.02, 0), (0.06 * s, 0.13, 0), 0.015, 0.013, p.get("mango", MADERA), "madera", seg=8)
        C.cilindro((0.06, 0.12, 0), (-0.06, 0.12, 0), 0.006, 0.006, "#c0392b", "goma", seg=5, tapas=False)
        C.caja((0, 0.12, -0.03), (0.02, 0.012, 0.015), CUERO, "cuero", radio=0.005)
    elif tipo in ("pistola", "rifle", "escopeta", "blaster"):
        col = p.get("color", "#2f3338")
        largo = {"pistola": 0.2, "rifle": 0.62, "escopeta": 0.55, "blaster": 0.26}[tipo]
        C.caja((0, 0.03, largo * 0.35), (0.022, 0.03, largo * 0.55), col, "metal", radio=0.008)
        C.cilindro((0, 0.035, largo * 0.8), (0, 0.035, largo * 1.05), 0.012 if tipo != "escopeta" else 0.018, 0.012 if tipo != "escopeta" else 0.018,
                   G.oscurecer(col, 0.7), "metal", seg=10)
        C.caja((0, -0.05, -0.01), (0.018, 0.06, 0.025), p.get("mango", "#3a2a22" if tipo != "blaster" else "#20242a"), "cuero" if tipo != "blaster" else "plastico",
               radio=0.008, rot=(-0.25, 0, 0))
        C.toro((0, -0.02, 0.04), 0.022, 0.004, col, "metal", rot=(0, PI / 2, 0), seg=10, seg_tubo=4, arco=PI)
        if tipo in ("rifle", "escopeta"):
            C.caja((0, -0.01, -0.2), (0.022, 0.045, 0.14), p.get("mango", MADERA), "madera", radio=0.015, rot=(0.12, 0, 0))
            C.caja((0, 0.0, largo * 0.55), (0.02, 0.022, largo * 0.2), p.get("mango", MADERA), "madera", radio=0.008)
            if tipo == "rifle":
                C.cilindro((0, 0.085, 0.05), (0, 0.085, 0.25), 0.018, 0.018, "#15171a", "metal", seg=10)
                C.esfera((0, 0.085, 0.25), (0.016, 0.016, 0.004), "#3a8fd0", "cristal", seg=8)
        if tipo == "blaster":
            C.esfera((0, 0.03, largo * 0.35), (0.03, 0.04, largo * 0.35), "#e8ecf0", "plastico", seg=14)
            luz = p.get("luz", "#3bffe8")
            C.toro((0, 0.035, largo * 0.95), 0.02, 0.005, luz, "emisivo", emisivo=luz, rot=(PI / 2, 0, 0), seg=12, seg_tubo=4)
            C.caja((0.028, 0.04, largo * 0.35), (0.003, 0.008, largo * 0.3), luz, "emisivo", emisivo=luz, radio=0.002)
    elif tipo in ("varita", "baculo"):
        largo = 0.35 if tipo == "varita" else 1.6
        z0 = 0 if tipo == "varita" else -0.6
        C.cilindro((0, 0, z0), (0, 0, largo + z0), 0.012 if tipo == "varita" else 0.025, 0.007 if tipo == "varita" else 0.02, p.get("mango", "#5a3a22"), "madera", seg=8)
        joya = p.get("joya", "#8a5aff")
        if tipo == "baculo":  # bastón de mago: nudos, anillos de oro, garras de madera que abrazan un cristal que brilla
            mango = p.get("mango", "#5a3a22")
            top = largo + z0
            for zz in (z0 + 0.35, z0 + 0.8, top - 0.25):
                C.esfera((0, 0, zz), (0.03, 0.03, 0.04), G.oscurecer(mango, 0.85), "madera", seg=10)
            for zz in (top - 0.06, top - 0.02):
                C.toro((0, 0, zz), 0.026, 0.006, ORO, "oro", rot=(PI / 2, 0, 0), seg=12, seg_tubo=4)
            for i in range(4):
                a = i * TAU / 4 + 0.4
                C.capsula((0.015 * cos(a), 0.015 * sin(a), top - 0.03), (0.075 * cos(a), 0.075 * sin(a), top + 0.1), 0.013, 0.009, mango, "madera", seg=6)
                C.capsula((0.075 * cos(a), 0.075 * sin(a), top + 0.1), (0.03 * cos(a), 0.03 * sin(a), top + 0.2), 0.009, 0.005, mango, "madera", seg=6)
            C.esfera((0, 0, top + 0.12), (0.055, 0.055, 0.075), joya, "cristal", seg=16, emisivo=G.oscurecer(joya, 0.55))
            C.esfera((0, 0, top + 0.12), 0.03, G.mezclar_hex(joya, "#ffffff", 0.6), "emisivo", seg=10, emisivo=G.oscurecer(joya, 0.7))
        else:
            C.extruir((0, 0, largo + 0.03), [(0.035 * cos(PI / 2 + i * PI / 5) * (1 if i % 2 == 0 else 0.45), 0.035 * sin(PI / 2 + i * PI / 5) * (1 if i % 2 == 0 else 0.45)) for i in range(10)],
                      0.012, joya, "emisivo", emisivo=joya, rot=G.EJE_ARMA)
    elif tipo == "escudo":
        C.cilindro((0, 0, -0.01), (0, 0, 0.03), 0.3, 0.29, p.get("color", "#8a2a1a"), "madera", seg=24)
        C.toro((0, 0, 0.03), 0.29, 0.015, METAL, "metal", rot=(PI / 2, 0, 0), seg=24, seg_tubo=5)
        C.esfera((0, 0, 0.03), (0.07, 0.07, 0.04), ORO, "oro", seg=12)
    elif tipo in ("pico", "espada_pixel", "hacha_pixel", "pala"):
        # armas y herramientas de bloques (pixel art en 3D): el largo en +Z, como las demás
        mango = p.get("mango", "#8a5a30")
        cab = p.get("color", {"pico": "#7fd8e8", "espada_pixel": "#8ae8f0", "hacha_pixel": "#cfd5dc", "pala": "#cfd5dc"}[tipo])
        u = 0.045
        if tipo == "espada_pixel":
            for k in range(3):
                C.cubo((0, 0, -0.06 + k * u), (u, u, u), mango, 0, pix=1, ruido=0.1)
            C.cubo((0, 0, 0.08), (u, u * 5, u), p.get("guarda", "#6a4a2a"), 0, pix=1)
            for k in range(11):
                w = u * (1.6 if k < 9 else 1.2 if k == 9 else 0.8)
                C.cubo((0, 0, 0.125 + k * u), (u * 0.8, w, u), cab if k % 3 else G.mezclar_hex(cab, "#ffffff", 0.25), 0, mat="metal", pix=1, ruido=0.12)
        else:
            for k in range(14):
                C.cubo((0, 0, -0.1 + k * u), (u, u, u), mango, 0, pix=1, ruido=0.12, semilla=k)
            top = -0.1 + 13 * u
            if tipo == "pico":
                for k in range(-4, 5):
                    C.cubo((0, k * u, top - abs(k) * u * 0.35), (u, u, u), cab, 0, mat="brillo", pix=1, ruido=0.1, semilla=k)
            elif tipo == "hacha_pixel":
                for dy in range(0, 3):
                    for dz in range(-1, 2):
                        C.cubo((0, u * (1 + dy), top - dz * u), (u, u, u), cab, 0, mat="metal", pix=1, ruido=0.1)
            else:
                for dy in range(-1, 2):
                    for dz in range(0, 3):
                        C.cubo((0, u * dy, top + u * (1 + dz)), (u * 0.6, u, u), cab, 0, mat="metal", pix=1, ruido=0.1)
    elif tipo == "antorcha":
        C.cilindro((0, 0, -0.12), (0, 0, 0.34), 0.016, 0.022, MADERA, "madera", seg=10)
        for i in range(3):  # tela enrollada y amarrada
            C.toro((0, 0, 0.27 + 0.028 * i), 0.025, 0.009, G.oscurecer("#8a6a4a", 0.8 + 0.1 * i), "tela", rot=(PI / 2, 0, 0), seg=10, seg_tubo=5)
        C.cilindro((0, 0, 0.33), (0, 0, 0.375), 0.031, 0.027, "#2a1d14", "tela", seg=12)

        def fuego(q):  # de blanco-amarillo en la base a naranja y rojo en la punta
            t = max(0.0, min(1.0, (q[2] - 0.37) / 0.2))
            return G.mezclar_hex(G.mezclar_hex("#ffc85a", "#ff8a18", min(1.0, t * 1.6)), "#d8360a", max(0.0, t * 1.6 - 0.5))
        llama = [(0.0, 0.0), (0.03, 0.015), (0.04, 0.045), (0.035, 0.085), (0.022, 0.13), (0.009, 0.17), (0.0, 0.2)]
        C.torno((0, 0, 0.365), llama, fuego, "emisivo", rot=(PI / 2, 0, 0), seg=14, emisivo="#7a2a00",
                radial=lambda u, y: 1 + 0.18 * sin(u * 3 + y * 45) * min(1.0, y * 8))
        for k, (dx, dy, e) in enumerate(((0.024, 0.0, 0.6), (-0.018, 0.02, 0.5), (-0.01, -0.024, 0.45))):
            C.torno((dx, dy, 0.37), [(x * e, y * e) for x, y in llama], fuego, "emisivo", rot=(PI / 2 + 0.25 * (1 if dy >= 0 else -1), 0, -0.3 * k),
                    seg=10, emisivo="#6a2000")
    else:
        return arma("espada", p, detalle)
    return C, None


def objeto(tipo, p=None, detalle=1.0):
    """Coleccionables y power-ups (la base queda en y=0)."""
    p = p or {}
    C = G.Constructor(detalle)
    col = p.get("color")
    if tipo in ("calabaza", "calabaza_tallada"):
        c = col or "#ff7a1a"
        C.torno((0, 0, 0), [(0.04, 0.0), (0.25, 0.03), (0.38, 0.15), (0.4, 0.3), (0.33, 0.47), (0.12, 0.54), (0.04, 0.55)], c, "piel",
                seg=28, radial=lambda u, y: 1 - 0.08 * abs(cos(u * 4)) ** 0.6, variacion=0.07)
        C.capsula((0, 0.52, 0), (0.03, 0.66, 0.02), 0.035, 0.022, "#5a6a2a", "madera", seg=7)
        C.esfera((0.1, 0.56, 0.02), (0.1, 0.01, 0.05), "#3f7a2a", "hoja", rot=(0, 0.4, 0.25), seg=8)
        C.toro((0.06, 0.62, -0.02), 0.04, 0.005, "#4f7a2a", "hoja", rot=(0.4, 0.3, 0), seg=10, seg_tubo=4, arco=4.5)
        if tipo == "calabaza_tallada":
            fuego = p.get("fuego", "#ffb13a")
            for s in (1, -1):
                C.extruir((0.12 * s, 0.34, 0.37), [(-0.06, -0.04), (0.06, -0.04), (0, 0.06)], 0.02, fuego, "emisivo", emisivo=fuego, rot=(-0.15, 0.3 * s, 0))
            boca = [(-0.18, 0.0), (-0.11, -0.04), (-0.05, -0.01), (0, -0.05), (0.05, -0.01), (0.11, -0.04), (0.18, 0.0), (0.1, -0.1), (-0.1, -0.1)]
            C.extruir((0, 0.22, 0.38), boca, 0.02, fuego, "emisivo", emisivo=fuego, rot=(-0.3, 0, 0))
    elif tipo == "moneda":
        c = col or ORO
        C.cilindro((0, 0.3, -0.03), (0, 0.3, 0.03), 0.28, 0.28, c, "oro", seg=26)
        C.toro((0, 0.3, 0.0), 0.27, 0.025, G.oscurecer(c, 0.85), "oro", rot=(PI / 2, 0, 0), seg=26, seg_tubo=5)
        estrella = [(0.14 * cos(PI / 2 + i * PI / 5) * (1 if i % 2 == 0 else 0.42), 0.14 * sin(PI / 2 + i * PI / 5) * (1 if i % 2 == 0 else 0.42)) for i in range(10)]
        C.extruir((0, 0.3, 0.03), estrella, 0.02, G.oscurecer(c, 0.9), "oro", bisel=0.3)
        C.extruir((0, 0.3, -0.03), estrella, 0.02, G.oscurecer(c, 0.9), "oro", bisel=0.3)
    elif tipo in ("gema", "diamante", "cristal"):
        c = col or {"gema": "#39e6ff", "diamante": "#e8fbff", "cristal": "#7dffb0"}[tipo]
        if tipo == "cristal":
            C.torno((0, 0, 0), [(0.0, 0.0), (0.12, 0.08), (0.14, 0.55), (0.0, 0.8)], c, "cristal", seg=6, emisivo=G.oscurecer(c, 0.35))
            for s in (1, -1):
                C.torno((0.12 * s, 0, 0.03), [(0.0, 0.0), (0.06, 0.05), (0.07, 0.3), (0.0, 0.42)], c, "cristal", seg=6, rot=(0, 0, -0.35 * s), emisivo=G.oscurecer(c, 0.35))
        else:
            C.torno((0, 0, 0), [(0.0, 0.0), (0.3, 0.32), (0.34, 0.4), (0.22, 0.5), (0.0, 0.5)], c, "cristal", seg=8, emisivo=G.oscurecer(c, 0.3))
    elif tipo == "estrella":
        c = col or "#ffd23f"
        C.extruir((0, 0.36, 0), [(0.36 * cos(PI / 2 + i * PI / 5) * (1 if i % 2 == 0 else 0.45), 0.36 * sin(PI / 2 + i * PI / 5) * (1 if i % 2 == 0 else 0.45)) for i in range(10)],
                  0.14, c, "oro", bisel=0.4, emisivo=G.oscurecer(c, 0.35))
    elif tipo == "corazon":
        c = col or "#ff3a5a"
        pts = []
        for i in range(24):
            t = TAU * i / 24
            pts.append((0.016 * 16 * sin(t) ** 3, 0.016 * (13 * cos(t) - 5 * cos(2 * t) - 2 * cos(3 * t) - cos(4 * t))))
        C.extruir((0, 0.3, 0), pts, 0.16, c, "brillo", bisel=0.4, emisivo=G.oscurecer(c, 0.3))
    elif tipo == "llave":
        c = col or ORO
        C.toro((0, 0.45, 0), 0.09, 0.025, c, "oro", rot=(PI / 2, 0, 0), seg=18, seg_tubo=6)
        C.cilindro((0, 0.36, 0), (0, 0.02, 0), 0.02, 0.02, c, "oro", seg=8)
        for i, w in enumerate((0.07, 0.05)):
            C.caja((w / 2, 0.06 + i * 0.07, 0), (w / 2, 0.018, 0.015), c, "oro", radio=0.005)
    elif tipo == "cofre":
        c = col or "#8a5a2b"
        C.caja((0, 0.18, 0), (0.32, 0.18, 0.22), c, "madera", radio=0.02, variacion=0.1)
        C.torno((0, 0.36, 0), [(0.0, -0.22), (0.2, -0.2), (0.22, 0.0), (0.2, 0.2), (0.0, 0.22)], G.oscurecer(c, 1.1), "madera", seg=10, rot=(0, 0, PI / 2),
                escala=(1, 1.45, 1), variacion=0.1)
        for x in (-0.24, 0.24):
            C.caja((x, 0.25, 0), (0.025, 0.25, 0.235), METAL, "metal", radio=0.01)
        C.caja((0, 0.34, 0.235), (0.05, 0.06, 0.02), ORO, "oro", radio=0.01)
    elif tipo == "pocion":
        c = col or "#e0305a"
        C.torno((0, 0, 0), [(0.0, 0.0), (0.18, 0.02), (0.22, 0.14), (0.19, 0.28), (0.07, 0.36), (0.06, 0.48)], "#dfeff5", "cristal", seg=18, cerrar=False)
        C.torno((0, 0.01, 0), [(0.0, 0.0), (0.17, 0.02), (0.2, 0.13), (0.17, 0.24), (0.0, 0.25)], c, "brillo", seg=16, emisivo=G.oscurecer(c, 0.5))
        C.cilindro((0, 0.44, 0), (0, 0.54, 0), 0.055, 0.06, "#b08a5a", "madera", seg=10)
    elif tipo == "huevo":
        c = col or "#fff3d6"
        C.esfera((0, 0.32, 0), (0.22, 0.32, 0.22), c, "brillo", seg=18, deformar=lambda q: (q[0] * (1 - 0.12 * q[1] / 0.32), q[1], q[2] * (1 - 0.12 * q[1] / 0.32)))
        for i in range(7):
            a = i * 2.3
            C.esfera((0.19 * cos(a), 0.2 + 0.05 * i, 0.19 * sin(a)), (0.03, 0.03, 0.015), p.get("manchas", "#8ab04a"), "brillo", rot=(0, -a, 0), seg=6)
    elif tipo == "manzana":
        c = col or "#d8302a"
        C.esfera((0, 0.3, 0), 0.3, c, "brillo", seg=20, deformar=lambda q: (q[0], q[1] - 0.06 * max(0, 1 - (q[0] ** 2 + q[2] ** 2) / 0.02) * (1 if q[1] > 0 else -1), q[2]))
        C.capsula((0, 0.52, 0), (0.02, 0.66, 0), 0.015, 0.012, "#5a3a22", "madera", seg=6)
        C.esfera((0.08, 0.62, 0), (0.08, 0.01, 0.04), "#3f8a2a", "hoja", rot=(0, 0, 0.4), seg=8)
    elif tipo == "hongo":
        c = col or "#d8302a"
        C.capsula((0, 0, 0), (0, 0.3, 0), 0.08, 0.07, "#f2e6d0", "piel", seg=10)
        C.esfera((0, 0.32, 0), (0.3, 0.22, 0.3), c, "brillo", corte=0.55, seg=20)
        for i in range(7):
            a = i * 2.1
            C.esfera((0.18 * cos(a), 0.42 + 0.03 * (i % 2), 0.18 * sin(a)), (0.04, 0.02, 0.04), "#ffffff", "brillo", seg=6)
    elif tipo == "botiquin":
        C.caja((0, 0.2, 0), (0.28, 0.2, 0.12), "#f4f4f4", "plastico", radio=0.04)
        C.caja((0, 0.2, 0.121), (0.14, 0.04, 0.01), "#e02a2a", "plastico", radio=0.005)
        C.caja((0, 0.2, 0.121), (0.04, 0.14, 0.01), "#e02a2a", "plastico", radio=0.005)
        C.toro((0, 0.4, 0), 0.08, 0.018, "#303030", "plastico", rot=(-PI / 2, 0, 0), seg=12, seg_tubo=5, arco=PI)
    elif tipo == "bateria":
        c = col or "#3bff6a"
        C.cilindro((0, 0, 0), (0, 0.5, 0), 0.14, 0.14, "#2a2e33", "metal", seg=18)
        C.cilindro((0, 0.5, 0), (0, 0.56, 0), 0.05, 0.05, METAL, "metal", seg=10)
        for i in range(3):
            C.toro((0, 0.12 + i * 0.13, 0), 0.142, 0.02, c, "emisivo", emisivo=c, seg=18, seg_tubo=4)
    elif tipo == "trofeo":
        c = col or ORO
        C.torno((0, 0, 0), [(0.2, 0.0), (0.2, 0.06), (0.08, 0.1), (0.05, 0.25), (0.06, 0.3), (0.2, 0.42), (0.24, 0.62)], c, "oro", seg=22, cerrar=False)
        for s in (1, -1):
            C.toro((0.22 * s, 0.5, 0), 0.07, 0.015, c, "oro", rot=(PI / 2, 0, 0), seg=12, seg_tubo=5, arco=PI * 1.3)
    elif tipo == "reliquia":
        c = col or ORO
        C.caja((0, 0.06, 0), (0.18, 0.06, 0.14), "#5a4a3a", "piedra", radio=0.02)
        C.esfera((0, 0.28, 0), (0.12, 0.16, 0.1), c, "oro", seg=14)
        C.esfera((0, 0.5, 0), (0.1, 0.1, 0.09), c, "oro", seg=14)
        for s in (1, -1):
            C.esfera((0.04 * s, 0.52, 0.08), 0.02, "#30e0a0", "cristal", seg=6, emisivo="#20a070")
        C.cono((0, 0.58, 0), (0, 0.72, 0), 0.06, c, "oro", seg=8)
    elif tipo == "pergamino":
        c = col or "#e8d8a8"
        C.cilindro((-0.25, 0.08, 0), (0.25, 0.08, 0), 0.08, 0.08, c, "tela", seg=14)
        C.toro((0, 0.08, 0), 0.085, 0.015, "#c0392b", "tela", rot=(0, 0, PI / 2), seg=12, seg_tubo=4)
    elif tipo == "municion":
        C.caja((0, 0.12, 0), (0.22, 0.12, 0.14), "#5a6b3a", "metal", radio=0.02)
        for i in range(4):
            C.capsula((-0.12 + i * 0.08, 0.24, 0), (-0.12 + i * 0.08, 0.36, 0), 0.025, 0.018, ORO, "oro", seg=8)
    else:
        return objeto("gema", p, detalle)
    return C, None


def escenario(tipo, p=None, detalle=1.0, semilla=1):
    """Decoración y obstáculos del mundo (sin esqueleto)."""
    p = p or {}
    C = G.Constructor(detalle)
    if tipo == "fogata":
        for i in range(9):
            a = i * TAU / 9
            C.roca((0.55 * cos(a), 0.08, 0.55 * sin(a)), (0.14, 0.1, 0.12), "#7a7a76", semilla=semilla + i, seg=10)
        for i in range(4):
            a = i * PI / 4
            C.capsula((0.4 * cos(a), 0.05, 0.4 * sin(a)), (-0.4 * cos(a), 0.2, -0.4 * sin(a)), 0.07, 0.06, MADERA, "madera", seg=10, variacion=0.12)
        C.cono((0, 0.1, 0), (0, 0.85, 0), 0.28, "#ff6a1a", "emisivo", emisivo="#ff5a0a", seg=10)
        C.cono((0.08, 0.1, 0.05), (0.1, 0.6, 0.05), 0.16, "#ffb03a", "emisivo", emisivo="#ff9a1a", seg=8)
        C.cono((-0.06, 0.1, -0.04), (-0.04, 0.45, -0.04), 0.12, "#ffe27a", "emisivo", emisivo="#ffd84a", seg=8)
    elif tipo == "bandera":
        C.roca((0, 0.1, 0), (0.35, 0.15, 0.3), "#8a8a84", semilla=semilla)
        C.cilindro((0, 0, 0), (0, 3.0, 0), 0.04, 0.035, "#dcdcdc", "metal", seg=10)
        C.esfera((0, 3.02, 0), 0.07, ORO, "oro", seg=10)
        C.plano((0.46, 2.9, 0), 0.9, 0.6, p.get("color", "#3fdc2b"), "tela_doble", ondas=0.04, div=6)
    elif tipo == "portal":
        piedra = p.get("piedra", "#8a847a")
        for s in (1, -1):
            C.caja((1.3 * s, 1.4, 0), (0.28, 1.4, 0.3), piedra, "piedra", radio=0.06, variacion=0.15)
        C.toro((0, 2.8, 0), 1.3, 0.3, piedra, "piedra", rot=(-PI / 2, 0, 0), arco=PI, seg=16, seg_tubo=8)
        luz = p.get("luz", "#8a5aff")
        C.esfera((0, 1.6, 0), (1.05, 1.6, 0.05), luz, "emisivo", emisivo=G.oscurecer(luz, 0.85), seg=24)
        for i in range(5):
            a = PI * i / 4
            C.esfera((1.3 * cos(a), 2.8 + 1.3 * sin(a), 0.3), 0.07, luz, "emisivo", emisivo=luz, seg=6)
    elif tipo == "pinchos":
        C.caja((0, 0.04, 0), (0.9, 0.04, 0.9), "#4a4a4e", "metal", radio=0.02)
        for i in range(5):
            for j in range(5):
                x, z = -0.72 + i * 0.36, -0.72 + j * 0.36
                C.cono((x, 0.06, z), (x, 0.55, z), 0.08, "#b8bec6", "metal", seg=6)
    elif tipo == "tronco":
        C.cilindro((-1.4, 0.4, 0), (1.4, 0.4, 0), 0.4, 0.38, "#6b4a2b", "madera", seg=18, tapas=False)
        for s in (1, -1):
            C.cilindro((1.4 * s, 0.4, 0), (1.42 * s, 0.4, 0), 0.38, 0.36, "#c9a56a", "madera", seg=18)
            C.toro((1.425 * s, 0.4, 0), 0.2, 0.012, "#8a6a3a", "madera", rot=(0, 0, PI / 2), seg=16, seg_tubo=3)
        for i in range(6):  # corteza
            a = i * TAU / 6 + 0.3
            C.capsula((-1.2, 0.4 + 0.39 * sin(a), 0.39 * cos(a)), (1.2, 0.4 + 0.39 * sin(a), 0.39 * cos(a)), 0.03, 0.03, "#4f3520", "madera", seg=5)
    elif tipo == "roca":
        C.roca((0, 0.5, 0), (1.0, 0.7, 0.85), p.get("color", "#8a8a84"), semilla=semilla, seg=18)
        C.roca((0.8, 0.25, 0.5), (0.45, 0.32, 0.4), p.get("color", "#8a8a84"), semilla=semilla + 3, seg=12)
    elif tipo in ("arbol", "arbol_otono", "arbol_seco"):
        tronco = p.get("tronco", "#5a3d26")
        hojas = p.get("hojas", {"arbol": "#3f7a2e", "arbol_otono": "#d8782a", "arbol_seco": None}[tipo])
        C.capsula((0, 0, 0), (0.1, 2.6, 0.05), 0.28, 0.16, tronco, "madera", seg=12, variacion=0.14)
        ramas = [((0.1, 2.0, 0.05), (1.3, 3.2, 0.4)), ((0.05, 2.3, 0.0), (-1.1, 3.5, -0.3)), ((0.1, 2.5, 0.05), (0.2, 3.9, -1.0)),
                 ((0.1, 2.2, 0.05), (-0.3, 3.3, 1.1))]
        for a, b in ramas:
            C.capsula(a, b, 0.11, 0.05, tronco, "madera", seg=8, variacion=0.14)
        if hojas:
            import random
            rnd = random.Random(semilla)
            for i in range(9):
                cx, cy, cz = rnd.uniform(-1.3, 1.3), rnd.uniform(3.0, 4.6), rnd.uniform(-1.3, 1.3)
                r = rnd.uniform(0.8, 1.25)
                tono = G.mezclar_hex(hojas, "#ffe07a" if tipo == "arbol_otono" else "#b8d860", rnd.uniform(0, 0.25))
                C.esfera((cx, cy, cz), (r, r * 0.8, r), tono, "hoja", seg=12, variacion=0.12,
                         deformar=lambda q, s=rnd.random() * 9: G.v_mul(q, 1 + 0.18 * G.fbm3(q[0] * 2 + s, q[1] * 2, q[2] * 2, 3, 3)))
    elif tipo == "pino":
        C.capsula((0, 0, 0), (0, 5.5, 0), 0.25, 0.08, "#4a3322", "madera", seg=10, variacion=0.1)
        verde = p.get("hojas", "#2f5a2e")
        for i in range(5):
            y = 1.3 + i * 0.95
            r = 1.8 - i * 0.32
            C.torno((0, y, 0), [(0.0, 0.0), (r, 0.15), (r * 0.55, 0.7), (0.0, 1.4)], G.mezclar_hex(verde, "#5a8a3a", i * 0.08), "hoja", seg=14,
                    radial=lambda u, yy, i=i: 1 + 0.12 * sin(u * 9 + i), variacion=0.1)
    elif tipo == "arbusto":
        import random
        rnd = random.Random(semilla)
        for i in range(6):
            r = rnd.uniform(0.35, 0.6)
            C.esfera((rnd.uniform(-0.5, 0.5), r * 0.8, rnd.uniform(-0.5, 0.5)), (r, r * 0.85, r), G.mezclar_hex(p.get("hojas", "#3f7a2e"), "#8ab04a", rnd.random() * 0.3),
                     "hoja", seg=10, variacion=0.12)
        if p.get("flores"):
            for i in range(10):
                C.esfera((rnd.uniform(-0.6, 0.6), rnd.uniform(0.4, 0.9), rnd.uniform(-0.6, 0.6)), 0.06, p["flores"], "brillo", seg=6)
    elif tipo == "cerca":
        for x in (-1.0, 0.0, 1.0):
            C.caja((x, 0.55, 0), (0.07, 0.55, 0.07), MADERA, "madera", radio=0.015, variacion=0.12)
            C.cono((x, 1.1, 0), (x, 1.22, 0), 0.07, MADERA, "madera", seg=4)
        for y in (0.4, 0.85):
            C.caja((0, y, 0.08), (1.1, 0.06, 0.025), G.oscurecer(MADERA, 1.1), "madera", radio=0.01, variacion=0.12)
    elif tipo == "carreta":
        C.caja((0, 0.75, 0), (0.7, 0.3, 1.0), MADERA, "madera", radio=0.03, variacion=0.12)
        for s in (1, -1):
            C.toro((0.78 * s, 0.45, 0), 0.42, 0.05, "#4a3322", "madera", rot=(0, 0, PI / 2), seg=18, seg_tubo=6)
            for i in range(6):
                a = i * PI / 6
                C.cilindro((0.78 * s, 0.45 - 0.4 * sin(a), -0.4 * cos(a)), (0.78 * s, 0.45 + 0.4 * sin(a), 0.4 * cos(a)), 0.02, 0.02, "#6b4a2b", "madera", seg=5)
        C.capsula((0, 0.6, 1.0), (0, 0.4, 2.0), 0.05, 0.05, MADERA, "madera", seg=8)
        C.esfera((0, 1.05, 0.2), (0.55, 0.3, 0.6), p.get("carga", "#d9b25a"), "pelo", seg=12, variacion=0.15)
    elif tipo == "cartel":
        C.cilindro((0, 0, 0), (0, 1.6, 0), 0.06, 0.05, MADERA, "madera", seg=8)
        C.caja((0, 1.45, 0.07), (0.55, 0.25, 0.03), G.oscurecer(MADERA, 1.15), "madera", radio=0.02, variacion=0.12)
        C.caja((0.55, 1.45, 0.07), (0.05, 0.16, 0.03), G.oscurecer(MADERA, 1.15), "madera", radio=0.02, rot=(0, 0, 0.785))
    elif tipo == "farol":
        C.cilindro((0, 0, 0), (0, 2.6, 0), 0.06, 0.045, "#2f3338", "metal", seg=10)
        C.capsula((0, 2.55, 0), (0.45, 2.65, 0), 0.03, 0.025, "#2f3338", "metal", seg=8)
        C.caja((0.45, 2.35, 0), (0.1, 0.15, 0.1), "#ffd87a", "emisivo", emisivo="#ffcc5a", radio=0.02)
        C.cono((0.45, 2.5, 0), (0.45, 2.62, 0), 0.14, "#2f3338", "metal", seg=4)
    elif tipo == "lapida":
        piedra = p.get("color", "#8f9192")
        C.caja((0, 0.55, 0), (0.35, 0.5, 0.09), piedra, "piedra", radio=0.03, variacion=0.15)
        C.cilindro((0, 1.05, -0.09), (0, 1.05, 0.09), 0.35, 0.35, piedra, "piedra", seg=18)
        C.caja((0, 0.05, 0.15), (0.45, 0.05, 0.3), G.oscurecer(piedra, 0.8), "piedra", radio=0.02, variacion=0.15)
        C.caja((0, 0.75, 0.095), (0.04, 0.2, 0.01), G.oscurecer(piedra, 0.6), "piedra", radio=0.005)
        C.caja((0, 0.82, 0.095), (0.12, 0.035, 0.01), G.oscurecer(piedra, 0.6), "piedra", radio=0.005)
    elif tipo == "barril":
        C.torno((0, 0, 0), [(0.3, 0.0), (0.36, 0.25), (0.38, 0.45), (0.36, 0.65), (0.3, 0.9)], p.get("color", "#8a5a2b"), "madera", seg=18,
                radial=lambda u, y: 1 + 0.015 * sin(u * 18), variacion=0.1)
        for y, r in ((0.12, 0.335), (0.45, 0.385), (0.78, 0.335)):
            C.toro((0, y, 0), r, 0.018, "#3a3a3e", "metal", seg=20, seg_tubo=4)
    elif tipo == "caja":
        c = p.get("color", "#a0763f")
        C.caja((0, 0.5, 0), (0.5, 0.5, 0.5), c, "madera", radio=0.02, variacion=0.12)
        borde = G.oscurecer(c, 0.72)
        for a in (-0.47, 0.47):
            for b in (-0.47, 0.47):
                C.caja((0, 0.5 + a, b), (0.5, 0.045, 0.045), borde, "madera", radio=0.01, variacion=0.1)
                C.caja((a, 0.5, b), (0.045, 0.5, 0.045), borde, "madera", radio=0.01, variacion=0.1)
                C.caja((a, 0.5 + b, 0), (0.045, 0.045, 0.5), borde, "madera", radio=0.01, variacion=0.1)
        for s_ in (1, -1):
            C.caja((0, 0.5, 0.49 * s_), (0.62, 0.04, 0.02), borde, "madera", radio=0.008, rot=(0, 0, 0.785 * s_))
            C.caja((0.49 * s_, 0.5, 0), (0.02, 0.04, 0.62), borde, "madera", radio=0.008, rot=(0.785 * s_, 0, 0))
    elif tipo == "trampa":
        C.cilindro((0, 0, 0), (0, 0.04, 0), 0.45, 0.45, "#3a3a3e", "metal", seg=20)
        for s in (1, -1):
            C.toro((0, 0.08, 0), 0.4, 0.025, "#6a6e74", "metal", rot=(0, 0, 0.25 * s), arco=PI, seg=16, seg_tubo=5)
            for i in range(7):
                a = PI * (0.1 + 0.8 * i / 6)
                C.cono((0.4 * cos(a), 0.1, 0.4 * sin(a) * s), (0.3 * cos(a), 0.24, 0.3 * sin(a) * s), 0.03, "#c8ccd2", "metal", seg=4)
    elif tipo == "espinos":
        import random
        rnd = random.Random(semilla)
        for i in range(12):
            a, b = rnd.uniform(0, TAU), rnd.uniform(0.2, 1.2)
            q0 = (rnd.uniform(-0.2, 0.2), 0.0, rnd.uniform(-0.2, 0.2))
            q1 = (cos(a) * 0.9, b, sin(a) * 0.9)
            C.capsula(q0, q1, 0.035, 0.015, "#3a2a1e", "madera", seg=6)
            for j in range(3):
                f = 0.3 + 0.25 * j
                q = v_lerp_(q0, q1, f)
                C.cono(q, v_desp(q, (rnd.uniform(-0.15, 0.15), 0.12, rnd.uniform(-0.15, 0.15))), 0.015, "#6a4a2a", "hueso", seg=4)
    elif tipo == "sacos_arena":  # parapeto de sacos de arena (hileras trabadas, cada saco un poco distinto)
        import random
        rnd = random.Random(semilla)
        for fila in range(3):
            n = 5 - fila
            for i in range(n):
                x = (i - (n - 1) / 2) * 0.5 + rnd.uniform(-0.02, 0.02)
                C.caja((x, 0.1 + fila * 0.185, rnd.uniform(-0.03, 0.03)), (0.25, 0.095, 0.16), G.mezclar_hex("#bca77a", "#8f7d55", rnd.random()), "tela",
                       radio=0.075, rot=(0, rnd.uniform(-0.12, 0.12), rnd.uniform(-0.04, 0.04)), variacion=0.12)
                C.toro((x - 0.2, 0.1 + fila * 0.185, 0), 0.05, 0.008, "#6a5a3a", "tela", rot=(0, 0, PI / 2), seg=8, seg_tubo=3)
    elif tipo == "bidon":
        col = p.get("color", "#3a5a3a")
        C.cilindro((0, 0, 0), (0, 0.9, 0), 0.3, 0.3, col, "metal", seg=18)
        for y in (0.02, 0.3, 0.6, 0.88):
            C.toro((0, y, 0), 0.305, 0.015, G.oscurecer(col, 0.75), "metal", seg=18, seg_tubo=4)
        C.cilindro((0.12, 0.9, 0.05), (0.12, 0.93, 0.05), 0.04, 0.04, "#2a2a2a", "metal", seg=8)
    elif tipo == "barricada":  # erizos checos de madera con alambre de púas
        for x0 in (-0.9, 0.9):
            for s_ in (1, -1):
                C.caja((x0, 0.55, 0), (0.06, 0.72, 0.06), "#6b4a2b", "madera", radio=0.01, rot=(0, 0, 0.62 * s_), variacion=0.12)
            C.caja((x0, 0.55, 0), (0.06, 0.72, 0.06), "#5a3d22", "madera", radio=0.01, rot=(0.62, 0, 0), variacion=0.12)
        C.caja((0, 0.78, 0), (1.25, 0.04, 0.04), "#5a3a22", "madera", radio=0.01)
        for k in range(22):
            C.toro((-1.1 + k * 0.105, 0.95, 0), 0.075, 0.005, "#8a9098", "metal", rot=(0, 0, PI / 2 + 0.2), seg=8, seg_tubo=3)
    elif tipo == "alambre":  # concertina: espiral de alambre de púas entre dos estacas
        for k in range(26):
            C.toro((-1.25 + k * 0.1, 0.27, 0), 0.26, 0.006, "#9aa0a8", "metal", rot=(0.18, 0, PI / 2), seg=12, seg_tubo=3)
        for x in (-1.35, 1.35):
            C.cilindro((x, 0, 0), (x, 0.75, 0), 0.03, 0.025, "#5a4a3a", "madera", seg=6)
    elif tipo == "tanque":
        cam = p.get("camuflaje") or ["#5a6b3a", "#3f4a2a", "#6b5a3a"]
        cf = camuflaje(cam, escala=1.3, semilla=semilla)
        C.caja((0, 0.55, 0), (0.7, 0.2, 1.35), cf, "metal", radio=0.06)
        C.caja((0, 0.78, 0.05), (0.62, 0.07, 1.2), cf, "metal", radio=0.05)
        C.caja((0, 0.6, 1.38), (0.66, 0.12, 0.1), cf, "metal", radio=0.04, rot=(0.6, 0, 0))
        for s_ in (1, -1):
            C.caja((0.82 * s_, 0.38, 0), (0.16, 0.3, 1.45), "#2a2a26", "goma", radio=0.13)
            for k in range(6):
                z = -1.05 + k * 0.42
                C.cilindro((0.97 * s_, 0.33, z), (0.99 * s_, 0.33, z), 0.19, 0.19, "#4a4a40", "metal", seg=14)
                C.cilindro((0.99 * s_, 0.33, z), (1.0 * s_, 0.33, z), 0.07, 0.07, "#6a6a5a", "metal", seg=8)
            C.caja((0.82 * s_, 0.7, 0), (0.18, 0.02, 1.4), cf, "metal", radio=0.01)
        C.caja((0, 1.07, -0.15), (0.5, 0.2, 0.62), cf, "metal", radio=0.12)
        C.cilindro((0.22, 1.27, -0.35), (0.22, 1.36, -0.35), 0.16, 0.16, cf, "metal", seg=14)
        C.cilindro((0, 1.1, 0.4), (0, 1.14, 2.55), 0.07, 0.06, "#3a4a2a", "metal", seg=14)
        C.cilindro((0, 1.14, 2.4), (0, 1.145, 2.62), 0.095, 0.095, "#2f3a22", "metal", seg=14)
        C.cilindro((-0.32, 1.27, -0.6), (-0.36, 2.3, -0.66), 0.008, 0.005, "#1a1a1a", "metal", seg=4)
    elif tipo == "jeep":
        col = p.get("color", "#4a5a32")
        C.caja((0, 0.66, 0), (0.62, 0.2, 1.25), col, "metal", radio=0.05)
        C.caja((0, 0.88, 0.78), (0.58, 0.06, 0.42), G.oscurecer(col, 0.92), "metal", radio=0.03)
        C.caja((0, 0.72, 1.27), (0.5, 0.12, 0.02), "#2a2a2a", "metal", radio=0.01)
        for k in range(7):
            C.caja((-0.3 + k * 0.1, 0.72, 1.29), (0.012, 0.09, 0.006), "#1a1a1a", "metal")
        C.caja((0, 1.14, 0.34), (0.58, 0.22, 0.018), "#2a2a2a", "metal", radio=0.008)
        C.caja((0, 1.14, 0.345), (0.52, 0.17, 0.01), "#9fc8e0", "cristal")
        for sx in (-0.28, 0.28):
            C.caja((sx, 0.95, -0.1), (0.22, 0.08, 0.22), "#4a3a2a", "cuero", radio=0.04)
            C.caja((sx, 1.18, -0.3), (0.22, 0.22, 0.05), "#4a3a2a", "cuero", radio=0.04)
        for s_ in (1, -1):
            C.capsula((0.55 * s_, 0.86, -0.55), (0.55 * s_, 1.5, -0.55), 0.025, 0.025, "#2a2a2a", "metal", seg=8)
            for z in (-0.8, 0.8):
                C.cilindro((0.52 * s_, 0.36, z), (0.74 * s_, 0.36, z), 0.33, 0.33, "#1f1f1f", "goma", seg=18)
                C.cilindro((0.74 * s_, 0.36, z), (0.76 * s_, 0.36, z), 0.17, 0.17, "#6a7058", "metal", seg=10)
                C.caja((0.64 * s_, 0.72, z), (0.14, 0.03, 0.4), col, "metal", radio=0.02)
            C.caja((0.3 * s_, 0.78, 1.28), (0.07, 0.05, 0.015), "#fff4c0", "emisivo", emisivo="#ffe8a0", radio=0.02)
        C.capsula((-0.55, 1.5, -0.55), (0.55, 1.5, -0.55), 0.025, 0.025, "#2a2a2a", "metal", seg=8)
        C.cilindro((0, 0.85, -1.27), (0, 0.85, -1.36), 0.3, 0.3, "#1f1f1f", "goma", seg=16)
    elif tipo == "torre_vigia":
        for sx in (1, -1):
            for sz in (1, -1):
                C.cilindro((0.8 * sx, 0, 0.8 * sz), (0.55 * sx, 3.2, 0.55 * sz), 0.07, 0.06, "#6b4a2b", "madera", seg=8)
            C.capsula((0.78 * sx, 1.2, 0.78), (0.64 * sx, 2.4, -0.64), 0.03, 0.03, "#5a3d22", "madera", seg=6)
        C.caja((0, 3.25, 0), (0.8, 0.035, 0.8), "#7a5433", "madera", radio=0.01, variacion=0.12)
        for sx in (1, -1):
            C.caja((0.78 * sx, 3.6, 0), (0.03, 0.35, 0.8), "#7a5433", "madera", variacion=0.12)
            C.caja((0, 3.6, 0.78 * sx), (0.8, 0.35, 0.03), "#7a5433", "madera", variacion=0.12)
        for k in range(9):  # escalera
            C.caja((0, 0.3 + k * 0.33, 0.9), (0.22, 0.02, 0.02), "#5a3d22", "madera")
        for sx in (-0.22, 0.22):
            C.capsula((sx, 0.0, 0.92), (sx, 3.2, 0.82), 0.025, 0.025, "#5a3d22", "madera", seg=6)
        C.cono((0, 4.15, 0), (0, 4.75, 0), 1.2, "#4a3a2a", "madera", seg=4)
        C.caja((0, 4.1, 0), (0.05, 0.12, 0.05), "#4a3a2a", "madera")
    elif tipo == "carpa_militar":
        col = p.get("color", "#5a6b3a")
        C.extruir((0, 0, 0), [(-1.1, 0.0), (1.1, 0.0), (0.0, 1.3)], 2.4, col, "tela", rot=(0, 0, 0))
        C.caja((0, 0.55, 1.215), (0.32, 0.55, 0.012), G.oscurecer(col, 0.5), "tela")
        C.capsula((0, 1.3, -1.3), (0, 1.3, 1.3), 0.03, 0.03, "#5a4a3a", "madera", seg=6)
        for z in (-1.3, 1.3):
            C.cilindro((0, 0, z), (0, 1.32, z), 0.03, 0.03, "#5a4a3a", "madera", seg=6)
            for s_ in (1, -1):
                C.cilindro((0, 1.3, z), (1.5 * s_, 0.0, z * 1.25), 0.004, 0.004, "#c8b890", "tela", seg=3)
    elif tipo == "lodo":
        C.esfera((0, 0.0, 0), (1.3, 0.06, 1.0), "#4a3422", "brillo", seg=20, deformar=lambda q: (q[0] * (1 + 0.15 * sin(q[2] * 5)), q[1], q[2] * (1 + 0.15 * cos(q[0] * 4))))
    else:
        return escenario("roca", p, detalle, semilla)
    return C, None


# ════════════════════════════════ CATÁLOGO DE PLANTILLAS ════════════════════════════════
FEMENINAS = {"exploradora", "guerrera", "granjera", "abuela", "bruja", "reina_bruja"}


def _h(id_, nombre, en, cat, p, claves, temas, enemigo=False, altura=1.8, estilo="normal", rol="personaje"):
    if id_ in FEMENINAS:
        p.setdefault("figura", "femenina")
    return {"id": id_, "nombre": nombre, "en": en, "cat": cat, "rig": "humanoide", "p": p, "claves": claves, "temas": temas,
            "enemigo": enemigo, "altura": altura, "estilo_anim": estilo, "rol": rol}


def _m(pl):
    """Plantilla militar: se guarda en la carpeta «Militares»."""
    pl["carpeta"] = "Militares"
    pl["temas"] = list(dict.fromkeys(pl["temas"] + ["militar"]))
    return pl


def _bq(pl):
    """Plantilla de estilo bloques (vóxel): se guarda en «Bloques» y el motor vóxel la prefiere."""
    if pl["rig"] in ("humanoide", "cuadrupedo"):
        pl["p"]["estilo"] = "bloques"
        pl["carpeta"] = "Bloques"
    else:
        pl["carpeta"] = "Bloques"
    pl["bloques"] = True
    return pl


def _q(id_, nombre, en, cat, p, claves, temas, enemigo=True, altura=1.2, rig="cuadrupedo"):
    return {"id": id_, "nombre": nombre, "en": en, "cat": cat, "rig": rig, "p": p, "claves": claves, "temas": temas, "enemigo": enemigo,
            "altura": altura, "rol": "animal"}


def _o(id_, nombre, en, cat, rig, tipo, claves, temas, altura, p=None, rol=None):
    return {"id": id_, "nombre": nombre, "en": en, "cat": cat, "rig": rig, "tipo": tipo, "p": p or {}, "claves": claves, "temas": temas,
            "enemigo": False, "altura": altura, "rol": rol or {"arma": "arma", "objeto": "coleccionable"}.get(rig, tipo)}


PLANTILLAS = [
    # ── héroes ──
    _h("explorador", "Explorador", "Explorer", "Personajes", {"piel": PIELES["media"], "camisa": "#c9b48a", "pantalon": "#6b5a3a", "botas": "#5a3a22", "botas_altas": True,
       "sombrero": "explorador", "chaleco": "#7a5a3a", "mochila": "#6b5a3a", "cinturon": "#4a3322", "pelo": "#4a2f1c"},
       ["explorador", "explorer", "aventurero", "adventurer", "hiker", "excursionista", "arqueologo", "heroe", "hero", "viajero"],
       ["bosque", "andes", "desierto", "dinosaurios", "exploracion", "aventura", "oceano"]),
    _h("exploradora", "Exploradora", "Explorer woman", "Personajes", {"piel": PIELES["clara"], "camisa": "#3f7a6a", "pantalon": "#7a6a4a", "botas": "#4a2f1c",
       "botas_altas": True, "pelo": "#8a4a2a", "pelo_tipo": "coleta", "mochila": "#a07040", "cinturon": "#4a3322", "complexion": "delgado"},
       ["exploradora", "aventurera", "heroina", "heroine", "chica", "girl", "mujer", "woman"], ["bosque", "andes", "desierto", "exploracion", "aventura"]),
    _h("caballero", "Caballero", "Knight", "Personajes", {"camisa": "#5a6b8a", "pantalon": "#4a4f5a", "botas": "#3a3a40", "botas_altas": True, "armadura": "#b8c0ca",
       "sombrero": "casco", "capa": "#9a2a2a", "guantes": "#8a929c", "cinturon": "#3a2a1a", "complexion": "fuerte"},
       ["caballero", "knight", "paladin", "guerrero", "warrior", "armadura", "armor", "templario"], ["medieval", "fantasia", "rpg"]),
    _h("guerrera", "Guerrera", "Warrior woman", "Personajes", {"piel": PIELES["morena"], "camisa": "#8a2a2a", "pantalon": "#3a2a22", "armadura": "#c9a64a", "pelo": "#1a1410",
       "pelo_tipo": "coleta", "botas": "#3a2a1a", "botas_altas": True, "cinturon": "#2a1a0a", "capa": "#5a1a1a"},
       ["guerrera", "amazona", "valquiria", "valkyrie", "warrior woman", "espadachina"], ["medieval", "fantasia", "rpg"]),
    _h("granjero", "Granjero", "Farmer", "Personajes", {"piel": PIELES["media"], "camisa": "#b03a2e", "pantalon": "#2f4f8a", "botas": "#4a3322", "sombrero": "paja",
       "pelo": "#5a3a1a", "barba": "corta", "cinturon": "#4a3322"},
       ["granjero", "farmer", "campesino", "agricultor", "ranchero", "vaquero de granja"], ["granja", "terror", "bosque"]),
    _h("granjera", "Granjera", "Farmer woman", "Personajes", {"piel": PIELES["clara"], "camisa": "#b5473a", "pantalon": "#3f6fa5", "botas": "#5a3a22", "sombrero": "paja",
       "pelo": "#b0482a", "pelo_tipo": "coleta", "cinta": "#3f7a2a"}, ["granjera", "campesina", "farmer girl", "agricultora"], ["granja", "terror"]),
    _h("mago", "Mago", "Wizard", "Personajes", {"piel": PIELES["clara"], "camisa": "#2f4f9a", "pantalon": "#2a2a4a", "tunica": "#2f4f9a", "sombrero": "bruja",
       "color_sombrero": "#2f4f9a", "cinta": "#e8c040", "barba": "larga", "pelo": "#dcdcdc", "color_barba": "#e8e8e8", "botas": "#3a2a4a"},
       ["mago", "wizard", "hechicero", "mage", "sorcerer", "brujo bueno", "merlin"], ["fantasia", "medieval", "rpg"], estilo="normal"),
    _h("soldado", "Soldado", "Soldier", "Personajes", {"piel": PIELES["media"], "camisa": "#5a6b3a", "pantalon": "#4a5a32", "botas": "#2a2a22", "botas_altas": True,
       "sombrero": "militar", "chaleco": "#3f4a2a", "mochila": "#4a5a32", "guantes": "#2a2a22", "cinturon": "#2a2a22", "complexion": "fuerte"},
       ["soldado", "soldier", "militar", "marine", "tirador"], ["militar", "disparos", "zombies", "supervivencia"]),
    _h("superviviente", "Superviviente", "Survivor", "Personajes", {"piel": PIELES["clara"], "camisa": "#6b4a3a", "pantalon": "#3a4a5a", "botas": "#3a2a1a", "sombrero": "gorra",
       "color_sombrero": "#2f3a4a", "mochila": "#5a4a3a", "pelo": "#3a2a1a", "barba": "corta", "parches": "#8a7a5a"},
       ["superviviente", "survivor", "sobreviviente", "refugiado", "civil"], ["zombies", "supervivencia", "ciudad", "terror"]),
    _h("astronauta", "Astronauta", "Astronaut", "Personajes", {"camisa": "#e8ecf0", "pantalon": "#e0e4e8", "botas": "#c8ccd2", "guantes": "#c8ccd2", "traje_espacial": True,
       "sombrero": "casco_espacial", "mat_camisa": "plastico", "mat_pantalon": "plastico", "complexion": "fuerte", "botas_altas": True},
       ["astronauta", "astronaut", "cosmonauta", "espacial", "spaceman"], ["espacio", "futurista"]),
    _h("cyberpunk", "Agente Cyber", "Cyberpunk agent", "Personajes", {"piel": PIELES["clara"], "camisa": "#1f2230", "pantalon": "#15171f", "botas": "#101218",
       "chaleco": "#3a1f5a", "pelo": "#ff3bd0", "pelo_tipo": "punk", "guantes": "#15171f", "cinturon": "#3bffe8"},
       ["cyberpunk", "hacker", "agente", "neon", "futurista", "cyber", "androide heroe"], ["futurista", "ciudad"]),
    _h("pirata", "Pirata", "Pirate", "Personajes", {"piel": PIELES["media"], "camisa": "#f0e8d8", "chaleco": "#8a1f1f", "pantalon": "#2a2a3a", "botas": "#1f1a18",
       "botas_altas": True, "sombrero": "pirata", "barba": "corta", "pelo": "#1f1410", "cinturon": "#5a3a22"},
       ["pirata", "pirate", "corsario", "bucanero", "capitan", "marinero"], ["oceano", "aventura"]),
    _h("ninja", "Ninja", "Ninja", "Personajes", {"piel": PIELES["clara"], "camisa": "#15161a", "pantalon": "#15161a", "botas": "#101012", "sombrero": "ninja",
       "cinta": "#c0392b", "cinturon": "#c0392b", "guantes": "#15161a", "complexion": "delgado"},
       ["ninja", "samurai", "sigiloso", "asesino", "shinobi"], ["medieval", "ciudad", "fantasia"]),
    _h("cazador", "Cazador", "Ranger", "Personajes", {"piel": PIELES["clara"], "camisa": "#3f5a2e", "pantalon": "#4a3a2a", "botas": "#3a2a1a", "botas_altas": True,
       "sombrero": "capucha", "color_sombrero": "#2f4a2a", "capa": "#2f4a2a", "cinturon": "#3a2a1a", "guantes": "#4a3322"},
       ["cazador", "hunter", "arquero", "archer", "ranger", "explorador del bosque", "robin"], ["bosque", "medieval", "fantasia"]),
    _h("vikingo", "Vikingo", "Viking", "Personajes", {"piel": PIELES["clara"], "camisa": "#6b5a4a", "pantalon": "#4a3a2a", "chaleco": "#8a7a6a", "sombrero": "casco_vikingo",
       "barba": "larga", "pelo": "#c08a3a", "color_barba": "#c08a3a", "botas": "#5a4a3a", "complexion": "fuerte", "cinturon": "#3a2a1a"},
       ["vikingo", "viking", "barbaro", "nordico", "guerrero del norte"], ["nieve", "medieval"]),
    _h("deportista", "Deportista", "Athlete", "Personajes", {"piel": PIELES["morena"], "camisa": "#e03a3a", "pantalon": "#1f2a5a", "botas": "#f4f4f4", "sombrero": "gorra",
       "color_sombrero": "#f4f4f4", "manga": "corta", "pelo": "#1a1410"}, ["deportista", "atleta", "athlete", "futbolista", "corredor", "jugador"], ["deportes", "ciudad"]),
    _h("heroe_chibi", "Héroe Mini", "Chibi hero", "Personajes", {"piel": PIELES["clara"], "camisa": "#2fa0e0", "pantalon": "#2a3a5a", "botas": "#8a4a2a", "pelo": "#5a3a1a",
       "proporcion": "chibi", "capa": "#e0302a", "cinturon": "#e8c040"}, ["chibi", "mini", "tierno", "cute", "nino", "niño", "kid", "pequeno"], ["fantasia", "aventura", "plataformas"]),
    _h("cazafantasmas", "Cazafantasmas", "Ghost hunter", "Personajes", {"piel": PIELES["clara"], "camisa": "#a8a070", "pantalon": "#a8a070", "botas": "#2a2a2a", "mochila": "#4a4e54",
       "guantes": "#2a2a2a", "sombrero": "gorra", "color_sombrero": "#3a3a3a", "pelo": "#3a2a1a"}, ["cazafantasmas", "ghost hunter", "investigador paranormal"], ["terror"]),
    # ── NPC ──
    _h("aldeano", "Aldeano", "Villager", "NPC", {"piel": PIELES["media"], "camisa": "#8a6a4a", "pantalon": "#5a4a3a", "botas": "#4a3322", "pelo": "#3a2a1a", "cinturon": "#3a2a1a"},
       ["aldeano", "villager", "pueblerino", "habitante", "npc", "vecino"], ["medieval", "granja", "bosque", "fantasia"], rol="personaje"),
    _h("sabio", "Anciano Sabio", "Old sage", "NPC", {"piel": PIELES["clara"], "camisa": "#6a5a8a", "tunica": "#6a5a8a", "barba": "larga", "pelo": "#e8e8e8", "color_barba": "#f0f0f0",
       "pelo_tipo": "calvo", "botas": "#4a3a3a"}, ["sabio", "anciano", "sage", "maestro", "chaman", "guia"], ["fantasia", "medieval", "andes", "bosque"]),
    _h("abuela", "Abuela", "Grandma", "NPC", {"piel": PIELES["clara"], "camisa": "#7a4a6a", "tunica": "#7a4a6a", "pelo": "#ececec", "pelo_tipo": "mono", "complexion": "gordo",
       "botas": "#3a2a2a", "chaleco": "#c8a878"}, ["abuela", "grandma", "anciana", "senora", "granny"], ["granja", "bosque", "andes", "terror"]),
    _h("abuelo", "Abuelo", "Grandpa", "NPC", {"piel": PIELES["media"], "camisa": "#6a7a8a", "pantalon": "#4a4a4a", "pelo": "#dcdcdc", "barba": "corta", "color_barba": "#e0e0e0",
       "sombrero": "vaquero", "color_sombrero": "#6a5a4a", "botas": "#3a2a1a"}, ["abuelo", "grandpa", "anciano", "viejo", "senor"], ["granja", "desierto", "andes", "oceano"]),
    _h("mercader", "Mercader", "Merchant", "NPC", {"piel": PIELES["morena"], "camisa": "#b08a3a", "chaleco": "#6a2a5a", "pantalon": "#3a2a4a", "mochila": "#8a5a2b",
       "sombrero": "vaquero", "color_sombrero": "#6a2a5a", "barba": "corta", "pelo": "#1a1410", "complexion": "gordo"},
       ["mercader", "comerciante", "merchant", "vendedor", "tendero", "shop"], ["medieval", "fantasia", "desierto", "oceano"]),
    # ── enemigos humanoides ──
    _h("zombie", "Zombi", "Zombie", "Enemigos", {"piel": PIELES["zombie"], "camisa": "#4a5a7a", "pantalon": "#3a3a4a", "botas": "#2a2a2a", "cara": "zombie", "pelo": "#2a2a1a",
       "parches": "#6a3a3a", "variacion": 0.12, "enojado": True}, ["zombi", "zombie", "zombis", "muerto viviente", "infectado", "walker", "undead"],
       ["zombies", "terror", "supervivencia"], enemigo=True, estilo="zombie"),
    _h("esqueleto", "Esqueleto", "Skeleton", "Enemigos", {"tipo": "esqueleto", "hueso": "#efe8d6"}, ["esqueleto", "skeleton", "calavera", "huesos", "no muerto"],
       ["terror", "medieval", "fantasia"], enemigo=True),
    _h("espantapajaros", "Espantapájaros", "Scarecrow", "Enemigos", {"cara": "saco", "camisa": "#6a7a4a", "pantalon": "#5a4a7a", "botas": "#4a3322", "sombrero": "paja",
       "color_sombrero": "#c8a050", "paja": True, "parches": "#b03a2e", "complexion": "delgado", "guantes": "#c8a672", "variacion": 0.1},
       ["espantapajaros", "scarecrow", "espanta pajaros", "muñeco de paja"], ["granja", "terror"], enemigo=True, estilo="pesado"),
    _h("cabeza_calabaza", "Cabeza de Calabaza", "Pumpkin head", "Enemigos", {"cara": "calabaza", "cabeza_escala": 1.35, "camisa": "#2a1f2a", "pantalon": "#1f1a1f", "botas": "#1a1414", "capa": "#3a1a3a",
       "paja": True, "guantes": "#2a1f2a", "fuego": "#ffb13a"}, ["cabeza de calabaza", "pumpkin head", "jack", "calabaza malvada", "jinete sin cabeza"],
       ["terror", "granja"], enemigo=True, estilo="pesado"),
    _h("bruja", "Bruja", "Witch", "Enemigos", {"piel": "#9ac080", "camisa": "#2a1f3a", "tunica": "#2a1f3a", "sombrero": "bruja", "pelo": "#1a1a1a", "pelo_tipo": "largo",
       "botas": "#1a1414", "enojado": True, "cinta": "#8a4ad0"}, ["bruja", "witch", "hechicera", "maga oscura"], ["terror", "fantasia"], enemigo=True),
    _h("robot", "Robot", "Robot", "Enemigos", {"tipo": "robot", "camisa": "#c8ccd2", "metal": "#8a939c", "luz": "#ff3b3b"}, ["robot", "droide", "android", "androide", "mecha", "maquina", "cyborg"],
       ["futurista", "espacio", "ciudad"], enemigo=True, estilo="pesado"),
    _h("alien", "Alienígena", "Alien", "Enemigos", {"piel": "#a8b8a0", "cara": "alien", "camisa": "#a8b8a0", "pantalon": "#98a890", "botas": "#98a890", "manga": "sin",
       "complexion": "delgado", "mat_camisa": "piel", "mat_pantalon": "piel"}, ["alien", "alienigena", "extraterrestre", "marciano", "gris", "invasor"],
       ["espacio", "futurista"], enemigo=True),
    _h("orco", "Orco", "Orc", "Enemigos", {"piel": "#6f9a4a", "camisa": "#5a3a22", "pantalon": "#3a2a1a", "armadura": "#6a6e74", "botas": "#2a1a0a", "pelo_tipo": "mono",
       "pelo": "#1a1a1a", "colmillos": True, "orejas": "puntiagudas", "complexion": "enorme", "enojado": True}, ["orco", "orc", "ogro", "troll", "bruto"],
       ["fantasia", "medieval"], enemigo=True, altura=2.1, estilo="pesado"),
    _h("goblin", "Goblin", "Goblin", "Enemigos", {"piel": "#8ab04a", "camisa": "#6a4a2a", "pantalon": "#4a3a2a", "botas": "#3a2a1a", "orejas": "puntiagudas", "pelo_tipo": "calvo",
       "proporcion": "estilizado", "complexion": "delgado", "enojado": True, "colmillos": True}, ["goblin", "duende malo", "trasgo", "gremlin"],
       ["fantasia", "medieval", "bosque"], enemigo=True, altura=1.2),
    _h("momia", "Momia", "Mummy", "Enemigos", {"piel": "#d8c8a0", "camisa": "#d8c8a0", "pantalon": "#d8c8a0", "botas": "#c8b890", "vendas": "#e0d0a8", "pelo_tipo": "calvo",
       "cara": "zombie"}, ["momia", "mummy", "faraon maldito"], ["desierto", "terror"], enemigo=True, estilo="zombie"),
    _h("vampiro", "Vampiro", "Vampire", "Enemigos", {"piel": PIELES["palida"], "camisa": "#1a1a1f", "chaleco": "#6a0a1a", "pantalon": "#15151a", "capa": "#2a0a12",
       "pelo": "#0a0a0a", "colmillos": True, "enojado": True, "ojos": "#c01a1a"}, ["vampiro", "vampire", "dracula", "conde"], ["terror"], enemigo=True),
    _h("bandido", "Bandido", "Bandit", "Enemigos", {"piel": PIELES["media"], "camisa": "#6a5a4a", "pantalon": "#3a3a3a", "chaleco": "#3a2a1a", "sombrero": "vaquero",
       "color_sombrero": "#2a1f18", "barba": "corta", "enojado": True, "cinturon": "#2a1a0a", "botas": "#2a1a0a"}, ["bandido", "bandit", "ladron", "forajido", "thief", "saqueador"],
       ["desierto", "oceano", "medieval", "ciudad"], enemigo=True),
    _h("soldado_enemigo", "Soldado Enemigo", "Enemy soldier", "Enemigos", {"piel": PIELES["clara"], "camisa": "#4a4a52", "pantalon": "#3a3a42", "sombrero": "militar",
       "color_sombrero": "#2a2a30", "chaleco": "#2a2a2e", "botas": "#1a1a1a", "botas_altas": True, "guantes": "#1a1a1a", "enojado": True},
       ["soldado enemigo", "enemy soldier", "mercenario", "guardia", "guard"], ["militar", "disparos", "ciudad"], enemigo=True),
    _h("demonio", "Demonio", "Demon", "Enemigos", {"piel": "#b0302a", "camisa": "#6a0a0a", "pantalon": "#3a0a0a", "manga": "sin", "orejas": "puntiagudas", "pelo_tipo": "calvo",
       "colmillos": True, "enojado": True, "ojos": "#ffcc00", "cuernos_h": True, "complexion": "fuerte"}, ["demonio", "demon", "diablo", "diablillo", "infernal"],
       ["terror", "fantasia"], enemigo=True),
    _h("yeti", "Yeti", "Yeti", "Enemigos", {"piel": "#9ab0c8", "camisa": "#f0f4f8", "pantalon": "#f0f4f8", "botas": "#e0e8f0", "mat_camisa": "pelo", "mat_pantalon": "pelo",
       "pelo": "#f4f8fc", "complexion": "enorme", "manga": "larga", "guantes": "#e8eef4", "enojado": True, "colmillos": True},
       ["yeti", "abominable", "pie grande", "bigfoot", "sasquatch"], ["nieve", "andes"], enemigo=True, altura=2.4, estilo="pesado"),
    _h("caballero_oscuro", "Caballero Oscuro", "Dark knight", "Enemigos", {"camisa": "#2a2a30", "pantalon": "#1a1a1f", "armadura": "#3a3a44", "sombrero": "casco",
       "color_sombrero": "#2a2a30", "pluma": "#6a0a1a", "capa": "#1a0a10", "guantes": "#2a2a30", "botas": "#1a1a1f", "botas_altas": True, "complexion": "fuerte"},
       ["caballero oscuro", "dark knight", "caballero negro", "paladin oscuro"], ["medieval", "fantasia", "terror"], enemigo=True, estilo="pesado"),
    _h("golem", "Gólem", "Golem", "Enemigos", {"tipo": "robot", "roca": True, "camisa": "#8a847a", "metal": "#6a665e", "luz": "#ffb13a"}, ["golem", "gólem", "coloso", "estatua viviente"],
       ["fantasia", "andes", "desierto"], enemigo=True, altura=2.6, estilo="pesado"),
    # ── criaturas ──
    _q("lobo", "Lobo", "Wolf", "Criaturas", {"largo": 1.2, "alto": 0.75, "pelaje": "#6b6b73", "orejas": "puntiagudas", "cola": "peluda", "hocico": 1.0, "dientes": True, "ojos": "#f0c030"},
       ["lobo", "wolf", "lobos", "wolves", "huargo", "perro salvaje"], ["bosque", "nieve", "terror", "medieval"], altura=1.1),
    _q("zorro", "Zorro", "Fox", "Criaturas", {"largo": 0.9, "alto": 0.5, "pelaje": "#d8702a", "vientre": "#f4ece0", "orejas": "puntiagudas", "cola": "peluda", "punta_cola": "#f4ece0",
       "patas": "#3a2a22", "hocico": 1.1, "ojos": "#e8a030"}, ["zorro", "fox", "zorros"], ["bosque", "granja", "nieve"], altura=0.8),
    _q("oso", "Oso", "Bear", "Criaturas", {"largo": 1.6, "alto": 1.0, "pelaje": "#5a3a22", "orejas": "redondas", "cola": "corta", "hocico": 0.6, "gordura": 1.35, "patas_grosor": 1.6,
       "garras": True, "cabeza": 1.2, "ojos": "#1a1410"}, ["oso", "bear", "osos", "grizzly", "oso pardo"], ["bosque", "nieve", "andes"], altura=1.5),
    _q("jabali", "Jabalí", "Boar", "Criaturas", {"largo": 1.1, "alto": 0.62, "pelaje": "#4a3a30", "orejas": "puntiagudas", "cola": "delgada", "hocico": 0.9, "cuernos": "colmillos",
       "gordura": 1.25, "pezunas": "#2a2020", "nariz": "#8a5a50"}, ["jabali", "boar", "cerdo salvaje", "puerco espin"], ["bosque", "granja"], altura=0.9),
    _q("perro", "Perro", "Dog", "Criaturas", {"largo": 0.95, "alto": 0.55, "pelaje": "#c89a5a", "orejas": "largas", "cola": "larga", "hocico": 0.9, "ojos": "#3a2a1a"},
       ["perro", "dog", "cachorro", "mascota"], ["granja", "ciudad"], enemigo=False, altura=0.85),
    _q("gato", "Gato", "Cat", "Criaturas", {"largo": 0.6, "alto": 0.32, "pelaje": "#2a2a2e", "orejas": "puntiagudas", "cola": "larga", "hocico": 0.4, "ojos": "#9ae040",
       "ojos_brillan": "#6ab020"}, ["gato", "cat", "gatito", "felino", "gato negro"], ["terror", "ciudad", "granja"], enemigo=False, altura=0.5),
    _q("llama", "Llama", "Llama", "Criaturas", {"largo": 1.1, "alto": 1.0, "cuello": 1.1, "pelaje": "#f0e6d8", "orejas": "largas", "cola": "corta", "hocico": 0.7,
       "pelo_cuello": True, "pezunas": "#3a2a22", "ojos": "#1a1410"}, ["llama", "alpaca", "vicuna", "guanaco", "llamas"], ["andes", "granja"], enemigo=False, altura=1.8),
    _q("ciervo", "Ciervo", "Deer", "Criaturas", {"largo": 1.2, "alto": 1.0, "cuello": 0.7, "pelaje": "#a0703a", "vientre": "#f0e6d8", "orejas": "largas", "cola": "corta",
       "cuernos": "astas", "hocico": 0.8, "patas_grosor": 0.7, "pezunas": "#2a2020"}, ["ciervo", "deer", "venado", "reno", "alce"], ["bosque", "nieve"], enemigo=False, altura=1.8),
    _q("toro", "Toro", "Bull", "Criaturas", {"largo": 1.6, "alto": 1.0, "pelaje": "#2a1f1a", "orejas": "redondas", "cola": "delgada", "cuernos": "cuernos", "gordura": 1.3,
       "patas_grosor": 1.3, "pezunas": "#1a1414", "hocico": 0.7, "nariz": "#4a3a3a"}, ["toro", "bull", "bufalo", "minotauro"], ["granja", "desierto"], altura=1.5),
    _q("raptor", "Raptor", "Raptor", "Criaturas", {"largo": 1.4, "alto": 0.95, "bipedo": True, "pelaje": "#5a8f3a", "vientre": "#d8d0a0", "mat": "piel", "orejas": "ninguna",
       "cola": "gruesa", "cola_largo": 0.9, "hocico": 1.2, "dientes": True, "garras": True, "ojos": "#f0c030", "pua_lomo": "#3a5a2a"},
       ["raptor", "velociraptor", "dinosaurio", "dinosaur", "dino"], ["dinosaurios", "bosque"], altura=1.6),
    # ── voladores ──
    _q("cuervo", "Cuervo", "Crow", "Voladores", {"tipo": "ave", "color": "#1a1a22", "vientre": "#2a2a33", "pico": "#2a2a2a", "ojos": "#e0a020", "envergadura": 0.8, "alto": 1.6},
       ["cuervo", "crow", "cuervos", "raven", "pajaro negro", "ave"], ["terror", "granja", "bosque"], altura=0.5, rig="volador"),
    _q("murcielago", "Murciélago", "Bat", "Voladores", {"tipo": "murcielago", "color": "#3a2a2e", "membrana": "#4a2f33", "ojos": "#ff3a2a", "ojos_brillan": "#ff2a1a", "envergadura": 0.8,
       "alto": 1.6}, ["murcielago", "bat", "murcielagos", "vampiro volador"], ["terror", "fantasia"], altura=0.45, rig="volador"),
    _q("condor", "Cóndor", "Condor", "Voladores", {"tipo": "ave", "color": "#1a1a1a", "color_cabeza": "#b8605a", "cuello_blanco": True, "pico": "#d8c8a0", "puntas": "#f0f0f0",
       "envergadura": 1.6, "alto": 2.2}, ["condor", "cóndor", "aguila", "eagle", "halcon", "buitre", "ave rapaz"], ["andes", "desierto"], altura=0.9, rig="volador"),
    _q("dron", "Dron", "Drone", "Voladores", {"tipo": "dron", "color": "#e8ecf0", "luz": "#ff3b3b", "envergadura": 1.0, "alto": 2.0, "rotores": True},
       ["dron", "drone", "drones", "robot volador"], ["futurista", "ciudad", "militar", "espacio"], altura=0.5, rig="volador"),
    _q("abeja", "Abeja Gigante", "Giant bee", "Voladores", {"tipo": "abeja", "color": "#f0c020", "envergadura": 0.8, "alto": 1.5, "ojos": "#1a1a1a"},
       ["abeja", "bee", "avispa", "wasp", "insecto"], ["bosque", "granja", "fantasia"], altura=0.5, rig="volador"),
    # ── arácnidos ──
    _q("arana", "Araña", "Spider", "Criaturas", {"tipo": "arana", "color": "#2a2226", "marca": "#c0302a", "ojos": "#ff2a2a", "ojos_brillan": True, "radio": 0.5, "alto": 0.45},
       ["arana", "araña", "spider", "tarantula", "aracnido"], ["terror", "bosque", "fantasia"], altura=0.7, rig="aracnido"),
    _q("escorpion", "Escorpión", "Scorpion", "Criaturas", {"tipo": "escorpion", "color": "#8a4b2a", "radio": 0.45, "alto": 0.3, "pinzas": True, "cola": True, "mat": "plastico",
       "ojos": "#1a1a1a"}, ["escorpion", "scorpion", "alacran"], ["desierto"], altura=0.7, rig="aracnido"),
    _q("cangrejo", "Cangrejo", "Crab", "Criaturas", {"tipo": "cangrejo", "color": "#e0502a", "radio": 0.45, "alto": 0.3, "patas": 6, "pinzas": True, "mat": "plastico",
       "ojos": "#1a1a1a"}, ["cangrejo", "crab", "cangrejos", "langosta"], ["oceano"], altura=0.55, rig="aracnido"),
    # ── gotas ──
    _q("slime", "Slime", "Slime", "Criaturas", {"tipo": "slime", "color": "#5ad05a", "alto": 1.0}, ["slime", "baba", "gelatina", "blob", "moco"], ["fantasia", "bosque"],
       altura=0.9, rig="gota"),
    _q("fantasma", "Fantasma", "Ghost", "Criaturas", {"tipo": "fantasma", "color": "#e8f0ff", "brillo": "#5a6a8a", "alto": 1.8, "flota": True},
       ["fantasma", "ghost", "espiritu", "espectro", "alma en pena", "boo"], ["terror"], altura=1.8, rig="gota"),
    _q("calabaza_saltarina", "Calabaza Saltarina", "Hopping pumpkin", "Criaturas", {"tipo": "calabaza", "color": "#ff7a1a", "alto": 1.0, "fuego": "#ffb13a"},
       ["calabaza saltarina", "calabaza viva", "calabaza malvada", "pumpkin monster", "jack o lantern"], ["terror", "granja"], altura=0.9, rig="gota"),
    # ── serpientes ──
    _q("serpiente", "Serpiente", "Snake", "Criaturas", {"color": "#4a8a3a", "bandas": "#2f5a2a", "vientre": "#d8d0a0", "largo": 2.4, "grosor": 0.1},
       ["serpiente", "snake", "vibora", "cobra", "boa", "culebra"], ["bosque", "desierto", "dinosaurios"], altura=0.35, rig="serpiente"),
    # ── jefes ──
    _h("rey_calabaza", "Rey Calabaza", "Pumpkin King", "Jefes", {"cara": "calabaza", "cabeza_escala": 1.7, "camisa": "#2a1a2e", "pantalon": "#1a1218", "armadura": "#4a3a2a", "capa": "#4a0a3a",
       "sombrero": "corona", "botas": "#1a1414", "guantes": "#2a1a2e", "complexion": "enorme", "paja": True, "fuego": "#ffb13a"},
       ["rey calabaza", "pumpkin king", "senor de las calabazas", "jefe calabaza"], ["terror", "granja"], enemigo=True, altura=3.2, estilo="pesado"),
    _h("reina_bruja", "Reina Bruja", "Witch Queen", "Jefes", {"piel": "#b8d0a0", "camisa": "#1a0f2a", "tunica": "#2a0f3a", "sombrero": "corona", "color_sombrero": "#9a7aff",
       "capa": "#3a0a4a", "pelo": "#e8e8f0", "pelo_tipo": "largo", "enojado": True, "ojos": "#a040ff"}, ["reina bruja", "witch queen", "hechicera suprema", "reina oscura"],
       ["terror", "fantasia"], enemigo=True, altura=2.8),
    _h("rey_esqueleto", "Rey Esqueleto", "Skeleton King", "Jefes", {"tipo": "esqueleto", "hueso": "#e8dcc0", "sombrero": "corona", "capa": "#4a0a0a", "brillo_ojos": "#3aff8a"},
       ["rey esqueleto", "skeleton king", "lich", "rey no muerto", "nigromante"], ["terror", "medieval", "fantasia"], enemigo=True, altura=3.0),
    _h("golem_gigante", "Gólem Gigante", "Giant Golem", "Jefes", {"tipo": "robot", "roca": True, "camisa": "#7a746a", "metal": "#5a564e", "luz": "#ff6a1a"}, ["golem gigante", "coloso", "titan", "gigante de piedra"],
       ["fantasia", "andes", "desierto", "medieval"], enemigo=True, altura=4.5, estilo="pesado"),
    _h("robot_gigante", "Mecha Gigante", "Giant Mech", "Jefes", {"tipo": "robot", "camisa": "#3a4250", "metal": "#8a939c", "luz": "#ff2a4a"}, ["robot gigante", "mecha", "giant robot", "exoesqueleto"],
       ["futurista", "espacio", "militar", "ciudad"], enemigo=True, altura=4.5, estilo="pesado"),
    _q("dragon", "Dragón", "Dragon", "Jefes", {"largo": 2.6, "alto": 1.3, "cuello": 0.9, "pelaje": "#8a1f1f", "vientre": "#e0b060", "mat": "piel", "orejas": "ninguna", "cola": "gruesa",
       "cola_largo": 1.0, "cuernos": "cuernos", "color_cuernos": "#2a2020", "alas": True, "color_alas": "#5a1010", "dientes": True, "garras": True, "ojos": "#ffcc00",
       "ojos_brillan": "#ffaa00", "pua_lomo": "#2a1a1a", "hocico": 1.1, "gordura": 1.35, "patas_grosor": 1.4}, ["dragon", "dragón", "wyvern", "drake", "serpiente alada"],
       ["fantasia", "medieval"], altura=4.0),
    _q("trex", "T-Rex", "T-Rex", "Jefes", {"largo": 2.8, "alto": 1.6, "bipedo": True, "pelaje": "#4f6f3a", "vientre": "#c8c098", "mat": "piel", "orejas": "ninguna", "cola": "gruesa",
       "cola_largo": 1.0, "hocico": 1.1, "cabeza": 1.6, "dientes": True, "garras": True, "ojos": "#f0a020", "gordura": 1.2}, ["trex", "t-rex", "tiranosaurio", "rey dinosaurio"],
       ["dinosaurios"], altura=5.0),
    _q("arana_reina", "Araña Reina", "Spider Queen", "Jefes", {"tipo": "arana", "color": "#1a1418", "marca": "#8a1aff", "ojos": "#ff2a8a", "ojos_brillan": True, "radio": 0.5, "alto": 0.45},
       ["arana reina", "araña gigante", "spider queen", "reina de las arañas"], ["terror", "fantasia"], altura=2.5, rig="aracnido"),
    _q("rey_slime", "Rey Slime", "Slime King", "Jefes", {"tipo": "slime", "color": "#3aa0ff", "alto": 1.0, "corona": True}, ["rey slime", "slime king", "slime gigante"],
       ["fantasia"], altura=3.0, rig="gota"),
    # ── armas ──
    _o("espada", "Espada", "Sword", "Armas", "arma", "espada", ["espada", "sword", "sable", "mandoble"], ["medieval", "fantasia", "rpg", "aventura"], 1.0),
    _o("katana", "Katana", "Katana", "Armas", "arma", "katana", ["katana", "sable japones"], ["medieval", "ciudad"], 1.0),
    _o("daga", "Daga", "Dagger", "Armas", "arma", "daga", ["daga", "dagger", "cuchillo", "knife", "puñal"], ["medieval", "fantasia"], 0.45),
    _o("hacha", "Hacha", "Axe", "Armas", "arma", "hacha", ["hacha", "axe", "hacha de guerra"], ["medieval", "nieve", "bosque"], 0.85),
    _o("hoz", "Hoz", "Sickle", "Armas", "arma", "hoz", ["hoz", "sickle", "segadora", "machete curvo"], ["granja", "terror"], 0.55),
    _o("guadana", "Guadaña", "Scythe", "Armas", "arma", "guadana", ["guadana", "guadaña", "scythe", "segador"], ["terror", "granja"], 1.8),
    _o("lanza", "Lanza", "Spear", "Armas", "arma", "lanza", ["lanza", "spear", "pica", "tridente"], ["medieval", "andes"], 1.9),
    _o("martillo", "Martillo de guerra", "War hammer", "Armas", "arma", "martillo", ["martillo", "hammer", "mazo"], ["medieval", "fantasia", "nieve"], 0.85),
    _o("maza", "Maza", "Mace", "Armas", "arma", "maza", ["maza", "mace", "lucero del alba"], ["medieval", "fantasia"], 0.85),
    _o("arco", "Arco", "Bow", "Armas", "arma", "arco", ["arco", "bow", "flechas", "arquero"], ["medieval", "bosque", "fantasia"], 1.2),
    _o("ballesta", "Ballesta", "Crossbow", "Armas", "arma", "ballesta", ["ballesta", "crossbow"], ["medieval", "terror"], 0.6),
    _o("tirachinas", "Tirachinas", "Slingshot", "Armas", "arma", "tirachinas", ["tirachinas", "resortera", "honda", "slingshot", "catapulta de mano"], ["granja", "bosque"], 0.3),
    _o("pistola", "Pistola", "Pistol", "Armas", "arma", "pistola", ["pistola", "pistol", "revolver", "handgun"], ["disparos", "militar", "zombies", "ciudad"], 0.3),
    _o("rifle", "Rifle", "Rifle", "Armas", "arma", "rifle", ["rifle", "fusil", "francotirador", "sniper", "metralleta"], ["disparos", "militar", "zombies"], 0.9),
    _o("escopeta", "Escopeta", "Shotgun", "Armas", "arma", "escopeta", ["escopeta", "shotgun"], ["zombies", "disparos", "granja"], 0.8),
    _o("blaster", "Bláster", "Blaster", "Armas", "arma", "blaster", ["blaster", "laser", "pistola laser", "arma de plasma", "rayo"], ["futurista", "espacio"], 0.35),
    _o("varita", "Varita mágica", "Magic wand", "Armas", "arma", "varita", ["varita", "wand", "varita magica"], ["fantasia"], 0.4),
    _o("baculo", "Báculo", "Staff", "Armas", "arma", "baculo", ["baculo", "staff", "cetro", "vara magica", "magia", "hechizo"], ["fantasia", "medieval"], 1.8),
    _o("escudo", "Escudo", "Shield", "Armas", "arma", "escudo", ["escudo", "shield", "rodela"], ["medieval", "fantasia"], 0.6),
    _o("antorcha", "Antorcha", "Torch", "Armas", "arma", "antorcha", ["antorcha", "torch", "linterna de fuego"], ["terror", "medieval", "andes"], 0.6),
    # ── coleccionables ──
    _o("calabaza", "Calabaza", "Pumpkin", "Coleccionables", "objeto", "calabaza", ["calabaza", "pumpkin", "calabazas", "zapallo", "auyama"], ["granja", "terror"], 0.7, rol="calabaza"),
    _o("calabaza_tallada", "Calabaza tallada", "Jack-o'-lantern", "Coleccionables", "objeto", "calabaza_tallada", ["calabaza tallada", "jackolantern", "jack o lantern", "calabaza de halloween"],
       ["terror", "granja"], 0.7, rol="calabaza"),
    _o("moneda", "Moneda", "Coin", "Coleccionables", "objeto", "moneda", ["moneda", "coin", "monedas", "oro", "gold"], ["aventura"], 0.6),
    _o("gema", "Gema", "Gem", "Coleccionables", "objeto", "gema", ["gema", "gem", "joya", "rubi", "zafiro", "esmeralda"], ["aventura", "fantasia"], 0.5),
    _o("diamante", "Diamante", "Diamond", "Coleccionables", "objeto", "diamante", ["diamante", "diamond", "brillante"], ["aventura"], 0.5),
    _o("cristal", "Cristal", "Crystal", "Coleccionables", "objeto", "cristal", ["cristal", "crystal", "cuarzo", "energia"], ["fantasia", "espacio", "nieve"], 0.8),
    _o("estrella", "Estrella", "Star", "Coleccionables", "objeto", "estrella", ["estrella", "star", "estrellas"], ["plataformas", "fantasia"], 0.72),
    _o("corazon", "Corazón", "Heart", "Coleccionables", "objeto", "corazon", ["corazon", "heart", "vida", "salud", "life"], ["aventura"], 0.6),
    _o("llave", "Llave", "Key", "Coleccionables", "objeto", "llave", ["llave", "key", "llaves"], ["terror", "aventura", "medieval"], 0.6),
    _o("cofre", "Cofre", "Chest", "Coleccionables", "objeto", "cofre", ["cofre", "chest", "tesoro", "treasure", "baul"], ["oceano", "aventura", "medieval"], 0.6),
    _o("pocion", "Poción", "Potion", "Coleccionables", "objeto", "pocion", ["pocion", "potion", "brebaje", "elixir", "frasco"], ["fantasia", "medieval"], 0.55),
    _o("huevo", "Huevo", "Egg", "Coleccionables", "objeto", "huevo", ["huevo", "egg", "huevos", "huevo de dinosaurio"], ["dinosaurios", "granja"], 0.65),
    _o("manzana", "Manzana", "Apple", "Coleccionables", "objeto", "manzana", ["manzana", "apple", "fruta", "fruit", "frutas"], ["granja", "bosque"], 0.6),
    _o("hongo", "Hongo", "Mushroom", "Coleccionables", "objeto", "hongo", ["hongo", "mushroom", "seta", "champiñon"], ["fantasia", "bosque"], 0.55),
    _o("botiquin", "Botiquín", "Medkit", "Coleccionables", "objeto", "botiquin", ["botiquin", "medkit", "first aid", "primeros auxilios"], ["zombies", "militar", "supervivencia"], 0.5),
    _o("bateria", "Batería", "Battery", "Coleccionables", "objeto", "bateria", ["bateria", "battery", "celula de energia", "energy cell", "pila"], ["futurista", "espacio"], 0.55),
    _o("trofeo", "Trofeo", "Trophy", "Coleccionables", "objeto", "trofeo", ["trofeo", "trophy", "copa", "premio"], ["deportes"], 0.65),
    _o("reliquia", "Reliquia", "Relic", "Coleccionables", "objeto", "reliquia", ["reliquia", "relic", "idolo", "idol", "artefacto", "tesoro antiguo"], ["desierto", "andes", "aventura"], 0.7),
    _o("pergamino", "Pergamino", "Scroll", "Coleccionables", "objeto", "pergamino", ["pergamino", "scroll", "mapa", "carta"], ["medieval", "fantasia"], 0.3),
    _o("municion", "Munición", "Ammo", "Coleccionables", "objeto", "municion", ["municion", "ammo", "balas"], ["disparos", "militar", "zombies"], 0.35),
    # ── decoración y obstáculos ──
    _o("fogata", "Fogata (punto de control)", "Campfire", "Decoracion", "escenario", "fogata", ["fogata", "campfire", "hoguera", "fuego", "punto de control", "checkpoint"],
       ["bosque", "andes", "medieval"], 1.0, rol="vela"),
    _o("bandera", "Bandera de control", "Checkpoint flag", "Decoracion", "escenario", "bandera", ["bandera", "flag", "checkpoint", "meta"], ["aventura"], 3.2, rol="senal"),
    _o("portal", "Portal", "Portal", "Decoracion", "escenario", "portal", ["portal", "puerta magica", "gate", "arco"], ["fantasia", "espacio"], 3.6, rol="torre"),
    _o("arbol", "Árbol frondoso", "Leafy tree", "Decoracion", "escenario", "arbol", ["arbol", "tree", "roble"], ["bosque", "granja"], 5.5),
    _o("arbol_otono", "Árbol de otoño", "Autumn tree", "Decoracion", "escenario", "arbol_otono", ["arbol de otono", "autumn tree", "otoño"], ["granja", "terror", "bosque"], 5.5, rol="arbol"),
    _o("arbol_seco", "Árbol seco", "Dead tree", "Decoracion", "escenario", "arbol_seco", ["arbol seco", "dead tree", "arbol muerto"], ["terror", "desierto"], 4.8, rol="arbol"),
    _o("pino", "Pino", "Pine", "Decoracion", "escenario", "pino", ["pino", "pine", "abeto", "conifera"], ["bosque", "nieve", "andes"], 6.0),
    _o("arbusto", "Arbusto", "Bush", "Decoracion", "escenario", "arbusto", ["arbusto", "bush", "matorral"], ["bosque", "granja"], 1.2),
    _o("roca", "Roca", "Rock", "Decoracion", "escenario", "roca", ["roca", "rock", "piedra", "peñasco"], ["bosque", "andes", "desierto"], 1.4),
    _o("cerca", "Cerca de madera", "Wooden fence", "Decoracion", "escenario", "cerca", ["cerca", "valla", "fence"], ["granja"], 1.2, rol="valla"),
    _o("carreta", "Carreta", "Cart", "Decoracion", "escenario", "carreta", ["carreta", "cart", "carro de heno"], ["granja", "medieval"], 1.5, rol="vehiculo"),
    _o("cartel", "Cartel", "Signpost", "Decoracion", "escenario", "cartel", ["cartel", "letrero", "sign", "señal"], ["granja", "bosque"], 1.8, rol="senal"),
    _o("farol", "Farol", "Lamp post", "Decoracion", "escenario", "farol", ["farol", "farola", "lamp", "lampara"], ["ciudad", "terror"], 2.8, rol="farola"),
    _o("lapida", "Lápida", "Gravestone", "Decoracion", "escenario", "lapida", ["lapida", "tumba", "gravestone", "tombstone"], ["terror"], 1.4),
    _o("barril", "Barril", "Barrel", "Decoracion", "escenario", "barril", ["barril", "barrel", "tonel"], ["medieval", "oceano", "granja"], 1.0),
    _o("caja", "Caja de madera", "Wooden crate", "Decoracion", "escenario", "caja", ["caja", "crate", "cajon"], ["medieval", "militar", "oceano"], 1.0),
    _o("pinchos", "Trampa de pinchos", "Spike trap", "Obstaculos", "escenario", "pinchos", ["pinchos", "spikes", "trampa de pinchos", "estacas"], ["aventura"], 0.55, rol="trampa"),
    _o("tronco", "Tronco rodante", "Rolling log", "Obstaculos", "escenario", "tronco", ["tronco", "log", "tronco rodante"], ["bosque"], 0.8, rol="escombros"),
    _o("trampa", "Trampa para osos", "Bear trap", "Obstaculos", "escenario", "trampa", ["trampa", "bear trap", "cepo"], ["bosque", "terror"], 0.3, rol="trampa"),
    _o("espinos", "Zarzas", "Thorns", "Obstaculos", "escenario", "espinos", ["zarzas", "espinos", "thorns", "espinas"], ["bosque", "terror"], 1.2, rol="trampa"),
    _o("lodo", "Charco de lodo", "Mud puddle", "Obstaculos", "escenario", "lodo", ["lodo", "barro", "mud", "pantano"], ["granja", "bosque"], 0.1, rol="suelo"),
    # ─── militares: soldados, fuerzas especiales, vehículos y fortificaciones ───
    _m(_h("soldado_camuflado", "Soldado camuflado", "Camo soldier", "Personajes", {"piel": PIELES["media"], "camisa": "#5a6b3a", "pantalon": "#4a5a32",
       "camuflaje": ["#5a6b3a", "#3f4a2a", "#6b5a3a", "#232b1c"], "botas": "#2a2a22", "botas_altas": True, "sombrero": "militar", "color_sombrero": "#4a5a32",
       "chaleco": "#3f4a2a", "mochila": "#4a5a32", "guantes": "#2a2a22", "cinturon": "#2a2a22", "complexion": "fuerte"},
       ["soldado camuflado", "camo", "infanteria", "infantería", "recluta", "cabo", "sargento", "militares", "ejercito", "ejército"], ["militar", "disparos", "supervivencia"])),
    _m(_h("comando", "Comando", "Commando", "Personajes", {"piel": PIELES["media"], "camisa": "#2a2d33", "pantalon": "#2a2d33", "botas": "#141414", "botas_altas": True,
       "sombrero": "militar", "color_sombrero": "#1f2226", "chaleco": "#1f2226", "guantes": "#141414", "cinturon": "#141414", "mascara": True, "complexion": "fuerte"},
       ["comando", "commando", "fuerzas especiales", "swat", "operaciones especiales", "tactico", "táctico", "boina verde"], ["militar", "disparos", "ciudad"])),
    _m(_h("francotirador", "Francotirador", "Sniper", "Personajes", {"piel": PIELES["clara"], "camisa": "#5a6b3a", "pantalon": "#4a5a32",
       "camuflaje": ["#6b7a42", "#4a5a2e", "#8a8a5a", "#2f3a22"], "botas": "#2a2a22", "botas_altas": True, "sombrero": "boina", "color_sombrero": "#3a4a2a",
       "guantes": "#3a3a2a", "capa": "#4a5a2e", "cinturon": "#2a2a22"}, ["francotirador", "sniper", "tirador", "tirador de elite", "camuflado"], ["militar", "disparos", "bosque"])),
    _m(_h("general", "General", "General", "Personajes", {"piel": PIELES["clara"], "camisa": "#4a5a3a", "pantalon": "#3f4a32", "botas": "#1a1410", "botas_altas": True,
       "sombrero": "gorra_militar", "color_sombrero": "#3a4a2a", "medallas": True, "cinturon": "#2a1a10", "complexion": "gordo", "pelo": "#b8b8b8", "barba": "corta",
       "color_barba": "#b8b8b8"}, ["general", "coronel", "comandante", "capitan", "capitán", "oficial"], ["militar"])),
    _m(_h("medico_militar", "Médico militar", "Field medic", "Personajes", {"piel": PIELES["morena"], "camisa": "#5a6b3a", "pantalon": "#4a5a32", "botas": "#2a2a22",
       "botas_altas": True, "sombrero": "militar", "color_sombrero": "#4a5a32", "brazalete_medico": True, "mochila": "#e8e4dc", "cinturon": "#2a2a22"},
       ["medico", "médico", "medico militar", "sanitario", "paramedico", "enfermero"], ["militar", "zombies", "supervivencia"])),
    _m(_h("piloto", "Piloto", "Pilot", "Personajes", {"piel": PIELES["clara"], "camisa": "#5a6b5a", "pantalon": "#5a6b5a", "botas": "#1a1a1a", "botas_altas": True,
       "sombrero": "militar", "color_sombrero": "#6a7480", "guantes": "#2a2a2a", "chaleco": "#3a4a52", "cinturon": "#2a2a2a"},
       ["piloto", "pilot", "aviador", "piloto de combate", "helicoptero"], ["militar", "futurista"])),
    _m(_h("soldado_desierto", "Soldado del desierto", "Desert soldier", "Personajes", {"piel": PIELES["morena"], "camisa": "#c9b28a", "pantalon": "#b8a07a",
       "camuflaje": ["#c9b28a", "#a88a5a", "#d8c8a0", "#8a6a42"], "botas": "#6a4a2a", "botas_altas": True, "sombrero": "militar", "color_sombrero": "#b8a07a",
       "chaleco": "#8a7a52", "guantes": "#6a5a3a", "cinturon": "#4a3a22"}, ["soldado del desierto", "desert soldier", "tormenta del desierto"], ["militar", "desierto"])),
    _m(_h("soldado_nieve", "Soldado de montaña", "Arctic soldier", "Personajes", {"piel": PIELES["clara"], "camisa": "#e8eef4", "pantalon": "#d8e0e8",
       "camuflaje": ["#eef3f8", "#c8d0d8", "#a8b0b8"], "botas": "#3a3a3a", "botas_altas": True, "sombrero": "militar", "color_sombrero": "#e8eef4",
       "chaleco": "#c8d0d8", "guantes": "#8a9098", "mochila": "#d8e0e8"}, ["soldado de montaña", "soldado de nieve", "arctic soldier", "alpino"], ["militar", "nieve", "andes"])),
    _m(_h("mercenario", "Mercenario", "Mercenary", "Enemigos", {"piel": PIELES["media"], "camisa": "#3a3a3a", "pantalon": "#4a4a3a", "chaleco": "#5a4a3a",
       "sombrero": "boina", "color_sombrero": "#2a2a2a", "botas": "#1a1a1a", "botas_altas": True, "guantes": "#1a1a1a", "barba": "corta", "enojado": True},
       ["mercenario", "mercenary", "insurgente", "rebelde", "guerrillero", "enemigo armado"], ["militar", "disparos", "desierto"], enemigo=True)),
    _m(_h("comandante_enemigo", "Comandante enemigo", "Enemy commander", "Jefes", {"piel": PIELES["clara"], "camisa": "#2a2a30", "pantalon": "#2a2a30",
       "sombrero": "gorra_militar", "color_sombrero": "#1a1a20", "armadura": "#3a3a42", "capa": "#5a0a0a", "botas": "#0a0a0a", "botas_altas": True,
       "guantes": "#0a0a0a", "medallas": True, "enojado": True, "complexion": "enorme"}, ["comandante enemigo", "general enemigo", "dictador", "jefe militar",
       "señor de la guerra"], ["militar"], enemigo=True, altura=2.6)),
    _m(_o("sacos_arena", "Sacos de arena", "Sandbags", "Decoracion", "escenario", "sacos_arena", ["sacos de arena", "sandbags", "parapeto", "trinchera"], ["militar"], 1.0)),
    _m(_o("bidon", "Bidón", "Fuel drum", "Decoracion", "escenario", "bidon", ["bidon", "bidón", "tambor", "drum", "combustible"], ["militar", "ciudad", "zombies"], 0.9)),
    _m(_o("barricada", "Barricada", "Barricade", "Obstaculos", "escenario", "barricada", ["barricada", "barricade", "valla militar"], ["militar", "zombies"], 1.2, rol="obstaculo")),
    _m(_o("alambre", "Alambre de púas", "Barbed wire", "Obstaculos", "escenario", "alambre", ["alambre", "alambre de puas", "barbed wire", "concertina"], ["militar"], 0.7,
       rol="obstaculo")),
    _m(_o("tanque", "Tanque", "Tank", "Decoracion", "escenario", "tanque", ["tanque", "tank", "blindado", "carro de combate"], ["militar"], 2.4, rol="vehiculo")),
    _m(_o("jeep", "Jeep militar", "Military jeep", "Decoracion", "escenario", "jeep", ["jeep", "todoterreno", "vehiculo militar", "humvee"], ["militar", "desierto"], 1.6,
       rol="vehiculo")),
    _m(_o("torre_vigia", "Torre de vigilancia", "Watchtower", "Decoracion", "escenario", "torre_vigia", ["torre de vigilancia", "watchtower", "torre vigia", "atalaya"],
       ["militar", "medieval"], 5.0, rol="torre")),
    _m(_o("carpa_militar", "Carpa militar", "Army tent", "Decoracion", "escenario", "carpa_militar", ["carpa", "tienda de campaña", "campamento", "tent"], ["militar"], 1.3,
       rol="casa")),
    # ─── estilo BLOQUES (vóxel / pixel art en 3D, todos animados) ───
    _bq(_h("minero", "Minero", "Miner", "Personajes", {"piel": PIELES["media"], "camisa": "#3f6fb5", "pantalon": "#3a3f6a", "botas": "#4a3322", "sombrero": "militar",
        "color_sombrero": "#e8c040", "pelo": "#3a2a1a", "cinturon": "#4a3322"}, ["minero", "miner", "picador", "excavador", "constructor"], ["voxel", "cueva", "montana"])),
    _bq(_h("aldeano_bloques", "Aldeano de bloques", "Block villager", "NPC", {"piel": PIELES["media"], "camisa": "#7a5a3a", "tunica": "#7a5a3a", "pantalon": "#5a4a3a",
        "pelo": "#3a2a1a", "pelo_tipo": "calvo", "barba": "corta", "color_barba": "#5a4a3a"}, ["aldeano de bloques", "comerciante de bloques"], ["voxel", "granja"], rol="npc")),
    _bq(_h("soldado_bloques", "Soldado de bloques", "Block soldier", "Personajes", {"piel": PIELES["media"], "camisa": "#5a6b3a", "pantalon": "#4a5a32",
        "camuflaje": ["#5a6b3a", "#3f4a2a", "#6b5a3a", "#232b1c"], "botas": "#2a2a22", "botas_altas": True, "sombrero": "militar", "color_sombrero": "#4a5a32",
        "chaleco": "#3f4a2a", "mochila": "#4a5a32", "guantes": "#2a2a22", "cinturon": "#2a2a22"}, ["soldado de bloques", "soldado voxel", "soldado cubico"], ["voxel", "militar"])),
    _bq(_h("zombi_bloques", "Zombi de bloques", "Block zombie", "Enemigos", {"piel": PIELES["zombie"], "camisa": "#3f7a8a", "pantalon": "#3a3a7a", "botas": "#3a3a3a",
        "cara": "zombie", "pelo_tipo": "calvo", "tipo": "normal"}, ["zombi de bloques", "zombie de bloques", "zombi voxel"], ["voxel", "zombies", "terror"], enemigo=True,
        estilo="zombie")),
    _bq(_q("cerdo", "Cerdo", "Pig", "Criaturas", {"largo": 0.9, "alto": 0.5, "pelaje": "#f0a8a0", "orejas": "redondas", "cola": "delgada", "hocico": 0.6,
        "color_hocico": "#f4b8b0", "nariz": "#c07070", "gordura": 1.2, "pezunas": "#c08080"}, ["cerdo", "chancho", "puerco", "pig", "marrano"], ["granja", "voxel"],
        enemigo=False, altura=0.75)),
    _bq(_q("vaca", "Vaca", "Cow", "Criaturas", {"largo": 1.4, "alto": 0.85, "pelaje": "#f2efe8", "manchas": "#2a2a2a", "orejas": "redondas", "cola": "delgada",
        "cuernos": "cuernos", "color_cuernos": "#e8e0c8", "hocico": 0.5, "color_hocico": "#e8b8a8", "nariz": "#4a2a2a", "gordura": 1.2}, ["vaca", "cow", "ternero", "ganado"],
        ["granja", "voxel"], enemigo=False, altura=1.35)),
    _bq(_q("oveja", "Oveja", "Sheep", "Criaturas", {"largo": 1.0, "alto": 0.6, "pelaje": "#d8c8b8", "lana": "#f2efe8", "cara_color": "#d8c8b8", "orejas": "largas",
        "cola": "corta", "hocico": 0.4, "color_hocico": "#e0d0c0", "gordura": 1.3}, ["oveja", "sheep", "cordero", "borrego"], ["granja", "voxel", "andes"],
        enemigo=False, altura=0.95)),
    _bq(_q("caballo", "Caballo", "Horse", "Criaturas", {"largo": 1.6, "alto": 1.15, "cuello": 0.7, "pelaje": "#7a5230", "orejas": "puntiagudas", "cola": "peluda",
        "hocico": 0.9, "color_hocico": "#5a3a22", "nariz": "#2a1a10", "pezunas": "#2a2020"}, ["caballo", "horse", "yegua", "potro", "corcel"], ["granja", "medieval", "voxel"],
        enemigo=False, altura=1.8)),
    _bq(_o("pico", "Pico", "Pickaxe", "Armas", "arma", "pico", ["pico", "pickaxe", "piqueta", "pico de minero"], ["voxel", "cueva"], 0.7)),
    _bq(_o("espada_pixel", "Espada de bloques", "Block sword", "Armas", "arma", "espada_pixel", ["espada de bloques", "espada pixel", "espada de diamante", "espada voxel"],
        ["voxel"], 0.75)),
    _bq(_o("hacha_pixel", "Hacha de bloques", "Block axe", "Armas", "arma", "hacha_pixel", ["hacha de bloques", "hacha voxel", "hacha pixel"], ["voxel"], 0.7)),
    _bq(_o("pala", "Pala", "Shovel", "Armas", "arma", "pala", ["pala", "shovel", "pala de bloques"], ["voxel", "granja"], 0.7)),
]
POR_ID = {pl["id"]: pl for pl in PLANTILLAS}
CATEGORIAS = ["Personajes", "NPC", "Enemigos", "Criaturas", "Voladores", "Jefes", "Armas", "Coleccionables", "Decoracion", "Obstaculos"]


# ════════════════════════════════ CONSTRUIR, ELEGIR Y GUARDAR ════════════════════════════════
VERSION_FIG = 5
FORMA_A_PLANTILLA = {  # formas que usa el diseño del juego → plantilla
    "lobo": "lobo", "zorro": "zorro", "oso": "oso", "esqueleto": "esqueleto", "zombie": "zombie", "slime": "slime", "robot": "robot",
    "fantasma": "fantasma", "dinosaurio": "raptor", "dino": "raptor", "escorpion": "escorpion", "cangrejo": "cangrejo", "condor": "condor",
    "alien": "alien", "bruja": "bruja", "demonio": "demonio", "soldado": "soldado_enemigo", "mercenario": "mercenario", "cuervo": "cuervo", "murcielago": "murcielago",
    "arana": "arana", "serpiente": "serpiente", "espantapajaros": "espantapajaros", "calabaza": "calabaza_saltarina", "orco": "orco",
    "goblin": "goblin", "momia": "momia", "vampiro": "vampiro", "bandido": "bandido", "yeti": "yeti", "golem": "golem", "jabali": "jabali",
    "dron": "dron", "abeja": "abeja", "toro": "toro", "caballero": "caballero_oscuro", "humano": "bandido", "gato": "gato", "perro": "perro",
    "llama": "llama", "ciervo": "ciervo", "dragon": "dragon", "trex": "trex", "raptor": "raptor", "auto": None}
OBJETO_A_PLANTILLA = {"gema": "gema", "moneda": "moneda", "estrella": "estrella", "cristal": "cristal", "fruta": "manzana", "llave": "llave", "huevo": "huevo",
                      "botiquin": "botiquin", "cofre": "cofre", "calabaza": "calabaza", "corazon": "corazon", "pocion": "pocion", "hongo": "hongo",
                      "bateria": "bateria", "trofeo": "trofeo", "reliquia": "reliquia", "pergamino": "pergamino", "municion": "municion", "diamante": "diamante"}
ARMA_A_PLANTILLA = {"espada": "espada", "katana": "katana", "daga": "daga", "hacha": "hacha", "hoz": "hoz", "guadana": "guadana", "lanza": "lanza",
                    "martillo": "martillo", "maza": "maza", "arco": "arco", "ballesta": "ballesta", "tirachinas": "tirachinas", "pistola": "pistola",
                    "rifle": "rifle", "escopeta": "escopeta", "blaster": "blaster", "varita": "varita", "baculo": "baculo", "escudo": "escudo",
                    "antorcha": "antorcha", "disparo": "pistola", "magia": "baculo", "cuerpo": "espada"}
COLORES = {"rojo": "#c0392b", "roja": "#c0392b", "rojos": "#c0392b", "rojas": "#c0392b", "azul": "#2f6fd0", "azules": "#2f6fd0", "verde": "#3f9a3a",
           "verdes": "#3f9a3a", "amarillo": "#e8c040", "amarilla": "#e8c040", "naranja": "#ff7a1a", "anaranjado": "#ff7a1a", "morado": "#7a4ac0",
           "morada": "#7a4ac0", "violeta": "#8a5aff", "purpura": "#7a3ab0", "lila": "#b08ad8", "rosa": "#e86aa8", "rosado": "#e86aa8", "rosada": "#e86aa8",
           "negro": "#1f1f24", "negra": "#1f1f24", "negros": "#1f1f24", "blanco": "#f0f0f0", "blanca": "#f0f0f0", "gris": "#8a8f96", "marron": "#6b4a2b",
           "cafe": "#6b4a2b", "castano": "#6b4a2b", "dorado": "#e2b64a", "dorada": "#e2b64a", "oro": "#e2b64a", "plateado": "#cfd5dc", "plateada": "#cfd5dc",
           "plata": "#cfd5dc", "celeste": "#7ac8ff", "turquesa": "#2ad8c8", "cian": "#2ad8e8", "vino": "#7a1a2a", "granate": "#7a1a2a", "beige": "#d8c8a0",
           "rubio": "#e0c070", "rubia": "#e0c070", "pelirrojo": "#b0482a", "pelirroja": "#b0482a", "canoso": "#d8d8d8", "canosa": "#d8d8d8",
           "red": "#c0392b", "blue": "#2f6fd0", "green": "#3f9a3a", "yellow": "#e8c040", "orange": "#ff7a1a", "purple": "#7a4ac0", "pink": "#e86aa8",
           "black": "#1f1f24", "white": "#f0f0f0", "gray": "#8a8f96", "grey": "#8a8f96", "brown": "#6b4a2b", "gold": "#e2b64a", "golden": "#e2b64a",
           "silver": "#cfd5dc"}
PIEZAS = {"capa": "capa", "manto": "capa", "cape": "capa", "sombrero": "color_sombrero", "gorro": "color_sombrero", "casco": "color_sombrero", "hat": "color_sombrero",
          "capucha": "color_sombrero", "corona": "color_sombrero", "camisa": "camisa", "camiseta": "camisa", "chaqueta": "camisa", "traje": "camisa",
          "ropa": "camisa", "vestido": "camisa", "tunica": "tunica", "bata": "tunica", "shirt": "camisa", "pantalon": "pantalon", "pantalones": "pantalon",
          "botas": "botas", "zapatos": "botas", "ojos": "ojos", "eyes": "ojos", "piel": "piel", "skin": "piel", "pelo": "pelo", "cabello": "pelo",
          "hair": "pelo", "barba": "color_barba", "armadura": "armadura", "chaleco": "chaleco", "mochila": "mochila", "guantes": "guantes",
          "pelaje": "pelaje", "alas": "color_alas", "cuernos": "color_cuernos", "fuego": "fuego", "luz": "luz", "hoja": "color", "mango": "mango"}


def _toks(t):
    return re.findall(r"[a-z0-9ñ]+", _n(t))


def desde_texto(texto, categorias=None, defecto="explorador"):
    """Elige la plantilla que mejor encaja con la descripción → (plantilla, cambios, puntaje)."""
    t = " " + " ".join(_toks(texto)) + " "
    mejor, pmax = None, 0.0
    for pl in PLANTILLAS:
        if categorias and pl["cat"] not in categorias:
            continue
        pts = 0.0
        for c in pl["claves"] + [_n(pl["nombre"]), _n(pl["en"])]:
            c = " " + " ".join(_toks(c)) + " "
            if c.strip() and c in t:
                pts = max(pts, 1.0 + 0.4 * (len(c.split()) - 1))
            elif c.strip() and len(c.strip()) >= 5 and (" " + c.strip()[:-1]) in t:  # plural/singular
                pts = max(pts, 0.8)
        if pts > pmax:
            mejor, pmax = pl, pts
    if not mejor:
        mejor = POR_ID.get(defecto) or PLANTILLAS[0]
    return mejor, cambios_de_texto(texto, mejor), pmax


def cambios_de_texto(texto, pl):
    """Colores y accesorios pedidos en la descripción («capa roja», «con corona», «gigante», «ojos verdes»…)."""
    toks = _toks(texto)
    cambios = {}
    humano = pl["rig"] == "humanoide"
    for i, w in enumerate(toks):
        if w in COLORES:
            prev = [x for x in toks[max(0, i - 3):i] if x in PIEZAS]
            pieza = PIEZAS[prev[-1]] if prev else None
            if not pieza:
                sig = [x for x in toks[i + 1:i + 3] if x in PIEZAS]
                pieza = PIEZAS[sig[0]] if sig else None
            col = COLORES[w]
            if pieza:
                if pieza == "tunica" and humano:
                    cambios["tunica"] = col
                    cambios["camisa"] = col
                else:
                    cambios[pieza] = col
            elif "_general" not in cambios:
                cambios["_general"] = col
    t = " " + " ".join(toks) + " "
    if humano:
        acc = {" capa ": ("capa", "#8a1f1f"), " corona ": ("sombrero", "corona"), " sombrero de paja ": ("sombrero", "paja"),
               " sombrero de bruja ": ("sombrero", "bruja"), " sombrero vaquero ": ("sombrero", "vaquero"), " casco ": ("sombrero", "casco"),
               " capucha ": ("sombrero", "capucha"), " gorra ": ("sombrero", "gorra"), " mochila ": ("mochila", "#6b5a3a"),
               " barba larga ": ("barba", "larga"), " barba ": ("barba", "corta"), " armadura ": ("armadura", "#b8c0ca"), " tunica ": ("tunica", "#4a3a6a"),
               " calvo ": ("pelo_tipo", "calvo"), " pelo largo ": ("pelo_tipo", "largo"), " coleta ": ("pelo_tipo", "coleta"), " cuernos ": ("cuernos_h", True),
               " orejas puntiagudas ": ("orejas", "puntiagudas"), " elfo ": ("orejas", "puntiagudas"), " colmillos ": ("colmillos", True),
               " gordo ": ("complexion", "gordo"), " fuerte ": ("complexion", "fuerte"), " musculoso ": ("complexion", "fuerte"), " delgado ": ("complexion", "delgado"),
               " flaco ": ("complexion", "delgado"), " chibi ": ("proporcion", "chibi"), " cabezon ": ("proporcion", "chibi"), " tierno ": ("proporcion", "estilizado"),
               " caricatura ": ("proporcion", "estilizado"), " realista ": ("proporcion", "realista"), " parches ": ("parches", "#b03a2e"),
               " guantes ": ("guantes", "#4a3322"), " cinturon ": ("cinturon", "#4a3322"), " enojado ": ("enojado", True)}
        for k, (campo, v) in acc.items():
            if k in t and campo not in cambios:
                if campo in ("capa", "mochila", "armadura", "tunica", "guantes", "cinturon") and cambios.get(campo):
                    continue
                cambios[campo] = v
        mil = {" camuflaje ": ("camuflaje", ["#5a6b3a", "#3f4a2a", "#6b5a3a", "#232b1c"]), " camuflado ": ("camuflaje", ["#5a6b3a", "#3f4a2a", "#6b5a3a", "#232b1c"]),
               " pasamontanas ": ("mascara", True), " mascara ": ("mascara", True), " medallas ": ("medallas", True), " boina ": ("sombrero", "boina"),
               " casco militar ": ("sombrero", "militar"), " chaleco antibalas ": ("chaleco", "#2f3a2a"), " chaleco tactico ": ("chaleco", "#2f3a2a")}
        for k, (campo, v) in mil.items():
            if k in t and campo not in cambios:
                cambios[campo] = v
    else:
        if " alas " in t and pl["rig"] == "cuadrupedo":
            cambios["alas"] = True
    if re.search(r" (bloques|cubos|cubico|cubica|minecraft|voxel|voxeles|pixelado 3d|pixel 3d|de lego) ", t) and pl["rig"] in ("humanoide", "cuadrupedo"):
        cambios["_estilo"] = "bloques"
        if " cuernos " in t and pl["rig"] == "cuadrupedo":
            cambios["cuernos"] = "cuernos"
    for w, esc in ((" gigante ", 2.2), (" enorme ", 2.0), (" grande ", 1.4), (" pequeno ", 0.7), (" pequena ", 0.7), (" mini ", 0.6), (" diminuto ", 0.5)):
        if w in t:
            cambios["_escala"] = esc
            break
    if " brillante " in t or " magico " in t or " magica " in t or " encantad" in t:
        cambios["_brillo"] = True
    return cambios


def _aplicar(pl, cambios):
    p = json.loads(json.dumps(pl.get("p") or {}))
    gen = cambios.get("_general")
    for k, v in cambios.items():
        if not k.startswith("_"):
            p[k] = v
    if gen:
        principal = {"humanoide": "camisa", "cuadrupedo": "pelaje", "volador": "color", "aracnido": "color", "gota": "color", "serpiente": "color"}.get(pl["rig"], "color")
        if pl["rig"] == "humanoide" and p.get("tunica"):
            p["tunica"] = gen
        if pl["rig"] == "humanoide" and p.get("tipo") == "robot":
            principal = "camisa"
        if principal not in cambios:
            p[principal] = gen
    if cambios.get("_brillo"):
        p["brillo"] = p.get("brillo") or "#7ad8ff"
    if cambios.get("_estilo"):
        p["estilo"] = cambios["_estilo"]
    return p


def escalar(C, esq, clips, k):
    if abs(k - 1) < 1e-6:
        return
    for g in C.grupos.values():
        g.pos = [(x * k, y * k, z * k) for x, y, z in g.pos]
    if esq:
        for h in esq.huesos:
            h["pos"] = tuple(c * k for c in h["pos"])
    for an in clips or []:
        for pi in an["pistas"].values():
            if "translation" in pi:
                pi["translation"] = [(t, tuple(c * k for c in v)) for t, v in pi["translation"]]


def completar_clips(esq, clips):
    """Cada clip anima TODOS los huesos (si no, al pasar de un clip a otro un hueso se quedaría en la pose anterior)."""
    if not esq:
        return clips
    usados = {}
    for an in clips:
        for i, pi in an["pistas"].items():
            for camino in pi:
                usados.setdefault(i, set()).add(camino)
    for an in clips:
        d = an["duracion"]
        for i in range(len(esq.huesos)):
            pi = an["pistas"].setdefault(i, {})
            for camino in usados.get(i, set()) | {"rotation"}:
                if camino in pi:
                    continue
                v = {"rotation": (0.0, 0.0, 0.0, 1.0), "translation": esq.local(i), "scale": (1.0, 1.0, 1.0)}[camino]
                pi[camino] = [(0.0, v), (d, v)]
    return clips


def construir(pl, cambios=None, detalle=1.0, animado=True):
    """→ (Constructor, Esqueleto o None, clips, altura real)"""
    if isinstance(pl, str):
        pl = POR_ID[pl]
    cambios = dict(cambios or {})
    p = _aplicar(pl, cambios)
    rig = pl["rig"]
    esq, clips = None, []
    if rig == "humanoide":
        C, esq = humanoide_bloques(p, detalle) if p.get("estilo") == "bloques" else humanoide(p, detalle)
        if animado:
            clips = anim_humanoide(esq, 1.0, pl.get("estilo_anim", "normal"))
    elif rig == "cuadrupedo":
        C, esq = cuadrupedo_bloques(p, detalle) if p.get("estilo") == "bloques" else cuadrupedo(p, detalle)
        clips = anim_cuadrupedo(esq, p) if animado else []
    elif rig == "volador":
        C, esq = volador(p, detalle)
        clips = anim_volador(esq, p) if animado else []
    elif rig == "aracnido":
        C, esq = aracnido(p, detalle)
        clips = anim_aracnido(esq, p) if animado else []
    elif rig == "gota":
        C, esq = gota(p, detalle)
        clips = anim_gota(esq, p) if animado else []
    elif rig == "serpiente":
        C, esq = serpiente(p, detalle)
        clips = anim_serpiente(esq, p) if animado else []
    elif rig == "arma":
        C, esq = arma(pl["tipo"], p, detalle)
    elif rig == "objeto":
        C, esq = objeto(pl["tipo"], p, detalle)
    else:
        C, esq = escenario(pl["tipo"], p, detalle, semilla=int(hashlib.md5(json.dumps(cambios, sort_keys=True).encode()).hexdigest()[:4], 16) % 97 + 1)
    if not animado:
        esq = None
    mn, mx = C.caja_de()
    alto = max(1e-3, mx[1] - mn[1])
    objetivo = pl["altura"] * float(cambios.get("_escala") or 1.0)
    if rig in ("humanoide", "cuadrupedo", "aracnido", "gota", "serpiente", "volador", "escenario"):
        escalar(C, esq, clips, objetivo / alto)
    elif rig in ("arma", "objeto") and cambios.get("_escala"):
        escalar(C, esq, clips, float(cambios["_escala"]))
    if esq and clips:
        completar_clips(esq, clips)
    mn, mx = C.caja_de()
    return C, esq, clips, round(mx[1] - mn[1], 3)


def _nombre_archivo(t):
    t = unicodedata.normalize("NFKD", str(t or "Figura"))
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = re.sub(r"[^\w \-()]+", "", t).strip()
    return re.sub(r"\s+", " ", t)[:60] or "Figura"


def carpeta_creados(carpeta=None):
    if carpeta:
        return Path(carpeta)
    from . import biblioteca3d as B
    return B.carpeta() / "Noviq Creados"


INFO_PAQUETE = {"autor": "Noviq · figuras 3D propias", "licencia": "CC0 (creadas por ti con Noviq)", "fuente": "noviq",
                "nota": "Modelos 3D animados generados por el Estudio de juegos de Noviq. Úsalos en tus juegos sin restricciones."}


def miniatura(C, esq=None, clips=None, tam=256, fondo=None, pose="Idle", t=0.35, yaw=None):
    an = next((c for c in clips or [] if c["nombre"] == pose), None) if esq else None
    tris = G.triangulos_posados(C, esq, an, t if an else 0.0)
    return G.renderizar(tris, (tam, tam), yaw=-0.55 if yaw is None else yaw, pitch=0.25, fondo=fondo)


def guardar(pl, cambios=None, detalle=1.0, carpeta=None, nombre=None, descripcion="", forzar=False, animado=None):
    """Crea la figura y la guarda en la carpeta 3D (Noviq Creados/<Categoría>/): .glb + .png + .noviq.json.
    Si ya existe una idéntica, la reutiliza (no se duplican)."""
    if isinstance(pl, str):
        pl = POR_ID[pl]
    cambios = dict(cambios or {})
    animado = pl["rig"] not in ("arma", "objeto", "escenario") if animado is None else animado
    firma = hashlib.md5(json.dumps([pl["id"], cambios, round(float(detalle), 2), animado, VERSION_FIG], sort_keys=True).encode()).hexdigest()[:12]
    base = carpeta_creados(carpeta)
    dcat = base / "Bloques" / pl["cat"] if (cambios.get("_estilo") == "bloques" or pl.get("bloques")) else base / (pl.get("carpeta") or pl["cat"])
    dcat.mkdir(parents=True, exist_ok=True)
    info_paq = base / "_info.json"
    if not info_paq.exists():
        try:
            info_paq.write_text(json.dumps(INFO_PAQUETE, ensure_ascii=False, indent=1), encoding="utf-8")
        except OSError:
            pass
    nom = _nombre_archivo(nombre or pl["nombre"])
    # ¿ya existe la misma figura? (se reutiliza)
    for f in sorted(dcat.glob("*.noviq.json")):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        glb = f.with_name(f.name[:-len(".noviq.json")] + ".glb")
        if d.get("firma") == firma and glb.exists() and not forzar:
            return dict(d, ok=True, ruta=str(glb), miniatura_png=str(glb.with_suffix(".png")), reutilizado=True)
    destino = dcat / f"{nom}.glb"
    n = 2
    while destino.exists() and not forzar:
        destino = dcat / f"{nom} {n}.glb"
        n += 1
    C, esq, clips, alto = construir(pl, cambios, detalle, animado)
    extras = {"noviq": {"plantilla": pl["id"], "categoria": pl["cat"], "firma": firma}}
    nbytes = G.escribir_glb(str(destino), C, esq, clips, nombre=destino.stem, extras=extras)
    img = miniatura(C, esq, clips, 256, yaw=-0.9 if pl["rig"] == "arma" else None)
    png = destino.with_suffix(".png")
    img.save(png)
    rol = pl.get("rol") or "personaje"
    roles = [rol] + (["coleccionable"] if pl["rig"] == "objeto" and rol != "coleccionable" else [])
    ficha = {"noviq": VERSION_FIG, "firma": firma, "plantilla": pl["id"], "nombre": destino.stem, "categoria": pl["cat"], "rig": pl["rig"],
             "rol": rol, "roles": roles, "enemigo": bool(pl.get("enemigo")), "temas": list(pl.get("temas") or []), "altura": alto,
             "animaciones": [c["nombre"] for c in clips], "etiquetas": list(dict.fromkeys(_toks(" ".join(pl["claves"]) + " " + pl["en"] + " " + pl["nombre"]))),
             "triangulos": C.triangulos(), "bytes": nbytes, "cambios": cambios, "detalle": detalle, "descripcion": (descripcion or "")[:300],
             "creado": time.strftime("%Y-%m-%d %H:%M"), "en": pl["en"]}
    destino.with_name(destino.stem + ".noviq.json").write_text(json.dumps(ficha, ensure_ascii=False, indent=1), encoding="utf-8")
    # miniatura también para la galería de la biblioteca (así no hace falta dibujarla con WebGL)
    try:
        from . import biblioteca3d as B
        raiz = B.carpeta()
        rid = destino.relative_to(raiz).as_posix()
        import io
        b = io.BytesIO()
        img.save(b, "PNG")
        B.guardar_miniatura(hashlib.md5(rid.encode("utf-8")).hexdigest()[:16], b.getvalue())
        ficha["id"] = rid
    except Exception:
        pass
    return dict(ficha, ok=True, ruta=str(destino), miniatura_png=str(png), reutilizado=False)


def creados(carpeta=None):
    """Lista de las figuras creadas (por categoría)."""
    base = carpeta_creados(carpeta)
    out = []
    if not base.exists():
        return out
    for f in sorted(base.glob("**/*.noviq.json")):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        glb = f.with_name(f.name[:-len(".noviq.json")] + ".glb")
        if glb.exists():
            out.append(dict(d, ruta=str(glb), carpeta=f.parent.relative_to(base).as_posix(),
                            miniatura_png=str(glb.with_suffix(".png")) if glb.with_suffix(".png").exists() else ""))
    out.sort(key=lambda d: d.get("creado") or "", reverse=True)
    return out


def plantillas_publicas():
    """Catálogo para la interfaz: qué figuras sabe crear Noviq (con su estilo, categoría y temas)."""
    return [{"id": pl["id"], "nombre": pl["nombre"], "en": pl["en"], "categoria": pl.get("carpeta") or pl["cat"], "rig": pl["rig"],
             "bloques": bool(pl.get("bloques")), "animado": pl["rig"] not in ("arma", "objeto", "escenario"), "temas": pl.get("temas") or [],
             "enemigo": bool(pl.get("enemigo"))} for pl in PLANTILLAS]


def para_rol(tipo, texto="", tema=None, genero=None, forma=None):
    """Plantilla adecuada para un rol del juego. tipo: jugador | enemigo | jefe | npc | arma | coleccionable | decoracion | obstaculo."""
    if tipo == "enemigo" and forma and FORMA_A_PLANTILLA.get(forma):
        return POR_ID[FORMA_A_PLANTILLA[forma]]
    if tipo == "coleccionable" and forma and OBJETO_A_PLANTILLA.get(forma):
        return POR_ID[OBJETO_A_PLANTILLA[forma]]
    if tipo == "arma" and forma and ARMA_A_PLANTILLA.get(forma):
        return POR_ID[ARMA_A_PLANTILLA[forma]]
    cats = {"jugador": ["Personajes"], "enemigo": ["Enemigos", "Criaturas", "Voladores"], "jefe": ["Jefes"], "npc": ["NPC", "Personajes"],
            "arma": ["Armas"], "coleccionable": ["Coleccionables"], "decoracion": ["Decoracion"], "obstaculo": ["Obstaculos"]}.get(tipo, None)
    if texto:
        pl, _, pts = desde_texto(texto, cats)
        if pts >= 1.0:
            return pl
    cands = [pl for pl in PLANTILLAS if not cats or pl["cat"] in cats]
    if tipo == "enemigo":
        cands = [pl for pl in cands if pl.get("enemigo")]
    temas = {tema, genero} - {None}
    con_tema = [pl for pl in cands if temas & set(pl["temas"])]
    elegidos = con_tema or cands
    if not elegidos:
        return POR_ID["explorador"]
    # estable: la misma idea da el mismo resultado
    k = int(hashlib.md5(f"{tipo}|{texto}|{tema}".encode()).hexdigest()[:6], 16) % len(elegidos)
    return elegidos[k]


def a_proyecto(info, proyecto_dir, rol, registrar=True):
    """Copia una figura creada al proyecto del juego como ACTIVOS.modelos[rol] (con sus créditos).
    registrar=False: solo copia y devuelve la entrada (para registrar muchas de una vez con activos.escribir)."""
    import shutil
    from . import activos as A
    proyecto_dir = Path(proyecto_dir)
    dest = proyecto_dir / "assets" / "modelos" / f"{re.sub(r'[^A-Za-z0-9_]+', '_', rol)}.glb"
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(info["ruta"], dest)
    ent = {"id": info.get("id") or info["nombre"], "fuente": "noviq", "nombre": info["nombre"], "tipo": "modelo", "rol": rol,
           "licencia": "CC0 (creado con Noviq)", "autor": "Noviq · figuras 3D propias", "url": "", "fecha": time.strftime("%Y-%m-%d"),
           "archivo": dest.relative_to(proyecto_dir).as_posix(), "bytes": dest.stat().st_size, "animaciones": info.get("animaciones") or [],
           "categoria": info.get("categoria")}
    if registrar:
        A.registrar(proyecto_dir, ent)
    return ent
