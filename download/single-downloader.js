// ==========================================
// 单个作品下载器 - 基础原子操作（跨平台通用）
// 职责：协调下载流程（使用 PageDownloader 注入脚本执行实际下载）
// ==========================================

import { createLogger } from '../utils/logger.js';
import { CONFIG } from '../config/constants.js';
import { PageDownloader } from './page-downloader.js';
import { platformAPI } from '../api/platform-adapter.js';
import { sanitizeForFileSystem } from '../utils/helpers.js';

const logger = createLogger('SingleDownloader');

export class SingleDownloader {
    constructor(fileSystem, customConfig = {}) {
        this.fileSystem = fileSystem;
        
        // ✅ 使用 PageDownloader 执行脚本注入下载
        this.pageDownloader = new PageDownloader();
        
        // ✅ 合并配置：默认配置 + 自定义配置
        this.config = {
            ...CONFIG.DOWNLOAD_CONFIG.single,
            ...customConfig
        };
    }

    /**
     * 下载单个作品（视频或图集）
     * @param {Object} work - 作品基本信息（从 works 表读取）
     * @param {string} work.workId - 作品ID
     * @param {string} work.authorName - 作者名称
     * @param {string} work.desc - 作品描述
     * @param {boolean} work.isImagePost - 是否为图集
     * @param {string} folderPath - 保存路径
     * @returns {Promise<Object>} 下载结果
     */
    async download(work, folderPath) {
        try {
            // ✅ P1: 控制台日志（开发者调试）
            logger.info(`📥 开始下载作品: ${work.workId}`);

            // ✅ 检查是否跳过已存在的文件
            if (this.config.skipExisting) {
                const exists = await this.checkFileExists(work, folderPath);
                if (exists) {
                    logger.info(`⏭️ 跳过已存在: ${work.workId}`);
                    return {
                        success: true,
                        workId: work.workId,
                        skipped: true,
                        reason: '文件已存在',
                        fileSize: 0  // ✅ 跳过时返回 0
                    };
                }
            }

            // ✅ P1: 实时获取最新媒体 URL（视频和图集都需要）
            let workDetail;
            try {
                logger.info(`🔄 正在获取最新媒体链接...`);
                workDetail = await platformAPI.getWorkDetail(work.workId);
                
                if (!workDetail) {
                    throw new Error('获取作品详情失败');
                }
                logger.info(`✅ 已获取最新媒体 URL`);
            } catch (error) {
                logger.error(`❌ 获取最新 URL 失败:`, error);
                throw new Error(`获取下载 URL 失败: ${error.message}`);
            }

            // ✅ 验证必需参数
            if (!workDetail) {
                throw new Error('缺少作品详情数据');
            }

            if (work.isImagePost) {
                return await this.downloadImagePost(workDetail, folderPath);
            } else {
                return await this.downloadVideo(workDetail, folderPath);
            }
        } catch (error) {
            logger.error(`❌ 下载失败: ${work.workId}`, error);
            logger.error(`❌ 错误详情:`, {
                message: error.message,
                stack: error.stack,
                errorType: typeof error,
                isErrorObject: error instanceof Error
            });
            return {
                success: false,
                workId: work.workId,
                error: error.message || String(error),
                fileSize: 0  // ✅ 失败时返回 0
            };
        }
    }

    /**
     * 检查文件是否已存在
     */
    async checkFileExists(work, folderPath) {
        if (!this.config.enableResume) {
            return false;
        }
        
        try {
            if (work.isImagePost) {
                // ✅ 使用新的路径生成方法
                const firstImagePath = this.generateImagePath(work.workId, 1, folderPath, work);
                return await this.fileSystem.fileExists(firstImagePath);
            } else {
                // ✅ 使用新的路径生成方法
                const videoPath = this.generateVideoPath(work.workId, folderPath, work);
                return await this.fileSystem.fileExists(videoPath);
            }
        } catch (error) {
            logger.warn(`⚠️ 检查文件存在性失败:`, error);
            return false;
        }
    }

    /**
     * 下载单个视频
     */
    async downloadVideo(workDetail, folderPath) {
        try {
            // ✅ 从实时获取的详情中提取下载 URL（不持久化，仅用于本次下载）
            const videoUrl = workDetail.video?.play_addr?.url_list?.[0] || 
                            workDetail.video?.bit_rate?.[0]?.play_addr?.url_list?.[0];
            const coverUrl = workDetail.video?.coverUrl;
            
            if (!videoUrl) {
                throw new Error('作品详情中缺少视频URL');
            }

            // ✅ 注入脚本执行下载
            const result = await this.executePageDownload({
                workId: workDetail.workId,
                videoUrl,
                coverUrl: coverUrl || '',
                isImagePost: false
            });

            // ✅ 保存文件到文件系统
            let fileSize = 0;
            if (result.success) {
                fileSize = await this.saveVideoFiles(result, folderPath, workDetail);
            }

            return {
                success: result.success,
                workId: workDetail.workId,
                error: result.error,
                fileSize  // ✅ 返回文件大小
            };
        } catch (error) {
            logger.error(`❌ 视频下载失败: ${workDetail.workId}`, error);
            return {
                success: false,
                workId: workDetail.workId,
                error: error.message
            };
        }
    }

