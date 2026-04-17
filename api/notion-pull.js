export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const notionToken = process.env.NOTION_TOKEN;
  if (!notionToken) return res.status(500).json({ error: 'NOTION_TOKEN not configured' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'mcp-client-2025-04-04',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: 'You are a data retrieval agent. Query the Notion QM Right Pricing database and return ALL rows as a JSON array. Return ONLY a raw JSON array — no markdown, no explanation, no backticks, no preamble. Each object must include these exact keys: Publisher, Season, "MPQS Score", "GP/TH", "Adjusted LTV", "Target CPA", "Actual CPA", "CPA Delta", "Conversion Rate %", "CR to Hit Target", "Effectuation %", "RDE %", "Demo Age Over 75 %", "SC % 60+", "OEP Bid", "AEP Bid", "Suggested Bid", "Bid Change %", "RP Action", "Action Band", "Status", "Sub IDs", "Partner Notes". Use null for missing values.',
        messages: [{
          role: 'user',
          content: 'Query the QM Right Pricing Notion database (collection://6a85e45a-25c4-4403-a0bd-f54c201e1889) and return all rows as a JSON array. Return only the raw JSON array, nothing else.'
        }],
        mcp_servers: [{
          type: 'url',
          url: 'https://mcp.notion.com/mcp',
          name: 'notion-mcp',
          authorization_token: notionToken,
        }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: data.error?.message || 'Anthropic API error', detail: data });
    }

    // Extract the JSON array from the response content
    let raw = '';
    for (const block of (data.content || [])) {
      if (block.type === 'text') raw += block.text;
    }

    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) {
      return res.status(500).json({ error: 'No JSON array in response', raw: raw.slice(0, 500) });
    }

    const rows = JSON.parse(match[0]);
    return res.status(200).json({ rows, count: rows.length, pulledAt: new Date().toISOString() });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
