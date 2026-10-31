function materialKind(module,href='',icon=''){
    if(module==='resource')return /\.pdf(?:[\s?#]|$)|(?:^|[\s\/_?=-])pdf(?:[\s\/_?.=-]|$)/i.test(href+' '+icon)?'pdf':'file';
    return ({assign:'assign',quiz:'quiz',folder:'folder',url:'link',page:'page',book:'book'})[module] || null;
}
module.exports={materialKind};
