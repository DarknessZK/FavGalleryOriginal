// ==========================================
// FavGallery - 作品数据管理器
// 职责：管理作品数据的保存和加载（点赞、收藏等）
// ==========================================

import { database } from '../database/database.js';
import * as relationManager from '../database/relation-manager.js';
import { markOfflineDirty } from '../export/offline-delta.js';
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
    // ♻️ 登记离线增量：点赞列表刷新会新增/更新/软删作品，下次 flush 按当前关系重建所属分片
    markOfflineDirty(works.map(w => w.workId));
    
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
    // ♻️ 登记离线增量（收藏列表刷新）
    markOfflineDirty(works.map(w => w.workId));
    
    // 2. 更新收藏夹元数据
    // ✅ 合并已有记录：database.save 是 put（整体覆盖），若只传部分字段会丢失
    //    collectName/isDeleted/sortOrder，导致离线页收藏夹显示为“未命名收藏夹”
    const existingCollect = await database.get('collects', collectId);
    await database.save('collects', {
        ...(existingCollect || {}),
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

/**
 * ✅ 保存作者钻取作品列表（与 saveBookmarkedWorks 同构，收藏夹维度换成作者维度）
 * 仅落 works 表元数据；work→author 关系由 data-fetcher._buildRelations 统一建立，
 * 不碰 authors 表（避免覆盖关注列表的 downloadedCount/workCount 等派生字段）
 *
 * @param {Object} fileSystem - FileSystem 实例
 * @param {Object} data - 作品数据 { works: [], uid: string }
 */
export async function saveAuthorWorks(fileSystem, data) {
    await fileSystem.initDatabase();

    const works = data.works || [];
    const uid = data.uid;

    if (!uid) {
        throw new Error('缺少 uid 参数');
    }

    if (works.length === 0) {
        logger.info('ℹ️ 作者作品为空，跳过保存');
        return;
    }

    // 保存作品元数据到 works store
    const worksToSave = works.map(work => {
        const sanitizedWork = _sanitizeWorkForStorage(work);
        return {
            workId: work.workId,
            ...sanitizedWork
        };
    });
    await database.save('works', worksToSave);
    // ♻️ 登记离线增量（作者作品刷新）
    markOfflineDirty(works.map(w => w.workId));

    logger.info(`💾 已保存 ${works.length} 个作者作品到 IndexedDB (作者: ${uid})`);

    // 注意：备份由 backup-manager.js 统一处理，不在这里异步备份
}

/**
 * ✅ 加载指定作者的钻取作品列表（关系驱动，与 loadBookmarkedWorks 同构）
 *
 * @param {Object} fileSystem - FileSystem 实例
 * @param {string} uid - 作者UID
 * @returns {Promise<Object>} { works: [], metadata: {}, uid }
 */
export async function loadAuthorWorks(fileSystem, uid) {
    try {
        await fileSystem.initDatabase();

        if (!uid) {
            return { works: [], metadata: {}, uid };
        }

        // 1. 从关系表获取该作者的所有作品ID（work→author）
        const relations = await relationManager.getIncomingRelations('author', uid);

        // ✅ 按写入时的递减时间戳排序，保持 API 返回的 新→旧 顺序
        relations.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        const workIds = relations
            .filter(r => r.sourceType === 'work')
            .map(r => r.sourceId);

        if (workIds.length === 0) {
            logger.info(`ℹ️ IndexedDB 中无作者 ${uid} 的作品关系`);
            return { works: [], metadata: {}, uid };
        }

        // 2. 批量获取作品详情，按 workIds 顺序重排
        const works = await database.getByIds('works', workIds);
        const workMap = new Map(works.map(w => [w.workId, w]));
        const sortedWorks = workIds
            .map(id => workMap.get(id))
            .filter(w => w !== undefined);

        logger.info(`✅ 从 IndexedDB 加载作者 ${uid} 的 ${sortedWorks.length} 个作品`);

        return { works: sortedWorks, metadata: {}, uid };
    } catch (error) {
        logger.error(`❌ 加载作者 ${uid} 的作品失败:`, error);
        return { works: [], metadata: {}, uid };
    }
}
