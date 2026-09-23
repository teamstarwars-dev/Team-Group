const https = require('https');
const http = require('http');
const { neonQuery, fetchCVEsFromDb } = require('../db');

module.exports = async (req, res) => {
    if (req.method !== 'GET') return res.status(405).end();
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Non autorisé.' });
    }

    const type = (req.query && req.query.type) || 'cve';
    const validTypes = ['cve', 'breach', 'zero-day', 'weekly', 'patch-tuesday'];
    if (!validTypes.includes(type)) {
        return res.status(400).json({ error: `Type invalide. Valides: ${validTypes.join(', ')}` });
    }

    try {
        await neonQuery(`
            CREATE TABLE IF NOT EXISTS alert_log (
                id SERIAL PRIMARY KEY,
                alert_type VARCHAR(50) NOT NULL,
                item_id VARCHAR(100) NOT NULL,
                item_title TEXT,
                item_score DECIMAL(3,1),
                item_severity VARCHAR(20),
                sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                recipients_count INTEGER DEFAULT 0,
                email_id VARCHAR(100)
            )
        `);

        const subs = await neonQuery("SELECT email FROM subscribers WHERE active = TRUE");
        const recipients = (subs.rows || []).map(s => s.email);
        if (!recipients.length) return res.status(200).json({ message: 'Aucun abonné actif.', sent: 0, type });

        let result;
        switch (type) {
            case 'cve': result = await handleCVERecipients(recipients); break;
            case 'breach': result = await handleBreachRecipients(recipients); break;
            case 'zero-day': result = await handleZeroDayRecipients(recipients); break;
            case 'weekly': result = await handleWeeklyRecipients(recipients); break;
            case 'patch-tuesday': result = await handlePatchTuesdayRecipients(recipients); break;
        }

        return res.status(200).json({ success: true, type, ...result });
    } catch (err) {
        console.error(`Cron ${type} Error:`, err.message);
        return res.status(500).json({ error: 'Erreur serveur.', message: err.message, type });
    }
};

