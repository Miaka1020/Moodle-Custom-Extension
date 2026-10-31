module.exports = function dashboardGuide() {
    if (!/\/my\/(?:index\.php)?$/.test(location.pathname)) return;
    const stateKey = 'mce_dashboard_guide_open_v1';
    const features = [
        ['外観とレイアウト', '右上の歯車', 'ダークモード・背景・透明度・フォントを調整。「洗練UI」「拡張レイアウト」「アニメーション」も選べます。'],
        ['週間時間割', '時間割の「編集」', '科目を検索して配置し、保存すると反映。淡い色で授業を見分け、今日の曜日には印を表示します。書き出し・読み込みにも対応。'],
        ['締切の確認', 'タイムライン', '掲載時から締切を強調し、残り3日・24時間で表示を変更。見出し横のパレットで色を選べます。'],
        ['課題・クイズ', 'コース画面の左側', '課題名・締切・状態を一覧で確認。小さな状態欄から「作業中」に変更できます。提出・受験の完了は自動で反映し、長いコースは本文上の目次から移動できます。'],
        ['出席の記録', 'コース画面の出席管理', '出席・遅刻・欠席と、あと何回休めるかを確認。授業回数や出席率は歯車から設定できます。大学への出席送信とは別の記録です。'],
        ['資料を見ながら学習', '右下の本のボタン', 'PDF・TXTを横に表示。「URL」からPOLITEのPDF・資料ページも開けます。前回の資料は次回も復元します。']
    ];
    const insert = () => {
        if (document.getElementById('mce-dashboard-guide')) return;
        const region = document.querySelector('#block-region-content');
        if (!region) return;
        const blocks = [...region.querySelectorAll('.block')];
        const announcement = blocks.find(block => block.matches('.block_site_announcements, .block_news_items')) ||
            blocks.find(block => /アナウンスメント|アナウンス|announcements|サイトニュース/i.test(block.querySelector('.card-title, h5, h4, h3, h2')?.textContent || ''));
        if (!announcement) return;
        const target = announcement.querySelector('.content') || announcement.querySelector('.card-body');
        if (!target) return;
        const guide = document.createElement('details');
        guide.id = 'mce-dashboard-guide';
        try {guide.open = localStorage.getItem(stateKey) !== 'closed';} catch (_) {guide.open = true;}
        const summary = document.createElement('summary');
        summary.textContent = 'Custom-POLITEの使い方';
        guide.append(summary);
        const list = document.createElement('dl');
        for (const [title, location, description] of features) {
            const item = document.createElement('div');
            const term = document.createElement('dt'); term.textContent = title;
            const detail = document.createElement('dd');
            const where = document.createElement('p');
            where.className = 'mce-guide-location';
            where.textContent = location;
            const text = document.createElement('p');
            text.textContent = description;
            detail.append(where, text);
            item.append(term, detail);
            list.append(item);
        }
        guide.append(list);
        guide.addEventListener('toggle', () => {
            try {localStorage.setItem(stateKey, guide.open ? 'open' : 'closed');} catch (_) {}
        });
        target.prepend(require('./extension-info')(), guide);
    };
    insert();
    new MutationObserver(insert).observe(document.body, {childList:true, subtree:true});
};
