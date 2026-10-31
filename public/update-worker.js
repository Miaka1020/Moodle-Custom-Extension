import {updateStatus, compareVersions} from './update-check.js';
const BROWSER_UPDATE_KEY = 'mce_browser_update_v1';
const INSTALLED_UPDATE_KEY = 'mce_installed_update_v1';
const STORE_ID = 'plihohicbpnimfimobapbjeebebabjja';
const STORE_URL = `https://chromewebstore.google.com/detail/${STORE_ID}`;
let pending;
function storeInstallation() {
    const manifest = chrome.runtime.getManifest();
    return chrome.runtime.id === STORE_ID && /^https:\/\/(?:clients2\.google\.com|update\.googleapis\.com)\//.test(manifest.update_url || '');
}
async function rememberAvailable(version) {
    if (compareVersions(version, chrome.runtime.getManifest().version) !== 1) return;
    await chrome.storage.local.set({[BROWSER_UPDATE_KEY]:{version, url:STORE_URL}});
}
chrome.runtime.onUpdateAvailable.addListener(details => {
    rememberAvailable(details.version).catch(() => {});
});
chrome.runtime.onInstalled.addListener(details => {
    const version = chrome.runtime.getManifest().version;
    if (details.reason !== 'update' || compareVersions(version, details.previousVersion) !== 1) return;
    chrome.storage.local.set({[INSTALLED_UPDATE_KEY]:{
        previousVersion:details.previousVersion, version, at:Date.now(), store:storeInstallation()
    }}).catch(() => {});
});
async function status(manual = false) {
    const current = chrome.runtime.getManifest().version;
    const managed = storeInstallation();
    let storeCheck = managed ? 'automatic' : 'development';
    // Chrome already checks automatically. Only explicit user checks call this API.
    if (manual && managed) {
        try {
            const result = await chrome.runtime.requestUpdateCheck();
            storeCheck = result.status;
            if (result.status === 'update_available') await rememberAvailable(result.version);
        } catch (_) {storeCheck = 'failed';}
    }
    const saved = await chrome.storage.local.get([BROWSER_UPDATE_KEY, INSTALLED_UPDATE_KEY]);
    const store = {...updateStatus(current, managed ? saved[BROWSER_UPDATE_KEY] : null), url:STORE_URL, managed, check:storeCheck};
    const installed = saved[INSTALLED_UPDATE_KEY];
    const installedUpdate = installed?.store && installed.version === current &&
        compareVersions(current, installed.previousVersion) === 1 && Date.now() >= installed.at &&
        Date.now() - installed.at < 7 * 86400000 ? installed : null;
    return {...store, source:'store', store, installedUpdate};
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'MCE_CHECK_UPDATE' || !sender.url?.startsWith('https://polite.do-johodai.ac.jp/')) return false;
    if (!pending) pending = status(message.manual === true).finally(() => {pending = null;});
    pending.then(respond, () => respond({available:false, failed:true}));
    return true;
});
