const entries=new Map();
const enabled=()=>document.documentElement.classList.contains('mce-animations')&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
function finish(element,entry){
    if(entries.get(element)!==entry)return;
    entries.delete(element);
    if(entry.details)element.open=entry.open;
    else element.style.display=entry.open?'block':'none';
    element.style.height=entry.height;element.style.overflow=entry.overflow;
}
function animate(element,open,details=false){
    const previous=entries.get(element),start=element.getBoundingClientRect().height;
    const height=previous?.height ?? element.style.height,overflow=previous?.overflow ?? element.style.overflow;
    previous?.animation?.cancel();
    const entry={open,details,height,overflow};entries.set(element,entry);
    if(!enabled() || typeof element.animate!=='function'){finish(element,entry);return;}
    let end;
    if(details){
        element.style.height='';element.open=open;end=element.getBoundingClientRect().height;element.open=true;
    }else{
        element.style.height='';element.style.display='block';end=open?element.getBoundingClientRect().height:0;
    }
    element.style.overflow='hidden';
    entry.animation=element.animate([{height:start+'px'},{height:end+'px'}],{duration:180,easing:'ease-out',fill:'both'});
    entry.animation.finished.then(()=>{finish(element,entry);entry.animation.cancel();},()=>{});
}
function isPanelOpen(element){return entries.get(element)?.open ?? getComputedStyle(element).display!=='none';}
function init(){
    document.addEventListener('click',event=>{
        const summary=event.target.closest?.('.mce-settings-section > summary,#mce-dashboard-guide > summary,#mce-course-outline summary');
        if(!summary || event.defaultPrevented || event.button!==0 || !enabled() || typeof summary.parentElement.animate!=='function')return;
        event.preventDefault();const details=summary.parentElement;
        animate(details,!(entries.get(details)?.open ?? details.open),true);
    });
    const stop=()=>{if(!enabled())for(const [element,entry] of entries){entry.animation?.cancel();finish(element,entry);}};
    new MutationObserver(stop).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',stop);
    window.addEventListener('pagehide',()=>{for(const [element,entry] of entries){entry.animation?.cancel();finish(element,entry);}});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
module.exports={animatePanel:(element,open)=>animate(element,open),isPanelOpen};
