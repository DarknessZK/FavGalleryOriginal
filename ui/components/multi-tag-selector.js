// ==========================================
// FavGallery - 通用多标签选择器组件
// 职责：提供通用的多选标签UI功能（下拉选择 + 标签显示）
// 适用场景：收藏夹选择、作者分组选择、标签筛选等
// ==========================================

import { createLogger } from '../../utils/logger.js';

const logger = createLogger('MultiTagSelector');

/**
 * 通用多标签选择器
 * 
 * @example
 * // 基本用法
 * const selector = new MultiTagSelector({
 *     containerId: 'mySelector',
 *     dataKey: 'id',
 *     labelKey: 'name',
 *     onSelectionChange: (selectedIds) => {
 *         console.log('选中的ID:', selectedIds);
 *     }
 * });
 * 
 * // 初始化数据
 * selector.init([
 *     { id: '1', name: '选项1' },
 *     { id: '2', name: '选项2' }
 * ]);
 */
export class MultiTagSelector {
    /**
     * @param {Object} config - 配置对象
     * @param {string} config.containerId - 容器元素ID
     * @param {string} [config.dataKey='id'] - 数据项的ID字段名
     * @param {string} [config.labelKey='name'] - 数据项的显示文本字段名
     * @param {string} [config.countKey='count'] - 数据项的数量字段名（可选）
     * @param {Function} [config.onSelectionChange] - 选择变化回调 (selectedIds: Set) => void
     * @param {Function} [config.onSelectAll] - 全选回调 () => void
     * @param {Function} [config.onClearAll] - 清空回调 () => void
     * @param {boolean} [config.sortByTime=true] - 是否按时间排序（需要 createTime 字段）
     */
    constructor(config) {
        this.config = {
            containerId: config.containerId,
            prefix: config.prefix,  // ✅ 前缀配置（用于自动推导元素ID）
            tagsContainerId: config.tagsContainerId,
            dropdownTriggerId: config.dropdownTriggerId,
            dropdownListId: config.dropdownListId,
            selectAllBtnId: config.selectAllBtnId,
            clearAllBtnId: config.clearAllBtnId,
            dataKey: config.dataKey || 'id',
            labelKey: config.labelKey || 'name',
            countKey: config.countKey || 'count',
            onSelectionChange: config.onSelectionChange,
            onSelectAll: config.onSelectAll,
            onClearAll: config.onClearAll,
            sortByTime: config.sortByTime !== false
        };

        // DOM 元素缓存
        this.elements = {
            container: null,
            tagsContainer: null,
            dropdownTrigger: null,
            dropdownList: null,
            selectAllBtn: null,
            clearAllBtn: null
        };

        // 状态管理
        this.selectedIds = new Set();
        this.dataList = [];
    }

    /**
     * ✅ 初始化组件
     * @param {Array} dataList - 数据列表
     */
    async init(dataList) {
        try {
            if (!dataList || dataList.length === 0) {
                logger.warn('⚠️ 未获取到数据列表');
                return;
            }

            this.dataList = dataList;

            // ✅ 初始化 DOM 元素
            if (!this._initElements()) {
                return;
            }

            // ✅ 渲染下拉选项
            this._renderDropdownOptions();

            // ✅ 绑定事件
            this._bindEvents();

            logger.info(`✅ 已初始化 ${dataList.length} 个选项`);

        } catch (error) {
            logger.error('❌ 初始化多标签选择器失败:', error);
        }
    }

