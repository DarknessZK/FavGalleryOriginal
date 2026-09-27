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
     * ✅ 构建默认配置（maxCount 从 LIST_CONFIGS 派生，backup 从 BACKUP_CONFIG 派生）
     * @returns {Object} 默认配置对象
     */
    buildDefault() {
        const listMaxCount = {};
        Object.entries(CONFIG.FETCH_CONFIG.LIST_CONFIGS).forEach(([listType, cfg]) => {
            listMaxCount[listType] = cfg.maxCount;
        });

        // ✅ backup 段单一数据源：静态常量 BACKUP_CONFIG（避免两处硬编码漂移）
        const bc = CONFIG.BACKUP_CONFIG;

        return {
            version: CONFIG.USER_CONFIG.version,
            listMaxCount,
            backup: {
                interval: bc.interval,
                enabled: bc.enabled,
                listBackup: {
                    batchInterval: bc.listBackup.batchInterval,
                    enabled: bc.listBackup.enabled
                },
                downloadBackup: {
                    timeThreshold: bc.downloadBackup.timeThreshold,
                    countThreshold: bc.downloadBackup.countThreshold,
                    enabled: bc.downloadBackup.enabled,
                    immediateBackup: {
                        enabled: bc.downloadBackup.immediateBackup.enabled,
                        delay: bc.downloadBackup.immediateBackup.delay
                    }
                }
            }
        };
    }

    /**
     * ✅ 深合并：以默认值为底，用户配置覆盖（补齐缺失字段）
     * @param {Object} userConfig - 用户配置文件内容
     * @returns {Object} 合并后的完整配置
     */
    _mergeWithDefault(userConfig) {
        const defaults = this.buildDefault();
        const userBackup = userConfig?.backup || {};
        const userListBackup = userBackup.listBackup || {};
        const userDownloadBackup = userBackup.downloadBackup || {};
        const userImmediate = userDownloadBackup.immediateBackup || {};
        const dDefault = defaults.backup.downloadBackup;

        return {
            version: userConfig?.version ?? defaults.version,
            listMaxCount: {
                ...defaults.listMaxCount,
                ...(userConfig?.listMaxCount || {})
            },
            // ✅ backup 逐层深合并：旧 v1 文件缺段自动补默认（深合并即迁移）
            backup: {
                ...defaults.backup,
                ...userBackup,
                listBackup: {
                    ...defaults.backup.listBackup,
                    ...userListBackup
                },
                downloadBackup: {
                    ...defaults.backup.downloadBackup,
                    ...userDownloadBackup,
                    immediateBackup: {
                        ...dDefault.immediateBackup,
                        ...userImmediate
                    }
                }
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

        // 应用到 LIST_CONFIGS + BACKUP_CONFIG（写回内存单例，驱动下游所有读取）
        this._applyToListConfigs();
        this._applyToBackupConfig();

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
     * ✅ 把合法 backup 配置写回 CONFIG.BACKUP_CONFIG（非法项保留当前值 + warn）
     * 消费方（backup-manager / file-logger 等）均运行时读 CONFIG，写回即生效
     * @private
     */
    _applyToBackupConfig() {
        const backup = this.current?.backup;
        if (!backup) return;

        const target = CONFIG.BACKUP_CONFIG;
        const applyNumber = (obj, key, value, path) => {
            if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
                obj[key] = value;
            } else if (value !== undefined) {
                logger.warn(`⚠️ 配置项 ${path} 非法(${value})，保留当前值 ${obj[key]}`);
            }
        };
        const applyBool = (obj, key, value, path) => {
            if (typeof value === 'boolean') {
                obj[key] = value;
            } else if (value !== undefined) {
                logger.warn(`⚠️ 配置项 ${path} 非法(${value})，保留当前值 ${obj[key]}`);
            }
        };

        applyNumber(target, 'interval', backup.interval, 'backup.interval');
        applyBool(target, 'enabled', backup.enabled, 'backup.enabled');
        if (backup.listBackup) {
            applyNumber(target.listBackup, 'batchInterval', backup.listBackup.batchInterval, 'backup.listBackup.batchInterval');
            applyBool(target.listBackup, 'enabled', backup.listBackup.enabled, 'backup.listBackup.enabled');
        }
        const db = backup.downloadBackup;
        if (db) {
            applyNumber(target.downloadBackup, 'timeThreshold', db.timeThreshold, 'backup.downloadBackup.timeThreshold');
            applyNumber(target.downloadBackup, 'countThreshold', db.countThreshold, 'backup.downloadBackup.countThreshold');
            applyBool(target.downloadBackup, 'enabled', db.enabled, 'backup.downloadBackup.enabled');
            if (db.immediateBackup) {
                applyBool(target.downloadBackup.immediateBackup, 'enabled', db.immediateBackup.enabled, 'backup.downloadBackup.immediateBackup.enabled');
                applyNumber(target.downloadBackup.immediateBackup, 'delay', db.immediateBackup.delay, 'backup.downloadBackup.immediateBackup.delay');
            }
        }
    }

    /**
     * ✅ 保存配置（配置面板提交入口，仅 Content Script 侧可调）
     *
     * 流程：与当前配置合并 → 校验非法项回退 → 写盘 → 重新 apply → 返回生效配置
     * @param {Object} fileSystem - 文件系统管理器实例
     * @param {Object} patchConfig - 编辑后的配置（完整或部分，与当前配置深合并）
     * @returns {Promise<Object>} 保存后生效的配置
     * @throws 写盘失败时抛出，由调用方提示用户
     */
    async save(fileSystem, patchConfig = {}) {
        const base = this.current || this.buildDefault();

        // 与当前配置逐层合并（panel 提交完整对象时等价于直接覆盖）
        const merged = this._mergeWithDefault({
            ...base,
            ...patchConfig,
            listMaxCount: { ...(base.listMaxCount || {}), ...(patchConfig.listMaxCount || {}) },
            backup: {
                ...(base.backup || {}),
                ...(patchConfig.backup || {}),
                listBackup: { ...(base.backup?.listBackup || {}), ...(patchConfig.backup?.listBackup || {}) },
                downloadBackup: {
                    ...(base.backup?.downloadBackup || {}),
                    ...(patchConfig.backup?.downloadBackup || {}),
                    immediateBackup: {
                        ...(base.backup?.downloadBackup?.immediateBackup || {}),
                        ...(patchConfig.backup?.downloadBackup?.immediateBackup || {})
                    }
                }
            }
        });
        merged.version = CONFIG.USER_CONFIG.version;

        // 非法值不回退到 undefined，而是沿用当前生效值（避免脏数据落盘）
        this._sanitizeAgainst(merged, this.buildDefaultFromRuntime());

        await fileSystem.writeUserConfig(merged);

        this.current = merged;

        // 重走 apply，写回内存单例后立即生效
        this._applyToListConfigs();
        this._applyToBackupConfig();

        logger.info('✅ 用户配置已保存并生效:', JSON.stringify(this.current));
        return this.getCurrent();
    }

    /**
     * ✅ 以运行时当前值为基准的默认集（供 save 校验回退：非法项→恢复为运行时值）
     */
    buildDefaultFromRuntime() {
        const listMaxCount = {};
        Object.entries(CONFIG.FETCH_CONFIG.LIST_CONFIGS).forEach(([listType, cfg]) => {
            listMaxCount[listType] = cfg.maxCount;
        });
        const bc = CONFIG.BACKUP_CONFIG;
        return {
            version: CONFIG.USER_CONFIG.version,
            listMaxCount,
            backup: JSON.parse(JSON.stringify(bc))
        };
    }

    /**
     * ✅ 校验：非法项回退为基准值（数值需正数且≤10000（maxCount），布尔需 boolean）
     * @private
     */
    _sanitizeAgainst(config, baseline) {
        const isPos = v => typeof v === 'number' && Number.isFinite(v) && v > 0;
        const isBool = v => typeof v === 'boolean';
        const warn = (path, val, fb) => logger.warn(`⚠️ 保存校验：${path} 非法(${val})，回退为(${fb})`);

        Object.entries(config.listMaxCount || {}).forEach(([k, v]) => {
            if (!isPos(v) || v > 10000) {
                warn(`listMaxCount.${k}`, v, baseline.listMaxCount[k]);
                config.listMaxCount[k] = baseline.listMaxCount[k];
            }
        });

        const b = config.backup || {}, bb = baseline.backup || {};
        if (!isPos(b.interval)) { warn('backup.interval', b.interval, bb.interval); b.interval = bb.interval; }
        if (!isBool(b.enabled)) { warn('backup.enabled', b.enabled, bb.enabled); b.enabled = bb.enabled; }
        if (!isPos(b.listBackup?.batchInterval)) { warn('backup.listBackup.batchInterval', b.listBackup?.batchInterval, bb.listBackup.batchInterval); b.listBackup.batchInterval = bb.listBackup.batchInterval; }
        if (!isBool(b.listBackup?.enabled)) { warn('backup.listBackup.enabled', b.listBackup?.enabled, bb.listBackup.enabled); b.listBackup.enabled = bb.listBackup.enabled; }
        if (!isPos(b.downloadBackup?.timeThreshold)) { warn('backup.downloadBackup.timeThreshold', b.downloadBackup?.timeThreshold, bb.downloadBackup.timeThreshold); b.downloadBackup.timeThreshold = bb.downloadBackup.timeThreshold; }
        if (!isPos(b.downloadBackup?.countThreshold)) { warn('backup.downloadBackup.countThreshold', b.downloadBackup?.countThreshold, bb.downloadBackup.countThreshold); b.downloadBackup.countThreshold = bb.downloadBackup.countThreshold; }
        if (!isBool(b.downloadBackup?.enabled)) { warn('backup.downloadBackup.enabled', b.downloadBackup?.enabled, bb.downloadBackup.enabled); b.downloadBackup.enabled = bb.downloadBackup.enabled; }
        if (!isBool(b.downloadBackup?.immediateBackup?.enabled)) { warn('immediateBackup.enabled', b.downloadBackup?.immediateBackup?.enabled, bb.downloadBackup.immediateBackup.enabled); b.downloadBackup.immediateBackup.enabled = bb.downloadBackup.immediateBackup.enabled; }
        if (!isPos(b.downloadBackup?.immediateBackup?.delay)) { warn('immediateBackup.delay', b.downloadBackup?.immediateBackup?.delay, bb.downloadBackup.immediateBackup.delay); b.downloadBackup.immediateBackup.delay = bb.downloadBackup.immediateBackup.delay; }
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
