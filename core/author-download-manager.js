// ==========================================
// FavGallery - 作者下载管理器
// 职责：跟踪作者下载状态、更新按钮UI、管理多作者并发
// ==========================================

import { createLogger, logToUI } from '../utils/logger.js';
// ✅ 已知作品总数（分母）口径与卡片渲染、批量选择共用同一纯函数模块
import { toCount, computeKnownWorkCount } from '../utils/author-completion.js';

const logger = createLogger('AuthorDownloadManager');

export class AuthorDownloadManager {
    constructor(app) {
        this.app = app;
        // ✅ 跟踪每个作者的下载状态
        this.authorDownloads = new Map();
    }

    /**
     * ✅ 开始下载作者的作品集
     * @param {string} uid - 作者ID
     * @param {string} platformId - 作者平台ID
     * @param {string} nickname - 作者昵称
     * @param {HTMLElement} button - 下载按钮DOM引用
     */
    async startAuthorDownload(uid, platformId, nickname, button) {
        // ✅ 立即设置 DownloadHandler 状态（在任何异步操作之前）
        if (this.app.downloadHandler) {
            this.app.downloadHandler.isDownloading = true;
            this.app.downloadHandler.currentBatchId = `author_single_${uid}_${Date.now()}`;
            this.app.downloadHandler.currentBatchListType = 'following';
        }
            
        // ✅ 检查是否为"继续下载"（partial 状态）- 通过 postMessage 查询
        let initialCompleted = 0;
        let workCount = 0;
                
        try {
            // ✅ 通过 postMessage 查询作者状态
            const statusResponse = await this.queryAuthorStatus(uid);
            if (statusResponse && statusResponse.downloadStatus === 'partial') {
                initialCompleted = statusResponse.downloadedCount || 0;
                workCount = statusResponse.workCount || 0;
                logger.info(`[AuthorDownload] 🔄 继续下载作者作品 ${nickname}，已完成: ${initialCompleted}/${workCount}`);
            }
        } catch (error) {
            logger.warn('[AuthorDownload] ⚠️ 获取作者作品状态失败，从0开始:', error);
        }
                
        // ✅ 初始化状态跟踪
        this.authorDownloads.set(uid, {
            uid,
            platformId,
            nickname,
            workCount: workCount,
            downloadedCount: initialCompleted,
            failed: 0,
            button: button,  // ✅ 保存按钮引用
            startTime: Date.now(),
            isBatchDownload: false
        });

        // ✅ 重置按钮UI为"保存中"状态
        this.resetAuthorButtonUI(button, initialCompleted, workCount);

        // ✅ 禁用所有下载按钮
        this.disableAllDownloadButtons();
        
        // ✅ 禁用选择文件夹和刷新列表按钮
        if (this.app.uiStateManager) {
            this.app.uiStateManager.setDownloadingState(true);
        }
        
        // ✅ 启用批量停止按钮（支持单个作者下载时停止）
        if (this.app.uiStateManager) {
            this.app.uiStateManager.enableStopDownloadButton();
        }

        logger.info('[AuthorDownload] 📥 开始保存作者作品:', { uid, nickname });
    }

    /**
     * ✅ 查询作者状态（通过 postMessage）
     * @param {string} uid - 作者ID
     * @returns {Promise<Object|null>} 作者状态
     */
    queryAuthorStatus(uid) {
        return new Promise((resolve) => {
            // ✅ 发送查询请求到 Content Script
            window.parent.postMessage({
                source: 'sidebar',
                type: 'QUERY_AUTHOR_STATUS',
                uid
            }, '*');
            
            // ✅ 监听响应（5秒超时）
            const handler = (event) => {
                if (!event.data || event.data.source !== 'content') return;
                if (event.data.type !== 'AUTHOR_STATUS_RESPONSE') return;
                if (event.data.uid !== uid) return;
                
                window.removeEventListener('message', handler);
                resolve(event.data.status);
            };
            
            window.addEventListener('message', handler);
            
            // 超时保护
            setTimeout(() => {
                window.removeEventListener('message', handler);
                resolve(null);
            }, 5000);
        });
    }

