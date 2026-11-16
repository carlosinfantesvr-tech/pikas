# Publicar PIKAS en un subdominio gratuito

PIKAS está preparado para el plan Hobby de Vercel (`https://tu-proyecto.vercel.app`) y el plan gratuito de Neon (Postgres). No hace falta dominio propio ni tarjeta para esos planes. No crees las cuentas desde el código: las crea el propietario.

Esta guía no deja dinero real en ningún sitio. La app solo simula.

## 1. Base de datos en Neon

1. Entra en [https://neon.tech](https://neon.tech) y crea una cuenta gratuita.
2. Crea un proyecto. Región cercana, Postgres reciente.
3. En el panel, copia la cadena **pooled** (el host contiene `-pooler`).
4. Guárdala. Será `DATABASE_URL`. No la pegues en el chat ni en un archivo del repo.

## 2. Código en GitHub

El repositorio ya es público. Vercel se conecta a esa copia. No subas `.env.local`.

## 3. Proyecto en Vercel

1. Entra en [https://vercel.com](https://vercel.com) y crea una cuenta gratuita (Hobby).
2. **Add New… → Project** e importa el repositorio de PIKAS.
3. Framework: Next.js. No cambies el comando de build (`next build`).
4. Antes de pulsar Deploy, abre **Environment Variables** y crea:

| Variable | Obligatoria | Ejemplo / nota |
| --- | --- | --- |
| `DATABASE_URL` | sí | cadena pooled de Neon |
| `BOOTSTRAP_ADMIN_EMAIL` | sí | tu correo |
| `BOOTSTRAP_ADMIN_PASSWORD` | sí | mínimo 10 caracteres |
| `CRON_SECRET` | sí | una frase larga aleatoria |
| `APP_URL` | sí | déjala vacía en el primer deploy y actualízala en el paso 5 |
| `INVITE_REQUIRED` | recomendada | `true` |

5. Deploy. Cuando termine, Vercel enseña una URL `https://algo.vercel.app`.
6. Vuelve a Environment Variables, pon `APP_URL` con esa URL **sin** barra final y pulsa **Redeploy**.

Abre la URL, entra con el correo y la contraseña de administrador. En Admin puedes crear una invitación para tus amigos. El código se muestra una sola vez.

Si la base ya tiene usuarios, cambiar `BOOTSTRAP_ADMIN_PASSWORD` no modifica al administrador existente. Para otra contraseña usa el enlace de recuperación del panel.

## 4. Qué hace el plan gratuito con el motor

Vercel no deja un proceso encendido. El plan Hobby solo permite un cron al día (`vercel.json` llama a `/api/cron/tick` a las 08:00 UTC).

Mientras alguien tiene PIKAS abierto, el navegador llama a `/api/pulse` cada 15 segundos y el servidor actualiza precios, órdenes, stops y rondas. Si nadie entra y no hay otro cron, el motor se pone al día al volver, con velas reales. Si falta un tramo de velas o una vela toca a la vez el stop y el objetivo, ese tramo queda anotado como no verificable y **no** se inventa una liquidación.

Para que siga corriendo con la app cerrada, puedes usar un cron gratuito externo (por ejemplo [cron-job.org](https://cron-job.org)):

- URL: `https://tu-proyecto.vercel.app/api/cron/tick`
- Método: GET
- Cabecera: `Authorization: Bearer TU_CRON_SECRET`
- Frecuencia: cada 1 o 5 minutos

No prometas notificaciones push: el aviso vive dentro de la app.

## 5. Google, si lo quieres

Sin `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` el botón no sale y la API responde que el inicio con Google no está configurado. No se simula el login.

1. Entra en [Google Cloud Console](https://console.cloud.google.com/).
2. Crea un proyecto (puede llamarse PIKAS).
3. **APIs y servicios → Pantalla de consentimiento de OAuth**.
   - Tipo: Externo.
   - Nombre: PIKAS.
   - Correo de asistencia: el tuyo.
   - Ámbitos: `openid`, `email`, `profile` (los básicos).
   - Mientras la app esté en estado **Prueba**, añade en **Usuarios de prueba** cada Gmail que vaya a entrar.
4. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web**.
5. Orígenes de JavaScript autorizados:
   - `http://localhost:3000`
   - `https://tu-proyecto.vercel.app`
6. URI de redirección autorizados, exactos:
   - `http://localhost:3000/api/auth/google/callback`
   - `https://tu-proyecto.vercel.app/api/auth/google/callback`
7. Copia el ID y el secreto a Vercel:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_ALLOWED_EMAILS` con los correos separados por comas, si quieres dejarlos pasar sin invitación.
8. Redeploy.

Una cuenta nueva de Google solo entra si el correo está en esa lista, en la lista del panel Admin, o si el enlace de inicio lleva una invitación válida (`/api/auth/google/start?invite=CODIGO`). Quien ya tiene cuenta entra con el mismo correo verificado.

El flujo real contra Google no se pudo probar en el desarrollo: no se creó ninguna credencial.

## 6. Activar PIKAS AI

El chat se llama PIKAS AI. Tiene una voz fija y guarda una memoria breve de lo que el usuario dice. No dice qué motor respondió. Sin ninguna clave, la pantalla dice **PIKAS AI no configurado** y no redacta un análisis.

El router prueba una cadena. Si uno responde 429, se queda sin crédito, falla o tarda más de 8 segundos, pasa al siguiente y lo deja en pausa un rato. El panel Admin → Router muestra cuáles están configurados, si están en pausa y el uso estimado. Esa pantalla no la ve un usuario normal.

Orden por defecto, de primero a último. Los de pago no se llaman si `AI_ALLOW_PAID` no es `true`.

Estas notas salen de la documentación pública leída el 16 de noviembre de 2026. No llamé a ninguna API: aquí no hay claves. Si un identificador de modelo deja de existir, cámbialo en la variable y el router saltará al siguiente cuando reciba un error.

1. **Google Gemini** — capa gratuita en AI Studio. Entra en [aistudio.google.com](https://aistudio.google.com), crea una clave de API y ponla en `GEMINI_API_KEY`. Google dice que Flash tiene precio cero en el tier gratuito y que el cupo real se ve en AI Studio, no está garantizado. Por defecto se usan `gemini-3.6-flash` y `gemini-3.8-flash`. Si AI Studio muestra otro id, cámbialo.
2. **Groq** — plan Free sin tarjeta, con tope por minuto y por día. Entra en [console.groq.com](https://console.groq.com), crea una clave y ponla en `GROQ_API_KEY`. La documentación de límites del 16 nov 2026 cita `openai/gpt-oss-20b` y `openai/gpt-oss-120b` (30 peticiones/minuto, 1.000/día en esos modelos). Un 429 pasa al siguiente.
3. **OpenRouter** — modelos cuyo id acaba en `:free`, o el router `openrouter/free`. Cuenta en [openrouter.ai](https://openrouter.ai), clave en `OPENROUTER_API_KEY`. Sin créditos comprados, la propia documentación de límites habla de unas 20 peticiones por minuto y 50 al día. No pongas un modelo de pago en el fallback: se cobraría.
4. **Cloudflare Workers AI** — asignación gratuita de neuronas. En el panel de Cloudflare crea un token con permiso de Workers AI y copia el Account ID. Variables: `CLOUDFLARE_ACCOUNT_ID` y `CLOUDFLARE_API_TOKEN`. El modelo por defecto es `@cf/meta/llama-3.1-8b-instruct`. Confirma el id en el catálogo de Workers AI.
5. **Hugging Face** — token en [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens), variable `HF_TOKEN`. La inferencia gratuita tiene cola y límites. El modelo por defecto puede no estar despierto; si falla, el router sigue.
6. **Mistral** — clave en [console.mistral.ai](https://console.mistral.ai), variable `MISTRAL_API_KEY`. El plan Experiment ha cambiado varias veces. Confirma en la consola si tu clave es gratuita antes de dejarla activa.
7. **Ollama** — en tu ordenador, sin clave, si el proceso de PIKAS puede abrir `OLLAMA_BASE_URL` (por ejemplo `http://127.0.0.1:11434`). En Vercel esa dirección es la del propio servidor, no tu portátil, así que no la pongas ahí salvo que apuntes a una URL alcanzable.
8. **Cerebras** — no es un plan gratis permanente. La documentación del 16 nov 2026 dice que hay 5 USD de prueba al añadir una tarjeta, y que caducan a los 30 días. Solo pon `CEREBRAS_API_KEY` si aceptas eso.
9. **OpenAI, Anthropic y xAI** — de pago. Hace falta la clave y `AI_ALLOW_PAID=true`. El tope interno `AI_PAID_DAILY_BUDGET_USD` sale en 0, así que además tienes que subirlo. Pon también un límite en la consola del proveedor. Una suscripción de chat no es una clave de API.

`AI_DAILY_BUDGET_USD` y `AI_MONTHLY_BUDGET_USD` siguen siendo estimaciones internas. Los motores marcados como gratuitos cuentan 0.

## 7. Precios de mercado

No hace falta clave. La app lee, en este orden cuando uno falla:

- Cripto: Kraken, luego Coinbase, luego CoinGecko.
- Acciones e índice: Yahoo Finance (API no oficial; si falla, se dice que no hay dato).
- Funding simulado de BTC, ETH y SOL: tasa pública de Kraken Futures. Si no llega, no se cobra un funding inventado.

Binance respondió 451 desde el entorno de construcción (región restringida) y no se usa.

## 8. En tu ordenador

```bash
npm install
cp .env.example .env.local
```

Rellena al menos `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, `CRON_SECRET` y `APP_URL=http://localhost:3000`. Deja `DATABASE_URL` vacío: se usa Postgres embebido en `.data/pglite`.

```bash
npm test
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

`npm run check:market` consulta las fuentes reales e imprime el estado. No guarda claves.

## 9. Límites que conviene conocer

- El plan Hobby corta cada función hacia los 10 segundos. El pulso procesa un lote acotado y sigue en el siguiente.
- Neon gratuito se duerme si no hay consultas. La primera petición después puede tardar un poco.
- No hay copias automáticas garantizadas en el plan gratis. Desde el panel de Neon puedes exportar la base si quieres una copia tuya.
- `SESSION_COOKIE_NAME`, si la cambias, tiene que existir en el momento del build.
