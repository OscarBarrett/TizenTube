// The TizenBrew-way of TizenTube. Uses CDP and SDB to inject the userscript.

const adbhost = require('adbhost');
const CDP = require('chrome-remote-interface');
const fetch = require('node-fetch');
const userscript = require('./userscript.js');
const spoof = require('./spoof.js');


var isConnecting = false;
const isTizen3 = tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version').startsWith('3.0');

function connectToDebugger(host, port, args) {
    fetch(`http://${host}:${port}`).then(_ => {
        CDP({ host, port, local: true }, client => {
            isConnecting = false;
            client.Runtime.enable();
            client.Page.enable();
            client.Network.enable();

            client.on('Runtime.executionContextCreated', m => {
                // Inject the diagnostic overlay first so it captures early errors.
                client.Runtime.evaluate({ expression: spoof.OVERLAY_EXPR, contextId: m.context.id }).catch(() => {});
                userscript.refreshVersion().then(() => fetch(userscript.userscriptUrl())).then(res => res.text()).then(modFile => {
                    client.Runtime.evaluate({ expression: modFile, contextId: m.context.id });
                }).catch(e => {
                    client.Runtime.evaluate({ expression: 'alert("Failed to request to JSDelivr CDN.")', contextId: m.context.id });
                });
            });

            // Spoof the user agent at the debugger level so YouTube serves the desired variant,
            // then navigate. The webview parses the (large) response headers natively.
            const applyUAOverride = spoof.SPOOF_MODE
                ? client.Runtime.evaluate({ expression: 'navigator.userAgent', returnByValue: true })
                    .then(r => client.Network.setUserAgentOverride({ userAgent: spoof.spoofUserAgent(r && r.result && r.result.value) }))
                    .catch(() => client.Network.setUserAgentOverride({ userAgent: spoof.spoofUserAgent('') }))
                : Promise.resolve();

            applyUAOverride.then(() => {
                client.Page.navigate({ url: `https://youtube.com/tv?additionalDataUrl=http%3A%2F%2Flocalhost%3A8085%2Fdial%2Fapps%2FYouTube${args ? `&${args}` : ''}` });
                client.Page.setBypassCSP({ enabled: true });
            });
        })
    }).catch(e => {
        return setTimeout(() => connectToDebugger(host, port, args), 100);
    })
}

function canConnectToDaemon() {
    return fetch('http://127.0.0.1:8001/api/v2/').then(res => res.json())
        .then(json => {
            return { canConnectToDaemon: (json.device.developerIP === '127.0.0.1' || json.device.developerIP === '1.0.0.127') && json.device.developerMode === '1', ip: json.device.ip, isConnecting }
        }).catch(e => {
            return canConnectToDaemon();
        });
}

function startDebugger(args) {
    return canConnectToDaemon().then(res => {
        if (!res.canConnectToDaemon) return false;
        const client = adbhost.createConnection({ host: '127.0.0.1', port: 26101 });

        client._stream.on('connect', () => {
            const packageId = tizen.application.getAppInfo().packageId;
            isConnecting = true;
            const shellCmd = client.createStream(`shell:0 debug ${packageId}.TizenTubeStandalone${isTizen3 ? ' 0' : ''}`);
            shellCmd.on('data', (data) => {
                const dataString = data.toString();
                if (dataString.includes('debug')) {
                    const port = Number(dataString.substr(dataString.indexOf(':') + 1, 6).replace(' ', ''));
                    connectToDebugger(res.ip, port, args);
                    setTimeout(() => client._stream.end(), 1000);
                }
            });
        });

        return true;
    });
}

module.exports = {
    startDebugger,
    canConnectToDaemon
};