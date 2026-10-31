function normalizeURL(value, base) {
    const url = new URL(value, base);
    if (url.origin !== new URL(base).origin || url.protocol !== 'https:' || url.username || url.password) {
        throw new Error('POLITE内のPDFまたは資料ページのURLを入力してください。');
    }
    if (url.searchParams.has('forcedownload')) url.searchParams.set('forcedownload', '0');
    url.hash = '';
    return url.href;
}

async function loadPDF(value, {base, signal, fetcher = fetch, Parser = DOMParser}) {
    let url = normalizeURL(value, base);
    const visited = new Set();
    for (let step = 0; step < 3; step++) {
        if (visited.has(url)) break;
        visited.add(url);
        const response = await fetcher(url, {credentials:'same-origin', signal});
        if (!response.ok) throw new Error(`資料を取得できませんでした（${response.status}）。`);
        const finalURL = normalizeURL(response.url || url, base);
        const blob = await response.blob();
        // Login and permission pages often return 200, so check the actual file.
        const prefix = await blob.slice(0, 1024).text();
        if (prefix.includes('%PDF-')) return {blob:new Blob([blob], {type:'application/pdf'}), url:finalURL};
        const type = response.headers.get('content-type') || '';
        if (!/html/i.test(type) && !/^\s*(?:<!doctype|<html)/i.test(prefix)) break;
        const doc = new Parser().parseFromString(await blob.text(), 'text/html');
        if (doc.querySelector('form#login, input[name="password"]')) {
            throw new Error('POLITEにログインしてから、もう一度開いてください。');
        }
        const candidates = [...doc.querySelectorAll('object[data], embed[src], iframe[src], .resourceworkaround a[href]')];
        let next;
        for (const node of candidates) {
            try {
                const candidate = normalizeURL(node.getAttribute('data') || node.getAttribute('src') || node.getAttribute('href'), finalURL);
                if (/\.pdf(?:$|\?)|\/pluginfile\.php\//i.test(candidate) && !visited.has(candidate)) {next = candidate; break;}
            } catch (_) { /* Ignore external embedded media. */ }
        }
        if (!next) break;
        url = next;
    }
    throw new Error('PDFを確認できませんでした。PDFへのリンクまたはPDFを含む資料ページのURLを指定してください。');
}

module.exports = {normalizeURL, loadPDF};
