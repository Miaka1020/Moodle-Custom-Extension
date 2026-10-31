export function versionParts(value) {
    const match = String(value || '').match(/^v?(\d{1,5}(?:\.\d{1,5}){0,3})$/i);
    return match ? match[1].split('.').map(Number) : null;
}
export function compareVersions(left, right) {
    const a = versionParts(left), b = versionParts(right);
    if (!a || !b) return null;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const diff = (a[i] || 0) - (b[i] || 0);
        if (diff) return Math.sign(diff);
    }
    return 0;
}
export function updateStatus(current, latest) {
    const newer = compareVersions(latest?.version, current) === 1;
    return {version:latest?.version || null, available:newer};
}
