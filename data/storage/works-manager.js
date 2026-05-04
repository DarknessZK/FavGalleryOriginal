// ==========================================
// FavGallery - 作品数据管理器
// 职责：管理作品数据的保存和加载（点赞、收藏等）
// ==========================================

import { database } from '../database/database.js';
import * as relationManager from '../database/relation-manager.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('WorksManager');

/**
 * 清理作品数据中不应该持久化的字段
 * @param {Object} work - 原始作品对象
 * @returns {Object} 清理后的作品对象
 * @private
 */
function _sanitizeWorkForStorage(work) {
    if (!work || !work.video) {
        return work;
    }

    // 创建深拷贝，避免修改原对象
    const sanitized = JSON.parse(JSON.stringify(work));

    // 删除 video.play_addr（临时下载地址，不应持久化）
    if (sanitized.video && sanitized.video.play_addr) {
        delete sanitized.video.play_addr;
    }

    return sanitized;
}

/**
 * 保存点赞作品列表（新架构）
 *
 * @param {Object} fileSystem - FileSystem 实例
 * @param {Object} data - 作品数据 { works: [], metadata: {} }
 */
export async function saveLikedWorks(fileSystem, data) {
    await fileSystem.initDatabase();

    const works = data.works || data;
    
    // 1. 保存作品元数据到 works store
    const worksToSave = works.map((work, index) => {
        const sanitizedWork = _sanitizeWorkForStorage(work);
        return {
            workId: work.workId,
            ...sanitizedWork
        };
    });
    await database.save('works', worksToSave);
    
    // 2. 保存点赞分组元数据
    await database.save('liked_group', {
        groupId: 'liked',
        groupName: '点赞',
        icon: '❤️',
        workCount: works.length
    });
    
    logger.info(`💾 已保存 ${works.length} 个点赞作品到 IndexedDB`);

    // 注意：备份由 backup-manager.js 统一处理，不在这里异步备份
}

/**
 * 加载点赞作品列表（新架构）
 *
 * @param {Object} fileSystem - FileSystem 实例
 * @returns {Promise<Object>} { works: [], metadata: {} }
 */
export async function loadLikedWorks(fileSystem) {
    try {
        await fileSystem.initDatabase();

        // 1. 从关系表获取所有点赞作品ID
        const relations = await relationManager.getIncomingRelations('liked_group', 'liked');
        logger.info(`📊 relations 表查询结果: ${relations.length} 条关系 (targetType='liked_group', targetId='liked')`);

        // ✅ 按点赞时间排序（createdAt），最新的在前
        relations.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        
        const workIds = relations.map(r => r.sourceId);
        logger.info(`📋 提取到 ${workIds.length} 个作品ID，前3个: ${workIds.slice(0, 3).join(', ')}`);
        
        if (workIds.length > 0) {
            // 2. 批量获取作品详情
            const works = await database.getByIds('works', workIds);
            logger.info(`📊 getByIds 返回 ${works.length} 个作品，前3个ID: ${works.slice(0, 3).map(w => w.workId).join(', ')}`);

            // ✅ 按 workIds 的顺序重新排序，并合并 relations 的 createdAt
            const workMap = new Map(works.map(w => [w.workId, w]));
            const relationMap = new Map(relations.map(r => [r.sourceId, r.createdAt]));
            
            const sortedWorks = workIds
                .map(id => {
                    const work = workMap.get(id);
                    if (work) {
                        // ✅ 将 relations 的 createdAt 合并到 works 对象
                        return {
                            ...work,
                            createdAt: relationMap.get(id) || work.createdAt
                        };
                    }
                    return undefined;
                })
                .filter(w => w !== undefined);
            
            logger.info(`✅ 从 IndexedDB 加载 ${sortedWorks.length} 个点赞作品（已按点赞时间排序）`);
            
            // 3. 加载元数据
            const likedGroup = await database.get('liked_group', 'liked');
            const metadata = likedGroup || {};
            
            return { works: sortedWorks, metadata };
        }

        // IndexedDB 无数据，返回空列表
        logger.info('ℹ️ IndexedDB 中无点赞作品');
        return { works: [], metadata: {} };
    } catch (error) {
        logger.error('❌ 加载点赞作品失败:', error);
        logger.error('   错误类型:', typeof error);
        logger.error('   错误消息:', error?.message || '无消息');
        logger.error('   错误堆栈:', error?.stack || '无堆栈');
        return { works: [], metadata: {} };
    }
}

