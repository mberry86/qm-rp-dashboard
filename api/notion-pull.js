export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const notionToken = process.env.NOTION_TOKEN;
  if (!notionToken) return res.status(500).json({ error: 'NOTION_TOKEN not configured' });

  const { season } = req.body || {};
  const DATABASE_ID = 'a64a0fd07f5b4aa18b12639b8bf7a87d';

  try {
    const body = { page_size: 100, sorts: [{ property: 'Publisher', direction: 'ascending' }] };

    // Filter by season if provided
    if (season && ['SEP','OEP','AEP'].includes(season)) {
      body.filter = { property: 'Season', select: { equals: season } };
    }

    const response = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        error: `Notion API error: ${response.status}`,
        detail: err?.message || JSON.stringify(err),
      });
    }

    const data = await response.json();

    const rows = data.results.map(page => {
      const p = page.properties;
      const get = (prop, type) => {
        if (!p[prop]) return null;
        switch (type) {
          case 'title':  return p[prop].title?.[0]?.plain_text ?? null;
          case 'text':   return p[prop].rich_text?.[0]?.plain_text ?? null;
          case 'number': return p[prop].number ?? null;
          case 'select': return p[prop].select?.name ?? null;
          default:       return null;
        }
      };

      return {
        'Publisher':          get('Publisher', 'title'),
        'Season':             get('Season', 'select'),
        'MPQS Score':         get('MPQS Score', 'select'),
        'GP/TH':              get('GP/TH', 'number'),
        'Adjusted LTV':       get('Adjusted LTV', 'number'),
        'Target CPA':         get('Target CPA', 'number'),
        'Actual CPA':         get('Actual CPA', 'number'),
        'CPA Delta':          get('CPA Delta', 'number'),
        'Conversion Rate %':  get('Conversion Rate %', 'number'),
        'CR to Hit Target':   get('CR to Hit Target', 'number'),
        'Effectuation %':     get('Effectuation %', 'number'),
        'RDE %':              get('RDE %', 'number'),
        'Demo Age Over 75 %': get('Demo Age Over 75 %', 'number'),
        'SC % 60+':           get('SC % 60+', 'number'),
        'OEP Bid':            get('OEP Bid', 'number'),
        'AEP Bid':            get('AEP Bid', 'number'),
        'Suggested Bid':      get('Suggested Bid', 'number'),
        'Bid Change %':       get('Bid Change %', 'number'),
        'RP Action':          get('RP Action', 'select'),
        'Action Band':        get('Action Band', 'select'),
        'Status':             get('Status', 'select'),
        'Sub IDs':            get('Sub IDs', 'text'),
        'Partner Notes':      get('Partner Notes', 'text'),
      };
    }).filter(r => r['Publisher']);

    return res.status(200).json({
      rows,
      count: rows.length,
      season: season || 'all',
      pulledAt: new Date().toISOString(),
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
