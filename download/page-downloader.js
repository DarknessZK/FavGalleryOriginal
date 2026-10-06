// ==========================================
// 页面下载器 - 负责注入脚本执行下载
// 职责：在页面上下文中下载媒体文件，返回 Blob
// ==========================================

import { createLogger } from '../utils/logger.js';

const logger = createLogger('PageDownloader');

export class PageDownloader {
    constructor() {
        // ✅ 消息监听器映射（callbackId -> handler）
        this.messageHandlers = new Map();
    }

    /**
     * 在页面上下文中执行下载
     * @param {Object} params - 下载参数
     * @param {string} params.workId - 作品ID
     * @param {string} [params.videoUrl] - 视频URL
     * @param {string} [params.coverUrl] - 封面URL
     * @param {Array} [params.images] - 图片URL数组
     * @param {string} [params.musicUrl] - 音频URL
     * @param {boolean} params.isImagePost - 是否为图集
     * @param {number} [timeout=300000] - 超时时间（毫秒）
     * @returns {Promise<Object>} 下载结果（包含 Blob 数据）
     */
    async download(params, timeout = 300000) {
        return new Promise((resolve) => {
            const { workId } = params;  // ✅ 改为 workId

            // ✅ 创建唯一的回调 ID
            const callbackId = `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // ✅ 设置超时
            const timeoutId = setTimeout(() => {
                this.cleanupHandler(callbackId);
                resolve({
                    success: false,
                    workId,  // ✅ 改为 workId
                    error: '下载超时'
                });
            }, timeout);

            // ✅ 注册消息处理器
            const handler = (event) => {
                if (!event.data || event.data.callbackId !== callbackId) {
                    return;
                }

                // ✅ 清除超时和监听器
                clearTimeout(timeoutId);
                this.cleanupHandler(callbackId);

                if (event.data.type === 'DOWNLOAD_COMPLETE') {
                    logger.info(`✅ 收到下载完成: ${workId}`);  // ✅ 改为 workId
                    resolve({
                        success: true,
                        workId,  // ✅ 改为 workId
                        ...event.data.payload
                    });
                } else if (event.data.type === 'DOWNLOAD_ERROR') {
                    logger.error(`❌ 下载失败: ${workId}`, event.data.error);  // ✅ 改为 workId
                    resolve({
                        success: false,
                        workId,  // ✅ 改为 workId
                        error: event.data.error
                    });
                }
            };

            window.addEventListener('message', handler);
            this.messageHandlers.set(callbackId, handler);

            // ✅ 注入脚本
            this.injectDownloadScript(params, callbackId);

            logger.info(`✅ 下载脚本已注入: ${workId}`);  // ✅ 改为 workId
        });
    }

    /**
     * 注入下载脚本到页面
     */
    injectDownloadScript(params, callbackId) {
        const script = document.createElement('script');
        const safeParams = JSON.stringify(params);

        script.textContent = `
            (async function() {
                try {
                    const params = ${safeParams};
                    
                    if (params.isImagePost) {
                        await downloadImages(params);
                    } else {
                        await downloadVideo(params);
                    }
                } catch (error) {
                    console.error('[Page Download] ❌ 下载失败:', error);
                    window.postMessage({
                        callbackId: '${callbackId}',
                        type: 'DOWNLOAD_ERROR',
                        error: error.message
                    }, '*');
                }
                
                async function downloadVideo(params) {
                    // ✅ coverOnly：正片已在、仅缺封面时，只取封面，不重复拉视频（第 5 步缺件补下）
                    let videoBlob = null;
                    let size = null;
                    if (!params.coverOnly) {
                        const videoResponse = await fetch(params.videoUrl);
                        if (!videoResponse.ok) {
                            throw new Error('Video HTTP ' + videoResponse.status);
                        }

                        videoBlob = await videoResponse.blob();
                        size = videoResponse.headers.get('content-length');
                    }

                    let coverBlob = null;
                    if (params.coverUrl) {
                        try {
                            const coverResponse = await fetch(params.coverUrl);
                            if (coverResponse.ok) {
                                coverBlob = await coverResponse.blob();
                            }
                        } catch (e) {
                            console.warn('[Page Download] ⚠️ 封面下载失败:', e);
                        }
                    }
                    
                    window.postMessage({
                        callbackId: '${callbackId}',
                        type: 'DOWNLOAD_COMPLETE',
                        payload: {
                            videoBlob,
                            coverBlob,
                            size
                        }
                    }, '*');
                }
                
                async function downloadImages(params) {
                    const imageBlobs = [];
                    
                    for (let i = 0; i < params.images.length; i++) {
                        const response = await fetch(params.images[i]);
                        if (!response.ok) {
                            throw new Error('Image ' + i + ' HTTP ' + response.status);
                        }
                        imageBlobs.push(await response.blob());
                    }
                    
                    let musicBlob = null;
                    if (params.musicUrl) {
                        try {
                            const response = await fetch(params.musicUrl);
                            if (response.ok) {
                                musicBlob = await response.blob();
                            }
                        } catch (e) {
                            console.warn('[Page Download] ⚠️ 音频下载失败:', e);
                        }
                    }
                    
                    window.postMessage({
                        callbackId: '${callbackId}',
                        type: 'DOWNLOAD_COMPLETE',
                        payload: {
                            imageBlobs,
                            musicBlob,
                            imageCount: imageBlobs.length
                        }
                    }, '*');
                }
            })();
        `;

        document.head.appendChild(script);
        document.head.removeChild(script);
    }

    /**
     * 清理消息处理器
     */
    cleanupHandler(callbackId) {
        const handler = this.messageHandlers.get(callbackId);
        if (handler) {
            window.removeEventListener('message', handler);
            this.messageHandlers.delete(callbackId);
        }
    }

    /**
     * 清理所有监听器（防止内存泄漏）
     */
    cleanup() {
        this.messageHandlers.forEach((handler, callbackId) => {
            window.removeEventListener('message', handler);
        });
        this.messageHandlers.clear();
    }
}
