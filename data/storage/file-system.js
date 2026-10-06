// ==========================================
// FavGallery - 文件系统管理器
// 职责：提供基础文件系统操作（IndexedDB 主存储 + 文件系统异步备份）
// 说明：仅用于用户个人数据的本地备份和整理
// ==========================================

import { CONFIG } from '../../config/constants.js';
import { database } from '../database/database.js';
import { createLogger } from '../../utils/logger.js';
import { initFileLogger } from '../../utils/file-logger.js';
import { sanitizeForFileSystem } from '../../utils/helpers.js';

const logger = createLogger('FileSystem');

/**
 * 文件系统管理类
 * 使用 File System Access API 提供本地文件备份功能
 *
 * 架构设计：
 * - IndexedDB 作为主存储（快速读写）
 * - 文件系统作为异步备份（便于用户管理和迁移）
 */
class FileSystem {
    constructor() {
        /** @type {FileSystemDirectoryHandle|null} 根目录句柄 */
        this.rootDirectoryHandle = null;
        
        /** @type {boolean} 是否已初始化 */
        this.initialized = false;
        
        /** @type {boolean} 数据库是否已初始化 */
        this.dbInitialized = false;
        
        /** @type {NodeJS.Timeout|null} 定时备份定时器 */
        this.backupTimer = null;
        
        /** @type {Map<string, boolean>} 写入锁映射 */
        this.writeLocks = new Map();
        
        // 从配置中读取路径
        this.appDataDir = CONFIG.FILE_SYSTEM.APP_DATA_DIR;
        this.metadataDir = CONFIG.FILE_SYSTEM.METADATA_DIR;
        this.jsDir = CONFIG.FILE_SYSTEM.JS_DIR;
    }

    /**
     * 设置根目录句柄
     * @param {FileSystemDirectoryHandle} handle - 根目录句柄
     */
    setRootDirectory(handle) {
        this.rootDirectoryHandle = handle;
        logger.info('📁 根目录已设置:', handle.name);
    }

    /**
     * 初始化文件系统管理器
     */
    async init() {
        if (this.initialized) {
            logger.info('✅ 文件系统管理器已初始化');
            return;
        }

        if (!this.rootDirectoryHandle) {
            logger.error('❌ 未设置根目录句柄，请先调用 setRootDirectory()');
            throw new Error('未设置根目录句柄');
        }

        // 初始化 IndexedDB
        await this.initDatabase();
        
        // ✅ 初始化文件日志系统
        await initFileLogger(this);
        
        // ✅ 启动定时备份（由 backupManager 管理）
        if (CONFIG.BACKUP_CONFIG?.enabled) {
            import('../backup/backup-manager.js').then(({ backupManager }) => {
                backupManager.startPeriodicBackup();
            });
        } else {
            logger.info('⚠️ 定时备份已禁用');
        }

        this.initialized = true;
        logger.info('✅ 文件系统管理器初始化完成');
    }

    // ==========================================
    // 初始化与目录管理
    // ==========================================

    /**
     * 初始化 IndexedDB
     */
    async initDatabase() {
        if (!this.dbInitialized) {
            await database.init();
            this.dbInitialized = true;
            logger.info('✅ IndexedDB 已初始化');
        }
    }

    /**
     * 设置已授权的目录句柄（从持久化存储恢复）
     *
     * @param {FileSystemDirectoryHandle} handle - 目录句柄
     */
    async setDirectoryHandle(handle) {
        this.rootDirectoryHandle = handle;
        logger.info(`✅ 恢复目录句柄: ${handle.name}`);

        // 验证目录是否仍然可访问
        try {
            await this._ensureDirectories();
        } catch (error) {
            logger.warn('⚠️ 目录访问失败，可能需要重新授权:', error.message);
            throw error;
        }
    }

