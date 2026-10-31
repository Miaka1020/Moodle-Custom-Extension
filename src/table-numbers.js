function start(){
    let pending=false;
    function scan(){
        for(const cell of document.querySelectorAll('table.generaltable td,table.user-grade td,.grade-report-user table td')){
            if(cell.querySelector('input,select,button'))continue;
            const number=/^[+−-]?\d[\d,]*(?:\.\d+)?\s*(?:%|\/\s*\d[\d,]*(?:\.\d+)?)?$/u.test(cell.textContent.trim());
            cell.classList.toggle('mce-number-cell',number);
        }
    }
    const observer=new MutationObserver(()=>{if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;scan();});});
    observer.observe(document.getElementById('region-main') || document.body,{subtree:true,childList:true,characterData:true});
    window.addEventListener('pagehide',event=>{if(!event.persisted)observer.disconnect();});scan();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
