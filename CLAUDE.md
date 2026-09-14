# CLAUDE.md — Crypto Ten Bagger Hunter

Contexto permanente del proyecto. Leé esto antes de proponer o hacer cualquier cambio.

## Qué es

Buscador de protocolos y cadenas con ingresos reales, de **Descalzi Finanzas**. Rastrea el universo completo (~1.000 activos), filtra por criterios fundamentales y devuelve un ranking puntuado. Es el equivalente cripto del Ten Bagger Hunter de acciones.

Su hermano es el **Crypto Moat Scanner**, que analiza un activo a fondo.

## Arquitectura

```
index.html          Frontend completo: modos, filtros, ranking, export CSV
api/universe.js     GET /api/universe → universo con métricas ya calculadas
api/serie.js        GET /api/serie?key=… → serie mensual de fees (lo usa el Scanner)
```

**El backend es idéntico al del Crypto Moat Scanner.** Si tocás `api/universe.js` en uno, copialo al otro: son proyectos de Vercel separados a propósito, pero comparten exactamente el mismo backend.

**Diferencia clave con la versión de acciones:** acá el rastreo **no hace una llamada por candidata**. El backend arma el universo entero de una vez y lo cachea 30 minutos; el frontend filtra y puntúa en el navegador. Por eso no hay límites de llamadas ni un campo de API key en la interfaz — el problema que sí tiene el Ten Bagger de acciones.

## Fuentes de datos — ninguna requiere API key

DefiLlama (fees, revenue, holders revenue, TVL, cadenas) y CoinGecko (precio, market cap, FDV, supply). `COINGECKO_API_KEY` es **opcional**: sin ella funciona, con una key del plan Demo gratuito sube el límite de llamadas.

**Importante:** `/overview/revenue` de DefiLlama devuelve 500. El revenue se pide como `dataType=dailyRevenue` sobre `/overview/fees`.

## Modos de descubrimiento

| Modo | Busca |
|---|---|
| **Cash Cows** | Retienen mucho de lo que cobran y cotizan barato contra sus fees |
| **Emergentes** | Chicos, creciendo fuerte, capitalización todavía baja |
| **Blue Chips** | Líderes de categoría con ingresos grandes y consolidados |
| **Valor** | Cotizan por debajo de la mediana de su categoría |
| **Cadenas** | Solo L1 y L2, comparadas entre sí |
| **Personalizado** | Los filtros que ponga el usuario |

## El modelo

Usa **exactamente el mismo scoring que el Crypto Moat Scanner** (tracción 25%, rentabilidad 20%, crecimiento 15%, tokenomics 15%, valuación 15%, riesgo 10%). Si cambiás la fórmula en uno, cambiala en el otro o los rankings dejan de ser comparables.

Equivalencias con el análisis de acciones: fees = ingresos · revenue = utilidad · holders revenue = dividendos · take rate = margen · revenue/TVL = ROIC · P/Fees = P/E · dilución = deuda · cuota de fees en la categoría = moat.

No tiene escenarios de valuación: eso vive en el Scanner.

## Detalles de implementación que conviene conocer

1. **`URL_SCANNER`** es una constante al principio del script. Si se completa con la URL del Crypto Moat Scanner, cada fila del ranking enlaza a la ficha del activo (`?q=clave`). Vacía, no enlaza.
2. **Ordenamiento de la tabla**: `orden.dir === -1` significa de mayor a menor. Los nulos van siempre al final (`-Infinity`). El primer clic sobre una columna ordena descendente; el segundo invierte.
3. **Los descartes se cuentan por motivo** y, cuando no pasa nadie, se muestran los cuatro motivos principales. Es lo que evita el problema que tuvo el Ten Bagger de acciones, donde un filtro vaciaba la lista sin explicar por qué.
4. **Filtro "Exigir token listado"**: por defecto en Sí. Muchos protocolos con fees enormes no tienen token (o no se pudo vincular), y sin capitalización no hay múltiplos que comparar.

## Casos de prueba

Después de cualquier cambio, correr el modo **Cash Cows** y verificar que devuelva candidatas con take rate alto y P/Fees bajo, y el modo **Cadenas**, que tiene que traer Ethereum, Solana y compañía.

## Cómo trabaja el usuario

Juan Pedro **no es programador**. Sube los archivos arrastrándolos a la web de GitHub. Decile exactamente qué botón tocar. Explicá en castellano llano.

## Tono de la app

Castellano rioplatense. **No recomienda comprar ni vender.** El aviso de riesgo va siempre visible: los criptoactivos son de altísimo riesgo y pueden perder todo su valor.
