(function() {
    'use strict';

    // I. Constants and Global Variables
    
    // IndexedDB
    const DB_NAME = 'MoodleCustomBGDB';
    const DB_VERSION = 2;
    const STORE_NAME = 'background_files';
    const DB_KEY_BG = 'current_bg';

    // Storage keys
    const SETTINGS_STORAGE_KEY = 'moodle_custom_settings_v5';
    const TIMETABLE_STORAGE_KEY = 'moodle_custom_timetable_v2';
    const FONT_CACHE_KEY = 'moodle_fast_font_cache_v2'; 
    const DARKMODE_ENABLED_KEY = 'darkmode_enabled_v1'; // For fast determination
    const DARKMODE_SETTINGS_KEY = 'darkmode_settings_v1';

    // Global variables
    let availableCourses = [];
    let loadStartTime = null; // Record load start time
    const MIN_LOAD_DURATION_MS = 500; // Minimum display duration (0.5s)
    
    // Default settings
    const DEFAULT_SETTINGS = {
        headerBgColor: "#ffffff",
        headerTextColor: "#000000",
        headerStrokeColor: "#ffffff",
        backgroundUrl: '',
        backgroundType: 'none',
        opacity: 80,
        brightness: 100,
        showTimetable: true,
        enableCustomLayout: false, 
        contentOpacity: 70,
        fontFamily: "default", 
        customFontName: "",
        customFontUrl: "",
        darkModeMode: 'off', // 'off', 'on', 'auto'
        darkModeBrightness: 100,
        darkModeContrast: 100,
        darkModeGrayscale: 0,
        darkModeSepia: 0
    };

    // Timetable definition
    const DEFAULT_TIMETABLE = {
        "月": {}, "火": {}, "水": {}, "木": {}, "金": {}, "土": {}, "日": {}
    };
    const CLASS_TIMES = [
        { start: 900, end: 1030, period: 1 }, { start: 1040, end: 1210, period: 2 }, { start: 1255, end: 1425, period: 3 },
        { start: 1435, end: 1605, period: 4 }, { start: 1615, end: 1745, period: 5 }, { start: 1755, end: 1925, period: 6 }
    ];
    const DAY_MAP = ["日", "月", "火", "水", "木", "金", "土"];

    // Selectors
    const BODY_SELECTOR = 'body#page-my-index, body#page-course-view-topics, body#page-course-view-weeks,body#page';
    const DASHBOARD_REGION_SELECTOR = '#block-region-content';

    // --- Global variables ---
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
    
    // DarkReader cache (for fast application)
    try {
        const cachedFontJson = localStorage.getItem(FONT_CACHE_KEY);
        if (cachedFontJson) {
            const cachedSettings = JSON.parse(cachedFontJson);
            applyFontStyle(cachedSettings); 
        }
    } catch (e) {
        console.warn("Fast font apply failed:", e);
    }
    
    // FOUC protection: Fastest inline style injection (before init())
    // Switched to visibility control because previous inline injection could not prevent FOUC.
    // Guaranteed to run at the top of content.js

    try {
        const storedDarkModeMode = localStorage.getItem(DARKMODE_ENABLED_KEY) || 'off';
        const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        const shouldDarkQuickCheck = (
            storedDarkModeMode === 'on' ||
            (storedDarkModeMode === 'auto' && isSystemDark)
        );
        
        if (shouldDarkQuickCheck && document.readyState === 'loading') {
            const inlineStyleContent = `
        /* Hide everything momentarily to prevent white flash */
        /* Fix: Make visibility:hidden depend on dark-fouc-mask class */
        html:not(.dark-fouc-mask-ready) { 
            visibility: hidden !important; 
            background-color: #303030 !important;
        }
        /* Class to display after Dark Reader loads. Added in init() or navigation */
        html.dark-fouc-mask-ready { 
            visibility: visible !important; 
        }
    `;
            const style = document.createElement('style');
            style.id = 'extreme-fouc-fix';
            style.textContent = inlineStyleContent;
            
            // Expect document.documentElement to exist and insert
            (document.head || document.documentElement).prepend(style);
            
            // Add class simultaneously with style tag insertion (fastest insurance)
            document.documentElement.classList.add("dark-fouc-mask");

        } else if (shouldDarkQuickCheck) {
            // If running at document_end/idle, do not control visibility, rely only on mask CSS
             document.documentElement.classList.add("dark-fouc-mask");
        }
    } catch(e) {
        // Error likely in dev environment, ignoring
    }

     function injectCustomLoadingScreen() {
        if (!document.getElementById('moodle-custom-loading-screen')) {
            const loadingScreen = document.createElement('div');
            loadingScreen.id = 'moodle-custom-loading-screen';
            
            // Image URL
            const imageUrl = 'https://raw.githubusercontent.com/Miaka1020/Moodle-Custom-Extension/main/assets/Loading2.png';

            loadingScreen.innerHTML = `
                <div class="loading-content">
                    <img src="${imageUrl}" alt="" class="custom-loading-img">
                    <div class="loading-bar-container">
                        <div class="loading-bar-fill"></div>
                    </div>
                </div>
            `;
            document.body.appendChild(loadingScreen);
        }
    }
    // II. Dark Mode Core Functions & Helpers
     
    /**
     * Inject Dark Reader library and settings bridge into the page.
     */
    function removeCustomLoadingScreen() {
    const customLoadingScreen = document.getElementById('moodle-custom-loading-screen');
    if (!customLoadingScreen) return;

    const elapsedTime = Date.now() - loadStartTime;
    const remainingTime = MIN_LOAD_DURATION_MS - elapsedTime;

    if (remainingTime > 0) {
        setTimeout(() => {
            removeCustomLoadingScreen(); 
        }, remainingTime);
        return;
    }

    customLoadingScreen.style.pointerEvents = 'none';

    customLoadingScreen.style.opacity = '0'; // Start fade-out
    setTimeout(() => {
        customLoadingScreen.remove();
    }, 300);

    const oldLoadingScreen = document.getElementById('darkmode-loading-screen');
    if (oldLoadingScreen) {
        oldLoadingScreen.style.pointerEvents = 'none'; 
        oldLoadingScreen.style.opacity = '0';
        setTimeout(() => {
            oldLoadingScreen.remove();
        }, 300);
    }
    
    document.documentElement.classList.remove("dark-fouc-mask");
}

    /**
     * Inject styles to make backgrounds transparent for elements turned black by Dark Reader.
     */
    function injectDarkModeFixupStyles() {
        // NOTE: This function is integrated into moodle-custom-styles.css and is redundant.
        let fixStyle = document.getElementById('darkreader-fixup-style');
        if (!fixStyle) {
            fixStyle = document.createElement('style');
            fixStyle.id = 'darkreader-fixup-style';
            document.head.appendChild(fixStyle);
        }
        
        const fixupCss = `
            /* Dark Reader Fixup CSS (Integrated into moodle-custom-styles.css) */
            html[data-darkreader-scheme="dark"] #page-content,
            html[data-darkreader-scheme="dark"] #page-wrapper,
            html[data-darkreader-scheme="dark"] #page-header,
            html[data-darkreader-scheme="dark"] #region-main-box,
            html[data-darkreader-scheme="dark"] .card,
            html[data-darkreader-scheme="dark"] .block,
            html[data-darkreader-scheme="dark"] .list-group-item,
            html[data-darkreader-scheme="dark"] .que,
            html[data-darkreader-scheme="dark"] .bg-white,
            html[data-darkreader-scheme="dark"] .context-header-settings-menu,
            html[data-darkreader-scheme="dark"] .page-context-header,
            html[data-darkreader-scheme="dark"] .page-header-wrapper,
            html[data-darkreader-scheme="dark"] .drawer-content,
            html[data-darkreader-scheme="dark"] #customTimetableWidget card-body,
            html[data-darkreader-scheme="dark"] .yui3-js-enabled,
            html[data-darkreader-scheme="dark"] #page-my-index,
            html[data-darkreader-scheme="dark"] #page-wrapper,
            html[data-darkreader-scheme="dark"] .w-100,
            html[data-darkreader-scheme="dark"] #page-course-view-topics,
            html[data-darkreader-scheme="dark"] #region-main,
            html[data-darkreader-scheme="dark"] .card-body .p-3,
            html[data-darkreader-scheme="dark"] .card-body.p-3,
            html[data-darkreader-scheme="dark"] .card-body.pt-3,
            html[data-darkreader-scheme="dark"] .card-text,
            html[data-darkreader-scheme="dark"] .sr-only
            {
                background-color: transparent !important;
            }
            html[data-darkreader-scheme="dark"] .card *, 
            html[data-darkreader-scheme="dark"] .block * {
                color: var(--darkreader-neutral-text, #e8e6e3) !important;
            }
        `;
        fixStyle.textContent = fixupCss;
    }

    function injectDarkReaderLogic(settings) {
        
        // 1. Embed settings data as DOM element
        let settingsData = document.getElementById('darkreader-settings-data');
        if (!settingsData) {
            settingsData = document.createElement('script');
            settingsData.id = 'darkreader-settings-data';
            settingsData.type = 'application/json';
            document.head.appendChild(settingsData);
        }
        settingsData.textContent = JSON.stringify(settings);
        
        // 2. Inject Dark Reader library (only once)
        let drLibScript = document.getElementById('darkreader-library-script');
        if (!drLibScript) {
            drLibScript = document.createElement('script');
            drLibScript.id = 'darkreader-library-script';
            drLibScript.src = chrome.runtime.getURL("darkreader.js"); 
            drLibScript.setAttribute('data-skip-loader', 'true'); 
            document.head.appendChild(drLibScript);
        }
        
        // 3. Inject bridge script for initialization and settings application (runs every time)
        let initScript = document.getElementById('dr-init-bridge-script');
        if(initScript) {
            initScript.remove(); 
        }
        
        initScript = document.createElement('script');
        initScript.id = 'dr-init-bridge-script';
        initScript.src = chrome.runtime.getURL("dr_init_bridge.js");
        document.head.appendChild(initScript);
    }

    /**
     * Trigger Dark Mode settings application.
     */
    function loadDarkReader(settings) {
       injectDarkReaderLogic(settings);
    }


    // III. Initialization and Core Flow
    
    // Function to inject external CSS (Deprecated, migrated to manifest.json)
    function injectExternalCSS(fileName) {
        let link = document.createElement('link');
        link.rel = 'stylesheet';
        link.type = 'text/css';
        link.href = chrome.runtime.getURL(fileName);
        document.head.appendChild(link);
    }
    
    // --- Main Process (Initialization) ---
async function init() {
    loadStartTime = Date.now();
    // 1. [CSS Injection] (Omitted - processing in manifest.json recommended)

    // 2. [Start fast check and FOUC protection]
    // Fix: Logic removed as extreme FOUC protection is done at top of file.
    
    // Static styles (dynamically generated)
    injectDashboardLayoutStyles(); 
    
    await setupIndexedDB(); // DB load is async but needed for settings retrieval
    
    // 3. [Load official settings]
    const settings = await getSettings(); 
    const shouldDarkFinal = (
        settings.darkModeMode === 'on' ||
        (settings.darkModeMode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    );

    // 4. Adjust FOUC protection class and show custom loading screen (Parallel processing)
    if (!shouldDarkFinal) {
         // If DarkMode is not needed, remove temporary class immediately
         document.body.classList.remove('dark-mode-fouc-temp');
         // Fix: If Dark Mode is not needed, fast FOUC mask is also not needed, so remove it to display screen
         document.documentElement.classList.remove("dark-fouc-mask");
    } else {
         injectCustomLoadingScreen(); // Insert custom loading screen
         
         // [Important] Set forced timeout
         // Force remove loading screen if Dark Reader application event doesn't fire by 2 seconds
         setTimeout(() => {
             const loader = document.getElementById('moodle-custom-loading-screen');
             // Force remove if opacity is 1 (fade-out hasn't started)
             if (loader && loader.style.opacity === '1') {
                 console.warn("Dark Reader loading timed out. Forcing removal of loading screen.");
                 removeCustomLoadingScreen();
             }
         }, 2000); // Execute after 2 seconds
    }
    
    if (!localStorage.getItem(FONT_CACHE_KEY)) {
        saveFontCache(settings);
    }
    
    // 5. Load DarkReader and trigger style application after load completion (runs in background)
    loadDarkReader(settings);

    // Inject UI elements and apply initial styles
    if (document.body) {
        startUIInjection(settings);
    } else {
        document.addEventListener('DOMContentLoaded', () => startUIInjection(settings));
    }

    // Initial scan (wait for Moodle load)
    setTimeout(scanCoursesFromPage, 2000); 
    
    // --- Debug features ---
    window.printAvailableCourses = function() {
        console.log("--- Moodle Customizer: availableCourses ---");
        console.log(availableCourses);
        console.log("------------------------------------------");
    };
    // ----------------------
}
   function changeSiteTitle() {
        const selectors = [
            'nav.navbar .navbar-brand',       
            '.navbar-brand',                  
            '#page-header .navbar-brand',     
            'header .site-name a'             
        ];
        
        // Fix: Increased font size from 0.6em -> 0.9em
        // Adjusted position (top) slightly down to prevent excessive protrusion
        const newTitleHtml = 'POLITE<sup style="font-size: 0.9em; top: -0.4em; margin-left: 2px;">+</sup>';

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
                const originalText = element.textContent.trim();
                if (originalText.length > 0) {
                    element.innerHTML = newTitleHtml;
                    
                    element.style.fontWeight = '700';
                    element.style.letterSpacing = '1.5px'; 
                    element.style.display = 'inline-flex'; 
                    element.style.alignItems = 'center';
                    
                    console.log(`Moodle Customizer: Site title changed to "POLITE+".`);
                    return;
                }
            }
        }
        console.warn("Moodle Customizer: Site title element not found.");
    }

    async function startUIInjection(settings) {
        injectGithubButton(); 
        injectSettingsButton();
        injectSettingsModal(settings);
        
        const timetable = await getTimetable(); 
        injectEditModal(timetable); 

        // Apply custom styles (do not reload settings asynchronously for the first time, use init settings)
        await applyAllCustomStyles(false); 

        if (document.URL.includes('/my/')) {
            startTimelinePoller();
        }
        
        if (document.URL.includes('/mod/quiz/review.php')) {
            initQuizRetakeFeature();
        }
        
        changeSiteTitle(); 

        bindFoucProtectionOnNavigation();

    }

  

    // --- Feature: Auto-scan course info ---
    function scanCoursesFromPage() {
        const links = document.querySelectorAll('a[href*="course/view.php?id="]');
        const courseMap = new Map();

        links.forEach(link => {
            const href = link.getAttribute('href');
            const match = href.match(/id=(\d+)/);
            if (match) {
                const id = match[1];
                let name = link.textContent.trim();
                
                if (!name) {
                    name = link.getAttribute('title') || link.getAttribute('aria-label') || "";
                }
                
                if (name && name.length > 2 && !courseMap.has(id)) {
                    // Exclude generic terms
                    if(!["コース", "詳細", "Course", "Grades", "Competencies", "成績", "詳細を見る"].includes(name)) {
                        courseMap.set(id, name);
                    }
                }
            }
        });

        // Convert Map to array and store
        availableCourses = Array.from(courseMap, ([id, name]) => ({ id, name }));
        console.log(`Moodle Customizer: ${availableCourses.length} courses scanned.`);
    }

    // --- Course name normalization function ---
    function normalizeCourseName(name) {
        if (typeof name !== 'string') return '';
        return name
            .toLowerCase() 
            .normalize('NFKC') 
            .replace(/\s| |　/g, '') 
            .replace(/（.*）$|\(.*\)$/, ''); 
    }

    // --- CSS: For suggestion list (Z-INDEX enhanced) ---
    function injectSuggestionStyles() {
        const style = document.createElement('style');
        style.innerHTML = `
            /* Suggestion list design */
            .suggestion-list {
                position: absolute;
                top: 100%;
                left: 0;
                right: 0;
                background: white;
                border: 1px solid #ccc;
                border-radius: 0 0 4px 4px;
                list-style: none;
                padding: 0;
                margin: 0;
                max-height: 200px; /* Height adjustment */
                overflow-y: auto;
                z-index: 2147483647; /* Fix occlusion with max Z-INDEX */
                box-shadow: 0 4px 6px rgba(0,0,0,0.15);
                display: none;
                text-align: left;
            }
            .suggestion-list li {
                padding: 8px 10px;
                cursor: pointer;
                font-size: 0.9em;
                border-bottom: 1px solid #eee;
                color: #333;
                background: #fff;
            }
            .suggestion-list li:last-child {
                border-bottom: none;
            }
            .suggestion-list li:hover {
                background-color: #e9ecef;
                color: #0056b3;
            }
            .input-wrapper-relative {
                position: relative;
            }
            /* Styles for alert messages */
            .modal-alert-message {
                padding: 10px;
                background-color: #fff3cd; 
                color: #856404; 
                border: 1px solid #ffeeba;
                border-radius: 4px;
                margin-bottom: 15px;
                font-size: 0.9em;
                line-height: 1.4;
            }
            .modal-alert-message strong {
                color: #dc3545; /* Highlight in red */
            }
            /* DarkReader overrides */
            html[data-darkreader-scheme="dark"] .modern-modal-content {
                background-color: #1c1c1c !important;
                color: #d1d1d1 !important;
            }
            html[data-darkreader-scheme="dark"] .modern-modal-header {
                background: #252525 !important;
                border-bottom-color: #333 !important;
            }
            html[data-darkreader-scheme="dark"] .modern-modal-footer {
                background: #252525 !important;
                border-top-color: #333 !important;
            }
            html[data-darkreader-scheme="dark"] .settings-group {
                background: #252525 !important;
                border-color: #333 !important;
            }
            html[data-darkreader-scheme="dark"] .modern-input, 
            html[data-darkreader-scheme="dark"] .modern-select {
                background: #333 !important;
                color: #d1d1d1 !important;
                border-color: #555 !important;
            }
            html[data-darkreader-scheme="dark"] .modern-range::-webkit-slider-thumb {
                background: #0099ff !important; 
            }
            html[data-darkreader-scheme="dark"] .toggle-switch .slider {
                background-color: #555 !important; 
            }
            html[data-darkreader-scheme="dark"] .toggle-switch input:checked + .slider {
                background-color: #007bff !important; 
            }
            html[data-darkreader-scheme="dark"] .toggle-switch .label-text { 
                color: #d1d1d1 !important; 
            }
            html[data-darkreader-scheme="dark"] .modal-alert-message {
                background-color: #584f3e !important; 
                color: #f7e6b7 !important; 
                border-color: #807357 !important;
            }
        `;
        document.head.appendChild(style);
    }

    

    // --- CSS: For layout adjustment (create frame only) ---
    function injectDashboardLayoutStyles() {
        const style = document.createElement('style');
        style.id = 'dashboard-fullwidth-layout-css';
        document.head.appendChild(style);
    }

    // --- Feature: Toggle layout ---
    function toggleDashboardLayout(enabled) {
        const style = document.getElementById('dashboard-fullwidth-layout-css');
        if (!style) return;

        if (!document.URL.includes('/my/') || document.URL.includes('/my/courses.php')) {
            style.innerHTML = ''; 
            return;
        }

        if (enabled) {
            style.innerHTML = `
                /* 1. Force release page width limit */
                @media (min-width: 992px) {
                    body.limitedwidth #page.drawers .main-inner,
                    .header-maxwidth {
                        max-width: 98% !important; 
                        width: 98% !important;
                        margin-left: auto !important;
                        margin-right: auto !important;
                    }
                }

                /* 2. Dashboard block layout (Grid layout) */
                @media (min-width: 1200px) {
                    #block-region-content {
                        display: grid !important;
                        grid-template-columns: 1fr 1fr !important; 
                        gap: 20px !important;
                        align-items: start !important;
                    }

                    /* --- Block placement specifications --- */

                    /* Priority 1: Announcements (Top, Full width) */
                    section.block_site_announcements,
                    section.block_news_items {
                        grid-column: 1 / -1 !important;
                        order: 1 !important;
                    }

                    /* Priority 2: Left: Custom Timetable */
                    div#customTimetableWidget {
                        grid-column: 1 / 2 !important; 
                        order: 2 !important;
                        margin-bottom: 0 !important;
                        height: auto !important;
                    }

                    /* Priority 3: Right: Timeline */
                    section.block_timeline {
                        grid-column: 2 / 3 !important; 
                        order: 3 !important;
                        margin-bottom: 0 !important;
                        height: auto !important;
                    }
                    /* Adjust timeline content to prevent cutoff */
                    section.block_timeline .card-body {
                        max-height: 600px !important; 
                        overflow-y: auto !important;
                    }

                    /* Priority 4: Other content (Bottom, Full width) */
                    section.block_myoverview,
                    section.block_recentlyaccesseditems,
                    section.block_recentlyaccessedcourses {
                        grid-column: 1 / -1 !important; 
                        order: 10 !important;
                    }

                    /* Priority 5: Calendar at the bottom */
                    section.block_calendar_month {
                        grid-column: 1 / -1 !important; 
                        order: 100 !important; 
                    }
                    
                    /* Disable invisible elements causing layout breakage */
                    #block-region-content > :not(.block):not(#customTimetableWidget) {
                        display: none !important;
                    }
                }
            `;
        } else {
            style.innerHTML = ''; 
        }
    }


    // IV. Storage & Persistence

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
    
    // getBackgroundFile (Loading logic)
    async function getBackgroundFile(backgroundUrl) {
         if (backgroundUrl === 'indexeddb') {
             const fileData = await loadFileFromDB();
             return fileData ? fileData.blob : null;
         }
         return null;
    }

    // --- Settings (Storage) ---
    async function getSettings() {
        // Async retrieve settings from chrome.storage.local
        const storedSettings = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
        const storedDarkmode = await chrome.storage.local.get(DARKMODE_SETTINGS_KEY);
        
        let settings;
        let darkmodeSettings = {};
        
        // Fix: Fast retrieval of latest Dark Mode settings from local storage
        const fastDarkModeMode = localStorage.getItem(DARKMODE_ENABLED_KEY); 

        // 1. Load normal settings
        if (storedSettings[SETTINGS_STORAGE_KEY]) {
            try {
                settings = JSON.parse(storedSettings[SETTINGS_STORAGE_KEY]);
            } catch (e) {
                console.error("Error parsing settings:", e);
                settings = DEFAULT_SETTINGS;
            }
        } else {
            settings = DEFAULT_SETTINGS;
        }

        // 2. Load Dark Mode settings
        if (storedDarkmode[DARKMODE_SETTINGS_KEY]) {
            try {
                darkmodeSettings = JSON.parse(storedDarkmode[DARKMODE_SETTINGS_KEY]);
            } catch (e) {
                console.error("Error parsing darkmode settings:", e);
                darkmodeSettings = {}; 
            }
        }
        
        // 3. [Critical] Prioritize overwriting with fast check values
        if (fastDarkModeMode) {
            darkmodeSettings.darkModeMode = fastDarkModeMode;
        }

        // 4. Merge all settings
        currentSettings = { ...DEFAULT_SETTINGS, ...settings, ...darkmodeSettings };

        // 5. Background URL processing
        if (currentSettings.backgroundUrl === 'indexeddb' || currentSettings.backgroundUrl.startsWith('blob:')) {
             // Load file stored in IndexedDB
             const fileData = await loadFileFromDB(); 
             if (fileData && fileData.url) {
                 currentBG_BlobUrl = fileData.url; 
                 currentSettings.localBackgroundUrl = fileData.url; 
                 currentSettings.backgroundType = fileData.type.startsWith('video/') ? 'video' : 'image';   
                 currentSettings.backgroundUrl = 'indexeddb';
             } else {
                 console.warn("Background file not found in DB. Resetting to none.");
                 currentSettings.backgroundUrl = '';
                 currentSettings.backgroundType = 'none';
             }
        }
        
        return currentSettings;
    }

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
        
        // Separate Dark Mode settings
        const { darkModeMode, darkModeBrightness, darkModeContrast, darkModeGrayscale, darkModeSepia, ...restSettings } = settings;

        // Prepare to save normal settings
        let settingsToSave = { ...restSettings };
        
        // Fix: Prevent overwriting backgroundType
        const originalBackgroundUrl = settingsToSave.backgroundUrl;
        const originalBackgroundType = settingsToSave.backgroundType; // Holds value 'image' or 'video'

        if (originalBackgroundUrl.startsWith('blob:') || originalBackgroundUrl === 'indexeddb') {
            // If local file (via IndexedDB)
            settingsToSave.backgroundUrl = 'indexeddb';
            settingsToSave.backgroundType = originalBackgroundType; // [Keep]
        } else if (originalBackgroundUrl.startsWith('http')) {
            // If external URL specified directly (not in UI but for future)
            settingsToSave.backgroundUrl = originalBackgroundUrl;
            settingsToSave.backgroundType = originalBackgroundType; // [Keep]
        } else {
            // Otherwise (no direct URL or 'none')
            settingsToSave.backgroundUrl = '';
            settingsToSave.backgroundType = 'none';
        }
        
        // Save Dark Mode settings
        const darkmodeSettingsToSave = { darkModeMode, darkModeBrightness, darkModeContrast, darkModeGrayscale, darkModeSepia };
            
        // Fix: Save darkModeMode directly to local storage for fast check
        localStorage.setItem(DARKMODE_ENABLED_KEY, darkModeMode); 

        await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: JSON.stringify(settingsToSave) });
        await chrome.storage.local.set({ [DARKMODE_SETTINGS_KEY]: JSON.stringify(darkmodeSettingsToSave) });

        currentSettings = settings;
    }

    // V. UI Insertion and Events
     
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
                <i class="icon fa fa-cog" aria-hidden="true"></i> </button>
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
            document.body.style.overflow = 'hidden';
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
                            <div class="group-title">Dark Mode (Beta)</div>
                            <div class="input-wrapper">
                                <label>モード</label>
                                <select id="darkModeModeSelect" class="modern-select">
                                    <option value="off" ${settings.darkModeMode === 'off' ? 'selected' : ''}>オフ</option>
                                    <option value="on" ${settings.darkModeMode === 'on' ? 'selected' : ''}>常にオン</option>
                                    <option value="auto" ${settings.darkModeMode === 'auto' ? 'selected' : ''}>システム設定に従う</option>
                                </select>
                            </div>
                            <div class="slider-container">
                                <div class="slider-label">
                                    <span>明るさ (Brightness)</span>
                                    <div class="slider-value-group">
                                        <span id="darkModeBrightnessValue">${settings.darkModeBrightness}</span>%
                                    </div>
                                </div>
                                <input type="range" id="darkModeBrightnessRange" min="0" max="150" value="${settings.darkModeBrightness}" class="modern-range">
                            </div>
                            <div class="slider-container">
                                <div class="slider-label">
                                    <span>コントラスト (Contrast)</span>
                                    <div class="slider-value-group">
                                        <span id="darkModeContrastValue">${settings.darkModeContrast}</span>%
                                    </div>
                                </div>
                                <input type="range" id="darkModeContrastRange" min="0" max="150" value="${settings.darkModeContrast}" class="modern-range">
                            </div>
                            <div class="slider-container">
                                <div class="slider-label">
                                    <span>グレースケール (Grayscale)</span>
                                    <div class="slider-value-group">
                                        <span id="darkModeGrayscaleValue">${settings.darkModeGrayscale}</span>%
                                    </div>
                                </div>
                                <input type="range" id="darkModeGrayscaleRange" min="0" max="100" value="${settings.darkModeGrayscale}" class="modern-range">
                            </div>
                            <div class="slider-container">
                                <div class="slider-label">
                                    <span>セピア (Sepia)</span>
                                    <div class="slider-value-group">
                                        <span id="darkModeSepiaValue">${settings.darkModeSepia}</span>%
                                    </div>
                                </div>
                                <input type="range" id="darkModeSepiaRange" min="0" max="100" value="${settings.darkModeSepia}" class="modern-range">
                            </div>
                        </div>
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
                                <label class="radio-label" style="color:#333;">
                                    <input type="radio" id="bg-type-video" name="bg-type" value="video" ${settings.backgroundType === 'video' ? 'checked' : ''} disabled> 動画
                                </label>
                                <label class="radio-label" style="color:#333;">
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
                            <label class="toggle-switch" style="margin-bottom: 10px;">
                                <input type="checkbox" id="enableCustomLayoutCheckbox" ${settings.enableCustomLayout ? 'checked' : ''}>
                                <span class="slider"></span>
                                <span class="label-text">ダッシュボードのレイアウトを拡張 (PC用)</span>
                            </label>
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

    // --- Modern Modal (Custom Settings Popup) Styles ---
    function injectModernModalStyles() {
        const existingStyle = document.getElementById('modern-modal-css');
        if (existingStyle) existingStyle.remove();

        const style = document.createElement('style');
        style.id = 'modern-modal-css';
        style.innerHTML = `
            /* White base design CSS */
            .modern-modal-overlay { 
                position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
                background-color: rgba(0, 0, 0, 0.5); 
                z-index: 2147483647; 
                display: none; 
                justify-content: center; align-items: center; 
                animation: fadeIn 0.2s ease;
                
                /* 【修正点】イベント透過防止とスクロール連鎖防止 */
                pointer-events: auto !important;
                overscroll-behavior: contain;
            }
            .modern-modal-content { 
                background: #ffffff; 
                color: #333333; 
                border-radius: 12px; width: 95%; max-width: 550px; max-height: 85vh; 
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3); 
                border: 1px solid #e0e0e0; 
                display: flex; flex-direction: column; font-family: 'Segoe UI', sans-serif; 
                overflow: hidden; 
                
                /* 【修正点】コンテンツ自体のイベントを確実に有効化 */
                pointer-events: auto !important;
            }
            /* ... (以下、元のCSSと同じため省略なしで記述する場合は元のコードを使用) ... */
            .modern-modal-header { 
                padding: 15px 25px; 
                background: #f8f9fa; 
                border-bottom: 1px solid #e0e0e0; 
            }
            .modern-modal-header h4 { 
                margin: 0; font-size: 1.5rem; font-weight: 700; 
                color: #0056b3; 
                background: none; -webkit-background-clip: unset; -webkit-text-fill-color: unset; 
            }
            .sub-text { 
                margin: 5px 0 0; font-size: 0.85rem; 
                color: #6c757d; 
            }
            .modern-modal-body { 
                padding: 25px; overflow-y: auto; 
                scrollbar-width: thin; scrollbar-color: #007bff transparent; 
            }
            .modern-modal-body::-webkit-scrollbar { width: 8px; }
            .modern-modal-body::-webkit-scrollbar-thumb { background-color: #007bff; border-radius: 4px; }
            
            .settings-group { 
                background: #f8f8f8; 
                border-radius: 8px; padding: 15px; margin-bottom: 15px; 
                border: 1px solid #e0e0e0; 
            }
            .group-title { 
                font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px; 
                color: #007bff; 
                margin-bottom: 10px; font-weight: 600; 
            }
            .input-wrapper { margin-bottom: 15px; }
            .input-wrapper label { 
                display: block; font-size: 0.9rem; margin-bottom: 5px; 
                color: #555; 
            }
            .modern-input, .modern-select { 
                width: 100%; padding: 8px 12px; 
                background: #ffffff; 
                border: 1px solid #ccc; 
                border-radius: 6px; 
                color: #333; 
                transition: border-color 0.2s; 
            }
            .modern-input:focus, .modern-select:focus { 
                outline: none; 
                border-color: #007bff; 
                background: #fff; 
            }
            .modern-select option { 
                background-color: #ffffff; 
                color: #333; 
            }
            .color-picker-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
            .color-item { text-align: center; }
            .color-item label { font-size: 0.75rem; display: block; margin-bottom: 5px; color: #777; }
            .color-wrapper { height: 35px; border-radius: 6px; overflow: hidden; border: 1px solid #ccc; cursor: pointer; }
            input[type="color"] { width: 100%; height: 100%; padding: 0; border: none; background: none; cursor: pointer; transform: scale(1.5); }
            .slider-container { margin-top: 15px; }
            .slider-label { display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; color: #333; margin-bottom: 8px; width: 100%; }
            .slider-value-group { display: inline-flex; align-items: center; justify-content: flex-end; gap: 2px; font-family: monospace; font-size: 1.1em; color: #007bff; }
            .modern-range { -webkit-appearance: none; width: 100%; height: 4px; background: #ccc; border-radius: 2px; outline: none; }
            .modern-range::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; background: #007bff; border-radius: 50%; cursor: pointer; box-shadow: 0 0 8px rgba(0, 119, 255, 0.5); transition: transform 0.1s; }
            .modern-range::-webkit-slider-thumb:hover { transform: scale(1.2); }
            
            .modern-modal-footer { 
                padding: 15px 25px; 
                background: #f8f9fa; 
                border-top: 1px solid #e0e0e0; 
                display: flex; justify-content: flex-end; gap: 10px; 
            }
            .modern-btn { padding: 8px 20px; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 0.9rem; }
            .primary-btn { 
                background: linear-gradient(135deg, #007bff 0%, #00b7ff 100%); 
                color: white; 
            }
            .secondary-btn { 
                background: #e0e0e0; 
                color: #333; 
            }
            .secondary-btn:hover { background: #ccc; color: #000; }
            .status-text { font-size: 0.8rem; color: #777; margin-bottom: 15px; text-align: center; }
            .toggle-switch .slider { background-color: #ccc; } 
            .toggle-switch .slider:before { background-color: white; }
            .toggle-switch input:checked + .slider { background-color: #007bff; } 
            .toggle-switch .label-text { color: #333; }
            .modern-text-btn.danger { color: #dc3545; } 
            
            .full-width { width: 100%; margin-bottom: 10px; text-align: center; }
            .modern-text-btn { background: none; border: none; cursor: pointer; font-size: 0.85rem; padding: 5px; border-radius: 4px; }
            
            .toggle-switch { display: flex; align-items: center; cursor: pointer; user-select: none; }
            .toggle-switch input { display: none; }
            .toggle-switch .slider { width: 36px; height: 20px; background-color: #ccc; border-radius: 20px; position: relative; margin-right: 10px; }
            .toggle-switch .slider:before { content: ""; position: absolute; height: 14px; width: 14px; left: 3px; bottom: 3px; background-color: white; border-radius: 50%; transition: .2s; }
            .toggle-switch input:checked + .slider { background-color: #0077ff; }
            .toggle-switch input:checked + .slider:before { transform: translateX(16px); }
            .toggle-switch .label-text { color: #333; font-size: 0.9rem; }
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
        
        const videoLabel = bgVideoRadio.closest('label');
        const imageLabel = bgImageRadio.closest('label');
        if (videoLabel) videoLabel.style.color = '#333';
        if (imageLabel) imageLabel.style.color = '#333';
        
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
        document.getElementById('enableCustomLayoutCheckbox').checked = settings.enableCustomLayout;

        document.getElementById('contentOpacityRange').value = settings.contentOpacity;
        document.getElementById('contentOpacityValue').textContent = settings.contentOpacity;

        document.getElementById('fontFamilySelect').value = settings.fontFamily || 'default';
        document.getElementById('customFontNameInput').value = settings.customFontName || '';
        document.getElementById('customFontUrlInput').value = settings.customFontUrl || ''; 

        // Load Dark Mode settings
        document.getElementById('darkModeModeSelect').value = settings.darkModeMode;
        document.getElementById('darkModeBrightnessRange').value = settings.darkModeBrightness;
        document.getElementById('darkModeBrightnessValue').textContent = settings.darkModeBrightness;
        document.getElementById('darkModeContrastRange').value = settings.darkModeContrast;
        document.getElementById('darkModeContrastValue').textContent = settings.darkModeContrast;
        document.getElementById('darkModeGrayscaleRange').value = settings.darkModeGrayscale;
        document.getElementById('darkModeGrayscaleValue').textContent = settings.darkModeGrayscale;
        document.getElementById('darkModeSepiaRange').value = settings.darkModeSepia;
        document.getElementById('darkModeSepiaValue').textContent = settings.darkModeSepia;
    }

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
    
    // Dark Mode settings preview application function
    function applyDarkmodePreview() {
         const modeSelect = document.getElementById('darkModeModeSelect');
         const brightnessRange = document.getElementById('darkModeBrightnessRange');
         const contrastRange = document.getElementById('darkModeContrastRange');
         const grayscaleRange = document.getElementById('darkModeGrayscaleRange');
         const sepiaRange = document.getElementById('darkModeSepiaRange');

         const newSettings = {
             darkModeMode: modeSelect.value,
             darkModeBrightness: parseInt(brightnessRange.value),
             darkModeContrast: parseInt(contrastRange.value),
             darkModeGrayscale: parseInt(grayscaleRange.value),
             darkModeSepia: parseInt(sepiaRange.value)
         };
         
         document.getElementById('darkModeBrightnessValue').textContent = newSettings.darkModeBrightness;
         document.getElementById('darkModeContrastValue').textContent = newSettings.darkModeContrast;
         document.getElementById('darkModeGrayscaleValue').textContent = newSettings.darkModeGrayscale;
         document.getElementById('darkModeSepiaValue').textContent = newSettings.darkModeSepia;
         
         applyDarkmodeStyle({ ...currentSettings, ...newSettings });
    }

    function bindSettingsModalEvents() {
        const modal = document.getElementById('custom-settings-modal');
        const saveBtn = document.getElementById('saveSettingsBtn');
        const closeBtn = document.getElementById('closeSettingsModal');
        const resetBtn = document.getElementById('resetSettingsBtn');
        
        const headerBgInput = document.getElementById('headerBgColorInput');
        const headerTextInput = document.getElementById('headerTextColorInput');
        const headerStrokeInput = document.getElementById('headerStrokeColorInput');
        const opacityRange = document.getElementById('opacityRange');
        const brightnessRange = document.getElementById('brightnessRange');
        const contentOpacityRange = document.getElementById('contentOpacityRange');
        const fontSelect = document.getElementById('fontFamilySelect');
        const customFontInput = document.getElementById('customFontNameInput');
        const customFontUrlInput = document.getElementById('customFontUrlInput');
        const fileInput = document.getElementById('backgroundFileInput');
        const selectFileBtn = document.getElementById('selectBackgroundBtn');
        const layoutCheckbox = document.getElementById('enableCustomLayoutCheckbox');
        
        // Dark Mode related elements
        const modeSelect = document.getElementById('darkModeModeSelect');
        const dmBrightnessRange = document.getElementById('darkModeBrightnessRange');
        const dmContrastRange = document.getElementById('darkModeContrastRange');
        const dmGrayscaleRange = document.getElementById('darkModeGrayscaleRange');
        const dmSepiaRange = document.getElementById('darkModeSepiaRange');

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

        opacityRange.addEventListener('input', applyBackgroundPreview);
        brightnessRange.addEventListener('input', applyBackgroundPreview);
        
        // Dark Mode preview events (immediate application on input, change)
        modeSelect.addEventListener('change', applyDarkmodePreview);
        dmBrightnessRange.addEventListener('input', applyDarkmodePreview);
        dmContrastRange.addEventListener('input', applyDarkmodePreview);
        dmGrayscaleRange.addEventListener('input', applyDarkmodePreview);
        dmSepiaRange.addEventListener('input', applyDarkmodePreview);

        if (contentOpacityRange) {
             contentOpacityRange.addEventListener('input', (e) => {
                 document.getElementById('contentOpacityValue').textContent = e.target.value;
                 applyContentOpacityStyle(parseInt(e.target.value));
             });
        }
        
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
                     e.target.value = ''; 
                 }
            });
        }

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
                    enableCustomLayout: layoutCheckbox.checked,
                    contentOpacity: parseInt(contentOpacityRange.value),
                    fontFamily: document.getElementById('fontFamilySelect').value,
                    customFontName: document.getElementById('customFontNameInput').value,
                    customFontUrl: document.getElementById('customFontUrlInput').value,
                    // Dark Mode settings to save
                    darkModeMode: modeSelect.value,
                    darkModeBrightness: parseInt(dmBrightnessRange.value),
                    darkModeContrast: parseInt(dmContrastRange.value),
                    darkModeGrayscale: parseInt(dmGrayscaleRange.value),
                    darkModeSepia: parseInt(dmSepiaRange.value)
                };
                
                await saveSettings(newSettings);
                modal.style.display = 'none';
                document.body.style.overflow = '';
                applyAllCustomStyles(true); 
            });
        }
        if (closeBtn) {
            closeBtn.addEventListener('click', async () => {
                const settings = await getSettings(); 
                applyHeaderStyles(settings); 
                applyBackgroundStyle(settings);
                applyContentOpacityStyle(settings.contentOpacity);
                applyFontStyle(settings); 
                applyDarkmodeStyle(settings); // Revert to saved Dark Mode settings
                toggleDashboardLayout(settings.enableCustomLayout);
                modal.style.display = 'none';
                document.body.style.overflow = '';
            });
        }

        const modalContent = document.getElementById('custom-settings-content');
        if (modalContent) {
            modalContent.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }

        if (resetBtn) {
            resetBtn.addEventListener('click', async () => {
                const userConfirmed = confirm('全てのカスタム設定を初期値に戻しますか？（時間割の内容はリセットされません）');
                if (userConfirmed) {
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
                    
                    // Disable DarkReader
                    loadDarkReader({ darkModeMode: 'off' });

                    await saveSettings(DEFAULT_SETTINGS);
                    loadSettingsToForm(DEFAULT_SETTINGS);
                    applyAllCustomStyles(true); 
                    alert('カスタム設定をリセットし、反映しました。');
                }
            });
        }
    }

        function bindFoucProtectionOnNavigation() {
    // Function to apply FOUC mask
    const applyMask = () => {
        document.documentElement.classList.add("dark-fouc-mask");
        // Force scroll to top
        window.scrollTo(0, 0); 
    };

    // Get main Moodle navigation elements
    const selectors = [
        'a[href*="course/view.php"]', // Course links
        'a[href*="/my/"]',            // Dashboard links
        'a[href*="/mod/"]',           // Activity links
        '#nav-drawer a',              // Nav drawer links
        '.list-group-item-action',    // List item links
        '.navbar-nav .nav-link',      // Header links
        'a.btn'                       // Button style links
    ];

    // Watch entire DOM to pick up lazy-loaded elements
    document.addEventListener('click', (event) => {
        let target = event.target.closest(selectors.join(','));
        
        if (target && target.tagName === 'A') {
            const href = target.getAttribute('href');
            // Ensure not an anchor or JS execution link within the same page
            if (href && !href.startsWith('#') && !href.startsWith('javascript')) {
                // Execute mask processing only if Dark Mode is enabled
                if (document.documentElement.classList.contains("dark-fouc-mask") || 
                    currentSettings.darkModeMode === 'on' || 
                    (currentSettings.darkModeMode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
                ) {
                    applyMask();
                    // Allow default click action to proceed
                }
            }
        }
    }, true); // Capture event in capturing phase
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

             currentSettings.backgroundUrl = blobUrl;
             currentSettings.backgroundType = type;
             
             applyBackgroundPreview();
             
             const modal = document.getElementById('custom-settings-modal');
             if (modal && modal.style.display === 'flex') {
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


    // VI. Dynamic Style Application

    async function applyAllCustomStyles(reloadSettings = true) {
        if(reloadSettings) { 
            await getSettings();
        }

        const settings = currentSettings;
        applyFontStyle(settings);
        injectBackgroundElements(); 
        applyHeaderStyles(settings); 
        applyBackgroundStyle(settings);
        applyContentOpacityStyle(settings.contentOpacity);
        applyDarkmodeStyle(settings); // Apply Dark Mode itself
        
        injectDarkModeFixupStyles(); 
        
        toggleDashboardLayout(settings.enableCustomLayout);
        await renderTimetableWidget(); 

        document.body.style.setProperty('visibility', 'visible', 'important');

        // Dark Reader適用完了後、ローディング画面を削除
        removeCustomLoadingScreen();
    }
    
    // Call global function
    function applyDarkmodeStyle(settings) {
       // loadDarkReader calls global function
       loadDarkReader(settings);
    }

    function applyFontStyle(settings) {
        let fontStyle = document.getElementById('custom-font-style');
        if (!fontStyle) {
            fontStyle = document.createElement('style');
            fontStyle.id = 'custom-font-style';
            (document.head || document.documentElement).appendChild(fontStyle);
        }

        const fontMap = {
            "default": { name: "", url: "" }, 
            "meiryo": { name: '"Meiryo", "メイリオ", "Hiragino Kaku Gothic ProN", sans-serif', url: "" },
            "yugothic": { name: '"Yu Gothic", "游ゴシック", "YuGothic", sans-serif', url: "" },
            "biz-gothic": { name: '"BIZ UDPGothic", "BIZ UDPゴシック", sans-serif', url: "" },
            "notosans": { name: '"Noto Sans JP", sans-serif', url: "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap" },
            "zenmaru": { name: '"Zen Maru Gothic", sans-serif', url: "https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@500;700&display=swap" },
            "sawarabi": { name: '"Sawarabi Mincho", serif', url: "https://fonts.googleapis.com/css2?family=Sawarabi+Mincho&display=swap" },
            "mochiy": { name: '"Mochiy Pop One", sans-serif', url: "https://fonts.googleapis.com/css2?family=Mochiy+Pop+One&display=swap" },
            "dotgothic": { name: '"DotGothic16", sans-serif', url: "https://fonts.googleapis.com/css2?family=DotGothic16&display=swap" },
            "rampart": { name: '"Rampart One", cursive', url: "https://fonts.googleapis.com/css2?family=Rampart+One&display=swap" },
        };

        let selectedFontFamily = "";
        let importUrl = "";

        if (settings.customFontName && settings.customFontName.trim() !== "") {
            selectedFontFamily = `"${settings.customFontName}", sans-serif`;
            if (settings.customFontUrl && settings.customFontUrl.trim() !== "") {
                importUrl = settings.customFontUrl;
            }
        } else if (fontMap[settings.fontFamily]) {
            selectedFontFamily = fontMap[settings.fontFamily].name;
            importUrl = fontMap[settings.fontFamily].url;
        }

        let cssContent = "";

        if (selectedFontFamily) {
            if (importUrl) {
                cssContent += `@import url('${importUrl}');\n`;
            }
            cssContent += `
                body, div, p, span, a, li, td, th, h1, h2, h3, h4, h5, h6, button, input, textarea, select, .block, .card {
                    font-family: ${selectedFontFamily} !important;
                }
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
                line-height: 16px !important;
                letter-spacing: 0.5px !important;
                text-shadow: none !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                min-width: 16px !important;
                height: 16px !important;
                padding: 0 4px !important;
                border-radius: 10px !important;
                box-sizing: border-box !important;
            }
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

        const dimOverlay = document.getElementById('background-dim-overlay'); 
        
        const body = document.querySelector(BODY_SELECTOR);

        if (!body) return; 

        body.style.overflowX = 'hidden';
        const opacityValue = settings.opacity / 100;
        let overlayColor = 'rgba(0,0,0,0)';

        if (dimOverlay) {
            if (settings.brightness < 100) {
                const alpha = (100 - settings.brightness) / 100;
                overlayColor = `rgba(0, 0, 0, ${alpha})`;
            } else if (settings.brightness > 100) {
                const alpha = Math.min((settings.brightness - 100) / 100, 1);
                overlayColor = `rgba(255, 255, 255, ${alpha})`;
            }
            dimOverlay.style.backgroundColor = overlayColor;
        }
        
        // Determine background file URL (blob URL preferred, otherwise original URL)
        const finalBackgroundUrl = settings.localBackgroundUrl || settings.backgroundUrl;
        
        // [Fix]: 
        // 1. If background is "none" or file selected but not yet saved (blob URL missing), hide everything and exit
        if (!finalBackgroundUrl || finalBackgroundUrl === 'indexeddb' && !settings.localBackgroundUrl) {
            if (video) video.style.display = 'none';
            if (imageContainer) imageContainer.style.display = 'none';
            return; 
        }

        if (video && imageContainer) {
            if (settings.backgroundType === 'video' && finalBackgroundUrl) {
                video.src = finalBackgroundUrl; 
                video.style.display = 'block';
                video.style.opacity = opacityValue.toString();
                video.style.filter = 'none'; 
                
                imageContainer.style.display = 'none';
                imageContainer.style.backgroundImage = 'none';
            } else if (settings.backgroundType === 'image' && finalBackgroundUrl) {
                imageContainer.style.backgroundImage = `url("${finalBackgroundUrl}")`;
                imageContainer.style.display = 'block';
                imageContainer.style.opacity = opacityValue.toString();
                
                imageContainer.style.filter = `brightness(${settings.brightness / 100})`;
                
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
                transition: opacity 0.5s ease;
                will-change: transform, opacity;
                transform: translate3d(0, 0, 0); 
                backface-visibility: hidden;   
                pointer-events: none;       
            `;
            document.body.prepend(video);
            video.oncanplaythrough = () => { video.play().catch(e => console.warn("Video autoplay blocked:", e)); };
            video.onerror = (e) => {
                if (currentSettings.backgroundUrl.startsWith('blob:') && currentSettings.backgroundType === 'video') {
                    console.error("Failed to load background VIDEO (Blob/IndexedDB).", e);
                }
            };
        }

        if (!document.getElementById('background-dim-overlay')) {
            const overlay = document.createElement('div');
            overlay.id = 'background-dim-overlay';
            overlay.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                pointer-events: none; z-index: -99; display: block;
                transition: background-color 0.3s ease;
            `;
            document.body.prepend(overlay);
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

        const widgetOpacity = opacityRatio; 
        const mainWrapperOpacity = opacityRatio;

        // Color definitions
        const lightColor = '255, 255, 255';
        const darkColor = '24, 26, 27'; 

        const lightBlockBg = `rgba(${lightColor}, ${opacityRatio})`;
        const darkBlockBg = `rgba(${darkColor}, ${opacityRatio})`;
        const lightWidgetBg = `rgba(${lightColor}, ${widgetOpacity})`;
        const darkWidgetBg = `rgba(${darkColor}, ${widgetOpacity})`;
        const lightWrapperBg = `rgba(${lightColor}, ${mainWrapperOpacity})`;
        const darkWrapperBg = `rgba(${darkColor}, ${mainWrapperOpacity})`;

        // Selector definitions
        const blockSelectors = `
             .block:not(#customTimetableWidget) .card-body,
             .block:not(#customTimetableWidget) .card:not(.custom-card-style),
             .block:not(#customTimetableWidget),
             .course-section .section-item,
             .list-group-item,
             .list-group-item.list-group-item-action:active,
             .block-myoverview .dropdown-menu,
             .block_calendar_month .calendarmonth,
             #customTimetableWidget .card-body,
             .header.d-flex.flex-wrap.p-1,
             .input-group.searchbar.w-100,
             .mb-1.me-1.flex-grow-1,
             .col-md-6.col-sm-8.col-12.mb-1.d-flex.justify-content-end.nav-search,
             #calendar-course-filter-1,
             .sr-only
        `;
        
        const widgetCardSelectors = `
            .card.custom-card-style, 
            .block.card.custom-card-style
        `;

        contentStyle.innerHTML = `
            /* =========================================
               1. Light Mode (Default) Settings
               ========================================= */
            .main-inner {
                background-color: ${lightWrapperBg} !important;
                border-radius: 8px;
                box-shadow: 0 0 15px rgba(0,0,0,0.1);
            }
            ${blockSelectors} { 
                background-color: ${lightBlockBg} !important;
            }
            ${widgetCardSelectors} {
                background-color: ${lightWidgetBg} !important;
                border: 1px solid rgba(255, 255, 255, 0.9) !important;
            }

            /* Fix quiz option alignment (Centering with Flexbox) */
            .que .answer div.r0, 
            .que .answer div.r1 {
                display: flex !important;
                align-items: center !important; /* Vertical center alignment */
                margin-bottom: 6px !important;
            }
            .que .answer input[type="radio"], 
            .que .answer input[type="checkbox"] {
                margin-top: 0 !important;
                margin-bottom: 0 !important;
                margin-right: 8px !important; /* Spacing from label */
                cursor: pointer;
            }
            .que .answer label {
                margin-bottom: 0 !important;
                line-height: 1.4 !important;
                cursor: pointer;
                padding-top: 2px !important; /* Font tweak */
            }

            /* Empty cells in timetable */
            .timetable-empty-cell {
                color: #ccc;
                font-size: 1.2em;
                display: block;
                text-align: center;
            }

            /* Deadline card design in timetable */
            .timetable-deadline-container {
                margin-top: 6px;
                display: flex;
                flex-direction: column;
                gap: 4px;
                max-width: 100%;
                overflow: hidden; 
            }

            .timetable-deadline-card {
                background-color: rgba(255, 255, 255, 0.7);
                border-left: 3px solid #ccc;
                padding: 4px 6px;
                border-radius: 0 4px 4px 0;
                font-size: 0.85em;
                box-shadow: 0 1px 2px rgba(0,0,0,0.05);
                max-width: 100%; 
                overflow: hidden;
            }
            .deadline-row-top {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 2px;
                min-width: 0; 
            }
            .deadline-name {
                font-weight: bold;
                color: #333;
                font-size: 0.95em;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 100%;
                display: block; 
                flex: 1; /* 余白を埋める */
            }
            .deadline-row-bottom {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 0.85em;
                margin-top: 2px;
            }
            .deadline-date {
                color: #888;
                font-size: 0.8em;
                white-space: nowrap;
                margin-left: 5px;
            }

            /* Timer color settings (Light Mode) */
            .timer-safe { color: #00796b !important; font-weight: bold; } 
            .timer-warning { color: #f9a825 !important; font-weight: bold; } 
            .timer-danger { color: #e64a19 !important; font-weight: bold; } 
            .timer-critical { color: #d32f2f !important; font-weight: 900; } 
            .timer-expired { color: #757575 !important; }

            .timetable-deadline-card:has(.timer-safe) { border-left-color: #00796b; }
            .timetable-deadline-card:has(.timer-warning) { border-left-color: #f9a825; }
            .timetable-deadline-card:has(.timer-danger) { border-left-color: #e64a19; }
            .timetable-deadline-card:has(.timer-critical) { border-left-color: #d32f2f; }


            /* =========================================
               2. Dark Mode (Enabled via Dark Reader) Settings
               ========================================= */
            html[data-darkreader-scheme="dark"] .main-inner {
                background-color: ${darkWrapperBg} !important;
                box-shadow: none !important;
            }
            
            html[data-darkreader-scheme="dark"] .block:not(#customTimetableWidget) .card-body,
            html[data-darkreader-scheme="dark"] .block:not(#customTimetableWidget) .card:not(.custom-card-style),
            html[data-darkreader-scheme="dark"] .block:not(#customTimetableWidget),
            html[data-darkreader-scheme="dark"] .course-section .section-item,
            html[data-darkreader-scheme="dark"] .list-group-item,
            html[data-darkreader-scheme="dark"] .list-group-item.list-group-item-action:active,
            html[data-darkreader-scheme="dark"] .block-myoverview .dropdown-menu,
            html[data-darkreader-scheme="dark"] .block_calendar_month .calendarmonth,
            html[data-darkreader-scheme="dark"] #customTimetableWidget .card-body,
            html[data-darkreader-scheme="dark"] .header.d-flex.flex-wrap.p-1,
            html[data-darkreader-scheme="dark"] .input-group.searchbar.w-100,
            html[data-darkreader-scheme="dark"] .mb-1.me-1.flex-grow-1,
            html[data-darkreader-scheme="dark"] .col-md-6.col-sm-8.col-12.mb-1.d-flex.justify-content-end.nav-search,
            html[data-darkreader-scheme="dark"] #calendar-course-filter-1,
            html[data-darkreader-scheme="dark"] .sr-only {
                background-color: ${darkBlockBg} !important;
                color: #e8e6e3 !important; 
            }

            html[data-darkreader-scheme="dark"] .card.custom-card-style, 
            html[data-darkreader-scheme="dark"] .block.card.custom-card-style {
                background-color: ${darkWidgetBg} !important;
                border: 1px solid rgba(255, 255, 255, 0.2) !important;
            }

            /* Dark Mode Text Color Fix */
            
            html[data-darkreader-scheme="dark"] #customTimetableWidget {
                 color: #e0e0e0 !important;
            }
            
            html[data-darkreader-scheme="dark"] .timetable-deadline-card {
                background-color: rgba(50, 50, 50, 0.7) !important;
                border-left: 3px solid #777 !important;
            }
            html[data-darkreader-scheme="dark"] #customTimetableWidget .deadline-name {
                color: #ffffff !important; 
            }
            html[data-darkreader-scheme="dark"] #customTimetableWidget a {
                color: #82b1ff !important;
            }
            
            html[data-darkreader-scheme="dark"] #customTimetableTable th,
            html[data-darkreader-scheme="dark"] #customTimetableTable td {
                color: #cccccc !important;
                border-bottom: 1px solid #444 !important;
            }
             html[data-darkreader-scheme="dark"] #customTimetableTable tr[style*="background-color: #f8f9fa"] {
                background-color: rgba(255, 255, 255, 0.05) !important;
            }

            html[data-darkreader-scheme="dark"] #customTimetableWidget .deadline-date {
                color: #aaa !important;
            }
            
            /* Dim hyphens in empty cells */
            html[data-darkreader-scheme="dark"] .timetable-empty-cell {
                color: #555 !important;
            }

            /* Timer color settings (Dark Mode) */
            html[data-darkreader-scheme="dark"] #customTimetableWidget .timer-safe { color: #80cbc4 !important; }
            html[data-darkreader-scheme="dark"] #customTimetableWidget .timer-warning { color: #fff176 !important; }
            html[data-darkreader-scheme="dark"] #customTimetableWidget .timer-danger { color: #ff8a80 !important; } 
            html[data-darkreader-scheme="dark"] #customTimetableWidget .timer-critical { color: #ff5252 !important; } 
            
            html[data-darkreader-scheme="dark"] .timetable-deadline-card:has(.timer-safe) { border-left-color: #80cbc4 !important; }
            html[data-darkreader-scheme="dark"] .timetable-deadline-card:has(.timer-warning) { border-left-color: #fff176 !important; }
            html[data-darkreader-scheme="dark"] .timetable-deadline-card:has(.timer-danger) { border-left-color: #ff8a80 !important; }
            html[data-darkreader-scheme="dark"] .timetable-deadline-card:has(.timer-critical) { border-left-color: #ff5252 !important; }


            html[data-darkreader-scheme="dark"] .deadline-highlight {
                background-color: rgba(100, 20, 20, 0.5) !important; 
                border: 1px solid #ff6b6b !important; 
                box-shadow: 0 0 10px rgba(255, 50, 50, 0.2) !important;
                color: #ffcccc !important; 
            }

        
            /*3. Forced Transparency Areas (Common)*/

            .bg-white,
            .navbar, 
            .secondary-navigation,
            .primary-navigation,
            .nav.more-nav,
            .nav-tabs .nav-link,
            .nav-tabs .nav-item,
            .course-tabs,
            .context-header-settings-menu,
            .usermenu .dropdown-menu,
            .course-content, 
            #page-content,
            #page,
            #page-wrapper,
            .main-content,
            #region-main,
            .pagelayout-mydashboard #region-main, 
            #region-main-box > div:first-child,
            .pagelayout-incourse .nav-tabs, 
            .btn.btn-icon:not(.custom-card-style),
            .coursemenubtn,
            .activityiconcontainer,
            .card-footer, 
            .page-item, 
            .pagination.mb-0, 
            .pagination,
            .card-body.pe-1.course-info-container,
            .form-control.withclear.rounded,
            .w-100
             {
                background-color: transparent !important;
            }
            
            html[data-darkreader-scheme="dark"] .bg-white,
            html[data-darkreader-scheme="dark"] .navbar,
            html[data-darkreader-scheme="dark"] #page,
            html[data-darkreader-scheme="dark"] #region-main,
            html[data-darkreader-scheme="dark"] .w-100 {
                background-color: transparent !important;
            }

            .section {
                 border-bottom: none !important;
                 margin-bottom: 1rem !important; 
            }
            .section-item {
                border: 1px solid rgba(0, 0, 0, 0.05) !important;
            }
           
            html[data-darkreader-scheme="dark"] .section-item {
                border: 1px solid rgba(255, 255, 255, 0.1) !important;
            }

            html[data-darkreader-scheme="dark"] #customTimetableTable thead tr,
            html[data-darkreader-scheme="dark"] #customTimetableTable th,
            html[data-darkreader-scheme="dark"] #customTimetableTable td:first-child {
                background-color: transparent !important;
            }
        `;
    }


    // VII. Timetable Feature

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
        }
        return timetable || DEFAULT_TIMETABLE;
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
            <div style="padding: 12px 15px;">
                <h4 style="margin-top: 0; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; font-size: 1.1rem; border-bottom: 2px solid #eee; padding-bottom: 8px;">
                    週間時間割
                    <button id="editTimetableBtn" style="font-size: 0.75em; padding: 5px 10px; border: 1px solid #ddd; background-color: #fff; cursor: pointer; border-radius: 4px; color: #555; transition: all 0.2s;">編集</button>
                </h4>
                <div style="font-size: 0.9em; font-weight: bold; margin-bottom: 15px;">
                    現在:
                    ${currentStatus === '授業中' ?
                        `<span style="color: #dc3545;">${currentPeriod}講時 - ${currentCourse.name}</span> <a href="${createCourseDirectUrl(currentCourse.id)}" target="_self" style="font-size: 0.85em; margin-left: 10px; color: #007bff; text-decoration: none;">[コースへ]</a>` :
                        `<span style="color: #6c757d;">${currentStatus} ${currentPeriod ? `(${currentPeriod}講時)` : ''}</span>`
                    }
                </div>
                <table id="customTimetableTable" style="table-layout: fixed; width: 100%; border-collapse: separate; border-spacing: 0; text-align: left; font-size: 0.9em; border: 1px solid #eee; border-radius: 6px; overflow: hidden;">
                    <thead>
                        <tr style="">
                            <th style="padding: 8px; border-bottom: 1px solid #ddd; white-space: nowrap; color: #555; width: 7%;">時間</th>
                            ${DAY_MAP.slice(1, 6).map(day =>
                                `<th style="padding: 8px; border-bottom: 1px solid #ddd; text-align:center; width: 18.6%; color: #555; ${day === currentDayName ? 'background-color: rgba(220, 53, 69, 0.08); color: #dc3545; font-weight:bold;' : ''}">${day}</th>`
                            ).join('')}
                        </tr>
                    </thead>
                    <tbody>
        `;

        for (const periodTime of CLASS_TIMES) {
            const period = periodTime.period.toString();
            
            // Format start and end times
            const startH = Math.floor(periodTime.start / 100);
            const startM = (periodTime.start % 100).toString().padStart(2, '0');
            const endH = Math.floor(periodTime.end / 100);
            const endM = (periodTime.end % 100).toString().padStart(2, '0');
            const timeStr = `${startH}:${startM}～${endH}:${endM}`;
            
           htmlContent += `<tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-size: 0.85em; color: #777; background-color: transparent; white-space: nowrap;">${period}<br><span style="font-size:0.8em; opacity:0.8;">(${timeStr})</span></td>`;
            for (let i = 1; i <= 5; i++) {
                const dayName = DAY_MAP[i];
                const course = timetable[dayName] ? timetable[dayName][period] : null;
                const isCurrent = dayName === currentDayName && period === currentPeriod;
                
                const cellStyle = isCurrent 
                    ? 'padding: 6px; background-color: rgba(230, 240, 255, 0.5); border-bottom: 1px solid #ddd; position: relative; vertical-align: top;' 
                    : 'padding: 6px; border-bottom: 1px solid #eee; position: relative; vertical-align: top;';

                htmlContent += `<td style="${cellStyle}">`;
                if (course) {
                    htmlContent += `<a href="${createCourseDirectUrl(course.id)}" target="_self" title="${course.name}" style="color: #0d6efd; text-decoration: none; display:block; font-weight: 600; font-size: 0.95em; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${course.name}</a>`;

                    const nTimetableName = normalizeCourseName(course.name);
                    const safeDeadlines = deadlines || [];

                    const relevantDeadlines = safeDeadlines
                        .filter(d => {
                            const nDeadlineName = normalizeCourseName(d.courseName);
                            return nDeadlineName.includes(nTimetableName) || nTimetableName.includes(nDeadlineName);
                        })
                        .sort((a, b) => a.dueTimestamp - b.dueTimestamp); 

                    if (relevantDeadlines.length > 0) {
                        htmlContent += `<div class="timetable-deadline-container">`;
                        relevantDeadlines.forEach(deadline => {
                           htmlContent += `
                                <div class="timetable-deadline-card">
                                    <div class="deadline-row-top">
                                        <span class="deadline-name" title="${deadline.assignmentName}">${deadline.assignmentName}</span>
                                    </div>
                                    <div class="deadline-row-bottom">
                                        <span class="custom-countdown-timer deadline-timer" data-due-timestamp="${deadline.dueTimestamp}"></span>
                                        <span class="deadline-date">${deadline.dueDateString}まで</span>
                                    </div>
                                </div>`;
                        });
                        htmlContent += '</div>';
                    }

                } else {
                    htmlContent += `<span class="timetable-empty-cell">-</span>`;
                }
                htmlContent += `</td>`;
            }
            htmlContent += `</tr>`;
        }
        htmlContent += `
                    </tbody>
                </table>
            </div>
        `;
        return htmlContent;
    }

    async function renderTimetableWidget() {
        // If not dashboard or display setting is OFF, remove and exit
        if (!document.URL.includes('/my/') || !currentSettings.showTimetable) {
            const existingWidget = document.getElementById('customTimetableWidget');
            if (existingWidget) existingWidget.remove();
            return;
        }

        let widgetContainer = document.getElementById('customTimetableWidget');
        // Parent element to insert timetable (block container in main dashboard area)
        const targetParent = document.querySelector(DASHBOARD_REGION_SELECTOR); 

        if (!targetParent) {
             // Dashboard content area not yet loaded or running on course page
             return; 
        }

        if (!widgetContainer) {
            widgetContainer = document.createElement('div');
            widgetContainer.id = 'customTimetableWidget';
            widgetContainer.classList.add('card', 'mb-3', 'block', 'custom-card-style'); // blockクラスを追加
            widgetContainer.style.cssText = 'box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2); position: relative;';
            
            // Insert: Before timeline block or at top of block container
            const timelineBlock = document.querySelector('.block_timeline');
            if (timelineBlock) {
                 targetParent.insertBefore(widgetContainer, timelineBlock);
            } else {
                 targetParent.prepend(widgetContainer);
            }
        }
        
        // Ensure timetable content is rendered before layout update
        const timetable = await getTimetable();
        let cardBody = widgetContainer.querySelector('.card-body');
        
        if (!cardBody) {
             cardBody = document.createElement('div');
             cardBody.classList.add('card-body');
             widgetContainer.appendChild(cardBody);
        }
        
        cardBody.innerHTML = generateWeeklyTimetableHtml(timetable, timelineDeadlines);
        startCountdownTimers(); 
        
        const editBtn = document.getElementById('editTimetableBtn');
        if (editBtn) {
            editBtn.addEventListener('click', async () => {
                scanCoursesFromPage();
                let modal = document.getElementById('timetable-modal');
                if (modal) modal.remove();
                const latestTimetable = await getTimetable();
                injectEditModal(latestTimetable);
                document.getElementById('timetable-modal').style.display = 'flex';
            });
        }
        
        // Re-apply CSS to apply transparency to new widget
        applyContentOpacityStyle(currentSettings.contentOpacity); 
    }

    // --- Timetable Edit Modal (Suggest & Export/Import) ---
    function generateEditModalHtml(timetable) {
        const days = DAY_MAP.slice(1, 6); 
        const periods = CLASS_TIMES.map(t => t.period.toString());
        let bodyHtml = `
            <div class="modal-alert-message">
                <strong>予測変換の候補が少ない場合:</strong>
                <p style="margin: 5px 0 0 0; font-size:0.95em;">
                    Moodleの仕様により、現在画面に表示されているコースしか取得できません。<br>
                    編集ボタンを押す前に、ダッシュボードの「コース概要」の左下で「すべて表示」に切り替えてから、全コースを画面に表示させてください。
                </p>
            </div>
            <p style="margin-bottom: 15px; font-size: 0.9em;">
                <b>使い方:</b> 科目名を入力すると候補が表示されます。候補をクリックするとIDが自動入力されます。<br>
                データが消えるのが心配な場合は「書き出し」でバックアップを保存してください。
            </p>
            <div id="timetable-edit-grid" style="display: grid; grid-template-columns: 80px repeat(5, 1fr); gap: 8px; font-size: 0.85em;">
                <div style="font-weight: bold; text-align: center;">時間</div>
                ${days.map(day => `<div style="font-weight: bold; text-align: center;">${day}</div>`).join('')}
        `;

        for (const period of periods) {
            const periodTime = CLASS_TIMES.find(t => t.period.toString() === period);
            
            // Fix: Display end time in edit screen too
            let timeStr = '';
            if (periodTime) {
                const startH = Math.floor(periodTime.start / 100);
                const startM = (periodTime.start % 100).toString().padStart(2, '0');
                const endH = Math.floor(periodTime.end / 100);
                const endM = (periodTime.end % 100).toString().padStart(2, '0');
                timeStr = `${startH}:${startM}～${endH}:${endM}`;
            }

            bodyHtml += `<div style="font-weight: bold; line-height: 1.2; text-align:center;">${period}<br><span style="font-size:0.75em">${timeStr}</span></div>`;

            for (const day of days) {
                const course = (timetable[day] && timetable[day][period]) ? timetable[day][period] : null;
                bodyHtml += `
                    <div class="input-wrapper-relative">
                        <input type="text" class="course-name-input" data-day="${day}" data-period="${period}" id="name-${day}-${period}" placeholder="科目名" value="${course ? course.name : ''}" style="width: 100%; margin-bottom: 2px; padding: 4px; border:1px solid #ccc; border-radius:3px;" autocomplete="off">
                        <ul class="suggestion-list" id="suggest-${day}-${period}"></ul>
                        <input type="number" id="id-${day}-${period}" placeholder="ID" value="${course ? course.id : ''}" style="width: 100%; padding: 4px; border:1px solid #eee; border-radius:3px; font-size:0.9em; background:#f9f9f9;">
                    </div>
                `;
            }
        }
        bodyHtml += `</div>`;

        return `
            <div id="timetable-modal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.7); z-index: 10000; display: none; justify-content: center; align-items: center;">
                <div id="timetable-modal-content" style="background-color: white; padding: 25px; border-radius: 8px; width: 95%; max-width: 950px; max-height: 95%; box-shadow: 0 5px 15px rgba(0,0,0,0.5); position: relative; display: flex; flex-direction: column;">
                    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 15px;">
                        <h4 style="margin:0;">時間割編集</h4>
                        <div>
                            <button id="exportTimetableBtn" style="padding: 6px 12px; background-color: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 5px; font-size: 0.9em;">
                                <i class="fa fa-download"></i> 書き出し
                            </button>
                            <button id="importTimetableBtn" style="padding: 6px 12px; background-color: #17a2b8; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9em;">
                                <i class="fa fa-upload"></i> 読み込み
                            </button>
                            <input type="file" id="importTimetableInput" accept=".json" style="display:none;">
                        </div>
                    </div>
                    
                    <div style="overflow-y: auto; flex-grow: 1; padding-right: 5px;">
                        ${bodyHtml}
                    </div>
                    
                    <div style="margin-top: 20px; text-align: right; flex-shrink: 0; border-top: 1px solid #eee; padding-top: 15px;">
                        <button id="saveTimetableBtn" style="padding: 10px 30px; background-color: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px; font-weight:bold;">
                            保存して適用
                        </button>
                        <button id="closeTimetableModal" style="padding: 10px 20px; background-color: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">
                            キャンセル
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
        injectSuggestionStyles(); // サジェスト用CSSを注入
        
        // Save/Close buttons
        document.getElementById('saveTimetableBtn').addEventListener('click', saveAndRenderTimetable);
        document.getElementById('closeTimetableModal').addEventListener('click', () => {
            modal.style.display = 'none';
        });

        // Feature: Backup (Export/Import)
        document.getElementById('exportTimetableBtn').addEventListener('click', async () => {
            const currentData = await getTimetable();
            const jsonString = JSON.stringify(currentData, null, 2);
            const blob = new Blob([jsonString], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = "moodle_timetable_backup.json";
            a.click();
            URL.revokeObjectURL(url);
        });

        document.getElementById('importTimetableBtn').addEventListener('click', () => {
            document.getElementById('importTimetableInput').click();
        });

        document.getElementById('importTimetableInput').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const json = JSON.parse(event.target.result);
                    await saveTimetable(json);
                    alert('時間割データを読み込みました。画面を更新します。');
                    modal.remove(); // Remove modal to regenerate
                    injectEditModal(json); // Re-inject with new data
                    document.getElementById('timetable-modal').style.display = 'flex';
                } catch (err) {
                    alert('ファイルの読み込みに失敗しました。正しいJSONファイルか確認してください。');
                }
            };
            reader.readAsText(file);
            e.target.value = ''; // リセット
        });

        // Event listener for suggest feature
        const nameInputs = modal.querySelectorAll('.course-name-input');
        nameInputs.forEach(input => {
            const day = input.dataset.day;
            const period = input.dataset.period;
            const list = document.getElementById(`suggest-${day}-${period}`);
            const idInput = document.getElementById(`id-${day}-${period}`);

            // On input
            input.addEventListener('input', () => {
                const val = input.value.toLowerCase().trim();
                if (val.length < 1) {
                    list.style.display = 'none';
                    return;
                }

                // Normalize input value
                const normalizedQuery = normalizeCourseName(val);
                
                // Filter candidates
                const matches = availableCourses.filter(c => {
                    const normalizedCourseName = normalizeCourseName(c.name);
                    // Check if normalized query is contained in normalized course name
                    return normalizedCourseName.includes(normalizedQuery);
                });
                
                if (matches.length > 0) {
                    list.innerHTML = matches.map(c => `<li data-id="${c.id}" data-name="${c.name}">${c.name} <span style="color:#888; font-size:0.8em;">(ID:${c.id})</span></li>`).join('');
                    list.style.display = 'block';
                    
                    // On candidate click
                    const items = list.querySelectorAll('li');
                    items.forEach(item => {
                        item.addEventListener('click', () => {
                            input.value = item.dataset.name;
                            idInput.value = item.dataset.id;
                            list.style.display = 'none';
                        });
                    });
                } else {
                    list.style.display = 'none';
                }
            });

            // Hide on blur 
            input.addEventListener('blur', () => {
                setTimeout(() => { list.style.display = 'none'; }, 200);
            });
            
            // Execute search on focus (redisplay)
            input.addEventListener('focus', () => {
                if(input.value.trim().length > 0) {
                     input.dispatchEvent(new Event('input'));
                }
            });
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


    // VIII. Timeline & Deadline Feature

    function formatRemainingTime(seconds) {
        if (seconds <= 0) {
            return '<span class="timer-expired">[ 期限切れ ]</span>';
        }

        const d = Math.floor(seconds / (3600 * 24));
        const h = Math.floor((seconds % (3600 * 24)) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);

        let parts = [];
        let urgencyClass = 'timer-safe'; // Default (safe)

        if (d > 0) {
            parts.push(`<b>${d}</b>日`);
            parts.push(`<b>${h}</b>時間`);
            parts.push(`<b>${m}</b>分`);
            
            // "Warning" if within 3 days, "Danger" if within 1 day
            if (d <= 3) urgencyClass = 'timer-warning';
            if (d <= 1) urgencyClass = 'timer-danger'; 
        } else if (h > 0) {
            parts.push(`<b>${h}</b>時間`);
            parts.push(`<b>${m}</b>分`);
            parts.push(`<b>${s}</b>秒`);
            urgencyClass = 'timer-danger'; // Within 24 hours
        } else { 
            parts.push(`<b>${m}</b>分`);
            parts.push(`<b>${s}</b>秒`);
            urgencyClass = 'timer-critical'; // Within 1 hour
        }

        return `<span class="${urgencyClass}">あと ${parts.join(' ')}</span>`;
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
        countdownTimerInterval = setInterval(() => {
        if (!document.hidden) { 
            updateAllCountdownTimers();
        }
    }, 1000);
    }

    // --- Feature: Parse Timeline Deadlines ---
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
            if (isNaN(dateTimestampSeconds)) return;

            const baseDate = new Date(dateTimestampSeconds * 1000);
            const eventList = dateGroup.nextElementSibling;
            if (!eventList) return;

            const items = eventList.querySelectorAll('[data-region="event-list-item"]');
            
            items.forEach(item => {
                try {
                    // 1. Assignment Name
                    const assignmentLink = item.querySelector('.event-name-container a');
                    if (!assignmentLink) return;
                    const assignmentName = assignmentLink.textContent.trim();

                    // 2. Get Course Name (Fix: flexible for centered dots/spaces)
                    let courseName = null;
                    const infoTextElement = item.querySelector('.event-name-container small.mb-0');
                    
                    if (infoTextElement) {
                        const text = infoTextElement.textContent.trim();
                        // Assume format "Assignment · Course Name", split by symbol and take the latter
                        // Consider middot (U+00B7) or full-width middot
                        const parts = text.split(/[·・]/); 
                        if (parts.length > 1) {
                            courseName = parts[parts.length - 1].trim();
                        } else {
                            // Use as is if cannot split
                            courseName = text; 
                        }
                    }

                    if (!courseName) return; 

                    // 3. Get Time
                    const timeElement = item.querySelector('.timeline-name > small.text-nowrap');
                    let hours = 0, minutes = 0;
                    
                    if (timeElement) {
                        const timeText = timeElement.textContent.trim();
                        const timeMatch = timeText.match(/(\d{1,2}):(\d{2})/);
                        if (timeMatch) {
                            hours = parseInt(timeMatch[1]);
                            minutes = parseInt(timeMatch[2]);
                        }
                    }

                    // Calculate deadline date/time
                    const dueDateTime = new Date(baseDate.getTime());
                    dueDateTime.setHours(hours, minutes, 0, 0);
                    
                    // Year crossover correction (treat as next year if more than 6 months ago)
                    if (dueDateTime.getMonth() < now.getMonth() - 6) { 
                         dueDateTime.setFullYear(currentYear + 1);
                    } else {
                         dueDateTime.setFullYear(currentYear);
                    }

                    const dueTimestamp = Math.floor(dueDateTime.getTime() / 1000);
                    // Create date string (e.g., 11/25 23:59)
                    const dueDateString = `${dueDateTime.getMonth() + 1}/${dueDateTime.getDate()} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
                    
                    timelineDeadlines.push({
                        courseName: courseName, 
                        assignmentName: assignmentName, 
                        dueTimestamp: dueTimestamp, 
                        dueDateString: dueDateString 
                    });

                } catch (e) {
                    console.warn("Deadline parse error:", e);
                }
            });
        });
        
        // Debug: Output count found to console
        console.log(`Moodle Customizer: ${timelineDeadlines.length} deadlines found.`, timelineDeadlines);
    }

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

    // --- Feature: Deadline Highlight ---
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
                        const infoText = item.querySelector('.event-name-container small.mb-0')?.textContent || '';
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

    // IX. Quiz Retake Feature
     
    // --- Feature: Quiz Retake ---
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
        const userConfirmed = confirm('解き直しモードを終了しますか？\n（ページがリロードされ、元のレビュー画面に戻ります');
        if (userConfirmed)
        {
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
                 // Generate icon element
                 const icon = document.createElement('span');
                 icon.className = 'ms-1 retake-feedback-icon';
                 icon.innerHTML = `<i class="icon fa-regular ${iconClass} fa-fw" title="${title}" role="img" aria-label="${title}"></i>`;
                 return icon;
            };

            if (correctData.type === 'multichoice' || correctData.type === 'truefalse') {
                const selectedInput = questionElement.querySelector(`input[name="${inputName}"]:checked`);
                const allAnswerInputs = questionElement.querySelectorAll(`.answer input[name="${inputName}"]`);
                
                isCorrect = (selectedInput && selectedInput.value === correctData.answer);

                allAnswerInputs.forEach(input => {
                    const isThisTheCorrectAnswer = (input.value === correctData.answer);
                    const isThisTheSelectedAnswer = (selectedInput && input.value === selectedInput.value);
                    const labelDiv = input.closest('.r0, .r1');
                    
                    if (!labelDiv) return;

                    // Remove previous feedback icons (for re-grading scenarios)
                    labelDiv.querySelectorAll('.retake-feedback-icon').forEach(icon => icon.remove());
                    
                    if (isThisTheCorrectAnswer) {
                        // Add "Correct Icon" to correct option
                        const icon = createIcon(true);
                        labelDiv.appendChild(icon);
                    } else if (isThisTheSelectedAnswer && !isCorrect) {
                        // Add "Incorrect Icon" to incorrect option selected by user
                        const icon = createIcon(false);
                        labelDiv.appendChild(icon);
                    }
                    
                    // Disable input field itself (prevent changes after grading)
                    input.disabled = true;
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
                    textInput.disabled = true; // Disable after grading
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
                    selectEl.disabled = true; // Disable after grading

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
                    selectEl.disabled = true; // Disable after grading
                    
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
                    resultHTML += `<p style="color: #028dffff; font-weight: bold; font-size: 1.1em; margin-top: 1rem;">素晴らしい！全問正解です！</p>
                    <div style="text-align: center; margin-top: 15px;">
                    <img src="https://placehold.co/150x150/dff4d8/357a32?text=PERFECT%21" alt="Perfect Score" style="border-radius: 50%; max-width: 100%;">
                    </div>`;
                } else {
                    resultHTML += `<p style="color: #ff3131e1; font-size: 1.1em; margin-top: 1rem;">間違えた問題を確認して「リセット」でもう一度挑戦できます。</p>`;
                }
                
                resultEl.innerHTML = resultHTML;

                    retakeStartTime = new Date(); 
                }
            }


            document.addEventListener('DOMContentLoaded', () => {
            init();
    });

})();