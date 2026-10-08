// api/compare.js
// 这个文件跑在 Vercel 上，负责同时查京东/天猫和闲鱼的价格

export default async function handler(req, res) {
  // ===== CORS 允许跨域 =====
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 浏览器预检请求，直接返回 200
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 只允许 POST 请求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只支持 POST' });
  }

  const { items } = req.body;
  if (!items || !items.length) {
    return res.status(400).json({ error: '缺少 items 参数' });
  }

  const results = [];

  for (const item of items) {
    const result = { key: item.key, name: item.name };

    // 1. 查京东/天猫（best-price-mcp，免费，无需 Key）
    try {
      const bpResp = await fetch('https://mcp.bestprice.gr/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'search_products',
            arguments: { query: item.keyword, limit: 3 }
          }
        })
      });
      const bpData = await bpResp.json();
      const products = bpData?.result?.content?.[0]?.text
        ? JSON.parse(bpData.result.content[0].text)
        : [];

      if (products.length) {
        result.jd = {
          price: products[0].price_from || products[0].price,
          url: `https://search.jd.com/Search?keyword=${encodeURIComponent(item.keyword)}`
        };
        result.tmall = {
          price: products[0].price_from || products[0].price,
          url: `https://s.taobao.com/search?q=${encodeURIComponent(item.keyword)}`
        };
      }
    } catch (e) {
      console.warn('京东/天猫查询失败:', e.message);
    }

    // 2. 查闲鱼（Apify）
    try {
      const apifyToken = process.env.APIFY_TOKEN;
      if (apifyToken) {
        const apifyResp = await fetch(
          `https://api.apify.com/v2/acts/khadinakbar~goofish-search-scraper/runs?token=${apifyToken}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              keywords: [item.keyword],
              maxResults: 3,
              maxPagesPerKeyword: 1
            })
          }
        );
        const runData = await apifyResp.json();
        const runId = runData?.data?.id;

        if (runId) {
          let datasetId = null;
          for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const statusResp = await fetch(
              `https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`
            );
            const statusData = await statusResp.json();
            if (statusData?.data?.status === 'SUCCEEDED') {
              datasetId = statusData.data.defaultDatasetId;
              break;
            }
          }

          if (datasetId) {
            const itemsResp = await fetch(
              `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}`
            );
            const xianyuItems = await itemsResp.json();
            if (xianyuItems.length) {
              result.xianyu = {
                price: xianyuItems[0].price,
                url: xianyuItems[0].url || xianyuItems[0].itemUrl
              };
            }
          }
        }
      }
    } catch (e) {
      console.warn('闲鱼查询失败:', e.message);
    }

    results.push(result);
  }

  res.status(200).json({ results });
}
