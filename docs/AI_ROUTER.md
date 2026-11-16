# AI Router y PIKAS AI

PIKAS AI es una sola voz. El usuario no ve qué motor respondió. Por debajo hay una cadena: si uno se queda sin cupo, responde 429, se queda sin crédito, falla o tarda más de 8 segundos, el router pasa al siguiente y deja al primero en pausa (1 minuto por límite, 15 por cupo, 30 segundos por timeout, 1 hora si la clave es inválida).

La pausa y el último error se ven solo en Admin → Router. El chat guarda una memoria corta de preferencias que el propio usuario deja, en `ai_memory`, y la vuelve a poner en el contexto. No es un modelo entrenado desde cero.

## Orden

Primero los que pueden costar cero: Ollama (si hay URL), Gemini, Groq, OpenRouter free, Cloudflare Workers AI, Hugging Face y Mistral. Cerebras va después porque su prueba pide tarjeta. OpenAI, Anthropic y xAI solo si `AI_ALLOW_PAID=true` y el tope de pago es mayor que cero.

En una tarea de análisis, dentro del mismo motor se prueba antes la variante fuerte. Si esa falla, no se insiste con la otra variante del mismo motor en la misma pregunta.

En AI Arena cada motor y cada modelo es un competidor aparte, con su cuenta de 100 USDT simulados. PIKAS AI y el Advisor siguen usando la cadena, no un solo motor. Sin la variable de entorno, la ficha dice no configurado y no hay orden. Basta poner la clave y volver a cargar: no hay otro interruptor.

## Lo que ve el usuario

Sin claves: «PIKAS AI no configurado». Con claves: la respuesta, firmada como PIKAS AI. Si el texto nombra a otro motor, se sustituye antes de mostrarlo.

## Claves que lo encienden

Cualquiera de `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`.

Los nombres de modelo por defecto están en `.env.example`. El coste por millón de tokens del catálogo es una estimación pública y redondeada, no una factura. Si el proveedor no devuelve el uso de tokens en el stream, se aproxima por caracteres/4 y se guarda como tal.

## PIKAS AI

Chat en `/pikas` y en el botón flotante. Las respuestas salen en stream. El sistema recibe un bloque de contexto real: precios con fuente y estado, cuenta simulada, posiciones, rondas, decisiones de la arena y alertas. La instrucción le prohíbe completar huecos y le obliga a decir que es educativo, no asesoramiento financiero.

El Advisor, si no hay clave, sigue mostrando RSI, MACD, EMA, SMA, Bollinger, ATR y VWAP calculados en el servidor sobre velas reales, con la etiqueta de cálculo local. El párrafo del modelo no aparece.

## Arena

El agente «Baseline técnico» usa EMA20, EMA50 y RSI sobre las mismas velas que vería un modelo. No declara confianza. Opera solo en su cuenta de 100 USDT simulados cuando alguien pulsa «Ejecutar ciclo».

Los agentes de OpenAI, Anthropic, Gemini y Grok salen como no configurados si falta su clave. No se les atribuye una operación. La confianza que escriba un modelo, cuando haya clave, se muestra como autodeclarada.

El ranking de la arena no usa solo la rentabilidad: 45 % retorno normalizado (±20 % son los extremos), 25 % win rate y 30 % drawdown. Hacen falta al menos 3 cierres y una curva de patrimonio. Si no, no hay ganador.

## Lo que no está probado de extremo a extremo

Las llamadas vivas a OpenAI, Anthropic, Gemini, xAI y Google OAuth no se ejecutaron: no hay claves en este entorno. Sí están probados el selector, el presupuesto, el parser de los streams, la política de acceso de Google y el estado «no configurado».
