# -*- coding: utf-8 -*-
"""🧊 Geometría 3D de Noviq (sin dependencias: solo Python + Pillow para las imágenes).

- Constructor: arma mallas suaves con primitivas (esferas/elipsoides, cápsulas, cilindros, cajas redondeadas, toros,
  tornos con costillas, extrusiones, rocas deformadas). Cada pieza va unida a un HUESO del esqueleto y tiene su
  material PBR (piel, tela, metal, madera, cristal, emisivo…). Los colores van por vértice con una oclusión suave.
- escribir_glb(): guarda un .glb (glTF 2.0) con malla con piel (skin), esqueleto y animaciones (clips con claves de
  rotación/posición/escala). Lo abren Three.js, Blender, Unity, Unreal y Godot.
- pose(): posa la malla en un instante de una animación (cinemática directa + piel rígida) para dibujarla.
- renderizar(): dibuja la malla en una imagen PNG (miniaturas, retratos, iconos y sprites 2D) con luz de estudio,
  especular, luz de borde y sombra suave, con antialiasing por sobremuestreo."""
import json
import math
import struct

# ───────────── Matemática mínima ─────────────


def v_add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def v_sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def v_mul(a, k):
    return (a[0] * k, a[1] * k, a[2] * k)


def v_dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def v_cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def v_len(a):
    return math.sqrt(v_dot(a, a))


def v_norm(a):
    ln = v_len(a)
    return (a[0] / ln, a[1] / ln, a[2] / ln) if ln > 1e-12 else (0.0, 1.0, 0.0)


def v_lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


def m_ident():
    return [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0]]


def m_mul(a, b):
    return [[a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j] + a[i][3] * b[3][j] for j in range(4)] for i in range(4)]


def m_trans(x, y, z):
    m = m_ident()
    m[0][3], m[1][3], m[2][3] = x, y, z
    return m


def m_escala(x, y, z):
    m = m_ident()
    m[0][0], m[1][1], m[2][2] = x, y, z
    return m


def m_rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return [[1, 0, 0, 0], [0, c, -s, 0], [0, s, c, 0], [0, 0, 0, 1]]


def m_rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return [[c, 0, s, 0], [0, 1, 0, 0], [-s, 0, c, 0], [0, 0, 0, 1]]


def m_rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return [[c, -s, 0, 0], [s, c, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]


def m_euler(rx=0.0, ry=0.0, rz=0.0):
    """Orden XYZ (igual que Three.js): R = Rx · Ry · Rz."""
    return m_mul(m_mul(m_rot_x(rx), m_rot_y(ry)), m_rot_z(rz))


def m_trs(t=(0, 0, 0), r=(0, 0, 0), s=(1, 1, 1)):
    return m_mul(m_mul(m_trans(*t), m_euler(*r)), m_escala(*s))


def m_punto(m, p):
    x, y, z = p
    return (m[0][0] * x + m[0][1] * y + m[0][2] * z + m[0][3], m[1][0] * x + m[1][1] * y + m[1][2] * z + m[1][3],
            m[2][0] * x + m[2][1] * y + m[2][2] * z + m[2][3])


def m_dir(m, d):
    x, y, z = d
    return (m[0][0] * x + m[0][1] * y + m[0][2] * z, m[1][0] * x + m[1][1] * y + m[1][2] * z, m[2][0] * x + m[2][1] * y + m[2][2] * z)


def m_normal(m):
    """Matriz 3x3 para normales (inversa transpuesta de la parte lineal)."""
    a = [[m[i][j] for j in range(3)] for i in range(3)]
    det = (a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
           + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]))
    if abs(det) < 1e-12:
        return [row[:] + [0.0] for row in a] + [[0, 0, 0, 1]]
    inv = [[(a[(j + 1) % 3][(i + 1) % 3] * a[(j + 2) % 3][(i + 2) % 3] - a[(j + 1) % 3][(i + 2) % 3] * a[(j + 2) % 3][(i + 1) % 3]) / det
            for j in range(3)] for i in range(3)]
    # inversa transpuesta
    return [[inv[j][i] for j in range(3)] + [0.0] for i in range(3)] + [[0, 0, 0, 1]]


def m_alinear_y(d):
    """Rotación que lleva +Y a la dirección d."""
    d = v_norm(d)
    y = (0.0, 1.0, 0.0)
    c = v_dot(y, d)
    if c > 0.99999:
        return m_ident()
    if c < -0.99999:
        return m_rot_x(math.pi)
    eje = v_norm(v_cross(y, d))
    ang = math.acos(max(-1.0, min(1.0, c)))
    x, yy, z = eje
    ca, sa, t = math.cos(ang), math.sin(ang), 1 - math.cos(ang)
    return [[t * x * x + ca, t * x * yy - sa * z, t * x * z + sa * yy, 0], [t * x * yy + sa * z, t * yy * yy + ca, t * yy * z - sa * x, 0],
            [t * x * z - sa * yy, t * yy * z + sa * x, t * z * z + ca, 0], [0, 0, 0, 1]]


def q_euler(rx=0.0, ry=0.0, rz=0.0):
    """Cuaternión (x, y, z, w) de ángulos de Euler en orden XYZ (como Three.js)."""
    c1, c2, c3 = math.cos(rx / 2), math.cos(ry / 2), math.cos(rz / 2)
    s1, s2, s3 = math.sin(rx / 2), math.sin(ry / 2), math.sin(rz / 2)
    return (s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3)


def q_matriz(q):
    x, y, z, w = q
    return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0], [0, 0, 0, 1]]


def q_norm(q):
    ln = math.sqrt(sum(c * c for c in q)) or 1.0
    return tuple(c / ln for c in q)


def color_lineal(hexa):
    """#rrggbb (sRGB) → (r, g, b) lineal 0-1."""
    h = str(hexa or "#888888").lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    try:
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    except ValueError:
        r = g = b = 136

    def lin(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin(r), lin(g), lin(b))


def a_srgb(c):
    c = max(0.0, c)
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def mezclar_hex(a, b, t):
    ca, cb = color_lineal(a), color_lineal(b)
    c = v_lerp(ca, cb, t)
    return "#" + "".join(f"{max(0, min(255, round(a_srgb(x) * 255))):02x}" for x in c)


def oscurecer(hexa, f):
    c = color_lineal(hexa)
    return "#" + "".join(f"{max(0, min(255, round(a_srgb(x * f) * 255))):02x}" for x in c)


# ───────────── Ruido (rocas, costillas, variación de color) ─────────────
def _hash3(ix, iy, iz, semilla):
    n = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + semilla * 144665) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0 * 2 - 1


def ruido3(x, y, z, semilla=0):
    ix, iy, iz = math.floor(x), math.floor(y), math.floor(z)
    fx, fy, fz = x - ix, y - iy, z - iz
    ux, uy, uz = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy), fz * fz * (3 - 2 * fz)
    res = 0.0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (ux if dx else 1 - ux) * (uy if dy else 1 - uy) * (uz if dz else 1 - uz)
                res += w * _hash3(ix + dx, iy + dy, iz + dz, semilla)
    return res


