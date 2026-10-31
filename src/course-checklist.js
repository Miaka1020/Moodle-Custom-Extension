const {STATES, storageKey, taskState, updateRecord, activityURL, observeSubmission, parseSubmissionDocument, parseQuizDocument, deadlinePresentation} = require('./course-checklist-model');
const {CACHE_KEY} = require('./course-deadline-cache');

async function startChecklist() {
    const pageURL = new URL(location.href);
    const courseId = pageURL.searchParams.get('id');
    if (!pageURL.pathname.endsWith('/course/view.php') || !/^\d+$/.test(courseId || '')) return;
    if (document.getElementById('mce-course-checklist')) return;
    const content = document.querySelector('.course-content');
    const host = document.getElementById('region-main');
    if (!content || !host) return;
    const key = storageKey(courseId);
    let record = {}, deadlineCache = {}, tasks = [], discoverySignature = '', ready = false;
    const rows = new Map(), pending = new Map();
    const checking = new Set(), controllers = new Set();
    const checkQueue = [];
    let activeChecks = 0, disposed = false;
    const FRESH_MS = 5 * 60 * 1000;
    let saveQueue = Promise.resolve();
    const create = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    };
    const panel = create('aside', 'mce-checklist');
    panel.id = 'mce-course-checklist';
    panel.setAttribute('aria-labelledby', 'mce-checklist-title');
    const header = create('div', 'mce-checklist-header');
    const heading = create('h2', '', '課題・クイズ');
    heading.id = 'mce-checklist-title';
    const collapse = create('button', 'mce-checklist-collapse', '−');
    collapse.type = 'button';
    collapse.setAttribute('aria-label', '課題一覧を折りたたむ');
    collapse.setAttribute('aria-expanded', 'true');
    collapse.setAttribute('aria-controls', 'mce-checklist-body');
    header.append(heading, collapse);
    const body = create('div', 'mce-checklist-body');
    body.id = 'mce-checklist-body';
    const note = create('p', 'mce-checklist-note', '提出・受験を自動確認');
    note.title = '未着手・作業中は手動で管理します。ダッシュボードで取得した締切も含みます。';
    const counts = create('p', 'mce-checklist-counts');
    const list = create('ul', 'mce-checklist-list');
    const empty = create('p', 'mce-checklist-empty', '課題・クイズは見つかりません。ダッシュボードの締切一覧も確認してください。');
    const status = create('p', 'mce-checklist-status', '保存済みの状態を読み込み中…');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const retry = create('button', 'mce-checklist-retry', '再読み込み');
    retry.type = 'button'; retry.hidden = true;
    const refresh = create('button', 'mce-checklist-refresh', '更新');
    refresh.setAttribute('aria-label', '提出・受験状況を更新');
    refresh.type = 'button'; refresh.disabled = true;
    refresh.addEventListener('click', () => scheduleChecks(true));
    const toolbar = create('div', 'mce-checklist-toolbar');
    toolbar.append(note,refresh);
    list.setAttribute('aria-label','このコースの課題とクイズ');
    list.tabIndex = 0;
    body.append(toolbar, counts, list, empty, status, retry);
    panel.append(header, body);
    host.prepend(panel);
    collapse.addEventListener('click', () => {
        body.hidden = !body.hidden;
        collapse.textContent = body.hidden ? '+' : '−';
        collapse.setAttribute('aria-expanded', String(!body.hidden));
        collapse.setAttribute('aria-label', body.hidden ? '課題一覧を開く' : '課題一覧を折りたたむ');
    });

    function syncRows() {
        const totals = {todo:0, doing:0, submitted:0};
        for (const task of tasks) {
            const state = pending.get(task.id) || taskState(record, task.id);
            totals[state]++;
            const row = rows.get(task.id);
            if (!row) continue;
            if (ready) {
                if (row.motionState && row.motionState !== 'submitted' && state === 'submitted' &&
                    document.documentElement.classList.contains('mce-animations') &&
                    !matchMedia('(prefers-reduced-motion: reduce)').matches) {
                    row.node.classList.add('mce-just-completed');
                    setTimeout(() => row.node.classList.remove('mce-just-completed'), 600);
                }
                row.motionState = state;
            }
            row.node.dataset.state = state;
            row.select.value = state;
            row.select.disabled = !ready || pending.has(task.id) || state === 'submitted';
            row.select.dataset.busy = String(!ready || pending.has(task.id));
            row.select.title = state === 'submitted' ? 'Moodleで完了を確認済み' : '作業状況を変更';
            const observation = record?.tasks?.[task.id]?.moodle;
            const labels = task.kind === 'quiz'
                ? {submitted:'受験完了を確認',draft:'受験中・未完了',not_submitted:'未受験',unknown:'受験状況は未確認',error:'確認失敗：更新で再試行'}
                : {submitted:'提出完了を確認',draft:'下書き・未提出',not_submitted:'未提出',unknown:'提出状況は未確認',error:'確認失敗：更新で再試行'};
            row.evidence.textContent = !['assign','quiz'].includes(task.kind) ? 'この活動の完了状況は自動確認の対象外です' : checking.has(task.id) ? 'Moodleの状況を確認中…' : labels[observation?.status] || 'Moodle：未確認';
            row.evidence.dataset.status = observation?.status || 'unknown';
            row.evidence.title = row.evidence.textContent + (observation?.checkedAt ? ` · 最終確認：${new Date(observation.checkedAt).toLocaleString('ja-JP')}` : '');
            const deadline = deadlinePresentation(task.dueAt, state === 'submitted', Date.now(), !!task.fromTimeline);
            row.node.dataset.urgency = deadline.urgency;
            row.due.dataset.urgency = deadline.urgency;
            row.due.hidden = false;
            row.due.textContent = deadline.label || '締切情報なし';
            row.due.title = Number.isFinite(task.dueAt) ? `締切：${new Date(task.dueAt).toLocaleString('ja-JP')}` : '';
        }
        counts.textContent = `未着手 ${totals.todo} · 作業中 ${totals.doing} · 完了 ${totals.submitted}`;
        empty.hidden = tasks.length > 0;
        refresh.disabled = !ready || tasks.length === 0 || checking.size > 0;
    }
    function saveTask(id, state) {
        pending.set(id, state); syncRows();
        status.textContent = '保存中…';
        saveQueue = saveQueue.then(async () => {
            try {
                // Merge only the changed assignment into the latest course record.
                const latest = await chrome.storage.local.get(key);
                const next = updateRecord(latest[key] || {}, id, state);
                await chrome.storage.local.set({[key]:next});
                record = next;
                status.textContent = '保存しました';
            } catch (error) {
                status.textContent = '保存できませんでした。状態を選び直して再試行してください。';
                console.warn('Course checklist save failed:', error);
            } finally {
                pending.delete(id); syncRows();
            }
        });
    }
    function discover() {
        const found = new Map();
        for (const task of Object.values(deadlineCache)) {
            if (String(task.courseId) !== courseId) continue;
            const parsed = activityURL(task.href, location.href);
            if (parsed) found.set(parsed.id,{...task,...parsed,fromTimeline:true});
        }
        for (const link of content.querySelectorAll('a[href*="/mod/assign/view.php"], a[href*="/mod/quiz/view.php"]')) {
            const parsed = activityURL(link.href, location.href);
            if (!parsed) continue;
            const activity = link.closest('.activity');
            const preferred = !!activity?.classList.contains(`modtype_${parsed.kind}`);
            const copy = (preferred ? activity.querySelector('.activityname') || link : link).cloneNode(true);
            copy.querySelectorAll('.accesshide, .sr-only, .visually-hidden').forEach(el => el.remove());
            const name = copy.textContent.replace(/\s+/g, ' ').trim();
            if (!name || (found.has(parsed.id) && !preferred)) continue;
            found.set(parsed.id, {...found.get(parsed.id),...parsed, name});
        }
        const nextTasks = [...found.values()];
        const signature = JSON.stringify(nextTasks);
        if (signature === discoverySignature) return;
        discoverySignature = signature; tasks = nextTasks;
        for (const [id, row] of rows) if (!found.has(id)) {row.node.remove(); rows.delete(id);}
        for (const task of tasks) {
            let row = rows.get(task.id);
            if (!row) {
                const node = create('li', 'mce-checklist-task');
                const link = create('a', 'mce-checklist-link');
                const select = create('select', 'mce-checklist-select');
                for (const [value, label] of Object.entries(STATES)) {
                    const option = create('option', '', value === 'submitted' ? (task.kind === 'quiz' ? '受験済み' : '提出済み') : label);
                    option.value = value; option.disabled = value === 'submitted'; select.append(option);
                }
                const evidence = create('p', 'mce-checklist-evidence');
                const due = create('p', 'mce-checklist-due');
                select.addEventListener('change', () => saveTask(task.id, select.value));
                node.append(link, due, select, evidence); list.append(node);
                row = {node, link, select, evidence, due}; rows.set(task.id, row);
            }
            row.link.textContent = task.name; row.link.href = task.href;
            row.node.dataset.kind = task.kind;
            row.link.title = `${task.kind === 'quiz' ? 'クイズ' : task.kind === 'assign' ? '課題' : '活動'}：${task.name}`;
            row.select.setAttribute('aria-label', `${task.name}の作業状況。完了はMoodleから自動確認`);
        }
        syncRows();
        if (ready) scheduleChecks();
    }
    function scheduleChecks(force = false) {
        if (!ready || disposed) return;
        for (const task of tasks) {
            if (!['assign','quiz'].includes(task.kind)) continue;
            if (checking.has(task.id)) continue;
            const checkedAt = record?.tasks?.[task.id]?.moodle?.checkedAt || 0;
            if (!force && Date.now() - checkedAt < FRESH_MS) continue;
            checking.add(task.id); checkQueue.push(task);
        }
        syncRows(); runChecks();
    }
    function runChecks() {
        while (!disposed && activeChecks < 2 && checkQueue.length) {
            const task = checkQueue.shift();
            activeChecks++;
            checkSubmission(task).finally(() => {
                activeChecks--; checking.delete(task.id); syncRows(); runChecks();
            });
        }
    }
    async function checkSubmission(task) {
        const controller = new AbortController(); controllers.add(controller);
        const timeout = setTimeout(() => controller.abort(), 12000);
        let moodleStatus = 'error';
        try {
            // Read-only request: never submit, mark complete or modify Moodle data.
            const response = await fetch(task.href, {credentials:'same-origin', redirect:'error', signal:controller.signal});
            if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('Submission page unavailable');
            const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
            moodleStatus = task.kind === 'quiz' ? parseQuizDocument(doc) : parseSubmissionDocument(doc);
        } catch (error) {
            if (disposed) return;
        } finally {
            clearTimeout(timeout); controllers.delete(controller);
        }
        if (disposed) return;
        // Serialize with progress edits, retaining other assignments and tabs' updates.
        saveQueue = saveQueue.then(async () => {
            try {
                const latest = await chrome.storage.local.get(key);
                const next = observeSubmission(latest[key] || {}, task.id, moodleStatus);
                await chrome.storage.local.set({[key]:next}); record = next;
            } catch (error) { status.textContent = '確認結果を保存できませんでした。更新ボタンで再試行してください。'; }
        });
        await saveQueue;
    }
    async function loadRecord() {
        try {
            const stored = await chrome.storage.local.get([key,CACHE_KEY]);
            deadlineCache = stored[CACHE_KEY] || {};
            record = stored[key] || {}; ready = true;
            status.textContent = ''; retry.hidden = true;
        } catch (error) {
            ready = false; retry.hidden = false;
            status.textContent = '保存済みの状態を読み込めませんでした。再読み込みしてください。';
        }
        syncRows();
        discover();
        if (ready) scheduleChecks();
    }
    retry.addEventListener('click', loadRecord);
    const storageChanged = (changes, area) => {
        if (area !== 'local') return;
        if (Object.hasOwn(changes,CACHE_KEY)) {deadlineCache=changes[CACHE_KEY].newValue || {};discover();}
        if (!Object.hasOwn(changes, key)) return;
        record = changes[key].newValue || {}; syncRows();
    };
    chrome.storage.onChanged.addListener(storageChanged);
    let discoveryTimer, layoutFrame;
    const contentObserver = new MutationObserver(() => {
        clearTimeout(discoveryTimer); discoveryTimer = setTimeout(discover, 150);
    });
    contentObserver.observe(content, {childList:true,subtree:true,attributes:true,attributeFilter:['href']});
    function position() {
        layoutFrame = null;
        if (document.documentElement.classList.contains('mce-reference-keep-checklist')) {
            const style = document.documentElement.style;
            panel.dataset.placement = 'gutter';
            panel.style.setProperty('--mce-checklist-left', style.getPropertyValue('--mce-reference-checklist-left'));
            panel.style.setProperty('--mce-checklist-width', style.getPropertyValue('--mce-reference-checklist-width'));
            return;
        }
        const main = document.querySelector('#page .main-inner') || host;
        const rect = main.getBoundingClientRect();
        const drawer = document.getElementById('theme_boost-drawers-courseindex');
        const drawerRight = drawer ? Math.max(0, drawer.getBoundingClientRect().right) : 0;
        const available = rect.left - drawerRight - 40;
        if (innerWidth >= 1200 && available >= 260) {
            const width = Math.min(300, available);
            panel.dataset.placement = 'gutter';
            panel.style.setProperty('--mce-checklist-left', `${rect.left - width - 20}px`);
            panel.style.setProperty('--mce-checklist-width', `${width}px`);
        } else panel.dataset.placement = 'inline';
    }
    const schedulePosition = () => {if (!layoutFrame) layoutFrame = requestAnimationFrame(position);};
    const deadlineTimer = setInterval(() => {if (!document.hidden) syncRows();}, 60000);
    const resizeObserver = new ResizeObserver(schedulePosition);
    resizeObserver.observe(document.querySelector('#page .main-inner') || host);
    const layoutObserver = new MutationObserver(schedulePosition);
    layoutObserver.observe(document.body, {attributes:true,attributeFilter:['class']});
    if (document.getElementById('page')) layoutObserver.observe(document.getElementById('page'), {attributes:true,attributeFilter:['class']});
    if (document.getElementById('theme_boost-drawers-courseindex')) layoutObserver.observe(document.getElementById('theme_boost-drawers-courseindex'), {attributes:true,attributeFilter:['class']});
    window.addEventListener('resize', schedulePosition);
    window.addEventListener('mce-reference-layout', schedulePosition);
    document.addEventListener('transitionend', schedulePosition);
    window.addEventListener('pageshow', event => {
        if (event.persisted) {loadRecord(); discover(); schedulePosition();}
    });
    window.addEventListener('pagehide', event => {
        if (event.persisted) return;
        disposed = true; checkQueue.length = 0;
        for (const controller of controllers) controller.abort();
        contentObserver.disconnect(); layoutObserver.disconnect(); resizeObserver.disconnect();
        chrome.storage.onChanged.removeListener(storageChanged);
        clearTimeout(discoveryTimer); clearInterval(deadlineTimer); cancelAnimationFrame(layoutFrame);
        window.removeEventListener('resize', schedulePosition);
        window.removeEventListener('mce-reference-layout', schedulePosition);
        document.removeEventListener('transitionend', schedulePosition);
    }, {once:true});
    discover(); position(); await loadRecord();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startChecklist, {once:true});
else startChecklist();
