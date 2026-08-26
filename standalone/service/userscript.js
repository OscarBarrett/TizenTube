"use strict";

const fetch = require('node-fetch');

const USERSCRIPT_PACKAGE = '@oscarbarrett/tizentube';
const REGISTRY_URL = `https://registry.npmjs.org/${USERSCRIPT_PACKAGE.replace('/', '%2F')}/latest`;
const REGISTRY_TIMEOUT_MS = 4000;

let version = '';

function refreshVersion() {
    return fetch(REGISTRY_URL, { timeout: REGISTRY_TIMEOUT_MS })
        .then(res => res.json())
        .then(json => {
            if (json && json.version) version = json.version;
        })
        .catch(() => {});
}

function userscriptUrl() {
    return `https://cdn.jsdelivr.net/npm/${USERSCRIPT_PACKAGE}${version ? `@${version}` : ''}/dist/userScript.js`;
}

module.exports = {
    refreshVersion,
    userscriptUrl
};
