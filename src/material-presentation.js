const {materialKind}=require('./material-kind');
const {activityURL}=require('./course-checklist-model');
const icons={
 pdf:['PDF','<path d="M6 3h8l4 4v14H6zM14 3v5h4"/><text x="7.5" y="17" font-size="6" font-family="system-ui" fill="currentColor" stroke="none">PDF</text>'],
 file:['ファイル','<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/>'],
 assign:['課題','<path d="M9 5H6v16h12V5h-3M9 3h6v4H9zM9 13l2 2 4-4"/>'],
 quiz:['クイズ','<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h1m3 0h4M8 12h1m3 0h4M8 16h1m3 0h4"/>'],
 folder:['フォルダ','<path d="M3 6h7l2 3h9v11H3z"/>'],
 link:['リンク','<path d="M10 7l2-2a5 5 0 0 1 7 7l-2 2M14 17l-2 2a5 5 0 0 1-7-7l2-2M8 16l8-8"/>'],
 page:['ページ','<path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5"/>'],
 book:['ブック','<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1zM12 5v15"/>']
};
function start(){
    const content=document.querySelector('.course-content');if(!content)return;
    function scan(){
        if(!document.documentElement.classList.contains('mce-refined-ui')){
            content.querySelectorAll('.mce-material-icon').forEach(icon=>icon.remove());
            content.querySelectorAll('.mce-material-link').forEach(link=>link.classList.remove('mce-material-link'));
            content.querySelectorAll('.mce-material-row').forEach(row=>{
                row.classList.remove('mce-material-row');
                delete row.dataset.mceMaterialKind;delete row.dataset.mceMaterialComplete;
            });
            return;
        }
        const completed=new Set([...document.querySelectorAll('#mce-course-checklist .mce-checklist-task[data-state="submitted"] .mce-checklist-link')].map(link=>activityURL(link.href,location.href)?.id).filter(Boolean));
        for(const row of content.querySelectorAll('.activity')){
            const link=row.querySelector('.activityname a[href],.activityinstance a[href],a.aalink[href],a.activityname[href],.activity-name-area a[href]');
            if(!link)continue;
            const match=link.getAttribute('href')?.match(/\/mod\/([a-z]+)\//);
            const module=match?.[1] || [...row.classList].find(name=>name.startsWith('modtype_'))?.slice(8);
            const native=row.querySelector('img.activityicon,.activityiconcontainer img');
            const kind=materialKind(module,link.href,(native?.getAttribute('src') || '')+' '+(native?.getAttribute('alt') || ''));
            if(!kind)continue;
            row.classList.add('mce-material-row');row.dataset.mceMaterialKind=kind;
            const complete=completed.has(activityURL(link.href,location.href)?.id);
            row.dataset.mceMaterialComplete=String(complete);
            link.classList.add('mce-material-link');
            let icon=link.querySelector('.mce-material-icon');
            if(!icon){icon=document.createElement('span');icon.className='mce-material-icon';link.prepend(icon);}
            if(icon.dataset.kind===kind)continue;
            icon.dataset.kind=kind;icon.setAttribute('role','img');icon.setAttribute('aria-label',icons[kind][0]);icon.title=icons[kind][0];
            icon.innerHTML=`<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[kind][1]}</svg>`;
        }
    }
    let pending=false;
    const schedule=()=>{if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;scan();});};
    const observer=new MutationObserver(schedule);
    observer.observe(content,{subtree:true,childList:true,attributes:true,attributeFilter:['href','src']});
    const checklist=document.getElementById('mce-course-checklist');
    if(checklist)observer.observe(checklist,{subtree:true,childList:true,attributes:true,attributeFilter:['data-state']});
    let refined=document.documentElement.classList.contains('mce-refined-ui');
    const modeObserver=new MutationObserver(()=>{
        const next=document.documentElement.classList.contains('mce-refined-ui');
        if(next!==refined){refined=next;schedule();}
    });
    modeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['class']});
    window.addEventListener('pagehide',event=>{if(!event.persisted){observer.disconnect();modeObserver.disconnect();}});
    scan();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
