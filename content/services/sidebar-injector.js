// ==========================================
// FavGallery - 侧边栏注入服务
// 职责：侧边栏容器/iframe/切换按钮的创建注入、展开收起、显示模式（hover/squeeze）维护
// 说明：自 content/main.js 行为等价拆出（2026-09），日志模块名沿用 ContentScript 保持输出一致
// ==========================================

import { createLogger } from '../../utils/logger.js';
import { platformAPI } from '../../api/platform-adapter.js';
import { CONFIG } from '../../config/constants.js';

const logger = createLogger('ContentScript');

class SidebarInjector {
    /**
     * @param {Object} options
     * @param {string} options.sidebarUrl - iframe 加载的侧边栏页面地址
     * @param {(iframe: HTMLIFrameElement) => void} [options.onIframeLoad] - iframe 加载完成回调（主模块用于发送用户信息）
     */
    constructor({ sidebarUrl, onIframeLoad }) {
        this.sidebarUrl = sidebarUrl;
        this.onIframeLoad = onIframeLoad;

        this.isCollapsed = false;
        this.injected = false;
        this.sidebarMode = 'hover';

        this.iframe = null;
        this.container = null;
        this.toggleBtn = null;
    }

    /**
     * 注入侧边栏到页面
     */
    async inject() {
        if (this.injected) {
            logger.warn('侧边栏已注入，跳过');
            return;
        }
        
        logger.info('开始注入侧边栏...');
        
        // ✅ 读取用户设置的侧边栏模式
        this.sidebarMode = await this.getMode();
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
            this.toggle();
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
        
        // iframe 加载完成后回调主模块（发送用户信息）
        iframe.addEventListener('load', () => {
            setTimeout(async () => {
                await this.onIframeLoad?.(iframe);
            }, sidebarConfig.IFRAME_LOAD_DELAY);
        });
    }

    /**
     * 切换侧边栏展开/收起状态
     */
    toggle() {
        const root = document.querySelector('#root');
        const { iframe, container, toggleBtn } = this;

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
     * ✅ 读取侧边栏模式设置（失败时回退默认 hover，与原 loadSidebarMode/handleGetSidebarMode 兜底一致）
     * @returns {Promise<string>} 'hover' | 'squeeze'
     */
    async getMode() {
        try {
            const { getSetting } = await import('../../data/storage/settings-manager.js');
            return await getSetting('sidebar_mode', 'hover');
        } catch (error) {
            logger.warn('⚠️ 加载侧边栏模式失败，使用默认值 hover:', error.message);
            return 'hover';
        }
    }

    /**
     * ✅ 切换侧边栏模式：保存设置 + 重新应用页面布局
     */
    async changeMode(mode) {
        try {
            logger.info(`🔄 切换侧边栏模式: ${this.sidebarMode} -> ${mode}`);
            
            // 保存设置
            const { setSetting } = await import('../../data/storage/settings-manager.js');
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
}

export { SidebarInjector };
