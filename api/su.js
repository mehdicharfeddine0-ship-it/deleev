export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const cookie = process.env.DELEEV_TOKEN;
  if (!cookie) return res.status(500).json({ error: 'DELEEV_TOKEN non configuré' });

  const tokenMatch = cookie.match(/api_token=([^;]+)/);
  const apiToken = tokenMatch ? tokenMatch[1].trim() : cookie.trim();

  const { action, pk } = req.query;
  const BASE = 'https://admin.deleev.com';
  const headers = { 'Cookie': cookie, 'User-Agent': 'Mozilla/5.0' };

  try {
    if (action === 'list') {
      const resp = await fetch(BASE + '/systemeu/delivery_notes/', { headers, redirect: 'follow' });
      if (!resp.ok) return res.status(resp.status).json({ error: 'HTTP ' + resp.status });
      const html = await resp.text();
      if (html.includes('FormSignin') || html.includes('action="/account/login"')) {
        return res.status(401).json({ error: 'Session expirée.' });
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

    } else if (action === 'products') {
      const resp = await fetch('https://search.deleev.com/staff/', {
        method: 'POST',
        headers: {
          'Authorization': 'Token ' + apiToken,
          'Content-Type': 'application/json;charset=UTF-8',
          'User-Agent': 'Mozilla/5.0',
        },
        body: JSON.stringify({
          indexName: 'prod_products',
          q: '*',
          perPage: 500,
          page: 1,
          queryBy: 'selling_name,primeur_origin',
          filterBy: 'supplierreferences.supplier:=192',
          sortBy: 'updated_at_timestamp:desc'
        })
      });
      if (!resp.ok) {
        const t = await resp.text();
        return res.status(resp.status).json({ error: 'Search API ' + resp.status, detail: t.substring(0, 300) });
      }
      const data = await resp.json();
      const products = (data.hits || []).map(h => {
        const d = h.document || h;
        return {
          id: d.id, name: d.selling_name || '', barcode: d.barcode || '',
          typology: d.typology || '', stock: d.stock_reuilly ?? d.stock ?? null,
          qi: d.qi_reuilly ?? d.qi ?? null, qd: d.qd_reuilly ?? d.qd ?? null,
          dlc_stock: d.dlc_stock_days ?? null, dlc_sale: d.dlc_sale_days ?? null,
          dlc_active: d.dlc_active ?? false, pack: d.pack || 1, bio: d.bio || false,
        };
      });
      return res.status(200).json({ count: products.length, found: data.found || 0, products });

    } else {
      return res.status(400).json({ error: 'action=list, action=bl&pk=XXX, ou action=products' });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
