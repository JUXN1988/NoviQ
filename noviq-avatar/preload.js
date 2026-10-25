'use strict';
// Puente seguro entre el renderer (avatar) y el proceso principal.
const { contextBridge, ipcRenderer } = require('electron');

const escuchar = (canal) => (cb) => ipcRenderer.on(canal, (_e, datos) => cb(datos));

contextBridge.exposeInMainWorld('noviqPuente', {
  config: () => ipcRenderer.invoke('config'),
  onComando: escuchar('comando'),
  onCursor: escuchar('cursor'),
  onVuelo: escuchar('vuelo'),
  onEscala: escuchar('escala'),
  onConfig: escuchar('config'),
  hecho: (id, r) => ipcRenderer.send('hecho', { id, r }),
  fallo: (id, e) => ipcRenderer.send('fallo', { id, e }),
  evento: (n, d) => ipcRenderer.send('evento', { n, d }),
  estado: (s) => ipcRenderer.send('estado', s),
  ignorar: (v) => ipcRenderer.send('ignorar', !!v),
  arrastre: (fase) => ipcRenderer.send('arrastre', fase),
  menu: () => ipcRenderer.send('menu'),
  dobleClic: () => ipcRenderer.send('dobleClic'),
  // 🎙 Lo que oyó el micrófono (WAV base64) → Noviq lo transcribe y responde
  voz: (audio, op) => ipcRenderer.invoke('voz', { audio, op: op || {} }),
  // 🗣 Texto → voz moderna (la sintetiza Noviq: Microsoft neuronal, NVIDIA Magpie o Piper)
  tts: (texto, op) => ipcRenderer.invoke('tts', { texto, op: op || {} })
});
