/* 🎮 REGLAS PROPIAS DE TU JUEGO (motor 3D del Estudio de Noviq)
   Aquí se programan las mecánicas especiales de tu idea sin tocar el motor. El motor llama a estas funciones:

   alIniciar(J)            → al empezar/reiniciar la partida (crea aquí lo que necesites, UNA sola vez)
   alActualizar(J, dt)     → en cada cuadro mientras se juega (dt = segundos desde el cuadro anterior)
   alRecoger(J, objeto)    → al tocar un objeto (devuelve false para no recogerlo)
   alDerrotar(J, enemigo)  → al vencer a un enemigo
   alDanio(J, cantidad)    → cuando el jugador recibe daño (devuelve false para evitarlo)
   alGanar(J) / alPerder(J)

   J (API del juego): J.jugador {pos, vel, vida, vidaMax, puntos, yaw, turbo}, J.enemigos[], J.objetos[], J.partida {t, recogidos, derrotados},
   J.escena, J.camara, J.THREE, J.C (el diseño de juego.config.js), J.alturaEn(x, z), J.aviso("texto"), J.sonido("moneda"|"salto"|"golpe"|"vida"),
   J.sumarPuntos(n), J.danio(n), J.curar(n), J.ganar("texto"), J.perder("texto"), J.explosion(x, y, z, "#color"), J.herirEnemigo(en, n).

   ⚠ RENDIMIENTO: nunca crees geometrías, materiales ni mallas dentro de alActualizar (se crean una vez en alIniciar y se reutilizan). */
window.REGLAS = {
  alIniciar(J) {
    // Ejemplo: mensaje de bienvenida
    J.aviso("🎯 " + J.C.objetivo.texto, 2500);
  },
  alActualizar(J, dt) {
    // Ejemplo: cada 30 s aparece un aviso para animar al jugador
    // if (Math.floor(J.partida.t) % 30 === 0 && J.partida.t > 1 && J.partida.t % 30 < dt) J.aviso("¡Sigue así!");
  },
  alRecoger(J, objeto) {},
  alDerrotar(J, enemigo) {},
  alDanio(J, cantidad) {},
  alGanar(J) {},
  alPerder(J) {}
};