    /**
     * ✅ 初始化 DOM 元素引用
     * @private
     */
    _initElements() {
        const { 
            containerId,
            // ✅ 支持两种配置方式：
            // 1. 直接指定所有元素ID（最灵活）
            tagsContainerId,
            dropdownTriggerId,
            dropdownListId,
            selectAllBtnId,
            clearAllBtnId,
            // 2. 或者指定前缀，自动推导（最简单）
            prefix
        } = this.config;
        
        // ✅ 确定使用哪种方式
        let elementPrefix;
        
        logger.info('🔍 MultiTagSelector 配置检查:', {
            hasPrefix: !!prefix,
            prefix: prefix,
            hasTagsContainerId: !!tagsContainerId,
            hasDropdownTriggerId: !!dropdownTriggerId
        });
        
        if (prefix) {
            // 方式1：使用指定的前缀（推荐）
            elementPrefix = prefix;
            logger.info('✅ 使用前缀模式:', elementPrefix);
        } else if (tagsContainerId || dropdownTriggerId || dropdownListId || selectAllBtnId || clearAllBtnId) {
            // 方式2：部分或全部显式指定元素ID
            elementPrefix = null; // 标记为不使用推导
            logger.info('✅ 使用显式ID模式');
        } else {
            // 降级方案：从 containerId 推导（仅用于开发调试）
            logger.warn('⚠️ 未提供完整配置，尝试从 containerId 推导元素ID');
            elementPrefix = containerId.replace('MultiSelect', '');
        }
        
        // ✅ 获取元素ID（优先使用显式配置，否则使用前缀推导）
        const getElementId = (explicitId, suffix) => {
            return explicitId || (elementPrefix ? `${elementPrefix}${suffix}` : null);
        };
        
        this.elements.container = document.getElementById(containerId);
        this.elements.tagsContainer = document.getElementById(getElementId(tagsContainerId, 'TagsContainer'));
        this.elements.dropdownTrigger = document.getElementById(getElementId(dropdownTriggerId, 'DropdownTrigger'));
        this.elements.dropdownList = document.getElementById(getElementId(dropdownListId, 'DropdownList'));
        this.elements.selectAllBtn = document.getElementById(getElementId(selectAllBtnId, 'SelectAll'));
        this.elements.clearAllBtn = document.getElementById(getElementId(clearAllBtnId, 'ClearAll'));

        if (!this.elements.container || !this.elements.tagsContainer || 
            !this.elements.dropdownTrigger || !this.elements.dropdownList) {
            logger.warn(`⚠️ 找不到多标签选择器元素`, {
                container: !!this.elements.container,
                tagsContainer: !!this.elements.tagsContainer,
                dropdownTrigger: !!this.elements.dropdownTrigger,
                dropdownList: !!this.elements.dropdownList,
                selectAllBtn: !!this.elements.selectAllBtn,
                clearAllBtn: !!this.elements.clearAllBtn
            });
            return false;
        }

        // 显示组件
        this.elements.container.style.display = 'block';
        return true;
    }

