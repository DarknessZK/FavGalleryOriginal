// ==========================================
// 作者下载服务 - 处理作者作品下载流程
// 职责：获取作品、建立关系、启动批量下载
// ==========================================

import { createLogger } from '../../utils/logger.js';
import { platformAPI } from '../../api/platform-adapter.js';
import * as relationManager from '../../data/database/relation-manager.js';
import { database } from '../../data/database/database.js';
import { BatchDownloadManager } from '../../download/batch-download-manager.js';

const logger = createLogger('AuthorDownloadService');

export class AuthorDownloadService {
    constructor(fileSystem) {
        this.fileSystem = fileSystem;
        this.currentBatchManager = null;
        this.currentBatchId = null;
    }

    /**
     * ✅ 停止作者下载
     */
    stopDownload() {
        if (this.currentBatchManager) {
            logger.info('⏹️ 停止作者作品下载');
            this.currentBatchManager.stop();
        } else {
            logger.warn('⚠️ 没有正在运行的作者下载任务');
        }
    }

    /**
     * ✅ 处理作者作品下载
     * @param {Object} data - 下载参数
     * @param {HTMLIFrameElement} iframe - 通信目标
     */
    async handleDownload(data, iframe) {
        const { uid, platformId, nickname, folderPath, batchId } = data;
        
        try {
            // ✅ 立即设置 batchId（防止在等待 API 时用户点击停止）
            this.currentBatchId = batchId;
            
            logger.info(`👤 开始获取作者 ${nickname || uid} 的所有作品...`);
            
            // 1. 调用 API 获取作者所有作品
            logger.info(`🔍 开始获取作者作品: platformId=${platformId}`);
            const works = await platformAPI.getAuthorWorksForDownload(platformId);
            logger.info(`📊 API 返回作品数量: ${works?.length || 0}`);
            /*if (works && works.length > 0) {
                logger.debug(`🔍 第一个作品结构:`, JSON.stringify(works[0], null, 2));
            }*/
            
            if (!works || works.length === 0) {
                logger.warn(`⚠️ 作者 ${nickname} 没有作品`);
                
                // 发送错误消息（复用 BATCH_DOWNLOAD_ERROR）
                iframe.contentWindow.postMessage({
                    source: 'content',
                    type: 'BATCH_DOWNLOAD_ERROR',
                    batchId: batchId,
                    error: '该作者没有作品或获取失败'
                }, '*');
                
                return;
            }
            
            logger.info(`✅ 获取到 ${works.length} 个作品`);
            
            // ✅ 批量建立 work→author 关系
            const baseTime = Date.now();
            const relations = works.map((work, index) => ({
                sourceType: 'work',
                sourceId: work.workId,
                targetType: 'author',
                targetId: work.author?.uid || uid,
                createdAt: baseTime - (index * 1)  // ✅ 递减时间戳，确保唯一
            }));
            
            try {
                if (relations.length > 0) {
                    await relationManager.batchAddRelations(relations);
                    logger.info(`✅ 已建立 ${relations.length} 个 work→author 关系`);
                }
                
                // ✅ 批量记录 works 表
                const worksItems = works.map(work => ({
                    ...work,
                    isDeleted: false
                }));
                
                if (worksItems.length > 0) {
                    await database.save('works', worksItems);
                    logger.info(`✅ 已保存 ${worksItems.length} 个作品到 works 表`);
                }
            } catch (error) {
                logger.error('❌ 建立关系或保存作品失败:', error);
                // 不中断下载流程，继续执行
            }
            
            // 2. 提取作品 ID 列表
            const workIds = works.map(w => w.workId);
            
            // ✅ 查询已下载的作品ID，过滤掉已完成的（断点续传）
            const downloadedIdsArray = await database.getDownloadedWorkIds();
            logger.info(`📊 已下载的作品ID:`, downloadedIdsArray);
            logger.info(`📊 所有作品ID:`, workIds);
            
            const downloadedIds = new Set(downloadedIdsArray);  // ✅ 转换为 Set
            const pendingWorkIds = workIds.filter(id => !downloadedIds.has(id));
            
            logger.info(`📊 过滤后的作品ID:`, pendingWorkIds);
            
            // ✅ 日志提示
            const skippedCount = workIds.length - pendingWorkIds.length;
            if (skippedCount > 0) {
                logger.info(`✅ 共 ${workIds.length} 个作品，${skippedCount} 个已完成，开始下载 ${pendingWorkIds.length} 个`);
            } else {
                logger.info(`✅ 开始下载 ${pendingWorkIds.length} 个作品`);
            }
            
            // ✅ 通知 Sidebar 作者作品总数和跳过数量
            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'AUTHOR_WORKS_COUNT',
                uid: uid,
                count: workIds.length,
                skippedCount: skippedCount
            }, '*');
            
