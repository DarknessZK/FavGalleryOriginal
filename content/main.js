// ==========================================
// FavGallery - Content Script 主模块
// 职责：消息路由分发 + 主流程协调（文件夹选择/备份恢复/批量下载/用户信息）
// 已拆出：侧边栏注入 → services/sidebar-injector.js，收藏夹作品加载 → services/collect-works-loader.js
// ==========================================

import { createLogger } from '../utils/logger.js';
import { fileSystem } from '../data/storage/file-system.js';
import { dataFetcher } from './services/data-fetcher.js';
import { SidebarInjector } from './services/sidebar-injector.js';
import { collectWorksLoader } from './services/collect-works-loader.js';
import { authorWorksLoader } from './services/author-works-loader.js';
import { AuthorDownloadService } from './services/author-download-service.js';
import { database } from '../data/database/database.js';
import { platformAPI } from '../api/platform-adapter.js';
import { CONFIG } from '../config/constants.js';
import { userConfig } from '../config/user-config.js';
import { generateOfflineData } from '../data/export/offline-data-generator.js';
import { generateStaticShell } from '../data/export/offline-shell-generator.js';
import { installErrorBoundary } from '../utils/error-boundary.js';
import fileLogger from '../utils/file-logger.js';

const logger = createLogger('ContentScript');

class ContentScript {
    constructor() {
        
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
        
        // ✅ 扩展源（chrome-extension://<id>）：main world 无 chrome.runtime，
        //    由 index.js 通过 script src 的 ext_id 参数传入，供静态壳生成器 fetch 扩展资源
        const extId = urlParams.get('ext_id');
        this.extensionOrigin = extId
            ? `chrome-extension://${extId}`
            : (this.sidebarUrl ? new URL(this.sidebarUrl).origin : '');
        
        logger.info('ContentScript 初始化', { sidebarUrl: this.sidebarUrl });
        
        // ✅ 通知 FileLogger 已选择文件夹（Content Script 环境）
        fileLogger.setFolderSelected(true);
        
        // ✅ 注入侧边栏（DOM 创建/展开收起/显示模式由 SidebarInjector 负责）
        this.injector = new SidebarInjector({
            sidebarUrl: this.sidebarUrl,
            onIframeLoad: (iframe) => this.sendUserInfo(iframe)
        });
        this._injectSidebar();
    }

