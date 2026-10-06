// ==========================================
// 列表加载截断判定 - 展示层信号唯一来源
// 职责：判定"本轮列表是否因达到加载上限（maxCount）而只拿到部分清单"，
//       供上层给用户"清单可能不全"的提示（如作者作品钻取的「已达加载上限」标注）
// 约束：纯函数，零依赖，可脱离浏览器做单元测试
//
// 与软删除授权（utils/soft-delete-policy.js）的区别（两者都读 sawEnd/partial，但结论方向不同，勿混用）：
//   - 软删除授权关心"能不能对窗口外缓存条目下『已取消』结论"，被截断/未到底时一律拒绝（宁可漏检不误删）；
//   - 本函数只关心"要不要告诉用户这次没看全"，是纯展示层信号，不改变任何数据落库结论。
//
// 证据口径（来自各列表 apiFetch 透传）：
//   sawEnd  = 是否确认看到清单末尾（API 明确回复没有更多，且未被本地上限截断）
//   partial = 是否因重试耗尽而中断（接口失败）
//   hasMore = 平台是否明确还有更多（作者作品接口透出；smartIncrementalFetch 亦返回）
// ==========================================

/**
 * 判定一次列表拉取是否"被加载上限截断"
 * @param {Object} evidence - 本轮完整性证据
 * @param {boolean} [evidence.sawEnd] - 是否确认看到清单末尾
 * @param {boolean} [evidence.partial] - 是否因重试耗尽而部分失败中断
 * @param {boolean} [evidence.hasMore] - 平台是否明确还有更多
 * @param {number} [evidence.loadedCount] - 本次实际加载（截断后）条数
 * @param {number} [evidence.maxCount] - 本次生效的加载上限
 * @returns {{truncated: boolean, reason: string}}
 */
export function resolveTruncation({ sawEnd, partial, hasMore, loadedCount, maxCount } = {}) {
    // ✅ 确认到底：无论加载数是否恰好等于上限，都是完整清单，无需提示截断
    if (sawEnd === true) {
        return { truncated: false, reason: '已确认清单到底' };
    }

    // ✅ 因接口失败/重试耗尽中断：数据可能不全，但根因是失败，
    //    不按"达上限截断"口径提示（否则会把一次网络失败误导成"作者作品太多"），交上层错误提示处理
    if (partial === true) {
        return { truncated: false, reason: '本轮存在失败中断，交错误提示处理，不作上限截断标注' };
    }

    // ✅ 平台明确还有更多：一定被截断
    if (hasMore === true) {
        return { truncated: true, reason: `平台仍有更多条目，本轮已达加载上限 ${maxCount}` };
    }

    // 未确认到底、无失败、hasMore 也未给出明确 true：
    //   以"加载数顶到上限"作为截断兜底信号（针对不透出 hasMore 的历史接口）
    const loaded = Number.isFinite(loadedCount) ? loadedCount : 0;
    if (Number.isFinite(maxCount) && maxCount > 0 && loaded >= maxCount) {
        return { truncated: true, reason: `加载数已达上限 ${maxCount} 且未确认到底` };
    }

    return { truncated: false, reason: '未见"清单不全"证据' };
}

export default resolveTruncation;