    /**
     * ✅ 重置作者按钮UI为"保存中"状态
     * @param {HTMLElement} button - 按钮元素
     * @param {number} initialCompleted - 已完成的数量
     * @param {number} workCount - 总数量
     */
    resetAuthorButtonUI(button, initialCompleted = 0, workCount = 0) {
        // 清除旧内容
        button.innerHTML = '';
        button.className = 'download-btn';
        button.disabled = true;
        
        // ✅ 设置灰色背景（保存中状态）
        button.style.background = '#d9d9d9';
        button.style.color = '#666';
        
        // 计算初始进度百分比
        const initialProgress = workCount > 0 ? Math.round((initialCompleted / workCount) * 100) : 0;
        
        // 创建新的进度条
        const progressBar = document.createElement('div');
        progressBar.className = 'progress-bar';
        progressBar.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: ${initialProgress}%;
            height: 100%;
            background: linear-gradient(90deg, #52c41a, #73d13d);
            transition: width 0.3s ease;
            z-index: 0;
        `;
        button.appendChild(progressBar);
        
        // 创建文本容器
        const textSpan = document.createElement('span');
        textSpan.className = 'btn-text';
        textSpan.textContent = '⏳ 保存中...';
        textSpan.style.cssText = `
            position: relative;
            z-index: 1;
            color: white;
            display: block;
            text-align: center;
        `;
        button.appendChild(textSpan);
    }

    /**
     * ✅ 批量请求作者实时下载状态（fire-and-forget，响应由 applyAuthorStatuses 处理）
     * 统一「已存 x/y」口径：relations ∩ completed_works 实时计算，
     * 覆盖钻取视图/单卡保存不走按作者下载累加链路的场景
     * @param {Array<string>} uids - 作者ID列表
     */
    requestAuthorStatuses(uids) {
        if (!uids || uids.length === 0) return;
        window.parent.postMessage({
            source: 'sidebar',
            type: 'QUERY_AUTHORS_STATUS_BATCH',
            uids
        }, '*');
    }

    /**
     * ✅ 持久化作者下载统计到 Content 主库（fire-and-forget 消息桥接）
     * 关键：Sidebar 上下文的 IndexedDB 按 origin 隔离，直写 database.save('authors') 只落影子库，
     * 刷新关注列表（读 Content 库）永远看不到；必须经 UPDATE_AUTHOR_DOWNLOAD_STATS 委托 Content 合并写主库
     * @param {Object} stats - { uid: { downloadedCount, workCount } }
     */
    _persistAuthorStatsToContent(stats) {
        if (!stats || Object.keys(stats).length === 0) return;
        window.parent.postMessage({
            source: 'sidebar',
            type: 'UPDATE_AUTHOR_DOWNLOAD_STATS',
            stats
        }, '*');
    }

    /**
     * ✅ 应用批量实时状态：回写内存作者数据 + 重渲染 + 持久化校正派生字段
     * 仅覆盖有关系数据的作者；workCount 取 max(原 API 值, 关系数)，
     * 避免部分关系（如未拉满）时把总数缩小造成误报
     * @param {Object} statuses - { uid: { downloadedCount, workCount } }
     */
    async applyAuthorStatuses(statuses = {}) {
        const followingManager = this.app.followingManager;
        if (!followingManager || !statuses) return;

        const changedAuthors = [];
        (followingManager.allAuthors || []).forEach(author => {
            const status = statuses[author.uid];
            if (!status) return;

            const downloadedCount = status.downloadedCount || 0;
            // ✅ 有清单数据时以 relations 去重统计为权威值（可修正历史上被平台计数污染的旧值），
            //    无清单数据时保留本地值并不低于已存数（消除“已存 9/8”倒挂）
            const workCount = computeKnownWorkCount({
                relationCount: status.workCount,
                cachedWorkCount: author.workCount,
                apiWorkCount: author.platformWorkCount,
                downloadedCount
            });
            if (author.downloadedCount === downloadedCount && author.workCount === workCount) return;

            author.downloadedCount = downloadedCount;
            author.workCount = workCount;
            changedAuthors.push(author);
        });

        if (changedAuthors.length === 0) return;

        // ✅ 重渲染作者列表（保持当前页 checkbox 选中态，避免计数校正造成选择丢失）
        const selectedSet = this.app.batchSelectionManager?.state?.following?.selectedAuthorIds || new Set();
        const currentPageItems = followingManager.getCurrentPageData();
        const selectedIds = currentPageItems
            .filter(author => selectedSet.has(author.uid))
            .map(author => author.uid);
        followingManager.initElements();
        followingManager.updateUI(new Set(selectedIds));

        // ✅ 持久化校正后的派生字段到 Content 主库（下次刷新关注列表时 _mergeItems 以此为缓存基准）
        this._persistAuthorStatsToContent(changedAuthors.reduce((acc, author) => {
            acc[author.uid] = { downloadedCount: author.downloadedCount, workCount: author.workCount };
            return acc;
        }, {}));

        logger.info(`[AuthorDownload] 📊 已按实时计算校正 ${changedAuthors.length} 个作者的下载计数`);
    }

    /**
     * ✅ 设置批量下载标志
     * @param {string} uid - 作者ID
     * @param {boolean} isBatch - 是否为批量下载
     */
    setBatchDownloadFlag(uid, isBatch = true) {
        const authorData = this.authorDownloads.get(uid);
        if (authorData) {
            authorData.isBatchDownload = isBatch;
        }
    }

    /**
     * ✅ 禁用所有作者卡片的下载按钮
     */
    disableAllDownloadButtons() {
        const listEl = document.getElementById('followingList');
        if (!listEl) return;

        const downloadButtons = listEl.querySelectorAll('.download-btn');
        downloadButtons.forEach(btn => {
            // ✅ 跳过已经在下载的按钮
            const hasProgressBar = btn.querySelector('.progress-bar');
            const isDownloading = btn.textContent.includes('保存中') || btn.textContent.includes('⏳');

            if (hasProgressBar || isDownloading) {
                logger.info('[AuthorDownload] ⏭️ 跳过正在下载的按钮');
                return;
            }

            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
        });

        logger.info('[AuthorDownload] 🔒 已禁用所有保存按钮');
    }

    /**
     * ✅ 启用所有作者卡片的下载按钮
     */
    enableAllDownloadButtons() {
        const listEl = document.getElementById('followingList');
        if (!listEl) return;

        const downloadButtons = listEl.querySelectorAll('.download-btn');
        downloadButtons.forEach(btn => {
            // ✅ 恢复所有可操作按钮（完成态也已恢复为可点，用于下次检查更新；仅无作品作者保持禁用）
            if (!btn.classList.contains('empty')) {
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
            }
        });

        logger.info('[AuthorDownload] 🔓 已启用所有保存按钮');
    }

    /**
     * ✅ 处理 AUTHOR_WORKS_COUNT 消息，初始化作品计数
     * @param {string} uid - 作者ID
     * @param {number} workCount - 总作品数
     * @param {number} skippedCount - 跳过数量（已下载的作品）
     */
    async handleAuthorWorksCount(uid, workCount, skippedCount = 0) {
        const authorData = this.authorDownloads.get(uid);
        if (!authorData) {
            logger.warn(`[AuthorDownload] ⚠️ 未找到作者下载记录: ${uid}`);
            return;
        }

        // ✅ 设置总数和初始完成数
        authorData.workCount = workCount;
        authorData.downloadedCount = skippedCount;
        
        logger.info(`[AuthorDownload] 📊 初始化作品计数: 总数 ${workCount}, 跳过 ${skippedCount}`);

        // ✅ 如果有跳过的作品，更新按钮显示进度
        if (skippedCount > 0) {
            this.updateAuthorButtonProgress(authorData);
        }

        // ✅ 如果所有作品都已跳过，直接标记为完成
        if (skippedCount === workCount && workCount > 0) {
            logger.info(`[AuthorDownload] ✅ 所有作品已存在，直接标记为完成 (${skippedCount}/${workCount})`);
            await this.finishAuthorDownload(uid);
        }
    }

    /**
     * ✅ 作品下载完成回调
     * @param {string} uid - 作者ID
     * @param {boolean} success - 是否成功
     */
    async workCompleted(uid, success = true) {
        const authorData = this.authorDownloads.get(uid);
        if (!authorData) {
            logger.info('[AuthorDownload] ℹ️ 作者作品集的保存记录不存在（可能已提前完成）:', uid);
            return;
        }

        // ✅ 防止重复计数
        if (success && authorData.downloadedCount >= authorData.workCount && authorData.workCount > 0) {
            logger.warn(`[AuthorDownload] ⚠️ 已完成数量已达上限，忽略重复消息: ${authorData.downloadedCount}/${authorData.workCount}`);
            return;
        }

        if (success) {
            authorData.downloadedCount++;
        } else {
            authorData.failed++;
        }

        // ✅ 更新按钮显示真实进度
        this.updateAuthorButtonProgress(authorData);

        // ✅ 检查是否全部完成
        if (authorData.downloadedCount + authorData.failed >= authorData.workCount) {
            await this.finishAuthorDownload(uid);
        }
    }

    /**
     * ✅ 更新作者按钮进度显示
     * @param {Object} authorData - 作者数据
     */
    updateAuthorButtonProgress(authorData) {
        if (!authorData.button) return;

        const btn = authorData.button;
        const progress = authorData.workCount > 0
            ? Math.round((authorData.downloadedCount / authorData.workCount) * 100)
            : 0;

        // ✅ 更新进度条宽度
        let progressBar = btn.querySelector('.progress-bar');
        if (!progressBar) {
            progressBar = document.createElement('div');
            progressBar.className = 'progress-bar';
            progressBar.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 0%;
                height: 100%;
                background: linear-gradient(90deg, #52c41a, #73d13d);
                transition: width 0.3s ease;
                z-index: 0;
            `;
            btn.insertBefore(progressBar, btn.firstChild);
        }
        progressBar.style.width = `${Math.min(progress, 90)}%`;

        // ✅ 更新文字显示进度
        let textSpan = btn.querySelector('.btn-text');
        if (!textSpan) {
            textSpan = document.createElement('span');
            textSpan.className = 'btn-text';
            // ✅ 根据进度决定文字颜色：有进度时用白色，否则用灰色
            const textColor = progress > 0 ? 'white' : '#666';
            textSpan.style.cssText = `
                position: relative;
                z-index: 1;
                color: ${textColor};
                display: block;
                text-align: center;
            `;
            btn.appendChild(textSpan);
        } else {
            // ✅ 如果已有文本span，根据进度更新颜色
            const textColor = progress > 0 ? 'white' : '#666';
            textSpan.style.color = textColor;
        }
        textSpan.textContent = `⏳ ${authorData.downloadedCount}/${authorData.workCount}`;
    }

