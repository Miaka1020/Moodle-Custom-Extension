const {materialKind}=require('./material-kind');
let receiver,refresh;
function pdfURL(link){
    try{
        const url=new URL(link.href,location.href);
        if(url.origin!==location.origin || url.protocol!=='https:')return null;
        if(/\.pdf$/i.test(url.pathname))return url.href;
        if(!/\/mod\/resource\/view\.php$/.test(url.pathname))return null;
        const row=link.closest('.activity'),icon=row?.querySelector('img.activityicon,.activityiconcontainer img');
        return materialKind('resource',url.href,(icon?.getAttribute('src') || '')+' '+(icon?.getAttribute('alt') || ''))==='pdf'?url.href:null;
    }catch(_){return null;}
}
function start(){
    const content=document.querySelector('.course-content');if(!content)return;
    const buttons=new Map();
    refresh=()=>{
        if(!receiver)return;
        for(const [link,button] of buttons)if(!link.isConnected || !content.contains(link) || !pdfURL(link)){button.remove();buttons.delete(link);}
        for(const link of content.querySelectorAll('a[href]')){
            const url=pdfURL(link);if(!url || buttons.has(link))continue;
            const button=document.createElement('button');button.type='button';button.className='mce-add-reference';
            button.textContent='資料参照に追加';button.setAttribute('aria-label','このPDFを右側の資料参照に追加');
            button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();const current=pdfURL(link);if(current)receiver?.(current,button);});
            link.after(button);buttons.set(link,button);
        }
    };
    let pending=false;const observer=new MutationObserver(()=>{if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;refresh();});});
    observer.observe(content,{subtree:true,childList:true,attributes:true,attributeFilter:['href','src']});
    window.addEventListener('pagehide',event=>{if(!event.persisted)observer.disconnect();});refresh();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
function fillReference(url,{input,form,toggle,status,open}){
    input.value=require('./reference-pdf').normalizeURL(url,location.href);
    open();form.hidden=false;toggle.setAttribute('aria-expanded','true');
    status.textContent='URLを追加しました。「表示」でPDFを開けます。';input.focus();
}
module.exports={connect:callback=>{receiver=callback;refresh?.();},pdfURL,fillReference};
