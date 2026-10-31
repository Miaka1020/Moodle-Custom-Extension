module.exports = function mountTimelineColors({read, preview, save}) {
    const fields = [
        ['deadlineColor', '一覧に掲載', '#2563eb'],
        ['deadlineSoonColor', '3日以内', '#ea580c'],
        ['deadlineUrgentColor', '24時間以内・期限超過', '#e11d48']
    ];
    let active = null;
    const close = (focus = false) => {
        if (!active) return;
        const {panel, button} = active;
        panel.remove();
        button.setAttribute('aria-expanded', 'false');
        active = null;
        preview(read());
        if (focus) button.focus();
    };
    const mount = () => {
        const block = document.querySelector('.block_timeline');
        const heading = block?.querySelector('.card-title, h5, h4, h3, h2');
        if (!heading || heading.querySelector('.mce-timeline-colors-button')) return;
        if (active) close();
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'mce-timeline-colors-button';
        button.title = '締切の強調色を設定';
        button.setAttribute('aria-label', '締切の強調色を設定');
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-controls', 'mce-timeline-colors-panel');
        button.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.5-3.3 1.5 1.5 0 0 1 1.1-2.5H18A3 3 0 0 0 21 12a9 9 0 0 0-9-9Z"/><circle cx="7.5" cy="10" r="1"/><circle cx="11" cy="6.8" r="1"/><circle cx="16" cy="8" r="1"/><circle cx="6.5" cy="14.5" r="1"/></svg>';
        heading.append(button);
        button.addEventListener('click', () => {
            if (active) {close(); return;}
            const panel = document.createElement('div');
            panel.id = 'mce-timeline-colors-panel';
            panel.setAttribute('role', 'region');
            panel.setAttribute('aria-label', '締切の強調色');
            const title = document.createElement('strong');
            title.textContent = '締切の強調色';
            panel.append(title);
            const inputs = {};
            for (const [key, label, fallback] of fields) {
                const row = document.createElement('label');
                row.textContent = label;
                const input = document.createElement('input');
                input.type = 'color';
                input.value = read()[key] || fallback;
                inputs[key] = input;
                row.append(input);
                panel.append(row);
                input.addEventListener('input', () => preview(values()));
            }
            const values = () => Object.fromEntries(fields.map(([key]) => [key, inputs[key].value]));
            const status = document.createElement('p');
            status.setAttribute('role', 'status');
            const actions = document.createElement('div');
            const cancel = document.createElement('button');
            cancel.type = 'button'; cancel.textContent = 'キャンセル';
            cancel.addEventListener('click', () => close(true));
            const commit = document.createElement('button');
            commit.type = 'button'; commit.textContent = '保存';
            commit.addEventListener('click', async () => {
                commit.disabled = cancel.disabled = true;
                try {await save(values()); close(true);} catch (error) {
                    status.textContent = '保存できませんでした。もう一度お試しください。';
                    commit.disabled = cancel.disabled = false;
                }
            });
            actions.className = 'mce-timeline-colors-actions';
            actions.append(cancel, commit);
            panel.append(status, actions);
            heading.after(panel);
            active = {panel, button};
            button.setAttribute('aria-expanded', 'true');
            inputs.deadlineColor.focus();
        });
    };
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && active && !active.panel.querySelector('button:disabled')) {
            event.preventDefault(); close(true);
        }
    });
    mount();
    new MutationObserver(mount).observe(document.body, {childList:true, subtree:true});
};