    /**
     * ✅ 完成作者下载（更新 IndexedDB + 文件）
     * @param {string} uid - 作者ID
     * @param {boolean} isInterrupted - 是否被中断
     */
    async finishAuthorDownload(uid, isInterrupted = false) {
        const authorData = this.authorDownloads.get(uid);
        if (!authorData) return;

        logger.info('[AuthorDownload] 📊 完成下载 - 诊断信息:', {
            uid,
            nickname: authorData.nickname,
            downloadedCount: authorData.downloadedCount,
            workCount: authorData.workCount,
            isInterrupted
        });

        try {
            // ✅ 分母单调不减：断网/重试耗尽时 AUTHOR_WORKS_COUNT 不会送达，
            //    authorData.workCount 停留在初始值 0，不可用这种不可信单次拉取覆盖本地已知总数
            //    （主库侧 content 合并已有保护，此处补内存与显示层，实验 H 实测复现）
            const memAuthor = (this.app.followingManager?.allAuthors || []).find(a => a.uid === uid);
            const knownWorkCount = Math.max(toCount(authorData.workCount), toCount(memAuthor?.workCount));

            // ✅ 通过 postMessage 通知 Content Script 更新状态
            let status, downloadedCount;
            
            if (isInterrupted) {
                status = 'partial';
                downloadedCount = authorData.downloadedCount;
                
                logger.info(`[AuthorDownload] ⚠️ 作者作品保存中断: ${authorData.nickname} (${downloadedCount}/${authorData.workCount})`);
            } else {
                status = 'completed';
                // ✅ 分子取真实累计成功数（旧实现直接拿分母赋值，会把下载失败的作品虚报为已保存）
                downloadedCount = authorData.downloadedCount;
                
                logger.info(`[AuthorDownload] ✅ 作者作品保存完成: ${authorData.nickname} (${downloadedCount}/${authorData.workCount})`);
            }
            
            // ✅ 同步更新内存中的作者数据（如果存在 followingManager）
            if (this.app.followingManager && this.app.followingManager.allAuthors) {
                const authorIndex = this.app.followingManager.allAuthors.findIndex(a => a.uid === uid);
                
                if (authorIndex !== -1) {
                    this.app.followingManager.allAuthors[authorIndex].downloadedCount = downloadedCount;
                    this.app.followingManager.allAuthors[authorIndex].workCount = knownWorkCount;
                    
                    logger.info(`[AuthorDownload] ✅ 已同步更新内存中的作者数据: ${uid}`);
                    
                    // ✅ 立即更新该作者的UI（使用 authorData.button 引用）
                    if (authorData.button) {
                        this.updateAuthorButtonSuccess(authorData);
                        logger.info(`[AuthorDownload] 🎨 已通过 button 引用更新UI: ${uid}`);
                    } else {
                        // 降级方案：通过 UID 查找（同样用校正后的分母，避免显示层回落 0）
                        this.updateAuthorCardUI(uid, status, downloadedCount, knownWorkCount);
                    }
                }
            }
            
            // ✅ 同步刷新卡片统计行“🎬 已存 X/Y 作品”（与按钮独立，需单独更新）
            this.updateAuthorSavedCount(uid, downloadedCount, knownWorkCount);

            // ✅ 持久化到 Content 主库（消息桥接；旧实现直写 Sidebar 影子库，刷新后必丢）
            this._persistAuthorStatsToContent({
                [uid]: { downloadedCount, workCount: knownWorkCount }
            });
        } catch (error) {
            logger.error('[AuthorDownload] ❌ 更新作者状态失败:', error);
        } finally {
            // ✅ 清理跟踪数据
            this.authorDownloads.delete(uid);
            
            // ✅ 检查是否还有其他作者正在下载
            const hasOtherDownloading = this.authorDownloads.size > 0;
            
            if (!hasOtherDownloading) {
                // ✅ 没有其他作者在下载，恢复所有状态
                this.enableAllDownloadButtons();
                
                if (this.app.uiStateManager) {
                    this.app.uiStateManager.setDownloadingState(false);
                }
                
                logger.info('[AuthorDownload] ✅ 所有作者下载完成，已恢复所有按钮状态');
            } else {
                logger.info(`[AuthorDownload] ⏭️ 还有 ${this.authorDownloads.size} 个作者正在下载，保持按钮禁用`);
            }
        }
    }