async function handleCVERecipients(recipients) {
    const cves = await loadCVEs();
    if (!cves.length) return { message: 'Aucune CVE trouvée.', sent: 0 };

    const sent = await neonQuery("SELECT item_id FROM alert_log WHERE alert_type = 'cve'");
    const sentIds = new Set((sent.rows || []).map(r => r.item_id));
    const newCVEs = cves.filter(c => !sentIds.has(c.cve_id));
    if (!newCVEs.length) return { message: 'Pas de nouvelles CVE.', sent: 0 };

    const criticals = newCVEs.filter(c => c.severity === 'critical');
    const highs = newCVEs.filter(c => c.severity === 'high');
    const others = newCVEs.filter(c => c.severity !== 'critical' && c.severity !== 'high');

    const subject = criticals.length > 0
        ? `[Team Group] Alerte CVE critique — ${criticals.length} vulnérabilité(s) critique(s)`
        : `[Team Group] Veille CVE — ${newCVEs.length} nouvelle(s) vulnérabilité(s)`;

    const html = buildCVEEmail(criticals, highs, others, newCVEs.length);
    const emailResult = await resendSend({ from: 'Team Group <onboarding@resend.dev>', to: recipients, subject, html }, process.env.RESEND_API_KEY);

    for (const cve of newCVEs) {
        await neonQuery("INSERT INTO alert_log (alert_type, item_id, item_title, item_score, item_severity, recipients_count, email_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            ['cve', cve.cve_id, cve.title || cve.cve_id, cve.score || 0, cve.severity, recipients.length, emailResult.id || '']);
    }

    return { message: `Alerte CVE envoyée à ${recipients.length} abonné(s).`, newCVEs: newCVEs.length, critical: criticals.length, high: highs.length, recipients: recipients.length };
}

async function handleBreachRecipients(recipients) {
    const breaches = await fetchBreaches();
    if (!breaches.length) return { message: 'Aucune fuite trouvée.', sent: 0 };

    const sent = await neonQuery("SELECT item_id FROM alert_log WHERE alert_type = 'breach'");
    const sentIds = new Set((sent.rows || []).map(r => r.item_id));
    const newBreaches = breaches.filter(b => !sentIds.has(b.name.toLowerCase()));
    if (!newBreaches.length) return { message: 'Pas de nouvelles fuites.', sent: 0 };

    const criticals = newBreaches.filter(b => b.severity === 'critical');
    const subject = criticals.length > 0
        ? `[Team Group] Alerte fuite de données — ${criticals.length} fuite(s) critique(s)`
        : `[Team Group] Nouvelles fuites — ${newBreaches.length} fuite(s)`;

    const html = buildBreachEmail(newBreaches);
    const emailResult = await resendSend({ from: 'Team Group <onboarding@resend.dev>', to: recipients, subject, html }, process.env.RESEND_API_KEY);

    for (const b of newBreaches) {
        await neonQuery("INSERT INTO alert_log (alert_type, item_id, item_title, item_severity, recipients_count, email_id) VALUES ($1, $2, $3, $4, $5, $6)",
            ['breach', b.name.toLowerCase(), b.name, b.severity, recipients.length, emailResult.id || '']);
    }

    return { message: `Fuites envoyées à ${recipients.length} abonné(s).`, newBreaches: newBreaches.length, recipients: recipients.length };
}

async function handleZeroDayRecipients(recipients) {
    const exploited = await fetchExploited();
    if (!exploited.length) return { message: 'Aucune CVE exploitée trouvée.', sent: 0 };

    const sent = await neonQuery("SELECT item_id FROM alert_log WHERE alert_type = 'zero_day'");
    const sentIds = new Set((sent.rows || []).map(r => r.item_id));
    const newExploited = exploited.filter(c => !sentIds.has(c.cve_id));
    if (!newExploited.length) return { message: 'Pas de nouvelles CVEs exploitées.', sent: 0 };

    const subject = `[Team Group] Zéro-day exploité — ${newExploited.length} CVE(s) activement exploitée(s)`;
    const html = buildZeroDayEmail(newExploited);
    const emailResult = await resendSend({ from: 'Team Group <onboarding@resend.dev>', to: recipients, subject, html }, process.env.RESEND_API_KEY);

    for (const cve of newExploited) {
        await neonQuery("INSERT INTO alert_log (alert_type, item_id, item_title, item_score, item_severity, recipients_count, email_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            ['zero_day', cve.cve_id, cve.title || cve.cve_id, cve.score || 0, 'critical', recipients.length, emailResult.id || '']);
    }

    return { message: `Alerte zéro-day envoyée à ${recipients.length} abonné(s).`, newCVEs: newExploited.length, recipients: recipients.length };
}

async function handleWeeklyRecipients(recipients) {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const cves = await loadCVEs();
    const breaches = await fetchBreaches();
    const weekCVEs = cves.filter(c => c.date >= weekAgo);
    const weekBreaches = breaches.filter(b => b.date >= weekAgo);

    if (!weekCVEs.length && !weekBreaches.length) return { message: 'Rien à résumer cette semaine.', sent: 0 };

    const subject = `[Team Group] Récap cybersécurité — Semaine du ${weekAgo}`;
    const html = buildWeeklyRecapEmail(weekCVEs, weekBreaches, weekAgo);
    const emailResult = await resendSend({ from: 'Team Group <onboarding@resend.dev>', to: recipients, subject, html }, process.env.RESEND_API_KEY);

    await neonQuery("INSERT INTO alert_log (alert_type, item_id, item_title, recipients_count, email_id) VALUES ($1, $2, $3, $4, $5)",
        ['weekly', `weekly-${weekAgo}`, `Récap semaine ${weekAgo}`, recipients.length, emailResult.id || '']);

    return { message: `Récap envoyé à ${recipients.length} abonné(s).`, cves: weekCVEs.length, breaches: weekBreaches.length, recipients: recipients.length };
}

async function handlePatchTuesdayRecipients(recipients) {
    const now = new Date();
    const dayOfMonth = now.getUTCDate();
    const secondTuesday = getSecondTuesday(now.getUTCFullYear(), now.getUTCMonth());

    if (dayOfMonth !== secondTuesday) {
        return { message: `Pas Patch Tuesday (${dayOfMonth}/${secondTuesday}).`, sent: 0 };
    }

    const patchTuesdayId = `patch-tuesday-${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const existing = await neonQuery("SELECT id FROM alert_log WHERE alert_type = 'patch_tuesday' AND item_id = $1", [patchTuesdayId]);
    if (existing.rows && existing.rows.length > 0) return { message: 'Patch Tuesday déjà envoyé ce mois.', sent: 0 };

    const subject = `[Team Group] Microsoft Patch Tuesday — ${now.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`;
    const html = buildPatchTuesdayEmail(now);
    const emailResult = await resendSend({ from: 'Team Group <onboarding@resend.dev>', to: recipients, subject, html }, process.env.RESEND_API_KEY);

    await neonQuery("INSERT INTO alert_log (alert_type, item_id, item_title, recipients_count, email_id) VALUES ($1, $2, $3, $4, $5)",
        ['patch_tuesday', patchTuesdayId, `Patch Tuesday ${now.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`, recipients.length, emailResult.id || '']);

    return { message: `Patch Tuesday envoyé à ${recipients.length} abonné(s).`, recipients: recipients.length };
}

function getSecondTuesday(year, month) {
    const first = new Date(Date.UTC(year, month, 1));
    let day = first.getUTCDay();
    if (day <= 2) return 2 + (2 - day);
    return 9 + (2 - day);
}

function httpGet(url) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        mod.get(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'TeamGroup-Bot/1.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data }));
        }).on('error', reject);
    });
}

async function loadCVEs() {
    try {
        const dbCVEs = await fetchCVEsFromDb({ limit: 300 });
        if (dbCVEs.length) return dbCVEs;
    } catch (e) {
        console.error('CVE DB load error:', e.message);
    }
    return fetchENISACVEs();
}

async function fetchENISACVEs() {
    try {
        const { status, data } = await httpGet('https://euvdservices.enisa.europa.eu/api/lastvulnerabilities?limit=50');
        if (status !== 200) return [];
        const parsed = JSON.parse(data);
        const items = parsed.data || parsed || [];
        return (Array.isArray(items) ? items : []).map(v => ({
            cve_id: v.cve_id || v.cveId || v.id || '',
            score: parseFloat(v.baseScore || v.cvssScore || 0),
            severity: getSeverity(parseFloat(v.baseScore || v.cvssScore || 0), v.severity),
            title: v.cve_id || v.cveId || v.id || '',
            description: v.summary || v.description || '',
            vendor: v.enisaIdVendor || v.vendor || 'Inconnu',
            product: v.enisaIdProduct || v.product || 'Inconnu',
            date: (v.publishedDate || v.date || '').split('T')[0]
        })).filter(c => c.cve_id);
    } catch (e) { return []; }
}

async function fetchBreaches() {
    try {
        const { status, data } = await httpGet('https://hginfoandco.com/fuites-donnees');
        if (status !== 200) return [];
        const breaches = [];
        const nameRegex = /class="[^"]*card-title[^"]*"[^>]*>([^<]+)</gi;
        const dateRegex = /(\d{2})\/(\d{2})\/(\d{4})/g;
        let match;
        const names = [];
        while ((match = nameRegex.exec(data)) !== null) {
            const name = match[1].trim();
            if (name && !name.includes('CVE') && name.length > 2 && name.length < 100) names.push(name);
        }
        const dates = [];
        while ((match = dateRegex.exec(data)) !== null) dates.push(`${match[3]}-${match[2]}-${match[1]}`);
        const seen = new Set();
        for (let i = 0; i < Math.min(names.length, 50); i++) {
            const name = names[i];
            if (seen.has(name.toLowerCase())) continue;
            seen.add(name.toLowerCase());
            let severity = 'high';
            const idx = data.indexOf(name);
            const sw = data.substring(Math.max(0, idx - 2000), idx + 2000);
            if (sw.includes('CRITIQUE')) severity = 'critical';
            else if (sw.includes('MOYEN')) severity = 'medium';
            breaches.push({ name, date: dates[i] || new Date().toISOString().split('T')[0], severity });
        }
        return breaches;
    } catch (e) { return []; }
}

async function fetchExploited() {
    const allCVEs = [];
    try {
        const { status, data } = await httpGet('https://euvdservices.enisa.europa.eu/api/exploitedvulnerabilities?limit=30');
        if (status === 200) {
            const parsed = JSON.parse(data);
            const items = parsed.data || parsed || [];
            for (const v of (Array.isArray(items) ? items : [])) {
                const id = v.cve_id || v.cveId || v.id || '';
                if (id) allCVEs.push({ cve_id: id, score: parseFloat(v.baseScore || v.cvssScore || 0), title: id, description: v.summary || '', vendor: v.enisaIdVendor || 'Inconnu', product: v.enisaIdProduct || 'Inconnu', source: 'ENISA' });
            }
        }
    } catch (e) {}
    try {
        const { status, data } = await httpGet('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json');
        if (status === 200) {
            const parsed = JSON.parse(data);
            for (const v of (parsed.vulnerabilities || [])) {
                if (v.cveID && !allCVEs.find(c => c.cve_id === v.cveID)) {
                    allCVEs.push({ cve_id: v.cveID, score: 0, title: v.cveID, description: v.shortDescription || '', vendor: v.vendorProject || 'Inconnu', product: v.product || 'Inconnu', source: 'CISA' });
                }
            }
        }
    } catch (e) {}
    const seen = new Set();
    return allCVEs.filter(c => { if (seen.has(c.cve_id)) return false; seen.add(c.cve_id); return true; });
}

function getSeverity(score, explicit) {
    if (explicit) { const s = explicit.toUpperCase(); if (s === 'CRITICAL') return 'critical'; if (s === 'HIGH') return 'high'; if (s === 'MEDIUM') return 'medium'; }
    if (score >= 9.0) return 'critical'; if (score >= 7.0) return 'high'; if (score >= 4.0) return 'medium'; return 'low';
}

function emailHeader(title, subtitle, gradient) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background-color:#0f172a;font-family:'Segoe UI',Tahoma,sans-serif;">
<div style="max-width:640px;margin:0 auto;background-color:#1e293b;color:#e2e8f0;">
<div style="background:linear-gradient(135deg,${gradient});padding:32px 24px;text-align:center;">
<h1 style="color:#fff;font-size:22px;margin:0 0 8px;">${title}</h1>
<p style="color:#bae6fd;font-size:14px;margin:0;">${subtitle}</p>
</div><div style="padding:24px;">`;
}

function emailFooter() {
    return `<div style="margin-top:32px;padding:16px;background:#0f172a;border-radius:8px;text-align:center;">
<p style="color:#64748b;font-size:11px;margin:0;">Team Group — Protection & Cybersécurité<br><a href="https://team-group.vercel.app" style="color:#60a5fa;">team-group.vercel.app</a></p>
</div></div></div></body></html>`;
}

function buildCVECard(cve, color) {
    return `<div style="background:#0f172a;border-left:4px solid ${color};padding:16px;margin:12px 0;border-radius:0 8px 8px 0;">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
<h3 style="margin:0;font-size:15px;color:#f1f5f9;">${cve.cve_id}</h3>
<span style="background:${color};color:white;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:bold;">CVSS ${cve.score}</span>
</div>
<p style="margin:4px 0;color:#94a3b8;font-size:13px;"><strong>Produit :</strong> ${cve.vendor || 'N/A'} — ${cve.product || 'N/A'}</p>
${cve.description ? `<p style="margin:8px 0 0;color:#cbd5e1;font-size:13px;line-height:1.5;">${cve.description.substring(0, 200)}${cve.description.length > 200 ? '...' : ''}</p>` : ''}
<a href="https://nvd.nist.gov/vuln/detail/${cve.cve_id}" style="color:#60a5fa;font-size:12px;">Voir sur NVD →</a></div>`;
}

function buildCVEEmail(criticals, highs, others, total) {
    const sev = [];
    if (criticals.length) sev.push(`<span style="color:#dc2626;font-weight:bold;">${criticals.length} critique(s)</span>`);
    if (highs.length) sev.push(`<span style="color:#ea580c;font-weight:bold;">${highs.length} élevée(s)</span>`);
    if (others.length) sev.push(`<span style="color:#ca8a04;">${others.length} autre(s)</span>`);

    let html = emailHeader('🛡️ Alerte Sécurité — CVE', `${total} nouvelle(s) vulnérabilité(s) · ${sev.join(' · ')}`, '#2563eb,#1d4ed8');
    if (criticals.length) { html += `<h2 style="color:#dc2626;font-size:16px;border-bottom:2px solid #dc2626;padding-bottom:8px;">🔴 CRITIQUES</h2>`; for (const c of criticals) html += buildCVECard(c, '#dc2626'); }
    if (highs.length) { html += `<h2 style="color:#ea580c;font-size:16px;border-bottom:2px solid #ea580c;padding-bottom:8px;margin-top:24px;">🟠 ÉLEVÉES</h2>`; for (const c of highs) html += buildCVECard(c, '#ea580c'); }
    if (others.length) { html += `<h2 style="color:#ca8a04;font-size:16px;border-bottom:2px solid #ca8a04;padding-bottom:8px;margin-top:24px;">🟡 AUTRES</h2>`; for (const c of others) html += buildCVECard(c, '#ca8a04'); }
    html += emailFooter();
    return html;
}

function buildBreachEmail(breaches) {
    const criticals = breaches.filter(b => b.severity === 'critical');
    const highs = breaches.filter(b => b.severity === 'high');
    const others = breaches.filter(b => b.severity !== 'critical' && b.severity !== 'high');
    let html = emailHeader('🔴 Fuites de Données', `${breaches.length} nouvelle(s) fuite(s)`, '#7c3aed,#6d28d9');
    if (criticals.length) { html += `<h2 style="color:#dc2626;font-size:16px;border-bottom:2px solid #dc2626;padding-bottom:8px;">🔴 CRITIQUES</h2>`; for (const b of criticals) html += `<div style="background:#0f172a;border-left:4px solid #dc2626;padding:12px;margin:8px 0;border-radius:0 8px 8px 0;"><strong style="color:#f1f5f9;">${b.name}</strong><p style="margin:4px 0 0;color:#94a3b8;font-size:13px;">${b.date}</p></div>`; }
    if (highs.length) { html += `<h2 style="color:#ea580c;font-size:16px;border-bottom:2px solid #ea580c;padding-bottom:8px;margin-top:24px;">🟠 ÉLEVÉES</h2>`; for (const b of highs) html += `<div style="background:#0f172a;border-left:4px solid #ea580c;padding:12px;margin:8px 0;border-radius:0 8px 8px 0;"><strong style="color:#f1f5f9;">${b.name}</strong><p style="margin:4px 0 0;color:#94a3b8;font-size:13px;">${b.date}</p></div>`; }
    if (others.length) { html += `<h2 style="color:#ca8a04;font-size:16px;border-bottom:2px solid #ca8a04;padding-bottom:8px;margin-top:24px;">🟡 AUTRES</h2>`; for (const b of others) html += `<div style="background:#0f172a;border-left:4px solid #ca8a04;padding:12px;margin:8px 0;border-radius:0 8px 8px 0;"><strong style="color:#f1f5f9;">${b.name}</strong><p style="margin:4px 0 0;color:#94a3b8;font-size:13px;">${b.date}</p></div>`; }
    html += emailFooter();
    return html;
}

function buildZeroDayEmail(cves) {
    let html = emailHeader('🚨 Zéro-Day Exploité', `${cves.length} CVE(s) activement exploitée(s)`, '#dc2626,#b91c1c');
    html += `<div style="background:#450a0a;border:1px solid #dc2626;padding:16px;border-radius:8px;margin-bottom:20px;"><p style="color:#fca5a5;font-size:14px;margin:0;font-weight:bold;">⚠️ Ces vulnérabilités sont activement exploitées par des attaquants.</p></div>`;
    for (const c of cves) {
        html += `<div style="background:#0f172a;border-left:4px solid #dc2626;padding:16px;margin:12px 0;border-radius:0 8px 8px 0;">
<h3 style="margin:0;font-size:15px;color:#f1f5f9;">${c.cve_id} <span style="background:#dc2626;color:white;padding:2px 8px;border-radius:12px;font-size:11px;">EXPLOITÉ</span></h3>
<p style="margin:4px 0;color:#94a3b8;font-size:13px;">${c.vendor} — ${c.product} · ${c.source}</p>
${c.description ? `<p style="margin:8px 0 0;color:#cbd5e1;font-size:13px;">${c.description.substring(0, 200)}${c.description.length > 200 ? '...' : ''}</p>` : ''}
<a href="https://nvd.nist.gov/vuln/detail/${c.cve_id}" style="color:#f87171;font-size:12px;font-weight:bold;">Voir sur NVD →</a></div>`;
    }
    html += emailFooter();
    return html;
}

function buildWeeklyRecapEmail(cves, breaches, weekStart) {
    const criticals = cves.filter(c => c.severity === 'critical');
    const highs = cves.filter(c => c.severity === 'high');
    let html = emailHeader('📋 Récap Cybersécurité', `Semaine du ${weekStart}`, '#2563eb,#1d4ed8');
    html += `<div style="display:flex;gap:12px;margin-bottom:24px;">
<div style="flex:1;background:#0f172a;padding:16px;border-radius:8px;text-align:center;"><div style="font-size:28px;font-weight:bold;color:#60a5fa;">${cves.length}</div><div style="font-size:12px;color:#94a3b8;">CVEs</div></div>
<div style="flex:1;background:#0f172a;padding:16px;border-radius:8px;text-align:center;"><div style="font-size:28px;font-weight:bold;color:#dc2626;">${criticals.length}</div><div style="font-size:12px;color:#94a3b8;">Critiques</div></div>
<div style="flex:1;background:#0f172a;padding:16px;border-radius:8px;text-align:center;"><div style="font-size:28px;font-weight:bold;color:#7c3aed;">${breaches.length}</div><div style="font-size:12px;color:#94a3b8;">Fuites</div></div></div>`;
    if (criticals.length) { html += `<h2 style="color:#dc2626;font-size:16px;margin-top:0;">🔴 Critiques</h2>`; for (const c of criticals.slice(0, 5)) html += buildCVECard(c, '#dc2626'); }
    if (highs.length) { html += `<h2 style="color:#ea580c;font-size:16px;margin-top:24px;">🟠 Élevées</h2>`; for (const c of highs.slice(0, 5)) html += buildCVECard(c, '#ea580c'); }
    if (breaches.length) { html += `<h2 style="color:#7c3aed;font-size:16px;margin-top:24px;">🔴 Fuites</h2>`; for (const b of breaches.slice(0, 5)) html += `<div style="background:#0f172a;border-left:4px solid #7c3aed;padding:12px;margin:8px 0;border-radius:0 8px 8px 0;"><strong style="color:#f1f5f9;">${b.name}</strong><p style="margin:4px 0 0;color:#94a3b8;font-size:13px;">${b.date}</p></div>`; }
    html += emailFooter();
    return html;
}

function buildPatchTuesdayEmail(date) {
    const monthStr = date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    let html = emailHeader('🔧 Microsoft Patch Tuesday', monthStr, '#0ea5e9,#0284c7');
    html += `<div style="background:#0f172a;padding:20px;border-radius:8px;margin-bottom:20px;">
<h2 style="color:#f1f5f9;font-size:16px;margin:0 0 12px;">📋 Rappel</h2>
<p style="color:#94a3b8;font-size:14px;line-height:1.6;margin:0;">Le Patch Tuesday de Microsoft est publié le <strong style="color:#f1f5f9;">2e mardi de chaque mois</strong>.</p>
<ul style="color:#94a3b8;font-size:14px;line-height:1.8;margin:12px 0 0;padding-left:20px;">
<li style="color:#f1f5f9;">Windows Server 2019 / 2022 / 2025</li>
<li style="color:#f1f5f9;">Windows 10 / 11</li>
<li style="color:#f1f5f9;">Microsoft Office / Exchange Server</li>
<li style="color:#f1f5f9;">Azure / SQL Server</li></ul></div>`;
    html += `<div style="margin-top:20px;padding:16px;background:#0f172a;border-radius:8px;text-align:center;"><a href="https://msrc.microsoft.com/update-guide/" style="display:inline-block;padding:10px 24px;background:#0ea5e9;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">Voir les mises à jour Microsoft →</a></div>`;
    html += emailFooter();
    return html;
}

function resendSend(data, apiKey) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const options = { hostname: 'api.resend.com', path: '/emails', method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
        const req = https.request(options, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { const p = JSON.parse(d); resolve(res.statusCode >= 400 ? { message: p.message || `Erreur ${res.statusCode}` } : p); } catch (e) { resolve({ message: 'Réponse invalide.' }); } }); });
        req.on('error', reject); req.write(body); req.end();
    });
}
