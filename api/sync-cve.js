const { upsertCVEs } = require('./db');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée.' });

    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Non autorisé.' });
    }

    if (!process.env.DATABASE_URL) {
        return res.status(503).json({ error: 'Base de données non configurée.' });
    }

    const body = req.body || {};
    const cves = Array.isArray(body.cves) ? body.cves : (Array.isArray(body) ? body : null);
    if (!cves || !cves.length) {
        return res.status(400).json({ error: 'Liste cves requise.' });
    }
    if (cves.length > 500) {
        return res.status(400).json({ error: 'Maximum 500 CVEs par appel.' });
    }

    try {
        const result = await upsertCVEs(cves);
        return res.status(200).json({
            success: true,
            message: `${result.total} CVE traitée(s) (${result.inserted} nouvelle(s), ${result.updated} mise(s) à jour).`,
            ...result
        });
    } catch (err) {
        console.error('Sync CVE error:', err.message);
        return res.status(500).json({ error: 'Erreur serveur.', message: err.message });
    }
};