            // ✅ 如果所有作品都已跳过，直接完成
            if (pendingWorkIds.length === 0) {
                logger.info(`✅ 所有作品已存在，无需下载`);
                
                // ✅ Sidebar 会在 handleAuthorWorksCount 中自动调用 finishAuthorDownload 禁用复选框
                return;
            }
            
            // 3. 复用现有的批量下载逻辑
            logger.info(`🚀 开始批量下载: ${pendingWorkIds.length} 个作品`);
            
            // 创建 BatchDownloadManager 实例
            const batchManager = new BatchDownloadManager(this.fileSystem);
            
            // 保存实例引用
            this.currentBatchManager = batchManager;
            this.currentBatchId = batchId;
            
            // 执行批量下载（使用过滤后的列表）
            const result = await batchManager.startWithIds(
                batchId,
                pendingWorkIds,  // ✅ 使用过滤后的作品ID列表
                folderPath,
                (progress, lastResult) => {
                    // 处理 ITEM_START 事件
                    if (lastResult && lastResult.type === 'ITEM_START') {
                        iframe.contentWindow.postMessage({
                            source: 'content',
                            type: 'BATCH_DOWNLOAD_ITEM_START',
                            batchId: batchId,
                            workId: lastResult.workId
                        }, '*');
                        return;
                    }
                    
                    // 处理 UI_LOG 消息
                    if (lastResult && lastResult.type === 'UI_LOG') {
                        iframe.contentWindow.postMessage({
                            source: 'content',
                            type: 'UI_LOG',
                            level: lastResult.level,
                            message: lastResult.message
                        }, '*');
                        return;
                    }
                    
                    // 发送进度消息
                    iframe.contentWindow.postMessage({
                        source: 'content',
                        type: 'BATCH_DOWNLOAD_PROGRESS',
                        batchId: batchId,
                        progress: progress
                    }, '*');
                    
                    // 发送单个作品的下载结果
                    if (lastResult) {
                        if (lastResult.success) {
                            // ✅ 发送成功消息
                            iframe.contentWindow.postMessage({
                                source: 'content',
                                type: 'DOWNLOAD_SUCCESS',
                                workId: lastResult.workId,
                                result: lastResult
                            }, '*');
                            
                            // ✅ 发送作者作品进度消息（新增）
                            iframe.contentWindow.postMessage({
                                source: 'content',
                                type: 'AUTHOR_WORK_PROGRESS',
                                uid: uid,
                                success: true
                            }, '*');
                        } else {
                            // ✅ 发送失败消息
                            iframe.contentWindow.postMessage({
                                source: 'content',
                                type: 'DOWNLOAD_FAILED',
                                workId: lastResult.workId,
                                error: lastResult.error
                            }, '*');
                            
                            // ✅ 发送作者作品进度消息（新增）
                            iframe.contentWindow.postMessage({
                                source: 'content',
                                type: 'AUTHOR_WORK_PROGRESS',
                                uid: uid,
                                success: false
                            }, '*');
                        }
                    }
                }
            );
            
            // 发送完成消息
            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'BATCH_DOWNLOAD_COMPLETE',
                batchId: batchId,
                result: result,
                stopped: false  // ✅ 区分正常完成和被停止
            }, '*');
            
            // ✅ Sidebar 会在 workCompleted 累积计数后自动调用 finishAuthorDownload 禁用复选框
            
            logger.info(`✅ 作者作品下载完成: 成功 ${result.progress.success}, 失败 ${result.progress.failed}`);
            
            // 清理引用
            this.currentBatchManager = null;
            this.currentBatchId = null;
            
        } catch (error) {
            logger.error(`❌ 作者作品下载异常: ${uid}`, error);
            
            // 发送错误消息
            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'BATCH_DOWNLOAD_ERROR',
                batchId: batchId,
                error: error.message || '未知错误'
            }, '*');
            
            // 清理引用
            this.currentBatchManager = null;
            this.currentBatchId = null;
        }
    }
}

