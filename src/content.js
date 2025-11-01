(function() {
    'use strict';

    // --- 定数 ---

    // IndexedDB
    const DB_NAME = 'MoodleCustomBGDB';
    const DB_VERSION = 2;
    const STORE_NAME = 'background_files';
    const DB_KEY_BG = 'current_bg';

    // ストレージキー
    const SETTINGS_STORAGE_KEY = 'moodle_custom_settings_v4';
    const TIMETABLE_STORAGE_KEY = 'moodle_custom_timetable_v2';

    // デフォルト設定
    const DEFAULT_SETTINGS = {
        headerBgColor: "#ffffff",
        headerTextColor: "#000000",
        headerStrokeColor: "#ffffff",
        backgroundUrl: '',
        backgroundType: 'none',
        opacity: 80,
        brightness: 100,
        showTimetable: true,
        contentOpacity: 70
    };

    // 時間割
    
   const DEFAULT_TIMETABLE = {
        "月": {},
        "火": {},
        "水": {},
        "木": {},
        "金": {},
        "土": {}, "日": {}
    };
    const CLASS_TIMES = [
        { start: 900, end: 1030, period: 1 }, { start: 1040, end: 1210, period: 2 }, { start: 1255, end: 1425, period: 3 },
        { start: 1435, end: 1605, period: 4 }, { start: 1615, end: 1745, period: 5 }, { start: 1755, end: 1925, period: 6 }
    ];
    const DAY_MAP = ["日", "月", "火", "水", "木", "金", "土"];

    // セレクタ
    const BODY_SELECTOR = 'body#page-my-index, body#page-course-view-topics, body#page-course-view-weeks,body#page';
    const PAGE_WRAPPER_SELECTOR = '#page-wrapper';
    const DASHBOARD_REGION_SELECTOR = '#block-region-content';

    // --- グローバル変数 ---

    let db;
    let currentSettings = {};
    let currentBG_BlobUrl = null;

    // --- IndexedDB関連 ---

    // IndexedDBのセットアップ
    function setupIndexedDB() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) {
                console.warn("IndexedDB not supported.");
                return resolve(null);
            }
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (event) => {
                db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
            request.onsuccess = (event) => {
                db = event.target.result;
                resolve(db);
            };
            request.onerror = (event) => {
                console.error("IndexedDB error:", event.target.errorCode);
                reject(event.target.errorCode);
            };
        });
    }

    // DBにBlobを保存
    function saveFileToDB(blob, mimeType) {
        return new Promise((resolve, reject) => {
            if (!db) return reject('DB not initialized');
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const data = { id: DB_KEY_BG, blob: blob, type: mimeType };
            const request = store.put(data); // 常に同じキーで上書き
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e);
        });
    }

    // DBからBlobを読み込みURL化
    function loadFileFromDB() {
        return new Promise((resolve, reject) => {
            if (!db) return resolve(null);
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(DB_KEY_BG);
            request.onsuccess = (event) => {
                const data = event.target.result;
                if (data && data.blob) {
                    const url = URL.createObjectURL(data.blob);
                    resolve({ url: url, type: data.type });
                } else {
                    resolve(null);
                }
            };
            request.onerror = (e) => reject(e);
        });
    }

    // --- 設定 (ストレージ) ---

    // 設定の読み込み
    async function getSettings() {
        const data = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
        let settings;
        const stored = data[SETTINGS_STORAGE_KEY];

        if (stored) {
            try {
                settings = JSON.parse(stored);
            } catch (e) {
                console.error("設定データのパースに失敗。デフォルトを使用します。", e);
                settings = DEFAULT_SETTINGS;
            }
        } else {
            settings = DEFAULT_SETTINGS;
        }

        // デフォルト値とのマージ
        currentSettings = { ...DEFAULT_SETTINGS, ...settings };

        // 永続化ファイルのロードロジック
        if (currentSettings.backgroundUrl === 'indexeddb') {
            try {
                const fileData = await loadFileFromDB();
                if (fileData) {
                    if (currentBG_BlobUrl) URL.revokeObjectURL(currentBG_BlobUrl);
                    currentBG_BlobUrl = fileData.url;
                    currentSettings.backgroundUrl = fileData.url;
                    currentSettings.backgroundType = fileData.type.startsWith('video/') ? 'video' : 'image';
                } else {
                    currentSettings.backgroundUrl = '';
                    currentSettings.backgroundType = 'none';
                }
            } catch (e) {
                console.error("Failed to load file from IndexedDB:", e);
                currentSettings.backgroundUrl = '';
                currentSettings.backgroundType = 'none';
            }
        } else if (currentSettings.backgroundUrl !== '' && !currentSettings.backgroundUrl.startsWith('blob:')) {
            currentSettings.backgroundUrl = '';
            currentSettings.backgroundType = 'none';
        }
        
        return currentSettings;
    }

    // 設定の保存
    async function saveSettings(settings) {
        // Blob URLが残っている場合はクリーンアップ
        if (currentBG_BlobUrl && currentBG_BlobUrl !== settings.backgroundUrl) {
            URL.revokeObjectURL(currentBG_BlobUrl);
            currentBG_BlobUrl = null;
        }

        // IndexedDBに保存する際は、URLをプレースホルダーに
        let settingsToSave = { ...settings };
        if (settingsToSave.backgroundUrl.startsWith('blob:')) {
            settingsToSave.backgroundUrl = 'indexeddb';
        } else if (settingsToSave.backgroundUrl !== 'indexeddb') {
            settingsToSave.backgroundUrl = '';
            settingsToSave.backgroundType = 'none';
        }

        await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: JSON.stringify(settingsToSave) });
        currentSettings = settings; // 実行中の設定はBlob URLを保持
    }


    // --- UI・モーダル関連 ---

    // 設定ボタンの挿入
    function injectSettingsButton() {
        const usermenu = document.querySelector('#usernavigation .usermenu');
        if (!usermenu || document.getElementById('customSettingsBtn')) return;

        const settingItem = document.createElement('li');
        settingItem.classList.add('nav-item');
        settingItem.innerHTML = `
            <button id="customSettingsBtn" class="btn nav-link" style="
                background: none; border: none; padding: 0.5rem 0.8rem;
                cursor: pointer; font-size: 1.25rem; line-height: 1;
            " title="Moodleカスタム設定">
                <i class="fa fa-cog" aria-hidden="true"></i> </button>
        `;
        usermenu.prepend(settingItem);

        document.getElementById('customSettingsBtn').addEventListener('click', async () => {
            const settings = await getSettings();
            let modal = document.getElementById('custom-settings-modal');
            if (!modal) {
                injectSettingsModal(settings);
                modal = document.getElementById('custom-settings-modal');
            }
            loadSettingsToForm(settings);
            modal.style.display = 'flex';
        });
    }

    // 設定モーダルの挿入
    function injectSettingsModal(settings) {
        const modalHtml = `
            <div id="custom-settings-modal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.7); z-index: 10001; display: none; justify-content: center; align-items: center;">
                <div id="custom-settings-content" style="background-color: white; padding: 30px; border-radius: 8px; width: 95%; max-width: 600px; max-height: 90%; box-shadow: 0 5px 15px rgba(0,0,0,0.5); position: relative; display: flex; flex-direction: column;">
                    <h4 style="margin-top: 0; margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 10px;">
                       Moodle カスタム設定
                    </h4>
                    <div style="overflow-y: auto; flex-grow: 1;">

                        <fieldset style="border: 1px solid #ccc; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
                            <legend style="font-weight: bold; padding: 0 10px; width: auto; margin-left: -5px;">ヘッダー設定</legend>
                            <div style="display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: center;">
                                <label for="headerBgColorInput" style="font-weight: 500;">背景色:</label>
                                <input type="color" id="headerBgColorInput" value="${settings.headerBgColor}" style="height: 35px; width: 100%; border: 1px solid #ccc; padding: 2px;">
                                <label for="headerTextColorInput" style="font-weight: 500;">文字色:</label>
                                <input type="color" id="headerTextColorInput" value="${settings.headerTextColor}" style="height: 35px; width: 100%; border: 1px solid #ccc; padding: 2px;">
                                <label for="headerStrokeColorInput" style="font-weight: 500;">文字枠線色:</label>
                                <input type="color" id="headerStrokeColorInput" value="${settings.headerStrokeColor}" style="height: 35px; width: 100%; border: 1px solid #ccc; padding: 2px;">
                            </div>
                        </fieldset>

                        <fieldset style="border: 1px solid #ccc; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
                            <legend style="font-weight: bold; padding: 0 10px; width: auto; margin-left: -5px;">ページ背景設定 (画像/動画)</legend>
                            <input type="file" id="backgroundFileInput" accept="image/*,video/*" style="display: none;">
                            <button id="selectBackgroundBtn" style="padding: 8px 15px; background-color: #0062caff; color: white; border: none; border-radius: 4px; cursor: pointer; width: 100%; margin-bottom: 15px;">
                                ファイルを選択する (IndexedDB)
                            </button>
                            <p id="currentBackgroundInfo" style="font-size: 0.9em; color: #6c757d;"></p>
                            <p style="font-size: 0.8em; color: #6c757d; margin-top: 5px;">※画像・動画ともに大容量でも保存可能です。</p>
                            <hr>
                            <div style="margin-bottom: 15px;">
                                <label style="display: block; margin-bottom: 5px;">背景種別（現在の設定）:</label>
                                <input type="radio" id="bg-type-video" name="bg-type" value="video" ${settings.backgroundType === 'video' ? 'checked' : ''} disabled>
                                <label for="bg-type-video" style="margin-right: 15px;">動画</label>
                                <input type="radio" id="bg-type-image" name="bg-type" value="image" ${settings.backgroundType === 'image' ? 'checked' : ''} disabled>
                                <label for="bg-type-image">画像</label>
                            </div>
                            <div style="margin-top: 20px;">
                                <label for="opacityRange" style="display: block; margin-bottom: 5px; font-weight: bold;">背景の透明度: <span id="opacityValue">${settings.opacity}</span>%</label>
                                <input type="range" id="opacityRange" min="0" max="100" value="${settings.opacity}" style="width: 100%;">
                            </div>
                            <div style="margin-top: 15px;">
                                <label for="brightnessRange" style="display: block; margin-bottom: 5px; font-weight: bold;">背景の明度: <span id="brightnessValue">${settings.brightness}</span>%</label>
                                <input type="range" id="brightnessRange" min="0" max="200" value="${settings.brightness}" style="width: 100%;">
                                <small style="color: #6c757d;">(100%が標準)</small>
                            </div>
                        </fieldset>

                        <fieldset style="border: 1px solid #ccc; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
                            <legend style="font-weight: bold; padding: 0 10px; width: auto; margin-left: -5px;">コンテンツブロック背景設定</legend>
                            <div style="margin-top: 15px;">
                                <label for="contentOpacityRange" style="display: block; margin-bottom: 5px; font-weight: bold;">ブロックの透明度: <span id="contentOpacityValue">${settings.contentOpacity}</span>%</label>
                                <input type="range" id="contentOpacityRange" min="0" max="100" value="${settings.contentOpacity}" style="width: 100%;">
                                <small style="color: #6c757d;">(0%で完全透明、100%で白が不透明)</small>
                            </div>
                        </fieldset>

                        <fieldset style="border: 1px solid #ccc; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
                             <legend style="font-weight: bold; padding: 0 10px; width: auto; margin-left: -5px;">ウィジェット設定</legend>
                             <div style="margin-bottom: 15px;">
                                <input type="checkbox" id="showTimetableCheckbox" ${settings.showTimetable ? 'checked' : ''}>
                                <label for="showTimetableCheckbox" style="font-weight: bold; margin-left: 5px;">ダッシュボードにカスタム時間割を表示</label>
                            </div>
                        </fieldset>

                        <div style="text-align: right; margin-top: 10px;">
                            <button id="resetSettingsBtn" style="padding: 8px 15px; background-color: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px;">
                                設定をリセット
                            </button>
                        </div>
                    </div>
                    <div style="margin-top: 20px; text-align: right; flex-shrink: 0; border-top: 1px solid #eee; padding-top: 15px;">
                        <button id="saveSettingsBtn" style="padding: 10px 20px; background-color: #0077ff; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px;">
                            保存
                        </button>
                        <button id="closeSettingsModal" style="padding: 10px 20px; background-color: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">
                            閉じる
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        setupSettingsModalListeners();
    }

    // フォームに設定を反映
    function loadSettingsToForm(settings) {
        document.getElementById('headerBgColorInput').value = settings.headerBgColor;
        document.getElementById('headerTextColorInput').value = settings.headerTextColor;
        document.getElementById('headerStrokeColorInput').value = settings.headerStrokeColor;

        const info = document.getElementById('currentBackgroundInfo');
        const bgVideoRadio = document.getElementById('bg-type-video');
        const bgImageRadio = document.getElementById('bg-type-image');
        
        bgVideoRadio.checked = settings.backgroundType === 'video';
        bgImageRadio.checked = settings.backgroundType === 'image';
        
        if (settings.backgroundUrl.startsWith('blob:')) {
            info.innerHTML = `現在の背景: ローカルファイル (IndexedDB経由・永続化済み)`;
        } else {
            info.innerHTML = `現在の背景: なし (ファイルを選択してください)`;
        }

        document.getElementById('opacityRange').value = settings.opacity;
        document.getElementById('opacityValue').textContent = settings.opacity;
        document.getElementById('brightnessRange').value = settings.brightness;
        document.getElementById('brightnessValue').textContent = settings.brightness;
        
        document.getElementById('showTimetableCheckbox').checked = settings.showTimetable;
        document.getElementById('contentOpacityRange').value = settings.contentOpacity;
        document.getElementById('contentOpacityValue').textContent = settings.contentOpacity;
    }

    // 背景プレビューの適用
    function applyBackgroundPreview() {
        // フォーム要素を関数内で取得
        const opacityRange = document.getElementById('opacityRange');
        const brightnessRange = document.getElementById('brightnessRange');
        
        if (!opacityRange || !brightnessRange) return;

        const newOpacity = parseInt(opacityRange.value);
        const newBrightness = parseInt(brightnessRange.value);

        document.getElementById('opacityValue').textContent = newOpacity;
        document.getElementById('brightnessValue').textContent = newBrightness;
        
        applyBackgroundStyle({
            ...currentSettings,
            opacity: newOpacity,
            brightness: newBrightness
        });
    }

    // モーダルのイベントリスナー設定
    function setupSettingsModalListeners() {
        const modal = document.getElementById('custom-settings-modal');
        const saveBtn = document.getElementById('saveSettingsBtn');
        const closeBtn = document.getElementById('closeSettingsModal');
        const resetBtn = document.getElementById('resetSettingsBtn');
        
        // ヘッダー
        const headerBgInput = document.getElementById('headerBgColorInput');
        const headerTextInput = document.getElementById('headerTextColorInput');
        const headerStrokeInput = document.getElementById('headerStrokeColorInput');

        // 背景
        const opacityRange = document.getElementById('opacityRange');
        const brightnessRange = document.getElementById('brightnessRange');
        const contentOpacityRange = document.getElementById('contentOpacityRange');
        
        // ファイル
        const fileInput = document.getElementById('backgroundFileInput');
        const selectFileBtn = document.getElementById('selectBackgroundBtn');

        // ヘッダープレビュー
        function applyHeaderPreview() {
            applyHeaderStyles({
                ...currentSettings,
                headerBgColor: headerBgInput.value,
                headerTextColor: headerTextInput.value,
                headerStrokeColor: headerStrokeInput.value
            });
        }
        headerBgInput.addEventListener('input', applyHeaderPreview);
        headerTextInput.addEventListener('input', applyHeaderPreview);
        headerStrokeInput.addEventListener('input', applyHeaderPreview);

        // 背景プレビュー
        opacityRange.addEventListener('input', applyBackgroundPreview);
        brightnessRange.addEventListener('input', applyBackgroundPreview);

        // コンテンツ透明度プレビュー
        if (contentOpacityRange) {
             contentOpacityRange.addEventListener('input', (e) => {
                 document.getElementById('contentOpacityValue').textContent = e.target.value;
                 applyContentOpacityStyle(parseInt(e.target.value));
             });
        }
        
        // ファイルリスナー
        if (selectFileBtn) {
            selectFileBtn.addEventListener('click', () => {
                fileInput.click();
            });
        }
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                 if (e.target.files.length > 0) {
                     const file = e.target.files[0];
                     const type = file.type.startsWith('video/') ? 'video' : 'image';
                     handleFileSelection(file, type);
                     e.target.value = ''; // ファイル選択をリセット
                 }
            });
        }

        // モーダルボタンリスナー
        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                const newSettings = {
                    ...currentSettings,
                    headerBgColor: headerBgInput.value,
                    headerTextColor: headerTextInput.value,
                    headerStrokeColor: headerStrokeInput.value,
                    opacity: parseInt(opacityRange.value),
                    brightness: parseInt(brightnessRange.value),
                    showTimetable: document.getElementById('showTimetableCheckbox').checked,
                    contentOpacity: parseInt(contentOpacityRange.value)
                };
                
                await saveSettings(newSettings);
                modal.style.display = 'none';
                applyCustomFeatures(true); 
            });
        }
        if (closeBtn) {
            closeBtn.addEventListener('click', async () => {
                const settings = await getSettings(); // 保存されている設定を再読み込み
                applyHeaderStyles(settings); 
                applyBackgroundStyle(settings);
                applyContentOpacityStyle(settings.contentOpacity);
                modal.style.display = 'none';
            });
        }
        if (resetBtn) {
            resetBtn.addEventListener('click', async () => {
                if (confirm('全てのカスタム設定を初期値に戻しますか？（時間割の内容はリセットされません）')) {
                    if (currentBG_BlobUrl) {
                       URL.revokeObjectURL(currentBG_BlobUrl);
                       currentBG_BlobUrl = null;
                    }
                    try {
                        const transaction = db.transaction([STORE_NAME], 'readwrite');
                        const store = transaction.objectStore(STORE_NAME);
                        store.clear();
                    } catch (e) {
                        console.warn("Failed to clear IndexedDB:", e);
                    }

                    await saveSettings(DEFAULT_SETTINGS);
                    loadSettingsToForm(DEFAULT_SETTINGS);
                    applyCustomFeatures(true); 
                    alert('カスタム設定をリセットし、反映しました。');
                }
            });
        }
    }

    // ファイル選択時の処理
    async function handleFileSelection(file, type) {
        if (currentBG_BlobUrl) {
           URL.revokeObjectURL(currentBG_BlobUrl);
           currentBG_BlobUrl = null;
        }
        
        try {
             await saveFileToDB(file, file.type);
             
             const blobUrl = URL.createObjectURL(file);
             currentBG_BlobUrl = blobUrl;

             // グローバル設定（実行時）を更新
             currentSettings.backgroundUrl = blobUrl;
             currentSettings.backgroundType = type;
             
             // 背景スライダーの値はそのままに、背景のみプレビュー
             applyBackgroundPreview();
             
             const modal = document.getElementById('custom-settings-modal');
             if (modal && modal.style.display === 'flex') {
                 // 必要なUIだけをピンポイントで更新する
                 document.getElementById('currentBackgroundInfo').innerHTML = `**現在の背景**: ローカルファイル (IndexedDB経由・永続化済み)`;
                 document.getElementById('bg-type-video').checked = (type === 'video');
                 document.getElementById('bg-type-image').checked = (type === 'image');
             }
             alert(`背景ファイル ${file.name} をプレビュー適用しました。\n「保存」ボタンを押して永続化してください。`);
             
         } catch (e) {
             console.error("IndexedDB Save Error:", e);
             alert('エラー: ファイルの保存中に問題が発生しました。');
         }
    }


    // --- 動的スタイル適用 ---

    // ヘッダースタイルの適用
    function applyHeaderStyles(settings) {
        let headerStyle = document.getElementById('custom-header-style');
        if (!headerStyle) {
            headerStyle = document.createElement('style');
            headerStyle.id = 'custom-header-style';
            document.head.appendChild(headerStyle);
        }

        const textShadow = `
            -1px -1px 0 ${settings.headerStrokeColor}, 1px -1px 0 ${settings.headerStrokeColor},
            -1px  1px 0 ${settings.headerStrokeColor}, 1px  1px 0 ${settings.headerStrokeColor}
        `;

        headerStyle.innerHTML = `
            .navbar.fixed-top.navbar-light.bg-white, .navbar {
                background-color: ${settings.headerBgColor} !important;
                background-image: none !important;
                box-shadow: 0 2px 5px rgba(0, 0, 0, 0.4);
                border-bottom: none !important;
            }
            .navbar-brand, .navbar-nav .nav-link, #customSettingsBtn {
                color: ${settings.headerTextColor} !important;
                text-shadow: ${textShadow};
            }
            .usernavigation .btn, .usernavigation .usermenu .btn {
                color: ${settings.headerTextColor} !important;
                text-shadow: none !important;
            }
        `;
    }

    // 背景スタイルの適用
    function applyBackgroundStyle(customOverride = {}) {
        const settings = { ...currentSettings, ...customOverride };
        const video = document.getElementById('background-video');
        const imageContainer = document.getElementById('background-image-container');
        const body = document.querySelector(BODY_SELECTOR);

        if (!body || !video || !imageContainer) return;

        body.style.overflowX = 'hidden';
        const opacityValue = settings.opacity / 100;
        const brightnessValue = settings.brightness / 100;

        if (settings.backgroundType === 'video' && settings.backgroundUrl) {
            video.src = settings.backgroundUrl;
            video.style.display = 'block';
            video.style.opacity = opacityValue.toString();
            video.style.filter = `brightness(${brightnessValue})`;
            imageContainer.style.display = 'none';
            imageContainer.style.backgroundImage = 'none';
        } else if (settings.backgroundType === 'image' && settings.backgroundUrl) {
            imageContainer.style.backgroundImage = `url("${settings.backgroundUrl}")`;
            imageContainer.style.display = 'block';
            imageContainer.style.opacity = opacityValue.toString();
            imageContainer.style.filter = `brightness(${brightnessValue})`;
            video.style.display = 'none';
            video.src = '';
        } else {
            video.style.display = 'none';
            video.src = '';
            imageContainer.style.display = 'none';
            imageContainer.style.backgroundImage = 'none';
        }
    }

    // 背景要素の挿入
    function injectBackgroundElements() {
        if (!document.querySelector(BODY_SELECTOR)) return;

        // 動画要素
        if (!document.getElementById('background-video')) {
            const video = document.createElement('video');
            video.id = 'background-video';
            video.loop = true;
            video.autoplay = true;
            video.muted = true;
            video.playsInline = true;
            video.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                object-fit: cover; z-index: -100; display: none;
                transition: opacity 0.5s ease, filter 0.5s ease;
            `;
            document.body.prepend(video);
            video.oncanplaythrough = () => { video.play().catch(e => console.warn("Video autoplay blocked:", e)); };
            video.onerror = (e) => {
                if (currentSettings.backgroundUrl.startsWith('blob:') && currentSettings.backgroundType === 'video') {
                    console.error("Failed to load background VIDEO (Blob/IndexedDB).", e);
                    if(video.error) {
                        alert(`動画の読み込みに失敗。\nエラーコード: ${video.error.code}\n理由: ${video.error.message}\n\nブラウザがこの動画形式をサポートしていない可能性があります。`);
                    }
                }
            };
        }

        // 画像コンテナ要素
        if (!document.getElementById('background-image-container')) {
            const imageContainer = document.createElement('div');
            imageContainer.id = 'background-image-container';
            imageContainer.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background-size: cover; background-position: center center;
                background-repeat: no-repeat; z-index: -100; display: none;
                transition: opacity 0.5s ease, filter 0.5s ease;
            `;
            document.body.prepend(imageContainer);
        }
    }

    // コンテンツ透明度の適用
    function applyContentOpacityStyle(contentOpacity) {
        const opacityRatio = contentOpacity / 100;

        let contentStyle = document.getElementById('custom-content-style');
        if (!contentStyle) {
            contentStyle = document.createElement('style');
            contentStyle.id = 'custom-content-style';
            document.head.appendChild(contentStyle);
        }

        const widgetOpacity = Math.min(opacityRatio + 0.2, 1.0); // 時間割は少し濃く

        contentStyle.innerHTML = `
            .block, .card:not(.custom-card-style), .card-body, .card,
            #secondary-navigation d-print-none, #page-content,
            #region-main, #region-main-box, .bg-white {
                background-color: rgba(255, 255, 255, ${opacityRatio}) !important;
            }
            .card.custom-card-style {
                background-color: rgba(255, 255, 255, ${widgetOpacity}) !important;
                border: 1px solid rgba(255, 255, 255, 0.9) !important;
            }
        `;
    }

    // 時間割ウィジェットの描画
    async function renderTimetableWidget() {
        const targetRegion = document.querySelector(DASHBOARD_REGION_SELECTOR);
        let widgetContainer = document.getElementById('customTimetableWidget');

        if (!document.URL.includes('/my/') || !targetRegion) {
            if (widgetContainer) widgetContainer.remove();
            return;
        }

        if (currentSettings.showTimetable) {
            const timetable = await getTimetable();
            if (!widgetContainer) {
                widgetContainer = document.createElement('div');
                widgetContainer.id = 'customTimetableWidget';
                widgetContainer.classList.add('card', 'mb-3', 'custom-card-style');
                widgetContainer.style.cssText = 'box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2); position: relative;';
                widgetContainer.innerHTML = `
                    <div class="card-header"><h5 class="mb-0">カスタム時間割</h5></div>
                    <div class="card-body" style="padding: 0;"></div>
                `;
                targetRegion.prepend(widgetContainer);
            }

            const cardBody = widgetContainer.querySelector('.card-body');
            if (cardBody) {
                cardBody.innerHTML = generateWeeklyTimetableHtml(timetable);
                const editBtn = document.getElementById('editTimetableBtn');
                if (editBtn) {
                    editBtn.addEventListener('click', async () => {
                        let modal = document.getElementById('timetable-modal');
                        if (modal) modal.remove();
                        const latestTimetable = await getTimetable();
                        injectEditModal(latestTimetable);
                        document.getElementById('timetable-modal').style.display = 'flex';
                    });
                }
            }
        } else {
            if (widgetContainer) widgetContainer.remove();
        }
    }


    // --- 時間割機能 ---

    function createCourseDirectUrl(courseId) {
        return `https://polite.do-johodai.ac.jp/moodle/course/view.php?id=${courseId}`;
    }

    // 時間割データの取得
    async function getTimetable() {
        const data = await chrome.storage.local.get(TIMETABLE_STORAGE_KEY);
        let timetable;
        const stored = data[TIMETABLE_STORAGE_KEY];
        
        if (stored) {
            try {
                timetable = JSON.parse(stored);
            } catch (e) {
                console.error("時間割データのパースに失敗。デフォルトを使用します。", e);
                timetable = DEFAULT_TIMETABLE;
            }
        } else {
            timetable = DEFAULT_TIMETABLE;
            // デフォルトを保存
            chrome.storage.local.set({ [TIMETABLE_STORAGE_KEY]: JSON.stringify(DEFAULT_TIMETABLE) });
        }
        return timetable;
    }

    // 時間割データの保存
    async function saveTimetable(timetable) {
        await chrome.storage.local.set({ [TIMETABLE_STORAGE_KEY]: JSON.stringify(timetable) });
    }

    // 現在の授業時間を判定
    function getCurrentClassPeriod(timetable) {
        const now = new Date();
        const dayOfWeekName = DAY_MAP[now.getDay()];
        const currentTime = now.getHours() * 100 + now.getMinutes();

        for (const period of CLASS_TIMES) {
            if (currentTime >= period.start && currentTime <= period.end) {
                const periodNumber = period.period.toString();
                if (timetable[dayOfWeekName] && timetable[dayOfWeekName][periodNumber]) {
                    return { periodNumber, status: '授業中', course: timetable[dayOfWeekName][periodNumber] };
                }
                return { periodNumber, status: '空きコマ' };
            }
        }
        if (CLASS_TIMES.some(p => currentTime > p.start && currentTime < p.end)) {
            return { periodNumber: null, status: '休み時間' };
        }
        return { periodNumber: null, status: '授業なし' };
    }

    // 週間時間割HTMLの生成
    function generateWeeklyTimetableHtml(timetable) {
        const today = new Date();
        const currentDayName = DAY_MAP[today.getDay()];
        const { periodNumber: currentPeriod, status: currentStatus, course: currentCourse } = getCurrentClassPeriod(timetable);

        let htmlContent = `
            <div style="padding: 15px;">
                <h4 style="margin-top: 0; display: flex; justify-content: space-between; align-items: center;">
                    週間時間割
                    <button id="editTimetableBtn" style="font-size: 0.7em; padding: 5px 10px; border: 1px solid #ccc; background-color: #f8f9fa; cursor: pointer; border-radius: 4px;">編集</button>
                </h4>
                <div style="font-size: 1.1em; font-weight: bold; margin-bottom: 10px;">
                    現在:
                    ${currentStatus === '授業中' ?
                        `<span style="color: #dc3545;">${currentPeriod}講時 - ${currentCourse.name}</span> <a href="${createCourseDirectUrl(currentCourse.id)}" target="_self" style="font-size: 0.8em; margin-left: 10px;">[コースへ]</a>` :
                        `<span style="color: #6c757d;">${currentStatus} ${currentPeriod ? `(${currentPeriod}講時)` : ''}</span>`
                    }
                </div>
                <hr style="margin: 5px 0 15px 0;">
                <table id="customTimetableTable" style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.95em;">
                    <thead>
                        <tr>
                            <th style="padding: 8px; border-bottom: 2px solid #ccc;">時間</th>
                            ${DAY_MAP.slice(1, 6).map(day =>
                                `<th style="padding: 8px; border-bottom: 1px solid #ccc; ${day === currentDayName ? 'color: #dc3545;' : ''}">${day}</th>`
                            ).join('')}
                        </tr>
                    </thead>
                    <tbody>
        `;

        for (const periodTime of CLASS_TIMES) {
            const period = periodTime.period.toString();
            const timeStr = `${Math.floor(periodTime.start / 100)}:${(periodTime.start % 100).toString().padStart(2, '0')}〜`;
            htmlContent += `<tr><td style="padding: 8px; border-bottom: 1px solid #eee;">${period} (${timeStr})</td>`;

            for (let i = 1; i <= 5; i++) {
                const dayName = DAY_MAP[i];
                const course = timetable[dayName] ? timetable[dayName][period] : null;
                const isCurrent = dayName === currentDayName && period === currentPeriod;
                const cellStyle = isCurrent ? 'background-color: rgba(14, 114, 181, 0.1); font-weight: bold; border-bottom: 3px solid #eee;' : 'border-bottom: 1px solid #eee;';

                htmlContent += `<td style="padding: 8px; ${cellStyle}">`;
                if (course) {
                    htmlContent += `<a href="${createCourseDirectUrl(course.id)}" target="_self" style="color: #007bff; text-decoration: none;">${course.name}</a>`;
                } else {
                    htmlContent += `<span style="color: #6c757d;">-</span>`;
                }
                htmlContent += `</td>`;
            }
            htmlContent += `</tr>`;
        }
        htmlContent += `
                    </tbody>
                </table>
                <p style="font-size: 0.8em; color: #999; margin-top: 20px;">※コース名をクリックすると直接コースページへ移動します。</p>
            </div>
        `;
        return htmlContent;
    }

    // 編集モーダルHTMLの生成
    function generateEditModalHtml(timetable) {
        const days = DAY_MAP.slice(1, 6);
        const periods = CLASS_TIMES.map(t => t.period.toString());
        let bodyHtml = `
            <p style="margin-bottom: 15px;">科目名とMoodleのコースIDを入力してください。（IDはURL <code>...id=XXX</code> のXXX部分です）</p>
            <div id="timetable-edit-grid" style="display: grid; grid-template-columns: 80px repeat(5, 1fr); gap: 10px; font-size: 0.9em;">
                <div style="font-weight: bold;">時間</div>
                ${days.map(day => `<div style="font-weight: bold; text-align: center;">${day}</div>`).join('')}
        `;

        for (const period of periods) {
            const periodTime = CLASS_TIMES.find(t => t.period.toString() === period);
            const timeStr = periodTime ? `${Math.floor(periodTime.start / 100)}:${(periodTime.start % 100).toString().padStart(2, '0')}` : '';
            bodyHtml += `<div style="font-weight: bold; line-height: 1.2;">${period}講時<br>(${timeStr})</div>`;

            for (const day of days) {
                const course = timetable[day] ? timetable[day][period] : null;
                bodyHtml += `
                    <div>
                        <input type="text" id="name-${day}-${period}" placeholder="科目名" value="${course ? course.name : ''}" style="width: 100%; margin-bottom: 5px; padding: 4px;">
                        <input type="number" id="id-${day}-${period}" placeholder="コースID" value="${course ? course.id : ''}" style="width: 100%; padding: 4px;">
                    </div>
                `;
            }
        }
        bodyHtml += `</div>`;

        return `
            <div id="timetable-modal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.7); z-index: 10000; display: none; justify-content: center; align-items: center;">
                <div id="timetable-modal-content" style="background-color: white; padding: 30px; border-radius: 8px; width: 95%; max-width: 900px; max-height: 90%; box-shadow: 0 5px 15px rgba(0,0,0,0.5); position: relative; display: flex; flex-direction: column;">
                    <h4 style="margin-top: 0; margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 10px;">
                        時間割編集
                    </h4>
                    <div style="overflow-y: auto; flex-grow: 1;">
                        ${bodyHtml}
                    </div>
                    <div style="margin-top: 20px; text-align: right; flex-shrink: 0;">
                        <button id="saveTimetableBtn" style="padding: 10px 20px; background-color: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px;">
                            保存
                        </button>
                        <button id="closeTimetableModal" style="padding: 10px 20px; background-color: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">
                            閉じる
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    // 時間割の保存と再描画
    async function saveAndRenderTimetable() {
        const days = DAY_MAP.slice(1, 6);
        const periods = CLASS_TIMES.map(t => t.period.toString());
        let newTimetable = {};

        for (const day of days) {
            newTimetable[day] = {};
            for (const period of periods) {
                const nameInput = document.getElementById(`name-${day}-${period}`);
                const idInput = document.getElementById(`id-${day}-${period}`);
                const name = nameInput ? nameInput.value.trim() : '';
                const id = idInput ? parseInt(idInput.value.trim()) : null;

                if (name && id && !isNaN(id)) {
                    newTimetable[day][period] = { name, id };
                }
            }
        }

        await saveTimetable(newTimetable);
        document.getElementById('timetable-modal').style.display = 'none';
        await renderTimetableWidget();
    }

    // 編集モーダルの挿入
    function injectEditModal(timetable) {
        if (document.getElementById('timetable-modal')) return;
        const modalHtml = generateEditModalHtml(timetable);
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modal = document.getElementById('timetable-modal');
        document.getElementById('saveTimetableBtn').addEventListener('click', saveAndRenderTimetable);
        document.getElementById('closeTimetableModal').addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }

    // 期限ハイライトの適用
    function applyDeadlineHighlight() {
        if (!document.URL.includes('/my/')) return;
        const timelineBlock = document.querySelector('.block_timeline');
        if (!timelineBlock) return;

        const dateGroups = timelineBlock.querySelectorAll('[data-region="event-list-content-date"]');
        const MS_PER_DAY = 24 * 60 * 60 * 1000;
        const HIGHLIGHT_DAYS = 7;
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const limitDate = new Date(now.getTime() + HIGHLIGHT_DAYS * MS_PER_DAY);

        dateGroups.forEach(dateGroup => {
            const dateTimestampSeconds = parseInt(dateGroup.getAttribute('data-timestamp'));
            const deadlineDate = new Date(dateTimestampSeconds * 1000);

            if (deadlineDate >= now && deadlineDate < limitDate) {
                const eventList = dateGroup.nextElementSibling;
                if (eventList) {
                    const deadlineItems = eventList.querySelectorAll('[data-region="event-list-item"]');
                    deadlineItems.forEach(item => {
                        const infoText = item.querySelector('.timeline-name small.mb-0')?.textContent || '';
                        const isDue = infoText.includes('due') || infoText.includes('closes') ||
                                     infoText.includes('提出期限') || infoText.includes('終了');
                        if (isDue) {
                            item.classList.add('deadline-highlight');
                        }
                    });
                }
            }
        });
    }

    // --- 固定スタイル ---

    const style = document.createElement('style');
    style.innerHTML = `
        /* ヘッダーの透明化 */
        #page-header, .page-context-header, #page {
            background-color: transparent !important;
            border-bottom: none !important;
        }

        /* ヘッダーのドロップダウンなど */
        .navbar-nav .nav-item .nav-link:hover,
        .navbar-nav .nav-item.open > .nav-link {
            background-color: rgba(0, 0, 0, 0.3) !important;
            border-radius: 4px;
        }
        .navbar-nav .nav-item.dropdown .dropdown-menu {
            background-color: #ffffff !important;
            box-shadow: 0 5px 10px rgba(0,0,0,0.2);
        }
        .navbar-nav .nav-item.dropdown .dropdown-menu a.dropdown-item {
            color: #000000 !important;
            text-shadow: none !important;
        }
        .page-context-header .page-header-headings h1,
        .page-context-header a {
            color: #000000 !important;
        }
        #usernavigation .usermenu {
             display: flex;
             align-items: center;
        }
        #customSettingsBtn {
             margin-right: 5px;
        }

        /* 背景とコンテンツ */
        ${BODY_SELECTOR} {
            background-color: #f0f2f5 !important;
            overflow-x: hidden !important;
        }
        #background-video, #background-image-container {
             transition: opacity 0.5s ease, filter 0.5s ease;
        }
        #page, ${PAGE_WRAPPER_SELECTOR} {
            background-color: transparent !important;
            z-index: 1;
            position: relative;
        }
        .main-inner, .secondary-navigation d-print-none, .moremenu navigation observed, .nav more-nav nav-tabs, .card-footer border-0 bg-white w-100 {
            background-color:  rgba(255, 255, 255, 0.6) !important;
        }
        :is(#secondary-navigation d-print-none, #page-content, #region-main, #region-main-box, .block) {
            background-color: transparent !important;
            z-index: 1;
            position: relative;
        }
        .section {
             border-bottom: 2px solid rgba(255, 255, 255, 0.4) !important;
             margin-bottom: 10px !important;
        }
        .card-footer, .bg-white, .form-control, .page-item, .pagination mb-0, .pagination, .secondary-navigation, .secondary-navigation, .card-foote {
            background-color: transparent !important;
        }
        :is(nav, .primary-navigation, .secondary-navigation, .nav, .nav-tabs, .moremenu, .course-section-header, .section-item) {
            background-color: transparent !important;
        }
        .block * { color: #000000; }
        .block a, .card a { color: #0d6efd; }

        /* その他 */
        .deadline-highlight {
            border: 1px solid #ff4d4d !important;
            background-color: rgba(255, 240, 240, 0.3) !important;
            box-shadow: 0 0 8px rgba(255, 0, 0, 0.5) !important;
        }
        .block, .card:not(.custom-card-style) {
            border: 0px solid rgba(255, 255, 255, 0.8) !important;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
            transition: box-shadow 0.3s ease-in-out, background-color 0.3s ease;
            z-index: 1;
            position: relative;
        }
        .card.custom-card-style {
            border: 1px solid rgba(255, 255, 255, 0.9) !important;
        }
        #customTimetableTable th {
             border-bottom-color: #aaa !important;
             border-bottom-width: 2px !important;
             border-left: 2px solid #ccc !important;
        }
        #customTimetableTable td {
             border-bottom-color: #f0f0f0 !important;
             border-bottom-width: 2px !important;
             border-left: 2px solid #f0f0f0 !important;
        }
        .section {
             border-bottom: 2px solid rgba(255, 255, 255, 0.4) !important;
             margin-bottom: 1px !important;
        }
        .section-item {
            border: none !important;
        }
    `;
    document.head.appendChild(style);


    // --- 実行 ---
    
    // 全カスタム機能の適用・更新
    async function applyCustomFeatures(reloadSettings = true) {
        if(reloadSettings) { 
            await getSettings();
        }
        const settings = currentSettings;
        
        injectBackgroundElements(); 
        applyHeaderStyles(settings); 
        applyBackgroundStyle(settings);
        applyContentOpacityStyle(settings.contentOpacity);
        await renderTimetableWidget();
    }

    // メイン処理
    async function initializeExtension() {
         await setupIndexedDB(); // DBを最初に初期化
         const settings = await getSettings(); // 設定を読み込む
         
         // UI（モーダル等）を挿入
         injectSettingsButton();
         injectSettingsModal(settings);
         const timetable = await getTimetable();
         injectEditModal(timetable);

         // 全てのスタイルと機能を適用
         applyCustomFeatures(false); 

         // 期限ハイライト（遅延実行）
         setTimeout(applyDeadlineHighlight, 1500);
    }

    // スクリプト起動
    initializeExtension();

})();