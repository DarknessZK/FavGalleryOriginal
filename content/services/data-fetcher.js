// ==========================================
// FavGallery - 数据获取服务
// 职责：统一管理点赞/收藏/关注列表的数据获取逻辑（API 请求、缓存合并、持久化）
// ==========================================

import { CONFIG } from '../../config/constants.js';
import { platformAPI } from '../../api/platform-adapter.js';
import { createLogger } from '../../utils/logger.js';
import { fileSystem } from '../../data/storage/file-system.js';
import * as worksManager from '../../data/storage/works-manager.js';
import { backupManager } from '../../data/backup/backup-manager.js';
import * as relationManager from '../../data/database/relation-manager.js';

const logger = createLogger('DataFetcher');

export class DataFetcher {
    constructor() {
        this.folderSelected = false;
        this.fileSystem = fileSystem; // ✅ 初始化fileSystem
        
        // ✅ 列表配置映射（配置驱动）
        this.listConfigs = {
            liked: {
                // API层
                apiFetch: (params) => platformAPI.getLikedWorks(
                    params.maxCount,
                    params.onProgress,
                    params.cachedIds,
                    params.metadata
                ),
                
                // 缓存层
                cacheLoad: (fs) => worksManager.loadLikedWorks(fs),
                cacheSave: (fs, data) => worksManager.saveLikedWorks(fs, {
                    works: data.works,
                    metadata: data.metadata
                }),
                
                // 消息层
                messages: {
                    loaded: 'LIKED_WORKS_LOADED',
                    progress: 'LIKED_WORKS_PROGRESS',
                    error: 'LIKED_WORKS_ERROR',
                    clear: 'CLEAR_LIKED_LIST',
                    start: 'LOAD_DATA_START'
                },
                
                // 关系层
                relations: {
                    groupType: 'liked_group',
                    groupId: 'liked'
                },
                
                // 默认值
                defaults: {
                    maxCount: CONFIG.FETCH_CONFIG.LIST_DEFAULTS.LIKED,
                    folderRequired: true
                }
            },
            
            bookmarked: {
                // API层
                apiFetch: (params) => platformAPI.getCollectWorksIncremental(
                    params.collectId,
                    params.maxCount,
                    params.onProgress,
                    params.cachedIds,
                    params.metadata
                ),
                
                // 缓存层
                cacheLoad: (fs, extraParams) => worksManager.loadBookmarkedWorks(fs, extraParams.collectId),
                cacheSave: (fs, data) => worksManager.saveBookmarkedWorks(fs, {
                    works: data.works,
                    collectId: data.collectId,
                    metadata: data.metadata
                }),
                
                // 消息层
                messages: {
                    loaded: 'COLLECT_WORKS_LOADED',
                    progress: 'COLLECT_WORKS_PROGRESS',
                    error: 'COLLECT_WORKS_ERROR',
                    clear: 'CLEAR_BOOKMARKED_LIST',
                    start: 'LOAD_DATA_START'
                },
                
                // 关系层
                relations: {
                    groupType: 'collect',
                    groupId: null  // 动态设置
                },
                
                // 默认值
                defaults: {
                    maxCount: CONFIG.FETCH_CONFIG.LIST_DEFAULTS.BOOKMARKED,
                    folderRequired: true
                }
            }
        };
    }

    /**
     * 设置文件夹选择状态
     */
    setFolderSelected(status) {
        this.folderSelected = status;
    }
    
    /**
     * ✅ 通用列表加载器（核心方法）
     * @param {string} listType - 列表类型
     * @param {HTMLIFrameElement} iframe - 通信目标
     * @param {Object} extraParams - 额外参数
     */
    async _loadList(listType, iframe, extraParams = {}) {
        const mergedData = await this._loadListInternal(listType, iframe, extraParams);
        
        if (mergedData) {
            const config = this.listConfigs[listType];
            this._sendMessage(iframe, config.messages.loaded, {
                works: mergedData,
                total: mergedData.length
            });
        }
        
        return mergedData;
    }
    
