// ==========================================
// FavGallery - 通用辅助函数
// 职责：提供平台无关的通用工具函数
// ==========================================

import { createLogger } from './logger.js';
import { CONFIG } from '../config/constants.js';
import { delay } from './platform-helpers.js';

const logger = createLogger('Helpers');

/**
 * 智能增量获取（通用分页获取函数）
 * 支持增量去重，避免重复获取已存在的数据
 *
 * 工作原理：
 * 1. API 返回的数据是从新到旧排序的
 * 2. cursor 是时间戳游标，用于获取更旧的数据（不是页码）
 * 3. 每次请求传入上一批返回的 cursor，API 返回比这个时间更早的作品
 * 4. 通过检查 ID 是否在缓存中，判断是否有新作品
 * 5. 如果遇到已存在的 ID，说明后面都是更旧的、已缓存的作品，可以停止
 *
 * @param {Function} fetchFn - 获取单页数据的函数 (cursor) => Promise<{data, hasMore, cursor}>
 * @param {Set|null} cachedIds - 缓存的 ID 集合（用于去重），null 表示不去重
 * @param {string} idField - ID 字段名（如 'workId'、'uid'）
 * @param {number} maxCount - 最大获取数量（默认从配置读取）
 * @param {Function|null} onProgress - 进度回调 (current, total) => void
 * @param {Object} extraOptions - 额外配置选项
 * @param {number} extraOptions.delayMs - 请求间隔延迟（毫秒）
 * @param {number} extraOptions.maxRetries - 最大重试次数
 * @param {boolean} extraOptions.isFullyLoaded - 是否曾经完整加载过（用于控制早期退出）
 * @returns {Promise<Object>} { items: 原始拉取窗口（含缓存命中项，保持 API 新→旧顺序）, hasMore: 列表是否未拉取完整 }
 */