    /**
     * 确保必要的子目录存在
     * @private
     */
    async _ensureDirectories() {
        if (!this.rootDirectoryHandle) {
            throw new Error('未设置根目录句柄');
        }

        // ✅ 创建应用数据根目录
        await this._getOrCreateDirectory(this.rootDirectoryHandle, this.appDataDir);
        
        // ✅ 获取当前激活的平台
        const platform = CONFIG.ACTIVE_PLATFORM;
        
        // ✅ 创建按平台分类的目录
        const metadataPlatformDir = `${this.metadataDir}/${platform}`;
        const logsPlatformDir = `${CONFIG.FILE_SYSTEM.LOG_DIR}/${platform}`;
        
        await this._getOrCreateDirectory(this.rootDirectoryHandle, metadataPlatformDir);
        await this._getOrCreateDirectory(this.rootDirectoryHandle, logsPlatformDir);
        await this._getOrCreateDirectory(this.rootDirectoryHandle, this.jsDir);
        
        // ✅ 创建 works 子目录（用于季度分片）
        const worksDir = `${metadataPlatformDir}/works`;
        await this._getOrCreateDirectory(this.rootDirectoryHandle, worksDir);

        logger.debug('✅ 必要目录已确保存在');
    }

    /**
     * 获取平台特定的元数据目录路径
     * @param {string} [platform] - 平台名称（默认为当前激活平台）
     * @returns {string} 平台元数据目录路径
     */
    getMetadataDir(platform = CONFIG.ACTIVE_PLATFORM) {
        return `${this.metadataDir}/${platform}`;
    }

    /**
     * 递归获取或创建目录
     *
     * @param {FileSystemDirectoryHandle} parentHandle - 父目录句柄
     * @param {string} dirPath - 目录路径
     * @returns {Promise<FileSystemDirectoryHandle>} 最终目录句柄
     * @private
     */
    async _getOrCreateDirectory(parentHandle, dirPath) {
        const parts = dirPath.split('/').filter(part => part.length > 0);
        let currentHandle = parentHandle;

        for (const part of parts) {
            // ✅ 防御性检查：清理目录名中的非法字符
            const safePart = sanitizeForFileSystem(part);
            currentHandle = await currentHandle.getDirectoryHandle(safePart, { create: true });
        }

        return currentHandle;
    }

    // ==========================================
    // 文件读写基础方法
    // ==========================================

    /**
     * 获取文件句柄（自动创建目录）
     *
     * @param {string} filePath - 文件路径（相对于根目录）
     * @param {boolean} create - 如果文件不存在是否创建
     * @returns {Promise<FileSystemFileHandle>} 文件句柄
     * @private
     */
    async _getFileHandle(filePath, create = true) {
        if (!this.rootDirectoryHandle) {
            throw new Error('未设置根目录句柄');
        }

        const parts = filePath.split('/');
        const fileName = parts.pop();

        let parentHandle = this.rootDirectoryHandle;
        if (parts.length > 0) {
            const dirPath = parts.join('/');
            parentHandle = await this._getOrCreateDirectory(this.rootDirectoryHandle, dirPath);
        }

        return await parentHandle.getFileHandle(fileName, { create });
    }

    /**
     * 写入文本文件
     *
     * @param {string} filePath - 文件路径
     * @param {string} content - 文本内容
     * @returns {Promise<void>}
     */
    async writeTextFile(filePath, content) {
        await this._acquireWriteLock(filePath);

        try {
            const fileHandle = await this._getFileHandle(filePath, true);
            const writable = await fileHandle.createWritable();

            try {
                await writable.write(content);
                logger.debug(`💾 写入文本文件: ${filePath} (${content.length} 字符)`);
            } finally {
                await writable.close();
            }
        } catch (error) {
            logger.error(`❌ 写入文件失败: ${filePath}`, error);
            throw error;
        } finally {
            this._releaseWriteLock(filePath);
        }
    }

