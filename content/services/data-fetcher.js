// ==========================================
// FavGallery - 数据获取服务
// 职责：统一管理点赞/收藏/关注列表的数据获取逻辑（API 请求、缓存合并、持久化）
// ==========================================

import { CONFIG } from '../../config/constants.js';
import { platformAPI } from '../../api/platform-adapter.js';
import { createLogger } from '../../utils/logger.js';
import { fileSystem } from '../../data/storage/file-system.js';
import { backupManager } from '../../data/backup/backup-manager.js';
import * as relationManager from '../../data/database/relation-manager.js';
import { database } from '../../data/database/database.js';
import { ListConfigFactory } from './list-config-factory.js';

const logger = createLogger('DataFetcher');

export class DataFetcher {
    constructor() {
        this.folderSelected = false;
        this.fileSystem = fileSystem; // ✅ 初始化fileSystem
        this.apiRequestCount = 0;  // ✅ API请求计数器
        
        // ✅ 使用工厂创建列表配置（配置驱动 + 平台适配）
        this.listConfigs = ListConfigFactory.createAllConfigs({
            backupManager
        });
    }

    /**
     * 设置文件夹选择状态
     */
    setFolderSelected(status) {
        this.folderSelected = status;
    }
    
    /**
     * ✅ 重建列表配置
     * 用于用户配置文件加载/变更后，让 listConfigs 反映最新的 maxCount 等配置值。
     * （listConfigs 在构造时以展开方式固化了 LIST_CONFIGS 的快照，需显式重建）
     */
    reloadConfigs() {
        this.listConfigs = ListConfigFactory.createAllConfigs({
            backupManager
        });
        logger.info('🔄 列表配置已根据用户配置重建');
    }
    
    /**
     * ✅ 通用列表加载器（核心方法）- 支持作品列表、作者列表和收藏夹列表
     * @param {string} listType - 列表类型
     * @param {HTMLIFrameElement} iframe - 通信目标
     * @param {Object} extraParams - 额外参数
     */
    async _loadList(listType, iframe, extraParams = {}) {
        const mergedData = await this._loadListInternal(listType, iframe, extraParams);
        
        if (mergedData) {
            const config = this.listConfigs[listType];
            
            // ✅ 配置驱动：根据 resultKey 确定消息字段
            const messageData = {
                [config.resultKey]: mergedData,
                total: mergedData.length
            };
            
            this._sendMessage(iframe, config.messages.loaded, messageData);
        }
        
        // ✅ 结束列表加载，处理剩余批次备份
        this._finalizeListLoad(listType);
        
        return mergedData;
    }
    
