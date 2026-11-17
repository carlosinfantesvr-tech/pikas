# Ronda unida

Personas, modelos configurados y cuatro bots de reglas juegan la misma ronda. No es una copia de otra marca: los nombres, los textos y las reglas son de PIKAS.

## Cuándo

Tres sesiones al día, hora de Madrid (`PIKAS_TZ`, por defecto `Europe/Madrid`):

- Asia `02:00` (`SESSION_ASIA`)
- Londres `09:00` (`SESSION_LONDON`)
- Nueva York `15:30` (`SESSION_NEWYORK`)

El voto abre `SESSION_VOTE_LEAD_MIN` minutos antes (480) y se puede cambiar hasta el inicio. La ronda dura `SESSION_DURATION_MIN` minutos (240). El activo por defecto es BTC (`PIKAS_RONDA_SYMBOL`).

## Niveles

Al empezar hace falta un precio ejecutable y al menos 10 velas de 1 minuto ya guardadas. El stop es el percentil 60 del rango (máximo−mínimo) / cierre, limitado entre 0,05 % y 8 %. El objetivo está a 1,5 veces ese stop. Todo el mundo usa la misma entrada y las mismas distancias. Si faltan datos, la ronda se cancela y no se inventa un nivel.

## Resolución

Velas de 1 minuto. Si en el mismo minuto se tocan el objetivo y el stop, cuenta el stop (−1). Si solo el objetivo, +1,5. Si no se toca ninguno, se anota la R parcial del cierre, entre −1 y +1,5. Sin velas en la ventana, el resultado es no verificable y los puntos quedan vacíos.

## Quién juega

- Personas: voto sube o baja.
- IAs: solo las que tienen clave. Se les pide un JSON con lado y razón. Si no responden o el texto no es claro, no juegan esa ronda. No se inventa su voto.
- Bots propios: **Dado ciego** (lado fijo a partir del id de la ronda, la referencia), **Contracorriente** (opuesto a la mayoría humana; si hay empate, no juega), **Rompevallas** (ruptura del rango reciente) y **Vuelta al centro** (alejamiento de la media). Si no hay señal, no juegan.

## Marcador

Comunidad, IA y Bots. La comunidad solo puntúa con al menos 3 votos. El peso de cada persona es 1 hasta tener 5 rondas resueltas; después es 0,5 + su proporción de rondas en positivo, entre 0,5 y 1,5.

La temporada es el mes de Madrid. Hacen falta 10 rondas resueltas para clasificar. La comparación es contra Dado ciego.

## Modo libre

El usuario elige lado, stop, objetivo y plazo (4 h, 8 h, 24 h o 1 semana). La entrada es el precio de la fuente, no un número escrito. Stop máximo 10 %. Relación objetivo/stop mínima 0,25. El ranking no se mezcla con la ronda unida.

## Registro

Cada predicción, cada cambio de voto y la fijación de niveles se encadenan con SHA-256. La página pública `/verificar` y `/api/public/cadena` (JSON o `?format=csv`) recomputan la cadena. El primer eslabón cuelga de 64 ceros.

OpenTimestamps no está integrado. Un sello externo gratis exigiría un calendario y una prueba real contra su servidor; dejarlo a medias sería fingir una prueba. El siguiente paso, cuando se pueda probar, es publicar el hash diario en un calendario de OpenTimestamps y guardar el recibo.

## Otras lecturas

- Miedo y codicia: `https://api.alternative.me/fng/?limit=1`. Si falla, no se muestra un número inventado.
- Oro (`GC=F`) y Nasdaq 100 (`^NDX`) se leen de Yahoo Finance, igual que el resto de acciones. Si Yahoo no responde, el activo queda en «sin datos».
- El resumen diario lo redacta PIKAS AI solo con rondas ya guardadas, y solo si hay una clave. Si no, el texto dice que no está configurado.
