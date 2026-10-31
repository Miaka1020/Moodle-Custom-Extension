// POLITE navigation and extension controls share the same outline grid.
const paths = {
    'cog':'<path d="m10 3-1 3-3 1-2-1-2 4 2 2v2l-2 2 2 4 3-1 2 1 1 3h4l1-3 2-1 3 1 2-4-2-2v-2l2-2-2-4-3 1-2-1-1-3z"/><circle cx="12" cy="13" r="3"/>',
    'book':'<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1zM12 5v15"/>',
    'check':'<path d="m5 12 4 4L19 6"/>',
    'clock':'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    'times':'<path d="m6 6 12 12M6 18 18 6"/>',
    'rotate-left':'<path d="M4 4v6h6M4 10a8 8 0 1 1 1 8"/>',
    'history':'<path d="M3 4v6h6M3 10a9 9 0 1 1 1 8M12 7v5l3 2"/>',
    'chevron-down':'<path d="m6 9 6 6 6-6"/>',
    'download':'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    'upload':'<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
    'folder-open':'<path d="M3 9V5h6l3 3h9v3M3 9h18l-3 11H5z"/>',
    'trash':'<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
    'palette':'<path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4c-1-1 0-3 2-3h2a3 3 0 0 0 3-3c0-5-4-8-9-8Z"/><circle cx="7" cy="11" r=".7"/><circle cx="10" cy="7" r=".7"/><circle cx="15" cy="7" r=".7"/>',
    'minus':'<path d="M5 12h14"/>',
    'file-pdf-o':'<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h4"/>',
    'magnifying-glass':'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    'bell':'<path d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 8H3c0-1 3-1 3-8M10 21h4"/>',
    'message':'<path d="M21 15a3 3 0 0 1-3 3H9l-6 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3zM7 8h10M7 12h7"/>',
    'list':'<path d="M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1"/>',
    'chevron-left':'<path d="m15 5-7 7 7 7"/>',
    'chevron-right':'<path d="m9 5 7 7-7 7"/>'
};
paths.gear = paths.cog; paths.xmark = paths.times; paths.search = paths['magnifying-glass'];
const scopes = 'nav.navbar,.drawer-toggler,#customSettingsBtn,#custom-settings-modal,#customTimetableWidget,#timetable-modal,#moodle-custom-attendance-widget,#moodle-ref-sidebar-container,#ref-toggle-btn,.mce-timeline-colors-button';
function decorate(node) {
    if (node.nodeType !== 1) return;
    const candidates = [...node.querySelectorAll('i.fa')];
    if (node.matches('i.fa')) candidates.unshift(node);
    for (const icon of candidates) {
        if (!icon.closest(scopes)) continue;
        const name = Object.keys(paths).find(name => icon.classList.contains(`fa-${name}`));
        if (!name || icon.dataset.mceIcon === name) continue;
        icon.dataset.mceIcon = name;
        icon.classList.add('mce-ui-icon');
        icon.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
        if (!icon.getAttribute('aria-label') && !icon.title && icon.getAttribute('role') !== 'img') icon.setAttribute('aria-hidden', 'true');
    }
}
function start() {
    decorate(document.body);
    const observer = new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) decorate(node);
    });
    observer.observe(document.body, {childList:true, subtree:true});
    window.addEventListener('pagehide', event => {if (!event.persisted) observer.disconnect();});
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
else start();
module.exports = {decorate};
