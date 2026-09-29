// ==========================================
// 清单完整性证据（sawEnd / partial）- 单元测试
// 被测对象：utils/helpers.js 的 smartIncrementalFetch（软删除资格的唯一生产者）
// 运行方式：浏览器打开扩展测试台 tests/index.html
//
// 为什么必须覆盖这里：
//   软删除授权策略只消费证据，证据本身由分页循环产生。
//   真实误删发生在「接口失败/字段缺失被当成已看完」这一刻，
//   靠手工复现需要正好断网/正好遇到接口异常，几乎不可复现，
//   因此用假 fetchFn 把各种响应形态枚举出来直接验。
// ==========================================

import { smartIncrementalFetch } from '../utils/helpers.js';
import { resolveSoftDeletePolicy } from '../utils/soft-delete-policy.js';

/** 每批 2 个作品，workId 全局唯一 */
const makeBatch = (start, size) => {
    return Array.from({ length: size }, (_, i) => ({ workId: `w${start + i}` }));
};

/**
 * 按脚本依次返回响应；数组项为 Error 实例时抛出（模拟接口失败）
 * 脚本耗尽后返回 undefined（模拟包装层什么都没返回）
 * @param {Array} script - [{data, hasMore, cursor} | Error]
 */
const scriptedFetch = (script) => {
    const fn = async () => {
        const item = script[fn.calls++];
        if (item instanceof Error) throw item;
        return item;
    };
    fn.calls = 0;
    return fn;
};

// 测试专用选项：把重试退避压到 1ms，避免拖慢测试台
//（批与批之间的防封号随机延迟仍走 CONFIG，故多批用例约需 1~2 秒）
const FAST = { delayMs: 1, maxRetries: 1 };

/**
 * 执行全部断言（异步）
 * @returns {Promise<{title: string, groups: Array, passed: number, failed: number}>}
 */
