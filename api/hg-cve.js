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

function parseCVEs(html) {
  const cves = [];
  const regex = /CRITIQUE|ÉLEVÉE?|MOYENNE?|FAIBLE/gi;

  const cardRegex = /CVE-\d{4}-\d+/g;
  const seen = new Set();
  let match;

  while ((match = cardRegex.exec(html)) !== null) {
    const cveId = match[0];
    if (seen.has(cveId)) continue;
    seen.add(cveId);

    const before = html.substring(Math.max(0, match.index - 500), match.index);
    const after = html.substring(match.index, Math.min(html.length, match.index + 500));

    let score = 0;
    const scoreMatch = after.match(/(\d+\.?\d*)\s*(?:<|&lt;)/);
    if (scoreMatch) score = parseFloat(scoreMatch[1]);
    else {
      const altScore = after.match(/(\d+\.?\d*)/);
      if (altScore && parseFloat(altScore[1]) <= 10) score = parseFloat(altScore[1]);
    }

    let severity = 'unknown';
    if (before.includes('CRITIQUE') || before.includes('CRITIQUE')) severity = 'critical';
    else if (before.includes('LEVÉ') || before.includes('LEVÉ')) severity = 'high';
    else if (before.includes('MOYEN')) severity = 'medium';
    else if (before.includes('FAIBLE')) severity = 'low';

    if (score >= 9.0 || severity === 'critical') severity = 'critical';
    else if (score >= 7.0 || severity === 'high') severity = 'high';
    else if (score >= 4.0) severity = 'medium';

    let product = '';
    const prodMatch = after.match(/«\s*([^»]+)\s*»/);
    if (prodMatch) product = prodMatch[1].trim();

    let vendor = '';
    const vendorMatch = after.match(/avis de securite de\s+([^<]+)/i);
    if (vendorMatch) vendor = vendorMatch[1].trim();

    let date = '';
    const dateMatch = after.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (dateMatch) date = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;

    cves.push({ cve_id: cveId, score, severity, product, vendor, date, nvd_url: `https://nvd.nist.gov/vuln/detail/${cveId}` });
  }

  return cves.sort((a, b) => b.score - a.score);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const html = await fetch('https://hginfoandco.com/cyber-veille');
    const cves = parseCVEs(html);
    res.status(200).json({ source: 'HG Info & Co', url: 'https://hginfoandco.com/cyber-veille', count: cves.length, last_update: new Date().toISOString(), cves: cves.slice(0, 100) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch CVE data', message: e.message });
  }
};
