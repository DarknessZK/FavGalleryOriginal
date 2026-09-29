// ==========================================
// 批量选择决策 - 业务口径唯一来源
// 职责：批量选择中“可选项口径 / 主键提取 / 规则满足判定 / 当前页切片”等纯决策计算
// 约束：纯函数，不引用 DOM / chrome / 状态对象；仅作者可选性复用同为纯模块的 author-completion
//       （决策/执行分离：DOM 与状态编排留在 core/batch-selection-manager.js，本模块可脱离浏览器单测）
// ==========================================

import { isAuthorSelectable } from './author-completion.js';

/**
 * 列表类型 → 主键字段名
 * 关注列表项是作者（主键 uid），其余（点赞/收藏/作者作品钻取）都是作品（主键 workId）
 * @param {string} listType - 'liked' | 'bookmarked' | 'following' | 'authorWorks'
 * @returns {'uid'|'workId'}
 */
export function getIdKey(listType) {
    return listType === 'following' ? 'uid' : 'workId';
}

/** 是否为作者列表（关注），其余均为作品列表 */
function isAuthorList(listType) {
    return listType === 'following';
}

/**
 * 单项是否可被批量勾选
 * - 作者：沿用 isAuthorSelectable（仅真空/软删除作者不可选，已保存的仍可勾选用于检查更新）
 * - 作品：
 *   · intent='download'（默认）：未下载才可选（已下载作品的复选框被禁用、不纳入批量保存）
 *   · intent='backfill'（校验补全）：已下载（已保存）才可选（对已存作品逐文件核对只补缺件）
 * @param {Object} item - 作品或作者数据
 * @param {string} listType - 列表类型
 * @param {'download'|'backfill'} [intent='download'] - 选择意图（仅对作品列表生效，作者忽略）
 * @returns {boolean}
 */
export function isItemSelectable(item = {}, listType, intent = 'download') {
    if (isAuthorList(listType)) return isAuthorSelectable(item);
    if (intent === 'backfill') return !!item.isDownloaded;
    return !item.isDownloaded;
}

/**
 * 过滤出可勾选项
 * @param {Array} items - 作品/作者数组
 * @param {string} listType - 列表类型
 * @param {'download'|'backfill'} [intent='download'] - 选择意图
 * @returns {Array} 可被批量勾选的项
 */
export function getSelectableItems(items = [], listType, intent = 'download') {
    return items.filter(item => isItemSelectable(item, listType, intent));
}

/**
 * 取单项主键 ID
 * @param {Object} item - 作品或作者数据
 * @param {string} listType - 列表类型
 * @returns {*} uid 或 workId
 */
export function getItemId(item = {}, listType) {
    return item[getIdKey(listType)];
}

/**
 * 可选项的主键 ID 列表 —— 即“选中当前页 / 全选”规则应选中的目标集
 * @param {Array} items - 目标范围内的作品/作者数组（当前页或整个展示集）
 * @param {string} listType - 列表类型
 * @param {'download'|'backfill'} [intent='download'] - 选择意图
 * @returns {Array} 可勾选项的 ID 数组
 */
export function getSelectableIds(items = [], listType, intent = 'download') {
    return getSelectableItems(items, listType, intent).map(item => getItemId(item, listType));
}

/**
 * 判定规则是否“已全部满足”：目标集内所有可选项均处于选中态
 * 用于在 selectCurrentPage / selectAllItems 末尾回写 batchMode：
 *   true  → 规则生效（'current' / 'all'，筛选变动时随新展示集自动重算）
 *   false → 视为已取消（null，手动增减后不再联动）
 * 约定：可选项为空集时 every 返回 true（无可选则不构成“部分选中”，交由上层数量判断处理）。
 * @param {Array} items - 目标范围内的作品/作者数组
 * @param {Set} selectedIdSet - 当前已选中的 ID 集合
 * @param {string} listType - 列表类型
 * @returns {boolean}
 */
export function isRuleSatisfied(items = [], selectedIdSet, listType, intent = 'download') {
    const key = getIdKey(listType);
    return getSelectableItems(items, listType, intent).every(item => selectedIdSet.has(item[key]));
}

/**
 * 当前页切片（currentPage 为 1-based，与 WorkListManager.getCurrentPageData 口径一致）
 * pageSize 非法（<=0 或非数字）时返回空数组，避免 NaN 切片污染选择
 * @param {Array} items - 展示集（筛选/排序后的结果，或全量）
 * @param {number} currentPage - 当前页码（1-based）
 * @param {number} pageSize - 每页数量
 * @returns {Array} 当前页条目
 */
export function sliceCurrentPage(items = [], currentPage = 1, pageSize = 0) {
    const size = toInt(pageSize);
    if (size <= 0) return [];
    const page = Math.max(1, toInt(currentPage));
    const start = (page - 1) * size;
    return items.slice(start, start + size);
}

/** 归一化为大于等于 0 的整数，非法输入按 0 */
function toInt(value) {
    const num = Number(value);
    return Number.isFinite(num) ? Math.floor(num) : 0;
}