    /**
     * ✅ 更新作者按钮为成功状态
     * @param {Object} authorData - 作者数据
     */
    updateAuthorButtonSuccess(authorData) {
        if (!authorData.button) return;

        const btn = authorData.button;

        // 清除进度条
        const progressBar = btn.querySelector('.progress-bar');
        if (progressBar) progressBar.remove();

        // 清除所有子元素
        btn.innerHTML = '';

        // 添加成功文字（✅ 完成态仍可点击：点击即拉作者清单求差集，发现新作品）
        const textSpan = document.createElement('span');
        textSpan.className = 'btn-text';
        textSpan.textContent = '✅ 检查更新';
        textSpan.style.cssText = `
            position: relative;
            z-index: 1;
            color: white;
            display: block;
            text-align: center;
        `;
        btn.appendChild(textSpan);

        // ✅ 更新样式（不禁用：完成态依旧可点）
        btn.style.position = 'relative';
        btn.style.overflow = 'hidden';
        btn.style.background = '#52c41a';
        btn.style.cursor = 'pointer';
        btn.disabled = false;
        btn.classList.add('completed');

        // ✅ 取消勾选（本批已处理完），但保持可勾选，便于下次批量检查更新
        const uid = authorData.uid;
        const checkbox = document.querySelector(`.author-checkbox[data-uid="${uid}"]`);
        if (checkbox) {
            checkbox.checked = false;
            logger.info('[AuthorDownload] ☑️ 已取消作者勾选（保持可选）:', uid);
        }
    }

