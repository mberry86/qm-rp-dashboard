// api/notion-push.js
// Vercel serverless function — push RP formula outputs back to Notion
// Writes Enhanced Bid, MPQS Multiplier, Sub ID QI to each publisher row

const NOTION_API     = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// MPQS multipliers
const MPQS_MULT = { A: 1.15, B: 1.00, C: 0.85, D: 0.70 };

// Default season config (fallback if not passed)
const SEASON_CONFIG = {
  SEP: { cr: 9.0,  cpa: 325, eff: 73, ltv: 730, ltvPct: 0.45 },
  OEP: { cr: 10.0, cpa: 325, eff: 72, ltv: 730, ltvPct: 0.45 },
  AEP: { cr: 16.0, cpa: 275, eff: 74, ltv: 730, ltvPct: 0.45 },
};

function calcBaseBid(pub, seasonCfg) {
  const ltv = pub.ltv  || seasonCfg.ltv;
  const cr  = pub.cr   || seasonCfg.cr;
  const eff = pub.eff  || seasonCfg.eff;
  return ltv * (eff / 100) * seasonCfg.ltvPct * (cr / 100);
}

function calcSubIdQI(subIds, subIdMap) {
  if (!subIds || subIds.length === 0) return 1.0;
  const qis = subIds.map(id => subIdMap[id]?.qi ?? 1.0);
  return qis.reduce((a, b) => a + b, 0) / qis.length;
}

async function updateNotionPage(pageId, properties) {
  const token = process.env.NOTION_TOKEN;
  const res = await fetch(`${NOTION_API}/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion PATCH error ${res.status} for page ${pageId}: ${err}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  try {
    const { publishers, subIdMap, season } = req.body;

    if (!publishers || !Array.isArray(publishers)) {
      return res.status(400).json({ ok: false, error: 'publishers array required' });
    }

    const seasonCfg = SEASON_CONFIG[season] || SEASON_CONFIG.SEP;
    const results   = [];
    const errors    = [];

    for (const pub of publishers) {
      if (!pub.notionPageId) continue;

      try {
        const grade      = pub.mpqsGrade || 'B';
        const mpqsMult   = MPQS_MULT[grade] || 1.0;
        const qi         = calcSubIdQI(pub.subIds, subIdMap || {});
        const baseBid    = calcBaseBid(pub, seasonCfg);
        const enhBid     = +(baseBid * mpqsMult * qi).toFixed(2);

        await updateNotionPage(pub.notionPageId, {
          'Enhanced Bid':    { number: enhBid },
          'MPQS Multiplier': { number: mpqsMult },
          'Sub ID QI':       { number: +qi.toFixed(4) },
        });

        results.push({
          publisher:  pub.name,
          enhBid,
          mpqsMult,
          qi: +qi.toFixed(4),
        });

      } catch (err) {
        errors.push({ publisher: pub.name, error: err.message });
      }
    }

    return res.status(200).json({
      ok: true,
      pushedAt: new Date().toISOString(),
      season,
      updated: results.length,
      results,
      errors,
    });

  } catch (err) {
    console.error('notion-push error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
