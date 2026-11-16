# AI Router y PIKAS AI

Un solo módulo elige proveedor, recorta el contexto, estima el coste y registra cada llamada. Los módulos no guardan clientes sueltos.

## Selección

- Pregunta simple o resumen: modelo barato configurado.
- Análisis, coordinación o decisión de trading: modelo potente si existe; si no, el barato, y el motivo queda escrito.
- Preferencia: `AI_PREFERRED_PROVIDER`.
- Si la llamada falla, se prueba el siguiente proveedor configurado.
- Si el gasto estimado del día o del mes llega al tope, no hay más llamadas.

Sin ninguna clave el resultado es `not_configured`. La interfaz de PIKAS AI muestra exactamente «PIKAS AI no configurado». No hay una respuesta local disfrazada de modelo.

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
