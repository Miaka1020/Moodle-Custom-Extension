// Presentation layer: keep existing storage keys, IDs and event handlers intact.

function enhanceSettings(modal) {
    if (modal.dataset.uiEnhanced) return;
    modal.dataset.uiEnhanced = 'true';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Moodle カスタム設定');
    const heading = modal.querySelector('h4');
    if (heading) heading.textContent = '表示設定';
    const subtitle = modal.querySelector('.sub-text');
    if (subtitle) subtitle.textContent = '保存した設定は次回も適用されます。';
    modal.querySelectorAll('.slider-label > span:first-child').forEach(label => {
        label.textContent = label.textContent.replace(/\s*\((Brightness|Contrast|Grayscale|Sepia)\)/g, '');
    });
    const groups = [...modal.querySelectorAll('.settings-group')];
    groups.forEach((group, i) => {
        const title = group.querySelector('.group-title');
        if (!title) return;
        const text = title.textContent;
        const name = /Dark/i.test(text) ? '外観' : /Header|Color/i.test(text) ? 'カラー' : /Background/i.test(text) ? '背景' : /Font|Typography/i.test(text) ? 'フォント' : /Widget/i.test(text) ? 'レイアウト' : /Content/i.test(text) ? 'コンテンツの表示' : text;
        const details = document.createElement('details');
        details.className = 'mce-settings-section';
        details.open = i === 0;
        const summary = document.createElement('summary');
        summary.textContent = name;
        group.before(details);
        details.append(summary, group);
        title.hidden = true;
    });
    require('./settings-section-values.js')(modal);
    const close = modal.querySelector('#closeSettingsModal');
    const save = modal.querySelector('#saveSettingsBtn');
    if (close) close.textContent = 'キャンセル';
    if (save) {
        save.textContent = '変更を保存';
        save.addEventListener('click', () => {
            save.disabled = true;
            save.textContent = '保存中…';
            const timer = setInterval(() => {
                if (modal.style.display === 'none') {
                    save.disabled = false;
                    save.textContent = '変更を保存';
                    clearInterval(timer);
                }
            }, 100);
            setTimeout(() => { clearInterval(timer); save.disabled = false; save.textContent = '変更を保存'; }, 5000);
        });
    }
    const font = modal.querySelector('#fontFamilySelect');
    if (font) {
        const reset = document.createElement('button');
        reset.type = 'button'; reset.className = 'modern-btn secondary-btn'; reset.textContent = 'フォントをリセット';
        reset.addEventListener('click', () => {
            font.value = 'default';
            for (const id of ['customFontNameInput', 'customFontUrlInput']) { const input = modal.querySelector('#' + id); if (input) { input.value = ''; input.dispatchEvent(new Event('input')); } }
            font.dispatchEvent(new Event('change'));
        });
        font.closest('.settings-group').append(reset);
    }
    modal.querySelectorAll('input,select').forEach(input => {
        if (!input.getAttribute('aria-label') && !modal.querySelector('label[for="' + input.id + '"]')) {
            input.setAttribute('aria-label', input.closest('.input-wrapper, .slider-container')?.querySelector('label,.slider-label')?.textContent.trim() || input.id);
        }
    });
    let origin;
    new MutationObserver(() => {
        if (modal.style.display !== 'none') {
            origin = document.activeElement;
            const first = modal.querySelector('summary,button,input,select');
            first?.focus();
        } else origin?.focus();
    }).observe(modal, {attributes:true,attributeFilter:['style']});
    modal.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); close?.click(); }
        if (e.key !== 'Tab') return;
        const focusable = [...modal.querySelectorAll('summary,button,input,select,a[href]')].filter(el => !el.disabled && el.getClientRects().length);
        const first=focusable[0], last=focusable[focusable.length-1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    });
}

const observer = new MutationObserver(() => {
    const modal = document.getElementById('custom-settings-modal');
    if (modal) enhanceSettings(modal);
});
observer.observe(document.documentElement, {childList:true,subtree:true});
