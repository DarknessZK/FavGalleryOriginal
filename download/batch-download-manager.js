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
     * 开始批量下载
     * @param {string} batchId - 批次ID
     * @param {Array} works - 作品列表
     * @param {string} folderPath - 保存路径
     * @param {Function} onProgress - 进度回调
     * @returns {Promise<Object>} 下载结果
     */
    async start(batchId, works, folderPath, onProgress = null) {
        try {
            // 初始化批次
            this.batchId = batchId;
            this.status = 'running';
            this.shouldStop = false;
            this.progress = {
                total: works.length,
                current: 0,
                success: 0,
                failed: 0
            };

            logger.info(`🚀 开始批量下载: ${works.length} 个作品`);

            const results = [];

            // 串行下载
            for (let i = 0; i < works.length; i++) {
                // 检查是否应该停止
                if (this.shouldStop) {
                    logger.info(`⏹️ 用户停止下载，已完成 ${i}/${works.length} 个`);
                    break;
                }

                const work = works[i];
                this.progress.current = i + 1;

                logger.info(`📥 [${i + 1}/${works.length}] 下载: ${work.workId}`);

                // 下载作品（带重试）
                const result = await this.downloadWithRetry(work, folderPath);
                results.push(result);

                if (result.success) {
                    this.progress.success++;
                    
                    // ✅ 追踪已下载的作品（传递完整结果）
                    this.trackDownloadedWork(work, result, folderPath);
                } else {
                    this.progress.failed++;
                }

                // 通知进度
                if (onProgress) {
                    onProgress({ ...this.progress, results });
                }

                // 如果不是最后一个，添加随机延迟
                if (i < works.length - 1 && !this.shouldStop) {
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
                results
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

        logger.info(`⏱️ 防止封号，等待 ${(delayTime / 1000).toFixed(1)} 秒...`);

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
            const downloadedWorks = [];
            
            // 遍历所有已下载的作品，生成完整记录
            for (const { work, folderPath } of this.downloadBackupTracker.downloadedWorks) {
                // 生成文件路径和类型
                const mediaType = work.isImagePost ? 'image_post' : 'video';
                const filePath = this.generateRelativeFilePath(work, folderPath, mediaType);
                
                // 获取实际文件大小
                let fileSize = 0;
                try {
                    const fileHandle = await this.fileSystem._getFileHandle(filePath, false);
                    const file = await fileHandle.getFile();
                    fileSize = file.size;
                } catch (error) {
                    logger.warn(`⚠️ 获取文件大小失败: ${filePath}`, error.message);
                }
                
                downloadedWorks.push({
                    workId: work.workId,
                    downloadTime: Date.now(),
                    filePath,
                    fileSize,
                    mediaType,
                    quality: 'origin'  // 默认最高画质
                });
            }
            
            // 批量保存到 completed_works 表
            await database.markAsDownloaded(downloadedWorks);
            
            logger.info(`✅ 下载进度已记录: ${downloadedWorks.length} 个作品`);
            
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
     * @param {string} folderPath - 文件夹路径
     * @param {string} mediaType - 媒体类型
     * @returns {string} 相对路径
     */
    generateRelativeFilePath(work, folderPath, mediaType) {
        // 提取相对于根目录的路径
        // folderPath 格式：抖音/深渊龙宝宝(106606479711)
        // 需要追加：视频/7xxx.mp4 或 图集/
        
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
        
        return `${folderPath}/${mediaFolder}/${fileName}`;
    }
}
