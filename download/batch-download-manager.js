// ==========================================
// 批量下载管理器 - 作品级批量下载
// 职责：串行执行多个作品的下载任务
// ==========================================

import { createLogger } from '../utils/logger.js';
import { CONFIG } from '../config/constants.js';
import { SingleDownloader } from './single-downloader.js';
import { backupManager } from '../data/backup-manager.js';
import { database } from '../data/database.js';

const logger = createLogger('BatchDownloadManager');

export class BatchDownloadManager {
    constructor(fileSystem, customConfig = {}) {
        this.fileSystem = fileSystem;
        
        // ✅ 传递 single 配置给 SingleDownloader
        this.singleDownloader = new SingleDownloader(
            fileSystem, 
            customConfig.single || CONFIG.DOWNLOAD_CONFIG.single
        );
        
        // 批次状态
        this.batchId = null;
        this.status = 'idle';  // idle | running | ended
        this.shouldStop = false;
        
        // ✅ 合并配置：默认配置 + 自定义配置
        this.config = {
            ...CONFIG.DOWNLOAD_CONFIG.batch,
            ...customConfig.batch
        };
        
        // 进度追踪
        this.progress = {
            total: 0,
            current: 0,
            success: 0,
            failed: 0
        };
        
        // ✅ 下载备份追踪
        this.downloadBackupTracker = {
            lastBackupTime: Date.now(),
            downloadedCount: 0,
            downloadedWorks: []  // 存储完整作品信息 { work, result, folderPath }
        };
    }

    /**
     * ✅ 开始批量下载（通过 workIds）
     * @param {string} batchId - 批次ID
     * @param {Array} workIds - 作品ID列表
     * @param {string} folderPath - 保存路径
     * @param {Function} onProgress - 进度回调
     * @returns {Promise<Object>} 下载结果
     */
    async startWithIds(batchId, workIds, folderPath, onProgress = null) {
        try {
            // ✅ 保存 onProgress 回调供 randomDelay 使用
            this._onProgress = onProgress;
            
            // ✅ 导入 platformAPI
            const { platformAPI } = await import('../api/platform-adapter.js');
            
            // 初始化批次
            this.batchId = batchId;
            this.status = 'running';
            this.shouldStop = false;
            this.progress = {
                total: workIds.length,
                current: 0,
                success: 0,
                failed: 0
            };

            logger.info(`🚀 开始批量下载: ${workIds.length} 个作品`);

            const results = [];

            // 串行下载
            for (let i = 0; i < workIds.length; i++) {
                // 检查是否应该停止
                if (this.shouldStop) {
                    logger.info(`⏹️ 用户停止下载，已完成 ${i}/${workIds.length} 个`);
                    break;
                }

                const workId = workIds[i];
                this.progress.current = i + 1;

                logger.info(`📥 [${i + 1}/${workIds.length}] 下载: ${workId}`);

                // ✅ 实时获取作品详情
                logger.info(`🔄 正在获取作品详情: ${workId}`);
                let workDetail;
                try {
                    workDetail = await platformAPI.getWorkDetail(workId);
                    
                    if (!workDetail) {
                        throw new Error('获取作品详情失败');
                    }
                    
                    logger.info(`✅ 已获取作品详情: ${workDetail.workId}`);
                } catch (error) {
                    logger.error(`❌ 获取作品详情失败: ${workId}`, error);
                    const failedResult = {
                        success: false,
                        workId: workId,
                        error: `获取作品详情失败: ${error.message}`
                    };
                    results.push(failedResult);
                    this.progress.failed++;
                    
                    // 通知进度
                    if (onProgress) {
                        onProgress({ ...this.progress, results }, failedResult);  // ✅ 传递失败结果
                    }
                    continue;
                }

                // ✅ 通知 Sidebar：开始下载这个作品
                if (onProgress) {
                    onProgress({ ...this.progress, results }, { 
                        type: 'ITEM_START',  // ✅ 新增类型标识
                        workId: workId 
                    });
                }

                // 下载作品（带重试）
                const result = await this.downloadWithRetry(workDetail, folderPath);
                results.push(result);

                if (result.success) {
                    this.progress.success++;
                    
                    // ✅ 方案 B：立即保存到数据库
                    const mediaType = workDetail.isImagePost ? 'image_post' : 'video';
                    const filePath = this.generateRelativeFilePath(workDetail, mediaType);
                    
                    await database.markAsDownloaded({
                        workId: workDetail.workId,
                        downloadTime: Date.now(),
                        filePath,
                        fileSize: result.fileSize || 0,
                        mediaType,
                        quality: 'origin'
                    });
                    
                    logger.info(`💾 已记录到数据库: ${workDetail.workId}`);
                    
                    // ✅ 追踪已下载的作品（用于备份）
                    this.trackDownloadedWork(workDetail, result, folderPath);
                } else {
                    this.progress.failed++;
                }

                // 通知进度
                if (onProgress) {
                    onProgress({ ...this.progress, results }, result);  // ✅ 传递最后一个结果
                }

                // 如果不是最后一个，添加随机延迟
                if (i < workIds.length - 1 && !this.shouldStop) {
                    await this.randomDelay();
                }
            }

            // 结束批次
            this.end();

            logger.info(`✅ 批量下载完成: 成功 ${this.progress.success}, 失败 ${this.progress.failed}`);

            return {
                batchId: this.batchId,
                status: this.status,
                progress: this.progress,
                results,
                stopped: this.shouldStop  // ✅ 添加停止标志
            };
        } catch (error) {
            logger.error(`❌ 批量下载异常`, error);
            this.end();
            throw error;
        }
    }