def fbm3(x, y, z, semilla=0, octavas=4):
    s, amp, fr, n = 0.0, 1.0, 1.0, 0.0
    for i in range(octavas):
        s += amp * ruido3(x * fr, y * fr, z * fr, semilla + i * 17)
        n += amp
        amp *= 0.5
        fr *= 2.03
    return s / n


# ───────────── Materiales PBR ─────────────
MATERIALES = {  # clave → (rugosidad, metalicidad, doble cara)
    "piel": (0.55, 0.0, False), "tela": (0.88, 0.0, False), "tela_doble": (0.85, 0.0, True), "cuero": (0.62, 0.0, False),
    "pelo": (0.78, 0.0, False), "metal": (0.32, 0.92, False), "oro": (0.22, 1.0, False), "madera": (0.82, 0.0, False),
    "piedra": (0.95, 0.0, False), "brillo": (0.12, 0.0, False), "cristal": (0.06, 0.15, False), "plastico": (0.42, 0.0, False),
    "hueso": (0.7, 0.0, False), "hoja": (0.7, 0.0, True), "goma": (0.9, 0.0, False), "emisivo": (0.5, 0.0, False),
}


def _mat(c, rot):
    """rot = (rx, ry, rz) en radianes, o una matriz 4x4 (lista de 4 filas) para orientaciones exactas."""
    if isinstance(rot, list) and len(rot) == 4:
        return m_mul(m_trans(*c), rot)
    return m_trs(c, rot)


# ejes: el largo de la pieza (y local) queda en +Z, el ancho (x local) en +Y y el grosor (z local) en X (hojas de armas)
EJE_ARMA = [[0, 0, 1, 0], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 1]]
# el largo (y local) en +Z, el ancho (x) en X y el grosor (z) en -Y (piezas planas acostadas: hachas de canto, etc.)
EJE_Z = [[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]]


# ───────────── Constructor de mallas ─────────────
class Grupo:
    __slots__ = ("pos", "nor", "col", "hue", "idx")

    def __init__(self):
        self.pos, self.nor, self.col, self.hue, self.idx = [], [], [], [], []


