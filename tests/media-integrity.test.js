// ==========================================
// 媒体文件完整性判定 - 单元测试（零依赖纯逻辑）
// 运行方式：浏览器打开扩展测试台 tests/index.html（本机无 Node 时同样可用）
// 覆盖：图集缺失序号 / 图集补下计划 / 视频补下计划（缺封面单独补）/ 脏输入归一
// 对应第 5 步「图集与封面的部分缺件要能补齐」
// ==========================================

import {
    computeMissingImageIndexes,
    planImagePostBackfill,
    planVideoBackfill
} from '../utils/media-integrity.js';

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
    section('[1] computeMissingImageIndexes 图集缺失序号');
    // ==========================================
    check('全缺（首次下载，本地一张都没有）',
        computeMissingImageIndexes(5, []), [1, 2, 3, 4, 5]);
    check('全有 → 无缺失',
        computeMissingImageIndexes(5, [1, 2, 3, 4, 5]), []);
    check('【核心】中间缺件：第 3、5 张缺失保留原序号不重排',
        computeMissingImageIndexes(5, [1, 2, 4]), [3, 5]);
    check('末尾缺一张',
        computeMissingImageIndexes(4, [1, 2, 3]), [4]);
    check('本地多出旧序号（平台已减少）不影响：只核对 1..count',
        computeMissingImageIndexes(3, [1, 2, 3, 4, 9]), []);
    check('乱序输入归一为升序缺失',
        computeMissingImageIndexes(4, [4, 2]), [1, 3]);
    check('Set 输入同样支持',
        computeMissingImageIndexes(3, new Set([1, 3])), [2]);
    check('字符串序号归一',
        computeMissingImageIndexes(3, ['1', '3']), [2]);

    // ==========================================
    section('[2] computeMissingImageIndexes 脏输入');
    // ==========================================
    check('count=0 → 空', computeMissingImageIndexes(0, []), []);
    check('count 负数 → 空', computeMissingImageIndexes(-3, []), []);
    check('count 非数字 → 空', computeMissingImageIndexes('abc', []), []);
    check('小数 count 向下取整', computeMissingImageIndexes(2.9, []), [1, 2]);
    check('existing 为 null 视为全缺', computeMissingImageIndexes(2, null), [1, 2]);
    check('existing 含脏值被忽略', computeMissingImageIndexes(3, [1, -1, 0, NaN, 'x']), [2, 3]);

    // ==========================================
    section('[3] planImagePostBackfill 图集补下计划');
    // ==========================================
    check('图片齐全且无音频需求 → 完整（可跳过）',
        planImagePostBackfill({ imageCount: 5, existingIndexes: [1, 2, 3, 4, 5], musicExpected: false }),
        { missingIndexes: [], needMusic: false, isComplete: true });
    check('【核心】缺第 3 张 → 只补 3，标记不完整',
        planImagePostBackfill({ imageCount: 5, existingIndexes: [1, 2, 4, 5], musicExpected: false }),
        { missingIndexes: [3], needMusic: false, isComplete: false });
    check('图片齐全但缺音频 → 不完整且需补音频',
        planImagePostBackfill({ imageCount: 3, existingIndexes: [1, 2, 3], musicExpected: true, musicExists: false }),
        { missingIndexes: [], needMusic: true, isComplete: false });
    check('图片齐全且音频已在 → 完整',
        planImagePostBackfill({ imageCount: 3, existingIndexes: [1, 2, 3], musicExpected: true, musicExists: true }),
        { missingIndexes: [], needMusic: false, isComplete: true });
    check('缺音频 + 缺图片 → 同时列出',
        planImagePostBackfill({ imageCount: 3, existingIndexes: [1, 3], musicExpected: true, musicExists: false }),
        { missingIndexes: [2], needMusic: true, isComplete: false });
    check('不预期音频时，musicExists 缺省也不判缺',
        planImagePostBackfill({ imageCount: 1, existingIndexes: [1], musicExpected: false, musicExists: false }),
        { missingIndexes: [], needMusic: false, isComplete: true });

    // ==========================================
    section('[4] planVideoBackfill 视频补下计划');
    // ==========================================
    check('正片已在、无封面需求 → 完整',
        planVideoBackfill({ videoExists: true, coverExpected: false }),
        { needVideo: false, needCover: false, isComplete: true });
    check('【核心】正片已在、缺封面 → 只补封面（旧逻辑会整条跳过漏补）',
        planVideoBackfill({ videoExists: true, coverExpected: true, coverExists: false }),
        { needVideo: false, needCover: true, isComplete: false });
    check('正片已在、封面也在 → 完整',
        planVideoBackfill({ videoExists: true, coverExpected: true, coverExists: true }),
        { needVideo: false, needCover: false, isComplete: true });
    check('正片缺失 → 需下正片（封面需求存在且也缺则一起）',
        planVideoBackfill({ videoExists: false, coverExpected: true, coverExists: false }),
        { needVideo: true, needCover: true, isComplete: false });
    check('正片缺失但封面已在 → 只补正片，不重复下封面',
        planVideoBackfill({ videoExists: false, coverExpected: true, coverExists: true }),
        { needVideo: true, needCover: false, isComplete: false });

    return { title: '媒体文件完整性判定（utils/media-integrity.js）', groups, passed, failed };
}
