# Arquitectura

PIKAS es una sola aplicación Next.js. La interfaz, la API y el cron viven en el mismo proyecto para poder publicarlo en Vercel con un clic. El motor de simulación y las puntuaciones no corren en el navegador.

## Piezas

- `src/engine`: cálculos puros (órdenes, PnL, liquidación, indicadores, Market Battle, ranking). Sin red ni base de datos. Los tests viven en `tests/`.
- `src/lib`: Postgres, sesión, mercado, persistencia del paper trading, arena, router y pulso.
- `src/app`: páginas en español y la API `src/app/api/[...slug]`.
- `src/components`: interfaz, animaciones y el chat de PIKAS AI.

## Datos

Producción: Postgres de Neon, con la cadena pooled y `prepare: false` (el pooler en modo transacción no admite prepared statements).

Desarrollo y tests: PGlite, el mismo SQL. En Vercel, si falta `DATABASE_URL`, el proceso se niega a arrancar. No hay una base efímera en producción.

El dinero se guarda como texto decimal de 8 posiciones. El libro `ledger` anota cada cambio de saldo libre.

## Mercado

Proveedores intercambiables en `src/lib/market.ts`. Cada precio guarda fuente, marca de tiempo y si es ejecutable.

- Cripto ejecutable si la marca tiene menos de 90 segundos.
- Acciones e índices ejecutables si la marca tiene menos de 15 minutos. Si el mercado está cerrado, el último precio se muestra como cierre y no dispara stops ni liquidaciones.

## Pulso

`runPulse` refresca precios, recorre cuentas con posiciones u órdenes, avanza Market Battle y evalúa alertas. Lo disparan el cron y, cada 15 s, cualquier sesión con la app visible. Un candado en base evita dos pulsos a la vez.

Si el último procesamiento tiene más de 90 segundos, se recorren velas de 1 minuto. Un hueco o una vela que toca niveles en los dos sentidos se guarda en `data_gaps` y no se liquida por un camino imaginado. Después se aplica el último precio real si sigue siendo ejecutable: eso confirma el nivel actual, no las mechas perdidas.

## IA

Todas las llamadas pasan por `src/lib/ai.ts`. Sin claves, PIKAS AI responde `not_configured` y la interfaz lo dice con esas palabras. El baseline de la arena es una regla EMA/RSI etiquetada como tal; no sustituye a un modelo.

## Seguridad

Contraseñas con scrypt. Sesión aleatoria en cookie httpOnly, SameSite lax, solo el hash en la base. Invitación obligatoria por defecto. Google, si está configurado, exige allowlist o invitación para cuentas nuevas. Cada ruta comprueba la sesión. El cron exige `CRON_SECRET`. Los logs omiten campos cuyo nombre parece un secreto. Hay límite de intentos de login.

## Animación

Transiciones de página, contadores, destello de precio, esqueletos, reordenación del ranking y toasts. Se apagan con `prefers-reduced-motion` y con el ajuste «Reducir animaciones». El service worker cachea la cáscara, nunca `/api`.