    /**
     * 下载图集（多张图片）
     */
    async downloadImagePost(workDetail, folderPath) {
        try {
            // ✅ 从实时获取的详情中提取下载 URL
            const images = workDetail.images;
            const musicUrl = workDetail.music?.audioUrl;
            
            if (!images || images.length === 0) {
                throw new Error('作品详情中缺少图片URL');
            }

            // ✅ 提取纯 URL 数组（兼容对象数组和字符串数组）
            const imageUrls = images.map(img => {
                // 如果是对象，提取 url 字段；如果已经是字符串，直接返回
                return typeof img === 'object' ? (img.url || '') : img;
            }).filter(url => url); // 过滤掉空字符串

            if (imageUrls.length === 0) {
                throw new Error('无法提取有效的图片URL');
            }

            logger.info(`📊 提取到 ${imageUrls.length} 个图片URL`);
            
            // ✅ 打印第一个 URL 用于调试（不打印全部，避免日志过长）
            if (imageUrls.length > 0) {
                logger.info(`🔍 第一个图片URL: ${imageUrls[0].substring(0, 100)}...`);
            }

            // ✅ 注入脚本执行下载
            const result = await this.executePageDownload({
                workId: workDetail.workId,
                images: imageUrls,  // ✅ 传递纯 URL 数组
                musicUrl: musicUrl || '',
                isImagePost: true
            });

            // ✅ 保存文件到文件系统
            let fileSize = 0;
            if (result.success) {
                fileSize = await this.saveImagePostFiles(result, folderPath, workDetail);
            }

            return {
                success: result.success,
                workId: workDetail.workId,
                error: result.error,
                fileSize  // ✅ 返回文件大小
            };
        } catch (error) {
            logger.error(`❌ 图集下载失败: ${workDetail.workId}`, error);
            return {
                success: false,
                workId: workDetail.workId,
                error: error.message
            };
        }
    }

    /**
     * 在页面上下文中执行下载（委托给 PageDownloader）
     */
    executePageDownload(params) {
        return this.pageDownloader.download(params, this.config.timeout || 300000);
    }

    /**
     * 保存视频文件
     * @returns {number} 文件大小（字节）
     */
    async saveVideoFiles(result, folderPath, work) {
        try {
            const { videoBlob, coverBlob } = result;
            let fileSize = 0;

            // ✅ 保存视频文件（Blob）
            if (videoBlob) {
                fileSize = videoBlob.size;  // ✅ 提取文件大小
                const videoPath = this.generateVideoPath(work.workId, folderPath, work);
                await this.fileSystem.saveBlobFile(videoPath, videoBlob);
                logger.info(`✅ 视频保存成功（Blob）: ${work.workId}`);
            }

            // ✅ 保存封面（Blob）
            if (coverBlob) {
                const coverPath = this.generateCoverPath(work.workId, folderPath, work);
                await this.fileSystem.saveBlobFile(coverPath, coverBlob);
                logger.info(`✅ 封面保存成功: ${work.workId}`);
            }

            logger.info(`✅ 视频保存成功: ${work.workId}`);
            return fileSize;  // ✅ 返回文件大小
        } catch (error) {
            logger.error(`❌ 保存视频文件失败: ${work.workId}`, error);
            throw error;
        }
    }

    /**
     * 保存图集文件
     * @returns {number} 总文件大小（字节）
     */
    async saveImagePostFiles(result, folderPath, work) {
        try {
            const { imageBlobs, musicBlob } = result;
            let totalSize = 0;

            // ✅ 验证 imageBlobs 是否为数组
            if (!imageBlobs || !Array.isArray(imageBlobs)) {
                throw new Error(`imageBlobs 不是有效数组: ${typeof imageBlobs}`);
            }

            logger.info(`📊 收到图集数据: ${imageBlobs.length} 张图片`);
            
            // ✅ 保存图片（Blob 数组）
            for (let i = 0; i < imageBlobs.length; i++) {
                const blob = imageBlobs[i];
                
                // ✅ 验证 Blob 数据
                if (!(blob instanceof Blob)) {
                    logger.error(`❌ 第 ${i + 1} 张图片不是有效的 Blob 对象`, {
                        type: typeof blob,
                        constructor: blob?.constructor?.name,
                        size: blob?.size
                    });
                    throw new Error(`第 ${i + 1} 张图片数据格式错误`);
                }
                
                totalSize += blob.size;  // ✅ 累加文件大小
                logger.info(`💾 保存第 ${i + 1} 张图片: ${blob.size} bytes, type: ${blob.type}`);
                
                const imagePath = this.generateImagePath(
                    work.workId,
                    i + 1,  // index 从 1 开始
                    folderPath,
                    work
                );

                await this.fileSystem.saveBlobFile(imagePath, blob);
                logger.info(`✅ 第 ${i + 1} 张图片保存成功`);
            }

            // ✅ 保存音频（Blob）
            if (musicBlob) {
                totalSize += musicBlob.size;  // ✅ 累加音乐文件大小
                logger.info(`💾 保存音频: ${musicBlob.size} bytes, type: ${musicBlob.type}`);
                const musicPath = this.generateMusicPath(work.workId, folderPath, work);
                await this.fileSystem.saveBlobFile(musicPath, musicBlob);
                logger.info(`✅ 音频保存成功: ${work.workId}`);
            }

            logger.info(`✅ 图集保存成功: ${work.workId} (${imageBlobs.length} 张图片)`);
            return totalSize;  // ✅ 返回总文件大小
        } catch (error) {
            logger.error(`❌ 保存图集文件失败: ${work.workId}`, error);
            throw error;
        }
    }

