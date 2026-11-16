# Market Battle

Rondas con votación y una ventana de competición. El usuario vota SUBE o BAJA solo durante la votación. Puede cambiar el voto hasta que cierre. La distribución de votos no se enseña mientras se vota, para no empujar al rebaño. Sí se enseña el número de participantes.

## Barreras

Al cerrar la votación se fija el precio real si es ejecutable. Si 15 minutos después sigue sin precio, la ronda se cancela y no se inventa un inicio.

```
arriba = inicio × (1 + objetivo% / 100)
abajo  = inicio × (1 - riesgo% / 100)
```

Se recorren las velas de la ventana en orden:

- Solo toca arriba: `barrier_up`.
- Solo toca abajo: `barrier_down`.
- La misma vela toca las dos: `unverifiable`.
- No toca ninguna y se acaba el tiempo: dirección del cierre (`close_up`, `close_down` o `flat`).
- Sin velas: `unverifiable`.

## Puntos

Enteros y reproducibles. El detalle queda en `battle_scores.detail_json`.

- Acierto por barrera: `redondeo(100 × objetivo/riesgo + 20 × fracción de tiempo restante + 10)`.
- Acierto solo porque el cierre fue en tu dirección: 50.
- Fallo: −40.
- Plano o no verificable: 10 de participación y sin acierto ni fallo.

Nadie edita sus puntos desde el navegador. Los rankings diarios, semanales, mensuales e históricos suman esos puntos en el servidor.
