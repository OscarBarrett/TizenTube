"use strict";

// TizenTube Standalone service

const express = require('express');
const app = express();
const PORT = Number(process.env.TT_PORT) || 8199;
const SPOOF_MODE = process.env.TT_SPOOF_MODE !== undefined ? process.env.TT_SPOOF_MODE : 'cobalt'; // '', 'tizen' or 'cobalt'
const SPOOF_TIZEN_VERSION = '8.0';
const COBALT_VERSION = '24.lts.60.1032993-gold';
const COBALT_MODEL_YEAR = '2022';
const DEBUG_OVERLAY = true;
const DEBUG_OVERLAY_SCRIPT = `<script>(function(){
var box=document.createElement('div');box.id='tt-debug';box.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2147483647;background:rgba(120,0,0,.85);color:#fff;font:18px monospace;padding:8px;white-space:pre-wrap;max-height:60%;overflow:hidden;pointer-events:none';
var lines=[];function log(m){lines.push(new Date().toISOString().substr(11,8)+' '+m);if(lines.length>16)lines.shift();box.textContent=lines.join('\\n');if(!box.parentNode&&document.body)document.body.appendChild(box);}
window.__ttlog=log;
window.addEventListener('error',function(e){if(e.target&&e.target!==window&&(e.target.src||e.target.href)){log('RESOURCE FAIL '+String(e.target.src||e.target.href).split('/').pop().slice(0,70));return;}log('ERROR '+(e.message||'')+' @'+String(e.filename||'').split('/').pop().slice(0,40)+':'+e.lineno);},true);
window.addEventListener('unhandledrejection',function(e){log('REJECT '+String(e.reason&&e.reason.message||e.reason).slice(0,150));});
document.addEventListener('DOMContentLoaded',function(){log('DOMContentLoaded ua='+navigator.userAgent.slice(0,70));});
window.addEventListener('load',function(){log('load');});
var n=0;setInterval(function(){n++;var app=document.querySelector('ytlr-app,#app,[class*=ytlr]');if(n%2===0)log('tick '+(n*2)+'s scripts='+document.scripts.length+' app='+(app?app.tagName.toLowerCase():'none')+' yttv='+(window._yttv?'y':'n')+' body='+(document.body?document.body.children.length:'-'));},2000);
log('overlay ready');
})();</script>`;
const fetch = require('node-fetch');
const http = require('http');
const https = require('https');
const URL = require('url');
const injector = require('./injector.js');
const userscript = require('./userscript.js');

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

app.get('/tizentube/getState', (req, res) => {
    injector.canConnectToDaemon().then(r => {
        res.json(r);
    });
});

app.get('/tizentube/debugger', (req, res) => {
    const args = req.originalUrl.split('?')[1] || '';
    const interval = setInterval(() => {
        tizen.application.getAppsContext((appsContext) => {
            const packageId = tizen.application.getAppInfo().packageId;
            const app = appsContext.find(app => app.appId === `${packageId}.TizenTubeStandalone`);
            if (!app) {
                injector.startDebugger(args);
                clearInterval(interval)
            }
        });
    }, 50);
});

function spoofUserAgent(userAgent) {
    if (SPOOF_MODE === 'cobalt') {
        const tizenVersion = (userAgent.match(/Tizen (\d+(?:\.\d+)?)/) || [])[1] || '6.5';
        const device = userAgent.match(/_TV_([A-Z0-9]+)\/([^ ]+) \(([^,]+), ([^,]+), ([^)]+)\)/) || [];
        const chipset = device[1] || 'PONTUSM';
        const firmware = device[2] || 'T-PTMUABC-1720.7';
        const brand = device[3] || 'Samsung';
        const model = device[4] || 'QA55QN85BAWXXY';
        const connection = device[5] || 'Wired';
        return `Mozilla/5.0 (SMART-TV; Linux; Tizen ${tizenVersion}) Cobalt/${COBALT_VERSION} (unlike Gecko) v8/8.8.278.17-jit gles Starboard/15, ${brand}_TV_${chipset}_${COBALT_MODEL_YEAR}/${firmware} (${brand}, ${model}, ${connection})`;
    }
    return userAgent
        .replace(/Tizen \d+(\.\d+)?/, `Tizen ${SPOOF_TIZEN_VERSION}`)
        .replace(/\/\d+(\.\d+)? TV Safari/, `/${SPOOF_TIZEN_VERSION} TV Safari`);
}

