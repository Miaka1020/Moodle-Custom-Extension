const {activityURL, courseIdFromDocument} = require('./course-checklist-model');
const CACHE_KEY = 'moodle_timeline_checklist_v1';
const normalize = text => text.replace(/\s+/g,'').trim();

function startDeadlineCache() {
    if (!location.pathname.includes('/my/')) return;
    let timer, signature = '', disposed = false, queue = Promise.resolve();
    const controllers = new Set();
    async function collect() {
        const timeline = document.querySelector('.block_timeline');
        if (!timeline || disposed) return;
        const courses = new Map();
        for (const link of document.querySelectorAll('a[href*="/course/view.php"]')) {
            try {
                const url = new URL(link.href, location.href);
                const id = url.searchParams.get('id');
                if (url.origin !== location.origin || !/^\d+$/.test(id || '')) continue;
                const copy = link.cloneNode(true);
                copy.querySelectorAll('.accesshide,.sr-only,.visually-hidden').forEach(e=>e.remove());
                const name = normalize(copy.textContent);
                if (!name) continue;
                if (!courses.has(name)) courses.set(name, new Set());
                courses.get(name).add(id);
            } catch (_) {}
        }
        const tasks = new Map();
        for (const group of timeline.querySelectorAll('[data-region="event-list-content-date"]')) {
            for (const item of group.nextElementSibling?.querySelectorAll('[data-region="event-list-item"]') || []) {
                const info = item.querySelector('.event-name-container small')?.textContent || '';
                if (!/due|closes|提出期限|終了/i.test(info)) continue;
                const link = item.querySelector('.event-name-container a[href]');
                const parsed = link && activityURL(link.href, location.href);
                if (!parsed) continue;
                const courseName = info.split(/[·・]/).at(-1).trim();
                const matches = courses.get(normalize(courseName));
                const courseId = matches?.size === 1 ? [...matches][0] : null;
                const base = Number(group.dataset.timestamp) * 1000;
                const time = item.querySelector('.timeline-name > small.text-nowrap')?.textContent.match(/(\d{1,2}):(\d{2})/);
                let dueAt = null;
                if (Number.isFinite(base) && time) {const date = new Date(base); date.setHours(Number(time[1]),Number(time[2]),0,0); dueAt=date.getTime();}
                tasks.set(parsed.id, {...parsed,name:link.textContent.trim(),courseName,courseId,dueAt});
            }
        }
        const payload = [...tasks.values()];
        const nextSignature = JSON.stringify(payload);
        if (nextSignature === signature) return;
        signature = nextSignature;
        queue = queue.then(async () => {
            try {
                const stored = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY] || {};
                const next = {...stored};
                for (const task of payload) next[task.id] = {...stored[task.id],...task,courseId:task.courseId || stored[task.id]?.courseId || null,seenAt:Date.now()};
                await chrome.storage.local.set({[CACHE_KEY]:next});
                // Only unresolved course ownership requires a read-only activity page.
                const unresolved = payload.filter(task=>!next[task.id].courseId && ['assign','quiz'].includes(task.kind));
                for (const task of unresolved) {
                    if (disposed) break;
                    const controller = new AbortController(); controllers.add(controller);
                    const timeout = setTimeout(()=>controller.abort(),12000);
                    try {
                        const response = await fetch(task.href,{credentials:'same-origin',redirect:'error',signal:controller.signal});
                        if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) continue;
                        const doc = new DOMParser().parseFromString(await response.text(),'text/html');
                        const courseId = courseIdFromDocument(doc,task.href);
                        if (!courseId || disposed) continue;
                        const latest = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY] || {};
                        if (latest[task.id]) await chrome.storage.local.set({[CACHE_KEY]:{...latest,[task.id]:{...latest[task.id],courseId}}});
                    } catch (_) { /* Keep unassigned; never guess a course from a similar name. */ }
                    finally {clearTimeout(timeout); controllers.delete(controller);}
                }
            } catch (error) {signature=''; console.warn('Deadline checklist cache failed:',error);}
        });
    }
    const observer = new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(collect,200);});
    observer.observe(document.getElementById('region-main') || document.body,{childList:true,subtree:true});
    window.addEventListener('pagehide',event=>{if(event.persisted)return;disposed=true;observer.disconnect();clearTimeout(timer);controllers.forEach(c=>c.abort());},{once:true});
    collect();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',startDeadlineCache,{once:true});
else startDeadlineCache();
module.exports = {CACHE_KEY};
