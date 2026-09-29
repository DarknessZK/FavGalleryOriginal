// ==========================================
// 软删除授权策略 - 业务口径唯一来源
// 职责：判定"本轮是否有权把 API 窗口外的缓存条目标记为平台侧已取消"
// 约束：纯函数，零依赖（仅复用计数归一化），可脱离浏览器做单元测试
//
// 设计前提（对齐 docs/DATABASE_SCHEMA.md 机制一）：
//   软删除是"平台驱动"的结论 —— 只有当我们看到了完整清单，
//   才有资格说"某条目不在清单里 = 用户取消了它"。
//   任何失败、截断、未到底的情况，一律视为"本次没检测到变化"，绝不下删除结论。
//   宁可漏检，不可误删（误删会让已保存到本地的内容从离线页成批消失）。
// ==========================================

import { toCount } from './author-completion.js';

/**
 * 判定本轮是否允许执行软删除标记
 * @param {Object} evidence - 本轮获取的完整性证据
 * @param {boolean} [evidence.sawEnd] - 是否确认看到清单末尾（API 明确返回没有更多数据）
 * @param {number} [evidence.apiItemCount] - 本轮实际拿到的条目数
 * @param {boolean} [evidence.partial] - 本轮是否存在"重试耗尽仍失败"导致的部分结果
 * @returns {{allow: boolean, reason: string}}
 */
export function resolveSoftDeletePolicy({ sawEnd, apiItemCount, partial } = {}) {
    // ✅ 失败被吞成部分结果：本轮清单不可信
    if (partial === true) {
        return { allow: false, reason: '本轮接口存在失败（重试耗尽后只拿到部分结果），不做软删除判定' };
    }

    // ✅ 空结果不能作为"全部已取消"的证据（接口异常同样表现为空）
    if (toCount(apiItemCount) === 0) {
        return { allow: false, reason: '本轮没有拿到任何条目，无法据此判定窗口外条目已消失' };
    }

    // ✅ 未确认到底（含达到加载上限被截断、含提前停止）：只看到了窗口，不能对窗口外下结论
    if (sawEnd !== true) {
        return { allow: false, reason: '本轮未确认清单到底（被上限截断或提前停止），不做软删除判定' };
    }

    return { allow: true, reason: '本轮已确认清单到底，可对窗口外条目做软删除判定' };
}

/**
 * 条目在本轮 API 窗口之外时的处置
 * @param {Object} item - 缓存条目
 * @param {boolean} allowSoftDelete - resolveSoftDeletePolicy 的结论
 * @returns {Object} 写入合并结果的条目
 */
export function applyOutOfWindowDisposition(item, allowSoftDelete) {
    // ✅ 授权不足时原样保留（含其既有的 isDeleted 状态），既不下新结论，也不撤销旧结论
    if (!allowSoftDelete) return item;

    return { ...item, isDeleted: true };
}

