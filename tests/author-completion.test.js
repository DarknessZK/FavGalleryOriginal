// ==========================================
// 作者完成度判定 - 单元测试（零依赖纯逻辑）
// 运行方式：浏览器打开扩展测试台 tests/index.html（本机无 Node 时同样可用）
// 覆盖：计数归一化 / 分母口径 / 四态判定 / 完成态可点可勾选 / 两入口口径一致性
// ==========================================

import {
    toCount,
    computeKnownWorkCount,
    resolveMergedWorkCount,
    resolveAuthorAction,
    isAuthorSelectable
} from '../utils/author-completion.js';

/**
 * 执行全部断言
 * @returns {{title: string, groups: Array<{name: string, cases: Array<{name: string, ok: boolean, expected: string, actual: string}>}>, passed: number, failed: number}}
 */
export function run() {
    const groups = [];
    let current = null;
    let passed = 0;
    let failed = 0;

    const section = (name) => {
        current = { name, cases: [] };
        groups.push(current);
    };

    const check = (name, actual, expected) => {
        const ok = JSON.stringify(actual) === JSON.stringify(expected);
        if (ok) {
            passed++;
        } else {
            failed++;
        }
        current.cases.push({
            name,
            ok,
            expected: JSON.stringify(expected),
            actual: JSON.stringify(actual)
        });
    };

    // ==========================================
    section('[1] toCount 计数归一化');
    // ==========================================
    check('正常数字', toCount(9), 9);
    check('小数向下取整', toCount(8.7), 8);
    check('字符串数字', toCount('12'), 12);
    check('零', toCount(0), 0);
    check('负数归零', toCount(-5), 0);
    check('undefined 归零', toCount(undefined), 0);
    check('null 归零', toCount(null), 0);
    check('NaN 归零', toCount(NaN), 0);
    check('非数字字符串归零', toCount('abc'), 0);
    check('Infinity 归零', toCount(Infinity), 0);

    // ==========================================
    section('[2] computeKnownWorkCount 分母口径');
    // ==========================================

    // 场景 A：作者删除了已下载的作品 —— 平台计数 8，本地实际存了 9
    check('A 作者删作品：本地统计优先于偏小的平台计数',
        computeKnownWorkCount({ relationCount: 9, cachedWorkCount: 9, apiWorkCount: 8, downloadedCount: 9 }), 9);
    check('A 缓存仍是旧的小值时也被本地统计抬高',
        computeKnownWorkCount({ relationCount: 9, cachedWorkCount: 8, apiWorkCount: 8, downloadedCount: 9 }), 9);

    // 场景 B：从未拉过清单的新关注作者 —— 只能用平台计数估计
    check('B 无清单：采用平台计数',
        computeKnownWorkCount({ relationCount: 0, cachedWorkCount: 0, apiWorkCount: 20, downloadedCount: 0 }), 20);
    check('B 无清单：缓存估计值与平台计数取大',
        computeKnownWorkCount({ relationCount: 0, cachedWorkCount: 25, apiWorkCount: 20, downloadedCount: 0 }), 25);

    // 场景 C：平台计数偏大（私密/审核中作品我们拿不到）—— 有清单时不参与，不污染分母
    check('C 有清单时忽略偏大的平台计数',
        computeKnownWorkCount({ relationCount: 30, cachedWorkCount: 30, apiWorkCount: 45, downloadedCount: 30 }), 30);

    // 场景 D：倒挂保险 —— 分子永远不超过分母
    check('D 倒挂保险：本地统计小于已存数时抬高到已存数',
        computeKnownWorkCount({ relationCount: 8, cachedWorkCount: 8, apiWorkCount: 8, downloadedCount: 9 }), 9);
    check('D 倒挂保险：全零输入返回 0',
        computeKnownWorkCount({}), 0);

    // 场景 E：作者新增作品、我们尚未拉取清单 —— 分母暂时滞后（设计允许，靠完成态可点来发现）
    check('E 新增未发现：分母保持上次统计值',
        computeKnownWorkCount({ relationCount: 50, cachedWorkCount: 50, apiWorkCount: 55, downloadedCount: 50 }), 50);

    // 场景 F（回归）：作者实际 299 个，本轮按 maxCount=50 截断只钻到 50 个（关系数被截断而偏小）
    //             分母绝不能被压成 50，必须保留上次已确立的 299（分母单调不减）
    check('F 截断未拉满：关系数(50)<缓存分母(299)时保留 299，不缩小',
        computeKnownWorkCount({ relationCount: 50, cachedWorkCount: 299, apiWorkCount: 299, downloadedCount: 0 }), 299);
    check('F 截断且已存数小于缓存时仍不被拉低（仅与已存取大）',
        computeKnownWorkCount({ relationCount: 50, cachedWorkCount: 299, apiWorkCount: 299, downloadedCount: 12 }), 299);

    // ==========================================
    section('[3] resolveMergedWorkCount 列表合并阶段的分母');
    // ==========================================

    check('作者删作品导致平台回落时不覆盖本地值',
        resolveMergedWorkCount({ cachedWorkCount: 9, apiWorkCount: 8 }), 9);
    check('作者发新作品抬高平台计数时本地值暂不受影响（设计如此：靠点击检查更新发现）',
        resolveMergedWorkCount({ cachedWorkCount: 50, apiWorkCount: 55 }), 50);
    check('无本地值时用平台计数占位',
        resolveMergedWorkCount({ cachedWorkCount: 0, apiWorkCount: 20 }), 20);
    check('无本地值且平台也说 0 → 0（真空作者）',
        resolveMergedWorkCount({ cachedWorkCount: 0, apiWorkCount: 0 }), 0);
    check('脏输入归一',
        resolveMergedWorkCount({ cachedWorkCount: undefined, apiWorkCount: '12' }), 12);

    // ==========================================
    section('[4] resolveAuthorAction 四态判定');
    // ==========================================

    const empty = resolveAuthorAction({ knownWorkCount: 0, downloadedCount: 0, platformWorkCount: 0 });
    check('真空作者 → empty 态', empty.state, 'empty');
    check('真空作者 → 不可点', empty.clickable, false);
    check('真空作者 → 不可勾选', empty.selectable, false);

    const idle = resolveAuthorAction({ knownWorkCount: 20, downloadedCount: 0, platformWorkCount: 20 });
    check('未保存过 → idle 态', idle.state, 'idle');
    check('idle → 可点', idle.clickable, true);
    check('idle → 文案为保存', idle.text, '⬇️ 保存');

    const partial = resolveAuthorAction({ knownWorkCount: 9, downloadedCount: 5, platformWorkCount: 8 });
    check('部分完成 → partial 态', partial.state, 'partial');
    check('partial → 文案含已存/总数', partial.text, '⚠️ 5/9');
    check('partial → 可点', partial.clickable, true);
    check('partial → 可勾选', partial.selectable, true);

    const completed = resolveAuthorAction({ knownWorkCount: 9, downloadedCount: 9, platformWorkCount: 8 });
    check('已存=总数 → completed 态', completed.state, 'completed');
    check('【核心】completed 仍可点击（消除作者更新作品的死锁）', completed.clickable, true);
    check('【核心】completed 仍可勾选（批量选择能覆盖老作者）', completed.selectable, true);
    check('completed → 绿色', completed.background, '#52c41a');
    check('completed → 文案含检查更新', completed.text.includes('检查更新'), true);

    // 作者删作品的实际表现：不再出现"已存 9/8"
    const authorDeleted = resolveAuthorAction({
        knownWorkCount: computeKnownWorkCount({ relationCount: 9, cachedWorkCount: 8, apiWorkCount: 8, downloadedCount: 9 }),
        downloadedCount: 9,
        platformWorkCount: 8
    });
    check('作者删作品后不出现分子大于分母', authorDeleted.text.includes('9/8'), false);
    check('作者删作品后为 completed 态且可点', authorDeleted.state, 'completed');

    // 异常数据兜底：总数为 0 但有已存记录
    const zeroButSaved = resolveAuthorAction({ knownWorkCount: 0, downloadedCount: 3, platformWorkCount: 0 });
    check('异常数据：已存数大于 0 时不判为真空作者', zeroButSaved.state, 'completed');

    // ==========================================
    section('[5] 跨入口一致性（卡片渲染 与 批量选择 必须同口径）');
    // ==========================================

    const consistencyCases = [
        { label: '真空作者', knownWorkCount: 0, downloadedCount: 0, platformWorkCount: 0 },
        { label: '未保存', knownWorkCount: 20, downloadedCount: 0, platformWorkCount: 20 },
        { label: '部分完成', knownWorkCount: 9, downloadedCount: 5, platformWorkCount: 8 },
        { label: '已完成', knownWorkCount: 9, downloadedCount: 9, platformWorkCount: 8 },
        { label: '删作品倒挂', knownWorkCount: 9, downloadedCount: 9, platformWorkCount: 7 },
        { label: '异常零总数', knownWorkCount: 0, downloadedCount: 0, platformWorkCount: 0 }
    ];

    consistencyCases.forEach((c) => {
        const action = resolveAuthorAction(c);
        const selectable = isAuthorSelectable({
            workCount: c.knownWorkCount,
            downloadedCount: c.downloadedCount,
            platformWorkCount: c.platformWorkCount
        });
        check(`${c.label}：批量可选性与卡片可勾选性一致`, selectable, action.selectable);
    });

    return { title: '作者完成度判定（utils/author-completion.js）', groups, passed, failed };
}
