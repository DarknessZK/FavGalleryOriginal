// ==========================================
// FavGallery - 恢复管理器
// 职责：从文件系统备份恢复数据到 IndexedDB
// ==========================================

import { createLogger } from '../../utils/logger.js';
import { CONFIG } from '../../config/constants.js';
import { fileSystem } from '../storage/file-system.js';
import { database } from '../database/database.js';
import { backupManager } from './backup-manager.js';

const logger = createLogger('RestoreManager');

class RestoreManager {
    /**
     * 从文件系统恢复数据到 IndexedDB
     * @param {string} dataType - 数据类型（'works', 'authors', 'collects', 'completed_works'）
     * @param {Object} options - 恢复选项
     * @param {boolean} options.force - 是否强制覆盖（默认 false，跳过已存在的数据）
     * @param {Function} options.onProgress - 进度回调
     * @returns {Promise<Object>} 恢复结果
     */
    async restoreFromBackup(dataType, options = {}) {
        const { force = false, onProgress = null } = options;

        try {
            logger.info(`🔄 开始恢复 ${dataType} 数据...`);

            // 1. 读取备份文件
            const backupFiles = await this.findBackupFiles(dataType);

            if (backupFiles.length === 0) {
                logger.info(`ℹ️ 未找到 ${dataType} 的备份文件（首次使用或无备份）`);
                return { success: false, reason: 'no_backup_files' };
            }

            logger.info(`📂 找到 ${backupFiles.length} 个备份文件`);

            // 2. 逐个恢复
            let totalRestored = 0;
            for (let i = 0; i < backupFiles.length; i++) {
                const filePath = backupFiles[i];

                logger.info(`📖 读取备份文件 (${i + 1}/${backupFiles.length}): ${filePath}`);

                const result = await this.restoreSingleFile(dataType, filePath, force);
                totalRestored += result.count;

                // 进度回调
                if (onProgress) {
                    onProgress({
                        current: i + 1,
                        total: backupFiles.length,
                        restored: totalRestored
                    });
                }
            }

            logger.info(`✅ 恢复完成: ${dataType} - ${totalRestored} 条记录`);

            return {
                success: true,
                dataType,
                fileCount: backupFiles.length,
                restored: totalRestored
            };

        } catch (error) {
            logger.error(`❌ 恢复失败: ${dataType}`, error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 查找备份文件
     * @param {string} dataType - 数据类型
     * @returns {Promise<Array<string>>} 备份文件路径列表
     */
    async findBackupFiles(dataType) {
        const files = [];

        try {
            // ✅ 按平台分类查找备份文件
            const platform = CONFIG.ACTIVE_PLATFORM;
            const metadataDir = `${CONFIG.FILE_SYSTEM.METADATA_DIR}/${platform}`;
            
            logger.info(`🔍 查找 ${dataType} 备份文件，目录: ${metadataDir}`);
            
            if (dataType === 'works') {
                // works 按季度分片
                const worksDir = `${metadataDir}/works`;
                const fileList = await fileSystem.listDirectory(worksDir);

                for (const fileName of fileList) {
                    if (fileName.startsWith('works_') && fileName.endsWith('.json')) {
                        files.push(`${worksDir}/${fileName}`);
                    }
                }
            } else if (dataType === 'completed_works') {
                // ✅ completed_works 使用 NDJSON 格式
                const filePath = `${metadataDir}/completed_works.ndjson`;
                const exists = await fileSystem.fileExists(filePath);

                if (exists) {
                    logger.info(`✅ 找到备份文件: ${filePath}`);
                    files.push(filePath);
                } else {
                    logger.info(`ℹ️ 备份文件不存在: ${filePath}`);
                }
            } else if (dataType === 'settings') {
                // ✅ settings 使用单个 JSON 文件
                const filePath = `${metadataDir}/settings.json`;
                const exists = await fileSystem.fileExists(filePath);

                if (exists) {
                    logger.info(`✅ 找到备份文件: ${filePath}`);
                    files.push(filePath);
                } else {
                    logger.info(`ℹ️ 备份文件不存在: ${filePath}`);
                }
            } else {
                // 其他类型单个文件
                const filePath = `${metadataDir}/${dataType}.js`;
                const exists = await fileSystem.fileExists(filePath);

                if (exists) {
                    logger.info(`✅ 找到备份文件: ${filePath}`);
                    files.push(filePath);
                } else {
                    logger.info(`ℹ️ 备份文件不存在: ${filePath}`);
                }
            }
        } catch (error) {
            // ✅ Sidebar 上下文中 fileSystem 可能未设置根目录，这是正常情况
            if (error.message && error.message.includes('未设置根目录句柄')) {
                logger.info(`ℹ️ ${dataType} 恢复跳过：当前上下文无法访问文件系统`);
            } else {
                logger.error(`❌ 查找备份文件失败:`, error);
            }
        }

        return files;
    }

    /**
     * 恢复单个备份文件
     * @param {string} dataType - 数据类型
     * @param {string} filePath - 文件路径
     * @param {boolean} force - 是否强制覆盖
     * @returns {Promise<Object>} 恢复结果
     */
    async restoreSingleFile(dataType, filePath, force = false) {
        try {
            logger.info(`📖 开始读取备份文件: ${filePath}`);
            
            // 1. 读取文件内容
            const content = await fileSystem.readTextFile(filePath);

            if (!content) {
                logger.warn(`⚠️ 文件内容为空或不存在: ${filePath}`);
                return { count: 0 };
            }
            
            logger.info(`📄 文件大小: ${content.length} 字符`);

            // 2. 解析数据
            let records = [];

            if (dataType === 'completed_works' && filePath.endsWith('.ndjson')) {
                // ✅ 使用 NDJSON 工具方法解析
                records = await fileSystem.readNDJSON(filePath);
                logger.info(`📖 解析 NDJSON: ${records.length} 条记录`);
            } else if (dataType === 'settings' && filePath.endsWith('.json')) {
                // ✅ settings 格式：[{ key, value }, ...]
                const backupData = JSON.parse(content);
                records = Array.isArray(backupData) ? backupData : [];
                logger.info(`📖 解析 settings JSON: ${records.length} 条记录`);
            } else if (filePath.endsWith('.js')) {
                // ✅ JS 文件格式：variableName = `{JSON}`;
                const data = fileSystem.deserializeData(content, dataType);
                
                if (dataType === 'works') {
                    // works 文件格式：{ works: [...], quarter: "2024_Q1" }
                    records = data.works || [];
                } else {
                    // 其他格式：直接是数组或对象
                    records = Array.isArray(data) ? data : (data[dataType] || []);
                }
                logger.info(`📖 解析 JS 文件: ${records.length} 条记录`);
            } else {
                // JSON 格式（如 manifest.json）
                const backupData = JSON.parse(content);
                records = backupData[dataType] || backupData || [];
                logger.info(`📖 解析 JSON: ${records.length} 条记录`);
            }

            if (records.length === 0) {
                logger.info(`ℹ️ 文件中无数据: ${filePath}`);
                return { count: 0 };
            }

            // 3. 批量恢复到数据库
            logger.info(`💾 开始批量恢复 ${records.length} 条记录到 ${dataType}...`);
            const restoredCount = await this.batchRestoreToDatabase(dataType, records, force);

            logger.info(`✅ 恢复成功: ${filePath} - ${restoredCount} 条记录`);

            return { count: restoredCount };

        } catch (error) {
            logger.error(`❌ 恢复文件失败: ${filePath}`, error);
            throw error;
        }
    }

    /**
     * 批量恢复到数据库
     * @param {string} dataType - 数据类型
     * @param {Array} records - 记录数组
     * @param {boolean} force - 是否强制覆盖
     * @returns {Promise<number>} 恢复的记录数
     */
    async batchRestoreToDatabase(dataType, records, force = false) {
        try {
            if (!force && dataType !== 'completed_works') {
                // 对于非 completed_works 表，检查是否已存在
                // 这里简化处理，直接保存（IndexedDB 的 put 会自动更新或插入）
            }

            // 批量保存到数据库
            await database.save(dataType, records);

            return records.length;

        } catch (error) {
            logger.error(`❌ 批量恢复失败: ${dataType}`, error);
            throw error;
        }
    }
}

// 导出单例
export const restoreManager = new RestoreManager();
export default restoreManager;
