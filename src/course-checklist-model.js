const STATES = Object.freeze({todo:'未着手', doing:'作業中', submitted:'提出済み'});
function storageKey(courseId) { return `moodle_course_checklist_v1:${courseId}`; }
function taskState(record, id) {
    const task = record?.tasks?.[id];
    if (task?.moodle?.status === 'submitted') return 'submitted';
    // Legacy self-checked submitted flags are never treated as Moodle evidence.
    return task?.state === 'doing' ? 'doing' : 'todo';
}
function updateRecord(record, id, state, now = Date.now()) {
    if (!['todo','doing'].includes(state)) throw new Error('Only work progress can be set manually');
    return {...record, tasks:{...record?.tasks, [id]:{...record?.tasks?.[id], state, updatedAt:now}}};
}
function observeSubmission(record, id, status, now = Date.now()) {
    if (!['submitted','draft','not_submitted','unknown','error'].includes(status)) throw new Error('Unknown Moodle status');
    return {...record, tasks:{...record?.tasks, [id]:{...record?.tasks?.[id], moodle:{status, checkedAt:now}}}};
}
function parseSubmissionDocument(doc) {
    const table = doc.querySelector('.submissionstatustable');
    if (!table) return 'unknown';
    if (table.querySelector('.submissionstatusdraft')) return 'draft';
    if (table.querySelector('.submissionstatusnew, .submissionstatusreopened')) return 'not_submitted';
    if (table.querySelector('.submissionstatussubmitted')) return 'submitted';
    for (const row of table.querySelectorAll('tr')) {
        const cells = [...row.querySelectorAll('th, td')];
        if (cells.length < 2 || !/^(提出ステータス|submission status)$/i.test(cells[0].textContent.trim())) continue;
        const value = cells[1].textContent.replace(/\s+/g,' ').trim();
        if (/下書き|draft/i.test(value)) return 'draft';
        if (/まだ提出されていません|提出されていません|未提出|no submissions? (have been made|yet)|not submitted|nothing has been submitted/i.test(value)) return 'not_submitted';
        if (/^(評定のために提出済み[。.]?|submitted for grading[。.]?)$/i.test(value)) return 'submitted';
    }
    return 'unknown';
}
function activityURL(href, base) {
    try {
        const url = new URL(href, base);
        const id = url.searchParams.get('id');
        const match = url.pathname.match(/\/mod\/([a-z][a-z0-9_]*)\/view\.php$/);
        if (url.origin !== new URL(base).origin || !match || !/^\d+$/.test(id || '')) return null;
        url.search = `?id=${id}`;
        url.hash = '';
        return {id:match[1] === 'assign' ? id : `${match[1]}:${id}`, moduleId:id, kind:match[1], href:url.href};
    } catch (_) { return null; }
}
function assignmentURL(href, base) {
    const task = activityURL(href, base);
    return task?.kind === 'assign' ? task : null;
}
function parseQuizDocument(doc) {
    let inProgress = false;
    // Single-attempt Moodle pages can expose a review summary on view.php.
    for (const table of doc.querySelectorAll('.quizreviewsummary, .quizattemptsummary')) {
        const headers = [...table.querySelectorAll('thead th')].map(e=>e.textContent.trim());
        const stateColumn = headers.findIndex(t=>/^(状態|ステータス|state|status)$/i.test(t));
        for (const row of table.querySelectorAll('tr')) {
            const cells = [...row.querySelectorAll('th,td')];
            let text = '';
            if (table.classList.contains('quizreviewsummary') && cells.length >= 2 && /^(状態|ステータス|state|status)$/i.test(cells[0].textContent.trim())) text = cells[1].textContent.trim();
            else {
                const stateCell = row.querySelector('.state, .statedetails, [data-state]');
                text = stateCell?.getAttribute('data-state') || stateCell?.textContent.trim() || (stateColumn >= 0 ? cells[stateColumn]?.textContent.trim() : '') || '';
            }
            // Grades and review links alone do not prove an attempt was submitted.
            if (/^(終了|完了|finished|completed)(?:$|\s|[。:：])/i.test(text)) return 'submitted';
            if (/受験中|進行中|in.?progress|overdue|abandoned|未完了/i.test(text)) inProgress = true;
        }
    }
    if (inProgress) return 'draft';
    const area = doc.querySelector('.quizattempt');
    if (area) {
        const labels = [...area.querySelectorAll('button,input[type="submit"],a')].map(e=>e.getAttribute('value') || e.textContent.trim()).join(' ');
        if (/受験を続ける|continue.*attempt/i.test(labels)) return 'draft';
        if (/小テストを受験する|問題を受験する|小テストを開始する|attempt quiz now|start attempt/i.test(labels)) return 'not_submitted';
    }
    return 'unknown';
}
function courseIdFromDocument(doc, base) {
    const ids = new Set();
    for (const link of doc.querySelectorAll('.breadcrumb a[href], [data-region="page-header"] a[href]')) {
        try {
            const url = new URL(link.getAttribute('href'), base);
            if (url.origin === new URL(base).origin && url.pathname.endsWith('/course/view.php') && /^\d+$/.test(url.searchParams.get('id') || '')) ids.add(url.searchParams.get('id'));
        } catch (_) {}
    }
    return ids.size === 1 ? [...ids][0] : null;
}
function deadlinePresentation(dueAt, complete, now = Date.now(), listed = false) {
    if (!Number.isFinite(dueAt)) return listed && !complete ? {urgency:'listed',label:'締切一覧に掲載中'} : {urgency:'none',label:''};
    const date = new Date(dueAt);
    const when = date.toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
    const remaining = dueAt - now;
    if (complete) return {urgency:'complete',label:`締切 ${when}`};
    if (remaining <= 0) return {urgency:'overdue',label:`期限超過 · ${when}`};
    if (remaining < 3600000) return {urgency:'critical',label:`締切直前 · あと${Math.max(1,Math.ceil(remaining / 60000))}分`};
    if (remaining <= 86400000) return {urgency:'urgent',label:`${date.toDateString() === new Date(now).toDateString() ? '今日締切' : '24時間以内'} · あと${Math.ceil(remaining / 3600000)}時間`};
    if (remaining <= 3 * 86400000) return {urgency:'soon',label:`締切まであと${Math.ceil(remaining / 86400000)}日`};
    return listed ? {urgency:'listed',label:`締切まであと${Math.ceil(remaining / 86400000)}日`} : {urgency:'normal',label:`締切 ${when}`};
}
module.exports = {STATES, storageKey, taskState, updateRecord, assignmentURL, activityURL, observeSubmission, parseSubmissionDocument, parseQuizDocument, courseIdFromDocument, deadlinePresentation};