    /**
     * 生成视频文件路径
     */
    generateVideoPath(workId, folderPath, workDetail) {  // ✅ folderPath: 用户选择的根目录名称
        const platform = CONFIG.ACTIVE_PLATFORM;
        const platformName = CONFIG.PLATFORM_INFO[platform]?.name || platform;
        const authorFolder = this._generateAuthorFolder(workDetail);
        
        const config = CONFIG.DOWNLOAD_CONFIG.fileSystem;
        const videoFolder = config.mediaTypeFolders.video;
        const fileName = config.fileNameFormats.video.replace('{workId}', workId);

        // ✅ 完整路径：平台/作者昵称(uid)/视频/workId.mp4（相对于根目录）
        const fullPath = `${platformName}/${authorFolder}/${videoFolder}/${fileName}`;
        logger.info(`📁 生成视频路径: ${fullPath}`);
        return fullPath;
    }

    /**
     * 生成封面文件路径
     */
    generateCoverPath(workId, folderPath, workDetail) {  // ✅ folderPath: 用户选择的根目录名称
        const platform = CONFIG.ACTIVE_PLATFORM;
        const platformName = CONFIG.PLATFORM_INFO[platform]?.name || platform;
        const authorFolder = this._generateAuthorFolder(workDetail);
        
        const config = CONFIG.DOWNLOAD_CONFIG.fileSystem;
        const coverFolder = config.mediaTypeFolders.cover;
        const fileName = config.fileNameFormats.cover.replace('{workId}', workId);

        // ✅ 完整路径：平台/作者昵称(uid)/封面/workId_cover.jpg（相对于根目录）
        return `${platformName}/${authorFolder}/${coverFolder}/${fileName}`;
    }

    /**
     * 生成图集图片路径
     */
    generateImagePath(workId, index, folderPath, workDetail) {  // ✅ folderPath: 用户选择的根目录名称
        const platform = CONFIG.ACTIVE_PLATFORM;
        const platformName = CONFIG.PLATFORM_INFO[platform]?.name || platform;
        const authorFolder = this._generateAuthorFolder(workDetail);
        
        const config = CONFIG.DOWNLOAD_CONFIG.fileSystem;
        const imagePostFolder = config.mediaTypeFolders.imagePost;
        const paddedIndex = String(index).padStart(2, '0');
        const fileName = config.fileNameFormats.image
            .replace('{workId}', workId)
            .replace('{index}', paddedIndex);

        // ✅ 完整路径：平台/作者昵称(uid)/图集/workId/workId_01.jpg（相对于根目录）
        return `${platformName}/${authorFolder}/${imagePostFolder}/${workId}/${fileName}`;
    }

    /**
     * 生成图集音频路径
     */
    generateMusicPath(workId, folderPath, workDetail) {  // ✅ folderPath: 用户选择的根目录名称
        const platform = CONFIG.ACTIVE_PLATFORM;
        const platformName = CONFIG.PLATFORM_INFO[platform]?.name || platform;
        const authorFolder = this._generateAuthorFolder(workDetail);
        
        const config = CONFIG.DOWNLOAD_CONFIG.fileSystem;
        const imagePostFolder = config.mediaTypeFolders.imagePost;
        const fileName = config.fileNameFormats.music.replace('{workId}', workId);

        // ✅ 完整路径：平台/作者昵称(uid)/图集/workId/workId.mp3（相对于根目录）
        return `${platformName}/${authorFolder}/${imagePostFolder}/${workId}/${fileName}`;
    }

    /**
     * 生成作者文件夹名称
     * @param {Object} workDetail - 作品详情
     * @returns {string} 作者文件夹名称（格式：昵称(uid)）
     * @private
     */
    _generateAuthorFolder(workDetail) {
        const author = workDetail?.author;
        if (!author) {
            return '未知作者';
        }
        
        const nickname = author.nickname || '未知用户';
        const uid = author.uid || author.platformId || 'unknown';
        
        // ✅ 清理昵称中的非法文件名字符（Windows 不允许: < > : " / \ | ? *）
        const safeNickname = sanitizeForFileSystem(nickname);
        
        // ✅ 格式：深渊龙宝宝(106606479711)
        return `${safeNickname}(${uid})`;
    }

    /**
     * 清理资源（防止内存泄漏）
     */
    cleanup() {
        this.pageDownloader.cleanup();
    }
}