    /**
     * ✅ 内部加载逻辑（通用）
     */
    async _loadListInternal(listType, iframe, extraParams = {}) {
        const config = this.listConfigs[listType];
        if (!config) {
            throw new Error(`未知的列表类型: ${listType}`);
        }
        
        // 1. 前置检查
        if (config.defaults.folderRequired && !this.folderSelected) {
            logger.error('❌ 请先选择文件夹');
            return null;
        }
        
        // 2. 读取缓存
        const cacheResult = await config.cacheLoad(this.fileSystem, extraParams);
        const cachedWorks = cacheResult.works || [];
        const metadata = cacheResult.metadata || {};
        
        logger.info(`📊 缓存中有 ${cachedWorks.length} 个作品`);
        
        // 3. 检查是否需要API请求
        if (cachedWorks.length >= config.defaults.maxCount) {
            logger.info(`✅ 缓存已有 ${cachedWorks.length} 个作品，跳过 API 请求`);
            return cachedWorks;
        }
        
        // 4. API增量获取
        const cachedIds = cachedWorks.map(w => w.workId);
        const onProgress = (current, total) => {
            logger.info(`📈 进度: ${current}/${total}`);
            
            // ✅ 发送进度消息到Sidebar（仅在iframe存在时）
            if (iframe) {
                this._sendMessage(iframe, config.messages.progress, {
                    currentCount: current,
                    totalCount: total
                });
            }
        };
        
        const apiResult = await config.apiFetch({
            maxCount: config.defaults.maxCount,
            cachedIds,
            onProgress,
            metadata,
            ...extraParams
        });
        
        const apiWorks = apiResult.works || [];
        logger.info(`✅ API 返回 ${apiWorks.length} 个作品`);
        
        // 5. 合并数据
        const mergedData = this._mergeWorks(cachedWorks, apiWorks);
        logger.info(`✅ 合并后共 ${mergedData.length} 个作品`);
        
        // 6. 保存数据
        await this._saveList(listType, {
            apiWorks,
            mergedData,
            metadata,
            apiResult,
            ...extraParams
        });
        
        return mergedData;
    }

    /**
     * ✅ 通用列表保存器
     * @param {string} listType - 列表类型
     * @param {Object} data - 数据对象
     */
    async _saveList(listType, data) {
        const config = this.listConfigs[listType];
        
        // 没有新数据，不保存
        if (!data.apiWorks || data.apiWorks.length === 0) {
            logger.info('ℹ️ 没有新数据，跳过保存');
            return;
        }
        
        try {
            // 1. 保存到IndexedDB + 异步备份
            await config.cacheSave(this.fileSystem, {
                works: data.mergedData,
                metadata: this._updateMetadata(data.metadata, data.apiResult),
                ...data
            });
            
            logger.info(`✅ 已保存最新列表: ${data.mergedData.length} 个作品`);
            
            // 2. 建立关系
            await this.buildWorkAuthorRelations(
                data.mergedData,
                listType,
                data.collectId
            );
            
            // 3. 触发备份（异步，不阻塞主流程）
            const batchCount = Math.ceil(data.apiWorks.length / 20);
            const BACKUP_BATCH_INTERVAL = CONFIG.BACKUP_CONFIG.listBackup?.batchInterval || 5;
            
            if (batchCount >= BACKUP_BATCH_INTERVAL) {
                logger.info(`🔄 已加载 ${batchCount} 批，触发备份...`);
                // ✅ 异步触发备份，不等待完成
                this._triggerBackup(listType).catch(err => {
                    logger.warn('⚠️ 备份失败:', err.message);
                });
            }
            
        } catch (error) {
            logger.warn('⚠️ 保存列表失败', error);
            logger.warn('   错误类型:', typeof error);
            logger.warn('   错误消息:', error?.message || '无消息');
            logger.warn('   错误堆栈:', error?.stack || '无堆栈');
        }
    }
    
