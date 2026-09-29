// ==========================================
// 单个作品下载器 - 基础原子操作（跨平台通用）
// 职责：协调下载流程（使用 PageDownloader 注入脚本执行实际下载）
// ==========================================

import { createLogger } from '../utils/logger.js';
import { CONFIG } from '../config/constants.js';
import { PageDownloader } from './page-downloader.js';
import { platformAPI } from '../api/platform-adapter.js';
import { sanitizeForFileSystem } from '../utils/helpers.js';
import { planImagePostBackfill, planVideoBackfill } from '../utils/media-integrity.js';

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

            // ✅ 实时获取最新媒体 URL（视频和图集都需要）；详情里的图片列表同时是「逐张核对」的预期清单来源
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

            // ✅ 存在性检查下沉到「单个文件」粒度（第 5 步缺件补下）：先取到预期的文件清单，
            //    再在各分支里逐张/逐文件核对本地已有，只补缺的那几个；整条已完整才跳过
            const isImagePost = workDetail.isImagePost ?? work.isImagePost;
            if (isImagePost) {
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
     * 逐张探测图集已存在的图片序号（1..imageCount 中本地已落盘的 1-based 序号）
     * @param {string} workId
     * @param {number} imageCount - 本轮预期图片张数
     * @param {string} folderPath
     * @param {Object} work - 生成路径的权威对象（必须与保存图片时用的一致，否则核对与落盘错位）
     * @returns {Promise<number[]>} 已存在的序号数组
     * @private
     */
    async _probeExistingImageIndexes(workId, imageCount, folderPath, work) {
        const existing = [];
        for (let i = 1; i <= imageCount; i++) {
            try {
                const p = this.generateImagePath(workId, i, folderPath, work);
                if (await this.fileSystem.fileExists(p)) existing.push(i);
            } catch (error) {
                logger.warn(`⚠️ 探测图集第 ${i} 张存在性失败:`, error);
            }
        }
        return existing;
    }

    /**
     * 下载单个视频（正片与封面逐文件核对，缺封面可单独补）
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

            const hasBitRate = workDetail.video?.bit_rate && workDetail.video.bit_rate.length > 0;
            logger.info(`🎬 画质: ${hasBitRate ? '高清' : '默认'}`);

            const workId = workDetail.workId;
            const resumable = this.config.skipExisting && this.config.enableResume;
            let needVideo = true;
            let needCover = !!coverUrl;

            if (resumable) {
                const videoExists = await this.fileSystem.fileExists(this.generateVideoPath(workId, folderPath, workDetail));
                const coverExists = coverUrl
                    ? await this.fileSystem.fileExists(this.generateCoverPath(workId, folderPath, workDetail))
                    : true;
                const plan = planVideoBackfill({ videoExists, coverExpected: !!coverUrl, coverExists });
                if (plan.isComplete) {
                    logger.info(`⏭️ 视频与封面均完整，跳过: ${workId}`);
                    return {
                        success: true,
                        workId,
                        skipped: true,
                        reason: '文件已存在（逐文件核对完整）',
                        fileSize: 0
                    };
                }
                needVideo = plan.needVideo;
                needCover = plan.needCover;
                if (!needVideo && needCover) logger.info(`🧩 正片已在，仅补封面: ${workId}`);
            }

            // ✅ 注入脚本执行下载（仅补封面时传 coverOnly，不重复拉正片）
            const result = await this.executePageDownload({
                workId,
                videoUrl: needVideo ? videoUrl : '',
                coverUrl: needCover ? (coverUrl || '') : '',
                coverOnly: !needVideo && needCover,
                isImagePost: false
            });

            // ✅ 保存文件到文件系统
            let fileSize = 0;
            let filePath = '';
            if (result.success) {
                const saveResult = await this.saveVideoFiles(result, folderPath, workDetail);
                fileSize = saveResult.fileSize;
                filePath = saveResult.videoPath;  // ✅ 获取视频文件路径
            }

            return {
                success: result.success,
                workId,
                error: result.error,
                fileSize,  // ✅ 返回文件大小
                filePath   // ✅ 返回文件路径（用于数据库记录）
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
     * 下载图集（逐张核对本地已有，只补缺失的图片，沿用原 1-based 序号）
     */
    async downloadImagePost(workDetail, folderPath) {
        try {
            // ✅ 从实时获取的详情中提取下载 URL
            const images = workDetail.images;
            const musicUrl = workDetail.music?.audioUrl;

            if (!images || images.length === 0) {
                throw new Error('作品详情中缺少图片URL');
            }

            // ✅ 提取纯 URL 数组（兼容对象数组和字符串数组）；过滤后的位置即落盘序号来源，逐轮稳定
            const imageUrls = images.map(img => {
                return typeof img === 'object' ? (img.url || '') : img;
            }).filter(url => url);

            if (imageUrls.length === 0) {
                throw new Error('无法提取有效的图片URL');
            }

            logger.info(`📊 提取到 ${imageUrls.length} 个图片URL`);

            const workId = workDetail.workId;
            const resumable = this.config.skipExisting && this.config.enableResume;

            // 默认全量下载（非续传模式）；续传模式下逐张核对只补缺的
            let missingIndexes = imageUrls.map((_, i) => i + 1);
            let needMusic = !!musicUrl;

            if (resumable) {
                const existingIndexes = await this._probeExistingImageIndexes(workId, imageUrls.length, folderPath, workDetail);
                const musicExists = musicUrl
                    ? await this.fileSystem.fileExists(this.generateMusicPath(workId, folderPath, workDetail))
                    : true;
                const plan = planImagePostBackfill({
                    imageCount: imageUrls.length,
                    existingIndexes,
                    musicExpected: !!musicUrl,
                    musicExists
                });
                if (plan.isComplete) {
                    logger.info(`⏭️ 图集逐张核对完整（${imageUrls.length} 张齐全），跳过: ${workId}`);
                    return {
                        success: true,
                        workId,
                        skipped: true,
                        reason: '文件已存在（逐张核对完整）',
                        fileSize: 0
                    };
                }
                missingIndexes = plan.missingIndexes;
                needMusic = plan.needMusic;
                logger.info(`🧩 图集缺件补下：缺 ${missingIndexes.length} 张 [${missingIndexes.join(', ')}]${needMusic ? ' + 音频' : ''}`);
            }

            // ✅ 只下载缺的图片，URL 顺序与 missingIndexes 一一对应（落盘时按原序号写回）
            const subsetUrls = missingIndexes.map(idx => imageUrls[idx - 1]).filter(Boolean);
            if (subsetUrls.length === 0 && !needMusic) {
                return { success: true, workId, skipped: true, reason: '无缺件', fileSize: 0 };
            }

            const result = await this.executePageDownload({
                workId,
                images: subsetUrls,
                musicUrl: needMusic ? (musicUrl || '') : '',
                isImagePost: true
            });

            let fileSize = 0;
            let firstImagePath = '';
            if (result.success) {
                // ✅ 传原序号映射，保证补下的图落回 workId_NN 原位，绝不重排
                const saveResult = await this.saveImagePostFiles(result, folderPath, workDetail, { indexes: missingIndexes });
                fileSize = saveResult.totalSize;
                firstImagePath = saveResult.firstImagePath;
            }

            return {
                success: result.success,
                workId,
                error: result.error,
                fileSize,
                filePath: firstImagePath  // ✅ 图集也回传代表路径（首张实际落盘图）
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
     * @returns {Object} { fileSize, videoPath }
     */
    async saveVideoFiles(result, folderPath, work) {
        try {
            const { videoBlob, coverBlob } = result;
            let fileSize = 0;
            let videoPath = '';

            // ✅ 保存视频文件（Blob）
            if (videoBlob) {
                fileSize = videoBlob.size;  // ✅ 提取文件大小
                videoPath = this.generateVideoPath(work.workId, folderPath, work);
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
            return { fileSize, videoPath };  // ✅ 返回文件大小和路径
        } catch (error) {
            logger.error(`❌ 保存视频文件失败: ${work.workId}`, error);
            throw error;
        }
    }

    /**
     * 保存图集文件
     * @param {Object} result - 页面下载结果
     * @param {string} folderPath
     * @param {Object} work - 路径权威对象
     * @param {Object} [options]
     * @param {number[]} [options.indexes] - 与 imageBlobs 一一对应的原始 1-based 落盘序号（缺件补下用）；
     *        不传则按位置 1..N 全量保存
     * @returns {Object} { totalSize, firstImagePath }
     */
    async saveImagePostFiles(result, folderPath, work, options = {}) {
        try {
            const { imageBlobs, musicBlob } = result;
            const indexes = Array.isArray(options.indexes) ? options.indexes : null;
            let totalSize = 0;
            let firstImagePath = '';

            // ✅ 验证 imageBlobs 类型（仅补音频时允许为空数组，但不能是非法类型）
            if (imageBlobs != null && !Array.isArray(imageBlobs)) {
                throw new Error(`imageBlobs 不是有效数组: ${typeof imageBlobs}`);
            }
            const blobs = Array.isArray(imageBlobs) ? imageBlobs : [];

            logger.info(`📊 收到图集数据: ${blobs.length} 张图片`);

            // ✅ 保存图片（Blob 数组）
            for (let k = 0; k < blobs.length; k++) {
                const blob = blobs[k];

                // ✅ 验证 Blob 数据
                if (!(blob instanceof Blob)) {
                    logger.error(`❌ 第 ${k + 1} 张下载的图不是有效的 Blob 对象`, {
                        type: typeof blob,
                        constructor: blob?.constructor?.name,
                        size: blob?.size
                    });
                    throw new Error(`第 ${k + 1} 张下载的图片数据格式错误`);
                }

                // ✅ 落盘序号：显式映射优先（补下沿用原位），否则按位置 1-based
                const serial = indexes ? indexes[k] : (k + 1);

                totalSize += blob.size;  // ✅ 累加文件大小
                logger.info(`💾 保存第 ${serial} 张图片: ${blob.size} bytes, type: ${blob.type}`);

                const imagePath = this.generateImagePath(work.workId, serial, folderPath, work);

                // ✅ 记录首张实际落盘路径（作为代表）
                if (!firstImagePath) {
                    firstImagePath = imagePath;
                }

                await this.fileSystem.saveBlobFile(imagePath, blob);
                logger.info(`✅ 第 ${serial} 张图片保存成功`);
            }

            // ✅ 保存音频（Blob）
            if (musicBlob) {
                totalSize += musicBlob.size;  // ✅ 累加音乐文件大小
                logger.info(`💾 保存音频: ${musicBlob.size} bytes, type: ${musicBlob.type}`);
                const musicPath = this.generateMusicPath(work.workId, folderPath, work);
                await this.fileSystem.saveBlobFile(musicPath, musicBlob);
                logger.info(`✅ 音频保存成功: ${work.workId}`);
            }

            logger.info(`✅ 图集保存成功: ${work.workId} (${blobs.length} 张图片)`);
            return { totalSize, firstImagePath };  // ✅ 返回总大小和首张落盘路径
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
