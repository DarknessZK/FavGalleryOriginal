// ==========================================
// FavGallery - 备份管理器
// 职责：管理数据备份和恢复，支持跨平台社交内容备份
// ==========================================

import { createLogger } from '../../utils/logger.js';
import { CONFIG } from '../../config/constants.js';
import { fileSystem } from '../storage/file-system.js';
import { database } from '../database/database.js';

const logger = createLogger('BackupManager');

class BackupManager {
    constructor() {
        this.isBackingUp = false;
        // ❌ 已移除：this.lastBackupTime - 没有实际用途，manifest.json 中已有持久化的 lastBackupTime
        this.backupCount = 0;
        this.backupTimer = null;
        
        // ✅ completed_works 备份队列
        this.completedWorksBackupQueue = [];
        this.isProcessingQueue = false;
    }

    /**
     * 计算数据的 SHA-256 哈希值
     * 用于检测数据是否发生变化
     * 
     * @param {Object|Array} data - 要计算哈希的数据
     * @returns {string} 哈希字符串
     */
    _calculateHash(data) {
        try {
            const jsonString = JSON.stringify(data);
            const encoder = new TextEncoder();
            const dataBuffer = encoder.encode(jsonString);
            
            // 使用同步方式计算哈希（简化实现）
            let hash = 0;
            for (let i = 0; i < dataBuffer.length; i++) {
                const char = dataBuffer[i];
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32bit integer
            }
            return Math.abs(hash).toString(16);
        } catch (error) {
            logger.error('❌ 计算哈希失败:', error);
            throw error;
        }
    }

    /**
     * 根据时间戳获取季度信息
     * 
     * @param {number} timestamp - Unix 时间戳（毫秒）
     * @returns {Object} 包含年份和季度的对象 { year: 2024, quarter: 1 }
     */
    getQuarterInfo(timestamp) {
        const date = new Date(timestamp);
        const year = date.getFullYear();
        const month = date.getMonth() + 1; // 1-12
        const quarter = Math.ceil(month / 3); // 1-4
        
        return { year, quarter };
    }

    /**
     * 生成季度键名
     * 
     * @param {number} timestamp - 时间戳
     * @returns {string} 季度键名，如 "2024_Q1"
     */
    _getQuarterKey(timestamp) {
        const { year, quarter } = this.getQuarterInfo(timestamp);
        return `${year}_Q${quarter}`;
    }

    /**
     * 生成备份文件路径
     * 格式：{basePath}/{dataType}/{dataType}_{year}_Q{quarter}.json
     * 
     * @param {string} basePath - 基础路径（根目录句柄名称）
     * @param {string} dataType - 数据类型（'works', 'authors', 'collects'）
     * @param {number} timestamp - 数据的时间戳（用于计算季度）
     * @returns {string} 备份文件路径
     */
    generateBackupPath(basePath, dataType, timestamp) {
        const { year, quarter } = this.getQuarterInfo(timestamp);
        const fileName = `${dataType}_${year}_Q${quarter}.json`;
        
        return `${basePath}/${dataType}/${fileName}`;
    }

    /**
     * 批量生成备份文件路径（用于分片存储）
     * 
     * @param {string} basePath - 基础路径
     * @param {string} dataType - 数据类型
     * @param {Array<Object>} dataList - 数据列表（需要有 createTime 字段）
     * @returns {Map<string, Array<Object>>} 按季度分组的数据 Map
     */
    groupDataByQuarter(basePath, dataType, dataList) {
        const grouped = new Map();
        
        for (const item of dataList) {
            const timestamp = item.createTime || item.lastUpdate || Date.now();
            const filePath = this.generateBackupPath(basePath, dataType, timestamp);
            
            if (!grouped.has(filePath)) {
                grouped.set(filePath, []);
            }
            grouped.get(filePath).push(item);
        }
        
        logger.info(`📊 数据分片完成: ${dataList.length} 条数据分为 ${grouped.size} 个季度文件`);
        
        return grouped;
    }

