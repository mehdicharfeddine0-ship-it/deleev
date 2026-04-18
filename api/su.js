export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const cookie = process.env.DELEEV_TOKEN;
  if (!cookie) return res.status(500).json({ error: 'DELEEV_TOKEN non configuré' });

  // Extract api_token from cookie string for Authorization header
  const tokenMatch = cookie.match(/api_token=([^;]+)/);
  const apiToken = tokenMatch ? tokenMatch[1].trim() : cookie.trim();

  const { action, pk } = req.query;
  const BASE = 'https://admin.deleev.com';
  const headers = { 'Cookie': cookie, 'User-Agent': 'Mozilla/5.0' };

  try {
    // ── LIST BLs ──
    if (action === 'list') {
      const resp = await fetch(BASE + '/systemeu/delivery_notes/', { headers, redirect: 'follow' });
      if (!resp.ok) return res.status(resp.status).json({ error: 'HTTP ' + resp.status });
      const html = await resp.text();

      if (html.includes('FormSignin') || html.includes('input-password') || html.includes('action="/account/login"')) {
        return res.status(401).json({ error: 'Session expirée. Mettez à jour les cookies dans DELEEV_TOKEN sur Vercel.' });
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

    // ── FETCH BL JSON ──
    } else if (action === 'bl' && pk) {
      const resp = await fetch(BASE + '/systemeu/raw_u20/' + pk + '/', { headers });
      if (!resp.ok) return res.status(resp.status).json({ error: 'HTTP ' + resp.status });
      const json = await resp.json();
      return res.status(200).json(json);

    // ── FETCH ALL PRODUCTS (supplier 192) ──
    } else if (action === 'products') {
      const SEARCH_URL = 'https://search.deleev.com/staff/';
      const PER_PAGE = 250;
      let page = 1;
      let allProducts = [];
      let totalFound = 0;

      while (true) {
        const body = {
          indexName: 'prod_products',
          q: '*',
          perPage: PER_PAGE,
          page: page,
          queryBy: 'selling_name,primeur_origin',
          filterBy: 'supplierreferences.supplier:=192',
          sortBy: 'updated_at_timestamp:desc'
        };

        const resp = await fetch(SEARCH_URL, {
          method: 'POST',
          headers: {
            'Authorization': 'Token ' + apiToken,
            'Content-Type': 'application/json;charset=UTF-8',
            'User-Agent': 'Mozilla/5.0',
          },
          body: JSON.stringify(body)
        });

        if (!resp.ok) {
          const errText = await resp.text();
          return res.status(resp.status).json({ error: 'Search API HTTP ' + resp.status, detail: errText.substring(0, 200) });
        }

        const data = await resp.json();
        const hits = data.hits || [];
        totalFound = data.found || totalFound;

        hits.forEach(h => {
          const d = h.document || h;
          allProducts.push({
            id: d.id,
            name: d.selling_name || d.name || '',
            barcode: d.barcode || '',
            typology: d.typology || '',
            supplier_ref: d.supplier_ref || '',
            stock: d.stock_reuilly ?? d.stock ?? null,
            qi: d.qi_reuilly ?? d.qi ?? null,
            qd: d.qd_reuilly ?? d.qd ?? null,
            dlc_stock: d.dlc_stock_days ?? null,
            dlc_sale: d.dlc_sale_days ?? null,
            dlc_active: d.dlc_active ?? false,
            price_buy: d.price_buy_ht ?? null,
            price_sell: d.price_sell_ttc ?? null,
            bio: d.bio || false,
            available: d.available ?? true,
            pack: d.pack || 1,
            weight: d.weight || null,
            // Keep raw center stocks if available
            centers: d.centers || null,
          });
        });

        // Check if we got all products
        if (hits.length < PER_PAGE || allProducts.length >= totalFound) break;
        page++;
        if (page > 50) break; // safety limit
      }

      return res.status(200).json({
        count: allProducts.length,
        found: totalFound,
        products: allProducts
      });

    } else {
      return res.status(400).json({ error: 'action=list, action=bl&pk=XXX, ou action=products' });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
