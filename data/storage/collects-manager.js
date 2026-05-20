// ==========================================
// FavGallery - 收藏夹元数据管理器
// 职责：管理收藏夹列表的保存和加载
// ==========================================

import { database } from '../database/database.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('CollectsManager');

/**
 * 保存收藏夹列表元数据到 IndexedDB + 异步备份到文件系统
 *
 * @param {Object} fileSystem - FileSystem 实例
 * @param {Object} backupManager - BackupManager 实例
 * @param {Array} collects - 收藏夹列表
 */
export async function saveCollects(fileSystem, backupManager, collects) {
    await fileSystem.initDatabase();
    
    const items = collects.map(collect => ({
        collectId: collect.collectId,
        collectName: collect.collectName,
        workCount: collect.workCount,
        isDeleted: collect.isDeleted || false,
        sortOrder: collect.sortOrder || 0
    }));
    
    await database.save('collects', items);
    logger.info(`💾 已保存 ${items.length} 个收藏夹元数据到 IndexedDB`);
    
    // ✅ 异步备份到文件系统
    backupManager.performSelectiveBackup(['collects']).catch(error => {
        logger.warn('⚠️ 收藏夹文件系统备份失败:', error.message);
    });
}

/**
 * 加载所有收藏夹元数据（IndexedDB 优先，降级到文件系统）
 *
 * @param {Object} fileSystem - FileSystem 实例
 * @returns {Promise<Object>} {collects: Array, metadata: Object} 收藏夹列表和元数据
 */
export async function loadAllCollects(fileSystem) {
    try {
        await fileSystem.initDatabase();
        
        // 1. 尝试从 IndexedDB 加载
        let collects;
        try {
            collects = await database.getAll('collects');
        } catch (dbError) {
            if (dbError.name === 'InvalidStateError') {
                logger.warn('⚠️ IndexedDB 连接已关闭，降级到文件系统');
                collects = null;
            } else {
                throw dbError;
            }
        }
        
        if (collects && collects.length > 0) {
            logger.info(`✅ 从 IndexedDB 加载 ${collects.length} 个收藏夹`);
            return { collects, metadata: {} };
        }
        
        // 2. 降级到文件系统
        logger.info('ℹ️ IndexedDB 无数据，尝试从文件系统加载...');
        const content = await fileSystem.readTextFile(`${fileSystem.getMetadataDir()}/collects.js`);
        
        if (content) {
            const data = fileSystem.deserializeData(content, 'collects');
            collects = data?.collects || [];
            logger.info(`✅ 从文件系统加载 ${collects.length} 个收藏夹`);
            return { collects, metadata: {} };
        }
        
        logger.info('📭 未找到收藏夹数据');
        return { collects: [], metadata: {} };
    } catch (error) {
        logger.error('❌ 加载收藏夹数据失败:', error);
        return { collects: [], metadata: {} };
    }
}
