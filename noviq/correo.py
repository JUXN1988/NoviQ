# -*- coding: utf-8 -*-
"""✉ Correo para la IA: enviar y leer sin abrir el navegador ni mirar la pantalla.

Cuentas (⚙ Ajustes → 📱 Telegram y correo); las contraseñas van cifradas en la bóveda (DPAPI):
- gmail:    smtp.gmail.com:465 / imap.gmail.com:993 con una «contraseña de aplicación» de Google (myaccount.google.com/apppasswords,
            requiere verificación en 2 pasos). No sirve la contraseña normal.
- hotmail:  Outlook.com / Hotmail / Live: smtp-mail.outlook.com:587 (STARTTLS). Microsoft está retirando el acceso con
            contraseña (error «5.7.30 Basic authentication is not supported»): si pasa, Noviq envía con Outlook de escritorio
            si está instalado; si no, la IA lo hace desde tu Chrome con la sesión abierta (agente_navegador).
- outlook_app: el Outlook clásico instalado en Windows (PowerShell + COM), con la cuenta que ya tiene configurada. Sin claves.
- smtp:     cualquier servidor (empresa, cooperativa, hosting): servidor, puerto, SSL/STARTTLS, usuario y clave.

Enviar SIEMPRE pasa por la guardia: te llega a Noviq y a Telegram el destinatario, asunto y texto para ✅ aprobar o ❌ rechazar."""
import email
import email.utils
import imaplib
import json
import mimetypes
import re
import smtplib
import ssl
import subprocess
import time
import uuid
from email.header import decode_header, make_header
from email.message import EmailMessage
from pathlib import Path

from .config import CONFIG, IS_WINDOWS, NO_WINDOW, save_config

PRESETS = {
    "gmail": {"nombre": "Gmail", "smtp": "smtp.gmail.com", "puerto_smtp": 465, "seguridad": "ssl", "imap": "imap.gmail.com", "puerto_imap": 993,
              "ayuda": "Usa una contraseña de aplicación: myaccount.google.com/apppasswords (necesita la verificación en 2 pasos)."},
    "hotmail": {"nombre": "Hotmail / Outlook.com", "smtp": "smtp-mail.outlook.com", "puerto_smtp": 587, "seguridad": "starttls",
                "imap": "outlook.office365.com", "puerto_imap": 993,
                "ayuda": "Microsoft está quitando el acceso con contraseña; si falla, se envía con Outlook de escritorio o desde tu Chrome."},
    "outlook_app": {"nombre": "Outlook de escritorio", "ayuda": "Usa el Outlook clásico instalado con tu cuenta ya iniciada (no pide clave)."},
    "smtp": {"nombre": "Correo de empresa (SMTP)", "smtp": "", "puerto_smtp": 587, "seguridad": "starttls", "imap": "", "puerto_imap": 993,
             "ayuda": "Pide a sistemas el servidor SMTP/IMAP, el puerto y si usa SSL o STARTTLS."},
}


def _cfg():
    c = CONFIG.get("correo")
    return c if isinstance(c, dict) else {"cuentas": [], "predeterminada": ""}


def cuentas():
    return list(_cfg().get("cuentas") or [])


def cuenta(cid=None):
    cs = cuentas()
    if not cs:
        return None
    cid = cid or _cfg().get("predeterminada")
    if cid:
        for c in cs:
            if c["id"] == cid or c.get("correo", "").lower() == str(cid).lower() or c.get("tipo") == cid:
                return c
    return cs[0]


def guardar_cuenta(d):
    """Crea o actualiza una cuenta. La clave va a la bóveda (no a config.json)."""
    from . import vault
    c = _cfg()
    cs = c.setdefault("cuentas", [])
    cid = d.get("id") or uuid.uuid4().hex[:8]
    tipo = d.get("tipo") if d.get("tipo") in PRESETS else "smtp"
    base = {k: v for k, v in PRESETS[tipo].items() if k not in ("nombre", "ayuda")}
    nueva = dict(base, id=cid, tipo=tipo, correo=(d.get("correo") or "").strip(), nombre=(d.get("nombre") or "").strip(),
                 usuario=(d.get("usuario") or d.get("correo") or "").strip())
    for k in ("smtp", "imap", "seguridad"):
        if d.get(k):
            nueva[k] = str(d[k]).strip()
    for k in ("puerto_smtp", "puerto_imap"):
        if d.get(k):
            nueva[k] = int(d[k])
    viejo = next((x for x in cs if x["id"] == cid), None)
    if viejo:
        cs[cs.index(viejo)] = nueva
    else:
        cs.append(nueva)
    if d.get("clave") and "•" not in d["clave"] and "…" not in d["clave"]:
        vault.set_secreto(f"correo_{cid}", d["clave"].strip() if tipo != "gmail" else d["clave"].replace(" ", ""))
    if d.get("predeterminada") or not c.get("predeterminada"):
        c["predeterminada"] = cid
    CONFIG["correo"] = c
    save_config()
    return nueva


