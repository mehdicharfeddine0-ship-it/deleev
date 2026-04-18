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
      catch (e) { return res.status(200).json({ error: 'Réponse non-JSON', preview: text.substring(0, 200) }); }

    } else if (action === 'products') {
      var searchHeaders = {
        'Authorization': 'Token ' + apiToken,
        'Content-Type': 'application/json;charset=UTF-8',
        'User-Agent': 'Mozilla/5.0',
      };

      var allProducts = [];
      var page = 1;
      var totalFound = 0;
      var lastError = null;

      while (page <= 40) {
        var resp3;
        try {
          resp3 = await fetch('https://search.deleev.com/staff/', {
            method: 'POST',
            headers: searchHeaders,
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
        } catch (fetchErr) {
          lastError = 'Fetch error page ' + page + ': ' + fetchErr.message;
          break;
        }

        if (!resp3.ok) {
          var errT = '';
          try { errT = await resp3.text(); } catch(e) {}
          lastError = 'API ' + resp3.status + ' page ' + page + ': ' + errT.substring(0, 200);
          break;
        }

        var data;
        try { data = await resp3.json(); }
        catch (jsonErr) { lastError = 'JSON parse error page ' + page; break; }

        totalFound = data.found || totalFound;
        var hits = data.hits || [];

        for (var i = 0; i < hits.length; i++) {
          var h = hits[i];
          // Data is directly on the hit, not in .document
          var d = h.document || h;

          // Get center 9 (Reuilly) data
          var c9 = null;
          if (d.by_centers && d.by_centers['9']) c9 = d.by_centers['9'];

          // Parse retention periods for DLC stock/sale days
          var dlcStock = null;
          var dlcSale = null;
          if (d.retention_periods && Array.isArray(d.retention_periods)) {
            d.retention_periods.forEach(function(rp) {
              if (rp.center === 9 || rp.center_id === 9) {
                if (rp.stock_retention_days != null) dlcStock = rp.stock_retention_days;
                if (rp.sale_retention_days != null) dlcSale = rp.sale_retention_days;
              }
            });
          }
          // Fallback to days_before_expiry or lifetime_days
          if (dlcStock === null && typeof d.days_before_expiry === 'number') dlcStock = d.days_before_expiry;
          if (dlcStock === null && typeof d.lifetime_days === 'number') dlcStock = d.lifetime_days;

          // Typology: 1=Sec, 2=Surgelé, 3=Frais, etc
          var typoMap = { 1: 'Sec', 2: 'Surgelé', 3: 'Frais', 4: 'Fruits & Légumes' };
          var typoLabel = typoMap[d.typology] || (d.typology ? String(d.typology) : '—');

          allProducts.push({
            id: d.id || 0,
            name: d.selling_name || d.name || '',
            barcode: d.barcode || '',
            typology: typoLabel,
            stock: c9 ? c9.stock_quantity : null,
            realStock: c9 ? c9.real_stock_quantity : null,
            qi: c9 ? c9.quantity_ideal : null,
            qd: c9 ? c9.quantity_threshold : null,
            dlc_stock: dlcStock,
            dlc_sale: dlcSale,
            dlc_active: !!d.dlc_management_enabled,
            pack: d.pack || 1,
            bio: !!d.bio,
            brand: d.brand_name || d.brand || '',
            zone: c9 ? c9.area : null,
            shelf: c9 ? c9.shelf : null,
            price_buy: d.purchase_price || null,
            price_sell: d.price || null,
          });
        }

        if (hits.length < 250 || allProducts.length >= totalFound) break;
        page++;
      }

      return res.status(200).json({
        count: allProducts.length,
        found: totalFound,
        products: allProducts,
        pages: page,
        error: lastError || undefined
      });

    } else {
      return res.status(200).json({ error: 'action=list, action=bl&pk=XXX, ou action=products' });
    }
  } catch (globalErr) {
    return res.status(200).json({ error: 'Crash: ' + globalErr.message });
  }
};
