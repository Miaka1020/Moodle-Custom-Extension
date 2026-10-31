module.exports=function settingsSectionValues(modal){
    const sections=[...modal.querySelectorAll('.mce-settings-section')].map(section=>{
        const value=document.createElement('span');value.className='mce-settings-value';
        section.querySelector('summary').append(value);
        return {group:section.querySelector('.settings-group'),value};
    });
    function update(){
        for(const {group,value} of sections){
            const read=id=>group.querySelector('#'+id);
            let text='';
            if(read('darkModeModeSelect'))text='ダークモード：'+({off:'オフ',on:'オン',auto:'自動'}[read('darkModeModeSelect').value] || 'オフ');
            else if(read('contentOpacityRange'))text=({left:'左寄せ',center:'中央',right:'右寄せ'}[read('contentAlignSelect')?.value] || '中央')+' / '+read('contentOpacityRange').value+'%';
            else if(read('fontFamilySelect'))text=read('customFontNameInput')?.value.trim() || read('fontFamilySelect').selectedOptions[0]?.textContent || '標準';
            else if(read('opacityRange')){
                const kind=read('bg-type-video')?.checked?'動画':read('bg-type-image')?.checked?'画像':'なし';
                text=kind==='なし'?kind:`${kind} / ${read('opacityRange').value}%`;
            }else if(read('enableCustomLayoutCheckbox')){
                text=`拡張：${read('enableCustomLayoutCheckbox').checked?'オン':'オフ'}・時間割：${read('showTimetableCheckbox')?.checked?'表示':'非表示'}`;
            }else{
                const colors=[...group.querySelectorAll('input[type="color"]')];
                const labels=colors.map(input=>(group.querySelector(`label[for="${input.id}"]`) || input.closest('.color-item')?.querySelector('label'))?.textContent.trim() || '色');
                // Swatches show the actual saved/edited colors without a long row of hex codes.
                if(value.childElementCount!==colors.length){
                    value.replaceChildren(...colors.map(()=>{const swatch=document.createElement('span');swatch.className='mce-settings-swatch';return swatch;}));
                }
                colors.forEach((input,index)=>{
                    const swatch=value.children[index];swatch.style.backgroundColor=input.value;
                    swatch.title=`${labels[index]}：${input.value}`;
                    swatch.setAttribute('role','img');swatch.setAttribute('aria-label',swatch.title);
                });
                value.title=colors.map((input,index)=>`${labels[index]}：${input.value}`).join(' / ');
                continue;
            }
            if(value.textContent!==text)value.textContent=text;
            value.title=text;
        }
    }
    modal.addEventListener('input',update);modal.addEventListener('change',update);
    modal.addEventListener('mce-settings-values-loaded',update);
    new MutationObserver(update).observe(modal,{attributes:true,attributeFilter:['style']});
    const info=modal.querySelector('#currentBackgroundInfo');
    if(info)new MutationObserver(update).observe(info,{childList:true,subtree:true,characterData:true});
    update();
};