def quitar_cuenta(cid):
    from . import vault
    c = _cfg()
    c["cuentas"] = [x for x in c.get("cuentas") or [] if x["id"] != cid]
    if c.get("predeterminada") == cid:
        c["predeterminada"] = c["cuentas"][0]["id"] if c["cuentas"] else ""
    vault.set_secreto(f"correo_{cid}", "")
    CONFIG["correo"] = c
    save_config()


def publico():
    from . import vault
    return {"cuentas": [dict(x, tiene_clave=bool(vault.get_secreto(f"correo_{x['id']}"))) for x in cuentas()],
            "predeterminada": _cfg().get("predeterminada", ""),
            "presets": {k: {"nombre": v["nombre"], "ayuda": v["ayuda"]} for k, v in PRESETS.items()},
            "outlook_instalado": outlook_disponible()}


# ───────────── Outlook de escritorio (COM) ─────────────
def _ps(script, timeout=120):
    r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
                        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n$ErrorActionPreference='Stop'\n" + script],
                       capture_output=True, timeout=timeout, creationflags=NO_WINDOW)
    out = r.stdout.decode("utf-8", "replace").strip()
    if r.returncode != 0:
        raise RuntimeError((r.stderr.decode("utf-8", "replace").strip().splitlines() or ["Outlook no respondió"])[-1][:300])
    return out


def outlook_disponible():
    if not IS_WINDOWS:
        return False
    try:
        from .perfil_windows import perfil
        return "Outlook" in (perfil().get("office") or {})
    except Exception:
        return False


def _ps_json(obj):
    """Datos para PowerShell sin problemas de comillas: JSON en base64."""
    import base64
    b = base64.b64encode(json.dumps(obj, ensure_ascii=False).encode("utf-8")).decode()
    return f"$D = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{b}')) | ConvertFrom-Json"


def enviar_outlook(para, asunto, cuerpo, cc=None, adjuntos=None, html=False, desde=None):
    ps = _ps_json({"para": para, "cc": cc or "", "asunto": asunto, "cuerpo": cuerpo, "adjuntos": [str(a) for a in adjuntos or []],
                   "html": bool(html), "desde": desde or ""}) + r"""
$o = New-Object -ComObject Outlook.Application
$m = $o.CreateItem(0)
$m.To = $D.para; if ($D.cc) { $m.CC = $D.cc }; $m.Subject = $D.asunto
if ($D.html) { $m.HTMLBody = $D.cuerpo } else { $m.Body = $D.cuerpo }
foreach ($a in $D.adjuntos) { [void]$m.Attachments.Add($a) }
if ($D.desde) { foreach ($acc in $o.Session.Accounts) { if ($acc.SmtpAddress -eq $D.desde) { $m.SendUsingAccount = $acc } } }
$m.Send()
'OK'
"""
    return _ps(ps)


def leer_outlook(cantidad=10, solo_no_leidos=False, buscar=None):
    ps = _ps_json({"n": int(cantidad), "nl": bool(solo_no_leidos), "q": buscar or ""}) + r"""
$o = New-Object -ComObject Outlook.Application
$f = $o.Session.GetDefaultFolder(6)
$items = $f.Items; $items.Sort('[ReceivedTime]', $true)
$k = 0
foreach ($i in $items) {
  if ($k -ge $D.n) { break }
  if ($D.nl -and -not $i.UnRead) { continue }
  if ($D.q -and ($i.Subject + ' ' + $i.SenderName + ' ' + $i.Body) -notlike "*$($D.q)*") { continue }
  $k++
  $b = ($i.Body -replace '\s+', ' '); if ($b.Length -gt 400) { $b = $b.Substring(0, 400) + '…' }
  "$($i.ReceivedTime.ToString('yyyy-MM-dd HH:mm'))|$($i.SenderName) <$($i.SenderEmailAddress)>|$($i.Subject)|$(if ($i.UnRead) {'no leído'} else {''})|$b"
}
"""
    return _ps(ps)


