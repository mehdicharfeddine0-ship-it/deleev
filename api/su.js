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
      var detailResp = await fetch(BASE + '/systemeu/delivery_note/' + pk + '/', { headers, redirect: 'follow' });
      if (!detailResp.ok) return res.status(200).json({ error: 'delivery_note HTTP ' + detailResp.status });
      var detailHtml = await detailResp.text();
      var rawMatch = detailHtml.match(/raw_u20\/(\d+)/);
      if (!rawMatch) return res.status(200).json({ error: 'Lien raw_u20 non trouvé' });
      var rawPk = rawMatch[1];
      var resp2 = await fetch(BASE + '/systemeu/raw_u20/' + rawPk + '/', { headers });
      if (!resp2.ok) return res.status(200).json({ error: 'raw_u20 HTTP ' + resp2.status });
      var text = await resp2.text();
      try { return res.status(200).json(JSON.parse(text)); }
      catch (e) { return res.status(200).json({ error: 'Réponse non-JSON' }); }

    } else if (action === 'debug') {
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
        supplierreference_set: hit.supplierreference_set || 'NOT_FOUND',
        supplierreferences: hit.supplierreferences || 'NOT_FOUND',
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

      var data = await resp4.json();
      var hits = data.hits || [];
      var products = [];
      var typoMap = { 1: 'Sec', 2: 'Surgelé', 3: 'Frais', 4: 'Fruits & Légumes' };

      for (var i = 0; i < hits.length; i++) {
        var d = hits[i].document || hits[i];
        var c9 = (d.by_centers && d.by_centers['9']) ? d.by_centers['9'] : null;

        var dlcStock = typeof d.days_before_expiry === 'number' ? d.days_before_expiry : null;
        var dlcSale = typeof d.retention_periods === 'number' ? d.retention_periods : null;
        var lifetimeDays = typeof d.lifetime_days === 'number' ? d.lifetime_days : null;

        // Extract supplier ref for supplier 192
        var supplierRef = '';
        if (d.supplierreference_set && Array.isArray(d.supplierreference_set)) {
          for (var j = 0; j < d.supplierreference_set.length; j++) {
            var sr = d.supplierreference_set[j];
            if (sr.supplier === 192 || sr.supplier_id === 192 || String(sr.supplier) === '192') {
              supplierRef = sr.supplier_reference || sr.ref || sr.reference || '';
              break;
            }
          }
        }
        if (!supplierRef && d.supplierreferences) {
          if (Array.isArray(d.supplierreferences)) {
            for (var k = 0; k < d.supplierreferences.length; k++) {
              var sr2 = d.supplierreferences[k];
              if (sr2.supplier === 192 || String(sr2.supplier) === '192') {
                supplierRef = sr2.supplier_reference || sr2.ref || sr2.reference || '';
                break;
              }
            }
          }
        }

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
          lifetime_days: lifetimeDays,
          dlc_active: !!d.dlc_management_enabled,
          pack: d.pack || 1,
          bio: !!d.bio,
          supplier_ref: supplierRef,
        });
      }

      return res.status(200).json({
        page: page,
        count: products.length,
        found: data.found || 0,
        products: products
      });

    } else if (action === 'commandes') {
      // Fetch the commandes CSV export from admin
      var respC = await fetch(BASE + '/suppliers/auto?logistics_center_id=9&franco_is_meet=-1&order_auto_enabled=-1&last_order_from=&last_order_to=&submit=export', { headers, redirect: 'follow' });
      if (!respC.ok) return res.status(200).json({ error: 'HTTP ' + respC.status });
      var csvText = await respC.text();
      if (csvText.includes('FormSignin') || csvText.includes('action="/account/login"')) {
        return res.status(200).json({ error: 'Session expirée.' });
      }
      return res.status(200).json({ csv: csvText });

    } else {
      return res.status(200).json({ error: 'action=list, bl, products, commandes, ou debug' });
    }
  } catch (globalErr) {
    return res.status(200).json({ error: 'Crash: ' + globalErr.message });
  }
};
