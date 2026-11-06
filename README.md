# RaceMeter

App web (PWA) para iPhone que mide en moto:

- **Ángulo de inclinación** (giroscopio + física de la curva con la velocidad GPS) y máximos a cada lado
- **Fuerzas G** longitudinal y lateral, con G-ball y máximos
- **Caballito / stoppie** (cabeceo)
- **0-50, 0-100, 0-150, 0-200** y **100 / 201 / 402 m** desde parado (arranque automático)
- **Recuperaciones** 60-100, 80-120, 100-200 y **frenada 100-0**
- **Intervalos personalizados** (por ejemplo 20-120 o 0-120): en *Tiempos › Mis intervalos*
- Velocidad GPS, historial, récords y exportación de la sesión a CSV

Sin dependencias ni compilación: HTML, CSS y módulos JavaScript que el navegador carga directamente. Funciona sin conexión una vez instalada.

## Estructura

```
index.html          estructura de las pantallas
css/styles.css      estilos
js/app.js           punto de entrada: sensores, GPS, demo, acciones de la interfaz
js/session.js       recorrido de cada dato: muestra → fusión → velocidad → máximos → cronos
js/fusion.js        fusión de sensores: inclinación, cabeceo y fuerzas G (calibración incluida)
js/speed.js         velocidad combinando GPS (1 Hz) y acelerómetro (60 Hz)
js/timing.js        cronos: 0-100…, 100/201/402 m, recuperaciones, frenada 100-0
js/stats.js         máximos de la sesión
js/recorder.js      grabación y exportación a CSV
js/demo.js          simulación del circuito (modo demo y pruebas)
js/draw.js          dibujo del arco de inclinación, G-ball y velocímetro
js/ui.js            vuelca el estado en las pantallas
js/format.js        formato de números
js/platform.js      cosas del iPhone: permisos, pitidos, pantalla encendida, avisos
js/util.js          constantes y matemáticas
js/storage.js       guardado en el móvil
sw.js               funcionamiento sin conexión
tests/              pruebas automáticas
```

Los módulos de cálculo (`fusion`, `speed`, `timing`, `session`, `demo`) no dependen del navegador, así que se prueban con Node.

## Pruebas

Necesita Node.js 20 o superior:

```bash
npm test
```

Las pruebas alimentan la app con la moto simulada y comparan con los valores reales: ángulo de inclinación, G lateral, velocidad, 0-100, recuperaciones, frenada 100-0 y la autodetección de sensores.

Al cambiar cualquier archivo, sube la versión `CACHE` de `sw.js` para que el iPhone descargue la nueva.

## Instalar en el iPhone

1. Abre la dirección de GitHub Pages en **Safari**.
2. Compartir › **Añadir a pantalla de inicio**.
3. Abre la app, pulsa **Empezar** y acepta *Movimiento y orientación* y *Ubicación* (con "Ubicación exacta").
4. Con el móvil en el soporte y la moto recta y quieta: **Ajustes › Calibrar**.

Los sensores y el GPS solo funcionan si la página se sirve por **HTTPS**.

## Modo demo

En la pantalla de inicio, **Ver demo** simula una moto dando vueltas a un circuito para ver la app sin salir a rodar.
