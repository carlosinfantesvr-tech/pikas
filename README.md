# PIKAS

Plataforma privada y educativa de simulación de trading. Los precios pueden ser reales. Las cuentas, las órdenes, el PnL y las liquidaciones son ficticios. No hay broker ni dinero real.

La interfaz está en español y se puede instalar como PWA.

## Qué hay

- Panel con precios de BTC, ETH, SOL, Apple, NVIDIA y el S&P 500.
- Paper trading: market, limit, stop, TP/SL, cierre parcial, funding cuando hay tasa real, liquidación simulada.
- Market Battle, rankings y perfiles.
- AI Arena con un agente de reglas visible y hueco para modelos de pago.
- PIKAS AI, el chat del router. Sin clave de proveedor dice que no está configurado.
- Alertas dentro de la app, administración e invitaciones.
- Entrada con contraseña y, si lo configuras, con Google restringido a una lista o a una invitación.

## Arranque local

```bash
npm install
cp .env.example .env.local
npm test
npm run dev
```

En `.env.local` rellena `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` (10 caracteres o más), `CRON_SECRET` y `APP_URL=http://localhost:3000`. Deja `DATABASE_URL` vacío: en local se usa Postgres embebido.

Abre http://localhost:3000.

`npm run check:market` pregunta a las fuentes públicas y enseña si el precio es ejecutable.

## Publicar

Plan gratuito de Vercel más Neon. Pasos, variables y las URI exactas de Google: [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md).

## Documentos

- [Especificación](docs/PIKAS_spec.txt)
- [Arquitectura](docs/ARQUITECTURA.md)
- [Motor financiero](docs/MOTOR_FINANCIERO.md)
- [Market Battle](docs/MARKET_BATTLE.md)
- [Router y PIKAS AI](docs/AI_ROUTER.md)

## Límites honestos

Binance no se usa: desde este entorno respondió 451. Yahoo Finance para acciones es una API no oficial. El cron del plan Hobby de Vercel es diario; con la app abierta el pulso corre cada 15 segundos y, si el servidor estuvo dormido, la recuperación usa velas y no inventa liquidaciones. El login de Google y las respuestas de los modelos no se probaron contra las APIs de pago porque no hay claves.