    /**
     * ✅ 内部加载逻辑（通用）- 支持作品列表、作者列表和收藏夹列表
     */
    async _loadListInternal(listType, iframe, extraParams = {}) {
        const config = this.listConfigs[listType];
        if (!config) {
            throw new Error(`未知的列表类型: ${listType}`);
        }
        
        // 1. 前置检查
        if (config.folderRequired && !this.folderSelected) {
            logger.error('❌ 请先选择文件夹');
            return null;
        }
        
        // ✅ 如果需要创建默认分组，先检查并创建
        if (config.needDefaultGroup) {
            await this._ensureDefaultGroup(listType, config);
        }
        
        // 2. 读取缓存（配置驱动）
        const cacheResult = await config.cacheLoad(this.fileSystem, extraParams);
        const cachedItems = cacheResult[config.resultKey] || [];
        const metadata = cacheResult.metadata || {};
        
        logger.info(`📊 缓存中有 ${cachedItems.length} 个${config.saveKey === 'collects' ? '收藏夹' : config.saveKey === 'authors' ? '作者' : '作品'}`);
        
        // 3. 检查是否需要API请求
        // ✅ 如果 skipIncrementalCheck 为 true，则始终调用 API（用于检测软删除）
        // ✅ forceRefresh（勾选收藏夹链路专用）：收藏夹作品会话缓存的代数由「刷新收藏列表」按钮驱动，
        //    到达本层的调用都是该代数内首次勾选，不能被文件缓存短路拦截（否则刷新后重新勾选却拿旧数据、无加载过程）
        const shouldSkipAPI = !config.skipIncrementalCheck &&
                              !extraParams.forceRefresh &&
                              cachedItems.length >= config.maxCount;
        
        if (shouldSkipAPI) {
            const listTypeName = config.saveKey === 'collects' ? '收藏夹' : config.saveKey === 'authors' ? '作者' : '作品';
            logger.info(`⏭️ [${listTypeName}列表] 跳过 API 请求`);
            logger.info(`   📋 原因: 缓存已有 ${cachedItems.length} 个，达到目标数量 ${config.maxCount}`);
            logger.info(`   ⚙️ 配置: skipIncrementalCheck=${config.skipIncrementalCheck}, folderRequired=${config.folderRequired}`);
            logger.info(`   💡 提示: 如需强制刷新，请清除缓存或重新选择文件夹`);
            
            // ✅ 发送加载完成消息到 Sidebar
            if (iframe && config.messages.loaded) {
                this._sendMessage(iframe, config.messages.loaded, {
                    [config.resultKey]: cachedItems,
                    total: cachedItems.length
                });
                logger.info(`📨 已发送 ${config.messages.loaded} 消息`);
            }
            
            return cachedItems;
        }
        
        // 4. API增量获取（配置驱动）
        // ✅ 收藏夹不需要传 cachedIds（API 不支持）
        const cachedIds = config.saveKey === 'collects' ? null : cachedItems.map(item => item[config.idField]);
        
        const onProgress = (current, total) => {
            logger.info(`📈 进度: ${current}/${total}`);
            
            // ✅ 发送进度消息到Sidebar（仅在iframe存在且配置了progress时）
            // collectId 一并携带：bookmarked 的进度消费端（侧边栏）可据此反查收藏夹名称
            if (iframe && config.messages.progress) {
                this._sendMessage(iframe, config.messages.progress, {
                    currentCount: current,
                    totalCount: total,
                    collectId: extraParams.collectId
                });
            }
        };
        
        const apiResult = await config.apiFetch({
            maxCount: config.maxCount,
            cachedIds,  // ✅ 收藏夹传 null
            onProgress,
            metadata,
            ...extraParams
        });
        
        // ✅ 配置驱动：根据 resultKey 获取 API 返回数据
        const apiItems = apiResult[config.resultKey] || [];
        logger.info(`✅ API 返回 ${apiItems.length} 个${config.saveKey === 'collects' ? '收藏夹' : config.saveKey === 'authors' ? '作者' : '作品'}`);
        
        // 5. 合并数据（支持软删除，以 API 顺序为准）
        // ✅ smartIncrementalFetch 返回完整的新→旧窗口（含缓存命中项），
        // 合并后自然保持 API 排序（点赞列表按点赞时间，而非作品发布时间），不能按 createTime 排序
        const mergedData = this._mergeItems(cachedItems, apiItems, config.idField, config);
        
        // ✅ 按 maxCount 截断：批次粒度会超额拉取，超出目标量的旧数据不进列表
        const effectiveMaxCount = extraParams.maxCount || config.maxCount;
        const cappedData = mergedData.slice(0, effectiveMaxCount);
        logger.info(`✅ 合并后共 ${cappedData.length} 个${config.saveKey === 'collects' ? '收藏夹' : config.saveKey === 'authors' ? '作者' : '作品'}（合并 ${mergedData.length} 个，上限 ${effectiveMaxCount}）`);
        
        // 6. 保存数据（配置驱动）
        await this._saveList(listType, {
            apiItems,
            mergedData: cappedData,
            metadata,
            apiResult,
            ...extraParams
        });
        
        return cappedData;
    }
    
