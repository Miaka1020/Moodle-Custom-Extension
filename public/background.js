// Archive functionality removed. The background worker intentionally does not
// register archive storage or message handlers.
const DB_NAME = "PoliteArchive";
const STORE_NAME = "pages";

// ======================
// IndexedDB を開く
// ======================
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 2);

        request.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "url" });
            }
        };

        request.onsuccess = e => resolve(e.target.result);
        request.onerror = e => reject(e.target.error);
    });
}

// ======================
// ページ取得・保存
// ======================
async function archivePage(db, url) {
    try {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const html = await res.text();

        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            
            store.put({
                url: url,
                html: html,
                savedAt: new Date().toISOString()
            });

            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(tx.error);
        });
    } catch (e) {
        console.error("📦 Polite Archive: 保存失敗:", url, e);
    }
}

// ======================
// 存在チェック（確実に Promise を解決させる）
// ======================
function checkPageExists(db, url) {
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(url);

            req.onsuccess = (e) => {
                // e.target.result または req.result を確認
                const result = e.target?.result || req.result;
                resolve(!!result); 
            };
            req.onerror = () => {
                resolve(false); // エラー時もフリーズさせず「存在しない」として進める
            };
        } catch (err) {
            console.error("DBチェック中に例外発生:", err);
            resolve(false);
        }
    });
}

// ======================
// 個別コースの自動保存（タブID固定版）
// ======================
async function archiveSingleCourse(courseUrl, html, tabId) {
    let db = null;
    try {
        // /mod/ 系のリンクを抽出
        const links = [...html.matchAll(/href="([^"]+)"/g)]
            .map(x => x[1])
            .filter(url => url.includes("/mod/"));
        
        const uniqueLinks = [...new Set(links)];
        const total = uniqueLinks.length;
        let current = 0;

        // 送信元のタブが生きているか確認しつつ進捗を送るヘルパー
        const sendProgress = (curr, tot) => {
            chrome.tabs.sendMessage(tabId, { 
                type: "ARCHIVE_PROGRESS", 
                current: curr, 
                total: tot 
            }).catch(() => {
                // タブが閉じられた、または切り替わった場合はここを通る（エラーで全体を落とさない）
                console.log("進捗の送信に失敗（タブが非アクティブの可能性あり）");
            });
        };

        if (total === 0) {
            sendProgress(1, 1);
            return;
        }

        // 開始通知
        sendProgress(0, total);

        // DBオープン
        db = await openDB();

        for (const page of uniqueLinks) {
            // 修正：確実に結果が返る Promise で重複チェック
            const isExist = await checkPageExists(db, page);

            if (isExist) {
                current++;
                sendProgress(current, total);
                continue;
            }

            // 新規資料のみ保存
            await archivePage(db, page);
            current++;
            sendProgress(current, total);
            
            // サーバー負荷軽減のウェイト
            await new Promise(r => setTimeout(r, 150)); 
        }

        console.log(`📦 Polite Archive: コース全体の同期が完了しました (${current}/${total})`);
    } catch (e) {
        console.error("📦 Polite Archive: アーカイブ処理全体でエラーが発生:", e);
    } finally {
        if (db) {
            db.close();
        }
    }
}

// ======================
// メッセージ受信
// ======================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    return false;
    /*
    if (message.type === "START_SINGLE_ARCHIVE") {
        // 修正：メッセージを送ってきた元のタブID（sender.tab.id）を確実に掴んで渡す
        const tabId = sender.tab?.id;
        if (tabId) {
            archiveSingleCourse(message.url, message.html, tabId);
            sendResponse({ status: "started", tabId: tabId });
        } else {
            sendResponse({ status: "error", message: "Tab ID not found" });
        }
    }
    return true;
    */
});
