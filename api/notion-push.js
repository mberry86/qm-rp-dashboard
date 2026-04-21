export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const notionToken = process.env.NOTION_TOKEN;
  if (!notionToken) return res.status(500).json({ error: 'NOTION_TOKEN not configured' });

  const { season, pubs } = req.body || {};
  if (!season || !Array.isArray(pubs)) return res.status(400).json({ error: 'Missing season or pubs in request body' });

  const DATABASE_ID = 'a64a0fd07f5b4aa18b12639b8bf7a87d';

  try {
    // First: query Notion to find all pages for this season, keyed by Publisher name
    const queryRes = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        page_size: 100,
        filter: {
          property: 'Season',
          select: { equals: season },
        },
      }),
    });

    if (!queryRes.ok) {
      const err = await queryRes.json().catch(() => ({}));
      return res.status(queryRes.status).json({ error: `Notion query error: ${queryRes.status}`, detail: err?.message });
    }

    const queryData = await queryRes.json();

    // Build a map of publisher name -> page ID
    const pageMap = {};
    for (const page of queryData.results) {
      const name = page.properties?.Publisher?.title?.[0]?.plain_text;
      if (name) pageMap[name] = page.id;
    }

    // Update each publisher's page with fresh RP outputs
    const updates = [];
    for (const pub of pubs) {
      const pageId = pageMap[pub.name];
      if (!pageId) continue;

      const props = {
        'MPQS Score': pub.mpqsGrade ? { select: { name: pub.mpqsGrade } } : null,
        'RP Action':  pub.rpAction  ? { select: { name: pub.rpAction  } } : null,
        'Action Band': pub.actionBand ? { select: { name: pub.actionBand } } : null,
        'Status':     pub.status    ? { select: { name: pub.status    } } : null,
        'Actual CPA': pub.actualCpa != null ? { number: pub.actualCpa } : null,
        'CPA Delta':  pub.cpaDelta  != null ? { number: pub.cpaDelta  } : null,
        'Suggested Bid': pub.suggBid != null ? { number: pub.suggBid  } : null,
        'Effectuation %': pub.eff != null ? { number: pub.eff } : null,
        'RDE %':      pub.rde != null ? { number: pub.rde } : null,
        'Demo Age Over 75 %': pub.age75 != null ? { number: pub.age75 } : null,
        'GP/TH':      pub.gpth != null ? { number: pub.gpth } : null,
        'Conversion Rate %': pub.cr != null ? { number: pub.cr } : null,
      };

      // Remove null entries
      const cleanProps = Object.fromEntries(Object.entries(props).filter(([, v]) => v !== null));

      const updateRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${notionToken}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ properties: cleanProps }),
      });

      updates.push({ name: pub.name, status: updateRes.ok ? 'updated' : 'failed', code: updateRes.status });
    }

    const succeeded = updates.filter(u => u.status === 'updated').length;
    const failed = updates.filter(u => u.status === 'failed').length;

    return res.status(200).json({
      season,
      updated: succeeded,
      failed,
      skipped: pubs.length - updates.length,
      pushedAt: new Date().toISOString(),
      details: updates,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
