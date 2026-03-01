/**
 * Sandbox HTML template
 *
 * This HTML is loaded into a sandboxed iframe (sandbox="allow-scripts").
 * It has NO access to Node.js, no process, no require, no fetch.
 * The ONLY communication channel is postMessage to the parent.
 *
 * Chromium's iframe sandbox provides OS-level process isolation.
 */

export const SANDBOX_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<script>
// === SANDBOX-SEITE: Kein Node.js, kein Parent-Zugriff ===

// Bridge-Proxy fuer async Aufrufe zum Plugin
var pendingCalls = new Map();
var callCounter = 0;

function bridgeCall(type, payload) {
    return new Promise(function(resolve, reject) {
        var callId = 'bc_' + (++callCounter);
        var timeout = setTimeout(function() {
            pendingCalls.delete(callId);
            reject(new Error('Bridge call timeout'));
        }, 15000);
        pendingCalls.set(callId, { resolve: resolve, reject: reject, timeout: timeout });
        parent.postMessage(Object.assign({}, payload, { type: type, callId: callId }), '*');
    });
}

// Vault-API (Bridge)
var vault = {
    read: function(path) { return bridgeCall('vault-read', { path: path }); },
    readBinary: function(path) { return bridgeCall('vault-read-binary', { path: path }); },
    list: function(path) { return bridgeCall('vault-list', { path: path }); },
    write: function(path, content) { return bridgeCall('vault-write', { path: path, content: content }); },
    writeBinary: function(path, content) { return bridgeCall('vault-write-binary', { path: path, content: content }); }
};

// requestUrl (Bridge, URL-Allowlist auf Plugin-Seite)
var requestUrl = function(url, options) { return bridgeCall('request-url', { url: url, options: options }); };

// Message-Handler fuer Bridge-Responses und Execute-Befehle
window.addEventListener('message', function(event) {
    var msg = event.data;
    if (!msg) return;

    // Bridge-Response
    if (msg.callId && pendingCalls.has(msg.callId)) {
        var p = pendingCalls.get(msg.callId);
        clearTimeout(p.timeout);
        pendingCalls.delete(msg.callId);
        if (msg.error) { p.reject(new Error(msg.error)); }
        else { p.resolve(msg.result); }
        return;
    }

    // Execute-Befehl vom Plugin
    if (msg.type === 'execute') {
        Promise.resolve().then(function() {
            var moduleExports = {};
            var moduleFunc = new Function('exports', 'vault', 'requestUrl', msg.code);
            moduleFunc(moduleExports, vault, requestUrl);
            return moduleExports.execute(msg.input, { vault: vault, requestUrl: requestUrl });
        }).then(function(result) {
            parent.postMessage({ type: 'result', id: msg.id, value: result }, '*');
        }).catch(function(e) {
            parent.postMessage({ type: 'error', id: msg.id, message: e.message || String(e) }, '*');
        });
    }
});

// Signal: Sandbox ist bereit
parent.postMessage({ type: 'sandbox-ready' }, '*');
</script>
</body>
</html>`;
