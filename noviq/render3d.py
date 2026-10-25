"""Render por software de alta calidad (numpy): z-buffer, sombreado por píxel (Phong/GGX aproximado), sombras propias
(mapa de sombras), oclusión ambiental en pantalla (SSAO), luz de borde, sombra proyectada en el suelo y antialiasing por
sobremuestreo. Lo usan las miniaturas, retratos, iconos y hojas de sprites que crea Noviq (docs/3D y docs/2D).
Si numpy no está instalado, geo3d.renderizar usa el render simple con Pillow."""
import math

import numpy as np
from PIL import Image, ImageFilter

from . import geo3d as G

_TAMS = np.array([1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512, 768, 1024, 1536, 2048, 3072, 4096])


def _rot_vista(yaw, pitch):
    cy_, sy_ = math.cos(yaw), math.sin(yaw)
    cp, sp = math.cos(pitch), math.sin(pitch)
    # x' = x cy + z sy ; z' = -x sy + z cy ; luego y'' = y cp - z' sp ; z'' = y sp + z' cp
    Ry = np.array([[cy_, 0, sy_], [0, 1, 0], [-sy_, 0, cy_]])
    Rx = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]])
    return Rx @ Ry


def _base_luz(L):
    """Rotación que lleva la dirección de la luz a +z (la «cámara» de la luz mira hacia -L)."""
    z = np.asarray(L, float)
    z = z / np.linalg.norm(z)
    a = np.array([0.0, 1.0, 0.0]) if abs(z[1]) < 0.95 else np.array([1.0, 0.0, 0.0])
    x = np.cross(a, z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    return np.stack([x, y, z])


def _rasterizar(X, Y, Z, W, H, max_muestras=3_000_000):
    """X, Y, Z: (N, 3) coordenadas de pantalla (píxeles, y hacia abajo) y profundidad (mayor = más cerca).
    → (id del triángulo, b1, b2, profundidad) por píxel (id = -1 si vacío)."""
    ids = np.full(W * H, -1, np.int64)
    prof = np.full(W * H, -np.inf)
    B1 = np.zeros(W * H)
    B2 = np.zeros(W * H)
    if len(X) == 0:
        return ids, B1, B2, prof
    x0, x1, x2 = X[:, 0], X[:, 1], X[:, 2]
    y0, y1, y2 = Y[:, 0], Y[:, 1], Y[:, 2]
    area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
    xmin = np.clip(np.floor(np.minimum(np.minimum(x0, x1), x2) - 0.5), 0, W - 1).astype(np.int64)
    xmax = np.clip(np.ceil(np.maximum(np.maximum(x0, x1), x2) - 0.5), 0, W - 1).astype(np.int64)
    ymin = np.clip(np.floor(np.minimum(np.minimum(y0, y1), y2) - 0.5), 0, H - 1).astype(np.int64)
    ymax = np.clip(np.ceil(np.maximum(np.maximum(y0, y1), y2) - 0.5), 0, H - 1).astype(np.int64)
    fuera = (np.maximum(np.maximum(x0, x1), x2) < 0) | (np.minimum(np.minimum(x0, x1), x2) > W) | \
            (np.maximum(np.maximum(y0, y1), y2) < 0) | (np.minimum(np.minimum(y0, y1), y2) > H)
    validos = (np.abs(area) > 1e-9) & ~fuera
    bw = xmax - xmin + 1
    bh = ymax - ymin + 1
    kw = np.searchsorted(_TAMS, bw)
    kh = np.searchsorted(_TAMS, bh)
    kw = np.minimum(kw, len(_TAMS) - 1)
    kh = np.minimum(kh, len(_TAMS) - 1)
    clave = kw * 64 + kh
    for k in np.unique(clave[validos]):
        sel = np.nonzero(validos & (clave == k))[0]
        BW, BH = int(_TAMS[k // 64]), int(_TAMS[k % 64])
        oy, ox = np.divmod(np.arange(BW * BH), BW)
        paso = max(1, max_muestras // (BW * BH))
        for i in range(0, len(sel), paso):
            t = sel[i:i + paso]
            px = xmin[t][:, None] + ox[None, :]
            py = ymin[t][:, None] + oy[None, :]
            dentro_bb = (px <= xmax[t][:, None]) & (py <= ymax[t][:, None])
            cx = px + 0.5
            cy = py + 0.5
            a = area[t][:, None]
            dx0, dy0 = cx - x0[t][:, None], cy - y0[t][:, None]
            w1 = (dx0 * (y2[t][:, None] - y0[t][:, None]) - (x2[t][:, None] - x0[t][:, None]) * dy0) / a
            w2 = ((x1[t][:, None] - x0[t][:, None]) * dy0 - dx0 * (y1[t][:, None] - y0[t][:, None])) / a
            w0 = 1 - w1 - w2
            e = -1e-7
            m = dentro_bb & (w0 >= e) & (w1 >= e) & (w2 >= e)
            if not m.any():
                continue
            fila, col = np.nonzero(m)
            tt = t[fila]
            pix = py[fila, col] * W + px[fila, col]
            b1 = w1[fila, col]
            b2 = w2[fila, col]
            z = Z[tt, 0] * (1 - b1 - b2) + Z[tt, 1] * b1 + Z[tt, 2] * b2
            # el más cercano de este lote por píxel, y luego contra el búfer
            orden = np.lexsort((-z, pix))
            ps = pix[orden]
            primero = np.ones(len(ps), bool)
            primero[1:] = ps[1:] != ps[:-1]
            o = orden[primero]
            pix, z, tt, b1, b2 = pix[o], z[o], tt[o], b1[o], b2[o]
            gana = z > prof[pix]
            pix = pix[gana]
            prof[pix] = z[gana]
            ids[pix] = tt[gana]
            B1[pix] = b1[gana]
            B2[pix] = b2[gana]
    return ids, B1, B2, prof


def _desenfocar(a, r):
    """Desenfoque de caja separable (r en píxeles) con sumas acumuladas."""
    if r < 1:
        return a
    r = int(r)
    p = np.pad(a, r, mode="edge")
    c = np.cumsum(p, axis=0)
    c = np.vstack([np.zeros((1, c.shape[1])), c])
    v = (c[2 * r + 1:] - c[:-2 * r - 1]) / (2 * r + 1)
    c = np.cumsum(v, axis=1)
    c = np.hstack([np.zeros((c.shape[0], 1)), c])
    return (c[:, 2 * r + 1:] - c[:, :-2 * r - 1]) / (2 * r + 1)


def _aces(x):
    x = np.maximum(x, 0.0)
    return np.clip((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0)


def _srgb(c):
    c = np.maximum(c, 0.0)
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def renderizar(tris, tam=(256, 256), yaw=-0.55, pitch=0.28, fondo=None, sobremuestreo=3, margen=0.1, sombra=True,
               luz=(-0.45, 0.8, 0.55), encuadre=None, perspectiva=0.0, brillo=1.0, contorno=None, ao=True, sombras_propias=True,
               estilo="realista", luz_borde=None, exposicion=1.0):
    """Mismos parámetros que geo3d.renderizar + ao (oclusión ambiental), sombras_propias, estilo ('realista' | 'cel' para
    sombreado por bandas tipo dibujo animado), luz_borde=(r, g, b) color de la luz de contra (retratos)."""
    W, H = tam
    S = max(1, int(sobremuestreo))
    WS, HS = W * S, H * S
    if not tris:
        return Image.new("RGBA", (W, H), (0, 0, 0, 0))
    N = len(tris)
    P = np.array([[t[0], t[1], t[2]] for t in tris], float)          # (N, 3, 3) mundo
    NN = np.array([[t[3], t[4], t[5]] for t in tris], float)         # normales
    COL = np.array([t[6] for t in tris], float)                       # color lineal
    mats = [t[7] for t in tris]
    info = np.array([G.MATERIALES.get(m, G.MATERIALES["tela"]) for m in mats], dtype=object)
    RUG = np.array([float(x[0]) for x in info])
    MET = np.array([float(x[1]) for x in info])
    DOB = np.array([bool(x[2]) for x in info])
    EMI = np.array([G.color_lineal(t[8]) if t[8] else (0.0, 0.0, 0.0) for t in tris], float)
    R = _rot_vista(yaw, pitch)
    V = P @ R.T                                                        # vista: x derecha, y arriba, z hacia la cámara
    NV = NN @ R.T
    xs, ys = V[:, :, 0], V[:, :, 1]
    if encuadre:
        cx, cy, esc = encuadre
    else:
        cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
        esc = min(W * (1 - 2 * margen) / max(1e-6, xs.max() - xs.min()), H * (1 - 2 * margen) / max(1e-6, ys.max() - ys.min()))
    zmin, zmax = V[:, :, 2].min(), V[:, :, 2].max()
    f = 1.0
    if perspectiva:
        f = 1.0 / np.maximum(0.3, 1 - perspectiva * (V[:, :, 2] - (zmin + zmax) / 2) / max(1e-6, zmax - zmin))
    SX = (W / 2 + (xs - cx) * esc * f) * S
    SY = (H / 2 - (ys - cy) * esc * f) * S
    # caras de espaldas (las de doble cara se dibujan con la normal invertida)
    e1 = V[:, 1] - V[:, 0]
    e2 = V[:, 2] - V[:, 0]
    nz = e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]
    visible = (nz > 0) | DOB
    idx_vis = np.nonzero(visible)[0]
    ids, B1, B2, prof = _rasterizar(SX[idx_vis], SY[idx_vis], V[idx_vis, :, 2], WS, HS)
    lleno = ids >= 0
    img = np.zeros((HS * WS, 4))
    if lleno.any():
        tid = idx_vis[ids[lleno]]
        b1 = B1[lleno][:, None]
        b2 = B2[lleno][:, None]
        b0 = 1 - b1 - b2
        n = NV[tid, 0] * b0 + NV[tid, 1] * b1 + NV[tid, 2] * b2
        n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
        atras = (nz[tid] <= 0)
        n[atras] *= -1
        # normales suavizadas que miran «hacia adentro» en la silueta: se enderezan un poco
        n[:, 2] = np.maximum(n[:, 2], -0.2)
        n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
        pos_m = P[tid, 0] * b0 + P[tid, 1] * b1 + P[tid, 2] * b2      # posición en el mundo (para la sombra)
        col = COL[tid]
        rug, met = RUG[tid][:, None], MET[tid][:, None]
        Lw = np.asarray(luz, float) / np.linalg.norm(luz)
        Lv = R @ Lw
        relleno = R @ (np.array([0.6, 0.25, -0.2]) / np.linalg.norm([0.6, 0.25, -0.2]))
        # sombras propias: mapa de profundidad desde la luz (PCF 3×3)
        somb = np.ones(len(tid))
        if sombras_propias and N > 8:
            BL = _base_luz(Lw)
            PL = P @ BL.T
            lx, ly = PL[:, :, 0], PL[:, :, 1]
            RES = int(max(128, min(512, max(W, H) * S * 1.1)))
            ext = max(lx.max() - lx.min(), ly.max() - ly.min(), 1e-6)
            k = (RES - 4) / ext
            LX = (lx - lx.min()) * k + 2
            LY = (ly.max() - ly) * k + 2
            lid, _, _, lprof = _rasterizar(LX, LY, PL[:, :, 2], RES, RES)
            lprof = lprof.reshape(RES, RES)
            q = pos_m @ BL.T
            qx = (q[:, 0] - lx.min()) * k + 2
            qy = (ly.max() - q[:, 1]) * k + 2
            sesgo = 0.012 * ext + 0.0025 * ext * (1 - np.clip(n @ Lv, 0, 1))
            acc = np.zeros(len(tid))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    ix = np.clip((qx + dx).astype(np.int64), 0, RES - 1)
                    iy = np.clip((qy + dy).astype(np.int64), 0, RES - 1)
                    acc += (q[:, 2] + sesgo >= lprof[iy, ix]).astype(float)
            somb = 0.25 + 0.75 * acc / 9.0
        ndl = np.clip(n @ Lv, 0, 1)
        if estilo == "cel":
            ndl = np.where(ndl > 0.55, 1.0, np.where(ndl > 0.12, 0.6, 0.18))
        dif = ndl * somb
        fill = np.clip(n @ relleno, 0, 1) * 0.35
        amb = 0.3 + 0.2 * (0.5 + 0.5 * n[:, 1])                       # cielo arriba, suelo abajo
        # oclusión ambiental en pantalla: los píxeles rodeados de superficies más cercanas a la cámara se oscurecen
        occ = np.ones(len(tid))
        if ao:
            D = np.where(lleno, prof, np.nan).reshape(HS, WS)
            dmin = np.nanmin(D) if np.isfinite(np.nanmin(D)) else 0
            Dz = np.nan_to_num(D, nan=dmin)
            escala_z = (zmax - zmin) or 1.0
            o = np.zeros_like(Dz)
            for r in (max(1, int(3 * S)), max(2, int(8 * S))):
                Db = _desenfocar(Dz, r)
                o += np.clip((Db - Dz) / (0.08 * escala_z), 0, 1)
            occ = (1 - 0.45 * np.clip(o / 2, 0, 1)).reshape(-1)[lleno]
        Vv = np.array([0.0, 0.0, 1.0])
        Hh = (Lv + Vv) / np.linalg.norm(Lv + Vv)
        brillo_esp = (1 - rug[:, 0]) ** 2
        esp = np.clip(n @ Hh, 0, 1) ** (8 + 120 * (1 - rug[:, 0])) * (0.15 + 1.6 * brillo_esp) * somb
        if estilo == "cel":
            esp = np.where(esp > 0.35, 0.6, 0.0)
        borde = (1 - np.clip(n[:, 2], 0, 1)) ** 3 * 0.35
        k_d = 1 - met * 0.85
        luz_tot = (amb[:, None] * occ[:, None] + dif[:, None] * 1.05 + fill[:, None] * occ[:, None])
        rgb = col * luz_tot * k_d
        es_met = (met[:, 0] > 0.5)[:, None]
        rgb += esp[:, None] * np.where(es_met, col, 1.0)
        bc = np.array(luz_borde, float) if luz_borde is not None else np.array([0.6, 0.65, 0.8])
        rgb += borde[:, None] * bc[None, :] * occ[:, None]
        refl = (0.25 + 0.35 * (0.5 + 0.5 * n[:, 1]))[:, None]
        rgb += np.where(es_met, col * refl * occ[:, None], 0.0)
        rgb += EMI[tid] * 1.2
        rgb *= brillo * exposicion
        rgb = _srgb(_aces(rgb * 0.9))
        img[lleno, :3] = rgb
        img[lleno, 3] = 1.0
    arr = (np.clip(img.reshape(HS, WS, 4), 0, 1) * 255 + 0.5).astype(np.uint8)
    capa = Image.fromarray(arr, "RGBA")
    if sombra:
        capa = _sombra_suelo(capa, P, R, cx, cy, esc, W, H, S, perspectiva, solo_contacto=(sombra == "contacto"))
    if contorno:
        alfa = capa.getchannel("A")
        grueso = alfa.filter(ImageFilter.MaxFilter(1 + 2 * max(1, S)))
        fondo_c = Image.new("RGBA", capa.size, contorno + (255,) if len(contorno) == 3 else contorno)
        base = Image.new("RGBA", capa.size, (0, 0, 0, 0))
        base.paste(fondo_c, mask=grueso)
        base.alpha_composite(capa)
        capa = base
    capa = capa.resize((W, H), Image.LANCZOS)
    if fondo is not None:
        fondo_img = fondo if hasattr(fondo, "size") else Image.new("RGBA", (W, H), fondo)
        fondo_img = fondo_img.copy().convert("RGBA").resize((W, H))
        fondo_img.alpha_composite(capa)
        capa = fondo_img
    return capa


def _sombra_suelo(capa, P, R, cx, cy, esc, W, H, S, perspectiva, solo_contacto=False):
    """Sombra de contacto (elipse suave) + sombra proyectada de la figura sobre el suelo (luz casi cenital)."""
    from PIL import ImageDraw
    pts = P.reshape(-1, 3)
    ymin = pts[:, 1].min()
    alto = pts[:, 1].max() - ymin + 1e-6
    if alto < 1e-4:
        return capa
    WS, HS = capa.size
    if solo_contacto:
        mask = Image.new("L", capa.size, 0)
    else:  # silueta proyectada (con el mismo rasterizador, a media resolución)
        Ls = np.array([-0.28, 1.0, 0.32])
        proy = P - Ls[None, None, :] * ((P[:, :, 1] - ymin) / Ls[1])[:, :, None]
        proy[:, :, 1] = ymin
        V = proy @ R.T
        X = (W / 2 + (V[:, :, 0] - cx) * esc) * S / 2
        Y = (H / 2 - (V[:, :, 1] - cy) * esc) * S / 2
        w2, h2 = max(1, WS // 2), max(1, HS // 2)
        ids, _, _, _ = _rasterizar(X, Y, np.zeros_like(X), w2, h2)
        m = ((ids >= 0).reshape(h2, w2) * 90).astype(np.uint8)
        mask = Image.fromarray(m, "L").resize(capa.size, Image.BILINEAR)
    # contacto: los puntos cerca del piso
    bajo = pts[pts[:, 1] < ymin + 0.06 * alto]
    if len(bajo):
        cxz = (bajo[:, [0, 2]].min(0) + bajo[:, [0, 2]].max(0)) / 2
        rx = max((bajo[:, 0].max() - bajo[:, 0].min()) / 2 + 0.05 * alto, 0.08 * alto)
        rz = max((bajo[:, 2].max() - bajo[:, 2].min()) / 2 + 0.05 * alto, 0.06 * alto)
        poly = []
        for k in range(28):
            u = 2 * math.pi * k / 28
            p = np.array([cxz[0] + rx * math.cos(u), ymin, cxz[1] + rz * math.sin(u)]) @ R.T
            poly.append(((W / 2 + (p[0] - cx) * esc) * S, (H / 2 - (p[1] - cy) * esc) * S))
        c2 = Image.new("L", capa.size, 0)
        ImageDraw.Draw(c2).polygon(poly, fill=150)
        c2 = c2.filter(ImageFilter.GaussianBlur(3 * S))
        mask = Image.fromarray(np.maximum(np.asarray(mask), np.asarray(c2)))
    mask = mask.filter(ImageFilter.GaussianBlur(2.5 * S))
    negro = Image.new("RGBA", capa.size, (8, 10, 16, 0))
    negro.putalpha(mask)
    negro.alpha_composite(capa)
    return negro