    /**
     * ✅ 结束列表加载，处理剩余批次备份
     * @param {string} listType - 列表类型
     */
    _finalizeListLoad(listType) {
        // 如果不足5次，也触发备份
        if (this.apiRequestCount > 0 && this.apiRequestCount % 5 !== 0) {
            logger.info(`🔄 列表加载结束，共 ${this.apiRequestCount} 次API请求，触发末次备份...`);
            this._triggerBackup(listType).catch(err => {
                logger.warn('⚠️ 备份失败:', err.message);
            });
        }
        
        // 重置计数器（为下次列表加载准备）
        this.apiRequestCount = 0;
    }

    /**
     * ✅ 通用列表保存器 - 支持作品列表、作者列表和收藏夹列表
     * @param {string} listType - 列表类型
     * @param {Object} data - 数据对象
     */
    async _saveList(listType, data) {
        const config = this.listConfigs[listType];
        
        // 没有新数据，不保存
        if (!data.apiItems || data.apiItems.length === 0) {
            logger.info('ℹ️ 没有新数据，跳过保存');
            return;
        }
        
        try {
            // 1. 保存到IndexedDB + 异步备份（配置驱动）
            const saveData = {
                [config.saveKey]: data.mergedData,
                metadata: this._updateMetadata(data.metadata, data.apiResult),
                ...(config.saveKey === 'works' ? data : {})  // 作品列表需要额外数据
            };
            await config.cacheSave(this.fileSystem, saveData);
            
            logger.info(`✅ 已保存最新列表: ${data.mergedData.length} 个${config.saveKey === 'collects' ? '收藏夹' : config.saveKey === 'authors' ? '作者' : '作品'}`);
            
            // 2. 建立关系（配置驱动）
            await this._buildRelations(data.mergedData, config.relations, data.collectId);
            
            // 3. 触发备份（异步，不阻塞主流程）
            this.apiRequestCount++;  // ✅ 每次保存时计数+1
            const BACKUP_BATCH_INTERVAL = CONFIG.BACKUP_CONFIG.listBackup?.batchInterval || 5;
            
            // 每5次API请求触发一次备份
            if (this.apiRequestCount % BACKUP_BATCH_INTERVAL === 0) {
                logger.info(`🔄 第 ${this.apiRequestCount} 次API请求，触发备份...`);
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
     * ✅ 合并数据（支持作品、作者和收藏夹，支持软删除）
     * @param {Array} cached - 缓存数据
     * @param {Array} api - API数据
     * @param {string} idField - ID字段名（配置驱动）
     * @param {Object} config - 列表配置（可选，用于按类型定制合并策略）
     * @returns {Array} 合并后的数据
     */
    _mergeItems(cached, api, idField, config = {}) {
        const cachedMap = new Map();
        cached.forEach(item => {
            cachedMap.set(item[idField], item);
        });
        
        const apiIds = new Set(api.map(item => item[idField]));
        const merged = [];
        
        // ✅ 作者列表：部分字段应以 API 最新值为准，避免被旧缓存整体覆盖而冻结
        //    （downloadedCount、以及"已下载作者的 workCount"属下载派生字段，仍保留缓存值）
        const isAuthors = config.saveKey === 'authors';
        
        // ✅ 以 API 返回顺序（新→旧）构建结果，保证新增数据排在最前
        // API 数据提供基础字段，缓存中的扩展字段（如 downloadedCount）优先保留
        api.forEach(item => {
            const cachedItem = cachedMap.get(item[idField]);
            const mergedItem = {
                ...item,
                ...cachedItem,
                isDeleted: false
            };
            
            if (isAuthors && cachedItem) {
                // 个人资料字段以 API 最新值刷新（缓存整体覆盖会使其冻结在旧值）
                mergedItem.nickname = item.nickname;
                mergedItem.avatarUrl = item.avatarUrl;
                mergedItem.followerCount = item.followerCount;
                mergedItem.followingCount = item.followingCount;
                // workCount：仅当该作者已下载过（downloadedCount>0，此时为 relations 精确值）才保留缓存，
                // 否则采用 API 最新 aweme_count（作者新发布作品后总数才能及时更新）
                if (!(cachedItem.downloadedCount > 0)) {
                    mergedItem.workCount = item.workCount;
                }
            }
            
            merged.push(mergedItem);
        });
        
        // ✅ 仅在缓存中的数据（本次 API 窗口未覆盖）追加到末尾，并标记软删除
        cached.forEach(item => {
            if (!apiIds.has(item[idField])) {
                if (!item.isDeleted) {
                    logger.debug(`🗑️ 标记为已删除: ${item[idField]}`);
                }
                merged.push({ ...item, isDeleted: true });
            }
        });
        
        return merged;
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
            'collect_groups',  // ✅ 新增：收藏夹分组
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
    async loadLikedWorks(iframe, maxCount = CONFIG.FETCH_CONFIG.LIST_CONFIGS.liked.maxCount) {
        await this._loadList('liked', iframe, { maxCount });
    }

    /**
     * ✅ 确保默认分组存在（配置驱动）
     * @param {string} listType - 列表类型
     * @param {Object} config - 列表配置
     */
    async _ensureDefaultGroup(listType, config) {
        try {
            const platform = CONFIG.ACTIVE_PLATFORM;
            const defaultGroupId = `${platform}_${listType}`;
            
            // ✅ 配置驱动：从配置获取表名和计数字段
            const tableName = config.groupTableName;
            
            // 检查是否已存在
            const existingGroup = await database.get(tableName, defaultGroupId);
            if (existingGroup) {
                logger.debug(`✅ 默认分组已存在: ${defaultGroupId}`);
                return;
            }
            
            // ✅ 根据配置创建分组元数据
            const defaultGroup = {
                groupId: defaultGroupId,
                groupName: config.defaultGroupConfig.groupName,
                description: config.defaultGroupConfig.description,
                sortOrder: config.defaultGroupConfig.sortOrder,
                isDeleted: false
            };
            
            // ✅ 添加计数缓存字段（配置驱动）
            if (config.countField) {
                defaultGroup[config.countField] = 0;
            }
            
            await database.save(tableName, defaultGroup);
            logger.info(`✅ 创建默认分组: ${defaultGroupId}`);
        } catch (error) {
            logger.warn('⚠️ 创建默认分组失败:', error.message);
        }
    }
    
    /**
     * ✅ 通用关系构建方法（配置驱动）
     * @param {Array} data - 数据列表
     * @param {Object} relationsConfig - 关系配置
     * @param {string} collectId - 收藏夹ID（可选，用于动态 targetId）
     */
    async _buildRelations(data, relationsConfig, collectId = null) {
        if (!relationsConfig || !data || data.length === 0) {
            return;
        }
        
        try {
            const relations = [];
            const baseTime = Date.now();
            
            for (let i = 0; i < data.length; i++) {
                const item = data[i];
                const operationTime = baseTime - (i * 1);
                
                // 获取 sourceId
                const sourceId = item[relationsConfig.sourceField];
                if (!sourceId) continue;
                
                // 获取 targetId（优先使用配置的 targetId，其次使用动态字段）
                let targetId = relationsConfig.targetId;
                if (!targetId && relationsConfig.targetField) {
                    targetId = item[relationsConfig.targetField] || collectId;
                }
                
                // ✅ 只有 author_group 或 collect_group 且 targetId 为 null 时，才使用默认分组
                if (!targetId && (relationsConfig.targetType === 'author_group' || relationsConfig.targetType === 'collect_group')) {
                    const platform = CONFIG.ACTIVE_PLATFORM;
                    const listType = relationsConfig.targetType === 'author_group' ? 'following' : 'collects';
                    targetId = `${platform}_${listType}`;
                }
                
                if (!targetId) continue;
                
                // 创建关系记录
                relations.push({
                    sourceType: relationsConfig.sourceType,
                    sourceId: sourceId,
                    targetType: relationsConfig.targetType,
                    targetId: targetId,
                    createdAt: operationTime
                });
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
