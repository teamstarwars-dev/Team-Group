const { Client } = require('pg');

async function neonQuery(sql, params) {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    try {
        await client.connect();
        const result = await client.query(sql, params);
        return { rows: result.rows, fields: result.fields };
    } finally {
        try { await client.end(); } catch (e) {}
    }
}

async function ensureCvesTable() {
    await neonQuery(`
        CREATE TABLE IF NOT EXISTS cves (
            id SERIAL PRIMARY KEY,
            cve_id VARCHAR(50) NOT NULL UNIQUE,
            score DECIMAL(3,1) DEFAULT 0,
            severity VARCHAR(20),
            title TEXT,
            description TEXT,
            vendor TEXT,
            product TEXT,
            date DATE,
            "references" JSONB DEFAULT '[]'::jsonb,
            source VARCHAR(50) DEFAULT 'ENISA',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    `);
    await neonQuery('CREATE INDEX IF NOT EXISTS idx_cves_cve_id ON cves(cve_id)');
    await neonQuery('CREATE INDEX IF NOT EXISTS idx_cves_date ON cves(date)');
    await neonQuery('CREATE INDEX IF NOT EXISTS idx_cves_score ON cves(score)');
    await neonQuery('CREATE INDEX IF NOT EXISTS idx_cves_severity ON cves(severity)');
    await neonQuery('CREATE INDEX IF NOT EXISTS idx_cves_vendor ON cves(vendor)');
}

function mapCveRow(r) {
    let refs = r.references;
    if (typeof refs === 'string') {
        try { refs = JSON.parse(refs); } catch (e) { refs = []; }
    }
    if (!Array.isArray(refs)) refs = [];
    return {
        id: r.id,
        cve_id: r.cve_id,
        score: Number(r.score) || 0,
        severity: r.severity || 'low',
        title: r.title || r.cve_id,
        description: r.description || '',
        vendor: r.vendor || 'Inconnu',
        product: r.product || 'Inconnu',
        date: r.date ? String(r.date).split('T')[0] : '',
        references: refs,
        source: r.source || 'ENISA'
    };
}

async function fetchCVEsFromDb({ search, limit } = {}) {
    await ensureCvesTable();
    const hasSearch = !!(search && String(search).trim());
    const q = hasSearch ? `%${String(search).trim().toUpperCase()}%` : null;
    const max = Math.min(Math.max(Number(limit) || 200, 1), 500);

    let sql;
    let params;
    if (hasSearch) {
        sql = `SELECT * FROM cves
            WHERE UPPER(cve_id) LIKE $1
               OR UPPER(COALESCE(title, '')) LIKE $1
               OR UPPER(COALESCE(vendor, '')) LIKE $1
               OR UPPER(COALESCE(product, '')) LIKE $1
               OR UPPER(COALESCE(description, '')) LIKE $1
            ORDER BY score DESC, date DESC NULLS LAST, id DESC
            LIMIT ${max}`;
        params = [q];
    } else {
        sql = `SELECT * FROM cves
            ORDER BY score DESC, date DESC NULLS LAST, id DESC
            LIMIT ${max}`;
        params = [];
    }

    const result = await neonQuery(sql, params);
    return (result.rows || []).map(mapCveRow);
}

async function upsertCVEs(cves) {
    await ensureCvesTable();
    let inserted = 0;
    let updated = 0;
    const valid = (Array.isArray(cves) ? cves : [])
        .map(c => {
            const cveId = String((c && (c.cve_id || c.cveId || c.id)) || '').trim().toUpperCase();
            if (!/^CVE-\d{4}-\d{4,}$/.test(cveId)) return null;
            const score = Number(c && c.score) || 0;
            const severity = (c && c.severity) || (score >= 9 ? 'critical' : score >= 7 ? 'high' : score >= 4 ? 'medium' : 'low');
            return {
                cveId,
                score,
                severity,
                title: (c && c.title) || cveId,
                description: (c && c.description) || '',
                vendor: (c && c.vendor) || 'Inconnu',
                product: (c && c.product) || 'Inconnu',
                date: (c && c.date) || null,
                refs: Array.isArray(c && c.references) ? JSON.stringify(c.references) : '[]',
                source: (c && c.source) || 'ENISA'
            };
        })
        .filter(Boolean);

    const chunkSize = 50;
    for (let i = 0; i < valid.length; i += chunkSize) {
        const chunk = valid.slice(i, i + chunkSize);
        const values = [];
        const params = [];
        chunk.forEach((c, idx) => {
            const base = idx * 10;
            values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}::jsonb, $${base + 10}, NOW())`);
            params.push(c.cveId, c.score, c.severity, c.title, c.description, c.vendor, c.product, c.date, c.refs, c.source);
        });

        const result = await neonQuery(`
            INSERT INTO cves (cve_id, score, severity, title, description, vendor, product, date, "references", source, updated_at)
            VALUES ${values.join(',')}
            ON CONFLICT (cve_id) DO UPDATE SET
                score = EXCLUDED.score,
                severity = EXCLUDED.severity,
                title = EXCLUDED.title,
                description = EXCLUDED.description,
                vendor = EXCLUDED.vendor,
                product = EXCLUDED.product,
                date = EXCLUDED.date,
                "references" = EXCLUDED."references",
                source = EXCLUDED.source,
                updated_at = NOW()
            RETURNING (xmax = 0) AS inserted
        `, params);

        for (const row of (result.rows || [])) {
            if (row.inserted) inserted++;
            else updated++;
        }
    }

    return { inserted, updated, total: inserted + updated };
}

module.exports = { neonQuery, ensureCvesTable, fetchCVEsFromDb, upsertCVEs, mapCveRow };
