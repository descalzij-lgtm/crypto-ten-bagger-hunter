/* ============================================================
   Crypto Scanner / Crypto Hunter · Serverless function (Vercel)
   GET /api/universe            → universo completo con métricas
   GET /api/universe?id=uniswap → un solo activo

   Fuentes (ambas gratuitas, sin API key obligatoria):
   - DefiLlama  api.llama.fi   → fees, revenue, holders revenue, TVL
   - CoinGecko  api.coingecko.com → precio, market cap, FDV, supply

   Si existe la variable de entorno COINGECKO_API_KEY (plan Demo
   gratuito), se usa para levantar el límite de llamadas. Sin ella
   también funciona.
   ============================================================ */

const LLAMA = "https://api.llama.fi";
const CG = "https://api.coingecko.com/api/v3";
const Q = "excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true";

const TOP_N = 400;        // cuántos activos se enriquecen con datos de mercado
const VEST_YEARS = 4;     // supuesto: el supply no circulante se emite en 4 años

const num = (x) => (x === null || x === undefined || x === "" || isNaN(x)) ? null : Number(x);
const dv = (a, b) => (a !== null && a !== undefined && b !== null && b !== undefined && b !== 0) ? a / b : null;
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

function median(arr) {
  const s = arr.filter((v) => v !== null && v !== undefined && isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* Clave de agrupación: junta las versiones de un mismo protocolo
   (Uniswap V1 + V2 + V3 → uniswap) usando el parentProtocol de DefiLlama. */
function groupKey(p) {
  if (p.parentProtocol) return String(p.parentProtocol).replace("parent#", "");
  return p.slug || String(p.name || "").toLowerCase().replace(/\s+/g, "-");
}

/* "hyperliquid" → "Hyperliquid". Se usa cuando el activo agrupa varias
   versiones: tomar el nombre de una subversión daría "Uniswap V1". */
function prettyName(key) {
  return String(key || "").split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function foldOverview(json, target, field) {
  (json.protocols || []).forEach((p) => {
    const k = groupKey(p);
    if (!target[k]) {
      target[k] = {
        key: k, name: p.displayName || p.name, category: p.category || null,
        logo: p.logo || null, protocolType: p.protocolType || "protocol",
        chainsFees: p.chains || [],
      };
    }
    const t = target[k];
    // Los agregados de un protocolo con varias versiones se suman
    t[field + "24h"] = (t[field + "24h"] || 0) + (num(p.total24h) || 0);
    t[field + "30d"] = (t[field + "30d"] || 0) + (num(p.total30d) || 0);
    t[field + "Prev30d"] = (t[field + "Prev30d"] || 0) + (num(p.total60dto30d) || 0);
    t[field + "1y"] = (t[field + "1y"] || 0) + (num(p.total1y) || 0);
    // Si el activo agrupa varias versiones, el nombre sale de la clave del padre
    if (p.parentProtocol) t.name = prettyName(k);
    if (p.protocolType === "chain") t.protocolType = "chain";
  });
}

async function getJson(url, headers) {
  const r = await fetch(url, headers ? { headers } : undefined);
  if (!r.ok) throw new Error(url.split("?")[0] + " → " + r.status);
  return r.json();
}

async function buildUniverse() {
  const cgHeaders = process.env.COINGECKO_API_KEY
    ? { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY } : null;

  const [fees, rev, hold, protocols, chains, cgList] = await Promise.all([
    getJson(`${LLAMA}/overview/fees?${Q}&dataType=dailyFees`),
    getJson(`${LLAMA}/overview/fees?${Q}&dataType=dailyRevenue`),
    getJson(`${LLAMA}/overview/fees?${Q}&dataType=dailyHoldersRevenue`),
    getJson(`${LLAMA}/protocols`),
    getJson(`${LLAMA}/v2/chains`),
    getJson(`${CG}/coins/list`, cgHeaders).catch(() => []),
  ]);

  /* Índices de CoinGecko para vincular un protocolo con su token cuando
     DefiLlama no trae el gecko_id (le pasa a Uniswap, Hyperliquid y muchos más) */
  const cgPorNombre = {}, cgPorSimbolo = {};
  (cgList || []).forEach((c) => {
    const n = String(c.name || "").toLowerCase();
    const s = String(c.symbol || "").toLowerCase();
    if (n && !cgPorNombre[n]) cgPorNombre[n] = c.id;
    if (s) (cgPorSimbolo[s] = cgPorSimbolo[s] || []).push(c.id);
  });

  const map = {};
  foldOverview(fees, map, "fees");
  foldOverview(rev, map, "rev");
  foldOverview(hold, map, "hold");

  /* TVL, símbolo y gecko_id desde /protocols, agrupados igual */
  const meta = {};
  (protocols || []).forEach((p) => {
    const k = groupKey(p);
    if (!meta[k]) meta[k] = { tvl: 0, symbol: null, geckoId: null, chains: new Set(), url: null, description: null, listedAt: null };
    const m = meta[k];
    m.tvl += num(p.tvl) || 0;
    if (!m.symbol && p.symbol && p.symbol !== "-") m.symbol = p.symbol;
    if (!m.geckoId && p.gecko_id) m.geckoId = p.gecko_id;
    if (!m.url && p.url) m.url = p.url;
    if (!m.description && p.description) m.description = p.description;
    if (p.listedAt && (!m.listedAt || p.listedAt < m.listedAt)) m.listedAt = p.listedAt;
    (p.chains || []).forEach((c) => m.chains.add(c));
  });

  /* Las cadenas (L1/L2) traen su TVL y su gecko_id de /v2/chains */
  const chainMeta = {};
  (chains || []).forEach((c) => {
    const k = String(c.name || "").toLowerCase().replace(/\s+/g, "-");
    chainMeta[k] = { tvl: num(c.tvl), geckoId: c.gecko_id || null, symbol: c.tokenSymbol || null, name: c.name };
  });

  let rows = Object.values(map).map((t) => {
    const m = meta[t.key] || {};
    const cm = chainMeta[t.key] || chainMeta[String(t.name || "").toLowerCase().replace(/\s+/g, "-")] || {};
    return {
      key: t.key,
      name: t.name,
      symbol: m.symbol || cm.symbol || null,
      geckoId: m.geckoId || cm.geckoId || null,
      category: t.protocolType === "chain" ? (t.category === "Chain" ? "Blockchain" : t.category) : t.category,
      tipo: t.protocolType === "chain" ? "cadena" : "protocolo",
      logo: t.logo,
      url: m.url || null,
      description: m.description || null,
      listedAt: m.listedAt || null,
      chains: m.chains ? Array.from(m.chains) : (t.chainsFees || []),
      tvl: (m.tvl || cm.tvl || 0) || null,
      fees24h: t.fees24h || 0, fees30d: t.fees30d || 0, feesPrev30d: t.feesPrev30d || 0, fees1y: t.fees1y || 0,
      rev30d: t.rev30d || 0, revPrev30d: t.revPrev30d || 0, rev1y: t.rev1y || 0,
      hold1y: t.hold1y || 0, hold30d: t.hold30d || 0,
    };
  });

  /* Solo lo que tiene tracción real: al menos USD 100.000 de fees en el año */
  rows = rows.filter((r) => r.fees1y >= 100000);
  rows.sort((a, b) => b.fees1y - a.fees1y);

  /* Para los que no tienen gecko_id, se buscan candidatos por nombre y por
     símbolo. Si el símbolo está repetido (pasa seguido), más abajo se elige
     el candidato con mayor market cap. */
  rows.slice(0, TOP_N).forEach((r) => {
    const cands = [];
    if (r.geckoId) cands.push(r.geckoId);
    const porNombre = cgPorNombre[String(r.name || "").toLowerCase()];
    if (porNombre) cands.push(porNombre);
    const porSimbolo = cgPorSimbolo[String(r.symbol || "").toLowerCase()] || [];
    porSimbolo.slice(0, 4).forEach((id) => cands.push(id));
    r.geckoCandidatos = [...new Set(cands)];
  });

  /* Datos de mercado de CoinGecko para los más relevantes, en tandas de 250 */
  const ids = [...new Set(rows.slice(0, TOP_N).flatMap((r) => r.geckoCandidatos || []))];
  const market = {};
  for (let i = 0; i < ids.length; i += 250) {
    const batch = ids.slice(i, i + 250).join(",");
    try {
      const list = await getJson(
        `${CG}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(batch)}&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=30d,1y`,
        cgHeaders
      );
      (list || []).forEach((c) => { market[c.id] = c; });
    } catch (e) { /* si CoinGecko falla, el universo igual sirve sin datos de mercado */ }
  }

  rows.forEach((r) => {
    /* Entre los candidatos se queda el de mayor market cap: resuelve los
       símbolos repetidos sin tener que mantener una tabla a mano. */
    let c = null;
    (r.geckoCandidatos || []).forEach((id) => {
      const m = market[id];
      if (m && (!c || (num(m.market_cap) || 0) > (num(c.market_cap) || 0))) c = m;
    });
    if (c) { r.geckoId = c.id; r.tokenNombre = c.name; }
    delete r.geckoCandidatos;
    r.price = c ? num(c.current_price) : null;
    r.mcap = c ? num(c.market_cap) : null;
    r.fdv = c ? num(c.fully_diluted_valuation) : null;
    r.circSupply = c ? num(c.circulating_supply) : null;
    r.totalSupply = c ? (num(c.total_supply) || num(c.max_supply)) : null;
    r.maxSupply = c ? num(c.max_supply) : null;
    r.vol24 = c ? num(c.total_volume) : null;
    r.ath = c ? num(c.ath) : null;
    r.athChange = c ? num(c.ath_change_percentage) : null;
    r.chg30 = c ? num(c.price_change_percentage_30d_in_currency) : null;
    r.chg1y = c ? num(c.price_change_percentage_1y_in_currency) : null;
    r.rank = c ? num(c.market_cap_rank) : null;

    /* ---- Ratios: los "fundamentals" de un token ---- */
    r.takeRate = dv(r.rev1y, r.fees1y);              // cuánto del fee retiene el protocolo
    r.revTvl = dv(r.rev1y, r.tvl);                   // eficiencia del capital depositado
    r.holdersYield = dv(r.hold1y, r.mcap);           // el "dividendo" que llega al token
    r.pf = dv(r.mcap, r.fees1y);                     // precio / fees anualizados
    r.ps = dv(r.mcap, r.rev1y);                      // precio / revenue
    r.pfFdv = dv(r.fdv, r.fees1y);
    r.psFdv = dv(r.fdv, r.rev1y);
    r.dilucion = (r.fdv && r.mcap) ? (r.fdv - r.mcap) / r.mcap : null;   // emisión pendiente
    r.circPct = (r.circSupply && r.totalSupply) ? r.circSupply / r.totalSupply : null;
    r.liquidez = dv(r.vol24, r.mcap);
    r.nChains = (r.chains || []).length;

    /* Crecimiento: el último mes anualizado contra el promedio del año */
    const runRate = r.fees30d * (365 / 30);
    r.growthImplied = (r.fees1y > 0) ? runRate / r.fees1y - 1 : null;
    r.growth30 = (r.feesPrev30d > 0) ? r.fees30d / r.feesPrev30d - 1 : null;
    r.revGrowth30 = (r.revPrev30d > 0) ? r.rev30d / r.revPrev30d - 1 : null;
    r.feesRunRate = runRate;
  });

  /* Medianas por categoría: la vara contra la que se compara cada activo */
  const byCat = {};
  rows.forEach((r) => {
    if (!r.category) return;
    (byCat[r.category] = byCat[r.category] || []).push(r);
  });
  const cats = {};
  Object.keys(byCat).forEach((k) => {
    const g = byCat[k];
    cats[k] = {
      n: g.length,
      pf: median(g.map((x) => x.pf).filter((v) => v > 0 && v < 500)),
      ps: median(g.map((x) => x.ps).filter((v) => v > 0 && v < 500)),
      takeRate: median(g.map((x) => x.takeRate).filter((v) => v > 0 && v <= 1)),
      fees1y: median(g.map((x) => x.fees1y)),
    };
  });
  rows.forEach((r) => {
    const c = r.category ? cats[r.category] : null;
    r.catPF = c ? c.pf : null;
    r.catPS = c ? c.ps : null;
    r.catTake = c ? c.takeRate : null;
    /* Cuota de mercado dentro de su categoría, por fees: el proxy de "moat" */
    if (r.category && byCat[r.category]) {
      const tot = byCat[r.category].reduce((s, x) => s + (x.fees1y || 0), 0);
      r.cuotaCategoria = tot > 0 ? r.fees1y / tot : null;
    }
  });

  return { fetchedAt: new Date().toISOString(), fuente: "DefiLlama + CoinGecko", categorias: cats, activos: rows };
}

let cache = null, cacheAt = 0;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido." });

  try {
    const ahora = Date.now();
    if (!cache || ahora - cacheAt > 30 * 60 * 1000) {
      cache = await buildUniverse();
      cacheAt = ahora;
    }
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=86400");

    const id = String(req.query.id || "").trim().toLowerCase();
    if (id) {
      const a = cache.activos.find(
        (x) => x.key === id || (x.symbol || "").toLowerCase() === id || (x.name || "").toLowerCase() === id
      );
      if (!a) return res.status(404).json({ error: "No encontrado. Probá con el nombre del protocolo (uniswap, aave, hyperliquid) o su símbolo." });
      return res.status(200).json({ fetchedAt: cache.fetchedAt, categorias: cache.categorias, activo: a });
    }
    return res.status(200).json(cache);
  } catch (e) {
    return res.status(502).json({ error: "No se pudieron obtener los datos: " + e.message });
  }
};
