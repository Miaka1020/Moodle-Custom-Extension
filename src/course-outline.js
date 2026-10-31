function initOutline() {
    if (!/\/course\/view\.php$/.test(location.pathname)) return;
    const content = document.querySelector('.course-content');
    if (!content || document.getElementById('mce-course-outline')) return;
    const nav = document.createElement('nav');
    nav.id = 'mce-course-outline';
    nav.setAttribute('aria-label', 'コースの目次');
    const details = document.createElement('details'); details.open = true;
    const summary = document.createElement('summary');
    const title = document.createElement('span'); title.textContent = '目次';
    const current = document.createElement('span'); current.className = 'mce-outline-current';
    summary.append(title, current);
    const list = document.createElement('ol');
    details.append(summary, list); nav.append(details); content.before(nav);
    let entries = [], signature = '', scheduled = false;
    let intersection;
    function select(entry) {
        if (!entry) return;
        for (const item of entries) {
            if (item === entry) item.link.setAttribute('aria-current', 'location');
            else item.link.removeAttribute('aria-current');
        }
        current.textContent = entry.name;
    }
    function updatePosition() {
        scheduled = false;
        const edge = 90;
        let active = entries[0];
        for (const entry of entries) {
            if (entry.section.getBoundingClientRect().top <= edge) active = entry;
            else break;
        }
        select(active);
    }
    const schedule = () => {if (!scheduled) {scheduled=true; requestAnimationFrame(updatePosition);}};
    function discover() {
        const sections = [...content.querySelectorAll('.section, .course-section')].filter(section =>
            !section.parentElement.closest('.section, .course-section') && !section.hidden);
        const found = sections.map((section, index) => {
            const heading = section.querySelector('.sectionname, .section-title, h3, h2');
            const copy = heading?.cloneNode(true);
            copy?.querySelectorAll('.accesshide,.sr-only,.visually-hidden,button').forEach(el=>el.remove());
            const name = copy?.textContent.replace(/\s+/g,' ').trim() || (index===0?'一般':`セクション ${index}`);
            if (!section.id) section.id = `mce-course-section-${index}`;
            return {section,name,id:section.id};
        });
        const next = JSON.stringify(found.map(entry=>[entry.id,entry.name]));
        if (next === signature && found.every((entry,index)=>entries[index]?.section===entry.section)) return;
        signature = next; intersection?.disconnect(); entries = []; list.replaceChildren();
        nav.hidden = found.length < 3;
        for (const item of found) {
            const li = document.createElement('li');
            const link = document.createElement('a'); link.href = '#' + encodeURIComponent(item.id); link.textContent=item.name;
            const entry = {...item, link}; entries.push(entry); li.append(link); list.append(li);
            link.addEventListener('click', event => {
                if (event.button!==0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                const toggle = item.section.querySelector('button[aria-expanded="false"][aria-controls], a[aria-expanded="false"][data-toggle="collapse"], a[aria-expanded="false"][data-bs-toggle="collapse"]');
                toggle?.click();
                requestAnimationFrame(()=> {
                    item.section.scrollIntoView({block:'start',behavior:document.documentElement.classList.contains('mce-animations') && !matchMedia('(prefers-reduced-motion: reduce)').matches?'smooth':'auto'});
                    select(entry);
                    // Keep Moodle's section anchors and normal browser history working.
                    if (location.hash !== link.hash) history.pushState(null,'',link.hash);
                    const heading = item.section.querySelector('.sectionname, .section-title, h3, h2') || item.section;
                    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex','-1');
                    heading.focus({preventScroll:true});
                });
            });
        }
        if (typeof IntersectionObserver !== 'undefined') {
            intersection = new IntersectionObserver(schedule, {rootMargin:'-100px 0px -50% 0px'});
            for (const entry of entries) intersection.observe(entry.section);
        }
        schedule();
    }
    let timer;
    const observer = new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(discover,180);});
    observer.observe(content,{childList:true,subtree:true});
    window.addEventListener('scroll',schedule,{passive:true});
    window.addEventListener('resize',schedule);
    window.addEventListener('pagehide', event=> {
        if (event.persisted) return;
        observer.disconnect(); intersection?.disconnect(); clearTimeout(timer);
        window.removeEventListener('scroll',schedule); window.removeEventListener('resize',schedule);
    });
    discover();
}
if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',initOutline,{once:true});
else initOutline();
