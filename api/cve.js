const https = require('https');
const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { search } = req.query;

    try {
        const cves = await fetchCVEs();

        if (search) {
            const q = search.toUpperCase();
            const filtered = cves.filter(c =>
                c.cve_id.toUpperCase().includes(q) ||
                c.title.toUpperCase().includes(q) ||
                c.vendor.toUpperCase().includes(q) ||
                c.product.toUpperCase().includes(q)
            );
            return res.status(200).json({ count: filtered.length, cves: filtered });
        }

        return res.status(200).json({ count: cves.length, cves: cves });
    } catch (err) {
        console.error('CVE fetch error:', err.message);

        const localCVEs = loadLocalCVEs();
        return res.status(200).json({
            count: localCVEs.length,
            cves: localCVEs,
            source: 'local',
            message: 'Données en cache local. API ENISA EUVD temporairement indisponible.'
        });
    }
};

function fetchCVEs() {
    return new Promise((resolve, reject) => {
        const today = new Date();
        const startDate = new Date(today);
        startDate.setDate(startDate.getDate() - 30);
        const start = startDate.toISOString().split('T')[0];
        const end = today.toISOString().split('T')[0];
        const url = `https://euvdservices.enisa.europa.eu/api/vulnerabilities?fromDate=${start}&toDate=${end}&size=50`;

        https.get(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'TeamGroup-CVE-Bot/1.0' } }, (res) => {
            let data = '';

            res.on('data', (chunk) => { data += chunk; });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const parsed = JSON.parse(data);
                        const items = Array.isArray(parsed) ? parsed : (parsed.items || []);
                        const cves = items.map(v => {
                            const aliases = String(v.aliases || '').split('\n').map(s => s.trim()).filter(Boolean);
                            const cveId = aliases.find(a => a.startsWith('CVE-')) || v.id;
                            const score = Number(v.baseScore) || 0;
                            const vendor = v.enisaIdVendor?.[0]?.vendor?.name || 'Inconnu';
                            const product = v.enisaIdProduct?.[0]?.product?.name || 'Inconnu';
                            const date = parseEuvdDate(v.datePublished) || new Date().toISOString().split('T')[0];
                            return {
                                cve_id: cveId,
                                score,
                                severity: getSeverity(score),
                                title: cveId,
                                description: v.description || '',
                                vendor,
                                product,
                                date
                            };
                        });
                        resolve(cves);
                    } catch (e) {
                        reject(e);
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}`));
                }
            });
        }).on('error', reject);
    });
}

function parseEuvdDate(s) {
    if (!s) return null;
    const d = new Date(String(s).replace(/,(?= \d)/, ''));
    return isNaN(d) ? null : d.toISOString().split('T')[0];
}

function loadLocalCVEs() {
    try {
        const dataPath = path.join(process.cwd(), 'data', 'cve.json');
        if (fs.existsSync(dataPath)) {
            return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        }
    } catch (e) {}
    return [];
}

function getSeverity(score) {
    if (score >= 9.0) return 'critical';
    if (score >= 7.0) return 'high';
    if (score >= 4.0) return 'medium';
    return 'low';
}