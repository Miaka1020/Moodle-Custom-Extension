module.exports = function extensionInfo() {
    const info = document.createElement('section');
    info.id = 'mce-extension-info';
    info.setAttribute('aria-label', 'Custom-POLITEのバージョンと更新情報');
    const current = chrome.runtime?.getManifest?.().version || require('../public/manifest.json').version;
    const storeURL = 'https://chromewebstore.google.com/detail/plihohicbpnimfimobapbjeebebabjja';
    const validVersion = value => /^\d{1,5}(?:\.\d{1,5}){0,3}$/.test(value || '');
    const heading = document.createElement('strong'); heading.textContent = 'Custom-POLITE';
    const version = document.createElement('span'); version.className = 'mce-extension-version'; version.textContent = `ver${current}`;
    const notice = document.createElement('p'); notice.className = 'mce-update-notice'; notice.setAttribute('role','status'); notice.hidden = true;
    const installed = document.createElement('p'); installed.className = 'mce-update-installed'; installed.setAttribute('role','status'); installed.hidden = true;
    const feedback = document.createElement('p'); feedback.className = 'mce-update-check-status'; feedback.setAttribute('role','status'); feedback.hidden = true;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'mce-update-check'; button.textContent = '更新を確認';
    const download = document.createElement('a'); download.textContent = 'Chromeウェブストア'; download.href = storeURL; download.target = '_blank'; download.rel = 'noopener noreferrer';
    info.append(heading, version, button, download, notice, installed, feedback);
    let pending = false;
    const check = async (manual = false) => {
        if (pending || document.hidden || !chrome.runtime?.sendMessage) return;
        pending = true;
        button.disabled = true;
        if (manual) button.textContent = '確認中…';
        try {
            const result = await chrome.runtime.sendMessage({type:'MCE_CHECK_UPDATE', manual});
            const valid = validVersion(result?.version);
            const available = result?.available === true && valid;
            info.dataset.update = String(available);
            notice.hidden = !available;
            notice.textContent = available ? `Chromeウェブストア版 ver${result.version}の更新が届いています。アップデート適用後、このページを再読み込みしてください。` : '';
            const updated = result?.installedUpdate;
            installed.hidden = !updated || !validVersion(updated.version) || !validVersion(updated.previousVersion);
            installed.textContent = installed.hidden ? '' : `Chromeウェブストア版 ver${updated.version}に更新済みです（以前：ver${updated.previousVersion}）。`;
            if (manual || result?.store?.check === 'development') {
                feedback.hidden = false;
                feedback.textContent = result?.store?.check === 'throttled' ? 'Chromeの更新確認は待機中です。時間をおいて確認してください。' :
                    !result || result?.store?.check === 'failed' || result?.failed ? 'Chromeウェブストアの更新を確認できませんでした。時間をおいて再試行してください。' :
                    result?.store?.check === 'development' ? '開発版で読み込まれています。ストアからインストールした版で更新の自動確認が利用できます。' :
                    available ? 'Chromeウェブストアの更新を確認しました。' : 'このChromeに配信されている新しい更新はありません。';
            }
            download.title = result?.failed ? 'Chromeウェブストアの更新を確認できませんでした。' : '';
        } catch (error) {
            download.title = 'Chromeウェブストアの更新を確認できませんでした。';
            if (manual) {feedback.hidden = false; feedback.textContent = /context invalidated/i.test(error.message || '') ? '拡張機能の更新を反映するため、このページを再読み込みしてください。' : download.title;}
        }
        finally {pending = false; button.disabled = false; button.textContent = '更新を確認';}
    };
    button.addEventListener('click', () => check(true));
    const onVisible = () => {if (!document.hidden) check();};
    const onChanged = (changes, area) => {
        if (area === 'local' && (changes.mce_browser_update_v1 || changes.mce_installed_update_v1)) check();
    };
    document.addEventListener('visibilitychange', onVisible);
    chrome.storage?.onChanged?.addListener(onChanged);
    window.addEventListener('pagehide', event => {
        if (event.persisted) return;
        document.removeEventListener('visibilitychange', onVisible);
        chrome.storage?.onChanged?.removeListener(onChanged);
    });
    check();
    return info;
};
