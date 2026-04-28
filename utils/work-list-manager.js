// ==========================================
// 作品/作者列表管理器 - 通用分页、搜索、渲染功能
// 功能：管理点赞、收藏、关注等列表的分页、搜索、渲染
// ==========================================

import { createLogger } from './logger.js';

const logger = createLogger('WorkListManager');

/**
 * 通用列表管理器
 * 用于管理作品列表（点赞、收藏）和作者列表（关注）的分页、搜索、渲染等功能
 */
export class WorkListManager {
    /**
     * @param {Object} config - 配置对象
     * @param {string} config.type - 列表类型：'liked' | 'bookmarked' | 'following'
     * @param {Array} config.allWorks - 所有作品数据（作品列表使用）
     * @param {Array} config.allAuthors - 所有作者数据（作者列表使用）
     * @param {number} config.pageSize - 每页显示数量
     * @param {Function} config.onStateChange - 状态变化回调 (state) => void
     */
    constructor(config) {
        this.type = config.type;
        this.allWorks = config.allWorks || [];
        this.allAuthors = config.allAuthors || [];
        this.filteredData = null;
        this.currentPage = 1;
        this.pageSize = config.pageSize || 50;
        this.onStateChange = config.onStateChange;

        // DOM 元素缓存
        this.elements = {};
    }

    /**
     * 初始化 DOM 元素
     */
    initElements() {
        const prefix = this.type;

        // ✅ 关注列表的搜索框 ID 是 searchInput，不是 followingSearchInput
        const searchInputId = this.type === 'following' ? 'searchInput' : `${prefix}SearchInput`;

        this.elements = {
            status: document.getElementById(`${prefix}Status`),
            list: document.getElementById(`${prefix}List`),
            searchInput: document.getElementById(searchInputId),
            pagination: document.getElementById(`${prefix}Pagination`),
            pageInfo: document.getElementById(`${prefix}PageInfo`),
            prevBtn: document.getElementById(`${prefix}PrevPage`),
            nextBtn: document.getElementById(`${prefix}NextPage`)
        };
    }

    /**
     * 设置数据（兼容作品和作者）
     */
    setData(data) {
        if (this.type === 'following') {
            this.allAuthors = data || [];
            this.allWorks = [];
        } else {
            this.allWorks = data || [];
            this.allAuthors = [];
        }
        this.filteredData = null;
        this.currentPage = 1;
        this.notifyStateChange();
    }

    /**
     * 获取当前页的数据
     */
    getCurrentPageData() {
        const allData = this.type === 'following' ? this.allAuthors : this.allWorks;
        const data = this.filteredData || allData;
        const start = (this.currentPage - 1) * this.pageSize;
        const end = start + this.pageSize;
        return data.slice(start, end);
    }

    /**
     * 计算总页数
     */
    getTotalPages() {
        const allData = this.type === 'following' ? this.allAuthors : this.allWorks;
        const total = this.filteredData ? this.filteredData.length : allData.length;
        return Math.ceil(total / this.pageSize) || 1;
    }

    /**
     * 跳转到指定页
     */
    goToPage(page) {
        const totalPages = this.getTotalPages();
        if (page < 1 || page > totalPages) return false;

        this.currentPage = page;
        this.notifyStateChange();
        return true;
    }

    /**
     * 上一页
     */
    prevPage() {
        return this.goToPage(this.currentPage - 1);
    }

    /**
     * 下一页
     */
    nextPage() {
        return this.goToPage(this.currentPage + 1);
    }

    /**
     * 搜索
     */
    search(keyword) {
        const allData = this.type === 'following' ? this.allAuthors : this.allWorks;
        const trimmedKeyword = keyword.trim();

        if (!trimmedKeyword) {
            this.filteredData = null;
        } else {
            if (this.type === 'following') {
                // 搜索作者：匹配昵称或抖音号
                this.filteredData = allData.filter(author => {
                    const nickname = (author.nickname || '').toLowerCase();
                    const uniqueId = (author.uniqueId || '').toLowerCase();
                    return nickname.includes(trimmedKeyword.toLowerCase()) ||
                        uniqueId.includes(trimmedKeyword.toLowerCase());
                });
            } else {
                // 搜索作品：匹配描述或作者
                this.filteredData = allData.filter(work => {
                    const desc = (work.desc || '').toLowerCase();
                    const author = (work.author?.nickname || '').toLowerCase();
                    return desc.includes(trimmedKeyword.toLowerCase()) ||
                        author.includes(trimmedKeyword.toLowerCase());
                });
            }
        }

        this.currentPage = 1;
        this.notifyStateChange();
    }

    /**
     * 获取搜索结果的占位符文本
     */
    getSearchPlaceholder() {
        const allData = this.type === 'following' ? this.allAuthors : this.allWorks;
        const count = this.filteredData ? this.filteredData.length : allData.length;
        const keyword = this.elements.searchInput?.value?.trim();

        if (keyword) {
            return `搜索结果: ${count} 个`;
        }

        if (this.type === 'following') {
            return `搜索 ${allData.length} 个作者...`;
        }
        return `搜索 ${allData.length} 个作品...`;
    }

