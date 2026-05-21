// ==========================================
// FavGallery - 通用关系管理器
// 职责：管理 works、authors、collects 等实体之间的关系
// ==========================================

import { database } from './database.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('RelationManager');

/**
 * 生成关系 ID
 * @param {string} sourceType - 来源类型
 * @param {string} sourceId - 来源ID
 * @param {string} targetType - 目标类型
 * @param {string} targetId - 目标ID
 * @returns {string} 复合主键
 */
function generateRelationId(sourceType, sourceId, targetType, targetId) {
    return `${sourceType}_${sourceId}_${targetType}_${targetId}`;
}

/**
 * 批量添加关系（智能去重）
 * @param {Array<Object>} relations - 关系数组
 * @returns {Promise<void>}
 */
export async function batchAddRelations(relations) {
    try {
        // ✅ 准备所有待插入的关系项
        const items = relations.map(rel => ({
            id: generateRelationId(rel.sourceType, rel.sourceId, rel.targetType, rel.targetId),
            ...rel,
            // ✅ 优先使用传入的 createdAt，只有在没有提供时才使用当前时间
            createdAt: rel.createdAt || Date.now()
        }));

        // ✅ 按 targetType + targetId 分组
        const groups = new Map();
        for (const item of items) {
            const key = `${item.targetType}_${item.targetId}`;
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key).push(item);
        }

        // ✅ 批量查询每个分组已存在的关系
        const existingIds = new Set();
        for (const [key, groupItems] of groups) {
            const [targetType, targetId] = key.split('_');
            const existingRelations = await getIncomingRelations(targetType, targetId);
            existingRelations.forEach(rel => existingIds.add(rel.id));
        }

        // ✅ 过滤掉已存在的关系，只保留新的
        const newItems = items.filter(item => !existingIds.has(item.id));
        
        if (newItems.length > 0) {
            await database.save('relations', newItems);
            logger.info(`✅ 批量添加关系: ${newItems.length} 条新关系（跳过 ${items.length - newItems.length} 条已存在）`);
        } else {
            logger.debug(`ℹ️ 所有关系已存在，无需更新（共 ${items.length} 条）`);
        }
    } catch (err) {
        logger.error(`❌ 批量添加关系失败`, err);
        throw err;
    }
}

/**
 * 查询某实体的所有入边关系（作为目标）
 * @param {string} targetType - 目标类型
 * @param {string} targetId - 目标ID
 * @returns {Promise<Array>} 关系数组
 */
export async function getIncomingRelations(targetType, targetId) {
    try {
        const relations = await database.getByIndex(
            'relations',
            'target',
            [targetType, targetId]
        );
        return relations || [];
    } catch (err) {
        logger.error(`❌ 查询入边关系失败: ${targetType}:${targetId}`, err);
        throw err;
    }
}

/**
 * 获取收藏夹的所有作品ID
 * @param {string} collectId - 收藏夹ID
 * @returns {Promise<Array<string>>} 作品ID数组
 */
export async function getCollectWorkIds(collectId) {
    const relations = await getIncomingRelations('collect', collectId);
    return relations
        .filter(r => r.sourceType === 'work')
        .map(r => r.sourceId);
}

// ⚠️ 预留功能 - 用于精细化的关系管理
/**
 * 删除关系
 * @param {string} sourceType - 来源类型
 * @param {string} sourceId - 来源ID
 * @param {string} targetType - 目标类型
 * @param {string} targetId - 目标ID
 * @returns {Promise<void>}
 */
export async function removeRelation(sourceType, sourceId, targetType, targetId) {
    const id = generateRelationId(sourceType, sourceId, targetType, targetId);

    try {
        await database.delete('relations', id);
        logger.debug(`🗑️ 删除关系: ${id}`);
    } catch (err) {
        logger.error(`❌ 删除关系失败: ${id}`, err);
        throw err;
    }
}

// ⚠️ 预留功能 - 用于存在性检查
/**
 * 检查关系是否存在
 * @param {string} sourceType - 来源类型
 * @param {string} sourceId - 来源ID
 * @param {string} targetType - 目标类型
 * @param {string} targetId - 目标ID
 * @returns {Promise<boolean>} 是否存在
 */
