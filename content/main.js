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

const logger = createLogger('ContentScript');

class ContentScript {
    constructor() {
        this.isCollapsed = false;
        this.injected = false;
        
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
            
            // ✅ P0: 处理单个作品下载请求
            case 'DOWNLOAD_WORK':
                logger.info(`📥 收到下载作品请求: ${event.data.work.workId}`);
                this.handleDownloadWork(event.data, iframe);
                break;
            
            // ✅ 处理备份请求
            case 'BACKUP_REQUEST':
                logger.info('🔄 收到备份请求');
                this.handleBackupRequest(event);
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
     * ✅ P0: 处理单个作品下载（在 Content Script 中执行）
     */
    async handleDownloadWork(data, iframe) {
        const { work, folderPath } = data;
        
        // ✅ P1: 设置 5 分钟超时
        let timeoutId = null;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error('下载超时（5分钟）'));
            }, 300000); // 5 分钟
        });
        
        try {
            logger.info(`📥 开始下载作品: ${work.workId}`);
            
            // ✅ 创建 SingleDownloader 实例（使用 Content Script 的 fileSystem）
            const downloader = new SingleDownloader(fileSystem);
            
            // ✅ 执行下载（带超时）
            const result = await Promise.race([
                downloader.download(work, folderPath),
                timeoutPromise
            ]);
            
            // ✅ 清除超时定时器
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            
            // ✅ 通知 Sidebar 下载结果
            if (result.success) {
                logger.info(`✅ 下载成功: ${work.workId}`);
                
                iframe.contentWindow.postMessage({
                    source: 'content',
                    type: 'DOWNLOAD_SUCCESS',
                    workId: work.workId,
                    result: result
                }, '*');
            } else {
                logger.error(`❌ 下载失败: ${work.workId}`, result.error);
                iframe.contentWindow.postMessage({
                    source: 'content',
                    type: 'DOWNLOAD_FAILED',
                    workId: work.workId,
                    error: result.error
                }, '*');
            }
        } catch (error) {
            // ✅ 清除超时定时器
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            
            logger.error(`❌ 下载异常: ${work.workId}`, error);
            iframe.contentWindow.postMessage({
                source: 'content',
                type: 'DOWNLOAD_FAILED',
                workId: work.workId,
                error: error.message || '未知错误'
            }, '*');
        }
    }

    /**
     * ✅ 处理备份请求
     */
    async handleBackupRequest(event) {
        try {
            logger.info('🔄 正在备份下载状态到文件系统...');
            
            // ✅ 如果有新记录，先保存到 Content Script 的数据库
            const newRecord = event.data?.data?.newRecord;
            if (newRecord) {
                logger.info('💾 收到新记录，保存到 Content Script 数据库...');
                await database.save('completed_works', newRecord);
                logger.info('✅ 新记录已保存');
            }
            
            // ✅ 使用选择性备份，只备份 completed_works 表
            await backupManager.performSelectiveBackup(['completed_works']);
            logger.info('✅ 下载状态已备份到文件系统');
        } catch (backupError) {
            logger.warn('⚠️ 备份失败:', backupError.message);
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


