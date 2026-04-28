// ==========================================
// FavGallery - 数据获取服务
// 职责：统一管理点赞/收藏/关注列表的数据获取逻辑（API 请求、缓存合并、持久化）
// ==========================================

import { CONFIG } from '../../config/constants.js';
import { platformAPI } from '../../api/platform-adapter.js';
import { mergeDataWithCache, mergeWorkData } from '../../utils/helpers.js';
import { createLogger } from '../../utils/logger.js';
import { fileSystem } from '../../data/file-system.js';
import { backupManager } from '../../data/backup-manager.js';
import * as relationManager from '../../data/relation-manager.js';
import { database } from '../../data/database.js';

const logger = createLogger('DataFetcher');

export class DataFetcher {
    constructor() {
        this.folderSelected = false;
    }

    /**
     * 设置文件夹选择状态
     */
    setFolderSelected(status) {
        this.folderSelected = status;
    }

    /**
     * 从 IndexedDB 加载点赞作品列表（不触发网络请求）
     */
    async loadLikedWorksFromStorage(iframe) {
        try {
            logger.info('开始从存储加载点赞列表...');

            const result = await fileSystem.loadLikedWorks();
            const works = result.works || [];

            if (works.length > 0) {
                logger.info(`✅ 从存储加载 ${works.length} 个作品`);
            } else {
                logger.info('📭 存储中没有数据');
            }

            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'LIKED_WORKS_LOADED',
                works: works,
                total: works.length,
                fromCache: true
            }, '*');

        } catch (error) {
            logger.error('从存储加载点赞列表失败', error);

            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'LIKED_WORKS_ERROR',
                error: error.message
            }, '*');
        }
    }

    /**
     * 加载点赞作品列表（从 API 获取并合并缓存）
     */
    async loadLikedWorks(iframe, maxCount = CONFIG.FETCH_CONFIG.LIST_DEFAULTS.LIKED) {
        try {
            if (!this.folderSelected) {
                logger.error('❌ 请先选择文件夹');

                iframe.contentWindow.postMessage({
                    source: 'content',
                    type: 'LIKED_WORKS_ERROR',
                    error: '请先点击"选择文件夹"按钮'
                }, '*');
                return;
            }

            // ✅ 先清空列表
            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'CLEAR_LIKED_LIST'
            }, '*');

            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'LOAD_DATA_START',
                listType: 'liked'
            }, '*');

            logger.info(`🚀 开始加载点赞列表 (max: ${maxCount})...`);

            // ✅ 从存储加载缓存数据
            let cacheResult = await fileSystem.loadLikedWorks();
            let cachedWorks = cacheResult.works || [];
            let metadata = cacheResult.metadata || {};

            if (cachedWorks.length > 0) {
                logger.info(`📊 缓存中有 ${cachedWorks.length} 个点赞作品`);
                
                // ✅ 立即显示缓存数据（用户体验优化）
                iframe.contentWindow.postMessage({
                    source: 'content',
                    type: 'LIKED_WORKS_LOADED',
                    works: cachedWorks,
                    total: cachedWorks.length,
                    fromCache: true  // 标记为缓存数据
                }, '*');
                
                logger.info(`✅ 已立即显示 ${cachedWorks.length} 个缓存作品`);
            }

            // ✅ 前置判断：如果缓存数据已达到 maxCount，跳过 API 请求
            if (cachedWorks.length >= maxCount) {
                logger.info(`✅ 缓存已有 ${cachedWorks.length} 个作品（>= maxCount ${maxCount}），跳过 API 请求`);
                
                // 发送完成信号
                iframe.contentWindow.postMessage({
                    source: 'content',
                    type: 'LIKED_WORKS_LOADED',
                    works: cachedWorks,
                    total: cachedWorks.length
                }, '*');
                
                return; // 直接返回，不发起 API 请求
            }

            // ✅ 创建进度回调
            const onProgress = (currentCount, totalCount) => {
                if (iframe && iframe.contentWindow) {
                    iframe.contentWindow.postMessage({
                        source: 'content',
                        type: 'LIKED_WORKS_PROGRESS',
                        currentCount: currentCount,
                        totalCount: totalCount
                    }, '*');
                }
            };

            // ✅ 调用 API 获取数据（仅当缓存不足时）
            const cachedWorkIds = cachedWorks.map(w => w.workId);
            const apiResult = await platformAPI.getLikedWorks(maxCount, onProgress, cachedWorkIds, metadata);
            const apiWorks = apiResult.works || [];

            logger.info(`✅ API 返回 ${apiWorks.length} 个点赞作品`);

            // ✅ 合并数据（使用工具函数）
            const { mergedData, newCount, updatedMetadata } = mergeWorkData(
                cachedWorks,
                apiWorks,
                metadata,
                'lastMaxCursor',
                apiResult
            );

            // 🎯 发送数据到前端
            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'LIKED_WORKS_LOADED',
                works: mergedData,
                total: mergedData.length
            }, '*');

            logger.info(`✅ 加载完成: ${mergedData.length} 个点赞作品`);

            // ✅ 保存数据到新架构
            await this.saveLikedWorksData({
                apiWorks,
                newCount,
                mergedData,
                updatedMetadata
            });

        } catch (error) {
            logger.error('获取点赞列表失败', error);

            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'LIKED_WORKS_ERROR',
                error: error.message
            }, '*');
        }
    }

    /**
     * 保存点赞作品数据（新架构）
     */
    async saveLikedWorksData(data) {
        // 没有新数据，不保存
        if (!data.apiWorks || (data.apiWorks.length === 0 && data.newCount === 0)) {
            logger.info('ℹ️ 没有新数据，跳过保存');
            return;
        }

        try {
            // 1. 保存到 IndexedDB（主存储）+ 异步备份到文件系统
            await fileSystem.saveLikedWorks({
                works: data.mergedData,
                metadata: data.updatedMetadata
            });

            logger.info(`✅ 已保存最新点赞列表: ${data.mergedData.length} 个作品`);

            // 2. 建立作品与作者的关联关系 + 作品与点赞分组的关系
            await this.buildWorkAuthorRelations(data.mergedData, 'liked');

            // 3. ✅ 触发备份（列表加载完成后备份）
            const batchCount = Math.ceil(data.apiWorks.length / 20); // API 每批 20 个
            const BACKUP_BATCH_INTERVAL = CONFIG.BACKUP_CONFIG.listBackup?.batchInterval || 5;
            
            if (batchCount >= BACKUP_BATCH_INTERVAL) {
                logger.info(`🔄 已加载 ${batchCount} 批，触发备份...`);
                // ✅ 使用选择性备份，备份列表相关的所有表
                await backupManager.performSelectiveBackup([
                    'works',
                    'authors',
                    'collects',
                    'author_groups',
                    'liked_group',
                    'relations'
                ]);
            }

        } catch (error) {
            logger.warn('⚠️ 保存点赞列表失败', error);
            logger.warn('   错误类型:', typeof error);
            logger.warn('   错误消息:', error?.message || '无消息');
            logger.warn('   错误堆栈:', error?.stack || '无堆栈');
        }
    }

    /**
     * 建立作品与作者的关系
     * @param {Array} works - 作品列表（包括视频、图集等）
     * @param {string} listType - 列表类型（'liked' | 'collected'）
     * @param {string} collectId - 收藏夹ID（仅当 listType 为 'collected' 时需要）
     */
    async buildWorkAuthorRelations(works, listType = 'liked', collectId = null) {
        try {
            const relations = [];
            const now = Date.now();

            for (const work of works) {
                // 1. 建立 作品 → 作者 的关系（始终建立）
                if (work.author && work.author.uid) {
                    relations.push({
                        sourceType: 'work',
                        sourceId: work.workId,
                        targetType: 'author',
                        targetId: work.author.uid,
                        createdAt: now
                    });
                }

                // 2. 根据列表类型建立 作品 → 分组 的关系
                if (listType === 'liked') {
                    // 点赞列表：建立 作品 → liked_group 的关系
                    relations.push({
                        sourceType: 'work',
                        sourceId: work.workId,
                        targetType: 'liked_group',
                        targetId: 'liked',
                        createdAt: now
                    });
                } else if (listType === 'collected' && collectId) {
                    // 收藏列表：建立 作品 → collect 的关系
                    relations.push({
                        sourceType: 'work',
                        sourceId: work.workId,
                        targetType: 'collect',
                        targetId: collectId,
                        createdAt: now
                    });
                }
            }

            if (relations.length > 0) {
                await relationManager.batchAddRelations(relations);
                logger.debug(`✅ 建立了 ${relations.length} 个关系记录`);
            }
        } catch (error) {
            logger.warn('⚠️ 建立关系失败', error);
        }
    }
}

// 导出单例
export const dataFetcher = new DataFetcher();
export default dataFetcher;
