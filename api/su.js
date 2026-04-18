export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.DELEEV_TOKEN;
  if (!token) return res.status(500).json({ error: 'DELEEV_TOKEN non configuré sur Vercel' });

  const { action, pk } = req.query;
  const BASE = 'https://admin.deleev.com';
  const headers = {
    'Cookie': 'api_token=' + token,
    'User-Agent': 'Mozilla/5.0',
  };

  try {
    if (action === 'list') {
      const resp = await fetch(BASE + '/systemeu/delivery_notes/', { headers });
      if (!resp.ok) return res.status(resp.status).json({ error: 'HTTP ' + resp.status });
      const html = await resp.text();

      if (html.includes('id_username') || html.includes('/admin/login/')) {
        return res.status(401).json({ error: 'Token expiré. Mettez à jour DELEEV_TOKEN sur Vercel.' });
      }

      const rows = [];
      const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let tr;
      while ((tr = trRe.exec(html)) !== null) {
        const tds = [];
        const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let td;
        while ((td = tdRe.exec(tr[1])) !== null) tds.push(td[1].replace(/<[^>]+>/g, '').trim());
        if (tds.length < 4) continue;
        const lm = tr[1].match(/delivery_note\/(\d+)/);
        rows.push({ pk: lm ? lm[1] : '', livraison: tds[0], expedition: tds[1], bl: tds[2], palettes: tds[3] });
      }
      return res.status(200).json({ rows });

    } else if (action === 'bl' && pk) {
      const resp = await fetch(BASE + '/systemeu/raw_u20/' + pk + '/', { headers });
      if (!resp.ok) return res.status(resp.status).json({ error: 'HTTP ' + resp.status });
      const json = await resp.json();
      return res.status(200).json(json);

    } else {
      return res.status(400).json({ error: 'action=list ou action=bl&pk=XXX' });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
