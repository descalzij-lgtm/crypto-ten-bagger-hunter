/* ============================================================
   Serie histórica de fees / revenue de un protocolo o cadena
   GET /api/serie?key=uniswap&tipo=dailyFees
   Proxy de DefiLlama /summary/fees/{key}. Sin API key.
   ============================================================ */

const LLAMA = "https://api.llama.fi";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const key = String(req.query.key || "").trim().toLowerCase();
  if (!/^[a-z0-9.\-_]{1,60}$/.test(key)) return res.status(400).json({ error: "Clave inválida." });
  const tipo = req.query.tipo === "dailyRevenue" ? "dailyRevenue" : "dailyFees";

  try {
    const r = await fetch(`${LLAMA}/summary/fees/${encodeURIComponent(key)}?dataType=${tipo}`);
    if (!r.ok) return res.status(200).json({ serie: [], aviso: "Sin serie histórica para este activo." });
    const j = await r.json();

    /* La serie diaria se agrupa por mes: cinco años de datos diarios no
       aportan nada en un gráfico y pesan de más. */
    const porMes = {};
    (j.totalDataChart || []).forEach(([ts, v]) => {
      const d = new Date(ts * 1000);
      const k = d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
      porMes[k] = (porMes[k] || 0) + (Number(v) || 0);
    });
    const serie = Object.keys(porMes).sort().map((k) => ({ mes: k, valor: porMes[k] }));

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({
      nombre: j.displayName || j.name || key,
      categoria: j.category || null,
      metodologia: j.methodologyURL || null,
      serie: serie.slice(-60),
    });
  } catch (e) {
    return res.status(200).json({ serie: [], aviso: "No se pudo obtener la serie histórica." });
  }
};
