const https = require('https');

function neonQuery(sql, params) {
    return new Promise((resolve, reject) => {
        const connString = process.env.DATABASE_URL;
        if (!connString) return reject(new Error('DATABASE_URL not set'));

        const url = new URL(connString);
        const host = url.hostname;
        const database = url.pathname.slice(1).split('?')[0];
        const [user, pass] = url.username.split(':');

        const body = JSON.stringify({ query: sql, params: params || [] });

        const options = {
            hostname: host,
            path: '/sql',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Neon-Connection-String': connString,
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.error) return reject(new Error(parsed.error));
                    resolve(parsed);
                } catch (e) {
                    reject(new Error('Invalid response: ' + data.substring(0, 200)));
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

module.exports = { neonQuery };
