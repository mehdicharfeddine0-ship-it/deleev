module.exports = async function handler(req, res) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const cookie = process.env.DELEEV_TOKEN;
    if (!cookie) return res.status(200).json({ error: 'DELEEV_TOKEN non configuré' });

    const tokenMatch = cookie.match(/api_token=([^;]+)/);
    const apiToken = tokenMatch ? tokenMatch[1].trim() : cookie.trim();

    const action = req.query.action || '';
    const pk = req.query.pk || '';
    const page = parseInt(req.query.page) || 1;
    const BASE = 'https://admin.deleev.com';
    const headers = { 'Cookie': cookie, 'User-Agent': 'Mozilla/5.0' };

    if (action === 'list') {
      var resp = await fetch(BASE + '/systemeu/delivery_notes/', { headers, redirect: 'follow' });
      if (!resp.ok) return res.status(200).json({ error: 'HTTP ' + resp.status, rows: [] });
      var html = await resp.text();
      if (html.includes('FormSignin') || html.includes('action="/account/login"')) {
        return res.status(200).json({ error: 'Session expirée.', rows: [] });
      }
      var rows = [];
      var trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      var tr;
      while ((tr = trRe.exec(html)) !== null) {
        var tds = [];
        var tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        var td;
        while ((td = tdRe.exec(tr[1])) !== null) tds.push(td[1].replace(/<[^>]+>/g, '').trim());
        if (tds.length < 4) continue;
        var lm = tr[1].match(/delivery_note\/(\d+)/);
        rows.push({ pk: lm ? lm[1] : '', livraison: tds[0], expedition: tds[1], bl: tds[2], palettes: tds[3] });
      }
      return res.status(200).json({ rows: rows });

    } else if (action === 'bl' && pk) {
      var resp2 = await fetch(BASE + '/systemeu/raw_u20/' + pk + '/', { headers });
      if (!resp2.ok) return res.status(200).json({ error: 'HTTP ' + resp2.status });
      var text = await resp2.text();
      try { return res.status(200).json(JSON.parse(text)); }
      catch (e) { return res.status(200).json({ error: 'Réponse non-JSON' }); }

    } else if (action === 'products') {
      // Single page fetch — frontend handles pagination
      var resp3 = await fetch('https://search.deleev.com/staff/', {
        method: 'POST',
        headers: {
          'Authorization': 'Token ' + apiToken,
          'Content-Type': 'application/json;charset=UTF-8',
          'User-Agent': 'Mozilla/5.0',
        },
        body: JSON.stringify({
          indexName: 'prod_products',
          q: '*',
          perPage: 250,
          page: page,
          queryBy: 'selling_name,primeur_origin',
          filterBy: 'supplierreferences.supplier:=192',
          sortBy: 'updated_at_timestamp:desc'
        })
      });

      if (!resp3.ok) {
        var errT = '';
        try { errT = await resp3.text(); } catch(e) {}
        return res.status(200).json({ error: 'API ' + resp3.status, detail: errT.substring(0, 300) });
      }

      var data = await resp3.json();
      var hits = data.hits || [];
      var products = [];

      for (var i = 0; i < hits.length; i++) {
        var d = hits[i].document || hits[i];
        var c9 = (d.by_centers && d.by_centers['9']) ? d.by_centers['9'] : null;

        var dlcStock = null, dlcSale = null;
        if (d.retention_periods && Array.isArray(d.retention_periods)) {
          for (var j = 0; j < d.retention_periods.length; j++) {
            var rp = d.retention_periods[j];
            if (rp.center === 9 || rp.center_id === 9) {
              if (rp.stock_retention_days != null) dlcStock = rp.stock_retention_days;
              if (rp.sale_retention_days != null) dlcSale = rp.sale_retention_days;
            }
          }
        }
        if (dlcStock === null && typeof d.days_before_expiry === 'number') dlcStock = d.days_before_expiry;
        if (dlcStock === null && typeof d.lifetime_days === 'number') dlcStock = d.lifetime_days;

        var typoMap = { 1: 'Sec', 2: 'Surgelé', 3: 'Frais', 4: 'Fruits & Légumes' };

        products.push({
          id: d.id || 0,
          name: d.selling_name || '',
          barcode: d.barcode || '',
          typology: typoMap[d.typology] || String(d.typology || ''),
          stock: c9 ? c9.stock_quantity : null,
          realStock: c9 ? c9.real_stock_quantity : null,
          qi: c9 ? c9.quantity_ideal : null,
          qd: c9 ? c9.quantity_threshold : null,
          dlc_stock: dlcStock,
          dlc_sale: dlcSale,
          dlc_active: !!d.dlc_management_enabled,
          pack: d.pack || 1,
          bio: !!d.bio,
        });
      }

      return res.status(200).json({
        page: page,
        count: products.length,
        found: data.found || 0,
        products: products
      });

    } else {
      return res.status(200).json({ error: 'action=list, action=bl&pk=XXX, ou action=products&page=N' });
    }
  } catch (globalErr) {
    return res.status(200).json({ error: 'Crash: ' + globalErr.message });
  }
};