    /**
     * 读取文本文件
     *
     * @param {string} filePath - 文件路径
     * @returns {Promise<string|null>} 文件内容，文件不存在则返回 null
     */
    async readTextFile(filePath) {
        try {
            const fileHandle = await this._getFileHandle(filePath, false);
            const file = await fileHandle.getFile();
            const content = await file.text();
            logger.debug(`📖 读取文件: ${filePath} (${content.length} 字符)`);
            return content;
        } catch (error) {
            if (error.name === 'NotFoundError') {
                return null;
            }
            logger.error(`❌ 读取文件失败: ${filePath}`, error);
            throw error;
        }
    }

    /**
     * ✅ 列出目录中的所有文件名
     *
     * @param {string} dirPath - 目录路径
     * @returns {Promise<string[]>} 文件名数组
     */
    async listDirectory(dirPath) {
        try {
            const dirHandle = await this._getOrCreateDirectory(this.rootDirectoryHandle, dirPath);
            const fileNames = [];

            for await (const entry of dirHandle.entries()) {
                if (entry[1].kind === 'file') {
                    fileNames.push(entry[0]);
                }
            }

            logger.debug(`📂 列出目录: ${dirPath} (${fileNames.length} 个文件)`);
            return fileNames;
        } catch (error) {
            logger.error(`❌ 列出目录失败: ${dirPath}`, error);
            return [];
        }
    }

    /**
     * 写入二进制文件（用于保存视频/图片）
     *
     * @param {string} filePath - 文件路径
     * @param {ArrayBuffer} arrayBuffer - 二进制数据
     * @returns {Promise<void>}
     */
    async writeBinaryFile(filePath, arrayBuffer) {
        await this._acquireWriteLock(filePath);

        try {
            const fileHandle = await this._getFileHandle(filePath, true);
            const writable = await fileHandle.createWritable();

            try {
                await writable.write({
                    type: 'write',
                    data: arrayBuffer
                });
                logger.debug(`💾 写入二进制文件: ${filePath} (${arrayBuffer.byteLength} bytes)`);
            } finally {
                await writable.close();
            }
        } catch (error) {
            logger.error(`❌ 写入二进制文件失败: ${filePath}`, error);
            throw error;
        } finally {
            this._releaseWriteLock(filePath);
        }
    }

    /**
     * ✅ 保存 Blob 对象为文件（用于大文件下载）
     *
     * @param {string} filePath - 文件路径
     * @param {Blob} blob - Blob 数据
     * @returns {Promise<void>}
     */
    async saveBlobFile(filePath, blob) {
        await this._acquireWriteLock(filePath);

        try {
            const fileHandle = await this._getFileHandle(filePath, true);
            const writable = await fileHandle.createWritable();

            try {
                // ✅ File System Access API 原生支持直接写 Blob
                await writable.write(blob);
                logger.debug(`💾 保存 Blob 文件: ${filePath} (${blob.size} bytes)`);
            } finally {
                await writable.close();
            }
        } catch (error) {
            logger.error(`❌ 保存 Blob 文件失败: ${filePath}`, error);
            throw error;
        } finally {
            this._releaseWriteLock(filePath);
        }
    }

    // ==========================================
    // 数据序列化/反序列化
    // ==========================================

    /**
     * 特殊字符转义（防止模板字符串冲突）
     * @private
     */
    _escapeSpecialChars(str) {
        if (typeof str !== 'string') return str;
        return str.replaceAll('`', '\\`').replaceAll('${', '\\${');
    }

    /**
     * 特殊字符还原
     * @private
     */
    _unescapeSpecialChars(str) {
        if (typeof str !== 'string') return str;
        return str.replaceAll('\\${', '${').replaceAll('\\`', '`');
    }

    /**
     * 递归处理对象中的字符串
     * @private
     */
    _processObject(obj, processor) {
        if (Array.isArray(obj)) {
            return obj.map(item => this._processObject(item, processor));
        } else if (obj !== null && typeof obj === 'object') {
            const result = {};
            for (const [key, value] of Object.entries(obj)) {
                result[key] = this._processObject(value, processor);
            }
            return result;
        } else if (typeof obj === 'string') {
            return processor(obj);
        }
        return obj;
    }

