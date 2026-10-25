/* ==========================================================================
   Noviq Avatar — Ojos: cámara conectada (solo cuando se le pide mirar)
   · No graba, no transmite, no guarda: abre la cámara, toma UN cuadro, la cierra.
   · Solo funciona si el usuario activó «Cámara» en Ajustes → Visión (el proceso
     principal rechaza el permiso de vídeo si está apagada).
   ========================================================================== */
(function () {
  'use strict';
  const N = (window.N = window.N || {});
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  function explicar(e) {
    const t = String((e && (e.name || e.message)) || e);
    if (/NotAllowed|Permission|denied/i.test(t)) return 'No tengo permiso para la cámara: actívala en mis Ajustes → Visión y revisa que Windows la permita (Configuración → Privacidad → Cámara → apps de escritorio).';
    if (/NotFound|DevicesNotFound/i.test(t)) return 'No encontré ninguna cámara conectada.';
    if (/NotReadable|TrackStart|in use/i.test(t)) return 'La cámara la está usando otro programa; ciérralo e inténtalo otra vez.';
    if (/Overconstrained/i.test(t)) return 'Esa cámara no está disponible; elige otra en Ajustes → Visión.';
    return 'No pude usar la cámara: ' + String(e && e.message || e).slice(0, 120);
  }

  class Camara {
    async listar() {
      try {
        let ds = await navigator.mediaDevices.enumerateDevices();
        let v = ds.filter((d) => d.kind === 'videoinput');
        if (v.length && v.every((d) => !d.label)) {   // sin permiso concedido aún no hay nombres: abre y cierra una vez
          try { const s = await navigator.mediaDevices.getUserMedia({ video: true }); s.getTracks().forEach((t) => t.stop()); ds = await navigator.mediaDevices.enumerateDevices(); v = ds.filter((d) => d.kind === 'videoinput'); } catch (e) { return { ok: false, error: explicar(e), camaras: [] }; }
        }
        return { ok: true, camaras: v.map((d, i) => ({ id: d.deviceId, nombre: d.label || 'Cámara ' + (i + 1) })) };
      } catch (e) { return { ok: false, error: explicar(e), camaras: [] }; }
    }

    /** Un cuadro JPEG (base64 sin prefijo). P: {dispositivo, ancho} */
    async capturar(P) {
      P = P || {};
      let stream = null;
      try {
        const video = { width: { ideal: 1280 }, height: { ideal: 720 } };
        if (P.dispositivo) video.deviceId = { exact: String(P.dispositivo) };
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.srcObject = stream;
        await v.play();
        // la cámara necesita un instante para ajustar luz y enfoque
        const t0 = performance.now();
        while ((v.videoWidth < 2 || performance.now() - t0 < 900) && performance.now() - t0 < 5000) await espera(80);
        const w0 = v.videoWidth, h0 = v.videoHeight;
        if (!w0 || !h0) throw new Error('la cámara no dio imagen');
        const maxAncho = Math.max(320, Math.min(1920, Number(P.ancho) || 960));
        const k = Math.min(1, maxAncho / w0);
        const c = document.createElement('canvas');
        c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        const url = c.toDataURL('image/jpeg', 0.82);
        const track = stream.getVideoTracks()[0];
        return { ok: true, imagen: url.slice(url.indexOf(',') + 1), ancho: c.width, alto: c.height, camara: track ? track.label : '' };
      } catch (e) {
        return { ok: false, error: explicar(e) };
      } finally {
        try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch (_) { /* ya */ }   // la luz de la cámara se apaga aquí
      }
    }
  }
  N.Camara = Camara;
})();