    /**
     * 加载 manifest
     * @returns {Object} manifest 对象
     */
    async _loadManifest() {
        try {
            logger.debug('📖 尝试加载 manifest.json...');
            // ✅ 使用配置中的完整路径，按平台分类
            const platform = CONFIG.ACTIVE_PLATFORM;
            const content = await fileSystem.readTextFile(`${CONFIG.FILE_SYSTEM.METADATA_DIR}/${platform}/manifest.json`);
            
            // ✅ 防御性检查：如果文件不存在，返回默认对象
            if (!content) {
                logger.info('ℹ️ manifest.json 不存在，使用默认值');
                return {
                    version: '1.0',
                    lastBackupTime: 0,
                    hashes: {}
                };
            }
            
            logger.debug('✅ manifest.json 读取成功，长度:', content.length);
            const parsed = JSON.parse(content);
            logger.debug('✅ manifest.json 解析成功');
            return parsed;
        } catch (error) {
            logger.warn('⚠️ 加载 manifest 失败:', error?.message || '未知错误');
            logger.warn('   错误类型:', typeof error);
            logger.warn('   错误堆栈:', error?.stack || '无堆栈');
            // manifest 不存在或解析失败，返回空对象
            return {
                version: '1.0',
                lastBackupTime: 0,
                hashes: {}
            };
        }
    }

    /**
     * 保存 manifest
     * @param {Object} manifest - manifest 对象
     */
    async _saveManifest(manifest) {
        const content = JSON.stringify(manifest, null, 2);
        // ✅ 使用配置中的完整路径，按平台分类
        const platform = CONFIG.ACTIVE_PLATFORM;
        await fileSystem.writeTextFile(`${CONFIG.FILE_SYSTEM.METADATA_DIR}/${platform}/manifest.json`, content);
    }

    /**
     * 检查是否需要备份（基于哈希对比）
     * 
     * @param {string} oldHash - 旧数据的哈希值
     * @param {string} newHash - 新数据的哈希值
     * @returns {boolean} 是否需要备份
     */
    needsBackup(oldHash, newHash) {
        if (!oldHash || !newHash) {
            return true; // 没有旧哈希，需要备份
        }
        
        const needsBackup = oldHash !== newHash;
        
        if (needsBackup) {
            logger.info('🔄 检测到数据变化，需要备份');
        } else {
            logger.info('✅ 数据无变化，跳过备份');
        }
        
        return needsBackup;
    }

    /**
     * 验证备份数据完整性
     * 
     * @param {Object} backupData - 备份数据（包含 metadata 和 data）
     * @param {string} expectedHash - 期望的哈希值
     * @returns {Promise<boolean>} 是否完整
     */
    async verifyBackupIntegrity(backupData, expectedHash) {
        try {
            const actualHash = this._calculateHash(backupData.data);
            const isValid = actualHash === expectedHash;
            
            if (!isValid) {
                logger.warn('⚠️ 备份数据完整性验证失败');
                logger.warn(`   期望哈希: ${expectedHash}`);
                logger.warn(`   实际哈希: ${actualHash}`);
            }
            
            return isValid;
        } catch (error) {
            logger.error('❌ 验证备份完整性失败:', error);
            return false;
        }
    }