export async function smartIncrementalFetch(
    fetchFn,
    cachedIds = null,
    idField = 'id',
    maxCount = CONFIG.FETCH_CONFIG.DEFAULT_MAX_COUNT,
    onProgress = null,
    extraOptions = {}
) {
    const {
        delayMs = 1000,
        maxRetries = 3,
        isFullyLoaded = false  // ✅ 新增：是否曾经完整加载过
    } = extraOptions;

    let allData = [];
    let hasMore = true;
    let cursor = 0;
    let currentRetry = 0;
    let newCount = 0; // 新增数据计数
    let rawFetched = 0; // ✅ 原始拉取总数（含被过滤的缓存重复项）

    // ✅ 停止条件按“原始拉取总数”判断：maxCount 限制的是 API 拉取量，而非新增数量
    while (hasMore && rawFetched < maxCount) {
        try {
            logger.debug(`🔄 开始第 ${Math.ceil(rawFetched / 20) + 1} 批获取，cursor=${cursor}`);
            
            const result = await fetchFn(cursor);

            if (!result || !result.data || result.data.length === 0) {
                logger.warn('⚠️ 获取数据为空');
                hasMore = false;
                break;
            }

            // ✅ 累计原始拉取数（去重前的真实 API 返回量）
            rawFetched += result.data.length;

            // ✅ 过滤仅用于统计新增数量和检测早期退出，不用于返回值：
            // 返回完整的新→旧窗口（含缓存命中项），合并时才能恢复正确顺序
            let newData = result.data;
            if (cachedIds && cachedIds.size > 0) {
                newData = result.data.filter(item => !cachedIds.has(item[idField]));
            }

            // ✅ 早期退出：只要发现有一个已缓存的作品，就立即退出
            // 因为 API 从新到旧返回，发现已缓存说明后面的数据也必然已缓存
            const hasCachedItem = cachedIds && cachedIds.size > 0 && 
                                  result.data.length > 0 && 
                                  newData.length < result.data.length;
            
            if (isFullyLoaded && hasCachedItem) {
                logger.info(`✅ 检测到已缓存作品（本批 ${result.data.length} 个中有 ${result.data.length - newData.length} 个已缓存），提前停止获取`);
                
                // 追加本批原始数据（含缓存命中项），保持窗口顺序完整
                newCount += newData.length;
                allData = allData.concat(result.data);
                // ✅ 提前退出时缓存完整性保持（新数据只会出现在头部），返回 hasMore: false 维持 isFullyLoaded
                hasMore = false;
                break;
            }

            // 统计新增数量
            newCount += newData.length;

            // ✅ 追加本批原始数据（含缓存命中项）：API 新→旧顺序是合并排序的依据，
            // 若只保留新增项，缓存命中项的“坑位”会丢失，导致合并后顺序错乱
            allData = allData.concat(result.data);
            hasMore = result.hasMore;
            cursor = result.cursor || 0;

            // 重置重试计数
            currentRetry = 0;

            // ✅ P1: 调用进度回调（按原始拉取数对比目标量）
            if (onProgress) {
                onProgress(Math.min(rawFetched, maxCount), maxCount);
            }

            // 如果已满足需求或没有更多数据，退出（达到 maxCount 上限时 hasMore 保持 true，表示还有未拉取数据）
            if (!hasMore || rawFetched >= maxCount) {
                break;
            }

            // ✅ 随机延迟（防封号）- 从配置读取
            const minDelay = CONFIG.FETCH_CONFIG.REQUEST_DELAY.min;
            const maxDelay = CONFIG.FETCH_CONFIG.REQUEST_DELAY.max;
            const randomDelay = Math.floor(Math.random() * (maxDelay - minDelay)) + minDelay;
            logger.debug(`⏱️ 等待 ${randomDelay}ms 后继续...`);
            await delay(randomDelay);

        } catch (error) {
            currentRetry++;
            logger.error(`❌ 获取失败 (尝试 ${currentRetry}/${maxRetries}):`, error);

            if (currentRetry >= maxRetries) {
                logger.error('❌ 达到最大重试次数，停止获取');
                break;
            }

            // 指数退避重试
            const retryDelay = delayMs * Math.pow(2, currentRetry);
            logger.info(`⏳ ${retryDelay}ms 后重试...`);
            await delay(retryDelay);
        }
    }

    logger.info(`✅ 智能增量获取完成: 新增 ${newCount} 条，总计 ${allData.length} 条数据（原始拉取 ${rawFetched} 条，hasMore=${hasMore}）`);
    return { items: allData.slice(0, maxCount), hasMore };
}

/**
 * 合并缓存数据和 API 数据（通用方法）
 * 🎯 关键：以 API 返回的顺序为准，保持最新排序
 * @param {Array} cachedData - 缓存数据
 * @param {Array} apiData - API 返回的最新数据
 * @param {string} idField - 唯一标识字段名
 * @param {Object} defaultFields - 新数据的默认字段
 * @param {Array} preserveFields - 需要保留的字段（从缓存中保留）
 * @returns {Object} - { mergedData, newCount, updatedCount }
 */
