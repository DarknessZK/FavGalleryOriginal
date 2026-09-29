// ==========================================
// Tab 管理器
// 功能：切换关注/点赞/收藏三个 Tab
// ==========================================

import { createLogger } from '../../utils/logger.js';

const logger = createLogger('TabManager');

export class TabManager {
    constructor(app) {
        this.app = app;
        this.locked = false; // ✅ 钻取等场景可锁定 Tab 切换
    }

    /**
     * 切换 Tab
     */
    switchTab(tabName) {
        // ✅ 锁定期间（如作者作品钻取子视图展开时）忽略切换，避免切走丢失钻取上下文
        if (this.locked) {
            logger.info('🔒 Tab 切换已锁定，忽略切换请求:', tabName);
            return;
        }
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

    /**
     * ✅ 锁定 Tab 切换（逻辑 + 视觉）：作者作品钻取子视图展开时调用
     */
    lock() {
        this.locked = true;
        ['tabFollowing', 'tabLiked', 'tabBookmarked'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.disabled = true;
            el.style.opacity = '0.5';
            el.style.cursor = 'not-allowed';
            el.style.pointerEvents = 'none';
        });
    }

    /**
     * ✅ 解除 Tab 切换锁定：返回作者列表时调用
     */
    unlock() {
        this.locked = false;
        ['tabFollowing', 'tabLiked', 'tabBookmarked'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.disabled = false;
            el.style.opacity = '';
            el.style.cursor = '';
            el.style.pointerEvents = '';
        });
    }
}


