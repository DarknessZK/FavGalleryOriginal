// ==========================================
// FavGallery - 作者下载管理器
// 职责：跟踪作者下载状态、更新按钮UI、管理多作者并发
// ==========================================

import { createLogger } from '../utils/logger.js';

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
        // ✅ 检查是否为“继续下载”（partial 状态）- 通过 postMessage 查询
        let initialCompleted = 0;
        let totalCount = 0;
                
        try {
            // ✅ 通过 postMessage 查询作者状态
            const statusResponse = await this.queryAuthorStatus(uid);
            if (statusResponse && statusResponse.downloadStatus === 'partial') {
                initialCompleted = statusResponse.downloadedCount || 0;
                totalCount = statusResponse.totalCount || 0;
                logger.info(`[AuthorDownload] 🔄 继续下载作者作品 ${nickname}，已完成: ${initialCompleted}/${totalCount}`);
            }
        } catch (error) {
            logger.warn('[AuthorDownload] ⚠️ 获取作者作品状态失败，从0开始:', error);
        }
                
        // ✅ 初始化状态跟踪
        this.authorDownloads.set(uid, {
            uid,
            platformId,
            nickname,
            total: totalCount,
            completed: initialCompleted,
            failed: 0,
            button: button,  // ✅ 保存按钮引用
            startTime: Date.now(),
            isBatchDownload: false
        });

        // ✅ 重置按钮UI为"保存中"状态
        this.resetAuthorButtonUI(button, initialCompleted, totalCount);

        // ✅ 禁用所有下载按钮
        this.disableAllDownloadButtons();
        
        // ✅ 禁用选择文件夹和刷新列表按钮
        if (this.app.uiStateManager) {
            this.app.uiStateManager.setDownloadingState(true);
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
     * @param {number} totalCount - 总数量
     */
    resetAuthorButtonUI(button, initialCompleted = 0, totalCount = 0) {
        // 清除旧内容
        button.innerHTML = '';
        button.className = 'download-btn';
        button.disabled = true;
        
        // ✅ 设置灰色背景（保存中状态）
        button.style.background = '#d9d9d9';
        button.style.color = '#666';
        
        // 计算初始进度百分比
        const initialProgress = totalCount > 0 ? Math.round((initialCompleted / totalCount) * 100) : 0;
        
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
            // ✅ 只启用未下载完成的按钮
            if (!btn.textContent.includes('✅')) {
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
            }
        });

        logger.info('[AuthorDownload] 🔓 已启用所有保存按钮');
    }

    /**
     * ✅ 设置作品总数
     * @param {string} uid - 作者ID
     * @param {number} total - 总作品数
     * @param {boolean} allDownloaded - 是否所有作品都已下载
     */
    setTotalWorks(uid, total, allDownloaded = false) {
        const authorData = this.authorDownloads.get(uid);
        if (authorData) {
            authorData.total = total;
            logger.info('[AuthorDownload] 📊 作品总数:', total);
            
            // ✅ 如果作者没有作品，立即标记为完成
            if (total === 0) {
                logger.info('[AuthorDownload] ℹ️ 作者没有作品，直接标记为完成');
                this.finishAuthorDownload(uid);
                return;
            }
            
            // ✅ 如果所有作品都已下载（Content Script 告知），直接将 completed 设置为 total
            if (allDownloaded) {
                authorData.completed = total;
                logger.info(`[AuthorDownload] ✅ 所有作品已下载，设置 completed = ${total}`);
            }
            
            // ✅ 如果已完成数量 >= 总数，立即标记为完成
            if (authorData.completed >= total && total > 0) {
                logger.info(`[AuthorDownload] ✅ 所有作品已保存 (${authorData.completed}/${total})，直接标记为完成`);
                this.finishAuthorDownload(uid);
            }
        }
    }

    /**
     * ✅ 作品下载完成回调
     * @param {string} uid - 作者ID
     * @param {boolean} success - 是否成功
     */
    workCompleted(uid, success = true) {
        const authorData = this.authorDownloads.get(uid);
        if (!authorData) {
            logger.info('[AuthorDownload] ℹ️ 作者作品集的保存记录不存在（可能已提前完成）:', uid);
            return;
        }

        // ✅ 防止重复计数
        if (success && authorData.completed >= authorData.total && authorData.total > 0) {
            logger.warn(`[AuthorDownload] ⚠️ 已完成数量已达上限，忽略重复消息: ${authorData.completed}/${authorData.total}`);
            return;
        }

        if (success) {
            authorData.completed++;
        } else {
            authorData.failed++;
        }

        // ✅ 更新按钮显示真实进度
        this.updateAuthorButtonProgress(authorData);

        // ✅ 检查是否全部完成
        if (authorData.completed + authorData.failed >= authorData.total) {
            this.finishAuthorDownload(uid);
        }
    }

    /**
     * ✅ 更新作者按钮进度显示
     * @param {Object} authorData - 作者数据
     */
    updateAuthorButtonProgress(authorData) {
        if (!authorData.button) return;

        const btn = authorData.button;
        const progress = authorData.total > 0
            ? Math.round((authorData.completed / authorData.total) * 100)
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
        textSpan.textContent = `⏳ ${authorData.completed}/${authorData.total}`;
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
            completed: authorData.completed,
            total: authorData.total,
            isInterrupted
        });

        try {
            // ✅ 通过 postMessage 通知 Content Script 更新状态
            let status, downloadedCount;
            
            if (isInterrupted) {
                status = 'partial';
                downloadedCount = authorData.completed;
                
                logger.info(`[AuthorDownload] ⚠️ 作者作品保存中断: ${authorData.nickname} (${downloadedCount}/${authorData.total})`);
            } else {
                status = 'completed';
                downloadedCount = authorData.total;
                
                logger.info(`[AuthorDownload] ✅ 作者作品保存完成: ${authorData.nickname} (${downloadedCount}/${authorData.total})`);
            }
            
            // ✅ 发送更新请求到 Content Script
            window.parent.postMessage({
                source: 'sidebar',
                type: 'UPDATE_AUTHOR_DOWNLOAD_STATUS',
                uid,
                status,
                downloadedCount,
                totalCount: authorData.total
            }, '*');
            
            logger.info(`[AuthorDownload] 📤 已发送状态更新请求: ${uid} -> ${status} (${downloadedCount}/${authorData.total})`);
            
            // ✅ 同步更新内存中的作者数据（如果存在 followingManager）
            if (this.app.followingManager && this.app.followingManager.allAuthors) {
                const authorIndex = this.app.followingManager.allAuthors.findIndex(a => a.uid === uid);
                
                if (authorIndex !== -1) {
                    this.app.followingManager.allAuthors[authorIndex].downloadStatus = status;
                    this.app.followingManager.allAuthors[authorIndex].downloadedCount = downloadedCount;
                    this.app.followingManager.allAuthors[authorIndex].totalCount = authorData.total;
                    this.app.followingManager.allAuthors[authorIndex].lastDownloadTime = Date.now();
                    
                    logger.info(`[AuthorDownload] ✅ 已同步更新内存中的作者数据: ${uid}`);
                    
                    // ✅ 立即更新该作者的UI（使用 authorData.button 引用）
                    if (authorData.button) {
                        this.updateAuthorButtonSuccess(authorData);
                        logger.info(`[AuthorDownload] 🎨 已通过 button 引用更新UI: ${uid}`);
                    } else {
                        // 降级方案：通过 UID 查找
                        this.updateAuthorCardUI(uid, status, downloadedCount, authorData.total);
                    }
                }
            }
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
                
                // ✅ 标记下载结束（通知 Content Script 恢复定时保存）
                window.parent.postMessage({
                    source: 'sidebar',
                    type: 'DOWNLOAD_END'
                }, '*');
                
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

        // 添加成功文字
        const textSpan = document.createElement('span');
        textSpan.className = 'btn-text';
        textSpan.textContent = '✅ 已保存';
        textSpan.style.cssText = `
            position: relative;
            z-index: 1;
            color: white;
            display: block;
            text-align: center;
        `;
        btn.appendChild(textSpan);

        // ✅ 更新样式
        btn.style.position = 'relative';
        btn.style.overflow = 'hidden';
        btn.style.background = '#52c41a';
        btn.style.cursor = 'default';
        btn.disabled = true;

        // ✅ 同时禁用对应的复选框
        const uid = authorData.uid;
        const checkbox = document.querySelector(`.author-checkbox[data-uid="${uid}"]`);
        if (checkbox) {
            checkbox.disabled = true;
            checkbox.checked = false;
            checkbox.style.cursor = 'not-allowed';
            checkbox.style.opacity = '0.5';
            logger.info('[AuthorDownload] ✅ 已禁用作者复选框:', uid);
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
     * ✅ 立即更新作者卡片的UI（下载完成后立即显示"✅ 已保存"）
     * @param {string} uid - 作者ID
     * @param {string} status - 状态
     * @param {number} downloadedCount - 已下载数量
     * @param {number} totalCount - 总数量
     */
    updateAuthorCardUI(uid, status, downloadedCount, totalCount) {
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
                downloadBtn.className = 'download-btn btn completed';
                downloadBtn.innerHTML = '<span class="btn-text">✅ 已保存</span>';
                downloadBtn.disabled = true;
                downloadBtn.style.opacity = '1';
                downloadBtn.style.cursor = 'not-allowed';
            } else if (status === 'partial') {
                downloadBtn.className = 'download-btn btn partial';
                downloadBtn.innerHTML = `<span class="btn-text">⚠️ ${downloadedCount}/${totalCount}</span>`;
                downloadBtn.disabled = false;
                downloadBtn.style.opacity = '1';
                downloadBtn.style.cursor = 'pointer';
            }
            
            logger.info(`[AuthorDownload] 🎨 已更新作者卡片UI: ${uid} -> ${status}`);
        }
        
        // 更新复选框（禁用并取消勾选）
        const checkbox = authorCard.querySelector('.author-checkbox');
        if (checkbox && status === 'completed') {
            checkbox.disabled = true;
            checkbox.checked = false;
            logger.info(`[AuthorDownload] ☑️ 已禁用并取消勾选复选框: ${uid}`);
        }
    }
}