    /**
     * 序列化数据为 JS 文件格式
     *
     * @param {*} data - 要序列化的数据
     * @param {string} variableName - 变量名
     * @returns {string} JS 文件内容
     */
    serializeData(data, variableName) {
        const processedData = this._processObject(data, this._escapeSpecialChars.bind(this));

        const jsonData = JSON.stringify(processedData, (key, value) => {
            if (value instanceof Set) {
                return [...value];
            }
            return value;
        }, 2);

        return `${variableName} = \`${jsonData}\`;`;
    }

    /**
     * 反序列化 JS 文件内容
     *
     * @param {string} content - 文件内容
     * @param {string} variableName - 变量名
     * @returns {*} 解析后的数据
     */
    deserializeData(content, variableName) {
        if (!content || content.trim() === '') {
            return null;
        }

        const regex = new RegExp(`${variableName}\\s*=\\s*\`([\\s\\S]*)\`;`);
        const match = content.match(regex);

        if (!match) {
            throw new Error(`文件格式错误：未找到 ${variableName} = \`...\`;`);
        }

        const jsonData = match[1];
        const data = JSON.parse(jsonData);

        return this._processObject(data, this._unescapeSpecialChars.bind(this));
    }

    // ==========================================
    // NDJSON 工具方法
    // ==========================================

    /**
     * 读取并解析 NDJSON 文件
     * @param {string} filePath - 文件路径
     * @returns {Promise<Array>} 解析后的记录数组
     */
    async readNDJSON(filePath) {
        const content = await this.readTextFile(filePath);
        
        if (!content || content.trim() === '') {
            return [];
        }

        const records = [];
        const lines = content.trim().split('\n');
        
        for (const line of lines) {
            if (line.trim()) {
                try {
                    const record = JSON.parse(line);
                    records.push(record);
                } catch (error) {
                    logger.warn(`⚠️ 解析 NDJSON 行失败:`, error.message);
                }
            }
        }

        return records;
    }

    /**
     * 追加记录到 NDJSON 文件
     * @param {string} filePath - 文件路径
     * @param {Array} records - 要追加的记录数组
     */
    async appendNDJSON(filePath, records) {
        if (!records || records.length === 0) {
            return;
        }

        // 将记录转换为 NDJSON 格式
        const ndjsonLines = records.map(record => JSON.stringify(record));
        const contentToAppend = ndjsonLines.join('\n') + '\n';

        // 如果文件存在，读取现有内容并追加；否则创建新文件
        let finalContent = contentToAppend;
        try {
            const existingContent = await this.readTextFile(filePath);
            if (existingContent) {
                finalContent = existingContent + contentToAppend;
            }
        } catch (error) {
            // 文件不存在，使用新内容
        }

        await this.writeTextFile(filePath, finalContent);
    }

    // ==========================================
    // 用户配置文件读写（.FavGallery/config.json）
    // ==========================================

    /**
     * ✅ 读取用户配置文件
     * @returns {Promise<Object|null>} 配置对象；文件不存在或解析失败返回 null
     */
    async readUserConfig() {
        const content = await this.readTextFile(CONFIG.FILE_SYSTEM.CONFIG_FILE);
        if (!content || content.trim() === '') {
            return null;
        }
        try {
            return JSON.parse(content);
        } catch (error) {
            logger.warn('⚠️ 配置文件解析失败，将回退到默认配置:', error.message);
            return null;
        }
    }

    /**
     * ✅ 写入用户配置文件
     * @param {Object} config - 配置对象
     * @returns {Promise<void>}
     */
    async writeUserConfig(config) {
        const content = JSON.stringify(config, null, 2);
        await this.writeTextFile(CONFIG.FILE_SYSTEM.CONFIG_FILE, content);
        logger.info('💾 用户配置文件已写入:', CONFIG.FILE_SYSTEM.CONFIG_FILE);
    }

    // ==========================================
    // 写入锁管理
    // ==========================================