    /**
     * 注入侧边栏并挂载消息监听（DOM 创建/展开收起/显示模式已拆至 services/sidebar-injector.js）
     */
    async _injectSidebar() {
        await this.injector.inject();
        
        // 监听来自 iframe 的消息（时机与原实现一致：注入完成后注册）
        window.addEventListener('message', (event) => {
            this.handleMessage(event, this.injector.iframe);
        });
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
                // 重选文件夹 = 数据源变化，收藏夹作品与作者钻取作品的会话缓存均作废
                collectWorksLoader.invalidateCache();
                authorWorksLoader.invalidateCache();
                this.selectFolder(iframe);
                break;
                
            case 'LOAD_LIKED_WORKS':  // ✅ 改为 LOAD_LIKED_WORKS
                await this._handleLoadLikedWorks(iframe);
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
                // ✅ 刷新关注列表 = 作者维度数据更新入口：作者钻取作品会话缓存作废（新代数），
                // 与 collectWorksLoader 由「刷新收藏列表」驱动代数的机制同构
                authorWorksLoader.invalidateCache();
                dataFetcher.setFolderSelected(true);
                await dataFetcher._loadList('following', iframe, {});
                break;
            
            // ✅ 处理加载收藏夹作品请求
            case 'LOAD_COLLECT_WORKS':
                logger.info(`🎬 收到加载收藏夹作品请求: ${event.data.collectIds.length} 个收藏夹`);
                await collectWorksLoader.load(event.data, iframe);
                break;
            
            // ✅ 处理作者作品钻取拉取请求（关注卡片「作品」按钮，与收藏夹加载同构：
            // 会话代数缓存 + data-fetcher 配置化管线，落 works 表并建立 work→author 关系）
            case 'LOAD_AUTHOR_WORKS':
                logger.info(`🎬 收到作者作品拉取请求: UID=${event.data.uid}`);
                await authorWorksLoader.load(event.data, iframe);
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

            // ✅ 批量查询作者下载状态（关注列表渲染后的实时计数校正）
            case 'QUERY_AUTHORS_STATUS_BATCH':
                logger.info(`📊 收到批量查询作者状态请求: ${event.data.uids?.length || 0} 个作者`);
                await this.handleQueryAuthorsStatusBatch(event.data, iframe);
                break;

            // ✅ 持久化作者下载统计到 Content 主库（Sidebar/Content 的 IndexedDB 按 origin 隔离，
            // Sidebar 直写只对影子库生效，必须经本消息桥接）
            case 'UPDATE_AUTHOR_DOWNLOAD_STATS':
                logger.info(`💾 收到作者下载统计写入请求: ${Object.keys(event.data.stats || {}).length} 个作者`);
                await this.handleUpdateAuthorDownloadStats(event.data, iframe);
                break;
            
            // ✅ 处理侧边栏模式切换
            case 'CHANGE_SIDEBAR_MODE':
                logger.info(`🔄 收到侧边栏模式切换请求: ${event.data.mode}`);
                await this.injector.changeMode(event.data.mode);
                break;
            
            // ✅ 处理获取侧边栏模式请求
            case 'GET_SIDEBAR_MODE':
                logger.info('📋 收到获取侧边栏模式请求');
                await this.handleGetSidebarMode(iframe);
                break;

            // ✅ 配置面板：读取用户配置
            case 'GET_USER_CONFIG':
                this._handleGetUserConfig(iframe);
                break;

            // ✅ 配置面板：保存用户配置
            case 'SAVE_USER_CONFIG':
                logger.info('💾 收到保存用户配置请求');
                await this._handleSaveUserConfig(event.data.config, iframe);
                break;
                
            default:
                logger.warn('未知消息类型:', event.data.type);
        }
    }

    /**
     * ✅ 处理加载点赞列表
     * maxCount 不再由 Sidebar 传入，而是由用户配置文件驱动（dataFetcher.listConfigs）
     */
    async _handleLoadLikedWorks(iframe) {
        dataFetcher.setFolderSelected(true);
        await dataFetcher._loadList('liked', iframe, {});
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
        // ✅ 刷新收藏列表 = 显式更新入口：作废收藏夹作品会话缓存（新代数），
        // 本次刷新后首次勾选的收藏夹会完整重走加载；同代数内取消再勾选仍直接复用
        collectWorksLoader.invalidateCache();
        logger.info('🔄 刷新收藏列表，收藏夹作品会话缓存已作废');
        // ✅ 统一处理：收藏夹也需要文件夹（folderRequired: true）
        dataFetcher.setFolderSelected(true);
        await dataFetcher._loadList('collects', iframe, { 
            count: CONFIG.FETCH_CONFIG.LIST_CONFIGS.collects.maxCount 
        });
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
            
            // ✅ 下载改变了保存状态与本地媒体，整批完成后异步刷新FavGallery 离线页数据（仅当有成功下载）
            if (result.progress && result.progress.success > 0) {
                this._refreshOfflineData('批量下载完成');
            }
            
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
                
                // ✅ 加载/生成用户配置文件，并重建列表配置（使 maxCount 等由配置驱动）
                await userConfig.ensureConfig(fileSystem);
                dataFetcher.reloadConfigs();
                logger.info('✅ 用户配置已加载并应用');
                
                // ✅ 自动检查并恢复备份
                await this.autoRestoreFromBackup();
                
                // 通知 dataFetcher 文件夹已选择
                dataFetcher.setFolderSelected(true);
                
                // ✅ 异步生成FavGallery 离线页静态壳 + 数据（不阻塞 UI；失败仅记录日志）
                this._generateOfflineShell();
                this._refreshOfflineData('选择文件夹');
                
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
     * ✅ 异步生成FavGallery 离线页静态壳（FavGallery.html + resources/offline-viewer/*）
     * fire-and-forget：不 await；每次选文件夹覆盖，保证壳与扩展版本一致
     */
    _generateOfflineShell() {
        generateStaticShell(this.extensionOrigin)
            .then(result => {
                if (result?.success) {
                    logger.info(`✅ 离线静态壳已生成（${result.count} 个文件）`);
                } else {
                    logger.info(`ℹ️ 离线静态壳未生成: ${result?.reason || result?.error || '未知'}`);
                }
            })
            .catch(error => {
                logger.warn('⚠️ 离线静态壳生成异常:', error?.message);
            });
    }
    
    /**
     * ✅ 异步刷新FavGallery 离线页数据
     * fire-and-forget：不 await，避免阻塞主流程；生成器内部有并发保护，重复触发会被跳过
     * @param {string} reason - 触发原因（仅用于日志）
     */
    _refreshOfflineData(reason = '') {
        generateOfflineData()
            .then(result => {
                if (result?.success) {
                    logger.info(`✅ 离线数据生成完成（${reason}）:`, result.counts);
                } else {
                    logger.info(`ℹ️ 离线数据生成未执行（${reason}）: ${result?.reason || result?.error || '未知'}`);
                }
            })
            .catch(error => {
                logger.warn(`⚠️ 离线数据生成异常（${reason}）:`, error?.message);
            });
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
     * ✅ 处理批量查询作者下载状态（relations ∩ completed_works 实时计算）
     * 供侧边栏统一作者卡片「已存 x/y」口径：不依赖仅由按作者下载链路累加的派生字段
     */
    async handleQueryAuthorsStatusBatch(data, iframe) {
        const { uids } = data;

        try {
            const { getAuthorsDownloadStatusBatch } = await import('../data/storage/authors-manager.js');
            const statuses = await getAuthorsDownloadStatusBatch(fileSystem, uids || []);

            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'AUTHORS_STATUS_BATCH_RESPONSE',
                statuses
            }, '*');
        } catch (error) {
            logger.error('❌ 批量查询作者状态失败:', error);
            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'AUTHORS_STATUS_BATCH_RESPONSE',
                statuses: {}
            }, '*');
        }
    }

    /**
     * ✅ 处理作者下载统计持久化请求（合并写 Content 主库 authors 表）
     */
    async handleUpdateAuthorDownloadStats(data, iframe) {
        try {
            const { updateAuthorsDownloadStats } = await import('../data/storage/authors-manager.js');
            await updateAuthorsDownloadStats(fileSystem, data.stats || {});
        } catch (error) {
            logger.error('❌ 持久化作者下载统计失败:', error);
        }
    }

    /**
     * ✅ 处理获取侧边栏模式请求（模式读取/存储已拆至 SidebarInjector，兼容默认值由其内部兜底）
     */
    async handleGetSidebarMode(iframe) {
        const mode = await this.injector.getMode();
        
        logger.info(`📋 返回侧边栏模式: ${mode}`);
        
        // 发送响应到 Sidebar
        iframe.contentWindow.postMessage({
            source: 'content',
            type: 'SIDEBAR_MODE_RESPONSE',
            mode: mode
        }, '*');
    }

    /**
     * ✅ 配置面板：响应 GET_USER_CONFIG（未选文件夹时不报错，回引导文案）
     */
    _handleGetUserConfig(iframe) {
        const reply = (payload) => {
            iframe?.contentWindow.postMessage({
                source: 'content',
                type: 'USER_CONFIG_LOADED',
                ...payload
            }, '*');
        };

        if (!fileSystem.rootDirectoryHandle) {
            reply({ success: false, error: '请先选择文件夹' });
            return;
        }

        reply({
            success: true,
            // config：当前生效配置（未加载时回默认）；defaults：默认值供面板占位/重置
            config: userConfig.getCurrent() || userConfig.buildDefault(),
            defaults: userConfig.buildDefault()
        });
    }

    /**
     * ✅ 配置面板：响应 SAVE_USER_CONFIG
     * 保存后：reloadConfigs 重建列表配置快照 → 按新 backup.enabled 补偿启停定时备份
     * （边界：fileSystem.init() 的定时备份启动判定早于 ensureConfig，
     *   选文件夹首启按静态默认，保存面板后在此立即对齐）
     */
    async _handleSaveUserConfig(config, iframe) {
        const reply = (payload) => {
            iframe?.contentWindow.postMessage({
                source: 'content',
                type: 'SAVE_USER_CONFIG_RESULT',
                ...payload
            }, '*');
        };

        if (!fileSystem.rootDirectoryHandle) {
            reply({ success: false, error: '请先选择文件夹' });
            return;
        }

        try {
            await userConfig.save(fileSystem, config || {});
            dataFetcher.reloadConfigs();

            // ✅ 定时备份启停对齐（startPeriodicBackup 幂等：内部先清旧定时器，interval 变更同样重起生效）
            const { backupManager } = await import('../data/backup/backup-manager.js');
            if (CONFIG.BACKUP_CONFIG.enabled === true) {
                backupManager.startPeriodicBackup();
            } else {
                backupManager.stopPeriodicBackup();
            }

            reply({ success: true, config: userConfig.getCurrent() });
        } catch (error) {
            logger.error('❌ 保存用户配置失败:', error);
            reply({ success: false, error: error.message || String(error) });
        }
    }
}

// 启动 Content Script
logger.info('🚀 Content Script 启动...');
window.contentScript = new ContentScript();

// ✅ 全局错误边界：logger + fileLogger 落盘，并转发 UI_LOG 进侧边栏日志与红条提示
installErrorBoundary({
    context: 'Content',
    onError: ({ message, count, error }) => {
        const summary = String(message || '').split('\n')[0];
        const label = `[Content] ${summary}${count > 1 ? ` (x${count})` : ''}`;
        logger.error('❌ 未捕获错误:', error || message);
        try {
            fileLogger.writeToFile('error', 'ContentScript', label);
        } catch (e) {
            // 落盘失败不影响转发
        }
        window.contentScript._sendToSidebar({ type: 'UI_LOG', level: 'error', message: label });
    }
});


