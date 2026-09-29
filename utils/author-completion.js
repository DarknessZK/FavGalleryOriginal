// ==========================================
// 作者完成度判定 - 业务口径唯一来源
// 职责：计算"已知作品总数"（分母）与作者卡片的操作态（按钮文案/可点性/可勾选性）
// 约束：纯函数，零依赖（不引用 DOM / chrome / 扩展模块），可脱离浏览器做单元测试
// ==========================================

/**
 * 归一化计数：非有限数、负数、NaN 一律按 0 处理
 * @param {*} value - 任意输入
 * @returns {number} 大于等于 0 的整数
 */
export function toCount(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return 0;
    return Math.floor(num);
}

/**
 * 计算"已知作品总数"（卡片统计行的分母）
 *
 * 口径（对齐设计文档 DATABASE_SCHEMA「authors.workCount 后续通过 relations 表统计更新」）：
 * - 一旦我们真正拉取过该作者的作品清单（关系数 > 0），分母以本地统计为主，但与「上次已确立的缓存分母」取大：
 *   关系表按作者逐次拉取累加写入（唯一索引去重），正常情况下等于「接口返回 ∪ 本地已入库」去重条数、单调不减，
 *   作者删除作品也不会让它变小（本地已保存的资产不因平台侧消失而撤回）；
 *   ⚠️ 但当某轮按 maxCount 截断（未拉满，如作者实际 299 个、本轮上限只取了 50 个）时，本轮关系数会偏小，
 *   绝不能用它把已经展示过的更大分母压回去（违反「分母单调不减」）——故必须与缓存取大兜底。
 *   此时平台计数不参与：私密/审核中作品我们拿不到，偏大的平台计数只会污染分母。
 * - 从未拉取过清单时（新关注、尚未保存过任何作品），本地没有任何清单可依，
 *   只能退化为用平台计数作为估计值（与缓存取大）。
 * - 最后与"已存数"取大，作为显示层保险：分子永远不可能大于分母。
 *
 * @param {Object} counts - 计数字段集合
 * @param {number} [counts.relationCount] - 关系表中该作者的去重作品条数（本地全集统计，权威值）
 * @param {number} [counts.cachedWorkCount] - 本地已存的作者 workCount（可能是上次估计值或上次统计值）
 * @param {number} [counts.apiWorkCount] - 平台关注列表接口返回的作者作品计数（可能偏小或偏大，仅作无清单时兜底）
 * @param {number} [counts.downloadedCount] - 已保存到本地的作品数
 * @returns {number} 已知作品总数
 */
export function computeKnownWorkCount({
    relationCount,
    cachedWorkCount,
    apiWorkCount,
    downloadedCount
} = {}) {
    const relation = toCount(relationCount);
    const cached = toCount(cachedWorkCount);
    const api = toCount(apiWorkCount);
    const downloaded = toCount(downloadedCount);

    // ✅ 有清单（关系数>0）时：与上次已确立的缓存分母取大——本轮按上限截断会让关系数偏小，
    //    不能据此把更大的已展示分母压回去（分母单调不减）；平台计数不参与，避免私密/审核作品抬高分母
    // ✅ 无清单（关系数=0）时：退化为 max(缓存, 平台计数)——从未枚举过，只能用计数估计
    const base = relation > 0 ? Math.max(relation, cached) : Math.max(cached, api);

    return Math.max(base, downloaded);
}

/**
 * 列表合并阶段的 workCount 取值
 *
 * 关注列表接口只带作者作品计数、不带作品清单，因此这阶段无法做全集统计；
 * 规则：本地已有值时一律保留（平台计数会因作者删作品而回落，覆盖会造成分母倒退与分子倒挂），
 * 只有本地没值时才用平台计数占位；真实的全集统计由关系表校正回写（applyAuthorStatuses）。
 *
 * ✅ 注意：本规则会让未拉过清单的作者分母暂时滞后，这是设计允许的 ——
 *    完成态不再禁用按钮，新作品靠“点击检查更新”拉清单求差集发现，不依赖此计数。
 *
 * @param {Object} counts - 计数字段
 * @param {number} [counts.cachedWorkCount] - 本地已存值
 * @param {number} [counts.apiWorkCount] - 本次接口返回的作者作品计数
 * @returns {number} 合并后应保留的 workCount
 */
export function resolveMergedWorkCount({ cachedWorkCount, apiWorkCount } = {}) {
    const cached = toCount(cachedWorkCount);
    return cached > 0 ? cached : toCount(apiWorkCount);
}