    /**
     * 执行全量备份
     * 备份所有类型的数据（works, authors, collects, relations 等）
     * 
     * @param {Object} options - 备份选项
     * @param {boolean} options.force - 是否强制备份（跳过哈希检查）
     * @returns {Promise<Object>} 备份结果
     */
    async performFullBackup(options = {}) {
        const { force = false } = options;
        
        if (!fileSystem.getRootDirectoryHandle()) {
            logger.warn('⚠️ 未设置根目录，跳过备份');
            return { success: false, reason: 'no_root_directory' };
        }
        
        if (this.isBackingUp) {
            logger.warn('⚠️ 备份正在进行中，跳过本次请求');
            return { success: false, reason: 'backup_in_progress' };
        }
        
        this.isBackingUp = true;
        const startTime = Date.now();
        
        try {
            logger.info('🔄 开始全量备份...');

            // 1. 加载上次备份的 manifest
            const manifest = await this._loadManifest();
            
            // ✅ 防御性检查：确保 manifest 不是 null
            if (!manifest) {
                logger.warn('⚠️ manifest 为空，使用默认值');
                return { success: false, reason: 'manifest_load_failed' };
            }

            // 2. 备份 authors 表
            await this._backupTableWithHash('authors', manifest, force);

            // 3. 备份 collects 表
            await this._backupTableWithHash('collects', manifest, force);

            // 4. 备份 author_groups 表
            await this._backupTableWithHash('author_groups', manifest, force);

            // 5. 备份 liked_group 表
            await this._backupTableWithHash('liked_group', manifest, force);

            // 6. 备份 works 表（按季度分片）
            await this._backupWorksByQuarter(manifest, force);

            // 7. 备份 relations 表
            await this._backupTableWithHash('relations', manifest, force);

            // 8. 备份 completed_works 表
            await this._backupTableWithHash('completed_works', manifest, force);

            // 9. 保存 manifest
            manifest.lastBackupTime = Date.now();
            await this._saveManifest(manifest);

            const duration = Date.now() - startTime;
            // ❌ 已移除：this.lastBackupTime = Date.now() - 没有实际用途，manifest.json 中已有持久化的 lastBackupTime
            this.backupCount++;
            
            logger.info(`✅ 全量备份完成 (耗时: ${duration}ms)`);
            
            return {
                success: true,
                duration
                // ❌ 已移除：backupTime - 调用者如果需要时间，可以从 manifest.json 读取
            };
            
        } catch (error) {
            logger.error('❌ 全量备份失败:', error);
            logger.error('   错误类型:', typeof error);
            logger.error('   错误消息:', error?.message || '无消息');
            logger.error('   错误堆栈:', error?.stack || '无堆栈');
            return {
                success: false,
                error: error?.message || String(error)
            };
        } finally {
            this.isBackingUp = false;
        }
    }

    /**
     * 使用哈希对比备份单个表
     * @param {string} tableName - 表名
     * @param {Object} manifest - manifest 对象
     * @param {boolean} force - 是否强制备份
     */
    async _backupTableWithHash(tableName, manifest, force = false) {
        try {
            // ✅ completed_works 使用 NDJSON 增量备份
            if (tableName === 'completed_works') {
                await this._backupCompletedWorksNDJSON(manifest, force);
                return;
            }
            
            // ✅ settings 使用 JSON 格式（而非 .js）
            const isSettings = tableName === 'settings';
            
            // 获取当前数据
            const currentData = await database.getAll(tableName);
            
            if (!currentData || currentData.length === 0) {
                logger.info(`ℹ️ ${tableName}: 无数据，跳过备份`);
                return;
            }

            // 计算当前哈希
            const currentHash = this._calculateHash(currentData);
            const lastHash = manifest.hashes?.[tableName];

            // 对比哈希
            if (!force && lastHash === currentHash) {
                logger.info(`ℹ️ ${tableName}: 无变化，跳过备份`);
                return;
            }

            // 有变化才写入
            logger.info(`📝 ${tableName}: 检测到变化，执行备份 (${currentData.length} 条)`);
            
            // ✅ settings 使用 JSON 格式，其他表使用 JS 格式
            if (isSettings) {
                await this._backupSettingsAsJSON(currentData);
            } else {
                await this._backupToFileSystem(tableName, { [tableName]: currentData });
            }

            // 更新哈希
            if (!manifest.hashes) {
                manifest.hashes = {};
            }
            manifest.hashes[tableName] = currentHash;
        } catch (error) {
            logger.error(`❌ 备份 ${tableName} 失败:`, error);
            logger.error('   错误消息:', error?.message || '无消息');
            throw error;
        }
    }