    /**
     * ✅ 检查作者是否正在下载
     * @param {string} uid - 作者ID
     * @returns {boolean} 是否正在下载
     */
    isDownloading(uid) {
        return this.authorDownloads.has(uid);
    }

    /**
     * ✅ 处理“下载前单点校验确认已取关”回报（Content 侧已写入软删除标记，此处同步界面与跟踪状态）
     * 软删除语义：条目保留在列表与表中、已下载作品不动，仅禁止继续下载与勾选
     * @param {Object} data - { uid, nickname, batchId, reason }
     */
    async handleAuthorUnfollowed(data = {}) {
        const { uid, nickname, reason } = data;
        if (!uid) return;

        logger.info(`[AuthorDownload] 🚫 收到取关回报: ${nickname || uid}，${reason || '下载前单点校验'}`);

        // ✅ 内存数据标记软删除（重渲染时 resolveAuthorAction/isAuthorSelectable 据此禁用）
        if (this.app.followingManager && this.app.followingManager.allAuthors) {
            const author = this.app.followingManager.allAuthors.find(a => a.uid === uid);
            if (author) {
                author.isDeleted = true;
            }
        }

        // ✅ 移出下载跟踪，按钮就地改为“已取关”
        const authorData = this.authorDownloads.get(uid);
        this.authorDownloads.delete(uid);
        const btn = (authorData && authorData.button)
            || document.querySelector(`.download-btn[data-uid="${uid}"]`);
        if (btn) {
            const progressBar = btn.querySelector('.progress-bar');
            if (progressBar) progressBar.remove();
            btn.innerHTML = '<span class="btn-text" style="position:relative;z-index:1;color:white;display:block;text-align:center;">🚫 已取关</span>';
            // ✅ 带 empty 类：enableAllDownloadButtons 会跳过它，批次结束后仍保持禁用
            btn.className = 'download-btn empty';
            btn.disabled = true;
            btn.style.background = '#bfbfbf';
            btn.style.opacity = '1';
            btn.style.cursor = 'not-allowed';
            btn.setAttribute('data-tip', '已取消关注（软删除）：条目与已存作品保留在本地，不再下载新作品；如需清理请到离线浏览页处理');
        } else {
            logger.warn(`[AuthorDownload] ⚠️ 未找到已取关作者的下载按钮: ${uid}`);
        }

        // ✅ 取消并禁用勾选，同步选中计数
        if (this.app.batchSelectionManager) {
            const selection = this.app.batchSelectionManager.state?.following;
            if (selection) selection.selectedAuthorIds.delete(uid);
            this.app.batchSelectionManager.disableItem('following', uid);
            this.app.batchSelectionManager.updateBatchSelectionUI('following');
        }

        logToUI('warning', `🚫 ${nickname || uid} 已取消关注：跳过下载，已标记软删除（条目保留在列表）`);

        // ✅ 收尾沿用 finishAuthorDownload 的 finally 范式：无人在下载时恢复全局状态，
        //    避免批量批次因被跳过的作者没有完成回报而卡在“保存中”
        if (this.authorDownloads.size === 0) {
            this.enableAllDownloadButtons();

            if (this.app.uiStateManager) {
                this.app.uiStateManager.setDownloadingState(false);
            }

            logger.info('[AuthorDownload] ✅ 本批已全部结束（含取关跳过），已恢复按钮状态');
        }
    }

