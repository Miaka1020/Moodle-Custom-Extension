const messages=new WeakMap();
module.exports=function feedback(target,text,error=false){
    if(!target?.isConnected)return;
    const previous=messages.get(target);if(previous){clearTimeout(previous.timer);previous.node.remove();window.removeEventListener('scroll',previous.position,true);}
    const node=document.createElement('span');node.className='mce-action-feedback';node.dataset.error=String(error);
    node.setAttribute('role','status');node.textContent=text;document.body.append(node);
    const position=()=>{
        const rect=target.getBoundingClientRect(),box=node.getBoundingClientRect();
        node.style.left=Math.max(8,Math.min(innerWidth-box.width-8,rect.right-box.width))+'px';
        node.style.top=(rect.bottom+box.height+12<=innerHeight?rect.bottom+6:Math.max(8,rect.top-box.height-6))+'px';
    };
    position();
    const timer=setTimeout(()=>{node.remove();messages.delete(target);window.removeEventListener('scroll',position,true);},error?6000:3000);
    window.addEventListener('scroll',position,{capture:true,passive:true});
    messages.set(target,{node,timer,position});
};