    /**
     * 获取写入锁
     * @private
     */
    async _acquireWriteLock(filePath) {
        while (this.writeLocks.get(filePath)) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        this.writeLocks.set(filePath, true);
    }

    /**
     * 释放写入锁
     * @private
     */
    _releaseWriteLock(filePath) {
        this.writeLocks.set(filePath, false);
    }



    // ==========================================
    // 异步备份机制
    // ==========================================

    // ==========================================
    // 工具方法
    // ==========================================

    /**
     * 检查是否已授权目录
     *
     * @returns {boolean}
     */
    hasDirectoryPermission() {
        return this.rootDirectoryHandle !== null;
    }

    /**
     * 检查文件是否存在
     *
     * @param {string} filePath - 文件路径（相对于根目录）
     * @returns {Promise<boolean>} 文件是否存在
     */
    async fileExists(filePath) {
        try {
            await this._getFileHandle(filePath, false);
            return true;
        } catch (error) {
            if (error.name === 'NotFoundError') {
                return false;
            }
            throw error;
        }
    }

    /**
     * ✅ 删除文件（相对根目录），不存在则忽略
     *
     * @param {string} filePath - 文件路径
     * @returns {Promise<boolean>} 是否实际删除
     */
    async removeFile(filePath) {
        if (!this.rootDirectoryHandle) {
            throw new Error('未设置根目录句柄');
        }
        const parts = filePath.split('/').filter(part => part.length > 0);
        const name = parts.pop();
        if (!name) return false;

        let dir = this.rootDirectoryHandle;
        for (const part of parts) {
            try {
                dir = await dir.getDirectoryHandle(part);
            } catch (error) {
                if (error.name === 'NotFoundError') return false; // 路径不存在，无需删除
                throw error;
            }
        }

        try {
            await dir.removeEntry(name);
            logger.debug(`🗑️ 已删除文件: ${filePath}`);
            return true;
        } catch (error) {
            if (error.name === 'NotFoundError') return false;
            throw error;
        }
    }

    /**
     * ✅ 递归删除目录（相对根目录），不存在则忽略
     *    用于生成离线壳前清空可能残留的历史文件
     *
     * @param {string} dirPath - 目录路径
     * @returns {Promise<boolean>} 是否实际删除
     */
    async removeDirectory(dirPath) {
        if (!this.rootDirectoryHandle) {
            throw new Error('未设置根目录句柄');
        }
        const parts = dirPath.split('/').filter(part => part.length > 0);
        const name = parts.pop();
        if (!name) return false;

        let dir = this.rootDirectoryHandle;
        for (const part of parts) {
            try {
                dir = await dir.getDirectoryHandle(part);
            } catch (error) {
                if (error.name === 'NotFoundError') return false;
                throw error;
            }
        }

        try {
            await dir.removeEntry(name, { recursive: true });
            logger.debug(`🗑️ 已递归删除目录: ${dirPath}`);
            return true;
        } catch (error) {
            if (error.name === 'NotFoundError') return false;
            throw error;
        }
    }

    /**
     * 获取根目录路径（用于构建保存路径）
     * @returns {string} 根目录名称
     */
    getRootPath() {
        if (!this.rootDirectoryHandle) {
            throw new Error('未设置根目录句柄，请先选择保存文件夹');
        }
        return this.rootDirectoryHandle.name;
    }

    /**
     * 获取根目录句柄
     * @returns {FileSystemDirectoryHandle|null}
     */
    getRootDirectoryHandle() {
        return this.rootDirectoryHandle;
    }

    /**
     * 关闭数据库连接
     */
    close() {
        // ✅ 停止定时备份（由 backupManager 管理）
        import('../backup/backup-manager.js').then(({ backupManager }) => {
            backupManager.stopPeriodicBackup();
        });
        
        database.close();
        this.dbInitialized = false;
        logger.info('🔒 文件系统管理器已关闭');
    }
}

// 导出类和单例
export { FileSystem };
export const fileSystem = new FileSystem();
export default fileSystem;
