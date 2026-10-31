// Reserve space without transforming page wrappers (Moodle drawers depend on it).
function syncReferenceLayout(sidebar, root = document.documentElement, viewport = innerWidth, gutter = null) {
    const open = sidebar.classList.contains('open');
    const panel = document.getElementById('mce-course-checklist');
    if (!gutter && panel && viewport >= 1500) gutter = {left:24, width:300};
    const width = sidebar.getBoundingClientRect().width;
    const docked = open && viewport >= 1100 && (!gutter || viewport - width - gutter.left - gutter.width - 20 >= 500);
    root.classList.toggle('mce-reference-docked', docked);
    root.classList.toggle('mce-reference-keep-checklist', docked && !!gutter);
    if (docked) root.style.setProperty('--mce-reference-width', `${width}px`);
    else root.style.removeProperty('--mce-reference-width');
    if (docked && gutter) {
        const page = document.getElementById('page');
        const left = page?.getBoundingClientRect().left || 0;
        const padding = page ? parseFloat(getComputedStyle(page).paddingLeft) || 0 : 0;
        root.style.setProperty('--mce-reference-gutter', `${Math.max(16, gutter.left + gutter.width + 20 - left - padding)}px`);
        root.style.setProperty('--mce-reference-checklist-left', `${gutter.left}px`);
        root.style.setProperty('--mce-reference-checklist-width', `${gutter.width}px`);
    } else root.style.removeProperty('--mce-reference-gutter');
    window.dispatchEvent(new Event('mce-reference-layout'));
}
module.exports = function observeReferenceLayout(sidebar) {
    let gutter = null;
    const sync = () => {
        const panel = document.getElementById('mce-course-checklist');
        if (!sidebar.classList.contains('open') && panel?.dataset.placement === 'gutter') {
            const rect = panel.getBoundingClientRect();
            if (rect.width >= 260) gutter = {left:rect.left, width:rect.width};
        }
        syncReferenceLayout(sidebar, document.documentElement, innerWidth, gutter);
    };
    const resize = new ResizeObserver(sync);
    const state = new MutationObserver(sync);
    resize.observe(sidebar);
    state.observe(sidebar, {attributes:true, attributeFilter:['class']});
    const added = new MutationObserver(records => {
        if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 &&
            (node.id === 'mce-course-checklist' || node.querySelector('#mce-course-checklist'))))) sync();
    });
    added.observe(document.body, {childList:true, subtree:true});
    window.addEventListener('resize', sync);
    window.addEventListener('pageshow', sync);
    window.addEventListener('pagehide', event => {
        if (event.persisted) return;
        resize.disconnect(); state.disconnect(); added.disconnect();
        window.removeEventListener('resize', sync);
        window.removeEventListener('pageshow', sync);
    });
    sync();
};
module.exports.syncReferenceLayout = syncReferenceLayout;
