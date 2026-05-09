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
        } else {
            // 2. 降级到文件系统
            logger.info('ℹ️ IndexedDB 无数据，尝试从文件系统加载...');
            const content = await fileSystem.readTextFile(`${fileSystem.getMetadataDir()}/authors_base.js`);

            if (content) {
                const data = fileSystem.deserializeData(content, 'authors_base');
                authors = data?.authors || [];
                logger.info(`✅ 从文件系统加载 ${authors.length} 个作者`);
            }
        }

        // 3. 始终从文件系统加载 metadata
        let metadata = {};
        try {
            const content = await fileSystem.readTextFile(`${fileSystem.getMetadataDir()}/authors_base.js`);
            if (content) {
                const data = fileSystem.deserializeData(content, 'authors_base');
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
 * 查询作者下载状态
 *
 * @param {Object} fileSystem - FileSystem 实例
 * @param {string} uid - 作者ID
 * @returns {Promise<Object|null>} 作者下载状态 { downloadStatus, downloadedCount, totalCount }
 */
export async function getAuthorDownloadStatus(fileSystem, uid) {
    try {
        await fileSystem.initDatabase();
        
        const author = await database.get('authors', uid);
        if (!author) {
            logger.debug(`ℹ️ 作者不存在: ${uid}`);
            return null;
        }
        
        const status = {
            downloadStatus: author.downloadStatus || 'pending',
            downloadedCount: author.downloadedCount || 0,
            totalCount: author.totalCount || 0,
            lastDownloadTime: author.lastDownloadTime || null
        };
        
        logger.debug(`✅ 查询作者状态: ${uid}`, status);
        return status;
    } catch (error) {
        logger.error('❌ 查询作者状态失败:', error);
        return null;
    }
}

/**
 * 更新作者下载状态（保存到 IndexedDB + 异步备份到文件系统）
 *
 * @param {Object} fileSystem - FileSystem 实例
 * @param {Object} backupManager - BackupManager 实例
 * @param {string} uid - 作者ID
 * @param {string} status - 下载状态 'pending' | 'partial' | 'completed'
 * @param {number} downloadedCount - 已下载数量
 * @param {number} totalCount - 总数量
 */
export async function updateAuthorDownloadStatus(fileSystem, backupManager, uid, status, downloadedCount, totalCount) {
    try {
        await fileSystem.initDatabase();
        
        // 获取现有作者数据
        const author = await database.get('authors', uid);
        if (!author) {
            logger.warn(`⚠️ 作者不存在，无法更新状态: ${uid}`);
            return;
        }
        
        // 更新状态字段
        author.downloadStatus = status;
        author.downloadedCount = downloadedCount;
        author.totalCount = totalCount;
        author.lastDownloadTime = Date.now();
        
        // 保存到 IndexedDB
        await database.save('authors', author);
        logger.info(`✅ 已更新作者下载状态: ${uid} -> ${status} (${downloadedCount}/${totalCount})`);
        
        // ✅ 异步备份到文件系统（符合增量备份规则）
        backupManager.performSelectiveBackup(['authors']).catch(error => {
            logger.warn('⚠️ 作者状态备份失败:', error.message);
        });
    } catch (error) {
        logger.error('❌ 更新作者下载状态失败:', error);
        throw error;
    }
}

