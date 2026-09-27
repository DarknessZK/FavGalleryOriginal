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

/**
 * ✅ 批量查询作者下载状态（实时计算，关注列表渲染后的统一校正数据源）
 * 不依赖 authors 表的 downloadedCount 派生字段：该字段仅由「按作者保存」链路累加，
 * 钻取视图/单卡保存不会触发，导数永远偏小；关系表∩完成表才是全链路一致的真相
 *
 * @param {Object} fileSystem - FileSystem 实例
 * @param {Array<string>} uids - 作者ID列表
 * @returns {Promise<Object>} { uid: { downloadedCount, workCount } }，
 *          仅包含已有 work→author 关系的作者（无关系数据的不出现在结果中，调用方保留原值）
 */
export async function getAuthorsDownloadStatusBatch(fileSystem, uids) {
    const statuses = {};
    if (!uids || uids.length === 0) {
        return statuses;
    }

    try {
        await fileSystem.initDatabase();

        // ✅ 已完成集合一次性取出，避免逐作者重复全表查询
        const downloadedIds = new Set(await database.getDownloadedWorkIds());

        // ✅ 关系表也是单次全量取出后内存分组（与 completed_works 同策略）：
        //    逐作者 getByIndex 在 60 作者规模下会产生 60 条事务 + 60 条日志噪音
        const uidSet = new Set(uids.map(String));
        const byUid = {};
        const allRelations = await database.getAll('relations');
        for (const rel of allRelations) {
            if (rel.sourceType !== 'work' || rel.targetType !== 'author') continue;
            if (!uidSet.has(String(rel.targetId))) continue;
            // 分组键统一 String化，防关系里存数字型 targetId 与 uid 键型不一致查不到
            (byUid[String(rel.targetId)] ||= []).push(rel);
        }

        for (const uid of uidSet) {
            const workRelations = byUid[uid];
            if (!workRelations || workRelations.length === 0) continue;

            const workCount = workRelations.length;
            const downloadedCount = workRelations.filter(r => downloadedIds.has(r.sourceId)).length;

            // 消费端（applyAuthorStatuses）只需要两个计数；
            // downloadStatus 派生判断由单数版 getAuthorDownloadStatus 供「继续下载」链路自用，批量版不必算
            statuses[uid] = { downloadedCount, workCount };
        }

        logger.info(`📊 作者下载状态批量计算: ${Object.keys(statuses).length}/${uids.length} 个作者有关系数据`);
    } catch (error) {
        logger.error('❌ 批量查询作者状态失败:', error);
    }

    return statuses;
}

/**
 * ✅ 合并更新作者下载统计字段（Content 主库唯一合法写入口）
 * 背景：Sidebar 与 Content 的 IndexedDB 按 origin 隔离（chrome-extension:// vs 页面 origin），
 * Sidebar 上下文的 database.save('authors') 写的是影子库，刷新关注列表（读 Content 库）永远看不到；
 * 下载计数持久化必须由 Sidebar 经 UPDATE_AUTHOR_DOWNLOAD_STATS 消息委托本函数写主库
 *
 * @param {Object} fileSystem - FileSystem 实例
 * @param {Object} stats - { uid: { downloadedCount, workCount } }
 */
export async function updateAuthorsDownloadStats(fileSystem, stats = {}) {
    await fileSystem.initDatabase();

    for (const [uid, s] of Object.entries(stats)) {
        try {
            // ✅ 读取已有记录合并：save 是 put 整体覆盖，只传部分字段会丢失昵称/头像等基础数据
            const existing = await database.get('authors', uid);
            if (!existing) {
                logger.warn(`⚠️ 主库无该作者记录，跳过统计写入: ${uid}`);
                continue;
            }

            const downloadedCount = s.downloadedCount || 0;
            // ✅ workCount 取大值：API aweme_count 与关系精确数并存时不被缩小
            const workCount = Math.max(existing.workCount || 0, s.workCount || 0);
            await database.save('authors', {
                ...existing,
                downloadedCount,
                workCount,
                lastUpdate: Date.now()
            });

            logger.info(`💾 已合并更新作者下载统计（主库）: ${uid} -> ${downloadedCount}/${workCount}`);
        } catch (error) {
            logger.warn(`⚠️ 更新作者下载统计失败: ${uid}`, error.message);
        }
    }
}


