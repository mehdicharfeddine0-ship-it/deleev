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
      const resp = await fetch(BASE + '/systemeu/delivery_notes/', { headers, redirect: 'follow' });
      if (!resp.ok) return res.status(200).json({ error: 'HTTP ' + resp.status, rows: [] });
      const html = await resp.text();
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
      const resp = await fetch(BASE + '/systemeu/raw_u20/' + pk + '/', { headers });
      if (!resp.ok) return res.status(200).json({ error: 'HTTP ' + resp.status });
      const text = await resp.text();
      try {
        return res.status(200).json(JSON.parse(text));
      } catch (e) {
        return res.status(200).json({ error: 'Réponse non-JSON', preview: text.substring(0, 200) });
      }

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

      while (page <= 10) {
        var resp2;
        try {
          resp2 = await fetch('https://search.deleev.com/staff/', {
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

        if (!resp2.ok) {
          var t = '';
          try { t = await resp2.text(); } catch(e) {}
          lastError = 'API ' + resp2.status + ' page ' + page + ': ' + t.substring(0, 200);
          break;
        }

        var data;
        try {
          data = await resp2.json();
        } catch (jsonErr) {
          lastError = 'JSON parse error page ' + page;
          break;
        }

        totalFound = data.found || totalFound;
        var hits = data.hits || [];

        for (var i = 0; i < hits.length; i++) {
          var d = hits[i].document || hits[i];
          allProducts.push({
            id: d.id || 0,
            name: d.selling_name || d.name || '',
            barcode: d.barcode || '',
            typology: d.typology || '',
            stock: typeof d.stock_reuilly === 'number' ? d.stock_reuilly : (typeof d.stock === 'number' ? d.stock : null),
            qi: typeof d.qi_reuilly === 'number' ? d.qi_reuilly : null,
            qd: typeof d.qd_reuilly === 'number' ? d.qd_reuilly : null,
            dlc_stock: typeof d.dlc_stock_days === 'number' ? d.dlc_stock_days : null,
            dlc_sale: typeof d.dlc_sale_days === 'number' ? d.dlc_sale_days : null,
            dlc_active: !!d.dlc_active,
            pack: d.pack || 1,
            bio: !!d.bio,
          });
        }

        if (hits.length < 250 || allProducts.length >= totalFound) break;
        page++;
      }

      return res.status(200).json({
        count: allProducts.length,
        found: totalFound,
        products: allProducts,
        error: lastError || undefined,
        pages: page
      });

    } else {
      return res.status(200).json({ error: 'action=list, action=bl&pk=XXX, ou action=products' });
    }
  } catch (globalErr) {
    return res.status(200).json({ error: 'Crash: ' + globalErr.message });
  }
};
