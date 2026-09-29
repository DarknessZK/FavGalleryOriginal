// ==========================================
// FavGallery - 关注状态取证与决策（纯逻辑，零依赖）
// 职责：把抖音作者主页响应里的关注关系字段归一为三态，并给出下载链路的处置决策
// 业务背景：关注清单按"从新到旧"分页返回且命中缓存即提前停止，刷新链路只能看到清单头部，
//           取消关注的老作者检不出来。故改由下载链路按人单点确认：证据不依赖清单完整性。
// 口径原则：与 utils/soft-delete-policy.js 一致——只有拿到明确证据才允许下软删除结论，
//           请求失败、字段缺失、取值不在已知枚举内，一律视为"未知"，绝不误标。
// ==========================================

/** 关注状态三态：仍在关注 / 已取关 / 不可判定 */
export const FOLLOW_STATE = {
    FOLLOWING: 'following',
    UNFOLLOWED: 'unfollowed',
    UNKNOWN: 'unknown'
};

/**
 * 归一化关注状态取值
 * 抖音 author 关系字段目前实测到 0/1 两种取值；为避免把未知枚举误判成"已取关"，
 * 只有严格等于 0 才认定为未关注，严格等于 1 才认定为已关注，其余全部归入未知。
 *
 * @param {*} value - follow_status 原始值（可能是数字、数字字符串、缺失）
 * @returns {string} FOLLOW_STATE 之一
 */
export function normalizeFollowStatus(value) {
    if (value === 0 || value === '0') return FOLLOW_STATE.UNFOLLOWED;
    if (value === 1 || value === '1') return FOLLOW_STATE.FOLLOWING;
    return FOLLOW_STATE.UNKNOWN;
}

/**
 * 从作者主页接口响应中提取关注状态
 * 兼容三种可能的挂载路径（不同接口版本字段位置不一致），任一命中即返回：
 *   data.user.follow_status / data.follow_info.follow_status / data.follow_status
 *
 * @param {Object} payload - 接口响应对象（_handleAPIResponse 的返回值）
 * @returns {string} FOLLOW_STATE 之一
 */
export function parseFollowState(payload) {
    if (!payload || typeof payload !== 'object') return FOLLOW_STATE.UNKNOWN;

    const candidates = [
        payload.user?.follow_status,
        payload.follow_info?.follow_status,
        payload.follow_status
    ];
    const hit = candidates.find(v => v !== undefined && v !== null);
    return normalizeFollowStatus(hit);
}

/**
 * 下载链路处置决策
 * 只有明确"已取关"才跳过下载并打软删除标记；"已关注"与"未知"都照常下载，
 * 且"未知"绝不撤销既有的 isDeleted（未知不代表没发生，也不代表已恢复）。
 *
 * @param {string} followState - parseFollowState 的结果
 * @returns {{shouldSkip: boolean, shouldMarkDeleted: boolean, shouldRestore: boolean, reason: string}}
 */
export function resolveAuthorDownloadDecision(followState) {
    if (followState === FOLLOW_STATE.UNFOLLOWED) {
        return {
            shouldSkip: true,
            shouldMarkDeleted: true,
            shouldRestore: false,
            reason: '已确认取消关注：跳过下载并打软删除标记（条目保留在列表与表中）'
        };
    }
    if (followState === FOLLOW_STATE.FOLLOWING) {
        return {
            shouldSkip: false,
            shouldMarkDeleted: false,
            shouldRestore: false,
            reason: '仍在关注中：照常下载'
        };
    }
    return {
        shouldSkip: false,
        shouldMarkDeleted: false,
        shouldRestore: false,
        reason: '关注状态不可判定（请求失败/字段缺失/未知取值）：按未知处理，照常下载且不下软删除结论'
    };
}

export default {
    FOLLOW_STATE,
    normalizeFollowStatus,
    parseFollowState,
    resolveAuthorDownloadDecision
};

