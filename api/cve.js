const fs = require('fs');
const path = require('path');
const { fetchCVEsFromDb } = require('./db');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { search } = req.query;

    try {
        if (process.env.DATABASE_URL) {
            const cves = await fetchCVEsFromDb({ search, limit: 200 });
            if (cves.length) {
                return res.status(200).json({
                    count: cves.length,
                    cves,
                    source: 'database'
                });
            }
        }
    } catch (err) {
        console.error('CVE database error:', err.message);
    }

    try {
        const localCVEs = loadLocalCVEs();
        let cves = localCVEs;
        if (search) {
            const q = String(search).toUpperCase();
            cves = localCVEs.filter(c =>
                String(c.cve_id || '').toUpperCase().includes(q) ||
                String(c.title || '').toUpperCase().includes(q) ||
                String(c.vendor || '').toUpperCase().includes(q) ||
                String(c.product || '').toUpperCase().includes(q)
            );
        }
        return res.status(200).json({
            count: cves.length,
            cves,
            source: 'local',
            message: 'Données en cache local. Base indisponible.'
        });
    } catch (err) {
        console.error('CVE fetch error:', err.message);
        return res.status(200).json({ count: 0, cves: [], source: 'empty', message: 'Aucune donnée disponible.' });
    }
};

function loadLocalCVEs() {
    try {
        const dataPath = path.join(process.cwd(), 'data', 'cve.json');
        if (fs.existsSync(dataPath)) {
            return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        }
    } catch (e) {}
    return [];
}
