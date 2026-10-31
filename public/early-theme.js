// Run before the main bundle, without waiting for DOMContentLoaded or IndexedDB.
(() => {
    try {
        const cache = JSON.parse(localStorage.getItem('moodle_fast_ui_cache_v1') || '{}');
        const mode = localStorage.getItem('darkmode_enabled_v1') || cache.darkModeMode || 'off';
        const dark = mode === 'on' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
        document.documentElement.classList.toggle('mce-dark-pending', dark);
        document.documentElement.classList.toggle('mce-dark-active', dark);
        // Dark Reader reuses this fallback and clears it after all pending styles
        // are processed. Broad coverage also protects elements not yet parsed.
        if (dark && !document.querySelector('.darkreader--fallback')) {
            const fallback = document.createElement('style');
            fallback.id = 'mce-startup-fallback';
            fallback.classList.add('darkreader', 'darkreader--fallback');
            fallback.media = 'screen';
            fallback.textContent = 'html,body,body :not(iframe){background-color:#181a1b!important;color:#e8e6e3!important;border-color:#444c57!important}html,body{color-scheme:dark!important;transition:none!important}';
            (document.head || document.documentElement).appendChild(fallback);
        }
        const root = document.documentElement;
        root.dataset.mcePage = location.pathname.endsWith('/my/courses.php') ? 'courses' : location.pathname.endsWith('/my/') ? 'dashboard' : 'other';
        root.classList.toggle('mce-refined-ui', !!cache.refinedUI);
        root.classList.toggle('mce-animations', !!cache.enableAnimations);
        root.classList.toggle('mce-layout-expanded', !!cache.enableCustomLayout);
        root.dataset.mceContentAlign=['left','center','right'].includes(cache.contentAlign)?cache.contentAlign:'center';
        if (Object.keys(cache).length) {
            root.classList.add('mce-ui-cached');
            const opacity = Math.max(0, Math.min(100, Number(cache.contentOpacity ?? 70))) / 100;
            root.style.setProperty('--mce-content-opacity', String(opacity));
            for (const [key, variable] of [['headerBgColor','--mce-header-bg'], ['headerTextColor','--mce-header-text']]) {
                if (/^#[a-f\d]{6}$/i.test(cache[key])) root.style.setProperty(variable, cache[key]);
            }
        }
    } catch (_) { /* The main settings loader remains authoritative. */ }
})();
