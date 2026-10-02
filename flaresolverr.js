// 1337x scraper that goes through FlareSolverr to get past Cloudflare's
// "Just a moment…" anti-bot challenge. Disabled (no-op) unless FLARESOLVERR_URL
// is set — e.g. http://flaresolverr:8191 when running via the provided Compose.
const cheerio = require('cheerio');

const FLARESOLVERR_URL = (process.env.FLARESOLVERR_URL || '').replace(/\/$/, '');
const BASE = (process.env.X1337_BASE || 'https://1337x.to').replace(/\/$/, '');

const enabled = () => !!FLARESOLVERR_URL;

// Ask FlareSolverr to fetch a URL with a real browser and return the page HTML.
async function solve(url, maxTimeout = 60000) {
  const r = await fetch(`${FLARESOLVERR_URL}/v1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: 'request.get', url, maxTimeout }),
    signal: AbortSignal.timeout(maxTimeout + 10000),
  });
  const data = await r.json().catch(() => ({}));
  if (data.status !== 'ok' || !data.solution) {
    throw new Error(data.message || 'FlareSolverr request failed');
  }
  return data.solution.response;
}

function toInt(s) {
  const n = parseInt(String(s).replace(/[^\d]/g, ''), 10);
  return Number.isNaN(n) ? 0 : n;
}

// Parse a 1337x search-results page into rows. The magnet is NOT here — it
// lives on each torrent's detail page, fetched lazily via magnet1337x().
async function search1337x(query, limit = 20, maxTimeout = 7000) {
  const q = encodeURIComponent(query.trim()).replace(/%20/g, '+');
  const html = await solve(`${BASE}/search/${q}/1/`, maxTimeout);
  const $ = cheerio.load(html);
  const results = [];

  $('table.table-list tbody tr').each((_, el) => {
    const row = $(el);
    const link = row.find('td.name a, td.coll-1 a').last();
    const title = link.text().trim();
    const detailPath = link.attr('href');
    if (!title || !detailPath) return;

    // The size cell carries a nested <span> (mobile seeders) — drop it.
    const sizeCell = row.find('td.size, td.coll-4').first().clone();
    sizeCell.find('span').remove();

    results.push({
      title,
      seeds: toInt(row.find('td.seeds, td.coll-2').first().text()),
      peers: toInt(row.find('td.leeches, td.coll-3').first().text()),
      size: sizeCell.text().trim(),
      detailPath,
    });
  });

  return results.slice(0, limit);
}

// Fetch a torrent's detail page through FlareSolverr and extract its magnet.
async function magnet1337x(detailPath) {
  const url = detailPath.startsWith('http') ? detailPath : BASE + detailPath;
  const html = await solve(url);
  const $ = cheerio.load(html);
  return $('a[href^="magnet:"]').first().attr('href') || null;
}

module.exports = { enabled, search1337x, magnet1337x, FLARESOLVERR_URL, BASE };
