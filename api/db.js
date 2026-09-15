const https = require('https');

function neonQuery(sql, params) {
    return new Promise((resolve, reject) => {
        const connStr = process.env.DATABASE_URL;
        if (!connStr) return reject(new Error('DATABASE_URL not set'));

        const url = new URL(connStr);
        const host = url.hostname;

        const body = JSON.stringify({ query: sql, params: params || [] });

        const options = {
            hostname: host,
            path: '/sql/v1/query',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Neon-Connection-String': connStr,
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.message) return reject(new Error(parsed.message));
                    resolve(parsed);
                } catch (e) {
                    reject(new Error('Invalid response'));
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

module.exports = { neonQuery };
