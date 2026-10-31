// dr_init_bridge.js

(function() {
    let currentSettings;
    let signature = '';
    let stopFallbackWatch = () => {};
    const systemTheme = matchMedia('(prefers-color-scheme: dark)');
    function initDarkReader(settings) {
        const DarkReader = window.DarkReader;
        if (!DarkReader) return; // Manifest scripts execute in declared order.

        const mode = settings.darkModeMode;
        const wantsDark = mode === 'on' || (mode === 'auto' && systemTheme.matches);
        const nextSignature = JSON.stringify([wantsDark, settings.darkModeBrightness, settings.darkModeContrast, settings.darkModeGrayscale, settings.darkModeSepia]);
        currentSettings = settings;
        if (signature === nextSignature) return;
        signature = nextSignature;
        stopFallbackWatch();
        document.documentElement.classList.toggle('mce-dark-pending', wantsDark);
        document.documentElement.classList.toggle('mce-dark-active', wantsDark);

        if (!wantsDark) {
            DarkReader.auto(false);
            DarkReader.disable();
            document.getElementById('mce-startup-fallback')?.remove();
            document.documentElement.classList.add('dark-fouc-mask-ready');
            return;
        }

        // Configuration
        const drSettings = {
            brightness: settings.darkModeBrightness,
            contrast: settings.darkModeContrast,
            grayscale: settings.darkModeGrayscale,
            sepia: settings.darkModeSepia,
        };

        // Custom CSS fixes for Moodle elements
        const moodleCustomFixes = `
            /* General background fixes for elements missed by dynamic theme */
            .bg-white, .btn.bg-white, .alert.bg-white,
            .dropdown-menu.bg-white, .list-group-item.bg-white,
            .custom-file-label, .custom-file-input:focus ~ .custom-file-label,
            .form-control, .form-check-label, .custom-control-label {
                background-color: var(--darkreader-neutral-background) !important;
                color: var(--darkreader-neutral-text) !important;
                border-color: var(--darkreader-border, #555) !important;
            }

            /* Table fixes (Review screens etc.) */
            .table.generaltable th, .table.generaltable td, .table.generaltable caption {
                background-color: var(--darkreader-neutral-background) !important;
                color: var(--darkreader-neutral-text) !important;
                border-color: var(--darkreader-border, #444) !important;
            }
            .table.generaltable tbody tr:nth-child(even) th, 
            .table.generaltable tbody tr:nth-child(even) td,
            .table.generaltable tbody tr:nth-child(odd) th, 
            .table.generaltable tbody tr:nth-child(odd) td {
                background-color: var(--darkreader-neutral-background) !important;
            }

            /* Quiz elements */
            .que .ablock, .que .comment, .que .feedback, .que .answer,
            .que .qtext, .que .outcome {
                background-color: var(--darkreader-neutral-background) !important;
                color: var(--darkreader-neutral-text) !important;
            }
            
            /* Custom Timetable */
            #customTimetableTable th, #customTimetableTable td {
                 border-color: var(--darkreader-border, #444) !important;
            }

            /* Prevent double inversion on icons */
            .icon, .fa, .fa-fw, .fa-solid, .fa-regular {
                filter: none !important;
            }

            /* Page Footer */
            #page-footer {
                background-color: var(--darkreader-neutral-background) !important;
                color: var(--darkreader-neutral-text) !important;
                border-top-color: var(--darkreader-border, #333) !important;
            }
        `;

        const themeFix = {
            // Authored semantic colors belong in the final override, after the
            // engine has converted Moodle's original sheets and inline styles.
            css: moodleCustomFixes + `
                html.mce-dark-active body #mce-course-checklist {background:rgba(32,40,50,var(--mce-content-opacity,.7))!important;color:#edf2f7!important;border-color:#4b5b6e!important;}
                html.mce-dark-active body #mce-course-checklist .mce-checklist-link {color:#9cbeff!important;}
                html.mce-dark-active body #mce-course-checklist .mce-checklist-select {background:rgba(43,54,67,var(--mce-content-opacity,.7))!important;color:#edf2f7!important;border-color:#526478!important;}
                html.mce-dark-active body #mce-course-checklist .mce-checklist-task[data-state="doing"] {border-left-color:#9cbeff!important;}
                html.mce-dark-active body #mce-course-checklist .mce-checklist-task[data-state="submitted"] {border-left-color:#80dfb1!important;}
                html.mce-dark-active body #mce-course-checklist .mce-checklist-task[data-state="submitted"] .mce-checklist-select {color:#80dfb1!important;}
                html.mce-dark-active body #mce-course-checklist .mce-checklist-due[data-urgency="soon"] {color:#ffb58a!important;background:rgba(255,146,82,.12)!important;}
                html.mce-dark-active body #mce-course-checklist .mce-checklist-due[data-urgency="listed"] {color:#9cbeff!important;background:rgba(112,157,255,.12)!important;}
                html.mce-dark-active body #mce-course-checklist .mce-checklist-due:is([data-urgency="urgent"],[data-urgency="critical"],[data-urgency="overdue"]) {color:#ffa6b7!important;background:rgba(255,104,137,.13)!important;}
                html.mce-dark-active {
                    --mce-action: #9cbeff !important;
                    --mce-success: #80dfb1 !important;
                    --mce-warning: #ffb58a !important;
                    --mce-danger: #ffa6b7 !important;
                }
                html.mce-dark-active body .block_timeline [data-mce-deadline] {
                    --mce-due-ink: #9cbeff !important;
                    --mce-due-bg: rgba(112,157,255,.12) !important;
                    --mce-due-edge: #719fff !important;
                }
                html.mce-dark-active body .block_timeline [data-mce-deadline="soon"] {
                    --mce-due-ink: #ffb58a !important;
                    --mce-due-bg: rgba(255,146,82,.12) !important;
                    --mce-due-edge: #fb995c !important;
                }
                html.mce-dark-active body .block_timeline :is([data-mce-deadline="urgent"],[data-mce-deadline="critical"],[data-mce-deadline="overdue"]) {
                    --mce-due-ink: #ffa6b7 !important;
                    --mce-due-bg: rgba(255,104,137,.13) !important;
                    --mce-due-edge: #ff7896 !important;
                }
                html.mce-dark-active body .block_timeline [data-mce-deadline] .mce-deadline-badge {
                    color: var(--mce-due-ink) !important;
                    background: var(--mce-due-bg) !important;
                    border: 1px solid var(--mce-due-edge) !important;
                }
                html.mce-dark-active body .block_timeline [data-mce-deadline].deadline-highlight {
                    background: var(--mce-due-bg) !important;
                    border-color: var(--mce-due-edge) !important;
                }
                html.mce-dark-active body .block_timeline .event-name-container a,
                html.mce-dark-active body .course-content .activityname a,
                html.mce-dark-active body #customTimetableWidget a {
                    color: #9cbeff !important;
                }
                html.mce-dark-active body #customTimetableWidget .custom-countdown-timer .timer-safe {color:#9cbeff!important;}
                html.mce-dark-active body #customTimetableWidget .custom-countdown-timer .timer-warning {color:#ffb58a!important;}
                html.mce-dark-active body #customTimetableWidget .custom-countdown-timer :is(.timer-danger,.timer-critical,.timer-expired) {color:#ffa6b7!important;}
                html.mce-dark-active body #customTimetableWidget .timetable-deadline-card:has(.timer-safe) {border-left-color:#719fff!important;}
                html.mce-dark-active body #customTimetableWidget .timetable-deadline-card:has(.timer-warning) {border-left-color:#fb995c!important;}
                html.mce-dark-active body #customTimetableWidget .timetable-deadline-card:has(:is(.timer-danger,.timer-critical,.timer-expired)) {border-left-color:#ff7896!important;}
                html.mce-dark-active body #moodle-custom-attendance-widget .mce-att-metrics > div:nth-child(1) > div:nth-child(2) {color:#80dfb1!important;}
                html.mce-dark-active body #moodle-custom-attendance-widget .mce-att-metrics > div:nth-child(2) > div:nth-child(2) {color:#ffb58a!important;}
                html.mce-dark-active body #moodle-custom-attendance-widget .mce-att-metrics > div:nth-child(3) > div:nth-child(2) {color:#ffa6b7!important;}
                html.mce-dark-active body #moodle-custom-attendance-widget[data-mce-attendance="safe"] .mce-att-metrics > div:last-child > div:nth-child(2) {color:#9cbeff!important;}
                html.mce-dark-active body #moodle-custom-attendance-widget[data-mce-attendance="warning"] .mce-att-metrics > div:last-child > div:nth-child(2) {color:#ffb58a!important;}
                html.mce-dark-active body #moodle-custom-attendance-widget:is([data-mce-attendance="danger"],[data-mce-attendance="failed"]) .mce-att-metrics > div:last-child > div:nth-child(2) {color:#ffa6b7!important;}
                html.mce-dark-active body #moodle-custom-attendance-widget .mce-att-actions #btn-add-attend {background:#285ac7!important;color:#fff!important;border-color:#6b98f3!important;}
                html.mce-dark-active body #moodle-custom-attendance-widget .mce-att-actions #btn-add-late {background:rgba(43,54,67,var(--mce-content-opacity,.7))!important;color:#ffb58a!important;border-color:#a76a43!important;}
                html.mce-dark-active body #moodle-custom-attendance-widget .mce-att-actions #btn-add-absent {background:rgba(43,54,67,var(--mce-content-opacity,.7))!important;color:#ffa6b7!important;border-color:#a75167!important;}
                html.mce-dark-active body #moodle-custom-attendance-widget .mce-att-actions button:disabled {background:#303a47!important;color:#aebaca!important;border-color:#4b5b6e!important;}
                html.mce-dark-active body #moodle-custom-attendance-widget .mce-att-today[data-state="attend"] {background:rgba(79,209,153,.12)!important;color:#80dfb1!important;}
                html.mce-dark-active body #moodle-custom-attendance-widget .mce-att-today[data-state="late"] {background:rgba(255,146,82,.12)!important;color:#ffb58a!important;}
                html.mce-dark-active body #moodle-custom-attendance-widget .mce-att-today:is([data-state="absent"],[data-state="failed"]) {background:rgba(255,104,137,.12)!important;color:#ffa6b7!important;}
                html.mce-dark-active body #moodle-custom-attendance-widget #att-history-list .text-primary {color:#80dfb1!important;}
                html.mce-dark-active body #moodle-custom-attendance-widget #att-history-list .text-warning {color:#ffb58a!important;}
                html.mce-dark-active body #moodle-custom-attendance-widget #att-history-list .text-danger {color:#ffa6b7!important;}
                html.mce-dark-active body #custom-settings-modal :is(.primary-btn,#saveSettingsBtn),
                html.mce-dark-active body #timetable-modal #saveTimetableBtn,
                html.mce-dark-active body #att-settings-panel #att-save-cfg {background:#285ac7!important;color:#fff!important;border-color:#6b98f3!important;}
                html.mce-dark-active body #custom-settings-modal .danger,
                html.mce-dark-active body #att-settings-panel #att-reset-data {color:#ffa6b7!important;}
                html.mce-dark-active body #timetable-modal #exportTimetableBtn {color:#80dfb1!important;border-color:#477e66!important;}
                html.mce-dark-active body #timetable-modal #importTimetableBtn {color:#9cbeff!important;border-color:#5676a5!important;}
                html.mce-dark-active body #custom-settings-modal .slider-value-group {color:#9cbeff!important;}
                html.mce-dark-active body #custom-settings-modal input:checked + .slider {background:#285ac7!important;}
                html.mce-dark-active body #custom-settings-modal :focus-visible,
                html.mce-dark-active body #timetable-modal :focus-visible,
                html.mce-dark-active body #moodle-custom-attendance-widget :focus-visible {outline-color:#9cbeff!important;}
            `,
            invert: [],
            disableStyleSheetsProxy: false,
            ignoreImageAnalysis: [],
            ignoreInlineStyle: [],
        };

        // Apply Mode
        DarkReader.auto(false);
        DarkReader.enable(drSettings, themeFix);
        // The engine owns fallback lifetime, including outstanding stylesheets.
        // A generated rule in a single sheet is not sufficient proof of readiness.
        if (wantsDark) {
            let finished = false;
            let frame1, frame2;
            const cleanup = () => {
                finished = true;
                observer.disconnect();
                cancelAnimationFrame(frame1);
                cancelAnimationFrame(frame2);
                clearTimeout(timeout);
            };
            const check = () => {
                if (finished || frame1) return;
                const fallback = document.querySelector('.darkreader--fallback');
                const ready = DarkReader.isEnabled() && fallback && !fallback.textContent.trim();
                if (!ready) return;
                frame1 = requestAnimationFrame(() => {
                    frame2 = requestAnimationFrame(() => {
                        cleanup();
                        document.documentElement.classList.remove('mce-dark-pending');
                    });
                });
            };
            const observer = new MutationObserver(check);
            observer.observe(document.documentElement, {childList:true,subtree:true,characterData:true});
            // On failure keep a readable dark page, never a mask or a white flash.
            const timeout = setTimeout(cleanup, 10000);
            stopFallbackWatch = cleanup;
            check();
        }
        document.documentElement.classList.add('dark-fouc-mask-ready');
    }

    const defaults = {darkModeMode:'off', darkModeBrightness:100, darkModeContrast:100, darkModeGrayscale:0, darkModeSepia:0};
    function applyFromDOM() {
        const element = document.getElementById('darkreader-settings-data');
        if (!element) return;
        try {
            const settings = {...defaults, ...JSON.parse(element.textContent)};
            if (['off','on','auto'].includes(settings.darkModeMode)) initDarkReader(settings);
        } catch (error) { console.warn('Invalid theme settings:', error); }
    }
    document.addEventListener('mce-theme-settings', applyFromDOM);
    systemTheme.addEventListener('change', () => {
        if (currentSettings?.darkModeMode === 'auto') initDarkReader(currentSettings);
    });
    // MAIN world can read the same origin cache immediately, before async settings.
    try {
        const cached = JSON.parse(localStorage.getItem('moodle_fast_ui_cache_v1') || '{}');
        const mode = localStorage.getItem('darkmode_enabled_v1') || cached.darkModeMode || 'off';
        initDarkReader({...defaults, ...cached, darkModeMode:mode});
    } catch (_) { /* Authoritative settings arrive through the DOM event. */ }
    applyFromDOM();
})();