    /**
     * ✅ 立即更新作者卡片的UI（下载完成后立即显示"✅ 已保存"）
     * @param {string} uid - 作者ID
     * @param {string} status - 状态
     * @param {number} downloadedCount - 已下载数量
     * @param {number} workCount - 总数量
     */
    updateAuthorCardUI(uid, status, downloadedCount, workCount) {
        const listEl = document.getElementById('followingList');
        if (!listEl) return;
        
        // 找到对应的作者卡片
        const authorCard = listEl.querySelector(`.author-item[data-uid="${uid}"]`);
        if (!authorCard) {
            logger.warn(`[AuthorDownload] ⚠️ 未找到作者卡片: ${uid}`);
            return;
        }
        
        // 更新下载按钮
        const downloadBtn = authorCard.querySelector('.download-btn');
        if (downloadBtn) {
            if (status === 'completed') {
                // ✅ 完成态：绿色、可点（点击检查是否有新作品）
                downloadBtn.className = 'download-btn btn completed';
                downloadBtn.innerHTML = '<span class="btn-text">✅ 检查更新</span>';
                downloadBtn.disabled = false;
                downloadBtn.style.opacity = '1';
                downloadBtn.style.cursor = 'pointer';
            } else if (status === 'partial') {
                downloadBtn.className = 'download-btn btn partial';
                downloadBtn.innerHTML = `<span class="btn-text">⚠️ ${downloadedCount}/${workCount}</span>`;
                downloadBtn.disabled = false;
                downloadBtn.style.opacity = '1';
                downloadBtn.style.cursor = 'pointer';
            }
            
            logger.info(`[AuthorDownload] 🎨 已更新作者卡片UI: ${uid} -> ${status}`);
        }
        
        // 更新复选框（取消勾选但保持可选）
        const checkbox = authorCard.querySelector('.author-checkbox');
        if (checkbox && status === 'completed') {
            checkbox.checked = false;
            logger.info(`[AuthorDownload] ☑️ 已取消作者勾选（保持可选）: ${uid}`);
        }
    }

    /**
     * ✅ 实时刷新作者卡片统计行“🎬 已存 X/Y 作品”
     * （下载完成后按钮与复选框会更新，但统计行是独立 DOM 节点，需单独刷新）
     * @param {string} uid - 作者ID
     * @param {number} downloadedCount - 已下载数量
     * @param {number} workCount - 总数量
     */
    updateAuthorSavedCount(uid, downloadedCount, workCount) {
        const listEl = document.getElementById('followingList');
        if (!listEl) return;

        const authorCard = listEl.querySelector(`.author-item[data-uid="${uid}"]`);
        if (!authorCard) return;

        const savedEl = authorCard.querySelector('.author-saved-count');
        if (savedEl) {
            savedEl.textContent = `${downloadedCount || 0}/${workCount || 0}`;
            logger.info(`[AuthorDownload] 🎬 已刷新作者卡片统计行: ${uid} -> ${downloadedCount || 0}/${workCount || 0}`);
        }
    }
}
