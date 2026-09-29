// ==========================================
// 批量选择决策 - 单元测试（零依赖纯逻辑）
// 运行方式：浏览器打开扩展测试台 tests/index.html（本机无 Node 时同样可用）
// 覆盖：主键口径 / 可选项口径（作品&作者）/ ID 提取 / 规则满足判定 / 当前页切片
// 意义：这些口径原散落在 core/batch-selection-manager.js 的 4~6 处，抽到 utils/batch-selection.js 后
//      以本测试锁定，保证"选中当前页/全选"与"筛选联动重算"跨入口同口径、不漂移
// ==========================================

import {
    getIdKey,
    isItemSelectable,
    getSelectableItems,
    getItemId,
    getSelectableIds,
    isRuleSatisfied,
    sliceCurrentPage
} from '../utils/batch-selection.js';

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
        if (ok) passed++; else failed++;
        current.cases.push({
            name,
            ok,
            expected: JSON.stringify(expected),
            actual: JSON.stringify(actual)
        });
    };

    // ==========================================
    section('[1] getIdKey 主键口径（作者 uid / 作品 workId）');
    // ==========================================
    check('关注列表 → uid', getIdKey('following'), 'uid');
    check('点赞列表 → workId', getIdKey('liked'), 'workId');
    check('收藏列表 → workId', getIdKey('bookmarked'), 'workId');
    check('作者作品钻取 → workId', getIdKey('authorWorks'), 'workId');

    // ==========================================
    section('[2] isItemSelectable 作品口径（已下载不可选，走单卡补全而非复选框）');
    // ==========================================
    check('未下载作品可选', isItemSelectable({ workId: 'w1', isDownloaded: false }, 'liked'), true);
    check('已下载作品不可选', isItemSelectable({ workId: 'w2', isDownloaded: true }, 'liked'), false);
    check('无 isDownloaded 字段视为未下载 → 可选', isItemSelectable({ workId: 'w3' }, 'bookmarked'), true);
    check('钻取视图作品同样按 isDownloaded 判定', isItemSelectable({ workId: 'w4', isDownloaded: true }, 'authorWorks'), false);

    // ==========================================
    section('[3] isItemSelectable 作者口径（委托 isAuthorSelectable，与卡片可勾选性同源）');
    // ==========================================
    check('有作品作者可选', isItemSelectable({ uid: 'a1', workCount: 20 }, 'following'), true);
    check('真空作者不可选', isItemSelectable({ uid: 'a2', workCount: 0, platformWorkCount: 0 }, 'following'), false);
    check('软删除作者不可选', isItemSelectable({ uid: 'a3', workCount: 20, isDeleted: true }, 'following'), false);
    check('清单为0但已存过作品 → 可选（known 兜底取已存数）', isItemSelectable({ uid: 'a4', workCount: 0, downloadedCount: 5 }, 'following'), true);

    // ==========================================
    section('[4] getSelectableItems / getSelectableIds 目标集提取');
    // ==========================================
    const works = [
        { workId: 'w1', isDownloaded: false },
        { workId: 'w2', isDownloaded: true },
        { workId: 'w3', isDownloaded: false }
    ];
    check('作品：过滤掉已下载', getSelectableIds(works, 'liked'), ['w1', 'w3']);
    check('作品：过滤项数量', getSelectableItems(works, 'liked').length, 2);

    const authors = [
        { uid: 'a1', workCount: 20 },
        { uid: 'a2', workCount: 0, platformWorkCount: 0 },
        { uid: 'a3', workCount: 10 }
    ];
    check('作者：过滤掉真空作者', getSelectableIds(authors, 'following'), ['a1', 'a3']);

    check('单项主键：作品', getItemId({ workId: 'w9' }, 'liked'), 'w9');
    check('单项主键：作者', getItemId({ uid: 'a9' }, 'following'), 'a9');

    // ==========================================
    section('[5] isRuleSatisfied 规则满足判定（回写 batchMode 的依据）');
    // ==========================================
    // 目标集 = w1(可选) w2(已下载,忽略) w3(可选)
    check('全部可选项已选中 → true', isRuleSatisfied(works, new Set(['w1', 'w3']), 'liked'), true);
    check('部分选中 → false', isRuleSatisfied(works, new Set(['w1']), 'liked'), false);
    check('不可选项(已下载)缺选不影响判定 → true', isRuleSatisfied(works, new Set(['w1', 'w3']), 'liked'), true);
    check('空目标集(全已下载) → every 为 true', isRuleSatisfied([{ workId: 'd1', isDownloaded: true }], new Set(), 'liked'), true);
    check('空数组 → true', isRuleSatisfied([], new Set(), 'following'), true);

    // ==========================================
    section('[6] sliceCurrentPage 当前页切片（1-based，与 getCurrentPageData 对齐）');
    // ==========================================
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    check('第 1 页 size3', sliceCurrentPage(ten, 1, 3), [1, 2, 3]);
    check('第 2 页 size3', sliceCurrentPage(ten, 2, 3), [4, 5, 6]);
    check('末页不足一页 → 取剩余', sliceCurrentPage(ten, 4, 3), [10]);
    check('越界页 → 空数组', sliceCurrentPage(ten, 99, 3), []);
    check('pageSize=0 → 空数组（防 NaN 切片）', sliceCurrentPage(ten, 1, 0), []);
    check('currentPage=0 归一到第 1 页', sliceCurrentPage(ten, 0, 3), [1, 2, 3]);
    check('字符串数字兼容', sliceCurrentPage(ten, '2', '3'), [4, 5, 6]);
    check('非法 pageSize 归零 → 空数组', sliceCurrentPage(ten, 1, 'abc'), []);

    // ==========================================
    section('[7] intent=backfill 校验补全口径（作品反转：仅已保存可选；作者不受 intent 影响）');
    // ==========================================
    check('补全态：已下载作品可选', isItemSelectable({ workId: 'w2', isDownloaded: true }, 'liked', 'backfill'), true);
    check('补全态：未下载作品不可选', isItemSelectable({ workId: 'w1', isDownloaded: false }, 'liked', 'backfill'), false);
    check('补全态：无字段视为未下载 → 不可选', isItemSelectable({ workId: 'w3' }, 'liked', 'backfill'), false);
    check('补全态：目标集仅含已下载 ID', getSelectableIds(works, 'liked', 'backfill'), ['w2']);
    check('补全态：作者列表忽略 intent，口径与下载一致', getSelectableIds(authors, 'following', 'backfill'), ['a1', 'a3']);
    check('补全态：规则满足（已下载全选中）→ true', isRuleSatisfied(works, new Set(['w2']), 'liked', 'backfill'), true);
    check('补全态：规则未满足（已下载未全选中）→ false', isRuleSatisfied(
        [{ workId: 'd1', isDownloaded: true }, { workId: 'd2', isDownloaded: true }],
        new Set(['d1']), 'liked', 'backfill'), false);

    return { title: '批量选择决策（utils/batch-selection.js）', groups, passed, failed };
}

