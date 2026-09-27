// ==========================================
// FavGallery - 收藏夹作品加载服务
// 职责：LOAD_COLLECT_WORKS 的串行入口、刷新代数驱动会话缓存、逐收藏夹加载与去重合并
// 说明：自 content/main.js 行为等价拆出（2026-09），日志模块名沿用 ContentScript 保持输出一致
// ==========================================

import { createLogger } from '../../utils/logger.js';
import { fileSystem } from '../../data/storage/file-system.js';
import { dataFetcher } from './data-fetcher.js';
import { CONFIG } from '../../config/constants.js';

const logger = createLogger('ContentScript');

class CollectWorksLoader {
    constructor() {
        // ✅ 会话级收藏夹作品缓存（collectId → works），代数由「刷新收藏列表」按钮驱动：
        // - 已加载过的收藏夹再次勾选 → 静默复用（不走 API、不重放进度，取消勾选不影响）
        // - 点击刷新按钮（invalidateCache）或重选文件夹时整个作废，之后首次勾选重新加载
        this.cache = null;

        // ✅ 串行化状态：加载中收到新勾选请求只记录最新一条，当前循环完成后重跑
        this._loading = false;
        this._pending = null;
    }

    /**
     * ✅ 作废会话缓存（开启新代数）
     * 调用点：「刷新收藏列表」按钮（LOAD_COLLECTS_LIST）、重选文件夹（SELECT_FOLDER）
     */
    invalidateCache() {
        this.cache = null;
    }

    /**
     * ✅ 处理加载收藏夹作品（串行入口）
     * 加载中收到新的勾选请求时不并发执行，只记录最新一次请求，
     * 待当前循环完成后按最新收藏夹集合重跑。
     * 并发会导致：同一收藏夹缓存被两个循环同时读写、
     * 两组 COLLECT_WORKS_PROGRESS/LOADED 消息交错覆盖状态栏与列表
     */
    async load(data, iframe) {
        if (this._loading) {
            this._pending = data;
            logger.info('⏳ 收藏夹作品正在加载中，记录最新勾选请求，完成后将按最新集合重跑');
            return;
        }
        this._loading = true;
        try {
            await this._doLoad(data, iframe);
            // 加载期间选择有变化 → 用最后一次的最新集合重跑（多轮快速勾选只保留最后一条）
            while (this._pending) {
                const next = this._pending;
                this._pending = null;
                logger.info('🔁 按加载期间更新后的收藏夹选择重新处理');
                await this._doLoad(next, iframe);
            }
        } finally {
            this._loading = false;
        }
    }

    /**
     * ✅ 收藏夹作品加载实际执行体
     */
    async _doLoad(data, iframe) {
        try {
            const { collectIds } = data;
            const allWorksMap = new Map();
            if (!this.cache) this.cache = new Map();
            
            // ✅ 先获取所有收藏夹的元数据（包含名称）
            const collectsMetadata = {};
            try {
                const { loadAllCollects } = await import('../../data/storage/collects-manager.js');
                const result = await loadAllCollects(fileSystem);
                const allCollects = result.collects || [];
                
                // 构建 collectId -> collectName 映射
                allCollects.forEach(collect => {
                    collectsMetadata[collect.collectId] = collect.collectName;
                });
                logger.info(`📚 已加载 ${Object.keys(collectsMetadata).length} 个收藏夹元数据`);
            } catch (error) {
                logger.warn('⚠️ 加载收藏夹元数据失败:', error.message);
            }
            
            for (let i = 0; i < collectIds.length; i++) {
                const collectId = collectIds[i];
                const collectName = collectsMetadata[collectId] || `收藏夹${collectId.substring(0, 8)}`;

                // ✅ 会话内已加载过（本次刷新代数内）：跳过重复加载，也不发进度消息
                const cachedWorks = this.cache.get(collectId);
                if (cachedWorks) {
                    cachedWorks.forEach(work => allWorksMap.set(work.workId, work));
                    logger.info(`⚡ 本次刷新周期内已加载过，直接复用: ${collectName} (${cachedWorks.length} 个作品)`);
                    continue;
                }
                
                // ✅ 发送开始加载消息（带收藏夹名称）
                iframe.contentWindow.postMessage({
                    source: 'content',
                    type: 'COLLECT_WORKS_PROGRESS',
                    collectId,
                    collectName,
                    current: 0,
                    total: 0,
                    index: i + 1,
                    totalCollects: collectIds.length
                }, '*');
                
                logger.info(`📂 正在加载收藏夹 ${i + 1}/${collectIds.length}: ${collectName} (${collectId})`);
                
                try {
                    // forceRefresh：会话缓存未命中 = 本次刷新代数内首次勾选，
                    // 强制走 API 增量拉取，绕过 data-fetcher 的文件缓存短路（缓存满额就直接返旧数据）
                    const works = await dataFetcher._loadList('bookmarked', iframe, { 
                        collectId,
                        maxCount: CONFIG.FETCH_CONFIG.LIST_CONFIGS.bookmarked.maxCount,
                        forceRefresh: true
                    });
                    
                    if (works && works.length > 0) {
                        works.forEach(work => {
                            allWorksMap.set(work.workId, work);
                        });
                        // ✅ 写入会话缓存：同一刷新代数内持续有效，刷新收藏列表/重选文件夹时作废
                        this.cache.set(collectId, works);
                        
                        // ✅ 发送进度更新消息
                        iframe.contentWindow.postMessage({
                            source: 'content',
                            type: 'COLLECT_WORKS_PROGRESS',
                            collectId,
                            collectName,
                            current: works.length,
                            total: works.length,
                            index: i + 1,
                            totalCollects: collectIds.length
                        }, '*');
                        
                        logger.info(`✅ 收藏夹 ${collectName} 加载完成: ${works.length} 个作品，累计 ${allWorksMap.size} 个（去重后）`);
                    }
                } catch (error) {
                    logger.error(`❌ 获取收藏夹 ${collectName} 的作品失败:`, error.message);
                }
            }
            
            const mergedWorks = Array.from(allWorksMap.values());
            logger.info(`✅ 总共获取 ${mergedWorks.length} 个作品（去重后）`);
            
            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'COLLECT_WORKS_LOADED',
                works: mergedWorks,
                total: mergedWorks.length,
                collectIds: collectIds
            }, '*');
        } catch (error) {
            logger.error('❌ 加载收藏夹作品失败:', error);
            
            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'COLLECT_WORKS_ERROR',
                error: error.message
            }, '*');
        }
    }
}

// ✅ 模块级单例：main.js 与消息处理共用同一实例，保证串行标志与缓存状态一致
export const collectWorksLoader = new CollectWorksLoader();