    /**
     * NDJSON 增量备份 completed_works 表
     * @param {Object} manifest - manifest 对象（保留参数以兼容调用接口，但不使用）
     * @param {boolean} force - 是否强制备份（保留参数以兼容调用接口，但不使用）
     */
    async _backupCompletedWorksNDJSON(manifest, force = false) {
        try {
            // ✅ 将备份请求加入队列（不需要 manifest）
            this.completedWorksBackupQueue.push({});
            
            // ✅ 如果正在处理队列，等待当前处理完成
            if (this.isProcessingQueue) {
                logger.info('ℹ️ completed_works 备份队列处理中，已加入队列');
                return;
            }
            
            // ✅ 开始处理队列
            await this._processCompletedWorksQueue();
        } catch (error) {
            logger.error('❌ 备份 completed_works 失败:', error);
            logger.error('   错误消息:', error?.message || '无消息');
            throw error;
        }
    }

    /**
     * 处理 completed_works 备份队列
     * @private
     */
    async _processCompletedWorksQueue() {
        if (this.isProcessingQueue || this.completedWorksBackupQueue.length === 0) {
            return;
        }
        
        this.isProcessingQueue = true;
        
        try {
            while (this.completedWorksBackupQueue.length > 0) {
                // ✅ 先取出请求，但不立即移除
                const request = this.completedWorksBackupQueue[0];
                
                try {
                    // 获取当前数据
                    const currentData = await database.getAll('completed_works');
                    
                    if (!currentData || currentData.length === 0) {
                        logger.info('ℹ️ completed_works: 无数据，跳过备份');
                        // ✅ 成功后才移除请求
                        this.completedWorksBackupQueue.shift();
                        continue;
                    }

                    // ✅ 直接追加所有记录到 NDJSON 文件（不对比 workId，不计算哈希）
                    const platform = CONFIG.ACTIVE_PLATFORM;
                    const filePath = `${CONFIG.FILE_SYSTEM.METADATA_DIR}/${platform}/completed_works.ndjson`;
                    
                    logger.info(`📝 completed_works: 执行增量备份 (${currentData.length} 条)`);
                    
                    // 使用工具方法追加到文件
                    await fileSystem.appendNDJSON(filePath, currentData);
                    logger.info(`✅ completed_works 增量备份成功 (${currentData.length} 条)`);
                    
                    // ✅ 成功后才移除请求
                    this.completedWorksBackupQueue.shift();
                } catch (error) {
                    logger.error('❌ 处理队列中的备份请求失败:', error);
                    logger.error('   错误消息:', error?.message || '无消息');
                    // ✅ 失败时不移除请求，保留在队列中
                    // 停止处理后续请求
                    break;
                }
            }
            
            if (this.completedWorksBackupQueue.length === 0) {
                logger.info('✅ completed_works 备份队列处理完成');
            } else {
                logger.warn(`⚠️ completed_works 备份队列还有 ${this.completedWorksBackupQueue.length} 个未处理的请求`);
            }
        } finally {
            this.isProcessingQueue = false;
        }
    }

