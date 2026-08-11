const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('Vercel deployment exposes the client and a WebSocket-only Socket.IO function', () => {
    const config = JSON.parse(
        fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')
    );

    assert.equal(config.functions['api/socket-io.js'].maxDuration, 300);
    assert.deepEqual(config.rewrites, [
        { source: '/api/socket-io/:path*', destination: '/api/socket-io' },
        { source: '/', destination: '/client/index.html' },
        { source: '/:asset*', destination: '/client/:asset*' }
    ]);

    const clientConfig = JSON.parse(
        fs.readFileSync(path.join(root, 'client/vercel.json'), 'utf8')
    );
    assert.equal(clientConfig.functions['api/socket-io.js'].maxDuration, 300);

    const server = require('../api/socket-io');
    const clientRootServer = require('../client/api/socket-io');
    assert.ok(server instanceof http.Server);
    assert.equal(clientRootServer, server);
    assert.equal(server.listening, false);
    assert.ok(server.listeners('upgrade').length > 0);

    const packageJson = JSON.parse(
        fs.readFileSync(path.join(root, 'package.json'), 'utf8')
    );
    assert.equal(packageJson.main, 'client/api/_lib/server.js');
    assert.equal(packageJson.scripts.start, 'node client/api/_lib/server.js');

    const html = fs.readFileSync(path.join(root, 'client/index.html'), 'utf8');
    assert.match(html, /cdn\.socket\.io\/4\.6\.1\/socket\.io\.min\.js/);

    const main = fs.readFileSync(path.join(root, 'client/main.js'), 'utf8');
    assert.match(main, /path:\s*['"]\/api\/socket-io\/socket\.io['"]/);
    assert.match(main, /transports:\s*\[['"]websocket['"]\]/);
});

test('local server still serves the canvas after sharing its module with Vercel', async (t) => {
    const server = require('../client/api/_lib/server');
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /<title>Collaborative Drawing Canvas<\/title>/);
});