    /**
     * 更新 UI 显示
     * @param {Set} selectedWorkIds - 选中的作品ID集合（可选，用于分页时保持 checkbox 状态）
     */
    updateUI(selectedWorkIds = null) {
        this.updateStatus();
        this.updateSearchInput();
        this.renderList(selectedWorkIds);
        this.updatePaginationControls();
    }

    /**
     * 更新状态显示
     */
    updateStatus() {
        if (!this.elements.status) return;

        const allData = this.type === 'following' ? this.allAuthors : this.allWorks;
        const total = allData.length;
        const totalPages = this.getTotalPages();

        const typeName = this.getTypeName();

        // ✅ 空状态特殊处理
        if (total === 0) {
            this.elements.status.innerHTML = `
                <div style="color: #999;">
                    📭 暂无${typeName}数据
                </div>
            `;
        } else {
            this.elements.status.innerHTML = `
                <div style="color: #52c41a;">
                    ✅ 共 ${total} 个${typeName}，共 ${totalPages} 页
                </div>
            `;
        }
    }

    /**
     * 更新搜索框
     */
    updateSearchInput() {
        if (!this.elements.searchInput) return;

        this.elements.searchInput.disabled = false;
        this.elements.searchInput.placeholder = this.getSearchPlaceholder();
    }

    /**
     * 渲染列表
     * @param {Set} selectedWorkIds - 选中的作品ID集合（可选，用于分页时保持 checkbox 状态）
     */
    renderList(selectedWorkIds = null) {
        if (!this.elements.list) return;

        const data = this.getCurrentPageData();

        // ✅ 动态导入渲染函数
        import('./work-helpers.js').then(({ renderWorkList }) => {
            if (this.type === 'following') {
                // TODO: 第二阶段实现作者列表渲染
                logger.warn('⚠️ 作者列表渲染尚未实现');
            } else {
                // 渲染作品列表，传递选中状态
                renderWorkList(this.elements.list, data, selectedWorkIds);
            }
        });
    }

    /**
     * 更新分页控件
     */
    updatePaginationControls() {
        const { pagination, pageInfo, prevBtn, nextBtn } = this.elements;
        if (!pagination || !pageInfo || !prevBtn || !nextBtn) return;

        const totalPages = this.getTotalPages();
        const allData = this.type === 'following' ? this.allAuthors : this.allWorks;
        const totalItems = this.filteredData ? this.filteredData.length : allData.length;

        // ✅ 使用 visibility 而不是 display，保持布局稳定
        if (totalItems > 0) {
            pagination.style.visibility = 'visible';
            pagination.style.height = 'auto';
            pagination.style.overflow = 'visible';
        } else {
            pagination.style.visibility = 'hidden';
            pagination.style.height = '0px';
            pagination.style.overflow = 'hidden';
        }

        pageInfo.textContent = `第 ${this.currentPage} / ${totalPages} 页`;

        prevBtn.disabled = this.currentPage <= 1;
        nextBtn.disabled = this.currentPage >= totalPages;

        prevBtn.style.opacity = this.currentPage <= 1 ? '0.5' : '1';
        nextBtn.style.opacity = this.currentPage >= totalPages ? '0.5' : '1';
    }

    /**
     * 显示加载进度（仅显示已加载数量，不显示 xx/yy 格式）
     */
    showProgress(currentCount, totalCount) {
        if (!this.elements.status) return;

        // ✅ 符合设计原则：只显示已加载数量，不显示 xx/yy 格式
        this.elements.status.innerHTML = `
            <div style="color: #1890ff;">
                ⏳ 正在加载${this.getTypeName()}... (已加载 ${currentCount} 个)
            </div>
        `;
    }

    /**
     * 显示错误
     */
    showError(error) {
        if (!this.elements.status) return;
        if (!this.elements.list) return;

        this.elements.status.innerHTML = `
            <div style="color: #ff4d4f;">
                ❌ 加载失败
            </div>
        `;

        this.elements.list.innerHTML = `
            <div class="error-message">
                ${this.escapeHtml(error || '未知错误')}
            </div>
        `;
    }

    /**
     * 获取类型名称
     */
    getTypeName() {
        const typeNames = {
            'liked': '点赞作品',
            'bookmarked': '收藏作品',
            'following': '关注作者'
        };
        return typeNames[this.type] || '';
    }

    /**
     * HTML 转义
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 通知状态变化
     */
    notifyStateChange() {
        if (this.onStateChange) {
            this.onStateChange({
                type: this.type,
                currentPage: this.currentPage,
                totalPages: this.getTotalPages(),
                totalCount: this.type === 'following' ? this.allAuthors.length : this.allWorks.length,
                filteredCount: this.filteredData ? this.filteredData.length : null
            });
        }
    }

    /**
     * 清空数据
     */
    clear() {
        this.allWorks = [];
        this.allAuthors = [];
        this.filteredData = null;
        this.currentPage = 1;
        this.notifyStateChange();
    }
}