# ───────────── SMTP / IMAP ─────────────
def _mensaje(c, para, asunto, cuerpo, cc=None, adjuntos=None, html=False):
    m = EmailMessage()
    nombre = c.get("nombre") or ""
    m["From"] = email.utils.formataddr((nombre, c["correo"])) if nombre else c["correo"]
    m["To"] = para
    if cc:
        m["Cc"] = cc
    m["Subject"] = asunto
    m["Date"] = email.utils.formatdate(localtime=True)
    m["Message-ID"] = email.utils.make_msgid()
    if html:
        m.set_content(re.sub(r"<[^>]+>", "", cuerpo))
        m.add_alternative(cuerpo, subtype="html")
    else:
        m.set_content(cuerpo)
    for a in adjuntos or []:
        p = Path(a)
        tipo, _ = mimetypes.guess_type(p.name)
        main, sub = (tipo or "application/octet-stream").split("/", 1)
        m.add_attachment(p.read_bytes(), maintype=main, subtype=sub, filename=p.name)
    return m


def _smtp(c, clave, timeout=30):
    ctxssl = ssl.create_default_context()
    if (c.get("seguridad") or "ssl") == "ssl":
        s = smtplib.SMTP_SSL(c["smtp"], int(c.get("puerto_smtp") or 465), context=ctxssl, timeout=timeout)
    else:
        s = smtplib.SMTP(c["smtp"], int(c.get("puerto_smtp") or 587), timeout=timeout)
        s.ehlo()
        if (c.get("seguridad") or "starttls") == "starttls":
            s.starttls(context=ctxssl)
            s.ehlo()
    if clave:
        s.login(c.get("usuario") or c["correo"], clave)
    return s


def _explicar(e, c):
    t = str(e)
    if "5.7.30" in t or "basic authentication" in t.lower():
        return "Microsoft ya no acepta usuario y clave por SMTP para esta cuenta (5.7.30)."
    if "535" in t or "Username and Password not accepted" in t or "AUTHENTICATIONFAILED" in t.upper():
        return ("usuario o clave incorrectos" + (" — en Gmail usa una CONTRASEÑA DE APLICACIÓN (myaccount.google.com/apppasswords), "
                                                  "no tu clave normal" if c.get("tipo") == "gmail" else ""))
    if isinstance(e, (TimeoutError, OSError)) and not isinstance(e, smtplib.SMTPException):
        return f"no pude conectar con {c.get('smtp') or c.get('imap')} (¿internet, puerto o firewall?): {t[:120]}"
    return t[:300]


def enviar(para, asunto, cuerpo, cc=None, adjuntos=None, html=False, cuenta_id=None):
    """Envía. Devuelve texto con el resultado (lanza RuntimeError si no se pudo por ningún medio)."""
    from . import vault
    c = cuenta(cuenta_id)
    adjuntos = [str(a) for a in adjuntos or []]
    for a in adjuntos:
        if not Path(a).is_file():
            raise RuntimeError(f"no existe el adjunto {a}")
    if not c:
        if outlook_disponible():
            enviar_outlook(para, asunto, cuerpo, cc, adjuntos, html)
            return f"✔ Enviado con Outlook de escritorio a {para}."
        raise RuntimeError("No hay ninguna cuenta de correo configurada (⚙ Ajustes → 📱 Telegram y correo).")
    if c["tipo"] == "outlook_app":
        enviar_outlook(para, asunto, cuerpo, cc, adjuntos, html, c.get("correo"))
        return f"✔ Enviado con Outlook de escritorio ({c.get('correo') or 'cuenta predeterminada'}) a {para}."
    clave = vault.get_secreto(f"correo_{c['id']}")
    if not clave:
        raise RuntimeError(f"La cuenta {c['correo']} no tiene clave guardada (⚙ Ajustes → 📱 Telegram y correo).")
    m = _mensaje(c, para, asunto, cuerpo, cc, adjuntos, html)
    try:
        with _smtp(c, clave) as s:
            s.send_message(m)
    except Exception as e:
        motivo = _explicar(e, c)
        if c["tipo"] == "hotmail" and outlook_disponible():
            enviar_outlook(para, asunto, cuerpo, cc, adjuntos, html, c.get("correo"))
            return f"✔ Enviado con Outlook de escritorio (el SMTP de Microsoft falló: {motivo}) a {para}."
        extra = (" Pide a la IA que lo envíe desde tu Chrome con la sesión abierta (agente_navegador en outlook.live.com)."
                 if c["tipo"] == "hotmail" else "")
        raise RuntimeError(f"{c['correo']}: {motivo}.{extra}")
    guardar_enviado(c, m)
    return f"✔ Enviado desde {c['correo']} a {para}" + (f" (cc {cc})" if cc else "") + (f" con {len(adjuntos)} adjunto(s)" if adjuntos else "") + "."