app.all('*', (req, res) => {
    const isCorsBypass = req.path.indexOf('/cors-bypass/') === 0;

    let targetUrl;
    if (isCorsBypass) {
        const rawTarget = req.url.substring('/cors-bypass/'.length);
        targetUrl = rawTarget.indexOf('http') === 0 ? rawTarget : `https://${rawTarget}`;
    } else {
        targetUrl = `https://www.youtube.com${req.url}`;
    }

    const headers = {};
    for (const key in req.headers) {
        if (Object.prototype.hasOwnProperty.call(req.headers, key)) {
            if (key === 'cookie') {
                headers[key] = req.headers[key]
                    .replace(/__LocalSecure-/g, '__Secure-')
                    .replace(/__LocalHost-/g, '__Host-');
                continue;
            }
            headers[key] = req.headers[key]
        }
    }

    try {
        const parsedUrl = URL.parse(targetUrl);
        headers['host'] = parsedUrl.host;
    } catch (e) {
        headers['host'] = isCorsBypass ? 'www.youtube.com' : 'www.youtube.com';
    }

    headers['origin'] = 'https://www.youtube.com';
    if (SPOOF_MODE && headers['user-agent']) {
        headers['user-agent'] = spoofUserAgent(headers['user-agent']);
    }
    if (headers['referer']) {
        headers['referer'] = 'https://www.youtube.com/tv';
    }

    headers['accept-encoding'] = 'gzip, deflate';

    const hasBody = ['POST', 'PUT', 'PATCH'].indexOf(req.method) !== -1;
    const fetchOptions = {
        method: req.method,
        headers: headers,
        body: hasBody ? req : undefined,
        redirect: 'manual'
    };

    const isTvPage = req.url.indexOf('/tv') === 0 && req.url.indexOf('/tv_config') === -1;
    const ready = isTvPage ? userscript.refreshVersion() : Promise.resolve();

    ready.then(() => fetch(targetUrl, fetchOptions))
        .then((response) => {
            if (req.method === 'OPTIONS') {
                res.status(200);
            } else {
                res.status(response.status);
            }

            const headerKeys = response.headers.raw();
            for (const key in headerKeys) {
                if (Object.prototype.hasOwnProperty.call(headerKeys, key)) {
                    const lowerKey = key.toLowerCase();
                    const skipHeaders = ['content-encoding', 'content-length', 'transfer-encoding', 'content-security-policy', 'alt-svc'];
                    if (isCorsBypass) skipHeaders.push('access-control-allow-origin');

                    if (skipHeaders.indexOf(lowerKey) !== -1) continue;

                    const value = response.headers.get(key);
                    if (lowerKey === 'set-cookie') {
                        const rawCookies = headerKeys[key];
                        if (Array.isArray(rawCookies)) {
                            const modifiedCookies = rawCookies.map(cookieStr => {
                                return cookieStr
                                    .replace(/^__Secure-/i, '__LocalSecure-')
                                    .replace(/^__Host-/i, '__LocalHost-')
                                    .replace(/Domain=[^;]+/i, 'Domain=localhost')
                                    .replace(/;\s*Secure/i, '')
                                    .replace(/;\s*SameSite=None/i, '')
                                    .replace(/;\s*;/g, ';')
                                    .replace(/;\s*$/, '');
                            });
                            res.setHeader('Set-Cookie', modifiedCookies);
                            continue;
                        }
                    }

                    res.setHeader(key, value);
                }
            }

            res.setHeader('Access-Control-Allow-Origin', '*');

            const contentType = response.headers.get('content-type') || '';

            if (contentType.indexOf('text/html') !== -1 ||
                contentType.indexOf('application/json') !== -1 ||
                contentType.indexOf('javascript') !== -1 ||
                contentType.indexOf('text/css') !== -1) {

                return response.text().then((text) => {
                    if (req.url.indexOf('/tv') === 0 && req.url.indexOf('/tv_config') === -1) {
                        // Insert the userscript for TizenTube
                        text += `<script src="${userscript.userscriptUrl()}?ver=${Date.now()}"></script>`;
                        if (SPOOF_MODE && req.headers['user-agent']) {
                            text = text.replace('<head>', `<head><script>Object.defineProperty(navigator, 'userAgent', { get: function () { return ${JSON.stringify(spoofUserAgent(req.headers['user-agent']))}; } });</script>`);
                        }
                        if (DEBUG_OVERLAY) {
                            text = text.replace('<head>', `<head>${DEBUG_OVERLAY_SCRIPT}`);
                        }
                    }

                    const proxyPrefix = `http://localhost:${PORT}/cors-bypass/`;

                    // Rewrite rules for replacing URLs so CORS and presumably YT is happy.
                    text = text.replace(/https:\/\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, `${proxyPrefix}https://$1.googlevideo.com`);
                    text = text.replace(/https:\\\/\\\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, `http:\\\/\\\/localhost:${PORT}\\\/cors-bypass\\\/https:\\\/\\\/$1.googlevideo.com`);
                    text = text.replace(/"\/\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, `"${proxyPrefix}https://$1.googlevideo.com`);

                    text = text.replace(/https:\/\/www\.gstatic\.com/g, `${proxyPrefix}https://www.gstatic.com`);
                    text = text.replace(/http:\/\/www\.gstatic\.com/g, `${proxyPrefix}https://www.gstatic.com`);
                    text = text.replace(/"\/\/www\.gstatic\.com/g, `"${proxyPrefix}https://www.gstatic.com`);
                    text = text.replace(/\(\/\/www\.gstatic\.com/g, `(${proxyPrefix}https://www.gstatic.com`);

                    text = text.replace(/https:\/\/yt3\.ggpht\.com/g, `${proxyPrefix}https://yt3.ggpht.com`);

                    text = text.replace(/https:\/\/clients1\.google\.com/g, `${proxyPrefix}https://clients1.google.com`);
                    text = text.replace(/http:\/\/clients1\.google\.com/g, `${proxyPrefix}https://clients1.google.com`);
                    text = text.replace(/"\/\/clients1\.google\.com/g, `"${proxyPrefix}https://clients1.google.com`);

                    text = text.replace('Set(["www.youtube.com","accounts.google.com"]);', 'Set(["www.youtube.com", "accounts.google.com", "localhost"]);');
                    text = text.replace(/:document\.location\.toString\(\)/g, ':document.location.toString().replace("http://localhost:' + PORT + '", "https://www.youtube.com")');
                    text = text.replace(/euri:[^,]+,/g, 'euri:document.location.toString().replace("http://localhost:' + PORT + '", "https://www.youtube.com"),')
                    text = text.replace(/https:\/\/s\.youtube\.com/g, `${proxyPrefix}https://s.youtube.com`);
                    text = text.replace(/redirector.googlevideo.com/g, `${proxyPrefix}https://redirector.googlevideo.com`);
                    text = text.replace(/this.scheme="https"/, 'this.scheme="http"');
                    text = text.replace(/https\:\/\/jnn-pa.googleapis.com/g, `${proxyPrefix}https://jnn-pa.googleapis.com`);
                    text = text.replace(/https:\/\/yt3\.googleusercontent\.com/g, `${proxyPrefix}https://yt3.googleusercontent.com`);
                    text = text.replace(/"\/\/yt3\.googleusercontent\.com/g, `"${proxyPrefix}https://yt3.googleusercontent.com`);

                    // In order to fix history not working
                    text = text.replace(/=window\.location\.href;/, '=window.location.href.replace("http://localhost:' + PORT + '", "https://www.youtube.com");')
                    text = text.replace(/=document\.location\.href/, '=document.location.href.replace("http://localhost:' + PORT + '", "https://www.youtube.com")')

                    res.send(text);
                });
            } else {
                if (response.body) {
                    response.body.pipe(res);
                } else {
                    res.end();
                }
            }
        })
        .catch((error) => {
            console.error(`Proxy Error for [${targetUrl}]: ${error}`);
            console.error(error.stack)
            if (!res.headersSent) {
                res.status(500).send('Proxy Connection Broken');
            }
        });
});

userscript.refreshVersion();
app.listen(PORT, "127.0.0.1");

// Start the DIAL server
global.isTizenTube = true;
global.tizenTubeDialPort = PORT - 4;
require('../../dist/service.js');