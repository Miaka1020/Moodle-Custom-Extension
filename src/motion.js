// Animate arriving content, never delay navigation or hide the document.
(() => {
    const root = document.documentElement;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const enabled = () => root.classList.contains('mce-animations') && !reduced.matches;
    let arrivalTimer;
    function arrive() {
        if (!enabled() || document.visibilityState === 'hidden') return;
        root.classList.add('mce-page-enter');
        clearTimeout(arrivalTimer);
        arrivalTimer = setTimeout(() => root.classList.remove('mce-page-enter'), 400);
    }
    function init() {
        arrive();
        const visiblePanels = new WeakMap();
        function checkPanels() {
            for (const panel of document.querySelectorAll('#custom-settings-modal .modern-modal-content, #timetable-modal #timetable-modal-content, #moodle-custom-attendance-widget [role="dialog"]')) {
                const visible = panel.getClientRects().length > 0;
                if (visible && visiblePanels.get(panel) === false && enabled()) {
                    panel.classList.add('mce-panel-enter');
                    setTimeout(() => panel.classList.remove('mce-panel-enter'), 240);
                }
                visiblePanels.set(panel, visible);
            }
        }
        checkPanels();
        let scheduled = false;
        new MutationObserver(() => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {scheduled = false; checkPanels();});
        }).observe(document.body, {subtree:true, childList:true, attributes:true, attributeFilter:['style','hidden']});
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
    else init();
    window.addEventListener('pageshow', event => {if (event.persisted) arrive();});
    const stop = () => {
        if (enabled()) return;
        if (root.classList.contains('mce-page-enter')) root.classList.remove('mce-page-enter');
        document.querySelectorAll('.mce-panel-enter').forEach(panel => panel.classList.remove('mce-panel-enter'));
    };
    new MutationObserver(stop).observe(root, {attributes:true, attributeFilter:['class']});
    reduced.addEventListener('change', stop);
})();