    /**
     * ✅ 绑定所有事件
     * @private
     */
    _bindEvents() {
        // ✅ 防重复绑定：监听目标是持久 DOM（trigger/标签容器/document），
        // 同一实例重复 init 叠加监听会导致下拉 toggle 多次、偶数次时永远打不开
        if (this._eventsBound) return;
        this._eventsBound = true;

        const { dropdownTrigger, tagsContainer, selectAllBtn, clearAllBtn } = this.elements;

        // 绑定触发器点击事件（展开/收起）
        dropdownTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            this._toggleDropdown();
        });

        // 绑定标签容器点击事件（展开/收起）
        tagsContainer.addEventListener('click', (e) => {
            // 如果点击的是删除按钮，不触发展开/收起
            if (e.target.classList.contains('tag-remove')) {
                return;
            }
            e.stopPropagation();
            this._toggleTagsContainer();
        });

        // 点击外部区域关闭所有下拉内容
        document.addEventListener('click', (e) => {
            if (!this.elements.container.contains(e.target)) {
                this._closeDropdown();
                this._collapseTagsContainer();
            }
        });

        // 绑定全选按钮
        if (selectAllBtn) {
            selectAllBtn.addEventListener('click', () => {
                this._handleSelectAll();
            });
        }

        // 绑定清空按钮
        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', () => {
                this._handleClearAll();
            });
        }
    }

    /**
     * ✅ 切换下拉菜单显示/隐藏
     * @private
     */
    _toggleDropdown() {
        const { dropdownList } = this.elements;
        const isHidden = dropdownList.style.display === 'none';
        dropdownList.style.display = isHidden ? 'block' : 'none';
    }

    /**
     * ✅ 关闭下拉菜单
     * @private
     */
    _closeDropdown() {
        this.elements.dropdownList.style.display = 'none';
    }

    /**
     * ✅ 切换标签容器展开/收起状态
     * @private
     */
    _toggleTagsContainer() {
        const { tagsContainer } = this.elements;
        const isExpanded = tagsContainer.classList.contains('expanded');
        if (isExpanded) {
            this._collapseTagsContainer();
        } else {
            this._expandTagsContainer();
        }
    }

    /**
     * ✅ 展开标签容器
     * @private
     */
    _expandTagsContainer() {
        const { tagsContainer } = this.elements;
        tagsContainer.classList.add('expanded');
        tagsContainer.style.position = 'absolute';
        tagsContainer.style.top = '0';
        tagsContainer.style.left = '0';
        tagsContainer.style.right = '0';
        tagsContainer.style.height = 'auto';
        tagsContainer.style.overflowY = 'visible';
        tagsContainer.style.zIndex = '100';
        tagsContainer.style.borderRadius = '4px 4px 0 0';
        tagsContainer.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
    }

    /**
     * ✅ 收起标签容器
     * @private
     */
    _collapseTagsContainer() {
        const { tagsContainer } = this.elements;
        tagsContainer.classList.remove('expanded');
        tagsContainer.style.position = 'relative';
        tagsContainer.style.height = '60px';
        tagsContainer.style.overflowY = 'auto';
        tagsContainer.style.borderRadius = '4px';
        tagsContainer.style.boxShadow = 'none';
    }

    /**
     * ✅ 渲染下拉选项（带复选框）
     * @private
     */
    _renderDropdownOptions() {
        const { dropdownList } = this.elements;
        const { dataKey, labelKey, countKey, sortByTime } = this.config;
        
        dropdownList.innerHTML = '';

        // ✅ 按创建时间排序（从新到旧）
        let sortedList = [...this.dataList];
        if (sortByTime) {
            sortedList.sort((a, b) => {
                return (b.createTime || 0) - (a.createTime || 0);
            });
        }

        sortedList.forEach(item => {
            const label = document.createElement('label');
            label.style.cssText = 'display: flex; align-items: center; gap: 6px; padding: 6px 8px; cursor: pointer; font-size: 12px; transition: background 0.2s;';
            label.onmouseover = () => label.style.background = '#f5f5f5';
            label.onmouseout = () => label.style.background = 'transparent';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = item[dataKey];
            checkbox.dataset.label = item[labelKey];
            checkbox.style.cursor = 'pointer';

            const text = document.createElement('span');
            const count = item[countKey];
            text.textContent = count !== undefined && count !== null 
                ? `${item[labelKey]} (${count})`
                : item[labelKey];

            label.appendChild(checkbox);
            label.appendChild(text);

            // 绑定复选框变化事件
            checkbox.addEventListener('change', (e) => {
                e.stopPropagation();
                const itemId = checkbox.value;
                const itemName = checkbox.dataset.label;

                if (checkbox.checked) {
                    this.addTag(itemId, itemName, true);
                } else {
                    this.removeTag(itemId, true);
                }
            });

            dropdownList.appendChild(label);
        });
    }

    /**
     * ✅ 更新下拉框复选框状态（与标签区同步）
     * @private
     */
    _updateDropdownCheckboxes() {
        const { dropdownList, tagsContainer } = this.elements;
        const { dataKey } = this.config;
        
        const checkboxes = dropdownList.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            const itemId = checkbox.value;
            const tagExists = tagsContainer.querySelector(`[data-item-id="${itemId}"]`);
            checkbox.checked = !!tagExists;
        });
    }

    /**
     * ✅ 添加标签
     * @param {string} itemId - 项目ID
     * @param {string} itemName - 项目名称
     * @param {boolean} triggerCallback - 是否触发回调
     */
    addTag(itemId, itemName, triggerCallback = true) {
        const { tagsContainer } = this.elements;
        
        // 检查是否已存在
        const existingTag = tagsContainer.querySelector(`[data-item-id="${itemId}"]`);
        if (existingTag) {
            logger.warn(`⚠️ 标签已存在: ${itemName}`);
            return;
        }

        // 添加到选中集合
        this.selectedIds.add(itemId);

        // 创建标签
        const tag = document.createElement('div');
        tag.className = 'collect-tag';
        tag.dataset.itemId = itemId;
        tag.dataset.itemName = itemName;
        tag.innerHTML = `
            <span class="collect-tag-text">${this._escapeHtml(itemName)}</span>
            <button class="collect-tag-remove" title="移除">×</button>
        `;

        // 绑定删除按钮事件
        const removeBtn = tag.querySelector('.collect-tag-remove');
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeTag(itemId, true);
        });

        tagsContainer.appendChild(tag);

        // 同步下拉框选项状态
        this._updateDropdownCheckboxes();

        // 触发回调
        if (triggerCallback && this.config.onSelectionChange) {
            this.config.onSelectionChange(this.selectedIds);
        }
    }

    /**
     * ✅ 移除标签
     * @param {string} itemId - 项目ID
     * @param {boolean} triggerCallback - 是否触发回调
     */
    removeTag(itemId, triggerCallback = true) {
        const { tagsContainer } = this.elements;
        
        const tag = tagsContainer.querySelector(`[data-item-id="${itemId}"]`);
        if (tag) {
            tag.remove();
        }

        // 从选中集合中移除
        this.selectedIds.delete(itemId);

        // 同步下拉框选项状态
        this._updateDropdownCheckboxes();

        // 触发回调
        if (triggerCallback && this.config.onSelectionChange) {
            this.config.onSelectionChange(this.selectedIds);
        }
    }

    /**
     * ✅ 处理全选
     * @private
     */
    _handleSelectAll() {
        const { tagsContainer, dropdownList } = this.elements;
        const { dataKey, labelKey } = this.config;
        
        // 清空现有标签
        const existingTags = tagsContainer.querySelectorAll('.collect-tag');
        existingTags.forEach(tag => tag.remove());
        this.selectedIds.clear();

        // 获取所有项目 ID
        const checkboxes = dropdownList.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            const itemId = checkbox.value;
            const itemName = checkbox.dataset.label;
            this.addTag(itemId, itemName, false);
        });

        // 触发回调
        if (this.config.onSelectAll) {
            this.config.onSelectAll();
        } else if (this.config.onSelectionChange) {
            this.config.onSelectionChange(this.selectedIds);
        }
    }

    /**
     * ✅ 处理清空
     * @private
     */
    _handleClearAll() {
        const { tagsContainer } = this.elements;
        
        const allTags = tagsContainer.querySelectorAll('.collect-tag');
        allTags.forEach(tag => tag.remove());
        this.selectedIds.clear();

        // 更新下拉框复选框状态
        this._updateDropdownCheckboxes();

        // 收起标签容器
        this._collapseTagsContainer();

        // 触发回调
        if (this.config.onClearAll) {
            this.config.onClearAll();
        } else if (this.config.onSelectionChange) {
            this.config.onSelectionChange(this.selectedIds);
        }
    }

    /**
     * ✅ HTML转义
     * @param {string} text - 需要转义的文本
     * @returns {string} 转义后的文本
     * @private
     */
    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * ✅ 获取选中的ID集合
     * @returns {Set} 选中的ID集合
     */
    getSelectedIds() {
        return new Set(this.selectedIds);
    }

    /**
     * ✅ 清空所有选择
     */
    clear() {
        this._handleClearAll();
    }

    /**
     * ✅ 全选
     */
    selectAll() {
        this._handleSelectAll();
    }

    /**
     * ✅ 更新数据列表并重新渲染
     * @param {Array} newDataList - 新的数据列表
     */
    updateData(newDataList) {
        this.dataList = newDataList;
        this.selectedIds.clear();
        
        // 清空标签
        const { tagsContainer } = this.elements;
        const allTags = tagsContainer.querySelectorAll('.collect-tag');
        allTags.forEach(tag => tag.remove());
        
        // 重新渲染下拉选项
        this._renderDropdownOptions();
        this._updateDropdownCheckboxes();
    }
}
