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

    } else if (action === 'debug') {
      // Return raw DLC-related fields for first 2 products
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
          perPage: 2,
          page: 1,
          queryBy: 'selling_name,primeur_origin',
          filterBy: 'supplierreferences.supplier:=192',
          sortBy: 'updated_at_timestamp:desc'
        })
      });
      var data3 = await resp3.json();
      var hit = data3.hits && data3.hits[0] ? (data3.hits[0].document || data3.hits[0]) : null;
      if (!hit) return res.status(200).json({ error: 'No hits' });

      return res.status(200).json({
        id: hit.id,
        name: hit.selling_name,
        retention_periods: hit.retention_periods || 'NOT_FOUND',
        days_before_expiry: hit.days_before_expiry || 'NOT_FOUND',
        lifetime_days: hit.lifetime_days || 'NOT_FOUND',
        dlc_management_enabled: hit.dlc_management_enabled,
        by_centers_9_keys: hit.by_centers && hit.by_centers['9'] ? Object.keys(hit.by_centers['9']) : 'NOT_FOUND',
        // Look for any key containing 'dlc', 'retention', 'sale', 'expiry', 'vente'
        dlc_related_keys: Object.keys(hit).filter(function(k) {
          var kl = k.toLowerCase();
          return kl.includes('dlc') || kl.includes('retention') || kl.includes('sale') || kl.includes('expiry') || kl.includes('vente') || kl.includes('lifetime') || kl.includes('days');
        }),
        // Also dump by_sites if it has DLC info
        by_sites_keys: hit.by_sites ? Object.keys(hit.by_sites) : 'NOT_FOUND',
        by_sites_sample: hit.by_sites ? hit.by_sites[Object.keys(hit.by_sites)[0]] : 'NOT_FOUND',
        // Dump by_centers_and_sites
        by_centers_and_sites_sample: hit.by_centers_and_sites ? (typeof hit.by_centers_and_sites === 'object' ? JSON.stringify(hit.by_centers_and_sites).substring(0, 500) : hit.by_centers_and_sites) : 'NOT_FOUND',
      });

    } else if (action === 'products') {
      var resp4 = await fetch('https://search.deleev.com/staff/', {
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

      if (!resp4.ok) {
        var errT = '';
        try { errT = await resp4.text(); } catch(e) {}
        return res.status(200).json({ error: 'API ' + resp4.status, detail: errT.substring(0, 300) });
      }

      var data4 = await resp4.json();
      var hits = data4.hits || [];
      var products = [];

      for (var i = 0; i < hits.length; i++) {
        var d = hits[i].document || hits[i];
        var c9 = (d.by_centers && d.by_centers['9']) ? d.by_centers['9'] : null;

        var dlcStock = null, dlcSale = null;
        
        // Try retention_periods
        if (d.retention_periods && typeof d.retention_periods === 'object') {
          if (Array.isArray(d.retention_periods)) {
            for (var j = 0; j < d.retention_periods.length; j++) {
              var rp = d.retention_periods[j];
              if (rp.center === 9 || rp.center_id === 9) {
                if (rp.stock_retention_days != null) dlcStock = rp.stock_retention_days;
                if (rp.sale_retention_days != null) dlcSale = rp.sale_retention_days;
              }
            }
          } else {
            // Maybe it's an object keyed by center
            var rp9 = d.retention_periods['9'] || d.retention_periods[9];
            if (rp9) {
              if (rp9.stock_retention_days != null) dlcStock = rp9.stock_retention_days;
              if (rp9.sale_retention_days != null) dlcSale = rp9.sale_retention_days;
              // Try alternative field names
              if (dlcStock === null && rp9.stock != null) dlcStock = rp9.stock;
              if (dlcSale === null && rp9.sale != null) dlcSale = rp9.sale;
              if (dlcSale === null && rp9.client != null) dlcSale = rp9.client;
            }
          }
        }
        
        // Fallback for dlcStock
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
        found: data4.found || 0,
        products: products
      });

    } else {
      return res.status(200).json({ error: 'action=list, bl, products, ou debug' });
    }
  } catch (globalErr) {
    return res.status(200).json({ error: 'Crash: ' + globalErr.message });
  }
};