def guardar_enviado(c, m):
    """Copia en «Enviados» por IMAP (Gmail ya lo hace solo)."""
    if c["tipo"] == "gmail" or not c.get("imap"):
        return
    from . import vault
    try:
        with imaplib.IMAP4_SSL(c["imap"], int(c.get("puerto_imap") or 993), timeout=20) as im:
            im.login(c.get("usuario") or c["correo"], vault.get_secreto(f"correo_{c['id']}"))
            for carpeta in ("Sent", "Enviados", "Sent Items", "INBOX.Sent"):
                if im.append(carpeta, "\\Seen", imaplib.Time2Internaldate(time.time()), m.as_bytes())[0] == "OK":
                    break
    except Exception:
        pass


def _dec(v):
    try:
        return str(make_header(decode_header(v or "")))
    except Exception:
        return v or ""


def _texto(msg, maximo=600):
    partes = []
    for p in msg.walk() if msg.is_multipart() else [msg]:
        if p.get_content_maintype() == "text" and not p.get_filename():
            try:
                t = p.get_payload(decode=True).decode(p.get_content_charset() or "utf-8", "replace")
            except Exception:
                continue
            if p.get_content_subtype() == "html":
                t = re.sub(r"<style.*?</style>|<script.*?</script>", " ", t, flags=re.S | re.I)
                t = re.sub(r"<[^>]+>", " ", t)
            partes.append(t)
            if p.get_content_subtype() == "plain":
                break
    t = re.sub(r"\s+", " ", " ".join(partes)).strip()
    return t[:maximo] + ("…" if len(t) > maximo else "")


def leer(cantidad=10, solo_no_leidos=False, buscar=None, cuenta_id=None, carpeta="INBOX"):
    from . import vault
    c = cuenta(cuenta_id)
    if (not c and outlook_disponible()) or (c and c["tipo"] == "outlook_app"):
        out = leer_outlook(cantidad, solo_no_leidos, buscar)
        return "Bandeja de entrada (Outlook):\n" + (out or "(sin correos que coincidan)")
    if not c:
        raise RuntimeError("No hay ninguna cuenta de correo configurada.")
    if not c.get("imap"):
        raise RuntimeError(f"La cuenta {c['correo']} no tiene servidor IMAP configurado para leer.")
    clave = vault.get_secreto(f"correo_{c['id']}")
    try:
        im = imaplib.IMAP4_SSL(c["imap"], int(c.get("puerto_imap") or 993), timeout=30)
        im.login(c.get("usuario") or c["correo"], clave)
    except Exception as e:
        raise RuntimeError(f"{c['correo']}: {_explicar(e, c)}")
    try:
        im.select(carpeta, readonly=True)
        crit = ["UNSEEN"] if solo_no_leidos else ["ALL"]
        if buscar:
            q = buscar.replace('"', "")
            crit = crit + ["OR", "SUBJECT", f'"{q}"', "FROM", f'"{q}"'] if q.isascii() else crit
        typ, data = im.search(None, *crit)
        ids = (data[0] or b"").split()[-int(cantidad):][::-1]
        out = []
        for i in ids:
            typ, md = im.fetch(i, "(BODY.PEEK[] FLAGS)")
            if not md or not isinstance(md[0], tuple):
                continue
            msg = email.message_from_bytes(md[0][1])
            fecha = msg.get("Date", "")
            try:
                fecha = time.strftime("%Y-%m-%d %H:%M", time.localtime(email.utils.mktime_tz(email.utils.parsedate_tz(fecha))))
            except Exception:
                pass
            nl = b"\\Seen" not in (md[0][0] or b"")
            out.append(f"{fecha} | {_dec(msg.get('From'))} | {_dec(msg.get('Subject'))}{' | no leído' if nl else ''}\n   {_texto(msg)}")
        return f"Correos de {c['correo']} ({carpeta}):\n" + ("\n".join(out) if out else "(ninguno coincide)")
    finally:
        try:
            im.logout()
        except Exception:
            pass