    /**
     * 停止下载
     */
    stop() {
        this.shouldStop = true;
        logger.info(`⏹️ 收到停止请求`);
    }

    /**
     * 结束批次
     */
    end() {
        this.status = 'ended';
        logger.info(`🏁 批次结束: ${this.batchId}`);
    }

    /**
     * ✅ 检查是否被停止
     * @returns {boolean} 是否被停止
     */
    isStopped() {
        return this.shouldStop;
    }

    /**
     * 带重试的下载
     */
    async downloadWithRetry(work, folderPath) {
        let lastError = null;

        for (let retry = 0; retry <= this.config.maxRetries; retry++) {
            // 检查是否应该停止
            if (this.shouldStop) {
                return {
                    success: false,
                    workId: work.workId,
                    error: '用户停止'
                };
            }

            if (retry > 0) {
                const retryDelay = this.config.retryDelayBase * retry;
                logger.warn(`🔄 第 ${retry} 次重试，等待 ${retryDelay / 1000} 秒...`);
                await this.delay(retryDelay);
            }

            try {
                const result = await this.singleDownloader.download(work, folderPath);
                return result;
            } catch (error) {
                lastError = error;
                logger.warn(`⚠️ 下载失败: ${work.workId}`, error.message);
            }
        }

        return {
            success: false,
            workId: work.workId,
            error: lastError?.message || '未知错误'
        };
    }

