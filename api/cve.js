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
        const url = 'https://services.euroid.eu/vulnerability-euroid/v1/vulnerabilities?dateStart=2026-01-01&dateEnd=2026-12-31&limit=50&order=desc';

        https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
            let data = '';

            res.on('data', (chunk) => { data += chunk; });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const parsed = JSON.parse(data);
                        const cves = (parsed.vulnerabilities || []).map(v => ({
                            cve_id: v.cveId || v.id,
                            score: v.cvssScore || 0,
                            severity: getSeverity(v.cvssScore || 0),
                            title: v.cveId || v.id,
                            description: v.description || '',
                            vendor: v.vendor || 'Inconnu',
                            product: v.product || 'Inconnu',
                            date: v.publishedDate || new Date().toISOString().split('T')[0]
                        }));
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