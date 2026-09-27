// ==========================================
// FavGallery - 作者作品钻取加载服务
// 职责：LOAD_AUTHOR_WORKS 的串行入口、刷新代数驱动的会话缓存、委托 data-fetcher 配置化管线
// 说明：与 collect-works-loader 同构（收藏夹维度换成作者维度）：
//   - 加载经 dataFetcher._loadList('authorWorks') 统一管线：API 增量合并 + 落 works 表
//     + 建立 work→author 关系 + 批量备份触发，全部由列表配置驱动
//   - 回流消息携带 uid（侧边栏据此做过期响应丢弃），故 iframe 传 null 使 data-fetcher
//     的裸消息静默，进度/结果由本服务自行发送
// ==========================================

import { createLogger } from '../../utils/logger.js';
import { dataFetcher } from './data-fetcher.js';

const logger = createLogger('AuthorWorksLoader');

class AuthorWorksLoader {
    constructor() {
        // ✅ 会话级作者作品缓存（uid → works），代数由「刷新关注列表」按钮驱动：
        // - 已加载过的作者再次钻取 → 静默复用（不走 API、秒开）
        // - 点击刷新关注列表 / 重选文件夹（invalidateCache）整个作废，之后首次钻取重新加载
        this.cache = null;

        // ✅ 串行化状态：加载中收到新钻取请求只记录最新一条，当前循环完成后重跑
        // （并发会导致同一作者的缓存被两个循环同时读写、两组进度消息交错）
        this._loading = false;
        this._pending = null;
    }

    /**
     * ✅ 作废会话缓存（开启新代数）
     * 调用点：「刷新关注列表」（LOAD_FOLLOWING_AUTHORS）、重选文件夹（SELECT_FOLDER）
     */
    invalidateCache() {
        this.cache = null;
    }

    /**
     * ✅ 处理作者作品钻取加载（串行入口）
     */
    async load(data, iframe) {
        if (this._loading) {
            this._pending = data;
            logger.info('⏳ 作者作品正在加载中，记录最新钻取请求，完成后将按最新作者重跑');
            return;
        }
        this._loading = true;
        try {
            await this._doLoad(data, iframe);
            // 加载期间切换了作者 → 用最后一次的最新请求重跑
            while (this._pending) {
                const next = this._pending;
                this._pending = null;
                logger.info('🔁 按加载期间更新后的钻取请求重新处理');
                await this._doLoad(next, iframe);
            }
        } finally {
            this._loading = false;
        }
    }

    /**
     * ✅ 钻取加载实际执行体
     */
    async _doLoad({ uid, platformId }, iframe) {
        // 所有回流消息统一携带 uid，侧边栏 _isCurrent 校验防串
        const send = (type, payload) => {
            iframe?.contentWindow.postMessage({ source: 'content', type, uid, ...payload }, '*');
        };

        try {
            if (!this.cache) this.cache = new Map();

            // ✅ 会话内已加载过（本次刷新代数内）：直接复用，秒开不发 API
            const cachedWorks = this.cache.get(uid);
            if (cachedWorks) {
                logger.info(`⚡ 本次刷新周期内已加载过，直接复用: UID=${uid} (${cachedWorks.length} 个作品)`);
                send('AUTHOR_WORKS_LOADED', { works: cachedWorks, total: cachedWorks.length });
                return;
            }

            if (!platformId) {
                throw new Error('缺少作者 sec_uid');
            }

            logger.info(`🎬 开始加载作者作品: UID=${uid}`);
            send('AUTHOR_WORKS_PROGRESS', { current: 0 });

            // iframe 传 null：data-fetcher 的 progress/loaded 裸消息静默；
            // extraParams.onProgress 覆盖内部进度回调（配置化管线按 ...extraParams 后置展开）
            const works = await dataFetcher._loadList('authorWorks', null, {
                uid,
                platformId,
                forceRefresh: true,
                onProgress: (current) => send('AUTHOR_WORKS_PROGRESS', { current })
            });

            // ✅ 管线提前退出（如未选择文件夹）返回空，明确报错而非展示空列表
            if (!works) {
                throw new Error('加载未执行，请先选择保存文件夹');
            }

            // ✅ 过滤软删除项（作者已删除的作品被合并标记，不展示给钻取列表）
            const validWorks = works.filter(work => !work.isDeleted);
            this.cache.set(uid, validWorks);

            logger.info(`✅ 作者作品加载完成: ${validWorks.length} 个（合并后过滤软删除 ${works.length - validWorks.length} 个）`);
            send('AUTHOR_WORKS_LOADED', { works: validWorks, total: validWorks.length });
        } catch (error) {
            logger.error(`❌ 作者作品加载失败: UID=${uid}`, error);
            send('AUTHOR_WORKS_ERROR', { error: error.message || '未知错误' });
        }
    }
}

// ✅ 模块级单例：main.js 消息处理共用同一实例，保证串行标志与缓存状态一致
export const authorWorksLoader = new AuthorWorksLoader();
export default authorWorksLoader;
