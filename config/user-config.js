// ==========================================
// FavGallery - 用户配置管理器
// 职责：管理 .FavGallery/config.json 的加载、生成、合并与应用
// 说明：仅运行在 Content Script 上下文（唯一拥有文件系统访问权限的一侧）
// ==========================================

import { CONFIG } from './constants.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('UserConfig');

/**
 * 用户配置管理器
 *
 * 设计要点：
 * - 默认值由 CONFIG.FETCH_CONFIG.LIST_CONFIGS 派生（单一数据源，避免重复硬编码）
 * - 读取时与默认值深合并，保证旧配置文件缺失的新字段自动补齐（向前兼容）
 * - 应用阶段把配置值写回 CONFIG.FETCH_CONFIG.LIST_CONFIGS，
 *   使所有下游读取（listConfigs 重建、api 默认参数）自动生效
 */
class UserConfigManager {
    constructor() {
        /** @type {Object|null} 当前生效的用户配置 */
        this.current = null;
    }

    /**
     * ✅ 构建默认配置（从 LIST_CONFIGS 派生 maxCount）
     * @returns {Object} 默认配置对象
     */
    buildDefault() {
        const listMaxCount = {};
        Object.entries(CONFIG.FETCH_CONFIG.LIST_CONFIGS).forEach(([listType, cfg]) => {
            listMaxCount[listType] = cfg.maxCount;
        });

        return {
            version: CONFIG.USER_CONFIG.version,
            listMaxCount
        };
    }

    /**
     * ✅ 深合并：以默认值为底，用户配置覆盖（补齐缺失字段）
     * @param {Object} userConfig - 用户配置文件内容
     * @returns {Object} 合并后的完整配置
     */
    _mergeWithDefault(userConfig) {
        const defaults = this.buildDefault();
        return {
            version: userConfig?.version ?? defaults.version,
            listMaxCount: {
                ...defaults.listMaxCount,
                ...(userConfig?.listMaxCount || {})
            }
        };
    }

    /**
     * ✅ 加载或生成配置文件，并应用到运行时
     *
     * 流程：读取 config.json → 不存在则用默认值生成并写入 → 深合并 → 应用到 LIST_CONFIGS
     *
     * @param {Object} fileSystem - 文件系统管理器实例
     * @returns {Promise<Object>} 当前生效的配置
     */
    async ensureConfig(fileSystem) {
        let stored = null;
        try {
            stored = await fileSystem.readUserConfig();
        } catch (error) {
            logger.warn('⚠️ 读取配置文件失败，使用默认配置:', error.message);
        }

        if (!stored) {
            // 首次使用：生成默认配置文件
            const defaults = this.buildDefault();
            try {
                await fileSystem.writeUserConfig(defaults);
                logger.info('✅ 已生成默认配置文件:', CONFIG.FILE_SYSTEM.CONFIG_FILE);
            } catch (error) {
                logger.warn('⚠️ 写入默认配置文件失败（不影响本次运行）:', error.message);
            }
            stored = defaults;
        }

        // 深合并，补齐缺失字段
        this.current = this._mergeWithDefault(stored);

        // 应用到 LIST_CONFIGS（写回内存单例，驱动下游所有读取）
        this._applyToListConfigs();

        logger.info('✅ 用户配置已生效:', JSON.stringify(this.current.listMaxCount));
        return this.current;
    }

    /**
     * ✅ 把配置值写回 CONFIG.FETCH_CONFIG.LIST_CONFIGS
     * @private
     */
    _applyToListConfigs() {
        if (!this.current?.listMaxCount) return;

        Object.entries(this.current.listMaxCount).forEach(([listType, maxCount]) => {
            const cfg = CONFIG.FETCH_CONFIG.LIST_CONFIGS[listType];
            if (cfg && typeof maxCount === 'number' && maxCount > 0) {
                cfg.maxCount = maxCount;
            } else if (!cfg) {
                logger.warn(`⚠️ 配置文件含未知列表类型: ${listType}，已忽略`);
            } else {
                logger.warn(`⚠️ 列表 ${listType} 的 maxCount 非法(${maxCount})，保留默认值 ${cfg.maxCount}`);
            }
        });
    }

    /**
     * ✅ 获取指定列表的 maxCount
     * @param {string} listType - 列表类型
     * @returns {number} maxCount（未加载时回退到 LIST_CONFIGS 静态值）
     */
    getMaxCount(listType) {
        return this.current?.listMaxCount?.[listType]
            ?? CONFIG.FETCH_CONFIG.LIST_CONFIGS[listType]?.maxCount;
    }

    /**
     * ✅ 获取当前生效配置（只读副本）
     * @returns {Object|null}
     */
    getCurrent() {
        return this.current ? JSON.parse(JSON.stringify(this.current)) : null;
    }
}

// 导出单例
export const userConfig = new UserConfigManager();
export default userConfig;