export async function run() {
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

    // 跑一轮假获取，返回证据三元组
    const probe = async (script, options = {}) => {
        const { maxCount = 20, cachedIds = null, extraOptions = FAST } = options;
        const fetchFn = scriptedFetch(script);
        const res = await smartIncrementalFetch(
            fetchFn,
            cachedIds,
            'workId',
            maxCount,
            null,
            extraOptions
        );
        return {
            sawEnd: res.sawEnd,
            partial: res.partial,
            count: res.items.length,
            ids: res.items.map(i => i.workId),
            calls: fetchFn.calls
        };
    };

    // ==========================================
    section('[1] 什么才算“看到清单末尾”');
    // ==========================================

    let r = await probe([{ data: makeBatch(1, 20), hasMore: false, cursor: 0 }], { maxCount: 20 });
    check('API 明确回复没有更多 → 到底', r.sawEnd, true);
    check('API 明确回复没有更多 → 无失败', r.partial, false);

    // 多批：第 1 批还有更多，第 2 批到底（会命中一次防封号延迟）
    r = await probe([
        { data: makeBatch(1, 2), hasMore: true, cursor: 100 },
        { data: makeBatch(3, 2), hasMore: false, cursor: 0 }
    ], { maxCount: 20 });
    check('多批后末批回复没有更多 → 到底', r.sawEnd, true);
    check('多批后末批回复没有更多 → 两批都在窗口内', r.count, 4);

    r = await probe([{ data: makeBatch(1, 20), hasMore: true, cursor: 100 }], { maxCount: 20 });
    check('还有更多但已达本地上限 → 不算到底', r.sawEnd, false);

    r = await probe([{ data: makeBatch(1, 30), hasMore: false, cursor: 0 }], { maxCount: 20 });
    check('窗口被上限截断（拿到的比上限多）→ 取消到底资格', r.sawEnd, false);
    check('窗口被上限截断 → 返回值仍不超上限', r.count, 20);

    // ==========================================
    section('[2] 失败与字段缺失不得被当成“已看完”（旧实现的误删入口）');
    // ==========================================

    // 抖音接口正常时必带 has_more；缺字段只可能是包装层漏传或失败被吞
    r = await probe([{ data: makeBatch(1, 20) }], { maxCount: 20 });
    check('hasMore 字段缺失（undefined）→ 不算到底', r.sawEnd, false);

    r = await probe([new Error('network down')], { maxCount: 20 });
    check('首批即失败 → 不算到底', r.sawEnd, false);
    check('首批即失败 → 标记为部分结果', r.partial, true);
    check('首批即失败 → 窗口为空', r.count, 0);

    r = await probe([
        { data: makeBatch(1, 2), hasMore: true, cursor: 100 },
        new Error('network down')
    ], { maxCount: 20 });
    check('拉了部分之后失败 → 取消到底资格', r.sawEnd, false);
    check('拉了部分之后失败 → 标记为部分结果', r.partial, true);
    check('拉了部分之后失败 → 已拿到的数据仍保留（不丢已完成的工作）', r.count, 2);

    // 旧实现把失败伪装成 { data: [], hasMore: false }，等价于“清单空且已看完”
    r = await probe([{ data: [], hasMore: false }], { maxCount: 20});
    check('伪装成空清单（首批即空）→ 不算到底', r.sawEnd, false);
    check('伪装成空清单（首批即空）→ 窗口为空', r.count, 0);

    r = await probe([{ data: makeBatch(1, 2), hasMore: true, cursor: 100 }, { data: [], hasMore: false }], { maxCount: 20 });
    check('已有数据后遇到明确到底的空批次 → 算到底', r.sawEnd, true);

    r = await probe([{ data: makeBatch(1, 2), hasMore: true, cursor: 100 }, { data: [] }], { maxCount: 20 });
    check('空批次但未声明到底 → 标记为部分结果', r.partial, true);
    check('空批次但未声明到底 → 不算到底', r.sawEnd, false);

    // ==========================================
    section('[3] 提前停止（增量优化）不得产生删除资格');
    // ==========================================

    const cachedIds = new Set(['w1', 'w2']);
    r = await probe(
        [{ data: makeBatch(1, 3), hasMore: true, cursor: 100 }],
        { maxCount: 20, cachedIds, extraOptions: { ...FAST, isFullyLoaded: true } }
    );
    check('命中缓存提前停止 → 只看到头部，不算到底', r.sawEnd, false);
    check('提前停止仍保留缓存命中项的坑位（顺序不错乱）', r.ids, ['w1', 'w2', 'w3']);

    check('命中缓存提前停止 → 只请求一批就收工', r.calls, 1);

    r = await probe(
        [{ data: makeBatch(1, 3), hasMore: true, cursor: 100 }],
        { maxCount: 20, cachedIds, extraOptions: { ...FAST, isFullyLoaded: false } }
    );
    check('未曾完整加载时不提前停止（继续往下拉）', r.calls, 2);

    // ==========================================
    section('[4] 证据 → 授权策略 闭环（生产者与消费者口径一致）');
    // ==========================================

    const allowOf = (res) => resolveSoftDeletePolicy({
        sawEnd: res.sawEnd,
        apiItemCount: res.count,
        partial: res.partial
    }).allow;

    const healthy = await probe([{ data: makeBatch(1, 20), hasMore: false }], { maxCount: 20 });
    check('正常到底 → 授权软删除', allowOf(healthy), true);

    const truncated = await probe([{ data: makeBatch(1, 20), hasMore: true }], { maxCount: 20 });
    check('被上限截断 → 拒绝软删除', allowOf(truncated), false);

    const broken = await probe([new Error('boom')], { maxCount: 20 });
    check('接口失败 → 拒绝软删除', allowOf(broken), false);

    const faked = await probe([{ data: [], hasMore: false }], { maxCount: 20 });
    check('失败伪装成空清单 → 拒绝软删除（整表消失的路径已封死）', allowOf(faked), false);

    const earlyExit = await probe(
        [{ data: makeBatch(1, 3), hasMore: true, cursor: 100 }],
        { maxCount: 20, cachedIds, extraOptions: { ...FAST, isFullyLoaded: true } }
    );
    check('提前停止 → 拒绝软删除', allowOf(earlyExit), false);

    return { title: '清单完整性证据（utils/helpers.js → 软删除资格）', groups, passed, failed };
}
