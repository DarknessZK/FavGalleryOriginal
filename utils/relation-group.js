// ==========================================
// FavGallery - 关系分组（纯逻辑，零依赖）
// 职责：按 (targetType, targetId) 给关系条目分组，供批量写入前逐组查询已存在关系做去重
//
// 缺陷背景：旧实现用 `${targetType}_${targetId}` 拼分组键，再用 key.split('_') 反解，
//   而 targetType/targetId 自身就含下划线，于是解析错位：
//     work → liked_group    → ('work', 'liked', 'group') 反解成 targetType='work', targetId='liked'  ❌
//     author → author_group → 反解成 targetId='author'                                            ❌
//     collect → collect_group 同理错误；只有 targetId 为纯数字的 work→collect / work→author 侥幸正确
//   后果：getIncomingRelations 永远查不到既有关系，去重完全失效，
//   每轮刷新都全量重写关系表并触发 relations 整表备份（实测 800 条 / 196KB / 十几秒）。
//
// 修法：分组键只作为 Map 的键使用，需要目标类型/ID 时一律取组内条目的原始字段，绝不做字符串反解。
// ==========================================

/** 分组键分隔符：用 NUL 字符，任何 ID 都不含它，因此拼接-反解不再有二义性 */
const KEY_SEPARATOR = '\u0000';

/**
 * 构造分组键（仅供 Map 内部使用，不可反解出业务字段）
 * @param {Object} item - 关系条目 { targetType, targetId, ... }
 * @returns {string} 分组键
 */
export function buildRelationGroupKey(item) {
    return `${item.targetType}${KEY_SEPARATOR}${item.targetId}`;
}

/**
 * 按目标实体分组
 * @param {Array<Object>} items - 关系条目数组
 * @returns {Map<string, {targetType: string, targetId: string, items: Array<Object>}>}
 *          每组的 targetType/targetId 直接取自条目原始字段
 */
export function groupRelationsByTarget(items = []) {
    const groups = new Map();

    for (const item of items) {
        const key = buildRelationGroupKey(item);
        let group = groups.get(key);
        if (!group) {
            group = { targetType: item.targetType, targetId: item.targetId, items: [] };
            groups.set(key, group);
        }
        group.items.push(item);
    }

    return groups;
}

export default {
    buildRelationGroupKey,
    groupRelationsByTarget
};