/**
 * 保存收藏作品列表（新架构）
 *
 * @param {Object} fileSystem - FileSystem 实例
 * @param {Object} data - 作品数据 { works: [], collectId: string }
 */
export async function saveBookmarkedWorks(fileSystem, data) {
    await fileSystem.initDatabase();

    const works = data.works || data;
    const collectId = data.collectId || data.collects_id;
    
    if (!collectId) {
        throw new Error('缺少 collectId 参数');
    }
    
    // 1. 保存作品元数据到 works store
    const worksToSave = works.map((work, index) => {
        const sanitizedWork = _sanitizeWorkForStorage(work);
        return {
            workId: work.workId,
            ...sanitizedWork
        };
    });
    await database.save('works', worksToSave);
    
    // 2. 更新收藏夹元数据
    await database.save('collects', {
        collectId: collectId,
        workCount: works.length,
        lastUpdate: Date.now()
    });
    
    logger.info(`💾 已保存 ${works.length} 个收藏作品到 IndexedDB (收藏夹: ${collectId})`);

    // 注意：备份由 backup-manager.js 统一处理，不在这里异步备份
}

/**
 * 加载指定收藏夹的作品列表（新架构）
 *
 * @param {Object} fileSystem - FileSystem 实例
 * @param {string} collectId - 收藏夹ID
 * @returns {Promise<Object>} { works: [], metadata: {} }
 */
export async function loadBookmarkedWorks(fileSystem, collectId) {
    try {
        await fileSystem.initDatabase();

        // 1. 从关系表获取收藏夹的所有作品ID（按收藏时间排序）
        const relations = await relationManager.getIncomingRelations('collect', collectId);
        
        // ✅ 按收藏时间排序（createdAt），最新的在前
        relations.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        
        const workIds = relations
            .filter(r => r.sourceType === 'work')
            .map(r => r.sourceId);
        
        logger.info(`📋 提取到 ${workIds.length} 个作品ID，前3个: ${workIds.slice(0, 3).join(', ')}`);
        
        if (workIds.length > 0) {
            // 2. 批量获取作品详情
            const works = await database.getByIds('works', workIds);
            logger.info(`📊 getByIds 返回 ${works.length} 个作品，前3个ID: ${works.slice(0, 3).map(w => w.workId).join(', ')}`);
                            
            // ✅ 按 workIds 的顺序重新排序（因为 getByIds 返回顺序不确定）
            const workMap = new Map(works.map(w => [w.workId, w]));
            const sortedWorks = workIds
                .map(id => workMap.get(id))
                .filter(w => w !== undefined);
                            
            logger.info(`✅ 从 IndexedDB 加载收藏夹 ${collectId} 的 ${sortedWorks.length} 个作品，前3个ID: ${sortedWorks.slice(0, 3).map(w => w.workId).join(', ')}（已按收藏时间排序）`);
            
            // 4. 加载元数据
            const collectInfo = await database.get('collects', collectId);
            const metadata = collectInfo || {};
            
            return { works: sortedWorks, metadata, collectId };
        }

        // IndexedDB 无数据，返回空列表
        logger.info(`ℹ️ IndexedDB 中无收藏夹 ${collectId} 的作品`);
        return { works: [], metadata: {}, collectId };
    } catch (error) {
        logger.error(`❌ 加载收藏夹 ${collectId} 失败:`, error);
        return { works: [], metadata: {}, collectId };
    }
}
