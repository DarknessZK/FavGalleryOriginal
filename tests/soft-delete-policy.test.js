// ==========================================
// 软删除授权策略 - 单元测试（零依赖纯逻辑）
// 运行方式：浏览器打开扩展测试台 tests/index.html
// 覆盖：授权矩阵 / 安全默认 / 窗口外条目处置 / 历史误删场景封堵
// ==========================================

import {
    resolveSoftDeletePolicy,
    applyOutOfWindowDisposition
} from '../utils/soft-delete-policy.js';

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
    section('[1] 授权矩阵：只有确认到底才允许下删除结论');
    // ==========================================

    check('到底 + 有条目 + 无失败 → 授权',
        resolveSoftDeletePolicy({ sawEnd: true, apiItemCount: 20, partial: false }).allow, true);
    check('未到底（被加载上限截断）→ 拒绝',
        resolveSoftDeletePolicy({ sawEnd: false, apiItemCount: 20, partial: false }).allow, false);
    check('未到底（提前停止只看了头部）→ 拒绝',
        resolveSoftDeletePolicy({ sawEnd: false, apiItemCount: 3, partial: false }).allow, false);
    check('上游忘记透传 sawEnd（undefined）→ 拒绝（安全默认）',
        resolveSoftDeletePolicy({ apiItemCount: 20 }).allow, false);
    check('存在失败重试耗尽 → 拒绝（即便声称到底）',
        resolveSoftDeletePolicy({ sawEnd: true, apiItemCount: 20, partial: true }).allow, false);
    check('本轮零条目 → 拒绝',
        resolveSoftDeletePolicy({ sawEnd: true, apiItemCount: 0, partial: false }).allow, false);
    check('脏计数（负数/NaN）按零处理 → 拒绝',
        resolveSoftDeletePolicy({ sawEnd: true, apiItemCount: -5 }).allow, false);

    // ==========================================
    section('[2] 历史误删场景封堵（已保存内容成批消失的两条路径）');
    // ==========================================

    // 旧实现路径一：接口失败被吞成 { data: [], hasMore: false } → 被当成到底 → 全部缓存标删
    check('失败伪装成空清单到底 → 拒绝（旧实现会误删整表）',
        resolveSoftDeletePolicy({ sawEnd: true, apiItemCount: 0, partial: true }).allow, false);
    // 旧实现路径二：缓存已达上限、本轮只拉了窗口 → 窗口外旧条目被标删
    check('达到上限只覆盖窗口 → 拒绝（旧实现会误删窗口外旧数据）',
        resolveSoftDeletePolicy({ sawEnd: false, apiItemCount: 60, partial: false }).allow, false);

    // ==========================================
    section('[3] 窗口外条目的处置');
    // ==========================================

    const alive = { workId: 'w1', isDeleted: false };
    const alreadyDeleted = { workId: 'w2', isDeleted: true };

    check('授权通过 → 标记为已取消',
        applyOutOfWindowDisposition(alive, true).isDeleted, true);
    check('授权通过 → 返回新对象，不篡改原缓存',
        applyOutOfWindowDisposition(alive, true) === alive, false);
    check('原缓存保持未删除状态',
        alive.isDeleted, false);
    check('授权拒绝 → 原样保留（不下新结论）',
        applyOutOfWindowDisposition(alive, false), alive);
    check('授权拒绝 → 已删除条目的旧结论不被撤销',
        applyOutOfWindowDisposition(alreadyDeleted, false).isDeleted, true);
    check('授权通过 → 已删除条目保持已删除',
        applyOutOfWindowDisposition(alreadyDeleted, true).isDeleted, true);

    // ==========================================
    section('[4] 拒绝原因可观测（写进日志便于排查）');
    // ==========================================

    check('部分失败的原因说明',
        resolveSoftDeletePolicy({ sawEnd: true, apiItemCount: 10, partial: true }).reason.includes('部分结果'), true);
    check('零条目的原因说明',
        resolveSoftDeletePolicy({ sawEnd: true, apiItemCount: 0 }).reason.includes('没有拿到任何条目'), true);
    check('未到底的原因说明',
        resolveSoftDeletePolicy({ sawEnd: false, apiItemCount: 10 }).reason.includes('未确认清单到底'), true);
    check('授权通过时也给出原因',
        resolveSoftDeletePolicy({ sawEnd: true, apiItemCount: 10 }).reason.includes('已确认清单到底'), true);

    return { title: '软删除授权策略（utils/soft-delete-policy.js）', groups, passed, failed };
}