    /**
     * ✅ 发送消息
     */
    _sendMessage(iframe, type, data = {}) {
        iframe.contentWindow.postMessage({
            source: 'content',
            type,
            ...data
        }, '*');
    }
    
    /**
     * ✅ 发送错误消息
     */
    _sendError(iframe, errorType, message) {
        this._sendMessage(iframe, errorType, { error: message });
    }
    
    /**
     * ✅ 合并作品（API优先）
     */
    _mergeWorks(cached, api) {
        const workMap = new Map();
        cached.forEach(work => workMap.set(work.workId, work));
        api.forEach(work => workMap.set(work.workId, work));
        return Array.from(workMap.values());
    }
    
    /**
     * ✅ 更新元数据
     */
    _updateMetadata(metadata, apiResult) {
        return {
            ...metadata,
            lastMaxCursor: apiResult.cursor,
            isFullyLoaded: !apiResult.hasMore
        };
    }
    
    /**
     * ✅ 触发备份
     */
    async _triggerBackup(listType) {
        const backupTables = [
            'works',
            'authors',
            'collects',
            'author_groups',
            'relations'
        ];
        
        // 根据列表类型添加特定的表
        if (listType === 'liked') {
            backupTables.push('liked_group');
        }
        
        await backupManager.performSelectiveBackup(backupTables);
    }
    /**
     * ✅ 从缓存加载列表（通用）
     * @param {string} listType - 列表类型
     * @param {HTMLIFrameElement} iframe - 通信目标
     */
    async _loadFromStorage(listType, iframe) {
        const config = this.listConfigs[listType];
        
        try {
            logger.info(`开始从存储加载${listType}列表...`);
            
            const result = await config.cacheLoad(this.fileSystem);
            const works = result.works || [];
            
            if (works.length > 0) {
                logger.info(`✅ 从存储加载 ${works.length} 个作品`);
            } else {
                logger.info('📭 存储中没有数据');
            }
            
            this._sendMessage(iframe, config.messages.loaded, {
                works: works,
                total: works.length,
                fromCache: true
            });
            
        } catch (error) {
            logger.error('从存储加载列表失败', error);
            this._sendError(iframe, config.messages.error, error.message);
        }
    }
    
    /**
     * 从 IndexedDB 加载点赞作品列表（不触发网络请求）
     */
    async loadLikedWorksFromStorage(iframe) {
        await this._loadFromStorage('liked', iframe);
    }

    /**
     * 加载点赞作品列表（从 API 获取并合并缓存）
     */
    async loadLikedWorks(iframe, maxCount = CONFIG.FETCH_CONFIG.LIST_DEFAULTS.LIKED) {
        await this._loadList('liked', iframe, { maxCount });
    }

    /**
     * 建立作品与作者的关系
     * @param {Array} works - 作品列表（包括视频、图集等）
     * @param {string} listType - 列表类型（'liked' | 'bookmarked'）
     * @param {string} collectId - 收藏夹ID（仅当 listType 为 'bookmarked' 时需要）
     */
    async buildWorkAuthorRelations(works, listType = 'liked', collectId = null) {
        try {
            const relations = [];
            const baseTime = Date.now();

            for (let i = 0; i < works.length; i++) {
                const work = works[i];
                // ✅ 使用递减的时间戳模拟操作时间（列表中越靠前的作品，操作时间越新）
                const operationTime = baseTime - (i * 1); // 每个作品间隔1毫秒
                // 1. 建立 作品 → 作者 的关系（始终建立）
                if (work.author && work.author.uid) {
                    relations.push({
                        sourceType: 'work',
                        sourceId: work.workId,
                        targetType: 'author',
                        targetId: work.author.uid,
                        createdAt: operationTime
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
                        createdAt: operationTime
                    });
                } else if (listType === 'bookmarked' && collectId) {
                    // 收藏列表：建立 作品 → collect 的关系
                    relations.push({
                        sourceType: 'work',
                        sourceId: work.workId,
                        targetType: 'collect',
                        targetId: collectId,
                        createdAt: operationTime
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