    /**
     * 按季度分片备份 works 表
     * @param {Object} manifest - manifest 对象
     * @param {boolean} force - 是否强制备份
     */
    async _backupWorksByQuarter(manifest, force = false) {
        try {
            // 获取所有作品
            const allWorks = await database.getAll('works');
            
            if (!allWorks || allWorks.length === 0) {
                logger.info('ℹ️ works: 无数据，跳过备份');
                return;
            }

            // 按季度分组
            const worksByQuarter = {};
            for (const work of allWorks) {
                const quarterKey = this._getQuarterKey(work.createTime);
                if (!worksByQuarter[quarterKey]) {
                    worksByQuarter[quarterKey] = [];
                }
                worksByQuarter[quarterKey].push(work);
            }

            // 备份每个季度的作品
            for (const [quarterKey, works] of Object.entries(worksByQuarter)) {
                const currentHash = this._calculateHash(works);
                const lastHash = manifest.hashes?.[`works_${quarterKey}`];

                if (!force && lastHash === currentHash) {
                    logger.info(`ℹ️ works_${quarterKey}: 无变化，跳过备份`);
                    continue;
                }

                logger.info(`📝 works_${quarterKey}: 检测到变化，执行备份 (${works.length} 个作品)`);
                
                // ✅ 保存到按平台分类的 works 目录
                const platform = CONFIG.ACTIVE_PLATFORM;
                const fileName = `${CONFIG.FILE_SYSTEM.METADATA_DIR}/${platform}/works/works_${quarterKey}.json`;
                const content = JSON.stringify({ works, quarter: quarterKey }, null, 2);
                await fileSystem.writeTextFile(fileName, content);

                // 更新哈希
                if (!manifest.hashes) {
                    manifest.hashes = {};
                }
                manifest.hashes[`works_${quarterKey}`] = currentHash;
            }
        } catch (error) {
            logger.error('❌ 备份 works 失败:', error);
            logger.error('   错误消息:', error?.message || '无消息');
            throw error;
        }
    }

    /**
     * 异步备份数据到文件系统
     *
     * @param {string} dataType - 数据类型（如 'authors_base', 'liked_works'）
     * @param {*} data - 要备份的数据
     * @private
     */
    async _backupToFileSystem(dataType, data) {
        if (!fileSystem.getRootDirectoryHandle()) {
            logger.warn('⚠️ 未设置根目录，跳过文件系统备份');
            return;
        }

        try {
            // ✅ 按平台分类保存
            const platform = CONFIG.ACTIVE_PLATFORM;
            const filePath = `${CONFIG.FILE_SYSTEM.METADATA_DIR}/${platform}/${dataType}.js`;
            const serialized = fileSystem.serializeData(data, dataType);
            await fileSystem.writeTextFile(filePath, serialized);
            logger.info(`💾 文件系统备份成功: ${dataType}`);
        } catch (error) {
            logger.error(`❌ 文件系统备份失败: ${dataType}`, error);
            throw error;
        }
    }

    /**
     * 备份 settings 表为 JSON 格式
     * @param {Array} settingsData - 设置数据数组
     * @private
     */
    async _backupSettingsAsJSON(settingsData) {
        if (!fileSystem.getRootDirectoryHandle()) {
            logger.warn('⚠️ 未设置根目录，跳过 settings 备份');
            return;
        }

        try {
            // ✅ 按平台分类保存为 JSON 格式
            const platform = CONFIG.ACTIVE_PLATFORM;
            const filePath = `${CONFIG.FILE_SYSTEM.METADATA_DIR}/${platform}/settings.json`;
            
            // 直接序列化为 JSON 数组
            const content = JSON.stringify(settingsData, null, 2);
            await fileSystem.writeTextFile(filePath, content);
            
            logger.info(`💾 Settings 备份成功 (${settingsData.length} 条)`);
        } catch (error) {
            logger.error('❌ Settings 备份失败:', error);
            throw error;
        }
    }

    /**
     * 启动定时备份
     * 每隔一定时间全量备份一次所有数据
     */
    startPeriodicBackup() {
        // 清除之前的定时器（如果有）
        if (this.backupTimer) {
            clearInterval(this.backupTimer);
        }
        
        // ✅ 从配置中读取备份间隔（默认 1 分钟，用于测试）
        const BACKUP_INTERVAL = CONFIG.BACKUP_CONFIG?.interval || 60 * 1000; // 1 分钟
        
        this.backupTimer = setInterval(async () => {
            try {
                logger.info('🔄 开始定时全量备份...');
                await this.performFullBackup();
                logger.info('✅ 定时全量备份完成');
            } catch (error) {
                logger.error('❌ 定时备份失败:', error);
            }
        }, BACKUP_INTERVAL);
        
        logger.info(`⏰ 定时备份已启动（间隔: ${BACKUP_INTERVAL / 1000} 秒）`);
    }

