// ==========================================
// Tab 管理器
// 功能：切换关注/点赞/收藏三个 Tab
// ==========================================

import { createLogger } from '../../utils/logger.js';

const logger = createLogger('TabManager');

export class TabManager {
    constructor(app) {
        this.app = app;
    }

    /**
     * 切换 Tab
     */
    switchTab(tabName) {
        logger.info('切换 Tab:', tabName);
        
        // 验证 Tab 名称
        if (!['following', 'liked', 'bookmarked'].includes(tabName)) {
            logger.warn('无效的 Tab 名称:', tabName);
            return;
        }
        
        // 更新当前激活的 Tab
        this.app.currentActiveTab = tabName;
        
        // 隐藏所有内容
        this.hideAllTabs();
        
        // 显示目标内容
        this.showTab(tabName);
        
        // 更新按钮样式
        this.updateTabButtons(tabName);
        
        logger.info('✅ Tab 切换完成:', tabName);
    }

    /**
     * 隐藏所有 Tab 内容
     */
    hideAllTabs() {
        const contents = [
            'tabContentFollowing',
            'tabContentLiked',
            'tabContentBookmarked'
        ];
        
        contents.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.style.display = 'none';
            }
        });
    }

    /**
     * 显示指定 Tab 内容
     */
    showTab(tabName) {
        const contentId = `tabContent${this.capitalize(tabName)}`;
        const contentEl = document.getElementById(contentId);
    
        if (contentEl) {
            contentEl.style.display = 'flex'; // 使用flex而非block，保持CSS布局
        }
    }

    /**
     * 更新 Tab 按钮样式
     */
    updateTabButtons(activeTab) {
        const buttons = {
            following: document.getElementById('tabFollowing'),
            liked: document.getElementById('tabLiked'),
            bookmarked: document.getElementById('tabBookmarked')
        };
        
        // 移除所有按钮的 active 类
        Object.values(buttons).forEach(btn => {
            if (btn) {
                btn.classList.remove('active');
            }
        });
        
        // 给当前按钮添加 active 类
        const activeBtn = buttons[activeTab];
        if (activeBtn) {
            activeBtn.classList.add('active');
        }
    }

    /**
     * 首字母大写
     */
    capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
}


