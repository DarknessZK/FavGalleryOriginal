// ==========================================
// FavGallery - 收藏夹元数据管理器
// 职责：管理收藏夹列表的保存和加载
// ==========================================

import { database } from '../database/database.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('CollectsManager');

/**
 * 保存收藏夹列表元数据
 *
 * @param {Object} fileSystem - FileSystem 实例
 * @param {Array} collects - 收藏夹列表
 */
export async function saveCollects(fileSystem, collects) {
    await fileSystem.initDatabase();
    
    const items = collects.map(collect => ({
        collectId: collect.collectId || collect.collects_id,
        collectName: collect.collectName || collect.collects_name,
        workCount: collect.workCount || collect.video_count || 0,
        ...collect
    }));
    
    await database.save('collects', items);
    logger.info(`💾 已保存 ${items.length} 个收藏夹元数据`);
}

/**
 * 加载所有收藏夹元数据
 *
 * @param {Object} fileSystem - FileSystem 实例
 * @returns {Promise<Array>} 收藏夹列表
 */
export async function loadAllCollects(fileSystem) {
    await fileSystem.initDatabase();
    
    const collects = await database.getAll('collects');
    logger.info(`✅ 加载 ${collects?.length || 0} 个收藏夹元数据`);
    return collects || [];
}
