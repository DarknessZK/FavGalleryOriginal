// ==========================================
// FavGallery - 作者数据管理器
// 职责：管理作者数据的保存和加载
// ==========================================

import { database } from '../database/database.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('AuthorsManager');

/**
 * 保存作者基本信息到 IndexedDB + 异步备份到文件系统
 *
 * @param {Object} fileSystem - FileSystem 实例
 * @param {Object} backupManager - BackupManager 实例
 * @param {Object} authorsData - 作者数据 { authors: [], metadata: {} }
 */
export async function saveAuthorsBase(fileSystem, backupManager, authorsData) {
    await fileSystem.initDatabase();

    // 保存到 IndexedDB（主存储）- 只保存文档定义的字段
    const items = authorsData.authors.map((author, index) => ({
        uid: author.uid,
        platformId: author.platformId || '',
        nickname: author.nickname || '',
        avatarUrl: author.avatarUrl || '',
        followingCount: author.followingCount || 0,
        followerCount: author.followerCount || 0,
        workCount: author.workCount || 0,
        downloadedCount: author.downloadedCount || 0,
        isDeleted: author.isDeleted !== undefined ? author.isDeleted : false,
        order: index
    }));

    await database.save('authors', items);
    logger.info(`💾 已保存 ${items.length} 个作者到 IndexedDB`);

    // 异步备份到文件系统
    backupManager.performSelectiveBackup(['authors']).catch(error => {
        logger.warn('⚠️ 文件系统备份失败:', error.message);
    });
}

/**
 * 加载作者基本信息（IndexedDB 优先，降级到文件系统）
 *
 * @param {Object} fileSystem - FileSystem 实例
 * @returns {Promise<Object>} { authors: [], metadata: {} }
 */
export async function loadAuthorsBase(fileSystem) {
    try {
        await fileSystem.initDatabase();

        // 1. 尝试从 IndexedDB 加载
        let items;
        try {
            items = await database.getAll('authors');
        } catch (dbError) {
            if (dbError.name === 'InvalidStateError') {
                logger.warn('⚠️ IndexedDB 连接已关闭，降级到文件系统');
                items = null;
            } else {
                throw dbError;
            }
        }

        let authors = [];
        if (items && items.length > 0) {
            items.sort((a, b) => (a.order || 0) - (b.order || 0));
            authors = items.map(({ order, ...author }) => author);
            logger.info(`✅ 从 IndexedDB 加载 ${authors.length} 个作者`);
        }

        // ✅ 始终从文件系统加载 metadata
        let metadata = {};
        try {
            const content = await fileSystem.readTextFile(`${fileSystem.getMetadataDir()}/authors.js`);
            if (content) {
                const data = fileSystem.deserializeData(content, 'authors');
                metadata = data?.metadata || {};
            }
        } catch (error) {
            logger.warn('⚠️ 加载 metadata 失败:', error.message);
        }

        return { authors, metadata };
    } catch (error) {
        logger.error('❌ 加载作者数据失败:', error);
        return { authors: [], metadata: {} };
    }
}

/**
 * 查询作者下载状态（实时计算，不依赖持久化字段）
 *
 * @param {Object} fileSystem - FileSystem 实例
 * @param {string} uid - 作者ID
 * @returns {Promise<Object|null>} 作者下载状态 { downloadStatus, downloadedCount, workCount }
 */
export async function getAuthorDownloadStatus(fileSystem, uid) {
    try {
        await fileSystem.initDatabase();
        
        // 1. ✅ 通过 target 索引查询 work→author 关系（作者作为目标）
        //    关系方向为 {sourceType:'work', targetType:'author'}，故须查 target 索引并取 sourceId；
        //    此前误用 source 索引，取到的是 author→author_group 关系，导致 downloadedCount 恒为 0
        const relations = await database.getByIndex('relations', 'target', ['author', uid]);
        const workRelations = relations.filter(r => r.sourceType === 'work');
        const workCount = workRelations.length;
        
        if (workCount === 0) {
            logger.debug(`ℹ️ 作者无作品: ${uid}`);
            return {
                downloadStatus: 'completed',
                downloadedCount: 0,
                workCount: 0
            };
        }
        
        // 2. 提取所有作品ID
        const workIds = workRelations.map(r => r.sourceId);
        
        // 3. ✅ 批量查询这些作品是否在 completed_works 中（利用主键索引）
        const existingRecords = await database.getByIds('completed_works', workIds);
        const downloadedCount = existingRecords.length;
        
        // 4. 计算状态
        let downloadStatus = 'pending';
        if (downloadedCount > 0) {
            downloadStatus = downloadedCount >= workCount ? 'completed' : 'partial';
        }
        
        const status = {
            downloadStatus,
            downloadedCount,
            workCount
        };
        
        logger.debug(`✅ 查询作者状态: ${uid}, 状态:`, status);
        return status;
    } catch (error) {
        logger.error('❌ 查询作者状态失败:', error);
        return null;
    }
}


