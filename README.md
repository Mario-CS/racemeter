# RaceMeter

App web (PWA) para iPhone que mide en moto:

- **Ángulo de inclinación** (giroscopio + física de la curva con la velocidad GPS) y máximos a cada lado
- **Fuerzas G** longitudinal y lateral, con G-ball y máximos
- **Caballito / stoppie** (cabeceo)
- **0-50, 0-100, 0-150, 0-200** y **100 / 201 / 402 m** desde parado (arranque automático)
- **Recuperaciones** 60-100, 80-120, 100-200 y **frenada 100-0**
- Velocidad GPS, historial, récords y exportación de la sesión a CSV

Todo es un único `index.html` sin dependencias. Funciona sin conexión una vez instalada.

## Instalar en el iPhone

1. Abre la dirección de GitHub Pages en **Safari**.
2. Compartir › **Añadir a pantalla de inicio**.
3. Abre la app, pulsa **Empezar** y acepta *Movimiento y orientación* y *Ubicación* (con "Ubicación exacta").
4. Con el móvil en el soporte y la moto recta y quieta: **Ajustes › Calibrar**.

Los sensores y el GPS solo funcionan si la página se sirve por **HTTPS**.

## Modo demo

En la pantalla de inicio, **Ver demo** simula una moto dando vueltas a un circuito para ver la app sin salir a rodar.