class Constructor:
    """Acumula piezas por material. hueso = índice del hueso al que va unida la pieza (piel rígida)."""

    def __init__(self, detalle=1.0, ao=True):
        self.grupos = {}  # (material, emisivo) → Grupo
        self.detalle = max(0.35, min(2.5, float(detalle)))
        self.ao = ao

    def _seg(self, n):
        return max(4, int(round(n * self.detalle)))

    def _grupo(self, mat, emisivo=None):
        k = (mat if mat in MATERIALES else "tela", emisivo or "")
        g = self.grupos.get(k)
        if g is None:
            g = self.grupos[k] = Grupo()
        return g

    def _agregar(self, verts, norms, tris, color, hueso, mat, emisivo=None, matriz=None, variacion=0.0, semilla=0):
        g = self._grupo(mat, emisivo)
        base = len(g.pos)
        nm = m_normal(matriz) if matriz else None
        col = color_lineal(color) if isinstance(color, str) else None
        funcion = callable(color)
        for i, p in enumerate(verts):
            n = norms[i]
            if matriz:
                p = m_punto(matriz, p)
                n = v_norm(m_dir(nm, n))
            g.pos.append(p)
            g.nor.append(n)
            c = color(p) if funcion else (color[i] if col is None else col)
            if isinstance(c, str):
                c = color_lineal(c)
            if variacion:
                f = 1.0 + variacion * ruido3(p[0] * 7.1, p[1] * 7.1, p[2] * 7.1, semilla)
                c = (c[0] * f, c[1] * f, c[2] * f)
            if self.ao and mat != "emisivo":
                f = 0.8 + 0.2 * (0.5 + 0.5 * n[1])
                c = (c[0] * f, c[1] * f, c[2] * f)
            g.col.append(c)
            g.hue.append(hueso)
        for a, b, c in tris:
            g.idx.extend((base + a, base + b, base + c))

    # — superficie hecha de anillos (con polos opcionales), normales suaves por acumulación —
    def _anillos(self, anillos, polo_ini=None, polo_fin=None, cerrar_v=False):
        verts, tris = [], []
        n = len(anillos[0])
        for an in anillos:
            verts.extend(an)
        R = len(anillos)
        filas = R if cerrar_v else R - 1
        for r in range(filas):
            r2 = (r + 1) % R
            for i in range(n):
                a, b = r * n + i, r * n + (i + 1) % n
                c, d = r2 * n + i, r2 * n + (i + 1) % n
                tris.append((a, c, b))
                tris.append((b, c, d))
        if polo_ini is not None:
            k = len(verts)
            verts.append(polo_ini)
            for i in range(n):
                tris.append((k, i, (i + 1) % n))
        if polo_fin is not None:
            k = len(verts)
            verts.append(polo_fin)
            o = (R - 1) * n
            for i in range(n):
                tris.append((k, o + (i + 1) % n, o + i))
        return verts, _normales(verts, tris), tris

    def esfera(self, c, r, color, mat="tela", hueso=0, rot=(0, 0, 0), seg=16, anillos=None, emisivo=None, deformar=None,
               variacion=0.0, corte=None):
        """Elipsoide de radios r=(rx, ry, rz). corte=(0-1): deja solo la parte superior (media esfera, cúpula…)."""
        if isinstance(r, (int, float)):
            r = (r, r, r)
        seg = self._seg(seg)
        an = self._seg(anillos or max(6, seg // 2))
        rings = []
        y_min = -1.0 if corte is None else 1 - 2 * corte
        for j in range(1, an):
            v = math.pi * j / an
            yy = -math.cos(v)
            if yy < y_min - 1e-9:
                continue
            s = math.sin(v)
            ring = []
            for i in range(seg):
                u = 2 * math.pi * i / seg
                p = (s * math.cos(u) * r[0], yy * r[1], s * math.sin(u) * r[2])
                if deformar:
                    p = deformar(p)
                ring.append(p)
            rings.append(ring)
        # polos (abajo → arriba). Con corte: la base queda cerrada con un polo plano
        polo_abajo = (0, -r[1], 0) if corte is None else (0, rings[0][0][1], 0)
        polo_arriba = (0, r[1], 0)
        if deformar:
            polo_arriba = deformar(polo_arriba)
            if corte is None:
                polo_abajo = deformar(polo_abajo)
        verts, norms, tris = self._anillos(rings, polo_abajo, polo_arriba)
        self._agregar(verts, norms, tris, color, hueso, mat, emisivo, _mat(c, rot), variacion)

    def capsula(self, a, b, ra, rb, color, mat="tela", hueso=0, seg=12, emisivo=None, achatar=1.0, variacion=0.0):
        """Cápsula (extremidades) de a hasta b con radios ra (en a) y rb (en b). achatar<1 la aplana de adelante a atrás."""
        seg = self._seg(seg)
        d = v_sub(b, a)
        L = v_len(d)
        rings = []
        cap = max(3, seg // 3)
        ring = lambda rr, y: [(rr * math.cos(2 * math.pi * i / seg), y, rr * math.sin(2 * math.pi * i / seg) * achatar) for i in range(seg)]
        for j in range(cap - 1, 0, -1):  # media esfera de abajo
            t = (j / cap) * (math.pi / 2)
            rings.append(ring(math.cos(t) * ra, -math.sin(t) * ra))
        for j in range(0, 3):
            f = j / 2
            rings.append(ring(ra + (rb - ra) * f, L * f))
        for j in range(1, cap):  # media esfera de arriba
            t = (j / cap) * (math.pi / 2)
            rings.append(ring(math.cos(t) * rb, L + math.sin(t) * rb))
        verts, norms, tris = self._anillos(rings, (0, -ra, 0), (0, L + rb, 0))
        m = m_mul(m_trans(*a), m_alinear_y(d))
        self._agregar(verts, norms, tris, color, hueso, mat, emisivo, m, variacion)

    def cilindro(self, a, b, ra, rb, color, mat="tela", hueso=0, seg=12, tapas=True, emisivo=None, anillos=1):
        seg = self._seg(seg)
        d = v_sub(b, a)
        L = v_len(d)
        rings = []
        for j in range(anillos + 1):
            f = j / anillos
            rr = ra + (rb - ra) * f
            rings.append([(rr * math.cos(2 * math.pi * i / seg), L * f, rr * math.sin(2 * math.pi * i / seg)) for i in range(seg)])
        verts, norms, tris = self._anillos(rings)
        # las normales del costado se corrigen para la pendiente del cono
        pend = (ra - rb) / max(L, 1e-6)
        norms = []
        for p in verts:
            rr = math.hypot(p[0], p[2])
            norms.append(v_norm((p[0] / rr, pend, p[2] / rr)) if rr > 1e-9 else (0.0, 1.0, 0.0))
        m = m_mul(m_trans(*a), m_alinear_y(d))
        self._agregar(verts, norms, tris, color, hueso, mat, emisivo, m)
        if tapas:
            for y, rr, s in ((0.0, ra, -1), (L, rb, 1)):
                if rr <= 1e-5:
                    continue
                vv = [(0, y, 0)] + [(rr * math.cos(2 * math.pi * i / seg), y, rr * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
                tt = [(0, 1 + (i + 1) % seg, 1 + i) if s > 0 else (0, 1 + i, 1 + (i + 1) % seg) for i in range(seg)]
                self._agregar(vv, [(0, s, 0)] * len(vv), tt, color, hueso, mat, emisivo, m)

    def cono(self, a, b, r, color, mat="tela", hueso=0, seg=12, emisivo=None):
        self.cilindro(a, b, r, 0.0, color, mat, hueso, seg, True, emisivo)

    def caja(self, c, medio, color, mat="tela", hueso=0, rot=(0, 0, 0), radio=0.0, seg=3, emisivo=None, variacion=0.0, deformar=None):
        """Caja (medio = medias dimensiones). radio>0 → bordes redondeados (se ve mucho más profesional)."""
        hx, hy, hz = medio
        radio = max(0.0, min(radio, hx * 0.98, hy * 0.98, hz * 0.98))
        n = 1 if radio <= 0 else self._seg(seg)
        caras = [((1, 0, 0), (0, 1, 0), (0, 0, 1)), ((-1, 0, 0), (0, 1, 0), (0, 0, -1)), ((0, 1, 0), (0, 0, 1), (1, 0, 0)),
                 ((0, -1, 0), (0, 0, -1), (1, 0, 0)), ((0, 0, 1), (1, 0, 0), (0, 1, 0)), ((0, 0, -1), (-1, 0, 0), (0, 1, 0))]
        verts, norms, tris = [], [], []
        ix, iy, iz = hx - radio, hy - radio, hz - radio
        for nrm, u, v in caras:
            k0 = len(verts)
            for j in range(n + 1):
                for i in range(n + 1):
                    s, t = -1 + 2 * i / n, -1 + 2 * j / n
                    q = (nrm[0] + u[0] * s + v[0] * t, nrm[1] + u[1] * s + v[1] * t, nrm[2] + u[2] * s + v[2] * t)
                    if radio > 0:
                        pq = (q[0] * hx, q[1] * hy, q[2] * hz)
                        inner = (max(-ix, min(ix, pq[0])), max(-iy, min(iy, pq[1])), max(-iz, min(iz, pq[2])))
                        dd = v_sub(pq, inner)
                        nn = v_norm(dd) if v_len(dd) > 1e-9 else nrm
                        p = v_add(inner, v_mul(nn, radio))
                    else:
                        p, nn = (q[0] * hx, q[1] * hy, q[2] * hz), nrm
                    if deformar:
                        p = deformar(p)
                    verts.append(p)
                    norms.append(nn)
            for j in range(n):
                for i in range(n):
                    a = k0 + j * (n + 1) + i
                    b, cc, d = a + 1, a + (n + 1), a + (n + 1) + 1
                    tris.append((a, b, d))
                    tris.append((a, d, cc))
        if deformar:
            norms = _normales(verts, tris)
        self._agregar(verts, norms, tris, color, hueso, mat, emisivo, _mat(c, rot), variacion)

    def toro(self, c, R, r, color, mat="tela", hueso=0, rot=(0, 0, 0), seg=16, seg_tubo=8, emisivo=None, arco=2 * math.pi):
        seg, st = self._seg(seg), self._seg(seg_tubo)
        completo = arco >= 2 * math.pi - 1e-6
        rings = []
        cnt = seg if completo else seg + 1
        for j in range(cnt):
            u = arco * j / seg
            ring = []
            for i in range(st):
                v = -2 * math.pi * i / st
                ring.append(((R + r * math.cos(v)) * math.cos(u), r * math.sin(v), (R + r * math.cos(v)) * math.sin(u)))
            rings.append(ring)
        verts, norms, tris = self._anillos(rings, cerrar_v=completo)
        self._agregar(verts, norms, tris, color, hueso, mat, emisivo, _mat(c, rot))

    def torno(self, c, perfil, color, mat="tela", hueso=0, rot=(0, 0, 0), seg=16, radial=None, emisivo=None, escala=(1, 1, 1),
              cerrar=True, variacion=0.0):
        """Superficie de revolución. perfil = [(radio, y), …] de abajo hacia arriba. radial(u, y) → factor del radio
        (ej. costillas de una calabaza)."""
        seg = self._seg(seg)
        rings = []
        for rr, y in perfil:
            ring = []
            for i in range(seg):
                u = 2 * math.pi * i / seg
                f = radial(u, y) if radial else 1.0
                ring.append((rr * f * math.cos(u) * escala[0], y * escala[1], rr * f * math.sin(u) * escala[2]))
            rings.append(ring)
        pi = (0, perfil[0][1] * escala[1], 0) if cerrar and perfil[0][0] > 1e-6 else None
        pf = (0, perfil[-1][1] * escala[1], 0) if cerrar and perfil[-1][0] > 1e-6 else None
        verts, norms, tris = self._anillos(rings, pi, pf)
        self._agregar(verts, norms, tris, color, hueso, mat, emisivo, _mat(c, rot), variacion)

    def extruir(self, c, poligono, grosor, color, mat="tela", hueso=0, rot=(0, 0, 0), emisivo=None, bisel=0.0):
        """Polígono 2D (x, y) extruido en z (hojas de espada, estrellas, corazones, carteles). bisel: afila los bordes."""
        n = len(poligono)
        area = sum(poligono[i][0] * poligono[(i + 1) % n][1] - poligono[(i + 1) % n][0] * poligono[i][1] for i in range(n))
        if area < 0:
            poligono = poligono[::-1]
        tri2 = _triangular(poligono)
        h = grosor / 2
        verts, norms, tris = [], [], []
        cx = sum(p[0] for p in poligono) / n
        cy = sum(p[1] for p in poligono) / n
        for z, s in ((h, 1), (-h, -1)):
            k = len(verts)
            for x, y in poligono:
                if bisel:
                    x, y = x + (cx - x) * bisel, y + (cy - y) * bisel
                verts.append((x, y, z))
                norms.append((0, 0, s))
            for a, b, cc in tri2:
                tris.append((k + a, k + b, k + cc) if s > 0 else (k + a, k + cc, k + b))
        for i in range(n):
            j = (i + 1) % n
            (x0, y0), (x1, y1) = poligono[i], poligono[j]
            nn = v_norm((y1 - y0, -(x1 - x0), 0))
            k = len(verts)
            zf = h * (0.15 if bisel else 1)
            verts += [(x0, y0, zf), (x1, y1, zf), (x1, y1, -zf), (x0, y0, -zf)]
            norms += [nn] * 4
            tris += [(k, k + 2, k + 1), (k, k + 3, k + 2)]
            if bisel:  # caras en ángulo entre el borde y la cara
                for s in (1, -1):
                    ia, ib = (x0 + (cx - x0) * bisel, y0 + (cy - y0) * bisel), (x1 + (cx - x1) * bisel, y1 + (cy - y1) * bisel)
                    k = len(verts)
                    nb = v_norm((nn[0], nn[1], s * 0.9))
                    verts += [(x0, y0, zf * s), (x1, y1, zf * s), (ib[0], ib[1], h * s), (ia[0], ia[1], h * s)]
                    norms += [nb] * 4
                    tris += [(k, k + 1, k + 2), (k, k + 2, k + 3)] if s > 0 else [(k, k + 2, k + 1), (k, k + 3, k + 2)]
        self._agregar(verts, norms, tris, color, hueso, mat, emisivo, _mat(c, rot))

    # caras de un cubo: normal, eje u, eje v (u × v = normal)
    _CARAS = {"+z": ((0, 0, 1), (1, 0, 0), (0, 1, 0)), "-z": ((0, 0, -1), (-1, 0, 0), (0, 1, 0)), "+x": ((1, 0, 0), (0, 0, -1), (0, 1, 0)),
              "-x": ((-1, 0, 0), (0, 0, 1), (0, 1, 0)), "+y": ((0, 1, 0), (1, 0, 0), (0, 0, -1)), "-y": ((0, -1, 0), (1, 0, 0), (0, 0, 1))}

    def cubo(self, c, tam, color, hueso=0, rot=(0, 0, 0), pix=8, ruido=0.07, mat="tela", semilla=0, emisivo=None, dibujos=None, paleta=None,
             caras=None):
        """Bloque de estilo vóxel con «píxeles» en cada cara (cada píxel un cuadrado de color propio, como las texturas pixel art).
        tam=(ancho, alto, fondo). pix = píxeles por metro·8 (8 → un píxel cada 1/8 del lado mayor de 0.46 m).
        dibujos={"+z": ["filas", …]} dibuja pixel art en una cara con la paleta {letra: color} ('.' = color base).
        caras={"+y": color}: color base distinto en una cara. color puede ser una función (x, y, z) → color (camuflaje)."""
        sx, sy, sz = tam
        h = (sx / 2, sy / 2, sz / 2)
        M = _mat(c, rot)
        paleta = paleta or {}
        base_f = color if callable(color) else None
        verts, norms, cols, tris = [], [], [], []
        dens = pix / 0.46
        for cara, (n, u, v) in self._CARAS.items():
            hu = abs(u[0]) * h[0] + abs(u[1]) * h[1] + abs(u[2]) * h[2]
            hv = abs(v[0]) * h[0] + abs(v[1]) * h[1] + abs(v[2]) * h[2]
            hn = abs(n[0]) * h[0] + abs(n[1]) * h[1] + abs(n[2]) * h[2]
            dib = (dibujos or {}).get(cara)
            if dib:
                ny, nx = len(dib), len(dib[0])
            else:
                nx, ny = max(1, round(2 * hu * dens)), max(1, round(2 * hv * dens))
            base_cara = (caras or {}).get(cara, color)
            for j in range(ny):
                for i in range(nx):
                    u0, u1 = -hu + 2 * hu * i / nx, -hu + 2 * hu * (i + 1) / nx
                    v1, v0 = hv - 2 * hv * j / ny, hv - 2 * hv * (j + 1) / ny
                    k = len(verts)
                    for uu, vv in ((u0, v0), (u1, v0), (u1, v1), (u0, v1)):
                        verts.append((n[0] * hn + u[0] * uu + v[0] * vv, n[1] * hn + u[1] * uu + v[1] * vv, n[2] * hn + u[2] * uu + v[2] * vv))
                        norms.append(n)
                    letra = dib[j][i] if dib else "."
                    ccol = paleta.get(letra) if letra != "." else None
                    if ccol is None:
                        if base_f and base_cara is color:
                            cm = ((u0 + u1) / 2, (v0 + v1) / 2)
                            local = (n[0] * hn + u[0] * cm[0] + v[0] * cm[1], n[1] * hn + u[1] * cm[0] + v[1] * cm[1], n[2] * hn + u[2] * cm[0] + v[2] * cm[1])
                            ccol = base_f(m_punto(M, local))
                        else:
                            ccol = base_cara
                    cl = color_lineal(ccol) if isinstance(ccol, str) else ccol
                    if ruido and letra in (".",) + tuple(paleta.get("_ruido", "")):
                        f = 1.0 + ruido * (2 * _hash01(i * 7 + j * 131 + len(cara) * 17 + ord(cara[1]) * 3, semilla) - 1)
                        cl = (cl[0] * f, cl[1] * f, cl[2] * f)
                    cols += [cl] * 4
                    tris += [(k, k + 1, k + 2), (k, k + 2, k + 3)]
        self._agregar(verts, norms, tris, cols, hueso, mat, emisivo, M)

    def lamina(self, c, espina, filo, grosor, color, mat="metal", hueso=0, rot=(0, 0, 0), emisivo=None, bisel=0.45):
        """Hoja con sección en cuña entre dos curvas 2D (x, y) del mismo largo: espina (lomo, grueso) y filo (fino), con
        bisel marcado. grosor: número o lista por punto. Hoces, guadañas, sables, hachas, garras, aletas…"""
        n = len(espina)
        gs = list(grosor) if isinstance(grosor, (list, tuple)) else [grosor] * n
        bis = [(espina[i][0] + (filo[i][0] - espina[i][0]) * (1 - bisel), espina[i][1] + (filo[i][1] - espina[i][1]) * (1 - bisel)) for i in range(n)]
        V, Nn, T = [], [], []
        e0 = 0.0006

        def superficie(vs, ts, deseo):
            buenos = []
            for t in ts:
                a, b, cc = vs[t[0]], vs[t[1]], vs[t[2]]
                nt = v_cross(v_sub(b, a), v_sub(cc, a))
                if v_dot(nt, deseo(t)) < 0:
                    t = (t[0], t[2], t[1])
                buenos.append(t)
            k = len(V)
            V.extend(vs)
            Nn.extend(_normales(vs, buenos))
            T.extend((a + k, b + k, cc + k) for a, b, cc in buenos)

        def tira(fa, fb, deseo):
            ts = []
            for i in range(n - 1):
                ts += [(i, i + 1, n + i + 1), (i, n + i + 1, n + i)]
            superficie(fa + fb, ts, lambda t: deseo(t[0] % n))
        for sz in (1, -1):
            lomo = [(espina[i][0], espina[i][1], sz * gs[i] / 2) for i in range(n)]
            bev = [(bis[i][0], bis[i][1], sz * gs[i] * 0.4) for i in range(n)]
            fil = [(filo[i][0], filo[i][1], sz * e0) for i in range(n)]
            tira(lomo, bev, lambda i, sz=sz: (0, 0, sz))
            tira(bev, fil, lambda i, sz=sz: (0, 0, sz))

        def fuera(i):
            d = v_sub((espina[i][0], espina[i][1], 0), (filo[i][0], filo[i][1], 0))
            return v_norm(d)
        tira([(espina[i][0], espina[i][1], gs[i] / 2) for i in range(n)], [(espina[i][0], espina[i][1], -gs[i] / 2) for i in range(n)], fuera)
        tira([(filo[i][0], filo[i][1], e0) for i in range(n)], [(filo[i][0], filo[i][1], -e0) for i in range(n)], lambda i: v_mul(fuera(i), -1))
        for i, sgn in ((0, -1), (n - 1, 1)):
            j = 1 if i == 0 else n - 2
            tang = v_mul(v_norm((espina[i][0] - espina[j][0], espina[i][1] - espina[j][1], 0)), 1)
            poly = [(espina[i][0], espina[i][1], gs[i] / 2), (bis[i][0], bis[i][1], gs[i] * 0.4), (filo[i][0], filo[i][1], e0),
                    (filo[i][0], filo[i][1], -e0), (bis[i][0], bis[i][1], -gs[i] * 0.4), (espina[i][0], espina[i][1], -gs[i] / 2)]
            superficie(poly, [(0, k, k + 1) for k in range(1, 5)], lambda t, tang=tang: tang)
        self._agregar(V, Nn, T, color, hueso, mat, emisivo, _mat(c, rot))

    def roca(self, c, r, color, hueso=0, semilla=1, rot=(0, 0, 0), aspereza=0.28, seg=14, mat="piedra"):
        rr = r if isinstance(r, (tuple, list)) else (r, r, r)

        def deformar(p):
            n = v_norm(p)
            f = 1 + aspereza * fbm3(n[0] * 1.7 + semilla, n[1] * 1.7, n[2] * 1.7, semilla, 4)
            f += 0.08 * max(0.0, fbm3(n[0] * 5 + 3, n[1] * 5, n[2] * 5, semilla + 5, 2))
            q = v_mul(p, f)
            return (q[0], max(q[1], -rr[1] * 0.55), q[2])  # base plana para apoyarla en el suelo
        self.esfera(c, rr, color, mat, hueso, rot, seg, deformar=deformar, variacion=0.18)

    def plano(self, c, ancho, alto, color, mat="tela_doble", hueso=0, rot=(0, 0, 0), curva=0.0, div=4, emisivo=None, ondas=0.0):
        """Plano (capas, alas, banderas, hojas) en XY, opcionalmente curvado hacia atrás."""
        verts, tris = [], []
        nx, ny = div, div
        for j in range(ny + 1):
            for i in range(nx + 1):
                x = -ancho / 2 + ancho * i / nx
                y = -alto * j / ny
                z = -curva * (x / (ancho / 2 or 1)) ** 2 - ondas * math.sin(j / ny * math.pi * 2 + i)
                verts.append((x, y, z))
        for j in range(ny):
            for i in range(nx):
                a = j * (nx + 1) + i
                tris += [(a, a + 1, a + nx + 2), (a, a + nx + 2, a + nx + 1)]
        self._agregar(verts, _normales(verts, tris), tris, color, hueso, mat, emisivo, _mat(c, rot))

    # utilidades
    def caja_de(self):
        mn, mx = [1e9] * 3, [-1e9] * 3
        for g in self.grupos.values():
            for p in g.pos:
                for k in range(3):
                    mn[k] = min(mn[k], p[k])
                    mx[k] = max(mx[k], p[k])
        return mn, mx

    def triangulos(self):
        return sum(len(g.idx) // 3 for g in self.grupos.values())


def _hash01(i, semilla=0):
    x = (i * 374761393 + semilla * 668265263) & 0xFFFFFFFF
    x = ((x ^ (x >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((x ^ (x >> 16)) & 0xFFFF) / 65535.0


def _normales(verts, tris):
    acc = [[0.0, 0.0, 0.0] for _ in verts]
    for a, b, c in tris:
        n = v_cross(v_sub(verts[b], verts[a]), v_sub(verts[c], verts[a]))
        for k in (a, b, c):
            acc[k][0] += n[0]
            acc[k][1] += n[1]
            acc[k][2] += n[2]
    return [v_norm(tuple(n)) for n in acc]


def _triangular(poly):
    """Triangulación por orejas de un polígono simple (antihorario)."""
    idx = list(range(len(poly)))
    tris = []

    def convexo(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 1e-12

    def dentro(p, a, b, c):
        d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1])
        d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1])
        d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1])
        neg, pos = d1 < 0 or d2 < 0 or d3 < 0, d1 > 0 or d2 > 0 or d3 > 0
        return not (neg and pos)
    guardia = 0
    while len(idx) > 3 and guardia < 10000:
        guardia += 1
        hecho = False
        for k in range(len(idx)):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            a, b, c = poly[i0], poly[i1], poly[i2]
            if not convexo(a, b, c):
                continue
            if any(dentro(poly[j], a, b, c) for j in idx if j not in (i0, i1, i2)):
                continue
            tris.append((i0, i1, i2))
            idx.pop(k)
            hecho = True
            break
        if not hecho:  # polígono raro: abanico
            for k in range(1, len(idx) - 1):
                tris.append((idx[0], idx[k], idx[k + 1]))
            return tris
    if len(idx) == 3:
        tris.append(tuple(idx))
    return tris


# ───────────── Esqueleto y animaciones ─────────────
class Esqueleto:
    def __init__(self):
        self.huesos = []  # {"nombre", "padre", "pos": posición global en reposo}
        self._i = {}

    def hueso(self, nombre, pos, padre=None):
        pi = self._i[padre] if isinstance(padre, str) else (-1 if padre is None else padre)
        self._i[nombre] = len(self.huesos)
        self.huesos.append({"nombre": nombre, "padre": pi, "pos": tuple(pos)})
        return self._i[nombre]

    def __getitem__(self, nombre):
        return self._i[nombre]

    def __contains__(self, nombre):
        return nombre in self._i

    def local(self, i):
        h = self.huesos[i]
        if h["padre"] < 0:
            return h["pos"]
        return v_sub(h["pos"], self.huesos[h["padre"]]["pos"])


def clip(esq, nombre, duracion, pose_fn, claves=16, bucle=True):
    """Muestrea pose_fn(fase 0-1) → {hueso: {"r": (rx, ry, rz), "p": (dx, dy, dz), "s": (sx, sy, sz)}} y arma el clip."""
    pistas = {}
    n = claves
    for k in range(n + 1):
        f = k / n
        if bucle and k == n:
            f = 0.0
        pose = pose_fn(f)
        t = duracion * k / n
        for hn, tr in pose.items():
            if hn not in esq:
                continue
            i = esq[hn]
            pi = pistas.setdefault(i, {})
            if "r" in tr:
                pi.setdefault("rotation", []).append((t, q_norm(q_euler(*tr["r"]))))
            if "p" in tr:
                base = esq.local(i)
                pi.setdefault("translation", []).append((t, v_add(base, tr["p"])))
            if "s" in tr:
                pi.setdefault("scale", []).append((t, tuple(tr["s"])))
    # todas las pistas de rotación de un hueso deben tener las mismas claves: se completan con reposo si faltan
    for i, pi in pistas.items():
        for camino, ident in (("rotation", (0, 0, 0, 1)), ("translation", None), ("scale", (1, 1, 1))):
            if camino in pi and len(pi[camino]) != n + 1:
                vistos = {round(t, 6): v for t, v in pi[camino]}
                pi[camino] = [(duracion * k / n, vistos.get(round(duracion * k / n, 6), ident if ident else esq.local(i))) for k in range(n + 1)]
    return {"nombre": nombre, "duracion": duracion, "pistas": pistas, "bucle": bucle}


def _valor(pista, t):
    """Interpola una pista [(t, valor)] en el instante t (lineal; los cuaterniones con nlerp)."""
    if t <= pista[0][0]:
        return pista[0][1]
    for k in range(1, len(pista)):
        t1, v1 = pista[k]
        if t <= t1:
            t0, v0 = pista[k - 1]
            f = (t - t0) / max(t1 - t0, 1e-9)
            if len(v0) == 4:
                d = sum(a * b for a, b in zip(v0, v1))
                v1b = v1 if d >= 0 else tuple(-x for x in v1)
                return q_norm(tuple(a + (b - a) * f for a, b in zip(v0, v1b)))
            return tuple(a + (b - a) * f for a, b in zip(v0, v1))
    return pista[-1][1]


def matrices_pose(esq, animacion=None, t=0.0):
    """Matrices de piel (global_animada · inversa_de_reposo) de cada hueso en el instante t."""
    glob = []
    for i, h in enumerate(esq.huesos):
        pos, rot, esc = esq.local(i), (0, 0, 0, 1), (1, 1, 1)
        if animacion and i in animacion["pistas"]:
            pi = animacion["pistas"][i]
            if "translation" in pi:
                pos = _valor(pi["translation"], t)
            if "rotation" in pi:
                rot = _valor(pi["rotation"], t)
            if "scale" in pi:
                esc = _valor(pi["scale"], t)
        loc = m_mul(m_mul(m_trans(*pos), q_matriz(rot)), m_escala(*esc))
        glob.append(loc if h["padre"] < 0 else m_mul(glob[h["padre"]], loc))
    return [m_mul(g, m_trans(*v_mul(esq.huesos[i]["pos"], -1))) for i, g in enumerate(glob)]


def triangulos_posados(cons, esq=None, animacion=None, t=0.0):
    """[(p0, p1, p2, n0, n1, n2, color, material, emisivo)] con la pose aplicada (piel rígida)."""
    mats = matrices_pose(esq, animacion, t) if esq else None
    nms = [m_normal(m) for m in mats] if mats else None
    out = []
    for (mat, emi), g in cons.grupos.items():
        if mats:
            P = [m_punto(mats[h], p) for p, h in zip(g.pos, g.hue)]
            N = [v_norm(m_dir(nms[h], n)) for n, h in zip(g.nor, g.hue)]
        else:
            P, N = g.pos, g.nor
        for k in range(0, len(g.idx), 3):
            a, b, c = g.idx[k], g.idx[k + 1], g.idx[k + 2]
            out.append((P[a], P[b], P[c], N[a], N[b], N[c], g.col[a], mat, emi))
    return out


# ───────────── Escritura GLB (glTF 2.0) ─────────────
def escribir_glb(ruta, cons, esq=None, animaciones=None, nombre="Modelo", extras=None):
    """Guarda la malla (con esqueleto y animaciones si hay) como .glb. Devuelve los bytes escritos."""
    datos = bytearray()
    vistas, accesorios = [], []

    def alinear():
        while len(datos) % 4:
            datos.append(0)

    def vista(b, objetivo=None):
        alinear()
        v = {"buffer": 0, "byteOffset": len(datos), "byteLength": len(b)}
        if objetivo:
            v["target"] = objetivo
        datos.extend(b)
        vistas.append(v)
        return len(vistas) - 1

    def acc_float(vals, tipo, objetivo=34962, minmax=False):
        comp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[tipo]
        plano = [float(x) for v in vals for x in (v if comp > 1 else (v,))]
        a = {"bufferView": vista(struct.pack("<%df" % len(plano), *plano), objetivo), "componentType": 5126, "count": len(vals), "type": tipo}
        if minmax:
            if comp == 1:
                a["min"], a["max"] = [min(vals)], [max(vals)]
            else:
                a["min"] = [min(v[k] for v in vals) for k in range(comp)]
                a["max"] = [max(v[k] for v in vals) for k in range(comp)]
        accesorios.append(a)
        return len(accesorios) - 1

    prims, materiales = [], []
    hay_piel = esq is not None and len(esq.huesos) > 0
    for (mat, emi), g in cons.grupos.items():
        if not g.idx:
            continue
        rug, met, doble = MATERIALES.get(mat, MATERIALES["tela"])
        m = {"name": f"{mat}{'_' + emi.lstrip('#') if emi else ''}", "pbrMetallicRoughness": {
            "baseColorFactor": [1, 1, 1, 1], "metallicFactor": met, "roughnessFactor": rug}}
        if doble:
            m["doubleSided"] = True
        if emi:
            m["emissiveFactor"] = list(color_lineal(emi))
        materiales.append(m)
        attrs = {"POSITION": acc_float(g.pos, "VEC3", minmax=True), "NORMAL": acc_float(g.nor, "VEC3"),
                 "COLOR_0": acc_float([(max(0.0, min(1.0, c[0])), max(0.0, min(1.0, c[1])), max(0.0, min(1.0, c[2])), 1.0) for c in g.col], "VEC4")}
        if hay_piel:
            jb = bytearray()
            for h in g.hue:
                jb.extend(struct.pack("<4B", h, 0, 0, 0))
            accesorios.append({"bufferView": vista(bytes(jb), 34962), "componentType": 5121, "count": len(g.hue), "type": "VEC4"})
            attrs["JOINTS_0"] = len(accesorios) - 1
            attrs["WEIGHTS_0"] = acc_float([(1.0, 0.0, 0.0, 0.0)] * len(g.hue), "VEC4")
        big = len(g.pos) > 65535
        ib = struct.pack(("<%dI" if big else "<%dH") % len(g.idx), *g.idx)
        accesorios.append({"bufferView": vista(ib, 34963), "componentType": 5125 if big else 5123, "count": len(g.idx), "type": "SCALAR"})
        prims.append({"attributes": attrs, "indices": len(accesorios) - 1, "material": len(materiales) - 1, "mode": 4})

    nodos = [{"name": nombre, "children": []}]
    malla_nodo = {"name": nombre + "_malla", "mesh": 0}
    gltf = {"asset": {"version": "2.0", "generator": "Noviq figuras 3D"}, "scene": 0, "scenes": [{"name": nombre, "nodes": [0]}],
            "nodes": nodos, "meshes": [{"name": nombre, "primitives": prims}], "materials": materiales, "accessors": accesorios,
            "bufferViews": vistas, "buffers": [{"byteLength": 0}]}
    if extras:
        nodos[0]["extras"] = extras
    if hay_piel:
        base = len(nodos)
        for i, h in enumerate(esq.huesos):
            nd = {"name": h["nombre"], "translation": list(esq.local(i))}
            nodos.append(nd)
        for i, h in enumerate(esq.huesos):
            if h["padre"] >= 0:
                nodos[base + h["padre"]].setdefault("children", []).append(base + i)
            else:
                nodos[0]["children"].append(base + i)
        ibm = []
        for h in esq.huesos:  # reposo sin rotaciones: la inversa es solo trasladar al revés
            x, y, z = h["pos"]
            ibm.append((1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1))  # columna mayor
        ibm_acc = acc_float(ibm, "MAT4", objetivo=None)
        raiz = [base + i for i, h in enumerate(esq.huesos) if h["padre"] < 0]
        gltf["skins"] = [{"name": nombre + "_esqueleto", "joints": [base + i for i in range(len(esq.huesos))],
                          "inverseBindMatrices": ibm_acc, "skeleton": raiz[0]}]
        malla_nodo["skin"] = 0
        if animaciones:
            anims = []
            for an in animaciones:
                canales, samplers = [], []
                cache_t = {}
                for i, pi in an["pistas"].items():
                    for camino, claves in pi.items():
                        ts = tuple(round(t, 5) for t, _ in claves)
                        if ts not in cache_t:
                            cache_t[ts] = acc_float(list(ts), "SCALAR", objetivo=None, minmax=True)
                        tipo = "VEC4" if camino == "rotation" else "VEC3"
                        out = acc_float([v for _, v in claves], tipo, objetivo=None)
                        samplers.append({"input": cache_t[ts], "output": out, "interpolation": "LINEAR"})
                        canales.append({"sampler": len(samplers) - 1, "target": {"node": base + i, "path": camino}})
                if canales:
                    anims.append({"name": an["nombre"], "samplers": samplers, "channels": canales})
            if anims:
                gltf["animations"] = anims
    nodos.append(malla_nodo)
    nodos[0]["children"].append(len(nodos) - 1)
    alinear()
    gltf["buffers"][0]["byteLength"] = len(datos)
    js = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    while len(js) % 4:
        js += b" "
    total = 12 + 8 + len(js) + 8 + len(datos)
    out = struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(js), b"JSON") + js + struct.pack("<I4s", len(datos), b"BIN\x00") + bytes(datos)
    with open(ruta, "wb") as f:
        f.write(out)
    return len(out)


def _aces(x):
    x = max(0.0, x)
    return max(0.0, min(1.0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)))


# ───────────── Render por software (miniaturas, retratos, iconos, sprites) ─────────────
def renderizar(tris, tam=(256, 256), yaw=-0.55, pitch=0.28, fondo=None, sobremuestreo=3, margen=0.1, sombra=True,
               luz=(-0.45, 0.8, 0.55), encuadre=None, perspectiva=0.0, brillo=1.0, contorno=None, **extra):
    """Render de calidad (z-buffer, sombras propias, oclusión ambiental: render3d con numpy). Sin numpy, o con simple=True,
    usa el render básico con Pillow. extra: ao, sombras_propias, estilo ('realista' | 'cel'), luz_borde, exposicion."""
    simple = extra.pop("simple", False)
    if not simple:
        try:
            from . import render3d
        except ImportError:
            render3d = None
        if render3d:
            return render3d.renderizar(tris, tam, yaw, pitch, fondo, sobremuestreo, margen, sombra, luz, encuadre, perspectiva, brillo,
                                       contorno, **extra)
    return _renderizar_pil(tris, tam, yaw, pitch, fondo, sobremuestreo, margen, sombra, luz, encuadre, perspectiva, brillo, contorno)


def _renderizar_pil(tris, tam=(256, 256), yaw=-0.55, pitch=0.28, fondo=None, sobremuestreo=3, margen=0.1, sombra=True,
                    luz=(-0.45, 0.8, 0.55), encuadre=None, perspectiva=0.0, brillo=1.0, contorno=None):
    """Dibuja triángulos (de triangulos_posados) en una imagen RGBA. encuadre=(cx, cy, escala) fija la cámara (para que
    todos los cuadros de un sprite queden alineados); si no, se ajusta al modelo."""
    from PIL import Image, ImageDraw, ImageFilter
    W, H = tam
    S = max(1, int(sobremuestreo))
    cy_, sy_ = math.cos(yaw), math.sin(yaw)
    cp, sp = math.cos(pitch), math.sin(pitch)

    def vista(p):
        x, y, z = p
        x, z = x * cy_ + z * sy_, -x * sy_ + z * cy_
        y, z = y * cp - z * sp, y * sp + z * cp
        return (x, y, z)

    def vista_dir(n):
        return vista(n)
    L = v_norm(luz)
    Lv = v_norm(vista_dir(L))
    relleno = v_norm(vista_dir((0.6, 0.25, -0.2)))
    proy = []
    xs, ys = [], []
    for t in tris:
        a, b, c = vista(t[0]), vista(t[1]), vista(t[2])
        proy.append((a, b, c, t))
        xs += [a[0], b[0], c[0]]
        ys += [a[1], b[1], c[1]]
    if not proy:
        return Image.new("RGBA", (W, H), (0, 0, 0, 0))
    if encuadre:
        cx, cy, esc = encuadre
    else:
        cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        esc = min(W * (1 - 2 * margen) / max(1e-6, max(xs) - min(xs)), H * (1 - 2 * margen) / max(1e-6, max(ys) - min(ys)))
    img = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    zmin = min(min(a[2], b[2], c[2]) for a, b, c, _ in proy)
    zmax = max(max(a[2], b[2], c[2]) for a, b, c, _ in proy)

    def pant(p):
        f = 1.0
        if perspectiva:
            f = 1.0 / max(0.3, 1 - perspectiva * (p[2] - (zmin + zmax) / 2) / max(1e-6, zmax - zmin))
        return ((W / 2 + (p[0] - cx) * esc * f) * S, (H / 2 - (p[1] - cy) * esc * f) * S)
    if sombra:
        ymin = min(min(t[0][1], t[1][1], t[2][1]) for t in tris)
        umbral = ymin + 0.05 * (max(ys) - min(ys) + 1e-6)
        pts = [(p[0], p[2]) for t in tris for p in t[:3] if p[1] < umbral] or [(0, 0)]
        sx = [q[0] for q in pts]
        sz = [q[1] for q in pts]
        ccx, ccz = (min(sx) + max(sx)) / 2, (min(sz) + max(sz)) / 2
        ext = max(max(p[0] for t in tris for p in t[:3]) - min(p[0] for t in tris for p in t[:3]),
                  max(p[2] for t in tris for p in t[:3]) - min(p[2] for t in tris for p in t[:3]), 1e-3)
        rx = min(ext * 0.6, max(0.15 * ext, (max(sx) - min(sx)) / 2 + 0.08 * ext) * 1.1)
        rz = min(ext * 0.5, max(0.12 * ext, (max(sz) - min(sz)) / 2 + 0.07 * ext))
        sombra_img = Image.new("L", img.size, 0)
        ds = ImageDraw.Draw(sombra_img)
        poly = []
        for k in range(24):
            u = 2 * math.pi * k / 24
            poly.append(pant(vista((ccx + rx * math.cos(u), ymin, ccz + rz * math.sin(u)))))
        ds.polygon(poly, fill=110)
        sombra_img = sombra_img.filter(ImageFilter.GaussianBlur(6 * S))
        negro = Image.new("RGBA", img.size, (10, 12, 18, 255))
        img = Image.composite(negro, img, sombra_img)
        dr = ImageDraw.Draw(img)
    # triángulos grandes en pantalla se subdividen para que la luz se vea suave (normales interpoladas)
    finos = []
    for a, b, c, t in proy:
        (ax, ay), (bx, by), (cx2, cy2) = pant(a), pant(b), pant(c)
        area = abs((bx - ax) * (cy2 - ay) - (by - ay) * (cx2 - ax)) / (2 * S * S)
        niv = 0 if area < 40 else 1 if area < 260 else 2 if area < 1400 else 3
        if niv == 0:
            finos.append((a, b, c, v_norm(v_add(v_add(t[3], t[4]), t[5])), t))
            continue
        n = 2 ** niv
        P = lambda i, j: v_add(v_add(v_mul(a, 1 - (i + j) / n), v_mul(b, i / n)), v_mul(c, j / n))
        N = lambda i, j: v_add(v_add(v_mul(t[3], 1 - (i + j) / n), v_mul(t[4], i / n)), v_mul(t[5], j / n))
        for i in range(n):
            for j in range(n - i):
                finos.append((P(i, j), P(i + 1, j), P(i, j + 1), v_norm(v_add(v_add(N(i, j), N(i + 1, j)), N(i, j + 1))), t))
                if i + j < n - 1:
                    finos.append((P(i + 1, j), P(i + 1, j + 1), P(i, j + 1), v_norm(v_add(v_add(N(i + 1, j), N(i + 1, j + 1)), N(i, j + 1))), t))
    finos.sort(key=lambda q: (q[0][2] + q[1][2] + q[2][2]))  # de atrás hacia adelante (z hacia la cámara es mayor)
    V = (0.0, 0.0, 1.0)
    for a, b, c, nmed, t in finos:
        e1, e2 = v_sub(b, a), v_sub(c, a)
        nz = e1[0] * e2[1] - e1[1] * e2[0]
        n = v_norm(vista_dir(nmed))
        mat = t[7]
        doble = MATERIALES.get(mat, MATERIALES["tela"])[2]
        if nz <= 0 and not doble:
            continue  # cara de espaldas
        if nz <= 0 and doble:
            n = v_mul(n, -1)
        rug, met, _ = MATERIALES.get(mat, MATERIALES["tela"])
        col = t[6]
        dif = max(0.0, v_dot(n, Lv))
        fill = max(0.0, v_dot(n, relleno)) * 0.35
        amb = 0.32 + 0.18 * (0.5 + 0.5 * n[1])
        Hh = v_norm(v_add(Lv, V))
        brillo_esp = (1 - rug) ** 2
        esp = (max(0.0, v_dot(n, Hh)) ** (8 + 120 * (1 - rug))) * (0.15 + 1.6 * brillo_esp)
        borde_l = (1 - max(0.0, n[2])) ** 3 * 0.35
        k_d = (1 - met * 0.85)
        r_ = col[0] * (amb + dif * 1.05 + fill) * k_d + esp * (col[0] if met > 0.5 else 1.0) + borde_l * 0.6
        g_ = col[1] * (amb + dif * 1.05 + fill) * k_d + esp * (col[1] if met > 0.5 else 1.0) + borde_l * 0.65
        b_ = col[2] * (amb + dif * 1.05 + fill) * k_d + esp * (col[2] if met > 0.5 else 1.0) + borde_l * 0.8
        if met > 0.5:  # reflejo del «cielo» del estudio
            refl = 0.25 + 0.35 * (0.5 + 0.5 * n[1])
            r_, g_, b_ = r_ + col[0] * refl, g_ + col[1] * refl, b_ + col[2] * refl
        if t[8]:
            ec = color_lineal(t[8])
            r_, g_, b_ = r_ + ec[0] * 1.2, g_ + ec[1] * 1.2, b_ + ec[2] * 1.2
        r_, g_, b_ = r_ * brillo, g_ * brillo, b_ * brillo
        rgb = tuple(max(0, min(255, int(255 * a_srgb(_aces(x * 0.9)) + 0.5))) for x in (r_, g_, b_))  # tono ACES
        pa, pb, pc = pant(a), pant(b), pant(c)
        dr.polygon([pa, pb, pc], fill=rgb + (255,), outline=rgb + (255,))
    if contorno:
        alfa = img.getchannel("A")
        grueso = alfa.filter(ImageFilter.MaxFilter(1 + 2 * max(1, S)))
        fondo_c = Image.new("RGBA", img.size, contorno + (255,) if len(contorno) == 3 else contorno)
        base = Image.new("RGBA", img.size, (0, 0, 0, 0))
        base.paste(fondo_c, mask=grueso)
        base.alpha_composite(img)
        img = base
    img = img.resize((W, H), Image.LANCZOS)
    if fondo is not None:
        fondo_img = fondo if hasattr(fondo, "size") else Image.new("RGBA", (W, H), fondo)
        fondo_img = fondo_img.copy().convert("RGBA")
        fondo_img.alpha_composite(img)
        img = fondo_img
    return img


def encuadre_de(tris_lista, tam, yaw=-0.55, pitch=0.28, margen=0.1):
    """Encuadre común para varios cuadros (sprites alineados)."""
    cy_, sy_ = math.cos(yaw), math.sin(yaw)
    cp, sp = math.cos(pitch), math.sin(pitch)
    xs, ys = [], []
    for tris in tris_lista:
        for t in tris:
            for p in t[:3]:
                x, y, z = p
                x, z = x * cy_ + z * sy_, -x * sy_ + z * cy_
                y = y * cp - z * sp
                xs.append(x)
                ys.append(y)
    W, H = tam
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    esc = min(W * (1 - 2 * margen) / max(1e-6, max(xs) - min(xs)), H * (1 - 2 * margen) / max(1e-6, max(ys) - min(ys)))
    return (cx, cy, esc)