export async function hasRelation(sourceType, sourceId, targetType, targetId) {
    // TODO: 需要实现 getRelation 或使用其他方式查询
    // 当前简化实现，未来可优化
    try {
        const relations = await getIncomingRelations(targetType, targetId);
        return relations.some(r => r.sourceType === sourceType && r.sourceId === sourceId);
    } catch (err) {
        logger.error(`❌ 检查关系失败`, err);
        return false;
    }
}

/**
 * 查询某实体的所有出边关系（作为来源）
 * @param {string} sourceType - 来源类型
 * @param {string} sourceId - 来源ID
 * @returns {Promise<Array>} 关系数组
 */
export async function getOutgoingRelations(sourceType, sourceId) {
    try {
        const relations = await database.getByIndex(
            'relations',
            'source',  // ✅ 使用 source 索引
            [sourceType, sourceId]
        );
        return relations || [];
    } catch (err) {
        logger.error(`❌ 查询出边关系失败: ${sourceType}:${sourceId}`, err);
        throw err;
    }
}

// ⚠️ 预留功能 - 用于完整性检查
/**
 * 获取作者所有作品ID
 * @param {string} uid - 作者UID
 * @returns {Promise<Array<string>>} 作品ID数组
 */
export async function getAuthorWorkIds(uid) {
    const relations = await getIncomingRelations('author', uid);
    return relations
        .filter(r => r.sourceType === 'work')
        .map(r => r.sourceId);
}

// ⚠️ 预留功能 - 用于反向查询
/**
 * 获取作品所属的收藏夹ID列表
 * @param {string} workId - 作品ID
 * @returns {Promise<Array<string>>} 收藏夹ID列表
 */
export async function getWorkCollectIds(workId) {
    try {
        // ✅ 使用 getOutgoingRelations 替代全表扫描，性能提升 10-100倍
        const relations = await getOutgoingRelations('work', workId);
        
        return relations
            .filter(r => r.targetType === 'collect')
            .map(r => r.targetId);
    } catch (err) {
        logger.error(`❌ 获取作品收藏夹失败`, err);
        return [];
    }
}


// ⚠️ 预留功能 - 用于 UI 进度显示
/**
 * 计算收藏夹的下载进度
 * @param {string} collectId - 收藏夹ID
 * @returns {Promise<Object>} 下载进度信息
 */
export async function calculateCollectProgress(collectId) {
    try {
        const workIds = await getCollectWorkIds(collectId);

        if (workIds.length === 0) {
            return {
                collects_id: collectId,
                downloadedCount: 0,
                totalCount: 0,
                isPartial: false,
                downloadedWorkIds: []
            };
        }

        const downloadedWorkIds = [];
        for (const workId of workIds) {
            const completed = await database.get('completed_works', workId);
            if (completed) {
                downloadedWorkIds.push(workId);
            }
        }

        return {
            collects_id: collectId,
            downloadedWorkIds,
            downloadedCount: downloadedWorkIds.length,
            totalCount: workIds.length,
            isPartial: downloadedWorkIds.length > 0 && downloadedWorkIds.length < workIds.length
        };
    } catch (err) {
        logger.error(`❌ 计算收藏夹进度失败: ${collectId}`, err);
        throw err;
    }
}


/**
 * 获取作者所属的分组ID列表
 * @param {string} uid - 作者UID
 * @returns {Promise<Array<string>>} 分组ID列表
 */
export async function getAuthorGroupIds(uid) {
    try {
        const relations = await getOutgoingRelations('author', uid);
        
        return relations
            .filter(r => r.targetType === 'author_group')
            .map(r => r.targetId);
    } catch (err) {
        logger.error(`❌ 获取作者分组失败`, err);
        return [];
    }
}

// 导出默认对象
export default {
    batchAddRelations,
    removeRelation,
    getIncomingRelations,
    getOutgoingRelations,      // ✅ 新增：查询出边关系
    hasRelation,
    getAuthorWorkIds,
    getWorkCollectIds,
    getCollectWorkIds,
    getAuthorGroupIds          // ✅ 新增：获取作者分组
};
