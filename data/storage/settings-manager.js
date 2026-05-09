// ==========================================
// FavGallery - 设置管理器
// 职责：管理系统设置的读写和持久化
// ==========================================

import { database } from '../database/database.js';
import { backupManager } from '../backup/backup-manager.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('SettingsManager');

/**
 * 获取设置项
 * @param {string} key - 设置键名
 * @param {*} defaultValue - 默认值
 * @returns {Promise<*>} 设置值
 */
export async function getSetting(key, defaultValue = null) {
    try {
        const setting = await database.get('settings', key);
        return setting?.value ?? defaultValue;
    } catch (error) {
        logger.error(`❌ 获取设置失败: ${key}`, error);
        return defaultValue;
    }
}

/**
 * 保存设置项（自动触发备份）
 * @param {string} key - 设置键名
 * @param {*} value - 设置值
 * @returns {Promise<void>}
 */
export async function setSetting(key, value) {
    try {
        await database.save('settings', { key, value });
        
        // ✅ 异步备份到文件系统（符合增量备份规则）
        backupManager.performSelectiveBackup(['settings']).catch(error => {
            logger.warn('⚠️ 设置备份失败:', error.message);
        });
        
        logger.info(`✅ 设置已保存: ${key} = ${JSON.stringify(value)}`);
    } catch (error) {
        logger.error(`❌ 保存设置失败: ${key}`, error);
        throw error;
    }
}

/**
 * 批量获取设置项
 * @param {string[]} keys - 设置键名数组
 * @param {Object} defaults - 默认值对象
 * @returns {Promise<Object>} 设置值对象
 */
export async function getSettings(keys, defaults = {}) {
    const result = {};
    
    for (const key of keys) {
        result[key] = await getSetting(key, defaults[key]);
    }
    
    return result;
}

/**
 * 删除设置项
 * @param {string} key - 设置键名
 * @returns {Promise<void>}
 */
export async function deleteSetting(key) {
    try {
        // ✅ 软删除：标记 isDeleted
        const setting = await database.get('settings', key);
        if (setting) {
            setting.isDeleted = true;
            await database.save('settings', setting);
            
            // 触发备份
            backupManager.performSelectiveBackup(['settings']).catch(error => {
                logger.warn('⚠️ 设置备份失败:', error.message);
            });
            
            logger.info(`✅ 设置已删除: ${key}`);
        }
    } catch (error) {
        logger.error(`❌ 删除设置失败: ${key}`, error);
        throw error;
    }
}

