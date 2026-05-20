// ==========================================
// FavGallery - Content Script 主模块
// 职责：注入侧边栏到页面，处理与 UI 的消息通信
// ==========================================

import { createLogger } from '../utils/logger.js';
import { fileSystem } from '../data/storage/file-system.js';
import { dataFetcher } from './services/data-fetcher.js';
import { AuthorDownloadService } from './services/author-download-service.js';
import { SingleDownloader } from '../download/single-downloader.js';
import { backupManager } from '../data/backup/backup-manager.js';
import { database } from '../data/database/database.js';
import * as relationManager from '../data/database/relation-manager.js';
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
        
        // ✅ 作者下载服务
        this.authorDownloadService = new AuthorDownloadService(fileSystem);
        
        // ✅ 文件夹选择状态管理（防止重复调用）
        this.isSelectingFolder = false;
        
        // 从 URL 参数获取 sidebar URL
        const currentScript = document.getElementById('favgallery-script-tag');
        const scriptSrc = currentScript?.src || '';
        const urlParams = new URLSearchParams(scriptSrc.split('?')[1] || '');
        this.sidebarUrl = urlParams.get('sidebar');
        
        logger.info('ContentScript 初始化', { sidebarUrl: this.sidebarUrl });
        
        // ✅ 通知 FileLogger 已选择文件夹（Content Script 环境）
        fileLogger.setFolderSelected(true);
        
        // 注入侧边栏
        this.injectSidebar();
    }

    /**
     * 注入侧边栏到页面
     */
    async injectSidebar() {
        if (this.injected) {
            logger.warn('侧边栏已注入，跳过');
            return;
        }
        
        logger.info('开始注入侧边栏...');
        
        // ✅ 读取用户设置的侧边栏模式
        this.sidebarMode = await this.loadSidebarMode();
        logger.info(`📋 侧边栏模式: ${this.sidebarMode}`);
        
        // ✅ 通过 platformAPI 判断当前是否为主页（跨平台架构）
        const isHomePage = platformAPI.isHomePage();
        this.isCollapsed = !isHomePage;
        
        if (this.isCollapsed) {
            logger.info('📍 当前非主页，侧边栏将以收起状态注入');
        } else {
            logger.info('📍 当前是主页，侧边栏将以展开状态注入');
        }
        
        // 创建容器
        const container = document.createElement('aside');
        container.id = 'favgallery-sidebar';
        
        const sidebarConfig = CONFIG.UI_CONFIG.SIDEBAR;
        const initialWidth = this.isCollapsed ? `${sidebarConfig.COLLAPSED_WIDTH}px` : `${sidebarConfig.WIDTH}px`;
        
        // ✅ 使用配置的样式
        const containerStyles = {
            ...sidebarConfig.CONTAINER_STYLES,
            width: initialWidth,
            zIndex: sidebarConfig.Z_INDEX,
            transition: `all ${sidebarConfig.TRANSITION_DURATION}s ease`
        };
        container.style.cssText = Object.entries(containerStyles)
            .map(([key, value]) => `${key.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}: ${value}`)
            .join('; ');
        
        // 创建 iframe
        const iframe = document.createElement('iframe');
        iframe.src = this.sidebarUrl;
        
        const iframeStyles = {
            ...sidebarConfig.IFRAME_STYLES,
            width: initialWidth
        };
        iframe.style.cssText = Object.entries(iframeStyles)
            .map(([key, value]) => `${key.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}: ${value}`)
            .join('; ');
        
        // 创建切换按钮
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'sidebar-toggle-btn';
        
        const btnLeft = this.isCollapsed ? `${sidebarConfig.COLLAPSED_WIDTH}px` : `${sidebarConfig.WIDTH}px`;
        const btnIcon = this.isCollapsed ? '▶' : '◀';
        const btnTitle = this.isCollapsed ? '展开侧边栏' : '收起侧边栏';
        
        toggleBtn.innerHTML = btnIcon;
        
        // ✅ 使用配置的样式
        const toggleBtnStyles = {
            ...sidebarConfig.TOGGLE_BUTTON_STYLES,
            left: btnLeft,
            zIndex: sidebarConfig.TOGGLE_BTN_Z_INDEX,
            transition: `all ${sidebarConfig.TRANSITION_DURATION}s`
        };
        toggleBtn.style.cssText = Object.entries(toggleBtnStyles)
            .map(([key, value]) => `${key.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}: ${value}`)
            .join('; ');
        toggleBtn.title = btnTitle;
        
        // 添加到页面
        container.appendChild(iframe);
        document.body.appendChild(container);
        document.body.appendChild(toggleBtn);
        
        // 绑定切换事件
        toggleBtn.addEventListener('click', () => {
            this.toggleSidebar(iframe, container, toggleBtn);
        });
        
        // ✅ 根据模式调整页面布局（挤压模式才调整）
        if (this.sidebarMode === 'squeeze') {
            const root = document.querySelector('#root');
            if (root) {
                root.style.marginLeft = initialWidth;
                root.style.transition = `margin-left ${sidebarConfig.TRANSITION_DURATION}s`;
            }
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
            setTimeout(async () => {
                await this.sendUserInfo(iframe);
            }, sidebarConfig.IFRAME_LOAD_DELAY);
        });
    }

    /**
     * 切换侧边栏展开/收起状态
     */
    toggleSidebar(iframe, container, toggleBtn) {
        const root = document.querySelector('#root');

        if (!container || !toggleBtn) return;

        this.isCollapsed = !this.isCollapsed;
        
        const sidebarConfig = CONFIG.UI_CONFIG.SIDEBAR;
        const expandedWidth = `${sidebarConfig.WIDTH}px`;
        const collapsedWidth = `${sidebarConfig.COLLAPSED_WIDTH}px`;

        if (this.isCollapsed) {
            iframe.style.width = collapsedWidth;
            container.style.width = collapsedWidth;
            toggleBtn.style.left = collapsedWidth;
            toggleBtn.innerHTML = '▶';
            toggleBtn.title = '展开侧边栏';
            
            // ✅ 挤压模式才调整页面布局
            if (this.sidebarMode === 'squeeze' && root) {
                root.style.marginLeft = collapsedWidth;
            }
            
            logger.info('✅ 侧边栏已收起');
        } else {
            iframe.style.width = expandedWidth;
            container.style.width = expandedWidth;
            toggleBtn.style.left = expandedWidth;
            toggleBtn.innerHTML = '◀';
            toggleBtn.title = '收起侧边栏';
            
            // ✅ 挤压模式才调整页面布局
            if (this.sidebarMode === 'squeeze' && root) {
                root.style.marginLeft = expandedWidth;
            }
            
            logger.info('✅ 侧边栏已展开');
        }
    }

    /**
     * 处理来自侧边栏的消息
     */
    async handleMessage(event, iframe) {
        if (!event.data || event.data.source !== 'sidebar') return;
        
        switch (event.data.type) {
            case 'GET_USER_INFO':
                await this.sendUserInfo(iframe);
                break;
                
            case 'SELECT_FOLDER':
                this.selectFolder(iframe);
                break;
                
            case 'LOAD_LIKED_WORKS':  // ✅ 改为 LOAD_LIKED_WORKS
                await this._handleLoadLikedWorks(iframe, event.data.maxCount);
                break;
                
            case 'LOAD_LIKED_FROM_CACHE':
                await this._handleLoadLikedFromCache(iframe);
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
            
            // ✅ 处理作者作品下载请求（委托给服务层）
            case 'DOWNLOAD_AUTHOR_WORKS':
                logger.info(`👤 收到作者作品下载请求: UID=${event.data.uid}`);
                await this.authorDownloadService.handleDownload(event.data, iframe);
                break;
            
            // ✅ 处理数据库查询请求
            case 'GET_DOWNLOADED_WORK_IDS':
                logger.info('📊 收到查询已下载作品 ID 请求');
                this.handleGetDownloadedWorkIds(event, iframe);
                break;
            
            // ✅ 处理加载收藏夹列表请求
            case 'LOAD_COLLECTS_LIST':
                logger.info('📋 收到加载收藏夹列表请求');
                await this._handleLoadCollectsList(iframe);
                break;
            
            // ✅ 处理加载关注作者列表请求
            case 'LOAD_FOLLOWING_AUTHORS':
                logger.info('👥 收到加载关注列表请求');
                dataFetcher.setFolderSelected(true);
                await dataFetcher._loadList('following', iframe, { 
                    maxCount: event.data.maxCount || CONFIG.FETCH_CONFIG.LIST_CONFIGS.following.maxCount 
                });
                break;
            
            // ✅ 处理加载收藏夹作品请求
            case 'LOAD_COLLECT_WORKS':
                logger.info(`🎬 收到加载收藏夹作品请求: ${event.data.collectIds.length} 个收藏夹`);
                await this._handleLoadCollectWorks(event.data, iframe);
                break;
            
            // ✅ 处理 Sidebar 日志批量发送
            case 'SIDEBAR_LOG_BATCH':
                const logs = event.data.data; // 数组 [{level, module, message, timestamp}, ...]
                logs.forEach(log => {
                    fileLogger.writeToFile(log.level, log.module, log.message, true); // fromSidebar = true
                });
                break;
            
            // ✅ 查询作者下载状态
            case 'QUERY_AUTHOR_STATUS':
                logger.info(`📊 收到查询作者状态请求: UID=${event.data.uid}`);
                await this.handleQueryAuthorStatus(event.data, iframe);
                break;
            
            // ✅ 处理侧边栏模式切换
            case 'CHANGE_SIDEBAR_MODE':
                logger.info(`🔄 收到侧边栏模式切换请求: ${event.data.mode}`);
                await this.handleChangeSidebarMode(event.data, iframe);
                break;
            
            // ✅ 处理获取侧边栏模式请求
            case 'GET_SIDEBAR_MODE':
                logger.info('📋 收到获取侧边栏模式请求');
                await this.handleGetSidebarMode(iframe);
                break;
                
            default:
                logger.warn('未知消息类型:', event.data.type);
        }
    }

    /**
     * ✅ 处理加载点赞列表
     */
    async _handleLoadLikedWorks(iframe, maxCount) {
        dataFetcher.setFolderSelected(true);
        await dataFetcher._loadList('liked', iframe, { maxCount });
    }

    /**
     * ✅ 处理从缓存加载点赞列表
     */
    async _handleLoadLikedFromCache(iframe) {
        const cacheResult = await dataFetcher.listConfigs.liked.cacheLoad(fileSystem);
        iframe.contentWindow.postMessage({
            source: 'content',
            type: 'LIKED_WORKS_LOADED',
            works: cacheResult.works || [],
            total: (cacheResult.works || []).length
        }, '*');
    }

    /**
     * ✅ 处理加载收藏夹列表（使用配置化方式）
     */
    async _handleLoadCollectsList(iframe) {
        // ✅ 统一处理：收藏夹也需要文件夹（folderRequired: true）
        dataFetcher.setFolderSelected(true);
        await dataFetcher._loadList('collects', iframe, { 
            count: CONFIG.FETCH_CONFIG.LIST_CONFIGS.collects.maxCount 
        });
    }

    /**
     * ✅ 处理加载收藏夹作品
     */
    async _handleLoadCollectWorks(data, iframe) {
        try {
            const { collectIds } = data;
            const allWorksMap = new Map();
            
            // ✅ 先获取所有收藏夹的元数据（包含名称）
            const collectsMetadata = {};
            try {
                const { loadAllCollects } = await import('../data/storage/collects-manager.js');
                const result = await loadAllCollects(fileSystem);
                const allCollects = result.collects || [];
                
                // 构建 collectId -> collectName 映射
                allCollects.forEach(collect => {
                    collectsMetadata[collect.collectId] = collect.collectName;
                });
                logger.info(`📚 已加载 ${Object.keys(collectsMetadata).length} 个收藏夹元数据`);
            } catch (error) {
                logger.warn('⚠️ 加载收藏夹元数据失败:', error.message);
            }
            
            for (let i = 0; i < collectIds.length; i++) {
                const collectId = collectIds[i];
                const collectName = collectsMetadata[collectId] || `收藏夹${collectId.substring(0, 8)}`;
                
                // ✅ 发送开始加载消息（带收藏夹名称）
                iframe.contentWindow.postMessage({
                    source: 'content',
                    type: 'COLLECT_WORKS_PROGRESS',
                    collectId,
                    collectName,
                    current: 0,
                    total: 0,
                    index: i + 1,
                    totalCollects: collectIds.length
                }, '*');
                
                logger.info(`📂 正在加载收藏夹 ${i + 1}/${collectIds.length}: ${collectName} (${collectId})`);
                
                try {
                    const works = await dataFetcher._loadList('bookmarked', iframe, { 
                        collectId,
                        maxCount: CONFIG.FETCH_CONFIG.LIST_CONFIGS.bookmarked.maxCount
                    });
                    
                    if (works && works.length > 0) {
                        works.forEach(work => {
                            allWorksMap.set(work.workId, work);
                        });
                        
                        // ✅ 发送进度更新消息
                        iframe.contentWindow.postMessage({
                            source: 'content',
                            type: 'COLLECT_WORKS_PROGRESS',
                            collectId,
                            collectName,
                            current: works.length,
                            total: works.length,
                            index: i + 1,
                            totalCollects: collectIds.length
                        }, '*');
                        
                        logger.info(`✅ 收藏夹 ${collectName} 加载完成: ${works.length} 个作品，累计 ${allWorksMap.size} 个（去重后）`);
                    }
                } catch (error) {
                    logger.error(`❌ 获取收藏夹 ${collectName} 的作品失败:`, error.message);
                }
            }
            
            const mergedWorks = Array.from(allWorksMap.values());
            logger.info(`✅ 总共获取 ${mergedWorks.length} 个作品（去重后）`);
            
            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'COLLECT_WORKS_LOADED',
                works: mergedWorks,
                total: mergedWorks.length,
                collectIds: collectIds
            }, '*');
        } catch (error) {
            logger.error('❌ 加载收藏夹作品失败:', error);
            
            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'COLLECT_WORKS_ERROR',
                error: error.message
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
            
            // ✅ 优先尝试停止作者下载
            if (this.authorDownloadService.currentBatchId === batchId || 
                this.authorDownloadService.currentBatchId?.startsWith(batchId + '_')) {
                logger.info('⏹️ 停止作者下载');
                this.authorDownloadService.stopDownload();
                return;
            }
            
            // ✅ 否则停止普通批量下载
            if (!this.currentBatchManager) {
                logger.warn('⚠️ 没有正在运行的批量下载任务');
                return;
            }
            
            // ✅ 防御性检查：确保 currentBatchId 不为 null/undefined
            if (!this.currentBatchId) {
                logger.warn(`⚠️ currentBatchId 为空，无法停止`);
                return;
            }
            
            // ✅ 支持前缀匹配（用于作者下载场景）
            const isMatch = this.currentBatchId === batchId || 
                           this.currentBatchId.startsWith(batchId + '_');
            
            if (!isMatch) {
                logger.warn(`⚠️ batchId 不匹配: 期望=${this.currentBatchId}, 收到=${batchId}`);
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
    async sendUserInfo(iframe) {
        try {
            // ✅ 通过 platformAPI 获取用户信息（跨平台架构）
            const userInfo = await platformAPI.getCurrentUser();
            
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
     * 选择文件夹
     */
    async selectFolder(iframe) {
        // ✅ 防止重复调用文件选择器
        if (this.isSelectingFolder) {
            logger.warn('⚠️ 文件选择器已在激活状态，忽略重复请求');
            return;
        }
        
        try {
            this.isSelectingFolder = true;
            logger.info('📁 开始选择文件夹...');
            
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
                
                // ✅ 自动检查并恢复备份
                await this.autoRestoreFromBackup();
                
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
        } finally {
            // ✅ 重置标志位
            this.isSelectingFolder = false;
            logger.info('🔓 文件选择器已释放');
        }
    }
    
    /**
     * ✅ 自动检查并恢复备份
     * 当选择文件夹后，检查 IndexedDB 是否为空，如果为空则从备份恢复
     */
    async autoRestoreFromBackup() {
        try {
            logger.info('🔍 检查 IndexedDB 状态...');
    
            // ✅ 检查 relations 表是否为空（核心关系表）
            const allRelations = await database.getAll('relations');
            const relationsCount = allRelations ? allRelations.length : 0;
    
            // ✅ 检查是否有备份文件
            const { restoreManager } = await import('../data/backup/restore-manager.js');
            const backupFiles = await restoreManager.findBackupFiles('relations');
    
            // ✅ 只有一个判断：IndexedDB为空 AND 有备份文件
            if (relationsCount === 0 && backupFiles && backupFiles.length > 0) {
                logger.info('ℹ️ IndexedDB 为空，开始从备份恢复...');
                this._sendToSidebar({
                    type: 'RESTORE_STARTING',
                    message: '🔄 正在从备份恢复数据...'
                });
    
                // 尝试恢复所有表
                const tablesToRestore = [
                    'works',
                    'authors',
                    'collects',
                    'liked_group',
                    'author_groups',
                    'collect_groups',  // ✅ 新增：收藏夹分组
                    'relations',
                    'completed_works',
                    'settings'  // ✅ 添加 settings 表恢复
                ];
    
                let restoredCount = 0;
                const totalTables = tablesToRestore.length;
    
                for (let i = 0; i < tablesToRestore.length; i++) {
                    const table = tablesToRestore[i];
                    try {
                        const result = await restoreManager.restoreFromBackup(table, { force: true });
                            
                        // ✅ 发送恢复进度消息
                        this._sendToSidebar({
                            type: 'RESTORE_PROGRESS',
                            table: table,
                            restored: result?.restored || 0,
                            current: i + 1,
                            total: totalTables
                        });

                        restoredCount += result.restored;
                        logger.info(`✅ 恢复 ${table}: ${result.restored} 条记录`);

                    } catch (error) {
                        logger.warn(`⚠️ 恢复 ${table} 失败:`, error.message);
                            
                        // ✅ 发送失败进度
                        this._sendToSidebar({
                            type: 'RESTORE_PROGRESS',
                            table: table,
                            restored: 0,
                            current: i + 1,
                            total: totalTables
                        });
                    }
                }
    
                // ✅ 通知侧边栏恢复完成
                this._sendToSidebar({
                    type: 'RESTORE_COMPLETED',
                    success: restoredCount > 0,
                    restoredCount: restoredCount,
                    message: `成功恢复 ${restoredCount} 条记录`
                });

                logger.info(`✅ 自动恢复完成: 共恢复 ${restoredCount} 条记录`);
            }

        } catch (error) {
            logger.error('❌ 自动恢复失败:', error);
                
            // ✅ 通知侧边栏恢复失败
            this._sendToSidebar({
                type: 'RESTORE_COMPLETED',
                success: false,
                restoredCount: 0,
                message: `恢复失败: ${error.message}`
            });
                
            // 不阻断后续流程，继续执行
        }
    }
    
    /**
     * ✅ 发送消息到侧边栏
     */
    _sendToSidebar(data) {
        const iframe = document.querySelector('iframe[src*="sidebar.html"]');
        if (iframe && iframe.contentWindow) {
            logger.info(`📤 发送消息到侧边栏: ${data.type}`);
            iframe.contentWindow.postMessage({
                source: 'content',
                ...data
            }, '*');
        } else {
            logger.warn('⚠️ 未找到侧边栏 iframe，无法发送消息:', data.type);
        }
    }
    
    /**
     * ✅ 处理查询作者下载状态
     */
    async handleQueryAuthorStatus(data, iframe) {
        const { uid } = data;
        
        try {
            // ✅ 直接使用已导入的函数，避免动态导入
            const { getAuthorDownloadStatus } = await import('../data/storage/authors-manager.js');
            
            // 查询状态
            const status = await getAuthorDownloadStatus(fileSystem, uid);
            
            logger.info(`📊 查询作者状态: ${uid}, 状态:`, status);
            
            // 返回结果
            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'AUTHOR_STATUS_RESPONSE',
                uid,
                status: status || null
            }, '*');
        } catch (error) {
            logger.error('❌ 查询作者状态失败:', error);
            
            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'AUTHOR_STATUS_RESPONSE',
                uid,
                status: null
            }, '*');
        }
    }
    
    /**
     * ✅ 加载侧边栏模式设置
     * @returns {Promise<string>} 'hover' | 'squeeze'
     */
    async loadSidebarMode() {
        try {
            const { getSetting } = await import('../data/storage/settings-manager.js');
            const mode = await getSetting('sidebar_mode', 'hover');
            return mode;
        } catch (error) {
            logger.warn('⚠️ 加载侧边栏模式失败，使用默认值 hover:', error.message);
            return 'hover';
        }
    }
    
    /**
     * ✅ 处理侧边栏模式切换
     */
    async handleChangeSidebarMode(data, iframe) {
        const { mode } = data;
        
        try {
            logger.info(`🔄 切换侧边栏模式: ${this.sidebarMode} -> ${mode}`);
            
            // 保存设置
            const { setSetting } = await import('../data/storage/settings-manager.js');
            await setSetting('sidebar_mode', mode);
            
            // 更新内存中的模式
            this.sidebarMode = mode;
            
            // ✅ 重新应用布局
            const root = document.querySelector('#root');
            const sidebarConfig = CONFIG.UI_CONFIG.SIDEBAR;
            const currentWidth = this.isCollapsed ? `${sidebarConfig.COLLAPSED_WIDTH}px` : `${sidebarConfig.WIDTH}px`;
            
            if (mode === 'squeeze') {
                // 挤压模式：调整页面布局
                if (root) {
                    root.style.marginLeft = currentWidth;
                }
            } else {
                // 悬停模式：移除页面布局调整
                if (root) {
                    root.style.marginLeft = '0';
                }
            }
            
            logger.info(`✅ 侧边栏模式已切换为: ${mode}`);
        } catch (error) {
            logger.error('❌ 切换侧边栏模式失败:', error);
        }
    }
    
    /**
     * ✅ 处理获取侧边栏模式请求
     */
    async handleGetSidebarMode(iframe) {
        try {
            const { getSetting } = await import('../data/storage/settings-manager.js');
            const mode = await getSetting('sidebar_mode', 'hover');
            
            logger.info(`📋 返回侧边栏模式: ${mode}`);
            
            // 发送响应到 Sidebar
            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'SIDEBAR_MODE_RESPONSE',
                mode: mode
            }, '*');
        } catch (error) {
            logger.error('❌ 获取侧边栏模式失败:', error);
            
            // 发送默认值
            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'SIDEBAR_MODE_RESPONSE',
                mode: 'hover'
            }, '*');
        }
    }
}

// 启动 Content Script
logger.info('🚀 Content Script 启动...');
window.contentScript = new ContentScript();