    /**
     * 停止定时备份
     */
    stopPeriodicBackup() {
        if (this.backupTimer) {
            clearInterval(this.backupTimer);
            this.backupTimer = null;
            logger.info('⏹️ 定时备份已停止');
        }
    }

    /**
     * 轻量级备份指定表
     * @param {string[]} tableNames - 要备份的表名数组，如 ['completed_works']
     * @returns {Promise<Object>} 备份结果
     */
    async performSelectiveBackup(tableNames) {
        // 参数验证
        if (!tableNames || !Array.isArray(tableNames) || tableNames.length === 0) {
            throw new Error('必须指定至少一个表名');
        }
        
        // ✅ completed_works 使用队列机制，不需要检查 isBackingUp
        // ✅ 其他表仍然需要检查并发控制（如果需要的话）
        if (tableNames.includes('completed_works')) {
            // completed_works 会进入队列，不会被跳过
            logger.info('ℹ️ completed_works 备份请求已加入队列');
        } else {
            // 其他表检查是否正在备份
            if (this.isBackingUp) {
                logger.info('ℹ️ 备份正在进行中，跳过本次请求');
                return { success: false, reason: 'backup_in_progress' };
            }
        }
        
        // 检查根目录
        if (!fileSystem.getRootDirectoryHandle()) {
            logger.warn('⚠️ 未设置根目录，跳过备份');
            return { success: false, reason: 'no_root_directory' };
        }
        
        this.isBackingUp = true;
        
        try {
            // 加载 manifest
            const manifest = await this._loadManifest();
            if (!manifest) {
                logger.warn('⚠️ manifest 为空，使用默认值');
                return { success: false, reason: 'manifest_load_failed' };
            }
            
            logger.info(`🔄 开始选择性备份 (${tableNames.join(', ')})...`);
            
            // ✅ 跟踪是否有备份失败
            let hasFailure = false;
            
            // 遍历指定的表，调用 _backupTableWithHash
            for (const tableName of tableNames) {
                try {
                    if (tableName === 'works') {
                        // ✅ works 需要分片备份
                        await this._backupWorksByQuarter(manifest, false);
                    } else {
                        await this._backupTableWithHash(tableName, manifest, false);
                    }
                } catch (error) {
                    logger.error(`❌ 备份 ${tableName} 失败:`, error);
                    hasFailure = true;
                    // 继续备份其他表，不中断
                }
            }
            
            // ✅ 只有所有表都备份成功，才更新 manifest
            if (hasFailure) {
                logger.warn('⚠️ 部分表备份失败，不更新 manifest');
                return { success: false, reason: 'partial_failure' };
            }
            
            // 保存 manifest
            // ✅ completed_works 不更新 hashes，但更新 lastBackupTime 用于记录备份时间
            manifest.lastBackupTime = Date.now();
            await this._saveManifest(manifest);
            
            logger.info(`✅ 选择性备份完成 (${tableNames.join(', ')})`);
            return { success: true, tables: tableNames };
        } finally {
            this.isBackingUp = false;
        }
    }

    /**
     * 获取备份状态
     * 
     * @returns {Object} 备份状态信息
     * @note lastBackupTime 已从返回值中移除，如需获取最后备份时间，请从 manifest.json 读取
     */
    getBackupStatus() {
        return {
            isBackingUp: this.isBackingUp,
            // ❌ 已移除：lastBackupTime - 没有实际用途，manifest.json 中已有持久化的 lastBackupTime
            backupCount: this.backupCount
        };
    }
}

// 导出单例
export const backupManager = new BackupManager();
export default backupManager;