/**
 * 计算作者卡片的操作态（按钮文案、样式类、是否可点、是否可勾选、悬浮说明）
 *
 * 核心决策：完成态（已存数达到已知作品总数）**不再禁用按钮与复选框**。
 * 因为"没有新作品"这个结论无法靠计数得出（作者发新作品时本地分母还没跟上），
 * 只能靠真的去拉一次清单求差集才能确定；禁用按钮会让作者更新的作品永久无法被发现。
 * 完成态改为绿色 + 文案提示"检查更新"，点击后无新增则由下载链路回报提示。
 *
 * @param {Object} state - 状态输入
 * @param {number} [state.knownWorkCount] - 已知作品总数（computeKnownWorkCount 的结果）
 * @param {number} [state.downloadedCount] - 已保存到本地的作品数
 * @param {number} [state.platformWorkCount] - 平台计数，仅用于区分"真没作品"与"从没拉过"
 * @param {boolean} [state.isDeleted] - 是否已被软删除（确认取消关注），优先级最高
 * @returns {{state: string, text: string, className: string, background: string, cursor: string, clickable: boolean, selectable: boolean, tooltip: string}}
 */
export function resolveAuthorAction({
    knownWorkCount,
    downloadedCount,
    platformWorkCount,
    isDeleted
} = {}) {
    const known = toCount(knownWorkCount);
    const downloaded = toCount(downloadedCount);
    const platform = toCount(platformWorkCount);

    // ✅ 软删除态（已确认取消关注）优先于一切计数判定：
    //    条目保留在列表与表中、已下载的作品不动，仅禁止继续下载与勾选
    if (isDeleted === true) {
        return {
            state: 'unfollowed',
            text: '🚫 已取关',
            className: 'download-btn empty',
            background: '#bfbfbf',
            cursor: 'not-allowed',
            clickable: false,
            selectable: false,
            tooltip: '已取消关注（软删除）：条目与已存作品保留在本地，不再下载新作品；如需清理请到离线浏览页处理'
        };
    }

    // ✅ 真空作者：平台说没有作品，本地也没有任何清单条目，且从未保存过
    if (known === 0 && downloaded === 0 && platform === 0) {
        return {
            state: 'empty',
            text: '🚫 无作品',
            className: 'download-btn empty',
            background: '#bfbfbf',
            cursor: 'not-allowed',
            clickable: false,
            selectable: false,
            tooltip: '平台显示该作者没有公开作品'
        };
    }

    // ✅ 从没保存过：待办状态
    if (downloaded === 0) {
        return {
            state: 'idle',
            text: '⬇️ 保存',
            className: 'download-btn',
            background: '#1890ff',
            cursor: 'pointer',
            clickable: true,
            selectable: true,
            tooltip: `保存 TA 的作品（已知 ${known} 个）`
        };
    }

    // ✅ 部分完成：还有已知但未落地的作品
    if (downloaded < known) {
        return {
            state: 'partial',
            text: `⚠️ ${downloaded}/${known}`,
            className: 'download-btn partial',
            background: '#faad14',
            cursor: 'pointer',
            clickable: true,
            selectable: true,
            tooltip: `已保存 ${downloaded} 个，还有 ${known - downloaded} 个已知作品未保存到本地，点击继续`
        };
    }

    // ✅ 完成态：可点、可勾选，点击即检查作者是否有新作品
    //    （按钮宽度固定 80px，文案取“检查更新”以避免溢出；“已存 x/x”的完整信息由统计行与悬浮说明携带）
    return {
        state: 'completed',
        text: '✅ 检查更新',
        className: 'download-btn completed',
        background: '#52c41a',
        cursor: 'pointer',
        clickable: true,
        selectable: true,
        tooltip: `已保存 ${downloaded} 个（截至上次拉取时已知的作品全部在本地）。作者发布新作品后本地不会自动知道，点击可检查更新：无新增会提示，有新增会直接保存`
    };
}

/**
 * 统计行悬浮说明（作者卡片"🎬 已存 x/y"旁的问号提示）
 * @returns {string} 提示文本
 */
export function getSavedCountTooltip() {
    return '已保存作品数 / 已知作品总数。总数按我们实际拉取到的作品清单去重统计，作者删除作品不会让已存数超过总数。显示「已保存」时仍可点击，用于检查作者是否有新作品。';
}

/**
 * 作者是否可被勾选（批量选择用；与卡片按钮的可勾选性同源，避免两处口径漂移）
 * @param {Object} author - 作者数据（workCount 需已是分母口径，platformWorkCount 可选）
 * @returns {boolean} 是否可选
 */
export function isAuthorSelectable(author = {}) {
    // ✅ 软删除态不可勾选（与 resolveAuthorAction 的 unfollowed 分支同口径）
    if (author.isDeleted === true) return false;

    const downloaded = toCount(author.downloadedCount);
    const known = toCount(author.workCount) || downloaded;
    const platform = toCount(author.platformWorkCount ?? author.workCount);

    // ✅ 与 resolveAuthorAction 一致：仅"真空作者"不可选
    if (known === 0 && platform === 0) return false;
    return true;
}