    /**
     * 随机延迟（防封号）
     */
    async randomDelay() {
        const delayTime = Math.floor(
            Math.random() * (this.config.maxDelay - this.config.minDelay) + this.config.minDelay
        );

        const delaySeconds = (delayTime / 1000).toFixed(1);
        logger.info(`⏱️ 防止封号，等待 ${delaySeconds} 秒...`);
        
        // ✅ 通过 onProgress 回调发送 UI 日志消息
        if (this._onProgress) {
            this._onProgress({ ...this.progress }, { 
                type: 'UI_LOG',
                level: 'info',
                message: `⏱️ 防封号延迟: ${delaySeconds} 秒...`
            });
        }

        // 可中断的延迟
        await new Promise((resolve) => {
            const startTime = Date.now();
            const checkInterval = setInterval(() => {
                if (this.shouldStop) {
                    clearInterval(checkInterval);
                    resolve();
                } else if (Date.now() - startTime >= delayTime) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 100);
        });
    }

    /**
     * 固定延迟
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * ✅ 追踪已下载的作品，并在满足条件时触发备份
     * @param {Object} work - 作品对象
     * @param {Object} result - 下载结果
     * @param {string} folderPath - 文件夹路径
     */
    trackDownloadedWork(work, result, folderPath) {
        this.downloadBackupTracker.downloadedCount++;
        this.downloadBackupTracker.downloadedWorks.push({ work, result, folderPath });
        
        const now = Date.now();
        const timeSinceLastBackup = now - this.downloadBackupTracker.lastBackupTime;
        
        // 获取备份配置
        const downloadBackupConfig = CONFIG.BACKUP_CONFIG.downloadBackup || {};
        const timeThreshold = downloadBackupConfig.timeThreshold || 60 * 1000; // 默认 1 分钟
        const countThreshold = downloadBackupConfig.countThreshold || 10; // 默认 10 条
        
        // 检查是否满足备份条件（时间或数量）
        const shouldBackupByTime = timeSinceLastBackup >= timeThreshold;
        const shouldBackupByCount = this.downloadBackupTracker.downloadedCount >= countThreshold;
        
        if (shouldBackupByTime || shouldBackupByCount) {
            logger.info(`🔄 下载进度备份触发 (${this.downloadBackupTracker.downloadedCount} 个作品, ${Math.round(timeSinceLastBackup / 1000)}s)`);
            
            // 异步触发备份（不阻塞下载）
            this.triggerDownloadBackup().catch(error => {
                logger.warn('⚠️ 下载备份失败:', error.message);
            });
            
            // 重置追踪器
            this.downloadBackupTracker.lastBackupTime = now;
            this.downloadBackupTracker.downloadedCount = 0;
            this.downloadBackupTracker.downloadedWorks = [];
        }
    }
    
    /**
     * ✅ 触发下载进度备份
     */
    async triggerDownloadBackup() {
        try {
            // ✅ 方案 B：已改为每次下载成功后立即保存，这里只负责备份到文件系统
            
            // ✅ 触发立即备份到本地文件（如果启用）
            const immediateBackupConfig = CONFIG.BACKUP_CONFIG.downloadBackup?.immediateBackup;
            if (immediateBackupConfig?.enabled) {
                const delay = immediateBackupConfig.delay || 5000;
                logger.info(`⏰ ${delay / 1000} 秒后触发立即备份...`);
                
                setTimeout(async () => {
                    try {
                        logger.info('🔄 开始立即备份...');
                        // ✅ 使用选择性备份，只备份 completed_works 表
                        await backupManager.performSelectiveBackup(['completed_works']);
                        logger.info('✅ 立即备份完成');
                    } catch (error) {
                        logger.warn('⚠️ 立即备份失败:', error.message);
                    }
                }, delay);
            }
            
        } catch (error) {
            logger.error('❌ 下载进度备份失败:', error);
            throw error;
        }
    }
    
    /**
     * 生成相对文件路径
     * @param {Object} work - 作品对象
     * @param {string} mediaType - 媒体类型
     * @returns {string} 相对路径
     */
    generateRelativeFilePath(work, mediaType) {
        // ✅ 统一使用 SingleDownloader 的路径生成逻辑
        const platform = CONFIG.ACTIVE_PLATFORM;
        const platformName = CONFIG.PLATFORM_INFO[platform]?.name || platform;
        
        // 提取作者信息
        const author = work?.author;
        let authorFolder = '未知作者';
        if (author) {
            const nickname = author.nickname || '未知用户';
            const uid = author.uid || author.platformId || 'unknown';
            // 清理昵称中的非法文件名字符
            const safeNickname = nickname.replace(/[<>:"/\\|?*]/g, '_');
            authorFolder = `${safeNickname}(${uid})`;
        }
        
        const config = CONFIG.DOWNLOAD_CONFIG.fileSystem;
        const mediaFolder = mediaType === 'video' ? config.mediaTypeFolders.video : config.mediaTypeFolders.imagePost;
        const fileNameFormat = mediaType === 'video' ? config.fileNameFormats.video : config.fileNameFormats.image;
        
        let fileName;
        if (mediaType === 'video') {
            fileName = fileNameFormat.replace('{workId}', work.workId);
        } else {
            // 图集使用第一张图片作为代表
            fileName = fileNameFormat.replace('{workId}', work.workId).replace('{index}', '01');
        }
        
        // ✅ 完整路径：平台/作者昵称(uid)/视频或图集/workId.xxx
        return `${platformName}/${authorFolder}/${mediaFolder}/${fileName}`;
    }
}