export function mergeDataWithCache(cachedData, apiData, idField, defaultFields = {}, preserveFields = []) {
    const cachedMap = new Map(cachedData.map(item => [item[idField], item]));
    let newCount = 0;
    let updatedCount = 0;

    logger.info(`[MergeData] 🔍 开始合并数据: 缓存 ${cachedData.length} 条, API ${apiData.length} 条, 对比字段: ${idField}`);

    // 调试：打印前3个缓存ID和前3个API ID
    if (cachedData.length > 0) {
        logger.info(`[MergeData]    缓存前3个ID: ${cachedData.slice(0, 3).map(item => item[idField]).join(', ')}`);
    }
    if (apiData.length > 0) {
        logger.info(`[MergeData]    API前3个ID: ${apiData.slice(0, 3).map(item => item[idField]).join(', ')}`);
    }

    // 🎯 关键修复：先处理 API 数据，保留需要 preserved 的字段
    const apiProcessed = apiData.map(newItem => {
        if (cachedMap.has(newItem[idField])) {
            // 已存在，保留指定字段
            const existing = cachedMap.get(newItem[idField]);
            const preserved = {};

            preserveFields.forEach(field => {
                if (existing[field] !== undefined) {
                    preserved[field] = existing[field];
                }
            });

            updatedCount++;
            
            // 返回合并后的数据（保持 API 的顺序）
            return {
                ...existing,
                ...newItem,
                ...preserved,  // 覆盖回保留字段
                lastCheckedTime: Date.now()
            };
        } else {
            // 新增
            newCount++;
            return {
                ...newItem,
                ...defaultFields,
                lastCheckedTime: Date.now()
            };
        }
    });

    // 🎯 关键修复：找出缓存中有但 API 中没有的数据（已被取消关注/点赞/收藏的作品）
    const apiIds = new Set(apiData.map(item => item[idField]));
    const onlyInCache = cachedData.filter(item => !apiIds.has(item[idField]));
    
    logger.info(`[MergeData] ✅ 合并结果: 新增 ${newCount}, 更新 ${updatedCount}, 仅在缓存中 ${onlyInCache.length}, API顺序 ${apiProcessed.length}`);

    // 🎯 关键修复：返回时以 API 顺序为主，后面追加仅在缓存中的数据
    return {
        mergedData: [...apiProcessed, ...onlyInCache],  // API 顺序在前，旧数据在后
        newCount,
        updatedCount
    };
}

/**
 * ✅ 合并作品数据并更新元数据（通用工具方法）
 * @param {Array} cachedWorks - 缓存的作品列表
 * @param {Array} apiWorks - API返回的作品列表
 * @param {Object} metadata - 原元数据
 * @param {string} metadataField - 元数据字段名
 * @param {Object} apiResult - API 返回结果
 * @returns {Object} 合并后的数据和更新后的元数据
 */
export function mergeWorkData(cachedWorks, apiWorks, metadata, metadataField, apiResult) {  // ✅ 改为 mergeWorkData
    const { mergedData, newCount } = mergeDataWithCache(
        cachedWorks,  // ✅ 参数名已正确
        apiWorks,     // ✅ 参数名已正确
        'workId',
        { downloadStatus: 'pending', downloaded: false, downloadTime: 0, filePath: '' },
        ['downloadStatus', 'downloaded', 'downloadTime', 'filePath']
    );

    // ✅ 判断是否完整加载（双重判断机制）：
    // 情况1：API 返回的作品数 < 请求的 maxCount（已经到底了）
    // 情况2：所有返回的作品都已缓存（说明没有新作品了，适用于开发环境小批量测试）
    const apiRequestedCount = apiResult.requestedCount || CONFIG.FETCH_CONFIG.LIST_CONFIGS.liked.maxCount;
    const isFullyLoaded = 
        (apiWorks.length > 0 && apiWorks.length < apiRequestedCount) ||
        (apiWorks.length > 0 && newCount === 0);

    const updatedMetadata = {
        ...metadata,
        [metadataField]: apiResult[metadataField],
        lastUpdate: Date.now(),
        totalCount: mergedData.length,
        // ✅ 新增：完整加载标记（一旦为 true，就永远不会变回 false）
        isFullyLoaded: metadata.isFullyLoaded || isFullyLoaded
    };

    return { mergedData, newCount, updatedMetadata };
}

/**
 * 清理字符串中的非法文件名字符（Windows 兼容）
 * Windows 不允许的字符: < > : " / \ | ? *
 * 
 * @param {string} str - 原始字符串
 * @returns {string} 安全的字符串，非字符串类型原样返回
 */
export function sanitizeForFileSystem(str) {
    if (typeof str !== 'string') return str;
    
    return str
        .replace(/[<>:"/\\|?*]/g, '_')  // 替换非法字符为下划线
        .trim()                           // 去除首尾空格
        .replace(/\.+$/g, '');            // 移除末尾的点（Windows 不允许）
}


