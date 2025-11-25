// dr_init_bridge.js

(function() {
    // Retrieve settings data from DOM
    const settingsElement = document.getElementById('darkreader-settings-data');
    if (!settingsElement) return;

    const settings = JSON.parse(settingsElement.textContent);
    settingsElement.remove();

    // Wait for DarkReader to load (avoids race conditions)
    function initDarkReader() {
        const DarkReader = window.DarkReader;
        if (typeof DarkReader === 'undefined') {
            setTimeout(initDarkReader, 50);
            return;
        }

        const mode = settings.darkModeMode;

        if (mode === 'off') {
            DarkReader.disable();
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
            css: moodleCustomFixes,
            invert: [],
            disableStyleSheetsProxy: false,
            ignoreImageAnalysis: [],
            ignoreInlineStyle: [],
        };

        // Apply Mode
        if (mode === 'auto') {
            DarkReader.auto(drSettings, themeFix);
        } else {
            // mode === 'on'
            DarkReader.auto(false);
            DarkReader.enable(drSettings, themeFix);
        }
    }

    initDarkReader();
})();