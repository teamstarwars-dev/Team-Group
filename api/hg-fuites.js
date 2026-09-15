const https = require('https');
const http = require('http');

function fetch(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'TeamGroup-Bot/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseBreaches(html) {
  const breaches = [];
  const sections = html.split(/(?=class="[^"]*incident-card|class="[^"]*breach|fiche et les mesures)/i);

  const nameRegex = /class="[^"]*card-title[^"]*"[^>]*>([^<]+)</gi;
  const dateRegex = /(\d{2})\/(\d{2})\/(\d{4})/g;
  const accountsRegex = /(\d[\d\s.,]*[kKmM]?)\s*(?:comptes|accounts)/gi;

  let match;
  const names = [];
  while ((match = nameRegex.exec(html)) !== null) {
    const name = match[1].trim();
    if (name && !name.includes('CVE') && name.length > 2 && name.length < 100) {
      names.push(name);
    }
  }

  const dates = [];
  while ((match = dateRegex.exec(html)) !== null) {
    dates.push(`${match[3]}-${match[2]}-${match[1]}`);
  }

  const seen = new Set();
  for (let i = 0; i < Math.min(names.length, 50); i++) {
    const name = names[i];
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    let severity = 'high';
    const searchWindow = html.substring(Math.max(0, html.indexOf(name) - 2000), html.indexOf(name) + 2000);
    if (searchWindow.includes('CRITIQUE')) severity = 'critical';
    else if (searchWindow.includes('ÉLEVÉ') || searchWindow.includes('ELEVÉ')) severity = 'high';
    else if (searchWindow.includes('MOYEN')) severity = 'medium';

    let accounts = 0;
    const accMatch = searchWindow.match(/(\d[\d\s.,]*)\s*(?:[kKmM]?\s*comptes)/);
    if (accMatch) {
      let num = accMatch[1].replace(/\s/g, '').replace(',', '.');
      if (searchWindow.includes('M') && !searchWindow.includes('MM')) accounts = Math.round(parseFloat(num) * 1000000);
      else if (searchWindow.match(/[kK]\s*comptes/)) accounts = Math.round(parseFloat(num) * 1000);
      else accounts = Math.round(parseFloat(num));
    }

    breaches.push({ name, date: dates[i] || '2026-09-15', accounts, severity, source: 'HG Info & Co' });
  }

  return breaches;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const html = await fetch('https://hginfoandco.com/fuites-donnees');
    const breaches = parseBreaches(html);
    res.status(200).json({ source: 'HG Info & Co', url: 'https://hginfoandco.com/fuites-donnees', count: breaches.length, last_update: new Date().toISOString(), breaches: breaches.slice(0, 50) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch breach data', message: e.message });
  }
};
