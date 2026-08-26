"use strict";

const SPOOF_MODE = process.env.TT_SPOOF_MODE !== undefined ? process.env.TT_SPOOF_MODE : 'cobalt'; // '', 'tizen' or 'cobalt'
const SPOOF_TIZEN_VERSION = '8.0';
const COBALT_VERSION = '24.lts.60.1032993-gold';
const COBALT_MODEL_YEAR = '2022';

function spoofUserAgent(userAgent) {
    if (!userAgent) userAgent = '';
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
    if (SPOOF_MODE === 'tizen') {
        return userAgent
            .replace(/Tizen \d+(\.\d+)?/, `Tizen ${SPOOF_TIZEN_VERSION}`)
            .replace(/\/\d+(\.\d+)? TV Safari/, `/${SPOOF_TIZEN_VERSION} TV Safari`);
    }
    return userAgent;
}

// Runtime-injectable diagnostic overlay (no <script> wrapper), for CDP Runtime.evaluate.
const OVERLAY_EXPR = `(function(){
if(window.__ttOverlay)return;window.__ttOverlay=1;
var box=document.createElement('div');box.id='tt-debug';box.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2147483647;background:rgba(120,0,0,.85);color:#fff;font:20px monospace;padding:8px;white-space:pre-wrap;max-height:60%;overflow:hidden;pointer-events:none';
var lines=[];function log(m){lines.push(new Date().toISOString().substr(11,8)+' '+m);if(lines.length>16)lines.shift();box.textContent=lines.join('\\n');if(!box.parentNode&&document.body)document.body.appendChild(box);}
window.__ttlog=log;
window.addEventListener('error',function(e){if(e.target&&e.target!==window&&(e.target.src||e.target.href)){log('RES FAIL '+String(e.target.src||e.target.href).split('/').pop().slice(0,70));return;}log('ERR '+(e.message||'')+' @'+String(e.filename||'').split('/').pop().slice(0,30)+':'+e.lineno);},true);
window.addEventListener('unhandledrejection',function(e){log('REJECT '+String(e.reason&&e.reason.message||e.reason).slice(0,140));});
log('overlay ready ua='+navigator.userAgent.slice(0,60));
var n=0;setInterval(function(){n++;var a=document.querySelector('ytlr-app,[class*=ytlr]');if(n%2===0)log('tick '+(n*2)+'s scripts='+document.scripts.length+' app='+(a?a.tagName.toLowerCase():'none')+' yttv='+(window._yttv?'y':'n')+' body='+(document.body?document.body.children.length:'-'));},2000);
})();`;

module.exports = { SPOOF_MODE, spoofUserAgent, OVERLAY_EXPR };
