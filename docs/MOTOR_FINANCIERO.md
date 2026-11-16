# Motor de paper trading

Simulación de perpetuo con margen aislado. No hay broker, ni wallet, ni orden real. USDT es una unidad ficticia.

## Constantes

- Comisión taker: 0,05 % del nocional.
- Comisión maker (límites que quedan en libro): 0,02 %.
- Margen de mantenimiento: 0,5 % del nocional inicial.
- Apalancamientos: 1, 2, 3, 5, 10, 15 y 20.
- Saldos iniciales: 10, 50, 100 o 500.
- Redondeo half-up a 8 decimales (`decimal.js`).
- Un símbolo, una posición (modo unidireccional).

## Apertura a mercado

```
nocional = margen × apalancamiento
cantidad = nocional / precio
comisión = nocional × tasa
saldo   -= margen + comisión
```

Hace falta saldo para el margen y la comisión. El mínimo de margen es 1.

## PnL y ROE

```
largo:  (marca - entrada) × cantidad
corto:  (entrada - marca) × cantidad
ROE = PnL / margen
patrimonio = saldo libre + Σ (margen + PnL no realizado)
```

El PnL no realizado solo entra en el patrimonio si la marca es ejecutable.

## Liquidación

```
largo:  entrada × (1 - 1/apalancamiento + 0,005)
corto:  entrada × (1 + 1/apalancamiento - 0,005)
```

En la liquidación se pierde el margen aislado que quedaba. No hay fondo de seguro. El saldo libre no se toca, salvo comisiones ya cobradas. Si hay stop y el precio cruza stop y liquidación, se ejecuta el stop: en un mercado continuo el stop está antes.

Un cierre manual nunca deja el saldo libre negativo por la pérdida de precio. Lo que exceda el margen no se descuenta del resto de la cuenta.

## Órdenes

- Market: inmediata al precio ejecutable.
- Limit de apertura larga: se llena si el precio es menor o igual que el límite, al precio límite.
- Stop market: se dispara al cruzar el stop y se llena al precio visto.
- Take profit y stop loss viven en la posición. Un stop al otro lado de la liquidación se rechaza.
- Cierre parcial o total. El polvo por debajo de 0,5 USDT cierra el resto.
- Cancelar una pendiente no mueve el saldo. El margen se comprueba otra vez al ejecutarse.

## Precio no ejecutable

`stepOnPrice` no abre, no cierra y no liquida. Devuelve `skipped_stale`.

## Velas de recuperación

Como mucho un disparador por vela y símbolo: el más cercano a la apertura y solo si todos los niveles tocados están al mismo lado. Si la vela toca por arriba y por abajo, queda `ambiguous_candle` y no se ejecuta nada. Un hueco de más de 3 minutos entre velas detiene la reconstrucción.

## Funding

Solo BTC, ETH y SOL, y solo con la tasa `relativeFundingRate` horaria de Kraken Futures fresca (menos de 2 minutos). Tasa positiva: el largo paga y el corto cobra, sobre `cantidad × marca`. Si no hay tasa, no se aplica. Las horas sin histórico se anotan y no se rellenan con la tasa de ahora.

Las acciones no tienen funding de perpetuo. El apalancamiento sobre ellas es solo didáctico y la pantalla lo dice al mostrar el estado del mercado.

## Reinicio

Exige precio ejecutable para cerrar lo abierto. El historial de cierres se conserva con su motivo. Luego el saldo libre pasa al inicial elegido.

## Pruebas

`tests/engine.test.ts` cubre largo, corto, saldo insuficiente, parcial, TP, SL, prioridad del stop frente a la liquidación, precio viejo, vela ambigua, límite, cancelación, funding y reinicio.
