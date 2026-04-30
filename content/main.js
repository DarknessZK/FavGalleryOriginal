// ==========================================
// FavGallery - Content Script 主模块
// 职责：注入侧边栏到页面，处理与 UI 的消息通信
// ==========================================

import { createLogger } from '../utils/logger.js';
import { fileSystem } from '../data/file-system.js';
import { dataFetcher } from './services/data-fetcher.js';
import { SingleDownloader } from '../download/single-downloader.js';
import { backupManager } from '../data/backup-manager.js';
import { database } from '../data/database.js';
import { platformAPI } from '../api/platform-adapter.js';
import { CONFIG } from '../config/constants.js';
import fileLogger from '../utils/file-logger.js';

const logger = createLogger('ContentScript');

class ContentScript {
    constructor() {
        this.isCollapsed = false;
        this.injected = false;
        
        // ✅ 批量下载状态管理
        this.currentBatchManager = null;  // 当前批量下载管理器实例
        this.currentBatchId = null;       // 当前批次ID
        
        // 从 URL 参数获取 sidebar URL
        const currentScript = document.getElementById('favgallery-script-tag');
        const scriptSrc = currentScript?.src || '';
        const urlParams = new URLSearchParams(scriptSrc.split('?')[1] || '');
        this.sidebarUrl = urlParams.get('sidebar');
        
        logger.info('ContentScript 初始化', { sidebarUrl: this.sidebarUrl });
        
        // 注入侧边栏
        this.injectSidebar();
    }

