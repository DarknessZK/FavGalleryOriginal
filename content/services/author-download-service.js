// ==========================================
// 作者下载服务 - 处理作者作品下载流程
// 职责：下载前关注状态单点取证 + 获取作品、建立关系、启动批量下载
// ==========================================

import { createLogger } from '../../utils/logger.js';
import { platformAPI } from '../../api/platform-adapter.js';
import * as relationManager from '../../data/database/relation-manager.js';
import { database } from '../../data/database/database.js';
import { BatchDownloadManager } from '../../download/batch-download-manager.js';
import { flushOfflineDelta } from '../../data/export/offline-delta.js';
import { markAuthorsUnfollowed } from '../../data/storage/authors-manager.js';
import { FOLLOW_STATE, resolveAuthorDownloadDecision } from '../../utils/follow-verification.js';

const logger = createLogger('AuthorDownloadService');

export class AuthorDownloadService {
    constructor(fileSystem) {
        this.fileSystem = fileSystem;
        this.currentBatchManager = null;
        this.currentBatchId = null;
        // ✅ 缓存已下载作品ID（避免批量下载时重复全表扫描）
        this.cachedDownloadedWorkIds = null;
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
     * ✅ 下载前的关注状态单点校验（取关检测的主责入口）
     *
     * 为何不放在刷新链路：关注清单仍“从新到旧”分页且命中缓存即提前停止，
     * 刷新时只看到清单头部，取消关注的老作者检不出来；按人单点确认则不依赖清单完整性，
     * 且本来每位作者都要拉一次作品清单，多这一发请求是顺路的。
     *
     * @param {string} platformId - 作者 sec_user_id
     * @param {string} uid - 作者 UID
     * @param {string} nickname - 作者昵称（仅日志用）
     * @returns {Promise<Object>} resolveAuthorDownloadDecision 的结果
     * @private
     */
    async _verifyFollowing(platformId, uid, nickname) {
        try {
            const followState = await platformAPI.getAuthorFollowStatus(platformId);
            const decision = resolveAuthorDownloadDecision(followState);
            const label = nickname || uid;

            if (followState === FOLLOW_STATE.UNKNOWN) {
                logger.warn(`❓ [关注校验] ${label}：${decision.reason}`);
            } else {
                logger.info(`🔍 [关注校验] ${label}：follow_status=${followState === FOLLOW_STATE.FOLLOWING ? 1 : 0}，${decision.reason}`);
            }
            return decision;
        } catch (error) {
            // ✅ 校验自身的任何异常都降级为“未知”：既不阻断下载，也绝不打软删除标记
            logger.warn(`⚠️ [关注校验] 异常，按未知处理并照常下载: ${error?.message || error}`);
            return resolveAuthorDownloadDecision(FOLLOW_STATE.UNKNOWN);
        }
    }

    /**
     * ✅ 已确认取关的作者处置：打软删除标记 + 通知 Sidebar + 跳过下载
     * 条目继续保留在列表与 authors 表里，已下载作品与本地文件一律不动
     * @private
     */
    async _handleUnfollowedAuthor(uid, nickname, iframe, batchId, reason) {
        logger.info(`🚫 [关注校验] ${nickname || uid} 已取消关注，跳过作品下载`);

        try {
            await markAuthorsUnfollowed(this.fileSystem, [uid], reason);
        } catch (error) {
            logger.warn(`⚠️ 写入取关标记失败（不影响本次跳过）: ${error?.message || error}`);
        }

        iframe?.contentWindow.postMessage({
            source: 'content',
            type: 'AUTHOR_UNFOLLOWED',
            uid,
            nickname: nickname || '',
            batchId,
            reason
        }, '*');
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
            
            // ✅ 下载前单点取证：明确取关则跳过并标删；状态不可判定时照常下载
            const decision = await this._verifyFollowing(platformId, uid, nickname);
            if (decision.shouldSkip) {
                await this._handleUnfollowedAuthor(uid, nickname, iframe, batchId, decision.reason);
                return;
            }
            
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
            
            // ✅ 从 relations 表获取作者所有作品总数（包括已删除的）
            const allWorkIdsFromRelations = await relationManager.getAuthorWorkIds(uid);
            const workCount = allWorkIdsFromRelations.length;
            logger.info(`📊 relations 表作品总数: ${workCount}`);
            
            // ✅ 使用缓存的已下载作品ID（批量下载时复用）
            if (!this.cachedDownloadedWorkIds) {
                const downloadedIdsArray = await database.getDownloadedWorkIds();
                this.cachedDownloadedWorkIds = new Set(downloadedIdsArray);
                logger.info(`📦 缓存更新: ${downloadedIdsArray.length} 条记录`);
            }
            const downloadedIds = this.cachedDownloadedWorkIds;
            const skippedCount = allWorkIdsFromRelations.filter(id => downloadedIds.has(id)).length;
            
            logger.info(`📊 已下载: ${skippedCount}, 待下载: ${workCount - skippedCount}`);
            
            // ✅ 通知 Sidebar 作者作品总数和跳过数量
            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'AUTHOR_WORKS_COUNT',
                uid: uid,
                count: workCount,
                skippedCount: skippedCount
            }, '*');
            
            // ✅ 如果所有作品都已跳过，直接完成
            if (skippedCount === workCount && workCount > 0) {
                logger.info(`✅ 所有作品已存在，无需下载`);
                
                // ✅ Sidebar 会在 handleAuthorWorksCount 中自动调用 finishAuthorDownload 禁用复选框
                return;
            }
            
            // ✅ 计算待下载的作品ID（从 relations 总数中减去已下载的）
            const pendingWorkIds = allWorkIdsFromRelations.filter(id => !downloadedIds.has(id));
            
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
                stopped: result.stopped  // ✅ 使用实际的停止状态
            }, '*');
            
            // ✅ Sidebar 会在 workCompleted 累积计数后自动调用 finishAuthorDownload 禁用复选框
            
            logger.info(`✅ 作者作品下载完成: 成功 ${result.progress.success}, 失败 ${result.progress.failed}`);
            
            // ✅ 增量刷新：作者下载改变了保存状态/本地媒体/作者下载进度，触发一次增量刷写（只重建受影响分片）。
            //    脏已在 relation-manager(batchAddRelations) 与 database(markAsDownloaded) 处登记，本处仅驱动合并写盘。
            if (result.progress && result.progress.success > 0) {
                flushOfflineDelta()
                    .then(r => { if (r && r.success) logger.info(`♻️ 离线增量刷新完成（作者下载完成）: 重建 ${r.shards} 个分片`); })
                    .catch(e => logger.warn('⚠️ 离线增量刷新异常（作者下载完成）:', e?.message));
            }
            
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

