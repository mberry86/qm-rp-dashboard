// api/notion-pull.js
// Vercel serverless function — live Notion pull
// Queries QM Right Pricing DB + Joanie QM Scorecards DB
// Returns combined publisher data for the active season

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// Data source IDs — from your Notion workspace
const RP_DB       = '6a85e45a-25c4-4403-a0bd-f54c201e1889'; // QM Right Pricing
const SCORES_DB   = '337cb15b-3901-80f2-8500-000ba6ddf12e'; // Joanie QM Scorecards
const SUBID_DB    = '56212d1b-4b98-4044-9618-63bd353a7c78'; // QM Sub ID Intelligence

async function queryNotion(databaseId, filter, sorts) {
  const token = process.env.NOTION_TOKEN;
  const body = { page_size: 100 };
  if (filter) body.filter = filter;
  if (sorts)  body.sorts  = sorts;

  const res = await fetch(`${NOTION_API}/databases/${databaseId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion API error ${res.status}: ${err}`);
  }
  return res.json();
}

function getProp(page, name, type) {
  const prop = page.properties?.[name];
  if (!prop) return null;
  switch (type) {
    case 'title':   return prop.title?.[0]?.plain_text ?? null;
    case 'text':    return prop.rich_text?.[0]?.plain_text ?? null;
    case 'number':  return prop.number ?? null;
    case 'select':  return prop.select?.name ?? null;
    case 'date':    return prop.date?.start ?? null;
    default:        return null;
  }
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const season = req.query.season || 'SEP';

  try {
    // ── 1. Pull QM Right Pricing rows for this season ──
    const rpData = await queryNotion(RP_DB, {
      property: 'Season',
      select: { equals: season },
    }, [{ property: 'Publisher', direction: 'ascending' }]);

    // ── 2. Pull Scorecards (all, most recent per publisher) ──
    const scData = await queryNotion(SCORES_DB, {
      property: 'Scorecard Type',
      select: { equals: 'QM' },
    }, [{ property: 'Date', direction: 'descending' }]);

    // ── 3. Pull Sub ID Intelligence ──
    const siData = await queryNotion(SUBID_DB, {}, []);

    // ── Map RP rows ──
    const publishers = rpData.results.map(p => ({
      notionPageId:  p.id,
      name:          getProp(p, 'Publisher',        'title'),
      season:        getProp(p, 'Season',           'select'),
      mpqsGrade:     getProp(p, 'MPQS Score',       'select'),
      gpth:          getProp(p, 'GP/TH',            'number'),
      ltv:           getProp(p, 'Adjusted LTV',     'number'),
      actualCpa:     getProp(p, 'Actual CPA',       'number'),
      targetCpa:     getProp(p, 'Target CPA',       'number'),
      baseBid:       getProp(p, 'Suggested Bid',    'number'),
      eff:           getProp(p, 'Effectuation %',   'number'),
      rde:           getProp(p, 'RDE %',            'number'),
      age75:         getProp(p, 'Demo Age Over 75 %','number'),
      cr:            getProp(p, 'Conversion Rate %','number'),
      sc60:          getProp(p, 'SC % 60+',         'number'),
      subIds:        (getProp(p, 'Sub IDs', 'text') || '').split(',').map(s => s.trim()).filter(Boolean),
      rpAction:      getProp(p, 'RP Action',        'select'),
      actionBand:    getProp(p, 'Action Band',      'select'),
      status:        getProp(p, 'Status',           'select'),
      cpaDelta:      getProp(p, 'CPA Delta',        'number'),
      notes:         getProp(p, 'Partner Notes',    'text'),
      enhancedBid:   getProp(p, 'Enhanced Bid',     'number'),
      mpqsMult:      getProp(p, 'MPQS Multiplier',  'number'),
      subIdQI:       getProp(p, 'Sub ID QI',        'number'),
    }));

    // ── Map scorecards — keep only most recent per publisher name ──
    const scorecardMap = {};
    scData.results.forEach(p => {
      const report  = getProp(p, 'Report', 'title') || '';
      // Extract publisher name from report title: "QM — Adolent Marketing — Feb 2026"
      const parts   = report.split('—').map(s => s.trim());
      const pubName = parts[1] || parts[0];
      if (!pubName) return;
      const key = pubName.toLowerCase().replace(/[^a-z0-9]/g,'');
      if (scorecardMap[key]) return; // already have most recent
      scorecardMap[key] = {
        pub:           pubName,
        season:        getProp(p, 'Season',           'select'),
        rawCalls:      getProp(p, 'Raw Calls',        'number'),
        billableCalls: getProp(p, 'Billable Calls',   'number'),
        billableRate:  getProp(p, 'Billable Rate %',  'number'),
        cr:            getProp(p, 'Conv Rate (CR%)',  'number'),
        transfers:     getProp(p, 'Transfers',        'number'),
        transferRate:  getProp(p, 'Transfer Rate %',  'number'),
        dupRate:       getProp(p, 'Duplicate Rate %', 'number'),
        netSales:      getProp(p, 'Net Sales',        'number'),
        cpa:           getProp(p, 'CPA',              'number'),
        eff:           getProp(p, 'Effectuation %',   'number'),
        age75:         getProp(p, 'Demo Mix % Over 75','number'),
        talkHours:     getProp(p, 'Talk Hours',       'number'),
        actionBand:    getProp(p, 'Action Band',      'select'),
        status:        getProp(p, 'Status',           'select'),
        biggestRisk:   getProp(p, 'Biggest Risk',     'text'),
        topOpp:        getProp(p, 'Top Opportunity',  'text'),
        date:          getProp(p, 'Date',             'date'),
      };
    });

    // ── Map Sub IDs ──
    const subIdMap = {};
    siData.results.forEach(p => {
      const id = getProp(p, 'Sub ID', 'title');
      if (!id) return;
      subIdMap[id] = {
        id,
        angle:  getProp(p, 'Marketing Angle',  'text'),
        cr:     getProp(p, 'Conversion Rate %','number'),
        gpth:   getProp(p, 'GP/TH',           'number'),
        eff:    getProp(p, 'Effectuation %',   'number'),
        rde:    getProp(p, 'RDE %',            'number'),
        age75:  getProp(p, 'Age 75+ %',        'number'),
        qi:     getProp(p, 'QI Index',         'number'),
        grade:  getProp(p, 'MPQS Grade',       'select'),
        status: getProp(p, 'Status',           'select'),
      };
    });

    return res.status(200).json({
      ok: true,
      season,
      pulledAt: new Date().toISOString(),
      publishers,
      scorecards: Object.values(scorecardMap),
      subIds: Object.values(subIdMap),
    });

  } catch (err) {
    console.error('notion-pull error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
