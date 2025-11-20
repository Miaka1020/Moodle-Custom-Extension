(function() {
    'use strict';

    // IndexedDB
    const DB_NAME = 'MoodleCustomBGDB';
    const DB_VERSION = 2;
    const STORE_NAME = 'background_files';
    const DB_KEY_BG = 'current_bg';

    // ストレージキー
    const SETTINGS_STORAGE_KEY = 'moodle_custom_settings_v5';
    const TIMETABLE_STORAGE_KEY = 'moodle_custom_timetable_v2';
    const FONT_CACHE_KEY = 'moodle_fast_font_cache_v2'; 

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
        contentOpacity: 70,
        fontFamily: "default", 
        customFontName: "",
        customFontUrl: "" 
    };

    // 時間割
    const DEFAULT_TIMETABLE = {
        "月": {}, "火": {}, "水": {}, "木": {}, "金": {}, "土": {}, "日": {}
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
    let quizAnswerStore = new Map();
    let isRetakeMode = false;
    let retakeStartTime = null;
    let timelineDeadlines = []; 
    let countdownTimerInterval = null;
    let timelinePoller = null; 
    let pollAttempts = 0; 
    const MAX_POLL_ATTEMPTS = 60;

    try {
        const cachedFontJson = localStorage.getItem(FONT_CACHE_KEY);
        if (cachedFontJson) {
            const cachedSettings = JSON.parse(cachedFontJson);
            applyFontStyle(cachedSettings); 
        }
    } catch (e) {
        console.warn("Fast font apply failed:", e);
    }


    // --- メイン処理 (Initialization) ---
    async function init() {
        injectStaticStyles();
        await setupIndexedDB();
        
        const settings = await getSettings();
        
        // 初回キャッシュ作成
        if (!localStorage.getItem(FONT_CACHE_KEY)) {
            saveFontCache(settings);
        }

        if (document.body) {
            startUIInjection(settings);
        } else {
            document.addEventListener('DOMContentLoaded', () => startUIInjection(settings));
        }
    }
    
    async function startUIInjection(settings) {
        injectGithubButton(); 
        injectSettingsButton();
        injectSettingsModal(settings);
        
        const timetable = await getTimetable(); 
        injectEditModal(timetable);

        await applyAllCustomStyles(false); 

        if (document.URL.includes('/my/')) {
            startTimelinePoller();
        }
        
        if (document.URL.includes('/mod/quiz/review.php')) {
            initQuizRetakeFeature();
        }
    }


    // --- IndexedDB ---
    function setupIndexedDB() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) {
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
                reject(event.target.errorCode);
            };
        });
    }

    function saveFileToDB(blob, mimeType) {
        return new Promise((resolve, reject) => {
            if (!db) return reject('DB not initialized');
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const data = { id: DB_KEY_BG, blob: blob, type: mimeType };
            const request = store.put(data); 
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e);
        });
    }

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

    // --- 設定 (Storage) ---
    async function getSettings() {
        const data = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
        let settings;
        const stored = data[SETTINGS_STORAGE_KEY];

        if (stored) {
            try {
                settings = JSON.parse(stored);
            } catch (e) {
                settings = DEFAULT_SETTINGS;
            }
        } else {
            settings = DEFAULT_SETTINGS;
        }

        currentSettings = { ...DEFAULT_SETTINGS, ...settings };

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
                currentSettings.backgroundUrl = '';
                currentSettings.backgroundType = 'none';
            }
        } else if (currentSettings.backgroundUrl !== '' && !currentSettings.backgroundUrl.startsWith('blob:')) {
            currentSettings.backgroundUrl = '';
            currentSettings.backgroundType = 'none';
        }
        
        return currentSettings;
    }

    // フォントキャッシュ保存用ヘルパー
    function saveFontCache(settings) {
        try {
            localStorage.setItem(FONT_CACHE_KEY, JSON.stringify({
                fontFamily: settings.fontFamily,
                customFontName: settings.customFontName,
                customFontUrl: settings.customFontUrl
            }));
        } catch (e) { console.warn("Failed to update font cache", e); }
    }

    async function saveSettings(settings) {
        if (currentBG_BlobUrl && currentBG_BlobUrl !== settings.backgroundUrl) {
            URL.revokeObjectURL(currentBG_BlobUrl);
            currentBG_BlobUrl = null;
        }

        saveFontCache(settings);

        let settingsToSave = { ...settings };
        if (settingsToSave.backgroundUrl.startsWith('blob:')) {
            settingsToSave.backgroundUrl = 'indexeddb';
        } else if (settingsToSave.backgroundUrl !== 'indexeddb') {
            settingsToSave.backgroundUrl = '';
            settingsToSave.backgroundType = 'none';
        }

        await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: JSON.stringify(settingsToSave) });
        currentSettings = settings; 
    }


    // --- UI挿入・イベント (Settings Modal) ---

    function injectGithubButton() {
        const usermenu = document.querySelector('#usernavigation .usermenu');
        if (!usermenu || document.getElementById('custom-github-nav-item')) return;

        const githubItem = document.createElement('li');
        githubItem.classList.add('nav-item');
        githubItem.id = 'custom-github-nav-item';
        githubItem.style.cssText = "display: flex; align-items: center;";

        githubItem.innerHTML = `
          <button id="githubLinkBtnV2" class="github-btn-mangesh636" title="GitHubリポジトリを開く" style="margin-right: 5px;">
            <svg viewBox="0 0 24 24" fill="currentColor" height="20" width="20" xmlns="http://www.w3.org/2000/svg">
              <path d="M12.001 2C6.47598 2 2.00098 6.475 2.00098 12C2.00098 16.425 4.86348 20.1625 8.83848 21.4875C9.33848 21.575 9.52598 21.275 9.52598 21.0125C9.52598 20.775 9.51348 19.9875 9.51348 19.15C7.00098 19.6125 6.35098 18.5375 6.15098 17.975C6.03848 17.6875 5.55098 16.8 5.12598 16.5625C4.77598 16.375 4.27598 15.9125 5.11348 15.9C5.90098 15.8875 6.46348 16.625 6.65098 16.925C7.55098 18.4375 8.98848 18.0125 9.56348 17.75C9.65098 17.1 9.91348 16.6625 10.201 16.4125C7.97598 16.1625 5.65098 15.3 5.65098 11.475C5.65098 10.3875 6.03848 9.4875 6.67598 8.7875C6.57598 8.5375 6.22598 7.5125 6.77598 6.1375C6.77598 6.1375 7.61348 5.875 9.52598 7.1625C10.326 6.9375 11.176 6.825 12.026 6.825C12.876 6.825 13.726 6.9375 14.526 7.1625C16.4385 5.8625 17.276 6.1375 17.276 6.1375C17.826 7.5125 17.476 8.5375 17.376 8.7875C18.0135 9.4875 18.401 10.375 18.401 11.475C18.401 15.3125 16.0635 16.1625 13.8385 16.4125C14.201 16.725 14.5135 17.325 14.5135 18.2625C14.5135 19.6 14.501 20.675 14.501 21.0125C14.501 21.275 14.6885 21.5875 15.1885 21.4875C19.259 20.1133 21.9999 16.2963 22.001 12C22.001 6.475 17.526 2 12.001 2Z"></path>
            </svg>
            <span>GitHub</span>
          </button>
        `;
        
        usermenu.prepend(githubItem); 

        document.getElementById('githubLinkBtnV2').addEventListener('click', () => {
            window.open('https://github.com/Miaka1020/Moodle-Custom-Extension/', '_blank');
        });
    }

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

   function injectSettingsModal(settings) {
        injectModernModalStyles();

        const modalHtml = `
            <div id="custom-settings-modal" class="modern-modal-overlay">
                <div id="custom-settings-content" class="modern-modal-content">
                    <div class="modern-modal-header">
                        <h4>Moodle Customizer</h4>
                        <p class="sub-text">Personalize your learning environment</p>
                    </div>
                    
                    <div class="modern-modal-body">
                        <div class="settings-group">
                            <div class="group-title">Header Style</div>
                            <div class="color-picker-grid">
                                <div class="color-item">
                                    <label>背景色</label>
                                    <div class="color-wrapper"><input type="color" id="headerBgColorInput" value="${settings.headerBgColor}"></div>
                                </div>
                                <div class="color-item">
                                    <label>文字色</label>
                                    <div class="color-wrapper"><input type="color" id="headerTextColorInput" value="${settings.headerTextColor}"></div>
                                </div>
                                <div class="color-item">
                                    <label>枠線色</label>
                                    <div class="color-wrapper"><input type="color" id="headerStrokeColorInput" value="${settings.headerStrokeColor}"></div>
                                </div>
                            </div>
                        </div>

                        <div class="settings-group">
                            <div class="group-title">Background Media</div>
                            <input type="file" id="backgroundFileInput" accept="image/*,video/*" style="display: none;">
                            <button id="selectBackgroundBtn" class="modern-btn primary-btn full-width"><i class="fa fa-folder-open"></i> ファイルを選択 (Image/Video)</button>
                            <p id="currentBackgroundInfo" class="status-text"></p>
                            
                            <div class="radio-group" style="display:flex; justify-content:center; gap:20px; margin-bottom:10px;">
                                <label class="radio-label" style="color:#ccc;">
                                    <input type="radio" id="bg-type-video" name="bg-type" value="video" ${settings.backgroundType === 'video' ? 'checked' : ''} disabled> 動画
                                </label>
                                <label class="radio-label" style="color:#ccc;">
                                    <input type="radio" id="bg-type-image" name="bg-type" value="image" ${settings.backgroundType === 'image' ? 'checked' : ''} disabled> 画像
                                </label>
                            </div>

                            <div class="slider-container">
                                <div class="slider-label">
                                    <span>透明度</span>
                                    <div class="slider-value-group">
                                        <span id="opacityValue">${settings.opacity}</span>%
                                    </div>
                                </div>
                                <input type="range" id="opacityRange" min="0" max="100" value="${settings.opacity}" class="modern-range">
                            </div>
                            <div class="slider-container">
                                <div class="slider-label">
                                    <span>明度</span>
                                    <div class="slider-value-group">
                                        <span id="brightnessValue">${settings.brightness}</span>%
                                    </div>
                                </div>
                                <input type="range" id="brightnessRange" min="0" max="200" value="${settings.brightness}" class="modern-range">
                            </div>
                        </div>
                        
                        <div class="settings-group">
                            <div class="group-title">Typography</div>
                            <div class="input-wrapper">
                                <label>プリセットフォント</label>
                                <select id="fontFamilySelect" class="modern-select">
                                    <option value="default">Moodle標準 (Default)</option>
                                    <option disabled>--- System Fonts ---</option>
                                    <option value="meiryo">メイリオ</option>
                                    <option value="yugothic">游ゴシック</option>
                                    <option value="biz-gothic">BIZ UDPゴシック</option>
                                    <option disabled>--- Google Web Fonts ---</option>
                                    <option value="notosans">Noto Sans JP</option>
                                    <option value="zenmaru">Zen 丸ゴシック</option>
                                    <option value="sawarabi">さわらび明朝</option>
                                    <option value="mochiy">Mochiy Pop One</option>
                                    <option value="dotgothic">DotGothic16</option>
                                    <option value="rampart">Rampart One</option>
                                </select>
                            </div>
                            <div class="input-wrapper">
                                <label>カスタムフォント名</label>
                                <input type="text" id="customFontNameInput" class="modern-input" placeholder="例: Impact" value="${settings.customFontName || ''}">
                            </div>
                            <div class="input-wrapper">
                                <label>WebフォントURL</label>
                                <input type="text" id="customFontUrlInput" class="modern-input" placeholder="例: https://fonts.googleapis.com/..." value="${settings.customFontUrl || ''}">
                            </div>
                        </div>

                        <div class="settings-group">
                            <div class="group-title">Content Area</div>
                            <div class="slider-container">
                                <div class="slider-label">
                                    <span>ブロック透明度</span>
                                    <div class="slider-value-group">
                                        <span id="contentOpacityValue">${settings.contentOpacity}</span>%
                                    </div>
                                </div>
                                <input type="range" id="contentOpacityRange" min="0" max="100" value="${settings.contentOpacity}" class="modern-range">
                            </div>
                        </div>

                        <div class="settings-group">
                            <div class="group-title">Widgets</div>
                            <label class="toggle-switch">
                                <input type="checkbox" id="showTimetableCheckbox" ${settings.showTimetable ? 'checked' : ''}>
                                <span class="slider"></span>
                                <span class="label-text">ダッシュボードに時間割を表示</span>
                            </label>
                        </div>
                        
                        <div style="text-align: right; margin-top: 10px;">
                            <button id="resetSettingsBtn" class="modern-text-btn danger"><i class="fa fa-trash"></i> 設定を初期化</button>
                        </div>
                    </div>

                    <div class="modern-modal-footer">
                        <button id="closeSettingsModal" class="modern-btn secondary-btn">閉じる</button>
                        <button id="saveSettingsBtn" class="modern-btn primary-btn glow">保存して適用</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        bindSettingsModalEvents();
    }

    // --- モダンデザイン用CSS注入 (修正版: 右寄せ強制・ブルーテーマ) ---
    function injectModernModalStyles() {
        const existingStyle = document.getElementById('modern-modal-css');
        if (existingStyle) existingStyle.remove();

        const style = document.createElement('style');
        style.id = 'modern-modal-css';
        style.innerHTML = `
            /* オーバーレイ */
            .modern-modal-overlay {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background-color: rgba(0, 0, 0, 0.85);
                z-index: 10001; display: none;
                justify-content: center; align-items: center;
                animation: fadeIn 0.2s ease;
            }

            /* モーダル本体 */
            .modern-modal-content {
                background: #1a1b20;
                color: #e0e0e0;
                border-radius: 12px;
                width: 95%; max-width: 550px; max-height: 85vh;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8);
                border: 1px solid rgba(0, 119, 255, 0.3);
                display: flex; flex-direction: column;
                font-family: 'Segoe UI', sans-serif;
                overflow: hidden;
            }

            /* ヘッダー */
            .modern-modal-header {
                padding: 15px 25px;
                background: linear-gradient(90deg, rgba(0, 60, 150, 0.2) 0%, transparent 100%);
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            }
            .modern-modal-header h4 {
                margin: 0; font-size: 1.5rem; font-weight: 700;
                background: linear-gradient(90deg, #fff, #00d2ff);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            .sub-text { margin: 5px 0 0; font-size: 0.85rem; color: #8bb9d6; }

            /* ボディ */
            .modern-modal-body {
                padding: 25px; overflow-y: auto;
                scrollbar-width: thin; scrollbar-color: #0056b3 transparent;
            }
            .modern-modal-body::-webkit-scrollbar { width: 8px; }
            .modern-modal-body::-webkit-scrollbar-thumb { background-color: #0056b3; border-radius: 4px; }

            /* グループ */
            .settings-group {
                background: rgba(255, 255, 255, 0.02);
                border-radius: 8px; padding: 15px; margin-bottom: 15px;
                border: 1px solid rgba(255, 255, 255, 0.08);
            }
            .group-title {
                font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px;
                color: #00d2ff;
                margin-bottom: 10px; font-weight: 600;
            }

            /* 入力系 */
            .input-wrapper { margin-bottom: 15px; }
            .input-wrapper label { display: block; font-size: 0.9rem; margin-bottom: 5px; color: #ccc; }
            .modern-input, .modern-select {
                width: 100%; padding: 8px 12px; background: #0f1012;
                border: 1px solid #333; border-radius: 6px; color: #fff; transition: border-color 0.2s;
            }
            .modern-input:focus, .modern-select:focus { outline: none; border-color: #0077ff; background: #000; }
            .modern-select option { background-color: #1f2937; color: #fff; }

            /* カラーピッカー */
            .color-picker-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
            .color-item { text-align: center; }
            .color-item label { font-size: 0.75rem; display: block; margin-bottom: 5px; color: #aaa; }
            .color-wrapper { height: 35px; border-radius: 6px; overflow: hidden; border: 1px solid #444; cursor: pointer; }
            input[type="color"] { width: 100%; height: 100%; padding: 0; border: none; background: none; cursor: pointer; transform: scale(1.5); }

            /* ▼▼▼ ここが修正の肝：スライダーラベルのスタイル強化 ▼▼▼ */
            .slider-container { margin-top: 15px; }
            
            .slider-label { 
                display: flex; 
                justify-content: space-between; 
                align-items: center;
                font-size: 0.85rem; 
                color: #ddd; 
                margin-bottom: 8px; 
                width: 100%; /* 幅を確保 */
            }
            
            /* 数値と%をまとめるラッパー */
            .slider-value-group {
                display: inline-flex;
                align-items: center;
                justify-content: flex-end;
                gap: 2px; /* 数字と%の間隔 */
                font-family: monospace; /* 数字の幅を揃える */
                font-size: 1.1em; /* 少し大きく */
                color: #00d2ff; /* 青色にして強調 */
            }
            /* ▲▲▲ 修正ここまで ▲▲▲ */

            .modern-range {
                -webkit-appearance: none; width: 100%; height: 4px; background: #333; border-radius: 2px; outline: none;
            }
            .modern-range::-webkit-slider-thumb {
                -webkit-appearance: none; width: 16px; height: 16px; background: #0077ff; border-radius: 50%; cursor: pointer;
                box-shadow: 0 0 8px rgba(0, 119, 255, 0.5); transition: transform 0.1s;
            }
            .modern-range::-webkit-slider-thumb:hover { transform: scale(1.2); }

            /* フッター・ボタン */
            .modern-modal-footer {
                padding: 15px 25px; background: rgba(0,0,0,0.3); border-top: 1px solid rgba(255,255,255,0.05);
                display: flex; justify-content: flex-end; gap: 10px;
            }
            .modern-btn { padding: 8px 20px; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 0.9rem; }
            .primary-btn { background: linear-gradient(135deg, #0062ff 0%, #00b7ff 100%); color: white; }
            .primary-btn:hover { filter: brightness(1.1); }
            .secondary-btn { background: #333; color: #ccc; }
            .secondary-btn:hover { background: #444; color: #fff; }
            .full-width { width: 100%; margin-bottom: 10px; text-align: center; }
            .modern-text-btn { background: none; border: none; cursor: pointer; font-size: 0.85rem; padding: 5px; border-radius: 4px; }
            .modern-text-btn.danger { color: #ff4d4d; }
            
            .status-text { font-size: 0.8rem; color: #aaa; margin-bottom: 15px; text-align: center; }

            /* トグル */
            .toggle-switch { display: flex; align-items: center; cursor: pointer; user-select: none; }
            .toggle-switch input { display: none; }
            .toggle-switch .slider { width: 36px; height: 20px; background-color: #444; border-radius: 20px; position: relative; margin-right: 10px; }
            .toggle-switch .slider:before { content: ""; position: absolute; height: 14px; width: 14px; left: 3px; bottom: 3px; background-color: white; border-radius: 50%; transition: .2s; }
            .toggle-switch input:checked + .slider { background-color: #0077ff; }
            .toggle-switch input:checked + .slider:before { transform: translateX(16px); }
            .toggle-switch .label-text { color: #ddd; font-size: 0.9rem; }

            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        `;
        document.head.appendChild(style);
    }

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

        // フォント設定
        document.getElementById('fontFamilySelect').value = settings.fontFamily || 'default';
        document.getElementById('customFontNameInput').value = settings.customFontName || '';
        document.getElementById('customFontUrlInput').value = settings.customFontUrl || ''; // URLもロード
    }

    // 背景プレビューの適用
    function applyBackgroundPreview() {
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
    function bindSettingsModalEvents() {
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
        
        // フォント
        const fontSelect = document.getElementById('fontFamilySelect');
        const customFontInput = document.getElementById('customFontNameInput');
        const customFontUrlInput = document.getElementById('customFontUrlInput');
        
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
        
        // フォントプレビュー
        function applyFontPreview() {
            applyFontStyle({
                ...currentSettings,
                fontFamily: fontSelect.value,
                customFontName: customFontInput.value,
                customFontUrl: customFontUrlInput.value
            });
        }
        if (fontSelect) fontSelect.addEventListener('change', applyFontPreview);
        if (customFontInput) customFontInput.addEventListener('input', applyFontPreview);
        if (customFontUrlInput) customFontUrlInput.addEventListener('input', applyFontPreview);

        
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
                    contentOpacity: parseInt(contentOpacityRange.value),
                    
                    // フォント設定保存
                    fontFamily: document.getElementById('fontFamilySelect').value,
                    customFontName: document.getElementById('customFontNameInput').value,
                    customFontUrl: document.getElementById('customFontUrlInput').value
                };
                
                await saveSettings(newSettings);
                modal.style.display = 'none';
                applyAllCustomStyles(true); 
            });
        }
        if (closeBtn) {
            closeBtn.addEventListener('click', async () => {
                const settings = await getSettings(); // 保存されている設定を再読み込み
                applyHeaderStyles(settings); 
                applyBackgroundStyle(settings);
                applyContentOpacityStyle(settings.contentOpacity);
                applyFontStyle(settings); // フォントも元に戻す
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
                        localStorage.removeItem(FONT_CACHE_KEY);
                        
                        if (db) {
                            const transaction = db.transaction([STORE_NAME], 'readwrite');
                            const store = transaction.objectStore(STORE_NAME);
                            store.clear();
                        } else {
                            await setupIndexedDB();
                            if(db) {
                                const transaction = db.transaction([STORE_NAME], 'readwrite');
                                const store = transaction.objectStore(STORE_NAME);
                                store.clear();
                            }
                        }
                    } catch (e) {
                        console.warn("Failed to clear IndexedDB:", e);
                    }

                    await saveSettings(DEFAULT_SETTINGS);
                    loadSettingsToForm(DEFAULT_SETTINGS);
                    applyAllCustomStyles(true); 
                    alert('カスタム設定をリセットし、反映しました。');
                }
            });
        }
    }

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
                 document.getElementById('currentBackgroundInfo').innerHTML = `<b>現在の背景</b>: ローカルファイル (IndexedDB経由・永続化済み)`;
                 document.getElementById('bg-type-video').checked = (type === 'video');
                 document.getElementById('bg-type-image').checked = (type === 'image');
             }
             alert(`背景ファイル ${file.name} をプレビュー適用しました。\n「保存」ボタンを押して永続化してください。`);
             
         } catch (e) {
             console.error("IndexedDB Save Error:", e);
             alert('エラー: ファイルの保存中に問題が発生しました。');
         }
    }


    // --- 動的スタイル適用 (Dynamic Styles) ---

    async function applyAllCustomStyles(reloadSettings = true) {
        if(reloadSettings) { 
            await getSettings();
        }

        const settings = currentSettings;
        
        // フォント適用
        applyFontStyle(settings);

        injectBackgroundElements(); 
        applyHeaderStyles(settings); 
        applyBackgroundStyle(settings);
        applyContentOpacityStyle(settings.contentOpacity);
        await renderTimetableWidget(); 
    }

   // --- 機能: フォント適用関数 ---
    function applyFontStyle(settings) {
        let fontStyle = document.getElementById('custom-font-style');
        if (!fontStyle) {
            fontStyle = document.createElement('style');
            fontStyle.id = 'custom-font-style';
            (document.head || document.documentElement).appendChild(fontStyle);
        }

        // フォント定義マップ
        const fontMap = {
            "default": { name: "", url: "" }, 
            "meiryo": { name: '"Meiryo", "メイリオ", "Hiragino Kaku Gothic ProN", sans-serif', url: "" },
            "yugothic": { name: '"Yu Gothic", "游ゴシック", "YuGothic", sans-serif', url: "" },
            "biz-gothic": { name: '"BIZ UDPGothic", "BIZ UDPゴシック", sans-serif', url: "" },
            "notosans": { name: '"Noto Sans JP", sans-serif', url: "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap" },
            "zenmaru": { name: '"Zen Maru Gothic", sans-serif', url: "https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@500;700&display=swap" },
            "sawarabi": { name: '"Sawarabi Mincho", serif', url: "https://fonts.googleapis.com/css2?family=Sawarabi+Mincho&display=swap" },
            "dotgothic": { name: '"DotGothic16", sans-serif', url: "https://fonts.googleapis.com/css2?family=DotGothic16&display=swap" },
            "mochiy": { name: '"Mochiy Pop One", sans-serif', url: "https://fonts.googleapis.com/css2?family=Mochiy+Pop+One&display=swap" },
            "rampart": { name: '"Rampart One", cursive', url: "https://fonts.googleapis.com/css2?family=Rampart+One&display=swap" },
            "antique": { name: '"Zen Antique Soft", sans-serif', url: "https://fonts.googleapis.com/css2?family=Kiwi+Maru&family=Monomaniac+One&family=RocknRoll+One&family=Zen+Antique+Soft&display=swap" },
            "RocknRoll": { name: '"RocknRoll One", sans-serif', url: "https://fonts.googleapis.com/css2?family=Kiwi+Maru&family=Monomaniac+One&family=RocknRoll+One&family=Zen+Antique+Soft&display=swap" }
        };

        let selectedFontFamily = "";
        let importUrl = "";

        // 1. カスタム入力があれば最優先
        if (settings.customFontName && settings.customFontName.trim() !== "") {
            selectedFontFamily = `"${settings.customFontName}", sans-serif`;
            if (settings.customFontUrl && settings.customFontUrl.trim() !== "") {
                importUrl = settings.customFontUrl;
            }
        } 
        // 2. プリセット選択
        else if (fontMap[settings.fontFamily]) {
            selectedFontFamily = fontMap[settings.fontFamily].name;
            importUrl = fontMap[settings.fontFamily].url;
        }

        let cssContent = "";

        // ▼▼▼ 変更点1: フォントがある場合のみ、全体のフォントCSSを追加 ▼▼▼
        // (以前はここで return していたため、下のバッジ用CSSが適用されなかった)
        if (selectedFontFamily) {
            if (importUrl) {
                cssContent += `@import url('${importUrl}');\n`;
            }
            cssContent += `
                body, div, p, span, a, li, td, th, h1, h2, h3, h4, h5, h6, button, input, textarea, select, .block, .card {
                    font-family: ${selectedFontFamily} !important;
                }
                /* アイコンフォント保護 */
                .fa, .fa-*, .icon, [class*="icon"], .fa-solid, .fa-regular, .fa-brands {
                    font-family: "FontAwesome", "Font Awesome 6 Free", "Font Awesome 6 Brands" !important;
                }
            `;
        }

        cssContent += `
           .count-container, 
            .badge, 
            .notification-count,
            [data-region="count-container"] {
                font-family: -apple-system, BlinkMacSystemFont, Roboto, Arial, sans-serif !important;
                font-weight: bold !important;
                font-size: 10px !important;
                line-height: 16px !important;     /* ここを1.2から16pxに変更（高さと合わせて垂直中央揃えを確実に） */
                letter-spacing: 0.5px !important; /* 少し文字間隔を広げてつぶれ防止 */
                text-shadow: none !important;     /* 影を消してクッキリさせる */
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                min-width: 16px !important;
                height: 16px !important;
                padding: 0 4px !important;        /* パディングを微調整 */
                border-radius: 10px !important;   /* 完全な丸みに */
                box-sizing: border-box !important;
            }

            /* 通知0件の非表示対応 */
            .count-container.hidden,
            [data-region="count-container"].hidden,
            .notification-count.hidden,
            .count-container:empty {
                display: none !important;
            }
        `;

        fontStyle.innerHTML = cssContent;
    }

    function applyHeaderStyles(settings) {
        let headerStyle = document.getElementById('custom-header-style');
        if (!headerStyle) {
            headerStyle = document.createElement('style');
            headerStyle.id = 'custom-header-style';
            (document.head || document.documentElement).appendChild(headerStyle);
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
            
            button.github-btn-mangesh636 {
                 color: ${settings.headerTextColor} !important;
                 border: 1px solid ${settings.headerTextColor} !important;
            }
            button.github-btn-mangesh636 svg {
                 fill: ${settings.headerTextColor} !important;
            }
        `;
    }

    function applyBackgroundStyle(customOverride = {}) {
        const settings = { ...currentSettings, ...customOverride };
        const video = document.getElementById('background-video');
        const imageContainer = document.getElementById('background-image-container');
        const body = document.querySelector(BODY_SELECTOR);

        if (!body) return; 

        body.style.overflowX = 'hidden';
        const opacityValue = settings.opacity / 100;
        const brightnessValue = settings.brightness / 100;

        if (video && imageContainer) {
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
    }

    function injectBackgroundElements() {
        if (!document.querySelector(BODY_SELECTOR)) return;

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
                }
            };
        }

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

    function applyContentOpacityStyle(contentOpacity) {
        const opacityRatio = contentOpacity / 100;

        let contentStyle = document.getElementById('custom-content-style');
        if (!contentStyle) {
            contentStyle = document.createElement('style');
            contentStyle.id = 'custom-content-style';
            (document.head || document.documentElement).appendChild(contentStyle);
        }

        const widgetOpacity = Math.min(opacityRatio + 0.2, 1.0); 

      contentStyle.innerHTML = `
            .block, .card:not(.custom-card-style), .card-body, .card,
            #secondary-navigation d-print-none, #page-content,
            #region-main, #region-main-box, .bg-white, .main-inner {
                background-color: rgba(255, 255, 255, ${opacityRatio}) !important;
            }
            .card.custom-card-style {
                background-color: rgba(255, 255, 255, ${widgetOpacity}) !important;
                border: 1px solid rgba(255, 255, 255, 0.9) !important;
            }
        `;
    }


    function normalizeCourseName(name) {
        if (typeof name !== 'string') return '';
        return name
            .normalize('NFKC') 
            .replace(/\s| /g, '') 
            .replace(/（.*）$|\(.*\)$/, ''); 
    }

    function formatRemainingTime(seconds) {
        if (seconds <= 0) {
            return '<span style="color: #6c757d; font-weight: bold;">[ 期限切れ ]</span>';
        }

        const d = Math.floor(seconds / (3600 * 24));
        const h = Math.floor((seconds % (3600 * 24)) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);

        let parts = [];
        let color = '#333';

        if (d > 0) {
            parts.push(`<b>${d}</b>日`);
            parts.push(`<b>${h}</b>時間`);
            parts.push(`<b>${m}</b>分`);
            if (d <= 3) color = '#E67E22'; 
        } else if (h > 0) {
            parts.push(`<b>${h}</b>時間`);
            parts.push(`<b>${m}</b>分`);
            parts.push(`<b>${s}</b>秒`);
            color = '#E67E22'; 
        } else { 
            parts.push(`<b>${m}</b>分`);
            parts.push(`<b>${s}</b>秒`);
            color = '#dc3545'; 
        }

        return `<span style="color: ${color}; font-weight: bold; font-size: 0.95em;">あと ${parts.join(' ')}</span>`;
    }
    
    function updateAllCountdownTimers() {
        const countdownElements = document.querySelectorAll('.custom-countdown-timer');
        const nowSeconds = Math.floor(Date.now() / 1000);

        if (countdownElements.length === 0 && countdownTimerInterval) {
            clearInterval(countdownTimerInterval); 
            countdownTimerInterval = null;
            return;
        }

        countdownElements.forEach(el => {
            const dueTimestamp = parseInt(el.dataset.dueTimestamp, 10);
            if (isNaN(dueTimestamp)) return;

            const remainingSeconds = dueTimestamp - nowSeconds;
            
            if (remainingSeconds > 86400 && el.innerHTML !== '') { 
                if (nowSeconds % 60 === 0) { 
                     el.innerHTML = formatRemainingTime(remainingSeconds);
                }
            } else { 
                el.innerHTML = formatRemainingTime(remainingSeconds);
            }
        });
    }
    
    function startCountdownTimers() {
        if (countdownTimerInterval) {
            clearInterval(countdownTimerInterval);
        }
        updateAllCountdownTimers();
        countdownTimerInterval = setInterval(updateAllCountdownTimers, 1000);
    }


    // --- 機能: 期限タイムラインのパース ---
    function parseTimelineDeadlines() {
        timelineDeadlines = []; 
        
        if (!document.URL.includes('/my/')) return;
        const timelineBlock = document.querySelector('.block_timeline');
        if (!timelineBlock) return;

        const dateGroups = timelineBlock.querySelectorAll('[data-region="event-list-content-date"]');
        
        const now = new Date();
        const currentYear = now.getFullYear();

        dateGroups.forEach(dateGroup => {
            const dateTimestampSeconds = parseInt(dateGroup.getAttribute('data-timestamp'));
            const baseDate = new Date(dateTimestampSeconds * 1000);
            
            const eventList = dateGroup.nextElementSibling;
            if (!eventList) return;

            const items = eventList.querySelectorAll('[data-region="event-list-item"]');
            
            items.forEach(item => {
                try {
                    const infoTextElement = item.querySelector('.event-name-container small.mb-0');
                    if (!infoTextElement) return; 

                    const infoText = infoTextElement.textContent || '';
                    
                    const isDue = infoText.includes('due') || infoText.includes('closes') ||
                                  infoText.includes('提出期限') || infoText.includes('終了');
                    
                    if (!isDue) return; 

                    const assignmentLink = item.querySelector('.event-name-container a');
                    const assignmentName = assignmentLink?.textContent.trim();
                    
                    if (!assignmentName) return; 

                    const courseNameMatch = infoText.match(/·\s*(.*)/);
                    const courseName = courseNameMatch ? courseNameMatch[1].trim() : null;

                    if (!courseName) return; 

                    const timeText = item.querySelector('.timeline-name > small.text-nowrap')?.textContent || '';
                    const timeMatch = timeText.match(/(\d{1,2}):(\d{2})/);
                    
                    let hours = 0, minutes = 0;
                    if (timeMatch) {
                        hours = parseInt(timeMatch[1]);
                        minutes = parseInt(timeMatch[2]);
                    }

                    const dueDateTime = new Date(baseDate.getTime());
                    dueDateTime.setHours(hours, minutes, 0, 0);
                    
                    if (dueDateTime.getMonth() < now.getMonth() - 6) { 
                         dueDateTime.setFullYear(currentYear + 1);
                    } else {
                         dueDateTime.setFullYear(currentYear);
                    }

                    const dueTimestamp = Math.floor(dueDateTime.getTime() / 1000);
                    const dueDateString = `${dueDateTime.getMonth() + 1}月${dueDateTime.getDate()}日 ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
                    
                    timelineDeadlines.push({
                        courseName: courseName, 
                        assignmentName: assignmentName, 
                        dueTimestamp: dueTimestamp, 
                        dueDateString: dueDateString 
                    });

                } catch (e) {
                    console.warn("Deadline parse error:", e, item);
                }
            });
        });
    }

    // --- ★★★ 新しいポーリング関数 ★★★
    function startTimelinePoller() {
        if (timelinePoller) {
            clearInterval(timelinePoller);
        }
        pollAttempts = 0;

        timelinePoller = setInterval(async () => {
            pollAttempts++;
            const timelineContent = document.querySelector('.block_timeline [data-region="event-list-content-date"]');
            
            if (timelineContent) {
                clearInterval(timelinePoller); 
                timelinePoller = null;

                parseTimelineDeadlines(); 
                applyDeadlineHighlight();

                if (timelineDeadlines.length > 0) {
                    await renderTimetableWidget(); 
                }
            } else if (pollAttempts > MAX_POLL_ATTEMPTS) {
                clearInterval(timelinePoller);
                timelinePoller = null;
            }
        }, 200); 
    }

    // --- 機能: 時間割 (Timetable Feature) ---

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
                cardBody.innerHTML = generateWeeklyTimetableHtml(timetable, timelineDeadlines);
                startCountdownTimers(); 
                
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

    function createCourseDirectUrl(courseId) {
        return `https://polite.do-johodai.ac.jp/moodle/course/view.php?id=${courseId}`;
    }

    async function getTimetable() {
        const data = await chrome.storage.local.get(TIMETABLE_STORAGE_KEY);
        let timetable;
        const stored = data[TIMETABLE_STORAGE_KEY];
        
        if (stored) {
            try {
                timetable = JSON.parse(stored);
            } catch (e) {
                timetable = DEFAULT_TIMETABLE;
            }
        } else {
            timetable = DEFAULT_TIMETABLE;
            chrome.storage.local.set({ [TIMETABLE_STORAGE_KEY]: JSON.stringify(DEFAULT_TIMETABLE) });
        }
        return timetable;
    }

    async function saveTimetable(timetable) {
        await chrome.storage.local.set({ [TIMETABLE_STORAGE_KEY]: JSON.stringify(timetable) });
    }

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
        
        for (let i = 0; i < CLASS_TIMES.length - 1; i++) {
            if (currentTime > CLASS_TIMES[i].end && currentTime < CLASS_TIMES[i+1].start) {
                return { periodNumber: null, status: '休み時間' };
            }
        }
        
        return { periodNumber: null, status: '授業時間外' };
    }

    function generateWeeklyTimetableHtml(timetable, deadlines) {
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

                    const normalizedTimetableName = normalizeCourseName(course.name);

                    const relevantDeadlines = deadlines
                        .filter(d => {
                            const normalizedDeadlineName = normalizeCourseName(d.courseName);
                            return normalizedDeadlineName.includes(normalizedTimetableName);
                        })
                        .sort((a, b) => a.dueTimestamp - b.dueTimestamp); 

                    if (relevantDeadlines.length > 0) {
                        htmlContent += `
                            <ul style="
                                font-size: 0.85em; 
                                color: #dc3545;
                                margin: 5px 0 0 10px; 
                                padding-left: 10px; 
                                list-style-type: '!! ';
                                line-height: 1.4;
                                font-weight: 500;
                            ">
                        `;
                        
                        relevantDeadlines.forEach(deadline => {
                            htmlContent += `<li>
                                <b>${deadline.assignmentName}</b>
                                <div 
                                    class="custom-countdown-timer" 
                                    data-due-timestamp="${deadline.dueTimestamp}"
                                >
                                    </div>
                                <span style="display: block; font-size: 0.9em; color: #6c757d;">
                                    (締め切り: ${deadline.dueDateString})
                                </span>
                            </li>`;
                        });
                        
                        htmlContent += '</ul>';
                    }

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

    function generateEditModalHtml(timetable) {
        const days = DAY_MAP.slice(1, 6); 
        const periods = CLASS_TIMES.map(t => t.period.toString());
        let bodyHtml = `
            <p style="margin-bottom: 15px;">科目名とMoodleのコースIDを入力してください。（IDはURL <code>course/view.php?id=XXX</code> のXXX部分です）</p>
            <div id="timetable-edit-grid" style="display: grid; grid-template-columns: 80px repeat(5, 1fr); gap: 10px; font-size: 0.9em;">
                <div style="font-weight: bold;">時間</div>
                ${days.map(day => `<div style="font-weight: bold; text-align: center;">${day}</div>`).join('')}
        `;

        for (const period of periods) {
            const periodTime = CLASS_TIMES.find(t => t.period.toString() === period);
            const timeStr = periodTime ? `${Math.floor(periodTime.start / 100)}:${(periodTime.start % 100).toString().padStart(2, '0')}` : '';
            bodyHtml += `<div style="font-weight: bold; line-height: 1.2;">${period}講時<br>(${timeStr})</div>`;

            for (const day of days) {
                const course = (timetable[day] && timetable[day][period]) ? timetable[day][period] : null;
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
                const id = idInput ? idInput.value.trim() : ''; 

                if (name && id && !isNaN(parseInt(id))) {
                    newTimetable[day][period] = { name, id: parseInt(id) };
                }
            }
        }
        
        newTimetable["土"] = {};
        newTimetable["日"] = {};

        await saveTimetable(newTimetable);
        document.getElementById('timetable-modal').style.display = 'none';
        await renderTimetableWidget();
    }


    // --- 機能: 期限ハイライト ---
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
    function injectStaticStyles() {
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
                background-color:  rgba(255, 255, 255, 1) !important;
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

            /* ★★★ GitHub Button V2 Styles */
            button.github-btn-mangesh636 {
              background: transparent;
              position: relative;
              padding: 5px 10px; 
              display: flex;
              align-items: center;
              font-size: 15px; 
              font-weight: 600;
              text-decoration: none;
              cursor: pointer;
              border: 1px solid rgb(36, 41, 46);
              border-radius: 25px;
              outline: none;
              overflow: hidden;
              color: rgb(36, 41, 46);
              transition: color 0.3s 0.1s ease-out, border-color 0.3s 0.1s ease-out;
              text-align: center;
              height: 38px; 
            }

            button.github-btn-mangesh636 span {
              margin: 0 5px; 
            }

            button.github-btn-mangesh636 svg {
              transition: fill 0.3s 0.1s ease-out;
            }

            button.github-btn-mangesh636::before {
              position: absolute;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              margin: auto;
              content: "";
              border-radius: 50%;
              display: block;
              width: 20em;
              height: 20em;
              left: -5em;
              text-align: center;
              transition: box-shadow 0.5s ease-out;
              z-index: -1;
            }

            button.github-btn-mangesh636:hover {
              color: #fff !important; 
              border: 1px solid rgb(36, 41, 46) !important;
            }
            
            button.github-btn-mangesh636:hover svg {
               fill: #fff !important; 
            }

            button.github-btn-mangesh636:hover::before {
              box-shadow: inset 0 0 0 10em rgb(36, 41, 46);
            }
              /* --- Quiz Retake Mode Styles (v2) --- */
            .retake-controls-card {
                background-color: #ffffff;
                border: 1px solid #ddd;
                border-radius: 8px;
                padding: 20px;
                margin-bottom: 20px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.08);
                position: relative; 
            }
            .retake-controls-card h4 {
                margin-top: 0;
                color: #005A9C; 
                font-weight: 600;
                border-bottom: 1px solid #eee;
                padding-bottom: 10px;
                margin-bottom: 10px;
                display: flex;
                align-items: center;
                gap: 8px; 
            }
            .retake-controls-card p {
                font-size: 0.95em;
                color: #555;
                margin-bottom: 20px;
            }
            .retake-controls-card .button-group {
                display: flex;
                gap: 12px;
                flex-wrap: wrap;
            }
            .retake-btn {
                padding: 10px 18px;
                border: none;
                border-radius: 5px;
                cursor: pointer;
                font-size: 0.95em; 
                font-weight: 600; 
                transition: all 0.2s ease;
                text-decoration: none;
                display: inline-flex; 
                align-items: center;
                gap: 6px; 
                text-align: center;
                line-height: 1.2;
            }
            .retake-btn-primary {
                background-color: #007bff; 
                color: white;
            }
            .retake-btn-primary:hover {
                background-color: #0056b3;
                box-shadow: 0 2px 5px rgba(0,0,0,0.15);
                transform: translateY(-1px);
            }
            .retake-btn-secondary {
                background-color: #f8f9fa;
                color: #333;
                border: 1px solid #ccc;
            }
            .retake-btn-secondary:hover {
                background-color: #e9ecef;
                border-color: #bbb;
            }
            .retake-btn-exit {
                position: absolute;
                top: 15px;
                right: 15px;
                background: none;
                border: none;
                font-size: 1.5rem;
                color: #888;
                cursor: pointer;
                padding: 5px;
                line-height: 1;
                transition: color 0.2s ease;
            }
            .retake-btn-exit:hover {
                color: #333;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    // --- 機能: 小テスト解きなおし ---
   function initQuizRetakeFeature() {
        if (!document.URL.includes('/mod/quiz/review.php') || document.getElementById('retake-controls')) {
            return;
        }
        const mainRegion = document.querySelector('#region-main > [role="main"]');
        if (!mainRegion) return;
        
        const resultContainer = document.createElement('div');
        resultContainer.id = 'retake-result';

        const buttonContainer = document.createElement('div');
        buttonContainer.id = 'retake-controls';
        buttonContainer.className = 'retake-controls-card';

        buttonContainer.innerHTML = `
            <button id="exitRetakeBtn" class="retake-btn-exit" title="解き直しを終了" style="display: none;">×</button>
            
            <h4>解き直し学習モード</h4>
            <p>Moodleの成績には影響しません。何度でも問題を解き直して復習できます。</p>
            
            <div class="button-group">
                <button id="startRetakeBtn" class="retake-btn retake-btn-primary">
                解き直しモードを開始
                </button>
                
                <button id="gradeRetakeBtn" class="retake-btn retake-btn-primary" style="display: none;">
                採点
                </button>
                <button id="resetRetakeBtn" class="retake-btn retake-btn-secondary" style="display: none;">
                    <i class="fa fa-refresh" aria-hidden="true"></i> リセット
                </button>
            </div>
        `;

        mainRegion.prepend(buttonContainer);
        mainRegion.prepend(resultContainer);

        document.getElementById('startRetakeBtn').addEventListener('click', startRetakeMode);
        document.getElementById('gradeRetakeBtn').addEventListener('click', gradeRetakeQuiz);
        document.getElementById('resetRetakeBtn').addEventListener('click', resetQuizButtons);
        document.getElementById('exitRetakeBtn').addEventListener('click', exitRetakeMode);
    }

    function exitRetakeMode() {
        if (confirm('解き直しモードを終了しますか？\n（ページがリロードされ、元のレビュー画面に戻ります）')) {
            window.location.reload();
        }
    }

    function parseQuizReviewAnswers() {
        quizAnswerStore.clear();
        const questions = document.querySelectorAll('div.que');

        questions.forEach(q => {
            const qid = q.id;
            if (!qid) return;
            
            let answerData = { type: null, answer: null };
            const rightAnswerElement = q.querySelector('.feedback .rightanswer');
            let rightAnswerText = '';
            if (rightAnswerElement) {
                 rightAnswerText = rightAnswerElement.textContent.trim(); 
            }

            if (q.classList.contains('multichoice')) {
                answerData.type = 'multichoice';
                const correctAnswerElement = q.querySelector('.answer .correct input[type="radio"], .answer .correct input[type="checkbox"]');
                if (correctAnswerElement) {
                    answerData.answer = correctAnswerElement.value;
                }
            } else if (q.classList.contains('truefalse')) {
                 answerData.type = 'truefalse';
                 if (rightAnswerText.includes("正解は「○」です") || rightAnswerText.toLowerCase().includes("the correct answer is 'true'")) {
                     answerData.answer = "1";
                 } else if (rightAnswerText.includes("正解は「×」です") || rightAnswerText.toLowerCase().includes("the correct answer is 'false'")) {
                     answerData.answer = "0";
                 } else {
                     const correctAnswerElement = q.querySelector('.answer .correct input[type="radio"]');
                     if (correctAnswerElement) {
                         answerData.answer = correctAnswerElement.value;
                     }
                 }
            } else if (q.classList.contains('numerical')) {
                answerData.type = 'numerical';
                if (rightAnswerText) {
                    const match = rightAnswerText.match(/(?:正解|The correct answer is):\s*([0-9.,]+)/i);
                    if (match && match[1]) {
                        answerData.answer = match[1].replace(',', '.');
                    }
                }
            } else if (q.classList.contains('shortanswer')) {
                 answerData.type = 'shortanswer';
                 if (rightAnswerText) {
                     const match = rightAnswerText.match(/(?:正解|The correct answer is):\s*(.*)/i);
                     if (match && match[1]) {
                         answerData.answer = match[1];
                     }
                 }
            } else if (q.classList.contains('gapselect')) {
                answerData.type = 'gapselect';
                const answers = {};
                const rightAnswerHTML = rightAnswerElement ? rightAnswerElement.innerHTML : '';
                const answerMatches = [...rightAnswerHTML.matchAll(/\[([\s\S]*?)\]/g)];
                const selects = q.querySelectorAll('select');
                
                if (answerMatches.length > 0 && selects.length > 0) {
                    selects.forEach((selectEl, index) => {
                        const selectId = selectEl.id; 
                        if (!selectId) return;

                        let correctAnswerValue = null;
                        
                        if (answerMatches[index] && answerMatches[index][1]) {
                            const correctText = answerMatches[index][1].replace(/<[^>]+>/g, '').trim();
                            const options = selectEl.querySelectorAll('option');
                            for (const option of options) {
                                if (option.textContent.trim() === correctText) {
                                    correctAnswerValue = option.value;
                                    break;
                                }
                            }
                        }
                        if (correctAnswerValue !== null) {
                            answers[selectId] = correctAnswerValue;
                        }
                    });
                }
                answerData.answer = answers;
            
            } else if (q.classList.contains('match')) {
                answerData.type = 'match';
                const answers = {};
                const textToAnswerMap = {};
                const rightAnswerHTML = rightAnswerElement ? rightAnswerElement.innerHTML : '';

                let processedHTML = rightAnswerHTML;
                processedHTML = processedHTML.replace(/<(p|div|br)[^>]*>/gi, '|||'); 
                processedHTML = processedHTML.replace(/<[^>]+>/g, ''); 
                processedHTML = processedHTML.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

                const pairs = processedHTML.split('|||');
                pairs.forEach(part => {
                    part = part.trim(); 
                    if (part.includes('→')) {
                        const match = part.match(/(.+?)\s*→\s*(.+)/);
                        if (match && match[1] && match[2]) {
                            let questionText = match[1].trim();
                            let answerText = match[2].trim().replace(/,$/, '').trim(); 
                            if (questionText && answerText) {
                                if (questionText.startsWith('正解:')) {
                                    questionText = questionText.substring(3).trim();
                                }
                                if(questionText) {
                                    textToAnswerMap[questionText] = answerText;
                                }
                            }
                        }
                    }
                });
                
                const subQuestions = q.querySelectorAll('.ablock .answer tr');
                subQuestions.forEach(tr => {
                    const textEl = tr.querySelector('.text');
                    const selectEl = tr.querySelector('.control select');
                    if (!textEl || !selectEl) return;

                    const questionTextDOM = textEl.textContent.trim();
                    let correctAnswserText = textToAnswerMap[questionTextDOM];
                    
                    if (!correctAnswserText) {
                        const domKey = Object.keys(textToAnswerMap).find(key => 
                            questionTextDOM.includes(key) || key.includes(questionTextDOM)
                        );
                        if(domKey) {
                             correctAnswserText = textToAnswerMap[domKey];
                        } else {
                            return; 
                        }
                    }

                    let correctValue = null;
                    const options = selectEl.querySelectorAll('option');
                    for (const option of options) {
                        if (option.textContent.trim() === correctAnswserText) {
                            correctValue = option.value;
                            break;
                        }
                    }
                    if (correctValue !== null) {
                        answers[selectEl.id] = correctValue;
                    }
                });
                answerData.answer = answers;
            }

            if (answerData.type && answerData.answer !== null && (Object.keys(answerData.answer).length > 0 || typeof answerData.answer !== 'object')) {
                quizAnswerStore.set(qid, answerData);
            }
        });
    }

    function startRetakeMode() {
        if (!isRetakeMode) {
            parseQuizReviewAnswers();
            if (quizAnswerStore.size === 0) {
                 alert("エラー: 問題の正解をページから読み取れませんでした。");
                 return;
            }
            isRetakeMode = true;
        }
        retakeStartTime = new Date();

        document.querySelectorAll('.state, .grade, .outcome').forEach(el => {
            el.style.display = 'none';
        });
        
        document.querySelectorAll('i.fa-circle-check, i.fa-circle-xmark').forEach(icon => {
             if (!icon.classList.contains('retake-feedback-icon')) {
                icon.style.display = 'none';
             }
        });
        
        document.querySelectorAll('div.que.numerical .ablock i.icon, div.que.shortanswer .ablock i.icon').forEach(icon => {
             if (!icon.classList.contains('retake-feedback-icon')) {
                icon.style.display = 'none';
             }
        });

        document.querySelectorAll('div.que.gapselect .qtext i.icon').forEach(icon => {
             if (!icon.classList.contains('retake-feedback-icon')) {
                icon.style.display = 'none';
             }
        });
        
        document.querySelectorAll('div.que.match .control i.icon').forEach(icon => {
             if (!icon.classList.contains('retake-feedback-icon')) {
                icon.style.display = 'none';
             }
        });

        resetRetakeQuiz(); 

        document.getElementById('startRetakeBtn').style.display = 'none';
        document.getElementById('gradeRetakeBtn').style.display = 'inline-block';
        document.getElementById('resetRetakeBtn').style.display = 'inline-block';
        document.getElementById('exitRetakeBtn').style.display = 'block';
    }

    function resetRetakeQuiz() {
        const questions = document.querySelectorAll('div.que');
        questions.forEach(q => {
            q.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(input => {
                input.disabled = false;
                input.checked = false;
            });
            
            q.querySelectorAll('input[type="text"]').forEach(input => {
                if(input.name && input.name.endsWith('_answer')) {
                    input.disabled = false;
                    input.readOnly = false;
                    input.value = '';
                    input.classList.remove('correct', 'incorrect');
                }
            });

            const allSelects = q.querySelectorAll('select');
            allSelects.forEach(selectEl => {
                if (selectEl.name && selectEl.name.includes(':')) {
                    selectEl.disabled = false;
                    selectEl.selectedIndex = 0;
                    selectEl.classList.remove('correct', 'incorrect');
                }
            });
            
            q.querySelectorAll('.state, .grade, .outcome').forEach(el => {
                 el.style.display = 'none';
                 if (el.classList.contains('state')) {
                     el.style.color = '';
                     el.textContent = '';
                 }
            });
            
            q.querySelectorAll('i.fa-circle-check, i.fa-circle-xmark').forEach(icon => {
                 if (!icon.classList.contains('retake-feedback-icon')) {
                     icon.style.display = 'none';
                 }
            });
            
            q.querySelectorAll('.retake-feedback-icon').forEach(el => {
                 el.remove();
            });
            
            const ablockIcon = q.querySelector('.ablock .icon');
            if (ablockIcon && (q.classList.contains('numerical') || q.classList.contains('shortanswer'))) {
                 ablockIcon.classList.remove('fa-regular', 'fa-circle-check', 'text-success', 'fa-circle-xmark', 'text-danger');
                 ablockIcon.style.display = 'none';
                 ablockIcon.setAttribute('title', '');
                 ablockIcon.setAttribute('aria-label', '');
            }

            q.querySelectorAll('div.que.gapselect .qtext i.icon').forEach(icon => {
                 icon.classList.remove('fa-regular', 'fa-circle-check', 'text-success', 'fa-circle-xmark', 'text-danger');
                 icon.style.display = 'none';
                 icon.setAttribute('title', '');
                 icon.setAttribute('aria-label', '');
            });
            
            q.querySelectorAll('div.que.match .control i.icon').forEach(icon => {
                 icon.classList.remove('fa-regular', 'fa-circle-check', 'text-success', 'fa-circle-xmark', 'text-danger');
                 icon.style.display = 'none';
                 icon.setAttribute('title', '');
                 icon.setAttribute('aria-label', '');
            });
        });
        
        const resultEl = document.getElementById('retake-result');
        if (resultEl) resultEl.innerHTML = '';
        
        retakeStartTime = new Date();
    }

    function resetQuizButtons() {
        resetRetakeQuiz();
    }

    function gradeRetakeQuiz() {
        let totalQuestions = 0;
        let correctAnswers = 0;
        const retakeEndTime = new Date();
        
        let totalMarks = 0;
        let earnedMarks = 0; 

        quizAnswerStore.forEach((correctData, qid) => {
            totalQuestions++;
            const questionElement = document.getElementById(qid);
            if (!questionElement) return;

            const stateEl = questionElement.querySelector('.state');
            const outcomeEl = questionElement.querySelector('.outcome');
            const gradeEl = questionElement.querySelector('.grade');

            let maxMark = 0;
            if (gradeEl) {
                const match = gradeEl.textContent.match(/[0-9.]+\s*\/\s*([0-9.]+)/);
                if (match && match[1]) {
                    maxMark = parseFloat(match[1]);
                }
            }
            totalMarks += maxMark;
            
            let earnedMarkForThisQ = 0; 
            let isCorrect = false; 
            const qidParts = qid.split('-');
            if (qidParts.length < 3) return;
            const inputName = `q${qidParts[1]}:${qidParts[2]}_answer`; 

            const createIcon = (isCorrect) => {
                 const iconClass = isCorrect ? 'fa-circle-check text-success' : 'fa-circle-xmark text-danger';
                 const title = isCorrect ? '正解' : '不正解';
                 return `<span class="ms-1 retake-feedback-icon">
                             <i class="icon fa-regular ${iconClass} fa-fw" title="${title}" role="img" aria-label="${title}"></i>
                         </span>`;
            };

            if (correctData.type === 'multichoice') {
                const selectedInput = questionElement.querySelector(`input[name="${inputName}"]:checked`);
                if (selectedInput && selectedInput.value === correctData.answer) {
                    isCorrect = true;
                }
                const answerInputs = questionElement.querySelectorAll(`.answer input[name="${inputName}"]`);
                answerInputs.forEach(input => {
                    const isThisTheCorrectAnswer = (input.value === correctData.answer);
                    const isThisTheSelectedAnswer = (selectedInput && input.value === selectedInput.value);
                    const labelDiv = input.closest('.r0, .r1');
                    if (!labelDiv) return;
                    if (isThisTheCorrectAnswer) {
                        labelDiv.insertAdjacentHTML('beforeend', createIcon(true));
                    } else if (isThisTheSelectedAnswer && !isCorrect) {
                        labelDiv.insertAdjacentHTML('beforeend', createIcon(false));
                    }
                });

            } else if (correctData.type === 'truefalse') {
                 const selectedInput = questionElement.querySelector(`input[name="${inputName}"]:checked`);
                if (selectedInput && selectedInput.value === correctData.answer) {
                    isCorrect = true;
                }
                const answerInputs = questionElement.querySelectorAll(`.answer input[name="${inputName}"]`);
                answerInputs.forEach(input => {
                    const isThisTheCorrectAnswer = (input.value === correctData.answer);
                    const isThisTheSelectedAnswer = (selectedInput && input.value === selectedInput.value);
                    const labelDiv = input.closest('.r0, .r1');
                    if (!labelDiv) return;
                    if (isThisTheCorrectAnswer) {
                        labelDiv.insertAdjacentHTML('beforeend', createIcon(true));
                    } else if (isThisTheSelectedAnswer && !isCorrect) {
                         labelDiv.insertAdjacentHTML('beforeend', createIcon(false));
                    }
                });

            } else if (correctData.type === 'numerical' || correctData.type === 'shortanswer') {
                 const textInput = questionElement.querySelector(`input[name="${inputName}"]`);
                 const userAnswer = (textInput ? textInput.value.trim() : '');
                 const correctAnswer = (correctData.type === 'numerical') ? correctData.answer.replace(',', '.') : correctData.answer;
                 const userCompareValue = (correctData.type === 'numerical') ? userAnswer.replace(',', '.') : userAnswer;

                 if (userCompareValue.toLowerCase() === correctAnswer.toLowerCase()) {
                     isCorrect = true;
                 }
                
                if (textInput) {
                    textInput.classList.remove('correct', 'incorrect');
                    textInput.classList.add(isCorrect ? 'correct' : 'incorrect');
                }
                 
                 let iconElement = textInput ? textInput.nextElementSibling : null;
                 if (!iconElement || iconElement.tagName !== 'I') {
                      iconElement = textInput ? textInput.parentElement.nextElementSibling : null;
                 }

                 if (iconElement && iconElement.tagName === 'I' && iconElement.classList.contains('icon')) {
                     iconElement.classList.remove('fa-regular', 'fa-circle-check', 'text-success', 'fa-circle-xmark', 'text-danger');
                     if (isCorrect) {
                         iconElement.classList.add('fa-regular', 'fa-circle-check', 'text-success');
                         iconElement.setAttribute('title', '正解');
                         iconElement.setAttribute('aria-label', '正解');
                     } else {
                         iconElement.classList.add('fa-regular', 'fa-circle-xmark', 'text-danger');
                         iconElement.setAttribute('title', '不正解');
                         iconElement.setAttribute('aria-label', '不正解');
                     }
                     iconElement.style.display = 'inline-block';
                     iconElement.classList.add('retake-feedback-icon');
                 }
                 
            } else if (correctData.type === 'gapselect') {
                let allGapsCorrect = true;
                let correctGaps = 0;
                
                const selects = questionElement.querySelectorAll('select');
                let relevantSelects = 0; 
                
                if (selects.length === 0) {
                    allGapsCorrect = false;
                }
                
                selects.forEach(selectEl => {
                    if (!selectEl.name || !selectEl.name.includes(':')) {
                        return; 
                    }
                    relevantSelects++;

                    const selectId = selectEl.id; 
                    const correctAnswerValue = correctData.answer[selectId];
                    const userAnswerValue = selectEl.value;
                    
                    let isGapCorrect = (correctAnswerValue !== undefined && userAnswerValue === correctAnswerValue);
                    
                    if (isGapCorrect) {
                        correctGaps++;
                    } else {
                        allGapsCorrect = false;
                    }
                    
                    selectEl.classList.remove('correct', 'incorrect');
                    selectEl.classList.add(isGapCorrect ? 'correct' : 'incorrect');
                    
                    const iconElement = selectEl.nextElementSibling;
                    if (iconElement && iconElement.tagName === 'I' && iconElement.classList.contains('icon')) {
                         iconElement.classList.remove('fa-regular', 'fa-circle-check', 'text-success', 'fa-circle-xmark', 'text-danger');
                         if (isGapCorrect) {
                             iconElement.classList.add('fa-regular', 'fa-circle-check', 'text-success');
                             iconElement.setAttribute('title', '正解');
                             iconElement.setAttribute('aria-label', '正解');
                         } else {
                             iconElement.classList.add('fa-regular', 'fa-circle-xmark', 'text-danger');
                             iconElement.setAttribute('title', '不正解');
                             iconElement.setAttribute('aria-label', '不正解');
                         }
                         iconElement.style.display = 'inline-block';
                         iconElement.classList.add('retake-feedback-icon');
                    }
                });
                
                isCorrect = allGapsCorrect;
                
                if (relevantSelects > 0) {
                     earnedMarkForThisQ = (maxMark * (correctGaps / relevantSelects));
                } else if (selects.length > 0) {
                    earnedMarkForThisQ = (maxMark * (correctGaps / selects.length));
                }
                earnedMarks += earnedMarkForThisQ;
            
            } else if (correctData.type === 'match') {
                let allMatchCorrect = true;
                let correctMatches = 0;
                
                const selects = questionElement.querySelectorAll('.ablock .answer select');
                if (selects.length === 0) {
                    allMatchCorrect = false;
                }

                selects.forEach(selectEl => {
                    const selectId = selectEl.id;
                    const correctAnswerValue = correctData.answer[selectId];
                    const userAnswerValue = selectEl.value;

                    let isMatchCorrect = (correctAnswerValue !== undefined && userAnswerValue === correctAnswerValue);

                    if (isMatchCorrect) {
                        correctMatches++;
                    } else {
                        allMatchCorrect = false;
                    }

                    selectEl.classList.remove('correct', 'incorrect');
                    selectEl.classList.add(isMatchCorrect ? 'correct' : 'incorrect');
                    
                    const controlCell = selectEl.closest('.control');
                    if (controlCell) {
                         const iconElement = controlCell.querySelector('i.icon');
                         if (iconElement) {
                             iconElement.classList.remove('fa-regular', 'fa-circle-check', 'text-success', 'fa-circle-xmark', 'text-danger');
                             if (isMatchCorrect) {
                                 iconElement.classList.add('fa-regular', 'fa-circle-check', 'text-success');
                                 iconElement.setAttribute('title', '正解');
                                 iconElement.setAttribute('aria-label', '正解');
                             } else {
                                 iconElement.classList.add('fa-regular', 'fa-circle-xmark', 'text-danger');
                                 iconElement.setAttribute('title', '不正解');
                                 iconElement.setAttribute('aria-label', '不正解');
                             }
                             iconElement.style.display = 'inline-block';
                             iconElement.classList.add('retake-feedback-icon');
                         }
                    }
                });

                isCorrect = allMatchCorrect;

                if (selects.length > 0) {
                    earnedMarkForThisQ = (maxMark * (correctMatches / selects.length));
                }
                earnedMarks += earnedMarkForThisQ;
            }

            if (correctData.type !== 'gapselect' && correctData.type !== 'match') {
                if (isCorrect) {
                    correctAnswers++;
                    earnedMarkForThisQ = maxMark;
                    earnedMarks += maxMark;
                }
            }

            if (stateEl) {
                if ((correctData.type === 'gapselect' || correctData.type === 'match') && !isCorrect && earnedMarkForThisQ > 0) {
                     stateEl.textContent = '部分的に正解';
                     stateEl.style.color = '#FF8C00'; 
                } else {
                    stateEl.textContent = isCorrect ? '正解' : '不正解';
                    stateEl.style.color = isCorrect ? '#28a745' : '#dc3545';
                }
                stateEl.style.display = 'block'; 
            }
            
            if (gradeEl) {
                gradeEl.innerHTML = `${earnedMarkForThisQ.toFixed(2)} / ${maxMark.toFixed(2)}`;
                gradeEl.style.display = 'block';
            }

            if (outcomeEl) {
                outcomeEl.style.display = 'block';
            }

        }); 

        const resultEl = document.getElementById('retake-result');
        if (resultEl) {
            
            let durationString = '-';
            if (retakeStartTime) {
                const durationMs = retakeEndTime.getTime() - retakeStartTime.getTime();
                const totalSeconds = Math.round(durationMs / 1000);
                const minutes = Math.floor(totalSeconds / 60);
                const seconds = totalSeconds % 60;
                durationString = `${minutes} 分 ${seconds} 秒`;
            }
            
            const formatDate = (date) => {
                 if (!date) return '-';
                 const options = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false };
                 try {
                     return date.toLocaleString('ja-JP', options);
                 } catch (e) {
                     return date.toLocaleString();
                 }
            };
            
            const scorePercentage = totalMarks > 0 ? (earnedMarks / totalMarks) * 100 : 0;

            let resultHTML = `
                <h3 style="margin-top: 1.5rem; border-bottom: 1px solid #ddd; padding-bottom: 5px;">解き直し結果</h3>
                <div class="mb-3">
                    <table class="table generaltable generalbox quizreviewsummary mb-0">
                       <caption class="visually-hidden">結果の概要</caption>
                       <tbody>
                            <tr>
                                <th class="cell" scope="row">ステータス</th>
                                <td class="cell">解き直し完了</td>
                            </tr>
                            <tr>
                                <th class="cell" scope="row">開始日時</th>
                                <td class="cell">${formatDate(retakeStartTime)}</td>
                            </tr>
                            <tr>
                                <th class="cell" scope="row">完了日時</th>
                                <td class="cell">${formatDate(retakeEndTime)}</td>
                            </tr>
                            <tr>
                                <th class="cell" scope="row">継続時間</th>
                                <td class="cell">${durationString}</td>
                            </tr>
                            <tr>
                                <th class="cell" scope="row">評点</th>
                                <td class="cell"><b>${earnedMarks.toFixed(2)}</b> / ${totalMarks.toFixed(2)} (<b>${scorePercentage.toFixed(0)}</b>%)</td>
                            </tr>
                       </tbody>
                    </table>
                </div>
            `;
            
            if (Math.abs(totalMarks - earnedMarks) < 0.001) {
                resultHTML += `<p style="color: #028dffff; font-weight: bold; font-size: 1.1em; margin-top: 1rem;">素晴らしい！全問正解です！</p>`;
            } else {
                 resultHTML += `<p style="color: #ff3131e1; font-size: 1.1em; margin-top: 1rem;">間違えた問題を確認して「リセット」でもう一度挑戦できます。</p>`;
            }
            
            resultEl.innerHTML = resultHTML;

            retakeStartTime = new Date(); 
        }
    }

    // --- 実行 (即時実行) ---
    init(); 

})();