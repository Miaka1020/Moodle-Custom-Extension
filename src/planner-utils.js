const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function courseTone(id) {
    let hash = 0;
    for (const char of String(id ?? '')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return String(hash % 4);
}
module.exports = {escapeHTML, courseTone};
