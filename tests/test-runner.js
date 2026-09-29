// ==========================================
// FavGallery 逻辑测试台 - 运行器
// 说明：MV3 扩展页面 CSP 为 script-src 'self'，禁止内联脚本，
//       因此测试台逻辑必须放在本文件中，由 tests/index.html 以模块方式引入。
// ==========================================

// ✅ 套件注册表（后续步骤的纯逻辑测试继续往这里加）
const SUITES = [
    { id: 'author-completion', label: '第 1 步：作者完成度判定', module: './author-completion.test.js' },
    { id: 'soft-delete-policy', label: '第 2 步：软删除授权策略', module: './soft-delete-policy.test.js' },
    { id: 'smart-fetch-evidence', label: '第 2 步：清单完整性证据（分页循环）', module: './smart-fetch-evidence.test.js' },
    { id: 'follow-verification', label: '第 3 步：关注取证与决策 / 关系分组', module: './follow-verification.test.js' },
    { id: 'authorworks-truncation', label: '第 4 步：列表加载截断判定', module: './authorworks-truncation.test.js' },
    { id: 'media-integrity', label: '第 5 步：图集/封面缺件补下计划', module: './media-integrity.test.js' },
    { id: 'batch-selection', label: '第 6 步：批量选择决策口径（筛选联动规则型模式）', module: './batch-selection.test.js' },
    { id: 'topic', label: '第 8 步：话题标签提取（从 desc 派生）', module: './topic.test.js' },
    { id: 'account-context', label: '第 11 步：账号维度数据区隔离', module: './account-context.test.js' }
];

const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
};

const escapeText = (v) => String(v ?? '');
const shortJson = (v) => {
    const s = String(v ?? '');
    return s.length > 160 ? s.slice(0, 160) + '…' : s;
};

let totalPassed = 0;
let totalFailed = 0;

const suitesBox = document.getElementById('suites');
const summary = document.getElementById('summary');

for (const suite of SUITES) {
    const card = el('div', 'suite');
    const heading = el('h2', null, suite.label);
    card.appendChild(heading);

    try {
        const mod = await import(suite.module);
        if (typeof mod.run !== 'function') throw new Error('套件未导出 run()');

        // ✅ 同步与异步套件均可：await 对普通对象无副作用
        const res = await mod.run();
        totalPassed += res.passed || 0;
        totalFailed += res.failed || 0;

        heading.appendChild(el('span', 'badge', `通过 ${res.passed} / 失败 ${res.failed}`));

        for (const group of res.groups) {
            const g = el('div', 'group');
            g.appendChild(el('div', 'gname', group.name));

            const ul = el('ul', 'cases');
            for (const c of group.cases) {
                const li = el('li', c.ok ? 'ok' : 'fail', (c.ok ? '✓ ' : '✗ ') + escapeText(c.name));
                if (!c.ok) {
                    li.appendChild(el('span', 'detail', '期望: ' + shortJson(c.expected)));
                    li.appendChild(el('span', 'detail', '实际: ' + shortJson(c.actual)));
                }
                ul.appendChild(li);
            }
            g.appendChild(ul);
            card.appendChild(g);
        }
    } catch (error) {
        totalFailed++;
        heading.appendChild(el('span', 'badge', '加载失败'));
        card.appendChild(el('div', '', '❌ ' + escapeText(error && error.message)));
    }

    suitesBox.appendChild(card);
}

const allPass = totalFailed === 0;
summary.className = 'summary ' + (allPass ? 'pass' : 'fail');
summary.textContent = allPass
    ? `✅ 全部通过 —— 断言 ${totalPassed} 条`
    : `❌ 存在失败 —— 通过 ${totalPassed} 条，失败 ${totalFailed} 条`;
document.title = (allPass ? '✅ ' : '❌ ') + 'FavGallery 逻辑测试台';
