// ==========================================
// 列表加载截断判定 - 单元测试（零依赖纯逻辑）
// 运行方式：浏览器打开扩展测试台 tests/index.html
// 覆盖：到底 / 达上限截断 / 失败中断 / hasMore 缺失兜底 / 脏输入
// ==========================================

import { resolveTruncation } from '../utils/worklist-truncation.js';

/**
 * 执行全部断言
 * @returns {{title: string, groups: Array, passed: number, failed: number}}
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
    section('[1] 到底即完整：一律不标注截断');
    // ==========================================

    check('确认到底 + 加载数恰好等于上限 → 不截断（是真完整，非巧合）',
        resolveTruncation({ sawEnd: true, hasMore: false, loadedCount: 200, maxCount: 200 }).truncated, false);
    check('确认到底 + 未达上限 → 不截断',
        resolveTruncation({ sawEnd: true, loadedCount: 30, maxCount: 200 }).truncated, false);

    // ==========================================
    section('[2] 达上限截断：hasMore 为真的直接判定');
    // ==========================================

    check('未到底 + 平台仍有更多 → 截断',
        resolveTruncation({ sawEnd: false, hasMore: true, loadedCount: 200, maxCount: 200 }).truncated, true);
    check('截断原因里带上限数字（可观测）',
        resolveTruncation({ sawEnd: false, hasMore: true, loadedCount: 200, maxCount: 200 }).reason.includes('200'), true);

    // ==========================================
    section('[3] 失败中断：不作"上限截断"标注（交错误提示处理）');
    // ==========================================

    check('重试耗尽中断 → 不标截断（避免把网络失败误导成作品太多）',
        resolveTruncation({ sawEnd: false, partial: true, hasMore: true, loadedCount: 120, maxCount: 200 }).truncated, false);
    check('失败中断的说明口径',
        resolveTruncation({ sawEnd: false, partial: true }).reason.includes('失败'), true);

    // ==========================================
    section('[4] hasMore 缺失兜底：以"加载数顶到上限"判定');
    // ==========================================

    check('未到底 + 无 hasMore + 加载数=上限 → 兜底判截断',
        resolveTruncation({ sawEnd: false, loadedCount: 200, maxCount: 200 }).truncated, true);
    check('未到底 + 无 hasMore + 加载数>上限 → 判截断',
        resolveTruncation({ sawEnd: false, loadedCount: 216, maxCount: 200 }).truncated, true);
    check('未到底 + 无 hasMore + 加载数<上限 → 未见更多证据，不标截断',
        resolveTruncation({ sawEnd: false, loadedCount: 50, maxCount: 200 }).truncated, false);

    // ==========================================
    section('[5] 脏输入 / 边界：安全默认不标注');
    // ==========================================

    check('空参数（上游啥都没透传）→ 不截断（安全默认，不乱提示）',
        resolveTruncation({}).truncated, false);
    check('sawEnd 为 undefined（漏传）但加载数未达上限 → 不截断',
        resolveTruncation({ loadedCount: 10, maxCount: 200 }).truncated, false);
    check('maxCount 缺失（undefined）→ 无法据上限判定，不标截断',
        resolveTruncation({ sawEnd: false, loadedCount: 200 }).truncated, false);
    check('loadedCount 为负/NaN 归零处理后不误标',
        resolveTruncation({ sawEnd: false, loadedCount: -5, maxCount: 200 }).truncated, false);

    return { title: '列表加载截断判定（utils/worklist-truncation.js）', groups, passed, failed };
}