    /**
     * 注入侧边栏到页面
     */
    injectSidebar() {
        if (this.injected) {
            logger.warn('侧边栏已注入，跳过');
            return;
        }
        
        logger.info('开始注入侧边栏...');
        
        // 判断当前是否为主页
        const currentUrl = window.location.href;
        const isHomePage = currentUrl.includes('/jingxuan') || currentUrl.includes('/recommend');
        this.isCollapsed = !isHomePage;
        
        if (this.isCollapsed) {
            logger.info('📍 当前非主页，侧边栏将以收起状态注入');
        } else {
            logger.info('📍 当前是主页，侧边栏将以展开状态注入');
        }
        
        // 创建容器
        const container = document.createElement('aside');
        container.id = 'favgallery-sidebar';
        
        const initialWidth = this.isCollapsed ? '0px' : '420px';
        container.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: ${initialWidth};
            height: 100vh;
            z-index: 999999;
            transition: all 0.3s ease;
        `;
        
        // 创建 iframe
        const iframe = document.createElement('iframe');
        iframe.src = this.sidebarUrl;
        iframe.style.cssText = `
            width: ${initialWidth};
            height: 100vh;
            border: none;
            box-shadow: 2px 0 10px rgba(0,0,0,0.1);
            transition: all 0.3s ease;
        `;
        
        // 创建切换按钮
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'sidebar-toggle-btn';
        
        const btnLeft = this.isCollapsed ? '0px' : '420px';
        const btnIcon = this.isCollapsed ? '▶' : '◀';
        const btnTitle = this.isCollapsed ? '展开侧边栏' : '收起侧边栏';
        
        toggleBtn.innerHTML = btnIcon;
        toggleBtn.style.cssText = `
            position: fixed;
            left: ${btnLeft};
            top: 50%;
            transform: translateY(-50%);
            width: 24px;
            height: 48px;
            background: #fff;
            border: 1px solid #e8e8e8;
            border-left: none;
            border-radius: 0 4px 4px 0;
            cursor: pointer;
            font-size: 12px;
            color: #666;
            box-shadow: 2px 0 4px rgba(0,0,0,0.1);
            z-index: 1000000;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s;
        `;
        toggleBtn.title = btnTitle;
        
        // 添加到页面
        container.appendChild(iframe);
        document.body.appendChild(container);
        document.body.appendChild(toggleBtn);
        
        // 绑定切换事件
        toggleBtn.addEventListener('click', () => {
            this.toggleSidebar(iframe, container, toggleBtn);
        });
        
        // 调整页面布局
        const root = document.querySelector('#root');
        if (root) {
            root.style.marginLeft = initialWidth;
            root.style.transition = 'margin-left 0.3s';
        }
        
        this.injected = true;
        this.iframe = iframe;
        this.container = container;
        this.toggleBtn = toggleBtn;
        
        logger.info('✅ 侧边栏已注入');
        
        // 监听来自 iframe 的消息
        window.addEventListener('message', (event) => {
            this.handleMessage(event, iframe);
        });
        
        // iframe 加载完成后发送用户信息
        iframe.addEventListener('load', () => {
            logger.info('Iframe 加载完成，准备发送用户信息...');
            
            setTimeout(() => {
                this.sendUserInfo(iframe);
            }, 500);
        });
    }

    /**
     * 切换侧边栏展开/收起状态
     */
    toggleSidebar(iframe, container, toggleBtn) {
        const root = document.querySelector('#root');

        if (!container || !toggleBtn || !root) return;

        this.isCollapsed = !this.isCollapsed;

        if (this.isCollapsed) {
            iframe.style.width = '0px';
            container.style.width = '0px';
            toggleBtn.style.left = '0px';
            toggleBtn.innerHTML = '▶';
            toggleBtn.title = '展开侧边栏';
            root.style.marginLeft = '0px';
            logger.info('✅ 侧边栏已收起');
        } else {
            iframe.style.width = '420px';
            container.style.width = '420px';
            toggleBtn.style.left = '420px';
            toggleBtn.innerHTML = '◀';
            toggleBtn.title = '收起侧边栏';
            root.style.marginLeft = '420px';
            logger.info('✅ 侧边栏已展开');
        }
    }

    /**
     * 处理来自侧边栏的消息
     */
    handleMessage(event, iframe) {
        if (!event.data || event.data.source !== 'sidebar') return;
        
        logger.info('[Main] 📨 收到消息:', event.data.type);
        
        switch (event.data.type) {
            case 'GET_USER_INFO':
                logger.info('收到获取用户信息请求');
                this.sendUserInfo(iframe);
                break;
                
            case 'SELECT_FOLDER':
                logger.info('收到文件夹选择请求');
                this.selectFolder(iframe);
                break;
                
            case 'LOAD_LIKED_WORKS':  // ✅ 改为 LOAD_LIKED_WORKS
                logger.info('收到加载点赞列表请求');
                this.loadLikedWorks(iframe, event.data.maxCount);  // ✅ 改为 loadLikedWorks
                break;
                
            case 'LOAD_LIKED_FROM_CACHE':
                logger.info('收到从缓存加载点赞列表请求');
                this.loadLikedWorksFromCache(iframe);  // ✅ 改为 loadLikedWorksFromCache
                break;
            
            // ✅ P0: 处理单个作品下载请求（只传 workId）
            case 'DOWNLOAD_WORK_BY_ID':
                logger.info(`📥 收到下载作品请求: ${event.data.workId}`);
                this.handleDownloadWorkById(event.data, iframe);
                break;
            
            // ✅ 处理批量下载请求
            case 'BATCH_DOWNLOAD_WORKS':
                logger.info(`📥 收到批量下载请求: ${event.data.workIds.length} 个作品`);
                this.handleBatchDownloadWorks(event.data, iframe);
                break;
            
            // ✅ 处理停止批量下载请求
            case 'STOP_BATCH_DOWNLOAD':
                logger.info(`⏹️ 收到停止批量下载请求: ${event.data.batchId}`);
                this.handleStopBatchDownload(event.data, iframe);
                break;
            
            // ✅ 处理数据库查询请求
            case 'GET_DOWNLOADED_WORK_IDS':
                logger.info('📊 收到查询已下载作品 ID 请求');
                this.handleGetDownloadedWorkIds(event, iframe);
                break;
            
            // ✅ 处理 Sidebar 日志批量发送
            case 'SIDEBAR_LOG_BATCH':
                const logs = event.data.data; // 数组 [{level, module, message, timestamp}, ...]
                logs.forEach(log => {
                    fileLogger.writeToFile(log.level, log.module, log.message);
                });
                break;
                
            default:
                logger.warn('未知消息类型:', event.data.type);
        }
    }

    /**
     * 加载点赞作品列表
     */
    async loadLikedWorks(iframe, maxCount) {  // ✅ 改为 loadLikedWorks
        try {
            // 通知 dataFetcher 文件夹已选择
            dataFetcher.setFolderSelected(true);
            
            // 调用 dataFetcher 加载点赞列表
            await dataFetcher.loadLikedWorks(iframe, maxCount);  // ✅ 改为 loadLikedWorks
        } catch (error) {
            logger.error('❌ 加载点赞列表失败:', error);
            
            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'LIKED_WORKS_ERROR',  // ✅ 改为 LIKED_WORKS_ERROR
                error: error.message
            }, '*');
        }
    }

    /**
     * 从缓存加载点赞作品列表
     */
    async loadLikedWorksFromCache(iframe) {  // ✅ 改为 loadLikedWorksFromCache
        try {
            await dataFetcher.loadLikedWorksFromStorage(iframe);  // ✅ 改为 loadLikedWorksFromStorage
        } catch (error) {
            logger.error('❌ 从缓存加载点赞列表失败:', error);
            
            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'LIKED_WORKS_ERROR',  // ✅ 改为 LIKED_WORKS_ERROR
                error: error.message
            }, '*');
        }
    }
    
    /**
     * ✅ P0: 处理单个作品下载（在 Content Script 中执行，只传 workId）
     */
    async handleDownloadWorkById(data, iframe) {
        const { workId, folderPath } = data;
        
        // ✅ P1: 设置 5 分钟超时
        let timeoutId = null;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error('下载超时（5分钟）'));
            }, 300000); // 5 分钟
        });
        
        try {
            logger.info(`📥 开始下载作品: ${workId}`);
            
            // ✅ 实时获取作品详情（包括最新下载链接）
            logger.info(`🔄 正在获取作品详情: ${workId}`);
            const workDetail = await platformAPI.getWorkDetail(workId);
            
            if (!workDetail) {
                throw new Error('获取作品详情失败');
            }
            
            logger.info(`✅ 已获取作品详情: ${workDetail.workId}`);
            
            // ✅ 创建 SingleDownloader 实例（使用 Content Script 的 fileSystem）
            const downloader = new SingleDownloader(fileSystem);
            
            // ✅ 执行下载（带超时）
            const result = await Promise.race([
                downloader.download(workDetail, folderPath),
                timeoutPromise
            ]);
            
            // ✅ 清除超时定时器
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            
            // ✅ 通知 Sidebar 下载结果
            if (result.success) {
                logger.info(`✅ 下载成功: ${workId}`);
                
                // ✅ 立即通知 Sidebar，不等待保存和备份
                iframe.contentWindow.postMessage({
                    source: 'content',
                    type: 'DOWNLOAD_SUCCESS',
                    workId: workId,
                    result: result
                }, '*');
                
                // ✅ 异步保存到数据库并备份（不阻塞 UI）
                const mediaType = workDetail.isImagePost ? 'image_post' : 'video';
                
                // ✅ 生成文件路径（使用 SingleDownloader 的路径生成逻辑）
                const platform = CONFIG.ACTIVE_PLATFORM;
                const platformName = CONFIG.PLATFORM_INFO[platform]?.name || platform;
                const author = workDetail.author;
                let authorFolder = '未知作者';
                if (author) {
                    const nickname = author.nickname || '未知用户';
                    const uid = author.uid || author.platformId || 'unknown';
                    const safeNickname = nickname.replace(/[<>:"/\\|?*]/g, '_');
                    authorFolder = `${safeNickname}(${uid})`;
                }
                
                const config = CONFIG.DOWNLOAD_CONFIG.fileSystem;
                const mediaFolder = mediaType === 'video' ? config.mediaTypeFolders.video : config.mediaTypeFolders.imagePost;
                const fileNameFormat = mediaType === 'video' ? config.fileNameFormats.video : config.fileNameFormats.image;
                
                let fileName;
                if (mediaType === 'video') {
                    fileName = fileNameFormat.replace('{workId}', workId);
                } else {
                    fileName = fileNameFormat.replace('{workId}', workId).replace('{index}', '01');
                }
                
                const filePath = `${platformName}/${authorFolder}/${mediaFolder}/${fileName}`;
                
                const record = {
                    workId: workId,
                    downloadTime: Date.now(),
                    filePath,
                    fileSize: result.fileSize || 0,
                    mediaType,
                    quality: 'origin'
                };
                
                // 使用 setTimeout 将保存操作放到下一个事件循环
                setTimeout(async () => {
                    try {
                        await database.markAsDownloaded(record);  // ✅ 统一使用 markAsDownloaded()
                        logger.info(`💾 已记录到数据库: ${workId}`);
                        
                        // ✅ 触发备份
                        await backupManager.performSelectiveBackup(['completed_works']);
                        logger.info('✅ 下载状态已备份到文件系统');
                    } catch (error) {
                        logger.error(`❌ 保存或备份失败: ${workId}`, error);
                    }
                }, 0);
            } else {
                logger.error(`❌ 下载失败: ${workId}`, result.error);
                iframe.contentWindow.postMessage({
                    source: 'content',
                    type: 'DOWNLOAD_FAILED',
                    workId: workId,
                    error: result.error
                }, '*');
            }
        } catch (error) {
            // ✅ 清除超时定时器
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            
            logger.error(`❌ 下载异常: ${workId}`, error);
            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'DOWNLOAD_FAILED',
                workId: workId,
                error: error.message || '未知错误'
            }, '*');
        }
    }

    /**
     * ✅ 处理查询已下载作品 ID 请求
     */
    async handleGetDownloadedWorkIds(event, iframe) {
        const { messageId } = event.data;
        
        try {
            logger.info('📊 开始查询已下载作品 ID...');
            
            // 查询 Content Script 的数据库
            const ids = await database.getDownloadedWorkIds();
            
            logger.info(`✅ 查询成功: ${ids.length} 个已下载作品`);
            
            // 发送响应
            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'DB_RESPONSE_GET_DOWNLOADED_WORK_IDS',
                messageId,
                success: true,
                data: ids
            }, '*');
        } catch (error) {
            logger.error('❌ 查询已下载作品 ID 失败:', error);
            
            // 发送错误响应
            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'DB_RESPONSE_GET_DOWNLOADED_WORK_IDS',
                messageId,
                success: false,
                error: error.message || '未知错误'
            }, '*');
        }
    }

    /**
     * ✅ 处理批量下载请求
     */
    async handleBatchDownloadWorks(data, iframe) {
        const { workIds, folderPath, batchId } = data;
        
        try {
            logger.info(`🚀 开始批量下载: ${workIds.length} 个作品, batchId: ${batchId}`);
            
            // ✅ 检查前置条件
            if (!fileSystem.rootDirectoryHandle) {
                throw new Error('未设置根目录句柄，请先选择文件夹');
            }
            
            if (workIds.length === 0) {
                throw new Error('作品列表为空');
            }
            
            // ✅ 动态导入 BatchDownloadManager
            const { BatchDownloadManager } = await import('../download/batch-download-manager.js');
            
            // ✅ 创建 BatchDownloadManager 实例（使用 Content Script 的 fileSystem）
            const batchManager = new BatchDownloadManager(fileSystem);
            
            // ✅ 保存实例引用，以便支持停止功能
            this.currentBatchManager = batchManager;
            this.currentBatchId = batchId;
            
            // ✅ 执行批量下载
            const result = await batchManager.startWithIds(
                batchId,
                workIds,
                folderPath,
                (progress, lastResult) => {
                    // ✅ 检查是否是 ITEM_START 事件
                    if (lastResult && lastResult.type === 'ITEM_START') {
                        // 发送开始下载消息
                        iframe.contentWindow.postMessage({
                            source: 'content',
                            type: 'BATCH_DOWNLOAD_ITEM_START',  // ✅ 新增消息类型
                            batchId: batchId,
                            workId: lastResult.workId
                        }, '*');
                        return;  // ✅ 不发送进度消息
                    }
                    
                    // ✅ 处理 UI_LOG 消息
                    if (lastResult && lastResult.type === 'UI_LOG') {
                        iframe.contentWindow.postMessage({
                            source: 'content',
                            type: 'UI_LOG',
                            level: lastResult.level,
                            message: lastResult.message
                        }, '*');
                        return;  // ✅ 不发送进度消息
                    }
                    
                    // ✅ 发送进度消息到 Sidebar
                    iframe.contentWindow.postMessage({
                        source: 'content',
                        type: 'BATCH_DOWNLOAD_PROGRESS',
                        batchId: batchId,
                        progress: progress
                    }, '*');
                    
                    // ✅ 发送单个作品的下载结果（用于更新 UI）
                    if (lastResult) {
                        if (lastResult.success) {
                            iframe.contentWindow.postMessage({
                                source: 'content',
                                type: 'DOWNLOAD_SUCCESS',
                                workId: lastResult.workId,
                                result: lastResult
                            }, '*');
                        } else {
                            iframe.contentWindow.postMessage({
                                source: 'content',
                                type: 'DOWNLOAD_FAILED',
                                workId: lastResult.workId,
                                error: lastResult.error
                            }, '*');
                        }
                    }
                }
            );
            
            // ✅ 发送完成消息
            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'BATCH_DOWNLOAD_COMPLETE',
                batchId: batchId,
                result: result
            }, '*');
            
            logger.info(`✅ 批量下载完成: 成功 ${result.progress.success}, 失败 ${result.progress.failed}`);
            
            // ✅ 清理引用
            this.currentBatchManager = null;
            this.currentBatchId = null;
            
        } catch (error) {
            logger.error('❌ 批量下载异常:', error);
            
            // ✅ 发送错误消息
            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'BATCH_DOWNLOAD_ERROR',
                batchId: batchId,
                error: error.message || '未知错误'
            }, '*');
            
            // ✅ 清理引用
            this.currentBatchManager = null;
            this.currentBatchId = null;
        }
    }

    /**
     * ✅ 处理停止批量下载请求
     */
    handleStopBatchDownload(data, iframe) {
        const { batchId } = data;
        
        try {
            logger.info(`⏹️ 停止批量下载: ${batchId}`);
            
            // ✅ 检查是否有正在运行的批量下载
            if (!this.currentBatchManager || this.currentBatchId !== batchId) {
                logger.warn('⚠️ 没有匹配的批量下载任务');
                return;
            }
            
            // ✅ 调用 stop 方法
            this.currentBatchManager.stop();
            
            logger.info('✅ 停止请求已发送');
            
        } catch (error) {
            logger.error('❌ 停止批量下载失败:', error);
        }
    }

    /**
     * 发送用户信息到侧边栏
     */
    sendUserInfo(iframe) {
        try {
            // 从页面中获取用户信息
            const userInfo = this.getUserInfoFromPage();
            
            if (userInfo) {
                iframe.contentWindow.postMessage({
                    source: 'content',
                    type: 'USER_INFO',
                    data: userInfo
                }, '*');
                
                logger.info('✅ 用户信息已发送', userInfo.nickname);
            } else {
                logger.warn('⚠️ 未检测到用户信息，可能未登录');
                
                iframe.contentWindow.postMessage({
                    source: 'content',
                    type: 'USER_INFO',
                    data: null
                }, '*');
            }
        } catch (error) {
            logger.error('❌ 发送用户信息失败:', error);
        }
    }

    /**
     * 从页面获取用户信息
     */
    getUserInfoFromPage() {
        try {
            logger.info('=== 开始获取用户信息 ===');
            
            let userInfo = null;
            let successMethod = null;
            const errors = []; // 记录每个方法的错误
            
            // 方法 1：从 __INITIAL_STATE__ 获取
            if (window.__INITIAL_STATE__) {
                try {
                    const state = window.__INITIAL_STATE__;
                    
                    if (state.user?.info) {
                        userInfo = state.user.info;
                        successMethod = '方法 1: __INITIAL_STATE__.user.info';
                    } else if (state.user) {
                        userInfo = state.user;
                        successMethod = '方法 1: __INITIAL_STATE__.user';
                    }
                } catch (e) {
                    errors.push({ method: '方法 1', error: e.message });
                }
            }
            
            // 方法 2：从 RENDER_DATA script 标签获取
            if (!userInfo) {
                try {
                    const el = document.getElementById('RENDER_DATA');
                    if (el) {
                        const text = el.innerText || el.textContent || '';
                        if (text) {
                            const data = JSON.parse(decodeURIComponent(text));
                            
                            if (data.app?.user?.info) {
                                userInfo = data.app.user.info;
                                successMethod = '方法 2: RENDER_DATA.app.user.info';
                            } else if (data[1]?.user?.info) {
                                userInfo = data[1].user.info;
                                successMethod = '方法 2: RENDER_DATA[1].user.info';
                            } else if (data.app?.user) {
                                userInfo = data.app.user;
                                successMethod = '方法 2: RENDER_DATA.app.user';
                            } else if (data[1]?.user) {
                                userInfo = data[1].user;
                                successMethod = '方法 2: RENDER_DATA[1].user';
                            }
                        }
                    }
                } catch (e) {
                    errors.push({ method: '方法 2', error: e.message });
                }
            }
            
            // 方法 3：从 SSR_RENDER_DATA_DOC 获取
            if (!userInfo && window.SSR_RENDER_DATA_DOC) {
                try {
                    const data = window.SSR_RENDER_DATA_DOC;
                    
                    if (data.app?.user?.info) {
                        userInfo = data.app.user.info;
                        successMethod = '方法 3: SSR_RENDER_DATA_DOC.app.user.info';
                    } else if (data[1]?.user?.info) {
                        userInfo = data[1].user.info;
                        successMethod = '方法 3: SSR_RENDER_DATA_DOC[1].user.info';
                    } else if (data.app?.user) {
                        userInfo = data.app.user;
                        successMethod = '方法 3: SSR_RENDER_DATA_DOC.app.user';
                    }
                } catch (e) {
                    errors.push({ method: '方法 3', error: e.message });
                }
            }
            
            // 方法 4：备用 - 从 API 获取
            if (!userInfo) {
                try {
                    // TODO: 实现 API 请求（需要 platformAPI）
                    // const apiUserInfo = await this.fetchUserInfoFromAPI();
                    // if (apiUserInfo) {
                    //     userInfo = apiUserInfo;
                    //     successMethod = '方法 4: API 请求';
                    // }
                    
                    errors.push({ method: '方法 4', error: '暂未实现' });
                } catch (e) {
                    errors.push({ method: '方法 4', error: e.message });
                }
            }
            
            // 处理获取到的用户信息
            if (userInfo && userInfo.uid) {
                // 提取收藏数（从 userCollectCount.collectCountList 中获取）
                let collectCount = 0;
                if (userInfo.userCollectCount?.collectCountList?.length > 0) {
                    const firstItem = userInfo.userCollectCount.collectCountList[0];
                    collectCount = firstItem.count || firstItem.collectCount || firstItem.num || 0;
                }
                
                const result = {
                    uid: userInfo.uid,
                    platformId: userInfo.platformId || userInfo.sec_uid || '',  // ✅ 改为 platformId
                    uniqueId: userInfo.uniqueId || userInfo.unique_id || userInfo.shortId || userInfo.short_id || '',
                    nickname: userInfo.nickname || userInfo.nickName || '未知用户',
                    favoritingCount: userInfo.favoritingCount || userInfo.favoriting_count || 0,
                    followingCount: userInfo.followingCount || userInfo.following_count || 0,
                    collectCount: collectCount
                };
                
                logger.info(`✅ 用户信息获取成功 (${successMethod}):`, result.nickname, {
                    uid: result.uid,
                    followingCount: result.followingCount,
                    favoritingCount: result.favoritingCount,
                    collectCount: result.collectCount
                });
                
                return result;
            } else {
                // ❌ 所有方法都失败了，输出详细错误信息
                logger.error('❌ 所有方法均未获取到用户信息');
                logger.error('=== 各方法失败原因 ===');
                errors.forEach((err, index) => {
                    logger.error(`  ${index + 1}. ${err.method}: ${err.error}`);
                });
                logger.error('=====================');
                logger.error('💡 提示：请确保已登录抖音，并检查页面结构是否变化');
                
                return null;
            }
        } catch (error) {
            logger.error('获取用户信息时发生未预期的错误:', error);
            return null;
        }
    }

    /**
     * 选择文件夹
     */
    async selectFolder(iframe) {
        try {
            // 使用 File System Access API
            if ('showDirectoryPicker' in window) {
                // ✅ 浏览器通过 id 参数自动记忆上次选择的目录
                const dirHandle = await window.showDirectoryPicker({
                    id: 'favgallery-root-directory',  // 浏览器会自动记忆
                    mode: 'readwrite',
                    startIn: 'downloads'
                });
                
                // ✅ 初始化文件系统（包括日志系统）
                fileSystem.setRootDirectory(dirHandle);
                await fileSystem.init();
                logger.info('✅ 文件系统已初始化');
                
                // 通知 dataFetcher 文件夹已选择
                dataFetcher.setFolderSelected(true);
                
                // 通知侧边栏
                iframe.contentWindow.postMessage({
                    source: 'content',
                    type: 'FOLDER_SELECTED',
                    success: true,
                    path: dirHandle.name
                }, '*');
                
                logger.info('✅ 文件夹选择成功:', dirHandle.name);
            } else {
                // 浏览器不支持
                iframe.contentWindow.postMessage({
                    source: 'content',
                    type: 'FOLDER_SELECTED',
                    success: false,
                    error: '浏览器不支持文件夹选择功能'
                }, '*');
                
                logger.error('❌ 浏览器不支持 showDirectoryPicker');
            }
        } catch (error) {
            // ✅ 区分用户取消和真正的错误
            if (error.name === 'AbortError') {
                // 用户点击了取消按钮，这是正常行为，不记录为错误
                logger.info('ℹ️ 用户取消了文件夹选择');
            } else {
                // 真正的错误
                logger.error('❌ 文件夹选择失败:', error.message);
                
                iframe.contentWindow.postMessage({
                    source: 'content',
                    type: 'FOLDER_SELECTED',
                    success: false,
                    error: error.message
                }, '*');
            }
        }
    }
}

// 启动 Content Script
logger.info('🚀 Content Script 启动...');
window.contentScript = new ContentScript();


