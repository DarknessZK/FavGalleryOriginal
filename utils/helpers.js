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
 * @returns {Promise<Object>} { items: 原始拉取窗口（含缓存命中项，保持 API 新→旧顺序）, hasMore: 列表是否未拉取完整,
 *   sawEnd: 本轮是否确实看到清单末尾（软删除的唯一合法依据）, partial: 本轮是否存在重试耗尽的失败 }
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

    // ✅ 清单完整性证据（供上层判定是否有权做软删除）
    //    sawEnd：确实看到清单末尾（API 明确回复没有更多，且未被本地上限截断）
    //    partial：存在重试耗尽的失败，本轮只拿到部分结果
    let sawEnd = false;
    let partial = false;

    // ✅ 停止条件按“原始拉取总数”判断：maxCount 限制的是 API 拉取量，而非新增数量
    while (hasMore && rawFetched < maxCount) {
        try {
            logger.debug(`🔄 开始第 ${Math.ceil(rawFetched / 20) + 1} 批获取，cursor=${cursor}`);
            
            const result = await fetchFn(cursor);

            if (!result || !result.data || result.data.length === 0) {
                logger.warn('⚠️ 获取数据为空');
                // ✅ 空批次不能单独作为“清单到底”的证据：接口异常同样表现为空。
                //    必须同时满足“API 明确回复没有更多”且“此前已拉到过数据”，才视为正常到底。
                const explicitlyEnded = !!result && result.hasMore === false;
                sawEnd = explicitlyEnded && rawFetched > 0;
                if (!explicitlyEnded) {
                    partial = true;
                    logger.warn('⚠️ 空批次且未明确回复到底：视为本轮不可信，不做软删除判定');
                }
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
                // ✅ 提前退出只看到清单头部，并未确认末尾：无权对窗口外条目下“已取消”结论
                sawEnd = false;
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

            // ✅ 只有 API 明确回复没有更多才算到底；达到加载上限被截断时窗口外条目不可判定
            if (!hasMore || rawFetched >= maxCount) {
                // ✅ 严格等于 false 才算到底：hasMore 为 undefined（接口字段缺失/失败被吞）时不得当成“已看完”
                sawEnd = hasMore === false;
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
            // ✅ 取 message 输出：logger 会对第二参做 JSON.stringify，
            //    Error 对象序列化后是空对象，日志里只剩 “获取失败 (尝试 1/3): {}”，排障看不到原因
            logger.error(`❌ 获取失败 (尝试 ${currentRetry}/${maxRetries}): ${error?.message || String(error)}`);

            if (currentRetry >= maxRetries) {
                logger.error('❌ 达到最大重试次数，停止获取');
                // ✅ 失败不等于到底：本轮清单不完整，无权下软删除结论
                partial = true;
                sawEnd = false;
                break;
            }

            // 指数退避重试
            const retryDelay = delayMs * Math.pow(2, currentRetry);
            logger.info(`⏳ ${retryDelay}ms 后重试...`);
            await delay(retryDelay);
        }
    }

    logger.info(`✅ 智能增量获取完成: 新增 ${newCount} 条，总计 ${allData.length} 条数据（原始拉取 ${rawFetched} 条，hasMore=${hasMore}，sawEnd=${sawEnd}，partial=${partial}）`);

    // ✅ 返回窗口被本地上限截断时，等于没看到完整清单，强制取消到底资格
    if (allData.length > maxCount) {
        sawEnd = false;
    }

    return { items: allData.slice(0, maxCount), hasMore, sawEnd, partial };
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