def probar(cuenta_id=None):
    """Conecta y se autentica (sin enviar nada)."""
    from . import vault
    c = cuenta(cuenta_id)
    if not c:
        return {"ok": False, "texto": "No hay cuentas."}
    if c["tipo"] == "outlook_app":
        if not outlook_disponible():
            return {"ok": False, "texto": "No encontré el Outlook clásico instalado (el Outlook nuevo no se puede automatizar)."}
        try:
            n = _ps("$o = New-Object -ComObject Outlook.Application; ($o.Session.Accounts | ForEach-Object { $_.SmtpAddress }) -join ', '")
            return {"ok": True, "texto": f"✔ Outlook responde. Cuentas: {n or '(predeterminada)'}"}
        except Exception as e:
            return {"ok": False, "texto": f"✖ Outlook: {e}"}
    clave = vault.get_secreto(f"correo_{c['id']}")
    try:
        with _smtp(c, clave, timeout=20):
            pass
        res = f"✔ {c['correo']}: el envío (SMTP) funciona."
    except Exception as e:
        res = f"✖ {c['correo']}: {_explicar(e, c)}"
        if c["tipo"] == "hotmail" and outlook_disponible():
            res += " (Se enviará con Outlook de escritorio.)"
        return {"ok": False, "texto": res}
    if c.get("imap"):
        try:
            with imaplib.IMAP4_SSL(c["imap"], int(c.get("puerto_imap") or 993), timeout=20) as im:
                im.login(c.get("usuario") or c["correo"], clave)
            res += " Leer (IMAP) también funciona."
        except Exception as e:
            res += f" Leer (IMAP) falló: {_explicar(e, c)}"
    return {"ok": True, "texto": res}


# ───────────── Herramienta para la IA ─────────────
def tool(a, ctx):
    acc = (a.get("accion") or "enviar").lower()
    try:
        if acc == "cuentas":
            cs = cuentas()
            return ("Cuentas: " + "; ".join(f"{x['correo'] or x['nombre'] or x['tipo']} ({PRESETS[x['tipo']]['nombre']})"
                                            + (" ★" if x["id"] == _cfg().get("predeterminada") else "") for x in cs)
                    if cs else ("No hay cuentas configuradas" + (" (pero hay Outlook de escritorio: se usará ese)." if outlook_disponible() else
                                                                  ". El usuario las agrega en ⚙ Ajustes → 📱 Telegram y correo.")))
        if acc == "leer":
            return leer(int(a.get("cantidad") or 10), bool(a.get("no_leidos")), a.get("buscar"), a.get("cuenta"))
        if acc == "enviar":
            para = (a.get("para") or "").strip()
            if not re.search(r"[^@\s]+@[^@\s]+\.[^@\s]+", para):
                return "ERROR: 'para' debe tener al menos un correo válido (varios separados por coma)."
            adj = []
            for x in a.get("adjuntos") or []:
                from .oficina import _ruta
                adj.append(str(_ruta(ctx, x)))
            return enviar(para, a.get("asunto") or "(sin asunto)", a.get("cuerpo") or "", a.get("cc"), adj, bool(a.get("html")), a.get("cuenta"))
        return "ERROR: accion debe ser enviar, leer o cuentas."
    except Exception as e:
        return f"ERROR: {str(e)[:500]}"


TOOL_DEF = {"type": "function", "function": {
    "name": "correo",
    "description": "Envía o lee correos con las cuentas del usuario (Gmail, Hotmail/Outlook.com, Outlook de escritorio o SMTP de empresa) sin abrir el navegador. Enviar pide aprobación al usuario (en Noviq y por Telegram).",
    "parameters": {"type": "object", "properties": {
        "accion": {"type": "string", "enum": ["enviar", "leer", "cuentas"]},
        "para": {"type": "string", "description": "Destinatario(s), separados por coma"}, "cc": {"type": "string"},
        "asunto": {"type": "string"}, "cuerpo": {"type": "string"}, "html": {"type": "boolean"},
        "adjuntos": {"type": "array", "items": {"type": "string"}, "description": "Rutas de archivos (ej. 'Documentos/informe.pdf')"},
        "cuenta": {"type": "string", "description": "Correo o id de la cuenta a usar (por defecto la predeterminada)"},
        "cantidad": {"type": "integer"}, "no_leidos": {"type": "boolean"}, "buscar": {"type": "string"}},
        "required": ["accion"]}}}
